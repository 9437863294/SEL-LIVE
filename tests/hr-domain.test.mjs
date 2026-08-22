import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from the policy module rather than `hr-requirement.ts`, which re-exports Firestore-client
// types that only resolve inside the bundler.
import {
  annualManpowerCost,
  averageTimeToHire,
  canReleaseOffer,
  canReviseFeedback,
  candidateFingerprint,
  ctcIncreasePercent,
  deriveRecruitingStatus,
  dueJoiningReminders,
  evaluateCtcAgainstBand,
  evaluateOfferValidity,
  evaluateRequirementClosure,
  evaluateRequirementSla,
  evaluateStageMove,
  financialYearForHrDate,
  findDuplicateCandidates,
  findDuplicateRequirements,
  hrDocumentNumber,
  hrStatusLabel,
  interviewFeedbackScore,
  isOpenRequirementStatus,
  isTerminalRequirementStatus,
  matchTalentPool,
  normalizeMobile,
  requirementAgeingBucket,
  requirementStatusForStage,
  resolveDueEscalations,
  resolveRequirementApprovalChain,
  resolveStageApprovers,
  summarizeDocumentChecklist,
  summarizeHiringFunnel,
  summarizeManpowerPosition,
  summarizePanelFeedback,
  summarizeRecruitmentCost,
  summarizeRequirementAgeing,
  summarizeRequirementFill,
  summarizeSourceEffectiveness,
  timeToHireDays,
} from '../src/lib/hr-policy.ts';

/** Every case pins its own dates rather than depending on today. */
const at = value => new Date(value);

/* ── financial year & numbering ──────────────────────────────────────────────────────────────── */

test('financial year runs April to March', () => {
  assert.equal(financialYearForHrDate(at('2026-04-01T10:00:00')), '2026-27');
  assert.equal(financialYearForHrDate(at('2027-03-31T10:00:00')), '2026-27');
  assert.equal(financialYearForHrDate(at('2026-03-31T10:00:00')), '2025-26');
});

test('requirement numbers match the identifier the spec shows the user', () => {
  assert.equal(
    hrDocumentNumber({ kind: 'requirement', financialYear: '2026-27', sequence: 128 }),
    'HR-REQ-2026-00128',
  );
  assert.equal(hrDocumentNumber({ kind: 'candidate', financialYear: '2026-27', sequence: 7 }), 'HR-CAN-2026-00007');
  assert.equal(hrDocumentNumber({ kind: 'offer', financialYear: '2026-27', sequence: 1 }), 'HR-OFR-2026-00001');
});

test('a sequence past the padding width widens rather than colliding', () => {
  assert.equal(
    hrDocumentNumber({ kind: 'requirement', financialYear: '2026-27', sequence: 123456 }),
    'HR-REQ-2026-123456',
  );
});

test('status labels never print a raw token', () => {
  assert.equal(hrStatusLabel('PENDING_HOD_APPROVAL'), 'Pending HOD approval');
  assert.equal(hrStatusLabel('PARTIALLY_FILLED'), 'Partially filled');
  assert.equal(hrStatusLabel('INTERVIEW_1'), 'Interview round 1');
  assert.equal(hrStatusLabel('PRE_JOINING'), 'Pre-joining');
});

test('terminal and open status sets do not overlap', () => {
  for (const status of ['FILLED', 'CLOSED', 'CANCELLED', 'REJECTED', 'EXPIRED']) {
    assert.equal(isTerminalRequirementStatus(status), true, status);
    assert.equal(isOpenRequirementStatus(status), false, status);
  }
  for (const status of ['OPEN', 'SOURCING', 'INTERVIEWING', 'PARTIALLY_FILLED', 'ON_HOLD']) {
    assert.equal(isOpenRequirementStatus(status), true, status);
    assert.equal(isTerminalRequirementStatus(status), false, status);
  }
});

/* ── requirement fill arithmetic (spec section 37) ───────────────────────────────────────────── */

test('the spec section 37 example: five required, one joined', () => {
  const fill = summarizeRequirementFill({ requestedQuantity: 5, joinedCount: 1 });
  assert.equal(fill.balance, 4);
  assert.equal(fill.fillStatus, 'Partially filled');
  assert.equal(fill.filledPercent, 20);
  assert.equal(fill.recommendClosure, false);
});

test('all five joined recommends closure', () => {
  const fill = summarizeRequirementFill({ requestedQuantity: 5, joinedCount: 5 });
  assert.equal(fill.balance, 0);
  assert.equal(fill.fillStatus, 'Fully filled');
  assert.equal(fill.recommendClosure, true);
});

test('balance counts joinings while uncovered balance also credits accepted offers', () => {
  const fill = summarizeRequirementFill({
    requestedQuantity: 5,
    joinedCount: 1,
    offerAcceptedCount: 2,
    offeredCount: 1,
    inPipelineCount: 6,
  });
  assert.equal(fill.balance, 4, 'management asks how many seats are actually filled');
  assert.equal(fill.uncoveredBalance, 2, 'a recruiter should not chase seats that have accepted offers');
});

