/**
 * User Location Service
 *
 * Writes the current user's GPS coordinates to Firestore under
 * userLocations/{userId} so any admin can read it from the
 * session management page.
 *
 * Platform behaviour:
 *  - Android (native)  → Java Foreground Service via LocationPlugin bridge.
 *                        Survives the app being swiped away or killed by the OS.
 *  - iOS / Web         → navigator.geolocation via watchDriverPosition
 *                        (active while JS thread is alive).
 */

import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { db } from '@/lib/firebase';
import {
  clearDriverPositionWatch,
  watchDriverPosition,
  type DriverGeoWatchId,
} from '@/lib/driver-mobile-geolocation';

export const USER_LOCATIONS_COLLECTION = 'userLocations';

// Native Android bridge — calls LocationForegroundService via LocationPlugin.java
interface LocationTrackingPlugin {
  startTracking(options: { userId: string }): Promise<void>;
  stopTracking(): Promise<void>;
}
const LocationTrackingNative = registerPlugin<LocationTrackingPlugin>('LocationTracking');

// Throttle: only write if the user moved enough OR enough time has passed.
const MIN_INTERVAL_MS   = 60_000;  // 1 minute minimum between writes
const DISTANCE_FILTER_M = 30;      // 30 m movement filter (web/iOS path only)

let activeWatchId:  DriverGeoWatchId | null = null;
let activeUserId:   string | null           = null;
let lastWriteMs     = 0;
let nativeTracking  = false;

async function persist(
  userId:   string,
  lat:      number,
  lng:      number,
  accuracy: number,
  heading:  number | null,
  speed:    number | null,
): Promise<void> {
  const now = Date.now();
  if (now - lastWriteMs < MIN_INTERVAL_MS) return;
  lastWriteMs = now;

  await setDoc(
    doc(db, USER_LOCATIONS_COLLECTION, userId),
    {
      userId,
      latitude:     lat,
      longitude:    lng,
      accuracy,
      heading,
      speed,
      platform:     Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web',
      updatedAt:    serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
    },
    { merge: true },
  );
}

/**
 * Start watching the user's GPS and syncing it to Firestore.
 * Safe to call multiple times for the same userId — it's a no-op.
 *
 * On Android: delegates to LocationForegroundService (survives app kill).
 * On Web/iOS: uses watchDriverPosition (active while the JS thread is alive).
 */
export async function startUserLocationTracking(userId: string): Promise<void> {
  if (activeUserId === userId && (activeWatchId !== null || nativeTracking)) return;
  await stopUserLocationTracking();

  activeUserId = userId;
  lastWriteMs  = 0;

  // Android: hand off to the native foreground service
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    await LocationTrackingNative.startTracking({ userId });
    nativeTracking = true;
    return;
  }

  // Web / iOS: JS-based watcher
  activeWatchId = await watchDriverPosition(
    {
      enableHighAccuracy:   true,
      distanceFilterMeters: DISTANCE_FILTER_M,
      backgroundTitle:      'SEL Live',
      backgroundMessage:    'Your location is being shared with your organisation.',
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
  if (nativeTracking) {
    await LocationTrackingNative.stopTracking().catch(() => {});
    nativeTracking = false;
  }
  if (activeWatchId !== null) {
    await clearDriverPositionWatch(activeWatchId);
    activeWatchId = null;
  }
  activeUserId = null;
  lastWriteMs  = 0;
}
