'use client';

import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export const USER_SESSIONS_COLLECTION = 'userSessions';

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
  terminatedBy?: 'user' | 'admin' | 'timeout' | null;
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

async function fetchGeo(): Promise<SessionGeo> {
  const empty: SessionGeo = {
    ipAddress: null, city: null, region: null, country: null,
    countryCode: null, isp: null, lat: null, lon: null, timezone: null,
  };
  try {
    const res = await fetch('/api/session/geo', { cache: 'no-store' });
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

export async function createOrResumeSession(
  sessionId: string,
  user: { id: string; name: string; email: string; role?: string }
): Promise<void> {
  if (!sessionId || typeof window === 'undefined') return;
  try {
    const sessionRef = doc(db, USER_SESSIONS_COLLECTION, sessionId);
    const snap = await getDoc(sessionRef);
    const ua = navigator.userAgent;
    const { browser, os, deviceType, deviceLabel } = parseUserAgent(ua);
    const geo = await fetchGeo();

    if (snap.exists() && snap.data()?.isActive === true) {
      await updateDoc(sessionRef, {
        lastActiveAt: serverTimestamp(),
        userName: user.name || '',
        userRole: user.role || '',
        // Refresh geo in case IP changed (e.g. roaming)
        ...geo,
      });
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
        ...geo,
      });
    }
  } catch (err) {
    console.error('Failed to create/resume session', err);
  }
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
  terminatedBy: 'user' | 'admin' | 'timeout',
  byUserId?: string,
  byUserName?: string
): Promise<void> {
  if (!sessionId) return;
  try {
    await updateDoc(doc(db, USER_SESSIONS_COLLECTION, sessionId), {
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
  onTerminated: () => void
): () => void {
  if (!sessionId) return () => {};
  return onSnapshot(
    doc(db, USER_SESSIONS_COLLECTION, sessionId),
    (snap) => {
      if (snap.exists() && snap.data()?.isActive === false) {
        onTerminated();
      }
    },
    (err) => {
      console.error('Session snapshot listener error', err);
    }
  );
}