test('cancelled positions reduce what has to be filled', () => {
  const fill = summarizeRequirementFill({ requestedQuantity: 5, joinedCount: 3, cancelledPositions: 2 });
  assert.equal(fill.effectiveRequired, 3);
  assert.equal(fill.balance, 0);
  assert.equal(fill.recommendClosure, true);
});

test('over-filling is reported rather than clamped away', () => {
  const fill = summarizeRequirementFill({ requestedQuantity: 2, joinedCount: 3 });
  assert.equal(fill.fillStatus, 'Over filled');
  assert.equal(fill.balance, 0);
});

test('nothing happening yet reads as not started, not as in progress', () => {
  assert.equal(summarizeRequirementFill({ requestedQuantity: 3 }).fillStatus, 'Not started');
  assert.equal(summarizeRequirementFill({ requestedQuantity: 3, inPipelineCount: 2 }).fillStatus, 'In progress');
});

test('recruiting sub-status reports the furthest stage anyone has reached', () => {
  assert.equal(deriveRecruitingStatus({ offered: 1, screening: 6 }), 'OFFER_IN_PROGRESS');
  assert.equal(deriveRecruitingStatus({ selected: 1, screening: 4 }), 'SELECTION_IN_PROGRESS');
  assert.equal(deriveRecruitingStatus({ interviewing: 2 }), 'INTERVIEWING');
  assert.equal(deriveRecruitingStatus({ screening: 3 }), 'SCREENING');
  assert.equal(deriveRecruitingStatus({ sourced: 3 }), 'SOURCING');
  assert.equal(deriveRecruitingStatus({}), 'OPEN');
  assert.equal(deriveRecruitingStatus({ joined: 2, requested: 2 }), 'FILLED');
  assert.equal(deriveRecruitingStatus({ joined: 1, requested: 3 }), 'PARTIALLY_FILLED');
});

/* ── manpower position (spec sections 4 and 61) ──────────────────────────────────────────────── */

test('the spec section 61 project example', () => {
  const position = summarizeManpowerPosition({
    approvedStrength: 48,
    existing: 36,
    underRecruitment: 8,
    offered: 3,
    joiningAwaited: 2,
  });
  assert.equal(position.shortage, 12);
  assert.equal(position.criticalShortage, 4, 'shortage with no recruitment behind it');
  assert.equal(position.fulfilmentPercent, 75);
  assert.equal(position.status, 'Short staffed');
});

test('a shortage fully covered by the pipeline is not a management problem', () => {
  const position = summarizeManpowerPosition({ approvedStrength: 10, existing: 8, underRecruitment: 2 });
  assert.equal(position.criticalShortage, 0);
  assert.equal(position.status, 'Covered by pipeline');
});

test('a quarter of sanctioned strength missing with no pipeline is critical', () => {
  const position = summarizeManpowerPosition({ approvedStrength: 8, existing: 4, underRecruitment: 0 });
  assert.equal(position.criticalShortage, 4);
  assert.equal(position.status, 'Critically short');
});

test('over strength is reported, not folded into fully staffed', () => {
  const position = summarizeManpowerPosition({ approvedStrength: 5, existing: 7 });
  assert.equal(position.vacancy, -2);
  assert.equal(position.shortage, 0);
  assert.equal(position.status, 'Over strength');
});

/* ── duplicate requirement detection (spec section 11) ───────────────────────────────────────── */

const openRequirements = [
  { id: 'r1', departmentId: 'd1', designation: 'Site Engineer', projectId: 'p1', status: 'OPEN' },
  { id: 'r2', departmentId: 'd1', designation: 'Site Engineer', projectId: 'p2', status: 'OPEN' },
  { id: 'r3', departmentId: 'd2', designation: 'Site Engineer', projectId: 'p1', status: 'OPEN' },
  { id: 'r4', departmentId: 'd1', designation: 'Site Engineer', projectId: 'p1', status: 'CLOSED' },
];

test('a duplicate needs the same department, designation and place', () => {
  const matches = findDuplicateRequirements(
    { departmentId: 'd1', designation: 'Site Engineer', projectId: 'p1' },
    openRequirements,
  );
  assert.deepEqual(matches.map(match => match.requirement.id), ['r1']);
  assert.deepEqual(matches[0].matchedOn, ['department', 'designation', 'project']);
});

test('a closed requirement is never offered as a duplicate', () => {
  const matches = findDuplicateRequirements(
    { departmentId: 'd1', designation: 'Site Engineer', projectId: 'p1' },
    openRequirements.filter(row => row.status === 'CLOSED'),
  );
  assert.equal(matches.length, 0);
});

test('designation matching ignores case and spacing', () => {
  const matches = findDuplicateRequirements(
    { departmentId: 'd1', designation: '  site   ENGINEER ', projectId: 'p1' },
    openRequirements,
  );
  assert.equal(matches.length, 1);
});

