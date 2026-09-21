using System;
using System.IO;
using System.Net.Http;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using Newtonsoft.Json.Linq;
using Sel.Agent.Core;
using Sel.Agent.Core.Security;

namespace Sel.Agent
{
    /// <summary>
    /// First-run setup: ask for the ERP address, fetch the rest from it, write the configuration.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Replaces the error dialog that used to appear when <c>agent.config.json</c> was missing.
    /// That dialog named a file path and exited, which is a dead end — and it also meant the MSI
    /// could only be installed from a command line carrying the address and the Firebase key as
    /// properties, so double-clicking it could never work.
    /// </para>
    /// <para>
    /// <b>Only one field is genuinely required.</b> The Firebase Web API key is fetched from
    /// <c>/api/windows-agent/bootstrap</c> on the server the administrator just named. It is
    /// public — the same value the login page ships to every browser — so asking a human to copy
    /// it onto each PC added a transcription error for no security benefit.
    /// </para>
    /// <para>
    /// <b>It writes where it can.</b> ProgramData is the right home, shared by the service and
    /// the agent, but it needs the directory to be writable — which it is after an MSI install,
    /// and often is not when somebody has copied the binaries onto a machine by hand. So the
    /// write falls back to a file beside the executable, which <see cref="AgentConfiguration.Load"/>
    /// already looks for, and the window says which one it used. A setup screen that succeeds and
    /// then silently has no effect is worse than one that fails.
    /// </para>
    /// </remarks>
    public partial class FirstRunSetupWindow : Window
    {
        private readonly AgentLog _log;
        private string _resolvedApiKey;

        /// <summary>The configuration that was saved, or null if the user closed without saving.</summary>
        public AgentConfiguration Result { get; private set; }

        public FirstRunSetupWindow(AgentConfiguration existing, AgentLog log)
        {
            _log = log;
            InitializeComponent();

            // Pre-filled with the company's own address so the common case is "click Save".
            // An existing value still wins, because somebody who already pointed this PC at a
            // staging server did so on purpose.
            UrlBox.Text = existing != null && !string.IsNullOrEmpty(existing.ApiBaseUrl)
                ? existing.ApiBaseUrl
                : SelLiveDeployment.DefaultApiBaseUrl;
            if (existing != null && !string.IsNullOrEmpty(existing.EnrollmentCode))
            {
                CodeBox.Text = existing.EnrollmentCode;
            }

            FooterText.Text = "Settings are stored for all users of this computer. "
                + (IsElevated()
                    ? "You are running as an administrator."
                    : "If saving fails, right-click the agent and choose Run as administrator.");

            Loaded += (s, e) =>
            {
                UrlBox.Focus();
                UrlBox.CaretIndex = UrlBox.Text.Length;
            };
        }

        /* ── Actions ─────────────────────────────────────────────────────────────────────── */

        private async void OnTestClicked(object sender, RoutedEventArgs e)
        {
            await TestAsync(true).ConfigureAwait(true);
        }

        private async void OnSaveClicked(object sender, RoutedEventArgs e)
        {
            if (!await TestAsync(false).ConfigureAwait(true)) return;

            string url = NormalizeUrl(UrlBox.Text);
            var config = new AgentConfiguration
            {
                ApiBaseUrl = url,
                FirebaseApiKey = _resolvedApiKey,
                EnrollmentCode = string.IsNullOrWhiteSpace(CodeBox.Text) ? null : CodeBox.Text.Trim().ToUpperInvariant(),
                VerboseLogging = false,
            };

            string writtenTo;
            if (!TryWrite(config, out writtenTo))
            {
                ShowStatus(
                    "The configuration could not be saved to either location. Close the agent, "
                    + "right-click it and choose Run as administrator, then try again.",
                    false);
                return;
            }

            _log.Write("First-run setup wrote the configuration to " + writtenTo + ".");
            Result = config;
            DialogResult = true;
            Close();
        }

        private void OnCancelClicked(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
            Close();
        }

        /* ── Bootstrap ───────────────────────────────────────────────────────────────────── */

