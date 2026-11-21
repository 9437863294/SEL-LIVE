import assert from 'node:assert/strict';
import test from 'node:test';

const {
  defaultDprRecordingSchedule,
  describeDprSchedule,
  describeDprScheduleShort,
  dprExpectedDaysIn,
  dprIsRecordingDay,
  dprLatestRecordingDay,
  dprNextRecordingDay,
  dprPreviousRecordingDay,
  dprRecordingDaysIn,
  dprSheetCover,
  sanitizeDprRecordingSchedule,
  sanitizeDprScopeSchedule,
} = await import('../src/lib/project-management-dpr-schedule.ts');
const {
  buildDprBoard,
  buildDprPlan,
  checkDprSheet,
  defaultDprSettings,
  dprCalendar,
  indexDprActuals,
  sanitizeDprSettings,
} = await import('../src/lib/project-management-dpr-plan.ts');
const { buildDprLogChecks } = await import('../src/lib/project-management-dpr-log.ts');
const { buildDprFilingCalendar } = await import('../src/lib/project-management-dpr-dashboard.ts');

// November 2026: the 1st is a Sunday, so Saturdays are 7, 14, 21, 28 and Sundays 1, 8, 15, 22, 29.
const sundaysOff = dprCalendar({ weeklyOff: [0], holidays: [] });
const daily = { frequency: 'daily', weekdays: [] };
const saturdays = { frequency: 'weekly', weekdays: [6] };
const monThu = { frequency: 'days', weekdays: [1, 4] };

/* ── The setting ────────────────────────────────────────────────────────────────────────────── */

test('every scope records daily by default, and settings without a schedule read that way', () => {
  assert.deepEqual(defaultDprRecordingSchedule(), { Civil: daily, Erection: daily, Supply: daily });
  assert.deepEqual(sanitizeDprSettings({}).recordingSchedule, defaultDprRecordingSchedule());
  assert.deepEqual(defaultDprSettings().recordingSchedule, defaultDprRecordingSchedule());
});

test('a stored schedule is sanitised defensively', () => {
  assert.deepEqual(sanitizeDprScopeSchedule(null), daily);
  assert.deepEqual(sanitizeDprScopeSchedule({ frequency: 'monthly', weekdays: [1] }), daily);
  // Weekly keeps its first day, and with none reports on Saturday.
  assert.deepEqual(sanitizeDprScopeSchedule({ frequency: 'weekly', weekdays: [3, 5] }), { frequency: 'weekly', weekdays: [3] });
  assert.deepEqual(sanitizeDprScopeSchedule({ frequency: 'weekly' }), saturdays);
  // Specific days: duplicates and junk dropped, Monday first; none (or all seven) reads as daily.
  assert.deepEqual(sanitizeDprScopeSchedule({ frequency: 'days', weekdays: [0, 4, '1', 4, 9, -1] }), {
    frequency: 'days',
    weekdays: [1, 4, 0],
  });
  assert.deepEqual(sanitizeDprScopeSchedule({ frequency: 'days', weekdays: [] }), daily);
  assert.deepEqual(sanitizeDprScopeSchedule({ frequency: 'days', weekdays: [0, 1, 2, 3, 4, 5, 6] }), daily);
  // Daily drops any stored days.
  assert.deepEqual(sanitizeDprScopeSchedule({ frequency: 'daily', weekdays: [2] }), daily);
  // Per scope, with missing scopes defaulted.
  assert.deepEqual(sanitizeDprRecordingSchedule({ Supply: saturdays, Bogus: monThu }), {
    Civil: daily,
    Erection: daily,
    Supply: saturdays,
  });
});

test('a schedule is described in words', () => {
  assert.equal(describeDprSchedule(daily), 'Every working day');
  assert.equal(describeDprSchedule(saturdays), 'Weekly on Saturday');
  assert.equal(describeDprSchedule({ frequency: 'days', weekdays: [4, 1] }), 'Mon, Thu');
  assert.equal(describeDprScheduleShort(saturdays), 'weekly on Sat');
  assert.equal(describeDprScheduleShort(monThu), 'on Mon, Thu');
  assert.equal(describeDprScheduleShort(daily), 'every working day');
});

/* ── Reading it against the calendar ────────────────────────────────────────────────────────── */

