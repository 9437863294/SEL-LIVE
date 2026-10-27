import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveBillTotals, isPastApproval, nextWorkflowStatus } from '../src/lib/bill-tracking/calculations.ts';
import { canBeCertified, certificationSummary, certificationTotals, compareCertification, notesByInvoice, receiptBlockReason } from '../src/lib/bill-tracking/certification.ts';
import { DEFAULT_DEDUCTION_TYPES, withConfigDefaults } from '../src/lib/bill-tracking/defaults.ts';
import { computeDeductions, splitGst } from '../src/lib/bill-tracking/gst.ts';
import { subtractMoney, sumMoney } from '../src/lib/bill-tracking/money.ts';
import { exceptionItems } from '../src/lib/bill-tracking/reports.ts';

const types = DEFAULT_DEDUCTION_TYPES;
const options = { tolerance: 1, roundNetToRupee: true };

/** A bill's stored totals, derived the way the server writes them — with its certification, once recorded. */
const stored = (record) => ({ ...record, ...deriveBillTotals(record, options) });

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
  return stored({ id, transactionType: 'invoice', billDate: '2026-06-10', financialYear: '2026-27', projectId: 'p1', projectNameSnapshot: 'Project 1', billTypeName: 'Supply', billCategory: 'supply', isRetentionBill: false, collections: [], paymentStatus: 'not_received', outstandingAmount: 0, totalReceived: 0, workflowStatus: 'raised', source: 'manual', searchTokens: [], version: 1, isDeleted: false, gstInvoiceNumber: `INV-${id}`, ...figures(input), ...extra });
}

/** Records the client's certification on a bill; its totals are re-derived, as the server does on recording it. */
function certify(raised, input, extra = {}) {
  const certified = figures({ gstType: raised.gstType, rate: raised.gstPercent, ...input });
  return stored({
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
  });
}

/** The note the comparison suggests, composed the way the bill form + server would save it: taxable and GST, no deductions. */
function noteFrom(invoice, suggestion, id = 'n1') {
  return bill(
    id,
    { taxable: suggestion.taxableAmount, gstType: suggestion.gstType, rate: suggestion.gstPercent, gst: { gstAmount: suggestion.gstAmount, cgstAmount: suggestion.cgstAmount ?? 0, sgstAmount: suggestion.sgstAmount ?? 0, igstAmount: suggestion.igstAmount ?? 0 } },
    { transactionType: suggestion.transactionType, againstBillId: invoice.id },
  );
}

/** A credit note against b1 entered by hand, with deduction lines of its own (as the old rule suggested them). */
const creditWithDeductions = (id, taxable, deductions) => bill(id, { taxable, deductions }, { transactionType: 'credit_note', againstBillId: 'b1' });

const penalty = { id: 'c', deductionTypeId: 'dt-other', baseAmount: 25000 };

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
  assert.equal(comparison.summary.deductionChange, 0);
  assert.equal(comparison.suggestedNote, null);
  assert.equal(invoice.netReceivable, invoice.raisedNetReceivable);
});

