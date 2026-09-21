using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Sel.Agent.Core.Platform.Win32
{
    /// <summary>
    /// Locks the workstation through <c>LockWorkStation</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The same thing Win+L does. The person clears it with their own Windows password, and
    /// nothing the agent holds is involved in getting back in — which is exactly why this is the
    /// right primitive. The agent is not standing between somebody and their PC; it is asking
    /// Windows to do the thing Windows already does, at a moment of the organisation's choosing.
    /// </para>
    /// <para>
    /// It is also not a bypass of anything. Ctrl+Alt+Delete still works from the lock screen,
    /// the account can still be switched, and an administrator can still sign in. §7's position
    /// that the agent is not a security boundary is unchanged: this raises the cost of walking
    /// away from an unlocked desk, and does not claim to be access control.
    /// </para>
    /// <para>
    /// Available on every supported release — it has been in user32 since Windows XP — so there
    /// is no legacy fallback to document here.
    /// </para>
    /// </remarks>
    public sealed class Win32WorkstationLock : IWorkstationLock
    {
        // Returns zero on failure and sets the last error. The one documented failure worth
        // expecting is being called from a process with no window station, which is why this
        // lives in the desktop agent rather than the session-0 service.
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool LockWorkStation();

        private readonly Action<string> _log;

        public Win32WorkstationLock(Action<string> log)
        {
            _log = log ?? (message => { });
        }

        public bool Lock()
        {
            try
            {
                if (LockWorkStation()) return true;

                int error = Marshal.GetLastWin32Error();
                _log("Windows refused to lock the workstation: " + new Win32Exception(error).Message
                    + " (" + error + ")");
                return false;
            }
            catch (Exception error)
            {
                // Reported rather than thrown. This is called from a timer on the UI thread, and
                // an unhandled exception there would take the tray icon and the open work
                // session with it — a far worse outcome than a desk that stayed unlocked.
                _log("Could not lock the workstation: " + error.Message);
                return false;
            }
        }
    }
}
