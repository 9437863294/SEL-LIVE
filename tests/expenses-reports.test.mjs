import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPENSE_REPORTS,
  EXPENSE_REPORT_GROUPS,
  ageInDays,
  dayKeyOf,
  enrichExpenses,
  expenseReportById,
  filterExpensesForReport,
  formatReportCell,
  monthKeyOf,
} from '../src/lib/expenses-reports.ts';

const MASTERS = {
  projects: [
    { id: 'p1', projectName: 'Bhadla Line' },
    { id: 'p2', projectName: 'Jaipur Substation' },
  ],
  departments: [
    { id: 'd1', name: 'Accounts' },
    { id: 'd2', name: 'Stores' },
  ],
};

const TODAY = new Date(2026, 8, 17); // 17 Sep 2026

/** Local-midnight ISO for a given y/m/d, matching how the module writes imported rows. */
const at = (year, month, day, hour = 9) => new Date(year, month - 1, day, hour).toISOString();

const raw = [
  { id: 'e1', requestNo: 'ACC/0001', departmentId: 'd1', projectId: 'p1', amount: 100000, headOfAccount: 'Direct', subHeadOfAccount: 'Cement', partyName: 'ABC Traders', description: 'Cement', generatedByUser: 'Asha', receptionNo: 'R1', receptionDate: '2026-07-20', createdAt: at(2026, 7, 15) },
  { id: 'e2', requestNo: 'ACC/0002', departmentId: 'd1', projectId: 'p1', amount: 50000, headOfAccount: 'Direct', subHeadOfAccount: 'Sand', partyName: 'ABC Traders', description: 'Sand', generatedByUser: 'Asha', receptionNo: '', receptionDate: '', createdAt: at(2026, 8, 10) },
  { id: 'e3', requestNo: 'STO/0001', departmentId: 'd2', projectId: 'p2', amount: 250000, headOfAccount: 'Admin', subHeadOfAccount: 'Stationery', partyName: 'XYZ Supply', description: 'Paper', generatedByUser: 'Bala', receptionNo: '', receptionDate: '', createdAt: at(2026, 8, 20) },
  { id: 'e4', requestNo: 'STO/0002', departmentId: 'd2', projectId: 'p2', amount: 100000, headOfAccount: 'Admin', subHeadOfAccount: 'Stationery', partyName: 'XYZ Supply', description: 'Paper', generatedByUser: 'Bala', receptionNo: '', receptionDate: '', createdAt: at(2026, 8, 20) },
  // Deliberately unresolvable project, and a department that no longer exists in the masters.
  { id: 'e5', requestNo: 'OLD/0001', departmentId: 'gone', generatedByDepartment: 'Legacy Dept', projectId: 'missing', amount: 1000, headOfAccount: '', subHeadOfAccount: '', partyName: '', description: 'Legacy', generatedByUser: '', receptionNo: '', receptionDate: '', createdAt: at(2026, 5, 2) },
];

const rows = enrichExpenses(raw, MASTERS);
const build = (id, input = {}) => expenseReportById(id).build({ expenses: rows, today: TODAY, ...input });
const cell = (result, rowIndex, key) => result.rows[rowIndex][key];
const rowFor = (result, key, value) => result.rows.find(row => row[key] === value);

/* ── catalogue ───────────────────────────────────────────────────────────── */

test('every report has a unique id, a group the UI knows, and a builder', () => {
  const ids = EXPENSE_REPORTS.map(report => report.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const report of EXPENSE_REPORTS) {
    assert.ok(report.title && report.description, `${report.id} is described`);
    assert.ok(EXPENSE_REPORT_GROUPS.includes(report.group), `${report.id} has a known group`);
    assert.equal(typeof report.build, 'function');
  }
});

test('every report survives an empty selection without throwing', () => {
  for (const report of EXPENSE_REPORTS) {
    const result = report.build({ expenses: [], today: TODAY });
    assert.deepEqual(result.rows, [], `${report.id} has no rows`);
    assert.ok(result.emptyMessage, `${report.id} explains the empty state`);
    assert.ok(Array.isArray(result.columns) && result.columns.length, `${report.id} still declares columns`);
  }
});

