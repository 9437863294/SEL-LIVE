import assert from 'node:assert/strict';
import test from 'node:test';

const checks = await import('../src/lib/project-management-dpr-lookahead-checks.ts');
const { buildDprLookAheadChecks, dprLookAheadShortfall, dprLookAheadWindow } = checks;

// Six weeks from Mon 02 Nov; today is in the second (09 Nov).
const weeks = Array.from({ length: 6 }, (_, index) => {
  const start = new Date(Date.UTC(2026, 10, 2 + index * 7));
  const end = new Date(Date.UTC(2026, 10, 8 + index * 7));
  const iso = (date) => date.toISOString().slice(0, 10);
  return {
    startDate: iso(start),
    endDate: iso(end),
    label: `Wk ${index}`,
    isCurrent: index === 1,
    started: index <= 1,
    ended: index === 0,
  };
});
const decimalsFor = (unit) => (unit === 'Nos' || unit === 'Lot' ? 0 : 3);
const row = (id, boqSlNo, unit, cells) => ({
  item: { id, boqSlNo, unit },
  cells: cells.map(([planned, done]) => ({ planned, done: done === undefined ? null : done })),
});

const ROWS = [
  row('pcc', '2.2', 'Cum', [[0.466, 0], [0.467, 1.2], [0.467], [0.466], [0.067], [0]]),
  row('rwh', '5', 'Nos', [[11, 0], [12, 2], [12], [11], [2], [0]]),
  row('gf', '7.4', 'Lot', [[0, 0], [0, 1], [0], [0], [0], [0]]),
  row('idle', '9.1', 'Cum', [[0, 0], [0, 0], [0], [0], [0], [0]]),
];

test('the window: first and last day of the six weeks, and the current week', () => {
  const window = dprLookAheadWindow(weeks);
  assert.equal(window.startDate, '2026-11-02');
  assert.equal(window.endDate, '2026-12-13');
  assert.equal(window.current?.startDate, '2026-11-09');
  assert.deepEqual(dprLookAheadWindow([]), { startDate: '', endDate: '', current: null });
});

test('this week’s worst line is the one furthest behind as a share of its own plan', () => {
  const worst = dprLookAheadShortfall(ROWS, weeks);
  assert.equal(worst?.itemId, 'rwh');
  assert.equal(worst?.planned, 12);
  assert.equal(worst?.done, 2);
  assert.ok(Math.abs(worst.shortShare - 10 / 12) < 1e-9);
  // Nothing behind: ahead and unplanned lines do not count.
  assert.equal(dprLookAheadShortfall([ROWS[0], ROWS[2]], weeks), null);
});

test('checks: behind first, then done without a plan, then ahead — in the mock-up’s words', () => {
  const found = buildDprLookAheadChecks(ROWS, weeks, decimalsFor);
  assert.deepEqual(found.map((check) => [check.key, check.tone, check.mark]), [
    ['behind-rwh', 'danger', '5'],
    ['no-plan-gf', 'warning', '7.4'],
    ['ahead-pcc', 'success', '2.2'],
  ]);
  assert.equal(found[0].detail, '2 Nos done against 12 planned — and 48 Nos planned over the six weeks.');
  assert.equal(found[1].detail, '1 Lot done in week 09 Nov with no projection for any week.');
  assert.equal(found[2].detail, '1.2 Cum done against 0.467 planned for week 09 Nov.');
});

test('a line planned this week with nothing done is behind; an exact match is not flagged', () => {
  const found = buildDprLookAheadChecks(
    [row('a', '1', 'Nos', [[0, 0], [5, 0], [0], [0], [0], [0]]), row('b', '2', 'Nos', [[0, 0], [3, 3], [0], [0], [0], [0]])],
    weeks,
    decimalsFor,
  );
  assert.deepEqual(found.map((check) => check.key), ['behind-a']);
  assert.match(found[0].detail, /^0 Nos done against 5 planned/);
});

test('no current week, or nothing to say, gives no checks; the list is capped', () => {
  assert.deepEqual(buildDprLookAheadChecks(ROWS, weeks.map((week) => ({ ...week, isCurrent: false })), decimalsFor), []);
  assert.deepEqual(buildDprLookAheadChecks([ROWS[3]], weeks, decimalsFor), []);
  const many = Array.from({ length: 9 }, (_, index) =>
    row(`r${index}`, String(index + 1), 'Nos', [[0, 0], [10, index], [0], [0], [0], [0]]),
  );
  const capped = buildDprLookAheadChecks(many, weeks, decimalsFor);
  assert.equal(capped.length, 6);
  assert.equal(capped[0].mark, '1', 'the furthest behind (0 of 10) comes first');
  assert.equal(buildDprLookAheadChecks(many, weeks, decimalsFor, { limit: 2 }).length, 2);
});
