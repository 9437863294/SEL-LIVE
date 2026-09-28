/**
 * Website and social-media blocking for the Windows Agent (§N, §14).
 *
 * Pure and dependency-free, like `windows-agent-policy.ts`: the security-sync route builds a plan
 * on every service poll, the policy screen previews one, and `node --test` builds hundreds without
 * touching Firestore or a Windows machine. `WebsiteBlockRules.cs` in the agent mirrors every rule
 * here, and the two are checked against the same expectations on both sides.
 *
 * ── Why the hosts file, and not a browser extension ───────────────────────────────────────────
 *
 * A managed extension blocks one browser. The fleet runs Chrome, Edge, Firefox and — on older
 * site machines — Internet Explorer, and a person who wants Facebook at 3pm only needs to open a
 * browser nobody deployed the extension to. Portable Chrome on a USB stick defeats it entirely.
 *
 * `%SystemRoot%\System32\drivers\etc\hosts` is below all of that. Every browser, every HTTP
 * client and every app on the PC resolves names through it, so one enforcement point covers the
 * machine — and it needs no interception, no proxy, no certificate of ours in anybody's trust
 * store, and no ability to see traffic. That last point matters: the agent never becomes a thing
 * that *can* read what people browse in order to block some of it. It writes a list of names that
 * resolve nowhere and that is the entire mechanism.
 *
 * The honest limits, stated rather than discovered later:
 *
 *  - **It is name-based.** Somebody who types a raw IP address, or uses a VPN or a DNS-over-HTTPS
 *    resolver their browser ships with, is not stopped. Blocking is a speed bump for casual
 *    distraction, not a security control against a determined person — and the fleet report shows
 *    who kept trying, which is the part that actually gets dealt with by a manager.
 *  - **There are no wildcards.** A hosts file matches whole names, so `facebook.com` does not
 *    cover `m.facebook.com`. {@link hostsFileEntries} expands the common prefixes for that reason.
 *  - **It is machine-wide.** One hosts file serves every account on the PC, so this cannot vary
 *    by who is signed in. The plan is therefore resolved for the *device* — company, the device's
 *    department, and the device itself — and never for a user, because a per-user setting here
 *    would be a promise the mechanism cannot keep.
 */

import type { AgentPolicySettings, WebBlockingPlan } from './windows-agent-model.ts';

export type { WebBlockingPlan };

/* ------------------------------------------------------------------------------------------------
 * The managed region of the hosts file
 * ---------------------------------------------------------------------------------------------- */

/**
 * Markers around the block the agent owns.
 *
 * Everything outside them is left byte-for-byte alone, which is not a nicety: a site office's
 * hosts file routinely carries the entries that make an on-premise server or a licence dongle
 * reachable, and an agent that rewrote the file wholesale would take that site off its own ERP.
 * The text says "do not edit" because a hand-made change inside the region is overwritten on the
 * next sync, and somebody should find that out from the file rather than from a mystery.
 */
export const HOSTS_BLOCK_BEGIN = '# BEGIN SEL LIVE website blocking - managed automatically, do not edit';
export const HOSTS_BLOCK_END = '# END SEL LIVE website blocking';

/**
 * Where a blocked name resolves to.
 *
 * `0.0.0.0` rather than `127.0.0.1`: a loopback address means the request reaches whatever is
 * listening locally — on a developer's PC that is often a web server, which answers with the
 * wrong site instead of failing — and it makes the browser wait through a connection attempt.
 * `0.0.0.0` is unroutable, so the failure is immediate and unambiguous.
 */
export const BLOCK_SINK_IPV4 = '0.0.0.0';

/**
 * The IPv6 sink, emitted alongside every IPv4 entry.
 *
 * Skipping it is a silent hole: on a dual-stack network a browser that gets no usable A record
 * happily follows the AAAA record, so a v4-only hosts entry blocks nothing on exactly the modern
 * networks the head office runs.
 */
export const BLOCK_SINK_IPV6 = '::';

/**
 * Host prefixes each blocked domain is expanded with.
 *
 * A hosts file has no wildcards, and `facebook.com` alone is close to useless — the mobile site,
 * the `www` host and Instagram's `web.` host all resolve separately. These are the prefixes that
 * actually serve the sites in this list; guessing further would bloat the file for nothing.
 */
export const BLOCKED_HOST_PREFIXES: readonly string[] = ['www', 'm', 'web', 'mobile'];

/* ------------------------------------------------------------------------------------------------
 * The built-in social-media list
 * ---------------------------------------------------------------------------------------------- */

