/**
 * The figures behind the dashboard's Graphical Reports tab.
 *
 * Every chart on that tab is a picture of a number someone will act on — "we have ₹2L in hand",
 * "Site B is at 112% of budget" — so the arithmetic lives here, importless, where `node --test`
 * can check it, rather than inside the components that draw it. The components only map these
 * results onto marks.
 *
 * Two rules hold throughout, because they are what make the charts agree with each other and
 * with the rest of the module:
 *
 *   1. One scope. Every function takes the same `ChartScope` — which projects, which months — so
 *      the tiles, the trend, the categories and the budget bars always describe the same slice.
 *   2. Budgets follow the Site Fund Budget page. A month's budget is its monthly figure plus its
 *      verified allocations, exactly as that page computes it; a budget the page would not show
 *      for a period is not invented here either.
 */

export interface ChartExpense {
  projectId: string;
  expenseDate: string;
  expenseAmount: number;
  expenseCategory?: string;
  expenseSubCategory?: string;
}

export interface ChartReceipt {
  projectId: string;
  receiptDate: string;
  receivedAmount: number;
}

export interface ChartBudget {
  projectId: string;
  budgetType: 'total' | 'monthly' | 'fy';
  /** `YYYY-MM` for monthly, `YYYY-YY` for FY, absent for total. */
  period?: string;
  budgetAmount: number;
}

export interface ChartAllocation {
  projectId: string;
  period: string;
  amount: number;
  status: string;
}

export interface ChartProject {
  id: string;
  name: string;
}

/**
 * Which slice of the ledger a chart describes.
 *
 * `periods` is the ordered list of months, `YYYY-MM`. `projectIds` of null means every project the
 * caller passed in — the caller has already limited that list to what the user may see.
 */
export interface ChartScope {
  projectIds: string[] | null;
  periods: string[];
}

// ── Scope helpers ─────────────────────────────────────────────────────────────

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function inProjects(scope: ChartScope, projectId: string): boolean {
  return scope.projectIds === null || scope.projectIds.includes(projectId);
}

function periodOf(date: string | undefined): string {
  return (date ?? '').slice(0, 7);
}

/** Whether a dated record falls inside the scope's months and projects. */
function inScope(scope: ChartScope, projectId: string, date: string | undefined, months: Set<string>): boolean {
  return inProjects(scope, projectId) && months.has(periodOf(date));
}

