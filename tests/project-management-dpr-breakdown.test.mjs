import assert from 'node:assert/strict';
import test from 'node:test';

const {
  DPR_MAX_BREAKDOWN_DEPTH,
  arrangeByBreakdown,
  buildDprBreakdown,
  checkDprSubItem,
  checkDprSubItemDelete,
  effectiveWeights,
  hasDprRecords,
  nextSubItemSlNo,
} = await import('../src/lib/project-management-dpr-breakdown.ts');

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const round = (value, places = 6) => Math.round(value * 10 ** places) / 10 ** places;

const lines = [
  { id: 'L1', scope: 'Civil', boqSlNo: '7', erpSlNo: '70', description: 'Earthing system', unit: 'LOT', boqQty: 1, rate: 100000 },
  { id: 'L2', scope: 'Civil', boqSlNo: '8', erpSlNo: '80', description: 'Excavation', unit: 'Cum', boqQty: 1000, rate: 50 },
  { id: 'L3', scope: 'Erection', boqSlNo: '9', description: 'Tower erection', unit: 'MT', boqQty: 500, rate: 0 },
];

const sub = (over) => ({ weightPct: null, order: 1, ...over });

const subs = [
  sub({ id: 's1', boqItemId: 'L1', parentId: 'L1', slNo: '7.1', description: 'Earth pits', unit: 'Nos', qty: 20, weightPct: 50, order: 1 }),
  sub({ id: 's2', boqItemId: 'L1', parentId: 'L1', slNo: '7.2', description: 'GI strip', unit: 'Rmt', qty: 500, order: 2 }),
  sub({ id: 's3', boqItemId: 'L1', parentId: 'L1', slNo: '7.3', description: 'Testing', unit: 'LOT', qty: 1, order: 3 }),
  sub({ id: 's21', boqItemId: 'L1', parentId: 's2', slNo: '7.2.1', description: 'Laying', unit: 'Rmt', qty: 300, order: 1 }),
  sub({ id: 's22', boqItemId: 'L1', parentId: 's2', slNo: '7.2.2', description: 'Welding', unit: 'Rmt', qty: 200, order: 2 }),
  sub({ id: 'x1', boqItemId: 'L2', parentId: 'L2', slNo: '8.1', description: 'Zone A', unit: 'Cum', qty: 400, order: 1 }),
  sub({ id: 'x2', boqItemId: 'L2', parentId: 'L2', slNo: '8.2', description: 'Zone B', unit: 'Cum', qty: 600, order: 2 }),
];

const tree = () => buildDprBreakdown(lines, subs);
const settings = { wholeNumberUnits: ['Nos', 'Set'] };

/* ── effectiveWeights ───────────────────────────────────────────────────────────────────────── */

test('blank shares in the parent unit split by quantity, so the parts simply add up', () => {
  const weights = effectiveWeights({ unit: 'Cum' }, [
    { id: 'a', unit: 'Cum', qty: 400, weightPct: null },
    { id: 'b', unit: 'cum.', qty: 600, weightPct: null },
  ]);
  assert.equal(round(weights.get('a')), 0.4);
  assert.equal(round(weights.get('b')), 0.6);
});

test('blank shares in mixed units split equally', () => {
  const weights = effectiveWeights({ unit: 'LOT' }, [
    { id: 'a', unit: 'Nos', qty: 20, weightPct: null },
    { id: 'b', unit: 'Rmt', qty: 500, weightPct: null },
    { id: 'c', unit: 'LOT', qty: 1, weightPct: null },
    { id: 'd', unit: 'Set', qty: 3, weightPct: null },
  ]);
  for (const id of ['a', 'b', 'c', 'd']) assert.equal(round(weights.get(id)), 0.25);
});

test('set shares are used as given and the blank ones split the remainder', () => {
  const weights = effectiveWeights({ unit: 'LOT' }, [
    { id: 'a', unit: 'Nos', qty: 20, weightPct: 50 },
    { id: 'b', unit: 'Rmt', qty: 500, weightPct: null },
    { id: 'c', unit: 'LOT', qty: 1, weightPct: null },
  ]);
  assert.equal(round(weights.get('a')), 0.5);
  assert.equal(round(weights.get('b')), 0.25);
  assert.equal(round(weights.get('c')), 0.25);
});

test('a set share above 100 is capped at the whole of the parent, leaving nothing for the rest', () => {
  const weights = effectiveWeights({ unit: 'LOT' }, [
    { id: 'a', unit: 'Nos', qty: 1, weightPct: 150 },
    { id: 'b', unit: 'Rmt', qty: 1, weightPct: null },
  ]);
  assert.equal(weights.get('a'), 1);
  assert.equal(weights.get('b'), 0);
  assert.equal(effectiveWeights({ unit: 'LOT' }, []).size, 0);
});

