using Newtonsoft.Json;

namespace Sel.Agent.Core.Contracts
{
    /// <summary>
    /// The local channel between the desktop agent and the Windows service.
    /// </summary>
    /// <remarks>
    /// Shared rather than declared twice because the two ends are in different executables that
    /// ship together: a pipe name that drifted by one character would produce an agent that
    /// silently cannot reach its own service, and nothing would say so until somebody tried to
    /// stop it.
    /// </remarks>
    public static class AgentControlChannel
    {
        /// <summary>Local named pipe. Not exposed over SMB — see the service's ControlPipe.</summary>
        public const string PipeName = "SEL.LIVE.Agent.Control";

        /// <summary>The only command the service accepts.</summary>
        public const string StopCommand = "stop";
    }

    /// <summary>What the agent sends. One command, and the evidence for it.</summary>
    public sealed class AgentControlRequest
    {
        [JsonProperty("command")] public string Command { get; set; }

        /// <summary>
        /// The approving administrator's Firebase ID token.
        /// </summary>
        /// <remarks>
        /// The service does not take this as proof of anything by itself — it forwards it to
        /// <c>/api/windows-agent/exit-approval</c> with the device credential and lets the server
        /// decide. Never written to disk or to a log at either end.
        /// </remarks>
        [JsonProperty("idToken")] public string IdToken { get; set; }

        [JsonProperty("reason")] public string Reason { get; set; }
    }

    /// <summary>What the service answers.</summary>
    public sealed class AgentControlResponse
    {
        [JsonProperty("ok")] public bool Ok { get; set; }
        [JsonProperty("message")] public string Message { get; set; }
    }
}
