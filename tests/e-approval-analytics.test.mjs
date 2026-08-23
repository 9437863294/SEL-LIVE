import test from 'node:test';
import assert from 'node:assert/strict';
// The analytics module is dependency-free for the same reason the policy module is: these numbers get
// quoted to a board, so they are tested rather than eyeballed on a chart.
import {
  compareEApprovalKpis,
  computeEApprovalKpis,
  durationStats,
  eApprovalAgeBucketOf,
  eApprovalClosureRates,
  eApprovalTrend,
  filterEApprovalRows,
  oldestPendingEApprovals,
  percentOf,
  requestCycleHours,
  rollupEApprovals,
  stepHeldHours,
  summarizeEApprovalAging,
  summarizeEApprovalApprovers,
  summarizeEApprovalBottleneckApprovers,
  summarizeEApprovalBottleneckSteps,
  summarizeEApprovalRework,
  summarizeEApprovalSla,
  summarizeEApprovalStatuses,
  summarizeEApprovalValueBands,
  summarizeEApprovalVerification,
} from '../src/lib/e-approval-analytics.ts';

const NOW = '2026-08-22T12:00:00.000Z';
const HOUR = 3_600_000;
const hoursAgo = (n) => new Date(new Date(NOW).getTime() - n * HOUR).toISOString();

const req = (over = {}) => ({
  id: over.id ?? 'r1',
  status: 'Pending Approval',
  requesterId: 'u-req',
  priority: 'Normal',
  submittedAt: hoursAgo(10),
  ...over,
});

const step = (over = {}) => ({
  id: over.id ?? 's1',
  approvalId: over.approvalId ?? 'r1',
  name: over.name ?? 'Manager',
  type: 'APPROVAL',
  depth: 0,
  status: 'Completed',
  ...over,
});

/* ── primitives ──────────────────────────────────────────────────────────────────────────────── */

test('percentages refuse to divide by nothing', () => {
  assert.equal(percentOf(3, 4), 75);
  assert.equal(percentOf(0, 0), null, 'null, not 0% — a rate over no cases is not zero, it is unknown');
});

test('duration stats report median and p90, not just the mean', () => {
  // One outlier: the mean says 21h, the median says 3h. Both are true; only one is typical.
  const stats = durationStats([1, 2, 3, 4, 200]);
  assert.equal(stats.count, 5);
  assert.equal(stats.mean, 42);
  assert.equal(stats.median, 3);
  assert.equal(stats.p90, 200);
  assert.equal(stats.min, 1);
  assert.equal(stats.max, 200);
});

test('duration stats average the two middle values on an even count', () => {
  assert.equal(durationStats([2, 4, 6, 8]).median, 5);
  assert.deepEqual(durationStats([]).count, 0);
  assert.equal(durationStats([-5, Number.NaN, 4]).count, 1, 'nonsense values are dropped, not counted as zero');
});

test('held time excludes paused time', () => {
  const held = stepHeldHours(
    step({ startedAt: hoursAgo(10), completedAt: hoursAgo(2), pausedMs: 3 * HOUR }),
    NOW,
  );
  assert.equal(held, 5, 'eight hours elapsed, three of them waiting on somebody else');
});

test('a still-running step is measured up to now', () => {
  assert.equal(stepHeldHours(step({ startedAt: hoursAgo(4), completedAt: null }), NOW), 4);
  assert.equal(stepHeldHours(step({ startedAt: null }), NOW), null);
});

test('cycle time is submission to closure, and null while open', () => {
  assert.equal(requestCycleHours(req({ submittedAt: hoursAgo(30), completedAt: hoursAgo(6) })), 24);
  assert.equal(requestCycleHours(req({ completedAt: null })), null);
});

/* ── filters ─────────────────────────────────────────────────────────────────────────────────── */

test('the date range filters on submission, so a draft is never in it', () => {
  const rows = [
    req({ id: 'in', submittedAt: '2026-06-15T00:00:00.000Z' }),
    req({ id: 'out', submittedAt: '2026-05-15T00:00:00.000Z' }),
    req({ id: 'draft', status: 'Draft', submittedAt: null }),
  ];
  const kept = filterEApprovalRows(rows, { from: '2026-06-01', to: '2026-06-30' });
  assert.deepEqual(kept.map((row) => row.id), ['in']);
});

