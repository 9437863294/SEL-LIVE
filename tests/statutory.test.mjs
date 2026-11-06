import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_STATUTORY,
  buildExpenseStatutory,
  checkGstin,
  computeStatutory,
  hasStatutory,
  isValidPan,
  requisitionStatutoryFields,
  statutoryErrors,
  statutoryInputFrom,
  suggestGstType,
  verificationTotals,
} from '../src/lib/statutory.ts';

const withInput = (patch) => ({ ...EMPTY_STATUTORY, ...patch });

test('GSTIN check digit, state and PAN', () => {
  const ok = checkGstin(' 27aapfu0939f1zv ');
  assert.equal(ok.valid, true);
  assert.equal(ok.stateName, 'Maharashtra');
  assert.equal(ok.pan, 'AAPFU0939F');
  assert.match(checkGstin('27AAPFU0939F1ZX').error, /last character/);
  assert.match(checkGstin('27AAPFU0939F1Z').error, /15 characters/);
  assert.match(checkGstin('25AAPFU0939F1ZV').error, /not a GST state code/);
  assert.equal(isValidPan('aapfu0939f'), true);
  assert.equal(isValidPan('AAPF0939F'), false);
});

test('intra-state suppliers take CGST + SGST, others IGST', () => {
  assert.equal(suggestGstType('21'), 'cgst-sgst');
  assert.equal(suggestGstType('27'), 'igst');
});

test('the breakdown down to net payable', () => {
  const t = computeStatutory(100000, withInput({ gstType: 'cgst-sgst', gstRate: 18, tdsSection: '194C-OTH', tdsRate: 2, retentionAmount: 5000 }));
  assert.equal(t.cgst, 9000);
  assert.equal(t.sgst, 9000);
  assert.equal(t.invoice, 118000);
  assert.equal(t.tds, 2000, 'TDS is on the value excluding GST');
  assert.equal(t.net, 111000);
});

test('reverse charge keeps GST off the supplier’s invoice', () => {
  const t = computeStatutory(50000, withInput({ gstType: 'igst', gstRate: 18, reverseCharge: true }));
  assert.equal(t.igst, 9000);
  assert.equal(t.invoice, 50000);
  assert.equal(t.net, 50000);
});

test('a typed TDS amount wins over the rate', () => {
  assert.equal(computeStatutory(10000, withInput({ tdsSection: '194J-PRO', tdsRate: 10, tdsOverride: 750 })).tds, 750);
});

test('what must be fixed before saving', () => {
  const errors = statutoryErrors(100000, withInput({ gstType: 'cgst-sgst', gstRate: 18, gstNo: '27AAPFU0939F1ZV' }));
  assert.match(errors.gstType, /outside Odisha/);
  assert.ok(errors.invoiceNo);
  assert.ok(errors.invoiceDate);
  assert.match(statutoryErrors(1000, withInput({ tdsSection: '194C-IND', tdsRate: 1 })).panNo, /valid PAN/);
  assert.match(statutoryErrors(1000, withInput({ otherDeduction: 100 })).otherDeductionReason, /what/);
  assert.match(statutoryErrors(1000, withInput({ retentionAmount: 2000 })).net, /more than/);
  assert.deepEqual(statutoryErrors(1000, EMPTY_STATUTORY), {});
});

test('nothing statutory entered means nothing stored', () => {
  assert.equal(hasStatutory(EMPTY_STATUTORY), false);
  assert.equal(hasStatutory(withInput({ retentionAmount: 1 })), true);
});

test('the stored record and what the requisition starts with', () => {
  const stored = buildExpenseStatutory(100000, withInput({ gstType: 'igst', gstRate: 18, gstNo: '27aapfu0939f1zv', invoiceNo: ' INV-9 ', invoiceDate: '2026-09-30', tdsSection: '194C-OTH', tdsRate: 2 }));
  assert.equal(stored.gstNo, '27AAPFU0939F1ZV');
  assert.equal(stored.panNo, 'AAPFU0939F', 'PAN is read from the GSTIN when not typed');
  assert.equal(stored.invoiceNo, 'INV-9');
  assert.equal(stored.netPayable, 116000);
  const fields = requisitionStatutoryFields(stored);
  assert.equal(fields.grossAmount, 100000);
  assert.equal(fields.netAmount, 116000);
  assert.equal(fields.igstAmount, 18000);
  assert.equal(fields.tdsAmount, 2000);
  assert.ok(Object.values(fields).every((v) => v !== undefined), 'Firestore rejects undefined');
});

test('TDS switched on needs a section', () => {
  assert.match(statutoryErrors(1000, withInput({ tdsSection: '', panNo: 'AAPFU0939F' })).tdsSection, /section/);
});

