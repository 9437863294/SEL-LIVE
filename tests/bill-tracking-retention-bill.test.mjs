import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveBillTotals, protectedChanges } from '../src/lib/bill-tracking/calculations.ts';
import { certificationSummary, compareCertification } from '../src/lib/bill-tracking/certification.ts';
import { billTotals, dashboardKpis, monthlySummary, retentionReport } from '../src/lib/bill-tracking/reports.ts';
import { claimOfRetentionBill, effectiveRetentionClaim, isRetentionBillOf, releasedByReceipt, retentionBillProblem, splitLegacyClaim } from '../src/lib/bill-tracking/retention-bill.ts';
import { DEFAULT_CONFIG } from '../src/lib/bill-tracking/defaults.ts';

const OPTIONS = { tolerance: 1, roundNetToRupee: true };
const retentionLine = (id, amount) => ({ id, deductionTypeId: 'dt-ret-inv', deductionTypeName: 'Retention Against Invoice', kind: 'retention_invoice', amount, baseAmount: amount });
const tdsLine = (id, amount) => ({ id, deductionTypeId: 'dt-itds', deductionTypeName: 'Income TDS', kind: 'statutory', amount, baseAmount: amount });
const receipt = (amount, receiptDate) => ({ collectionId: `c-${receiptDate}`, receiptDate, amount, status: 'verified' });

/** A bill as the server stores it: its source values plus the derived totals. */
const stored = (values) => {
  const bill = {
    projectId: 'p1',
    projectNameSnapshot: 'Project One',
    billDate: '2026-11-05',
    financialYear: '2026-27',
    billCategory: 'supply',
    billTypeName: 'SUPPLY',
    transactionType: 'invoice',
    isRetentionBill: false,
    taxableAmount: 0,
    gstAmount: 0,
    deductions: [],
    collections: [],
    isDeleted: false,
    ...values,
  };
  return { ...bill, ...deriveBillTotals(bill, OPTIONS) };
};
const invoice = (values = {}) => stored({ id: 'inv', taxableAmount: 1000000, gstAmount: 180000, deductions: [retentionLine('r', 100000)], ...values });
const retentionBill = (values = {}) => stored({ id: 'rtn', transactionType: 'retention_bill', isRetentionBill: true, billTypeName: 'SUPPLY-10%', retentionClaimed: 100000, ...values });

test('a retention bill is paid its claim: no taxable, no GST, no retention held', () => {
  const bill = retentionBill();
  assert.deepEqual([bill.grossAmount, bill.netReceivable, bill.raisedNetReceivable, bill.totalDeduction, bill.retentionDeducted], [0, 100000, 100000, 0, 0]);
  // The client deducts something on it: the net is the claim less that.
  const less = retentionBill({ deductions: [tdsLine('t', 2000)] });
  assert.deepEqual([less.netReceivable, less.totalDeduction, less.retentionDeducted], [98000, 2000, 0]);
});

test('the retention bill adds nothing to taxable or GST, and the retention stays held until paid', () => {
  const raised = [invoice(), retentionBill()];
  const totals = billTotals(raised);
  assert.deepEqual([totals.taxable, totals.gst, totals.net, totals.retention], [1000000, 180000, 1080000 + 100000, 100000]);
  const summary = monthlySummary(raised, '2026-27').find((row) => row.month === '2026-11');
  assert.deepEqual([summary.totalTaxable, summary.gst, summary.retentionRaised, summary.net], [1000000, 180000, 100000, 1180000]);

  const context = { asOf: '2026-11-13', settings: DEFAULT_CONFIG.settings };
  const held = dashboardKpis(raised, [], context);
  assert.equal(held.retentionBalance, 100000, 'raising the retention bill releases nothing');
  // Paid: the receipt releases the retention claimed (as `createCollection` writes it).
  const paid = retentionBill({ collections: [receipt(100000, '2026-11-20')] });
  const release = { status: 'active', projectId: 'p1', amount: releasedByReceipt(paid, 100000) };
  const after = dashboardKpis([invoice(), paid], [release], context);
  assert.deepEqual([after.retentionReleased, after.retentionBalance], [100000, 0]);
  assert.deepEqual(retentionReport([invoice(), paid], [release], context).totals.balance, 0);
});

test('a receipt releases its share of the claim — the whole claim once the bill is paid', () => {
  const plain = retentionBill();
  assert.equal(releasedByReceipt(plain, 40000), 40000);
  const less = retentionBill({ deductions: [tdsLine('t', 2000)] });
  assert.equal(releasedByReceipt(less, 98000), 100000, 'paid in full: the TDS on it is retention no longer held');
  assert.equal(releasedByReceipt(less, 49000), 50000);
  // No claim (an older bill): what was received.
  assert.equal(releasedByReceipt({ netReceivable: 300000 }, 300000), 300000);
});

