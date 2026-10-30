import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_FILTERS,
  activeFilterCount,
  BACKLOG_DAYS,
  buildDashboard,
  buildOverview,
  daysBetween,
  describePeriod,
  filterRows,
  financialYearStart,
  lastMonths,
  monthEnd,
  periodRange,
  previousRange,
  stageOfStatus,
  topWithOther,
  weekStart,
} from '../src/lib/daily-requisition-dashboard.ts';

const TODAY = '2026-10-01';

const row = (patch) => ({
  id: patch.id ?? Math.random().toString(36).slice(2),
  receptionNo: 'R',
  depNo: '',
  partyName: 'Party A',
  description: '',
  departmentId: 'd1',
  projectId: 'p1',
  status: 'Pending',
  documentStatus: 'Pending',
  gross: 100,
  net: 100,
  paid: 0,
  balance: 100,
  dateKey: '2026-09-28',
  createdMs: 0,
  paidEvents: [],
  ...patch,
});

test('statuses map to the stage queues', () => {
  assert.equal(stageOfStatus('Pending'), 'receiving');
  assert.equal(stageOfStatus(undefined), 'receiving');
  assert.equal(stageOfStatus('Needs Review'), 'verification');
  assert.equal(stageOfStatus('Verified'), 'verification');
  assert.equal(stageOfStatus('Partially Paid'), 'payment');
  assert.equal(stageOfStatus('Paid'), 'paid');
  assert.equal(stageOfStatus('Cancelled'), 'cancelled');
});

