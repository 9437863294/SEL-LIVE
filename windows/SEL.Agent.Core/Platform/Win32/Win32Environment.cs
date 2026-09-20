using System;
using System.Diagnostics;
using System.Management;
using Microsoft.Win32;
using Sel.Agent.Core.Contracts;

namespace Sel.Agent.Core.Platform.Win32
{
    /// <summary>
    /// Describes the machine for the device record (§4).
    /// </summary>
    /// <remarks>
    /// <para>
    /// §4 is explicit that a MAC address must not be the identity, and this class does not
    /// collect one. Nothing here <i>is</i> the identity: the device identity is a server-issued
    /// secret, and these are corroborating facts that let an administrator recognise a machine on
    /// the devices page and spot when a credential has been copied onto different hardware.
    /// </para>
    /// <para>
    /// <b>Every lookup is wrapped and optional.</b> WMI is the flakiest interface in Windows —
    /// the repository can be corrupt, the service can be disabled by policy, and on a locked-down
    /// SOE half these classes are unreadable. A device that cannot report its motherboard serial
    /// must still enrol, so every field is nullable and every failure is a null rather than an
    /// exception.
    /// </para>
    /// <para>
    /// <b>Why <c>MachineGuid</c> and not a hardware hash.</b> It is stable across reboots,
    /// survives hardware changes, and changes when a machine is properly sysprepped — which is
    /// exactly the behaviour wanted for telling "the same PC" from "a fresh image of the same
    /// PC". A hash of hardware serials would change when somebody replaces a failed disk, which
    /// would look identical to a cloned credential.
    /// </para>
    /// </remarks>
    public sealed class Win32MachineFactsProvider : IMachineFactsProvider
    {
        public DeviceMachineFacts Collect()
        {
            OsCompatibility os = OsCompatibility.Current;

            return new DeviceMachineFacts
            {
                Hostname = SafeHostname(),
                MachineGuid = ReadMachineGuid(),
                WindowsVersion = os.FriendlyName + " (" + os.VersionString + "." + os.Build + ")",
                Architecture = os.Is64BitOperatingSystem ? "x64" : "x86",
                Manufacturer = QueryWmi("Win32_ComputerSystem", "Manufacturer"),
                Model = QueryWmi("Win32_ComputerSystem", "Model"),
                SerialNumber = QueryWmi("Win32_BIOS", "SerialNumber"),
                TotalMemoryMb = ReadTotalMemoryMb(),
                TimeZoneId = SafeTimeZoneId()
            };
        }

        private static string SafeHostname()
        {
            try
            {
                return Environment.MachineName;
            }
            catch
            {
                return "unknown-host";
            }
        }

        private static string SafeTimeZoneId()
        {
            try
            {
                return TimeZoneInfo.Local.Id;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Windows' own installation GUID.
        /// </summary>
        /// <remarks>
        /// Read from the 64-bit view explicitly. A 32-bit process is redirected to
        /// <c>WOW6432Node</c> by default, where this value does not exist — so the obvious
        /// <c>Registry.LocalMachine.OpenSubKey</c> returns null on exactly the 64-bit machines
        /// that make up the fleet, and the agent would report every PC as having no MachineGuid.
        /// </remarks>
        private static string ReadMachineGuid()
        {
            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (RegistryKey key = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
                {
                    if (key == null) return null;
                    object value = key.GetValue("MachineGuid");
                    return value == null ? null : value.ToString();
                }
            }
            catch
            {
                return null;
            }
        }

        private static long? ReadTotalMemoryMb()
        {
            string raw = QueryWmi("Win32_ComputerSystem", "TotalPhysicalMemory");
            ulong bytes;
            if (!string.IsNullOrEmpty(raw) && ulong.TryParse(raw, out bytes))
            {
                return (long)(bytes / (1024 * 1024));
            }
            return null;
        }

        private static string QueryWmi(string wmiClass, string property)
        {
            try
            {
                using (var searcher = new ManagementObjectSearcher("SELECT " + property + " FROM " + wmiClass))
                using (ManagementObjectCollection results = searcher.Get())
                {
                    foreach (ManagementBaseObject item in results)
                    {
                        using (item)
                        {
                            object value = item[property];
                            if (value == null) continue;
                            string text = value.ToString().Trim();
                            if (text.Length > 0) return text;
                        }
                    }
                }
            }
            catch (Exception)
            {
                // See the class remarks: WMI is optional here, never load-bearing.
            }
            return null;
        }
    }

    /// <summary>
    /// Opens ERP deep links in the user's default browser (§23).
    /// </summary>
    /// <remarks>
    /// <para>
    /// The whole value of §23 is that clicking a notification about requisition PR-2026-0098 lands
    /// on that requisition and not on a dashboard. That works because the server stores a path and
    /// this composes it against the configured ERP origin.
    /// </para>
    /// <para>
    /// <b>The path is validated again here, on the client.</b> The server already rejects anything
    /// that is not a same-origin path, so this is a second check on the same rule — and it is
    /// worth having, because the consequence of getting it wrong is different on this side.
    /// Server-side, a bad link is a bad row in a database. Client-side, it is an argument to
    /// <c>Process.Start</c>, which on Windows will happily launch <c>file://</c>, a UNC path, or
    /// any registered protocol handler. A notification is attacker-influenced input arriving over
    /// a network; the shell is not a safe place to put it on trust.
    /// </para>
    /// </remarks>
    public sealed class Win32DeepLinkLauncher : IDeepLinkLauncher
    {
        private readonly string _baseUrl;

        public Win32DeepLinkLauncher(string baseUrl)
        {
            _baseUrl = (baseUrl ?? string.Empty).TrimEnd('/');
        }

        public void Open(string path)
        {
            string target = Compose(path);
            if (target == null) return;
            try
            {
                Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            }
            catch (Exception)
            {
                // No default browser, or the shell refused. Nothing useful to do — the
                // notification stays in the tray list where it can be opened again.
            }
        }

        /// <summary>
        /// Compose and validate. Returns null for anything that is not a safe path.
        /// </summary>
        /// <remarks>
        /// Public rather than private so the refusals can be tested directly. This is the
        /// function standing between a notification arriving over the network and an argument
        /// reaching <c>Process.Start</c>, so "it is covered indirectly by the launcher tests"
        /// is not good enough — each rejected shape gets its own assertion.
        /// </remarks>
        public string Compose(string path)
        {
            if (string.IsNullOrEmpty(_baseUrl)) return null;
            if (string.IsNullOrEmpty(path)) return _baseUrl;

            string trimmed = path.Trim();
            if (!trimmed.StartsWith("/", StringComparison.Ordinal)) return null;
            // "//evil.example" is protocol-relative and a browser would navigate off-origin.
            if (trimmed.StartsWith("//", StringComparison.Ordinal)) return null;
            if (trimmed.IndexOf('\\') >= 0) return null;

            string candidate = _baseUrl + trimmed;
            Uri parsed;
            if (!Uri.TryCreate(candidate, UriKind.Absolute, out parsed)) return null;
            if (parsed.Scheme != Uri.UriSchemeHttps && parsed.Scheme != Uri.UriSchemeHttp) return null;

            // The composed URL must still be on the configured origin. Belt and braces against a
            // path that somehow escaped the checks above.
            Uri baseUri;
            if (!Uri.TryCreate(_baseUrl, UriKind.Absolute, out baseUri)) return null;
            if (!string.Equals(parsed.Host, baseUri.Host, StringComparison.OrdinalIgnoreCase)) return null;

            return parsed.AbsoluteUri;
        }
    }
}
