import assert from 'node:assert/strict';
import test from 'node:test';

const {
  buildCivilAttention,
  buildCivilBoqLines,
  buildCivilCertifiedEvents,
  buildCivilHeadline,
  buildCivilProgressCurve,
  buildCivilSubcontractors,
  buildCivilToday,
  buildCivilWorkItems,
  civilBoqValue,
  subcontractorByBoqItem,
} = await import('../src/lib/project-management-civil-progress.ts');

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const boqItems = [
  { id: 'c1', 'Scope 1': 'Switchyard', 'Scope 2': 'Civil', 'BOQ SL No': '1.1', Description: 'Equipment foundations', Unit: 'Cum', QTY: 100, 'Budget Price': 5000 },
  { id: 'c2', 'Scope 1': 'Switchyard', 'Scope 2': 'Civil', 'BOQ SL No': '2.1', Description: 'Cable trench', Unit: 'Rmt', QTY: 1000, 'Budget Price': 500 },
  { id: 's1', 'Scope 2': 'Supply', 'BOQ SL No': '9.1', Unit: 'Nos', QTY: 5, 'Budget Price': 100000 },
  { id: 'h1', 'Scope 2': 'Civil', 'BOQ SL No': 'A', Description: 'SECTION A — FOUNDATIONS' },
];

const dprEntry = (date, lines, extra = {}) => ({
  id: `civil-${date}`,
  scope: 'Civil',
  date,
  status: 'Submitted',
  lines: lines.map((line, index) => ({ id: `l${index}`, boqSlNo: '', description: '', unit: '', plannedQty: 0, ...line })),
  manpower: [],
  equipment: [],
  ...extra,
});

const target = (over) => ({
  id: 't', scope: 'Civil', boqItemId: 'c1', boqSlNo: '1.1', description: '', unit: 'Cum',
  periodType: 'Month', startDate: '2026-11-01', endDate: '2026-11-30', plannedQty: 30, ...over,
});

/* ── BOQ lines ──────────────────────────────────────────────────────────────────────────────── */

test('civil BOQ lines are the civil scope only, priced, without caption rows', () => {
  const lines = buildCivilBoqLines(boqItems);
  assert.deepEqual(lines.map((l) => l.id), ['c1', 'c2'], 'supply and the section header are both out');
  assert.equal(lines[0].value, 500_000);
  assert.equal(lines[1].value, 500_000);
  assert.equal(civilBoqValue(lines), 1_000_000);
  assert.equal(lines[0].civilKey, 'switchyard__civil__1.1', 'the key JMC items join on');
});

test('a stored total wins over recomputing quantity by rate', () => {
  const [line] = buildCivilBoqLines([
    { id: 'x', 'Scope 2': 'Civil', Unit: 'Cum', QTY: 10, 'Budget Price': 100, 'Total Amount': 1500 },
  ]);
  assert.equal(line.value, 1500);
});

/* ── Certified events ───────────────────────────────────────────────────────────────────────── */

test('certified events price each JMC by its own recorded rate and skip void ones', () => {
  const events = buildCivilCertifiedEvents([
    { jmcNo: 'J1', jmcDate: '2026-11-03', status: 'Approved', items: [{ rate: 5000, certifiedQty: 10 }] },
    { jmcNo: 'J2', jmcDate: '2026-11-10T00:00:00Z', status: 'Approved', items: [{ rate: 500, certifiedQty: 100 }] },
    { jmcNo: 'J3', jmcDate: '2026-11-11', status: 'Rejected', items: [{ rate: 5000, certifiedQty: 99 }] },
    { jmcNo: 'J4', status: 'Approved', items: [{ rate: 5000, certifiedQty: 5 }] },
  ]);
  assert.deepEqual(events.map((e) => [e.date, e.value]), [
    ['2026-11-03', 50_000],
    ['2026-11-10', 50_000],
  ], 'a timestamped date is trimmed to its day; undated and rejected entries are dropped');
});

/* ── The S-curve ────────────────────────────────────────────────────────────────────────────── */

