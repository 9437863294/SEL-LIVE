import 'server-only';

/**
 * What the fleet screens open with: the driver's bootstrap (vehicles with today's km and limit,
 * purposes, projects, geofences, their running trip), the control dashboard, and the Exceptions list.
 */

import { addDays, monthOfDate, monthRange } from '../dates.ts';
import { dayAllowance, emergenciesLeft, kmUsedOn, tripKmOn } from '../limits.ts';
import { serviceDueInKm } from '../settings.ts';
import type { FleetAccess } from '../access.ts';
import { FLEET_COLLECTIONS, OPEN_TRIP_STATUSES, round1, round2, type FleetApproval, type FleetCategory, type FleetTrip, type GeofenceKind } from '../types.ts';
import { employeeProjectIdsOf } from '@/lib/employee-projects/server';
import { db, FleetError, type FleetContext } from './context';
import { activeGeofences, activePurposes, driverOf, fleetProjects, fleetVehicles, loadFleetSettings } from './lookups';
import { openFuelExceptions, type FuelEntryView } from './fuel';
import { isFleetTrip, listMyTrips, myOpenTrip, toTrip, tripsCol, tripsOnDays } from './trips';

export interface BootstrapVehicle {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  category: FleetCategory;
  fuelType: string;
  tankCapacityL: number | null;
  currentOdometerKm: number | null;
  dailyKmLimit: number;
  usedTodayKm: number;
  allowedTodayKm: number;
  busy: boolean;
  assignedToMe: boolean;
}

export interface FleetBootstrap {
  today: string;
  now: string;
  canDrive: boolean;
  driver: { id: string; name: string } | null;
  access: FleetAccess;
  isApprover: boolean;
  inbox: { approvals: number; reviews: number };
  settings: { ocrEnabled: boolean; emergencyMonthlyMax: number; gpsGapMinutes: number; companyTripsInFleet: boolean; mismatchAbsKm: number; mismatchPct: number; employeeProjectsOnly: boolean };
  /** The employee's own projects (greytHR project → Settings › Projects, linked on Employee › Category). */
  myProjectIds: string[];
  vehicles: BootstrapVehicle[];
  purposes: Array<{ id: string; name: string; requiresReason: boolean; requiresProject: boolean }>;
  projects: Array<{ id: string; name: string; code: string }>;
  geofences: Array<{ id: string; name: string; kind: GeofenceKind; lat: number; lng: number; radiusM: number }>;
  openTrip: FleetTrip | null;
  approvalsToday: FleetApproval[];
  emergenciesLeft: number;
  recentTrips: FleetTrip[];
}

