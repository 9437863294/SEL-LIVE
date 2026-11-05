import assert from 'node:assert/strict';
import test from 'node:test';

const {
  addDays,
  aggregateActualsByBoqItem,
  bucketsInRange,
  buildDprEquipmentSummary,
  buildDprHeadline,
  buildDprLostTime,
  buildDprManpowerSummary,
  buildDprPeriodReport,
  buildDprTrend,
  dailyPlannedByBoqItem,
  daysInRange,
  dprPeriodReportCsv,
  eachDayInRange,
  endOfMonth,
  formatPeriodLabel,
  overlapDays,
  overlappingTargets,
  parseIsoDate,
  periodRangeFor,
  plannedQtyByBoqItem,
  startOfWeek,
  targetQtyInRange,
  validateDprEntry,
  validateDprTarget,
} = await import('../src/lib/project-management-dpr.ts');

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const boqItems = [
  { id: 'civil-1', boqSlNo: '1.1', erpSlNo: '2', description: 'Excavation in ordinary soil', unit: 'Cum', boqQty: 1000 },
  { id: 'civil-2', boqSlNo: '2.2', erpSlNo: '9', description: 'PCC 1:4:8 foundation', unit: 'Cum', boqQty: 200 },
  { id: 'erect-1', boqSlNo: '5.1', erpSlNo: '20', description: 'Tower erection', unit: 'MT', boqQty: 500 },
];

const entry = (date, scope, lines, extra = {}) => ({
  id: `${scope}-${date}`,
  scope,
  date,
  status: 'Submitted',
  lines: lines.map((line, index) => ({ id: `l${index}`, boqSlNo: '', description: '', unit: '', ...line })),
  manpower: [],
  equipment: [],
  ...extra,
});

const target = (over) => ({
  id: 't1',
  scope: 'Civil',
  boqItemId: 'civil-1',
  boqSlNo: '1.1',
  description: 'Excavation',
  unit: 'Cum',
  periodType: 'Day',
  startDate: '2026-11-02',
  endDate: '2026-11-02',
  plannedQty: 40,
  ...over,
});

/* ── Dates ──────────────────────────────────────────────────────────────────────────────────── */

test('ISO dates parse as local midnight and reject impossible days', () => {
  assert.equal(parseIsoDate('2026-11-05')?.getDate(), 5);
  assert.equal(parseIsoDate('2026-11-05')?.getMonth(), 10);
  assert.equal(parseIsoDate('2026-02-31'), null, 'Date would roll 31 Feb forward to March');
  assert.equal(parseIsoDate('2026-13-01'), null);
  assert.equal(parseIsoDate('05-11-2026'), null);
  assert.equal(parseIsoDate(null), null);
});

test('week starts on Monday and month ranges cover the whole month', () => {
  // 2026-11-05 is a Thursday.
  assert.equal(startOfWeek('2026-11-05'), '2026-11-02');
  assert.equal(startOfWeek('2026-11-02'), '2026-11-02', 'Monday is its own week start');
  assert.equal(startOfWeek('2026-11-08'), '2026-11-02', 'Sunday belongs to the week that began Monday');
  assert.deepEqual(periodRangeFor('Week', '2026-11-05'), { startDate: '2026-11-02', endDate: '2026-11-08' });
  assert.deepEqual(periodRangeFor('Month', '2026-11-05'), { startDate: '2026-11-01', endDate: '2026-11-30' });
  assert.deepEqual(periodRangeFor('Day', '2026-11-05'), { startDate: '2026-11-05', endDate: '2026-11-05' });
  assert.equal(endOfMonth('2026-02-10'), '2026-02-28');
  assert.equal(endOfMonth('2028-02-10'), '2028-02-29', 'leap year');
});

