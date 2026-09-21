namespace Sel.Agent.Core
{
    /// <summary>
    /// Facts about the SEL LIVE installation this agent is built for.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The counterpart of <c>src/lib/firebase-public-config.ts</c> on the web side, and written
    /// for the same reason. That file hard-codes this company's Firebase project rather than
    /// reading it from the environment, having been burnt once by a stale environment variable
    /// naming a retired app registration. This is the same value class: public, singular, and
    /// worse for being configurable.
    /// </para>
    /// <para>
    /// In Core rather than beside <c>AgentConfiguration</c> because the service needs it too,
    /// and the service deliberately does not reference the WPF assembly.
    /// </para>
    /// </remarks>
    public static class SelLiveDeployment
    {
        /// <summary>
        /// The ERP's address, used when nothing overrides it.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Overridable everywhere it matters — the MSI's <c>APIBASEURL</c> property, the
        /// first-run setup window, and the service's write-config switch — so a staging server
        /// or a renamed domain needs no rebuild. A default, not a constraint.
        /// </para>
        /// <para>
        /// Having one means the ordinary install is "double-click, approve, done". Before it,
        /// every PC needed somebody to type an address, and a typo there does not fail at
        /// install time: it fails later, on somebody else's morning, as a connection error.
        /// </para>
        /// </remarks>
        public const string DefaultApiBaseUrl = "https://seltech.store";
    }
}
