import test from 'node:test';
import assert from 'node:assert/strict';

import { allocateToClaims, billRetention, canHoldRetention, resolveRetentionClaims, retentionIndex, retentionTotals } from '../src/lib/bill-tracking/retention.ts';

/** A supply bill with 10% CPBG and 30% invoice retention on ₹10,00,000. */
const supply = (id = 'b1', extra = {}) => ({
  id,
  projectId: 'p1',
  transactionType: 'invoice',
  isRetentionBill: false,
  isDeleted: false,
  billDate: '2026-06-01',
  gstInvoiceNumber: `INV-${id}`,
  deductions: [
    { id: 'l1', deductionTypeId: 'dt-ret-cpbg', deductionTypeName: 'Retention Against CPBG', kind: 'retention_cpbg', amount: 100000 },
    { id: 'l2', deductionTypeId: 'dt-ret-inv', deductionTypeName: 'Retention Against Invoice', kind: 'retention_invoice', amount: 300000 },
    { id: 'l3', deductionTypeId: 'dt-itds', deductionTypeName: 'Income TDS', kind: 'statutory', amount: 20000 },
  ],
  ...extra,
});
const retentionBill = (id, claims, extra = {}) => ({
  id,
  projectId: 'p1',
  transactionType: 'retention_bill',
  isRetentionBill: true,
  isDeleted: false,
  billDate: '2026-09-01',
  gstInvoiceNumber: `RET-${id}`,
  deductions: [],
  retentionClaims: claims.map(([billId, deductionTypeId, amount]) => ({ billId, deductionTypeId, deductionTypeName: deductionTypeId, kind: deductionTypeId === 'dt-ret-cpbg' ? 'retention_cpbg' : 'retention_invoice', amount })),
  ...extra,
});
const release = (againstBillId, amount, extra = {}) => ({ id: `r${Math.random()}`, projectId: 'p1', againstBillId, kind: 'retention_invoice', releaseDate: '2026-10-01', amount, status: 'active', ...extra });

test('a bill with retention and nothing claimed: not raised, all of it pending', () => {
  const bill = supply();
  const position = billRetention(bill, retentionIndex([bill], []), 1);
  assert.equal(position.state, 'not_raised');
  assert.equal(position.held, 400000);
  assert.equal(position.pendingToRaise, 400000);
  assert.deepEqual(position.heads.map((head) => [head.deductionTypeId, head.held]), [['dt-ret-cpbg', 100000], ['dt-ret-inv', 300000]], 'TDS is not retention');
});

test('a retention bill claiming one head: partly raised; claiming both: raised, then received', () => {
  const bill = supply();
  const first = retentionBill('rb1', [['b1', 'dt-ret-inv', 300000]]);
  let position = billRetention(bill, retentionIndex([bill, first], []), 1);
  assert.equal(position.state, 'partly_raised');
  assert.equal(position.pendingToRaise, 100000);
  assert.equal(position.awaitingPayment, 300000);
  assert.deepEqual(position.claims.map((claim) => claim.reference), ['RET-rb1']);

  const second = retentionBill('rb2', [['b1', 'dt-ret-cpbg', 100000]]);
  position = billRetention(bill, retentionIndex([bill, first, second], []), 1);
  assert.equal(position.state, 'raised');
  assert.equal(position.pendingToRaise, 0);

  // The client pays both retention bills.
  const paid = [release('b1', 300000, { retentionBillId: 'rb1', deductionTypeId: 'dt-ret-inv' }), release('b1', 100000, { retentionBillId: 'rb2', deductionTypeId: 'dt-ret-cpbg', kind: 'retention_cpbg' })];
  position = billRetention(bill, retentionIndex([bill, first, second], paid), 1);
  assert.equal(position.state, 'received');
  assert.equal(position.awaitingPayment, 0);
  assert.equal(position.received, 400000);
});

test('deleted retention bills and cancelled releases do not count', () => {
  const bill = supply();
  const gone = retentionBill('rb1', [['b1', 'dt-ret-inv', 300000]], { isDeleted: true });
  const cancelled = release('b1', 50000, { status: 'cancelled' });
  const position = billRetention(bill, retentionIndex([bill, gone], [cancelled]), 1);
  assert.equal(position.state, 'not_raised');
  assert.equal(position.received, 0);
});

test('a release recorded straight against the bill reduces what is left to raise', () => {
  const bill = supply();
  const direct = release('b1', 100000, { kind: 'retention_cpbg' });
  const position = billRetention(bill, retentionIndex([bill], [direct]), 1);
  const cpbg = position.heads.find((head) => head.deductionTypeId === 'dt-ret-cpbg');
  assert.equal(cpbg.receivedDirect, 100000, 'matched to the head by its kind');
  assert.equal(cpbg.pendingToRaise, 0);
  assert.equal(position.pendingToRaise, 300000);
  assert.equal(position.state, 'partly_raised');
});

