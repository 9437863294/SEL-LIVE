import test from 'node:test';
import assert from 'node:assert/strict';

import { withConfigDefaults } from '../src/lib/bill-tracking/defaults.ts';
import {
  CONFIGURABLE_STEPS,
  actionBlocked,
  availableActions,
  certificationBlocked,
  isInvolved,
  isMyTask,
  isNamedInWorkflow,
  nextStepAfter,
  normaliseWorkflowSteps,
  resubmitTo,
  waitingFor,
} from '../src/lib/bill-tracking/workflow.ts';

/** Settings with some stages changed. */
const settingsWith = (changes = {}) => ({ workflowSteps: normaliseWorkflowSteps(Object.entries(changes).map(([status, patch]) => ({ status, ...patch }))) });
/** A role-permission checker from a list like ['Bills.Verify']; `projects` limits the scope. */
const actor = (userId, permissions = [], projects = null) => ({
  userId,
  can: (resource, action, projectId) => (projectId === undefined || projects === null || projects.includes(projectId)) && permissions.includes(`${resource}.${action}`),
});
const bill = (status, extra = {}) => ({ id: 'b1', workflowStatus: status, projectId: 'p1', createdBy: 'preparer', collectionOwnerId: 'owner', isDeleted: false, ...extra });

test('defaults: every stage after Draft, all in use, left to permission holders', () => {
  const steps = withConfigDefaults(null).settings.workflowSteps;
  assert.deepEqual(steps.map((step) => step.status), [...CONFIGURABLE_STEPS]);
  assert.ok(steps.every((step) => step.enabled && step.assignment === 'permission' && step.userIds.length === 0 && step.notify && !step.onlyAssigned));
  // Mandatory stages cannot be switched off, duplicates and blanks are dropped.
  const repaired = normaliseWorkflowSteps([{ status: 'raised', enabled: false }, { status: 'verified', enabled: false, userIds: ['a', 'a', ''] }]);
  assert.equal(repaired.find((step) => step.status === 'raised').enabled, true);
  assert.equal(repaired.find((step) => step.status === 'verified').enabled, false);
  assert.deepEqual(repaired.find((step) => step.status === 'verified').userIds, ['a']);
});

test('with nobody named, the role permissions decide (as before)', () => {
  const settings = settingsWith();
  assert.equal(actionBlocked('approve', bill('verified'), settings, actor('u1', ['Bills.Approve'])), null);
  assert.match(actionBlocked('approve', bill('verified'), settings, actor('u1', ['Bills.Verify'])), /Approve permission/);
  assert.match(actionBlocked('approve', bill('verified'), settings, actor('u1', ['Bills.Approve'], ['p2'])), /permission/, 'outside the project scope');
  assert.match(actionBlocked('approve', bill('raised'), settings, actor('u1', ['Bills.Approve'])), /cannot be moved/);
});

test('a named person does the stage without any role permission or project grant', () => {
  const settings = settingsWith({ approved: { assignment: 'users', userIds: ['ravi'] } });
  assert.equal(actionBlocked('approve', bill('verified'), settings, actor('ravi', [], [])), null);
  // Permission holders still can — unless "only them".
  assert.equal(actionBlocked('approve', bill('verified'), settings, actor('boss', ['Bills.Approve'])), null);
  const only = settingsWith({ approved: { assignment: 'users', userIds: ['ravi'], onlyAssigned: true } });
  assert.match(actionBlocked('approve', bill('verified'), only, actor('boss', ['Bills.Approve'])), /Only the people assigned/);
  assert.equal(actionBlocked('approve', bill('verified'), only, actor('ravi')), null);
  // "Only them" with nobody named does not lock the stage.
  const empty = settingsWith({ approved: { assignment: 'users', userIds: [], onlyAssigned: true } });
  assert.equal(actionBlocked('approve', bill('verified'), empty, actor('boss', ['Bills.Approve'])), null);
});

