using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading;
using Sel.Agent.Core;
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
    /// <b>Making sure the agent is running.</b> Started at every sign-in and checked every
    /// minute. §26 asks that an employee not be able to stop tracking during a mandatory
    /// session; a tray application alone cannot promise that, because Task Manager exists. A
    /// service running as LocalSystem that restarts it within a minute can.
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
    /// <para><b>Restarting is rate-limited, and that is not a detail.</b></para>
    /// <para>
    /// If the agent crashes on start-up — a corrupt configuration, a missing dependency — an
    /// unthrottled watchdog would relaunch it every minute for ever, filling the event log and
    /// flashing a window at the user all day. After three failures in ten minutes the service
    /// stops trying for that session and logs why, leaving a machine that is quietly broken
    /// rather than loudly broken, and a log line that says which.
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
        }

        protected override void OnStop()
        {
            Log("Service stopping.");
            if (_watchdog != null) { _watchdog.Dispose(); _watchdog = null; }
            if (_housekeeping != null) { _housekeeping.Dispose(); _housekeeping = null; }
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
