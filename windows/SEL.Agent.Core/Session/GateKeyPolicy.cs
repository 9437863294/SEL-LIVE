namespace Sel.Agent.Core.Session
{
    /// <summary>
    /// Which keyboard shortcuts the access gate swallows, as a pure decision.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Separated from the Win32 hook that calls it so it can be tested. The cost of getting
    /// this wrong runs both ways and neither way is obvious from reading the hook: swallow too
    /// little and somebody Alt+Tabs past a mandatory sign-in; swallow too much and they cannot
    /// Tab from the email box to the password box, or cannot use the documented emergency
    /// release, and the PC needs a hard reset.
    /// </para>
    /// <para>
    /// No state, no Win32, no storage. It is handed a virtual-key code and the modifier state
    /// and answers yes or no — which is also what keeps the hook demonstrably not a keylogger:
    /// there is nowhere in this class for a keystroke to go.
    /// </para>
    /// </remarks>
    public static class GateKeyPolicy
    {
        public const int VK_TAB = 0x09;
        public const int VK_ESCAPE = 0x1B;
        public const int VK_F4 = 0x73;
        public const int VK_F12 = 0x7B;
        public const int VK_LWIN = 0x5B;
        public const int VK_RWIN = 0x5C;

        /// <summary>
        /// Whether this key press should be stopped before it reaches the shell.
        /// </summary>
        /// <param name="virtualKey">The Win32 virtual-key code.</param>
        /// <param name="alt">Either Alt is down.</param>
        /// <param name="control">Either Ctrl is down.</param>
        /// <param name="shift">Either Shift is down.</param>
        public static bool ShouldSwallow(int virtualKey, bool alt, bool control, bool shift)
        {
            switch (virtualKey)
            {
                case VK_LWIN:
                case VK_RWIN:
                    // Every Win chord at once: Start, Win+D to the desktop, Win+R to Run,
                    // Win+E to Explorer. There is no Win shortcut worth allowing here.
                    return true;

                case VK_TAB:
                    // Alt+Tab only. Tab on its own moves between the email and password boxes,
                    // and a sign-in form somebody cannot tab through is its own kind of broken.
                    return alt;

                case VK_ESCAPE:
                    // Alt+Esc cycles windows, Ctrl+Esc opens Start, Ctrl+Shift+Esc opens Task
                    // Manager. Escape unmodified belongs to the gate.
                    return alt || control;

                case VK_F4:
                    return alt;

                default:
                    // Everything else, including every printable key, passes through. Notably
                    // F12: Ctrl+Shift+Alt+F12 is the emergency release, and swallowing it here
                    // would remove the one way out of a gate that has gone wrong.
                    return false;
            }
        }
    }
}
