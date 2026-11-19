import assert from 'node:assert/strict';
import test from 'node:test';

const {
  formatJmcAmount,
  jmcApprovedSteps,
  jmcDate,
  jmcRaisedOn,
  jmcQuantityCheck,
  jmcStageIndex,
  jmcTotals,
  summariseJmcRegister,
} = await import('../src/lib/project-management-jmc-dashboard.ts');

/* ── Fixtures ───────────────────────────────────────────────────────────────────────────────── */

const steps = [
  { id: '1', name: 'Verification of JMC' },
  { id: '2', name: 'Submission of JMC' },
  { id: '3', name: 'Certified JMC' },
];

const approve = (stepName, timestamp) => ({ stepName, action: 'Approve', timestamp });

const entry = (id, overrides = {}) => ({
  id,
  jmcDate: '2026-11-10T00:00:00.000Z',
  items: [{ rate: 100, certifiedQty: 2, executedQty: 3 }],
  history: [],
  ...overrides,
});

const NOW = new Date('2026-11-19T00:00:00.000Z');

/* ── Dates ──────────────────────────────────────────────────────────────────────────────────── */

test('jmcDate reads the three shapes the register holds', () => {
  assert.equal(jmcDate('2026-11-10T00:00:00.000Z')?.getUTCFullYear(), 2026);
  assert.equal(jmcDate({ seconds: 1763337600 })?.getTime(), 1763337600 * 1000);
  const date = new Date('2026-01-02T00:00:00.000Z');
  assert.equal(jmcDate(date)?.getTime(), date.getTime());
});

test('jmcDate rejects what it cannot read rather than inventing a date', () => {
  assert.equal(jmcDate(null), null);
  assert.equal(jmcDate(''), null);
  assert.equal(jmcDate('not a date'), null);
  assert.equal(jmcDate({}), null);
});

test('a certificate is raised on its JMC date, falling back to when it was created', () => {
  assert.equal(
    jmcRaisedOn({ id: 'a', jmcDate: '2026-11-10T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' })?.getUTCMonth(),
    10,
  );
  assert.equal(jmcRaisedOn({ id: 'b', createdAt: '2026-01-01T00:00:00.000Z' })?.getUTCMonth(), 0);
  assert.equal(jmcRaisedOn({ id: 'c' }), null);
});

/* ── Value ──────────────────────────────────────────────────────────────────────────────────── */

test('a line with a stored total is worth that total, not a recomputed one', () => {
  // 7 × 100 would be 700; the stored figure is what the certificate itself shows.
  const { total } = jmcTotals([{ rate: 100, certifiedQty: 7, totalAmount: 650 }]);
  assert.equal(total, 650);
});

test('a line without a stored total falls back to certified quantity, then executed', () => {
  assert.equal(jmcTotals([{ rate: 100, certifiedQty: 2, executedQty: 9 }]).total, 200);
  assert.equal(jmcTotals([{ rate: 100, executedQty: 9 }]).total, 900);
});

test('certified value never falls back to the executed quantity', () => {
  // Executed but uncertified work is worth nothing yet — that is the whole point of certification.
  assert.equal(jmcTotals([{ rate: 100, executedQty: 9 }]).certified, 0);
  assert.equal(jmcTotals([{ rate: 100, certifiedQty: 2, executedQty: 9 }]).certified, 200);
});

test('certified value ignores a stored total, which covers the whole line', () => {
  assert.equal(jmcTotals([{ rate: 100, certifiedQty: 2, totalAmount: 650 }]).certified, 200);
});

test('unreadable numbers count as zero rather than poisoning the total with NaN', () => {
  const { total, certified } = jmcTotals([{ rate: 'abc', certifiedQty: undefined }, { rate: 50, certifiedQty: 2 }]);
  assert.equal(total, 100);
  assert.equal(certified, 100);
});

test('no items is zero, not an error', () => {
  assert.deepEqual(jmcTotals(), { total: 0, certified: 0 });
  assert.deepEqual(jmcTotals([]), { total: 0, certified: 0 });
});

/* ── Stage ──────────────────────────────────────────────────────────────────────────────────── */

