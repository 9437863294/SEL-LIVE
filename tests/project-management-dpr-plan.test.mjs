import assert from 'node:assert/strict';
import test from 'node:test';

const plan = await import('../src/lib/project-management-dpr-plan.ts');
const dpr = await import('../src/lib/project-management-dpr.ts');

const {
  allocateProjection,
  boqLimit,
  buildDprBoard,
  buildDprLookAhead,
  buildDprPlan,
  buildDprShareTrend,
  checkDprProjection,
  checkDprSheet,
  defaultDprSettings,
  dprCalendar,
  dprProjectDates,
  dprUnitDecimals,
  fitsUnitPrecision,
  indexDprActuals,
  openPlanQty,
  parsePastedQuantities,
  previousPeriodRange,
  sanitizeDprSettings,
  unplannedBalance,
} = plan;
const { validateDprEntry, validateDprTarget } = dpr;

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const settings = (over = {}) => ({ ...defaultDprSettings(), ...over });
const sum = (map) => Math.round([...map.values()].reduce((a, b) => a + b, 0) * 1e6) / 1e6;
const round = (value, places = 6) => Math.round(value * 10 ** places) / 10 ** places;

const target = (over = {}) => ({
  id: 't-month',
  scope: 'Civil',
  boqItemId: 'pcc',
  boqSlNo: '2.2',
  description: 'PCC M10',
  unit: 'Cum',
  periodType: 'Month',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  plannedQty: 20,
  ...over,
});

const entry = (date, scope, lines, extra = {}) => ({
  id: `${scope}-${date}`,
  scope,
  date,
  status: 'Submitted',
  lines: lines.map((line, index) => ({ id: `l${index}`, boqSlNo: '', description: '', unit: '', plannedQty: 0, ...line })),
  manpower: [],
  equipment: [],
  ...extra,
});

const items = [
  { id: 'pcc', scope: 'Civil', boqSlNo: '2.2', erpSlNo: '9', description: 'PCC M10', unit: 'Cum', boqQty: 100, rate: 5000 },
  { id: 'rwh', scope: 'Civil', boqSlNo: '5', erpSlNo: '20', description: 'Rain water harvesting', unit: 'Nos', boqQty: 60, rate: 20000 },
  { id: 'tower', scope: 'Erection', boqSlNo: '7.1', erpSlNo: '30', description: 'Tower erection', unit: 'MT', boqQty: 500, rate: 0 },
];
const itemMap = new Map(items.map((item) => [item.id, item]));

const planFor = (targets, over = {}) => {
  const s = settings(over);
  const unitOf = new Map(items.map((item) => [item.id, item.unit]));
  return buildDprPlan(targets, {
    calendar: dprCalendar(s),
    decimalsFor: (t) => dprUnitDecimals(unitOf.get(t.boqItemId) || t.unit, s),
  });
};

/* ── Settings ───────────────────────────────────────────────────────────────────────────────── */

test('nothing stored reads as the defaults, which keep every day working', () => {
  const read = sanitizeDprSettings(undefined);
  assert.deepEqual(read, defaultDprSettings());
  assert.deepEqual(read.weeklyOff, []);
  assert.equal(read.backdateDays, 2);
  assert.equal(read.shiftHours, 8);
  assert.equal(read.spikeMultiple, 3);
  assert.equal(read.tolerancePct, 0);
  // Fresh objects every time, so one screen's edit never leaks into another's defaults.
  assert.notEqual(defaultDprSettings().weeklyOff, defaultDprSettings().weeklyOff);
});

test('numbers are clamped to their sensible range, and junk falls back to the default', () => {
  const read = sanitizeDprSettings({
    tolerancePct: 250,
    backdateDays: '3.6',
    shiftHours: 0,
    spikeMultiple: 'many',
  });
  assert.equal(read.tolerancePct, 100);
  assert.equal(read.backdateDays, 4, 'whole days');
  assert.equal(read.shiftHours, 1);
  assert.equal(read.spikeMultiple, 3);
});

test('seven weekly offs leave nothing to plan on, so they read as none', () => {
  assert.deepEqual(sanitizeDprSettings({ weeklyOff: [0, 1, 2, 3, 4, 5, 6] }).weeklyOff, []);
  assert.deepEqual(sanitizeDprSettings({ weeklyOff: [6, 0, 0, 9, 'x', 1.5] }).weeklyOff, [0, 6]);
});

test('holidays are de-duplicated, invalid dates dropped, and sorted', () => {
  const read = sanitizeDprSettings({
    holidays: [
      { date: '2026-11-20', reason: 'Festival' },
      '2026-11-05',
      { date: '2026-11-20', reason: 'Again' },
      { date: '2026-02-31', reason: 'Not a date' },
    ],
  });
  assert.deepEqual(read.holidays, [
    { date: '2026-11-05', reason: '' },
    { date: '2026-11-20', reason: 'Festival' },
  ]);
});

