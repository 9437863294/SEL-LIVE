'use client';

/**
 * Browser access to the Location Tracking API for screens other than Location Tracking itself.
 *
 * GPS is gated twice: `Settings.Location Tracking` permission, and an email OTP unlock whose token
 * the Location Tracking page keeps in sessionStorage. Other screens (Session Management) reuse that
 * same unlock rather than getting a second, weaker way in — if the token is absent or expired they
 * show a link to unlock instead of any coordinates.
 */

import { auth } from '@/lib/firebase';

export const LOCATION_OTP_TOKEN_KEY = 'sel_location_tracking_otp_token';
export const LOCATION_OTP_EXPIRY_KEY = 'sel_location_tracking_otp_expires';

export interface UserGpsFix {
  userId: string;
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  platform: string | null;
  updatedAtMs: number | null;
  lastFetchRequestId: string | null;
}

/** The OTP unlock token, or '' when this tab has not unlocked Location Tracking (or it expired). */
export function readLocationUnlockToken(): string {
  if (typeof window === 'undefined') return '';
  const token = sessionStorage.getItem(LOCATION_OTP_TOKEN_KEY) || '';
  const expiry = Number(sessionStorage.getItem(LOCATION_OTP_EXPIRY_KEY) || 0);
  return token && expiry > Date.now() ? token : '';
}

async function locationRequest(init: RequestInit, otpToken: string) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('Not signed in.');
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch('/api/location-tracking/settings', {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      'X-Location-OTP-Token': otpToken,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(String(data?.error || 'Location request failed.')) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Latest GPS fix per user. */
export async function loadUserGpsFixes(otpToken: string): Promise<Map<string, UserGpsFix>> {
  const data = await locationRequest({ method: 'GET' }, otpToken);
  const out = new Map<string, UserGpsFix>();
  for (const u of Array.isArray(data.users) ? data.users : []) {
    const loc = u.location;
    out.set(String(u.id), {
      userId: String(u.id),
      enabled: u.enabled === true,
      latitude: loc && Number.isFinite(loc.latitude) ? loc.latitude : null,
      longitude: loc && Number.isFinite(loc.longitude) ? loc.longitude : null,
      accuracy: loc?.accuracy ?? null,
      platform: loc?.platform ?? null,
      updatedAtMs: loc?.updatedAtIso ? Date.parse(loc.updatedAtIso) || null : null,
      lastFetchRequestId: loc?.lastFetchRequestId ?? null,
    });
  }
  return out;
}

/** Ask the user's device for a fresh GPS point. Returns the request id to watch for. */
export async function requestCurrentGps(userId: string, otpToken: string): Promise<string> {
  const data = await locationRequest(
    { method: 'PATCH', body: JSON.stringify({ userId, action: 'fetch-current' }) },
    otpToken,
  );
  return String(data?.request?.fetchRequestId || '');
}

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
