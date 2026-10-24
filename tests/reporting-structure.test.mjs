import test from 'node:test';
import assert from 'node:assert/strict';
// The pure derivation, imported directly — it holds no Firestore or `fetch`, which is the whole
// reason it is a module of its own rather than part of the route.
import {
  buildReportingStructure,
  flattenReportingTree,
  primaryIssue,
  REPORTING_ISSUE_LABELS,
  REPORTING_ISSUE_ORDER,
} from '../src/lib/reporting-structure.ts';

/** A person, with only the fields a test cares about spelled out. */
const person = (employeeId, managerEmployeeId = null, overrides = {}) => ({
  employeeId,
  employeeNo: employeeId,
  name: `Name ${employeeId}`,
  department: 'Ops',
  designation: 'Engineer',
  employmentState: 'Active',
  working: true,
  managerEmployeeId,
  managerName: managerEmployeeId ? `Name ${managerEmployeeId}` : null,
  ...overrides,
});

const nodeOf = (structure, id) => structure.nodes.find((node) => node.employeeId === id);

/* ------------------------------------------------------------------------------------------------
 * The ordinary shape
 * ---------------------------------------------------------------------------------------------- */

test('a plain hierarchy resolves to one root with depths beneath it', () => {
  const structure = buildReportingStructure([
    person('1'),
    person('2', '1'),
    person('3', '2'),
    person('4', '2'),
  ]);

  assert.deepEqual(structure.roots, ['1']);
  assert.equal(nodeOf(structure, '1').depth, 0);
  assert.equal(nodeOf(structure, '2').depth, 1);
  assert.equal(nodeOf(structure, '3').depth, 2);
  assert.equal(structure.counts.maxDepth, 2);
});

test('direct and total reportees are counted separately', () => {
  // The distinction people actually ask about: a manager of two who heads a department of nine.
  const structure = buildReportingStructure([
    person('1'),
    person('2', '1'),
    person('3', '1'),
    person('4', '2'),
    person('5', '4'),
  ]);

  assert.equal(nodeOf(structure, '1').directReportees, 2);
  assert.equal(nodeOf(structure, '1').totalReportees, 4);
  assert.equal(nodeOf(structure, '2').directReportees, 1);
  assert.equal(nodeOf(structure, '2').totalReportees, 2);
  assert.equal(nodeOf(structure, '5').totalReportees, 0);
});

test('the chain runs from the immediate manager to the top', () => {
  const structure = buildReportingStructure([person('1'), person('2', '1'), person('3', '2')]);
  assert.deepEqual(nodeOf(structure, '3').chain, ['2', '1']);
  assert.deepEqual(nodeOf(structure, '1').chain, []);
});

test('several roots are all roots', () => {
  const structure = buildReportingStructure([person('1'), person('2'), person('3', '1')]);
  assert.deepEqual(structure.roots.sort(), ['1', '2']);
  assert.equal(structure.counts.roots, 2);
});

/* ------------------------------------------------------------------------------------------------
 * The ways the data breaks
 * ---------------------------------------------------------------------------------------------- */

test('a manager greytHR names but the mirror does not hold is reported, not silently dropped', () => {
  // Distinct from "no manager": greytHR has an answer, this platform just cannot see that person.
  const structure = buildReportingStructure([person('2', '99')]);
  const node = nodeOf(structure, '2');

  assert.equal(node.resolvedManagerId, null);
  assert.ok(node.issues.includes('manager-missing'));
  assert.ok(!node.issues.includes('no-manager'), 'a named manager is not the same as none');
  // And the name greytHR gave is still carried, so the row can say who it means.
  assert.equal(node.managerName, 'Name 99');
  assert.equal(structure.counts.missingManagers, 1);
});

test('somebody recorded as their own manager is a missing edge, not a one-person loop', () => {
  const structure = buildReportingStructure([person('1', '1')]);
  const node = nodeOf(structure, '1');

  assert.ok(node.issues.includes('self-manager'));
  assert.equal(node.resolvedManagerId, null);
  assert.equal(node.depth, 0, 'it still has a top to count from');
  assert.deepEqual(structure.cycles, [], 'and it is not reported as a cycle');
});

test('a manager who has left still resolves, but is flagged', () => {
  // The edge is real and the chain is worth drawing; the point is that an approval routed up it
  // reaches somebody who no longer works here.
  const structure = buildReportingStructure([
    person('1', null, { employmentState: 'Relieved', working: false }),
    person('2', '1'),
  ]);
  const node = nodeOf(structure, '2');

  assert.equal(node.resolvedManagerId, '1');
  assert.ok(node.issues.includes('manager-departed'));
  assert.equal(node.depth, 1, 'the chain is intact');
  assert.equal(structure.counts.departedManagers, 1);
});

test('notice period is still working, so it is not a departed manager', () => {
  const structure = buildReportingStructure([
    person('1', null, { employmentState: 'Notice Period', working: true }),
    person('2', '1'),
  ]);
  assert.deepEqual(nodeOf(structure, '2').issues, []);
});

/* ------------------------------------------------------------------------------------------------
 * Cycles
 * ---------------------------------------------------------------------------------------------- */

test('two people managing each other are reported as a cycle and terminate', () => {
  // greytHR permits this, and a recursive walk over it would never return.
  const structure = buildReportingStructure([person('1', '2'), person('2', '1')]);

  assert.equal(structure.cycles.length, 1);
  assert.deepEqual([...structure.cycles[0]].sort(), ['1', '2']);
  assert.equal(structure.counts.inCycles, 2);
  for (const id of ['1', '2']) {
    assert.ok(nodeOf(structure, id).issues.includes('cycle'));
    assert.equal(nodeOf(structure, id).depth, null, 'a cycle has no top to measure from');
    assert.ok(!structure.roots.includes(id), 'and it is not a root');
  }
});