test('recording days are the scheduled weekdays that are working days', () => {
  assert.equal(dprIsRecordingDay(daily, sundaysOff, '2026-11-20'), true);
  assert.equal(dprIsRecordingDay(daily, sundaysOff, '2026-11-22'), false, 'a Sunday off');
  assert.equal(dprIsRecordingDay(saturdays, sundaysOff, '2026-11-21'), true);
  assert.equal(dprIsRecordingDay(saturdays, sundaysOff, '2026-11-20'), false);
  assert.deepEqual(
    dprRecordingDaysIn(monThu, sundaysOff, { startDate: '2026-11-01', endDate: '2026-11-15' }),
    ['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12'],
  );
  // A scheduled day that is a holiday is skipped.
  const withHoliday = dprCalendar({ weeklyOff: [0], holidays: [{ date: '2026-11-14', reason: 'Diwali' }] });
  assert.deepEqual(
    dprRecordingDaysIn(saturdays, withHoliday, { startDate: '2026-11-01', endDate: '2026-11-30' }),
    ['2026-11-07', '2026-11-21', '2026-11-28'],
  );
  assert.equal(dprIsRecordingDay(daily, sundaysOff, 'not a date'), false);
});

test('previous, next and latest recording days', () => {
  assert.equal(dprPreviousRecordingDay(saturdays, sundaysOff, '2026-11-21'), '2026-11-14');
  assert.equal(dprNextRecordingDay(saturdays, sundaysOff, '2026-11-18'), '2026-11-21');
  assert.equal(dprLatestRecordingDay(saturdays, sundaysOff, '2026-11-20'), '2026-11-14');
  assert.equal(dprLatestRecordingDay(saturdays, sundaysOff, '2026-11-21'), '2026-11-21');
  // Daily on a Sunday off: the Saturday before.
  assert.equal(dprLatestRecordingDay(daily, sundaysOff, '2026-11-22'), '2026-11-21');
  assert.equal(dprLatestRecordingDay(daily, sundaysOff, '2026-11-23'), '2026-11-23');
});

test('a sheet covers the days since the previous recording day; daily and off-schedule sheets their own day', () => {
  assert.deepEqual(dprSheetCover(saturdays, sundaysOff, '2026-11-21'), { startDate: '2026-11-15', endDate: '2026-11-21' });
  assert.deepEqual(dprSheetCover(monThu, sundaysOff, '2026-11-12'), { startDate: '2026-11-10', endDate: '2026-11-12' });
  assert.deepEqual(dprSheetCover(monThu, sundaysOff, '2026-11-16'), { startDate: '2026-11-13', endDate: '2026-11-16' });
  assert.deepEqual(dprSheetCover(daily, sundaysOff, '2026-11-23'), { startDate: '2026-11-23', endDate: '2026-11-23' });
  assert.deepEqual(dprSheetCover(saturdays, sundaysOff, '2026-11-18'), { startDate: '2026-11-18', endDate: '2026-11-18' });
  // A holiday on the previous Saturday: this sheet covers both weeks.
  const withHoliday = dprCalendar({ weeklyOff: [0], holidays: [{ date: '2026-11-14', reason: '' }] });
  assert.deepEqual(dprSheetCover(saturdays, withHoliday, '2026-11-21'), { startDate: '2026-11-08', endDate: '2026-11-21' });
});

test('"All scopes" expects a sheet on any day one of the scopes records', () => {
  const schedule = { Civil: saturdays, Erection: monThu, Supply: saturdays };
  const range = { startDate: '2026-11-16', endDate: '2026-11-22' };
  assert.deepEqual(dprExpectedDaysIn(schedule, ['Civil', 'Erection'], sundaysOff, range), ['2026-11-16', '2026-11-19', '2026-11-21']);
  assert.deepEqual(dprExpectedDaysIn(schedule, ['Supply'], sundaysOff, range), ['2026-11-21']);
  // No schedule stored: every working day.
  assert.equal(dprExpectedDaysIn(undefined, ['Civil'], sundaysOff, range).length, 6);
});

/* ── The sheet check over a weekly window ───────────────────────────────────────────────────── */

const item = { id: 'pcc', scope: 'Supply', boqSlNo: '2.2', unit: 'Cum', boqQty: 1000 };
const items = new Map([[item.id, item]]);
// 30 Cum over November's 30 days (no weekly off for the plan): 1 a day.
const weekSettings = { ...defaultDprSettings(), recordingSchedule: { ...defaultDprRecordingSchedule(), Supply: saturdays } };
const plan = buildDprPlan(
  [{ id: 't', scope: 'Supply', boqItemId: 'pcc', unit: 'Cum', startDate: '2026-11-01', endDate: '2026-11-30', plannedQty: 30, distribution: 'even' }],
  { calendar: dprCalendar(weekSettings), decimalsFor: () => 3 },
);
const weeklySheet = (actual, remarks = '') => ({
  scope: 'Supply',
  date: '2026-11-21',
  weather: '',
  lines: [{ boqItemId: 'pcc', actual, location: '', remarks }],
  manpower: [{ trade: 'Helper', count: 2 }],
  equipment: [],
  lostTimeHours: '',
  lostTimeReason: '',
  hindrances: '',
});
const check = (actual, cover, remarks) =>
  checkDprSheet({
    sheet: weeklySheet(actual, remarks),
    items,
    plan,
    actuals: indexDprActuals([]),
    settings: weekSettings,
    projectDates: { startDate: '', endDate: '' },
    today: '2026-11-21',
    canRecordAnyDate: false,
    cover,
  });
