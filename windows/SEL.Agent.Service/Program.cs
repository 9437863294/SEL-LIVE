using System;
using System.Diagnostics;
using System.ServiceProcess;
using Sel.Agent.Core;

namespace Sel.Agent.Service
{
    /// <summary>
    /// Service entry point, with a console mode for diagnosing it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>SEL.Agent.Service.exe --console</c> runs the same code interactively. That matters more
    /// than it looks: a service that will not start gives an administrator a message box saying
    /// "the service did not respond in a timely fashion", which is worth nothing. Running it in a
    /// console shows the actual exception, on the actual machine, in about ten seconds.
    /// </para>
    /// <para>
    /// <c>--check</c> runs the prerequisites without starting anything, so a rollout can be
    /// verified on a pilot PC before the installer is trusted with the rest of the fleet — which
    /// is §60's first stage expressed as a command.
    /// </para>
    /// </remarks>
    internal static class Program
    {
        internal static int Main(string[] args)
        {
            TlsBootstrap.Configure();

            if (HasFlag(args, "--check")) return RunPrerequisiteCheck();
            if (HasFlag(args, "--write-config")) return WriteConfiguration(args);
            if (HasFlag(args, "--reset-identity")) return ResetIdentity();

            if (HasFlag(args, "--console"))
            {
                Console.WriteLine("SEL LIVE Agent service — console mode. Ctrl+C to stop.");
                Console.WriteLine(OsCompatibility.Current.Describe());

                var service = new SelAgentService();
                service.StartFromConsole(args);
                Console.WriteLine("Running. Press Enter to stop.");
                Console.ReadLine();
                service.StopFromConsole();
                return 0;
            }

            ServiceBase.Run(new ServiceBase[] { new SelAgentService() });
            return 0;
        }

        /// <summary>
        /// Report on everything that has to be true before the agent can work.
        /// </summary>
        /// <remarks>
        /// Written to be readable by whoever is standing at the PC, and to exit non-zero when
        /// something is wrong so it can be used from a deployment script. The TLS section is the
        /// one that earns its place on Windows 7 — see <see cref="TlsBootstrap"/>.
        /// </remarks>
        private static int RunPrerequisiteCheck()
        {
            bool ok = true;
            OsCompatibility os = OsCompatibility.Current;

            Console.WriteLine("SEL LIVE Agent — prerequisite check");
            Console.WriteLine(new string('-', 60));
            Console.WriteLine("Operating system : " + os.FriendlyName + " (build " + os.Build + ", "
                + (os.Is64BitOperatingSystem ? "x64" : "x86") + ")");

            if (!os.IsSupported)
            {
                Console.WriteLine("  FAIL  " + os.UnsupportedReason);
                ok = false;
            }
            else
            {
                Console.WriteLine("  OK    Supported.");
            }

            Console.WriteLine("Notifications    : " + (os.SupportsNativeToast
                ? "native Windows toasts"
                : "SEL LIVE popup (this release has no Action Center)"));
            Console.WriteLine("Shell Launcher   : " + (os.SupportsShellLauncher
                ? "available (Enterprise/Education)"
                : "not available — the access gate is a topmost window, not an OS boundary"));

            bool dpapi = Core.Security.DpapiProtector.SelfTest();
            Console.WriteLine("DPAPI            : " + (dpapi ? "OK" : "FAIL"));
            if (!dpapi)
            {
                Console.WriteLine("        The device credential cannot be encrypted on this machine. "
                    + "This usually means it was cloned from an image without sysprep.");
                ok = false;
            }

            TlsBootstrap.SchannelState schannel = TlsBootstrap.InspectSchannel();
            Console.WriteLine("TLS 1.2          : " + (schannel.LooksUsable ? "OK" : "NEEDS ATTENTION"));
            foreach (string remedy in schannel.Remediation) Console.WriteLine("        · " + remedy);
            if (!schannel.LooksUsable) ok = false;

            AgentConfigurationProbe config = AgentConfigurationProbe.Load();
            Console.WriteLine("Configuration    : " + (config.Found ? config.ApiBaseUrl : "not found"));
            if (!config.Found)
            {
                Console.WriteLine("        Expected at " + config.ExpectedPath);
                ok = false;
            }
            else
            {
                Uri baseUri;
                if (Uri.TryCreate(config.ApiBaseUrl, UriKind.Absolute, out baseUri))
                {
                    TlsBootstrap.ProbeResult probe = TlsBootstrap.Probe(baseUri.Host, baseUri.Port, 8000);
                    Console.WriteLine("Handshake        : " + (probe.Succeeded
                        ? "OK (" + probe.NegotiatedProtocol + ")"
                        : "FAIL — " + probe.Error));
                    if (!probe.Succeeded) ok = false;
                }
            }

            Console.WriteLine(new string('-', 60));
            Console.WriteLine(ok ? "All checks passed." : "One or more checks failed — see above.");
            return ok ? 0 : 1;
        }

