using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Sel.Agent.Core;
using Sel.Agent.Core.Api;
using Sel.Agent.Core.Contracts;

namespace Sel.Agent
{
    /// <summary>
    /// The access gate (§5) and the morning dashboard (§6).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>What this window actually enforces, stated honestly.</b> §2 asks that the user not be
    /// able to click X, Alt+F4, Minimize or Escape past it, and §3 asks for the safest
    /// <i>supported</i> architecture, explicitly ruling out interfering with Ctrl+Alt+Delete.
    /// This window delivers the first list and nothing beyond it:
    /// </para>
    /// <list type="bullet">
    /// <item><description>No chrome, no close button, maximised, topmost.</description></item>
    /// <item><description>Alt+F4, Escape, Alt+Tab and Win are swallowed where a window is
    /// permitted to swallow them.</description></item>
    /// <item><description>Deactivation re-asserts focus, so a background window cannot
    /// simply be brought forward over it.</description></item>
    /// </list>
    /// <para>
    /// It is <b>not</b> a security boundary. Task Manager launched from the Secure Attention
    /// Sequence can end it; so can a second Windows account. Anyone who describes a topmost WPF
    /// window as "mandatory access control" is overselling it, and an organisation that plans a
    /// rollout on that basis will be unpleasantly surprised. Real enforcement needs Shell Launcher
    /// on Enterprise SKUs or a Credential Provider, both of which are staged separately in
    /// <c>docs/windows-agent.md</c> — and §60 is right that neither should be switched on until
    /// the monitoring path and the recovery path have been proven on real machines.
    /// </para>
    ///
    /// <para><b>The escape hatch is deliberate and documented.</b></para>
    /// <para>
    /// Ctrl+Shift+Alt+F12 closes the gate and writes the fact to the log. §3 asks for an
    /// emergency administrator recovery so nobody is permanently locked out of a PC, and a
    /// keyboard escape that leaves a trail is a far better answer than an IT team learning to
    /// boot from USB. Because the gate is not a security boundary in the first place, this
    /// concedes nothing that was not already conceded.
    /// </para>
    /// </remarks>
    public partial class AccessGateWindow : Window
    {
        private readonly AgentHost _host;
        private readonly DispatcherTimer _clock;

        /// <summary>
        /// Whether this is the blocking gate or an ordinary sign-in window.
        /// </summary>
        /// <remarks>
        /// <para>
        /// The distinction the policy actually controls. <c>requireMorningLogin</c> decides
        /// whether somebody may dismiss the sign-in and use their PC anyway — it does <b>not</b>
        /// decide whether sign-in is offered.
        /// </para>
        /// <para>
        /// Conflating the two produced a silent dead end: with the default policy the agent
        /// enrolled, found no saved session, concluded the gate "was not required", and sat in
        /// the tray signed out. A signed-out agent has no session, and with no session it records
        /// nothing — so the default configuration tracked nothing at all, for ever, while looking
        /// like it was running. §60 asks for monitoring first and enforcement later; monitoring
        /// still needs somebody to sign in.
        /// </para>
        /// </remarks>
        private readonly bool _enforce;

        private bool _released;
        private bool _signingIn;

        /// <summary>Raised when the user has signed in and pressed START MY DAY.</summary>
        public event EventHandler Released;

        /// <summary>Raised when a non-enforcing window is closed without signing in.</summary>
        public event EventHandler Dismissed;

        public AccessGateWindow(AgentHost host, bool enforce)
        {
            _host = host ?? throw new ArgumentNullException("host");
            _enforce = enforce;
            InitializeComponent();

            if (!_enforce)
            {
                // An ordinary window: resizable chrome, a close button, on the taskbar, and not
                // topmost. Same content, same sign-in, no trapping.
                WindowStyle = WindowStyle.SingleBorderWindow;
                WindowState = WindowState.Normal;
                ResizeMode = ResizeMode.CanMinimize;
                SizeToContent = SizeToContent.Manual;
                Width = 980;
                Height = 620;
                Topmost = false;
                ShowInTaskbar = true;
                WindowStartupLocation = WindowStartupLocation.CenterScreen;
            }

            _clock = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
            _clock.Tick += (s, e) => RefreshChrome();

            Loaded += OnLoaded;
            Deactivated += OnDeactivated;
            Closing += OnClosing;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            RefreshChrome();
            _clock.Start();

            AgentStatusLine.Text = "Agent " + AgentVersion.Current + " · " + OsCompatibility.Current.FriendlyName
                + " · " + _host.Notifications.DescribeSelection();

            MonitoringNotice.Text =
                "This computer records which applications are in the foreground, and active, idle and locked time. "
                + "It does not record keystrokes, passwords, clipboard contents, messages or screenshots. "
                + "Open Agent status from the tray for the full list.";

            EmailBox.Focus();
        }

