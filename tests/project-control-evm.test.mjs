import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROJECT_CONTROL_SETTINGS,
  DEFAULT_SUPPLY_EARNING_RULE,
  earningRuleTotal,
  resolveProjectControlSettings,
  resolveSupplyEarningRule,
  validateProjectControlSettings,
} from '../src/lib/project-control-settings.ts';
import {
  baselineWindow,
  baselinesSupersededBy,
  canApproveBaseline,
  canDeleteBaseline,
  computeBaselinePlannedValue,
  computePlannedPct,
  nextBaselineVersion,
  resolveActiveBaseline,
  resolveOriginalBaseline,
  resolveTenderBaseline,
  summariseScheduleExposure,
  validateBaseline,
} from '../src/lib/project-control-baseline.ts';
import {
  computeCivilEarnedPct,
  computeLineProgress,
  computeSupplyEarnedPct,
  computeTowerEarnedPct,
  detectLane,
  rollUpProgress,
} from '../src/lib/project-control-progress.ts';
import { computeEvm, evmIndexHealth, formatEvmIndex } from '../src/lib/project-control-evm.ts';

/* ── Settings: the earning-rule cascade ─────────────────────────────────────────────────────── */

test('the default supply earning rule reproduces the specification table and totals 100', () => {
  assert.equal(earningRuleTotal(DEFAULT_SUPPLY_EARNING_RULE), 100);
  assert.equal(DEFAULT_SUPPLY_EARNING_RULE.po, 5);
  assert.equal(DEFAULT_SUPPLY_EARNING_RULE.manufacturing, 25);
  assert.equal(DEFAULT_SUPPLY_EARNING_RULE.grn, 20);
  assert.equal(DEFAULT_SUPPLY_EARNING_RULE.mvac, 10);
});

test('stored settings are read tolerantly and fall back to defaults', () => {
  const resolved = resolveProjectControlSettings({ spiRedBelow: 0.9, riskCriticalScore: 20 });
  assert.equal(resolved.spiRedBelow, 0.9);
  assert.equal(resolved.riskCriticalScore, 20);
  assert.equal(resolved.cpiRedBelow, DEFAULT_PROJECT_CONTROL_SETTINGS.cpiRedBelow);
  assert.equal(earningRuleTotal(resolved.supplyEarningRule), 100);
});

test('a malformed settings document still resolves to a usable configuration', () => {
  // One bad document must not take down a project's whole dashboard.
  for (const raw of [
    null,
    undefined,
    'nonsense',
    { supplyEarningRule: 'broken' },
    { probabilityBands: [] },
  ]) {
    const resolved = resolveProjectControlSettings(raw);
    assert.equal(earningRuleTotal(resolved.supplyEarningRule), 100);
    assert.equal(resolved.probabilityBands[3], 50);
  }
});

test('overrides that name no dimension are dropped on read, since they could never apply', () => {
  const resolved = resolveProjectControlSettings({
    supplyEarningOverrides: [
      { rule: DEFAULT_SUPPLY_EARNING_RULE },
      { scope2: 'Supply', rule: DEFAULT_SUPPLY_EARNING_RULE },
    ],
  });
  assert.equal(resolved.supplyEarningOverrides.length, 1);
  assert.equal(resolved.supplyEarningOverrides[0].scope2, 'Supply');
});

test('the earning rule cascades project then scope then category, most specific winning', () => {
  const scopeRule = { ...DEFAULT_SUPPLY_EARNING_RULE, po: 10, manufacturing: 20 };
  const categoryRule = { ...DEFAULT_SUPPLY_EARNING_RULE, po: 1, manufacturing: 29 };
  const settings = {
    supplyEarningRule: DEFAULT_SUPPLY_EARNING_RULE,
    supplyEarningOverrides: [
      { scope2: 'Supply', rule: scopeRule },
      { scope2: 'Supply', category1: 'Transformer', rule: categoryRule },
    ],
  };

  assert.equal(resolveSupplyEarningRule(settings, { scope2: 'Civil' }).po, 5, 'project default');
  assert.equal(resolveSupplyEarningRule(settings, { scope2: 'Supply' }).po, 10, 'scope override');
  assert.equal(
    resolveSupplyEarningRule(settings, { scope2: 'Supply', category1: 'Transformer' }).po,
    1,
    'the more specific category override must win',
  );
});

