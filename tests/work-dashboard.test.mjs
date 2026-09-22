import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DUE_SOON_DAYS,
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
