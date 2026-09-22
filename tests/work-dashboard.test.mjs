import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DUE_SOON_DAYS,
  addDays,
  addMonths,
  calendarItems,
  daysInMonth,
  itemsByDate,
  monthGrid,
  monthLabel,
  monthOf,
  shiftAnchor,
  viewLabel,
  viewRange,
  yearMonths,
  yearOf,
  compareWorkItems,
  countByModule,
  daysUntil,
  dropLowerLaneDuplicates,
  dueLabel,
  groupWorkItems,
  normalizeWorkPriority,
  summarizeWork,
  toWorkDate,
  workItemWeight,
  workUrgency,
} from '../src/lib/work-dashboard.ts';

const TODAY = '2026-09-22';

/** A minimal item, so each test states only the field it is about. */
const item = (overrides = {}) => ({
  id: overrides.id ?? 'source:doc',
  sourceId: overrides.sourceId ?? 'source',
  module: overrides.module ?? 'E-Approval',
  lane: overrides.lane ?? 'action',
  title: overrides.title ?? 'An item',
  href: overrides.href ?? '/e-approval/doc',
  ...overrides,
});

/* ── toWorkDate: the five date shapes the modules actually store ─────────────────────────────── */

test('toWorkDate passes an ISO calendar date through untouched', () => {
  // Not round-tripped through Date on purpose: doing so reinterprets the date in the local zone and
  // can move it a day, which would silently mark work overdue west of UTC.
  assert.equal(toWorkDate('2026-09-22'), '2026-09-22');
});

test('toWorkDate reduces an ISO instant to its calendar date', () => {
  assert.equal(toWorkDate('2026-09-22T16:45:00.000Z'), '2026-09-22');
});

test('toWorkDate reads a Firestore Timestamp through toDate()', () => {
  const stamp = { toDate: () => new Date(2026, 8, 22) };
  assert.equal(toWorkDate(stamp), '2026-09-22');
});

test('toWorkDate reads the legacy {seconds} shape', () => {
  const seconds = Math.floor(Date.UTC(2026, 8, 22, 12) / 1000);
  assert.equal(toWorkDate({ seconds }), '2026-09-22');
});

test('toWorkDate returns null for anything unparseable rather than guessing', () => {
  for (const value of [null, undefined, '', 'not a date', {}, { toDate: () => { throw new Error('x'); } }, NaN]) {
    assert.equal(toWorkDate(value), null, `expected null for ${JSON.stringify(value)}`);
  }
});

/* ── urgency ──────────────────────────────────────────────────────────────────────────────────── */

test('daysUntil is signed, and zero on the day itself', () => {
  assert.equal(daysUntil('2026-09-22', TODAY), 0);
  assert.equal(daysUntil('2026-09-25', TODAY), 3);
  assert.equal(daysUntil('2026-09-20', TODAY), -2);
});

test('daysUntil crosses a month boundary correctly', () => {
  assert.equal(daysUntil('2026-10-01', '2026-09-28'), 3);
});

test('workUrgency bands a deadline against today', () => {
  assert.equal(workUrgency({ dueAt: '2026-09-20' }, TODAY), 'overdue');
  assert.equal(workUrgency({ dueAt: '2026-09-22' }, TODAY), 'today');
  assert.equal(workUrgency({ dueAt: '2026-09-25' }, TODAY), 'soon');
  assert.equal(workUrgency({ dueAt: '2026-09-26' }, TODAY), 'later');
  assert.equal(workUrgency({ dueAt: null }, TODAY), 'undated');
});