test('the end of a date range includes the whole day', () => {
  const rows = [req({ id: 'late', submittedAt: '2026-06-30T23:30:00.000Z' })];
  assert.equal(filterEApprovalRows(rows, { from: '2026-06-01', to: '2026-06-30' }).length, 1);
});

test('filters combine, and an empty list means "no restriction"', () => {
  const rows = [
    req({ id: 'a', departmentId: 'd1', amount: 5000, priority: 'High', currentAssigneeIds: ['u-1'] }),
    req({ id: 'b', departmentId: 'd2', amount: 900000 }),
  ];
  assert.deepEqual(filterEApprovalRows(rows, { departmentIds: [] }).length, 2);
  assert.deepEqual(filterEApprovalRows(rows, { departmentIds: ['d1'] }).map((r) => r.id), ['a']);
  assert.deepEqual(filterEApprovalRows(rows, { minAmount: 100000 }).map((r) => r.id), ['b']);
  assert.deepEqual(filterEApprovalRows(rows, { priorities: ['High'] }).map((r) => r.id), ['a']);
  assert.deepEqual(filterEApprovalRows(rows, { assigneeIds: ['u-1'] }).map((r) => r.id), ['a']);
});

test('search covers reference, subject, requester and pending-with', () => {
  const rows = [req({ id: 'a', referenceNo: 'EA/FIN/2026-27/00125', subject: 'Safety helmets' })];
  assert.equal(filterEApprovalRows(rows, { search: 'fin/2026' }).length, 1);
  assert.equal(filterEApprovalRows(rows, { search: 'helmet' }).length, 1);
  assert.equal(filterEApprovalRows(rows, { search: 'vehicle' }).length, 0);
});

/* ── KPIs ────────────────────────────────────────────────────────────────────────────────────── */

test('KPIs separate an overdue request from a breached step', () => {
  const rows = [
    req({ id: 'r1', currentDueAt: hoursAgo(2), amount: 100000 }),
    req({ id: 'r2', currentDueAt: hoursAgo(-5), amount: 50000 }),
    req({ id: 'r3', status: 'Approved', submittedAt: hoursAgo(30), completedAt: hoursAgo(6), amount: 200000 }),
  ];
  const steps = [
    // Ran past its clock but has since completed — a breach, not an overdue queue item.
    step({ id: 's1', approvalId: 'r3', startedAt: hoursAgo(30), completedAt: hoursAgo(6), dueAt: hoursAgo(20) }),
    step({ id: 's2', approvalId: 'r1', status: 'Active', startedAt: hoursAgo(10), completedAt: null, dueAt: hoursAgo(2) }),
  ];
  const kpis = computeEApprovalKpis(rows, steps, { now: NOW });

  assert.equal(kpis.raised, 3);
  assert.equal(kpis.pending, 2);
  assert.equal(kpis.approved, 1);
  assert.equal(kpis.overdue, 1, 'only r1 is a live overdue file');
  assert.equal(kpis.slaBreached, 2, 'both steps ran past their clock');
  assert.equal(kpis.valuePending, 150000);
  assert.equal(kpis.valueApproved, 200000);
  assert.equal(kpis.valueAtRisk, 100000, 'exposure is the pending value that is already late');
  assert.equal(kpis.cycleHours.median, 24);
  assert.equal(kpis.oldestPendingHours, 10);
});

test('escalated counts requests, not escalation events', () => {
  const ladder = [
    { id: 'remind-24', afterHours: 24, kind: 'Reminder', level: 'Level 1' },
    { id: 'escalate-72', afterHours: 72, kind: 'Escalation', level: 'Level 3' },
  ];
  const steps = [
    step({ id: 's1', approvalId: 'r1', escalationsSent: ['remind-24', 'escalate-72'] }),
    step({ id: 's2', approvalId: 'r1', escalationsSent: ['escalate-72'] }),
    step({ id: 's3', approvalId: 'r2', escalationsSent: ['remind-24'] }),
  ];
  const kpis = computeEApprovalKpis([req({ id: 'r1' }), req({ id: 'r2' })], steps, { now: NOW, escalationLadder: ladder });
  assert.equal(kpis.escalated, 1, 'two escalated steps on one request is one escalated request');
});

