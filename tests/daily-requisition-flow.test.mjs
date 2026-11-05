import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTakeInto,
  handOverCandidates,
  heldStep,
  holdAfterVerify,
  holdForMove,
  placeSteps,
  planTake,
  positionOf,
  renumberSteps,
  resolveStepAssignees,
  stepAfterVerify,
  stepNamesUser,
  takeSourcesOf,
  verificationPlacementProblem,
  withStepKeys,
} from '../src/lib/daily-requisition-flow.ts';

const NOW = 'now';

const receiving = { id: '1', key: 'rec', name: 'Receiving at Finance', assignmentType: 'User-based', assignedTo: ['fin'] };
const checkA = { id: '2', key: 'va', name: 'Site Check', kind: 'verification', assignmentType: 'User-based', assignedTo: ['amit', 'alt'] };
const checkB = {
  id: '3',
  key: 'vb',
  name: 'Project Check',
  kind: 'verification',
  assignmentType: 'Project-based',
  assignedTo: { p1: { primary: 'pm1', alternative: '' } },
};
const gst = { id: '4', key: 'gst', name: 'GST & TDS Verification', assignmentType: 'User-based', assignedTo: ['tax'] };
const audit = { id: '5', key: 'vc', name: 'Audit', kind: 'verification', assignmentType: 'User-based', assignedTo: ['aud'] };
const payment = { id: '6', key: 'pay', name: 'Processed for Payment', assignmentType: 'User-based', assignedTo: ['cash'] };

const steps = [receiving, checkA, checkB, gst, audit, payment];
const entry = (fields) => ({ projectId: 'p1', departmentId: 'd1', ...fields });

test('built-in stages are counted among themselves; verification steps hold before the stage that follows', () => {
  const placed = placeSteps(steps);
  assert.deepEqual(
    placed.map((p) => [p.role, p.builtinIndex, p.segment]),
    [
      ['receiving', 0, null],
      ['verification', null, 1],
      ['verification', null, 1],
      ['gst', 1, null],
      ['verification', null, 2],
      ['payment', 2, null],
    ],
  );
});

test('a verification step first or after payment cannot hold anything, and says so', () => {
  assert.match(verificationPlacementProblem([checkA, receiving, gst, payment], 0), /before "Receiving at Finance"/);
  assert.match(verificationPlacementProblem([receiving, gst, payment, checkA], 3), /before "Processed for Payment"/);
  assert.equal(verificationPlacementProblem(steps, 1), null);
  assert.equal(verificationPlacementProblem(steps, 3), null, 'built-in stages have no placement problem');
});

test('assignees come from the step for the requisition, project- and department-based included', () => {
  assert.deepEqual(resolveStepAssignees(checkA, entry({})), ['amit', 'alt']);
  assert.deepEqual(resolveStepAssignees(checkB, entry({})), ['pm1']);
  assert.deepEqual(resolveStepAssignees(checkB, entry({ projectId: 'p2' })), []);
  assert.equal(stepNamesUser(checkB, 'pm1'), true);
  assert.equal(stepNamesUser(checkB, 'amit'), false);
});

test('receiving at Finance lands it at the first verification step', () => {
  const fields = holdForMove(steps, entry({ status: 'Pending' }), 'Received', NOW);
  assert.deepEqual(fields, { heldAt: 'va', heldAssignees: ['amit', 'alt'], heldSince: NOW });
});

test('a step that names nobody for the project is passed over', () => {
  const onlyB = [receiving, checkB, gst, payment];
  assert.deepEqual(holdForMove(onlyB, entry({ status: 'Pending', projectId: 'p9' }), 'Received', NOW), {});
});

test('sent for payment lands it at the verification step before payment', () => {
  const fields = holdForMove(steps, entry({ status: 'Verified' }), 'Received for Payment', NOW);
  assert.deepEqual(fields, { heldAt: 'vc', heldAssignees: ['aud'], heldSince: NOW });
});

test('any other move releases a hold, and writes nothing when there is none', () => {
  const held = entry({ status: 'Received', heldAt: 'va', heldAssignees: ['amit'] });
  assert.deepEqual(holdForMove(steps, held, 'Pending', NOW), { heldAt: null, heldAssignees: [], heldSince: null });
  assert.deepEqual(holdForMove(steps, entry({ status: 'Verified' }), 'Received', NOW), {}, 'sent back from GST: no hold');
});

test('verifying passes it on within the segment, then releases it to the stage', () => {
  const atA = entry({ status: 'Received', heldAt: 'va', heldAssignees: ['amit'] });
  assert.deepEqual(holdAfterVerify(steps, atA, NOW), { heldAt: 'vb', heldAssignees: ['pm1'], heldSince: NOW });
  const atB = entry({ status: 'Received', heldAt: 'vb', heldAssignees: ['pm1'] });
  assert.deepEqual(holdAfterVerify(steps, atB, NOW), { heldAt: null, heldAssignees: [], heldSince: null });
  assert.equal(stepAfterVerify(steps, 1), 'Project Check');
  assert.equal(stepAfterVerify(steps, 2), 'GST & TDS Verification');
});

