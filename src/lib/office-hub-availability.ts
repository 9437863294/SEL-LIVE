/**
 * Office Hub — who is free, and which rooms are taken (the meeting form's "Who's free").
 *
 * Pure: the server route reads the meetings and hands them to `buildMeetingAvailability`; the form
 * turns the result into minutes on the chosen day with `busyMinutesOnDay` and asks `findFreeSlot`
 * for the first time everyone can make. Both halves are tested under `node --test`.
 *
 * ── What counts as busy ─────────────────────────────────────────────────────────────────────────
 *
 * Office Hub meetings only — not Google Calendar, not leave. A meeting holds its participants'
 * time from the moment it is scheduled until it is cancelled; a draft holds nobody's, because
 * nobody has been asked yet. What is returned is *when*, never *what*: no titles and no organizer,
 * so the free/busy view tells an organizer as much as an office calendar on the wall would.
 *
 * ── Why the day is read through instants ────────────────────────────────────────────────────────
 *
 * Every meeting stores `startAt`/`endAt` as UTC instants. A meeting booked from Dubai at 09:00 is
 * 10:30 in Kolkata, and only the instants make the two comparable. So the server reads the calendar
 * dates either side of the chosen one (any zone's day overlaps at most three of another's) and keeps
 * the meetings whose instants touch the chosen day as the form's own time zone reads it.
 */

import {
  addDays,
  clockToMinutes,
  utcToZonedParts,
  zonedTimeToUtc,
  type ClockTime,
  type IsoDate,
} from './office-hub-time.ts';

export interface BusyInterval {
  /** ISO instants. */
  startAt: string;
  endAt: string;
}

export interface RoomAvailability {
  room: string;
  location: string | null;
  /** That room's bookings on the day asked about; empty when it is free all day. */
  busy: BusyInterval[];
}

export interface MeetingAvailability {
  date: IsoDate;
  timeZone: string;
  /** Office Hub user id → the times they are in another meeting that day, merged and sorted. */
  busy: Record<string, BusyInterval[]>;
  rooms: RoomAvailability[];
}

/** The fields the availability read needs from a meeting document. */
export interface AvailabilitySourceMeeting {
  id: string;
  status?: string | null;
  isDeleted?: boolean | null;
  startAt?: string | null;
  endAt?: string | null;
  participantUserIds?: string[] | null;
  mode?: string | null;
  room?: string | null;
  location?: string | null;
}

/** A draft has asked nobody and a cancelled or postponed meeting holds nobody's time. */
const NOT_HOLDING_TIME = new Set(['Draft', 'Cancelled', 'Postponed']);

/** The meeting documents worth reading for `date`: one calendar day either side, for other zones. */
export function availabilityQueryDates(date: IsoDate): { fromDate: IsoDate; toDate: IsoDate } {
  return { fromDate: addDays(date, -1), toDate: addDays(date, 1) };
}

/** The chosen day as instants, read in `timeZone`: midnight to the next midnight. */
export function availabilityDayWindow(date: IsoDate, timeZone: string): { from: number; to: number } {
  return {
    from: zonedTimeToUtc(date, '00:00', timeZone).getTime(),
    to: zonedTimeToUtc(addDays(date, 1), '00:00', timeZone).getTime(),
  };
}

/** A room's identity: the same name at two sites is two rooms. */
export function roomKey(room: string, location?: string | null): string {
  return `${room.trim().toLowerCase()}|${(location ?? '').trim().toLowerCase()}`;
}

/** Whether a meeting uses a physical room at all. */
function isPhysical(meeting: AvailabilitySourceMeeting): boolean {
  return meeting.mode !== 'Online';
}