        /// <summary>
        /// Contact the named server and read its public Firebase configuration.
        /// </summary>
        /// <remarks>
        /// Doubles as the connectivity check, which is why the Test button and Save share it:
        /// it proves the address resolves, the TLS handshake works, and the thing answering is
        /// actually a SEL LIVE server rather than a captive portal or somebody's router.
        /// </remarks>
        private async Task<bool> TestAsync(bool announceSuccess)
        {
            string url = NormalizeUrl(UrlBox.Text);
            if (string.IsNullOrEmpty(url))
            {
                ShowStatus("Enter the address of your SEL LIVE installation.", false);
                return false;
            }

            Uri parsed;
            if (!Uri.TryCreate(url, UriKind.Absolute, out parsed)
                || (parsed.Scheme != Uri.UriSchemeHttps && parsed.Scheme != Uri.UriSchemeHttp))
            {
                ShowStatus("That does not look like a web address. It should start with https://", false);
                return false;
            }

            bool isLoopback = parsed.IsLoopback
                || string.Equals(parsed.Host, "localhost", StringComparison.OrdinalIgnoreCase);
            if (parsed.Scheme == Uri.UriSchemeHttp && !isLoopback)
            {
                // Refused rather than warned about: over plain http this computer's credential
                // would travel in clear on every request for the life of the installation.
                ShowStatus(
                    "Plain http is only allowed for a development server on this machine. "
                    + "Use https:// for a real SEL LIVE installation.",
                    false);
                return false;
            }

            SetBusy(true);
            try
            {
                TlsBootstrap.Configure();
                using (var http = new HttpClient())
                {
                    http.Timeout = TimeSpan.FromSeconds(20);
                    http.DefaultRequestHeaders.UserAgent.ParseAdd("SEL-LIVE-Agent-Setup/" + AgentVersion.Current);

                    using (HttpResponseMessage response = await http
                        .GetAsync(url + "/api/windows-agent/bootstrap", CancellationToken.None)
                        .ConfigureAwait(true))
                    {
                        string body = await response.Content.ReadAsStringAsync().ConfigureAwait(true);

                        if (!response.IsSuccessStatusCode)
                        {
                            ShowStatus(DescribeHttpFailure(response.StatusCode, body, url), false);
                            return false;
                        }

                        JObject parsedBody;
                        try
                        {
                            parsedBody = JObject.Parse(body);
                        }
                        catch (Exception)
                        {
                            // An HTML page rather than JSON: usually a proxy, a captive portal, or
                            // the wrong host entirely.
                            ShowStatus(
                                "Something answered at that address, but it is not a SEL LIVE server. "
                                + "Check the address and that you are on the company network.",
                                false);
                            return false;
                        }

                        string key = (string)parsedBody["firebaseApiKey"];
                        if (string.IsNullOrEmpty(key))
                        {
                            ShowStatus(
                                (string)parsedBody["error"]
                                ?? "That server did not return a Firebase configuration. Ask IT to check the server setup.",
                                false);
                            return false;
                        }

                        _resolvedApiKey = key;
                        if (announceSuccess)
                        {
                            ShowStatus(
                                "Connected to SEL LIVE (project " + (string)parsedBody["projectId"] + "). "
                                + "Press Save and start.",
                                true);
                        }
                        return true;
                    }
                }
            }
            catch (Exception error)
            {
                ShowStatus(DescribeNetworkFailure(error, parsed), false);
                return false;
            }
            finally
            {
                SetBusy(false);
            }
        }

        private static string DescribeHttpFailure(System.Net.HttpStatusCode status, string body, string url)
        {
            if ((int)status == 404)
            {
                return "That address answered, but has no Windows Agent support. "
                    + "Check the address, and that the SEL LIVE version deployed there includes the agent.";
            }
            if ((int)status == 503)
            {
                try
                {
                    string message = (string)JObject.Parse(body)["error"];
                    if (!string.IsNullOrEmpty(message)) return message;
                }
                catch (Exception)
                {
                    // Fall through to the generic message below.
                }
            }
            return "The server at " + url + " returned " + (int)status + ".";
        }

        /// <summary>
        /// Turn a transport failure into something the person in front of the PC can act on.
        /// </summary>
        /// <remarks>
        /// The default text for a TLS failure on Windows 7 is "An error occurred while sending the
        /// request", which sends an administrator to look at the firewall for an afternoon. Naming
        /// TLS on the one OS where it is usually the cause turns that into a five-minute fix.
        /// </remarks>
        private static string DescribeNetworkFailure(Exception error, Uri target)
        {
            Exception inner = error;
            while (inner.InnerException != null) inner = inner.InnerException;

            if (inner is System.Security.Authentication.AuthenticationException)
            {
                return OsCompatibility.Current.IsWindows7
                    ? "Secure connection failed. On Windows 7 this is almost always TLS 1.2 not being "
                      + "enabled — see the agent deployment guide, then try again. (" + inner.Message + ")"
                    : "Secure connection failed: " + inner.Message;
            }

            if (inner is TaskCanceledException || inner is TimeoutException)
            {
                return "No answer from " + target.Host + " within 20 seconds. Check the address and the network.";
            }

            return "Could not reach " + target.Host + ": " + inner.Message;
        }