test('the cascade is case-insensitive and trims', () => {
  const settings = {
    supplyEarningRule: DEFAULT_SUPPLY_EARNING_RULE,
    supplyEarningOverrides: [
      { scope2: 'Supply', rule: { ...DEFAULT_SUPPLY_EARNING_RULE, po: 10 } },
    ],
  };
  assert.equal(resolveSupplyEarningRule(settings, { scope2: '  supply ' }).po, 10);
});

test('settings validation insists every earning rule totals 100', () => {
  const short = validateProjectControlSettings({
    ...DEFAULT_PROJECT_CONTROL_SETTINGS,
    supplyEarningRule: { ...DEFAULT_SUPPLY_EARNING_RULE, mvac: 0 },
  });
  assert.ok(short.some((error) => /total 100/.test(error.message)));

  const badOverride = validateProjectControlSettings({
    ...DEFAULT_PROJECT_CONTROL_SETTINGS,
    supplyEarningOverrides: [
      { scope2: 'Supply', rule: { ...DEFAULT_SUPPLY_EARNING_RULE, po: 50 } },
    ],
  });
  assert.ok(badOverride.some((error) => /Override for Supply totals/.test(error.message)));

  assert.deepEqual(validateProjectControlSettings(DEFAULT_PROJECT_CONTROL_SETTINGS), []);
});

test('settings validation rejects an inverted collection range and an impossible risk score', () => {
  const errors = validateProjectControlSettings({
    ...DEFAULT_PROJECT_CONTROL_SETTINGS,
    bestCaseCollectionDays: 90,
    worstCaseCollectionDays: 30,
    riskCriticalScore: 40,
  });
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('worstCaseCollectionDays'));
  assert.ok(fields.includes('riskCriticalScore'));
});

/* ── Baseline fixtures ──────────────────────────────────────────────────────────────────────── */

const line = (overrides = {}) => ({
  controlAccountId: 'civ',
  budgetValue: 1000000,
  plannedStartDate: '2026-04-01',
  plannedEndDate: '2026-10-30',
  curveShape: 'linear',
  ...overrides,
});

const baseline = (overrides = {}) => ({
  id: overrides.id ?? 'b0',
  globalProjectId: 'proj-1',
  type: 'B0',
  version: 0,
  label: 'Approved Baseline B0',
  status: 'Approved',
  effectiveFrom: '2026-04-01',
  lines: [line()],
  ...overrides,
});

/* ── Baseline: the planned curve ────────────────────────────────────────────────────────────── */

test('planned percentage is 0 before the start and exactly 100 on and after the end', () => {
  const l = line();
  assert.equal(computePlannedPct(l, '2026-03-31'), 0);
  assert.equal(computePlannedPct(l, '2026-10-30'), 100);
  assert.equal(computePlannedPct(l, '2027-01-01'), 100);
});

test('a linear curve interpolates evenly across the window', () => {
  const l = line({ plannedStartDate: '2026-04-01', plannedEndDate: '2026-10-01' });
  const mid = computePlannedPct(l, '2026-07-01');
  assert.ok(Math.abs(mid - 50) < 1.5, `expected ~50%, got ${mid}`);
});