test('day counts are inclusive and an inverted range counts zero', () => {
  assert.equal(daysInRange('2026-11-05', '2026-11-05'), 1);
  assert.equal(daysInRange('2026-11-02', '2026-11-08'), 7);
  assert.equal(daysInRange('2026-11-08', '2026-11-02'), 0);
  assert.equal(daysInRange('2026-11-01', '2026-11-30'), 30);
  assert.equal(eachDayInRange('2026-11-02', '2026-11-04').join(), '2026-11-02,2026-11-03,2026-11-04');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01', 'crosses the month');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01', 'crosses the year');
});

test('day arithmetic survives a daylight-saving style month and overlap is inclusive', () => {
  assert.equal(daysInRange('2026-03-01', '2026-03-31'), 31);
  assert.equal(
    overlapDays({ startDate: '2026-11-01', endDate: '2026-11-30' }, { startDate: '2026-11-02', endDate: '2026-11-08' }),
    7,
  );
  assert.equal(
    overlapDays({ startDate: '2026-11-01', endDate: '2026-11-05' }, { startDate: '2026-11-05', endDate: '2026-11-09' }),
    1,
    'touching at one day is an overlap of one day, not zero',
  );
  assert.equal(
    overlapDays({ startDate: '2026-11-01', endDate: '2026-11-04' }, { startDate: '2026-11-05', endDate: '2026-11-09' }),
    0,
  );
});

test('a blank range bound means unbounded, so a cumulative question needs no sentinel date', () => {
  const november = { startDate: '2026-11-01', endDate: '2026-11-30' };
  // "Everything up to 10 Nov" — the 10 days of November that have happened.
  assert.equal(overlapDays(november, { startDate: '', endDate: '2026-11-10' }), 10);
  // "Everything from 20 Nov onwards".
  assert.equal(overlapDays(november, { startDate: '2026-11-20', endDate: '' }), 11);
  // A range unbounded at both ends is "all time", so it contains the other range entirely.
  assert.equal(overlapDays(november, { startDate: '', endDate: '' }), 30);
  // Both unbounded on the *same* side is the one case with no finite overlap to measure.
  assert.equal(overlapDays({ startDate: '', endDate: '2026-11-30' }, { startDate: '', endDate: '2026-11-10' }), 0);
  // A bound that was given but cannot be read is an error, not an invitation to assume.
  assert.equal(overlapDays(november, { startDate: '', endDate: '10-11-2026' }), 0);
});

test('a cumulative projection total needs no lower bound', () => {
  const monthly = target({ periodType: 'Month', startDate: '2026-11-01', endDate: '2026-11-30', plannedQty: 600 });
  // 10 of 30 days elapsed.
  assert.equal(targetQtyInRange(monthly, { startDate: '', endDate: '2026-11-10' }), 200);
});

test('buckets step by granularity and always include the end date bucket', () => {
  assert.deepEqual(bucketsInRange('Day', '2026-11-02', '2026-11-05'), [
    '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05',
  ]);
  assert.deepEqual(bucketsInRange('Week', '2026-11-03', '2026-11-17'), [
    '2026-11-02', '2026-11-09', '2026-11-16',
  ], 'a mid-week start is bucketed from its Monday');
  assert.deepEqual(bucketsInRange('Month', '2026-11-15', '2027-01-04'), [
    '2026-11-01', '2026-12-01', '2027-01-01',
  ], 'month stepping crosses the year end');
  assert.deepEqual(bucketsInRange('Day', '2026-11-05', '2026-11-01'), [], 'inverted range yields nothing');
  assert.equal(formatPeriodLabel('Month', '2026-11-01'), 'Nov 2026');
  assert.equal(formatPeriodLabel('Week', '2026-11-02'), 'Wk 02 Nov');
  assert.equal(formatPeriodLabel('Day', '2026-11-05'), '05 Nov 2026');
});

/* ── Projections pro-rate across granularities ──────────────────────────────────────────────── */

