import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bbDateWindow,
  bbDateWindowForAccounts,
  describeBBRule,
  isEntryLocked,
  resolveBBDateControl,
  tallyMonths,
  validateBBEntryAgainstClosure,
  validateBBEntryChange,
  validateBBEntryDate,
} from '../src/lib/bank-balance-entry-controls.ts';
import { resolveMonthClosure } from '../src/lib/site-account-statement-month-closure.ts';
import {
  fieldLabel,
  missingRequiredField,
  resolveBBSort,
  resolveFormFields,
  sortBBRows,
} from '../src/lib/bank-balance-field-registry.ts';

const TODAY = '2026-11-02';
const names = { sbi: 'SBI-CC', canara: 'CANARA-CA' };
const nameOf = (id) => names[id] ?? id;

test('date control is off until switched on, and unknown values fall back to defaults', () => {
  const settings = resolveBBDateControl(null);
  assert.equal(settings.enabled, false);
  assert.equal(settings.postDatedDays, 90);
  assert.equal(bbDateWindow({ settings, kind: 'payment', today: TODAY }).enforced, false);
  assert.equal(validateBBEntryDate({ date: '2020-01-01', settings, kind: 'receipt', today: TODAY }).ok, true);
  const odd = resolveBBDateControl({ enabled: true, backdateDays: null, futureDays: -3, postDatedDays: '5' });
  assert.deepEqual([odd.backdateDays, odd.futureDays, odd.postDatedDays], [7, 0, 90]);
});

test('the back-dating window refuses older dates and names the way to change it', () => {
  const settings = resolveBBDateControl({ enabled: true, backdateDays: 3 });
  assert.equal(validateBBEntryDate({ date: '2026-10-30', settings, kind: 'receipt', today: TODAY }).ok, true);
  const old = validateBBEntryDate({ date: '2026-10-29', settings, kind: 'receipt', today: TODAY });
  assert.equal(old.ok, false);
  assert.match(old.reason, /cannot be earlier than 2026-10-30/);
  assert.match(old.reason, /Settings › Date Control/);
  assert.match(validateBBEntryDate({ date: '2026-11-03', settings, kind: 'transfer', today: TODAY }).reason, /cannot be in the future/);
  assert.match(validateBBEntryDate({ date: '2026-02-30', settings, kind: 'payment', today: TODAY }).reason, /real date/);
});

test('post-dated cheques have their own forward limit', () => {
  const settings = resolveBBDateControl({ enabled: true, backdateDays: 7, futureDays: 0, postDatedDays: 30 });
  assert.equal(validateBBEntryDate({ date: '2026-12-02', settings, kind: 'payment', postDated: true, today: TODAY }).ok, true);
  assert.match(validateBBEntryDate({ date: '2026-12-03', settings, kind: 'payment', postDated: true, today: TODAY }).reason, /30 days ahead/);
  assert.equal(validateBBEntryDate({ date: '2026-11-03', settings, kind: 'payment', today: TODAY }).ok, false);
  const none = resolveBBDateControl({ enabled: true, postDatedDays: 0 });
  assert.match(validateBBEntryDate({ date: '2026-11-03', settings: none, kind: 'payment', postDated: true, today: TODAY }).reason, /post-dated cheques are switched off/);
});

test('an account rule replaces the all-accounts rule, and the record types can be excluded', () => {
  const settings = resolveBBDateControl({
    enabled: true, backdateDays: 2, applyToTransfers: false,
    accounts: { sbi: { enabled: true, backdateDays: 30 }, canara: { enabled: false } },
  });
  assert.equal(validateBBEntryDate({ date: '2026-10-10', settings, kind: 'receipt', accountIds: ['sbi'], nameOf, today: TODAY }).ok, true);
  assert.equal(validateBBEntryDate({ date: '2026-01-01', settings, kind: 'receipt', accountIds: ['canara'], today: TODAY }).ok, true);
  const other = validateBBEntryDate({ date: '2026-10-10', settings, kind: 'receipt', accountIds: ['x'], today: TODAY });
  assert.match(other.reason, /for every account/);
  assert.equal(validateBBEntryDate({ date: '2026-01-01', settings, kind: 'transfer', accountIds: ['x'], today: TODAY }).ok, true);
  assert.match(
    validateBBEntryDate({ date: '2026-09-01', settings, kind: 'receipt', accountIds: ['sbi'], nameOf, today: TODAY }).reason,
    /for SBI-CC/,
  );
});

test('a transfer is held to both accounts: the overlap of their windows', () => {
  const settings = resolveBBDateControl({ enabled: true, backdateDays: 10, accounts: { sbi: { enabled: true, backdateDays: 2 } } });
  const window = bbDateWindowForAccounts({ settings, kind: 'transfer', accountIds: ['sbi', 'canara'], today: TODAY });
  assert.deepEqual(window, { min: '2026-10-31', max: TODAY, enforced: true });
  const check = validateBBEntryDate({ date: '2026-10-25', settings, kind: 'transfer', accountIds: ['canara', 'sbi'], nameOf, today: TODAY });
  assert.match(check.reason, /for SBI-CC/);
});

test('describeBBRule says what a rule allows', () => {
  assert.equal(describeBBRule(resolveBBDateControl(null)), 'No restriction');
  assert.equal(
    describeBBRule(resolveBBDateControl({ enabled: true, backdateDays: 0, postDatedDays: 30 })),
    'Today only, cheques up to 30 days ahead',
  );
});

