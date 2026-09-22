using System;

namespace Sel.Agent.Core.Tracking
{
    /// <summary>
    /// Which processes are browsers, and how to reduce what one is showing to a bare host name.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Host only, and that is the whole privacy model.</b> §14 asks for time per website;
    /// §N forbids capturing passwords, form fields, typed messages, search-box contents, page
    /// contents, cookies or tokens. A full URL carries several of those routinely — the path of a
    /// search is the search, and a shared document link is the document — so the path, the query,
    /// the fragment, the port and the credentials are dropped here and never leave the PC. What
    /// survives is <c>drive.google.com</c>, which is what a report about how the afternoon went
    /// actually needs.
    /// </para>
    /// <para>
    /// <b>The address bar is read while it is not being typed into.</b> A browser's address bar
    /// holds whatever the person is typing, which is exactly the search-box content §N rules out.
    /// So anything that does not parse as an absolute http or https URL is discarded rather than
    /// guessed at: half-typed text, search terms, and file paths all fail that test.
    /// <see cref="HostOf"/> is the only way a domain can be produced, so the rule cannot be
    /// bypassed by a caller taking a shortcut.
    /// </para>
    /// <para>
    /// <b>Internal pages are not websites.</b> <c>chrome://settings</c>, <c>edge://flags</c> and
    /// <c>about:blank</c> return null: recording "the user visited chrome://history" would be both
    /// meaningless as work time and a slightly creepy thing to have in a report.
    /// </para>
    /// </remarks>
    public static class BrowserDomainRules
    {
        /// <summary>
        /// Process names, without extension, whose address bar is worth reading.
        /// </summary>
        /// <remarks>
        /// Deliberately a list rather than a heuristic. "Does this window have something that
        /// looks like an address bar" is true of far too many applications — an ERP with a URL
        /// field, an FTP client, Explorer — and reading an unknown application's text boxes on the
        /// off-chance is how a monitoring agent ends up holding data nobody sanctioned.
        /// </remarks>
        private static readonly string[] BrowserProcesses =
        {
            "chrome",       // Google Chrome
            "msedge",       // Microsoft Edge
            "firefox",      // Mozilla Firefox
            "brave",        // Brave
            "opera",        // Opera
            "vivaldi",      // Vivaldi
            "iexplore",     // Internet Explorer, still present on older site machines
        };

        /// <summary>Whether this process is one whose address bar should be sampled.</summary>
        public static bool IsBrowser(string processName)
        {
            if (string.IsNullOrEmpty(processName)) return false;

            string name = processName.Trim();
            if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                name = name.Substring(0, name.Length - 4);
            }

            foreach (string candidate in BrowserProcesses)
            {
                if (string.Equals(name, candidate, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        /// <summary>
        /// The host of an absolute http(s) URL, lower-cased and without <c>www.</c>, or null.
        /// </summary>
        /// <remarks>
        /// Null for anything that is not one: partially typed text, a search phrase, a file path,
        /// an internal browser page, or an address bar that was empty. Null means "record no
        /// domain for this span", which is the safe outcome in every one of those cases.
        /// </remarks>
        public static string HostOf(string addressBarText)
        {
            if (string.IsNullOrEmpty(addressBarText)) return null;

            string text = addressBarText.Trim();
            if (text.Length == 0 || text.Length > 2048) return null;

            // A space is the giveaway that this is a search phrase rather than an address. Doing
            // this before the Uri parse matters: "how to reset a password" would otherwise be
            // rejected anyway, but "site.com and other things" would not.
            if (text.IndexOf(' ') >= 0) return null;

            // Browsers hide the scheme in the address bar, so "seltech.store/login" is what is
            // actually shown for a page the person is really on. Adding https:// is what makes
            // that parse, and it cannot turn a non-address into one: a search phrase has spaces,
            // and a file path fails the host check below.
            if (text.IndexOf("://", StringComparison.Ordinal) < 0)
            {
                // ...unless it is a scheme-like internal page. chrome://, edge://, about: and
                // view-source: are not websites.
                if (text.IndexOf(':') >= 0 && text.IndexOf('/') < 0) return null;
                text = "https://" + text;
            }

            Uri parsed;
            if (!Uri.TryCreate(text, UriKind.Absolute, out parsed)) return null;
            if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) return null;

            string host = parsed.Host;
            if (string.IsNullOrEmpty(host)) return null;

            host = host.ToLowerInvariant();
            if (host.StartsWith("www.", StringComparison.Ordinal) && host.Length > 4)
            {
                host = host.Substring(4);
            }

            // A bare label with no dot is a machine on the LAN — "intranet", "erp" — which is a
            // real destination and worth keeping. Localhost is not: it is the person's own
            // machine, and on a developer's PC it would dominate the report.
            if (host == "localhost" || host == "127.0.0.1" || host == "::1") return null;

            return host;
        }
    }
}
