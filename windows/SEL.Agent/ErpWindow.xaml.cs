using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Sel.Agent.Core;

namespace Sel.Agent
{
    /// <summary>
    /// The ERP, embedded in the agent, signed in as whoever signed in to the agent.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Created only where <see cref="ErpBrowser"/> has established that WebView2 is usable.
    /// Everything about availability is decided there; this window assumes it works and reports
    /// honestly when it does not.
    /// </para>
    ///
    /// <para><b>Single sign-on, without the token ever appearing in a URL.</b></para>
    /// <para>
    /// The embedded browser is its own profile, so it starts with no Firebase session. The agent
    /// asks the server for a short-lived custom token and injects it with
    /// <c>AddScriptToExecuteOnDocumentCreatedAsync</c>, which runs before the document exists.
    /// The landing page reads it out of <c>window</c> and exchanges it for a real session.
    /// </para>
    /// <para>
    /// Putting it in the query string would have been three lines shorter and would have written
    /// a one-hour bearer credential into browser history, into the <c>Referer</c> of the first
    /// outbound request, and into the access log of everything in between.
    /// </para>
    ///
    /// <para><b>The profile is per Windows user, and is not the person's own browser profile.</b></para>
    /// <para>
    /// Under <c>%LOCALAPPDATA%</c>, so two people sharing a PC never share an ERP session, and
    /// Windows' own profile isolation does the work. It is also why signing out of the agent can
    /// meaningfully clear it.
    /// </para>
    /// </remarks>
    public partial class ErpWindow : Window
    {
        private readonly AgentHost _host;
        private readonly string _baseUrl;
        private bool _initialised;

        /// <summary>
        /// The start-up in flight, so it happens once.
        /// </summary>
        /// <remarks>
        /// <c>Show()</c> raises <c>Loaded</c>, and both <see cref="ShowPath"/> and the Loaded
        /// handler asked to initialise. A plain <c>if (_initialised) return</c> does not stop
        /// that: neither call has finished when the other starts, so both passed the guard, both
        /// built a <c>CoreWebView2Environment</c>, and the second one failed with "WebView2 was
        /// already initialized with a different CoreWebView2Environment" — an error in the log
        /// and a window that only worked on the retry.
        ///
        /// Everything here runs on the UI thread, so holding the Task is enough; no lock.
        /// </remarks>
        private Task _initialising;

        private string _pendingPath;

        public ErpWindow(AgentHost host)
        {
            _host = host ?? throw new ArgumentNullException("host");
            _baseUrl = (host.Configuration.ApiBaseUrl ?? string.Empty).TrimEnd('/');
            InitializeComponent();

            FooterText.Text = "SEL LIVE · " + _baseUrl
                + "   ·   This window is part of the SEL LIVE agent. Your activity is recorded as usual.";

            SetNavigationEnabled(false);
            Loaded += OnLoaded;
        }

        /// <summary>Navigate to a path, starting the browser if it is not up yet.</summary>
        public async void ShowPath(string path)
        {
            _pendingPath = path;
            Show();
            if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
            Activate();

            if (_initialised) NavigateTo(path);
            else await InitialiseAsync().ConfigureAwait(true);
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            if (!_initialised) await InitialiseAsync().ConfigureAwait(true);
        }

        /// <summary>
        /// Bring up the WebView, sign it in, and navigate.
        /// </summary>
        /// <remarks>
        /// Every failure here is reported in the window rather than thrown, and offers a retry.
        /// Where WebView2 cannot run at all, ErpBrowser has already sent this path to the default
        /// browser before a window was ever constructed — that fallback is automatic, and is not
        /// a choice put in front of the person.
        /// </remarks>
        private Task InitialiseAsync()
        {
            if (_initialised) return CompletedTask;
            if (_initialising != null) return _initialising;

            _initialising = InitialiseCoreAsync();
            return _initialising;
        }

        /// <summary>.NET Framework 4.8 has no <c>Task.CompletedTask</c> on every servicing level.</summary>
        private static readonly Task CompletedTask = Task.FromResult(0);

