/**
 * Recording a trip: what makes one valid (blocking), and what an approver should look at twice
 * (flags, advisory). The server runs both on every save and again at submission; the form runs the
 * validation as the employee types, so the two never disagree about what will be accepted.
 */

import { odometerDistance } from './rates.ts';
import {
  daysBetween,
  isIsoDate,
  normaliseVehicleNumber,
  type FlagCode,
  type TripRecord,
  type TripRules,
  type VehicleOwnership,
} from './types.ts';

/** No single trip is longer than this; a typo in an odometer reading is the usual cause. */
export const MAX_TRIP_KM = 2000;
export const MAX_EXTRAS_AMOUNT = 50_000;

export interface TripInput {
  tripDate: string;
  ownership: VehicleOwnership;
  /** Own vehicle only; a company vehicle's type and number come from Vehicle Master. */
  vehicleType: string;
  vehicleNumber: string;
  vehicleId: string | null;
  fromPlace: string;
  toPlace: string;
  purpose: string;
  startOdometer: number | null;
  endOdometer: number | null;
  /** Used only when there is no odometer pair and the rules allow typing the distance. */
  distanceKm: number | null;
  projectId: string | null;
  departmentId: string | null;
  tollAmount: number;
  parkingAmount: number;
  notes: string;
}

export interface CompanyVehicle {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
}

export interface ValidatedTrip {
  tripDate: string;
  ownership: VehicleOwnership;
  vehicleType: string;
  vehicleNumber: string;
  vehicleId: string | null;
  fromPlace: string;
  toPlace: string;
  purpose: string;
  startOdometer: number | null;
  endOdometer: number | null;
  distanceKm: number;
  projectId: string | null;
  departmentId: string | null;
  tollAmount: number;
  parkingAmount: number;
  notes: string;
}

export type TripErrors = Partial<Record<keyof TripInput | 'distance', string>>;

const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const amount = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
};
const reading = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};

/** True while a trip of this date may still be recorded or claimed. */
export function withinClaimWindow(tripDate: string, today: string, rules: Pick<TripRules, 'claimWindowDays'>): boolean {
  if (rules.claimWindowDays === null || rules.claimWindowDays === undefined) return true;
  return daysBetween(tripDate, today) <= rules.claimWindowDays;
}

/** Can this trip go on a new claim now: unclaimed, and still inside the claim window. */
export function isClaimable(trip: Pick<TripRecord, 'status' | 'tripDate'>, today: string, rules: Pick<TripRules, 'claimWindowDays'>): boolean {
  return trip.status === 'draft' && withinClaimWindow(trip.tripDate, today, rules);
}

/**
 * The rules the claim screens apply once Settings › Fleet routes company-vehicle trips to fleet
 * trips (SEL Fleet, decision D1): company vehicles are off here, whatever Trip rules say, because
 * that running is recorded — and billed to a project — as a fleet trip instead.
 */
export function claimRules(rules: TripRules, companyTripsInFleet: boolean): TripRules {
  return companyTripsInFleet && rules.allowCompanyVehicle ? { ...rules, allowCompanyVehicle: false } : rules;
}

/** Days left to claim a trip of this date (negative once past); null when there is no window. */
export function daysLeftToClaim(tripDate: string, today: string, rules: Pick<TripRules, 'claimWindowDays'>): number | null {
  if (rules.claimWindowDays === null || rules.claimWindowDays === undefined) return null;
  return rules.claimWindowDays - daysBetween(tripDate, today);
}

/**
 * Checks a trip as typed and returns it cleaned up, or the reasons it cannot be saved — keyed by
 * field so the form can put each message under its input.
 */