        /* ── Writing ─────────────────────────────────────────────────────────────────────── */

        /// <summary>
        /// Save to ProgramData, falling back to a file beside the executable.
        /// </summary>
        /// <remarks>
        /// The fallback is what makes a hand-copied installation work at all, and it is the same
        /// location <see cref="AgentConfiguration.Load"/> already searches second. It is reported
        /// to the user rather than hidden, because a per-folder configuration behaves differently
        /// from a machine-wide one: the Windows service will not see it.
        /// </remarks>
        private bool TryWrite(AgentConfiguration config, out string writtenTo)
        {
            writtenTo = null;

            try
            {
                Directory.CreateDirectory(DeviceIdentityStore.DefaultDirectory);
                DeviceIdentityStore.TryHardenAcl(DeviceIdentityStore.DefaultDirectory);
                File.WriteAllText(
                    AgentConfiguration.DefaultPath,
                    Newtonsoft.Json.JsonConvert.SerializeObject(config, Newtonsoft.Json.Formatting.Indented));
                writtenTo = AgentConfiguration.DefaultPath;
                return true;
            }
            catch (Exception error)
            {
                _log.Write("Could not write the configuration to ProgramData (" + error.Message + "); trying beside the executable.");
            }

            try
            {
                string beside = Path.Combine(
                    Path.GetDirectoryName(typeof(FirstRunSetupWindow).Assembly.Location) ?? ".",
                    "agent.config.json");
                File.WriteAllText(
                    beside,
                    Newtonsoft.Json.JsonConvert.SerializeObject(config, Newtonsoft.Json.Formatting.Indented));
                writtenTo = beside;
                ShowStatus(
                    "Saved beside the agent rather than in ProgramData. This computer's Windows service "
                    + "will not see it — fine for testing, but run the installer for a real deployment.",
                    true);
                return true;
            }
            catch (Exception error)
            {
                _log.Write("Could not write the configuration beside the executable either: " + error.Message);
                return false;
            }
        }

        /* ── Small helpers ───────────────────────────────────────────────────────────────── */

        /// <summary>Trim, drop a trailing slash, and add https:// when no scheme was typed.</summary>
        private static string NormalizeUrl(string raw)
        {
            string value = (raw ?? string.Empty).Trim();
            if (value.Length == 0 || value == "https://" || value == "http://") return string.Empty;
            if (value.IndexOf("://", StringComparison.Ordinal) < 0) value = "https://" + value;
            return value.TrimEnd('/');
        }

        private static bool IsElevated()
        {
            try
            {
                using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
                {
                    return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        private void SetBusy(bool busy)
        {
            TestButton.IsEnabled = !busy;
            SaveButton.IsEnabled = !busy;
            UrlBox.IsEnabled = !busy;
            CodeBox.IsEnabled = !busy;
            Mouse.OverrideCursor = busy ? Cursors.Wait : null;
            if (busy) ShowStatus("Contacting the server…", true);
        }

        private void ShowStatus(string message, bool positive)
        {
            StatusText.Text = message;
            StatusText.Foreground = new SolidColorBrush(positive
                ? Color.FromRgb(0x15, 0x80, 0x3D)
                : Color.FromRgb(0xB9, 0x1C, 0x1C));
            StatusPanel.Background = new SolidColorBrush(positive
                ? Color.FromRgb(0xF0, 0xFD, 0xF4)
                : Color.FromRgb(0xFE, 0xF2, 0xF2));
            StatusPanel.BorderBrush = new SolidColorBrush(positive
                ? Color.FromRgb(0xBB, 0xF7, 0xD0)
                : Color.FromRgb(0xFE, 0xCA, 0xCA));
            StatusPanel.BorderThickness = new Thickness(1);
            StatusPanel.Visibility = Visibility.Visible;
        }
    }
}
