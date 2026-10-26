/**
 * The monthly payment report (ASSUMPTIONS.md 23 — the spec's own definitions were not supplied):
 *
 * - **A, project-wise** — trips and billable km per project, and their cost: per-km vehicles at
 *   their rate; fixed-plus-fuel vehicles' fixed charge and fuel shared over projects by km.
 * - **B, vehicle-wise** — km, cost, fuel bought, the fuel the km should have taken at the standard
 *   mileage, and the mileage actually achieved.
 * - **C, held and flagged trips** — trips waiting for review are held (not paid this month, carried
 *   to the next report once settled); flagged trips that are paid are listed for information.
 * - **D, driver reimbursements** — fuel a driver paid for, or took from a cash advance.
 *
 * Which trips a report counts: completed trips dated up to the period's end that no approved
 * report has counted yet (`reportedIn`). So a trip settled after its month's report was approved
 * appears in the next one, marked as carried — corrections are never lost and never paid twice.
 */

import { expectedLitres } from './fuel.ts';
import {
  round1,
  round2,
  type FleetTrip,
  type FleetVehicle,
  type FuelRow,
  type PaymentReportTotals,
  type ProjectOption,
  type ReportARow,
  type ReportBRow,
  type ReportCRow,
  type ReportDRow,
} from './types.ts';

type ReportTrip = Pick<
  FleetTrip,
  | 'id'
  | 'status'
  | 'vehicleId'
  | 'vehicleNumber'
  | 'driverName'
  | 'dateKey'
  | 'projectId'
  | 'projectName'
  | 'projectCode'
  | 'gpsDistanceKm'
  | 'odoDistanceKm'
  | 'billableDistanceKm'
  | 'costSnapshot'
  | 'flagCodes'
  | 'reportedIn'
>;

export interface ReportInput {
  from: string;
  to: string;
  trips: readonly ReportTrip[];
  /** Fuel logs dated inside the period. */
  fuel: readonly FuelRow[];
  vehicles: readonly FleetVehicle[];
  projects: readonly ProjectOption[];
  /** Months in the period, for fixed monthly charges (1 for a calendar month). */
  months: number;
}

export interface BuiltReport {
  reportA: ReportARow[];
  reportB: ReportBRow[];
  reportC: ReportCRow[];
  reportD: ReportDRow[];
  totals: PaymentReportTotals;
  tripIds: string[];
}

const NO_PROJECT = '__none__';

/** Trips the period counts (paid) and holds (waiting), from everything not yet reported. */
export function selectTrips(trips: readonly ReportTrip[], from: string, to: string): { paid: ReportTrip[]; held: ReportTrip[] } {
  const pool = trips.filter((trip) => !trip.reportedIn && trip.dateKey <= to);
  return {
    paid: pool.filter((trip) => trip.status === 'completed' && trip.billableDistanceKm !== null),
    // Held: waiting for review, from this period (older held trips were already shown as held).
    held: pool.filter((trip) => trip.status === 'pending_review' && trip.dateKey >= from),
  };
}

