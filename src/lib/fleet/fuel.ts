/**
 * Fuel: mileage from full tank to full tank, and what about a fill-up deserves a second look.
 *
 * Reads every fuel log of the vehicle — fleet entries, Vehicle Management's own register and the
 * Site Account's — through `fuelRowFrom`, since all three land in the same collection with the same
 * core fields.
 *
 * Full-to-full: when the tank is filled up, the fuel put in since the previous full fill (partials
 * included, the previous full itself excluded) is what the km between the two readings burned.
 * A partial fill on its own says nothing about mileage.
 */

import { round1, round2, type FleetSettings, type FleetVehicle, type FuelFlagCode, type FuelPaidBy, type FuelRow } from './types.ts';

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const optional = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function paidByFrom(data: Record<string, unknown>): FuelPaidBy {
  if (data.paidBy === 'driver' || data.paidBy === 'advance' || data.paidBy === 'company') return data.paidBy;
  // Older entries carry only a payment mode (Cash, UPI, Fuel Card…), which does not say whose money
  // it was. Without an explicit "driver paid" they count as the company's and are not reimbursed.
  return 'company';
}

const createdIso = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const stamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof stamp.toDate === 'function') return stamp.toDate().toISOString();
    const seconds = stamp.seconds ?? stamp._seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString();
  }
  return '';
};

export function fuelRowFrom(id: string, data: Record<string, unknown>): FuelRow {
  const litres = num(data.quantityLiters);
  const amount = num(data.totalAmount) || round2(litres * num(data.ratePerUnit));
  return {
    id,
    vehicleId: String(data.vehicleId ?? ''),
    fuelDate: String(data.fuelDate ?? '').slice(0, 10),
    odometerKm: optional(data.odometerReadingKm),
    litres,
    amount,
    ratePerL: num(data.ratePerUnit) || (litres > 0 ? round2(amount / litres) : 0),
    fullTank: data.fullTank === true || String(data.fillType ?? 'Full Tank') === 'Full Tank',
    paidBy: paidByFrom(data),
    driverUserId: String(data.driverUserId ?? data.enteredByUserId ?? '') || null,
    driverName: String(data.driverName ?? data.enteredByName ?? ''),
    createdAt: createdIso(data.createdAt),
  };
}

const byReading = (a: FuelRow, b: FuelRow) => (a.odometerKm ?? 0) - (b.odometerKm ?? 0) || a.fuelDate.localeCompare(b.fuelDate) || a.createdAt.localeCompare(b.createdAt);

/** The vehicle's fills before this one, by odometer. */
export function previousFills(rows: readonly FuelRow[], current: Pick<FuelRow, 'id' | 'odometerKm'>): FuelRow[] {
  if (current.odometerKm === null) return [];
  return rows.filter((row) => row.id !== current.id && row.odometerKm !== null && row.odometerKm < (current.odometerKm as number)).sort(byReading);
}

export interface Mileage {
  km: number;
  litres: number;
  kmpl: number;
  fromFillId: string;
}

export function fullToFullMileage(rows: readonly FuelRow[], current: FuelRow): Mileage | null {
  if (!current.fullTank || current.odometerKm === null || current.litres <= 0) return null;
  const before = previousFills(rows, current);
  let previousFull: FuelRow | null = null;
  for (let index = before.length - 1; index >= 0; index -= 1) {
    if (before[index].fullTank) {
      previousFull = before[index];
      break;
    }
  }
  if (!previousFull || previousFull.odometerKm === null) return null;
  const between = before.filter((row) => (row.odometerKm as number) > (previousFull as FuelRow).odometerKm!);
  const litres = round2(between.reduce((sum, row) => sum + row.litres, 0) + current.litres);
  const km = round1(current.odometerKm - previousFull.odometerKm);
  if (km <= 0 || litres <= 0) return null;
  return { km, litres, kmpl: round2(km / litres), fromFillId: previousFull.id };
}

export const expectedLitres = (km: number, stdMileageKmpl: number | null) => (stdMileageKmpl && stdMileageKmpl > 0 ? round2(km / stdMileageKmpl) : null);

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export interface FuelCheckInput {
  current: FuelRow;
  rows: readonly FuelRow[];
  vehicle: Pick<FleetVehicle, 'tankCapacityL' | 'stdMileageKmpl' | 'mileageTolerancePct' | 'currentOdometerKm'>;
  settings: Pick<FleetSettings, 'fuelRateVariancePct' | 'unloggedKmTolerance'>;
  /** Trips on the vehicle that ended between the previous fill's reading and this one. */
  tripsSincePrevious: number;
  /** Their billable km together. */
  tripKmSincePrevious: number;
}

export interface FuelCheck {
  flags: FuelFlagCode[];
  mileage: Mileage | null;
  previousOdometerKm: number | null;
  distanceSincePreviousKm: number | null;
  expectedLitres: number | null;
}

export function checkFuel(input: FuelCheckInput): FuelCheck {
  const { current, vehicle } = input;
  const flags = new Set<FuelFlagCode>();
  const before = previousFills(input.rows, current);
  const previous = before[before.length - 1] ?? null;
  const highest = input.rows.filter((row) => row.id !== current.id && row.odometerKm !== null).reduce((max, row) => Math.max(max, row.odometerKm as number), 0);
  if (current.odometerKm !== null && highest > 0 && current.odometerKm < highest) flags.add('odometer_regression');

  if (vehicle.tankCapacityL && current.litres > vehicle.tankCapacityL * 1.05) flags.add('over_tank');

  const mileage = fullToFullMileage(input.rows, current);
  if (mileage && vehicle.stdMileageKmpl) {
    if (mileage.kmpl < vehicle.stdMileageKmpl * (1 - vehicle.mileageTolerancePct / 100)) flags.add('low_mileage');
  }

  // Price per litre against the vehicle's recent fills (the same fuel, the same region).
  const recentRates = before.slice(-5).map((row) => row.ratePerL).filter((rate) => rate > 0);
  const typical = median(recentRates);
  if (typical && current.ratePerL > 0 && Math.abs(current.ratePerL - typical) / typical > input.settings.fuelRateVariancePct / 100) flags.add('rate_variance');

  const distance = previous && previous.odometerKm !== null && current.odometerKm !== null ? round1(current.odometerKm - previous.odometerKm) : null;
  if (previous && distance !== null && distance > 0) {
    if (input.tripsSincePrevious === 0) flags.add('no_trip_between_fills');
    // The vehicle ran further between fills than its trips account for.
    const unlogged = distance - input.tripKmSincePrevious;
    if (input.tripsSincePrevious > 0 && unlogged > Math.max(input.settings.unloggedKmTolerance * 4, distance * 0.15)) flags.add('unlogged_km');
  }

  return {
    flags: [...flags],
    mileage,
    previousOdometerKm: previous?.odometerKm ?? null,
    distanceSincePreviousKm: distance,
    expectedLitres: mileage ? expectedLitres(mileage.km, vehicle.stdMileageKmpl) : null,
  };
}