        /// <summary>
        /// Write <c>agent.config.json</c> from installer-supplied values.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Called by the MSI's deferred custom action. Doing it here rather than in WiX is
        /// because the file is JSON and WiX's file-editing extensions handle XML and INI —
        /// producing valid JSON from MSI formatted strings means escaping quotes through two
        /// layers, and the failure mode is a config file that looks right and will not parse.
        /// </para>
        /// <para>
        /// It also means the same code path can be run by hand during a pilot:
        /// <c>SEL.Agent.Service.exe --write-config --url https://… --key … --code SEL-HO-2026</c>
        /// — which is how §60's first two stages are set up without an MSI at all.
        /// </para>
        /// </remarks>
        private static int WriteConfiguration(string[] args)
        {
            string url = ValueOf(args, "--url");
            string key = ValueOf(args, "--key");
            string code = ValueOf(args, "--code");
            string deviceName = ValueOf(args, "--device-name");

            if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(key))
            {
                Console.Error.WriteLine("--url and --key are required.");
                return 2;
            }

            Uri parsed;
            if (!Uri.TryCreate(url, UriKind.Absolute, out parsed) || parsed.Scheme != Uri.UriSchemeHttps)
            {
                // Refused rather than accepted with a warning: an agent configured against http
                // would send its device secret in clear on every request.
                Console.Error.WriteLine("--url must be an absolute https:// address.");
                return 2;
            }

            try
            {
                string directory = Core.Security.DeviceIdentityStore.DefaultDirectory;
                System.IO.Directory.CreateDirectory(directory);
                Core.Security.DeviceIdentityStore.TryHardenAcl(directory);

                var config = new Newtonsoft.Json.Linq.JObject();
                config["apiBaseUrl"] = url.TrimEnd('/');
                config["firebaseApiKey"] = key;
                if (!string.IsNullOrEmpty(code)) config["enrollmentCode"] = code;
                if (!string.IsNullOrEmpty(deviceName)) config["deviceNameOverride"] = deviceName;
                config["verboseLogging"] = false;

                string path = System.IO.Path.Combine(directory, "agent.config.json");
                System.IO.File.WriteAllText(path, config.ToString(Newtonsoft.Json.Formatting.Indented));
                Console.WriteLine("Wrote " + path);
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Could not write the configuration: " + error.Message);
                return 1;
            }
        }

        /// <summary>
        /// Forget this machine's device credential.
        /// </summary>
        /// <remarks>
        /// The documented recovery step for a PC that was cloned from an image, or whose
        /// credential an administrator has revoked. Deliberately separate from uninstall: it
        /// lets a machine re-enrol without removing and reinstalling the agent, which on a
        /// remote site office is the difference between a two-minute fix and a site visit.
        /// </remarks>
        private static int ResetIdentity()
        {
            try
            {
                new Core.Security.DeviceIdentityStore().Clear();
                Console.WriteLine("Device credential cleared. The agent will re-enrol at its next start "
                    + "if an enrolment code is configured.");
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Could not clear the device credential: " + error.Message);
                return 1;
            }
        }

        private static string ValueOf(string[] args, string name)
        {
            if (args == null) return null;
            for (int index = 0; index < args.Length - 1; index++)
            {
                if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase))
                {
                    return args[index + 1];
                }
            }
            return null;
        }

        private static bool HasFlag(string[] args, string flag)
        {
            if (args == null) return false;
            foreach (string arg in args)
            {
                if (string.Equals(arg, flag, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
    }

    /// <summary>
    /// Reads just enough of the agent configuration for the prerequisite check.
    /// </summary>
    /// <remarks>
    /// A deliberate three-field duplicate of <c>AgentConfiguration</c> rather than a reference to
    /// it. That type lives in the WPF desktop project, and making the service depend on the
    /// desktop application would drag PresentationFramework into session 0 — for two strings.
    /// </remarks>
    internal sealed class AgentConfigurationProbe
    {
        public bool Found { get; private set; }
        public string ApiBaseUrl { get; private set; }
        public string ExpectedPath { get; private set; }

        public static AgentConfigurationProbe Load()
        {
            string path = System.IO.Path.Combine(
                Core.Security.DeviceIdentityStore.DefaultDirectory, "agent.config.json");
            var probe = new AgentConfigurationProbe { ExpectedPath = path };

            try
            {
                if (!System.IO.File.Exists(path)) return probe;
                var parsed = Newtonsoft.Json.Linq.JObject.Parse(System.IO.File.ReadAllText(path));
                probe.ApiBaseUrl = (string)parsed["apiBaseUrl"];
                probe.Found = !string.IsNullOrEmpty(probe.ApiBaseUrl);
            }
            catch (Exception)
            {
                // A malformed file reads as "not found", which produces the same actionable
                // message: the configuration needs writing.
            }

            return probe;
        }
    }

    /// <summary>
    /// Exposes the protected service lifecycle to console mode.
    /// </summary>
    /// <remarks>
    /// <c>OnStart</c> and <c>OnStop</c> are protected on <see cref="ServiceBase"/>, so a console
    /// host cannot call them without either reflection or this. An extension method on the
    /// derived type is the plainest of the options and keeps console mode running exactly the
    /// same code path as the SCM does.
    /// </remarks>
    internal static class ServiceConsoleExtensions
    {
        public static void StartFromConsole(this SelAgentService service, string[] args)
        {
            typeof(ServiceBase)
                .GetMethod("OnStart", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(service, new object[] { args ?? new string[0] });
        }

        public static void StopFromConsole(this SelAgentService service)
        {
            typeof(ServiceBase)
                .GetMethod("OnStop", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(service, null);
        }
    }
}
