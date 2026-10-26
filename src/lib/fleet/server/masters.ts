import 'server-only';

/**
 * Fleet masters and settings: geofences, purposes, the fleet fields on Vehicle Master records,
 * odometer baselines, which geofences are a project's sites, and Settings › Fleet. All need
 * Fleet Settings · Edit (or Vehicle Management · Settings · Edit). Soft delete only.
 */

import { normaliseFleetSettings, normaliseVehicle } from '../settings.ts';
import { baselineSchema, fleetSettingsSchema, geofenceSchema, projectGeofencesSchema, purposeSchema, vehicleFleetSchema } from '../schemas.ts';
import { FLEET_COLLECTIONS, SEED_PURPOSES, VEHICLE_FLEET_FIELDS, stripUndefined, type FleetSettings, type Geofence, type GeofenceKind, type OdometerBaseline, type Purpose } from '../types.ts';
import { db, FleetError, type FleetContext } from './context';
import { afterAudit } from './notify';
import { allGeofences, allPurposes, fleetProjects, fleetVehicles, forgetFleetSettings, forgetGeofences, forgetProjects, forgetPurposes, forgetVehicles, loadFleetSettings, seedPurposeId } from './lookups';
import { attachment, claimableUpload, uploadRef } from './uploads';
import { userDirectory } from '@/lib/employee-trips/server/lookups';

function requireEdit(context: FleetContext) {
  if (!context.fleet.settingsEdit) throw new FleetError('You need Fleet Settings · Edit to change this.', 403);
}

/* ── geofences ── */

export async function saveGeofence(context: FleetContext, body: unknown, geofenceId?: string): Promise<{ geofence: Geofence }> {
  requireEdit(context);
  const input = geofenceSchema.parse(body);
  if (input.projectId && !(await fleetProjects()).some((project) => project.id === input.projectId)) throw new FleetError('That project no longer exists.', 400, { fields: { projectId: 'Choose another project.' } });
  const collection = db().collection(FLEET_COLLECTIONS.geofences);
  const ref = geofenceId ? collection.doc(geofenceId) : collection.doc();
  const existing = geofenceId ? await ref.get() : null;
  if (geofenceId && (!existing?.exists || existing.data()?.deletedAt)) throw new FleetError('That geofence was not found.', 404);
  const before = existing?.data() as Geofence | undefined;
  const geofence: Geofence = {
    id: ref.id,
    organizationId: context.organizationId,
    name: input.name,
    kind: input.kind as GeofenceKind,
    lat: input.lat,
    lng: input.lng,
    radiusM: input.radiusM,
    projectId: input.kind === 'project_site' ? input.projectId : null,
    address: input.address,
    active: input.active,
    createdAt: before?.createdAt ?? context.now,
    createdById: before?.createdById ?? context.userId,
    updatedAt: context.now,
    updatedById: context.userId,
    deletedAt: null,
  };
  await ref.set(stripUndefined(geofence));
  // A project site is listed on its project too, for the project's own screens.
  if (geofence.projectId) await linkProjectGeofence(geofence.projectId, geofence.id, true);
  if (before?.projectId && before.projectId !== geofence.projectId) await linkProjectGeofence(before.projectId, geofence.id, false);
  forgetGeofences();
  afterAudit(context, geofenceId ? 'Edit Geofence' : 'Add Geofence', { before: before ?? null, after: geofence }, geofence.id, geofence.name);
  return { geofence };
}

