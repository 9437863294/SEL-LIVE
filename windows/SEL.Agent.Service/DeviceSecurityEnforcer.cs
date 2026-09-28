using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Principal;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Security;

namespace Sel.Agent.Service
{
    /// <summary>
    /// Applies and measures the server-issued policy for this PC from the LocalSystem service.
    /// </summary>
    /// <remarks>
    /// Task Manager policy lives inside each user's loaded registry hive, so a tray process could
    /// only protect itself. Running here means the setting is applied for every signed-in user and
    /// re-applied after tampering. Service ACL protection is checked on every pass for the same
    /// reason. Maintenance may temporarily open Task Manager; it never relaxes service control.
    /// </remarks>
    internal static class DeviceSecurityEnforcer
    {
        private const string TaskManagerPolicyPath =
            @"Software\Microsoft\Windows\CurrentVersion\Policies\System";
        private const string TaskManagerValue = "DisableTaskMgr";

        internal static DeviceSecurityPosture EnforceAndInspect(
            DeviceSecurityPolicy policy, bool allowTaskManager, Action<string> log)
        {
            if (policy == null) policy = DeviceSecurityPolicyStore.StrictDefault();
            var findings = new List<string>();

            try
            {
                ApplyTaskManagerPolicy(policy.TaskManagerLocked && !allowTaskManager);
            }
            catch (Exception error)
            {
                findings.Add("POSTURE_CHECK_FAILED");
                if (log != null) log("Could not apply the Task Manager policy: " + error.Message);
            }

            try
            {
                string descriptor = ServiceProtection.CurrentSddl();
                if (!ServiceSecurityRules.MatchesPolicy(
                    descriptor, policy.AgentStopBlocked, policy.ServiceModificationBlocked))
                {
                    int result = ServiceProtection.ApplyPolicy(
                        policy.AgentStopBlocked, policy.ServiceModificationBlocked);
                    if (result != 0) findings.Add("POSTURE_CHECK_FAILED");
                    if (result == 0 && log != null)
                        log("Applied the SEL LIVE service-control policy after drift was detected.");
                }
            }
            catch (Exception error)
            {
                findings.Add("POSTURE_CHECK_FAILED");
                if (log != null) log("Could not verify the service descriptor: " + error.Message);
            }

            bool taskManagerLocked = IsTaskManagerPolicyApplied();
            string currentSddl = ServiceProtection.CurrentSddl();
            bool descriptorAvailable = !string.IsNullOrEmpty(currentSddl);
            bool stopBlocked = descriptorAvailable && !ServiceSecurityRules.GrantsStop(currentSddl, "BA");
            bool serviceProtected = descriptorAvailable
                && !ServiceSecurityRules.GrantsConfigurationModification(currentSddl, "BA");
            bool? secureBoot = ReadSecureBoot();
            bool binariesSigned = InstalledBinariesAreSigned();
            bool signedAppControl = SignedAppControlPolicyIsActive();

            // An active maintenance exception is compliant: the server explicitly authorised the
            // temporary opening, and expiry is enforced locally even with no network.
            if (policy.TaskManagerLocked && !taskManagerLocked && !allowTaskManager) findings.Add("TASK_MANAGER_UNLOCKED");
            if (policy.AgentStopBlocked && !stopBlocked) findings.Add("AGENT_STOP_ALLOWED");
            if (policy.ServiceModificationBlocked && !serviceProtected
                && !findings.Contains("SERVICE_MODIFIABLE")) findings.Add("SERVICE_MODIFIABLE");
            if (policy.SecureBootRequired && secureBoot == false) findings.Add("SECURE_BOOT_OFF");
            if (policy.SecureBootRequired && secureBoot == null) findings.Add("SECURE_BOOT_UNKNOWN");
            if (policy.SignedAgentBinariesRequired && !binariesSigned) findings.Add("AGENT_BINARY_UNSIGNED");
            if (policy.SignedAppControlPolicyRequired && !signedAppControl)
                findings.Add("SIGNED_APP_CONTROL_POLICY_MISSING");

            return new DeviceSecurityPosture
            {
                CheckedAt = IsoTime.Now(),
                SecureBootEnabled = secureBoot,
                TaskManagerLocked = taskManagerLocked,
                AgentStopBlocked = stopBlocked,
                ServiceModificationBlocked = serviceProtected,
                AgentBinariesSigned = binariesSigned,
                SignedAppControlPolicyActive = signedAppControl,
                Findings = findings,
                WindowsAccounts = LoadedWindowsAccounts(),
                Compliant = findings.Count == 0,
            };
        }

        /// <summary>
        /// Undo everything this enforcer changed about the machine. Called when the agent is
        /// removed.
        /// </summary>
        /// <remarks>
        /// <para>
        /// <b>Without this, uninstalling the agent left every account on the PC with Task Manager
        /// permanently disabled</b> — and nothing on the machine that knew why or how to undo it.
        /// <c>DisableTaskMgr</c> was written per user by the enforce loop and only ever removed
        /// by the same loop on a later sync, which does not run again once the service is gone.
        /// </para>
        /// <para>
        /// The service descriptor is put back separately by the installer's unprotect step, which
        /// has to happen before Windows Installer tries to stop the service. This deals with the
        /// changes that outlive the service itself.
        /// </para>
        /// </remarks>
        internal static void RevertMachineChanges(Action<string> log)
        {
            try
            {
                ApplyTaskManagerPolicy(false);
                if (log != null) log("Task Manager was re-enabled for every profile on this computer.");
            }
            catch (Exception error)
            {
                // Reported, not thrown: a failure here must not stop an uninstall, or a PC ends up
                // with neither a working agent nor a way to remove it.
                if (log != null) log("Could not re-enable Task Manager: " + error.Message);
            }

            // Website blocking outlives the service in exactly the same way, and is harder to
            // diagnose: the symptom is "this one site is broken on this one computer", with
            // nothing installed that could explain it.
            WebsiteBlocker.Revert(log);
        }

