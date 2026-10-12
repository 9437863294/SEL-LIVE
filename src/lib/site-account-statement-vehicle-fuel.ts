/**
 * Site expenses that are fuel for a company vehicle.
 *
 * A site clerk recording "Vehicle Fuel · Two-Wheeler · ₹850" is also recording a fill-up for one
 * particular motorbike — and Vehicle Management keeps a fuel log for exactly that. Rather than
 * have the same money entered twice (and drift), the expense names the vehicle and writes the fuel
 * log itself.
 *
 * Three settings, all on Settings → Expense Categories, decide when that happens:
 *   - a main category is vehicle fuel (`linkVehicleFuel`) — by default, any whose name says "fuel";
 *   - each of its sub-categories maps to a vehicle type — explicitly (`vehicleType`), or by its
 *     name matching a type in Vehicle Management, ignoring case, spaces and punctuation, so
 *     "Two-Wheeler" finds the default type "Two Wheeler";
 *   - the vehicles offered are that type, assigned to the expense's project in Vehicle Master.
 *
 * The fuel log carries only what the expense knows: which vehicle, when, and how much. Litres,
 * odometer and station are Vehicle Management's to add — the log is marked as coming from here so
 * that screen leaves its amount alone.
 *
 * Importless, like the module's other domain files, so `node --test` loads it directly.
 */

export interface FuelRuleCategory {
  id: string;
  name: string;
  parentId?: string | null;
  isActive?: boolean;
  /** On a main category: its expenses are fuel for a company vehicle. Unset: see `linksVehicleFuel`. */
  linkVehicleFuel?: boolean;
  /** On a sub-category: the vehicle type it stands for, when its name alone does not say. */
  vehicleType?: string;
}

export interface FuelVehicle {
  id: string;
  vehicleNumber?: string;
  registrationNo?: string;
  vehicleType?: string;
  /** The id of the project in the company's master project list. */
  assignedProjectId?: string;
  vehicleStatus?: string;
  fuelType?: string;
}

/** Case, spaces and punctuation are not part of a type's identity: "Two-Wheeler" is "Two Wheeler". */
export function normaliseTypeName(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return normaliseTypeName(a) !== '' && normaliseTypeName(a) === normaliseTypeName(b);
}

/**
 * Whether a main category's expenses are fuel for a company vehicle.
 *
 * The switch on Settings → Expense Categories decides once it has been set either way. Until then a
 * category whose name says "fuel" ("VEHICLE FUEL", "Fuel & Lubricants") counts — the switch lived
 * only in the edit dialog, and a setup that looked complete (sub-categories named exactly as the
 * vehicle types) still showed no vehicles because nobody had found it. A category named otherwise
 * has to be switched on, and a fuel category that should not ask for vehicles switched off.
 */
export function linksVehicleFuel(main: Pick<FuelRuleCategory, 'name' | 'linkVehicleFuel'>): boolean {
  if (typeof main.linkVehicleFuel === 'boolean') return main.linkVehicleFuel;
  return /fuel/i.test(main.name ?? '');
}

/**
 * The vehicle type an expense is fuel for, or null when it is not vehicle fuel at all.
 *
 * Null unless the main category is vehicle fuel (`linksVehicleFuel`) — a sub-category that happens to be
 * called "Car" under Repair & Maintenance must never start writing fuel logs. An explicit mapping
 * wins over the name, and is only honoured when it is still one of Vehicle Management's types.
 */
export function vehicleTypeFor({
  category,
  subCategory,
  categories,
  vehicleTypes,
}: {
  category: string | null | undefined;
  subCategory: string | null | undefined;
  categories: FuelRuleCategory[];
  vehicleTypes: string[];
}): string | null {
  const main = categories.find(c => !c.parentId && sameName(c.name, category));
  if (!main || !linksVehicleFuel(main)) return null;
  const sub = categories.find(c => c.parentId === main.id && c.isActive !== false && sameName(c.name, subCategory));
  if (!sub) return null;

  const explicit = sub.vehicleType ? vehicleTypes.find(t => sameName(t, sub.vehicleType)) : undefined;
  if (explicit) return explicit;
  return vehicleTypes.find(t => sameName(t, sub.name)) ?? null;
}

/** A vehicle that has left the fleet cannot be fuelled on a site. */
const RETIRED = new Set(['inactive', 'sold', 'scrapped']);

export function vehicleLabel(vehicle: FuelVehicle): string {
  return vehicle.vehicleNumber || vehicle.registrationNo || 'Unnamed vehicle';
}

/**
 * The vehicles to offer: the right type, assigned to this project, and still in service.
 *
 * `centralProjectId` is the SAS project's link to the master project list — the same id Vehicle
 * Master stores in `assignedProjectId`. Sorted by number so a clerk finds a bike by its plate.
 */
export function vehiclesFor({
  vehicles,
  vehicleType,
  centralProjectId,
}: {
  vehicles: FuelVehicle[];
  vehicleType: string | null;
  centralProjectId: string | null | undefined;
}): FuelVehicle[] {
  if (!vehicleType || !centralProjectId) return [];
  return vehicles
    .filter(v => sameName(v.vehicleType, vehicleType)
      && v.assignedProjectId === centralProjectId
      && !RETIRED.has(String(v.vehicleStatus ?? '').toLowerCase()))
    .sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b)));
}

