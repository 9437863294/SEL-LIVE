/**
 * The reminder engine (§61) and the notification payloads it produces (§32, §60).
 *
 * Pure, so the cron route and the browser agree on exactly which reminders a meeting or task should
 * have. The division of labour is deliberate and is what §62 and §86 are about:
 *
 *   • This module decides *what* should be reminded and *when* — a list of rows.
 *   • `office-hub-service.ts` writes those rows to `officeHubReminders` when the meeting or task is
 *     saved, and cancels them when it is cancelled.
 *   • `src/app/api/office-hub/cron/route.ts` sweeps due rows on the server and delivers them.
 *
 * Nothing in that chain depends on a browser tab being open. A reminder that fires from a
 * `setTimeout` in a React component is not a reminder; it is a reminder for whoever happened to
 * leave the page open, which is nobody at 8am.
 */

import {
  addDays,
  formatIsoDate,
  formatRelativeToNow,
  minutesToClock,
  todayInZone,
  zonedTimeToUtc,
  OFFICE_HUB_DEFAULT_TIME_ZONE,
  type IsoDate,
} from './office-hub-time.ts';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type OfficeHubActionItem,
  type OfficeHubDecision,
  type OfficeHubEntityType,
  type OfficeHubMeeting,
  type OfficeHubNotificationPreferences,
  type OfficeHubReminder,
  type OfficeHubSettings,
  type OfficeHubTask,
  type OfficeHubUserSettings,
  type ReminderKind,
} from './office-hub-model.ts';
import { describeMeeting, isTaskClosed, isTaskOverdue, settingsOrDefaults, taskOverdueDays } from './office-hub-rules.ts';

/** A reminder row to be written, before it has an id. */
export type ReminderDraft = Omit<
  OfficeHubReminder,
  'id' | 'createdAt' | 'createdBy' | 'createdByName' | 'updatedAt' | 'updatedBy' | 'updatedByName'
>;

/**
 * Deterministic id for a reminder row.
 *
 * Reminder documents are written under this id rather than an auto-id, which is what makes
 * re-saving a meeting idempotent: the same offset for the same user on the same meeting overwrites
 * its own row instead of adding a second one. Rescheduling a meeting therefore *moves* its
 * reminders rather than accumulating a set for every time it was ever moved.
 */
export function reminderId(
  entityType: OfficeHubEntityType,
  entityId: string,
  userId: string,
  kind: ReminderKind,
  offsetMinutes?: number | null,
): string {
  const offsetPart = offsetMinutes == null ? 'na' : String(offsetMinutes);
  return `${entityType}_${entityId}_${userId}_${kind}_${offsetPart}`;
}

/** A user's effective notification preferences: their own choices over the office defaults. */
export function effectivePreferences(
  userSettings: Pick<OfficeHubUserSettings, 'notifications'> | null | undefined,
  settings?: Partial<OfficeHubSettings> | null,
): OfficeHubNotificationPreferences {
  const office = settingsOrDefaults(settings);
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    // An office-level switch can only *withdraw* a channel, never force one on: an installation with
    // no mail transport configured turns email off for everybody, but an installation with one does
    // not override a user who asked not to be emailed.
    email: DEFAULT_NOTIFICATION_PREFERENCES.email && office.emailNotificationsEnabled,
    browser: DEFAULT_NOTIFICATION_PREFERENCES.browser && office.browserNotificationsEnabled,
    ...(userSettings?.notifications ?? {}),
    ...(office.emailNotificationsEnabled ? {} : { email: false }),
    ...(office.browserNotificationsEnabled ? {} : { browser: false }),
  };
}