test('an emptied weather list falls back, but an emptied whole-number list is kept', () => {
  const read = sanitizeDprSettings({ weatherOptions: ['  ', ''], wholeNumberUnits: [] });
  assert.deepEqual(read.weatherOptions, defaultDprSettings().weatherOptions);
  assert.deepEqual(read.wholeNumberUnits, []);
  assert.deepEqual(
    sanitizeDprSettings({ weatherOptions: ['Rain', 'rain', ' Fog '] }).weatherOptions,
    ['Rain', 'Fog'],
    'case-insensitive dedupe, trimmed',
  );
});

test('project dates: the DPR setting wins, else the project record, else blank', () => {
  assert.deepEqual(
    dprProjectDates({ startDate: '', endDate: '' }, { startDate: '2026-04-01', endDate: '2027-03-31' }),
    { startDate: '2026-04-01', endDate: '2027-03-31' },
  );
  assert.deepEqual(
    dprProjectDates({ startDate: '2026-05-01', endDate: '' }, { startDate: '2026-04-01', endDate: 'soon' }),
    { startDate: '2026-05-01', endDate: '' },
  );
});

/* ── Calendar and units ─────────────────────────────────────────────────────────────────────── */

test('the calendar honours weekly offs and holidays', () => {
  // 2026-11-01 is a Sunday.
  const cal = dprCalendar(settings({ weeklyOff: [0], holidays: [{ date: '2026-11-04', reason: '' }] }));
  assert.equal(cal.isWorkingDay('2026-11-01'), false, 'Sunday off');
  assert.equal(cal.isWorkingDay('2026-11-02'), true);
  assert.equal(cal.isWorkingDay('2026-11-04'), false, 'holiday');
  assert.equal(cal.isWorkingDay('not-a-date'), false);
  assert.deepEqual(cal.workingDays('2026-11-01', '2026-11-07'), [
    '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07',
  ]);
});

test('countable units are whole, everything else takes three decimals', () => {
  const s = settings();
  assert.equal(dprUnitDecimals('Nos', s), 0);
  assert.equal(dprUnitDecimals('nos.', s), 0, 'case and punctuation ignored');
  assert.equal(dprUnitDecimals('Cum', s), 3);
  assert.equal(dprUnitDecimals('', s), 3);
  assert.equal(dprUnitDecimals('Nos', settings({ wholeNumberUnits: [] })), 3, 'configurable');
  assert.equal(fitsUnitPrecision(2, 0), true);
  assert.equal(fitsUnitPrecision(2.5, 0), false);
  assert.equal(fitsUnitPrecision(0.667, 3), true);
  assert.equal(fitsUnitPrecision(0.6667, 3), false);
});

/* ── Spreading ──────────────────────────────────────────────────────────────────────────────── */

test('even, front and back spreads all sum to the projection exactly', () => {
  const cal = dprCalendar(settings());
  for (const distribution of ['even', 'front', 'back']) {
    const allocation = allocateProjection(target({ distribution }), cal, 3);
    assert.equal(allocation.size, 30);
    assert.equal(sum(allocation), 20, `${distribution} sums to 20`);
  }
  const front = allocateProjection(target({ distribution: 'front' }), cal, 3);
  const back = allocateProjection(target({ distribution: 'back' }), cal, 3);
  assert.ok(front.get('2026-11-01') > front.get('2026-11-30'), 'front-loaded starts heavy');
  assert.ok(back.get('2026-11-01') < back.get('2026-11-30'), 'back-loaded ends heavy');
});

test('a whole-number unit spreads as whole numbers that still add up', () => {
  const allocation = allocateProjection(target({ unit: 'Nos', plannedQty: 50 }), dprCalendar(settings()), 0);
  assert.equal(sum(allocation), 50);
  for (const qty of allocation.values()) assert.equal(Number.isInteger(qty), true);
  assert.deepEqual(new Set(allocation.values()), new Set([1, 2]));
});

test('only working days take a share', () => {
  const cal = dprCalendar(settings({ weeklyOff: [0] }));
  const allocation = allocateProjection(target({ plannedQty: 26 }), cal, 3);
  // November 2026 has five Sundays, so 25 working days.
  assert.equal(allocation.size, 25);
  assert.equal(allocation.has('2026-11-01'), false);
  assert.equal(sum(allocation), 26);
});

test('a period left with no working day keeps its quantity on every day', () => {
  const cal = dprCalendar(settings({ weeklyOff: [0] }));
  const allocation = allocateProjection(
    target({ startDate: '2026-11-01', endDate: '2026-11-01', plannedQty: 4 }),
    cal,
    3,
  );
  assert.deepEqual([...allocation], [['2026-11-01', 4]]);
});

/* ── The plan ───────────────────────────────────────────────────────────────────────────────── */

