import test from 'node:test';
import assert from 'node:assert/strict';

const {
  normaliseTypeName,
  linksVehicleFuel,
  vehicleTypeFor,
  vehiclesFor,
  vehicleLabel,
  validateVehicleChoice,
  MANUAL_VEHICLE,
  tidyVehicleNumber,
  findVehicleByNumber,
  fuelLogIdFor,
  buildFuelLog,
  fuelLogAction,
  SAS_FUEL_SOURCE,
} = await import('../src/lib/site-account-statement-vehicle-fuel.ts');

const TYPES = ['Truck', 'Car', 'Two Wheeler', 'Other'];
const CATS = [
  { id: 'fuel', name: 'VEHICLE FUEL', linkVehicleFuel: true },
  { id: 'fuel-2w', name: 'Two-Wheeler', parentId: 'fuel' },
  { id: 'fuel-4w', name: 'Four-Wheeler', parentId: 'fuel', vehicleType: 'Car' },
  { id: 'fuel-gen', name: 'Generator', parentId: 'fuel' },
  { id: 'fuel-old', name: 'Truck', parentId: 'fuel', isActive: false },
  { id: 'rep', name: 'Repair & Maintenance' },
  { id: 'rep-car', name: 'Car', parentId: 'rep' },
];

const type = (category, subCategory, categories = CATS) => vehicleTypeFor({ category, subCategory, categories, vehicleTypes: TYPES });

// ── Names ──────────────────────────────────────────────────────────────────────

test('type names ignore case, spaces and punctuation', () => {
  assert.equal(normaliseTypeName('Two-Wheeler'), normaliseTypeName('two wheeler'));
  assert.equal(normaliseTypeName('  TWO_WHEELER '), 'twowheeler');
  assert.equal(normaliseTypeName(undefined), '');
});

// ── Which vehicle type ─────────────────────────────────────────────────────────

test('a sub-category maps to a vehicle type by name, punctuation aside', () => {
  assert.equal(type('VEHICLE FUEL', 'Two-Wheeler'), 'Two Wheeler');
  assert.equal(type('vehicle fuel', 'two-wheeler'), 'Two Wheeler');
});

test('an explicit mapping wins over the name', () => {
  assert.equal(type('VEHICLE FUEL', 'Four-Wheeler'), 'Car');
});

test('an explicit mapping to a type that no longer exists falls back to the name', () => {
  const cats = [CATS[0], { id: 's', name: 'Car', parentId: 'fuel', vehicleType: 'Hovercraft' }];
  assert.equal(type('VEHICLE FUEL', 'Car', cats), 'Car');
});

test('a sub-category matching no vehicle type is not vehicle fuel', () => {
  assert.equal(type('VEHICLE FUEL', 'Generator'), null);
});

test('only a category marked as vehicle fuel links to vehicles', () => {
  // "Car" under Repair & Maintenance must never start writing fuel logs.
  assert.equal(type('Repair & Maintenance', 'Car'), null);
});

test('a category whose name says fuel links by default, until switched either way', () => {
  // The live setup: VEHICLE FUEL never had the switch set, and its sub-categories are named as types.
  const unset = [
    { id: 'f', name: 'VEHICLE FUEL', requireSubCategory: true },
    { id: 'f2', name: 'Two Wheeler', parentId: 'f', vehicleType: '' },
  ];
  assert.equal(linksVehicleFuel(unset[0]), true);
  assert.equal(type('VEHICLE FUEL', 'Two Wheeler', unset), 'Two Wheeler');
  assert.equal(linksVehicleFuel({ name: 'Fuel & Lubricants' }), true);

  // Switched off, a fuel category asks for no vehicle.
  const off = [{ ...unset[0], linkVehicleFuel: false }, unset[1]];
  assert.equal(type('VEHICLE FUEL', 'Two Wheeler', off), null);

  // Any other name has to be switched on.
  assert.equal(linksVehicleFuel({ name: 'Repair & Maintenance' }), false);
  assert.equal(linksVehicleFuel({ name: 'Conveyance', linkVehicleFuel: true }), true);
});

test('an inactive sub-category links nothing', () => {
  assert.equal(type('VEHICLE FUEL', 'Truck'), null);
});

test('no category or no sub-category links nothing', () => {
  assert.equal(type('', 'Two-Wheeler'), null);
  assert.equal(type('VEHICLE FUEL', ''), null);
  assert.equal(type('Ghost', 'Two-Wheeler'), null);
});