        private async Task InitialiseCoreAsync()
        {
            try
            {
                SetStatus("Opening SEL LIVE…", "Starting the embedded browser.", false);

                string profile = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "SEL LIVE", "Agent", "WebView2");
                Directory.CreateDirectory(profile);

                CoreWebView2Environment environment =
                    await CoreWebView2Environment.CreateAsync(null, profile).ConfigureAwait(true);
                await Browser.EnsureCoreWebView2Async(environment).ConfigureAwait(true);

                CoreWebView2 core = Browser.CoreWebView2;
                CoreWebView2Settings settings = core.Settings;
                // A window onto one application, not a browser. No context menu full of browser
                // verbs, no dev tools on a user's PC, no status bar overlapping the page.
                settings.AreDefaultContextMenusEnabled = false;
                settings.AreDevToolsEnabled = false;
                settings.IsStatusBarEnabled = false;
                settings.IsSwipeNavigationEnabled = false;

                // target=_blank opens in this window rather than escaping to a browser or
                // spawning a second chromeless popup. See OnNewWindowRequested.
                core.NewWindowRequested += OnNewWindowRequested;
                core.NavigationCompleted += OnNavigationCompleted;
                core.SourceChanged += (s, args) => UpdateChrome();
                core.DocumentTitleChanged += (s, args) =>
                    Title = string.IsNullOrEmpty(core.DocumentTitle) ? "SEL LIVE" : core.DocumentTitle + " — SEL LIVE";

                await InjectSignInTokenAsync(core).ConfigureAwait(true);

                _initialised = true;
                NavigateTo(_pendingPath);
            }
            catch (Exception error)
            {
                _host.Log.Write("Embedded ERP window failed to start: " + error.Message);
                SetStatus(
                    "SEL LIVE could not open in this window",
                    "The embedded browser could not start on this computer. Try again, and if it "
                        + "keeps happening tell IT. (" + error.Message + ")",
                    true);
            }
        }

        /// <summary>
        /// Ask the server for a custom token and inject it before the first document loads.
        /// </summary>
        /// <remarks>
        /// A failure here is not fatal. The window still opens; the ERP simply shows its own
        /// login page, which is exactly what a browser would do. Being signed in already is the
        /// point of the feature, but not a precondition for it.
        /// </remarks>
        private async Task InjectSignInTokenAsync(CoreWebView2 core)
        {
            string token = await _host.CreateErpSessionTokenAsync().ConfigureAwait(true);
            if (string.IsNullOrEmpty(token))
            {
                _host.Log.Write("No ERP session token; the embedded window will ask for a sign-in.");
                return;
            }

            string target = SafePath(_pendingPath);
            string script =
                "window.__SEL_AGENT_TOKEN__ = " + JsonString(token) + ";"
                + "window.__SEL_AGENT_RETURN__ = " + JsonString(target) + ";";

            await core.AddScriptToExecuteOnDocumentCreatedAsync(script).ConfigureAwait(true);
        }