test('the requirement being edited is not its own duplicate', () => {
  const matches = findDuplicateRequirements(
    { departmentId: 'd1', designation: 'Site Engineer', projectId: 'p1' },
    openRequirements,
    { excludeId: 'r1' },
  );
  assert.equal(matches.length, 0);
});

test('without a department or designation there is nothing to match on', () => {
  assert.equal(findDuplicateRequirements({ designation: 'Site Engineer' }, openRequirements).length, 0);
  assert.equal(findDuplicateRequirements({ departmentId: 'd1' }, openRequirements).length, 0);
});

/* ── duplicate candidate detection (spec section 20) ─────────────────────────────────────────── */

test('a mobile number matches regardless of country code and spacing', () => {
  assert.equal(normalizeMobile('+91 98765 43210'), '9876543210');
  assert.equal(normalizeMobile('098765-43210'), '9876543210');
  assert.equal(candidateFingerprint({ mobile: '+91-9876543210' }), 'm:9876543210');
});

test('the fingerprint falls back through email then PAN', () => {
  assert.equal(candidateFingerprint({ email: ' ABC@Example.com ' }), 'e:abc@example.com');
  assert.equal(candidateFingerprint({ pan: 'abcde1234f' }), 'p:ABCDE1234F');
  assert.equal(candidateFingerprint({ name: 'Only A Name' }), '', 'a name alone cannot identify anyone');
});

test('an exact identifier hit outranks a probable name+DOB one', () => {
  const existing = [
    { id: 'c1', name: 'Ramesh Kumar', dateOfBirth: '1990-01-01', mobile: '9000000001' },
    { id: 'c2', name: 'Anil Sharma', mobile: '9876543210', email: 'anil@example.com' },
  ];
  const matches = findDuplicateCandidates(
    { name: 'Ramesh Kumar', dateOfBirth: '1990-01-01', mobile: '9876543210' },
    existing,
  );
  assert.equal(matches[0].candidate.id, 'c2');
  assert.equal(matches[0].confidence, 'exact');
  assert.equal(matches[1].confidence, 'probable', 'namesakes are flagged, never merged');
});

test('a short or missing mobile does not match everything', () => {
  const existing = [{ id: 'c1', name: 'A', mobile: '' }, { id: 'c2', name: 'B', mobile: '12345' }];
  assert.equal(findDuplicateCandidates({ mobile: '' }, existing).length, 0);
  assert.equal(findDuplicateCandidates({ mobile: '12345' }, existing).length, 0);
});

/* ── CTC band evaluation (spec sections 9 and 28) ────────────────────────────────────────────── */

test('the spec section 9 alert: 14% above the band routes for approval', () => {
  const evaluation = evaluateCtcAgainstBand({ proposedCtc: 1_140_000, bandMin: 800_000, bandMax: 1_000_000 });
  assert.equal(evaluation.withinBand, false);
  assert.equal(evaluation.variancePercent, 14);
  assert.equal(evaluation.requiresApproval, true);
  assert.match(evaluation.message, /exceeds approved salary band by 14%/);
});

test('a breach inside the configured tolerance does not route an approval', () => {
  const evaluation = evaluateCtcAgainstBand({ proposedCtc: 1_030_000, bandMax: 1_000_000, tolerancePercent: 5 });
  assert.equal(evaluation.requiresApproval, false);
  assert.equal(evaluation.severity, 'Within tolerance');
});

test('below the band is flagged for fairness but never blocks', () => {
  const evaluation = evaluateCtcAgainstBand({ proposedCtc: 700_000, bandMin: 800_000, bandMax: 1_000_000 });
  assert.equal(evaluation.severity, 'Below band');
  assert.equal(evaluation.requiresApproval, false);
});

test('a missing band does not route every offer to Finance', () => {
  const evaluation = evaluateCtcAgainstBand({ proposedCtc: 1_000_000 });
  assert.equal(evaluation.withinBand, true);
  assert.equal(evaluation.requiresApproval, false);
});

test('salary increase and annual cost', () => {
  assert.equal(ctcIncreasePercent(500_000, 600_000), 20);
  assert.equal(ctcIncreasePercent(0, 600_000), 0, 'no current CTC means no measurable increase');
  assert.equal(annualManpowerCost({ expectedCtc: 1_000_000, quantity: 3 }), 3_000_000);
});

/* ── approval matrix (spec sections 12 and 13) ───────────────────────────────────────────────── */

