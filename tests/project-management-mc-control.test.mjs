import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRODUCTION_STAGES,
  MC_REQUIREMENTS,
  attributeMcDelays,
  checkMcReadiness,
  computeManufacturingProgress,
  currentProductionStage,
  mcBlockingRequirements,
  overdueProductionStages,
  summariseMcBatches,
  validateMcBatches,
  validateProductionStages,
  wholeDaysBetween,
} from '../src/lib/project-management-mc-control.ts';

/* ── Readiness ──────────────────────────────────────────────────────────────────────────────── */

/** Everything satisfied, on a line that needs a drawing and client approval. */
const readyInput = () => ({
  poIssued: true,
  vendorApproved: true,
  specApproved: true,
  drawingRequired: true,
  drawingApproved: true,
  datasheetApproved: true,
  qapApproved: true,
  itpApproved: true,
  typeTestCertificate: true,
  clientApprovalRequired: true,
  clientApproved: true,
  openTechnicalComments: 0,
  commercialHold: false,
});

test('a fully satisfied checklist reads 100% and clears', () => {
  const readiness = checkMcReadiness(readyInput());
  assert.equal(readiness.readinessPct, 100);
  assert.equal(readiness.blockingCount, 0);
  assert.equal(readiness.canIssue, true);
});

test('an empty checklist blocks, and only its negative requirements pass vacuously', () => {
  // Absent is "not recorded", not "fine" — the whole point of the gate. But two requirements are
  // *negative*: "technical comments closed" and "no commercial hold" are satisfied by nothing
  // having gone wrong, and there is no sensible way to affirmatively tick "no hold". So an empty
  // checklist is not 0% — it is those two out of eleven — while still being firmly blocked.
  const readiness = checkMcReadiness({});
  assert.equal(readiness.canIssue, false, 'nothing recorded must never clear');
  assert.ok(readiness.blockingCount > 0);

  const passing = readiness.checks.filter((check) => check.status === 'ok').map((c) => c.key);
  assert.deepEqual(passing.sort(), ['commentsClosed', 'noCommercialHold']);
  assert.equal(readiness.readinessPct, 18, '2 of 11 requirements');
});

test('a missing non-mandatory requirement lowers the percentage but does not block', () => {
  const readiness = checkMcReadiness({ ...readyInput(), typeTestCertificate: false });
  assert.ok(readiness.readinessPct < 100, 'the gap must show');
  assert.equal(readiness.blockingCount, 0, 'a type-test gap must not stop production');
  assert.equal(readiness.canIssue, true);
});

test('a missing mandatory requirement blocks issue and is named', () => {
  const readiness = checkMcReadiness({ ...readyInput(), qapApproved: false });
  assert.equal(readiness.canIssue, false);
  assert.equal(readiness.blockingCount, 1);
  assert.deepEqual(
    mcBlockingRequirements(readiness).map((check) => check.key),
    ['qapApproved'],
  );
});

test('an open technical comment blocks, and is distinguished from work not yet done', () => {
  // Pending is nobody has done it; blocked is a reviewer saying the submission is wrong.
  const readiness = checkMcReadiness({ ...readyInput(), openTechnicalComments: 3 });
  assert.equal(readiness.canIssue, false);
  const comments = readiness.checks.find((check) => check.key === 'commentsClosed');
  assert.equal(comments.status, 'blocked');
  assert.match(comments.detail, /3 comments still open/);
});

test('a commercial hold blocks', () => {
  const readiness = checkMcReadiness({ ...readyInput(), commercialHold: true });
  assert.equal(readiness.canIssue, false);
  assert.equal(
    readiness.checks.find((check) => check.key === 'noCommercialHold').status,
    'blocked',
  );
});

test('inapplicable requirements are excluded from the percentage, not left unsatisfiable', () => {
  // A line with no drawing and no client approval must still be able to reach 100%.
  const readiness = checkMcReadiness({
    ...readyInput(),
    drawingRequired: false,
    drawingApproved: undefined,
    clientApprovalRequired: false,
    clientApproved: undefined,
  });
  assert.equal(readiness.readinessPct, 100);
  assert.equal(readiness.canIssue, true);
  assert.equal(readiness.checks.find((check) => check.key === 'drawingApproved').status, 'na');
  assert.equal(readiness.checks.find((check) => check.key === 'clientApproved').status, 'na');
});

test('every declared requirement appears in the result exactly once', () => {
  const keys = checkMcReadiness({}).checks.map((check) => check.key);
  assert.equal(keys.length, MC_REQUIREMENTS.length);
  assert.equal(new Set(keys).size, keys.length);
});

/* ── Production stages ──────────────────────────────────────────────────────────────────────── */

const stages = (overrides = {}) =>
  DEFAULT_PRODUCTION_STAGES.map((stage) => ({ ...stage, ...(overrides[stage.key] ?? {}) }));

