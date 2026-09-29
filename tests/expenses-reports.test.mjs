import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPENSE_REPORTS,
  EXPENSE_REPORT_GROUPS,
  PAYMENT_STAGES,
  PAYMENT_STAGE_FILTERS,
  PAYMENT_SUMMARY_GROUPINGS,
  ageInDays,
  dayKeyOf,
  enrichExpenses,
  expenseReportById,
  filterExpensesForReport,
  formatInr,
  formatReportCell,
  formatReportDate,
  formatReportMonth,
  isAwaitingReception,
  isNumericReportColumn,
  monthKeyOf,
} from '../src/lib/expenses-reports.ts';
import { requisitionHref, requisitionsByRequestNo } from '../src/lib/requisition-progress.ts';

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
  assert.equal(at200k.stats.find(stat => stat.label === 'Threshold').value, '₹2,00,000.00');
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
  assert.equal(found.stats.find(stat => stat.label === 'Value of repeats').value, '₹1,00,000.00');
});

/* ── formatting ──────────────────────────────────────────────────────────── */

test('cells format the same way everywhere they are shown', () => {
  assert.equal(formatReportCell(125000, 'currency'), '₹1,25,000.00');
  assert.equal(formatReportCell(1234, 'number'), '1,234');
  assert.equal(formatReportCell(33.333, 'percent'), '33.3%');
  assert.equal(formatReportCell(null, 'percent'), '—');
  assert.equal(formatReportCell('', 'text'), '');
  assert.equal(formatReportCell('ACC/0001'), 'ACC/0001');
});

test('rupees are one formatter: Indian grouping, two decimals unless asked otherwise', () => {
  assert.equal(formatInr(12345678.905), '₹1,23,45,678.91');
  assert.equal(formatInr(-1234.5), '-₹1,234.50');
  assert.equal(formatInr(0), '₹0.00');
  assert.equal(formatInr(undefined), '₹0.00');
  assert.equal(formatInr(125000, 0), '₹1,25,000');
  // A headline and the footer beneath it read the same figure the same way.
  const register = build('expense-register');
  assert.equal(register.stats.find(stat => stat.label === 'Total value').value, formatReportCell(register.total.amount, 'currency'));
});

test('dates read dd MMM yyyy and months MMM yyyy, whatever the zone', () => {
  assert.equal(formatReportDate('2026-07-05'), '05 Jul 2026');
  assert.equal(formatReportCell('2026-12-31', 'date'), '31 Dec 2026');
  assert.equal(formatReportDate(new Date(2026, 6, 5, 9).toISOString()), '05 Jul 2026', 'a timestamp reads in local time');
  assert.equal(formatReportCell('2026-07', 'month'), 'Jul 2026');
  assert.equal(formatReportMonth('2026-01'), 'Jan 2026');
  // Labels and placeholders sharing a date column pass through untouched.
  for (const text of ['Total', 'Undated', '—']) {
    assert.equal(formatReportCell(text, 'date'), text);
    assert.equal(formatReportCell(text, 'month'), text);
  }
  assert.equal(formatReportDate('2026-13-01'), '2026-13-01', 'not a month: shown as recorded');
  assert.equal(formatReportCell(null, 'date'), '—');
});

test('month buckets keep their sortable keys but are headed in words', () => {
  const trend = build('monthly-trend');
  assert.equal(trend.columns.find(column => column.key === 'month').type, 'month');
  const matrix = build('department-month-matrix');
  const july = matrix.columns.find(column => column.key === 'col:2026-07');
  assert.equal(july.label, 'Jul 2026');
  assert.deepEqual(
    matrix.columns.filter(column => column.key.startsWith('col:')).map(column => column.label),
    ['May 2026', 'Jul 2026', 'Aug 2026'],
    'still in date order',
  );
  assert.equal(build('expense-register').columns.find(column => column.key === 'receptionDate').type, 'date');
});

