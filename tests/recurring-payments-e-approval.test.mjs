import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from the policy modules rather than the barrels, which re-export Firestore-client helpers
// that only resolve inside the bundler.
import {
  planEApprovalMirrorSync,
  describeEApprovalSource,
  isMirroredEApproval,
} from '../src/lib/e-approval-link.ts';
import {
  attachRecurringMirrorFields,
  buildRecurringMirrorStages,
  recurringApprovalPosition,
  recurringMirrorBody,
  recurringMirrorIssues,
  recurringMirrorLabel,
  isRecurringMirrorClosed,
  recurringMirrorPlanStages,
  recurringMirrorPriority,
  recurringMirrorSubject,
  recurringMirrorTemplateSteps,
  recurringSourcePosition,
  shouldMirrorRecurringPayment,
} from '../src/lib/recurring-payments-e-approval.ts';
import {
  recurringMirrorAction,
  recurringMirrorMode,
  routeRecurringWorkflow,
} from '../src/lib/recurring-payments-workflow.ts';
import { buildEApprovalSteps, applyEApprovalAction } from '../src/lib/e-approval-policy.ts';

/* ── harness ─────────────────────────────────────────────────────────────────────────────────── */

const WORKFLOW = [
  { id: '1', name: 'Bill Collection', description: '', tat: 24, assignmentType: 'Payment-owner', assignedTo: [], actions: ['Submit Bill', 'Dispute', 'On Hold'], uploadRequired: true },
  { id: '2', name: 'Bill Verification', description: '', tat: 16, assignmentType: 'User-based', assignedTo: ['u-verify'], actions: ['Verify', 'Return for Correction', 'Reject'], uploadRequired: false },
  { id: '3', name: 'Payment Approval', description: '', tat: 8, assignmentType: 'Amount-based', assignedTo: [], actions: ['Approve', 'Return for Correction', 'Reject', 'On Hold'], uploadRequired: false },
  { id: '4', name: 'Payment Processing', description: '', tat: 8, assignmentType: 'User-based', assignedTo: ['u-accounts'], actions: ['Record Payment', 'Payment Failed', 'On Hold'], uploadRequired: false },
  { id: '5', name: 'Receipt & Closure', description: '', tat: 8, assignmentType: 'User-based', assignedTo: ['u-accounts'], actions: ['Close', 'Return for Correction'], uploadRequired: true },
];

const payment = (overrides = {}) => ({
  id: 'pay-1',
  organizationId: 'org',
  masterId: 'm-1',
  cycleKey: 'org_m-1_2026-08',
  title: 'Office Rent — Aug 2026',
  category: 'Office / Site Rent',
  vendorName: 'Sunrise Estates',
  billingPeriodStart: '2026-08-01',
  billingPeriodEnd: '2026-08-31',
  dueDate: '2026-09-05',
  expectedAmount: 250000,
  paidAmount: 0,
  status: 'Awaiting Bill',
  workflowStatus: 'In Progress',
  currentStepId: '1',
  assignees: ['u-owner'],
  assignedTo: 'u-owner',
  verifierId: 'u-verify',
  approverId: 'u-approver',
  accountsProcessorId: 'u-accounts',
  generatedAutomatically: true,
  ...overrides,
});

const settings = (overrides = {}) => ({
  enabled: true,
  scope: 'All',
  minAmount: 0,
  approvalTypeId: '',
  approvalTypeName: '',
  chain: 'Payment workflow',
  confidential: false,
  carryDocuments: true,
  ...overrides,
});

/** Builds the chain the service would build, so positions can be asserted against real step ids. */
function chainFor(pay, opts = {}) {
  const stages = buildRecurringMirrorStages(WORKFLOW, pay, settings(opts));
  let n = 0;
  const steps = attachRecurringMirrorFields(
    buildEApprovalSteps(recurringMirrorTemplateSteps(stages), { nextId: (seed) => `${seed}#${(n += 1)}` }),
    stages,
  );
  stages.forEach((stage, index) => {
    stage.approvalStepIds = steps.filter((step) => step.sequence === index + 1).map((step) => step.id);
  });
  return { stages, steps };
}

/* ── stage expansion ─────────────────────────────────────────────────────────────────────────── */

test('the whole workflow becomes one stage per step, in order', () => {
  const { stages } = chainFor(payment());
  assert.deepEqual(
    stages.map((stage) => stage.stepName),
    ['Bill Collection', 'Bill Verification', 'Payment Approval', 'Payment Processing', 'Receipt & Closure'],
  );
  assert.deepEqual(stages.map((stage) => stage.stepId), ['1', '2', '3', '4', '5']);
});

