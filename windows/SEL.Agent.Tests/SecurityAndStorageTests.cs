using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Platform;
using Sel.Agent.Core.Platform.Win32;
using Sel.Agent.Core.Security;
using Sel.Agent.Core.Storage;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// Deep-link validation, DPAPI, and the offline queue.
    /// </summary>
    public class SecurityAndStorageTests
    {
        /* ── Deep links: the client-side half of §23 ─────────────────────────────────────── */

        [Theory]
        [InlineData("/e-approval/PR-2026-0098", "https://sel.example.com/e-approval/PR-2026-0098")]
        [InlineData("/office-hub/tasks", "https://sel.example.com/office-hub/tasks")]
        [InlineData("/", "https://sel.example.com/")]
        public void Valid_paths_compose_against_the_configured_origin(string path, string expected)
        {
            var launcher = new Win32DeepLinkLauncher("https://sel.example.com");
            Assert.Equal(expected, launcher.Compose(path));
        }

        [Theory]
        // Protocol-relative: a browser reads this as a different host entirely.
        [InlineData("//evil.example/steal")]
        // Absolute URLs would make a spoofed notification a one-click phishing primitive.
        [InlineData("https://evil.example/steal")]
        [InlineData("http://evil.example")]
        // Process.Start will happily launch these on Windows.
        [InlineData("file:///C:/Windows/System32/cmd.exe")]
        [InlineData(@"\\attacker\share\payload.exe")]
        [InlineData("javascript:alert(1)")]
        [InlineData("ms-settings:")]
        [InlineData("relative/path")]
        public void Anything_that_is_not_a_same_origin_path_is_refused(string path)
        {
            var launcher = new Win32DeepLinkLauncher("https://sel.example.com");
            Assert.Null(launcher.Compose(path));
        }

        [Fact]
        public void An_unconfigured_origin_refuses_everything()
        {
            Assert.Null(new Win32DeepLinkLauncher(null).Compose("/office-hub"));
            Assert.Null(new Win32DeepLinkLauncher(string.Empty).Compose("/office-hub"));
        }

        [Fact]
        public void A_trailing_slash_on_the_base_url_does_not_double_up()
        {
            var launcher = new Win32DeepLinkLauncher("https://sel.example.com/");
            Assert.Equal("https://sel.example.com/office-hub", launcher.Compose("/office-hub"));
        }

        /* ── DPAPI ───────────────────────────────────────────────────────────────────────── */

        [Fact]
        public void Dpapi_round_trips()
        {
            Assert.True(DpapiProtector.SelfTest());

            const string secret = "a-device-secret-with-unicode-₹-and-emoji-🙂";
            string sealedText = DpapiProtector.Protect(secret, DpapiProtector.Purpose.DeviceCredential);
            Assert.NotEqual(secret, sealedText);
            Assert.Equal(secret, DpapiProtector.Unprotect(sealedText, DpapiProtector.Purpose.DeviceCredential));
        }

        [Fact]
        public void A_blob_sealed_for_one_purpose_cannot_be_opened_with_another()
        {
            // The entropy is what stops malware enumerating and unprotecting every DPAPI blob it
            // finds on a machine. If this ever passes, that protection has been lost.
            string sealedText = DpapiProtector.Protect("secret", DpapiProtector.Purpose.DeviceCredential);
            Assert.Null(DpapiProtector.Unprotect(sealedText, DpapiProtector.Purpose.UserSession));
            Assert.Null(DpapiProtector.Unprotect(sealedText, DpapiProtector.Purpose.OfflineQueue));
        }

        [Fact]
        public void Corrupt_input_returns_null_rather_than_throwing()
        {
            // A moved disk or a re-imaged machine produces exactly this, and the right response
            // is "re-enrol", not a crash loop at start-up.
            Assert.Null(DpapiProtector.Unprotect("not-base64-at-all!!", DpapiProtector.Purpose.DeviceCredential));
            Assert.Null(DpapiProtector.Unprotect("YWJjZGVm", DpapiProtector.Purpose.DeviceCredential));
            Assert.Null(DpapiProtector.Unprotect(null, DpapiProtector.Purpose.DeviceCredential));
            Assert.Null(DpapiProtector.Unprotect(string.Empty, DpapiProtector.Purpose.DeviceCredential));
        }

        /* ── Device identity ─────────────────────────────────────────────────────────────── */

        [Fact]
        public void The_device_secret_is_never_stored_in_clear()
        {
            using (var temp = new TempDirectory())
            {
                var store = new DeviceIdentityStore(temp.Path);
                const string secret = "top-secret-device-credential-value";
                store.Write("dev-1", "SEL-HO-PC-023", secret, 1, "https://sel.example.com");

                string onDisk = File.ReadAllText(Path.Combine(temp.Path, "device.json"));
                Assert.DoesNotContain(secret, onDisk);
                Assert.Equal(secret, store.ReadSecret());

                DeviceIdentity identity = store.Read();
                Assert.Equal("dev-1", identity.DeviceId);
                Assert.Equal(1, identity.SecretVersion);
            }
        }

        [Fact]
        public void Rewriting_the_identity_replaces_it_atomically()
        {
            using (var temp = new TempDirectory())
            {
                var store = new DeviceIdentityStore(temp.Path);
                store.Write("dev-1", "PC", "first-secret", 1, "https://sel.example.com");
                store.Write("dev-1", "PC", "rotated-secret", 2, "https://sel.example.com");

                Assert.Equal("rotated-secret", store.ReadSecret());
                Assert.Equal(2, store.Read().SecretVersion);
                Assert.False(File.Exists(Path.Combine(temp.Path, "device.json.tmp")));
            }
        }

        [Fact]
        public void An_absent_identity_reads_as_null_rather_than_throwing()
        {
            using (var temp = new TempDirectory())
            {
                var store = new DeviceIdentityStore(temp.Path);
                Assert.False(store.Exists);
                Assert.Null(store.Read());
                Assert.Null(store.ReadSecret());
            }
        }

        /* ── Offline queue ───────────────────────────────────────────────────────────────── */

        private static ActivitySpan Span(string id, int minuteOffset)
        {
            DateTime start = new DateTime(2026, 9, 20, 4, 0, 0, DateTimeKind.Utc).AddMinutes(minuteOffset);
            return new ActivitySpan
            {
                SpanId = id,
                EventType = ActivityEventTypes.AppActive,
                ProcessName = "excel.exe",
                ApplicationName = "Microsoft Excel",
                StartedAt = IsoTime.Format(start),
                EndedAt = IsoTime.Format(start.AddMinutes(1)),
                IdleSeconds = 0,
                WindowTitle = "Budget 2026.xlsx - Excel"
            };
        }

        [Fact]
        public void Queued_spans_survive_a_round_trip_and_come_back_oldest_first()
        {
            using (var temp = new TempDirectory())
            using (var queue = new SqliteOfflineQueue(Path.Combine(temp.Path, "queue.db")))
            {
                queue.Enqueue("session-1", new[] { Span("a", 0), Span("b", 1), Span("c", 2) });
                Assert.Equal(3, queue.PendingCount());

                IList<QueuedSpan> peeked = queue.Peek(10);
                Assert.Equal(new[] { "a", "b", "c" }, peeked.Select(entry => entry.Span.SpanId).ToArray());
                Assert.Equal("Microsoft Excel", peeked[0].Span.ApplicationName);
                Assert.Equal("session-1", peeked[0].SessionId);
            }
        }

        [Fact]
        public void The_payload_on_disk_is_encrypted()
        {
            // §27 asks for an encrypted queue. Structure is readable by design — a backlog count
            // is operational data — but the content, which names what somebody had open, is not.
            using (var temp = new TempDirectory())
            {
                string path = Path.Combine(temp.Path, "queue.db");
                using (var queue = new SqliteOfflineQueue(path))
                {
                    queue.Enqueue("session-1", new[] { Span("a", 0) });
                }

                byte[] raw = File.ReadAllBytes(path);
                string asText = System.Text.Encoding.UTF8.GetString(raw);
                Assert.DoesNotContain("Budget 2026.xlsx", asText);
                Assert.DoesNotContain("Microsoft Excel", asText);
            }
        }

        [Fact]
        public void Enqueueing_the_same_span_twice_stores_it_once()
        {
            // The shutdown path can reach the same spans through both the final flush and the
            // batch timer.
            using (var temp = new TempDirectory())
            using (var queue = new SqliteOfflineQueue(Path.Combine(temp.Path, "queue.db")))
            {
                queue.Enqueue("session-1", new[] { Span("a", 0) });
                queue.Enqueue("session-1", new[] { Span("a", 0), Span("b", 1) });
                Assert.Equal(2, queue.PendingCount());
            }
        }

        [Fact]
        public void Acknowledged_spans_are_removed()
        {
            using (var temp = new TempDirectory())
            using (var queue = new SqliteOfflineQueue(Path.Combine(temp.Path, "queue.db")))
            {
                queue.Enqueue("session-1", new[] { Span("a", 0), Span("b", 1) });
                IList<QueuedSpan> peeked = queue.Peek(10);
                queue.Acknowledge(peeked.Select(entry => entry.RowId));
                Assert.Equal(0, queue.PendingCount());
            }
        }

        [Fact]
        public void A_span_the_server_will_never_accept_is_dropped_rather_than_retried_for_ever()
        {
            using (var temp = new TempDirectory())
            using (var queue = new SqliteOfflineQueue(Path.Combine(temp.Path, "queue.db")))
            {
                queue.Enqueue("session-1", new[] { Span("a", 0) });
                queue.MarkFailed(queue.Peek(1).Select(entry => entry.RowId), "Malformed span.", true);
                Assert.Equal(0, queue.PendingCount());
            }
        }

        [Fact]
        public void A_transient_failure_keeps_the_span_but_counts_the_attempt()
        {
            using (var temp = new TempDirectory())
            using (var queue = new SqliteOfflineQueue(Path.Combine(temp.Path, "queue.db")))
            {
                queue.Enqueue("session-1", new[] { Span("a", 0) });
                queue.MarkFailed(queue.Peek(1).Select(entry => entry.RowId), "Network down.", false);

                IList<QueuedSpan> peeked = queue.Peek(1);
                Assert.Single(peeked);
                Assert.Equal(1, peeked[0].Attempts);
            }
        }

        [Fact]
        public void A_span_that_has_exhausted_its_retries_stops_blocking_the_queue()
        {
            // The failure mode this guards: one permanently failing span at the head of the
            // queue stopping every span behind it from ever being uploaded.
            using (var temp = new TempDirectory())
            using (var queue = new SqliteOfflineQueue(Path.Combine(temp.Path, "queue.db")))
            {
                queue.Enqueue("session-1", new[] { Span("bad", 0), Span("good", 1) });

                long badRow = queue.Peek(10).Single(entry => entry.Span.SpanId == "bad").RowId;
                for (int attempt = 0; attempt < SqliteOfflineQueue.MaxAttempts; attempt++)
                {
                    queue.MarkFailed(new[] { badRow }, "Transient.", false);
                }

                IList<QueuedSpan> remaining = queue.Peek(10);
                Assert.Single(remaining);
                Assert.Equal("good", remaining[0].Span.SpanId);
                Assert.Equal(1, queue.PendingCount());
            }
        }

        [Fact]
        public void Pruning_removes_old_spans_and_leaves_recent_ones()
        {
            using (var temp = new TempDirectory())
            using (var queue = new SqliteOfflineQueue(Path.Combine(temp.Path, "queue.db")))
            {
                queue.Enqueue("session-1", new[] { Span("a", 0), Span("b", 1) });

                // Nothing is older than a day, so a one-day window removes nothing.
                Assert.Equal(0, queue.Prune(TimeSpan.FromDays(1)));
                Assert.Equal(2, queue.PendingCount());

                // A zero window makes everything eligible.
                Assert.Equal(2, queue.Prune(TimeSpan.Zero));
                Assert.Equal(0, queue.PendingCount());
            }
        }

        /* ── TLS ─────────────────────────────────────────────────────────────────────────── */

        [Fact]
        public void Configuring_TLS_never_leaves_the_deprecated_protocols_enabled()
        {
            TlsBootstrap.Configure();
            var current = System.Net.ServicePointManager.SecurityProtocol;

            Assert.True(current.HasFlag((System.Net.SecurityProtocolType)3072), "TLS 1.2 must be enabled.");
#pragma warning disable SYSLIB0039, CS0618
            Assert.False(current.HasFlag(System.Net.SecurityProtocolType.Ssl3));
            Assert.False(current.HasFlag(System.Net.SecurityProtocolType.Tls));
            Assert.False(current.HasFlag(System.Net.SecurityProtocolType.Tls11));
#pragma warning restore SYSLIB0039, CS0618
        }

        [Fact]
        public void The_Schannel_inspection_always_explains_itself_on_Windows_7()
        {
            // Read-only, so it is safe to run anywhere. On Windows 7 it must always produce
            // remediation text, because the KB reminder applies even when the registry looks right.
            TlsBootstrap.SchannelState state = TlsBootstrap.InspectSchannel();
            Assert.NotNull(state.Remediation);
            if (OsCompatibility.Current.IsWindows7)
            {
                Assert.NotEmpty(state.Remediation);
            }
        }

        /* ── Machine facts ───────────────────────────────────────────────────────────────── */

        [Fact]
        public void Machine_facts_never_include_a_MAC_address()
        {
            // §4 rules out MAC-address identity. This is the test that keeps somebody from
            // "helpfully" adding one later.
            DeviceMachineFacts facts = new Win32MachineFactsProvider().Collect();
            Assert.False(string.IsNullOrEmpty(facts.Hostname));

            // Matched by shape rather than by the substring "mac", which `machineGuid` contains.
            // Six hex pairs separated by colons or hyphens is what a MAC address looks like in
            // every format Windows produces.
            string serialised = Newtonsoft.Json.JsonConvert.SerializeObject(facts);
            Assert.False(
                System.Text.RegularExpressions.Regex.IsMatch(
                    serialised, @"\b[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}\b"),
                "Machine facts appear to contain a MAC address: " + serialised);

            // And no field is named for one, which would be the other way it could creep in.
            foreach (var property in typeof(DeviceMachineFacts).GetProperties())
            {
                Assert.False(
                    property.Name.IndexOf("MacAddress", StringComparison.OrdinalIgnoreCase) >= 0
                    || property.Name.Equals("Mac", StringComparison.OrdinalIgnoreCase),
                    "DeviceMachineFacts." + property.Name + " looks like a MAC address field (§4 forbids one).");
            }
        }

        [Fact]
        public void Machine_facts_degrade_rather_than_throw_when_WMI_is_unavailable()
        {
            // Every field except the hostname is optional. On a locked-down SOE most of them are
            // unreadable, and a device that cannot report its motherboard serial must still enrol.
            DeviceMachineFacts facts = new Win32MachineFactsProvider().Collect();
            Assert.NotNull(facts);
            Assert.False(string.IsNullOrEmpty(facts.WindowsVersion));
            Assert.Contains(facts.Architecture, new[] { "x86", "x64" });
        }

        private sealed class TempDirectory : IDisposable
        {
            public TempDirectory()
            {
                Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "sel-agent-tests-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(Path);
            }

            public string Path { get; private set; }

            public void Dispose()
            {
                try
                {
                    // SQLite keeps the file mapped until the pool is cleared, which Dispose does.
                    Directory.Delete(Path, true);
                }
                catch (IOException)
                {
                    // A leftover temp directory is not worth failing a test run over.
                }
            }
        }
    }
}