export function buildPaymentReport(input: ReportInput): BuiltReport {
  const { paid, held } = selectTrips(input.trips, input.from, input.to);
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const projects = new Map(input.projects.map((project) => [project.id, project]));

  // Fuel per vehicle in the period.
  const fuelByVehicle = new Map<string, { litres: number; amount: number }>();
  for (const row of input.fuel) {
    if (row.fuelDate < input.from || row.fuelDate > input.to) continue;
    const entry = fuelByVehicle.get(row.vehicleId) ?? { litres: 0, amount: 0 };
    entry.litres += row.litres;
    entry.amount += row.amount;
    fuelByVehicle.set(row.vehicleId, entry);
  }

  // ── B: by vehicle ──
  const tripsByVehicle = new Map<string, ReportTrip[]>();
  for (const trip of paid) tripsByVehicle.set(trip.vehicleId, [...(tripsByVehicle.get(trip.vehicleId) ?? []), trip]);
  const vehicleIds = new Set([...tripsByVehicle.keys(), ...fuelByVehicle.keys()]);
  const reportB: ReportBRow[] = [];
  /** Fixed-plus-fuel vehicles' month cost, to share over projects by km. */
  const pooled = new Map<string, { fixed: number; fuel: number; km: number }>();
  for (const vehicleId of vehicleIds) {
    const vehicle = vehicles.get(vehicleId);
    const trips = tripsByVehicle.get(vehicleId) ?? [];
    const km = round1(trips.reduce((sum, trip) => sum + (trip.billableDistanceKm ?? 0), 0));
    const fuel = fuelByVehicle.get(vehicleId) ?? { litres: 0, amount: 0 };
    const basis = vehicle?.costBasis ?? 'per_km';
    const perKm = round2(trips.reduce((sum, trip) => sum + (trip.costSnapshot?.basis === 'per_km' ? trip.costSnapshot.amount : 0), 0));
    const fixed = basis === 'fixed_plus_fuel' ? round2((vehicle?.fixedMonthlyCost ?? 0) * input.months) : 0;
    const cost = basis === 'fixed_plus_fuel' ? round2(fixed + fuel.amount) : perKm;
    if (basis === 'fixed_plus_fuel') pooled.set(vehicleId, { fixed, fuel: round2(fuel.amount), km });
    const expected = expectedLitres(km, vehicle?.stdMileageKmpl ?? null);
    reportB.push({
      vehicleId,
      vehicleNumber: vehicle?.vehicleNumber ?? trips[0]?.vehicleNumber ?? vehicleId,
      category: vehicle?.category ?? 'car',
      costBasis: basis,
      trips: trips.length,
      km,
      fuelLitres: round2(fuel.litres),
      fuelAmount: round2(fuel.amount),
      expectedLitres: expected,
      varianceLitres: expected === null || fuel.litres <= 0 ? null : round2(fuel.litres - expected),
      mileageKmpl: fuel.litres > 0 && km > 0 ? round2(km / fuel.litres) : null,
      stdMileageKmpl: vehicle?.stdMileageKmpl ?? null,
      cost,
    });
  }
  reportB.sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber));

  // ── A: by project ──
  const rowsA = new Map<string, ReportARow>();
  const rowFor = (trip: Pick<ReportTrip, 'projectId' | 'projectName' | 'projectCode'>): ReportARow => {
    const key = trip.projectId ?? NO_PROJECT;
    let row = rowsA.get(key);
    if (!row) {
      const project = trip.projectId ? projects.get(trip.projectId) : null;
      row = {
        projectId: trip.projectId,
        projectCode: project?.code ?? trip.projectCode ?? '',
        projectName: trip.projectId ? project?.name ?? trip.projectName ?? 'Unknown project' : 'No project (office / general)',
        trips: 0,
        km: 0,
        perKmCost: 0,
        fixedShare: 0,
        fuelShare: 0,
        total: 0,
        carriedTrips: 0,
      };
      rowsA.set(key, row);
    }
    return row;
  };
  for (const trip of paid) {
    const row = rowFor(trip);
    const km = trip.billableDistanceKm ?? 0;
    row.trips += 1;
    row.km += km;
    if (trip.dateKey < input.from) row.carriedTrips += 1;
    if (trip.costSnapshot?.basis === 'per_km') row.perKmCost += trip.costSnapshot.amount;
    const pool = pooled.get(trip.vehicleId);
    if (pool && pool.km > 0) {
      row.fixedShare += (pool.fixed * km) / pool.km;
      row.fuelShare += (pool.fuel * km) / pool.km;
    }
  }
  // A pooled vehicle with fuel or a fixed charge but no billable km still costs the month.
  for (const pool of pooled.values()) {
    if (pool.km > 0 || (pool.fixed <= 0 && pool.fuel <= 0)) continue;
    const row = rowFor({ projectId: null, projectName: '', projectCode: '' });
    row.fixedShare += pool.fixed;
    row.fuelShare += pool.fuel;
  }
  const reportA = [...rowsA.values()]
    .map((row) => {
      const perKmCost = round2(row.perKmCost);
      const fixedShare = round2(row.fixedShare);
      const fuelShare = round2(row.fuelShare);
      return { ...row, km: round1(row.km), perKmCost, fixedShare, fuelShare, total: round2(perKmCost + fixedShare + fuelShare) };
    })
    .sort((a, b) => (a.projectId === null ? 1 : b.projectId === null ? -1 : a.projectName.localeCompare(b.projectName)));

  // ── C: held and flagged ──
  const reportC: ReportCRow[] = [
    ...held.map((trip) => ({ trip, held: true })),
    ...paid.filter((trip) => trip.flagCodes.length).map((trip) => ({ trip, held: false })),
  ]
    .map(({ trip, held: isHeld }) => ({
      tripId: trip.id,
      dateKey: trip.dateKey,
      vehicleNumber: trip.vehicleNumber,
      driverName: trip.driverName,
      projectName: trip.projectName || 'No project',
      status: trip.status,
      held: isHeld,
      gpsKm: round1(trip.gpsDistanceKm),
      odoKm: trip.odoDistanceKm,
      billableKm: trip.billableDistanceKm,
      amount: trip.costSnapshot?.amount ?? 0,
      flags: trip.flagCodes,
    }))
    .sort((a, b) => Number(b.held) - Number(a.held) || a.dateKey.localeCompare(b.dateKey));

  // ── D: reimbursements ──
  const rowsD = new Map<string, ReportDRow>();
  for (const row of input.fuel) {
    if (row.fuelDate < input.from || row.fuelDate > input.to || row.paidBy === 'company') continue;
    const key = row.driverUserId ?? row.driverName;
    const entry = rowsD.get(key) ?? { driverUserId: row.driverUserId ?? '', driverName: row.driverName || 'Unknown driver', entries: 0, litres: 0, driverPaid: 0, fromAdvance: 0, total: 0 };
    entry.entries += 1;
    entry.litres += row.litres;
    if (row.paidBy === 'driver') entry.driverPaid += row.amount;
    else entry.fromAdvance += row.amount;
    rowsD.set(key, entry);
  }
  const reportD = [...rowsD.values()]
    .map((row) => ({ ...row, litres: round2(row.litres), driverPaid: round2(row.driverPaid), fromAdvance: round2(row.fromAdvance), total: round2(row.driverPaid + row.fromAdvance) }))
    .sort((a, b) => a.driverName.localeCompare(b.driverName));

  const totals: PaymentReportTotals = {
    trips: paid.length,
    km: round1(paid.reduce((sum, trip) => sum + (trip.billableDistanceKm ?? 0), 0)),
    heldTrips: held.length,
    heldKm: round1(held.reduce((sum, trip) => sum + Math.max(trip.gpsDistanceKm, trip.odoDistanceKm ?? 0), 0)),
    perKmCost: round2(reportA.reduce((sum, row) => sum + row.perKmCost, 0)),
    fixedCost: round2(reportA.reduce((sum, row) => sum + row.fixedShare, 0)),
    fuelCost: round2(reportA.reduce((sum, row) => sum + row.fuelShare, 0)),
    payable: round2(reportA.reduce((sum, row) => sum + row.total, 0)),
    reimbursements: round2(reportD.reduce((sum, row) => sum + row.total, 0)),
  };

  return { reportA, reportB, reportC, reportD, totals, tripIds: paid.map((trip) => trip.id) };
}
