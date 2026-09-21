using System;
using System.Runtime.InteropServices;
using Sel.Agent.Core.Session;

namespace Sel.Agent
{
    /// <summary>
    /// Swallows the shortcuts that would get somebody past the access gate.
    /// </summary>
    /// <remarks>
    /// <para><b>This is not a keylogger, and the shape of the code is the argument.</b></para>
    /// <para>
    /// A low-level keyboard hook is the same API a keylogger uses, so it is worth being precise
    /// about what this one does. It receives a virtual-key code, compares it against a fixed
    /// list of six shortcuts, and returns either "swallow" or "pass on". It never stores a key,
    /// never counts one, never writes one anywhere, and has no field to put one in. Nothing
    /// reaches the network, the log or the disk. §12's prohibition on keystroke capture is
    /// intact, and the only way to break it here would be to add storage that does not exist.
    /// </para>
    /// <para>
    /// It is also only alive while the gate is on screen. Installed when an enforcing gate
    /// loads, removed the moment it is released, and removed again on process exit.
    /// </para>
    ///
    /// <para><b>What cannot be blocked, and why that is correct.</b></para>
    /// <para>
    /// Ctrl+Alt+Delete is the Secure Attention Sequence. Windows routes it in the kernel,
    /// specifically so that no application can imitate a logon screen or trap a user, and
    /// nothing in user mode can intercept it. So the lock screen, Task Manager and Sign out
    /// remain reachable from any PC running this gate. That is a feature: it is the difference
    /// between a mandatory sign-in prompt and a machine somebody cannot recover.
    /// </para>
    /// <para>
    /// Ctrl+Shift+Alt+F12 — the documented emergency release — is deliberately absent from the
    /// block list, so it still reaches the gate.
    /// </para>
    ///
    /// <para><b>Two failure modes that are handled by the platform.</b></para>
    /// <para>
    /// A hook that stops responding is removed by Windows itself after
    /// <c>LowLevelHooksTimeout</c>, so an agent that hangs cannot leave a keyboard permanently
    /// crippled. And the hook must be installed from a thread that pumps messages — the same
    /// requirement that silently broke the foreground watcher — which is why this is installed
    /// from the gate's own UI thread and nowhere else.
    /// </para>
    /// </remarks>
    internal sealed class KeyboardLockdown : IDisposable
    {
        private const int WH_KEYBOARD_LL = 13;
        private const int HC_ACTION = 0;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;

        private const int VK_SHIFT = 0x10;
        private const int VK_CONTROL = 0x11;
        private const int VK_MENU = 0x12;      // Alt

        private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct KeyboardHookStruct
        {
            public uint VirtualKey;
            public uint ScanCode;
            public uint Flags;
            public uint Time;
            public IntPtr ExtraInfo;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hook);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int virtualKey);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string name);

        /// <summary>Rooted for the lifetime of the hook, like the foreground watcher's.</summary>
        private readonly HookProc _callback;

        private readonly Action<string> _log;
        private IntPtr _hook = IntPtr.Zero;
        private bool _disposed;

        private KeyboardLockdown(Action<string> log)
        {
            _log = log ?? (message => { });
            _callback = OnKey;
        }

        /// <summary>
        /// Install the hook, or return null if Windows refused.
        /// </summary>
        /// <remarks>
        /// Null rather than an exception: a gate that cannot block the Win key is still a gate,
        /// and refusing to show it would leave somebody unable to sign in at all. The refusal is
        /// logged so it is visible rather than assumed.
        /// </remarks>
        internal static KeyboardLockdown Install(Action<string> log)
        {
            var lockdown = new KeyboardLockdown(log);
            try
            {
                // A module handle is required for WH_KEYBOARD_LL even though the callback is
                // managed; passing the current module is what the documentation asks for.
                IntPtr module = GetModuleHandle(null);
                lockdown._hook = SetWindowsHookEx(WH_KEYBOARD_LL, lockdown._callback, module, 0);
                if (lockdown._hook == IntPtr.Zero)
                {
                    lockdown._log("Could not block Windows shortcuts at the gate (error "
                        + Marshal.GetLastWin32Error() + "). The gate is still shown.");
                    return null;
                }
            }
            catch (Exception error)
            {
                lockdown._log("Could not block Windows shortcuts at the gate: " + error.Message);
                return null;
            }

            lockdown._log("Gate lockdown on: Windows key, Alt+Tab, Alt+Esc, Ctrl+Esc, Alt+F4 and "
                + "Ctrl+Shift+Esc are suppressed. Ctrl+Alt+Delete still works, as it must.");
            return lockdown;
        }

        private IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                if (code == HC_ACTION)
                {
                    int message = wParam.ToInt32();
                    if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN)
                    {
                        var info = (KeyboardHookStruct)Marshal.PtrToStructure(lParam, typeof(KeyboardHookStruct));
                        if (ShouldSwallow((int)info.VirtualKey))
                        {
                            // Non-zero ends the chain: the key never reaches the shell.
                            return new IntPtr(1);
                        }
                    }
                }
            }
            catch (Exception)
            {
                // A throwing hook procedure crosses back into native code, where an unhandled
                // managed exception ends the process — and this one runs on every keystroke on
                // the machine. Letting the key through is the only sane failure.
            }

            return CallNextHookEx(_hook, code, wParam, lParam);
        }

        /// <summary>
        /// Reads the modifier state and asks <see cref="GateKeyPolicy"/>.
        /// </summary>
        /// <remarks>
        /// The decision itself lives in Core so it can be tested without a keyboard, a desktop
        /// or a hook. All this does is turn three <c>GetAsyncKeyState</c> calls into three
        /// booleans.
        /// </remarks>
        private static bool ShouldSwallow(int virtualKey)
        {
            return GateKeyPolicy.ShouldSwallow(
                virtualKey, Down(VK_MENU), Down(VK_CONTROL), Down(VK_SHIFT));
        }

        private static bool Down(int virtualKey)
        {
            return (GetAsyncKeyState(virtualKey) & 0x8000) != 0;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            if (_hook == IntPtr.Zero) return;
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
            _log("Gate lockdown off; Windows shortcuts work normally again.");
        }
    }
}