export function validateTrip(
  input: Partial<TripInput>,
  context: {
    rules: TripRules;
    today: string;
    companyVehicle: CompanyVehicle | null;
    /**
     * The ownership of the trip being edited. A company-vehicle draft recorded while company
     * vehicles were allowed stays editable after they are switched off (or routed to fleet trips):
     * it can still be corrected, claimed or deleted, just not created anew.
     */
    existingOwnership?: VehicleOwnership | null;
    /** Company vehicles are off because they are fleet trips now — said so, with where to go. */
    companyTripsInFleet?: boolean;
  },
): { ok: true; value: ValidatedTrip } | { ok: false; errors: TripErrors } {
  const { rules, today } = context;
  const errors: TripErrors = {};

  const tripDate = String(input.tripDate ?? '');
  if (!isIsoDate(tripDate)) errors.tripDate = 'Enter the trip date.';
  else if (tripDate > today) errors.tripDate = 'A trip cannot be dated in the future.';
  else if (!withinClaimWindow(tripDate, today, rules)) errors.tripDate = `Trips older than ${rules.claimWindowDays} days can no longer be claimed.`;

  const ownership: VehicleOwnership = input.ownership === 'company' ? 'company' : 'own';
  if (ownership === 'own' && !rules.allowOwnVehicle) errors.ownership = 'Own-vehicle trips are switched off in Settings.';
  if (ownership === 'company' && !rules.allowCompanyVehicle && context.existingOwnership !== 'company') {
    errors.ownership = context.companyTripsInFleet
      ? 'Company vehicles are recorded as fleet trips now — start one in Driver Management › Fleet Trip.'
      : 'Company-vehicle trips are switched off in Settings.';
  }

  let vehicleType = text(input.vehicleType, 40);
  let vehicleNumber = normaliseVehicleNumber(input.vehicleNumber).slice(0, 15);
  let vehicleId: string | null = null;
  if (ownership === 'company') {
    const vehicle = context.companyVehicle;
    if (!input.vehicleId || !vehicle || vehicle.id !== input.vehicleId) errors.vehicleId = 'Choose the company vehicle.';
    else {
      vehicleId = vehicle.id;
      vehicleType = vehicle.vehicleType || 'Other';
      vehicleNumber = normaliseVehicleNumber(vehicle.vehicleNumber);
    }
  } else {
    if (!vehicleType) errors.vehicleType = 'Choose the vehicle type.';
    if (vehicleNumber.length < 4) errors.vehicleNumber = 'Enter the registration number.';
  }

  const fromPlace = text(input.fromPlace, 120);
  const toPlace = text(input.toPlace, 120);
  const purpose = text(input.purpose, 300);
  if (!fromPlace) errors.fromPlace = 'Where did the trip start?';
  if (!toPlace) errors.toPlace = 'Where did it end?';
  if (purpose.length < 3) errors.purpose = 'Say what the trip was for.';

  const startOdometer = reading(input.startOdometer);
  const endOdometer = reading(input.endOdometer);
  let distanceKm = 0;
  const hasPair = startOdometer !== null || endOdometer !== null;
  if (Number.isNaN(startOdometer) || (startOdometer !== null && startOdometer < 0)) errors.startOdometer = 'Enter a valid reading.';
  if (Number.isNaN(endOdometer) || (endOdometer !== null && endOdometer < 0)) errors.endOdometer = 'Enter a valid reading.';
  if (rules.requireOdometer || hasPair) {
    if (startOdometer === null) errors.startOdometer ??= 'Enter the starting reading.';
    if (endOdometer === null) errors.endOdometer ??= 'Enter the closing reading.';
    if (!errors.startOdometer && !errors.endOdometer) {
      if ((endOdometer as number) <= (startOdometer as number)) errors.endOdometer = 'The closing reading must be higher than the starting one.';
      else distanceKm = odometerDistance(startOdometer, endOdometer);
    }
  } else {
    const typed = Number(input.distanceKm ?? 0);
    if (!Number.isFinite(typed) || typed <= 0) errors.distance = 'Enter the distance travelled.';
    else distanceKm = Math.round(typed * 10) / 10;
  }
  if (distanceKm > MAX_TRIP_KM) errors.distance = `More than ${MAX_TRIP_KM} km in one trip — check the readings.`;

  const tollAmount = rules.allowTollParking ? amount(input.tollAmount) : 0;
  const parkingAmount = rules.allowTollParking ? amount(input.parkingAmount) : 0;
  if (Number.isNaN(tollAmount) || tollAmount < 0 || tollAmount > MAX_EXTRAS_AMOUNT) errors.tollAmount = 'Enter a valid amount.';
  if (Number.isNaN(parkingAmount) || parkingAmount < 0 || parkingAmount > MAX_EXTRAS_AMOUNT) errors.parkingAmount = 'Enter a valid amount.';

  const projectId = text(input.projectId, 80) || null;
  const departmentId = text(input.departmentId, 80) || null;
  if (rules.requireProject && !projectId) errors.projectId = 'Choose the project this trip was for.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      tripDate,
      ownership,
      vehicleType,
      vehicleNumber,
      vehicleId,
      fromPlace,
      toPlace,
      purpose,
      startOdometer: hasPair || rules.requireOdometer ? startOdometer : null,
      endOdometer: hasPair || rules.requireOdometer ? endOdometer : null,
      distanceKm,
      projectId,
      departmentId,
      tollAmount,
      parkingAmount,
      notes: text(input.notes, 500),
    },
  };
}

type FlagTrip = Pick<TripRecord, 'id' | 'tripDate' | 'fromPlace' | 'toPlace' | 'distanceKm' | 'startOdometer' | 'endOdometer' | 'vehicleNumber' | 'status'>;

const place = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * What an approver should look at twice. `sameEmployee` is the employee's other trips;
 * `sameVehicle` every logged trip on the same vehicle number (anyone's, for a company vehicle).
 * Rejected trips and the trip itself are ignored.
 */
export function tripFlags(
  trip: FlagTrip & { ratePerKm: number | null },
  context: { rules: TripRules; sameEmployee: readonly FlagTrip[]; sameVehicle: readonly FlagTrip[] },
): FlagCode[] {
  const flags: FlagCode[] = [];
  const live = (other: FlagTrip) => other.id !== trip.id && other.status !== 'rejected';
  if (trip.ratePerKm === null) flags.push('no_rate');

  const { maxKmPerTrip, maxKmPerDay } = context.rules;
  if (maxKmPerTrip && trip.distanceKm > maxKmPerTrip) flags.push('over_trip_limit');

  const sameDay = context.sameEmployee.filter((other) => live(other) && other.tripDate === trip.tripDate);
  if (maxKmPerDay && sameDay.reduce((total, other) => total + other.distanceKm, trip.distanceKm) > maxKmPerDay) flags.push('over_day_limit');

  if (typeof trip.startOdometer === 'number' && typeof trip.endOdometer === 'number') {
    const start = trip.startOdometer;
    const end = trip.endOdometer;
    const overlaps = context.sameVehicle.some(
      (other) =>
        live(other) &&
        other.vehicleNumber === trip.vehicleNumber &&
        typeof other.startOdometer === 'number' &&
        typeof other.endOdometer === 'number' &&
        start < other.endOdometer &&
        other.startOdometer < end,
    );
    if (overlaps) flags.push('odometer_overlap');
  }

  const duplicate = sameDay.some(
    (other) =>
      place(other.fromPlace) === place(trip.fromPlace) &&
      place(other.toPlace) === place(trip.toPlace) &&
      Math.abs(other.distanceKm - trip.distanceKm) <= Math.max(1, trip.distanceKm * 0.1),
  );
  if (duplicate) flags.push('possible_duplicate');

  return flags;
}
