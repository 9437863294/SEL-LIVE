using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Security;

namespace Sel.Agent.Service
{
    /// <summary>
    /// Enforces the server's website-blocking plan through the Windows hosts file.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why this is in the service and not the tray.</b> The hosts file is writable only by
    /// administrators, and blocking that a standard user can lift is not blocking. Running here
    /// also means the list stays enforced on a PC where nobody has signed into SEL LIVE at all,
    /// and re-applied within one enforcement interval if somebody with local administrator rights
    /// edits the file back.
    /// </para>
    /// <para>
    /// <b>Why the hosts file rather than a proxy or an extension.</b> An extension blocks one
    /// browser, and the fleet runs four. A proxy would mean the agent sat in the path of every
    /// request employees make, which is precisely the capability this project is not allowed to
    /// acquire: §N rules out page contents, form fields and tokens, and the surest way to honour
    /// that is to never be able to see them. A list of names that resolve nowhere blocks sites
    /// without the agent observing a single byte of traffic.
    /// </para>
    /// <para>
    /// <b>The limits are real and are not hidden.</b> Name-based blocking does not stop a raw IP
    /// address, a VPN, or a browser resolving through its own DNS-over-HTTPS. It is a speed bump
    /// for casual distraction; the fleet report showing who kept trying is the part a manager acts
    /// on. Saying so here is cheaper than somebody discovering it and concluding the feature is
    /// broken.
    /// </para>
    /// </remarks>
    internal static class WebsiteBlocker
    {
        /// <summary>
        /// A one-time copy of the file as it was before SEL LIVE first touched it.
        /// </summary>
        /// <remarks>
        /// Written once and never overwritten, so it keeps the *original* rather than yesterday's
        /// managed version. If anything here ever goes wrong on a machine, an administrator has
        /// the file they started with sitting next to it, and does not need this software to
        /// recover their own PC.
        /// </remarks>
        private const string BackupFileName = "hosts.sel-live-backup";

        /// <summary>
        /// Where Windows keeps the file.
        /// </summary>
        /// <remarks>
        /// The agent is an x86 process, so <c>System32</c> would normally be redirected to
        /// <c>SysWOW64</c> by WOW64 — but <c>%windir%\System32\drivers\etc</c> is one of the
        /// directories Microsoft excludes from that redirection, so this resolves to the real file
        /// from a 32-bit process. The <c>Sysnative</c> fallback exists because that is a documented
        /// behaviour this code depends on rather than controls, and if it ever does not hold the
        /// agent should still find the file instead of silently enforcing nothing.
        /// </remarks>
        internal static string HostsPath()
        {
            string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string direct = Path.Combine(windows, "System32", "drivers", "etc", "hosts");
            if (File.Exists(direct)) return direct;
            string sysnative = Path.Combine(windows, "Sysnative", "drivers", "etc", "hosts");
            if (File.Exists(sysnative)) return sysnative;
            return direct;
        }

        /// <summary>
        /// Apply a plan, writing only when the resulting file would differ.
        /// </summary>
        /// <returns>True when the file was changed.</returns>
        /// <remarks>
        /// The comparison is the point. This runs on every enforcement pass — a minute apart by
        /// default — and a loop that wrote unconditionally would rewrite a system file over a
        /// thousand times a day, each one a chance to leave it truncated, and each one a reason
        /// for a backup product or an EDR agent to flag the machine.
        /// </remarks>
        internal static bool Apply(WebBlockingPlan plan, string serverHost, Action<string> log)
        {
            List<string> domains = plan != null && plan.Enabled && plan.Domains != null
                ? plan.Domains
                : new List<string>();
            return Write(domains, serverHost, log);
        }

        /// <summary>
        /// Remove the managed region entirely. Called when the agent is uninstalled.
        /// </summary>
        /// <remarks>
        /// Without this, removing the agent would leave every PC permanently unable to reach the
        /// blocked sites, with nothing on the machine that knew why — the same class of bug as
        /// Task Manager staying disabled after an uninstall, and worse to diagnose, because the
        /// symptom is "this one website is broken on this one computer".
        /// </remarks>
        internal static void Revert(Action<string> log)
        {
            try
            {
                if (Write(new List<string>(), null, log) && log != null)
                    log("Website blocking was removed from the hosts file.");
            }
            catch (Exception error)
            {
                // Reported, not thrown: a failure here must not stop an uninstall.
                if (log != null) log("Could not remove website blocking from the hosts file: " + error.Message);
            }
        }

