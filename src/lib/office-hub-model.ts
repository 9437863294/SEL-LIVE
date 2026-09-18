/**
 * The Office Hub data model — meetings, agendas, attendance, minutes, decisions, action items,
 * tasks and teams (`docs/office-hub.md`).
 *
 * Dependency-free, like `office-hub-time.ts`: the rules in `office-hub-rules.ts` and the recurrence
 * engine both run under `node --test` with no Firebase installed, and the cron route runs them
 * against Admin-SDK documents. So every date the engine reads or writes is a plain string — either
 * a `yyyy-MM-dd` calendar date or a full ISO instant — and the only Firestore-shaped values here are
 * the six shared audit stamps, typed loosely as `OfficeHubTimestampLike` so this module still does
 * not import the SDK. `src/lib/office-hub.ts` is the Firestore-facing entry point that layers the
 * collection names on top and re-exports all of this.
 *
 * ── Five structural decisions worth knowing before reading the interfaces ─────────────────────────
 *
 *  1. **Participants are their own collection, not an array on the meeting.** "My meetings" and
 *     "meetings I have not responded to" have to be indexed queries across every meeting, and an
 *     array of objects cannot be indexed that way. The meeting carries a denormalised
 *     `participantUserIds` array (queryable with `array-contains`) and a `responseSummary` counter
 *     so the register and the calendar are single reads; the participant documents stay the source
 *     of truth for response, attendance and who invited whom.
 *
 *  2. **Subtasks and dependencies are embedded on the task; comments and activity are not.** A
 *     checklist is read whenever the task is read and is bounded by what a person will tolerate
 *     ticking, so it is a field. Comments and the activity trail grow without limit and are paged,
 *     so they are collections. §50's instruction not to "blindly create excessive collections" is
 *     the same trade-off read from the other side.
 *
 *  3. **A recurring series is one template document plus materialised instances.** `seriesId` points
 *     every instance at its parent; `occurrenceKey` is the instance's date within the series and is
 *     what makes generation idempotent — §86's "do not create duplicate recurring meetings" is
 *     enforced by that key, not by remembering to check first.
 *
 *  4. **Meeting master data is referenced, never copied.** Employees live in `employees` (synced
 *     from greytHR), logins in `users`, departments in `departments`, projects in `projects`. Office
 *     Hub stores their ids, plus a denormalised display name so a register renders without N reads.
 *     It never becomes a second employee master (§89).
 *
 *  5. **Nothing is hard-deleted.** Meetings, tasks, teams, decisions and action items all carry
 *     `isDeleted`/`archivedAt` and every list query filters on it (§83).
 */

import type { ClockTime, IsoDate } from './office-hub-time.ts';
import { OFFICE_HUB_DEFAULT_TIME_ZONE } from './office-hub-time.ts';

/**
 * A Firestore `Timestamp`, an Admin-SDK timestamp, or a plain date/millis value.
 *
 * Deliberately the same union as `AuditStamps` in `@/lib/audit-fields`, minus nothing and plus
 * nothing, so every Office Hub record is structurally assignable to it and `formatCreatedBy` /
 * `formatUpdatedBy` work on all of them without a cast.
 */
export type OfficeHubTimestampLike =
  | { toMillis: () => number }
  | { seconds: number }
  | Date
  | number
  | null
  | undefined;

/** The six shared stamps written by `withCreateAudit` / `withUpdateAudit`, plus the soft-delete set. */
export interface OfficeHubAuditFields {
  createdAt?: OfficeHubTimestampLike;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedAt?: OfficeHubTimestampLike;
  updatedBy?: string | null;
  updatedByName?: string | null;
  isDeleted?: boolean;
  deletedAt?: OfficeHubTimestampLike;
  deletedBy?: string | null;
  deletedByName?: string | null;
}

/* ── shared vocabulary ────────────────────────────────────────────────────────────────────────── */

export type OfficeHubPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export const OFFICE_HUB_PRIORITIES: readonly OfficeHubPriority[] = [
  'Low',
  'Medium',
  'High',
  'Critical',
] as const;

