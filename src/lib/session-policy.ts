/**
 * Session policy — the rules the session controller enforces, and the pure decisions built on them.
 *
 * No Firebase imports: the same functions run in the browser (AuthProvider, the Sessions screen),
 * in the `/api/session/control` route, and under `node --test`.
 *
 * Stored at `settings/sessionPolicy`, written only by the API route. Every field has a default that
 * reproduces the behaviour from before the policy existed — except `keepAppSignedIn`, which is on by
 * default: the installed mobile app signing people out for inactivity was the complaint it answers.
 */

export const SESSION_POLICY_DOC = { collection: 'settings', id: 'sessionPolicy' } as const;

/** Where a session runs: the installed SEL mobile app (Capacitor), or any web browser. */
export type SessionClient = 'app' | 'browser';

/** The two pools session limits are counted in. Phones and tablets — app or browser — are `mobile`. */
export type SessionDeviceClass = 'desktop' | 'mobile';

export const DEVICE_CLASS_LABEL: Record<SessionDeviceClass, string> = {
  desktop: 'Desktop',
  mobile: 'Phone & tablet',
};

export interface SessionPolicy {
  /**
   * Most desktop sessions one user may hold at once. 0 = unlimited. The least recently active are
   * signed out first. Counted apart from phones, so signing in at a desk never ends a phone session.
   */
  maxDesktopSessions: number;
  /** Most phone and tablet sessions (app or browser) one user may hold at once. 0 = unlimited. */
  maxMobileSessions: number;
  /**
   * The installed mobile app stays signed in: no idle timeout, no sign-out on reopening, and it is
   * never swept as stale or ended for its age. Signing out, an administrator ending the session, or
   * the phone session limit still end it.
   */
  keepAppSignedIn: boolean;
  /**
   * Upper bound on each user's own Login Expiry setting, in minutes. 0 = no cap, the user's
   * preference (default 60) stands.
   */
  idleTimeoutCapMinutes: number;
  /**
   * Whether reopening the app after the idle timeout has passed signs the user out. Off by default:
   * the in-tab timer only runs while a tab is open, so turning this on is what makes the timeout
   * apply to a closed tab or a backgrounded phone as well.
   */
  expireOnResumeAfterIdle: boolean;
  /** Hard ceiling on a single session's age, in hours, however active it is. 0 = none. */
  maxSessionHours: number;
  /** A session with no activity for this many hours is shown as stale and swept. */
  staleAfterHours: number;
  /** Sweep stale sessions automatically (at most every SWEEP_INTERVAL_MS, on any sign-in). */
  autoSweepStale: boolean;
  updatedAt?: number | null;
  updatedByName?: string | null;
  lastSweepAt?: number | null;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  maxDesktopSessions: 0,
  maxMobileSessions: 0,
  keepAppSignedIn: true,
  idleTimeoutCapMinutes: 0,
  expireOnResumeAfterIdle: false,
  maxSessionHours: 0,
  staleAfterHours: 24,
  autoSweepStale: false,
  updatedAt: null,
  updatedByName: null,
  lastSweepAt: null,
};

