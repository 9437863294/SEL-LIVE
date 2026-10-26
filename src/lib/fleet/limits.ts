/**
 * The daily km limit. A vehicle's km on a day are the billable km of its trips that ran that day
 * (a trip over midnight counts on both days, by GPS share), plus whatever a running trip has
 * measured so far. Starting a trip that would take the day past the limit needs a manager's
 * approval first — or an emergency start, counted per driver per month.
 */

import { round1, type FleetApproval, type FleetTrip, type FleetVehicle } from './types.ts';

type CountedTrip = Pick<FleetTrip, 'id' | 'vehicleId' | 'status' | 'kmByDate' | 'siteInternal' | 'gpsDistanceKm' | 'dateKey'> & Partial<Pick<FleetTrip, 'billableDistanceKm'>>;

/**
 * A trip's km on one day: settled figures when finished, the live GPS figure while running.
 *
 * An open trip — running, paused, or waiting for review with no billable figure yet — counts what
 * GPS has measured. Before its first midnight that is all on its start day. Once the midnight job
 * has written the GPS split into `kmByDate`, the running since then (GPS total less the days
 * already split) counts on any later day, so a trip that ran into today is held to today's limit
 * before it ends.
 */
export function tripKmOn(trip: CountedTrip, dateKey: string): number {
  if (trip.status === 'cancelled' || trip.siteInternal) return 0;
  const byDate = trip.kmByDate ?? {};
  const settled = byDate[dateKey];
  if (typeof settled === 'number') return settled;
  const open = trip.status === 'running' || trip.status === 'paused' || (trip.status === 'pending_review' && (trip.billableDistanceKm ?? null) === null);
  if (!open) return 0;
  const days = Object.keys(byDate).sort();
  if (!days.length) return trip.dateKey === dateKey ? trip.gpsDistanceKm || 0 : 0;
  if (dateKey <= days[days.length - 1]) return 0;
  const split = days.reduce((sum, day) => sum + (byDate[day] || 0), 0);
  return round1(Math.max(0, (trip.gpsDistanceKm || 0) - split));
}

export function kmUsedOn(trips: readonly CountedTrip[], vehicleId: string, dateKey: string, exceptTripId?: string): number {
  return round1(trips.filter((trip) => trip.vehicleId === vehicleId && trip.id !== exceptTripId).reduce((sum, trip) => sum + tripKmOn(trip, dateKey), 0));
}

/** The day's allowance: the limit, or what an approval for that day allows (whichever is more). */
export function dayAllowance(
  vehicle: Pick<FleetVehicle, 'id' | 'dailyKmLimit'>,
  dateKey: string,
  approvals: readonly Pick<FleetApproval, 'id' | 'vehicleId' | 'dateKey' | 'status' | 'allowedKm'>[],
): { limitKm: number; allowedKm: number; approvalId: string | null } {
  let allowedKm = vehicle.dailyKmLimit;
  let approvalId: string | null = null;
  for (const approval of approvals) {
    if (approval.vehicleId !== vehicle.id || approval.dateKey !== dateKey) continue;
    if (approval.status !== 'approved' && approval.status !== 'used') continue;
    // At least the limit (not only above it): after approve-and-raise the new limit equals the
    // approval, and the trip should still name the approval it ran on.
    if (approval.allowedKm !== null && approval.allowedKm >= allowedKm) {
      allowedKm = approval.allowedKm;
      approvalId = approval.id;
    }
  }
  return { limitKm: vehicle.dailyKmLimit, allowedKm, approvalId };
}

export interface StartLimitCheck {
  ok: boolean;
  usedKm: number;
  expectedKm: number;
  limitKm: number;
  allowedKm: number;
  remainingKm: number;
  /** How far past the allowance this trip would take the day. */
  overByKm: number;
  approvalId: string | null;
}

export function startLimitCheck(input: { usedKm: number; expectedKm: number; limitKm: number; allowedKm: number; approvalId: string | null }): StartLimitCheck {
  const remainingKm = round1(Math.max(0, input.allowedKm - input.usedKm));
  const overByKm = round1(Math.max(0, input.usedKm + input.expectedKm - input.allowedKm));
  return { ok: overByKm <= 0, ...input, remainingKm, overByKm };
}

/** Emergency starts this month left for a driver. */
export const emergenciesLeft = (usedThisMonth: number, monthlyMax: number) => Math.max(0, monthlyMax - usedThisMonth);
