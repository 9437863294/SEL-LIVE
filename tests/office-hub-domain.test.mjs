import test from 'node:test';
import assert from 'node:assert/strict';

// Imported from the pure modules rather than `office-hub.ts`, which re-exports Firestore-client
// types that only resolve inside the bundler.
import {
  addDays,
  addMonths,
  clockSpanMinutes,
  clockToMinutes,
  daysBetween,
  endOfMonth,
  formatClockTime,
  formatDuration,
  formatIsoDate,
  formatRelativeToNow,
  isClockTime,
  isIsoDate,
  isKnownTimeZone,
  minutesToClock,
  nthWeekdayOfMonth,
  startOfWeek,
  todayInZone,
  utcToZonedParts,
  weekdayOf,
  zoneOffsetMinutes,
  zonedTimeToUtc,
  OFFICE_HUB_DEFAULT_TIME_ZONE,
} from '../src/lib/office-hub-time.ts';

import {
  agendaFitsMeeting,
  buildFollowUpDraft,
  buildMomDocument,
  buildTeamDashboard,
  buildWorkload,
  canCompleteTask,
  canPublishMom,
  dependencyEdges,
  dependencyWouldCycle,
  describeResponses,
  describeTaskChanges,
  expandParticipantSelection,
  extractMentions,
  formatFileSize,
  htmlToPlainText,
  isActionItemOverdue,
  isTaskOverdue,
  meetingDurationMinutes,
  meetingInstants,
  meetingJoinView,
  meetingPreparationState,
  meetingTimeState,
  nextMomStage,
  normalizeTeamMembers,
  officeHubFinancialYear,
  officeHubReference,
  officeHubStoragePath,
  postMeetingSummary,
  prefillAttendance,
  previousActionItemsFor,
  reorderAgenda,
  deriveMeetingStatus,
  stripMentionMarkup,
  subtaskCompletion,
  summarizeAttendance,
  summarizeResponses,
  taskBlockers,
  taskDraftFromActionItem,
  taskDueBucket,
  taskOverdueDays,
  taskProgress,
  validateActionItemInput,
  validateDecisionInput,
  validateMeetingInput,
  validateOfficeHubUpload,
  validateTaskInput,
  validateTeamInput,
  isWorkingDay,
  holidayOn,
} from '../src/lib/office-hub-rules.ts';

import {
  resolveOfficeHubCapabilities,
  canEditMeeting,
  canCancelMeeting,
  canRecordAttendance,
  canRespondToInvitation,
  canAdvanceMinutes,
  canViewMeeting,
  canViewTask,
  canEditTask,
  canCompleteTaskAs,
  canManageTeamMembers,
  widestMeetingScope,
  widestTaskScope,
  isManualMeetingStatusChangeAllowed,
} from '../src/lib/office-hub-permissions.ts';

/* ── time ──────────────────────────────────────────────────────────────────────────────────────── */

test('iso date and clock validation reject malformed and impossible values', () => {
  assert.equal(isIsoDate('2026-09-18'), true);
  assert.equal(isIsoDate('2026-02-31'), false, '31 February is not a date');
  assert.equal(isIsoDate('2026-13-01'), false);
  assert.equal(isIsoDate('18-09-2026'), false);
  assert.equal(isIsoDate(null), false);

  assert.equal(isClockTime('09:30'), true);
  assert.equal(isClockTime('9:30'), true);
  assert.equal(isClockTime('24:00'), false);
  assert.equal(isClockTime('10:60'), false);
  assert.equal(clockToMinutes('10:15'), 615);
  assert.equal(minutesToClock(615), '10:15');
  // Wraps rather than producing "26:00", so a duration cannot push a time out of the day.
  assert.equal(minutesToClock(1500), '01:00');
});

test('zonedTimeToUtc converts Asia/Kolkata wall clock to the right instant', () => {
  const instant = zonedTimeToUtc('2026-09-18', '10:00', 'Asia/Kolkata');
  // IST is UTC+5:30 all year.
  assert.equal(instant.toISOString(), '2026-09-18T04:30:00.000Z');
  assert.equal(zoneOffsetMinutes(instant, 'Asia/Kolkata'), 330);
});

test('zonedTimeToUtc keeps the local hour across a DST transition', () => {
  // Europe/London springs forward on 29 March 2026 and back on 25 October 2026. A 09:00 meeting is
  // 09:00 local on both sides of each boundary, which is the whole point of storing the wall clock.
  const beforeSpring = zonedTimeToUtc('2026-03-28', '09:00', 'Europe/London');
  const afterSpring = zonedTimeToUtc('2026-03-30', '09:00', 'Europe/London');
  assert.equal(beforeSpring.toISOString(), '2026-03-28T09:00:00.000Z', 'GMT: offset 0');
  assert.equal(afterSpring.toISOString(), '2026-03-30T08:00:00.000Z', 'BST: offset +1');

  assert.equal(utcToZonedParts(beforeSpring, 'Europe/London').time, '09:00');
  assert.equal(utcToZonedParts(afterSpring, 'Europe/London').time, '09:00');
});

test('an unknown time zone falls back to the office default instead of throwing', () => {
  assert.equal(isKnownTimeZone('Asia/Kolkata'), true);
  assert.equal(isKnownTimeZone('Mars/Olympus_Mons'), false);
  const fallback = zonedTimeToUtc('2026-09-18', '10:00', 'Mars/Olympus_Mons');
  assert.equal(fallback.toISOString(), '2026-09-18T04:30:00.000Z');
  assert.equal(OFFICE_HUB_DEFAULT_TIME_ZONE, 'Asia/Kolkata');
});

test('calendar arithmetic clamps month ends and never drifts a day', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28', '31 Jan + 1 month clamps to 28 Feb');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29', 'and to 29 Feb in a leap year');
  assert.equal(endOfMonth('2026-02-10'), '2026-02-28');
  assert.equal(daysBetween('2026-09-18', '2026-09-25'), 7);
  assert.equal(daysBetween('2026-09-25', '2026-09-18'), -7);
  assert.equal(weekdayOf('2026-09-18'), 5, '18 Sep 2026 is a Friday');
  assert.equal(startOfWeek('2026-09-18'), '2026-09-14', 'Monday-based week');
});

test('nthWeekdayOfMonth finds ordinals and the last occurrence', () => {
  assert.equal(nthWeekdayOfMonth('2026-09-01', 1, 1), '2026-09-07', 'first Monday of Sep 2026');
  assert.equal(nthWeekdayOfMonth('2026-09-01', 5, -1), '2026-09-25', 'last Friday of Sep 2026');
  assert.equal(nthWeekdayOfMonth('2026-09-01', 1, 5), null, 'no fifth Monday in Sep 2026');
});

