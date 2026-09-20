using System;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Sel.Agent.Core
{
    /// <summary>
    /// Which Windows this is, and what it can therefore do.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The agent has to run unchanged from Windows 7 SP1 to Windows 11, and the instruction is
    /// explicit that a feature must not be silently dropped because a machine is old — where a
    /// modern API is unavailable there has to be a documented fallback. That only works if there
    /// is one place that decides what is available, so every capability question in the codebase
    /// comes through <see cref="Current"/> and nothing anywhere else tests a version number.
    /// </para>
    /// <para>
    /// <b>Why not <c>Environment.OSVersion</c>.</b> Since Windows 8.1, <c>GetVersionEx</c> — which
    /// is what <c>Environment.OSVersion</c> calls — lies to applications that do not carry a
    /// <c>supportedOS</c> manifest entry for that release, reporting 6.2 (Windows 8) for
    /// everything newer. An agent that trusted it would take the Windows 7 code path on Windows 11
    /// and show the legacy popup on every PC in the company. <c>RtlGetVersion</c> is the kernel's
    /// own answer, is not shimmed, and has existed since Windows 2000. The registry is the
    /// fallback for the case where ntdll cannot be reached, and <c>Environment.OSVersion</c> is
    /// the last resort rather than the first.
    /// </para>
    /// <para>
    /// The application manifest also declares support up to Windows 10/11, which makes
    /// <c>Environment.OSVersion</c> honest as well. Both are done because the manifest only helps
    /// the process that carries it, and this assembly is also loaded by the Windows service.
    /// </para>
    /// </remarks>
    public sealed class OsCompatibility
    {
        private static readonly Lazy<OsCompatibility> Lazy = new Lazy<OsCompatibility>(Detect);

        /// <summary>The running operating system. Detected once; it cannot change under us.</summary>
        public static OsCompatibility Current { get { return Lazy.Value; } }

        /// <summary>
        /// Describe a Windows release other than the running one.
        /// </summary>
        /// <remarks>
        /// Exists so the compatibility matrix can be <i>tested</i> rather than asserted in a
        /// document. Without it, the only way to check that Windows 7 selects the SEL LIVE popup
        /// and Windows 11 selects native toasts would be to own one of each machine and click
        /// through them — which means, in practice, that nobody checks until a rollout.
        /// <para>
        /// It is public rather than internal because the prerequisite check uses it too, to
        /// explain what an agent <i>would</i> do on a release before it is deployed there.
        /// </para>
        /// </remarks>
        public static OsCompatibility For(int major, int minor, int build, string servicePack, string productName)
        {
            return new OsCompatibility(major, minor, build, servicePack, productName);
        }

        /// <summary>The releases this agent is built for, for exhaustive matrix tests.</summary>
        public static OsCompatibility[] SupportedMatrix()
        {
            return new[]
            {
                For(6, 1, 7601, "Service Pack 1", "Windows 7 Professional"),
                For(6, 3, 9600, string.Empty, "Windows 8.1 Pro"),
                For(10, 0, 19045, string.Empty, "Windows 10 Pro"),
                For(10, 0, 19044, string.Empty, "Windows 10 Enterprise"),
                For(10, 0, 22631, string.Empty, "Windows 11 Pro"),
                For(10, 0, 26100, string.Empty, "Windows 11 Enterprise"),
            };
        }

        private OsCompatibility(int major, int minor, int build, string servicePack, string productName)
        {
            Major = major;
            Minor = minor;
            Build = build;
            ServicePack = servicePack ?? string.Empty;
            ProductName = productName ?? string.Empty;
        }

        public int Major { get; private set; }
        public int Minor { get; private set; }
        public int Build { get; private set; }
        public string ServicePack { get; private set; }

        /// <summary>The marketing name from the registry, e.g. "Windows 10 Pro". Display only.</summary>
        public string ProductName { get; private set; }

        /// <summary>A stable version string for the device record and the support desk.</summary>
        public string VersionString
        {
            get { return string.Format("{0}.{1}.{2}", Major, Minor, Build); }
        }

        public bool Is64BitOperatingSystem { get { return Environment.Is64BitOperatingSystem; } }

        /* ── Releases ─────────────────────────────────────────────────────────────────────── */

        public bool IsWindows7 { get { return Major == 6 && Minor == 1; } }
        public bool IsWindows8 { get { return Major == 6 && Minor == 2; } }
        public bool IsWindows81 { get { return Major == 6 && Minor == 3; } }

        /// <summary>
        /// Windows 11 reports itself as major 10; the build number is the only distinction, and
        /// 22000 is the first one. Microsoft chose not to bump the major version, so there is no
        /// cleverer test available.
        /// </summary>
        public bool IsWindows11 { get { return Major >= 10 && Build >= 22000; } }

        public bool IsWindows10 { get { return Major >= 10 && Build < 22000; } }

        /// <summary>Everything the agent treats as "modern": Windows 10 and 11.</summary>
        public bool IsModernWindows { get { return Major >= 10; } }

        /// <summary>Windows 7, 8 and 8.1 — the releases needing the compatibility paths.</summary>
        public bool IsLegacyWindows { get { return Major == 6; } }

        /// <summary>A short label for the UI and the device page: "Windows 7 SP1", "Windows 11".</summary>
        public string FriendlyName
        {
            get
            {
                if (IsWindows11) return "Windows 11";
                if (IsWindows10) return "Windows 10";
                if (IsWindows81) return "Windows 8.1";
                if (IsWindows8) return "Windows 8";
                if (IsWindows7) return string.IsNullOrEmpty(ServicePack) ? "Windows 7" : "Windows 7 " + ServicePack;
                return string.IsNullOrEmpty(ProductName) ? "Windows " + VersionString : ProductName;
            }
        }

        /* ── Capabilities ─────────────────────────────────────────────────────────────────── */

        /// <summary>
        /// Whether the Action Center toast API is present.
        /// </summary>
        /// <remarks>
        /// Windows 10 and 11 only. On 7, 8 and 8.1 the agent shows its own WPF popup instead —
        /// deliberately a full custom window rather than a tray balloon, because a balloon cannot
        /// carry the Open / Remind later / Acknowledge buttons the approval and meeting alerts
        /// need, and a notification that cannot be acted on is half a feature.
        /// </remarks>
        public bool SupportsNativeToast { get { return IsModernWindows; } }

        /// <summary>
        /// Whether TLS 1.2 is available without an operating-system update.
        /// </summary>
        /// <remarks>
        /// Windows 8.1 and later have it on by default. Windows 7 SP1 <i>supports</i> it but ships
        /// with it disabled in SChannel, and needs KB3140245 plus the <c>DefaultSecureProtocols</c>
        /// registry value before .NET can negotiate it at all. Since Google's endpoints and
        /// Firebase App Hosting both require TLS 1.2, a Windows 7 PC without that update cannot
        /// reach the ERP — so <see cref="TlsBootstrap"/> checks rather than assumes, and the
        /// installer reports it as a prerequisite instead of leaving somebody to debug an opaque
        /// "connection closed" at seven in the morning.
        /// </remarks>
        public bool HasTls12ByDefault { get { return !IsWindows7; } }

        /// <summary>
        /// Whether Windows itself can enforce a controlled shell (Shell Launcher / assigned access).
        /// </summary>
        /// <remarks>
        /// Enterprise and Education SKUs of Windows 10/11 only. Everything else — including every
        /// Windows 7 machine and every Pro licence — gets the agent's own access gate, which is a
        /// topmost window and not an operating-system guarantee. That difference is real and is
        /// documented rather than papered over: see the access-gate section of
        /// <c>docs/windows-agent.md</c>.
        /// </remarks>
        public bool SupportsShellLauncher
        {
            get { return IsModernWindows && (IsEnterpriseSku() || IsEducationSku()); }
        }

        /// <summary>
        /// Whether per-monitor DPI awareness is available.
        /// </summary>
        /// <remarks>
        /// Windows 8.1 introduced it; Windows 10 1607 improved it. On Windows 7 the gate and the
        /// popup are system-DPI aware only, which on a mixed-DPI setup means they render at the
        /// primary monitor's scale. That is a cosmetic limitation and is listed as such in the
        /// compatibility matrix, rather than being a reason to withhold the window.
        /// </remarks>
        public bool SupportsPerMonitorDpi { get { return Major > 6 || (Major == 6 && Minor >= 3); } }

        /// <summary>
        /// Whether this OS can run the agent at all.
        /// </summary>
        /// <remarks>
        /// .NET Framework 4.8's baseline is Windows 7 SP1 and Windows 8.1 — Windows 8.0 is not
        /// supported by the framework and is therefore not supported here. The installer checks
        /// this before it copies a single file, so a Windows 8.0 machine gets a sentence telling
        /// it to update to 8.1 rather than a service that installs and then refuses to start.
        /// A build retargeted to net461 (see Directory.Build.props) lifts that restriction.
        /// </remarks>
        public bool IsSupported
        {
            get
            {
#if NET461 || NET462 || NET47 || NET471 || NET472
                // 4.6.1 supports Windows 8.0 as well, so the whole 6.1+ range is in scope.
                return Major > 6 || (Major == 6 && Minor >= 1);
#else
                // 4.8's client baseline: Windows 7 SP1 (6.1) and Windows 8.1 (6.3), but *not*
                // Windows 8.0 (6.2) — which is the gap, and the reason this is written as two
                // explicit minor versions rather than `Minor >= 1`.
                return Major > 6 || (Major == 6 && (Minor == 1 || Minor == 3));
#endif
            }
        }

        /// <summary>Why the OS is unsupported, in words an installer can print.</summary>
        public string UnsupportedReason
        {
            get
            {
                if (IsSupported) return null;
                if (IsWindows8)
                {
                    return "Windows 8.0 cannot run .NET Framework 4.8, which the SEL LIVE Agent requires. "
                         + "Update this PC to Windows 8.1 (a free update) and run the installer again.";
                }
                return FriendlyName + " is older than Windows 7 SP1 and is not supported.";
            }
        }

        /* ── Detection ────────────────────────────────────────────────────────────────────── */

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct RtlOsVersionInfo
        {
            public uint dwOSVersionInfoSize;
            public uint dwMajorVersion;
            public uint dwMinorVersion;
            public uint dwBuildNumber;
            public uint dwPlatformId;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string szCSDVersion;
        }

        [DllImport("ntdll.dll", EntryPoint = "RtlGetVersion")]
        private static extern int RtlGetVersion(ref RtlOsVersionInfo versionInfo);

        private static OsCompatibility Detect()
        {
            int major = 0, minor = 0, build = 0;
            string servicePack = string.Empty;

            try
            {
                var info = new RtlOsVersionInfo();
                info.dwOSVersionInfoSize = (uint)Marshal.SizeOf(typeof(RtlOsVersionInfo));
                if (RtlGetVersion(ref info) == 0)
                {
                    major = (int)info.dwMajorVersion;
                    minor = (int)info.dwMinorVersion;
                    build = (int)info.dwBuildNumber;
                    servicePack = info.szCSDVersion ?? string.Empty;
                }
            }
            catch
            {
                // Falls through to the registry. Never fatal: an agent that cannot name the OS is
                // still an agent that can track activity.
            }

            string productName = ReadRegistryString("ProductName");

            if (major == 0)
            {
                // Windows 10 1703+ publishes the real numbers here even to shimmed callers.
                major = ReadRegistryInt("CurrentMajorVersionNumber");
                minor = ReadRegistryInt("CurrentMinorVersionNumber");
                int.TryParse(ReadRegistryString("CurrentBuildNumber"), out build);
            }

            if (major == 0)
            {
                Version version = Environment.OSVersion.Version;
                major = version.Major;
                minor = version.Minor;
                build = version.Build;
                servicePack = Environment.OSVersion.ServicePack ?? string.Empty;
            }

            return new OsCompatibility(major, minor, build, servicePack, productName);
        }

        private const string CurrentVersionKey = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion";

        private static string ReadRegistryString(string name)
        {
            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (RegistryKey key = baseKey.OpenSubKey(CurrentVersionKey))
                {
                    if (key == null) return string.Empty;
                    object value = key.GetValue(name);
                    return value == null ? string.Empty : value.ToString();
                }
            }
            catch
            {
                return string.Empty;
            }
        }

        private static int ReadRegistryInt(string name)
        {
            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (RegistryKey key = baseKey.OpenSubKey(CurrentVersionKey))
                {
                    if (key == null) return 0;
                    object value = key.GetValue(name);
                    return value is int ? (int)value : 0;
                }
            }
            catch
            {
                return 0;
            }
        }

        private bool IsEnterpriseSku()
        {
            return ProductName.IndexOf("Enterprise", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private bool IsEducationSku()
        {
            return ProductName.IndexOf("Education", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        /// <summary>
        /// A one-line summary for the agent log and the device page.
        /// </summary>
        public string Describe()
        {
            return string.Format(
                "{0} (build {1}, {2}) — toast: {3}, TLS 1.2 by default: {4}, shell launcher: {5}",
                FriendlyName,
                Build,
                Is64BitOperatingSystem ? "x64" : "x86",
                SupportsNativeToast ? "native" : "SEL popup",
                HasTls12ByDefault ? "yes" : "needs KB3140245",
                SupportsShellLauncher ? "available" : "not available");
        }
    }
}
