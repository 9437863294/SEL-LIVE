using System;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Security;

namespace Sel.Agent
{
    /// <summary>
    /// Agent health (§47) and the monitoring disclosure (§52).
    /// </summary>
    /// <remarks>
    /// The disclosure lists are hard-coded here and mirror
    /// <c>DEFAULT_MONITORING_DISCLOSURE</c> on the server, on purpose. An administrator can edit
    /// the covering statement; they cannot edit the "never collected" list, because that list
    /// describes what the code does and a policy page able to disagree with the code would be
    /// worse than no policy page at all. If the agent ever started capturing something new, this
    /// list would have to change in the same commit — which is the point.
    /// </remarks>
    public partial class AgentStatusWindow : Window
    {
        private readonly AgentHost _host;
        private readonly DispatcherTimer _refresh;

        public AgentStatusWindow(AgentHost host)
        {
            _host = host ?? throw new ArgumentNullException("host");
            InitializeComponent();

            _refresh = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            _refresh.Tick += (s, e) => RefreshFacts();

            Loaded += OnLoaded;
            Closed += (s, e) =>
            {
                _refresh.Stop();
                _host.Log.LineWritten -= OnLineWritten;
            };
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            RefreshFacts();
            BuildDisclosure();
            BuildPolicy();

            LogBox.Text = string.Join(Environment.NewLine, _host.Log.Tail());
            LogBox.ScrollToEnd();
            _host.Log.LineWritten += OnLineWritten;

            _refresh.Start();
        }

        private void OnLineWritten(object sender, string line)
        {
            // Raised from background threads — the log is written by both agent loops.
            Dispatcher.BeginInvoke(new Action(() =>
            {
                LogBox.AppendText(Environment.NewLine + line);
                LogBox.ScrollToEnd();
            }));
        }

        private void RefreshFacts()
        {
            AgentStatus status = _host.Coordinator.Status;
            DeviceIdentity identity = _host.IdentityStore.Read();

            HeadlineText.Text = status.SignedIn
                ? "Recording work for " + status.UserName
                : "Signed out — nothing is being recorded";

            SubtitleText.Text = status.Online
                ? "Connected to SEL LIVE."
                : "Offline. Activity is being recorded locally and will sync automatically.";

            FactsLeft.Children.Clear();
            FactsRight.Children.Clear();

            AddFact(FactsLeft, "Computer", identity != null ? identity.DeviceName : Environment.MachineName);
            AddFact(FactsLeft, "Windows", OsCompatibility.Current.FriendlyName + " (build " + OsCompatibility.Current.Build + ")");
            AddFact(FactsLeft, "Agent version", AgentVersion.Current);
            AddFact(FactsLeft, "Notifications", _host.Notifications.DescribeSelection());

            AddFact(FactsRight, "Signed in at",
                status.SignedInAtUtc.HasValue ? status.SignedInAtUtc.Value.ToLocalTime().ToString("HH:mm") : "—");
            AddFact(FactsRight, "Current state", status.SignedIn ? status.Presence : "—");
            AddFact(FactsRight, "In foreground", status.CurrentApplication ?? "—");
            AddFact(FactsRight, "Waiting to upload",
                status.QueuedSpans < 0 ? "unknown" : status.QueuedSpans + (status.QueuedSpans == 1 ? " record" : " records"),
                status.QueuedSpans > 500);

            if (!string.IsNullOrEmpty(status.LastError))
            {
                AddFact(FactsRight, "Last problem", status.LastError, true);
            }
        }