/** Sort weight, highest first — used by every "what needs attention" list. */
export const OFFICE_HUB_PRIORITY_WEIGHT: Record<OfficeHubPriority, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

/** A person as Office Hub refers to them: the `users` id, with a name for display. */
export interface OfficeHubPerson {
  userId: string;
  name: string;
  email?: string | null;
  /** `employees.id`, when this login is linked to an HR record. */
  employeeId?: string | null;
  designation?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  photoURL?: string | null;
}

/* ── meetings ─────────────────────────────────────────────────────────────────────────────────── */

export type MeetingMode = 'Online' | 'Offline' | 'Hybrid';

export const MEETING_MODES: readonly MeetingMode[] = ['Online', 'Offline', 'Hybrid'] as const;

export type MeetingStatus =
  | 'Draft'
  | 'Scheduled'
  | 'In Progress'
  | 'Completed'
  | 'Cancelled'
  | 'Postponed';

export const MEETING_STATUSES: readonly MeetingStatus[] = [
  'Draft',
  'Scheduled',
  'In Progress',
  'Completed',
  'Cancelled',
  'Postponed',
] as const;

/**
 * Statuses that take the meeting out of the working calendar.
 *
 * A terminal meeting is never auto-advanced by `deriveMeetingStatus`, never reminded about, and
 * never counted as upcoming — the clock must not reopen a meeting somebody cancelled.
 */
export const TERMINAL_MEETING_STATUSES: readonly MeetingStatus[] = [
  'Completed',
  'Cancelled',
  'Postponed',
] as const;

export type OnlineMeetingPlatform =
  | 'Microsoft Teams'
  | 'Google Meet'
  | 'Zoom'
  | 'Webex'
  | 'Other';

export const ONLINE_MEETING_PLATFORMS: readonly OnlineMeetingPlatform[] = [
  'Microsoft Teams',
  'Google Meet',
  'Zoom',
  'Webex',
  'Other',
] as const;

/**
 * The meeting types an installation starts with (§9).
 *
 * Seed values, not a closed set: `officeHubSettings.meetingTypes` overrides them and the form reads
 * the setting, so an administrator can add "Safety Review" without a deployment. They are listed
 * here so a fresh installation has a usable dropdown before anybody opens Settings.
 */
export const DEFAULT_MEETING_TYPES: readonly string[] = [
  'Management',
  'Department',
  'Project',
  'Client',
  'Vendor',
  'Review',
  'Site',
  'Finance',
  'HR',
  'Purchase',
  'IT',
  'Emergency',
  'Other',
] as const;

/** How a participant came to be invited — kept so removing a team does not strand its members. */
export type ParticipantSource = 'Organizer' | 'Individual' | 'Department' | 'Team';

export type ParticipantAttendanceRole = 'Required' | 'Optional';

export type InvitationResponse = 'Accepted' | 'Maybe' | 'Declined' | 'No Response';

export const INVITATION_RESPONSES: readonly InvitationResponse[] = [
  'Accepted',
  'Maybe',
  'Declined',
  'No Response',
] as const;

export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Excused';

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = [
  'Present',
  'Absent',
  'Late',
  'Excused',
] as const;

/** Minutes before the start at which a reminder fires (§12). 0 means "at meeting time". */
export type ReminderOffsetMinutes = number;

