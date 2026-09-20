using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Sel.Agent.Core.Security;

namespace Sel.Agent
{
    /// <summary>
    /// A small rolling log, plus the in-memory tail the status window shows.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Deliberately not a logging framework. The agent has one process, one log and no need for
    /// structured sinks or levels; adding NLog or Serilog would mean two more assemblies to
    /// deploy, binding redirects on .NET Framework, and a configuration file for a feature whose
    /// entire requirement is "write a line, keep the last few hundred".
    /// </para>
    ///
    /// <para><b>The in-memory ring is the part that matters operationally.</b></para>
    /// <para>
    /// File logging is <i>off by default</i> — see <see cref="AgentConfiguration.VerboseLogging"/>
    /// for why: the log names the applications somebody had open, which is the same data the
    /// offline queue goes to the trouble of encrypting. The ring buffer is always on, lives only
    /// in memory, and is what the "Agent status" window shows. That gives IT something to look at
    /// over somebody's shoulder without leaving a copy of their day on the disk.
    /// </para>
    ///
    /// <para><b>Rolling is by size, checked on write.</b></para>
    /// <para>
    /// No background timer and no second file handle: a size check on an already-open stream is
    /// cheap, and an agent that logs a line every few minutes will take months to reach the cap.
    /// One previous file is kept, which is enough to cover a problem reported the next morning.
    /// </para>
    /// </remarks>
    public sealed class AgentLog
    {
        private const int RingCapacity = 400;
        private const long MaxFileBytes = 2 * 1024 * 1024;

        private readonly Queue<string> _ring = new Queue<string>(RingCapacity);
        private readonly object _gate = new object();
        private readonly bool _toFile;
        private readonly string _path;

        public AgentLog(bool toFile)
        {
            _toFile = toFile;
            _path = Path.Combine(DeviceIdentityStore.DefaultDirectory, "agent.log");
        }

        /// <summary>Raised on every line, so the status window can append live.</summary>
        public event EventHandler<string> LineWritten;

        public void Write(string message)
        {
            if (string.IsNullOrEmpty(message)) return;

            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message;

            lock (_gate)
            {
                if (_ring.Count >= RingCapacity) _ring.Dequeue();
                _ring.Enqueue(line);
                if (_toFile) AppendToFile(line);
            }

            EventHandler<string> handler = LineWritten;
            if (handler != null)
            {
                try { handler(this, line); }
                catch { /* a UI subscriber's fault must not break logging */ }
            }
        }

        private void AppendToFile(string line)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path));

                var info = new FileInfo(_path);
                if (info.Exists && info.Length > MaxFileBytes)
                {
                    string previous = _path + ".1";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(_path, previous);
                }

                File.AppendAllText(_path, line + Environment.NewLine, Encoding.UTF8);
            }
            catch (Exception)
            {
                // A log that cannot be written must never stop the thing it is logging. Silence
                // is correct here: reporting a logging failure would need somewhere to report it.
            }
        }

        /// <summary>The recent lines, oldest first.</summary>
        public string[] Tail()
        {
            lock (_gate)
            {
                return _ring.ToArray();
            }
        }
    }
}