const rules = [
  {
    id: 'senior',
    name: 'Senior management',
    when: { seniorManagement: true },
    stages: [{ key: 'HR_HEAD', assignmentType: 'User-based', userIds: ['u-hr'] }, { key: 'MD_ED', assignmentType: 'User-based', userIds: ['u-md'] }],
  },
  {
    id: 'replacement-increase',
    name: 'Replacement with increase',
    when: { requirementTypes: ['Replacement'], salaryIncrease: true },
    stages: [
      { key: 'DEPARTMENT_HOD', assignmentType: 'User-based', userIds: ['u-hod'] },
      { key: 'HR_HEAD', assignmentType: 'User-based', userIds: ['u-hr'] },
      { key: 'FINANCE', assignmentType: 'User-based', userIds: ['u-fin'] },
    ],
  },
  {
    id: 'replacement',
    name: 'Replacement within salary',
    when: { requirementTypes: ['Replacement'] },
    stages: [
      { key: 'DEPARTMENT_HOD', assignmentType: 'User-based', userIds: ['u-hod'] },
      { key: 'HR_HEAD', assignmentType: 'User-based', userIds: ['u-hr'] },
    ],
  },
];

test('the more specific rule wins without hand-ordering the matrix', () => {
  const chain = resolveRequirementApprovalChain(
    { requirementType: 'Replacement', positions: 1, expectedCtc: 600_000, replacedEmployeeCtc: 520_000 },
    rules,
  );
  assert.equal(chain.ruleId, 'replacement-increase');
  assert.equal(chain.stages.length, 3);
  assert.ok(chain.matchedOn.includes('salary increase'));
});

test('a replacement at the same salary takes the shorter route', () => {
  const chain = resolveRequirementApprovalChain(
    { requirementType: 'Replacement', positions: 1, expectedCtc: 500_000, replacedEmployeeCtc: 520_000 },
    rules,
  );
  assert.equal(chain.ruleId, 'replacement');
  assert.equal(chain.stages.length, 2);
});

test('senior management overrides the requirement type', () => {
  const chain = resolveRequirementApprovalChain(
    { requirementType: 'Replacement', positions: 1, seniorManagement: true, expectedCtc: 5_000_000, replacedEmployeeCtc: 4_000_000 },
    rules,
  );
  // Both 'senior' (1 condition) and 'replacement-increase' (2 conditions) match; the more specific
  // one wins, which is the increase rule — senior management alone is a weaker statement than
  // "a replacement, at a higher salary".
  assert.equal(chain.ruleId, 'replacement-increase');
});

test('nothing matching falls back rather than leaving an empty chain', () => {
  const chain = resolveRequirementApprovalChain({ requirementType: 'New Position', positions: 1 }, rules, [
    { key: 'HR_HEAD', assignmentType: 'User-based', userIds: ['u-hr'] },
  ]);
  assert.equal(chain.ruleId, null);
  assert.equal(chain.stages.length, 1);
});

test('an inactive or stageless rule is ignored', () => {
  const chain = resolveRequirementApprovalChain({ requirementType: 'Replacement', positions: 1 }, [
    { id: 'off', name: 'Disabled', active: false, when: { requirementTypes: ['Replacement'] }, stages: [{ key: 'HR_HEAD', assignmentType: 'User-based', userIds: ['x'] }] },
    { id: 'empty', name: 'No stages', when: { requirementTypes: ['Replacement'] }, stages: [] },
  ]);
  assert.equal(chain.ruleId, null);
});

test('minimum thresholds have to be met, not merely stated', () => {
  const thresholdRules = [
    {
      id: 'big',
      name: 'Large intake',
      when: { minPositions: 5 },
      stages: [{ key: 'DIRECTOR', assignmentType: 'User-based', userIds: ['u-dir'] }],
    },
  ];
  assert.equal(resolveRequirementApprovalChain({ requirementType: 'New Position', positions: 6 }, thresholdRules).ruleId, 'big');
  assert.equal(resolveRequirementApprovalChain({ requirementType: 'New Position', positions: 4 }, thresholdRules).ruleId, null);
});

test('stage approvers resolve through each assignment type', () => {
  assert.deepEqual(
    resolveStageApprovers({ key: 'HR_HEAD', assignmentType: 'User-based', userIds: ['a', 'b', 'a'] }, {}),
    ['a', 'b'],
    'duplicates collapse',
  );
  assert.deepEqual(
    resolveStageApprovers({ key: 'HR_HEAD', assignmentType: 'Role-based', roles: ['HR Head'] }, {
      roleByUserId: { u1: 'HR Head', u2: 'Recruiter' },
    }),
    ['u1'],
  );
  assert.deepEqual(
    resolveStageApprovers(
      { key: 'DEPARTMENT_HOD', assignmentType: 'Department-based', assignmentMap: { d1: { primary: 'p', alternative: 'a' } } },
      { departmentId: 'd1' },
    ),
    ['p', 'a'],
    'an alternative can act, so one absence does not stall the chain',
  );
  assert.deepEqual(
    resolveStageApprovers({ key: 'DEPARTMENT_HOD', assignmentType: 'Department-based' }, { departmentHodId: 'hod' }),
    ['hod'],
    'with no map, the department HOD is the approver',
  );
  assert.deepEqual(
    resolveStageApprovers({ key: 'REQUESTING_MANAGER', assignmentType: 'Reporting-based' }, { requestingManagerId: 'mgr' }),
    ['mgr'],
  );
});

