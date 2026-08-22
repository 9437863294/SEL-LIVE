import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from the policy module rather than `e-approval.ts`, which re-exports Firestore-client
// types that only resolve inside the bundler.
import {
  applyEApprovalAction,
  availableEApprovalActions,
  buildEApprovalSteps,
  canActOnEApprovalStep,
  canTakeEApprovalOwnership,
  canViewEApproval,
  DEFAULT_E_APPROVAL_ESCALATION_LADDER,
  describeEApprovalAssignment,
  describeEApprovalMaterialChange,
  detectEApprovalMaterialChange,
  deriveEApprovalStatus,
  eApprovalAgeingBucket,
  eApprovalDepartmentCode,
  eApprovalDueAt,
  eApprovalGroupState,
  eApprovalPendingLabel,
  eApprovalReference,
  eApprovalReturnTargets,
  eApprovalSlaState,
  eApprovalStepChain,
  eApprovalStepSla,
  eApprovalTimeline,
  EApprovalRuleError,
  financialYearForEApprovalDate,
  formatEApprovalDuration,
  isChildEApprovalStep,
  resolveDueEApprovalEscalations,
  resolveEApprovalDelegate,
  resolveEApprovalRouting,
  summarizeEApprovalDashboard,
} from '../src/lib/e-approval-policy.ts';

/* ── harness ─────────────────────────────────────────────────────────────────────────────────── */

/** Deterministic ids, so a failing assertion names the same step on every run. */
const makeIdFactory = () => {
  let n = 0;
  return (seed) => `${seed}#${(n += 1)}`;
};

const user = (id, name) => ({ kind: 'User', userId: id, userName: name });

const requester = { userId: 'u-req', userName: 'Debaprasad' };

function scenario(templateSteps, overrides = {}) {
  const nextId = makeIdFactory();
  const steps = buildEApprovalSteps(templateSteps, { nextId, priority: 'Normal' });
  const request = {
    id: 'EA1',
    referenceNo: 'EA/2026-27/00001',
    status: 'Draft',
    version: 1,
    requesterId: requester.userId,
    requesterName: requester.userName,
    priority: 'Normal',
    ...overrides,
  };
  return { request, steps, nextId, events: [], notifications: [] };
}

/**
 * `events`/`notifications` are the last transition's; `allEvents`/`allNotifications` accumulate, so a
 * test can assert on one action or on the whole trail without the two getting confused.
 */
function act(state, input) {
  const result = applyEApprovalAction(state.request, state.steps, { nextId: state.nextId, ...input });
  return {
    ...state,
    ...result,
    allEvents: [...(state.allEvents ?? []), ...result.events],
    allNotifications: [...(state.allNotifications ?? []), ...result.notifications],
  };
}

/** The step whose name starts with `name`, or the only Active step when name is omitted. */
const stepNamed = (state, name) => state.steps.find((step) => step.name.startsWith(name));
const activeSteps = (state) => state.steps.filter((step) => step.status === 'Active');
const onlyActive = (state) => {
  const active = activeSteps(state);
  assert.equal(active.length, 1, `expected one active step, got ${active.map((s) => s.name).join(', ') || 'none'}`);
  return active[0];
};

const serialChain = [
  { id: 't1', name: 'Manager', assignments: [user('u-mgr', 'Manager')], slaHours: 24 },
  { id: 't2', name: 'Finance', assignments: [user('u-fin', 'Finance Manager')], slaHours: 24 },
  { id: 't3', name: 'Director', assignments: [user('u-dir', 'Director')], slaHours: 48 },
  { id: 't4', name: 'ED', assignments: [user('u-ed', 'ED')], slaHours: 48 },
];

/** Submits `chain` and returns the state with the first step active. */
const submitted = (chain = serialChain, overrides) =>
  act(scenario(chain, overrides), { kind: 'Submit', actor: requester, now: '2026-08-22T10:00:00.000Z' });

/* ── numbering, dates and formatting ─────────────────────────────────────────────────────────── */

test('financial year runs April to March', () => {
  assert.equal(financialYearForEApprovalDate(new Date(2026, 7, 22)), '2026-27');
  assert.equal(financialYearForEApprovalDate(new Date(2027, 1, 10)), '2026-27');
  assert.equal(financialYearForEApprovalDate(new Date(2027, 3, 1)), '2027-28');
});

test('reference numbers carry the department code and the financial year', () => {
  const date = new Date(2026, 7, 22);
  assert.equal(eApprovalReference(125, { departmentCode: 'FIN', date }), 'EA/FIN/2026-27/00125');
  assert.equal(
    eApprovalReference(1, { date, settings: { includeDepartmentCode: false, sequenceWidth: 6 } }),
    'EA/2026-27/000001',
  );
  // A department code is simply omitted when the setting is on but the code is unknown, rather than
  // producing `EA//2026-27/00001`.
  assert.equal(eApprovalReference(1, { date }), 'EA/2026-27/00001');
});

test('department codes take the first significant word', () => {
  assert.equal(eApprovalDepartmentCode('Finance & Accounts'), 'FIN');
  assert.equal(eApprovalDepartmentCode('Purchase'), 'PUR');
  assert.equal(eApprovalDepartmentCode('HR'), 'HR');
  assert.equal(eApprovalDepartmentCode('Office of the Director'), 'OFF');
  assert.equal(eApprovalDepartmentCode(''), '');
});

test('durations read as an SLA line', () => {
  assert.equal(formatEApprovalDuration(19 * 3_600_000 + 25 * 60_000), '19h 25m');
  assert.equal(formatEApprovalDuration(3 * 86_400_000 + 4 * 3_600_000), '3d 4h');
  assert.equal(formatEApprovalDuration(30_000), 'just now');
});

test('SLA hours scale with priority', () => {
  assert.equal(eApprovalStepSla(24, 'Normal'), 24);
  assert.equal(eApprovalStepSla(24, 'Urgent'), 6);
  assert.equal(eApprovalStepSla(24, 'Low'), 36);
  // No template SLA falls back to the settings default, never to zero (which would mean "no clock").
  assert.equal(eApprovalStepSla(undefined, 'Normal'), 24);
});

test('due date includes paused time', () => {
  assert.equal(eApprovalDueAt('2026-08-22T10:00:00.000Z', 24), '2026-08-23T10:00:00.000Z');
  assert.equal(
    eApprovalDueAt('2026-08-22T10:00:00.000Z', 24, 2 * 3_600_000),
    '2026-08-23T12:00:00.000Z',
  );
  assert.equal(eApprovalDueAt(null, 24), null);
  assert.equal(eApprovalDueAt('2026-08-22T10:00:00.000Z', 0), null);
});

/* ── material change and versioning (spec section 6) ─────────────────────────────────────────── */

test('an amount change is a material change by default', () => {
  const change = detectEApprovalMaterialChange(
    { subject: 'Safety equipment', amount: 500000 },
    { subject: 'Safety equipment', amount: 900000 },
  );
  assert.equal(change.changed, true);
  assert.deepEqual(change.fields, ['amount']);
  assert.equal(change.amountChange.from, 500000);
  assert.equal(change.amountChange.to, 900000);
  assert.equal(change.amountChange.pct, 80);
  assert.equal(describeEApprovalMaterialChange(change), 'Amount changed after approval');
});

test('an amount change inside tolerance is not material', () => {
  const change = detectEApprovalMaterialChange(
    { amount: 250000 },
    { amount: 250000.4 },
    { materialFields: ['amount'], amountTolerancePct: 1 },
  );
  assert.equal(change.changed, false);
  // The change is still reported, so the UI can show it — it just does not supersede approvals.
  assert.ok(change.amountChange.pct < 1);
});

