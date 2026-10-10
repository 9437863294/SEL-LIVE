import test from 'node:test';
import assert from 'node:assert/strict';

const {
  fyLabelFor,
  wholeFinancialYears,
  monthlyFlow,
  balanceSeries,
  spendByCategory,
  monthBudget,
  budgetForRange,
  budgetUse,
  headlineFigures,
  UNCATEGORISED,
} = await import('../src/lib/site-account-statement-charts.ts');

const Q3 = ['2026-07', '2026-08', '2026-09'];
const all = (periods = Q3) => ({ projectIds: null, periods });
const only = (ids, periods = Q3) => ({ projectIds: ids, periods });

const exp = (projectId, expenseDate, expenseAmount, expenseCategory = 'Labour') =>
  ({ projectId, expenseDate, expenseAmount, expenseCategory });
const rec = (projectId, receiptDate, receivedAmount) => ({ projectId, receiptDate, receivedAmount });

const FY_2026 = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
  '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];

// ── Financial years ────────────────────────────────────────────────────────────

test('FY labels match how FY budgets are stored', () => {
  assert.equal(fyLabelFor(2026), '2026-27');
  assert.equal(fyLabelFor(1999), '1999-00');
});

test('a range is whole financial years only when it runs April to March', () => {
  assert.deepEqual(wholeFinancialYears(FY_2026), ['2026-27']);
  assert.equal(wholeFinancialYears(Q3), null);
  // Twelve months, but not April to March.
  const julToJun = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
    '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06'];
  assert.equal(wholeFinancialYears(julToJun), null);
  assert.equal(wholeFinancialYears([]), null);
});

// ── Flow over time ─────────────────────────────────────────────────────────────

test('monthly flow totals receipts and spending per month', () => {
  const flow = monthlyFlow(all(),
    [exp('p1', '2026-07-10', 300), exp('p1', '2026-07-20', 200), exp('p2', '2026-09-01', 50)],
    [rec('p1', '2026-07-05', 1000)],
  );
  assert.deepEqual(flow, [
    { period: '2026-07', received: 1000, spent: 500, net: 500 },
    { period: '2026-08', received: 0, spent: 0, net: 0 },
    { period: '2026-09', received: 0, spent: 50, net: -50 },
  ]);
});

test('every month of the range is present, even with no records', () => {
  assert.equal(monthlyFlow(all(), [], []).length, 3);
});

test('records outside the months or the projects are left out', () => {
  const flow = monthlyFlow(only(['p1']),
    [exp('p1', '2026-06-30', 999), exp('p2', '2026-07-01', 999), exp('p1', '2026-07-01', 10)],
    [rec('p1', '2026-10-01', 999)],
  );
  assert.equal(flow[0].spent, 10);
  assert.equal(flow.reduce((s, p) => s + p.received, 0), 0);
});

test('amounts stored as strings or junk are tolerated', () => {
  const flow = monthlyFlow(all(), [exp('p1', '2026-07-01', '250'), exp('p1', '2026-07-02', 'abc')], []);
  assert.equal(flow[0].spent, 250);
});

// ── Balance in hand ────────────────────────────────────────────────────────────

test('the balance carries in history from before the range', () => {
  // ₹5,000 surplus built up before July must not vanish at the start of the range.
  const { opening, points } = balanceSeries(all(),
    [exp('p1', '2026-03-01', 1000), exp('p1', '2026-07-15', 400)],
    [rec('p1', '2026-02-01', 6000), rec('p1', '2026-08-01', 100)],
  );
  assert.equal(opening, 5000);
  assert.deepEqual(points.map(p => p.balance), [4600, 4700, 4700]);
});

test('records after the range do not leak into the opening balance', () => {
  const { opening } = balanceSeries(all(), [], [rec('p1', '2026-12-01', 999)]);
  assert.equal(opening, 0);
});

test('the balance respects the project scope, history included', () => {
  const { opening } = balanceSeries(only(['p1']), [], [rec('p1', '2026-01-01', 10), rec('p2', '2026-01-01', 999)]);
  assert.equal(opening, 10);
});

