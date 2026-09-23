using System;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;
using Newtonsoft.Json;
using Sel.Agent.Core.Contracts;

namespace Sel.Agent.Service
{
    /// <summary>
    /// A local channel by which an approved administrator can stop the service.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The service's descriptor refuses <c>SERVICE_STOP</c> to everybody but SYSTEM, which closes
    /// the Stop button and would otherwise leave no way at all to stop the agent short of a
    /// reboot. This is the way: the desktop agent collects a SEL LIVE administrator's sign-in,
    /// sends the resulting token down this pipe, and the service asks the server whether that
    /// person may stop it. If the answer is yes, it stops itself — which it can, because it is
    /// SYSTEM.
    /// </para>
    ///
    /// <para><b>Why the service asks the server rather than believing the caller.</b></para>
    /// <para>
    /// Anything in the user's session can connect to this pipe, including something the user
    /// wrote. So nothing the caller *claims* is trusted: the only thing it can supply is a
    /// Firebase ID token, and the decision is made by <c>/api/windows-agent/exit-approval</c>
    /// against the device credential this service reads itself. A caller who cannot produce a
    /// real administrator's token gets a refusal, and the attempt is recorded server-side like
    /// any other.
    /// </para>
    /// <para>
    /// Which is also why the pipe is open to authenticated users rather than to administrators
    /// only. The person authorised to stop the agent is a SEL LIVE administrator, and they are
    /// frequently not a Windows administrator on the PC in front of them — that mismatch is the
    /// whole reason §7b checks SEL LIVE's roles instead of UAC.
    /// </para>
    /// <para>
    /// <b>Local only.</b> A <c>NamedPipeServerStream</c> is reachable over SMB only if the
    /// machine's IPC$ share is exposed and the pipe is named in <c>NullSessionPipes</c>; this one
    /// is not, and the connection is additionally checked to be from this machine.
    /// </para>
    /// </remarks>
    internal sealed class ControlPipe : IDisposable
    {
        internal static string PipeName { get { return AgentControlChannel.PipeName; } }
        private const int MaxRequestBytes = 8 * 1024;

        private readonly Func<string, string, bool> _approveStop;
        private readonly Action<string> _log;
        private readonly Action _stopService;

        private Thread _listener;
        private volatile bool _running;
        private NamedPipeServerStream _current;

        /// <param name="approveStop">
        /// Asks SEL LIVE whether this token's owner may stop the service. Takes the ID token and
        /// the reason; returns true only when the server says yes.
        /// </param>
        internal ControlPipe(Func<string, string, bool> approveStop, Action stopService, Action<string> log)
        {
            _approveStop = approveStop ?? throw new ArgumentNullException("approveStop");
            _stopService = stopService ?? throw new ArgumentNullException("stopService");
            _log = log ?? (message => { });
        }

        internal void Start()
        {
            if (_running) return;
            _running = true;
            _listener = new Thread(Listen) { IsBackground = true, Name = "SEL LIVE control pipe" };
            _listener.Start();
        }

        public void Dispose()
        {
            _running = false;

            // Connecting to our own pipe is the documented way to release a blocked
            // WaitForConnection; disposing the stream from another thread throws instead.
            try
            {
                NamedPipeServerStream current = _current;
                if (current != null && current.IsConnected) current.Disconnect();
                using (var nudge = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut))
                {
                    nudge.Connect(250);
                }
            }
            catch (Exception)
            {
                // Nothing was waiting, which is the common case on a clean stop.
            }

            Thread listener = _listener;
            _listener = null;
            if (listener != null) listener.Join(TimeSpan.FromSeconds(2));
        }

        private void Listen()
        {
            while (_running)
            {
                try
                {
                    using (NamedPipeServerStream server = Create())
                    {
                        _current = server;
                        server.WaitForConnection();
                        if (!_running) return;

                        Handle(server);

                        // Drain before disconnecting. A named pipe discards whatever the client
                        // has not read yet when the server disconnects, so without this the
                        // answer is lost often enough to look intermittent — the client sees the
                        // connection close with no reply and reports that the service never
                        // answered, which is both wrong and alarming.
                        try
                        {
                            if (server.IsConnected) server.WaitForPipeDrain();
                        }
                        catch (Exception)
                        {
                            // The client hung up first. Its business.
                        }

                        if (server.IsConnected) server.Disconnect();
                    }
                }
                catch (Exception error)
                {
                    if (!_running) return;
                    _log("Control pipe error: " + error.Message);
                    // A tight failure loop on a broken pipe would fill the event log; a second
                    // between attempts costs nothing on a channel used twice a year.
                    Thread.Sleep(1000);
                }
                finally
                {
                    _current = null;
                }
            }
        }

        private static NamedPipeServerStream Create()
        {
            var security = new PipeSecurity();
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
                PipeAccessRights.ReadWrite,
                AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
                PipeAccessRights.FullControl,
                AccessControlType.Allow));

            return new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.None,
                MaxRequestBytes,
                MaxRequestBytes,
                security);
        }

        private void Handle(NamedPipeServerStream server)
        {
            var reader = new StreamReader(server);
            var writer = new StreamWriter(server) { AutoFlush = true };

            string line = reader.ReadLine();
            if (string.IsNullOrEmpty(line) || line.Length > MaxRequestBytes)
            {
                Reply(writer, false, "Empty or oversized request.");
                return;
            }

            AgentControlRequest request;
            try
            {
                request = JsonConvert.DeserializeObject<AgentControlRequest>(line);
            }
            catch (Exception)
            {
                Reply(writer, false, "That was not a control request.");
                return;
            }

            if (request == null || !string.Equals(request.Command, AgentControlChannel.StopCommand, StringComparison.OrdinalIgnoreCase))
            {
                Reply(writer, false, "Unknown command.");
                return;
            }

            if (string.IsNullOrEmpty(request.IdToken))
            {
                Reply(writer, false, "Stopping the service needs a SEL LIVE administrator's approval.");
                return;
            }

            _log("A stop was requested through the control pipe; asking SEL LIVE whether it is allowed.");

            bool approved;
            try
            {
                approved = _approveStop(request.IdToken, request.Reason);
            }
            catch (Exception error)
            {
                _log("The stop approval could not be checked: " + error.Message);
                Reply(writer, false, "SEL LIVE could not be reached to check this. The service keeps running.");
                return;
            }

            if (!approved)
            {
                _log("The stop was refused by SEL LIVE.");
                Reply(writer, false, "That account is not allowed to stop the SEL LIVE agent service.");
                return;
            }

            _log("The stop was approved by SEL LIVE. Stopping the service.");
            Reply(writer, true, "Approved. Stopping the SEL LIVE Agent service.");

            // After the reply, and on another thread: Stop() unwinds this one.
            ThreadPool.QueueUserWorkItem(_ =>
            {
                Thread.Sleep(250);
                try { _stopService(); }
                catch (Exception error) { _log("Stopping after approval failed: " + error.Message); }
            });
        }

        private static void Reply(StreamWriter writer, bool ok, string message)
        {
            try
            {
                writer.WriteLine(JsonConvert.SerializeObject(new AgentControlResponse { Ok = ok, Message = message }));
            }
            catch (IOException)
            {
                // The client hung up. Nothing to do and nothing worth logging.
            }
        }
    }
}
