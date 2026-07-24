/**
 * LocationManager — singleton that keeps one background watcher alive
 * and stores the latest GPS fix so any part of the app can read it
 * without starting a new watcher.
 *
 * Usage:
 *   LocationManager.start()          // call once (e.g. on app boot)
 *   LocationManager.getLatest()      // call anytime — instant, no GPS warmup
 *   LocationManager.stop()           // call when you truly want to stop
 *   LocationManager.isRunning()      // boolean
 */

import {
  watchDriverPosition,
  clearDriverPositionWatch,
  getCurrentDriverPosition,
  ensureDriverGeolocation,
  ensureAndroidBackgroundTrackingSetup,
  isNativeAndroidDriverApp,
  type DriverGeoPosition,
  type DriverGeoWatchId,
} from '@/lib/driver-mobile-geolocation';

export type LocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
};

type Listener = (snapshot: LocationSnapshot) => void;

let watchId: DriverGeoWatchId | null = null;
let latest: LocationSnapshot | null = null;
const listeners = new Set<Listener>();

function toSnapshot(pos: DriverGeoPosition): LocationSnapshot {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    heading: pos.coords.heading,
    speed: pos.coords.speed,
    timestamp: pos.timestamp,
  };
}

function notifyAll(snap: LocationSnapshot) {
  listeners.forEach((fn) => {
    try { fn(snap); } catch { /* ignore listener errors */ }
  });
}

export const LocationManager = {
  /**
   * Start the always-on background watcher.
   * Safe to call multiple times — does nothing if already running.
   */
  async start(): Promise<void> {
    if (watchId !== null) return;

    // One-time Android setup (battery optimisation + always-location prompt)
    if (isNativeAndroidDriverApp()) {
      try {
        await ensureAndroidBackgroundTrackingSetup();
      } catch {
        // User may need to finish settings manually; don't block start
      }
    }

    await ensureDriverGeolocation();

    watchId = await watchDriverPosition(
      {
        distanceFilterMeters: 10,
        enableHighAccuracy: true,
      },
      (position) => {
        latest = toSnapshot(position);
        notifyAll(latest);
      },
      (error) => {
        console.warn('[LocationManager] watch error:', error.message);
      }
    );
  },

  /** Stop the watcher and clear stored location. */
  async stop(): Promise<void> {
    if (watchId === null) return;
    await clearDriverPositionWatch(watchId);
    watchId = null;
    latest = null;
  },

  /** True if a watcher is currently active. */
  isRunning(): boolean {
    return watchId !== null;
  },

  /**
   * Return the last received location instantly (no GPS cold-start).
   * Falls back to a fresh one-shot fix if no stored location yet.
   */
  async getLatest(): Promise<LocationSnapshot | null> {
    if (latest) return latest;

    // Watcher hasn't fired yet — get a one-shot fix
    try {
      const pos = await getCurrentDriverPosition({ enableHighAccuracy: true, timeout: 10_000 });
      latest = toSnapshot(pos);
      return latest;
    } catch {
      return null;
    }
  },

  /**
   * Subscribe to every new location update.
   * Returns an unsubscribe function.
   *
   * const unsub = LocationManager.subscribe(snap => console.log(snap));
   * // later:
   * unsub();
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    // Immediately emit the latest known value if available
    if (latest) listener(latest);
    return () => listeners.delete(listener);
  },
};
