import { safeBrowsingKey } from '@/lib/mail-hub/config';
import { mailRoute } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';

/**
 * What the link interstitial (`/mail/link`) shows before leaving the ERP: the real host, heuristic
 * warnings, and — when `MAIL_HUB_SAFE_BROWSING_KEY` is set — Google Safe Browsing's verdict.
 * The ERP never fetches the URL itself; checking a link must not become a way to make the server
 * request arbitrary addresses.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute(
  'link-check',
  async ({ url }) => {
    const raw = url.searchParams.get('u') ?? '';
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      throw new MailHubError('That is not a valid link.', 400);
    }
    if (!['http:', 'https:'].includes(target.protocol)) throw new MailHubError('Only web links can be opened.', 400);

    const host = target.hostname.toLowerCase();
    const warnings: string[] = [];
    if (target.protocol === 'http:') warnings.push('The connection is not encrypted (http).');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) warnings.push('The link goes to a bare IP address rather than a named website.');
    if (host.split('.').some((label) => label.startsWith('xn--'))) warnings.push('The address uses international characters that can imitate another site’s name.');
    if (target.username || target.password) warnings.push('The link hides a different destination behind an “@”.');
    if (host.length > 60 || host.split('.').length > 5) warnings.push('The site name is unusually long.');
    if (url.searchParams.get('w') === 'text-mismatch') warnings.push('The text of the link showed a different website than the one it opens.');

    let verdict: 'safe' | 'unsafe' | 'unknown' = 'unknown';
    const threats: string[] = [];
    const key = safeBrowsingKey();
    if (key) {
      const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'sel-live-erp', clientVersion: '1.0' },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: target.toString() }],
          },
        }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null);
      if (response?.ok) {
        const json = (await response.json().catch(() => ({}))) as { matches?: { threatType: string }[] };
        verdict = json.matches?.length ? 'unsafe' : 'safe';
        threats.push(...(json.matches ?? []).map((match) => match.threatType));
      }
    }
    return { url: target.toString(), host, warnings, verdict, threats, checkedWithSafeBrowsing: Boolean(key) };
  },
  { requireModule: false },
);