// ── Which vehicles ─────────────────────────────────────────────────────────────

const FLEET = [
  { id: 'v1', vehicleNumber: 'AS01 B 1234', vehicleType: 'Two Wheeler', assignedProjectId: 'central-A', vehicleStatus: 'Active' },
  { id: 'v2', vehicleNumber: 'AS01 A 0001', vehicleType: 'two-wheeler', assignedProjectId: 'central-A' },
  { id: 'v3', vehicleNumber: 'AS01 C 5555', vehicleType: 'Two Wheeler', assignedProjectId: 'central-B' },
  { id: 'v4', vehicleNumber: 'AS01 D 7777', vehicleType: 'Car', assignedProjectId: 'central-A' },
  { id: 'v5', vehicleNumber: 'AS01 E 9999', vehicleType: 'Two Wheeler', assignedProjectId: 'central-A', vehicleStatus: 'Sold' },
  { id: 'v6', registrationNo: 'AS01F2222', vehicleType: 'Two Wheeler', assignedProjectId: 'central-A', vehicleStatus: 'Under Maintenance' },
];

test("the vehicles offered are the type, on this project, still in the fleet", () => {
  const offered = vehiclesFor({ vehicles: FLEET, vehicleType: 'Two Wheeler', centralProjectId: 'central-A' });
  // v3 is another project's, v4 is a car, v5 was sold. A vehicle under maintenance can still be fuelled.
  assert.deepEqual(offered.map(v => v.id), ['v2', 'v1', 'v6']);
});

test('vehicles are offered in plate order', () => {
  const offered = vehiclesFor({ vehicles: FLEET, vehicleType: 'Two Wheeler', centralProjectId: 'central-A' });
  assert.deepEqual(offered.map(vehicleLabel), ['AS01 A 0001', 'AS01 B 1234', 'AS01F2222']);
});

test('no type or no project link offers nothing', () => {
  assert.deepEqual(vehiclesFor({ vehicles: FLEET, vehicleType: null, centralProjectId: 'central-A' }), []);
  assert.deepEqual(vehiclesFor({ vehicles: FLEET, vehicleType: 'Two Wheeler', centralProjectId: '' }), []);
});

test('a vehicle with neither number nor registration still has a label', () => {
  assert.equal(vehicleLabel({ id: 'x' }), 'Unnamed vehicle');
});

// ── The choice ─────────────────────────────────────────────────────────────────

const OPTIONS = vehiclesFor({ vehicles: FLEET, vehicleType: 'Two Wheeler', centralProjectId: 'central-A' });

test('a vehicle must be chosen when there are vehicles to choose from', () => {
  const r = validateVehicleChoice({ vehicleType: 'Two Wheeler', vehicleId: '', options: OPTIONS });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Choose which Two Wheeler/);
});

test('a vehicle from outside the offered list is refused', () => {
  const r = validateVehicleChoice({ vehicleType: 'Two Wheeler', vehicleId: 'v3', options: OPTIONS });
  assert.match(r.reason, /not a Two Wheeler assigned to this project/);
});

test('an offered vehicle passes', () => {
  assert.equal(validateVehicleChoice({ vehicleType: 'Two Wheeler', vehicleId: 'v1', options: OPTIONS }).ok, true);
});

test('with no vehicles of the type on the project, the number is typed instead', () => {
  const missing = validateVehicleChoice({ vehicleType: 'Two Wheeler', vehicleId: '', options: [] });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /Enter the Two Wheeler's vehicle number/);
  assert.equal(validateVehicleChoice({ vehicleType: 'Two Wheeler', vehicleId: '', manualNumber: 'od 02 cn 9999', options: [] }).ok, true);
});

test('"Not in the list" asks for a number even when there are vehicles to pick', () => {
  const missing = validateVehicleChoice({ vehicleType: 'Two Wheeler', vehicleId: MANUAL_VEHICLE, manualNumber: '  ', options: OPTIONS });
  assert.equal(missing.ok, false);
  assert.equal(validateVehicleChoice({ vehicleType: 'Two Wheeler', vehicleId: MANUAL_VEHICLE, manualNumber: 'WB01X1', options: OPTIONS }).ok, true);
});