test('an s-curve starts slower and finishes faster than linear, crossing at the midpoint', () => {
  const window = { plannedStartDate: '2026-01-01', plannedEndDate: '2026-12-31' };
  const linearQuarter = computePlannedPct(line({ ...window, curveShape: 'linear' }), '2026-04-01');
  const sQuarter = computePlannedPct(line({ ...window, curveShape: 'sCurve' }), '2026-04-01');
  assert.ok(sQuarter < linearQuarter, 'an s-curve must lag linear early on');

  const linearLate = computePlannedPct(line({ ...window, curveShape: 'linear' }), '2026-10-01');
  const sLate = computePlannedPct(line({ ...window, curveShape: 'sCurve' }), '2026-10-01');
  assert.ok(sLate > linearLate, 'an s-curve must lead linear late on');

  const sMid = computePlannedPct(line({ ...window, curveShape: 'sCurve' }), '2026-07-02');
  assert.ok(Math.abs(sMid - 50) < 2, `s-curve should cross 50% mid-window, got ${sMid}`);
});

test('the planned curve is monotonic across the whole window for both shapes', () => {
  for (const curveShape of ['linear', 'sCurve']) {
    const l = line({ plannedStartDate: '2026-01-01', plannedEndDate: '2026-12-31', curveShape });
    let previous = -1;
    for (let month = 1; month <= 12; month += 1) {
      const key = `2026-${String(month).padStart(2, '0')}-15`;
      const pct = computePlannedPct(l, key);
      assert.ok(pct >= previous, `${curveShape} went backwards at ${key}: ${pct} < ${previous}`);
      previous = pct;
    }
  }
});

test('a manual curve reads the latest stated period and holds rather than inventing the rest', () => {
  // A manual curve stopping at 80% states a plan that does not finish; filling in the last 20%
  // would hide that.
  const l = line({
    curveShape: 'manual',
    manualCurve: { '2026-04': 10, '2026-06': 45, '2026-08': 80 },
  });
  assert.equal(computePlannedPct(l, '2026-03-15'), 0);
  assert.equal(computePlannedPct(l, '2026-04-20'), 10);
  assert.equal(computePlannedPct(l, '2026-05-20'), 10, 'holds until the next stated period');
  assert.equal(computePlannedPct(l, '2026-06-01'), 45);
  assert.equal(computePlannedPct(l, '2026-12-01'), 80, 'holds at the last stated value');
});

test('a line with missing or reversed dates plans nothing rather than throwing', () => {
  assert.equal(computePlannedPct(line({ plannedStartDate: '' }), '2026-06-01'), 0);
  assert.equal(computePlannedPct(line({ plannedEndDate: '2026-01-01' }), '2026-06-01'), 0);
  assert.equal(computePlannedPct(line(), 'not-a-date'), 0);
});

/* ── Baseline: planned value ────────────────────────────────────────────────────────────────── */

test('planned value sums budget times planned percentage and reports BAC', () => {
  const result = computeBaselinePlannedValue(
    [
      line({ controlAccountId: 'a', budgetValue: 1000000, plannedEndDate: '2026-06-30' }),
      line({
        controlAccountId: 'b',
        budgetValue: 3000000,
        plannedStartDate: '2026-08-01',
        plannedEndDate: '2026-12-31',
      }),
    ],
    '2026-07-01',
  );
  assert.equal(result.bac, 4000000);
  assert.equal(result.pv, 1000000, 'a is finished, b has not started');
  assert.equal(result.plannedPct, 25);
  assert.equal(result.lines[0].plannedPct, 100);
  assert.equal(result.lines[1].plannedPct, 0);
});

test('planned value is zero-safe on an empty baseline', () => {
  const result = computeBaselinePlannedValue([], '2026-07-01');
  assert.equal(result.bac, 0);
  assert.equal(result.pv, 0);
  assert.equal(result.plannedPct, 0);
});

test('the baseline window spans the earliest start and latest end', () => {
  const window = baselineWindow([
    line({ plannedStartDate: '2026-05-01', plannedEndDate: '2026-09-01' }),
    line({ plannedStartDate: '2026-04-01', plannedEndDate: '2026-12-31' }),
  ]);
  assert.equal(window.startDate, '2026-04-01');
  assert.equal(window.endDate, '2026-12-31');
  assert.deepEqual(baselineWindow([]), { startDate: null, endDate: null });
});

