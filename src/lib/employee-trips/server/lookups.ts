import 'server-only';

/**
 * The reference data every trip-claims request leans on — settings, people, projects, departments,
 * company vehicles — read with the Admin SDK and kept briefly per server instance. The database is
 * far from the app (each read is hundreds of milliseconds locally), and a claim screen asks for the
 * same names on every call. Settings are dropped from the cache the moment they are saved here.
 */

import { DEFAULT_VEHICLE_TYPES, VEHICLE_COLLECTIONS, VEHICLE_TYPES_DOC_ID } from '@/lib/vehicle-management';
import { hasExited, type EmploymentState } from '@/lib/greythr';
import { normaliseSettings } from '../workflow.ts';
import { ET_COLLECTIONS, normaliseVehicleNumber, type ReportingGap, type ReportingSource, type TripClaimSettings } from '../types.ts';
import { db } from './context';
import { tripProjectOptions } from '@/lib/employee-projects/server';

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

export interface ReportingAuthority {
  ids: string[];
  source: ReportingSource | null;
  /** Why nobody was found — the stage's own people then take the claim. */
  gap: ReportingGap | null;
}

type EmployeeRecord = FirebaseFirestore.DocumentData | undefined;

const managerEmployeeIdOf = (employee: EmployeeRecord) => String(employee?.reportingManagerEmployeeId ?? '').trim();

/** Gone from the organisation: an exit state from the sync, else the mirror's own status. */
function hasLeft(employee: EmployeeRecord): boolean {
  if (!employee) return false;
  const state = String(employee.employmentState ?? '').trim();
  return state ? hasExited(state as EmploymentState) : employee.status === 'Inactive';
}

/**
 * One login's reporting authority: the reporting manager set on the login in Access Management
 * (`accessGrants.reportingManagerId`) first, then the manager greytHR records for its employee
 * (`employees/{employeeId}.reportingManagerEmployeeId` — the link Employee › Reporting draws), matched
 * to that person's login. A manager who has left, has no login, or has two counts as none, and nobody
 * is their own authority — the workflow then falls back to the stage's named people.
 *
 * `employees` holds the records it may need: the login's employee and that employee's manager.
 */
function resolveAuthority(userId: string, directory: Map<string, DirectoryUser>, accessManagerId: string, employees: Map<string, EmployeeRecord>): ReportingAuthority {
  if (accessManagerId && accessManagerId !== userId && directory.get(accessManagerId)?.active) return { ids: [accessManagerId], source: 'access', gap: null };
  const none = (gap: ReportingGap): ReportingAuthority => ({ ids: [], source: null, gap });
  const employeeId = directory.get(userId)?.employeeId;
  const employee = employeeId ? employees.get(employeeId) : undefined;
  if (!employeeId || !employee) return none('no-employee');
  const managerEmployeeId = managerEmployeeIdOf(employee);
  if (!managerEmployeeId) return none('no-manager');
  if (managerEmployeeId === employeeId) return none('own-manager');
  if (hasLeft(employees.get(managerEmployeeId))) return none('manager-departed');
  const logins = [...directory.values()].filter((user) => user.active && user.employeeId === managerEmployeeId);
  if (logins.length > 1) return none('manager-two-logins');
  if (!logins.length) return none('manager-no-login');
  if (logins[0].id === userId) return none('own-manager');
  return { ids: [logins[0].id], source: 'greythr', gap: null };
}

async function readEmployees(ids: Iterable<string>, into: Map<string, EmployeeRecord>): Promise<void> {
  const refs = [...new Set(ids)].filter((id) => id && !into.has(id)).map((id) => db().collection('employees').doc(id));
  if (!refs.length) return;
  for (const snapshot of await db().getAll(...refs)) into.set(snapshot.id, snapshot.data());
}

/** An employee's reporting authority, read fresh (a claim is routed with it). */
export async function reportingAuthorityOf(userId: string): Promise<ReportingAuthority> {
  const directory = await userDirectory();
  const employees = new Map<string, EmployeeRecord>();
  const employeeId = directory.get(userId)?.employeeId;
  const [grant] = await Promise.all([db().collection('accessGrants').doc(userId).get(), employeeId ? readEmployees([employeeId], employees) : null]);
  if (employeeId) await readEmployees([managerEmployeeIdOf(employees.get(employeeId))], employees);
  return resolveAuthority(userId, directory, String(grant.data()?.reportingManagerId ?? '').trim(), employees);
}

/** Every active login's reporting authority — what Settings › Workflow shows and re-routing uses. */
const reportingLineCache = cached(REFERENCE_TTL_MS, async (): Promise<Map<string, ReportingAuthority>> => {
  const directory = await userDirectory();
  const active = [...directory.values()].filter((user) => user.active);
  const employees = new Map<string, EmployeeRecord>();
  const [grants] = await Promise.all([db().collection('accessGrants').select('reportingManagerId').get(), readEmployees(active.map((user) => user.employeeId), employees)]);
  await readEmployees([...employees.values()].map(managerEmployeeIdOf), employees);
  const accessManagers = new Map(grants.docs.map((doc) => [doc.id, String(doc.data().reportingManagerId ?? '').trim()]));
  return new Map(active.map((user) => [user.id, resolveAuthority(user.id, directory, accessManagers.get(user.id) ?? '', employees)]));
});

export function reportingLine(options: { fresh?: boolean } = {}): Promise<Map<string, ReportingAuthority>> {
  if (options.fresh) reportingLineCache.forget();
  return reportingLineCache.get();
}

/**
 * Does anyone's reporting line lead to this person — a reportee with a login, whose claims they then
 * approve when the workflow follows the reporting line.
 */
export async function hasReportees(userId: string): Promise<boolean> {
  return [...(await reportingLine()).values()].some((authority) => authority.ids.includes(userId));
}

export interface NamedOption {
  id: string;
  name: string;
}

const departments = cached(REFERENCE_TTL_MS, async (): Promise<NamedOption[]> => {
  const snapshot = await db().collection('departments').get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, name: String(doc.data().name || '').trim() }))
    .filter((entry) => entry.name)
    .sort((a, b) => a.name.localeCompare(b.name));
});

/**
 * A trip's projects: the values of Employee › Category's source category (Project Division here),
 * not Settings › Projects — see `tripProjectOptions`. The picker, the save check, a claim's project
 * name and Workflow's per-project approvers all read this one list.
 */
export const projectOptions = async (): Promise<NamedOption[]> => (await tripProjectOptions()).map(({ id, name }) => ({ id, name }));
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
