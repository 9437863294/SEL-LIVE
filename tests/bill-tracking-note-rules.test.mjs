import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveBillTotals, isHeldAsRetention } from '../src/lib/bill-tracking/calculations.ts';
import { certificationSummary, compareCertification } from '../src/lib/bill-tracking/certification.ts';
import { DEFAULT_DEDUCTION_TYPES } from '../src/lib/bill-tracking/defaults.ts';
import { computeDeductions } from '../src/lib/bill-tracking/gst.ts';
import { baseBesidesNote, invoiceWithNotes, normaliseNoteRules, noteDeductionBase, noteRuleFor, noteRulesProblem, ruleHeadsOf, withNoteFigures } from '../src/lib/bill-tracking/note-rules.ts';
import { billRetentionSlabs } from '../src/lib/bill-tracking/retention.ts';

const types = DEFAULT_DEDUCTION_TYPES;
const options = { tolerance: 1, roundNetToRupee: true };
const billTypes = [
  { id: 'bt-s60', name: 'SUPPLY-60%' },
  { id: 'bt-s70', name: 'SUPPLY-70%' },
  { id: 'bt-s100', name: 'SUPPLY' },
];
/** Debit notes against SUPPLY-60% and SUPPLY-70% invoices take both retention heads of the invoice plus its notes. */
const rule = { id: 'nr-1', name: 'Retention on the balance debit note', active: true, billTypeIds: ['bt-s60', 'bt-s70'], deductionTypeIds: ['dt-ret-inv', 'dt-ret-cpbg'], countInCertification: false };
const rules = [rule];

const invoice = (id, taxable, billTypeId, extra = {}) => ({ id, transactionType: 'invoice', billTypeId, billDate: '2026-06-01', taxableAmount: taxable, gstAmount: 0, deductions: [], ...extra });
/** A debit note against `against`, saved with `inputs` the way the server composes it. */
function debitNote(id, taxable, against, inputs, { notes = [], billDate = '2026-06-10', createdAt, extra = {}, noteRules = rules } = {}) {
  const base = noteDeductionBase(noteRules, { id, transactionType: 'debit_note', billDate, createdAt, taxableAmount: taxable, gstAmount: 0 }, against, notes, types);
  const deductions = computeDeductions(inputs, types, { taxable, gross: taxable, roundToRupee: true, gstType: 'none', invoiceBase: base });
  const ruleLines = deductions.some((line) => line.invoiceBase !== undefined);
  const record = { id, transactionType: 'debit_note', againstBillId: against.id, billDate, createdAt, taxableAmount: taxable, gstAmount: 0, deductions, collections: [], isDeleted: false, outsideCertification: base && ruleLines && !base.rule.countInCertification ? true : undefined, ...extra };
  return { ...record, ...deriveBillTotals(record, options) };
}
const retention = (rateInv, rateCpbg) => [
  { id: 'a', deductionTypeId: 'dt-ret-inv', percentage: rateInv },
  { id: 'b', deductionTypeId: 'dt-ret-cpbg', percentage: rateCpbg },
];
const slabsOf = (note, against) => billRetentionSlabs(note, types, against).map((entry) => [entry.slab.label, entry.held]);

test('a rule covers debit notes against invoices of its sub categories — not credit notes, other invoices or inactive rules', () => {
  assert.equal(noteRuleFor(rules, 'debit_note', { billTypeId: 'bt-s60' }), rule);
  assert.equal(noteRuleFor(rules, 'debit_note', { billTypeId: 'bt-s70' }), rule);
  assert.equal(noteRuleFor(rules, 'debit_note', { billTypeId: 'bt-s100' }), undefined);
  assert.equal(noteRuleFor(rules, 'credit_note', { billTypeId: 'bt-s60' }), undefined);
  assert.equal(noteRuleFor([{ ...rule, active: false }], 'debit_note', { billTypeId: 'bt-s60' }), undefined);
  assert.equal(noteRuleFor(rules, 'debit_note', null), undefined);
  assert.equal(noteRuleFor(undefined, 'debit_note', { billTypeId: 'bt-s60' }), undefined);
});

