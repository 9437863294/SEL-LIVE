using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Newtonsoft.Json;
using Sel.Agent.Core.Security;

namespace Sel.Agent.Service
{
    /// <summary>
    /// A just-in-time local Administrators membership with a locally enforced expiry.
    /// </summary>
    /// <remarks>
    /// SEL LIVE never creates or stores a reusable administrator password. It can temporarily add
    /// a currently loaded Windows account to the built-in Administrators group, records whether it
    /// actually added the membership, and removes only memberships it owns. The lease survives a
    /// service restart so an offline reboot cannot turn a 30-minute grant into permanent access.
    /// </remarks>
    internal static class TemporaryLocalAdmin
    {
        private const int Success = 0;
        private const int MemberAlreadyExists = 1378;
        private const int MemberNotFound = 1377;

        private sealed class Lease
        {
            public string Account { get; set; }
            public DateTime ExpiresAtUtc { get; set; }
            public bool AddedBySelLive { get; set; }
        }

        private static string StateDirectory
        {
            get { return Path.Combine(DeviceIdentityStore.DefaultDirectory, "Security"); }
        }

        private static string StatePath
        {
            get { return Path.Combine(StateDirectory, "temporary-admin.json"); }
        }

        internal static void Apply(string account, DateTime expiresAtUtc, Action<string> log)
        {
            if (string.IsNullOrWhiteSpace(account) || expiresAtUtc <= DateTime.UtcNow)
            {
                Revoke(log);
                return;
            }

            Lease current = Read();
            if (current != null
                && string.Equals(current.Account, account, StringComparison.OrdinalIgnoreCase)
                && current.ExpiresAtUtc == expiresAtUtc)
            {
                return;
            }

            if (current != null && !RemoveOwned(current, log))
                throw new InvalidOperationException("The previous temporary administrator membership could not be removed.");

            int result = ChangeMembership(account, add: true);
            if (result != Success && result != MemberAlreadyExists)
                throw new InvalidOperationException("Windows refused temporary administrator access (NetAPI "
                    + result + ").");

            Write(new Lease
            {
                Account = account,
                ExpiresAtUtc = expiresAtUtc,
                AddedBySelLive = result == Success,
            });

            if (log != null)
            {
                log(result == Success
                    ? "Granted temporary local administrator access to " + account + " until "
                        + expiresAtUtc.ToLocalTime().ToString("g") + "."
                    : account + " was already a local administrator; SEL LIVE did not take ownership of that membership.");
            }
        }

        internal static void EnforceCachedExpiry(DateTime nowUtc, Action<string> log)
        {
            Lease current = Read();
            if (current == null || current.ExpiresAtUtc > nowUtc) return;
            if (RemoveOwned(current, log))
            {
                DeleteState();
                if (log != null) log("Temporary local administrator access expired and was removed.");
            }
        }

        internal static bool Revoke(Action<string> log)
        {
            Lease current = Read();
            if (current == null) return true;
            if (!RemoveOwned(current, log)) return false;
            DeleteState();
            return true;
        }

        private static bool RemoveOwned(Lease lease, Action<string> log)
        {
            if (lease == null || !lease.AddedBySelLive || string.IsNullOrEmpty(lease.Account)) return true;
            int result = ChangeMembership(lease.Account, add: false);
            if (result != Success && result != MemberNotFound && log != null)
                log("Could not remove temporary administrator access from " + lease.Account
                    + " (NetAPI " + result + "); the next security pass will retry.");
            return result == Success || result == MemberNotFound;
        }

        private static Lease Read()
        {
            try
            {
                if (!File.Exists(StatePath)) return null;
                return JsonConvert.DeserializeObject<Lease>(File.ReadAllText(StatePath));
            }
            catch
            {
                return null;
            }
        }

        private static void Write(Lease lease)
        {
            Directory.CreateDirectory(StateDirectory);
            HardenDirectory(StateDirectory);
            File.WriteAllText(StatePath, JsonConvert.SerializeObject(lease));
        }

        private static void DeleteState()
        {
            try { if (File.Exists(StatePath)) File.Delete(StatePath); }
            catch { }
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

        private static int ChangeMembership(string account, bool add)
        {
            string translated = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null)
                .Translate(typeof(NTAccount)).Value;
            int slash = translated.IndexOf('\\');
            string groupName = slash >= 0 ? translated.Substring(slash + 1) : translated;
            var member = new LocalGroupMembersInfo3 { DomainAndName = account };
            return add
                ? NetLocalGroupAddMembers(null, groupName, 3, ref member, 1)
                : NetLocalGroupDelMembers(null, groupName, 3, ref member, 1);
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct LocalGroupMembersInfo3
        {
            [MarshalAs(UnmanagedType.LPWStr)] public string DomainAndName;
        }

        [DllImport("Netapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int NetLocalGroupAddMembers(
            string serverName, string groupName, int level, ref LocalGroupMembersInfo3 buffer, int totalEntries);

        [DllImport("Netapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int NetLocalGroupDelMembers(
            string serverName, string groupName, int level, ref LocalGroupMembersInfo3 buffer, int totalEntries);
    }
}
