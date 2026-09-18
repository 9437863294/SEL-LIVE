import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ageingBucket,
  buildActionItemReport,
  buildDecisionReport,
  buildManagementOverview,
  buildMeetingReport,
  buildMeetingStatistics,
  buildTaskReport,
  buildTaskStatistics,
  reportRowsToSheet,
} from '../src/lib/office-hub-reports.ts';

import {
  activeFilterCount,
  applyActionItemFilters,
  applyDecisionFilters,
  applyMeetingFilters,
  applyTaskFilters,
  hasActiveFilters,
  normalizeSearchTerm,
  scoreMatch,
  searchOfficeHub,
} from '../src/lib/office-hub-search.ts';

import {
  calendarEventFromMeeting,
  createIcsCalendarProvider,
  getMeetingProvider,
  icsFileName,
  manualMeetingProvider,
  recurrenceRuleFor,
  registerMeetingProvider,
  renderMeetingEmail,
  renderTaskEmail,
  resolveBaseUrl,
} from '../src/lib/office-hub-integrations.ts';

const meeting = (overrides = {}) => ({
  id: 'm1',
  title: 'Finance Review',
  meetingType: 'Finance',
  description: 'Monthly cash position',
  priority: 'High',
  status: 'Completed',
  date: '2026-09-21',
  startTime: '10:00',
  endTime: '11:00',
  timeZone: 'Asia/Kolkata',
  startAt: '2026-09-21T04:30:00.000Z',
  endAt: '2026-09-21T05:30:00.000Z',
  mode: 'Online',
  onlinePlatform: 'Microsoft Teams',
  meetingUrl: 'https://teams.microsoft.com/l/x',
  location: null,
  room: null,
  organizerId: 'u-asha',
  organizerName: 'Asha',
  participantUserIds: ['u-asha', 'u-ben'],
  requiredUserIds: ['u-asha'],
  departmentIds: ['d-finance'],
  teamIds: [],
  responseSummary: { accepted: 2, maybe: 0, declined: 0, noResponse: 0 },
  participantCount: 2,
  reminderOffsets: [15],
  recurrence: { frequency: 'None', interval: 1, endMode: 'never' },
  momStage: 'Published',
  ...overrides,
});

const task = (overrides = {}) => ({
  id: 't1',
  reference: 'TSK-2627-0001',
  title: 'Prepare reconciliation',
  assigneeId: 'u-ben',
  assigneeName: 'Ben',
  departmentId: 'd-finance',
  departmentName: 'Finance',
  startDate: '2026-09-01',
  dueDate: '2026-09-25',
  priority: 'High',
  status: 'In Progress',
  progress: 30,
  ...overrides,
});

/* ── meeting report ───────────────────────────────────────────────────────────────────────────── */

test('buildMeetingReport groups by every dimension §39 asks for', () => {
  const report = buildMeetingReport(
    [
      meeting(),
      meeting({ id: 'm2', date: '2026-10-05', meetingType: 'Project', organizerName: 'Ben', status: 'Scheduled', momStage: null }),
      meeting({ id: 'm3', date: '2026-10-06', status: 'Cancelled', departmentIds: [], momStage: null }),
      meeting({
        id: 'm4',
        date: '2026-10-12',
        status: 'Scheduled',
        recurrence: { frequency: 'Weekly', interval: 1, endMode: 'never' },
        mode: 'Offline',
        departmentIds: ['d-hr'],
        momStage: null,
      }),
    ],
    [
      { meetingId: 'm1', attendance: 'Present' },
      { meetingId: 'm1', attendance: 'Late' },
      { meetingId: 'm2', attendance: 'Absent' },
      { meetingId: 'm-other', attendance: 'Present' },
    ],
    { departmentNames: { 'd-finance': 'Finance', 'd-hr': 'HR' } },
  );

  assert.equal(report.total, 4);
  assert.equal(report.cancelled, 1);
  assert.equal(report.completed, 1);
  assert.equal(report.recurring, 1);
  assert.equal(report.minutesPublished, 1);

  assert.deepEqual(report.byMonth.map((row) => row.label), ['2026-09', '2026-10']);
  assert.equal(report.byMonth.find((row) => row.label === '2026-10').count, 3);
  assert.equal(report.byType.find((row) => row.label === 'Finance').count, 3);
  assert.equal(report.byOrganizer.find((row) => row.label === 'Ben').count, 1);
  assert.equal(report.byDepartment.find((row) => row.label === 'No department').count, 1, 'counted, not dropped');
  assert.equal(report.byDepartment.find((row) => row.label === 'HR').count, 1);

  // A cancelled meeting consumed no time.
  assert.equal(report.scheduledMinutes, 180);

  // Attendance counts only participants of the meetings in this report.
  assert.equal(report.attendance.invited, 3);
  assert.equal(report.attendance.present, 1);
  assert.equal(report.attendance.late, 1);
  assert.equal(report.attendance.attendanceRate, 67);
});

