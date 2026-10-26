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
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LocateFixed, Loader2, Square } from 'lucide-react';
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


  /* ── Restore a trip left running ── */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setInFlight(JSON.parse(saved) as InFlight);
    } catch {
      // Private browsing, or a shape from an older build. Starting fresh beats crashing.
    }
  }, []);

  useEffect(() => {
    try {
      if (inFlight) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(inFlight));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Unavailable storage costs resilience, not the recording in progress.
    }
  }, [inFlight]);

  /* ── Watch the position while a trip is running ── */
  useEffect(() => {
    if (!inFlight) return undefined;
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
    try {
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

      setInFlight({ startedAtIso: first.recordedAtIso!, details: values, tripDate: values.tripDate, startOdometer: values.startOdometer, notes: values.notes, fromPlace, points: [first] });
      setStartOpen(false);
      toast({ title: 'Recording', description: 'Keep this screen open while you drive.' });
    } catch (error: any) {
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
      const cleaned = cleanTripPath(inFlight.points);
      // The cleaned path, not the raw one: an outlier fix rejects the real legs on both sides of
      // it, so raw points under-measure a trip with a single bad reading.
      const measured = summariseTrip(cleaned.points);
      const last = cleaned.points[cleaned.points.length - 1] ?? inFlight.points[inFlight.points.length - 1];
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
  }, [inFlight, rules.requireOdometer]);

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
      action={
        // Full width on a phone, where a button beside the title leaves neither room.
        <Button variant="destructive" className="w-full sm:w-auto" onClick={() => void finishTrip()} disabled={stopping}>
          {stopping ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Square className="mr-1.5 h-4 w-4" />}
          Stop &amp; review
        </Button>
      }
      figures={{
        distanceKm: summary?.distanceKm ?? 0,
        movingMinutes: summary?.movingMinutes ?? 0,
        idleMinutes: summary?.idleMinutes ?? 0,
        fixes: inFlight.points.length,
      }}
      badges={<Badge variant="outline">{inFlight.details.ownership === 'own' ? 'Own vehicle' : 'Company vehicle'}</Badge>}
      fromPlace={inFlight.fromPlace}
      points={inFlight.points}
    />
  ) : null;

  return (
    <GpsTripContext.Provider
      value={{ recording, startOpen, setStartOpen, panel }}
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
            // Discarded after a confirmation: the recording is over, and nothing else holds it.
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
