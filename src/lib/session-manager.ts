'use client';

import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import type { SessionPolicy } from '@/lib/session-policy';

export const USER_SESSIONS_COLLECTION = 'userSessions';

/** Who ended a session. `policy` is the session controller acting on `settings/sessionPolicy`. */
export type SessionTerminator = 'user' | 'admin' | 'timeout' | 'policy';

export interface SessionGeo {
  ipAddress: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  isp: string | null;
  lat: number | null;
  lon: number | null;
  timezone: string | null;
}

export interface UserSession extends SessionGeo {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  browser: string;
  os: string;
  deviceType: 'Desktop' | 'Mobile' | 'Tablet';
  deviceLabel: string;
  userAgent: string;
  startedAt: { seconds: number; nanoseconds: number } | null;
  lastActiveAt: { seconds: number; nanoseconds: number } | null;
  isActive: boolean;
  terminatedAt?: { seconds: number; nanoseconds: number } | null;
  terminatedBy?: SessionTerminator | null;
  terminatedByUserId?: string | null;
  terminatedByUserName?: string | null;
}

export function parseUserAgent(ua: string): {
  browser: string;
  os: string;
  deviceType: 'Desktop' | 'Mobile' | 'Tablet';
  deviceLabel: string;
} {
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' :
    'Browser';

  const os =
    /Windows NT/.test(ua) ? 'Windows' :
    (/Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) ? 'macOS' :
    /iPhone/.test(ua) ? 'iOS' :
    /iPad/.test(ua) ? 'iPadOS' :
    /Android/.test(ua) ? 'Android' :
    /Linux/.test(ua) ? 'Linux' :
    'Unknown OS';

  const deviceType: 'Desktop' | 'Mobile' | 'Tablet' =
    /iPhone/.test(ua) ? 'Mobile' :
    /iPad/.test(ua) ? 'Tablet' :
    (/Android/.test(ua) && /Mobile/.test(ua)) ? 'Mobile' :
    /Android/.test(ua) ? 'Tablet' :
    'Desktop';

  return { browser, os, deviceType, deviceLabel: `${browser} on ${os}` };
}

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  const existing = localStorage.getItem('sessionId');
  if (existing) return existing;
  const newId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem('sessionId', newId);
  return newId;
}

const GEO_TIMEOUT_MS = 4000;

async function fetchGeo(): Promise<SessionGeo> {
  const empty: SessionGeo = {
    ipAddress: null, city: null, region: null, country: null,
    countryCode: null, isp: null, lat: null, lon: null, timezone: null,
  };
  try {
    // Never let a slow/rate-limited geo provider hold the session write open.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch('/api/session/geo', { cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      ipAddress: data.ip || null,
      city: data.city || null,
      region: data.region || null,
      country: data.country || null,
      countryCode: data.countryCode || null,
      isp: data.isp || null,
      lat: typeof data.lat === 'number' ? data.lat : null,
      lon: typeof data.lon === 'number' ? data.lon : null,
      timezone: data.timezone || null,
    };
  } catch {
    return empty;
  }
}

export type SessionOpenResult =
  | { status: 'created' }
  | { status: 'resumed'; previousLastActiveMs: number | null; startedMs: number | null }
  /** The id in this browser names a session someone else already ended. Sign out; do not revive it. */
  | { status: 'terminated'; terminatedBy: SessionTerminator | null }
  | { status: 'error' };

export async function createOrResumeSession(
  sessionId: string,
  user: { id: string; name: string; email: string; role?: string }
): Promise<SessionOpenResult> {
  if (!sessionId || typeof window === 'undefined') return { status: 'error' };
  try {
    const sessionRef = doc(db, USER_SESSIONS_COLLECTION, sessionId);
    const snap = await getDoc(sessionRef);
    const ua = navigator.userAgent;
    const { browser, os, deviceType, deviceLabel } = parseUserAgent(ua);
    const data = snap.exists() ? snap.data() : null;

    /*
     * A signed-out tab clears localStorage, so a session id that survives here and points at an
     * ended session means the session was ended *from somewhere else* — an administrator, another
     * of the user's devices, or the policy — while this tab was closed. This used to fall through to
     * the `setDoc` below and recreate the session under the same id, which quietly undid the
     * termination the moment the user reopened the app.
     */
    if (data && data.isActive === false && data.userId === user.id) {
      return { status: 'terminated', terminatedBy: (data.terminatedBy as SessionTerminator) ?? null };
    }

    if (data && data.isActive === true) {
      await updateDoc(sessionRef, {
        lastActiveAt: serverTimestamp(),
        userName: user.name || '',
        userRole: user.role || '',
      });
      void refreshGeo(sessionRef);
      return {
        status: 'resumed',
        previousLastActiveMs: data.lastActiveAt?.seconds != null ? data.lastActiveAt.seconds * 1000 : null,
        startedMs: data.startedAt?.seconds != null ? data.startedAt.seconds * 1000 : null,
      };
    } else {
      await setDoc(sessionRef, {
        userId: user.id,
        userName: user.name || '',
        userEmail: user.email || '',
        userRole: user.role || '',
        browser,
        os,
        deviceType,
        deviceLabel,
        userAgent: ua.slice(0, 512),
        startedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
        isActive: true,
        terminatedAt: null,
        terminatedBy: null,
        terminatedByUserId: null,
        terminatedByUserName: null,
      });
      void refreshGeo(sessionRef);
      return { status: 'created' };
    }
  } catch (err) {
    console.error('Failed to create/resume session', err);
    return { status: 'error' };
  }
}

