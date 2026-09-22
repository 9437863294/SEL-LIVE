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
                    // A plain TCP connect for an http development server; a real TLS handshake
                    // for anything else. Probing TLS against http://localhost:3000 always fails
                    // with an unhelpful packet-format error and is not a problem worth reporting.
                    bool overTls = baseUri.Scheme == Uri.UriSchemeHttps;
                    TlsBootstrap.ProbeResult probe = overTls
                        ? TlsBootstrap.Probe(baseUri.Host, baseUri.Port, 8000)
                        : TlsBootstrap.ProbeTcp(baseUri.Host, baseUri.Port, 8000);

                    Console.WriteLine("Reachability     : " + (probe.Succeeded
                        ? "OK (" + probe.NegotiatedProtocol + ")"
                        : "FAIL - " + probe.Error));

                    if (!probe.Succeeded)
                    {
                        ok = false;
                        if (!overTls)
                        {
                            Console.WriteLine("        Nothing is listening on " + baseUri.Host + ":" + baseUri.Port
                                + ". Start the SEL LIVE development server (npm run dev) and try again.");
                        }
                    }
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
            string deviceName = ValueOf(args, "--device-name");

            // Upper-cased here, as the setup window does, because the code is a document id and
            // those are always upper case. The server normalises before it looks one up, so a
            // lower-case code still works — but it would sit in the configuration file looking
            // different from the code in the administrator's list, which is the kind of small
            // discrepancy that costs somebody an hour when they are comparing the two.
            string code = ValueOf(args, "--code");
            if (!string.IsNullOrEmpty(code)) code = code.Trim().ToUpperInvariant();

            if (string.IsNullOrEmpty(url))
            {
                Console.Error.WriteLine("--url is required.");
                return 2;
            }

            Uri parsed;
            if (!Uri.TryCreate(url, UriKind.Absolute, out parsed))
            {
                Console.Error.WriteLine(
                    "--url must be an absolute address, e.g. " + SelLiveDeployment.DefaultApiBaseUrl);
                return 2;
            }

            // HTTPS everywhere except loopback.
            //
            // An agent configured against plain http would send its device secret in clear on
            // every request, so that is refused rather than warned about. Loopback is the one
            // exception, and it is a real one rather than a convenience: `next dev` serves http
            // on localhost, traffic never leaves the machine, and without this carve-out the only
            // way to test the agent against a development server would be to stand up TLS for it
            // — which nobody does, so in practice people would disable the check instead. Browsers
            // draw the same line, treating localhost as a secure context.
            bool isLoopback = parsed.IsLoopback
                || string.Equals(parsed.Host, "localhost", StringComparison.OrdinalIgnoreCase);
            if (parsed.Scheme != Uri.UriSchemeHttps && !(parsed.Scheme == Uri.UriSchemeHttp && isLoopback))
            {
                Console.Error.WriteLine(
                    "--url must be https, or http on localhost for development. "
                    + "Plain http to a remote host would send this computer's credential in clear.");
                return 2;
            }

            if (parsed.Scheme == Uri.UriSchemeHttp)
            {
                Console.WriteLine("NOTE: configured against http on loopback. Development only.");
            }

            // No --key? Ask the server for it.
            //
            // The same exchange the first-run window performs, and for the same reason. The Web
            // API key is public — it ships to every browser that loads the ERP — so the server
            // will hand it over unauthenticated, and asking the server that is about to be
            // configured is strictly better than transcribing it onto each PC: it cannot be
            // mistyped, and it cannot go stale the way a value baked into an installer does.
            // A wrong key here surfaces much later as an opaque Google error, which is the
            // failure this removes.
            if (string.IsNullOrEmpty(key))
            {
                key = FetchApiKey(url.TrimEnd('/'));
                if (string.IsNullOrEmpty(key))
                {
                    // Not fatal. The agent's first-run window asks again, with the address
                    // already filled in, so an install during a network outage still completes
                    // and the PC is configured by the first person to sign in.
                    Console.Error.WriteLine(
                        "Could not fetch the Firebase configuration from " + url
                        + ". Writing the address only; the agent will ask for the rest at first run.");
                }
            }

            // A code is checked with the server before it is written.
            //
            // An installer property is typed once and then deployed to a hundred machines, so a
            // typo or an expired code is a hundred PCs that install cleanly and never enrol. The
            // code is dropped rather than written, which leaves the agent asking for one at first
            // run — in front of a person who can read the reason and type a correct code.
            //
            // The install itself is not failed. Rolling back a deferred custom action gives
            // whoever is standing there "Setup failed" and puts the reason in an MSI log nobody
            // opens, while the agent's own setup window states it plainly and fixes it on the
            // spot. A code that cannot be checked at all — no network during the install — is
            // kept and validated at first run instead.
            if (!string.IsNullOrEmpty(code))
            {
                string refusal = DescribeCodeRefusal(url.TrimEnd('/'), code);
                if (refusal != null)
                {
                    Console.Error.WriteLine("The enrolment code " + code + " was refused: " + refusal);
                    Console.Error.WriteLine(
                        "Writing the configuration without it. The agent will ask for a valid code "
                        + "the first time somebody signs in on this computer.");
                    code = null;
                }
            }
            else
            {
                Console.WriteLine(
                    "NOTE: no --code supplied. This computer will not register until somebody "
                    + "enters an enrolment code at the agent's setup window.");
            }

            try
            {
                string directory = Core.Security.DeviceIdentityStore.DefaultDirectory;
                System.IO.Directory.CreateDirectory(directory);
                Core.Security.DeviceIdentityStore.TryHardenAcl(directory);

                var config = new Newtonsoft.Json.Linq.JObject();
                config["apiBaseUrl"] = url.TrimEnd('/');
                if (!string.IsNullOrEmpty(key)) config["firebaseApiKey"] = key;
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
        /// Ask a SEL LIVE server for its public Firebase Web API key.
        /// </summary>
        /// <remarks>
        /// Returns null on any failure rather than throwing. This runs inside the MSI's deferred
        /// custom action, which is scheduled with <c>Return="check"</c> — an exception here would
        /// roll back the entire installation because a network was briefly unavailable, turning
        /// a recoverable situation into "Setup failed".
        /// </remarks>
        private static string FetchApiKey(string baseUrl)
        {
            try
            {
                // Windows 7 negotiates TLS 1.0 by default and the server will not accept it.
                Core.TlsBootstrap.Configure();

                using (var http = new System.Net.Http.HttpClient())
                {
                    http.Timeout = TimeSpan.FromSeconds(20);
                    http.DefaultRequestHeaders.UserAgent.ParseAdd(
                        "SEL-LIVE-Agent-Setup/" + Core.AgentVersion.Current);

                    string body = http
                        .GetStringAsync(baseUrl + "/api/windows-agent/bootstrap")
                        .GetAwaiter()
                        .GetResult();

                    var parsed = Newtonsoft.Json.Linq.JObject.Parse(body);
                    return (string)parsed["firebaseApiKey"];
                }
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Bootstrap lookup failed: " + error.Message);
                return null;
            }
        }

        /// <summary>
        /// Why the server will not accept this enrolment code, or null if it will.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Asks <c>/api/windows-agent/device/check-code</c>, which answers without redeeming the
        /// code, so running the installer twenty times does not consume twenty registrations.
        /// </para>
        /// <para>
        /// A transient failure returns null — "no answer" is not "invalid". Treating an
        /// unreachable server as a refusal would drop good codes during an install on a flaky
        /// site link, and the agent re-checks the code before redeeming it anyway.
        /// </para>
        /// </remarks>
        private static string DescribeCodeRefusal(string baseUrl, string code)
        {
            try
            {
                Core.TlsBootstrap.Configure();
                using (var client = new Core.Api.SelLiveApiClient(baseUrl, Core.AgentVersion.Current))
                {
                    client
                        .CheckEnrollmentCodeAsync(code, System.Threading.CancellationToken.None)
                        .GetAwaiter()
                        .GetResult();
                    return null;
                }
            }
            catch (Core.Contracts.SelApiException error)
            {
                // 404 means this server is older than the agent and has no check-code route;
                // transient means it could not be reached. Neither is "invalid", and registration
                // validates the code anyway, so the code is kept in both cases.
                if (error.IsTransient || error.StatusCode == 404)
                {
                    Console.Error.WriteLine(
                        "Could not check the enrolment code (" + error.Message
                        + "). Keeping it; it is checked again when the computer registers.");
                    return null;
                }
                return error.Message;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Could not check the enrolment code: " + error.Message);
                return null;
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
