import 'server-only';

/**
 * Fleet trips on the server: start, track, end, review — every figure that decides money computed
 * here, inside transactions, never taken from the phone.
 *
 * - **Start** takes the vehicle's lock (`currentTripId`), checks the odometer against the last
 *   reading, the day's km against the limit (or an approval, or an emergency start), and the purpose
 *   and project. Starting needs a connection; everything after works offline and syncs later.
 * - **Points** arrive in batches of up to 200, idempotent on the phone's `clientPointId`.
 * - **End** is idempotent on `clientEndId`. `settle` measures the synced track, recomputes geofence
 *   arrivals, applies the billable rule and the flags, releases the lock and moves the vehicle's
 *   odometer. Points that arrive after the end re-settle the trip until a manager has reviewed it.
 */

import { computeTripDistanceDeltaKm, type TripLocationPoint } from '@/lib/vehicle-management';
import { reportingAuthorityOf } from '@/lib/employee-trips/server/lookups';
import { projectAllowed } from '@/lib/employee-projects/links';
import { employeeProjectIdsOf } from '@/lib/employee-projects/server';
import { addDays, istDateKey, istDayStartIso, minutesBetween, monthOfDate, toMs } from '../dates.ts';
import { attributeKm, detectGeofenceEvents, geofenceAt, measureTrack, visitsFromEvents } from '../geo.ts';
import { dayAllowance, emergenciesLeft, kmUsedOn, startLimitCheck } from '../limits.ts';
import { endTripSchema, forceCloseSchema, geofenceEventsSchema, pauseSchema, pointsSchema, resolveExceptionSchema, reviewSchema, startTripSchema } from '../schemas.ts';
import {
  awaitsDriverEnd,
  billableDecision,
  checkEndOdometer,
  checkStartOdometer,
  endFlags,
  finishFigures,
  ocrDisagrees,
  resolveReview,
  tripAbilities,
  tripCost,
  type FleetTripAbilities,
} from '../trips.ts';
import {
  FLEET_COLLECTIONS,
  OPEN_TRIP_STATUSES,
  formatKm,
  legacyTripStatus,
  round1,
  stripUndefined,
  type FleetApproval,
  type FleetSettings,
  type FleetTrip,
  type FleetVehicle,
  type Geofence,
  type OdometerReading,
  type TripFlagCode,
} from '../types.ts';
import { db, FleetError, type FleetContext } from './context';
import { afterAudit, afterMessages, type FleetMessage } from './notify';
import { activeGeofences, allGeofences, driverOf, fleetProjects, fleetVehicles, forgetVehicles, loadFleetSettings, activePurposes } from './lookups';
import { attachment, claimableUpload, uploadRef } from './uploads';

export const tripsCol = () => db().collection(FLEET_COLLECTIONS.trips);
const pointsCol = () => db().collection(FLEET_COLLECTIONS.points);
const eventsCol = () => db().collection(FLEET_COLLECTIONS.geofenceEvents);
const vehiclesCol = () => db().collection(FLEET_COLLECTIONS.vehicles);
const approvalsCol = () => db().collection(FLEET_COLLECTIONS.approvals);

/** Points sent after a trip ended are still taken for this long (a phone flushing its queue late). */
const LATE_POINTS_HOURS = 48;
/** Recorder-down stretches kept on a trip (`trackingGaps`, sent by the app with its points). */
const MAX_TRACKING_GAPS = 50;

const tripLink = (id: string) => `/driver-management/fleet/trips/${id}`;

const num = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const odometer = (value: unknown): OdometerReading | null => {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  return { km: num(entry.km), photoPath: str(entry.photoPath) || null, ocrKm: entry.ocrKm === null || entry.ocrKm === undefined ? null : num(entry.ocrKm), ocrRaw: str(entry.ocrRaw) || null, at: str(entry.at) };
};

/** A trip document as the fleet reads it (fleet trips only — see `isFleetTrip`). */
export function toTrip(id: string, data: Record<string, unknown>): FleetTrip {
  const status = (OPEN_TRIP_STATUSES as string[]).concat(['completed', 'pending_review', 'cancelled']).includes(str(data.status)) ? (data.status as FleetTrip['status']) : 'completed';
  return {
    id,
    organizationId: str(data.organizationId),
    status,
    vehicleId: str(data.vehicleId),
    vehicleNumber: str(data.vehicleNumber),
    vehicleCategory: (str(data.vehicleCategory) || 'car') as FleetTrip['vehicleCategory'],
    driverUserId: str(data.driverUserId),
    driverId: str(data.driverId) || null,
    driverName: str(data.driverName),
    dateKey: str(data.dateKey),
    monthKey: str(data.monthKey),
    startedAt: str(data.startedAt),
    endedAt: str(data.endedAt) || null,
    projectId: str(data.projectId) || null,
    projectCode: str(data.projectCode),
    projectName: str(data.projectName),
    purposeId: str(data.purposeId),
    purposeName: str(data.purposeName),
    purposeReason: str(data.purposeReason),
    expectedKm: num(data.expectedKm),
    startGeofenceId: str(data.startGeofenceId) || null,
    startGeofenceName: str(data.startGeofenceName),
    startPlace: str(data.startPlace),
    endPlace: str(data.endPlace),
    endGeofenceId: str(data.endGeofenceId) || null,
    endGeofenceName: str(data.endGeofenceName),
    startLat: data.startLat === null || data.startLat === undefined ? null : num(data.startLat),
    startLng: data.startLng === null || data.startLng === undefined ? null : num(data.startLng),
    endLat: data.endLat === null || data.endLat === undefined ? null : num(data.endLat),
    endLng: data.endLng === null || data.endLng === undefined ? null : num(data.endLng),
    startOdometer: odometer(data.startOdometer) ?? { km: 0, photoPath: null, ocrKm: null, ocrRaw: null, at: '' },
    endOdometer: odometer(data.endOdometer),
    gpsDistanceKm: num(data.gpsDistanceKm),
    odoDistanceKm: data.odoDistanceKm === null || data.odoDistanceKm === undefined ? null : num(data.odoDistanceKm),
    billableDistanceKm: data.billableDistanceKm === null || data.billableDistanceKm === undefined ? null : num(data.billableDistanceKm),
    billableSource: (str(data.billableSource) || null) as FleetTrip['billableSource'],
    kmByDate: (data.kmByDate as Record<string, number>) ?? {},
    gpsKmByDate: (data.gpsKmByDate as Record<string, number>) ?? {},
    pointCount: num(data.pointCount),
    lastPointAt: str(data.lastPointAt) || null,
    lastPointLat: data.lastPointLat === null || data.lastPointLat === undefined ? null : num(data.lastPointLat),
    lastPointLng: data.lastPointLng === null || data.lastPointLng === undefined ? null : num(data.lastPointLng),
    idleMinutes: num(data.idleMinutes),
    movingMinutes: num(data.movingMinutes),
    gapCount: num(data.gapCount),
    visits: Array.isArray(data.visits) ? (data.visits as FleetTrip['visits']) : [],
    geofenceEvents: Array.isArray(data.geofenceEvents) ? (data.geofenceEvents as FleetTrip['geofenceEvents']) : [],
    flagCodes: Array.isArray(data.flagCodes) ? (data.flagCodes as TripFlagCode[]) : [],
    flagged: data.flagged === true,
    exceptionStatus: (['none', 'open', 'resolved'].includes(str(data.exceptionStatus)) ? data.exceptionStatus : 'none') as FleetTrip['exceptionStatus'],
    exceptionNote: str(data.exceptionNote),
    approvalId: str(data.approvalId) || null,
    approvedKmCap: data.approvedKmCap === null || data.approvedKmCap === undefined ? null : num(data.approvedKmCap),
    isEmergency: data.isEmergency === true,
    emergencyReason: str(data.emergencyReason),
    siteInternal: data.siteInternal === true,
    chainPrevTripId: str(data.chainPrevTripId) || null,
    managerIds: Array.isArray(data.managerIds) ? data.managerIds.map(String) : [],
    costSnapshot: (data.costSnapshot as FleetTrip['costSnapshot']) ?? null,
    review: (data.review as FleetTrip['review']) ?? null,
    pausedAt: str(data.pausedAt) || null,
    pauses: Array.isArray(data.pauses) ? (data.pauses as FleetTrip['pauses']) : [],
    endedBy: (str(data.endedBy) || null) as FleetTrip['endedBy'],
    endRemark: str(data.endRemark),
    cancelReason: str(data.cancelReason),
    clientStartId: str(data.clientStartId),
    clientEndId: str(data.clientEndId) || null,
    reportedIn: str(data.reportedIn) || null,
    createdAt: str(data.createdAt),
    updatedAt: str(data.updatedAt),
  };
}