test('the shorter period owns the days it shares with a longer one', () => {
  const month = target({ unit: 'Nos', boqItemId: 'rwh', plannedQty: 50 });
  const week = target({
    id: 't-week',
    unit: 'Nos',
    boqItemId: 'rwh',
    periodType: 'Week',
    startDate: '2026-11-09',
    endDate: '2026-11-15',
    plannedQty: 21,
  });
  const p = planFor([month, week]);
  const weekRange = { startDate: '2026-11-09', endDate: '2026-11-15' };
  assert.equal(p.qtyInRange('rwh', weekRange), 21, 'the week, not the week plus the month');
  for (const day of p.daily('rwh').keys()) {
    if (day >= '2026-11-09' && day <= '2026-11-15') assert.equal(p.onDate('rwh', day), 3);
  }
  const monthOnly = planFor([month]);
  const monthShareOfWeek = monthOnly.qtyInRange('rwh', weekRange);
  assert.equal(
    p.qtyInRange('rwh', { startDate: '2026-11-01', endDate: '2026-11-30' }),
    50 - monthShareOfWeek + 21,
  );
  assert.equal(p.qtyInRange('rwh', { startDate: '2026-11-01', endDate: '2026-11-30' }), 59);
});

test('equal-length overlaps resolve the same way whatever order they load in', () => {
  const a = target({ id: 'a', periodType: 'Week', startDate: '2026-11-02', endDate: '2026-11-08', plannedQty: 7 });
  const b = target({ id: 'b', periodType: 'Custom', startDate: '2026-11-05', endDate: '2026-11-11', plannedQty: 14 });
  const one = planFor([a, b]);
  const two = planFor([b, a]);
  assert.deepEqual([...one.daily('pcc')], [...two.daily('pcc')]);
  // The later-starting one owns the shared days.
  assert.equal(one.onDate('pcc', '2026-11-05'), 2);
  assert.equal(one.onDate('pcc', '2026-11-04'), 1);
});

test('byItemInRange filters by scope and item, and open ranges are unbounded', () => {
  const p = planFor([
    target(),
    target({ id: 'e', scope: 'Erection', boqItemId: 'tower', unit: 'MT', plannedQty: 30 }),
  ]);
  const november = { startDate: '2026-11-01', endDate: '2026-11-30' };
  assert.deepEqual([...p.byItemInRange(november, { scope: 'Civil' }).keys()], ['pcc']);
  assert.deepEqual([...p.byItemInRange(november, { boqItemId: 'tower' }).keys()], ['tower']);
  assert.equal(p.byItemInRange(november).size, 2);
  assert.equal(p.qtyInRange('pcc', { startDate: '', endDate: '2026-11-15' }), 10);
  assert.equal(p.qtyInRange('pcc', { startDate: '2026-11-16', endDate: '' }), 10);
  assert.equal(p.byItemInRange({ startDate: '2026-12-01', endDate: '2026-12-31' }).size, 0, 'zero is left out');
});

test('a projection with an inverted or missing period is ignored', () => {
  const p = planFor([target({ startDate: '2026-11-30', endDate: '2026-11-01' }), target({ id: 'x', boqItemId: '' })]);
  assert.equal(p.daily('pcc').size, 0);
});

/* ── Actuals ────────────────────────────────────────────────────────────────────────────────── */

test('the actual index counts submitted sheets only, and can leave one sheet out', () => {
  const entries = [
    entry('2026-11-10', 'Civil', [{ boqItemId: 'pcc', actualQty: 2 }]),
    entry('2026-11-11', 'Civil', [{ boqItemId: 'pcc', actualQty: 3 }], { status: 'Draft' }),
    entry('2026-11-12', 'Civil', [{ boqItemId: 'pcc', actualQty: 4 }, { boqItemId: 'pcc', actualQty: 1, location: 'B' }]),
  ];
  const index = indexDprActuals(entries);
  assert.equal(index.total('pcc'), 7);
  assert.equal(index.onDate('pcc', '2026-11-12'), 5, 'two rows on one day add');
  assert.equal(index.hasSheet('Civil', '2026-11-11'), false, 'a draft is not a sheet in');
  assert.equal(index.hasSheet('Civil', '2026-11-12'), true);
  assert.equal(index.total('pcc', { startDate: '2026-11-11', endDate: '' }), 5);
  assert.equal(indexDprActuals(entries, { excludeEntryId: 'Civil-2026-11-12' }).total('pcc'), 2);
  assert.equal(indexDprActuals(entries, { includeDrafts: true }).total('pcc'), 10);
});

test('the open plan counts today only until today\'s sheet is in', () => {
  const daily = new Map([
    ['2026-11-12', 1],
    ['2026-11-13', 2],
    ['2026-11-14', 4],
  ]);
  assert.equal(openPlanQty(daily, '2026-11-13', false), 6);
  assert.equal(openPlanQty(daily, '2026-11-13', true), 4);
  assert.equal(round(boqLimit(100, { tolerancePct: 10 })), 110);
  assert.equal(boqLimit(0, { tolerancePct: 10 }), null);
});

