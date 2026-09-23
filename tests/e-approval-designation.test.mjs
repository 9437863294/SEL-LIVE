import test from 'node:test';
import assert from 'node:assert/strict';
import {
  refreshEApprovalPointers,
  describeEApprovalAssignment,
  eApprovalRowIsQuickApprovable,
  eApprovalWorkflowBlockingIssues,
  isEApprovalStepAssignee,
  normaliseDesignation,
} from '../src/lib/e-approval-policy.ts';

/*
 * Addressing a stage to a designation.
 *
 * The picker's fourth tab has always been labelled "Designation" and always listed the ERP `roles`
 * master — permission bundles, which in this tenant include "Default", "Office Hub" and several
 * people's own names. These tests pin the thing it was describing: a stage addressed to the job
 * title greytHR maintains, reaching whoever currently holds it.
 *
 * `Role` is deliberately still here and still works. Nothing offers it, but a workflow saved before
 * this existed may name one, and a stored assignment that silently stops matching is an approval
 * that sits in nobody's inbox.
 */

const step = (assignment, extra = {}) => ({
  id: 's1',
  approvalId: 'a1',
  type: 'APPROVAL',
  name: 'Accounts check',
  sequence: 1,
  depth: 0,
  parentStepId: null,
  originStepId: null,
  assignment,
  status: 'Active',
  ...extra,
});

/* ------------------------------------------------------------------------------------------------
 * Who may act
 * ---------------------------------------------------------------------------------------------- */

test('a designation stage reaches whoever holds that job title', () => {
  const accounts = step({ kind: 'Designation', designation: 'JR. ACCOUNTANT' });
  assert.equal(isEApprovalStepAssignee(accounts, { userId: 'u-puja', designation: 'JR. ACCOUNTANT' }), true);
  assert.equal(isEApprovalStepAssignee(accounts, { userId: 'u-ram', designation: 'Site Engineer' }), false);
});

test('the role is not consulted, in either direction', () => {
  const accounts = step({ kind: 'Designation', designation: 'JR. ACCOUNTANT' });
  // The exact shape of the tenant's data: a login whose *role* is "HO Account" and whose greytHR
  // title is something else entirely must not be caught by an accounts stage.
  assert.equal(
    isEApprovalStepAssignee(accounts, { userId: 'u-x', role: 'HO Account', designation: 'HR Asst.' }),
    false,
  );
  // And somebody with the right title is reached whatever their role happens to be.
  assert.equal(
    isEApprovalStepAssignee(accounts, { userId: 'u-y', role: 'Default', designation: 'JR. ACCOUNTANT' }),
    true,
  );
});

test('an actor with no designation matches no designation stage', () => {
  const accounts = step({ kind: 'Designation', designation: 'JR. ACCOUNTANT' });
  assert.equal(isEApprovalStepAssignee(accounts, { userId: 'u-contractor' }), false);
  // ...and an empty title on the assignment reaches nobody rather than everybody.
  assert.equal(isEApprovalStepAssignee(step({ kind: 'Designation', designation: '' }), { userId: 'u-a' }), false);
});

test('surrounding whitespace does not split one title into two', () => {
  const padded = step({ kind: 'Designation', designation: '  Site Engineer ' });
  assert.equal(isEApprovalStepAssignee(padded, { userId: 'u-a', designation: 'Site Engineer' }), true);
});

test('matching is case-sensitive, because the inbox query cannot fold case', () => {
  // Not a preference — `currentDesignations` is queried with `array-contains`, which is exact. A
  // looser matcher here would say somebody may act on a file their own inbox never returns.
  const accounts = step({ kind: 'Designation', designation: 'JR. ACCOUNTANT' });
  assert.equal(isEApprovalStepAssignee(accounts, { userId: 'u-a', designation: 'Jr. Accountant' }), false);
});

test('a Role stage still works — stored workflows must not stop matching', () => {
  const legacy = step({ kind: 'Role', role: 'HO Account' });
  assert.equal(isEApprovalStepAssignee(legacy, { userId: 'u-a', role: 'HO Account' }), true);
  assert.equal(isEApprovalStepAssignee(legacy, { userId: 'u-b', designation: 'HO Account' }), false);
});

/* ------------------------------------------------------------------------------------------------
 * Being findable
 * ---------------------------------------------------------------------------------------------- */

test('a designation stage writes the pointer the inbox queries', () => {
  const request = {};
  refreshEApprovalPointers(request, [step({ kind: 'Designation', designation: '  JR. ACCOUNTANT ' })]);
  assert.deepEqual(
    request.currentDesignations,
    ['JR. ACCOUNTANT'],
    'trimmed, so the stored pointer and the query argument are the same string',
  );
});

test('the pointer is deduplicated and ignores stages of other kinds', () => {
  const request = {};
  refreshEApprovalPointers(request, [
    step({ kind: 'Designation', designation: 'Site Engineer' }, { id: 's1' }),
    step({ kind: 'Designation', designation: 'Site Engineer' }, { id: 's2' }),
    step({ kind: 'User', userId: 'u-a' }, { id: 's3' }),
  ]);
  assert.deepEqual(request.currentDesignations, ['Site Engineer']);
  assert.deepEqual(request.currentAssigneeIds, ['u-a']);
});

test('a file sitting with a designation is not offered as a one-click approval', () => {
  // Same reasoning as a department queue: it is addressed to a group, so "approve" is one vote.
  const row = {
    id: 'r1',
    status: 'In Progress',
    requesterId: 'u-req',
    currentStepIds: ['s1'],
    currentAssigneeIds: ['u-a'],
    currentDesignations: ['JR. ACCOUNTANT'],
  };
  assert.equal(eApprovalRowIsQuickApprovable(row, { userId: 'u-a' }), false);
});

/* ------------------------------------------------------------------------------------------------
 * Configuration feedback
 * ---------------------------------------------------------------------------------------------- */

test('a designation stage counts as having an approver', () => {
  const issues = eApprovalWorkflowBlockingIssues({
    steps: [{ name: 'Accounts check', assignments: [{ kind: 'Designation', designation: 'JR. ACCOUNTANT' }] }],
  });
  assert.deepEqual(issues, []);
});

test('a designation stage with no title is reported as having no approver', () => {
  const issues = eApprovalWorkflowBlockingIssues({
    steps: [{ name: 'Accounts check', assignments: [{ kind: 'Designation', designation: '' }] }],
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Accounts check/);
});

test('it reads back as the title itself, not as "Role: …"', () => {
  assert.equal(
    describeEApprovalAssignment({ kind: 'Designation', designation: 'JR. ACCOUNTANT' }),
    'JR. ACCOUNTANT',
  );
  assert.equal(describeEApprovalAssignment({ kind: 'Role', role: 'Default' }), 'Role: Default');
});

test('normaliseDesignation is the single definition both sides use', () => {
  assert.equal(normaliseDesignation('  Site Engineer  '), 'Site Engineer');
  assert.equal(normaliseDesignation(null), '');
  assert.equal(normaliseDesignation(undefined), '');
});
