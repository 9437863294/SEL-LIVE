using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Security;
using Sel.Agent.Core.Storage;

namespace Sel.Agent.Service
{
    /// <summary>
    /// The SEL LIVE Agent service (§46).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>What the service is for, and what it deliberately is not.</b> It would be natural to
    /// assume the service does the tracking and the desktop app is a thin UI. It is the other way
    /// round, and the reason is Windows' session isolation: a service runs in session 0, where
    /// <c>GetForegroundWindow</c> sees nothing, <c>GetLastInputInfo</c> fails, and there is no
    /// desktop to watch. Every measurement the agent makes has to happen inside the user's own
    /// session, so the desktop process does the measuring.
    /// </para>
    /// <para>
    /// What is left for the service is the work that must survive the user closing things:
    /// </para>
    /// <list type="bullet">
    /// <item><description>
    /// <b>Making sure the agent is running.</b> Checked every thirty seconds in every active
    /// session. §26 asks that an employee not be able to stop tracking during a mandatory
    /// session; a tray application alone cannot promise that, because Task Manager exists. A
    /// service running as LocalSystem that restarts it within half a minute can.
    /// <para>
    /// The agent is normally started by the <c>SEL LIVE Agent</c> scheduled task at sign-in —
    /// see <see cref="LogonTask"/> — and this is the second line rather than the first. Both
    /// exist because they cover different failures: the task cannot bring the agent back when
    /// somebody ends it from Task Manager, and the watchdog cannot be as fast as a logon trigger.
    /// </para>
    /// </description></item>
    /// <item><description>
    /// <b>Multi-session support.</b> On a machine with fast user switching or RDP, each signed-in
    /// user needs their own agent. The service is the only component that can see all of them.
    /// </description></item>
    /// <item><description>
    /// <b>Housekeeping.</b> Pruning the offline queue (§51's local half) needs to happen whether
    /// or not anybody is signed in.
    /// </description></item>
    /// </list>
    ///
    /// <para><b>Restarting backs off, and never stops.</b></para>
    /// <para>
    /// If the agent cannot start — a corrupt configuration, a missing dependency — an
    /// unthrottled watchdog would relaunch it every half minute for ever, filling the event log
    /// and flashing a window at the user all day. So the interval stretches after three
    /// failures, to two minutes and then ten; see the fields below for why it stretches rather
    /// than stopping, which is what it used to do.
    /// </para>
    /// </remarks>
    public sealed class SelAgentService : ServiceBase
    {
        internal const string ServiceNameConstant = "SELLiveAgent";
        private const string AgentProcessName = "SEL.Agent";
        private const string AgentExecutable = "SEL.Agent.exe";

        /// <summary>
        /// How often the agent is checked, and how soon after the service starts.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Thirty seconds rather than a minute, and the first check after three rather than ten.
        /// Both numbers are what somebody experiences: the first is how long tracking stops for
        /// when the agent is killed from Task Manager, and the second is how long after a restart
        /// the agent takes to appear — which, now that the service is the only thing that starts
        /// it, is the whole of the answer to "why does it take so long to come up?".
        /// </para>
        /// <para>
        /// The cost is one process enumeration per active session every thirty seconds, which is
        /// nothing next to what it buys.
        /// </para>
        /// </remarks>
        private static readonly TimeSpan WatchdogInterval = TimeSpan.FromSeconds(30);
        private static readonly TimeSpan FirstWatchdogCheck = TimeSpan.FromSeconds(3);

        private static readonly TimeSpan HousekeepingInterval = TimeSpan.FromHours(6);

        /// <summary>
        /// Back off after repeated failures — but never stop trying.
        /// </summary>
        /// <remarks>
        /// <para>
        /// The previous version gave up on a session for ten minutes after three failed launches.
        /// That was the right instinct — an agent crashing on start-up must not be relaunched
        /// every minute for ever — and the wrong number, because those ten minutes are ten
        /// minutes of a PC recording nothing, repeated all day, on precisely the machines that
        /// are already broken.
        /// </para>
        /// <para>
        /// Now the interval stretches instead: after the third failure a session is retried every
        /// two minutes, then every ten, and it stays at ten. A machine that can be fixed by
        /// retrying is fixed within two minutes; a machine that cannot costs six log entries an
        /// hour instead of sixty.
        /// </para>
        /// </remarks>
        private const int FailuresBeforeBackoff = 3;
        private static readonly TimeSpan ShortBackoff = TimeSpan.FromMinutes(2);
        private static readonly TimeSpan LongBackoff = TimeSpan.FromMinutes(10);
        private const int FailuresBeforeLongBackoff = 8;