test('the curve is cumulative from the start of the project, not from the start of the window', () => {
  const lines = buildCivilBoqLines(boqItems);
  const curve = buildCivilProgressCurve({
    lines,
    entries: [
      dprEntry('2026-10-20', [{ boqItemId: 'c1', actualQty: 10 }]),
      dprEntry('2026-11-03', [{ boqItemId: 'c1', actualQty: 10 }]),
    ],
    targets: [],
    certifiedEvents: [],
    periodType: 'Week',
    // The window starts in November, after the first entry.
    range: { startDate: '2026-11-02', endDate: '2026-11-08' },
  });
  assert.equal(curve.length, 1);
  // 20 Cum × 5000 = 100,000 of a 1,000,000 BOQ — the October entry still counts.
  assert.equal(curve[0].actualValue, 100_000);
  assert.equal(curve[0].actualPct, 10);
});

test('the curve prices all three series and pro-rates the plan by day', () => {
  const lines = buildCivilBoqLines(boqItems);
  const curve = buildCivilProgressCurve({
    lines,
    entries: [dprEntry('2026-11-05', [{ boqItemId: 'c1', actualQty: 6 }])],
    // 30 Cum across all 30 days of November = 1 Cum/day.
    targets: [target({})],
    certifiedEvents: [{ date: '2026-11-04', value: 25_000 }],
    periodType: 'Day',
    range: { startDate: '2026-11-05', endDate: '2026-11-05' },
  });
  // 5 days elapsed × 1 Cum × 5000 = 25,000.
  assert.equal(curve[0].plannedValue, 25_000);
  assert.equal(curve[0].actualValue, 30_000);
  assert.equal(curve[0].certifiedValue, 25_000);
  assert.equal(curve[0].actualPct, 3);
  assert.equal(curve[0].plannedPct, 2.5);
});

test('a BOQ with no value gives null shares rather than dividing by zero', () => {
  const curve = buildCivilProgressCurve({
    lines: [],
    entries: [],
    targets: [],
    certifiedEvents: [],
    periodType: 'Day',
    range: { startDate: '2026-11-05', endDate: '2026-11-05' },
  });
  assert.equal(curve[0].actualPct, null);
  assert.equal(curve[0].plannedPct, null);
});

/* ── Headline ───────────────────────────────────────────────────────────────────────────────── */

test('the headline compares actual against what the plan says should be done by today', () => {
  const lines = buildCivilBoqLines(boqItems);
  const headline = buildCivilHeadline({
    lines,
    entries: [dprEntry('2026-11-05', [{ boqItemId: 'c1', actualQty: 4 }])],
    targets: [target({})],
    jmcEntries: [
      { jmcNo: 'J1', jmcDate: '2026-11-04', status: 'Approved', items: [{ rate: 5000, certifiedQty: 2 }] },
      { jmcNo: 'J2', jmcDate: '2026-11-05', status: 'Submitted', items: [{ rate: 5000, certifiedQty: 0 }] },
    ],
    today: '2026-11-05',
  });
  assert.equal(headline.actualValue, 20_000);
  assert.equal(headline.actualPct, 2);
  assert.equal(headline.plannedToDateValue, 25_000, '5 of November\'s 30 days');
  assert.equal(headline.plannedToDatePct, 2.5);
  assert.equal(headline.gapPoints, -0.5);
  assert.equal(headline.tone, 'warn', 'behind, but not by more than 8 points');
  assert.equal(headline.certifiedValue, 10_000);
  assert.equal(headline.openMeasurementCount, 1, 'the submitted JMC is not yet certified');
});

test('more than eight points behind reads as bad, and ahead reads as on track', () => {
  const lines = buildCivilBoqLines(boqItems);
  const base = { lines, jmcEntries: [], today: '2026-11-30' };
  const behind = buildCivilHeadline({
    ...base,
    entries: [],
    targets: [target({ plannedQty: 100 })],
  });
  assert.equal(behind.gapPoints, -50);
  assert.equal(behind.tone, 'bad');

  const ahead = buildCivilHeadline({
    ...base,
    entries: [dprEntry('2026-11-10', [{ boqItemId: 'c1', actualQty: 50 }])],
    targets: [target({ plannedQty: 30 })],
  });
  assert.equal(ahead.tone, 'ok');
});

