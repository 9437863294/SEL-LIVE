import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargeDescription, chargeName, chargeTotal, gstOn, lastChargeLike, splitGst } from '../src/lib/bank-balance-charges.ts';

test('GST on a charge, to the paisa', () => {
  assert.equal(gstOn(25, 18), 4.5);
  assert.equal(gstOn(2.5, 18), 0.45);
  assert.equal(gstOn(17.75, 18), 3.2); // 3.195 rounds up
  assert.equal(gstOn(100, 0), 0);
});

test('CGST and SGST always add back to the GST', () => {
  assert.deepEqual(splitGst(4.5, 'CGST + SGST'), { cgst: 2.25, sgst: 2.25, igst: 0 });
  assert.deepEqual(splitGst(3.21, 'CGST + SGST'), { cgst: 1.6, sgst: 1.61, igst: 0 });
  assert.deepEqual(splitGst(3.21, 'IGST'), { cgst: 0, sgst: 0, igst: 3.21 });
  for (const gst of [0.01, 0.45, 1.23, 99.99]) {
    const { cgst, sgst } = splitGst(gst, 'CGST + SGST');
    assert.equal(Math.round((cgst + sgst) * 100) / 100, gst);
  }
});

test('the whole debit', () => {
  assert.equal(chargeTotal(25, 4.5, 0), 29.5);
  assert.equal(chargeTotal(0.1, 0.2, 0), 0.3);
  assert.equal(chargeTotal(500, 90, 1), 591);
});

test('names and descriptions', () => {
  assert.equal(chargeName('RTGS'), 'RTGS charges');
  assert.equal(chargeName('Processing fee'), 'Processing fee');
  assert.equal(chargeName('Other', ' Locker rent '), 'Locker rent');
  assert.equal(chargeName('Other'), 'Bank charges');
  assert.equal(chargeDescription({ type: 'RTGS', charge: 25, gst: 4.5, gstRate: 18 }), 'RTGS charges ₹25.00 + GST 18% ₹4.50');
  assert.equal(
    chargeDescription({ type: 'Cheque book', charge: 100, gst: 18, gstRate: 18, other: 1, otherLabel: 'Stamp duty', note: 'Book of 50 leaves' }),
    'Cheque book charges ₹100.00 + GST 18% ₹18.00 + Stamp duty ₹1.00 — Book of 50 leaves',
  );
  assert.equal(chargeDescription({ type: 'SMS alerts', charge: 15, gst: 0, gstRate: 0 }), 'SMS alerts charges ₹15.00');
});

test('the last charge of a kind, this account first', () => {
  const history = [
    { accountId: 'b', entryKind: 'bankCharge', chargeType: 'RTGS', chargeAmount: 30, at: new Date('2026-11-05') },
    { accountId: 'a', entryKind: 'bankCharge', chargeType: 'NEFT', chargeAmount: 2.5, at: new Date('2026-11-04') },
    { accountId: 'a', entryKind: 'bankCharge', chargeType: 'RTGS', chargeAmount: 25, at: new Date('2026-11-01') },
    { accountId: 'a', chargeType: 'RTGS', chargeAmount: 99, at: new Date('2026-10-01') },
  ];
  assert.equal(lastChargeLike(history, 'a', 'RTGS')?.chargeAmount, 25);
  assert.equal(lastChargeLike(history, 'c', 'RTGS')?.chargeAmount, 30);
  assert.equal(lastChargeLike(history, 'a', 'IMPS'), undefined);
});
