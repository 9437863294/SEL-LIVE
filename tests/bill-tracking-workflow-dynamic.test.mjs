import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIGURABLE_STEPS,
  actionBlocked,
  completeWorkflowStep,
  availableActions,
  certificationNotDue,
  defaultWorkflowStep,
  isPastApproval,
  moveTarget,
  nextStepAfter,
  normaliseWorkflowSteps,
  reopenTo,
  resubmitTo,
  stepLabel,
  workflowPath,
  workflowProblem,
} from '../src/lib/bill-tracking/workflow.ts';

const boss = { userId: 'boss', can: (resource, action) => resource === 'Bills' && ['Edit', 'Verify', 'Approve', 'Certify'].includes(action) };
const bill = (status, extra = {}) => ({ id: 'b1', workflowStatus: status, projectId: 'p1', createdBy: 'preparer', collectionOwnerId: 'owner', isDeleted: false, ...extra });
/** The default workflow as a full, named list — what Settings saves. */
const defaults = () => normaliseWorkflowSteps(undefined);
const withSteps = (steps) => ({ workflowSteps: steps });
const moves = (status, settings) => availableActions(bill(status), settings, boss).map((entry) => (entry.action === 'advance' ? `advance:${entry.to}` : entry.action));

test('the default workflow is the one before it was configurable, named and in order', () => {
  const steps = defaults();
  assert.deepEqual(steps.map((step) => step.status), [...CONFIGURABLE_STEPS]);
  assert.deepEqual(workflowPath(undefined), ['draft', ...CONFIGURABLE_STEPS]);
  assert.equal(stepLabel(undefined, 'raised'), 'Bill Raised');
  assert.equal(steps.find((step) => step.status === 'approved').locksAmounts, true);
  assert.deepEqual(steps.find((step) => step.status === 'approved').permissions, ['Approve']);
});

test('settings saved before steps had names are overrides on the default list', () => {
  const steps = normaliseWorkflowSteps([{ status: 'verified', enabled: false }]);
  assert.deepEqual(steps.map((step) => step.status), [...CONFIGURABLE_STEPS]);
  assert.equal(steps.find((step) => step.status === 'verified').enabled, false);
});

test('a step added between Verified and Approved is taken in order, by its own name', () => {
  const steps = defaults();
  const check = { ...defaultWorkflowStep('site_check', 'Site check'), actionLabel: 'Site checked', permissions: ['Verify'] };
  steps.splice(steps.findIndex((step) => step.status === 'approved'), 0, check);
  const settings = withSteps(steps);
  assert.equal(nextStepAfter('verified', settings), 'site_check');
  assert.deepEqual(moves('verified', settings), ['advance:site_check', 'return']);
  assert.match(actionBlocked('approve', bill('verified'), settings, boss), /“Site check” comes first/);
  assert.equal(actionBlocked({ action: 'advance', to: 'site_check' }, bill('verified'), settings, boss), null);
  assert.equal(availableActions(bill('verified'), settings, boss)[0].label, 'Site checked');
  assert.equal(moveTarget({ action: 'advance', to: 'site_check' }, bill('verified'), settings), 'site_check');
  // Returned from it, a bill goes back to the step before.
  assert.equal(resubmitTo('site_check', settings), 'verified');
  assert.equal(stepLabel(settings, 'site_check'), 'Site check');
});

test('removing the default review steps leaves Draft → Bill raised, and a renamed step keeps its job', () => {
  const steps = defaults()
    .filter((step) => !['submitted', 'under_verification', 'verified', 'approved'].includes(step.status))
    .map((step) => (step.status === 'raised' ? { ...step, label: 'Sent to client' } : step));
  const settings = withSteps(steps);
  assert.deepEqual(moves('draft', settings), ['raise']);
  assert.equal(stepLabel(settings, 'raised'), 'Sent to client');
  assert.match(certificationNotDue(bill('draft'), settings), /Take it to “Sent to client” first/);
  assert.equal(certificationNotDue(bill('raised'), settings), null);
  // With no locking review step, the amounts lock at Bill raised.
  assert.equal(isPastApproval('draft', settings), false);
  assert.equal(isPastApproval('raised', settings), true);
});

test('the amounts lock at the first step that locks them', () => {
  const steps = defaults().map((step) => (step.status === 'verified' ? { ...step, locksAmounts: true } : step));
  assert.equal(isPastApproval('under_verification', withSteps(steps)), false);
  assert.equal(isPastApproval('verified', withSteps(steps)), true);
  assert.equal(isPastApproval('verified', undefined), false, 'by default only from Approved');
  assert.equal(isPastApproval('approved', undefined), true);
});

