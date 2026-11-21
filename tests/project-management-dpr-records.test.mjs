import assert from 'node:assert/strict';
import test from 'node:test';

const {
  buildDprProjectionRecords,
  checkDprRecordRows,
  dprAddedRowKey,
  dprRecordKey,
  dprRecordStatus,
  parseDprRecordKey,
  planDprRecordEdit,
} = await import('../src/lib/project-management-dpr-records.ts');
const { indexDprActuals, sanitizeDprSettings } = await import('../src/lib/project-management-dpr-plan.ts');

const target = (over = {}) => ({
  id: 't',
  scope: 'Civil',
  boqItemId: 'pcc',
  boqSlNo: '2.2',
  description: 'PCC M10',
  unit: 'Cum',
  periodType: 'Month',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  plannedQty: 20,
  distribution: 'even',
  remarks: '',
  ...over,
});

const TODAY = '2026-11-21';

test('lines of one scope over the same dates make one record, in BOQ number order', () => {
  const records = buildDprProjectionRecords(
    [
      target({ id: 'a', boqItemId: 'rwh', boqSlNo: '10', createdByName: 'Asha' }),
      target({ id: 'b', boqItemId: 'pcc', boqSlNo: '2.2', createdByName: 'Ravi' }),
      target({ id: 'c', boqItemId: 'sub', boqSlNo: '7.4.1', createdByName: 'Asha' }),
      // Same dates, other scope: a record of its own.
      target({ id: 'd', scope: 'Erection', boqItemId: 'tower', boqSlNo: '1' }),
      // Other dates, same scope: a record of its own.
      target({ id: 'e', periodType: 'Week', startDate: '2026-11-23', endDate: '2026-11-29' }),
    ],
    TODAY,
  );
  assert.equal(records.length, 3);
  // Newest start first; within one start date Civil before Erection.
  assert.deepEqual(
    records.map((record) => record.key),
    ['Civil~2026-11-23~2026-11-29', 'Civil~2026-11-01~2026-11-30', 'Erection~2026-11-01~2026-11-30'],
  );
  const month = records[1];
  assert.deepEqual(month.targets.map((t) => t.boqSlNo), ['2.2', '7.4.1', '10']);
  assert.deepEqual(month.madeBy, ['Ravi', 'Asha']);
  assert.equal(month.status, 'running');
  assert.equal(records[0].status, 'upcoming');
});

test('a record reads its spread and period type from its lines', () => {
  const [mixed] = buildDprProjectionRecords(
    [
      target({ id: 'a', distribution: 'front' }),
      target({ id: 'b', distribution: 'front', boqItemId: 'x' }),
      target({ id: 'c', distribution: undefined, boqItemId: 'y', periodType: 'Custom' }),
    ],
    TODAY,
  );
  assert.equal(mixed.distribution, 'mixed');
  assert.equal(mixed.spreadForNew, 'front');
  assert.equal(mixed.periodType, 'Month');

  const [plain] = buildDprProjectionRecords([target({ distribution: undefined, revisionNo: 2 })], TODAY);
  assert.equal(plain.distribution, 'even');
  assert.equal(plain.revisedCount, 1);
});

test('record keys round-trip and refuse anything else', () => {
  const key = dprRecordKey({ scope: 'Erection', startDate: '2026-11-01', endDate: '2026-11-07' });
  assert.deepEqual(parseDprRecordKey(key), { scope: 'Erection', startDate: '2026-11-01', endDate: '2026-11-07' });
  assert.equal(parseDprRecordKey('Design~2026-11-01~2026-11-07'), null);
  assert.equal(parseDprRecordKey('Civil~2026-11-01'), null);
  assert.equal(parseDprRecordKey('Civil~2026-11-01~2026-11-07~x'), null);
  assert.equal(parseDprRecordKey(null), null);
});

test('status: upcoming, running through the last day, ended after it', () => {
  const range = { startDate: '2026-11-01', endDate: '2026-11-30' };
  assert.equal(dprRecordStatus(range, '2026-10-31'), 'upcoming');
  assert.equal(dprRecordStatus(range, '2026-11-01'), 'running');
  assert.equal(dprRecordStatus(range, '2026-11-30'), 'running');
  assert.equal(dprRecordStatus(range, '2026-12-01'), 'ended');
});

const record = (lines) => buildDprProjectionRecords(lines, TODAY)[0];

test('an edit plan sorts rows into revisions, note changes, removals and additions', () => {
  const rec = record([
    target({ id: 'a', boqSlNo: '1', plannedQty: 20 }),
    target({ id: 'b', boqSlNo: '2', boqItemId: 'b', plannedQty: 1000, remarks: 'old' }),
    target({ id: 'c', boqSlNo: '3', boqItemId: 'c' }),
    target({ id: 'd', boqSlNo: '4', boqItemId: 'd' }),
  ]);
  const plan = planDprRecordEdit(
    rec,
    new Map([
      ['a', { qty: '25', remarks: 'more crew', removed: false }],
      // Same quantity typed with a thousands separator: only the note changed.
      ['b', { qty: '1,000', remarks: 'new', removed: false }],
      ['c', { qty: '20', remarks: '', removed: true }],
      // Untouched in effect.
      ['d', { qty: '20', remarks: '', removed: false }],
    ]),
    [{ boqItemId: 'e', qty: '4.5', remarks: ' first week ' }],
  );
  assert.deepEqual(plan.revise.map((row) => [row.target.id, row.toQty, row.remarks]), [['a', 25, 'more crew']]);
  assert.deepEqual(plan.remarksOnly.map((row) => [row.target.id, row.remarks]), [['b', 'new']]);
  assert.deepEqual(plan.remove.map((t) => t.id), ['c']);
  assert.deepEqual(plan.add, [{ boqItemId: 'e', qty: 4.5, remarks: 'first week' }]);
  assert.deepEqual(plan.invalid, []);
  assert.equal(plan.changeCount, 4);
  assert.equal(plan.needsReason, true);
  assert.equal(plan.removesAll, false);
});

