import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_DEDUCTION_TYPES } from '../src/lib/bill-tracking/defaults.ts';
import { billRetentionSlabs, namedReleaseSlab, releaseSlabKey, retentionBifurcation, retentionLineRate, slabKey } from '../src/lib/bill-tracking/retention.ts';

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
  // A credit note reversing part of b1's 30%: it reads as 30% of its own (negative) taxable, a slab b1 holds.
  const credit = bill('n1', [line('a', 'dt-ret-inv', -30000)], { transactionType: 'credit_note', againstBillId: 'b1', taxableAmount: -100000, grossAmount: -118000 });
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

test('a release naming its head is its slab; one naming only a rate matches the slabs given', () => {
  const slabs = billRetentionSlabs(bill('b1', [line('a', 'dt-ret-inv', 300000, { percentage: 30 }), line('b', 'dt-ret-cpbg', 100000, { percentage: 10 })]), types).map((entry) => entry.slab);
  assert.equal(releaseSlabKey({ deductionTypeId: 'dt-ret-inv', rate: 30, kind: 'retention_invoice' }, slabs), 'dt-ret-inv|30');
  assert.equal(releaseSlabKey({ deductionTypeId: 'dt-ret-inv', rate: 12, kind: 'retention_invoice' }, slabs), 'dt-ret-inv|12', 'a named head is its slab, held or not');
  assert.equal(releaseSlabKey({ rate: 10, kind: 'retention_cpbg' }, slabs), 'dt-ret-cpbg|10', 'rate + kind');
  assert.equal(releaseSlabKey({ kind: 'retention_invoice' }, slabs), null, 'names nothing');
  assert.equal(slabKey('dt-ret-te', null), 'dt-ret-te|amount');
});

test('only a real rate makes a slab: a typed 0, a negative or over 100% is a fixed amount, and a ₹0 line is left out', () => {
  assert.deepEqual(retentionLineRate({ percentage: -10, amount: -100000 }, bill('b', [])), { rate: null, basis: 'percent' });
  assert.deepEqual(retentionLineRate({ percentage: 0, amount: 5000 }, bill('b', [])), { rate: null, basis: 'percent' });
  assert.deepEqual(retentionLineRate({ percentage: 150, amount: 1500000 }, bill('b', [])), { rate: null, basis: 'percent' });
  assert.deepEqual(retentionLineRate({ amount: 1500000 }, bill('b', [])), { rate: null, basis: 'amount' }, '150% of taxable is no rate');

  const invoice = bill('b1', [line('a', 'dt-ret-inv', 0, { percentage: 10 }), line('b', 'dt-ret-inv', 300000, { percentage: 30 })]);
  assert.deepEqual(billRetentionSlabs(invoice, types).map((entry) => entry.slab.key), ['dt-ret-inv|30']);
  const empty = bill('b2', [line('a', 'dt-ret-inv', 0, { percentage: 10 })]);
  assert.deepEqual(billRetentionSlabs(empty, types), []);
  const result = retentionBifurcation([invoice, empty], [], types);
  assert.deepEqual(result.byBill.map((row) => row.id), ['b1'], 'a bill holding only ₹0 is no row');
  assert.equal(result.slabs[0].bills, 1);
});

