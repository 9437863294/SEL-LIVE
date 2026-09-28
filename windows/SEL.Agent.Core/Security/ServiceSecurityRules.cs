using System;

namespace Sel.Agent.Core.Security
{
    /// <summary>
    /// Who may stop the SEL LIVE service, expressed as the security descriptor Windows enforces.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Closing the agent needs a SEL LIVE administrator's approval, and so does removing it — but
    /// anybody who could open services.msc could press Stop and take the watchdog with it, which
    /// is a bigger hole than either: the service is what starts the agent at sign-in and what
    /// brings it back when somebody ends it from Task Manager. Stopping it leaves a PC recording
    /// nothing, with nothing left to notice.
    /// </para>
    /// <para>
    /// The fix is the service's own DACL. Windows checks <c>SERVICE_STOP</c> in the Service
    /// Control Manager, before any of this agent's code runs, so a Stop that the descriptor does
    /// not permit fails at the SCM with "Access is denied" whatever the process attempting it.
    /// That is real enforcement, not a dialog that can be dismissed.
    /// </para>
    ///
    /// <para><b>What the protected descriptor changes, and what it deliberately does not.</b></para>
    /// <list type="bullet">
    /// <item><description>
    /// <b>SYSTEM keeps everything.</b> The installer runs as SYSTEM, so uninstalling and upgrading
    /// still stop and remove the service normally, and the service can stop itself once an
    /// approval has been granted.
    /// </description></item>
    /// <item><description>
    /// <b>Administrators keep observation and start, but lose service mutation.</b> STOP, PAUSE,
    /// CHANGE_CONFIG, DELETE, WRITE_DAC and WRITE_OWNER remain SYSTEM-only. This prevents a
    /// temporary local support account from converting a bounded maintenance grant into a
    /// permanent disabled service. Signed upgrades and approved maintenance still run as SYSTEM.
    /// </description></item>
    /// <item><description>
    /// <b>Everyone keeps the right to look.</b> Query and interrogate are untouched, so the
    /// service's state is still visible to monitoring tools and to anybody diagnosing a PC.
    /// </description></item>
    /// </list>
    /// <para>
    /// The letters are SDDL's: CC query-config, DC change-config, LC query-status,
    /// SW enumerate-dependents, RP start, WP <b>stop</b>, DT pause/continue, LO interrogate,
    /// CR user-defined-control, SD delete, RC read-control, WD write-DAC, WO write-owner.
    /// </para>
    /// </remarks>
    public static class ServiceSecurityRules
    {
        /// <summary>SYSTEM: everything, including stop. The installer and the service itself.</summary>
        private const string SystemFull = "(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)";

        /// <summary>Administrators: observe and start; no lifecycle or descriptor mutation.</summary>
        private const string AdminsObserveAndStart = "(A;;CCLCSWRPLOCRRC;;;BA)";

        /// <summary>Administrators may stop, but cannot reconfigure, delete or rewrite the service.</summary>
        private const string AdminsObserveStartAndStop = "(A;;CCLCSWRPWPLOCRRC;;;BA)";

        /// <summary>Administrators may modify the service but SCM stop remains blocked.</summary>
        private const string AdminsFullWithoutStop = "(A;;CCDCLCSWRPDTLOCRSDRCWDWO;;;BA)";

        /// <summary>Administrators as Windows ships them: everything.</summary>
        private const string AdminsFull = "(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)";

        /// <summary>Interactive and service users: look, do not touch. Windows' own default.</summary>
        private const string ReadOnlyTrustees = "(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)";

        /// <summary>The descriptor the installer applies. Lifecycle mutation is SYSTEM-only.</summary>
        public static string ProtectedSddl()
        {
            return PolicySddl(true, true);
        }

