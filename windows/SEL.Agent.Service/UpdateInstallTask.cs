using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Sel.Agent.Service
{
    /// <summary>
    /// Hands a verified installer to the Task Scheduler, so it survives this service stopping.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The installer's first act on an upgrade is to stop <c>SELLiveAgent</c>. A process started
    /// from the service belongs to the service's job object, so that stop would take the
    /// installer with it — half way through replacing the files it is running from. The task
    /// engine has no such relationship with the service.
    /// </para>
    /// <para>
    /// <b>One shot, and it deletes itself.</b> <c>/Z</c> removes the task after it runs, so a PC
    /// does not accumulate one per update, and a task left behind cannot re-run an old installer
    /// months later. The two-minute delay is there so the service has finished its own tick and
    /// written its log line before the ground moves.
    /// </para>
    /// <para>
    /// Through <c>schtasks</c> rather than the COM API for the same reason as the logon task: a
    /// non-zero exit code and a line of text are far easier to read afterwards than an interop
    /// failure inside a service.
    /// </para>
    /// </remarks>
    internal static class UpdateInstallTask
    {
        internal const string TaskName = "SEL LIVE Agent Update";

        /// <summary>
        /// Register a one-shot SYSTEM task that installs <paramref name="installerPath"/>.
        /// </summary>
        /// <returns>False when the task could not be registered; the caller keeps the package.</returns>
        internal static bool ScheduleIn(string installerPath, TimeSpan delay, Action<string> log)
        {
            if (string.IsNullOrEmpty(installerPath) || !File.Exists(installerPath)) return false;

            DateTime runAt = DateTime.Now.Add(delay);

            // schtasks takes the time in the machine's own locale, and its date format is the
            // one place this is genuinely fiddly — /ST is 24-hour HH:mm and /SD follows the
            // short date pattern. Using the current culture's pattern is what makes this work on
            // a machine set to en-GB, en-US or hi-IN alike.
            string startTime = runAt.ToString("HH:mm");
            string startDate = runAt.ToString(System.Globalization.CultureInfo.CurrentCulture.DateTimeFormat.ShortDatePattern);

            // /quiet is Burn's silent switch; /norestart keeps it from rebooting a PC somebody is
            // working on. The upgrade restarts the service itself, and the watchdog brings the
            // desktop agent back within thirty seconds.
            string command = "\"" + installerPath + "\" /quiet /norestart";

            var arguments = new StringBuilder();
            arguments.Append("/Create /F /TN \"").Append(TaskName).Append("\"");
            arguments.Append(" /TR ").Append("\"").Append(command.Replace("\"", "\\\"")).Append("\"");
            arguments.Append(" /SC ONCE /ST ").Append(startTime).Append(" /SD ").Append(startDate);
            arguments.Append(" /RU SYSTEM /RL HIGHEST /Z /V1");

            int exit = Run("schtasks.exe", arguments.ToString(), log);
            if (exit != 0)
            {
                log("schtasks returned " + exit + " while scheduling the update install.");
                return false;
            }

            log("The update will install at " + runAt.ToString("HH:mm") + ". The service will stop and "
                + "restart as part of it, and the agent returns with it.");
            return true;
        }

        private static int Run(string fileName, string arguments, Action<string> log)
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
                    process.WaitForExit(60_000);

                    if (!string.IsNullOrEmpty(output.Trim())) log(output.Trim());
                    if (!string.IsNullOrEmpty(error.Trim())) log(error.Trim());

                    return process.HasExited ? process.ExitCode : 1;
                }
            }
            catch (Exception error)
            {
                log("Could not run " + fileName + ": " + error.Message);
                return 1;
            }
        }
    }
}
