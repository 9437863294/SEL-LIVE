using System;
using System.Diagnostics;
using Sel.Agent.Core.Security;

namespace Sel.Agent.Service
{
    /// <summary>
    /// Applies and removes the service's hardened security descriptor.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The rules — who keeps which right, and why administrators deliberately keep WRITE_DAC —
    /// are in <see cref="ServiceSecurityRules"/>. This is only the part that talks to Windows.
    /// </para>
    /// <para>
    /// Through <c>sc.exe</c> rather than <c>ChangeServiceObjectSecurity</c>, for the same reason
    /// the logon task goes through <c>schtasks</c>: this runs inside a deferred custom action
    /// where an interop failure is far harder to read afterwards than a non-zero exit code and a
    /// line of text, and sc.exe has shipped with every Windows this agent supports.
    /// </para>
    /// </remarks>
    internal static class ServiceProtection
    {
        internal const string ServiceName = "SELLiveAgent";

        internal static int Protect()
        {
            return Apply(ServiceSecurityRules.ProtectedSddl(),
                "Stop is now refused to everybody but SYSTEM. An administrator who genuinely needs "
                + "to stop the service either approves it in SEL LIVE, or restores the default "
                + "descriptor — the recovery command is in the deployment guide.");
        }

        internal static int Unprotect()
        {
            return Apply(ServiceSecurityRules.DefaultSddl(),
                "The service can be stopped by administrators again.");
        }

        private static int Apply(string sddl, string note)
        {
            // sdset takes the descriptor as one argument; it contains no spaces, but quote it
            // anyway so a future edit that introduces one does not silently truncate.
            int exit = Run("sc.exe", "sdset " + ServiceName + " \"" + sddl + "\"");
            if (exit != 0)
            {
                Console.Error.WriteLine("Could not set the service security descriptor (sc returned "
                    + exit + "). This needs to run elevated. The agent still works; the Stop button "
                    + "in services.msc is simply not protected.");
                return exit;
            }

            Console.WriteLine(note);
            return 0;
        }

        /// <summary>What Windows currently has, for the prerequisite check.</summary>
        internal static string CurrentSddl()
        {
            string output;
            int exit = Run("sc.exe", "sdshow " + ServiceName, out output);
            if (exit != 0) return null;

            // sdshow prints blank lines around the descriptor.
            foreach (string line in output.Split('\n'))
            {
                string trimmed = line.Trim();
                if (trimmed.StartsWith("D:", StringComparison.Ordinal)) return trimmed;
            }
            return null;
        }

        private static int Run(string fileName, string arguments)
        {
            string ignored;
            return Run(fileName, arguments, out ignored);
        }

        private static int Run(string fileName, string arguments, out string output)
        {
            output = string.Empty;
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
                    output = process.StandardOutput.ReadToEnd();
                    string error = process.StandardError.ReadToEnd();
                    process.WaitForExit(30000);

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
