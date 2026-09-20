using System;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using Microsoft.Win32;

namespace Sel.Agent.Core
{
    /// <summary>
    /// Makes TLS 1.2 work on every supported Windows, and says clearly when it cannot.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the single most likely reason a Windows 7 rollout fails, so it gets its own class
    /// rather than two lines in a start-up method.
    /// </para>
    /// <para>
    /// <b>The problem.</b> Google's identity endpoints and Firebase App Hosting both require TLS
    /// 1.2 or better. Windows 7 SP1 supports TLS 1.2 in SChannel but ships with it <i>disabled for
    /// applications</i>, and .NET Framework before 4.7 defaults
    /// <see cref="ServicePointManager.SecurityProtocol"/> to SSL 3.0 and TLS 1.0. The two
    /// combine into a failure that looks like nothing at all: an
    /// <see cref="System.Net.WebException"/> saying the connection was closed unexpectedly, with
    /// no mention of protocols anywhere, on a PC where the same URL opens fine in Chrome —
    /// because Chrome brings its own TLS stack and does not use SChannel.
    /// </para>
    /// <para>
    /// <b>What is done about it.</b> Three things, in order:
    /// </para>
    /// <list type="number">
    /// <item><description>
    /// <see cref="Configure"/> sets the protocol list explicitly rather than relying on the
    /// framework default, and does it by numeric value so that a build targeting an older
    /// framework — the net461 fallback in <c>Directory.Build.props</c> — still compiles even
    /// though <c>SecurityProtocolType.Tls13</c> did not exist then.
    /// </description></item>
    /// <item><description>
    /// <see cref="InspectSchannel"/> reads the registry keys that decide whether the operating
    /// system will even offer TLS 1.2, so the installer can refuse to proceed with an actionable
    /// message instead of leaving a PC that installs cleanly and then never syncs.
    /// </description></item>
    /// <item><description>
    /// <see cref="Probe"/> actually opens a TLS 1.2 connection to the ERP host and reports what
    /// happened. Registry inspection can be fooled by policy, by a partially applied update, or
    /// by a third-party security product terminating TLS; a real handshake cannot.
    /// </description></item>
    /// </list>
    /// <para>
    /// The agent never disables certificate validation, and there is deliberately no option to.
    /// A monitoring client that would accept any certificate is a credential-harvesting
    /// opportunity sitting on four hundred desks.
    /// </para>
    /// </remarks>
    public static class TlsBootstrap
    {
        // Declared numerically because the named members arrived at different framework versions:
        // Tls12 in 4.5, Tls13 in 4.8. Using the literals keeps a net461 retarget compiling.
        private const SecurityProtocolType Tls12 = (SecurityProtocolType)3072;
        private const SecurityProtocolType Tls13 = (SecurityProtocolType)12288;

        // The same protocol, in the other enum. `ServicePointManager` speaks
        // `SecurityProtocolType` and `SslStream.AuthenticateAsClient` speaks `SslProtocols`; the
        // numeric values coincide, but the types do not convert, and conflating them is a compile
        // error rather than a runtime surprise — which is the good outcome.
        private const SslProtocols SslTls12 = (SslProtocols)3072;

        private static bool _configured;

        /// <summary>
        /// Set the process's TLS policy. Call once, before the first HTTPS request.
        /// </summary>
        /// <remarks>
        /// TLS 1.3 is requested optimistically and dropped if the platform rejects the value:
        /// Windows 11 negotiates it, Windows 7 has never heard of it, and asking for an unknown
        /// protocol throws rather than degrading. TLS 1.0 and 1.1 are deliberately excluded even
        /// though including them would make a misconfigured Windows 7 machine "work" — they are
        /// deprecated, the endpoints reject them anyway, and leaving them in would turn a clear
        /// prerequisite failure into an intermittent one.
        /// </remarks>
        public static void Configure()
        {
            if (_configured) return;

            try
            {
                ServicePointManager.SecurityProtocol = Tls13 | Tls12;
            }
            catch (NotSupportedException)
            {
                ServicePointManager.SecurityProtocol = Tls12;
            }
            catch (ArgumentException)
            {
                ServicePointManager.SecurityProtocol = Tls12;
            }

            // Windows 7's default of two connections per host serialises the heartbeat behind an
            // activity batch upload. Eight is ample for an agent that makes at most three
            // concurrent calls and costs nothing when idle.
            ServicePointManager.DefaultConnectionLimit = 8;

            // Without this, a pooled connection can be held long enough to survive a DNS change —
            // which matters when an ERP host moves and half the fleet keeps talking to the old IP.
            ServicePointManager.DnsRefreshTimeout = 60 * 1000;

            _configured = true;
        }

        /// <summary>What the registry says about SChannel's TLS 1.2 support.</summary>
        public sealed class SchannelState
        {
            /// <summary>True when the OS enables TLS 1.2 without any registry work.</summary>
            public bool EnabledByDefault { get; set; }

            /// <summary>True when the client-side TLS 1.2 key is present and not disabled.</summary>
            public bool ClientProtocolEnabled { get; set; }

            /// <summary>True when .NET is told to use the OS default rather than SSL 3.0/TLS 1.0.</summary>
            public bool StrongCryptoEnabled { get; set; }

            /// <summary>Everything that needs doing, in words, or empty if nothing does.</summary>
            public string[] Remediation { get; set; }

            public bool LooksUsable
            {
                get { return EnabledByDefault || (ClientProtocolEnabled && StrongCryptoEnabled); }
            }
        }

        private const string Tls12ClientKey =
            @"SYSTEM\CurrentControlSet\Control\SecurityProviders\SCHANNEL\Protocols\TLS 1.2\Client";

