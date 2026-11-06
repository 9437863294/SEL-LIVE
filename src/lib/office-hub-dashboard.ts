/**
 * Office Hub — the figures on the personal dashboard (2026-11-06 redesign, from the user's mockup).
 *
 * Pure, so every number on the page is tested under `node --test` rather than eyeballed. The page
 * reads three things — my meetings around today, my unanswered/maybe/declined invitation rows, and
 * my tasks — and everything else is derived here.
 *
 * ── How "my reply" is known with three reads instead of one per meeting ─────────────────────────
 *
 * Invitation rows are keyed `{meetingId}_{userId}` and nobody's list is small enough to read whole,
 * so the page asks only for the rows that are *not* Accepted (No Response, Maybe, Declined — an
 * indexed query, and short for anyone who answers their invitations). A meeting of mine with no
 * such row was accepted; one I organise is mine whatever the row says.
 */

import { addDays, clockToMinutes, daysBetween, utcToZonedParts, type IsoDate } from './office-hub-time.ts';
import type { InvitationResponse, OfficeHubMeeting, OfficeHubTimestampLike } from './office-hub-model.ts';

export type MyResponse = InvitationResponse | 'Organizer';

export type DashboardMeeting = Pick<
  OfficeHubMeeting,
  'id' | 'title' | 'date' | 'startTime' | 'endTime' | 'status' | 'organizerId' | 'organizerName' | 'meetingType' | 'mode' | 'startAt' | 'endAt'
> &
  Partial<Pick<OfficeHubMeeting, 'location' | 'room' | 'participantUserIds' | 'isDeleted' | 'onlinePlatform'>>;

export interface MyMeeting<M extends DashboardMeeting = DashboardMeeting> {
  meeting: M;
  response: MyResponse;
  /** Length in minutes; 0 when the times are unreadable. */
  minutes: number;
}

/** Meetings that never happened, or have not been sent, are not on anybody's calendar. */
const OFF_CALENDAR = new Set(['Draft', 'Cancelled', 'Postponed']);

/** Accepted, or organising it: the meeting is in my day. */
export function isGoing(response: MyResponse): boolean {
  return response === 'Accepted' || response === 'Organizer';
}

export function meetingMinutes(meeting: Pick<OfficeHubMeeting, 'startTime' | 'endTime'>): number {
  const start = clockToMinutes(meeting.startTime);
  const end = clockToMinutes(meeting.endTime);
  if (start == null || end == null) return 0;
  return end > start ? end - start : end + 1440 - start;
}

/** My meetings, each with my reply, earliest first. */
export function myMeetings<M extends DashboardMeeting>(
  meetings: readonly M[],
  options: { viewerId: string; responses: ReadonlyMap<string, InvitationResponse> },
): MyMeeting<M>[] {
  return meetings
    .filter((meeting) => !meeting.isDeleted && !OFF_CALENDAR.has(meeting.status))
    .map((meeting) => ({
      meeting,
      response: (meeting.organizerId === options.viewerId ? 'Organizer' : options.responses.get(meeting.id) ?? 'Accepted') as MyResponse,
      minutes: meetingMinutes(meeting),
    }))
    .sort((a, b) => a.meeting.startAt.localeCompare(b.meeting.startAt));
}

export interface InvitationBoard<M extends DashboardMeeting = DashboardMeeting> {
  /** Waiting for my answer and still to happen (or happening now). */
  upcoming: MyMeeting<M>[];
  /** Never answered, and already over — nothing left to decide, only to tidy away. */
  past: MyMeeting<M>[];
  counts: { waitingUpcoming: number; waitingPast: number; accepted: number; maybe: number; declined: number };
}

/**
 * The invitations panel. `hiddenMeetingIds` and `pastClearedAt` are the viewer's own tidy-ups
 * (Dismiss, Clear all past), kept in their Office Hub user settings; they change nothing the
 * organizer sees.
 */
export function invitationBoard<M extends DashboardMeeting>(
  mine: readonly MyMeeting<M>[],
  options: { nowMs: number; hiddenMeetingIds?: readonly string[]; pastClearedAt?: string | null },
): InvitationBoard<M> {
  const hidden = new Set(options.hiddenMeetingIds ?? []);
  const clearedAt = options.pastClearedAt ? Date.parse(options.pastClearedAt) : Number.NaN;
  const board: InvitationBoard<M> = {
    upcoming: [],
    past: [],
    counts: { waitingUpcoming: 0, waitingPast: 0, accepted: 0, maybe: 0, declined: 0 },
  };

  for (const entry of mine) {
    if (entry.response === 'Organizer') continue;
    if (entry.response === 'Accepted') board.counts.accepted += 1;
    else if (entry.response === 'Maybe') board.counts.maybe += 1;
    else if (entry.response === 'Declined') board.counts.declined += 1;
    else {
      const end = Date.parse(entry.meeting.endAt);
      const over = entry.meeting.status === 'Completed' || (Number.isFinite(end) && end <= options.nowMs);
      if (!over) {
        board.upcoming.push(entry);
      } else if (!hidden.has(entry.meeting.id) && !(Number.isFinite(clearedAt) && end <= clearedAt)) {
        board.past.push(entry);
      }
    }
  }
  board.past.reverse(); // most recent first
  board.counts.waitingUpcoming = board.upcoming.length;
  board.counts.waitingPast = board.past.length;
  return board;
}