test('the pending stage decides the requirement status', () => {
  assert.equal(requirementStatusForStage('DEPARTMENT_HOD'), 'PENDING_HOD_APPROVAL');
  assert.equal(requirementStatusForStage('HR_HEAD'), 'PENDING_HR_APPROVAL');
  assert.equal(requirementStatusForStage('FINANCE'), 'PENDING_BUDGET_APPROVAL');
  assert.equal(requirementStatusForStage('MD_ED'), 'PENDING_MANAGEMENT_APPROVAL');
  assert.equal(requirementStatusForStage(undefined), 'APPROVED');
});

/* ── SLA and escalation (spec sections 40–42) ────────────────────────────────────────────────── */

test('the spec section 40 example: 22 days against a 20-day target', () => {
  const sla = evaluateRequirementSla({
    startedAt: '2026-08-01',
    asOf: '2026-08-23',
    targetDays: 20,
  });
  assert.equal(sla.effectiveAgeDays, 22);
  assert.equal(sla.overdueDays, 2);
  assert.equal(sla.state, 'Overdue');
  assert.match(sla.message, /overdue by 2 days/);
});

test('time on hold is deducted only when the clock is configured to pause', () => {
  const paused = evaluateRequirementSla({ startedAt: '2026-08-01', asOf: '2026-08-23', targetDays: 20, heldDays: 5, pauseOnHold: true });
  assert.equal(paused.effectiveAgeDays, 17);
  assert.equal(paused.state, 'Due soon');

  const running = evaluateRequirementSla({ startedAt: '2026-08-01', asOf: '2026-08-23', targetDays: 20, heldDays: 5, pauseOnHold: false });
  assert.equal(running.effectiveAgeDays, 22);
  assert.equal(running.state, 'Overdue');
});

test('due soon begins where the escalation ladder first widens', () => {
  const sla = evaluateRequirementSla({ startedAt: '2026-08-01', asOf: '2026-08-16', targetDays: 20 });
  assert.equal(sla.consumedPercent, 75);
  assert.equal(sla.state, 'Due soon');
});

test('an unapproved requirement has no SLA running', () => {
  const sla = evaluateRequirementSla({ startedAt: null, targetDays: 20 });
  assert.equal(sla.state, 'Not started');
  assert.equal(sla.consumedPercent, 0);
});

test('escalation returns every newly crossed level and never repeats one', () => {
  const first = resolveDueEscalations(130, undefined, []);
  assert.deepEqual(first.map(level => level.atPercent), [50, 75, 100, 120]);

  const second = resolveDueEscalations(130, undefined, [50, 75, 100, 120]);
  assert.equal(second.length, 0, 'a daily cron must be idempotent');

  const third = resolveDueEscalations(155, undefined, [50, 75, 100, 120]);
  assert.deepEqual(third.map(level => level.atPercent), [150]);
});

test('ageing buckets and their rollup', () => {
  assert.equal(requirementAgeingBucket(0), '0-15');
  assert.equal(requirementAgeingBucket(15), '0-15');
  assert.equal(requirementAgeingBucket(16), '16-30');
  assert.equal(requirementAgeingBucket(61), '>60');

  const summary = summarizeRequirementAgeing([
    { ageDays: 5, balance: 2 },
    { ageDays: 20, balance: 1 },
    { ageDays: 70, balance: 3 },
  ]);
  assert.equal(summary.length, 5);
  assert.deepEqual(summary.find(row => row.bucket === '0-15'), { bucket: '0-15', requirements: 1, positions: 2 });
  assert.deepEqual(summary.find(row => row.bucket === '>60'), { bucket: '>60', requirements: 1, positions: 3 });
});

/* ── pipeline movement (spec section 22) ─────────────────────────────────────────────────────── */

test('a recruiter may move a candidate forward and back within the board', () => {
  assert.equal(evaluateStageMove({ from: 'SCREENING', to: 'SHORTLISTED' }).allowed, true);
  assert.equal(evaluateStageMove({ from: 'INTERVIEW_2', to: 'INTERVIEW_1' }).allowed, true, 'a panel can ask for another look');
  assert.equal(evaluateStageMove({ from: 'NEW', to: 'FINAL_INTERVIEW' }).allowed, true, 'skipping a round is legitimate');
  assert.equal(evaluateStageMove({ from: 'SCREENING', to: 'SCREENING' }).allowed, false);
});

test('an offer cannot be released before compensation approval clears', () => {
  const blocked = evaluateStageMove({ from: 'SELECTED', to: 'OFFERED' });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.requiresGate, 'compensation-approval');

  assert.equal(evaluateStageMove({ from: 'SELECTED', to: 'OFFERED', compensationApproved: true }).allowed, true);
});

test('acceptance and joining are not stages a recruiter can set by hand', () => {
  assert.equal(evaluateStageMove({ from: 'OFFERED', to: 'OFFER_ACCEPTED' }).allowed, false);
  assert.equal(evaluateStageMove({ from: 'OFFERED', to: 'OFFER_ACCEPTED', offerAccepted: true }).allowed, true);
  assert.equal(evaluateStageMove({ from: 'PRE_JOINING', to: 'JOINED' }).allowed, false);
});

