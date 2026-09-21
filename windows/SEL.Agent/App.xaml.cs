using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Platform.Win32;

namespace Sel.Agent
{
    /// <summary>
    /// Start-up: one instance, one host, and the decision about whether to show the gate.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Single instance, enforced with a named mutex.</b> The agent is launched from the Run
    /// key at sign-in and can also be started from the Start Menu or by the service after a
    /// crash. Two copies would double every heartbeat, race on the SQLite queue and — worst —
    /// record every span twice. A local mutex is enough: the agent is per-session by design, so
    /// two users switched on one PC each legitimately get their own.
    /// </para>
    ///
    /// <para><b>Sign-in is always offered; the policy decides whether it can be dismissed.</b></para>
    /// <para>
    /// §60 is explicit that mandatory access control must not go out before the monitoring path
    /// and the recovery path have been proven, and the default policy has
    /// <c>requireMorningLogin</c> off. That governs whether the sign-in window traps the desktop
    /// — not whether it appears.
    /// </para>
    /// <para>
    /// Reading it as "do not ask" produced a silent dead end: a freshly installed agent enrolled,
    /// found no saved session, skipped the gate, and sat in the tray signed out. A signed-out
    /// agent has no session, and with no session it records nothing — so the default
    /// configuration tracked nothing at all while looking perfectly healthy. Monitoring first
    /// still requires somebody to sign in first.
    /// </para>
    ///
    /// <para><b>Nothing here blocks Windows from starting.</b></para>
    /// <para>
    /// Enrolment and the resume attempt both happen after the UI thread is running, and the gate
    /// appears when they finish. A synchronous network call at start-up would hold up the shell
    /// on every PC in the company every morning, and would hang the desktop entirely on the day
    /// the ERP is slow.
    /// </para>
    /// </remarks>
    public partial class App : Application
    {
        private const string InstanceMutexName = "Local\\SEL.LIVE.Agent.SingleInstance";

        private Mutex _instanceMutex;
        private AgentHost _host;
        private TrayController _tray;
        private AgentLog _log;
        private SessionLifecycleController _lifecycle;

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            bool createdNew;
            _instanceMutex = new Mutex(true, InstanceMutexName, out createdNew);
            if (!createdNew)
            {
                // Silent: a second copy started by the service or a stray shortcut should simply
                // go away, not tell the user something is wrong.
                Shutdown();
                return;
            }

            AgentConfiguration config = AgentConfiguration.Load();
            _log = new AgentLog(config.VerboseLogging);

            DispatcherUnhandledException += (s, args) =>
            {
                // An unhandled exception on the UI thread would otherwise take the tray icon with
                // it and leave a tracked session open with nothing reporting on it. Logging and
                // continuing keeps the agent alive; the reaper is the backstop if it does not.
                _log.Write("Unhandled UI exception: " + args.Exception);
                args.Handled = true;
            };

            if (!OsCompatibility.Current.IsSupported)
            {
                MessageBox.Show(
                    OsCompatibility.Current.UnsupportedReason,
                    "SEL LIVE Agent", MessageBoxButton.OK, MessageBoxImage.Warning);
                Shutdown();
                return;
            }

            // Not configured yet: offer to do it rather than dead-ending.
            //
            // This used to be a message box naming a file path, followed by Shutdown(). The
            // person who sees it is usually the person who was supposed to create that file, so
            // pointing at it helped nobody — and it meant the MSI had to carry the address and
            // the Firebase key as properties, which is why double-clicking the installer could
            // never work. The setup window asks for the one thing an administrator knows, the
            // address of their own ERP, and collects the rest from it.
            if (!config.IsUsable)
            {
                var setup = new FirstRunSetupWindow(config, _log);
                bool? completed = setup.ShowDialog();
                if (completed != true || setup.Result == null)
                {
                    _log.Write("First-run setup was cancelled; the agent cannot start.");
                    Shutdown();
                    return;
                }
                config = setup.Result;
            }

            _host = new AgentHost(config, Dispatcher, _log);
            _host.DirectiveReceived += OnDirectiveReceived;

            _tray = new TrayController(_host);
            _tray.ExitRequested += OnExitRequested;
            _tray.SignOutRequested += OnSignOutRequested;
            _tray.SignInRequested += (sender, args) => ShowGate();
            _tray.Show();

            // Idle locking, re-authentication after a long lock, and locking when the ERP window
            // is closed. Every one of them is off unless the policy asks, so constructing this
            // unconditionally costs one timer tick a second doing a comparison.
            _lifecycle = new SessionLifecycleController(
                _host, new Win32WorkstationLock(_log.Write), _log.Write);
            _lifecycle.ReauthenticationRequired += (sender, args) => ShowGate();
            _host.ErpWindowClosedByUser += OnErpWindowClosedByUser;

            // Fire and forget: the UI thread must not wait on the network. Exceptions are caught
            // inside StartAsync, which reports through the tray rather than throwing here.
            StartAsync();
        }

