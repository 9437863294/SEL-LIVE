using System;
using System.IO;
using Newtonsoft.Json;
using Sel.Agent.Core.Security;

namespace Sel.Agent
{
    /// <summary>
    /// Where the agent points, and what it needs to get there.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Written by the installer into <c>%ProgramData%\SEL LIVE\Agent\agent.config.json</c> and
    /// read by both the desktop agent and the service, so a change of ERP host is one file and a
    /// service restart rather than a redeployment.
    /// </para>
    ///
    /// <para><b>Nothing secret is in here, and that is deliberate.</b></para>
    /// <para>
    /// §40 forbids embedding Firebase Admin credentials or private keys in the executable, and
    /// the same reasoning applies to the configuration file that sits beside it — a file on four
    /// hundred PCs is not a place to keep a secret. Both values here are public by design:
    /// </para>
    /// <list type="bullet">
    /// <item><description>
    /// <c>apiBaseUrl</c> is the ERP's own address, which every browser in the company already
    /// knows.
    /// </description></item>
    /// <item><description>
    /// <c>firebaseApiKey</c> is the Web API key — the same value in
    /// <c>NEXT_PUBLIC_FIREBASE_API_KEY</c>, shipped to every browser that loads the web app. It
    /// identifies the Firebase project; it authorises nothing. Sign-in still needs a real
    /// password, and every subsequent call still needs the device secret, which <i>is</i> a
    /// secret and lives DPAPI-encrypted in <c>device.json</c>.
    /// </description></item>
    /// </list>
    ///
    /// <para><b>The enrolment code is the one sensitive field, and it is consumed, not kept.</b></para>
    /// <para>
    /// It is read once at first run and removed from the file after a successful enrolment, so a
    /// PC that has already registered is not carrying a code that could enrol others.
    /// </para>
    /// </remarks>
    public sealed class AgentConfiguration
    {
        [JsonProperty("apiBaseUrl")] public string ApiBaseUrl { get; set; }
        [JsonProperty("firebaseApiKey")] public string FirebaseApiKey { get; set; }

        /// <summary>Consumed at first run and then cleared. See the remarks.</summary>
        [JsonProperty("enrollmentCode")] public string EnrollmentCode { get; set; }

        /// <summary>
        /// Overrides the friendly device name the server would otherwise take from the hostname.
        /// </summary>
        [JsonProperty("deviceNameOverride")] public string DeviceNameOverride { get; set; }

        /// <summary>
        /// Writes a rolling log next to the configuration. Off by default.
        /// </summary>
        /// <remarks>
        /// Off because the log records which applications had focus, which is the same data the
        /// agent is careful about everywhere else — leaving it on by default would put a
        /// plaintext copy of somebody's day in a world-readable folder, having gone to some
        /// trouble to encrypt the queue holding exactly that.
        /// </remarks>
        [JsonProperty("verboseLogging")] public bool VerboseLogging { get; set; }

        public static string DefaultPath
        {
            get { return Path.Combine(DeviceIdentityStore.DefaultDirectory, "agent.config.json"); }
        }

        /// <summary>
        /// Load configuration, preferring the ProgramData copy and falling back to one beside the
        /// executable.
        /// </summary>
        /// <remarks>
        /// The executable-relative fallback is what makes a portable test run possible — drop a
        /// config next to the binary and the agent runs against a staging ERP without touching
        /// the machine's installed configuration. §60's "monitoring-only test PC" stage depends
        /// on being able to do exactly that.
        /// </remarks>
        public static AgentConfiguration Load()
        {
            AgentConfiguration fromProgramData = TryRead(DefaultPath);
            if (fromProgramData != null) return fromProgramData;

            string beside = Path.Combine(
                Path.GetDirectoryName(typeof(AgentConfiguration).Assembly.Location) ?? ".",
                "agent.config.json");
            AgentConfiguration local = TryRead(beside);
            if (local != null) return local;

            return new AgentConfiguration();
        }

        private static AgentConfiguration TryRead(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                return JsonConvert.DeserializeObject<AgentConfiguration>(File.ReadAllText(path));
            }
            catch (Exception)
            {
                // A malformed config is reported by IsUsable rather than thrown here: the agent
                // shows a clear "not configured" panel instead of failing to start at all, which
                // is what somebody standing at the PC can actually act on.
                return null;
            }
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(DeviceIdentityStore.DefaultDirectory);
                File.WriteAllText(DefaultPath, JsonConvert.SerializeObject(this, Formatting.Indented));
            }
            catch (Exception)
            {
                // Non-elevated agents cannot write ProgramData if the installer hardened it.
                // Losing the "clear the enrolment code" write is not worth an error dialog.
            }
        }

        /// <summary>Remove the enrolment code once it has been redeemed.</summary>
        public void ClearEnrollmentCode()
        {
            if (string.IsNullOrEmpty(EnrollmentCode)) return;
            EnrollmentCode = null;
            Save();
        }

        public bool IsUsable
        {
            get
            {
                return !string.IsNullOrEmpty(ApiBaseUrl)
                    && !string.IsNullOrEmpty(FirebaseApiKey)
                    && Uri.IsWellFormedUriString(ApiBaseUrl, UriKind.Absolute);
            }
        }

        /// <summary>What to tell somebody when it is not usable.</summary>
        public string DescribeProblem()
        {
            if (string.IsNullOrEmpty(ApiBaseUrl)) return "The SEL LIVE address has not been configured.";
            if (!Uri.IsWellFormedUriString(ApiBaseUrl, UriKind.Absolute))
            {
                return "The configured SEL LIVE address (" + ApiBaseUrl + ") is not a valid URL.";
            }
            if (string.IsNullOrEmpty(FirebaseApiKey)) return "The Firebase Web API key has not been configured.";
            return null;
        }
    }
}
