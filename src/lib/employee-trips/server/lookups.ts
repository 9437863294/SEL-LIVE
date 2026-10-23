import 'server-only';

/**
 * The reference data every trip-claims request leans on — settings, people, projects, departments,
 * company vehicles — read with the Admin SDK and kept briefly per server instance. The database is
 * far from the app (each read is hundreds of milliseconds locally), and a claim screen asks for the
 * same names on every call. Settings are dropped from the cache the moment they are saved here.
 */

import { DEFAULT_VEHICLE_TYPES, VEHICLE_COLLECTIONS, VEHICLE_TYPES_DOC_ID } from '@/lib/vehicle-management';
import { normaliseSettings } from '../workflow.ts';
import { ET_COLLECTIONS, normaliseVehicleNumber, type ReportingSource, type TripClaimSettings } from '../types.ts';
import { db } from './context';

const REFERENCE_TTL_MS = 60_000;
const SETTINGS_TTL_MS = 10_000;

function cached<T>(ttl: number, load: () => Promise<T>) {
  let entry: { at: number; value: Promise<T> } | null = null;
  return {
    get(): Promise<T> {
      if (!entry || Date.now() - entry.at > ttl) {
        const value = load();
        entry = { at: Date.now(), value };
        // A failed read is not kept: the next request tries again.
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

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  active: boolean;
  /** The greytHR employee this login belongs to (`users.employeeId`), for the reporting line. */
  employeeId: string;
}

const users = cached(REFERENCE_TTL_MS, async () => {
  const snapshot = await db().collection('users').get();
  const map = new Map<string, DirectoryUser>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    map.set(doc.id, {
      id: doc.id,
      name: String(data.name || data.email || 'User'),
      email: String(data.email || ''),
      active: data.status !== 'Inactive',
      employeeId: String(data.employeeId ?? '').trim(),
    });
  }
  return map;
});

export const userDirectory = () => users.get();

export async function nameResolver(): Promise<(userId: string) => string> {
  const directory = await userDirectory();
  return (userId) => directory.get(userId)?.name ?? 'Unknown user';
}

/** The active login of a greytHR employee — none when two logins claim the same employee. */
function loginOfEmployee(directory: Map<string, DirectoryUser>, employeeId: string): DirectoryUser | null {
  const matches = [...directory.values()].filter((user) => user.active && user.employeeId === employeeId);
  return matches.length === 1 ? matches[0] : null;
}

export interface ReportingAuthority {
  ids: string[];
  source: ReportingSource | null;
}

/**
 * An employee's reporting authority, as the organisation already records it: the reporting manager
 * set on their login in Access Management (`accessGrants.reportingManagerId`) first, then their
 * manager in greytHR's org tree (`employees/{employeeId}.reportingManagerEmployeeId`, matched to that
 * person's login). An inactive or ambiguous match counts as none, and nobody is their own authority —
 * the workflow then falls back to the stage's named people.
 */
export async function reportingAuthorityOf(userId: string): Promise<ReportingAuthority> {
  const directory = await userDirectory();
  const grant = await db().collection('accessGrants').doc(userId).get();
  const managerId = String(grant.data()?.reportingManagerId ?? '').trim();
  if (managerId && managerId !== userId && directory.get(managerId)?.active) return { ids: [managerId], source: 'access' };

  const employeeId = directory.get(userId)?.employeeId;
  if (employeeId) {
    const mirror = await db().collection('employees').doc(employeeId).get();
    const managerEmployeeId = String(mirror.data()?.reportingManagerEmployeeId ?? '').trim();
    const manager = managerEmployeeId ? loginOfEmployee(directory, managerEmployeeId) : null;
    if (manager && manager.id !== userId) return { ids: [manager.id], source: 'greythr' };
  }
  return { ids: [], source: null };
}

/** Does anyone report to this person (Access Management or greytHR) — they then approve claims. */
export async function hasReportees(userId: string): Promise<boolean> {
  const directory = await userDirectory();
  const employeeId = directory.get(userId)?.employeeId;
  const [byGrant, byGreytHR] = await Promise.all([
    db().collection('accessGrants').where('reportingManagerId', '==', userId).limit(1).get(),
    employeeId ? db().collection('employees').where('reportingManagerEmployeeId', '==', employeeId).limit(1).get() : Promise.resolve(null),
  ]);
  return !byGrant.empty || Boolean(byGreytHR && !byGreytHR.empty);
}

export interface NamedOption {
  id: string;
  name: string;
}

const projects = cached(REFERENCE_TTL_MS, async (): Promise<NamedOption[]> => {
  const snapshot = await db().collection('projects').get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, name: String(doc.data().projectName || doc.data().name || '').trim() }))
    .filter((entry) => entry.name)
    .sort((a, b) => a.name.localeCompare(b.name));
});

