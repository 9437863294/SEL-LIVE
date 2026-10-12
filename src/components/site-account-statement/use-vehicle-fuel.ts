'use client';

/**
 * Reads and writes behind the vehicle-fuel link: which vehicles a fuel expense may name, and the
 * Vehicle Management fuel log it keeps in step. The rules themselves — which category links, which
 * vehicles qualify, what the log says — are in site-account-statement-vehicle-fuel.ts.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DEFAULT_VEHICLE_TYPES, VEHICLE_COLLECTIONS, VEHICLE_TYPES_DOC_ID } from '@/lib/vehicle-management';
import {
  buildFuelLog, findVehicleByNumber, fuelLogAction, fuelLogIdFor, linksVehicleFuel, MANUAL_VEHICLE,
  tidyVehicleNumber, vehicleLabel, vehiclesFor, vehicleTypeFor,
  type FuelRuleCategory, type FuelVehicle,
} from '@/lib/site-account-statement-vehicle-fuel';

/** Vehicle Management's list of types, falling back to its defaults when unset or unreadable. */
export async function loadVehicleTypes(): Promise<string[]> {
  try {
    const snap = await getDoc(doc(db, VEHICLE_COLLECTIONS.settings, VEHICLE_TYPES_DOC_ID));
    const types = snap.exists() ? (snap.data() as { types?: unknown }).types : null;
    return Array.isArray(types) && types.length > 0 ? types.map(String) : DEFAULT_VEHICLE_TYPES;
  } catch {
    return DEFAULT_VEHICLE_TYPES;
  }
}

/** Every vehicle Vehicle Master has assigned to one master project. */
export async function loadProjectVehicles(centralProjectId: string): Promise<FuelVehicle[]> {
  const snap = await getDocs(query(
    collection(db, VEHICLE_COLLECTIONS.vehicleMaster),
    where('assignedProjectId', '==', centralProjectId),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as FuelVehicle));
}

/**
 * The vehicle record behind an id — from the list already on screen, else read afresh.
 *
 * An edit can keep a vehicle that has since left the project; its log still needs the vehicle's
 * own number and fuel type, not a placeholder.
 */
export async function resolveVehicle(
  vehicleId: string,
  known: FuelVehicle[],
  fallback?: Partial<FuelVehicle>,
): Promise<FuelVehicle> {
  const listed = known.find(v => v.id === vehicleId);
  if (listed) return listed;
  try {
    const snap = await getDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, vehicleId));
    if (snap.exists()) return { id: snap.id, ...snap.data() } as FuelVehicle;
  } catch {
    // Unreadable — the number stored on the expense is the best that is left.
  }
  return { ...fallback, id: vehicleId };
}

/** Every vehicle in Vehicle Master — read only to place a number someone typed. */
export async function loadAllVehicles(): Promise<FuelVehicle[]> {
  const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as FuelVehicle));
}

/**
 * What an expense records for its vehicle: the Vehicle Master vehicle, if there is one — which gets
 * the fuel log — and the number shown on the expense.
 *
 * A typed number is looked for in the project's own list, then the whole fleet: a vehicle lent
 * from another site is still that vehicle, and its fuel belongs in its log. A number Vehicle Master
 * does not know (a hired vehicle), or a fleet that cannot be read, keeps just the number.
 */
export async function chosenVehicle({
  vehicleType,
  vehicleId,
  manualNumber,
  options,
  kept,
  fleet = loadAllVehicles,
}: {
  vehicleType: string | null;
  vehicleId: string;
  manualNumber: string;
  options: FuelVehicle[];
  kept?: FuelVehicle | null;
  /** Supplies the whole fleet — an import passes a cached one so 200 rows read it once. */
  fleet?: () => Promise<FuelVehicle[]>;
}): Promise<{ vehicle: FuelVehicle | null; vehicleNumber: string }> {
  if (!vehicleType) return { vehicle: null, vehicleNumber: '' };
  if (vehicleId && vehicleId !== MANUAL_VEHICLE) {
    const vehicle = await resolveVehicle(vehicleId, options, kept ?? undefined);
    return { vehicle, vehicleNumber: vehicleLabel(vehicle) };
  }
  const typed = tidyVehicleNumber(manualNumber);
  if (!typed) return { vehicle: null, vehicleNumber: '' };
  let vehicle = findVehicleByNumber(options, typed);
  if (!vehicle) {
    try {
      vehicle = findVehicleByNumber(await fleet(), typed);
    } catch {
      vehicle = null;
    }
  }
  return { vehicle, vehicleNumber: vehicle ? vehicleLabel(vehicle) : typed };
}