test('whitespace and case are not material changes', () => {
  const change = detectEApprovalMaterialChange(
    { subject: 'Purchase of Safety Equipment', body: 'For  Rayagada' },
    { subject: 'purchase of safety equipment ', body: 'For Rayagada' },
  );
  assert.equal(change.changed, false);
});

test('a first submission has nothing to compare against', () => {
  const change = detectEApprovalMaterialChange(null, { subject: 'New', amount: 100 });
  assert.equal(change.changed, false);
  assert.ok(change.fingerprint.includes('amount=100'));
});

/* ── routing rules (spec section 13) ────────────────────────────────────────────────────────── */

const purchaseMatrix = [
  { id: 'r-any', steps: [], priority: 0 },
  { id: 'r1', approvalTypeId: 'purchase', minAmount: 0, maxAmount: 25000, templateId: 't-small' },
  { id: 'r2', approvalTypeId: 'purchase', minAmount: 25001, maxAmount: 100000, templateId: 't-mid' },
  { id: 'r3', approvalTypeId: 'purchase', minAmount: 100001, maxAmount: 500000, templateId: 't-large' },
  { id: 'r4', approvalTypeId: 'purchase', minAmount: 500001, maxAmount: null, templateId: 't-board' },
];

test('amount bands tile the number line with no gaps', () => {
  const pick = (amount) =>
    resolveEApprovalRouting(purchaseMatrix, { approvalTypeId: 'purchase', amount })?.templateId;
  assert.equal(pick(0), 't-small');
  assert.equal(pick(25000), 't-small');
  assert.equal(pick(25001), 't-mid');
  assert.equal(pick(100000), 't-mid');
  assert.equal(pick(100001), 't-large');
  assert.equal(pick(500000), 't-large');
  assert.equal(pick(900000), 't-board');
});

test('the most specific routing rule wins, and a narrower band breaks a tie', () => {
  const rules = [
    ...purchaseMatrix,
    { id: 'dept', approvalTypeId: 'purchase', departmentId: 'd-fin', minAmount: 0, maxAmount: null, templateId: 't-fin' },
    { id: 'wide', approvalTypeId: 'purchase', minAmount: 0, maxAmount: null, templateId: 't-wide' },
  ];
  assert.equal(
    resolveEApprovalRouting(rules, { approvalTypeId: 'purchase', departmentId: 'd-fin', amount: 50000 })?.templateId,
    't-fin',
    'a department rule beats a type-only rule',
  );
  assert.equal(
    resolveEApprovalRouting(rules, { approvalTypeId: 'purchase', amount: 50000 })?.templateId,
    't-mid',
    'the narrower band beats the catch-all band at equal specificity',
  );
  assert.equal(resolveEApprovalRouting([], { amount: 10 }), null);
});

test('an inactive rule never matches', () => {
  const rules = [{ id: 'off', approvalTypeId: 'purchase', active: false, templateId: 't' }];
  assert.equal(resolveEApprovalRouting(rules, { approvalTypeId: 'purchase' }), null);
});

/* ── step construction ───────────────────────────────────────────────────────────────────────── */

test('a template step with two assignees becomes one parallel group', () => {
  const steps = buildEApprovalSteps(
    [
      { id: 't1', name: 'HOD', assignments: [user('u1', 'HOD')] },
      {
        id: 't2',
        name: 'Review',
        assignments: [user('u2', 'Finance'), user('u3', 'Legal'), user('u4', 'Commercial')],
        groupMode: 'NofM',
        groupRequiredCount: 2,
      },
    ],
    { nextId: makeIdFactory() },
  );
  assert.equal(steps.length, 4);
  const group = steps.filter((step) => step.name === 'Review');
  assert.equal(new Set(group.map((step) => step.groupId)).size, 1, 'group members share a groupId');
  assert.equal(new Set(group.map((step) => step.sequence)).size, 1, 'group members share a sequence');
  assert.ok(steps.every((step) => step.status === 'Pending' && step.depth === 0));
  assert.equal(eApprovalGroupState(steps, group[0]).required, 2);
});

test('a required count is clamped to the number of members', () => {
  const steps = buildEApprovalSteps(
    [{ id: 't', name: 'Review', assignments: [user('u1'), user('u2')], groupMode: 'NofM', groupRequiredCount: 9 }],
    { nextId: makeIdFactory() },
  );
  assert.equal(eApprovalGroupState(steps, steps[0]).required, 2);
});

/* ── submit and the serial chain ─────────────────────────────────────────────────────────────── */

test('submitting activates only the first step', () => {
  const state = submitted();
  assert.equal(state.request.status, 'Pending Approval');
  assert.equal(state.request.submittedAt, '2026-08-22T10:00:00.000Z');
  assert.equal(onlyActive(state).name, 'Manager');
  assert.deepEqual(state.request.currentAssigneeIds, ['u-mgr']);
  assert.equal(state.request.pendingLabel, 'Pending with Manager');
  assert.equal(onlyActive(state).dueAt, '2026-08-23T10:00:00.000Z');
});

test('only the requester can submit, and only once', () => {
  const state = scenario(serialChain);
  assert.throws(
    () => act(state, { kind: 'Submit', actor: { userId: 'u-mgr' } }),
    (error) => error instanceof EApprovalRuleError && /requester/i.test(error.message),
  );
  const live = submitted();
  assert.throws(() => act(live, { kind: 'Submit', actor: requester }), /draft/i);
});

test('approving walks the chain and the last approval completes the request', () => {
  let state = submitted();
  const order = ['u-mgr', 'u-fin', 'u-dir', 'u-ed'];
  order.forEach((userId, index) => {
    state = act(state, { kind: 'Approve', actor: { userId }, now: `2026-08-22T1${index}:00:00.000Z` });
  });
  assert.equal(state.request.status, 'Approved');
  assert.equal(state.request.completedAt, '2026-08-22T13:00:00.000Z');
  assert.deepEqual(state.request.currentAssigneeIds, []);
  assert.ok(state.steps.every((step) => step.status === 'Completed' && step.outcome === 'Approved'));
});

test('an approver cannot act on a step that is not theirs', () => {
  const state = submitted();
  assert.throws(
    () => act(state, { kind: 'Approve', actor: { userId: 'u-dir' } }),
    (error) => error instanceof EApprovalRuleError && /nothing pending with you/i.test(error.message),
  );
});

test('approve & complete skips the remaining steps, but only where configured', () => {
  const chain = [
    { id: 't1', name: 'Manager', assignments: [user('u-mgr')], capabilities: { canFinalise: true } },
    { id: 't2', name: 'Finance', assignments: [user('u-fin')] },
  ];
  let state = submitted(chain);
  state = act(state, { kind: 'Approve And Complete', actor: { userId: 'u-mgr' }, now: '2026-08-22T11:00:00.000Z' });
  assert.equal(state.request.status, 'Approved');
  assert.equal(stepNamed(state, 'Finance').status, 'Skipped');

  // Not offered on a step without the capability.
  const plain = submitted();
  assert.throws(
    () => act(plain, { kind: 'Approve And Complete', actor: { userId: 'u-mgr' } }),
    /not available/i,
  );
});

/* ── nested verification: the spec's section 31 walkthrough ──────────────────────────────────── */

