import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from the policy module rather than `e-approval.ts`, which re-exports Firestore-client
// types that only resolve inside the bundler.
import {
  bindEApprovalAssignment,
  buildEApprovalSteps,
  canAssignEApprovalStep,
  canTakeEApprovalOwnership,
  describeEApprovalAssignment,
  describeEApprovalCondition,
  eApprovalConditionSpecificity,
  eApprovalWorkflowBlockingIssues,
  expandEApprovalWorkflow,
  isEApprovalStepAssignee,
  matchesEApprovalCondition,
  resolveEApprovalStepOverride,
} from '../src/lib/e-approval-policy.ts';

/* ── fixtures ────────────────────────────────────────────────────────────────────────────────── */

/** Two sites with two different sets of people — the case the whole feature exists for. */
const ROUTING = [
  {
    projectId: 'p-ranchi',
    projectName: 'Ranchi Metro',
    mode: 'Role',
    headUserId: 'u-ranchi-head',
    headUserName: 'Anita Ranchi',
    memberUserIds: ['u-ranchi-store'],
    roleHolders: [
      { role: 'Project Manager', userId: 'u-ranchi-pm', userName: 'Rahul Kumar', designation: 'PM' },
      { role: 'Site In-Charge', userId: 'u-ranchi-sic', userName: 'Meera Das' },
    ],
  },
  {
    projectId: 'p-kolkata',
    projectName: 'Kolkata Flyover',
    mode: 'Role',
    headUserId: 'u-kol-head',
    headUserName: 'Sourav Ghosh',
    roleHolders: [{ role: 'Project Manager', userId: 'u-kol-pm', userName: 'Priya Sen' }],
  },
  {
    projectId: 'p-bare',
    projectName: 'Bare Site',
    mode: 'Role',
    roleHolders: [],
  },
];

const stage = (id, name, assignments, extra = {}) => ({ id, name, assignments, ...extra });

const pmStage = stage('s-pm', 'Project Manager', [
  { kind: 'Project', projectMode: 'Role', projectRole: 'Project Manager' },
]);

const library = (templates = []) => ({ templates, projectRouting: ROUTING });

const names = (expanded) => expanded.steps.map((step) => step.name);
const whoOn = (expanded, index) => expanded.steps[index].assignments.map((a) => a.userId ?? a.kind);

/* ── the headline case: one workflow, a different person on each project ─────────────────────── */

test('a stage naming a project post resolves to a different person on each project', () => {
  const onRanchi = expandEApprovalWorkflow([pmStage], { projectId: 'p-ranchi' }, library());
  const onKolkata = expandEApprovalWorkflow([pmStage], { projectId: 'p-kolkata' }, library());

  assert.deepEqual(whoOn(onRanchi, 0), ['u-ranchi-pm']);
  assert.deepEqual(whoOn(onKolkata, 0), ['u-kol-pm']);
  assert.equal(
    onRanchi.steps[0].assignments[0].userName,
    'Rahul Kumar',
    'the name is denormalised at build time, so the timeline reads correctly later',
  );
  assert.match(onRanchi.steps[0].assignments[0].resolvedFrom, /Ranchi Metro/);
});

test('an unheld post falls back to the project head, and says so', () => {
  const expanded = expandEApprovalWorkflow(
    [stage('s1', 'Site In-Charge', [{ kind: 'Project', projectMode: 'Role', projectRole: 'Site In-Charge' }])],
    { projectId: 'p-kolkata' },
    library(),
  );
  assert.deepEqual(whoOn(expanded, 0), ['u-kol-head']);
  const warning = expanded.notes.find((note) => note.severity === 'warning');
  assert.match(warning.message, /No “Site In-Charge” is configured/);
});

test('a post with no holder and no head keeps the stage and refuses the submission', () => {
  const expanded = expandEApprovalWorkflow([pmStage], { projectId: 'p-bare' }, library());
  assert.equal(expanded.steps.length, 1, 'the stage is kept — dropping it would silently remove a signature');
  assert.equal(expanded.steps[0].assignments[0].kind, 'Project');
  assert.deepEqual(eApprovalWorkflowBlockingIssues(expanded), ['“Project Manager” has no approver.']);
});