test('display helpers produce stable strings on server and client', () => {
  assert.equal(formatIsoDate('2026-09-18'), '18 Sep 2026');
  assert.equal(formatIsoDate('2026-09-18', { withWeekday: true }), 'Fri, 18 Sep 2026');
  assert.equal(formatIsoDate('nonsense'), '—');
  assert.equal(formatClockTime('14:05'), '2:05 PM');
  assert.equal(formatClockTime('00:30'), '12:30 AM');
  assert.equal(formatDuration(90), '1h 30m');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(0), '—');
  assert.equal(clockSpanMinutes('10:00', '11:30'), 90);

  const now = new Date('2026-09-18T10:00:00Z');
  assert.equal(formatRelativeToNow(new Date('2026-09-18T10:20:00Z'), now), 'in 20 minutes');
  assert.equal(formatRelativeToNow(new Date('2026-09-16T10:00:00Z'), now), '2 days ago');
  assert.equal(todayInZone('Asia/Kolkata', new Date('2026-09-18T20:00:00Z')), '2026-09-19');
});

/* ── meeting time and status ───────────────────────────────────────────────────────────────────── */

const baseMeeting = {
  id: 'm1',
  title: 'Finance Review',
  meetingType: 'Finance',
  priority: 'High',
  status: 'Scheduled',
  date: '2026-09-21',
  startTime: '10:00',
  endTime: '11:00',
  timeZone: 'Asia/Kolkata',
  startAt: '2026-09-21T04:30:00.000Z',
  endAt: '2026-09-21T05:30:00.000Z',
  mode: 'Online',
  onlinePlatform: 'Microsoft Teams',
  meetingUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
  organizerId: 'u-organizer',
  organizerName: 'Asha',
  participantUserIds: ['u-organizer', 'u-member'],
  requiredUserIds: ['u-organizer'],
  departmentIds: ['d-finance'],
  teamIds: [],
  responseSummary: { accepted: 1, maybe: 0, declined: 0, noResponse: 1 },
  participantCount: 2,
  reminderOffsets: [15],
  recurrence: { frequency: 'None', interval: 1, endMode: 'never' },
};

test('meetingInstants derives instants from the wall clock, and handles a run past midnight', () => {
  assert.deepEqual(meetingInstants(baseMeeting), {
    startAt: '2026-09-21T04:30:00.000Z',
    endAt: '2026-09-21T05:30:00.000Z',
  });

  const overnight = meetingInstants({ ...baseMeeting, startTime: '23:00', endTime: '01:00' });
  assert.equal(overnight.startAt, '2026-09-21T17:30:00.000Z');
  assert.equal(overnight.endAt, '2026-09-21T19:30:00.000Z', 'end rolls into the next day');
  assert.equal(meetingDurationMinutes({ startTime: '23:00', endTime: '01:00' }), 120);
});

test('deriveMeetingStatus advances on the clock but never reopens a terminal meeting', () => {
  const before = new Date('2026-09-21T04:00:00Z');
  const during = new Date('2026-09-21T05:00:00Z');
  const after = new Date('2026-09-21T06:00:00Z');

  assert.equal(deriveMeetingStatus(baseMeeting, before), 'Scheduled');
  assert.equal(deriveMeetingStatus(baseMeeting, during), 'In Progress');
  assert.equal(deriveMeetingStatus(baseMeeting, after), 'Completed');

  // The three it must never touch.
  assert.equal(deriveMeetingStatus({ ...baseMeeting, status: 'Cancelled' }, during), 'Cancelled');
  assert.equal(deriveMeetingStatus({ ...baseMeeting, status: 'Postponed' }, after), 'Postponed');
  assert.equal(deriveMeetingStatus({ ...baseMeeting, status: 'Draft' }, during), 'Draft');
});

test('meetingTimeState distinguishes starting-soon from upcoming', () => {
  assert.equal(meetingTimeState(baseMeeting, new Date('2026-09-21T03:00:00Z')), 'upcoming');
  assert.equal(meetingTimeState(baseMeeting, new Date('2026-09-21T04:20:00Z')), 'starting-soon');
  assert.equal(meetingTimeState(baseMeeting, new Date('2026-09-21T05:00:00Z')), 'live');
  assert.equal(meetingTimeState(baseMeeting, new Date('2026-09-21T09:00:00Z')), 'ended');
});

/* ── meeting validation ────────────────────────────────────────────────────────────────────────── */

test('validateMeetingInput enforces §57 and lets a draft through on a title alone', () => {
  const now = new Date('2026-09-18T04:00:00Z');

  const valid = validateMeetingInput(
    {
      title: 'Finance Review',
      meetingType: 'Finance',
      date: '2026-09-21',
      startTime: '10:00',
      endTime: '11:00',
      timeZone: 'Asia/Kolkata',
      mode: 'Online',
      meetingUrl: 'https://teams.microsoft.com/x',
      onlinePlatform: 'Microsoft Teams',
      organizerId: 'u1',
      participantUserIds: ['u1'],
    },
    { now },
  );
  assert.deepEqual(valid, {});

  const backwards = validateMeetingInput(
    { ...valid, title: 'x', meetingType: 'Finance', date: '2026-09-21', startTime: '14:00', endTime: '13:00', mode: 'Offline', location: 'Room 1', organizerId: 'u1', participantUserIds: ['u1'] },
    { now },
  );
  assert.equal(backwards.endTime, 'End time must be after the start time.');

  const online = validateMeetingInput(
    { title: 'x', meetingType: 'Finance', date: '2026-09-21', startTime: '10:00', endTime: '11:00', mode: 'Online', organizerId: 'u1', participantUserIds: ['u1'] },
    { now },
  );
  assert.equal(online.meetingUrl, 'An online meeting needs a joining link.');
  assert.ok(online.onlinePlatform);

  const past = validateMeetingInput(
    { title: 'x', meetingType: 'Finance', date: '2026-09-01', startTime: '10:00', endTime: '11:00', mode: 'Offline', location: 'Room 1', organizerId: 'u1', participantUserIds: ['u1'] },
    { now },
  );
  assert.match(past.date, /in the past/);

  const noOne = validateMeetingInput(
    { title: 'x', meetingType: 'Finance', date: '2026-09-21', startTime: '10:00', endTime: '11:00', mode: 'Offline', location: 'Room 1', organizerId: 'u1', participantUserIds: [] },
    { now },
  );
  assert.equal(noOne.participants, 'Invite at least one participant.');

  // A draft needs only a title — that is the point of a draft.
  assert.deepEqual(validateMeetingInput({ title: 'Later', status: 'Draft' }, { now }), {});
  assert.ok(validateMeetingInput({ status: 'Draft' }, { now }).title);
});

/* ── participants ──────────────────────────────────────────────────────────────────────────────── */

