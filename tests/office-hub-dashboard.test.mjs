import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dailyMeetingCounts,
  daysFrom,
  formatHours,
  invitationBoard,
  millisOf,
  minutesByType,
  myMeetings,
  weeklyTaskFlow,
  workingMinutesPerWeek,
} from '../src/lib/office-hub-dashboard.ts';

const ME = 'U-me';
const meeting = (id, date, start, end, extra = {}) => ({
  id,
  title: id,
  date,
  startTime: start,
  endTime: end,
  status: 'Scheduled',
  organizerId: 'U-boss',
  organizerName: 'Boss',
  meetingType: 'Review',
  mode: 'Offline',
  // Roughly IST (hour − 5); only the order of instants matters here.
  startAt: `${date}T${String(Number(start.slice(0, 2)) - 5).padStart(2, '0')}:${start.slice(3)}:00.000Z`,
  endAt: `${date}T${String(Number(end.slice(0, 2)) - 5).padStart(2, '0')}:${end.slice(3)}:00.000Z`,
  ...extra,
});

test('my reply: organiser, the rows that are not Accepted, otherwise Accepted; drafts and cancelled are off the calendar', () => {
  const mine = myMeetings(
    [
      meeting('own', '2026-11-06', '09:00', '10:00', { organizerId: ME }),
      meeting('waiting', '2026-11-06', '11:00', '12:00'),
      meeting('ok', '2026-11-06', '13:00', '13:30'),
      meeting('draft', '2026-11-06', '14:00', '15:00', { status: 'Draft' }),
      meeting('gone', '2026-11-06', '14:00', '15:00', { status: 'Cancelled' }),
    ],
    { viewerId: ME, responses: new Map([['waiting', 'No Response']]) },
  );
  assert.deepEqual(
    mine.map((entry) => [entry.meeting.id, entry.response, entry.minutes]),
    [
      ['own', 'Organizer', 60],
      ['waiting', 'No Response', 60],
      ['ok', 'Accepted', 30],
    ],
  );
});

test('invitations: upcoming vs already over, my own tidy-ups hide only past ones, organised meetings are not invitations', () => {
  const now = Date.parse('2026-11-06T12:00:00.000Z'); // 17:30 IST
  const mine = myMeetings(
    [
      meeting('past-1', '2026-11-04', '10:00', '11:00'),
      meeting('past-2', '2026-11-05', '10:00', '11:00'),
      meeting('past-hidden', '2026-11-05', '12:00', '13:00'),
      meeting('done', '2026-11-07', '10:00', '11:00', { status: 'Completed' }),
      meeting('next', '2026-11-09', '10:00', '11:00'),
      meeting('yes', '2026-11-09', '12:00', '13:00'),
      meeting('maybe', '2026-11-10', '12:00', '13:00'),
      meeting('no', '2026-11-10', '14:00', '15:00'),
      meeting('own', '2026-11-10', '16:00', '17:00', { organizerId: ME }),
    ],
    {
      viewerId: ME,
      responses: new Map([
        ['past-1', 'No Response'],
        ['past-2', 'No Response'],
        ['past-hidden', 'No Response'],
        ['done', 'No Response'],
        ['next', 'No Response'],
        ['maybe', 'Maybe'],
        ['no', 'Declined'],
      ]),
    },
  );

  const board = invitationBoard(mine, { nowMs: now, hiddenMeetingIds: ['past-hidden'] });
  assert.deepEqual(board.upcoming.map((entry) => entry.meeting.id), ['next']);
  assert.deepEqual(board.past.map((entry) => entry.meeting.id), ['done', 'past-2', 'past-1'], 'most recent first; Completed counts as over');
  assert.deepEqual(board.counts, { waitingUpcoming: 1, waitingPast: 3, accepted: 1, maybe: 1, declined: 1 });

  const cleared = invitationBoard(mine, { nowMs: now, pastClearedAt: '2026-11-05T00:00:00.000Z' });
  assert.deepEqual(cleared.past.map((entry) => entry.meeting.id), ['done', 'past-hidden', 'past-2'], 'clearing hides what had ended by then');
});

test('per day: going vs unsettled, minutes only for meetings I am going to', () => {
  const mine = myMeetings(
    [
      meeting('a', '2026-11-06', '10:00', '11:00'),
      meeting('b', '2026-11-06', '12:00', '12:30', { organizerId: ME }),
      meeting('c', '2026-11-06', '14:00', '15:00'),
      meeting('d', '2026-11-07', '14:00', '15:00'),
    ],
    { viewerId: ME, responses: new Map([['c', 'Maybe'], ['d', 'Declined']]) },
  );
  assert.deepEqual(dailyMeetingCounts(mine, daysFrom('2026-11-06', 2)), [
    { date: '2026-11-06', going: 2, unsettled: 1, minutes: 90 },
    { date: '2026-11-07', going: 0, unsettled: 0, minutes: 0 },
  ]);
});

test('time by meeting type: in range, going only, the tail folded into Other', () => {
  const mine = myMeetings(
    [
      meeting('1', '2026-11-06', '10:00', '12:00', { meetingType: 'Finance' }),
      meeting('2', '2026-11-06', '13:00', '14:00', { meetingType: 'Site' }),
      meeting('3', '2026-11-06', '14:00', '14:30', { meetingType: 'HR' }),
      meeting('4', '2026-11-06', '15:00', '15:15', { meetingType: 'IT' }),
      meeting('5', '2026-11-20', '15:00', '18:00', { meetingType: 'Finance' }),
      meeting('6', '2026-11-06', '16:00', '18:00', { meetingType: 'Client' }),
    ],
    { viewerId: ME, responses: new Map([['6', 'Declined']]) },
  );
  assert.deepEqual(minutesByType(mine, { from: '2026-11-02', to: '2026-11-08', maxTypes: 3 }), [
    { type: 'Finance', minutes: 120 },
    { type: 'Site', minutes: 60 },
    { type: 'Other', minutes: 45 },
  ]);
});

test('task flow: eight weeks ending today, created by stamp, completed only when completed', () => {
  const flow = weeklyTaskFlow(
    [
      { createdAt: { seconds: Date.parse('2026-11-05T06:00:00Z') / 1000 }, status: 'Completed', completedAt: '2026-11-06T06:00:00Z' },
      { createdAt: { toMillis: () => Date.parse('2026-10-28T06:00:00Z') }, status: 'In Progress', completedAt: '2026-11-01T06:00:00Z' },
      { createdAt: new Date('2026-08-01T06:00:00Z'), status: 'Not Started' },
    ],
    { today: '2026-11-06', timeZone: 'Asia/Kolkata' },
  );
  assert.equal(flow.length, 8);
  assert.deepEqual(flow[7], { from: '2026-10-31', to: '2026-11-06', created: 1, completed: 1 });
  assert.deepEqual(flow[6], { from: '2026-10-24', to: '2026-10-30', created: 1, completed: 0 }, 'not completed, so its stale completedAt is ignored');
  assert.equal(flow.reduce((sum, week) => sum + week.created, 0), 2, 'older than eight weeks is out');
});

test('small helpers', () => {
  assert.equal(workingMinutesPerWeek({ workingDays: [1, 2, 3, 4, 5], workingHoursStart: '09:30', workingHoursEnd: '18:30' }), 2700);
  assert.equal(formatHours(0), '0 h');
  assert.equal(formatHours(45), '45 m');
  assert.equal(formatHours(150), '2 h 30 m');
  assert.equal(formatHours(120), '2 h');
  assert.equal(millisOf(null), null);
  assert.equal(millisOf('nonsense'), null);
});