test('a sequential approval becomes one stage per level, because three people sign', () => {
  const { stages } = chainFor(payment({ approvalMode: 'Sequential', approvalLevels: ['u-a', 'u-b', 'u-c'] }));
  const approval = stages.filter((stage) => stage.stepId === '3');
  assert.equal(approval.length, 3);
  assert.deepEqual(approval.map((stage) => stage.level), [1, 2, 3]);
  assert.deepEqual(approval.map((stage) => stage.assignees), [['u-a'], ['u-b'], ['u-c']]);
  assert.deepEqual(approval.map((stage) => stage.stepName), [
    'Payment Approval · Level 1',
    'Payment Approval · Level 2',
    'Payment Approval · Level 3',
  ]);
});

test('a parallel approval is one stage everybody has to sign', () => {
  const { stages } = chainFor(payment({ approvalMode: 'Parallel', approvalLevels: ['u-a', 'u-b'] }));
  const approval = stages.filter((stage) => stage.stepId === '3');
  assert.equal(approval.length, 1);
  assert.equal(approval[0].groupMode, 'All');
  assert.deepEqual(approval[0].assignees, ['u-a', 'u-b']);
});

test('a step with a primary and a backup needs only one of them, not both', () => {
  const workflow = [{ ...WORKFLOW[1], assignedTo: ['u-verify', '  u-backup'.trim()] }];
  const stages = buildRecurringMirrorStages(workflow, payment(), settings());
  assert.equal(stages[0].groupMode, 'Any');
  assert.deepEqual(stages[0].assignees, ['u-verify', 'u-backup']);
});

test('the payment owner holds the entry step even when it is configured to nobody', () => {
  const workflow = [{ ...WORKFLOW[0], assignmentType: 'User-based', assignedTo: [] }];
  const stages = buildRecurringMirrorStages(workflow, payment(), settings());
  assert.deepEqual(stages[0].assignees, ['u-owner'], 'falls back to the master’s owner rather than nobody');
});

test('“Decision” scope leaves the data-entry steps out of the chain entirely', () => {
  const { stages } = chainFor(payment(), { scope: 'Decision' });
  assert.deepEqual(stages.map((stage) => stage.stepName), ['Bill Verification', 'Payment Approval', 'Receipt & Closure']);
});

/* ── mirror mode ─────────────────────────────────────────────────────────────────────────────── */

test('a step that needs a bill number or a UTR can only be viewed in E-Approval, never decided', () => {
  assert.equal(recurringMirrorMode(WORKFLOW[0]), 'Visibility', 'Bill Collection collects a bill number');
  assert.equal(recurringMirrorMode(WORKFLOW[3]), 'Visibility', 'Payment Processing records a UTR');
  assert.equal(recurringMirrorAction(WORKFLOW[0]), undefined);
});

test('a pure decision step is decidable, and applies its own verb back to the payment', () => {
  assert.equal(recurringMirrorMode(WORKFLOW[1]), 'Decision');
  assert.equal(recurringMirrorAction(WORKFLOW[1]), 'Verify', 'a verification verifies — it does not approve');
  assert.equal(recurringMirrorAction(WORKFLOW[2]), 'Approve');
  assert.equal(recurringMirrorAction(WORKFLOW[4]), 'Close');
});

test('adding a data-entry action to a decision step withdraws it from decision mode', () => {
  const contaminated = { ...WORKFLOW[2], actions: [...WORKFLOW[2].actions, 'Record Payment'] };
  assert.equal(recurringMirrorMode(contaminated), 'Visibility');
});

test('every mirrored stage is marked as work to perform, so none is auto-approved away', () => {
  const { steps } = chainFor(payment());
  assert.ok(steps.every((step) => step.requesterMustAct === true));
  // A visibility stage is still told apart from a decision one — by whether it has an action to
  // apply back, which is what the screens key off.
  assert.equal(steps.find((step) => step.mirrorStepId === '1').mirrorAction, undefined);
  assert.equal(steps.find((step) => step.mirrorStepId === '2').mirrorAction, 'Verify');
});

