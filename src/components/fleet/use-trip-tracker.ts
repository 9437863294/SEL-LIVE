'use client';

/**
 * Tracks a running fleet trip on the phone and hands its fixes to the outbox (`offline-queue.ts`),
 * which sends them when it can.
 *
 * Two ways to get the fixes:
 *
 * - **The native recorder** (an SEL Driver APK that carries it — `nativeTrackingAvailable()`): a
 *   foreground service records into SQLite on the phone whether or not this WebView is alive, so a
 *   locked screen, a swipe from Recents or a phone that kills the app costs no points
 *   (docs/BACKGROUND-TRACKING-PLAN.md). This hook starts it and *drains* it — on each new fix, every
 *   15 s, and when the app comes back — into the outbox, keyed by the recorder's own `clientPointId`.
 *   Leaving the page does not stop it; pausing or ending the trip does (and `settleFleetRecording`
 *   stops one the server has closed meanwhile).
 * - **The in-app watcher** otherwise (an older APK, the browser): `watchDriverPosition`, batched
 *   every ten fixes or thirty seconds. Watching stops when the trip is paused or ends, and on unmount
 *   (the buffer is queued first).
 *
 * Either way it keeps the driver's own view of the trip, the same one an own-vehicle GPS trip shows:
 * the route as driven (`path`, drawn fix by fix) and its summary — distance, moving and stopped
 * minutes — worked out exactly as the GPS recorder works out its tiles (`summariseTrip` on the
 * cleaned path). Arrivals and departures at geofences run through the same two-fix hysteresis the
 * server uses (`stepGeofences`). All of it is the phone's estimate for the screen; the server
 * re-measures the synced track at the end, and its figures are the record.
 *
 * The state is kept per trip in localStorage, so a reload, a WebView restart or a phone that killed
 * the app mid-trip resumes the route, the distance and the geofence state instead of starting from
 * zero. The saved route is thinned evenly to `MAX_SAVED_PATH` points, keeping both ends, so a long
 * day's drive stays well inside the browser's storage.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { clearDriverPositionWatch, watchDriverPosition, type DriverGeoPosition, type DriverGeoWatchId } from '@/lib/driver-mobile-geolocation';
import { emptyGeofenceState, stepGeofences, type GeofenceState } from '@/lib/fleet/geo';
import type { ClientPoint, FleetTrip, GeofenceEvent } from '@/lib/fleet/types';
import type { FleetBootstrap } from '@/lib/fleet/server/overview';
import { cleanTripPath, computeTripDistanceDeltaKm, summariseTrip, type TripLocationPoint, type TripSummary } from '@/lib/vehicle-management';
import { gapsNeedGuide, toClientPoint, toGapRecord, toRoutePoint, type NativeGap, type NativePoint } from '@/lib/trip-tracking/rules';
import { drainTrip, getStatus, nativeTrackingAvailable, onTrackingEvent, resumeIfActive, startTracking, stopTracking, trackingErrorMessage } from '@/lib/trip-tracking/tracking';
import { newClientId } from './fleet-api';
import { enqueueGeofenceEvents, enqueuePoints, flushQueue } from './offline-queue';

const STORAGE_PREFIX = 'sel-fleet-tracker:';
const BATCH_FIXES = 10;
const BATCH_MS = 30_000;
/** How often the native buffer is drained while the app is open (a new fix drains sooner). */
const DRAIN_MS = 15_000;
/** Fixes worse than this neither move the distance anchor nor count toward geofences. */
const MAX_ACCURACY_M = 120;
const MAX_ARRIVALS = 50;
/** Route points kept on the phone; beyond this the saved route is thinned evenly. */
const MAX_SAVED_PATH = 1500;

interface TrackerState {
  liveKm: number;
  fixes: number;
  lastFixAt: string | null;
  accuracyM: number | null;
  /** The last fix the distance was counted from (jitter below the threshold does not move it). */
  anchor: { lat: number; lng: number; accuracyMeters?: number; recordedAtIso: string } | null;
  geo: GeofenceState;
  arrivals: GeofenceEvent[];
  /** The route as driven, every fix (thinned past `MAX_SAVED_PATH`). */
  path: TripLocationPoint[];
}

const EMPTY: TrackerState = { liveKm: 0, fixes: 0, lastFixAt: null, accuracyM: null, anchor: null, geo: emptyGeofenceState(), arrivals: [], path: [] };

