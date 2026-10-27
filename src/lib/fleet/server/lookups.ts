import 'server-only';

/**
 * Reference data the fleet reads on most requests — settings, vehicles, geofences, purposes,
 * projects, drivers — kept briefly per server instance (each Firestore read is hundreds of
 * milliseconds from here). Anything the fleet itself saves is dropped from the cache at once.
 *
 * Vehicles are cached for a few seconds only: `currentTripId` (the running-trip lock) lives on
 * them, and every decision on it is re-read inside a transaction anyway.
 */

import { normaliseFleetSettings, normaliseVehicle } from '../settings.ts';
import { FLEET_COLLECTIONS, SEED_PURPOSES, type FleetSettings, type FleetVehicle, type Geofence, type ProjectOption, type Purpose } from '../types.ts';
import { db } from './context';
import { tripProjectOptions } from '@/lib/employee-projects/server';

function cached<T>(ttl: number, load: () => Promise<T>) {
  let entry: { at: number; value: Promise<T> } | null = null;
  return {
    get(): Promise<T> {
      if (!entry || Date.now() - entry.at > ttl) {
        const value = load();
        entry = { at: Date.now(), value };
        value.catch(() => {
          if (entry?.value === value) entry = null;
        });
      }
      return entry.value;
    },
    forget() {
      entry = null;
    },
  };
}

/* ── settings ── */

const settingsCache = new Map<string, { at: number; value: Promise<FleetSettings> }>();

export function loadFleetSettings(organizationId: string): Promise<FleetSettings> {
  const hit = settingsCache.get(organizationId);
  if (hit && Date.now() - hit.at < 10_000) return hit.value;
  const value = db()
    .collection(FLEET_COLLECTIONS.settings)
    .doc(organizationId)
    .get()
    .then((snapshot) => normaliseFleetSettings(snapshot.exists ? (snapshot.data() as Partial<FleetSettings>) : null));
  settingsCache.set(organizationId, { at: Date.now(), value });
  value.catch(() => settingsCache.delete(organizationId));
  return value;
}

export const forgetFleetSettings = (organizationId: string) => settingsCache.delete(organizationId);

/* ── vehicles ── */

const rawVehicles = cached(5_000, async () => {
  const snapshot = await db().collection(FLEET_COLLECTIONS.vehicles).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
});

export async function fleetVehicles(settings: FleetSettings): Promise<FleetVehicle[]> {
  const raw = await rawVehicles.get();
  return raw.map((entry) => normaliseVehicle(entry.id, entry.data, settings)).sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber));
}

export const forgetVehicles = () => rawVehicles.forget();

/* ── geofences, purposes ── */

const geofences = cached(30_000, async (): Promise<Geofence[]> => {
  const snapshot = await db().collection(FLEET_COLLECTIONS.geofences).get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as Geofence), id: doc.id })).filter((fence) => !fence.deletedAt);
});

export const allGeofences = () => geofences.get();
export const activeGeofences = async () => (await geofences.get()).filter((fence) => fence.active);
export const forgetGeofences = () => geofences.forget();

/** Until an admin saves purposes, the seeded list is offered (and nothing is written). */
export const seedPurposeId = (name: string) => `default-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

const purposes = cached(30_000, async (): Promise<Purpose[]> => {
  const snapshot = await db().collection(FLEET_COLLECTIONS.purposes).get();
  const stored = snapshot.docs.map((doc) => ({ ...(doc.data() as Purpose), id: doc.id })).filter((purpose) => !purpose.deletedAt);
  if (stored.length) return stored.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return SEED_PURPOSES.map((seed, index) => ({
    ...seed,
    id: seedPurposeId(seed.name),
    organizationId: '',
    active: true,
    sortOrder: (index + 1) * 10,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
  }));
});

export const allPurposes = () => purposes.get();
export const activePurposes = async () => (await purposes.get()).filter((purpose) => purpose.active);
export const forgetPurposes = () => purposes.forget();

/* ── projects ── */

const INACTIVE_PROJECT = /closed|complete|cancel|inactive|archiv/i;

const projects = cached(60_000, async (): Promise<ProjectOption[]> => {
  const snapshot = await db().collection('projects').get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        name: String(data.projectName || data.name || '').trim(),
        code: String(data.siteCode || '').trim(),
        clientName: String(data.clientName || '').trim(),
        active: !INACTIVE_PROJECT.test(String(data.status || '')),
        siteGeofenceIds: Array.isArray(data.siteGeofenceIds) ? data.siteGeofenceIds.map(String) : [],
      };
    })
    .filter((project) => project.name)
    .sort((a, b) => a.name.localeCompare(b.name));
});

export const fleetProjects = () => projects.get();
export const forgetProjects = () => projects.forget();

/**
 * The projects a fleet trip (and an over-limit request) is for: Employee › Category's source
 * category values — Project Division — as own-vehicle trips use (`tripProjectOptions`). A value
 * linked to Settings › Projects carries its site code. `fleetProjects` stays the list for
 * geofences, Vehicle Master and the reports' own project names.
 */
export const fleetTripProjects = async (): Promise<Array<ProjectOption & { linkedProjectIds: string[] }>> =>
  (await tripProjectOptions()).map((option) => ({ id: option.id, name: option.name, code: option.code, clientName: '', active: true, siteGeofenceIds: [], linkedProjectIds: option.linkedProjectIds }));

/* ── drivers ── */

export interface DriverRecord {
  id: string;
  name: string;
  linkedUserId: string;
  assignedVehicleId: string | null;
  active: boolean;
}

const drivers = cached(60_000, async (): Promise<DriverRecord[]> => {
  const snapshot = await db().collection(FLEET_COLLECTIONS.drivers).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      name: String(data.driverName || data.name || '').trim(),
      linkedUserId: String(data.linkedUserId || '').trim(),
      assignedVehicleId: String(data.assignedVehicleId || '').trim() || null,
      active: !/inactive|left|resigned|terminated/i.test(String(data.status || data.driverStatus || '')),
    };
  });
});

export const driverRecords = () => drivers.get();

/** The caller's Driver Master record, when they have one. */
export async function driverOf(userId: string): Promise<DriverRecord | null> {
  return (await drivers.get()).find((driver) => driver.linkedUserId === userId && driver.active) ?? null;
}
