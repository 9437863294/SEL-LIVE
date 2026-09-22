using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Sel.Agent.Core.Api;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Platform;
using Sel.Agent.Core.Tracking;

namespace Sel.Agent.Core
{
    /// <summary>What the agent is currently doing, for the tray and the status panel.</summary>
    public sealed class AgentStatus
    {
        public bool SignedIn { get; set; }
        public string UserName { get; set; }
        public string SessionId { get; set; }
        public DateTime? SignedInAtUtc { get; set; }
        public string Presence { get; set; }
        public string CurrentApplication { get; set; }
        public int QueuedSpans { get; set; }
        public bool Online { get; set; }
        public DateTime? LastSyncUtc { get; set; }
        public string LastError { get; set; }
        public ResolvedAgentPolicy Policy { get; set; }
    }

    /// <summary>
    /// The agent's engine: two loops, some event wiring, and the rules for when to stop trying.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Deliberately has no UI and no Win32. Everything it touches is one of the interfaces in
    /// <see cref="Sel.Agent.Core.Platform"/>, so the same coordinator drives the WPF tray on a
    /// Windows 11 desktop and could be driven by a console harness in a test. That is what makes
    /// "does the agent behave correctly when the network drops for two hours" a question that can
    /// be answered without two hours or a network.
    /// </para>
    ///
    /// <para><b>Two loops, at different cadences, for different reasons.</b></para>
    /// <para>
    /// The <b>heartbeat</b> (default 90s) is liveness and the only channel the server has back to
    /// the agent — policy changes, directives, notification availability and update offers all
    /// ride on its response. A missed beat is forgotten immediately: the next one carries the
    /// same information, and retrying would only add load to a server that is evidently already
    /// struggling.
    /// </para>
    /// <para>
    /// The <b>flush</b> (default 180s) uploads spans. A missed flush is never forgotten, because
    /// the spans are the record. They stay in the queue and go up with the next attempt.
    /// </para>
    ///
    /// <para><b>Offline is inferred, not configured.</b></para>
    /// <para>
    /// There is no "offline mode" switch. The agent marks itself offline after a failed call and
    /// online after a successful one, and the span builder stamps <c>recordedOffline</c> from
    /// that flag — so the report can distinguish a day recorded with confidence from one
    /// reconstructed from a queue. §54's requirement that work continue through an outage falls
    /// out of the queue being the source of truth: nothing in the recording path calls the
    /// network at all.
    /// </para>
    ///
    /// <para><b>Directives are obeyed once.</b></para>
    /// <para>
    /// The server cannot clear a directive flag when it is honoured — it has no way to know — so
    /// each one carries an id derived from the instant it was raised, and this class remembers
    /// which it has acted on. Without that, a "sign out" flag set once would sign the user out
    /// every ninety seconds for ever.
    /// </para>
    /// </remarks>
    public sealed class AgentCoordinator : IDisposable
    {
        private readonly SelLiveApiClient _api;
        private readonly IOfflineQueue _queue;
        private readonly IForegroundWatcher _foreground;
        private readonly IIdleMonitor _idle;
        private readonly ISessionStateMonitor _sessionState;
        private readonly ActivitySpanBuilder _builder;
        private readonly Func<string> _idTokenProvider;
        private readonly Action<string> _log;

        private readonly HashSet<string> _handledDirectives = new HashSet<string>(StringComparer.Ordinal);
        private readonly object _stateGate = new object();

        private CancellationTokenSource _cancellation;
        private Task _heartbeatLoop;
        private Task _flushLoop;
        private Task _tickLoop;

        private ResolvedAgentPolicy _policy = ResolvedAgentPolicy.Defaults();
        private string _sessionId;
        private string _userName;
        private DateTime? _signedInAtUtc;
        private bool _online = true;
        private bool _locked;
        private DateTime? _lastSyncUtc;
        private string _lastError;
        private bool _trackingPaused;
        private bool _disposed;

        /// <summary>How often idle is sampled. Fine enough to catch short pauses, cheap enough to ignore.</summary>
        private static readonly TimeSpan TickInterval = TimeSpan.FromSeconds(5);

