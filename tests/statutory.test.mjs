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
