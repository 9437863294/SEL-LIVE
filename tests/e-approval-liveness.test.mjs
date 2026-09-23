import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from the policy module rather than `e-approval.ts`, which re-exports Firestore-client
// types that only resolve inside the bundler.
import {
  applyEApprovalAction,
  buildEApprovalSteps,
  canViewEApproval,
  eApprovalDelegators,
  eApprovalRowIsQuickApprovable,
  eApprovalStepUnchanged,
  EApprovalRuleError,
} from '../src/lib/e-approval-policy.ts';

/**
 * Regression cover for the "the file is with somebody, but no screen says so" family.
 *
 * Every test here stands for a report that a file had gone quiet: an answered clarification that
 * never came back, a held file nobody could find again, a substitute who was told they were covering
 * and saw an empty inbox. They all reduce to the same question — after this action, do the request's
 * denormalised pointers and the notification intents name the person actually holding the file? —
 * which is a question about the pure engine, so it can be asked here rather than against Firestore.
 */

let counter = 0;
const makeIdFactory = () => () => `id-${++counter}`;
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

function act(state, input) {
  const result = applyEApprovalAction(state.request, state.steps, { nextId: state.nextId, ...input });
  return {
    ...state,
    ...result,
    allNotifications: [...(state.allNotifications ?? []), ...result.notifications],
  };
}

const stepNamed = (state, name) => state.steps.find((step) => step.name.startsWith(name));

const serialChain = [
  { id: 't1', name: 'Manager', assignments: [user('u-mgr', 'Manager')], slaHours: 24 },
  { id: 't2', name: 'Director', assignments: [user('u-dir', 'Director')], slaHours: 48 },
];

const submitted = (chain = serialChain, overrides) =>
  act(scenario(chain, overrides), { kind: 'Submit', actor: requester, now: '2026-08-22T10:00:00.000Z' });

/* ── a held file is still somebody's ─────────────────────────────────────────────────────────── */

test('a file on hold stays in the holder’s inbox', () => {
  let state = submitted();
  state = act(state, {
    kind: 'Hold',
    actor: { userId: 'u-mgr', userName: 'Manager' },
    reason: 'Waiting for the revised quotation.',
    now: '2026-08-22T11:00:00.000Z',
  });

  assert.equal(stepNamed(state, 'Manager').status, 'On Hold');
  assert.equal(state.request.status, 'On Hold');
  assert.ok(
    state.request.currentAssigneeIds.includes('u-mgr'),
    'the holder must still be pointed at, or the file leaves their inbox and Resume is unreachable',
  );
  assert.deepEqual(state.request.currentStepIds, [stepNamed(state, 'Manager').id]);
});

test('a held file is not offered one-click approval', () => {
  let state = submitted();
  state = act(state, {
    kind: 'Hold',
    actor: { userId: 'u-mgr', userName: 'Manager' },
    reason: 'Waiting.',
    now: '2026-08-22T11:00:00.000Z',
  });
  const row = {
    id: 'EA1',
    status: state.request.status,
    requesterId: 'u-req',
    currentStepIds: state.request.currentStepIds,
    currentAssigneeIds: state.request.currentAssigneeIds,
    currentDepartmentIds: state.request.currentDepartmentIds,
    currentRoles: state.request.currentRoles,
    currentStepType: null,
  };
  // The holder is pointed at so the file stays findable; the button would still be refused by the
  // engine, because approving needs an Active step.
  assert.equal(eApprovalRowIsQuickApprovable(row, { userId: 'u-mgr' }), false);
});

test('a hold stops the clock even though the file stays in the queue', () => {
  let state = submitted();
  state = act(state, {
    kind: 'Hold',
    actor: { userId: 'u-mgr', userName: 'Manager' },
    reason: 'Waiting.',
    now: '2026-08-22T11:00:00.000Z',
  });
  assert.equal(state.request.currentDueAt, null, 'a paused step contributes no deadline');
});

test('a step waiting on a verifier does NOT stay in the asker’s inbox', () => {
  let state = submitted();
  state = act(state, {
    kind: 'Send For Verification',
    actor: { userId: 'u-mgr', userName: 'Manager' },
    targets: [user('u-qs', 'QS Cell')],
    now: '2026-08-22T11:00:00.000Z',
  });
  // The distinction the pointer rule turns on: a hold is "mine, paused"; awaiting verification is
  // "genuinely with somebody else". Only one of them belongs in the asker's queue.
  assert.equal(stepNamed(state, 'Manager').status, 'Awaiting Verification');
  assert.deepEqual(state.request.currentAssigneeIds, ['u-qs']);
});

/* ── clarification reaches the person who is waiting ─────────────────────────────────────────── */

test('a clarification asked of the requester is addressed to the requester', () => {
  let state = submitted();
  state = act(state, {
    kind: 'Request Clarification',
    actor: { userId: 'u-mgr', userName: 'Manager' },
    targets: [{ kind: 'Requester' }],
    instruction: 'Which purchase order is this against?',
    now: '2026-08-22T11:00:00.000Z',
  });

  const asked = state.notifications.find((intent) => intent.kind === 'Clarification Requested');
  assert.ok(asked, 'a clarification request must raise an intent');
  assert.deepEqual(
    asked.userIds,
    ['u-req'],
    'a Requester-kind target carries no userId of its own; unresolved, the notice reaches nobody',
  );
});

