/**
 * Office Hub — the calendar's arithmetic (2026-11-06 redesign, from the user's mockup).
 *
 * Pure and tested: what state a meeting is in *for me* (going, waiting for my reply, declined,
 * cancelled), how overlapping meetings share a day column, which days a month grid shows, and the
 * month's figures in the band. The screen only draws what these return.
 */

import { addDays, clockToMinutes, daysBetween, endOfMonth, startOfMonth, startOfWeek, type IsoDate } from './office-hub-time.ts';
import type { InvitationResponse, OfficeHubMeeting } from './office-hub-model.ts';

/**
 * How a meeting reads on my calendar.
 *
 *   going      I organise it or accepted it
 *   pending    I have not answered, or said Maybe — it may or may not happen for me
 *   declined   I said no; it still happens, without me
 *   cancelled  it is not happening (cancelled or postponed)
 *   draft      not sent yet (only its organiser sees it)
 *   other      someone else's meeting, shown because of a wider "Show" choice
 */
export type CalendarMeetingState = 'going' | 'pending' | 'declined' | 'cancelled' | 'draft' | 'other';

type StateMeeting = Pick<OfficeHubMeeting, 'id' | 'status' | 'organizerId'> & Partial<Pick<OfficeHubMeeting, 'participantUserIds' | 'scheduledById'>>;

export function calendarMeetingState(
  meeting: StateMeeting,
  options: { viewerId: string; responses: ReadonlyMap<string, InvitationResponse> },
): CalendarMeetingState {
  if (meeting.status === 'Cancelled' || meeting.status === 'Postponed') return 'cancelled';
  if (meeting.status === 'Draft') return 'draft';
  if (meeting.organizerId === options.viewerId) return 'going';
  const invited = (meeting.participantUserIds ?? []).includes(options.viewerId);
  if (!invited) return meeting.scheduledById === options.viewerId ? 'going' : 'other';
  const response = options.responses.get(meeting.id);
  if (response === 'Declined') return 'declined';
  if (response === 'No Response' || response === 'Maybe') return 'pending';
  return 'going';
}

/** Whether the state is one the "Show declined & cancelled" switch hides. */
export function isDismissedState(state: CalendarMeetingState): boolean {
  return state === 'declined' || state === 'cancelled';
}

/** Minutes after midnight for a meeting's start and end; an end at or before the start runs to midnight. */
export function meetingSpan(meeting: Pick<OfficeHubMeeting, 'startTime' | 'endTime'>): { start: number; end: number } {
  const start = clockToMinutes(meeting.startTime) ?? 0;
  const end = clockToMinutes(meeting.endTime);
  return { start, end: end != null && end > start ? end : 24 * 60 };
}

/**
 * Side-by-side columns for meetings that overlap on one day.
 *
 * Meetings are grouped into clusters of chained overlaps; within a cluster each takes the first
 * column free at its start, and every member is drawn `1 / columns` wide — so two meetings at 10:00
 * sit half-width beside each other, and an unrelated one at 15:00 keeps the full width.
 */
export function layoutDayColumns(
  items: readonly { id: string; start: number; end: number }[],
): Map<string, { column: number; columns: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map<string, { column: number; columns: number }>();
  let cluster: { id: string; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;

  const close = () => {
    const columns = Math.max(1, columnEnds.length);
    for (const member of cluster) result.set(member.id, { column: member.column, columns });
    cluster = [];
    columnEnds = [];
  };

  for (const item of sorted) {
    if (cluster.length && item.start >= clusterEnd) close();
    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.end);
    } else {
      columnEnds[column] = item.end;
    }
    cluster.push({ id: item.id, column });
    clusterEnd = Math.max(cluster.length === 1 ? item.end : clusterEnd, item.end);
  }
  if (cluster.length) close();
  return result;
}

/** The days a month grid shows: whole Monday-to-Sunday weeks covering the month (five or six). */
export function monthGridDays(anchor: IsoDate): IsoDate[] {
  const first = startOfWeek(startOfMonth(anchor));
  const last = addDays(startOfWeek(endOfMonth(anchor)), 6);
  return Array.from({ length: daysBetween(first, last) + 1 }, (_, index) => addDays(first, index));
}

export interface CalendarMonthSummary {
  going: number;
  goingMinutes: number;
  pending: number;
  /** Cancelled meetings plus ones I declined. */
  dismissed: number;
  tasksDue: number;
  holidays: number;
}

/** The band's figures for the month containing `anchor`. */
export function calendarMonthSummary(input: {
  anchor: IsoDate;
  meetings: readonly { date: IsoDate; state: CalendarMeetingState; minutes: number }[];
  tasks: readonly { dueDate?: IsoDate | null; status: string }[];
  holidays: readonly { date: IsoDate }[];
}): CalendarMonthSummary {
  const from = startOfMonth(input.anchor);
  const to = endOfMonth(input.anchor);
  const inMonth = (date: IsoDate | null | undefined) => Boolean(date) && (date as IsoDate) >= from && (date as IsoDate) <= to;
  const summary: CalendarMonthSummary = { going: 0, goingMinutes: 0, pending: 0, dismissed: 0, tasksDue: 0, holidays: 0 };
  for (const meeting of input.meetings) {
    if (!inMonth(meeting.date)) continue;
    if (meeting.state === 'going') {
      summary.going += 1;
      summary.goingMinutes += meeting.minutes;
    } else if (meeting.state === 'pending') summary.pending += 1;
    else if (isDismissedState(meeting.state)) summary.dismissed += 1;
  }
  summary.tasksDue = input.tasks.filter((task) => inMonth(task.dueDate) && task.status !== 'Completed' && task.status !== 'Cancelled').length;
  summary.holidays = input.holidays.filter((holiday) => inMonth(holiday.date)).length;
  return summary;
}

/** Search over what a person would type: title, organiser, place, type. Case-insensitive. */
export function meetingMatches(
  meeting: Pick<OfficeHubMeeting, 'title' | 'organizerName' | 'meetingType'> & Partial<Pick<OfficeHubMeeting, 'location' | 'room'>>,
  needle: string,
): boolean {
  const query = needle.trim().toLowerCase();
  if (!query) return true;
  return [meeting.title, meeting.organizerName, meeting.meetingType, meeting.location, meeting.room]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(query));
}
