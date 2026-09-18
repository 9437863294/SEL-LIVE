/**
 * Office Hub's business rules.
 *
 * Every function here is pure: it takes records and returns an answer, touches no network, and has
 * no opinion about React or Firestore. That is what lets `tests/office-hub-*.test.mjs` run them
 * directly under `node --test`, and what lets the cron route reach the same conclusions about an
 * Admin-SDK document that the browser reaches about a client one. If a rule matters — who may join
 * a meeting, when a task is overdue, whether minutes may be published — it belongs here rather than
 * in a component, because a rule expressed in a component is a rule that exists once per screen.
 *
 * The one thing this module will not do is decide authorization from a role. That needs the
 * permission map and lives in `office-hub-permissions.ts`, which is also pure and which calls into
 * the relationship tests below ("is this person the organizer?") to combine the two halves.
 */

import {
  addDays,
  clockSpanMinutes,
  clockToMinutes,
  daysBetween,
  formatIsoDate,
  isClockTime,
  isIsoDate,
  minutesToClock,
  todayInZone,
  utcToZonedParts,
  weekdayOf,
  zonedTimeToUtc,
  OFFICE_HUB_DEFAULT_TIME_ZONE,
  type ClockTime,
  type IsoDate,
} from './office-hub-time.ts';
import {
  CLOSED_TASK_STATUSES,
  DEFAULT_OFFICE_HUB_SETTINGS,
  EMPTY_RESPONSE_SUMMARY,
  MOM_STAGES,
  OFFICE_HUB_PRIORITY_WEIGHT,
  TERMINAL_MEETING_STATUSES,
  type ActionItemStatus,
  type AgendaTemplateItem,
  type AttendanceStatus,
  type DecisionStatus,
  type InvitationResponse,
  type MeetingResponseSummary,
  type MeetingStatus,
  type MomStage,
  type OfficeHubActionItem,
  type OfficeHubAgendaItem,
  type OfficeHubDecision,
  type OfficeHubEntityType,
  type OfficeHubMeeting,
  type OfficeHubMeetingTemplate,
  type OfficeHubParticipant,
  type OfficeHubPerson,
  type OfficeHubPriority,
  type OfficeHubSettings,
  type OfficeHubTask,
  type OfficeHubTeam,
  type ParticipantAttendanceRole,
  type ParticipantSource,
  type TaskDependency,
  type TaskStatus,
  type TaskSubtask,
} from './office-hub-model.ts';

/** Thrown when a caller asks for something the rules forbid. Carries a message fit for a toast. */
export class OfficeHubRuleError extends Error {
  readonly code: string;
  constructor(message: string, code = 'office-hub/rule-violation') {
    super(message);
    this.name = 'OfficeHubRuleError';
    this.code = code;
  }
}

/* ── small shared helpers ─────────────────────────────────────────────────────────────────────── */

