import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allowsNotification,
  buildMeetingReminders,
  buildTaskReminders,
  decisionNotificationCopy,
  dueDecisionNotices,
  dueReminders,
  effectivePreferences,
  lapsedReminders,
  meetingNotificationCopy,
  overdueTaskNotices,
  preferenceKeyForType,
  reminderId,
  reminderNotificationType,
  resolveMeetingReminderOffsets,
  sweepToday,
  OFFICE_HUB_NOTIFICATION_TYPES,
} from '../src/lib/office-hub-reminders.ts';

const meeting = {
  id: 'm1',
  title: 'Finance Review',
  date: '2026-09-21',
  startTime: '10:00',
  timeZone: 'Asia/Kolkata',
  startAt: '2026-09-21T04:30:00.000Z',
  status: 'Scheduled',
  seriesId: null,
  organizationId: null,
  organizerName: 'Asha',
  mode: 'Online',
};

/* ── ids and preferences ───────────────────────────────────────────────────────────────────────── */

test('reminder ids are deterministic so re-saving a meeting moves rows instead of adding them', () => {
  const first = reminderId('meeting', 'm1', 'u-ben', 'meeting-reminder', 15);
  const again = reminderId('meeting', 'm1', 'u-ben', 'meeting-reminder', 15);
  assert.equal(first, again);
  assert.notEqual(first, reminderId('meeting', 'm1', 'u-ben', 'meeting-reminder', 30));
  assert.notEqual(first, reminderId('meeting', 'm1', 'u-asha', 'meeting-reminder', 15));
  assert.equal(reminderId('task', 't1', 'u-ben', 'task-overdue', null), 'task_t1_u-ben_task-overdue_na');
});

test('an office switch can withdraw a channel but cannot force one on', () => {
  const defaults = effectivePreferences(null, null);
  assert.equal(defaults.meetingInvitations, true);
  assert.equal(defaults.email, true);
  assert.equal(defaults.browser, false, 'browser notifications are opt-in');

  const emailOff = effectivePreferences({ notifications: { email: true } }, { emailNotificationsEnabled: false });
  assert.equal(emailOff.email, false, 'no transport configured means no email, whatever the user asked for');

  const userOptedOut = effectivePreferences({ notifications: { email: false } }, { emailNotificationsEnabled: true });
  assert.equal(userOptedOut.email, false, 'a configured transport does not override the user');

  const chosen = effectivePreferences({ notifications: { overdueAlerts: false, browser: true } }, { browserNotificationsEnabled: true });
  assert.equal(chosen.overdueAlerts, false);
  assert.equal(chosen.browser, true);
  assert.equal(chosen.mentions, true, 'unspecified switches keep their default');
});

test('the organizer\'s choice beats the user default, which beats the office default', () => {
  assert.deepEqual(
    resolveMeetingReminderOffsets({ reminderOffsets: [60, 10] }, { defaultReminderOffsets: [15] }, null),
    [60, 10],
    'sorted furthest-out first',
  );
  assert.deepEqual(
    resolveMeetingReminderOffsets({ reminderOffsets: [] }, { defaultReminderOffsets: [30] }, null),
    [30],
  );
  assert.deepEqual(resolveMeetingReminderOffsets({ reminderOffsets: [] }, null, null), [15]);
  assert.deepEqual(
    resolveMeetingReminderOffsets({ reminderOffsets: [] }, null, { defaultReminderOffsets: [120, 120, 5] }),
    [120, 5],
    'duplicates collapse',
  );
});

/* ── meeting reminders ─────────────────────────────────────────────────────────────────────────── */

test('buildMeetingReminders writes one row per person per offset, and skips the past', () => {
  const now = new Date('2026-09-20T00:00:00Z');
  const rows = buildMeetingReminders({
    meeting,
    recipients: [
      { userId: 'u-asha', offsets: [1440, 60, 0], wantsReminders: true },
      { userId: 'u-ben', offsets: [15], wantsReminders: true },
      { userId: 'u-chen', offsets: [15], wantsReminders: false },
    ],
    now,
  });

  const asha = rows.filter((row) => row.userId === 'u-asha');
  // The 1440-minute (1 day) reminder would have fired at 2026-09-20T04:30Z, which is in the future
  // relative to `now`, so all three survive.
  assert.deepEqual(asha.map((row) => row.offsetMinutes), [1440, 60, 0]);
  assert.equal(asha[0].scheduledAt, '2026-09-20T04:30:00.000Z');
  assert.equal(asha[2].kind, 'meeting-starting', 'offset 0 is a different notification');
  assert.equal(asha[0].kind, 'meeting-reminder');
  assert.equal(asha[0].status, 'Scheduled');
  assert.equal(asha[0].link, '/office-hub/meetings/m1');

  assert.equal(rows.filter((row) => row.userId === 'u-ben').length, 1);
  assert.equal(rows.some((row) => row.userId === 'u-chen'), false, 'reminders switched off means no row at all');
});