test('a typed number too short to be a plate is refused', () => {
  const r = validateVehicleChoice({ vehicleType: 'Car', vehicleId: MANUAL_VEHICLE, manualNumber: 'ab', options: [] });
  assert.match(r.reason, /too short/);
});

test('an unpicked list points at the typed-number way out', () => {
  const r = validateVehicleChoice({ vehicleType: 'Two Wheeler', vehicleId: '', options: OPTIONS });
  assert.match(r.reason, /Not in the list/);
});

// ── Typed numbers ──────────────────────────────────────────────────────────────

test('a typed number is tidied for storage', () => {
  assert.equal(tidyVehicleNumber('  od02  cn 7704 '), 'OD02 CN 7704');
  assert.equal(tidyVehicleNumber(undefined), '');
});

test('a typed number finds its Vehicle Master record, spacing and case aside', () => {
  assert.equal(findVehicleByNumber(FLEET, 'as01-b-1234')?.id, 'v1');
  // By registration when the vehicle has no number of its own.
  assert.equal(findVehicleByNumber(FLEET, 'AS01 F 2222')?.id, 'v6');
  // Another project's vehicle is still that vehicle — its fuel is logged against it.
  assert.equal(findVehicleByNumber(FLEET, 'AS01C5555')?.id, 'v3');
  assert.equal(findVehicleByNumber(FLEET, 'KA01ZZ0000'), null);
  assert.equal(findVehicleByNumber(FLEET, ''), null);
});

test('an expense that is not vehicle fuel needs no vehicle', () => {
  assert.equal(validateVehicleChoice({ vehicleType: null, vehicleId: '', options: OPTIONS }).ok, true);
});

// ── The fuel log ───────────────────────────────────────────────────────────────

test('the fuel log has a predictable id per expense', () => {
  assert.equal(fuelLogIdFor('abc123'), 'sas-abc123');
});

test('the fuel log carries the vehicle, the date and the amount — and is marked as ours', () => {
  const log = buildFuelLog({
    expenseId: 'e1', expenseDate: '2026-10-05', amount: '850', vehicle: { ...FLEET[0], fuelType: 'Petrol' },
    projectId: 'sas-p', projectName: 'ASSAM PACKAGE-C', category: 'VEHICLE FUEL', subCategory: 'Two-Wheeler',
    enteredByUserId: 'u1', enteredByName: 'Clerk',
  });
  assert.equal(log.vehicleId, 'v1');
  assert.equal(log.vehicleNumber, 'AS01 B 1234');
  assert.equal(log.fuelDate, '2026-10-05');
  assert.equal(log.totalAmount, 850);
  assert.equal(log.fuelType, 'Petrol');
  assert.equal(log.source, SAS_FUEL_SOURCE);
  assert.equal(log.sasExpenseId, 'e1');
  assert.match(log.remarks, /ASSAM PACKAGE-C · VEHICLE FUEL \/ Two-Wheeler/);
});

test('the fuel log claims nothing the expense does not know', () => {
  const log = buildFuelLog({
    expenseId: 'e1', expenseDate: '2026-10-05', amount: 850, vehicle: FLEET[0],
    projectId: 'p', projectName: 'P', category: 'C', subCategory: '', enteredByUserId: '', enteredByName: '',
  });
  for (const key of ['quantityLiters', 'ratePerUnit', 'odometerReadingKm', 'fuelStationName', 'mileageKmPerLiter']) {
    assert.equal(key in log, false, key);
  }
  // A vehicle with no fuel type of its own is recorded as Other, not left blank.
  assert.equal(log.fuelType, 'Other');
});

// ── Keeping the two in step ────────────────────────────────────────────────────

test('linking a vehicle writes the log', () => {
  assert.equal(fuelLogAction({ hadLog: false, vehicleId: 'v1' }), 'write');
  assert.equal(fuelLogAction({ hadLog: true, vehicleId: 'v1' }), 'write');
});

test('an edit that drops the vehicle removes the log', () => {
  assert.equal(fuelLogAction({ hadLog: true, vehicleId: '' }), 'remove');
});

test('deleting a linked expense removes its log', () => {
  assert.equal(fuelLogAction({ hadLog: true, vehicleId: 'v1', deleted: true }), 'remove');
  assert.equal(fuelLogAction({ hadLog: false, vehicleId: '', deleted: true }), 'none');
});

test('an expense that never had a vehicle does nothing', () => {
  assert.equal(fuelLogAction({ hadLog: false, vehicleId: null }), 'none');
});
