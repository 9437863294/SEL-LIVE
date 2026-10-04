import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveBillTotals } from '../src/lib/bill-tracking/calculations.ts';
import {
  ageingReport,
  billTotals,
  buildSearchTokens,
  dashboardKpis,
  exceptionItems,
  filterBills,
  followUpRollup,
  forecastItems,
  forecastWindows,
  groupBills,
  monthlySummary,
  retentionReport,
  sumMonthlyRows,
  targetPerformance,
} from '../src/lib/bill-tracking/reports.ts';
import { legacyExportRows, LEGACY_EXPORT_HEADERS } from '../src/lib/bill-tracking/legacy-export.ts';
import { parseImportRows, readSheetLayout } from '../src/lib/bill-tracking/import.ts';
import { resolveBtAccess } from '../src/lib/bill-tracking/access.ts';
import { DEFAULT_CONFIG, DEFAULT_SETTINGS } from '../src/lib/bill-tracking/defaults.ts';

const types = DEFAULT_CONFIG.deductionTypes;
const typeByCode = (code) => types.find((type) => type.code === code);
const line = (code, amount) => ({ id: code, deductionTypeId: typeByCode(code).id, deductionTypeName: typeByCode(code).name, kind: typeByCode(code).kind, amount });
const receipt = (amount, receiptDate, status = 'verified') => ({ collectionId: `c-${receiptDate}-${amount}`, receiptDate, amount, status });

/** A bill as the server stores it: source values plus derived totals. */
function bill(overrides) {
  const source = { taxableAmount: 0, gstAmount: 0, deductions: [], collections: [], ...overrides };
  const totals = deriveBillTotals(source, { tolerance: 1, roundNetToRupee: true });
  const base = {
    id: overrides.id,
    financialYear: '2026-27',
    transactionType: 'invoice',
    billDate: '2026-04-15',
    projectId: 'p1',
    projectNameSnapshot: 'Project One',
    billTypeName: 'SUPPLY',
    billCategory: 'supply',
    isRetentionBill: false,
    workflowStatus: 'payment_followup',
    source: 'manual',
    version: 1,
    createdAt: '2026-04-15T00:00:00Z',
    createdBy: 'u',
    updatedAt: '2026-04-15T00:00:00Z',
    updatedBy: 'u',
    isDeleted: false,
    ...source,
    ...totals,
    ...overrides,
  };
  return { ...base, searchTokens: buildSearchTokens(base) };
}

const context = (asOf) => ({ asOf, settings: { ...DEFAULT_SETTINGS } });

const BILLS = [
  bill({ id: 'a', billDate: '2026-04-10', taxableAmount: 1000000, gstAmount: 180000, deductions: [line('ITDS', 20000), line('RET_INV', 100000)], collections: [receipt(500000, '2026-05-05'), receipt(560000, '2026-06-20')], dueDate: '2026-05-25', billSerialNumber: '101', gstInvoiceNumber: 'KA-001' }),
  bill({ id: 'b', billDate: '2026-05-12', taxableAmount: 500000, gstAmount: 90000, billTypeName: 'CIVIL', billCategory: 'civil', projectId: 'p2', projectNameSnapshot: 'Project Two', clientId: 'c1', clientNameSnapshot: 'OPTCL', dueDate: '2026-06-26', nextCommitmentDate: '2026-09-30', nextCommitmentAmount: 200000 }),
  bill({ id: 'c', billDate: '2026-07-01', taxableAmount: 0, billTypeName: 'SUPPLY-10%', billCategory: 'supply', isRetentionBill: true, transactionType: 'retention_bill', deductions: [line('RET_INV', -300000)], collections: [receipt(300000, '2026-08-01')] }),
  bill({ id: 'd', billDate: '2026-07-20', taxableAmount: -70170, gstAmount: -12631, billTypeName: 'ERECTION', billCategory: 'erection', transactionType: 'credit_note' }),
  bill({ id: 'x', billDate: '2026-04-11', taxableAmount: 99999, isDeleted: true }),
];

test('totals ignore deleted bills only when filtered, and outstanding counts open bills', () => {
  const live = filterBills(BILLS, {}, context('2026-10-03'));
  assert.equal(live.length, 4);
  const totals = billTotals(live);
  assert.equal(totals.net, 1060000 + 590000 + 300000 - 82801);
  assert.equal(totals.received, 1060000 + 300000);
  // a received, c received → open: b (590000) and the credit note (-82801)
  assert.equal(totals.outstanding, 590000 - 82801);
});

