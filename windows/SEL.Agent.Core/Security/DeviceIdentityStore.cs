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
        /// Set the directory's ACL: full control for SYSTEM and Administrators, Modify for Users.
        /// </summary>
        /// <remarks>
        /// <para>
        /// <b>Users get Modify, and the first version of this method omitting them was a bug
        /// worth explaining.</b> The obvious hardening — SYSTEM and Administrators only — locks
        /// out the one process that needs this directory. The desktop agent runs as the
        /// <i>signed-in standard user</i>, and it has to read <c>device.json</c>, read and write
        /// <c>queue.db</c>, and write its log. An Administrators-only ACL means a correctly
        /// installed agent cannot read its own credential or record a single span, on every PC
        /// in the company.
        /// </para>
        /// <para>
        /// <b>And that ACL would have bought almost nothing.</b> Two reasons, both decisive.
        /// </para>
        /// <para>
        /// First, the agent runs <i>as</i> the interactive user, so that user can attach a
        /// debugger to it and read the decrypted secret out of its memory whatever the file
        /// permissions say. An ACL cannot keep a secret from the account the process runs under.
        /// </para>
        /// <para>
        /// Second, <c>device.json</c> holds a <i>machine</i> credential, not a personal one.
        /// Every user of a shared PC legitimately uses the same device identity, so there is no
        /// user-against-user separation being preserved. The genuinely per-person secret — the
        /// Firebase refresh token — lives under <c>%LOCALAPPDATA%</c>, which Windows already
        /// isolates per profile.
        /// </para>
        /// <para>
        /// The protection that actually matters is DPAPI with purpose entropy, and it is
        /// untouched by this: a disk pulled out of a machine, or a backup copied off it, yields
        /// ciphertext that will not decrypt anywhere else. Administrators-only on top of that
        /// defended against nothing real while breaking the product, which is the worst trade a
        /// security control can make.
        /// </para>
        /// <para>
        /// Best-effort either way. Called from the installer (elevated, where it succeeds) and
        /// from the agent (usually not, where it may not). Failing must never stop the agent
        /// working. Well-known SIDs rather than names, because a Hindi or German Windows has no
        /// group called "Administrators" and the name-based overload would throw on it.
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
                var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);

                const InheritanceFlags inherit =
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;

                security.AddAccessRule(new FileSystemAccessRule(
                    system, FileSystemRights.FullControl, inherit,
                    PropagationFlags.None, AccessControlType.Allow));

                security.AddAccessRule(new FileSystemAccessRule(
                    administrators, FileSystemRights.FullControl, inherit,
                    PropagationFlags.None, AccessControlType.Allow));

                // Modify, not FullControl: enough to read the credential and read/write the queue
                // and the log, while still stopping a standard user from rewriting this ACL.
                security.AddAccessRule(new FileSystemAccessRule(
                    users, FileSystemRights.Modify | FileSystemRights.Synchronize, inherit,
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