test('verification nests two deep and returns to the exact step that asked', () => {
  let state = submitted([{ id: 't1', name: 'Director', assignments: [user('u-dir', 'Director')], slaHours: 48 }]);
  const director = () => stepNamed(state, 'Director');

  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-dir', userName: 'Director' },
    targets: [user('u-fin', 'Finance Manager')],
    instruction: 'Confirm budget availability.',
    now: '2026-08-22T12:05:00.000Z',
  });
  assert.equal(state.request.status, 'Pending Verification');
  assert.equal(director().status, 'Awaiting Verification');
  const finance = onlyActive(state);
  assert.equal(finance.depth, 1);
  assert.equal(finance.originStepId, director().id);
  assert.equal(finance.instruction, 'Confirm budget availability.');
  assert.equal(state.request.pendingLabel, 'Verification pending with Finance Manager');

  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-fin', userName: 'Finance Manager' },
    targets: [user('u-acc', 'Accounts Manager')],
    instruction: 'Check the rate contract.',
    now: '2026-08-22T12:30:00.000Z',
  });
  const accounts = onlyActive(state);
  assert.equal(accounts.depth, 2);
  assert.equal(stepNamed(state, 'Verification — Finance Manager').status, 'Awaiting Verification');
  assert.deepEqual(
    eApprovalStepChain(state.steps, accounts.id).map((step) => describeEApprovalAssignment(step.assignment)),
    ['Director', 'Finance Manager', 'Accounts Manager'],
    'the chain reads root-first, so read backwards it is the return order',
  );
  assert.equal(isChildEApprovalStep(accounts), true);

  // Accounts verifies → pops one level, to Finance, not to the Director.
  state = act(state, {
    kind: 'Verify',
    actor: { userId: 'u-acc', userName: 'Accounts Manager' },
    outcome: 'Verified',
    now: '2026-08-22T13:05:00.000Z',
  });
  assert.equal(onlyActive(state).assignment.userId, 'u-fin');
  assert.equal(director().status, 'Awaiting Verification', 'the Director is still waiting');
  assert.equal(state.request.status, 'Pending Verification');

  // Finance verifies → pops to the Director.
  state = act(state, {
    kind: 'Verify',
    actor: { userId: 'u-fin', userName: 'Finance Manager' },
    outcome: 'Verified With Observation',
    comment: 'Budget available under vehicle capex.',
    now: '2026-08-22T13:35:00.000Z',
  });
  assert.equal(onlyActive(state).assignment.userId, 'u-dir');
  assert.equal(state.request.status, 'Pending Approval');
  assert.equal(director().status, 'Active');

  // And the Director can now approve, which completes the request.
  state = act(state, { kind: 'Approve', actor: { userId: 'u-dir' }, now: '2026-08-22T14:20:00.000Z' });
  assert.equal(state.request.status, 'Approved');

  const autoReturns = state.allEvents.filter((event) => event.kind === 'Auto Returned');
  assert.equal(autoReturns.length, 2, 'one automatic return per level popped');
  assert.deepEqual(
    autoReturns.map((event) => event.stepName),
    ['Verification — Finance Manager', 'Director'],
    'Accounts pops to Finance, then Finance pops to the Director',
  );
});

test("a waiting approver's SLA clock is credited the time the verification took", () => {
  let state = submitted([{ id: 't1', name: 'Director', assignments: [user('u-dir')], slaHours: 24 }]);
  assert.equal(onlyActive(state).dueAt, '2026-08-23T10:00:00.000Z');

  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-dir' },
    targets: [user('u-fin')],
    now: '2026-08-22T11:00:00.000Z',
  });
  // Paused: the bar stops where it was rather than filling while somebody else holds the file.
  const paused = eApprovalSlaState(stepNamed(state, 'Director'), '2026-08-22T20:00:00.000Z');
  assert.equal(paused.paused, true);
  assert.equal(paused.remainingMs, 23 * 3_600_000);

  state = act(state, { kind: 'Verify', actor: { userId: 'u-fin' }, now: '2026-08-22T15:00:00.000Z' });
  const director = stepNamed(state, 'Director');
  assert.equal(director.pausedMs, 4 * 3_600_000);
  assert.equal(director.dueAt, '2026-08-23T14:00:00.000Z', 'the deadline moves out by the four hours waited');
});

test('two verifiers on one step both have to finish before the approver resumes', () => {
  let state = submitted([{ id: 't1', name: 'Director', assignments: [user('u-dir')] }]);
  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-dir' },
    targets: [user('u-fin', 'Finance'), user('u-leg', 'Legal')],
    now: '2026-08-22T11:00:00.000Z',
  });
  assert.equal(activeSteps(state).length, 2);

  state = act(state, { kind: 'Verify', actor: { userId: 'u-fin' }, now: '2026-08-22T12:00:00.000Z' });
  assert.equal(onlyActive(state).assignment.userId, 'u-leg');
  assert.equal(stepNamed(state, 'Director').status, 'Awaiting Verification');

  state = act(state, { kind: 'Verify', actor: { userId: 'u-leg' }, now: '2026-08-22T13:00:00.000Z' });
  assert.equal(onlyActive(state).assignment.userId, 'u-dir');
});

test('nesting is capped, so a verification loop cannot run away', () => {
  let state = submitted([{ id: 't1', name: 'Director', assignments: [user('u-dir')] }]);
  const send = (from, to) =>
    act(state, {
      kind: 'Send For Verification',
      actor: { userId: from },
      targets: [user(to)],
      settings: { maxVerificationDepth: 2 },
      now: '2026-08-22T11:00:00.000Z',
    });
  state = send('u-dir', 'u-a');
  state = send('u-a', 'u-b');
  // The cap is enforced by the action list first — the button is simply not offered at the limit —
  // and again inside the reducer, for a caller that skips the UI.
  assert.throws(() => send('u-b', 'u-c'), /(not available|nested more than 2)/i);
});

test('a verification stage sitting in the primary chain advances the chain', () => {
  // The seed "Purchase Approval" template puts Finance Verification between two approvals; it has no
  // parent to pop to, so it has to behave as a stage.
  let state = submitted([
    { id: 't1', name: 'Purchase', assignments: [user('u-pur')] },
    { id: 't2', name: 'Finance Verification', type: 'REVIEW', assignments: [user('u-fin')] },
    { id: 't3', name: 'Director', assignments: [user('u-dir')] },
  ]);
  state = act(state, { kind: 'Approve', actor: { userId: 'u-pur' }, now: '2026-08-22T11:00:00.000Z' });
  assert.equal(onlyActive(state).name, 'Finance Verification');
  assert.equal(isChildEApprovalStep(onlyActive(state)), false);

  state = act(state, { kind: 'Verify', actor: { userId: 'u-fin' }, outcome: 'Verified', now: '2026-08-22T12:00:00.000Z' });
  assert.equal(onlyActive(state).name, 'Director', 'a Verified stage satisfies its position');
  assert.equal(state.request.status, 'Pending Approval');
});

test('a not-verified stage in the chain blocks rather than passing the file on', () => {
  let state = submitted([
    { id: 't1', name: 'Finance Verification', type: 'REVIEW', assignments: [user('u-fin')] },
    { id: 't2', name: 'Director', assignments: [user('u-dir')] },
  ]);
  state = act(state, { kind: 'Verify', actor: { userId: 'u-fin' }, outcome: 'Not Verified', now: '2026-08-22T11:00:00.000Z' });
  assert.equal(state.request.status, 'Rejected');
  assert.equal(stepNamed(state, 'Director').status, 'Cancelled');
});

test('a verification result has to be one of the three', () => {
  let state = submitted([{ id: 't1', name: 'Director', assignments: [user('u-dir')] }]);
  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-dir' },
    targets: [user('u-fin')],
    now: '2026-08-22T11:00:00.000Z',
  });
  assert.throws(
    () => act(state, { kind: 'Verify', actor: { userId: 'u-fin' }, outcome: 'Approved' }),
    /verification result/i,
  );
});

/* ── clarification (spec section 19) ────────────────────────────────────────────────────────── */

