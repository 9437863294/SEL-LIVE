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

import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { db } from '@/lib/firebase';
import {
  clearDriverPositionWatch,
  watchDriverPosition,
  type DriverGeoWatchId,
} from '@/lib/driver-mobile-geolocation';

export const USER_LOCATIONS_COLLECTION = 'userLocations';
export const USER_LOCATION_SETTINGS_COLLECTION = 'userLocationSettings';

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 3600;
const DISTANCE_FILTER_M = 30;      // 30 m movement filter

let activeWatchId: DriverGeoWatchId | null = null;
let activeUserId: string | null = null;
let lastWriteMs = 0;
let activeIntervalMs = DEFAULT_INTERVAL_SECONDS * 1000;
let settingsUnsubscribe: (() => void) | null = null;
let watcherStarting = false;
let lifecycleVersion = 0;
let locationCaptureEnabled = false;

const normalizeIntervalSeconds = (value: unknown) =>
  Math.min(
    MAX_INTERVAL_SECONDS,
    Math.max(MIN_INTERVAL_SECONDS, Number(value) || DEFAULT_INTERVAL_SECONDS)
  );

async function persist(
  userId: string,
  lat: number,
  lng: number,
  accuracy: number,
  heading: number | null,
  speed: number | null,
): Promise<void> {
  const now = Date.now();
  if (now - lastWriteMs < activeIntervalMs) return;
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
async function stopPositionWatcher() {
  if (activeWatchId === null) return;
  const watchId = activeWatchId;
  activeWatchId = null;
  await clearDriverPositionWatch(watchId).catch(() => {});
}

async function startPositionWatcher(userId: string, version: number) {
  if (activeWatchId !== null || watcherStarting) return;
  watcherStarting = true;

  try {
    const watchId = await watchDriverPosition(
      {
        enableHighAccuracy: true,
        distanceFilterMeters: DISTANCE_FILTER_M,
        forceForegroundWatcher: true,
      },
      async (position) => {
        if (activeUserId !== userId || version !== lifecycleVersion) return;
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
          // Ignore transient Firestore write failures; the watcher stays active.
        }
      },
      (error) => {
        console.warn('[UserLocation] watch error:', error.message);
      },
    );

    if (activeUserId !== userId || version !== lifecycleVersion || !locationCaptureEnabled) {
      await clearDriverPositionWatch(watchId).catch(() => {});
      return;
    }
    activeWatchId = watchId;
  } finally {
    watcherStarting = false;
  }
}

export async function startUserLocationTracking(userId: string): Promise<void> {
  if (activeUserId === userId && settingsUnsubscribe) return;
  await stopUserLocationTracking();

  activeUserId = userId;
  lastWriteMs = 0;
  activeIntervalMs = DEFAULT_INTERVAL_SECONDS * 1000;
  const version = lifecycleVersion;

  settingsUnsubscribe = onSnapshot(
    doc(db, USER_LOCATION_SETTINGS_COLLECTION, userId),
    (snapshot) => {
      if (activeUserId !== userId || version !== lifecycleVersion) return;
      const setting = snapshot.data();
      const enabled = snapshot.exists() && setting?.enabled === true;
      locationCaptureEnabled = enabled;
      activeIntervalMs = normalizeIntervalSeconds(setting?.intervalSeconds) * 1000;

      if (!enabled) {
        void stopPositionWatcher();
        return;
      }
      void startPositionWatcher(userId, version);
    },
    (error) => {
      console.warn('[UserLocation] settings listener error:', error.message);
      void stopPositionWatcher();
    },
  );
}

/** Stop tracking. Called on logout or unmount. */
export async function stopUserLocationTracking(): Promise<void> {
  lifecycleVersion += 1;
  settingsUnsubscribe?.();
  settingsUnsubscribe = null;
  locationCaptureEnabled = false;
  await stopPositionWatcher();
  activeUserId = null;
  lastWriteMs = 0;
  activeIntervalMs = DEFAULT_INTERVAL_SECONDS * 1000;
}