test('a projection is pro-rated by day, so a month answers a week', () => {
  const monthly = target({ periodType: 'Month', startDate: '2026-11-01', endDate: '2026-11-30', plannedQty: 600 });
  assert.equal(targetQtyInRange(monthly, { startDate: '2026-11-01', endDate: '2026-11-30' }), 600);
  // 7 of 30 days.
  assert.equal(targetQtyInRange(monthly, { startDate: '2026-11-02', endDate: '2026-11-08' }), 140);
  assert.equal(targetQtyInRange(monthly, { startDate: '2026-11-05', endDate: '2026-11-05' }), 20);
  assert.equal(targetQtyInRange(monthly, { startDate: '2026-12-01', endDate: '2026-12-31' }), 0);
});

test('a part-overlapping projection contributes only its overlapping days', () => {
  const weekly = target({ periodType: 'Week', startDate: '2026-11-02', endDate: '2026-11-08', plannedQty: 70 });
  // Asking about Fri–Sun of that week: 3 of 7 days.
  assert.equal(targetQtyInRange(weekly, { startDate: '2026-11-06', endDate: '2026-11-12' }), 30);
});

test('overlapping projections add up, and per-item totals are keyed by BOQ item', () => {
  const targets = [
    target({ id: 'm', periodType: 'Month', startDate: '2026-11-01', endDate: '2026-11-30', plannedQty: 600 }),
    target({ id: 'catchup', periodType: 'Day', startDate: '2026-11-05', endDate: '2026-11-05', plannedQty: 15 }),
    target({ id: 'other', boqItemId: 'civil-2', periodType: 'Day', startDate: '2026-11-05', endDate: '2026-11-05', plannedQty: 8 }),
    target({ id: 'erect', scope: 'Erection', boqItemId: 'erect-1', periodType: 'Day', startDate: '2026-11-05', endDate: '2026-11-05', plannedQty: 5 }),
  ];
  const daily = dailyPlannedByBoqItem(targets, '2026-11-05', { scope: 'Civil' });
  assert.equal(daily.get('civil-1'), 35, '20 from the month plus the 15 catch-up');
  assert.equal(daily.get('civil-2'), 8);
  assert.equal(daily.get('erect-1'), undefined, 'the Erection projection is filtered out by scope');

  const week = plannedQtyByBoqItem(targets, { startDate: '2026-11-02', endDate: '2026-11-08' }, { scope: 'Civil' });
  assert.equal(week.get('civil-1'), 155, '140 pro-rated from the month plus the whole 15 catch-up');
});

test('a projection with an inverted or zero-length period contributes nothing', () => {
  const broken = target({ startDate: '2026-11-08', endDate: '2026-11-02', plannedQty: 100 });
  assert.equal(targetQtyInRange(broken, { startDate: '2026-11-01', endDate: '2026-11-30' }), 0);
});

/* ── Actuals ────────────────────────────────────────────────────────────────────────────────── */

test('drafts are excluded from totals unless asked for', () => {
  const entries = [
    entry('2026-11-03', 'Civil', [{ boqItemId: 'civil-1', plannedQty: 20, actualQty: 18 }]),
    { ...entry('2026-11-04', 'Civil', [{ boqItemId: 'civil-1', plannedQty: 20, actualQty: 25 }]), status: 'Draft' },
  ];
  assert.equal(aggregateActualsByBoqItem(entries).get('civil-1').actualQty, 18);
  assert.equal(aggregateActualsByBoqItem(entries, { includeDrafts: true }).get('civil-1').actualQty, 43);
});

test('actuals track worked days and the last worked date, ignoring zero-quantity lines', () => {
  const entries = [
    entry('2026-11-03', 'Civil', [{ boqItemId: 'civil-1', actualQty: 18 }]),
    entry('2026-11-04', 'Civil', [{ boqItemId: 'civil-1', actualQty: 0 }]),
    entry('2026-11-06', 'Civil', [{ boqItemId: 'civil-1', actualQty: 12 }]),
  ];
  const agg = aggregateActualsByBoqItem(entries).get('civil-1');
  assert.equal(agg.actualQty, 30);
  assert.equal(agg.workedDays, 2, 'a day with nothing done is not a worked day');
  assert.equal(agg.lastWorkedDate, '2026-11-06');
});