const directory = {
  people: [
    { userId: 'u-asha', name: 'Asha', departmentId: 'd-finance', departmentName: 'Finance', designation: 'Finance Manager' },
    { userId: 'u-ben', name: 'Ben', departmentId: 'd-finance', departmentName: 'Finance' },
    { userId: 'u-chen', name: 'Chen', departmentId: 'd-projects', departmentName: 'Projects' },
    { userId: 'u-dia', name: 'Dia', departmentId: 'd-hr', departmentName: 'HR' },
  ],
  teams: [
    {
      id: 't-project',
      name: 'Project Team',
      status: 'Active',
      leaderId: 'u-chen',
      members: [
        { userId: 'u-chen', name: 'Chen', isLeader: true },
        { userId: 'u-ben', name: 'Ben' },
      ],
    },
    { id: 't-archived', name: 'Old Team', status: 'Archived', leaderId: 'u-dia', members: [{ userId: 'u-dia', name: 'Dia' }] },
    { id: 't-empty', name: 'New Team', status: 'Active', leaderId: 'u-dia', members: [] },
  ],
  departments: [
    { id: 'd-finance', name: 'Finance', status: 'Active' },
    { id: 'd-projects', name: 'Projects', status: 'Active' },
    { id: 'd-closed', name: 'Closed Dept', status: 'Inactive' },
  ],
};

test('expandParticipantSelection never duplicates a person reached through several selectors', () => {
  const { participants } = expandParticipantSelection(
    { userIds: ['u-asha'], teamIds: ['t-project'], departmentIds: ['d-finance'] },
    directory,
    { userId: 'u-asha', name: 'Asha' },
  );

  const ids = participants.map((p) => p.userId).sort();
  assert.deepEqual(ids, ['u-asha', 'u-ben', 'u-chen'], 'Ben is in both Finance and the Project Team, once');
  assert.equal(new Set(ids).size, ids.length);

  // The organizer is present, attributed to Organizer, and required.
  const organizer = participants.find((p) => p.userId === 'u-asha');
  assert.equal(organizer.source, 'Organizer');
  assert.equal(organizer.attendanceRole, 'Required');

  // First selector to name someone keeps the attribution: Ben came via the team, listed first.
  assert.equal(participants.find((p) => p.userId === 'u-ben').source, 'Team');
  assert.equal(participants.find((p) => p.userId === 'u-ben').sourceName, 'Project Team');
});

test('required beats optional when a person is reached both ways', () => {
  const { participants } = expandParticipantSelection(
    { userIds: ['u-ben'], teamIds: ['t-project'], departmentIds: [], optionalUserIds: ['u-ben'] },
    directory,
    null,
  );
  // Ben is picked individually as optional, then reached as a required team member.
  assert.equal(participants.find((p) => p.userId === 'u-ben').attendanceRole, 'Required');
});

test('expansion warns about archived teams, empty teams and inactive departments', () => {
  const { participants, warnings } = expandParticipantSelection(
    { userIds: [], teamIds: ['t-archived', 't-empty'], departmentIds: ['d-closed'] },
    directory,
    null,
  );
  assert.deepEqual(participants, []);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((w) => w.includes('Old Team') && w.includes('archived')));
  assert.ok(warnings.some((w) => w.includes('New Team') && w.includes('no members')));
  assert.ok(warnings.some((w) => w.includes('Closed Dept') && w.includes('inactive')));
});

test('response and attendance summaries count what the register shows', () => {
  const participants = [
    { response: 'Accepted', attendance: 'Present' },
    { response: 'Accepted', attendance: 'Late' },
    { response: 'Maybe', attendance: null },
    { response: 'Declined', attendance: 'Absent' },
    { response: 'No Response', attendance: 'Excused' },
  ];

  assert.deepEqual(summarizeResponses(participants), {
    accepted: 2,
    maybe: 1,
    declined: 1,
    noResponse: 1,
  });
  assert.equal(describeResponses(summarizeResponses(participants)), '2 accepted · 1 maybe · 1 declined · 1 awaiting');

  const attendance = summarizeAttendance(participants);
  assert.equal(attendance.present, 1);
  assert.equal(attendance.late, 1);
  assert.equal(attendance.unmarked, 1);
  assert.equal(attendance.invited, 5);
  assert.equal(attendance.attendanceRate, 40, '(present + late) / invited');
});

test('prefillAttendance starts from the most likely answer, not from blank', () => {
  const draft = prefillAttendance([
    { id: 'p1', userId: 'u1', response: 'Accepted', attendance: null, attendanceRole: 'Required' },
    { id: 'p2', userId: 'u2', response: 'Declined', attendance: null, attendanceRole: 'Required' },
    { id: 'p3', userId: 'u3', response: 'No Response', attendance: null, attendanceRole: 'Optional' },
    { id: 'p4', userId: 'u4', response: 'Accepted', attendance: 'Late', attendanceRole: 'Required' },
  ]);
  assert.equal(draft.p1, 'Present');
  assert.equal(draft.p2, 'Absent', 'someone who declined is not expected');
  assert.equal(draft.p3, null, 'nobody agreed to expect an optional attendee');
  assert.equal(draft.p4, 'Late', 'an existing mark is never overwritten');
});

/* ── joining ───────────────────────────────────────────────────────────────────────────────────── */

test('the joining link is withheld from anyone who is not a participant', () => {
  const now = new Date('2026-09-21T04:20:00Z');

  const participant = meetingJoinView(baseMeeting, 'u-member', { now });
  assert.equal(participant.canJoin, true);
  assert.equal(participant.url, baseMeeting.meetingUrl);
  assert.equal(participant.emphasise, true, 'starting soon');

  const stranger = meetingJoinView(baseMeeting, 'u-stranger', { now });
  assert.equal(stranger.canJoin, false);
  assert.equal(stranger.url, null, 'the URL is the access control — it must not leak');
  assert.match(stranger.reason, /Only invited participants/);

  // Someone with View All still gets it: they are entitled to the whole register.
  const auditor = meetingJoinView(baseMeeting, 'u-stranger', { now, canViewAllMeetings: true });
  assert.equal(auditor.url, baseMeeting.meetingUrl);

  const offline = meetingJoinView(
    { ...baseMeeting, mode: 'Offline', meetingUrl: null, location: 'Board Room', room: '3rd floor' },
    'u-member',
    { now },
  );
  assert.equal(offline.canJoin, false);
  assert.equal(offline.location, 'Board Room · 3rd floor');

  const cancelled = meetingJoinView({ ...baseMeeting, status: 'Cancelled' }, 'u-member', { now });
  assert.equal(cancelled.canJoin, false);
  assert.match(cancelled.reason, /cancelled/);
});

/* ── agenda ────────────────────────────────────────────────────────────────────────────────────── */

test('reorderAgenda renumbers the whole list so no two items tie', () => {
  const items = [
    { id: 'a', order: 1 },
    { id: 'b', order: 2 },
    { id: 'c', order: 3 },
  ];
  assert.deepEqual(reorderAgenda(items, 'c', 0), [
    { id: 'c', order: 1 },
    { id: 'a', order: 2 },
    { id: 'b', order: 3 },
  ]);
  // Out-of-range targets are clamped rather than dropping the item.
  assert.deepEqual(reorderAgenda(items, 'a', 99), [
    { id: 'b', order: 1 },
    { id: 'c', order: 2 },
    { id: 'a', order: 3 },
  ]);
});

