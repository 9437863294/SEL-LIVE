import 'server-only';

/**
 * Recording, editing and deleting your own trips. Only drafts change: a trip on a claim belongs to
 * the workflow until the claim sends it back. The server prices every save from the rate card and
 * recomputes the flags; the figures the form showed are a preview, never the record.
 */

import { priceTrip, rateFor } from '../rates.ts';
import { tripInputSchema } from '../schemas.ts';
import { claimRules, tripFlags, validateTrip } from '../trips.ts';
import { ET_COLLECTIONS, type TripClaimSettings, type TripRecord } from '../types.ts';
import { TripError, db, nowIso, type TripContext } from './context';
import { companyVehicles, departmentOptions, loadSettings, odometerDocId, projectOptions } from './lookups';
import { afterAudit } from './notify';
import { loadFleetSettings } from '@/lib/fleet/server/lookups';
import { projectAllowed } from '@/lib/employee-projects/links';
import { employeeTripProjectIdsOf } from '@/lib/employee-projects/server';

const tripsCollection = () => db().collection(ET_COLLECTIONS.trips);

export function toTrip(id: string, data: FirebaseFirestore.DocumentData): TripRecord {
  return {
    id,
    organizationId: String(data.organizationId ?? 'default'),
    employeeId: String(data.employeeId ?? ''),
    employeeName: String(data.employeeName ?? ''),
    tripDate: String(data.tripDate ?? ''),
    ownership: data.ownership === 'company' ? 'company' : 'own',
    vehicleType: String(data.vehicleType ?? ''),
    vehicleNumber: String(data.vehicleNumber ?? ''),
    vehicleId: data.vehicleId ?? null,
    fromPlace: String(data.fromPlace ?? ''),
    toPlace: String(data.toPlace ?? ''),
    purpose: String(data.purpose ?? ''),
    startOdometer: typeof data.startOdometer === 'number' ? data.startOdometer : null,
    endOdometer: typeof data.endOdometer === 'number' ? data.endOdometer : null,
    distanceKm: Number(data.distanceKm ?? 0),
    projectId: data.projectId ?? null,
    projectName: data.projectName ?? null,
    departmentId: data.departmentId ?? null,
    departmentName: data.departmentName ?? null,
    tollAmount: Number(data.tollAmount ?? 0),
    parkingAmount: Number(data.parkingAmount ?? 0),
    ratePerKm: typeof data.ratePerKm === 'number' ? data.ratePerKm : null,
    rateRevisionId: data.rateRevisionId ?? null,
    distanceAmount: Number(data.distanceAmount ?? 0),
    totalAmount: Number(data.totalAmount ?? 0),
    flags: Array.isArray(data.flags) ? data.flags : [],
    notes: String(data.notes ?? ''),
    status: data.status ?? 'draft',
    claimId: data.claimId ?? null,
    claimNumber: data.claimNumber ?? null,
    decision: data.decision ?? null,
    returnNote: data.returnNote ?? null,
    previousClaims: Array.isArray(data.previousClaims) ? data.previousClaims : [],
    // Every trip written before GPS recording existed is a typed one, which is the truth about it.
    source: data.source === 'gps' ? 'gps' : 'manual',
    gps: data.gps ?? null,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
  };
}

const byNewest = (a: TripRecord, b: TripRecord) => b.tripDate.localeCompare(a.tripDate) || b.createdAt.localeCompare(a.createdAt);

export async function employeeTrips(organizationId: string, employeeId: string): Promise<TripRecord[]> {
  const snapshot = await tripsCollection().where('employeeId', '==', employeeId).get();
  return snapshot.docs
    .map((doc) => toTrip(doc.id, doc.data()))
    .filter((trip) => trip.organizationId === organizationId)
    .sort(byNewest);
}

/** Every logged trip on these vehicle numbers, anyone's — for the odometer-overlap flag. */
export async function vehicleTrips(organizationId: string, vehicleNumbers: string[]): Promise<TripRecord[]> {
  const numbers = [...new Set(vehicleNumbers.filter(Boolean))];
  const results: TripRecord[] = [];
  for (let at = 0; at < numbers.length; at += 30) {
    const snapshot = await tripsCollection().where('vehicleNumber', 'in', numbers.slice(at, at + 30)).get();
    results.push(...snapshot.docs.map((doc) => toTrip(doc.id, doc.data())).filter((trip) => trip.organizationId === organizationId));
  }
  return results;
}