test('every report totals to the same figure the register does', () => {
  const register = build('expense-register');
  const grand = Number(register.total.amount);
  assert.equal(grand, 501000);

  for (const id of ['department-summary', 'project-summary', 'head-summary', 'subhead-summary', 'party-summary', 'raised-by-summary', 'monthly-trend', 'daily-summary']) {
    const result = build(id);
    assert.equal(Number(result.total.total), grand, `${id} totals to the register`);
  }
  for (const id of ['department-month-matrix', 'project-month-matrix', 'head-department-matrix']) {
    const result = build(id);
    assert.equal(Number(result.total.total), grand, `${id} totals to the register`);
  }
});

test('an unknown report id resolves to undefined rather than throwing', () => {
  assert.equal(expenseReportById('not-a-report'), undefined);
});

/* ── enrichment ──────────────────────────────────────────────────────────── */

test('names resolve from the masters, and a deleted department keeps its recorded name', () => {
  assert.equal(rows[0].departmentName, 'Accounts');
  assert.equal(rows[0].projectName, 'Bhadla Line');
  assert.equal(rows[4].departmentName, 'Legacy Dept', 'falls back rather than dropping the row');
  assert.equal(rows[4].projectName, 'Unknown Project');
  assert.equal(rows[4].headOfAccount, '(not recorded)');
});

test('a blank amount counts as zero rather than NaN poisoning every total', () => {
  const [enriched] = enrichExpenses([{ id: 'x', amount: undefined, createdAt: at(2026, 7, 1) }], MASTERS);
  assert.equal(enriched.amount, 0);
});

/* ── filtering ───────────────────────────────────────────────────────────── */

test('a date range includes requests raised on its last day', () => {
  const filtered = filterExpensesForReport(rows, {
    from: new Date(2026, 7, 1),
    to: new Date(2026, 7, 20), // e3/e4 are raised at 09:00 on the 20th
  });
  assert.deepEqual(filtered.map(row => row.requestNo), ['ACC/0002', 'STO/0001', 'STO/0002']);
});

test('scope filters compose, and "all" is a no-op', () => {
  assert.equal(filterExpensesForReport(rows, { departmentId: 'd1' }).length, 2);
  assert.equal(filterExpensesForReport(rows, { departmentId: 'all' }).length, 5);
  assert.equal(filterExpensesForReport(rows, { projectId: 'p2' }).length, 2);
  assert.equal(filterExpensesForReport(rows, { headOfAccount: 'Admin' }).length, 2);
  assert.equal(filterExpensesForReport(rows, { departmentId: 'd2', projectId: 'p1' }).length, 0);
});

test('search looks at the request no, party, description and remarks', () => {
  assert.equal(filterExpensesForReport(rows, { search: 'xyz' }).length, 2);
  assert.equal(filterExpensesForReport(rows, { search: 'ACC/0001' }).length, 1);
  assert.equal(filterExpensesForReport(rows, { search: 'cement' }).length, 1);
  assert.equal(filterExpensesForReport(rows, { search: 'nothing here' }).length, 0);
});

/* ── summaries ───────────────────────────────────────────────────────────── */

test('department summary counts, totals and shares add up', () => {
  const result = build('department-summary');
  const stores = rowFor(result, 'department', 'Stores');
  assert.equal(stores.requests, 2);
  assert.equal(stores.total, 350000);
  assert.equal(stores.average, 175000);
  assert.ok(Math.abs(Number(stores.share) - (350000 / 501000) * 100) < 1e-9);

  const shares = result.rows.reduce((running, row) => running + Number(row.share), 0);
  assert.ok(Math.abs(shares - 100) < 1e-9, 'shares sum to 100');
  assert.equal(cell(result, 0, 'department'), 'Stores', 'sorted by value, largest first');
});

test('the sub-head breakdown keeps its parent head alongside', () => {
  const result = build('subhead-summary');
  const stationery = rowFor(result, 'subHead', 'Stationery');
  assert.equal(stationery.head, 'Admin');
  assert.equal(stationery.requests, 2);
  assert.equal(stationery.total, 350000);
});

test('the party summary reports first and last payment dates', () => {
  const result = build('party-summary');
  const abc = rowFor(result, 'party', 'ABC Traders');
  assert.equal(abc.requests, 2);
  assert.equal(abc.first, '2026-07-15');
  assert.equal(abc.last, '2026-08-10');
});

/* ── trend ───────────────────────────────────────────────────────────────── */