/* ── Projection checks ──────────────────────────────────────────────────────────────────────── */

const TODAY = '2026-11-13';

const projectionCheck = (candidateOver = {}, over = {}) =>
  checkDprProjection({
    candidate: {
      scope: 'Civil',
      boqItemId: 'pcc',
      periodType: 'Week',
      startDate: '2026-11-16',
      endDate: '2026-11-22',
      plannedQty: 7,
      distribution: 'even',
      ...candidateOver,
    },
    item: { unit: 'Cum', boqQty: 100 },
    targets: [],
    actuals: indexDprActuals([]),
    settings: settings(),
    projectDates: { startDate: '', endDate: '' },
    today: TODAY,
    overlapPolicy: 'block',
    ...over,
  });

test('P1: quantity above zero, at the unit\'s precision', () => {
  assert.deepEqual(projectionCheck(), { errors: [], warnings: [] });
  assert.match(projectionCheck({ plannedQty: 0 }).errors.join(), /greater than zero/);
  assert.match(
    projectionCheck({ plannedQty: 2.5 }, { item: { unit: 'Nos', boqQty: 0 } }).errors.join(),
    /whole numbers/,
  );
  assert.match(projectionCheck({ plannedQty: 1.2345 }).errors.join(), /3 decimals/);
});

test('P2: an ended period is locked; one already under way is a warning', () => {
  assert.match(
    projectionCheck({ startDate: '2026-11-02', endDate: '2026-11-08' }).errors.join(),
    /already ended/,
  );
  const started = projectionCheck({ startDate: '2026-11-09', endDate: '2026-11-15' });
  assert.deepEqual(started.errors, []);
  assert.match(started.warnings.join(), /Starts before today/);
  assert.match(projectionCheck({ startDate: '', endDate: '' }).errors.join(), /valid period/);
});

test('P3: the period sits inside the project dates', () => {
  const dates = { startDate: '2026-11-18', endDate: '2026-11-20' };
  const errors = projectionCheck({}, { projectDates: dates }).errors.join(' ');
  assert.match(errors, /before the project start/);
  assert.match(errors, /past the project completion/);
});

test('P4: a period with no working day is refused', () => {
  const s = settings({ weeklyOff: [0] });
  // 2026-11-22 is a Sunday.
  assert.match(
    projectionCheck({ periodType: 'Day', startDate: '2026-11-22', endDate: '2026-11-22' }, { settings: s }).errors.join(),
    /No working days/,
  );
});

test('P5: an overlap blocks, or warns when the shorter period may take the days', () => {
  const existing = [target()];
  const blocked = projectionCheck({}, { targets: existing });
  assert.match(blocked.errors.join(), /Overlaps Month 01 Nov – 30 Nov \(20 Cum\)/);
  const finer = projectionCheck({}, { targets: existing, overlapPolicy: 'finer' });
  assert.deepEqual(finer.errors, []);
  assert.match(finer.warnings.join(), /shorter period takes the shared days/);
  // Another BOQ line's projection is not an overlap.
  assert.deepEqual(projectionCheck({}, { targets: [target({ boqItemId: 'rwh' })] }).errors, []);
});

test('P6: the open plan cannot pass BOQ plus tolerance, less what is executed', () => {
  const actuals = indexDprActuals([entry('2026-11-10', 'Civil', [{ boqItemId: 'pcc', actualQty: 95 }])]);
  const over = projectionCheck({ plannedQty: 7 }, { actuals });
  assert.match(over.errors.join(), /Exceeds the balance: open plan 7 against 5 Cum left/);
  const withTolerance = projectionCheck({ plannedQty: 7 }, { actuals, settings: settings({ tolerancePct: 5 }) });
  assert.deepEqual(withTolerance.errors, [], '5 left + 5% of 100 = 10 left');
  // The existing month's open plan counts too.
  const crowded = projectionCheck(
    { plannedQty: 3 },
    { actuals, targets: [target({ boqItemId: 'pcc' })], overlapPolicy: 'finer' },
  );
  assert.match(crowded.errors.join(), /Exceeds the balance/);
  // No BOQ quantity, no balance check.
  assert.deepEqual(projectionCheck({ plannedQty: 500 }, { item: { unit: 'Cum', boqQty: 0 } }).errors, []);
});

test('revising keeps the period, so overlaps are not re-checked but the balance is', () => {
  const month = target();
  const week = target({ id: 'w', periodType: 'Week', startDate: '2026-11-16', endDate: '2026-11-22', plannedQty: 7 });
  const result = checkDprProjection({
    candidate: { ...week, plannedQty: 9, distribution: 'even' },
    item: { unit: 'Cum', boqQty: 100 },
    targets: [month, week],
    actuals: indexDprActuals([]),
    settings: settings(),
    projectDates: { startDate: '2026-12-01', endDate: '' },
    today: TODAY,
    overlapPolicy: 'block',
    revising: week,
  });
  assert.deepEqual(result, { errors: [], warnings: [] });
  const ended = checkDprProjection({
    candidate: { ...month, startDate: '2026-10-01', endDate: '2026-10-31', distribution: 'even' },
    item: { unit: 'Cum', boqQty: 0 },
    targets: [],
    actuals: indexDprActuals([]),
    settings: settings(),
    projectDates: { startDate: '', endDate: '' },
    today: TODAY,
    overlapPolicy: 'block',
    revising: { ...month, startDate: '2026-10-01', endDate: '2026-10-31' },
  });
  assert.match(ended.errors.join(), /period has ended/);
});