export const DEFAULT_REMINDER_CHOICES: readonly { minutes: number; label: string }[] = [
  { minutes: 1440, label: '1 day before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 10, label: '10 minutes before' },
  { minutes: 0, label: 'At meeting time' },
] as const;

export type RecurrenceFrequency = 'None' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly' | 'Custom';

export const RECURRENCE_FREQUENCIES: readonly RecurrenceFrequency[] = [
  'None',
  'Daily',
  'Weekly',
  'Monthly',
  'Yearly',
  'Custom',
] as const;

/** Monthly recurrence either pins a date ("the 7th") or a weekday ordinal ("the last Friday"). */
export type MonthlyRecurrenceMode = 'day-of-month' | 'weekday-of-month';

export type RecurrenceEndMode = 'never' | 'after-occurrences' | 'on-date';

export interface MeetingRecurrence {
  frequency: RecurrenceFrequency;
  /** Every N days/weeks/months/years. 1 unless the user chose Custom. */
  interval: number;
  /** Weekly: 0 = Sunday … 6 = Saturday. Empty means "the weekday the series starts on". */
  weekdays?: number[];
  monthlyMode?: MonthlyRecurrenceMode;
  /** `day-of-month`: 1–31, clamped to the month's length. */
  dayOfMonth?: number;
  /** `weekday-of-month`: 1 = first … 4 = fourth, -1 = last. */
  weekdayOrdinal?: number;
  /** `weekday-of-month`: 0 = Sunday … 6 = Saturday. */
  weekday?: number;
  endMode: RecurrenceEndMode;
  /** `after-occurrences`: how many instances the series contains in total, including the first. */
  occurrences?: number;
  /** `on-date`: the last date an instance may fall on, inclusive. */
  endDate?: IsoDate;
  /** Instances the organizer cancelled individually, by `occurrenceKey`. */
  exceptions?: IsoDate[];
}

export const NO_RECURRENCE: MeetingRecurrence = {
  frequency: 'None',
  interval: 1,
  endMode: 'never',
};

/**
 * A meeting.
 *
 * `date`/`startTime`/`endTime`/`timeZone` are the source of truth; `startAt`/`endAt` are ISO
 * instants derived from them by `meetingInstants` and exist so Firestore can sort and range-query.
 * Never write the instants by hand — see the header of `office-hub-time.ts` for why.
 */
export interface OfficeHubMeeting extends OfficeHubAuditFields {
  id: string;
  title: string;
  /** One of `officeHubSettings.meetingTypes`; free text so a retired type still renders. */
  meetingType: string;
  description?: string | null;
  priority: OfficeHubPriority;
  status: MeetingStatus;

  date: IsoDate;
  startTime: ClockTime;
  endTime: ClockTime;
  timeZone: string;
  /** Derived instants. Written on every save by the service, read by every query. */
  startAt: string;
  endAt: string;

  mode: MeetingMode;
  onlinePlatform?: OnlineMeetingPlatform | null;
  meetingUrl?: string | null;
  meetingPasscode?: string | null;
  location?: string | null;
  room?: string | null;
  address?: string | null;

  organizerId: string;
  organizerName: string;
  /** Who actually created the record, when an authorised user scheduled on someone else's behalf. */
  scheduledById?: string | null;
  scheduledByName?: string | null;

  /**
   * Denormalised participant index. `array-contains` on this is how "my meetings" is one query;
   * the `officeHubParticipants` documents remain authoritative for response and attendance.
   */
  participantUserIds: string[];
  requiredUserIds: string[];
  departmentIds: string[];
  teamIds: string[];
  /** Kept in step by the service on every participant change, so the register needs no sub-reads. */
  responseSummary: MeetingResponseSummary;
  participantCount: number;

  /** Optional link to a project (§42). */
  projectId?: string | null;
  projectName?: string | null;

  reminderOffsets: ReminderOffsetMinutes[];

  recurrence: MeetingRecurrence;
  /** Set on every member of a series, including the parent, to the parent's id. */
  seriesId?: string | null;
  /** True for the record that carries the recurrence rule and generates the instances. */
  isSeriesParent?: boolean;
  /** The instance's own date within its series; makes generation idempotent. */
  occurrenceKey?: IsoDate | null;
  /** The instance's ordinal in the series, 1-based. */
  occurrenceNumber?: number | null;

  /** Set when the meeting was created by "Schedule follow-up" from another (§69). */
  followUpOfMeetingId?: string | null;
  followUpOfMeetingTitle?: string | null;
  /** Set when created from a template (§43). */
  templateId?: string | null;

  /** Filled in when the meeting actually started and ended, for the live-mode timer and reports. */
  startedAt?: string | null;
  endedAt?: string | null;
  cancellationReason?: string | null;
  postponedToDate?: IsoDate | null;

  /** Denormalised MOM state so the register can show "minutes pending" without a second read. */
  momStage?: MomStage | null;
  momRequired?: boolean;

  /** Free-text tags, shared with tasks so a subject can be followed across both. */
  tags?: string[];

  archivedAt?: OfficeHubTimestampLike;
  organizationId?: string | null;
}

export interface MeetingResponseSummary {
  accepted: number;
  maybe: number;
  declined: number;
  noResponse: number;
}

export const EMPTY_RESPONSE_SUMMARY: MeetingResponseSummary = {
  accepted: 0,
  maybe: 0,
  declined: 0,
  noResponse: 0,
};

export interface OfficeHubParticipant extends OfficeHubAuditFields {
  id: string;
  meetingId: string;
  seriesId?: string | null;
  userId: string;
  name: string;
  email?: string | null;
  employeeId?: string | null;
  designation?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  attendanceRole: ParticipantAttendanceRole;
  /** How they were invited, and via which team/department — so "remove team" is reversible. */
  source: ParticipantSource;
  sourceId?: string | null;
  sourceName?: string | null;

  response: InvitationResponse;
  responseMessage?: string | null;
  respondedAt?: string | null;

  attendance?: AttendanceStatus | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  attendanceNote?: string | null;
  attendanceMarkedById?: string | null;
  attendanceMarkedByName?: string | null;

  /** Bumped each time the organizer chases a non-responder (§13). */
  remindersSent?: number;
  lastRemindedAt?: string | null;
}

export interface OfficeHubAgendaItem extends OfficeHubAuditFields {
  id: string;
  meetingId: string;
  seriesId?: string | null;
  order: number;
  title: string;
  description?: string | null;
  presenterId?: string | null;
  presenterName?: string | null;
  expectedOutcome?: string | null;
  priority: OfficeHubPriority;
  estimatedMinutes?: number | null;
  /** `officeHubDocuments` ids supporting this item. */
  documentIds?: string[];
  /** Ticked in live mode as the meeting works through the agenda. */
  covered?: boolean;
  coveredAt?: string | null;
  discussionNote?: string | null;
  /** Set when the item was carried over from a previous meeting's unfinished business (§70). */
  carriedFromMeetingId?: string | null;
}

/**
 * The meeting's notes (§20). One document per meeting, not one per edit.
 *
 * Auto-save writes here every few seconds while the meeting runs, so the record is deliberately
 * small and flat: HTML plus a plain-text mirror for search. The mirror exists because Firestore
 * cannot search inside markup, and stripping tags at query time would mean downloading every note.
 */
export interface OfficeHubMeetingNotes extends OfficeHubAuditFields {
  /** The meeting id — notes are stored under their meeting's own id, so there is exactly one. */
  id: string;
  meetingId: string;
  html: string;
  /** Tags stripped, for `officeHubSearch` and the MOM export. */
  plainText: string;
  /** `users` ids mentioned with @, so the notification service can reach them. */
  mentionedUserIds?: string[];
  lastSavedAt?: OfficeHubTimestampLike;
  lastSavedByName?: string | null;
}

/* ── decisions and action items ───────────────────────────────────────────────────────────────── */

export type DecisionStatus = 'Open' | 'In Progress' | 'Completed' | 'Cancelled';

export const DECISION_STATUSES: readonly DecisionStatus[] = [
  'Open',
  'In Progress',
  'Completed',
  'Cancelled',
] as const;

export interface OfficeHubDecision extends OfficeHubAuditFields {
  id: string;
  /** Human reference, e.g. `DEC-2627-0041`. Allocated by the service from a counter. */
  reference: string;
  title: string;
  description?: string | null;
  decisionDate: IsoDate;

  meetingId?: string | null;
  meetingTitle?: string | null;
  agendaItemId?: string | null;

  ownerId: string;
  ownerName: string;
  departmentId?: string | null;
  departmentName?: string | null;
  projectId?: string | null;
  projectName?: string | null;

  priority: OfficeHubPriority;
  dueDate?: IsoDate | null;
  status: DecisionStatus;
  closedAt?: string | null;
  closureNote?: string | null;

  documentIds?: string[];
  tags?: string[];
  organizationId?: string | null;
}

export type ActionItemStatus = DecisionStatus;

export const ACTION_ITEM_STATUSES = DECISION_STATUSES;

export interface OfficeHubActionItem extends OfficeHubAuditFields {
  id: string;
  reference: string;
  title: string;
  description?: string | null;

  meetingId?: string | null;
  meetingTitle?: string | null;
  meetingDate?: IsoDate | null;
  seriesId?: string | null;
  agendaItemId?: string | null;
  decisionId?: string | null;

  responsibleUserId?: string | null;
  responsibleUserName?: string | null;
  responsibleTeamId?: string | null;
  responsibleTeamName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;

  dueDate?: IsoDate | null;
  priority: OfficeHubPriority;
  status: ActionItemStatus;
  completedAt?: string | null;

  /** Set once "Create Task" has been used, so the button becomes "View Task" (§23). */
  taskId?: string | null;
  /** Set when this item was carried forward from an earlier meeting in the series (§70). */
  carriedFromActionItemId?: string | null;
  carriedToMeetingId?: string | null;
  organizationId?: string | null;
}

/* ── tasks ────────────────────────────────────────────────────────────────────────────────────── */

export type TaskStatus = 'Not Started' | 'In Progress' | 'On Hold' | 'Completed' | 'Cancelled';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'Not Started',
  'In Progress',
  'On Hold',
  'Completed',
  'Cancelled',
] as const;