/* ── buildDprBreakdown ──────────────────────────────────────────────────────────────────────── */

test('the tree is ordered depth first, with depth, leaves and groups', () => {
  const breakdown = tree();
  assert.deepEqual(
    breakdown.ordered.map((node) => `${node.depth}:${node.slNo}`),
    ['0:7', '1:7.1', '1:7.2', '2:7.2.1', '2:7.2.2', '1:7.3', '0:8', '1:8.1', '1:8.2', '0:9'],
  );
  assert.deepEqual(
    breakdown.leaves.map((node) => node.slNo),
    ['7.1', '7.2.1', '7.2.2', '7.3', '8.1', '8.2', '9'],
  );
  assert.deepEqual([...breakdown.groupLineIds].sort(), ['L1', 'L2']);
  assert.equal(breakdown.nodes.get('s2').isLeaf, false);
  assert.equal(breakdown.nodes.get('L3').isLeaf, true, 'a line with no sub-items is its own leaf');
  assert.equal(breakdown.nodes.get('s21').boqItemId, 'L1');
  assert.equal(breakdown.nodes.get('s21').scope, 'Civil', 'scope is inherited from the BOQ line');
  assert.equal(breakdown.nodes.get('s21').erpSlNo, '70');
  assert.deepEqual(
    breakdown.nodes.get('s21').ancestors.map((ancestor) => ancestor.slNo),
    ['7', '7.2'],
  );
});

test('siblings sort by their order, then by SL No', () => {
  const breakdown = buildDprBreakdown(lines, [
    sub({ id: 'c', boqItemId: 'L2', parentId: 'L2', slNo: '8.10', description: 'c', unit: 'Cum', qty: 1, order: 1 }),
    sub({ id: 'a', boqItemId: 'L2', parentId: 'L2', slNo: '8.2', description: 'a', unit: 'Cum', qty: 1, order: 1 }),
    sub({ id: 'b', boqItemId: 'L2', parentId: 'L2', slNo: '8.1', description: 'b', unit: 'Cum', qty: 1, order: 2 }),
  ]);
  assert.deepEqual(breakdown.childrenOf('L2').map((node) => node.slNo), ['8.2', '8.10', '8.1']);
});

test('share of the line is the product of the weights on the way down', () => {
  const breakdown = tree();
  assert.equal(round(breakdown.nodes.get('s1').shareOfLine), 0.5);
  assert.equal(round(breakdown.nodes.get('s2').shareOfLine), 0.25);
  assert.equal(round(breakdown.nodes.get('s21').shareOfLine), 0.15, '0.25 × (300 of 500)');
  assert.equal(round(breakdown.nodes.get('s22').shareOfLine), 0.1);
  assert.equal(breakdown.nodes.get('L1').shareOfLine, 1);
  assert.equal(breakdown.nodes.get('L1').weight, 1);
});

test('rates carry down, so the leaves are together worth exactly their BOQ line', () => {
  const breakdown = tree();
  for (const line of lines) {
    const value = breakdown
      .leavesUnder(line.id)
      .reduce((sum, leaf) => sum + leaf.qty * leaf.rate, 0);
    assert.equal(round(value, 4), line.boqQty * line.rate, `${line.boqSlNo} keeps its value`);
  }
  assert.equal(round(breakdown.nodes.get('s1').rate), 2500, '50% of 1,00,000 over 20 Nos');
});