/* ── Sheet checks ───────────────────────────────────────────────────────────────────────────── */

const sheetPlan = planFor([target({ plannedQty: 30 })]); // 1 Cum a day on pcc

const sheet = (over = {}) => ({
  scope: 'Civil',
  date: '2026-11-12',
  weather: 'Clear',
  lines: [{ boqItemId: 'pcc', actual: '1', location: '', remarks: '' }],
  manpower: [{ trade: 'Mason', count: 4 }],
  equipment: [],
  lostTimeHours: '',
  lostTimeReason: '',
  hindrances: '',
  ...over,
});

const sheetCheck = (sheetOver = {}, over = {}) =>
  checkDprSheet({
    sheet: sheet(sheetOver),
    items: itemMap,
    plan: sheetPlan,
    actuals: indexDprActuals([]),
    settings: settings(),
    projectDates: { startDate: '', endDate: '' },
    today: TODAY,
    canRecordAnyDate: false,
    ...over,
  });

test('a complete sheet passes clean', () => {
  assert.deepEqual(sheetCheck(), { errors: [], warnings: [] });
});

test('D1: no future dates, and backdating past the limit needs an approver', () => {
  assert.match(sheetCheck({ date: '2026-11-14' }).errors.join(), /Future dates/);
  assert.deepEqual(sheetCheck({ date: '2026-11-11' }).errors, [], 'two days back is allowed');
  assert.match(sheetCheck({ date: '2026-11-10' }).errors.join(), /more than 2 days back/);
  assert.deepEqual(sheetCheck({ date: '2026-11-10' }, { canRecordAnyDate: true }).errors, []);
  assert.match(sheetCheck({ date: '2026-02-31' }).errors.join(), /Pick the date/);
});

test('project dates and the calendar are checked against the sheet date', () => {
  const dates = { startDate: '2026-11-13', endDate: '2026-11-11' };
  const result = sheetCheck({}, { projectDates: dates });
  assert.match(result.errors.join(), /before the project start/);
  assert.match(result.warnings.join(), /after the project completion/);
  // 2026-11-08 is a Sunday.
  const sunday = sheetCheck(
    { date: '2026-11-08', lines: [{ boqItemId: 'pcc', actual: '1' }] },
    { settings: settings({ weeklyOff: [0] }), canRecordAnyDate: true },
  );
  assert.match(sunday.warnings.join(), /non-working day/);
});

test('D3/D4: weather, a BOQ line, and an actual on every row', () => {
  assert.match(sheetCheck({ weather: '' }).errors.join(), /Select the weather/);
  assert.match(sheetCheck({ lines: [] }).errors.join(), /at least one BOQ line/);
  assert.match(sheetCheck({ lines: [{ boqItemId: '', actual: '1' }] }).errors.join(), /Row 1: choose a BOQ line/);
  assert.match(sheetCheck({ lines: [{ boqItemId: 'pcc', actual: '' }] }).errors.join(), /enter the actual quantity/);
  assert.match(sheetCheck({ lines: [{ boqItemId: 'pcc', actual: '-1' }] }).errors.join(), /zero or more/);
  assert.match(sheetCheck({ lines: [{ boqItemId: 'pcc', actual: 'abc' }] }).errors.join(), /zero or more/);
  assert.match(
    sheetCheck({ lines: [{ boqItemId: 'rwh', actual: '1.5' }] }).errors.join(),
    /5: Nos is counted in whole numbers/,
  );
});

test('D5: the same line twice only when the location differs', () => {
  const twice = sheetCheck({
    lines: [
      { boqItemId: 'pcc', actual: '1', location: 'Bay 1' },
      { boqItemId: 'pcc', actual: '1', location: ' bay 1 ' },
    ],
  });
  assert.match(twice.errors.join(), /entered twice for the same location/);
  const apart = sheetCheck({
    lines: [
      { boqItemId: 'pcc', actual: '1', location: 'Bay 1' },
      { boqItemId: 'pcc', actual: '1', location: 'Bay 2' },
    ],
  });
  assert.deepEqual(apart.errors, []);
});

