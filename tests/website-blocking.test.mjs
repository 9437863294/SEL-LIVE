import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCK_SINK_IPV4,
  BLOCK_SINK_IPV6,
  HOSTS_BLOCK_BEGIN,
  HOSTS_BLOCK_END,
  SOCIAL_MEDIA_DOMAINS,
  applyHostsBlock,
  describeWebBlockingPlan,
  hostIsBlocked,
  hostsFileEntries,
  hostsFileHasBlock,
  isProtectedDomain,
  normalizeBlockedDomain,
  normalizeBlockedDomains,
  resolveWebBlockingPlan,
} from '../src/lib/website-blocking.ts';
import { DEFAULT_AGENT_POLICY, resolveAgentPolicy, sanitizePolicySettings } from '../src/lib/windows-agent-policy.ts';

/* ── Normalising what somebody typed ───────────────────────────────────────────────────────── */

test('a pasted URL becomes the bare registrable host', () => {
  assert.equal(normalizeBlockedDomain('https://www.facebook.com/groups/12345?ref=share'), 'facebook.com');
  assert.equal(normalizeBlockedDomain('  HTTP://Instagram.COM/  '), 'instagram.com');
  assert.equal(normalizeBlockedDomain('facebook.com:443'), 'facebook.com');
  assert.equal(normalizeBlockedDomain('facebook.com.'), 'facebook.com');
  assert.equal(normalizeBlockedDomain('*.facebook.com'), 'facebook.com');
  assert.equal(normalizeBlockedDomain('user@facebook.com'), 'facebook.com');
});

test('a subdomain is kept, because blocking one host is a legitimate rule', () => {
  assert.equal(normalizeBlockedDomain('mail.google.com'), 'mail.google.com');
  assert.equal(normalizeBlockedDomain('web.whatsapp.com'), 'web.whatsapp.com');
});

test('what cannot be a domain is refused rather than stored as a rule that matches nothing', () => {
  // An IP address in the name column of a hosts file does nothing at all, so accepting one would
  // show an administrator an entry that never blocks anything.
  assert.equal(normalizeBlockedDomain('192.168.1.10'), null);
  assert.equal(normalizeBlockedDomain('localhost'), null);
  assert.equal(normalizeBlockedDomain('C:\\Users\\Ashish'), null);
  assert.equal(normalizeBlockedDomain('how to block facebook'), null);
  assert.equal(normalizeBlockedDomain('facebook'), null);
  assert.equal(normalizeBlockedDomain(''), null);
  assert.equal(normalizeBlockedDomain(null), null);
  assert.equal(normalizeBlockedDomain(42), null);
});

test('a list is de-duplicated across the forms of the same name', () => {
  assert.deepEqual(
    normalizeBlockedDomains(['facebook.com', 'www.facebook.com', 'https://facebook.com/x', 'FACEBOOK.COM']),
    ['facebook.com'],
  );
});

test('a list drops the bad entries and keeps the good ones', () => {
  assert.deepEqual(
    normalizeBlockedDomains(['tiktok.com', 'not a domain', '10.0.0.1', 'reddit.com']),
    ['reddit.com', 'tiktok.com'],
  );
  assert.deepEqual(normalizeBlockedDomains('facebook.com'), []);
});

/* ── Resolving a plan ──────────────────────────────────────────────────────────────────────── */

test('blocking off means nothing is enforced, whatever the lists say', () => {
  const plan = resolveWebBlockingPlan({
    websiteBlockingEnabled: false,
    blockSocialMediaSites: true,
    blockedDomains: ['facebook.com'],
  });
  assert.equal(plan.enabled, false);
  assert.deepEqual(plan.domains, []);
  assert.equal(describeWebBlockingPlan(plan), 'Website blocking is off on this computer.');
});

