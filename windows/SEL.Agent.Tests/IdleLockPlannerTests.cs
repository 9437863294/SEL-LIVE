using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Session;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// When an unattended PC warns, and when it locks.
    /// </summary>
    /// <remarks>
    /// <para>
    /// These rules decide whether somebody's screen goes dark while they are reading, so the
    /// interesting cases are the ones where it must *not* fire: the policy switched off, nobody
    /// signed in, the session already locked, and the moment just before the threshold.
    /// </para>
    /// <para>
    /// They run anywhere, because <see cref="IdleLockPlanner"/> is a pure function and the lock
    /// itself is behind <c>IWorkstationLock</c>. A test suite that locked the build server would
    /// be run exactly once.
    /// </para>
    /// </remarks>
    public class IdleLockPlannerTests
    {
        private static AgentPolicySettings Policy(bool enabled, int idle = 600, int warning = 60)
        {
            AgentPolicySettings settings = AgentPolicySettings.Defaults();
            settings.LockOnIdleEnabled = enabled;
            settings.IdleLockSeconds = idle;
            settings.IdleLockWarningSeconds = warning;
            return settings;
        }

        [Fact]
        public void Does_nothing_while_somebody_is_working()
        {
            IdleLockDecision decision = IdleLockPlanner.Plan(12, Policy(true), false, false);
            Assert.Equal(IdleLockAction.None, decision.Action);
        }

        [Fact]
        public void Warns_once_the_idle_threshold_is_reached()
        {
            IdleLockDecision decision = IdleLockPlanner.Plan(600, Policy(true), false, false);
            Assert.Equal(IdleLockAction.ShowWarning, decision.Action);
            Assert.Equal(60, decision.SecondsUntilLock);
        }

        [Fact]
        public void One_second_before_the_threshold_is_still_nothing()
        {
            // The boundary matters: an off-by-one here is a warning a second early on every PC,
            // every time, which is exactly the sort of thing that gets a feature switched off.
            IdleLockDecision decision = IdleLockPlanner.Plan(599, Policy(true), false, false);
            Assert.Equal(IdleLockAction.None, decision.Action);
        }

        [Fact]
        public void Counts_down_while_the_warning_is_up()
        {
            IdleLockDecision decision = IdleLockPlanner.Plan(630, Policy(true), true, false);
            Assert.Equal(IdleLockAction.None, decision.Action);
            Assert.Equal(30, decision.SecondsUntilLock);
        }

        [Fact]
        public void Locks_after_the_warning_has_run_its_course()
        {
            // 600 idle + 60 warning. The lock is at 660, not at 600 — the warning is added to
            // the idle allowance rather than taken out of it.
            Assert.Equal(IdleLockAction.None, IdleLockPlanner.Plan(659, Policy(true), true, false).Action);
            Assert.Equal(IdleLockAction.Lock, IdleLockPlanner.Plan(660, Policy(true), true, false).Action);
        }

        [Fact]
        public void Any_input_takes_the_warning_back_down()
        {
            IdleLockDecision decision = IdleLockPlanner.Plan(2, Policy(true), true, false);
            Assert.Equal(IdleLockAction.HideWarning, decision.Action);
        }

        [Fact]
        public void Does_nothing_at_all_when_the_policy_is_off()
        {
            Assert.Equal(IdleLockAction.None, IdleLockPlanner.Plan(99_999, Policy(false), false, false).Action);
        }

        [Fact]
        public void Switching_the_policy_off_removes_a_warning_already_on_screen()
        {
            // An administrator disabling this centrally must not leave a countdown promising a
            // lock that is no longer going to happen.
            Assert.Equal(IdleLockAction.HideWarning, IdleLockPlanner.Plan(650, Policy(false), true, false).Action);
        }

        [Fact]
        public void A_null_policy_never_locks_anything()
        {
            // Policy can be absent before the first heartbeat. Locking a PC because the agent
            // has not been told otherwise yet would be the worst possible default.
            Assert.Equal(IdleLockAction.None, IdleLockPlanner.Plan(99_999, null, false, false).Action);
        }

        [Fact]
        public void Does_not_lock_a_session_that_is_already_locked()
        {
            // A locked session receives no input, so idle climbs forever. Without this the agent
            // would call LockWorkStation every second for the length of somebody's lunch.
            Assert.Equal(IdleLockAction.None, IdleLockPlanner.Plan(99_999, Policy(true), false, true).Action);
        }

        [Fact]
        public void Falls_back_to_sane_timings_when_a_policy_carries_zeroes()
        {
            // Zero would otherwise mean "warn immediately and lock immediately".
            AgentPolicySettings broken = Policy(true, 0, 0);
            Assert.Equal(IdleLockAction.None, IdleLockPlanner.Plan(10, broken, false, false).Action);
            Assert.Equal(IdleLockAction.ShowWarning, IdleLockPlanner.Plan(600, broken, false, false).Action);
            Assert.Equal(IdleLockAction.Lock, IdleLockPlanner.Plan(660, broken, false, false).Action);
        }

        /* ── Re-authentication after a lock ──────────────────────────────────────────────── */

        [Fact]
        public void A_short_lock_resumes_without_asking_again()
        {
            AgentPolicySettings policy = Policy(true);
            policy.ReauthAfterLockSeconds = 1800;
            Assert.False(IdleLockPlanner.ShouldReauthenticateAfterLock(120, policy));
        }

        [Fact]
        public void A_long_lock_asks_for_a_sign_in_again()
        {
            AgentPolicySettings policy = Policy(true);
            policy.ReauthAfterLockSeconds = 1800;
            Assert.True(IdleLockPlanner.ShouldReauthenticateAfterLock(1800, policy));
            Assert.True(IdleLockPlanner.ShouldReauthenticateAfterLock(7200, policy));
        }

        [Fact]
        public void Zero_means_every_unlock_asks()
        {
            AgentPolicySettings policy = Policy(true);
            policy.ReauthAfterLockSeconds = 0;
            Assert.True(IdleLockPlanner.ShouldReauthenticateAfterLock(1, policy));
        }

        [Fact]
        public void A_negative_setting_falls_back_to_the_default_rather_than_never()
        {
            // "Never ask again" is a real choice, but it should be made by setting a large
            // number, not by a malformed one quietly weakening the control.
            AgentPolicySettings policy = Policy(true);
            policy.ReauthAfterLockSeconds = -1;
            Assert.False(IdleLockPlanner.ShouldReauthenticateAfterLock(60, policy));
            Assert.True(IdleLockPlanner.ShouldReauthenticateAfterLock(1800, policy));
        }
    }
}