test('orphans, loops, over-depth chains and cross-line parents are ignored', () => {
  const chain = [];
  let parent = 'L2';
  for (let level = 1; level <= DPR_MAX_BREAKDOWN_DEPTH + 1; level += 1) {
    chain.push(sub({ id: `d${level}`, boqItemId: 'L2', parentId: parent, slNo: `8.${level}`, description: 'deep', unit: 'Cum', qty: 1 }));
    parent = `d${level}`;
  }
  const breakdown = buildDprBreakdown(lines, [
    ...chain,
    sub({ id: 'orphan', boqItemId: 'L1', parentId: 'gone', slNo: '7.9', description: 'x', unit: 'Nos', qty: 1 }),
    sub({ id: 'loopA', boqItemId: 'L1', parentId: 'loopB', slNo: '7.8', description: 'x', unit: 'Nos', qty: 1 }),
    sub({ id: 'loopB', boqItemId: 'L1', parentId: 'loopA', slNo: '7.7', description: 'x', unit: 'Nos', qty: 1 }),
    // Hangs from L2 but claims to belong to L1's breakdown.
    sub({ id: 'cross', boqItemId: 'L1', parentId: 'L2', slNo: '7.6', description: 'x', unit: 'Nos', qty: 1 }),
    // Hangs from a sub-item of L2 but claims L1.
    sub({ id: 'crossDeep', boqItemId: 'L1', parentId: 'd1', slNo: '7.5', description: 'x', unit: 'Nos', qty: 1 }),
  ]);
  for (const id of ['orphan', 'loopA', 'loopB', 'cross', 'crossDeep']) {
    assert.equal(breakdown.nodes.has(id), false, `${id} is ignored`);
  }
  assert.equal(breakdown.nodes.has(`d${DPR_MAX_BREAKDOWN_DEPTH}`), true, 'the deepest allowed level stays');
  assert.equal(breakdown.nodes.has(`d${DPR_MAX_BREAKDOWN_DEPTH + 1}`), false, 'one level too deep is dropped');
  assert.equal(breakdown.nodes.get(`d${DPR_MAX_BREAKDOWN_DEPTH}`).isLeaf, true);
  assert.equal(breakdown.nodes.get('L1').isLeaf, true, 'L1 has no valid sub-items, so it is a leaf');
});

/* ── rollUp ─────────────────────────────────────────────────────────────────────────────────── */

test('a 1 LOT line whose sub-items are 40% done reads 0.4 LOT', () => {
  const breakdown = tree();
  const done = { s1: 10, s21: 300, s22: 0, s3: 0 };
  const rolled = breakdown.rollUp((id) => done[id] ?? 0);
  // 0.5 × (10/20) + 0.25 × (0.6 × 300/300 + 0.4 × 0) + 0.25 × 0 = 0.25 + 0.15 = 0.4
  assert.equal(rolled.get('L1'), 0.4);
  assert.equal(rolled.get('s2'), 300, 'the middle level reads in its own unit (Rmt)');
  assert.equal(rolled.get('s1'), 10, 'a leaf keeps its own figure');
});

test('a same-unit split simply adds up', () => {
  const breakdown = tree();
  const rolled = breakdown.rollUp((id) => ({ x1: 200, x2: 300 })[id] ?? 0);
  assert.equal(rolled.get('L2'), 500);
  assert.equal(rolled.get('L3'), 0, 'a leaf line with nothing reads zero');
});

test('rollUp reaches every level, and a leaf line reads its own figure', () => {
  const breakdown = tree();
  const rolled = breakdown.rollUp((id) => ({ s21: 150, s22: 200, L3: 42 })[id] ?? 0);
  // s2: 0.6 × 0.5 + 0.4 × 1 = 0.7 of 500 Rmt = 350
  assert.equal(rolled.get('s2'), 350);
  // L1: 0.25 × 0.7 = 0.175 LOT
  assert.equal(rolled.get('L1'), 0.175);
  assert.equal(rolled.get('L3'), 42);
});

/* ── Navigation ─────────────────────────────────────────────────────────────────────────────── */

test('leavesUnder and descendantIds walk the whole branch', () => {
  const breakdown = tree();
  assert.deepEqual(breakdown.leavesUnder('L1').map((node) => node.id), ['s1', 's21', 's22', 's3']);
  assert.deepEqual(breakdown.leavesUnder('s1').map((node) => node.id), ['s1'], 'a leaf is its own');
  assert.deepEqual(breakdown.leavesUnder('missing'), []);
  assert.deepEqual(breakdown.descendantIds('L1'), ['s1', 's2', 's21', 's22', 's3']);
  assert.deepEqual(breakdown.descendantIds('s2'), ['s21', 's22']);
  assert.deepEqual(breakdown.descendantIds('s1'), []);
});

/* ── Records and SL numbers ─────────────────────────────────────────────────────────────────── */

test('hasDprRecords sees projections and any sheet line, drafts included', () => {
  assert.equal(hasDprRecords('s1', [{ boqItemId: 's1' }], []), true);
  assert.equal(
    hasDprRecords('s1', [], [{ id: 'e', status: 'Draft', lines: [{ boqItemId: 's1' }] }]),
    true,
  );
  assert.equal(hasDprRecords('s1', [{ boqItemId: 's2' }], [{ id: 'e', lines: [] }, { id: 'f' }]), false);
});