        /// <summary>Spans per upload. Comfortably under the server's 500 and under a request size worth worrying about.</summary>
        private const int FlushBatchSize = 200;

        public AgentCoordinator(
            SelLiveApiClient api,
            IOfflineQueue queue,
            IForegroundWatcher foreground,
            IIdleMonitor idle,
            ISessionStateMonitor sessionState,
            Func<string> idTokenProvider,
            Action<string> log)
        {
            _api = api ?? throw new ArgumentNullException("api");
            _queue = queue ?? throw new ArgumentNullException("queue");
            _foreground = foreground ?? throw new ArgumentNullException("foreground");
            _idle = idle ?? throw new ArgumentNullException("idle");
            _sessionState = sessionState ?? throw new ArgumentNullException("sessionState");
            _idTokenProvider = idTokenProvider ?? throw new ArgumentNullException("idTokenProvider");
            _log = log ?? (message => { });
            _builder = new ActivitySpanBuilder();
        }

        /// <summary>Raised when the server tells the agent to do something (§34).</summary>
        public event EventHandler<AgentDirective> DirectiveReceived;

        /// <summary>Raised when notifications are waiting, with their ids.</summary>
        public event EventHandler<List<string>> NotificationsAvailable;

        /// <summary>Raised when a newer agent build applies to this device (§43).</summary>
        public event EventHandler<AvailableVersion> UpdateAvailable;

        /// <summary>Raised whenever the status changes enough for the tray to care.</summary>
        public event EventHandler StatusChanged;

        /// <summary>
        /// Lock, unlock, sleep and resume, re-raised for the UI layer.
        /// </summary>
        /// <remarks>
        /// The coordinator already subscribes to these to build spans, and a second subscriber
        /// on <c>SystemEvents</c> would be a second static handler to remember to unhook — the
        /// exact leak <see cref="Win32SessionStateMonitor"/>'s own remarks warn about. Re-raising
        /// keeps one subscription and makes its lifetime this object's.
        /// </remarks>
        public event EventHandler<SessionStateChange> SessionStateChanged;

        /// <summary>
        /// Seconds since the last keyboard or mouse input, session-wide.
        /// </summary>
        /// <remarks>
        /// Exposed so the idle-lock controller reads the same number the span builder does.
        /// A second <see cref="IIdleMonitor"/> would work — it is a stateless Win32 call — but
        /// two sources for one fact is how the lock and the timesheet come to disagree.
        /// </remarks>
        public double IdleSeconds { get { return _idle.GetIdleSeconds(); } }

        public ResolvedAgentPolicy Policy { get { return _policy; } }

        /// <summary>
        /// Adopt a policy, and apply the parts of it that live outside this class.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Policy arrives from three places — the pre-sign-in fetch, the login response and
        /// every heartbeat — and each used to assign <c>_policy</c> directly. Any setting that
        /// has to be pushed somewhere else therefore had to be pushed in three places, or be
        /// silently ignored in two of them. One method, three callers.
        /// </para>
        /// <para>
        /// Both settings here were constants until an administrator needed them to differ per
        /// site: the span length is the granularity of the record, and the request timeout is
        /// the difference between a satellite link looking slow and looking dead.
        /// </para>
        /// </remarks>
        private void ApplyPolicy(ResolvedAgentPolicy policy)
        {
            if (policy == null || policy.Settings == null) return;
            _policy = policy;

            if (policy.Settings.MaxSpanMinutes > 0)
            {
                _builder.MaxSpanDuration = TimeSpan.FromMinutes(policy.Settings.MaxSpanMinutes);
            }

            if (policy.Settings.RequestTimeoutSeconds > 0)
            {
                _api.SetRequestTimeout(TimeSpan.FromSeconds(policy.Settings.RequestTimeoutSeconds));
            }

            // Two collection switches, pushed rather than polled so that switching them off in
            // SEL LIVE stops the collection on the next heartbeat rather than at the next
            // restart. Both default to false in the policy, so a device that has never reached
            // the server collects neither.
            _foreground.CollectBrowserDomains = policy.Settings.BrowserDomainTrackingEnabled;
            _foreground.CollectDocumentNames = policy.Settings.DocumentNameTrackingEnabled;
        }