/* ── task report ──────────────────────────────────────────────────────────────────────────────── */

test('buildTaskReport reports completion honestly, using a median rather than a mean', () => {
  const report = buildTaskReport(
    [
      task({ id: 't1', status: 'Completed', startDate: '2026-09-01', completedAt: '2026-09-03T10:00:00.000Z', dueDate: '2026-09-05' }),
      task({ id: 't2', status: 'Completed', startDate: '2026-09-01', completedAt: '2026-09-05T10:00:00.000Z', dueDate: '2026-09-02' }),
      task({ id: 't3', status: 'Completed', startDate: '2026-09-01', completedAt: '2026-12-01T10:00:00.000Z', dueDate: '2026-09-02' }),
      task({ id: 't4', status: 'In Progress', dueDate: '2026-09-10' }),
      task({ id: 't5', status: 'Cancelled' }),
      task({ id: 't6', status: 'On Hold', dueDate: null, assigneeId: null, assigneeName: null, teamName: 'Project Team', teamId: 't-p' }),
      task({ id: 't7', status: 'Not Started', meetingId: 'm1', departmentId: null, departmentName: null }),
    ],
    '2026-09-18',
    { departmentNames: { 'd-finance': 'Finance' } },
  );

  assert.equal(report.total, 7);
  assert.equal(report.completed, 3);
  assert.equal(report.cancelled, 1);
  assert.equal(report.onHold, 1);
  assert.equal(report.pending, 3, 'total minus completed minus cancelled');
  assert.equal(report.overdue, 1, 't4 only');
  assert.equal(report.fromMeetings, 1);

  // Completion days: 2, 4, 91. The mean would be 32; the median is 4, which describes the work.
  assert.equal(report.medianCompletionDays, 4);
  assert.equal(report.onTimeCompletionRate, 33, '1 of 3 completed tasks met its due date');

  // Fixed-order rows so a chart's bars do not reshuffle.
  assert.deepEqual(report.byStatus.map((row) => row.label), [
    'Not Started',
    'In Progress',
    'On Hold',
    'Completed',
    'Cancelled',
  ]);
  assert.deepEqual(report.byPriority.map((row) => row.label), ['Low', 'Medium', 'High', 'Critical']);

  assert.equal(report.byAssignee.find((row) => row.label === 'Project Team').count, 1, 'a team task is attributed to the team');
  assert.equal(report.byDepartment.find((row) => row.label === 'No department').count, 1);
});

test('task statistics are the dashboard tiles, and closed tasks are never overdue', () => {
  const stats = buildTaskStatistics(
    [
      { status: 'Not Started', dueDate: '2026-09-11' },
      { status: 'In Progress', dueDate: '2026-09-18' },
      { status: 'In Progress', dueDate: '2026-09-22' },
      { status: 'On Hold', dueDate: null },
      { status: 'Completed', dueDate: '2026-01-01' },
      { status: 'Cancelled', dueDate: '2026-01-01' },
    ],
    '2026-09-18',
  );

  assert.equal(stats.total, 6);
  assert.equal(stats.notStarted, 1);
  assert.equal(stats.inProgress, 2);
  assert.equal(stats.onHold, 1);
  assert.equal(stats.completed, 1);
  assert.equal(stats.cancelled, 1);
  assert.equal(stats.overdue, 1, 'the long-completed task is not overdue');
  assert.equal(stats.dueToday, 1);
  assert.equal(stats.dueSoon, 1);
});