test('the built-in social list applies when it is switched on', () => {
  const plan = resolveWebBlockingPlan({
    websiteBlockingEnabled: true,
    blockSocialMediaSites: true,
    blockedDomains: [],
  });
  assert.equal(plan.enabled, true);
  assert.equal(plan.socialMediaBlocked, true);
  assert.equal(plan.domains.length, SOCIAL_MEDIA_DOMAINS.length);
  assert.ok(plan.domains.includes('facebook.com'));
  assert.ok(plan.domains.includes('instagram.com'));
});

test('custom domains are blocked without the built-in list', () => {
  const plan = resolveWebBlockingPlan({
    websiteBlockingEnabled: true,
    blockSocialMediaSites: false,
    blockedDomains: ['https://www.betfair.com/', 'dream11.com', 'dream11.com'],
  });
  assert.deepEqual(plan.domains, ['betfair.com', 'dream11.com']);
  assert.equal(plan.socialMediaBlocked, false);
  assert.equal(plan.customDomainCount, 2);
});

test('the allow list releases a name from the built-in list', () => {
  // The reason the built-in list is safe to ship: a team whose training material is on YouTube
  // releases the one name instead of abandoning the feature.
  const plan = resolveWebBlockingPlan({
    websiteBlockingEnabled: true,
    blockSocialMediaSites: true,
    allowedDomains: ['https://www.youtube.com/', 'linkedin.com'],
  });
  assert.ok(!plan.domains.includes('youtube.com'));
  assert.ok(!plan.domains.includes('linkedin.com'));
  assert.ok(plan.domains.includes('facebook.com'));
  assert.deepEqual(plan.allowedDomains, ['linkedin.com', 'youtube.com']);
});

test('the allow list wins over an explicit block, so the outcome never depends on read order', () => {
  const plan = resolveWebBlockingPlan({
    websiteBlockingEnabled: true,
    blockSocialMediaSites: false,
    blockedDomains: ['dream11.com'],
    allowedDomains: ['dream11.com'],
  });
  assert.deepEqual(plan.domains, []);
  assert.equal(plan.enabled, false);
});

test('blocking on with both sources empty enforces nothing rather than an empty region', () => {
  const plan = resolveWebBlockingPlan({
    websiteBlockingEnabled: true,
    blockSocialMediaSites: false,
    blockedDomains: [],
  });
  assert.equal(plan.enabled, false);
  assert.deepEqual(plan.domains, []);
});

test('the description names where the entries came from', () => {
  const plan = resolveWebBlockingPlan({
    websiteBlockingEnabled: true,
    blockSocialMediaSites: true,
    blockedDomains: ['dream11.com'],
    allowedDomains: ['youtube.com'],
  });
  const text = describeWebBlockingPlan(plan);
  assert.match(text, /built-in social-media list/);
  assert.match(text, /1 domain added by an administrator/);
  assert.match(text, /1 released by the allow list/);
});

/* ── The names that may never be blocked ───────────────────────────────────────────────────── */

test('a policy cannot blackhole what Windows or the ERP needs', () => {
  // One typo of the server host, enforced by a service nobody can stop, would leave a fleet that
  // can never be sent a correction — because the correction arrives over the blocked connection.
  const plan = resolveWebBlockingPlan({
    websiteBlockingEnabled: true,
    blockSocialMediaSites: false,
    blockedDomains: [
      'facebook.com',
      'windowsupdate.com',
      'www.microsoft.com',
      'digicert.com',
      'identitytoolkit.googleapis.com',
    ],
  });
  assert.deepEqual(plan.domains, ['facebook.com']);
  assert.deepEqual(plan.refusedDomains, [
    'digicert.com',
    'identitytoolkit.googleapis.com',
    'microsoft.com',
    'windowsupdate.com',
  ]);
});

test('a refusal is reported rather than silently dropped', () => {
  const plan = resolveWebBlockingPlan({
    websiteBlockingEnabled: true,
    blockSocialMediaSites: false,
    blockedDomains: ['microsoft.com'],
  });
  assert.equal(plan.enabled, false);
  assert.match(describeWebBlockingPlan(plan), /1 listed domain cannot be blocked/);
});

