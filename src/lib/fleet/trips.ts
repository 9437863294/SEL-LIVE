/**
 * The rules of a fleet trip: what the odometer must say, which distance is billed, what it costs,
 * what is flagged, and who may do what with it. The server applies these inside its transactions;
 * the phone runs the same checks so the driver hears about a problem before sending.
 */

import { attributeKm } from './geo.ts';
import { minutesBetween } from './dates.ts';
import {
  OPEN_TRIP_STATUSES,
  round1,
  round2,
  type BillableSource,
  type FleetSettings,
  type FleetTrip,
  type FleetVehicle,
  type TripCost,
  type TripFlagCode,
} from './types.ts';

/** No single trip is longer than this; a slip on the odometer keypad is the usual cause. */
export const MAX_TRIP_KM = 2000;

export class FleetRuleError extends Error {
  readonly field: string | null;

  constructor(message: string, field: string | null = null) {
    super(message);
    this.name = 'FleetRuleError';
    this.field = field;
  }
}

/* ── odometer ──────────────────────────────────────────────────────────── */

export interface StartOdometerCheck {
  /** Km the vehicle ran since its last closing reading with no trip — flagged past the tolerance. */
  unloggedKm: number;
  flags: TripFlagCode[];
}

/**
 * An opening reading may not be below the vehicle's last one: the odometer never runs backwards.
 * A replaced or reset meter is an admin's baseline, not a driver's typing.
 */
export function checkStartOdometer(startKm: number, vehicle: Pick<FleetVehicle, 'currentOdometerKm' | 'vehicleNumber'>, settings: Pick<FleetSettings, 'unloggedKmTolerance'>): StartOdometerCheck {
  if (!Number.isFinite(startKm) || startKm < 0) throw new FleetRuleError('Enter the odometer reading.', 'startOdometerKm');
  const last = vehicle.currentOdometerKm;
  if (last !== null && startKm < last) {
    throw new FleetRuleError(
      `${vehicle.vehicleNumber} last read ${Math.round(last).toLocaleString('en-IN')} km — the reading cannot go down. If the meter was replaced or reset, ask the fleet admin to set a new baseline.`,
      'startOdometerKm',
    );
  }
  const unloggedKm = last === null ? 0 : round1(startKm - last);
  return { unloggedKm, flags: unloggedKm > settings.unloggedKmTolerance ? ['unlogged_km'] : [] };
}

export function checkEndOdometer(startKm: number, endKm: number): number {
  if (!Number.isFinite(endKm) || endKm < 0) throw new FleetRuleError('Enter the closing reading.', 'endOdometerKm');
  if (endKm < startKm) throw new FleetRuleError(`The closing reading must not be below the opening one (${Math.round(startKm).toLocaleString('en-IN')} km).`, 'endOdometerKm');
  const km = round1(endKm - startKm);
  if (km > MAX_TRIP_KM) throw new FleetRuleError(`That is ${km.toLocaleString('en-IN')} km in one trip — check the reading.`, 'endOdometerKm');
  return km;
}

/** The typed reading and what OCR read off the photo differ by more than a digit's slip. */
export const ocrDisagrees = (typedKm: number, ocrKm: number | null) => ocrKm !== null && Math.abs(typedKm - ocrKm) >= 1;

/* ── billable distance ─────────────────────────────────────────────────── */

export interface BillableDecision {
  source: BillableSource | null;
  km: number | null;
  mismatch: boolean;
  noGps: boolean;
  diffKm: number | null;
  toleranceKm: number | null;
}

/** Fewer usable fixes than this is not a track. */
export const MIN_TRACK_POINTS = 3;

/**
 * Billable = the odometer, when GPS agrees with it within max(abs km, pct of the odometer km).
 * When they disagree the trip waits for a manager to pick (spec §5.17); with no usable track the
 * odometer stands alone, flagged; with no closing reading (a trip the system closed) GPS stands.
 */