        private void NavigateTo(string path)
        {
            if (Browser.CoreWebView2 == null) return;

            // Always through the landing page: it performs the sign-in exchange and then
            // forwards. Navigating straight to the target would race the session.
            string url = _baseUrl + "/auth/agent";
            _host.Log.Write("Embedded ERP window opening " + SafePath(path));
            Browser.CoreWebView2.Navigate(url);
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess)
            {
                StatusPanel.Visibility = Visibility.Collapsed;
                Browser.Visibility = Visibility.Visible;
            }
            else
            {
                SetStatus(
                    "SEL LIVE could not be reached",
                    "The address is " + _baseUrl + ". Check the network, then reload. ("
                        + e.WebErrorStatus + ")",
                    true);
            }
            UpdateChrome();
        }

        /// <summary>
        /// Pop-ups open in this window, not a new one and not the browser.
        /// </summary>
        /// <remarks>
        /// <para>
        /// These used to be handed to the default browser. That made every <c>target="_blank"</c>
        /// link in the ERP a way out of the managed window — the same escape as the "Open in
        /// browser" button, reachable without the button. Removing one and leaving the other
        /// would have been decoration.
        /// </para>
        /// <para>
        /// Navigating in place rather than opening a second WebView: this window is the session,
        /// and a second chromeless window would be one more thing whose lifetime has to be
        /// managed and whose closure means something different from this one's. Back returns
        /// the person to where they were.
        /// </para>
        /// </remarks>
        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            try
            {
                if (Browser.CoreWebView2 != null && !string.IsNullOrEmpty(e.Uri))
                {
                    Browser.CoreWebView2.Navigate(e.Uri);
                }
            }
            catch (Exception error)
            {
                _host.Log.Write("Could not open " + e.Uri + " in the SEL LIVE window: " + error.Message);
            }
        }

        /* ── Chrome ──────────────────────────────────────────────────────────────────────── */

        private void UpdateChrome()
        {
            CoreWebView2 core = Browser.CoreWebView2;
            if (core == null) return;
            AddressText.Text = core.Source ?? string.Empty;
            SetNavigationEnabled(true);
            BackButton.IsEnabled = core.CanGoBack;
            ForwardButton.IsEnabled = core.CanGoForward;
        }

        private void SetNavigationEnabled(bool enabled)
        {
            ReloadButton.IsEnabled = enabled;
            HomeButton.IsEnabled = enabled;
        }

        /// <param name="offerRetry">
        /// Whether to show "Try again". Was "offer the browser instead", which is no longer
        /// something this window does — see <see cref="OnRetry"/>.
        /// </param>
        private void SetStatus(string title, string detail, bool offerRetry)
        {
            StatusTitle.Text = title;
            StatusDetail.Text = detail;
            StatusActionButton.Visibility = offerRetry ? Visibility.Visible : Visibility.Collapsed;
            StatusPanel.Visibility = Visibility.Visible;
            Browser.Visibility = Visibility.Collapsed;
        }

        private void OnBack(object sender, RoutedEventArgs e)
        {
            if (Browser.CoreWebView2 != null && Browser.CoreWebView2.CanGoBack) Browser.CoreWebView2.GoBack();
        }

        private void OnForward(object sender, RoutedEventArgs e)
        {
            if (Browser.CoreWebView2 != null && Browser.CoreWebView2.CanGoForward) Browser.CoreWebView2.GoForward();
        }

        private void OnReload(object sender, RoutedEventArgs e)
        {
            if (Browser.CoreWebView2 != null) Browser.CoreWebView2.Reload();
        }

        private void OnHome(object sender, RoutedEventArgs e)
        {
            if (Browser.CoreWebView2 != null) Browser.CoreWebView2.Navigate(_baseUrl + "/");
        }

        /// <summary>
        /// Try the page again after a failure.
        /// </summary>
        /// <remarks>
        /// Replaces an "Open in browser instead" button. A page that would not load is almost
        /// always a network blip, and reloading is the fix; offering the browser instead solved
        /// it by abandoning the window, which is not something to put in front of somebody when
        /// closing that window is what ends their session.
        /// </remarks>
        private void OnRetry(object sender, RoutedEventArgs e)
        {
            if (Browser.CoreWebView2 == null)
            {
                // Never got started. Go round again from the beginning rather than reloading
                // a browser that does not exist.
                _initialising = null;
                _initialised = false;
                ShowPath(_pendingPath);
                return;
            }

            SetStatus("Opening SEL LIVE…", "Trying again.", false);
            Browser.CoreWebView2.Reload();
        }

        /* ── Helpers ─────────────────────────────────────────────────────────────────────── */

        private static string SafePath(string path)
        {
            if (string.IsNullOrEmpty(path)) return "/";
            string trimmed = path.Trim();
            if (!trimmed.StartsWith("/", StringComparison.Ordinal)) return "/";
            if (trimmed.StartsWith("//", StringComparison.Ordinal)) return "/";
            if (trimmed.IndexOf('\\') >= 0) return "/";
            return trimmed;
        }

        /// <summary>
        /// A JavaScript string literal.
        /// </summary>
        /// <remarks>
        /// Through Newtonsoft rather than by hand. This builds script that runs in the page, so
        /// a value containing a quote or a line separator would not merely render oddly — it
        /// would end the literal and let the rest be parsed as code.
        /// </remarks>
        private static string JsonString(string value)
        {
            return Newtonsoft.Json.JsonConvert.ToString(value ?? string.Empty);
        }

        protected override void OnClosed(EventArgs e)
        {
            try
            {
                if (Browser != null)
                {
                    if (Browser.CoreWebView2 != null)
                    {
                        Browser.CoreWebView2.NewWindowRequested -= OnNewWindowRequested;
                        Browser.CoreWebView2.NavigationCompleted -= OnNavigationCompleted;
                    }
                    Browser.Dispose();
                }
            }
            catch (Exception)
            {
                // Disposing a WebView during shutdown can race its own browser process. Losing
                // that race is harmless; taking the agent down over it would not be.
            }
            base.OnClosed(e);
        }
    }
}
