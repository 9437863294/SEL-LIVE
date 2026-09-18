import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareBy,
  isDefaultSort,
  resolveSort,
  sortFieldDef,
  sortRows,
  SAS_LIST_KEYS,
  SAS_LIST_REGISTRY,
} from '../src/lib/site-account-statement-sort-registry.ts';

const field = (key, type) => ({ key, label: key, type });

describe('SAS_LIST_REGISTRY', () => {
  it('gives every list a default that names one of its own columns', () => {
    for (const key of SAS_LIST_KEYS) {
      const list = SAS_LIST_REGISTRY[key];
      const match = list.fields.find(f => f.key === list.defaultSort.field);
      assert.ok(match, `${key} defaults to "${list.defaultSort.field}", which is not a sortable column`);
      assert.ok(['asc', 'desc'].includes(list.defaultSort.direction), `${key} has a bad default direction`);
    }
  });

  it('has no duplicate column keys within a list', () => {
    for (const key of SAS_LIST_KEYS) {
      const keys = SAS_LIST_REGISTRY[key].fields.map(f => f.key);
      assert.equal(new Set(keys).size, keys.length, `${key} lists a column twice`);
    }
  });
});

describe('resolveSort', () => {
  it('falls back to the registry default when nothing is stored', () => {
    assert.deepEqual(resolveSort('expenses', undefined), { field: 'expenseDate', direction: 'desc' });
    assert.deepEqual(resolveSort('expenses', null), { field: 'expenseDate', direction: 'desc' });
    assert.deepEqual(resolveSort('expenses', {}), { field: 'expenseDate', direction: 'desc' });
  });

  it('uses a stored override', () => {
    assert.deepEqual(
      resolveSort('expenses', { expenses: { field: 'expenseAmount', direction: 'asc' } }),
      { field: 'expenseAmount', direction: 'asc' },
    );
  });

  it('ignores a stored field that is no longer a column', () => {
    // A saved setting outlives the column it named. Honouring it would sort by a property that
    // does not exist, producing arbitrary order that looks deliberate.
    assert.deepEqual(
      resolveSort('expenses', { expenses: { field: 'columnWeDeleted', direction: 'asc' } }),
      { field: 'expenseDate', direction: 'asc' },
    );
  });

  it('ignores a nonsense direction but keeps a valid field', () => {
    assert.deepEqual(
      resolveSort('expenses', { expenses: { field: 'projectName', direction: 'sideways' } }),
      { field: 'projectName', direction: 'desc' },
    );
  });

  it('does not let one list\'s setting leak into another', () => {
    const stored = { expenses: { field: 'expenseAmount', direction: 'asc' } };
    assert.deepEqual(resolveSort('payments', stored), { field: 'receiptDate', direction: 'desc' });
  });
});

describe('sortFieldDef / isDefaultSort', () => {
  it('finds a real column and rejects an unknown one', () => {
    assert.equal(sortFieldDef('expenses', 'expenseAmount')?.type, 'number');
    assert.equal(sortFieldDef('expenses', 'nope'), null);
  });

  it('recognises the registry default', () => {
    assert.equal(isDefaultSort('expenses', { field: 'expenseDate', direction: 'desc' }), true);
    assert.equal(isDefaultSort('expenses', { field: 'expenseDate', direction: 'asc' }), false);
    assert.equal(isDefaultSort('expenses', { field: 'expenseAmount', direction: 'desc' }), false);
  });
});