/** The Kanban board's columns (§25) — Cancelled is deliberately not one of them. */
export const TASK_KANBAN_COLUMNS: readonly TaskStatus[] = [
  'Not Started',
  'In Progress',
  'On Hold',
  'Completed',
] as const;

export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = ['Completed', 'Cancelled'] as const;

export type TaskDependencyType = 'blocks' | 'blocked-by' | 'depends-on';

export interface TaskDependency {
  type: TaskDependencyType;
  taskId: string;
  taskTitle: string;
  taskReference?: string | null;
}

export interface TaskSubtask {
  id: string;
  title: string;
  done: boolean;
  assigneeId?: string | null;
  assigneeName?: string | null;
  dueDate?: IsoDate | null;
  completedAt?: string | null;
  order: number;
}

export interface OfficeHubTask extends OfficeHubAuditFields {
  id: string;
  reference: string;
  title: string;
  description?: string | null;

  assigneeId?: string | null;
  assigneeName?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;

  startDate?: IsoDate | null;
  dueDate?: IsoDate | null;
  priority: OfficeHubPriority;
  status: TaskStatus;
  /** 0–100. Derived from subtasks when there are any, otherwise set by hand (§28). */
  progress: number;

  tags?: string[];
  meetingId?: string | null;
  meetingTitle?: string | null;
  actionItemId?: string | null;
  decisionId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  parentTaskId?: string | null;
  parentTaskTitle?: string | null;