export async function deleteGeofence(context: FleetContext, geofenceId: string): Promise<{ ok: true }> {
  requireEdit(context);
  const ref = db().collection(FLEET_COLLECTIONS.geofences).doc(geofenceId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new FleetError('That geofence was not found.', 404);
  const fence = snapshot.data() as Geofence;
  await ref.set({ deletedAt: context.now, active: false, updatedAt: context.now, updatedById: context.userId }, { merge: true });
  if (fence.projectId) await linkProjectGeofence(fence.projectId, geofenceId, false);
  forgetGeofences();
  afterAudit(context, 'Delete Geofence', { before: fence }, geofenceId, fence.name);
  return { ok: true };
}

async function linkProjectGeofence(projectId: string, geofenceId: string, linked: boolean) {
  const ref = db().collection('projects').doc(projectId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return;
  const current: string[] = Array.isArray(snapshot.data()?.siteGeofenceIds) ? snapshot.data()!.siteGeofenceIds.map(String) : [];
  const next = linked ? [...new Set([...current, geofenceId])] : current.filter((id) => id !== geofenceId);
  if (next.length !== current.length) await ref.set({ siteGeofenceIds: next }, { merge: true });
  forgetProjects();
}

export async function setProjectGeofences(context: FleetContext, body: unknown): Promise<{ ok: true }> {
  requireEdit(context);
  const input = projectGeofencesSchema.parse(body);
  const fences = await allGeofences();
  const unknown = input.geofenceIds.filter((id) => !fences.some((fence) => fence.id === id));
  if (unknown.length) throw new FleetError('Some of those geofences no longer exist.', 400);
  const ref = db().collection('projects').doc(input.projectId);
  if (!(await ref.get()).exists) throw new FleetError('That project was not found.', 404);
  await ref.set({ siteGeofenceIds: [...new Set(input.geofenceIds)] }, { merge: true });
  forgetProjects();
  afterAudit(context, 'Link Project Geofences', { after: { projectId: input.projectId, geofenceIds: input.geofenceIds } }, input.projectId);
  return { ok: true };
}

/* ── purposes ── */

/** The first save turns the seeded defaults into stored purposes, so their ids stay stable. */
async function materialiseSeeds(context: FleetContext) {
  const snapshot = await db().collection(FLEET_COLLECTIONS.purposes).limit(1).get();
  if (!snapshot.empty) return;
  const batch = db().batch();
  SEED_PURPOSES.forEach((seed, index) => {
    const purpose: Purpose = { ...seed, id: seedPurposeId(seed.name), organizationId: context.organizationId, active: true, sortOrder: (index + 1) * 10, createdAt: context.now, updatedAt: context.now, deletedAt: null };
    batch.set(db().collection(FLEET_COLLECTIONS.purposes).doc(purpose.id), purpose);
  });
  await batch.commit();
}

export async function savePurpose(context: FleetContext, body: unknown, purposeId?: string): Promise<{ purpose: Purpose }> {
  requireEdit(context);
  const input = purposeSchema.parse(body);
  await materialiseSeeds(context);
  const collection = db().collection(FLEET_COLLECTIONS.purposes);
  const ref = purposeId ? collection.doc(purposeId) : collection.doc();
  const existing = purposeId ? await ref.get() : null;
  if (purposeId && !existing?.exists) throw new FleetError('That purpose was not found.', 404);
  const clash = (await allPurposes()).find((purpose) => purpose.id !== ref.id && purpose.name.toLowerCase() === input.name.toLowerCase() && !purpose.deletedAt);
  if (clash) throw new FleetError(`"${clash.name}" already exists.`, 409, { fields: { name: 'Already in the list.' } });
  const purpose: Purpose = {
    id: ref.id,
    organizationId: context.organizationId,
    name: input.name,
    requiresReason: input.requiresReason,
    requiresProject: input.requiresProject,
    active: input.active,
    sortOrder: input.sortOrder,
    createdAt: (existing?.data()?.createdAt as string) ?? context.now,
    updatedAt: context.now,
    deletedAt: null,
  };
  await ref.set(purpose);
  forgetPurposes();
  afterAudit(context, purposeId ? 'Edit Trip Purpose' : 'Add Trip Purpose', { before: existing?.data() ?? null, after: purpose }, purpose.id, purpose.name);
  return { purpose };
}

export async function deletePurpose(context: FleetContext, purposeId: string): Promise<{ ok: true }> {
  requireEdit(context);
  await materialiseSeeds(context);
  const ref = db().collection(FLEET_COLLECTIONS.purposes).doc(purposeId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new FleetError('That purpose was not found.', 404);
  await ref.set({ deletedAt: context.now, active: false, updatedAt: context.now }, { merge: true });
  forgetPurposes();
  afterAudit(context, 'Delete Trip Purpose', { before: snapshot.data() }, purposeId, String(snapshot.data()?.name ?? ''));
  return { ok: true };
}

/* ── vehicles ── */

export async function saveVehicleFleetFields(context: FleetContext, vehicleId: string, body: unknown) {
  requireEdit(context);
  const input = vehicleFleetSchema.parse(body);
  const settings = await loadFleetSettings(context.organizationId);
  const ref = db().collection(FLEET_COLLECTIONS.vehicles).doc(vehicleId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new FleetError('That vehicle is not in Vehicle Master.', 404);
  if (input.homeGeofenceId && !(await allGeofences()).some((fence) => fence.id === input.homeGeofenceId)) throw new FleetError('That home geofence no longer exists.', 400);
  if (input.approverUid && input.approverUid === input.backupApproverUid) throw new FleetError('The backup approver must be someone else.', 400, { fields: { backupApproverUid: 'Choose someone else.' } });
  const before = Object.fromEntries(VEHICLE_FLEET_FIELDS.map((field) => [field, snapshot.data()?.[field] ?? null]));
  // Every fleet field is written, blanks as null: a cleared field takes the category default again.
  const patch = Object.fromEntries(VEHICLE_FLEET_FIELDS.map((field) => [field, (input as Record<string, unknown>)[field] ?? null]));
  await ref.set({ ...patch, updatedAt: context.now, updatedBy: context.userId }, { merge: true });
  forgetVehicles();
  afterAudit(context, 'Edit Vehicle Fleet Settings', { before, after: patch }, vehicleId, String(snapshot.data()?.vehicleNumber ?? ''));
  return { vehicle: normaliseVehicle(vehicleId, { ...snapshot.data(), ...patch }, settings) };
}

/**
 * A new odometer baseline: the meter was replaced or reset, so the next reading may be lower.
 * Not while a trip is running (its opening reading belongs to the old meter).
 */
export async function setOdometerBaseline(context: FleetContext, vehicleId: string, body: unknown) {
  requireEdit(context);
  const input = baselineSchema.parse(body);
  const photo = input.uploadId ? await claimableUpload(input.uploadId, context.userId, 'baseline') : null;
  const ref = db().collection(FLEET_COLLECTIONS.vehicles).doc(vehicleId);
  const entry = await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new FleetError('That vehicle is not in Vehicle Master.', 404);
    const data = snapshot.data() as Record<string, unknown>;
    if (data.currentTripId) throw new FleetError('A trip is running on this vehicle. End it before resetting the odometer.', 409);
    const previous = Number(data.currentOdometerKm);
    const baseline: OdometerBaseline = { km: input.km, at: context.now, byId: context.userId, byName: context.userName, reason: input.reason, photoPath: photo?.storagePath ?? null, previousKm: Number.isFinite(previous) ? previous : null };
    const history = Array.isArray(data.odometerBaselineHistory) ? data.odometerBaselineHistory : [];
    transaction.set(ref, { currentOdometerKm: input.km, odometerBaselineHistory: [...history, baseline].slice(-20), updatedAt: context.now, updatedBy: context.userId }, { merge: true });
    if (photo) transaction.set(uploadRef(photo.id), attachment({ kind: 'vehicle', id: vehicleId }, []), { merge: true });
    return { baseline, vehicleNumber: String(data.vehicleNumber ?? '') };
  });
  forgetVehicles();
  afterAudit(context, 'Set Odometer Baseline', { before: { km: entry.baseline.previousKm }, after: { km: entry.baseline.km, reason: entry.baseline.reason } }, vehicleId, entry.vehicleNumber);
  return { baseline: entry.baseline };
}

/* ── settings ── */

export async function saveFleetSettings(context: FleetContext, body: unknown): Promise<{ settings: FleetSettings }> {
  requireEdit(context);
  const input = fleetSettingsSchema.parse(body);
  if (input.approvalExpiryMinutes <= input.approvalEscalateMinutes) throw new FleetError('A request must expire after it first escalates.', 400, { fields: { approvalExpiryMinutes: 'Longer than the escalation time.' } });
  if (input.idleAutoCloseMinutes <= input.idleRemindMinutes) throw new FleetError('Auto-close must come after the reminder.', 400, { fields: { idleAutoCloseMinutes: 'Longer than the reminder.' } });
  const ref = db().collection(FLEET_COLLECTIONS.settings).doc(context.organizationId);
  const before = (await ref.get()).data() ?? null;
  const settings = normaliseFleetSettings({ ...input, updatedAt: context.now, updatedById: context.userId, updatedByName: context.userName });
  await ref.set(stripUndefined(settings));
  forgetFleetSettings(context.organizationId);
  forgetVehicles();
  afterAudit(context, 'Edit Fleet Settings', { before, after: settings });
  return { settings };
}

/* ── reading the masters ── */

/**
 * Everything the fleet settings screens edit, in one read: settings, every vehicle (retired ones
 * too, so their fields stay editable), geofences and purposes not deleted (inactive included), the
 * projects, and the active people an approver can be picked from.
 */
export async function fleetMasters(context: FleetContext) {
  if (!context.fleet.settingsView) throw new FleetError('You need Fleet Settings · View.', 403);
  const settings = await loadFleetSettings(context.organizationId);
  const [vehicles, geofences, purposes, projects, directory, raw] = await Promise.all([
    fleetVehicles(settings),
    allGeofences(),
    allPurposes(),
    fleetProjects(),
    userDirectory(),
    db().collection(FLEET_COLLECTIONS.vehicles).get(),
  ]);
  // The figures each vehicle has of its own, beside the defaults filled in: the edit dialog shows a
  // blank (the category default) only where the record really has none.
  const stored = new Map(raw.docs.map((doc) => [doc.id, doc.data() as Record<string, unknown>]));
  const own = (data: Record<string, unknown> | undefined, field: string) => {
    const value = data?.[field];
    return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  };
  return {
    settings,
    vehicles: vehicles.map((vehicle) => {
      const data = stored.get(vehicle.id);
      return {
        ...vehicle,
        own: {
          dailyKmLimit: own(data, 'dailyKmLimit'),
          monthlyKmLimit: own(data, 'monthlyKmLimit'),
          mileageTolerancePct: own(data, 'mileageTolerancePct'),
          serviceIntervalKm: own(data, 'serviceIntervalKm'),
        },
      };
    }),
    geofences: [...geofences].sort((a, b) => a.name.localeCompare(b.name)),
    purposes,
    projects,
    users: [...directory.values()]
      .filter((user) => user.active)
      .map((user) => ({ id: user.id, name: user.name, email: user.email }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
