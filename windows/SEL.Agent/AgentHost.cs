using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;
using Sel.Agent.Core;
using Sel.Agent.Core.Api;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Platform;
using Sel.Agent.Core.Platform.Win32;
using Sel.Agent.Core.Security;
using Sel.Agent.Core.Storage;

namespace Sel.Agent
{
    /// <summary>
    /// The desktop agent's composition root and lifetime.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Owns the objects, wires the events, and holds the one piece of state the coordinator
    /// deliberately does not: the user's Firebase session. Keeping the token here rather than in
    /// <see cref="AgentCoordinator"/> is what lets the coordinator stay free of authentication
    /// concerns — it asks for a token through a delegate and never learns how one is obtained or
    /// refreshed.
    /// </para>
    ///
    /// <para><b>Token refresh happens on demand, not on a timer.</b></para>
    /// <para>
    /// A Firebase ID token lasts an hour. The obvious design is a timer that refreshes every
    /// fifty minutes; the problem is that it keeps refreshing on a laptop that has been asleep in
    /// a bag since Friday, and it refreshes a token nobody is about to use. Refreshing when a
    /// caller asks for one, and only if the current one is close to expiry, means the work
    /// happens exactly when there is a request to attach it to.
    /// </para>
    ///
    /// <para><b>The refresh is synchronous, and that is a considered compromise.</b></para>
    /// <para>
    /// <see cref="AgentCoordinator"/>'s token delegate is synchronous because making it
    /// asynchronous would push <c>async</c> through the span-building path for the sake of a
    /// call that happens twice an hour. The blocking wait is bounded at fifteen seconds and
    /// occurs on the coordinator's own background loop, never on the UI thread.
    /// </para>
    /// </remarks>
    public sealed class AgentHost : IDisposable
    {
        private readonly AgentConfiguration _config;
        private readonly Dispatcher _dispatcher;
        private readonly AgentLog _log;

        private readonly SelLiveApiClient _api;
        private readonly FirebaseAuthClient _auth;
        private readonly RefreshTokenStore _refreshStore;
        private readonly DeviceIdentityStore _identityStore;
        private readonly SqliteOfflineQueue _queue;
        private readonly CompositeNotificationPresenter _notifications;
        private readonly Win32DeepLinkLauncher _deepLinks;
        private readonly Win32MachineFactsProvider _facts;
        private readonly AgentCoordinator _coordinator;
        private readonly ErpBrowser _erpBrowser;

        private readonly object _sessionGate = new object();
        private FirebaseSession _session;
        private bool _disposed;

        public AgentHost(AgentConfiguration config, Dispatcher dispatcher, AgentLog log)
        {
            _config = config ?? throw new ArgumentNullException("config");
            _dispatcher = dispatcher ?? throw new ArgumentNullException("dispatcher");
            _log = log ?? throw new ArgumentNullException("log");

            TlsBootstrap.Configure();

            _identityStore = new DeviceIdentityStore();
            _facts = new Win32MachineFactsProvider();
            _queue = new SqliteOfflineQueue();
            _deepLinks = new Win32DeepLinkLauncher(config.ApiBaseUrl);

            _api = new SelLiveApiClient(config.ApiBaseUrl, AgentVersion.Current);
            // One HttpClient for both: the connection pool, the proxy configuration and the TLS
            // settings are then shared, and on Windows 7's two-connections-per-host default that
            // matters more than it looks.
            _auth = new FirebaseAuthClient(config.FirebaseApiKey, _api.Http);
            _refreshStore = new RefreshTokenStore();

            _notifications = new CompositeNotificationPresenter(dispatcher, _log.Write);
            _notifications.Outcome += OnNotificationOutcome;

            _coordinator = new AgentCoordinator(
                _api,
                _queue,
                new Win32ForegroundWatcher(),
                new Win32IdleMonitor(),
                new Win32SessionStateMonitor(),
                GetIdTokenBlocking,
                _log.Write);

            _coordinator.NotificationsAvailable += OnNotificationsAvailable;
            _coordinator.DirectiveReceived += OnDirectiveReceived;
            _coordinator.UpdateAvailable += OnUpdateAvailable;
            _coordinator.StatusChanged += (s, e) => RaiseStatusChanged();

            _log.Write("Agent " + AgentVersion.Current + " starting on " + OsCompatibility.Current.Describe());
            _erpBrowser = new ErpBrowser(this, _log.Write);
            _erpBrowser.ClosedByUser += (sender, args) =>
            {
                EventHandler handler = ErpWindowClosedByUser;
                if (handler != null) handler(this, EventArgs.Empty);
            };

            _log.Write("Notification surface: " + _notifications.DescribeSelection());
            _log.Write("ERP opens: " + _erpBrowser.Describe());
        }