test('period comparison uses the equivalent preceding span', () => {
  const rows = [
    req({ id: 'now1', submittedAt: hoursAgo(2) }),
    req({ id: 'now2', submittedAt: hoursAgo(10) }),
    req({ id: 'prev', submittedAt: hoursAgo(30) }),
  ];
  const result = compareEApprovalKpis(rows, [], { now: NOW, period: 'day' });
  assert.equal(result.current.raised, 2);
  assert.equal(result.previous.raised, 1);
  assert.equal(result.delta.raised.change, 1);
  assert.equal(result.delta.raised.percent, 100);
});

test('a delta against zero reports null rather than infinity', () => {
  const rows = [req({ id: 'a', submittedAt: hoursAgo(1) })];
  const result = compareEApprovalKpis(rows, [], { now: NOW, period: 'day' });
  assert.equal(result.previous.raised, 0);
  assert.equal(result.delta.raised.percent, null);
});

/* ── status & aging ──────────────────────────────────────────────────────────────────────────── */

test('status distribution carries counts, value and share', () => {
  const slices = summarizeEApprovalStatuses([
    req({ id: 'a', status: 'Approved', amount: 100 }),
    req({ id: 'b', status: 'Approved', amount: 200 }),
    req({ id: 'c', status: 'Rejected' }),
  ]);
  assert.equal(slices[0].status, 'Approved');
  assert.equal(slices[0].count, 2);
  assert.equal(slices[0].value, 300);
  assert.equal(slices[0].percent, 66.7);
});

test('age buckets follow the spec boundaries', () => {
  assert.equal(eApprovalAgeBucketOf(0), '0–4 hours');
  assert.equal(eApprovalAgeBucketOf(3.9), '0–4 hours');
  assert.equal(eApprovalAgeBucketOf(4), '4–8 hours');
  assert.equal(eApprovalAgeBucketOf(24), '1–2 days');
  assert.equal(eApprovalAgeBucketOf(47), '1–2 days');
  assert.equal(eApprovalAgeBucketOf(48), '3–5 days');
  assert.equal(eApprovalAgeBucketOf(719), '16–30 days');
  assert.equal(eApprovalAgeBucketOf(721), 'Above 30 days');
  assert.equal(eApprovalAgeBucketOf(null), null);
});

test('aging counts only the open pile, and always returns all nine buckets', () => {
  const rows = [
    req({ id: 'a', submittedAt: hoursAgo(2), amount: 1000, currentDueAt: hoursAgo(1) }),
    req({ id: 'b', submittedAt: hoursAgo(50), amount: 2000, priority: 'Urgent' }),
    req({ id: 'closed', status: 'Approved', submittedAt: hoursAgo(100), completedAt: hoursAgo(1) }),
  ];
  const aging = summarizeEApprovalAging(rows, { now: NOW });
  assert.equal(aging.length, 9, 'empty buckets are kept so the chart has no gaps');
  const first = aging.find((row) => row.bucket === '0–4 hours');
  assert.equal(first.count, 1);
  assert.equal(first.overdue, 1);
  const older = aging.find((row) => row.bucket === '3–5 days');
  assert.equal(older.count, 1);
  assert.equal(older.urgent, 1);
  assert.equal(aging.reduce((sum, row) => sum + row.count, 0), 2, 'the closed request is not aging');
});

test('the oldest-pending table sorts worst first and resolves escalation level', () => {
  const ladder = [
    { id: 'l1', afterHours: 24, kind: 'Reminder', level: 'Level 1' },
    { id: 'l3', afterHours: 72, kind: 'Escalation', level: 'Level 3' },
  ];
  const rows = [
    req({ id: 'young', submittedAt: hoursAgo(5) }),
    req({ id: 'old', submittedAt: hoursAgo(200), currentDueAt: hoursAgo(100) }),
  ];
  const steps = [step({ id: 's1', approvalId: 'old', escalationsSent: ['l1', 'l3'] })];
  const table = oldestPendingEApprovals(rows, steps, { now: NOW, escalationLadder: ladder });
  assert.deepEqual(table.map((row) => row.id), ['old', 'young']);
  assert.equal(table[0].escalationLevel, 'Level 3', 'the highest level reached, not the first fired');
  assert.equal(table[0].overdue, true);
  assert.equal(table[1].escalationLevel, null);
});