test('month-wise summary reproduces the legacy QUERY columns', () => {
  const rows = monthlySummary(filterBills(BILLS, {}, context('2026-10-03')), '2026-27');
  const april = rows.find((row) => row.month === '2026-04');
  assert.equal(april.taxableSupply, 1000000);
  assert.equal(april.statutoryDeduction, 20000);
  assert.equal(april.retentionInvoice, 100000);
  assert.equal(april.net, 1060000);
  assert.equal(april.netReceived, 1060000, 'receipts against April bills, by bill month');
  assert.equal(april.collectionInMonth, 0, 'nothing was received in April');
  const may = rows.find((row) => row.month === '2026-05');
  assert.equal(may.taxableCivil, 500000);
  assert.equal(may.collectionInMonth, 500000, 'by receipt date');
  const july = rows.find((row) => row.month === '2026-07');
  assert.equal(july.retentionRaised, 300000);
  assert.equal(july.retentionReleasedByClient, 300000);
  assert.equal(july.taxableSupply, 0, 'a retention bill is not counted as supply billing');
  assert.equal(july.taxableErection, -70170, 'credit notes reduce their category');
  assert.equal(sumMonthlyRows(rows).collectionInMonth, 1360000);
});

test('ageing is as-on-date: later receipts and bills are ignored', () => {
  const ctx = context('2026-05-31');
  const report = ageingReport(BILLS, ctx);
  // On 31 May: a (₹10.6 L, received ₹5 L by 5 May) is 51 days old; b is 19 days old.
  const total = report.totals.reduce((sum, cell) => sum + cell.amount, 0);
  assert.equal(total, 560000 + 590000);
  assert.equal(report.totals.find((cell) => cell.label === '31–60').amount, 560000);
  assert.equal(report.totals.find((cell) => cell.label === '0–30').amount, 590000);
  assert.equal(report.rows.length, 2);
});

test('project grouping and average collection days', () => {
  const groups = groupBills(filterBills(BILLS, {}, context('2026-10-03')), 'project', context('2026-10-03'));
  const one = groups.find((group) => group.key === 'p1');
  assert.equal(one.count, 3);
  // a: 500000 after 25 days, 560000 after 71 days; c: 300000 after 31 days → weighted ≈ 46
  assert.equal(one.averageCollectionDays, Math.round((500000 * 25 + 560000 * 71 + 300000 * 31) / 1360000));
});

test('filters: search by invoice and amount, chips, ageing bucket', () => {
  const ctx = context('2026-10-03');
  assert.deepEqual(filterBills(BILLS, { search: 'ka-001' }, ctx).map((entry) => entry.id), ['a']);
  assert.deepEqual(filterBills(BILLS, { search: '590000' }, ctx).map((entry) => entry.id), ['b']);
  assert.deepEqual(filterBills(BILLS, { chips: ['overdue'] }, ctx).map((entry) => entry.id), ['b']);
  assert.deepEqual(filterBills(BILLS, { chips: ['commitment_missed'] }, ctx).map((entry) => entry.id), ['b']);
  assert.deepEqual(filterBills(BILLS, { ageingBucket: '91–180', outstandingOnly: true }, ctx).map((entry) => entry.id).sort(), ['b']);
});

test('retention: held from deductions, released from the ledger', () => {
  const releases = [{ id: 'r1', projectId: 'p1', projectNameSnapshot: 'Project One', kind: 'retention_invoice', releaseDate: '2026-08-01', amount: 40000, status: 'active', createdBy: 'u', createdAt: 'x' }];
  const report = retentionReport(filterBills(BILLS, {}, context('2026-10-03')), releases, context('2026-10-03'));
  const p1 = report.rows.find((row) => row.projectId === 'p1');
  // a held 100000; c is a retention bill whose negative "deduction" is the claim, -300000
  assert.equal(p1.deducted, 100000 - 300000);
  assert.equal(p1.released, 40000);
});