test('agendaFitsMeeting reports the overrun without blocking it', () => {
  const fit = agendaFitsMeeting([{ estimatedMinutes: 20 }, { estimatedMinutes: 30 }], baseMeeting);
  assert.deepEqual(fit, { estimated: 50, available: 60, overBy: 0, fits: true });

  const over = agendaFitsMeeting([{ estimatedMinutes: 45 }, { estimatedMinutes: 45 }], baseMeeting);
  assert.deepEqual(over, { estimated: 90, available: 60, overBy: 30, fits: false });
});

/* ── tasks ─────────────────────────────────────────────────────────────────────────────────────── */

test('taskProgress prefers subtasks and pins completed tasks to 100', () => {
  assert.equal(taskProgress({ status: 'In Progress', progress: 40, subtasks: [] }), 40);
  assert.equal(
    taskProgress({
      status: 'In Progress',
      progress: 0,
      subtasks: [{ done: true }, { done: true }, { done: false }, { done: false }],
    }),
    50,
    'subtasks override a stale hand-set value',
  );
  assert.equal(taskProgress({ status: 'Completed', progress: 10, subtasks: [{ done: false }] }), 100);
  assert.equal(taskProgress({ status: 'In Progress', progress: 999 }), 100, 'clamped');
  assert.deepEqual(subtaskCompletion([{ done: true }, { done: false }]), { done: 1, total: 2 });
});

test('overdue is a call to action, so closed and undated tasks are never overdue', () => {
  const today = '2026-09-18';
  assert.equal(isTaskOverdue({ status: 'In Progress', dueDate: '2026-09-17' }, today), true);
  assert.equal(isTaskOverdue({ status: 'In Progress', dueDate: '2026-09-18' }, today), false, 'due today is not late');
  assert.equal(isTaskOverdue({ status: 'Completed', dueDate: '2026-01-01' }, today), false);
  assert.equal(isTaskOverdue({ status: 'Cancelled', dueDate: '2026-01-01' }, today), false);
  assert.equal(isTaskOverdue({ status: 'In Progress', dueDate: null }, today), false);
  assert.equal(taskOverdueDays({ status: 'In Progress', dueDate: '2026-09-11' }, today), 7);

  assert.equal(taskDueBucket({ status: 'In Progress', dueDate: '2026-09-11' }, today), 'overdue');
  assert.equal(taskDueBucket({ status: 'In Progress', dueDate: '2026-09-18' }, today), 'due-today');
  assert.equal(taskDueBucket({ status: 'In Progress', dueDate: '2026-09-22' }, today), 'due-soon');
  assert.equal(taskDueBucket({ status: 'In Progress', dueDate: '2026-11-22' }, today), 'upcoming');
  assert.equal(taskDueBucket({ status: 'In Progress', dueDate: null }, today), 'no-due-date');
  assert.equal(taskDueBucket({ status: 'Completed', dueDate: '2026-01-01' }, today), 'closed');
});

test('validateTaskInput rejects a due date before the start date', () => {
  assert.deepEqual(
    validateTaskInput({ title: 'Prepare report', assigneeId: 'u1', startDate: '2026-09-18', dueDate: '2026-09-25' }),
    {},
  );
  const backwards = validateTaskInput({
    title: 'Prepare report',
    assigneeId: 'u1',
    startDate: '2026-09-25',
    dueDate: '2026-09-18',
  });
  assert.equal(backwards.dueDate, 'Due date cannot be before the start date.');
  assert.ok(validateTaskInput({ title: 'x' }).assigneeId, 'a task needs an owner');
  assert.deepEqual(validateTaskInput({ title: 'x' }, { allowUnassigned: true }), {});
});

test('dependencies block completion, tolerate archived tasks, and cannot form a cycle', () => {
  const task = {
    status: 'In Progress',
    dependencies: [
      { type: 'blocked-by', taskId: 't-a', taskTitle: 'Collect data' },
      { type: 'blocks', taskId: 't-c', taskTitle: 'Submit report' },
      { type: 'depends-on', taskId: 't-gone', taskTitle: 'Deleted thing' },
    ],
  };

  const open = taskBlockers(task, { 't-a': 'In Progress', 't-c': 'Not Started' });
  assert.deepEqual(open.map((d) => d.taskId), ['t-a'], '`blocks` points the other way and never blocks');

  const verdict = canCompleteTask(task, { 't-a': 'In Progress' });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /Collect data/);

  assert.equal(canCompleteTask(task, { 't-a': 'Completed' }).allowed, true, 'an unknown status is not a blocker');

  const edges = dependencyEdges([
    { id: 't-a', dependencies: [{ type: 'blocked-by', taskId: 't-b', taskTitle: 'B' }] },
    { id: 't-b', dependencies: [{ type: 'blocked-by', taskId: 't-c', taskTitle: 'C' }] },
    { id: 't-c', dependencies: [] },
  ]);
  assert.equal(dependencyWouldCycle('t-c', 't-a', edges), true, 'C waiting on A closes A→B→C→A');
  assert.equal(dependencyWouldCycle('t-a', 't-a', edges), true, 'a task cannot depend on itself');
  assert.equal(dependencyWouldCycle('t-a', 't-d', edges), false);
});

test('describeTaskChanges writes a timeline entry per real change and nothing for a no-op', () => {
  const before = { status: 'Not Started', assigneeId: 'u1', assigneeName: 'Asha', priority: 'Medium', dueDate: '2026-09-20', progress: 0 };
  const after = { status: 'In Progress', assigneeId: 'u2', assigneeName: 'Ben', priority: 'High', dueDate: '2026-09-25', progress: 30 };

  const drafts = describeTaskChanges(before, after);
  const kinds = drafts.map((d) => d.kind);
  assert.deepEqual(kinds, ['status-changed', 'reassigned', 'priority-changed', 'due-date-changed', 'progress-changed']);
  assert.match(drafts[1].summary, /Reassigned from Asha to Ben/);

  assert.deepEqual(describeTaskChanges(before, { ...before }), [], 'an edit that changed nothing writes nothing');

  const completion = describeTaskChanges({ status: 'In Progress' }, { status: 'Completed' });
  assert.equal(completion[0].kind, 'completed');

  const reopen = describeTaskChanges({ status: 'Completed' }, { status: 'In Progress' });
  assert.ok(reopen.some((d) => d.kind === 'reopened'));
});

/* ── the meeting → task chain ──────────────────────────────────────────────────────────────────── */

test('taskDraftFromActionItem carries the whole chain so nothing is retyped', () => {
  const draft = taskDraftFromActionItem(
    {
      id: 'ai-1',
      title: 'Prepare bank reconciliation',
      description: 'For August',
      responsibleUserId: 'u-ben',
      responsibleUserName: 'Ben',
      responsibleTeamId: null,
      responsibleTeamName: null,
      departmentId: 'd-finance',
      departmentName: 'Finance',
      dueDate: '2026-09-30',
      priority: 'High',
      meetingId: 'm1',
      meetingTitle: 'Finance Review',
      meetingDate: '2026-09-21',
      decisionId: 'dec-1',
    },
    '2026-09-22',
  );

  assert.equal(draft.title, 'Prepare bank reconciliation');
  assert.equal(draft.assigneeId, 'u-ben');
  assert.equal(draft.dueDate, '2026-09-30');
  assert.equal(draft.priority, 'High');
  assert.equal(draft.meetingId, 'm1');
  assert.equal(draft.actionItemId, 'ai-1');
  assert.equal(draft.decisionId, 'dec-1');
  assert.equal(draft.status, 'Not Started');
  assert.equal(draft.startDate, '2026-09-22');
});

