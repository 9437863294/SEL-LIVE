import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareEApprovalUrgency,
  eApprovalAgenda,
  eApprovalCoverageNotices,
  eApprovalMomentum,
  eApprovalRowIsQuickApprovable,
  eApprovalUrgencyOf,
  eApprovalWorkKindOf,
  eApprovalWorkQueue,
  projectEApprovalBreaches,
  staleEApprovalDrafts,
  summarizeEApprovalHolders,
} from '../src/lib/e-approval-policy.ts';

/* ── dashboard selectors: what to do first ──────────────────────────────────────────────────── */

const NOW = '2026-08-22T10:00:00.000Z';
const me = { userId: 'me', departmentId: 'd-fin' };
const withMe = (id, overrides = {}) => ({
  id,
  status: 'Pending Approval',
  requesterId: 'x',
  currentAssigneeIds: ['me'],
  currentStepType: 'APPROVAL',
  submittedAt: '2026-08-20T10:00:00.000Z',
  ...overrides,
});

test('urgency bands are rolling 24-hour windows, not calendar days', () => {
  assert.equal(eApprovalUrgencyOf({ currentDueAt: '2026-08-22T09:59:00.000Z' }, NOW), 'Overdue');
  assert.equal(eApprovalUrgencyOf({ currentDueAt: '2026-08-23T09:00:00.000Z' }, NOW), 'Due Today');
  assert.equal(eApprovalUrgencyOf({ currentDueAt: '2026-08-24T12:00:00.000Z' }, NOW), 'Due Soon');
  assert.equal(eApprovalUrgencyOf({ currentDueAt: '2026-08-30T10:00:00.000Z' }, NOW), 'On Track');
  assert.equal(eApprovalUrgencyOf({ currentDueAt: null }, NOW), 'No Clock');
});

test('the queue is ordered by consequence: overdue, then soonest, then priority, then amount, then age', () => {
  const rows = [
    withMe('on-track', { currentDueAt: '2026-08-30T10:00:00.000Z', amount: 9_000_000 }),
    withMe('no-clock-urgent', { priority: 'Urgent' }),
    withMe('no-clock-big', { amount: 5_000_000 }),
    withMe('overdue-recent', { currentDueAt: '2026-08-22T08:00:00.000Z' }),
    withMe('overdue-oldest', { currentDueAt: '2026-08-19T08:00:00.000Z' }),
    withMe('due-today', { currentDueAt: '2026-08-22T18:00:00.000Z' }),
    withMe('not-mine', { currentAssigneeIds: ['someone'] }),
    withMe('closed', { status: 'Approved', currentDueAt: '2026-08-19T08:00:00.000Z' }),
  ];
  const queue = eApprovalWorkQueue(rows, me, NOW);
  assert.deepEqual(
    queue.rows.map((row) => row.id),
    ['overdue-oldest', 'overdue-recent', 'due-today', 'on-track', 'no-clock-urgent', 'no-clock-big'],
  );
  assert.equal(queue.next.id, 'overdue-oldest');
  assert.deepEqual(queue.byUrgency, { Overdue: 2, 'Due Today': 1, 'Due Soon': 0, 'On Track': 1, 'No Clock': 2 });
  assert.equal(queue.valuePending, 14_000_000);
});

test('a big amount does not outrank a nearer deadline', () => {
  const a = withMe('a', { currentDueAt: '2026-08-23T09:00:00.000Z', amount: 100 });
  const b = withMe('b', { currentDueAt: '2026-08-23T08:00:00.000Z', amount: 1 });
  assert.ok(compareEApprovalUrgency(a, b, NOW) > 0, 'b is due an hour sooner, so it comes first');
});

test('work kinds count each task once', () => {
  const queue = eApprovalWorkQueue(
    [
      withMe('1'),
      withMe('2', { status: 'Pending Verification', currentStepType: 'VERIFICATION' }),
      withMe('3', { status: 'Pending Clarification', currentStepType: 'CLARIFICATION' }),
      withMe('4', { status: 'Returned', requesterId: 'me', currentStepType: null }),
      withMe('5', { status: 'Pending Approval', currentAssigneeIds: [], currentDepartmentIds: ['d-fin'] }),
    ],
    me,
    NOW,
  );
  assert.deepEqual(queue.byKind, { Approval: 2, Verification: 1, Clarification: 1, Correction: 1 });
  assert.equal(eApprovalWorkKindOf({ status: 'Pending Approval', currentStepType: 'REVIEW' }), 'Verification');
});

test('breach projections exclude what is already overdue and are cumulative across horizons', () => {
  const rows = [
    withMe('overdue', { currentDueAt: '2026-08-22T09:00:00.000Z', amount: 100 }),
    withMe('in-6h', { currentDueAt: '2026-08-22T16:00:00.000Z', amount: 1000 }),
    withMe('in-50h', { currentDueAt: '2026-08-24T12:00:00.000Z', amount: 10000 }),
    withMe('in-10d', { currentDueAt: '2026-09-01T10:00:00.000Z', amount: 100000 }),
    withMe('no-clock'),
  ];
  const [day, threeDays] = projectEApprovalBreaches(rows, NOW);
  assert.equal(day.withinHours, 24);
  assert.deepEqual(day.rows.map((row) => row.id), ['in-6h']);
  assert.equal(day.value, 1000);
  assert.equal(threeDays.withinHours, 72);
  assert.deepEqual(threeDays.rows.map((row) => row.id), ['in-6h', 'in-50h']);
  assert.equal(threeDays.value, 11000);
});