test('date keys, periods and the financial year', () => {
  assert.equal(daysBetween('2026-09-01', TODAY), 30);
  assert.equal(financialYearStart('2026-03-31'), '2025-04-01');
  assert.equal(financialYearStart('2026-04-01'), '2026-04-01');
  assert.deepEqual(periodRange('this-month', TODAY), { from: '2026-10-01', to: TODAY });
  assert.deepEqual(periodRange('last-30', TODAY), { from: '2026-09-02', to: TODAY });
  assert.deepEqual(periodRange('all', TODAY), { from: '', to: TODAY });
  assert.deepEqual(periodRange('today', TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(periodRange('this-week', '2026-10-01'), { from: '2026-09-28', to: '2026-10-01' }, 'weeks start on Monday');
  assert.equal(weekStart('2026-09-28'), '2026-09-28');
  assert.deepEqual(periodRange('last-month', TODAY), { from: '2026-09-01', to: '2026-09-30' }, 'a closed period ends before today');
  assert.deepEqual(periodRange('last-90', TODAY), { from: '2026-07-04', to: TODAY });
  assert.deepEqual(periodRange('last-fy', TODAY), { from: '2025-04-01', to: '2026-03-31' });
  assert.equal(monthEnd('2024-02-10'), '2024-02-29', 'leap February');
  const months = lastMonths('2026-02-10', 3);
  assert.deepEqual(months.map((m) => m.key), ['2025-12', '2026-01', '2026-02']);
  assert.equal(months[0].label, 'Dec 25');
});

test('open stages, ageing and what is still due', () => {
  const figures = buildDashboard(
    [
      row({ status: 'Pending', dateKey: '2026-09-30', balance: 100 }),
      row({ status: 'Verified', dateKey: '2026-08-15', balance: 250, net: 250 }),
      row({ status: 'Partially Paid', dateKey: '2026-07-01', net: 500, paid: 200, balance: 300 }),
      row({ status: 'Paid', net: 80, paid: 80, balance: 0 }),
      row({ status: 'Cancelled', balance: 0 }),
    ],
    { todayKey: TODAY, period: 'all' },
  );
  assert.deepEqual(figures.open, { count: 3, net: 850, balance: 650 });
  assert.deepEqual(
    figures.stages.map((s) => [s.stage, s.count, s.balance, s.oldestDays]),
    [
      ['receiving', 1, 100, 1],
      ['verification', 1, 250, 47],
      ['payment', 1, 300, 92],
    ],
  );
  assert.deepEqual(figures.ageing.map((b) => b.count), [1, 0, 0, 1, 1]);
  assert.equal(figures.cancelled.count, 1);
  assert.equal(figures.documents.Pending, 4, 'cancelled requisitions are left out of documents');
});

test('received by reception date, paid by payment date and never ahead of today', () => {
  const figures = buildDashboard(
    [
      row({ id: 'a', dateKey: '2026-10-01', net: 120, gross: 150 }),
      row({ id: 'b', dateKey: '2026-09-10', status: 'Paid', net: 90, paid: 90, balance: 0, paidEvents: [{ dateKey: '2026-10-01', amount: 90 }] }),
      row({ id: 'c', dateKey: '2026-09-12', status: 'Partially Paid', net: 300, paid: 100, balance: 200, paidEvents: [{ dateKey: '2026-10-15', amount: 100 }] }),
    ],
    { todayKey: TODAY, period: 'this-month' },
  );
  assert.deepEqual(figures.received, { count: 1, gross: 150, net: 120 });
  assert.deepEqual(figures.paidOut, { amount: 90, requisitions: 1 });
  assert.deepEqual(figures.paidAhead, { amount: 100, count: 1 }, 'a post-dated cheque waits for its date');
  const oct = figures.monthly.at(-1);
  const sep = figures.monthly.at(-2);
  assert.equal(oct.key, '2026-10');
  assert.equal(oct.paid, 90);
  assert.equal(sep.received, 390);
  assert.equal(sep.receivedCount, 2);
});

test('a custom range, either way round, and how a period reads', () => {
  assert.deepEqual(periodRange('custom', TODAY, { from: '2026-09-10', to: '2026-09-20' }), { from: '2026-09-10', to: '2026-09-20' });
  assert.deepEqual(periodRange('custom', TODAY, { from: '2026-09-20', to: '2026-09-10' }), { from: '2026-09-10', to: '2026-09-20' }, 'back-to-front is read the sensible way');
  assert.deepEqual(periodRange('custom', TODAY, { from: '', to: '' }), { from: '', to: TODAY }, 'no dates yet means everything up to today');
  assert.equal(describePeriod({ from: '', to: TODAY }), 'All time');
  assert.equal(describePeriod({ from: TODAY, to: TODAY }), '1 Oct 2026');
  assert.equal(describePeriod({ from: '2026-09-01', to: '2026-09-30' }), '1 – 30 Sep 2026');
  assert.equal(describePeriod({ from: '2026-08-15', to: '2026-09-30' }), '15 Aug – 30 Sep 2026');
  assert.equal(describePeriod({ from: '2025-12-31', to: '2026-01-01' }), '31 Dec 2025 – 1 Jan 2026');
});

test('filters pick the requisitions that count', () => {
  const rows = [
    row({ id: 'a', departmentId: 'd1', projectId: 'p1', partyName: 'Acme Steel', balance: 100, net: 100 }),
    row({ id: 'b', departmentId: 'd2', projectId: 'p1', partyName: 'Borel', documentStatus: 'Missing', balance: 0, net: 9000, gross: 9000 }),
    row({ id: 'c', departmentId: 'd1', projectId: 'p2', partyName: 'Cadre', depNo: 'SEL/EXP/FIN/0007', balance: 50, net: 50 }),
  ];
  const only = (filters) => filterRows(rows, { ...NO_FILTERS, ...filters }).map((r) => r.id);
  assert.deepEqual(only({}), ['a', 'b', 'c']);
  assert.deepEqual(only({ departmentId: 'd1' }), ['a', 'c']);
  assert.deepEqual(only({ projectId: 'p1' }), ['a', 'b']);
  assert.deepEqual(only({ documentStatus: 'Missing' }), ['b']);
  assert.deepEqual(only({ minAmount: 1000 }), ['b'], 'the larger of gross and net has to reach it');
  assert.deepEqual(only({ dueOnly: true }), ['a', 'c']);
  assert.deepEqual(only({ search: 'acme' }), ['a'], 'party, case-insensitive');
  assert.deepEqual(only({ search: 'FIN/0007' }), ['c'], 'the DEP number too');
  assert.deepEqual(only({ departmentId: 'd1', dueOnly: true, search: 'cadre' }), ['c'], 'filters stack');
  assert.equal(activeFilterCount(NO_FILTERS), 0);
  assert.equal(activeFilterCount({ ...NO_FILTERS, search: 'x' }), 0, 'search has its own box, not the count');
  assert.equal(activeFilterCount({ ...NO_FILTERS, departmentId: 'd1', dueOnly: true, minAmount: 5 }), 3);
});

test('groups largest first, the tail folded into Other', () => {
  const figures = buildDashboard(
    [
      row({ partyName: 'X', departmentId: 'd1', balance: 50 }),
      row({ partyName: 'Y', departmentId: 'd2', balance: 500 }),
      row({ partyName: 'Y', departmentId: 'd2', balance: 25, dateKey: '2026-06-01' }),
      row({ partyName: 'Z', departmentId: 'd3', balance: 10 }),
    ],
    { todayKey: TODAY, period: 'all' },
  );
  assert.deepEqual(figures.byParty.map((g) => [g.key, g.count, g.balance]), [['Y', 2, 525], ['X', 1, 50], ['Z', 1, 10]]);
  assert.equal(figures.byParty[0].oldestDays, 122);
  const top = topWithOther(figures.byDepartment, 1);
  assert.deepEqual(top.map((g) => [g.key, g.balance, g.count]), [['d2', 525, 2], ['__other__', 60, 2]]);
});

test('the quarter so far, and the days to compare a period with', () => {
  assert.deepEqual(periodRange('this-quarter', '2026-11-14'), { from: '2026-10-01', to: '2026-11-14' });
  assert.deepEqual(periodRange('this-quarter', '2027-03-31'), { from: '2027-01-01', to: '2027-03-31' });
  assert.deepEqual(periodRange('this-quarter', '2026-04-01'), { from: '2026-04-01', to: '2026-04-01' });
  assert.deepEqual(previousRange({ from: '2026-10-01', to: '2026-10-30' }), { from: '2026-09-01', to: '2026-09-30' }, 'a month so far: the same days of the month before');
  assert.deepEqual(previousRange({ from: '2026-03-01', to: '2026-03-31' }), { from: '2026-02-01', to: '2026-02-28' }, 'a whole month: the whole month before');
  assert.deepEqual(previousRange({ from: '2026-03-01', to: '2026-03-30' }), { from: '2026-02-01', to: '2026-02-28' }, 'never past the month end');
  assert.deepEqual(previousRange({ from: '2026-10-01', to: '2026-10-01' }), { from: '2026-09-30', to: '2026-09-30' }, 'one day: the day before');
  assert.deepEqual(previousRange({ from: '2026-09-28', to: '2026-10-01' }), { from: '2026-09-24', to: '2026-09-27' });
  assert.equal(previousRange({ from: '', to: TODAY }), null);
});

test('the overview: wait profiles, backlog, settling and the open amount by month', () => {
  const rows = [
    row({ id: 'a', status: 'Pending', dateKey: '2026-09-28', balance: 100 }), // 3 d
    row({ id: 'b', status: 'Pending', dateKey: '2026-08-01', balance: 200 }), // 61 d
    row({ id: 'c', status: 'Pending', dateKey: '2026-01-01', balance: 300, documentStatus: 'Missing' }), // 273 d
    row({ id: 'd', status: 'Received for Payment', dateKey: '2026-09-11', balance: 50, projectId: '' }), // 20 d
    row({ id: 'e', status: 'Paid', dateKey: '2026-09-01', net: 80, paid: 80, balance: 0, paidEvents: [{ dateKey: '2026-09-21', amount: 80 }] }),
    row({ id: 'f', status: 'Cancelled', dateKey: '2026-09-01', balance: 0 }),
    row({ id: 'g', status: 'Pending', dateKey: '', balance: 10 }),
  ];
  const overview = buildOverview(rows, { todayKey: TODAY, range: { from: '2026-09-01', to: TODAY } });

  const receiving = overview.stages[0];
  assert.equal(receiving.count, 4, 'the undated one is counted in its queue');
  assert.equal(receiving.balance, 610);
  assert.equal(receiving.oldestDays, 273);
  assert.equal(receiving.medianDays, 61);
  assert.equal(receiving.overdue, 2);
  assert.deepEqual(receiving.bands.map((b) => b.count), [1, 0, 1, 1]);
  assert.equal(overview.stages[2].count, 1);

  assert.deepEqual(overview.overdue, { count: 3, balance: 550 });
  assert.ok(BACKLOG_DAYS < 273);
  assert.deepEqual(overview.backlog, { count: 1, balance: 300, stage: 'receiving', stageCount: 1 });

  assert.deepEqual(overview.settled, { count: 1, avgCycleDays: 20 });
  assert.equal(overview.lastPaidKey, '2026-09-21');

  assert.equal(overview.quality.missingDocuments, 1);
  assert.equal(overview.quality.noProject, 1);
  assert.equal(overview.quality.undated, 1);

  assert.equal(overview.backlogByMonth.length, 12);
  assert.equal(overview.backlogByMonth[11], 660, 'today: every open balance, undated included');
  // End of September: a, b, c and d were owed; e was received and paid by then.
  assert.equal(overview.backlogByMonth[10], 100 + 100 + 100 + 100);
  assert.equal(overview.backlogByMonth[7], 100, 'end of June: only c had been received');

  assert.equal(overview.weekly.length, 12);
  assert.equal(overview.weekly[11].start, '2026-09-28');
  assert.equal(overview.weekly[11].received, 1);
  const settledWeek = overview.weekly.find((week) => week.start === '2026-09-21');
  assert.deepEqual([settledWeek.settled, settledWeek.paid, settledWeek.cycleDays], [1, 80, 20]);
});

test('possible duplicates: same party and amount within a week', () => {
  const overview = buildOverview(
    [
      row({ id: '1', partyName: 'Acme', net: 500, dateKey: '2026-09-01' }),
      row({ id: '2', partyName: ' acme ', net: 500.2, dateKey: '2026-09-05' }),
      row({ id: '3', partyName: 'Acme', net: 500, dateKey: '2026-09-20' }),
      row({ id: '4', partyName: 'Acme', net: 900, dateKey: '2026-09-02' }),
      row({ id: '5', partyName: 'Acme', net: 500, dateKey: '2026-09-03', status: 'Cancelled' }),
    ],
    { todayKey: TODAY, range: { from: '', to: TODAY } },
  );
  assert.equal(overview.quality.possibleDuplicates, 2);
});