test('meeting statistics count the periods the dashboard shows', () => {
  const stats = buildMeetingStatistics({
    meetings: [
      { date: '2026-09-18', status: 'Scheduled', organizerId: 'u-asha' },
      { date: '2026-09-19', status: 'Scheduled', organizerId: 'u-ben' },
      { date: '2026-09-30', status: 'Scheduled', organizerId: 'u-asha' },
      { date: '2026-10-05', status: 'Scheduled', organizerId: 'u-asha' },
      { date: '2026-09-18', status: 'Cancelled', organizerId: 'u-asha' },
    ],
    awaitingResponse: 3,
    viewerUserId: 'u-asha',
    today: '2026-09-18',
    weekStart: '2026-09-14',
    weekEnd: '2026-09-20',
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
  });

  assert.equal(stats.today, 1, 'the cancelled one does not count');
  assert.equal(stats.thisWeek, 2);
  assert.equal(stats.thisMonth, 3);
  assert.equal(stats.organizedByMe, 3, 'every non-cancelled meeting in the supplied set');
  assert.equal(stats.awaitingMyResponse, 3);
});

/* ── action items and decisions ───────────────────────────────────────────────────────────────── */

test('buildActionItemReport surfaces items with no task, which is the point of the report', () => {
  const report = buildActionItemReport(
    [
      { id: 'a1', title: 'Bank report', status: 'Open', dueDate: '2026-09-10', priority: 'High', responsibleUserName: 'Ben', meetingTitle: 'Finance Review', meetingDate: '2026-09-01', taskId: null },
      { id: 'a2', title: 'Project report', status: 'In Progress', dueDate: '2026-09-30', priority: 'Medium', responsibleUserName: 'Chen', meetingTitle: 'Finance Review', meetingDate: '2026-09-01', taskId: 't1' },
      { id: 'a3', title: 'Done', status: 'Completed', dueDate: '2026-09-01', priority: 'Low', responsibleUserName: 'Ben', meetingTitle: 'Finance Review', meetingDate: '2026-09-01', taskId: 't2' },
      { id: 'a4', title: 'Dropped', status: 'Cancelled', priority: 'Low', responsibleUserName: null, responsibleTeamName: null, meetingDate: null, taskId: null },
    ],
    '2026-09-18',
  );

  assert.equal(report.total, 4);
  assert.equal(report.open, 1);
  assert.equal(report.inProgress, 1);
  assert.equal(report.completed, 1);
  assert.equal(report.cancelled, 1);
  assert.equal(report.overdue, 1);
  assert.equal(report.withoutTask, 1, 'a1 is open with no task raised');
  assert.equal(report.byResponsible.find((row) => row.label === 'Ben').count, 2);
  assert.equal(report.ageing.find((row) => row.label === '15–30 days').count, 2);
});

test('buildDecisionReport counts the register by owner, department and age', () => {
  const report = buildDecisionReport(
    [
      { id: 'd1', reference: 'DEC-1', title: 'Approve overdraft', status: 'Open', decisionDate: '2026-09-01', dueDate: '2026-09-10', ownerId: 'u-asha', ownerName: 'Asha', departmentId: 'd-finance', departmentName: 'Finance', priority: 'High' },
      { id: 'd2', reference: 'DEC-2', title: 'Defer capex', status: 'Completed', decisionDate: '2026-08-15', ownerId: 'u-asha', ownerName: 'Asha', departmentId: 'd-finance', priority: 'Medium' },
      { id: 'd3', reference: 'DEC-3', title: 'Hire', status: 'In Progress', decisionDate: '2026-09-16', dueDate: '2026-10-01', ownerId: 'u-dia', ownerName: 'Dia', departmentId: null, priority: 'Critical' },
    ],
    '2026-09-18',
    { departmentNames: { 'd-finance': 'Finance' } },
  );

  assert.equal(report.total, 3);
  assert.equal(report.open, 1);
  assert.equal(report.inProgress, 1);
  assert.equal(report.completed, 1);
  assert.equal(report.overdue, 1);
  assert.equal(report.byOwner.find((row) => row.label === 'Asha').count, 2);
  assert.equal(report.byDepartment.find((row) => row.label === 'No department').count, 1);
  assert.deepEqual(report.byMonth.map((row) => row.label), ['2026-08', '2026-09']);
  assert.equal(report.ageing.find((row) => row.label === '0–7 days').count, 1, 'd3 is two days old');
});