test('the bill’s collection owner, with backups', () => {
  const settings = settingsWith({ payment_followup: { assignment: 'collection_owner', userIds: ['backup'], onlyAssigned: true } });
  assert.equal(actionBlocked('start_followup', bill('certified'), settings, actor('owner')), null);
  assert.equal(actionBlocked('start_followup', bill('certified'), settings, actor('backup')), null);
  assert.match(actionBlocked('start_followup', bill('certified'), settings, actor('someone', ['Bills.Edit'])), /Only the people/);
  assert.equal(actionBlocked('start_followup', bill('certified', { collectionOwnerId: undefined }), settings, actor('backup')), null);
});

test('switched-off stages are skipped: no button into them, returns step back past them', () => {
  const settings = settingsWith({ under_verification: { enabled: false }, verified: { enabled: false } });
  const verifier = actor('v', ['Bills.Verify', 'Bills.Approve', 'Bills.Edit']);
  const names = availableActions(bill('submitted'), settings, verifier).map((entry) => entry.action);
  assert.ok(!names.includes('start_verification') && !names.includes('verify'));
  // The next stage in use is Approved: approve, not straight to raised.
  assert.ok(names.includes('approve') && !names.includes('raise') && names.includes('return'));
  assert.match(actionBlocked('verify', bill('submitted'), settings, verifier), /switched off/);
  assert.equal(nextStepAfter('submitted', settings), 'approved');
  // Returned from Approved: back to Submitted (Verified and Under verification are off).
  assert.equal(resubmitTo('approved', settings), 'submitted');
  assert.equal(resubmitTo('approved', settingsWith()), 'verified');
  assert.equal(resubmitTo('submitted', settings), 'draft');
});

test('returning is for whoever would move the bill on; the preparer resubmits', () => {
  const settings = settingsWith({ verified: { assignment: 'users', userIds: ['checker'], onlyAssigned: true } });
  // From Under verification the next stage is Verified → its people may return it.
  assert.equal(actionBlocked('return', bill('under_verification'), settings, actor('checker')), null);
  assert.match(actionBlocked('return', bill('under_verification'), settings, actor('other', ['Bills.Verify'])), /Only the people/);
  assert.equal(actionBlocked('resubmit', bill('returned', { returnedFrom: 'verified' }), settings, actor('preparer')), null, 'the preparer, without a permission');
});

test('who records the certification', () => {
  const settings = settingsWith({ certified: { assignment: 'users', userIds: ['site'], onlyAssigned: true } });
  assert.equal(certificationBlocked(bill('raised'), settings, actor('site')), null);
  assert.match(certificationBlocked(bill('raised'), settings, actor('fin', ['Bills.Certify'])), /Only the people/);
  assert.equal(certificationBlocked(bill('raised'), settingsWith(), actor('fin', ['Bills.Certify'])), null);
  assert.match(certificationBlocked(bill('raised'), settingsWith(), actor('fin')), /Certify/);
});

test('up to Bill Raised the stages are taken in order — no raising a draft', () => {
  const all = actor('boss', ['Bills.Edit', 'Bills.Verify', 'Bills.Approve']);
  const moves = (status, settings = settingsWith()) => availableActions(bill(status), settings, all).map((entry) => entry.action);
  assert.deepEqual(moves('draft'), ['submit']);
  assert.match(actionBlocked('raise', bill('draft'), settingsWith(), all), /“Submitted” comes first/);
  assert.match(actionBlocked('approve', bill('submitted'), settingsWith(), all), /“Under Verification” comes first/);
  assert.deepEqual(moves('submitted'), ['start_verification', 'return']);
  assert.deepEqual(moves('approved'), ['raise', 'return']);
  // A stage switched off is passed over: with Submitted off, a draft goes on to Under Verification.
  assert.deepEqual(moves('draft', settingsWith({ submitted: { enabled: false } })), ['start_verification']);
  assert.deepEqual(moves('draft', settingsWith({ submitted: { enabled: false }, under_verification: { enabled: false } })), ['verify']);
  // Every pre-raise stage off: a draft is raised directly.
  const bare = settingsWith({ submitted: { enabled: false }, under_verification: { enabled: false }, verified: { enabled: false }, approved: { enabled: false } });
  assert.deepEqual(moves('draft', bare), ['raise']);
  // After Bill Raised the moves stay free.
  assert.ok(moves('raised').includes('start_followup') && moves('raised').includes('close'));
});