test('one person holding every step does not collapse the whole chain on the first action', () => {
  // The bug this guards: owner, verifier and approver are the same person — a small office, or
  // anyone testing with one login. Completing step 1 of 5 auto-approved stages 2 and 3 as well, and
  // where no later stage needed a bill number to stop it, all five went and the request read
  // "Approved" against a payment whose bill had only just been submitted.
  const solo = 'u-solo';
  // Steps left unassigned in Workflow Configuration, so each falls back to the master's own
  // verifier / approver / processor — which here is all the same person.
  const workflow = WORKFLOW.map((step) => ({ ...step, assignedTo: [] }));
  const pay = payment({
    assignedTo: solo, assignees: [solo], verifierId: solo, approverId: solo, accountsProcessorId: solo,
  });
  const stages = buildRecurringMirrorStages(workflow, pay, settings());
  assert.ok(stages.every((stage) => stage.assignees.includes(solo)), 'one person really does hold all five');

  let n = 0;
  const steps = attachRecurringMirrorFields(
    buildEApprovalSteps(recurringMirrorTemplateSteps(stages), { nextId: (seed) => `${seed}#${(n += 1)}` }),
    stages,
  );
  const request = {
    id: 'EA1', referenceNo: 'EA/1', status: 'Draft', version: 1,
    requesterId: solo, requesterName: 'Solo', priority: 'Normal',
  };
  const submitted = applyEApprovalAction(request, steps, {
    kind: 'Submit', actor: { userId: solo }, now: '2026-08-22T10:00:00.000Z',
  });
  assert.equal(submitted.steps.filter((step) => step.status === 'Active').length, 1);

  const first = submitted.steps.find((step) => step.mirrorStepId === '1');
  const after = applyEApprovalAction(submitted.request, submitted.steps, {
    kind: 'Approve', actor: { userId: solo }, stepId: first.id, now: '2026-08-22T11:00:00.000Z',
  });

  assert.deepEqual(
    after.steps.map((step) => step.status),
    ['Completed', 'Active', 'Pending', 'Pending', 'Pending'],
    'exactly one step done, the next one live, the rest still to come',
  );
  assert.notEqual(after.request.status, 'Approved');
});

test('an ordinary note-sheet still skips the requester’s own approval stage', () => {
  // The carve-out above is for mirrored stages only — the engine-wide rule is untouched.
  const result = submitted(
    [
      { id: 't1', name: 'Site Accountant', assignments: [user('u-req')] },
      { id: 't2', name: 'Director', assignments: [user('u-dir', 'Rekha')] },
    ],
    'u-req',
  );
  assert.equal(result.steps.find((step) => step.name === 'Site Accountant').status, 'Completed');
  assert.equal(result.steps.find((step) => step.name === 'Director').status, 'Active');
});

/* ── how the mirror reads on a payment ───────────────────────────────────────────────────────── */

test('a running mirror reads as the step the payment is on, not as the approval’s status', () => {
  assert.equal(
    recurringMirrorLabel({ status: 'Pending Verification', stageName: 'Bill Verification' }),
    'Bill Verification',
  );
});

test('a finished mirror reads as Completed — “Approved” is the approval’s word, not the payment’s', () => {
  assert.equal(recurringMirrorLabel({ status: 'Approved', stageName: 'Receipt & Closure' }), 'Completed');
  assert.equal(isRecurringMirrorClosed({ status: 'Approved' }), true);
});

test('a rejected, cancelled or unlinked mirror says so', () => {
  assert.equal(recurringMirrorLabel({ status: 'Rejected' }), 'Rejected');
  assert.equal(recurringMirrorLabel({ status: 'Cancelled' }), 'Cancelled');
  assert.equal(recurringMirrorLabel({ status: 'Approved', detachedAt: {} }), 'Unlinked');
  assert.equal(isRecurringMirrorClosed({ status: 'Pending Approval' }), false);
});

test('a mirror with no stage name yet falls back to the approval status rather than going blank', () => {
  assert.equal(recurringMirrorLabel({ status: 'Pending Approval' }), 'Pending Approval');
  assert.equal(recurringMirrorLabel(undefined), '');
});

test('a visibility stage offers no decision to apply back, so nothing can advance the payment from it', () => {
  const { stages } = chainFor(payment());
  const collection = stages.find((stage) => stage.stepId === '1');
  assert.equal(collection.mode, 'Visibility');
  assert.equal(collection.action, undefined);
  // The plan carries '' for such a stage; the service treats that as "cannot act here" and says so
  // rather than moving the payment on without the bill number the step exists to collect.
  const planned = recurringMirrorPlanStages(stages).find((stage) => stage.stepId === '1');
  assert.equal(planned.action, '');
});

/* ── configuration problems ──────────────────────────────────────────────────────────────────── */

test('a stage with nobody on it is reported, not thrown', () => {
  // Not the entry step, which has the owner fallback — the second, where nobody means nobody.
  const workflow = [WORKFLOW[0], { ...WORKFLOW[1], assignedTo: [] }];
  const stages = buildRecurringMirrorStages(workflow, payment({ verifierId: '' }), settings());
  const issues = recurringMirrorIssues(stages);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Bill Verification.*no assignee/);
});

