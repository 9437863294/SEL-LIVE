import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveBillTotals, isPastApproval, nextWorkflowStatus } from '../src/lib/bill-tracking/calculations.ts';
import { canBeCertified, certificationSummary, certificationTotals, compareCertification, notesByInvoice, receiptBlockReason } from '../src/lib/bill-tracking/certification.ts';
import { DEFAULT_DEDUCTION_TYPES, withConfigDefaults } from '../src/lib/bill-tracking/defaults.ts';
import { computeDeductions, splitGst } from '../src/lib/bill-tracking/gst.ts';
import { exceptionItems } from '../src/lib/bill-tracking/reports.ts';

const types = DEFAULT_DEDUCTION_TYPES;
const options = { tolerance: 1, roundNetToRupee: true };

/** Figures the way the server composes them: GST split, deductions computed, totals derived. */
function figures({ taxable, gstType = 'cgst-sgst', rate = 18, gst, deductions = [] }) {
  const split = gst ?? splitGst(taxable, gstType, rate);
  const lines = computeDeductions(deductions, types, { taxable, gross: taxable + split.gstAmount, roundToRupee: true, gstType });
  const totals = deriveBillTotals({ taxableAmount: taxable, gstAmount: split.gstAmount, deductions: lines, collections: [] }, options);
  return {
    taxableAmount: taxable,
    gstType,
    gstPercent: rate,
    cgstRate: split.cgstRate,
    sgstRate: split.sgstRate,
    igstRate: split.igstRate,
    cgstAmount: split.cgstAmount,
    sgstAmount: split.sgstAmount,
    igstAmount: split.igstAmount,
    gstAmount: split.gstAmount,
    deductions: lines,
    grossAmount: totals.grossAmount,
    totalDeduction: totals.totalDeduction,
    netReceivable: totals.netReceivable,
  };
}

function bill(id, input, extra = {}) {
  return { id, transactionType: 'invoice', billDate: '2026-06-10', financialYear: '2026-27', projectId: 'p1', projectNameSnapshot: 'Project 1', billTypeName: 'Supply', billCategory: 'supply', isRetentionBill: false, collections: [], paymentStatus: 'not_received', outstandingAmount: 0, totalReceived: 0, workflowStatus: 'raised', source: 'manual', searchTokens: [], version: 1, isDeleted: false, gstInvoiceNumber: `INV-${id}`, ...figures(input), ...extra };
}

function certify(raised, input, extra = {}) {
  const certified = figures({ gstType: raised.gstType, rate: raised.gstPercent, ...input });
  return {
    ...raised,
    certification: {
      certifiedDate: '2026-07-01',
      reference: 'MB-14',
      taxableAmount: certified.taxableAmount,
      gstType: certified.gstType,
      gstPercent: certified.gstPercent,
      cgstAmount: certified.cgstAmount,
      sgstAmount: certified.sgstAmount,
      igstAmount: certified.igstAmount,
      gstAmount: certified.gstAmount,
      grossAmount: certified.grossAmount,
      deductions: certified.deductions,
      totalDeduction: certified.totalDeduction,
      netAmount: certified.netReceivable,
      revision: 1,
      recordedBy: 'u1',
      recordedAt: '2026-07-01T10:00:00.000Z',
      ...extra,
    },
  };
}

/** The note the comparison suggests, composed the way the bill form + server would save it. */
function noteFrom(invoice, suggestion, id = 'n1') {
  const lines = suggestion.deductions.map((line, index) => ({ id: `l${index}`, ...line }));
  return bill(
    id,
    { taxable: suggestion.taxableAmount, gstType: suggestion.gstType, rate: suggestion.gstPercent, gst: { gstAmount: suggestion.gstAmount, cgstAmount: suggestion.cgstAmount ?? 0, sgstAmount: suggestion.sgstAmount ?? 0, igstAmount: suggestion.igstAmount ?? 0 }, deductions: lines },
    { transactionType: suggestion.transactionType, againstBillId: invoice.id },
  );
}

const raisedDeductions = [
  { id: 'a', deductionTypeId: 'dt-itds', percentage: 2 },
  { id: 'b', deductionTypeId: 'dt-ret-inv', percentage: 5 },
];