/* ── Baseline: which one is in force, and immutability ──────────────────────────────────────── */

test('the active baseline is the highest approved one, and never the tender', () => {
  const all = [
    baseline({ id: 'tender', type: 'Tender', version: 0, label: 'Tender' }),
    baseline({ id: 'b0', type: 'B0', version: 1 }),
    baseline({ id: 'b1', type: 'B1', version: 2, label: 'Recovery Baseline B1' }),
    baseline({ id: 'draft', type: 'B2', version: 3, status: 'Draft' }),
  ];
  assert.equal(resolveActiveBaseline(all).id, 'b1', 'a draft must not become active');
  assert.equal(resolveTenderBaseline(all).id, 'tender');
  assert.equal(resolveOriginalBaseline(all).id, 'b0', 'the original survives a re-baseline');
  assert.equal(resolveActiveBaseline([]), null);
});

test('the original approved baseline can never be deleted', () => {
  const all = [
    baseline({ id: 'b0', version: 0 }),
    baseline({ id: 'b1', version: 1, status: 'Approved' }),
    baseline({ id: 'draft', version: 2, status: 'Draft' }),
  ];
  assert.equal(canDeleteBaseline(all[0], all), false, 'the only record of what was promised');
  assert.equal(canDeleteBaseline(all[2], all), true, 'a draft is freely deletable');
});

test('approving a baseline supersedes the earlier approved ones but not the tender', () => {
  const all = [
    baseline({ id: 'tender', type: 'Tender', version: 0 }),
    baseline({ id: 'b0', version: 1 }),
    baseline({ id: 'b1', version: 2 }),
  ];
  assert.deepEqual(baselinesSupersededBy(all[2], all), ['b0']);
});

test('baseline versions come from the highest so far', () => {
  assert.equal(nextBaselineVersion([]), 0);
  assert.equal(
    nextBaselineVersion([baseline({ version: 0 }), baseline({ id: 'x', version: 4 })]),
    5,
  );
});

/* ── Baseline: validation ───────────────────────────────────────────────────────────────────── */

test('a baseline needs a label and at least one line', () => {
  const errors = validateBaseline(baseline({ label: '', lines: [] }));
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('label'));
  assert.ok(fields.includes('lines'));
});

test('two lines for one control account are rejected as double-counted budget', () => {
  const errors = validateBaseline(
    baseline({ lines: [line({ controlAccountId: 'civ' }), line({ controlAccountId: 'civ' })] }),
  );
  assert.ok(errors.some((error) => /already has a line/.test(error.message)));
});

test('baseline lines need a positive budget and a sane planned window', () => {
  const errors = validateBaseline(
    baseline({
      lines: [
        line({ budgetValue: 0, plannedStartDate: '2026-10-01', plannedEndDate: '2026-04-01' }),
      ],
    }),
  );
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('budgetValue'));
  assert.ok(fields.includes('plannedEndDate'));
});

test('a manual curve that dips is rejected, because cumulative progress cannot go backwards', () => {
  const errors = validateBaseline(
    baseline({
      lines: [line({ curveShape: 'manual', manualCurve: { '2026-04': 40, '2026-05': 20 } })],
    }),
  );
  assert.ok(errors.some((error) => /lower than the period before it/.test(error.message)));

  const empty = validateBaseline(baseline({ lines: [line({ curveShape: 'manual' })] }));
  assert.ok(empty.some((error) => /at least one period/.test(error.message)));
});

test('approval additionally requires an effective date', () => {
  const draft = baseline({ effectiveFrom: undefined });
  assert.deepEqual(validateBaseline(draft), []);
  assert.ok(canApproveBaseline(draft).some((error) => error.field === 'effectiveFrom'));
});

/* ── Baseline: schedule exposure ────────────────────────────────────────────────────────────── */