test('adding lines alone needs no reason; blank or zero quantities are flagged, not saved', () => {
  const rec = record([target({ id: 'a' })]);
  const plan = planDprRecordEdit(
    rec,
    new Map([['a', { qty: '0', remarks: '', removed: false }]]),
    [
      { boqItemId: 'x', qty: '', remarks: '' },
      { boqItemId: 'y', qty: '3', remarks: '' },
    ],
  );
  assert.deepEqual(plan.invalid, ['a', dprAddedRowKey('x')]);
  assert.equal(plan.add.length, 1);
  assert.equal(plan.needsReason, false);

  const onlyAdd = planDprRecordEdit(rec, new Map(), [{ boqItemId: 'y', qty: '3', remarks: '' }]);
  assert.equal(onlyAdd.needsReason, false);
  assert.equal(onlyAdd.changeCount, 1);
});

test('removing every line reads as removing the record', () => {
  const rec = record([target({ id: 'a' }), target({ id: 'b', boqItemId: 'b' })]);
  const all = planDprRecordEdit(
    rec,
    new Map([
      ['a', { qty: '20', remarks: '', removed: true }],
      ['b', { qty: '20', remarks: '', removed: true }],
    ]),
    [],
  );
  assert.equal(all.removesAll, true);
  assert.equal(all.needsReason, true);
  const replaced = planDprRecordEdit(
    rec,
    new Map([
      ['a', { qty: '20', remarks: '', removed: true }],
      ['b', { qty: '20', remarks: '', removed: true }],
    ]),
    [{ boqItemId: 'c', qty: '1', remarks: '' }],
  );
  assert.equal(replaced.removesAll, false);
});

const settings = sanitizeDprSettings({});
const actuals = indexDprActuals([]);
const items = new Map([
  ['pcc', { unit: 'Cum', boqQty: 100 }],
  ['rwh', { unit: 'Nos', boqQty: 60 }],
]);
const checks = (rec, rows, added, over = {}) =>
  checkDprRecordRows({
    record: rec,
    rows,
    added,
    items,
    targets: rec.targets,
    actuals,
    settings,
    projectDates: { startDate: '', endDate: '' },
    today: TODAY,
    overlapPolicy: 'block',
    ...over,
  });

test('row checks: a changed line is a revision, an added line a new projection over the record period', () => {
  const rec = record([target({ id: 'a', plannedQty: 20 })]);
  const result = checks(
    rec,
    new Map([['a', { qty: '400', remarks: '', removed: false }]]),
    [
      { boqItemId: 'rwh', qty: '2.5', remarks: '' },
      { boqItemId: 'pcc', qty: '', remarks: '' },
    ],
  );
  // The open plan (21-11 to 30-11, a third of 400) is more than the BOQ of 100.
  assert.match(result.get('a').errors.join(' '), /Exceeds the balance/);
  // Nos is a whole-number unit.
  assert.ok(result.get(dprAddedRowKey('rwh')).errors.length > 0);
  assert.match(result.get(dprAddedRowKey('pcc')).errors.join(' '), /Enter a quantity/);
});

test('row checks: unchanged and removed lines are not checked', () => {
  const rec = record([target({ id: 'a', plannedQty: 20 }), target({ id: 'b', boqItemId: 'rwh', plannedQty: 2 })]);
  const result = checks(
    rec,
    new Map([
      ['a', { qty: '20', remarks: 'note only', removed: false }],
      ['b', { qty: '0', remarks: '', removed: true }],
    ]),
    [],
  );
  assert.equal(result.size, 0);
});

test('row checks: an ended record is locked', () => {
  const rec = record([target({ id: 'a', startDate: '2026-10-01', endDate: '2026-10-31' })]);
  const result = checks(rec, new Map([['a', { qty: '10', remarks: '', removed: false }]]), [
    { boqItemId: 'rwh', qty: '2', remarks: '' },
  ]);
  assert.match(result.get('a').errors.join(' '), /ended/);
  assert.match(result.get(dprAddedRowKey('rwh')).errors.join(' '), /ended/);
});

test('row checks: an added line overlapping another projection follows the overlap rule', () => {
  const rec = record([target({ id: 'a', plannedQty: 20 })]);
  const weekOnRwh = target({
    id: 'w',
    boqItemId: 'rwh',
    boqSlNo: '5',
    unit: 'Nos',
    periodType: 'Week',
    startDate: '2026-11-23',
    endDate: '2026-11-29',
    plannedQty: 2,
  });
  const added = [{ boqItemId: 'rwh', qty: '4', remarks: '' }];
  const blocked = checks(rec, new Map(), added, { targets: [...rec.targets, weekOnRwh] });
  assert.match(blocked.get(dprAddedRowKey('rwh')).errors.join(' '), /Overlaps/);
  const finer = checks(rec, new Map(), added, { targets: [...rec.targets, weekOnRwh], overlapPolicy: 'finer' });
  assert.deepEqual(finer.get(dprAddedRowKey('rwh')).errors, []);
  assert.match(finer.get(dprAddedRowKey('rwh')).warnings.join(' '), /Overlaps/);
});