test('a reminder whose moment has already gone is not scheduled', () => {
  // Two hours before the meeting: the "1 day before" and "2 hours before" offsets are already past.
  const now = new Date('2026-09-21T02:30:00Z');
  const rows = buildMeetingReminders({
    meeting,
    recipients: [{ userId: 'u-asha', offsets: [1440, 120, 60, 15], wantsReminders: true }],
    now,
  });
  assert.deepEqual(rows.map((row) => row.offsetMinutes), [60, 15]);
});

test('a cancelled or completed meeting has no reminders', () => {
  const now = new Date('2026-09-20T00:00:00Z');
  const recipients = [{ userId: 'u-asha', offsets: [60], wantsReminders: true }];
  assert.deepEqual(buildMeetingReminders({ meeting: { ...meeting, status: 'Cancelled' }, recipients, now }), []);
  assert.deepEqual(buildMeetingReminders({ meeting: { ...meeting, status: 'Completed' }, recipients, now }), []);
});

/* ── task reminders ────────────────────────────────────────────────────────────────────────────── */

test('task reminders fire in the assignee\'s own morning, not 24h before a date', () => {
  const task = { id: 't1', title: 'Prepare report', dueDate: '2026-09-25', status: 'In Progress', assigneeId: 'u-ben' };
  const rows = buildTaskReminders({
    task,
    recipients: [
      { userId: 'u-ben', timeZone: 'Asia/Kolkata', wantsReminders: true },
      { userId: 'u-lon', timeZone: 'Europe/London', wantsReminders: true },
      { userId: 'u-off', timeZone: 'Asia/Kolkata', wantsReminders: false },
    ],
    daysBefore: [3, 1],
    now: new Date('2026-09-18T00:00:00Z'),
  });

  const ben = rows.filter((row) => row.userId === 'u-ben');
  assert.deepEqual(ben.map((row) => row.kind), ['task-due-soon', 'task-due-soon', 'task-due-today']);
  // 09:00 IST on 22 Sep = 03:30 UTC.
  assert.equal(ben[0].scheduledAt, '2026-09-22T03:30:00.000Z');
  // 09:00 BST on 22 Sep = 08:00 UTC — the same local morning, a different instant.
  const london = rows.filter((row) => row.userId === 'u-lon');
  assert.equal(london[0].scheduledAt, '2026-09-22T08:00:00.000Z');

  assert.equal(rows.some((row) => row.userId === 'u-off'), false);

  assert.deepEqual(
    buildTaskReminders({ task: { ...task, status: 'Completed' }, recipients: [{ userId: 'u-ben', wantsReminders: true }] }),
    [],
  );
  assert.deepEqual(
    buildTaskReminders({ task: { ...task, dueDate: null }, recipients: [{ userId: 'u-ben', wantsReminders: true }] }),
    [],
  );
});

test('the overdue sweep nags once a day, not once per run', () => {
  const now = new Date('2026-09-18T06:00:00Z');
  const tasks = [
    { id: 't1', title: 'Late', status: 'In Progress', dueDate: '2026-09-11', assigneeId: 'u-ben', watcherUserIds: ['u-asha'], lastOverdueNoticeAt: null },
    { id: 't2', title: 'Just told them', status: 'In Progress', dueDate: '2026-09-11', assigneeId: 'u-ben', lastOverdueNoticeAt: '2026-09-18T01:00:00.000Z' },
    { id: 't3', title: 'Told yesterday', status: 'In Progress', dueDate: '2026-09-11', assigneeId: 'u-ben', lastOverdueNoticeAt: '2026-09-17T05:00:00.000Z' },
    { id: 't4', title: 'Not late', status: 'In Progress', dueDate: '2026-09-25', assigneeId: 'u-ben' },
    { id: 't5', title: 'Done', status: 'Completed', dueDate: '2026-01-01', assigneeId: 'u-ben' },
    { id: 't6', title: 'Nobody owns it', status: 'In Progress', dueDate: '2026-09-01', assigneeId: null },
  ];

  const notices = overdueTaskNotices({ tasks, today: '2026-09-18', now });
  assert.deepEqual(notices.map((notice) => notice.task.id), ['t1', 't3']);
  assert.deepEqual(notices[0].recipients.sort(), ['u-asha', 'u-ben'], 'watchers hear about it too');
  assert.equal(notices[0].overdueDays, 7);
});