/** The reminder offsets that apply to a meeting for a given user (§12). */
export function resolveMeetingReminderOffsets(
  meeting: Pick<OfficeHubMeeting, 'reminderOffsets'>,
  userSettings: Pick<OfficeHubUserSettings, 'defaultReminderOffsets'> | null | undefined,
  settings?: Partial<OfficeHubSettings> | null,
): number[] {
  // The organizer's choice on the meeting wins, because §12 says explicitly that the organizer may
  // override the default. The user's own default applies only where the meeting expresses none.
  if (meeting.reminderOffsets?.length) return dedupeOffsets(meeting.reminderOffsets);
  if (userSettings?.defaultReminderOffsets?.length) return dedupeOffsets(userSettings.defaultReminderOffsets);
  return dedupeOffsets(settingsOrDefaults(settings).defaultReminderOffsets);
}

const dedupeOffsets = (offsets: readonly number[]): number[] =>
  [...new Set(offsets.map((offset) => Math.max(0, Math.round(offset))))].sort((a, b) => b - a);

/**
 * Every reminder row a meeting should have.
 *
 * One row per participant per offset, rather than one row per offset fanned out at delivery time.
 * It is more documents, and it is the right shape for two reasons: a participant who has turned
 * meeting reminders off simply has no row (so the sweep does not have to re-derive preferences for
 * everybody at 6am, when it is under time pressure), and a failed delivery is recorded against the
 * person it failed for rather than against the meeting.
 *
 * Reminders in the past are skipped: a meeting scheduled for an hour from now with a "1 day before"
 * reminder should not fire that reminder immediately. That is not a missed notification, it is a
 * notification whose moment has gone.
 */
export function buildMeetingReminders(input: {
  meeting: Pick<
    OfficeHubMeeting,
    'id' | 'title' | 'date' | 'startTime' | 'timeZone' | 'startAt' | 'status' | 'seriesId' | 'organizationId'
  >;
  recipients: readonly { userId: string; offsets: number[]; wantsReminders: boolean }[];
  now?: Date;
}): ReminderDraft[] {
  const { meeting } = input;
  if (meeting.status === 'Cancelled' || meeting.status === 'Completed') return [];

  const startMillis = Date.parse(meeting.startAt);
  if (Number.isNaN(startMillis)) return [];
  const nowMillis = (input.now ?? new Date()).getTime();

  const drafts: ReminderDraft[] = [];
  for (const recipient of input.recipients) {
    if (!recipient.wantsReminders) continue;
    for (const offset of dedupeOffsets(recipient.offsets)) {
      const scheduledMillis = startMillis - offset * 60_000;
      if (scheduledMillis <= nowMillis) continue;
      drafts.push({
        entityType: 'meeting',
        entityId: meeting.id,
        entityTitle: meeting.title,
        userId: recipient.userId,
        kind: offset === 0 ? 'meeting-starting' : 'meeting-reminder',
        offsetMinutes: offset,
        scheduledAt: new Date(scheduledMillis).toISOString(),
        status: 'Scheduled',
        attempts: 0,
        link: `/office-hub/meetings/${meeting.id}`,
        seriesId: meeting.seriesId ?? null,
        organizationId: meeting.organizationId ?? null,
      });
    }
  }
  return drafts;
}

/**
 * Reminder rows for a task's due date (§27).
 *
 * Fired at 09:00 local on each configured day before the due date, plus one on the day itself.
 * A fixed morning hour rather than "24 hours before the deadline" because a task's due date is a
 * date, not an instant — there is no midnight deadline to count back from, and a reminder that
 * arrives at 23:00 the night before is a reminder nobody can act on.
 */
