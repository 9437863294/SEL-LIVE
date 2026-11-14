import assert from 'node:assert/strict';
import test from 'node:test';

const reports = await import('../src/lib/project-management-dpr-reports.ts');
const plan = await import('../src/lib/project-management-dpr-plan.ts');

const { buildDprManpowerReport, dprTradeOrder, shiftDprRange, neighbourAnchor } = reports;
const calendar = plan.dprCalendar({ weeklyOff: [0], holidays: [] }); // Sundays off

const sheet = (date, scope, manpower, status = 'Submitted') => ({
  id: `${scope}-${date}`,
  scope,
  date,
  status,
  lines: [],
  manpower: manpower.map(([trade, count], index) => ({ id: `m${index}`, trade, count })),
  equipment: [],
});

const WEEK = { startDate: '2026-11-09', endDate: '2026-11-15' }; // Mon–Sun

test('manpower is counted per date: two scopes on one day are one day for a trade', () => {
  const entries = [
    sheet('2026-11-10', 'Civil', [['Helper', 12], ['Mason', 4]]),
    sheet('2026-11-10', 'Erection', [['Helper', 8]]),
    sheet('2026-11-11', 'Civil', [['Helper', 10], ['Mason', 6]]),
  ];
  const report = buildDprManpowerReport(entries, { range: WEEK, calendar, today: '2026-11-15' });
  assert.equal(report.totalManDays, 40);
  const helper = report.rows.find((row) => row.trade === 'Helper');
  assert.deepEqual(
    { manDays: helper.manDays, days: helper.days, peak: helper.peak, avg: helper.avgPerDay },
    { manDays: 30, days: 2, peak: 20, avg: 15 },
  );
  assert.equal(Math.round(helper.sharePct), 75);
  assert.equal(report.largest.trade, 'Helper');
  assert.deepEqual(report.recordedDates, ['2026-11-10', '2026-11-11']);
});

test('a scope filter, drafts and rows without a trade or headcount are left out', () => {
  const entries = [
    sheet('2026-11-10', 'Civil', [['Helper', 12], ['', 5], ['Mason', 0]]),
    sheet('2026-11-10', 'Erection', [['Helper', 8]]),
    sheet('2026-11-12', 'Civil', [['Helper', 99]], 'Draft'),
  ];
  const report = buildDprManpowerReport(entries, { scope: 'Civil', range: WEEK, calendar, today: '2026-11-15' });
  assert.deepEqual(report.rows.map((row) => [row.trade, row.manDays]), [['Helper', 12]]);
  assert.deepEqual(report.recordedDates, ['2026-11-10']);
});

test('working days to date and the days with nothing recorded', () => {
  const entries = [sheet('2026-11-10', 'Civil', [['Helper', 10]])];
  // Thursday 12th: Mon–Thu have passed; Sunday is off.
  const report = buildDprManpowerReport(entries, { range: WEEK, calendar, today: '2026-11-12' });
  assert.equal(report.workingDays, 6);
  assert.equal(report.workingDaysToDate, 4);
  assert.deepEqual(report.missingDates, ['2026-11-09', '2026-11-11', '2026-11-12']);
});

test('an empty period reads as nothing, not as NaN', () => {
  const report = buildDprManpowerReport([], { range: WEEK, calendar, today: '2026-11-15' });
  assert.deepEqual(
    { rows: report.rows, total: report.totalManDays, largest: report.largest },
    { rows: [], total: 0, largest: null },
  );
});

test('trade colours follow the configured list, then the alphabet, across the whole register', () => {
  const entries = [
    sheet('2026-10-01', 'Civil', [['Welder', 1], ['helper', 2]]),
    sheet('2026-11-10', 'Erection', [['Mason', 3], ['Aaa crew', 1]], 'Draft'),
  ];
  assert.deepEqual(dprTradeOrder(entries, ['Mason', 'Helper', 'Carpenter']), ['Mason', 'helper', 'Aaa crew', 'Welder']);
});

test('progress dates: work above zero on counted sheets, up to today, in scope', () => {
  const { dprProgressDates } = reports;
  const day = (date, scope, actuals, status = 'Submitted') => ({
    ...sheet(date, scope, [], status),
    lines: actuals.map((actualQty, index) => ({ id: `l${index}`, boqItemId: `b${index}`, actualQty })),
  });
  const entries = [
    day('2026-11-09', 'Civil', [0, 2]),
    day('2026-11-10', 'Civil', [0]),
    day('2026-11-10', 'Erection', [3]),
    day('2026-11-11', 'Civil', [5], 'Draft'),
    day('2026-11-14', 'Civil', [1]),
  ];
  const options = { range: WEEK, today: '2026-11-12' };
  assert.deepEqual(dprProgressDates(entries, options), ['2026-11-09', '2026-11-10']);
  assert.deepEqual(dprProgressDates(entries, { ...options, scope: 'Civil' }), ['2026-11-09']);
});

test('stepping a period: same length before or after, and a date inside the neighbour', () => {
  assert.deepEqual(shiftDprRange(WEEK, -1), { startDate: '2026-11-02', endDate: '2026-11-08' });
  assert.deepEqual(shiftDprRange({ startDate: '2026-11-10', endDate: '2026-11-12' }, 1), {
    startDate: '2026-11-13',
    endDate: '2026-11-15',
  });
  assert.equal(neighbourAnchor({ startDate: '2026-11-01', endDate: '2026-11-30' }, -1), '2026-10-31');
  assert.equal(neighbourAnchor({ startDate: '2026-11-01', endDate: '2026-11-30' }, 1), '2026-12-01');
});
