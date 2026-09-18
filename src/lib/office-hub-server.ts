import 'server-only';

/**
 * Office Hub's server-side engine: the part that runs when nobody is signed in.
 *
 * ── Why this exists at all ─────────────────────────────────────────────────────────────────────
 *
 * §62 and §86 both say the same thing from different angles: reminders must not depend on a browser
 * tab being open. A `setTimeout` in a React component is not a reminder — it is a reminder for
 * whoever happens to have left the page open, which at 6am is nobody. So everything that has to
 * happen on a clock happens here, under the Admin SDK, driven by `/api/office-hub/cron`.
 *
 * ── What it does, and the property each sweep has to have ──────────────────────────────────────
 *
 *  1. **Deliver due reminders.** Rows written by the client when a meeting or task was saved.
 *     *Idempotent*: a delivered row is flipped to `Sent` in the same pass, so a cron that fires
 *     twice does not notify twice.
 *  2. **Advance meeting statuses.** Scheduled → In Progress → Completed on the clock, and never
 *     touching a cancelled or manually-completed meeting. *Idempotent*: it writes only on a real
 *     transition.
 *  3. **Nag about overdue tasks.** Driven by the tasks themselves, because "overdue" has no single
 *     moment to schedule against. *Rate-limited*: `lastOverdueNoticeAt` holds it to one notice per
 *     task per day, which is enough to be a nag and little enough to still be read.
 *  4. **Chase decisions and action items** whose dates are near or past.
 *  5. **Top up recurring series.** Materialises the next instances of any open-ended series inside
 *     the horizon. *Idempotent by `occurrenceKey`*, which is what makes §86's "do not create
 *     duplicate recurring meetings" structural rather than a thing to remember.
 *
 * Every sweep reuses the same pure functions the browser uses — `dueReminders`,
 * `deriveMeetingStatus`, `overdueTaskNotices`, `pendingOccurrences` — so the cron and the screens
 * cannot disagree about whether something is due.
 *
 * ── Email ─────────────────────────────────────────────────────────────────────────────────────
 *
 * §33 says not to hard-code a provider. `registerEmailProvider` is called here with an adapter over
 * the app's existing `sendEmail`, so the templates in `office-hub-integrations.ts` reach a real
 * transport without knowing anything about it. With no transport configured the adapter is not
 * registered, the in-app notification still goes out, and nothing fails.
 */

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from './firebase-admin';
import { dispatchNotificationServer } from './notifications-server';
import { logServerActivity } from './activity-logger-server';
import { ACTIVITY_MODULES } from './activity-modules';
import {
  OFFICE_HUB_COLLECTIONS,
  OFFICE_HUB_SETTINGS_DOC_ID,
} from './office-hub';
import {
  DEFAULT_OFFICE_HUB_SETTINGS,
  type OfficeHubActionItem,
  type OfficeHubDecision,
  type OfficeHubMeeting,
  type OfficeHubReminder,
  type OfficeHubSettings,
  type OfficeHubTask,
  type OfficeHubUserSettings,
} from './office-hub-model';
import {
  deriveMeetingStatus,
  meetingInstants,
  settingsOrDefaults,
} from './office-hub-rules';
import {
  OFFICE_HUB_NOTIFICATION_TYPES,
  allowsNotification,
  decisionNotificationCopy,
  dueDecisionNotices,
  dueReminders,
  effectivePreferences,
  lapsedReminders,
  meetingNotificationCopy,
  overdueTaskNotices,
  reminderNotificationType,
  sweepToday,
  taskNotificationCopy,
} from './office-hub-reminders';
import { pendingOccurrences } from './office-hub-recurrence';
import {
  registerEmailProvider,
  renderMeetingEmail,
  renderTaskEmail,
  resolveBaseUrl,
  type EmailMessage,
} from './office-hub-integrations';
import { addDays, todayInZone } from './office-hub-time';

/* ── email transport ─────────────────────────────────────────────────────────────────────────── */