test('ageingBucket buckets by age and handles a missing date', () => {
  assert.equal(ageingBucket('2026-09-15', '2026-09-18'), '0–7 days');
  assert.equal(ageingBucket('2026-09-08', '2026-09-18'), '8–14 days');
  assert.equal(ageingBucket('2026-08-25', '2026-09-18'), '15–30 days');
  assert.equal(ageingBucket('2026-08-01', '2026-09-18'), '31–60 days');
  assert.equal(ageingBucket('2026-01-01', '2026-09-18'), '60+ days');
  assert.equal(ageingBucket(null, '2026-09-18'), 'No date');
});

/* ── management overview ──────────────────────────────────────────────────────────────────────── */

test('buildManagementOverview reports operational facts and no ranking', () => {
  const overview = buildManagementOverview({
    meetings: [
      meeting({ id: 'm1', status: 'Completed', date: '2026-09-10', momStage: 'Published' }),
      meeting({ id: 'm2', status: 'Completed', date: '2026-09-12', momStage: 'Prepared' }),
      meeting({ id: 'm3', status: 'Cancelled', date: '2026-09-14' }),
      meeting({ id: 'm4', status: 'Scheduled', date: '2026-09-25' }),
    ],
    tasks: [
      task({ id: 't1', status: 'In Progress', dueDate: '2026-09-11' }),
      task({ id: 't2', status: 'Not Started', dueDate: '2026-09-25' }),
      task({ id: 't3', status: 'Completed', dueDate: '2026-09-01' }),
      task({ id: 't4', status: 'In Progress', dueDate: '2026-12-01', departmentId: 'd-hr', departmentName: 'HR' }),
    ],
    decisions: [
      { id: 'd1', title: 'Overdraft', reference: 'DEC-1', status: 'Open', decisionDate: '2026-09-01', dueDate: '2026-09-15', ownerId: 'u-asha', ownerName: 'Asha', priority: 'High' },
      { id: 'd2', title: 'Closed', reference: 'DEC-2', status: 'Completed', decisionDate: '2026-09-01', ownerId: 'u-asha', ownerName: 'Asha', priority: 'Low' },
    ],
    actionItems: [
      { id: 'a1', title: 'Bank report', reference: 'ACT-1', status: 'Open', dueDate: '2026-09-10', priority: 'High', responsibleUserName: 'Ben' },
      { id: 'a2', title: 'Later', reference: 'ACT-2', status: 'Open', dueDate: '2026-09-28', priority: 'Low', responsibleUserName: 'Ben' },
      { id: 'a3', title: 'Done', reference: 'ACT-3', status: 'Completed', priority: 'Low', responsibleUserName: 'Ben' },
    ],
    today: '2026-09-18',
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
    departmentNames: { 'd-finance': 'Finance', 'd-hr': 'HR' },
  });

  assert.equal(overview.upcomingMeetings, 1);
  assert.equal(overview.meetingsCompletedThisMonth, 2);
  assert.equal(overview.meetingsCancelledThisMonth, 1);
  assert.equal(overview.unpublishedMinutes, 1);
  assert.equal(overview.activeTasks, 3);
  assert.equal(overview.overdueTasks, 1);
  assert.equal(overview.openDecisions, 1);
  assert.equal(overview.overdueDecisions, 1);
  assert.equal(overview.openActionItems, 2);
  assert.equal(overview.overdueActionItems, 1);

  assert.equal(overview.departmentPendingTasks.find((row) => row.label === 'Finance').count, 2);
  assert.equal(overview.departmentPendingTasks.find((row) => row.label === 'HR').count, 1);

  // Deadlines inside the 14-day horizon, soonest first, with the overdue ones flagged.
  assert.deepEqual(overview.upcomingDeadlines.map((row) => row.id), ['a1', 't1', 'd1', 't2', 'a2']);
  assert.equal(overview.upcomingDeadlines[0].overdue, true);
  assert.equal(overview.upcomingDeadlines.at(-1).overdue, false);

  // §73: no scores, no rankings.
  assert.equal('score' in overview, false);
  assert.equal('ranking' in overview, false);
});

test('reportRowsToSheet flattens a chart into export rows', () => {
  const sheet = reportRowsToSheet('By department', [
    { label: 'Finance', count: 4, share: 80 },
    { label: 'HR', count: 1, share: 20 },
  ]);
  assert.equal(sheet.title, 'By department');
  assert.deepEqual(sheet.rows[0], { Label: 'Finance', Count: 4, 'Share %': 80 });
});

/* ── search ───────────────────────────────────────────────────────────────────────────────────── */