        private Timer _watchdog;
        private Timer _housekeeping;
        private Timer _security;
        private ControlPipe _controlPipe;
        private AgentUpdater _updater;
        private int _securitySyncRunning;
        private DateTime _maintenanceExpiresUtc = DateTime.MinValue;
        private bool _maintenanceAllowsTaskManager;
        private readonly object _gate = new object();
        private readonly System.Collections.Generic.Dictionary<uint, LaunchRecord> _launches =
            new System.Collections.Generic.Dictionary<uint, LaunchRecord>();

        private sealed class LaunchRecord
        {
            public int Failures;
            /// <summary>When the next attempt is allowed. Always set; never "never".</summary>
            public DateTime NextAttemptUtc;
        }

        public SelAgentService()
        {
            ServiceName = ServiceNameConstant;
            CanHandleSessionChangeEvent = true;
            CanShutdown = true;
            CanStop = true;
            AutoLog = false;
        }

        protected override void OnStart(string[] args)
        {
            Log("Service starting. " + OsCompatibility.Current.Describe());

            if (!OsCompatibility.Current.IsSupported)
            {
                Log(OsCompatibility.Current.UnsupportedReason, EventLogEntryType.Error);
                // Stop rather than run uselessly: a service that starts and does nothing is
                // harder to diagnose than one that refuses with a reason.
                Stop();
                return;
            }

            if (!DpapiProtector.SelfTest())
            {
                Log("DPAPI is not working on this machine. The device credential cannot be read, "
                    + "so the agent will be unable to authenticate. This usually means the machine "
                    + "was cloned without sysprep.", EventLogEntryType.Error);
            }

            _watchdog = new Timer(OnWatchdog, null, FirstWatchdogCheck, WatchdogInterval);
            _housekeeping = new Timer(OnHousekeeping, null, TimeSpan.FromMinutes(2), HousekeepingInterval);
            // Security starts fail-closed, then asks SEL LIVE whether a bounded maintenance
            // exception is active. The locally cached expiry restores the lock without a network.
            _security = new Timer(OnSecuritySync, null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(60));

            // The only way to stop this service once its descriptor is hardened. See ControlPipe
            // for why the decision is the server's and not the caller's.
            _controlPipe = new ControlPipe(ApproveServiceStop, Stop, message => Log(message));
            _controlPipe.Start();

            // §43's automatic update. The policy that governs it — autoUpdateEnabled — is applied
            // by the version route, which is the only side of this with a policy to read: this
            // service has no user session and so no way to fetch one. See the note there.
            _updater = new AgentUpdater(() => true, Log);
            _updater.Start();
        }

        protected override void OnStop()
        {
            Log("Service stopping.");
            if (_watchdog != null) { _watchdog.Dispose(); _watchdog = null; }
            if (_housekeeping != null) { _housekeeping.Dispose(); _housekeeping = null; }
            if (_security != null) { _security.Dispose(); _security = null; }
            if (_controlPipe != null) { _controlPipe.Dispose(); _controlPipe = null; }
            if (_updater != null) { _updater.Dispose(); _updater = null; }
        }

