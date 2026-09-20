using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using Newtonsoft.Json;

namespace Sel.Agent.Core.Security
{
    /// <summary>The machine's enrolment credential, as held on disk.</summary>
    public sealed class DeviceIdentity
    {
        [JsonProperty("deviceId")] public string DeviceId { get; set; }
        [JsonProperty("deviceName")] public string DeviceName { get; set; }
        [JsonProperty("secretVersion")] public int SecretVersion { get; set; }
        [JsonProperty("enrolledAt")] public string EnrolledAt { get; set; }
        [JsonProperty("apiBaseUrl")] public string ApiBaseUrl { get; set; }

        /// <summary>
        /// The device secret, DPAPI-protected. Never the plaintext, even in memory longer than
        /// the call that uses it — <see cref="DeviceIdentityStore.ReadSecret"/> decrypts on demand.
        /// </summary>
        [JsonProperty("protectedSecret")] public string ProtectedSecret { get; set; }
    }

    /// <summary>
    /// Where the device credential lives, and who can read it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>%ProgramData%\SEL LIVE\Agent\device.json</c>, DPAPI-encrypted and ACL'd. ProgramData
    /// rather than a user profile because the Windows service (LocalSystem) and the desktop agent
    /// (the signed-in user) both need it, and rather than the registry because a file can be
    /// backed up, inspected and deleted by an administrator recovering a machine — which
    /// <c>docs/windows-agent.md</c>'s recovery procedure depends on.
    /// </para>
    /// <para>
    /// <b>The ACL is the part that matters.</b> ProgramData is world-readable by default, so
    /// without an explicit ACL every user on a shared PC could read the file. DPAPI machine scope
    /// would still stop them decrypting it *elsewhere*, but not on that machine — machine scope
    /// means any local process can unprotect it. So the directory is locked to SYSTEM,
    /// Administrators and the agent's own service account, with inheritance broken so the
    /// permissive parent ACL does not flow back in. Defence in depth: the ACL stops a standard
    /// user reading the blob, and the DPAPI entropy stops anything that does read it from
    /// unprotecting it without knowing the purpose string.
    /// </para>
    /// </remarks>
    public sealed class DeviceIdentityStore
    {
        private readonly string _directory;
        private readonly string _path;
        private readonly object _gate = new object();

        public DeviceIdentityStore()
            : this(DefaultDirectory)
        {
        }

        public DeviceIdentityStore(string directory)
        {
            _directory = directory;
            _path = Path.Combine(directory, "device.json");
        }

        public static string DefaultDirectory
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                    "SEL LIVE", "Agent");
            }
        }

        public string Path_ { get { return _path; } }

        public bool Exists { get { return File.Exists(_path); } }

        /// <summary>Read the identity, or null when this PC has never enrolled.</summary>
        public DeviceIdentity Read()
        {
            lock (_gate)
            {
                if (!File.Exists(_path)) return null;
                try
                {
                    return JsonConvert.DeserializeObject<DeviceIdentity>(File.ReadAllText(_path));
                }
                catch (Exception)
                {
                    // A corrupt file is indistinguishable from no file for every purpose the
                    // caller has: both mean "enrol again". Reported by the health check rather
                    // than thrown at start-up.
                    return null;
                }
            }
        }

        /// <summary>The plaintext device secret, or null if it cannot be recovered.</summary>
        public string ReadSecret()
        {
            DeviceIdentity identity = Read();
            if (identity == null) return null;
            return DpapiProtector.Unprotect(identity.ProtectedSecret, DpapiProtector.Purpose.DeviceCredential);
        }

        /// <summary>
        /// Persist a freshly issued credential.
        /// </summary>
        /// <remarks>
        /// Written to a temporary file and moved into place, so a power cut mid-write leaves the
        /// previous credential intact rather than a half-written file that parses as nothing. On a
        /// machine that has just been given a *rotated* secret, losing the file would mean losing
        /// the ability to authenticate at all — the server has already moved on.
        /// </remarks>
        public void Write(string deviceId, string deviceName, string secret, int secretVersion, string apiBaseUrl)
        {
            if (string.IsNullOrEmpty(deviceId)) throw new ArgumentException("deviceId is required.");
            if (string.IsNullOrEmpty(secret)) throw new ArgumentException("secret is required.");

            lock (_gate)
            {
                EnsureDirectory();

                var identity = new DeviceIdentity
                {
                    DeviceId = deviceId,
                    DeviceName = deviceName,
                    SecretVersion = secretVersion,
                    EnrolledAt = Contracts.IsoTime.Now(),
                    ApiBaseUrl = apiBaseUrl,
                    ProtectedSecret = DpapiProtector.Protect(secret, DpapiProtector.Purpose.DeviceCredential)
                };

                string temporary = _path + ".tmp";
                File.WriteAllText(temporary, JsonConvert.SerializeObject(identity, Formatting.Indented));

                if (File.Exists(_path))
                {
                    // Replace keeps the destination's ACL, which is the one that was hardened.
                    File.Replace(temporary, _path, null);
                }
                else
                {
                    File.Move(temporary, _path);
                }
            }
        }

        /// <summary>Remove the credential. Part of the documented uninstall and recovery path.</summary>
        public void Clear()
        {
            lock (_gate)
            {
                try
                {
                    if (File.Exists(_path)) File.Delete(_path);
                }
                catch (IOException)
                {
                    // A locked file is not worth crashing an uninstaller over; the installer's
                    // own cleanup removes the whole directory afterwards.
                }
            }
        }

        private void EnsureDirectory()
        {
            if (Directory.Exists(_directory)) return;
            Directory.CreateDirectory(_directory);
            TryHardenAcl(_directory);
        }

        /// <summary>
        /// Lock the directory to SYSTEM and Administrators.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Best-effort by design. This runs from the installer (elevated, where it succeeds) and
        /// also from the agent (usually not elevated, where it does not). Failing must not stop
        /// the agent from working — the credential is still DPAPI-encrypted with purpose entropy,
        /// so an unhardened directory is a weaker position rather than an open one. The installer
        /// verifies the ACL afterwards and reports if it could not be applied.
        /// </para>
        /// <para>
        /// Well-known SIDs rather than names, because a Hindi or German Windows has no group
        /// called "Administrators" and the name-based overload would throw on it.
        /// </para>
        /// </remarks>
        public static bool TryHardenAcl(string directory)
        {
            try
            {
                var info = new DirectoryInfo(directory);
                DirectorySecurity security = info.GetAccessControl();

                // Break inheritance without copying the inherited (permissive) entries.
                security.SetAccessRuleProtection(true, false);

                var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
                var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);

                security.AddAccessRule(new FileSystemAccessRule(
                    system, FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow));

                security.AddAccessRule(new FileSystemAccessRule(
                    administrators, FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow));

                info.SetAccessControl(security);
                return true;
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
            catch (PlatformNotSupportedException)
            {
                return false;
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}