test('the answer to a clarification goes back to the member who claimed the step, not the department', () => {
  let state = submitted([
    { id: 't1', name: 'Purchase', assignments: [{ kind: 'Department', departmentId: 'dept-pur', departmentMode: 'Anyone' }], slaHours: 24 },
  ]);
  state = act(state, {
    kind: 'Take Ownership',
    actor: { userId: 'u-arun', userName: 'Arun', departmentIds: ['dept-pur'] },
    now: '2026-08-22T10:30:00.000Z',
  });
  state = act(state, {
    kind: 'Request Clarification',
    actor: { userId: 'u-arun', userName: 'Arun', departmentIds: ['dept-pur'] },
    targets: [{ kind: 'Requester' }],
    instruction: 'Confirm the rate.',
    now: '2026-08-22T11:00:00.000Z',
  });
  state = act(state, {
    kind: 'Provide Clarification',
    actor: requester,
    comment: 'Rate is 4,250 per MT.',
    now: '2026-08-22T12:00:00.000Z',
  });

  const back = state.notifications.find((intent) => intent.title === 'Clarification received');
  assert.ok(back, 'the asker must be told the answer arrived');
  assert.ok(
    back.userIds.includes('u-arun'),
    'the person who claimed the step is the one waiting for the answer',
  );
  assert.deepEqual(
    back.departmentIds ?? [],
    [],
    'once a member has claimed it the rest of the department is not waiting on it',
  );
});

/* ── project-addressed stages are findable ───────────────────────────────────────────────────── */

test('a stage addressed to a project records a project pointer', () => {
  const state = submitted([
    {
      id: 't1',
      name: 'Site In-Charge',
      assignments: [{ kind: 'Project', projectId: 'p-ranchi', projectMode: 'Anyone' }],
      slaHours: 24,
    },
  ]);
  assert.deepEqual(
    state.request.currentProjectIds,
    ['p-ranchi'],
    'without this pointer no list query can find the file and it sits in nobody’s inbox',
  );
});

/* ── a return that hands the file to an approver is not the requester’s to resend ────────────── */

test('a direct return does not put the requester in the inbox', () => {
  let state = submitted();
  state = act(state, { kind: 'Approve', actor: { userId: 'u-mgr', userName: 'Manager' }, now: '2026-08-22T10:30:00.000Z' });
  state = act(state, {
    kind: 'Return',
    actor: { userId: 'u-dir', userName: 'Director' },
    returnTo: stepNamed(state, 'Manager').id,
    reason: 'Check the figures.',
    settings: { returnViaRequester: false },
    now: '2026-08-22T11:00:00.000Z',
  });

  assert.equal(stepNamed(state, 'Manager').status, 'Active', 'the target approver holds it again');
  assert.deepEqual(
    state.request.currentAssigneeIds,
    ['u-mgr'],
    'the status still reads Returned, but the file is with the approver, not the requester',
  );
});

test('the requester cannot resubmit a chain an approver is already working on', () => {
  let state = submitted();
  state = act(state, { kind: 'Approve', actor: { userId: 'u-mgr', userName: 'Manager' }, now: '2026-08-22T10:30:00.000Z' });
  state = act(state, {
    kind: 'Return',
    actor: { userId: 'u-dir', userName: 'Director' },
    returnTo: stepNamed(state, 'Manager').id,
    reason: 'Check the figures.',
    settings: { returnViaRequester: false },
    now: '2026-08-22T11:00:00.000Z',
  });

  assert.throws(
    () => act(state, { kind: 'Resubmit', actor: requester, now: '2026-08-22T11:30:00.000Z' }),
    EApprovalRuleError,
    'resubmitting here would activate a second stage alongside the one already running',
  );
});

/* ── the step-diff guard that decides which documents a write touches ────────────────────────── */

/**
 * This comparison was wrong twice, in the same direction both times: it compared a stripped stored
 * step against an unstripped new one, so nothing ever matched and every action rewrote every step
 * in the chain from the acting user's snapshot. It lived in a module that cannot be imported
 * outside the bundler, which is why neither mistake was caught. It is testable now.
 */
test('an untouched step is recognised as unchanged despite differing audit stamps', () => {
  const stored = {
    id: 's1',
    status: 'Active',
    name: 'Manager',
    createdAt: { seconds: 1, nanoseconds: 0 },
    createdBy: 'u-req',
    createdByName: 'Debaprasad',
    updatedAt: { seconds: 2, nanoseconds: 0 },
    updatedBy: 'u-req',
    updatedByName: 'Debaprasad',
  };
  /*
   * The new side carries stamps too, and that is the whole point of the test.
   *
   * The engine is handed the raw Firestore documents and clones them by spreading, so the stamps
   * ride along into the payload — which is why stripping only the stored side left six keys that
   * could never match, and why this guard was dead through two attempts at writing it. A fixture
   * whose new side has no stamps passes either way and proves nothing.
   */
  const next = {
    name: 'Manager',
    status: 'Active',
    id: 's1',
    createdAt: { seconds: 1, nanoseconds: 0 },
    createdBy: 'u-req',
    createdByName: 'Debaprasad',
    updatedAt: { seconds: 9, nanoseconds: 0 },
    updatedBy: 'u-mgr',
    updatedByName: 'Manager',
  };
  assert.equal(eApprovalStepUnchanged(stored, next), true);
});