/**
 * The social-media sites `blockSocialMediaSites` covers.
 *
 * Kept here rather than seeded into a Firestore document so that it improves with the software:
 * a site that becomes popular next year is added in one place and reaches the fleet through the
 * ordinary update, instead of every installation maintaining its own list.
 *
 * `youtube.com` is in it deliberately, and is the one entry most likely to be wrong for a given
 * team — training material lives there. That is what {@link AgentPolicySettings.allowedDomains}
 * is for: releasing one name from the list is a setting, not a code change, and the policy screen
 * says so next to the switch.
 */
export const SOCIAL_MEDIA_DOMAINS: readonly string[] = [
  'facebook.com',
  'fb.com',
  'fb.watch',
  'messenger.com',
  'instagram.com',
  'threads.net',
  'twitter.com',
  'x.com',
  't.co',
  'tiktok.com',
  'snapchat.com',
  'reddit.com',
  'pinterest.com',
  'tumblr.com',
  'linkedin.com',
  'quora.com',
  'discord.com',
  'discord.gg',
  'twitch.tv',
  'youtube.com',
  'youtu.be',
  'vk.com',
  'weibo.com',
  'sharechat.com',
  'moj.video',
  'kooapp.com',
  '9gag.com',
  'imgur.com',
];

/* ------------------------------------------------------------------------------------------------
 * The names that may never be blocked
 * ---------------------------------------------------------------------------------------------- */

/**
 * Domains this feature refuses to blackhole, whatever a policy says.
 *
 * ── The failure this prevents ──────────────────────────────────────────────────────────────────
 *
 * A hosts entry is machine-wide and enforced by a service the user cannot stop, so an
 * administrator who types the wrong name does not get an error — they get a fleet that can no
 * longer reach the thing they broke, *including* the agent's own channel for being told to stop.
 * One typo of the SEL LIVE host and every PC keeps enforcing a list that can never be revised
 * again, because the revision arrives over the connection the list is blocking. That is not a
 * mistake worth allowing to be made, so the resolver drops these and says which it dropped.
 *
 * ── Why each of these ──────────────────────────────────────────────────────────────────────────
 *
 *  - **Microsoft and Windows Update.** A PC that cannot reach Windows Update stops receiving
 *    security patches, and blocking the connectivity-test names makes Windows report itself as
 *    offline to every application on the machine. Defender also classifies hosts entries for
 *    Microsoft names as `Win32/HostsFileHijack` and will quarantine the file, which would take
 *    the whole managed region with it.
 *  - **Certificate authorities.** Revocation and timestamp checks run against these. Blocking
 *    them makes signature verification — including the agent's own update verification — fail or
 *    hang, which is the one code path that must stay trustworthy.
 *  - **Google APIs and Firebase.** SEL LIVE's authentication is Firebase; `googleapis.com` is
 *    how a sign-in happens at all. Blocking it locks every employee out of the ERP. Note that
 *    `google.com` is deliberately *not* here: nobody needs the search page for the agent to work,
 *    so an installation that wants it blocked may block it.
 *
 * The SEL LIVE server's own host is not in this list because it is per-installation. The agent
 * adds it locally from its own configuration — see `WebsiteBlocker` — which also covers a
 * customer whose ERP lives on a name this file has never heard of.
 */
export const PROTECTED_DOMAINS: readonly string[] = [
  'microsoft.com',
  'microsoftonline.com',
  'windows.com',
  'windows.net',
  'windowsupdate.com',
  'msftconnecttest.com',
  'msftncsi.com',
  'digicert.com',
  'verisign.com',
  'globalsign.com',
  'sectigo.com',
  'usertrust.com',
  'letsencrypt.org',
  'googleapis.com',
  'gstatic.com',
  'firebaseio.com',
  'firebaseapp.com',
];

/** Whether this name is one the machine or the agent needs, and so may not be blocked. */
export function isProtectedDomain(domain: string): boolean {
  return PROTECTED_DOMAINS.some(
    (protectedDomain) => domain === protectedDomain || domain.endsWith(`.${protectedDomain}`),
  );
}

/* ------------------------------------------------------------------------------------------------
 * Normalising what an administrator typed
 * ---------------------------------------------------------------------------------------------- */