function instantsOf(meeting: AvailabilitySourceMeeting): { start: number; end: number } | null {
  const start = Date.parse(meeting.startAt ?? '');
  const end = Date.parse(meeting.endAt ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

/** Sort and join overlapping or touching intervals, so a back-to-back afternoon reads as one block. */
export function mergeBusyIntervals(intervals: readonly BusyInterval[]): BusyInterval[] {
  const sorted = intervals
    .map((interval) => ({ start: Date.parse(interval.startAt), end: Date.parse(interval.endAt) }))
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged.map((interval) => ({
    startAt: new Date(interval.start).toISOString(),
    endAt: new Date(interval.end).toISOString(),
  }));
}

/**
 * Rooms people have actually used, most used first.
 *
 * There is no room master in Office Hub, so the rooms offered are the ones meetings have been held
 * in. A room typed once in a hurry ("bord room") drops to the bottom of the list by itself.
 */
export function knownRoomsFrom(
  meetings: readonly AvailabilitySourceMeeting[],
  limit = 24,
): { room: string; location: string | null }[] {
  const counts = new Map<string, { room: string; location: string | null; count: number }>();
  for (const meeting of meetings) {
    if (meeting.isDeleted || !isPhysical(meeting)) continue;
    const room = meeting.room?.trim();
    if (!room) continue;
    const location = meeting.location?.trim() || null;
    const key = roomKey(room, location);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { room, location, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.room.localeCompare(b.room))
    .slice(0, limit)
    .map(({ room, location }) => ({ room, location }));
}

/**
 * Who is busy on `date` and which rooms are booked, from the meetings around it.
 *
 * `excludeMeetingIds` leaves out the meeting being edited, which would otherwise show its own
 * participants as clashing with themselves.
 */
export function buildMeetingAvailability(
  meetings: readonly AvailabilitySourceMeeting[],
  options: {
    date: IsoDate;
    timeZone: string;
    excludeMeetingIds?: readonly string[];
    knownRooms?: readonly { room: string; location: string | null }[];
  },
): MeetingAvailability {
  const window = availabilityDayWindow(options.date, options.timeZone);
  const excluded = new Set(options.excludeMeetingIds ?? []);
  const busy = new Map<string, BusyInterval[]>();
  const rooms = new Map<string, RoomAvailability>();

  for (const known of options.knownRooms ?? []) {
    if (!known.room?.trim()) continue;
    rooms.set(roomKey(known.room, known.location), { room: known.room.trim(), location: known.location ?? null, busy: [] });
  }

  for (const meeting of meetings) {
    if (meeting.isDeleted || excluded.has(meeting.id)) continue;
    if (NOT_HOLDING_TIME.has(meeting.status ?? '')) continue;
    const instants = instantsOf(meeting);
    if (!instants || instants.end <= window.from || instants.start >= window.to) continue;
    const interval: BusyInterval = { startAt: meeting.startAt as string, endAt: meeting.endAt as string };

    for (const userId of new Set(meeting.participantUserIds ?? [])) {
      if (!userId) continue;
      const list = busy.get(userId);
      if (list) list.push(interval);
      else busy.set(userId, [interval]);
    }

    const room = meeting.room?.trim();
    if (room && isPhysical(meeting)) {
      const location = meeting.location?.trim() || null;
      const key = roomKey(room, location);
      const entry = rooms.get(key) ?? { room, location, busy: [] };
      entry.busy.push(interval);
      rooms.set(key, entry);
    }
  }

  return {
    date: options.date,
    timeZone: options.timeZone,
    busy: Object.fromEntries([...busy].map(([userId, list]) => [userId, mergeBusyIntervals(list)])),
    rooms: [...rooms.values()].map((entry) => ({ ...entry, busy: mergeBusyIntervals(entry.busy) })),
  };
}

/* ── the form's side: minutes on the chosen day ─────────────────────────────────────────────── */

/** A span of the chosen day in minutes after its midnight, as the form's time zone reads it. */
export interface MinuteSpan {
  start: number;
  end: number;
}

/**
 * Intervals as minutes on `date` in `timeZone`, clipped to that day.
 *
 * Read through the zone's wall clock rather than by subtracting midnight, so a day with a clock
 * change still puts 14:00 at 14:00.
 */
export function busyMinutesOnDay(intervals: readonly BusyInterval[] | undefined, date: IsoDate, timeZone: string): MinuteSpan[] {
  const spans: MinuteSpan[] = [];
  for (const interval of intervals ?? []) {
    const start = minuteOnDay(new Date(interval.startAt), date, timeZone);
    const end = minuteOnDay(new Date(interval.endAt), date, timeZone);
    if (start == null || end == null || end <= start) continue;
    spans.push({ start, end });
  }
  return spans;
}

function minuteOnDay(instant: Date, date: IsoDate, timeZone: string): number | null {
  if (Number.isNaN(instant.getTime())) return null;
  const parts = utcToZonedParts(instant, timeZone);
  if (parts.date < date) return 0;
  if (parts.date > date) return 24 * 60;
  return clockToMinutes(parts.time);
}

/** Whether any span overlaps `[start, end)`. Touching is not overlapping: 10:00–11:00 then 11:00. */
export function spansOverlap(spans: readonly MinuteSpan[], start: number, end: number): boolean {
  return spans.some((span) => span.start < end && span.end > start);
}

/**
 * The first start, on a `step`-minute grid inside `[from, to]`, at which a meeting of `duration`
 * clashes with nobody — or null when the day has no such gap.
 *
 * `notBefore` keeps the suggestion out of the past when the day is today.
 */
export function findFreeSlot(options: {
  busy: readonly (readonly MinuteSpan[])[];
  duration: number;
  from: number;
  to: number;
  step?: number;
  notBefore?: number;
}): number | null {
  const step = options.step ?? 15;
  if (options.duration <= 0) return null;
  let start = Math.max(options.from, options.notBefore ?? options.from);
  start = Math.ceil(start / step) * step;
  for (; start + options.duration <= options.to; start += step) {
    const end = start + options.duration;
    if (!options.busy.some((spans) => spansOverlap(spans, start, end))) return start;
  }
  return null;
}

/** "HH:mm" for a minute of the day, clamped to the day. */
export function minuteToClock(minute: number): ClockTime {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minute)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}` as ClockTime;
}