test('scoreMatch ranks an exact reference above a fuzzy title match', () => {
  const exact = scoreMatch('tsk-2627-0041', [{ value: 'TSK-2627-0041', weight: 1.2 }]);
  const prefix = scoreMatch('tsk', [{ value: 'TSK-2627-0041', weight: 1.2 }]);
  const substring = scoreMatch('2627', [{ value: 'TSK-2627-0041', weight: 1.2 }]);
  assert.ok(exact.score > prefix.score);
  assert.ok(prefix.score > substring.score);

  const wordBoundary = scoreMatch('review', [{ value: 'Finance Review', weight: 1 }]);
  const mid = scoreMatch('eview', [{ value: 'Finance Review', weight: 1 }]);
  assert.ok(wordBoundary.score > mid.score);

  // Every word present somewhere, in any order.
  const multiword = scoreMatch('bank meeting', [{ value: 'Monthly meeting with the bank', weight: 1 }]);
  assert.ok(multiword.score > 0);

  assert.equal(scoreMatch('x', [{ value: 'anything', weight: 1 }]).score, 0, 'one character matches nothing');
  assert.equal(scoreMatch('zzz', [{ value: 'Finance Review', weight: 1 }]).score, 0);
  assert.equal(normalizeSearchTerm('  Finance   REVIEW '), 'finance review');
});

test('searchOfficeHub groups results and names where each match came from', () => {
  const results = searchOfficeHub('finance', {
    meetings: [meeting({ id: 'm1', title: 'Finance Review' }), meeting({ id: 'm2', title: 'Site Visit', description: null, meetingType: 'Site' })],
    tasks: [task({ id: 't1', title: 'Finance pack', reference: 'TSK-1' })],
    decisions: [
      { id: 'd1', reference: 'DEC-1', title: 'Approve overdraft', description: 'Finance committee agreed', ownerId: 'u1', ownerName: 'Asha', decisionDate: '2026-09-01', status: 'Open', priority: 'High' },
    ],
    actionItems: [],
    teams: [
      { id: 'tm1', name: 'Finance Team', leaderId: 'u1', leaderName: 'Asha', members: [], memberUserIds: [], memberCount: 4, status: 'Active' },
    ],
    people: [
      { userId: 'u1', name: 'Asha Rao', designation: 'Finance Manager', departmentName: 'Finance', employeeId: 'SEL-1' },
      { userId: 'u2', name: 'Ben', designation: 'Analyst', departmentName: 'Projects' },
    ],
    documents: [
      { id: 'doc1', fileName: 'Finance pack.pdf', entityType: 'meeting', entityId: 'm1', uploadedByName: 'Asha', fileSize: 10, contentType: 'application/pdf', storagePath: 'x', uploadedById: 'u1', uploadedAt: '2026-09-01T00:00:00Z' },
    ],
    notesByMeetingId: { m2: 'The finance team joined late' },
  });

  const kinds = results.groups.map((group) => group.kind);
  assert.deepEqual(kinds, ['meeting', 'task', 'decision', 'employee', 'team', 'document'], 'group order is fixed');
  assert.equal(results.total, 7);

  const meetings = results.groups.find((group) => group.kind === 'meeting').results;
  assert.equal(meetings[0].id, 'm1', 'a title match outranks a notes match');
  assert.equal(meetings[1].id, 'm2');
  assert.equal(meetings[0].link, '/office-hub/meetings/m1');

  assert.equal(results.groups.find((group) => group.kind === 'employee').results.length, 1, 'Ben does not match');
  assert.equal(results.groups.find((group) => group.kind === 'document').results[0].link, '/office-hub/meetings/m1');

  assert.deepEqual(searchOfficeHub('f', { meetings: [meeting()] }), { term: 'f', total: 0, groups: [] });
});

/* ── filters ──────────────────────────────────────────────────────────────────────────────────── */