/** The automatic sweep runs no more often than this, however many people sign in. */
export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/** Activity within this window reads as "active now". The heartbeat is throttled to two minutes. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export const DEFAULT_IDLE_MINUTES = 60;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Coerce whatever is stored (or posted) into a complete, in-range policy. */
export function normalizeSessionPolicy(raw: unknown): SessionPolicy {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SESSION_POLICY;
  const toMs = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
      return (v as { toMillis: () => number }).toMillis();
    }
    return null;
  };
  // A policy saved before the limit was split had one `maxConcurrentSessions` across every device.
  // It now applies to each pool on its own until the split limits are saved over it.
  const legacyLimit = r.maxConcurrentSessions;
  return {
    maxDesktopSessions: clampInt(r.maxDesktopSessions ?? legacyLimit, 0, 50, d.maxDesktopSessions),
    maxMobileSessions: clampInt(r.maxMobileSessions ?? legacyLimit, 0, 50, d.maxMobileSessions),
    keepAppSignedIn: typeof r.keepAppSignedIn === 'boolean' ? r.keepAppSignedIn : d.keepAppSignedIn,
    idleTimeoutCapMinutes: clampInt(r.idleTimeoutCapMinutes, 0, 7 * 24 * 60, d.idleTimeoutCapMinutes),
    expireOnResumeAfterIdle:
      typeof r.expireOnResumeAfterIdle === 'boolean' ? r.expireOnResumeAfterIdle : d.expireOnResumeAfterIdle,
    maxSessionHours: clampInt(r.maxSessionHours, 0, 24 * 90, d.maxSessionHours),
    staleAfterHours: clampInt(r.staleAfterHours, 1, 24 * 90, d.staleAfterHours),
    autoSweepStale: typeof r.autoSweepStale === 'boolean' ? r.autoSweepStale : d.autoSweepStale,
    updatedAt: toMs(r.updatedAt),
    updatedByName: typeof r.updatedByName === 'string' ? r.updatedByName : null,
    lastSweepAt: toMs(r.lastSweepAt),
  };
}

/** The idle timeout actually applied: the user's own preference, capped by policy. */
export function effectiveIdleMinutes(userPreference: number | null | undefined, policy: SessionPolicy): number {
  const pref = userPreference && userPreference > 0 ? userPreference : DEFAULT_IDLE_MINUTES;
  return policy.idleTimeoutCapMinutes > 0 ? Math.min(pref, policy.idleTimeoutCapMinutes) : pref;
}

/** Android's WebView marks its user agent `; wv)`, and the installed app is one. */
const ANDROID_WEBVIEW_UA = /Android.*\bwv\b/;

/**
 * Which client and which limit pool a session record belongs to.
 *
 * `client` is written by the session controller from what the app reports; records from before it
 * existed fall back to the user agent, where the Android WebView is the app.
 */
export function classifySession(record: {
  client?: unknown;
  deviceType?: unknown;
  userAgent?: unknown;
}): { client: SessionClient; deviceClass: SessionDeviceClass } {
  const client: SessionClient =
    record.client === 'app' || record.client === 'browser'
      ? record.client
      : ANDROID_WEBVIEW_UA.test(typeof record.userAgent === 'string' ? record.userAgent : '')
        ? 'app'
        : 'browser';
  const deviceClass: SessionDeviceClass =
    client === 'app' || record.deviceType === 'Mobile' || record.deviceType === 'Tablet' ? 'mobile' : 'desktop';
  return { client, deviceClass };
}

/** Whether the policy exempts this session from every time-based sign-out. */
export function isKeptSignedIn(session: { client?: SessionClient | null }, policy: SessionPolicy): boolean {
  return policy.keepAppSignedIn && session.client === 'app';
}

/** Whether the idle timeout (and its warning dialog) runs for a session on this client. */
export function idleTimeoutApplies(client: SessionClient, policy: SessionPolicy): boolean {
  return !isKeptSignedIn({ client }, policy);
}

/** The session limit for one pool. 0 = unlimited. */
export function sessionLimit(policy: SessionPolicy, deviceClass: SessionDeviceClass): number {
  return deviceClass === 'mobile' ? policy.maxMobileSessions : policy.maxDesktopSessions;
}

export type SessionPresence = 'online' | 'idle' | 'stale';

/**
 * How a still-open session looks from its last heartbeat. A session the policy keeps signed in is
 * never `stale` — that word means "the sweep will end it", and the sweep leaves it alone.
 */
export function sessionPresence(
  lastActiveMs: number | null,
  nowMs: number,
  policy: SessionPolicy,
  keptSignedIn = false,
): SessionPresence {
  if (lastActiveMs == null) return keptSignedIn ? 'idle' : 'stale';
  const age = nowMs - lastActiveMs;
  if (age <= ONLINE_WINDOW_MS) return 'online';
  if (age >= policy.staleAfterHours * 3_600_000) return keptSignedIn ? 'idle' : 'stale';
  return 'idle';
}