test('a longer cycle is found once, not once per member', () => {
  const structure = buildReportingStructure([person('1', '2'), person('2', '3'), person('3', '1')]);
  assert.equal(structure.cycles.length, 1);
  assert.equal(structure.cycles[0].length, 3);
});

test('a chain hanging off a cycle terminates and has no depth', () => {
  const structure = buildReportingStructure([
    person('1', '2'),
    person('2', '1'),
    person('3', '1'),
    person('4', '3'),
  ]);

  assert.equal(nodeOf(structure, '3').depth, null);
  assert.equal(nodeOf(structure, '4').depth, null);
  // The chain still stops rather than walking the loop for ever.
  assert.ok(nodeOf(structure, '4').chain.length <= 4);
});

test('two separate cycles are both found', () => {
  const structure = buildReportingStructure([
    person('1', '2'),
    person('2', '1'),
    person('3', '4'),
    person('4', '3'),
  ]);
  assert.equal(structure.cycles.length, 2);
  assert.equal(structure.counts.inCycles, 4);
});

test('a cycle does not stop the healthy part of the organisation resolving', () => {
  const structure = buildReportingStructure([
    person('1'),
    person('2', '1'),
    person('8', '9'),
    person('9', '8'),
  ]);
  assert.equal(nodeOf(structure, '2').depth, 1);
  assert.deepEqual(structure.roots, ['1']);
  assert.equal(structure.counts.inCycles, 2);
});

/* ------------------------------------------------------------------------------------------------
 * Presentation helpers
 * ---------------------------------------------------------------------------------------------- */

test('the worst issue is the one a row is labelled with', () => {
  const structure = buildReportingStructure([person('1', '1')]);
  // Self-manager also produces no resolved manager; the label must be the specific one.
  assert.equal(primaryIssue(nodeOf(structure, '1')), 'self-manager');
});

test('every issue has a label and a place in the order', () => {
  // The guard against adding a sixth issue and having it render as a blank badge.
  for (const issue of REPORTING_ISSUE_ORDER) {
    assert.ok(REPORTING_ISSUE_LABELS[issue], `no label for ${issue}`);
  }
  assert.equal(REPORTING_ISSUE_ORDER.length, Object.keys(REPORTING_ISSUE_LABELS).length);
});

test('a healthy row has no issue at all', () => {
  const structure = buildReportingStructure([person('1'), person('2', '1')]);
  assert.equal(primaryIssue(nodeOf(structure, '2')), null);
  assert.equal(primaryIssue(nodeOf(structure, '1')), 'no-manager', 'the top is still reported as such');
});

/* ------------------------------------------------------------------------------------------------
 * The tree view
 * ---------------------------------------------------------------------------------------------- */

test('a collapsed tree shows only the roots', () => {
  const structure = buildReportingStructure([person('1'), person('2', '1'), person('3', '2')]);
  const rows = flattenReportingTree(structure, new Set());
  assert.deepEqual(rows.map((row) => row.node.employeeId), ['1']);
  assert.equal(rows[0].hasChildren, true);
});

test('expanding walks only the expanded branches, and indents them', () => {
  const structure = buildReportingStructure([
    person('1'),
    person('2', '1'),
    person('3', '2'),
    person('4', '1'),
  ]);
  const rows = flattenReportingTree(structure, new Set(['1']));
  assert.deepEqual(rows.map((row) => row.node.employeeId), ['1', '2', '4']);
  assert.deepEqual(rows.map((row) => row.indent), [0, 1, 1]);
});

test('nobody disappears because they are in a cycle', () => {
  // The failure this guards: a tree drawn only from the roots silently omits exactly the people
  // whose data is broken.
  const structure = buildReportingStructure([person('1'), person('8', '9'), person('9', '8')]);
  const shown = flattenReportingTree(structure, new Set(['1'])).map((row) => row.node.employeeId);
  assert.deepEqual(shown.sort(), ['1', '8', '9']);
});

test('an empty organisation produces an empty structure rather than throwing', () => {
  const structure = buildReportingStructure([]);
  assert.deepEqual(structure.nodes, []);
  assert.deepEqual(structure.roots, []);
  assert.equal(structure.counts.total, 0);
  assert.equal(structure.counts.maxDepth, 0);
  assert.deepEqual(flattenReportingTree(structure, new Set()), []);
});

test('a blank manager id reads as no manager, not as a missing one', () => {
  // greytHR returns '' rather than null for an unset field often enough to matter.
  const structure = buildReportingStructure([person('1', '   ')]);
  assert.ok(nodeOf(structure, '1').issues.includes('no-manager'));
  assert.ok(!nodeOf(structure, '1').issues.includes('manager-missing'));
});

test('a thousand-deep chain does not blow the stack', () => {
  // Iterative on purpose: a real tenant is wide rather than deep, but nothing in the data stops a
  // chain being long, and a recursive walk would fail here rather than in a test.
  const people = [person('0')];
  for (let i = 1; i < 1000; i += 1) people.push(person(String(i), String(i - 1)));
  const structure = buildReportingStructure(people);
  assert.equal(nodeOf(structure, '999').depth, 999);
  assert.equal(nodeOf(structure, '0').totalReportees, 999);
});