  subtasks?: TaskSubtask[];
  dependencies?: TaskDependency[];
  documentIds?: string[];

  /**
   * Everyone who should hear about this task: assignee, creator, team leader, commenters. Held on
   * the task so the notification service does not have to reconstruct the audience per event, and
   * so "tasks I am involved in" is one `array-contains` query.
   */
  watcherUserIds?: string[];

  commentCount?: number;
  completedAt?: string | null;
  completedById?: string | null;
  completedByName?: string | null;
  reopenedAt?: string | null;
  /** Last time an overdue notice went out, so the sweep does not send one every hour. */
  lastOverdueNoticeAt?: string | null;
  organizationId?: string | null;
}

export type TaskCommentKind = 'comment' | 'system';

export interface OfficeHubTaskComment extends OfficeHubAuditFields {
  id: string;
  taskId: string;
  kind: TaskCommentKind;
  body: string;
  /** Set for a reply, pointing at the comment it answers (§30). */
  parentCommentId?: string | null;
  mentionedUserIds?: string[];
  documentIds?: string[];
  editedAt?: OfficeHubTimestampLike;
}

export type TaskActivityKind =
  | 'created'
  | 'assigned'
  | 'reassigned'
  | 'priority-changed'
  | 'due-date-changed'
  | 'status-changed'
  | 'progress-changed'
  | 'comment-added'
  | 'attachment-added'
  | 'subtask-changed'
  | 'dependency-changed'
  | 'completed'
  | 'reopened'
  | 'archived';