// Geo is telemetry, not a precondition for having a session. Resolve it after
// the session row exists so sign-in never waits on a third-party IP lookup.
function refreshGeo(sessionRef: ReturnType<typeof doc>): Promise<void> {
  return fetchGeo()
    .then((geo) => updateDoc(sessionRef, { ...geo }))
    .catch(() => {});
}

export async function updateSessionActivity(sessionId: string): Promise<void> {
  if (!sessionId || typeof window === 'undefined') return;
  try {
    await updateDoc(doc(db, USER_SESSIONS_COLLECTION, sessionId), {
      lastActiveAt: serverTimestamp(),
    });
  } catch {
    // Session may have been externally terminated — ignore
  }
}

export async function terminateSession(
  sessionId: string,
  terminatedBy: SessionTerminator,
  byUserId?: string,
  byUserName?: string
): Promise<void> {
  if (!sessionId) return;
  try {
    const ref = doc(db, USER_SESSIONS_COLLECTION, sessionId);
    // Never overwrite an ending that already happened. A tab reacting to an administrator's sign-out
    // runs this too, and without the check it rewrote the record as `terminatedBy: 'user'` — erasing
    // who actually ended the session from the history the administrator is looking at.
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data()?.isActive === false) return;
    await updateDoc(ref, {
      isActive: false,
      terminatedAt: serverTimestamp(),
      terminatedBy,
      terminatedByUserId: byUserId ?? null,
      terminatedByUserName: byUserName ?? null,
    });
  } catch {
    // Already terminated or document missing
  }
}

export function listenToSession(
  sessionId: string,
  onTerminated: (terminatedBy: SessionTerminator | null) => void
): () => void {
  if (!sessionId) return () => {};
  return onSnapshot(
    doc(db, USER_SESSIONS_COLLECTION, sessionId),
    (snap) => {
      if (snap.exists() && snap.data()?.isActive === false) {
        onTerminated((snap.data()?.terminatedBy as SessionTerminator) ?? null);
      }
    },
    (err) => {
      console.error('Session snapshot listener error', err);
    }
  );
}

// ─── session controller API ──────────────────────────────────────────────────

export type SessionControlAction =
  | { action: 'enforce'; currentSessionId: string }
  | { action: 'terminate'; sessionIds: string[] }
  | { action: 'terminate-user'; userId: string; currentSessionId?: string }
  | { action: 'terminate-others'; currentSessionId: string }
  | { action: 'terminate-all'; currentSessionId: string }
  | { action: 'sweep-stale'; currentSessionId?: string }
  | { action: 'update-policy'; policy: Partial<SessionPolicy> };

export interface SessionControlResult {
  ok: boolean;
  policy: SessionPolicy;
  /** Sessions this call ended. */
  terminated: number;
  /** Set by `enforce` when the caller's own current session was ended by the policy. */
  currentTerminated?: boolean;
}

async function sessionControlRequest(init: RequestInit): Promise<SessionControlResult> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('Not signed in.');
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch('/api/session/control', {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, ...init.headers },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Session request failed (${res.status}).`);
  return body as SessionControlResult;
}

/** Run one session-controller action on the server (Admin SDK, audited). */
export function sessionControl(payload: SessionControlAction): Promise<SessionControlResult> {
  return sessionControlRequest({ method: 'POST', body: JSON.stringify(payload) });
}

/** Read the current session policy. */
export function fetchSessionPolicy(): Promise<SessionControlResult> {
  return sessionControlRequest({ method: 'GET' });
}