export const uniqueStrings = (values: readonly (string | null | undefined)[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
};

/** Sort comparator: Critical first, then High, Medium, Low. */
export const byPriorityDescending = (a: OfficeHubPriority, b: OfficeHubPriority): number =>
  (OFFICE_HUB_PRIORITY_WEIGHT[b] ?? 0) - (OFFICE_HUB_PRIORITY_WEIGHT[a] ?? 0);

export const settingsOrDefaults = (
  settings: Partial<OfficeHubSettings> | null | undefined,
): OfficeHubSettings => ({
  ...DEFAULT_OFFICE_HUB_SETTINGS,
  ...(settings ?? {}),
  // Spread does not deep-merge, and an empty array in a stored settings document must not wipe out
  // the type list the form depends on.
  meetingTypes: settings?.meetingTypes?.length
    ? settings.meetingTypes
    : DEFAULT_OFFICE_HUB_SETTINGS.meetingTypes,
  workingDays: settings?.workingDays?.length
    ? settings.workingDays
    : DEFAULT_OFFICE_HUB_SETTINGS.workingDays,
  allowedUploadExtensions: settings?.allowedUploadExtensions?.length
    ? settings.allowedUploadExtensions
    : DEFAULT_OFFICE_HUB_SETTINGS.allowedUploadExtensions,
});

/**
 * The Indian financial year a date falls in, as the four digits used in references: April 2026 to
 * March 2027 is `2627`. Matches how every other module in this codebase numbers its records.
 */
export function officeHubFinancialYear(date: IsoDate): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`;
}

/** `TSK-2627-0041`. The sequence comes from a Firestore counter; this only formats it. */
export function officeHubReference(prefix: string, date: IsoDate, sequence: number): string {
  return `${prefix}-${officeHubFinancialYear(date)}-${String(Math.max(1, sequence)).padStart(4, '0')}`;
}

export function isWorkingDay(date: IsoDate, settings?: Partial<OfficeHubSettings> | null): boolean {
  const resolved = settingsOrDefaults(settings);
  if (resolved.holidays?.some((holiday) => holiday.date === date)) return false;
  return resolved.workingDays.includes(weekdayOf(date));
}

/** The holiday falling on a date, when the calendar should label it (§8). */
export function holidayOn(
  date: IsoDate,
  settings?: Partial<OfficeHubSettings> | null,
): { date: IsoDate; name: string } | null {
  return settingsOrDefaults(settings).holidays?.find((holiday) => holiday.date === date) ?? null;
}

/* ── meetings: time, status, and the clock ────────────────────────────────────────────────────── */

/** The derived UTC instants for a meeting's wall-clock fields. The only place these are produced. */
export function meetingInstants(meeting: {
  date: IsoDate;
  startTime: ClockTime;
  endTime: ClockTime;
  timeZone?: string | null;
}): { startAt: string; endAt: string } {
  const zone = meeting.timeZone || OFFICE_HUB_DEFAULT_TIME_ZONE;
  const start = zonedTimeToUtc(meeting.date, meeting.startTime, zone);
  const endMinutes = clockToMinutes(meeting.endTime);
  const startMinutes = clockToMinutes(meeting.startTime) ?? 0;
  // An end time at or before the start is read as running past midnight, which is the only reading
  // that produces a positive duration. `validateMeetingInput` rejects it on the way in; this path
  // exists for records already in the database.
  const rollsOver = endMinutes != null && endMinutes <= startMinutes;
  const endDate = rollsOver ? addDays(meeting.date, 1) : meeting.date;
  const end = zonedTimeToUtc(endDate, meeting.endTime, zone);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

export function meetingDurationMinutes(meeting: {
  startTime: ClockTime;
  endTime: ClockTime;
}): number {
  const span = clockSpanMinutes(meeting.startTime, meeting.endTime);
  if (span == null) return 0;
  return span > 0 ? span : span + 1440;
}

/** Add a duration to a start time, for the "duration" shortcut on the meeting form. */
export function endTimeFromDuration(startTime: ClockTime, durationMinutes: number): ClockTime {
  const start = clockToMinutes(startTime) ?? 0;
  return minutesToClock(start + Math.max(5, Math.round(durationMinutes)));
}

/**
 * What the meeting's status should be right now (§15).
 *
 * Only ever advances `Draft`/`Scheduled` → `In Progress` → `Completed`, and only for a meeting whose
 * status is not terminal. It will never un-cancel a meeting, never pull a manually-completed one
 * back to in-progress, and never promote a draft the organizer has not yet sent out — a draft has no
 * participants and starting it would mean a meeting nobody was invited to.
 *
 * Returns the *current* status when nothing should change, so callers can compare and only write on
 * a real transition.
 */
export function deriveMeetingStatus(
  meeting: Pick<OfficeHubMeeting, 'status' | 'startAt' | 'endAt'>,
  now: Date = new Date(),
): MeetingStatus {
  if (TERMINAL_MEETING_STATUSES.includes(meeting.status)) return meeting.status;
  if (meeting.status === 'Draft') return 'Draft';

  const start = Date.parse(meeting.startAt);
  const end = Date.parse(meeting.endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return meeting.status;

  const at = now.getTime();
  if (at >= end) return 'Completed';
  if (at >= start) return 'In Progress';
  return 'Scheduled';
}

export type MeetingTimeState = 'upcoming' | 'starting-soon' | 'live' | 'ended';

/** Where the meeting sits relative to now, for badges and the join button's emphasis. */
export function meetingTimeState(
  meeting: Pick<OfficeHubMeeting, 'startAt' | 'endAt'>,
  now: Date = new Date(),
  soonMinutes = 15,
): MeetingTimeState {
  const start = Date.parse(meeting.startAt);
  const end = Date.parse(meeting.endAt);
  const at = now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 'upcoming';
  if (at >= end) return 'ended';
  if (at >= start) return 'live';
  if (start - at <= soonMinutes * 60_000) return 'starting-soon';
  return 'upcoming';
}

export function isMeetingOnToday(
  meeting: Pick<OfficeHubMeeting, 'date'>,
  timeZone: string = OFFICE_HUB_DEFAULT_TIME_ZONE,
  now: Date = new Date(),
): boolean {
  return meeting.date === todayInZone(timeZone, now);
}

/**
 * The meeting's wall-clock reading in a *different* zone (§59).
 *
 * A meeting is stored in the organizer's zone; a participant whose profile says `Europe/London`
 * should see the time their own clock will show. This converts through the instant, which is the
 * only conversion that survives the two zones having different DST rules.
 */
export function meetingInViewerZone(
  meeting: Pick<OfficeHubMeeting, 'startAt' | 'endAt' | 'timeZone'>,
  viewerTimeZone: string | null | undefined,
): { date: IsoDate; startTime: ClockTime; endTime: ClockTime; shifted: boolean } | null {
  const zone = viewerTimeZone || OFFICE_HUB_DEFAULT_TIME_ZONE;
  const start = Date.parse(meeting.startAt);
  const end = Date.parse(meeting.endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const startParts = utcToZonedParts(new Date(start), zone);
  const endParts = utcToZonedParts(new Date(end), zone);
  return {
    date: startParts.date,
    startTime: startParts.time,
    endTime: endParts.time,
    shifted: (meeting.timeZone || OFFICE_HUB_DEFAULT_TIME_ZONE) !== zone,
  };
}

/* ── meetings: validation ─────────────────────────────────────────────────────────────────────── */

export interface MeetingValidationInput {
  title?: string | null;
  meetingType?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timeZone?: string | null;
  mode?: string | null;
  meetingUrl?: string | null;
  onlinePlatform?: string | null;
  location?: string | null;
  participantUserIds?: string[];
  organizerId?: string | null;
  status?: MeetingStatus;
}

/** Field name → message, so a form can attach each error to its own input (§79). */
export type OfficeHubFieldErrors = Record<string, string>;

/**
 * Everything §57 asks of a meeting, checked in one place.
 *
 * A draft is held to a lower bar on purpose: the whole point of saving a draft is to come back to
 * it, so a draft needs only a title. Everything else is required the moment the meeting is
 * scheduled, which is the moment other people start depending on it.
 */
export function validateMeetingInput(
  input: MeetingValidationInput,
  options: {
    settings?: Partial<OfficeHubSettings> | null;
    now?: Date;
    allowPast?: boolean;
    /**
     * Whether a joining link will be created for this meeting rather than typed into it.
     *
     * Set by the form when a `MeetingProvider` with `supportsCreation` is registered for the chosen
     * platform — in practice, when Google Meet is connected. Without it, an organizer would be
     * required to paste a link that the application is about to generate for them, which is a
     * validation error with no valid way to satisfy it.
     */
    conferenceWillBeCreated?: boolean;
  } = {},
): OfficeHubFieldErrors {
  const errors: OfficeHubFieldErrors = {};
  const isDraft = input.status === 'Draft';

  if (!input.title?.trim()) errors.title = 'Meeting title is required.';
  else if (input.title.trim().length > 180) errors.title = 'Keep the title under 180 characters.';

  if (isDraft) return errors;

  if (!input.meetingType?.trim()) errors.meetingType = 'Choose a meeting type.';

  if (!isIsoDate(input.date)) errors.date = 'Choose a valid date.';
  if (!isClockTime(input.startTime)) errors.startTime = 'Enter a start time.';
  if (!isClockTime(input.endTime)) errors.endTime = 'Enter an end time.';

  if (isClockTime(input.startTime) && isClockTime(input.endTime)) {
    const span = clockSpanMinutes(input.startTime, input.endTime) ?? 0;
    if (span <= 0) {
      // §57's own example. Overnight meetings are a real thing, but they are not what somebody who
      // typed 14:00–13:00 meant, and guessing wrong silently books a 23-hour meeting.
      errors.endTime = 'End time must be after the start time.';
    } else if (span < 5) {
      errors.endTime = 'A meeting needs at least 5 minutes.';
    } else if (span > 720) {
      errors.endTime = 'A meeting cannot run longer than 12 hours.';
    }
  }

  if (!options.allowPast && isIsoDate(input.date) && isClockTime(input.startTime)) {
    const zone = input.timeZone || settingsOrDefaults(options.settings).defaultTimeZone;
    const start = zonedTimeToUtc(input.date, input.startTime, zone);
    const now = options.now ?? new Date();
    // A minute of slack: the form's own clock and the server's are never exactly aligned, and
    // rejecting a meeting scheduled for "now" is a worse failure than accepting one a moment stale.
    if (start.getTime() < now.getTime() - 60_000) {
      errors.date = 'This time is in the past. Pick a later slot, or save it as a draft.';
    }
  }

  const mode = input.mode ?? 'Offline';
  if (mode === 'Online' || mode === 'Hybrid') {
    if (!input.meetingUrl?.trim()) {
      // Only a problem when nothing is going to fill it in. A link that will be minted on save is
      // not a missing link.
      if (!options.conferenceWillBeCreated) errors.meetingUrl = 'An online meeting needs a joining link.';
    } else if (!isLikelyUrl(input.meetingUrl)) {
      errors.meetingUrl = 'Enter a full link, starting with https://';
    }
    if (!input.onlinePlatform?.trim()) errors.onlinePlatform = 'Choose the platform.';
  }
  if (mode === 'Offline' || mode === 'Hybrid') {
    if (!input.location?.trim()) errors.location = 'Enter where the meeting will be held.';
  }

  if (!input.organizerId?.trim()) errors.organizerId = 'A meeting needs an organizer.';

  if (!input.participantUserIds?.length) {
    errors.participants = 'Invite at least one participant.';
  }

  return errors;
}

export function isLikelyUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return Boolean(parsed.hostname) && parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

export const hasFieldErrors = (errors: OfficeHubFieldErrors): boolean =>
  Object.keys(errors).length > 0;

/** The first error, for a toast that summarises a failed submit. */
export const firstFieldError = (errors: OfficeHubFieldErrors): string | null =>
  Object.values(errors)[0] ?? null;

/* ── participants ─────────────────────────────────────────────────────────────────────────────── */

export interface ParticipantSelection {
  /** Individually picked people. */
  userIds: string[];
  teamIds: string[];
  departmentIds: string[];
  /** Anyone in the three lists above named here is invited as optional rather than required. */
  optionalUserIds?: string[];
  optionalTeamIds?: string[];
  optionalDepartmentIds?: string[];
}

export const EMPTY_PARTICIPANT_SELECTION: ParticipantSelection = {
  userIds: [],
  teamIds: [],
  departmentIds: [],
  optionalUserIds: [],
  optionalTeamIds: [],
  optionalDepartmentIds: [],
};

/** The master data participant expansion reads. Supplied by the caller; never fetched here. */
export interface ParticipantDirectory {
  /** Everyone who can be invited, keyed however the caller likes — only the array is read. */
  people: OfficeHubPerson[];
  teams: Pick<OfficeHubTeam, 'id' | 'name' | 'members' | 'status' | 'leaderId'>[];
  departments: { id: string; name: string; status?: string }[];
}

export interface ResolvedParticipant {
  userId: string;
  name: string;
  email?: string | null;
  employeeId?: string | null;
  designation?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  attendanceRole: ParticipantAttendanceRole;
  source: ParticipantSource;
  sourceId?: string | null;
  sourceName?: string | null;
}

export interface ParticipantExpansion {
  participants: ResolvedParticipant[];
  /** Selections that resolved to nobody — a team with no active members, an unknown department. */
  warnings: string[];
}

/**
 * Turn "the Finance department, the Project team, and Ashish — Ashish optional" into one clean list.
 *
 * Three properties this must have, and they are the reason it is a function rather than three loops
 * at the call site:
 *
 *   1. **No duplicates, ever** (§10, §86). A person in both the Finance department and the Project
 *      team appears once. The *first* selection to name them wins the attribution, which is why
 *      individuals are expanded first: if you picked somebody by name, the meeting should say you
 *      picked them, not that their department was invited.
 *
 *   2. **Required beats optional.** Somebody reached both as a required department member and an
 *      optional individual is required. Downgrading them would quietly excuse the person the
 *      organizer most needed, and "required" is the safe direction to resolve a conflict in.
 *
 *   3. **The organizer is always in the list**, as a required participant, attributed to
 *      `Organizer`. A meeting whose own organizer is not a participant cannot be joined by them,
 *      and every attendance sheet would open with a missing row.
 *
 * Inactive people are skipped — §5's "automatically select eligible active employees".
 */
export function expandParticipantSelection(
  selection: ParticipantSelection,
  directory: ParticipantDirectory,
  organizer?: Pick<OfficeHubPerson, 'userId' | 'name' | 'email' | 'departmentId' | 'departmentName' | 'designation' | 'employeeId'> | null,
): ParticipantExpansion {
  const byUserId = new Map<string, OfficeHubPerson>();
  for (const person of directory.people) {
    if (person?.userId) byUserId.set(person.userId, person);
  }

  const resolved = new Map<string, ResolvedParticipant>();
  const warnings: string[] = [];

  const add = (
    userId: string,
    attendanceRole: ParticipantAttendanceRole,
    source: ParticipantSource,
    sourceId?: string | null,
    sourceName?: string | null,
    fallback?: Partial<OfficeHubPerson>,
  ) => {
    const person = byUserId.get(userId);
    const name = person?.name || fallback?.name;
    if (!name) return false;

    const existing = resolved.get(userId);
    if (existing) {
      // Property 2: required wins. Attribution stays with whoever got here first (property 1).
      if (attendanceRole === 'Required') existing.attendanceRole = 'Required';
      return false;
    }

    resolved.set(userId, {
      userId,
      name,
      email: person?.email ?? fallback?.email ?? null,
      employeeId: person?.employeeId ?? fallback?.employeeId ?? null,
      designation: person?.designation ?? fallback?.designation ?? null,
      departmentId: person?.departmentId ?? fallback?.departmentId ?? null,
      departmentName: person?.departmentName ?? fallback?.departmentName ?? null,
      attendanceRole,
      source,
      sourceId: sourceId ?? null,
      sourceName: sourceName ?? null,
    });
    return true;
  };

  if (organizer?.userId) {
    add(organizer.userId, 'Required', 'Organizer', null, null, organizer);
  }

  const optionalUsers = new Set(selection.optionalUserIds ?? []);
  const optionalTeams = new Set(selection.optionalTeamIds ?? []);
  const optionalDepartments = new Set(selection.optionalDepartmentIds ?? []);

  for (const userId of uniqueStrings(selection.userIds)) {
    const role: ParticipantAttendanceRole = optionalUsers.has(userId) ? 'Optional' : 'Required';
    if (!add(userId, role, 'Individual') && !resolved.has(userId)) {
      warnings.push('One selected employee is no longer active and was not invited.');
    }
  }

  for (const teamId of uniqueStrings(selection.teamIds)) {
    const team = directory.teams.find((entry) => entry.id === teamId);
    if (!team) {
      warnings.push('A selected team could not be found and was skipped.');
      continue;
    }
    if (team.status === 'Archived') {
      warnings.push(`Team "${team.name}" is archived and was skipped.`);
      continue;
    }
    const role: ParticipantAttendanceRole = optionalTeams.has(teamId) ? 'Optional' : 'Required';
    let added = 0;
    for (const member of team.members ?? []) {
      if (add(member.userId, role, 'Team', team.id, team.name, member)) added += 1;
    }
    if (!added && !(team.members ?? []).length) {
      warnings.push(`Team "${team.name}" has no members yet.`);
    }
  }

  for (const departmentId of uniqueStrings(selection.departmentIds)) {
    const department = directory.departments.find((entry) => entry.id === departmentId);
    const departmentName = department?.name ?? 'Department';
    if (department && department.status && department.status !== 'Active') {
      warnings.push(`Department "${departmentName}" is inactive and was skipped.`);
      continue;
    }
    const role: ParticipantAttendanceRole = optionalDepartments.has(departmentId)
      ? 'Optional'
      : 'Required';
    let added = 0;
    for (const person of directory.people) {
      if (person.departmentId !== departmentId) continue;
      if (add(person.userId, role, 'Department', departmentId, departmentName)) added += 1;
    }
    if (!added) warnings.push(`No active employees found in "${departmentName}".`);
  }

  return { participants: [...resolved.values()], warnings: uniqueStrings(warnings) };
}

/** The response counters a meeting caches, recomputed from its participant documents (§13). */
export function summarizeResponses(
  participants: readonly Pick<OfficeHubParticipant, 'response'>[],
): MeetingResponseSummary {
  const summary = { ...EMPTY_RESPONSE_SUMMARY };
  for (const participant of participants) {
    switch (participant.response) {
      case 'Accepted':
        summary.accepted += 1;
        break;
      case 'Maybe':
        summary.maybe += 1;
        break;
      case 'Declined':
        summary.declined += 1;
        break;
      default:
        summary.noResponse += 1;
    }
  }
  return summary;
}

/** Who the organizer can chase (§13). Optional attendees are included — they were still asked. */
export function nonResponders<T extends Pick<OfficeHubParticipant, 'response' | 'userId'>>(
  participants: readonly T[],
): T[] {
  return participants.filter((participant) => participant.response === 'No Response');
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  late: number;
  excused: number;
  unmarked: number;
  invited: number;
  /** Present + Late over invited, as a percentage — what the attendance report charts (§39). */
  attendanceRate: number;
}

export function summarizeAttendance(
  participants: readonly Pick<OfficeHubParticipant, 'attendance'>[],
): AttendanceSummary {
  const summary: AttendanceSummary = {
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    unmarked: 0,
    invited: participants.length,
    attendanceRate: 0,
  };
  for (const participant of participants) {
    switch (participant.attendance) {
      case 'Present':
        summary.present += 1;
        break;
      case 'Absent':
        summary.absent += 1;
        break;
      case 'Late':
        summary.late += 1;
        break;
      case 'Excused':
        summary.excused += 1;
        break;
      default:
        summary.unmarked += 1;
    }
  }
  summary.attendanceRate = summary.invited
    ? Math.round(((summary.present + summary.late) / summary.invited) * 100)
    : 0;
  return summary;
}

/**
 * The attendance sheet, pre-filled (§19).
 *
 * Invited participants are pre-populated rather than left blank, because the common case is that
 * almost everybody came: starting from "Present" and correcting two rows is one tenth of the work
 * of marking twenty. A participant who declined starts as `Absent` — they told us they would not be
 * there — and an optional attendee starts unmarked, because nobody agreed to expect them.
 */
export function prefillAttendance(
  participants: readonly Pick<OfficeHubParticipant, 'id' | 'userId' | 'response' | 'attendance' | 'attendanceRole'>[],
): Record<string, AttendanceStatus | null> {
  const draft: Record<string, AttendanceStatus | null> = {};
  for (const participant of participants) {
    if (participant.attendance) {
      draft[participant.id] = participant.attendance;
      continue;
    }
    if (participant.response === 'Declined') draft[participant.id] = 'Absent';
    else if (participant.attendanceRole === 'Optional') draft[participant.id] = null;
    else draft[participant.id] = 'Present';
  }
  return draft;
}

/* ── joining a meeting ────────────────────────────────────────────────────────────────────────── */

export interface MeetingJoinView {
  /** Whether the Join button should render at all. */
  canJoin: boolean;
  /** The link, or null when the viewer is not entitled to see it (§16). */
  url: string | null;
  /** Why the button is hidden or disabled, for the tooltip. */
  reason: string | null;
  /** Hybrid meetings show both; this is the physical half. */
  location: string | null;
  emphasise: boolean;
}

/**
 * What the Join Meeting control should show this viewer (§16).
 *
 * The link is withheld from anybody who is not a participant or the organizer, because a joining
 * URL *is* the access control for most conferencing platforms — anybody holding it can walk into
 * the meeting. Being able to see that a meeting exists is not the same as being entitled to attend
 * it, and the register deliberately shows the former to more people than the latter.
 */
export function meetingJoinView(
  meeting: Pick<
    OfficeHubMeeting,
    'mode' | 'meetingUrl' | 'location' | 'room' | 'status' | 'startAt' | 'endAt' | 'organizerId' | 'participantUserIds'
  >,
  viewerUserId: string | null | undefined,
  options: { canViewAllMeetings?: boolean; now?: Date } = {},
): MeetingJoinView {
  const physical = [meeting.location, meeting.room].filter(Boolean).join(' · ') || null;
  const base: MeetingJoinView = {
    canJoin: false,
    url: null,
    reason: null,
    location: meeting.mode === 'Online' ? null : physical,
    emphasise: false,
  };

  if (meeting.mode === 'Offline') {
    return { ...base, reason: 'This meeting is in person.' };
  }
  if (meeting.status === 'Cancelled') {
    return { ...base, reason: 'This meeting was cancelled.' };
  }
  if (!meeting.meetingUrl) {
    return { ...base, reason: 'The organizer has not added a joining link yet.' };
  }

  const isParticipant =
    Boolean(viewerUserId) &&
    (meeting.organizerId === viewerUserId || (meeting.participantUserIds ?? []).includes(viewerUserId!));

  if (!isParticipant && !options.canViewAllMeetings) {
    return { ...base, reason: 'Only invited participants can see the joining link.' };
  }

  const state = meetingTimeState(meeting, options.now ?? new Date());
  return {
    ...base,
    canJoin: true,
    url: meeting.meetingUrl,
    // Not a blocker — people join early, and a meeting that overran is still worth joining.
    reason: state === 'ended' ? 'This meeting has ended.' : null,
    emphasise: state === 'live' || state === 'starting-soon',
  };
}

/* ── agenda ───────────────────────────────────────────────────────────────────────────────────── */

export const nextAgendaOrder = (items: readonly Pick<OfficeHubAgendaItem, 'order'>[]): number =>
  items.reduce((highest, item) => Math.max(highest, item.order ?? 0), 0) + 1;

export const sortAgenda = <T extends { order: number }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/**
 * Move an agenda item to a new position and return the whole list's new order values (§17).
 *
 * Returns every item's order, not just the moved one, because a drag that renumbers only the moved
 * item leaves ties — and ties in a list the user has deliberately sequenced show up as items
 * swapping places at random on the next read.
 */
export function reorderAgenda<T extends { id: string; order: number }>(
  items: readonly T[],
  itemId: string,
  toIndex: number,
): { id: string; order: number }[] {
  const sorted = sortAgenda(items);
  const fromIndex = sorted.findIndex((item) => item.id === itemId);
  if (fromIndex < 0) return sorted.map((item, index) => ({ id: item.id, order: index + 1 }));

  const bounded = Math.max(0, Math.min(sorted.length - 1, toIndex));
  const [moved] = sorted.splice(fromIndex, 1);
  sorted.splice(bounded, 0, moved);
  return sorted.map((item, index) => ({ id: item.id, order: index + 1 }));
}

export const agendaTotalMinutes = (
  items: readonly Pick<OfficeHubAgendaItem, 'estimatedMinutes'>[],
): number => items.reduce((total, item) => total + (item.estimatedMinutes ?? 0), 0);

/**
 * Whether the agenda's estimates fit the slot booked, and by how much they miss (§17).
 *
 * Advisory, never blocking: an agenda that overruns its hour is extremely common and is the
 * organizer's business, but nobody notices they have booked 90 minutes of discussion into 60 until
 * something says so.
 */
export function agendaFitsMeeting(
  items: readonly Pick<OfficeHubAgendaItem, 'estimatedMinutes'>[],
  meeting: Pick<OfficeHubMeeting, 'startTime' | 'endTime'>,
): { estimated: number; available: number; overBy: number; fits: boolean } {
  const estimated = agendaTotalMinutes(items);
  const available = meetingDurationMinutes(meeting);
  return {
    estimated,
    available,
    overBy: Math.max(0, estimated - available),
    fits: estimated <= available,
  };
}

/** Agenda items from a template, ready to insert. */
export function agendaItemsFromTemplate(
  template: { items: AgendaTemplateItem[] },
): Omit<OfficeHubAgendaItem, 'id' | 'meetingId'>[] {
  return sortAgenda(template.items ?? []).map((item, index) => ({
    order: index + 1,
    title: item.title,
    description: item.description ?? null,
    expectedOutcome: item.expectedOutcome ?? null,
    estimatedMinutes: item.estimatedMinutes ?? null,
    priority: item.priority ?? 'Medium',
    presenterId: null,
    presenterName: null,
    documentIds: [],
    covered: false,
  }));
}

/* ── tasks ────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A task's progress, from its subtasks when it has any (§28).
 *
 * Completed and cancelled tasks are pinned to 100 and to whatever they were: a task cannot be
 * "complete, 60%", and a cancelled task's percentage is not a claim about anything. Where there are
 * no subtasks the hand-set value stands — that is the whole point of allowing one.
 */
export function taskProgress(
  task: Pick<OfficeHubTask, 'status' | 'progress' | 'subtasks'>,
): number {
  if (task.status === 'Completed') return 100;
  const subtasks = task.subtasks ?? [];
  if (!subtasks.length) return clampPercent(task.progress ?? 0);
  const done = subtasks.filter((subtask) => subtask.done).length;
  return clampPercent(Math.round((done / subtasks.length) * 100));
}

export const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));

export const isTaskClosed = (status: TaskStatus): boolean =>
  CLOSED_TASK_STATUSES.includes(status);

/**
 * Whether a task is overdue (§24, §31).
 *
 * A closed task is never overdue, however late it was finished — "overdue" is a call to action, and
 * there is no action left. A task with no due date is never overdue either: nobody promised a date,
 * so nothing has been missed.
 */
export function isTaskOverdue(
  task: Pick<OfficeHubTask, 'status' | 'dueDate'>,
  today: IsoDate,
): boolean {
  if (!task.dueDate || isTaskClosed(task.status)) return false;
  return task.dueDate < today;
}

export type TaskDueBucket = 'overdue' | 'due-today' | 'due-soon' | 'upcoming' | 'no-due-date' | 'closed';

/** Which dashboard list a task belongs in (§7, §25). */
export function taskDueBucket(
  task: Pick<OfficeHubTask, 'status' | 'dueDate'>,
  today: IsoDate,
  soonDays = 7,
): TaskDueBucket {
  if (isTaskClosed(task.status)) return 'closed';
  if (!task.dueDate) return 'no-due-date';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'due-today';
  return daysBetween(today, task.dueDate) <= soonDays ? 'due-soon' : 'upcoming';
}

/** Days a task is past due; 0 when it is not. */
export function taskOverdueDays(
  task: Pick<OfficeHubTask, 'status' | 'dueDate'>,
  today: IsoDate,
): number {
  if (!isTaskOverdue(task, today)) return 0;
  return Math.max(0, daysBetween(task.dueDate as IsoDate, today));
}

export interface TaskValidationInput {
  title?: string | null;
  assigneeId?: string | null;
  teamId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  progress?: number | null;
}

export function validateTaskInput(
  input: TaskValidationInput,
  options: { allowUnassigned?: boolean } = {},
): OfficeHubFieldErrors {
  const errors: OfficeHubFieldErrors = {};

  if (!input.title?.trim()) errors.title = 'Task title is required.';
  else if (input.title.trim().length > 180) errors.title = 'Keep the title under 180 characters.';

  if (!options.allowUnassigned && !input.assigneeId && !input.teamId) {
    errors.assigneeId = 'Assign the task to an employee or a team.';
  }

  if (input.startDate && !isIsoDate(input.startDate)) errors.startDate = 'Enter a valid start date.';
  if (input.dueDate && !isIsoDate(input.dueDate)) errors.dueDate = 'Enter a valid due date.';

  if (isIsoDate(input.startDate) && isIsoDate(input.dueDate) && input.dueDate < input.startDate) {
    errors.dueDate = 'Due date cannot be before the start date.';
  }

  if (input.progress != null && (input.progress < 0 || input.progress > 100)) {
    errors.progress = 'Progress must be between 0 and 100.';
  }

  return errors;
}

/** Subtask list with a new item appended, ordered. */
export function appendSubtask(
  subtasks: readonly TaskSubtask[] | undefined,
  subtask: Omit<TaskSubtask, 'order'>,
): TaskSubtask[] {
  const existing = [...(subtasks ?? [])];
  return [...existing, { ...subtask, order: existing.length + 1 }];
}

export const subtaskCompletion = (
  subtasks: readonly TaskSubtask[] | undefined,
): { done: number; total: number } => ({
  done: (subtasks ?? []).filter((subtask) => subtask.done).length,
  total: (subtasks ?? []).length,
});

/* ── task dependencies ───────────────────────────────────────────────────────────────────────── */

/**
 * Dependencies that stand in the way of completing this task (§29).
 *
 * Only `blocked-by` and `depends-on` can block; `blocks` is the same edge read from the other end
 * and says something about the *other* task. Statuses are supplied by the caller because this
 * module cannot read Firestore — the task screen already has the related tasks loaded.
 */
export function taskBlockers(
  task: Pick<OfficeHubTask, 'dependencies'>,
  statusByTaskId: Readonly<Record<string, TaskStatus>>,
): TaskDependency[] {
  return (task.dependencies ?? []).filter((dependency) => {
    if (dependency.type === 'blocks') return false;
    const status = statusByTaskId[dependency.taskId];
    // An unknown status is not treated as a blocker: a dependency whose task has been archived
    // would otherwise park the dependent task forever with nothing anybody can do about it.
    return status ? !isTaskClosed(status) : false;
  });
}

export function canCompleteTask(
  task: Pick<OfficeHubTask, 'dependencies' | 'status'>,
  statusByTaskId: Readonly<Record<string, TaskStatus>>,
): { allowed: boolean; reason: string | null; blockers: TaskDependency[] } {
  const blockers = taskBlockers(task, statusByTaskId);
  if (!blockers.length) return { allowed: true, reason: null, blockers: [] };
  const names = blockers.map((blocker) => blocker.taskTitle).join(', ');
  return {
    allowed: false,
    reason: `Finish ${names} first — this task is blocked by ${blockers.length === 1 ? 'it' : 'them'}.`,
    blockers,
  };
}

/** The mirror of a dependency, to be written on the other task so the graph stays symmetric. */
export function inverseDependencyType(type: TaskDependency['type']): TaskDependency['type'] {
  if (type === 'blocks') return 'blocked-by';
  if (type === 'blocked-by') return 'blocks';
  return 'blocks';
}

/**
 * Whether adding this dependency would create a cycle.
 *
 * A → B → C → A means three tasks none of which can ever be completed, and the UI gives no hint
 * that is what just happened. `edges` maps a task to the tasks it waits on; a depth-first walk from
 * the proposed prerequisite that reaches the dependent task proves the cycle.
 */
export function dependencyWouldCycle(
  dependentTaskId: string,
  prerequisiteTaskId: string,
  edges: Readonly<Record<string, readonly string[]>>,
): boolean {
  if (dependentTaskId === prerequisiteTaskId) return true;
  const seen = new Set<string>();
  const stack = [prerequisiteTaskId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === dependentTaskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of edges[current] ?? []) stack.push(next);
  }
  return false;
}

/** `blocked-by` / `depends-on` edges, in the shape `dependencyWouldCycle` expects. */
export function dependencyEdges(
  tasks: readonly Pick<OfficeHubTask, 'id' | 'dependencies'>[],
): Record<string, string[]> {
  const edges: Record<string, string[]> = {};
  for (const task of tasks) {
    edges[task.id] = (task.dependencies ?? [])
      .filter((dependency) => dependency.type !== 'blocks')
      .map((dependency) => dependency.taskId);
  }
  return edges;
}

/* ── task activity ────────────────────────────────────────────────────────────────────────────── */

export interface TaskActivityDraft {
  kind: string;
  summary: string;
  field?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * The activity entries an edit should produce (§31).
 *
 * Written from the diff rather than from the form, so an edit that changed nothing writes nothing —
 * a timeline padded with "updated the task" entries that name no change is worse than no timeline,
 * because it buries the entries that do.
 */
export function describeTaskChanges(
  before: Partial<OfficeHubTask>,
  after: Partial<OfficeHubTask>,
): TaskActivityDraft[] {
  const drafts: TaskActivityDraft[] = [];
  const show = (value: unknown): string => {
    if (value == null || value === '') return 'none';
    return String(value);
  };

  if (after.status && before.status !== after.status) {
    drafts.push({
      kind: after.status === 'Completed' ? 'completed' : 'status-changed',
      summary:
        after.status === 'Completed'
          ? 'Task completed'
          : `Status changed from ${show(before.status)} to ${after.status}`,
      field: 'status',
      from: show(before.status),
      to: after.status,
    });
    if (before.status === 'Completed' && after.status !== 'Completed') {
      drafts.push({ kind: 'reopened', summary: 'Task reopened', field: 'status' });
    }
  }

  if ('assigneeId' in after && before.assigneeId !== after.assigneeId) {
    drafts.push({
      kind: before.assigneeId ? 'reassigned' : 'assigned',
      summary: before.assigneeId
        ? `Reassigned from ${show(before.assigneeName)} to ${show(after.assigneeName)}`
        : `Assigned to ${show(after.assigneeName)}`,
      field: 'assignee',
      from: show(before.assigneeName),
      to: show(after.assigneeName),
    });
  }

  if ('teamId' in after && before.teamId !== after.teamId) {
    drafts.push({
      kind: 'assigned',
      summary: after.teamId
        ? `Assigned to team ${show(after.teamName)}`
        : `Removed from team ${show(before.teamName)}`,
      field: 'team',
      from: show(before.teamName),
      to: show(after.teamName),
    });
  }

  if (after.priority && before.priority !== after.priority) {
    drafts.push({
      kind: 'priority-changed',
      summary: `Priority changed from ${show(before.priority)} to ${after.priority}`,
      field: 'priority',
      from: show(before.priority),
      to: after.priority,
    });
  }

  if ('dueDate' in after && before.dueDate !== after.dueDate) {
    drafts.push({
      kind: 'due-date-changed',
      summary: `Due date changed from ${before.dueDate ? formatIsoDate(before.dueDate) : 'none'} to ${
        after.dueDate ? formatIsoDate(after.dueDate) : 'none'
      }`,
      field: 'dueDate',
      from: show(before.dueDate),
      to: show(after.dueDate),
    });
  }

  if (
    after.progress != null &&
    before.progress != null &&
    clampPercent(before.progress) !== clampPercent(after.progress)
  ) {
    drafts.push({
      kind: 'progress-changed',
      summary: `Progress moved from ${clampPercent(before.progress)}% to ${clampPercent(after.progress)}%`,
      field: 'progress',
      from: `${clampPercent(before.progress)}%`,
      to: `${clampPercent(after.progress)}%`,
    });
  }

  return drafts;
}

/**
 * Everyone who should hear about a task.
 *
 * Held on the record rather than derived per notification because the audience is the union of
 * several facts that are awkward to re-establish later: who it is assigned to *now*, who assigned
 * it, who leads the team it belongs to, and who has commented. Dropping somebody from the list when
 * they are reassigned away would be wrong — they were part of the conversation.
 */
export function mergeWatchers(
  existing: readonly string[] | undefined,
  ...additions: (string | null | undefined)[]
): string[] {
  return uniqueStrings([...(existing ?? []), ...additions]);
}

/* ── action items and decisions ───────────────────────────────────────────────────────────────── */

export const isOpenActionItemStatus = (status: ActionItemStatus): boolean =>
  status === 'Open' || status === 'In Progress';

export const isOpenDecisionStatus = (status: DecisionStatus): boolean =>
  status === 'Open' || status === 'In Progress';

export function isActionItemOverdue(
  item: Pick<OfficeHubActionItem, 'status' | 'dueDate'>,
  today: IsoDate,
): boolean {
  if (!item.dueDate || !isOpenActionItemStatus(item.status)) return false;
  return item.dueDate < today;
}

export function isDecisionOverdue(
  decision: Pick<OfficeHubDecision, 'status' | 'dueDate'>,
  today: IsoDate,
): boolean {
  if (!decision.dueDate || !isOpenDecisionStatus(decision.status)) return false;
  return decision.dueDate < today;
}

export interface ActionItemValidationInput {
  title?: string | null;
  responsibleUserId?: string | null;
  responsibleTeamId?: string | null;
  dueDate?: string | null;
}

export function validateActionItemInput(input: ActionItemValidationInput): OfficeHubFieldErrors {
  const errors: OfficeHubFieldErrors = {};
  if (!input.title?.trim()) errors.title = 'Describe the action item.';
  if (!input.responsibleUserId && !input.responsibleTeamId) {
    errors.responsibleUserId = 'Name who is responsible.';
  }
  if (input.dueDate && !isIsoDate(input.dueDate)) errors.dueDate = 'Enter a valid due date.';
  return errors;
}

export interface DecisionValidationInput {
  title?: string | null;
  decisionDate?: string | null;
  ownerId?: string | null;
  dueDate?: string | null;
}

export function validateDecisionInput(input: DecisionValidationInput): OfficeHubFieldErrors {
  const errors: OfficeHubFieldErrors = {};
  if (!input.title?.trim()) errors.title = 'State the decision.';
  if (!isIsoDate(input.decisionDate)) errors.decisionDate = 'Enter the date the decision was taken.';
  if (!input.ownerId) errors.ownerId = 'Name the decision owner.';
  if (input.dueDate && !isIsoDate(input.dueDate)) errors.dueDate = 'Enter a valid due date.';
  if (isIsoDate(input.decisionDate) && isIsoDate(input.dueDate) && input.dueDate < input.decisionDate) {
    errors.dueDate = 'The due date cannot precede the decision.';
  }
  return errors;
}

/**
 * The task an action item becomes (§23).
 *
 * Everything the action item already knows is carried over — meeting, decision, responsible person,
 * due date, priority — because §84's rule is that the user must never re-enter what the system
 * already has. The result is a *draft*: the "Create Task" dialog shows it and lets the user change
 * anything before saving, which is the difference between a helpful default and a guess imposed on
 * them.
 */
export function taskDraftFromActionItem(
  item: Pick<
    OfficeHubActionItem,
    | 'id'
    | 'title'
    | 'description'
    | 'responsibleUserId'
    | 'responsibleUserName'
    | 'responsibleTeamId'
    | 'responsibleTeamName'
    | 'departmentId'
    | 'departmentName'
    | 'dueDate'
    | 'priority'
    | 'meetingId'
    | 'meetingTitle'
    | 'meetingDate'
    | 'decisionId'
  >,
  today: IsoDate,
): Partial<OfficeHubTask> & { title: string } {
  return {
    title: item.title,
    description: item.description ?? null,
    assigneeId: item.responsibleUserId ?? null,
    assigneeName: item.responsibleUserName ?? null,
    teamId: item.responsibleTeamId ?? null,
    teamName: item.responsibleTeamName ?? null,
    departmentId: item.departmentId ?? null,
    departmentName: item.departmentName ?? null,
    startDate: today,
    dueDate: item.dueDate ?? null,
    priority: item.priority ?? 'Medium',
    status: 'Not Started',
    progress: 0,
    meetingId: item.meetingId ?? null,
    meetingTitle: item.meetingTitle ?? null,
    actionItemId: item.id,
    decisionId: item.decisionId ?? null,
  };
}

/**
 * Unfinished action items from the previous meetings in a series, ready to show on the next one
 * (§70).
 *
 * Items already carried into this meeting are excluded, so opening the preparation screen twice
 * does not offer the same item twice — and accepting the carry-over twice cannot create two copies.
 * Ordered by how late they are, because the point of the list is to surface what has been sitting.
 */
export function previousActionItemsFor(
  items: readonly OfficeHubActionItem[],
  targetMeetingId: string,
  today: IsoDate,
): OfficeHubActionItem[] {
  return items
    .filter((item) => item.meetingId !== targetMeetingId)
    .filter((item) => item.carriedToMeetingId !== targetMeetingId)
    .filter((item) => isOpenActionItemStatus(item.status))
    .sort((a, b) => {
      const aOverdue = isActionItemOverdue(a, today) ? 1 : 0;
      const bOverdue = isActionItemOverdue(b, today) ? 1 : 0;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      const byDue = (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
      if (byDue !== 0) return byDue;
      return byPriorityDescending(a.priority, b.priority);
    });
}

/* ── follow-up meetings ──────────────────────────────────────────────────────────────────────── */

export interface FollowUpDraft {
  title: string;
  meetingType: string;
  description: string | null;
  priority: OfficeHubPriority;
  mode: OfficeHubMeeting['mode'];
  onlinePlatform: OfficeHubMeeting['onlinePlatform'];
  meetingUrl: string | null;
  location: string | null;
  room: string | null;
  timeZone: string;
  date: IsoDate;
  startTime: ClockTime;
  endTime: ClockTime;
  reminderOffsets: number[];
  selection: ParticipantSelection;
  agendaItems: AgendaTemplateItem[];
  carriedActionItemIds: string[];
  followUpOfMeetingId: string;
  projectId: string | null;
  projectName: string | null;
}

/**
 * A follow-up meeting, pre-filled from the one it follows (§69).
 *
 * Copies the participants, type, agenda and open action items, and offers the same slot a week
 * later — which is what "next week's review" means in practice and is trivially editable if not.
 * Participants come back as a *selection* (teams as teams, departments as departments) rather than a
 * flattened list of people, so that a team which has gained a member since the last meeting invites
 * the member, not last month's roster.
 */
export function buildFollowUpDraft(
  meeting: OfficeHubMeeting,
  agenda: readonly OfficeHubAgendaItem[],
  participants: readonly OfficeHubParticipant[],
  openActionItems: readonly OfficeHubActionItem[],
  options: { weeksAhead?: number } = {},
): FollowUpDraft {
  const optionalUserIds = participants
    .filter((participant) => participant.attendanceRole === 'Optional' && participant.source === 'Individual')
    .map((participant) => participant.userId);

  const selection: ParticipantSelection = {
    userIds: uniqueStrings(
      participants
        .filter((participant) => participant.source === 'Individual' || participant.source === 'Organizer')
        .map((participant) => participant.userId),
    ),
    teamIds: uniqueStrings(
      participants.filter((participant) => participant.source === 'Team').map((participant) => participant.sourceId),
    ),
    departmentIds: uniqueStrings(
      participants
        .filter((participant) => participant.source === 'Department')
        .map((participant) => participant.sourceId),
    ),
    optionalUserIds: uniqueStrings(optionalUserIds),
    optionalTeamIds: [],
    optionalDepartmentIds: [],
  };

  const carried: AgendaTemplateItem[] = openActionItems.length
    ? [
        {
          // First on the agenda by convention, and because a review that does not open with last
          // month's unfinished business tends not to get to it at all.
          order: 0,
          title: 'Previous action items',
          description: openActionItems.map((item) => `• ${item.title}`).join('\n'),
          expectedOutcome: 'Close or re-commit each open item',
          estimatedMinutes: Math.min(30, 5 * openActionItems.length),
          priority: 'High',
        },
      ]
    : [];

  const agendaItems: AgendaTemplateItem[] = [
    ...carried,
    ...sortAgenda(agenda).map((item, index) => ({
      order: index + 1,
      title: item.title,
      description: item.description ?? null,
      expectedOutcome: item.expectedOutcome ?? null,
      estimatedMinutes: item.estimatedMinutes ?? null,
      priority: item.priority,
    })),
  ].map((item, index) => ({ ...item, order: index + 1 }));

  return {
    title: meeting.title.startsWith('Follow-up:') ? meeting.title : `Follow-up: ${meeting.title}`,
    meetingType: meeting.meetingType,
    description: meeting.description ?? null,
    priority: meeting.priority,
    mode: meeting.mode,
    onlinePlatform: meeting.onlinePlatform ?? null,
    meetingUrl: meeting.meetingUrl ?? null,
    location: meeting.location ?? null,
    room: meeting.room ?? null,
    timeZone: meeting.timeZone || OFFICE_HUB_DEFAULT_TIME_ZONE,
    date: addDays(meeting.date, 7 * (options.weeksAhead ?? 1)),
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    reminderOffsets: [...(meeting.reminderOffsets ?? [])],
    selection,
    agendaItems,
    carriedActionItemIds: openActionItems.map((item) => item.id),
    followUpOfMeetingId: meeting.id,
    projectId: meeting.projectId ?? null,
    projectName: meeting.projectName ?? null,
  };
}

/** A meeting draft pre-filled from a template (§43, §84). */
export function meetingDraftFromTemplate(
  template: OfficeHubMeetingTemplate,
  options: { date: IsoDate; startTime?: ClockTime | null; timeZone?: string | null },
): Partial<OfficeHubMeeting> & { selection: ParticipantSelection } {
  const startTime = options.startTime || template.defaultStartTime || '10:00';
  return {
    title: template.name,
    meetingType: template.meetingType,
    description: template.description ?? null,
    priority: template.priority,
    mode: template.mode,
    onlinePlatform: template.onlinePlatform ?? null,
    meetingUrl: template.meetingUrl ?? null,
    location: template.location ?? null,
    room: template.room ?? null,
    date: options.date,
    startTime,
    endTime: endTimeFromDuration(startTime, template.durationMinutes || 60),
    timeZone: options.timeZone || template.defaultTimeZone || OFFICE_HUB_DEFAULT_TIME_ZONE,
    reminderOffsets: [...(template.reminderOffsets ?? [])],
    recurrence: template.recurrence ?? undefined,
    templateId: template.id,
    selection: {
      userIds: [...(template.participantUserIds ?? [])],
      teamIds: [...(template.participantTeamIds ?? [])],
      departmentIds: [...(template.participantDepartmentIds ?? [])],
      optionalUserIds: [...(template.optionalUserIds ?? [])],
      optionalTeamIds: [],
      optionalDepartmentIds: [],
    },
  };
}

/* ── minutes of meeting ──────────────────────────────────────────────────────────────────────── */

export const momStageRank = (stage: MomStage): number => MOM_STAGES.indexOf(stage);

/**
 * The next stage the minutes can move to (§46).
 *
 * When approval is switched off, preparation goes straight to published — an installation that has
 * said it does not want a ladder should not be walked up one, and the intermediate stages would be
 * clicked through without being read.
 */
export function nextMomStage(current: MomStage, approvalRequired: boolean): MomStage | null {
  if (!approvalRequired) {
    if (current === 'Published') return null;
    return current === 'Draft' ? 'Prepared' : 'Published';
  }
  const index = momStageRank(current);
  if (index < 0 || index >= MOM_STAGES.length - 1) return null;
  return MOM_STAGES[index + 1];
}

/**
 * Whether the minutes may be published.
 *
 * Publication is the point at which the minutes become the record of the meeting and go out to
 * participants, so it is the one transition that is gated on the meeting actually having finished.
 * Publishing the minutes of a meeting that has not happened describes a meeting that does not exist.
 */
export function canPublishMom(
  mom: { stage: MomStage; approvalRequired: boolean },
  meeting: Pick<OfficeHubMeeting, 'status'>,
): { allowed: boolean; reason: string | null } {
  if (mom.stage === 'Published') return { allowed: false, reason: 'These minutes are already published.' };
  if (meeting.status !== 'Completed') {
    return { allowed: false, reason: 'Mark the meeting completed before publishing its minutes.' };
  }
  if (mom.approvalRequired && momStageRank(mom.stage) < momStageRank('Approved')) {
    return { allowed: false, reason: 'These minutes still need review and approval.' };
  }
  if (mom.stage === 'Draft') {
    return { allowed: false, reason: 'Prepare the minutes before publishing them.' };
  }
  return { allowed: true, reason: null };
}

export interface MomActionItemRow {
  action: string;
  responsible: string;
  dueDate: string;
  status: string;
}

/** The rendered minutes, in §45's layout. One object the print page and the export both read. */
export interface MomDocument {
  title: string;
  meetingTitle: string;
  meetingType: string;
  date: string;
  time: string;
  location: string;
  organizer: string;
  reference: string;
  stage: MomStage;
  participants: { name: string; department: string; designation: string; attendance: string }[];
  absentees: { name: string; department: string }[];
  agenda: { order: number; title: string; presenter: string; outcome: string }[];
  discussion: string;
  decisions: { reference: string; title: string; owner: string; dueDate: string; status: string }[];
  actionItems: MomActionItemRow[];
  nextMeeting: { date: string; time: string; note: string } | null;
  preparedBy: string | null;
  approvedBy: string | null;
}

/**
 * Assemble the minutes from the meeting's own records (§45).
 *
 * Everything shown is read from what the meeting actually produced — attendance from the attendance
 * sheet, decisions from the decision register, actions from the action items — rather than retyped
 * into a minutes form. That is the whole argument for recording those things during the meeting: the
 * minutes are then a rendering, and cannot disagree with the register.
 */
export function buildMomDocument(input: {
  meeting: OfficeHubMeeting;
  participants: readonly OfficeHubParticipant[];
  agenda: readonly OfficeHubAgendaItem[];
  decisions: readonly OfficeHubDecision[];
  actionItems: readonly OfficeHubActionItem[];
  notesPlainText?: string | null;
  mom?: {
    reference?: string;
    stage?: MomStage;
    discussionHtml?: string | null;
    summary?: string | null;
    nextMeetingDate?: IsoDate | null;
    nextMeetingTime?: ClockTime | null;
    nextMeetingNote?: string | null;
    preparedByName?: string | null;
    approvedByName?: string | null;
  } | null;
}): MomDocument {
  const { meeting, participants, agenda, decisions, actionItems, mom } = input;

  const attended = participants.filter(
    (participant) => participant.attendance === 'Present' || participant.attendance === 'Late',
  );
  const absent = participants.filter((participant) => participant.attendance === 'Absent');

  const locationParts =
    meeting.mode === 'Online'
      ? [meeting.onlinePlatform || 'Online']
      : [meeting.location, meeting.room].filter(Boolean);

  return {
    title: 'MINUTES OF MEETING',
    meetingTitle: meeting.title,
    meetingType: meeting.meetingType,
    date: formatIsoDate(meeting.date, { withWeekday: true }),
    time: `${meeting.startTime} – ${meeting.endTime} (${meeting.timeZone})`,
    location: locationParts.join(' · ') || '—',
    organizer: meeting.organizerName,
    reference: mom?.reference || meeting.id,
    stage: mom?.stage ?? 'Draft',
    participants: attended.map((participant) => ({
      name: participant.name,
      department: participant.departmentName || '—',
      designation: participant.designation || '—',
      attendance: participant.attendance || '—',
    })),
    absentees: absent.map((participant) => ({
      name: participant.name,
      department: participant.departmentName || '—',
    })),
    agenda: sortAgenda(agenda).map((item) => ({
      order: item.order,
      title: item.title,
      presenter: item.presenterName || '—',
      outcome: item.expectedOutcome || '—',
    })),
    discussion:
      mom?.discussionHtml?.trim() ||
      input.notesPlainText?.trim() ||
      // Not left blank: minutes whose discussion section is empty read as if the meeting was not
      // minuted, when in fact nobody typed notes — a different and less alarming fact.
      'No discussion notes were recorded for this meeting.',
    decisions: decisions.map((decision) => ({
      reference: decision.reference,
      title: decision.title,
      owner: decision.ownerName,
      dueDate: decision.dueDate ? formatIsoDate(decision.dueDate) : '—',
      status: decision.status,
    })),
    actionItems: actionItems.map((item) => ({
      action: item.title,
      responsible: item.responsibleUserName || item.responsibleTeamName || '—',
      dueDate: item.dueDate ? formatIsoDate(item.dueDate) : '—',
      status: item.status,
    })),
    nextMeeting: mom?.nextMeetingDate
      ? {
          date: formatIsoDate(mom.nextMeetingDate),
          time: mom.nextMeetingTime || '—',
          note: mom.nextMeetingNote || '',
        }
      : null,
    preparedBy: mom?.preparedByName ?? null,
    approvedBy: mom?.approvedByName ?? null,
  };
}

/* ── the meeting lifecycle screens ───────────────────────────────────────────────────────────── */

export interface MeetingPreparationState {
  agendaReady: boolean;
  participantsInvited: boolean;
  responsesOutstanding: number;
  openActionItems: number;
  documentsAttached: number;
  previousMinutesPublished: boolean | null;
  /** One line per outstanding item, for the checklist on the preparation page (§71). */
  outstanding: string[];
}

export function meetingPreparationState(input: {
  meeting: OfficeHubMeeting;
  agendaCount: number;
  participants: readonly OfficeHubParticipant[];
  openActionItems: number;
  documentsAttached: number;
  previousMomStage?: MomStage | null;
}): MeetingPreparationState {
  const outstanding: string[] = [];
  const responsesOutstanding = nonResponders(input.participants).length;

  if (!input.agendaCount) outstanding.push('No agenda items yet — add what the meeting will cover.');
  if (!input.participants.length) outstanding.push('Nobody has been invited yet.');
  if (responsesOutstanding) {
    outstanding.push(
      `${responsesOutstanding} ${responsesOutstanding === 1 ? 'participant has' : 'participants have'} not responded.`,
    );
  }
  if (input.openActionItems) {
    outstanding.push(`${input.openActionItems} open action ${input.openActionItems === 1 ? 'item' : 'items'} to review.`);
  }
  if (input.previousMomStage && input.previousMomStage !== 'Published') {
    outstanding.push('The previous meeting’s minutes are not published yet.');
  }

  return {
    agendaReady: input.agendaCount > 0,
    participantsInvited: input.participants.length > 0,
    responsesOutstanding,
    openActionItems: input.openActionItems,
    documentsAttached: input.documentsAttached,
    previousMinutesPublished: input.previousMomStage ? input.previousMomStage === 'Published' : null,
    outstanding,
  };
}

/** The "meeting completed" receipt (§68). Counts only; the page renders them as ticks. */
export interface PostMeetingSummary {
  attendanceRecorded: boolean;
  attendanceMarked: number;
  attendanceTotal: number;
  notesSaved: boolean;
  decisions: number;
  actionItems: number;
  tasksGenerated: number;
  actionItemsWithoutTask: number;
  momStage: MomStage | null;
  /** What still needs doing before the meeting can be considered closed out. */
  outstanding: string[];
}

export function postMeetingSummary(input: {
  participants: readonly Pick<OfficeHubParticipant, 'attendance'>[];
  notesPlainText?: string | null;
  decisions: readonly unknown[];
  actionItems: readonly Pick<OfficeHubActionItem, 'taskId'>[];
  momStage?: MomStage | null;
}): PostMeetingSummary {
  const attendance = summarizeAttendance(input.participants);
  const tasksGenerated = input.actionItems.filter((item) => Boolean(item.taskId)).length;
  const actionItemsWithoutTask = input.actionItems.length - tasksGenerated;

  const outstanding: string[] = [];
  if (attendance.unmarked) {
    outstanding.push(`Attendance not marked for ${attendance.unmarked} of ${attendance.invited}.`);
  }
  if (!input.notesPlainText?.trim()) outstanding.push('No discussion notes were saved.');
  if (actionItemsWithoutTask) {
    outstanding.push(
      `${actionItemsWithoutTask} action ${actionItemsWithoutTask === 1 ? 'item has' : 'items have'} no task yet.`,
    );
  }
  if (!input.momStage || input.momStage !== 'Published') outstanding.push('Minutes are not published.');

  return {
    attendanceRecorded: attendance.unmarked === 0 && attendance.invited > 0,
    attendanceMarked: attendance.invited - attendance.unmarked,
    attendanceTotal: attendance.invited,
    notesSaved: Boolean(input.notesPlainText?.trim()),
    decisions: input.decisions.length,
    actionItems: input.actionItems.length,
    tasksGenerated,
    actionItemsWithoutTask,
    momStage: input.momStage ?? null,
    outstanding,
  };
}

/* ── workload and team rollups ───────────────────────────────────────────────────────────────── */

export interface WorkloadRow {
  userId: string;
  name: string;
  departmentName?: string | null;
  activeTasks: number;
  overdueTasks: number;
  completedTasks: number;
  upcomingTasks: number;
  meetings: number;
  actionItems: number;
  /** Highest priority among the person's open tasks, for the sort. */
  topPriority: OfficeHubPriority | null;
}

/**
 * Factual workload per person (§40).
 *
 * Counts only. §40 and §73 both prohibit turning this into a score or a ranking, and the
 * prohibition is load-bearing rather than decorative: the same numbers that help a manager balance
 * work become a performance metric the moment they are combined into one figure, and the people
 * being measured have no say in how the weights were chosen. So there is no composite, no
 * percentage of target, and no ordering by "productivity" — the caller sorts by whichever plain
 * count it is actually asking about.
 */
export function buildWorkload(input: {
  people: readonly Pick<OfficeHubPerson, 'userId' | 'name' | 'departmentName'>[];
  tasks: readonly Pick<OfficeHubTask, 'assigneeId' | 'status' | 'dueDate' | 'priority'>[];
  meetings: readonly Pick<OfficeHubMeeting, 'participantUserIds' | 'status'>[];
  actionItems: readonly Pick<OfficeHubActionItem, 'responsibleUserId' | 'status'>[];
  today: IsoDate;
}): WorkloadRow[] {
  const rows = new Map<string, WorkloadRow>();
  for (const person of input.people) {
    rows.set(person.userId, {
      userId: person.userId,
      name: person.name,
      departmentName: person.departmentName ?? null,
      activeTasks: 0,
      overdueTasks: 0,
      completedTasks: 0,
      upcomingTasks: 0,
      meetings: 0,
      actionItems: 0,
      topPriority: null,
    });
  }

  for (const task of input.tasks) {
    if (!task.assigneeId) continue;
    const row = rows.get(task.assigneeId);
    if (!row) continue;
    if (task.status === 'Completed') {
      row.completedTasks += 1;
      continue;
    }
    if (task.status === 'Cancelled') continue;
    row.activeTasks += 1;
    if (isTaskOverdue(task, input.today)) row.overdueTasks += 1;
    const bucket = taskDueBucket(task, input.today);
    if (bucket === 'due-soon' || bucket === 'due-today') row.upcomingTasks += 1;
    if (!row.topPriority || byPriorityDescending(task.priority, row.topPriority) < 0) {
      row.topPriority = task.priority;
    }
  }

  for (const meeting of input.meetings) {
    if (meeting.status === 'Cancelled') continue;
    for (const userId of meeting.participantUserIds ?? []) {
      const row = rows.get(userId);
      if (row) row.meetings += 1;
    }
  }

  for (const item of input.actionItems) {
    if (!item.responsibleUserId || !isOpenActionItemStatus(item.status)) continue;
    const row = rows.get(item.responsibleUserId);
    if (row) row.actionItems += 1;
  }

  return [...rows.values()];
}

export interface TeamDashboardSummary {
  memberCount: number;
  meetingsThisWeek: number;
  meetingsUpcoming: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksPending: number;
  tasksOverdue: number;
  actionItems: number;
  completionRate: number;
}

export function buildTeamDashboard(input: {
  team: Pick<OfficeHubTeam, 'memberUserIds' | 'memberCount' | 'id'>;
  tasks: readonly Pick<OfficeHubTask, 'teamId' | 'assigneeId' | 'status' | 'dueDate'>[];
  meetings: readonly Pick<OfficeHubMeeting, 'teamIds' | 'participantUserIds' | 'date' | 'status'>[];
  actionItems: readonly Pick<OfficeHubActionItem, 'responsibleTeamId' | 'responsibleUserId' | 'status'>[];
  today: IsoDate;
  weekStart: IsoDate;
  weekEnd: IsoDate;
}): TeamDashboardSummary {
  const members = new Set(input.team.memberUserIds ?? []);
  const teamTasks = input.tasks.filter(
    (task) => task.teamId === input.team.id || (task.assigneeId ? members.has(task.assigneeId) : false),
  );
  const completed = teamTasks.filter((task) => task.status === 'Completed').length;
  const cancelled = teamTasks.filter((task) => task.status === 'Cancelled').length;
  const overdue = teamTasks.filter((task) => isTaskOverdue(task, input.today)).length;
  const pending = teamTasks.length - completed - cancelled;

  const teamMeetings = input.meetings.filter(
    (meeting) =>
      meeting.status !== 'Cancelled' &&
      ((meeting.teamIds ?? []).includes(input.team.id) ||
        (meeting.participantUserIds ?? []).some((userId) => members.has(userId))),
  );

  return {
    memberCount: input.team.memberCount ?? members.size,
    meetingsThisWeek: teamMeetings.filter(
      (meeting) => meeting.date >= input.weekStart && meeting.date <= input.weekEnd,
    ).length,
    meetingsUpcoming: teamMeetings.filter((meeting) => meeting.date >= input.today).length,
    tasksTotal: teamTasks.length,
    tasksCompleted: completed,
    tasksPending: pending,
    tasksOverdue: overdue,
    actionItems: input.actionItems.filter(
      (item) =>
        isOpenActionItemStatus(item.status) &&
        (item.responsibleTeamId === input.team.id ||
          (item.responsibleUserId ? members.has(item.responsibleUserId) : false)),
    ).length,
    completionRate: teamTasks.length ? Math.round((completed / teamTasks.length) * 100) : 0,
  };
}

/* ── teams ───────────────────────────────────────────────────────────────────────────────────── */

export interface TeamValidationInput {
  name?: string | null;
  leaderId?: string | null;
  memberUserIds?: string[];
}

export function validateTeamInput(input: TeamValidationInput): OfficeHubFieldErrors {
  const errors: OfficeHubFieldErrors = {};
  if (!input.name?.trim()) errors.name = 'Team name is required.';
  if (!input.leaderId) errors.leaderId = 'Choose a team leader.';
  if (!input.memberUserIds?.length) errors.members = 'Add at least one member.';
  else if (input.leaderId && !input.memberUserIds.includes(input.leaderId)) {
    // Not an error the user has to fix by hand — the service adds the leader — but worth saying,
    // because a leader who is not a member would be missing from every team task assignment list.
    errors.members = 'The team leader must also be a member.';
  }
  return errors;
}

/**
 * Members with the leader present and flagged exactly once.
 *
 * Called on every team write so that `isLeader` cannot drift from `leaderId` — two fields that
 * disagree about who leads a team is the kind of state that produces a team page with two leaders
 * and a task assignment dialog with none.
 */
export function normalizeTeamMembers(
  members: readonly OfficeHubTeam['members'][number][],
  leaderId: string,
  leaderFallback?: { name: string; departmentId?: string | null; departmentName?: string | null },
): OfficeHubTeam['members'] {
  const byUserId = new Map<string, OfficeHubTeam['members'][number]>();
  for (const member of members) {
    if (!member?.userId) continue;
    const existing = byUserId.get(member.userId);
    byUserId.set(member.userId, { ...existing, ...member, isLeader: false });
  }

  const leader = byUserId.get(leaderId);
  if (leader) {
    leader.isLeader = true;
  } else if (leaderFallback?.name) {
    byUserId.set(leaderId, {
      userId: leaderId,
      name: leaderFallback.name,
      departmentId: leaderFallback.departmentId ?? null,
      departmentName: leaderFallback.departmentName ?? null,
      isLeader: true,
    });
  }

  // Leader first, then everybody else alphabetically — the order every team screen renders.
  return [...byUserId.values()].sort((a, b) => {
    if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/* ── uploads ─────────────────────────────────────────────────────────────────────────────────── */

export function fileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

/**
 * Whether a file may be attached (§36, §57).
 *
 * The same check runs in the browser for the message and in the Storage rules for the enforcement —
 * §49's point that a front-end check is a courtesy, not a control.
 */
export function validateOfficeHubUpload(
  file: { name: string; size: number },
  settings?: Partial<OfficeHubSettings> | null,
): { ok: boolean; reason: string | null } {
  const resolved = settingsOrDefaults(settings);
  const extension = fileExtension(file.name);

  if (!extension) return { ok: false, reason: 'The file needs an extension so we know its type.' };
  if (!resolved.allowedUploadExtensions.includes(extension)) {
    return {
      ok: false,
      reason: `.${extension} files are not allowed. Permitted: ${resolved.allowedUploadExtensions.join(', ')}.`,
    };
  }
  if (!file.size) return { ok: false, reason: 'This file is empty.' };
  const maxBytes = resolved.maxUploadMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return { ok: false, reason: `Files must be under ${resolved.maxUploadMb} MB.` };
  }
  return { ok: true, reason: null };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Storage path for an attachment. Segregated by entity so the Storage rules can reason per entity. */
export function officeHubStoragePath(
  entityType: OfficeHubEntityType,
  entityId: string,
  fileName: string,
): string {
  const safeName = fileName.replace(/[^\w.\-() ]+/g, '_').slice(-120);
  return `office-hub/${entityType}/${entityId}/${Date.now()}_${safeName}`;
}

/* ── mentions ────────────────────────────────────────────────────────────────────────────────── */

/**
 * The `users` ids mentioned in a piece of text (§30, §20).
 *
 * Mentions are stored as `@[Name](userId)` — the name so the text reads correctly forever even if
 * the person is renamed, the id so the notification reaches the right account. Parsing the display
 * name instead would break the moment two people share a first name.
 */
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  const pattern = /@\[[^\]]+\]\(([^)]+)\)/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) ids.push(match[1]);
  return uniqueStrings(ids);
}

/** Mention markup replaced with plain "@Name", for notification bodies and exports. */
export function stripMentionMarkup(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '@$1');
}

/** Tags stripped from stored HTML, for the plain-text mirror search reads. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ── response and status labels ──────────────────────────────────────────────────────────────── */

export function responseLabel(response: InvitationResponse): string {
  return response === 'No Response' ? 'Awaiting response' : response;
}

/** "8 accepted · 2 maybe · 1 declined · 3 awaiting" (§13). */
export function describeResponses(summary: MeetingResponseSummary): string {
  const parts: string[] = [];
  if (summary.accepted) parts.push(`${summary.accepted} accepted`);
  if (summary.maybe) parts.push(`${summary.maybe} maybe`);
  if (summary.declined) parts.push(`${summary.declined} declined`);
  if (summary.noResponse) parts.push(`${summary.noResponse} awaiting`);
  return parts.join(' · ') || 'No participants yet';
}

/** "Finance Review · Mon, 21 Sep 2026, 10:00 AM" — one line naming a meeting in a notification. */
export function describeMeeting(
  meeting: Pick<OfficeHubMeeting, 'title' | 'date' | 'startTime'>,
): string {
  return `${meeting.title} · ${formatIsoDate(meeting.date, { withWeekday: true })}, ${meeting.startTime}`;
}