        internal static void ApplyTaskManagerPolicy(bool locked)
        {
            using (RegistryKey users = RegistryKey.OpenBaseKey(RegistryHive.Users, RegistryView.Default))
            {
                foreach (string sid in users.GetSubKeyNames())
                {
                    if (!IsHumanUserSid(sid)) continue;
                    using (RegistryKey policy = users.CreateSubKey(sid + "\\" + TaskManagerPolicyPath, true))
                    {
                        if (policy == null) continue;
                        if (locked) policy.SetValue(TaskManagerValue, 1, RegistryValueKind.DWord);
                        else policy.DeleteValue(TaskManagerValue, false);
                    }
                }
            }
        }

        internal static bool IsTaskManagerPolicyApplied()
        {
            using (RegistryKey users = RegistryKey.OpenBaseKey(RegistryHive.Users, RegistryView.Default))
            {
                foreach (string sid in users.GetSubKeyNames())
                {
                    if (!IsHumanUserSid(sid)) continue;
                    using (RegistryKey policy = users.OpenSubKey(sid + "\\" + TaskManagerPolicyPath, false))
                    {
                        object value = policy == null ? null : policy.GetValue(TaskManagerValue);
                        if (Convert.ToInt32(value ?? 0) != 1) return false;
                    }
                }
            }
            // No interactive profile is loaded yet. There is nothing to unlock, and OnSessionChange
            // applies the setting as soon as a profile is loaded.
            return true;
        }

        internal static bool IsHumanUserSid(string keyName)
        {
            if (string.IsNullOrEmpty(keyName) || keyName.EndsWith("_Classes", StringComparison.OrdinalIgnoreCase))
                return false;
            return keyName.StartsWith("S-1-5-21-", StringComparison.OrdinalIgnoreCase)
                || keyName.StartsWith("S-1-12-1-", StringComparison.OrdinalIgnoreCase);
        }

        internal static List<string> LoadedWindowsAccounts()
        {
            var accounts = new List<string>();
            try
            {
                using (RegistryKey users = RegistryKey.OpenBaseKey(RegistryHive.Users, RegistryView.Default))
                {
                    foreach (string sidText in users.GetSubKeyNames())
                    {
                        if (!IsHumanUserSid(sidText)) continue;
                        try
                        {
                            var sid = new SecurityIdentifier(sidText);
                            string account = sid.Translate(typeof(NTAccount)).Value;
                            if (!string.IsNullOrEmpty(account) && !accounts.Contains(account)) accounts.Add(account);
                        }
                        catch
                        {
                            // A deleted domain account may still have a loaded hive. It cannot be
                            // elevated by name, so omitting it is safer than offering a stale SID.
                        }
                    }
                }
            }
            catch
            {
                // Posture remains useful when account translation is unavailable offline.
            }
            return accounts;
        }

        internal static bool? ReadSecureBoot()
        {
            try
            {
                using (RegistryKey machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (RegistryKey state = machine.OpenSubKey(
                    @"SYSTEM\CurrentControlSet\Control\SecureBoot\State", false))
                {
                    object value = state == null ? null : state.GetValue("UEFISecureBootEnabled");
                    if (value == null) return null;
                    return Convert.ToInt32(value) == 1;
                }
            }
            catch
            {
                return null;
            }
        }

        private static bool InstalledBinariesAreSigned()
        {
            string directory = Path.GetDirectoryName(typeof(DeviceSecurityEnforcer).Assembly.Location);
            if (string.IsNullOrEmpty(directory)) return false;
            string[] names = { "SEL.Agent.Service.exe", "SEL.Agent.exe" };
            foreach (string name in names)
            {
                PackageVerifier.Result result = PackageVerifier.VerifyTrustedSignature(Path.Combine(directory, name));
                if (!result.Ok) return false;
            }
            return true;
        }

        /// <summary>
        /// Ask Windows Code Integrity whether an enforced, signed WDAC policy is active.
        /// The agent deliberately does not create or sign that policy: its private signing key
        /// belongs in deployment infrastructure, never on every endpoint it protects.
        /// </summary>
        private static bool SignedAppControlPolicyIsActive()
        {
            try
            {
                string ciTool = Path.Combine(Environment.SystemDirectory, "CiTool.exe");
                if (!File.Exists(ciTool)) return false;
                var start = new ProcessStartInfo(ciTool, "-lp -json")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                using (Process process = Process.Start(start))
                {
                    if (process == null) return false;
                    string output = process.StandardOutput.ReadToEnd();
                    if (!process.WaitForExit(15000))
                    {
                        try { process.Kill(); } catch { }
                        return false;
                    }
                    int jsonStart = output.IndexOf('{');
                    if (jsonStart < 0) return false;
                    JToken root = JToken.Parse(output.Substring(jsonStart));
                    IEnumerable<JObject> policies = root.SelectTokens("$..*").OfType<JObject>();
                    JObject rootObject = root as JObject;
                    if (rootObject != null) policies = new[] { rootObject }.Concat(policies);
                    return policies.Any(policy =>
                        Bool(policy, "IsSignedPolicy")
                        && Bool(policy, "IsEnforced")
                        && Bool(policy, "IsOnDisk"));
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool Bool(JObject value, string name)
        {
            JToken token = value.GetValue(name, StringComparison.OrdinalIgnoreCase);
            return token != null && token.Type == JTokenType.Boolean && token.Value<bool>();
        }
    }
}