export async function fleetBootstrap(context: FleetContext): Promise<FleetBootstrap> {
  const settings = await loadFleetSettings(context.organizationId);
  const today = context.today;
  const [vehicles, purposes, projects, fences, driver, touching, openTrip, mine, myApprovalsSnap, inboxSnap, reviewSnap, myProjectIds] = await Promise.all([
    fleetVehicles(settings),
    activePurposes(),
    fleetProjects(),
    activeGeofences(),
    driverOf(context.userId),
    tripsOnDays([today, addDays(today, -1)]),
    myOpenTrip(context.userId),
    listMyTrips(context),
    db().collection(FLEET_COLLECTIONS.approvals).where('driverUserId', '==', context.userId).get(),
    db().collection(FLEET_COLLECTIONS.approvals).where('notifiedIds', 'array-contains', context.userId).get(),
    tripsCol().where('managerIds', 'array-contains', context.userId).get(),
    employeeProjectIdsOf(context.userId),
  ]);
  const todaysApprovals = (await db().collection(FLEET_COLLECTIONS.approvals).where('dateKey', '==', today).get()).docs.map((doc) => ({ ...(doc.data() as FleetApproval), id: doc.id }));
  const monthKey = monthOfDate(today);
  const emergenciesUsed = mine.filter((trip) => trip.isEmergency && trip.monthKey === monthKey && trip.status !== 'cancelled').length;
  const pendingForMe = inboxSnap.docs.filter((doc) => doc.data().status === 'pending' && doc.data().driverUserId !== context.userId).length;
  const reviewsForMe = reviewSnap.docs.filter((doc) => isFleetTrip(doc.data()) && doc.data().status === 'pending_review' && doc.data().driverUserId !== context.userId).length;
  const approverSomewhere = vehicles.some((vehicle) => vehicle.approverUid === context.userId || vehicle.backupApproverUid === context.userId) || settings.escalationUserIds.includes(context.userId);

  return {
    today,
    now: context.now,
    canDrive: Boolean(driver) || settings.anyEmployeeMayDrive,
    driver: driver ? { id: driver.id, name: driver.name } : null,
    access: context.fleet,
    isApprover: approverSomewhere || pendingForMe > 0 || reviewsForMe > 0 || inboxSnap.size > 0 || reviewSnap.size > 0,
    inbox: { approvals: pendingForMe, reviews: reviewsForMe },
    settings: {
      ocrEnabled: settings.ocrEnabled,
      emergencyMonthlyMax: settings.emergencyMonthlyMax,
      gpsGapMinutes: settings.gpsGapMinutes,
      companyTripsInFleet: settings.companyTripsInFleet,
      mismatchAbsKm: settings.mismatchAbsKm,
      mismatchPct: settings.mismatchPct,
      employeeProjectsOnly: settings.employeeProjectsOnly,
    },
    vehicles: vehicles
      .filter((vehicle) => vehicle.active)
      .map((vehicle) => {
        const allowance = dayAllowance(vehicle, today, todaysApprovals);
        return {
          id: vehicle.id,
          vehicleNumber: vehicle.vehicleNumber,
          vehicleType: vehicle.vehicleType,
          category: vehicle.category,
          fuelType: vehicle.fuelType,
          tankCapacityL: vehicle.tankCapacityL,
          currentOdometerKm: vehicle.currentOdometerKm,
          dailyKmLimit: vehicle.dailyKmLimit,
          usedTodayKm: kmUsedOn(touching, vehicle.id, today),
          allowedTodayKm: allowance.allowedKm,
          busy: Boolean(vehicle.currentTripId) && vehicle.currentTripId !== openTrip?.id,
          assignedToMe: Boolean(driver && (driver.assignedVehicleId === vehicle.id || vehicle.assignedDriverId === driver.id)),
        };
      }),
    purposes: purposes.map((purpose) => ({ id: purpose.id, name: purpose.name, requiresReason: purpose.requiresReason, requiresProject: purpose.requiresProject })),
    projects: projects.filter((project) => project.active).map((project) => ({ id: project.id, name: project.name, code: project.code })),
    geofences: fences.map((fence) => ({ id: fence.id, name: fence.name, kind: fence.kind, lat: fence.lat, lng: fence.lng, radiusM: fence.radiusM })),
    myProjectIds,
    openTrip,
    approvalsToday: myApprovalsSnap.docs.map((doc) => ({ ...(doc.data() as FleetApproval), id: doc.id })).filter((approval) => approval.dateKey === today).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    emergenciesLeft: emergenciesLeft(emergenciesUsed, settings.emergencyMonthlyMax),
    recentTrips: mine.filter((trip) => !OPEN_TRIP_STATUSES.includes(trip.status)).slice(0, 10),
  };
}

/* ── control dashboard ── */

export interface FleetDashboard {
  today: string;
  scope: 'all' | 'managed';
  running: FleetTrip[];
  todayFigures: { trips: number; km: number; vehiclesOverLimit: number; emergencies: number };
  pending: { approvals: number; reviews: number; tripExceptions: number; fuelExceptions: number };
  month: { monthKey: string; trips: number; km: number; perKmCost: number; fuelLitres: number; fuelAmount: number };
  byDay: Array<{ dateKey: string; km: number; trips: number }>;
  topVehicles: Array<{ vehicleId: string; vehicleNumber: string; km: number; trips: number }>;
  byProject: Array<{ projectId: string | null; projectName: string; km: number; trips: number }>;
  serviceDue: Array<{ vehicleId: string; vehicleNumber: string; dueInKm: number }>;
  lowMileage: FuelEntryView[];
}

