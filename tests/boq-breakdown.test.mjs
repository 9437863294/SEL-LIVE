import assert from 'node:assert/strict';
import test from 'node:test';

const {
  DEFAULT_MAX_BREAKDOWN_DEPTH,
  arrangeByBreakdown,
  buildBreakdown,
  effectiveWeights,
  foldLeavesToLines,
  nextSubItemSlNo,
} = await import('../src/lib/boq-breakdown.ts');

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const round = (value) => Math.round(value * 1e6) / 1e6;

/** "Earthing system, 1 LOT, ₹10,00,000" — the line the whole design exists for. */
const earthing = {
  id: 'line-earthing',
  boqSlNo: '2.1',
  erpSlNo: '7',
  description: 'Earthing system',
  unit: 'LOT',
  boqQty: 1,
  rate: 1000000,
  scope: 'Civil',
};

const sub = (over) => ({
  id: 's1',
  boqItemId: 'line-earthing',
  parentId: 'line-earthing',
  slNo: '2.1.1',
  description: 'Earth pits',
  unit: 'Nos',
  qty: 12,
  weightPct: null,
  order: 0,
  ...over,
});

/* ── Roll-up ────────────────────────────────────────────────────────────────────────────────── */

test('a 1 LOT line whose parts are 40% done reads 0.4 LOT', () => {
  // Three parts, equal shares (no weights set, mixed units ⇒ equal split).
  const subs = [
    sub({ id: 'pits', slNo: '2.1.1', unit: 'Nos', qty: 10, order: 0 }),
    sub({ id: 'strip', slNo: '2.1.2', description: 'Earth strip', unit: 'Rmt', qty: 100, order: 1 }),
    sub({ id: 'test', slNo: '2.1.3', description: 'Testing', unit: 'Nos', qty: 4, order: 2 }),
  ];
  const breakdown = buildBreakdown([earthing], subs);

  // Each part carries a third. Finish 60% of one and 60% of another, none of the third:
  // (0.6 + 0.6 + 0) / 3 = 0.4.
  const done = breakdown.rollUp((id) =>
    id === 'pits' ? 6 : id === 'strip' ? 60 : 0,
  );
  assert.equal(round(done.get('line-earthing')), 0.4, 'in the line’s own unit, LOT');
  assert.equal(done.get('pits'), 6, 'a leaf keeps its own figure in its own unit');
  assert.equal(done.get('strip'), 60);
});

test('mixed units never enter the arithmetic — only ratios do', () => {
  const subs = [
    sub({ id: 'a', unit: 'Nos', qty: 12, weightPct: 50 }),
    sub({ id: 'b', unit: 'Rmt', qty: 340, weightPct: 50, order: 1 }),
  ];
  const breakdown = buildBreakdown([earthing], subs);
  // Half of each ⇒ half the LOT, although 6 Nos and 170 Rmt cannot be added.
  const done = breakdown.rollUp((id) => (id === 'a' ? 6 : 170));
  assert.equal(round(done.get('line-earthing')), 0.5);
});

test('a finished branch reads the group’s full quantity, not the children’s', () => {
  const subs = [
    sub({ id: 'a', unit: 'Nos', qty: 12 }),
    sub({ id: 'b', unit: 'Rmt', qty: 340, order: 1 }),
  ];
  const breakdown = buildBreakdown([{ ...earthing, boqQty: 1 }], subs);
  const done = breakdown.rollUp((id) => (id === 'a' ? 12 : 340));
  assert.equal(round(done.get('line-earthing')), 1, 'all done = 1 LOT, not 352 of anything');
});

/* ── Weights ────────────────────────────────────────────────────────────────────────────────── */

test('blank shares split by quantity when every child is in the parent’s unit', () => {
  // 400 + 600 Cum under a 1000 Cum line simply add up.
  const parent = { unit: 'Cum' };
  const weights = effectiveWeights(parent, [
    { id: 'a', unit: 'Cum', qty: 400, weightPct: null },
    { id: 'b', unit: 'Cum', qty: 600, weightPct: null },
  ]);
  assert.equal(round(weights.get('a')), 0.4);
  assert.equal(round(weights.get('b')), 0.6);
});

test('blank shares split equally when the units differ from the parent’s', () => {
  const weights = effectiveWeights({ unit: 'LOT' }, [
    { id: 'a', unit: 'Nos', qty: 12, weightPct: null },
    { id: 'b', unit: 'Rmt', qty: 340, weightPct: null },
  ]);
  assert.equal(round(weights.get('a')), 0.5);
  assert.equal(round(weights.get('b')), 0.5);
});

test('"Cu.M" and "cum" are the same unit', () => {
  const weights = effectiveWeights({ unit: 'Cu.M' }, [
    { id: 'a', unit: 'cum', qty: 250, weightPct: null },
    { id: 'b', unit: 'CUM', qty: 750, weightPct: null },
  ]);
  assert.equal(round(weights.get('a')), 0.25, 'split by quantity, so the units matched');
});