test('certified for a smaller release: the certified claim applies, no note', () => {
  const certification = { certifiedDate: '2026-11-10', taxableAmount: 0, gstAmount: 0, grossAmount: 0, retentionClaimed: 80000, deductions: [], totalDeduction: 0, netAmount: 80000, revision: 1, recordedBy: 'u1', recordedAt: '2026-11-10' };
  const bill = retentionBill({ certification });
  assert.equal(effectiveRetentionClaim(bill), 80000);
  assert.deepEqual([bill.netReceivable, bill.raisedNetReceivable], [80000, 100000]);
  const summary = certificationSummary(bill, [], 1);
  assert.deepEqual([summary.state, summary.variance, summary.pendingNet], ['matched', -20000, 0]);
  const comparison = compareCertification(bill, [], 1);
  assert.equal(comparison.suggestedNote, null);
  assert.deepEqual(
    comparison.lines.filter((line) => line.group !== 'deduction').map((line) => [line.key, line.raised, line.certified, line.settledBy]),
    [
      ['retentionClaimed', 100000, 80000, 'certification'],
      ['totalDeduction', 0, 0, 'certification'],
      ['net', 100000, 80000, 'note'],
    ],
  );
  // Certified before certifications carried a claim: the raised claim applies.
  assert.equal(effectiveRetentionClaim(retentionBill({ certification: { ...certification, retentionClaimed: undefined } })), 100000);
});

test('what a retention bill may not carry', () => {
  const ok = { taxableAmount: 0, gstAmount: 0, retentionClaimed: 100000, deductions: [{ kind: 'statutory', name: 'Income TDS' }] };
  assert.equal(retentionBillProblem(ok), null);
  assert.match(retentionBillProblem({ ...ok, taxableAmount: 100000 }), /no taxable value or GST/);
  assert.match(retentionBillProblem({ ...ok, gstAmount: 18000 }), /no taxable value or GST/);
  assert.match(retentionBillProblem({ ...ok, retentionClaimed: 0 }), /Retention claimed/);
  assert.equal(retentionBillProblem({ ...ok, retentionClaimed: 0 }, { allowNil: true }), null, 'a certification may release nothing');
  assert.match(retentionBillProblem({ ...ok, deductions: [{ kind: 'retention_invoice', name: 'Retention Against Invoice' }] }), /cannot deduct retention.*Retention Against Invoice/);
});

test('older layouts read as a claim: the workbook’s negative line, or a taxable typed for it', () => {
  const lines = [retentionLine('r', -300000), tdsLine('t', 1000)];
  assert.deepEqual(splitLegacyClaim(lines, (line) => line.kind === 'retention_invoice'), { claim: 300000, lines: [lines[1]] });
  assert.deepEqual(splitLegacyClaim([retentionLine('r', 5000)], (line) => line.kind === 'retention_invoice').claim, 0, 'retention deducted, not claimed');
  assert.deepEqual(claimOfRetentionBill({ taxableAmount: 0, deductions: lines }), { claim: 300000, lines: [lines[1]], from: 'lines' });
  assert.deepEqual(claimOfRetentionBill({ taxableAmount: 100000, deductions: [] }), { claim: 100000, lines: [], from: 'taxable' });
  assert.deepEqual(claimOfRetentionBill({ retentionClaimed: 50000, taxableAmount: 0, deductions: [] }).from, 'claim');
  // The workbook layout and the claim give the same net — converting one never moves what is owed.
  const legacy = stored({ transactionType: 'retention_bill', isRetentionBill: true, deductions: lines });
  const converted = stored({ transactionType: 'retention_bill', isRetentionBill: true, retentionClaimed: 300000, deductions: [lines[1]] });
  assert.deepEqual([legacy.netReceivable, converted.netReceivable], [299000, 299000]);
  assert.deepEqual([legacy.retentionDeducted, converted.retentionDeducted], [-300000, 0], 'the old layout counted the claim off the retention held');
});

test('a retention bill by its kind or its sub category; the claim is a protected figure', () => {
  assert.equal(isRetentionBillOf('retention_bill'), true);
  assert.equal(isRetentionBillOf('invoice', { isRetentionBill: true }), true);
  assert.equal(isRetentionBillOf('invoice', { isRetentionBill: false }), false);
  assert.deepEqual(protectedChanges({ retentionClaimed: 100000 }, { retentionClaimed: 100000.004 }), []);
  assert.deepEqual(protectedChanges({ retentionClaimed: 100000 }, { retentionClaimed: 90000 }), ['retentionClaimed']);
});
