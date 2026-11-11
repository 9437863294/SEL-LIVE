import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_DEDUCTION_TYPES } from '../src/lib/bill-tracking/defaults.ts';
import { deductionTypesByProject, describeDeductionChanges, differsFromMaster, normaliseDeductionOverrides, projectDeductionChanges, projectDeductionTypes, projectsOverridingHead, projectsWithOwnDeductions, setOverride, withProjectDeductions } from '../src/lib/bill-tracking/deduction-types.ts';
import { computeDeductions } from '../src/lib/bill-tracking/gst.ts';
import { billRetentionSlabs } from '../src/lib/bill-tracking/retention.ts';

const types = DEFAULT_DEDUCTION_TYPES;
const head = (id) => types.find((type) => type.id === id);
const config = (projectProfiles = []) => ({ deductionTypes: types, projectProfiles });
const p1 = (deductionTypes) => ({ projectId: 'p1', deductionTypes });

test('a project without settings of its own uses the master as it is', () => {
  const masters = config([{ projectId: 'p2', dgmOffice: 'Cuttack' }]);
  assert.equal(projectDeductionTypes(masters, 'p1'), types);
  assert.equal(projectDeductionTypes(masters, 'p2'), types);
  assert.equal(projectDeductionTypes(masters, null), types);
  assert.equal(withProjectDeductions(masters, 'p1'), masters, 'the same config object — nothing to merge');
});

test('a project’s own settings override the master for that project only; name, code and kind stay', () => {
  const masters = config([p1([{ deductionTypeId: 'dt-ret-inv', defaultPercent: 5, percentBase: 'gross' }, { deductionTypeId: 'dt-bcess', active: false }, { deductionTypeId: 'dt-itds', defaultPercent: null }])]);
  const own = projectDeductionTypes(masters, 'p1');
  const ret = own.find((type) => type.id === 'dt-ret-inv');
  assert.deepEqual([ret.defaultPercent, ret.percentBase, ret.name, ret.code, ret.kind], [5, 'gross', 'Retention Against Invoice', 'RET_INV', 'retention_invoice']);
  assert.equal(own.find((type) => type.id === 'dt-bcess').active, false);
  assert.equal('defaultPercent' in own.find((type) => type.id === 'dt-itds'), false, 'null clears the master’s default %');
  // The master and other projects are untouched.
  assert.deepEqual([head('dt-ret-inv').defaultPercent, head('dt-bcess').active, head('dt-itds').defaultPercent], [10, true, 2]);
  assert.equal(projectDeductionTypes(masters, 'p2'), types);
  assert.equal(withProjectDeductions({ ...masters, settings: {} }, 'p1').deductionTypes.find((type) => type.id === 'dt-ret-inv').defaultPercent, 5);
});

test('a project’s settings change how its deductions are worked out', () => {
  // Income TDS: the master takes 2% of taxable less mobilisation advance; this project takes it of the whole taxable.
  const masters = config([p1([{ deductionTypeId: 'dt-itds', baseLessTypeIds: [] }])]);
  const lines = [
    { id: 'm', deductionTypeId: 'dt-mobadv', baseAmount: 10000 },
    { id: 't', deductionTypeId: 'dt-itds', percentage: 2 },
  ];
  const context = { taxable: 100000, gross: 118000, roundToRupee: true, gstType: 'cgst-sgst' };
  assert.equal(computeDeductions(lines, types, context)[1].amount, 1800);
  assert.equal(computeDeductions(lines, projectDeductionTypes(masters, 'p1'), context)[1].amount, 2000);
  // And retention typed as an amount reads its rate against what the project takes it of: ₹10,000 is
  // 10% of a ₹1,00,000 taxable, 8% of a ₹1,25,000 gross.
  const onGross = config([p1([{ deductionTypeId: 'dt-ret-inv', percentBase: 'gross' }])]);
  const bill = { taxableAmount: 100000, grossAmount: 125000, deductions: [{ id: 'r', deductionTypeId: 'dt-ret-inv', deductionTypeName: 'Retention Against Invoice', kind: 'retention_invoice', amount: 10000 }] };
  assert.deepEqual(billRetentionSlabs(bill, types).map((entry) => entry.slab.rate), [10]);
  assert.deepEqual(billRetentionSlabs(bill, projectDeductionTypes(onGross, 'p1')).map((entry) => entry.slab.rate), [8]);
});

test('a head off in the master and on for one project is that project’s own', () => {
  const masters = { deductionTypes: types.map((type) => (type.id === 'dt-lccomm' ? { ...type, active: false } : type)), projectProfiles: [p1([{ deductionTypeId: 'dt-lccomm', active: true }])] };
  assert.equal(projectDeductionTypes(masters, 'p1').find((type) => type.id === 'dt-lccomm').active, true);
  assert.equal(projectDeductionTypes(masters, 'p2').find((type) => type.id === 'dt-lccomm').active, false);
});