test('the default production stages total 100', () => {
  const total = DEFAULT_PRODUCTION_STAGES.reduce((sum, stage) => sum + stage.weightPct, 0);
  assert.equal(total, 100);
});

test('manufacturing progress is weighted, not a count of stages', () => {
  // Raw material is 15% of the schedule; finishing it alone must not read as 1-of-7 = 14.3%.
  const progress = computeManufacturingProgress(stages({ 'raw-material': { progressPct: 100 } }));
  assert.equal(progress, 15);
});

test('an actual finish date counts a stage fully even without a typed percentage', () => {
  // Requiring both is how a schedule sits at 95% forever.
  const progress = computeManufacturingProgress(
    stages({ 'raw-material': { actualStart: '2026-04-01', actualFinish: '2026-04-20' } }),
  );
  assert.equal(progress, 15);
});

test('progress normalises by the weight present, so a removed stage still reaches 100', () => {
  const withoutGalvanizing = DEFAULT_PRODUCTION_STAGES.filter(
    (stage) => stage.key !== 'galvanizing',
  ).map((stage) => ({ ...stage, progressPct: 100 }));
  assert.equal(computeManufacturingProgress(withoutGalvanizing), 100);
});

test('manufacturing progress is zero-safe and clamps out-of-range input', () => {
  assert.equal(computeManufacturingProgress([]), 0);
  assert.equal(computeManufacturingProgress([{ key: 'x', label: 'X', weightPct: 0 }]), 0);
  assert.equal(
    computeManufacturingProgress([{ key: 'x', label: 'X', weightPct: 10, progressPct: 250 }]),
    100,
  );
  assert.equal(
    computeManufacturingProgress([{ key: 'x', label: 'X', weightPct: 10, progressPct: -5 }]),
    0,
  );
});

test('the current stage is the first unfinished one that has been touched', () => {
  const current = currentProductionStage(
    stages({
      'raw-material': { actualStart: '2026-04-01', actualFinish: '2026-04-20' },
      cutting: { actualStart: '2026-04-21', progressPct: 40 },
    }),
  );
  assert.equal(current.key, 'cutting');
});

test('with nothing started the current stage is the first unfinished one', () => {
  assert.equal(currentProductionStage(stages()).key, 'raw-material');
  assert.equal(currentProductionStage([]), null);
});

test('overdue stages are those past planned finish with no actual finish', () => {
  const overdue = overdueProductionStages(
    stages({
      'raw-material': { plannedFinish: '2026-05-01', actualFinish: '2026-04-28', actualStart: '2026-04-01' },
      cutting: { plannedFinish: '2026-05-10' },
      fabrication: { plannedFinish: '2026-12-01' },
    }),
    new Date('2026-06-01T00:00:00'),
  );
  assert.deepEqual(overdue.map((entry) => entry.stage.key), ['cutting']);
  assert.equal(overdue[0].daysLate, 22);
});

test('stage validation catches bad weights, ranges, reversed dates and finish-without-start', () => {
  const errors = validateProductionStages([
    { key: 'a', label: 'A', weightPct: -1 },
    { key: 'b', label: 'B', weightPct: 10, progressPct: 140 },
    { key: 'c', label: 'C', weightPct: 10, plannedStart: '2026-05-01', plannedFinish: '2026-04-01' },
    { key: 'd', label: 'D', weightPct: 10, actualFinish: '2026-05-01' },
  ]);
  const fields = errors.map((error) => `${error.stageKey}:${error.field}`);
  assert.ok(fields.includes('a:weightPct'));
  assert.ok(fields.includes('b:progressPct'));
  assert.ok(fields.includes('c:plannedFinish'));
  assert.ok(fields.includes('d:actualFinish'));
  assert.deepEqual(validateProductionStages(stages()), []);
});

/* ── Batches ────────────────────────────────────────────────────────────────────────────────── */

test('batches may not clear more than the PO ordered', () => {
  const errors = validateMcBatches(
    [
      { batchNo: 'B1', qty: 300, status: 'Cleared' },
      { batchNo: 'B2', qty: 300, status: 'Cleared' },
    ],
    500,
  );
  assert.ok(errors.some((error) => /more than the 500 ordered/.test(error.message)));
});

test('a cancelled batch releases its quantity back', () => {
  // Otherwise a cancelled tranche would permanently block its own replacement.
  const errors = validateMcBatches(
    [
      { batchNo: 'B1', qty: 300, status: 'Cancelled' },
      { batchNo: 'B2', qty: 300, status: 'Cleared' },
      { batchNo: 'B3', qty: 200, status: 'Cleared' },
    ],
    500,
  );
  assert.deepEqual(errors, []);
});

