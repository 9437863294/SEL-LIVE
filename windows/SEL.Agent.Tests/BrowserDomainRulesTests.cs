using Sel.Agent.Core.Tracking;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// What reaches the server from a browser's address bar, and what must not.
    /// </summary>
    /// <remarks>
    /// Most of these tests are about the second half. The address bar is the one place on a PC
    /// where a monitoring agent can trivially pick up a search phrase, a password-reset link or a
    /// document share URL, all of which §N rules out — so the interesting cases are the ones that
    /// must come back null.
    /// </remarks>
    public class BrowserDomainRulesTests
    {
        [Theory]
        [InlineData("chrome")]
        [InlineData("Chrome")]
        [InlineData("chrome.exe")]
        [InlineData("msedge")]
        [InlineData("firefox")]
        public void Recognises_the_browsers_in_use(string processName)
        {
            Assert.True(BrowserDomainRules.IsBrowser(processName));
        }

        [Theory]
        [InlineData("excel")]
        [InlineData("SEL.Agent")]
        [InlineData("explorer")]
        [InlineData("")]
        [InlineData(null)]
        public void Does_not_read_the_address_bar_of_anything_else(string processName)
        {
            Assert.False(BrowserDomainRules.IsBrowser(processName));
        }

        /* ── What a domain looks like ───────────────────────────────────────────────────────── */

        [Fact]
        public void Takes_the_host_from_a_full_url()
        {
            Assert.Equal("seltech.store", BrowserDomainRules.HostOf("https://seltech.store/windows-agent/devices"));
        }

        [Fact]
        public void Takes_the_host_when_the_browser_has_hidden_the_scheme()
        {
            Assert.Equal("seltech.store", BrowserDomainRules.HostOf("seltech.store/login"));
        }

        [Fact]
        public void Drops_www_so_one_site_is_one_row()
        {
            Assert.Equal("google.com", BrowserDomainRules.HostOf("https://www.google.com/"));
        }

        [Fact]
        public void Keeps_a_subdomain_because_it_is_a_different_service()
        {
            Assert.Equal("drive.google.com", BrowserDomainRules.HostOf("https://drive.google.com/drive/my-drive"));
        }

        [Fact]
        public void Lower_cases_the_host()
        {
            Assert.Equal("seltech.store", BrowserDomainRules.HostOf("HTTPS://SELTECH.STORE/Login"));
        }

        [Fact]
        public void Drops_the_port_and_the_fragment()
        {
            Assert.Equal("intranet", BrowserDomainRules.HostOf("http://intranet:8080/page#section"));
        }

        [Fact]
        public void Keeps_a_dotless_intranet_name()
        {
            // "erp" or "intranet" is a real destination on an office LAN.
            Assert.Equal("erp", BrowserDomainRules.HostOf("http://erp/dashboard"));
        }

        /* ── What must never come back ──────────────────────────────────────────────────────── */

        [Fact]
        public void A_search_phrase_being_typed_is_not_a_domain()
        {
            Assert.Null(BrowserDomainRules.HostOf("how to reset a password"));
        }

        [Fact]
        public void The_query_string_never_survives_even_when_it_is_the_search()
        {
            // The path and query of a search *are* the search terms. Only the host is kept.
            Assert.Equal("google.com", BrowserDomainRules.HostOf("https://www.google.com/search?q=resignation+letter+format"));
        }

        [Fact]
        public void A_shared_document_link_reduces_to_the_host()
        {
            Assert.Equal("1drv.ms", BrowserDomainRules.HostOf("https://1drv.ms/x/s!AkJ3-secret-token-here"));
        }

        [Fact]
        public void Credentials_in_a_url_do_not_survive()
        {
            Assert.Equal("example.com", BrowserDomainRules.HostOf("https://user:password@example.com/admin"));
        }

        [Theory]
        [InlineData("chrome://settings")]
        [InlineData("edge://flags")]
        [InlineData("about:blank")]
        [InlineData("view-source:https://seltech.store")]
        public void Internal_browser_pages_are_not_websites(string address)
        {
            Assert.Null(BrowserDomainRules.HostOf(address));
        }

        [Fact]
        public void A_local_development_server_is_not_a_website()
        {
            Assert.Null(BrowserDomainRules.HostOf("http://localhost:3000/windows-agent"));
        }

        [Theory]
        [InlineData("")]
        [InlineData(null)]
        [InlineData("   ")]
        public void Nothing_in_the_address_bar_means_no_domain(string address)
        {
            Assert.Null(BrowserDomainRules.HostOf(address));
        }

        [Fact]
        public void A_file_path_is_not_a_website()
        {
            Assert.Null(BrowserDomainRules.HostOf(@"C:\Users\Ashish\Documents\Q3.xlsx"));
        }
    }
}