export interface OfficeHubTaskActivity extends OfficeHubAuditFields {
  id: string;
  taskId: string;
  kind: TaskActivityKind;
  /** One line, already written for a human: "Priority changed from Medium to High". */
  summary: string;
  field?: string | null;
  from?: string | null;
  to?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  at: string;
}

/* ── teams ────────────────────────────────────────────────────────────────────────────────────── */

export type TeamStatus = 'Active' | 'Archived';

export interface OfficeHubTeamMember {
  userId: string;
  name: string;
  employeeId?: string | null;
  designation?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  /** The leader is also listed here, with `isLeader` set, so member counts need no special case. */
  isLeader?: boolean;
  addedAt?: string | null;
  addedByName?: string | null;
}

export interface OfficeHubTeam extends OfficeHubAuditFields {
  id: string;
  name: string;
  description?: string | null;
  leaderId: string;
  leaderName: string;
  /** Embedded: a team is small, and every screen that shows a team shows its members. */
  members: OfficeHubTeamMember[];
  memberUserIds: string[];
  memberCount: number;
  /** The team's home department, when it has one. Members may come from anywhere (§6). */
  departmentId?: string | null;
  departmentName?: string | null;
  status: TeamStatus;
  archivedAt?: OfficeHubTimestampLike;
  archivedReason?: string | null;
  organizationId?: string | null;
}

/* ── documents ────────────────────────────────────────────────────────────────────────────────── */

export type OfficeHubEntityType =
  | 'meeting'
  | 'task'
  | 'decision'
  | 'action-item'
  | 'agenda-item'
  | 'mom'
  | 'team';

export interface OfficeHubDocument extends OfficeHubAuditFields {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  /** Firebase Storage object path. Never a public URL — reads go through the authenticated SDK. */
  storagePath: string;
  entityType: OfficeHubEntityType;
  entityId: string;
  /** Kept so a meeting's document list includes files attached to its tasks and decisions. */
  meetingId?: string | null;
  uploadedById: string;
  uploadedByName: string;
  uploadedAt: string;
  note?: string | null;
  organizationId?: string | null;
}

/** File types §36 allows. Enforced by `validateOfficeHubUpload` and by the Storage rules. */
export const OFFICE_HUB_ALLOWED_UPLOAD_EXTENSIONS: readonly string[] = [
  'pdf',
  'doc', 'docx',
  'xls', 'xlsx', 'csv',
  'ppt', 'pptx',
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'txt', 'rtf',
  'msg', 'eml',
  'zip',
] as const;

export const OFFICE_HUB_DEFAULT_MAX_UPLOAD_MB = 25;

/* ── minutes of meeting ───────────────────────────────────────────────────────────────────────── */

export type MomStage = 'Draft' | 'Prepared' | 'Reviewed' | 'Approved' | 'Published';

/** The approval ladder in order (§46). Index in this array *is* the stage's rank. */
export const MOM_STAGES: readonly MomStage[] = [
  'Draft',
  'Prepared',
  'Reviewed',
  'Approved',
  'Published',
] as const;

export interface MomStageEvent {
  stage: MomStage;
  at: string;
  byId: string;
  byName: string;
  note?: string | null;
}

export interface OfficeHubMom extends OfficeHubAuditFields {
  /** The meeting id: one minutes record per meeting. */
  id: string;
  meetingId: string;
  reference: string;
  stage: MomStage;
  /** Whether this installation requires the ladder at all (§46), snapshotted at preparation time. */
  approvalRequired: boolean;

  /** Rendered sections, so the printed minutes never change under a reader's feet. */
  summary?: string | null;
  discussionHtml?: string | null;
  nextMeetingDate?: IsoDate | null;
  nextMeetingTime?: ClockTime | null;
  nextMeetingNote?: string | null;