/* ── bottlenecks ─────────────────────────────────────────────────────────────────────────────── */

test('bottleneck approvers report the queue alongside what they clear', () => {
  const steps = [
    step({ id: 's1', status: 'Active', assignment: { kind: 'User', userId: 'u-a', userName: 'Slow Sam' }, startedAt: hoursAgo(30), completedAt: null, dueAt: hoursAgo(6), amount: 5000 }),
    step({ id: 's2', status: 'Active', assignment: { kind: 'User', userId: 'u-a', userName: 'Slow Sam' }, startedAt: hoursAgo(10), completedAt: null, amount: 1000 }),
    step({ id: 's3', actedByUserId: 'u-b', actedByName: 'Fast Fay', startedAt: hoursAgo(9), completedAt: hoursAgo(8) }),
  ];
  const rows = summarizeEApprovalBottleneckApprovers(steps, { now: NOW });
  const sam = rows.find((row) => row.name === 'Slow Sam');
  assert.equal(sam.pending, 2);
  assert.equal(sam.overdue, 1);
  assert.equal(sam.oldestPendingHours, 30);
  assert.equal(sam.averagePendingHours, 20);
  assert.equal(sam.slaBreaches, 1);
  assert.equal(sam.pendingValue, 6000);

  const fay = rows.find((row) => row.name === 'Fast Fay');
  assert.equal(fay.pending, 0);
  assert.equal(fay.completed, 1);
  assert.equal(fay.averageHeldHours, 1);
});

test('bottleneck steps rank by median processing time and expose return rate', () => {
  const steps = [
    step({ id: '1', name: 'Finance', startedAt: hoursAgo(50), completedAt: hoursAgo(2) }),
    step({ id: '2', name: 'Finance', startedAt: hoursAgo(40), completedAt: hoursAgo(4) }),
    step({ id: '3', name: 'Manager', startedAt: hoursAgo(5), completedAt: hoursAgo(4), outcome: 'Returned' }),
    step({ id: '4', name: 'Manager', startedAt: hoursAgo(6), completedAt: hoursAgo(5) }),
  ];
  const ranked = summarizeEApprovalBottleneckSteps(steps, { now: NOW });
  assert.equal(ranked[0].workflowStep, 'Finance', 'the slow stage leads');
  assert.equal(ranked[0].cases, 2);
  assert.equal(ranked[0].processing.median, 42);
  const manager = ranked.find((row) => row.workflowStep === 'Manager');
  assert.equal(manager.returnPercent, 50);
});

/* ── SLA ─────────────────────────────────────────────────────────────────────────────────────── */

test('SLA splits within, approaching and breached, and shows its denominator', () => {
  const steps = [
    // Finished in time.
    step({ id: 'ok', startedAt: hoursAgo(10), completedAt: hoursAgo(8), dueAt: hoursAgo(2) }),
    // Finished late.
    step({ id: 'late', startedAt: hoursAgo(20), completedAt: hoursAgo(2), dueAt: hoursAgo(6) }),
    // Running, 90% consumed.
    step({ id: 'soon', status: 'Active', startedAt: hoursAgo(9), completedAt: null, dueAt: hoursAgo(-1) }),
    // Running, plenty left.
    step({ id: 'fine', status: 'Active', startedAt: hoursAgo(1), completedAt: null, dueAt: hoursAgo(-23) }),
    // No clock at all.
    step({ id: 'none', startedAt: hoursAgo(5), completedAt: hoursAgo(4), dueAt: null }),
  ];
  const sla = summarizeEApprovalSla(steps, { now: NOW });
  assert.equal(sla.measured, 4, 'the clockless step is excluded from the denominator');
  assert.equal(sla.noClock, 1);
  assert.equal(sla.breached, 1);
  assert.equal(sla.approaching, 1);
  assert.equal(sla.withinSla, 2);
  assert.equal(sla.compliancePercent, 75);
});