test('decision and action-item notices cover what is due soon and what is late', () => {
  const rows = dueDecisionNotices({
    decisions: [
      { id: 'd1', title: 'Approve overdraft', reference: 'DEC-1', status: 'Open', dueDate: '2026-09-15', ownerId: 'u-asha' },
      { id: 'd2', title: 'Later', reference: 'DEC-2', status: 'Open', dueDate: '2026-09-19', ownerId: 'u-asha' },
      { id: 'd3', title: 'Far off', reference: 'DEC-3', status: 'Open', dueDate: '2026-10-19', ownerId: 'u-asha' },
      { id: 'd4', title: 'Closed', reference: 'DEC-4', status: 'Completed', dueDate: '2026-09-01', ownerId: 'u-asha' },
      { id: 'd5', title: 'Unowned', reference: 'DEC-5', status: 'Open', dueDate: '2026-09-01', ownerId: null },
    ],
    actionItems: [
      { id: 'a1', title: 'Bank report', reference: 'ACT-1', status: 'Open', dueDate: '2026-09-17', responsibleUserId: 'u-ben', meetingId: 'm1' },
      { id: 'a2', title: 'No owner', reference: 'ACT-2', status: 'Open', dueDate: '2026-09-17', responsibleUserId: null, meetingId: 'm1' },
    ],
    today: '2026-09-18',
  });

  assert.deepEqual(rows.map((row) => row.id), ['d1', 'd2', 'a1']);
  assert.equal(rows[0].overdue, true);
  assert.equal(rows[1].overdue, false);
  assert.equal(rows[2].link, '/office-hub/meetings/m1');
});

/* ── the sweep ─────────────────────────────────────────────────────────────────────────────────── */

test('dueReminders delivers what is due and drops what went stale', () => {
  const now = new Date('2026-09-21T04:30:00Z');
  const rows = [
    { id: 'r1', scheduledAt: '2026-09-21T04:29:00.000Z', status: 'Scheduled' },
    { id: 'r2', scheduledAt: '2026-09-21T03:30:00.000Z', status: 'Scheduled' },
    { id: 'r3', scheduledAt: '2026-09-21T05:30:00.000Z', status: 'Scheduled' },
    { id: 'r4', scheduledAt: '2026-09-20T04:30:00.000Z', status: 'Scheduled' },
    { id: 'r5', scheduledAt: '2026-09-21T04:00:00.000Z', status: 'Sent' },
  ];

  const due = dueReminders(rows, now);
  assert.deepEqual(due.map((row) => row.id), ['r2', 'r1'], 'oldest first, and r4 is beyond the grace window');
  assert.equal(due.some((row) => row.id === 'r3'), false, 'not due yet');
  assert.equal(due.some((row) => row.id === 'r5'), false, 'already sent');

  const lapsed = lapsedReminders(rows, now);
  assert.deepEqual(lapsed.map((row) => row.id), ['r4'], 'closed out rather than delivered a day late');

  assert.equal(dueReminders(rows, now, { limit: 1 }).length, 1);
});

test('sweepToday reads the date in the office zone', () => {
  assert.equal(sweepToday(null, new Date('2026-09-18T20:00:00Z')), '2026-09-19', 'IST is already tomorrow');
  assert.equal(sweepToday({ defaultTimeZone: 'Europe/London' }, new Date('2026-09-18T20:00:00Z')), '2026-09-18');
});

/* ── notification routing and copy ─────────────────────────────────────────────────────────────── */

