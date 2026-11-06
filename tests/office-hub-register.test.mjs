import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelledSeries,
  groupRepeats,
  inRegisterTab,
  minutesState,
  responseLine,
  seriesKeyOf,
} from '../src/lib/office-hub-register.ts';

const now = Date.parse('2026-11-06T12:00:00.000Z');
const context = { today: '2026-11-06', nowMs: now, awaitingIds: new Set(['wait', 'wait-past']) };
const m = (id, status, extra = {}) => ({ id, status, date: '2026-11-10', endAt: '2026-11-10T06:00:00.000Z', ...extra });

test('tabs: upcoming excludes ended meetings, today excludes cancelled, minutes pending excludes published', () => {
  const tab = (meeting, name) => inRegisterTab(meeting, name, context);
  assert.equal(tab(m('a', 'Scheduled'), 'upcoming'), true);
  assert.equal(tab(m('a', 'Scheduled', { endAt: '2026-11-05T06:00:00.000Z' }), 'upcoming'), false, 'over, though nobody marked it complete');
  assert.equal(tab(m('a', 'Scheduled', { date: '2026-11-06' }), 'today'), true);
  assert.equal(tab(m('a', 'Cancelled', { date: '2026-11-06' }), 'today'), false);
  assert.equal(tab(m('a', 'Completed', { momStage: 'Draft' }), 'minutes'), true);
  assert.equal(tab(m('a', 'Completed'), 'minutes'), true, 'no minutes at all is the most pending');
  assert.equal(tab(m('a', 'Completed', { momStage: 'Published' }), 'minutes'), false);
  assert.equal(tab(m('a', 'Postponed'), 'cancelled'), true);
  assert.equal(tab(m('wait', 'Scheduled'), 'awaiting'), true);
  assert.equal(tab(m('wait-past', 'Scheduled', { endAt: '2026-11-01T06:00:00.000Z' }), 'awaiting'), false, 'too late to answer');
  assert.equal(tab(m('other', 'Scheduled'), 'awaiting'), false);
});

test('minutes state', () => {
  assert.equal(minutesState({ status: 'Cancelled', momStage: 'Draft' }), 'not-needed');
  assert.equal(minutesState({ status: 'Scheduled' }), 'later');
  assert.equal(minutesState({ status: 'Completed' }), 'due');
  assert.equal(minutesState({ status: 'Completed', momStage: 'Approved' }), 'Approved');
});

test('grouping: one row per series under its first occurrence in list order; one-offs untouched', () => {
  const list = [
    { id: 'p', seriesId: null, isSeriesParent: true },
    { id: 'x' },
    { id: 'o1', seriesId: 'p' },
    { id: 'o2', seriesId: 'p' },
    { id: 'q2', seriesId: 'q' },
  ];
  const rows = groupRepeats(list, true);
  assert.deepEqual(rows.map((row) => [row.meeting.id, row.repeats.map((r) => r.id)]), [
    ['p', ['o1', 'o2']],
    ['x', []],
    ['q2', []],
  ]);
  assert.equal(groupRepeats(list, false).length, 5);
  assert.equal(seriesKeyOf({ id: 'p', isSeriesParent: true }), 'p');
  assert.equal(seriesKeyOf({ id: 'x' }), null);
});

test('cancelled series: two or more cancelled occurrences, biggest first', () => {
  const found = cancelledSeries([
    { id: 'a1', title: 'mnhm', status: 'Cancelled', seriesId: 'a' },
    { id: 'a2', title: 'mnhm', status: 'Cancelled', seriesId: 'a' },
    { id: 'a3', title: 'mnhm', status: 'Cancelled', seriesId: 'a' },
    { id: 'b1', title: 'IT App reviews', status: 'Cancelled', seriesId: 'b' },
    { id: 'b2', title: 'IT App reviews', status: 'Postponed', seriesId: 'b' },
    { id: 'b3', title: 'IT App reviews', status: 'Scheduled', seriesId: 'b' },
    { id: 'c1', title: 'one cancelled', status: 'Cancelled', seriesId: 'c' },
    { id: 'solo', title: 'one-off', status: 'Cancelled' },
  ]);
  assert.deepEqual(found, [
    { key: 'a', title: 'mnhm', ids: ['a1', 'a2', 'a3'] },
    { key: 'b', title: 'IT App reviews', ids: ['b1', 'b2'] },
  ]);
});

test('response line', () => {
  assert.deepEqual(responseLine({ accepted: 3, maybe: 1, declined: 1, noResponse: 2 }), { total: 7, text: '3 of 7 accepted · 2 waiting · 1 declined' });
  assert.deepEqual(responseLine(null), { total: 0, text: '—' });
});
