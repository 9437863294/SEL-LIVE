'use client';

/**
 * Recording a claimable trip by driving it.
 *
 * Mounted on Fleet Trip (fleet-home.tsx) for the "Own vehicle" answer to "Which vehicle are you
 * using?": Fleet Trip is the one place a trip is recorded, and My Trips only lists and claims what
 * this saves. A company vehicle is recorded on the same screen as a fleet trip — a separate
 * calculation.
 *
 * ── Why this replaced the separate GPS page ─────────────────────────────────────────────────────
 *
 * There were two screens recording the same journey. `/driver-management/trips` measured a route
 * accurately with GPS and wrote it to the vehicle-tracking collection, where no claim could reach
 * it; My Trips held the claim, with the distance **typed in by hand**. So the one number that
 * decides what a trip is worth was keyed from memory while the phone in the same pocket had
 * measured it. This is the two joined: the trip you drive is the trip you claim.
 *
 * ── The details are captured before the wheels turn ─────────────────────────────────────────────
 *
 * Purpose, vehicle and project are asked for at the start, not the end. Partly because they are
 * known then and forgotten later, and partly because a trip recorded without them is not a claim —
 * it is a line somebody has to go back and complete. The starting place is reverse-geocoded, so
 * the driver types the things only they know.
 *
 * The start is own-start-dialog.tsx — the same shape as a company-vehicle trip's start: today's
 * date, the starting place from the phone, the vehicle (one tap on a vehicle from earlier trips),
 * purpose, project, and the opening reading when Trip rules require one.
 *
 * ── Stop & review, then save ────────────────────────────────────────────────────────────────────
 *
 * Stopping opens own-review-dialog.tsx rather than writing a draft straight away: a human sees the
 * distance before it becomes money. It runs the same rules the server does (`validateTrip`,
 * `priceTrip`), shows the amount, and saves the measurement alongside as `gps`, so an approver can
 * tell a measured trip from a typed one. (These replaced the full trip form's old GPS modes; that
 * form now only edits a recorded trip.)
 *
 * ── Recording with the screen locked ────────────────────────────────────────────────────────────
 *
 * In an SEL Driver APK that carries the native recorder (src/lib/trip-tracking), the route is
 * recorded by a foreground service into the phone's SQLite, under a local `recorderId`, whether or
 * not this page is alive; the provider drains it into the trip's route (stored at once, before the
 * recorder is told it may let the points go), and Stop & review stops it and collects the rest
 * first. Without it (an older APK, the browser) the in-app watcher records, as before.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { App } from '@capacitor/app';
import { LocateFixed, Loader2, Square } from 'lucide-react';
import { SyncingLabel, TripTrackingChip } from '@/components/driver-management/tracking/tracking-status-chip';
import { useTrackingReadiness } from '@/components/driver-management/tracking/tracking-readiness';
import { gapsNeedGuide, toRoutePoint, type NativeGap, type NativePoint } from '@/lib/trip-tracking/rules';
import {
  TrackingPermissionError,
  discardBuffered,
  drainTrip,
  getStatus,
  nativeTrackingAvailable,
  onTrackingEvent,
  resumeIfActive,
  startTracking,
  stopTracking,
  trackingErrorMessage,
} from '@/lib/trip-tracking/tracking';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  clearDriverPositionWatch,
  ensureDriverGeolocation,
  getCurrentDriverPosition,
  watchDriverPosition,
  type DriverGeoPosition,
  type DriverGeoWatchId,
} from '@/lib/driver-mobile-geolocation';
import {
  cleanTripPath,
  summariseTrip,
  toKmph,
  type TripLocationPoint,
} from '@/lib/vehicle-management';
import { normaliseVehicleNumber, type TripGpsEvidence, type TripRecord, type VehicleOwnership } from '@/lib/employee-trips/types';
import { LiveRecordingCard } from '../live-recording-card';
import { reverseGeocode, type Bootstrap } from './trip-api';
import { OwnReviewDialog, type OwnReview } from './own-review-dialog';
import { OwnStartDialog } from './own-start-dialog';

/** Survives a backgrounded tab or an accidental reload — losing a driven trip is unforgivable. */
const STORAGE_KEY = 'driver-management.gps-trip.v1';

/** Firestore caps a document at 1 MB; a four-hour drive at one fix per 10s is 1,440 points. */
const MAX_SAVED_PATH_POINTS = 500;