test('the balance can go negative — spending beyond receipts is shown, not clamped', () => {
  const { points } = balanceSeries(all(), [exp('p1', '2026-07-01', 500)], []);
  assert.equal(points[0].balance, -500);
});

test('an empty range has no points', () => {
  assert.deepEqual(balanceSeries(all([]), [], []), { opening: 0, points: [] });
});

// ── Categories ─────────────────────────────────────────────────────────────────

test('categories are ranked largest first, with shares', () => {
  const { slices, total } = spendByCategory(all(), [
    exp('p1', '2026-07-01', 100, 'Food'),
    exp('p1', '2026-07-02', 300, 'Labour'),
    exp('p1', '2026-07-03', 100, 'Labour'),
  ]);
  assert.equal(total, 500);
  assert.deepEqual(slices.map(s => [s.name, s.value]), [['Labour', 400], ['Food', 100]]);
  assert.equal(slices[0].share, 0.8);
});

test('a blank category is shown as Uncategorised, not dropped', () => {
  const { slices } = spendByCategory(all(), [exp('p1', '2026-07-01', 100, '  ')]);
  assert.equal(slices[0].name, UNCATEGORISED);
});

test('the tail folds into one Other row, keeping the names for the table', () => {
  const many = Array.from({ length: 11 }, (_, i) => exp('p1', '2026-07-01', 100 - i, `C${i}`));
  const { slices, otherNames } = spendByCategory(all(), many, 8);
  assert.equal(slices.length, 8);
  assert.equal(slices[7].name, 'Other (4)');
  assert.deepEqual(otherNames, ['C7', 'C8', 'C9', 'C10']);
});

test('exactly the limit is shown without folding', () => {
  const eight = Array.from({ length: 8 }, (_, i) => exp('p1', '2026-07-01', 10 + i, `C${i}`));
  const { slices, otherNames } = spendByCategory(all(), eight, 8);
  assert.equal(slices.length, 8);
  assert.deepEqual(otherNames, []);
});

test('ties are broken by name, so the order is stable between renders', () => {
  const { slices } = spendByCategory(all(), [exp('p1', '2026-07-01', 50, 'B'), exp('p1', '2026-07-01', 50, 'A')]);
  assert.deepEqual(slices.map(s => s.name), ['A', 'B']);
});

// ── Budgets ────────────────────────────────────────────────────────────────────

const monthly = (projectId, period, budgetAmount) => ({ projectId, budgetType: 'monthly', period, budgetAmount });
const fy = (projectId, period, budgetAmount) => ({ projectId, budgetType: 'fy', period, budgetAmount });
const total = (projectId, budgetAmount) => ({ projectId, budgetType: 'total', budgetAmount });
const alloc = (projectId, period, amount, status = 'approved') => ({ projectId, period, amount, status });

test('a month budget adds verified allocations, as the budget page does', () => {
  const budgets = [monthly('p1', '2026-07', 1000)];
  const allocations = [alloc('p1', '2026-07', 500), alloc('p1', '2026-07', 900, 'pending'), alloc('p1', '2026-07', 300, 'rejected')];
  assert.equal(monthBudget('p1', '2026-07', budgets, allocations), 1500);
});

test('a range budget sums the months in it', () => {
  const budgets = [monthly('p1', '2026-07', 100), monthly('p1', '2026-08', 200), monthly('p1', '2026-10', 999)];
  assert.deepEqual(budgetForRange('p1', Q3, budgets, []), { amount: 300, source: 'monthly' });
});

test('an FY budget is used only for whole financial years', () => {
  const budgets = [fy('p1', '2026-27', 12000)];
  assert.deepEqual(budgetForRange('p1', FY_2026, budgets, []), { amount: 12000, source: 'fy' });
  // Six months of spending against a whole year's budget would make every site look half-spent.
  assert.equal(budgetForRange('p1', Q3, budgets, []), null);
});

test('a total budget is never apportioned to a range', () => {
  assert.equal(budgetForRange('p1', FY_2026, [total('p1', 50000)], []), null);
});

