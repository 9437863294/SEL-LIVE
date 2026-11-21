import assert from 'node:assert/strict';
import test from 'node:test';

const {
  buildDprRateLookup,
  buildDprValueToDate,
  buildDprValueTrend,
  dprPeriodRowValue,
  dprPeriodValuesByScope,
  summariseDprPeriodValues,
  dprLineValue,
  dprPlannedValue,
  dprRateOf,
  dprSheetValue,
  dprSheetsValue,
  dprUnpricedText,
  dprValuePct,
  formatDprRate,
  formatDprValue,
  formatDprValueCompact,
} = await import('../src/lib/project-management-dpr-values.ts');

const rates = buildDprRateLookup([
  { id: 'pcc', rate: 5000 },
  { id: 'exc', rate: 250.5 },
  { id: 'free', rate: 0 },
  { id: 'none' },
  { id: 'text', rate: '1,200' },
]);

test('only a rate above zero counts as a rate', () => {
  assert.equal(dprRateOf(rates, 'pcc'), 5000);
  assert.equal(dprRateOf(rates, 'free'), null);
  assert.equal(dprRateOf(rates, 'none'), null);
  assert.equal(dprRateOf(rates, 'missing'), null);
  assert.equal(dprRateOf(rates, ''), null);
  // Rates read from a register may be typed text; dprNumber reads "1,200".
  assert.equal(dprRateOf(rates, 'text'), 1200);
});

test('a line is worth quantity × rate, or nothing without a rate', () => {
  assert.equal(dprLineValue(rates, 'pcc', 2.5), 12500);
  assert.equal(dprLineValue(rates, 'exc', '10'), 2505);
  assert.equal(dprLineValue(rates, 'pcc', ''), 0);
  assert.equal(dprLineValue(rates, 'free', 10), null);
});

test('a projection record is valued line by line; unpriced lines are counted, not guessed', () => {
  const total = dprPlannedValue(
    [
      { boqItemId: 'pcc', plannedQty: 30 },
      { boqItemId: 'exc', plannedQty: 100 },
      { boqItemId: 'none', plannedQty: 4 },
    ],
    rates,
  );
  assert.deepEqual(total, { value: 150000 + 25050, priced: 2, unpriced: 1 });
  assert.deepEqual(dprPlannedValue([], rates), { value: 0, priced: 0, unpriced: 0 });
});

test('a sheet is valued from its plan snapshot and its actuals', () => {
  const value = dprSheetValue(
    [
      { boqItemId: 'pcc', plannedQty: 1, actualQty: 1.5 },
      { boqItemId: 'exc', plannedQty: 4, actualQty: 2 },
      // The same line at a second location counts again.
      { boqItemId: 'exc', plannedQty: 0, actualQty: 1 },
      // A draft line with its Actual left empty adds to planned only.
      { boqItemId: 'pcc', plannedQty: 2, actualQty: 0, actualEntered: false },
      { boqItemId: 'none', plannedQty: 3, actualQty: 3 },
    ],
    rates,
  );
  assert.equal(value.planned, 5000 + 1002 + 0 + 10000);
  assert.equal(value.actual, 7500 + 501 + 250.5);
  assert.equal(value.priced, 4);
  assert.equal(value.unpriced, 1);
  assert.deepEqual(dprSheetValue(undefined, rates), { planned: 0, actual: 0, priced: 0, unpriced: 0 });
});

test('sheets add up', () => {
  const total = dprSheetsValue(
    [
      { lines: [{ boqItemId: 'pcc', plannedQty: 1, actualQty: 1 }] },
      { lines: [{ boqItemId: 'none', plannedQty: 1, actualQty: 1 }] },
      { lines: undefined },
    ],
    rates,
  );
  assert.deepEqual(total, { planned: 5000, actual: 5000, priced: 1, unpriced: 1 });
});

test('a share of plan needs something planned', () => {
  assert.equal(dprValuePct(50, 200), 25);
  assert.equal(dprValuePct(50, 0), null);
});

test('values show in whole rupees with Indian grouping, compact on a tile', () => {
  assert.equal(formatDprValue(175050.75), '₹1,75,051');
  assert.equal(formatDprValue(0), '₹0');
  assert.equal(formatDprValue(null), '—');
  assert.equal(formatDprValueCompact(12430000), '₹1.24 Cr');
  assert.equal(formatDprValueCompact(7625000), '₹76.25 L');
  assert.equal(formatDprValueCompact(85430), '₹85,430');
  assert.equal(formatDprValueCompact(null), '—');
  assert.equal(formatDprRate(250.5), '₹250.50');
  assert.equal(formatDprRate(5000), '₹5,000');
  assert.equal(formatDprRate(null), '—');
  assert.equal(formatDprRate(0), '—');
});

test('the unpriced note names how many lines are left out', () => {
  assert.equal(dprUnpricedText(0), '');
  assert.equal(dprUnpricedText(1), '1 line has no rate');
  assert.equal(dprUnpricedText(3), '3 lines have no rate');
});

/* ── Reports ─────────────────────────────────────────────────────────────────────────────────── */

const row = (over = {}) => ({
  id: 'pcc',
  plannedQty: 10,
  actualQty: 8,
  cumulativeQty: 40,
  boqQty: 100,
  balanceQty: 60,
  ...over,
});