test('exits are always available, and only the pauses come back', () => {
  assert.equal(evaluateStageMove({ from: 'INTERVIEW_1', to: 'REJECTED' }).allowed, true);
  assert.equal(evaluateStageMove({ from: 'ON_HOLD', to: 'INTERVIEW_1' }).allowed, true);
  assert.equal(evaluateStageMove({ from: 'TALENT_POOL', to: 'SCREENING' }).allowed, true);

  const rejected = evaluateStageMove({ from: 'REJECTED', to: 'SCREENING' });
  assert.equal(rejected.allowed, false);
  assert.match(rejected.reason, /new application/);
  assert.equal(evaluateStageMove({ from: 'REJECTED', to: 'NO_SHOW' }).allowed, false);
});

/* ── interview evaluation (spec sections 25, 26) ─────────────────────────────────────────────── */

test('a feedback score averages only the criteria that were rated', () => {
  assert.equal(interviewFeedbackScore({ technicalKnowledge: 4, communication: 5 }), 4.5);
  assert.equal(interviewFeedbackScore({}), 0);
  assert.equal(interviewFeedbackScore(undefined), 0);
});

test('a panel aggregates, and a single objection is never averaged away', () => {
  const summary = summarizePanelFeedback(
    [
      { ratings: { technicalKnowledge: 4, communication: 4 }, recommendation: 'Hire' },
      { ratings: { technicalKnowledge: 5, communication: 5 }, recommendation: 'Strong Hire' },
      { ratings: { technicalKnowledge: 2, communication: 3 }, recommendation: 'Not Recommended' },
    ],
    4,
  );
  assert.equal(summary.feedbackCount, 3);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.panelRecommendation, 'Recommended');
  assert.equal(summary.hasDissent, true, 'the objection must reach the selection screen');
  assert.equal(summary.recommendationCounts['Not Recommended'], 1);
});

test('one strong objection outweighs one plain hire', () => {
  const summary = summarizePanelFeedback([
    { recommendation: 'Hire' },
    { recommendation: 'Not Recommended' },
  ]);
  assert.equal(summary.panelRecommendation, 'Not Recommended');
});

test('no feedback yet is awaiting, not a hold', () => {
  assert.equal(summarizePanelFeedback([], 3).panelRecommendation, 'Awaiting feedback');
  assert.equal(summarizePanelFeedback([{ recommendation: 'Hold' }]).panelRecommendation, 'Hold');
});

test('submitted feedback is append-only unless a revision is authorised', () => {
  assert.equal(canReviseFeedback({ submitted: false, isAuthor: true, hasRevisePermission: false }).allowed, true);
  assert.equal(canReviseFeedback({ submitted: true, isAuthor: true, hasRevisePermission: false }).allowed, false);
  assert.equal(canReviseFeedback({ submitted: true, isAuthor: true, hasRevisePermission: true }).allowed, true);
  assert.equal(
    canReviseFeedback({ submitted: true, isAuthor: true, hasRevisePermission: false, allowAuthorRevision: true }).allowed,
    true,
  );
  assert.equal(
    canReviseFeedback({ submitted: true, isAuthor: false, hasRevisePermission: false, allowAuthorRevision: true }).allowed,
    false,
    'someone else never edits an interviewer’s evaluation',
  );
});

/* ── analytics (spec sections 52, 53) ────────────────────────────────────────────────────────── */

test('the funnel counts stages reached, not stages currently occupied', () => {
  const funnel = summarizeHiringFunnel([
    { stage: 'JOINED', stagesReached: ['NEW', 'SCREENING', 'SHORTLISTED', 'INTERVIEW_1', 'SELECTED', 'OFFERED', 'OFFER_ACCEPTED', 'PRE_JOINING', 'JOINED'] },
    { stage: 'OFFER_REJECTED', stagesReached: ['NEW', 'SCREENING', 'SHORTLISTED', 'INTERVIEW_1', 'SELECTED', 'OFFERED'] },
    { stage: 'REJECTED', stagesReached: ['NEW', 'SCREENING'] },
  ]);
  const stage = key => funnel.stages.find(row => row.stage === key).count;
  assert.equal(funnel.total, 3);
  assert.equal(stage('NEW'), 3);
  assert.equal(stage('SCREENING'), 3);
  assert.equal(stage('OFFERED'), 2);
  assert.equal(stage('JOINED'), 1);
  assert.equal(funnel.offerAcceptanceRate, 50);
  assert.equal(funnel.joiningConversionRate, 100);
  assert.equal(funnel.rejectionRate, 33.3);
});

test('an application with no history is still counted from its current stage', () => {
  const funnel = summarizeHiringFunnel([{ stage: 'OFFERED' }]);
  const stage = key => funnel.stages.find(row => row.stage === key).count;
  assert.equal(stage('SCREENING'), 1, 'reaching OFFERED implies passing screening');
  assert.equal(stage('JOINED'), 0);
});

