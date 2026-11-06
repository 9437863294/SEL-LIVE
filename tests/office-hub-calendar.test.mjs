import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calendarMeetingState,
  calendarMonthSummary,
  layoutDayColumns,
  meetingMatches,
  meetingSpan,
  monthGridDays,
} from '../src/lib/office-hub-calendar.ts';

const ME = 'U-me';
const responses = new Map([
  ['waiting', 'No Response'],
  ['maybe', 'Maybe'],
  ['no', 'Declined'],
]);
const state = (meeting) => calendarMeetingState({ status: 'Scheduled', organizerId: 'U-boss', participantUserIds: [ME], ...meeting }, { viewerId: ME, responses });

test('my state: organiser, my reply, cancelled beats everything, someone else’s meeting is "other"', () => {
  assert.equal(state({ id: 'own', organizerId: ME }), 'going');
  assert.equal(state({ id: 'accepted' }), 'going', 'no unaccepted row means accepted');
  assert.equal(state({ id: 'waiting' }), 'pending');
  assert.equal(state({ id: 'maybe' }), 'pending');
  assert.equal(state({ id: 'no' }), 'declined');
  assert.equal(state({ id: 'waiting', status: 'Cancelled' }), 'cancelled');
  assert.equal(state({ id: 'x', status: 'Postponed', organizerId: ME }), 'cancelled');
  assert.equal(state({ id: 'x', status: 'Draft', organizerId: ME }), 'draft');
  assert.equal(state({ id: 'theirs', participantUserIds: ['U-other'] }), 'other');
  assert.equal(state({ id: 'theirs', participantUserIds: ['U-other'], scheduledById: ME }), 'going', 'scheduled on someone’s behalf');
});

test('overlapping meetings share a column cluster; an unrelated one keeps full width', () => {
  const layout = layoutDayColumns([
    { id: 'a', start: 600, end: 660 },
    { id: 'b', start: 600, end: 630 },
    { id: 'c', start: 630, end: 690 }, // fits under b once b ends
    { id: 'd', start: 900, end: 960 },
  ]);
  assert.deepEqual(layout.get('a'), { column: 0, columns: 2 });
  assert.deepEqual(layout.get('b'), { column: 1, columns: 2 });
  assert.deepEqual(layout.get('c'), { column: 1, columns: 2 });
  assert.deepEqual(layout.get('d'), { column: 0, columns: 1 });
});

test('three at once get three columns; back to back is not overlap', () => {
  const layout = layoutDayColumns([
    { id: 'a', start: 600, end: 720 },
    { id: 'b', start: 610, end: 640 },
    { id: 'c', start: 620, end: 700 },
    { id: 'd', start: 720, end: 780 },
  ]);
  assert.deepEqual([...['a', 'b', 'c'].map((id) => layout.get(id).columns)], [3, 3, 3]);
  assert.deepEqual(layout.get('d'), { column: 0, columns: 1 });
});

test('month grid: whole Monday weeks', () => {
  const days = monthGridDays('2026-11-18');
  assert.equal(days[0], '2026-10-26', 'November 2026 starts on a Sunday, so the grid opens on the Monday before');
  assert.equal(days.at(-1), '2026-12-06');
  assert.equal(days.length % 7, 0);
  assert.equal(monthGridDays('2026-02-10').length, 35);
});

test('month figures: in the month only; going minutes; tasks still open; declined and cancelled together', () => {
  const summary = calendarMonthSummary({
    anchor: '2026-11-06',
    meetings: [
      { date: '2026-11-03', state: 'going', minutes: 60 },
      { date: '2026-11-04', state: 'going', minutes: 30 },
      { date: '2026-11-05', state: 'pending', minutes: 60 },
      { date: '2026-11-06', state: 'declined', minutes: 60 },
      { date: '2026-11-07', state: 'cancelled', minutes: 60 },
      { date: '2026-11-08', state: 'other', minutes: 60 },
      { date: '2026-12-01', state: 'going', minutes: 600 },
    ],
    tasks: [
      { dueDate: '2026-11-10', status: 'In Progress' },
      { dueDate: '2026-11-11', status: 'Completed' },
      { dueDate: null, status: 'Not Started' },
    ],
    holidays: [{ date: '2026-11-08' }, { date: '2026-12-25' }],
  });
  assert.deepEqual(summary, { going: 2, goingMinutes: 90, pending: 1, dismissed: 2, tasksDue: 1, holidays: 1 });
});

test('search and spans', () => {
  const meeting = { title: 'Cash-flow review', organizerName: 'Vikram Das', meetingType: 'Finance', location: 'Head Office', room: 'Board Room' };
  assert.equal(meetingMatches(meeting, 'board'), true);
  assert.equal(meetingMatches(meeting, 'vikram'), true);
  assert.equal(meetingMatches(meeting, 'site'), false);
  assert.equal(meetingMatches(meeting, '  '), true);
  assert.deepEqual(meetingSpan({ startTime: '23:30', endTime: '00:30' }), { start: 1410, end: 1440 });
});