test('SUPPLY-70%: ₹700 + a ₹300 debit note holds 20% ₹200 and 10% ₹100 — nothing left to collect, held as retention', () => {
  const inv = invoice('inv', 700, 'bt-s70');
  const note = debitNote('dn', 300, inv, retention(20, 10));
  assert.deepEqual(note.deductions.map((line) => [line.amount, line.calculationBase, line.invoiceBase]), [
    [200, 1000, 1000],
    [100, 1000, 1000],
  ]);
  assert.deepEqual([note.retentionDeducted, note.netReceivable, note.paymentStatus], [300, 0, 'received']);
  assert.equal(isHeldAsRetention(note), true);
  assert.deepEqual(slabsOf(note, inv), [
    ['Retention Against CPBG @ 10%', 100],
    ['Retention Against Invoice @ 20%', 200],
  ]);
});

test('SUPPLY-60%: ₹600 + a ₹300 debit note holds 20% of ₹900 = ₹180 and 10% = ₹90; ₹30 is still to collect', () => {
  const inv = invoice('inv', 600, 'bt-s60');
  const note = debitNote('dn', 300, inv, retention(20, 10));
  assert.deepEqual(note.deductions.map((line) => line.amount), [180, 90]);
  assert.deepEqual([note.retentionDeducted, note.netReceivable, note.paymentStatus], [270, 30, 'not_received']);
  assert.equal(isHeldAsRetention(note), false);
  assert.deepEqual(slabsOf(note, inv), [
    ['Retention Against CPBG @ 10%', 90],
    ['Retention Against Invoice @ 20%', 180],
  ]);
});

test('amounts typed on such a note read against the invoice plus its notes: ₹180 is 20%, not 60% of the note', () => {
  const inv = invoice('inv', 600, 'bt-s60');
  const typed = [
    { id: 'a', deductionTypeId: 'dt-ret-inv', baseAmount: 180 },
    { id: 'b', deductionTypeId: 'dt-ret-cpbg', baseAmount: 90 },
  ];
  const note = debitNote('dn', 300, inv, typed);
  assert.deepEqual(note.deductions.map((line) => [line.amount, line.invoiceBase]), [
    [180, 900],
    [90, 900],
  ]);
  assert.deepEqual(slabsOf(note, inv), [
    ['Retention Against CPBG @ 10%', 90],
    ['Retention Against Invoice @ 20%', 180],
  ]);
  // Without a rule the same amounts read against the note alone — the slabs the rule puts right.
  const plain = debitNote('dn', 300, inv, typed, { noteRules: [] });
  assert.deepEqual(slabsOf(plain, inv), [
    ['Retention Against CPBG @ 30%', 90],
    ['Retention Against Invoice @ 60%', 180],
  ]);
});

test('a second balance note holds only what is still due: ₹600, then ₹200 and ₹100 notes, hold ₹270 in all', () => {
  const inv = invoice('inv', 600, 'bt-s60');
  const first = debitNote('dn1', 200, inv, retention(20, 10), { createdAt: '2026-06-10T09:00:00.000Z' });
  assert.deepEqual(first.deductions.map((line) => [line.amount, line.calculationBase, line.heldBefore]), [
    [160, 800, undefined],
    [80, 800, undefined],
  ]);
  const second = debitNote('dn2', 100, inv, retention(20, 10), { notes: [first], billDate: '2026-06-20', createdAt: '2026-06-20T09:00:00.000Z' });
  // 20% of ₹900 = ₹180 less ₹160 already held = ₹20; 10% of ₹900 = ₹90 less ₹80 = ₹10.
  assert.deepEqual(second.deductions.map((line) => [line.amount, line.calculationBase, line.heldBefore]), [
    [20, 900, 160],
    [10, 900, 80],
  ]);
  const slabs = [...slabsOf(first, inv), ...slabsOf(second, inv)].reduce((total, [label, held]) => ({ ...total, [label]: (total[label] ?? 0) + held }), {});
  assert.deepEqual(slabs, { 'Retention Against CPBG @ 10%': 90, 'Retention Against Invoice @ 20%': 180 });
  // Editing the first note later leaves it alone: the second was saved after it.
  const firstAgain = debitNote('dn1', 200, inv, retention(20, 10), { notes: [first, second], createdAt: '2026-06-10T09:00:00.000Z' });
  assert.deepEqual(firstAgain.deductions.map((line) => line.amount), [160, 80]);
});

