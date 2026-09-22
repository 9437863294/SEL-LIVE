using System;
using System.Diagnostics;
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

            // First line of the process, before anything that can fail. See StartupTrace for why
            // this is separate from the activity log and always on.
            StartupTrace.Begin();

            // The uninstaller asking permission. Handled before the single-instance mutex, and
            // that order is the whole of its correctness: the agent is normally already running,
            // so a second copy reaching the mutex check would exit 0 — which the uninstaller
            // would read as "approved" and remove the agent without asking anybody.
            if (HasSwitch(e.Args, "--authorize-uninstall"))
            {
                StartupTrace.Write("asked to authorise an uninstall");
                AuthorizeUninstall();
                return;
            }

            bool createdNew;
            _instanceMutex = new Mutex(true, InstanceMutexName, out createdNew);
            if (!createdNew)
            {
                // Silent to the user: a second copy started by the service or a stray shortcut
                // should simply go away, not claim something is wrong. Not silent on disk — this
                // is the most common reason a launch "fails", and it took a morning to establish
                // that the previous version was not doing it.
                StartupTrace.Write("exiting: another copy is already running in this session");
                Shutdown();
                return;
            }
            StartupTrace.Write("single-instance mutex acquired");

            AgentConfiguration config = AgentConfiguration.Load();
            _log = new AgentLog(config.VerboseLogging);
            StartupTrace.Write("configuration: " + (config.IsUsable
                ? "usable, pointing at " + config.ApiBaseUrl
                : "NOT usable — " + (config.DescribeProblem() ?? "reason unknown")));

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
                StartupTrace.Write("exiting: unsupported Windows — " + OsCompatibility.Current.UnsupportedReason);
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
                StartupTrace.Write("showing first-run setup");
                var setup = new FirstRunSetupWindow(config, _log);
                bool? completed = setup.ShowDialog();
                if (completed != true || setup.Result == null)
                {
                    _log.Write("First-run setup was cancelled; the agent cannot start.");
                    StartupTrace.Write("exiting: first-run setup was closed without saving");
                    Shutdown();
                    return;
                }
                config = setup.Result;
            }

            _host = new AgentHost(config, Dispatcher, _log);
            _host.DirectiveReceived += OnDirectiveReceived;
            StartupTrace.Write("host constructed");

            _tray = new TrayController(_host);
            _tray.ExitRequested += OnExitRequested;
            _tray.SignOutRequested += OnSignOutRequested;
            _tray.SignInRequested += (sender, args) => ShowGate();
            _tray.Show();
            StartupTrace.Write("tray icon shown; start-up complete");

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

        private static bool HasSwitch(string[] args, string name)
        {
            if (args == null) return false;
            foreach (string value in args)
            {
                if (string.Equals(value, name, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        /// <summary>
        /// Ask a SEL LIVE administrator whether this computer may have the agent removed.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Run by the installer, which blocks the uninstall unless this process exits 0. The
        /// approval is the same one the tray's Exit asks for — <c>Devices / Edit</c> — and is
        /// recorded server-side as its own audit action, so removing the agent and closing it are
        /// distinguishable a year later.
        /// </para>
        /// <para>
        /// <b>What this is not.</b> It is not a way of preventing removal. A local administrator
        /// can stop the service, delete the folder, or uninstall silently, and §7's position that
        /// the agent is not a security boundary is unchanged. What it removes is the *casual*
        /// route — Apps &amp; Features, two clicks, no record — and what it adds is a name in the
        /// audit trail beside every PC that legitimately stopped being monitored.
        /// </para>
        /// <para>
        /// A machine that cannot reach SEL LIVE, or that was never enrolled, is allowed through.
        /// Blocking there would mean an unenrolled PC could never be cleaned up, and a site office
        /// with a dead link could not remove a broken agent — which turns a support call into a
        /// re-image.
        /// </para>
        /// </remarks>
        private void AuthorizeUninstall()
        {
            AgentConfiguration config = AgentConfiguration.Load();
            _log = new AgentLog(config.VerboseLogging);

            // Nobody there to ask.
            //
            // A removal driven by SCCM, GPO or a scheduled task runs as SYSTEM in session 0,
            // where a window would be drawn on a desktop no human can see and this process would
            // wait for a click that can never come — leaving msiexec hung on a machine in a site
            // office. Those removals are allowed, and the trace says so.
            //
            // The installer cannot make this call: Burn runs its MSI with the UI level set to
            // none, so from inside the package an interactive uninstall and a silent one are
            // indistinguishable. Interactivity is a fact about this process, so it is decided
            // here.
            if (!Environment.UserInteractive || Process.GetCurrentProcess().SessionId == 0)
            {
                StartupTrace.Write("uninstall allowed: no interactive desktop to ask on");
                Shutdown(0);
                return;
            }

            if (!config.IsUsable)
            {
                StartupTrace.Write("uninstall allowed: this computer has no usable configuration");
                Shutdown(0);
                return;
            }

            AgentHost host = null;
            try
            {
                host = new AgentHost(config, Dispatcher, _log);
                if (!host.IdentityStore.Exists)
                {
                    StartupTrace.Write("uninstall allowed: this computer is not enrolled");
                    Shutdown(0);
                    return;
                }

                using (var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(30)))
                {
                    // The device credential has to be loaded before the approval call: the route
                    // requires it, so that an approval cannot be manufactured from any machine.
                    host.EnsureEnrolledAsync(cancellation.Token).Wait(TimeSpan.FromSeconds(30));
                }

                var approval = new ExitApprovalWindow(host, ApprovalPurpose.Uninstall);

                // Nobody answering is a refusal, not a hang. Without this, an uninstall started
                // and walked away from leaves msiexec waiting for ever and the machine in a state
                // where no other installation can run.
                var unanswered = new System.Windows.Threading.DispatcherTimer
                {
                    Interval = TimeSpan.FromMinutes(3),
                };
                unanswered.Tick += (sender, args) =>
                {
                    unanswered.Stop();
                    if (approval.IsLoaded && approval.DialogResult == null)
                    {
                        StartupTrace.Write("uninstall refused: the approval window went unanswered for 3 minutes");
                        approval.DialogResult = false;
                        approval.Close();
                    }
                };
                unanswered.Start();

                bool? approved = approval.ShowDialog();
                unanswered.Stop();

                if (approved == true)
                {
                    _log.Write("Uninstall approved by " + approval.ApprovedByName + ".");
                    StartupTrace.Write("uninstall approved by " + approval.ApprovedByName);
                    Shutdown(0);
                }
                else
                {
                    _log.Write("Uninstall was not approved; the installer will stop.");
                    StartupTrace.Write("uninstall refused");
                    Shutdown(1);
                }
            }
            catch (Exception error)
            {
                // Allowed through, with the reason on record. See the remarks: a machine that
                // cannot ask must still be serviceable.
                _log.Write("Uninstall approval could not be requested: " + error.Message);
                StartupTrace.Write("uninstall allowed: approval could not be requested — " + error.Message);
                Shutdown(0);
            }
            finally
            {
                if (host != null) host.Dispose();
            }
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
                        // Ask for a code rather than dead-ending in a balloon tip.
                        //
                        // This is the common case after an MSI installed without ENROLLMENTCODE,
                        // and after a code that was valid at packaging time has expired or been
                        // used up. Previously all of them produced "Ask IT to complete the
                        // installation" and a PC that recorded nothing; the setup window checks a
                        // code with the server before accepting it, so by the time it returns the
                        // retry is known to be worth making.
                        enrolled = await AskForEnrolmentCodeAsync(cancellation.Token).ConfigureAwait(true);
                    }

                    if (!enrolled)
                    {
                        _tray.ShowBalloon("Not enrolled",
                            "This computer is not registered with SEL LIVE. Ask IT for a current enrolment code.");
                        return;
                    }

                    // Before anything decides whether the gate can be dismissed. Policy
                    // otherwise only arrives with a login or a heartbeat, both of which need
                    // somebody already signed in — so a cold-started PC would offer a
                    // dismissible gate however the policy was configured.
                    await _host.Coordinator
                        .RefreshPolicyBeforeLoginAsync(cancellation.Token)
                        .ConfigureAwait(true);

                    // A restart mid-morning should not demand a password again unless the policy
                    // says so. The refresh token makes that possible without weakening anything:
                    // it is per-Windows-user and DPAPI-protected.
                    //
                    // `requireLoginAfterRestart` is what says so, and until now nothing read it.
                    // It was in the wire contract and in the admin screen, and an administrator
                    // switching it on got no change in behaviour at all: the agent resumed the
                    // saved session silently on every start. A setting that is offered and
                    // ignored is worse than one that is absent.
                    bool askAgain = _host.Coordinator.Policy.Settings.RequireLoginAfterRestart;
                    if (askAgain) _log.Write("Policy requires a sign-in after restart; not resuming the saved session.");

                    AgentLoginResponse resumed = askAgain
                        ? null
                        : await _host.TryResumeAsync(cancellation.Token).ConfigureAwait(true);
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
        /// Show the setup window to collect a working enrolment code, then enrol with it.
        /// </summary>
        /// <remarks>
        /// <para>
        /// The window will not return until the server has accepted the code, so this is not a
        /// loop of hopeful retries — one attempt is made against a code that has already been
        /// checked. A second failure therefore means something changed between the check and the
        /// registration, which is worth reporting rather than retrying.
        /// </para>
        /// <para>
        /// Closing the window is allowed and leaves the PC unenrolled. That is deliberate: this
        /// agent is not a security boundary (§7), and a person who cannot reach IT should not be
        /// left with a computer that will not let them work. The balloon says what is wrong and
        /// the tray keeps saying it.
        /// </para>
        /// </remarks>
        private async Task<bool> AskForEnrolmentCodeAsync(CancellationToken cancellation)
        {
            var setup = new FirstRunSetupWindow(
                AgentConfiguration.Load(), _log, _host.LastEnrollmentError);

            if (setup.ShowDialog() != true || setup.Result == null
                || string.IsNullOrEmpty(setup.Result.EnrollmentCode))
            {
                _log.Write("Enrolment was not completed; this computer stays unregistered.");
                return false;
            }

            bool enrolled = await _host
                .RetryEnrolmentAsync(setup.Result.EnrollmentCode, cancellation)
                .ConfigureAwait(true);

            if (!enrolled)
            {
                MessageBox.Show(
                    _host.LastEnrollmentError
                        ?? "This computer could not be registered with SEL LIVE.",
                    "SEL LIVE Agent", MessageBoxButton.OK, MessageBoxImage.Warning);
            }

            return enrolled;
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
            // An installation that reports without enforcing anything can let people close the
            // agent. On by default, because §26 is about a session somebody cannot silently stop.
            if (!_host.Coordinator.Policy.Settings.RequireAdminToExit)
            {
                _log.Write("Exit taken; approval is not required under the current policy.");
                await StopAndQuitAsync().ConfigureAwait(true);
                return;
            }

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
            // The other half of the start-up trail: a machine that stopped reporting at 14:05
            // needs "the agent exited at 14:05" to be a fact rather than an inference.
            StartupTrace.Write("process exiting with code " + e.ApplicationExitCode);

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