test('a healthy workflow reports nothing', () => {
  const { stages } = chainFor(payment({ approvalLevels: ['u-a'], approvalMode: 'Sequential' }));
  assert.deepEqual(recurringMirrorIssues(stages), []);
});

/* ── positions ───────────────────────────────────────────────────────────────────────────────── */

test('a payment sitting at its second step is at stage index 1', () => {
  const { stages } = chainFor(payment());
  assert.deepEqual(recurringSourcePosition(payment({ currentStepId: '2' }), stages), { index: 1, closed: false });
});

test('the approval level picks the right stage of a multi-level approval', () => {
  const pay = payment({ approvalMode: 'Sequential', approvalLevels: ['u-a', 'u-b', 'u-c'], currentStepId: '3' });
  const { stages } = chainFor(pay);
  assert.equal(recurringSourcePosition({ ...pay, currentApprovalLevel: 1 }, stages).index, 2);
  assert.equal(recurringSourcePosition({ ...pay, currentApprovalLevel: 3 }, stages).index, 4);
});

test('an approval level left at 1 on an ordinary step still matches that step', () => {
  const { stages } = chainFor(payment());
  const at = recurringSourcePosition(payment({ currentStepId: '4', currentApprovalLevel: 1 }), stages);
  assert.equal(stages[at.index].stepId, '4');
});

test('under “Decision” scope a payment at a skipped step waits at the next mirrored stage', () => {
  const { stages } = chainFor(payment(), { scope: 'Decision' });
  // Stages are Bill Verification (2), Payment Approval (3), Receipt & Closure (5).
  // The payment is at Bill Collection (1), which is not mirrored at all.
  const at = recurringSourcePosition(payment({ currentStepId: '1' }), stages, WORKFLOW);
  assert.deepEqual(at, { index: 0, closed: false }, 'standing at Bill Verification, not off the chain');

  // Payment Processing (4) sits between Payment Approval and Receipt & Closure.
  const between = recurringSourcePosition(payment({ currentStepId: '4' }), stages, WORKFLOW);
  assert.equal(stages[between.index].stepId, '5');
});

test('a payment waiting at a skipped step is in sync with an approval waiting at the next stage', () => {
  const { stages } = chainFor(payment(), { scope: 'Decision' });
  const at = recurringSourcePosition(payment({ currentStepId: '1' }), stages, WORKFLOW);
  const action = planEApprovalMirrorSync(at, { index: 0, closed: false }, recurringMirrorPlanStages(stages));
  assert.deepEqual(action, { kind: 'In Sync' }, 'the approver is waiting for the bill, which is correct');
});

test('a completed payment is closed and approved; a rejected one is closed and rejected', () => {
  const { stages } = chainFor(payment());
  assert.deepEqual(recurringSourcePosition(payment({ workflowStatus: 'Completed', status: 'Closed', currentStepId: null }), stages), {
    index: 5, closed: true, outcome: 'Approved',
  });
  assert.deepEqual(recurringSourcePosition(payment({ workflowStatus: 'Rejected', status: 'Rejected', currentStepId: null }), stages), {
    index: -1, closed: true, outcome: 'Rejected',
  });
});

test('the approval side stands at the first stage still open', () => {
  const { stages, steps } = chainFor(payment());
  const at = recurringApprovalPosition({ status: 'Pending Approval' }, steps, stages);
  assert.deepEqual(at, { index: 0, closed: false, returned: false });

  const halfDone = steps.map((step) => (step.sequence <= 2 ? { ...step, status: 'Completed' } : step));
  assert.equal(recurringApprovalPosition({ status: 'Pending Approval' }, halfDone, stages).index, 2);
});

test('a request paused for a clarification still holds its position', () => {
  const { stages, steps } = chainFor(payment());
  const paused = steps.map((step) => (step.sequence === 1 ? { ...step, status: 'Awaiting Clarification' } : step));
  assert.equal(
    recurringApprovalPosition({ status: 'Pending Clarification' }, paused, stages).index,
    0,
    'a question outstanding is not the same as nobody holding it',
  );
});

test('a request returned to the requester resumes where it was returned from', () => {
  const { stages, steps } = chainFor(payment());
  const resume = steps.find((step) => step.sequence === 2);
  const returned = steps.map((step) => ({ ...step, status: 'Returned' }));
  const at = recurringApprovalPosition({ status: 'Returned', returnResumeStepId: resume.id }, returned, stages);
  assert.deepEqual(at, { index: 1, closed: false, returned: true });
});