test('retention the invoice itself holds at the same rate is not held again on its balance note', () => {
  const inv = invoice('inv', 600, 'bt-s60', {
    deductions: [{ id: 'r', deductionTypeId: 'dt-ret-cpbg', deductionTypeName: 'Retention Against CPBG', kind: 'retention_cpbg', amount: 60, percentage: 10 }],
  });
  const note = debitNote('dn', 300, inv, retention(20, 10));
  // 10% of ₹900 = ₹90, of which the invoice already holds ₹60.
  assert.deepEqual(note.deductions.map((line) => [line.amount, line.heldBefore]), [
    [180, undefined],
    [30, 60],
  ]);
});

test('heads the rule does not cover stay on the note, and one line can be taken of the note alone', () => {
  const inv = invoice('inv', 600, 'bt-s60');
  const note = debitNote('dn', 300, inv, [
    { id: 'a', deductionTypeId: 'dt-ret-inv', percentage: 20 },
    { id: 'b', deductionTypeId: 'dt-ret-cpbg', percentage: 10, ownBase: true },
    { id: 'c', deductionTypeId: 'dt-itds', percentage: 2 },
  ]);
  assert.deepEqual(
    note.deductions.map((line) => [line.deductionTypeId, line.amount, line.calculationBase, line.invoiceBase, line.ownBase]),
    [
      ['dt-ret-inv', 180, 900, 900, undefined],
      ['dt-ret-cpbg', 30, 300, undefined, true],
      ['dt-itds', 6, 300, undefined, undefined],
    ],
  );
});

test('a head taken on gross is taken of the invoice plus its notes, gross', () => {
  const grossTypes = types.map((type) => (type.id === 'dt-ret-inv' ? { ...type, percentBase: 'gross' } : type));
  const base = noteDeductionBase(rules, { transactionType: 'debit_note', billDate: '2026-06-10', taxableAmount: 300, gstAmount: 54 }, { billTypeId: 'bt-s70', taxableAmount: 700, gstAmount: 126 }, []);
  assert.deepEqual([base.taxable, base.gross], [1000, 1180]);
  const lines = computeDeductions([{ id: 'a', deductionTypeId: 'dt-ret-inv', percentage: 20 }, { id: 'b', deductionTypeId: 'dt-ret-cpbg', percentage: 10 }], grossTypes, { taxable: 300, gross: 354, roundToRupee: true, gstType: 'cgst-sgst', invoiceBase: base });
  assert.deepEqual(lines.map((line) => [line.amount, line.invoiceBase]), [
    [236, 1180],
    [100, 1000],
  ]);
});