test('batch numbers must be present, unique and positive', () => {
  const errors = validateMcBatches(
    [
      { batchNo: '', qty: 10, status: 'Planned' },
      { batchNo: 'B1', qty: 10, status: 'Planned' },
      { batchNo: 'b1', qty: 10, status: 'Planned' },
      { batchNo: 'B2', qty: 0, status: 'Planned' },
    ],
    500,
  );
  const messages = errors.map((error) => error.message).join(' | ');
  assert.match(messages, /needs a number/);
  assert.match(messages, /listed more than once/);
  assert.match(messages, /greater than zero/);
});

test('the batch summary reports cleared, uncleared and quantity-weighted progress', () => {
  const summary = summariseMcBatches(
    [
      {
        batchNo: 'B1',
        qty: 150,
        status: 'Completed',
        stages: DEFAULT_PRODUCTION_STAGES.map((stage) => ({ ...stage, progressPct: 100 })),
      },
      { batchNo: 'B2', qty: 350, status: 'In Production', stages: DEFAULT_PRODUCTION_STAGES.map((stage) => ({ ...stage })) },
    ],
    500,
  );
  assert.equal(summary.batchCount, 2);
  assert.equal(summary.clearedQty, 500);
  assert.equal(summary.uncleraedQty, 0);
  assert.equal(summary.fullyCleared, true);
  // 150 of 500 done: quantity-weighted, not 50% from averaging two batches.
  assert.equal(summary.progressPct, 30);
});

test('the batch summary is zero-safe with no batches', () => {
  const summary = summariseMcBatches([], 500);
  assert.equal(summary.clearedQty, 0);
  assert.equal(summary.uncleraedQty, 500);
  assert.equal(summary.progressPct, 0);
  assert.equal(summary.fullyCleared, false);
});

/* ── Delay attribution ──────────────────────────────────────────────────────────────────────── */

test('each leg of delay is attributed to the party that held it', () => {
  const summary = attributeMcDelays({
    drawingSubmission: { dueOn: '2026-04-01', submittedOn: '2026-04-09' },
    drawingApproval: { submittedOn: '2026-04-09', approvedOn: '2026-04-12' },
    clientApproval: { sentOn: '2026-04-12', approvedOn: '2026-04-24' },
    manufacturing: { plannedFinish: '2026-06-01', actualFinish: '2026-06-08' },
    inspection: { requestedOn: '2026-06-08', inspectedOn: '2026-06-10' },
    today: new Date('2026-07-01T00:00:00'),
  });

  const byLeg = Object.fromEntries(summary.lines.map((line) => [line.leg, line]));
  assert.equal(byLeg['Drawing submission'].days, 8);
  assert.equal(byLeg['Drawing submission'].party, 'Vendor');
  assert.equal(byLeg['Drawing approval'].days, 3);
  assert.equal(byLeg['Drawing approval'].party, 'SEL Engineering');
  assert.equal(byLeg['Client approval'].days, 12);
  assert.equal(byLeg['Client approval'].party, 'Client');
  assert.equal(byLeg['Manufacturing'].days, 7);
  assert.equal(byLeg['Inspection'].days, 2);
  assert.equal(byLeg['Inspection'].party, 'SEL QA');

  assert.equal(summary.totalDays, 32);
  // Vendor carries 8 + 7 = 15, more than the client's 12.
  assert.equal(summary.worstParty, 'Vendor');
  assert.equal(summary.byParty[0].days, 15);
});

test('an open leg is measured to today and flagged as still growing', () => {
  const summary = attributeMcDelays({
    clientApproval: { sentOn: '2026-04-01' },
    today: new Date('2026-04-21T00:00:00'),
  });
  assert.equal(summary.lines.length, 1);
  assert.equal(summary.lines[0].days, 20);
  assert.equal(summary.lines[0].ongoing, true);
});

test('a leg with no start contributes nothing rather than being guessed at', () => {
  const summary = attributeMcDelays({
    drawingSubmission: { submittedOn: '2026-04-09' },
    today: new Date('2026-07-01T00:00:00'),
  });
  assert.deepEqual(summary.lines, []);
  assert.equal(summary.totalDays, 0);
  assert.equal(summary.worstParty, null);
});

test('a leg completed early records no delay', () => {
  const summary = attributeMcDelays({
    manufacturing: { plannedFinish: '2026-06-10', actualFinish: '2026-06-01' },
    today: new Date('2026-07-01T00:00:00'),
  });
  assert.deepEqual(summary.lines, []);
});

test('whole days between dates is signed and tolerant of unparsable input', () => {
  assert.equal(wholeDaysBetween('2026-04-01', '2026-04-09'), 8);
  assert.equal(wholeDaysBetween('2026-04-09', '2026-04-01'), -8);
  assert.equal(wholeDaysBetween('', '2026-04-09'), 0);
  assert.equal(wholeDaysBetween('nonsense', '2026-04-09'), 0);
});