export function billableDecision(input: { gpsKm: number; odoKm: number | null; usablePoints: number }, settings: Pick<FleetSettings, 'mismatchAbsKm' | 'mismatchPct'>): BillableDecision {
  const noGps = input.usablePoints < MIN_TRACK_POINTS || input.gpsKm <= 0;
  if (input.odoKm === null) {
    return noGps
      ? { source: null, km: null, mismatch: false, noGps, diffKm: null, toleranceKm: null }
      : { source: 'gps', km: round1(input.gpsKm), mismatch: false, noGps, diffKm: null, toleranceKm: null };
  }
  if (noGps) return { source: 'odometer', km: round1(input.odoKm), mismatch: false, noGps, diffKm: null, toleranceKm: null };
  const toleranceKm = round1(Math.max(settings.mismatchAbsKm, (input.odoKm * settings.mismatchPct) / 100));
  const diffKm = round1(Math.abs(input.gpsKm - input.odoKm));
  if (diffKm <= toleranceKm) return { source: 'odometer', km: round1(input.odoKm), mismatch: false, noGps, diffKm, toleranceKm };
  return { source: null, km: null, mismatch: true, noGps, diffKm, toleranceKm };
}

/* ── cost ──────────────────────────────────────────────────────────────── */

/**
 * A per-km vehicle costs its rate times the billable km. A fixed-plus-fuel vehicle's cost is the
 * month's (the fixed charge and its fuel), shared over its trips by km in the payment report.
 */
export function tripCost(vehicle: Pick<FleetVehicle, 'costBasis' | 'ratePerKm'>, km: number | null): TripCost {
  return {
    basis: vehicle.costBasis,
    ratePerKm: vehicle.ratePerKm,
    amount: vehicle.costBasis === 'per_km' && km !== null ? round2(km * vehicle.ratePerKm) : 0,
  };
}

/* ── flags at the end ──────────────────────────────────────────────────── */

export interface EndFlagInput {
  decision: BillableDecision;
  gapCount: number;
  longestStopMinutes: number;
  kmByDate: Record<string, number>;
  startDateKey: string;
  /** The vehicle's km on each day this trip touched, other trips included (this one excluded). */
  otherKmByDate: Record<string, number>;
  limitKm: number;
  allowedKm: number | null;
  siteInternal: boolean;
  isEmergency: boolean;
  ocrMismatch: boolean;
  autoClosed: boolean;
  carried: TripFlagCode[];
}

/** Standing still this long in one place during a trip is worth a look. */
export const LONG_IDLE_MINUTES = 90;

export function endFlags(input: EndFlagInput): TripFlagCode[] {
  const flags = new Set<TripFlagCode>(input.carried);
  if (input.decision.mismatch) flags.add('gps_odo_mismatch');
  if (input.decision.noGps) flags.add('no_gps');
  if (input.gapCount > 0 && !input.decision.noGps) flags.add('gps_gap');
  if (input.longestStopMinutes >= LONG_IDLE_MINUTES) flags.add('long_idle');
  if (Object.keys(input.kmByDate).some((day) => day !== input.startDateKey)) flags.add('crossed_midnight');
  if (input.isEmergency) flags.add('emergency');
  if (input.ocrMismatch) flags.add('ocr_mismatch');
  if (input.autoClosed) flags.add('auto_closed');
  if (!input.siteInternal) {
    for (const day of Object.keys(input.kmByDate)) {
      // An approval covers the day it was given for; past it is beyond what the manager agreed.
      // Any other day is held to the plain limit.
      const approved = day === input.startDateKey && input.allowedKm !== null;
      const allowance = approved ? (input.allowedKm as number) : input.limitKm;
      const total = (input.otherKmByDate[day] ?? 0) + input.kmByDate[day];
      if (total > allowance + 0.5) flags.add(approved ? 'over_cap' : 'over_limit');
    }
  }
  return [...flags];
}

/** Flags that need someone to look before the trip is paid; the rest are information. */
export const BLOCKING_FLAGS: TripFlagCode[] = ['gps_odo_mismatch', 'auto_closed', 'over_cap'];

/* ── finishing the figures ─────────────────────────────────────────────── */

export interface Finished {
  status: 'completed' | 'pending_review';
  billableDistanceKm: number | null;
  billableSource: BillableSource | null;
  kmByDate: Record<string, number>;
  costSnapshot: TripCost;
  flagCodes: TripFlagCode[];
  flagged: boolean;
  exceptionStatus: 'none' | 'open';
  reviewReason: string | null;
}

