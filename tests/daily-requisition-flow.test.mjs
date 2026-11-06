import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalActionsOf,
  claimedRoles,
  canTakeInto,
  handBackOf,
  handOverCandidates,
  heldStep,
  holdAfterVerify,
  holdForCreate,
  holdForMove,
  isHeld,
  PAYMENT_PAGE_NAME,
  pipelineKeyOf,
  pipelineOf,
  placeSteps,
  planReject,
  planReviseToApproval,
  planSendBack,
  planTake,
  positionOf,
  renumberSteps,
  resolveStepAssignees,
  STAGE_PERMISSION_PAGES,
  stagePermissionPage,
  STEP_ACTIONS,
  stepAfterVerify,
  stageWorkProblems,
  stepNamesUser,
  stepWorkLabel,
  takeSourcesOf,
  upgradeWorkflowSteps,
  verificationPlacementProblem,
  waitingStatusesAt,
  withDerivedKind,
  withStepKeys,
  workflowAccessLists,
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

// Payment is the fixed page after the last step, not a step: Audit holds before it.
const steps = [receiving, checkA, checkB, gst, audit];
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
    ],
  );
  assert.equal(PAYMENT_PAGE_NAME, 'Processed for Payment');
});

test('a verification step before the first stage holds new requisitions; after the last it holds before the payment page', () => {
  assert.equal(verificationPlacementProblem([checkA, receiving, gst], 0), null);
  assert.equal(placeSteps([checkA, receiving, gst])[0].segment, 0);
  assert.match(verificationPlacementProblem([checkA], 0), /no stage/);
  assert.equal(verificationPlacementProblem([receiving, gst, checkA], 2), null);
  assert.equal(placeSteps([receiving, gst, checkA])[2].segment, 2);
  // Between a step that sends for payment and a later one that receives: it can hold nothing.
  const outOfOrder = [{ key: 'g', name: 'Tax desk', actions: ['Send for Payment'] }, checkA, { key: 'r', name: 'Receive desk', actions: ['Mark as Received'] }];
  assert.match(verificationPlacementProblem(outOfOrder, 1), /before "Receive desk"/);
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
  const onlyB = [receiving, checkB, gst];
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

test('handed over with "send it back to me": once verified it returns to the one who handed it over, once', () => {
  const at = { toMillis: () => 1000 };
  const handed = entry({ status: 'Received', heldAt: 'va', heldAssignees: ['bina'], heldSince: at, heldReturn: { stepKey: 'va', to: ['amit'], since: { toMillis: () => 1000 } } });
  assert.deepEqual(handBackOf(handed, 'va'), ['amit']);
  assert.deepEqual(holdAfterVerify(steps, handed, NOW), { heldAt: 'va', heldAssignees: ['amit'], heldSince: NOW, heldReturn: null });
  // Back with Amit, who verifies it on as usual.
  assert.deepEqual(holdAfterVerify(steps, { ...handed, heldAssignees: ['amit'], heldSince: NOW, heldReturn: null }, NOW), {
    heldAt: 'vb',
    heldAssignees: ['pm1'],
    heldSince: NOW,
  });
  // A later move or hand-over (a new heldSince), or another step: the old request no longer applies.
  assert.equal(handBackOf({ ...handed, heldSince: { toMillis: () => 2000 } }, 'va'), null);
  assert.equal(handBackOf(handed, 'vb'), null);
  assert.equal(handBackOf({ ...handed, heldReturn: null }, 'va'), null);
});

test('the pipeline is the workflow as configured: approval steps, each finance work, then payment', () => {
  const live = [approval('v', 'Verification'), approval('a1', 'Approval 1'), { ...financeDesk, actions: ['Mark as Received', 'Send for Payment'] }];
  assert.deepEqual(pipelineOf(live).map((p) => [p.key, p.stepName]), [
    ['step:v', 'Verification'],
    ['step:a1', 'Approval 1'],
    ['work:receiving', 'Recieving at Finance'],
    ['work:gst', 'Recieving at Finance'],
    ['work:payment', 'Processed for Payment'],
  ]);
  const placed = placeSteps(live);
  // Pending but held at an approval step: it waits there, not at Finance.
  assert.equal(pipelineKeyOf(placed, entry({ status: 'Pending', heldAt: 'a1', heldAssignees: ['ap'] })), 'step:a1');
  assert.equal(pipelineKeyOf(placed, entry({ status: 'Pending' })), 'work:receiving');
  assert.equal(pipelineKeyOf(placed, entry({ status: 'Received' })), 'work:gst');
  assert.equal(pipelineKeyOf(placed, entry({ status: 'Partially Paid' })), 'work:payment');
  assert.equal(pipelineKeyOf(placed, entry({ status: 'Paid' })), null);
  assert.equal(pipelineKeyOf(placed, entry({ status: 'Cancelled' })), null);
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

  const reordered = renumberSteps([gst, receiving, { ...checkA, takeFrom: ['gst', 'rec'] }]);
  assert.deepEqual(reordered.map((s) => s.id), ['1', '2', '3']);
  assert.deepEqual(reordered[2].takeFrom, ['gst', 'rec']);
  const moved = renumberSteps([{ ...checkA, takeFrom: ['rec'] }, receiving, gst]);
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
  const kept = renumberSteps([receiving, { ...gst, allowHandOver: true, handOverUserIds: ['bina'] }]);
  assert.deepEqual(kept[1].handOverUserIds, ['bina']);
  const dropped = renumberSteps([receiving, { ...checkA, allowHandOver: false, handOverUserIds: ['bina'] }, gst]);
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

test('a built-in stage keeps its permissions by position, whatever it is named', () => {
  const steps = [
    { id: '1', key: 'v', name: 'Verification' },
    { id: '2', key: 'c', name: 'Site Check', kind: 'verification', assignmentType: 'User-based', assignedTo: ['amit'] },
    { id: '3', key: 'a1', name: 'Approval 1' },
    { id: '4', key: 'a2', name: 'Approval 2' },
    { id: '5', key: 'a3', name: 'Approval 3' },
  ];
  const pages = placeSteps(steps).map((p) => stagePermissionPage(p.builtinIndex, p.step.name));
  // Renamed stages take the permissions of their position; the Verification step and a stage with
  // no work (payment is the fixed page now) keep their names.
  assert.deepEqual(pages, ['Receiving at Finance', 'Site Check', 'GST & TDS Verification', 'Approval 2', 'Approval 3']);
  assert.deepEqual([...STAGE_PERMISSION_PAGES], ['Receiving at Finance', 'GST & TDS Verification', 'Processed for Payment']);
  assert.equal(stagePermissionPage(null, 'Anything'), 'Anything');
  assert.equal(stagePermissionPage(undefined, 'Anything'), 'Anything');
});

/* ── approval steps before Receiving at Finance ── */

const pre1 = { id: '1', key: 'p1s', name: 'Verification', kind: 'verification', assignmentType: 'User-based', assignedTo: ['v1'], actions: ['Send Back', 'Reject'] };
const pre2 = {
  id: '2',
  key: 'p2s',
  name: 'Approval 1',
  kind: 'verification',
  assignmentType: 'Project-based',
  assignedTo: { p1: { primary: 'a1', alternative: 'a1alt' } },
  actions: ['Send Back'],
};
const preSteps = [pre1, pre2, { ...receiving, id: '3' }, { ...checkA, id: '4' }, { ...gst, id: '5' }];
const RELEASED = { heldAt: null, heldAssignees: [], heldSince: null };

test('a new requisition starts at the first step before Finance that names someone for it', () => {
  assert.deepEqual(holdForCreate(preSteps, entry({ status: 'Pending' }), NOW), { heldAt: 'p1s', heldAssignees: ['v1'], heldSince: NOW });
  // Nothing before Finance: Finance receives it directly.
  assert.deepEqual(holdForCreate(steps, entry({ status: 'Pending' }), NOW), {});
  // An import bringing paid history is past every step.
  assert.deepEqual(holdForCreate(preSteps, entry({ status: 'Paid' }), NOW), {});
  const held = entry({ status: 'Pending', heldAt: 'p1s', heldAssignees: ['v1'] });
  assert.equal(isHeld(preSteps, held), true);
  assert.equal(positionOf(placeSteps(preSteps), held), 0);
});

test('verifying passes it along the steps before Finance, then releases it to Finance', () => {
  const atFirst = entry({ status: 'Pending', heldAt: 'p1s', heldAssignees: ['v1'] });
  assert.deepEqual(holdAfterVerify(preSteps, atFirst, NOW), { heldAt: 'p2s', heldAssignees: ['a1', 'a1alt'], heldSince: NOW });
  const atSecond = entry({ status: 'Pending', heldAt: 'p2s', heldAssignees: ['a1'] });
  assert.deepEqual(holdAfterVerify(preSteps, atSecond, NOW), RELEASED);
  // Finance's receipt then lands it at the step after Finance.
  assert.deepEqual(holdForMove(preSteps, entry({ status: 'Pending' }), 'Received', NOW), { heldAt: 'va', heldAssignees: ['amit', 'alt'], heldSince: NOW });
});

test('reopening a cancelled requisition sends it through the steps before Finance again', () => {
  assert.deepEqual(holdForMove(preSteps, entry({ status: 'Cancelled' }), 'Pending', NOW), { heldAt: 'p1s', heldAssignees: ['v1'], heldSince: NOW });
  // Returned to Pending after being received: it was approved already.
  assert.deepEqual(holdForMove(preSteps, entry({ status: 'Received' }), 'Pending', NOW), {});
});

test('send back: to the previous step of the segment, else to the stage before it; nothing before Finance', () => {
  const atSecond = entry({ status: 'Pending', heldAt: 'p2s', heldAssignees: ['a1'] });
  assert.deepEqual(planSendBack(preSteps, atSecond, NOW), {
    ok: true,
    toName: 'Verification',
    update: { heldAt: 'p1s', heldAssignees: ['v1'], heldSince: NOW },
  });
  assert.equal(planSendBack(preSteps, entry({ status: 'Pending', heldAt: 'p1s', heldAssignees: ['v1'] }), NOW).ok, false);
  // The first step after Finance: back to Finance, no longer received.
  assert.deepEqual(planSendBack(steps, entry({ status: 'Received', heldAt: 'va', heldAssignees: ['amit'] }), NOW), {
    ok: true,
    toName: 'Receiving at Finance',
    update: { ...RELEASED, status: 'Pending', receivedAt: null, receivedById: null },
  });
  // The second of its segment: back to the first.
  assert.deepEqual(planSendBack(steps, entry({ status: 'Received', heldAt: 'vb', heldAssignees: ['pm1'] }), NOW).update, {
    heldAt: 'va',
    heldAssignees: ['amit', 'alt'],
    heldSince: NOW,
  });
  // Before payment: back to GST & TDS Verification, verified.
  assert.deepEqual(planSendBack(steps, entry({ status: 'Received for Payment', heldAt: 'vc', heldAssignees: ['aud'] }), NOW), {
    ok: true,
    toName: 'GST & TDS Verification',
    update: { ...RELEASED, status: 'Verified' },
  });
  assert.equal(planSendBack(steps, entry({ status: 'Received' }), NOW).ok, false, 'not held');
});

test('reject cancels a held requisition and releases the hold', () => {
  assert.deepEqual(planReject(preSteps, entry({ status: 'Pending', heldAt: 'p1s', heldAssignees: ['v1'] })), {
    ok: true,
    toName: 'Cancelled',
    update: { ...RELEASED, status: 'Cancelled' },
  });
  assert.equal(planReject(preSteps, entry({ status: 'Pending' })).ok, false);
});

test('taking early into a step before Finance keeps it Pending and unreceived', () => {
  const taker = { ...pre2, takeFrom: ['p1s'] };
  const result = planTake([pre1, taker, ...preSteps.slice(2)], entry({ status: 'Pending', heldAt: 'p1s', heldAssignees: ['v1'] }), 1, {
    now: NOW,
    actorId: 'a1',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.update, { heldAt: 'p2s', heldAssignees: ['a1', 'a1alt'], heldSince: NOW });
});

test('approval buttons come from the step; saving lists who the steps and each stage name', () => {
  assert.deepEqual(approvalActionsOf(pre1), { forward: 'Approve', gstVerify: false, sendBack: 'Send Back', reject: 'Reject' });
  assert.deepEqual(approvalActionsOf({ actions: [{ name: 'Reject' }] }), { forward: 'Approve', gstVerify: false, sendBack: null, reject: 'Reject' });
  assert.deepEqual(approvalActionsOf({ actions: [] }), { forward: 'Approve', gstVerify: false, sendBack: null, reject: null });
  // Under the names ticked for them.
  assert.deepEqual(approvalActionsOf({ actions: ['Approve', 'Revise', 'Cancel'] }), { forward: 'Approve', gstVerify: false, sendBack: 'Revise', reject: 'Cancel' });
  // Verify (GST & TDS) alone: the step's check records the figures and passes it on; no plain Approve.
  assert.deepEqual(approvalActionsOf({ actions: ['Verify'] }), { forward: null, gstVerify: true, sendBack: null, reject: null });
  assert.equal(approvalActionsOf({ actions: ['Verify', 'Approve'] }).forward, 'Approve');
  // One list of actions for every step: approval and finance ones side by side; payment is no step's.
  for (const name of ['Approve', 'Send Back', 'Reject', 'Mark as Received', 'Verify', 'Send for Payment', 'Revise', 'Cancel']) {
    assert.ok(STEP_ACTIONS.includes(name), name);
  }
  assert.ok(!STEP_ACTIONS.includes('Mark as Received for Payment'));
  assert.deepEqual(workflowAccessLists(preSteps), {
    members: ['a1', 'a1alt', 'alt', 'amit', 'fin', 'tax', 'v1'],
    stageMembers: { receiving: ['fin'], gst: ['tax'], payment: [] },
  });
});

test('a step is a finance step when its actions claim Receiving or GST & TDS work, an approval step otherwise', () => {
  const desk = { key: 'd', name: 'Desk', actions: ['Approve'], allowHandOver: true };
  // Ticking Mark as Received makes an approval step a finance step; its hand-over stays as it was.
  const approvalStep = withDerivedKind(desk);
  assert.equal(approvalStep.kind, 'verification');
  const finance = withDerivedKind({ ...approvalStep, actions: ['Mark as Received'] });
  assert.equal(finance.kind, undefined);
  assert.equal(finance.allowHandOver, true);
  assert.equal(withDerivedKind({ ...checkA, allowHandOver: undefined, actions: ['Send for Payment'] }).allowHandOver, true, 'was on by default');
  // Already right: the same object back.
  assert.equal(withDerivedKind(approvalStep), approvalStep);
});

test('a workflow saved before one list of actions is read as that list reads it', () => {
  // The workflow as the user saved it: approvals set as stages, the receiving stage fifth.
  const saved = [
    { name: 'Verification', kind: 'verification', actions: ['Send Back'] },
    { name: 'Approval 1', actions: ['Approve'] },
    { name: 'Approval 2', actions: ['Approve', 'Complete'] },
    { name: 'Approval 3', actions: [] },
    { name: 'Recieving at Finance', actions: ['Mark as Received', 'Send for Payment', 'Cancel', 'Revise'] },
  ];
  const upgraded = upgradeWorkflowSteps(saved);
  assert.deepEqual(upgraded.map((s) => [s.kind ?? 'finance', s.actions]), [
    ['verification', ['Approve', 'Send Back']],
    ['verification', ['Approve']],
    ['verification', ['Approve']],
    ['verification', ['Approve']],
    ['finance', ['Mark as Received', 'Send for Payment', 'Cancel', 'Revise']],
  ]);
  assert.equal(upgraded[1].allowHandOver, false, 'a stage had hand-over off unless switched on');
  assert.equal(upgraded[4], saved[4], 'unchanged steps come back as they were');
  assert.deepEqual(stageWorkProblems(upgraded), new Map());
  assert.deepEqual(upgradeWorkflowSteps(upgraded), upgraded, 'upgrading twice changes nothing');

  // The shipped workflow: its payment stage is an approval step now (the payment page follows it).
  const shipped = upgradeWorkflowSteps([
    { name: 'Receiving at Finance', actions: ['Mark as Received', 'Return to Pending', 'Cancel'] },
    { name: 'GST & TDS Verification', actions: ['Verify', 'Re-verify', 'Return to Pending', 'Send for Payment'] },
    { name: 'Processed for Payment', actions: ['Mark as Received for Payment', 'Approve'] },
  ]);
  assert.deepEqual(shipped.map((s) => [s.kind ?? 'finance', s.actions.length]), [['finance', 3], ['finance', 4], ['verification', 1]]);
  assert.deepEqual(shipped[2].actions, ['Approve']);

  // An approval step with Verify (GST & TDS) checks GST & TDS as it passes it on: it stays as it is.
  const check = { name: 'Check', kind: 'verification', actions: ['Verify', 'Reject'] };
  assert.equal(upgradeWorkflowSteps([check, financeDesk])[0], check);

  // Stages that did their work by place keep it, ticked now.
  const legacy = upgradeWorkflowSteps([{ name: 'A', actions: [] }, { name: 'B', actions: ['Return to Pending'] }, { name: 'C' }]);
  assert.deepEqual(legacy.map((s) => [s.kind ?? 'finance', s.actions]), [
    ['finance', ['Mark as Received']],
    ['finance', ['Return to Pending', 'Send for Payment']],
    ['verification', ['Approve']],
  ]);
});

/* ── a stage does the work its buttons claim ── */

const approval = (key, name) => ({ key, name, kind: 'verification', assignmentType: 'User-based', assignedTo: ['ap'], actions: ['Approve'] });
const financeDesk = {
  key: 'fin',
  name: 'Recieving at Finance',
  assignmentType: 'User-based',
  assignedTo: ['fd'],
  actions: ['Mark as Received', 'Verify', 'Send for Payment', 'Cancel', 'Revise'],
};

test('one stage may receive, verify GST & TDS and send for payment; approvals before it hold new requisitions', () => {
  const steps = [approval('v', 'Verification'), approval('a1', 'Approval 1'), approval('a2', 'Approval 2'), approval('a3', 'Approval 3'), financeDesk];
  const placed = placeSteps(steps);
  assert.deepEqual(placed.map((p) => [p.role, p.roles, p.segment]), [
    ['verification', [], 0],
    ['verification', [], 0],
    ['verification', [], 0],
    ['verification', [], 0],
    ['receiving', ['receiving', 'gst'], null],
  ]);
  assert.deepEqual(claimedRoles(financeDesk), ['receiving', 'gst']);
  // Its sections are named for what they do: GST & TDS Verification while it verifies, else Send for Payment.
  assert.equal(stepWorkLabel(financeDesk, 'gst'), 'GST & TDS Verification');
  assert.equal(stepWorkLabel({ actions: ['Mark as Received', 'Send for Payment'] }, 'gst'), 'Send for Payment');
  assert.equal(stepWorkLabel({ actions: ['Mark as Received', 'Send for Payment'] }, 'receiving'), 'Receiving');
  assert.deepEqual(waitingStatusesAt(placed, 4), ['Pending', 'Received', 'Needs Review', 'Verified']);
  assert.deepEqual(holdForCreate(steps, entry({ status: 'Pending' }), NOW), { heldAt: 'v', heldAssignees: ['ap'], heldSince: NOW });
  // Received by the same stage, it is verified there: no step between to hold it.
  assert.deepEqual(holdForMove(steps, entry({ status: 'Pending' }), 'Received', NOW), {});
  assert.deepEqual(workflowAccessLists(steps).stageMembers, { receiving: ['fd'], gst: ['fd'], payment: [] });
  assert.deepEqual(stageWorkProblems(steps), new Map());
});

test('stages that claim no work do none, when another stage claims some; the standard three keep their places', () => {
  // As saved: the approvals left as stages, the finance desk last.
  const saved = [approval('v', 'Verification'), { key: 'a1', name: 'Approval 1', actions: ['Approve'] }, { key: 'a2', name: 'Approval 2', actions: [] }, financeDesk];
  assert.deepEqual(placeSteps(saved).map((p) => [p.role, p.builtinIndex]), [['verification', null], ['other', 3], ['other', 3], ['receiving', 0]]);
  // The shipped workflow, buttons and all: one work each, by its buttons; payment is no step's.
  const shipped = [
    { key: 'r', name: 'Receiving at Finance', actions: ['Mark as Received', 'Return to Pending', 'Cancel'] },
    { key: 'g', name: 'GST & TDS Verification', actions: ['Verify', 'Re-verify', 'Return to Pending', 'Send for Payment'] },
    { key: 'p', name: 'Processed for Payment', actions: ['Mark as Received for Payment', 'Approve'] },
  ];
  assert.deepEqual(placeSteps(shipped).map((p) => [p.role, p.builtinIndex]), [['receiving', 0], ['gst', 1], ['other', 3]]);
});

test('each work belongs to one stage, in order: received, then verified; both done somewhere', () => {
  const twice = [{ key: 'r1', name: 'Desk A', actions: ['Mark as Received'] }, { key: 'r2', name: 'Desk B', actions: ['Mark as Received', 'Send for Payment'] }];
  assert.match(stageWorkProblems(twice).get(1)[0], /"Desk A" already does Receiving/);
  assert.deepEqual(placeSteps(twice).map((p) => p.roles), [['receiving'], ['gst']]);
  const backwards = [{ key: 'g', name: 'Tax desk', actions: ['Send for Payment'] }, { key: 'r', name: 'Receive desk', actions: ['Mark as Received'] }];
  assert.match(stageWorkProblems(backwards).get(0)[0], /does GST & TDS Verification \(Send for Payment is ticked\), which must come after Receiving at "Receive desk"/);
  // Verify (GST & TDS) claims no work: ticked on the step before Finance, it is that approval step's check.
  const verification = withDerivedKind({ key: 'v', name: 'Verification', assignmentType: 'User-based', assignedTo: ['ap'], actions: ['Verify'] });
  assert.equal(verification.kind, 'verification');
  const desk = { ...financeDesk, actions: ['Mark as Received', 'Send for Payment'] };
  assert.deepEqual(stageWorkProblems([verification, desk]), new Map());
  assert.equal(placeSteps([verification, desk])[0].segment, 0, 'it holds new requisitions before Finance');
  // Received but never sent for payment, or sent without being received: said on the step that does the one.
  assert.match(stageWorkProblems([{ key: 'r', name: 'Desk', actions: ['Mark as Received'] }]).get(0)[0], /no step sends them for payment/);
  assert.match(stageWorkProblems([{ key: 'g', name: 'Desk', actions: ['Send for Payment'] }]).get(0)[0], /no step receives them first/);
  // An approval step without Approve could never pass anything on.
  assert.match(stageWorkProblems([{ key: 'v', name: 'Check', kind: 'verification', actions: ['Send Back'] }, financeDesk]).get(0)[0], /no Approve/);
});

test('Finance’s Revise sends an unreceived requisition back to the last step before Finance', () => {
  const steps = [approval('v', 'Verification'), { ...approval('a3', 'Approval 3'), assignedTo: ['last'] }, financeDesk];
  assert.deepEqual(planReviseToApproval(steps, entry({ status: 'Pending' }), NOW), {
    ok: true,
    toName: 'Approval 3',
    update: { heldAt: 'a3', heldAssignees: ['last'], heldSince: NOW },
  });
  assert.equal(planReviseToApproval(steps, entry({ status: 'Received' }), NOW).ok, false, 'received already');
  assert.equal(planReviseToApproval(steps, entry({ status: 'Pending', heldAt: 'a3', heldAssignees: ['last'] }), NOW).ok, false, 'still held');
  assert.equal(planReviseToApproval([financeDesk], entry({ status: 'Pending' }), NOW).ok, false, 'nothing before Finance');
});
