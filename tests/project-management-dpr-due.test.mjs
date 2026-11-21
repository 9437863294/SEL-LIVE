import assert from 'node:assert/strict';
import test from 'node:test';

const { buildDprRecordingStatus } = await import('../src/lib/project-management-dpr-due.ts');
const { sanitizeDprSettings } = await import('../src/lib/project-management-dpr-plan.ts');

const today = '2026-11-21'; // a Saturday
const settings = sanitizeDprSettings({
  weeklyOff: [0],
  recordingSchedule: {
    Civil: { frequency: 'daily', weekdays: [] },
    Erection: { frequency: 'days', weekdays: [1, 4] },
    Supply: { frequency: 'weekly', weekdays: [6] },
  },
});
const sheet = (scope, date, status = 'Submitted') => ({ scope, date, status });
const entries = [
  sheet('Civil', '2026-11-16'),
  sheet('Civil', '2026-11-17', 'Draft'),
  sheet('Civil', '2026-11-18'),
  sheet('Civil', '2026-11-20'),
  sheet('Supply', '2026-11-14'),
  sheet('Supply', '2026-11-21', 'Draft'),
];
const targets = [
  { scope: 'Civil', startDate: '2026-11-16' },
  { scope: 'Supply', startDate: '2026-11-01' },
];
const status = (over = {}) =>
  buildDprRecordingStatus({
    entries,
    targets,
    settings,
    scopes: ['Civil', 'Erection', 'Supply'],
    today,
    projectDates: { startDate: '2026-11-03', endDate: '2027-03-31' },
    ...over,
  });
const byScope = (rows) => Object.fromEntries(rows.map((row) => [row.scope, row]));

test('a daily scope is due today, and its gaps are the recording days it missed — drafts marked', () => {
  const { Civil } = byScope(status());
  assert.equal(Civil.scheduleText, 'Every working day');
  assert.deepEqual(Civil.due, { state: 'due-today', date: today });
  assert.deepEqual(Civil.lastSheet, { date: '2026-11-20', status: 'Submitted' });
  assert.equal(Civil.lastSubmitted, '2026-11-20');
  assert.equal(Civil.countedFrom, '2026-11-16', 'from its first projection, not the project start');
  assert.deepEqual(Civil.gaps, [
    { date: '2026-11-19', draft: false },
    { date: '2026-11-17', draft: true },
  ]);
});

test('a weekly scope counts only its weekday; a draft today is not submitted yet', () => {
  const { Supply } = byScope(status());
  assert.equal(Supply.scheduleText, 'Weekly on Saturday');
  assert.deepEqual(Supply.due, { state: 'draft-today', date: today });
  assert.equal(Supply.countedFrom, '2026-11-03', 'its projection began before the project did');
  assert.deepEqual(Supply.gaps, [{ date: '2026-11-07', draft: false }], 'the 14th was filed, today is no gap');
});

test('a scope with no projection and no sheet has not started: no gaps, the next day named', () => {
  const { Erection } = byScope(status());
  assert.equal(Erection.started, false);
  assert.equal(Erection.countedFrom, null);
  assert.deepEqual(Erection.gaps, []);
  assert.equal(Erection.scheduleText, 'Mon, Thu');
  assert.deepEqual(Erection.due, { state: 'next', date: '2026-11-23' });
});

test('today filed: the next recording day is due; none once the project has ended', () => {
  const filed = byScope(status({ entries: [...entries, sheet('Civil', today)] })).Civil;
  assert.equal(filed.todayDone, true);
  assert.deepEqual(filed.due, { state: 'next', date: '2026-11-23' }, 'Sunday is off');

  const ending = byScope(
    status({ entries: [...entries, sheet('Civil', today)], projectDates: { startDate: '2026-11-03', endDate: today } }),
  ).Civil;
  assert.deepEqual(ending.due, { state: 'none', date: null });
});

test('a day off the schedule is never due, and before the project starts the first day is named', () => {
  const sunday = byScope(status({ today: '2026-11-22' })).Civil;
  assert.deepEqual(sunday.due, { state: 'next', date: '2026-11-23' });
  assert.equal(sunday.gaps[0].date, '2026-11-21', 'yesterday (Saturday) was missed');

  const early = byScope(status({ today: '2026-10-20', entries: [], targets: [] })).Civil;
  assert.deepEqual(early.due, { state: 'next', date: '2026-11-03' });
  assert.equal(early.started, false);
});

test('only the scopes asked for, in the fixed order', () => {
  assert.deepEqual(status({ scopes: ['Supply', 'Civil'] }).map((row) => row.scope), ['Civil', 'Supply']);
});

test('the filing calendar agrees with the status: a scope that has not started has no gaps', async () => {
  const { buildDprFilingCalendar } = await import('../src/lib/project-management-dpr-dashboard.ts');
  const settings = sanitizeDprSettings({ weeklyOff: [0] });
  const entries = [{ id: 'Civil-2026-11-18', scope: 'Civil', date: '2026-11-18', status: 'Submitted', lines: [] }];
  const targets = [{ scope: 'Civil', startDate: '2026-11-17' }];
  const input = { entries, settings, range: { startDate: '2026-11-16', endDate: '2026-11-21' }, scopes: ['Civil', 'Erection'], today: '2026-11-20' };
  const calendar = buildDprFilingCalendar({ ...input, targets });
  const day = (date) => calendar.weeks.flat().find((cell) => cell && cell.date === date);
  // Civil started on 17 Nov (its projection): the 16th was not a gap, the 17th and 19th were.
  assert.equal(day('2026-11-16').states.Civil, 'off');
  assert.equal(day('2026-11-17').states.Civil, 'missing');
  assert.equal(day('2026-11-18').states.Civil, 'submitted');
  assert.equal(day('2026-11-19').states.Civil, 'missing');
  assert.equal(day('2026-11-20').states.Civil, 'due');
  // Erection has neither a projection nor a sheet: no gaps, as the status says "Not started".
  assert.equal(day('2026-11-17').states.Erection, 'off');
  assert.equal(calendar.counts.Erection.missing, 0);
  const status = buildDprRecordingStatus({ ...input, targets });
  assert.equal(status.find((row) => row.scope === 'Erection').started, false);
  assert.equal(status.find((row) => row.scope === 'Civil').gaps.length, calendar.counts.Civil.missing);
  // Without the projections the calendar keeps its old reading (every recording day counts).
  assert.equal(buildDprFilingCalendar(input).counts.Erection.missing > 0, true);
});
