using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Sel.Agent.Service
{
    /// <summary>
    /// The scheduled task that starts the agent when somebody signs in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why a task and not a Run key.</b> The agent used to be started by
    /// <c>HKLM\...\CurrentVersion\Run</c>, and that entry appears in Task Manager's "Startup
    /// apps" tab and in Settings → Apps → Startup with a switch beside it. Anybody who can get
    /// to either — which on a machine whose user is a local administrator is everybody — could
    /// turn the agent off before it ever ran, and nothing about the PC afterwards suggested
    /// anything was missing. A scheduled task is not listed in either place and cannot be
    /// disabled, deleted or edited without administrative rights.
    /// </para>
    /// <para>
    /// <b>It is also faster.</b> Explorer defers Run-key entries until it has finished building
    /// the desktop and then adds a delay of its own, which on an office PC is ten to thirty
    /// seconds of somebody typing into an application while nothing is recording. A logon
    /// trigger with no delay runs as the session starts.
    /// </para>
    /// <para>
    /// <b>Not hidden, deliberately.</b> <c>Hidden</c> is false and the description says what the
    /// task does, so an administrator looking at Task Scheduler — or a curious employee — finds
    /// an honest answer rather than something that looks like it is trying not to be found. The
    /// protection here is Windows permissions, not concealment.
    /// </para>
    /// <para>
    /// <b>A group principal, not a user.</b> <c>S-1-5-32-545</c> is BUILTIN\Users, so the task
    /// exists once per machine and runs as whoever signs in, in their own session, with their own
    /// rights (<c>LeastPrivilege</c>). Registering it per user would mean re-registering it for
    /// every new person who ever uses the PC.
    /// </para>
    /// <para>
    /// Written through <c>schtasks.exe</c> rather than the Task Scheduler COM API: this runs
    /// inside a deferred custom action where an interop failure is far harder to diagnose than a
    /// non-zero exit code and a line of text, and schtasks is present on every Windows this agent
    /// supports.
    /// </para>
    /// </remarks>
    internal static class LogonTask
    {
        internal const string TaskName = "SEL LIVE Agent";
        private const string AgentExecutable = "SEL.Agent.exe";

        internal static int Install()
        {
            string agentPath = AgentPath();
            if (agentPath == null)
            {
                Console.Error.WriteLine("Cannot find " + AgentExecutable + " beside the service; "
                    + "the logon task was not created.");
                return 1;
            }

            string xmlPath = Path.Combine(Path.GetTempPath(), "sel-agent-logon-task.xml");
            bool registered = false;
            try
            {
                // UTF-16 with a BOM: what the schema declares, and what every version of
                // schtasks accepts without argument.
                File.WriteAllText(xmlPath, BuildTaskXml(agentPath), new UnicodeEncoding(false, true));

                int exit = Run("schtasks.exe", "/Create /XML \"" + xmlPath + "\" /TN \"" + TaskName + "\" /F");
                if (exit != 0)
                {
                    // The definition is left on disk on purpose. Whoever is fixing this can
                    // register it by hand with one command, which is a far better position than
                    // being told a task failed and having to reconstruct what it should contain.
                    Console.Error.WriteLine("schtasks returned " + exit + "; the logon task was not created. "
                        + "The service will still start the agent within 30s of sign-in. "
                        + "To register it by hand from an elevated prompt: "
                        + "schtasks /Create /XML \"" + xmlPath + "\" /TN \"" + TaskName + "\" /F");
                    return exit;
                }

                registered = true;
                Console.WriteLine("Created the \"" + TaskName + "\" logon task for " + agentPath + ".");
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Could not create the logon task: " + error.Message);
                return 1;
            }
            finally
            {
                try { if (registered && File.Exists(xmlPath)) File.Delete(xmlPath); }
                catch (Exception) { /* A temp file left behind is not worth a failed install. */ }
            }
        }

        internal static int Remove()
        {
            // Return 0 whatever happens. This runs during uninstall, where a missing task — the
            // normal case when the task was never created — must not fail the removal.
            int exit = Run("schtasks.exe", "/Delete /TN \"" + TaskName + "\" /F");
            Console.WriteLine(exit == 0
                ? "Removed the \"" + TaskName + "\" logon task."
                : "No \"" + TaskName + "\" logon task to remove (schtasks returned " + exit + ").");
            return 0;
        }

        /// <summary>Whether the task is registered, for <c>--check</c>.</summary>
        internal static bool Exists()
        {
            return Run("schtasks.exe", "/Query /TN \"" + TaskName + "\"") == 0;
        }

        private static string AgentPath()
        {
            string directory = Path.GetDirectoryName(typeof(LogonTask).Assembly.Location);
            if (string.IsNullOrEmpty(directory)) return null;
            string candidate = Path.Combine(directory, AgentExecutable);
            return File.Exists(candidate) ? candidate : null;
        }

        private static string BuildTaskXml(string agentPath)
        {
            // Task schema 1.2 — the version Windows 7 understands, which is the oldest OS this
            // agent supports. 1.3 and later add nothing this task needs.
            return
                "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n"
                + "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\r\n"
                + "  <RegistrationInfo>\r\n"
                + "    <Author>Siddhartha Engineering Limited</Author>\r\n"
                + "    <Description>Starts the SEL LIVE work activity agent when a user signs in to this computer.</Description>\r\n"
                + "    <URI>\\" + TaskName + "</URI>\r\n"
                + "  </RegistrationInfo>\r\n"
                + "  <Triggers>\r\n"
                + "    <LogonTrigger>\r\n"
                + "      <Enabled>true</Enabled>\r\n"
                + "      <Delay>PT0S</Delay>\r\n"
                + "    </LogonTrigger>\r\n"
                + "  </Triggers>\r\n"
                + "  <Principals>\r\n"
                + "    <Principal id=\"Author\">\r\n"
                + "      <GroupId>S-1-5-32-545</GroupId>\r\n"
                + "      <RunLevel>LeastPrivilege</RunLevel>\r\n"
                + "    </Principal>\r\n"
                + "  </Principals>\r\n"
                + "  <Settings>\r\n"
                + "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n"
                // The agent is meant to run all day on a laptop on battery. Every one of these
                // defaults would otherwise stop it or refuse to start it.
                + "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n"
                + "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\r\n"
                + "    <AllowHardTerminate>false</AllowHardTerminate>\r\n"
                + "    <StartWhenAvailable>false</StartWhenAvailable>\r\n"
                + "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>\r\n"
                + "    <IdleSettings>\r\n"
                + "      <StopOnIdleEnd>false</StopOnIdleEnd>\r\n"
                + "      <RestartOnIdle>false</RestartOnIdle>\r\n"
                + "    </IdleSettings>\r\n"
                + "    <AllowStartOnDemand>true</AllowStartOnDemand>\r\n"
                + "    <Enabled>true</Enabled>\r\n"
                + "    <Hidden>false</Hidden>\r\n"
                + "    <RunOnlyIfIdle>false</RunOnlyIfIdle>\r\n"
                + "    <WakeToRun>false</WakeToRun>\r\n"
                // PT0S means no limit. The default is three days, after which the task engine
                // would terminate the agent on a PC nobody had restarted — which is exactly the
                // machine that would then be reported as "stopped tracking for no reason".
                + "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\r\n"
                + "    <Priority>6</Priority>\r\n"
                + "  </Settings>\r\n"
                + "  <Actions Context=\"Author\">\r\n"
                + "    <Exec>\r\n"
                + "      <Command>" + Escape(agentPath) + "</Command>\r\n"
                + "      <WorkingDirectory>" + Escape(Path.GetDirectoryName(agentPath)) + "</WorkingDirectory>\r\n"
                + "    </Exec>\r\n"
                + "  </Actions>\r\n"
                + "</Task>\r\n";
        }

        private static string Escape(string value)
        {
            return (value ?? string.Empty)
                .Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");
        }

        private static int Run(string fileName, string arguments)
        {
            try
            {
                var startInfo = new ProcessStartInfo(fileName, arguments)
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };

                using (Process process = Process.Start(startInfo))
                {
                    string output = process.StandardOutput.ReadToEnd();
                    string error = process.StandardError.ReadToEnd();
                    process.WaitForExit(30000);

                    // schtasks says something useful on both streams; passing it through is what
                    // makes an MSI log worth reading when this goes wrong.
                    if (!string.IsNullOrEmpty(output.Trim())) Console.WriteLine(output.Trim());
                    if (!string.IsNullOrEmpty(error.Trim())) Console.Error.WriteLine(error.Trim());

                    return process.HasExited ? process.ExitCode : 1;
                }
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Could not run " + fileName + ": " + error.Message);
                return 1;
            }
        }
    }
}