test('a credit note adjusting the retention changes what is held', () => {
  const bill = supply();
  const note = { id: 'n1', projectId: 'p1', transactionType: 'credit_note', isRetentionBill: false, isDeleted: false, againstBillId: 'b1', deductions: [{ id: 'x', deductionTypeId: 'dt-ret-inv', deductionTypeName: 'Retention Against Invoice', kind: 'retention_invoice', amount: -30000 }] };
  const position = billRetention(bill, retentionIndex([bill, note], []), 1);
  assert.equal(position.heads.find((head) => head.deductionTypeId === 'dt-ret-inv').held, 270000);
});

test('claims are checked against what is still to raise', () => {
  const bill = supply();
  const other = supply('b2', { projectId: 'p2' });
  const already = retentionBill('rb1', [['b1', 'dt-ret-inv', 200000]]);
  const bills = [bill, other, already];
  const ok = resolveRetentionClaims([{ billId: 'b1', deductionTypeId: 'dt-ret-inv', amount: 100000 }], { projectId: 'p1' }, bills, [], 1);
  assert.deepEqual(ok.claims.map((claim) => [claim.billRef, claim.deductionTypeName, claim.kind, claim.amount]), [['INV-b1', 'Retention Against Invoice', 'retention_invoice', 100000]]);
  assert.match(resolveRetentionClaims([{ billId: 'b1', deductionTypeId: 'dt-ret-inv', amount: 150000 }], { projectId: 'p1' }, bills, [], 1).error, /more than the ₹1,00,000/);
  assert.match(resolveRetentionClaims([{ billId: 'b2', deductionTypeId: 'dt-ret-inv', amount: 10 }], { projectId: 'p1' }, bills, [], 1).error, /another project/);
  assert.match(resolveRetentionClaims([{ billId: 'b1', deductionTypeId: 'dt-itds', amount: 10 }], { projectId: 'p1' }, bills, [], 1).error, /No retention under that head/);
  assert.match(resolveRetentionClaims([{ billId: 'rb1', deductionTypeId: 'dt-ret-inv', amount: 10 }], { projectId: 'p1' }, bills, [], 1).error, /note or a retention bill/);
  // Editing rb1 itself: its own claim is not counted against it.
  const edit = resolveRetentionClaims([{ billId: 'b1', deductionTypeId: 'dt-ret-inv', amount: 300000 }], { id: 'rb1', projectId: 'p1' }, bills, [], 1);
  assert.equal(edit.claims[0].amount, 300000);
  assert.match(resolveRetentionClaims([{ billId: 'b1', deductionTypeId: 'dt-ret-inv', amount: 1 }, { billId: 'b1', deductionTypeId: 'dt-ret-inv', amount: 1 }], { projectId: 'p1' }, bills, [], 1).error, /twice/);
});

test('a receipt on a retention bill is credited to its claims in proportion, to the paisa', () => {
  const claims = [
    { billId: 'b1', deductionTypeId: 'dt-ret-inv', deductionTypeName: 'x', kind: 'retention_invoice', amount: 300000 },
    { billId: 'b2', deductionTypeId: 'dt-ret-cpbg', deductionTypeName: 'y', kind: 'retention_cpbg', amount: 100000 },
  ];
  assert.deepEqual(allocateToClaims(claims, 400000).map((part) => [part.claim?.billId ?? null, part.amount]), [['b1', 300000], ['b2', 100000]]);
  assert.deepEqual(allocateToClaims(claims, 100000.01).map((part) => [part.claim?.billId ?? null, part.amount]), [['b1', 75000], ['b2', 25000.01]]);
  assert.deepEqual(allocateToClaims(claims, 450000).map((part) => [part.claim?.billId ?? null, part.amount]), [['b1', 300000], ['b2', 100000], [null, 50000]], 'more than claimed: the rest against the project');
  assert.deepEqual(allocateToClaims([], 500), [{ claim: null, amount: 500 }], 'a retention bill without claims (imported) keeps the old behaviour');
});

test('which bills can hold retention, and the totals by status', () => {
  assert.equal(canHoldRetention(supply()), true);
  assert.equal(canHoldRetention(retentionBill('rb', [])), false);
  assert.equal(canHoldRetention({ ...supply(), transactionType: 'credit_note' }), false);
  const a = supply('a');
  const b = supply('b');
  const rb = retentionBill('rb', [['a', 'dt-ret-inv', 300000], ['a', 'dt-ret-cpbg', 100000]]);
  const index = retentionIndex([a, b, rb], []);
  const totals = retentionTotals([billRetention(a, index, 1), billRetention(b, index, 1)]);
  assert.equal(totals.bills, 2);
  assert.equal(totals.byState.raised, 1);
  assert.equal(totals.byState.not_raised, 1);
  assert.equal(totals.pendingToRaise, 400000);
  assert.equal(totals.awaitingPayment, 400000);
});