export function buildTaskReminders(input: {
  task: Pick<OfficeHubTask, 'id' | 'title' | 'dueDate' | 'status' | 'assigneeId' | 'organizationId'>;
  recipients: readonly { userId: string; timeZone?: string | null; wantsReminders: boolean }[];
  daysBefore?: number[];
  reminderHour?: number;
  now?: Date;
}): ReminderDraft[] {
  const { task } = input;
  if (!task.dueDate || isTaskClosed(task.status)) return [];

  const nowMillis = (input.now ?? new Date()).getTime();
  const hour = input.reminderHour ?? 9;
  const daysBefore = [...new Set([...(input.daysBefore ?? [1]), 0])].sort((a, b) => b - a);

  const drafts: ReminderDraft[] = [];
  for (const recipient of input.recipients) {
    if (!recipient.wantsReminders) continue;
    const zone = recipient.timeZone || OFFICE_HUB_DEFAULT_TIME_ZONE;
    for (const days of daysBefore) {
      const fireDate = addDays(task.dueDate, -Math.abs(days));
      const scheduled = zonedTimeToUtc(fireDate, minutesToClock(hour * 60), zone);
      if (scheduled.getTime() <= nowMillis) continue;
      drafts.push({
        entityType: 'task',
        entityId: task.id,
        entityTitle: task.title,
        userId: recipient.userId,
        kind: days === 0 ? 'task-due-today' : 'task-due-soon',
        offsetMinutes: days * 1440,
        scheduledAt: scheduled.toISOString(),
        status: 'Scheduled',
        attempts: 0,
        link: `/office-hub/tasks/${task.id}`,
        organizationId: task.organizationId ?? null,
      });
    }
  }
  return drafts;
}

/**
 * The overdue sweep (§27, §62).
 *
 * Driven by the tasks themselves rather than by pre-written reminder rows, because "overdue" has no
 * single moment to schedule against — it starts on the day after the due date and continues until
 * somebody acts. `lastOverdueNoticeAt` is what stops that becoming a notification every time the
 * cron runs: one notice per task per day, which is enough to be a nag and little enough to still be
 * read.
 */
export function overdueTaskNotices(input: {
  /**
   * The picks include `reference`, `priority` and `meetingTitle` because the caller feeds the
   * returned task straight into `taskNotificationCopy`, which needs them. Narrowing the shape
   * further would only force the caller to re-widen it at the call site.
   */
  tasks: readonly Pick<
    OfficeHubTask,
    | 'id'
    | 'title'
    | 'reference'
    | 'priority'
    | 'meetingTitle'
    | 'status'
    | 'dueDate'
    | 'assigneeId'
    | 'assigneeName'
    | 'teamId'
    | 'watcherUserIds'
    | 'lastOverdueNoticeAt'
    | 'organizationId'
  >[];
  today: IsoDate;
  now?: Date;
  /** Minimum gap between two notices for the same task. */
  minimumGapHours?: number;
}): { task: (typeof input.tasks)[number]; recipients: string[]; overdueDays: number }[] {
  const now = input.now ?? new Date();
  const gapMillis = (input.minimumGapHours ?? 20) * 3_600_000;

  const notices: { task: (typeof input.tasks)[number]; recipients: string[]; overdueDays: number }[] = [];
  for (const task of input.tasks) {
    if (!isTaskOverdue(task, input.today)) continue;
    if (task.lastOverdueNoticeAt) {
      const last = Date.parse(task.lastOverdueNoticeAt);
      if (!Number.isNaN(last) && now.getTime() - last < gapMillis) continue;
    }
    const recipients = [...new Set([task.assigneeId, ...(task.watcherUserIds ?? [])].filter(Boolean) as string[])];
    if (!recipients.length) continue;
    notices.push({ task, recipients, overdueDays: taskOverdueDays(task, input.today) });
  }
  return notices;
}