test('previousActionItemsFor surfaces unfinished business, worst first, without repeats', () => {
  const items = [
    { id: 'a', meetingId: 'm0', status: 'Open', dueDate: '2026-09-10', priority: 'Medium', title: 'Bank report' },
    { id: 'b', meetingId: 'm0', status: 'In Progress', dueDate: '2026-09-30', priority: 'High', title: 'Project report' },
    { id: 'c', meetingId: 'm0', status: 'Completed', dueDate: '2026-09-01', priority: 'High', title: 'Vendor statement' },
    { id: 'd', meetingId: 'm0', status: 'Open', dueDate: null, priority: 'Critical', title: 'Undated' },
    { id: 'e', meetingId: 'm0', status: 'Open', dueDate: '2026-09-05', priority: 'Low', title: 'Already carried', carriedToMeetingId: 'm1' },
    { id: 'f', meetingId: 'm1', status: 'Open', dueDate: '2026-09-09', priority: 'High', title: 'Raised in this meeting' },
  ];

  const carried = previousActionItemsFor(items, 'm1', '2026-09-18');
  assert.deepEqual(carried.map((i) => i.id), ['a', 'b', 'd']);
  assert.equal(carried[0].id, 'a', 'the overdue one leads');
});

test('buildFollowUpDraft copies teams as teams, not as a frozen roster', () => {
  const participants = [
    { userId: 'u-asha', source: 'Organizer', attendanceRole: 'Required', sourceId: null },
    { userId: 'u-ben', source: 'Team', attendanceRole: 'Required', sourceId: 't-project' },
    { userId: 'u-chen', source: 'Team', attendanceRole: 'Required', sourceId: 't-project' },
    { userId: 'u-dia', source: 'Individual', attendanceRole: 'Optional', sourceId: null },
    { userId: 'u-eve', source: 'Department', attendanceRole: 'Required', sourceId: 'd-finance' },
  ];
  const agenda = [
    { id: 'a1', order: 1, title: 'Progress review', priority: 'Medium', estimatedMinutes: 20 },
    { id: 'a2', order: 2, title: 'Issues', priority: 'High', estimatedMinutes: 15 },
  ];
  const open = [{ id: 'ai-1', title: 'Bank report', status: 'Open' }];

  const draft = buildFollowUpDraft(baseMeeting, agenda, participants, open);

  assert.equal(draft.date, '2026-09-28', 'a week later by default');
  assert.equal(draft.title, 'Follow-up: Finance Review');
  assert.deepEqual(draft.selection.teamIds, ['t-project'], 'the team, not its two members');
  assert.deepEqual(draft.selection.departmentIds, ['d-finance']);
  assert.deepEqual(draft.selection.userIds.sort(), ['u-asha', 'u-dia']);
  assert.deepEqual(draft.selection.optionalUserIds, ['u-dia']);

  assert.equal(draft.agendaItems[0].title, 'Previous action items', 'unfinished business leads the agenda');
  assert.deepEqual(draft.agendaItems.map((i) => i.order), [1, 2, 3]);
  assert.deepEqual(draft.carriedActionItemIds, ['ai-1']);
  assert.equal(draft.followUpOfMeetingId, 'm1');
});

/* ── minutes ───────────────────────────────────────────────────────────────────────────────────── */

test('the minutes ladder collapses to prepare-then-publish when approval is off', () => {
  assert.equal(nextMomStage('Draft', true), 'Prepared');
  assert.equal(nextMomStage('Prepared', true), 'Reviewed');
  assert.equal(nextMomStage('Reviewed', true), 'Approved');
  assert.equal(nextMomStage('Approved', true), 'Published');
  assert.equal(nextMomStage('Published', true), null);

  assert.equal(nextMomStage('Draft', false), 'Prepared');
  assert.equal(nextMomStage('Prepared', false), 'Published', 'no ladder to walk when it is switched off');
  assert.equal(nextMomStage('Published', false), null);
});

test('minutes cannot be published before the meeting has finished or been approved', () => {
  assert.deepEqual(canPublishMom({ stage: 'Prepared', approvalRequired: false }, { status: 'Completed' }), {
    allowed: true,
    reason: null,
  });

  const early = canPublishMom({ stage: 'Prepared', approvalRequired: false }, { status: 'Scheduled' });
  assert.equal(early.allowed, false);
  assert.match(early.reason, /completed/);

  const unapproved = canPublishMom({ stage: 'Prepared', approvalRequired: true }, { status: 'Completed' });
  assert.equal(unapproved.allowed, false);
  assert.match(unapproved.reason, /review and approval/);

  const draft = canPublishMom({ stage: 'Draft', approvalRequired: false }, { status: 'Completed' });
  assert.equal(draft.allowed, false);
});

test('buildMomDocument renders the meeting record rather than a retyped form', () => {
  const doc = buildMomDocument({
    meeting: { ...baseMeeting, status: 'Completed', mode: 'Offline', location: 'Board Room', room: '3F' },
    participants: [
      { name: 'Asha', departmentName: 'Finance', designation: 'Manager', attendance: 'Present' },
      { name: 'Ben', departmentName: 'Finance', designation: 'Analyst', attendance: 'Late' },
      { name: 'Chen', departmentName: 'Projects', designation: 'PM', attendance: 'Absent' },
    ],
    agenda: [{ order: 1, title: 'Cash position', presenterName: 'Asha', expectedOutcome: 'Agree the plan' }],
    decisions: [
      { reference: 'DEC-2627-0001', title: 'Approve overdraft', ownerName: 'Asha', dueDate: '2026-09-30', status: 'Open' },
    ],
    actionItems: [
      { title: 'Prepare reconciliation', responsibleUserName: 'Ben', dueDate: '2026-09-25', status: 'Open' },
    ],
    notesPlainText: 'We reviewed the August position.',
    mom: { reference: 'MOM-2627-0001', stage: 'Approved', preparedByName: 'Asha' },
  });

  assert.equal(doc.title, 'MINUTES OF MEETING');
  assert.equal(doc.location, 'Board Room · 3F');
  assert.equal(doc.participants.length, 2, 'present and late attended');
  assert.equal(doc.absentees.length, 1);
  assert.equal(doc.decisions[0].reference, 'DEC-2627-0001');
  assert.equal(doc.actionItems[0].dueDate, '25 Sep 2026');
  assert.equal(doc.discussion, 'We reviewed the August position.');
  assert.equal(doc.nextMeeting, null);

  const silent = buildMomDocument({
    meeting: baseMeeting,
    participants: [],
    agenda: [],
    decisions: [],
    actionItems: [],
    notesPlainText: '',
    mom: null,
  });
  assert.match(silent.discussion, /No discussion notes/, 'blank would read as "not minuted"');
});

