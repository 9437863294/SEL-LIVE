using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Sel.Agent.Service
{
    /// <summary>
    /// Is this downloaded file the package the server published, and is it signed by us?
    /// </summary>
    /// <remarks>
    /// <para>
    /// Two independent checks, and both have to pass before anything is run as SYSTEM.
    /// </para>
    /// <list type="number">
    /// <item><description>
    /// <b>The SHA-256 matches what the server said.</b> This is the one that defends against a
    /// compromised package host: the hash comes from SEL LIVE over an authenticated connection
    /// and the file comes from wherever the installer happens to be hosted, so an attacker needs
    /// both to succeed.
    /// </description></item>
    /// <item><description>
    /// <b>The Authenticode signature is valid and names the expected subject.</b> This defends
    /// against the case where the attacker has the publish screen too. The version route already
    /// refuses to offer a package with no signature subject, so this is never skipped by
    /// accident.
    /// </description></item>
    /// </list>
    /// <para>
    /// <b>The signature is verified, not merely read.</b> <c>X509Certificate.CreateFromSignedFile</c>
    /// returns the signing certificate of a file whose signature is invalid, expired or forged —
    /// it parses, it does not validate. Reading the subject from it and stopping there is a
    /// check that looks thorough and is worth nothing, so <c>WinVerifyTrust</c> runs first and
    /// the subject is only compared afterwards.
    /// </para>
    /// </remarks>
    internal static class PackageVerifier
    {
        internal sealed class Result
        {
            internal bool Ok { get; set; }
            internal string Reason { get; set; }
        }

        internal static string Sha256Of(string path)
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16))
            using (var algorithm = SHA256.Create())
            {
                byte[] hash = algorithm.ComputeHash(stream);
                var text = new System.Text.StringBuilder(hash.Length * 2);
                foreach (byte value in hash) text.Append(value.ToString("x2"));
                return text.ToString();
            }
        }

        /// <summary>
        /// Verify the Authenticode signature, then that it belongs to the expected subject.
        /// </summary>
        /// <param name="expectedSubject">
        /// Matched as a case-insensitive substring of the certificate's subject, because a
        /// subject line carries the country, state and organisational unit around the name and
        /// an administrator publishing a version should not have to reproduce all of it.
        /// </param>
        internal static Result VerifySignature(string path, string expectedSubject)
        {
            if (string.IsNullOrEmpty(expectedSubject))
            {
                // Not reachable through the version route, which refuses to offer a package
                // without one — but this is the last gate before running the file, so it does
                // not assume the caller got there that way.
                return new Result { Reason = "no signature subject was published for this version" };
            }

            uint status = WinVerifyTrustFor(path, checkRevocation: true);
            string caveat = string.Empty;

            // Revocation checking has to reach a CRL or OCSP endpoint, and a head-office proxy
            // that allows SEL LIVE and nothing else will block it. Refusing every update on such
            // a machine — for a check that could not be *performed*, rather than one that failed
            // — would make auto-update unusable exactly where it is most needed. So the chain is
            // re-verified without it, and the gap is stated rather than hidden: the signature and
            // the signer are still proved; only "has this certificate been revoked since" is
            // left unanswered.
            if (IsRevocationUnavailable(status))
            {
                uint retry = WinVerifyTrustFor(path, checkRevocation: false);
                if (retry == 0)
                {
                    status = 0;
                    caveat = " (revocation could not be checked from this network)";
                }
                else
                {
                    status = retry;
                }
            }

            if (status != 0)
            {
                return new Result
                {
                    Reason = "Windows refused the signature (0x" + status.ToString("X8") + "): "
                        + DescribeTrustStatus(status),
                };
            }

            string subject;
            try
            {
                using (var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(path)))
                {
                    subject = certificate.Subject ?? string.Empty;
                }
            }
            catch (Exception error)
            {
                return new Result { Reason = "the signing certificate could not be read: " + error.Message };
            }

            if (subject.IndexOf(expectedSubject, StringComparison.OrdinalIgnoreCase) < 0)
            {
                return new Result
                {
                    Reason = "signed by \"" + subject + "\", which does not contain the expected \""
                        + expectedSubject + "\"",
                };
            }

            return new Result { Ok = true, Reason = "signature valid, signed by " + subject + caveat };
        }

        /* ── WinVerifyTrust ──────────────────────────────────────────────────────────────── */

        private static readonly Guid WintrustActionGenericVerifyV2 =
            new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

        private const uint WTD_UI_NONE = 2;
        private const uint WTD_REVOKE_NONE = 0;
        private const uint WTD_REVOKE_WHOLECHAIN = 1;
        private const uint WTD_CHOICE_FILE = 1;
        private const uint WTD_STATEACTION_VERIFY = 1;
        private const uint WTD_STATEACTION_CLOSE = 2;
        private const uint WTD_SAFER_FLAG = 0x100;

        private static uint WinVerifyTrustFor(string path, bool checkRevocation)
        {
            var fileInfo = new WinTrustFileInfo
            {
                cbStruct = (uint)Marshal.SizeOf(typeof(WinTrustFileInfo)),
                pcwszFilePath = path,
                hFile = IntPtr.Zero,
                pgKnownSubject = IntPtr.Zero,
            };

            IntPtr filePointer = Marshal.AllocCoTaskMem(Marshal.SizeOf(typeof(WinTrustFileInfo)));
            try
            {
                Marshal.StructureToPtr(fileInfo, filePointer, false);

                var data = new WinTrustData
                {
                    cbStruct = (uint)Marshal.SizeOf(typeof(WinTrustData)),
                    pPolicyCallbackData = IntPtr.Zero,
                    pSIPClientData = IntPtr.Zero,
                    dwUIChoice = WTD_UI_NONE,
                    fdwRevocationChecks = checkRevocation ? WTD_REVOKE_WHOLECHAIN : WTD_REVOKE_NONE,
                    dwUnionChoice = WTD_CHOICE_FILE,
                    pFile = filePointer,
                    dwStateAction = WTD_STATEACTION_VERIFY,
                    hWVTStateData = IntPtr.Zero,
                    pwszURLReference = null,
                    dwProvFlags = WTD_SAFER_FLAG,
                    dwUIContext = 0,
                };

                Guid action = WintrustActionGenericVerifyV2;
                uint result = WinVerifyTrust(IntPtr.Zero, ref action, ref data);

                // Always close the state, whatever the verdict, or the handle leaks for the life
                // of the service.
                data.dwStateAction = WTD_STATEACTION_CLOSE;
                WinVerifyTrust(IntPtr.Zero, ref action, ref data);

                return result;
            }
            finally
            {
                Marshal.FreeCoTaskMem(filePointer);
            }
        }

        /// <summary>
        /// Statuses that mean the revocation state is unknown, not that the file is untrusted.
        /// </summary>
        /// <remarks>
        /// CERT_E_REVOCATION_FAILURE and CRYPT_E_REVOCATION_OFFLINE are what a blocked CRL
        /// endpoint produces; CRYPT_E_NO_REVOCATION_CHECK is what a certificate with no
        /// distribution point produces. None of the three says anything bad about the signature.
        /// </remarks>
        private static bool IsRevocationUnavailable(uint status)
        {
            return status == 0x80092012   // CRYPT_E_NO_REVOCATION_CHECK
                || status == 0x80092013   // CRYPT_E_REVOCATION_OFFLINE
                || status == 0x800B010E;  // CERT_E_REVOCATION_FAILURE
        }

        /// <summary>The handful of verdicts worth naming, for the event log.</summary>
        private static string DescribeTrustStatus(uint status)
        {
            switch (status)
            {
                case 0x800B0100: return "the file is not signed at all";
                case 0x800B0101: return "the signing certificate has expired";
                case 0x800B0109: return "the signing certificate chains to a root this machine does not trust";
                case 0x80096010: return "the file has been altered since it was signed";
                case 0x800B010C: return "the signing certificate has been revoked";
                default: return "see WinVerifyTrust status codes";
            }
        }

        [DllImport("wintrust.dll", ExactSpelling = true, SetLastError = false, CharSet = CharSet.Unicode)]
        private static extern uint WinVerifyTrust(IntPtr hwnd, ref Guid actionId, ref WinTrustData data);

        [StructLayout(LayoutKind.Sequential)]
        private struct WinTrustFileInfo
        {
            public uint cbStruct;
            [MarshalAs(UnmanagedType.LPTStr)] public string pcwszFilePath;
            public IntPtr hFile;
            public IntPtr pgKnownSubject;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct WinTrustData
        {
            public uint cbStruct;
            public IntPtr pPolicyCallbackData;
            public IntPtr pSIPClientData;
            public uint dwUIChoice;
            public uint fdwRevocationChecks;
            public uint dwUnionChoice;
            public IntPtr pFile;
            public uint dwStateAction;
            public IntPtr hWVTStateData;
            [MarshalAs(UnmanagedType.LPTStr)] public string pwszURLReference;
            public uint dwProvFlags;
            public uint dwUIContext;
        }
    }
}
