import assert from 'node:assert/strict';
import test from 'node:test';

const {
  BOQ_MAX_BREAKDOWN_DEPTH,
  boqLineValues,
  boqNodeValues,
  buildBoqBreakdown,
  checkBoqSubItem,
  checkBoqSubItemDelete,
  fitsBoqPrecision,
} = await import('../src/lib/project-management-boq-subitems.ts');

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const round = (value) => Math.round(value * 1e6) / 1e6;

const line = {
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

const draft = (over) => ({
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

const check = (over = {}, { subItems = [], recordedIds = [], editingId } = {}) =>
  checkBoqSubItem({
    draft: draft(over),
    editingId,
    breakdown: buildBoqBreakdown([line], subItems),
    recordedIds: new Set(recordedIds),
  });

/* ── The two values ─────────────────────────────────────────────────────────────────────────── */

test('one share divides both the contract value and the budget value', () => {
  const subItems = [
    sub({ id: 'pits', weightPct: 40 }),
    sub({ id: 'strip', slNo: '2.1.2', unit: 'Rmt', qty: 340, weightPct: 45, order: 1 }),
    sub({ id: 'test', slNo: '2.1.3', unit: 'Nos', qty: 4, weightPct: 15, order: 2 }),
  ];
  const breakdown = buildBoqBreakdown([line], subItems);
  const values = boqNodeValues(breakdown, () => ({ contract: 1000000, budget: 820000 }));

  assert.equal(round(values.get('pits').contractValue), 400000);
  assert.equal(round(values.get('pits').budgetValue), 328000, '40% of the budget too');
  // The parts add back to exactly the line, on both bases.
  const sumContract = ['pits', 'strip', 'test'].reduce(
    (sum, id) => sum + values.get(id).contractValue, 0);
  const sumBudget = ['pits', 'strip', 'test'].reduce(
    (sum, id) => sum + values.get(id).budgetValue, 0);
  assert.equal(round(sumContract), 1000000, 'the contract total cannot drift');
  assert.equal(round(sumBudget), 820000);
});

test('a rate is derived so a quantity can be priced directly', () => {
  const breakdown = buildBoqBreakdown([line], [sub({ id: 'pits', weightPct: 40 })]);
  const values = boqNodeValues(breakdown, () => ({ contract: 1000000, budget: 820000 }));
  const pits = values.get('pits');
  assert.equal(round(pits.contractRate * 12), round(pits.contractValue));
  assert.equal(round(pits.budgetRate * 12), round(pits.budgetValue));
});

test('a sub-item with no quantity gets a zero rate rather than dividing by zero', () => {
  const breakdown = buildBoqBreakdown([line], [sub({ id: 'pits', qty: 0, weightPct: 40 })]);
  const values = boqNodeValues(breakdown, () => ({ contract: 1000000, budget: 820000 }));
  assert.equal(values.get('pits').contractRate, 0);
  assert.equal(Number.isFinite(values.get('pits').budgetRate), true);
});

test('a line read as worthless gives its parts no value rather than NaN', () => {
  const breakdown = buildBoqBreakdown([line], [sub({ id: 'pits' })]);
  const values = boqNodeValues(breakdown, () => ({ contract: 0, budget: 0 }));
  assert.equal(values.get('pits').contractValue, 0);
  assert.equal(values.get('pits').contractRate, 0);
});

test('the deeper levels take a share of a share', () => {
  const subItems = [
    sub({ id: 'pits', weightPct: 50 }),
    sub({ id: 'digging', parentId: 'pits', slNo: '2.1.1.1', weightPct: 60, unit: 'Nos', qty: 12 }),
  ];
  const breakdown = buildBoqBreakdown([line], subItems);
  const values = boqNodeValues(breakdown, () => ({ contract: 1000000, budget: 0 }));
  assert.equal(round(values.get('digging').contractValue), 300000, '60% of 50%');
});

/* ── Breaking a line down ───────────────────────────────────────────────────────────────────── */

test('a line with work against it cannot be broken down', () => {
  const result = check({}, { recordedIds: ['line-earthing'] });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /already has work recorded against it/);
});

test('a line with no work can be broken down', () => {
  assert.deepEqual(check().errors, []);
});

test('a second sub-item is allowed although the parent is now a group', () => {
  // The parent stopped being a leaf when it got its first child, so the records check no longer
  // applies — and a group cannot have acquired records of its own.
  const result = check(
    { slNo: '2.1.2', order: 1 },
    { subItems: [sub({ id: 'pits' })], recordedIds: ['line-earthing'] },
  );
  assert.deepEqual(result.errors, []);
});

test('a sub-item needs an SL No, a description, a unit and a positive quantity', () => {
  assert.match(check({ slNo: '  ' }).errors.join(), /SL No/);
  assert.match(check({ description: '' }).errors.join(), /Describe/);
  assert.match(check({ unit: '' }).errors.join(), /unit/);
  assert.match(check({ qty: 0 }).errors.join(), /greater than zero/);
  assert.match(check({ qty: -4 }).errors.join(), /greater than zero/);
});

test('an SL No already used anywhere in this line’s breakdown is refused', () => {
  const result = check({ slNo: '2.1.1' }, { subItems: [sub({ id: 'pits', slNo: '2.1.1' })] });
  assert.match(result.errors.join(), /already used/);
  // Case does not rescue it.
  assert.match(check({ slNo: '2.1.1' }, { subItems: [sub({ id: 'p', slNo: '2.1.1' })] }).errors.join(), /already used/);
});

test('editing a sub-item does not clash with itself', () => {
  const result = check(
    { slNo: '2.1.1', description: 'Earth pits, revised' },
    { subItems: [sub({ id: 'pits', slNo: '2.1.1' })], editingId: 'pits' },
  );
  assert.deepEqual(result.errors, []);
});

test('whole-number units refuse a fractional quantity', () => {
  assert.match(check({ unit: 'Nos', qty: 2.5 }).errors.join(), /whole numbers/);
  assert.deepEqual(check({ unit: 'Cum', qty: 2.5 }).errors, [], 'but Cum may be fractional');
  assert.match(check({ unit: 'Cum', qty: 2.50001 }).errors.join(), /at most 3 decimals/);
});

test('fitsBoqPrecision is a tolerance check, not a rounder', () => {
  assert.equal(fitsBoqPrecision(2, 0), true);
  assert.equal(fitsBoqPrecision(2.5, 0), false);
  assert.equal(fitsBoqPrecision(2.125, 3), true);
  assert.equal(fitsBoqPrecision(2.1255, 3), false);
});

test('depth is capped so a breakdown stays readable', () => {
  const chain = [];
  let parentId = 'line-earthing';
  for (let depth = 1; depth <= BOQ_MAX_BREAKDOWN_DEPTH; depth += 1) {
    chain.push(sub({ id: `d${depth}`, parentId, slNo: `2.1.${depth}` }));
    parentId = `d${depth}`;
  }
  const result = check(
    { parentId, slNo: '2.1.deep' },
    { subItems: chain },
  );
  assert.match(result.errors.join(), /at most 5 levels/);
});

/* ── Shares ─────────────────────────────────────────────────────────────────────────────────── */

test('a share must be above 0 and at most 100, or left blank', () => {
  assert.deepEqual(check({ weightPct: null }).errors, [], 'blank is how you say “split the rest”');
  assert.deepEqual(check({ weightPct: 40 }).errors, []);
  assert.match(check({ weightPct: 0 }).errors.join(), /above 0/);
  assert.match(check({ weightPct: 140 }).errors.join(), /at most 100/);
});

test('shares that would total more than the whole parent are refused', () => {
  const result = check(
    { slNo: '2.1.2', weightPct: 70, order: 1 },
    { subItems: [sub({ id: 'pits', weightPct: 40 })] },
  );
  assert.match(result.errors.join(), /would total 110/);
});

test('shares that leave part of the parent uncovered are a warning, not an error', () => {
  const result = check(
    { slNo: '2.1.2', weightPct: 30, order: 1 },
    { subItems: [sub({ id: 'pits', weightPct: 40 })] },
  );
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join(), /30% of it is not covered/);
});

test('a blank share means nothing is uncovered, so no warning', () => {
  const result = check(
    { slNo: '2.1.2', weightPct: null, order: 1 },
    { subItems: [sub({ id: 'pits', weightPct: 40 })] },
  );
  assert.deepEqual(result.warnings, [], 'the blank one takes the remaining 60%');
});

/* ── Changing and deleting ──────────────────────────────────────────────────────────────────── */

test('the unit cannot change once something is recorded against the sub-item', () => {
  const result = check(
    { unit: 'Rmt' },
    { subItems: [sub({ id: 'pits', unit: 'Nos' })], editingId: 'pits', recordedIds: ['pits'] },
  );
  assert.match(result.errors.join(), /unit cannot change/);
});

test('the unit may change while nothing is recorded', () => {
  const result = check(
    { unit: 'Rmt' },
    { subItems: [sub({ id: 'pits', unit: 'Nos' })], editingId: 'pits' },
  );
  assert.deepEqual(result.errors, []);
});

test('deleting a sub-item takes everything under it', () => {
  const subItems = [
    sub({ id: 'pits' }),
    sub({ id: 'digging', parentId: 'pits', slNo: '2.1.1.1' }),
  ];
  const result = checkBoqSubItemDelete({
    id: 'pits',
    breakdown: buildBoqBreakdown([line], subItems),
    recordedIds: new Set(),
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.deleteIds.sort(), ['digging', 'pits']);
});

test('deleting is refused when anything under it carries work', () => {
  const subItems = [
    sub({ id: 'pits' }),
    sub({ id: 'digging', parentId: 'pits', slNo: '2.1.1.1' }),
  ];
  const result = checkBoqSubItemDelete({
    id: 'pits',
    breakdown: buildBoqBreakdown([line], subItems),
    recordedIds: new Set(['digging']),
  });
  assert.match(result.errors.join(), /Work is recorded against 2\.1\.1\.1/);
  assert.deepEqual(result.deleteIds, [], 'nothing is deleted when anything is blocked');
});

test('a BOQ line itself cannot be deleted here', () => {
  const result = checkBoqSubItemDelete({
    id: 'line-earthing',
    breakdown: buildBoqBreakdown([line], [sub({ id: 'pits' })]),
    recordedIds: new Set(),
  });
  assert.match(result.errors.join(), /Only a sub-item/);
});

/* ── Reading a line's two values ────────────────────────────────────────────────────────────── */

test('a stored total wins over a recomputation, because the sheet’s own arithmetic was agreed', () => {
  const values = boqLineValues({
    QTY: 100, 'Unit Rate': 500, 'Total Amount': 49999,
    'Budget Price': 400, 'Total Budget Price': 39999,
  });
  assert.equal(values.contract, 49999, 'not 50000');
  assert.equal(values.budget, 39999);
});

test('without a stored total, each value is computed from its own rate', () => {
  const values = boqLineValues({ QTY: 100, 'Unit Rate': 500, 'Budget Price': 400 });
  assert.equal(values.contract, 50000);
  assert.equal(values.budget, 40000, 'budget uses Budget Price, never Unit Rate');
});

test('the two values are independent — one missing does not borrow the other', () => {
  const noBudget = boqLineValues({ QTY: 100, 'Unit Rate': 500 });
  assert.equal(noBudget.contract, 50000);
  assert.equal(noBudget.budget, 0, 'a line with no budget price is worth 0 to buy against');

  const noContract = boqLineValues({ QTY: 100, 'Budget Price': 400 });
  assert.equal(noContract.contract, 0);
  assert.equal(noContract.budget, 40000);
});

test('spreadsheet numbers with commas are read as numbers', () => {
  assert.equal(boqLineValues({ 'Total Amount': '1,00,000' }).contract, 100000);
});

test('a missing or empty line is worth nothing rather than NaN', () => {
  assert.deepEqual(boqLineValues(null), { contract: 0, budget: 0 });
  assert.deepEqual(boqLineValues({}), { contract: 0, budget: 0 });
});