test('the agenda groups by calendar day and drops empty buckets', () => {
  const now = new Date(NOW);
  const at = (dayOffset, hour) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, 0, 0).toISOString();
  const rows = [
    withMe('later-today', { currentDueAt: at(0, 23) }),
    withMe('tomorrow', { currentDueAt: at(1, 9) }),
    withMe('friday', { currentDueAt: at(5, 9) }),
    withMe('next-month', { currentDueAt: at(20, 9) }),
    withMe('overdue', { currentDueAt: at(-1, 9) }),
    withMe('none'),
  ];
  const agenda = eApprovalAgenda(rows, NOW);
  assert.deepEqual(
    agenda.map((group) => [group.bucket, group.rows.map((row) => row.id)]),
    [
      ['Overdue', ['overdue']],
      ['Today', ['later-today']],
      ['Tomorrow', ['tomorrow']],
      ['This week', ['friday']],
      ['Later', ['next-month']],
      ['No deadline', ['none']],
    ],
  );
});

test('coverage notices read both directions of a live delegation and ignore expired ones', () => {
  const actor = {
    userId: 'me',
    delegations: [
      { id: 'd1', fromUserId: 'priya', fromUserName: 'Priya', toUserId: 'me', fromDate: '2026-08-20', toDate: '2026-08-25' },
      { id: 'd2', fromUserId: 'me', toUserId: 'rahul', toUserName: 'Rahul', fromDate: '2026-08-22', toDate: null },
      { id: 'd3', fromUserId: 'old', toUserId: 'me', fromDate: '2026-08-01', toDate: '2026-08-10' },
      { id: 'd4', fromUserId: 'future', toUserId: 'me', fromDate: '2026-09-01' },
      { id: 'd5', fromUserId: 'inactive', toUserId: 'me', fromDate: '2026-08-01', active: false },
      { id: 'd6', fromUserId: 'a', toUserId: 'b', fromDate: '2026-08-01' },
    ],
  };
  const notices = eApprovalCoverageNotices(actor, NOW);
  assert.deepEqual(
    notices.map((notice) => [notice.kind, notice.counterpartUserId, notice.until]),
    [
      ['covering', 'priya', '2026-08-25'],
      ['covered', 'rahul', null],
    ],
  );
  assert.equal(notices[0].counterpartName, 'Priya');
});

test('stale drafts are mine, untouched for the threshold, oldest first', () => {
  const rows = [
    { id: 'fresh', status: 'Draft', requesterId: 'me', updatedAt: '2026-08-21T10:00:00.000Z' },
    { id: 'old', status: 'Draft', requesterId: 'me', updatedAt: '2026-08-15T10:00:00.000Z' },
    { id: 'older-ts', status: 'Draft', requesterId: 'me', updatedAt: { toMillis: () => Date.parse('2026-08-10T10:00:00.000Z') } },
    { id: 'created-only', status: 'Draft', requesterId: 'me', createdAt: { seconds: Date.parse('2026-08-12T10:00:00.000Z') / 1000 } },
    { id: 'not-mine', status: 'Draft', requesterId: 'you', updatedAt: '2026-08-01T10:00:00.000Z' },
    { id: 'not-draft', status: 'Pending Approval', requesterId: 'me', updatedAt: '2026-08-01T10:00:00.000Z' },
  ];
  // Sorted by `updatedAt`; a row with only `createdAt` sorts first because it has no updatedAt at all.
  assert.deepEqual(staleEApprovalDrafts(rows, 'me', NOW).map((row) => row.id), ['created-only', 'older-ts', 'old']);
  assert.deepEqual(staleEApprovalDrafts(rows, 'me', NOW, 30), []);
});

test('holders are aggregated from the pending label with value, age and overdue count', () => {
  const rows = [
    { id: '1', status: 'Pending Approval', requesterId: 'me', pendingLabel: 'Pending with Director', amount: 100, submittedAt: '2026-08-10T10:00:00.000Z', currentDueAt: '2026-08-21T10:00:00.000Z' },
    { id: '2', status: 'Pending Verification', requesterId: 'me', pendingLabel: 'Verification pending with Finance', amount: 50, submittedAt: '2026-08-20T10:00:00.000Z' },
    { id: '3', status: 'Pending Approval', requesterId: 'me', pendingLabel: 'Pending with Director', amount: 200, submittedAt: '2026-08-21T10:00:00.000Z', currentDueAt: '2026-08-30T10:00:00.000Z' },
    { id: '4', status: 'Approved', requesterId: 'me', pendingLabel: 'Pending with Director' },
    { id: '5', status: 'Pending Approval', requesterId: 'you', pendingLabel: 'Pending with Director' },
    { id: '6', status: 'Pending Approval', requesterId: 'me' },
  ];
  const holders = summarizeEApprovalHolders(rows, 'me', NOW);
  assert.deepEqual(
    holders.map((holder) => [holder.holder, holder.count, holder.oldestDays, holder.overdue, holder.value]),
    [
      ['Director', 2, 12, 1, 300],
      ['Finance', 1, 2, 0, 50],
      ['Unassigned', 1, 0, 0, 0],
    ],
  );
  assert.deepEqual(holders[0].requestIds, ['1', '3']);
});