test('set shares are used as given, and blanks divide only what is left', () => {
  const weights = effectiveWeights({ unit: 'LOT' }, [
    { id: 'a', unit: 'Nos', qty: 1, weightPct: 60 },
    { id: 'b', unit: 'Nos', qty: 1, weightPct: null },
    { id: 'c', unit: 'Nos', qty: 1, weightPct: null },
  ]);
  assert.equal(round(weights.get('a')), 0.6);
  assert.equal(round(weights.get('b')), 0.2, 'half of the remaining 40%');
  assert.equal(round(weights.get('c')), 0.2);
});

test('shares are deliberately not renormalised, so an uncovered group stays uncovered', () => {
  // 70% set and no blank children ⇒ the group is only 70% covered. Papering over this would hide
  // a real mistake; the caller warns instead.
  const subs = [
    sub({ id: 'a', unit: 'Nos', qty: 10, weightPct: 70 }),
  ];
  const breakdown = buildBreakdown([earthing], subs);
  const done = breakdown.rollUp(() => 10);
  assert.equal(round(done.get('line-earthing')), 0.7, 'finished child, but only 70% of the line');
});

/* ── Money ──────────────────────────────────────────────────────────────────────────────────── */

test('a child’s derived rate makes the parts add up to exactly the line’s value', () => {
  const subs = [
    sub({ id: 'a', unit: 'Nos', qty: 12, weightPct: 40 }),
    sub({ id: 'b', unit: 'Rmt', qty: 340, weightPct: 45, order: 1 }),
    sub({ id: 'c', unit: 'Nos', qty: 4, weightPct: 15, order: 2 }),
  ];
  const breakdown = buildBreakdown([earthing], subs);
  const lineValue = earthing.boqQty * earthing.rate;
  const partsValue = ['a', 'b', 'c'].reduce((sum, id) => {
    const node = breakdown.nodes.get(id);
    return sum + node.qty * node.rate;
  }, 0);
  assert.equal(round(partsValue), lineValue, 'nothing is lost or invented by breaking a line down');
  assert.equal(round(breakdown.nodes.get('a').qty * breakdown.nodes.get('a').rate), 400000);
});

test('a line with no rate gives its children a rate of zero rather than NaN', () => {
  const breakdown = buildBreakdown([{ ...earthing, rate: undefined }], [sub({ id: 'a' })]);
  assert.equal(breakdown.nodes.get('a').rate, 0);
});

test('a sub-item with no quantity gets a zero rate rather than dividing by zero', () => {
  const breakdown = buildBreakdown([earthing], [sub({ id: 'a', qty: 0 })]);
  assert.equal(breakdown.nodes.get('a').rate, 0);
  assert.equal(Number.isFinite(breakdown.nodes.get('a').rate), true);
});

/* ── Structure ──────────────────────────────────────────────────────────────────────────────── */

test('a line with sub-items becomes a group and stops being a leaf', () => {
  const breakdown = buildBreakdown([earthing], [sub({ id: 'a' })]);
  assert.equal(breakdown.nodes.get('line-earthing').isLeaf, false);
  assert.equal(breakdown.groupLineIds.has('line-earthing'), true);
  assert.deepEqual(breakdown.leaves.map((n) => n.id), ['a'], 'work belongs to leaves only');
});

test('an untouched line is its own leaf', () => {
  const breakdown = buildBreakdown([earthing], []);
  assert.equal(breakdown.nodes.get('line-earthing').isLeaf, true);
  assert.equal(breakdown.groupLineIds.size, 0);
});

test('a sub-item deeper than the limit is dropped, not trusted', () => {
  const chain = [];
  let parentId = 'line-earthing';
  for (let depth = 1; depth <= DEFAULT_MAX_BREAKDOWN_DEPTH + 1; depth += 1) {
    chain.push(sub({ id: `d${depth}`, parentId, slNo: `2.1.${depth}` }));
    parentId = `d${depth}`;
  }
  const breakdown = buildBreakdown([earthing], chain);
  assert.equal(breakdown.nodes.has(`d${DEFAULT_MAX_BREAKDOWN_DEPTH}`), true);
  assert.equal(breakdown.nodes.has(`d${DEFAULT_MAX_BREAKDOWN_DEPTH + 1}`), false, 'too deep to read');
});

test('a cycle is ignored rather than hanging the tree', () => {
  const subs = [
    sub({ id: 'a', parentId: 'b' }),
    sub({ id: 'b', parentId: 'a' }),
  ];
  const breakdown = buildBreakdown([earthing], subs);
  assert.equal(breakdown.nodes.has('a'), false);
  assert.equal(breakdown.nodes.has('b'), false);
  assert.equal(breakdown.nodes.get('line-earthing').isLeaf, true, 'the line is untouched by it');
});