test('applyMeetingFilters combines every §38 dimension', () => {
  const meetings = [
    meeting({ id: 'm1', date: '2026-09-21', meetingType: 'Finance', status: 'Completed', priority: 'High', departmentIds: ['d-finance'], organizerId: 'u-asha' }),
    meeting({ id: 'm2', date: '2026-09-25', meetingType: 'Project', status: 'Scheduled', priority: 'Low', departmentIds: ['d-projects'], organizerId: 'u-ben', teamIds: ['t-p'] }),
    meeting({ id: 'm3', date: '2026-10-02', meetingType: 'Finance', status: 'Cancelled', priority: 'High', departmentIds: ['d-finance'], organizerId: 'u-asha', recurrence: { frequency: 'Weekly', interval: 1, endMode: 'never' } }),
  ];

  const ids = (filters) => applyMeetingFilters(meetings, filters).map((m) => m.id);

  assert.deepEqual(ids({}), ['m1', 'm2', 'm3']);
  assert.deepEqual(ids({ fromDate: '2026-09-22' }), ['m2', 'm3']);
  assert.deepEqual(ids({ toDate: '2026-09-25' }), ['m1', 'm2']);
  assert.deepEqual(ids({ meetingTypes: ['Finance'] }), ['m1', 'm3']);
  assert.deepEqual(ids({ statuses: ['Scheduled'] }), ['m2']);
  assert.deepEqual(ids({ priorities: ['High'] }), ['m1', 'm3']);
  assert.deepEqual(ids({ departmentIds: ['d-projects'] }), ['m2']);
  assert.deepEqual(ids({ teamIds: ['t-p'] }), ['m2']);
  assert.deepEqual(ids({ organizerIds: ['u-asha'] }), ['m1', 'm3']);
  assert.deepEqual(ids({ recurringOnly: true }), ['m3']);
  assert.deepEqual(ids({ recurringOnly: false }), ['m1', 'm2']);
  assert.deepEqual(ids({ search: 'project' }), ['m2']);
  // Filters compose.
  assert.deepEqual(ids({ meetingTypes: ['Finance'], statuses: ['Completed'] }), ['m1']);
});

test('applyTaskFilters covers overdue, undated and every select', () => {
  const tasks = [
    task({ id: 't1', status: 'In Progress', dueDate: '2026-09-11', priority: 'High', assigneeId: 'u-ben' }),
    task({ id: 't2', status: 'Not Started', dueDate: null, priority: 'Low', assigneeId: 'u-chen', departmentId: 'd-hr' }),
    task({ id: 't3', status: 'Completed', dueDate: '2026-09-01', priority: 'High', assigneeId: 'u-ben', meetingId: 'm1', tags: ['bank'] }),
  ];
  const ids = (filters) => applyTaskFilters(tasks, filters, '2026-09-18').map((t) => t.id);

  assert.deepEqual(ids({}), ['t1', 't2', 't3']);
  assert.deepEqual(ids({ overdueOnly: true }), ['t1'], 'a completed task is never overdue');
  assert.deepEqual(ids({ undatedOnly: true }), ['t2']);
  assert.deepEqual(ids({ assigneeIds: ['u-ben'] }), ['t1', 't3']);
  assert.deepEqual(ids({ statuses: ['Completed'] }), ['t3']);
  assert.deepEqual(ids({ priorities: ['Low'] }), ['t2']);
  assert.deepEqual(ids({ departmentIds: ['d-hr'] }), ['t2']);
  assert.deepEqual(ids({ meetingIds: ['m1'] }), ['t3']);
  assert.deepEqual(ids({ tags: ['bank'] }), ['t3']);
  assert.deepEqual(ids({ dueFrom: '2026-09-05', dueTo: '2026-09-15' }), ['t1']);
  assert.deepEqual(ids({ search: 'TSK-2627' }), ['t1', 't2', 't3']);
});

test('decision and action item filters behave the same way', () => {
  const decisions = [
    { id: 'd1', reference: 'DEC-1', title: 'Overdraft', status: 'Open', decisionDate: '2026-09-01', dueDate: '2026-09-10', ownerId: 'u-asha', ownerName: 'Asha', departmentId: 'd-finance', priority: 'High' },
    { id: 'd2', reference: 'DEC-2', title: 'Capex', status: 'Completed', decisionDate: '2026-09-05', ownerId: 'u-ben', ownerName: 'Ben', departmentId: 'd-hr', priority: 'Low' },
  ];
  assert.deepEqual(applyDecisionFilters(decisions, { overdueOnly: true }, '2026-09-18').map((d) => d.id), ['d1']);
  assert.deepEqual(applyDecisionFilters(decisions, { ownerIds: ['u-ben'] }, '2026-09-18').map((d) => d.id), ['d2']);
  assert.deepEqual(applyDecisionFilters(decisions, { search: 'overdraft' }, '2026-09-18').map((d) => d.id), ['d1']);

  const items = [
    { id: 'a1', reference: 'ACT-1', title: 'Bank report', status: 'Open', dueDate: '2026-09-10', priority: 'High', responsibleUserId: 'u-ben', responsibleUserName: 'Ben', taskId: null },
    { id: 'a2', reference: 'ACT-2', title: 'Other', status: 'Open', dueDate: '2026-09-30', priority: 'Low', responsibleUserId: 'u-ben', responsibleUserName: 'Ben', taskId: 't1' },
  ];
  assert.deepEqual(applyActionItemFilters(items, { withoutTaskOnly: true }, '2026-09-18').map((i) => i.id), ['a1']);
  assert.deepEqual(applyActionItemFilters(items, { overdueOnly: true }, '2026-09-18').map((i) => i.id), ['a1']);
});

