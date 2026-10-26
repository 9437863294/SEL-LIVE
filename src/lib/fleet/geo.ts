/**
 * Geofences and the measured track of a fleet trip.
 *
 * Arrival and departure use a two-fix hysteresis: one fix across a boundary is not enough (GPS
 * wanders by tens of metres, more in a city), and leaving needs the vehicle a margin outside the
 * circle, so parking on the edge of a site does not flap in and out. The phone runs `stepGeofences`
 * as fixes arrive, for the driver's screen; the server reruns `detectGeofenceEvents` over the synced
 * track at the end, and its result is the record (spec §9, ASSUMPTIONS.md 20).
 *
 * Distances come from the trip path helpers Vehicle Management already uses (cleaned path, jitter
 * and outlier rejection), so the fleet and the existing trip screens measure a track the same way.
 */

import {
  cleanTripPath,
  computeTripDistanceDeltaKm,
  detectTripStops,
  haversineDistanceKm,
  type TripLocationPoint,
} from '../vehicle-management.ts';
import { istDateKey, minutesBetween, toMs } from './dates.ts';
import { round1, type ClientPoint, type Geofence, type GeofenceEvent, type GeofenceVisit } from './types.ts';

export const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => haversineDistanceKm(a, b) * 1000;

export interface GeofenceOptions {
  /** Consecutive fixes that must agree before a crossing counts. */
  confirmFixes?: number;
  /** Leaving means this far outside the circle. */
  exitBufferM?: number;
  /** Fixes less accurate than this are ignored for geofencing. */
  maxAccuracyM?: number;
}

type FenceLike = Pick<Geofence, 'id' | 'name' | 'kind' | 'lat' | 'lng' | 'radiusM'>;

/** The fence a point is in — the smallest, when circles overlap (a pump inside a yard). */
export function geofenceAt<T extends FenceLike>(point: { lat: number; lng: number }, fences: readonly T[]): T | null {
  let best: T | null = null;
  for (const fence of fences) {
    if (distanceMeters(point, fence) <= fence.radiusM && (!best || fence.radiusM < best.radiusM)) best = fence;
  }
  return best;
}

export interface GeofenceState {
  /** Fence id → inside. Unset until the first usable fix. */
  inside: Record<string, boolean>;
  /** Fence id → fixes in a row disagreeing with `inside`, and the first of them. */
  pending: Record<string, { count: number; at: string; lat: number; lng: number }>;
  started: boolean;
}

export const emptyGeofenceState = (): GeofenceState => ({ inside: {}, pending: {}, started: false });

type Fix = { lat: number; lng: number; accuracyM?: number | null; at: string };

/**
 * One fix through the hysteresis. The first usable fix only sets where the trip began (no events:
 * starting inside the office is not "arriving" there).
 */
export function stepGeofences(state: GeofenceState, fix: Fix, fences: readonly FenceLike[], options: GeofenceOptions = {}): { state: GeofenceState; events: GeofenceEvent[] } {
  const confirm = Math.max(1, options.confirmFixes ?? 2);
  const exitBuffer = Math.max(0, options.exitBufferM ?? 25);
  const maxAccuracy = options.maxAccuracyM ?? 100;
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) return { state, events: [] };
  if (typeof fix.accuracyM === 'number' && fix.accuracyM > maxAccuracy) return { state, events: [] };

  const next: GeofenceState = { inside: { ...state.inside }, pending: { ...state.pending }, started: true };
  const events: GeofenceEvent[] = [];
  for (const fence of fences) {
    const distance = distanceMeters(fix, fence);
    if (!state.started || next.inside[fence.id] === undefined) {
      next.inside[fence.id] = distance <= fence.radiusM;
      delete next.pending[fence.id];
      continue;
    }
    const wasInside = next.inside[fence.id];
    const nowInside = wasInside ? distance <= fence.radiusM + exitBuffer : distance <= fence.radiusM;
    if (nowInside === wasInside) {
      delete next.pending[fence.id];
      continue;
    }
    const pending = next.pending[fence.id] ?? { count: 0, at: fix.at, lat: fix.lat, lng: fix.lng };
    const count = pending.count + 1;
    if (count >= confirm) {
      next.inside[fence.id] = nowInside;
      delete next.pending[fence.id];
      // Timed at the first fix across the line, not the one that confirmed it.
      events.push({ geofenceId: fence.id, geofenceName: fence.name, kind: fence.kind, type: nowInside ? 'enter' : 'exit', at: pending.at, lat: pending.lat, lng: pending.lng });
    } else {
      next.pending[fence.id] = { ...pending, count };
    }
  }
  return { state: next, events };
}

/** Every crossing along a track, in time order. */
export function detectGeofenceEvents(points: readonly Fix[], fences: readonly FenceLike[], options: GeofenceOptions = {}): { events: GeofenceEvent[]; state: GeofenceState } {
  let state = emptyGeofenceState();
  const events: GeofenceEvent[] = [];
  const ordered = [...points].sort((a, b) => toMs(a.at) - toMs(b.at));
  for (const fix of ordered) {
    const step = stepGeofences(state, fix, fences, options);
    state = step.state;
    events.push(...step.events);
  }
  return { events, state };
}

