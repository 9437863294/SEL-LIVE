import test from 'node:test';
import assert from 'node:assert/strict';

import {
  availabilityQueryDates,
  buildMeetingAvailability,
  busyMinutesOnDay,
  findFreeSlot,
  knownRoomsFrom,
  mergeBusyIntervals,
  minuteToClock,
  roomKey,
  spansOverlap,
} from '../src/lib/office-hub-availability.ts';

const IST = 'Asia/Kolkata';
// 2026-11-09 in Kolkata is UTC+05:30, so 10:00 IST = 04:30Z.
const at = (time) => {
  const [h, m] = time.split(':').map(Number);
  const minutes = h * 60 + m - 330;
  const day = minutes < 0 ? '2026-11-08' : '2026-11-09';
  const wrapped = (minutes + 1440) % 1440;
  return `${day}T${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}:00.000Z`;
};
const meeting = (id, start, end, extra = {}) => ({
  id,
  status: 'Scheduled',
  startAt: at(start),
  endAt: at(end),
  participantUserIds: ['U-a'],
  mode: 'Offline',
  ...extra,
});

test('reads one calendar day either side, for meetings booked in other zones', () => {
  assert.deepEqual(availabilityQueryDates('2026-11-09'), { fromDate: '2026-11-08', toDate: '2026-11-10' });
});

test('busy times come from scheduled meetings only, merged per person, and never name the meeting', () => {
  const result = buildMeetingAvailability(
    [
      meeting('m1', '10:00', '11:00', { participantUserIds: ['U-a', 'U-b'] }),
      meeting('m2', '11:00', '11:30', { participantUserIds: ['U-a'] }), // back to back → one block
      meeting('draft', '14:00', '15:00', { status: 'Draft', participantUserIds: ['U-c'] }),
      meeting('gone', '14:00', '15:00', { status: 'Cancelled', participantUserIds: ['U-c'] }),
      meeting('deleted', '14:00', '15:00', { isDeleted: true, participantUserIds: ['U-c'] }),
      meeting('editing', '16:00', '17:00', { participantUserIds: ['U-d'] }),
    ],
    { date: '2026-11-09', timeZone: IST, excludeMeetingIds: ['editing'] },
  );

  assert.deepEqual(result.busy['U-a'], [{ startAt: at('10:00'), endAt: at('11:30') }]);
  assert.deepEqual(result.busy['U-b'], [{ startAt: at('10:00'), endAt: at('11:00') }]);
  assert.equal(result.busy['U-c'], undefined, 'drafts, cancelled and deleted meetings hold nobody');
  assert.equal(result.busy['U-d'], undefined, 'the meeting being edited does not clash with itself');
  assert.ok(!JSON.stringify(result).includes('title'));
});

test('a meeting outside the day, as the form’s zone reads it, is ignored', () => {
  const result = buildMeetingAvailability(
    [
      // 23:00–23:59 IST on the 8th is still the 8th in Kolkata.
      { id: 'late', status: 'Scheduled', startAt: '2026-11-08T17:30:00.000Z', endAt: '2026-11-08T18:29:00.000Z', participantUserIds: ['U-a'] },
    ],
    { date: '2026-11-09', timeZone: IST },
  );
  assert.deepEqual(result.busy, {});
});

test('rooms: known rooms are offered free, booked ones carry their bookings, an online meeting books none', () => {
  const result = buildMeetingAvailability(
    [
      meeting('m1', '10:00', '11:00', { room: 'Board Room', location: 'Head Office' }),
      meeting('m2', '12:00', '13:00', { room: 'Board Room', location: 'Head Office', mode: 'Online' }),
    ],
    {
      date: '2026-11-09',
      timeZone: IST,
      knownRooms: [
        { room: 'board room', location: 'head office' },
        { room: 'Conference Room 2', location: 'Head Office' },
      ],
    },
  );
  const board = result.rooms.find((room) => roomKey(room.room, room.location) === roomKey('Board Room', 'Head Office'));
  assert.deepEqual(board.busy, [{ startAt: at('10:00'), endAt: at('11:00') }]);
  assert.deepEqual(result.rooms.find((room) => room.room === 'Conference Room 2').busy, []);
  assert.equal(result.rooms.length, 2, 'the same room in different case is one room');
});

test('known rooms: most used first, empty and online ignored, same name at two sites is two rooms', () => {
  const rooms = knownRoomsFrom([
    { id: '1', room: 'Board Room', location: 'Head Office' },
    { id: '2', room: 'Board Room', location: 'Head Office' },
    { id: '3', room: 'Board Room', location: 'Lapanga site' },
    { id: '4', room: '  ', location: 'Head Office' },
    { id: '5', room: 'Zoom', mode: 'Online' },
  ]);
  assert.deepEqual(rooms, [
    { room: 'Board Room', location: 'Head Office' },
    { room: 'Board Room', location: 'Lapanga site' },
  ]);
});

test('minutes on the day: clipped at midnight both ends', () => {
  const spans = busyMinutesOnDay(
    [
      { startAt: at('09:30'), endAt: at('10:15') },
      { startAt: '2026-11-08T16:30:00.000Z', endAt: at('01:00') }, // 22:00 on the 8th → 01:00 on the 9th
    ],
    '2026-11-09',
    IST,
  );
  assert.deepEqual(spans, [
    { start: 570, end: 615 },
    { start: 0, end: 60 },
  ]);
});

test('free slot: first gap everyone shares, not in the past, null when the day is full', () => {
  const busy = [
    [{ start: 600, end: 660 }], // 10–11
    [{ start: 690, end: 720 }], // 11:30–12
  ];
  assert.equal(findFreeSlot({ busy, duration: 60, from: 600, to: 1080 }), 720);
  assert.equal(findFreeSlot({ busy, duration: 30, from: 600, to: 1080 }), 660);
  assert.equal(findFreeSlot({ busy, duration: 30, from: 600, to: 1080, notBefore: 701 }), 720);
  assert.equal(findFreeSlot({ busy: [[{ start: 0, end: 1440 }]], duration: 30, from: 540, to: 1080 }), null);
  assert.equal(spansOverlap([{ start: 600, end: 660 }], 660, 690), false, 'touching is not clashing');
});

test('merging and clock formatting', () => {
  assert.deepEqual(
    mergeBusyIntervals([
      { startAt: at('12:00'), endAt: at('13:00') },
      { startAt: at('10:00'), endAt: at('12:30') },
      { startAt: 'nonsense', endAt: at('13:00') },
    ]),
    [{ startAt: at('10:00'), endAt: at('13:00') }],
  );
  assert.equal(minuteToClock(570), '09:30');
  assert.equal(minuteToClock(2000), '23:59');
});