/**
 * A domain must look like this to be accepted.
 *
 * Labels of letters, digits and hyphens, at least two of them, and a final label that is not
 * numeric — which rejects `192.168.1.10`. That rejection is on purpose: an IP address in the
 * hosts file's *name* column does nothing at all, so accepting one would show an administrator a
 * blocked entry that never blocks anything.
 */
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Reduce whatever was typed to a bare registrable host, or null if it cannot be one.
 *
 * Administrators paste URLs, because that is what is in the address bar. `https://www.facebook.com/groups/x`
 * has to become `facebook.com`, and anything that cannot — a search phrase, a file path, an IP —
 * has to be refused rather than stored as a rule that quietly matches nothing.
 *
 * `www.` is stripped because the prefix expansion adds it back. Storing both `www.facebook.com`
 * and `facebook.com` would otherwise produce a list where removing the obvious entry leaves the
 * site still blocked by the other one.
 */
export function normalizeBlockedDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim().toLowerCase();
  if (!value) return null;

  // A pasted URL: drop the scheme, then everything from the first path, query or fragment.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.replace(/^[^/?#]*@/, '');
  value = value.split(/[/?#]/)[0] ?? '';
  // A port, an IPv6 literal in brackets, a trailing root dot, a leading wildcard.
  value = value.replace(/^\[.*$/, '');
  value = value.replace(/:\d+$/, '');
  value = value.replace(/\.+$/, '');
  value = value.replace(/^\*\./, '');
  value = value.replace(/^www\./, '');
  if (!value || !DOMAIN_PATTERN.test(value)) return null;
  return value;
}

/** Normalise a list, dropping what cannot be a domain, de-duplicating, and sorting. */
export function normalizeBlockedDomains(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const domain = normalizeBlockedDomain(entry);
    if (domain) seen.add(domain);
  }
  return [...seen].sort();
}

/* ------------------------------------------------------------------------------------------------
 * The plan the service enforces
 * ---------------------------------------------------------------------------------------------- */

/** The plan for a PC with no policy — blocking off, nothing written. */
export function emptyWebBlockingPlan(): WebBlockingPlan {
  return {
    enabled: false,
    domains: [],
    socialMediaBlocked: false,
    customDomainCount: 0,
    allowedDomains: [],
    refusedDomains: [],
  };
}

/**
 * Turn resolved policy settings into the list a PC should enforce.
 *
 * The allow list is applied last and wins over both sources. That ordering is what makes "block
 * social media, except YouTube" expressible, and it means an administrator can never construct a
 * configuration where a name appears in both lists and the outcome depends on which was read
 * first.
 */
export function resolveWebBlockingPlan(
  settings: Pick<
    AgentPolicySettings,
    'websiteBlockingEnabled' | 'blockSocialMediaSites' | 'blockedDomains' | 'allowedDomains'
  > | null
  | undefined,
): WebBlockingPlan {
  if (!settings || settings.websiteBlockingEnabled !== true) return emptyWebBlockingPlan();

  const allowed = normalizeBlockedDomains(settings.allowedDomains);
  const allowSet = new Set(allowed);
  const custom = normalizeBlockedDomains(settings.blockedDomains);
  const social = settings.blockSocialMediaSites === true ? [...SOCIAL_MEDIA_DOMAINS] : [];

  const effective = new Set<string>();
  const refused = new Set<string>();
  for (const domain of [...social, ...custom]) {
    if (allowSet.has(domain)) continue;
    if (isProtectedDomain(domain)) {
      refused.add(domain);
      continue;
    }
    effective.add(domain);
  }

  return {
    enabled: effective.size > 0,
    domains: [...effective].sort(),
    socialMediaBlocked: social.length > 0,
    customDomainCount: custom.length,
    allowedDomains: allowed,
    refusedDomains: [...refused].sort(),
  };
}

/**
 * Whether a host the agent observed is one this plan blocks.
 *
 * Suffix-aware, so `web.facebook.com` matches the rule `facebook.com` while `notfacebook.com`
 * does not — the boundary has to be a label separator or a rule for one company would silently
 * cover another whose name happens to end the same way.
 *
 * This is how a *blocked attempt* is recognised, not how blocking happens: the hosts file has
 * already refused the name by the time the agent sees it in the address bar. The agent reports
 * the host and nothing else, exactly as ordinary domain tracking does — §N's ban on paths,
 * queries and page contents is not relaxed because a name was on a list.
 */
export function hostIsBlocked(host: unknown, domains: readonly string[]): boolean {
  if (typeof host !== 'string' || domains.length === 0) return false;
  const value = host.trim().toLowerCase().replace(/\.+$/, '');
  if (!value) return false;
  return domains.some((domain) => value === domain || value.endsWith(`.${domain}`));
}

/* ------------------------------------------------------------------------------------------------
 * Rendering the hosts file
 * ---------------------------------------------------------------------------------------------- */

/** Every host name one domain expands to, apex first. */
export function hostsForDomain(domain: string): string[] {
  const hosts = [domain];
  for (const prefix of BLOCKED_HOST_PREFIXES) hosts.push(`${prefix}.${domain}`);
  return hosts;
}

/**
 * The lines that go between the markers.
 *
 * One address and one name per line, rather than the many-names-per-line form a hosts file also
 * permits. It is more lines, and it is worth it: an administrator reading the file can see
 * exactly which names are managed, and a diff between two syncs names the domain that changed.
 */
export function hostsFileEntries(domains: readonly string[]): string[] {
  const lines: string[] = [];
  for (const domain of [...domains].sort()) {
    for (const host of hostsForDomain(domain)) {
      lines.push(`${BLOCK_SINK_IPV4}\t${host}`);
      lines.push(`${BLOCK_SINK_IPV6}\t${host}`);
    }
  }
  return lines;
}

/**
 * Put the managed region into an existing hosts file, replacing any previous one.
 *
 * Idempotent by construction — running it twice with the same plan returns identical text — which
 * is what lets the service call it on every enforcement pass and only write when the result
 * differs. Without that, a five-minute loop would rewrite a system file 288 times a day and every
 * one of those writes is a chance to corrupt it.
 *
 * CRLF throughout, because this file is read by the Windows resolver and edited by Notepad on
 * machines old enough that Notepad still cannot display a lone LF.
 */
export function applyHostsBlock(existing: string, domains: readonly string[]): string {
  const lines = (existing ?? '').split(/\r?\n/);
  const begin = lines.findIndex((line) => line.trim() === HOSTS_BLOCK_BEGIN);
  const end = lines.findIndex((line) => line.trim() === HOSTS_BLOCK_END);

  let kept: string[];
  if (begin >= 0 && end > begin) {
    kept = [...lines.slice(0, begin), ...lines.slice(end + 1)];
  } else if (begin >= 0) {
    // A begin marker with no end: the file was truncated mid-write, by us or by a disk full.
    // Everything after it is ours and unfinished, so it goes rather than being kept forever.
    kept = lines.slice(0, begin);
  } else {
    kept = [...lines];
  }

  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

  const entries = hostsFileEntries(domains);
  const out = [...kept];
  if (entries.length > 0) {
    if (out.length > 0) out.push('');
    out.push(HOSTS_BLOCK_BEGIN, ...entries, HOSTS_BLOCK_END);
  }
  return `${out.join('\r\n')}\r\n`;
}

/** Whether a hosts file currently carries a managed region. */
export function hostsFileHasBlock(existing: string): boolean {
  return (existing ?? '').split(/\r?\n/).some((line) => line.trim() === HOSTS_BLOCK_BEGIN);
}

/**
 * A sentence for the device page and the agent's own log.
 *
 * Says what is blocked and where it came from, because "23 domains blocked" answers the wrong
 * question — an administrator looking at this wants to know whether their department policy or
 * the built-in list is responsible for the entry somebody is complaining about.
 */
export function describeWebBlockingPlan(plan: WebBlockingPlan): string {
  if (!plan.enabled || plan.domains.length === 0) {
    return plan.refusedDomains.length > 0
      ? `Website blocking is off on this computer. ${plan.refusedDomains.length} listed ${plan.refusedDomains.length === 1 ? 'domain' : 'domains'} cannot be blocked because Windows or SEL LIVE needs ${plan.refusedDomains.length === 1 ? 'it' : 'them'}.`
      : 'Website blocking is off on this computer.';
  }
  const parts: string[] = [];
  if (plan.socialMediaBlocked) parts.push('the built-in social-media list');
  if (plan.customDomainCount > 0) {
    parts.push(`${plan.customDomainCount} ${plan.customDomainCount === 1 ? 'domain' : 'domains'} added by an administrator`);
  }
  const source = parts.length > 0 ? parts.join(' and ') : 'the assigned policy';
  const released = plan.allowedDomains.length > 0
    ? `, with ${plan.allowedDomains.length} released by the allow list`
    : '';
  const refused = plan.refusedDomains.length > 0
    ? ` ${plan.refusedDomains.join(', ')} cannot be blocked because Windows or SEL LIVE needs ${plan.refusedDomains.length === 1 ? 'it' : 'them'}.`
    : '';
  return `${plan.domains.length} ${plan.domains.length === 1 ? 'domain is' : 'domains are'} blocked from ${source}${released}.${refused}`;
}