        private async void StartAsync()
        {
            try
            {
                using (var cancellation = new CancellationTokenSource(TimeSpan.FromMinutes(2)))
                {
                    bool enrolled = await _host.EnsureEnrolledAsync(cancellation.Token).ConfigureAwait(true);
                    if (!enrolled)
                    {
                        _tray.ShowBalloon("Not enrolled",
                            "This computer is not registered with SEL LIVE. Ask IT to complete the installation.");
                        return;
                    }

                    // A restart mid-morning should not demand a password again unless the policy
                    // says so. The refresh token makes that possible without weakening anything:
                    // it is per-Windows-user and DPAPI-protected.
                    AgentLoginResponse resumed = await _host.TryResumeAsync(cancellation.Token).ConfigureAwait(true);
                    if (resumed != null)
                    {
                        _log.Write("Resumed as " + resumed.UserName + " without prompting.");
                        EnsureErpWindowOpen();
                        return;
                    }
                }

                ShowGateIfRequired();
            }
            catch (Exception error)
            {
                _log.Write("Start-up failed: " + error.Message);
                _tray.ShowBalloon("SEL LIVE Agent", "Could not reach SEL LIVE. Working offline; will retry.");
            }
        }

        /// <summary>
        /// Ask the user to sign in. Blocking when the policy says so, an ordinary window otherwise.
        /// </summary>
        /// <remarks>
        /// Always shown when there is no session, and that is the fix for a silent dead end. This
        /// method used to return early when <c>requireMorningLogin</c> was off — which is the
        /// default — so a freshly installed agent enrolled, never signed in, and therefore
        /// recorded nothing at all while appearing to run. The policy governs whether the window
        /// can be dismissed, not whether it appears.
        /// </remarks>
        public void ShowGateIfRequired()
        {
            bool enforce = _host.Coordinator.Policy.Settings.RequireMorningLogin;
            _log.Write(enforce
                ? "Showing the access gate; sign-in is required by policy."
                : "Showing the sign-in window; it can be dismissed under the current policy.");
            ShowGate(enforce);
        }

        public void ShowGate()
        {
            ShowGate(_host.Coordinator.Policy.Settings.RequireMorningLogin);
        }

        public void ShowGate(bool enforce)
        {
            // One at a time. A second heartbeat directive, or an impatient double-click on the
            // tray, would otherwise stack gates on top of each other.
            foreach (Window open in Windows)
            {
                if (open is AccessGateWindow)
                {
                    open.Activate();
                    return;
                }
            }

            var gate = new AccessGateWindow(_host, enforce);
            gate.Released += (s, e) =>
            {
                _log.Write("Desktop released to the user.");
                EnsureErpWindowOpen();
            };
            gate.Dismissed += (s, e) =>
            {
                _log.Write("Sign-in dismissed without signing in; nothing will be recorded until somebody does.");
                _tray.ShowBalloon(
                    "Not signed in",
                    "SEL LIVE is not recording anything. Choose Sign in from this icon when you are ready.");
            };
            gate.Show();
            gate.Activate();
        }

        /// <summary>
        /// Open the embedded SEL LIVE window, where the policy expects it to always be there.
        /// </summary>
        /// <remarks>
        /// Only under `lockOnErpWindowClose`, and that is not an unrelated setting being reused.
        /// That policy says the window *is* the working session — closing it locks the PC — so a
        /// session that began without it would be one nobody could close, and the person would
        /// have to discover the tray menu to get the thing whose absence locks their machine.
        /// </remarks>
        private void EnsureErpWindowOpen()
        {
            if (!_host.Coordinator.Policy.Settings.LockOnErpWindowClose) return;
            if (_host.IsErpWindowOpen) return;

            _log.Write("Opening the SEL LIVE window for this session.");
            _host.OpenErp("/");
        }

        /// <summary>
        /// The person closed the SEL LIVE window. Under the right policy, that ends the session.
        /// </summary>
        /// <remarks>
        /// Guarded on being signed in. Closing the window after signing out — which is the
        /// ordinary way to finish for the day — must not lock the PC on the way past.
        /// </remarks>
        private void OnErpWindowClosedByUser(object sender, EventArgs e)
        {
            if (!_host.Coordinator.Policy.Settings.LockOnErpWindowClose) return;
            if (_host.CurrentLogin == null) return;

            _log.Write("The SEL LIVE window was closed; locking this computer.");
            _lifecycle.LockNow();
        }

        private async void OnDirectiveReceived(object sender, AgentDirective directive)
        {
            switch (directive.Kind)
            {
                case DirectiveKinds.SignOut:
                    _tray.ShowBalloon("Signed out", directive.Reason ?? "An administrator signed this session out.");
                    await _host.SignOutAsync("ADMIN_SIGNOUT").ConfigureAwait(true);
                    ShowGate();
                    break;

                case DirectiveKinds.ForceReauth:
                    _tray.ShowBalloon("Sign in again", directive.Reason ?? "SEL LIVE needs you to sign in again.");
                    await _host.SignOutAsync("ADMIN_SIGNOUT").ConfigureAwait(true);
                    ShowGate();
                    break;

                case DirectiveKinds.SyncNow:
                    await _host.Coordinator.SyncNowAsync().ConfigureAwait(true);
                    break;

                case DirectiveKinds.ShowMessage:
                    _tray.ShowBalloon("SEL LIVE", directive.Message ?? string.Empty);
                    break;

                case DirectiveKinds.LockWorkstation:
                    NativeMethods.LockWorkStation();
                    break;

                default:
                    _log.Write("Directive " + directive.Kind + " is not handled by the desktop agent.");
                    break;
            }
        }