test('filter state helpers drive the badge and the clear button', () => {
  assert.equal(hasActiveFilters({}), false);
  assert.equal(hasActiveFilters({ search: '', statuses: [] }), false);
  assert.equal(hasActiveFilters({ statuses: ['Open'] }), true);
  assert.equal(hasActiveFilters({ overdueOnly: false }), false);
  assert.equal(hasActiveFilters({ overdueOnly: true }), true);
  assert.equal(activeFilterCount({ search: 'x', statuses: ['Open'], priorities: [] }), 2);
});

/* ── integrations ─────────────────────────────────────────────────────────────────────────────── */

test('the ICS provider produces a file Outlook will accept', () => {
  const provider = createIcsCalendarProvider();
  const event = calendarEventFromMeeting(
    meeting({ status: 'Scheduled', description: 'Cash position; overdraft, and capex' }),
    [
      { name: 'Asha', email: 'asha@example.com', attendanceRole: 'Required' },
      { name: 'Ben', email: 'ben@example.com', attendanceRole: 'Optional' },
    ],
    { organizerEmail: 'asha@example.com', sequence: 2 },
  );
  const ics = provider.serialize(event);

  // CRLF throughout — Outlook rejects LF-only files, silently.
  assert.ok(ics.includes('\r\n'));
  assert.equal(ics.includes('\n\n'), false);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0'));
  assert.ok(ics.includes('END:VEVENT\r\nEND:VCALENDAR'));
  assert.ok(ics.includes('UID:office-hub-m1@sel-live'));
  assert.ok(ics.includes('DTSTART:20260921T043000Z'));
  assert.ok(ics.includes('DTEND:20260921T053000Z'));
  assert.ok(ics.includes('SEQUENCE:2'));
  assert.ok(ics.includes('STATUS:CONFIRMED'));
  assert.ok(ics.includes('ROLE=REQ-PARTICIPANT'));
  assert.ok(ics.includes('ROLE=OPT-PARTICIPANT'));
  // Semicolons and commas in text values must be escaped.
  assert.ok(ics.includes('Cash position\\; overdraft\\, and capex'));

  const cancelled = provider.serialize({ ...event, status: 'CANCELLED' });
  assert.ok(cancelled.includes('METHOD:CANCEL'));
  assert.ok(cancelled.includes('STATUS:CANCELLED'));

  assert.equal(icsFileName('Finance Review', '2026-09-21'), 'Finance Review-2026-09-21.ics');
});

test('long ICS lines are folded at 75 octets with a leading space', () => {
  const provider = createIcsCalendarProvider();
  const ics = provider.serialize(
    calendarEventFromMeeting(meeting({ title: 'A'.repeat(200) }), [], { sequence: 0 }),
  );
  const lines = ics.split('\r\n');
  for (const line of lines) {
    assert.ok(line.length <= 75, `line too long: ${line.slice(0, 40)}…`);
  }
  assert.ok(lines.some((line) => line.startsWith(' ')), 'continuation lines exist');
});

