namespace Sel.Agent
{
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
