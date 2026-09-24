using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Update;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// Whether a PC installs a build nobody is standing in front of.
    /// </summary>
    /// <remarks>
    /// The consequence of getting this wrong is an installer running as SYSTEM on four hundred
    /// machines, so the cases that must come back "no" outnumber the ones that come back "yes".
    /// </remarks>
    public class UpdateRulesTests
    {
        private const string Hash = "17dabd9106a4954b9bee34edbc057f3ff8d753f4fcf2b469225be35256d7d4d0";

        private static AvailableVersion Offer(string version, string url = "https://seltech.store/agent.exe", string hash = Hash)
        {
            return new AvailableVersion
            {
                Version = version,
                PackageUrl = url,
                PackageSha256 = hash,
                SignatureSubject = "Siddhartha Engineering Limited",
            };
        }

        /* ── Version comparison ─────────────────────────────────────────────────────────────── */

        [Theory]
        [InlineData("1.3.0.0", "1.2.0.0", 1)]
        [InlineData("1.2.0.0", "1.3.0.0", -1)]
        [InlineData("1.3.0.0", "1.3.0.0", 0)]
        // The assembly reports three components and the installer names four. Same build.
        [InlineData("1.3.0", "1.3.0.0", 0)]
        [InlineData("1.10.0", "1.9.0", 1)]
        [InlineData("2.0", "1.99.99.99", 1)]
        public void Compares_dotted_versions(string left, string right, int expected)
        {
            Assert.Equal(expected, UpdateRules.Compare(left, right));
        }

        [Fact]
        public void An_unparseable_version_is_treated_as_zero_rather_than_throwing()
        {
            Assert.Equal(0, UpdateRules.Compare(null, ""));
            Assert.Equal(1, UpdateRules.Compare("1.0", "not-a-version"));
        }

        /* ── The decision ───────────────────────────────────────────────────────────────────── */

        [Fact]
        public void Installs_a_newer_build_when_auto_update_is_on()
        {
            UpdateDecision decision = UpdateRules.Evaluate("1.2.0", Offer("1.3.0.0"), false, true);
            Assert.True(decision.Install);
            Assert.Contains("1.3.0.0", decision.Reason);
        }

        [Fact]
        public void Does_nothing_when_there_is_nothing_to_install()
        {
            Assert.False(UpdateRules.Evaluate("1.3.0", null, false, true).Install);
        }

        [Fact]
        public void Never_installs_the_same_build_again()
        {
            // An agent that reinstalled its own version every heartbeat would be a loop that
            // restarts the service all day.
            Assert.False(UpdateRules.Evaluate("1.3.0", Offer("1.3.0.0"), false, true).Install);
        }

        [Fact]
        public void Never_downgrades()
        {
            Assert.False(UpdateRules.Evaluate("1.3.0", Offer("1.2.0.0"), false, true).Install);
        }

        [Fact]
        public void Respects_auto_update_being_switched_off()
        {
            UpdateDecision decision = UpdateRules.Evaluate("1.2.0", Offer("1.3.0.0"), false, false);
            Assert.False(decision.Install);
            Assert.Contains("switched off", decision.Reason);
        }

        [Fact]
        public void A_mandatory_update_overrides_the_policy_and_says_so()
        {
            // "This build has a vulnerability" is not a decision that waits on a staged rollout.
            UpdateDecision decision = UpdateRules.Evaluate("1.2.0", Offer("1.3.0.0"), true, false);
            Assert.True(decision.Install);
            Assert.Contains("mandatory", decision.Reason);
            Assert.Contains("overriding", decision.Reason);
        }

        [Fact]
        public void Refuses_a_package_that_is_not_served_over_https()
        {
            Assert.False(UpdateRules.Evaluate("1.2.0", Offer("1.3.0.0", "http://seltech.store/agent.exe"), false, true).Install);
            Assert.False(UpdateRules.Evaluate("1.2.0", Offer("1.3.0.0", "\\\\fileserver\\agent.exe"), false, true).Install);
            Assert.False(UpdateRules.Evaluate("1.2.0", Offer("1.3.0.0", ""), false, true).Install);
        }

        [Fact]
        public void Refuses_an_offer_with_no_usable_hash()
        {
            // The hash is the only thing standing between a compromised package host and SYSTEM
            // on every PC, so an offer without one is not an offer.
            Assert.False(UpdateRules.Evaluate("1.2.0", Offer("1.3.0.0", hash: ""), false, true).Install);
            Assert.False(UpdateRules.Evaluate("1.2.0", Offer("1.3.0.0", hash: "deadbeef"), false, true).Install);
            Assert.False(UpdateRules.Evaluate("1.2.0", Offer("1.3.0.0", hash: new string('z', 64)), false, true).Install);
        }

        /* ── The hash itself ────────────────────────────────────────────────────────────────── */

        [Fact]
        public void A_hash_matches_regardless_of_case()
        {
            Assert.True(UpdateRules.HashMatches(Hash, Hash.ToUpperInvariant()));
        }

        [Fact]
        public void A_hash_that_differs_anywhere_does_not_match()
        {
            string tampered = Hash.Substring(0, 63) + (Hash[63] == '0' ? '1' : '0');
            Assert.False(UpdateRules.HashMatches(Hash, tampered));
        }

        [Fact]
        public void A_prefix_is_not_a_match()
        {
            Assert.False(UpdateRules.HashMatches(Hash, Hash.Substring(0, 32)));
            Assert.False(UpdateRules.HashMatches(Hash.Substring(0, 32), Hash));
        }

        [Fact]
        public void Nothing_matches_an_empty_hash()
        {
            Assert.False(UpdateRules.HashMatches(null, Hash));
            Assert.False(UpdateRules.HashMatches(Hash, null));
            Assert.False(UpdateRules.HashMatches("", ""));
        }
    }
}