test('nextSubItemSlNo continues after the highest sibling number', () => {
  assert.equal(nextSubItemSlNo('7', []), '7.1');
  assert.equal(nextSubItemSlNo('7', [{ slNo: '7.1' }, { slNo: '7.3' }, { slNo: '7.2' }]), '7.4');
  assert.equal(nextSubItemSlNo('7.2', [{ slNo: '7.2.9' }, { slNo: '7.2.10' }]), '7.2.11');
  assert.equal(nextSubItemSlNo('7', [{ slNo: 'A' }, { slNo: '7.x' }]), '7.1', 'non-numbers are skipped');
  assert.equal(nextSubItemSlNo('', []), '1.1');
});

/* ── checkDprSubItem ────────────────────────────────────────────────────────────────────────── */

const draft = (over) => ({
  parentId: 'L3',
  slNo: '9.1',
  description: 'Stub setting',
  unit: 'MT',
  qty: 50,
  weightPct: null,
  ...over,
});

const check = (over, extra = {}) =>
  checkDprSubItem({ draft: draft(over), breakdown: tree(), targets: [], entries: [], settings, ...extra });

test('a complete sub-item under a clean line passes', () => {
  assert.deepEqual(check({}), { errors: [], warnings: [] });
});

test('missing fields and an unknown parent are refused', () => {
  assert.deepEqual(check({ parentId: 'nope' }).errors, ['Choose the line this sub-item belongs under.']);
  const { errors } = check({ slNo: ' ', description: '', unit: '', qty: 0 });
  assert.equal(errors.some((message) => message.includes('SL No')), true);
  assert.equal(errors.some((message) => message.includes('Describe')), true);
  assert.equal(errors.some((message) => message.includes('unit')), true);
  assert.equal(errors.some((message) => message.includes('greater than zero')), true);
});

test('an SL No may repeat across BOQ lines but not within one', () => {
  assert.equal(
    check({ parentId: 'L1', slNo: '7.2.1', unit: 'Nos', qty: 1, weightPct: null }).errors.some((m) =>
      m.includes('already used'),
    ),
    true,
  );
  // 7.1 exists under L1, not under L3.
  assert.deepEqual(check({ slNo: '7.1' }).errors, []);
  // Editing a sub-item may keep its own SL No.
  const edit = checkDprSubItem({
    draft: { parentId: 'L1', slNo: '7.1', description: 'Earth pits', unit: 'Nos', qty: 20, weightPct: 50 },
    editingId: 's1',
    breakdown: tree(),
    targets: [],
    entries: [],
    settings,
  });
  assert.deepEqual(edit.errors, []);
});

test('the quantity must fit the unit precision', () => {
  assert.equal(check({ unit: 'Nos', qty: 2.5 }).errors.includes('Nos is counted in whole numbers.'), true);
  assert.deepEqual(check({ unit: 'Cum', qty: 2.125 }).errors, []);
  assert.equal(check({ unit: 'Cum', qty: 2.1255 }).errors.some((m) => m.includes('decimals')), true);
});

test('shares must be above 0, at most 100, and total at most 100 under one parent', () => {
  assert.equal(check({ weightPct: 0 }).errors.some((m) => m.includes('above 0')), true);
  assert.equal(check({ weightPct: 101 }).errors.some((m) => m.includes('above 0')), true);
  // s1 already holds 50% under L1.
  const over = check({ parentId: 'L1', slNo: '7.4', unit: 'Nos', qty: 1, weightPct: 60 });
  assert.equal(over.errors.some((m) => m.includes('110%')), true);
  assert.deepEqual(check({ parentId: 'L1', slNo: '7.4', unit: 'Nos', qty: 1, weightPct: 50 }).errors, []);
});

test('a parent with projections or progress of its own cannot take sub-items', () => {
  const blocked = check({}, { targets: [{ boqItemId: 'L3' }] });
  assert.equal(blocked.errors.some((m) => m.includes('already has projections')), true);
  const draftLine = check({}, { entries: [{ id: 'e', status: 'Draft', lines: [{ boqItemId: 'L3' }] }] });
  assert.equal(draftLine.errors.some((m) => m.includes('already has projections')), true);
  // A group already has children, so its own records cannot exist; adding another child is fine.
  assert.deepEqual(check({ parentId: 'L2', slNo: '8.3', unit: 'Cum', qty: 1 }).errors, []);
});