test('only figures are set as figures', () => {
  assert.ok(isNumericReportColumn('currency') && isNumericReportColumn('number') && isNumericReportColumn('percent'));
  assert.ok(!isNumericReportColumn('date') && !isNumericReportColumn('month') && !isNumericReportColumn('text'));
  assert.ok(!isNumericReportColumn(undefined));
});

test('undated requests bucket as Undated instead of Invalid Date', () => {
  assert.equal(monthKeyOf(''), 'Undated');
  assert.equal(dayKeyOf('not a date'), 'Undated');
  assert.equal(monthKeyOf(at(2026, 9, 1)), '2026-09');
  assert.equal(ageInDays('nonsense', TODAY), 0);
});

/* ── payments ────────────────────────────────────────────────────────────── */

const voucher = (bankPaymentId, voucherNo, amount) => ({
  bankPaymentId, voucherNo, lineId: `${bankPaymentId}-1`, amount, mode: 'NEFT', instrumentNo: '', instrumentDate: '', accountId: 'a1',
});

/**
 * What the requests above became in Daily Requisition:
 *   ACC/0001 — received as R1, net of TDS, part paid by one voucher.
 *   ACC/0002, OLD/0001 — never received.
 *   STO/0001 — received as R3 and then cancelled (the cancel cleared the request's reception no).
 *   STO/0002 — an older cancelled reception, then re-received as R4 by an import that never wrote
 *              the reception no back to the request, and paid in full over two vouchers.
 */
const REQUISITIONS = requisitionsByRequestNo([
  { id: 'q1', depNo: 'ACC/0001', receptionNo: 'R1', status: 'Partially Paid', netAmount: 95000, paidAmount: 40000, payments: [voucher('bp1', 'BP/0001', 40000)], createdAt: at(2026, 7, 20) },
  { id: 'q3', depNo: 'STO/0001', receptionNo: 'R3', status: 'Cancelled', netAmount: 250000, createdAt: at(2026, 8, 21) },
  { id: 'q4old', depNo: 'STO/0002', receptionNo: 'R2', status: 'Cancelled', netAmount: 100000, createdAt: at(2026, 8, 21) },
  { id: 'q4', depNo: ' STO/0002 ', receptionNo: 'R4', status: 'Paid', netAmount: 98000, paidAmount: 98000, payments: [voucher('bp2', 'BP/0002', 49000), voucher('bp3', 'BP/0003', 49000)], createdAt: at(2026, 8, 25) },
]);
const pay = (id, input = {}) => build(id, { requisitions: REQUISITIONS, ...input });

test('the stages run in pipeline order under the labels every module shares', () => {
  assert.deepEqual(PAYMENT_STAGES.map(entry => entry.stage), ['not-received', 'pending', 'received', 'needs-review', 'verified', 'awaiting-payment', 'part-paid', 'paid', 'cancelled']);
  assert.equal(PAYMENT_STAGES[0].label, 'Not received');
  assert.equal(PAYMENT_STAGES.find(entry => entry.stage === 'awaiting-payment').label, 'Awaiting payment');
  assert.deepEqual(PAYMENT_STAGE_FILTERS.slice(0, 2).map(entry => entry.value), ['all', 'outstanding']);
  assert.deepEqual(PAYMENT_SUMMARY_GROUPINGS.map(entry => entry.value), ['department', 'project', 'department-project']);
});

