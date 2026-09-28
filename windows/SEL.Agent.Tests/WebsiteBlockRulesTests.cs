using System.Collections.Generic;
using System.Linq;
using Sel.Agent.Core.Security;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// The hosts file this agent writes, and the two things it must never do to it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This class writes to the file that decides where every name on the PC resolves, from a
    /// service nobody can stop, on a machine that can only be sent a correction over the network.
    /// Two mistakes here are unrecoverable remotely: losing a site office's own hosts entries, and
    /// blackholing the SEL LIVE server or the certificate authority its TLS chains to. Both are
    /// asserted below, and both would be silent in production.
    /// </para>
    /// <para>
    /// The expectations mirror <c>tests/website-blocking.test.mjs</c> deliberately. The server
    /// decides what to block and the agent renders it, so the two implementations agreeing about
    /// what a rule covers is the property that makes the policy screen truthful.
    /// </para>
    /// </remarks>
    public class WebsiteBlockRulesTests
    {
        [Fact]
        public void A_pasted_URL_becomes_the_bare_registrable_host()
        {
            Assert.Equal("facebook.com", WebsiteBlockRules.NormalizeDomain("https://www.facebook.com/groups/12345?ref=share"));
            Assert.Equal("instagram.com", WebsiteBlockRules.NormalizeDomain("  HTTP://Instagram.COM/  "));
            Assert.Equal("facebook.com", WebsiteBlockRules.NormalizeDomain("facebook.com:443"));
            Assert.Equal("facebook.com", WebsiteBlockRules.NormalizeDomain("facebook.com."));
            Assert.Equal("facebook.com", WebsiteBlockRules.NormalizeDomain("*.facebook.com"));
            Assert.Equal("facebook.com", WebsiteBlockRules.NormalizeDomain("user@facebook.com"));
            Assert.Equal("facebook.com", WebsiteBlockRules.NormalizeDomain("https://user:pass@www.facebook.com/x"));
        }

        [Fact]
        public void A_named_subdomain_is_kept_because_blocking_one_host_is_a_legitimate_rule()
        {
            Assert.Equal("web.whatsapp.com", WebsiteBlockRules.NormalizeDomain("web.whatsapp.com"));
        }

        [Fact]
        public void What_cannot_be_a_domain_is_refused_rather_than_written_into_a_system_file()
        {
            // An IP address in the *name* column of a hosts file does nothing at all, so accepting
            // one would show an administrator an entry that never blocks anything.
            Assert.Null(WebsiteBlockRules.NormalizeDomain("192.168.1.10"));
            Assert.Null(WebsiteBlockRules.NormalizeDomain("localhost"));
            Assert.Null(WebsiteBlockRules.NormalizeDomain(@"C:\Users\Ashish"));
            Assert.Null(WebsiteBlockRules.NormalizeDomain("how to block facebook"));
            Assert.Null(WebsiteBlockRules.NormalizeDomain("facebook"));
            Assert.Null(WebsiteBlockRules.NormalizeDomain("[2001:db8::1]"));
            Assert.Null(WebsiteBlockRules.NormalizeDomain("https://"));
            Assert.Null(WebsiteBlockRules.NormalizeDomain("  "));
            Assert.Null(WebsiteBlockRules.NormalizeDomain(null));
        }

        [Fact]
        public void The_forms_of_one_name_collapse_to_a_single_entry()
        {
            List<string> domains = WebsiteBlockRules.NormalizeDomains(new[]
            {
                "facebook.com", "www.facebook.com", "https://facebook.com/x", "FACEBOOK.COM",
            });
            Assert.Equal(new[] { "facebook.com" }, domains);
        }

        [Fact]
        public void The_agent_refuses_to_blackhole_what_Windows_and_SEL_LIVE_need()
        {
            // The server filters these too. This is the lock that matters: it guards the agent's
            // own ability to ever be told anything again.
            List<string> domains = WebsiteBlockRules.NormalizeDomains(new[]
            {
                "facebook.com", "windowsupdate.com", "www.microsoft.com", "digicert.com",
                "identitytoolkit.googleapis.com",
            });
            Assert.Equal(new[] { "facebook.com" }, domains);
        }

        [Fact]
        public void The_installations_own_server_is_protected_even_though_it_is_not_a_constant()
        {
            var ours = new[] { "erp.seltech.store", "seltech.store" };
            List<string> domains = WebsiteBlockRules.NormalizeDomains(
                new[] { "facebook.com", "erp.seltech.store", "seltech.store" }, ours);
            Assert.Equal(new[] { "facebook.com" }, domains);
            Assert.True(WebsiteBlockRules.IsProtected("erp.seltech.store", ours));
            Assert.False(WebsiteBlockRules.IsProtected("facebook.com", ours));
        }

        [Fact]
        public void Each_domain_is_expanded_because_a_hosts_file_has_no_wildcards()
        {
            List<string> entries = WebsiteBlockRules.Entries(new[] { "facebook.com" });
            Assert.Contains(WebsiteBlockRules.SinkIPv4 + "\tfacebook.com", entries);
            Assert.Contains(WebsiteBlockRules.SinkIPv4 + "\twww.facebook.com", entries);
            Assert.Contains(WebsiteBlockRules.SinkIPv4 + "\tm.facebook.com", entries);
            // Both families: a v4-only entry blocks nothing on a dual-stack network, because the
            // browser follows the AAAA record instead.
            Assert.Contains(WebsiteBlockRules.SinkIPv6 + "\tfacebook.com", entries);
            Assert.Equal(10, entries.Count);
        }

        [Fact]
        public void The_site_offices_own_hosts_entries_survive()
        {
            // A site's hosts file routinely carries what makes an on-premise server reachable.
            // Losing it would take the site off the very ERP this agent reports to.
            const string existing = "127.0.0.1\tlocalhost\r\n10.20.0.5\tsel-site-server\r\n";
            string written = WebsiteBlockRules.ApplyBlock(existing, new[] { "facebook.com" });
            Assert.Contains("10.20.0.5\tsel-site-server", written);
            Assert.Contains("127.0.0.1\tlocalhost", written);
            Assert.Contains(WebsiteBlockRules.BlockBegin, written);
            Assert.Contains(WebsiteBlockRules.BlockEnd, written);
        }

        [Fact]
        public void Writing_twice_produces_identical_text_so_the_loop_can_write_only_on_a_change()
        {
            const string existing = "127.0.0.1\tlocalhost\n";
            string once = WebsiteBlockRules.ApplyBlock(existing, new[] { "facebook.com", "x.com" });
            string twice = WebsiteBlockRules.ApplyBlock(once, new[] { "facebook.com", "x.com" });
            Assert.Equal(once, twice);
            // And the order the server happened to send them in does not change the file.
            Assert.Equal(once, WebsiteBlockRules.ApplyBlock(existing, new[] { "x.com", "facebook.com" }));
        }

        [Fact]
        public void A_changed_plan_replaces_the_region_rather_than_appending_a_second_one()
        {
            string first = WebsiteBlockRules.ApplyBlock("127.0.0.1\tlocalhost\n", new[] { "facebook.com" });
            string second = WebsiteBlockRules.ApplyBlock(first, new[] { "x.com" });
            Assert.Equal(1, second.Split(new[] { WebsiteBlockRules.BlockBegin }, System.StringSplitOptions.None).Length - 1);
            Assert.Contains("\tx.com", second);
            Assert.DoesNotContain("\tfacebook.com", second);
        }

        [Fact]
        public void An_empty_plan_removes_the_region_and_leaves_the_rest_of_the_file()
        {
            string blocked = WebsiteBlockRules.ApplyBlock("127.0.0.1\tlocalhost\n", new[] { "facebook.com" });
            Assert.True(WebsiteBlockRules.HasBlock(blocked));
            string cleared = WebsiteBlockRules.ApplyBlock(blocked, new string[0]);
            Assert.False(WebsiteBlockRules.HasBlock(cleared));
            Assert.Equal("127.0.0.1\tlocalhost\r\n", cleared);
        }

        [Fact]
        public void A_region_truncated_mid_write_is_repaired_rather_than_kept_forever()
        {
            string broken = "127.0.0.1\tlocalhost\r\n" + WebsiteBlockRules.BlockBegin + "\r\n0.0.0.0\tfacebook.c";
            string repaired = WebsiteBlockRules.ApplyBlock(broken, new[] { "x.com" });
            Assert.DoesNotContain("facebook.c", repaired);
            Assert.Contains("127.0.0.1\tlocalhost", repaired);
            Assert.Equal(1, repaired.Split(new[] { WebsiteBlockRules.BlockBegin }, System.StringSplitOptions.None).Length - 1);
        }

        [Fact]
        public void The_file_is_CRLF_because_Notepad_on_an_old_PC_cannot_show_a_lone_LF()
        {
            string written = WebsiteBlockRules.ApplyBlock(string.Empty, new[] { "facebook.com" });
            Assert.EndsWith("\r\n", written);
            Assert.All(
                written.Split('\n').Take(written.Split('\n').Length - 1),
                line => Assert.EndsWith("\r", line));
        }

        [Fact]
        public void An_observed_host_matches_its_own_subdomains_and_nothing_that_merely_ends_alike()
        {
            var domains = new[] { "facebook.com", "x.com" };
            Assert.True(WebsiteBlockRules.IsBlocked("facebook.com", domains));
            Assert.True(WebsiteBlockRules.IsBlocked("web.facebook.com", domains));
            Assert.True(WebsiteBlockRules.IsBlocked("FACEBOOK.COM.", domains));
            // The boundary has to be a label separator, or a rule for one company covers another
            // whose name happens to end the same way.
            Assert.False(WebsiteBlockRules.IsBlocked("notfacebook.com", domains));
            Assert.False(WebsiteBlockRules.IsBlocked("myx.com", domains));
            Assert.False(WebsiteBlockRules.IsBlocked("facebook.com.evil.test", domains));
            Assert.False(WebsiteBlockRules.IsBlocked("google.com", domains));
            Assert.False(WebsiteBlockRules.IsBlocked("facebook.com", new string[0]));
            Assert.False(WebsiteBlockRules.IsBlocked(null, domains));
        }
    }
}
