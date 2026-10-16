import test from 'node:test';
import assert from 'node:assert/strict';

const { fieldControlChanges, changedAreas } = await import('../src/lib/site-account-statement-field-control-changes.ts');

const FORMS = [
  {
    key: 'expense', title: 'Add Expense', fields: [
      { key: 'projectId', defaultLabel: 'Project', locked: true },
      { key: 'billNo', defaultLabel: 'Bill No.' },
      { key: 'remarks', defaultLabel: 'Remarks' },
    ],
  },
];
const base = () => ({
  expense: {
    projectId: { visible: true, required: true, label: 'Project' },
    billNo: { visible: true, required: false, label: 'Bill No.' },
    remarks: { visible: true, required: false, label: 'Remarks' },
  },
});
const SORT = { 'Site Expenses': 'Expense Date, Newest first' };

test('nothing changed reports nothing', () => {
  assert.deepEqual(fieldControlChanges({ forms: FORMS, before: base(), after: base(), sortBefore: SORT, sortAfter: SORT }), {});
});

test('each kind of field change is named, with before and after', () => {
  const after = base();
  after.expense.billNo = { visible: true, required: true, label: 'Voucher No.' };
  after.expense.remarks = { visible: false, required: false, label: 'Remarks' };
  assert.deepEqual(fieldControlChanges({ forms: FORMS, before: base(), after, sortBefore: SORT, sortAfter: SORT }), {
    'Add Expense · Bill No. · Required': { from: 'No', to: 'Yes' },
    'Add Expense · Bill No. · Label': { from: 'Bill No.', to: 'Voucher No.' },
    'Add Expense · Remarks · Shown': { from: 'Yes', to: 'No' },
  });
});

test('a locked field reports only a renamed label', () => {
  const after = base();
  after.expense.projectId = { visible: false, required: false, label: 'Site' };
  assert.deepEqual(Object.keys(fieldControlChanges({ forms: FORMS, before: base(), after, sortBefore: SORT, sortAfter: SORT })),
    ['Add Expense · Project · Label']);
});

test('a changed opening sort is named', () => {
  const changes = fieldControlChanges({
    forms: FORMS, before: base(), after: base(),
    sortBefore: SORT, sortAfter: { 'Site Expenses': 'Amount, Largest first' },
  });
  assert.deepEqual(changes, { 'Site Expenses · Sort order': { from: 'Expense Date, Newest first', to: 'Amount, Largest first' } });
});

test('the areas a save touched are listed once each', () => {
  assert.deepEqual(changedAreas({
    'Add Expense · Bill No. · Required': { from: 'No', to: 'Yes' },
    'Add Expense · Remarks · Shown': { from: 'Yes', to: 'No' },
    'Site Expenses · Sort order': { from: 'a', to: 'b' },
  }), ['Add Expense', 'Site Expenses']);
  assert.deepEqual(changedAreas(undefined), []);
});