        public AgentCoordinator Coordinator { get { return _coordinator; } }
        public CompositeNotificationPresenter Notifications { get { return _notifications; } }
        public DeviceIdentityStore IdentityStore { get { return _identityStore; } }
        public AgentLog Log { get { return _log; } }
        public AgentConfiguration Configuration { get { return _config; } }

        public AgentLoginResponse CurrentLogin { get; private set; }

        public event EventHandler StatusChanged;
        public event EventHandler<AgentDirective> DirectiveReceived;
        public event EventHandler<AvailableVersion> UpdateAvailable;

        /// <summary>True once this PC holds a device credential.</summary>
        public bool IsEnrolled
        {
            get { return !string.IsNullOrEmpty(_api.DeviceId); }
        }

        /// <summary>
        /// Why the last enrolment attempt failed, in words meant for the person at the PC.
        /// </summary>
        /// <remarks>
        /// Kept because the alternative is a balloon tip saying "Ask IT to complete the
        /// installation" over a failure IT could have fixed in ten seconds if anybody had told
        /// them the code had expired. <see cref="App"/> puts this in front of the setup window.
        /// </remarks>
        public string LastEnrollmentError { get; private set; }

        /* ── Enrolment ───────────────────────────────────────────────────────────────────── */

        /// <summary>
        /// Load the stored credential, or enrol if there is a code to redeem.
        /// </summary>
        /// <remarks>
        /// Called once at start-up, before any sign-in can be attempted. An unenrolled PC with no
        /// code in its configuration is not an error — it is a machine the installer has not
        /// finished setting up, and the gate says so rather than looping.
        /// </remarks>
        public async Task<bool> EnsureEnrolledAsync(CancellationToken cancellation)
        {
            DeviceIdentity existing = _identityStore.Read();
            if (existing != null)
            {
                string secret = _identityStore.ReadSecret();
                if (!string.IsNullOrEmpty(secret))
                {
                    _api.DeviceId = existing.DeviceId;
                    _api.DeviceSecret = secret;
                    _log.Write("Using device credential " + existing.DeviceId + " (v" + existing.SecretVersion + ").");
                    return true;
                }
                // The credential exists but will not decrypt — a re-imaged machine or a moved
                // disk. Re-enrol rather than sit in a failing state.
                _log.Write("The stored device credential could not be decrypted; re-enrolling.");
            }

            if (string.IsNullOrEmpty(_config.EnrollmentCode))
            {
                _log.Write("This computer is not enrolled and no enrolment code is configured.");
                LastEnrollmentError = "This computer has not been registered with SEL LIVE yet. "
                    + "Enter the enrolment code given to you by IT to finish setting it up.";
                return false;
            }

            var request = new DeviceRegisterRequest
            {
                EnrollmentCode = _config.EnrollmentCode,
                Facts = _facts.Collect(),
                AgentVersion = AgentVersion.Current,
                // Present on a reinstall, so the server rotates the existing device's secret
                // rather than creating a duplicate record for the same PC.
                DeviceId = existing == null ? null : existing.DeviceId
            };
            if (!string.IsNullOrEmpty(_config.DeviceNameOverride))
            {
                request.Facts.Hostname = _config.DeviceNameOverride;
            }

            try
            {
                DeviceRegisterResponse response = await _api.RegisterDeviceAsync(request, cancellation)
                    .ConfigureAwait(false);

                _identityStore.Write(response.DeviceId, response.DeviceName, response.DeviceSecret,
                    response.SecretVersion, _config.ApiBaseUrl);
                _api.DeviceId = response.DeviceId;
                _api.DeviceSecret = response.DeviceSecret;

                // Redeemed — remove it so an enrolled PC is not carrying a code that could enrol
                // others if the file were copied.
                _config.ClearEnrollmentCode();

                _log.Write(response.Approved
                    ? "Enrolled as " + response.DeviceName + " (" + response.DeviceId + ")."
                    : "Enrolled as " + response.DeviceName + ", awaiting administrator approval.");
                LastEnrollmentError = null;
                return true;
            }
            catch (SelApiException error)
            {
                _log.Write("Enrolment failed: " + error.Message);

                // The server's own wording, kept for the setup window. A code that was valid when
                // it was written into the configuration can be expired, disabled or used up by
                // the time the PC is switched on, and "Ask IT to complete the installation" does
                // not tell anybody which of those happened.
                LastEnrollmentError = error.IsTransient
                    ? "SEL LIVE could not be reached to register this computer: " + error.Message
                    : error.Message;
                return false;
            }
        }