export interface VehicleChoiceCheck {
  ok: boolean;
  reason?: string;
}

/** The vehicle picker's "not in the list — type the number" choice. */
export const MANUAL_VEHICLE = '_manual_';

/** A vehicle number as typed, tidied for storage: trimmed, upper-case, single-spaced. */
export function tidyVehicleNumber(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** The Vehicle Master record a typed number belongs to — case, spaces and dashes aside. */
export function findVehicleByNumber(vehicles: FuelVehicle[], number: string | null | undefined): FuelVehicle | null {
  const wanted = normaliseTypeName(number);
  if (!wanted) return null;
  return vehicles.find(v => normaliseTypeName(v.vehicleNumber) === wanted
    || normaliseTypeName(v.registrationNo) === wanted) ?? null;
}

/** Fewer characters than any registration plate — a typo or a placeholder, not a vehicle. */
const MIN_NUMBER_LENGTH = 4;

/**
 * Whether the vehicle named on an expense is acceptable.
 *
 * A vehicle-fuel expense always names one: picked from the project's vehicles of the type, or —
 * when it is not among them, or the project has none — typed as a number. A typed number does not
 * have to be in Vehicle Master: hired and borrowed vehicles are fuelled on sites too, and refusing
 * the expense would not make them appear there. It simply logs no fuel unless Vehicle Master knows it.
 */
export function validateVehicleChoice({
  vehicleType,
  vehicleId,
  manualNumber,
  options,
}: {
  vehicleType: string | null;
  vehicleId: string | null | undefined;
  manualNumber?: string | null;
  options: FuelVehicle[];
}): VehicleChoiceCheck {
  if (!vehicleType) return { ok: true };
  if (vehicleId === MANUAL_VEHICLE || options.length === 0) {
    const typed = normaliseTypeName(manualNumber);
    if (!typed) return { ok: false, reason: `Enter the ${vehicleType}'s vehicle number.` };
    if (typed.length < MIN_NUMBER_LENGTH) {
      return { ok: false, reason: `"${tidyVehicleNumber(manualNumber)}" is too short for a vehicle number.` };
    }
    return { ok: true };
  }
  if (!vehicleId) {
    return { ok: false, reason: `Choose which ${vehicleType} this fuel was for — or "Not in the list" to type its number.` };
  }
  if (!options.some(v => v.id === vehicleId)) {
    return { ok: false, reason: `That vehicle is not a ${vehicleType} assigned to this project.` };
  }
  return { ok: true };
}

/** One expense, one fuel log, at a predictable id — so an edit or delete finds it without a search. */
export function fuelLogIdFor(expenseId: string): string {
  return `sas-${expenseId}`;
}

export const SAS_FUEL_SOURCE = 'site-account-statement';

/**
 * The fuel log an expense writes: who, when, how much — nothing it cannot vouch for.
 *
 * Litres, rate, odometer and station are left empty for Vehicle Management to fill. `fuelType`
 * comes from the vehicle's own record, not from the expense.
 */
export function buildFuelLog({
  expenseId,
  expenseDate,
  amount,
  vehicle,
  projectId,
  projectName,
  category,
  subCategory,
  enteredByUserId,
  enteredByName,
}: {
  expenseId: string;
  expenseDate: string;
  amount: number;
  vehicle: FuelVehicle;
  projectId: string;
  projectName: string;
  category: string;
  subCategory: string;
  enteredByUserId: string;
  enteredByName: string;
}): Record<string, unknown> {
  return {
    vehicleId: vehicle.id,
    vehicleNumber: vehicleLabel(vehicle),
    fuelType: vehicle.fuelType || 'Other',
    fuelDate: expenseDate,
    totalAmount: Number(amount) || 0,
    fuelStatus: 'Submitted',
    remarks: `Recorded from Site Account Statement · ${projectName} · ${category}${subCategory ? ` / ${subCategory}` : ''}`,
    source: SAS_FUEL_SOURCE,
    sasExpenseId: expenseId,
    sasProjectId: projectId,
    sasProjectName: projectName,
    enteredByUserId,
    enteredByName,
  };
}

/**
 * What to do with an expense's fuel log after a save or delete.
 *
 * `write` creates or refreshes it; `remove` takes it away when the expense no longer stands for a
 * vehicle's fuel — its category, sub-category or vehicle changed — or the expense was deleted.
 */
export function fuelLogAction({
  hadLog,
  vehicleId,
  deleted = false,
}: {
  /** Whether the expense, before this change, was linked to a vehicle. */
  hadLog: boolean;
  /** The vehicle the expense is linked to now, if any. */
  vehicleId: string | null | undefined;
  deleted?: boolean;
}): 'write' | 'remove' | 'none' {
  if (deleted) return hadLog ? 'remove' : 'none';
  if (vehicleId) return 'write';
  return hadLog ? 'remove' : 'none';
}
