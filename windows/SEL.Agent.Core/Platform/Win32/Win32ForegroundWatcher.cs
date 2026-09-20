using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
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
    /// the thread that installed the hook, and only while that thread pumps messages. That is why
    /// this is installed from the WPF UI thread and not from a background worker or the service:
    /// in session 0 there is no desktop to watch and no pump to deliver on.
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

        public event EventHandler<ForegroundSnapshot> ForegroundChanged;

        public void Start()
        {
            if (_hook != IntPtr.Zero) return;
            _callback = OnWinEvent;
            _hook = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
                IntPtr.Zero, _callback, 0, 0,
                // Skipping our own process stops the access gate and the tray menu appearing in
                // somebody's application usage. The agent is not work.
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        }

        public void Stop()
        {
            if (_hook == IntPtr.Zero) return;
            UnhookWinEvent(_hook);
            _hook = IntPtr.Zero;
            _callback = null;
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

        public ForegroundSnapshot Capture()
        {
            IntPtr hwnd = GetForegroundWindow();
            return hwnd == IntPtr.Zero ? null : Describe(hwnd);
        }

        private static ForegroundSnapshot Describe(IntPtr hwnd)
        {
            uint processId;
            GetWindowThreadProcessId(hwnd, out processId);
            if (processId == 0) return null;

            string executablePath = TryGetProcessPath(processId);
            string processName = string.IsNullOrEmpty(executablePath)
                ? TryGetProcessNameByHandle(processId)
                : System.IO.Path.GetFileName(executablePath);
            if (string.IsNullOrEmpty(processName)) return null;

            return new ForegroundSnapshot
            {
                ProcessName = processName,
                ApplicationName = DescribeApplication(executablePath, processName),
                ExecutablePath = executablePath,
                WindowTitle = TryGetWindowTitle(hwnd)
            };
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