/* ── the sync plan ───────────────────────────────────────────────────────────────────────────── */

const plan = (sourceIndex, approvalIndex, stages, extra = {}) =>
  planEApprovalMirrorSync(
    { index: sourceIndex, closed: false, ...(extra.source || {}) },
    { index: approvalIndex, closed: false, ...(extra.approval || {}) },
    recurringMirrorPlanStages(stages),
  );

test('two sides in the same place need nothing done', () => {
  const { stages } = chainFor(payment());
  assert.deepEqual(plan(2, 2, stages), { kind: 'In Sync' });
});

test('an approver acting in E-Approval walks the payment forward one stage at a time', () => {
  const { stages } = chainFor(payment());
  const action = plan(1, 3, stages);
  assert.equal(action.kind, 'Advance Source');
  assert.deepEqual(action.steps, [
    { stepId: '2', action: 'Verify', level: undefined },
    { stepId: '3', action: 'Approve', level: undefined },
  ], 'every stage passed gets its own entry — the file does not teleport');
});

test('the accountant acting in Recurring Payments walks the approval forward to match', () => {
  const { stages } = chainFor(payment());
  const action = plan(2, 0, stages);
  assert.equal(action.kind, 'Advance Approval');
  assert.deepEqual(action.stages, [
    { stepId: '1', approvalStepIds: stages[0].approvalStepIds },
    { stepId: '2', approvalStepIds: stages[1].approvalStepIds },
  ], 'grouped by stage, so the caller can pick one of a stage’s joint holders');
});

test('a stage held by a primary and a backup arrives as one entry, not two', () => {
  const workflow = [WORKFLOW[0], { ...WORKFLOW[1], assignedTo: ['u-verify', 'u-backup'] }, WORKFLOW[2]];
  const stages = buildRecurringMirrorStages(workflow, payment(), settings());
  let n = 0;
  const steps = attachRecurringMirrorFields(
    buildEApprovalSteps(recurringMirrorTemplateSteps(stages), { nextId: (seed) => `${seed}#${(n += 1)}` }),
    stages,
  );
  stages.forEach((stage, index) => {
    stage.approvalStepIds = steps.filter((step) => step.sequence === index + 1).map((step) => step.id);
  });
  assert.equal(stages[1].approvalStepIds.length, 2, 'two people, two step records');

  const action = planEApprovalMirrorSync(
    { index: 2, closed: false }, { index: 1, closed: false }, recurringMirrorPlanStages(stages),
  );
  assert.equal(action.kind, 'Advance Approval');
  assert.equal(action.stages.length, 1, 'one stage to catch up on');
  assert.equal(action.stages[0].approvalStepIds.length, 2, 'both ids, so the caller can pick whoever acted');
});

test('a stage with no approval steps behind it is not offered for catch-up', () => {
  const { stages } = chainFor(payment());
  stages[0].approvalStepIds = [];
  const action = planEApprovalMirrorSync(
    { index: 1, closed: false }, { index: 0, closed: false }, recurringMirrorPlanStages(stages),
  );
  assert.deepEqual(action, { kind: 'In Sync' }, 'nothing to complete means nothing to do');
});

test('a rejection anywhere closes the other side, and beats a simultaneous approval', () => {
  const { stages } = chainFor(payment());
  assert.deepEqual(
    plan(1, 4, stages, { approval: { closed: true, outcome: 'Rejected' } }),
    { kind: 'Close Source', outcome: 'Rejected' },
  );
  assert.deepEqual(
    plan(-1, 2, stages, { source: { closed: true, outcome: 'Rejected' } }),
    { kind: 'Close Approval', outcome: 'Rejected' },
  );
});

test('both sides already closed is in sync, whatever the outcomes were', () => {
  const { stages } = chainFor(payment());
  assert.deepEqual(
    plan(5, 5, stages, { source: { closed: true, outcome: 'Approved' }, approval: { closed: true, outcome: 'Approved' } }),
    { kind: 'In Sync' },
  );
});

test('a return in E-Approval sends the payment back to the stage it was returned to', () => {
  const { stages } = chainFor(payment());
  const action = plan(3, 1, stages, { approval: { returned: true } });
  assert.deepEqual(action, { kind: 'Return Source', stepId: '2' });
});

test('an approval chain that has not started yet is caught up, not read as a return', () => {
  const { stages } = chainFor(payment());
  // Source at stage 2, approval at stage 0 having completed nothing: that is a lag, not an objection.
  const action = plan(2, 0, stages);
  assert.equal(action.kind, 'Advance Approval', 'a fresh mirror catches up rather than sending the payment back');
});