test('SLA levels count distinct approvals per level', () => {
  const ladder = [
    { id: 'a', afterHours: 24, kind: 'Reminder', level: 'Level 1' },
    { id: 'b', afterHours: 72, kind: 'Escalation', level: 'Level 3' },
  ];
  const sla = summarizeEApprovalSla(
    [
      step({ id: '1', approvalId: 'r1', escalationsSent: ['a'] }),
      step({ id: '2', approvalId: 'r1', escalationsSent: ['a', 'b'] }),
      step({ id: '3', approvalId: 'r2', escalationsSent: ['b'] }),
    ],
    { now: NOW, escalationLadder: ladder },
  );
  assert.deepEqual(sla.byLevel, [
    { level: 'Level 1', approvals: 1 },
    { level: 'Level 3', approvals: 2 },
  ]);
});

/* ── approver performance ────────────────────────────────────────────────────────────────────── */

test('performance is attributed to whoever acted, with delegation visible', () => {
  const steps = [
    step({ id: '1', actedByUserId: 'u-cfo', actedByName: 'CFO', onBehalfOfUserId: 'u-dir', outcome: 'Approved', startedAt: hoursAgo(4), completedAt: hoursAgo(2) }),
    step({ id: '2', actedByUserId: 'u-cfo', actedByName: 'CFO', outcome: 'Returned', startedAt: hoursAgo(8), completedAt: hoursAgo(7) }),
    step({ id: '3', actedByUserId: 'u-cfo', actedByName: 'CFO', outcome: 'Skipped', startedAt: hoursAgo(9), completedAt: hoursAgo(9) }),
  ];
  const [cfo] = summarizeEApprovalApprovers(steps, { now: NOW });
  assert.equal(cfo.name, 'CFO');
  assert.equal(cfo.assigned, 3);
  assert.equal(cfo.approved, 1);
  assert.equal(cfo.returned, 1);
  assert.equal(cfo.skipped, 1);
  assert.equal(cfo.onBehalfOf, 1, 'the delegated action is flagged, not hidden');
  // Rates divide by decisions (2), never by the skipped step.
  assert.equal(cfo.approvalRatePercent, 50);
  assert.equal(cfo.returnRatePercent, 50);
  assert.equal(cfo.response.median, 1.5);
});

/* ── rollups ─────────────────────────────────────────────────────────────────────────────────── */

test('a dimension rollup handles the unassigned bucket', () => {
  const rows = [
    req({ id: 'a', departmentId: 'd1', departmentName: 'Finance', status: 'Approved', submittedAt: hoursAgo(20), completedAt: hoursAgo(8), amount: 100 }),
    req({ id: 'b', departmentId: 'd1', departmentName: 'Finance', status: 'Rejected' }),
    req({ id: 'c', amount: 50, currentDueAt: hoursAgo(1) }),
  ];
  const rollup = rollupEApprovals(rows, 'department', { now: NOW });
  const finance = rollup.find((row) => row.label === 'Finance');
  assert.equal(finance.raised, 2);
  assert.equal(finance.approved, 1);
  assert.equal(finance.rejected, 1);
  assert.equal(finance.approvalRatePercent, 50);
  assert.equal(finance.cycleHours.median, 12);

  const unassigned = rollup.find((row) => row.label === 'Unassigned');
  assert.equal(unassigned.pending, 1);
  assert.equal(unassigned.overdue, 1);
  assert.equal(unassigned.valuePending, 50);
});

/* ── rework ──────────────────────────────────────────────────────────────────────────────────── */

