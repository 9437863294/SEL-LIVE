import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ageingBucketOf,
  billLedger,
  computePaymentStatus,
  daysBetween,
  deriveBillTotals,
  financialYearMonths,
  financialYearOf,
  isoWeekOf,
  isoWeekRange,
  legacyStatusMismatch,
  normaliseWeekKey,
  outstandingAsOf,
  resubmitTarget,
  roundToRupee,
  validateAgeingBuckets,
  DEFAULT_AGEING_BUCKETS,
} from '../src/lib/bill-tracking/calculations.ts';
import { formatINR, formatINRCompact, sumMoney } from '../src/lib/bill-tracking/money.ts';

const deduction = (kind, amount, id = kind) => ({ id, deductionTypeId: id, deductionTypeName: kind, kind, amount });
const receipt = (amount, receiptDate = '2026-04-10', status = 'verified', id = `c-${amount}-${receiptDate}`) => ({ collectionId: id, receiptDate, amount, status });
const options = { tolerance: 1, roundNetToRupee: true };

/* ── money ───────────────────────────────────────────────────────────────── */

test('sums in paise so float dust never appears', () => {
  assert.equal(sumMoney([0.1, 0.2]), 0.3);
  assert.equal(sumMoney(Array.from({ length: 1000 }, () => 0.01)), 10);
});

test('formats Indian currency, full and compact', () => {
  assert.equal(formatINR(12500000), '₹1,25,00,000');
  assert.equal(formatINR(-125000), '-₹1,25,000');
  assert.equal(formatINR(1688145.42), '₹16,88,145.42');
  assert.equal(formatINRCompact(124300000), '₹12.43 Cr');
  assert.equal(formatINRCompact(7625000), '₹76.25 L');
  assert.equal(formatINRCompact(85430), '₹85,430');
});

/* ── bill totals ─────────────────────────────────────────────────────────── */

test('gross, deductions and net for a normal bill (legacy row 5)', () => {
  const totals = deriveBillTotals(
    {
      taxableAmount: 1688145.42,
      gstAmount: 303866,
      deductions: [deduction('statutory', 19920, 'a'), deduction('statutory', 33763, 'b'), deduction('statutory', 16881.5, 'c'), deduction('statutory', 16881.5, 'd'), deduction('retention_invoice', 168815)],
      collections: [],
    },
    options,
  );
  assert.equal(totals.grossAmount, 1992011.42);
  assert.equal(totals.totalDeduction, 256261);
  assert.equal(totals.statutoryDeduction, 87446);
  assert.equal(totals.retentionDeducted, 168815);
  // Sheet: ROUND(I+J−V, 0) = 1735750
  assert.equal(totals.netReceivable, 1735750);
  assert.equal(totals.paymentStatus, 'not_received');
  assert.equal(totals.outstandingAmount, 1735750);
});

test('net is not rounded when the setting is off', () => {
  const totals = deriveBillTotals({ taxableAmount: 1688145.42, gstAmount: 303866, deductions: [deduction('other', 256261)], collections: [] }, { tolerance: 1 });
  assert.equal(totals.netReceivable, 1735750.42);
});

test('negative deductions keep their sign (crop compensation rows)', () => {
  const totals = deriveBillTotals({ taxableAmount: 0, gstAmount: 0, deductions: [deduction('mobilization_advance', -522037)], collections: [receipt(522037)] }, options);
  assert.equal(totals.totalDeduction, -522037);
  assert.equal(totals.netReceivable, 522037);
  assert.equal(totals.paymentStatus, 'received');
  assert.equal(totals.outstandingAmount, 0);
});

test('credit note: negative taxable and GST stay negative', () => {
  const totals = deriveBillTotals({ taxableAmount: -70170, gstAmount: -12631, deductions: [], collections: [] }, options);
  assert.equal(totals.grossAmount, -82801);
  assert.equal(totals.netReceivable, -82801);
  assert.equal(totals.paymentStatus, 'not_received');
  const adjusted = deriveBillTotals({ taxableAmount: -70170, gstAmount: -12631, deductions: [], collections: [receipt(-82801)] }, options);
  assert.equal(adjusted.paymentStatus, 'received');
});

test('acceptance: multiple collections, partial then received', () => {
  const source = { taxableAmount: 2000000, gstAmount: 0, deductions: [], collections: [receipt(500000, '2026-04-10'), receipt(800000, '2026-04-18'), receipt(600000, '2026-04-30')] };
  const partial = deriveBillTotals(source, options);
  assert.equal(partial.totalReceived, 1900000);
  assert.equal(partial.outstandingAmount, 100000);
  assert.equal(partial.paymentStatus, 'partially_received');
  assert.equal(partial.lastReceiptDate, '2026-04-30');

  const full = deriveBillTotals({ ...source, collections: [...source.collections, receipt(100000, '2026-05-02')] }, options);
  assert.equal(full.totalReceived, 2000000);
  assert.equal(full.outstandingAmount, 0);
  assert.equal(full.paymentStatus, 'received');
});

test('acceptance: over receipt is flagged, never called received', () => {
  const totals = deriveBillTotals({ taxableAmount: 1000000, gstAmount: 0, deductions: [], collections: [receipt(1020000)] }, options);
  assert.equal(totals.paymentStatus, 'over_received');
  assert.equal(totals.shortfallSurplus, -20000);
});

test('draft and cancelled receipts do not count', () => {
  const totals = deriveBillTotals({ taxableAmount: 100000, gstAmount: 0, deductions: [], collections: [receipt(40000, '2026-04-01', 'draft'), receipt(60000, '2026-04-02', 'cancelled')] }, options);
  assert.equal(totals.totalReceived, 0);
  assert.equal(totals.paymentStatus, 'not_received');
});

