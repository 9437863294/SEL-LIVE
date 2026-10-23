/**
 * The per-km rate card and trip pricing.
 *
 * A trip is priced by the revision in effect on the trip's date — the latest revision whose
 * `effectiveFrom` is on or before it — and the row for its vehicle type. Toll and parking are added
 * at cost when the rules allow them, whatever the ownership. Amounts go through paise so a claim of
 * forty trips totals exactly.
 */

import { roundMoney, sumMoney } from '../bill-tracking/money.ts';
import type { RateRevision, RateRow, VehicleOwnership } from './types.ts';

export { formatINR, formatINRCompact, roundMoney, sumMoney } from '../bill-tracking/money.ts';

const typeKey = (value: string) => value.trim().toLowerCase();

/** Revisions oldest first, duplicates of the same date keeping the last saved. */
export function sortRevisions(revisions: readonly RateRevision[]): RateRevision[] {
  const byDate = new Map<string, RateRevision>();
  for (const revision of revisions) byDate.set(revision.effectiveFrom, revision);
  return [...byDate.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** The revision in effect on `date`, or null before the first one. */
export function revisionOn(revisions: readonly RateRevision[], date: string): RateRevision | null {
  let found: RateRevision | null = null;
  for (const revision of sortRevisions(revisions)) {
    if (revision.effectiveFrom <= date) found = revision;
    else break;
  }
  return found;
}

export function rateRow(revision: RateRevision | null, vehicleType: string): RateRow | null {
  if (!revision || !vehicleType.trim()) return null;
  return revision.rates.find((row) => typeKey(row.vehicleType) === typeKey(vehicleType)) ?? null;
}

export interface RateLookup {
  ratePerKm: number | null;
  revisionId: string | null;
  effectiveFrom: string | null;
}

/** The per-km rate for this vehicle type and ownership on this date (`null` = none set). */
export function rateFor(revisions: readonly RateRevision[], date: string, vehicleType: string, ownership: VehicleOwnership): RateLookup {
  const revision = revisionOn(revisions, date);
  const row = rateRow(revision, vehicleType);
  const value = row ? row[ownership] : null;
  const ratePerKm = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return { ratePerKm, revisionId: revision?.id ?? null, effectiveFrom: revision?.effectiveFrom ?? null };
}

/** Odometer distance to one decimal; zero for a missing or reversed pair. */
export function odometerDistance(start: number | null | undefined, end: number | null | undefined): number {
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) * 10) / 10;
}

export interface TripPricing {
  distanceAmount: number;
  extrasAmount: number;
  totalAmount: number;
}

export function priceTrip(input: { distanceKm: number; ratePerKm: number | null; tollAmount?: number; parkingAmount?: number; allowTollParking: boolean }): TripPricing {
  const distanceAmount = input.ratePerKm === null ? 0 : roundMoney(Math.max(0, input.distanceKm) * input.ratePerKm);
  const extrasAmount = input.allowTollParking ? sumMoney([Math.max(0, input.tollAmount ?? 0), Math.max(0, input.parkingAmount ?? 0)]) : 0;
  return { distanceAmount, extrasAmount, totalAmount: sumMoney([distanceAmount, extrasAmount]) };
}

/**
 * The vehicle types offered for an own-vehicle trip on this date: the types with an own rate,
 * first, then the rest of the master list. Nobody is blocked from recording an unrated type —
 * the trip is flagged and only its toll and parking are claimed.
 */
export function ownVehicleTypes(revisions: readonly RateRevision[], date: string, masterTypes: readonly string[]): { type: string; rate: number | null }[] {
  const revision = revisionOn(revisions, date);
  const rated = (revision?.rates ?? []).filter((row) => typeof row.own === 'number').map((row) => ({ type: row.vehicleType, rate: row.own }));
  const seen = new Set(rated.map((entry) => typeKey(entry.type)));
  const rest = masterTypes.filter((type) => !seen.has(typeKey(type))).map((type) => ({ type, rate: null }));
  return [...rated, ...rest];
}

/** Repairs a revision typed into the settings form: trims, drops blank and duplicate types, rounds rates. */
export function normaliseRevision(revision: RateRevision): RateRevision {
  const seen = new Set<string>();
  const rates: RateRow[] = [];
  const cleanRate = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? roundMoney(number) : null;
  };
  for (const row of revision.rates ?? []) {
    const vehicleType = String(row.vehicleType ?? '').trim();
    if (!vehicleType || seen.has(typeKey(vehicleType))) continue;
    seen.add(typeKey(vehicleType));
    rates.push({ vehicleType, own: cleanRate(row.own), company: cleanRate(row.company) });
  }
  return { ...revision, rates, note: String(revision.note ?? '').trim() };
}