test('forecast uses commitments, then expected date, then due date — nothing invented', () => {
  const items = forecastItems(filterBills(BILLS, {}, context('2026-10-03')));
  const b = items.find((item) => item.billId === 'b');
  assert.equal(b.source, 'commitment');
  assert.equal(b.amount, 200000);
  assert.equal(items.find((item) => item.billId === 'd'), undefined, 'a credit note owes no collection');
  const windows = forecastWindows([{ billId: 'z', projectName: 'P', date: '2026-10-05', amount: 100, source: 'due_date' }], '2026-10-03');
  assert.equal(windows.find((window) => window.key === 'next7').amount, 100);
  assert.equal(windows.find((window) => window.key === 'nextWeek').amount, 100);
  assert.equal(windows.find((window) => window.key === 'thisWeek').amount, 0);
});

test('exceptions flag mismatches, missed commitments and missing follow-ups', () => {
  const flagged = bill({ id: 'm', billDate: '2026-04-01', taxableAmount: 100, netMismatch: { imported: 105, calculated: 100 }, legacyStatus: 'RECEIVED' });
  const kinds = exceptionItems([flagged, ...BILLS.slice(0, 2)], context('2026-10-03')).map((item) => `${item.billId}:${item.kind}`);
  assert.ok(kinds.includes('m:net_mismatch'));
  assert.ok(kinds.includes('m:legacy_status_mismatch'));
  assert.ok(kinds.includes('b:commitment_missed'));
  assert.ok(kinds.includes('b:no_follow_up'));
  assert.ok(!kinds.some((kind) => kind.startsWith('a:')), 'a fully received bill raises nothing');
});

test('follow-up rollup keeps the earliest open commitment so a missed one stays visible', () => {
  const rollup = followUpRollup(
    [
      { id: '1', billId: 'b', projectId: 'p', followUpDate: '2026-09-01', method: 'Phone', discussion: 'x', status: 'open', nextFollowUpDate: '2026-09-10', commitment: { date: '2026-09-15', amount: 100000, status: 'pending' }, createdBy: 'u', createdAt: '2026-09-01T10:00:00Z' },
      { id: '2', billId: 'b', projectId: 'p', followUpDate: '2026-09-20', method: 'Email', discussion: 'y', status: 'open', nextFollowUpDate: '2026-10-01', commitment: { date: '2026-10-10', amount: 50000, status: 'partially_fulfilled', fulfilledAmount: 20000 }, createdBy: 'u', createdAt: '2026-09-20T10:00:00Z' },
    ],
    '2026-10-03',
  );
  assert.deepEqual(rollup, { lastFollowUpDate: '2026-09-20', nextFollowUpDate: '2026-10-01', nextCommitmentDate: '2026-09-15', nextCommitmentAmount: 100000 });
});

test('target performance compares weekly targets with receipts in the same ISO week', () => {
  const rows = targetPerformance([{ id: 't', financialYear: '2026-27', week: '2026-W19', amount: 400000, createdBy: 'u', createdAt: 'x', updatedAt: 'x' }], BILLS, ['2026-W19']);
  assert.deepEqual(rows[0], { week: '2026-W19', from: '2026-05-04', to: '2026-05-10', target: 400000, actual: 500000, achievement: 125 });
});

test('dashboard KPIs', () => {
  const kpis = dashboardKpis(filterBills(BILLS, {}, context('2026-10-03')), [], context('2026-10-03'));
  assert.equal(kpis.overdue, 590000);
  assert.equal(kpis.missedCommitments, 1);
});

test('legacy export round-trips through the importer', () => {
  const live = filterBills(BILLS, {}, context('2026-10-03'));
  const rows = legacyExportRows(live, types);
  assert.equal(rows[0].length, LEGACY_EXPORT_HEADERS.length);
  const grid = [LEGACY_EXPORT_HEADERS, ...rows.map((row) => row.map((cell) => (typeof cell === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cell) ? { date: cell } : cell)))];
  const parsed = parseImportRows(grid, readSheetLayout(grid, 1), {
    projects: [
      { id: 'p1', name: 'Project One' },
      { id: 'p2', name: 'Project Two' },
    ],
    billTypes: DEFAULT_CONFIG.billTypes,
    deductionTypes: types,
    projectMappings: [],
    tolerance: 1,
    roundNetToRupee: true,
    piMarker: 'PI',
  });
  assert.equal(parsed.rows.length, live.length);
  parsed.rows.forEach((row, index) => {
    assert.equal(row.calculated.net, live[index].netReceivable, `net of ${live[index].id}`);
    assert.equal(row.calculated.received, live[index].totalReceived, `received of ${live[index].id}`);
    assert.equal(row.netMismatch, false);
  });
});