test('schedule exposure measures forecast delay against the already-extended date', () => {
  // Measuring against the original and then subtracting the EOT would net the extension off twice.
  const exposure = summariseScheduleExposure({
    originalCompletionDate: '2026-10-30',
    approvedCompletionDate: '2026-11-20',
    forecastCompletionDate: '2026-12-15',
    approvedEotDays: 21,
  });
  assert.equal(exposure.grossForecastDelayDays, 25);
  assert.equal(exposure.approvedEotDays, 21);
  assert.equal(exposure.netExposureDays, 25);
});

test('schedule exposure reports no delay when the forecast is inside the approved date', () => {
  const exposure = summariseScheduleExposure({
    originalCompletionDate: '2026-10-30',
    approvedCompletionDate: '2026-11-20',
    forecastCompletionDate: '2026-11-01',
  });
  assert.equal(exposure.grossForecastDelayDays, 0);
  assert.equal(exposure.netExposureDays, 0);
});

/* ── Progress: supply lane ──────────────────────────────────────────────────────────────────── */

test('an issued purchase order earns only its own stage weight, not the whole line', () => {
  // The failure this mechanism exists to prevent: treating procurement activity as delivery.
  assert.equal(computeSupplyEarnedPct({ ordered: true }, DEFAULT_SUPPLY_EARNING_RULE), 5);
});

test('supply earning accumulates down the gate chain to exactly 100 at client acceptance', () => {
  const facts = {
    ordered: true,
    drawingRequired: true,
    drawingApproved: true,
    mcCleared: true,
    manufacturingProgressPct: 100,
    inspectionPassed: true,
    mdccIssued: true,
    dispatched: true,
    receivedAtSite: true,
    clientAccepted: true,
  };
  assert.equal(computeSupplyEarnedPct(facts, DEFAULT_SUPPLY_EARNING_RULE), 100);
});

test('manufacturing earns proportionally and contributes nothing when unreported', () => {
  const base = { ordered: true, drawingRequired: false, mcCleared: true };
  const none = computeSupplyEarnedPct(base, DEFAULT_SUPPLY_EARNING_RULE);
  const half = computeSupplyEarnedPct(
    { ...base, manufacturingProgressPct: 50 },
    DEFAULT_SUPPLY_EARNING_RULE,
  );
  assert.ok(half > none, 'reported manufacturing progress must earn');
  assert.ok(Number.isFinite(none), 'the one stage with no register must never yield NaN');
});

test('drawing weight is redistributed when a line is not MDL-tracked', () => {
  // Otherwise a box of bolts is capped at 95% forever and never reads as delivered.
  const delivered = {
    ordered: true,
    mcCleared: true,
    manufacturingProgressPct: 100,
    inspectionPassed: true,
    mdccIssued: true,
    dispatched: true,
    receivedAtSite: true,
    clientAccepted: true,
  };
  assert.equal(
    computeSupplyEarnedPct({ ...delivered, drawingRequired: false }, DEFAULT_SUPPLY_EARNING_RULE),
    100,
  );
  assert.equal(
    computeSupplyEarnedPct(
      { ...delivered, drawingRequired: true, drawingApproved: false },
      DEFAULT_SUPPLY_EARNING_RULE,
    ),
    95,
    'a tracked but unapproved drawing withholds its weight',
  );
});

test('a zero-weight rule earns nothing rather than dividing by zero', () => {
  const zeroRule = Object.fromEntries(
    Object.keys(DEFAULT_SUPPLY_EARNING_RULE).map((key) => [key, 0]),
  );
  assert.equal(computeSupplyEarnedPct({ ordered: true }, zeroRule), 0);
  assert.equal(computeSupplyEarnedPct({}, DEFAULT_SUPPLY_EARNING_RULE), 0);
});

/* ── Progress: civil lane ───────────────────────────────────────────────────────────────────── */

test('civil earns on certified quantity over approved quantity', () => {
  assert.equal(computeCivilEarnedPct(48, 100), 48);
  assert.equal(computeCivilEarnedPct(0, 100), 0);
});