test('a clarification request returns to the asker automatically', () => {
  let state = submitted([{ id: 't1', name: 'Director', assignments: [user('u-dir')] }]);
  state = act(state, {
    kind: 'Request Clarification',
    actor: { userId: 'u-dir' },
    targets: [{ kind: 'User', userId: 'u-req', userName: 'Debaprasad' }],
    instruction: 'Attach the comparative quotation.',
    now: '2026-08-22T11:00:00.000Z',
  });
  assert.equal(state.request.status, 'Pending Clarification');
  assert.equal(stepNamed(state, 'Director').status, 'Awaiting Clarification');

  state = act(state, {
    kind: 'Provide Clarification',
    actor: requester,
    comment: 'Quotation attached.',
    now: '2026-08-22T11:42:00.000Z',
  });
  assert.equal(onlyActive(state).assignment.userId, 'u-dir');
  assert.equal(state.request.status, 'Pending Approval');
});

/* ── return to any step (spec section 5) ────────────────────────────────────────────────────── */

test('returning to an earlier step re-opens everything between it and the returner', () => {
  let state = submitted();
  state = act(state, { kind: 'Approve', actor: { userId: 'u-mgr' }, now: '2026-08-22T10:30:00.000Z' });
  state = act(state, { kind: 'Approve', actor: { userId: 'u-fin' }, now: '2026-08-22T11:00:00.000Z' });
  state = act(state, { kind: 'Approve', actor: { userId: 'u-dir' }, now: '2026-08-22T11:30:00.000Z' });
  assert.equal(onlyActive(state).name, 'ED');

  state = act(state, {
    kind: 'Return',
    actor: { userId: 'u-ed', userName: 'ED' },
    returnTo: stepNamed(state, 'Finance').id,
    reason: 'Figures do not match the purchase order.',
    now: '2026-08-22T12:00:00.000Z',
  });

  assert.equal(stepNamed(state, 'Manager').status, 'Completed', 'approvals before the target stand');
  assert.equal(stepNamed(state, 'Finance').status, 'Active', 'the target acts again now');
  assert.equal(stepNamed(state, 'Director').status, 'Pending', 'the step in between is re-opened');
  assert.equal(stepNamed(state, 'Director').reopened, true);
  assert.equal(stepNamed(state, 'ED').status, 'Pending', 'the returner waits its turn again');
  assert.equal(state.request.status, 'Returned');
  assert.equal(stepNamed(state, 'Finance').returnedFromStepId, stepNamed(state, 'ED').id);

  // …and the chain then runs forward in its original order rather than jumping back to the returner.
  state = act(state, { kind: 'Approve', actor: { userId: 'u-fin' }, now: '2026-08-22T13:00:00.000Z' });
  assert.equal(onlyActive(state).name, 'Director');
  state = act(state, { kind: 'Approve', actor: { userId: 'u-dir' }, now: '2026-08-22T13:30:00.000Z' });
  assert.equal(onlyActive(state).name, 'ED');
  state = act(state, { kind: 'Approve', actor: { userId: 'u-ed' }, now: '2026-08-22T14:00:00.000Z' });
  assert.equal(state.request.status, 'Approved');
});

test('returning needs a reason and a valid target', () => {
  let state = submitted();
  state = act(state, { kind: 'Approve', actor: { userId: 'u-mgr' }, now: '2026-08-22T10:30:00.000Z' });
  assert.throws(() => act(state, { kind: 'Return', actor: { userId: 'u-fin' } }), /where to return/i);
  assert.throws(
    () => act(state, { kind: 'Return', actor: { userId: 'u-fin' }, returnTo: 'REQUESTER' }),
    /reason is required/i,
  );
  assert.throws(
    () =>
      act(state, {
        kind: 'Return',
        actor: { userId: 'u-fin' },
        returnTo: stepNamed(state, 'ED').id,
        reason: 'no',
      }),
    /not a step this approval can be returned to/i,
    'a step that has not acted yet is not a return target',
  );
});

test('return targets are the completed steps behind you, plus your own verification ancestors', () => {
  let state = submitted();
  state = act(state, { kind: 'Approve', actor: { userId: 'u-mgr' }, now: '2026-08-22T10:30:00.000Z' });
  state = act(state, { kind: 'Approve', actor: { userId: 'u-fin' }, now: '2026-08-22T11:00:00.000Z' });
  const director = onlyActive(state);
  assert.deepEqual(
    eApprovalReturnTargets(state.steps, director).map((step) => step.name),
    ['Finance', 'Manager'],
    'nearest first, and never the step you are standing on',
  );

  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-dir' },
    targets: [user('u-acc', 'Accounts')],
    now: '2026-08-22T11:30:00.000Z',
  });
  const verifier = onlyActive(state);
  assert.deepEqual(
    eApprovalReturnTargets(state.steps, verifier).map((step) => step.name),
    ['Director', 'Finance', 'Manager'],
    "a verifier's first target is the approver who sent it — return to sender",
  );

  // With return-to-any-step switched off, only the verification ancestors remain.
  assert.deepEqual(
    eApprovalReturnTargets(state.steps, verifier, { allowReturnToAnyStep: false }).map((step) => step.name),
    ['Director'],
  );
});

test('a verifier can send the file all the way back to the requester', () => {
  let state = submitted();
  state = act(state, { kind: 'Approve', actor: { userId: 'u-mgr' }, now: '2026-08-22T10:30:00.000Z' });
  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-fin' },
    targets: [user('u-acc', 'Accounts')],
    now: '2026-08-22T11:00:00.000Z',
  });
  state = act(state, {
    kind: 'Return',
    actor: { userId: 'u-acc', userName: 'Accounts' },
    returnTo: 'REQUESTER',
    reason: 'Vendor is not on the approved list.',
    now: '2026-08-22T11:30:00.000Z',
  });
  assert.equal(state.request.status, 'Returned');
  assert.equal(state.request.pendingLabel, 'Pending with Debaprasad');
  assert.equal(stepNamed(state, 'Verification — Accounts').status, 'Returned');
  assert.equal(stepNamed(state, 'Finance').status, 'Pending', 'the approver who asked is parked, not skipped');
  assert.equal(
    state.request.returnResumeStepId,
    stepNamed(state, 'Finance').id,
    'and gets the file back once the requester answers',
  );
  assert.equal(activeSteps(state).length, 0);

  state = act(state, {
    kind: 'Resubmit',
    actor: requester,
    materialChange: { changed: false, fields: [], fingerprint: 'same' },
    now: '2026-08-22T12:00:00.000Z',
  });
  assert.equal(onlyActive(state).name, 'Finance');
});

test('an approver waiting on a verification cannot act until it comes back', () => {
  let state = submitted();
  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-mgr' },
    targets: [user('u-acc', 'Accounts')],
    now: '2026-08-22T11:00:00.000Z',
  });
  // The file is genuinely with the verifier; the approver's own step is off the clock.
  assert.throws(
    () => act(state, { kind: 'Approve', actor: { userId: 'u-mgr' }, stepId: stepNamed(state, 'Manager').id }),
    /not pending with you/i,
  );
});

/* ── resubmission, supersede and versioning (spec section 6) ─────────────────────────────────── */

const returnedToRequester = () => {
  let state = submitted();
  state = act(state, { kind: 'Approve', actor: { userId: 'u-mgr' }, now: '2026-08-22T10:30:00.000Z' });
  state = act(state, { kind: 'Approve', actor: { userId: 'u-fin' }, now: '2026-08-22T11:00:00.000Z' });
  return act(state, {
    kind: 'Return',
    actor: { userId: 'u-dir', userName: 'Director' },
    returnTo: 'REQUESTER',
    reason: 'Attach the comparative statement.',
    now: '2026-08-22T11:30:00.000Z',
  });
};

test('a return to the requester parks the chain and keeps the earlier approvals', () => {
  const state = returnedToRequester();
  assert.equal(state.request.status, 'Returned');
  assert.equal(state.request.returnResumeStepId, stepNamed(state, 'Director').id);
  assert.equal(stepNamed(state, 'Manager').status, 'Completed');
  assert.equal(stepNamed(state, 'Finance').status, 'Completed');
  assert.equal(stepNamed(state, 'Director').status, 'Returned');
  assert.equal(stepNamed(state, 'ED').status, 'Pending');
  assert.equal(activeSteps(state).length, 0);
});