const departments = cached(REFERENCE_TTL_MS, async (): Promise<NamedOption[]> => {
  const snapshot = await db().collection('departments').get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, name: String(doc.data().name || '').trim() }))
    .filter((entry) => entry.name)
    .sort((a, b) => a.name.localeCompare(b.name));
});

export const projectOptions = () => projects.get();
export const departmentOptions = () => departments.get();

export interface CompanyVehicleOption {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  fuelType: string;
  assignedDriverName: string;
  currentOdometerKm: number | null;
}

/** Vehicles that have left the fleet are not offered. */
const RETIRED = /sold|scrap|dispos|inactive|retired|written/i;

const vehicles = cached(REFERENCE_TTL_MS, async (): Promise<CompanyVehicleOption[]> => {
  const snapshot = await db().collection(VEHICLE_COLLECTIONS.vehicleMaster).get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      const odometer = Number(data.currentOdometerKm);
      return {
        id: doc.id,
        vehicleNumber: String(data.vehicleNumber || data.registrationNo || '').trim(),
        vehicleType: String(data.vehicleType || 'Other'),
        fuelType: String(data.fuelType || ''),
        assignedDriverName: String(data.assignedDriverName || ''),
        currentOdometerKm: Number.isFinite(odometer) && odometer > 0 ? odometer : null,
        status: String(data.vehicleStatus || data.currentStatus || ''),
      };
    })
    .filter((vehicle) => normaliseVehicleNumber(vehicle.vehicleNumber) && !RETIRED.test(vehicle.status))
    .map(({ status: _status, ...vehicle }) => vehicle)
    .sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber));
});

export const companyVehicles = () => vehicles.get();

const vehicleTypes = cached(REFERENCE_TTL_MS, async (): Promise<string[]> => {
  const snapshot = await db().collection(VEHICLE_COLLECTIONS.settings).doc(VEHICLE_TYPES_DOC_ID).get();
  const types = snapshot.exists ? (snapshot.data()?.types as unknown) : null;
  return Array.isArray(types) && types.length ? types.map(String) : DEFAULT_VEHICLE_TYPES;
});

export const vehicleTypeOptions = () => vehicleTypes.get();

const settingsCache = new Map<string, { at: number; value: Promise<TripClaimSettings> }>();

export function loadSettings(organizationId: string): Promise<TripClaimSettings> {
  const hit = settingsCache.get(organizationId);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value;
  const value = db()
    .collection(ET_COLLECTIONS.settings)
    .doc(organizationId)
    .get()
    .then((snapshot) => normaliseSettings(snapshot.exists ? (snapshot.data() as Partial<TripClaimSettings>) : null));
  settingsCache.set(organizationId, { at: Date.now(), value });
  value.catch(() => settingsCache.delete(organizationId));
  return value;
}

export const forgetSettings = (organizationId: string) => settingsCache.delete(organizationId);

/** Last logged closing reading per company vehicle, to prefill the next trip's opening reading. */
export interface OdometerReading {
  km: number;
  date: string;
}

export const odometerDocId = (organizationId: string) => `${organizationId}_odometer`;

export async function lastOdometerReadings(organizationId: string): Promise<Record<string, OdometerReading>> {
  const snapshot = await db().collection(ET_COLLECTIONS.counters).doc(odometerDocId(organizationId)).get();
  return (snapshot.exists ? (snapshot.data()?.readings as Record<string, OdometerReading>) : null) ?? {};
}