export interface VehicleFuelLink {
  /** The vehicle type the chosen category and sub-category stand for; null when not vehicle fuel. */
  vehicleType: string | null;
  /** Vehicles of that type assigned to the project and still in service. */
  options: FuelVehicle[];
  loading: boolean;
  /** Vehicle Master could not be read — the expense saves, but no fuel log can be written. */
  error: string | null;
}

/**
 * What the expense form needs to offer a vehicle.
 *
 * Nothing is read until it matters: the type list only once some category links to vehicles,
 * and a project's vehicles only once the form's category resolves to a type.
 */
export function useVehicleFuelLink({
  category,
  subCategory,
  categories,
  centralProjectId,
}: {
  category: string;
  subCategory: string;
  categories: FuelRuleCategory[];
  centralProjectId: string | null | undefined;
}): VehicleFuelLink & { vehicleTypes: string[] } {
  const anyLinked = categories.some(c => !c.parentId && linksVehicleFuel(c));
  const [types, setTypes] = useState<string[] | null>(null);
  useEffect(() => {
    if (!anyLinked) return;
    let cancelled = false;
    void loadVehicleTypes().then(t => { if (!cancelled) setTypes(t); });
    return () => { cancelled = true; };
  }, [anyLinked]);

  const vehicleTypes = types ?? DEFAULT_VEHICLE_TYPES;
  const vehicleType = anyLinked
    ? vehicleTypeFor({ category, subCategory, categories, vehicleTypes })
    : null;

  // Keyed by project, so switching project never shows the last one's vehicles while loading.
  const fleetKey = vehicleType && centralProjectId ? centralProjectId : '';
  const [fleet, setFleet] = useState<{ key: string; vehicles: FuelVehicle[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!fleetKey) return;
    let cancelled = false;
    loadProjectVehicles(fleetKey)
      .then(vehicles => { if (!cancelled) setFleet({ key: fleetKey, vehicles, error: null }); })
      .catch((e: any) => {
        if (!cancelled) setFleet({ key: fleetKey, vehicles: [], error: e?.message || 'Vehicle Master could not be read.' });
      });
    return () => { cancelled = true; };
  }, [fleetKey]);

  const current = fleet && fleet.key === fleetKey ? fleet : null;
  const options = useMemo(
    () => vehiclesFor({ vehicles: current?.vehicles ?? [], vehicleType, centralProjectId }),
    [current, vehicleType, centralProjectId],
  );

  return {
    vehicleType,
    options,
    // Until the type list is in, a category could resolve to the wrong type (or none) — so the
    // form waits for it rather than letting a save through without a vehicle.
    loading: (anyLinked && types === null) || (Boolean(fleetKey) && !current),
    error: current?.error ?? null,
    vehicleTypes,
  };
}

/**
 * Brings an expense's fuel log in line with the expense, after the expense itself has saved.
 *
 * Run after, not alongside: a fuel log Vehicle Management refuses must not cost the site its
 * expense record. The caller warns when this throws, and the next save of the expense retries —
 * the log sits at an id derived from the expense, so writing it twice is harmless.
 */
export async function syncFuelLog({
  expenseId,
  previousVehicleId,
  vehicle,
  deleted = false,
  expense,
  user,
}: {
  expenseId: string;
  /** The vehicle on the record before this change, if any. */
  previousVehicleId?: string | null;
  /** The vehicle on the record now, if any. */
  vehicle: FuelVehicle | null;
  deleted?: boolean;
  expense: {
    expenseDate: string;
    amount: number;
    projectId: string;
    projectName: string;
    category: string;
    subCategory: string;
  };
  user: { id?: string; name?: string } | null | undefined;
}): Promise<'written' | 'removed' | 'none'> {
  const action = fuelLogAction({ hadLog: Boolean(previousVehicleId), vehicleId: vehicle?.id, deleted });
  const ref = doc(db, VEHICLE_COLLECTIONS.fuel, fuelLogIdFor(expenseId));
  if (action === 'remove') {
    await deleteDoc(ref);
    return 'removed';
  }
  if (action === 'none' || !vehicle) return 'none';

  await setDoc(ref, {
    ...buildFuelLog({
      expenseId,
      expenseDate: expense.expenseDate,
      amount: expense.amount,
      vehicle,
      projectId: expense.projectId,
      projectName: expense.projectName,
      category: expense.category,
      subCategory: expense.subCategory,
      enteredByUserId: user?.id || '',
      enteredByName: user?.name || '',
    }),
    updatedAt: serverTimestamp(),
    // First link only — a later edit, or a change of vehicle, keeps the log's original stamp.
    ...(previousVehicleId ? {} : { createdAt: serverTimestamp() }),
  }, { merge: true });
  return 'written';
}