test('resubmitting without a material change goes straight back to whoever returned it', () => {
  let state = returnedToRequester();
  state = act(state, {
    kind: 'Resubmit',
    actor: requester,
    materialChange: { changed: false, fields: [], fingerprint: 'same' },
    now: '2026-08-22T12:00:00.000Z',
  });
  assert.equal(onlyActive(state).name, 'Director');
  assert.equal(state.request.version, 1);
  assert.equal(stepNamed(state, 'Manager').status, 'Completed', 'the earlier approvals are untouched');
  assert.equal(state.request.returnResumeStepId, null);
});

test('resubmitting after a material change supersedes every approval and restarts the chain', () => {
  let state = returnedToRequester();
  state = act(state, {
    kind: 'Resubmit',
    actor: requester,
    materialChange: {
      changed: true,
      fields: ['amount'],
      fingerprint: 'v2',
      amountChange: { from: 500000, to: 900000, pct: 80 },
    },
    now: '2026-08-22T12:00:00.000Z',
  });
  assert.equal(state.request.version, 2);
  assert.equal(state.request.supersededCount, 1);
  assert.equal(state.request.materialFingerprint, 'v2');
  assert.equal(onlyActive(state).name, 'Manager', 'the chain restarts from the first step');
  assert.equal(stepNamed(state, 'Manager').version, 2);
  assert.equal(stepNamed(state, 'Manager').reopened, true);

  const superseded = state.events.find((event) => event.kind === 'Superseded');
  assert.ok(superseded, 'the supersede is recorded in history');
  assert.match(superseded.summary, /Amount changed after approval/);
  const superseded2 = state.allEvents.filter((event) => event.kind === 'Superseded');
  assert.equal(superseded2.length, 1);
  const notice = state.notifications.find((intent) => intent.kind === 'Modified');
  assert.deepEqual(
    notice.userIds.sort(),
    ['u-fin', 'u-mgr'],
    'everyone whose approval was superseded is told',
  );
});

test('the restart point is configurable', () => {
  let state = returnedToRequester();
  state = act(state, {
    kind: 'Resubmit',
    actor: requester,
    materialChange: { changed: true, fields: ['amount'], fingerprint: 'v2' },
    settings: { restartOnMaterialChange: 'Returning Step' },
    now: '2026-08-22T12:00:00.000Z',
  });
  assert.equal(onlyActive(state).name, 'Director');
  assert.equal(stepNamed(state, 'Manager').status, 'Superseded', 'the earlier approvals are still void');
});

test('only the requester can resubmit, and only a returned request', () => {
  const live = submitted();
  assert.throws(() => act(live, { kind: 'Resubmit', actor: requester }), /returned/i);
  const returned = returnedToRequester();
  assert.throws(() => act(returned, { kind: 'Resubmit', actor: { userId: 'u-mgr' } }), /requester/i);
});

/* ── forward, delegate, escalate, add approver ───────────────────────────────────────────────── */

test('forwarding transfers the step, it does not add a level', () => {
  let state = submitted();
  const before = state.steps.length;
  state = act(state, {
    kind: 'Forward',
    actor: { userId: 'u-mgr', userName: 'Manager' },
    targets: [user('u-ed', 'ED')],
    reason: 'This should be approved by ED.',
    now: '2026-08-22T11:00:00.000Z',
  });
  assert.equal(state.steps.length, before, 'no new step');
  const step = stepNamed(state, 'Manager');
  assert.equal(step.assignment.userId, 'u-ed');
  assert.equal(step.status, 'Active');
  assert.equal(step.reassignments.length, 1);
  assert.equal(step.reassignments[0].from.userId, 'u-mgr');
  assert.equal(canActOnEApprovalStep(step, { userId: 'u-mgr' }), false, 'the original approver is out');
  assert.equal(canActOnEApprovalStep(step, { userId: 'u-ed' }), true);
  assert.equal(step.dueAt, '2026-08-23T11:00:00.000Z', 'the new holder gets a fresh clock');
});

test('delegating adds an authorised actor without taking the step away', () => {
  let state = submitted();
  state = act(state, {
    kind: 'Delegate',
    actor: { userId: 'u-mgr', userName: 'Manager' },
    targets: [user('u-cfo', 'CFO')],
    reason: 'On leave.',
    now: '2026-08-22T11:00:00.000Z',
  });
  const step = stepNamed(state, 'Manager');
  assert.equal(step.assignment.userId, 'u-mgr', 'the assignee is unchanged');
  assert.equal(step.delegatedToUserId, 'u-cfo');
  assert.equal(canActOnEApprovalStep(step, { userId: 'u-mgr' }), true);
  assert.equal(canActOnEApprovalStep(step, { userId: 'u-cfo' }), true);

  const delegateEvent = state.events.find((event) => event.kind === 'Delegate');
  assert.match(delegateEvent.summary, /delegated by Manager to CFO/);

  // The delegate acting is recorded as acting for the assignee.
  state = act(state, { kind: 'Approve', actor: { userId: 'u-cfo', userName: 'CFO' }, now: '2026-08-22T12:00:00.000Z' });
  const acted = stepNamed(state, 'Manager');
  assert.equal(acted.actedByUserId, 'u-cfo');
  assert.equal(acted.onBehalfOfUserId, 'u-mgr');
  assert.match(state.events.at(-1).summary, /on behalf of/);
});

test('a substitute-approver window lets somebody else act without a per-file delegation', () => {
  const state = submitted();
  const step = stepNamed(state, 'Manager');
  const delegations = [
    { id: 'd1', fromUserId: 'u-mgr', toUserId: 'u-cfo', fromDate: '2026-08-25', toDate: '2026-08-30' },
  ];
  const cfo = (now) => canActOnEApprovalStep(step, { userId: 'u-cfo', delegations }, { now });
  assert.equal(cfo('2026-08-22T10:00:00.000Z'), false, 'before the window');
  assert.equal(cfo('2026-08-27T10:00:00.000Z'), true, 'inside the window');
  assert.equal(cfo('2026-08-30T18:00:00.000Z'), true, 'the last day counts in full');
  assert.equal(cfo('2026-09-01T10:00:00.000Z'), false, 'after the window');
});

test('delegation resolves one level only', () => {
  const delegations = [
    { id: 'd1', fromUserId: 'a', toUserId: 'b', fromDate: '2026-08-01' },
    { id: 'd2', fromUserId: 'b', toUserId: 'c', fromDate: '2026-08-01' },
  ];
  const now = '2026-08-22T10:00:00.000Z';
  assert.equal(resolveEApprovalDelegate(delegations, 'a', now).toUserId, 'b');
  assert.equal(resolveEApprovalDelegate(delegations, 'x', now), null);
  // Scoped to an approval type.
  const scoped = [{ id: 'd3', fromUserId: 'a', toUserId: 'z', fromDate: '2026-08-01', approvalTypeIds: ['purchase'] }];
  assert.equal(resolveEApprovalDelegate(scoped, 'a', now, 'purchase').toUserId, 'z');
  assert.equal(resolveEApprovalDelegate(scoped, 'a', now, 'leave'), null);
  assert.equal(resolveEApprovalDelegate([{ ...scoped[0], active: false }], 'a', now, 'purchase'), null);
});

test('an added approver takes a midpoint position so nothing is renumbered', () => {
  let state = submitted();
  const sequencesBefore = state.steps.map((step) => step.sequence);
  state = act(state, {
    kind: 'Add Approver',
    actor: { userId: 'u-mgr' },
    targets: [user('u-x', 'Extra Approver')],
    now: '2026-08-22T11:00:00.000Z',
  });
  assert.deepEqual(
    state.steps.filter((step) => step.name !== 'Approval — Extra Approver').map((step) => step.sequence),
    sequencesBefore,
  );
  const added = stepNamed(state, 'Approval — Extra');
  assert.equal(added.sequence, 1.5);
  state = act(state, { kind: 'Approve', actor: { userId: 'u-mgr' }, now: '2026-08-22T11:30:00.000Z' });
  assert.equal(onlyActive(state).name, 'Approval — Extra Approver', 'and runs immediately after the inserter');
});