test('a step whose status changed is not reported as unchanged', () => {
  assert.equal(
    eApprovalStepUnchanged({ id: 's1', status: 'Active' }, { id: 's1', status: 'Completed' }),
    false,
  );
});

test('a denormalised field changing still counts as a change', () => {
  // These are not audit stamps: the write copies them from the request onto the step, so a request
  // whose priority changed must push that down.
  assert.equal(
    eApprovalStepUnchanged({ id: 's1', priority: 'Normal' }, { id: 's1', priority: 'Urgent' }),
    false,
  );
});

test('key order and nesting do not create a false difference', () => {
  assert.equal(
    eApprovalStepUnchanged(
      { id: 's1', assignment: { userId: 'u-1', kind: 'User' }, escalationsSent: ['r1', 'r2'] },
      { escalationsSent: ['r1', 'r2'], assignment: { kind: 'User', userId: 'u-1' }, id: 's1' },
    ),
    true,
  );
});

test('array order is a real difference, not a key-order artefact', () => {
  assert.equal(
    eApprovalStepUnchanged({ id: 's1', escalationsSent: ['r1', 'r2'] }, { id: 's1', escalationsSent: ['r2', 'r1'] }),
    false,
  );
});

test('clearing a field that was set is a change', () => {
  // The stored side has the key, the new side does not: the write has to carry the deletion.
  assert.equal(eApprovalStepUnchanged({ id: 's1', comment: 'note' }, { id: 's1' }), false);
  // Absent on both sides, one of them explicitly undefined: nothing to write.
  assert.equal(eApprovalStepUnchanged({ id: 's1' }, { id: 's1', comment: undefined }), true);
});

/* ── standing delegations ────────────────────────────────────────────────────────────────────── */

const cover = {
  id: 'd1',
  fromUserId: 'u-dir',
  fromUserName: 'Director',
  toUserId: 'u-cfo',
  toUserName: 'CFO',
  fromDate: '2026-08-01',
  toDate: '2026-12-31',
  active: true,
};

/**
 * `canViewEApproval` reads the clock itself — it has no injectable `now` — so the fixtures it uses
 * are open-ended rather than dated. A window pinned to 2026 would have quietly started failing the
 * whole file on 1 January 2027, which is the kind of test failure that gets muted rather than read.
 */
const openEndedCover = { ...cover, fromDate: '2000-01-01', toDate: null };
const expiredCover = { ...cover, fromDate: '2000-01-01', toDate: '2000-12-31' };

test('eApprovalDelegators lists whose queue this person is covering', () => {
  assert.deepEqual(eApprovalDelegators({ userId: 'u-cfo', delegations: [cover] }, '2026-08-22'), ['u-dir']);
});

test('a delegation outside its window covers nobody', () => {
  assert.deepEqual(eApprovalDelegators({ userId: 'u-cfo', delegations: [cover] }, '2027-01-02'), []);
  assert.deepEqual(eApprovalDelegators({ userId: 'u-cfo', delegations: [cover] }, '2026-07-31'), []);
});

test('a delegation pointed at somebody else covers nobody', () => {
  assert.deepEqual(eApprovalDelegators({ userId: 'u-other', delegations: [cover] }, '2026-08-22'), []);
});

test('a scoped delegation only covers the approval types it names', () => {
  const scoped = { ...cover, approvalTypeIds: ['AT-TRAVEL'] };
  assert.deepEqual(
    eApprovalDelegators({ userId: 'u-cfo', delegations: [scoped] }, '2026-08-22', 'AT-TRAVEL'),
    ['u-dir'],
  );
  assert.deepEqual(
    eApprovalDelegators({ userId: 'u-cfo', delegations: [scoped] }, '2026-08-22', 'AT-PURCHASE'),
    [],
  );
});

test('a standing delegate can open the file they are authorised to act on', () => {
  const state = submitted();
  const substitute = { userId: 'u-cfo', userName: 'CFO', delegations: [openEndedCover] };
  // Authority to act on a file you cannot open is no authority at all: before this, the substitute
  // met "Not visible to you" for the whole cover period.
  assert.equal(canViewEApproval(state.request, state.steps, substitute), true);
});

test('somebody with no delegation still cannot open a file they are not part of', () => {
  const state = submitted();
  const stranger = { userId: 'u-nobody', userName: 'Nobody', delegations: [] };
  assert.equal(canViewEApproval(state.request, state.steps, stranger), false);
});

test('a lapsed delegation does not keep the file open to the substitute', () => {
  const state = submitted();
  const substitute = { userId: 'u-cfo', userName: 'CFO', delegations: [expiredCover] };
  assert.equal(canViewEApproval(state.request, state.steps, substitute), false);
});
