using System;
using Microsoft.Win32;

namespace Sel.Agent.Core.Platform.Win32
{
    /// <summary>
    /// Lock, unlock, sleep, resume, log off and shutdown, via <c>SystemEvents</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>Microsoft.Win32.SystemEvents</c> wraps the window messages this needs
    /// (<c>WM_WTSSESSION_CHANGE</c>, <c>WM_POWERBROADCAST</c>, <c>WM_ENDSESSION</c>) and has
    /// behaved the same way from .NET 2.0 on Windows XP through .NET Framework 4.8 on Windows 11.
    /// Using it rather than registering for the raw messages saves a hidden window and a window
    /// procedure, and there is no behavioural difference on any supported release.
    /// </para>
    ///
    /// <para><b>Events arrive on a thread of the framework's choosing.</b></para>
    /// <para>
    /// <c>SystemEvents</c> raises callbacks on its own internal window's thread, which is not the
    /// UI thread. Anything touching WPF must therefore marshal — and rather than making every
    /// subscriber remember that, this class simply reports and the coordinator, which owns no UI,
    /// consumes. The one subscriber that does touch UI (the tray) dispatches explicitly.
    /// </para>
    ///
    /// <para><b>Why lock and screensaver are both treated as "locked".</b></para>
    /// <para>
    /// A secure screensaver kicking in is indistinguishable, for attendance purposes, from
    /// pressing Win+L: the machine is not available to be worked on. Treating them differently
    /// would produce a day where forty minutes at lunch counted as locked and forty minutes in a
    /// meeting counted as idle, for no reason a person could explain.
    /// </para>
    ///
    /// <para><b>Unsubscribing is not optional.</b></para>
    /// <para>
    /// <c>SystemEvents</c> holds a strong reference to every handler, on a static event that
    /// lives for the process. A subscriber that is never removed is never collected, and in a
    /// long-running agent that is a leak that grows across every sign-in and sign-out cycle. The
    /// unsubscribe in <see cref="Stop"/> is what prevents it.
    /// </para>
    /// </remarks>
    public sealed class Win32SessionStateMonitor : ISessionStateMonitor
    {
        private bool _running;
        private bool _disposed;

        public event EventHandler<SessionStateChange> StateChanged;

        public void Start()
        {
            if (_running) return;
            SystemEvents.SessionSwitch += OnSessionSwitch;
            SystemEvents.PowerModeChanged += OnPowerModeChanged;
            SystemEvents.SessionEnding += OnSessionEnding;
            _running = true;
        }

        public void Stop()
        {
            if (!_running) return;
            SystemEvents.SessionSwitch -= OnSessionSwitch;
            SystemEvents.PowerModeChanged -= OnPowerModeChanged;
            SystemEvents.SessionEnding -= OnSessionEnding;
            _running = false;
        }

        private void Raise(SessionStateChange change)
        {
            EventHandler<SessionStateChange> handler = StateChanged;
            if (handler == null) return;
            try
            {
                handler(this, change);
            }
            catch (Exception)
            {
                // These callbacks run on a framework thread during shutdown and lock transitions.
                // An exception escaping here has, historically, been a good way to hang a logoff.
            }
        }

        private void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
        {
            switch (e.Reason)
            {
                case SessionSwitchReason.SessionLock:
                case SessionSwitchReason.SessionLogoff:
                    Raise(SessionStateChange.Locked);
                    break;
                case SessionSwitchReason.SessionUnlock:
                case SessionSwitchReason.SessionLogon:
                    Raise(SessionStateChange.Unlocked);
                    break;
                case SessionSwitchReason.RemoteDisconnect:
                case SessionSwitchReason.ConsoleDisconnect:
                    // A disconnected RDP or fast-user-switched session is still running, but
                    // nobody is in front of it — the same situation as a lock, and counted the
                    // same way. Without this, a user who disconnects rather than signs out
                    // accrues active hours all night.
                    Raise(SessionStateChange.Locked);
                    break;
                case SessionSwitchReason.RemoteConnect:
                case SessionSwitchReason.ConsoleConnect:
                    Raise(SessionStateChange.Unlocked);
                    break;
            }
        }

        private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
        {
            if (e.Mode == PowerModes.Suspend) Raise(SessionStateChange.Suspending);
            else if (e.Mode == PowerModes.Resume) Raise(SessionStateChange.Resumed);
        }

        private void OnSessionEnding(object sender, SessionEndingEventArgs e)
        {
            // Fires before Windows tears the session down, and is the agent's only chance to
            // close the work session properly (§28). Deliberately not cancelled: an agent that
            // vetoed a shutdown to finish an upload would be a support call, and the reaper
            // handles the case where the final request does not make it.
            Raise(e.Reason == SessionEndReasons.SystemShutdown
                ? SessionStateChange.Shutdown
                : SessionStateChange.LogOff);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            Stop();
        }
    }
}