test('a certification follows the stages before it: not until the bill is raised', () => {
  const fin = actor('fin', ['Bills.Certify']);
  for (const status of ['draft', 'submitted', 'under_verification', 'verified', 'approved']) {
    assert.match(certificationBlocked(bill(status), settingsWith(), fin), /raised bill/, status);
  }
  for (const status of ['raised', 'certified', 'payment_followup', 'reconciliation', 'closed']) {
    assert.equal(certificationBlocked(bill(status), settingsWith(), fin), null, status);
  }
  // Returned: it counts as raised only if it was returned from Bill Raised or later.
  assert.match(certificationBlocked({ ...bill('returned'), returnedFrom: 'approved' }, settingsWith(), fin), /raised bill/);
  assert.equal(certificationBlocked({ ...bill('returned'), returnedFrom: 'certified' }, settingsWith(), fin), null);
  // One already recorded on an earlier stage (older bills) stays correctable and removable.
  assert.equal(certificationBlocked({ ...bill('draft'), certification: { revision: 1 } }, settingsWith(), fin), null);
  // Even someone named on the Certified stage waits for the bill to be raised.
  const named = settingsWith({ certified: { assignment: 'users', userIds: ['site'], onlyAssigned: true } });
  assert.match(certificationBlocked(bill('draft'), named, actor('site')), /raised bill/);
});

test('waiting for: the next stage’s people; “mine” for named people or, with none named, permission holders', () => {
  const settings = settingsWith({ approved: { assignment: 'users', userIds: ['ravi'] }, verified: { enabled: false }, under_verification: { enabled: false } });
  assert.deepEqual(waitingFor(bill('submitted'), settings), { status: 'approved', userIds: ['ravi'] });
  assert.equal(isMyTask(bill('submitted'), settings, actor('ravi')), true);
  assert.equal(isMyTask(bill('submitted'), settings, actor('boss', ['Bills.Approve'])), false, 'someone is named — it is theirs');
  // Raised → waiting for the certification; nobody named → Bills · Certify holders.
  assert.deepEqual(waitingFor(bill('raised'), settings), { status: 'certified', userIds: [] });
  assert.equal(isMyTask(bill('raised'), settings, actor('fin', ['Bills.Certify'])), true);
  assert.equal(isMyTask(bill('raised'), settings, actor('fin', ['Bills.Certify'], ['p9'])), false, 'not on their project');
  // Returned → the preparer; closed and deleted bills wait for nobody.
  assert.deepEqual(waitingFor(bill('returned'), settings), { status: null, userIds: ['preparer'] });
  assert.equal(waitingFor(bill('closed'), settings), null);
  assert.equal(waitingFor(bill('raised', { isDeleted: true }), settings), null);
});

test('named people get into the module and can open the bills they are named for', () => {
  const settings = settingsWith({ certified: { assignment: 'users', userIds: ['site'] }, payment_followup: { assignment: 'collection_owner' } });
  assert.equal(isNamedInWorkflow(settings, 'site'), true);
  assert.equal(isNamedInWorkflow(settings, 'owner'), false, 'a collection owner is named per bill, not on the stage');
  assert.equal(isNamedInWorkflow(settingsWith({ certified: { assignment: 'permission', userIds: ['site'] } }), 'site'), false, 'names left over after switching back to permissions do not count');
  assert.equal(isInvolved(bill('draft'), settings, 'site'), true);
  assert.equal(isInvolved(bill('draft'), settings, 'owner'), true);
  assert.equal(isInvolved(bill('draft'), settings, 'stranger'), false);
});
