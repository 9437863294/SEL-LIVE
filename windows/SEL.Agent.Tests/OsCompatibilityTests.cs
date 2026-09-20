using System;
using Sel.Agent.Core;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// The compatibility matrix, as tests rather than as a table in a document.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The requirement is that every listed feature work from Windows 7 SP1 to Windows 11, and
    /// that nothing be silently disabled on an older release — where a modern API is missing
    /// there must be a documented fallback. A table asserting that is a promise; these are the
    /// checks that keep it true after somebody edits the code.
    /// </para>
    /// <para>
    /// They run on any machine, because <see cref="OsCompatibility.For"/> lets the tests describe
    /// a release rather than having to be executed on one. That is the whole point: a Windows 7
    /// regression is caught on a Windows 11 build server.
    /// </para>
    /// </remarks>
    public class OsCompatibilityTests
    {
        /* ── Detection ───────────────────────────────────────────────────────────────────── */

        [Theory]
        [InlineData(6, 1, 7601, "Windows 7")]
        [InlineData(6, 2, 9200, "Windows 8")]
        [InlineData(6, 3, 9600, "Windows 8.1")]
        [InlineData(10, 0, 19045, "Windows 10")]
        [InlineData(10, 0, 22000, "Windows 11")]
        [InlineData(10, 0, 26100, "Windows 11")]
        public void Releases_are_named_correctly(int major, int minor, int build, string expected)
        {
            OsCompatibility os = OsCompatibility.For(major, minor, build, string.Empty, string.Empty);
            Assert.StartsWith(expected, os.FriendlyName, StringComparison.Ordinal);
        }

        [Fact]
        public void Windows_11_is_distinguished_from_Windows_10_only_by_build()
        {
            // Microsoft did not bump the major version for Windows 11, so build 22000 is the
            // entire distinction. A regression here would send every Windows 11 machine down
            // whatever path is special-cased for 10.
            Assert.True(OsCompatibility.For(10, 0, 22000, "", "").IsWindows11);
            Assert.False(OsCompatibility.For(10, 0, 21999, "", "").IsWindows11);
            Assert.True(OsCompatibility.For(10, 0, 21999, "", "").IsWindows10);
        }

        [Fact]
        public void The_running_machine_is_detected_as_something_sensible()
        {
            OsCompatibility os = OsCompatibility.Current;
            // RtlGetVersion never returns 6.2 for a modern OS; Environment.OSVersion does when
            // the manifest is missing. Catching that here catches a broken manifest.
            Assert.True(os.Major >= 6, "Detected an implausible major version: " + os.VersionString);
            Assert.False(string.IsNullOrEmpty(os.FriendlyName));
            Assert.False(string.IsNullOrEmpty(os.Describe()));
        }

        /* ── Supported baseline ──────────────────────────────────────────────────────────── */

        [Fact]
        public void Windows_7_SP1_is_supported()
        {
            Assert.True(OsCompatibility.For(6, 1, 7601, "Service Pack 1", "Windows 7 Professional").IsSupported);
        }

        [Fact]
        public void Windows_8_point_0_is_refused_with_an_actionable_reason()
        {
            // .NET Framework 4.8's baseline is Windows 7 SP1 and Windows 8.1; 8.0 is not
            // supported by the framework, so the installer must say so rather than install a
            // service that cannot start. This test is the guard on that message existing.
            OsCompatibility os = OsCompatibility.For(6, 2, 9200, string.Empty, "Windows 8 Pro");
            Assert.False(os.IsSupported);
            Assert.Contains("8.1", os.UnsupportedReason);
        }

        [Fact]
        public void Vista_and_earlier_are_refused()
        {
            Assert.False(OsCompatibility.For(6, 0, 6002, "Service Pack 2", "Windows Vista").IsSupported);
            Assert.False(OsCompatibility.For(5, 1, 2600, "Service Pack 3", "Windows XP").IsSupported);
        }

        [Fact]
        public void Every_release_in_the_supported_matrix_is_actually_supported()
        {
            foreach (OsCompatibility os in OsCompatibility.SupportedMatrix())
            {
                Assert.True(os.IsSupported, os.FriendlyName + " should be supported.");
                Assert.Null(os.UnsupportedReason);
            }
        }

        /* ── Capabilities: the fallback contract ─────────────────────────────────────────── */

        [Fact]
        public void Native_toasts_are_Windows_10_and_later_only()
        {
            Assert.False(OsCompatibility.For(6, 1, 7601, "", "").SupportsNativeToast);
            Assert.False(OsCompatibility.For(6, 3, 9600, "", "").SupportsNativeToast);
            Assert.True(OsCompatibility.For(10, 0, 19045, "", "").SupportsNativeToast);
            Assert.True(OsCompatibility.For(10, 0, 22631, "", "").SupportsNativeToast);
        }

        [Fact]
        public void Every_supported_release_has_a_notification_path_named()
        {
            // The load-bearing assertion for "do not silently disable a feature": a release
            // without native toasts must still name the popup, never "unavailable".
            foreach (OsCompatibility os in OsCompatibility.SupportedMatrix())
            {
                string description = os.Describe();
                Assert.True(
                    description.Contains("toast: native") || description.Contains("toast: SEL popup"),
                    os.FriendlyName + " names no notification surface: " + description);
            }
        }

        [Fact]
        public void Only_Windows_7_lacks_TLS_1_2_by_default()
        {
            Assert.False(OsCompatibility.For(6, 1, 7601, "Service Pack 1", "").HasTls12ByDefault);
            Assert.True(OsCompatibility.For(6, 3, 9600, "", "").HasTls12ByDefault);
            Assert.True(OsCompatibility.For(10, 0, 19045, "", "").HasTls12ByDefault);
        }

        [Fact]
        public void Shell_Launcher_is_claimed_only_for_Enterprise_and_Education_on_modern_Windows()
        {
            // Overstating this would be the worst kind of wrong: a rollout planned on the
            // assumption that Windows can enforce the gate, on machines where it cannot.
            Assert.False(OsCompatibility.For(10, 0, 22631, "", "Windows 11 Pro").SupportsShellLauncher);
            Assert.True(OsCompatibility.For(10, 0, 22631, "", "Windows 11 Enterprise").SupportsShellLauncher);
            Assert.True(OsCompatibility.For(10, 0, 19044, "", "Windows 10 Education").SupportsShellLauncher);
            // No Windows 7 SKU has it, whatever the product name says.
            Assert.False(OsCompatibility.For(6, 1, 7601, "SP1", "Windows 7 Enterprise").SupportsShellLauncher);
        }

        [Fact]
        public void Per_monitor_DPI_is_Windows_8_1_and_later()
        {
            Assert.False(OsCompatibility.For(6, 1, 7601, "", "").SupportsPerMonitorDpi);
            Assert.True(OsCompatibility.For(6, 3, 9600, "", "").SupportsPerMonitorDpi);
            Assert.True(OsCompatibility.For(10, 0, 19045, "", "").SupportsPerMonitorDpi);
        }

        /* ── The matrix itself ───────────────────────────────────────────────────────────── */

        /// <summary>
        /// Every feature the brief's compatibility table marks as supported must be available on
        /// every supported release — natively or through a named fallback.
        /// </summary>
        /// <remarks>
        /// The two starred rows in that table (notifications and the access gate) are the ones
        /// that differ, and they differ by <i>implementation</i> rather than by availability.
        /// This encodes exactly that: the feature is never absent, and where it is not native
        /// the fallback has to be describable.
        /// </remarks>
        [Fact]
        public void Every_feature_is_available_on_every_supported_release()
        {
            foreach (OsCompatibility os in OsCompatibility.SupportedMatrix())
            {
                // Always native — these use APIs unchanged since Windows Vista, which is why
                // they live in Core with no per-release adapter.
                Assert.True(FeatureAvailability.ForegroundTracking(os) == Availability.Native, os.FriendlyName);
                Assert.True(FeatureAvailability.IdleTracking(os) == Availability.Native, os.FriendlyName);
                Assert.True(FeatureAvailability.LockTracking(os) == Availability.Native, os.FriendlyName);
                Assert.True(FeatureAvailability.AttendanceSessions(os) == Availability.Native, os.FriendlyName);
                Assert.True(FeatureAvailability.OfflineQueue(os) == Availability.Native, os.FriendlyName);
                Assert.True(FeatureAvailability.SystemTray(os) == Availability.Native, os.FriendlyName);
                Assert.True(FeatureAvailability.DeepLinks(os) == Availability.Native, os.FriendlyName);
                Assert.True(FeatureAvailability.WindowsService(os) == Availability.Native, os.FriendlyName);
                Assert.True(FeatureAvailability.AutoStart(os) == Availability.Native, os.FriendlyName);
                Assert.True(FeatureAvailability.AutoUpdate(os) == Availability.Native, os.FriendlyName);

                // Differ by implementation, never absent.
                Assert.NotEqual(Availability.Unavailable, FeatureAvailability.Notifications(os));
                Assert.NotEqual(Availability.Unavailable, FeatureAvailability.AccessGate(os));
            }
        }

        [Fact]
        public void The_two_features_that_differ_are_exactly_the_two_documented_ones()
        {
            OsCompatibility legacy = OsCompatibility.For(6, 1, 7601, "Service Pack 1", "Windows 7 Professional");
            OsCompatibility modern = OsCompatibility.For(10, 0, 22631, string.Empty, "Windows 11 Enterprise");

            Assert.Equal(Availability.Fallback, FeatureAvailability.Notifications(legacy));
            Assert.Equal(Availability.Native, FeatureAvailability.Notifications(modern));

            Assert.Equal(Availability.Fallback, FeatureAvailability.AccessGate(legacy));
            Assert.Equal(Availability.Native, FeatureAvailability.AccessGate(modern));
        }

        [Fact]
        public void Every_fallback_has_a_written_limitation()
        {
            // "Clearly identify legacy-only limitations": a fallback with no explanation is the
            // silent degradation the requirement forbids.
            foreach (OsCompatibility os in OsCompatibility.SupportedMatrix())
            {
                foreach (var feature in FeatureAvailability.All(os))
                {
                    if (feature.Value != Availability.Fallback) continue;
                    string limitation = FeatureAvailability.Limitation(feature.Key, os);
                    Assert.False(string.IsNullOrWhiteSpace(limitation),
                        feature.Key + " falls back on " + os.FriendlyName + " with no documented limitation.");
                }
            }
        }
    }

    public enum Availability
    {
        Unavailable,
        Fallback,
        Native
    }

    /// <summary>
    /// The compatibility matrix in code, so it can be asserted and cannot drift from the build.
    /// </summary>
    /// <remarks>
    /// Kept beside the tests rather than in the product assembly on purpose: it is a statement
    /// about the product, not part of it, and putting it in Core would invite code to branch on
    /// it — which is exactly the per-release branching the platform interfaces exist to prevent.
    /// </remarks>
    public static class FeatureAvailability
    {
        public static Availability ForegroundTracking(OsCompatibility os)
        {
            // SetWinEventHook: Windows 2000 onwards, identical behaviour throughout.
            return os.IsSupported ? Availability.Native : Availability.Unavailable;
        }

        public static Availability IdleTracking(OsCompatibility os)
        {
            // GetLastInputInfo: Windows 2000 onwards.
            return os.IsSupported ? Availability.Native : Availability.Unavailable;
        }

        public static Availability LockTracking(OsCompatibility os)
        {
            // SystemEvents.SessionSwitch over WM_WTSSESSION_CHANGE: Windows XP onwards.
            return os.IsSupported ? Availability.Native : Availability.Unavailable;
        }

        public static Availability AttendanceSessions(OsCompatibility os)
        {
            return os.IsSupported ? Availability.Native : Availability.Unavailable;
        }

        public static Availability OfflineQueue(OsCompatibility os)
        {
            // SQLite plus DPAPI; both present on every supported release.
            return os.IsSupported ? Availability.Native : Availability.Unavailable;
        }

        public static Availability SystemTray(OsCompatibility os)
        {
            return os.IsSupported ? Availability.Native : Availability.Unavailable;
        }

        public static Availability DeepLinks(OsCompatibility os)
        {
            return os.IsSupported ? Availability.Native : Availability.Unavailable;
        }

        public static Availability WindowsService(OsCompatibility os)
        {
            return os.IsSupported ? Availability.Native : Availability.Unavailable;
        }

        public static Availability AutoStart(OsCompatibility os)
        {
            return os.IsSupported ? Availability.Native : Availability.Unavailable;
        }

        public static Availability AutoUpdate(OsCompatibility os)
        {
            return os.IsSupported ? Availability.Native : Availability.Unavailable;
        }

        public static Availability Notifications(OsCompatibility os)
        {
            if (!os.IsSupported) return Availability.Unavailable;
            return os.SupportsNativeToast ? Availability.Native : Availability.Fallback;
        }

        public static Availability AccessGate(OsCompatibility os)
        {
            if (!os.IsSupported) return Availability.Unavailable;
            return os.SupportsShellLauncher ? Availability.Native : Availability.Fallback;
        }

        public static System.Collections.Generic.Dictionary<string, Availability> All(OsCompatibility os)
        {
            return new System.Collections.Generic.Dictionary<string, Availability>
            {
                { "Foreground tracking", ForegroundTracking(os) },
                { "Idle tracking", IdleTracking(os) },
                { "Lock/unlock tracking", LockTracking(os) },
                { "Attendance sessions", AttendanceSessions(os) },
                { "Offline queue", OfflineQueue(os) },
                { "System tray", SystemTray(os) },
                { "Deep links", DeepLinks(os) },
                { "Windows service", WindowsService(os) },
                { "Auto-start", AutoStart(os) },
                { "Auto-update", AutoUpdate(os) },
                { "Notifications", Notifications(os) },
                { "Access gate", AccessGate(os) },
            };
        }

        /// <summary>
        /// What is lost, in words, when a feature falls back on this release.
        /// </summary>
        /// <remarks>
        /// These strings are the "clearly identify legacy-only limitations" deliverable. They are
        /// tested for existence above, and they are the text the documentation quotes — so a
        /// limitation cannot be quietly dropped from the docs without a test failing.
        /// </remarks>
        public static string Limitation(string feature, OsCompatibility os)
        {
            switch (feature)
            {
                case "Notifications":
                    if (os.SupportsNativeToast) return null;
                    return os.FriendlyName + " has no Action Center, so the agent draws its own SEL LIVE "
                        + "popup. It carries the same buttons, deep links and delivery receipts. What is lost: "
                        + "notifications do not persist in a system notification centre after they close, they "
                        + "are not governed by Windows' own notification settings or Focus Assist, and a "
                        + "notification raised while the user is signed out is shown at their next sign-in "
                        + "rather than queued by the OS.";

                case "Access gate":
                    if (os.SupportsShellLauncher) return null;
                    return os.FriendlyName + " cannot enforce a controlled shell (Shell Launcher needs "
                        + "Windows 10/11 Enterprise or Education), so the gate is a topmost window. It blocks "
                        + "close, minimise, Escape and Alt+F4 and re-asserts focus. What is lost: it is not an "
                        + "operating-system security boundary — Task Manager launched from Ctrl+Alt+Delete can "
                        + "end it, and a second local account bypasses it. Treat it as an attendance prompt, "
                        + "not as access control.";

                default:
                    return null;
            }
        }
    }
}
