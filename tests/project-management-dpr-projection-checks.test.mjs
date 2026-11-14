import assert from 'node:assert/strict';
import test from 'node:test';

const { buildDprProjectionChecks } = await import('../src/lib/project-management-dpr-projection-checks.ts');

const items = new Map([
  ['pcc', { boqSlNo: '2.2', unit: 'Cum', boqQty: 250, scope: 'Civil' }],
  ['rwh', { boqSlNo: '5', unit: 'Nos', boqQty: 2, scope: 'Civil' }],
  ['tower', { boqSlNo: '7.1', unit: 'MT', boqQty: 500, scope: 'Erection' }],
]);

const target = (over = {}) => ({
  id: 't',
  scope: 'Civil',
  boqItemId: 'pcc',
  boqSlNo: '2.2',
  description: '',
  unit: 'Cum',
  periodType: 'Month',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  plannedQty: 2,
  revisionNo: 0,
  revisions: [],
  ...over,
});

const context = (over = {}) => ({
  items,
  scope: 'All',
  decimalsFor: (unit) => (unit === 'Nos' ? 0 : 3),
  workingDays: () => 30,
  ...over,
});

test('a projection above its BOQ quantity is the first thing flagged', () => {
  const checks = buildDprProjectionChecks(
    [target({ id: 'a', boqItemId: 'rwh', boqSlNo: '5', unit: 'Nos', plannedQty: 50 }), target({ id: 'b' })],
    context(),
  );
  assert.equal(checks[0].tone, 'danger');
  assert.equal(checks[0].mark, '5');
  assert.equal(checks[0].title, '50 Nos projected for item 5');
  assert.equal(checks[0].detail, 'The BOQ quantity for this line is 2 Nos — please check whether 50 is correct.');
  assert.deepEqual(checks[0].ids, ['a']);
});

test('the latest revision is read: cut or raised, with the new per-day rate', () => {
  const revisions = [
    { revisionNo: 1, fromQty: 20, toQty: 2, reason: 'Rain', changedAt: '', changedBy: '', changedByName: '' },
  ];
  const [cut] = buildDprProjectionChecks([target({ id: 'c', plannedQty: 2, baselineQty: 20, revisionNo: 1, revisions })], context({ scope: 'Civil' }));
  assert.equal(cut.tone, 'warning');
  assert.equal(cut.mark, 'R1');
  assert.equal(cut.title, 'Item 2.2 cut from 20 to 2 Cum');
  assert.equal(cut.detail, "Revision R1 lowered the month's target; per day is now 0.067 Cum.");

  const up = [
    ...revisions,
    { revisionNo: 2, fromQty: 2, toQty: 6, reason: 'Crew added', changedAt: '', changedBy: '', changedByName: '' },
  ];
  const [raised] = buildDprProjectionChecks(
    [target({ id: 'd', plannedQty: 6, revisionNo: 2, revisions: up, periodType: 'Week' })],
    context({ scope: 'Civil' }),
  );
  assert.equal(raised.title, 'Item 2.2 raised from 2 to 6 Cum');
  assert.match(raised.detail, /^Revision R2 raised the week's target/);
});

test('a revision with no history falls back to baseline against current; an unchanged one is not flagged', () => {
  const [fromBaseline] = buildDprProjectionChecks(
    [target({ id: 'e', plannedQty: 15, baselineQty: 10, revisionNo: 1, revisions: undefined })],
    context({ scope: 'Civil' }),
  );
  assert.equal(fromBaseline.title, 'Item 2.2 raised from 10 to 15 Cum');
  const same = [{ revisionNo: 1, fromQty: 5, toQty: 5, reason: '', changedAt: '', changedBy: '', changedByName: '' }];
  assert.deepEqual(
    buildDprProjectionChecks([target({ revisionNo: 1, revisions: same, plannedQty: 5 })], context({ scope: 'Civil' })),
    [],
  );
});

test('a scope with BOQ lines but no projection is noted, only when every scope is shown', () => {
  const checks = buildDprProjectionChecks([target()], context());
  assert.deepEqual(
    checks.map((check) => [check.tone, check.title, check.detail]),
    [['info', 'Only Civil lines are projected', 'No Erection projection exists for November yet.']],
  );
  assert.deepEqual(buildDprProjectionChecks([target()], context({ scope: 'Civil' })), []);
  const spanning = buildDprProjectionChecks([target({ endDate: '2026-12-15' })], context());
  assert.equal(spanning[0].detail, 'No Erection projection exists for these periods yet.');
});

test('past three of a kind the rest are summed into one finding, and nothing at all reads empty', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map((id, index) =>
    target({ id, boqItemId: 'rwh', boqSlNo: `5.${index + 1}`, unit: 'Nos', plannedQty: 10 + index }),
  );
  const checks = buildDprProjectionChecks(many, context({ scope: 'Civil' }));
  assert.equal(checks.length, 4);
  assert.equal(checks[3].title, '2 more projections are above the BOQ quantity');
  assert.deepEqual(checks[3].ids.length, 2);
  // Worst first: the largest multiple of the BOQ quantity leads (the line's own SL No is named).
  assert.equal(checks[0].title, '14 Nos projected for item 5');
  assert.deepEqual(checks[0].ids, ['e']);
  assert.deepEqual(buildDprProjectionChecks([], context()), []);
});