test('payment status: each request with its stage, what is paid and what is due', () => {
  const result = pay('payment-status');
  assert.deepEqual(result.rows.map(row => row.requestNo), ['OLD/0001', 'ACC/0002', 'ACC/0001', 'STO/0002', 'STO/0001'], 'down the pipeline, oldest first within a stage');

  const partPaid = rowFor(result, 'requestNo', 'ACC/0001');
  assert.equal(partPaid.stage, 'Part paid');
  assert.equal(partPaid.stageTone, 'warning');
  assert.equal(partPaid.amount, 100000, 'as raised');
  assert.equal(partPaid.net, 95000, 'as Daily Requisition holds it payable');
  assert.equal(partPaid.paid, 40000);
  assert.equal(partPaid.balance, 55000);
  assert.equal(partPaid.receptionNo, 'R1');
  assert.equal(partPaid.receptionHref, requisitionHref('R1'));
  assert.equal(partPaid.vouchers, 'BP/0001');

  const paid = rowFor(result, 'requestNo', 'STO/0002');
  assert.equal(paid.stage, 'Paid', 'the live requisition wins over the cancelled one');
  assert.equal(paid.receptionNo, 'R4', "the requisition's reception no, though the request never got it back");
  assert.equal(paid.balance, 0);
  assert.equal(paid.vouchers, 'BP/0002, BP/0003');

  const cancelled = rowFor(result, 'requestNo', 'STO/0001');
  assert.equal(cancelled.stage, 'Cancelled');
  assert.equal(cancelled.stageTone, 'danger');
  assert.equal(cancelled.net, null, 'nothing is payable on a cancelled requisition');
  assert.equal(cancelled.balance, null);
  assert.equal(cancelled.receptionNo, 'R3');

  const waiting = rowFor(result, 'requestNo', 'ACC/0002');
  assert.equal(waiting.stage, 'Not received');
  assert.equal(waiting.receptionNo, '—');
  assert.equal(waiting.receptionHref, null, 'no requisition to link to');
  assert.equal(waiting.paid, null);
  assert.equal(formatReportCell(waiting.balance, 'currency'), '—', 'a dash, not a 0 that reads as settled');

  assert.deepEqual(result.total, { requestNo: 'Total', amount: 501000, net: 193000, paid: 138000, balance: 55000 });
  assert.equal(result.stats.find(stat => stat.label === 'Balance due').value, '₹55,000.00');
  assert.equal(result.stats.find(stat => stat.label === 'Not yet in DR').value, '3 of 5');
  assert.equal(result.columns.find(column => column.key === 'receptionNo').linkKey, 'receptionHref');
  assert.equal(result.columns.find(column => column.key === 'stage').toneKey, 'stageTone');
  assert.equal(new Set(result.columns.map(column => column.label)).size, result.columns.length, 'headings are unique');
});

test('payment status filters to one stage, or to everything not yet paid in full', () => {
  const outstanding = pay('payment-status', { paymentStage: 'outstanding' });
  assert.deepEqual(outstanding.rows.map(row => row.requestNo), ['OLD/0001', 'ACC/0002', 'ACC/0001', 'STO/0001']);
  assert.equal(outstanding.total.amount, 401000, 'totals follow the filter');

  assert.deepEqual(pay('payment-status', { paymentStage: 'part-paid' }).rows.map(row => row.requestNo), ['ACC/0001']);
  const none = pay('payment-status', { paymentStage: 'verified' });
  assert.deepEqual(none.rows, []);
  assert.match(none.emptyMessage, /at this stage/);
});

test('without Daily Requisition the payment reports say so rather than guess', () => {
  for (const id of ['payment-status', 'payment-summary']) {
    const result = build(id);
    assert.deepEqual(result.rows, []);
    assert.match(result.emptyMessage, /Daily Requisition could not be read/);
    assert.ok(result.columns.length);
  }
});