test('the base counts the notes saved before this one and dated on or before it — never a deleted one, nor one saved later even if dated earlier', () => {
  const inv = { taxableAmount: 600, gstAmount: 108 };
  const notes = [
    { id: 'cn-early', transactionType: 'credit_note', billDate: '2026-06-05', taxableAmount: -20, gstAmount: -3.6 },
    { id: 'dn-same-before', transactionType: 'debit_note', billDate: '2026-06-10', createdAt: '2026-06-10T08:00:00.000Z', taxableAmount: 50, gstAmount: 9 },
    { id: 'dn-same-after', transactionType: 'debit_note', billDate: '2026-06-10', createdAt: '2026-06-10T12:00:00.000Z', taxableAmount: 70, gstAmount: 12.6 },
    { id: 'dn-later', transactionType: 'debit_note', billDate: '2026-07-01', taxableAmount: 100, gstAmount: 18 },
    { id: 'dn-deleted', transactionType: 'debit_note', billDate: '2026-06-01', taxableAmount: 999, gstAmount: 0, isDeleted: true },
    { id: 'dn', transactionType: 'debit_note', billDate: '2026-06-10', createdAt: '2026-06-10T10:00:00.000Z', taxableAmount: 1, gstAmount: 0 },
    // Dated before "dn" but saved after it: it never moves "dn"'s base.
    { id: 'cn-backdated', transactionType: 'credit_note', billDate: '2026-06-01', createdAt: '2026-06-20T09:00:00.000Z', taxableAmount: -40, gstAmount: -7.2 },
  ];
  // Editing "dn" (saved at 10:00): its own stored figures are replaced by the ones being saved.
  assert.deepEqual(invoiceWithNotes(inv, notes, { id: 'dn', billDate: '2026-06-10', createdAt: '2026-06-10T10:00:00.000Z', taxableAmount: 300, gstAmount: 54 }), { taxable: 930, gross: 1097.4 });
  // A new note counts every note already saved and dated on or before it.
  assert.deepEqual(invoiceWithNotes(inv, notes, { billDate: '2026-06-10', taxableAmount: 300, gstAmount: 54 }), { taxable: 961, gross: 1133.8 });
});

test('a rule line adds retention at its own rate, never shared over the rates the invoice holds', () => {
  const inv = invoice('inv', 600, 'bt-s60', {
    deductions: [{ id: 'r', deductionTypeId: 'dt-ret-inv', deductionTypeName: 'Retention Against Invoice', kind: 'retention_invoice', amount: 60, percentage: 10 }],
  });
  const note = debitNote('dn', 300, inv, [{ id: 'a', deductionTypeId: 'dt-ret-inv', baseAmount: 180 }]);
  assert.deepEqual(slabsOf(note, inv), [['Retention Against Invoice @ 20%', 180]]);
});

test('certification: a balance debit note is left out of the invoice’s check unless its rule counts it', () => {
  const certification = { certifiedDate: '2026-07-01', taxableAmount: 600, gstAmount: 0, grossAmount: 600, deductions: [], totalDeduction: 0, netAmount: 600, revision: 1 };
  const inv = { ...invoice('inv', 600, 'bt-s60', { grossAmount: 600, totalDeduction: 0, netReceivable: 600 }), certification };
  const outside = debitNote('dn', 300, inv, retention(20, 10));
  assert.equal(outside.outsideCertification, true);
  assert.equal(certificationSummary(inv, [outside], 1).state, 'matched');
  assert.equal(compareCertification(inv, [outside], 1).suggestedNote, null);

  const counted = debitNote('dn', 300, inv, retention(20, 10), { noteRules: [{ ...rule, countInCertification: true }] });
  assert.equal(counted.outsideCertification, undefined);
  const summary = certificationSummary(inv, [counted], 1);
  assert.deepEqual([summary.state, summary.pendingGross], ['adjustment_pending', -300]);
  assert.equal(compareCertification(inv, [counted], 1).suggestedNote?.transactionType, 'credit_note');
});

test('held as retention: nothing to collect, nothing received, retention held — and no override', () => {
  const held = { paymentStatus: 'received', netReceivable: 0, totalReceived: 0, retentionDeducted: 300 };
  assert.equal(isHeldAsRetention(held), true);
  // A net left within the tolerance (not rounded to the rupee) is still nothing to collect.
  assert.equal(isHeldAsRetention({ ...held, netReceivable: 0.4 }), true);
  assert.equal(isHeldAsRetention({ ...held, retentionDeducted: 0 }), false);
  assert.equal(isHeldAsRetention({ ...held, totalReceived: 10, paymentStatus: 'over_received' }), false);
  assert.equal(isHeldAsRetention({ ...held, paymentStatusOverride: { status: 'received', reason: 'x' } }), false);
  assert.equal(isHeldAsRetention({ ...held, netReceivable: 30, paymentStatus: 'not_received' }), false);
});

