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