        private async void OnSignOutRequested(object sender, EventArgs e)
        {
            // Read before signing out: SignOutAsync does not clear the policy, but reading it
            // first makes the ordering irrelevant rather than something to be careful about.
            bool lockAfterwards = _host.Coordinator.Policy.Settings.LockOnSignOut;

            await _host.SignOutAsync(SessionEndReasons.UserSignout).ConfigureAwait(true);

            // Signing out is otherwise the one way to work unmonitored that needs no
            // administrator, no Task Manager and no particular knowledge: the desktop is still
            // there, and nothing is being recorded on it. Locking closes that, and the gate
            // shown below decides whether the next session can be dismissed.
            if (lockAfterwards)
            {
                _log.Write("Signed out; locking this computer as the policy requires.");
                _lifecycle.LockNow();
            }

            ShowGate();
        }

        /// <summary>
        /// Exit from the tray, gated on administrator approval.
        /// </summary>
        /// <remarks>
        /// The Exit item stays visible rather than being hidden when the user is not an
        /// administrator. Hiding it would make the agent look like it cannot be stopped at all,
        /// which is both untrue and the sort of thing that gets a monitoring tool a reputation
        /// for being sneaky. Showing it and refusing is honest about who is in control.
        /// </remarks>
        /// <summary>
        /// Exit, once a SEL LIVE administrator says so.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Not a UAC prompt, which is what this used to be. Windows can only answer "is this
        /// person a local administrator", and that is a fact about who set the laptop up rather
        /// than about who may stop somebody's attendance recording. Half the employees on a
        /// small estate are local administrators on their own machine; the HR staff who should
        /// be making this call frequently are not.
        /// </para>
        /// <para>
        /// The dialog asks for a SEL LIVE sign-in and the server checks
        /// <c>Windows Agent / Devices / Edit</c> — the same permission that already covers
        /// blocking a device — then records who approved it. Both halves matter: the decision is
        /// the organisation's, and afterwards there is an answer to "why did this PC stop
        /// reporting at half past two".
        /// </para>
        /// </remarks>
        private async void OnExitRequested(object sender, EventArgs e)
        {
            var dialog = new ExitApprovalWindow(_host);
            bool? approved = dialog.ShowDialog();

            if (approved != true)
            {
                _tray.ShowBalloon(
                    "Still running",
                    "Closing the SEL LIVE agent needs approval from a SEL LIVE administrator. "
                        + "It is still recording.");
                return;
            }

            _log.Write("Exit approved by " + (dialog.ApprovedByName ?? "an administrator") + ".");
            await StopAndQuitAsync().ConfigureAwait(true);
        }

        /// <summary>Close the work session properly, then end the process.</summary>
        private async Task StopAndQuitAsync()
        {
            await ShutdownCleanlyAsync(SessionEndReasons.AgentStopped).ConfigureAwait(true);
            Shutdown();
        }

        protected override void OnSessionEnding(SessionEndingCancelEventArgs e)
        {
            // Windows is ending the session. The coordinator's own session-state monitor also
            // sees this and closes the work session; this is the belt to that pair of braces,
            // and is bounded so it cannot delay a shutdown noticeably.
            base.OnSessionEnding(e);
            ShutdownCleanlyAsync(e.ReasonSessionEnding == ReasonSessionEnding.Shutdown
                ? SessionEndReasons.WindowsShutdown
                : SessionEndReasons.WindowsLogoff).Wait(TimeSpan.FromSeconds(6));
        }

        private async Task ShutdownCleanlyAsync(string reason)
        {
            try
            {
                if (_host != null) await _host.SignOutAsync(reason).ConfigureAwait(true);
            }
            catch (Exception error)
            {
                if (_log != null) _log.Write("Clean shutdown failed: " + error.Message);
            }
        }

        protected override void OnExit(ExitEventArgs e)
        {
            // Before the host: it unsubscribes from the coordinator's session events, and the
            // coordinator is disposed a line later.
            if (_lifecycle != null) _lifecycle.Dispose();
            if (_tray != null) _tray.Dispose();
            if (_host != null) _host.Dispose();
            if (_instanceMutex != null)
            {
                try { _instanceMutex.ReleaseMutex(); } catch (ApplicationException) { }
                _instanceMutex.Dispose();
            }
            base.OnExit(e);
        }
    }

    internal static class NativeMethods
    {
        [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
        [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
        internal static extern bool LockWorkStation();
    }
}