test('D6: planned but nothing done needs a row remark or a hindrance', () => {
  const zero = [{ boqItemId: 'pcc', actual: '0', remarks: '' }];
  assert.match(sheetCheck({ lines: zero, manpower: [] }).errors.join(), /was planned but nothing was done/);
  assert.deepEqual(sheetCheck({ lines: [{ ...zero[0], remarks: 'Shuttering' }], manpower: [] }).errors, []);
  assert.deepEqual(sheetCheck({ lines: zero, manpower: [], hindrances: 'No cement' }).errors, []);
});

test('D7: a spike over the plan, or work on an unplanned line, asks for confirmation', () => {
  const spike = sheetCheck({ lines: [{ boqItemId: 'pcc', actual: '3.5' }] });
  assert.deepEqual(spike.errors, []);
  assert.match(spike.warnings.join(), /more than 3× the day’s plan of 1/);
  const unplanned = sheetCheck({ lines: [{ boqItemId: 'rwh', actual: '2' }] });
  assert.match(unplanned.warnings.join(), /no quantity was planned for this day/);
});

test('D8: cumulative actual cannot pass BOQ plus tolerance', () => {
  const actuals = indexDprActuals([entry('2026-11-10', 'Civil', [{ boqItemId: 'pcc', actualQty: 99.5 }])]);
  const over = sheetCheck({}, { actuals });
  assert.match(over.errors.join(), /cumulative 100\.5 Cum would exceed the BOQ quantity of 100/);
  assert.deepEqual(sheetCheck({}, { actuals, settings: settings({ tolerancePct: 1 }) }).errors, []);
});

test('D9: work needs manpower, counted in whole heads', () => {
  assert.match(sheetCheck({ manpower: [] }).errors.join(), /add the manpower that did it/);
  assert.match(sheetCheck({ manpower: [{ trade: 'Mason', count: 2.5 }] }).errors.join(), /whole number above zero/);
  assert.match(sheetCheck({ manpower: [{ trade: '', count: 3 }] }).errors.join(), /name the trade/);
  // An untouched row is ignored rather than flagged.
  assert.deepEqual(sheetCheck({ manpower: [{ trade: 'Mason', count: 4 }, { trade: '', count: '' }] }).errors, []);
});

test('D10: equipment hours and lost time stay within the day and the shift', () => {
  assert.match(
    sheetCheck({ equipment: [{ name: 'JCB', deployed: 1, runningHours: 20, idleHours: 6 }] }).errors.join(),
    /more than 24 a day/,
  );
  assert.deepEqual(
    sheetCheck({ equipment: [{ name: 'JCB', deployed: 2, runningHours: 30, idleHours: 6 }] }).errors,
    [],
    'two units may log 48 hours between them',
  );
  assert.match(sheetCheck({ equipment: [{ name: '', deployed: 1, runningHours: 4 }] }).errors.join(), /name the equipment/);
  assert.match(sheetCheck({ equipment: [{ name: 'Mixer', deployed: 1, runningHours: -1 }] }).errors.join(), /cannot be negative/);
  assert.match(sheetCheck({ equipment: [{ name: 'Mixer', deployed: 1.5 }] }).errors.join(), /whole number/);
  assert.match(sheetCheck({ lostTimeHours: '9' }).errors.join(), /between 0 and the 8-hour shift/);
  assert.match(sheetCheck({ lostTimeHours: '2' }).errors.join(), /reason for the time lost/);
  assert.deepEqual(sheetCheck({ lostTimeHours: '2', lostTimeReason: 'Rain' }).errors, []);
});

/* ── Board ──────────────────────────────────────────────────────────────────────────────────── */

const boardInput = (over = {}) => ({
  items,
  entries: [],
  plan: planFor([target({ plannedQty: 30 }), target({ id: 'r', boqItemId: 'rwh', unit: 'Nos', plannedQty: 30 })]),
  settings: settings(),
  range: { startDate: '2026-11-09', endDate: '2026-11-15' },
  today: TODAY,
  ...over,
});

test('the board marks lines behind, on plan, not due and unplanned', () => {
  const entries = [
    entry('2026-11-12', 'Civil', [
      { boqItemId: 'pcc', actualQty: 2 },
      { boqItemId: 'rwh', actualQty: 6 },
    ]),
    entry('2026-11-12', 'Erection', [{ boqItemId: 'tower', actualQty: 4 }]),
  ];
  const board = buildDprBoard(boardInput({ entries }));
  const byId = new Map(board.rows.map((row) => [row.item.id, row]));
  assert.equal(byId.get('pcc').planToDate, 5, '9th to 13th');
  assert.equal(byId.get('pcc').status, 'behind');
  assert.equal(byId.get('rwh').status, 'on-plan');
  assert.equal(byId.get('tower').status, 'unplanned');
  assert.equal(byId.get('pcc').fullPlan, 7);
  assert.equal(byId.get('pcc').balance, 5);
  // 13th (no Civil sheet yet), 14th and 15th.
  assert.equal(byId.get('pcc').daysLeft, 3);
  assert.equal(round(byId.get('pcc').neededPerDay), round(5 / 3));
  assert.equal(board.stats.linesBehind, 1);
  assert.equal(board.stats.linesWorked, 3);
  assert.equal(board.stats.daysReported, 1);
  assert.equal(board.stats.workingDaysElapsed, 5);
  assert.equal(board.stats.workingDaysInPeriod, 7);

  const notDue = buildDprBoard(boardInput({ range: { startDate: '2026-11-16', endDate: '2026-11-22' } }));
  assert.equal(notDue.rows.every((row) => row.status === 'not-due'), true);
  assert.equal(notDue.stats.achievementToDatePct, null);
});