test('rules are checked: a name, sub categories and deductions each, and one active rule per sub category', () => {
  const deductionTypes = types;
  assert.equal(noteRulesProblem(rules, billTypes), null);
  assert.match(noteRulesProblem([{ ...rule, name: '  ' }], billTypes), /name/);
  assert.match(noteRulesProblem([{ ...rule, billTypeIds: [] }], billTypes), /sub categories/);
  assert.match(noteRulesProblem([{ ...rule, deductionTypeIds: [] }], billTypes), /deductions/);
  // A switched-off rule may wait half-made (deleting the sub category it named must not block Settings).
  assert.equal(noteRulesProblem([{ ...rule, active: false, billTypeIds: [], deductionTypeIds: [] }], billTypes), null);
  const second = { ...rule, id: 'nr-2', name: 'Another', billTypeIds: ['bt-s70'] };
  assert.match(noteRulesProblem([rule, second], billTypes), /SUPPLY-70% is in both/);
  assert.equal(noteRulesProblem([rule, { ...second, active: false }], billTypes), null);
  // Sub categories and heads no longer in Settings drop out; names are trimmed; ids kept once.
  assert.deepEqual(normaliseNoteRules([{ ...rule, name: ' Balance DN ', billTypeIds: ['bt-s60', 'gone', 'bt-s60'], deductionTypeIds: ['dt-ret-inv', 'dt-gone'] }], billTypes, deductionTypes), [
    { ...rule, name: 'Balance DN', billTypeIds: ['bt-s60'], deductionTypeIds: ['dt-ret-inv'] },
  ]);
});

test('a balance debit note certified for less takes its rule heads of the invoice plus the note as certified', () => {
  // ₹600 SUPPLY-60% + ₹300 debit note: 20% + 10% of ₹900. The client certifies the note at ₹250: of ₹850.
  const inv = invoice('inv', 600, 'bt-s60');
  const note = debitNote('dn', 300, inv, retention(20, 10), { createdAt: '2026-06-10T10:00:00.000Z' });
  assert.deepEqual(ruleHeadsOf(note), ['dt-ret-inv', 'dt-ret-cpbg']);
  const besides = baseBesidesNote(inv, [note], note, ruleHeadsOf(note), types);
  assert.deepEqual([besides.taxable, besides.gross, besides.held], [600, 600, {}]);
  // Raised figures give back the base the note was saved with.
  assert.deepEqual(withNoteFigures(besides, note).taxable, note.deductions[0].invoiceBase);
  const certified = computeDeductions(retention(20, 10), types, { taxable: 250, gross: 250, roundToRupee: true, gstType: 'none', invoiceBase: withNoteFigures(besides, { taxableAmount: 250, gstAmount: 0 }) });
  assert.deepEqual(certified.map((line) => [line.amount, line.invoiceBase]), [
    [170, 850],
    [85, 850],
  ]);
  // A second balance note counts what the first holds as certified, not as raised.
  const certifiedNote = { ...note, certification: { taxableAmount: 250, grossAmount: 250, deductions: certified } };
  const second = noteDeductionBase(rules, { id: 'dn2', transactionType: 'debit_note', billDate: '2026-06-20', taxableAmount: 100, gstAmount: 0 }, inv, [certifiedNote], types);
  assert.deepEqual([second.held['dt-ret-inv|20'], second.held['dt-ret-cpbg|10']], [170, 85]);
  // A note with no rule lines takes nothing of the invoice.
  assert.deepEqual(ruleHeadsOf({ deductions: [{ deductionTypeId: 'dt-tds', amount: 3 }] }), []);
});