interface StartDetails {
  ownership: VehicleOwnership;
  vehicleType: string;
  vehicleNumber: string;
  vehicleId: string | null;
  purpose: string;
  projectId: string | null;
  departmentId: string | null;
}

interface InFlight {
  startedAtIso: string;
  details: StartDetails;
  /** Everything else the form collected at the start, carried through to the review. */
  tripDate: string;
  startOdometer: string | null;
  notes: string;
  fromPlace: string;
  points: TripLocationPoint[];
  /**
   * The native recorder's key for this recording (an own trip has no server id until it is saved).
   * Absent on a trip recorded by the in-app watcher.
   */
  recorderId?: string;
}

/** What the native recorder's notification says while an own-vehicle trip records. */
const OWN_RECORDING = { kind: 'own', title: 'Trip running', message: 'SEL Fleet is recording your route. Do not close this notification.' } as const;

const newRecorderId = () => `own_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The newest fix's time, for the status chip when there is no native recorder to ask. */
const lastFixMs = (points: TripLocationPoint[]): number | null => {
  const at = points[points.length - 1]?.recordedAtIso;
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** Written at once (not after the next render), so a drained batch is stored before it is acknowledged. */
function persistInFlight(inFlight: InFlight | null) {
  try {
    if (inFlight) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(inFlight));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Unavailable storage costs resilience, not the recording in progress.
  }
}

/** Evenly spaced, keeping both ends — a route thinned in the middle still reads as the same route. */
function downsample(points: TripLocationPoint[], limit: number): Array<{ lat: number; lng: number }> {
  if (points.length <= limit) return points.map((point) => ({ lat: point.lat, lng: point.lng }));
  const step = (points.length - 1) / (limit - 1);
  const out: Array<{ lat: number; lng: number }> = [];
  for (let index = 0; index < limit; index += 1) {
    const point = points[Math.round(index * step)];
    out.push({ lat: point.lat, lng: point.lng });
  }
  return out;
}


/**
 * Shared so the button and the live panel can sit in different parts of the page.
 *
 * They were one component mounted in the page header's actions slot — which meant that the
 * moment recording started, a whole Card rendered inside a row sized for buttons. On a phone that
 * squeezed the map, the figures and the address into a column about a hundred pixels wide.
 */
interface GpsTripContextValue {
  recording: boolean;
  startOpen: boolean;
  setStartOpen: (open: boolean) => void;
  panel: ReactNode;
}

const GpsTripContext = createContext<GpsTripContextValue | null>(null);

/**
 * Start a recording from elsewhere on the page — Fleet Trip's "Which vehicle?" prompt. `available`
 * is false outside the provider (the trip-claims settings have not loaded yet).
 */
export function useGpsTripControls(): { available: boolean; recording: boolean; start: () => void } {
  const context = useContext(GpsTripContext);
  return {
    available: Boolean(context),
    recording: Boolean(context?.recording),
    start: () => context?.setStartOpen(true),
  };
}

/** The button for the page header. Never renders anything but a button. */
export function GpsTripButton() {
  const context = useContext(GpsTripContext);
  if (!context || context.recording) return null;
  return (
    // No `w-full`: a full-width direct child of PageHeader actions takes a whole row from `sm` up.
    <Button type="button" variant="outline" onClick={() => context.setStartOpen(true)}>
      <LocateFixed className="mr-2 h-4 w-4" aria-hidden />
      Drive &amp; record
    </Button>
  );
}

/** The live recording card, for the page body where it has room. */
export function GpsTripPanel() {
  return useContext(GpsTripContext)?.panel ?? null;
}

export function GpsTripProvider({
  data,
  myTrips,
  onSaved,
  onRecordingChange,
  ownership,
  children,
}: {
  data: Bootstrap;
  /** Record only this kind of vehicle (Fleet Trip's own-vehicle mode passes 'own'). */
  ownership?: VehicleOwnership;
  myTrips: TripRecord[];
  onSaved: (trip: TripRecord) => void;
  /**
   * Told whenever a recording starts or ends.
   *
   * A callback rather than a hook the page reads, because the page renders this provider and so
   * sits outside its own context. Splitting the page in two to get at the value would be a lot
   * of restructuring for one boolean.
   */
  onRecordingChange?: (recording: boolean) => void;
  children: ReactNode;
}) {
  const { toast } = useToast();
  const rules = data.settings.rules;

  const [startOpen, setStartOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [inFlight, setInFlight] = useState<InFlight | null>(null);
  const [stopping, setStopping] = useState(false);
  const [review, setReview] = useState<OwnReview | null>(null);
  const watchRef = useRef<DriverGeoWatchId | null>(null);
  const readiness = useTrackingReadiness();
  /** Recording through the phone's native recorder (an APK that has it), not the in-app watcher. */
  const [native] = useState(nativeTrackingAvailable);
  /** The trip as last persisted — the native drain appends to it and writes it before acknowledging. */
  const inFlightRef = useRef<InFlight | null>(null);
  /** The running drain (null when none). */
  const drainRef = useRef<(() => Promise<unknown>) | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  /* ── Restore a trip left running ── */
  useEffect(() => {
    let restored: InFlight | null = null;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        restored = JSON.parse(saved) as InFlight;
        // A trip begun by the in-app watcher continues on the native recorder under a new id.
        if (native && !restored.recorderId) restored = { ...restored, recorderId: newRecorderId() };
        setInFlight(restored);
      }
    } catch {
      // Private browsing, or a shape from an older build. Starting fresh beats crashing.
    }
    // The recorder holds only the trip this phone is recording; an own trip it still holds that is
    // not ours any more (storage cleared, or a stale one) is stopped and dropped.
    if (native) {
      void getStatus()
        .then(async (status) => {
          if (!status.activeTripId || status.kind !== 'own' || status.activeTripId === restored?.recorderId) return;
          await stopTracking(status.activeTripId);
          await discardBuffered(status.activeTripId);
        })
        .catch(() => undefined);
    }
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    inFlightRef.current = inFlight;
    persistInFlight(inFlight);
  }, [inFlight]);

  /* ── The native recorder: it records on its own; this collects what it buffered ── */
  const recorderId = native ? inFlight?.recorderId ?? null : null;
  useEffect(() => {
    if (!recorderId) return undefined;
    let cancelled = false;

    // Onto the trip's route, written to storage before the recorder is told it may let them go.
    const consume = async (points: NativePoint[], gaps: NativeGap[]) => {
      const base = inFlightRef.current;
      if (base && base.recorderId === recorderId && points.length) {
        const next = { ...base, points: [...base.points, ...points.map(toRoutePoint)] };
        inFlightRef.current = next;
        persistInFlight(next);
        if (!cancelled) setInFlight(next);
      }
      // The phone stopped the recorder for a long stretch: show its maker's steps again.
      if (gapsNeedGuide(gaps)) readiness.showGuideAfterGap();
    };
    const drain = () => drainTrip(recorderId, consume).catch(() => 0);
    drainRef.current = drain;

    let soon: ReturnType<typeof setTimeout> | null = null;
    const drainSoon = () => {
      if (soon) return;
      soon = setTimeout(() => {
        soon = null;
        void drain();
      }, 1_500);
    };

    // Started by beginTrip; this makes sure of it for a trip restored after a reload (idempotent).
    void startTracking(recorderId, OWN_RECORDING)
      .then(() => {
        if (!cancelled) setTrackError(null);
        return drain();
      })
      .catch((error) => {
        if (!cancelled) setTrackError(trackingErrorMessage(error));
      });

    const off = onTrackingEvent((event) => {
      if (event.type === 'fix' && event.tripId === recorderId) drainSoon();
      if (event.type === 'trackingError' && event.tripId === recorderId && !cancelled) setTrackError(event.message || 'Trip tracking stopped.');
    });
    const timer = setInterval(() => void drain(), 15_000);
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
      void drain();
    };
    // `readiness` is stable (memoised in its provider).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderId]);

  /* ── The in-app watcher (no native recorder) ── */
  useEffect(() => {
    if (!inFlight || native) return undefined;
    let cancelled = false;

    const start = async () => {
      const id = await watchDriverPosition(
        {
          enableHighAccuracy: true,
          // A notification is what keeps Android from suspending the watcher the moment the
          // driver's screen locks, which is most of a drive.
          backgroundTitle: 'Recording your trip',
          backgroundMessage: 'Distance is being measured for your claim.',
        },
        (position: DriverGeoPosition) => {
        if (cancelled) return;
        setInFlight((current) =>
          current
            ? {
                ...current,
                points: [
                  ...current.points,
                  {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracyMeters: position.coords.accuracy ?? undefined,
                    speedKmph: toKmph(position.coords.speed),
                    headingDeg: position.coords.heading ?? undefined,
                    recordedAtIso: new Date().toISOString(),
                  },
                ],
              }
            : current,
        );
        },
      );
      if (cancelled) await clearDriverPositionWatch(id);
      else watchRef.current = id;
    };

    void start();
    return () => {
      cancelled = true;
      if (watchRef.current !== null) {
        void clearDriverPositionWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [Boolean(inFlight)]); // eslint-disable-line react-hooks/exhaustive-deps

  const recording = Boolean(inFlight);
  useEffect(() => {
    onRecordingChange?.(recording);
    // Deliberately not depending on the callback: a page that passes an inline arrow would
    // otherwise fire this on every render of theirs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  // Measured on the cleaned path, as the saved figure is: one wild fix must not cost the legs
  // either side of it (tests/trip-path.test.mjs).
  const summary = useMemo(
    () => (inFlight ? summariseTrip(cleanTripPath(inFlight.points).points) : null),
    [inFlight],
  );

  const beginTrip = async (values: StartDetails & { tripDate: string; fromPlace: string; startOdometer: string | null; notes: string }) => {
    setStarting(true);
    // Started before the trip exists, so a refusal (a permission taken away since the gate) leaves
    // nothing half-begun.
    const recorderId = native ? newRecorderId() : undefined;
    try {
      if (recorderId) {
        try {
          await startTracking(recorderId, OWN_RECORDING);
        } catch (error) {
          if (error instanceof TrackingPermissionError) readiness.openGate();
          throw new Error(trackingErrorMessage(error));
        }
      }
      await ensureDriverGeolocation();
      const position = await getCurrentDriverPosition();
      const first: TripLocationPoint = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyMeters: position.coords.accuracy ?? undefined,
        speedKmph: toKmph(position.coords.speed),
        headingDeg: position.coords.heading ?? undefined,
        recordedAtIso: new Date().toISOString(),
      };
      // The driver typed a starting place in the form; reverse-geocoding only fills a blank one.
      const fromPlace = values.fromPlace.trim() || (await reverseGeocode(first.lat, first.lng));

      setInFlight({ startedAtIso: first.recordedAtIso!, details: values, tripDate: values.tripDate, startOdometer: values.startOdometer, notes: values.notes, fromPlace, points: [first], ...(recorderId ? { recorderId } : {}) });
      setStartOpen(false);
      toast({
        title: 'Recording',
        description: recorderId ? 'You can lock the phone — the route records in the background. Keep the “Trip running” notification.' : 'Keep this screen open while you drive.',
      });
    } catch (error: any) {
      if (recorderId) void stopTracking(recorderId).then(() => discardBuffered(recorderId)).catch(() => undefined);
      toast({
        title: 'Could not start',
        description: error?.message || 'Location permission is needed to record a trip.',
        variant: 'destructive',
      });
    } finally {
      setStarting(false);
    }
  };

  const finishTrip = useCallback(async () => {
    if (!inFlight) return;
    setStopping(true);
    try {
      // The recording ends here: stop the recorder, then collect everything it still holds, so the
      // review measures the whole route.
      if (native && inFlight.recorderId) {
        await stopTracking(inFlight.recorderId).catch(() => undefined);
        await (drainRef.current ? drainRef.current() : Promise.resolve());
      }
      const recorded = inFlightRef.current ?? inFlight;
      const cleaned = cleanTripPath(recorded.points);
      // The cleaned path, not the raw one: an outlier fix rejects the real legs on both sides of
      // it, so raw points under-measure a trip with a single bad reading.
      const measured = summariseTrip(cleaned.points);
      const last = cleaned.points[cleaned.points.length - 1] ?? recorded.points[recorded.points.length - 1];
      const toPlace = last ? await reverseGeocode(last.lat, last.lng) : '';

      const gps: TripGpsEvidence = {
        measuredKm: measured.distanceKm,
        startedAtIso: inFlight.startedAtIso,
        endedAtIso: new Date().toISOString(),
        movingMinutes: measured.movingMinutes,
        idleMinutes: measured.idleMinutes,
        stopCount: measured.stops.length,
        fixes: cleaned.points.length,
        droppedFixes: cleaned.rawCount - cleaned.points.length,
        path: downsample(cleaned.points, MAX_SAVED_PATH_POINTS),
      };

      setReview({
        gps,
        tripDate: inFlight.tripDate,
        vehicleType: inFlight.details.vehicleType,
        vehicleNumber: inFlight.details.vehicleNumber,
        fromPlace: inFlight.fromPlace,
        toPlace,
        purpose: inFlight.details.purpose,
        projectId: inFlight.details.projectId,
        departmentId: inFlight.details.departmentId,
        // Taken at the start when Trip rules require readings; the review then asks for the closing
        // one and shows the GPS figure beside it. Otherwise it offers the measured distance.
        startOdometer: rules.requireOdometer ? inFlight.startOdometer : null,
        notes: inFlight.notes,
        movingMinutes: measured.movingMinutes,
        idleMinutes: measured.idleMinutes,
      });
    } finally {
      setStopping(false);
    }
  }, [inFlight, native, rules.requireOdometer]);

  /* ── Idle ── */
  /*
    The live card, handed to the page body through context.

    It used to be returned from this component directly, which put it wherever the component was
    mounted — the page header’s actions row. A map and four figures inside a row sized for
    buttons is unreadable on a desktop and unusable on a phone.
  */
  const panel = inFlight ? (
    <LiveRecordingCard
      description={inFlight.details.purpose}
      startedAt={inFlight.startedAtIso}
      action={
        // A compact pill beside the title (the card's layout). Review waits until the recorder
        // has handed over every fix ("Syncing N points…").
        <Button variant="destructive" size="sm" className="rounded-full px-4" onClick={() => void finishTrip()} disabled={stopping}>
          {stopping ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Square className="mr-1.5 h-4 w-4" />}
          <SyncingLabel tripId={recorderId} active={stopping} idle="Stop & review" />
        </Button>
      }
      figures={{
        distanceKm: summary?.distanceKm ?? 0,
        movingMinutes: summary?.movingMinutes ?? 0,
        idleMinutes: summary?.idleMinutes ?? 0,
        fixes: inFlight.points.length,
      }}
      badges={
        <>
          <Badge variant="outline">{inFlight.details.ownership === 'own' ? 'Own vehicle' : 'Company vehicle'}</Badge>
          <TripTrackingChip
            tripId={recorderId}
            fallback={{
              tracking: true,
              error: trackError,
              lastFixAt: lastFixMs(inFlight.points),
              accuracyM: inFlight.points[inFlight.points.length - 1]?.accuracyMeters ?? null,
              startedAt: Date.parse(inFlight.startedAtIso) || null,
            }}
            onFix={readiness.openGate}
          />
        </>
      }
      fromPlace={inFlight.fromPlace}
      points={inFlight.points}
    />
  ) : null;

  // Opening the start asks the phone first (permissions, the maker's steps) — every way in: the
  // "Which vehicle?" prompt, a ?kind=own link, the header button.
  const openStart = (open: boolean) => {
    if (!open) return setStartOpen(false);
    void readiness.ensureReady().then((ready) => ready && setStartOpen(true));
  };

  return (
    <GpsTripContext.Provider
      value={{ recording, startOpen, setStartOpen: openStart, panel }}
    >
      {children}

      {/*
        The own-vehicle start and review (own-start-dialog.tsx, own-review-dialog.tsx) — the same
        shape as a company-vehicle trip's on Fleet Trip. The full trip form is for editing a trip
        already recorded, on My Trips.
      */}
      {startOpen && !inFlight && <OwnStartDialog open onOpenChange={setStartOpen} data={data} myTrips={myTrips} starting={starting} onStart={(values) => void beginTrip(values)} />}

      {review && (
        <OwnReviewDialog
          open
          data={data}
          review={review}
          onDiscard={() => {
            // Discarded after a confirmation: the recording is over, and nothing else holds it —
            // the native recorder's copy goes too.
            if (inFlight?.recorderId) {
              const id = inFlight.recorderId;
              void stopTracking(id).then(() => discardBuffered(id)).catch(() => undefined);
            }
            setReview(null);
            setInFlight(null);
          }}
          onSaved={(trip) => {
            setReview(null);
            setInFlight(null);
            onSaved(trip);
          }}
        />
      )}
    </GpsTripContext.Provider>
  );
}