const closure = resolveMonthClosure({
  months: { '2026-09': { closed: true, closedByName: 'A' } },
  projects: { sbi: { '2026-08': { closed: true } }, canara: { '2026-09': { closed: false, reopenReason: 'Late bill from vendor' } } },
}, TODAY);

test('a closed month refuses new entries, worded for the account that has it closed', () => {
  assert.equal(validateBBEntryAgainstClosure({ date: '2026-10-05', settings: closure, kind: 'receipt' }).ok, true);
  assert.match(validateBBEntryAgainstClosure({ date: '2026-09-05', settings: closure, kind: 'receipt' }).reason, /Sep 2026, which has been closed/);
  // Canara has September reopened for itself; SBI has August closed for itself only.
  assert.equal(validateBBEntryAgainstClosure({ date: '2026-09-05', settings: closure, kind: 'receipt', accountIds: ['canara'] }).ok, true);
  assert.match(
    validateBBEntryAgainstClosure({ date: '2026-08-05', settings: closure, kind: 'payment', accountIds: ['sbi'], nameOf }).reason,
    /closed for SBI-CC/,
  );
  // A transfer is refused when either account has the month closed.
  assert.equal(validateBBEntryAgainstClosure({ date: '2026-08-05', settings: closure, kind: 'transfer', accountIds: ['canara', 'sbi'], nameOf }).ok, false);
});

test('a stored entry in a closed month cannot be edited, deleted, cancelled or moved into one', () => {
  assert.equal(isEntryLocked({ date: '2026-09-20', settings: closure }), true);
  assert.equal(isEntryLocked({ date: '2026-09-20', settings: closure, accountIds: ['canara'] }), false);
  assert.match(
    validateBBEntryChange({ originalDate: '2026-09-20', settings: closure, kind: 'payment', action: 'cancel' }).reason,
    /cannot be cancelled or bounced by anyone/,
  );
  assert.match(
    validateBBEntryChange({ originalDate: '2026-10-02', nextDate: '2026-09-30', settings: closure, kind: 'transfer', action: 'edit' }).reason,
    /cannot be moved into it/,
  );
  assert.equal(validateBBEntryChange({ originalDate: '2026-10-02', nextDate: '2026-10-30', settings: closure, kind: 'transfer', action: 'edit' }).ok, true);
});

test('tallyMonths counts each transfer once, and per account either leg', () => {
  const entries = [
    { day: '2026-09-01', accountId: 'sbi', type: 'Debit', amount: 100 },
    { day: '2026-09-02', accountId: 'sbi', type: 'Credit', amount: 50 },
    { day: '2026-09-03', accountId: 'sbi', type: 'Debit', isContra: true, amount: 25 },
    { day: '2026-09-03', accountId: 'canara', type: 'Credit', isContra: true, amount: 25 },
  ];
  const cheques = [{ instrumentDate: '2026-09-28', accountId: 'sbi', uncleared: true }, { instrumentDate: '2026-09-29', accountId: 'sbi', uncleared: false }];
  const all = tallyMonths({ entries, cheques })['2026-09'];
  assert.deepEqual([all.paymentCount, all.receiptCount, all.transferCount, all.transferTotal, all.unclearedCheques], [1, 1, 1, 25, 1]);
  const canara = tallyMonths({ entries, cheques, accountId: 'canara' })['2026-09'];
  assert.deepEqual([canara.paymentCount, canara.transferCount, canara.unclearedCheques], [0, 1, 0]);
});

test('field control: defaults, legacy payment switches, overrides and locked fields', () => {
  const fresh = resolveFormFields('payment', null, { utrNumber: true });
  assert.equal(fresh.utr.required, true);
  assert.equal(fresh.ref.required, false);
  const saved = resolveFormFields('payment', { utr: { required: false, visible: false }, amount: { required: false, label: 'Paid (₹)' } }, { utrNumber: true });
  assert.deepEqual([saved.utr.required, saved.utr.visible], [false, false]);
  assert.deepEqual(saved.amount, { visible: true, required: true, label: 'Paid (₹)' });
  assert.equal(missingRequiredField('receipt', { description: ' ' }, resolveFormFields('receipt', null)), 'Description');
  assert.equal(missingRequiredField('receipt', { description: ' ' }, resolveFormFields('receipt', { description: { required: false } })), null);
  assert.equal(fieldLabel('payment', 'instrumentNo', fresh.instrumentNo, 'Cheque no.'), 'Cheque no.');
  const renamed = resolveFormFields('payment', { instrumentNo: { label: 'Instrument ref' } });
  assert.equal(fieldLabel('payment', 'instrumentNo', renamed.instrumentNo, 'Cheque no.'), 'Instrument ref');
});

test('sort order: stored choices, bad keys fall back, blanks last', () => {
  assert.deepEqual(resolveBBSort('cheques', { cheques: { field: 'total', direction: 'asc' } }), { field: 'total', direction: 'asc' });
  assert.deepEqual(resolveBBSort('cheques', { cheques: { field: 'nope', direction: 'sideways' } }), { field: 'instrumentDate', direction: 'desc' });
  const rows = [{ total: 5 }, { total: null }, { total: 9 }];
  assert.deepEqual(sortBBRows(rows, 'cheques', { field: 'total', direction: 'desc' }).map((r) => r.total), [9, 5, null]);
});