test('the monthly trend runs in date order, not by size, and accumulates', () => {
  const result = build('monthly-trend');
  assert.deepEqual(result.rows.map(row => row.month), ['2026-05', '2026-07', '2026-08']);
  assert.deepEqual(result.rows.map(row => row.total), [1000, 100000, 400000]);
  assert.deepEqual(result.rows.map(row => row.cumulative), [1000, 101000, 501000]);
});

test('the first month reports no change rather than a misleading zero', () => {
  const result = build('monthly-trend');
  assert.equal(result.rows[0].change, null);
  assert.ok(Math.abs(Number(result.rows[1].change) - 9900) < 1e-9, '1000 -> 100000 is +9900%');
});

test('a cross-tab spreads a department across month columns and totals both ways', () => {
  const result = build('department-month-matrix');
  const accounts = rowFor(result, 'label', 'Accounts');
  assert.equal(accounts['col:2026-07'], 100000);
  assert.equal(accounts['col:2026-08'], 50000);
  assert.equal(accounts.total, 150000);
  assert.equal(result.total['col:2026-08'], 400000);
  assert.equal(result.total.total, 501000);
});

/* ── control ─────────────────────────────────────────────────────────────── */

test('pending reception lists only unreceived requests, oldest first', () => {
  const result = build('pending-reception');
  assert.deepEqual(result.rows.map(row => row.requestNo), ['OLD/0001', 'ACC/0002', 'STO/0001', 'STO/0002']);
  assert.equal(result.rows[0].age, ageInDays(at(2026, 5, 2), TODAY));
  assert.equal(result.total.amount, 401000, 'ACC/0001 is received and excluded');
});

test('reception ageing buckets by wait and its buckets sum to the pending total', () => {
  const result = build('reception-aging');
  assert.deepEqual(result.rows.map(row => row.bucket), ['0–7 days', '8–15 days', '16–30 days', '31–60 days', 'Over 60 days']);
  const bucketed = result.rows.reduce((running, row) => running + Number(row.total), 0);
  assert.equal(bucketed, Number(result.total.total));
  assert.equal(Number(result.total.total), 401000);
  // 20 Aug -> 17 Sep is 28 days.
  assert.equal(rowFor(result, 'bucket', '16–30 days').requests, 2);
});

test('high value respects the threshold and reports its share of spend', () => {
  const at100k = build('high-value');
  assert.deepEqual(at100k.rows.map(row => row.requestNo), ['STO/0001', 'ACC/0001', 'STO/0002']);
  assert.equal(at100k.total.amount, 450000);

  const at200k = build('high-value', { highValueThreshold: 200000 });
  assert.deepEqual(at200k.rows.map(row => row.requestNo), ['STO/0001']);
  assert.equal(at200k.stats.find(stat => stat.label === 'Threshold').value, '₹2,00,000');
});

test('duplicate suspects group on project, party, amount and date', () => {
  const result = build('duplicate-suspects');
  // e3 and e4 share a project, party and date but differ in amount, so they are NOT a set.
  assert.equal(result.rows.length, 0);

  const withTwin = enrichExpenses(
    [...raw, { ...raw[3], id: 'e6', requestNo: 'STO/0003' }],
    MASTERS,
  );
  const found = expenseReportById('duplicate-suspects').build({ expenses: withTwin, today: TODAY });
  assert.equal(found.rows.length, 2);
  assert.equal(found.rows[0].group, '2 requests');
  assert.equal(found.rows[1].group, '', 'only the first row of a set is labelled');
  assert.equal(found.stats.find(stat => stat.label === 'Value of repeats').value, '₹1,00,000');
});

/* ── formatting ──────────────────────────────────────────────────────────── */

test('cells format the same way everywhere they are shown', () => {
  assert.equal(formatReportCell(125000, 'currency'), '₹1,25,000');
  assert.equal(formatReportCell(1234, 'number'), '1,234');
  assert.equal(formatReportCell(33.333, 'percent'), '33.3%');
  assert.equal(formatReportCell(null, 'percent'), '—');
  assert.equal(formatReportCell('', 'text'), '');
  assert.equal(formatReportCell('ACC/0001'), 'ACC/0001');
});

test('undated requests bucket as Undated instead of Invalid Date', () => {
  assert.equal(monthKeyOf(''), 'Undated');
  assert.equal(dayKeyOf('not a date'), 'Undated');
  assert.equal(monthKeyOf(at(2026, 9, 1)), '2026-09');
  assert.equal(ageInDays('nonsense', TODAY), 0);
});