test('a chain that reached stage 3 and came back reads as a return, not a lag', () => {
  const pay = payment();
  const { stages, steps } = chainFor(pay);
  // Stages 0 and 1 completed, then returned: stage 1 is open again and stage 2 has been through.
  const returned = steps.map((step) => {
    if (step.sequence === 1) return { ...step, status: 'Completed' };
    if (step.sequence === 2) return { ...step, status: 'Active', reopened: true };
    if (step.sequence === 3) return { ...step, status: 'Returned' };
    return step;
  });
  const at = recurringApprovalPosition({ status: 'Pending Approval' }, returned, stages);
  assert.deepEqual(at, { index: 1, closed: false, returned: true });

  const action = planEApprovalMirrorSync(
    recurringSourcePosition(payment({ currentStepId: '4' }), stages),
    at,
    recurringMirrorPlanStages(stages),
  );
  assert.deepEqual(action, { kind: 'Return Source', stepId: '2' });
});

test('a fresh mirror on a payment already at stage 3 reports no return', () => {
  const { stages, steps } = chainFor(payment());
  const at = recurringApprovalPosition({ status: 'Pending Approval' }, steps, stages);
  assert.equal(at.returned, false);
});

/* ── round trip through the real router ──────────────────────────────────────────────────────── */

test('an approval given in E-Approval moves the payment exactly as the payment’s own screen would', () => {
  const pay = payment({ currentStepId: '2', status: 'Under Verification' });
  const { stages } = chainFor(pay);
  const action = plan(1, 2, stages);
  assert.equal(action.kind, 'Advance Source');

  const routed = routeRecurringWorkflow({
    workflow: WORKFLOW,
    step: WORKFLOW[1],
    action: action.steps[0].action,
    payment: pay,
    actorId: 'u-verify',
  });
  assert.equal(routed.currentStepId, '3');
  assert.equal(routed.status, 'Pending Approval');
  assert.equal(routed.stage, 'Payment Approval');
});

test('the router holds a sequential approval at its own step until the last level signs', () => {
  const pay = payment({
    currentStepId: '3', status: 'Pending Approval', approvalMode: 'Sequential',
    approvalLevels: ['u-a', 'u-b'], currentApprovalLevel: 1, billAmount: 250000,
  });
  const first = routeRecurringWorkflow({ workflow: WORKFLOW, step: WORKFLOW[2], action: 'Approve', payment: pay, actorId: 'u-a' });
  assert.equal(first.currentStepId, '3', 'still at the approval step');
  assert.equal(first.currentApprovalLevel, 2);
  assert.deepEqual(first.assignees, ['u-b']);

  const second = routeRecurringWorkflow({
    workflow: WORKFLOW, step: WORKFLOW[2], action: 'Approve', actorId: 'u-b',
    payment: { ...pay, currentApprovalLevel: 2, approvalCompletedBy: ['u-a'] },
  });
  assert.equal(second.currentStepId, '4', 'the last level releases it');
});

test('a return in the router restarts an approval it lands back on', () => {
  const pay = payment({
    currentStepId: '4', status: 'Payment Processing', approvalMode: 'Sequential',
    approvalLevels: ['u-a', 'u-b'], currentApprovalLevel: 2, approvalCompletedBy: ['u-a'],
  });
  const routed = routeRecurringWorkflow({ workflow: WORKFLOW, step: WORKFLOW[3], action: 'Return for Correction', payment: pay, actorId: 'u-accounts' });
  assert.equal(routed.currentStepId, '3');
  assert.equal(routed.currentApprovalLevel, 1, 'signatures given against figures now being corrected do not stand');
  assert.deepEqual(routed.approvalCompletedBy, []);
});

test('the router refuses to park a payment at a step with nobody on it', () => {
  const workflow = [WORKFLOW[0], { ...WORKFLOW[1], assignedTo: [] }];
  assert.throws(
    () => routeRecurringWorkflow({
      workflow, step: workflow[0], action: 'Submit Bill', actorId: 'u-owner',
      payment: payment({ verifierId: '' }),
    }),
    /No assignee is configured for Bill Verification/,
  );
});

test('the last step closes the payment out of the workflow', () => {
  const pay = payment({ currentStepId: '5', status: 'Paid' });
  const routed = routeRecurringWorkflow({ workflow: WORKFLOW, step: WORKFLOW[4], action: 'Close', payment: pay, actorId: 'u-accounts' });
  assert.equal(routed.workflowStatus, 'Completed');
  assert.equal(routed.status, 'Closed');
  assert.equal(routed.currentStepId, null);
  assert.deepEqual(routed.assignees, []);
});

