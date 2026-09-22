using System;
using System.Diagnostics;
using System.IO;
using Sel.Agent.Core.Security;

namespace Sel.Agent
{
    /// <summary>
    /// A few lines saying how far start-up got, always written, whatever the policy says.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why this exists as well as <see cref="AgentLog"/>.</b> The agent's log is off by
    /// default, deliberately — it names the applications somebody had open, and leaving that on
    /// every PC would undo the care taken everywhere else. The consequence was a blind spot
    /// exactly where it hurt most: an agent that exited during start-up wrote nothing at all, so
    /// the service's event log entry ("started but exited within 3s") had to guess at the cause,
    /// and the guess it printed told administrators to turn on a log that the very next start
    /// would need to already have been on.
    /// </para>
    /// <para>
    /// This file is different because of what it is allowed to contain: process facts and
    /// start-up milestones, and nothing observed about the person using the machine. No window
    /// titles, no application names, no addresses. That is what makes it safe to leave on
    /// permanently, and it is a rule this class enforces by only being called from the start-up
    /// path.
    /// </para>
    /// <para>
    /// <b>The parent process is the single most useful field.</b> The agent can be started by the
    /// scheduled task, by the service watchdog, or by a person double-clicking it, and those
    /// three fail in different ways. Recording which one asked turns "the agent did not start" —
    /// the report that arrives from a site office — into a question with an answer.
    /// </para>
    /// </remarks>
    internal static class StartupTrace
    {
        private const long MaxBytes = 64 * 1024;
        private static readonly object Gate = new object();
        private static string _path;

        /// <summary>Called once, as early as possible, before anything can fail.</summary>
        internal static void Begin()
        {
            try
            {
                _path = Path.Combine(DeviceIdentityStore.DefaultDirectory, "startup.log");
                Process self = Process.GetCurrentProcess();
                Write("---- start: pid " + self.Id
                    + ", session " + self.SessionId
                    + ", " + Core.AgentVersion.Current
                    + ", launched by " + DescribeParent()
                    + (Environment.Is64BitProcess ? ", 64-bit" : ", 32-bit"));
            }
            catch (Exception)
            {
                // A diagnostic that breaks start-up would be worse than no diagnostic.
            }
        }

        internal static void Write(string message)
        {
            if (_path == null || string.IsNullOrEmpty(message)) return;

            try
            {
                lock (Gate)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(_path));

                    // Truncate rather than roll. One previous file is worth keeping for an
                    // activity log that is read days later; these lines are only ever read about
                    // the start that just happened, so the newest are the only ones that matter.
                    var existing = new FileInfo(_path);
                    if (existing.Exists && existing.Length > MaxBytes) existing.Delete();

                    File.AppendAllText(_path,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message + Environment.NewLine);
                }
            }
            catch (Exception)
            {
                // Same reasoning as above.
            }
        }

        /// <summary>
        /// The name of whatever started this process, or why that could not be established.
        /// </summary>
        /// <remarks>
        /// Read through WMI because .NET Framework offers no supported way to get a parent
        /// process id, and the alternative — <c>NtQueryInformationProcess</c> — is an undocumented
        /// call to make on every start for a log line. A parent that has already exited is the
        /// normal case for a scheduled task, so a failure here is not worth reporting as one.
        /// </remarks>
        private static string DescribeParent()
        {
            try
            {
                using (var searcher = new System.Management.ManagementObjectSearcher(
                    "SELECT ParentProcessId FROM Win32_Process WHERE ProcessId = "
                    + Process.GetCurrentProcess().Id))
                {
                    foreach (System.Management.ManagementObject row in searcher.Get())
                    {
                        using (row)
                        {
                            var parentId = (uint)row["ParentProcessId"];
                            try
                            {
                                using (Process parent = Process.GetProcessById((int)parentId))
                                {
                                    return parent.ProcessName + " (pid " + parentId + ")";
                                }
                            }
                            catch (Exception)
                            {
                                return "pid " + parentId + ", already gone";
                            }
                        }
                    }
                }
            }
            catch (Exception)
            {
                // WMI unavailable or refused. Not worth a line of its own.
            }

            return "unknown";
        }
    }
}