/* ── permissions ─────────────────────────────────────────────────────────── */

test('scope: All Projects sees everything; otherwise only granted projects', () => {
  const hoFinance = resolveBtAccess({ 'Bill Tracking': ['View Module'], 'Bill Tracking.All Projects': ['View'], 'Bill Tracking.Bills': ['View', 'Add'] }, []);
  assert.equal(hoFinance.scope, null);
  assert.equal(hoFinance.can('Bills', 'Add', 'any-project'), true);

  const site = resolveBtAccess({ 'Bill Tracking': ['View Module'], 'Bill Tracking.Bills': ['View', 'Add'] }, ['p1']);
  assert.deepEqual(site.scope, ['p1']);
  assert.equal(site.can('Bills', 'Add', 'p1'), true);
  assert.equal(site.can('Bills', 'Add', 'p2'), false, 'outside the granted projects');

  const noGrants = resolveBtAccess({ 'Bill Tracking': ['View Module'], 'Bill Tracking.Bills': ['View'] }, []);
  assert.deepEqual(noGrants.scope, [], 'no grants means no projects, never all');
});

test('unauthorised mutations are refused', () => {
  const viewer = resolveBtAccess({ 'Bill Tracking': ['View Module'], 'Bill Tracking.All Projects': ['View'], 'Bill Tracking.Bills': ['View'], 'Bill Tracking.Collections': ['View'] }, []);
  assert.equal(viewer.can('Bills', 'Add', 'p1'), false);
  assert.equal(viewer.can('Bills', 'Override Status', 'p1'), false);
  assert.equal(viewer.can('Collections', 'Add', 'p1'), false);
  assert.equal(viewer.can('Collections', 'Verify', 'p1'), false);
  assert.equal(viewer.can('Import', 'Rollback'), false);
  assert.equal(viewer.can('Settings', 'Close Month'), false);

  const recorder = resolveBtAccess({ 'Bill Tracking': ['View Module'], 'Bill Tracking.Collections': ['View', 'Add'] }, ['p1']);
  assert.equal(recorder.can('Collections', 'Add', 'p1'), true);
  assert.equal(recorder.can('Collections', 'Verify', 'p1'), false, 'recording and verifying are separate');

  const outsider = resolveBtAccess({ 'Recurring Payments': ['View Module'] }, ['p1']);
  assert.equal(outsider.hasModule, false);
});

test('a project-scoped grant applies to that project only', () => {
  const scoped = resolveBtAccess({ 'Bill Tracking': ['View Module'], 'Bill Tracking.Bills': ['View'], 'Bill Tracking.Bills.p1': ['Approve'] }, ['p1', 'p2']);
  assert.equal(scoped.can('Bills', 'Approve', 'p1'), true);
  assert.equal(scoped.can('Bills', 'Approve', 'p2'), false);
});



test('reminders fire on their one day, once per bill, to the owner', async () => {
  const { dueReminders } = await import('../src/lib/bill-tracking/reminders.ts');
  const due = bill({ id: 'r1', taxableAmount: 6000000, collectionOwnerId: 'owner', createdBy: 'maker', nextFollowUpDate: '2026-10-03', nextCommitmentDate: '2026-10-04', nextCommitmentAmount: 100, dueDate: '2026-10-02' });
  const kinds = dueReminders([due], '2026-10-03', 5000000).map((reminder) => reminder.kind).sort();
  assert.deepEqual(kinds, ['commitment_tomorrow', 'follow_up_due', 'payment_overdue']);
  const overdue = dueReminders([due], '2026-10-03', 5000000).find((reminder) => reminder.kind === 'payment_overdue');
  assert.deepEqual(overdue.recipients.sort(), ['maker', 'owner']);
  assert.equal(dueReminders([due], '2026-10-06', 5000000).length, 0, 'nothing on an ordinary day');
  assert.equal(dueReminders([{ ...due, outstandingAmount: 0, paymentStatus: 'received' }], '2026-10-03', 5000000).length, 0, 'paid bills are quiet');
});