/** Per day: meetings I am going to, and ones I have not settled (Maybe or no answer). */
export function dailyMeetingCounts(
  mine: readonly MyMeeting[],
  days: readonly IsoDate[],
): { date: IsoDate; going: number; unsettled: number; minutes: number }[] {
  return days.map((date) => {
    const onDay = mine.filter((entry) => entry.meeting.date === date);
    const going = onDay.filter((entry) => isGoing(entry.response));
    return {
      date,
      going: going.length,
      unsettled: onDay.filter((entry) => entry.response === 'Maybe' || entry.response === 'No Response').length,
      minutes: going.reduce((sum, entry) => sum + entry.minutes, 0),
    };
  });
}

/** `count` consecutive days starting at `from`. */
export function daysFrom(from: IsoDate, count: number): IsoDate[] {
  return Array.from({ length: count }, (_, index) => addDays(from, index));
}

/**
 * Where meeting time goes, by meeting type, for meetings I am going to between two dates.
 * The biggest `maxTypes` keep their own row; the rest are folded into "Other".
 */
export function minutesByType(
  mine: readonly MyMeeting[],
  options: { from: IsoDate; to: IsoDate; maxTypes?: number },
): { type: string; minutes: number }[] {
  const totals = new Map<string, number>();
  for (const entry of mine) {
    if (!isGoing(entry.response)) continue;
    if (entry.meeting.date < options.from || entry.meeting.date > options.to) continue;
    const type = entry.meeting.meetingType?.trim() || 'Other';
    totals.set(type, (totals.get(type) ?? 0) + entry.minutes);
  }
  const sorted = [...totals].map(([type, minutes]) => ({ type, minutes })).sort((a, b) => b.minutes - a.minutes);
  const max = options.maxTypes ?? 5;
  if (sorted.length <= max) return sorted;
  const kept = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((sum, row) => sum + row.minutes, 0);
  const other = kept.find((row) => row.type === 'Other');
  if (other) other.minutes += rest;
  else kept.push({ type: 'Other', minutes: rest });
  return kept;
}

/** Milliseconds from any of the stamp shapes Firestore and the model use. */
export function millisOf(value: OfficeHubTimestampLike | string): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if ('toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if ('seconds' in value && typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
}

/**
 * Tasks created and completed per week, for the last `weeks` weeks ending today (the last bucket
 * is the seven days up to and including today).
 */
export function weeklyTaskFlow(
  tasks: readonly { createdAt?: OfficeHubTimestampLike; completedAt?: string | null; status?: string }[],
  options: { today: IsoDate; timeZone: string; weeks?: number },
): { from: IsoDate; to: IsoDate; created: number; completed: number }[] {
  const weeks = options.weeks ?? 8;
  const buckets = Array.from({ length: weeks }, (_, index) => {
    const to = addDays(options.today, -7 * (weeks - 1 - index));
    return { from: addDays(to, -6), to, created: 0, completed: 0 };
  });
  const bucketOf = (millis: number | null) => {
    if (millis == null) return null;
    const date = utcToZonedParts(new Date(millis), options.timeZone).date;
    return buckets.find((bucket) => date >= bucket.from && date <= bucket.to) ?? null;
  };
  for (const task of tasks) {
    const created = bucketOf(millisOf(task.createdAt));
    if (created) created.created += 1;
    if (task.status === 'Completed') {
      const completed = bucketOf(millisOf(task.completedAt ?? null));
      if (completed) completed.completed += 1;
    }
  }
  return buckets;
}

/** Minutes in a working week, from the office's working days and hours. */
export function workingMinutesPerWeek(settings: { workingDays: readonly number[]; workingHoursStart: string; workingHoursEnd: string }): number {
  const start = clockToMinutes(settings.workingHoursStart);
  const end = clockToMinutes(settings.workingHoursEnd);
  if (start == null || end == null || end <= start) return 0;
  return settings.workingDays.length * (end - start);
}

/** "3 h 30 m", "45 m", "0 h". */
export function formatHours(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (!whole) return '0 h';
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (!hours) return `${rest} m`;
  return rest ? `${hours} h ${rest} m` : `${hours} h`;
}

/** Days from today to a due date, for "Due Mon" / "Overdue 2 d" chips. */
export function dueOffset(dueDate: IsoDate | null | undefined, today: IsoDate): number | null {
  return dueDate ? daysBetween(today, dueDate) : null;
}