test('a bill the client has not certified is awaiting certification', () => {
  const invoice = bill('b1', { taxable: 1000000, deductions: raisedDeductions });
  const summary = certificationSummary(invoice, [], 1);
  assert.equal(summary.state, 'not_certified');
  assert.equal(summary.certifiedNet, null);
  const comparison = compareCertification(invoice, [], 1);
  assert.equal(comparison.suggestedNote, null);
  assert.ok(comparison.lines.every((line) => line.certified === null && line.pending === null));
});

test('certified exactly as raised is matched with nothing to adjust', () => {
  const invoice = certify(bill('b1', { taxable: 1000000, deductions: raisedDeductions }), { taxable: 1000000, deductions: raisedDeductions });
  const comparison = compareCertification(invoice, [], 1);
  assert.equal(comparison.summary.state, 'matched');
  assert.equal(comparison.summary.variance, 0);
  assert.equal(comparison.suggestedNote, null);
});

test('a lower certificate with an extra penalty suggests the credit note that matches it', () => {
  const invoice = certify(bill('b1', { taxable: 1000000, deductions: raisedDeductions }), {
    taxable: 900000,
    deductions: [...raisedDeductions, { id: 'c', deductionTypeId: 'dt-other', baseAmount: 25000 }],
  });
  const comparison = compareCertification(invoice, [], 1);
  assert.equal(comparison.summary.state, 'adjustment_pending');
  // Raised: 10,00,000 + 1,80,000 GST − 20,000 TDS − 50,000 retention = 11,10,000.
  assert.equal(comparison.summary.raisedNet, 1110000);
  // Certified: 9,00,000 + 1,62,000 − 18,000 − 45,000 − 25,000 = 9,74,000.
  assert.equal(comparison.summary.certifiedNet, 974000);
  assert.equal(comparison.summary.variance, -136000);
  assert.equal(comparison.summary.pendingNet, -136000);

  const note = comparison.suggestedNote;
  assert.equal(note.transactionType, 'credit_note');
  assert.equal(note.taxableAmount, -100000);
  assert.equal(note.cgstAmount, -9000);
  assert.equal(note.sgstAmount, -9000);
  assert.equal(note.gstAmount, -18000);
  assert.equal(note.netAmount, -136000);
  const byType = Object.fromEntries(note.deductions.map((line) => [line.deductionTypeId, line.baseAmount]));
  assert.deepEqual(byType, { 'dt-itds': -2000, 'dt-ret-inv': -5000, 'dt-other': 25000 });
  assert.match(note.description, /MB-14/);

  // Raising exactly that note matches the certification on every line.
  const credit = noteFrom(invoice, note);
  const after = compareCertification(invoice, [credit], 1);
  assert.equal(after.summary.state, 'matched');
  assert.equal(after.summary.notesNet, -136000);
  assert.equal(after.summary.pendingNet, 0);
  assert.ok(after.lines.every((line) => line.matched), 'every line, deductions included');
  assert.equal(after.suggestedNote, null);
});

test('a partial credit note leaves the rest pending', () => {
  const invoice = certify(bill('b1', { taxable: 1000000 }), { taxable: 900000 });
  const half = bill('n1', { taxable: -50000 }, { transactionType: 'credit_note', againstBillId: 'b1' });
  const comparison = compareCertification(invoice, [half], 1);
  assert.equal(comparison.summary.state, 'adjustment_pending');
  assert.equal(comparison.summary.pendingNet, -59000);
  assert.equal(comparison.suggestedNote.taxableAmount, -50000);
  // A deleted note does not count.
  assert.equal(certificationSummary(invoice, [{ ...half, isDeleted: true }], 1).pendingNet, -118000);
});

test('a higher certificate suggests a debit note', () => {
  const invoice = certify(bill('b1', { taxable: 500000, gstType: 'igst' }), { taxable: 520000 });
  const note = compareCertification(invoice, [], 1).suggestedNote;
  assert.equal(note.transactionType, 'debit_note');
  assert.equal(note.taxableAmount, 20000);
  assert.equal(note.igstAmount, 3600);
  assert.equal(note.cgstAmount, undefined);
});