  preparedById?: string | null;
  preparedByName?: string | null;
  preparedAt?: string | null;
  reviewedById?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  approvedById?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  publishedAt?: string | null;
  /** Append-only: who moved the minutes to each stage, and any note they left. */
  history?: MomStageEvent[];
  /** Participants the published minutes were circulated to. */
  circulatedToUserIds?: string[];
  circulatedAt?: string | null;
  organizationId?: string | null;
}

/* ── reminders ────────────────────────────────────────────────────────────────────────────────── */

export type ReminderStatus = 'Scheduled' | 'Sent' | 'Failed' | 'Cancelled';

export type ReminderKind =
  | 'meeting-reminder'
  | 'meeting-starting'
  | 'task-due-soon'
  | 'task-due-today'
  | 'task-overdue'
  | 'decision-due'
  | 'action-item-due'
  | 'mom-pending';

/**
 * A scheduled reminder (§61).
 *
 * Rows are written when the meeting or task is saved and consumed by the cron route, so a reminder
 * does not depend on anybody's browser being open (§62, §86). `scheduledAt` is an ISO instant
 * precisely because the sweep is a range query on it.
 */
export interface OfficeHubReminder extends OfficeHubAuditFields {
  id: string;
  entityType: OfficeHubEntityType;
  entityId: string;
  entityTitle: string;
  userId: string;
  kind: ReminderKind;
  /** Minutes before the event this row represents; 0 for "at the time", null for task sweeps. */
  offsetMinutes?: number | null;
  scheduledAt: string;
  status: ReminderStatus;
  sentAt?: string | null;
  failureReason?: string | null;
  attempts?: number;
  /** Deep link for the notification the reminder produces. */
  link?: string | null;
  /** Series id, so cancelling a series cancels every instance's reminders in one query. */
  seriesId?: string | null;
  organizationId?: string | null;
}

/* ── templates ────────────────────────────────────────────────────────────────────────────────── */

export interface AgendaTemplateItem {
  title: string;
  description?: string | null;
  expectedOutcome?: string | null;
  estimatedMinutes?: number | null;
  priority?: OfficeHubPriority;
  order: number;
}

export interface OfficeHubAgendaTemplate extends OfficeHubAuditFields {
  id: string;
  name: string;
  description?: string | null;
  meetingType?: string | null;
  items: AgendaTemplateItem[];
  status: 'Active' | 'Archived';
  organizationId?: string | null;
}

export interface OfficeHubMeetingTemplate extends OfficeHubAuditFields {
  id: string;
  name: string;
  description?: string | null;
  meetingType: string;
  durationMinutes: number;
  mode: MeetingMode;
  onlinePlatform?: OnlineMeetingPlatform | null;
  meetingUrl?: string | null;
  location?: string | null;
  room?: string | null;
  priority: OfficeHubPriority;
  reminderOffsets: ReminderOffsetMinutes[];
  /** Default invitees, held as selectors rather than a flattened list so a team stays a team. */
  participantUserIds: string[];
  participantTeamIds: string[];
  participantDepartmentIds: string[];
  optionalUserIds?: string[];
  agendaTemplateId?: string | null;
  /** Inline agenda, for a template that does not reuse a named agenda template. */
  agendaItems?: AgendaTemplateItem[];
  defaultTimeZone?: string | null;
  defaultStartTime?: ClockTime | null;
  recurrence?: MeetingRecurrence | null;
  status: 'Active' | 'Archived';
  usageCount?: number;
  organizationId?: string | null;
}

/* ── settings ─────────────────────────────────────────────────────────────────────────────────── */