test('a report row in money: every figure × the rate, or all null without one', () => {
  assert.deepEqual(dprPeriodRowValue(row(), rates), {
    rate: 5000,
    planned: 50000,
    actual: 40000,
    toDate: 200000,
    boq: 500000,
    balance: 300000,
  });
  const unpriced = dprPeriodRowValue(row({ id: 'none' }), rates);
  assert.equal(unpriced.rate, null);
  assert.equal(unpriced.actual, null);
});

test('the period summary values priced lines and counts the rest', () => {
  const summary = summariseDprPeriodValues(
    [row(), row({ id: 'exc', plannedQty: 100, actualQty: 120, cumulativeQty: 120, boqQty: 400, balanceQty: 280 }), row({ id: 'none' })],
    rates,
  );
  assert.equal(summary.planned, 50000 + 25050);
  assert.equal(summary.actual, 40000 + 30060);
  assert.equal(summary.toDate, 200000 + 30060);
  assert.equal(summary.boq, 500000 + 100200);
  assert.equal(summary.priced, 2);
  assert.equal(summary.unpriced, 1);
  assert.equal(Math.round(summary.achievementPct * 100) / 100, Math.round(((70060 / 75050) * 100) * 100) / 100);
  assert.equal(summariseDprPeriodValues([], rates).achievementPct, null);
  assert.equal(summariseDprPeriodValues([], rates).progressPct, null);
});

test('values by scope follow the fixed scope order and skip scopes with no lines', () => {
  const scopeOf = (id) => ({ pcc: 'Civil', exc: 'Supply', none: 'Supply' })[id];
  const byScope = dprPeriodValuesByScope([row({ id: 'exc' }), row(), row({ id: 'none' })], rates, scopeOf);
  assert.deepEqual(byScope.map((entry) => [entry.scope, entry.lines, entry.priced, entry.unpriced]), [
    ['Civil', 1, 1, 0],
    ['Supply', 2, 1, 1],
  ]);
});

test('the value trend adds planned and submitted value per bucket, with running totals', () => {
  // 10 a day planned on pcc through the week; an unpriced line is counted, not valued.
  const plan = {
    qtyInRange: (id, range) => {
      if (id !== 'pcc' && id !== 'none') return 0;
      const days = (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86400000 + 1;
      return 10 * days;
    },
  };
  const entries = [
    { id: 'Civil-2026-11-16', scope: 'Civil', date: '2026-11-16', status: 'Submitted', lines: [{ boqItemId: 'pcc', actualQty: 12 }] },
    { id: 'Civil-2026-11-17', scope: 'Civil', date: '2026-11-17', status: 'Draft', lines: [{ boqItemId: 'pcc', actualQty: 99 }] },
  ];
  const trend = buildDprValueTrend({
    items: [{ id: 'pcc', scope: 'Civil', rate: 5000 }, { id: 'none', scope: 'Civil' }, { id: 'exc', scope: 'Supply', rate: 250.5 }],
    entries,
    plan,
    range: { startDate: '2026-11-16', endDate: '2026-11-17' },
    periodType: 'Day',
  });
  assert.deepEqual(trend.points.map((point) => [point.bucketStart, point.plannedValue, point.actualValue, point.cumulativeActualValue]), [
    ['2026-11-16', 50000, 60000, 60000],
    ['2026-11-17', 50000, 0, 60000],
  ]);
  assert.equal(trend.plannedValue, 100000);
  assert.equal(trend.actualValue, 60000);
  assert.equal(trend.priced, 1);
  assert.equal(trend.unpriced, 1);
  assert.deepEqual(buildDprValueTrend({ items: [], entries: [], plan, range: { startDate: 'x', endDate: 'y' }, periodType: 'Day' }).points, []);
});

test('value to date stops each scope at its last recording day, and says when scopes differ', async () => {
  const { sanitizeDprSettings } = await import('../src/lib/project-management-dpr-plan.ts');
  // 1 a day on every day; Civil daily, Supply weekly on Saturday (14 Nov). Wednesday 18 Nov.
  const plan = { qtyInRange: (id, range) => (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86400000 + 1 };
  const settings = sanitizeDprSettings({ weeklyOff: [], recordingSchedule: { Supply: { frequency: 'weekly', weekdays: [6] } } });
  const items = [{ id: 'pcc', scope: 'Civil', rate: 100 }, { id: 'steel', scope: 'Supply', rate: 1000 }, { id: 'none', scope: 'Civil' }];
  const entries = [{ id: 'Supply-2026-11-14', scope: 'Supply', date: '2026-11-14', status: 'Submitted', lines: [{ boqItemId: 'steel', actualQty: 14 }] }];
  const range = { startDate: '2026-11-01', endDate: '2026-11-30' };
  const reading = buildDprValueToDate({ items, entries, plan, range, settings, today: '2026-11-18' });
  // Civil to the 18th (18 × 100) + Supply to the 14th (14 × 1000); the unpriced line is left out.
  assert.equal(reading.plannedValue, 1800 + 14000);
  assert.equal(reading.actualValue, 14000);
  assert.equal(reading.mixed, true);
  assert.equal(reading.asOf, '2026-11-18');
  const supplyOnly = buildDprValueToDate({ items, entries, plan, range, scope: 'Supply', settings, today: '2026-11-18' });
  assert.deepEqual(supplyOnly, { asOf: '2026-11-14', mixed: false, plannedValue: 14000, actualValue: 14000 });
});
