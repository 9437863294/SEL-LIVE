using Sel.Agent.Core.Contracts;

namespace Sel.Agent.Core.Session
{
    /// <summary>What the agent should do about the desk in front of it.</summary>
    public enum IdleLockAction
    {
        /// <summary>Nothing to change.</summary>
        None,

        /// <summary>Put the "still working?" countdown on screen.</summary>
        ShowWarning,

        /// <summary>Take it back down — somebody touched the keyboard.</summary>
        HideWarning,

        /// <summary>Lock the workstation.</summary>
        Lock,
    }

    /// <summary>A decision, and how long the countdown has left.</summary>
    public sealed class IdleLockDecision
    {
        public IdleLockAction Action { get; set; }

        /// <summary>Seconds remaining before the lock, for the countdown text. Zero otherwise.</summary>
        public int SecondsUntilLock { get; set; }
    }

    /// <summary>
    /// When an unattended PC should warn, and when it should lock.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A pure function of the inputs, with no timer, no window and no P/Invoke, so the rules can
    /// be tested without locking the machine running the tests. Every piece of state it needs is
    /// passed in; the caller owns it.
    /// </para>
    ///
    /// <para><b>Two thresholds, not one.</b></para>
    /// <para>
    /// The warning appears at <c>idleLockSeconds</c> and the lock follows
    /// <c>idleLockWarningSeconds</c> later — so a policy of "10 minutes, 60 second warning"
    /// locks at eleven minutes, not at ten. Read the other way round it would mean the prompt
    /// eats into the idle allowance, and an administrator setting a ten-minute policy would find
    /// screens going dark at ten minutes having been warned at nine.
    /// </para>
    ///
    /// <para><b>Why idle here is not the idle used for timesheets.</b></para>
    /// <para>
    /// <see cref="AgentPolicySettings.IdleThresholdSeconds"/> decides how recorded time is
    /// *classified* and never acts on anything. This one decides when somebody's screen goes
    /// dark. Sharing a number between them would mean neither could be adjusted without
    /// disturbing the other, and the first administrator to lengthen the idle threshold so a
    /// long meeting stopped showing as idle would also, silently, have stopped the PC locking.
    /// </para>
    ///
    /// <para><b>Locking once.</b></para>
    /// <para>
    /// A locked session receives no input, so idle keeps climbing and every subsequent evaluation
    /// would still say "lock". <paramref name="alreadyLocked"/> is what stops the agent calling
    /// <c>LockWorkStation</c> every few seconds for as long as somebody is at lunch.
    /// </para>
    /// </remarks>
    public static class IdleLockPlanner
    {
        public static IdleLockDecision Plan(
            double idleSeconds,
            AgentPolicySettings policy,
            bool warningVisible,
            bool alreadyLocked)
        {
            // No policy is the same as a policy that does not ask for this. Both mean the desk
            // is nobody's business, and a null here must never be the thing that locks a PC.
            bool enabled = policy != null && policy.LockOnIdleEnabled;

            if (!enabled || alreadyLocked)
            {
                // Still take a stale warning down. A policy switched off centrally, or a session
                // that locked for another reason, must not leave a countdown on the screen
                // promising something that is no longer going to happen.
                return new IdleLockDecision
                {
                    Action = warningVisible ? IdleLockAction.HideWarning : IdleLockAction.None,
                };
            }

            int warnAt = policy.IdleLockSeconds > 0 ? policy.IdleLockSeconds : 600;
            int grace = policy.IdleLockWarningSeconds > 0 ? policy.IdleLockWarningSeconds : 60;
            int lockAt = warnAt + grace;

            if (idleSeconds >= lockAt)
            {
                return new IdleLockDecision { Action = IdleLockAction.Lock };
            }

            if (idleSeconds >= warnAt)
            {
                int remaining = (int)(lockAt - idleSeconds);
                return new IdleLockDecision
                {
                    // Already up means leave it up; re-showing would restart its animation and
                    // steal focus again every tick.
                    Action = warningVisible ? IdleLockAction.None : IdleLockAction.ShowWarning,
                    SecondsUntilLock = remaining < 0 ? 0 : remaining,
                };
            }

            return new IdleLockDecision
            {
                Action = warningVisible ? IdleLockAction.HideWarning : IdleLockAction.None,
            };
        }

        /// <summary>
        /// Whether unlocking Windows should also require a fresh SEL LIVE sign-in.
        /// </summary>
        /// <remarks>
        /// Zero means every unlock asks, which is a legitimate choice and why this is not a
        /// boolean. A negative or absent value is treated as the default rather than as "never":
        /// a missing setting should not quietly weaken the one control an administrator switched
        /// this feature on for.
        /// </remarks>
        public static bool ShouldReauthenticateAfterLock(double lockedSeconds, AgentPolicySettings policy)
        {
            if (policy == null) return false;
            int threshold = policy.ReauthAfterLockSeconds >= 0 ? policy.ReauthAfterLockSeconds : 1800;
            return lockedSeconds >= threshold;
        }
    }
}