export const isFleetTrip = (data: Record<string, unknown> | undefined) => data?.fleet === true;

/** A Firestore timestamp (or an ISO string) as ISO; '' when it is neither. */
function stampIso(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const stamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof stamp.toDate === 'function') return stamp.toDate().toISOString();
    const seconds = stamp.seconds ?? stamp._seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString();
  }
  return '';
}

/**
 * A trip recorded before SEL Fleet, by the browser tracker that was retired on 2026-10-24, read as
 * a fleet trip so the register Trip Management showed stays in view. Read-only: it has no odometer,
 * no billable figure and no flags, nothing acts on it (every mutation checks `isFleetTrip`), and
 * `legacy` tells the screens to say so.
 */
export function legacyToTrip(id: string, data: Record<string, unknown>): FleetTrip {
  const startedAt = str(data.startTimeIso) || stampIso(data.createdAt);
  const tripStatus = str(data.tripStatus);
  const status: FleetTrip['status'] = tripStatus === 'In Progress' ? 'running' : tripStatus === 'Cancelled' ? 'cancelled' : 'completed';
  const dateKey = Number.isFinite(toMs(startedAt)) ? istDateKey(startedAt) : '';
  const trip = toTrip(id, {
    status,
    vehicleId: str(data.vehicleId),
    vehicleNumber: str(data.vehicleNumber),
    driverId: str(data.driverId),
    driverUserId: str(data.linkedUserId),
    driverName: str(data.driverName),
    dateKey,
    monthKey: dateKey.slice(0, 7),
    startedAt,
    endedAt: str(data.endTimeIso),
    startPlace: str(data.startAddress),
    endPlace: str(data.endAddress),
    gpsDistanceKm: num(data.totalDistanceKm),
    pointCount: num(data.totalPoints),
    lastPointLat: data.lastLocationLat ?? null,
    lastPointLng: data.lastLocationLng ?? null,
    createdAt: startedAt,
    updatedAt: stampIso(data.updatedAt),
  });
  return { ...trip, legacy: true };
}

/** Nothing can be done to a legacy trip. */
const NO_ABILITIES: FleetTripAbilities = { end: false, pause: false, resume: false, cancel: false, review: false, forceClose: false, resolve: false };

/** The legacy fields Vehicle Management › Trip Management and the GPS log still read. */
function legacyFields(trip: FleetTrip) {
  return {
    tripStatus: legacyTripStatus(trip.status),
    linkedUserId: trip.driverUserId,
    startTimeIso: trip.startedAt,
    endTimeIso: trip.endedAt ?? '',
    startAddress: trip.startPlace || trip.startGeofenceName,
    endAddress: trip.endPlace || trip.endGeofenceName,
    totalDistanceKm: trip.billableDistanceKm ?? trip.gpsDistanceKm,
    totalPoints: trip.pointCount,
    lastLocationLat: trip.lastPointLat,
    lastLocationLng: trip.lastPointLng,
  };
}

/** The whole document for a trip: fleet fields, the legacy mirror, the marker. */
export const tripDocument = (trip: FleetTrip) => stripUndefined({ ...trip, ...legacyFields(trip), fleet: true, fleetVersion: 1 });

/**
 * A whole-trip write over the stored document. Not `merge`: Firestore merges maps key by key, so a
 * re-settled trip would keep a day in `kmByDate` (or a key in `review`) its new figures no longer
 * have. Fields only other operations write (`reportedAt`, who resolved an exception) are carried over.
 */
const replaceTrip = (stored: { data(): Record<string, unknown> | undefined }, trip: FleetTrip) => ({ ...(stored.data() ?? {}), ...tripDocument(trip) });

/* ── who manages a trip ── */

async function managerIdsFor(vehicle: FleetVehicle, driverUserId: string): Promise<string[]> {
  const authority = vehicle.approverUid ? [] : (await reportingAuthorityOf(driverUserId)).ids;
  return [...new Set([vehicle.approverUid, vehicle.backupApproverUid, ...authority].filter((id): id is string => Boolean(id) && id !== driverUserId))];
}

export function managesTrip(context: FleetContext, settings: FleetSettings, trip: Pick<FleetTrip, 'managerIds' | 'driverUserId'>): boolean {
  if (trip.driverUserId === context.userId) return false;
  return trip.managerIds.includes(context.userId) || settings.escalationUserIds.includes(context.userId) || context.fleet.review;
}

export function abilitiesFor(context: FleetContext, settings: FleetSettings, trip: FleetTrip): FleetTripAbilities {
  const isManager = trip.managerIds.includes(context.userId) || settings.escalationUserIds.includes(context.userId);
  return tripAbilities(trip, { userId: context.userId, isManager, canReview: context.fleet.review, canForceClose: context.fleet.forceClose }, context.now);
}

/* ── reading trips ── */

export async function tripsOnDays(dateKeys: string[]): Promise<FleetTrip[]> {
  const snapshot = await tripsCol().where('dateKey', 'in', [...new Set(dateKeys)].slice(0, 10)).get();
  return snapshot.docs.filter((doc) => isFleetTrip(doc.data())).map((doc) => toTrip(doc.id, doc.data()));
}

async function loadTrip(tripId: string): Promise<FleetTrip> {
  const snapshot = await tripsCol().doc(tripId).get();
  if (!snapshot.exists || !isFleetTrip(snapshot.data())) throw new FleetError('That trip was not found.', 404);
  return toTrip(snapshot.id, snapshot.data()!);
}

export async function myOpenTrip(userId: string): Promise<FleetTrip | null> {
  const snapshot = await tripsCol().where('driverUserId', '==', userId).get();
  return snapshot.docs.map((doc) => toTrip(doc.id, doc.data())).find((trip) => OPEN_TRIP_STATUSES.includes(trip.status)) ?? null;
}