/* ── eligibility ─────────────────────────────────────────────────────────────────────────────── */

test('nothing is mirrored while the bridge is off — that is what makes the modules work alone', () => {
  assert.equal(shouldMirrorRecurringPayment(payment(), settings({ enabled: false })), false);
});

test('a payment below the threshold raises no note-sheet', () => {
  assert.equal(shouldMirrorRecurringPayment(payment({ expectedAmount: 4000 }), settings({ minAmount: 10000 })), false);
  assert.equal(shouldMirrorRecurringPayment(payment({ expectedAmount: 40000 }), settings({ minAmount: 10000 })), true);
});

test('the threshold is measured against the billed amount once there is one', () => {
  const pay = payment({ expectedAmount: 4000, billAmount: 90000 });
  assert.equal(shouldMirrorRecurringPayment(pay, settings({ minAmount: 10000 })), true);
});

test('a scheduled payment nobody holds yet raises nothing', () => {
  assert.equal(shouldMirrorRecurringPayment(payment({ currentStepId: null, status: 'Scheduled' }), settings()), false);
});

test('a closed, cancelled or deleted payment never grows a new mirror', () => {
  for (const status of ['Closed', 'Cancelled', 'Rejected', 'Waived']) {
    assert.equal(shouldMirrorRecurringPayment(payment({ status }), settings()), false, status);
  }
  assert.equal(shouldMirrorRecurringPayment(payment({ deleted: true }), settings()), false);
});

test('a deliberately detached payment is not re-mirrored behind the administrator’s back', () => {
  assert.equal(
    shouldMirrorRecurringPayment(payment({ eApproval: { requestId: 'EA1', detachedAt: {} } }), settings()),
    false,
  );
});

/* ── self-approval skip in the engine ────────────────────────────────────────────────────────── */

const user = (id, name) => ({ kind: 'User', userId: id, userName: name });

function submitted(templateSteps, requesterId, settingsOverride = {}) {
  let n = 0;
  const steps = buildEApprovalSteps(templateSteps, { nextId: (seed) => `${seed}#${(n += 1)}` });
  const request = {
    id: 'EA1', referenceNo: 'EA/2026-27/00001', status: 'Draft', version: 1,
    requesterId, requesterName: 'Debaprasad', priority: 'Normal',
  };
  return applyEApprovalAction(request, steps, {
    kind: 'Submit',
    actor: { userId: requesterId },
    now: '2026-08-22T10:00:00.000Z',
    settings: settingsOverride,
  });
}

test('a stage that lands on the requester is auto-approved and the chain carries on', () => {
  const result = submitted(
    [
      { id: 't1', name: 'Site Accountant', assignments: [user('u-req')] },
      { id: 't2', name: 'Project Manager', assignments: [user('u-pm', 'Rekha')] },
    ],
    'u-req',
  );
  const own = result.steps.find((step) => step.name === 'Site Accountant');
  assert.equal(own.status, 'Completed');
  assert.equal(own.outcome, 'Approved');
  assert.equal(own.actedByUserId, 'u-req');
  assert.equal(own.onBehalfOfUserId, undefined, 'the requester is not acting on behalf of themselves');
  assert.match(own.comment, /Auto-approved/);
  assert.equal(result.steps.find((step) => step.name === 'Project Manager').status, 'Active');
  assert.equal(result.request.pendingLabel, 'Pending with Rekha');
  assert.match(
    result.events.find((event) => event.stepName === 'Site Accountant').summary,
    /auto-approved — Debaprasad raised this request/,
  );
});

test('a run of consecutive self-stages is consumed in one go', () => {
  const result = submitted(
    [
      { id: 't1', name: 'Own A', assignments: [user('u-req')] },
      { id: 't2', name: 'Own B', assignments: [{ kind: 'Requester' }] },
      { id: 't3', name: 'Director', assignments: [user('u-dir')] },
    ],
    'u-req',
  );
  assert.deepEqual(
    result.steps.map((step) => step.status),
    ['Completed', 'Completed', 'Active'],
  );
});

test('a chain that is entirely the requester’s own completes on submission', () => {
  const result = submitted([{ id: 't1', name: 'Self', assignments: [user('u-req')] }], 'u-req');
  assert.equal(result.request.status, 'Approved');
  assert.ok(result.notifications.some((intent) => intent.kind === 'Approved'));
});