test('civil earning is capped at 100 and zero-safe', () => {
  // Over-certification is a scope exception the quantity ladder raises; it must not inflate EV.
  assert.equal(computeCivilEarnedPct(130, 100), 100);
  assert.equal(computeCivilEarnedPct(10, 0), 0);
  assert.equal(computeCivilEarnedPct(-5, 100), 0);
});

/* ── Progress: tower lane ───────────────────────────────────────────────────────────────────── */

const towerFact = (towerNo, progressPct, verifiedProgressPct, extra = {}) => ({
  towerId: `t-${towerNo}`,
  towerNo,
  progressPct,
  verifiedProgressPct,
  ...extra,
});

test('per-tower rollup is the mean of tower progress', () => {
  const result = computeTowerEarnedPct([
    towerFact('T-01', 100, 100),
    towerFact('T-02', 50, 50),
    towerFact('T-03', 0, 0),
  ]);
  assert.equal(result.earnedPct, 50);
  assert.equal(result.towerCount, 3);
  assert.equal(result.countedTowers, 3);
});

test('per-span rollup weights by span length and excludes the spanless last tower', () => {
  // "5 spans strung" only means anything in kilometres, and the final tower carries no span.
  const result = computeTowerEarnedPct([
    towerFact('T-01', 100, 100, { boqBasis: 'per-span', spanToNextM: 300 }),
    towerFact('T-02', 0, 0, { boqBasis: 'per-span', spanToNextM: 100 }),
    towerFact('T-03', 0, 0, { boqBasis: 'per-span' }),
  ]);
  assert.equal(result.earnedPct, 75, '300m complete of 400m total span');
  assert.equal(result.countedTowers, 2, 'the last tower has no span and must not dilute');
});

test('the tower lane reports live and verified progress separately', () => {
  // §3.4a: work awaiting a signature is built, so it earns live; only approved work is verified.
  const result = computeTowerEarnedPct([towerFact('T-01', 100, 100), towerFact('T-02', 100, 0)]);
  assert.equal(result.earnedPct, 100);
  assert.equal(result.verifiedEarnedPct, 50);
});

test('an empty tower set earns nothing rather than dividing by zero', () => {
  const result = computeTowerEarnedPct([]);
  assert.equal(result.earnedPct, 0);
  assert.equal(result.verifiedEarnedPct, 0);
  assert.equal(result.countedTowers, 0);
});

/* ── Progress: lane detection and rollup ────────────────────────────────────────────────────── */

test('lane is detected from Scope 2, the field the module already routes on', () => {
  assert.equal(detectLane({ scope2: 'Civil' }), 'civil');
  assert.equal(detectLane({ 'Scope 2': 'Erection' }), 'erection');
  assert.equal(detectLane({ scope2: 'Supply' }), 'supply');
  assert.equal(detectLane({}), 'supply', 'unclassified lines default to supply');
});

test('a supply line has no verification gap, because every gate is already verified', () => {
  const progress = computeLineProgress(
    {
      boqItemId: 'b1',
      boqItem: { id: 'b1', Unit: 'Nos', QTY: 2, 'Unit Rate': 500000, scope2: 'Supply' },
      supply: { ordered: true, drawingRequired: false },
    },
    DEFAULT_PROJECT_CONTROL_SETTINGS,
  );
  assert.equal(progress.lane, 'supply');
  assert.equal(progress.budgetValue, 1000000);
  assert.equal(progress.earnedPct, progress.verifiedEarnedPct);
  assert.equal(progress.unverifiedValue, 0);
});

test('an erection line carries the verification gap through to money', () => {
  const progress = computeLineProgress(
    {
      boqItemId: 'b2',
      boqItem: { id: 'b2', Unit: 'Nos', QTY: 1, 'Unit Rate': 1000000, scope2: 'Erection' },
      towers: [towerFact('T-01', 100, 100), towerFact('T-02', 100, 0)],
    },
    DEFAULT_PROJECT_CONTROL_SETTINGS,
  );
  assert.equal(progress.lane, 'erection');
  assert.equal(progress.earnedValue, 1000000);
  assert.equal(progress.verifiedEarnedValue, 500000);
  assert.equal(progress.unverifiedValue, 500000);
});

