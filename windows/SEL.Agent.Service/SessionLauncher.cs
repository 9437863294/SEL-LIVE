using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Sel.Agent.Service
{
    /// <summary>
    /// Starts the desktop agent inside a user's interactive session, from session 0.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the part of §46 that cannot be done with <see cref="Process.Start"/>. A Windows
    /// service runs in session 0, which since Windows Vista has been isolated from every
    /// interactive desktop — a process started normally from a service gets no window station, so
    /// its windows exist nowhere and its tray icon appears to nobody. Launching into a user's
    /// session needs the user's own token, and that is what this class obtains.
    /// </para>
    ///
    /// <para><b>The sequence, and why each step is needed.</b></para>
    /// <list type="number">
    /// <item><description>
    /// <c>WTSGetActiveConsoleSessionId</c> / <c>WTSEnumerateSessions</c> finds sessions with
    /// somebody signed in. Both are used: the console session covers the ordinary case, and
    /// enumeration covers RDP and fast user switching, where more than one person is signed in
    /// at once and each needs their own agent.
    /// </description></item>
    /// <item><description>
    /// <c>WTSQueryUserToken</c> gets that session's token. It requires SE_TCB_NAME, which
    /// LocalSystem holds and no lesser account does — which is why the service runs as
    /// LocalSystem and why this cannot be done from the agent itself.
    /// </description></item>
    /// <item><description>
    /// <c>DuplicateTokenEx</c> to a primary token, because <c>WTSQueryUserToken</c> returns an
    /// impersonation token and <c>CreateProcessAsUser</c> will not accept one.
    /// </description></item>
    /// <item><description>
    /// <c>CreateEnvironmentBlock</c> so the agent sees the user's environment — most importantly
    /// their own <c>%LOCALAPPDATA%</c>, which is where the DPAPI-protected refresh token lives.
    /// Skip this and the agent runs with the service's environment and cannot find the session
    /// it is supposed to resume.
    /// </description></item>
    /// <item><description>
    /// <c>CreateProcessAsUser</c> with <c>lpDesktop = "winsta0\\default"</c>, which is the
    /// interactive desktop. Omitting it is the classic mistake: the call succeeds, the process
    /// starts, and nothing is ever visible.
    /// </description></item>
    /// </list>
    ///
    /// <para><b>What it does not do.</b></para>
    /// <para>
    /// It never elevates. The token is the user's own, unmodified, so the agent runs with exactly
    /// the rights that user has — a standard employee's agent is a standard-privilege process.
    /// A service that launched an elevated child into a user's desktop would be handing every
    /// employee a privilege-escalation primitive.
    /// </para>
    /// </remarks>
    internal static class SessionLauncher
    {
        /// <summary>
        /// How long a freshly launched agent is given to still be alive before it counts as
        /// having failed to start. Long enough for the CLR and WPF; short enough not to matter
        /// on a sixty-second watchdog.
        /// </summary>
        private static readonly TimeSpan StartupGrace = TimeSpan.FromSeconds(3);

        private const int TOKEN_DUPLICATE = 0x0002;
        private const int TOKEN_QUERY = 0x0008;
        private const int TOKEN_ASSIGN_PRIMARY = 0x0001;
        private const int TOKEN_ADJUST_DEFAULT = 0x0080;
        private const int TOKEN_ADJUST_SESSIONID = 0x0100;
        private const int MAXIMUM_ALLOWED = 0x2000000;

        private const int CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const int CREATE_NEW_CONSOLE = 0x00000010;
        private const int NORMAL_PRIORITY_CLASS = 0x00000020;

        /// <summary>
        /// Leave the service's job object behind.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Windows puts service processes in job objects, and a child created without this flag
        /// joins its parent's job. The agent then lives or dies by limits set for a session-0
        /// service — and on this machine it died: the process was created, vanished within about
        /// sixty milliseconds, never got as far as creating its own single-instance mutex, and
        /// left no crash report, because a job kill is not a user-mode exception.
        /// </para>
        /// <para>
        /// The symptom was three launches a minute apart, each logged as "started ... but exited
        /// within 3s", for weeks. Nothing was wrong with the agent: it started perfectly when
        /// Explorer launched it from the Run key, which is why nobody caught it.
        /// </para>
        /// <para>
        /// A job may forbid breakaway, in which case <c>CreateProcessAsUser</c> fails with
        /// ERROR_ACCESS_DENIED rather than ignoring the flag — so the launch is retried without
        /// it. Failing outright would be worse than the behaviour being replaced.
        /// </para>
        /// </remarks>
        private const int CREATE_BREAKAWAY_FROM_JOB = 0x01000000;

        private const int ERROR_ACCESS_DENIED = 5;
        private const uint WAIT_TIMEOUT = 0x00000102;

        private enum SecurityImpersonationLevel { SecurityImpersonation = 2 }
        private enum TokenType { TokenPrimary = 1 }

        private enum WtsConnectState
        {
            Active = 0,
            Connected = 1,
            ConnectQuery = 2,
            Shadow = 3,
            Disconnected = 4,
            Idle = 5,
            Listen = 6,
            Reset = 7,
            Down = 8,
            Init = 9
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct StartupInfo
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public short wShowWindow, cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput, hStdOutput, hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInformation
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SecurityAttributes
        {
            public int nLength;
            public IntPtr lpSecurityDescriptor;
            public bool bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct WtsSessionInfo
        {
            public int SessionId;
            [MarshalAs(UnmanagedType.LPWStr)] public string pWinStationName;
            public WtsConnectState State;
        }

        [DllImport("kernel32.dll")]
        private static extern uint WTSGetActiveConsoleSessionId();

        [DllImport("wtsapi32.dll", SetLastError = true)]
        private static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version,
            ref IntPtr sessionInfo, ref int count);

        [DllImport("wtsapi32.dll")]
        private static extern void WTSFreeMemory(IntPtr memory);

        [DllImport("wtsapi32.dll", SetLastError = true)]
        private static extern bool WTSQueryUserToken(uint sessionId, out IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool DuplicateTokenEx(IntPtr existingToken, uint desiredAccess,
            ref SecurityAttributes attributes, SecurityImpersonationLevel impersonationLevel,
            TokenType tokenType, out IntPtr newToken);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessAsUser(IntPtr token, string applicationName,
            string commandLine, ref SecurityAttributes processAttributes,
            ref SecurityAttributes threadAttributes, bool inheritHandles, int creationFlags,
            IntPtr environment, string currentDirectory, ref StartupInfo startupInfo,
            out ProcessInformation processInformation);

        [DllImport("userenv.dll", SetLastError = true)]
        private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);

        [DllImport("userenv.dll", SetLastError = true)]
        private static extern bool DestroyEnvironmentBlock(IntPtr environment);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

        /// <summary>Every session with somebody signed in and a desktop to draw on.</summary>
        internal static List<uint> ActiveUserSessions()
        {
            var sessions = new List<uint>();

            IntPtr buffer = IntPtr.Zero;
            int count = 0;
            try
            {
                if (WTSEnumerateSessions(IntPtr.Zero, 0, 1, ref buffer, ref count))
                {
                    int size = Marshal.SizeOf(typeof(WtsSessionInfo));
                    for (int index = 0; index < count; index++)
                    {
                        IntPtr entry = new IntPtr(buffer.ToInt64() + index * size);
                        var info = (WtsSessionInfo)Marshal.PtrToStructure(entry, typeof(WtsSessionInfo));

                        // Session 0 is the service session and has no desktop. Disconnected RDP
                        // sessions are included deliberately: the user is still signed in, the
                        // agent should still be recording lock state, and it will report LOCKED.
                        if (info.SessionId == 0) continue;
                        if (info.State != WtsConnectState.Active && info.State != WtsConnectState.Disconnected) continue;
                        sessions.Add((uint)info.SessionId);
                    }
                }
            }
            catch (Exception)
            {
                // Terminal Services can be unavailable on a stripped-down install. Fall through
                // to the console session, which is the only one that matters on a desktop PC.
            }
            finally
            {
                if (buffer != IntPtr.Zero) WTSFreeMemory(buffer);
            }

            if (sessions.Count == 0)
            {
                uint console = WTSGetActiveConsoleSessionId();
                // 0xFFFFFFFF means no session is attached to the console — a machine at the
                // lock screen during a fast-user-switch, or one with no monitor.
                if (console != 0xFFFFFFFF && console != 0) sessions.Add(console);
            }

            return sessions;
        }

        /// <summary>
        /// Launch <paramref name="executablePath"/> in <paramref name="sessionId"/> as that
        /// session's user.
        /// </summary>
        /// <returns>The new process id, or 0 if it could not be started.</returns>
        internal static int LaunchInSession(uint sessionId, string executablePath, Action<string> log)
        {
            IntPtr userToken = IntPtr.Zero;
            IntPtr primaryToken = IntPtr.Zero;
            IntPtr environment = IntPtr.Zero;

            try
            {
                if (!WTSQueryUserToken(sessionId, out userToken))
                {
                    // Expected at the lock screen and between sign-out and sign-in; logged at a
                    // low level rather than treated as a failure, because the watchdog retries.
                    log("No user token for session " + sessionId + " (" + Marshal.GetLastWin32Error() + ").");
                    return 0;
                }

                var attributes = new SecurityAttributes();
                attributes.nLength = Marshal.SizeOf(typeof(SecurityAttributes));

                if (!DuplicateTokenEx(userToken,
                        TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_SESSIONID | MAXIMUM_ALLOWED,
                        ref attributes, SecurityImpersonationLevel.SecurityImpersonation,
                        TokenType.TokenPrimary, out primaryToken))
                {
                    log("DuplicateTokenEx failed for session " + sessionId + " (" + Marshal.GetLastWin32Error() + ").");
                    return 0;
                }

                // Without the user's environment block the agent looks for its saved session in
                // the service account's LOCALAPPDATA and never finds it.
                if (!CreateEnvironmentBlock(out environment, primaryToken, false))
                {
                    log("CreateEnvironmentBlock failed; continuing with the service environment.");
                    environment = IntPtr.Zero;
                }

                var startup = new StartupInfo();
                startup.cb = Marshal.SizeOf(typeof(StartupInfo));
                // The interactive desktop. Omit this and the process starts invisibly.
                startup.lpDesktop = @"winsta0\default";

                var threadAttributes = new SecurityAttributes();
                threadAttributes.nLength = Marshal.SizeOf(typeof(SecurityAttributes));

                ProcessInformation processInfo;
                int flags = NORMAL_PRIORITY_CLASS | CREATE_UNICODE_ENVIRONMENT | CREATE_BREAKAWAY_FROM_JOB;
                // Explicitly *not* CREATE_NEW_CONSOLE: a WPF application given a console shows a
                // stray black window for a moment on start-up, which looks like a fault.
                flags &= ~CREATE_NEW_CONSOLE;

                string workingDirectory = System.IO.Path.GetDirectoryName(executablePath);

                bool started = CreateProcessAsUser(
                    primaryToken, executablePath, null, ref attributes, ref threadAttributes,
                    false, flags, environment, workingDirectory, ref startup, out processInfo);

                if (!started && Marshal.GetLastWin32Error() == ERROR_ACCESS_DENIED)
                {
                    // This job forbids breakaway. Try again inside it: the agent then inherits
                    // the service's job limits, which is what it did before this flag was added,
                    // and is better than not starting at all.
                    log("Breakaway from the service's job object was refused; launching inside it.");
                    flags &= ~CREATE_BREAKAWAY_FROM_JOB;
                    started = CreateProcessAsUser(
                        primaryToken, executablePath, null, ref attributes, ref threadAttributes,
                        false, flags, environment, workingDirectory, ref startup, out processInfo);
                }

                if (!started)
                {
                    log("CreateProcessAsUser failed for session " + sessionId + " (" + Marshal.GetLastWin32Error() + ").");
                    return 0;
                }

                CloseHandle(processInfo.hThread);

                // Did it survive, and if not, why?
                //
                // CreateProcessAsUser returning a pid means Windows created a process, not that
                // the application ran. An agent that exits during start-up leaves this method
                // reporting success every minute while nothing is running, which in the event
                // log is indistinguishable from working properly — precisely the shape of
                // failure this service exists to notice.
                //
                // The process handle is kept for the grace period so the exit *code* can be
                // read, because that single number is the difference between a diagnosis and a
                // guess: 0 means the agent chose to exit and its own log will say why, while
                // 0xC000_0000-something means Windows killed it and no amount of reading the
                // agent's log will help. The previous version closed the handle immediately and
                // then speculated in the event log about which had happened.
                try
                {
                    uint wait = WaitForSingleObject(processInfo.hProcess, (uint)StartupGrace.TotalMilliseconds);
                    if (wait == WAIT_TIMEOUT)
                    {
                        log("Started the desktop agent in session " + sessionId + " (pid " + processInfo.dwProcessId + ").");
                        return processInfo.dwProcessId;
                    }

                    uint exitCode;
                    string code = GetExitCodeProcess(processInfo.hProcess, out exitCode)
                        ? "0x" + exitCode.ToString("X8") + " (" + exitCode + ")"
                        : "unavailable";

                    log("Started the desktop agent in session " + sessionId + " (pid "
                        + processInfo.dwProcessId + ") but it exited within "
                        + StartupGrace.TotalSeconds + "s with exit code " + code + ". "
                        + DescribeEarlyExit(exitCode));
                    return 0;
                }
                finally
                {
                    CloseHandle(processInfo.hProcess);
                }
            }
            catch (Exception error)
            {
                log("Launch into session " + sessionId + " failed: " + error.Message);
                return 0;
            }
            finally
            {
                if (environment != IntPtr.Zero) DestroyEnvironmentBlock(environment);
                if (primaryToken != IntPtr.Zero) CloseHandle(primaryToken);
                if (userToken != IntPtr.Zero) CloseHandle(userToken);
            }
        }

        /// <summary>
        /// Turn an early exit code into the next thing to check.
        /// </summary>
        /// <remarks>
        /// Written for whoever reads the event log on a machine that is not reporting, which is
        /// usually somebody with one PC in front of them and no debugger. The three cases behave
        /// completely differently and used to be described by one sentence that guessed.
        /// </remarks>
        private static string DescribeEarlyExit(uint exitCode)
        {
            if (exitCode == 0)
            {
                return "Exit code 0 means the agent shut itself down deliberately — another copy "
                    + "already running, or a configuration it could not use. "
                    + "%ProgramData%\\SEL LIVE\\Agent\\startup.log records which.";
            }
            if (exitCode > 0xC0000000)
            {
                return "A code in the 0xC0000000 range means Windows terminated it rather than the "
                    + "agent exiting: a job-object limit, a blocked executable, or a missing "
                    + "dependency. Nothing will appear in the agent's own log, because it never ran.";
            }
            return "A non-zero exit code below the Windows range comes from the agent itself; "
                + "%ProgramData%\\SEL LIVE\\Agent\\startup.log records the reason.";
        }

        /// <summary>Whether the agent is already running in this session.</summary>
        /// <remarks>
        /// Checked by session id rather than by process name alone, because on an RDP host two
        /// users legitimately have one agent each and a name-only check would leave the second
        /// user without one.
        /// </remarks>
        internal static bool IsAgentRunningInSession(uint sessionId, string processName)
        {
            try
            {
                foreach (Process process in Process.GetProcessesByName(processName))
                {
                    using (process)
                    {
                        if ((uint)process.SessionId == sessionId) return true;
                    }
                }
            }
            catch (Exception)
            {
                // Enumerating processes can fail transiently during shutdown. Reporting "not
                // running" would start a duplicate; reporting "running" merely delays one cycle.
                return true;
            }
            return false;
        }
    }
}
