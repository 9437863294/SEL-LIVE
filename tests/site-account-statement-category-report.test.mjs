import test from 'node:test';
import assert from 'node:assert/strict';

const {
  categoryOptions,
  subCategoryOptions,
  projectConsumption,
  categoryMatrix,
  categoryTrend,
  sequentialStep,
  spendByCategory,
  NO_SUB_CATEGORY,
  UNCATEGORISED,
} = await import('../src/lib/site-account-statement-charts.ts');

const Q3 = ['2026-07', '2026-08', '2026-09'];
const all = (periods = Q3) => ({ projectIds: null, periods });
const only = (ids) => ({ projectIds: ids, periods: Q3 });
const exp = (projectId, expenseAmount, expenseCategory = 'Labour', expenseSubCategory, expenseDate = '2026-07-10') =>
  ({ projectId, expenseDate, expenseAmount, expenseCategory, expenseSubCategory });

const PROJECTS = [
  { id: 'big', name: 'Big Site' },
  { id: 'small', name: 'Small Site' },
  { id: 'idle', name: 'Idle Site' },
];

// Big spends a lot on everything; Small spends little but mostly on Labour.
const LEDGER = [
  exp('big', 600, 'Labour', 'Skilled'),
  exp('big', 900, 'Material'),
  exp('big', 500, 'Transport'),
  exp('small', 400, 'Labour', 'Unskilled'),
  exp('small', 100, 'Material'),
];

// ── Pickers ────────────────────────────────────────────────────────────────────

test('category choices are every category in scope, largest first', () => {
  assert.deepEqual(categoryOptions(all(), LEDGER), [
    { name: 'Labour', value: 1000 },
    { name: 'Material', value: 1000 },
    { name: 'Transport', value: 500 },
  ]);
});

test('a blank category is offered as Uncategorised', () => {
  assert.equal(categoryOptions(all(), [exp('big', 10, '')])[0].name, UNCATEGORISED);
});

test('category choices respect the months and projects in scope', () => {
  const outside = [exp('big', 999, 'Fuel', undefined, '2026-12-01'), exp('small', 10, 'Food')];
  assert.deepEqual(categoryOptions(only(['big']), outside), []);
});

test('sub-categories are offered for one category, with the unlabelled ones kept', () => {
  const ledger = [...LEDGER, exp('big', 50, 'Labour')];
  assert.deepEqual(subCategoryOptions(all(), ledger, 'Labour'), [
    { name: 'Skilled', value: 600 },
    { name: 'Unskilled', value: 400 },
    { name: NO_SUB_CATEGORY, value: 50 },
  ]);
});

test('sub-category totals add up to the category total', () => {
  const ledger = [...LEDGER, exp('big', 50, 'Labour')];
  const subs = subCategoryOptions(all(), ledger, 'Labour').reduce((s, o) => s + o.value, 0);
  const cat = categoryOptions(all(), ledger).find(o => o.name === 'Labour').value;
  assert.equal(subs, cat);
});

// ── Who consumes more ─────────────────────────────────────────────────────────

test('by amount, the project that spent the most rupees on the category leads', () => {
  const { rows, total } = projectConsumption({ scope: all(), projects: PROJECTS, expenses: LEDGER, category: 'Labour' });
  assert.equal(total, 1000);
  assert.deepEqual(rows.map(r => [r.label, r.amount]), [['Big Site', 600], ['Small Site', 400]]);
  assert.equal(rows[0].shareOfCategory, 0.6);
});

test('by share, the project spending the largest part of its own money leads', () => {
  // Small puts 400 of its 500 into Labour (80%); Big only 600 of 2,000 (30%).
  const { rows } = projectConsumption({ scope: all(), projects: PROJECTS, expenses: LEDGER, category: 'Labour', measure: 'share' });
  assert.deepEqual(rows.map(r => r.label), ['Small Site', 'Big Site']);
  assert.equal(rows[0].shareOfProject, 0.8);
  assert.equal(rows[1].shareOfProject, 0.3);
});

test("a project's own total counts every category, not just the chosen one", () => {
  const { rows } = projectConsumption({ scope: all(), projects: PROJECTS, expenses: LEDGER, category: 'Labour' });
  assert.equal(rows.find(r => r.key === 'big').projectTotal, 2000);
});

test('projects that spent nothing on the category are left out', () => {
  const { rows } = projectConsumption({ scope: all(), projects: PROJECTS, expenses: LEDGER, category: 'Transport' });
  assert.deepEqual(rows.map(r => r.key), ['big']);
});

test('no category means all spending — projects ranked by their totals', () => {
  const { rows, total } = projectConsumption({ scope: all(), projects: PROJECTS, expenses: LEDGER, category: null });
  assert.equal(total, 2500);
  assert.deepEqual(rows.map(r => [r.key, r.amount]), [['big', 2000], ['small', 500]]);
  assert.equal(rows[0].shareOfProject, 1);
});

test('a sub-category narrows the ranking', () => {
  const { rows, total } = projectConsumption({
    scope: all(), projects: PROJECTS, expenses: LEDGER, category: 'Labour', subCategory: 'Unskilled',
  });
  assert.equal(total, 400);
  assert.deepEqual(rows.map(r => r.key), ['small']);
});

