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

import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { db } from '@/lib/firebase';
import {
  clearDriverPositionWatch,
  getCurrentDriverPosition,
  watchDriverPosition,
  type DriverGeoWatchId,
} from '@/lib/driver-mobile-geolocation';

export const USER_LOCATIONS_COLLECTION = 'userLocations';
export const USER_LOCATION_SETTINGS_COLLECTION = 'userLocationSettings';
export const USER_LOCATION_HISTORY_SUBCOLLECTION = 'history';

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
let scheduledCaptureTimer: ReturnType<typeof setInterval> | null = null;
let scheduledCaptureInFlight = false;
let requestedCaptureInFlight = false;
let lastHandledFetchRequestId = '';

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
  options: {
    force?: boolean;
    fetchRequestId?: string;
    captureType?: 'movement' | 'scheduled' | 'requested';
  } = {},
): Promise<boolean> {
  const now = Date.now();
  if (!options.force && now - lastWriteMs < activeIntervalMs) return false;
  lastWriteMs = now;

  const latestLocationRef = doc(db, USER_LOCATIONS_COLLECTION, userId);
  const historyRef = doc(collection(latestLocationRef, USER_LOCATION_HISTORY_SUBCOLLECTION));
  const platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';
  const capturedAtIso = new Date(now).toISOString();
  const locationPayload = {
    userId,
    latitude: lat,
    longitude: lng,
    accuracy,
    heading,
    speed,
    platform,
    captureType: options.captureType || 'scheduled',
  };
  const batch = writeBatch(db);

  batch.set(latestLocationRef, {
    ...locationPayload,
    lastHistoryId: historyRef.id,
    ...(options.fetchRequestId ? { lastFetchRequestId: options.fetchRequestId } : {}),
    updatedAt: serverTimestamp(),
    updatedAtIso: capturedAtIso,
  }, { merge: true });
  batch.set(historyRef, {
    ...locationPayload,
    ...(options.fetchRequestId ? { fetchRequestId: options.fetchRequestId } : {}),
    capturedAt: serverTimestamp(),
    capturedAtIso,
  });
  await batch.commit();
  return true;
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

function stopScheduledCapture() {
  if (scheduledCaptureTimer !== null) {
    clearInterval(scheduledCaptureTimer);
    scheduledCaptureTimer = null;
  }
  scheduledCaptureInFlight = false;
}

async function captureCurrentPosition(userId: string, version: number) {
  if (
    scheduledCaptureInFlight ||
    !locationCaptureEnabled ||
    activeUserId !== userId ||
    version !== lifecycleVersion
  ) return;

  scheduledCaptureInFlight = true;
  try {
    const position = await getCurrentDriverPosition({
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: Math.min(15_000, Math.floor(activeIntervalMs / 2)),
    });
    if (
      !locationCaptureEnabled ||
      activeUserId !== userId ||
      version !== lifecycleVersion
    ) return;

    await persist(
      userId,
      position.coords.latitude,
      position.coords.longitude,
      position.coords.accuracy,
      position.coords.heading,
      position.coords.speed,
      { captureType: 'scheduled' },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to fetch current location.';
    console.warn('[UserLocation] scheduled capture error:', message);
  } finally {
    scheduledCaptureInFlight = false;
  }
}

async function captureRequestedPosition(userId: string, version: number, fetchRequestId: string) {
  if (
    requestedCaptureInFlight ||
    !locationCaptureEnabled ||
    activeUserId !== userId ||
    version !== lifecycleVersion
  ) return;

  requestedCaptureInFlight = true;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const position = await getCurrentDriverPosition({
          enableHighAccuracy: true,
          timeout: 20_000,
          maximumAge: 0,
        });
        if (
          !locationCaptureEnabled ||
          activeUserId !== userId ||
          version !== lifecycleVersion
        ) return;

        await persist(
          userId,
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
          position.coords.heading,
          position.coords.speed,
          {
            force: true,
            fetchRequestId,
            captureType: 'requested',
          },
        );
        lastHandledFetchRequestId = fetchRequestId;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(`sel_location_fetch_request_${userId}`, fetchRequestId);
        }
        return;
      } catch (error) {
        if (attempt === 2) {
          const message = error instanceof Error ? error.message : 'Unable to fetch requested location.';
          console.warn('[UserLocation] requested capture error:', message);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  } finally {
    requestedCaptureInFlight = false;
  }
}

function startScheduledCapture(userId: string, version: number) {
  stopScheduledCapture();
  void captureCurrentPosition(userId, version);
  scheduledCaptureTimer = setInterval(() => {
    void captureCurrentPosition(userId, version);
  }, activeIntervalMs);
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
            { captureType: 'movement' },
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
  lastHandledFetchRequestId =
    typeof window !== 'undefined'
      ? window.localStorage.getItem(`sel_location_fetch_request_${userId}`) || ''
      : '';
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
      const fetchRequestId = String(setting?.fetchRequestId || '').trim();

      if (!enabled) {
        stopScheduledCapture();
        void stopPositionWatcher();
        return;
      }
      if (fetchRequestId && fetchRequestId !== lastHandledFetchRequestId) {
        void captureRequestedPosition(userId, version, fetchRequestId);
      }
      startScheduledCapture(userId, version);
      void startPositionWatcher(userId, version).catch((error) => {
        const message = error instanceof Error ? error.message : 'Unable to start location watcher.';
        console.warn('[UserLocation] watcher start error:', message);
      });
    },
    (error) => {
      console.warn('[UserLocation] settings listener error:', error.message);
      stopScheduledCapture();
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
  requestedCaptureInFlight = false;
  lastHandledFetchRequestId = '';
  stopScheduledCapture();
  await stopPositionWatcher();
  activeUserId = null;
  lastWriteMs = 0;
  activeIntervalMs = DEFAULT_INTERVAL_SECONDS * 1000;
}