test('rework counts every return from the event log, not just the last per step', () => {
  const rows = [req({ id: 'r1', supersededCount: 1 }), req({ id: 'r2' }), req({ id: 'r3' })];
  const events = [
    { id: 'e1', approvalId: 'r1', at: hoursAgo(9), kind: 'Return', actorId: 'u', stepName: 'Finance' },
    { id: 'e2', approvalId: 'r1', at: hoursAgo(5), kind: 'Return', actorId: 'u', stepName: 'Finance' },
    { id: 'e3', approvalId: 'r2', at: hoursAgo(4), kind: 'Return', actorId: 'u', stepName: 'Director' },
    { id: 'e4', approvalId: 'r2', at: hoursAgo(3), kind: 'Approve', actorId: 'u' },
  ];
  const rework = summarizeEApprovalRework(rows, [], events);
  assert.equal(rework.totalReturns, 3);
  assert.equal(rework.requestsReturned, 2);
  assert.equal(rework.repeatedlyReturned, 1, 'r1 went back twice');
  assert.equal(rework.averageReturnsPerRequest, 1.5);
  assert.equal(rework.returnRatePercent, 66.7);
  assert.equal(rework.requestsSuperseded, 1);
  assert.deepEqual(rework.byStep[0], { stepName: 'Finance', returns: 2 });
});

test('rework falls back to step outcomes when no events are supplied', () => {
  const rework = summarizeEApprovalRework(
    [req({ id: 'r1' })],
    [step({ id: 's1', approvalId: 'r1', outcome: 'Returned', name: 'Manager' })],
    [],
  );
  assert.equal(rework.totalReturns, 1);
  assert.deepEqual(rework.byStep[0], { stepName: 'Manager', returns: 1 });
});

/* ── verification ────────────────────────────────────────────────────────────────────────────── */

test('verification analytics separate depth, outcome and nesting', () => {
  const steps = [
    step({ id: 'p', depth: 0, type: 'APPROVAL' }),
    step({ id: 'v1', depth: 1, type: 'VERIFICATION', outcome: 'Verified', actedByName: 'Finance', startedAt: hoursAgo(6), completedAt: hoursAgo(4) }),
    step({ id: 'v2', depth: 2, type: 'VERIFICATION', outcome: 'Not Verified', actedByName: 'Accounts', startedAt: hoursAgo(4), completedAt: hoursAgo(3) }),
    step({ id: 'v3', depth: 1, type: 'VERIFICATION', status: 'Active', completedAt: null, actedByName: null, assignment: { userName: 'Legal' } }),
    step({ id: 'c1', depth: 1, type: 'CLARIFICATION', outcome: 'Clarified' }),
  ];
  const summary = summarizeEApprovalVerification(steps, [req({ id: 'r1' })], { now: NOW });
  assert.equal(summary.raised, 3, 'clarifications are counted separately');
  assert.equal(summary.clarifications, 1);
  assert.equal(summary.verified, 1);
  assert.equal(summary.notVerified, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.maxDepth, 2);
  assert.equal(summary.nestedCount, 1, 'one verification of a verification');
  assert.equal(summary.turnaround.median, 1.5);
});

/* ── value bands, trend, closure ─────────────────────────────────────────────────────────────── */

test('value bands tile the money line and always return every band', () => {
  const bands = summarizeEApprovalValueBands([
    req({ id: 'a', amount: 25000 }),
    req({ id: 'b', amount: 25001, status: 'Approved' }),
    req({ id: 'c', amount: 20_000_000 }),
    req({ id: 'none' }),
  ]);
  assert.equal(bands.length, 6);
  assert.equal(bands[0].count, 1);
  assert.equal(bands[1].approved, 1);
  assert.equal(bands[5].band, 'Above ₹1 crore');
  assert.equal(bands[5].count, 1);
  assert.equal(bands.reduce((sum, row) => sum + row.count, 0), 3, 'a request with no amount is in no band');
});

test('the trend pre-seeds empty buckets so a quiet month is a zero, not a gap', () => {
  const trend = eApprovalTrend([req({ id: 'a', submittedAt: NOW })], { now: NOW, granularity: 'month', buckets: 3 });
  assert.equal(trend.length, 3);
  assert.equal(trend[2].raised, 1);
  assert.equal(trend[0].raised, 0);
});

test('closure rate ignores drafts', () => {
  const rates = eApprovalClosureRates([
    req({ id: 'a', status: 'Approved' }),
    req({ id: 'b', status: 'Pending Approval' }),
    req({ id: 'c', status: 'Draft' }),
  ]);
  assert.equal(rates.submitted, 2);
  assert.equal(rates.closed, 1);
  assert.equal(rates.open, 1);
  assert.equal(rates.closureRatePercent, 50);
});
