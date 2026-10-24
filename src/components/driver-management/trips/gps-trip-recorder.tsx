'use client';

/**
 * Recording a claimable trip by driving it.
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
 * Own vehicles are first-class: the ownership choice is in the start sheet, so an employee using
 * their own car gets a measured distance exactly as a company driver does.
 *
 * ── Stopping opens the ordinary form ────────────────────────────────────────────────────────────
 *
 * The measured figures are handed to `TripFormDialog` as a prefill rather than written straight to
 * a draft. That reuses the validation, the rate preview and the project pickers that already
 * exist — a second form would drift from them — and it means a human sees the distance before it
 * becomes money. What was measured is saved alongside as `gps`, so an approver can tell a measured
 * trip from a typed one.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LocateFixed, Loader2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import TripMapView from '@/components/vehicle-management/trip-map-view';
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
import { reverseGeocode, type Bootstrap } from './trip-api';
import { TripFormDialog } from './trip-form-dialog';

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

/** The button for the page header. Never renders anything but a button. */
export function GpsTripButton() {
  const context = useContext(GpsTripContext);
  if (!context || context.recording) return null;
  return (
    // No `w-full`: a full-width direct child of PageHeader actions takes a whole row from `sm` up.
    <Button type="button" variant="outline" onClick={() => context.setStartOpen(true)}>
      <LocateFixed className="mr-2 h-4 w-4" aria-hidden />
      Record by GPS
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
  children,
}: {
  data: Bootstrap;
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
  const [review, setReview] = useState<{ prefill: Record<string, unknown>; gps: TripGpsEvidence } | null>(null);
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

  const summary = useMemo(
    () => (inFlight ? summariseTrip(inFlight.points) : null),
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
      const measured = summariseTrip(inFlight.points);
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
        prefill: {
          ownership: inFlight.details.ownership,
          vehicleType: inFlight.details.vehicleType,
          vehicleNumber: inFlight.details.vehicleNumber,
          vehicleId: inFlight.details.vehicleId,
          tripDate: inFlight.tripDate,
          startOdometer: inFlight.startOdometer,
          notes: inFlight.notes,
          fromPlace: inFlight.fromPlace,
          toPlace,
          purpose: inFlight.details.purpose,
          projectId: inFlight.details.projectId,
          departmentId: inFlight.details.departmentId,
          // The measured figure, entered as the distance — and `useDistance` so the form takes it
          // rather than deriving one from odometer readings nobody took.
          distanceKm: String(measured.distanceKm),
          useDistance: true,
        },
      });
    } finally {
      setStopping(false);
    }
  }, [inFlight]);

  /* ── Idle ── */
  /*
    The live card, handed to the page body through context.

    It used to be returned from this component directly, which put it wherever the component was
    mounted — the page header’s actions row. A map and four figures inside a row sized for
    buttons is unreadable on a desktop and unusable on a phone.
  */
  const panel = inFlight ? (
    <Card className="w-full">
      <CardHeader className="gap-2 pb-2 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Recording a trip
          </CardTitle>
          <CardDescription className="break-words">{inFlight.details.purpose}</CardDescription>
        </div>
        {/* Full width on a phone, where a button beside the title leaves neither room. */}
        <Button
          variant="destructive"
          className="w-full sm:w-auto"
          onClick={() => void finishTrip()}
          disabled={stopping}
        >
          {stopping ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Square className="mr-1.5 h-4 w-4" />}
          Stop &amp; review
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Two across on a phone rather than four: four columns of 90px wrap every number. */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { label: 'Distance', value: `${(summary?.distanceKm ?? 0).toFixed(1)} km` },
            { label: 'Moving', value: `${Math.round(summary?.movingMinutes ?? 0)} min` },
            { label: 'Stopped', value: `${Math.round(summary?.idleMinutes ?? 0)} min` },
            { label: 'Fixes', value: String(inFlight.points.length) },
          ].map((tile) => (
            <div key={tile.label} className="rounded-xl border border-white/70 bg-white/80 p-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{tile.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800">{tile.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-start gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline">{inFlight.details.ownership === 'own' ? 'Own vehicle' : 'Company vehicle'}</Badge>
          {inFlight.fromPlace && (
            // `min-w-0` with the wrap above: a full street address is long, and without it the
            // address forced the card wider than the phone.
            <span className="min-w-0 break-words">from {inFlight.fromPlace}</span>
          )}
        </div>

        <TripMapView points={inFlight.points} title="Live route" heightClassName="h-[260px] sm:h-[300px]" live />
      </CardContent>
    </Card>
  ) : null;

  return (
    <GpsTripContext.Provider
      value={{ recording, startOpen, setStartOpen, panel }}
    >
      {children}

      {/*
        The same form as Record a trip, in `gps-start` mode. One form means the answer to "what
        does a trip need" cannot differ depending on how the trip was started.
      */}
      {startOpen && !inFlight && (
        <TripFormDialog
          open
          onOpenChange={setStartOpen}
          data={data}
          trip={null}
          myTrips={myTrips}
          mode="gps-start"
          onStart={(values) => void beginTrip(values)}
          onSaved={() => undefined}
        />
      )}

      {review && (
        <TripFormDialog
          open
          onOpenChange={(open) => {
            if (open) return;
            // Closing without saving keeps nothing: the recording is over, and a half-saved trip
            // is worse than one the driver re-enters by hand.
            setReview(null);
            setInFlight(null);
          }}
          data={data}
          trip={null}
          myTrips={myTrips}
          prefill={review.prefill as never}
          gps={review.gps}
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