test('only deductions changed: a credit note with no invoice value, just the extra deduction', () => {
  const invoice = certify(bill('b1', { taxable: 1000000, deductions: raisedDeductions }), {
    taxable: 1000000,
    deductions: [...raisedDeductions, { id: 'c', deductionTypeId: 'dt-lccomm', baseAmount: 3000 }],
  });
  const note = compareCertification(invoice, [], 1).suggestedNote;
  assert.equal(note.transactionType, 'credit_note');
  assert.equal(note.taxableAmount, 0);
  assert.equal(note.gstAmount, 0);
  assert.deepEqual(note.deductions, [{ deductionTypeId: 'dt-lccomm', baseAmount: 3000 }]);
  assert.equal(note.netAmount, -3000);
});

test('an imported bill with one GST figure, certified as CGST + SGST, compares on the GST total and the note splits', () => {
  // Raised: imported, GST not split (₹19,53,783 on ₹1,08,54,349.90 — 18%).
  const unsplit = { gstType: undefined, cgstRate: undefined, sgstRate: undefined, igstRate: undefined, cgstAmount: undefined, sgstAmount: undefined, igstAmount: undefined, gstPercent: undefined };
  const raised = bill('b1', { taxable: 10854349.9, gst: { gstAmount: 1953783, cgstAmount: 0, sgstAmount: 0, igstAmount: 0 } }, unsplit);
  assert.equal(raised.gstType, undefined);

  // Certified the same, but split: no difference, and no CGST / SGST lines comparing against nothing.
  const same = certify(raised, { taxable: 10854349.9, gstType: 'cgst-sgst', rate: 18, gst: { gstAmount: 1953783, cgstAmount: 976891.5, sgstAmount: 976891.5, igstAmount: 0 } });
  const sameComparison = compareCertification(same, [], 1);
  assert.equal(sameComparison.summary.state, 'matched');
  assert.deepEqual(sameComparison.lines.filter((line) => line.group === 'amount').map((line) => line.key), ['taxable', 'gst']);

  // Certified lower: the note reverses the GST difference split CGST / SGST, like the certificate.
  const lower = certify(raised, { taxable: 10000000, gstType: 'cgst-sgst', rate: 18 });
  const note = compareCertification(lower, [], 1).suggestedNote;
  assert.equal(note.transactionType, 'credit_note');
  assert.equal(note.gstType, 'cgst-sgst');
  assert.equal(note.taxableAmount, -854349.9);
  assert.equal(note.gstAmount, -153783);
  assert.equal(note.cgstAmount, -76891.5);
  assert.equal(note.sgstAmount, -76891.5);
  const credit = noteFrom(lower, note);
  assert.equal(compareCertification(lower, [credit], 1).summary.state, 'matched');
});

test('differences within the amount tolerance still count as matched', () => {
  const invoice = certify(bill('b1', { taxable: 1000000 }), { taxable: 1000000 }, { netAmount: 1180000.6 });
  assert.equal(certificationSummary(invoice, [], 1).state, 'matched');
  assert.equal(certificationSummary(invoice, [], 0.5).state, 'adjustment_pending');
});

test('notes are never certified, and are grouped by the invoice they adjust', () => {
  const invoice = bill('b1', { taxable: 100 });
  const credit = bill('n1', { taxable: -10 }, { transactionType: 'credit_note', againstBillId: 'b1' });
  const deleted = bill('n2', { taxable: -10 }, { transactionType: 'credit_note', againstBillId: 'b1', isDeleted: true });
  const unlinked = bill('n3', { taxable: -10 }, { transactionType: 'credit_note' });
  assert.equal(canBeCertified(invoice), true);
  assert.equal(canBeCertified(credit), false);
  const map = notesByInvoice([invoice, credit, deleted, unlinked]);
  assert.deepEqual([...map.keys()], ['b1']);
  assert.deepEqual(map.get('b1').map((note) => note.id), ['n1']);
});