        private void RefreshChrome()
        {
            Sel.Agent.Core.Security.DeviceIdentity identity = _host.IdentityStore.Read();
            DeviceNameText.Text = identity != null && !string.IsNullOrEmpty(identity.DeviceName)
                ? identity.DeviceName
                : Environment.MachineName;
            DeviceDetailText.Text = OsCompatibility.Current.FriendlyName
                + (identity == null ? "  ·  not enrolled" : "  ·  enrolled");

            DateText.Text = DateTime.Now.ToString("dddd, d MMMM yyyy  ·  HH:mm");

            AgentStatus status = _host.Coordinator.Status;
            bool online = status.Online;
            NetworkDot.Fill = new SolidColorBrush(online
                ? Color.FromRgb(0x22, 0xC5, 0x5E)
                : Color.FromRgb(0xF5, 0x9E, 0x0B));
            NetworkText.Text = online ? "Connected" : "Offline";
        }

        /* ── Sign in ─────────────────────────────────────────────────────────────────────── */

        private async void OnSignInClicked(object sender, RoutedEventArgs e)
        {
            if (_signingIn) return;

            string identifier = (EmailBox.Text ?? string.Empty).Trim();
            string password = PasswordBox.Password;

            if (identifier.Length == 0 || password.Length == 0)
            {
                ShowError("Enter your employee ID or email, and your password.");
                return;
            }

            SetBusy(true);
            HideError();

            try
            {
                using (var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(45)))
                {
                    string email = await ResolveEmailAsync(identifier, cancellation.Token).ConfigureAwait(true);
                    AgentLoginResponse login = await _host
                        .SignInAsync(email, password, cancellation.Token)
                        .ConfigureAwait(true);
                    ShowDashboard(login);
                }
            }
            catch (FirebaseAuthException error)
            {
                ShowError(error.Message);
            }
            catch (SelApiException error)
            {
                // The gate branches on the code, not the message: "awaiting approval" should
                // keep the person informed rather than look like a typo in their password.
                ShowError(error.Code == "DEVICE_NOT_APPROVED"
                    ? "This computer is registered but has not been approved yet. Ask IT to approve "
                      + (_host.IdentityStore.Read() == null ? "it" : _host.IdentityStore.Read().DeviceName)
                      + " in SEL LIVE."
                    : error.Message);
            }
            catch (OperationCanceledException)
            {
                ShowError("Signing in took too long. Check the network connection and try again.");
            }
            catch (Exception error)
            {
                ShowError("Sign-in failed: " + error.Message);
            }
            finally
            {
                // Clear the password whatever happened. There is no reason for it to survive the
                // attempt, successful or not.
                PasswordBox.Clear();
                SetBusy(false);
            }
        }

        /// <summary>
        /// Turn what was typed into an email address.
        /// </summary>
        /// <remarks>
        /// Anything containing an <c>@</c> is taken as an email and used directly. Anything else
        /// is an employee ID and is resolved through the ERP — a lookup that takes the device
        /// credential and no password, so it reveals nothing to somebody who does not already
        /// have a machine enrolled. §5 asks for "Employee ID / Email" on the form; without this
        /// the field would be mislabelled.
        /// </remarks>
        private async Task<string> ResolveEmailAsync(string identifier, CancellationToken cancellation)
        {
            if (identifier.IndexOf('@') >= 0) return identifier;
            string resolved = await _host.ResolveEmailForEmployeeAsync(identifier, cancellation).ConfigureAwait(true);
            if (string.IsNullOrEmpty(resolved))
            {
                throw new FirebaseAuthException(
                    "That employee ID was not recognised. Try your email address instead.",
                    "EMPLOYEE_NOT_FOUND", false);
            }
            return resolved;
        }

        /* ── Dashboard ───────────────────────────────────────────────────────────────────── */

        private void ShowDashboard(AgentLoginResponse login)
        {
            SignInView.Visibility = Visibility.Collapsed;
            DashboardView.Visibility = Visibility.Visible;

            MorningSummary summary = login.MorningSummary;
            GreetingText.Text = summary != null && !string.IsNullOrEmpty(summary.Greeting)
                ? summary.Greeting
                : "Welcome, " + login.UserName;

            DateTime checkIn = IsoTime.Parse(login.LoginAt).ToLocalTime();
            CheckInText.Text = "Checked in at " + checkIn.ToString("HH:mm")
                + (login.LateLogin ? "  ·  recorded as a late start" : string.Empty)
                + (login.Resumed ? "  ·  resumed today's session" : string.Empty);

            CountsGrid.Children.Clear();
            if (summary != null)
            {
                AddCount("Pending tasks", summary.PendingTasks, false);
                AddCount("Overdue tasks", summary.OverdueTasks, summary.OverdueTasks > 0);
                AddCount("Approvals", summary.PendingApprovals, summary.PendingApprovals > 0);
                AddCount("Meetings today", summary.MeetingsToday, false);
                AddCount("Reminders", summary.Reminders, false);
                AddCount("Unread", summary.UnreadNotifications, false);

                if (summary.NextMeetings != null && summary.NextMeetings.Count > 0)
                {
                    MorningMeeting next = summary.NextMeetings[0];
                    DateTime startsAt = IsoTime.Parse(next.StartAt);
                    NextMeetingText.Text = "Next: " + next.Title
                        + (startsAt == DateTime.MinValue ? string.Empty : " at " + startsAt.ToString("HH:mm"));
                    NextMeetingText.Visibility = Visibility.Visible;
                }
            }

            StartDayButton.Focus();
        }

