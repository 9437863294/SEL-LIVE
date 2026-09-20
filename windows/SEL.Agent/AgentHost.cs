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
            _log.Write("Notification surface: " + _notifications.DescribeSelection());
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
                return true;
            }
            catch (SelApiException error)
            {
                _log.Write("Enrolment failed: " + error.Message);
                return false;
            }
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

        /// <summary>Open a path in the ERP. Validated against the configured origin first.</summary>
        public void OpenErp(string path)
        {
            _deepLinks.Open(path);
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
            _coordinator.Dispose();
            _notifications.Dispose();
            _queue.Dispose();
            _api.Dispose();
        }
    }
}