test('today stops counting as a day left once that scope has filed', () => {
  const entries = [entry(TODAY, 'Civil', [{ boqItemId: 'pcc', actualQty: 1 }])];
  const row = buildDprBoard(boardInput({ entries })).rows.find((candidate) => candidate.item.id === 'pcc');
  assert.equal(row.daysLeft, 2);
});

test('achievement is value-weighted when every line has a rate, else averaged', () => {
  const entries = [entry('2026-11-12', 'Civil', [{ boqItemId: 'pcc', actualQty: 5 }, { boqItemId: 'rwh', actualQty: 0 }])];
  const civil = buildDprBoard(boardInput({ entries, scope: 'Civil' }));
  assert.equal(civil.stats.basis, 'value');
  // pcc 5 Cum × 5000 done of 5 × 5000 due; rwh 0 of 5 × 20000 due.
  assert.equal(round(civil.stats.achievementToDatePct), round((25000 / (25000 + 100000)) * 100));

  const unpriced = items.map((item) => (item.id === 'rwh' ? { ...item, rate: 0 } : item));
  const averaged = buildDprBoard(boardInput({ entries, items: unpriced, scope: 'Civil' }));
  assert.equal(averaged.stats.basis, 'average');
  assert.equal(round(averaged.stats.achievementToDatePct), 50);
});

test('the curve runs the whole period and stops the actual at today', () => {
  const board = buildDprBoard(boardInput({ scope: 'Civil' }));
  assert.equal(board.curve.length, 7);
  assert.equal(board.curve.at(-1).plannedPct, 100);
  assert.equal(board.curve.find((point) => point.date === TODAY).actualPct, 0);
  assert.equal(board.curve.find((point) => point.date === '2026-11-14').actualPct, null);
  assert.deepEqual(buildDprBoard(boardInput({ range: { startDate: 'x', endDate: '' } })).rows, []);
});

/* ── Look-ahead, trend, helpers ─────────────────────────────────────────────────────────────── */

test('the look-ahead runs six weeks from last week, with work done for started weeks', () => {
  const entries = [entry('2026-11-04', 'Civil', [{ boqItemId: 'pcc', actualQty: 2 }])];
  const { weeks, rows } = buildDprLookAhead({
    items,
    entries,
    plan: planFor([target({ plannedQty: 30 })]),
    today: TODAY,
  });
  assert.equal(weeks.length, 6);
  assert.equal(weeks[0].startDate, '2026-11-02');
  assert.equal(weeks[1].isCurrent, true);
  assert.equal(weeks[0].ended, true);
  assert.equal(weeks[2].started, false);
  assert.equal(rows.length, 1, 'only lines with plan or work in the window');
  assert.equal(rows[0].cells[0].planned, 7);
  assert.equal(rows[0].cells[0].done, 2);
  assert.equal(rows[0].cells[2].done, null);
  assert.equal(rows[0].cells[4].planned, 1, 'the week of 30 Nov carries only 30 Nov');
  assert.equal(rows[0].cells[5].planned, 0, 'December is not planned');
});

test('the share trend reads plan and actual as shares of the range plan', () => {
  const entries = [entry('2026-11-03', 'Civil', [{ boqItemId: 'pcc', actualQty: 7 }])];
  const { basis, points } = buildDprShareTrend({
    items,
    entries,
    plan: planFor([target({ plannedQty: 30 })]),
    range: { startDate: '2026-11-01', endDate: '2026-11-30' },
    periodType: 'Week',
    scope: 'Civil',
  });
  assert.equal(basis, 'value');
  assert.equal(round(points.at(-1).cumulativePlannedPct), 100);
  assert.equal(round(points.reduce((total, point) => total + point.plannedPct, 0)), 100);
  assert.equal(round(points[1].actualPct, 3), round((7 / 30) * 100, 3));
});

test('the previous period is the previous month, or the same length earlier', () => {
  assert.deepEqual(previousPeriodRange('Month', { startDate: '2026-03-01', endDate: '2026-03-31' }), {
    startDate: '2026-02-01',
    endDate: '2026-02-28',
  });
  assert.deepEqual(previousPeriodRange('Week', { startDate: '2026-11-09', endDate: '2026-11-15' }), {
    startDate: '2026-11-02',
    endDate: '2026-11-08',
  });
  assert.deepEqual(previousPeriodRange('Custom', { startDate: '2026-11-11', endDate: '2026-11-20' }), {
    startDate: '2026-11-01',
    endDate: '2026-11-10',
  });
});