test('a project with no plan at all reports no gap rather than a false one', () => {
  const headline = buildCivilHeadline({
    lines: [],
    entries: [],
    targets: [],
    jmcEntries: [],
    today: '2026-11-05',
  });
  assert.equal(headline.gapPoints, null);
  assert.equal(headline.tone, 'idle');
});

/* ── Work items ─────────────────────────────────────────────────────────────────────────────── */

test('work items carry their own plan tick and the worst shortfall sorts first', () => {
  const lines = buildCivilBoqLines(boqItems);
  const items = buildCivilWorkItems({
    lines,
    entries: [dprEntry('2026-11-05', [
      { boqItemId: 'c1', actualQty: 20 },
      { boqItemId: 'c2', actualQty: 500 },
    ])],
    targets: [
      target({ id: 't1', boqItemId: 'c1', plannedQty: 60 }),
      target({ id: 't2', boqItemId: 'c2', unit: 'Rmt', plannedQty: 600 }),
    ],
    jmcEntries: [],
    workOrders: [
      { workOrderNo: 'WO/1', subcontractorName: 'Maa Tarini', status: 'Active', items: [{ boqItemId: 'c1' }] },
    ],
    today: '2026-11-30',
  });
  assert.equal(items.length, 2);
  // c1: 20 of 100 = 20% done against a 60% plan → 40 points behind, worse than c2's 10.
  assert.equal(items[0].id, 'c1');
  assert.equal(items[0].progressPct, 20);
  assert.equal(items[0].planPct, 60);
  assert.equal(items[0].gapPoints, -40);
  assert.equal(items[0].statusLabel, 'Behind');
  assert.equal(items[0].subcontractorName, 'Maa Tarini');
  assert.equal(items[1].subcontractorName, '', 'c2 has no work order');
});

test('a planned line with nothing done reads as not started, not merely behind', () => {
  const lines = buildCivilBoqLines(boqItems);
  const [item] = buildCivilWorkItems({
    lines,
    entries: [],
    targets: [target({ plannedQty: 30 })],
    jmcEntries: [],
    workOrders: [],
    today: '2026-11-30',
  });
  assert.equal(item.statusLabel, 'Not started');
  assert.equal(item.tone, 'bad');
});

test('work items join JMC certification on the composite key, not on a BOQ item id', () => {
  const lines = buildCivilBoqLines(boqItems);
  const [item] = buildCivilWorkItems({
    lines,
    entries: [],
    targets: [],
    jmcEntries: [
      {
        jmcNo: 'J1', jmcDate: '2026-11-04', status: 'Approved',
        items: [{ 'Scope 1': 'Switchyard', 'Scope 2': 'Civil', boqSlNo: '1.1', certifiedQty: 12, rate: 5000 }],
      },
    ],
    workOrders: [],
    today: '2026-11-30',
  });
  assert.equal(item.id, 'c1');
  assert.equal(item.certifiedQty, 12);
});

test('lines with nothing planned, done or certified are left out of the list', () => {
  const items = buildCivilWorkItems({
    lines: buildCivilBoqLines(boqItems),
    entries: [],
    targets: [],
    jmcEntries: [],
    workOrders: [],
    today: '2026-11-30',
  });
  assert.deepEqual(items, []);
});

/* ── Today on site ──────────────────────────────────────────────────────────────────────────── */

test('today on site falls back to the last filed day and says it is not today', () => {
  const snapshot = buildCivilToday(
    [
      dprEntry('2026-11-03', [{ boqItemId: 'c1', actualQty: 8, unit: 'Cum', description: 'Equipment foundations' }], {
        manpower: [{ id: 'm1', trade: 'Mason', count: 30 }, { id: 'm2', trade: 'Helper', count: 16 }],
        equipment: [{ id: 'e1', name: 'Mixer', deployed: 1 }, { id: 'e2', name: 'Crane', deployed: 0 }],
        weather: 'Clear',
      }),
      dprEntry('2026-11-01', [{ boqItemId: 'c1', actualQty: 99 }]),
    ],
    '2026-11-05',
  );
  assert.equal(snapshot.date, '2026-11-03');
  assert.equal(snapshot.isToday, false);
  assert.equal(snapshot.manpower, 46);
  assert.equal(snapshot.equipmentCount, 1, 'plant with none deployed is not on site');
  assert.equal(snapshot.weather, 'Clear');
  assert.equal(snapshot.headlineQty, 8);
  assert.equal(snapshot.headlineUnit, 'Cum');
});