/* ── The period report ──────────────────────────────────────────────────────────────────────── */

const reportEntries = [
  entry('2026-10-30', 'Civil', [{ boqItemId: 'civil-1', plannedQty: 20, actualQty: 50 }]),
  entry('2026-11-03', 'Civil', [
    { boqItemId: 'civil-1', plannedQty: 20, actualQty: 18 },
    { boqItemId: 'civil-2', plannedQty: 10, actualQty: 12 },
  ]),
  entry('2026-11-05', 'Civil', [{ boqItemId: 'civil-1', plannedQty: 20, actualQty: 14 }]),
  entry('2026-11-05', 'Erection', [{ boqItemId: 'erect-1', plannedQty: 6, actualQty: 6 }]),
];

const reportTargets = [
  target({ id: 'm', periodType: 'Month', startDate: '2026-11-01', endDate: '2026-11-30', plannedQty: 600 }),
  target({ id: 'c2', boqItemId: 'civil-2', periodType: 'Week', startDate: '2026-11-02', endDate: '2026-11-08', plannedQty: 70 }),
];

test('the period report pro-rates projections and separates period from cumulative', () => {
  const report = buildDprPeriodReport({
    boqItems,
    entries: reportEntries,
    targets: reportTargets,
    range: { startDate: '2026-11-02', endDate: '2026-11-08' },
    scope: 'Civil',
  });
  const first = report.rows.find((row) => row.id === 'civil-1');
  assert.equal(first.plannedQty, 140, '7 of the month\'s 30 days');
  assert.equal(first.actualQty, 32, 'only the two days inside the week');
  assert.equal(first.varianceQty, -108);
  assert.equal(Math.round(first.achievementPct), 23);
  assert.equal(first.cumulativeQty, 82, 'includes the 50 booked before the period');
  assert.equal(Math.round(first.progressPct * 10) / 10, 8.2);
  assert.equal(first.balanceQty, 918);
  assert.equal(first.workedDays, 2);
  assert.equal(first.lastWorkedDate, '2026-11-05');
});

test('the report keeps only lines that were projected, worked, or already have progress', () => {
  const report = buildDprPeriodReport({
    boqItems,
    entries: reportEntries,
    targets: reportTargets,
    range: { startDate: '2026-11-02', endDate: '2026-11-08' },
    scope: 'Civil',
  });
  assert.deepEqual(report.rows.map((row) => row.id), ['civil-1', 'civil-2']);
  assert.equal(report.rows.some((row) => row.id === 'erect-1'), false, 'scope filter holds');
});

test('the worst shortfall against a real projection sorts first', () => {
  const report = buildDprPeriodReport({
    boqItems,
    entries: reportEntries,
    targets: reportTargets,
    range: { startDate: '2026-11-02', endDate: '2026-11-08' },
    scope: 'Civil',
  });
  assert.equal(report.rows[0].id, 'civil-1', '-108 is worse than civil-2\'s -58');
  assert.equal(report.totals.linesProjected, 2);
  assert.equal(report.totals.linesWorked, 2);
  assert.equal(report.totals.linesBehind, 2);
});

test('an unprojected line sorts after projected ones rather than looking like a win', () => {
  const report = buildDprPeriodReport({
    boqItems,
    entries: [entry('2026-11-03', 'Civil', [
      { boqItemId: 'civil-1', actualQty: 5 },
      { boqItemId: 'civil-2', actualQty: 5 },
    ])],
    targets: [target({ id: 'c2', boqItemId: 'civil-2', periodType: 'Week', startDate: '2026-11-02', endDate: '2026-11-08', plannedQty: 70 })],
    range: { startDate: '2026-11-02', endDate: '2026-11-08' },
    scope: 'Civil',
  });
  assert.equal(report.rows[0].id, 'civil-2', 'the projected shortfall leads');
  assert.equal(report.rows[1].achievementPct, null, 'nothing projected means no achievement ratio');
});