async function trackOf(tripId: string): Promise<TripLocationPoint[]> {
  const snapshot = await pointsCol().where('tripId', '==', tripId).get();
  return snapshot.docs
    .map((doc) => doc.data() as Record<string, unknown>)
    .map((row) => ({
      lat: num(row.lat, Number.NaN),
      lng: num(row.lng, Number.NaN),
      accuracyMeters: row.accuracyMeters === null || row.accuracyMeters === undefined ? undefined : num(row.accuracyMeters),
      speedKmph: row.speedKmph === null || row.speedKmph === undefined ? undefined : num(row.speedKmph),
      headingDeg: row.headingDeg === null || row.headingDeg === undefined ? undefined : num(row.headingDeg),
      recordedAtIso: str(row.recordedAtIso),
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .sort((a, b) => toMs(a.recordedAtIso) - toMs(b.recordedAtIso));
}

async function vehicleFor(settings: FleetSettings, vehicleId: string): Promise<FleetVehicle> {
  const vehicle = (await fleetVehicles(settings)).find((entry) => entry.id === vehicleId);
  if (!vehicle) throw new FleetError('That vehicle is not in Vehicle Master.', 404);
  return vehicle;
}

/* ── start ── */

export interface StartResult {
  trip: FleetTrip;
}

export async function startTrip(context: FleetContext, body: unknown): Promise<StartResult> {
  const input = startTripSchema.parse(body);
  const [settings, purposes, projects, fences, driver] = await Promise.all([
    loadFleetSettings(context.organizationId),
    activePurposes(),
    fleetProjects(),
    activeGeofences(),
    driverOf(context.userId),
  ]);
  if (!driver && !settings.anyEmployeeMayDrive) throw new FleetError('Only drivers in Driver Master can drive company vehicles.', 403);

  // A retry of a start that already went through returns that trip.
  const repeat = await tripsCol().where('clientStartId', '==', input.clientStartId).limit(1).get();
  if (!repeat.empty) {
    const trip = toTrip(repeat.docs[0].id, repeat.docs[0].data());
    if (trip.driverUserId !== context.userId) throw new FleetError('That trip id is in use.', 409);
    return { trip };
  }

  const vehicle = await vehicleFor(settings, input.vehicleId);
  if (!vehicle.active) throw new FleetError(`${vehicle.vehicleNumber} has left the fleet.`, 400);

  const purpose = purposes.find((entry) => entry.id === input.purposeId);
  if (!purpose) throw new FleetError('Choose the purpose of the trip.', 400, { fields: { purposeId: 'Choose a purpose.' } });
  if (purpose.requiresReason && input.purposeReason.length < 3) throw new FleetError('Say what the trip is for.', 400, { fields: { purposeReason: 'Say what the trip is for.' } });
  const project = input.projectId ? projects.find((entry) => entry.id === input.projectId) : null;
  if (input.projectId && !project) throw new FleetError('That project no longer exists.', 400, { fields: { projectId: 'Choose another project.' } });
  if (purpose.requiresProject && !project) throw new FleetError(`A ${purpose.name.toLowerCase()} is billed to a project — choose it.`, 400, { fields: { projectId: 'Choose the project.' } });
  // Settings › Fleet may limit a trip to the employee's own projects (their greytHR project, linked
  // on Employee › Category); someone with no linked project may pick any.
  if (settings.employeeProjectsOnly && input.projectId && !projectAllowed(input.projectId, await employeeProjectIdsOf(context.userId), true)) {
    throw new FleetError('Choose one of your projects — Settings › Fleet limits trips to the employee’s own projects.', 400, { fields: { projectId: 'Choose one of your projects.' } });
  }

  const open = await myOpenTrip(context.userId);
  if (open) throw new FleetError(`You already have a trip running on ${open.vehicleNumber}. End it first.`, 409, { code: 'driver_busy', tripId: open.id });

  // The day's km so far (a trip started yesterday may have run into today).
  const today = context.today;
  const [touching, approvalSnapshot, myTrips] = await Promise.all([
    tripsOnDays([today, addDays(today, -1)]),
    approvalsCol().where('vehicleId', '==', vehicle.id).get(),
    tripsCol().where('driverUserId', '==', context.userId).get(),
  ]);
  const approvals = approvalSnapshot.docs.map((doc) => ({ ...(doc.data() as FleetApproval), id: doc.id })).filter((approval) => approval.dateKey === today);
  const usedKm = kmUsedOn(touching, vehicle.id, today);
  const allowance = dayAllowance(vehicle, today, approvals);
  const position = input.position;
  const fence = position ? geofenceAt(position, fences) : null;
  const siteInternalCandidate = vehicle.siteInternalExemptFromLimit && fence?.kind === 'project_site';
  const limit = startLimitCheck({ usedKm, expectedKm: input.expectedKm, ...allowance });

  let isEmergency = false;
  if (!limit.ok && !siteInternalCandidate) {
    if (!input.emergency) {
      const pending = approvals.find((approval) => approval.status === 'pending' && approval.driverUserId === context.userId);
      throw new FleetError(
        `${vehicle.vehicleNumber} has ${formatKm(limit.remainingKm)} left today (limit ${formatKm(allowance.allowedKm)}, ${formatKm(usedKm)} used). A ${formatKm(input.expectedKm)} trip needs approval.`,
        409,
        { code: 'over_limit', limit, pendingApprovalId: pending?.id ?? null },
      );
    }
    const monthKey = monthOfDate(today);
    const used = myTrips.docs.map((doc) => doc.data()).filter((data) => data.isEmergency === true && data.monthKey === monthKey && data.status !== 'cancelled').length;
    if (emergenciesLeft(used, settings.emergencyMonthlyMax) <= 0) {
      throw new FleetError(`You have used all ${settings.emergencyMonthlyMax} emergency starts this month. Ask for approval instead.`, 403, { code: 'no_emergency_left' });
    }
    isEmergency = true;
  }

  if (!input.startOdometer.uploadId) throw new FleetError('Take a photo of the odometer.', 400, { fields: { startOdometer: 'Take a photo of the odometer.' } });
  const photo = await claimableUpload(input.startOdometer.uploadId, context.userId, 'odometer');

  let chainPrevTripId: string | null = null;
  if (input.chainPrevTripId) {
    const previous = myTrips.docs.find((doc) => doc.id === input.chainPrevTripId);
    const data = previous ? toTrip(previous.id, previous.data()) : null;
    if (data && data.vehicleId === vehicle.id && data.endedAt && minutesBetween(data.endedAt, context.now) <= 60) chainPrevTripId = data.id;
  }

  const managerIds = await managerIdsFor(vehicle, context.userId);
  const tripRef = tripsCol().doc();
  const vehicleRef = vehiclesCol().doc(vehicle.id);
  const approvalRef = allowance.approvalId ? approvalsCol().doc(allowance.approvalId) : null;

  const trip = await db().runTransaction(async (transaction) => {
    const [vehicleSnap, approvalSnap] = await Promise.all([transaction.get(vehicleRef), approvalRef ? transaction.get(approvalRef) : Promise.resolve(null)]);
    if (!vehicleSnap.exists) throw new FleetError('That vehicle is not in Vehicle Master.', 404);
    const fresh = vehicleSnap.data() as Record<string, unknown>;
    const lockedBy = str(fresh.currentTripId);
    if (lockedBy) {
      const holder = await transaction.get(tripsCol().doc(lockedBy));
      const held = holder.exists ? toTrip(holder.id, holder.data()!) : null;
      // A lock left by a trip that is no longer open is stale (it ended without releasing): take it.
      if (held && OPEN_TRIP_STATUSES.includes(held.status)) {
        throw new FleetError(`${vehicle.vehicleNumber} is on a trip with ${held.driverName} since ${held.startedAt.slice(11, 16)} UTC. It must be ended first.`, 409, { code: 'vehicle_busy', tripId: held.id });
      }
    }
    // The odometer, against the reading as it is now (another trip may just have ended).
    const current = { ...vehicle, currentOdometerKm: Number(fresh.currentOdometerKm) > 0 ? Number(fresh.currentOdometerKm) : null };
    const odometerCheck = checkStartOdometer(input.startOdometer.km, current, settings);

    const flags = new Set<TripFlagCode>(odometerCheck.flags);
    if (isEmergency) flags.add('emergency');
    if (ocrDisagrees(input.startOdometer.km, photo.ocrKm)) flags.add('ocr_mismatch');
    const baseline = vehicle.odometerBaselineHistory.at(-1);
    if (baseline && current.currentOdometerKm === baseline.km) flags.add('odometer_baseline');

    const approval = approvalSnap?.exists ? ({ ...(approvalSnap.data() as FleetApproval), id: approvalSnap.id }) : null;
    const usingApproval = approval && approval.status === 'approved' ? approval : null;

    const record: FleetTrip = {
      id: tripRef.id,
      organizationId: context.organizationId,
      status: 'running',
      vehicleId: vehicle.id,
      vehicleNumber: vehicle.vehicleNumber,
      vehicleCategory: vehicle.category,
      driverUserId: context.userId,
      driverId: driver?.id ?? null,
      driverName: driver?.name || context.userName,
      dateKey: today,
      monthKey: monthOfDate(today),
      startedAt: context.now,
      endedAt: null,
      projectId: project?.id ?? null,
      projectCode: project?.code ?? '',
      projectName: project?.name ?? '',
      purposeId: purpose.id,
      purposeName: purpose.name,
      purposeReason: input.purposeReason,
      expectedKm: round1(input.expectedKm),
      startGeofenceId: fence?.id ?? null,
      startGeofenceName: fence?.name ?? '',
      startPlace: input.startPlace || fence?.name || '',
      endPlace: '',
      endGeofenceId: null,
      endGeofenceName: '',
      startLat: position?.lat ?? null,
      startLng: position?.lng ?? null,
      endLat: null,
      endLng: null,
      startOdometer: { km: input.startOdometer.km, photoPath: photo.storagePath, ocrKm: photo.ocrKm, ocrRaw: photo.ocrText ? photo.ocrText.slice(0, 300) : null, at: context.now },
      endOdometer: null,
      gpsDistanceKm: 0,
      odoDistanceKm: null,
      billableDistanceKm: null,
      billableSource: null,
      kmByDate: {},
      gpsKmByDate: {},
      pointCount: 0,
      lastPointAt: null,
      lastPointLat: position?.lat ?? null,
      lastPointLng: position?.lng ?? null,
      idleMinutes: 0,
      movingMinutes: 0,
      gapCount: 0,
      visits: [],
      geofenceEvents: [],
      flagCodes: [...flags],
      flagged: flags.size > 0,
      exceptionStatus: flags.size > 0 ? 'open' : 'none',
      exceptionNote: '',
      approvalId: usingApproval?.id ?? null,
      approvedKmCap: usingApproval?.allowedKm ?? null,
      isEmergency,
      emergencyReason: input.emergency?.reason ?? '',
      siteInternal: false,
      chainPrevTripId,
      managerIds,
      costSnapshot: null,
      review: null,
      pausedAt: null,
      pauses: [],
      endedBy: null,
      endRemark: '',
      cancelReason: '',
      clientStartId: input.clientStartId,
      clientEndId: null,
      reportedIn: null,
      createdAt: context.now,
      updatedAt: context.now,
    };
    transaction.set(tripRef, { ...tripDocument(record), trackingIntervalSec: 10, driverId: record.driverId ?? '' });
    transaction.set(vehicleRef, { currentTripId: tripRef.id, currentOdometerKm: input.startOdometer.km, updatedAt: context.now }, { merge: true });
    transaction.set(uploadRef(photo.id), attachment({ kind: 'trip', id: tripRef.id }, managerIds), { merge: true });
    if (usingApproval && approvalRef) {
      transaction.set(approvalRef, { status: 'used', tripId: tripRef.id, updatedAt: context.now, history: [...usingApproval.history, { at: context.now, action: 'used', byId: context.userId, byName: context.userName, level: usingApproval.level, note: tripRef.id }] }, { merge: true });
    }
    return record;
  });
  forgetVehicles();

  const messages: FleetMessage[] = [];
  if (trip.isEmergency) {
    messages.push({
      userIds: [...trip.managerIds, ...settings.escalationUserIds],
      title: `Emergency start on ${trip.vehicleNumber}`,
      body: `${trip.driverName} started past the daily limit: ${trip.emergencyReason}`,
      link: tripLink(trip.id),
      channels: ['push', 'email'],
      severity: 'WARNING',
      type: 'record_assigned',
      itemId: trip.id,
      organizationId: trip.organizationId,
    });
  }
  if (trip.flagCodes.includes('unlogged_km')) {
    messages.push({
      userIds: trip.managerIds,
      title: `${trip.vehicleNumber} ran without a trip`,
      body: `Its opening reading is ${formatKm(trip.startOdometer.km - (vehicle.currentOdometerKm ?? trip.startOdometer.km))} above the last closing reading.`,
      link: tripLink(trip.id),
      severity: 'WARNING',
      type: 'record_assigned',
      itemId: trip.id,
      organizationId: trip.organizationId,
    });
  }
  afterMessages(messages, context.userId);
  afterAudit(context, 'Start Fleet Trip', { after: { vehicle: trip.vehicleNumber, odometer: trip.startOdometer.km, project: trip.projectName, purpose: trip.purposeName, expectedKm: trip.expectedKm, emergency: trip.isEmergency, flags: trip.flagCodes } }, trip.id, trip.vehicleNumber);
  return { trip };
}

/* ── points and events ── */

function acceptsPoints(trip: FleetTrip, now: string): boolean {
  if (OPEN_TRIP_STATUSES.includes(trip.status)) return true;
  if (trip.status === 'cancelled' || !trip.endedAt) return false;
  return minutesBetween(trip.endedAt, now) <= LATE_POINTS_HOURS * 60;
}

export async function addPoints(context: FleetContext, tripId: string, body: unknown): Promise<{ accepted: number; duplicates: number; gpsDistanceKm: number; pointCount: number; status: FleetTrip['status'] }> {
  const input = pointsSchema.parse(body);
  const tripRef = tripsCol().doc(tripId);
  // Within one batch, a point sent twice counts once.
  const unique = [...new Map(input.points.map((point) => [point.clientPointId, point])).values()];
  const refs = unique.map((point) => pointsCol().doc(`${tripId}_${point.clientPointId}`));

  const outcome = await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(tripRef);
    if (!snapshot.exists || !isFleetTrip(snapshot.data())) throw new FleetError('That trip was not found.', 404);
    const trip = toTrip(snapshot.id, snapshot.data()!);
    if (trip.driverUserId !== context.userId) throw new FleetError('That trip is not yours.', 403);
    if (!acceptsPoints(trip, context.now)) throw new FleetError('That trip is closed.', 409, { code: 'trip_closed' });

    // A batch may carry only gap records; getAll() needs at least one reference.
    const existing = refs.length ? await transaction.getAll(...refs) : [];
    const fresh = unique.filter((_, index) => !existing[index].exists);
    // Ignore fixes stamped before the trip began or impossibly far in the future.
    const startMs = toMs(trip.startedAt) - 5 * 60_000;
    const maxMs = toMs(context.now) + 10 * 60_000;
    const usable = fresh.filter((point) => toMs(point.recordedAt) >= startMs && toMs(point.recordedAt) <= maxMs).sort((a, b) => toMs(a.recordedAt) - toMs(b.recordedAt));

    for (const point of usable) {
      transaction.set(pointsCol().doc(`${tripId}_${point.clientPointId}`), {
        tripId,
        fleet: true,
        clientPointId: point.clientPointId,
        driverId: trip.driverId ?? '',
        driverUserId: trip.driverUserId,
        vehicleId: trip.vehicleId,
        lat: point.lat,
        lng: point.lng,
        accuracyMeters: point.accuracyM ?? 0,
        speedKmph: point.speedKmph ?? 0,
        headingDeg: point.headingDeg ?? 0,
        recordedAtIso: point.recordedAt,
        receivedAt: context.now,
      });
    }

    // A live running figure, leg by leg from the last fix. Out-of-order batches (an offline queue)
    // are not added here; the end of the trip measures the whole track again.
    let gps = trip.gpsDistanceKm;
    let last = trip.lastPointAt ? { lat: trip.lastPointLat as number, lng: trip.lastPointLng as number, recordedAtIso: trip.lastPointAt } : null;
    for (const point of usable) {
      if (last && toMs(point.recordedAt) <= toMs(last.recordedAtIso)) continue;
      if (last) gps += computeTripDistanceDeltaKm({ ...last }, { lat: point.lat, lng: point.lng, accuracyMeters: point.accuracyM ?? undefined, recordedAtIso: point.recordedAt });
      last = { lat: point.lat, lng: point.lng, recordedAtIso: point.recordedAt };
    }
    const pointCount = trip.pointCount + usable.length;
    const open = OPEN_TRIP_STATUSES.includes(trip.status);
    const patch: Record<string, unknown> = { pointCount, totalPoints: pointCount, updatedAt: context.now };
    if (open) {
      patch.gpsDistanceKm = round1(gps);
      patch.totalDistanceKm = round1(gps);
      if (last) Object.assign(patch, { lastPointAt: last.recordedAtIso, lastPointLat: last.lat, lastPointLng: last.lng, lastLocationLat: last.lat, lastLocationLng: last.lng });
    }
    // Where the phone's recorder was down (`gaps`): kept on the trip, the last 50, without repeats.
    if (input.gaps?.length) {
      const stored = Array.isArray(snapshot.data()?.trackingGaps) ? (snapshot.data()!.trackingGaps as Array<{ fromAt: string; toAt: string }>) : [];
      const byKey = new Map([...stored, ...input.gaps].map((gap) => [`${gap.fromAt}|${gap.toAt}`, { fromAt: gap.fromAt, toAt: gap.toAt }]));
      patch.trackingGaps = [...byKey.values()].sort((a, b) => a.fromAt.localeCompare(b.fromAt)).slice(-MAX_TRACKING_GAPS);
    }
    if (usable.length || input.gaps?.length) transaction.set(tripRef, patch, { merge: true });
    return { trip, accepted: usable.length, duplicates: input.points.length - usable.length, gps: open ? round1(gps) : trip.gpsDistanceKm, pointCount };
  });

  // Points for a trip already ended: measure it again, unless a manager has settled it.
  if (outcome.accepted && !OPEN_TRIP_STATUSES.includes(outcome.trip.status) && outcome.trip.review?.status !== 'resolved') {
    await settle(context, tripId, { reason: 'late-points' });
  }
  return { accepted: outcome.accepted, duplicates: outcome.duplicates, gpsDistanceKm: outcome.gps, pointCount: outcome.pointCount, status: outcome.trip.status };
}

export async function addGeofenceEvents(context: FleetContext, tripId: string, body: unknown): Promise<{ accepted: number }> {
  const input = geofenceEventsSchema.parse(body);
  const trip = await loadTrip(tripId);
  if (trip.driverUserId !== context.userId) throw new FleetError('That trip is not yours.', 403);
  const fences = new Map((await allGeofences()).map((fence) => [fence.id, fence]));
  const batch = db().batch();
  let accepted = 0;
  for (const event of input.events) {
    const fence = fences.get(event.geofenceId);
    if (!fence) continue;
    batch.set(eventsCol().doc(`${tripId}_${event.clientEventId}`), { tripId, vehicleId: trip.vehicleId, driverUserId: trip.driverUserId, geofenceId: fence.id, geofenceName: fence.name, kind: fence.kind, type: event.type, at: event.at, lat: event.lat, lng: event.lng, source: 'device', receivedAt: context.now });
    accepted += 1;
  }
  if (accepted) await batch.commit();
  return { accepted };
}

/* ── settling: the end of a trip ── */

interface SettleInput {
  reason: 'end' | 'late-points' | 'force' | 'auto_idle' | 'auto_max';
  endOdometer?: OdometerReading | null;
  endedAt?: string;
  position?: { lat: number; lng: number } | null;
  remark?: string;
  endPlace?: string;
  clientEndId?: string;
  endUploadId?: string | null;
  autoClosed?: boolean;
  /**
   * The driver's own end of a trip the server had already closed by itself (`awaitsDriverEnd`): it
   * settles the trip again with the reading and photo, and the auto-close no longer counts against it.
   */
  lateDriverEnd?: boolean;
  actor?: { id: string; name: string };
}

/**
 * Measure, decide and close a trip. Used by the driver's end, a manager's force-close, the idle
 * and 12-hour jobs, and late points. Re-running it on the same data gives the same result.
 */
export async function settle(context: Pick<FleetContext, 'organizationId' | 'now' | 'userId' | 'userName'>, tripId: string, input: SettleInput): Promise<FleetTrip> {
  const settings = await loadFleetSettings(context.organizationId);
  const before = await loadTrip(tripId);
  const [points, fences, vehicle] = await Promise.all([trackOf(tripId), activeGeofences(), vehicleFor(settings, before.vehicleId)]);

  const endedAt = input.endedAt ?? before.endedAt ?? context.now;
  const endOdometer = input.endOdometer !== undefined ? input.endOdometer : before.endOdometer;
  const measure = measureTrack(points, { gapMinutes: settings.gpsGapMinutes, startedAt: before.startedAt, endedAt });
  // Where the trip started counts as its first fix, so leaving the start geofence is seen even when
  // the phone's first tracked fix is already outside it.
  const fixes = points.map((point) => ({ lat: point.lat, lng: point.lng, accuracyM: point.accuracyMeters ?? null, at: point.recordedAtIso ?? endedAt }));
  if (before.startLat !== null && before.startLng !== null) fixes.unshift({ lat: before.startLat, lng: before.startLng, accuracyM: null, at: before.startedAt });
  const { events } = detectGeofenceEvents(fixes, fences);
  const visits = visitsFromEvents(events, endedAt);
  const endPoint = input.position ?? (measure.last ? { lat: measure.last.lat, lng: measure.last.lng } : before.endLat !== null && before.endLng !== null ? { lat: before.endLat, lng: before.endLng as number } : null);
  const endFence: Geofence | null = endPoint ? geofenceAt(endPoint, fences) : null;
  const startFence = before.startGeofenceId ? fences.find((fence) => fence.id === before.startGeofenceId) : null;
  // Exempt vehicles that never left the project site they started in.
  const siteInternal = Boolean(vehicle.siteInternalExemptFromLimit && startFence?.kind === 'project_site' && endFence?.id === startFence.id && events.every((event) => event.geofenceId === startFence.id));

  const odoKm = endOdometer ? checkEndOdometer(before.startOdometer.km, endOdometer.km) : null;
  const decision = billableDecision({ gpsKm: measure.gpsKm, odoKm, usablePoints: measure.usablePoints }, settings);

  const days = [...new Set([before.dateKey, ...Object.keys(measure.kmByDate)])];
  const touching = await tripsOnDays([...days, addDays(before.dateKey, -1)]);
  const otherKmByDate = Object.fromEntries(days.map((day) => [day, kmUsedOn(touching, before.vehicleId, day, before.id)]));
  let allowedKm: number | null = before.approvedKmCap;
  if (allowedKm === null) {
    const approvals = (await approvalsCol().where('vehicleId', '==', before.vehicleId).get()).docs.map((doc) => ({ ...(doc.data() as FleetApproval), id: doc.id }));
    const allowance = dayAllowance(vehicle, before.dateKey, approvals);
    allowedKm = allowance.approvalId ? allowance.allowedKm : null;
  }
  // Flags raised at the start stay; those measured from the track are worked out again.
  const carried = before.flagCodes.filter((flag) => ['unlogged_km', 'emergency', 'odometer_baseline'].includes(flag));
  const ocrMismatch = before.flagCodes.includes('ocr_mismatch') || Boolean(endOdometer && ocrDisagrees(endOdometer.km, endOdometer.ocrKm));
  const flags = endFlags({
    decision,
    gapCount: measure.gapCount,
    longestStopMinutes: measure.longestStopMinutes,
    kmByDate: decision.km === null ? measure.kmByDate : attributeKm(decision.km, measure.kmByDate, before.dateKey),
    startDateKey: before.dateKey,
    otherKmByDate,
    limitKm: vehicle.dailyKmLimit,
    allowedKm,
    siteInternal,
    isEmergency: before.isEmergency,
    ocrMismatch,
    // The driver ending it late (after an offline auto-close) clears the auto-close.
    autoClosed: input.lateDriverEnd ? false : Boolean(input.autoClosed || before.flagCodes.includes('auto_closed')),
    carried,
  });
  const figures = finishFigures({ decision, gpsKmByDate: measure.kmByDate, startDateKey: before.dateKey, vehicle, flags });
  const endedBy: FleetTrip['endedBy'] = input.reason === 'end' ? 'driver' : input.reason === 'force' ? 'force' : input.reason === 'auto_idle' ? 'auto_idle' : input.reason === 'auto_max' ? 'auto_max' : before.endedBy;

  const tripRef = tripsCol().doc(tripId);
  const vehicleRef = vehiclesCol().doc(before.vehicleId);
  const settled = await db().runTransaction(async (transaction) => {
    const [snapshot, vehicleSnap] = await Promise.all([transaction.get(tripRef), transaction.get(vehicleRef)]);
    const current = toTrip(snapshot.id, snapshot.data()!);
    if (current.status === 'cancelled') throw new FleetError('That trip was cancelled.', 409);
    if (input.reason === 'late-points' && OPEN_TRIP_STATUSES.includes(current.status)) return current;
    // Settled by a manager, or already counted by an approved payment report: left as it is.
    if (current.review?.status === 'resolved' || current.reportedIn) return current;
    if (input.reason !== 'late-points' && !OPEN_TRIP_STATUSES.includes(current.status)) {
      // Ended already: the same end again is the same answer; a different one is refused — except
      // the driver's own end of a trip the server closed by itself (checked again here, in the
      // transaction, so a manager settling it meanwhile still wins).
      if (input.clientEndId && current.clientEndId === input.clientEndId) return current;
      if (!(input.lateDriverEnd && awaitsDriverEnd(current, context.now))) throw new FleetError('That trip has already ended.', 409, { code: 'already_ended' });
    }
    const pauses = current.pauses.map((pause) => (pause.to ? pause : { ...pause, to: endedAt }));
    const next: FleetTrip = {
      ...current,
      status: figures.status,
      endedAt,
      endOdometer,
      endGeofenceId: endFence?.id ?? null,
      endGeofenceName: endFence?.name ?? '',
      endPlace: input.endPlace || current.endPlace || endFence?.name || '',
      endLat: endPoint?.lat ?? null,
      endLng: endPoint?.lng ?? null,
      gpsDistanceKm: measure.gpsKm,
      odoDistanceKm: odoKm,
      billableDistanceKm: figures.billableDistanceKm,
      billableSource: figures.billableSource,
      kmByDate: figures.kmByDate,
      gpsKmByDate: measure.kmByDate,
      pointCount: measure.pointCount,
      lastPointAt: measure.last?.recordedAtIso ?? current.lastPointAt,
      lastPointLat: measure.last?.lat ?? current.lastPointLat,
      lastPointLng: measure.last?.lng ?? current.lastPointLng,
      idleMinutes: measure.idleMinutes,
      movingMinutes: measure.movingMinutes,
      gapCount: measure.gapCount,
      visits,
      geofenceEvents: events.slice(0, 200),
      flagCodes: figures.flagCodes,
      flagged: figures.flagged,
      exceptionStatus: current.exceptionStatus === 'resolved' && figures.status === 'completed' ? 'resolved' : figures.exceptionStatus,
      siteInternal,
      approvedKmCap: allowedKm,
      costSnapshot: figures.costSnapshot,
      review: figures.status === 'pending_review' ? { status: 'pending', reason: figures.reviewReason ?? 'Needs a look.', choice: null, km: null, note: '', byId: null, byName: null, at: null } : null,
      pausedAt: null,
      pauses,
      endedBy,
      endRemark: input.remark ?? current.endRemark,
      clientEndId: input.clientEndId ?? current.clientEndId,
      updatedAt: context.now,
    };
    transaction.set(tripRef, replaceTrip(snapshot, next));
    const vehicleData = vehicleSnap.exists ? (vehicleSnap.data() as Record<string, unknown>) : {};
    const vehiclePatch: Record<string, unknown> = { updatedAt: context.now };
    if (str(vehicleData.currentTripId) === tripId) vehiclePatch.currentTripId = null;
    if (endOdometer && endOdometer.km > num(vehicleData.currentOdometerKm)) vehiclePatch.currentOdometerKm = endOdometer.km;
    if (vehicleSnap.exists) transaction.set(vehicleRef, vehiclePatch, { merge: true });
    if (input.endUploadId) transaction.set(uploadRef(input.endUploadId), attachment({ kind: 'trip', id: tripId }, current.managerIds), { merge: true });
    return next;
  });
  forgetVehicles();

  if (input.reason !== 'late-points' || settled.status !== before.status) {
    const messages: FleetMessage[] = [];
    if (settled.status === 'pending_review' && before.status !== 'pending_review') {
      messages.push({
        userIds: [...settled.managerIds, ...(settled.managerIds.length ? [] : settings.escalationUserIds)],
        title: `Review trip on ${settled.vehicleNumber}`,
        body: `${settled.driverName}: ${settled.review?.reason ?? 'needs a look'} (GPS ${formatKm(settled.gpsDistanceKm)}, odometer ${formatKm(settled.odoDistanceKm)}).`,
        link: tripLink(settled.id),
        channels: ['push', 'email'],
        severity: 'WARNING',
        itemId: settled.id,
        organizationId: settled.organizationId,
      });
    }
    if (input.reason === 'auto_idle' || input.reason === 'auto_max' || input.reason === 'force') {
      messages.push({
        userIds: [settled.driverUserId],
        title: `Your trip on ${settled.vehicleNumber} was closed`,
        body: input.reason === 'force' ? `Closed by ${input.actor?.name ?? 'a manager'}.` : input.reason === 'auto_max' ? 'It ran past the longest a trip may run.' : 'No location was received for a long time.',
        link: tripLink(settled.id),
        severity: 'WARNING',
        type: 'record_assigned',
        itemId: settled.id,
        organizationId: settled.organizationId,
      });
    }
    afterMessages(messages, input.reason === 'end' ? settled.driverUserId : undefined);
  }
  return settled;
}

export async function endTrip(context: FleetContext, tripId: string, body: unknown): Promise<{ trip: FleetTrip }> {
  const input = endTripSchema.parse(body);
  const trip = await loadTrip(tripId);
  if (trip.driverUserId !== context.userId) throw new FleetError('That trip is not yours.', 403);
  // A trip the server closed by itself while the phone had no signal is still the driver's to end:
  // their reading and photo settle it properly (`awaitsDriverEnd`), instead of a refusal that left
  // it to a manager with GPS alone.
  const lateDriverEnd = !OPEN_TRIP_STATUSES.includes(trip.status) && awaitsDriverEnd(trip, context.now);
  if (!OPEN_TRIP_STATUSES.includes(trip.status) && !lateDriverEnd) {
    if (trip.clientEndId === input.clientEndId) return { trip };
    throw new FleetError('That trip has already ended.', 409, { code: 'already_ended' });
  }
  checkEndOdometer(trip.startOdometer.km, input.endOdometer.km);
  if (!input.endOdometer.uploadId) throw new FleetError('Take a photo of the odometer.', 400, { fields: { endOdometer: 'Take a photo of the odometer.' } });
  const photo = await claimableUpload(input.endOdometer.uploadId, context.userId, 'odometer');
  // The phone's own end time when it ended offline — never before the start or in the future.
  const endedAt = input.endedAt && toMs(input.endedAt) >= toMs(trip.startedAt) && toMs(input.endedAt) <= toMs(context.now) + 5 * 60_000 ? new Date(toMs(input.endedAt)).toISOString() : context.now;
  const settled = await settle(context, tripId, {
    reason: 'end',
    endOdometer: { km: input.endOdometer.km, photoPath: photo.storagePath, ocrKm: photo.ocrKm, ocrRaw: photo.ocrText ? photo.ocrText.slice(0, 300) : null, at: endedAt },
    endedAt,
    position: input.position,
    remark: input.remark,
    endPlace: input.endPlace,
    clientEndId: input.clientEndId,
    endUploadId: photo.id,
    lateDriverEnd,
  });
  afterAudit(context, lateDriverEnd ? 'End Fleet Trip (after auto-close)' : 'End Fleet Trip', { before: { status: trip.status, endedBy: trip.endedBy }, after: { status: settled.status, gpsKm: settled.gpsDistanceKm, odoKm: settled.odoDistanceKm, billableKm: settled.billableDistanceKm, flags: settled.flagCodes } }, tripId, settled.vehicleNumber);
  return { trip: settled };
}

/* ── pause, resume, cancel ── */

export async function changeTrip(context: FleetContext, tripId: string, body: unknown): Promise<{ trip: FleetTrip }> {
  const input = pauseSchema.parse(body);
  const settings = await loadFleetSettings(context.organizationId);
  const tripRef = tripsCol().doc(tripId);
  const at = input.at && toMs(input.at) <= toMs(context.now) + 5 * 60_000 ? new Date(toMs(input.at)).toISOString() : context.now;
  const result = await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(tripRef);
    if (!snapshot.exists || !isFleetTrip(snapshot.data())) throw new FleetError('That trip was not found.', 404);
    const trip = toTrip(snapshot.id, snapshot.data()!);
    const can = abilitiesFor(context, settings, trip);
    let next: FleetTrip;
    if (input.action === 'pause') {
      if (!can.pause) throw new FleetError('Only a running trip of yours can be paused.', 409);
      next = { ...trip, status: 'paused', pausedAt: at, pauses: [...trip.pauses, { from: at, to: null }], updatedAt: context.now };
    } else if (input.action === 'resume') {
      if (!can.resume) throw new FleetError('Only a paused trip of yours can be resumed.', 409);
      next = { ...trip, status: 'running', pausedAt: null, pauses: trip.pauses.map((pause) => (pause.to ? pause : { ...pause, to: at })), updatedAt: context.now };
    } else {
      if (!can.cancel) throw new FleetError('A trip can be cancelled only in its first 15 minutes, before it has moved. End it instead.', 409);
      next = { ...trip, status: 'cancelled', endedAt: at, cancelReason: input.reason || 'Started by mistake', exceptionStatus: 'none', updatedAt: context.now };
      const vehicleRef = vehiclesCol().doc(trip.vehicleId);
      const vehicleSnap = await transaction.get(vehicleRef);
      const approvalRef = trip.approvalId ? approvalsCol().doc(trip.approvalId) : null;
      const approvalSnap = approvalRef ? await transaction.get(approvalRef) : null;
      if (vehicleSnap.exists && str(vehicleSnap.data()?.currentTripId) === tripId) transaction.set(vehicleRef, { currentTripId: null, updatedAt: context.now }, { merge: true });
      // The approval it started on is still good for another try today.
      if (approvalRef && approvalSnap?.exists && approvalSnap.data()?.status === 'used' && approvalSnap.data()?.tripId === tripId) transaction.set(approvalRef, { status: 'approved', tripId: null, updatedAt: context.now }, { merge: true });
    }
    transaction.set(tripRef, replaceTrip(snapshot, next));
    return next;
  });
  if (input.action === 'cancel') forgetVehicles();
  afterAudit(context, input.action === 'pause' ? 'Pause Fleet Trip' : input.action === 'resume' ? 'Resume Fleet Trip' : 'Cancel Fleet Trip', { reason: input.reason }, tripId, result.vehicleNumber);
  return { trip: result };
}

