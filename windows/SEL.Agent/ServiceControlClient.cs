using System;
using System.IO;
using System.IO.Pipes;
using Newtonsoft.Json;
using Sel.Agent.Core.Contracts;

namespace Sel.Agent
{
    /// <summary>
    /// Asks the Windows service to stop, carrying the approval that entitles it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The agent cannot stop the service itself — the hardened descriptor refuses
    /// <c>SERVICE_STOP</c> to everybody but SYSTEM, deliberately, because otherwise anybody who
    /// could open services.msc could take the watchdog out. So it hands the approving
    /// administrator's token to the service and the service does the asking.
    /// </para>
    /// <para>
    /// Nothing here is trusted by the other end. This process runs as the signed-in user and
    /// could be replaced by anything that user can write; the service treats the token as
    /// evidence to be checked with SEL LIVE, not as an instruction. That is also why this client
    /// is thin enough to be uninteresting: it has no decision to make.
    /// </para>
    /// </remarks>
    internal static class ServiceControlClient
    {
        private const int ConnectTimeoutMs = 3000;

        internal sealed class Result
        {
            public bool Ok { get; set; }
            public string Message { get; set; }
        }

        internal static Result RequestStop(string approverIdToken, string reason)
        {
            try
            {
                using (var pipe = new NamedPipeClientStream(".", AgentControlChannel.PipeName, PipeDirection.InOut))
                {
                    pipe.Connect(ConnectTimeoutMs);

                    var writer = new StreamWriter(pipe) { AutoFlush = true };
                    var reader = new StreamReader(pipe);

                    writer.WriteLine(JsonConvert.SerializeObject(new AgentControlRequest
                    {
                        Command = AgentControlChannel.StopCommand,
                        IdToken = approverIdToken,
                        Reason = reason,
                    }));

                    string line = reader.ReadLine();
                    if (string.IsNullOrEmpty(line))
                    {
                        return new Result { Message = "The service closed the connection without answering." };
                    }

                    AgentControlResponse response = JsonConvert.DeserializeObject<AgentControlResponse>(line);
                    return new Result
                    {
                        Ok = response != null && response.Ok,
                        Message = response == null ? "The service answered with something unreadable." : response.Message,
                    };
                }
            }
            catch (TimeoutException)
            {
                // The usual cause by far, and worth naming rather than reporting as a fault: on a
                // machine where the service is already stopped there is nothing to stop.
                return new Result
                {
                    Message = "The SEL LIVE Agent service is not running, so there is nothing to stop.",
                };
            }
            catch (Exception error)
            {
                return new Result { Message = "Could not reach the SEL LIVE Agent service: " + error.Message };
            }
        }
    }
}