test('momentum compares this month with last, with a median cycle time', () => {
  const rows = [
    { id: 'a', status: 'Approved', requesterId: 'me', submittedAt: '2026-08-01T10:00:00.000Z', completedAt: '2026-08-03T10:00:00.000Z', amount: 100 },
    { id: 'b', status: 'Approved', requesterId: 'me', submittedAt: '2026-08-02T10:00:00.000Z', completedAt: '2026-08-06T10:00:00.000Z', amount: 300 },
    { id: 'c', status: 'Rejected', requesterId: 'me', submittedAt: '2026-08-05T10:00:00.000Z', completedAt: '2026-08-07T10:00:00.000Z' },
    { id: 'd', status: 'Pending Approval', requesterId: 'me', submittedAt: '2026-08-20T10:00:00.000Z' },
    { id: 'e', status: 'Approved', requesterId: 'me', submittedAt: '2026-07-01T10:00:00.000Z', completedAt: '2026-07-11T10:00:00.000Z', amount: 1000 },
    { id: 'f', status: 'Approved', requesterId: 'me', submittedAt: '2026-07-20T10:00:00.000Z', completedAt: '2026-08-01T10:00:00.000Z' },
  ];
  const momentum = eApprovalMomentum(rows, NOW, 'month');
  assert.equal(momentum.current.raised, 4);
  assert.equal(momentum.current.approved, 3, 'f closed in August even though it was raised in July');
  assert.equal(momentum.current.rejected, 1);
  assert.equal(momentum.current.approvedValue, 400);
  assert.equal(momentum.current.medianCycleHours, 96, 'median of 48h, 96h and 288h');
  assert.equal(momentum.previous.raised, 2);
  assert.equal(momentum.previous.approved, 1);
  assert.equal(momentum.previous.medianCycleHours, 240);
});

test('weekly momentum starts on Monday', () => {
  // 22 Aug 2026 is a Saturday; the week began on Monday 17 Aug.
  const rows = [
    { id: 'this-week', status: 'Pending Approval', requesterId: 'me', submittedAt: '2026-08-17T10:00:00.000Z' },
    { id: 'last-week', status: 'Pending Approval', requesterId: 'me', submittedAt: '2026-08-16T10:00:00.000Z' },
  ];
  const momentum = eApprovalMomentum(rows, NOW, 'week');
  assert.equal(momentum.current.raised, 1);
  assert.equal(momentum.previous.raised, 1);
});

/* ── quick-approve eligibility ───────────────────────────────────────────────────────────────── */

test('a plain approval assigned by name, alone, is quick-approvable', () => {
  const row = withMe('plain');
  assert.equal(eApprovalRowIsQuickApprovable(row, me), true);
});

test('a department or role step is never quick-approvable, even if the actor is also named directly', () => {
  assert.equal(
    eApprovalRowIsQuickApprovable(withMe('dept', { currentDepartmentIds: ['d-fin'] }), me),
    false,
  );
  assert.equal(eApprovalRowIsQuickApprovable(withMe('role', { currentRoles: ['Director'] }), me), false);
});

test('a parallel group — more than one assignee or more than one open step — is never quick-approvable', () => {
  assert.equal(
    eApprovalRowIsQuickApprovable(withMe('group', { currentAssigneeIds: ['me', 'other'] }), me),
    false,
  );
  assert.equal(
    eApprovalRowIsQuickApprovable(withMe('two-steps', { currentStepIds: ['s1', 's2'] }), me),
    false,
  );
});

test('verification, clarification, correction and closed files are never quick-approvable', () => {
  assert.equal(
    eApprovalRowIsQuickApprovable(withMe('v', { status: 'Pending Verification', currentStepType: 'VERIFICATION' }), me),
    false,
  );
  assert.equal(
    eApprovalRowIsQuickApprovable(withMe('c', { status: 'Pending Clarification', currentStepType: 'CLARIFICATION' }), me),
    false,
  );
  assert.equal(eApprovalRowIsQuickApprovable(withMe('r', { status: 'Returned' }), me), false);
  assert.equal(eApprovalRowIsQuickApprovable(withMe('done', { status: 'Approved' }), me), false);
});

test('a file not assigned to this actor by name is never quick-approvable', () => {
  assert.equal(eApprovalRowIsQuickApprovable(withMe('other', { currentAssigneeIds: ['someone-else'] }), me), false);
});
