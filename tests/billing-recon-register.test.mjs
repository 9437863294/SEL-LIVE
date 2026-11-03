import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BILLING_RECON_COLLECTIONS,
  BILLING_RECON_FIXED,
  PROJECT_JMC_SERIAL_CONFIGS,
  SHARED_PROJECT_REGISTER,
  billingReconRegister,
  isBillingReconSeparated,
  projectJmcSerialCollection,
  serialConfigBelongsTo,
} from '../src/lib/billing-recon/register.ts';
import { chunk, planSeparation, referencedJmcIds } from '../src/lib/billing-recon/separation.ts';

const separated = { id: 'p1', billingReconSeparation: { separatedAt: '2026-11-03T10:00:00.000Z' } };
const shared = { id: 'p2' };

test('a project stays on the shared register until it is stamped', () => {
  assert.equal(isBillingReconSeparated(shared), false);
  assert.equal(isBillingReconSeparated(null), false);
  assert.equal(isBillingReconSeparated({ billingReconSeparation: { separatedAt: '  ' } }), false);
  assert.equal(isBillingReconSeparated({ billingReconSeparation: null }), false);
  assert.equal(isBillingReconSeparated(separated), true);
});

test('unseparated projects read exactly the collections Billing Recon always used', () => {
  const reg = billingReconRegister(shared);
  assert.equal(reg.separated, false);
  assert.equal(reg.boqItems, 'boqItems');
  assert.equal(reg.jmcEntries, 'jmcEntries');
  assert.equal(reg.mvacEntries, 'mvacEntries');
  assert.equal(reg.jmcWorkflowId, 'jmc-workflow');
  assert.equal(reg.mvacWorkflowId, 'mvac-workflow');
  assert.equal(reg.serialConfigs, 'billingReconSerialConfigs');
});

test('separated projects read only Billing Recon collections', () => {
  const reg = billingReconRegister(separated);
  assert.equal(reg.separated, true);
  for (const key of ['boqItems', 'jmcEntries', 'mvacEntries', 'jmcWorkflowId']) {
    assert.equal(reg[key], BILLING_RECON_COLLECTIONS[key]);
    assert.notEqual(reg[key], SHARED_PROJECT_REGISTER[key], `${key} must not be shared`);
  }
  // RA bills are never Subcontractors' `bills`.
  assert.equal(reg.raBills, BILLING_RECON_FIXED.raBills);
  assert.notEqual(reg.raBills, 'bills');
  assert.equal(billingReconRegister(shared).raBills, BILLING_RECON_FIXED.raBills);
});

test('Project Management JMC numbering leaves the shared counter only once separated', () => {
  assert.equal(projectJmcSerialCollection(shared), 'billingReconSerialConfigs');
  assert.equal(projectJmcSerialCollection(separated), PROJECT_JMC_SERIAL_CONFIGS);
});

test('serial config ids are matched to their project by prefix', () => {
  assert.equal(serialConfigBelongsTo('p1_civil_foundation', 'p1'), true);
  assert.equal(serialConfigBelongsTo('p10_civil_foundation', 'p1'), false);
  assert.equal(serialConfigBelongsTo('p1_civil', ''), false);
});

const base = {
  boqIds: ['b1', 'b2', 'b3'],
  existingBillingReconBoqIds: [],
  jmcIds: ['j1', 'j2', 'j3'],
  selectedJmcIds: ['j1', 'j2'],
  existingBillingReconJmcIds: [],
  mvacIds: ['m1'],
  existingBillingReconMvacIds: [],
  serialConfigIds: ['p1_a_b'],
  existingProjectSerialConfigIds: [],
  removeCopiedJmcFromProjectRegister: false,
  referencedJmcIds: [],
};

test('a first run copies the BOQ, the chosen JMCs, all MVAC and the counters', () => {
  const plan = planSeparation(base);
  assert.deepEqual(plan.boqToCopy, ['b1', 'b2', 'b3']);
  assert.deepEqual(plan.jmcToCopy, ['j1', 'j2']);
  assert.deepEqual(plan.mvacToCopy, ['m1']);
  assert.deepEqual(plan.serialConfigsToCopy, ['p1_a_b']);
  assert.deepEqual(plan.jmcToRemoveFromProjectRegister, []);
  assert.equal(plan.totalWrites, 3 + 2 + 1 + 1);
});

test('a re-run skips what is already copied and never overwrites it', () => {
  const plan = planSeparation({
    ...base,
    existingBillingReconBoqIds: ['b1', 'b2'],
    existingBillingReconJmcIds: ['j1'],
    existingBillingReconMvacIds: ['m1'],
    existingProjectSerialConfigIds: ['p1_a_b'],
  });
  assert.deepEqual(plan.boqToCopy, ['b3']);
  assert.equal(plan.boqAlreadyCopied, 2);
  assert.deepEqual(plan.jmcToCopy, ['j2']);
  assert.equal(plan.jmcAlreadyCopied, 1);
  assert.deepEqual(plan.mvacToCopy, []);
  assert.deepEqual(plan.serialConfigsToCopy, []);
});

test('removal from the project register spares JMCs a subcontractor bill points at', () => {
  const plan = planSeparation({ ...base, removeCopiedJmcFromProjectRegister: true, referencedJmcIds: ['j2'] });
  assert.deepEqual(plan.jmcToRemoveFromProjectRegister, ['j1']);
  assert.deepEqual(plan.jmcKeptBecauseReferenced, ['j2']);
});

test('ids that are not in the register cannot be chosen', () => {
  const plan = planSeparation({ ...base, selectedJmcIds: ['j1', 'ghost', '', 'j1'] });
  assert.deepEqual(plan.jmcToCopy, ['j1']);
});

test('referenced JMC ids are read from bill line items', () => {
  const ids = referencedJmcIds([
    { items: [{ jmcEntryId: 'j1' }, { jmcEntryId: 'j2' }, { jmcEntryId: '' }] },
    { items: [{ jmcEntryId: 'j1' }, null] },
    { items: 'not an array' },
    {},
  ]);
  assert.deepEqual(ids.sort(), ['j1', 'j2']);
});

test('chunks stay under the batch limit', () => {
  const sizes = chunk(Array.from({ length: 1001 }, (_, i) => i), 400).map((c) => c.length);
  assert.deepEqual(sizes, [400, 400, 201]);
  assert.deepEqual(chunk([], 400), []);
});