test('the project rollup is value-weighted, skips headers, and reports zero-value lines', () => {
  // Averaging line percentages would let a hundred trivial lines outvote the transformer that is
  // actually the project.
  const rollUp = rollUpProgress(
    [
      { boqItemId: 'h', boqItem: { id: 'h', Description: 'SUPPLY', Unit: '', QTY: '' } },
      {
        boqItemId: 'big',
        boqItem: { id: 'big', Unit: 'Nos', QTY: 1, 'Unit Rate': 9000000, scope2: 'Civil' },
        controlAccountId: 'civ',
        civil: { certifiedQty: 0, approvedQty: 100 },
      },
      {
        boqItemId: 'small',
        boqItem: { id: 'small', Unit: 'Nos', QTY: 1, 'Unit Rate': 1000000, scope2: 'Civil' },
        controlAccountId: 'civ',
        civil: { certifiedQty: 100, approvedQty: 100 },
      },
      {
        boqItemId: 'free',
        boqItem: { id: 'free', Unit: 'Nos', QTY: 1, 'Unit Rate': 0, scope2: 'Supply' },
      },
    ],
    DEFAULT_PROJECT_CONTROL_SETTINGS,
  );

  assert.equal(rollUp.lines.length, 3, 'the section header must be skipped');
  assert.equal(rollUp.budgetValue, 10000000);
  assert.equal(rollUp.earnedValue, 1000000);
  assert.equal(rollUp.earnedPct, 10, 'value-weighted, not the 50% a mean of percentages gives');
  assert.equal(rollUp.zeroValueLineCount, 1);
  assert.equal(rollUp.byControlAccount.get('civ').budgetValue, 10000000);
  assert.equal(rollUp.byControlAccount.get('civ').earnedValue, 1000000);
});

test('the rollup groups by lane and omits lanes with no lines', () => {
  const rollUp = rollUpProgress(
    [
      {
        boqItemId: 'b1',
        boqItem: { id: 'b1', Unit: 'Nos', QTY: 1, 'Unit Rate': 100, scope2: 'Supply' },
        supply: { ordered: true, drawingRequired: false },
      },
    ],
    DEFAULT_PROJECT_CONTROL_SETTINGS,
  );
  assert.equal(rollUp.byLane.length, 1);
  assert.equal(rollUp.byLane[0].lane, 'supply');
});

/* ── EVM ────────────────────────────────────────────────────────────────────────────────────── */

test('EVM computes the standard variances and indices', () => {
  const evm = computeEvm({ bac: 18000000, pv: 7000000, ev: 6200000, ac: 4810000 });
  assert.equal(evm.sv, -800000);
  assert.equal(evm.cv, 1390000);
  assert.equal(evm.spi, 0.886);
  assert.equal(evm.cpi, 1.289);
  assert.equal(evm.behindSchedule, true);
});

test('indices are undefined, never zero or Infinity, before there is a plan or a cost', () => {
  // A project in its first week has AC = 0. A CPI of 0.00 would render as a critical overrun on a
  // project that has not spent anything, and Infinity would render as "∞".
  const fresh = computeEvm({ bac: 18000000, pv: 0, ev: 0, ac: 0 });
  assert.equal(fresh.spi, undefined);
  assert.equal(fresh.cpi, undefined);
  assert.equal(fresh.eacStatistical, undefined);
  assert.equal(fresh.behindSchedule, false, 'no data must not read as behind schedule');
  assert.equal(fresh.overBudget, false);
  assert.equal(formatEvmIndex(fresh.cpi), '—');

  const spentNothing = computeEvm({ bac: 100, pv: 50, ev: 25, ac: 0 });
  assert.equal(spentNothing.cpi, undefined);
  assert.equal(spentNothing.spi, 0.5);
});

