import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  E_APPROVAL_STATUSES,
  OPEN_E_APPROVAL_STATUSES,
  TERMINAL_E_APPROVAL_STATUSES,
  isOpenEApprovalStatus,
} from '../src/lib/e-approval-policy.ts';
import {
  CLOSED_TASK_STATUSES,
  DECISION_STATUSES,
  TASK_STATUSES,
} from '../src/lib/office-hub-model.ts';

/**
 * The status vocabularies the dashboard filters on must be the real ones.
 *
 * This file exists because of a bug it would have caught. The dashboard's E-Approval source shipped
 * filtering on `['PENDING', 'IN_PROGRESS', 'RETURNED', 'DRAFT_RETURNED', 'CLARIFICATION']` — plausible
 * looking constants that are not members of `EApprovalStatus`, whose real values are Title Case with
 * spaces. Nothing failed. No type error, no exception, no empty-state: the filter simply matched none
 * of the fourteen real statuses, so the source returned zero rows and the board reported an empty
 * inbox to people who had approvals waiting. The identical mistake was live in the Windows agent's
 * morning summary at the same time.
 *
 * That is the failure mode worth guarding: a status filter cannot be wrong loudly, so it has to be
 * wrong provably. Every assertion below is about a filter list *intersecting reality*, not about the
 * particular strings — so these stay true as statuses are added, and fail if a list drifts out of
 * the union it is supposed to select from.
 */

test('every open E-Approval status is a real member of the status union', () => {
  assert.ok(OPEN_E_APPROVAL_STATUSES.length > 0, 'the open list must not be empty');
  for (const status of OPEN_E_APPROVAL_STATUSES) {
    assert.ok(
      E_APPROVAL_STATUSES.includes(status),
      `'${status}' is not a member of E_APPROVAL_STATUSES — a filter on it matches nothing`,
    );
  }
});

test('the open list is exactly what the predicate selects', () => {
  // Derived rather than hand-listed, so a new status joins every inbox query automatically.
  assert.deepEqual(OPEN_E_APPROVAL_STATUSES, E_APPROVAL_STATUSES.filter(isOpenEApprovalStatus));
});

test('the three pending states a user acts on are all treated as open', () => {
  // Approval, verification and clarification are the module's three inbox cards. All three were
  // missing from the dashboard when the filter used invented constants.
  for (const status of ['Pending Approval', 'Pending Verification', 'Pending Clarification']) {
    assert.ok(E_APPROVAL_STATUSES.includes(status), `'${status}' should exist in the union`);
    assert.ok(OPEN_E_APPROVAL_STATUSES.includes(status), `'${status}' should count as open work`);
  }
});

test('open and terminal are disjoint, and Draft is in neither', () => {
  for (const status of TERMINAL_E_APPROVAL_STATUSES) {
    assert.ok(!OPEN_E_APPROVAL_STATUSES.includes(status), `'${status}' is terminal and must not be open`);
  }
  // A draft is nobody's pending work — it has not been submitted.
  assert.ok(!OPEN_E_APPROVAL_STATUSES.includes('Draft'));
  assert.ok(!TERMINAL_E_APPROVAL_STATUSES.includes('Draft'));
  assert.equal(isOpenEApprovalStatus('Draft'), false);
});

test('a status that does not exist is not open', () => {
  // The precise shape of the original bug: these all looked like statuses and matched nothing.
  for (const invented of ['PENDING', 'IN_PROGRESS', 'RETURNED', 'DRAFT_RETURNED', 'CLARIFICATION']) {
    assert.ok(
      !E_APPROVAL_STATUSES.includes(invented),
      `'${invented}' must not exist — this test documents why the filter broke`,
    );
    assert.ok(!OPEN_E_APPROVAL_STATUSES.includes(invented));
  }
});

test('the open Office Hub task statuses are a real, non-empty subset of the task union', () => {
  // The dashboard derives its task filter the same way; same class of mistake, different module.
  const open = TASK_STATUSES.filter((status) => !CLOSED_TASK_STATUSES.includes(status));
  assert.ok(open.length > 0, 'every task status cannot be closed');
  assert.deepEqual(open, ['Not Started', 'In Progress', 'On Hold']);
  for (const status of CLOSED_TASK_STATUSES) {
    assert.ok(TASK_STATUSES.includes(status), `'${status}' must be a real TaskStatus`);
    assert.ok(!open.includes(status));
  }
});

test('the open decision and action-item statuses are a real, non-empty subset', () => {
  // `ActionItemStatus` is `DecisionStatus`, so one list covers both sources.
  const open = DECISION_STATUSES.filter((status) => status !== 'Completed' && status !== 'Cancelled');
  assert.deepEqual(open, ['Open', 'In Progress']);
  for (const status of open) assert.ok(DECISION_STATUSES.includes(status));
});