test('a project stage on a request naming no project is a blocking gap, not a silent pass', () => {
  const expanded = expandEApprovalWorkflow([pmStage], {}, library());
  assert.match(
    expanded.notes.find((note) => note.severity === 'warning').message,
    /names none/,
  );
  assert.equal(eApprovalWorkflowBlockingIssues(expanded).length, 1);
});

test("a department stage with no id binds to the request's own department", () => {
  const expanded = expandEApprovalWorkflow(
    [stage('s1', 'HOD', [{ kind: 'Department', departmentMode: 'Head' }])],
    { departmentId: 'd-civil', departmentName: 'Civil' },
    library(),
  );
  assert.equal(expanded.steps[0].assignments[0].departmentId, 'd-civil');
  assert.equal(expanded.steps[0].assignments[0].departmentName, 'Civil');
  assert.equal(describeEApprovalAssignment(expanded.steps[0].assignments[0]), 'Civil (HOD)');
});

test('a department stage that names a department is left alone', () => {
  const fixed = { kind: 'Department', departmentId: 'd-finance', departmentName: 'Finance' };
  const bound = bindEApprovalAssignment(fixed, { departmentId: 'd-civil' }, library());
  assert.equal(bound.assignment.departmentId, 'd-finance', 'the request must not repoint an explicit department');
});

/* ── sub-workflows ───────────────────────────────────────────────────────────────────────────── */

const financeClearance = {
  id: 't-finance',
  name: 'Finance Clearance',
  isSubWorkflow: true,
  steps: [stage('f1', 'Accounts', [{ kind: 'Role', role: 'Accounts' }]), stage('f2', 'Finance', [{ kind: 'Role', role: 'Finance' }])],
};

const callNode = (extra = {}) => ({
  id: 'n1',
  name: 'Finance',
  nodeType: 'SubWorkflow',
  subWorkflowId: 't-finance',
  assignments: [],
  ...extra,
});

test('a sub-workflow node expands into the stages of the workflow it calls', () => {
  const expanded = expandEApprovalWorkflow(
    [stage('s1', 'HOD', [{ kind: 'Role', role: 'HOD' }]), callNode(), stage('s2', 'Director', [{ kind: 'Role', role: 'Director' }])],
    {},
    library([financeClearance]),
  );
  assert.deepEqual(names(expanded), ['HOD', 'Finance › Accounts', 'Finance › Finance', 'Director']);
  assert.deepEqual(expanded.subWorkflowIds, ['t-finance']);
  assert.equal(
    expanded.steps.every((step) => step.nodeType === 'Stage'),
    true,
    'nothing downstream of expansion should ever see a sub-workflow node',
  );
});

test('name prefixing can be turned off', () => {
  const expanded = expandEApprovalWorkflow(
    [callNode({ prefixSubWorkflowNames: false })],
    {},
    library([financeClearance]),
  );
  assert.deepEqual(names(expanded), ['Accounts', 'Finance']);
});

