import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_DEDUCTION_TYPES } from '../src/lib/bill-tracking/defaults.ts';
import { billRetentionSlabs, releaseSlabKey, retentionBifurcation, retentionLineRate, slabKey } from '../src/lib/bill-tracking/retention.ts';

const types = DEFAULT_DEDUCTION_TYPES;
const line = (id, deductionTypeId, amount, extra = {}) => {
  const type = types.find((entry) => entry.id === deductionTypeId);
  return { id, deductionTypeId, deductionTypeName: type.name, kind: type.kind, amount, ...extra };
};
/** A ₹10,00,000 supply bill (GST 18%) with the given deduction lines. */
const bill = (id, deductions, extra = {}) => ({
  id,
  projectId: 'p1',
  projectNameSnapshot: 'Angul',
  transactionType: 'invoice',
  billTypeName: 'SUPPLY -100%',
  billDate: '2026-06-01',
  gstInvoiceNumber: `INV-${id}`,
  isDeleted: false,
  taxableAmount: 1000000,
  grossAmount: 1180000,
  deductions,
  ...extra,
});

test('a line typed as a percentage counts at exactly that rate — including one typed by hand', () => {
  assert.deepEqual(retentionLineRate({ percentage: 30, amount: 300000 }, bill('b', [])), { rate: 30, basis: 'percent' });
  assert.deepEqual(retentionLineRate({ percentage: 7.5, amount: 75000 }, bill('b', [])), { rate: 7.5, basis: 'percent' });
});

test('a line typed as an amount is read against the bill’s taxable, snapping only to a clean half-percent', () => {
  assert.deepEqual(retentionLineRate({ amount: 300000 }, bill('b', [])), { rate: 30, basis: 'amount' });
  assert.deepEqual(retentionLineRate({ amount: 100030 }, bill('b', [])), { rate: 10, basis: 'amount' }, '10.003% reads as 10%');
  assert.deepEqual(retentionLineRate({ amount: 97300 }, bill('b', [])), { rate: null, basis: 'amount' }, '9.73% stays a fixed amount');
  assert.deepEqual(retentionLineRate({ amount: 5000 }, bill('b', [], { taxableAmount: 0 })), { rate: null, basis: 'amount' }, 'no base, no rate');
  // A head taken on gross reads the amount against the gross.
  assert.deepEqual(retentionLineRate({ amount: 118000 }, bill('b', []), { percentBase: 'gross' }), { rate: 10, basis: 'amount' });
});

test('10% and 30% retention on one invoice, under the same head, are two slabs', () => {
  const invoice = bill('b1', [line('a', 'dt-ret-inv', 100000, { percentage: 10 }), line('b', 'dt-ret-inv', 300000, { percentage: 30 }), line('c', 'dt-itds', 20000, { percentage: 2 })]);
  const slabs = billRetentionSlabs(invoice, types);
  assert.deepEqual(slabs.map((entry) => [entry.slab.label, entry.held, entry.basis]), [
    ['Retention Against Invoice @ 10%', 100000, 'percent'],
    ['Retention Against Invoice @ 30%', 300000, 'percent'],
  ]);
  assert.equal(slabs[1].slab.key, 'dt-ret-inv|30');
});

test('two lines at the same rate merge; a typed % and an amount reading the same rate are “mixed”', () => {
  const invoice = bill('b1', [line('a', 'dt-ret-cpbg', 50000, { percentage: 5 }), line('b', 'dt-ret-cpbg', 50000)]);
  const [only] = billRetentionSlabs(invoice, types);
  assert.equal(only.slab.label, 'Retention Against CPBG @ 5%');
  assert.equal(only.held, 100000);
  assert.equal(only.basis, 'mixed');
  assert.equal(only.lines, 2);
});