/** Arrivals paired with departures: where the vehicle went, and how long it stayed. */
export function visitsFromEvents(events: readonly GeofenceEvent[], endAt: string | null): GeofenceVisit[] {
  const open = new Map<string, GeofenceVisit>();
  const visits: GeofenceVisit[] = [];
  for (const event of [...events].sort((a, b) => toMs(a.at) - toMs(b.at))) {
    if (event.type === 'enter') {
      const visit: GeofenceVisit = { geofenceId: event.geofenceId, name: event.geofenceName, kind: event.kind, enterAt: event.at, exitAt: null, minutes: 0 };
      open.set(event.geofenceId, visit);
      visits.push(visit);
    } else {
      const visit = open.get(event.geofenceId);
      if (visit) {
        visit.exitAt = event.at;
        visit.minutes = Math.max(0, Math.round(minutesBetween(visit.enterAt, event.at)));
        open.delete(event.geofenceId);
      }
    }
  }
  for (const visit of open.values()) {
    if (endAt) visit.minutes = Math.max(0, Math.round(minutesBetween(visit.enterAt, endAt)));
  }
  return visits;
}

export const toTrackPoint = (point: Pick<ClientPoint, 'lat' | 'lng' | 'accuracyM' | 'speedKmph' | 'headingDeg' | 'recordedAt'>): TripLocationPoint => ({
  lat: point.lat,
  lng: point.lng,
  accuracyMeters: point.accuracyM ?? undefined,
  speedKmph: point.speedKmph ?? undefined,
  headingDeg: point.headingDeg ?? undefined,
  recordedAtIso: point.recordedAt,
});

export interface TrackMeasure {
  gpsKm: number;
  /** The same km by the IST date each leg was driven on. */
  kmByDate: Record<string, number>;
  pointCount: number;
  usablePoints: number;
  idleMinutes: number;
  movingMinutes: number;
  /** Silences longer than the gap threshold, and the longest one. */
  gapCount: number;
  longestGapMinutes: number;
  longestStopMinutes: number;
  first: TripLocationPoint | null;
  last: TripLocationPoint | null;
}

/**
 * The measured trip: cleaned first (accuracy, jitter, impossible jumps), then summed leg by leg, so
 * one wild fix cannot cost the real legs on either side of it.
 */
export function measureTrack(points: readonly TripLocationPoint[], options: { gapMinutes: number; startedAt?: string; endedAt?: string | null }): TrackMeasure {
  const ordered = [...points].sort((a, b) => toMs(a.recordedAtIso) - toMs(b.recordedAtIso));
  const cleaned = cleanTripPath(ordered).points;
  const kmByDate: Record<string, number> = {};
  let total = 0;
  for (let index = 1; index < cleaned.length; index += 1) {
    const delta = computeTripDistanceDeltaKm(cleaned[index - 1], cleaned[index]);
    if (delta <= 0) continue;
    total += delta;
    const day = istDateKey(cleaned[index].recordedAtIso ?? cleaned[index - 1].recordedAtIso ?? new Date().toISOString());
    kmByDate[day] = (kmByDate[day] ?? 0) + delta;
  }
  for (const day of Object.keys(kmByDate)) kmByDate[day] = round1(kmByDate[day]);

  // Gaps include the stretch from the start of the trip to the first fix, and from the last fix
  // to its end: a phone that never tracked at all is the worst gap of all.
  const times = ordered.map((point) => toMs(point.recordedAtIso)).filter(Number.isFinite);
  if (options.startedAt && Number.isFinite(toMs(options.startedAt))) times.unshift(toMs(options.startedAt));
  if (options.endedAt && Number.isFinite(toMs(options.endedAt))) times.push(toMs(options.endedAt));
  times.sort((a, b) => a - b);
  let gapCount = 0;
  let longestGap = 0;
  for (let index = 1; index < times.length; index += 1) {
    const minutes = (times[index] - times[index - 1]) / 60_000;
    if (minutes > options.gapMinutes) gapCount += 1;
    longestGap = Math.max(longestGap, minutes);
  }

  const stops = detectTripStops(cleaned, { radiusMeters: 60, minMinutes: 3 });
  const idleMinutes = stops.reduce((sum, stop) => sum + stop.minutes, 0);
  const span = times.length > 1 ? (times[times.length - 1] - times[0]) / 60_000 : 0;
  return {
    gpsKm: round1(total),
    kmByDate,
    pointCount: ordered.length,
    usablePoints: cleaned.length,
    idleMinutes: Math.round(idleMinutes),
    movingMinutes: Math.max(0, Math.round(span - idleMinutes)),
    gapCount,
    longestGapMinutes: Math.round(longestGap),
    longestStopMinutes: Math.round(stops.reduce((max, stop) => Math.max(max, stop.minutes), 0)),
    first: cleaned[0] ?? null,
    last: cleaned[cleaned.length - 1] ?? null,
  };
}

/**
 * Spread a trip's billable km over the days it ran, in the proportions GPS measured them. Without
 * a usable track everything counts on the day the trip started.
 */
export function attributeKm(billableKm: number, gpsKmByDate: Record<string, number>, startDateKey: string): Record<string, number> {
  const gpsTotal = Object.values(gpsKmByDate).reduce((sum, km) => sum + km, 0);
  if (billableKm <= 0) return {};
  if (gpsTotal <= 0) return { [startDateKey]: round1(billableKm) };
  const days = Object.keys(gpsKmByDate).sort();
  const out: Record<string, number> = {};
  let assigned = 0;
  days.forEach((day, index) => {
    const share = index === days.length - 1 ? round1(billableKm - assigned) : round1((billableKm * gpsKmByDate[day]) / gpsTotal);
    assigned += share;
    if (share > 0) out[day] = share;
  });
  return out;
}