test('source effectiveness ranks by joins and reports cost per join', () => {
  const rows = summarizeSourceEffectiveness(
    [
      { source: 'Naukri', stage: 'JOINED', stagesReached: ['NEW', 'SCREENING', 'SHORTLISTED', 'OFFERED', 'JOINED'] },
      { source: 'Naukri', stage: 'REJECTED', stagesReached: ['NEW', 'SCREENING'] },
      { source: 'Employee Referral', stage: 'SCREENING', stagesReached: ['NEW', 'SCREENING'] },
    ],
    { Naukri: 60_000 },
  );
  assert.equal(rows[0].source, 'Naukri');
  assert.equal(rows[0].applied, 2);
  assert.equal(rows[0].joined, 1);
  assert.equal(rows[0].yieldPercent, 50);
  assert.equal(rows[0].costPerJoin, 60_000);
  assert.equal(rows[1].source, 'Employee Referral');
  assert.equal(rows[1].costPerJoin, 0);
});

test('the spec section 52 cost-per-hire example', () => {
  const summary = summarizeRecruitmentCost(
    [
      { head: 'Agency Fee', amount: 80_000 },
      { head: 'Job Portal', amount: 30_000 },
      { head: 'Interview Expense', amount: 10_000 },
    ],
    4,
  );
  assert.equal(summary.total, 120_000);
  assert.equal(summary.costPerHire, 30_000);
  assert.equal(summary.byHead[0].head, 'Agency Fee');
});

test('cost with nobody joined reports the spend rather than dividing by zero', () => {
  const summary = summarizeRecruitmentCost([{ head: 'Job Portal', amount: 50_000 }], 0);
  assert.equal(summary.costPerHire, 50_000);
});

test('time to hire needs both ends of the measurement', () => {
  assert.equal(timeToHireDays({ approvedAt: '2026-08-01', joinedAt: '2026-09-01' }), 31);
  assert.equal(timeToHireDays({ approvedAt: '2026-08-01' }), null);
  assert.equal(
    averageTimeToHire([
      { approvedAt: '2026-08-01', joinedAt: '2026-08-21' },
      { approvedAt: '2026-08-01', joinedAt: '2026-08-31' },
      { approvedAt: '2026-08-01' },
    ]),
    25,
  );
});

/* ── documents and reminders (spec sections 31–33) ───────────────────────────────────────────── */

test('joining readiness turns on the mandatory documents only', () => {
  const summary = summarizeDocumentChecklist([
    { status: 'VERIFIED', mandatory: true },
    { status: 'WAIVED', mandatory: true },
    { status: 'PENDING', mandatory: false },
  ]);
  assert.equal(summary.mandatoryPending, 0);
  assert.equal(summary.readyForJoining, true);
  assert.equal(summary.completionPercent, 66.7);
});

test('an outstanding mandatory document blocks readiness', () => {
  const summary = summarizeDocumentChecklist([
    { status: 'VERIFIED', mandatory: true },
    { status: 'REUPLOAD_REQUIRED', mandatory: true },
  ]);
  assert.equal(summary.mandatoryPending, 1);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.readyForJoining, false);
});

test('an empty checklist is not silently ready', () => {
  assert.equal(summarizeDocumentChecklist([]).readyForJoining, false);
});

test('the T-7 / T-3 / T-1 reminder ladder fires once each', () => {
  assert.deepEqual(dueJoiningReminders({ joiningDate: '2026-09-01', asOf: '2026-08-25' }), [7]);
  assert.deepEqual(dueJoiningReminders({ joiningDate: '2026-09-01', asOf: '2026-08-29', alreadySent: [7] }), [3]);
  assert.deepEqual(dueJoiningReminders({ joiningDate: '2026-09-01', asOf: '2026-08-29', alreadySent: [7, 3] }), []);
  assert.deepEqual(dueJoiningReminders({ joiningDate: '2026-09-01', asOf: '2026-09-01', alreadySent: [7, 3, 1] }), [0]);
  assert.deepEqual(dueJoiningReminders({ joiningDate: '2026-09-01', asOf: '2026-08-20' }), []);
});

/* ── offers (spec sections 29, 30) ───────────────────────────────────────────────────────────── */

test('offer validity counts down and then expires', () => {
  assert.equal(evaluateOfferValidity({ status: 'SENT', validUntil: '2026-09-01', asOf: '2026-08-28' }).daysRemaining, 4);
  assert.equal(evaluateOfferValidity({ status: 'SENT', validUntil: '2026-08-28', asOf: '2026-08-28' }).expired, false);
  assert.equal(evaluateOfferValidity({ status: 'SENT', validUntil: '2026-08-27', asOf: '2026-08-28' }).expired, true);
  assert.equal(evaluateOfferValidity({ status: 'ACCEPTED', validUntil: '2026-08-01', asOf: '2026-08-28' }).expired, false);
});