test('progress against a zero-quantity BOQ line is null, not a divide by zero', () => {
  const report = buildDprPeriodReport({
    boqItems: [{ id: 'x', boqSlNo: '9.9', description: 'Provisional', unit: 'LS', boqQty: 0 }],
    entries: [entry('2026-11-03', 'Civil', [{ boqItemId: 'x', actualQty: 3 }])],
    targets: [],
    range: { startDate: '2026-11-02', endDate: '2026-11-08' },
    scope: 'Civil',
  });
  assert.equal(report.rows[0].progressPct, null);
  assert.equal(report.rows[0].balanceQty, 0, 'balance never goes negative');
});

/* ── Trend ──────────────────────────────────────────────────────────────────────────────────── */

test('the trend reads at any granularity regardless of how projections were set', () => {
  const daily = buildDprTrend({
    entries: reportEntries,
    targets: reportTargets,
    periodType: 'Day',
    range: { startDate: '2026-11-02', endDate: '2026-11-05' },
    scope: 'Civil',
  });
  assert.deepEqual(daily.map((point) => point.bucketStart), [
    '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05',
  ]);
  // 20/day from the month + 10/day from the week-long civil-2 projection.
  assert.equal(daily[0].plannedQty, 30);
  assert.equal(daily[0].actualQty, 0);
  assert.equal(daily[1].actualQty, 30, '18 + 12 on the 3rd');
  assert.equal(daily[3].actualQty, 14);
  assert.equal(daily[3].cumulativeActualQty, 44, 'running total across the window');
  assert.equal(daily[3].cumulativePlannedQty, 120);
});

test('a part-bucket at the edge of the range is clipped, not counted whole', () => {
  // The range starts mid-week, so the first weekly bucket must cover only Wed–Sun.
  const weekly = buildDprTrend({
    entries: [],
    targets: [target({ id: 'm', periodType: 'Month', startDate: '2026-11-01', endDate: '2026-11-30', plannedQty: 600 })],
    periodType: 'Week',
    range: { startDate: '2026-11-04', endDate: '2026-11-15' },
    scope: 'Civil',
  });
  assert.equal(weekly[0].bucketStart, '2026-11-02');
  assert.equal(weekly[0].plannedQty, 100, '5 days × 20, not the full week\'s 140');
  assert.equal(weekly[1].plannedQty, 140, 'the middle week is whole');
});

test('the trend can follow a single BOQ item', () => {
  const points = buildDprTrend({
    entries: reportEntries,
    targets: reportTargets,
    periodType: 'Day',
    range: { startDate: '2026-11-03', endDate: '2026-11-03' },
    scope: 'Civil',
    boqItemId: 'civil-2',
  });
  assert.equal(points[0].actualQty, 12, 'civil-1\'s 18 is excluded');
  assert.equal(points[0].plannedQty, 10);
});

/* ── Site diary ─────────────────────────────────────────────────────────────────────────────── */

test('manpower rolls up to man-days, days present and peak strength', () => {
  const entries = [
    entry('2026-11-03', 'Civil', [], {
      manpower: [{ id: 'm1', trade: 'Mason', count: 10 }, { id: 'm2', trade: 'Helper', count: 20 }],
    }),
    entry('2026-11-04', 'Civil', [], {
      manpower: [{ id: 'm1', trade: 'Mason', count: 14 }, { id: 'm3', trade: '  ', count: 5 }],
    }),
  ];
  const rows = buildDprManpowerSummary(entries);
  assert.deepEqual(rows.map((row) => row.trade), ['Mason', 'Helper'], 'sorted by man-days');
  assert.equal(rows[0].manDays, 24);
  assert.equal(rows[0].daysPresent, 2);
  assert.equal(rows[0].peakCount, 14);
  assert.equal(rows.some((row) => row.trade === ''), false, 'blank trades are dropped');
});