/* ── manager actions ── */

export async function reviewTrip(context: FleetContext, tripId: string, body: unknown): Promise<{ trip: FleetTrip }> {
  const input = reviewSchema.parse(body);
  const settings = await loadFleetSettings(context.organizationId);
  const trip = await loadTrip(tripId);
  if (!abilitiesFor(context, settings, trip).review) throw new FleetError(trip.driverUserId === context.userId ? 'You cannot review your own trip.' : 'This trip is not yours to review.', 403);
  const chosen = resolveReview(trip, { choice: input.choice, km: input.km });
  if (input.choice === 'manager' && !input.note) throw new FleetError('Say how the km were worked out.', 400, { fields: { note: 'Add a note.' } });
  const vehicle = await vehicleFor(settings, trip.vehicleId);
  const tripRef = tripsCol().doc(tripId);
  const next = await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(tripRef);
    const current = toTrip(snapshot.id, snapshot.data()!);
    if (current.status !== 'pending_review') throw new FleetError('This trip has already been reviewed.', 409);
    const settledTrip: FleetTrip = {
      ...current,
      status: 'completed',
      billableDistanceKm: chosen.km,
      billableSource: chosen.source,
      kmByDate: attributeKm(chosen.km, current.gpsKmByDate, current.dateKey),
      costSnapshot: tripCost(vehicle, chosen.km),
      review: { status: 'resolved', reason: current.review?.reason ?? '', choice: chosen.source, km: chosen.km, note: input.note, byId: context.userId, byName: context.userName, at: context.now },
      exceptionStatus: 'resolved',
      exceptionNote: input.note,
      updatedAt: context.now,
    };
    transaction.set(tripRef, replaceTrip(snapshot, settledTrip));
    return settledTrip;
  });
  afterMessages([{ userIds: [next.driverUserId], title: `Trip on ${next.vehicleNumber} reviewed`, body: `${formatKm(next.billableDistanceKm)} billed (${chosen.source === 'manager' ? 'set by the manager' : chosen.source}).`, link: tripLink(next.id), type: 'record_assigned', itemId: next.id, organizationId: next.organizationId }], context.userId);
  afterAudit(context, 'Review Fleet Trip', { before: { status: trip.status, gpsKm: trip.gpsDistanceKm, odoKm: trip.odoDistanceKm }, after: { billableKm: next.billableDistanceKm, source: next.billableSource, note: input.note } }, tripId, next.vehicleNumber);
  return { trip: next };
}