test('a parallel group the requester is only one member of still waits for the others', () => {
  const result = submitted(
    [{ id: 't1', name: 'Board', assignments: [user('u-req'), user('u-a'), user('u-b')], groupMode: 'All' }],
    'u-req',
  );
  const byAssignee = Object.fromEntries(result.steps.map((step) => [step.assignment.userId, step.status]));
  assert.deepEqual(byAssignee, { 'u-req': 'Completed', 'u-a': 'Active', 'u-b': 'Active' });
  assert.equal(result.request.status, 'Pending Approval', 'still pending — the group is not satisfied');
});

test('an “any one of them” group the requester is in is satisfied by them alone', () => {
  const result = submitted(
    [
      { id: 't1', name: 'Either', assignments: [user('u-req'), user('u-a')], groupMode: 'Any' },
      { id: 't2', name: 'Director', assignments: [user('u-dir')] },
    ],
    'u-req',
  );
  const either = result.steps.filter((step) => step.name === 'Either');
  assert.deepEqual(either.map((step) => step.status).sort(), ['Completed', 'Skipped']);
  assert.equal(result.steps.find((step) => step.name === 'Director').status, 'Active');
});

test('a stage the requester must personally perform is never auto-approved away', () => {
  let n = 0;
  const stages = buildRecurringMirrorStages(WORKFLOW, payment(), settings());
  const steps = attachRecurringMirrorFields(
    buildEApprovalSteps(recurringMirrorTemplateSteps(stages), { nextId: (seed) => `${seed}#${(n += 1)}` }),
    stages,
  );
  const request = {
    id: 'EA1', status: 'Draft', version: 1,
    requesterId: 'u-owner', requesterName: 'Anita', priority: 'Normal',
  };
  const result = applyEApprovalAction(request, steps, {
    kind: 'Submit', actor: { userId: 'u-owner' }, now: '2026-08-22T10:00:00.000Z',
  });
  const collection = result.steps.find((step) => step.mirrorStepId === '1');
  assert.equal(collection.status, 'Active', 'the owner still has to collect the bill');
  assert.equal(result.request.status, 'Pending Approval');
});

test('the skip can be turned off, and then the requester’s own stage waits for them', () => {
  const result = submitted(
    [{ id: 't1', name: 'Site Accountant', assignments: [user('u-req')] }],
    'u-req',
    { skipSelfApprovalSteps: false },
  );
  assert.equal(result.steps[0].status, 'Active');
  assert.equal(result.request.status, 'Pending Approval');
});

/* ── presentation ────────────────────────────────────────────────────────────────────────────── */

test('the approval names the payment and its vendor', () => {
  assert.equal(recurringMirrorSubject(payment()), 'Office Rent — Aug 2026 — Sunrise Estates');
});

test('the proposal says whether the figure is billed or still estimated', () => {
  assert.match(recurringMirrorBody(payment()), /estimated — bill not yet received/);
  assert.match(recurringMirrorBody(payment({ billAmount: 260000 })), /\(billed\)/);
});

test('a variance warning is spelled out in the proposal, not left in the payment module', () => {
  const body = recurringMirrorBody(payment({ billAmount: 500000, varianceWarning: true, variancePercent: 100, varianceBaseline: 250000 }));
  assert.match(body, /Variance 100\.0% against a baseline of/);
});

test('an overdue payment raises an urgent approval, not a routine one', () => {
  const today = new Date('2026-09-10T09:00:00');
  assert.equal(recurringMirrorPriority(payment({ dueDate: '2026-09-05' }), today), 'Urgent');
  assert.equal(recurringMirrorPriority(payment({ dueDate: '2026-09-12' }), today), 'High');
  assert.equal(recurringMirrorPriority(payment({ dueDate: '2026-10-30' }), today), 'Normal');
  assert.equal(recurringMirrorPriority(payment({ dueDate: '2026-10-30', priority: 'Critical' }), today), 'Urgent');
});

test('a source chip reads as the module and the record', () => {
  assert.equal(
    describeEApprovalSource({ module: 'Recurring Payments', recordId: 'p1', recordLabel: 'Office Rent' }),
    'Recurring Payments · Office Rent',
  );
  assert.equal(describeEApprovalSource(null), '');
});

test('a detached link is no longer a live mirror', () => {
  assert.equal(isMirroredEApproval({ module: 'Recurring Payments', recordId: 'p1' }), true);
  assert.equal(isMirroredEApproval({ module: 'Recurring Payments', recordId: 'p1', detachedAt: 'x' }), false);
  assert.equal(isMirroredEApproval(undefined), false);
});