/* ── lifecycle screens ─────────────────────────────────────────────────────────────────────────── */

test('meetingPreparationState lists what is still outstanding', () => {
  const ready = meetingPreparationState({
    meeting: baseMeeting,
    agendaCount: 3,
    participants: [{ response: 'Accepted' }, { response: 'Accepted' }],
    openActionItems: 0,
    documentsAttached: 2,
    previousMomStage: 'Published',
  });
  assert.deepEqual(ready.outstanding, []);
  assert.equal(ready.agendaReady, true);

  const rough = meetingPreparationState({
    meeting: baseMeeting,
    agendaCount: 0,
    participants: [{ response: 'No Response' }, { response: 'No Response' }],
    openActionItems: 2,
    documentsAttached: 0,
    previousMomStage: 'Draft',
  });
  assert.equal(rough.responsesOutstanding, 2);
  assert.equal(rough.outstanding.length, 4);
  assert.ok(rough.outstanding.some((line) => line.includes('No agenda items')));
});

test('postMeetingSummary is the §68 receipt, including what is not done', () => {
  const summary = postMeetingSummary({
    participants: [{ attendance: 'Present' }, { attendance: 'Absent' }, { attendance: null }],
    notesPlainText: 'Discussed the position.',
    decisions: [{}, {}, {}, {}],
    actionItems: [{ taskId: 't1' }, { taskId: 't2' }, { taskId: null }],
    momStage: 'Prepared',
  });

  assert.equal(summary.decisions, 4);
  assert.equal(summary.actionItems, 3);
  assert.equal(summary.tasksGenerated, 2);
  assert.equal(summary.actionItemsWithoutTask, 1);
  assert.equal(summary.attendanceRecorded, false, 'one row unmarked');
  assert.equal(summary.notesSaved, true);
  assert.ok(summary.outstanding.some((line) => line.includes('Attendance not marked for 1 of 3')));
  assert.ok(summary.outstanding.some((line) => line.includes('Minutes are not published')));
});

/* ── workload and teams ────────────────────────────────────────────────────────────────────────── */

test('buildWorkload reports plain counts and no composite score', () => {
  const rows = buildWorkload({
    people: [
      { userId: 'u-asha', name: 'Asha', departmentName: 'Finance' },
      { userId: 'u-ben', name: 'Ben', departmentName: 'Finance' },
    ],
    tasks: [
      { assigneeId: 'u-asha', status: 'In Progress', dueDate: '2026-09-10', priority: 'High' },
      { assigneeId: 'u-asha', status: 'In Progress', dueDate: '2026-09-19', priority: 'Critical' },
      { assigneeId: 'u-asha', status: 'Completed', dueDate: '2026-09-01', priority: 'Low' },
      { assigneeId: 'u-ben', status: 'Cancelled', dueDate: '2026-09-01', priority: 'Low' },
    ],
    meetings: [
      { participantUserIds: ['u-asha', 'u-ben'], status: 'Scheduled' },
      { participantUserIds: ['u-asha'], status: 'Cancelled' },
    ],
    actionItems: [
      { responsibleUserId: 'u-asha', status: 'Open' },
      { responsibleUserId: 'u-ben', status: 'Completed' },
    ],
    today: '2026-09-18',
  });

  const asha = rows.find((r) => r.userId === 'u-asha');
  assert.equal(asha.activeTasks, 2);
  assert.equal(asha.overdueTasks, 1);
  assert.equal(asha.completedTasks, 1);
  assert.equal(asha.upcomingTasks, 1);
  assert.equal(asha.meetings, 1, 'a cancelled meeting is not workload');
  assert.equal(asha.actionItems, 1);
  assert.equal(asha.topPriority, 'Critical');

  const ben = rows.find((r) => r.userId === 'u-ben');
  assert.equal(ben.activeTasks, 0, 'a cancelled task is not active');
  assert.equal(ben.actionItems, 0);

  // §40/§73: nothing here may be a rating.
  assert.equal('score' in asha, false);
  assert.equal('rating' in asha, false);
});

test('buildTeamDashboard counts a team\'s work through either route to it', () => {
  const summary = buildTeamDashboard({
    team: { id: 't-project', memberUserIds: ['u-ben', 'u-chen'], memberCount: 2 },
    tasks: [
      { teamId: 't-project', status: 'Completed' },
      { teamId: null, assigneeId: 'u-ben', status: 'In Progress', dueDate: '2026-09-10' },
      { teamId: null, assigneeId: 'u-outsider', status: 'In Progress' },
    ],
    meetings: [
      { teamIds: ['t-project'], participantUserIds: [], date: '2026-09-17', status: 'Scheduled' },
      { teamIds: [], participantUserIds: ['u-chen'], date: '2026-09-25', status: 'Scheduled' },
      { teamIds: ['t-project'], participantUserIds: [], date: '2026-09-18', status: 'Cancelled' },
    ],
    actionItems: [
      { responsibleTeamId: 't-project', status: 'Open' },
      { responsibleUserId: 'u-chen', status: 'In Progress' },
      { responsibleUserId: 'u-ben', status: 'Completed' },
    ],
    today: '2026-09-18',
    weekStart: '2026-09-14',
    weekEnd: '2026-09-20',
  });

  assert.equal(summary.tasksTotal, 2, 'the outsider\'s task is not the team\'s');
  assert.equal(summary.tasksCompleted, 1);
  assert.equal(summary.tasksPending, 1);
  assert.equal(summary.tasksOverdue, 1);
  assert.equal(summary.meetingsThisWeek, 1, 'the cancelled one does not count');
  assert.equal(summary.actionItems, 2);
  assert.equal(summary.completionRate, 50);
});

test('normalizeTeamMembers keeps exactly one leader, listed first', () => {
  const members = normalizeTeamMembers(
    [
      { userId: 'u-ben', name: 'Ben', isLeader: true },
      { userId: 'u-chen', name: 'Chen' },
      { userId: 'u-ben', name: 'Ben' },
    ],
    'u-chen',
  );

  assert.equal(members.length, 2, 'duplicate member entries collapse');
  assert.equal(members[0].userId, 'u-chen');
  assert.equal(members[0].isLeader, true);
  assert.equal(members[1].isLeader, false, 'the stale flag is cleared');

  const added = normalizeTeamMembers([{ userId: 'u-ben', name: 'Ben' }], 'u-new', { name: 'Newcomer' });
  assert.equal(added[0].userId, 'u-new', 'a leader who was not a member is added');
});

test('validateTeamInput insists the leader is also a member', () => {
  assert.deepEqual(validateTeamInput({ name: 'Finance Team', leaderId: 'u1', memberUserIds: ['u1', 'u2'] }), {});
  assert.ok(validateTeamInput({ name: 'x', leaderId: 'u1', memberUserIds: ['u2'] }).members);
  assert.ok(validateTeamInput({ leaderId: 'u1', memberUserIds: ['u1'] }).name);
});

/* ── decisions, action items, uploads, text ────────────────────────────────────────────────────── */