test('a step can be made returnable or not', () => {
  const steps = defaults().map((step) => (step.status === 'verified' ? { ...step, canReturn: false } : step));
  assert.match(actionBlocked('return', bill('verified'), withSteps(steps), boss), /cannot be returned/);
  assert.equal(actionBlocked('return', bill('verified'), undefined, boss), null);
  assert.match(actionBlocked('return', bill('raised'), undefined, boss), /cannot be returned/);
});

test('certification is never a button; closed reopens to payment follow-up, or the step before it', () => {
  assert.match(actionBlocked({ action: 'advance', to: 'certified' }, bill('raised'), undefined, boss), /recorded/);
  assert.equal(reopenTo(undefined), 'payment_followup');
  const noFollowUp = defaults().map((step) => (step.status === 'payment_followup' ? { ...step, enabled: false } : step));
  assert.equal(reopenTo(withSteps(noFollowUp)), 'reconciliation');
});

test('a configuration that does not hold together is refused', () => {
  const steps = defaults();
  assert.equal(workflowProblem(steps), null);
  assert.match(workflowProblem(steps.filter((step) => step.status !== 'certified')), /cannot be removed/);
  const swapped = [...steps];
  const raised = swapped.findIndex((step) => step.status === 'raised');
  [swapped[raised], swapped[raised + 1]] = [swapped[raised + 1], swapped[raised]];
  assert.match(workflowProblem(swapped), /must stay in that order/);
  assert.match(workflowProblem([...steps, defaultWorkflowStep('after_close', 'After close')]), /last/);
  assert.match(workflowProblem(steps.map((step) => (step.status === 'verified' ? { ...step, label: '' } : step))), /needs a name/);
  assert.match(workflowProblem(steps.map((step) => (step.status === 'verified' ? { ...step, label: 'Submitted' } : step))), /called “Submitted”/);
  assert.match(workflowProblem([...steps, { ...steps[0] }]), /share the id/);
});

test('repair puts back a missing role step, keeps role order and Closed last', () => {
  const repaired = normaliseWorkflowSteps([
    { status: 'closed', label: 'Done' },
    { status: 'site_check', label: 'Site check' },
    { status: 'raised', label: 'Raised' },
  ]);
  const ids = repaired.map((step) => step.status);
  assert.equal(ids.at(-1), 'closed');
  assert.ok(ids.indexOf('raised') < ids.indexOf('certified') && ids.indexOf('certified') < ids.indexOf('payment_followup'));
  assert.equal(repaired.find((step) => step.status === 'closed').label, 'Done');
  // Bad ids are dropped.
  assert.ok(!normaliseWorkflowSteps([{ status: 'Bad Id!', label: 'x' }, { status: 'raised', label: 'R' }]).some((step) => step.status === 'Bad Id!'));
});

test('a step can take several permissions — holding any one is enough', () => {
  const steps = defaults().map((step) => (step.status === 'verified' ? { ...step, permissions: ['Verify', 'Approve'] } : step));
  const settings = withSteps(steps);
  const approver = { userId: 'a', can: (resource, action) => resource === 'Bills' && action === 'Approve' };
  const editor = { userId: 'e', can: (resource, action) => resource === 'Bills' && action === 'Edit' };
  assert.equal(actionBlocked('verify', bill('under_verification'), settings, approver), null);
  assert.match(actionBlocked('verify', bill('under_verification'), settings, editor), /Bills · Verify or Approve/);
  // A step saved with one permission (before lists) keeps it.
  assert.deepEqual(normaliseWorkflowSteps([{ status: 'verified', label: 'Verified', permission: 'Approve' }]).find((step) => step.status === 'verified').permissions, ['Approve']);
  // Unknown permissions are dropped; an empty list falls back to the default.
  assert.deepEqual(normaliseWorkflowSteps([{ status: 'verified', label: 'Verified', permissions: ['Nonsense'] }]).find((step) => step.status === 'verified').permissions, ['Verify']);
});

test('a step loaded in the one-permission shape is completed on the settings screen, name kept as typed', () => {
  const old = defaults().map(({ permissions, locksAmounts, canReturn, ...rest }) => ({ ...rest, permission: permissions[0] }));
  const completed = old.map(completeWorkflowStep);
  assert.ok(completed.every((step) => Array.isArray(step.permissions) && step.permissions.length));
  assert.deepEqual(completed.find((step) => step.status === 'approved').permissions, ['Approve']);
  assert.equal(completed.find((step) => step.status === 'approved').locksAmounts, true);
  assert.equal(completeWorkflowStep({ ...completed[0], label: '' }).label, '', 'a name being retyped is not snapped back');
});
