using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Sel.Agent.Core.Tracking;

namespace Sel.Agent.Core.Platform.Win32
{
    /// <summary>
    /// Watches the foreground window using <c>SetWinEventHook</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// §8 asks for event hooks rather than polling, and §53 asks the agent to stay light. Both
    /// point at the same API: <c>SetWinEventHook</c> with <c>EVENT_SYSTEM_FOREGROUND</c> calls
    /// back only when focus actually moves, so an agent watching all day costs a handful of
    /// callbacks rather than a process enumeration every few seconds. The alternative — polling
    /// <c>GetForegroundWindow</c> at 1 Hz — would both burn CPU on four hundred machines and
    /// still miss a window that was focused and left within the interval.
    /// </para>
    /// <para>
    /// The API has been present since Windows 2000 and behaves identically on Windows 7 and
    /// Windows 11, which is why this lives in Core rather than behind a per-release adapter.
    /// </para>
    ///
    /// <para><b>Three things that are easy to get wrong here.</b></para>
    ///
    /// <para>
    /// <b>The delegate must be rooted.</b> <c>SetWinEventHook</c> stores a native function
    /// pointer, which the garbage collector knows nothing about. A delegate passed inline is
    /// collected as soon as the call returns and the next callback crashes the process with an
    /// access violation — a classic, intermittent, and very hard to diagnose failure. The field
    /// <c>_callback</c> exists solely to keep it alive.
    /// </para>
    ///
    /// <para>
    /// <b>The hook needs a message pump.</b> <c>WINEVENT_OUTOFCONTEXT</c> delivers callbacks on
    /// the thread that installed the hook, and only while that thread pumps messages. This class
    /// therefore runs its own pump thread rather than trusting the caller to be on one — see
    /// <see cref="Start"/> for what happened when it did trust the caller. It still has to be a
    /// desktop process: in session 0 there is no desktop to watch.
    /// </para>
    ///
    /// <para>
    /// <b>Reading another process's path needs the right API.</b> <c>GetModuleFileNameEx</c>
    /// fails across the 32/64-bit boundary, so a 32-bit agent — which this is, deliberately —
    /// could not identify 64-bit Excel. <c>QueryFullProcessImageName</c> works in both
    /// directions and needs only <c>PROCESS_QUERY_LIMITED_INFORMATION</c>, which a standard user
    /// holds for their own processes. It is Vista and later; Windows 7 is fine.
    /// </para>
    /// </remarks>
    public sealed class Win32ForegroundWatcher : IForegroundWatcher
    {
        private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
        private const uint WINEVENT_SKIPOWNPROCESS = 0x0002;
        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        private delegate void WinEventProc(
            IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
            int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

        [DllImport("user32.dll")]
        private static extern IntPtr SetWinEventHook(
            uint eventMin, uint eventMax, IntPtr hmodWinEventProc,
            WinEventProc lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

        [DllImport("user32.dll")]
        private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        /* ── The pump ────────────────────────────────────────────────────────────────────────
         *
         * WINEVENT_OUTOFCONTEXT delivers callbacks by posting to the message queue of the
         * thread that installed the hook. No pump on that thread means no callbacks, ever —
         * silently, because SetWinEventHook still returns a valid handle.
         */

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeMessage
        {
            public IntPtr Hwnd;
            public uint Message;
            public IntPtr WParam;
            public IntPtr LParam;
            public uint Time;
            public int PointX;
            public int PointY;
        }

        private const uint WM_QUIT = 0x0012;

        [DllImport("user32.dll")]
        private static extern int GetMessage(out NativeMessage message, IntPtr hwnd, uint filterMin, uint filterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref NativeMessage message);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref NativeMessage message);

        [DllImport("user32.dll")]
        private static extern bool PostThreadMessage(uint threadId, uint message, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowTextLengthW(IntPtr hWnd);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool QueryFullProcessImageNameW(
            IntPtr process, uint flags, StringBuilder exeName, ref int size);

        /// <summary>Kept alive for the lifetime of the hook. See the remarks.</summary>
        private WinEventProc _callback;

        private IntPtr _hook = IntPtr.Zero;
        private bool _disposed;

        private Thread _pump;
        private uint _pumpThreadId;
        private readonly ManualResetEventSlim _ready = new ManualResetEventSlim(false);
        private readonly BrowserAddressBarReader _addressBar = new BrowserAddressBarReader();

        /// <inheritdoc />
        public bool CollectBrowserDomains { get; set; }

        /// <inheritdoc />
        public bool CollectDocumentNames { get; set; }

        public event EventHandler<ForegroundSnapshot> ForegroundChanged;

        /// <summary>
        /// Install the hook on a thread that pumps messages, and keep that thread alive.
        /// </summary>
        /// <remarks>
        /// <para>
        /// This used to install the hook on whatever thread happened to call it, relying on the
        /// caller being the WPF UI thread. It was not: <c>AgentHost.OpenSessionAsync</c> awaits
        /// the login with <c>ConfigureAwait(false)</c>, so <c>StartSession</c> — and this —
        /// continued on a thread-pool thread. A pool thread has no message pump and is handed
        /// straight back, so <c>WINEVENT_OUTOFCONTEXT</c> had nowhere to deliver and the
        /// callback never fired once.
        /// </para>
        /// <para>
        /// Nothing reported an error. <c>SetWinEventHook</c> returned a valid handle, and
        /// tracking silently degraded to whatever <c>Capture()</c> sampled at each span
        /// boundary — which is how a day of real work in Chrome and Word came to be recorded as
        /// ten-minute blocks of whichever window happened to be in front at the sampling
        /// instant, mostly the agent's own.
        /// </para>
        /// <para>
        /// So the watcher now owns the requirement instead of documenting it. A dedicated
        /// background thread installs the hook and runs a plain <c>GetMessage</c> loop, and no
        /// caller has to know or care which thread it was invoked from.
        /// </para>
        /// </remarks>
        public void Start()
        {
            if (_pump != null) return;

            _ready.Reset();
            _pump = new Thread(PumpLoop)
            {
                // Background, so a stuck pump can never keep the agent alive after everything
                // else has shut down.
                IsBackground = true,
                Name = "SEL LIVE foreground watcher",
            };
            _pump.Start();

            // Bounded: if the hook cannot be installed the agent must still run, just without
            // per-application detail. Waiting forever here would hang sign-in.
            _ready.Wait(TimeSpan.FromSeconds(5));
        }

        private void PumpLoop()
        {
            _pumpThreadId = GetCurrentThreadId();
            try
            {
                _callback = OnWinEvent;
                _hook = SetWinEventHook(
                    EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
                    IntPtr.Zero, _callback, 0, 0,
                    // Skipping our own process stops the access gate and the tray menu appearing
                    // in somebody's application usage. The agent is not work.
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
            }
            finally
            {
                // Released even if the hook failed, so Start() does not block for five seconds
                // on every sign-in when something is wrong.
                _ready.Set();
            }

            NativeMessage message;
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }

            // On this thread, because a hook must be removed by the thread that installed it.
            if (_hook != IntPtr.Zero)
            {
                UnhookWinEvent(_hook);
                _hook = IntPtr.Zero;
            }
            _callback = null;
        }

        public void Stop()
        {
            Thread pump = _pump;
            if (pump == null) return;
            _pump = null;

            // WM_QUIT ends GetMessage, which lets the loop unhook and exit tidily. Aborting the
            // thread instead would leave the hook installed against a dead callback, and the
            // next foreground change would call into freed memory.
            PostThreadMessage(_pumpThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            pump.Join(TimeSpan.FromSeconds(2));
        }

        private void OnWinEvent(IntPtr hook, uint eventType, IntPtr hwnd,
            int idObject, int idChild, uint thread, uint time)
        {
            if (eventType != EVENT_SYSTEM_FOREGROUND || hwnd == IntPtr.Zero) return;
            try
            {
                ForegroundSnapshot snapshot = Describe(hwnd);
                if (snapshot == null) return;
                EventHandler<ForegroundSnapshot> handler = ForegroundChanged;
                if (handler != null) handler(this, snapshot);
            }
            catch (Exception)
            {
                // A callback that throws crosses back into native code, where an unhandled
                // managed exception terminates the process. Losing one focus change is a far
                // better outcome than the agent disappearing from somebody's desktop.
            }
        }

        /// <summary>
        /// The foreground window right now, or null if it is one of ours.
        /// </summary>
        /// <remarks>
        /// The own-process check mirrors <c>WINEVENT_SKIPOWNPROCESS</c> on the hook. Without it
        /// the two disagreed, and the disagreement was visible in the reports: the hook refuses
        /// to record the agent, but this is called at the start of every session — when the
        /// sign-in window is, necessarily, the foreground — so every day opened with the agent
        /// itself as the current application and stayed there until the next focus change.
        /// "sel.agent.exe, 102 minutes" was the result.
        ///
        /// Null is the honest answer: no application of the user's is in front.
        /// </remarks>
        public ForegroundSnapshot Capture()
        {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return null;

            uint processId;
            GetWindowThreadProcessId(hwnd, out processId);
            if (processId == OwnProcessId) return null;

            return Describe(hwnd);
        }

        private static readonly uint OwnProcessId = (uint)Process.GetCurrentProcess().Id;

        private ForegroundSnapshot Describe(IntPtr hwnd)
        {
            uint processId;
            GetWindowThreadProcessId(hwnd, out processId);
            if (processId == 0) return null;

            string executablePath = TryGetProcessPath(processId);
            string processName = string.IsNullOrEmpty(executablePath)
                ? TryGetProcessNameByHandle(processId)
                : System.IO.Path.GetFileName(executablePath);
            if (string.IsNullOrEmpty(processName)) return null;

            string title = TryGetWindowTitle(hwnd);

            var snapshot = new ForegroundSnapshot
            {
                ProcessName = processName,
                ApplicationName = DescribeApplication(executablePath, processName),
                ExecutablePath = executablePath,
                WindowTitle = title
            };

            // Both are off unless the effective policy turned them on, and both are cheap to
            // decline: no accessibility call is made, and no title is parsed.
            if (CollectBrowserDomains && BrowserDomainRules.IsBrowser(processName))
            {
                snapshot.BrowserDomain = _addressBar.HostFor(hwnd, title);
            }

            if (CollectDocumentNames)
            {
                snapshot.DocumentName = DocumentNameRules.From(processName, title);
            }

            return snapshot;
        }

        private static string TryGetProcessPath(uint processId)
        {
            IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
            if (handle == IntPtr.Zero) return null;
            try
            {
                var builder = new StringBuilder(1024);
                int size = builder.Capacity;
                return QueryFullProcessImageNameW(handle, 0, builder, ref size)
                    ? builder.ToString(0, size)
                    : null;
            }
            finally
            {
                CloseHandle(handle);
            }
        }

        private static string TryGetProcessNameByHandle(uint processId)
        {
            // Fallback for protected processes, where OpenProcess is refused even for the limited
            // right. Process.GetProcessById can still name it from the system's own table.
            try
            {
                using (Process process = Process.GetProcessById((int)processId))
                {
                    return process.ProcessName + ".exe";
                }
            }
            catch (ArgumentException)
            {
                return null;
            }
            catch (InvalidOperationException)
            {
                return null;
            }
        }

        private static string TryGetWindowTitle(IntPtr hwnd)
        {
            try
            {
                int length = GetWindowTextLengthW(hwnd);
                if (length <= 0) return null;

                // +1 for the terminator GetWindowTextW writes. The reported length can also be
                // stale by the time the text is read — a title changing between the two calls is
                // ordinary in a browser — so the return value, not the earlier length, decides
                // how much was actually copied.
                var builder = new StringBuilder(length + 1);
                int copied = GetWindowTextW(hwnd, builder, builder.Capacity);
                return copied > 0 ? builder.ToString(0, Math.Min(copied, builder.Length)) : null;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// The friendly name from the executable's version resource.
        /// </summary>
        /// <remarks>
        /// This is what lets a report say "Microsoft Excel" rather than "excel.exe" on a machine
        /// nobody has configured. The server's catalogue can override it, but the default being
        /// right for the several hundred applications an office runs matters more than the
        /// handful an administrator will ever bother to rename.
        /// <para>
        /// Cached by path: <c>FileVersionInfo</c> opens and parses the file, and doing that on
        /// every alt-tab would be exactly the kind of per-event I/O §53 warns against.
        /// </para>
        /// </remarks>
        private static readonly Dictionary<string, string> DescriptionCache =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private static readonly object CacheGate = new object();

        private static string DescribeApplication(string executablePath, string processName)
        {
            if (string.IsNullOrEmpty(executablePath)) return processName;

            lock (CacheGate)
            {
                string cached;
                if (DescriptionCache.TryGetValue(executablePath, out cached)) return cached;
            }

            string description = processName;
            try
            {
                FileVersionInfo info = FileVersionInfo.GetVersionInfo(executablePath);
                if (!string.IsNullOrEmpty(info.FileDescription)) description = info.FileDescription.Trim();
                else if (!string.IsNullOrEmpty(info.ProductName)) description = info.ProductName.Trim();
            }
            catch (Exception)
            {
                // No version resource, or the file is unreadable. The process name is a perfectly
                // serviceable fallback and is what the server would derive anyway.
            }

            lock (CacheGate)
            {
                // Bounded so a machine that launches many short-lived executables cannot grow it
                // without limit over a long-running session.
                if (DescriptionCache.Count > 512) DescriptionCache.Clear();
                DescriptionCache[executablePath] = description;
            }

            return description;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            Stop();
        }
    }
}