test('only approving actions complete a step', () => {
  const approved = jmcApprovedSteps([
    approve('Verification of JMC', '2026-11-11'),
    { stepName: 'Submission of JMC', action: 'Reject', timestamp: '2026-11-12' },
    { stepName: 'Submission of JMC', action: 'Comment', timestamp: '2026-11-12' },
  ]);
  assert.deepEqual([...approved], ['Verification of JMC']);
});

test('a fresh certificate sits at the first step', () => {
  assert.equal(jmcStageIndex(entry('a'), steps), 0);
});

test('a certificate sits at the first step it has not cleared', () => {
  assert.equal(jmcStageIndex(entry('a', { history: [approve('Verification of JMC', '2026-11-11')] }), steps), 1);
});

test('clearing every step puts a certificate past the end of the run', () => {
  const history = steps.map((step) => approve(step.name, '2026-11-12'));
  assert.equal(jmcStageIndex(entry('a', { history }), steps), steps.length);
});

test('a skipped step is reported as the gap, not papered over by a later approval', () => {
  // The workflow can be reconfigured under certificates already in flight. Counting approvals
  // would call this one "two steps done"; it is actually still waiting on the first.
  const history = [approve('Submission of JMC', '2026-11-12'), approve('Certified JMC', '2026-11-13')];
  assert.equal(jmcStageIndex(entry('a', { history }), steps), 0);
});

test('with no workflow configured nothing is complete', () => {
  const reading = summariseJmcRegister({ entries: [entry('a')], steps: [], now: NOW });
  assert.equal(reading.completed, 0);
  assert.equal(reading.inProgress, 1);
  assert.deepEqual(reading.stages, []);
});

/* ── The reading ────────────────────────────────────────────────────────────────────────────── */

test('every certificate is counted once, as waiting at exactly one step', () => {
  const entries = [
    entry('a'),
    entry('b', { history: [approve('Verification of JMC', '2026-11-11')] }),
    entry('c', { history: steps.map((step) => approve(step.name, '2026-11-12')) }),
  ];
  const reading = summariseJmcRegister({ entries, steps, now: NOW });

  assert.equal(reading.count, 3);
  assert.equal(reading.completed, 1);
  assert.equal(reading.inProgress, 2);
  assert.equal(
    reading.stages.reduce((sum, stage) => sum + stage.waiting, 0),
    reading.inProgress,
  );
  assert.deepEqual(
    reading.stages.map((stage) => stage.waiting),
    [1, 1, 0],
  );
});

test('a step counts everything that has passed through it, finished or not', () => {
  const entries = [
    entry('a'),
    entry('b', { history: [approve('Verification of JMC', '2026-11-11')] }),
    entry('c', { history: steps.map((step) => approve(step.name, '2026-11-12')) }),
  ];
  const { stages } = summariseJmcRegister({ entries, steps, now: NOW });
  assert.deepEqual(
    stages.map((stage) => stage.cleared),
    [2, 1, 1],
  );
});

test('value and certified value add up across the register', () => {
  const entries = [
    entry('a', { items: [{ rate: 100, certifiedQty: 2, executedQty: 3 }] }),
    entry('b', { items: [{ rate: 50, executedQty: 4 }] }),
  ];
  const reading = summariseJmcRegister({ entries, steps, now: NOW });
  assert.equal(reading.totalValue, 200 + 200);
  assert.equal(reading.certifiedValue, 200);
});

test('a certified quantity of zero is a figure, not a missing one', () => {
  // `certifiedQty ?? executedQty` means an explicit 0 stands: a line measured but certified at
  // nothing is worth nothing, and does NOT quietly fall back to the executed quantity. This is
  // the JMC log's own rule, kept deliberately so the two screens never disagree on a total.
  assert.equal(jmcTotals([{ rate: 50, certifiedQty: 0, executedQty: 4 }]).total, 0);
  assert.equal(jmcTotals([{ rate: 50, executedQty: 4 }]).total, 200);
});

test('the month series always spans the asked-for window, gaps included', () => {
  const reading = summariseJmcRegister({ entries: [entry('a')], steps, now: NOW, months: 6 });
  assert.equal(reading.months.length, 6);
  assert.equal(reading.months[reading.months.length - 1].key, '2026-11');
  assert.equal(reading.months[0].key, '2026-06');
  assert.equal(reading.months[reading.months.length - 1].raised, 1);
  assert.equal(reading.months[0].raised, 0);
});

