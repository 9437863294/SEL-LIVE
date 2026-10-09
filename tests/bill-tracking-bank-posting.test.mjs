import test from 'node:test';
import assert from 'node:assert/strict';

import { bankCreditDescription, bankCreditForCollection, receiptBillsText, receiptInstant } from '../src/lib/bill-tracking/bank-posting.ts';

/** A receipt the way the server holds it, with the bits the bank posting reads. */
function receipt(extra = {}) {
  return {
    id: 'col-1',
    amount: 250000,
    receiptDate: '2026-06-10',
    clientNameSnapshot: 'OPTCL',
    allocations: [{ billId: 'b1', gstInvoiceNumber: 'INV-1', amount: 250000 }],
    ...extra,
  };
}

test('the receipt date becomes local noon, so a timezone difference cannot move the day', () => {
  const at = receiptInstant('2026-06-10');
  assert.equal(at.getFullYear(), 2026);
  assert.equal(at.getMonth(), 5);
  assert.equal(at.getDate(), 10);
  assert.equal(at.getHours(), 12);
  assert.equal(at.getMinutes(), 0);
  // Bank Balance reads the day back with date-fns `format(date, 'yyyy-MM-dd')` in local time.
  const dayKey = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  assert.equal(dayKey, '2026-06-10');
  // Read back from up to 11 hours either side (UTC server ↔ IST browser is +5:30), noon stays on
  // the day it was written for — where midnight would fall onto the 9th for any negative shift.
  for (let shift = -11; shift <= 11; shift += 1) {
    const read = new Date(at.getTime() + shift * 3600000);
    assert.equal(read.getDate(), 10, `noon shifted by ${shift}h left the day`);
  }
  const midnight = new Date('2026-06-10T00:00:00');
  assert.equal(new Date(midnight.getTime() - 3600000).getDate(), 9);
});

test('bill numbers are listed, then summarised past three', () => {
  assert.equal(receiptBillsText(receipt()), 'INV-1');
  assert.equal(receiptBillsText(receipt({ allocations: [] })), '');
  const many = receipt({
    allocations: [
      { gstInvoiceNumber: 'INV-1' },
      { gstInvoiceNumber: 'INV-2' },
      { billSerialNumber: 'BL-3' },
      { gstInvoiceNumber: 'INV-4' },
      { gstInvoiceNumber: 'INV-5' },
    ],
  });
  assert.equal(receiptBillsText(many), 'INV-1, INV-2, BL-3 +2 more');
  // A bill with neither number is simply not named.
  assert.equal(receiptBillsText(receipt({ allocations: [{ gstInvoiceNumber: '  ' }, { billSerialNumber: 'BL-9' }] })), 'BL-9');
});

test('the bank description names the client and the bills, falling back sensibly', () => {
  assert.equal(bankCreditDescription(receipt()), 'Receipt from OPTCL · INV-1');
  assert.equal(bankCreditDescription(receipt({ allocations: [] })), 'Receipt from OPTCL');
  assert.equal(bankCreditDescription(receipt({ clientNameSnapshot: undefined })), 'Receipt · INV-1');
  assert.equal(bankCreditDescription(receipt({ clientNameSnapshot: '  ', allocations: [], remarks: 'Part payment of RA-3' })), 'Part payment of RA-3');
  assert.equal(bankCreditDescription(receipt({ clientNameSnapshot: undefined, allocations: [], remarks: '   ' })), 'Bill Tracking receipt');
  assert.equal(bankCreditDescription(receipt({ clientNameSnapshot: undefined, allocations: [] })), 'Bill Tracking receipt');
});

test('a long description is clipped so it still fits a bank statement line', () => {
  const described = bankCreditDescription(receipt({ clientNameSnapshot: 'X'.repeat(400), allocations: [] }));
  assert.equal(described.length, 180);
  assert.equal(described.endsWith('…'), true);
});

test('no bank account means nothing is posted', () => {
  assert.equal(bankCreditForCollection(receipt()), null);
  assert.equal(bankCreditForCollection(receipt({ bankAccountId: '' })), null);
  assert.equal(bankCreditForCollection(receipt({ bankAccountId: '   ' })), null);
  // The name alone (every receipt recorded before this link existed) posts nothing.
  assert.equal(bankCreditForCollection(receipt({ bankAccountName: 'SBI CC A/c' })), null);
});

test('an already posted receipt never posts a second credit', () => {
  assert.equal(bankCreditForCollection(receipt({ bankAccountId: 'acc-1', bankExpenseId: 'be-1' })), null);
  // Cancelling clears `bankExpenseId`, so the receipt never names a row that was deleted.
  assert.notEqual(bankCreditForCollection(receipt({ bankAccountId: 'acc-1', bankExpenseId: undefined })), null);
});

test('the posted document is the shape Bank Balance writes for a receipt', () => {
  const draft = bankCreditForCollection(receipt({ bankAccountId: ' acc-1 ' }));
  assert.deepEqual(Object.keys(draft).sort(), ['accountId', 'amount', 'billCollectionId', 'date', 'description', 'isContra', 'type'].sort());
  assert.equal(draft.accountId, 'acc-1');
  assert.equal(draft.amount, 250000);
  assert.equal(draft.type, 'Credit');
  assert.equal(draft.isContra, false);
  assert.equal(draft.billCollectionId, 'col-1');
  assert.equal(draft.description, 'Receipt from OPTCL · INV-1');
  assert.equal(draft.date.getHours(), 12);
  // Firestore rejects `undefined`: every field must carry a value.
  for (const [key, value] of Object.entries(draft)) assert.notEqual(value, undefined, `${key} is undefined`);
});

test('one credit for the whole receipt, not one per allocation', () => {
  const split = receipt({
    bankAccountId: 'acc-1',
    amount: 1000000,
    allocations: [
      { gstInvoiceNumber: 'INV-1', amount: 600000 },
      { gstInvoiceNumber: 'INV-2', amount: 400000 },
    ],
  });
  const draft = bankCreditForCollection(split);
  assert.equal(draft.amount, 1000000);
  assert.equal(draft.description, 'Receipt from OPTCL · INV-1, INV-2');
});

test('a negative receipt posts a negative credit, which the ledger subtracts', () => {
  const draft = bankCreditForCollection(receipt({ bankAccountId: 'acc-1', amount: -50000 }));
  assert.equal(draft.amount, -50000);
  assert.equal(draft.type, 'Credit');
});
