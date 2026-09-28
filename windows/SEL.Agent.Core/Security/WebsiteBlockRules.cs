using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Sel.Agent.Core.Security
{
    /// <summary>
    /// Turns a server-issued blocking plan into the text of a Windows hosts file, and back.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The C# half of <c>src/lib/website-blocking.ts</c>. Both sides are pure and both are tested
    /// against the same expectations, because the one thing that must not happen here is the
    /// server and the agent disagreeing about what a rule covers — a domain the policy screen
    /// shows as blocked and the hosts file never blocks is worse than no feature at all.
    /// </para>
    /// <para>
    /// <b>Nothing outside the managed region is touched.</b> A site office's hosts file routinely
    /// carries the entries that make an on-premise server or a licence dongle reachable. Rewriting
    /// the file wholesale would take that site off its own ERP, so the region between the two
    /// markers is replaced and every other byte is preserved.
    /// </para>
    /// <para>
    /// <b>Idempotent on purpose.</b> <see cref="ApplyBlock"/> called twice with the same plan
    /// returns identical text, which is what lets the enforcement loop compare before it writes.
    /// Without that, a five-minute loop would rewrite a system file 288 times a day, and every one
    /// of those writes is a chance to leave it truncated.
    /// </para>
    /// </remarks>
    public static class WebsiteBlockRules
    {
        public const string BlockBegin = "# BEGIN SEL LIVE website blocking - managed automatically, do not edit";
        public const string BlockEnd = "# END SEL LIVE website blocking";

        /// <summary>
        /// Unroutable rather than loopback: <c>127.0.0.1</c> means the request reaches whatever is
        /// listening locally, and makes the browser wait through a connection attempt first.
        /// </summary>
        public const string SinkIPv4 = "0.0.0.0";

        /// <summary>
        /// Emitted beside every IPv4 entry. Without it a dual-stack PC follows the AAAA record and
        /// reaches the site anyway, which is a silent hole on exactly the modern networks the head
        /// office runs.
        /// </summary>
        public const string SinkIPv6 = "::";

        /// <summary>
        /// A hosts file has no wildcards, so each domain is expanded with the prefixes that
        /// actually serve these sites. <c>facebook.com</c> alone leaves the mobile site reachable.
        /// </summary>
        private static readonly string[] HostPrefixes = { "www", "m", "web", "mobile" };

        /// <summary>
        /// Names this agent refuses to blackhole, whatever the server sends.
        /// </summary>
        /// <remarks>
        /// <para>
        /// The mirror of <c>PROTECTED_DOMAINS</c> in <c>website-blocking.ts</c>, and checked here
        /// as well on purpose. The server already filters them, so this is the second of two
        /// locks on the same door — and it is the one that matters, because the door it guards is
        /// the agent's own ability to be told anything ever again. A hosts entry for the SEL LIVE
        /// host, or for the certificate authority its TLS chains to, would be enforced by a
        /// service nobody can stop, on a machine that can no longer be sent a corrected policy.
        /// </para>
        /// <para>
        /// Windows Update and the connectivity-test names are here for a second reason: Defender
        /// classifies hosts entries for Microsoft names as <c>Win32/HostsFileHijack</c> and
        /// quarantines the file, which would take the entire managed region with it.
        /// </para>
        /// </remarks>
        private static readonly string[] ProtectedDomains =
        {
            "microsoft.com",
            "microsoftonline.com",
            "windows.com",
            "windows.net",
            "windowsupdate.com",
            "msftconnecttest.com",
            "msftncsi.com",
            "digicert.com",
            "verisign.com",
            "globalsign.com",
            "sectigo.com",
            "usertrust.com",
            "letsencrypt.org",
            "googleapis.com",
            "gstatic.com",
            "firebaseio.com",
            "firebaseapp.com",
        };

        private static readonly Regex DomainPattern = new Regex(
            @"^([a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        private static readonly Regex SchemePattern = new Regex(
            @"^[a-z][a-z0-9+.\-]*://", RegexOptions.Compiled | RegexOptions.CultureInvariant);

        /// <summary>
        /// Reduce whatever was configured to a bare host, or null if it cannot be one.
        /// </summary>
        /// <remarks>
        /// The server normalises before storing, so in practice this receives clean names. It runs
        /// anyway: the agent must not write an attacker-influenced or merely malformed string into
        /// a system file, and "trust the server's output" is not a property worth depending on for
        /// a file that decides where every name on the PC resolves.
        /// </remarks>
        public static string NormalizeDomain(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            string value = raw.Trim().ToLowerInvariant();

            value = SchemePattern.Replace(value, string.Empty);
            // Drop any credentials, then everything from the first path, query or fragment. The
            // order matters: the '@' has to be the one before the path, not one inside it.
            int firstSlash = value.IndexOfAny(new[] { '/', '?', '#' });
            int searchTo = (firstSlash >= 0 ? firstSlash : value.Length) - 1;
            int credentials = searchTo >= 0 ? value.LastIndexOf('@', searchTo) : -1;
            if (credentials >= 0) value = value.Substring(credentials + 1);
            firstSlash = value.IndexOfAny(new[] { '/', '?', '#' });
            if (firstSlash >= 0) value = value.Substring(0, firstSlash);
            if (value.StartsWith("[", StringComparison.Ordinal)) return null;
            int colon = value.LastIndexOf(':');
            if (colon > 0) value = value.Substring(0, colon);
            value = value.TrimEnd('.');
            if (value.StartsWith("*.", StringComparison.Ordinal)) value = value.Substring(2);
            if (value.StartsWith("www.", StringComparison.Ordinal)) value = value.Substring(4);

            if (value.Length == 0 || value.Length > 253) return null;
            // The pattern's final label is letters only, which is what rejects `192.168.1.10` and
            // `localhost`. Both are worth rejecting: an IP address in the *name* column of a hosts
            // file does nothing at all, so accepting one would show an administrator an entry that
            // never blocks anything.
            return DomainPattern.IsMatch(value) ? value : null;
        }

        /// <summary>
        /// Whether this name is one the machine or the agent needs, and so may not be blocked.
        /// </summary>
        /// <param name="domain">A name already reduced by <see cref="NormalizeDomain"/>.</param>
        /// <param name="alsoProtected">
        /// Names protected for this installation rather than universally — in practice the SEL
        /// LIVE server's own host, which is per-customer and so cannot be a constant here.
        /// </param>
        public static bool IsProtected(string domain, IEnumerable<string> alsoProtected = null)
        {
            if (string.IsNullOrEmpty(domain)) return false;
            if (Matches(domain, ProtectedDomains)) return true;
            return alsoProtected != null && Matches(domain, alsoProtected);
        }

        private static bool Matches(string domain, IEnumerable<string> rules)
        {
            foreach (string rule in rules)
            {
                if (string.IsNullOrEmpty(rule)) continue;
                string value = rule.Trim().ToLowerInvariant();
                if (domain == value) return true;
                if (domain.EndsWith("." + value, StringComparison.Ordinal)) return true;
            }
            return false;
        }

        /// <summary>
        /// Normalise, de-duplicate, drop the protected names, and sort a plan's domain list.
        /// </summary>
        public static List<string> NormalizeDomains(
            IEnumerable<string> domains, IEnumerable<string> alsoProtected = null)
        {
            var seen = new SortedSet<string>(StringComparer.Ordinal);
            if (domains != null)
            {
                foreach (string entry in domains)
                {
                    string domain = NormalizeDomain(entry);
                    if (domain == null || IsProtected(domain, alsoProtected)) continue;
                    seen.Add(domain);
                }
            }
            return seen.ToList();
        }

        /// <summary>Every host name one domain expands to, apex first.</summary>
        public static List<string> HostsForDomain(string domain)
        {
            var hosts = new List<string> { domain };
            foreach (string prefix in HostPrefixes) hosts.Add(prefix + "." + domain);
            return hosts;
        }

        /// <summary>
        /// The lines that go between the markers: one address and one name each.
        /// </summary>
        /// <remarks>
        /// More lines than the many-names-per-line form a hosts file also permits, and worth it —
        /// an administrator reading the file can see exactly which names are managed, and a diff
        /// between two syncs names the domain that changed.
        /// </remarks>
        public static List<string> Entries(
            IEnumerable<string> domains, IEnumerable<string> alsoProtected = null)
        {
            var lines = new List<string>();
            foreach (string domain in NormalizeDomains(domains, alsoProtected))
            {
                foreach (string host in HostsForDomain(domain))
                {
                    lines.Add(SinkIPv4 + "\t" + host);
                    lines.Add(SinkIPv6 + "\t" + host);
                }
            }
            return lines;
        }

        /// <summary>
        /// Put the managed region into an existing hosts file, replacing any previous one.
        /// </summary>
        /// <remarks>
        /// CRLF throughout: this file is read by the Windows resolver and edited with Notepad on
        /// machines old enough that Notepad still cannot display a lone LF.
        /// </remarks>
        public static string ApplyBlock(
            string existing, IEnumerable<string> domains, IEnumerable<string> alsoProtected = null)
        {
            var lines = new List<string>((existing ?? string.Empty).Split('\n'));
            for (int index = 0; index < lines.Count; index++) lines[index] = lines[index].TrimEnd('\r');

            int begin = lines.FindIndex(line => line.Trim() == BlockBegin);
            int end = lines.FindIndex(line => line.Trim() == BlockEnd);

            List<string> kept;
            if (begin >= 0 && end > begin)
            {
                kept = lines.Take(begin).Concat(lines.Skip(end + 1)).ToList();
            }
            else if (begin >= 0)
            {
                // A begin marker with no end: the file was truncated mid-write, by us or by a full
                // disk. Everything after it is ours and unfinished, so it goes.
                kept = lines.Take(begin).ToList();
            }
            else
            {
                kept = lines;
            }

            while (kept.Count > 0 && kept[kept.Count - 1].Trim().Length == 0) kept.RemoveAt(kept.Count - 1);

            List<string> entries = Entries(domains, alsoProtected);
            var output = new List<string>(kept);
            if (entries.Count > 0)
            {
                if (output.Count > 0) output.Add(string.Empty);
                output.Add(BlockBegin);
                output.AddRange(entries);
                output.Add(BlockEnd);
            }
            return string.Join("\r\n", output) + "\r\n";
        }

        /// <summary>Whether a hosts file currently carries a managed region.</summary>
        public static bool HasBlock(string existing)
        {
            if (string.IsNullOrEmpty(existing)) return false;
            return existing.Split('\n').Any(line => line.TrimEnd('\r').Trim() == BlockBegin);
        }

        /// <summary>
        /// Whether a host the agent observed is one this plan blocks.
        /// </summary>
        /// <remarks>
        /// This recognises a blocked <i>attempt</i>; it is not how blocking happens. By the time
        /// the address bar shows the name, the hosts file has already refused it. Suffix-aware at
        /// a label boundary, so <c>web.facebook.com</c> matches <c>facebook.com</c> while
        /// <c>notfacebook.com</c> does not.
        /// </remarks>
        public static bool IsBlocked(string host, IEnumerable<string> domains)
        {
            if (string.IsNullOrWhiteSpace(host) || domains == null) return false;
            string value = host.Trim().ToLowerInvariant().TrimEnd('.');
            if (value.Length == 0) return false;
            foreach (string domain in domains)
            {
                if (string.IsNullOrEmpty(domain)) continue;
                string rule = domain.Trim().ToLowerInvariant();
                if (rule.Length == 0) continue;
                if (value == rule) return true;
                if (value.EndsWith("." + rule, StringComparison.Ordinal)) return true;
            }
            return false;
        }
    }
}