export async function forceCloseTrip(context: FleetContext, tripId: string, body: unknown): Promise<{ trip: FleetTrip }> {
  const input = forceCloseSchema.parse(body);
  const settings = await loadFleetSettings(context.organizationId);
  const trip = await loadTrip(tripId);
  if (!abilitiesFor(context, settings, trip).forceClose) throw new FleetError(trip.driverUserId === context.userId ? 'End your own trip from the trip screen.' : 'You cannot close this trip.', 403);
  const endOdometer = input.endOdometerKm === null ? null : { km: input.endOdometerKm, photoPath: null, ocrKm: null, ocrRaw: null, at: context.now };
  if (endOdometer) checkEndOdometer(trip.startOdometer.km, endOdometer.km);
  const settled = await settle(context, tripId, { reason: 'force', endOdometer, endedAt: trip.lastPointAt && toMs(trip.lastPointAt) > toMs(trip.startedAt) ? trip.lastPointAt : context.now, remark: `Closed by ${context.userName}: ${input.reason}`, autoClosed: !endOdometer, actor: { id: context.userId, name: context.userName } });
  afterAudit(context, 'Force Close Fleet Trip', { before: { status: trip.status }, after: { status: settled.status, endOdometer: endOdometer?.km ?? null, reason: input.reason } }, tripId, settled.vehicleNumber);
  return { trip: settled };
}

