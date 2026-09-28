using Sel.Agent.Core.Security;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// Who Windows will let stop the service.
    /// </summary>
    /// <remarks>
    /// The descriptor is enforced by the Service Control Manager before any of this agent's code
    /// runs, so getting it wrong fails in one of two expensive directions: too open and the Stop
    /// button still works, too closed and the service can never be uninstalled or upgraded. Both
    /// are asserted here, and the second is the one that would ruin somebody's afternoon.
    /// </remarks>
    public class ServiceSecurityRulesTests
    {
        [Fact]
        public void The_protected_descriptor_refuses_administrators_the_stop_right()
        {
            string sddl = ServiceSecurityRules.ProtectedSddl();
            Assert.False(ServiceSecurityRules.GrantsStop(sddl, "BA"));
        }

        [Fact]
        public void The_protected_descriptor_keeps_stop_for_SYSTEM_or_it_could_never_be_removed()
        {
            string sddl = ServiceSecurityRules.ProtectedSddl();
            Assert.True(ServiceSecurityRules.GrantsStop(sddl, "SY"));
        }

        [Fact]
        public void Administrators_can_observe_and_start_but_cannot_modify_or_rewrite_the_acl()
        {
            // Recovery and signed upgrades run as SYSTEM. A local support account can inspect
            // and start the service, but cannot turn that into permission to replace or stop it.
            string rights = ServiceSecurityRules.RightsFor(ServiceSecurityRules.ProtectedSddl(), "BA");
            Assert.Contains("RP", rights);   // start
            Assert.DoesNotContain("DC", rights);
            Assert.DoesNotContain("SD", rights);
            Assert.DoesNotContain("WD", rights);
            Assert.DoesNotContain("WP", rights);
            Assert.DoesNotContain("DT", rights);
            Assert.DoesNotContain("WO", rights);
            Assert.False(ServiceSecurityRules.GrantsModification(ServiceSecurityRules.ProtectedSddl(), "BA"));
        }

        [Fact]
        public void Anybody_may_still_look_at_the_service()
        {
            string rights = ServiceSecurityRules.RightsFor(ServiceSecurityRules.ProtectedSddl(), "IU");
            Assert.Contains("LC", rights);   // query status
            Assert.DoesNotContain("WP", rights);
        }

        [Fact]
        public void The_default_descriptor_puts_the_stop_right_back()
        {
            string sddl = ServiceSecurityRules.DefaultSddl();
            Assert.True(ServiceSecurityRules.GrantsStop(sddl, "BA"));
            Assert.True(ServiceSecurityRules.GrantsStop(sddl, "SY"));
            Assert.True(ServiceSecurityRules.GrantsModification(sddl, "BA"));
        }

        [Theory]
        [InlineData(true, true)]
        [InlineData(true, false)]
        [InlineData(false, true)]
        [InlineData(false, false)]
        public void Per_device_policy_independently_controls_stop_and_modification(
            bool stopBlocked, bool modificationBlocked)
        {
            string sddl = ServiceSecurityRules.PolicySddl(stopBlocked, modificationBlocked);
            Assert.Equal(!stopBlocked, ServiceSecurityRules.GrantsStop(sddl, "BA"));
            Assert.Equal(!modificationBlocked,
                ServiceSecurityRules.GrantsConfigurationModification(sddl, "BA"));
            Assert.True(ServiceSecurityRules.MatchesPolicy(sddl, stopBlocked, modificationBlocked));
        }

        [Fact]
        public void IsProtected_reads_both_halves()
        {
            Assert.True(ServiceSecurityRules.IsProtected(ServiceSecurityRules.ProtectedSddl()));
            Assert.False(ServiceSecurityRules.IsProtected(ServiceSecurityRules.DefaultSddl()));

            // A descriptor that locked SYSTEM out too is not "extra protected", it is broken:
            // nothing could ever stop, upgrade or remove the service again.
            Assert.False(ServiceSecurityRules.IsProtected("D:(A;;CCDCLCSWRPLOCRSDRCWDWO;;;SY)(A;;CCDCLCSWRPLOCRSDRCWDWO;;;BA)"));
        }

        [Fact]
        public void Reads_the_descriptor_Windows_actually_prints()
        {
            // Exactly what `sc sdshow SELLiveAgent` returns on a stock service, SACL and all.
            const string live =
                "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)"
                + "(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)";

            Assert.True(ServiceSecurityRules.GrantsStop(live, "BA"));
            Assert.True(ServiceSecurityRules.GrantsStop(live, "SY"));
            Assert.False(ServiceSecurityRules.IsProtected(live));
        }

        [Fact]
        public void An_unreadable_descriptor_is_not_mistaken_for_a_protected_one()
        {
            Assert.Null(ServiceSecurityRules.RightsFor(null, "BA"));
            Assert.Null(ServiceSecurityRules.RightsFor("", "BA"));
            Assert.Null(ServiceSecurityRules.RightsFor("not an sddl", "BA"));
            Assert.Null(ServiceSecurityRules.RightsFor("D:(A;;CCLC;;;SY)", "BA"));
            // No BA entry at all means no stop right for BA — but SYSTEM's is missing too, so
            // this is not a protected service.
            Assert.False(ServiceSecurityRules.IsProtected("D:(A;;CCLC;;;IU)"));
        }

        [Fact]
        public void A_deny_ace_is_not_read_as_a_grant()
        {
            // (D;;...) is a deny entry. Reading its letters as though they were granted would
            // report a service as stoppable when it is the opposite.
            Assert.Null(ServiceSecurityRules.RightsFor("D:(D;;WP;;;BA)", "BA"));
        }
    }
}