test('search is blockable — only what the agent depends on is protected', () => {
  const plan = resolveWebBlockingPlan({
    websiteBlockingEnabled: true,
    blockSocialMediaSites: false,
    blockedDomains: ['google.com'],
  });
  assert.deepEqual(plan.domains, ['google.com']);
  assert.deepEqual(plan.refusedDomains, []);
});

test('no name on the built-in social list is a protected one', () => {
  // Otherwise switching the list on would report refusals nobody asked for.
  for (const domain of SOCIAL_MEDIA_DOMAINS) {
    assert.equal(isProtectedDomain(domain), false, `${domain} is both blocked by default and protected`);
  }
});

/* ── Matching an observed host ─────────────────────────────────────────────────────────────── */

test('a blocked domain matches its own subdomains and nothing that merely ends alike', () => {
  const domains = ['facebook.com', 'x.com'];
  assert.equal(hostIsBlocked('facebook.com', domains), true);
  assert.equal(hostIsBlocked('web.facebook.com', domains), true);
  assert.equal(hostIsBlocked('FACEBOOK.COM.', domains), true);
  // The boundary has to be a label separator, or a rule for one company covers another whose
  // name happens to end the same way.
  assert.equal(hostIsBlocked('notfacebook.com', domains), false);
  assert.equal(hostIsBlocked('myx.com', domains), false);
  assert.equal(hostIsBlocked('facebook.com.evil.test', domains), false);
  assert.equal(hostIsBlocked('google.com', domains), false);
  assert.equal(hostIsBlocked('', domains), false);
  assert.equal(hostIsBlocked('facebook.com', []), false);
});

/* ── Writing the hosts file ────────────────────────────────────────────────────────────────── */

test('each domain is expanded because a hosts file has no wildcards', () => {
  const lines = hostsFileEntries(['facebook.com']);
  assert.ok(lines.includes(`${BLOCK_SINK_IPV4}\tfacebook.com`));
  assert.ok(lines.includes(`${BLOCK_SINK_IPV4}\twww.facebook.com`));
  assert.ok(lines.includes(`${BLOCK_SINK_IPV4}\tm.facebook.com`));
  // Both families: a v4-only entry blocks nothing on a dual-stack network.
  assert.ok(lines.includes(`${BLOCK_SINK_IPV6}\tfacebook.com`));
  assert.equal(lines.length, 10);
});

test('the site office keeps its own hosts entries', () => {
  // A site's hosts file routinely carries what makes an on-premise server reachable. Losing that
  // would take the site off the very ERP this agent reports to.
  const existing = '127.0.0.1\tlocalhost\r\n10.20.0.5\tsel-site-server\r\n';
  const written = applyHostsBlock(existing, ['facebook.com']);
  assert.match(written, /10\.20\.0\.5\tsel-site-server/);
  assert.match(written, /127\.0\.0\.1\tlocalhost/);
  assert.ok(written.includes(HOSTS_BLOCK_BEGIN));
  assert.ok(written.includes(HOSTS_BLOCK_END));
});

test('writing twice produces identical text, so the loop can write only on a change', () => {
  const existing = '127.0.0.1\tlocalhost\n';
  const once = applyHostsBlock(existing, ['facebook.com', 'x.com']);
  const twice = applyHostsBlock(once, ['facebook.com', 'x.com']);
  assert.equal(once, twice);
  // And the domain order in the plan does not change the file.
  assert.equal(applyHostsBlock(existing, ['x.com', 'facebook.com']), once);
});

test('a changed plan replaces the previous region rather than appending a second one', () => {
  const first = applyHostsBlock('127.0.0.1\tlocalhost\n', ['facebook.com']);
  const second = applyHostsBlock(first, ['x.com']);
  assert.equal(second.split(HOSTS_BLOCK_BEGIN).length - 1, 1);
  assert.ok(second.includes('\tx.com'));
  assert.ok(!second.includes('\tfacebook.com'));
});