test('a lower certificate with an extra penalty: the penalty applies through the certification, the credit note is taxable + GST only', () => {
  const invoice = certify(bill('b1', { taxable: 1000000, deductions: raisedDeductions }), { taxable: 900000, deductions: [...raisedDeductions, penalty] });
  // Paid against the certified deductions now: 11,80,000 − (18,000 + 45,000 + 25,000). The raised figures stay beside them.
  assert.deepEqual([invoice.totalDeduction, invoice.netReceivable, invoice.outstandingAmount], [88000, 1092000, 1092000]);
  assert.deepEqual([invoice.raisedTotalDeduction, invoice.raisedNetReceivable], [70000, 1110000]);

  const comparison = compareCertification(invoice, [], 1);
  assert.equal(comparison.summary.state, 'adjustment_pending');
  // Raised: 10,00,000 + 1,80,000 GST − 20,000 TDS − 50,000 retention = 11,10,000.
  assert.equal(comparison.summary.raisedNet, 1110000);
  // Certified: 9,00,000 + 1,62,000 − 18,000 − 45,000 − 25,000 = 9,74,000.
  assert.equal(comparison.summary.certifiedNet, 974000);
  assert.equal(comparison.summary.variance, -136000);
  // Of that change, 18,000 more deducted — applied by the certification itself, no note …
  assert.equal(comparison.summary.deductionChange, 18000);
  // … and 1,18,000 of invoice value (1,00,000 taxable + 18,000 GST), which takes a credit note.
  assert.equal(comparison.summary.pendingGross, -118000);
  assert.equal(comparison.summary.pendingNet, -118000);

  const note = comparison.suggestedNote;
  assert.equal(note.transactionType, 'credit_note');
  assert.equal(note.taxableAmount, -100000);
  assert.equal(note.cgstAmount, -9000);
  assert.equal(note.sgstAmount, -9000);
  assert.equal(note.gstAmount, -18000);
  assert.equal(note.netAmount, -118000);
  assert.equal('deductions' in note, false, 'a note to match a certification carries no deduction lines');
  assert.match(note.description, /MB-14/);

  // Raising exactly that note matches: the bill and its note are now paid what the client certified.
  const credit = noteFrom(invoice, note);
  assert.equal(credit.netReceivable, -118000);
  assert.equal(sumMoney([invoice.netReceivable, credit.netReceivable]), 974000);
  const after = compareCertification(invoice, [credit], 1);
  assert.equal(after.summary.state, 'matched');
  assert.equal(after.summary.notesNet, -118000);
  assert.equal(after.summary.pendingGross, 0);
  assert.equal(after.summary.pendingNet, 0);
  assert.ok(after.lines.every((line) => line.matched), 'every line, the net included');
  assert.equal(after.suggestedNote, null);
});

test('the invoice value is settled by a note; the deductions by the certification itself', () => {
  const invoice = certify(bill('b1', { taxable: 1000000, deductions: raisedDeductions }), { taxable: 900000, deductions: [...raisedDeductions, penalty] });
  const lines = Object.fromEntries(compareCertification(invoice, [], 1).lines.map((line) => [line.key, line]));
  assert.deepEqual(Object.keys(lines), ['taxable', 'cgst', 'sgst', 'gst', 'gross', 'deduction:dt-itds', 'deduction:dt-ret-inv', 'deduction:dt-other', 'totalDeduction', 'net']);
  for (const key of ['taxable', 'cgst', 'sgst', 'gst', 'gross', 'net']) assert.equal(lines[key].settledBy, 'note', key);
  for (const key of ['deduction:dt-itds', 'deduction:dt-ret-inv', 'deduction:dt-other', 'totalDeduction']) {
    assert.equal(lines[key].settledBy, 'certification', key);
    assert.equal(lines[key].pending, null, key);
    assert.equal(lines[key].matched, true, key);
  }
  // Deductions are still shown raised vs certified.
  const pick = (line) => [line.raised, line.notes, line.certified, line.difference, line.pending];
  assert.deepEqual(pick(lines['deduction:dt-other']), [0, 0, 25000, 25000, null]);
  assert.deepEqual(pick(lines['deduction:dt-itds']), [20000, 0, 18000, -2000, null]);
  assert.deepEqual(pick(lines.totalDeduction), [70000, 0, 88000, 18000, null]);
  assert.deepEqual(pick(lines.taxable), [1000000, 0, 900000, -100000, -100000]);
  assert.deepEqual(pick(lines.gross), [1180000, 0, 1062000, -118000, -118000]);
  assert.equal(lines.taxable.matched, false);
  // The net compares as raised, while what is pending is measured from what the bill is now paid.
  assert.deepEqual(pick(lines.net), [1110000, 0, 974000, -136000, -118000]);

  // Before the client certifies, nothing is certified, different or pending on any line.
  const uncertified = compareCertification(bill('b2', { taxable: 1000000, deductions: raisedDeductions }), [], 1);
  assert.ok(uncertified.lines.every((line) => line.certified === null && line.difference === null && line.pending === null && line.matched));
});