test('a stored statutory block reads back as complete inputs', () => {
  // What an earlier version of the form wrote: no tdsOverride, no hsnSac, numbers as text.
  const stored = {
    invoiceNo: 'INV-9',
    invoiceDate: '2026-09-30',
    gstType: 'igst',
    gstRate: '18',
    gstNo: '27AAPFU0939F1ZV',
    panNo: 'AAPFU0939F',
    reverseCharge: false,
    tdsSection: '194C-OTH',
    tdsRate: '2',
    retentionAmount: 500,
    taxableAmount: 100000,
    netPayable: 115500,
  };
  const input = statutoryInputFrom(stored);
  assert.ok(
    Object.values(input).every((value) => value !== undefined),
    'every input is present — buildExpenseStatutory spreads them straight into Firestore',
  );
  assert.equal(input.tdsOverride, null, 'a missing typed amount falls back to the rate, not to undefined');
  assert.equal(input.hsnSac, '');
  assert.equal(input.gstRate, 18, 'a rate stored as text still works out the GST');
  assert.equal(input.otherDeductionReason, '');

  // Nothing at all still gives a usable, empty set of inputs.
  assert.deepEqual(statutoryInputFrom(undefined), EMPTY_STATUTORY);
  assert.deepEqual(statutoryInputFrom({ gstType: 'nonsense', tdsSection: 'none', tdsRate: 5, gstRate: 18 }), EMPTY_STATUTORY);
});

test('a corrected amount reworks the figures that scale with it', () => {
  // The request was raised for 100000 with 18% IGST, 2% TDS and 500 retention; the amount is then
  // corrected to 90000 before it is received. GST and TDS move with it; the retention does not.
  const raised = buildExpenseStatutory(100000, withInput({
    gstType: 'igst',
    gstRate: 18,
    gstNo: '27AAPFU0939F1ZV',
    invoiceNo: 'INV-9',
    invoiceDate: '2026-09-30',
    tdsSection: '194C-OTH',
    tdsRate: 2,
    retentionAmount: 500,
  }));
  assert.equal(raised.netPayable, 115500);

  const corrected = buildExpenseStatutory(90000, statutoryInputFrom(raised));
  assert.equal(corrected.taxableAmount, 90000);
  assert.equal(corrected.igstAmount, 16200);
  assert.equal(corrected.tdsAmount, 1800);
  assert.equal(corrected.retentionAmount, 500, 'a deduction is an amount, not a rate');
  assert.equal(corrected.netPayable, 103900);
  assert.ok(
    Object.values(corrected).every((value) => value !== undefined),
    'Firestore rejects undefined, and this is written back onto the request',
  );

  // A typed TDS amount is kept as typed rather than silently rescaled.
  const typed = buildExpenseStatutory(90000, statutoryInputFrom({ ...raised, tdsOverride: 1500 }));
  assert.equal(typed.tdsAmount, 1500);
});

/* ── Daily Requisition verification: the gross may hold the GST ── */

const verifying = (patch) => ({
  gross: 55988, gstType: 'none', gstRate: 0, gstInclusive: true, reverseCharge: false,
  tdsRate: 0, tdsOverride: null, retentionRate: 0, retentionOverride: null, otherDeduction: 0, ...patch,
});

test('verification: GST inside the gross is worked back out of it; on top, it is added', () => {
  // No GST: the gross is the taxable value and, with nothing deducted, the net.
  assert.deepEqual(verificationTotals(verifying({})), { taxable: 55988, igst: 0, cgst: 0, sgst: 0, gst: 0, invoice: 55988, tds: 0, retention: 0, other: 0, net: 55988 });
  // 18% inside 1,18,000: taxable 1,00,000, the halves adding back to the gross exactly.
  const inside = verificationTotals(verifying({ gross: 118000, gstType: 'cgst-sgst', gstRate: 18 }));
  assert.deepEqual([inside.taxable, inside.cgst, inside.sgst, inside.invoice, inside.net], [100000, 9000, 9000, 118000, 118000]);
  const odd = verificationTotals(verifying({ gross: 55988, gstType: 'cgst-sgst', gstRate: 18 }));
  assert.equal(Math.round((odd.taxable + odd.cgst + odd.sgst) * 100) / 100, 55988);
  // On top: the same as an expense request works it out, to the paisa.
  const onTop = verificationTotals(verifying({ gross: 100000, gstType: 'igst', gstRate: 18, gstInclusive: false }));
  assert.deepEqual([onTop.taxable, onTop.igst, onTop.invoice], [100000, 18000, 118000]);
  const request = computeStatutory(12345.67, withInput({ gstType: 'cgst-sgst', gstRate: 18 }));
  const verified = verificationTotals(verifying({ gross: 12345.67, gstType: 'cgst-sgst', gstRate: 18, gstInclusive: false }));
  assert.deepEqual([verified.cgst, verified.sgst, verified.net], [request.cgst, request.sgst, request.net]);
  // Reverse charge: the supplier charges none, so nothing is inside the gross and nothing is added.
  const rcm = verificationTotals(verifying({ gross: 100000, gstType: 'igst', gstRate: 18, reverseCharge: true }));
  assert.deepEqual([rcm.taxable, rcm.igst, rcm.invoice], [100000, 18000, 100000]);
});

test('verification: TDS and retention on the taxable value, by rate or as typed', () => {
  const v = verificationTotals(verifying({ gross: 118000, gstType: 'igst', gstRate: 18, tdsRate: 2, retentionRate: 5, otherDeduction: 500 }));
  assert.deepEqual([v.tds, v.retention, v.other, v.net], [2000, 5000, 500, 110500]);
  const typed = verificationTotals(verifying({ gross: 118000, gstType: 'igst', gstRate: 18, tdsRate: 2, tdsOverride: 1999, retentionOverride: 0 }));
  assert.deepEqual([typed.tds, typed.retention, typed.net], [1999, 0, 116001]);
});