export const listMyTrips = (context: TripContext) => employeeTrips(context.organizationId, context.userId);

/**
 * Every employee's trips, for the organisation-wide register.
 *
 * Separate from `listMyTrips` rather than a flag on it, so the permission check cannot be
 * skipped by a caller that forgets to pass one: asking for everybody's trips is a different
 * request from asking for your own, and it reads as one here.
 *
 * Gated on the same `View All` that opens the claims register. Seeing what colleagues claimed
 * for — where they drove, when, and how far — is the same disclosure whether it is read off a
 * claim or off the trips behind it, so it cannot be the weaker permission.
 */
export async function listAllTrips(context: TripContext): Promise<TripRecord[]> {
  if (!context.trip.viewAll) {
    throw new TripError('Seeing every employee’s trips needs Driver Management · Trip Claims · View All.', 403);
  }
  const snapshot = await tripsCollection().get();
  return snapshot.docs
    .map((doc) => toTrip(doc.id, doc.data()))
    .filter((trip) => trip.organizationId === context.organizationId)
    .sort(byNewest);
}

/** Rate, amounts and flags for a trip as it stands, from the current rate card. */
export function priceAndFlag(
  trip: Pick<TripRecord, 'id' | 'tripDate' | 'vehicleType' | 'ownership' | 'distanceKm' | 'tollAmount' | 'parkingAmount' | 'fromPlace' | 'toPlace' | 'startOdometer' | 'endOdometer' | 'vehicleNumber' | 'status'>,
  settings: TripClaimSettings,
  others: { sameEmployee: TripRecord[]; sameVehicle: TripRecord[] },
) {
  const rate = rateFor(settings.rateRevisions, trip.tripDate, trip.vehicleType, trip.ownership);
  const pricing = priceTrip({ distanceKm: trip.distanceKm, ratePerKm: rate.ratePerKm, tollAmount: trip.tollAmount, parkingAmount: trip.parkingAmount, allowTollParking: settings.rules.allowTollParking });
  const flags = tripFlags({ ...trip, ratePerKm: rate.ratePerKm }, { rules: settings.rules, ...others });
  return { ratePerKm: rate.ratePerKm, rateRevisionId: rate.revisionId, distanceAmount: pricing.distanceAmount, totalAmount: pricing.totalAmount, flags };
}