export async function resolveTripException(context: FleetContext, body: unknown): Promise<{ ok: true }> {
  const input = resolveExceptionSchema.parse(body);
  if (input.kind !== 'trip') throw new FleetError('Use the fuel route for fuel entries.');
  const settings = await loadFleetSettings(context.organizationId);
  const trip = await loadTrip(input.id);
  if (!abilitiesFor(context, settings, trip).resolve) throw new FleetError(trip.status === 'pending_review' ? 'Review the trip to settle it.' : 'This exception is not yours to resolve.', 403);
  await tripsCol().doc(trip.id).set({ exceptionStatus: 'resolved', exceptionNote: input.note, exceptionResolvedById: context.userId, exceptionResolvedByName: context.userName, exceptionResolvedAt: context.now, updatedAt: context.now }, { merge: true });
  afterAudit(context, 'Resolve Fleet Exception', { kind: 'trip', flags: trip.flagCodes, note: input.note }, trip.id, trip.vehicleNumber);
  return { ok: true };
}

/* ── lists and detail ── */

/** The caller's fleet trips, newest first (and their pre-fleet GPS trips, read-only). */
export async function listMyTrips(context: FleetContext): Promise<FleetTrip[]> {
  const snapshot = await tripsCol().where('driverUserId', '==', context.userId).get();
  return snapshot.docs
    .filter((doc) => isFleetTrip(doc.data()))
    .map((doc) => toTrip(doc.id, doc.data()))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 200);
}