/** `2026` → `2026-27`, the label FY budgets are stored under. */
export function fyLabelFor(startYear: number): string {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

/**
 * The financial years a range covers completely, or null when it does not cover whole years.
 *
 * An FY budget can only be compared with a range that spans the whole year — set against six
 * months of spending it would make every site look half-spent.
 */
export function wholeFinancialYears(periods: string[]): string[] | null {
  if (periods.length === 0 || periods.length % 12 !== 0) return null;
  const years: string[] = [];
  for (let i = 0; i < periods.length; i += 12) {
    const [year, month] = periods[i].split('-').map(Number);
    if (month !== 4 || periods[i + 11] !== `${year + 1}-03`) return null;
    years.push(fyLabelFor(year));
  }
  return years;
}

// ── Receipts and spending over time ───────────────────────────────────────────

export interface FlowPoint {
  period: string;
  received: number;
  spent: number;
  /** Received minus spent within the month. */
  net: number;
}

/** Receipts and expenses per month, every month of the scope present even when empty. */
export function monthlyFlow(
  scope: ChartScope,
  expenses: ChartExpense[],
  receipts: ChartReceipt[],
): FlowPoint[] {
  const months = new Set(scope.periods);
  const byMonth = new Map(scope.periods.map(p => [p, { period: p, received: 0, spent: 0, net: 0 }]));
  for (const r of receipts) {
    if (!inScope(scope, r.projectId, r.receiptDate, months)) continue;
    byMonth.get(periodOf(r.receiptDate))!.received += num(r.receivedAmount);
  }
  for (const e of expenses) {
    if (!inScope(scope, e.projectId, e.expenseDate, months)) continue;
    byMonth.get(periodOf(e.expenseDate))!.spent += num(e.expenseAmount);
  }
  return scope.periods.map(p => {
    const point = byMonth.get(p)!;
    return { ...point, net: point.received - point.spent };
  });
}

export interface BalancePoint {
  period: string;
  /** Money in hand at the end of the month: everything received less everything spent, to date. */
  balance: number;
}

/**
 * Money in hand at each month end.
 *
 * Starts from the balance carried in from before the range, not from zero. A balance that ignored
 * history would show a site that has run a ₹5L surplus for years as "₹0 at the start of April",
 * which is a different and wrong statement about how much cash it holds.
 */
export function balanceSeries(
  scope: ChartScope,
  expenses: ChartExpense[],
  receipts: ChartReceipt[],
): { opening: number; points: BalancePoint[] } {
  const first = scope.periods[0];
  if (!first) return { opening: 0, points: [] };

  let opening = 0;
  for (const r of receipts) {
    if (inProjects(scope, r.projectId) && periodOf(r.receiptDate) && periodOf(r.receiptDate) < first) {
      opening += num(r.receivedAmount);
    }
  }
  for (const e of expenses) {
    if (inProjects(scope, e.projectId) && periodOf(e.expenseDate) && periodOf(e.expenseDate) < first) {
      opening -= num(e.expenseAmount);
    }
  }

  let running = opening;
  const points = monthlyFlow(scope, expenses, receipts).map(point => {
    running += point.net;
    return { period: point.period, balance: running };
  });
  return { opening, points };
}

// ── Where the money went ──────────────────────────────────────────────────────

export interface CategorySlice {
  name: string;
  value: number;
  /** Share of all spending in scope, 0–1. */
  share: number;
}

export const UNCATEGORISED = 'Uncategorised';

/**
 * Spending by main category, largest first, with the tail folded into one "Other" row.
 *
 * Folded rather than drawn: past eight bars the smallest are unreadable slivers, and a chart that
 * needs a scroll to finish is a table pretending to be a chart. The folded categories stay
 * available in the table view through `otherNames`.
 */
export function spendByCategory(
  scope: ChartScope,
  expenses: ChartExpense[],
  limit = 8,
): { slices: CategorySlice[]; otherNames: string[]; total: number } {
  const months = new Set(scope.periods);
  const totals = new Map<string, number>();
  let total = 0;
  for (const e of expenses) {
    if (!inScope(scope, e.projectId, e.expenseDate, months)) continue;
    const name = e.expenseCategory?.trim() || UNCATEGORISED;
    const amount = num(e.expenseAmount);
    totals.set(name, (totals.get(name) ?? 0) + amount);
    total += amount;
  }

  const ranked = [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Folding exactly one category into "Other" hides its name for nothing, so fold only when
  // at least two would go.
  const keep = ranked.length > limit ? limit - 1 : ranked.length;
  const shown = ranked.slice(0, keep);
  const folded = ranked.slice(keep);

  const slices: CategorySlice[] = shown.map(([name, value]) => ({
    name, value, share: total ? value / total : 0,
  }));
  if (folded.length) {
    const value = folded.reduce((sum, [, v]) => sum + v, 0);
    slices.push({ name: `Other (${folded.length})`, value, share: total ? value / total : 0 });
  }
  return { slices, otherNames: folded.map(([name]) => name), total };
}

// ── Budget against spending ───────────────────────────────────────────────────

/** A month's budget as the Site Fund Budget page computes it: monthly figure plus verified allocations. */
export function monthBudget(
  projectId: string,
  period: string,
  budgets: ChartBudget[],
  allocations: ChartAllocation[],
): number {
  const monthly = budgets
    .filter(b => b.projectId === projectId && b.budgetType === 'monthly' && b.period === period)
    .reduce((sum, b) => sum + num(b.budgetAmount), 0);
  const allocated = allocations
    .filter(a => a.projectId === projectId && a.period === period && a.status === 'approved')
    .reduce((sum, a) => sum + num(a.amount), 0);
  return monthly + allocated;
}

export interface BudgetUseRow {
  key: string;
  label: string;
  budget: number;
  spent: number;
  /** Spent as a percentage of budget. */
  pct: number;
  over: boolean;
  /** Where the budget figure came from, for the table view. */
  source: 'monthly' | 'fy';
}

/**
 * A project's budget for exactly the months in scope, or null when it has none to compare.
 *
 * Monthly budgets (with their verified allocations) first, since they map onto months directly.
 * Failing those, FY budgets — but only when the range is whole financial years. A total budget is
 * never apportioned: it covers the project's life, and slicing it by month would be a guess
 * presented as a figure.
 */
export function budgetForRange(
  projectId: string,
  periods: string[],
  budgets: ChartBudget[],
  allocations: ChartAllocation[],
): { amount: number; source: 'monthly' | 'fy' } | null {
  const monthly = periods.reduce((sum, p) => sum + monthBudget(projectId, p, budgets, allocations), 0);
  if (monthly > 0) return { amount: monthly, source: 'monthly' };

  const years = wholeFinancialYears(periods);
  if (years) {
    const fy = budgets
      .filter(b => b.projectId === projectId && b.budgetType === 'fy' && years.includes(b.period ?? ''))
      .reduce((sum, b) => sum + num(b.budgetAmount), 0);
    if (fy > 0) return { amount: fy, source: 'fy' };
  }
  return null;
}

function toBudgetUseRow(key: string, label: string, budget: number, spent: number, source: BudgetUseRow['source']): BudgetUseRow {
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  return { key, label, budget, spent, pct, over: spent > budget, source };
}

/**
 * Budget used, compared across projects — or, for a single project, across its months.
 *
 * One project as one bar would be a chart of a single number, which is a stat tile's job; across
 * its months the same measure shows where in the year the money went.
 *
 * Rows come back most-used first, so an over-budget site is the first thing read. Anything with
 * no budget for the scope is not drawn as 0% — that would read as "spent nothing" — but listed in
 * `unbudgeted`, so the chart can say who is missing.
 */
export function budgetUse({
  scope,
  projects,
  expenses,
  budgets,
  allocations,
  periodLabel = (p: string) => p,
}: {
  scope: ChartScope;
  projects: ChartProject[];
  expenses: ChartExpense[];
  budgets: ChartBudget[];
  allocations: ChartAllocation[];
  periodLabel?: (period: string) => string;
}): { by: 'project' | 'month'; rows: BudgetUseRow[]; unbudgeted: string[] } {
  const months = new Set(scope.periods);
  const visible = projects.filter(p => inProjects(scope, p.id));

  if (visible.length === 1) {
    const project = visible[0];
    const spentBy = new Map<string, number>();
    for (const e of expenses) {
      if (e.projectId !== project.id || !months.has(periodOf(e.expenseDate))) continue;
      spentBy.set(periodOf(e.expenseDate), (spentBy.get(periodOf(e.expenseDate)) ?? 0) + num(e.expenseAmount));
    }
    const rows: BudgetUseRow[] = [];
    const unbudgeted: string[] = [];
    for (const period of scope.periods) {
      const budget = monthBudget(project.id, period, budgets, allocations);
      if (budget > 0) rows.push(toBudgetUseRow(period, periodLabel(period), budget, spentBy.get(period) ?? 0, 'monthly'));
      else unbudgeted.push(periodLabel(period));
    }
    // By month, the calendar order is the story, so these stay in order rather than ranked.
    return { by: 'month', rows, unbudgeted };
  }

  const spentBy = new Map<string, number>();
  for (const e of expenses) {
    if (!inScope(scope, e.projectId, e.expenseDate, months)) continue;
    spentBy.set(e.projectId, (spentBy.get(e.projectId) ?? 0) + num(e.expenseAmount));
  }
  const rows: BudgetUseRow[] = [];
  const unbudgeted: string[] = [];
  for (const project of visible) {
    const budget = budgetForRange(project.id, scope.periods, budgets, allocations);
    if (budget) rows.push(toBudgetUseRow(project.id, project.name, budget.amount, spentBy.get(project.id) ?? 0, budget.source));
    else unbudgeted.push(project.name);
  }
  rows.sort((a, b) => b.pct - a.pct || a.label.localeCompare(b.label));
  return { by: 'project', rows, unbudgeted: unbudgeted.sort((a, b) => a.localeCompare(b)) };
}

// ── Headline figures ──────────────────────────────────────────────────────────

export interface HeadlineFigures {
  received: number;
  spent: number;
  /** Received minus spent within the scope. */
  net: number;
  /** Total budget of the rows that have one. */
  budget: number;
  /** Spending against that budget, as a percentage — null when nothing in scope is budgeted. */
  budgetUsedPct: number | null;
  /** Money in hand at the end of the range, history included. */
  closingBalance: number;
}

/**
 * The tile row above the charts, computed from the same results the charts use.
 *
 * Budget used is measured over budgeted rows only. Spending on a site with no budget for the
 * period has no ceiling to be measured against, and counting it would push every percentage up
 * by money that was never limited.
 */
export function headlineFigures(
  flow: FlowPoint[],
  balance: { points: BalancePoint[]; opening: number },
  use: { rows: BudgetUseRow[] },
): HeadlineFigures {
  const received = flow.reduce((sum, p) => sum + p.received, 0);
  const spent = flow.reduce((sum, p) => sum + p.spent, 0);
  const budget = use.rows.reduce((sum, r) => sum + r.budget, 0);
  const budgetedSpent = use.rows.reduce((sum, r) => sum + r.spent, 0);
  const last = balance.points[balance.points.length - 1];
  return {
    received,
    spent,
    net: received - spent,
    budget,
    budgetUsedPct: budget > 0 ? (budgetedSpent / budget) * 100 : null,
    closingBalance: last ? last.balance : balance.opening,
  };
}

// ── Projects × categories ─────────────────────────────────────────────────────

export interface CategoryOption {
  name: string;
  value: number;
}

function categoryName(e: ChartExpense): string {
  return e.expenseCategory?.trim() || UNCATEGORISED;
}

function rankOptions(totals: Map<string, number>): CategoryOption[] {
  return [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/** Every category spent on in scope, largest first — the choices for the category picker. */
export function categoryOptions(scope: ChartScope, expenses: ChartExpense[]): CategoryOption[] {
  const months = new Set(scope.periods);
  const totals = new Map<string, number>();
  for (const e of expenses) {
    if (!inScope(scope, e.projectId, e.expenseDate, months)) continue;
    totals.set(categoryName(e), (totals.get(categoryName(e)) ?? 0) + num(e.expenseAmount));
  }
  return rankOptions(totals);
}

/**
 * The label for expenses filed under a category with no sub-category. They are offered as their
 * own row rather than dropped, so the sub-category totals still add up to the category's.
 */
export const NO_SUB_CATEGORY = 'No sub-category';

function subCategoryName(e: ChartExpense): string {
  return e.expenseSubCategory?.trim() || NO_SUB_CATEGORY;
}

/** The sub-categories of one category, largest first. */
export function subCategoryOptions(scope: ChartScope, expenses: ChartExpense[], category: string): CategoryOption[] {
  const months = new Set(scope.periods);
  const totals = new Map<string, number>();
  for (const e of expenses) {
    if (!inScope(scope, e.projectId, e.expenseDate, months) || categoryName(e) !== category) continue;
    totals.set(subCategoryName(e), (totals.get(subCategoryName(e)) ?? 0) + num(e.expenseAmount));
  }
  return rankOptions(totals);
}

/**
 * "Which project is consuming more" has two honest readings.
 *
 * `amount`: who spent the most rupees on it. `share`: who spends the largest part of their own
 * money on it. A small site that puts 40% of everything into Labour is consuming more Labour than
 * its size suggests, and the amount ranking alone would bury it under the large sites.
 */
export type ConsumptionMeasure = 'amount' | 'share';

export interface ProjectConsumptionRow {
  key: string;
  label: string;
  /** Spent on the chosen category (and sub-category) in scope. */
  amount: number;
  /** Everything the project spent in scope, any category. */
  projectTotal: number;
  /** `amount` as a share of the project's own spending, 0–1. */
  shareOfProject: number;
  /** `amount` as a share of every project's spending on the category, 0–1. */
  shareOfCategory: number;
}

/**
 * Projects ranked by how much of one category they consume.
 *
 * `category` of null means all spending, which ranks projects by their total; `subCategory`
 * narrows a category to one of its sub-categories. Projects that spent nothing on it are left
 * out — a column of zero-length bars says nothing a footnote cannot.
 */
export function projectConsumption({
  scope,
  projects,
  expenses,
  category,
  subCategory = null,
  measure = 'amount',
}: {
  scope: ChartScope;
  projects: ChartProject[];
  expenses: ChartExpense[];
  category: string | null;
  subCategory?: string | null;
  measure?: ConsumptionMeasure;
}): { rows: ProjectConsumptionRow[]; total: number } {
  const months = new Set(scope.periods);
  const amount = new Map<string, number>();
  const projectTotal = new Map<string, number>();
  let total = 0;
  for (const e of expenses) {
    if (!inScope(scope, e.projectId, e.expenseDate, months)) continue;
    const value = num(e.expenseAmount);
    projectTotal.set(e.projectId, (projectTotal.get(e.projectId) ?? 0) + value);
    if (category !== null && categoryName(e) !== category) continue;
    if (subCategory !== null && subCategoryName(e) !== subCategory) continue;
    amount.set(e.projectId, (amount.get(e.projectId) ?? 0) + value);
    total += value;
  }

  const rows: ProjectConsumptionRow[] = projects
    .filter(p => inProjects(scope, p.id) && (amount.get(p.id) ?? 0) > 0)
    .map(p => {
      const spent = amount.get(p.id) ?? 0;
      const own = projectTotal.get(p.id) ?? 0;
      return {
        key: p.id,
        label: p.name,
        amount: spent,
        projectTotal: own,
        shareOfProject: own > 0 ? spent / own : 0,
        shareOfCategory: total > 0 ? spent / total : 0,
      };
    });

  const by = (r: ProjectConsumptionRow) => (measure === 'share' ? r.shareOfProject : r.amount);
  rows.sort((a, b) => by(b) - by(a) || b.amount - a.amount || a.label.localeCompare(b.label));
  return { rows, total };
}

export interface CategoryMatrix {
  /** Column headings: the largest categories, then one folded "Other (n)" when needed. */
  columns: string[];
  /** The categories folded into the last column, for its tooltip and the table view. */
  otherNames: string[];
  rows: { key: string; label: string; cells: number[]; total: number }[];
  /** The largest single cell — the top of the colour scale. */
  max: number;
}

/**
 * Every project against every category, for the grid.
 *
 * Columns are chosen across the whole scope, not per project, so a column means the same
 * category on every row. The tail folds into one column exactly as the category chart folds it,
 * so the two never disagree about which categories are "the big ones".
 */
export function categoryMatrix({
  scope,
  projects,
  expenses,
  limit = 8,
}: {
  scope: ChartScope;
  projects: ChartProject[];
  expenses: ChartExpense[];
  limit?: number;
}): CategoryMatrix {
  const { slices, otherNames } = spendByCategory(scope, expenses, limit);
  const named = (otherNames.length ? slices.slice(0, -1) : slices).map(s => s.name);
  const columns = otherNames.length ? [...named, `Other (${otherNames.length})`] : named;
  const index = new Map(named.map((name, i) => [name, i]));
  const otherIndex = otherNames.length ? columns.length - 1 : -1;

  const months = new Set(scope.periods);
  const cellsBy = new Map<string, number[]>();
  for (const e of expenses) {
    if (!inScope(scope, e.projectId, e.expenseDate, months)) continue;
    const column = index.get(categoryName(e)) ?? otherIndex;
    if (column < 0) continue;
    const cells = cellsBy.get(e.projectId) ?? new Array<number>(columns.length).fill(0);
    cells[column] += num(e.expenseAmount);
    cellsBy.set(e.projectId, cells);
  }

  const rows = projects
    .filter(p => inProjects(scope, p.id) && cellsBy.has(p.id))
    .map(p => {
      const cells = cellsBy.get(p.id)!;
      return { key: p.id, label: p.name, cells, total: cells.reduce((s, v) => s + v, 0) };
    })
    .filter(r => r.total !== 0)
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  const max = rows.reduce((m, r) => Math.max(m, ...r.cells), 0);
  return { columns, otherNames, rows, max };
}

/**
 * Which step of a sequential ramp a value falls on, or -1 for nothing at all.
 *
 * Linear, not by rank: the grid's job is magnitude, and quantile steps would make a ₹5,000 cell
 * look as dark as a ₹5 L one merely because both sit at the top of their row. Zero gets no colour
 * — an empty cell, not the palest blue — so "spent nothing" and "spent a little" read apart.
 */
export function sequentialStep(value: number, max: number, steps = 6): number {
  if (!(value > 0) || !(max > 0)) return -1;
  return Math.min(steps - 1, Math.max(0, Math.ceil((value / max) * steps) - 1));
}

export interface CategoryTrendPoint {
  period: string;
  spent: number;
}

/**
 * Spending on one category (or one of its sub-categories) per month, every month present.
 *
 * The time view of the same choice the ranking makes: the ranking says who consumes the most, this
 * says whether consumption of it is rising. `category` of null is all spending.
 */
export function categoryTrend(
  scope: ChartScope,
  expenses: ChartExpense[],
  category: string | null,
  subCategory: string | null = null,
): CategoryTrendPoint[] {
  const months = new Set(scope.periods);
  const byMonth = new Map(scope.periods.map(p => [p, 0]));
  for (const e of expenses) {
    if (!inScope(scope, e.projectId, e.expenseDate, months)) continue;
    if (category !== null && categoryName(e) !== category) continue;
    if (subCategory !== null && subCategoryName(e) !== subCategory) continue;
    const period = periodOf(e.expenseDate);
    byMonth.set(period, (byMonth.get(period) ?? 0) + num(e.expenseAmount));
  }
  return scope.periods.map(period => ({ period, spent: byMonth.get(period) ?? 0 }));
}

// ── Project comparison ────────────────────────────────────────────────────────

/** `YYYY-MM` shifted by whole months. Local so this module stays importless. */
function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * The same number of months immediately before a scope, same projects.
 *
 * "Compared with the previous period" means like for like: twelve months against the twelve
 * before them, one quarter against the one before. A comparison against a period of a different
 * length would make every site look as if it had changed.
 */
export function previousScope(scope: ChartScope): ChartScope {
  const n = scope.periods.length;
  if (n === 0) return { ...scope, periods: [] };
  return { ...scope, periods: Array.from({ length: n }, (_, i) => shiftMonth(scope.periods[0], i - n)) };
}

/**
 * What a project's figure means in the comparison.
 *
 * `amount`: rupees spent on the category. `share`: the part of the project's own spending that went
 * on it. `monthly`: the average per month across the period — the fair figure when a project only
 * started part-way through the range.
 */
export type ComparisonMeasure = 'amount' | 'share' | 'monthly';
export type ComparisonSort = 'project' | 'highest';

export interface ComparisonRow {
  key: string;
  label: string;
  /** The figure the chart draws, in the chosen measure. */
  value: number;
  amount: number;
  projectTotal: number;
  shareOfProject: number;
  /** Average per month over the scope's months. */
  monthly: number;
  /** The same figure for the previous period of equal length. */
  previousValue: number;
  previousAmount: number;
  /** `value - previousValue`. */
  change: number;
  /** `change` as a fraction of `previousValue`; null when there was nothing before to compare. */
  changePct: number | null;
}

export interface ProjectComparison {
  rows: ComparisonRow[];
  /** Mean of `value` across the rows — the chart's reference line. */
  average: number;
  /** Total spent on the category across the rows, in rupees. */
  total: number;
  previousTotal: number;
  highest: ComparisonRow | null;
  lowest: ComparisonRow | null;
  /** Projects in view with no spending at all in either period, named rather than drawn. */
  inactive: string[];
}

interface Tally {
  amount: Map<string, number>;
  projectTotal: Map<string, number>;
}

function tally(
  scope: ChartScope,
  expenses: ChartExpense[],
  category: string | null,
  subCategory: string | null,
): Tally {
  const months = new Set(scope.periods);
  const amount = new Map<string, number>();
  const projectTotal = new Map<string, number>();
  for (const e of expenses) {
    if (!inScope(scope, e.projectId, e.expenseDate, months)) continue;
    const value = num(e.expenseAmount);
    projectTotal.set(e.projectId, (projectTotal.get(e.projectId) ?? 0) + value);
    if (category !== null && categoryName(e) !== category) continue;
    if (subCategory !== null && subCategoryName(e) !== subCategory) continue;
    amount.set(e.projectId, (amount.get(e.projectId) ?? 0) + value);
  }
  return { amount, projectTotal };
}

function measureOf(measure: ComparisonMeasure, amount: number, projectTotal: number, months: number): number {
  if (measure === 'share') return projectTotal > 0 ? (amount / projectTotal) * 100 : 0;
  if (measure === 'monthly') return months > 0 ? amount / months : 0;
  return amount;
}

/**
 * Every project's consumption of one category, side by side, with the previous period beside it.
 *
 * Unlike the ranking on the Graphical Reports tab, a project that spent nothing on the category
 * but did spend on other things stays in, at zero: across a row of projects, "this site spends
 * nothing on transport" is a finding, not an absence. Only projects with no spending at all, in
 * either period, are left out — and named.
 *
 * `sort: 'project'` keeps the projects in their own order (by name), which is how a reader finds
 * a site; `'highest'` ranks by the chosen measure.
 */
export function projectComparison({
  scope,
  projects,
  expenses,
  category,
  subCategory = null,
  measure = 'amount',
  sort = 'project',
}: {
  scope: ChartScope;
  projects: ChartProject[];
  expenses: ChartExpense[];
  category: string | null;
  subCategory?: string | null;
  measure?: ComparisonMeasure;
  sort?: ComparisonSort;
}): ProjectComparison {
  const before = previousScope(scope);
  const now = tally(scope, expenses, category, subCategory);
  const then = tally(before, expenses, category, subCategory);
  const months = scope.periods.length;

  const rows: ComparisonRow[] = [];
  const inactive: string[] = [];
  for (const project of projects) {
    if (!inProjects(scope, project.id)) continue;
    const projectTotal = now.projectTotal.get(project.id) ?? 0;
    const previousProjectTotal = then.projectTotal.get(project.id) ?? 0;
    if (projectTotal === 0 && previousProjectTotal === 0) {
      inactive.push(project.name);
      continue;
    }
    const amount = now.amount.get(project.id) ?? 0;
    const previousAmount = then.amount.get(project.id) ?? 0;
    const value = measureOf(measure, amount, projectTotal, months);
    const previousValue = measureOf(measure, previousAmount, previousProjectTotal, before.periods.length);
    const change = value - previousValue;
    rows.push({
      key: project.id,
      label: project.name,
      value,
      amount,
      projectTotal,
      shareOfProject: projectTotal > 0 ? amount / projectTotal : 0,
      monthly: months > 0 ? amount / months : 0,
      previousValue,
      previousAmount,
      change,
      changePct: previousValue > 0 ? change / previousValue : null,
    });
  }

  rows.sort(sort === 'highest'
    ? (a, b) => b.value - a.value || a.label.localeCompare(b.label)
    : (a, b) => a.label.localeCompare(b.label));

  const average = rows.length ? rows.reduce((s, r) => s + r.value, 0) / rows.length : 0;
  const byValue = [...rows].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return {
    rows,
    average,
    total: rows.reduce((s, r) => s + r.amount, 0),
    previousTotal: rows.reduce((s, r) => s + r.previousAmount, 0),
    highest: byValue[0] ?? null,
    lowest: byValue[byValue.length - 1] ?? null,
    inactive: inactive.sort((a, b) => a.localeCompare(b)),
  };
}