test('the bifurcation across bills, projects and releases', () => {
  const b1 = bill('b1', [line('a', 'dt-ret-inv', 100000, { percentage: 10 }), line('b', 'dt-ret-inv', 300000, { percentage: 30 })]);
  // Imported: amounts only — 30% and 10% read back from the amounts.
  const b2 = bill('b2', [line('a', 'dt-ret-inv', 150000), line('b', 'dt-ret-cpbg', 50000)], { taxableAmount: 500000, grossAmount: 590000, projectId: 'p2', projectNameSnapshot: 'Rayagada' });
  // A credit note reversing part of b1's 30%: read against its own (negative) taxable.
  const credit = bill('n1', [line('a', 'dt-ret-inv', -30000)], { transactionType: 'credit_note', taxableAmount: -100000, grossAmount: -118000 });
  const deleted = bill('gone', [line('a', 'dt-ret-inv', 999999, { percentage: 30 })], { isDeleted: true });
  const releases = [
    { id: 'r1', projectId: 'p1', projectNameSnapshot: 'Angul', kind: 'retention_invoice', deductionTypeId: 'dt-ret-inv', rate: 30, amount: 100000, status: 'active' },
    { id: 'r2', projectId: 'p1', projectNameSnapshot: 'Angul', kind: 'retention_invoice', amount: 20000, status: 'active' },
    { id: 'r3', projectId: 'p1', projectNameSnapshot: 'Angul', kind: 'retention_invoice', deductionTypeId: 'dt-ret-inv', rate: 30, amount: 55555, status: 'cancelled' },
  ];
  const result = retentionBifurcation([b1, b2, credit, deleted], releases, types);

  assert.deepEqual(result.columns.map((slab) => slab.key), ['dt-ret-cpbg|10', 'dt-ret-inv|10', 'dt-ret-inv|30']);
  const byKey = Object.fromEntries(result.slabs.map((entry) => [entry.slab.key, entry]));
  assert.equal(byKey['dt-ret-inv|30'].held, 300000 + 150000 - 30000, 'b1 30% + b2 30% − the credit note');
  assert.equal(byKey['dt-ret-inv|30'].bills, 3);
  assert.equal(byKey['dt-ret-inv|30'].projects, 2);
  assert.equal(byKey['dt-ret-inv|30'].released, 100000);
  assert.equal(byKey['dt-ret-inv|30'].balance, 320000);
  assert.equal(byKey['dt-ret-inv|10'].held, 100000);
  assert.equal(byKey['dt-ret-cpbg|10'].held, 50000);

  const angul = result.byProject.find((row) => row.projectId === 'p1');
  assert.equal(angul.held, 370000);
  assert.equal(angul.released, 120000, 'every active release counts for the project');
  assert.equal(angul.unattributed, 20000, 'one names no slab');
  assert.equal(angul.balance, 250000);
  assert.equal(result.totals.held, 570000, '4,00,000 + 2,00,000 − 30,000');
  assert.equal(result.totals.unattributed, 20000);

  const importedRow = result.byBill.find((row) => row.id === 'b2');
  assert.equal(importedRow.fromAmounts, true);
  assert.deepEqual(importedRow.cells, { 'dt-ret-inv|30': 150000, 'dt-ret-cpbg|10': 50000 });
  assert.equal(result.byBill.find((row) => row.id === 'b1').fromAmounts, false);
  assert.equal(result.byBill.some((row) => row.id === 'gone'), false);
  // The slabs add up to the retention the module reports elsewhere.
  assert.equal(result.slabs.reduce((sum, entry) => sum + entry.held, 0), result.totals.held);
});

test('a release naming a slab that no bill holds, or only a rate, is matched sensibly', () => {
  const slabs = billRetentionSlabs(bill('b1', [line('a', 'dt-ret-inv', 300000, { percentage: 30 }), line('b', 'dt-ret-cpbg', 100000, { percentage: 10 })]), types).map((entry) => entry.slab);
  assert.equal(releaseSlabKey({ deductionTypeId: 'dt-ret-inv', rate: 30, kind: 'retention_invoice' }, slabs), 'dt-ret-inv|30');
  assert.equal(releaseSlabKey({ deductionTypeId: 'dt-ret-inv', rate: 12, kind: 'retention_invoice' }, slabs), null, 'no such slab');
  assert.equal(releaseSlabKey({ rate: 10, kind: 'retention_cpbg' }, slabs), 'dt-ret-cpbg|10', 'rate + kind');
  assert.equal(releaseSlabKey({ kind: 'retention_invoice' }, slabs), null, 'names nothing');
  assert.equal(slabKey('dt-ret-te', null), 'dt-ret-te|amount');
});
