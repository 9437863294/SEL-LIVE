/**
 * Office Hub — the meeting register's arithmetic (2026-11-06 redesign, from the user's mockup).
 *
 * Pure and tested: which tab a meeting belongs to, what state its minutes are in, how a repeating
 * series collapses into one row, and which series are filling the register with cancelled
 * occurrences. The screen only draws what these return.
 */

import type { MeetingStatus, MomStage, OfficeHubMeeting } from './office-hub-model.ts';
import type { IsoDate } from './office-hub-time.ts';

export type RegisterTab = 'all' | 'upcoming' | 'today' | 'awaiting' | 'completed' | 'minutes' | 'cancelled';

export const REGISTER_TABS: readonly { value: RegisterTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'today', label: 'Today' },
  { value: 'awaiting', label: 'Reply needed' },
  { value: 'completed', label: 'Completed' },
  { value: 'minutes', label: 'Minutes pending' },
  { value: 'cancelled', label: 'Cancelled' },
];

type RegisterMeeting = Pick<OfficeHubMeeting, 'id' | 'date' | 'status' | 'endAt'> & Partial<Pick<OfficeHubMeeting, 'momStage'>>;

const NOT_HAPPENING = new Set<MeetingStatus>(['Cancelled', 'Postponed']);

/** Whether a meeting belongs on a tab. `awaitingIds` are the meetings I have not answered. */
export function inRegisterTab(
  meeting: RegisterMeeting,
  tab: RegisterTab,
  context: { today: IsoDate; nowMs: number; awaitingIds: ReadonlySet<string> },
): boolean {
  const ended = Date.parse(meeting.endAt) <= context.nowMs;
  switch (tab) {
    case 'all':
      return true;
    case 'upcoming':
      return (meeting.status === 'Scheduled' || meeting.status === 'In Progress') && !ended;
    case 'today':
      return meeting.date === context.today && !NOT_HAPPENING.has(meeting.status);
    case 'awaiting':
      return context.awaitingIds.has(meeting.id) && !NOT_HAPPENING.has(meeting.status) && meeting.status !== 'Completed' && !ended;
    case 'completed':
      return meeting.status === 'Completed';
    case 'minutes':
      return meeting.status === 'Completed' && meeting.momStage !== 'Published';
    case 'cancelled':
      return NOT_HAPPENING.has(meeting.status);
    default:
      return true;
  }
}

/**
 * Where a meeting's minutes stand, as the register says it.
 *   not-needed  it did not happen
 *   later       it has not happened yet
 *   due         it happened and nobody has started the minutes
 *   a MomStage  the minutes exist, at that stage of the ladder
 */
export type MinutesState = 'not-needed' | 'later' | 'due' | MomStage;

export function minutesState(meeting: Pick<OfficeHubMeeting, 'status'> & Partial<Pick<OfficeHubMeeting, 'momStage'>>): MinutesState {
  if (NOT_HAPPENING.has(meeting.status)) return 'not-needed';
  if (meeting.momStage) return meeting.momStage;
  if (meeting.status === 'Completed') return 'due';
  return 'later';
}

export const MINUTES_LABEL: Record<MinutesState, string> = {
  'not-needed': 'Not needed',
  later: 'Not held yet',
  due: 'Minutes due',
  Draft: 'Draft',
  Prepared: 'Prepared',
  Reviewed: 'Reviewed',
  Approved: 'Approved',
  Published: 'Published',
};

/** The series a meeting belongs to, or null for a one-off. The first meeting of a series is its parent. */
export function seriesKeyOf(meeting: Pick<OfficeHubMeeting, 'id'> & Partial<Pick<OfficeHubMeeting, 'seriesId' | 'isSeriesParent'>>): string | null {
  return meeting.seriesId ?? (meeting.isSeriesParent ? meeting.id : null);
}

export interface RegisterRow<M> {
  meeting: M;
  /** The other occurrences of the same series in the list, when repeats are grouped. */
  repeats: M[];
}

/**
 * One row per meeting, or — grouped — one row per series, represented by its first occurrence in
 * the list's own order, with the rest tucked under it. One-offs are untouched.
 */
export function groupRepeats<M extends Pick<OfficeHubMeeting, 'id'> & Partial<Pick<OfficeHubMeeting, 'seriesId' | 'isSeriesParent'>>>(
  meetings: readonly M[],
  grouped: boolean,
): RegisterRow<M>[] {
  if (!grouped) return meetings.map((meeting) => ({ meeting, repeats: [] }));
  const rows: RegisterRow<M>[] = [];
  const bySeries = new Map<string, RegisterRow<M>>();
  for (const meeting of meetings) {
    const key = seriesKeyOf(meeting);
    if (!key) {
      rows.push({ meeting, repeats: [] });
      continue;
    }
    const row = bySeries.get(key);
    if (row) row.repeats.push(meeting);
    else {
      const created = { meeting, repeats: [] as M[] };
      bySeries.set(key, created);
      rows.push(created);
    }
  }
  return rows;
}

export interface CancelledSeries {
  key: string;
  title: string;
  ids: string[];
}

/**
 * Series that have left two or more cancelled occurrences in the register — the clutter the
 * mockup's banner points at. Each occurrence is its own record, so they stay listed (and on the
 * calendar) until they are cleared.
 */
export function cancelledSeries(
  meetings: readonly (Pick<OfficeHubMeeting, 'id' | 'title' | 'status'> & Partial<Pick<OfficeHubMeeting, 'seriesId' | 'isSeriesParent'>>)[],
): CancelledSeries[] {
  const map = new Map<string, CancelledSeries>();
  for (const meeting of meetings) {
    if (!NOT_HAPPENING.has(meeting.status)) continue;
    const key = seriesKeyOf(meeting);
    if (!key) continue;
    const entry = map.get(key) ?? { key, title: meeting.title, ids: [] };
    entry.ids.push(meeting.id);
    map.set(key, entry);
  }
  return [...map.values()].filter((entry) => entry.ids.length >= 2).sort((a, b) => b.ids.length - a.ids.length);
}

/** Response tally as the register shows it: "3 of 5 accepted · 2 waiting". */
export function responseLine(summary: { accepted: number; maybe: number; declined: number; noResponse: number } | null | undefined): {
  total: number;
  text: string;
} {
  if (!summary) return { total: 0, text: '—' };
  const total = summary.accepted + summary.maybe + summary.declined + summary.noResponse;
  const parts = [`${summary.accepted} of ${total} accepted`];
  if (summary.noResponse) parts.push(`${summary.noResponse} waiting`);
  if (summary.declined) parts.push(`${summary.declined} declined`);
  return { total, text: parts.join(' · ') };
}