        private static void AddFact(Panel target, string label, string value, bool warn = false)
        {
            var row = new StackPanel { Margin = new Thickness(0, 0, 12, 9) };
            row.Children.Add(new TextBlock
            {
                Text = label,
                FontSize = 11,
                Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8))
            });
            row.Children.Add(new TextBlock
            {
                Text = value,
                FontSize = 13,
                TextWrapping = TextWrapping.Wrap,
                Foreground = new SolidColorBrush(warn
                    ? Color.FromRgb(0xB9, 0x1C, 0x1C)
                    : Color.FromRgb(0x0F, 0x17, 0x2A))
            });
            target.Children.Add(row);
        }

        private void BuildDisclosure()
        {
            DisclosurePanel.Children.Clear();

            AddSection("Recorded on this computer", new[]
            {
                "The name of the application in the foreground, and how long it was there.",
                "Whether the keyboard and mouse were in use, idle, or the computer was locked.",
                "Sign-in and sign-out times, and which computer they happened on.",
                "Actions taken inside SEL LIVE — which record was opened, approved or updated.",
                "The agent's own health: its version, its upload queue, and whether it can reach the server."
            }, Color.FromRgb(0x0F, 0x17, 0x2A));

            AddSection("Never recorded", new[]
            {
                "Keystrokes. The agent contains no keyboard hook of any kind.",
                "Passwords, or the contents of any password field.",
                "Clipboard contents.",
                "The text of emails, chats or documents.",
                "Screenshots, screen recording, webcam or microphone.",
                "Browsing history, search terms, or the address of any page beyond its domain.",
                "Anything from a personal device — the agent runs only on company computers."
            }, Color.FromRgb(0x15, 0x80, 0x3D));

            var policy = _host.Coordinator.Policy.Settings;
            AddSection("Optional, and currently " + (policy.WindowTitleTrackingEnabled || policy.BrowserDomainTrackingEnabled ? "partly enabled" : "switched off"), new[]
            {
                "Window titles, with emails and card numbers removed — currently "
                    + (policy.WindowTitleTrackingEnabled ? "ENABLED for this computer." : "off."),
                "Website domains, with no paths or search terms — currently "
                    + (policy.BrowserDomainTrackingEnabled ? "ENABLED for this computer." : "off.")
            }, Color.FromRgb(0x92, 0x40, 0x0E));
        }

        private void AddSection(string heading, string[] lines, Color accent)
        {
            DisclosurePanel.Children.Add(new TextBlock
            {
                Text = heading,
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(accent),
                Margin = new Thickness(0, 12, 0, 6)
            });
            foreach (string line in lines)
            {
                DisclosurePanel.Children.Add(new TextBlock
                {
                    Text = "•  " + line,
                    FontSize = 12,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x33, 0x41, 0x55)),
                    Margin = new Thickness(0, 0, 0, 4)
                });
            }
        }

        private void BuildPolicy()
        {
            PolicyPanel.Children.Clear();
            AgentPolicySettings settings = _host.Coordinator.Policy.Settings;

            AddPolicyRow("Access gate at start-up", settings.RequireMorningLogin ? "Required" : "Not required");
            AddPolicyRow("Idle after", settings.IdleThresholdSeconds / 60 + " minutes");
            AddPolicyRow("Extended idle after", settings.ExtendedIdleThresholdSeconds / 60 + " minutes");
            AddPolicyRow("Heartbeat every", settings.HeartbeatIntervalSeconds + " seconds");
            AddPolicyRow("Upload every", settings.ActivityBatchIntervalSeconds + " seconds");
            AddPolicyRow("Application tracking", settings.ApplicationTrackingEnabled ? "On" : "Off");
            AddPolicyRow("Window titles", settings.WindowTitleTrackingEnabled ? "On" : "Off");
            AddPolicyRow("Website domains", settings.BrowserDomainTrackingEnabled ? "On" : "Off");
            AddPolicyRow("Notifications", settings.NotificationMode);
            AddPolicyRow("Working hours", settings.WorkdayStart + " – " + settings.WorkdayEnd);
            AddPolicyRow("Offline grace", settings.OfflineGraceMinutes + " minutes");
            AddPolicyRow("Raw activity kept for", settings.RawActivityRetentionDays + " days");
            AddPolicyRow("You may pause tracking", settings.AllowUserPauseTracking ? "Yes" : "No");
        }

        private void AddPolicyRow(string label, string value)
        {
            var grid = new Grid { Margin = new Thickness(0, 0, 0, 7) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(220) });
            grid.ColumnDefinitions.Add(new ColumnDefinition());

            var labelBlock = new TextBlock
            {
                Text = label,
                FontSize = 12,
                Foreground = new SolidColorBrush(Color.FromRgb(0x64, 0x74, 0x8B))
            };
            var valueBlock = new TextBlock
            {
                Text = value,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A))
            };
            Grid.SetColumn(valueBlock, 1);
            grid.Children.Add(labelBlock);
            grid.Children.Add(valueBlock);
            PolicyPanel.Children.Add(grid);
        }

        /* ── Buttons ─────────────────────────────────────────────────────────────────────── */

        /// <summary>
        /// Run the prerequisite checks and print the result into the log tab.
        /// </summary>
        /// <remarks>
        /// This is the button IT will actually use. On Windows 7 the overwhelmingly likely reason
        /// an agent cannot sync is TLS 1.2, and the alternative to this check is somebody reading
        /// "the connection was closed unexpectedly" and looking at the firewall for an afternoon.
        /// </remarks>
        private async void OnRunChecks(object sender, RoutedEventArgs e)
        {
            RunChecksButton.IsEnabled = false;
            try
            {
                var report = new StringBuilder();
                report.AppendLine("— Connection checks —");
                report.AppendLine(OsCompatibility.Current.Describe());
                report.AppendLine("DPAPI self-test: " + (DpapiProtector.SelfTest() ? "passed" : "FAILED"));

                TlsBootstrap.SchannelState schannel = TlsBootstrap.InspectSchannel();
                report.AppendLine("TLS 1.2 configuration: " + (schannel.LooksUsable ? "looks correct" : "NEEDS ATTENTION"));
                foreach (string remedy in schannel.Remediation) report.AppendLine("   · " + remedy);

                Uri baseUri;
                if (Uri.TryCreate(_host.Configuration.ApiBaseUrl, UriKind.Absolute, out baseUri))
                {
                    TlsBootstrap.ProbeResult probe = await Task.Run(() =>
                        TlsBootstrap.Probe(baseUri.Host, baseUri.Port, 8000)).ConfigureAwait(true);
                    report.AppendLine(probe.Succeeded
                        ? "Handshake with " + baseUri.Host + ": " + probe.NegotiatedProtocol
                        : "Handshake with " + baseUri.Host + " FAILED: " + probe.Error);
                }

                foreach (string line in report.ToString().Split(new[] { Environment.NewLine }, StringSplitOptions.RemoveEmptyEntries))
                {
                    _host.Log.Write(line);
                }
            }
            finally
            {
                RunChecksButton.IsEnabled = true;
            }
        }

        private async void OnSyncNow(object sender, RoutedEventArgs e)
        {
            SyncButton.IsEnabled = false;
            try
            {
                await _host.Coordinator.SyncNowAsync().ConfigureAwait(true);
                RefreshFacts();
            }
            finally
            {
                SyncButton.IsEnabled = true;
            }
        }

        private void OnClose(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }
}