/**
 * Wire the app's mail transport in as Office Hub's `EmailProvider` (§33, §63).
 *
 * Registered lazily and only when a transport is actually configured, so an installation with no
 * SMTP details simply has no email provider — the in-app bell is unaffected, and nothing throws.
 */
let emailRegistered = false;

async function ensureEmailProvider(): Promise<void> {
  if (emailRegistered) return;
  emailRegistered = true;

  const configured = Boolean(process.env.SMTP_HOST || process.env.EMAIL_SERVER_HOST || process.env.GMAIL_USER);
  if (!configured) {
    console.info('[office-hub] No mail transport configured; email notifications are off.');
    return;
  }

  try {
    const { sendEmail } = await import('./mail');
    registerEmailProvider({
      id: 'sel-live-nodemailer',
      label: 'Office mail transport',
      async send(message: EmailMessage) {
        try {
          await sendEmail({
            to: message.to.join(', '),
            subject: message.subject,
            html: message.html,
            text: message.text,
          });
          return { ok: true };
        } catch (error) {
          console.error('[office-hub] Email send failed', error);
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
  } catch (error) {
    console.error('[office-hub] Could not load the mail transport', error);
  }
}

/* ── shared helpers ──────────────────────────────────────────────────────────────────────────── */

const mapDocs = <T>(snapshot: { docs: { id: string; data: () => unknown }[] }): T[] =>
  snapshot.docs.map((entry) => ({ id: entry.id, ...(entry.data() as object) }) as T);

const chunk = <T>(values: readonly T[], size: number): T[][] => {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
};

async function loadSettings(db: Firestore): Promise<OfficeHubSettings> {
  try {
    const snapshot = await db
      .collection(OFFICE_HUB_COLLECTIONS.settings)
      .doc(OFFICE_HUB_SETTINGS_DOC_ID)
      .get();
    return settingsOrDefaults(snapshot.data() as Partial<OfficeHubSettings> | undefined);
  } catch (error) {
    console.error('[office-hub] Could not read settings; using defaults', error);
    return { ...DEFAULT_OFFICE_HUB_SETTINGS };
  }
}

/**
 * Per-user preferences, read once per sweep.
 *
 * A sweep may touch hundreds of recipients, and re-reading a preference document per notification
 * would dominate the run. A missing document resolves to the defaults, which is the correct
 * reading — most users never open the settings page.
 */
class PreferenceCache {
  private readonly cache = new Map<string, OfficeHubUserSettings | null>();

  constructor(private readonly db: Firestore, private readonly settings: OfficeHubSettings) {}

  async load(userIds: readonly string[]): Promise<void> {
    const missing = [...new Set(userIds)].filter((userId) => userId && !this.cache.has(userId));
    for (const group of chunk(missing, 30)) {
      await Promise.all(
        group.map(async (userId) => {
          try {
            const snapshot = await this.db.collection(OFFICE_HUB_COLLECTIONS.userSettings).doc(userId).get();
            this.cache.set(
              userId,
              snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubUserSettings) : null,
            );
          } catch {
            this.cache.set(userId, null);
          }
        }),
      );
    }
  }

  allows(userId: string, type: string): boolean {
    const stored = this.cache.get(userId) ?? null;
    return allowsNotification(type as never, effectivePreferences(stored, this.settings));
  }

  timeZoneOf(userId: string): string {
    return this.cache.get(userId)?.timeZone ?? this.settings.defaultTimeZone;
  }

  wantsEmail(userId: string): boolean {
    return effectivePreferences(this.cache.get(userId) ?? null, this.settings).email;
  }
}

/** Email addresses for a set of user ids, from the `users` collection. */
async function loadEmails(db: Firestore, userIds: readonly string[]): Promise<Map<string, { email: string; name: string }>> {
  const result = new Map<string, { email: string; name: string }>();
  const unique = [...new Set(userIds)].filter(Boolean);

  for (const group of chunk(unique, 10)) {
    try {
      const snapshot = await db.collection('users').where('__name__', 'in', group).get();
      for (const entry of snapshot.docs) {
        const data = entry.data() as { email?: string; name?: string };
        if (data.email) result.set(entry.id, { email: data.email, name: data.name ?? 'Colleague' });
      }
    } catch (error) {
      // An address lookup failure costs the email, never the in-app notification.
      console.error('[office-hub] Could not read recipient addresses', error);
    }
  }
  return result;
}

export interface SweepResult {
  remindersDelivered: number;
  remindersLapsed: number;
  remindersFailed: number;
  statusesAdvanced: number;
  overdueTasksNotified: number;
  dueItemsNotified: number;
  seriesInstancesCreated: number;
  emailsSent: number;
  durationMs: number;
  errors: string[];
}

/* ── 1. due reminders ────────────────────────────────────────────────────────────────────────── */

async function deliverReminders(
  db: Firestore,
  preferences: PreferenceCache,
  now: Date,
  result: SweepResult,
): Promise<void> {
  /**
   * Read a window rather than everything Scheduled.
   *
   * A series materialised twelve weeks ahead has thousands of scheduled rows; only the ones whose
   * moment has arrived matter. The lower bound is the grace window, so a sweep that has been down
   * for a few hours still catches up without delivering yesterday's reminders.
   */
  const graceMinutes = 180;
  const snapshot = await db
    .collection(OFFICE_HUB_COLLECTIONS.reminders)
    .where('status', '==', 'Scheduled')
    .where('scheduledAt', '<=', now.toISOString())
    .orderBy('scheduledAt', 'asc')
    .limit(400)
    .get();

  const rows = mapDocs<OfficeHubReminder>(snapshot);
  const due = dueReminders(rows, now, { limit: 300, graceMinutes });
  const lapsed = lapsedReminders(rows, now, graceMinutes);

  /** Rows whose moment has gone are closed out, not delivered late. */
  if (lapsed.length) {
    for (const group of chunk(lapsed, 400)) {
      const batch = db.batch();
      for (const reminder of group) {
        batch.update(db.collection(OFFICE_HUB_COLLECTIONS.reminders).doc(reminder.id), {
          status: 'Cancelled',
          failureReason: 'The moment for this reminder had already passed when the sweep ran.',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    result.remindersLapsed += lapsed.length;
  }

  if (!due.length) return;

  await preferences.load(due.map((reminder) => reminder.userId));

  /** The entities the reminders point at, read once each. */
  const meetingIds = [...new Set(due.filter((row) => row.entityType === 'meeting').map((row) => row.entityId))];
  const taskIds = [...new Set(due.filter((row) => row.entityType === 'task').map((row) => row.entityId))];

  const meetings = new Map<string, OfficeHubMeeting>();
  for (const group of chunk(meetingIds, 10)) {
    const entities = await db.collection(OFFICE_HUB_COLLECTIONS.meetings).where('__name__', 'in', group).get();
    for (const entry of entities.docs) {
      meetings.set(entry.id, { id: entry.id, ...(entry.data() as object) } as OfficeHubMeeting);
    }
  }
  const tasks = new Map<string, OfficeHubTask>();
  for (const group of chunk(taskIds, 10)) {
    const entities = await db.collection(OFFICE_HUB_COLLECTIONS.tasks).where('__name__', 'in', group).get();
    for (const entry of entities.docs) {
      tasks.set(entry.id, { id: entry.id, ...(entry.data() as object) } as OfficeHubTask);
    }
  }

  const emails = await loadEmails(db, due.map((reminder) => reminder.userId));
  const baseUrl = resolveBaseUrl(process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL ?? null);

  for (const reminder of due) {
    const type = reminderNotificationType(reminder.kind);

    try {
      /**
       * A reminder for a cancelled meeting, or a task that has since been completed, is dropped
       * rather than delivered. The client cancels these rows when it can, but a task completed on a
       * phone that then went offline leaves one behind — and "your meeting starts in 15 minutes"
       * about a cancelled meeting is the single worst notification this module could send.
       */
      if (reminder.entityType === 'meeting') {
        const meeting = meetings.get(reminder.entityId);
        if (!meeting || meeting.status === 'Cancelled' || meeting.isDeleted) {
          await closeReminder(db, reminder.id, 'The meeting was cancelled or removed.');
          result.remindersLapsed += 1;
          continue;
        }
      } else if (reminder.entityType === 'task') {
        const task = tasks.get(reminder.entityId);
        if (!task || task.isDeleted || task.status === 'Completed' || task.status === 'Cancelled') {
          await closeReminder(db, reminder.id, 'The task was completed, cancelled or removed.');
          result.remindersLapsed += 1;
          continue;
        }
      }

      if (!preferences.allows(reminder.userId, type)) {
        await closeReminder(db, reminder.id, 'The recipient has this kind of reminder switched off.');
        continue;
      }

      const copy =
        reminder.entityType === 'meeting'
          ? meetingNotificationCopy(type, meetings.get(reminder.entityId)!, {
              offsetMinutes: reminder.offsetMinutes,
              now,
            })
          : taskNotificationCopy(type, tasks.get(reminder.entityId)!, {});

      await dispatchNotificationServer(
        { userIds: [reminder.userId] },
        {
          type,
          title: copy.title,
          body: copy.body,
          module: ACTIVITY_MODULES.OFFICE_HUB,
          severity: copy.severity,
          itemId: reminder.entityId,
          itemRef: reminder.entityTitle,
          link: copy.link,
          organizationId: reminder.organizationId ?? undefined,
        },
      );

      // Email, when the recipient wants it and there is a transport. Best-effort: a failed email is
      // a degraded channel, not a failed reminder.
      if (preferences.wantsEmail(reminder.userId)) {
        const recipient = emails.get(reminder.userId);
        if (recipient) {
          const sent = await sendReminderEmail({
            reminder,
            recipient,
            meeting: meetings.get(reminder.entityId) ?? null,
            task: tasks.get(reminder.entityId) ?? null,
            baseUrl,
          });
          if (sent) result.emailsSent += 1;
        }
      }

      await db.collection(OFFICE_HUB_COLLECTIONS.reminders).doc(reminder.id).update({
        status: 'Sent',
        sentAt: new Date().toISOString(),
        attempts: (reminder.attempts ?? 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      result.remindersDelivered += 1;
    } catch (error) {
      console.error('[office-hub] Reminder delivery failed', reminder.id, error);
      result.remindersFailed += 1;
      result.errors.push(`reminder ${reminder.id}: ${error instanceof Error ? error.message : String(error)}`);
      // Left Scheduled with the attempt recorded, so the next sweep retries it inside the grace
      // window. A reminder marked Failed can never be retried, which is the wrong default for a
      // transient error.
      await db
        .collection(OFFICE_HUB_COLLECTIONS.reminders)
        .doc(reminder.id)
        .update({
          attempts: (reminder.attempts ?? 0) + 1,
          failureReason: error instanceof Error ? error.message : String(error),
          // Three attempts is where a transient failure stops being transient.
          ...((reminder.attempts ?? 0) + 1 >= 3 ? { status: 'Failed' } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch(() => {});
    }
  }
}

async function closeReminder(db: Firestore, reminderId: string, reason: string): Promise<void> {
  await db
    .collection(OFFICE_HUB_COLLECTIONS.reminders)
    .doc(reminderId)
    .update({ status: 'Cancelled', failureReason: reason, updatedAt: FieldValue.serverTimestamp() })
    .catch(() => {});
}

async function sendReminderEmail(input: {
  reminder: OfficeHubReminder;
  recipient: { email: string; name: string };
  meeting: OfficeHubMeeting | null;
  task: OfficeHubTask | null;
  baseUrl: string;
}): Promise<boolean> {
  const { getEmailProvider } = await import('./office-hub-integrations');
  const provider = getEmailProvider();
  if (!provider) return false;

  const rendered = input.meeting
    ? renderMeetingEmail('meeting-reminder', {
        meeting: input.meeting,
        recipientName: input.recipient.name,
        baseUrl: input.baseUrl,
        meetingId: input.meeting.id,
      })
    : input.task
      ? renderTaskEmail('task-reminder', {
          task: input.task,
          recipientName: input.recipient.name,
          baseUrl: input.baseUrl,
          taskId: input.task.id,
        })
      : null;

  if (!rendered) return false;

  const outcome = await provider.send({
    to: [input.recipient.email],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  return outcome.ok;
}

/* ── 2. meeting statuses ─────────────────────────────────────────────────────────────────────── */

async function advanceMeetingStatuses(db: Firestore, now: Date, result: SweepResult): Promise<void> {
  /**
   * Only meetings whose window could plausibly have moved.
   *
   * Scheduled or in-progress, and starting within the last two days — a meeting from last month
   * that is still "Scheduled" was never held, and quietly marking it Completed would put a meeting
   * that did not happen into the completed count.
   */
  const snapshot = await db
    .collection(OFFICE_HUB_COLLECTIONS.meetings)
    .where('status', 'in', ['Scheduled', 'In Progress'])
    .where('startAt', '>=', addDays(now.toISOString().slice(0, 10), -2))
    .limit(400)
    .get();

  const meetings = mapDocs<OfficeHubMeeting>(snapshot).filter((meeting) => !meeting.isDeleted);
  const transitions = meetings
    .map((meeting) => ({ meeting, next: deriveMeetingStatus(meeting, now) }))
    .filter((entry) => entry.next !== entry.meeting.status);

  if (!transitions.length) return;

  for (const group of chunk(transitions, 200)) {
    const batch = db.batch();
    for (const { meeting, next } of group) {
      batch.update(db.collection(OFFICE_HUB_COLLECTIONS.meetings).doc(meeting.id), {
        status: next,
        ...(next === 'In Progress' && !meeting.startedAt ? { startedAt: meeting.startAt } : {}),
        ...(next === 'Completed' && !meeting.endedAt ? { endedAt: meeting.endAt } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  result.statusesAdvanced += transitions.length;
}

/* ── 3. overdue tasks ────────────────────────────────────────────────────────────────────────── */

async function notifyOverdueTasks(
  db: Firestore,
  settings: OfficeHubSettings,
  preferences: PreferenceCache,
  now: Date,
  result: SweepResult,
): Promise<void> {
  const today = sweepToday(settings, now);

  const snapshot = await db
    .collection(OFFICE_HUB_COLLECTIONS.tasks)
    .where('status', 'in', ['Not Started', 'In Progress', 'On Hold'])
    .where('dueDate', '<', today)
    .limit(400)
    .get();

  const tasks = mapDocs<OfficeHubTask>(snapshot).filter((task) => !task.isDeleted);
  const notices = overdueTaskNotices({ tasks, today, now });
  if (!notices.length) return;

  await preferences.load(notices.flatMap((notice) => notice.recipients));

  for (const notice of notices) {
    const allowed = notice.recipients.filter((userId) =>
      preferences.allows(userId, OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE),
    );

    if (allowed.length) {
      const copy = taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE, notice.task, {
        overdueDays: notice.overdueDays,
      });
      await dispatchNotificationServer(
        { userIds: allowed },
        {
          type: OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE,
          title: copy.title,
          body: copy.body,
          module: ACTIVITY_MODULES.OFFICE_HUB,
          severity: copy.severity,
          itemId: notice.task.id,
          itemRef: notice.task.title,
          link: copy.link,
          organizationId: notice.task.organizationId ?? undefined,
        },
      );
      result.overdueTasksNotified += 1;
    }

    /**
     * Stamped even when nobody was notified.
     *
     * Otherwise a task whose only recipient has overdue alerts switched off is re-evaluated on
     * every single run, forever, for a notification that will never be sent.
     */
    await db
      .collection(OFFICE_HUB_COLLECTIONS.tasks)
      .doc(notice.task.id)
      .update({ lastOverdueNoticeAt: now.toISOString() })
      .catch(() => {});
  }
}

/* ── 4. decisions and action items ───────────────────────────────────────────────────────────── */

async function notifyDueItems(
  db: Firestore,
  settings: OfficeHubSettings,
  preferences: PreferenceCache,
  now: Date,
  result: SweepResult,
): Promise<void> {
  const today = sweepToday(settings, now);
  const horizon = addDays(today, 2);

  const [decisionSnapshot, actionSnapshot] = await Promise.all([
    db
      .collection(OFFICE_HUB_COLLECTIONS.decisions)
      .where('status', 'in', ['Open', 'In Progress'])
      .where('dueDate', '<=', horizon)
      .limit(200)
      .get(),
    db
      .collection(OFFICE_HUB_COLLECTIONS.actionItems)
      .where('status', 'in', ['Open', 'In Progress'])
      .where('dueDate', '<=', horizon)
      .limit(200)
      .get(),
  ]);

  const notices = dueDecisionNotices({
    decisions: mapDocs<OfficeHubDecision>(decisionSnapshot).filter((row) => !row.isDeleted),
    actionItems: mapDocs<OfficeHubActionItem>(actionSnapshot).filter((row) => !row.isDeleted),
    today,
  });
  if (!notices.length) return;

  await preferences.load(notices.map((notice) => notice.userId));

  for (const notice of notices) {
    const type =
      notice.kind === 'decision'
        ? OFFICE_HUB_NOTIFICATION_TYPES.DECISION_DUE
        : OFFICE_HUB_NOTIFICATION_TYPES.ACTION_ITEM_DUE;
    if (!preferences.allows(notice.userId, type)) continue;

    const copy = decisionNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.DECISION_DUE, {
      id: notice.id,
      title: notice.title,
      reference: notice.reference,
      dueDate: notice.dueDate,
      meetingTitle: null,
    }, { overdue: notice.overdue });

    await dispatchNotificationServer(
      { userIds: [notice.userId] },
      {
        type,
        title: notice.kind === 'decision' ? copy.title : `${notice.overdue ? 'Overdue' : 'Due'}: ${notice.title}`,
        body: copy.body,
        module: ACTIVITY_MODULES.OFFICE_HUB,
        severity: notice.overdue ? 'WARNING' : 'INFO',
        itemId: notice.id,
        itemRef: notice.reference,
        link: notice.link,
      },
    );
    result.dueItemsNotified += 1;
  }
}

/* ── 5. recurring series top-up ──────────────────────────────────────────────────────────────── */

async function topUpSeries(db: Firestore, now: Date, result: SweepResult): Promise<void> {
  const snapshot = await db
    .collection(OFFICE_HUB_COLLECTIONS.meetings)
    .where('isSeriesParent', '==', true)
    .limit(200)
    .get();

  const parents = mapDocs<OfficeHubMeeting>(snapshot).filter(
    (meeting) =>
      !meeting.isDeleted &&
      meeting.status !== 'Cancelled' &&
      meeting.recurrence &&
      meeting.recurrence.frequency !== 'None',
  );

  for (const parent of parents) {
    try {
      const seriesId = parent.seriesId ?? parent.id;
      const existing = await db
        .collection(OFFICE_HUB_COLLECTIONS.meetings)
        .where('seriesId', '==', seriesId)
        .limit(500)
        .get();

      const existingKeys = mapDocs<OfficeHubMeeting>(existing)
        .map((meeting) => meeting.occurrenceKey)
        .filter(Boolean) as string[];

      const pending = pendingOccurrences(parent.recurrence, parent.date, [...existingKeys, parent.date], {
        // Materialise up to the horizon from *today*, not from the series start — which is what
        // makes an open-ended series keep rolling forward rather than stopping twelve weeks after
        // it was created.
        until: addDays(todayInZone(parent.timeZone, now), 84),
      });
      if (!pending.length) continue;

      const participants = mapDocs<{ id: string } & Record<string, unknown>>(
        await db
          .collection(OFFICE_HUB_COLLECTIONS.participants)
          .where('meetingId', '==', parent.id)
          .limit(200)
          .get(),
      );

      // Ten instances at a time: each writes a meeting plus one document per participant, and a
      // 500-write batch fills faster than it looks with twenty participants.
      for (const group of chunk(pending, 10)) {
        const batch = db.batch();
        for (const occurrence of group) {
          const instants = meetingInstants({
            date: occurrence.date,
            startTime: parent.startTime,
            endTime: parent.endTime,
            timeZone: parent.timeZone,
          });
          const instanceRef = db.collection(OFFICE_HUB_COLLECTIONS.meetings).doc();

          const { id, createdAt, updatedAt, momStage, startedAt, endedAt, ...rest } = parent;
          void id;
          void createdAt;
          void updatedAt;
          void momStage;
          void startedAt;
          void endedAt;

          batch.set(instanceRef, {
            ...rest,
            date: occurrence.date,
            startAt: instants.startAt,
            endAt: instants.endAt,
            seriesId,
            isSeriesParent: false,
            occurrenceKey: occurrence.occurrenceKey,
            occurrenceNumber: occurrence.occurrenceNumber,
            status: 'Scheduled',
            momStage: null,
            startedAt: null,
            endedAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            createdByName: 'Office Hub (scheduled job)',
          });

          for (const participant of participants) {
            const { id: participantId, meetingId, response, respondedAt, attendance, ...participantRest } =
              participant as Record<string, unknown> & { id: string };
            void participantId;
            void meetingId;
            void response;
            void respondedAt;
            void attendance;

            batch.set(
              db
                .collection(OFFICE_HUB_COLLECTIONS.participants)
                .doc(`${instanceRef.id}_${String(participantRest.userId)}`),
              {
                ...participantRest,
                meetingId: instanceRef.id,
                seriesId,
                // A new instance starts unanswered: last month's acceptance is not an answer about
                // next month's meeting.
                response: 'No Response',
                responseMessage: null,
                respondedAt: null,
                attendance: null,
                remindersSent: 0,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              },
            );
          }
          result.seriesInstancesCreated += 1;
        }
        await batch.commit();
      }

      void logServerActivity({
        userId: 'system',
        userName: 'Office Hub (scheduled job)',
        module: ACTIVITY_MODULES.OFFICE_HUB,
        action: 'Generate Recurring Instances',
        details: { seriesId, created: pending.length },
        recordId: seriesId,
        recordRef: parent.title,
      });
    } catch (error) {
      console.error('[office-hub] Series top-up failed', parent.id, error);
      result.errors.push(`series ${parent.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/* ── the sweep ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Run every scheduled job, in order, and report what happened.
 *
 * Each step is wrapped so that one failing does not abandon the rest: a broken series rule must not
 * stop today's meeting reminders going out. Failures are collected into `errors` and returned, so
 * the cron provider's log says what went wrong rather than just that something did.
 */
export async function runOfficeHubSweep(options: { now?: Date; only?: string[] } = {}): Promise<SweepResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const db = getFirebaseAdminFirestore();

  const result: SweepResult = {
    remindersDelivered: 0,
    remindersLapsed: 0,
    remindersFailed: 0,
    statusesAdvanced: 0,
    overdueTasksNotified: 0,
    dueItemsNotified: 0,
    seriesInstancesCreated: 0,
    emailsSent: 0,
    durationMs: 0,
    errors: [],
  };

  await ensureEmailProvider();
  const settings = await loadSettings(db);
  const preferences = new PreferenceCache(db, settings);

  const steps: { name: string; run: () => Promise<void> }[] = [
    { name: 'reminders', run: () => deliverReminders(db, preferences, now, result) },
    { name: 'statuses', run: () => advanceMeetingStatuses(db, now, result) },
    { name: 'overdue-tasks', run: () => notifyOverdueTasks(db, settings, preferences, now, result) },
    { name: 'due-items', run: () => notifyDueItems(db, settings, preferences, now, result) },
    { name: 'series', run: () => topUpSeries(db, now, result) },
  ];

  for (const step of steps) {
    if (options.only?.length && !options.only.includes(step.name)) continue;
    try {
      await step.run();
    } catch (error) {
      console.error(`[office-hub] Sweep step "${step.name}" failed`, error);
      result.errors.push(`${step.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}