        /// <summary>
        /// Ask SEL LIVE whether the holder of this token may stop the service.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Runs as SYSTEM, which is what makes it possible at all: the device credential is
        /// DPAPI-protected at machine scope, so the service can read it without a user session
        /// and prove to the server which computer is asking. The approver's token proves who is
        /// asking for it.
        /// </para>
        /// <para>
        /// Returns false on any failure, including an unreachable server. A service that stopped
        /// itself because it could not check would be a service anybody could stop by pulling the
        /// network cable.
        /// </para>
        /// </remarks>
        private bool ApproveServiceStop(string approverIdToken, string reason)
        {
            AgentConfigurationProbe config = AgentConfigurationProbe.Load();
            if (!config.Found || string.IsNullOrEmpty(config.ApiBaseUrl))
            {
                Log("A service stop was requested but this computer has no configuration to ask with.",
                    EventLogEntryType.Warning);
                return false;
            }

            var identity = new DeviceIdentityStore();
            DeviceIdentity device = identity.Read();
            string secret = identity.ReadSecret();
            if (device == null || string.IsNullOrEmpty(secret))
            {
                Log("A service stop was requested but this computer is not enrolled, so there is "
                    + "nobody to ask.", EventLogEntryType.Warning);
                return false;
            }

            try
            {
                using (var client = new Core.Api.SelLiveApiClient(config.ApiBaseUrl, Core.AgentVersion.Current))
                {
                    client.DeviceId = device.DeviceId;
                    client.DeviceSecret = secret;

                    using (var timeout = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(30)))
                    {
                        Core.Api.ExitApprovalResponse response = client
                            .RequestExitApprovalAsync(approverIdToken, reason, "SERVICE_STOP", timeout.Token)
                            .GetAwaiter()
                            .GetResult();

                        if (response != null && response.Approved)
                        {
                            Log("Service stop approved by " + response.ApprovedByName + ".");
                            return true;
                        }
                    }
                }
            }
            catch (Core.Contracts.SelApiException error)
            {
                Log("Service stop refused (" + error.StatusCode + "): " + error.Message,
                    EventLogEntryType.Warning);
                return false;
            }
            catch (Exception error)
            {
                Log("Service stop approval failed: " + error.Message, EventLogEntryType.Warning);
                return false;
            }

            return false;
        }

        protected override void OnShutdown()
        {
            // Nothing to flush here: the desktop agent owns the work session and closes it from
            // its own WM_ENDSESSION handler, which Windows delivers before it stops services.
            Log("Machine is shutting down.");
            base.OnShutdown();
        }

        /// <summary>
        /// A user signed in, unlocked, or connected.
        /// </summary>
        /// <remarks>
        /// <c>SessionLogon</c> is the one that matters; the others are belt and braces for the
        /// RDP reconnect case, where a session that was disconnected comes back and the agent
        /// may have been killed in between. The failure counter is cleared on logon so a user
        /// who signs out and back in gets a fresh set of attempts — the previous failures were
        /// about a session that no longer exists.
        /// </remarks>
        protected override void OnSessionChange(SessionChangeDescription change)
        {
            base.OnSessionChange(change);
            var sessionId = (uint)change.SessionId;

            switch (change.Reason)
            {
                case SessionChangeReason.SessionLogon:
                case SessionChangeReason.RemoteConnect:
                case SessionChangeReason.ConsoleConnect:
                    lock (_gate) { _launches.Remove(sessionId); }
                    // A short delay: the shell is still starting, and an agent launched into a
                    // half-built desktop can fail to place its tray icon.
                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        Thread.Sleep(4000);
                        OnSecuritySync(null);
                        EnsureAgentInSession(sessionId);
                    });
                    break;

