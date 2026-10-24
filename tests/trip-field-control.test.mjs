import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ET_FORM_KEYS,
  ET_FORM_REGISTRY,
  etFieldDef,
  resolveFieldSetting,
  resolveForm,
  seedsFromRules,
} from '../src/lib/employee-trips/field-registry.ts';

/* ------------------------------------------------------------------------------------------------
 * The registry itself
 * ---------------------------------------------------------------------------------------------- */

test('every declared form exists in the registry', () => {
  for (const key of ET_FORM_KEYS) {
    assert.ok(ET_FORM_REGISTRY[key], `no definition for ${key}`);
    assert.ok(ET_FORM_REGISTRY[key].fields.length > 0, `${key} has no fields`);
  }
});

test('field keys are unique within a form', () => {
  // A duplicate key would make one of them unreachable and silently unconfigurable.
  for (const key of ET_FORM_KEYS) {
    const keys = ET_FORM_REGISTRY[key].fields.map((field) => field.key);
    assert.equal(new Set(keys).size, keys.length, `${key} has duplicate field keys`);
  }
});

test('every locked field explains why', () => {
  // A lock with no reason reads as a bug to whoever meets it on the settings screen.
  for (const key of ET_FORM_KEYS) {
    for (const field of ET_FORM_REGISTRY[key].fields) {
      if (field.locked) assert.ok(field.lockReason, `${key}.${field.key} is locked with no reason`);
    }
  }
});

test('the fields the server insists on are all locked', () => {
  /*
    `validateTrip` rejects a trip without each of these, whatever the settings say. Leaving one
    unlocked would let an administrator hide a field and trap every employee behind an error about
    something no longer on screen.
  */
  for (const key of ['tripDate', 'ownership', 'vehicleNumber', 'fromPlace', 'toPlace', 'distance']) {
    assert.equal(etFieldDef('trip', key)?.locked, true, `${key} should be locked`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Resolving
 * ---------------------------------------------------------------------------------------------- */

test('with nothing stored, a field is its registry default', () => {
  const setting = resolveFieldSetting(null, 'trip', 'notes');
  assert.deepEqual(setting, { visible: true, required: false, label: 'Notes' });
});

test('an override wins for an unlocked field', () => {
  const doc = { trip: { notes: { visible: false, required: true, label: 'Remarks' } } };
  assert.deepEqual(resolveFieldSetting(doc, 'trip', 'notes'), {
    visible: false,
    required: true,
    label: 'Remarks',
  });
});

test('a locked field keeps its visibility and requiredness, whatever is stored', () => {
  // The guard against a hand-edited document hiding something the server still demands.
  const doc = { trip: { toPlace: { visible: false, required: false, label: 'Destination' } } };
  assert.deepEqual(resolveFieldSetting(doc, 'trip', 'toPlace'), {
    visible: true,
    required: true,
    label: 'Destination',
  });
});

test('a blank label falls back rather than rendering an empty caption', () => {
  const doc = { trip: { purpose: { label: '   ' } } };
  assert.equal(resolveFieldSetting(doc, 'trip', 'purpose').label, 'Purpose');
});

test('an unknown field key resolves to something usable instead of throwing', () => {
  const setting = resolveFieldSetting(null, 'trip', 'fieldRemovedLastYear');
  assert.equal(setting.label, 'fieldRemovedLastYear');
  assert.equal(setting.visible, true);
});

/* ------------------------------------------------------------------------------------------------
 * The legacy rules
 * ---------------------------------------------------------------------------------------------- */

test('requireProject arrives as Project being required', () => {
  const seeds = seedsFromRules({ requireProject: true, allowTollParking: true });
  assert.equal(resolveFieldSetting(null, 'trip', 'projectId', seeds.projectId).required, true);
});

test('allowTollParking off hides both money fields', () => {
  const seeds = seedsFromRules({ requireProject: false, allowTollParking: false });
  assert.equal(resolveFieldSetting(null, 'trip', 'tollAmount', seeds.tollAmount).visible, false);
  assert.equal(resolveFieldSetting(null, 'trip', 'parkingAmount', seeds.parkingAmount).visible, false);
});

test('an explicit override beats the legacy rule it replaces', () => {
  // Otherwise configuring the new screen would appear to do nothing while the old switch disagreed.
  const seeds = seedsFromRules({ requireProject: true, allowTollParking: true });
  const doc = { trip: { projectId: { required: false } } };
  assert.equal(resolveFieldSetting(doc, 'trip', 'projectId', seeds.projectId).required, false);
});

test('an absent allowTollParking is treated as on, not as hidden', () => {
  // A settings document written before the rule existed must not blank the form.
  const seeds = seedsFromRules({});
  assert.equal(resolveFieldSetting(null, 'trip', 'tollAmount', seeds.tollAmount).visible, true);
});

/* ------------------------------------------------------------------------------------------------
 * Whole forms
 * ---------------------------------------------------------------------------------------------- */

test('a form resolves in registry order, not stored order', () => {
  // So a new field appears without a migration, and the screen's order is the one authored here.
  const doc = { trip: { notes: { label: 'Remarks' }, purpose: { label: 'Reason' } } };
  const resolved = resolveForm(doc, 'trip');
  assert.deepEqual(
    resolved.map((field) => field.key),
    ET_FORM_REGISTRY.trip.fields.map((field) => field.key),
  );
});

test('a stale key left in the document is ignored', () => {
  const doc = { trip: { aFieldThatNoLongerExists: { visible: false } } };
  const resolved = resolveForm(doc, 'trip');
  assert.ok(!resolved.some((field) => field.key === 'aFieldThatNoLongerExists'));
});

test('resolving a form carries the lock through to the screen', () => {
  const resolved = resolveForm(null, 'trip');
  const toPlace = resolved.find((field) => field.key === 'toPlace');
  assert.equal(toPlace.locked, true);
  assert.ok(toPlace.lockReason);
});