export interface OfficeHubSettings {
  organizationName: string;
  logoStoragePath?: string | null;
  defaultTimeZone: string;
  /** 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  workingHoursStart: ClockTime;
  workingHoursEnd: ClockTime;
  defaultMeetingDurationMinutes: number;
  defaultReminderOffsets: ReminderOffsetMinutes[];
  meetingTypes: string[];
  taskPriorities: OfficeHubPriority[];
  maxUploadMb: number;
  allowedUploadExtensions: string[];
  /** §46: whether minutes must climb the ladder before they can be published. */
  momApprovalRequired: boolean;
  /** Who may be picked as a MOM reviewer/approver, when the ladder is on. Empty = any authorised. */
  momApproverUserIds?: string[];
  emailNotificationsEnabled: boolean;
  browserNotificationsEnabled: boolean;
  /** Only ever a *default* — a user's own setting wins where they have expressed one. */
  taskDueReminderDaysBefore: number[];
  /** Holidays shown on the calendar (§8). Office-wide, not per user. */
  holidays?: { date: IsoDate; name: string }[];
  updatedAt?: OfficeHubTimestampLike;
  updatedByName?: string | null;
}

export const DEFAULT_OFFICE_HUB_SETTINGS: OfficeHubSettings = {
  organizationName: 'Office Hub',
  defaultTimeZone: OFFICE_HUB_DEFAULT_TIME_ZONE,
  // Monday to Saturday — the office's actual week, and what the calendar shades as working days.
  workingDays: [1, 2, 3, 4, 5, 6],
  workingHoursStart: '09:30',
  workingHoursEnd: '18:30',
  defaultMeetingDurationMinutes: 60,
  defaultReminderOffsets: [15],
  meetingTypes: [...DEFAULT_MEETING_TYPES],
  taskPriorities: [...OFFICE_HUB_PRIORITIES],
  maxUploadMb: OFFICE_HUB_DEFAULT_MAX_UPLOAD_MB,
  allowedUploadExtensions: [...OFFICE_HUB_ALLOWED_UPLOAD_EXTENSIONS],
  momApprovalRequired: false,
  emailNotificationsEnabled: true,
  browserNotificationsEnabled: true,
  taskDueReminderDaysBefore: [1],
  holidays: [],
};

/** The switches in §35, one per notification class. */
export interface OfficeHubNotificationPreferences {
  meetingInvitations: boolean;
  meetingReminders: boolean;
  meetingChanges: boolean;
  participantResponses: boolean;
  taskAssignments: boolean;
  taskDueReminders: boolean;
  overdueAlerts: boolean;
  comments: boolean;
  mentions: boolean;
  teamNotifications: boolean;
  decisionUpdates: boolean;
  email: boolean;
  browser: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: OfficeHubNotificationPreferences = {
  meetingInvitations: true,
  meetingReminders: true,
  meetingChanges: true,
  participantResponses: true,
  taskAssignments: true,
  taskDueReminders: true,
  overdueAlerts: true,
  comments: true,
  mentions: true,
  teamNotifications: true,
  decisionUpdates: true,
  email: true,
  browser: false,
};

/** Per-user preferences (§35, §59). Absent fields fall back to `DEFAULT_*` above. */
export interface OfficeHubUserSettings extends OfficeHubAuditFields {
  /** The `users` document id. */
  id: string;
  timeZone?: string | null;
  defaultReminderOffsets?: ReminderOffsetMinutes[];
  notifications?: Partial<OfficeHubNotificationPreferences>;
  /** Which calendar view the user lands on. */
  defaultCalendarView?: CalendarView | null;
  /** Remembered so a user who dismissed the browser-permission prompt is not asked every visit. */
  browserPermissionAsked?: boolean;
}

export type CalendarView = 'day' | 'week' | 'month' | 'agenda';

export const CALENDAR_VIEWS: readonly CalendarView[] = ['day', 'week', 'month', 'agenda'] as const;

/* ── the meeting → task chain ─────────────────────────────────────────────────────────────────── */

/**
 * `Meeting → Decision → Action Item → Task`, as one object.
 *
 * §91 calls this the most important workflow in the application, and §23 requires a task to be able
 * to name the meeting it came from. Carrying the whole chain — rather than only the immediate
 * parent — is what lets a task's header render "from Finance Review, 12 Sep" without three reads.
 */
export interface OfficeHubSourceChain {
  meetingId?: string | null;
  meetingTitle?: string | null;
  meetingDate?: IsoDate | null;
  decisionId?: string | null;
  decisionTitle?: string | null;
  actionItemId?: string | null;
  actionItemTitle?: string | null;
}
