import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_BANK_VALUE,
  bankErrors,
  cleanBank,
  employeeNameKey,
  hasBank,
  isIfsc,
  sameBank,
  toStoredBank,
} from '../src/lib/expenses-bank.ts';

const complete = {
  accountHolderName: 'ramesh  kumar',
  accountNumber: '1234 5678 9012',
  ifscCode: 'sbin0001234',
  bankName: 'State Bank of India',
  branchName: 'bhubaneswar',
};

test('details are kept in capitals, with no spaces inside the account number or IFSC', () => {
  assert.deepEqual(cleanBank(complete), {
    accountHolderName: 'RAMESH KUMAR',
    accountNumber: '123456789012',
    ifscCode: 'SBIN0001234',
    bankName: 'STATE BANK OF INDIA',
    branchName: 'BHUBANESWAR',
  });
});

test('bank details are optional until something is entered', () => {
  assert.deepEqual(bankErrors(EMPTY_BANK_VALUE), {});
  assert.equal(hasBank(EMPTY_BANK_VALUE), false);
  assert.equal(toStoredBank(EMPTY_BANK_VALUE), null);
});

test('once anything is entered, holder, account number and IFSC are required', () => {
  const errors = bankErrors({ bankName: 'HDFC BANK' });
  assert.deepEqual(Object.keys(errors).sort(), ['accountHolderName', 'accountNumber', 'ifscCode']);
  assert.deepEqual(bankErrors(complete), {});
});

test('account number and IFSC must be shaped like one', () => {
  assert.match(bankErrors({ ...complete, accountNumber: '12AB34567' }).accountNumber, /digits/);
  assert.match(bankErrors({ ...complete, ifscCode: 'SBIN1001234' }).ifscCode, /IFSC/);
  assert.equal(isIfsc('HDFC0ABC123'), true);
  assert.equal(isIfsc('HDFC0ABC12'), false);
  assert.equal(isIfsc('1234'), false);
});

test('details filled from the Employee module are saved with the employee they came from', () => {
  const stored = toStoredBank({ ...EMPTY_BANK_VALUE, ...complete, source: 'employee', employeeId: '208', employeeNo: 'E1383', edited: true });
  assert.equal(stored.source, 'employee');
  assert.equal(stored.employeeId, '208');
  assert.equal(stored.employeeNo, 'E1383');
  assert.equal(stored.edited, true);
  assert.equal(stored.accountHolderName, 'RAMESH KUMAR');
});

test('typed-in details carry no employee', () => {
  const stored = toStoredBank({ ...EMPTY_BANK_VALUE, ...complete, source: 'manual' });
  assert.equal(stored.source, 'manual');
  assert.equal('employeeId' in stored, false);
  assert.equal('edited' in stored, false);
});

test('sameBank compares details once tidied', () => {
  assert.equal(sameBank(complete, cleanBank(complete)), true);
  assert.equal(sameBank(complete, { ...complete, branchName: 'CUTTACK' }), false);
});

test('a party name matches an employee whatever its case, spacing or dotted initials', () => {
  assert.equal(employeeNameKey('r.k.  sahoo'), employeeNameKey('R K SAHOO'));
  assert.equal(employeeNameKey(' Ramesh Kumar '), 'RAMESH KUMAR');
  assert.notEqual(employeeNameKey('RAMESH KUMAR'), employeeNameKey('RAMESH KUMARI'));
  assert.equal(employeeNameKey(undefined), '');
});