test('the same sub-workflow called twice produces unique step ids', () => {
  const expanded = expandEApprovalWorkflow(
    [callNode({ id: 'n1', name: 'First' }), callNode({ id: 'n2', name: 'Second' })],
    {},
    library([financeClearance]),
  );
  const ids = expanded.steps.map((step) => step.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids would collide when the step records are written');
});

test('a sub-workflow that calls itself is left out rather than expanded forever', () => {
  const recursive = {
    id: 't-loop',
    name: 'Loop',
    steps: [stage('l1', 'One', [{ kind: 'Role', role: 'A' }]), { id: 'l2', name: 'Again', nodeType: 'SubWorkflow', subWorkflowId: 't-loop', assignments: [] }],
  };
  const expanded = expandEApprovalWorkflow(
    [{ id: 'n1', name: 'Start', nodeType: 'SubWorkflow', subWorkflowId: 't-loop', assignments: [] }],
    {},
    library([recursive]),
  );
  assert.deepEqual(names(expanded), ['Start › One']);
  assert.equal(expanded.notes.some((note) => note.kind === 'SubWorkflowCycle'), true);
});

test('nesting deeper than the cap stops, with a note', () => {
  const leaf = { id: 't3', name: 'Three', steps: [stage('x', 'Leaf', [{ kind: 'Role', role: 'A' }])] };
  const mid = { id: 't2', name: 'Two', steps: [{ id: 'm', name: 'To three', nodeType: 'SubWorkflow', subWorkflowId: 't3', assignments: [] }] };
  const top = { id: 't1', name: 'One', steps: [{ id: 't', name: 'To two', nodeType: 'SubWorkflow', subWorkflowId: 't2', assignments: [] }] };
  const expanded = expandEApprovalWorkflow(
    [{ id: 'n', name: 'To one', nodeType: 'SubWorkflow', subWorkflowId: 't1', assignments: [] }],
    {},
    { templates: [top, mid, leaf], maxSubWorkflowDepth: 2 },
  );
  assert.deepEqual(names(expanded), []);
  assert.equal(expanded.notes.some((note) => note.kind === 'SubWorkflowTooDeep'), true);
});

test('a missing or inactive sub-workflow is reported rather than ignored', () => {
  const missing = expandEApprovalWorkflow([callNode()], {}, library([]));
  assert.equal(missing.notes[0].kind, 'SubWorkflowMissing');
  assert.equal(missing.notes[0].severity, 'warning');

  const inactive = expandEApprovalWorkflow([callNode()], {}, library([{ ...financeClearance, active: false }]));
  assert.equal(inactive.notes[0].kind, 'SubWorkflowInactive');
});

test('a sub-workflow node with an unmet condition never expands', () => {
  const expanded = expandEApprovalWorkflow(
    [callNode({ condition: { projectIds: ['p-ranchi'] } })],
    { projectId: 'p-kolkata' },
    library([financeClearance]),
  );
  assert.deepEqual(names(expanded), []);
  assert.deepEqual(expanded.subWorkflowIds, []);
});

/* ── conditions ──────────────────────────────────────────────────────────────────────────────── */

test('an empty condition matches everything', () => {
  assert.equal(matchesEApprovalCondition(undefined, {}), true);
  assert.equal(matchesEApprovalCondition({}, { projectId: 'p-ranchi' }), true);
});

test('a pinned condition fails on a request that names nothing, rather than passing', () => {
  assert.equal(matchesEApprovalCondition({ projectIds: ['p-ranchi'] }, {}), false);
});

test('amount bands are inclusive at both ends', () => {
  const band = { minAmount: 100, maxAmount: 200 };
  assert.equal(matchesEApprovalCondition(band, { amount: 100 }), true);
  assert.equal(matchesEApprovalCondition(band, { amount: 200 }), true);
  assert.equal(matchesEApprovalCondition(band, { amount: 201 }), false);
});

test('a stage whose condition does not match is left out of the chain', () => {
  const steps = [
    stage('s1', 'Always', [{ kind: 'Role', role: 'A' }]),
    stage('s2', 'Big spends only', [{ kind: 'Role', role: 'ED' }], { condition: { minAmount: 500000 } }),
  ];
  assert.deepEqual(names(expandEApprovalWorkflow(steps, { amount: 100000 }, library())), ['Always']);
  assert.deepEqual(names(expandEApprovalWorkflow(steps, { amount: 900000 }, library())), [
    'Always',
    'Big spends only',
  ]);
});

test('a condition reads back as a sentence', () => {
  assert.equal(describeEApprovalCondition(undefined), 'Always');
  assert.equal(describeEApprovalCondition({}), 'Always');
  assert.equal(
    describeEApprovalCondition({ projectIds: ['p-ranchi'], minAmount: 500000 }, { project: () => 'Ranchi Metro' }),
    'Ranchi Metro · ≥ 500000',
  );
});

/* ── stage overrides ─────────────────────────────────────────────────────────────────────────── */

const withOverrides = stage('s1', 'Approver', [{ kind: 'User', userId: 'u-default', userName: 'Default' }], {
  overrides: [
    { id: 'o-dept', departmentIds: ['d-civil'], assignments: [{ kind: 'User', userId: 'u-civil' }] },
    { id: 'o-proj', projectIds: ['p-ranchi'], assignments: [{ kind: 'User', userId: 'u-ranchi-special' }] },
  ],
});

test('the stage keeps its own approvers when nothing overrides it', () => {
  const expanded = expandEApprovalWorkflow([withOverrides], { projectId: 'p-kolkata' }, library());
  assert.deepEqual(whoOn(expanded, 0), ['u-default']);
});

test('an override supplies different approvers for its scope', () => {
  const expanded = expandEApprovalWorkflow([withOverrides], { projectId: 'p-ranchi' }, library());
  assert.deepEqual(whoOn(expanded, 0), ['u-ranchi-special']);
});

test('a project override beats a department one, because that is what stage overrides are for', () => {
  const expanded = expandEApprovalWorkflow(
    [withOverrides],
    { projectId: 'p-ranchi', departmentId: 'd-civil' },
    library(),
  );
  assert.deepEqual(whoOn(expanded, 0), ['u-ranchi-special']);
  assert.ok(
    eApprovalConditionSpecificity({ projectIds: ['x'] }) > eApprovalConditionSpecificity({ departmentIds: ['y'] }),
  );
});

test('explicit priority breaks a tie between equally specific overrides', () => {
  const step = {
    ...stage('s1', 'Approver', [{ kind: 'User', userId: 'u-default' }]),
    overrides: [
      { id: 'a', projectIds: ['p-ranchi'], priority: 0, assignments: [{ kind: 'User', userId: 'u-a' }] },
      { id: 'b', projectIds: ['p-ranchi'], priority: 5, assignments: [{ kind: 'User', userId: 'u-b' }] },
    ],
  };
  assert.equal(resolveEApprovalStepOverride(step, { projectId: 'p-ranchi' }).id, 'b');
});

test('an inactive override never matches', () => {
  const step = {
    ...stage('s1', 'Approver', [{ kind: 'User', userId: 'u-default' }]),
    overrides: [{ id: 'a', projectIds: ['p-ranchi'], active: false, assignments: [{ kind: 'User', userId: 'u-a' }] }],
  };
  assert.equal(resolveEApprovalStepOverride(step, { projectId: 'p-ranchi' }), null);
});

test('an override can drop the stage entirely for its scope', () => {
  const step = {
    ...stage('s1', 'Legal review', [{ kind: 'Role', role: 'Legal' }]),
    overrides: [{ id: 'skip', projectIds: ['p-kolkata'], skip: true, label: 'Internal site' }],
  };
  assert.deepEqual(names(expandEApprovalWorkflow([step], { projectId: 'p-kolkata' }, library())), []);
  assert.deepEqual(names(expandEApprovalWorkflow([step], { projectId: 'p-ranchi' }, library())), ['Legal review']);
});

test('an override can change only the SLA, leaving the approvers alone', () => {
  const step = {
    ...stage('s1', 'Approver', [{ kind: 'User', userId: 'u-default' }], { slaHours: 24 }),
    overrides: [{ id: 'fast', projectIds: ['p-ranchi'], slaHours: 4 }],
  };
  const expanded = expandEApprovalWorkflow([step], { projectId: 'p-ranchi' }, library());
  assert.equal(expanded.steps[0].slaHours, 4);
  assert.deepEqual(whoOn(expanded, 0), ['u-default']);
});

test('an override inside a sub-workflow applies too', () => {
  const shared = {
    id: 't-shared',
    name: 'Shared',
    steps: [
      {
        ...stage('x', 'Verifier', [{ kind: 'User', userId: 'u-default' }]),
        overrides: [{ id: 'o', projectIds: ['p-ranchi'], assignments: [{ kind: 'User', userId: 'u-ranchi-verify' }] }],
      },
    ],
  };
  const expanded = expandEApprovalWorkflow(
    [{ id: 'n', name: 'Check', nodeType: 'SubWorkflow', subWorkflowId: 't-shared', assignments: [] }],
    { projectId: 'p-ranchi' },
    library([shared]),
  );
  assert.deepEqual(whoOn(expanded, 0), ['u-ranchi-verify']);
});

/* ── the expanded chain is an ordinary chain ─────────────────────────────────────────────────── */

test('the routing rules are stripped from the built chain, not carried onto the request', () => {
  const expanded = expandEApprovalWorkflow([withOverrides], { projectId: 'p-ranchi' }, library());
  assert.equal(expanded.steps[0].overrides, undefined);
  assert.equal(expanded.steps[0].condition, undefined);
  assert.equal(expanded.steps[0].subWorkflowId, undefined);
});

test('an expanded chain feeds buildEApprovalSteps unchanged', () => {
  let counter = 0;
  const expanded = expandEApprovalWorkflow(
    [stage('s1', 'HOD', [{ kind: 'Role', role: 'HOD' }]), callNode(), pmStage],
    { projectId: 'p-ranchi' },
    library([financeClearance]),
  );
  const records = buildEApprovalSteps(expanded.steps, { nextId: (seed) => `${seed}#${(counter += 1)}` });
  assert.deepEqual(
    records.map((step) => step.name),
    ['HOD', 'Finance › Accounts', 'Finance › Finance', 'Project Manager'],
  );
  assert.deepEqual(
    records.map((step) => step.sequence),
    [1, 2, 3, 4],
  );
  assert.equal(records[3].assignment.userId, 'u-ranchi-pm');
});

/* ── attribution back to the authoring node ──────────────────────────────────────────────────── */

test('every produced step names the top-level node that authored it', () => {
  const expanded = expandEApprovalWorkflow(
    [stage('s1', 'HOD', [{ kind: 'Role', role: 'HOD' }]), callNode({ id: 'n-fin' }), pmStage],
    { projectId: 'p-ranchi' },
    library([financeClearance]),
  );
  assert.deepEqual(
    expanded.steps.map((step) => step.sourceStepId),
    ['s1', 'n-fin', 'n-fin', 's-pm'],
    'stages pulled in from a sub-workflow belong to the node that called it, not to themselves',
  );
});

test('notes are attributed to the same node, so a warning lands on the right card', () => {
  const expanded = expandEApprovalWorkflow(
    [stage('s1', 'HOD', [{ kind: 'Role', role: 'HOD' }]), stage('s-bad', 'Site In-Charge', [
      { kind: 'Project', projectMode: 'Role', projectRole: 'Site In-Charge' },
    ])],
    { projectId: 'p-kolkata' },
    library(),
  );
  const warning = expanded.notes.find((note) => note.severity === 'warning');
  assert.equal(warning.sourceStepId, 's-bad');
});

test('a skipped stage produces nothing but still explains itself against its node', () => {
  const expanded = expandEApprovalWorkflow(
    [stage('s-ed', 'ED', [{ kind: 'Role', role: 'ED' }], { condition: { minAmount: 500000 } })],
    { amount: 1000 },
    library(),
  );
  assert.equal(expanded.steps.length, 0);
  const note = expanded.notes.find((entry) => entry.kind === 'StageSkippedByCondition');
  assert.equal(note.sourceStepId, 's-ed');
});

test('sourceStepId never reaches a step record', () => {
  const expanded = expandEApprovalWorkflow([pmStage], { projectId: 'p-ranchi' }, library());
  const [record] = buildEApprovalSteps(expanded.steps, { nextId: (seed) => seed });
  assert.equal('sourceStepId' in record, false, 'it is a builder affordance, not part of the workflow record');
});

/* ── acting on a project-addressed step ──────────────────────────────────────────────────────── */

const projectStep = (assignment, extra = {}) => ({
  id: 'st',
  type: 'APPROVAL',
  name: 'Project stage',
  sequence: 1,
  depth: 0,
  parentStepId: null,
  originStepId: null,
  assignment,
  status: 'Active',
  ...extra,
});

test('anyone on the project can act on an “anyone” project step', () => {
  const step = projectStep({ kind: 'Project', projectId: 'p-ranchi', projectMode: 'Anyone' });
  assert.equal(isEApprovalStepAssignee(step, { userId: 'u-a', projectIds: ['p-ranchi'] }), true);
  assert.equal(isEApprovalStepAssignee(step, { userId: 'u-b', projectIds: ['p-other'] }), false);
});

test('a project step routed to the head reaches only the head', () => {
  const step = projectStep({ kind: 'Project', projectId: 'p-ranchi', projectMode: 'Head' });
  assert.equal(isEApprovalStepAssignee(step, { userId: 'u-a', projectIds: ['p-ranchi'] }), false);
  assert.equal(
    isEApprovalStepAssignee(step, { userId: 'u-head', projectIds: ['p-ranchi'], isProjectHead: true }),
    true,
  );
});

test('a claimed project step is the claimant’s alone', () => {
  const step = projectStep(
    { kind: 'Project', projectId: 'p-ranchi', projectMode: 'Anyone' },
    { ownedByUserId: 'u-a' },
  );
  assert.equal(isEApprovalStepAssignee(step, { userId: 'u-a', projectIds: ['p-ranchi'] }), true);
  assert.equal(
    isEApprovalStepAssignee(step, { userId: 'u-b', projectIds: ['p-ranchi'] }),
    false,
    'two people acting on one file means one of the two actions is silently lost',
  );
});

test('a step still addressed to an unresolved post reaches nobody', () => {
  const step = projectStep({ kind: 'Project', projectId: 'p-bare', projectMode: 'Role', projectRole: 'Project Manager' });
  assert.equal(isEApprovalStepAssignee(step, { userId: 'u-a', projectIds: ['p-bare'], isProjectHead: true }), false);
});

test('an unclaimed project queue is the head’s to assign, and members cannot help themselves', () => {
  const queue = projectStep({ kind: 'Project', projectId: 'p-ranchi', projectMode: 'Queue' });
  assert.equal(canTakeEApprovalOwnership(queue, { userId: 'u-a', projectIds: ['p-ranchi'] }), false);
  assert.equal(
    canTakeEApprovalOwnership(queue, { userId: 'u-head', projectIds: ['p-ranchi'], isProjectHead: true }),
    true,
  );
  assert.equal(canAssignEApprovalStep(queue, { userId: 'u-a', projectIds: ['p-ranchi'] }), false);
  assert.equal(
    canAssignEApprovalStep(queue, { userId: 'u-head', projectIds: ['p-ranchi'], isProjectHead: true }),
    true,
  );
});

test('a head-routed project step cannot be claimed by anyone', () => {
  const step = projectStep({ kind: 'Project', projectId: 'p-ranchi', projectMode: 'Head' });
  assert.equal(
    canTakeEApprovalOwnership(step, { userId: 'u-head', projectIds: ['p-ranchi'], isProjectHead: true }),
    false,
    'it is already theirs — there is nothing to claim',
  );
});

/* ── labels ──────────────────────────────────────────────────────────────────────────────────── */

test('project assignments describe themselves readably', () => {
  assert.equal(
    describeEApprovalAssignment({ kind: 'Project', projectMode: 'Role', projectRole: 'Project Manager' }),
    'Project Manager — This project',
  );
  assert.equal(
    describeEApprovalAssignment({ kind: 'Project', projectName: 'Ranchi Metro', projectMode: 'Head' }),
    'Ranchi Metro (Project Head)',
  );
  assert.equal(
    describeEApprovalAssignment({ kind: 'Department', departmentMode: 'Head' }),
    'Own department (HOD)',
  );
});