        private static bool Write(List<string> domains, string serverHost, Action<string> log)
        {
            string path = HostsPath();
            string existing = string.Empty;
            try
            {
                if (File.Exists(path)) existing = File.ReadAllText(path, Encoding.Default);
            }
            catch (Exception error)
            {
                if (log != null) log("Could not read the hosts file: " + error.Message);
                return false;
            }

            List<string> alsoProtected = InstallationProtectedDomains(serverHost);
            string next = WebsiteBlockRules.ApplyBlock(existing, domains, alsoProtected);
            if (string.Equals(next, existing, StringComparison.Ordinal)) return false;

            try
            {
                BackupOnce(path, existing);
                // Encoding.Default — the system ANSI code page — rather than UTF-8. The Windows
                // resolver reads this file as ANSI, and a UTF-8 byte-order mark would put three
                // stray characters at the top of it. Reading and writing in the same encoding also
                // round-trips whatever non-ASCII an administrator already had in there.
                File.WriteAllText(path, next, Encoding.Default);
            }
            catch (Exception error)
            {
                if (log != null) log("Could not write the hosts file: " + error.Message);
                return false;
            }

            FlushDnsCache(log);
            if (log != null)
            {
                log(domains.Count > 0
                    ? "Website blocking updated: " + domains.Count + " domains are blocked on this computer."
                    : "Website blocking cleared from the hosts file.");
            }
            return true;
        }

        /// <summary>
        /// The names that are protected for this installation rather than universally.
        /// </summary>
        /// <remarks>
        /// The SEL LIVE server's own host, and its registrable parent. Blocking it would be
        /// unrecoverable remotely: the service would keep enforcing a list it could never be sent
        /// a correction for, because the correction arrives over the connection the list blocks.
        /// A customer's ERP name cannot be a constant in the code, so it is read from the same
        /// configuration the API client uses.
        /// </remarks>
        private static List<string> InstallationProtectedDomains(string serverHost)
        {
            var protectedNames = new List<string>();
            string host = WebsiteBlockRules.NormalizeDomain(serverHost);
            if (host == null) return protectedNames;
            protectedNames.Add(host);

            // `erp.seltech.store` also protects `seltech.store`: an administrator blocking the
            // bare company domain would take the ERP down just as effectively.
            string[] labels = host.Split('.');
            if (labels.Length > 2)
            {
                protectedNames.Add(string.Join(".", labels, labels.Length - 2, 2));
            }
            return protectedNames;
        }

        private static void BackupOnce(string hostsPath, string existing)
        {
            try
            {
                string directory = Path.GetDirectoryName(hostsPath);
                if (string.IsNullOrEmpty(directory)) return;
                string backup = Path.Combine(directory, BackupFileName);
                if (File.Exists(backup)) return;
                // Only if there is nothing of ours in it yet — otherwise the "original" would be
                // a file that already carried a managed region.
                if (WebsiteBlockRules.HasBlock(existing)) return;
                File.WriteAllText(backup, existing ?? string.Empty, Encoding.Default);
            }
            catch
            {
                // A missing backup is not worth failing enforcement over.
            }
        }

        /// <summary>
        /// Make the change take effect now rather than when the last cached answer expires.
        /// </summary>
        /// <remarks>
        /// The Windows DNS client caches resolved names, including the ones it read from the hosts
        /// file, so without this a site stays reachable for as long as its cached entry lives —
        /// and an administrator watching for the block to work concludes it does not. Chrome and
        /// Firefox keep small caches of their own that this cannot clear; those expire in about a
        /// minute, so the worst case is a short delay in one already-open browser.
        /// </remarks>
        private static void FlushDnsCache(Action<string> log)
        {
            try
            {
                var start = new ProcessStartInfo(
                    Path.Combine(Environment.SystemDirectory, "ipconfig.exe"), "/flushdns")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                using (Process process = Process.Start(start))
                {
                    if (process == null) return;
                    process.StandardOutput.ReadToEnd();
                    if (!process.WaitForExit(15000))
                    {
                        try { process.Kill(); } catch { }
                    }
                }
            }
            catch (Exception error)
            {
                // The hosts file is already written; a stale cache resolves itself within minutes.
                if (log != null) log("Could not flush the DNS cache: " + error.Message);
            }
        }
    }
}
