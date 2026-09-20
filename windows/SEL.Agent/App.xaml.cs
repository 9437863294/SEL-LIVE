using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;

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
    /// <para><b>The gate is shown only when the policy asks for it.</b></para>
    /// <para>
    /// §60 is explicit that mandatory access control must not go out before the monitoring path
    /// and the recovery path have been proven, and the default policy has
    /// <c>requireMorningLogin</c> off. So on a freshly installed fleet the agent starts silently
    /// in the tray, tracks, and asks for a sign-in only when somebody opens it — which is the
    /// right first stage of a rollout and the one this ships configured for.
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
            _tray.Show();

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
        /// Show the access gate, or leave the agent quietly in the tray.
        /// </summary>
        /// <remarks>
        /// The policy consulted here is whatever the last heartbeat or the cached default says.
        /// On a PC that has never reached the server, that is the built-in default — gate off —
        /// which is the safe way round: a network outage on the morning of a rollout must not
        /// lock a building out of its computers.
        /// </remarks>
        public void ShowGateIfRequired()
        {
            if (!_host.Coordinator.Policy.Settings.RequireMorningLogin)
            {
                _log.Write("Access gate not required by policy; the agent is running in the tray.");
                return;
            }
            ShowGate();
        }

        public void ShowGate()
        {
            var gate = new AccessGateWindow(_host);
            gate.Released += (s, e) => _log.Write("Desktop released to the user.");
            gate.Show();
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
            await _host.SignOutAsync(SessionEndReasons.UserSignout).ConfigureAwait(true);
            ShowGate();
        }

        private async void OnExitRequested(object sender, EventArgs e)
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