describe('compareBy', () => {
  it('orders numbers numerically, not as text', () => {
    const f = field('n', 'number');
    // "9" > "10" as strings; the whole point of typing the column.
    assert.ok(compareBy({ n: 9 }, { n: 10 }, f, 'asc') < 0);
    assert.ok(compareBy({ n: 9 }, { n: 10 }, f, 'desc') > 0);
  });

  it('orders text case-insensitively', () => {
    const f = field('s', 'text');
    assert.ok(compareBy({ s: 'apple' }, { s: 'Banana' }, f, 'asc') < 0);
    assert.equal(compareBy({ s: 'ABC' }, { s: 'abc' }, f, 'asc'), 0);
  });

  it('orders embedded numbers naturally', () => {
    const f = field('s', 'text');
    // "Site 10" after "Site 9", which a plain code-point compare gets backwards.
    assert.ok(compareBy({ s: 'Site 9' }, { s: 'Site 10' }, f, 'asc') < 0);
  });

  it('orders date strings chronologically', () => {
    const f = field('d', 'date');
    assert.ok(compareBy({ d: '2026-01-05' }, { d: '2026-02-01' }, f, 'asc') < 0);
    assert.ok(compareBy({ d: '2026-01-05' }, { d: '2026-02-01' }, f, 'desc') > 0);
  });

  it('reads Firestore timestamps and Date objects', () => {
    const f = field('d', 'date');
    const older = { d: { seconds: 1_700_000_000 } };
    const newer = { d: { toDate: () => new Date(1_800_000_000_000) } };
    assert.ok(compareBy(older, newer, f, 'asc') < 0);
    assert.ok(compareBy({ d: new Date(1_000) }, { d: new Date(2_000) }, f, 'asc') < 0);
  });

  it('sinks blanks to the bottom in both directions', () => {
    // Floating empties to the top on a descending sort would bury the rows being looked for.
    const t = field('s', 'text');
    assert.ok(compareBy({ s: '' }, { s: 'a' }, t, 'asc') > 0);
    assert.ok(compareBy({ s: '' }, { s: 'a' }, t, 'desc') > 0);
    assert.ok(compareBy({}, { s: 'a' }, t, 'desc') > 0);

    const n = field('n', 'number');
    assert.ok(compareBy({ n: null }, { n: 5 }, n, 'desc') > 0);
    assert.equal(compareBy({ n: null }, { n: undefined }, n, 'asc'), 0);
  });

  it('sinks an unparseable date rather than ordering on NaN', () => {
    const f = field('d', 'date');
    assert.ok(compareBy({ d: 'not-a-date' }, { d: '2026-01-01' }, f, 'asc') > 0);
    assert.ok(compareBy({ d: 'not-a-date' }, { d: '2026-01-01' }, f, 'desc') > 0);
  });

  it('treats zero as a value, not a blank', () => {
    const f = field('n', 'number');
    assert.ok(compareBy({ n: 0 }, { n: 5 }, f, 'asc') < 0);
    // A zero balance must not be shoved to the bottom with the genuinely missing ones.
    assert.ok(compareBy({ n: 0 }, { n: null }, f, 'asc') < 0);
  });
});

describe('sortRows', () => {
  const rows = [
    { expenseDate: '2026-03-02', expenseAmount: 500,  projectName: 'Bravo' },
    { expenseDate: '2026-03-01', expenseAmount: 1500, projectName: 'alpha' },
    { expenseDate: '2026-03-03', expenseAmount: 100,  projectName: 'Charlie' },
  ];

  it('orders by the requested column and direction', () => {
    assert.deepEqual(
      sortRows(rows, 'expenses', { field: 'expenseAmount', direction: 'desc' }).map(r => r.expenseAmount),
      [1500, 500, 100],
    );
    assert.deepEqual(
      sortRows(rows, 'expenses', { field: 'expenseDate', direction: 'asc' }).map(r => r.expenseDate),
      ['2026-03-01', '2026-03-02', '2026-03-03'],
    );
    assert.deepEqual(
      sortRows(rows, 'expenses', { field: 'projectName', direction: 'asc' }).map(r => r.projectName),
      ['alpha', 'Bravo', 'Charlie'],
    );
  });

  it('never mutates the input — these arrays come from useMemo', () => {
    const original = [...rows];
    sortRows(rows, 'expenses', { field: 'expenseAmount', direction: 'asc' });
    assert.deepEqual(rows, original);
  });

  it('returns the rows untouched when the column is not sortable on that list', () => {
    const result = sortRows(rows, 'expenses', { field: 'notAColumn', direction: 'asc' });
    assert.deepEqual(result.map(r => r.expenseDate), rows.map(r => r.expenseDate));
  });
});