test('payment summary by department: raised, received, paid, due and a count per stage', () => {
  const result = pay('payment-summary');
  assert.deepEqual(result.rows.map(row => row.department), ['Stores', 'Accounts', 'Legacy Dept'], 'largest raised first');
  const stores = rowFor(result, 'department', 'Stores');
  assert.equal(stores.requests, 2);
  assert.equal(stores.raised, 350000);
  assert.equal(stores.received, 98000);
  assert.equal(stores.paid, 98000);
  assert.equal(stores.balance, 0);
  assert.equal(stores['stage:paid'], 1);
  assert.equal(stores['stage:cancelled'], 1);
  assert.equal(stores['stage:not-received'], 0);

  // Only the stages something stands at get a column, in pipeline order, headed uniquely.
  assert.deepEqual(result.columns.filter(column => column.key.startsWith('stage:')).map(column => column.label), ['Not received', 'Part paid', 'Paid in full', 'Cancelled']);
  assert.equal(new Set(result.columns.map(column => column.label)).size, result.columns.length);

  assert.equal(result.total.department, 'Total');
  assert.equal(result.total['stage:not-received'], 2);
  // The summary and the request-by-request list are the same money.
  const detail = pay('payment-status');
  assert.equal(result.total.raised, detail.total.amount);
  assert.equal(result.total.received, detail.total.net);
  assert.equal(result.total.paid, detail.total.paid);
  assert.equal(result.total.balance, detail.total.balance);
  assert.equal(result.total.requests, detail.rows.length);
});

test('payment summary by project, and by department and project together', () => {
  const byProject = pay('payment-summary', { paymentGroupBy: 'project' });
  assert.equal(byProject.columns[0].key, 'project');
  assert.ok(!byProject.columns.some(column => column.key === 'department'));
  assert.equal(rowFor(byProject, 'project', 'Bhadla Line').balance, 55000);
  assert.equal(byProject.total.project, 'Total');

  const both = pay('payment-summary', { paymentGroupBy: 'department-project' });
  assert.deepEqual(both.columns.slice(0, 2).map(column => column.key), ['department', 'project']);
  const legacy = rowFor(both, 'department', 'Legacy Dept');
  assert.equal(legacy.project, 'Unknown Project');
  assert.equal(legacy['stage:not-received'], 1);
  assert.equal(both.total.raised, 501000);
});

test('a cancelled requisition sends its request back to pending reception', () => {
  // STO/0001's cancel cleared its reception no, so it is pending with or without the requisitions.
  assert.ok(pay('pending-reception').rows.some(row => row.requestNo === 'STO/0001'));
  assert.ok(build('pending-reception').rows.some(row => row.requestNo === 'STO/0001'));

  // A request cancelled before the cancel cleared reception numbers still carries its old one.
  const legacy = enrichExpenses([{ ...raw[0], id: 'x', requestNo: 'ACC/0009', receptionNo: 'R9' }], MASTERS)[0];
  const cancelledR9 = requisitionsByRequestNo([{ id: 'q9', depNo: 'ACC/0009', receptionNo: 'R9', status: 'Cancelled', netAmount: 100000 }]);
  assert.equal(isAwaitingReception(legacy, cancelledR9), true);
  assert.equal(isAwaitingReception(legacy), false, 'without Daily Requisition the reception no decides');

  // Received again under another number: that reception stands.
  const otherReception = requisitionsByRequestNo([{ id: 'q9', depNo: 'ACC/0009', receptionNo: 'R8', status: 'Cancelled' }]);
  assert.equal(isAwaitingReception(legacy, otherReception), false);
  // A reception recorded before Daily Requisition kept records: still received.
  assert.equal(isAwaitingReception(legacy, new Map()), false);
});

test('pending reception follows what Daily Requisition holds when it can be read', () => {
  const result = pay('pending-reception');
  // STO/0002 has no reception no on the request, but a live (paid) requisition: it is not pending.
  assert.deepEqual(result.rows.map(row => row.requestNo), ['OLD/0001', 'ACC/0002', 'STO/0001']);
  assert.equal(result.total.amount, 301000);
  const ageing = pay('reception-aging');
  assert.equal(Number(ageing.total.total), 301000, 'the ageing buckets the same requests');
  assert.equal(ageing.total.requests, 3);
});

test('every report survives an empty selection with Daily Requisition loaded too', () => {
  for (const report of EXPENSE_REPORTS) {
    const result = report.build({ expenses: [], today: TODAY, requisitions: new Map() });
    assert.deepEqual(result.rows, [], `${report.id} has no rows`);
    assert.ok(result.columns.length, `${report.id} still declares columns`);
  }
});