const week = { startDate: '2026-11-15', endDate: '2026-11-21' };

test('a weekly sheet is read against the week’s plan, not the day’s', () => {
  // 7 Cum for the week is on plan; read against one day (1 Cum) it would be a 7× spike.
  assert.deepEqual(check('7', week), { errors: [], warnings: [] });
  assert.match(check('7').warnings.join(), /more than 3× the day’s plan of 1/);
  // A spike is measured against the week too, and says so.
  assert.match(check('25', week).warnings.join(), /more than 3× the plan of 7 for 15 Nov – 21 Nov/);
  // A zero owes an explanation for the week's plan.
  assert.match(check('0', week).errors.join(), /7 Cum was planned for 15 Nov – 21 Nov but nothing was done/);
  assert.deepEqual(check('0', week, 'Truck held at the gate').errors, []);
  // A one-day cover is exactly the daily check.
  assert.deepEqual(check('1', { startDate: '2026-11-21', endDate: '2026-11-21' }), check('1'));
});

/* ── Expected sheets follow the schedule ────────────────────────────────────────────────────── */

const entry = (scope, date) => ({ id: `${scope}-${date}`, scope, date, status: 'Submitted', lines: [], manpower: [], equipment: [] });

test('the log looks for sheets on recording days only, when given the schedule', () => {
  const entries = [entry('Supply', '2026-11-07'), entry('Supply', '2026-11-21')];
  const context = { calendar: sundaysOff, today: '2026-11-21', backdateDays: 2, scope: 'Supply' };
  const withoutSchedule = buildDprLogChecks(entries, context).find((check) => check.key === 'missing-days');
  assert.equal(withoutSchedule.dates.length, 11, 'every working day between them, without a schedule');
  assert.match(withoutSchedule.title, /working days/);
  const weekly = buildDprLogChecks(entries, { ...context, schedule: { ...defaultDprRecordingSchedule(), Supply: saturdays } });
  const missing = weekly.find((check) => check.key === 'missing-days');
  assert.deepEqual(missing.dates, ['2026-11-14']);
  assert.equal(missing.title, 'No Supply sheet for 14 Nov');
  // Every Saturday filed: nothing missing.
  const full = buildDprLogChecks([...entries, entry('Supply', '2026-11-14')], {
    ...context,
    schedule: { ...defaultDprRecordingSchedule(), Supply: saturdays },
  });
  assert.equal(full.some((check) => check.key === 'missing-days'), false);
});

test('the filing calendar marks days off a scope’s schedule as not expected', () => {
  const calendar = buildDprFilingCalendar({
    entries: [],
    settings: { weeklyOff: [0], holidays: [], recordingSchedule: { ...defaultDprRecordingSchedule(), Supply: saturdays } },
    range: { startDate: '2026-11-16', endDate: '2026-11-21' },
    scopes: ['Civil', 'Supply'],
    today: '2026-11-21',
  });
  const days = calendar.weeks.flat().filter(Boolean);
  const supply = Object.fromEntries(days.map((day) => [day.date, day.states.Supply]));
  const civil = Object.fromEntries(days.map((day) => [day.date, day.states.Civil]));
  assert.equal(supply['2026-11-18'], 'off');
  // Today is the Saturday it records on, with nothing filed: due, not yet a gap.
  assert.equal(supply['2026-11-21'], 'due');
  assert.equal(supply['2026-11-14'], undefined, 'outside the range shown');
  assert.equal(civil['2026-11-18'], 'missing', 'a daily scope still owes every working day');
});

test('the board counts recording days for its days-reported figure', () => {
  const board = buildDprBoard({
    items: [{ ...item, rate: 0 }],
    entries: [entry('Supply', '2026-11-14')],
    plan,
    settings: { ...weekSettings, weeklyOff: [0] },
    range: { startDate: '2026-11-01', endDate: '2026-11-30' },
    scope: 'Supply',
    today: '2026-11-21',
  });
  // Saturdays 7, 14 and 21 so far; 7, 14, 21 and 28 in the month.
  assert.equal(board.stats.workingDaysElapsed, 3);
  assert.equal(board.stats.workingDaysInPeriod, 4);
});
