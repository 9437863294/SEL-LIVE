using System;
using System.Globalization;
using Sel.Agent.Core.Contracts;

namespace Sel.Agent.Core.Update
{
    /// <summary>Why an offered update was or was not taken. Logged verbatim.</summary>
    public sealed class UpdateDecision
    {
        public bool Install { get; set; }
        public string Reason { get; set; }

        internal static UpdateDecision No(string reason)
        {
            return new UpdateDecision { Install = false, Reason = reason };
        }

        internal static UpdateDecision Yes(string reason)
        {
            return new UpdateDecision { Install = true, Reason = reason };
        }
    }

    /// <summary>
    /// Whether to install an offered build, and whether what was downloaded is the right file.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Pure, because this decides whether a machine runs an installer as SYSTEM without anybody
    /// present. The parts that can be reasoned about on a build server — is this version newer,
    /// does the policy allow it, does the hash match — are separated from the parts that cannot,
    /// which are the download and the Authenticode check.
    /// </para>
    /// <para>
    /// <b>The server has already applied most of the policy</b> — the update ring, the withdrawn
    /// flag, the minimum supported version — so these rules are a second opinion rather than the
    /// only one. That duplication is deliberate: the agent runs the installer, so the agent
    /// should be able to state its own reason for doing it.
    /// </para>
    /// </remarks>
    public static class UpdateRules
    {
        /// <summary>
        /// Compare two dotted version strings. Missing components count as zero.
        /// </summary>
        /// <remarks>
        /// So "1.3" and "1.3.0.0" are the same build, which matters because the assembly reports
        /// three components and the installer names four.
        /// </remarks>
        public static int Compare(string left, string right)
        {
            int[] a = Parse(left);
            int[] b = Parse(right);
            for (int index = 0; index < 4; index++)
            {
                if (a[index] != b[index]) return a[index] < b[index] ? -1 : 1;
            }
            return 0;
        }

        private static int[] Parse(string version)
        {
            var parts = new int[4];
            if (string.IsNullOrEmpty(version)) return parts;

            string[] pieces = version.Trim().Split('.');
            for (int index = 0; index < 4 && index < pieces.Length; index++)
            {
                int value;
                // A suffix like "1.3.0-beta" parses as far as it makes sense and no further.
                if (int.TryParse(pieces[index], NumberStyles.Integer, CultureInfo.InvariantCulture, out value)
                    && value >= 0)
                {
                    parts[index] = value;
                }
            }
            return parts;
        }

        /// <summary>
        /// Should this agent install what the server has offered it?
        /// </summary>
        /// <param name="current">This agent's own version.</param>
        /// <param name="offered">The server's answer, or null when there is nothing to install.</param>
        /// <param name="mandatory">
        /// The server's flag for a build below <c>minimumSupportedVersion</c>. A mandatory update
        /// overrides <paramref name="autoUpdateEnabled"/>, because that is what mandatory means:
        /// an installation that has switched auto-update off has not thereby opted out of a
        /// security fix. It is still recorded in the log as having overridden the policy.
        /// </param>
        public static UpdateDecision Evaluate(
            string current,
            AvailableVersion offered,
            bool mandatory,
            bool autoUpdateEnabled)
        {
            if (offered == null) return UpdateDecision.No("no update offered");
            if (string.IsNullOrEmpty(offered.Version)) return UpdateDecision.No("the offer has no version");

            if (Compare(offered.Version, current) <= 0)
            {
                return UpdateDecision.No("offered " + offered.Version + " is not newer than " + current);
            }

            // Both are required by the publish screen and re-checked by the version route; an
            // offer missing either has been tampered with between the two.
            if (string.IsNullOrEmpty(offered.PackageUrl)
                || !offered.PackageUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                return UpdateDecision.No("the package URL is missing or is not https");
            }

            if (!LooksLikeSha256(offered.PackageSha256))
            {
                return UpdateDecision.No("the offer carries no usable SHA-256");
            }

            if (!autoUpdateEnabled && !mandatory)
            {
                return UpdateDecision.No("automatic updates are switched off for this device");
            }

            return UpdateDecision.Yes(mandatory
                ? "mandatory update to " + offered.Version + ", overriding the auto-update policy"
                : "update to " + offered.Version);
        }

        /// <summary>A SHA-256 as the publish screen records it: 64 hexadecimal characters.</summary>
        public static bool LooksLikeSha256(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length != 64) return false;
            foreach (char character in value)
            {
                bool hex = (character >= '0' && character <= '9')
                    || (character >= 'a' && character <= 'f')
                    || (character >= 'A' && character <= 'F');
                if (!hex) return false;
            }
            return true;
        }

        /// <summary>
        /// Whether a downloaded file's hash is the one that was published.
        /// </summary>
        /// <remarks>
        /// Case-insensitive, because one of the two is typed by a human from a build log often
        /// enough that rejecting an upper-case hash would be rejecting the right file for the
        /// wrong reason. Compared in full — no prefix matching, ever.
        /// </remarks>
        public static bool HashMatches(string expected, string actual)
        {
            if (!LooksLikeSha256(expected) || !LooksLikeSha256(actual)) return false;
            return string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase);
        }
    }
}