test('settings are kept only where they differ from the master, and reset back to it', () => {
  const ret = head('dt-ret-inv');
  let overrides = setOverride([], ret, { defaultPercent: 5 });
  assert.deepEqual(overrides, [{ deductionTypeId: 'dt-ret-inv', defaultPercent: 5 }]);
  overrides = setOverride(overrides, ret, { percentBase: 'taxable', active: true, baseLessTypeIds: [] });
  assert.deepEqual(overrides, [{ deductionTypeId: 'dt-ret-inv', defaultPercent: 5 }], 'values equal to the master are not stored');
  assert.equal(differsFromMaster(ret, overrides[0], 'defaultPercent'), true);
  assert.equal(differsFromMaster(ret, overrides[0], 'percentBase'), false);
  // Set back to the master's 10%: the head follows the master again and drops out.
  assert.deepEqual(setOverride(overrides, ret, { defaultPercent: 10 }), []);
  // "Less" compares as a set, whatever the order.
  const itds = head('dt-itds');
  assert.deepEqual(setOverride([], itds, { baseLessTypeIds: ['dt-mobadv'] }), []);
  assert.deepEqual(setOverride([], { ...itds, baseLessTypeIds: ['dt-mobadv', 'dt-bcess'] }, { baseLessTypeIds: ['dt-bcess', 'dt-mobadv'] }), []);
});

test('saved settings keep only known heads, once each, and "less" only of other known heads', () => {
  const saved = normaliseDeductionOverrides(
    [
      { deductionTypeId: 'dt-gone', defaultPercent: 3 },
      { deductionTypeId: 'dt-itds', baseLessTypeIds: ['dt-itds', 'dt-gone', 'dt-bcess'], defaultPercent: 2 },
      { deductionTypeId: 'dt-itds', defaultPercent: 7 },
      { deductionTypeId: 'dt-bcess', active: true },
    ],
    types,
  );
  assert.deepEqual(saved, [{ deductionTypeId: 'dt-itds', baseLessTypeIds: ['dt-bcess'] }]);
  assert.deepEqual(normaliseDeductionOverrides(undefined, types), []);
  assert.deepEqual(projectsWithOwnDeductions([p1(saved), { projectId: 'p2' }, { projectId: 'p3', deductionTypes: [] }, { projectId: 'p4', valueBasisRules: [{ id: 'r' }] }]), [
    { projectId: 'p1', heads: 1, basisRules: 0 },
    { projectId: 'p4', heads: 0, basisRules: 1 },
  ]);
});

test('what a project sets differently reads head by head, in the master’s order', () => {
  const masters = {
    deductionTypes: types.map((type) => (type.id === 'dt-lccomm' ? { ...type, active: false } : type)),
    projectProfiles: [
      p1([{ deductionTypeId: 'dt-ret-inv', defaultPercent: 5, percentBase: 'gross' }, { deductionTypeId: 'dt-itds', baseLessTypeIds: [] }, { deductionTypeId: 'dt-bcess', active: false }, { deductionTypeId: 'dt-lccomm', active: true }]),
      { projectId: 'p2', dgmOffice: 'Cuttack' },
      { projectId: 'p3', deductionTypes: [{ deductionTypeId: 'dt-ret-inv', active: false }] },
    ],
  };
  const heads = projectDeductionChanges(masters, 'p1');
  assert.deepEqual(heads.map((head) => head.name), ['Building Cess', 'Income TDS', 'Retention Against Invoice', 'LC Commission']);
  assert.deepEqual(heads[2].changes, [
    { field: 'defaultPercent', label: 'Default %', value: '5%', defaultValue: '10%' },
    { field: 'percentBase', label: '% of', value: 'Gross', defaultValue: 'Taxable' },
  ]);
  assert.deepEqual(heads[1].changes, [{ field: 'baseLessTypeIds', label: 'Less (base)', value: '− Nothing', defaultValue: '− Mobilization Advance' }]);
  assert.deepEqual(heads.map((head) => head.ownHead), [false, false, false, true]);
  assert.equal(
    describeDeductionChanges(heads),
    'Building Cess: switched off; Income TDS: Less (base) − Nothing; Retention Against Invoice: Default % 5%, % of Gross; LC Commission: offered on this project only',
  );
  assert.deepEqual(projectDeductionChanges(masters, 'p2'), []);
  assert.deepEqual(projectDeductionChanges(masters, null), []);
  // The master table's per-head column: which projects set the head for themselves.
  assert.deepEqual(projectsOverridingHead(masters.projectProfiles, 'dt-ret-inv'), ['p1', 'p3']);
  assert.deepEqual(projectsOverridingHead(masters.projectProfiles, 'dt-mobadv'), []);
});

test('reading many projects: each bill’s project view, worked out once per project', () => {
  const masters = config([p1([{ deductionTypeId: 'dt-ret-inv', defaultPercent: 5 }])]);
  const typesFor = deductionTypesByProject(masters);
  assert.equal(typesFor('p1'), typesFor('p1'), 'cached');
  assert.equal(typesFor('p1').find((type) => type.id === 'dt-ret-inv').defaultPercent, 5);
  assert.equal(typesFor('p2'), types);
  assert.equal(typesFor(undefined), types);
});