export async function saveTrip(context: TripContext, body: unknown, tripId?: string): Promise<{ trip: TripRecord }> {
  const input = tripInputSchema.parse(body);
  const [settings, fleet, vehicles, projects, departments, mine] = await Promise.all([
    loadSettings(context.organizationId),
    loadFleetSettings(context.organizationId),
    companyVehicles(),
    projectOptions(),
    departmentOptions(),
    listMyTrips(context),
  ]);

  const existing = tripId ? mine.find((trip) => trip.id === tripId) : undefined;
  if (tripId && !existing) throw new TripError('That trip was not found among yours.', 404);
  // A new trip sent again under the same client id (an offline save retried, a reply that never
  // arrived): the one already saved is the answer, untouched.
  const replay = !tripId && input.clientTripId ? mine.find((trip) => trip.id === input.clientTripId) : undefined;
  if (replay) return { trip: replay };
  if (existing && existing.status !== 'draft') throw new TripError('This trip is on a claim and can no longer be changed.', 409);
  // Trips are recorded by GPS on Fleet Trip (own vehicle) unless Trip rules allow typing one in.
  // Editing a trip already recorded is always allowed.
  if (!existing && !input.gps && !settings.rules.allowTypedTrips) {
    throw new TripError('Trips are recorded by GPS: open Fleet Trip, choose Own vehicle and Drive & record.', 400, { code: 'gps_required' });
  }

  const companyVehicle = input.ownership === 'company' && input.vehicleId ? vehicles.find((vehicle) => vehicle.id === input.vehicleId) ?? null : null;
  // Company-vehicle running is a fleet trip once Settings › Fleet says so (decision D1); a company
  // draft recorded before that stays editable, claimable and deletable.
  const result = validateTrip(input, {
    rules: claimRules(settings.rules, fleet.companyTripsInFleet),
    today: context.today,
    companyVehicle,
    existingOwnership: existing?.ownership ?? null,
    companyTripsInFleet: fleet.companyTripsInFleet,
  });
  if (!result.ok) throw new TripError('Check the highlighted fields.', 400, { fields: result.errors });
  const value = result.value;

  // A trip saved before projects became divisions keeps the project it has, by its stored name.
  const kept = existing?.projectId && value.projectId === existing.projectId ? { id: existing.projectId, name: existing.projectName ?? '' } : null;
  const project = value.projectId ? projects.find((entry) => entry.id === value.projectId) ?? kept : null;
  const department = value.departmentId ? departments.find((entry) => entry.id === value.departmentId) : null;
  if (value.projectId && !project) throw new TripError('That project no longer exists.', 400, { fields: { projectId: 'Choose another project.' } });
  // Settings › Fleet may limit a trip to the employee's own projects; an existing trip keeps its own.
  if (fleet.employeeProjectsOnly && value.projectId && value.projectId !== existing?.projectId && !projectAllowed(value.projectId, await employeeTripProjectIdsOf(context.userId), true)) {
    throw new TripError('Choose one of your projects — trips are limited to the employee’s own projects.', 400, { fields: { projectId: 'Choose one of your projects.' } });
  }
  if (value.departmentId && !department) throw new TripError('That department no longer exists.', 400, { fields: { departmentId: 'Choose another department.' } });

  const id = existing?.id ?? input.clientTripId ?? tripsCollection().doc().id;
  const draft = { ...value, id, status: 'draft' as const };
  const sameVehicle = await vehicleTrips(context.organizationId, [value.vehicleNumber]);
  const priced = priceAndFlag(draft, settings, { sameEmployee: mine, sameVehicle });
  const now = nowIso();

  const record: TripRecord = {
    ...draft,
    organizationId: context.organizationId,
    employeeId: context.userId,
    employeeName: context.userName,
    projectName: project?.name ?? null,
    departmentName: department?.name ?? null,
    ...priced,
    claimId: null,
    claimNumber: null,
    decision: null,
    returnNote: existing?.returnNote ?? null,
    previousClaims: existing?.previousClaims ?? [],
    // Recorded once, by whoever created the trip. An edit that does not resend the evidence
    // keeps it, so correcting a typo in the purpose cannot quietly downgrade a measured trip
    // to a typed one.
    source: input.gps ? 'gps' : existing?.source ?? 'manual',
    gps: input.gps ?? existing?.gps ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const ref = tripsCollection().doc(id);
  const odometerRef = db().collection(ET_COLLECTIONS.counters).doc(odometerDocId(context.organizationId));
  await db().runTransaction(async (transaction) => {
    const [current, odometer] = await Promise.all([transaction.get(ref), value.vehicleId && value.endOdometer !== null ? transaction.get(odometerRef) : Promise.resolve(null)]);
    // Submitted between the read above and now: the claim owns it.
    if (current.exists && current.data()?.status !== 'draft') throw new TripError('This trip was just submitted on a claim and can no longer be changed.', 409);
    if (current.exists && current.data()?.employeeId !== context.userId) throw new TripError('That trip is not yours.', 403);
    transaction.set(ref, record);
    if (odometer && value.vehicleId && value.endOdometer !== null) {
      const last = (odometer.data()?.readings ?? {})[value.vehicleId] as { km?: number } | undefined;
      if (!last?.km || value.endOdometer > last.km) {
        transaction.set(odometerRef, { readings: { [value.vehicleId]: { km: value.endOdometer, date: value.tripDate } } }, { merge: true });
      }
    }
  });

  afterAudit(context, existing ? 'Edit Trip' : 'Record Trip', { tripDate: record.tripDate, vehicle: record.vehicleNumber, distanceKm: record.distanceKm, amount: record.totalAmount }, id);
  return { trip: record };
}

export async function deleteTrip(context: TripContext, tripId: string): Promise<{ ok: true }> {
  const ref = tripsCollection().doc(tripId);
  let deleted: TripRecord | null = null;
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new TripError('That trip was not found.', 404);
    const trip = toTrip(snapshot.id, snapshot.data()!);
    if (trip.employeeId !== context.userId || trip.organizationId !== context.organizationId) throw new TripError('That trip is not yours.', 403);
    if (trip.status !== 'draft') throw new TripError('Only unclaimed trips can be deleted.', 409);
    transaction.delete(ref);
    deleted = trip;
  });
  const trip = deleted as TripRecord | null;
  if (trip) afterAudit(context, 'Delete Trip', { tripDate: trip.tripDate, vehicle: trip.vehicleNumber, distanceKm: trip.distanceKm, amount: trip.totalAmount }, tripId);
  return { ok: true };
}