/** Due-date notices for decisions and action items, on the same one-a-day basis as tasks. */
export function dueDecisionNotices(input: {
  decisions: readonly Pick<OfficeHubDecision, 'id' | 'title' | 'status' | 'dueDate' | 'ownerId' | 'reference'>[];
  actionItems: readonly Pick<
    OfficeHubActionItem,
    'id' | 'title' | 'status' | 'dueDate' | 'responsibleUserId' | 'reference' | 'meetingId'
  >[];
  today: IsoDate;
  horizonDays?: number;
}): {
  kind: 'decision' | 'action-item';
  id: string;
  title: string;
  reference: string;
  userId: string;
  dueDate: IsoDate;
  overdue: boolean;
  link: string;
}[] {
  const horizon = addDays(input.today, input.horizonDays ?? 2);
  const rows: {
    kind: 'decision' | 'action-item';
    id: string;
    title: string;
    reference: string;
    userId: string;
    dueDate: IsoDate;
    overdue: boolean;
    link: string;
  }[] = [];

  for (const decision of input.decisions) {
    if (!decision.dueDate || decision.status === 'Completed' || decision.status === 'Cancelled') continue;
    if (decision.dueDate > horizon) continue;
    if (!decision.ownerId) continue;
    rows.push({
      kind: 'decision',
      id: decision.id,
      title: decision.title,
      reference: decision.reference,
      userId: decision.ownerId,
      dueDate: decision.dueDate,
      overdue: decision.dueDate < input.today,
      link: `/office-hub/decisions/${decision.id}`,
    });
  }

  for (const item of input.actionItems) {
    if (!item.dueDate || item.status === 'Completed' || item.status === 'Cancelled') continue;
    if (item.dueDate > horizon) continue;
    if (!item.responsibleUserId) continue;
    rows.push({
      kind: 'action-item',
      id: item.id,
      title: item.title,
      reference: item.reference,
      userId: item.responsibleUserId,
      dueDate: item.dueDate,
      overdue: item.dueDate < input.today,
      link: item.meetingId ? `/office-hub/meetings/${item.meetingId}` : '/office-hub/action-items',
    });
  }

  return rows;
}

/* ── notification copy ───────────────────────────────────────────────────────────────────────── */

/**
 * The notification types Office Hub raises, as the strings that reach `userNotifications`.
 *
 * Prefixed `office_hub_` so the existing bell — which renders whatever it finds — can group and
 * filter them without colliding with another module's type, and so a notification's origin is
 * legible in the database without a join.
 */
export const OFFICE_HUB_NOTIFICATION_TYPES = {
  MEETING_INVITATION: 'office_hub_meeting_invitation',
  MEETING_REMINDER: 'office_hub_meeting_reminder',
  MEETING_STARTING: 'office_hub_meeting_starting',
  MEETING_RESCHEDULED: 'office_hub_meeting_rescheduled',
  MEETING_CANCELLED: 'office_hub_meeting_cancelled',
  MEETING_RESPONSE: 'office_hub_meeting_response',
  MEETING_RESPONSE_CHASE: 'office_hub_meeting_response_chase',
  MOM_PUBLISHED: 'office_hub_mom_published',
  MOM_PENDING: 'office_hub_mom_pending',
  TASK_ASSIGNED: 'office_hub_task_assigned',
  TASK_DUE_SOON: 'office_hub_task_due_soon',
  TASK_OVERDUE: 'office_hub_task_overdue',
  TASK_COMPLETED: 'office_hub_task_completed',
  TASK_REASSIGNED: 'office_hub_task_reassigned',
  TASK_COMMENT: 'office_hub_task_comment',
  TASK_MENTION: 'office_hub_task_mention',
  TASK_STATUS: 'office_hub_task_status',
  TEAM_ADDED: 'office_hub_team_added',
  TEAM_REMOVED: 'office_hub_team_removed',
  TEAM_ANNOUNCEMENT: 'office_hub_team_announcement',
  DECISION_ASSIGNED: 'office_hub_decision_assigned',
  DECISION_DUE: 'office_hub_decision_due',
  DECISION_COMPLETED: 'office_hub_decision_completed',
  ACTION_ITEM_ASSIGNED: 'office_hub_action_item_assigned',
  ACTION_ITEM_DUE: 'office_hub_action_item_due',
} as const;

export type OfficeHubNotificationType =
  (typeof OFFICE_HUB_NOTIFICATION_TYPES)[keyof typeof OFFICE_HUB_NOTIFICATION_TYPES];