test('register totals compare the certified bills like for like', () => {
  const certified = certify(bill('b1', { taxable: 1000000 }), { taxable: 900000 });
  const awaiting = bill('b2', { taxable: 500000 });
  const totals = certificationTotals([certificationSummary(certified, [], 1), certificationSummary(awaiting, [], 1)]);
  assert.equal(totals.count, 2);
  assert.equal(totals.certified, 1);
  assert.equal(totals.awaiting, 1);
  assert.equal(totals.pending, 1);
  assert.equal(totals.raisedNet, 1180000 + 590000);
  assert.equal(totals.raisedNetCertified, 1180000);
  assert.equal(totals.certifiedNet, 1062000);
  assert.equal(totals.pendingNet, -118000);
});

test('no payment before certification: which bills a receipt is refused for', () => {
  const rule = { enabled: true, transactionTypes: ['invoice', 'retention_bill'], exemptImported: true };
  const invoice = bill('b1', { taxable: 100000 });
  assert.match(receiptBlockReason(invoice, rule), /not certified by the client/);
  assert.equal(receiptBlockReason(certify(invoice, { taxable: 100000 }), rule), null, 'certified — receipts allowed');
  assert.equal(receiptBlockReason(invoice, { ...rule, enabled: false }), null, 'rule off');
  assert.equal(receiptBlockReason({ ...invoice, transactionType: 'advance' }, rule), null, 'type not covered');
  assert.equal(receiptBlockReason({ ...invoice, transactionType: 'credit_note' }, rule), null, 'notes are never blocked');
  assert.equal(receiptBlockReason({ ...invoice, source: 'excel_import' }, rule), null, 'migrated bills exempt');
  assert.match(receiptBlockReason({ ...invoice, source: 'excel_import' }, { ...rule, exemptImported: false }), /not certified/);
  assert.equal(receiptBlockReason(invoice, { ...rule, fromDate: '2026-07-01' }), null, 'dated before the rule starts');
  assert.match(receiptBlockReason(invoice, { ...rule, fromDate: '2026-06-01' }), /not certified/);
  assert.equal(receiptBlockReason(invoice, undefined), null, 'no rule configured');
});

test('the workflow runs raised → certified → payment follow-up, and the rule defaults on', () => {
  assert.equal(nextWorkflowStatus('raised'), 'certified');
  assert.equal(nextWorkflowStatus('certified'), 'payment_followup');
  assert.ok(isPastApproval('certified'));
  const fresh = withConfigDefaults(null).settings.certificationBeforeReceipt;
  assert.deepEqual(fresh, { enabled: true, transactionTypes: ['invoice', 'retention_bill'], exemptImported: true });
  // A configuration saved before the rule existed gets it; a saved choice is kept.
  assert.equal(withConfigDefaults({ settings: { tolerance: 5 } }).settings.certificationBeforeReceipt.enabled, true);
  assert.equal(withConfigDefaults({ settings: { certificationBeforeReceipt: { enabled: false } } }).settings.certificationBeforeReceipt.enabled, false);
  assert.deepEqual(withConfigDefaults({ settings: { certificationBeforeReceipt: { enabled: false } } }).settings.certificationBeforeReceipt.transactionTypes, ['invoice', 'retention_bill']);
});

test('a certified bill whose notes do not match is an exception', () => {
  const invoice = certify(bill('b1', { taxable: 1000000 }), { taxable: 900000 });
  const context = { asOf: '2026-07-05', settings: { tolerance: 1, ageingBuckets: [{ from: 0, to: null, label: 'All' }], defaultAgeingBasis: 'billDate', noFollowUpDays: 9999, oldOutstandingDays: 9999, highValueThreshold: 1e12 } };
  const pending = exceptionItems([invoice], context, new Map()).filter((item) => item.kind === 'certification_note_pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].amount, -118000);
  // Without the notes loaded the rule stays silent rather than guess.
  assert.equal(exceptionItems([invoice], context).filter((item) => item.kind === 'certification_note_pending').length, 0);
  const credit = noteFrom(invoice, compareCertification(invoice, [], 1).suggestedNote);
  assert.equal(exceptionItems([invoice], context, new Map([['b1', [credit]]])).filter((item) => item.kind === 'certification_note_pending').length, 0);
});
