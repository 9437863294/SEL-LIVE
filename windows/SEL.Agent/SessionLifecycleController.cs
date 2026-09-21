using System;
using System.Windows;
using System.Windows.Threading;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Platform;
using Sel.Agent.Core.Session;

namespace Sel.Agent
{
    /// <summary>
    /// Turns an unattended desk into a locked one, and makes the SEL LIVE sign-in the way back in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Three behaviours, each governed by its own policy field and each off by default:
    /// </para>
    /// <list type="bullet">
    /// <item><description>
    /// <b>Idle lock.</b> After <c>idleLockSeconds</c> of no input a countdown appears; after
    /// <c>idleLockWarningSeconds</c> more the workstation locks.
    /// </description></item>
    /// <item><description>
    /// <b>Re-authentication after a long lock.</b> Unlocking Windows resumes silently for a
    /// short absence and asks for a SEL LIVE sign-in for a long one.
    /// </description></item>
    /// <item><description>
    /// <b>Lock when the ERP window is closed</b>, for installations where that window is the
    /// working session. Driven from <see cref="ErpBrowser"/> rather than from here.
    /// </description></item>
    /// </list>
    ///
    /// <para><b>The policy is read every tick, not captured.</b></para>
    /// <para>
    /// Policy arrives with the heartbeat, so an administrator switching the idle lock off
    /// reaches a PC within ninety seconds. Reading it once at start-up would mean the setting
    /// that is most likely to need urgent reversal — because it is the one that can stop
    /// somebody working — took a restart to reverse.
    /// </para>
    ///
    /// <para><b>Nothing happens while nobody is signed in.</b></para>
    /// <para>
    /// A signed-out agent has no session to protect, and locking the machine of somebody who
    /// has not signed in to SEL LIVE would be the agent interfering with a PC it has no business
    /// interfering with. The access gate is what handles that case.
    /// </para>
    /// </remarks>
    public sealed class SessionLifecycleController : IDisposable
    {
        /// <summary>Raised when an unlock needs a fresh SEL LIVE sign-in.</summary>
        public event EventHandler ReauthenticationRequired;

        private readonly AgentHost _host;
        private readonly IWorkstationLock _lock;
        private readonly Action<string> _log;
        private readonly DispatcherTimer _timer;

        private IdleWarningWindow _warning;
        private bool _locked;
        private DateTime _lockedAtUtc;
        private bool _disposed;

        public SessionLifecycleController(AgentHost host, IWorkstationLock workstationLock, Action<string> log)
        {
            _host = host ?? throw new ArgumentNullException("host");
            _lock = workstationLock ?? throw new ArgumentNullException("workstationLock");
            _log = log ?? (message => { });

            _host.Coordinator.SessionStateChanged += OnSessionStateChanged;

            // One second, because the countdown shows seconds. Cheap: the tick is one Win32 call
            // and a comparison, and it does nothing at all while the policy is off.
            _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _timer.Tick += OnTick;
            _timer.Start();
        }

        private AgentPolicySettings Policy
        {
            get
            {
                ResolvedAgentPolicy resolved = _host.Coordinator.Policy;
                return resolved != null ? resolved.Settings : null;
            }
        }

        /* ── Idle ────────────────────────────────────────────────────────────────────────── */

        private void OnTick(object sender, EventArgs e)
        {
            try
            {
                AgentPolicySettings policy = Policy;

                // Signed out: the gate's problem, not this one.
                bool signedIn = _host.CurrentLogin != null;

                IdleLockDecision decision = IdleLockPlanner.Plan(
                    signedIn ? _host.Coordinator.IdleSeconds : 0,
                    signedIn ? policy : null,
                    _warning != null,
                    _locked);

                switch (decision.Action)
                {
                    case IdleLockAction.ShowWarning:
                        ShowWarning(decision.SecondsUntilLock, policy.IdleLockWarningSeconds);
                        break;

                    case IdleLockAction.HideWarning:
                        HideWarning();
                        break;

                    case IdleLockAction.Lock:
                        HideWarning();
                        _log("Locking the workstation after "
                            + (policy.IdleLockSeconds + policy.IdleLockWarningSeconds) + "s idle.");
                        LockNow();
                        break;

                    default:
                        if (_warning != null) _warning.UpdateCountdown(decision.SecondsUntilLock, policy.IdleLockWarningSeconds);
                        break;
                }
            }
            catch (Exception error)
            {
                // A timer on the UI thread. Throwing here would be caught by App's global
                // handler, but silently losing the tick is better than a log line a second if
                // something is persistently wrong, so the timer keeps running either way.
                _log("Idle lock tick failed: " + error.Message);
            }
        }