export async function fleetDashboard(context: FleetContext): Promise<FleetDashboard> {
  const settings = await loadFleetSettings(context.organizationId);
  const all = context.fleet.viewAll || settings.escalationUserIds.includes(context.userId);
  const vehicles = await fleetVehicles(settings);
  const managedVehicles = new Set(vehicles.filter((vehicle) => vehicle.approverUid === context.userId || vehicle.backupApproverUid === context.userId).map((vehicle) => vehicle.id));
  if (!all && !managedVehicles.size) {
    const managed = await tripsCol().where('managerIds', 'array-contains', context.userId).limit(1).get();
    if (managed.empty) throw new FleetError('The fleet dashboard needs Fleet Trips · View, or vehicles you approve.', 403);
  }
  const today = context.today;
  const monthKey = monthOfDate(today);
  const from = addDays(today, -13) < monthRange(monthKey).from ? addDays(today, -13) : monthRange(monthKey).from;
  const [snapshot, pendingApprovals, fuelSnap, fuelOpen] = await Promise.all([
    tripsCol().where('dateKey', '>=', addDays(from, -1)).get(),
    db().collection(FLEET_COLLECTIONS.approvals).where('status', '==', 'pending').get(),
    db().collection(FLEET_COLLECTIONS.fuel).where('fuelDate', '>=', monthRange(monthKey).from).get(),
    openFuelExceptions(context, !all),
  ]);
  const inScope = (trip: FleetTrip) => all || managedVehicles.has(trip.vehicleId) || trip.managerIds.includes(context.userId);
  const trips = snapshot.docs.filter((doc) => isFleetTrip(doc.data())).map((doc) => toTrip(doc.id, doc.data())).filter(inScope).filter((trip) => trip.status !== 'cancelled');
  // The limit's reading of a trip's km on a day (including a running trip past midnight), but
  // site-internal running counts here: the dashboard shows all running, the limit only some.
  const kmOn = (trip: FleetTrip, day: string) => tripKmOn({ ...trip, siteInternal: false }, day);

  const running = trips.filter((trip) => OPEN_TRIP_STATUSES.includes(trip.status));
  const todays = trips.filter((trip) => kmOn(trip, today) > 0 || trip.dateKey === today);
  const vehiclesOverLimit = vehicles.filter((vehicle) => {
    const used = kmUsedOn(trips, vehicle.id, today);
    return used > vehicle.dailyKmLimit + 0.5;
  }).length;

  const monthTrips = trips.filter((trip) => trip.monthKey === monthKey || Object.keys(trip.kmByDate).some((day) => day.startsWith(monthKey)));
  const monthKm = round1(monthTrips.reduce((sum, trip) => sum + Object.entries(trip.kmByDate).filter(([day]) => day.startsWith(monthKey)).reduce((inner, [, km]) => inner + km, 0), 0));
  const fuelRows = fuelSnap.docs.map((doc) => doc.data()).filter((data) => all || managedVehicles.has(String(data.vehicleId)) || (Array.isArray(data.managerIds) && data.managerIds.includes(context.userId)));

  const days: FleetDashboard['byDay'] = [];
  for (let day = addDays(today, -13); day <= today; day = addDays(day, 1)) {
    const onDay = trips.filter((trip) => kmOn(trip, day) > 0);
    days.push({ dateKey: day, km: round1(onDay.reduce((sum, trip) => sum + kmOn(trip, day), 0)), trips: trips.filter((trip) => trip.dateKey === day).length });
  }

  const byVehicle = new Map<string, { vehicleId: string; vehicleNumber: string; km: number; trips: number }>();
  const byProject = new Map<string, { projectId: string | null; projectName: string; km: number; trips: number }>();
  for (const trip of monthTrips) {
    const km = Object.entries(trip.kmByDate).filter(([day]) => day.startsWith(monthKey)).reduce((sum, [, value]) => sum + value, 0);
    const vehicle = byVehicle.get(trip.vehicleId) ?? { vehicleId: trip.vehicleId, vehicleNumber: trip.vehicleNumber, km: 0, trips: 0 };
    vehicle.km += km;
    vehicle.trips += 1;
    byVehicle.set(trip.vehicleId, vehicle);
    const key = trip.projectId ?? '__none__';
    const project = byProject.get(key) ?? { projectId: trip.projectId, projectName: trip.projectName || 'No project', km: 0, trips: 0 };
    project.km += km;
    project.trips += 1;
    byProject.set(key, project);
  }

  const approvalsInScope = pendingApprovals.docs.filter((doc) => all || (doc.data().notifiedIds as string[] | undefined)?.includes(context.userId)).length;
  return {
    today,
    scope: all ? 'all' : 'managed',
    running: running.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    todayFigures: {
      trips: todays.length,
      km: round1(todays.reduce((sum, trip) => sum + kmOn(trip, today), 0)),
      vehiclesOverLimit,
      emergencies: todays.filter((trip) => trip.isEmergency).length,
    },
    pending: {
      approvals: approvalsInScope,
      reviews: trips.filter((trip) => trip.status === 'pending_review').length,
      tripExceptions: trips.filter((trip) => trip.exceptionStatus === 'open').length,
      fuelExceptions: fuelOpen.length,
    },
    month: {
      monthKey,
      trips: monthTrips.length,
      km: monthKm,
      perKmCost: round2(monthTrips.reduce((sum, trip) => sum + (trip.costSnapshot?.amount ?? 0), 0)),
      fuelLitres: round2(fuelRows.reduce((sum, data) => sum + (Number(data.quantityLiters) || 0), 0)),
      fuelAmount: round2(fuelRows.reduce((sum, data) => sum + (Number(data.totalAmount) || 0), 0)),
    },
    byDay: days,
    topVehicles: [...byVehicle.values()].map((row) => ({ ...row, km: round1(row.km) })).sort((a, b) => b.km - a.km).slice(0, 10),
    byProject: [...byProject.values()].map((row) => ({ ...row, km: round1(row.km) })).sort((a, b) => b.km - a.km).slice(0, 12),
    serviceDue: vehicles
      .filter((vehicle) => vehicle.active && (all || managedVehicles.has(vehicle.id)))
      .map((vehicle) => ({ vehicleId: vehicle.id, vehicleNumber: vehicle.vehicleNumber, dueInKm: serviceDueInKm(vehicle) }))
      .filter((row): row is { vehicleId: string; vehicleNumber: string; dueInKm: number } => row.dueInKm !== null && row.dueInKm <= 300)
      .sort((a, b) => a.dueInKm - b.dueInKm),
    lowMileage: fuelOpen.filter((entry) => entry.flagCodes.includes('low_mileage')).slice(0, 10),
  };
}

/* ── exceptions ── */

export async function fleetExceptions(context: FleetContext): Promise<{ trips: FleetTrip[]; fuel: FuelEntryView[]; scope: 'all' | 'managed' }> {
  const settings = await loadFleetSettings(context.organizationId);
  const all = context.fleet.viewAll || context.fleet.review || settings.escalationUserIds.includes(context.userId);
  const [snapshot, fuel] = await Promise.all([tripsCol().where('exceptionStatus', '==', 'open').get(), openFuelExceptions(context, !all)]);
  const trips = snapshot.docs
    .filter((doc) => isFleetTrip(doc.data()))
    .map((doc) => toTrip(doc.id, doc.data()))
    .filter((trip) => all || trip.managerIds.includes(context.userId))
    .filter((trip) => trip.driverUserId !== context.userId || all)
    .sort((a, b) => Number(b.status === 'pending_review') - Number(a.status === 'pending_review') || b.startedAt.localeCompare(a.startedAt));
  return { trips, fuel, scope: all ? 'all' : 'managed' };
}
