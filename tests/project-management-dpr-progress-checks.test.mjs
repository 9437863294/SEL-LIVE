import assert from 'node:assert/strict';
import test from 'node:test';

const checks = await import('../src/lib/project-management-dpr-progress-checks.ts');
const { summariseDprProgress, buildDprProgressChecks } = checks;

const row = (over = {}) => ({
  id: 'x',
  boqSlNo: '1',
  erpSlNo: '',
  description: 'A line',
  unit: 'Cum',
  boqQty: 100,
  plannedQty: 10,
  actualQty: 10,
  varianceQty: 0,
  achievementPct: 100,
  cumulativeQty: 40,
  progressPct: 40,
  balanceQty: 60,
  workedDays: 2,
  lastWorkedDate: '2026-11-12',
  ...over,
});

// The mock-up's three lines.
const rwh = row({ id: 'rwh', boqSlNo: '5', unit: 'Nos', boqQty: 2, plannedQty: 50, actualQty: 2, varianceQty: -48, achievementPct: 4, cumulativeQty: 2, progressPct: 100, balanceQty: 0, workedDays: 1 });
const pcc = row({ id: 'pcc', boqSlNo: '2.2', unit: 'Cum', boqQty: 250, plannedQty: 2, actualQty: 1.2, varianceQty: -0.8, achievementPct: 60, cumulativeQty: 1.2, progressPct: 0.48, balanceQty: 248.8, workedDays: 1 });
const lot = row({ id: 'lot', boqSlNo: '7.4.1', unit: 'Lot', boqQty: 1, plannedQty: 0, actualQty: 1, varianceQty: 1, achievementPct: null, cumulativeQty: 1, progressPct: 100, balanceQty: 0, workedDays: 1, lastWorkedDate: '2026-11-14' });
const ROWS = [rwh, pcc, lot];

const decimalsFor = (unit) => (unit === 'Nos' || unit === 'Lot' ? 0 : 3);
const ctx = (over = {}) => ({ workingDays: 30, workingDaysToDate: 14, progressDays: 2, periodNoun: 'month', decimalsFor, ...over });

test('the summary counts lines with progress, completed, behind and ahead', () => {
  const summary = summariseDprProgress(ROWS);
  assert.deepEqual(summary.withProgress.map((r) => r.id), ['rwh', 'pcc', 'lot']);
  assert.deepEqual(summary.completed.map((r) => r.id), ['rwh', 'lot']);
  assert.deepEqual(summary.behind.map((r) => r.id), ['rwh', 'pcc']);
  assert.deepEqual(summary.ahead.map((r) => r.id), ['lot']);
  const idle = summariseDprProgress([row({ actualQty: 0, progressPct: null, varianceQty: 0 })]);
  assert.deepEqual([idle.withProgress.length, idle.completed.length], [0, 0]);
});

test('the mock-up lines give the four findings, worst first', () => {
  const found = buildDprProgressChecks(ROWS, ctx());
  assert.deepEqual(found.map((c) => [c.key, c.tone]), [
    ['planned-above-boq', 'danger'],
    ['little-done', 'warning'],
    ['no-plan', 'success'],
    ['sparse', 'info'],
  ]);
  const [over, low, unplanned, sparse] = found;
  assert.equal(over.title, 'Item 5 is planned at 50 Nos against a BOQ of 2');
  assert.equal(
    over.detail,
    'The plan is 25 times the BOQ quantity, so the variance shows −48 even though the item is 100% done. The planned figure probably needs correcting.',
  );
  assert.equal(low.title, 'Item 2.2 has only 0.5% of BOQ done');
  assert.equal(low.detail, '1.2 of 250 Cum to date, with 248.8 Cum balance.');
  assert.equal(unplanned.title, 'Item 7.4.1 completed with no plan');
  assert.equal(unplanned.detail, '1 Lot done on 14 Nov with 0 planned — add it to the plan so it is tracked.');
  assert.equal(sparse.title, 'Each line has 1 day of progress');
  assert.equal(sparse.detail, '30 working days in the month — check daily entries are being made.');
});

test('planned above BOQ only claims "done" when the line is', () => {
  const [check] = buildDprProgressChecks([row({ boqQty: 10, plannedQty: 15, actualQty: 5, varianceQty: -10, progressPct: 50, balanceQty: 5 })], ctx({ progressDays: 14 }));
  assert.equal(check.key, 'planned-above-boq');
  assert.doesNotMatch(check.detail, /done/);
  assert.match(check.detail, /1\.5 times/);
});

test('several lines in one finding are named, then counted', () => {
  const low = ['a', 'b', 'c', 'd', 'e'].map((id, index) =>
    row({ id, boqSlNo: `3.${index + 1}`, cumulativeQty: index + 1, progressPct: index + 1, balanceQty: 99 - index }),
  );
  const [check] = buildDprProgressChecks(low, ctx({ progressDays: 14 }));
  assert.equal(check.key, 'little-done');
  assert.equal(check.title, 'Items 3.1, 3.2, 3.3 and 2 more have under 10% of BOQ done');
  assert.equal(check.ids.length, 5);
  assert.match(check.detail, /and 2 more\.$/);
});

test('worked with no plan, not completed, and over several days', () => {
  const [check] = buildDprProgressChecks(
    [row({ plannedQty: 0, actualQty: 6, varianceQty: 6, achievementPct: null, workedDays: 3, lastWorkedDate: '2026-11-13' })],
    ctx({ progressDays: 14 }),
  );
  assert.equal(check.title, 'Item 1 worked with no plan');
  assert.equal(check.detail, '6 Cum done over 3 days, last on 13 Nov with 0 planned — add it to the plan so it is tracked.');
});

test('sparse recording counts days with progress; nothing stands out on a clean month', () => {
  const steady = [row({ workedDays: 6 }), row({ id: 'y', boqSlNo: '2', workedDays: 4 })];
  const [sparse] = buildDprProgressChecks(steady, ctx({ progressDays: 6 }));
  assert.equal(sparse.title, 'Progress recorded on 6 of 14 working days so far');
  assert.deepEqual(buildDprProgressChecks(steady, ctx({ progressDays: 14 })), []);
  assert.deepEqual(buildDprProgressChecks([], ctx({ progressDays: 0 })), [], 'an empty report finds nothing');
});