                case SessionChangeReason.SessionLogoff:
                    lock (_gate) { _launches.Remove(sessionId); }
                    break;
            }
        }

        private void OnWatchdog(object state)
        {
            try
            {
                foreach (uint sessionId in SessionLauncher.ActiveUserSessions())
                {
                    EnsureAgentInSession(sessionId);
                }
            }
            catch (Exception error)
            {
                Log("Watchdog failed: " + error.Message, EventLogEntryType.Warning);
            }
        }

        private void EnsureAgentInSession(uint sessionId)
        {
            if (SessionLauncher.IsAgentRunningInSession(sessionId, AgentProcessName))
            {
                // Running again: forget the failures, so a machine that has recovered is not
                // still on a ten-minute backoff an hour later.
                lock (_gate) { _launches.Remove(sessionId); }
                return;
            }

            LaunchRecord record;
            lock (_gate)
            {
                if (!_launches.TryGetValue(sessionId, out record))
                {
                    record = new LaunchRecord { NextAttemptUtc = DateTime.UtcNow };
                    _launches[sessionId] = record;
                }

                if (DateTime.UtcNow < record.NextAttemptUtc) return;
            }

            string path = AgentExecutablePath();
            if (path == null)
            {
                Log("Cannot find " + AgentExecutable + " next to the service.", EventLogEntryType.Error);
                lock (_gate) { record.NextAttemptUtc = DateTime.UtcNow.Add(LongBackoff); }
                return;
            }

            int pid = SessionLauncher.LaunchInSession(sessionId, path, message => Log(message));
            if (pid != 0)
            {
                lock (_gate) { _launches.Remove(sessionId); }
                return;
            }

            lock (_gate)
            {
                record.Failures++;
                TimeSpan wait = record.Failures < FailuresBeforeBackoff
                    ? WatchdogInterval
                    : record.Failures < FailuresBeforeLongBackoff ? ShortBackoff : LongBackoff;
                record.NextAttemptUtc = DateTime.UtcNow.Add(wait);

                // Logged once when the backoff first stretches, not on every attempt: the launch
                // itself already logs a line each time, with the exit code.
                if (record.Failures == FailuresBeforeBackoff || record.Failures == FailuresBeforeLongBackoff)
                {
                    Log("The desktop agent has failed to start in session " + sessionId + " "
                        + record.Failures + " times; retrying every " + wait.TotalMinutes
                        + " minutes now. The exit code in the entries above says whether the agent "
                        + "chose to exit or Windows stopped it.", EventLogEntryType.Warning);
                }
            }
        }

        /// <summary>
        /// Prune the local queue.
        /// </summary>
        /// <remarks>
        /// Runs in the service rather than the agent because it should happen on a machine
        /// nobody has signed in to for a month — which is exactly the machine whose queue is
        /// most likely to be full of spans the server has already purged under §51.
        /// </remarks>
        private void OnHousekeeping(object state)
        {
            try
            {
                using (var queue = new SqliteOfflineQueue())
                {
                    // Matches the shortest retention an administrator can configure server-side.
                    // Keeping local copies longer than the server would keep them achieves
                    // nothing except filling a disk.
                    int removed = queue.Prune(TimeSpan.FromDays(30));
                    if (removed > 0) Log("Pruned " + removed + " expired activity records from the local queue.");
                }
            }
            catch (Exception error)
            {
                Log("Housekeeping failed: " + error.Message, EventLogEntryType.Warning);
            }
        }

        /// <summary>
        /// Re-apply the device baseline, report posture, and consume an expiring maintenance grant.
        /// </summary>
        private void OnSecuritySync(object state)
        {
            if (Interlocked.Exchange(ref _securitySyncRunning, 1) != 0) return;
            try
            {
                TemporaryLocalAdmin.EnforceCachedExpiry(DateTime.UtcNow,
                    message => Log(message, EventLogEntryType.Warning));
                bool maintenanceActive = _maintenanceAllowsTaskManager
                    && _maintenanceExpiresUtc > DateTime.UtcNow;
                if (_maintenanceAllowsTaskManager && !maintenanceActive)
                {
                    _maintenanceAllowsTaskManager = false;
                    _maintenanceExpiresUtc = DateTime.MinValue;
                    Log("The maintenance window expired; Task Manager has been locked again.");
                }

                DeviceSecurityPolicy currentPolicy = DeviceSecurityPolicyStore.Read();
                DeviceSecurityPosture posture = DeviceSecurityEnforcer.EnforceAndInspect(
                    currentPolicy, maintenanceActive, message => Log(message, EventLogEntryType.Warning));

                AgentConfigurationProbe config = AgentConfigurationProbe.Load();
                if (!config.Found || string.IsNullOrEmpty(config.ApiBaseUrl)) return;

                var identityStore = new DeviceIdentityStore();
                DeviceIdentity identity = identityStore.Read();
                string secret = identityStore.ReadSecret();
                if (identity == null || string.IsNullOrEmpty(secret)) return;

                using (var client = new Core.Api.SelLiveApiClient(config.ApiBaseUrl, Core.AgentVersion.Current))
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30)))
                {
                    client.DeviceId = identity.DeviceId;
                    client.DeviceSecret = secret;
                    DeviceSecuritySyncResponse response = client
                        .SyncDeviceSecurityAsync(posture, timeout.Token)
                        .GetAwaiter()
                        .GetResult();

                    DeviceSecurityPolicy nextPolicy = response != null && response.Policy != null
                        ? response.Policy
                        : currentPolicy;
                    DeviceSecurityPolicyStore.Write(nextPolicy);

                    bool nextAllowed = false;
                    DateTime nextExpiry = DateTime.MinValue;
                    if (response != null && response.Maintenance != null
                        && string.Equals(response.Maintenance.Status, "ACTIVE", StringComparison.OrdinalIgnoreCase)
                        && response.Maintenance.AllowTaskManager)
                    {
                        nextExpiry = IsoTime.Parse(response.Maintenance.ExpiresAt);
                        nextAllowed = nextExpiry > DateTime.UtcNow;
                    }

                    bool changed = nextAllowed != _maintenanceAllowsTaskManager
                        || nextExpiry != _maintenanceExpiresUtc;
                    _maintenanceAllowsTaskManager = nextAllowed;
                    _maintenanceExpiresUtc = nextAllowed ? nextExpiry : DateTime.MinValue;

                    if (nextAllowed && response.Maintenance.TemporaryLocalAdmin
                        && !string.IsNullOrEmpty(response.Maintenance.WindowsAccount))
                    {
                        TemporaryLocalAdmin.Apply(response.Maintenance.WindowsAccount, nextExpiry,
                            message => Log(message));
                    }
                    else
                    {
                        TemporaryLocalAdmin.Revoke(message => Log(message, EventLogEntryType.Warning));
                    }

                    if (changed)
                    {
                        Log(nextAllowed
                            ? "SEL LIVE opened Task Manager for approved maintenance until "
                                + nextExpiry.ToLocalTime().ToString("g") + "."
                            : "SEL LIVE closed maintenance access; Task Manager is locked.");
                        // Apply the new answer immediately instead of waiting another minute.
                        DeviceSecurityEnforcer.EnforceAndInspect(nextPolicy, nextAllowed,
                            message => Log(message, EventLogEntryType.Warning));
                    }
                    else
                    {
                        // A persistent policy change must apply immediately even when maintenance
                        // state did not change.
                        DeviceSecurityEnforcer.EnforceAndInspect(nextPolicy, nextAllowed,
                            message => Log(message, EventLogEntryType.Warning));
                    }
                }
            }
            catch (Exception error)
            {
                // Fail closed. An already-issued grant remains valid only until its local expiry;
                // no reply can create or extend one.
                Log("Device security sync failed; the local baseline remains in force: " + error.Message,
                    EventLogEntryType.Warning);
            }
            finally
            {
                Interlocked.Exchange(ref _securitySyncRunning, 0);
            }
        }

        private static string AgentExecutablePath()
        {
            string directory = Path.GetDirectoryName(typeof(SelAgentService).Assembly.Location);
            if (string.IsNullOrEmpty(directory)) return null;
            string candidate = Path.Combine(directory, AgentExecutable);
            return File.Exists(candidate) ? candidate : null;
        }

        /// <summary>
        /// Write to the Windows event log, falling back to a file.
        /// </summary>
        /// <remarks>
        /// The event log is the right place for service diagnostics — it is where an
        /// administrator looks and it survives a reinstall. The file fallback exists because
        /// creating an event source needs elevation: the installer creates it, but a service
        /// started before that completed, or copied onto a machine by hand, would otherwise
        /// throw on its first log line and fail to start.
        /// </remarks>
        internal static void Log(string message, EventLogEntryType level = EventLogEntryType.Information)
        {
            try
            {
                EventLog.WriteEntry(ServiceNameConstant, message, level);
                return;
            }
            catch (Exception)
            {
                // Fall through to the file.
            }

            try
            {
                string path = Path.Combine(DeviceIdentityStore.DefaultDirectory, "service.log");
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.AppendAllText(path,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  [" + level + "]  " + message + Environment.NewLine);
            }
            catch (Exception)
            {
                // Nowhere left to report to. Silence beats crashing the service over a log line.
            }
        }
    }
}