test('today on site ignores days after today and returns null when nothing is filed', () => {
  assert.equal(buildCivilToday([dprEntry('2026-12-01', [])], '2026-11-05'), null);
  assert.equal(buildCivilToday([], '2026-11-05'), null);
});

/* ── Subcontractors ─────────────────────────────────────────────────────────────────────────── */

test('subcontractor roll-up excludes cancelled orders and retention bills', () => {
  const rows = buildCivilSubcontractors(
    [
      { workOrderNo: 'WO/1', subcontractorName: 'Maa Tarini', status: 'Active', totalAmount: 1_000_000, items: [{ boqItemId: 'c1' }] },
      { workOrderNo: 'WO/2', subcontractorName: 'Maa Tarini', status: 'Active', totalAmount: 500_000, items: [] },
      { workOrderNo: 'WO/3', subcontractorName: 'Biswal', status: 'Cancelled', totalAmount: 900_000, items: [] },
    ],
    [
      { billNo: 'B/1', status: 'Completed', totalAmount: 300_000, subcontractorName: 'Maa Tarini' },
      { billNo: 'B/R', status: 'Completed', totalAmount: 100_000, isRetentionBill: true, subcontractorName: 'Maa Tarini' },
      { billNo: 'B/X', status: 'Rejected', totalAmount: 999, subcontractorName: 'Maa Tarini' },
    ],
  );
  assert.equal(rows.length, 1, 'the cancelled order leaves Biswal with nothing');
  assert.equal(rows[0].workOrderCount, 2);
  assert.equal(rows[0].orderedValue, 1_500_000);
  assert.equal(rows[0].billedValue, 300_000);
  assert.equal(rows[0].billedPct, 20);
});

test('the BOQ line holder is the first live work order that covers it', () => {
  const holders = subcontractorByBoqItem([
    { subcontractorName: 'Cancelled Co', status: 'Cancelled', items: [{ boqItemId: 'c1' }] },
    { subcontractorName: 'Maa Tarini', status: 'Active', items: [{ boqItemId: 'c1' }] },
    { subcontractorName: 'Biswal', status: 'Active', items: [{ boqItemId: 'c1' }] },
  ]);
  assert.equal(holders.get('c1'), 'Maa Tarini');
});

/* ── Attention ──────────────────────────────────────────────────────────────────────────────── */

test('attention leads with the bad news and flags a missing daily log', () => {
  const headline = { openMeasurementCount: 2 };
  const workItems = [
    { description: 'Roads', boqSlNo: '5.1', statusLabel: 'Not started', gapPoints: -30, doneQty: 0, planPct: 30, subcontractorName: '' },
    { description: 'Trench', boqSlNo: '2.1', statusLabel: 'Behind', gapPoints: -12, doneQty: 5, planPct: 40, subcontractorName: 'Biswal' },
  ];
  const items = buildCivilAttention({
    today: { date: '2026-11-04', isToday: false },
    headline,
    workItems,
    todayDate: '2026-11-05',
  });
  assert.equal(items.some((i) => i.id === 'dpr-missing'), true);
  assert.equal(items[0].tone, 'bad', 'bad sorts above warn');
  assert.equal(items.some((i) => i.id === 'jmc-open'), true);
  assert.equal(items.some((i) => i.id === 'unassigned'), true, 'Roads is planned with no work order');
});

test('a day that is logged raises no missing-log warning', () => {
  const items = buildCivilAttention({
    today: { date: '2026-11-05', isToday: true },
    headline: { openMeasurementCount: 0 },
    workItems: [],
    todayDate: '2026-11-05',
  });
  assert.deepEqual(items, []);
});