        /// <summary>
        /// Try again with a code somebody has just corrected, without restarting the agent.
        /// </summary>
        /// <remarks>
        /// The setup window has already written the configuration file and had the code accepted
        /// by <c>/device/check-code</c>; this pushes it into the running configuration so the
        /// retry uses it. Restarting the process instead would work, and would also lose the tray
        /// icon, the session lifecycle and anything the person was part-way through.
        /// </remarks>
        public Task<bool> RetryEnrolmentAsync(string code, CancellationToken cancellation)
        {
            if (string.IsNullOrEmpty(code)) return Task.FromResult(false);
            _config.EnrollmentCode = code;
            return EnsureEnrolledAsync(cancellation);
        }

        /* ── Sign-in ─────────────────────────────────────────────────────────────────────── */

        /// <summary>Sign in with an email and password, and open a work session.</summary>
        public async Task<AgentLoginResponse> SignInAsync(string email, string password, CancellationToken cancellation)
        {
            FirebaseSession session = await _auth.SignInAsync(email, password, cancellation).ConfigureAwait(false);
            lock (_sessionGate) { _session = session; }
            _refreshStore.Save(session.RefreshToken, session.Email);
            return await OpenSessionAsync(session, false, cancellation).ConfigureAwait(false);
        }

        /// <summary>
        /// Resume a previous sign-in without asking for a password.
        /// </summary>
        /// <remarks>
        /// Used after a restart within the working day, when the policy does not demand a fresh
        /// login. Returns null rather than throwing when there is nothing to resume — "no saved
        /// session" is the ordinary case on a shared PC, not an exception.
        /// </remarks>
        public async Task<AgentLoginResponse> TryResumeAsync(CancellationToken cancellation)
        {
            string refreshToken, email;
            if (!_refreshStore.TryLoad(out refreshToken, out email)) return null;

            try
            {
                FirebaseSession session = await _auth.RefreshAsync(refreshToken, cancellation).ConfigureAwait(false);
                lock (_sessionGate) { _session = session; }
                _refreshStore.Save(session.RefreshToken, email);
                return await OpenSessionAsync(session, false, cancellation).ConfigureAwait(false);
            }
            catch (FirebaseAuthException error)
            {
                _log.Write("Saved sign-in could not be resumed: " + error.Message);
                if (!error.IsTransient) _refreshStore.Clear();
                return null;
            }
            catch (SelApiException error)
            {
                _log.Write("Session could not be opened: " + error.Message);
                return null;
            }
        }

        private async Task<AgentLoginResponse> OpenSessionAsync(
            FirebaseSession session, bool offlineLogin, CancellationToken cancellation)
        {
            var request = new AgentLoginRequest
            {
                IdToken = session.IdToken,
                SentAt = IsoTime.Now(),
                AgentVersion = AgentVersion.Current,
                OfflineLogin = offlineLogin,
                Facts = _facts.Collect()
            };

            AgentLoginResponse login = await _api.LoginAsync(request, cancellation).ConfigureAwait(false);
            CurrentLogin = login;
            _coordinator.StartSession(login);
            _log.Write("Signed in as " + login.UserName + (login.Resumed ? " (resumed today's session)." : "."));
            RaiseStatusChanged();
            return login;
        }

        /// <summary>Close the work session and forget the saved credential.</summary>
        public async Task SignOutAsync(string endReason)
        {
            await _coordinator.StopSessionAsync(endReason ?? SessionEndReasons.UserSignout).ConfigureAwait(false);
            _notifications.ClearAll();
            // The embedded window holds a signed-in ERP session; leaving it open after sign-out
            // would leave the next person at this PC looking at the last one's dashboard.
            _erpBrowser.Close();
            lock (_sessionGate) { _session = null; }
            CurrentLogin = null;
            RaiseStatusChanged();
        }