        /// <summary>Descriptor for the two independently configured per-device controls.</summary>
        public static string PolicySddl(bool stopBlocked, bool serviceModificationBlocked)
        {
            string administrators = serviceModificationBlocked
                ? (stopBlocked ? AdminsObserveAndStart : AdminsObserveStartAndStop)
                : (stopBlocked ? AdminsFullWithoutStop : AdminsFull);
            return "D:" + SystemFull + administrators + ReadOnlyTrustees;
        }

        /// <summary>
        /// The stock descriptor, restored by the SYSTEM installer before approved removal.
        /// </summary>
        public static string DefaultSddl()
        {
            return "D:" + SystemFull + AdminsFull + ReadOnlyTrustees;
        }

        /// <summary>
        /// The rights letters a descriptor grants a trustee — <c>"BA"</c>, <c>"SY"</c> — or null.
        /// </summary>
        /// <remarks>
        /// Enough of an SDDL parser to answer one question: can this account stop the service?
        /// Used by the prerequisite check to report the state honestly, and by the tests, rather
        /// than comparing whole descriptor strings — Windows reorders and re-spells them, so a
        /// string comparison would report a protected service as unprotected after any edit.
        /// </remarks>
        public static string RightsFor(string sddl, string trustee)
        {
            if (string.IsNullOrEmpty(sddl) || string.IsNullOrEmpty(trustee)) return null;

            string needle = ";;;" + trustee.ToUpperInvariant() + ")";
            int end = sddl.ToUpperInvariant().IndexOf(needle, StringComparison.Ordinal);
            if (end < 0) return null;

            int open = sddl.LastIndexOf('(', end);
            if (open < 0) return null;

            // (A;;<rights>;;;<trustee>)
            string[] parts = sddl.Substring(open + 1, end - open - 1).Split(';');
            if (parts.Length < 3) return null;
            if (!string.Equals(parts[0], "A", StringComparison.OrdinalIgnoreCase)) return null;

            return parts[2];
        }

        /// <summary>Whether a descriptor lets this trustee stop the service.</summary>
        public static bool GrantsStop(string sddl, string trustee)
        {
            string rights = RightsFor(sddl, trustee);
            return rights != null && rights.ToUpperInvariant().Contains("WP");
        }

        /// <summary>Whether a trustee can alter, delete, pause, stop or rewrite the service ACL.</summary>
        public static bool GrantsModification(string sddl, string trustee)
        {
            string rights = RightsFor(sddl, trustee);
            if (rights == null) return false;
            string upper = rights.ToUpperInvariant();
            string[] dangerous = { "DC", "WP", "DT", "SD", "WD", "WO" };
            foreach (string right in dangerous)
            {
                if (upper.Contains(right)) return true;
            }
            return false;
        }

        /// <summary>Whether a trustee can mutate the service apart from stopping it.</summary>
        public static bool GrantsConfigurationModification(string sddl, string trustee)
        {
            string rights = RightsFor(sddl, trustee);
            if (rights == null) return false;
            string upper = rights.ToUpperInvariant();
            string[] dangerous = { "DC", "DT", "SD", "WD", "WO" };
            foreach (string right in dangerous)
            {
                if (upper.Contains(right)) return true;
            }
            return false;
        }

        public static bool MatchesPolicy(string sddl, bool stopBlocked, bool serviceModificationBlocked)
        {
            if (!GrantsStop(sddl, "SY") || !GrantsModification(sddl, "SY")) return false;
            return GrantsStop(sddl, "BA") != stopBlocked
                && GrantsConfigurationModification(sddl, "BA") != serviceModificationBlocked;
        }

        /// <summary>
        /// Whether the service is protected: administrators cannot stop it, SYSTEM still can.
        /// </summary>
        /// <remarks>
        /// Both halves matter. A descriptor that denied SYSTEM would leave a service that cannot
        /// be uninstalled or upgraded, which is a considerably worse problem than the one being
        /// solved, so the check reports that state as unprotected rather than as protected.
        /// </remarks>
        public static bool IsProtected(string sddl)
        {
            return MatchesPolicy(sddl, true, true);
        }
    }
}
