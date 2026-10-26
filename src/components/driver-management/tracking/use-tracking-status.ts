'use client';

import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import type { NativePermissions, NativeStatus } from '@/lib/trip-tracking/rules';
import { getStatus, nativeTrackingAvailable, onTrackingEvent } from '@/lib/trip-tracking/tracking';
import { TripRecorder } from '@/lib/trip-tracking/native';

const POLL_MS = 10_000;

/**
 * The native recorder's status for one trip (and the permissions it runs on), for the status chip
 * and the "Syncing N points…" gate: read every 10 s, on every recorder event, and when the app comes
 * back. Null without the native recorder.
 */
export function useNativeTrackingStatus(tripId: string | null): { status: NativeStatus | null; permissions: NativePermissions | null } {
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const [permissions, setPermissions] = useState<NativePermissions | null>(null);

  useEffect(() => {
    if (!tripId || !nativeTrackingAvailable()) return undefined;
    let alive = true;
    const read = async () => {
      try {
        const [next, granted] = await Promise.all([getStatus(tripId), TripRecorder.getPermissionStatus()]);
        if (alive) {
          setStatus(next);
          setPermissions(granted);
        }
      } catch {
        // The recorder answers again on the next tick.
      }
    };
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    const off = onTrackingEvent(() => void read());
    const appState = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void read();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      off();
      void appState.then((handle) => handle.remove()).catch(() => undefined);
    };
  }, [tripId]);

  return { status: tripId ? status : null, permissions: tripId ? permissions : null };
}

/** A clock for "12 s ago" labels, ticking every 5 s. */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