        /// <summary>
        /// Fetch the device's policy before anybody has signed in.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Policy otherwise arrives with the login response or a heartbeat, and both of those
        /// need a signed-in user. That left the one decision that has to be made *before*
        /// sign-in — whether the access gate can be dismissed — being made from the built-in
        /// defaults, where <c>requireMorningLogin</c> is false. A cold-started PC therefore
        /// offered a dismissible gate no matter what the administrator had configured, and
        /// somebody could close it and work with nothing recorded.
        /// </para>
        /// <para>
        /// The route is device-authenticated and treats the user token as optional precisely so
        /// this call can be made. Failure is not fatal: no network means the previous policy or
        /// the defaults, which is the same position the agent was in before.
        /// </para>
        /// </remarks>
        public async Task RefreshPolicyBeforeLoginAsync(CancellationToken cancellation)
        {
            try
            {
                PolicyResponse response = await _api.FetchPolicyAsync(null, cancellation).ConfigureAwait(false);
                if (response != null && response.Policy != null && response.Policy.Settings != null)
                {
                    ApplyPolicy(response.Policy);
                    _log("Policy fetched before sign-in; the access gate is "
                        + (_policy.Settings.RequireMorningLogin ? "mandatory." : "dismissible."));
                    RaiseStatusChanged();
                }
            }
            catch (Exception error)
            {
                _log("Could not fetch the policy before sign-in: " + error.Message);
            }
        }

        public AgentStatus Status
        {
            get
            {
                lock (_stateGate)
                {
                    ForegroundSnapshot current = _builder.Current;
                    return new AgentStatus
                    {
                        SignedIn = !string.IsNullOrEmpty(_sessionId),
                        UserName = _userName,
                        SessionId = _sessionId,
                        SignedInAtUtc = _signedInAtUtc,
                        Presence = CurrentPresence(),
                        CurrentApplication = current == null ? null : current.ApplicationName,
                        QueuedSpans = SafeQueueCount(),
                        Online = _online,
                        LastSyncUtc = _lastSyncUtc,
                        LastError = _lastError,
                        Policy = _policy
                    };
                }
            }
        }

        /// <summary>
        /// Begin a tracked session after a successful sign-in.
        /// </summary>
        public void StartSession(AgentLoginResponse login)
        {
            if (login == null) throw new ArgumentNullException("login");

            lock (_stateGate)
            {
                _sessionId = login.SessionId;
                _userName = login.UserName;
                _signedInAtUtc = IsoTime.Parse(login.LoginAt);
                if (login.Policy != null) ApplyPolicy(login.Policy);

                // The obeyed-directive ids are deliberately NOT cleared here.
                //
                // Clearing them was how a stale force-sign-out became permanent: every login
                // wiped the memory, the flag was still on the device document, and the next
                // heartbeat delivered it as though it were new. Directive ids embed the instant
                // they were raised, so they are unique per raise and there is nothing a new
                // session needs to forget.
            }

            _sessionState.StateChanged += OnSessionStateChanged;
            _foreground.ForegroundChanged += OnForegroundChanged;
            _sessionState.Start();
            _foreground.Start();
            _builder.Start(DateTime.UtcNow, _foreground.Capture());

            _cancellation = new CancellationTokenSource();
            CancellationToken token = _cancellation.Token;
            _heartbeatLoop = RunLoop(HeartbeatOnceAsync, () => _policy.Settings.HeartbeatIntervalSeconds, token);
            _flushLoop = RunLoop(FlushOnceAsync, () => _policy.Settings.ActivityBatchIntervalSeconds, token);
            _tickLoop = RunTickLoop(token);

            _log("Session started: " + login.SessionId + " for " + login.UserName);
            RaiseStatusChanged();
        }