test('a partial credit note leaves the rest pending', () => {
  const invoice = certify(bill('b1', { taxable: 1000000 }), { taxable: 900000 });
  const half = bill('n1', { taxable: -50000 }, { transactionType: 'credit_note', againstBillId: 'b1' });
  const comparison = compareCertification(invoice, [half], 1);
  assert.equal(comparison.summary.state, 'adjustment_pending');
  assert.equal(comparison.summary.pendingGross, -59000);
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

test('only deductions changed: matched, no note — the bill is simply paid less', () => {
  const invoice = certify(bill('b1', { taxable: 1000000, deductions: raisedDeductions }), {
    taxable: 1000000,
    deductions: [...raisedDeductions, { id: 'c', deductionTypeId: 'dt-lccomm', baseAmount: 3000 }],
  });
  const comparison = compareCertification(invoice, [], 1);
  assert.equal(comparison.summary.state, 'matched');
  assert.equal(comparison.suggestedNote, null);
  assert.equal(comparison.summary.deductionChange, 3000);
  assert.equal(comparison.summary.variance, -3000);
  assert.equal(comparison.summary.pendingGross, 0);
  assert.equal(comparison.summary.pendingNet, 0);
  assert.ok(comparison.lines.every((line) => line.matched));
  // The receivable already is the certified net, 11,80,000 − 73,000, so receiving it settles the bill.
  assert.equal(invoice.netReceivable, 1107000);
  assert.equal(invoice.netReceivable, comparison.summary.certifiedNet);
  const paid = stored({ ...invoice, collections: [{ collectionId: 'c1', receiptDate: '2026-07-10', amount: 1107000, status: 'verified' }] });
  assert.deepEqual([paid.paymentStatus, paid.outstandingAmount], ['received', 0]);
  assert.equal(stored({ ...paid, certification: undefined }).paymentStatus, 'partially_received', 'against the raised deductions it would be 3,000 short');

  // Fewer deductions certified (the client waives the retention) go the other way: a negative change, a higher net.
  const waived = certify(bill('b2', { taxable: 1000000, deductions: raisedDeductions }), { taxable: 1000000, deductions: [raisedDeductions[0]] });
  const summary = certificationSummary(waived, [], 1);
  assert.deepEqual([summary.state, summary.deductionChange, summary.variance], ['matched', -50000, 50000]);
  assert.equal(waived.netReceivable, 1160000);
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
  assert.equal(note.netAmount, -1008132.9);
  const credit = noteFrom(lower, note);
  assert.equal(compareCertification(lower, [credit], 1).summary.state, 'matched');
  assert.equal(compareCertification(lower, [credit], 1).summary.pendingGross, 0);
  // Each net rounds to the rupee, and the bill and its note still come to exactly the certified net.
  assert.deepEqual([lower.netReceivable, credit.netReceivable], [12808133, -1008133]);
  assert.equal(sumMoney([lower.netReceivable, credit.netReceivable]), lower.certification.netAmount);
});

test('the taxable and the GST decide the match, within the amount tolerance; the net alone never does', () => {
  // The client's GST is 60 paise off the raised GST.
  const gstOff = certify(bill('b1', { taxable: 1000000 }), { taxable: 1000000, gst: { gstAmount: 180000.6, cgstAmount: 90000.3, sgstAmount: 90000.3, igstAmount: 0 } });
  assert.equal(certificationSummary(gstOff, [], 1).state, 'matched');
  assert.equal(certificationSummary(gstOff, [], 0.5).state, 'adjustment_pending');
  // Beyond the tolerance the note is just those paise of GST: a debit note with no taxable.
  const note = compareCertification(gstOff, [], 0.5).suggestedNote;
  assert.deepEqual([note.transactionType, note.taxableAmount, note.cgstAmount, note.sgstAmount, note.gstAmount, note.netAmount], ['debit_note', 0, 0.3, 0.3, 0.6, 0.6]);
  // A taxable off by as little counts the same way.
  const taxableOff = certify(bill('b2', { taxable: 1000000 }), { taxable: 1000000.4, gst: { gstAmount: 180000, cgstAmount: 90000, sgstAmount: 90000, igstAmount: 0 } });
  assert.equal(certificationSummary(taxableOff, [], 1).state, 'matched');
  assert.equal(certificationSummary(taxableOff, [], 0.25).state, 'adjustment_pending');
  // A certified net that differs only by its rupee rounding is no difference, even with no tolerance at all.
  const rounded = certify(bill('b3', { taxable: 1000000 }), { taxable: 1000000 }, { netAmount: 1180000.6 });
  const summary = certificationSummary(rounded, [], 0);
  assert.deepEqual([summary.state, summary.pendingGross, summary.pendingNet, summary.variance], ['matched', 0, 0, 0.6]);
});

test('a note that deducts besides the certification: matched on the invoice value, its deduction left in the net to adjust', () => {
  const invoice = certify(bill('b1', { taxable: 1000000, deductions: raisedDeductions }), { taxable: 900000, deductions: [...raisedDeductions, penalty] });
  // A credit note as the old rule suggested it: the invoice value, and every deduction the client changed.
  const old = creditWithDeductions('n1', -100000, [
    { id: 'a', deductionTypeId: 'dt-itds', baseAmount: -2000 },
    { id: 'b', deductionTypeId: 'dt-ret-inv', baseAmount: -5000 },
    { id: 'c', deductionTypeId: 'dt-other', baseAmount: 25000 },
  ]);
  assert.deepEqual([old.grossAmount, old.totalDeduction, old.netReceivable], [-118000, 18000, -136000]);
  const comparison = compareCertification(invoice, [old], 1);
  assert.equal(comparison.summary.state, 'matched', 'the taxable and the GST match');
  assert.equal(comparison.suggestedNote, null, 'no note settles a deduction');
  assert.equal(comparison.summary.pendingGross, 0);
  // Its 18,000 comes off on top of the certified deductions: the books hold 9,56,000 against a certified 9,74,000.
  assert.equal(sumMoney([invoice.netReceivable, old.netReceivable]), 956000);
  assert.equal(comparison.summary.pendingNet, 18000);
  const byKey = Object.fromEntries(comparison.lines.map((line) => [line.key, line]));
  assert.deepEqual([byKey.net.pending, byKey.net.matched], [18000, false]);
  // The note's lines show in the notes column, settled by the certification like every deduction.
  assert.deepEqual([byKey['deduction:dt-other'].raised, byKey['deduction:dt-other'].notes, byKey['deduction:dt-other'].certified, byKey['deduction:dt-other'].matched], [0, 25000, 25000, true]);
  assert.equal(byKey.totalDeduction.notes, 18000);

  // A partial note reversing some TDS: the note still to raise is the gross; the net also carries that reversal.
  const partial = creditWithDeductions('n2', -50000, [{ id: 'a', deductionTypeId: 'dt-itds', baseAmount: -1000 }]);
  assert.equal(partial.netReceivable, -58000);
  const summary = certificationSummary(invoice, [partial], 1);
  assert.deepEqual([summary.state, summary.pendingGross, summary.pendingNet], ['adjustment_pending', -59000, -60000]);
  assert.equal(subtractMoney(summary.certifiedNet, sumMoney([invoice.netReceivable, partial.netReceivable])), summary.pendingNet, 'what the books still have to move');
  assert.equal(compareCertification(invoice, [partial], 1).suggestedNote.netAmount, -59000);
});

test('a bill stored before the raised totals were kept compares the same', () => {
  const invoice = certify(bill('b1', { taxable: 1000000, deductions: raisedDeductions }), { taxable: 900000, deductions: [...raisedDeductions, penalty] });
  // Until 27-Oct-2026 the stored totals were always the raised ones, and there were no raised fields.
  const legacy = { ...invoice, totalDeduction: invoice.raisedTotalDeduction, netReceivable: invoice.raisedNetReceivable };
  delete legacy.raisedTotalDeduction;
  delete legacy.raisedNetReceivable;
  assert.deepEqual(certificationSummary(legacy, [], 1), certificationSummary(invoice, [], 1));
  assert.deepEqual(compareCertification(legacy, [], 1), compareCertification(invoice, [], 1));
  // Re-derived, it gets the effective totals and the raised ones beside them.
  assert.deepEqual([stored(legacy).netReceivable, stored(legacy).raisedNetReceivable], [1092000, 1110000]);
});

test('a certification stored with a figure missing reads as a difference, never as matched', () => {
  const invoice = certify(bill('b1', { taxable: 1000000 }), { taxable: 1000000 });
  const broken = { ...invoice, certification: { ...invoice.certification, taxableAmount: null, grossAmount: null } };
  const summary = certificationSummary(broken, [], 1);
  assert.equal(summary.state, 'adjustment_pending');
  assert.equal(summary.pendingGross, -1180000);
  const taxable = compareCertification(broken, [], 1).lines.find((line) => line.key === 'taxable');
  assert.deepEqual([taxable.pending, taxable.matched], [-1000000, false]);
});

test('a rate correction moving the taxable and the GST opposite ways: the note follows its gross', () => {
  // Raised at 12% IGST: 10,00,000 + 1,20,000.
  const raised = bill('b1', { taxable: 1000000, gstType: 'igst', rate: 12 });
  // Certified lower at 18%: −1,00,000 taxable, +42,000 IGST. The receivable goes down — a credit note.
  const down = compareCertification(certify(raised, { taxable: 900000, rate: 18 }), [], 1).suggestedNote;
  assert.deepEqual([down.transactionType, down.taxableAmount, down.igstAmount, down.netAmount], ['credit_note', -100000, 42000, -58000]);
  // −50,000 taxable, +51,000 IGST. The receivable goes up — a debit note, so a credit note never carries a positive net.
  const up = compareCertification(certify(raised, { taxable: 950000, rate: 18 }), [], 1).suggestedNote;
  assert.deepEqual([up.transactionType, up.taxableAmount, up.igstAmount, up.netAmount], ['debit_note', -50000, 51000, 1000]);
  // A nil gross follows the taxable.
  const even = compareCertification(certify(raised, { taxable: 960000, gst: { gstAmount: 160000, cgstAmount: 0, sgstAmount: 0, igstAmount: 160000 } }), [], 1).suggestedNote;
  assert.deepEqual([even.transactionType, even.taxableAmount, even.igstAmount, even.netAmount], ['credit_note', -40000, 40000, 0]);
});

test('certified at nil: the whole invoice value takes a credit note; the deductions go with the certification', () => {
  const invoice = certify(bill('b1', { taxable: 1000000, deductions: raisedDeductions }), { taxable: 0 });
  // No deductions certified, so none apply: the invoice value stays receivable until the note.
  assert.equal(invoice.netReceivable, 1180000);
  const comparison = compareCertification(invoice, [], 1);
  assert.deepEqual([comparison.summary.deductionChange, comparison.summary.pendingGross], [-70000, -1180000]);
  const note = comparison.suggestedNote;
  assert.deepEqual([note.transactionType, note.taxableAmount, note.gstAmount, note.netAmount], ['credit_note', -1000000, -180000, -1180000]);
  const credit = noteFrom(invoice, note);
  assert.equal(sumMoney([invoice.netReceivable, credit.netReceivable]), 0);
  assert.equal(compareCertification(invoice, [credit], 1).summary.state, 'matched');
});

test('a retention bill certified for a smaller release: matched, and the receivable is the certified release', () => {
  // A retention bill claims released retention as a negative deduction (the legacy layout): net = 0 − (−3,00,000).
  const claim = (amount) => [{ id: 'r', deductionTypeId: 'dt-ret-inv', baseAmount: amount }];
  const retention = bill('r1', { taxable: 0, deductions: claim(-300000) }, { transactionType: 'retention_bill', isRetentionBill: true });
  assert.equal(canBeCertified(retention), true);
  assert.equal(retention.netReceivable, 300000);
  const certified = certify(retention, { taxable: 0, deductions: claim(-250000) });
  const summary = certificationSummary(certified, [], 1);
  assert.equal(summary.state, 'matched', 'no invoice value changed — no note');
  assert.equal(summary.deductionChange, 50000);
  assert.equal(compareCertification(certified, [], 1).suggestedNote, null);
  assert.deepEqual([certified.netReceivable, certified.retentionDeducted, certified.raisedNetReceivable], [250000, -250000, 300000]);
});

test('the raised bill edited after certification: its figures move, the certified deductions still apply', () => {
  const invoice = certify(bill('b1', { taxable: 1000000, deductions: raisedDeductions }), { taxable: 900000, deductions: raisedDeductions });
  // 11,80,000 less the certified 18,000 + 45,000.
  assert.equal(invoice.netReceivable, 1117000);
  // Raised deductions retyped: the net does not move, only the raised figures and the change the client made.
  const retyped = stored({ ...invoice, deductions: figures({ taxable: 1000000, deductions: [raisedDeductions[0]] }).deductions });
  assert.deepEqual([retyped.netReceivable, retyped.raisedTotalDeduction, retyped.raisedNetReceivable], [1117000, 20000, 1160000]);
  assert.equal(certificationSummary(retyped, [], 1).deductionChange, 43000);
  // Raised taxable corrected towards the certificate: less invoice value is left for the note.
  const corrected = stored({ ...invoice, ...figures({ taxable: 950000, deductions: raisedDeductions }) });
  assert.equal(corrected.certification, invoice.certification);
  assert.equal(corrected.netReceivable, 1121000 - 63000);
  assert.equal(certificationSummary(corrected, [], 1).pendingGross, -59000);
  assert.equal(compareCertification(corrected, [], 1).suggestedNote.taxableAmount, -50000);
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
  assert.equal(totals.pendingGross, -118000);
});

test('register totals keep the notes to raise apart from the deductions the client changed', () => {
  const lower = certify(bill('b1', { taxable: 1000000 }), { taxable: 900000 });
  const penalised = certify(bill('b2', { taxable: 1000000, deductions: raisedDeductions }), { taxable: 1000000, deductions: [...raisedDeductions, penalty] });
  const totals = certificationTotals([certificationSummary(lower, [], 1), certificationSummary(penalised, [], 1)]);
  assert.deepEqual([totals.matched, totals.pending], [1, 1]);
  // The client's change, −1,43,000: 1,18,000 of invoice value to credit, 25,000 more deducted.
  assert.equal(totals.variance, -143000);
  assert.equal(totals.pendingGross, -118000);
  assert.equal(totals.deductionChange, 25000);
  assert.equal(totals.pendingNet, -118000);
});

test('the notes to raise leave out a matched bill’s leftover within the tolerance', () => {
  const nearly = certificationSummary(certify(bill('b1', { taxable: 1000000 }), { taxable: 1000000.5 }), [], 1);
  assert.equal(nearly.state, 'matched');
  assert.notEqual(nearly.pendingGross, 0, 'a few paise are left over…');
  const totals = certificationTotals([nearly, certificationSummary(certify(bill('b2', { taxable: 1000000 }), { taxable: 900000 }), [], 1)]);
  assert.equal(totals.pendingGross, -118000, '…but no note will be raised for them');
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

test('a certified bill whose invoice value is still off is an exception; a change of deductions alone is not', () => {
  const invoice = certify(bill('b1', { taxable: 1000000 }), { taxable: 900000 });
  const context = { asOf: '2026-07-05', settings: { tolerance: 1, ageingBuckets: [{ from: 0, to: null, label: 'All' }], defaultAgeingBasis: 'billDate', noFollowUpDays: 9999, oldOutstandingDays: 9999, highValueThreshold: 1e12 } };
  const notePending = (bills, notes) => exceptionItems(bills, context, notes).filter((item) => item.kind === 'certification_note_pending');
  const pending = notePending([invoice], new Map());
  assert.equal(pending.length, 1);
  assert.equal(pending[0].amount, -118000);
  assert.equal(pending[0].detail, 'Certified taxable + GST 1062000 vs raised 1180000');
  // Without the notes loaded the rule stays silent rather than guess.
  assert.equal(notePending([invoice]).length, 0);
  const credit = noteFrom(invoice, compareCertification(invoice, [], 1).suggestedNote);
  assert.equal(notePending([invoice], new Map([['b1', [credit]]])).length, 0);

  // Only the deductions changed: nothing to raise, nothing flagged.
  const penalised = certify(bill('b2', { taxable: 1000000, deductions: raisedDeductions }), { taxable: 1000000, deductions: [...raisedDeductions, penalty] });
  assert.equal(notePending([penalised], new Map()).length, 0);

  // The amount is the note still to raise: a partial note's own TDS reversal is no part of it.
  const partial = creditWithDeductions('n1', -50000, [{ id: 'a', deductionTypeId: 'dt-itds', baseAmount: -1000 }]);
  const [left] = notePending([invoice], new Map([['b1', [partial]]]));
  assert.equal(left.amount, -59000);
  assert.equal(left.detail, 'Certified taxable + GST 1062000 vs raised 1180000 and 1 note(s)');
});