test('both EAC forecasts are computed and the owner figure wins for variance', () => {
  const evm = computeEvm({
    bac: 18000000,
    pv: 7000000,
    ev: 6200000,
    ac: 4810000,
    etcBottomUp: 13180000,
  });
  assert.equal(evm.eacBottomUp, 17990000);
  assert.ok(evm.eacStatistical > 0);
  assert.equal(evm.eac, evm.eacBottomUp, 'the accountable forecast is the one variance uses');
  assert.equal(evm.vac, 10000);
  assert.equal(evm.overBudget, false);
});

test('a forecast that disagrees with performance raises a credibility flag', () => {
  // A manager forecasting on budget while running a CPI of 0.8 is either about to recover or is
  // not reforecasting honestly, and nothing else in a report surfaces that.
  const evm = computeEvm({
    bac: 10000000,
    pv: 5000000,
    ev: 4000000,
    ac: 5000000,
    etcBottomUp: 5000000,
    forecastCredibilityGapPct: 5,
  });
  assert.equal(evm.cpi, 0.8);
  assert.equal(evm.eacBottomUp, 10000000);
  assert.equal(evm.eacStatistical, 12500000);
  assert.equal(evm.forecastGapPct, 25);
  assert.equal(evm.forecastCredibilityFlag, true);
});

test('no credibility flag without both forecasts', () => {
  const evm = computeEvm({ bac: 10000000, pv: 5000000, ev: 4000000, ac: 5000000 });
  assert.equal(evm.forecastGapPct, undefined);
  assert.equal(evm.forecastCredibilityFlag, false);
});

test('a forecast overrun is reported as over budget', () => {
  const evm = computeEvm({
    bac: 10000000,
    pv: 5000000,
    ev: 4000000,
    ac: 5000000,
    etcBottomUp: 6000000,
  });
  assert.equal(evm.eacBottomUp, 11000000);
  assert.equal(evm.vac, -1000000);
  assert.equal(evm.overBudget, true);
});

test('TCPI is undefined once actual cost has consumed the whole budget', () => {
  // At that point no efficiency saves it, and a huge or negative number would imply a target
  // rather than an impossibility.
  assert.equal(computeEvm({ bac: 1000, pv: 900, ev: 500, ac: 1000 }).tcpi, undefined);
  assert.equal(computeEvm({ bac: 1000, pv: 500, ev: 500, ac: 400 }).tcpi, 0.833);
});

test('forecast completion stretches the planned duration by 1/SPI', () => {
  const evm = computeEvm({
    bac: 100,
    pv: 50,
    ev: 25,
    ac: 25,
    plannedStartDate: '2026-01-01',
    plannedEndDate: '2026-12-31',
  });
  assert.equal(evm.spi, 0.5);
  assert.equal(evm.forecastSlipDays, 364, 'half the pace doubles a 364-day plan');
  // 2026-01-01 + 728 days. 2026 is a leap year, so this lands on the 30th, not the 31st — the
  // date is advanced by calendar days rather than by a 365-day year.
  assert.equal(evm.forecastCompletionDate, '2027-12-30');
});

test('forecast completion is skipped rather than guessed without a plan or an SPI', () => {
  assert.equal(computeEvm({ bac: 100, pv: 50, ev: 25, ac: 25 }).forecastCompletionDate, undefined);
  assert.equal(
    computeEvm({
      bac: 100,
      pv: 0,
      ev: 0,
      ac: 0,
      plannedStartDate: '2026-01-01',
      plannedEndDate: '2026-12-31',
    }).forecastCompletionDate,
    undefined,
  );
});

test('index health reads an absent index as unknown, not as critical', () => {
  assert.equal(evmIndexHealth(undefined, 0.95), 'unknown');
  assert.equal(evmIndexHealth(0.9, 0.95), 'bad');
  assert.equal(evmIndexHealth(0.97, 0.95), 'warn');
  assert.equal(evmIndexHealth(1.05, 0.95), 'good');
});