/** Whether a session has outlived the policy's absolute lifetime. */
export function exceedsMaxLifetime(startedMs: number | null, nowMs: number, policy: SessionPolicy): boolean {
  if (policy.maxSessionHours <= 0 || startedMs == null) return false;
  return nowMs - startedMs >= policy.maxSessionHours * 3_600_000;
}

export interface SessionLike {
  id: string;
  userId: string;
  startedMs: number | null;
  lastActiveMs: number | null;
  /** Absent reads as a desktop browser — the only kind of session before these were recorded. */
  client?: SessionClient;
  deviceClass?: SessionDeviceClass;
}

export type TerminationReason = 'timeout' | 'policy';

/**
 * Which of one user's active sessions the policy ends, and why.
 *
 * Order matters: lifetime first (an expired session is gone whatever the limit), then each pool's
 * limit over what is left — desktop and phone counted apart, so one never displaces the other —
 * keeping `currentSessionId` and then the most recently active.
 */
export function sessionsToEnforce(
  sessions: SessionLike[],
  currentSessionId: string | null,
  nowMs: number,
  policy: SessionPolicy,
): Map<string, TerminationReason> {
  const out = new Map<string, TerminationReason>();
  const survivors: SessionLike[] = [];
  for (const s of sessions) {
    if (!isKeptSignedIn(s, policy) && exceedsMaxLifetime(s.startedMs, nowMs, policy)) out.set(s.id, 'policy');
    else survivors.push(s);
  }
  for (const deviceClass of ['desktop', 'mobile'] as const) {
    const limit = sessionLimit(policy, deviceClass);
    const pool = survivors.filter((s) => (s.deviceClass ?? 'desktop') === deviceClass);
    if (limit <= 0 || pool.length <= limit) continue;
    const ranked = pool.sort((a, b) => {
      if (a.id === currentSessionId) return -1;
      if (b.id === currentSessionId) return 1;
      return (b.lastActiveMs ?? 0) - (a.lastActiveMs ?? 0);
    });
    for (const s of ranked.slice(limit)) out.set(s.id, 'policy');
  }
  return out;
}

/**
 * Sessions across everyone that a sweep ends: stale by heartbeat, or past the lifetime ceiling.
 * Sessions the policy keeps signed in are never swept.
 */
export function sessionsToSweep(
  sessions: SessionLike[],
  nowMs: number,
  policy: SessionPolicy,
  protectSessionId: string | null = null,
): Map<string, TerminationReason> {
  const out = new Map<string, TerminationReason>();
  for (const s of sessions) {
    if (s.id === protectSessionId || isKeptSignedIn(s, policy)) continue;
    if (exceedsMaxLifetime(s.startedMs, nowMs, policy)) out.set(s.id, 'policy');
    else if (sessionPresence(s.lastActiveMs, nowMs, policy) === 'stale') out.set(s.id, 'timeout');
  }
  return out;
}

/** Whether reopening a resumed session should sign it out under `expireOnResumeAfterIdle`. */
export function resumeHasExpired(
  previousLastActiveMs: number | null,
  nowMs: number,
  idleMinutes: number,
  policy: SessionPolicy,
  client: SessionClient = 'browser',
): boolean {
  if (!policy.expireOnResumeAfterIdle || previousLastActiveMs == null) return false;
  if (isKeptSignedIn({ client }, policy)) return false;
  return nowMs - previousLastActiveMs > idleMinutes * 60_000;
}

/** User-facing sentence for why a device was signed out. */
export function terminationMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'admin':
      return 'An administrator has signed you out from this device.';
    case 'user':
      return 'You signed this device out from another session.';
    case 'policy':
      return 'This session was ended by your organisation’s session policy.';
    case 'timeout':
      return 'This session expired after a period of inactivity.';
    default:
      return 'This session has ended. Please sign in again.';
  }
}