        private static readonly string[] StrongCryptoKeys =
        {
            @"SOFTWARE\Microsoft\.NETFramework\v4.0.30319",
            @"SOFTWARE\WOW6432Node\Microsoft\.NETFramework\v4.0.30319"
        };

        /// <summary>
        /// Read the registry state without changing it.
        /// </summary>
        /// <remarks>
        /// Read-only on purpose. The agent runs as a user for most of its life and cannot write
        /// HKLM; more to the point, silently reconfiguring a machine's TLS stack is not something
        /// a monitoring agent should do behind an administrator's back. The installer applies the
        /// changes, with elevation, having told the operator what it is doing.
        /// </remarks>
        public static SchannelState InspectSchannel()
        {
            var state = new SchannelState();
            var remediation = new System.Collections.Generic.List<string>();

            state.EnabledByDefault = OsCompatibility.Current.HasTls12ByDefault;

            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (RegistryKey key = baseKey.OpenSubKey(Tls12ClientKey))
                {
                    if (key == null)
                    {
                        // Absent means "the OS default applies", which on 8.1+ is enabled and on
                        // Windows 7 is disabled — so the answer depends on the release, not on
                        // the key's absence alone.
                        state.ClientProtocolEnabled = state.EnabledByDefault;
                    }
                    else
                    {
                        object enabled = key.GetValue("Enabled");
                        object disabledByDefault = key.GetValue("DisabledByDefault");
                        bool explicitlyEnabled = enabled == null || Convert.ToInt32(enabled) != 0;
                        bool defaultOff = disabledByDefault != null && Convert.ToInt32(disabledByDefault) != 0;
                        state.ClientProtocolEnabled = explicitlyEnabled && !defaultOff;
                    }
                }
            }
            catch
            {
                state.ClientProtocolEnabled = state.EnabledByDefault;
            }

            state.StrongCryptoEnabled = ReadStrongCrypto();

            if (!state.ClientProtocolEnabled)
            {
                remediation.Add(
                    "Enable TLS 1.2 in SChannel: set HKLM\\" + Tls12ClientKey +
                    " → Enabled = 1 (DWORD) and DisabledByDefault = 0 (DWORD), then restart.");
            }
            if (!state.StrongCryptoEnabled && OsCompatibility.Current.IsWindows7)
            {
                remediation.Add(
                    "Set SchUseStrongCrypto = 1 (DWORD) under HKLM\\SOFTWARE\\Microsoft\\.NETFramework\\v4.0.30319 " +
                    "and its WOW6432Node counterpart, so .NET negotiates the OS default rather than TLS 1.0.");
            }
            if (OsCompatibility.Current.IsWindows7)
            {
                remediation.Add(
                    "Confirm KB3140245 (or a later rollup containing it) is installed — without it " +
                    "Windows 7 SP1 cannot negotiate TLS 1.2 from WinHTTP at all.");
            }

            state.Remediation = remediation.ToArray();
            return state;
        }

        private static bool ReadStrongCrypto()
        {
            foreach (string path in StrongCryptoKeys)
            {
                try
                {
                    using (RegistryKey baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                    using (RegistryKey key = baseKey.OpenSubKey(path))
                    {
                        if (key == null) continue;
                        object value = key.GetValue("SchUseStrongCrypto");
                        if (value != null && Convert.ToInt32(value) != 0) return true;
                    }
                }
                catch
                {
                    // Ignored: an unreadable key is reported as "not set", which is the safe
                    // reading — it produces a remediation line rather than a false all-clear.
                }
            }
            return false;
        }

        /// <summary>The outcome of an actual handshake against the ERP host.</summary>
        public sealed class ProbeResult
        {
            public bool Succeeded { get; set; }
            public string NegotiatedProtocol { get; set; }
            public string Error { get; set; }
        }

        /// <summary>
        /// Open a real TLS 1.2 connection and report what was negotiated.
        /// </summary>
        /// <remarks>
        /// The authoritative check, and the one the installer acts on. Registry inspection says
        /// what the machine is configured to do; this says what it actually does, which differs
        /// whenever a proxy, a TLS-inspecting firewall or a half-applied update is involved — and
        /// in a construction company's site offices, one of those three usually is.
        /// </remarks>
        public static ProbeResult Probe(string host, int port, int timeoutMs)
        {
            Configure();
            var result = new ProbeResult();

            try
            {
                using (var client = new TcpClient())
                {
                    IAsyncResult connect = client.BeginConnect(host, port, null, null);
                    if (!connect.AsyncWaitHandle.WaitOne(timeoutMs))
                    {
                        result.Error = "Could not reach " + host + ":" + port + " within " + timeoutMs + " ms.";
                        return result;
                    }
                    client.EndConnect(connect);

                    using (var ssl = new SslStream(client.GetStream(), false))
                    {
                        // Certificate validation left at the default on purpose — see the class
                        // remarks. A probe that ignored certificates would pass on exactly the
                        // machines where the real client is about to fail.
                        ssl.AuthenticateAsClient(host, null, SslTls12, false);
                        result.Succeeded = true;
                        result.NegotiatedProtocol = ssl.SslProtocol.ToString();
                    }
                }
            }
            catch (AuthenticationException error)
            {
                result.Error = "TLS handshake failed: " + error.Message
                    + (OsCompatibility.Current.IsWindows7
                        ? " On Windows 7 this usually means TLS 1.2 is not enabled in SChannel — run the agent's prerequisite check."
                        : string.Empty);
            }
            catch (Exception error)
            {
                result.Error = error.Message;
            }

            return result;
        }
    }
}