test('equipment utilisation is running over running plus idle', () => {
  const entries = [
    entry('2026-11-03', 'Civil', [], {
      equipment: [{ id: 'e1', name: 'Excavator', deployed: 1, runningHours: 6, idleHours: 2 }],
    }),
    entry('2026-11-04', 'Civil', [], {
      equipment: [
        { id: 'e1', name: 'Excavator', deployed: 1, runningHours: 9, idleHours: 3 },
        { id: 'e2', name: 'Crane', deployed: 0, runningHours: 0, idleHours: 0 },
      ],
    }),
  ];
  const rows = buildDprEquipmentSummary(entries);
  const excavator = rows.find((row) => row.name === 'Excavator');
  assert.equal(excavator.deployedDays, 2);
  assert.equal(excavator.runningHours, 15);
  assert.equal(excavator.utilisationPct, 75);
  assert.equal(rows.find((row) => row.name === 'Crane').utilisationPct, null, 'no hours logged');
});

test('lost time lists only days that lost time, newest first', () => {
  const entries = [
    entry('2026-11-03', 'Civil', [], { lostTimeHours: 4, lostTimeReason: 'Heavy rain', weather: 'Rain' }),
    entry('2026-11-04', 'Civil', [], { lostTimeHours: 0 }),
    entry('2026-11-06', 'Civil', [], { lostTimeHours: 2, lostTimeReason: 'Power failure' }),
  ];
  const rows = buildDprLostTime(entries);
  assert.deepEqual(rows.map((row) => row.date), ['2026-11-06', '2026-11-03']);
  assert.equal(rows[1].reason, 'Heavy rain');
});

test('the headline counts distinct reported days across both scopes', () => {
  const headline = buildDprHeadline({
    boqItems,
    entries: reportEntries,
    targets: reportTargets,
    range: { startDate: '2026-11-02', endDate: '2026-11-08' },
  });
  // 03 Nov (Civil) and 05 Nov (Civil + Erection) = 2 distinct dates, not 3 entries.
  assert.equal(headline.daysReported, 2);
  assert.equal(headline.daysInPeriod, 7);
});

/* ── Validation ─────────────────────────────────────────────────────────────────────────────── */

const draftEntry = (over = {}) => ({
  scope: 'Civil',
  date: '2026-11-05',
  status: 'Submitted',
  lines: [{ id: 'l1', boqItemId: 'civil-1', boqSlNo: '1.1', description: 'x', unit: 'Cum', plannedQty: 20, actualQty: 18 }],
  manpower: [],
  equipment: [],
  ...over,
});

test('an entry needs a real date, a scope and at least one BOQ line', () => {
  assert.deepEqual(validateDprEntry(draftEntry()), []);
  assert.equal(validateDprEntry(draftEntry({ date: '2026-02-31' })).some((e) => e.field === 'date'), true);
  assert.equal(validateDprEntry(draftEntry({ scope: 'Supply' })).some((e) => e.field === 'scope'), true);
  assert.equal(validateDprEntry(draftEntry({ lines: [] })).some((e) => e.field === 'lines'), true);
});

test('a day with no projection behind it still records, because actual is the fact of the day', () => {
  // The entry screen shows projection read-only and never asks for one. Most days on a site are
  // worked without a figure having been set for them, and refusing the record would lose the only
  // hard fact the day produced. Nothing here may ever require a positive plannedQty.
  const errors = validateDprEntry(draftEntry({
    lines: [
      { id: 'a', boqItemId: 'civil-1', boqSlNo: '1.1', description: '', unit: 'Cum', plannedQty: 0, actualQty: 42 },
    ],
  }));
  assert.deepEqual(errors, []);
});