/** Which §35 switch governs a notification type. Null means the user cannot turn it off. */
export function preferenceKeyForType(
  type: OfficeHubNotificationType,
): keyof OfficeHubNotificationPreferences | null {
  switch (type) {
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_INVITATION:
      return 'meetingInvitations';
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_REMINDER:
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_STARTING:
      return 'meetingReminders';
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_RESCHEDULED:
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_CANCELLED:
      return 'meetingChanges';
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_RESPONSE:
      return 'participantResponses';
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_ASSIGNED:
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_REASSIGNED:
      return 'taskAssignments';
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_DUE_SOON:
      return 'taskDueReminders';
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE:
      return 'overdueAlerts';
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_COMMENT:
      return 'comments';
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_MENTION:
      return 'mentions';
    case OFFICE_HUB_NOTIFICATION_TYPES.TEAM_ADDED:
    case OFFICE_HUB_NOTIFICATION_TYPES.TEAM_REMOVED:
    case OFFICE_HUB_NOTIFICATION_TYPES.TEAM_ANNOUNCEMENT:
      return 'teamNotifications';
    case OFFICE_HUB_NOTIFICATION_TYPES.DECISION_ASSIGNED:
    case OFFICE_HUB_NOTIFICATION_TYPES.DECISION_DUE:
    case OFFICE_HUB_NOTIFICATION_TYPES.DECISION_COMPLETED:
      return 'decisionUpdates';
    default:
      // Cancellations of things you are responsible for, and anything else not listed, are not
      // optional. A switch that can hide "your meeting was cancelled" is a switch that causes
      // people to turn up to meetings that are not happening.
      return null;
  }
}

/** Whether a user's preferences allow an in-app notification of this type through. */
export function allowsNotification(
  type: OfficeHubNotificationType,
  preferences: OfficeHubNotificationPreferences,
): boolean {
  const key = preferenceKeyForType(type);
  if (!key) return true;
  const value = preferences[key];
  return typeof value === 'boolean' ? value : true;
}

