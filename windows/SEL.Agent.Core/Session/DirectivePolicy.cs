using System;

namespace Sel.Agent.Core.Session
{
    /// <summary>
    /// Whether an instruction from the server still applies to the session in front of it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A directive is a one-shot instruction stored as a flag — <c>forceSignOutAt</c>,
    /// <c>forceReauthAt</c> — on the device document, because the server has no way to be told
    /// when an agent has complied. Anything stored that way is delivered again on every heartbeat
    /// for ever, so something has to decide when it is spent.
    /// </para>
    /// <para>
    /// <b>The rule: a directive raised before the current session began is already satisfied.</b>
    /// "Sign this user out" means the session that was running when an administrator clicked it.
    /// If the person has signed in since, that session is gone — by exactly the means the
    /// instruction demanded — and obeying it again would end a session it never referred to.
    /// </para>
    /// <para>
    /// This is a pure function for the same reason <see cref="IdleLockPlanner"/> is: the failure
    /// it prevents is one nobody can reproduce on demand. A force sign-out raised on one PC at
    /// 13:07 ended every subsequent login on it within about 250 milliseconds for two days, and
    /// from the desk it looked like "sign-in works, then the tray says nobody is signed in". The
    /// agent's own memory of obeyed directives could not save it: that memory is per-process, and
    /// a machine that is restarted, reinstalled or re-imaged starts with none.
    /// </para>
    /// <para>
    /// Both instants come from the server — the directive's from when it was raised, the
    /// session's from the login response — so nothing here depends on the PC's clock being right.
    /// When either is unknown the directive is obeyed, because failing to enforce is the worse of
    /// the two mistakes for an instruction an administrator has deliberately given.
    /// </para>
    /// </remarks>
    public static class DirectivePolicy
    {
        /// <param name="issuedUtc">When the administrator raised it. <see cref="DateTime.MinValue"/> if unknown.</param>
        /// <param name="sessionStartUtc">When the current session's login was stamped by the server.</param>
        public static bool ShouldObey(DateTime issuedUtc, DateTime sessionStartUtc)
        {
            if (issuedUtc == DateTime.MinValue) return true;
            if (sessionStartUtc == DateTime.MinValue) return true;

            // Strictly before, so an administrator who clicks "sign out" in the same instant as
            // somebody signs in is still obeyed. The stale case this exists for is hours or days
            // out, never milliseconds.
            return issuedUtc >= sessionStartUtc;
        }
    }
}