test('escalating moves the step to the senior authority with a fresh clock', () => {
  let state = submitted();
  state = act(state, {
    kind: 'Escalate',
    actor: { userId: 'u-mgr' },
    targets: [user('u-dir', 'Director')],
    reason: 'Overdue.',
    now: '2026-08-24T11:00:00.000Z',
  });
  const step = state.steps.find((candidate) => candidate.name.includes('escalated'));
  assert.equal(step.assignment.userId, 'u-dir');
  assert.equal(step.startedAt, '2026-08-24T11:00:00.000Z');
  assert.equal(state.notifications.at(-1).severity, 'WARNING');
});

/* ── reject, hold, cancel ────────────────────────────────────────────────────────────────────── */

test('rejecting cancels everything still open and is final', () => {
  let state = submitted();
  state = act(state, {
    kind: 'Reject',
    actor: { userId: 'u-mgr', userName: 'Manager' },
    reason: 'Not budgeted.',
    now: '2026-08-22T11:00:00.000Z',
  });
  assert.equal(state.request.status, 'Rejected');
  assert.equal(state.request.rejectionReason, 'Not budgeted.');
  assert.equal(stepNamed(state, 'ED').status, 'Cancelled');
  assert.throws(() => act(state, { kind: 'Approve', actor: { userId: 'u-fin' } }), /rejected/i);
});

test('rejecting needs a reason', () => {
  const state = submitted();
  assert.throws(() => act(state, { kind: 'Reject', actor: { userId: 'u-mgr' } }), /reason is required/i);
});

test('a hold stops the clock and only the holder can release it', () => {
  let state = submitted();
  state = act(state, {
    kind: 'Hold',
    actor: { userId: 'u-mgr' },
    reason: 'Awaiting board date.',
    now: '2026-08-22T11:00:00.000Z',
  });
  assert.equal(state.request.status, 'On Hold');
  assert.equal(stepNamed(state, 'Manager').status, 'On Hold');
  assert.deepEqual(availableEApprovalActions(state.request, stepNamed(state, 'Manager')), ['Resume']);
  assert.throws(() => act(state, { kind: 'Resume', actor: { userId: 'u-fin' } }), EApprovalRuleError);

  state = act(state, { kind: 'Resume', actor: { userId: 'u-mgr' }, now: '2026-08-23T11:00:00.000Z' });
  assert.equal(state.request.status, 'Pending Approval');
  assert.equal(stepNamed(state, 'Manager').pausedMs, 86_400_000);
  assert.equal(stepNamed(state, 'Manager').dueAt, '2026-08-24T10:00:00.000Z');
});

test('only the requester can cancel, and never after completion', () => {
  let state = submitted();
  assert.throws(() => act(state, { kind: 'Cancel', actor: { userId: 'u-mgr' } }), /requester/i);
  state = act(state, { kind: 'Cancel', actor: requester, reason: 'No longer required.', now: '2026-08-22T11:00:00.000Z' });
  assert.equal(state.request.status, 'Cancelled');
  assert.ok(state.steps.every((step) => step.status === 'Cancelled'));
  assert.throws(() => act(state, { kind: 'Cancel', actor: requester }), /cannot be cancelled/i);
});

/* ── parallel approval (spec section 28) ────────────────────────────────────────────────────── */

const parallelChain = (groupMode, groupRequiredCount) => [
  { id: 't1', name: 'HOD', assignments: [user('u-hod')] },
  {
    id: 't2',
    name: 'Review',
    assignments: [user('u-fin', 'Finance'), user('u-leg', 'Legal'), user('u-com', 'Commercial')],
    groupMode,
    groupRequiredCount,
  },
  { id: 't3', name: 'Director', assignments: [user('u-dir')] },
];

test('a parallel group activates together and all-must-approve waits for all three', () => {
  let state = submitted(parallelChain('All'));
  state = act(state, { kind: 'Approve', actor: { userId: 'u-hod' }, now: '2026-08-22T11:00:00.000Z' });
  assert.equal(activeSteps(state).length, 3);
  assert.match(state.request.pendingLabel, /Pending with Finance & Legal \+1/);

  state = act(state, { kind: 'Approve', actor: { userId: 'u-fin' }, now: '2026-08-22T11:10:00.000Z' });
  assert.equal(state.request.status, 'Partially Approved');
  state = act(state, { kind: 'Approve', actor: { userId: 'u-leg' }, now: '2026-08-22T11:20:00.000Z' });
  assert.equal(activeSteps(state).length, 1);
  assert.equal(onlyActive(state).assignment.userId, 'u-com');

  state = act(state, { kind: 'Approve', actor: { userId: 'u-com' }, now: '2026-08-22T11:30:00.000Z' });
  assert.equal(onlyActive(state).name, 'Director');
});

test('any-one-approves skips the siblings', () => {
  let state = submitted(parallelChain('Any'));
  state = act(state, { kind: 'Approve', actor: { userId: 'u-hod' }, now: '2026-08-22T11:00:00.000Z' });
  state = act(state, { kind: 'Approve', actor: { userId: 'u-leg' }, now: '2026-08-22T11:10:00.000Z' });
  assert.equal(onlyActive(state).name, 'Director');
  assert.equal(state.steps.filter((step) => step.status === 'Skipped').length, 2);
});

test('two-of-three advances on the second approval', () => {
  let state = submitted(parallelChain('NofM', 2));
  state = act(state, { kind: 'Approve', actor: { userId: 'u-hod' }, now: '2026-08-22T11:00:00.000Z' });
  state = act(state, { kind: 'Approve', actor: { userId: 'u-fin' }, now: '2026-08-22T11:10:00.000Z' });
  assert.equal(state.request.status, 'Partially Approved');
  state = act(state, { kind: 'Approve', actor: { userId: 'u-com' }, now: '2026-08-22T11:20:00.000Z' });
  assert.equal(onlyActive(state).name, 'Director');
  assert.equal(stepNamed(state, 'Review').groupMode, 'NofM');
});

test('a group that can no longer reach its threshold rejects rather than passing the file on', () => {
  let state = submitted(parallelChain('All'));
  state = act(state, { kind: 'Approve', actor: { userId: 'u-hod' }, now: '2026-08-22T11:00:00.000Z' });
  state = act(state, { kind: 'Approve', actor: { userId: 'u-fin' }, now: '2026-08-22T11:10:00.000Z' });
  state = act(state, {
    kind: 'Reject',
    actor: { userId: 'u-leg' },
    reason: 'Clause 14 not satisfied.',
    now: '2026-08-22T11:20:00.000Z',
  });
  assert.equal(state.request.status, 'Rejected');
  assert.equal(stepNamed(state, 'Director').status, 'Cancelled');
});

/* ── department assignment (spec section 11) ─────────────────────────────────────────────────── */

const deptStep = (departmentMode) => [
  {
    id: 't1',
    name: 'Finance',
    assignments: [{ kind: 'Department', departmentId: 'd-fin', departmentName: 'Finance', departmentMode }],
  },
];

