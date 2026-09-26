/**
 * Shapes and pure helpers shared by `GET /api/profile/activity` and `RecentActivityCard`.
 *
 * No imports on purpose: the route runs on the server with the Admin SDK and the card runs in the
 * browser, and both need the same row shape. Everything here is a plain function over strings, so it
 * is safe on either side.
 */

/** One row of the caller's own audit trail, reduced to what is safe to show them. */
export interface ProfileActivityRow {
  id: string;
  /** Canonical module name (legacy spellings already resolved). */
  module: string;
  action: string;
  /** ISO timestamp, or null for a row written without one. */
  at: string | null;
  /** 'user' for browser-written rows; 'server' | 'api' | 'cron' | 'webhook' for server-written ones. */
  source: ProfileActivitySource;
  /** Short device summary such as "Chrome on Windows", or null when unknown. */
  device: string | null;
  /** Masked address such as "203.0.113.x", or null when none was recorded. */
  ipAddress: string | null;
  /** The record's human-readable reference (a PO or vehicle number), when the row has one. */
  summary: string | null;
}

export type ProfileActivitySource = 'user' | 'server' | 'api' | 'cron' | 'webhook';

export interface ProfileActivityResponse {
  rows: ProfileActivityRow[];
  /** Pass back as `?cursor=` for the next page; null when there is nothing older. */
  nextCursor: string | null;
  /**
   * True when the server could not use the (userId, timestamp) index and sorted a bounded sample in
   * memory instead — the order is right within the sample, but older rows may be missing.
   */
  approximate: boolean;
}

export const PROFILE_ACTIVITY_DEFAULT_LIMIT = 15;
export const PROFILE_ACTIVITY_MAX_LIMIT = 50;

const SOURCES: readonly ProfileActivitySource[] = ['user', 'server', 'api', 'cron', 'webhook'];

/** Browser-written rows carry no `source`; anything unrecognised is reported as a server write. */
export function normalizeActivitySource(value: unknown): ProfileActivitySource {
  if (value === null || value === undefined || value === '') return 'user';
  return SOURCES.includes(value as ProfileActivitySource) ? (value as ProfileActivitySource) : 'server';
}

/** Trim, collapse whitespace, strip control characters and cap the length of a display string. */
export function clipText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/* ── device ──────────────────────────────────────────────────────────────────────────────────── */

/** Order matters: Edge, Opera and Samsung Internet all also claim to be Chrome and Safari. */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\/|\bChromium\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bWindows\b/, 'Windows'],
  [/\biPad\b/, 'iPadOS'],
  [/\biPhone\b|\biPod\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/**
 * "Chrome on Windows", "Safari on iOS", "Android app" — enough for someone to recognise their own
 * devices, without echoing the raw header (which is long and fingerprint-grade).
 */
export function summarizeUserAgent(userAgent: unknown): string | null {
  if (typeof userAgent !== 'string') return null;
  const ua = userAgent.trim();
  if (!ua) return null;

  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  // An Android WebView (the native shell) marks itself with "; wv)".
  if (system === 'Android' && /;\s*wv\)/.test(ua)) return 'Android app';

  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return browser;
  if (system) return system;

  // Not a browser at all — a script, an agent or an HTTP library. Its first product token is
  // recognisable ("curl", "node") and short; anything else is not worth showing.
  const product = /^([A-Za-z][A-Za-z0-9._-]{1,30})(?:\/|\s|$)/.exec(ua)?.[1];
  return product ?? null;
}

/* ── IP address ──────────────────────────────────────────────────────────────────────────────── */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function maskIpv4(value: string): string | null {
  const match = IPV4.exec(value);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.x`;
}

/** Expand "2001:db8::1" to its eight hextets, or null when it is not an IPv6 address. */
function ipv6Groups(value: string): string[] | null {
  if (!/^[0-9a-f:]+$/i.test(value) || !value.includes(':')) return null;
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...head, ...tail].some((group) => group.length === 0 || group.length > 4)) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array.from({ length: missing }, () => '0'), ...tail].map((group) =>
    group.toLowerCase().replace(/^0+(?=.)/, ''),
  );
}

/**
 * "203.0.113.47" → "203.0.113.x"; IPv6 keeps its /48 prefix ("2001:db8:85a3:…"). Enough to tell
 * home from office from an unfamiliar network, not enough to pinpoint anyone. Anything that does not
 * parse as an address is dropped rather than echoed back.
 */
export function maskIpAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // x-forwarded-for style lists: the first entry is the client.
  let address = value.split(',')[0]?.trim() ?? '';
  if (!address) return null;

  // "[2001:db8::1]:443" and "203.0.113.47:5678" carry a port; "fe80::1%eth0" a zone.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (bracketed) address = bracketed[1];
  else if (/^[\d.]+:\d+$/.test(address)) address = address.slice(0, address.lastIndexOf(':'));
  address = address.replace(/%.*$/, '');

  const v4 = maskIpv4(address);
  if (v4) return v4;

  // IPv4-mapped IPv6 ("::ffff:203.0.113.47") is really an IPv4 client.
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return maskIpv4(mapped[1]);

  const groups = ipv6Groups(address);
  if (!groups) return null;
  return `${groups.slice(0, 3).join(':')}:…`;
}

/* ── cursor ──────────────────────────────────────────────────────────────────────────────────── */

export interface ActivityCursor {
  seconds: number;
  nanoseconds: number;
  /** Tie-breaker for rows sharing a timestamp; absent when the caller passed a bare ISO time. */
  id: string | null;
}

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z(?:~([A-Za-z0-9_-]{1,128}))?$/;

/**
 * An ISO time at full Firestore precision plus the row id: "2026-09-26T10:15:02.123456000Z~AbC…".
 * Millisecond ISO alone would skip rows whose server timestamps differ only in the microseconds.
 */
export function encodeActivityCursor(cursor: ActivityCursor): string {
  const base = new Date(cursor.seconds * 1000).toISOString().slice(0, 19);
  const fraction = String(cursor.nanoseconds).padStart(9, '0');
  return `${base}.${fraction}Z${cursor.id ? `~${cursor.id}` : ''}`;
}

/** Accepts what `encodeActivityCursor` produces and any plain UTC ISO time. Null when malformed. */
export function decodeActivityCursor(value: string | null | undefined): ActivityCursor | null {
  if (!value) return null;
  const match = CURSOR.exec(value.trim());
  if (!match) return null;
  const millis = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(millis)) return null;
  return {
    seconds: Math.floor(millis / 1000),
    nanoseconds: Number((match[2] ?? '').padEnd(9, '0')),
    id: match[3] ?? null,
  };
}

/** Newest first, ties broken by id descending — the same order the Firestore query uses. */
export function compareActivityDesc(
  a: { seconds: number; nanoseconds: number; id: string },
  b: { seconds: number; nanoseconds: number; id: string },
): number {
  if (a.seconds !== b.seconds) return b.seconds - a.seconds;
  if (a.nanoseconds !== b.nanoseconds) return b.nanoseconds - a.nanoseconds;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