export interface TripFilters {
  from: string;
  to: string;
  status?: string | null;
  vehicleId?: string | null;
  scope?: 'all' | 'managed';
  /** Also the trips recorded before SEL Fleet (Fleet Trips · View or the escalation list only). */
  includeLegacy?: boolean;
}

/** Trips the caller may see across drivers: everything with Fleet Trips · View, else those they manage. */
export async function listTrips(context: FleetContext, filters: TripFilters): Promise<FleetTrip[]> {
  const settings = await loadFleetSettings(context.organizationId);
  const escalation = settings.escalationUserIds.includes(context.userId);
  const all = context.fleet.viewAll || escalation;
  const everything = all && filters.scope !== 'managed';
  const [snapshot, older] = await Promise.all([
    everything ? tripsCol().where('dateKey', '>=', filters.from).get() : tripsCol().where('managerIds', 'array-contains', context.userId).get(),
    // Pre-fleet trips have no `dateKey`; their start time is the same single-field range.
    everything && filters.includeLegacy ? tripsCol().where('startTimeIso', '>=', istDayStartIso(filters.from)).get() : Promise.resolve(null),
  ]);
  const fleet = snapshot.docs.filter((doc) => isFleetTrip(doc.data())).map((doc) => toTrip(doc.id, doc.data()));
  const legacy = (older?.docs ?? []).filter((doc) => !isFleetTrip(doc.data())).map((doc) => legacyToTrip(doc.id, doc.data()));
  return [...fleet, ...legacy]
    .filter((trip) => trip.dateKey >= filters.from && trip.dateKey <= filters.to)
    .filter((trip) => !filters.status || trip.status === filters.status)
    .filter((trip) => !filters.vehicleId || trip.vehicleId === filters.vehicleId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 2000)
    // The arrivals list belongs to the detail; a year of trips carries none of it.
    .map((trip) => (trip.geofenceEvents.length ? { ...trip, geofenceEvents: [] } : trip));
}