test('the unlabelled sub-category can be chosen like any other', () => {
  const ledger = [...LEDGER, exp('idle', 70, 'Labour')];
  const { rows } = projectConsumption({
    scope: all(), projects: PROJECTS, expenses: ledger, category: 'Labour', subCategory: NO_SUB_CATEGORY,
  });
  assert.deepEqual(rows.map(r => [r.key, r.amount]), [['idle', 70]]);
});

test('ties fall back to amount, then name, so the order is stable', () => {
  const ledger = [exp('big', 100, 'X'), exp('small', 100, 'X')];
  const { rows } = projectConsumption({ scope: all(), projects: PROJECTS, expenses: ledger, category: 'X', measure: 'share' });
  assert.deepEqual(rows.map(r => r.label), ['Big Site', 'Small Site']);
});

test('the project scope limits who is ranked', () => {
  const { rows } = projectConsumption({ scope: only(['small']), projects: PROJECTS, expenses: LEDGER, category: 'Labour' });
  assert.deepEqual(rows.map(r => r.key), ['small']);
});

// ── The grid ───────────────────────────────────────────────────────────────────

test('the grid has a column per category and a row per project with spending', () => {
  const m = categoryMatrix({ scope: all(), projects: PROJECTS, expenses: LEDGER });
  assert.deepEqual(m.columns, ['Labour', 'Material', 'Transport']);
  assert.deepEqual(m.rows.map(r => [r.label, r.cells, r.total]), [
    ['Big Site', [600, 900, 500], 2000],
    ['Small Site', [400, 100, 0], 500],
  ]);
  assert.equal(m.max, 900);
});

test('grid columns fold the tail exactly as the category chart does', () => {
  const many = Array.from({ length: 11 }, (_, i) => exp('big', 100 - i, `C${i}`));
  const m = categoryMatrix({ scope: all(), projects: PROJECTS, expenses: many, limit: 8 });
  const chart = spendByCategory(all(), many, 8);
  assert.equal(m.columns.length, chart.slices.length);
  assert.equal(m.columns[7], 'Other (4)');
  assert.deepEqual(m.otherNames, chart.otherNames);
  // The folded column carries the folded categories' spending.
  assert.equal(m.rows[0].cells[7], 93 + 92 + 91 + 90);
});

test('each row total matches the project spending in scope', () => {
  const m = categoryMatrix({ scope: all(), projects: PROJECTS, expenses: LEDGER });
  const big = projectConsumption({ scope: all(), projects: PROJECTS, expenses: LEDGER, category: null }).rows[0];
  assert.equal(m.rows[0].total, big.amount);
});

test('an empty scope gives an empty grid', () => {
  assert.deepEqual(categoryMatrix({ scope: all(), projects: PROJECTS, expenses: [] }), {
    columns: [], otherNames: [], rows: [], max: 0,
  });
});

// ── Month by month ─────────────────────────────────────────────────────────────

test('a category trend has every month of the range, empty ones as zero', () => {
  const ledger = [
    exp('big', 100, 'Labour', undefined, '2026-07-01'),
    exp('small', 50, 'Labour', undefined, '2026-09-30'),
    exp('big', 999, 'Material', undefined, '2026-08-01'),
  ];
  assert.deepEqual(categoryTrend(all(), ledger, 'Labour'), [
    { period: '2026-07', spent: 100 },
    { period: '2026-08', spent: 0 },
    { period: '2026-09', spent: 50 },
  ]);
});

test('the trend narrows to a sub-category, and widens to all spending with no category', () => {
  assert.equal(categoryTrend(all(), LEDGER, 'Labour', 'Skilled')[0].spent, 600);
  assert.equal(categoryTrend(all(), LEDGER, null)[0].spent, 2500);
});

test('the trend respects the project scope', () => {
  assert.equal(categoryTrend(only(['small']), LEDGER, 'Labour')[0].spent, 400);
});

test('the trend agrees with the ranking total', () => {
  const trend = categoryTrend(all(), LEDGER, 'Labour').reduce((s, p) => s + p.spent, 0);
  const { total } = projectConsumption({ scope: all(), projects: PROJECTS, expenses: LEDGER, category: 'Labour' });
  assert.equal(trend, total);
});

// ── Colour steps ───────────────────────────────────────────────────────────────

test('zero gets no colour at all, so "nothing" and "a little" read apart', () => {
  assert.equal(sequentialStep(0, 100), -1);
  assert.equal(sequentialStep(-5, 100), -1);
  assert.equal(sequentialStep(1, 100), 0);
});

test('steps are linear in the value, the maximum taking the darkest', () => {
  assert.equal(sequentialStep(100, 100), 5);
  assert.equal(sequentialStep(50, 100), 2);
  assert.equal(sequentialStep(51, 100), 3);
  assert.equal(sequentialStep(16, 100), 0);
  assert.equal(sequentialStep(17, 100), 1);
});

test('a value above the maximum, or a zero maximum, is handled', () => {
  assert.equal(sequentialStep(150, 100), 5);
  assert.equal(sequentialStep(10, 0), -1);
});
