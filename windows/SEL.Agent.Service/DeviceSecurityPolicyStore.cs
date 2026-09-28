using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using Newtonsoft.Json;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Security;

namespace Sel.Agent.Service
{
    /// <summary>Persists the last server-issued per-device policy for offline enforcement.</summary>
    internal static class DeviceSecurityPolicyStore
    {
        private static string DirectoryPath
        {
            get { return Path.Combine(DeviceIdentityStore.DefaultDirectory, "Security"); }
        }

        private static string FilePath
        {
            get { return Path.Combine(DirectoryPath, "device-policy.json"); }
        }

        internal static DeviceSecurityPolicy StrictDefault()
        {
            return new DeviceSecurityPolicy
            {
                TaskManagerLocked = true,
                AgentStopBlocked = true,
                ServiceModificationBlocked = true,
                UninstallBlocked = true,
                MonitoringPolicyLocallyMutable = false,
                SignedAgentBinariesRequired = true,
                SignedAppControlPolicyRequired = true,
                SecureBootRequired = true,
                TamperMonitoringEnabled = true,
                AuditRequired = true,
                EnforcementIntervalSeconds = 60,
            };
        }

        internal static DeviceSecurityPolicy Read()
        {
            try
            {
                if (!File.Exists(FilePath)) return StrictDefault();
                DeviceSecurityPolicy policy = JsonConvert.DeserializeObject<DeviceSecurityPolicy>(
                    File.ReadAllText(FilePath));
                return Normalize(policy);
            }
            catch
            {
                return StrictDefault();
            }
        }

        internal static void Write(DeviceSecurityPolicy policy)
        {
            policy = Normalize(policy);
            Directory.CreateDirectory(DirectoryPath);
            HardenDirectory(DirectoryPath);
            File.WriteAllText(FilePath, JsonConvert.SerializeObject(policy));
        }

        private static string BlockingFilePath
        {
            get { return Path.Combine(DirectoryPath, "web-blocking.json"); }
        }

        /// <summary>
        /// The last website-blocking plan the server issued, so blocking survives a reboot with
        /// no network.
        /// </summary>
        /// <remarks>
        /// <b>A missing file means "block nothing", and that asymmetry is deliberate.</b> Every
        /// other setting in this store falls back to <see cref="StrictDefault"/>, because failing
        /// closed on the *machine's own* lockdown is the safe direction. Blocking is the opposite:
        /// a PC that has never been told what to block must not invent a list, and a corrupt file
        /// must not be guessed at. An enforced block nobody configured is indistinguishable from
        /// a broken network, and there would be no policy anywhere that explained it.
        /// </remarks>
        internal static WebBlockingPlan ReadBlockingPlan()
        {
            try
            {
                if (!File.Exists(BlockingFilePath)) return null;
                return JsonConvert.DeserializeObject<WebBlockingPlan>(File.ReadAllText(BlockingFilePath));
            }
            catch
            {
                return null;
            }
        }

        internal static void WriteBlockingPlan(WebBlockingPlan plan)
        {
            if (plan == null) return;
            Directory.CreateDirectory(DirectoryPath);
            HardenDirectory(DirectoryPath);
            File.WriteAllText(BlockingFilePath, JsonConvert.SerializeObject(plan));
        }

        private static DeviceSecurityPolicy Normalize(DeviceSecurityPolicy policy)
        {
            if (policy == null) return StrictDefault();
            policy.AuditRequired = true;
            policy.EnforcementIntervalSeconds = Math.Max(30, Math.Min(300,
                policy.EnforcementIntervalSeconds <= 0 ? 60 : policy.EnforcementIntervalSeconds));
            return policy;
        }

        private static void HardenDirectory(string path)
        {
            var directory = new DirectoryInfo(path);
            DirectorySecurity security = directory.GetAccessControl();
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new FileSystemAccessRule(
                new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
                FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None,
                AccessControlType.Allow));
            directory.SetAccessControl(security);
        }
    }
}