        private void AddCount(string label, int value, bool emphasise)
        {
            var panel = new StackPanel { Margin = new Thickness(12, 10, 12, 10) };
            panel.Children.Add(new TextBlock
            {
                Text = value.ToString(),
                FontSize = 22,
                FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(emphasise
                    ? Color.FromRgb(0xB9, 0x1C, 0x1C)
                    : Color.FromRgb(0x0F, 0x17, 0x2A))
            });
            panel.Children.Add(new TextBlock
            {
                Text = label,
                FontSize = 11,
                Foreground = new SolidColorBrush(Color.FromRgb(0x64, 0x74, 0x8B))
            });
            CountsGrid.Children.Add(panel);
        }

        private void OnStartDayClicked(object sender, RoutedEventArgs e)
        {
            Release();
        }

        private void OnOpenTasks(object sender, RoutedEventArgs e) { _host.OpenErp("/office-hub/tasks"); }
        private void OnOpenApprovals(object sender, RoutedEventArgs e) { _host.OpenErp("/e-approval/inbox"); }
        private void OnOpenMeetings(object sender, RoutedEventArgs e) { _host.OpenErp("/office-hub/meetings"); }
        private void OnOpenErp(object sender, RoutedEventArgs e) { _host.OpenErp("/"); }

        /* ── Gate behaviour ──────────────────────────────────────────────────────────────── */

        private void OnKeyDown(object sender, KeyEventArgs e)
        {
            // Emergency administrator recovery (§3). Logged, so a PC that was opened this way
            // can be identified afterwards rather than being a mystery.
            if (e.Key == Key.F12
                && (Keyboard.Modifiers & (ModifierKeys.Control | ModifierKeys.Shift | ModifierKeys.Alt))
                   == (ModifierKeys.Control | ModifierKeys.Shift | ModifierKeys.Alt))
            {
                _host.Log.Write("Access gate closed by the emergency administrator shortcut.");
                Release();
                e.Handled = true;
                return;
            }

            // Only the enforcing gate swallows these. An ordinary sign-in window that ignored
            // Escape and Alt+F4 would be a trap wearing a title bar, which is worse than either.
            if (!_enforce) return;

            if (e.Key == Key.Escape || e.SystemKey == Key.F4 || e.Key == Key.LWin || e.Key == Key.RWin)
            {
                e.Handled = true;
                return;
            }

            // Alt+Tab is intercepted by the shell before it reaches a window, so handling it here
            // is best-effort — noted rather than pretended otherwise.
            if (e.SystemKey == Key.Tab) e.Handled = true;
        }

        private void OnDeactivated(object sender, EventArgs e)
        {
            if (!_enforce || _released) return;
            // Re-assert. BeginInvoke so the current activation completes first; activating
            // synchronously from inside Deactivated can loop.
            Dispatcher.BeginInvoke(new Action(() =>
            {
                if (_released) return;
                try
                {
                    Topmost = true;
                    Activate();
                }
                catch (InvalidOperationException)
                {
                    // Closing already.
                }
            }), DispatcherPriority.Background);
        }

        private void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            // Alt+F4 reaches WPF as a close request rather than a key. Cancelling here is what
            // actually stops it; the KeyDown handler alone would not.
            if (_enforce && !_released) { e.Cancel = true; return; }

            if (!_released)
            {
                // Closed without signing in. The agent stays in the tray and records nothing
                // until somebody does, so the tray says so rather than leaving them to wonder.
                EventHandler dismissed = Dismissed;
                if (dismissed != null) dismissed(this, EventArgs.Empty);
            }
        }

        private void Release()
        {
            _released = true;
            _clock.Stop();
            EventHandler handler = Released;
            if (handler != null) handler(this, EventArgs.Empty);
            Close();
        }

        /* ── Small helpers ───────────────────────────────────────────────────────────────── */

        private void SetBusy(bool busy)
        {
            _signingIn = busy;
            SignInButton.IsEnabled = !busy;
            SignInButton.Content = busy ? "Signing in…" : "Sign in";
            EmailBox.IsEnabled = !busy;
            PasswordBox.IsEnabled = !busy;
            Mouse.OverrideCursor = busy ? Cursors.Wait : null;
        }

        private void ShowError(string message)
        {
            ErrorText.Text = message;
            ErrorPanel.Visibility = Visibility.Visible;
        }

        private void HideError()
        {
            ErrorPanel.Visibility = Visibility.Collapsed;
        }
    }
}