test('every reminder kind maps to a notification type', () => {
  assert.equal(reminderNotificationType('meeting-reminder'), OFFICE_HUB_NOTIFICATION_TYPES.MEETING_REMINDER);
  assert.equal(reminderNotificationType('meeting-starting'), OFFICE_HUB_NOTIFICATION_TYPES.MEETING_STARTING);
  assert.equal(reminderNotificationType('task-due-today'), OFFICE_HUB_NOTIFICATION_TYPES.TASK_DUE_SOON);
  assert.equal(reminderNotificationType('task-overdue'), OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE);
  assert.equal(reminderNotificationType('decision-due'), OFFICE_HUB_NOTIFICATION_TYPES.DECISION_DUE);
});

test('a switch cannot hide a cancellation', () => {
  assert.equal(preferenceKeyForType(OFFICE_HUB_NOTIFICATION_TYPES.MEETING_INVITATION), 'meetingInvitations');
  assert.equal(preferenceKeyForType(OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE), 'overdueAlerts');
  assert.equal(preferenceKeyForType(OFFICE_HUB_NOTIFICATION_TYPES.MEETING_CANCELLED), 'meetingChanges');
  assert.equal(
    preferenceKeyForType(OFFICE_HUB_NOTIFICATION_TYPES.MOM_PUBLISHED),
    null,
    'not optional — there is no switch for it',
  );

  const silenced = effectivePreferences({ notifications: { overdueAlerts: false, meetingChanges: false } }, null);
  assert.equal(allowsNotification(OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE, silenced), false);
  assert.equal(allowsNotification(OFFICE_HUB_NOTIFICATION_TYPES.MEETING_CANCELLED, silenced), false);
  assert.equal(
    allowsNotification(OFFICE_HUB_NOTIFICATION_TYPES.MOM_PUBLISHED, silenced),
    true,
    'an ungoverned type always gets through',
  );
});

test('notification copy names the thing and carries a working deep link', () => {
  const invitation = meetingNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.MEETING_INVITATION, meeting);
  assert.equal(invitation.title, 'Meeting invitation: Finance Review');
  assert.match(invitation.body, /Asha invited you/);
  assert.equal(invitation.link, '/office-hub/meetings/m1');

  const reminder = meetingNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.MEETING_REMINDER, meeting, {
    now: new Date('2026-09-21T04:15:00Z'),
  });
  assert.equal(reminder.title, 'Finance Review starts in 15 minutes');

  const cancelled = meetingNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.MEETING_CANCELLED, meeting, {
    actorName: 'Asha',
    reason: 'quorum not available',
  });
  assert.match(cancelled.body, /quorum not available/);
  assert.equal(cancelled.severity, 'WARNING');

  const published = meetingNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.MOM_PUBLISHED, meeting);
  assert.equal(published.link, '/office-hub/meetings/m1/mom');

  const decision = decisionNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.DECISION_DUE, {
    id: 'd1',
    title: 'Approve overdraft',
    reference: 'DEC-2627-0001',
    dueDate: '2026-09-15',
    meetingTitle: 'Finance Review',
  }, { overdue: true });
  assert.match(decision.title, /^Decision overdue/);
  assert.equal(decision.severity, 'WARNING');
});

test('overdue notification severity escalates with age, because nothing else will', async () => {
  const { taskNotificationCopy } = await import('../src/lib/office-hub-reminders.ts');
  const task = { id: 't1', title: 'Prepare report', reference: 'TSK-2627-0041', dueDate: '2026-09-11', priority: 'Medium', meetingTitle: null };

  assert.equal(taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE, task, { overdueDays: 2 }).severity, 'WARNING');
  assert.equal(taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_OVERDUE, task, { overdueDays: 20 }).severity, 'CRITICAL');

  const assigned = taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_ASSIGNED, { ...task, meetingTitle: 'Finance Review' }, { actorName: 'Asha' });
  assert.match(assigned.body, /Asha assigned you TSK-2627-0041/);
  assert.match(assigned.body, /From Finance Review/, 'the source meeting is named — §23');

  const critical = taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_ASSIGNED, { ...task, priority: 'Critical' }, {});
  assert.equal(critical.severity, 'WARNING');

  const comment = taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_MENTION, task, {
    actorName: 'Ben',
    comment: 'x'.repeat(200),
  });
  assert.ok(comment.body.length < 160, 'long comments are truncated for the bell');
});
