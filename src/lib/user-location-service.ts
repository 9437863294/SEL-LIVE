/**
 * User Location Service
 *
 * Writes the current user's GPS coordinates to Firestore under
 * userLocations/{userId} so any admin can read it from the
 * session management page.
 *
 * Platform behaviour:
 *  - Android / iOS / Web → foreground location watcher, active while the app's
 *                           JavaScript runtime is alive.
 *
 * Android requires a persistent system notification for background location.
 * This tracker stays foreground-only so no organisation location-sharing
 * notification is displayed.
 */

import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { db } from '@/lib/firebase';
import {
  clearDriverPositionWatch,
  watchDriverPosition,
  type DriverGeoWatchId,
} from '@/lib/driver-mobile-geolocation';

export const USER_LOCATIONS_COLLECTION = 'userLocations';

// Throttle: only write if the user moved enough OR enough time has passed.
const MIN_INTERVAL_MS = 600_000;  // 1 minute minimum between writes
const DISTANCE_FILTER_M = 30;      // 30 m movement filter

let activeWatchId: DriverGeoWatchId | null = null;
let activeUserId: string | null = null;
let lastWriteMs = 0;

async function persist(
  userId: string,
  lat: number,
  lng: number,
  accuracy: number,
  heading: number | null,
  speed: number | null,
): Promise<void> {
  const now = Date.now();
  if (now - lastWriteMs < MIN_INTERVAL_MS) return;
  lastWriteMs = now;

  await setDoc(
    doc(db, USER_LOCATIONS_COLLECTION, userId),
    {
      userId,
      latitude: lat,
      longitude: lng,
      accuracy,
      heading,
      speed,
      platform: Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web',
      updatedAt: serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
    },
    { merge: true },
  );
}

/**
 * Start watching the user's GPS and syncing it to Firestore.
 * Safe to call multiple times for the same userId — it's a no-op.
 *
 * Uses a foreground watcher on every platform. It stops when the app's
 * JavaScript runtime is suspended or terminated.
 */
export async function startUserLocationTracking(userId: string): Promise<void> {
  if (activeUserId === userId && activeWatchId !== null) return;
  await stopUserLocationTracking();

  activeUserId = userId;
  lastWriteMs = 0;

  activeWatchId = await watchDriverPosition(
    {
      enableHighAccuracy: true,
      distanceFilterMeters: DISTANCE_FILTER_M,
      forceForegroundWatcher: true,
    },
    async (position) => {
      try {
        await persist(
          userId,
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
          position.coords.heading,
          position.coords.speed,
        );
      } catch {
        // ignore Firestore write failures silently
      }
    },
    (error) => {
      console.warn('[UserLocation] watch error:', error.message);
    },
  );
}

/** Stop tracking. Called on logout or unmount. */
export async function stopUserLocationTracking(): Promise<void> {
  if (activeWatchId !== null) {
    await clearDriverPositionWatch(activeWatchId);
    activeWatchId = null;
  }
  activeUserId = null;
  lastWriteMs = 0;
}