test('the soon/later boundary is exactly DUE_SOON_DAYS', () => {
  const soon = new Date(Date.UTC(2026, 8, 22) + DUE_SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const later = new Date(Date.UTC(2026, 8, 22) + (DUE_SOON_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
  assert.equal(workUrgency({ dueAt: soon }, TODAY), 'soon');
  assert.equal(workUrgency({ dueAt: later }, TODAY), 'later');
});

test('dueLabel reads naturally on both sides of the deadline', () => {
  assert.equal(dueLabel({ dueAt: '2026-09-22' }, TODAY), 'Due today');
  assert.equal(dueLabel({ dueAt: '2026-09-23' }, TODAY), 'Due tomorrow');
  assert.equal(dueLabel({ dueAt: '2026-09-21' }, TODAY), '1 day overdue');
  assert.equal(dueLabel({ dueAt: '2026-09-19' }, TODAY), '3 days overdue');
  assert.equal(dueLabel({ dueAt: '2026-09-27' }, TODAY), 'Due in 5 days');
  assert.equal(dueLabel({ dueAt: null }, TODAY), 'No deadline');
});

/* ── priority ─────────────────────────────────────────────────────────────────────────────────── */

test("normalizeWorkPriority folds every module's scale onto one", () => {
  // Office Hub says Medium, Recurring Payments says Normal — they mean the same band.
  assert.equal(normalizeWorkPriority('Medium'), 'Normal');
  assert.equal(normalizeWorkPriority('Normal'), 'Normal');
  assert.equal(normalizeWorkPriority('critical'), 'Critical');
  assert.equal(normalizeWorkPriority('Urgent'), 'Critical');
  assert.equal(normalizeWorkPriority(' High '), 'High');
  assert.equal(normalizeWorkPriority('Low'), 'Low');
});

test('normalizeWorkPriority returns null for a value it does not know', () => {
  assert.equal(normalizeWorkPriority('P2'), null);
  assert.equal(normalizeWorkPriority(undefined), null);
  assert.equal(normalizeWorkPriority(3), null);
});

/* ── ordering ─────────────────────────────────────────────────────────────────────────────────── */

test('compareWorkItems puts the urgency bands in order', () => {
  const rows = [
    item({ id: 'a', dueAt: null }),
    item({ id: 'b', dueAt: '2026-09-26' }),
    item({ id: 'c', dueAt: '2026-09-20' }),
    item({ id: 'd', dueAt: '2026-09-22' }),
    item({ id: 'e', dueAt: '2026-09-24' }),
  ];
  const order = [...rows].sort((left, right) => compareWorkItems(left, right, TODAY)).map((row) => row.id);
  assert.deepEqual(order, ['c', 'd', 'e', 'b', 'a']);
});

test('within the overdue band, the oldest deadline comes first', () => {
  const rows = [
    item({ id: 'recent', dueAt: '2026-09-21' }),
    item({ id: 'ancient', dueAt: '2026-08-01' }),
    item({ id: 'middling', dueAt: '2026-09-10' }),
  ];
  const order = [...rows].sort((left, right) => compareWorkItems(left, right, TODAY)).map((row) => row.id);
  assert.deepEqual(order, ['ancient', 'middling', 'recent']);
});

test('meetings on the same day are ordered by their clock time', () => {
  const rows = [
    item({ id: 'afternoon', lane: 'meeting', dueAt: TODAY, startTime: '14:00' }),
    item({ id: 'morning', lane: 'meeting', dueAt: TODAY, startTime: '09:30' }),
    item({ id: 'noon', lane: 'meeting', dueAt: TODAY, startTime: '12:00' }),
  ];
  const order = [...rows].sort((left, right) => compareWorkItems(left, right, TODAY)).map((row) => row.id);
  assert.deepEqual(order, ['morning', 'noon', 'afternoon']);
});

test('priority breaks a tie on the same deadline', () => {
  const rows = [
    item({ id: 'low', dueAt: TODAY, priority: 'Low' }),
    item({ id: 'critical', dueAt: TODAY, priority: 'Critical' }),
    item({ id: 'normal', dueAt: TODAY, priority: 'Medium' }),
    item({ id: 'high', dueAt: TODAY, priority: 'High' }),
  ];
  const order = [...rows].sort((left, right) => compareWorkItems(left, right, TODAY)).map((row) => row.id);
  assert.deepEqual(order, ['critical', 'high', 'normal', 'low']);
});

test('the order is stable: identical inputs sort identically whatever order they arrive in', () => {
  const rows = [
    item({ id: 'x', module: 'Office Hub', title: 'Beta', dueAt: TODAY }),
    item({ id: 'y', module: 'E-Approval', title: 'Alpha', dueAt: TODAY }),
    item({ id: 'z', module: 'E-Approval', title: 'Zeta', dueAt: TODAY }),
  ];
  const forwards = [...rows].sort((l, r) => compareWorkItems(l, r, TODAY)).map((row) => row.id);
  const backwards = [...rows].reverse().sort((l, r) => compareWorkItems(l, r, TODAY)).map((row) => row.id);
  assert.deepEqual(forwards, backwards);
  // Module, then title.
  assert.deepEqual(forwards, ['y', 'z', 'x']);
});

/* ── grouping and de-duplication ──────────────────────────────────────────────────────────────── */

test('groupWorkItems splits into the four lanes and sorts each', () => {
  const lanes = groupWorkItems(
    [
      item({ id: 'a1', lane: 'action', dueAt: '2026-09-26' }),
      item({ id: 'a2', lane: 'action', dueAt: '2026-09-20' }),
      item({ id: 'm1', lane: 'meeting', dueAt: TODAY }),
      item({ id: 's1', lane: 'shared' }),
      item({ id: 'w1', lane: 'watching' }),
    ],
    TODAY,
  );
  assert.deepEqual(lanes.action.map((row) => row.id), ['a2', 'a1']);
  assert.equal(lanes.meeting.length, 1);
  assert.equal(lanes.shared.length, 1);
  assert.equal(lanes.watching.length, 1);
});

test('groupWorkItems collapses two identical rows from overlapping queries', () => {
  // E-Approval's inbox is three queries because Firestore cannot ask "any of these three arrays
  // contains me" in one, so the same document legitimately comes back twice.
  const duplicate = item({ id: 'e-approval-mine:NS-1' });
  const lanes = groupWorkItems([duplicate, { ...duplicate }], TODAY);
  assert.equal(lanes.action.length, 1);
});

test('dropLowerLaneDuplicates keeps the row that names you and drops the queue copy', () => {
  const kept = dropLowerLaneDuplicates([
    item({ id: 'e-approval-department:NS-1', lane: 'shared', href: '/e-approval/NS-1' }),
    item({ id: 'e-approval-mine:NS-1', lane: 'action', href: '/e-approval/NS-1' }),
    item({ id: 'e-approval-raised:NS-1', lane: 'watching', href: '/e-approval/NS-1' }),
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].lane, 'action');
});

test('dropLowerLaneDuplicates leaves distinct records alone', () => {
  const kept = dropLowerLaneDuplicates([
    item({ id: 'a', lane: 'action', href: '/e-approval/NS-1' }),
    item({ id: 'b', lane: 'shared', href: '/e-approval/NS-2' }),
  ]);
  assert.equal(kept.length, 2);
});

test('a shared row does not shadow an action row in a different module', () => {
  // Keyed on module and href together, so two modules holding a same-named route stay separate.
  const kept = dropLowerLaneDuplicates([
    item({ id: 'a', module: 'E-Approval', lane: 'action', href: '/x' }),
    item({ id: 'b', module: 'Office Hub', lane: 'shared', href: '/x' }),
  ]);
  assert.equal(kept.length, 2);
});

/* ── summary ──────────────────────────────────────────────────────────────────────────────────── */

test('summarizeWork counts the action lane and its overdue and due-today subsets', () => {
  const lanes = groupWorkItems(
    [
      item({ id: 'a1', lane: 'action', dueAt: '2026-09-20' }),
      item({ id: 'a2', lane: 'action', dueAt: '2026-09-19' }),
      item({ id: 'a3', lane: 'action', dueAt: TODAY }),
      item({ id: 'a4', lane: 'action', dueAt: '2026-10-30', module: 'Office Hub' }),
      item({ id: 'w1', lane: 'watching' }),
    ],
    TODAY,
  );
  const summary = summarizeWork(lanes, TODAY);
  assert.equal(summary.action, 4);
  assert.equal(summary.overdue, 2);
  assert.equal(summary.dueToday, 1);
  assert.equal(summary.watching, 1);
  assert.equal(summary.modules, 2);
});

test('meetingsToday counts only today, not the rest of the week', () => {
  const lanes = groupWorkItems(
    [
      item({ id: 'm1', lane: 'meeting', dueAt: TODAY, startTime: '09:00' }),
      item({ id: 'm2', lane: 'meeting', dueAt: TODAY, startTime: '15:00' }),
      item({ id: 'm3', lane: 'meeting', dueAt: '2026-09-25', startTime: '10:00' }),
    ],
    TODAY,
  );
  const summary = summarizeWork(lanes, TODAY);
  assert.equal(summary.meetingsToday, 2);
  assert.equal(lanes.meeting.length, 3);
});

test('a shared queue row counts as its depth, not as one row', () => {
  // Otherwise "in your team's queues: 2" would be the answer for two queues holding 300 documents.
  const lanes = groupWorkItems(
    [
      item({ id: 's1', lane: 'shared', count: 143 }),
      item({ id: 's2', lane: 'shared', count: 7 }),
      item({ id: 's3', lane: 'shared' }),
    ],
    TODAY,
  );
  assert.equal(summarizeWork(lanes, TODAY).shared, 151);
});

test('workItemWeight treats a missing, zero or negative count as one row', () => {
  assert.equal(workItemWeight(item({ count: 5 })), 5);
  assert.equal(workItemWeight(item({})), 1);
  assert.equal(workItemWeight(item({ count: 0 })), 1);
  assert.equal(workItemWeight(item({ count: -3 })), 1);
});

test('summarizeWork on an empty board is all zeroes, not NaN', () => {
  const summary = summarizeWork(groupWorkItems([], TODAY), TODAY);
  assert.deepEqual(summary, {
    action: 0,
    overdue: 0,
    dueToday: 0,
    shared: 0,
    meetingsToday: 0,
    watching: 0,
    modules: 0,
  });
});

/* ── breakdown ────────────────────────────────────────────────────────────────────────────────── */

test('countByModule orders by count, then by module name', () => {
  const counts = countByModule([
    item({ id: '1', module: 'Office Hub' }),
    item({ id: '2', module: 'E-Approval' }),
    item({ id: '3', module: 'E-Approval' }),
    item({ id: '4', module: 'Insurance' }),
    item({ id: '5', module: 'Office Hub' }),
    item({ id: '6', module: 'E-Approval' }),
  ]);
  assert.deepEqual(counts, [
    { module: 'E-Approval', count: 3 },
    { module: 'Office Hub', count: 2 },
    { module: 'Insurance', count: 1 },
  ]);
});

/* ── calendar arithmetic ──────────────────────────────────────────────────────────────────────── */

test('monthOf and addMonths roll the year correctly', () => {
  assert.equal(monthOf('2026-09-22'), '2026-09');
  assert.equal(addMonths('2026-09', 1), '2026-10');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-09', 0), '2026-09');
  // Multi-year jumps, in both directions. Sep 2026 + 12 is Sep 2027, so + 16 lands on Jan 2028.
  assert.equal(addMonths('2026-09', 12), '2027-09');
  assert.equal(addMonths('2026-09', 16), '2028-01');
  assert.equal(addMonths('2026-09', -21), '2024-12');
});

test('daysInMonth handles short months and leap years', () => {
  assert.equal(daysInMonth('2026-09'), 30);
  assert.equal(daysInMonth('2026-01'), 31);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29, 'a leap year February has 29 days');
  assert.equal(daysInMonth('2100-02'), 28, '2100 is not a leap year');
});

test('monthGrid returns whole weeks starting on Monday', () => {
  const weeks = monthGrid('2026-09');
  assert.ok(weeks.length >= 4 && weeks.length <= 6, `expected 4-6 weeks, got ${weeks.length}`);
  for (const week of weeks) assert.equal(week.length, 7);

  // 2026-09-01 is a Tuesday, so the grid opens on Monday 31 August.
  assert.equal(weeks[0][0], '2026-08-31');
  assert.equal(weeks[0][1], '2026-09-01');
});

test('monthGrid covers every day of the month exactly once', () => {
  for (const month of ['2026-02', '2026-09', '2028-02', '2026-12', '2027-01']) {
    const dates = monthGrid(month).flat();
    const inMonth = dates.filter((date) => date.startsWith(month));
    assert.equal(
      inMonth.length,
      daysInMonth(month),
      `${month}: grid holds ${inMonth.length} of its own days, expected ${daysInMonth(month)}`,
    );
    assert.equal(new Set(dates).size, dates.length, `${month}: a date appears twice`);
  }
});

test('monthGrid cells are consecutive days with no gap', () => {
  const dates = monthGrid('2026-10').flat();
  for (let index = 1; index < dates.length; index += 1) {
    assert.equal(daysUntil(dates[index], dates[index - 1]), 1, `gap before ${dates[index]}`);
  }
});

test('monthGrid spans a month that starts on a Monday without a leading week', () => {
  // 2027-02-01 is a Monday — the grid must not prepend a dead week.
  const weeks = monthGrid('2027-02');
  assert.equal(weeks[0][0], '2027-02-01');
});

test('itemsByDate buckets by calendar date and drops undated items', () => {
  const byDate = itemsByDate([
    item({ id: 'a', dueAt: '2026-09-22' }),
    item({ id: 'b', dueAt: '2026-09-22T18:00:00Z' }),
    item({ id: 'c', dueAt: '2026-09-25' }),
    item({ id: 'd', dueAt: null }),
  ]);
  assert.equal(byDate.get('2026-09-22')?.length, 2, 'an instant and a date on the same day share a bucket');
  assert.equal(byDate.get('2026-09-25')?.length, 1);
  assert.equal([...byDate.values()].flat().length, 3, 'the undated item is not placed');
});

test('itemsByDate orders a day chronologically, timed before untimed', () => {
  const byDate = itemsByDate([
    item({ id: 'untimed', dueAt: '2026-09-22', title: 'A deadline' }),
    item({ id: 'late', dueAt: '2026-09-22', startTime: '16:00' }),
    item({ id: 'early', dueAt: '2026-09-22', startTime: '09:00' }),
  ]);
  assert.deepEqual(byDate.get('2026-09-22')?.map((row) => row.id), ['early', 'late', 'untimed']);
});

test('calendarItems draws from every lane and counts what it cannot place', () => {
  const lanes = groupWorkItems(
    [
      item({ id: 'a', lane: 'action', dueAt: '2026-09-22' }),
      item({ id: 'm', lane: 'meeting', dueAt: '2026-09-23' }),
      item({ id: 'w', lane: 'watching', dueAt: '2026-09-24' }),
      item({ id: 's', lane: 'shared', dueAt: null, count: 4 }),
      item({ id: 'a2', lane: 'action', dueAt: null }),
    ],
    TODAY,
  );
  const { dated, undated } = calendarItems(lanes);
  assert.equal(dated.length, 3);
  assert.equal(undated, 2, 'the two undated rows are reported, not silently dropped');
});

test('monthLabel reads as a month and year', () => {
  assert.equal(monthLabel('2026-09'), 'September 2026');
  assert.equal(monthLabel('2027-01'), 'January 2027');
});

/* ── calendar views ───────────────────────────────────────────────────────────────────────────── */

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-09-22', 7), '2026-09-29');
  assert.equal(addDays('2026-09-28', 3), '2026-10-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29', 'leap day exists in 2028');
  assert.equal(addDays('not-a-date', 1), 'not-a-date', 'an unparseable date is returned unchanged');
});