/** Evenly spaced, keeping both ends — a route thinned in the middle still reads as the same route. */
function thin(points: TripLocationPoint[], limit: number): TripLocationPoint[] {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  const out: TripLocationPoint[] = [];
  for (let index = 0; index < limit; index += 1) out.push(points[Math.round(index * step)]);
  return out;
}

function load(tripId: string | null): TrackerState {
  if (!tripId || typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + tripId);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<TrackerState>;
    return {
      ...EMPTY,
      ...parsed,
      geo: parsed.geo ?? emptyGeofenceState(),
      arrivals: Array.isArray(parsed.arrivals) ? parsed.arrivals : [],
      path: Array.isArray(parsed.path) ? parsed.path.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng)) : [],
    };
  } catch {
    return EMPTY;
  }
}

function save(tripId: string, state: TrackerState) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + tripId, JSON.stringify(state));
  } catch {
    // Full or unavailable storage costs the resume, not the trip: the points are in the outbox.
  }
}

function forget(tripId: string) {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + tripId);
  } catch {
    // Nothing to do.
  }
}

const finite = (value: number | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** One fix into the trip's running state: the distance, the geofences, the route. */
function advance(track: TrackerState, point: TripLocationPoint, fences: FleetBootstrap['geofences']): { track: TrackerState; events: GeofenceEvent[] } {
  const at = point.recordedAtIso ?? new Date().toISOString();
  const accuracyM = point.accuracyMeters ?? null;
  const fix = { lat: point.lat, lng: point.lng, accuracyMeters: point.accuracyMeters, recordedAtIso: at };
  let { liveKm, anchor } = track;
  const usable = accuracyM === null || accuracyM <= MAX_ACCURACY_M;
  if (usable) {
    if (!anchor) anchor = fix;
    else {
      const delta = computeTripDistanceDeltaKm(anchor, fix);
      if (delta > 0) {
        liveKm += delta;
        anchor = fix;
      }
    }
  }
  const step = stepGeofences(track.geo, { lat: point.lat, lng: point.lng, accuracyM, at }, fences);
  return {
    track: {
      liveKm: Math.round(liveKm * 1000) / 1000,
      fixes: track.fixes + 1,
      lastFixAt: at,
      accuracyM,
      anchor,
      geo: step.state,
      arrivals: step.events.length ? [...track.arrivals, ...step.events].slice(-MAX_ARRIVALS) : track.arrivals,
      path: thin([...track.path, point], MAX_SAVED_PATH),
    },
    events: step.events,
  };
}

const queueArrivals = (tripId: string, events: GeofenceEvent[]) =>
  events.length
    ? enqueueGeofenceEvents(
        tripId,
        events.map((event) => ({ clientEventId: newClientId('gf'), geofenceId: event.geofenceId, type: event.type, at: event.at, lat: event.lat, lng: event.lng })),
      )
    : Promise.resolve();

/** Drained points that only need to reach the server (the trip is paused, ended or not on screen). */
const toOutbox = (tripId: string) => async (points: NativePoint[], gaps: NativeGap[]) => {
  await enqueuePoints(tripId, points.map(toClientPoint), gaps.map(toGapRecord));
  void flushQueue();
};

/**
 * The native recorder should hold only a trip that is still running. Called with the bootstrap's
 * running trip (or null): a fleet recording the server has since closed or paused — ended from the
 * web, force-closed by a manager — is stopped, and what it buffered goes to the outbox (the server
 * takes late points for 48 hours).
 */
export async function settleFleetRecording(runningTripId: string | null): Promise<void> {
  if (!nativeTrackingAvailable()) return;
  try {
    const status = await getStatus();
    if (!status.activeTripId || status.kind !== 'fleet' || status.activeTripId === runningTripId) return;
    const tripId = status.activeTripId;
    await stopTracking(tripId);
    await drainTrip(tripId, toOutbox(tripId));
  } catch {
    // The next bootstrap tries again.
  }
}

export interface TripTracker {
  /** The route as driven on this phone, for the live map. Empty when this phone joined late. */
  path: TripLocationPoint[];
  /** Distance, moving and stopped minutes of `path`, as a GPS trip's tiles. */
  summary: TripSummary;
  liveKm: number;
  fixes: number;
  lastFixAt: string | null;
  accuracyM: number | null;
  arrivals: GeofenceEvent[];
  insideNames: string[];
  error: string | null;
  tracking: boolean;
  /** Recording through the native recorder (an APK that has it). */
  native: boolean;
  /** Moves everything the native recorder buffered into the outbox (no-op without it). */
  flush: () => Promise<void>;
  /** Stops the native recorder and flushes it — for the end of the trip (no-op without it). */
  finish: () => Promise<void>;
}

export function useTripTracker(
  trip: FleetTrip | null,
  geofences: FleetBootstrap['geofences'],
  /** `onLongGap`: the native recorder was down for over ten minutes (the phone stopped it). */
  options: { onLongGap?: () => void } = {},
): TripTracker {
  const tripId = trip?.id ?? null;
  const onLongGapRef = useRef(options.onLongGap);
  useEffect(() => {
    onLongGapRef.current = options.onLongGap;
  });
  const running = trip?.status === 'running';
  const open = trip?.status === 'running' || trip?.status === 'paused';
  const [native] = useState(nativeTrackingAvailable);

  // The saved state of this trip, reloaded when the trip changes (during render, not in an effect).
  const [state, setState] = useState<TrackerState>(() => load(tripId));
  const [stateFor, setStateFor] = useState(tripId);
  if (stateFor !== tripId) {
    setStateFor(tripId);
    setState(load(tripId));
  }
  const [error, setError] = useState<string | null>(null);
  const [watchingFor, setWatchingFor] = useState<string | null>(null);
  /** The running effect's drain (it also updates the live route); null when none is running. */
  const drainRef = useRef<(() => Promise<unknown>) | null>(null);

  // The fences change identity on every bootstrap reload; the watch must not restart for that.
  const fencesRef = useRef(geofences);
  useEffect(() => {
    fencesRef.current = geofences;
  }, [geofences]);

  // A finished trip's saved state is no longer needed.
  useEffect(() => {
    if (tripId && trip && !open) forget(tripId);
  }, [tripId, trip, open]);

  /* ── the native recorder ── */
  useEffect(() => {
    if (!native || !tripId || !running) return undefined;
    let cancelled = false;
    let track = load(tripId);

    const consume = async (points: NativePoint[], gaps: NativeGap[]) => {
      // Into the outbox first: once it holds them, the recorder may mark them synced.
      await enqueuePoints(tripId, points.map(toClientPoint), gaps.map(toGapRecord));
      const events: GeofenceEvent[] = [];
      for (const point of points) {
        const step = advance(track, toRoutePoint(point), fencesRef.current);
        track = step.track;
        events.push(...step.events);
      }
      if (points.length) {
        save(tripId, track);
        if (!cancelled) {
          setState(track);
          setError(null);
        }
      }
      await queueArrivals(tripId, events);
      if (gapsNeedGuide(gaps)) onLongGapRef.current?.();
      void flushQueue();
    };
    const drain = () => drainTrip(tripId, consume).catch(() => 0);
    drainRef.current = drain;

    // A burst of fixes drains once.
    let soon: ReturnType<typeof setTimeout> | null = null;
    const drainSoon = () => {
      if (soon) return;
      soon = setTimeout(() => {
        soon = null;
        void drain();
      }, 1_500);
    };

    void (async () => {
      try {
        await startTracking(tripId, {
          kind: 'fleet',
          title: 'Trip running',
          message: `SEL Fleet is recording ${trip?.vehicleNumber ?? 'the vehicle'}'s route. Do not close this notification.`,
        });
        if (cancelled) return;
        setWatchingFor(tripId);
        setError(null);
        void drain();
      } catch (caught) {
        if (!cancelled) setError(trackingErrorMessage(caught));
      }
    })();

    const off = onTrackingEvent((event) => {
      if (event.type === 'fix' && event.tripId === tripId) drainSoon();
      if (event.type === 'trackingError' && event.tripId === tripId && !cancelled) setError(event.message || 'Trip tracking stopped.');
    });
    const timer = setInterval(() => void drain(), DRAIN_MS);
    // Back in the foreground: restart a recorder the phone stopped, then collect what it kept.
    const appState = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void resumeIfActive().catch(() => null).then(() => drain());
    });

    return () => {
      cancelled = true;
      off();
      clearInterval(timer);
      if (soon) clearTimeout(soon);
      void appState.then((handle) => handle.remove()).catch(() => undefined);
      if (drainRef.current === drain) drainRef.current = null;
      // Not stopped: the recording carries on without this page. What it has so far goes now.
      void drain();
    };
    // `trip.vehicleNumber` only labels the notification; restarting for it would be pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, tripId, running]);

  // Paused: the recorder stops until the trip is resumed (the effect above starts it again).
  useEffect(() => {
    if (!native || !tripId || trip?.status !== 'paused') return;
    void stopTracking(tripId)
      .then(() => drainTrip(tripId, toOutbox(tripId)))
      .catch(() => undefined);
  }, [native, tripId, trip?.status]);

  /* ── the in-app watcher (no native recorder) ── */
  useEffect(() => {
    if (native || !tripId || !running) return undefined;
    let cancelled = false;
    let watchId: DriverGeoWatchId | null = null;
    let track = load(tripId);
    let buffer: ClientPoint[] = [];

    const queueBuffer = async () => {
      if (!buffer.length) return;
      const batch = buffer;
      buffer = [];
      await enqueuePoints(tripId, batch);
      void flushQueue();
    };

    const onFix = (position: DriverGeoPosition) => {
      if (cancelled) return;
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const at = new Date(Number.isFinite(position.timestamp) ? position.timestamp : Date.now()).toISOString();
      const accuracyM = finite(position.coords.accuracy);
      const heading = finite(position.coords.heading);
      const speed = finite(position.coords.speed);
      const speedKmph = speed === null || speed < 0 ? null : Math.round(speed * 3.6 * 10) / 10;
      const headingDeg = heading === null || heading < 0 || heading > 360 ? null : heading;
      buffer.push({ clientPointId: newClientId('pt'), lat, lng, accuracyM, speedKmph, headingDeg, recordedAt: at });

      const step = advance(track, { lat, lng, accuracyMeters: accuracyM ?? undefined, speedKmph: speedKmph ?? undefined, headingDeg: headingDeg ?? undefined, recordedAtIso: at }, fencesRef.current);
      track = step.track;
      save(tripId, track);
      setState(track);
      setError(null);
      if (step.events.length) void queueArrivals(tripId, step.events).then(() => flushQueue());
      if (buffer.length >= BATCH_FIXES) void queueBuffer();
    };

    const timer = setInterval(() => void queueBuffer(), BATCH_MS);

    void (async () => {
      try {
        const id = await watchDriverPosition(
          {
            enableHighAccuracy: true,
            maximumAge: 5_000,
            timeout: 30_000,
            distanceFilterMeters: 10,
            // The notification is what keeps Android from suspending the watcher when the screen
            // locks, which is most of a drive.
            backgroundTitle: 'SEL Fleet trip running',
            backgroundMessage: `Tracking ${trip?.vehicleNumber ?? 'the vehicle'} for the trip log.`,
          },
          onFix,
          (failure) => {
            if (!cancelled) setError(failure.message || 'Location is not available.');
          },
        );
        if (cancelled) {
          await clearDriverPositionWatch(id);
          return;
        }
        watchId = id;
        setWatchingFor(tripId);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Location permission is needed to track the trip.');
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (watchId !== null) void clearDriverPositionWatch(watchId);
      void queueBuffer();
    };
    // `trip.vehicleNumber` only labels the notification; restarting the watch for it would drop fixes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, tripId, running]);

  const flush = useCallback(async () => {
    if (!native || !tripId) return;
    await (drainRef.current ? drainRef.current() : drainTrip(tripId, toOutbox(tripId)));
  }, [native, tripId]);

  const finish = useCallback(async () => {
    if (!native || !tripId) return;
    await stopTracking(tripId).catch(() => undefined);
    await drainTrip(tripId, toOutbox(tripId)).catch(() => 0);
  }, [native, tripId]);

  // Measured on the cleaned path, as a GPS trip's tiles are: one wild fix must not cost the legs
  // either side of it.
  const summary = useMemo(() => summariseTrip(cleanTripPath(state.path).points), [state.path]);

  const fences = new Map(geofences.map((fence) => [fence.id, fence.name]));
  const insideNames = Object.entries(state.geo.inside)
    .filter(([, inside]) => inside)
    .map(([id]) => fences.get(id))
    .filter((name): name is string => Boolean(name));

  return {
    path: state.path,
    summary,
    liveKm: Math.max(Math.round(state.liveKm * 10) / 10, trip?.gpsDistanceKm ?? 0),
    fixes: state.fixes,
    lastFixAt: state.lastFixAt,
    accuracyM: state.accuracyM,
    arrivals: state.arrivals,
    insideNames,
    error: running ? error : null,
    tracking: running && watchingFor === tripId,
    native,
    flush,
    finish,
  };
}