test('decision and action item validation catch the impossible dates', () => {
  assert.deepEqual(
    validateDecisionInput({ title: 'Approve overdraft', decisionDate: '2026-09-18', ownerId: 'u1', dueDate: '2026-09-30' }),
    {},
  );
  const backwards = validateDecisionInput({
    title: 'x',
    decisionDate: '2026-09-18',
    ownerId: 'u1',
    dueDate: '2026-09-01',
  });
  assert.match(backwards.dueDate, /cannot precede the decision/);

  assert.deepEqual(validateActionItemInput({ title: 'Do the thing', responsibleUserId: 'u1' }), {});
  assert.ok(validateActionItemInput({ title: 'x' }).responsibleUserId);

  assert.equal(isActionItemOverdue({ status: 'Open', dueDate: '2026-09-01' }, '2026-09-18'), true);
  assert.equal(isActionItemOverdue({ status: 'Completed', dueDate: '2026-09-01' }, '2026-09-18'), false);
});

test('upload validation enforces type and size, and paths are namespaced per entity', () => {
  assert.deepEqual(validateOfficeHubUpload({ name: 'minutes.pdf', size: 1024 }), { ok: true, reason: null });

  const wrongType = validateOfficeHubUpload({ name: 'payload.exe', size: 1024 });
  assert.equal(wrongType.ok, false);
  assert.match(wrongType.reason, /not allowed/);

  const tooBig = validateOfficeHubUpload({ name: 'scan.pdf', size: 40 * 1024 * 1024 });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.reason, /25 MB/);

  assert.equal(validateOfficeHubUpload({ name: 'empty.pdf', size: 0 }).ok, false);
  assert.equal(validateOfficeHubUpload({ name: 'noextension', size: 10 }).ok, false);

  assert.equal(formatFileSize(2048), '2 KB');
  assert.match(officeHubStoragePath('meeting', 'm1', 'Q1 report.pdf'), /^office-hub\/meeting\/m1\/\d+_Q1 report\.pdf$/);
  assert.match(officeHubStoragePath('task', 't1', '../../etc/passwd'), /^office-hub\/task\/t1\/\d+_/);
});

test('mentions survive a rename because the id is stored, not the name', () => {
  const text = 'Please review @[Asha Rao](u-asha) and @[Ben](u-ben) — also @[Asha Rao](u-asha)';
  assert.deepEqual(extractMentions(text), ['u-asha', 'u-ben']);
  assert.equal(stripMentionMarkup(text), 'Please review @Asha Rao and @Ben — also @Asha Rao');
  assert.deepEqual(extractMentions(null), []);
});

test('htmlToPlainText gives search something to match on', () => {
  const html = '<h2>Decisions</h2><ul><li>Approve overdraft</li><li>Defer capex</li></ul><p>Next: <b>review</b></p><script>bad()</script>';
  const text = htmlToPlainText(html);
  assert.match(text, /Decisions/);
  assert.match(text, /• Approve overdraft/);
  assert.equal(text.includes('bad()'), false, 'scripts are stripped, not rendered');
  assert.equal(htmlToPlainText(null), '');
});

test('references carry the Indian financial year', () => {
  assert.equal(officeHubFinancialYear('2026-09-18'), '2627');
  assert.equal(officeHubFinancialYear('2026-03-31'), '2526', 'March belongs to the previous FY');
  assert.equal(officeHubFinancialYear('2026-04-01'), '2627');
  assert.equal(officeHubReference('TSK', '2026-09-18', 41), 'TSK-2627-0041');
});

test('working days and holidays come from settings', () => {
  // Default working days are Monday to Saturday.
  assert.equal(isWorkingDay('2026-09-18'), true, 'Friday');
  assert.equal(isWorkingDay('2026-09-20'), false, 'Sunday');
  assert.equal(isWorkingDay('2026-09-19'), true, 'Saturday is a working day here');

  const withHoliday = { holidays: [{ date: '2026-10-02', name: 'Gandhi Jayanti' }] };
  assert.equal(isWorkingDay('2026-10-02', withHoliday), false);
  assert.equal(holidayOn('2026-10-02', withHoliday).name, 'Gandhi Jayanti');
  assert.equal(holidayOn('2026-10-03', withHoliday), null);

  // An empty array in stored settings must not wipe out the defaults.
  assert.equal(isWorkingDay('2026-09-20', { workingDays: [] }), false);
});

/* ── permissions ───────────────────────────────────────────────────────────────────────────────── */

const organizerViewer = { userId: 'u-organizer', name: 'Asha' };
const memberViewer = { userId: 'u-member', name: 'Ben', departmentId: 'd-finance' };
const strangerViewer = { userId: 'u-stranger', name: 'Chen', departmentId: 'd-projects' };

const noPermissions = resolveOfficeHubCapabilities({}, organizerViewer);
const employeePermissions = resolveOfficeHubCapabilities(
  {
    'Office Hub': ['View Module'],
    'Office Hub.Meetings': ['View', 'Create'],
    'Office Hub.Tasks': ['View', 'Create'],
  },
  memberViewer,
);
const adminPermissions = resolveOfficeHubCapabilities(
  {
    'Office Hub': ['View Module'],
    'Office Hub.Meetings': ['View All', 'Create', 'Edit', 'Cancel', 'Manage Participants'],
    'Office Hub.Tasks': ['View All', 'Create', 'Edit', 'Assign', 'Complete'],
    'Office Hub.Minutes': ['View', 'Prepare', 'Review', 'Approve', 'Publish'],
    'Office Hub.Teams': ['View', 'Create', 'Edit', 'Manage Members'],
    'Office Hub.Settings': ['View', 'Edit'],
  },
  strangerViewer,
);

test('capabilities are resolved from the role map, and an empty map grants nothing', () => {
  assert.equal(noPermissions.canViewModule, false);
  assert.equal(noPermissions.canCreateMeeting, false);
  assert.equal(employeePermissions.canViewModule, true);
  assert.equal(employeePermissions.canCreateMeeting, true);
  assert.equal(employeePermissions.canViewAllMeetings, false);
  assert.equal(adminPermissions.canViewAllMeetings, true);
  assert.equal(adminPermissions.canEditSettings, true);
  assert.equal(employeePermissions.canEditSettings, false);
});

test('leading a team confers a baseline that no role has to grant', () => {
  const leader = resolveOfficeHubCapabilities(
    { 'Office Hub.Meetings': ['View'], 'Office Hub.Tasks': ['View'] },
    { userId: 'u-lead', name: 'Lead', leadsTeamIds: ['t-project'] },
  );
  assert.equal(leader.canViewTeamMeetings, true);
  assert.equal(leader.canAssignTasks, true, 'a team leader can assign within their team');

  const plain = resolveOfficeHubCapabilities(
    { 'Office Hub.Meetings': ['View'], 'Office Hub.Tasks': ['View'] },
    { userId: 'u-plain', name: 'Plain' },
  );
  assert.equal(plain.canAssignTasks, false);
});