test('mode A — anyone in the department can act, and claiming it locks it', () => {
  let state = submitted(deptStep('Anyone'));
  const step = () => stepNamed(state, 'Finance');
  const member = { userId: 'u-a', departmentId: 'd-fin' };
  const other = { userId: 'u-b', departmentId: 'd-fin' };
  const outsider = { userId: 'u-c', departmentId: 'd-hr' };
  assert.equal(canActOnEApprovalStep(step(), member), true);
  assert.equal(canActOnEApprovalStep(step(), outsider), false);
  assert.equal(canTakeEApprovalOwnership(step(), member), true);

  state = act(state, { kind: 'Take Ownership', actor: member, stepId: step().id, now: '2026-08-22T11:00:00.000Z' });
  assert.equal(step().ownedByUserId, 'u-a');
  assert.equal(canActOnEApprovalStep(step(), other), false, 'a claimed step belongs to its owner');
  assert.deepEqual(state.request.currentAssigneeIds, ['u-a']);
});

test('mode B — a department-head step is only for the head', () => {
  const state = submitted(deptStep('Head'));
  const step = stepNamed(state, 'Finance');
  assert.equal(canActOnEApprovalStep(step, { userId: 'u-a', departmentId: 'd-fin' }), false);
  assert.equal(
    canActOnEApprovalStep(step, { userId: 'u-hod', departmentId: 'd-fin', isDepartmentHead: true }),
    true,
  );
  assert.equal(canTakeEApprovalOwnership(step, { userId: 'u-a', departmentId: 'd-fin' }), false);
  assert.equal(describeEApprovalAssignment(step.assignment), 'Finance (HOD)');
});

test('mode C — a queue step waits for the head to assign it', () => {
  const state = submitted(deptStep('Queue'));
  const step = stepNamed(state, 'Finance');
  assert.equal(canActOnEApprovalStep(step, { userId: 'u-a', departmentId: 'd-fin' }), false);
  assert.equal(
    canActOnEApprovalStep(step, { userId: 'u-hod', departmentId: 'd-fin', isDepartmentHead: true }),
    true,
  );
  assert.equal(canTakeEApprovalOwnership(step, { userId: 'u-a', departmentId: 'd-fin' }), true);
  assert.equal(describeEApprovalAssignment(step.assignment), 'Finance Queue');
});

test('a role-assigned step is for whoever holds the role', () => {
  const state = submitted([{ id: 't1', name: 'Director', assignments: [{ kind: 'Role', role: 'Director' }] }]);
  const step = stepNamed(state, 'Director');
  assert.equal(canActOnEApprovalStep(step, { userId: 'u-1', role: 'Director' }), true);
  assert.equal(canActOnEApprovalStep(step, { userId: 'u-2', role: 'Manager' }), false);
  assert.deepEqual(state.request.currentRoles, ['Director']);
});

/* ── available actions and capabilities (spec sections 9 and 27) ─────────────────────────────── */

test('the action panel follows the step type', () => {
  let state = submitted([{ id: 't1', name: 'Director', assignments: [user('u-dir')] }]);
  const approvalActions = availableEApprovalActions(state.request, stepNamed(state, 'Director'));
  assert.ok(approvalActions.includes('Approve'));
  assert.ok(approvalActions.includes('Send For Verification'));
  assert.ok(approvalActions.includes('Reject'));
  assert.ok(!approvalActions.includes('Verify'));

  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-dir' },
    targets: [user('u-fin')],
    now: '2026-08-22T11:00:00.000Z',
  });
  const verifierActions = availableEApprovalActions(state.request, onlyActive(state));
  assert.ok(verifierActions.includes('Verify'));
  assert.ok(verifierActions.includes('Send For Verification'), 'further verification is allowed');
  assert.ok(!verifierActions.includes('Approve'), 'a verifier does not approve');
  assert.ok(!verifierActions.includes('Reject'));

  // The parent is waiting and can do nothing until the verification comes back.
  assert.deepEqual(availableEApprovalActions(state.request, stepNamed(state, 'Director')), []);
});

test('capabilities switched off in the workflow builder remove the action', () => {
  const state = submitted([
    {
      id: 't1',
      name: 'Manager',
      assignments: [user('u-mgr')],
      capabilities: { canReturn: false, canVerify: false, canForward: false, canReject: false },
    },
  ]);
  const actions = availableEApprovalActions(state.request, stepNamed(state, 'Manager'));
  assert.ok(!actions.includes('Return'));
  assert.ok(!actions.includes('Send For Verification'));
  assert.ok(!actions.includes('Forward'));
  assert.ok(!actions.includes('Reject'));
  assert.ok(actions.includes('Approve'), 'approving is never taken away');
  assert.throws(
    () => act(state, { kind: 'Return', actor: { userId: 'u-mgr' }, returnTo: 'REQUESTER', reason: 'x' }),
    /not available on this step/i,
  );
});

test('nested verification can be switched off organisation-wide', () => {
  const state = submitted([{ id: 't1', name: 'Director', assignments: [user('u-dir')] }]);
  const actions = availableEApprovalActions(state.request, stepNamed(state, 'Director'), {
    settings: { allowNestedVerification: false },
  });
  assert.ok(!actions.includes('Send For Verification'));
});

/* ── visibility (spec section 26) ───────────────────────────────────────────────────────────── */

test('nobody sees an approval they are not connected to', () => {
  const state = submitted();
  const request = { ...state.request, departmentId: 'd-pur', ccUserIds: ['u-cc'] };
  const view = (viewer, permissions) => canViewEApproval(request, state.steps, viewer, permissions);
  assert.equal(view({ userId: 'u-req' }), true, 'the requester');
  assert.equal(view({ userId: 'u-cc' }), true, 'a CC user');
  assert.equal(view({ userId: 'u-ed' }), true, 'an approver in the chain, before their turn');
  assert.equal(view({ userId: 'u-nobody' }), false);
  assert.equal(view({ userId: 'u-nobody' }, { viewAll: true }), true);
  assert.equal(view({ userId: 'u-nobody', departmentId: 'd-pur' }, { viewDepartment: true }), true);
  assert.equal(view({ userId: 'u-nobody', departmentId: 'd-hr' }, { viewDepartment: true }), false);
  assert.equal(view(null), false);
});

test('a confidential approval needs an explicit permission on top', () => {
  const state = submitted();
  const request = { ...state.request, departmentId: 'd-hr', confidential: true };
  const view = (viewer, permissions) => canViewEApproval(request, state.steps, viewer, permissions);
  assert.equal(view({ userId: 'u-req' }), true, 'participants always see their own file');
  assert.equal(view({ userId: 'u-mgr' }), true, 'so does an approver in the chain');
  assert.equal(view({ userId: 'u-nobody' }, { viewAll: true }), false, 'View All is not enough');
  assert.equal(view({ userId: 'u-nobody' }, { viewAll: true, viewConfidential: true }), true);
});

/* ── escalation ladder (spec section 22) ────────────────────────────────────────────────────── */

test('the ladder fires each rule once, and paused time does not count', () => {
  let state = submitted();
  const step = stepNamed(state, 'Manager');
  const due = (now) => resolveDueEApprovalEscalations([step], DEFAULT_E_APPROVAL_ESCALATION_LADDER, now);

  assert.deepEqual(due('2026-08-22T10:00:00.000Z').map((entry) => entry.rule.id), ['assign']);
  assert.deepEqual(
    due('2026-08-23T11:00:00.000Z').map((entry) => entry.rule.id),
    ['assign', 'remind-24'],
  );
  // Once recorded as sent they never fire again, so the cron is safe to run every minute.
  step.escalationsSent = ['assign', 'remind-24'];
  assert.deepEqual(due('2026-08-23T11:00:00.000Z'), []);
  assert.deepEqual(due('2026-08-25T11:00:00.000Z').map((entry) => entry.rule.id), ['remind-48', 'escalate-72']);

  // A step that spent a day on hold is a day less overdue.
  step.pausedMs = 86_400_000;
  assert.deepEqual(due('2026-08-25T11:00:00.000Z').map((entry) => entry.rule.id), ['remind-48']);

  // Nothing fires for a step nobody is holding.
  state = act(state, { kind: 'Approve', actor: { userId: 'u-mgr' }, now: '2026-08-22T11:00:00.000Z' });
  assert.deepEqual(due2(state), ['assign']);
});
const due2 = (state) =>
  resolveDueEApprovalEscalations(state.steps, DEFAULT_E_APPROVAL_ESCALATION_LADDER, '2026-08-22T11:30:00.000Z').map(
    (entry) => entry.rule.id,
  );