test('the unplanned balance is BOQ plus tolerance, less executed, less still planned', () => {
  const actuals = indexDprActuals([entry('2026-11-10', 'Civil', [{ boqItemId: 'pcc', actualQty: 10 }])]);
  const p = planFor([target({ plannedQty: 30 })]);
  // Open plan from the 13th (no sheet yet today): 18 days × 1.
  assert.equal(unplannedBalance({ item: items[0], plan: p, actuals, settings: settings(), today: TODAY }), 72);
  assert.equal(
    unplannedBalance({ item: { ...items[0], boqQty: 0 }, plan: p, actuals, settings: settings(), today: TODAY }),
    null,
  );
});

test('pasted rows take the first cell as the BOQ number and the last as the quantity', () => {
  assert.deepEqual(parsePastedQuantities('BOQ No\tQty\n2.2\tPCC M10\t4.5\n5, 3\n7 12\n\n9  1,250'), [
    { key: '2.2', qty: 4.5 },
    { key: '5', qty: 3 },
    { key: '7', qty: 12 },
    { key: '9', qty: 1250 },
  ]);
  assert.deepEqual(parsePastedQuantities(''), []);
});

/* ── Main-lib rules the redesign changed ────────────────────────────────────────────────────── */

const draftEntry = (lines) => ({
  scope: 'Civil',
  date: '2026-11-12',
  status: 'Submitted',
  lines,
  manpower: [],
  equipment: [],
});
const line = (over) => ({ id: 'x', boqItemId: 'pcc', boqSlNo: '2.2', description: '', unit: 'Cum', plannedQty: 0, actualQty: 1, ...over });

test('validateDprEntry allows the same BOQ line twice only at different locations', () => {
  assert.equal(
    validateDprEntry(draftEntry([line({ id: 'a', location: 'Bay 1' }), line({ id: 'b', location: 'Bay 2' })])).length,
    0,
  );
  const same = validateDprEntry(draftEntry([line({ id: 'a', location: 'Bay 1' }), line({ id: 'b', location: 'bay 1' })]));
  assert.equal(same.some((error) => error.message.includes('twice')), true);
});

test('validateDprTarget accepts a custom range and a known spread only', () => {
  const draft = {
    scope: 'Civil',
    boqItemId: 'pcc',
    boqSlNo: '2.2',
    description: '',
    unit: 'Cum',
    periodType: 'Custom',
    startDate: '2026-11-11',
    endDate: '2026-11-20',
    plannedQty: 5,
    distribution: 'back',
  };
  assert.deepEqual(validateDprTarget(draft), []);
  assert.equal(validateDprTarget({ ...draft, periodType: 'Year' }).some((e) => e.field === 'periodType'), true);
  assert.equal(validateDprTarget({ ...draft, distribution: 'random' }).some((e) => e.field === 'distribution'), true);
});

/* ── The Civil hub reads the same engine ────────────────────────────────────────────────────── */

test('the Civil hub uses the engine when given it, so overlaps are not double-counted there', async () => {
  const civil = await import('../src/lib/project-management-civil-progress.ts');
  const lines = civil.buildCivilBoqLines([
    { id: 'pcc', 'Scope 1': 'Switchyard', 'Scope 2': 'Civil', 'BOQ SL No': '2.2', Description: 'PCC', Unit: 'Cum', QTY: 100, 'Budget Price': 1000 },
  ]);
  const targets = [
    target({ plannedQty: 30 }),
    target({ id: 'w', periodType: 'Week', startDate: '2026-11-09', endDate: '2026-11-15', plannedQty: 14 }),
  ];
  const input = { lines, entries: [], targets, jmcEntries: [], today: '2026-11-30' };
  const plain = civil.buildCivilHeadline(input);
  const engine = civil.buildCivilHeadline({ ...input, plan: planFor(targets) });
  // Plain: 30 + 14 added. Engine: the week replaces the month's 7 for those days → 37.
  assert.equal(round(plain.plannedToDateValue), 44 * 1000);
  assert.equal(round(engine.plannedToDateValue), 37 * 1000);
  const curve = civil.buildCivilProgressCurve({
    lines,
    entries: [],
    targets,
    certifiedEvents: [],
    periodType: 'Month',
    range: { startDate: '2026-11-01', endDate: '2026-11-30' },
    plan: planFor(targets),
  });
  assert.equal(round(curve.at(-1).plannedValue), 37 * 1000);
  const plainCurve = civil.buildCivilProgressCurve({
    lines,
    entries: [],
    targets,
    certifiedEvents: [],
    periodType: 'Month',
    range: { startDate: '2026-11-01', endDate: '2026-11-30' },
  });
  assert.equal(round(plainCurve.at(-1).plannedValue), 44 * 1000, 'without the engine, overlaps still add');
});
