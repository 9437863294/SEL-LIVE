/**
 * Session policy — the rules the session controller enforces, and the pure decisions built on them.
 *
 * No Firebase imports: the same functions run in the browser (AuthProvider, the Sessions screen),
 * in the `/api/session/control` route, and under `node --test`.
 *
 * Stored at `settings/sessionPolicy`, written only by the API route. Every field has a default that
 * reproduces the behaviour from before the policy existed, so an installation that never opens the
 * Policy tab sees no change at all.
 */

export const SESSION_POLICY_DOC = { collection: 'settings', id: 'sessionPolicy' } as const;

export interface SessionPolicy {
  /** Most sessions one user may hold at once. 0 = unlimited. The oldest are signed out first. */
  maxConcurrentSessions: number;
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
  maxConcurrentSessions: 0,
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
  return {
    maxConcurrentSessions: clampInt(r.maxConcurrentSessions, 0, 50, d.maxConcurrentSessions),
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

export type SessionPresence = 'online' | 'idle' | 'stale';

/** How a still-open session looks from its last heartbeat. */
export function sessionPresence(lastActiveMs: number | null, nowMs: number, policy: SessionPolicy): SessionPresence {
  if (lastActiveMs == null) return 'stale';
  const age = nowMs - lastActiveMs;
  if (age <= ONLINE_WINDOW_MS) return 'online';
  if (age >= policy.staleAfterHours * 3_600_000) return 'stale';
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
}

export type TerminationReason = 'timeout' | 'policy';

/**
 * Which of one user's active sessions the policy ends, and why.
 *
 * Order matters: lifetime first (an expired session is gone whatever the limit), then the
 * concurrency limit over what is left, keeping `currentSessionId` and then the most recently active.
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
    if (exceedsMaxLifetime(s.startedMs, nowMs, policy)) out.set(s.id, 'policy');
    else survivors.push(s);
  }
  if (policy.maxConcurrentSessions > 0 && survivors.length > policy.maxConcurrentSessions) {
    const ranked = [...survivors].sort((a, b) => {
      if (a.id === currentSessionId) return -1;
      if (b.id === currentSessionId) return 1;
      return (b.lastActiveMs ?? 0) - (a.lastActiveMs ?? 0);
    });
    for (const s of ranked.slice(policy.maxConcurrentSessions)) out.set(s.id, 'policy');
  }
  return out;
}

/** Sessions across everyone that a sweep ends: stale by heartbeat, or past the lifetime ceiling. */
export function sessionsToSweep(
  sessions: SessionLike[],
  nowMs: number,
  policy: SessionPolicy,
  protectSessionId: string | null = null,
): Map<string, TerminationReason> {
  const out = new Map<string, TerminationReason>();
  for (const s of sessions) {
    if (s.id === protectSessionId) continue;
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
): boolean {
  if (!policy.expireOnResumeAfterIdle || previousLastActiveMs == null) return false;
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