test('sub-items stop at the depth limit', () => {
  const chain = [];
  let parent = 'L3';
  for (let level = 1; level <= DPR_MAX_BREAKDOWN_DEPTH; level += 1) {
    chain.push(sub({ id: `z${level}`, boqItemId: 'L3', parentId: parent, slNo: `9.${level}`, description: 'z', unit: 'MT', qty: 1 }));
    parent = `z${level}`;
  }
  const breakdown = buildDprBreakdown(lines, chain);
  const result = checkDprSubItem({
    draft: draft({ parentId: `z${DPR_MAX_BREAKDOWN_DEPTH}`, slNo: '9.99' }),
    breakdown,
    targets: [],
    entries: [],
    settings,
  });
  assert.equal(result.errors.some((m) => m.includes(`at most ${DPR_MAX_BREAKDOWN_DEPTH} levels`)), true);
  const oneUp = checkDprSubItem({
    draft: draft({ parentId: `z${DPR_MAX_BREAKDOWN_DEPTH - 1}`, slNo: '9.98' }),
    breakdown,
    targets: [],
    entries: [],
    settings,
  });
  assert.equal(oneUp.errors.some((m) => m.includes('levels')), false);
});

test('the unit cannot change once something is booked against the sub-item', () => {
  const base = {
    draft: { parentId: 'L1', slNo: '7.1', description: 'Earth pits', unit: 'Set', qty: 20, weightPct: 50 },
    editingId: 's1',
    breakdown: tree(),
    entries: [],
    settings,
  };
  assert.equal(
    checkDprSubItem({ ...base, targets: [{ boqItemId: 's1' }] }).errors.some((m) => m.includes('unit cannot change')),
    true,
  );
  assert.deepEqual(checkDprSubItem({ ...base, targets: [] }).errors, []);
  // The same unit written differently is not a change.
  assert.deepEqual(
    checkDprSubItem({ ...base, draft: { ...base.draft, unit: 'nos.' }, targets: [{ boqItemId: 's1' }] }).errors,
    [],
  );
});

test('shares that leave part of the parent uncovered are a warning, not an error', () => {
  // Under L3, a single 60% child with no blank sibling leaves 40% uncovered.
  const partial = check({ weightPct: 60 });
  assert.deepEqual(partial.errors, []);
  assert.equal(partial.warnings.some((m) => m.includes('40%')), true);
  // A blank share absorbs the rest, so there is nothing to warn about.
  assert.deepEqual(check({ parentId: 'L1', slNo: '7.4', unit: 'Nos', qty: 1, weightPct: 10 }).warnings, []);
});

/* ── checkDprSubItemDelete ──────────────────────────────────────────────────────────────────── */

test('deleting a sub-item takes everything under it, unless any of it has records', () => {
  const clean = checkDprSubItemDelete({ id: 's2', breakdown: tree(), targets: [], entries: [] });
  assert.deepEqual(clean, { errors: [], deleteIds: ['s2', 's21', 's22'] });
  const booked = checkDprSubItemDelete({
    id: 's2',
    breakdown: tree(),
    targets: [],
    entries: [{ id: 'e', status: 'Submitted', lines: [{ boqItemId: 's22' }] }],
  });
  assert.equal(booked.errors.length, 1);
  assert.equal(booked.errors[0].includes('7.2.2'), true);
  assert.deepEqual(booked.deleteIds, ['s2', 's21', 's22']);
  assert.equal(
    checkDprSubItemDelete({ id: 'L1', breakdown: tree(), targets: [], entries: [] }).errors.length,
    1,
    'a BOQ line itself is not deleted here',
  );
});

/* ── arrangeByBreakdown ─────────────────────────────────────────────────────────────────────── */

test('groups appear only above leaves that have rows, with fields rolled into their own unit', () => {
  const rows = new Map([
    ['s21', { done: 300, plan: 300 }],
    ['s1', { done: 10, plan: 20 }],
    ['L3', { done: 5, plan: 10 }],
  ]);
  const arranged = arrangeByBreakdown(tree(), rows, {
    done: (row) => row.done,
    plan: (row) => row.plan,
  });
  assert.deepEqual(
    arranged.map((entry) => entry.node.slNo),
    ['7', '7.1', '7.2', '7.2.1', '9'],
    'L2 has no rows under it, and 7.2.2 / 7.3 have no rows of their own',
  );
  const byId = new Map(arranged.map((entry) => [entry.node.id, entry]));
  assert.equal(byId.get('s1').row.done, 10);
  assert.deepEqual(byId.get('s1').rolled, {});
  assert.equal(byId.get('L1').row, null);
  // done: 0.5 × 10/20 + 0.25 × 0.6 × 300/300 = 0.4 LOT; plan: 0.5 × 1 + 0.15 = 0.65 LOT
  assert.equal(byId.get('L1').rolled.done, 0.4);
  assert.equal(byId.get('L1').rolled.plan, 0.65);
  assert.equal(byId.get('s2').rolled.done, 300, 'Rmt, the middle level’s own unit');
  assert.equal(byId.get('L3').row.done, 5, 'a leaf line is shown as its own row');
});