        /// <summary>
        /// End the session and close it server-side (§28).
        /// </summary>
        /// <remarks>
        /// The open span is closed and everything still queued for this session travels on the
        /// logout request itself. Windows allows only a few seconds between
        /// <c>WM_QUERYENDSESSION</c> and the process being killed — enough for one request, not
        /// for a flush followed by a logout. Sending them together is what makes the last minutes
        /// before a shutdown survive.
        /// </remarks>
        public async Task StopSessionAsync(string endReason)
        {
            string sessionId;
            lock (_stateGate) { sessionId = _sessionId; }
            if (string.IsNullOrEmpty(sessionId)) return;

            try
            {
                if (_cancellation != null) _cancellation.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // Already torn down by a racing shutdown path.
            }

            _foreground.ForegroundChanged -= OnForegroundChanged;
            _sessionState.StateChanged -= OnSessionStateChanged;
            _foreground.Stop();

            _builder.Stop(DateTime.UtcNow);
            List<ActivitySpan> finalSpans = _builder.DrainCompleted();
            if (finalSpans.Count > 0) _queue.Enqueue(sessionId, finalSpans);

            // Everything outstanding for this session, capped so a huge backlog cannot make the
            // shutdown request time out and lose the close as well as the spans.
            List<QueuedSpan> pending = _queue
                .Peek(FlushBatchSize)
                .Where(entry => entry.SessionId == sessionId)
                .ToList();

            var request = new SessionLogoutRequest
            {
                SessionId = sessionId,
                IdToken = _idTokenProvider(),
                EndReason = endReason ?? SessionEndReasons.UserSignout,
                EndedAt = IsoTime.Now(),
                FinalSpans = pending.Select(entry => entry.Span).ToList()
            };

            try
            {
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8)))
                {
                    await _api.LogoutAsync(request, timeout.Token).ConfigureAwait(false);
                }
                _queue.Acknowledge(pending.Select(entry => entry.RowId));
                _log("Session closed: " + endReason);
            }
            catch (Exception error)
            {
                // The spans stay queued and go up at the next sign-in; the reaper closes the
                // session as UNCLEAN_END with an estimated time, which is exactly what §28 wants
                // to happen when the evidence is incomplete.
                _log("Logout could not be delivered (" + error.Message + "). The session will be reconciled server-side.");
            }
            finally
            {
                lock (_stateGate)
                {
                    _sessionId = null;
                    _userName = null;
                    _signedInAtUtc = null;
                }
                RaiseStatusChanged();
            }
        }

        /// <summary>
        /// Suspend recording, where the policy permits it (§26).
        /// </summary>
        /// <remarks>
        /// Returns false when <c>allowUserPauseTracking</c> is off, and the tray hides the menu
        /// item in that case — but the check is repeated here rather than trusted to the UI,
        /// because a menu item that is merely hidden is not a control.
        /// </remarks>
        public bool TryPauseTracking()
        {
            if (!_policy.Settings.AllowUserPauseTracking) return false;
            lock (_stateGate) { _trackingPaused = true; }
            _builder.Stop(DateTime.UtcNow);
            FlushBuilderToQueue();
            RaiseStatusChanged();
            return true;
        }

        public void ResumeTracking()
        {
            lock (_stateGate) { _trackingPaused = false; }
            _builder.Start(DateTime.UtcNow, _foreground.Capture());
            RaiseStatusChanged();
        }

        /// <summary>Upload now, from the tray's "Sync now".</summary>
        public Task SyncNowAsync()
        {
            return FlushOnceAsync(CancellationToken.None);
        }

        /* ── Loops ───────────────────────────────────────────────────────────────────────── */

        private Task RunLoop(Func<CancellationToken, Task> body, Func<int> intervalSeconds, CancellationToken token)
        {
            return Task.Run(async () =>
            {
                while (!token.IsCancellationRequested)
                {
                    try
                    {
                        await body(token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }
                    catch (Exception error)
                    {
                        // A loop that dies leaves the agent silently doing nothing, which is far
                        // worse than a logged error — so nothing is allowed to escape.
                        _log("Loop error: " + error.Message);
                    }

                    // Read the interval each time round: a policy change on the heartbeat
                    // response takes effect on the next iteration, with no restart (§35).
                    int seconds = Math.Max(15, intervalSeconds());
                    try
                    {
                        await Task.Delay(TimeSpan.FromSeconds(seconds), token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }
                }
            }, token);
        }

        private Task RunTickLoop(CancellationToken token)
        {
            return Task.Run(async () =>
            {
                while (!token.IsCancellationRequested)
                {
                    try
                    {
                        bool paused;
                        lock (_stateGate) { paused = _trackingPaused; }
                        if (!paused && _policy.Settings.ApplicationTrackingEnabled)
                        {
                            _builder.Offline = !_online;
                            _builder.OnTick(DateTime.UtcNow, _idle.GetIdleSeconds());

                            // Re-sample what is in front, because the two things this now
                            // measures change *without* a foreground event: switching browser tab
                            // and opening another workbook both keep the same window in focus.
                            // SetWinEventHook says nothing about either, so the tick is the only
                            // place a tab change can be noticed.
                            //
                            // Cheap when there is nothing to do: the snapshot is a handful of
                            // Win32 calls, the address bar is only read when the title has
                            // changed, and the builder does nothing unless the domain or the
                            // document differs from the open span's.
                            ForegroundSnapshot resampled = _foreground.Capture();
                            if (resampled != null) _builder.OnForegroundChanged(DateTime.UtcNow, resampled);

                            FlushBuilderToQueue();
                        }
                    }
                    catch (Exception error)
                    {
                        _log("Tick error: " + error.Message);
                    }

                    try
                    {
                        await Task.Delay(TickInterval, token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }
                }
            }, token);
        }

        /// <summary>Move finished spans from memory into the durable queue.</summary>
        private void FlushBuilderToQueue()
        {
            if (_builder.PendingCount == 0) return;
            string sessionId;
            lock (_stateGate) { sessionId = _sessionId; }
            if (string.IsNullOrEmpty(sessionId)) return;
            _queue.Enqueue(sessionId, _builder.DrainCompleted());
        }

        private async Task HeartbeatOnceAsync(CancellationToken token)
        {
            string sessionId;
            lock (_stateGate) { sessionId = _sessionId; }

            var request = new HeartbeatRequest
            {
                SessionId = sessionId,
                IdToken = _idTokenProvider(),
                SentAt = IsoTime.Now(),
                Presence = CurrentPresence(),
                ProcessName = _builder.Current == null ? null : _builder.Current.ProcessName,
                ApplicationName = _builder.Current == null ? null : _builder.Current.ApplicationName,
                AgentVersion = AgentVersion.Current,
                QueuedSpanCount = SafeQueueCount(),
                IdleSeconds = (int)Math.Round(_idle.GetIdleSeconds())
            };

            try
            {
                HeartbeatResponse response = await _api.HeartbeatAsync(request, token).ConfigureAwait(false);
                MarkOnline();

                if (response.Policy != null && response.Policy.Settings != null) ApplyPolicy(response.Policy);

                if (response.Directives != null)
                {
                    foreach (AgentDirective directive in response.Directives) HandleDirective(directive);
                }

                if (response.PendingNotificationIds != null && response.PendingNotificationIds.Count > 0)
                {
                    EventHandler<List<string>> handler = NotificationsAvailable;
                    if (handler != null) handler(this, response.PendingNotificationIds);
                }

                if (response.AvailableVersion != null)
                {
                    EventHandler<AvailableVersion> handler = UpdateAvailable;
                    if (handler != null) handler(this, response.AvailableVersion);
                }
            }
            catch (SelApiException error)
            {
                MarkOffline(error.Message);
                // A device whose credential has been revoked must stop, not keep beating — see
                // the class remarks on not hammering a server that has said no.
                if (error.RequiresReenrollment) throw new OperationCanceledException();
            }

            RaiseStatusChanged();
        }

        private async Task FlushOnceAsync(CancellationToken token)
        {
            string sessionId;
            lock (_stateGate) { sessionId = _sessionId; }
            if (string.IsNullOrEmpty(sessionId)) return;

            FlushBuilderToQueue();

            IList<QueuedSpan> batch = _queue.Peek(FlushBatchSize);
            if (batch.Count == 0) return;

            // One request per session: a batch can span a sign-out and a sign-in if the agent was
            // offline across both, and the server validates that every span belongs to the
            // session named in the request.
            foreach (var group in batch.GroupBy(entry => entry.SessionId))
            {
                if (string.IsNullOrEmpty(group.Key)) continue;
                List<QueuedSpan> entries = group.ToList();

                var request = new ActivityBatchRequest
                {
                    SessionId = group.Key,
                    IdToken = _idTokenProvider(),
                    SentAt = IsoTime.Now(),
                    Spans = entries.Select(entry => entry.Span).ToList()
                };

                try
                {
                    ActivityBatchResponse response = await _api.SendActivityAsync(request, token).ConfigureAwait(false);
                    MarkOnline();

                    var settled = new HashSet<string>(StringComparer.Ordinal);
                    if (response.Duplicates != null) foreach (string id in response.Duplicates) settled.Add(id);
                    if (response.Rejected != null)
                    {
                        foreach (SpanRejection rejection in response.Rejected)
                        {
                            settled.Add(rejection.SpanId);
                            _log("Span rejected (" + rejection.SpanId + "): " + rejection.Reason);
                        }
                    }

                    // Accepted, duplicated and rejected all mean "the server is finished with
                    // this span". Retrying a rejection would loop for ever on a span the server
                    // has explained it will never take.
                    _queue.Acknowledge(entries.Select(entry => entry.RowId));
                    _lastSyncUtc = DateTime.UtcNow;
                    _log(string.Format("Uploaded {0} spans ({1} accepted, {2} duplicate, {3} rejected).",
                        entries.Count,
                        response.Accepted,
                        response.Duplicates == null ? 0 : response.Duplicates.Count,
                        response.Rejected == null ? 0 : response.Rejected.Count));
                }
                catch (SelApiException error)
                {
                    MarkOffline(error.Message);
                    // 4xx that is not a rate limit means these spans are wrong, not unlucky.
                    bool permanent = !error.IsTransient && error.StatusCode >= 400 && error.StatusCode < 500
                                     && !error.RequiresReauthentication;
                    _queue.MarkFailed(entries.Select(entry => entry.RowId), error.Message, permanent);
                    return;
                }
            }

            RaiseStatusChanged();
        }

        /* ── Events ──────────────────────────────────────────────────────────────────────── */

        private void OnForegroundChanged(object sender, ForegroundSnapshot snapshot)
        {
            bool paused;
            lock (_stateGate) { paused = _trackingPaused; }
            if (paused || !_policy.Settings.ApplicationTrackingEnabled) return;
            _builder.OnForegroundChanged(DateTime.UtcNow, snapshot);
        }

        private void OnSessionStateChanged(object sender, SessionStateChange change)
        {
            DateTime now = DateTime.UtcNow;

            // Re-raised before the span bookkeeping, and outside it, so a throwing subscriber in
            // the UI layer cannot leave the builder without its Locked or Unlocked edge — which
            // would silently mis-classify the rest of the day.
            try
            {
                EventHandler<SessionStateChange> handler = SessionStateChanged;
                if (handler != null) handler(this, change);
            }
            catch (Exception error)
            {
                _log("A session-state subscriber threw: " + error.Message);
            }

            switch (change)
            {
                case SessionStateChange.Locked:
                    lock (_stateGate) { _locked = true; }
                    _builder.OnLocked(now);
                    break;
                case SessionStateChange.Unlocked:
                    lock (_stateGate) { _locked = false; }
                    _builder.OnUnlocked(now);
                    break;
                case SessionStateChange.Suspending:
                    _builder.OnSleep(now);
                    FlushBuilderToQueue();
                    break;
                case SessionStateChange.Resumed:
                    _builder.OnResume(now);
                    break;
                case SessionStateChange.LogOff:
                case SessionStateChange.Shutdown:
                    // Fire and forget with a short internal timeout: blocking Windows' shutdown
                    // on a network call is how a fleet gets a reputation for slow restarts.
                    string reason = change == SessionStateChange.Shutdown
                        ? SessionEndReasons.WindowsShutdown
                        : SessionEndReasons.WindowsLogoff;
                    StopSessionAsync(reason).Wait(TimeSpan.FromSeconds(9));
                    return;
            }
            FlushBuilderToQueue();
            RaiseStatusChanged();
        }

        /// <summary>
        /// Act on one instruction from the server, once, and only if it is still about this session.
        /// </summary>
        /// <remarks>
        /// <para>
        /// <b>A directive raised before this session began is already satisfied.</b> "Sign this
        /// user out" means the session that was running when an administrator clicked it. That
        /// session is gone — the person signed in again afterwards, which is the only way this
        /// code is reached — so obeying it now would end a session the instruction never referred
        /// to.
        /// </para>
        /// <para>
        /// That is not a hypothetical. A force sign-out raised on one machine at 13:07 signed the
        /// user out roughly 250 milliseconds after every subsequent login, for two days: the flag
        /// stays on the device document, the id-based memory below is per-process and was being
        /// cleared on every login as well, so each new session saw a stale instruction as a new
        /// one. From the desk it looked like "sign-in succeeds, then the tray says nobody is
        /// signed in".
        /// </para>
        /// <para>
        /// Both timestamps are stamped by the server — the directive's when it was raised, the
        /// session's at login — so this comparison never involves the PC's clock.
        /// </para>
        /// </remarks>
        private void HandleDirective(AgentDirective directive)
        {
            if (directive == null || string.IsNullOrEmpty(directive.DirectiveId)) return;

            DateTime sessionStartUtc;
            lock (_stateGate)
            {
                if (!_handledDirectives.Add(directive.DirectiveId)) return;
                // No session means no login instant to compare against, and DirectivePolicy
                // treats that as "obey" — see its remarks on which mistake is the worse one.
                sessionStartUtc = _signedInAtUtc ?? DateTime.MinValue;
            }

            if (!Session.DirectivePolicy.ShouldObey(IsoTime.Parse(directive.IssuedAt), sessionStartUtc))
            {
                _log("Ignoring " + directive.Kind + " (" + directive.DirectiveId
                    + "): raised before this session started, so it has already been satisfied.");
                return;
            }

            _log("Directive: " + directive.Kind + " (" + directive.DirectiveId + ")");
            EventHandler<AgentDirective> handler = DirectiveReceived;
            if (handler != null) handler(this, directive);
        }

        /* ── State ───────────────────────────────────────────────────────────────────────── */

        private string CurrentPresence()
        {
            bool locked;
            lock (_stateGate) { locked = _locked; }
            if (locked) return PresenceStates.Locked;

            double idleSeconds = _idle.GetIdleSeconds();
            if (idleSeconds >= _policy.Settings.ExtendedIdleThresholdSeconds) return PresenceStates.ExtendedIdle;
            if (idleSeconds >= _policy.Settings.IdleThresholdSeconds) return PresenceStates.Idle;
            return PresenceStates.Active;
        }

        private void MarkOnline()
        {
            bool changed;
            lock (_stateGate)
            {
                changed = !_online;
                _online = true;
                _lastError = null;
            }
            _builder.Offline = false;
            if (changed) _log("Back online.");
        }

        private void MarkOffline(string reason)
        {
            bool changed;
            lock (_stateGate)
            {
                changed = _online;
                _online = false;
                _lastError = reason;
            }
            _builder.Offline = true;
            if (changed) _log("Offline: " + reason + ". Recording continues locally.");
        }

        private int SafeQueueCount()
        {
            try
            {
                return _queue.PendingCount();
            }
            catch
            {
                return -1;
            }
        }

        private void RaiseStatusChanged()
        {
            EventHandler handler = StatusChanged;
            if (handler != null)
            {
                try { handler(this, EventArgs.Empty); }
                catch { /* a UI subscriber's fault must not stop the engine */ }
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            try { if (_cancellation != null) _cancellation.Cancel(); } catch { }
            _foreground.Dispose();
            _sessionState.Dispose();
            if (_cancellation != null) _cancellation.Dispose();
        }
    }

    /// <summary>The running agent's version, read from the assembly so it cannot drift.</summary>
    public static class AgentVersion
    {
        private static readonly Lazy<string> Value = new Lazy<string>(() =>
        {
            try
            {
                Version version = typeof(AgentVersion).Assembly.GetName().Version;
                return version == null ? "0.0.0" : version.ToString(3);
            }
            catch
            {
                return "0.0.0";
            }
        });

        public static string Current { get { return Value.Value; } }
    }
}
