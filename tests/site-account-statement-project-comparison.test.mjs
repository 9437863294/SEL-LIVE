import test from 'node:test';
import assert from 'node:assert/strict';

const { previousScope, projectComparison } = await import('../src/lib/site-account-statement-charts.ts');

const Q3 = ['2026-07', '2026-08', '2026-09'];
const scopeOf = (periods = Q3, projectIds = null) => ({ projectIds, periods });
const exp = (projectId, expenseDate, expenseAmount, expenseCategory = 'Labour', expenseSubCategory) =>
  ({ projectId, expenseDate, expenseAmount, expenseCategory, expenseSubCategory });

const PROJECTS = [
  { id: 'c', name: 'Charlie' },
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'z', name: 'Zulu' }, // never spends anything
];

// Q3 2026 and the quarter before it (Apr–Jun).
const LEDGER = [
  exp('a', '2026-07-10', 300, 'Labour'),
  exp('a', '2026-08-10', 300, 'Material'),
  exp('b', '2026-07-10', 900, 'Labour'),
  exp('c', '2026-09-10', 200, 'Material'), // spends, but nothing on Labour
  exp('a', '2026-05-10', 150, 'Labour'),   // previous period
  exp('b', '2026-04-10', 900, 'Labour'),   // previous period
];

// ── The previous period ────────────────────────────────────────────────────────

test('the previous period is the same number of months immediately before', () => {
  assert.deepEqual(previousScope(scopeOf()).periods, ['2026-04', '2026-05', '2026-06']);
});

test('the previous period rolls back across a year boundary', () => {
  assert.deepEqual(previousScope(scopeOf(['2026-01', '2026-02'])).periods, ['2025-11', '2025-12']);
  assert.deepEqual(previousScope(scopeOf(['2026-03'])).periods, ['2026-02']);
});

test('the previous period keeps the same projects', () => {
  assert.deepEqual(previousScope(scopeOf(Q3, ['a'])).projectIds, ['a']);
});

test('an empty range has an empty previous period', () => {
  assert.deepEqual(previousScope(scopeOf([])).periods, []);
});

// ── The comparison ─────────────────────────────────────────────────────────────

test('every project with any spending is in, at zero if it spent nothing on the category', () => {
  const { rows, inactive } = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: LEDGER, category: 'Labour' });
  assert.deepEqual(rows.map(r => [r.label, r.amount]), [['Alpha', 300], ['Bravo', 900], ['Charlie', 0]]);
  // Zulu spent nothing at all, in either period: named, not drawn.
  assert.deepEqual(inactive, ['Zulu']);
});

test('a project active only in the previous period stays in, at zero now', () => {
  const ledger = [exp('z', '2026-04-01', 50)];
  const { rows, inactive } = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: ledger, category: 'Labour' });
  assert.deepEqual(rows.map(r => [r.key, r.amount, r.previousAmount]), [['z', 0, 50]]);
  assert.equal(inactive.includes('Zulu'), false);
});

test('by default projects keep their own order, by name — the order a reader finds them in', () => {
  const { rows } = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: LEDGER, category: 'Labour' });
  assert.deepEqual(rows.map(r => r.label), ['Alpha', 'Bravo', 'Charlie']);
});

test('sorting highest first ranks by the chosen measure', () => {
  const { rows } = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: LEDGER, category: 'Labour', sort: 'highest' });
  assert.deepEqual(rows.map(r => r.label), ['Bravo', 'Alpha', 'Charlie']);
});

test('the change against the previous period is per project, with its percentage', () => {
  const { rows, total, previousTotal } = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: LEDGER, category: 'Labour' });
  const alpha = rows.find(r => r.key === 'a');
  assert.equal(alpha.previousAmount, 150);
  assert.equal(alpha.change, 150);
  assert.equal(alpha.changePct, 1); // doubled
  const bravo = rows.find(r => r.key === 'b');
  assert.equal(bravo.change, 0);
  assert.equal(bravo.changePct, 0);
  assert.equal(total, 1200);
  assert.equal(previousTotal, 1050);
});

test('a change from nothing has no percentage — "up from zero" has no ratio', () => {
  const { rows } = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: LEDGER, category: 'Material' });
  const alpha = rows.find(r => r.key === 'a');
  assert.equal(alpha.previousValue, 0);
  assert.equal(alpha.changePct, null);
});

test('share measures each project against its own spending', () => {
  const { rows } = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: LEDGER, category: 'Labour', measure: 'share' });
  // Alpha: 300 of its 600. Bravo: all 900 of 900. Charlie: 0 of 200.
  assert.deepEqual(rows.map(r => [r.key, r.value]), [['a', 50], ['b', 100], ['c', 0]]);
});

test('monthly is the average across the months of the range', () => {
  const { rows } = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: LEDGER, category: 'Labour', measure: 'monthly' });
  assert.equal(rows.find(r => r.key === 'b').value, 300); // 900 over 3 months
  assert.equal(rows.find(r => r.key === 'b').monthly, 300);
});

test('no category compares total spending', () => {
  const { rows } = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: LEDGER, category: null });
  assert.deepEqual(rows.map(r => [r.key, r.amount]), [['a', 600], ['b', 900], ['c', 200]]);
});

test('a sub-category narrows the comparison', () => {
  const ledger = [exp('a', '2026-07-01', 70, 'Labour', 'Skilled'), exp('a', '2026-07-01', 30, 'Labour', 'Unskilled')];
  const { rows } = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: ledger, category: 'Labour', subCategory: 'Skilled' });
  assert.equal(rows[0].amount, 70);
});

test('the average, highest and lowest describe the drawn values', () => {
  const r = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: LEDGER, category: 'Labour' });
  assert.equal(r.average, 400); // (300 + 900 + 0) / 3
  assert.equal(r.highest.label, 'Bravo');
  assert.equal(r.lowest.label, 'Charlie');
});

test('the project scope limits who is compared', () => {
  const { rows } = projectComparison({ scope: scopeOf(Q3, ['a', 'b']), projects: PROJECTS, expenses: LEDGER, category: 'Labour' });
  assert.deepEqual(rows.map(r => r.key), ['a', 'b']);
});

test('nothing in view gives an empty comparison, not a crash', () => {
  const r = projectComparison({ scope: scopeOf(), projects: PROJECTS, expenses: [], category: 'Labour' });
  assert.deepEqual([r.rows.length, r.average, r.highest, r.lowest], [0, 0, null, null]);
  assert.equal(r.inactive.length, 4);
});