test('a ladder rule can be scoped to one approval type', () => {
  const state = submitted();
  const ladder = [{ id: 'purchase-only', afterHours: 0, kind: 'Reminder', approvalTypeId: 'purchase' }];
  assert.equal(resolveDueEApprovalEscalations(state.steps, ladder, '2026-08-22T11:00:00.000Z', 'leave').length, 0);
  assert.equal(resolveDueEApprovalEscalations(state.steps, ladder, '2026-08-22T11:00:00.000Z', 'purchase').length, 1);
});

/* ── derived labels, timeline and dashboard ─────────────────────────────────────────────────── */

test('the pending label names who is holding the file', () => {
  let state = submitted();
  assert.equal(eApprovalPendingLabel(state.request, state.steps), 'Pending with Manager');
  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-mgr' },
    targets: [user('u-fin', 'Finance Manager')],
    now: '2026-08-22T11:00:00.000Z',
  });
  assert.equal(eApprovalPendingLabel(state.request, state.steps), 'Verification pending with Finance Manager');
  state = act(state, { kind: 'Verify', actor: { userId: 'u-fin' }, now: '2026-08-22T12:00:00.000Z' });
  state = act(state, { kind: 'Reject', actor: { userId: 'u-mgr' }, reason: 'no', now: '2026-08-22T12:30:00.000Z' });
  assert.equal(eApprovalPendingLabel(state.request, state.steps), 'Rejected');
});

test('derived status never disagrees with the live steps', () => {
  const state = submitted();
  assert.equal(deriveEApprovalStatus(state.steps), 'Pending Approval');
  assert.equal(deriveEApprovalStatus([]), null);
});

test('the timeline nests verification under the approver who asked for it', () => {
  let state = submitted([{ id: 't1', name: 'Director', assignments: [user('u-dir', 'Director')] }]);
  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-dir' },
    targets: [user('u-fin', 'Finance')],
    now: '2026-08-22T11:00:00.000Z',
  });
  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-fin' },
    targets: [user('u-acc', 'Accounts')],
    now: '2026-08-22T11:30:00.000Z',
  });
  const timeline = eApprovalTimeline(state.steps, '2026-08-22T12:00:00.000Z');
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].assigneeLabel, 'Director');
  assert.equal(timeline[0].children.length, 1);
  assert.equal(timeline[0].children[0].children[0].assigneeLabel, 'Accounts');
  assert.equal(timeline[0].children[0].children[0].depth, 2);
});

test('the dashboard counts each file once, in the card it belongs to', () => {
  const rows = [
    { id: '1', status: 'Pending Approval', requesterId: 'x', currentAssigneeIds: ['me'], currentStepType: 'APPROVAL' },
    { id: '2', status: 'Pending Verification', requesterId: 'x', currentAssigneeIds: ['me'], currentStepType: 'VERIFICATION' },
    { id: '3', status: 'Pending Clarification', requesterId: 'x', currentAssigneeIds: ['me'], currentStepType: 'CLARIFICATION' },
    { id: '4', status: 'Returned', requesterId: 'me', currentAssigneeIds: ['me'] },
    { id: '5', status: 'Draft', requesterId: 'me' },
    { id: '6', status: 'Approved', requesterId: 'me', completedAt: '2026-08-05T10:00:00.000Z' },
    { id: '7', status: 'Approved', requesterId: 'me', completedAt: '2026-07-05T10:00:00.000Z' },
    {
      id: '8',
      status: 'Pending Approval',
      requesterId: 'x',
      currentAssigneeIds: ['me'],
      currentStepType: 'APPROVAL',
      currentDueAt: '2026-08-20T10:00:00.000Z',
    },
    { id: '9', status: 'Pending Approval', requesterId: 'x', currentDepartmentIds: ['d-fin'], currentStepType: 'APPROVAL' },
    { id: '10', status: 'Pending Approval', requesterId: 'x', currentAssigneeIds: ['someone-else'], currentStepType: 'APPROVAL' },
  ];
  const counts = summarizeEApprovalDashboard(
    rows,
    { userId: 'me', departmentId: 'd-fin' },
    '2026-08-22T10:00:00.000Z',
  );
  assert.equal(counts.pendingApprovals, 3, 'two mine plus one via my department');
  assert.equal(counts.verificationTasks, 1);
  assert.equal(counts.clarifications, 1);
  assert.equal(counts.returnedToMe, 1);
  assert.equal(counts.createdByMe, 4);
  assert.equal(counts.drafts, 1);
  assert.equal(counts.approvedThisMonth, 1, 'last month does not count');
  assert.equal(counts.overdue, 1);
});

test('ageing buckets', () => {
  const now = '2026-08-22T10:00:00.000Z';
  assert.equal(eApprovalAgeingBucket('2026-08-22T09:00:00.000Z', now), '0-1 day');
  assert.equal(eApprovalAgeingBucket('2026-08-19T09:00:00.000Z', now), '2-3 days');
  assert.equal(eApprovalAgeingBucket('2026-08-16T09:00:00.000Z', now), '4-7 days');
  assert.equal(eApprovalAgeingBucket('2026-08-10T09:00:00.000Z', now), '8-15 days');
  assert.equal(eApprovalAgeingBucket('2026-07-10T09:00:00.000Z', now), '15+ days');
  assert.equal(eApprovalAgeingBucket(null, now), '—');
});

/* ── history is complete (spec section 20) ──────────────────────────────────────────────────── */

test('every transition leaves a history line', () => {
  let state = submitted();
  const trail = [];
  const step = (input) => {
    state = act(state, input);
    trail.push(...state.events.map((event) => event.summary));
  };
  step({ kind: 'Approve', actor: { userId: 'u-mgr', userName: 'Purchase Manager' }, now: '2026-08-22T10:32:00.000Z' });
  step({
    kind: 'Send For Verification',
    actor: { userId: 'u-fin', userName: 'Finance Manager' },
    targets: [user('u-acc', 'Accounts Executive')],
    now: '2026-08-22T11:20:00.000Z',
  });
  step({ kind: 'Verify', actor: { userId: 'u-acc', userName: 'Accounts Executive' }, now: '2026-08-22T12:05:00.000Z' });
  step({ kind: 'Approve', actor: { userId: 'u-fin', userName: 'Finance Manager' }, now: '2026-08-22T12:35:00.000Z' });

  assert.deepEqual(trail, [
    'Approved by Purchase Manager at "Manager"',
    'Finance Manager sent for verification to Accounts Executive',
    'Verified by Accounts Executive at "Verification — Accounts Executive"',
    'Automatically returned to Finance Manager after verification by Accounts Executive',
    'Approved by Finance Manager at "Finance"',
  ]);
  assert.ok(state.events.every((event) => event.at && event.actorId && event.summary));
});

test('the reducer never mutates what it was given', () => {
  const state = submitted();
  const before = JSON.stringify({ request: state.request, steps: state.steps });
  applyEApprovalAction(state.request, state.steps, {
    kind: 'Approve',
    actor: { userId: 'u-mgr' },
    now: '2026-08-22T11:00:00.000Z',
    nextId: state.nextId,
  });
  assert.equal(JSON.stringify({ request: state.request, steps: state.steps }), before);
});

test('an unsigned actor cannot act at all', () => {
  const state = submitted();
  assert.throws(() => act(state, { kind: 'Approve', actor: {} }), /signed in/i);
});