const PROJECTS = [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Bravo' }, { id: 'p3', name: 'Charlie' }];

test('across projects, the most-used budget comes first', () => {
  const result = budgetUse({
    scope: all(),
    projects: PROJECTS,
    expenses: [exp('p1', '2026-07-01', 50), exp('p2', '2026-07-01', 120)],
    budgets: [monthly('p1', '2026-07', 100), monthly('p2', '2026-07', 100)],
    allocations: [],
  });
  assert.equal(result.by, 'project');
  assert.deepEqual(result.rows.map(r => [r.label, r.pct, r.over]), [['Bravo', 120, true], ['Alpha', 50, false]]);
});

test('a project with no budget for the range is listed, not drawn as 0%', () => {
  const result = budgetUse({
    scope: all(), projects: PROJECTS, expenses: [exp('p3', '2026-07-01', 999)],
    budgets: [monthly('p1', '2026-07', 100)], allocations: [],
  });
  assert.deepEqual(result.rows.map(r => r.label), ['Alpha']);
  assert.deepEqual(result.unbudgeted, ['Bravo', 'Charlie']);
});

test('a budgeted project with no spending reads 0%, which is a real answer', () => {
  const result = budgetUse({
    scope: all(), projects: PROJECTS.slice(0, 1), expenses: [],
    budgets: [monthly('p1', '2026-07', 100)], allocations: [],
  });
  // A single project switches to the by-month view.
  assert.equal(result.by, 'month');
  assert.equal(result.rows[0].pct, 0);
});

test('one project is compared across its months, in calendar order', () => {
  const result = budgetUse({
    scope: only(['p1']),
    projects: PROJECTS,
    expenses: [exp('p1', '2026-07-05', 80), exp('p1', '2026-09-05', 300), exp('p2', '2026-07-05', 999)],
    budgets: [monthly('p1', '2026-07', 100), monthly('p1', '2026-09', 200)],
    allocations: [alloc('p1', '2026-09', 100)],
    periodLabel: p => `M${p.slice(5)}`,
  });
  assert.equal(result.by, 'month');
  assert.deepEqual(result.rows.map(r => [r.label, r.budget, r.spent]), [['M07', 100, 80], ['M09', 300, 300]]);
  // August had no budget: named, not drawn.
  assert.deepEqual(result.unbudgeted, ['M08']);
  // Exactly at budget is not over it.
  assert.equal(result.rows[1].over, false);
});

test('spending outside the range never counts against the range budget', () => {
  const result = budgetUse({
    scope: all(), projects: PROJECTS.slice(0, 2),
    expenses: [exp('p1', '2026-12-01', 999), exp('p1', '2026-07-01', 10)],
    budgets: [monthly('p1', '2026-07', 100)], allocations: [],
  });
  assert.equal(result.rows[0].spent, 10);
});

// ── Headline figures ───────────────────────────────────────────────────────────

test('the headline row agrees with the charts it sits above', () => {
  const scope = all();
  const expenses = [exp('p1', '2026-07-01', 150), exp('p2', '2026-07-01', 50)];
  const receipts = [rec('p1', '2026-07-01', 400), rec('p1', '2026-01-01', 100)];
  const flow = monthlyFlow(scope, expenses, receipts);
  const balance = balanceSeries(scope, expenses, receipts);
  const use = budgetUse({ scope, projects: PROJECTS.slice(0, 2), expenses, budgets: [monthly('p1', '2026-07', 300)], allocations: [] });
  const h = headlineFigures(flow, balance, use);
  assert.equal(h.received, 400);
  assert.equal(h.spent, 200);
  assert.equal(h.net, 200);
  // History included: 100 before the range, plus 200 net within it.
  assert.equal(h.closingBalance, 300);
  // Only budgeted rows: p1 spent 150 of 300. p2's unbudgeted 50 is not counted against it.
  assert.equal(h.budget, 300);
  assert.equal(h.budgetUsedPct, 50);
});

test('budget used is null, not 0%, when nothing in scope has a budget', () => {
  const h = headlineFigures([], { opening: 0, points: [] }, { rows: [] });
  assert.equal(h.budgetUsedPct, null);
  assert.equal(h.closingBalance, 0);
});