export interface NotificationCopy {
  title: string;
  body: string;
  link: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

/**
 * The words a notification uses.
 *
 * Centralised so that the same event reads the same whether it was raised by a save in the browser
 * or by the cron sweep on the server — and so that changing "starts in 15 minutes" to something
 * better is one edit rather than a search across the module.
 */
export function meetingNotificationCopy(
  type: OfficeHubNotificationType,
  meeting: Pick<OfficeHubMeeting, 'id' | 'title' | 'date' | 'startTime' | 'startAt' | 'organizerName' | 'mode'>,
  context: { offsetMinutes?: number | null; actorName?: string | null; reason?: string | null; now?: Date } = {},
): NotificationCopy {
  const link = `/office-hub/meetings/${meeting.id}`;
  const when = describeMeeting(meeting);

  switch (type) {
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_INVITATION:
      return {
        title: `Meeting invitation: ${meeting.title}`,
        body: `${meeting.organizerName} invited you to ${when}. Let them know if you can make it.`,
        link,
        severity: 'INFO',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_REMINDER: {
      const relative = formatRelativeToNow(new Date(Date.parse(meeting.startAt)), context.now ?? new Date());
      return {
        title: `${meeting.title} starts ${relative}`,
        body: `${when}${meeting.mode === 'Online' ? ' · Online' : ''}`,
        link,
        severity: 'INFO',
      };
    }
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_STARTING:
      return {
        title: `${meeting.title} is starting now`,
        body: `${when}. ${meeting.mode === 'Offline' ? 'Head to the room.' : 'Join when you are ready.'}`,
        link,
        severity: 'WARNING',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_RESCHEDULED:
      return {
        title: `Rescheduled: ${meeting.title}`,
        body: `${context.actorName || meeting.organizerName} moved this meeting to ${when}.`,
        link,
        severity: 'WARNING',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_CANCELLED:
      return {
        title: `Cancelled: ${meeting.title}`,
        body: `${context.actorName || meeting.organizerName} cancelled the meeting on ${formatIsoDate(
          meeting.date,
        )}${context.reason ? ` — ${context.reason}` : ''}.`,
        link,
        severity: 'WARNING',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.MEETING_RESPONSE_CHASE:
      return {
        title: `Response needed: ${meeting.title}`,
        body: `${meeting.organizerName} is waiting to hear whether you can attend ${when}.`,
        link,
        severity: 'INFO',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.MOM_PUBLISHED:
      return {
        title: `Minutes published: ${meeting.title}`,
        body: `The minutes of the meeting on ${formatIsoDate(meeting.date)} are now available.`,
        link: `${link}/mom`,
        severity: 'INFO',
      };
    default:
      return { title: meeting.title, body: when, link, severity: 'INFO' };
  }
}

export function taskNotificationCopy(
  type: OfficeHubNotificationType,
  task: Pick<OfficeHubTask, 'id' | 'title' | 'reference' | 'dueDate' | 'priority' | 'meetingTitle'>,
  context: { actorName?: string | null; overdueDays?: number; status?: string | null; comment?: string | null } = {},
): NotificationCopy {
  const link = `/office-hub/tasks/${task.id}`;
  const due = task.dueDate ? ` Due ${formatIsoDate(task.dueDate)}.` : '';
  const source = task.meetingTitle ? ` From ${task.meetingTitle}.` : '';

  switch (type) {
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_ASSIGNED:
      return {
        title: `New task: ${task.title}`,
        body: `${context.actorName || 'Someone'} assigned you ${task.reference}.${due}${source}`,
        link,
        severity: task.priority === 'Critical' ? 'WARNING' : 'INFO',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_REASSIGNED:
      return {
        title: `Task reassigned: ${task.title}`,
        body: `${context.actorName || 'Someone'} moved ${task.reference} to you.${due}`,
        link,
        severity: 'INFO',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_DUE_SOON:
      return {
        title: `Task due soon: ${task.title}`,
        body: `${task.reference} is due ${task.dueDate ? formatIsoDate(task.dueDate) : 'soon'}.`,
        link,
        severity: 'INFO',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE:
      return {
        title: `Overdue: ${task.title}`,
        body: `${task.reference} is ${context.overdueDays ?? 1} day${
          (context.overdueDays ?? 1) === 1 ? '' : 's'
        } past its due date.`,
        link,
        // Overdue work is the one thing in this module that escalates by itself, because it is the
        // one thing that gets worse if nobody looks at it.
        severity: (context.overdueDays ?? 1) > 7 ? 'CRITICAL' : 'WARNING',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_COMPLETED:
      return {
        title: `Completed: ${task.title}`,
        body: `${context.actorName || 'Someone'} marked ${task.reference} complete.`,
        link,
        severity: 'INFO',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_STATUS:
      return {
        title: `${task.title} is now ${context.status ?? 'updated'}`,
        body: `${context.actorName || 'Someone'} changed the status of ${task.reference}.`,
        link,
        severity: 'INFO',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_COMMENT:
      return {
        title: `New comment on ${task.title}`,
        body: `${context.actorName || 'Someone'}: ${truncate(context.comment || '', 120)}`,
        link,
        severity: 'INFO',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.TASK_MENTION:
      return {
        title: `${context.actorName || 'Someone'} mentioned you`,
        body: `On ${task.title}: ${truncate(context.comment || '', 120)}`,
        link,
        severity: 'INFO',
      };
    default:
      return { title: task.title, body: task.reference, link, severity: 'INFO' };
  }
}

export function decisionNotificationCopy(
  type: OfficeHubNotificationType,
  decision: Pick<OfficeHubDecision, 'id' | 'title' | 'reference' | 'dueDate' | 'meetingTitle'>,
  context: { actorName?: string | null; overdue?: boolean } = {},
): NotificationCopy {
  const link = `/office-hub/decisions/${decision.id}`;
  switch (type) {
    case OFFICE_HUB_NOTIFICATION_TYPES.DECISION_ASSIGNED:
      return {
        title: `Decision assigned: ${decision.title}`,
        body: `${context.actorName || 'Someone'} made you the owner of ${decision.reference}${
          decision.meetingTitle ? ` from ${decision.meetingTitle}` : ''
        }.`,
        link,
        severity: 'INFO',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.DECISION_DUE:
      return {
        title: context.overdue
          ? `Decision overdue: ${decision.title}`
          : `Decision due: ${decision.title}`,
        body: `${decision.reference} was due ${decision.dueDate ? formatIsoDate(decision.dueDate) : 'recently'}.`,
        link,
        severity: context.overdue ? 'WARNING' : 'INFO',
      };
    case OFFICE_HUB_NOTIFICATION_TYPES.DECISION_COMPLETED:
      return {
        title: `Decision closed: ${decision.title}`,
        body: `${context.actorName || 'Someone'} closed ${decision.reference}.`,
        link,
        severity: 'INFO',
      };
    default:
      return { title: decision.title, body: decision.reference, link, severity: 'INFO' };
  }
}

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

/** The notification a reminder row turns into when the sweep picks it up. */
export function reminderNotificationType(kind: ReminderKind): OfficeHubNotificationType {
  switch (kind) {
    case 'meeting-starting':
      return OFFICE_HUB_NOTIFICATION_TYPES.MEETING_STARTING;
    case 'meeting-reminder':
      return OFFICE_HUB_NOTIFICATION_TYPES.MEETING_REMINDER;
    case 'task-due-soon':
      return OFFICE_HUB_NOTIFICATION_TYPES.TASK_DUE_SOON;
    case 'task-due-today':
      return OFFICE_HUB_NOTIFICATION_TYPES.TASK_DUE_SOON;
    case 'task-overdue':
      return OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE;
    case 'decision-due':
      return OFFICE_HUB_NOTIFICATION_TYPES.DECISION_DUE;
    case 'action-item-due':
      return OFFICE_HUB_NOTIFICATION_TYPES.ACTION_ITEM_DUE;
    case 'mom-pending':
      return OFFICE_HUB_NOTIFICATION_TYPES.MOM_PENDING;
    default:
      return OFFICE_HUB_NOTIFICATION_TYPES.MEETING_REMINDER;
  }
}

/** Reminder rows due for delivery, oldest first, capped so one sweep cannot run forever. */
export function dueReminders<T extends Pick<OfficeHubReminder, 'scheduledAt' | 'status'>>(
  reminders: readonly T[],
  now: Date = new Date(),
  options: { limit?: number; graceMinutes?: number } = {},
): T[] {
  const cutoff = now.getTime();
  // A reminder whose moment passed a long time ago is dropped rather than delivered: a sweep that
  // has been down for two days should not, on recovery, tell everybody about meetings that have
  // already happened.
  const floor = cutoff - (options.graceMinutes ?? 180) * 60_000;
  return reminders
    .filter((reminder) => reminder.status === 'Scheduled')
    .filter((reminder) => {
      const at = Date.parse(reminder.scheduledAt);
      return !Number.isNaN(at) && at <= cutoff && at >= floor;
    })
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, options.limit ?? 200);
}

/** Reminder rows that have gone stale and should be closed out rather than delivered. */
export function lapsedReminders<T extends Pick<OfficeHubReminder, 'scheduledAt' | 'status'>>(
  reminders: readonly T[],
  now: Date = new Date(),
  graceMinutes = 180,
): T[] {
  const floor = now.getTime() - graceMinutes * 60_000;
  return reminders.filter((reminder) => {
    if (reminder.status !== 'Scheduled') return false;
    const at = Date.parse(reminder.scheduledAt);
    return !Number.isNaN(at) && at < floor;
  });
}

/** Today in the office zone — the date every sweep compares due dates against. */
export const sweepToday = (settings?: Partial<OfficeHubSettings> | null, now?: Date): IsoDate =>
  todayInZone(settingsOrDefaults(settings).defaultTimeZone, now ?? new Date());