export interface TripDetail {
  trip: FleetTrip;
  abilities: FleetTripAbilities;
  points: Array<{ lat: number; lng: number; at: string; speedKmph: number | null; accuracyM: number | null }>;
  deviceEvents: Array<{ type: string; geofenceName: string; at: string }>;
  photos: { start: string | null; end: string | null };
}

export async function tripDetail(context: FleetContext, tripId: string): Promise<TripDetail> {
  const settings = await loadFleetSettings(context.organizationId);
  const snapshot = await tripsCol().doc(tripId).get();
  if (!snapshot.exists) throw new FleetError('That trip was not found.', 404);
  if (!isFleetTrip(snapshot.data())) {
    // A pre-fleet trip: history for the fleet's viewers, with its route and nothing to act on.
    if (!(context.fleet.viewAll || settings.escalationUserIds.includes(context.userId))) throw new FleetError('That trip was not found.', 404);
    const points = await trackOf(tripId);
    return {
      trip: legacyToTrip(snapshot.id, snapshot.data()!),
      abilities: NO_ABILITIES,
      points: points.slice(0, 5000).map((point) => ({ lat: point.lat, lng: point.lng, at: point.recordedAtIso ?? '', speedKmph: point.speedKmph ?? null, accuracyM: point.accuracyMeters ?? null })),
      deviceEvents: [],
      photos: { start: null, end: null },
    };
  }
  const trip = toTrip(snapshot.id, snapshot.data()!);
  const mine = trip.driverUserId === context.userId;
  if (!mine && !managesTrip(context, settings, trip) && !context.fleet.viewAll && !context.fleet.reportsView) throw new FleetError('You cannot view this trip.', 403);
  const [points, events, uploads] = await Promise.all([
    trackOf(tripId),
    eventsCol().where('tripId', '==', tripId).get(),
    db().collection(FLEET_COLLECTIONS.uploads).where('attachedId', '==', tripId).get(),
  ]);
  const photoId = (path: string | null) => (path ? uploads.docs.find((doc) => doc.data().storagePath === path)?.id ?? null : null);
  return {
    trip,
    abilities: abilitiesFor(context, settings, trip),
    points: points.slice(0, 5000).map((point) => ({ lat: point.lat, lng: point.lng, at: point.recordedAtIso ?? '', speedKmph: point.speedKmph ?? null, accuracyM: point.accuracyMeters ?? null })),
    deviceEvents: events.docs.map((doc) => doc.data()).map((event) => ({ type: str(event.type), geofenceName: str(event.geofenceName), at: str(event.at) })).sort((a, b) => a.at.localeCompare(b.at)),
    photos: { start: photoId(trip.startOdometer.photoPath), end: photoId(trip.endOdometer?.photoPath ?? null) },
  };
}

/** Open trips across the fleet, for the live map. */
export async function runningTrips(): Promise<FleetTrip[]> {
  const snapshot = await tripsCol().where('status', 'in', OPEN_TRIP_STATUSES).get();
  return snapshot.docs.filter((doc) => isFleetTrip(doc.data())).map((doc) => toTrip(doc.id, doc.data()));
}