        private void ShowWarning(int secondsRemaining, int totalSeconds)
        {
            if (_warning != null) return;

            _warning = new IdleWarningWindow();
            _warning.KeepWorkingRequested += (s, args) => HideWarning();
            _warning.Closed += (s, args) => _warning = null;
            _warning.Show();
            _warning.UpdateCountdown(secondsRemaining, totalSeconds);
            _log("Idle: warning the user before locking.");
        }

        private void HideWarning()
        {
            if (_warning == null) return;
            IdleWarningWindow window = _warning;
            _warning = null;
            try { window.Close(); } catch (Exception) { /* already closing */ }
        }

        /* ── Locking ─────────────────────────────────────────────────────────────────────── */

        /// <summary>
        /// Lock now, for a reason other than idleness.
        /// </summary>
        /// <remarks>
        /// Used by the ERP window's close handler. Public because the decision to lock belongs
        /// to whatever noticed the reason, while the mechanics — taking the warning down, not
        /// locking twice — belong here.
        /// </remarks>
        public void LockNow()
        {
            HideWarning();

            // Marked before the call, not after. LockWorkStation is asynchronous: it returns as
            // soon as Windows accepts the request, and the session-switch event follows. Setting
            // the flag afterwards leaves a window in which the next tick locks again.
            _locked = true;
            _lockedAtUtc = DateTime.UtcNow;

            if (!_lock.Lock())
            {
                // It did not lock, so pretending it did would suppress every later attempt.
                _locked = false;
            }
        }

        /* ── Unlocking ───────────────────────────────────────────────────────────────────── */

        private void OnSessionStateChanged(object sender, SessionStateChange change)
        {
            // Off the coordinator's thread; everything below touches windows.
            Application.Current.Dispatcher.BeginInvoke(new Action(() =>
            {
                switch (change)
                {
                    case SessionStateChange.Locked:
                        // Also covers Win+L and the screensaver, which is why _lockedAtUtc is set
                        // here as well as in LockNow: a lock the agent did not initiate still
                        // starts the clock that decides whether unlocking needs a sign-in.
                        if (!_locked) _lockedAtUtc = DateTime.UtcNow;
                        _locked = true;
                        HideWarning();
                        break;

                    case SessionStateChange.Unlocked:
                        _locked = false;
                        OnUnlocked();
                        break;

                    case SessionStateChange.Suspending:
                        // A sleeping PC is locked as far as this is concerned, and on resume
                        // Windows may or may not raise Unlocked depending on the power settings.
                        if (!_locked) _lockedAtUtc = DateTime.UtcNow;
                        _locked = true;
                        break;

                    case SessionStateChange.Resumed:
                        _locked = false;
                        OnUnlocked();
                        break;
                }
            }));
        }

        private void OnUnlocked()
        {
            if (_host.CurrentLogin == null) return;
            if (_lockedAtUtc == default(DateTime)) return;

            double lockedSeconds = (DateTime.UtcNow - _lockedAtUtc).TotalSeconds;
            _lockedAtUtc = default(DateTime);

            if (!IdleLockPlanner.ShouldReauthenticateAfterLock(lockedSeconds, Policy)) return;

            _log("Locked for " + (int)lockedSeconds + "s; asking for a SEL LIVE sign-in again.");
            EventHandler handler = ReauthenticationRequired;
            if (handler != null) handler(this, EventArgs.Empty);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _timer.Stop();
            _timer.Tick -= OnTick;
            _host.Coordinator.SessionStateChanged -= OnSessionStateChanged;
            HideWarning();
        }
    }
}