test('an orphan whose parent is gone is dropped', () => {
  const breakdown = buildBreakdown([earthing], [sub({ id: 'a', parentId: 'deleted-elsewhere' })]);
  assert.equal(breakdown.nodes.has('a'), false);
});

test('a sub-item claiming a different line than its parent is dropped', () => {
  const subs = [
    sub({ id: 'a' }),
    // parent is 'a', but it says it belongs to another BOQ line — inconsistent, so not trusted.
    sub({ id: 'b', parentId: 'a', boqItemId: 'line-other' }),
  ];
  const breakdown = buildBreakdown([earthing], subs);
  assert.equal(breakdown.nodes.has('b'), false);
});

test('siblings order by their order field, then by SL No numerically', () => {
  const subs = [
    sub({ id: 'ten', slNo: '2.1.10', order: 0 }),
    sub({ id: 'nine', slNo: '2.1.9', order: 0 }),
  ];
  const breakdown = buildBreakdown([earthing], subs);
  assert.deepEqual(
    breakdown.childrenOf('line-earthing').map((n) => n.id),
    ['nine', 'ten'],
    '2.1.10 sorts after 2.1.9, not before it',
  );
});

test('ancestors read top first, for a row that has to explain itself', () => {
  const subs = [sub({ id: 'a' }), sub({ id: 'b', parentId: 'a', slNo: '2.1.1.1' })];
  const breakdown = buildBreakdown([earthing], subs);
  assert.deepEqual(
    breakdown.nodes.get('b').ancestors.map((a) => a.slNo),
    ['2.1', '2.1.1'],
  );
});

/* ── Folding leaves back to the contract line ───────────────────────────────────────────────── */

test('a quantity booked against a sub-item reads correctly on its BOQ line', () => {
  const subs = [
    sub({ id: 'pits', unit: 'Nos', qty: 12, weightPct: 50 }),
    sub({ id: 'strip', unit: 'Rmt', qty: 340, weightPct: 50, order: 1 }),
  ];
  const breakdown = buildBreakdown([earthing], subs);
  // An indent for 6 of the 12 pits: half of a half ⇒ 0.25 LOT against the contract line.
  const folded = foldLeavesToLines(breakdown, new Map([['pits', 6]]));
  assert.equal(round(folded.get('line-earthing')), 0.25);
});

test('a line nobody broke down folds to itself, unchanged', () => {
  const breakdown = buildBreakdown([earthing], []);
  const folded = foldLeavesToLines(breakdown, new Map([['line-earthing', 0.75]]));
  assert.equal(round(folded.get('line-earthing')), 0.75);
});

test('a quantity against an id this breakdown does not know is kept, not dropped', () => {
  // Losing a quantity silently is worse than reporting one we cannot place.
  const breakdown = buildBreakdown([earthing], []);
  const folded = foldLeavesToLines(breakdown, new Map([['some-other-line', 42]]));
  assert.equal(folded.get('some-other-line'), 42);
});

test('folding leaves a line with nothing booked out of the map', () => {
  const breakdown = buildBreakdown([earthing], [sub({ id: 'a' })]);
  const folded = foldLeavesToLines(breakdown, new Map());
  assert.equal(folded.has('line-earthing'), false, 'absent, not zero');
});

/* ── Showing the tree ───────────────────────────────────────────────────────────────────────── */

test('a group appears only above leaves that have rows, with its fields rolled up', () => {
  const subs = [
    sub({ id: 'a', unit: 'Nos', qty: 10, weightPct: 50 }),
    sub({ id: 'b', unit: 'Nos', qty: 10, weightPct: 50, order: 1 }),
  ];
  const breakdown = buildBreakdown([earthing], subs);
  const rows = new Map([['a', { done: 5 }]]);
  const arranged = arrangeByBreakdown(breakdown, rows, { done: (row) => row.done });

  assert.deepEqual(arranged.map((r) => r.node.id), ['line-earthing', 'a'], 'b has no row');
  assert.equal(arranged[0].row, null, 'a group has no row of its own');
  assert.equal(round(arranged[0].rolled.done), 0.25, 'half of a half of 1 LOT');
  assert.equal(arranged[1].row.done, 5);
});

/* ── Numbering ──────────────────────────────────────────────────────────────────────────────── */

test('the next SL No continues under the parent and never reuses a gap', () => {
  assert.equal(nextSubItemSlNo('2.2', []), '2.2.1');
  assert.equal(nextSubItemSlNo('2.2', [{ slNo: '2.2.1' }]), '2.2.2');
  assert.equal(
    nextSubItemSlNo('2.2', [{ slNo: '2.2.1' }, { slNo: '2.2.3' }]),
    '2.2.4',
    'the deleted 2.2.2 is not handed to a new sub-item',
  );
  assert.equal(nextSubItemSlNo('2.2', [{ slNo: '3.1.1' }]), '2.2.1', 'another branch is ignored');
  assert.equal(nextSubItemSlNo('', []), '1.1', 'a parent with no SL No still numbers its children');
});