test('being the organizer is authority over that meeting', () => {
  const meeting = { ...baseMeeting, isDeleted: false };

  // The organizer edits, cancels and marks attendance with no matching role permission at all.
  assert.equal(canEditMeeting(meeting, organizerViewer, noPermissions).allowed, true);
  assert.equal(canCancelMeeting(meeting, organizerViewer, noPermissions).allowed, true);
  assert.equal(canRecordAttendance(meeting, organizerViewer, noPermissions).allowed, true);

  // A participant without the grant does not.
  const denied = canEditMeeting(meeting, memberViewer, employeePermissions);
  assert.equal(denied.allowed, false);
  assert.match(denied.reason, /Only the organizer/);

  // But somebody holding Edit does.
  assert.equal(canEditMeeting(meeting, strangerViewer, adminPermissions).allowed, true);
});

test('a finished meeting is closed to editing, even for its organizer', () => {
  const completed = { ...baseMeeting, status: 'Completed' };
  const verdict = canEditMeeting(completed, organizerViewer, adminPermissions);
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /minutes instead/);

  // Attendance stays open afterwards — it is almost always filled in later.
  assert.equal(canRecordAttendance(completed, organizerViewer, noPermissions).allowed, true);

  const cancelled = { ...baseMeeting, status: 'Cancelled' };
  assert.equal(canRecordAttendance(cancelled, organizerViewer, adminPermissions).allowed, false);
});

test('a participant may answer only their own invitation', () => {
  assert.equal(canRespondToInvitation({ userId: 'u-member' }, baseMeeting, memberViewer).allowed, true);
  const other = canRespondToInvitation({ userId: 'u-member' }, baseMeeting, organizerViewer);
  assert.equal(other.allowed, false);
  assert.match(other.reason, /your own invitation/);
});

test('meeting visibility widens by grant, and a department head sees their department', () => {
  assert.equal(canViewMeeting(baseMeeting, memberViewer, employeePermissions), true, 'participant');
  assert.equal(canViewMeeting(baseMeeting, strangerViewer, employeePermissions), false);
  assert.equal(canViewMeeting(baseMeeting, strangerViewer, adminPermissions), true, 'View All');

  const head = { userId: 'u-head', name: 'Head', headsDepartmentIds: ['d-finance'] };
  const headCaps = resolveOfficeHubCapabilities({ 'Office Hub.Meetings': ['View'] }, head);
  assert.equal(canViewMeeting(baseMeeting, head, headCaps), true, 'heads the meeting\'s department');
});

test('the minutes ladder refuses to let one person walk it alone', () => {
  const meeting = { ...baseMeeting, status: 'Completed' };
  const mom = { stage: 'Reviewed', approvalRequired: true, preparedById: 'u-stranger' };

  // The admin holds every minutes permission but prepared these minutes themselves.
  const selfApproval = canAdvanceMinutes(mom, meeting, strangerViewer, adminPermissions, 'Approved');
  assert.equal(selfApproval.allowed, false);
  assert.match(selfApproval.reason, /other than the person who prepared/);

  const someoneElse = canAdvanceMinutes(mom, meeting, { userId: 'u-other', name: 'Other' }, adminPermissions, 'Approved');
  assert.equal(someoneElse.allowed, true);

  // With approval switched off there is no second signature to insist on.
  const relaxed = canAdvanceMinutes(
    { stage: 'Prepared', approvalRequired: false, preparedById: 'u-stranger' },
    meeting,
    strangerViewer,
    adminPermissions,
    'Published',
  );
  assert.equal(relaxed.allowed, true);

  // The organizer prepares without needing the grant.
  assert.equal(canAdvanceMinutes({ stage: 'Draft', approvalRequired: true }, meeting, organizerViewer, noPermissions, 'Prepared').allowed, true);
});

test('task visibility and editing follow the work, not only the role', () => {
  const task = {
    assigneeId: 'u-member',
    createdBy: 'u-organizer',
    teamId: 't-project',
    departmentId: 'd-finance',
    status: 'In Progress',
    watcherUserIds: ['u-organizer', 'u-member'],
  };

  assert.equal(canViewTask(task, memberViewer, employeePermissions), true, 'assignee');
  assert.equal(canViewTask(task, organizerViewer, resolveOfficeHubCapabilities({ 'Office Hub.Tasks': ['View'] }, organizerViewer)), true, 'creator');
  assert.equal(
    canViewTask(task, { userId: 'u-nobody', name: 'Nobody' }, resolveOfficeHubCapabilities({ 'Office Hub.Tasks': ['View'] }, { userId: 'u-nobody', name: 'Nobody' })),
    false,
  );

  assert.equal(canEditTask(task, memberViewer, employeePermissions).allowed, true, 'the assignee owns their work');
  const outsider = canEditTask(task, { userId: 'u-nobody', name: 'Nobody' }, employeePermissions);
  assert.equal(outsider.allowed, false);

  const teamLead = { userId: 'u-lead', name: 'Lead', leadsTeamIds: ['t-project'] };
  assert.equal(canEditTask(task, teamLead, resolveOfficeHubCapabilities({}, teamLead)).allowed, true);

  assert.equal(canCompleteTaskAs(task, memberViewer, employeePermissions).allowed, true);
  assert.equal(canCompleteTaskAs({ ...task, status: 'Completed' }, memberViewer, employeePermissions).allowed, false);
});

test('team membership is the leader\'s to manage', () => {
  const team = { leaderId: 'u-lead', status: 'Active' };
  const lead = { userId: 'u-lead', name: 'Lead' };
  assert.equal(canManageTeamMembers(team, lead, resolveOfficeHubCapabilities({}, lead)).allowed, true);
  assert.equal(canManageTeamMembers(team, memberViewer, employeePermissions).allowed, false);
  assert.equal(canManageTeamMembers(team, strangerViewer, adminPermissions).allowed, true);

  const archived = canManageTeamMembers({ leaderId: 'u-lead', status: 'Archived' }, lead, adminPermissions);
  assert.equal(archived.allowed, false);
});

test('query scope is chosen from the widest grant, not filtered after the fact', () => {
  assert.equal(widestMeetingScope(adminPermissions), 'all');
  assert.equal(widestMeetingScope(employeePermissions), 'mine');
  assert.equal(widestTaskScope(adminPermissions), 'all');
  assert.equal(widestTaskScope(employeePermissions), 'mine');

  const head = { userId: 'u-head', name: 'Head', headsDepartmentIds: ['d-finance'] };
  assert.equal(widestMeetingScope(resolveOfficeHubCapabilities({ 'Office Hub.Meetings': ['View'] }, head)), 'department');
});

test('a cancelled meeting is never resurrected by a manual status change', () => {
  assert.equal(isManualMeetingStatusChangeAllowed('Scheduled', 'Postponed'), true);
  assert.equal(isManualMeetingStatusChangeAllowed('Cancelled', 'Scheduled'), false);
  assert.equal(isManualMeetingStatusChangeAllowed('Completed', 'Draft'), false);
  assert.equal(isManualMeetingStatusChangeAllowed('Scheduled', 'Scheduled'), false);
});