test('an empty plan removes the region and leaves the rest of the file', () => {
  const blocked = applyHostsBlock('127.0.0.1\tlocalhost\n', ['facebook.com']);
  assert.equal(hostsFileHasBlock(blocked), true);
  const cleared = applyHostsBlock(blocked, []);
  assert.equal(hostsFileHasBlock(cleared), false);
  assert.equal(cleared, '127.0.0.1\tlocalhost\r\n');
});

test('a region truncated mid-write is repaired rather than kept forever', () => {
  const broken = `127.0.0.1\tlocalhost\r\n${HOSTS_BLOCK_BEGIN}\r\n0.0.0.0\tfacebook.c`;
  const repaired = applyHostsBlock(broken, ['x.com']);
  assert.ok(!repaired.includes('facebook.c'));
  assert.equal(repaired.split(HOSTS_BLOCK_BEGIN).length - 1, 1);
  assert.match(repaired, /127\.0\.0\.1\tlocalhost/);
});

test('the file is CRLF and ends with a newline', () => {
  const written = applyHostsBlock('', ['facebook.com']);
  assert.ok(written.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(written));
});

/* ── The policy plumbing ───────────────────────────────────────────────────────────────────── */

test('blocking ships off, with the social list ready for whoever switches it on', () => {
  assert.equal(DEFAULT_AGENT_POLICY.websiteBlockingEnabled, false);
  assert.equal(DEFAULT_AGENT_POLICY.blockSocialMediaSites, true);
  assert.deepEqual(DEFAULT_AGENT_POLICY.blockedDomains, []);
  assert.deepEqual(DEFAULT_AGENT_POLICY.allowedDomains, []);
  assert.equal(resolveWebBlockingPlan(DEFAULT_AGENT_POLICY).enabled, false);
});

test('a stored policy has its domains normalised on the way in', () => {
  const clean = sanitizePolicySettings({
    websiteBlockingEnabled: true,
    blockedDomains: ['https://WWW.Facebook.com/x', 'nonsense here', 'reddit.com'],
  });
  assert.deepEqual(clean.blockedDomains, ['facebook.com', 'reddit.com']);
});

test('a non-array domain list is dropped so a broader scope stays in force', () => {
  const clean = sanitizePolicySettings({ blockedDomains: 'facebook.com' });
  assert.equal('blockedDomains' in clean, false);
});

test('a huge paste is capped rather than turned into a four-thousand-line system file', () => {
  const many = Array.from({ length: 900 }, (_, index) => `site-${index}.example.com`);
  const clean = sanitizePolicySettings({ blockedDomains: many });
  assert.equal(clean.blockedDomains.length, 500);
});

test('a department policy overrides the company list rather than merging with it', () => {
  const resolved = resolveAgentPolicy(
    [
      {
        id: 'company',
        scopeKind: 'COMPANY',
        scopeId: null,
        scopeLabel: 'Company',
        enabled: true,
        settings: { websiteBlockingEnabled: true, blockSocialMediaSites: true, blockedDomains: ['dream11.com'] },
      },
      {
        id: 'dept-marketing',
        scopeKind: 'DEPARTMENT',
        scopeId: 'marketing',
        scopeLabel: 'Marketing',
        enabled: true,
        settings: { blockSocialMediaSites: false, blockedDomains: [] },
      },
    ],
    { userId: 'u1', deviceId: 'd1', departmentIds: ['marketing'] },
  );

  // Marketing needs the social networks it posts to, and says so by clearing both keys. The
  // company's master switch still applies; its domain list does not.
  assert.equal(resolved.settings.websiteBlockingEnabled, true);
  assert.equal(resolved.settings.blockSocialMediaSites, false);
  assert.deepEqual(resolved.settings.blockedDomains, []);
  assert.equal(resolved.sources.blockSocialMediaSites, 'DEPARTMENT');
  assert.equal(resolveWebBlockingPlan(resolved.settings).enabled, false);
});
