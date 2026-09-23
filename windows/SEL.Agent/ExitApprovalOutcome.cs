namespace Sel.Agent
{
    /// <summary>
    /// Which act an administrator is being asked to authorise.
    /// </summary>
    /// <remarks>
    /// The same permission covers both and the same window asks, but the wording and the audit
    /// action differ — closing the agent pauses recording until the next sign-in, while removing
    /// it ends recording on that computer for good. A single "approve" that meant either would
    /// leave the audit trail unable to answer why a PC has no data since March.
    /// </remarks>
    public enum ApprovalPurpose
    {
        Exit = 0,
        Uninstall = 1,
        /// <summary>
        /// Stopping the Windows service — the widest of the three.
        /// </summary>
        /// <remarks>
        /// Exit closes the agent until the next sign-in and the service brings it back. Stopping
        /// the service removes the thing that would bring it back, so the PC records nothing
        /// until somebody restarts it or reboots.
        /// </remarks>
        StopService = 2,
    }

    /// <summary>
    /// What came back from asking SEL LIVE for permission to close the agent.
    /// </summary>
    /// <remarks>
    /// A result type rather than an exception, because every outcome here is expected: a typo in
    /// the password, an account without the permission, a network that is down. None of those is
    /// exceptional in a dialog whose whole job is to report them, and each needs a different
    /// sentence rather than a stack trace.
    /// </remarks>
    public sealed class ExitApprovalOutcome
    {
        /// <summary>True only when SEL LIVE said yes. Refusal and failure are both false.</summary>
        public bool Approved { get; set; }

        /// <summary>Who approved it, for the agent log and the closing message.</summary>
        public string ApprovedByName { get; set; }

        /// <summary>Why not, in words an administrator can act on. Null when approved.</summary>
        public string Message { get; set; }
    }
}
