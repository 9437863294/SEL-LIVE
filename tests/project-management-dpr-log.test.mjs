import assert from 'node:assert/strict';
import test from 'node:test';

const log = await import('../src/lib/project-management-dpr-log.ts');
const plan = await import('../src/lib/project-management-dpr-plan.ts');

const { dprLogSheetStats, summariseDprLog, buildDprLogChecks } = log;
const calendar = plan.dprCalendar({ weeklyOff: [0], holidays: [] }); // Sundays off

const sheet = (date, scope, { lines = [], crew = [], lost = 0, status = 'Submitted' } = {}) => ({
  id: `${scope}-${date}`,
  scope,
  date,
  status,
  lines: lines.map(([plannedQty, actualQty], index) => ({ id: `l${index}`, boqItemId: `b${index}`, boqSlNo: '', description: '', unit: '', plannedQty, actualQty })),
  manpower: crew.map((count, index) => ({ id: `m${index}`, trade: 'Helper', count })),
  equipment: [],
  lostTimeHours: lost,
});

test('a sheet is summarised by counts: lines, worked, behind its own plan snapshot, headcount, lost hours', () => {
  const stats = dprLogSheetStats(sheet('2026-11-12', 'Civil', { lines: [[2, 1], [0, 3], [1, 1], [4, 0]], crew: [10, 20], lost: 2 }));
  assert.deepEqual(stats, { lines: 4, worked: 3, behind: 2, manpower: 30, lostHours: 2 });
});

test('the summary totals the sheets shown, counting drafts and the days that lost time', () => {
  const summary = summariseDprLog([
    sheet('2026-11-12', 'Civil', { lines: [[1, 2]], crew: [5] }),
    sheet('2026-11-13', 'Civil', { lines: [[3, 1]], crew: [4], lost: 1.5, status: 'Draft' }),
  ]);
  assert.deepEqual(summary, { sheets: 2, drafts: 1, worked: 2, behind: 1, manpower: 9, lostHours: 1.5, lostDays: 1 });
});

test('work with no manpower is flagged per sheet, in the words of the mock-up', () => {
  const checks = buildDprLogChecks([sheet('2026-11-12', 'Civil', { lines: [[0, 1], [0, 2]] })], {
    calendar,
    today: '2026-11-14',
    backdateDays: 2,
  });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].tone, 'warning');
  assert.equal(checks[0].mark, '12');
  assert.equal(checks[0].title, '12 Nov: 2 lines worked with 0 manpower');
});

test('working days between the first and last sheet with no sheet are listed; days off are not', () => {
  const entries = [
    sheet('2026-11-14', 'Civil', { lines: [[0, 1]], crew: [30] }),
    sheet('2026-11-12', 'Civil', { lines: [[0, 1]], crew: [4] }),
  ];
  const [missing] = buildDprLogChecks(entries, { calendar, today: '2026-11-14', backdateDays: 2 });
  assert.deepEqual(
    { key: missing.key, title: missing.title, detail: missing.detail, dates: missing.dates },
    { key: 'missing-days', title: 'No sheet for 13 Nov', detail: 'Sheets exist for 12 and 14 Nov only.', dates: ['2026-11-13'] },
  );
  // 14 Nov is a Saturday, 15 Nov a Sunday (off): 14 → 17 misses only the Monday 16th.
  const overWeekend = buildDprLogChecks(
    [sheet('2026-11-14', 'Erection', { lines: [[0, 1]], crew: [1] }), sheet('2026-11-17', 'Erection', { lines: [[0, 1]], crew: [1] })],
    { calendar, today: '2026-11-20', backdateDays: 2, scope: 'Erection' },
  );
  assert.equal(overWeekend[0].title, 'No Erection sheet for 16 Nov');
});

test('a draft past the backdating window comes first, and more than three of a kind are summed', () => {
  const drafts = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((date) =>
    sheet(date, 'Civil', { lines: [[0, 1]], crew: [2], status: 'Draft' }),
  );
  const recent = sheet('2026-11-13', 'Civil', { lines: [[0, 1]], crew: [2], status: 'Draft' });
  const checks = buildDprLogChecks([...drafts, recent], { calendar, today: '2026-11-14', backdateDays: 2 });
  const stale = checks.filter((check) => check.key.startsWith('stale-draft'));
  assert.equal(stale.length, 4, 'three named, one summing the other two');
  assert.equal(stale[0].title, '02 Nov: Civil draft never submitted');
  assert.equal(stale[3].title, '2 more drafts never submitted');
  assert.equal(checks[0].tone, 'danger');
  assert.ok(!checks.some((check) => check.dates.includes('2026-11-13') && check.key.startsWith('stale')), 'within the window');
});

test('nothing to say yields no findings', () => {
  assert.deepEqual(
    buildDprLogChecks([sheet('2026-11-12', 'Civil', { lines: [[1, 1]], crew: [3] })], { calendar, today: '2026-11-14', backdateDays: 2 }),
    [],
  );
});
