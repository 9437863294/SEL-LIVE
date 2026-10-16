import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRows, resolveListSort, sortDirectionLabel, sortListRows } from '../src/lib/list-sort.ts';
import { RP_LIST_KEYS, RP_LIST_REGISTRY, sortControlDocId } from '../src/lib/recurring-payments-sort-registry.ts';

const rows = [
  { id: 'a', title: 'water', dueDate: '2026-10-05', billAmount: 900 },
  { id: 'b', title: 'Electricity', dueDate: '2026-10-01', billAmount: undefined },
  { id: 'c', title: 'Rent', dueDate: '', billAmount: 25000 },
];

test('each list defaults to the order it used before the setting existed', () => {
  assert.deepEqual(resolveListSort(RP_LIST_REGISTRY, 'payments', null), { field: 'dueDate', direction: 'asc' });
  assert.deepEqual(resolveListSort(RP_LIST_REGISTRY, 'masters', {}), { field: 'title', direction: 'asc' });
  assert.deepEqual(resolveListSort(RP_LIST_REGISTRY, 'vendors', undefined), { field: 'name', direction: 'asc' });
  assert.deepEqual(resolveListSort(RP_LIST_REGISTRY, 'workflowTasks', null), { field: 'dueDate', direction: 'asc' });
  for (const key of RP_LIST_KEYS) {
    const list = RP_LIST_REGISTRY[key];
    assert.ok(list.fields.some((f) => f.key === list.defaultSort.field), `${key} default names a real column`);
  }
});

test('a stored override applies only while it names a real column and direction', () => {
  assert.deepEqual(resolveListSort(RP_LIST_REGISTRY, 'payments', { payments: { field: 'billAmount', direction: 'desc' } }), { field: 'billAmount', direction: 'desc' });
  assert.deepEqual(resolveListSort(RP_LIST_REGISTRY, 'payments', { payments: { field: 'dropped', direction: 'sideways' } }), { field: 'dueDate', direction: 'asc' });
});

test('blank values sink to the bottom whichever way the list runs', () => {
  const byDue = (direction) => sortListRows(RP_LIST_REGISTRY, rows, 'payments', { field: 'dueDate', direction }).map((r) => r.id);
  assert.deepEqual(byDue('asc'), ['b', 'a', 'c']);
  assert.deepEqual(byDue('desc'), ['a', 'b', 'c']);
  const byBill = sortListRows(RP_LIST_REGISTRY, rows, 'payments', { field: 'billAmount', direction: 'desc' }).map((r) => r.id);
  assert.deepEqual(byBill, ['c', 'a', 'b']);
});

test('text compares without regard to case, and the input is never mutated', () => {
  const before = rows.map((r) => r.id);
  assert.deepEqual(sortListRows(RP_LIST_REGISTRY, rows, 'payments', { field: 'title', direction: 'asc' }).map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(rows.map((r) => r.id), before);
});

test('Firestore timestamps compare as dates', () => {
  const field = { key: 'at', label: 'At', type: 'date' };
  const early = { at: { seconds: 100 } };
  const late = { at: { toDate: () => new Date(500_000) } };
  assert.ok(compareRows(early, late, field, 'asc') < 0);
});

test('direction wording suits the column', () => {
  assert.equal(sortDirectionLabel('number', 'desc'), 'Largest first');
  assert.equal(sortDirectionLabel('date', 'asc'), 'Oldest first');
  assert.equal(sortDirectionLabel('text', 'asc'), 'A to Z');
});

test('the sort document sits under the rules-protected field control prefix', () => {
  assert.equal(sortControlDocId('default'), 'fieldControl_default_sortOrder');
  assert.match(sortControlDocId('org/1'), /^fieldControl_.*_sortOrder$/);
});
