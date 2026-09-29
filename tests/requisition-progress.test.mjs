import test from 'node:test';
import assert from 'node:assert/strict';
import {
  balanceOf,
  isPaymentLocked,
  paidOf,
  payRequisitionsHref,
  requisitionHref,
  requisitionProgress,
  requisitionsByRequestNo,
  voucherHref,
} from '../src/lib/requisition-progress.ts';

test('an expense request with no requisition reads as not received', () => {
  const p = requisitionProgress(undefined);
  assert.equal(p.stage, 'not-received');
  assert.equal(p.balance, 0);
});

test('paid, part paid and balance', () => {
  assert.equal(paidOf({ status: 'Paid', netAmount: 1000 }), 1000);
  assert.equal(paidOf({ status: 'Partially Paid', netAmount: 1000, paidAmount: 400 }), 400);
  assert.equal(balanceOf({ status: 'Partially Paid', netAmount: 1000, paidAmount: 400 }), 600);
  assert.equal(balanceOf({ status: 'Cancelled', netAmount: 1000 }), 0);
  const p = requisitionProgress({ status: 'Partially Paid', netAmount: 1000, paidAmount: 400 });
  assert.equal(p.stage, 'part-paid');
  assert.equal(p.tone, 'warning');
});

test('any payment locks a requisition', () => {
  assert.equal(isPaymentLocked({ status: 'Received for Payment' }), false);
  assert.equal(isPaymentLocked({ status: 'Received for Payment', paidAmount: 10 }), true);
  assert.equal(isPaymentLocked({ status: 'Paid' }), true);
  assert.equal(isPaymentLocked({ status: 'Received', payments: [{}] }), true);
});

test('each request maps to its live requisition over a cancelled one', () => {
  const map = requisitionsByRequestNo([
    { depNo: 'DEP/1', status: 'Cancelled', createdAt: '2026-09-01T00:00:00Z', id: 'old' },
    { depNo: 'DEP/1', status: 'Pending', createdAt: '2026-08-01T00:00:00Z', id: 'live' },
    { depNo: '', status: 'Pending', id: 'none' },
  ]);
  assert.equal(map.get('DEP/1').id, 'live');
  assert.equal(map.size, 1);
});

test('cross-module links', () => {
  assert.equal(requisitionHref('SEL/2026-27/1'), '/daily-requisition/entry-sheet?q=SEL%2F2026-27%2F1');
  assert.equal(voucherHref('abc'), '/bank-balance/cheques?voucher=abc');
  assert.equal(payRequisitionsHref(['a', 'b']), '/bank-balance/expenses/new?requisitions=a,b');
  assert.equal(payRequisitionsHref([]), '/bank-balance/expenses/new');
});