        /// <summary>
        /// A current ID token, refreshing if necessary.
        /// </summary>
        /// <remarks>
        /// Returns an empty string rather than throwing when there is no session or the refresh
        /// fails. Every caller is a background loop that handles a rejected request anyway, and
        /// an exception thrown from a token accessor would have to be caught at a dozen call
        /// sites to achieve the same thing.
        /// </remarks>
        private string GetIdTokenBlocking()
        {
            FirebaseSession current;
            lock (_sessionGate) { current = _session; }
            if (current == null) return string.Empty;
            if (current.IsUsable) return current.IdToken;
            if (string.IsNullOrEmpty(current.RefreshToken)) return string.Empty;

            try
            {
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15)))
                {
                    FirebaseSession refreshed = _auth.RefreshAsync(current.RefreshToken, timeout.Token)
                        .GetAwaiter().GetResult();
                    lock (_sessionGate) { _session = refreshed; }
                    _refreshStore.Save(refreshed.RefreshToken, current.Email);
                    return refreshed.IdToken;
                }
            }
            catch (Exception error)
            {
                _log.Write("Token refresh failed: " + error.Message);
                // The stale token is still returned: it may have a minute left, and letting the
                // request try is better than guaranteeing a failure by sending nothing.
                return current.IdToken ?? string.Empty;
            }
        }

        /// <summary>
        /// Resolve an employee ID to an email address, or null when nothing matches.
        /// </summary>
        /// <remarks>
        /// Returns null rather than throwing on a network failure, and the gate turns that into
        /// "try your email address instead" — which is advice somebody can act on, unlike a
        /// transport error.
        /// </remarks>
        public async Task<string> ResolveEmailForEmployeeAsync(string identifier, CancellationToken cancellation)
        {
            try
            {
                ResolveLoginResponse response = await _api
                    .ResolveLoginAsync(identifier, cancellation).ConfigureAwait(false);
                return response == null ? null : response.Email;
            }
            catch (SelApiException error)
            {
                _log.Write("Employee lookup failed: " + error.Message);
                return null;
            }
        }

        /// <summary>
        /// Open a path in the ERP — embedded window where available, browser otherwise.
        /// </summary>
        /// <remarks>
        /// Every caller goes through here: the tray, the morning dashboard's quick links, and a
        /// clicked notification. None of them decides which browser to use, so the choice stays
        /// in one place and a Windows 7 machine behaves correctly without any of them knowing.
        /// </remarks>
        public void OpenErp(string path)
        {
            if (_erpBrowser != null) _erpBrowser.Open(path);
            else _deepLinks.Open(path);
        }

        /// <summary>Open a path in the user's own browser, bypassing the embedded window.</summary>
        public void OpenErpExternally(string path)
        {
            _deepLinks.Open(path);
        }

        /// <summary>
        /// The person closed the embedded ERP window. Not raised when the agent closes it.
        /// </summary>
        /// <remarks>
        /// Subscribed by <see cref="SessionLifecycleController"/>, which locks the workstation
        /// when the policy says that window is the working session.
        /// </remarks>
        public event EventHandler ErpWindowClosedByUser;

        /// <summary>Whether the embedded ERP window is open right now.</summary>
        public bool IsErpWindowOpen { get { return _erpBrowser != null && _erpBrowser.IsOpen; } }

        /// <summary>How the ERP opens on this machine, for the status panel.</summary>
        public string DescribeErpBrowser()
        {
            return _erpBrowser == null ? "Opens in your default browser" : _erpBrowser.Describe();
        }

        /// <summary>
        /// A short-lived Firebase custom token so the embedded window opens already signed in.
        /// </summary>
        /// <remarks>
        /// Returns null rather than throwing when it cannot be obtained. The embedded window
        /// then shows the ERP's own login page, which is a worse experience but a working one —
        /// failing to open the ERP because single sign-on was unavailable would be the wrong
        /// trade entirely.
        /// </remarks>
        public async Task<string> CreateErpSessionTokenAsync()
        {
            try
            {
                string idToken = GetIdTokenBlocking();
                if (string.IsNullOrEmpty(idToken)) return null;

                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20)))
                {
                    ErpSessionResponse response = await _api
                        .CreateErpSessionAsync(idToken, timeout.Token)
                        .ConfigureAwait(false);
                    return response == null ? null : response.CustomToken;
                }
            }
            catch (Exception error)
            {
                _log.Write("Could not obtain an ERP session token: " + error.Message);
                return null;
            }
        }

        /// <summary>
        /// Ask SEL LIVE whether this administrator may close the agent on this computer.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Two steps, both remote: sign the administrator in to Firebase, then present that
        /// token to the server, which checks the permission and records who approved it. The
        /// agent never decides — a monitoring application that granted itself permission to stop
        /// monitoring, on the machine whose user wants it stopped, would be deciding nothing.
        /// </para>
        /// <para>
        /// Nothing about the administrator's session is kept. No refresh token is stored, the
        /// agent's own signed-in user is untouched, and the token is discarded when this method
        /// returns — they approved one action on one PC, not a sign-in.
        /// </para>
        /// <para>
        /// Never throws. Every failure comes back as a sentence for the dialog to show, because
        /// the alternative at this point is an unhandled exception in a modal window.
        /// </para>
        /// </remarks>
        public Task<ExitApprovalOutcome> RequestExitApprovalAsync(
            string email, string password, string reason)
        {
            return RequestExitApprovalAsync(email, password, reason, "EXIT");
        }

        /// <summary>
        /// Ask the Windows service to stop, on the authority of a SEL LIVE administrator.
        /// </summary>
        /// <remarks>
        /// <para>
        /// The one approval this process does <b>not</b> make itself. The service is what holds
        /// the right to stop, so it has to be the one that asks the server — otherwise it would
        /// be taking this process's word for the answer, and this process runs as the very person
        /// whose monitoring is being switched off.
        /// </para>
        /// <para>
        /// So the sign-in happens here, where the window is, and the resulting token goes down
        /// the local pipe. The service calls <c>/api/windows-agent/exit-approval</c> with its own
        /// device credential and stops only if the server says yes.
        /// </para>
        /// </remarks>
        public async Task<ExitApprovalOutcome> RequestServiceStopAsync(
            string email, string password, string reason)
        {
            try
            {
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30)))
                {
                    FirebaseSession session = await _auth
                        .SignInAsync(email, password, timeout.Token)
                        .ConfigureAwait(false);

                    ServiceControlClient.Result result = ServiceControlClient.RequestStop(session.IdToken, reason);

                    _log.Write(result.Ok
                        ? "The SEL LIVE Agent service was stopped after approval by " + email + "."
                        : "The service stop was refused: " + result.Message);

                    return new ExitApprovalOutcome
                    {
                        Approved = result.Ok,
                        // The service knows who approved it; this end only knows who signed in.
                        ApprovedByName = result.Ok ? email : null,
                        Message = result.Ok ? null : result.Message,
                    };
                }
            }
            catch (FirebaseAuthException error)
            {
                _log.Write("Service stop sign-in failed for " + email + ": " + error.Message);
                return new ExitApprovalOutcome { Message = error.Message };
            }
            catch (Exception error)
            {
                _log.Write("Service stop request failed: " + error.Message);
                return new ExitApprovalOutcome { Message = "Could not ask the service to stop: " + error.Message };
            }
        }

        /// <param name="action">
        /// <c>EXIT</c> or <c>UNINSTALL</c>. Both need the same permission; they are recorded
        /// separately because stopping the agent and removing it are different events with
        /// different consequences for the attendance record.
        /// </param>
        public async Task<ExitApprovalOutcome> RequestExitApprovalAsync(
            string email, string password, string reason, string action)
        {
            try
            {
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30)))
                {
                    FirebaseSession session = await _auth
                        .SignInAsync(email, password, timeout.Token)
                        .ConfigureAwait(false);

                    ExitApprovalResponse response = await _api
                        .RequestExitApprovalAsync(session.IdToken, reason, action, timeout.Token)
                        .ConfigureAwait(false);

                    if (response != null && response.Approved)
                    {
                        _log.Write(action + " approved by " + response.ApprovedByName + " (" + email + ").");
                        return new ExitApprovalOutcome
                        {
                            Approved = true,
                            ApprovedByName = response.ApprovedByName,
                        };
                    }

                    _log.Write(action + " refused for " + email + ".");
                    return new ExitApprovalOutcome
                    {
                        Message = action == "UNINSTALL"
                            ? "That account is not allowed to remove the SEL LIVE agent."
                            : "That account is not allowed to close the SEL LIVE agent.",
                    };
                }
            }
            catch (FirebaseAuthException error)
            {
                _log.Write("Exit approval sign-in failed for " + email + ": " + error.Message);
                return new ExitApprovalOutcome { Message = error.Message };
            }
            catch (SelApiException error)
            {
                _log.Write("Exit approval refused (" + error.StatusCode + "): " + error.Message);
                return new ExitApprovalOutcome
                {
                    // 0 is the client's own timeout marker, not a server answer. Worth saying so
                    // plainly: an administrator who cannot tell "you may not" from "I could not
                    // ask" will go looking for the wrong problem.
                    Message = error.StatusCode == 0
                        ? "Could not reach SEL LIVE to check this. The agent keeps running until it can ask."
                        : error.Message,
                };
            }
            catch (Exception error)
            {
                _log.Write("Exit approval failed: " + error.Message);
                return new ExitApprovalOutcome { Message = "Could not check this approval: " + error.Message };
            }
        }

        /* ── Notifications ───────────────────────────────────────────────────────────────── */

        private async void OnNotificationsAvailable(object sender, List<string> ids)
        {
            if (_coordinator.Policy.Settings.NotificationMode == "OFF") return;

            try
            {
                string token = GetIdTokenBlocking();
                if (string.IsNullOrEmpty(token)) return;

                NotificationListResponse response = await _api
                    .FetchNotificationsAsync(token, CancellationToken.None).ConfigureAwait(false);
                if (response == null || response.Notifications == null) return;

                foreach (AgentNotification notification in response.Notifications)
                {
                    // TRAY_ONLY and CRITICAL_ONLY are honoured here rather than in the presenter,
                    // so the receipt still records that the notification reached the machine.
                    if (!ShouldDisplay(notification))
                    {
                        await ReportReceiptAsync(notification.Id, ReceiptStatuses.Displayed, null).ConfigureAwait(false);
                        continue;
                    }

                    bool shown = _notifications.Show(notification);
                    await ReportReceiptAsync(
                        notification.Id,
                        shown ? ReceiptStatuses.Displayed : ReceiptStatuses.Failed,
                        shown ? null : "No notification surface could display it.").ConfigureAwait(false);
                }
            }
            catch (Exception error)
            {
                _log.Write("Notification fetch failed: " + error.Message);
            }
        }

        private bool ShouldDisplay(AgentNotification notification)
        {
            switch (_coordinator.Policy.Settings.NotificationMode)
            {
                case "OFF":
                    return false;
                case "TRAY_ONLY":
                    return false;
                case "CRITICAL_ONLY":
                    return notification.Priority == "CRITICAL" || notification.Priority == "HIGH";
                default:
                    return true;
            }
        }

        private async void OnNotificationOutcome(object sender, NotificationOutcome outcome)
        {
            if (outcome == null) return;

            if (outcome.Status == ReceiptStatuses.Clicked && !string.IsNullOrEmpty(outcome.DeepLink))
            {
                // §23: the exact record, not the dashboard. The launcher validates the path
                // again before handing anything to the shell.
                _deepLinks.Open(outcome.DeepLink);
            }

            await ReportReceiptAsync(outcome.NotificationId, outcome.Status, null, outcome.SnoozeMinutes)
                .ConfigureAwait(false);
        }

        private async Task ReportReceiptAsync(string notificationId, string status, string failureReason,
            int? snoozeMinutes = null)
        {
            if (string.IsNullOrEmpty(notificationId)) return;
            try
            {
                await _api.AcknowledgeNotificationAsync(new NotificationAckRequest
                {
                    NotificationId = notificationId,
                    IdToken = GetIdTokenBlocking(),
                    Status = status,
                    SnoozeMinutes = snoozeMinutes,
                    FailureReason = failureReason
                }, CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception error)
            {
                // A lost receipt costs one row of accuracy on the §39 delivery report. It is not
                // worth retrying — the notification itself was already shown.
                _log.Write("Receipt (" + status + ") could not be delivered: " + error.Message);
            }
        }

        /* ── Directives and updates ──────────────────────────────────────────────────────── */

        private void OnDirectiveReceived(object sender, AgentDirective directive)
        {
            EventHandler<AgentDirective> handler = DirectiveReceived;
            if (handler != null) _dispatcher.BeginInvoke(new Action(() => handler(this, directive)));
        }

        private void OnUpdateAvailable(object sender, AvailableVersion version)
        {
            EventHandler<AvailableVersion> handler = UpdateAvailable;
            if (handler != null) _dispatcher.BeginInvoke(new Action(() => handler(this, version)));
        }

        private void RaiseStatusChanged()
        {
            EventHandler handler = StatusChanged;
            if (handler == null) return;
            if (_dispatcher.CheckAccess()) handler(this, EventArgs.Empty);
            else _dispatcher.BeginInvoke(new Action(() => handler(this, EventArgs.Empty)));
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _notifications.Outcome -= OnNotificationOutcome;
            _erpBrowser.Dispose();
            _coordinator.Dispose();
            _notifications.Dispose();
            _queue.Dispose();
            _api.Dispose();
        }
    }
}
