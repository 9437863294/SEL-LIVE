using System;
using Sel.Agent.Core.Session;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// When a stored administrator instruction still applies, and when it is spent.
    /// </summary>
    /// <remarks>
    /// <para>
    /// These cases are written from a real failure rather than from the rule. A force sign-out
    /// raised on one PC at 13:07 ended every login on it for the next two days, roughly 250
    /// milliseconds after each one, because the flag stays on the device document and every new
    /// session treated it as new. The first two tests are that bug and its opposite; the rest are
    /// the boundaries somebody will be tempted to "simplify" later.
    /// </para>
    /// </remarks>
    public class DirectivePolicyTests
    {
        private static DateTime At(string iso)
        {
            return DateTime.Parse(iso, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AdjustToUniversal
                | System.Globalization.DateTimeStyles.AssumeUniversal);
        }

        [Fact]
        public void A_sign_out_from_yesterday_does_not_end_todays_session()
        {
            Assert.False(DirectivePolicy.ShouldObey(
                At("2026-09-21T13:07:51.703Z"),
                At("2026-09-22T05:41:10.878Z")));
        }

        [Fact]
        public void A_sign_out_raised_during_this_session_is_obeyed()
        {
            Assert.True(DirectivePolicy.ShouldObey(
                At("2026-09-22T06:10:00Z"),
                At("2026-09-22T05:41:10.878Z")));
        }

        [Fact]
        public void A_sign_out_raised_in_the_same_instant_as_the_login_is_obeyed()
        {
            // The administrator who clicks while somebody is signing in gets what they asked for.
            DateTime instant = At("2026-09-22T05:41:10.878Z");
            Assert.True(DirectivePolicy.ShouldObey(instant, instant));
        }

        [Fact]
        public void A_millisecond_before_the_login_is_already_satisfied()
        {
            Assert.False(DirectivePolicy.ShouldObey(
                At("2026-09-22T05:41:10.877Z"),
                At("2026-09-22T05:41:10.878Z")));
        }

        [Fact]
        public void An_unknown_issue_time_is_obeyed()
        {
            // Failing to enforce is the worse mistake for an instruction deliberately given.
            Assert.True(DirectivePolicy.ShouldObey(DateTime.MinValue, At("2026-09-22T05:41:10Z")));
        }

        [Fact]
        public void An_unknown_session_start_is_obeyed()
        {
            Assert.True(DirectivePolicy.ShouldObey(At("2026-09-22T05:41:10Z"), DateTime.MinValue));
        }

        [Fact]
        public void Neither_known_is_obeyed()
        {
            Assert.True(DirectivePolicy.ShouldObey(DateTime.MinValue, DateTime.MinValue));
        }
    }
}
