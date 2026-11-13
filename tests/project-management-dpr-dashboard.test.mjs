import assert from 'node:assert/strict';
import test from 'node:test';

const {
  buildDprComingUp,
  buildDprDiaryDays,
  buildDprFilingCalendar,
  buildDprScopeSplit,
  dprProgressAt,
  furthestBehind,
  lineAchievementBars,
} = await import('../src/lib/project-management-dpr-dashboard.ts');
const { buildDprBoard, buildDprPlan, dprCalendar, sanitizeDprSettings } = await import(
  '../src/lib/project-management-dpr-plan.ts'
);

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const settings = sanitizeDprSettings({});
const items = [
  { id: 'c1', scope: 'Civil', boqSlNo: '2.2', description: 'PCC M10', unit: 'Cum', boqQty: 0 },
  { id: 'c2', scope: 'Civil', boqSlNo: '5', description: 'Rain water harvesting', unit: 'Nos', boqQty: 0 },
  { id: 'e1', scope: 'Erection', boqSlNo: '9.1', description: 'Tower erection', unit: 'MT', boqQty: 0 },
];

const target = (over) => ({
  id: over.id ?? 't',
  scope: 'Civil',
  boqSlNo: '',
  description: '',
  unit: 'Cum',
  periodType: 'Week',
  startDate: '2026-11-09',
  endDate: '2026-11-15',
  plannedQty: 7,
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

const week = { startDate: '2026-11-09', endDate: '2026-11-15' };
const today = '2026-11-12'; // a Thursday

const planOf = (targets, s = settings) =>
  buildDprPlan(targets, { calendar: dprCalendar(s), decimalsFor: (t) => (t.unit === 'Nos' ? 0 : 3) });

/* ── Headline ───────────────────────────────────────────────────────────────────────────────── */

test('the progress reading is the curve on today, or on the last day once the period is over', () => {
  const plan = planOf([target({ id: 'a', boqItemId: 'c1', plannedQty: 7 })]);
  const entries = [entry('2026-11-09', 'Civil', [{ boqItemId: 'c1', actualQty: 2 }])];
  const board = buildDprBoard({ items, entries, plan, settings, range: week, today });
  const reading = dprProgressAt(board, today);
  assert.equal(reading.date, today);
  // 4 of 7 even days planned by Thursday; 2 of 7 done.
  assert.equal(Math.round(reading.plannedPct * 10) / 10, 57.1);
  assert.equal(Math.round(reading.actualPct * 10) / 10, 28.6);

  const after = dprProgressAt(buildDprBoard({ items, entries, plan, settings, range: week, today: '2026-11-20' }), '2026-11-20');
  assert.equal(after.date, '2026-11-15');
  assert.equal(Math.round(after.plannedPct), 100);

  assert.equal(dprProgressAt(buildDprBoard({ items, entries, plan, settings, range: week, today: '2026-11-01' }), '2026-11-01'), null, 'not started');
  assert.equal(dprProgressAt(buildDprBoard({ items, entries: [], plan: planOf([]), settings, range: week, today }), today), null, 'nothing planned');
});

/* ── Lines ──────────────────────────────────────────────────────────────────────────────────── */

test('achievement bars cover lines already due, worst first, capped', () => {
  const plan = planOf([
    target({ id: 'a', boqItemId: 'c1', plannedQty: 7 }),
    target({ id: 'b', boqItemId: 'c2', unit: 'Nos', plannedQty: 14 }),
    target({ id: 'c', boqItemId: 'e1', scope: 'Erection', unit: 'MT', startDate: '2026-11-14', endDate: '2026-11-15', plannedQty: 4 }),
  ]);
  const entries = [
    entry('2026-11-10', 'Civil', [
      { boqItemId: 'c1', actualQty: 4 },
      { boqItemId: 'c2', actualQty: 1 },
    ]),
  ];
  const board = buildDprBoard({ items, entries, plan, settings, range: week, today });
  const bars = lineAchievementBars(board);
  assert.deepEqual(bars.map((bar) => bar.id), ['c2', 'c1'], 'e1 is not due yet, so it has no bar');
  assert.equal(bars[0].label, '5');
  assert.equal(bars[0].status, 'behind');
  assert.equal(bars[1].status, 'on-plan');
  assert.equal(lineAchievementBars(board, 1).length, 1);

  const behind = furthestBehind(board);
  assert.deepEqual(behind.map((row) => row.item.id), ['c2']);
});

test('a line with no BOQ number is labelled by the start of its description', () => {
  const plan = planOf([target({ id: 'a', boqItemId: 'x', plannedQty: 7 })]);
  const board = buildDprBoard({
    items: [{ id: 'x', scope: 'Civil', boqSlNo: '', description: 'A very long description of the work item', unit: 'Cum', boqQty: 0 }],
    entries: [],
    plan,
    settings,
    range: week,
    today,
  });
  assert.equal(lineAchievementBars(board)[0].label, 'A very long descr…');
});

/* ── Site diary ─────────────────────────────────────────────────────────────────────────────── */

test('the diary sums headcount and lost time per day, counted sheets only, and stops at today', () => {
  const entries = [
    entry('2026-11-09', 'Civil', [], { manpower: [{ trade: 'Mason', count: 4 }, { trade: 'Helper', count: 6 }], lostTimeHours: 2 }),
    entry('2026-11-09', 'Erection', [], { manpower: [{ trade: 'Rigger', count: 5 }] }),
    entry('2026-11-10', 'Civil', [], { manpower: [{ trade: 'Mason', count: 9 }], status: 'Draft' }),
  ];
  const days = buildDprDiaryDays({ entries, range: week, today });
  assert.equal(days.length, 4, '9th to 12th — the rest of the week has not happened');
  assert.equal(days[0].headcount, 15);
  assert.equal(days[0].lostHours, 2);
  assert.equal(days[0].reported, true);
  assert.equal(days[1].headcount, 0, 'a draft is not counted');
  assert.equal(days[1].reported, false);

  const civil = buildDprDiaryDays({ entries, range: week, scope: 'Civil', today });
  assert.equal(civil[0].headcount, 10);
  assert.deepEqual(buildDprDiaryDays({ entries, range: week, today: '2026-11-01' }), [], 'not started');
});

/* ── Filing calendar ────────────────────────────────────────────────────────────────────────── */

test('the filing calendar marks each day per scope and pads Monday-first weeks', () => {
  const sundayOff = sanitizeDprSettings({ weeklyOff: [0] });
  const entries = [
    entry('2026-11-09', 'Civil', []),
    entry('2026-11-10', 'Civil', [], { status: 'Draft' }),
    entry('2026-11-09', 'Erection', []),
  ];
  const calendar = buildDprFilingCalendar({
    entries,
    settings: sundayOff,
    range: { startDate: '2026-11-11', endDate: '2026-11-17' },
    scopes: ['Civil', 'Erection'],
    today,
  });
  assert.equal(calendar.weeks.length, 2, 'Wed–Sun, then Mon–Tue of the next week');
  assert.equal(calendar.weeks[0][0], null, 'Monday is padding');
  assert.equal(calendar.weeks[0][2].date, '2026-11-11');
  assert.equal(calendar.weeks[0][2].states.Civil, 'missing');
  assert.equal(calendar.weeks[0][3].isToday, true);
  assert.equal(calendar.weeks[0][4].states.Civil, 'future');
  assert.equal(calendar.weeks[1][6], null);

  const wide = buildDprFilingCalendar({ entries, settings: sundayOff, range: week, scopes: ['Civil', 'Erection'], today });
  const days = wide.weeks.flat().filter(Boolean);
  assert.equal(days[0].states.Civil, 'submitted');
  assert.equal(days[1].states.Civil, 'draft');
  assert.equal(days[1].states.Erection, 'missing');
  assert.equal(days[6].states.Civil, 'future', 'a Sunday ahead of today is future, not off');
  assert.equal(wide.counts.Civil.submitted, 1);
  assert.equal(wide.counts.Civil.missing, 2, '11th and 12th');
});

test('non-working days and days outside the project read as not expected', () => {
  const sundayOff = sanitizeDprSettings({ weeklyOff: [0] });
  const calendar = buildDprFilingCalendar({
    entries: [],
    settings: sundayOff,
    range: { startDate: '2026-11-01', endDate: '2026-11-03' },
    scopes: ['Civil'],
    today,
    projectDates: { startDate: '2026-11-03', endDate: '' },
  });
  const days = calendar.weeks.flat().filter(Boolean);
  assert.equal(days[0].states.Civil, 'off', 'Sunday');
  assert.equal(days[1].states.Civil, 'off', 'before the project start');
  assert.equal(days[2].states.Civil, 'missing');
  assert.equal(calendar.scopes.length, 1);
  assert.equal(days[0].states.Erection, undefined, 'a scope not asked for is not shown');
});

test('a long period shows its most recent days, ending today', () => {
  const calendar = buildDprFilingCalendar({
    entries: [],
    settings,
    range: { startDate: '2026-01-01', endDate: '2026-12-31' },
    scopes: ['Civil'],
    today,
    maxDays: 28,
  });
  assert.equal(calendar.truncated, true);
  assert.deepEqual(calendar.range, { startDate: '2026-10-16', endDate: today });
  const early = buildDprFilingCalendar({
    entries: [],
    settings,
    range: { startDate: '2026-11-10', endDate: '2027-06-30' },
    scopes: ['Civil'],
    today,
    maxDays: 28,
  });
  assert.equal(early.range.startDate, '2026-11-10', 'never before the period starts');
  assert.equal(early.range.endDate, '2026-12-07', 'filled forward to the full window');
});

/* ── Scope split ────────────────────────────────────────────────────────────────────────────── */

test('the scope split reads each scope on its own board, for scopes the project has lines in', () => {
  const plan = planOf([
    target({ id: 'a', boqItemId: 'c1', plannedQty: 7 }),
    target({ id: 'b', boqItemId: 'e1', scope: 'Erection', unit: 'MT', plannedQty: 14 }),
  ]);
  const entries = [
    entry('2026-11-09', 'Civil', [{ boqItemId: 'c1', actualQty: 4 }]),
    entry('2026-11-09', 'Erection', [{ boqItemId: 'e1', actualQty: 2 }]),
  ];
  const split = buildDprScopeSplit({ items, entries, plan, settings, range: week, today });
  assert.deepEqual(split.map((row) => row.scope), ['Civil', 'Erection']);
  assert.equal(split[0].linesBehind, 0, 'Civil: 4 done against 4 due');
  assert.equal(split[1].linesBehind, 1, 'Erection: 2 done against 8 due');
  assert.equal(Math.round(split[1].achievementToDatePct), 25);

  const civilOnly = buildDprScopeSplit({ items: items.filter((item) => item.scope === 'Civil'), entries, plan, settings, range: week, today });
  assert.deepEqual(civilOnly.map((row) => row.scope), ['Civil']);
});

/* ── Coming up ──────────────────────────────────────────────────────────────────────────────── */

test('coming up lists each planned line over the next seven days, today included', () => {
  const sundayOff = sanitizeDprSettings({ weeklyOff: [0] });
  const plan = planOf(
    [
      target({ id: 'a', boqItemId: 'c1', startDate: '2026-11-09', endDate: '2026-11-21', plannedQty: 12 }),
      target({ id: 'b', boqItemId: 'e1', scope: 'Erection', unit: 'MT', startDate: '2026-12-01', endDate: '2026-12-05', plannedQty: 5 }),
    ],
    sundayOff,
  );
  const coming = buildDprComingUp({ items, plan, settings: sundayOff, today });
  assert.deepEqual(coming.range, { startDate: today, endDate: '2026-11-18' });
  assert.equal(coming.days.length, 7);
  assert.equal(coming.days[3].working, false, 'Sunday the 15th');
  assert.deepEqual(coming.rows.map((row) => row.item.id), ['c1'], 'e1 is planned only in December');
  // 12 Cum over the 12 working days of 9–21 Nov (Sunday the 15th off) is 1 a day; 6 of them fall
  // in 12–18 Nov.
  assert.equal(coming.rows[0].total, 6);
  assert.equal(coming.rows[0].perDay[3], 0);
  assert.equal(buildDprComingUp({ items, plan, settings: sundayOff, today, scope: 'Erection' }).rows.length, 0);
});