test('the same BOQ item twice in a day is rejected, so the day has one figure per line', () => {
  const errors = validateDprEntry(draftEntry({
    lines: [
      { id: 'a', boqItemId: 'civil-1', boqSlNo: '1.1', description: '', unit: '', plannedQty: 0, actualQty: 10 },
      { id: 'b', boqItemId: 'civil-1', boqSlNo: '1.1', description: '', unit: '', plannedQty: 0, actualQty: 8 },
    ],
  }));
  assert.equal(errors.some((e) => e.message.includes('twice')), true);
});

test('lost time needs a reason and cannot exceed a day', () => {
  assert.equal(
    validateDprEntry(draftEntry({ lostTimeHours: 3 })).some((e) => e.field === 'lostTimeReason'),
    true,
  );
  assert.equal(
    validateDprEntry(draftEntry({ lostTimeHours: 30, lostTimeReason: 'x' })).some((e) => e.field === 'lostTimeHours'),
    true,
  );
  assert.deepEqual(validateDprEntry(draftEntry({ lostTimeHours: 3, lostTimeReason: 'Rain' })), []);
});

test('a projection needs a positive quantity and a period that does not run backwards', () => {
  const draft = {
    scope: 'Civil', boqItemId: 'civil-1', boqSlNo: '1.1', description: 'x', unit: 'Cum',
    periodType: 'Week', startDate: '2026-11-02', endDate: '2026-11-08', plannedQty: 140,
  };
  assert.deepEqual(validateDprTarget(draft), []);
  assert.equal(validateDprTarget({ ...draft, plannedQty: 0 }).some((e) => e.field === 'plannedQty'), true);
  assert.equal(validateDprTarget({ ...draft, endDate: '2026-11-01' }).some((e) => e.field === 'endDate'), true);
  assert.equal(validateDprTarget({ ...draft, boqItemId: '' }).some((e) => e.field === 'boqItemId'), true);
});

test('overlapping projections are reported for the same item and scope only', () => {
  const existing = [
    target({ id: 'm', periodType: 'Month', startDate: '2026-11-01', endDate: '2026-11-30' }),
    target({ id: 'other-item', boqItemId: 'civil-2', periodType: 'Month', startDate: '2026-11-01', endDate: '2026-11-30' }),
    target({ id: 'other-scope', scope: 'Erection', periodType: 'Month', startDate: '2026-11-01', endDate: '2026-11-30' }),
    target({ id: 'elsewhere', periodType: 'Month', startDate: '2026-12-01', endDate: '2026-12-31' }),
  ];
  const draft = {
    scope: 'Civil', boqItemId: 'civil-1', boqSlNo: '1.1', description: 'x', unit: 'Cum',
    periodType: 'Week', startDate: '2026-11-02', endDate: '2026-11-08', plannedQty: 140,
  };
  assert.deepEqual(overlappingTargets(draft, existing).map((t) => t.id), ['m']);
  assert.deepEqual(overlappingTargets(draft, existing, 'm'), [], 'editing a projection ignores itself');
});

/* ── Export ─────────────────────────────────────────────────────────────────────────────────── */

test('the CSV export quotes commas and defuses formula injection', () => {
  const csv = dprPeriodReportCsv({
    range: { startDate: '2026-11-02', endDate: '2026-11-08' },
    rows: [{
      id: 'x', boqSlNo: '1.1', erpSlNo: '2', description: '=cmd|calc, and more', unit: 'Cum',
      boqQty: 1000, plannedQty: 140, actualQty: 32.456, varianceQty: -108, achievementPct: 22.857,
      cumulativeQty: 82, progressPct: 8.2, balanceQty: 918, workedDays: 2, lastWorkedDate: '2026-11-05',
    }],
    totals: { plannedQty: 140, actualQty: 32, varianceQty: -108, achievementPct: 22.8, linesProjected: 1, linesWorked: 1, linesBehind: 1 },
  });
  const [, row] = csv.split('\n');
  assert.equal(row.includes('"\'=cmd|calc, and more"'), true, 'quoted and prefixed');
  assert.equal(row.includes('32.46'), true, 'quantities round to 2dp');
});