test('status tolerance absorbs rupee rounding but not real shortfalls', () => {
  assert.equal(computePaymentStatus(100000, 99999.5, 1), 'received');
  assert.equal(computePaymentStatus(100000, 99998, 1), 'partially_received');
  assert.equal(computePaymentStatus(100000, 100000.8, 1), 'received');
  assert.equal(computePaymentStatus(100000, 100002, 1), 'over_received');
  assert.equal(computePaymentStatus(100000, 0.5, 1), 'not_received');
  assert.equal(computePaymentStatus(0, 0, 1), 'received');
});

test('a status override wins but the computed status is still reported', () => {
  const totals = deriveBillTotals(
    { taxableAmount: 100000, gstAmount: 0, deductions: [], collections: [receipt(65000)], paymentStatusOverride: { status: 'adjusted', reason: 'Client deducted LD', by: 'u', at: 'x' } },
    options,
  );
  assert.equal(totals.paymentStatus, 'adjusted');
  assert.equal(totals.computedPaymentStatus, 'partially_received');
  assert.equal(totals.outstandingAmount, 0);
});

test('rounds half away from zero like Sheets ROUND', () => {
  assert.equal(roundToRupee(2.5), 3);
  assert.equal(roundToRupee(-2.5), -3);
  assert.equal(roundToRupee(-0.4), 0);
});

test('legacy status mismatch', () => {
  assert.equal(legacyStatusMismatch('RECEIVED', 'partially_received'), true);
  assert.equal(legacyStatusMismatch('RECEIVED', 'received'), false);
  assert.equal(legacyStatusMismatch('NOT RECEIVED', 'not_received'), false);
  assert.equal(legacyStatusMismatch('NOT RECEIVED', 'received'), true);
  assert.equal(legacyStatusMismatch(undefined, 'received'), false);
});

test('bill ledger runs down to the outstanding amount', () => {
  const ledger = billLedger({
    id: 'b1',
    billDate: '2026-04-01',
    netReceivable: 2000000,
    transactionType: 'invoice',
    collections: [receipt(800000, '2026-04-18'), receipt(500000, '2026-04-10'), receipt(100000, '2026-04-20', 'draft')],
  });
  assert.deepEqual(ledger.map((line) => line.balance), [2000000, 1500000, 700000]);
});

test('outstanding as on a past date ignores later bills and receipts', () => {
  const bill = { billDate: '2026-04-01', netReceivable: 2000000, collections: [receipt(500000, '2026-04-10'), receipt(1500000, '2026-09-01')], isDeleted: false };
  assert.deepEqual(outstandingAsOf(bill, '2026-03-31', 1).included, false);
  const august = outstandingAsOf(bill, '2026-08-31', 1);
  assert.equal(august.outstanding, 1500000);
  assert.equal(august.status, 'partially_received');
  assert.equal(outstandingAsOf(bill, '2026-09-30', 1).outstanding, 0);
});

/* ── calendar ────────────────────────────────────────────────────────────── */

test('financial year boundaries', () => {
  assert.equal(financialYearOf('2026-04-01'), '2026-27');
  assert.equal(financialYearOf('2027-03-31'), '2026-27');
  assert.equal(financialYearOf('2026-03-31'), '2025-26');
  assert.deepEqual(financialYearMonths('2026-27').slice(0, 2), ['2026-04', '2026-05']);
  assert.equal(financialYearMonths('2026-27')[11], '2027-03');
});

test('ISO weeks and legacy week numbers', () => {
  assert.equal(isoWeekOf('2026-10-03'), '2026-W40');
  assert.deepEqual(isoWeekRange('2026-W41'), { from: '2026-10-05', to: '2026-10-11' });
  assert.equal(isoWeekOf('2027-01-01'), '2026-W53');
  assert.equal(normaliseWeekKey('WK-41', '2026-08-01'), '2026-W41');
  assert.equal(normaliseWeekKey(41, '2026-08-01'), '2026-W41');
  assert.equal(normaliseWeekKey('', '2026-08-01'), undefined);
});

/* ── ageing ──────────────────────────────────────────────────────────────── */

test('ageing bucket boundaries at 30, 60, 90, 180, 365', () => {
  const label = (days) => ageingBucketOf(days, DEFAULT_AGEING_BUCKETS).label;
  assert.equal(label(0), '0–30');
  assert.equal(label(30), '0–30');
  assert.equal(label(31), '31–60');
  assert.equal(label(60), '31–60');
  assert.equal(label(61), '61–90');
  assert.equal(label(90), '61–90');
  assert.equal(label(91), '91–180');
  assert.equal(label(180), '91–180');
  assert.equal(label(181), '181–365');
  assert.equal(label(365), '181–365');
  assert.equal(label(366), '365+');
  assert.equal(label(-4), '0–30');
  assert.equal(daysBetween('2026-04-24', '2026-10-03'), 162);
});

test('ageing bucket configuration must be contiguous and open-ended', () => {
  assert.equal(validateAgeingBuckets(DEFAULT_AGEING_BUCKETS), null);
  assert.match(validateAgeingBuckets([{ from: 0, to: 30, label: 'a' }, { from: 32, to: null, label: 'b' }]), /gap or overlap/);
  assert.match(validateAgeingBuckets([{ from: 0, to: 30, label: 'a' }]), /open-ended/);
});

test('a returned bill goes back one step before the stage that returned it', () => {
  assert.equal(resubmitTarget('verified'), 'under_verification');
  assert.equal(resubmitTarget('submitted'), 'draft');
  assert.equal(resubmitTarget(undefined), 'draft');
});