test('shiftAnchor steps by the unit of the current view', () => {
  assert.equal(shiftAnchor('2026-09-22', 'day', 1), '2026-09-23');
  assert.equal(shiftAnchor('2026-09-22', 'day', -1), '2026-09-21');
  // Month and year snap to the first of the period, so paging does not drift on a 31st.
  assert.equal(shiftAnchor('2026-09-22', 'month', 1), '2026-10-01');
  assert.equal(shiftAnchor('2026-12-31', 'month', 1), '2027-01-01');
  assert.equal(shiftAnchor('2026-09-22', 'year', 1), '2027-01-01');
  assert.equal(shiftAnchor('2026-09-22', 'year', -1), '2025-01-01');
});

test('paging by month from the 31st does not skip a month', () => {
  // The classic date bug: 31 Jan + 1 month naively becomes 2 or 3 March. Snapping to the 1st avoids it.
  let anchor = '2026-01-31';
  const visited = [];
  for (let step = 0; step < 4; step += 1) {
    anchor = shiftAnchor(anchor, 'month', 1);
    visited.push(monthOf(anchor));
  }
  assert.deepEqual(visited, ['2026-02', '2026-03', '2026-04', '2026-05']);
});

test('viewRange covers exactly what each view draws', () => {
  // Day: itself.
  assert.deepEqual(viewRange('2026-09-22', 'day'), { from: '2026-09-22', to: '2026-09-22' });

  // Year: the whole calendar year.
  assert.deepEqual(viewRange('2026-09-22', 'year'), { from: '2026-01-01', to: '2026-12-31' });

  // Month: the grid's own span, which includes the days completing the first and last weeks —
  // otherwise a meeting on a visible leading day would not be fetched and its cell would read empty.
  const month = viewRange('2026-09-22', 'month');
  const grid = monthGrid('2026-09').flat();
  assert.equal(month.from, grid[0]);
  assert.equal(month.to, grid[grid.length - 1]);
  assert.ok(month.from <= '2026-09-01', 'the range starts no later than the 1st');
  assert.ok(month.to >= '2026-09-30', 'the range ends no earlier than the 30th');
});

test('a month view range is always whole weeks', () => {
  for (const anchor of ['2026-02-10', '2027-02-01', '2026-12-25', '2028-02-29']) {
    const { from, to } = viewRange(anchor, 'month');
    assert.equal((daysUntil(to, from) + 1) % 7, 0, `${anchor}: range is not a whole number of weeks`);
  }
});

test('yearMonths returns twelve padded months', () => {
  const months = yearMonths('2026');
  assert.equal(months.length, 12);
  assert.equal(months[0], '2026-01');
  assert.equal(months[11], '2026-12');
});

test('viewLabel names each view usefully', () => {
  assert.equal(viewLabel('2026-09-22', 'year'), '2026');
  assert.equal(viewLabel('2026-09-22', 'month'), 'September 2026');
  assert.equal(viewLabel('2026-09-22', 'day'), 'Tuesday, 22 September 2026');
});

test('yearOf reads the year off a date', () => {
  assert.equal(yearOf('2026-09-22'), '2026');
  assert.equal(yearOf('2026-09'), '2026');
});
