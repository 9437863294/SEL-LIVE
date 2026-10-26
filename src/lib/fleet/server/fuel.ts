import 'server-only';

/**
 * Fuel entries through the API (Phase 2): the bill and the odometer photographed, mileage and flags
 * worked out here from every fuel log and fleet trip of the vehicle. Entries land in Vehicle
 * Management's fuel register (`vehicleManagementFuelLogs`) with its own field names, so its Fuel
 * screen, reports and the Site Account reconciliation read them unchanged.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { reportingAuthorityOf } from '@/lib/employee-trips/server/lookups';
import { addDays } from '../dates.ts';
import { geofenceAt } from '../geo.ts';
import { checkFuel, fuelRowFrom } from '../fuel.ts';
import { fuelEntrySchema, resolveExceptionSchema } from '../schemas.ts';
import { FLEET_COLLECTIONS, FUEL_FLAG_LABELS, round2, stripUndefined, type FuelFlagCode, type FuelRow } from '../types.ts';
import { db, FleetError, type FleetContext } from './context';
import { afterAudit, afterMessages } from './notify';
import { activeGeofences, driverOf, fleetVehicles, forgetVehicles, loadFleetSettings } from './lookups';
import { isFleetTrip, toTrip, tripsCol } from './trips';
import { attachment, claimableUpload, uploadRef } from './uploads';

const fuelCol = () => db().collection(FLEET_COLLECTIONS.fuel);

export interface FuelEntryView extends FuelRow {
  vehicleNumber: string;
  stationName: string;
  billNumber: string;
  mileageKmpl: number | null;
  expectedLitres: number | null;
  distanceSincePreviousKm: number | null;
  flagCodes: FuelFlagCode[];
  exceptionStatus: 'none' | 'open' | 'resolved';
  billUploadId: string | null;
  odometerUploadId: string | null;
  fleet: boolean;
  status: string;
}

export function toFuelView(id: string, data: Record<string, unknown>): FuelEntryView {
  const row = fuelRowFrom(id, data);
  const mileage = Number(data.mileageKmPerLiter);
  return {
    ...row,
    vehicleNumber: String(data.vehicleNumber ?? ''),
    stationName: String(data.fuelStationName ?? ''),
    billNumber: String(data.billNumber ?? ''),
    mileageKmpl: Number.isFinite(mileage) && mileage > 0 ? mileage : null,
    expectedLitres: typeof data.expectedLitres === 'number' ? data.expectedLitres : null,
    distanceSincePreviousKm: Number(data.distanceSinceLastFuelKm) > 0 ? Number(data.distanceSinceLastFuelKm) : null,
    flagCodes: Array.isArray(data.flagCodes) ? (data.flagCodes as FuelFlagCode[]) : [],
    exceptionStatus: (['open', 'resolved'].includes(String(data.exceptionStatus)) ? data.exceptionStatus : 'none') as FuelEntryView['exceptionStatus'],
    billUploadId: typeof data.billUploadId === 'string' ? data.billUploadId : null,
    odometerUploadId: typeof data.odometerUploadId === 'string' ? data.odometerUploadId : null,
    fleet: data.fleet === true,
    status: String(data.fuelStatus ?? ''),
  };
}

export async function createFuelEntry(context: FleetContext, body: unknown): Promise<{ entry: FuelEntryView; reused: boolean }> {
  const input = fuelEntrySchema.parse(body);
  const settings = await loadFleetSettings(context.organizationId);
  const [vehicles, driver, fences] = await Promise.all([fleetVehicles(settings), driverOf(context.userId), activeGeofences()]);
  if (!driver && !settings.anyEmployeeMayDrive) throw new FleetError('Only drivers in Driver Master enter fuel for company vehicles.', 403);
  const vehicle = vehicles.find((entry) => entry.id === input.vehicleId);
  if (!vehicle || !vehicle.active) throw new FleetError('Choose a company vehicle from Vehicle Master.', 400, { fields: { vehicleId: 'Choose a company vehicle.' } });

  const repeat = await fuelCol().where('clientEntryId', '==', input.clientEntryId).limit(1).get();
  if (!repeat.empty) return { entry: toFuelView(repeat.docs[0].id, repeat.docs[0].data()), reused: true };

  if (input.fuelDate > context.today) throw new FleetError('A fill-up cannot be dated in the future.', 400, { fields: { fuelDate: 'Not in the future.' } });
  if (input.fuelDate < addDays(context.today, -7)) throw new FleetError('Fill-ups older than a week are entered by the fleet office.', 400, { fields: { fuelDate: 'Within the last 7 days.' } });

  const [bill, odometerPhoto] = await Promise.all([claimableUpload(input.billUploadId, context.userId, 'fuel_bill'), claimableUpload(input.odometerUploadId, context.userId, 'odometer')]);

  const [logs, trips] = await Promise.all([fuelCol().where('vehicleId', '==', vehicle.id).get(), tripsCol().where('vehicleId', '==', vehicle.id).get()]);
  const rows = logs.docs.map((doc) => fuelRowFrom(doc.id, doc.data()));
  const ref = fuelCol().doc();
  const litres = round2(input.litres);
  const amount = round2(input.amount);
  const ratePerL = round2(amount / litres);
  const current: FuelRow = {
    id: ref.id,
    vehicleId: vehicle.id,
    fuelDate: input.fuelDate,
    odometerKm: input.odometerKm,
    litres,
    amount,
    ratePerL,
    fullTank: input.fullTank,
    paidBy: input.paidBy,
    driverUserId: context.userId,
    driverName: driver?.name || context.userName,
    createdAt: context.now,
  };
  // Trips that ended between the previous fill's reading and this one.
  const previous = rows.filter((row) => row.odometerKm !== null && row.odometerKm < input.odometerKm).sort((a, b) => (a.odometerKm as number) - (b.odometerKm as number)).at(-1);
  const between = trips.docs
    .filter((doc) => isFleetTrip(doc.data()))
    .map((doc) => toTrip(doc.id, doc.data()))
    .filter((trip) => trip.status !== 'cancelled' && trip.endOdometer && previous?.odometerKm != null && trip.endOdometer.km > previous.odometerKm && trip.startOdometer.km < input.odometerKm);
  const check = checkFuel({
    current,
    rows: [...rows, current],
    vehicle,
    settings,
    tripsSincePrevious: between.length,
    tripKmSincePrevious: between.reduce((sum, trip) => sum + (trip.billableDistanceKm ?? trip.odoDistanceKm ?? 0), 0),
  });
  const station = input.position ? geofenceAt(input.position, fences.filter((fence) => fence.kind === 'fuel_station')) : null;
  const managerIds = [...new Set([vehicle.approverUid, vehicle.backupApproverUid, ...(vehicle.approverUid ? [] : (await reportingAuthorityOf(context.userId)).ids)].filter((id): id is string => Boolean(id) && id !== context.userId))];
  const flagged = check.flags.length > 0;

  const document = stripUndefined({
    // Vehicle Management's fuel register fields.
    vehicleId: vehicle.id,
    vehicleNumber: vehicle.vehicleNumber,
    vehicleType: vehicle.vehicleType,
    fuelDate: input.fuelDate,
    fuelType: vehicle.fuelType || 'Other',
    fillType: input.fullTank ? 'Full Tank' : 'Partial Fill',
    quantityLiters: litres,
    ratePerUnit: ratePerL,
    totalAmount: amount,
    odometerReadingKm: input.odometerKm,
    previousOdometerReadingKm: check.previousOdometerKm ?? '',
    distanceSinceLastFuelKm: check.distanceSincePreviousKm ?? 0,
    mileageKmPerLiter: check.mileage?.kmpl ?? '',
    costPerKm: check.mileage ? round2(amount / check.mileage.km) : '',
    fuelStationName: input.stationName,
    billNumber: input.billNumber,
    paymentMode: input.paymentMode || (input.paidBy === 'company' ? 'Company Account' : 'Cash'),
    remarks: input.remarks,
    driverId: driver?.id ?? '',
    driverName: current.driverName,
    enteredByUserId: context.userId,
    enteredByName: context.userName,
    fuelStatus: 'Submitted',
    sourceApp: 'SEL Fleet',
    vehicleOwnershipType: 'Company Vehicle',
    // Fleet fields.
    fleet: true,
    organizationId: context.organizationId,
    clientEntryId: input.clientEntryId,
    fullTank: input.fullTank,
    paidBy: input.paidBy,
    driverUserId: context.userId,
    billUploadId: bill.id,
    odometerUploadId: odometerPhoto.id,
    billPhotoPath: bill.storagePath,
    odometerPhotoPath: odometerPhoto.storagePath,
    ocrKm: odometerPhoto.ocrKm,
    tripId: input.tripId,
    stationGeofenceId: station?.id ?? null,
    mileageWindow: check.mileage ? { fromFillId: check.mileage.fromFillId, km: check.mileage.km, litres: check.mileage.litres } : null,
    expectedLitres: check.expectedLitres,
    flagCodes: check.flags,
    flagged,
    exceptionStatus: flagged ? 'open' : 'none',
    managerIds,
    createdAt: FieldValue.serverTimestamp(),
    createdAtIso: context.now,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const vehicleRef = db().collection(FLEET_COLLECTIONS.vehicles).doc(vehicle.id);
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vehicleRef);
    const reading = Number(snapshot.data()?.currentOdometerKm);
    transaction.set(ref, document);
    if (!(Number.isFinite(reading) && reading >= input.odometerKm)) transaction.set(vehicleRef, { currentOdometerKm: input.odometerKm, updatedAt: context.now }, { merge: true });
    transaction.set(uploadRef(bill.id), attachment({ kind: 'fuel', id: ref.id }, managerIds), { merge: true });
    transaction.set(uploadRef(odometerPhoto.id), attachment({ kind: 'fuel', id: ref.id }, managerIds), { merge: true });
  });
  forgetVehicles();

  if (flagged) {
    afterMessages(
      [
        {
          userIds: [...managerIds, ...settings.digestUserIds],
          title: `Fuel on ${vehicle.vehicleNumber}: ${check.flags.map((flag) => FUEL_FLAG_LABELS[flag]).join(', ')}`,
          body: `${current.driverName} filled ${litres} L for ₹${amount}${check.mileage ? ` — ${check.mileage.kmpl} km/L against ${vehicle.stdMileageKmpl ?? '—'} standard` : ''}.`,
          link: '/vehicle-management/fleet/exceptions',
          severity: 'WARNING',
          type: 'record_assigned',
          itemId: ref.id,
          organizationId: context.organizationId,
        },
      ],
      context.userId,
    );
  }
  afterAudit(context, 'Fleet Fuel Entry', { after: { vehicle: vehicle.vehicleNumber, litres, amount, odometer: input.odometerKm, fullTank: input.fullTank, paidBy: input.paidBy, mileage: check.mileage?.kmpl ?? null, flags: check.flags } }, ref.id, vehicle.vehicleNumber);
  return { entry: toFuelView(ref.id, { ...document, createdAt: context.now }), reused: false };
}

export async function listMyFuel(context: FleetContext): Promise<FuelEntryView[]> {
  const snapshot = await fuelCol().where('enteredByUserId', '==', context.userId).get();
  return snapshot.docs.map((doc) => toFuelView(doc.id, doc.data())).sort((a, b) => b.fuelDate.localeCompare(a.fuelDate) || b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
}

export async function openFuelExceptions(context: FleetContext, managedOnly: boolean): Promise<FuelEntryView[]> {
  const snapshot = await fuelCol().where('exceptionStatus', '==', 'open').get();
  return snapshot.docs
    .filter((doc) => !managedOnly || (Array.isArray(doc.data().managerIds) && doc.data().managerIds.includes(context.userId)))
    .map((doc) => toFuelView(doc.id, doc.data()))
    .sort((a, b) => b.fuelDate.localeCompare(a.fuelDate));
}

export async function resolveFuelException(context: FleetContext, body: unknown): Promise<{ ok: true }> {
  const input = resolveExceptionSchema.parse(body);
  if (input.kind !== 'fuel') throw new FleetError('Use the trip route for trips.');
  const settings = await loadFleetSettings(context.organizationId);
  const ref = fuelCol().doc(input.id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new FleetError('That fuel entry was not found.', 404);
  const data = snapshot.data() as Record<string, unknown>;
  const managers = Array.isArray(data.managerIds) ? data.managerIds.map(String) : [];
  if (data.enteredByUserId === context.userId) throw new FleetError('You cannot resolve your own fuel entry.', 403);
  if (!(managers.includes(context.userId) || context.fleet.review || settings.escalationUserIds.includes(context.userId))) throw new FleetError('This fuel entry is not yours to resolve.', 403);
  if (data.exceptionStatus !== 'open') throw new FleetError('Nothing is open on this fuel entry.', 409);
  await ref.set({ exceptionStatus: 'resolved', exceptionNote: input.note, exceptionResolvedById: context.userId, exceptionResolvedByName: context.userName, exceptionResolvedAt: context.now, fuelStatus: 'Verified', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  afterAudit(context, 'Resolve Fleet Exception', { kind: 'fuel', flags: data.flagCodes ?? [], note: input.note }, input.id, String(data.vehicleNumber ?? ''));
  return { ok: true };
}