test('a hold on a deleted step, or in the wrong status, is no hold', () => {
  const placed = placeSteps(steps);
  assert.equal(heldStep(placed, entry({ status: 'Received', heldAt: 'gone' })), null);
  assert.equal(heldStep(placed, entry({ status: 'Verified', heldAt: 'va' })), null);
  assert.equal(positionOf(placed, entry({ status: 'Received', heldAt: 'gone' })), 3, 'waits at GST instead');
  assert.equal(positionOf(placed, entry({ status: 'Received', heldAt: 'va' })), 1);
  assert.equal(positionOf(placed, entry({ status: 'Paid' })), null);
});

test('take sources are earlier ticked steps only', () => {
  const withTake = steps.map((s) => (s.key === 'gst' ? { ...s, takeFrom: ['vb', 'rec', 'pay', 'missing'] } : s));
  const placed = placeSteps(withTake);
  assert.deepEqual(takeSourcesOf(placed, 3).map((p) => p.key), ['rec', 'vb']);
  assert.equal(canTakeInto(placed, 0), false, 'nothing comes before the first step');
});

test('taking from the step just before releases the hold and keeps the status', () => {
  const withTake = steps.map((s) => (s.key === 'gst' ? { ...s, takeFrom: ['vb'] } : s));
  const result = planTake(withTake, entry({ status: 'Received', heldAt: 'vb', heldAssignees: ['pm1'] }), 3, { now: NOW, actorId: 'tax' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.update, { heldAt: null, heldAssignees: [], heldSince: null });
  assert.deepEqual(result.plan.skipped, ['Project Check']);
});

test('taking from Receiving skips the steps between and stamps the receipt', () => {
  const withTake = steps.map((s) => (s.key === 'gst' ? { ...s, takeFrom: ['rec'] } : s));
  const result = planTake(withTake, entry({ status: 'Pending' }), 3, { now: NOW, actorId: 'tax' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.update, {
    heldAt: null,
    heldAssignees: [],
    heldSince: null,
    status: 'Received',
    receivedAt: NOW,
    receivedById: 'tax',
  });
  assert.deepEqual(result.plan.skipped, ['Receiving at Finance', 'Site Check', 'Project Check']);
  assert.equal(result.plan.skipsGstVerification, false);
});

test('taking into a verification step needs the taker to be its assignee, and holds it there', () => {
  const withTake = steps.map((s) => (s.key === 'vc' ? { ...s, takeFrom: ['gst'] } : s));
  const atGst = entry({ status: 'Received' });
  const refused = planTake(withTake, atGst, 4, { now: NOW, actorId: 'tax' });
  assert.equal(refused.ok, false);
  const result = planTake(withTake, atGst, 4, { now: NOW, actorId: 'aud' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.update, {
    heldAt: 'vc',
    heldAssignees: ['aud'],
    heldSince: NOW,
    status: 'Received for Payment',
  });
  assert.equal(result.plan.skipsGstVerification, true, 'not verified at GST yet');
});

test('a step not set to take from where it is refuses', () => {
  const result = planTake(steps, entry({ status: 'Pending' }), 3, { now: NOW, actorId: 'tax' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not set to take/);
  const reached = planTake(
    steps.map((s) => (s.key === 'gst' ? { ...s, takeFrom: ['rec'] } : s)),
    entry({ status: 'Verified' }),
    3,
    { now: NOW, actorId: 'tax' },
  );
  assert.equal(reached.ok, false);
});

test('hand-over goes to the step list when it has one, never back to the holder', () => {
  const users = [{ id: 'amit' }, { id: 'bina' }, { id: 'chen' }];
  assert.deepEqual(handOverCandidates(checkA, users, ['amit']).map((u) => u.id), ['bina', 'chen']);
  assert.deepEqual(handOverCandidates({ ...checkA, handOverUserIds: ['chen'] }, users, ['amit']).map((u) => u.id), ['chen']);
});

test('configuration keys every step once and keeps take-from lists pointing backwards', () => {
  let n = 0;
  const keyed = withStepKeys([{ name: 'A' }, { name: 'B', key: 'x' }, { name: 'C', key: 'x' }], () => `k${++n}`);
  assert.deepEqual(keyed.map((s) => s.key), ['k1', 'x', 'k2']);

  const reordered = renumberSteps([gst, receiving, { ...checkA, takeFrom: ['gst', 'rec'] }, payment]);
  assert.deepEqual(reordered.map((s) => s.id), ['1', '2', '3', '4']);
  assert.deepEqual(reordered[2].takeFrom, ['gst', 'rec']);
  const moved = renumberSteps([{ ...checkA, takeFrom: ['rec'] }, receiving, gst, payment]);
  assert.equal(moved[0].takeFrom, undefined, 'nothing comes before it any more');
  const stripped = renumberSteps([{ ...receiving, handOverUserIds: ['x'] }, gst]);
  assert.equal(stripped[0].handOverUserIds, undefined);
});

/* ── handing over at any step ── */

test('hand-over is on for verification steps unless switched off, and off for stages unless switched on', async () => {
  const { allowsHandOver } = await import('../src/lib/daily-requisition-flow.ts');
  assert.equal(allowsHandOver(checkA), true);
  assert.equal(allowsHandOver({ ...checkA, allowHandOver: false }), false);
  assert.equal(allowsHandOver(gst), false);
  assert.equal(allowsHandOver({ ...gst, allowHandOver: true }), true);
});

test('each status belongs to one built-in stage', async () => {
  const { stageOfStatus } = await import('../src/lib/daily-requisition-flow.ts');
  assert.equal(stageOfStatus('Pending'), 'receiving');
  assert.equal(stageOfStatus(undefined), 'receiving');
  assert.equal(stageOfStatus('Needs Review'), 'gst');
  assert.equal(stageOfStatus('Partially Paid'), 'payment');
  assert.equal(stageOfStatus('Paid'), null);
});

test('an assignment stands only while it is at that stage and not held at a verification step', async () => {
  const { assignedStageOf } = await import('../src/lib/daily-requisition-flow.ts');
  const placed = placeSteps(steps);
  const atGst = entry({ status: 'Verified', assignedStage: 'gst', assignedTo: ['bina'] });
  assert.equal(assignedStageOf(placed, atGst)?.key, 'gst');
  assert.equal(assignedStageOf(placed, { ...atGst, status: 'Received for Payment' }), null, 'moved on to payment');
  assert.equal(assignedStageOf(placed, { ...atGst, assignedTo: [] }), null);
  assert.equal(
    assignedStageOf(placed, entry({ status: 'Received', heldAt: 'va', heldAssignees: ['amit'], assignedStage: 'gst', assignedTo: ['bina'] })),
    null,
    'held before GST',
  );
});

test('a move within the assigned stage keeps the assignment; leaving it ends it', () => {
  const assigned = entry({ status: 'Received', assignedStage: 'gst', assignedTo: ['bina'] });
  assert.deepEqual(holdForMove(steps, assigned, 'Verified', NOW), {});
  assert.deepEqual(holdForMove(steps, { ...assigned, status: 'Verified' }, 'Received for Payment', NOW), {
    heldAt: 'vc',
    heldAssignees: ['aud'],
    heldSince: NOW,
    assignedStage: null,
    assignedTo: [],
    assignedSince: null,
  });
});

test('taking a requisition early ends its assignment where it was', () => {
  const withTake = steps.map((s) => (s.key === 'gst' ? { ...s, takeFrom: ['rec'] } : s));
  const result = planTake(withTake, entry({ status: 'Pending', assignedStage: 'receiving', assignedTo: ['fin2'] }), 3, {
    now: NOW,
    actorId: 'tax',
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.update.assignedStage, null);
  assert.deepEqual(result.plan.update.assignedTo, []);
});

test('a stage keeps its hand-over list only while hand-over is on', () => {
  const kept = renumberSteps([receiving, { ...gst, allowHandOver: true, handOverUserIds: ['bina'] }, payment]);
  assert.deepEqual(kept[1].handOverUserIds, ['bina']);
  const dropped = renumberSteps([receiving, { ...checkA, allowHandOver: false, handOverUserIds: ['bina'] }, gst, payment]);
  assert.equal(dropped[1].handOverUserIds, undefined);
});

/* ── several people on a step ── */

test('a step can name any number of people, by person or per project', async () => {
  const { assignedPeople, peopleToAssignment } = await import('../src/lib/daily-requisition-flow.ts');
  const many = { ...checkA, assignedTo: ['amit', 'bina', 'chen', 'dev', ''] };
  assert.deepEqual(resolveStepAssignees(many, entry({})), ['amit', 'bina', 'chen', 'dev']);

  const perProject = {
    ...checkB,
    assignedTo: { p1: { primary: 'pm1', alternative: 'pm2', additional: ['pm3', 'pm1'] } },
  };
  assert.deepEqual(resolveStepAssignees(perProject, entry({})), ['pm1', 'pm2', 'pm3']);
  assert.equal(stepNamesUser(perProject, 'pm3'), true);

  assert.deepEqual(peopleToAssignment(['a']), { primary: 'a', alternative: '' });
  assert.deepEqual(peopleToAssignment(['a', 'b', 'c', 'd']), { primary: 'a', alternative: 'b', additional: ['c', 'd'] });
  assert.deepEqual(assignedPeople(peopleToAssignment(['a', 'b', 'c'])), ['a', 'b', 'c']);
});
