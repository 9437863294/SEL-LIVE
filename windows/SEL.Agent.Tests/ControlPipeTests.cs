using System;
using System.IO;
using System.IO.Pipes;
using System.Threading;
using Newtonsoft.Json;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Service;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// The channel by which an approved administrator stops the service.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Worth testing for real rather than reading: this is the one way into a process running as
    /// LocalSystem, and the whole of its safety is that it decides nothing itself. The tests
    /// drive the actual pipe with the actual contract and substitute only the server's verdict —
    /// so "refuses when SEL LIVE says no" and "never asks when there is no token" are observed,
    /// not assumed.
    /// </para>
    /// <para>
    /// They use the real named pipe, so they are not quite unit tests. That is the point: the
    /// failure they exist to catch — a reply discarded when the server disconnects before the
    /// client has read it — cannot happen against a mock.
    /// </para>
    /// </remarks>
    public class ControlPipeTests : IDisposable
    {
        private ControlPipe _pipe;

        public void Dispose()
        {
            if (_pipe != null) _pipe.Dispose();
        }

        private sealed class Recorder
        {
            internal string TokenSeen;
            internal string ReasonSeen;
            internal int TimesAsked;
            internal readonly ManualResetEventSlim Stopped = new ManualResetEventSlim(false);
        }

        private Recorder StartPipe(bool approve)
        {
            var recorder = new Recorder();
            _pipe = new ControlPipe(
                (token, reason) =>
                {
                    recorder.TimesAsked++;
                    recorder.TokenSeen = token;
                    recorder.ReasonSeen = reason;
                    return approve;
                },
                () => recorder.Stopped.Set(),
                message => { });

            _pipe.Start();
            // The listener thread has to reach WaitForConnection before a client can connect.
            Thread.Sleep(300);
            return recorder;
        }

        private static AgentControlResponse Send(string json)
        {
            using (var client = new NamedPipeClientStream(".", AgentControlChannel.PipeName, PipeDirection.InOut))
            {
                client.Connect(5000);
                var writer = new StreamWriter(client) { AutoFlush = true };
                var reader = new StreamReader(client);

                writer.WriteLine(json);
                string line = reader.ReadLine();
                return line == null ? null : JsonConvert.DeserializeObject<AgentControlResponse>(line);
            }
        }

        private static string StopRequest(string token, string reason)
        {
            return JsonConvert.SerializeObject(new AgentControlRequest
            {
                Command = AgentControlChannel.StopCommand,
                IdToken = token,
                Reason = reason,
            });
        }

        [Fact]
        public void An_approved_request_stops_the_service()
        {
            Recorder recorder = StartPipe(approve: true);

            AgentControlResponse response = Send(StopRequest("an-administrators-id-token", "swapping the PC"));

            Assert.NotNull(response);
            Assert.True(response.Ok, response == null ? "no reply" : response.Message);
            Assert.True(recorder.Stopped.Wait(TimeSpan.FromSeconds(5)), "the service was never stopped");
            Assert.Equal("an-administrators-id-token", recorder.TokenSeen);
            Assert.Equal("swapping the PC", recorder.ReasonSeen);
        }

        [Fact]
        public void A_refused_request_leaves_the_service_running()
        {
            Recorder recorder = StartPipe(approve: false);

            AgentControlResponse response = Send(StopRequest("somebody-elses-token", null));

            Assert.NotNull(response);
            Assert.False(response.Ok);
            Assert.Contains("not allowed", response.Message, StringComparison.OrdinalIgnoreCase);
            Assert.False(recorder.Stopped.Wait(TimeSpan.FromSeconds(1)), "a refused request stopped the service");
            Assert.Equal(1, recorder.TimesAsked);
        }

        [Fact]
        public void A_request_with_no_token_is_refused_without_troubling_the_server()
        {
            Recorder recorder = StartPipe(approve: true);

            AgentControlResponse response = Send("{\"command\":\"stop\"}");

            Assert.NotNull(response);
            Assert.False(response.Ok);
            Assert.Equal(0, recorder.TimesAsked);
            Assert.False(recorder.Stopped.Wait(TimeSpan.FromMilliseconds(500)));
        }

        [Fact]
        public void An_unknown_command_is_refused()
        {
            Recorder recorder = StartPipe(approve: true);

            AgentControlResponse response = Send("{\"command\":\"uninstall\",\"idToken\":\"x\"}");

            Assert.NotNull(response);
            Assert.False(response.Ok);
            Assert.Equal(0, recorder.TimesAsked);
        }

        [Fact]
        public void Rubbish_is_refused_rather_than_crashing_the_listener()
        {
            Recorder recorder = StartPipe(approve: true);

            AgentControlResponse first = Send("this is not json");
            Assert.NotNull(first);
            Assert.False(first.Ok);

            // And the listener is still there afterwards, which is the part that matters: a
            // malformed request must not take the channel down until the next reboot.
            AgentControlResponse second = Send(StopRequest("an-administrators-id-token", "after rubbish"));
            Assert.NotNull(second);
            Assert.True(second.Ok);
            Assert.True(recorder.Stopped.Wait(TimeSpan.FromSeconds(5)));
        }

        [Fact]
        public void A_server_that_cannot_be_reached_is_not_an_approval()
        {
            // The approval delegate throwing is what an unreachable SEL LIVE looks like from
            // here. A service that stopped itself because it could not check would be a service
            // anybody could stop by pulling the network cable out.
            var stopped = new ManualResetEventSlim(false);
            _pipe = new ControlPipe(
                (token, reason) => throw new InvalidOperationException("network is down"),
                () => stopped.Set(),
                message => { });
            _pipe.Start();
            Thread.Sleep(300);

            AgentControlResponse response = Send(StopRequest("an-administrators-id-token", null));

            Assert.NotNull(response);
            Assert.False(response.Ok);
            Assert.Contains("could not be reached", response.Message, StringComparison.OrdinalIgnoreCase);
            Assert.False(stopped.Wait(TimeSpan.FromSeconds(1)));
        }
    }
}