test('an offer above the approved compensation cannot be released', () => {
  assert.equal(
    canReleaseOffer({ proposedCtc: 1_100_000, approvedCtc: 1_050_000, compensationApprovalStatus: 'APPROVED' }).allowed,
    false,
  );
  assert.equal(
    canReleaseOffer({ proposedCtc: 1_000_000, approvedCtc: 1_050_000, compensationApprovalStatus: 'APPROVED' }).allowed,
    true,
    'offering less than approved is a negotiation outcome, not a breach',
  );
  assert.equal(canReleaseOffer({ proposedCtc: 1_000_000, compensationApprovalStatus: 'PENDING' }).allowed, false);
  assert.equal(canReleaseOffer({ proposedCtc: 1_000_000, compensationApprovalStatus: 'REJECTED' }).allowed, false);
  assert.equal(canReleaseOffer({ proposedCtc: 0 }).allowed, false);
});

test('without a compensation approval the band still governs', () => {
  assert.equal(canReleaseOffer({ proposedCtc: 1_200_000, bandMax: 1_000_000 }).allowed, false);
  assert.equal(canReleaseOffer({ proposedCtc: 950_000, bandMax: 1_000_000 }).allowed, true);
});

/* ── closure readiness (spec section 38) ─────────────────────────────────────────────────────── */

test('a live offer blocks closure', () => {
  const readiness = evaluateRequirementClosure({
    status: 'PARTIALLY_FILLED',
    requestedQuantity: 5,
    joinedCount: 3,
    liveOfferCount: 1,
  });
  assert.equal(readiness.canClosePartially, false);
  assert.match(readiness.blockers[0], /offer still live/);
  assert.equal(readiness.recommendation, 'Keep open');
});

test('a confirmed joining ahead blocks closure', () => {
  const readiness = evaluateRequirementClosure({
    status: 'PARTIALLY_FILLED',
    requestedQuantity: 5,
    joinedCount: 3,
    upcomingJoiningCount: 2,
  });
  assert.equal(readiness.blockers.length, 1);
  assert.match(readiness.blockers[0], /confirmed to join/);
});

test('candidates in the pipeline only warn', () => {
  const readiness = evaluateRequirementClosure({
    status: 'PARTIALLY_FILLED',
    requestedQuantity: 5,
    joinedCount: 3,
    activeCandidateCount: 4,
  });
  assert.equal(readiness.canClosePartially, true);
  assert.equal(readiness.recommendation, 'Close partially filled');
  assert.match(readiness.warnings[0], /talent pool/);
});

test('a fully filled requirement is offered a full closure', () => {
  const readiness = evaluateRequirementClosure({ status: 'PARTIALLY_FILLED', requestedQuantity: 5, joinedCount: 5 });
  assert.equal(readiness.canCloseFullyFilled, true);
  assert.equal(readiness.recommendation, 'Close fully filled');
});

test('an already-closed requirement cannot be closed again', () => {
  const readiness = evaluateRequirementClosure({ status: 'CLOSED', requestedQuantity: 5, joinedCount: 5 });
  assert.equal(readiness.recommendation, 'Already closed');
  assert.equal(readiness.canCloseFullyFilled, false);
});

/* ── talent pool matching (spec section 48) ──────────────────────────────────────────────────── */

test('talent-pool matching scores rather than filters', () => {
  const matches = matchTalentPool(
    {
      designation: 'Project Manager',
      mandatorySkills: ['Transmission Line', 'Substation'],
      preferredSkills: ['Billing'],
      minExperienceYears: 10,
      maxExperienceYears: 15,
      locationId: 'loc-1',
    },
    [
      { id: 'a', designation: 'Project Manager', skills: ['Transmission Line', 'Substation', 'Billing'], totalExperienceYears: 12, locationId: 'loc-1' },
      { id: 'b', designation: 'Project Manager', skills: ['Transmission Line'], totalExperienceYears: 11, locationId: 'loc-2' },
      { id: 'c', designation: 'Site Engineer', skills: ['Cabling'], totalExperienceYears: 4 },
    ],
    { minimumScore: 30 },
  );
  assert.deepEqual(matches.map(match => match.candidate.id), ['a', 'b']);
  assert.equal(matches[0].score, 100);
  assert.ok(matches[0].reasons.includes('same designation'));
  assert.ok(matches[1].score < matches[0].score, 'a partial skill match ranks lower but still surfaces');
});

test('the match limit and threshold are respected', () => {
  const pool = [
    { id: 'a', designation: 'PM', skills: ['X'] },
    { id: 'b', designation: 'PM', skills: ['X'] },
  ];
  assert.equal(matchTalentPool({ designation: 'PM', mandatorySkills: ['X'] }, pool, { limit: 1 }).length, 1);
  assert.equal(matchTalentPool({ designation: 'PM', mandatorySkills: ['X'] }, pool, { minimumScore: 95 }).length, 0);
});
