import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPayment,
  displayStatus,
  financialYear,
  modeConfig,
  nextVoucherNo,
  paymentModes,
  requisitionBalance,
  reversePayment,
  statusForPaid,
} from '../src/lib/bank-payments.ts';

const ref = (amount, extra = {}) => ({
  bankPaymentId: 'v1',
  voucherNo: 'BP/2026-27/0001',
  lineId: 'l1',
  amount,
  mode: 'Cheque',
  instrumentNo: '000123',
  instrumentDate: '2026-10-05',
  accountId: 'acc',
  ...extra,
});

test('a part payment leaves the requisition partially paid with the rest still due', () => {
  const after = applyPayment({ netAmount: 1000 }, ref(400));
  assert.equal(after.status, 'Partially Paid');
  assert.equal(after.paidAmount, 400);
  assert.equal(requisitionBalance({ netAmount: 1000, ...after }), 600);
});

test('paying the balance settles the requisition', () => {
  const first = applyPayment({ netAmount: 1000 }, ref(400));
  const second = applyPayment({ netAmount: 1000, ...first }, ref(600, { bankPaymentId: 'v2', lineId: 'l9' }));
  assert.equal(second.status, 'Paid');
  assert.equal(second.payments.length, 2);
});

test('paying more than is due is refused', () => {
  assert.throws(() => applyPayment({ netAmount: 1000, paidAmount: 900 }, ref(200)), /Only 100.00 is still due/);
});

test('cancelling a voucher line gives the amount back', () => {
  const paid = applyPayment({ netAmount: 1000 }, ref(1000));
  const back = reversePayment({ netAmount: 1000, ...paid }, 'v1', 'l1');
  assert.equal(back.status, 'Received for Payment');
  assert.equal(back.paidAmount, 0);
  assert.equal(back.payments.length, 0);
});

test('statuses and rounding', () => {
  assert.equal(statusForPaid(1000, 999.995), 'Paid');
  assert.equal(statusForPaid(1000, 0), 'Received for Payment');
});

test('an issued cheque dated after today is post-dated', () => {
  assert.equal(displayStatus({ status: 'Issued', instrumentDate: '2026-10-05' }, '2026-09-29'), 'Post-dated');
  assert.equal(displayStatus({ status: 'Issued', instrumentDate: '2026-09-29' }, '2026-09-29'), 'Issued');
  assert.equal(displayStatus({ status: 'Cleared', instrumentDate: '2026-10-05' }, '2026-09-29'), 'Cleared');
});

test('voucher numbers run per financial year', () => {
  assert.equal(financialYear('2026-09-29'), '2026-27');
  assert.equal(financialYear('2027-03-31'), '2026-27');
  assert.equal(financialYear('2027-04-01'), '2027-28');
  assert.deepEqual(nextVoucherNo(undefined, '2026-09-29'), { voucherNo: 'BP/2026-27/0001', counter: { fy: '2026-27', next: 2 } });
  assert.equal(nextVoucherNo({ fy: '2026-27', next: 42 }, '2026-09-29').voucherNo, 'BP/2026-27/0042');
  assert.equal(nextVoucherNo({ fy: '2025-26', next: 42 }, '2026-09-29').voucherNo, 'BP/2026-27/0001');
});

test('custom payment methods join the standard modes once', () => {
  const modes = paymentModes(['NEFT', 'UPI', 'upi', ' Cheque ']);
  assert.equal(modes.filter((m) => m.mode === 'UPI').length, 1);
  assert.equal(modes.filter((m) => m.mode.toLowerCase() === 'cheque').length, 1);
  assert.equal(modeConfig('e-Cheque').allowsFutureDate, true);
  assert.equal(modeConfig('RTGS').utrPerLine, true);
});