test('a certificate older than the window is still valued, just not plotted', () => {
  const old = entry('old', { jmcDate: '2024-01-05T00:00:00.000Z' });
  const reading = summariseJmcRegister({ entries: [old], steps, now: NOW });
  assert.equal(reading.count, 1);
  assert.equal(reading.certifiedValue, 200);
  assert.equal(
    reading.months.reduce((sum, month) => sum + month.raised, 0),
    0,
  );
});

test('the oldest wait counts only unfinished certificates', () => {
  const entries = [
    entry('done', { jmcDate: '2024-01-05T00:00:00.000Z', history: steps.map((s) => approve(s.name, '2024-02-01')) }),
    entry('open', { jmcDate: '2026-11-09T00:00:00.000Z' }),
  ];
  assert.equal(summariseJmcRegister({ entries, steps, now: NOW }).oldestWaitingDays, 10);
});

/* ── The quantity guard ─────────────────────────────────────────────────────────────────────── */

test('an executed quantity within the uncertified balance is fine', () => {
  const check = jmcQuantityCheck({ executedQty: 30, boqQty: 100, totalCertifiedQty: 60 });
  assert.deepEqual(check, { balance: 40, excess: 0, over: false, unchecked: false });
});

test('the balance is what previous certificates left, not the whole BOQ quantity', () => {
  const check = jmcQuantityCheck({ executedQty: 50, boqQty: 100, totalCertifiedQty: 60 });
  assert.equal(check.balance, 40);
  assert.equal(check.excess, 10);
  assert.equal(check.over, true);
});

test('exactly exhausting the balance is within it, not over', () => {
  assert.equal(jmcQuantityCheck({ executedQty: 40, boqQty: 100, totalCertifiedQty: 60 }).over, false);
});

test('a fully certified line has no balance left', () => {
  const check = jmcQuantityCheck({ executedQty: 1, boqQty: 100, totalCertifiedQty: 100 });
  assert.equal(check.balance, 0);
  assert.equal(check.over, true);
});

test('certification beyond the BOQ quantity does not produce a negative balance', () => {
  // The register can already hold more certified than the line carries — a variation, or an
  // over-measurement from before this check existed. The balance floors at zero rather than
  // going negative and quietly licensing more.
  const check = jmcQuantityCheck({ executedQty: 0, boqQty: 100, totalCertifiedQty: 130 });
  assert.equal(check.balance, 0);
  assert.equal(check.over, false);
});

test('a line with no BOQ quantity is unchecked, not over and not within', () => {
  for (const boqQty of [0, null, undefined, '']) {
    const check = jmcQuantityCheck({ executedQty: 999, boqQty, totalCertifiedQty: 0 });
    assert.equal(check.unchecked, true, `boqQty ${String(boqQty)}`);
    assert.equal(check.over, false, `boqQty ${String(boqQty)}`);
  }
});

test('quantities arriving as strings are read as numbers', () => {
  const check = jmcQuantityCheck({ executedQty: '50', boqQty: '100', totalCertifiedQty: '60' });
  assert.equal(check.over, true);
  assert.equal(check.excess, 10);
});

test('amounts read in lakh and crore, and a bad number does not print NaN', () => {
  assert.equal(formatJmcAmount(48000), '₹48,000');
  assert.equal(formatJmcAmount(18_40_000), '₹18.40 L');
  assert.equal(formatJmcAmount(3_20_00_000), '₹3.20 Cr');
  assert.equal(formatJmcAmount(-1_00_000), '-₹1.00 L');
  assert.equal(formatJmcAmount(Number.NaN), '₹0');
});

test('an empty register reads as empty, not as an error', () => {
  const reading = summariseJmcRegister({ entries: [], steps, now: NOW });
  assert.equal(reading.count, 0);
  assert.equal(reading.totalValue, 0);
  assert.equal(reading.oldestWaitingDays, null);
  assert.deepEqual(
    reading.stages.map((stage) => stage.waiting),
    [0, 0, 0],
  );
});