test('a note lands in its invoice’s slabs — even one reversing 10% and 30% in a single line', () => {
  const invoice = bill('b1', [line('a', 'dt-ret-inv', 100000, { percentage: 10 }), line('b', 'dt-ret-inv', 300000, { percentage: 30 }), line('c', 'dt-ret-cpbg', 50000, { percentage: 5 })]);
  const note = (id, deductions, extra = {}) => bill(id, deductions, { transactionType: 'credit_note', againstBillId: 'b1', taxableAmount: -100000, grossAmount: -118000, ...extra });
  const held = (slabs) => slabs.map((entry) => [entry.slab.key, entry.held, entry.basis]);

  // −40,000 on −1,00,000 reads as 40%, a rate the invoice does not hold: shared 1 : 3 over its 10% and 30%.
  assert.deepEqual(held(billRetentionSlabs(note('n1', [line('a', 'dt-ret-inv', -40000)]), types, invoice)), [
    ['dt-ret-inv|10', -10000, 'invoice'],
    ['dt-ret-inv|30', -30000, 'invoice'],
  ]);
  // A deduction-only note (no taxable of its own) is shared the same way, exact to the paisa.
  assert.deepEqual(
    billRetentionSlabs(note('n2', [line('a', 'dt-ret-inv', -1000.01)], { taxableAmount: 0, grossAmount: 0 }), types, invoice).map((entry) => entry.held),
    [-250, -750.01],
  );
  // Reversing just the 30% reads as 30% and stays there; a head the invoice does not hold is read on the note's own base.
  assert.deepEqual(held(billRetentionSlabs(note('n3', [line('a', 'dt-ret-inv', -30000), line('b', 'dt-ret-te', -20000)]), types, invoice)), [
    ['dt-ret-inv|30', -30000, 'amount'],
    ['dt-ret-te|20', -20000, 'amount'],
  ]);

  // In the bifurcation, an invoice outside the bills in view (an earlier year) still places its note.
  const result = retentionBifurcation([note('n1', [line('a', 'dt-ret-inv', -40000)])], [], types, [invoice]);
  assert.deepEqual(result.byBill[0].cells, { 'dt-ret-inv|10': -10000, 'dt-ret-inv|30': -30000 });
  assert.equal(result.byBill[0].fromInvoice, true);
  assert.equal(result.byBill[0].fromAmounts, false);
  assert.equal(result.totals.held, -40000, 'sharing never changes the total');
  // Without its invoice the note can only be read on its own base.
  assert.deepEqual(retentionBifurcation([note('n1', [line('a', 'dt-ret-inv', -40000)])], [], types).byBill[0].cells, { 'dt-ret-inv|40': -40000 });
});

test('a release counts in the slab it names even when no bill in view holds it; a bare rate only in its own project', () => {
  const b1 = bill('b1', [line('a', 'dt-ret-inv', 300000, { percentage: 30 })]);
  const releases = [
    // Last year's 10%: no bill in view holds it.
    { id: 'r1', projectId: 'p1', projectNameSnapshot: 'Angul', kind: 'retention_invoice', deductionTypeId: 'dt-ret-inv', rate: 10, amount: 40000, status: 'active' },
    // A bare 30% in a project holding no 30%: never booked to Angul's slab.
    { id: 'r2', projectId: 'p2', projectNameSnapshot: 'Rayagada', kind: 'retention_invoice', rate: 30, amount: 25000, status: 'active' },
    // A bare 30% in Angul matches Angul's slab.
    { id: 'r3', projectId: 'p1', projectNameSnapshot: 'Angul', kind: 'retention_invoice', rate: 30, amount: 50000, status: 'active' },
  ];
  const result = retentionBifurcation([b1], releases, types);
  const byKey = Object.fromEntries(result.slabs.map((entry) => [entry.slab.key, entry]));
  assert.deepEqual(Object.keys(byKey), ['dt-ret-inv|10', 'dt-ret-inv|30']);
  const ten = byKey['dt-ret-inv|10'];
  assert.deepEqual([ten.held, ten.released, ten.balance, ten.bills], [0, 40000, -40000, 0]);
  assert.equal(byKey['dt-ret-inv|30'].released, 50000);
  assert.equal(result.totals.unattributed, 25000);
  assert.equal(result.byProject.find((row) => row.projectId === 'p2').unattributed, 25000);
  assert.equal(result.byProject.find((row) => row.projectId === 'p1').unattributed, 0);
  assert.equal(namedReleaseSlab({ deductionTypeId: 'dt-gone', rate: null, kind: 'retention_other' }, types).label, 'Retention head no longer in Settings · fixed amount');
});