test('recurrenceRuleFor maps only the rules an external calendar reads the same way', () => {
  assert.equal(recurrenceRuleFor(null), null);
  assert.equal(recurrenceRuleFor({ frequency: 'None', interval: 1, endMode: 'never' }), null);
  assert.equal(recurrenceRuleFor({ frequency: 'Daily', interval: 1, endMode: 'never' }), 'FREQ=DAILY');
  assert.equal(
    recurrenceRuleFor({ frequency: 'Weekly', interval: 2, weekdays: [1, 3], endMode: 'after-occurrences', occurrences: 8 }),
    'FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2;COUNT=8',
  );
  assert.equal(
    recurrenceRuleFor({ frequency: 'Monthly', interval: 1, monthlyMode: 'weekday-of-month', weekday: 5, weekdayOrdinal: -1, endMode: 'on-date', endDate: '2026-12-31' }),
    'FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20261231T235959Z',
  );
  assert.equal(
    recurrenceRuleFor({ frequency: 'Monthly', interval: 1, monthlyMode: 'day-of-month', dayOfMonth: 7, endMode: 'never' }),
    'FREQ=MONTHLY;BYMONTHDAY=7',
  );
  assert.equal(recurrenceRuleFor({ frequency: 'Yearly', interval: 1, endMode: 'never' }), 'FREQ=YEARLY');
});

test('the manual meeting provider catches a link pasted against the wrong platform', () => {
  const teams = manualMeetingProvider('Microsoft Teams');
  assert.equal(teams.supportsCreation, false);
  assert.equal(teams.validateUrl('https://teams.microsoft.com/l/meetup-join/x').ok, true);

  const wrong = teams.validateUrl('https://zoom.us/j/123');
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /not a Microsoft Teams address/);

  assert.equal(teams.validateUrl('not a url').ok, false);
  assert.equal(teams.validateUrl('').ok, false);

  // "Other" accepts any https link, because that is what it is for.
  const other = manualMeetingProvider('Other');
  assert.equal(other.validateUrl('https://conference.example.com/room/9').ok, true);
});

test('a registered provider wins, and an unregistered platform still gets a working one', () => {
  const stub = {
    id: 'stub-zoom',
    platform: 'Zoom',
    label: 'Zoom (API)',
    supportsCreation: true,
    validateUrl: () => ({ ok: true, reason: null }),
    create: async () => ({ ok: true, joinUrl: 'https://zoom.us/j/created' }),
  };
  registerMeetingProvider(stub);

  assert.equal(getMeetingProvider('Zoom').id, 'stub-zoom');
  assert.equal(getMeetingProvider('Zoom').supportsCreation, true);
  assert.equal(getMeetingProvider('Google Meet').supportsCreation, false, 'falls back to the manual provider');
  assert.equal(getMeetingProvider(null).platform, 'Other');
});

test('email templates carry the meeting facts, a working link, and a text alternative', () => {
  const invitation = renderMeetingEmail('meeting-invitation', {
    meeting: meeting({ status: 'Scheduled', mode: 'Offline', location: 'Board Room', room: '3F' }),
    recipientName: 'Ben',
    baseUrl: 'https://erp.example.com',
    meetingId: 'm1',
    agendaTitles: ['Cash position', 'Capex'],
  });

  assert.match(invitation.subject, /^Invitation: Finance Review/);
  assert.match(invitation.html, /Board Room · 3F/);
  assert.match(invitation.html, /https:\/\/erp\.example\.com\/office-hub\/meetings\/m1/);
  assert.match(invitation.html, /<li>Cash position<\/li>/);
  assert.match(invitation.text, /Hello Ben/);
  assert.equal(invitation.text.includes('<'), false, 'the text part is not stripped HTML');

  const cancelled = renderMeetingEmail('meeting-cancelled', {
    meeting: meeting(),
    recipientName: 'Ben',
    baseUrl: 'https://erp.example.com',
    meetingId: 'm1',
    reason: 'no quorum',
  });
  assert.match(cancelled.subject, /^Cancelled:/);
  assert.match(cancelled.html, /no quorum/);

  const overdue = renderTaskEmail('task-overdue', {
    task: { title: 'Prepare reconciliation', reference: 'TSK-1', dueDate: '2026-09-11', priority: 'High', meetingTitle: 'Finance Review' },
    recipientName: 'Ben',
    overdueDays: 7,
    baseUrl: 'https://erp.example.com',
    taskId: 't1',
  });
  assert.match(overdue.subject, /^Overdue:/);
  assert.match(overdue.html, /7 days past its due date/);
  assert.match(overdue.html, /From meeting/);
});

test('resolveBaseUrl prefers configuration and never invents a host', () => {
  assert.equal(resolveBaseUrl('https://erp.example.com/'), 'https://erp.example.com');
  assert.equal(resolveBaseUrl(''), '', 'no window and no configuration means an honest blank');
  assert.equal(resolveBaseUrl(null), '');
});
