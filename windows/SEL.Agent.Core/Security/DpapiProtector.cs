using System;
using System.Security.Cryptography;
using System.Text;

namespace Sel.Agent.Core.Security
{
    /// <summary>
    /// Windows' own encryption at rest, for the two secrets the agent has to keep on disk.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The agent stores a device secret and a Firebase refresh token, and queues activity locally
    /// while offline. All three want encrypting, and the brief asks for DPAPI or equivalent.
    /// </para>
    /// <para>
    /// <b>Why DPAPI and not a key in the binary.</b> Any key compiled into the executable is on
    /// every PC in the company and one decompiler away from being on none of them. DPAPI's
    /// machine key is held by LSA, is different on every machine, and is not readable by copying
    /// the file — so a stolen laptop's disk, mounted elsewhere, yields ciphertext and nothing
    /// else. That is the actual threat model here: not a determined attacker with SYSTEM on a
    /// live machine (against whom no client-side scheme works), but a disk or a backup leaving
    /// the building.
    /// </para>
    /// <para>
    /// <b>Machine scope, not user scope, and the entropy that makes up for it.</b> The device
    /// secret is written by the installer running as an administrator and read by a service
    /// running as LocalSystem, so it cannot be tied to a user profile. Machine scope means any
    /// process on that PC can ask DPAPI to decrypt it — so every call passes an additional
    /// entropy value tied to what is being protected. A different purpose string produces a
    /// different key, which means malware would have to know both that the agent exists and what
    /// string it used, rather than simply enumerating and unprotecting every blob it finds.
    /// </para>
    /// <para>
    /// Available identically on Windows 7 through 11; <c>ProtectedData</c> has been in
    /// <c>System.Security</c> since .NET 2.0 and needs no package on .NET Framework.
    /// </para>
    /// </remarks>
    public static class DpapiProtector
    {
        /// <summary>Purpose strings. Distinct on purpose — see the remarks on entropy.</summary>
        public static class Purpose
        {
            public const string DeviceCredential = "SEL.LIVE.Agent.DeviceCredential.v1";
            public const string UserSession = "SEL.LIVE.Agent.UserSession.v1";
            public const string OfflineQueue = "SEL.LIVE.Agent.OfflineQueue.v1";
        }

        private static byte[] EntropyFor(string purpose)
        {
            // Hashed rather than used raw so the entropy is a fixed 32 bytes whatever the string,
            // and so a future purpose string cannot accidentally be a prefix of an existing one.
            using (var sha = SHA256.Create())
            {
                return sha.ComputeHash(Encoding.UTF8.GetBytes(purpose));
            }
        }

        /// <summary>Encrypt a string for this machine. Returns base64.</summary>
        public static string Protect(string plainText, string purpose)
        {
            if (plainText == null) throw new ArgumentNullException("plainText");
            byte[] plain = Encoding.UTF8.GetBytes(plainText);
            byte[] cipher = ProtectedData.Protect(plain, EntropyFor(purpose), DataProtectionScope.LocalMachine);
            Array.Clear(plain, 0, plain.Length);
            return Convert.ToBase64String(cipher);
        }

        /// <summary>Encrypt raw bytes for this machine.</summary>
        public static byte[] ProtectBytes(byte[] plain, string purpose)
        {
            if (plain == null) throw new ArgumentNullException("plain");
            return ProtectedData.Protect(plain, EntropyFor(purpose), DataProtectionScope.LocalMachine);
        }

        /// <summary>
        /// Decrypt, returning null rather than throwing when the blob cannot be read.
        /// </summary>
        /// <remarks>
        /// Null is the useful answer here and an exception is not. A blob that will not decrypt
        /// means the disk was moved, the machine was re-imaged, or the file is corrupt — and in
        /// every one of those cases the right response is the same: treat the credential as
        /// absent and re-enrol. Throwing would turn a recoverable state into a crash loop at
        /// start-up, on a machine somebody is standing in front of waiting to log in.
        /// </remarks>
        public static string Unprotect(string protectedBase64, string purpose)
        {
            if (string.IsNullOrEmpty(protectedBase64)) return null;
            try
            {
                byte[] cipher = Convert.FromBase64String(protectedBase64);
                byte[] plain = ProtectedData.Unprotect(cipher, EntropyFor(purpose), DataProtectionScope.LocalMachine);
                return Encoding.UTF8.GetString(plain);
            }
            catch (FormatException)
            {
                return null;
            }
            catch (CryptographicException)
            {
                return null;
            }
        }

        /// <summary>Decrypt raw bytes, returning null when the blob cannot be read.</summary>
        public static byte[] UnprotectBytes(byte[] cipher, string purpose)
        {
            if (cipher == null || cipher.Length == 0) return null;
            try
            {
                return ProtectedData.Unprotect(cipher, EntropyFor(purpose), DataProtectionScope.LocalMachine);
            }
            catch (CryptographicException)
            {
                return null;
            }
        }

        /// <summary>
        /// Whether DPAPI works on this machine at all.
        /// </summary>
        /// <remarks>
        /// Worth checking once at install time. DPAPI failing is rare but not unheard of — a
        /// corrupted LSA secret store, or a machine cloned from an image without sysprep — and
        /// discovering it at enrolment produces a clear prerequisite failure, whereas discovering
        /// it at first sign-in produces a PC that enrols, forgets its credential on restart, and
        /// enrols again for ever.
        /// </remarks>
        public static bool SelfTest()
        {
            try
            {
                const string probe = "sel-live-dpapi-probe";
                string round = Unprotect(Protect(probe, Purpose.DeviceCredential), Purpose.DeviceCredential);
                return round == probe;
            }
            catch
            {
                return false;
            }
        }
    }
}