/**
 * Billable km, its split over days, cost and status, from the decision and the flags. A trip with no
 * billable figure, or with a blocking flag, waits for a manager.
 */
export function finishFigures(input: {
  decision: BillableDecision;
  gpsKmByDate: Record<string, number>;
  startDateKey: string;
  vehicle: Pick<FleetVehicle, 'costBasis' | 'ratePerKm'>;
  flags: TripFlagCode[];
}): Finished {
  const km = input.decision.km;
  const blocking = input.flags.filter((flag) => BLOCKING_FLAGS.includes(flag));
  const pending = km === null || blocking.length > 0;
  const kmByDate = km === null ? attributeKm(0, input.gpsKmByDate, input.startDateKey) : attributeKm(km, input.gpsKmByDate, input.startDateKey);
  let reviewReason: string | null = null;
  if (input.decision.mismatch) reviewReason = `GPS ${input.decision.diffKm} km away from the odometer (allowed ${input.decision.toleranceKm} km).`;
  else if (km === null) reviewReason = 'No closing reading and no usable GPS track.';
  else if (blocking.includes('auto_closed')) reviewReason = 'The driver never ended the trip; the system closed it.';
  else if (blocking.includes('over_cap')) reviewReason = 'Ran beyond the km the manager approved.';
  return {
    status: pending ? 'pending_review' : 'completed',
    billableDistanceKm: km,
    billableSource: input.decision.source,
    kmByDate,
    costSnapshot: tripCost(input.vehicle, km),
    flagCodes: input.flags,
    flagged: input.flags.length > 0,
    exceptionStatus: pending || input.flags.length > 0 ? 'open' : 'none',
    reviewReason,
  };
}

/** A manager settles a trip waiting for review: odometer, GPS, or a figure of their own. */
export function resolveReview(
  trip: Pick<FleetTrip, 'status' | 'odoDistanceKm' | 'gpsDistanceKm'>,
  input: { choice: BillableSource; km?: number | null },
): { km: number; source: BillableSource } {
  if (trip.status !== 'pending_review') throw new FleetRuleError('This trip is not waiting for a review.');
  if (input.choice === 'odometer') {
    if (trip.odoDistanceKm === null) throw new FleetRuleError('This trip has no odometer distance — pick GPS or enter the km.', 'choice');
    return { km: round1(trip.odoDistanceKm), source: 'odometer' };
  }
  if (input.choice === 'gps') {
    if (!(trip.gpsDistanceKm > 0)) throw new FleetRuleError('This trip has no GPS distance — pick the odometer or enter the km.', 'choice');
    return { km: round1(trip.gpsDistanceKm), source: 'gps' };
  }
  const km = Number(input.km);
  if (!Number.isFinite(km) || km < 0 || km > MAX_TRIP_KM) throw new FleetRuleError('Enter the km to bill.', 'km');
  return { km: round1(km), source: 'manager' };
}

/* ── who may do what ───────────────────────────────────────────────────── */

export interface FleetTripAbilities {
  end: boolean;
  pause: boolean;
  resume: boolean;
  cancel: boolean;
  review: boolean;
  forceClose: boolean;
  resolve: boolean;
}

export function tripAbilities(
  trip: Pick<FleetTrip, 'status' | 'driverUserId' | 'exceptionStatus' | 'startedAt' | 'pointCount'>,
  viewer: { userId: string; isManager: boolean; canReview: boolean; canForceClose: boolean },
  now: string,
): FleetTripAbilities {
  const mine = trip.driverUserId === viewer.userId;
  const open = OPEN_TRIP_STATUSES.includes(trip.status);
  // A trip started by mistake can be withdrawn while it is young and has not moved.
  const young = minutesBetween(trip.startedAt, now) <= 15 && trip.pointCount <= 30;
  const manages = viewer.isManager || viewer.canReview;
  return {
    end: mine && open,
    pause: mine && trip.status === 'running',
    resume: mine && trip.status === 'paused',
    cancel: mine && open && young,
    // Nobody settles their own trip.
    review: !mine && manages && trip.status === 'pending_review',
    forceClose: !mine && open && (viewer.canForceClose || viewer.isManager),
    resolve: !mine && manages && trip.exceptionStatus === 'open' && trip.status !== 'pending_review',
  };
}
