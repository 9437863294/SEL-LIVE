import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from the schedule module rather than `recurring-payments.ts`, which re-exports a
// Firestore-client helper that only resolves inside the bundler.
import {
  buildRecurringCycle,
  buildRecurringCycleSchedule,
  describeRecurrence,
  normalizeDueDateRule,
  pendingRecurringCycles,
  recurrenceLeadDays,
} from '../src/lib/recurring-payments-schedule.ts';

/** The schedule is pure date math, so every case pins `asOf` rather than depending on today. */
const asOf = (value) => new Date(`${value}T09:30:00`);

const utilityMaster = {
  frequency: 'Monthly',
  startDate: '2026-08-18',
  billDateRule: 'End of billing period',
  dueDateRule: 'Days after bill date',
  dueDay: 25,
  gracePeriodDays: 0,
  generateLeadDays: 1,
};

test('monthly cycle resolves the full derived date chain', () => {
  const cycle = buildRecurringCycle(utilityMaster, asOf('2026-09-10'));
  assert.equal(cycle.billingPeriodStart, '2026-09-01');
  assert.equal(cycle.billingPeriodEnd, '2026-09-30');
  assert.equal(cycle.expectedBillDate, '2026-09-30');
  assert.equal(cycle.dueDate, '2026-10-25');
  assert.equal(cycle.overdueDate, '2026-10-25');
  assert.equal(cycle.generationDate, '2026-09-29');
});

test('a master starting mid-month keeps the configured due offset on its partial first cycle', () => {
  // The previous calculation treated dueDay as an offset from the period start and clamped it to
  // the period length, so this cycle's due date collapsed onto the period end (2026-08-31).
  const cycle = buildRecurringCycle(utilityMaster, asOf('2026-08-19'));
  assert.equal(cycle.billingPeriodStart, '2026-08-18');
  assert.equal(cycle.billingPeriodEnd, '2026-08-31');
  assert.equal(cycle.expectedBillDate, '2026-08-31');
  assert.equal(cycle.dueDate, '2026-09-25');
});

test('generation date never precedes the master start date, however long the lead time', () => {
  const cycle = buildRecurringCycle({ ...utilityMaster, generateLeadDays: 60 }, asOf('2026-08-19'));
  assert.equal(cycle.generationDate, '2026-08-18');
});

test('grace period pushes the overdue date past the due date', () => {
  const cycle = buildRecurringCycle({ ...utilityMaster, gracePeriodDays: 5 }, asOf('2026-09-10'));
  assert.equal(cycle.dueDate, '2026-10-25');
  assert.equal(cycle.overdueDate, '2026-10-30');
});

test('fixed day of month rolls forward when the day already passed before the bill exists', () => {
  const master = {
    ...utilityMaster,
    dueDateRule: 'Fixed day of month',
    dueDay: 5,
  };
  // Bill lands 30 Sep; the 5th of September is already gone, so payment is due 5 Oct.
  assert.equal(buildRecurringCycle(master, asOf('2026-09-10')).dueDate, '2026-10-05');
});

test('advance-billed masters (rent) keep the due day inside the period they cover', () => {
  const rent = {
    ...utilityMaster,
    billDateRule: 'Start of billing period',
    dueDateRule: 'Fixed day of month',
    dueDay: 5,
  };
  const cycle = buildRecurringCycle(rent, asOf('2026-09-10'));
  assert.equal(cycle.expectedBillDate, '2026-09-01');
  assert.equal(cycle.dueDate, '2026-09-05');
});

test('a due day beyond the month length clamps instead of spilling into the next month', () => {
  const master = {
    frequency: 'Monthly',
    startDate: '2027-01-01',
    billDateRule: 'Start of billing period',
    dueDateRule: 'Fixed day of month',
    dueDay: 31,
  };
  assert.equal(buildRecurringCycle(master, asOf('2027-02-10')).dueDate, '2027-02-28');
});

test('last working day of month steps back off a weekend', () => {
  const master = {
    frequency: 'Monthly',
    startDate: '2026-09-01',
    billDateRule: 'Start of billing period',
    dueDateRule: 'Last working day of month',
    dueDay: 1,
  };
  // 31 Oct 2026 is a Saturday, so the last working day is Friday the 30th.
  assert.equal(buildRecurringCycle(master, asOf('2026-10-05')).dueDate, '2026-10-30');
});

test('legacy masters reproduce the due date they were saved with', () => {
  // No billDateRule and no generateLeadDays — exactly how masters were stored before the rewrite.
  // The old math was periodStart + (dueDay - 1), which for a full month equals the dueDay itself.
  const legacy = {
    frequency: 'Monthly',
    startDate: '2026-01-01',
    dueDateRule: 'Fixed day of month',
    dueDay: 10,
    generateBeforeDueDays: 14,
  };
  const cycle = buildRecurringCycle(legacy, asOf('2026-09-20'));
  assert.equal(cycle.dueDate, '2026-09-10');
  assert.equal(recurrenceLeadDays(legacy), 14);
});

test('legacy due-rule wording maps onto the computable rule set', () => {
  assert.equal(normalizeDueDateRule('Days after generation date'), 'Days after bill date');
  assert.equal(normalizeDueDateRule('Custom date logic'), 'Days after bill date');
  assert.equal(normalizeDueDateRule('Last working day'), 'Last working day of month');
  assert.equal(normalizeDueDateRule(undefined), 'Days after bill date');
  assert.equal(normalizeDueDateRule('Fixed day of month'), 'Fixed day of month');
});

test('cycle keys stay stable across frequencies so obligations are not regenerated', () => {
  assert.equal(buildRecurringCycle(utilityMaster, asOf('2026-09-10')).key, '2026-09');
  assert.equal(
    buildRecurringCycle({ ...utilityMaster, frequency: 'Quarterly' }, asOf('2026-09-10')).key,
    '2026-07-3M',
  );
  assert.equal(
    buildRecurringCycle({ ...utilityMaster, frequency: 'Weekly' }, asOf('2026-09-10')).key,
    '2026-W37',
  );
  // 10 Sep still falls in the first 30-day interval, which runs 18 Aug – 16 Sep.
  assert.equal(
    buildRecurringCycle(
      { ...utilityMaster, frequency: 'Custom', customIntervalDays: 30 },
      asOf('2026-09-10'),
    ).key,
    'C0001-2026-08-18',
  );
  assert.equal(
    buildRecurringCycle({ ...utilityMaster, frequency: 'Renewable' }, asOf('2026-09-10')).key,
    'R2026-08-18',
  );
});

test('cycles outside the master start/end window resolve to nothing', () => {
  assert.equal(buildRecurringCycle(utilityMaster, asOf('2026-08-01')), null);
  assert.equal(
    buildRecurringCycle({ ...utilityMaster, endDate: '2026-09-30' }, asOf('2026-10-05')),
    null,
  );
});

test('schedule preview returns consecutive cycles and stops at the end date', () => {
  const cycles = buildRecurringCycleSchedule(utilityMaster, { from: asOf('2026-08-19'), count: 3 });
  // Labels come from the en-IN short-month format the module has always used ("Sept", not "Sep").
  assert.deepEqual(cycles.map((cycle) => cycle.label), ['Aug 2026', 'Sept 2026', 'Oct 2026']);
  assert.deepEqual(cycles.map((cycle) => cycle.dueDate), ['2026-09-25', '2026-10-25', '2026-11-25']);

  const bounded = buildRecurringCycleSchedule(
    { ...utilityMaster, endDate: '2026-09-30' },
    { from: asOf('2026-08-19'), count: 3 },
  );
  assert.equal(bounded.length, 2);
});

test('schedule preview starts at the first cycle when the master begins in the future', () => {
  const cycles = buildRecurringCycleSchedule(utilityMaster, { from: asOf('2026-01-01'), count: 2 });
  assert.equal(cycles[0].billingPeriodStart, '2026-08-18');
});

test('pending cycles include a lookahead cycle already inside its lead-time window', () => {
  const eager = { ...utilityMaster, generateLeadDays: 40 };
  // On 25 Sep the Oct cycle's bill date (31 Oct) is 36 days out — inside a 40-day lead time.
  const cycles = pendingRecurringCycles(eager, asOf('2026-09-25'));
  assert.deepEqual(cycles.map((cycle) => cycle.key), ['2026-09', '2026-10']);
});

test('nothing is pending while the current cycle is still ahead of its lead-time window', () => {
  // Bill isn't expected until 30 Sep and the lead time is one day, so on 10 Sep the obligation
  // must not exist yet — the lead time is the whole point of the setting.
  assert.deepEqual(pendingRecurringCycles(utilityMaster, asOf('2026-09-10')), []);
  assert.deepEqual(
    pendingRecurringCycles(utilityMaster, asOf('2026-09-29')).map((cycle) => cycle.key),
    ['2026-09'],
  );
});

test('a cycle whose window opened long ago still comes back so a missed run catches up', () => {
  // Bill expected 31 Oct with a 25-day lead: the window opened on 6 Oct. Three weeks later the
  // cycle must still be generated rather than skipped for good.
  const cycles = pendingRecurringCycles(
    { ...utilityMaster, generateLeadDays: 25 },
    asOf('2026-10-28'),
  );
  assert.deepEqual(cycles.map((cycle) => cycle.key), ['2026-10']);
});

test('pending cycles are empty outside the master date range, distinctly from not-yet-due', () => {
  assert.deepEqual(pendingRecurringCycles(utilityMaster, asOf('2026-08-01')), []);
  assert.equal(buildRecurringCycle(utilityMaster, asOf('2026-08-01')), null);
  // Not yet due: empty pending list, but the cycle itself resolves.
  assert.deepEqual(pendingRecurringCycles(utilityMaster, asOf('2026-09-10')), []);
  assert.ok(buildRecurringCycle(utilityMaster, asOf('2026-09-10')));
});

/**
 * The two real postpaid telecom bills this pattern was taken from:
 *   period 17-Jun..16-Jul 2026 → bill 18-Jul-2026 → pay by 05-Aug-2026
 *   period 17-Jul..16-Aug 2026 → bill 18-Aug-2026 → pay by 05-Sep-2026
 */
const telecomMaster = {
  frequency: 'Monthly',
  startDate: '2026-06-17',
  periodAnchorDay: 17,
  billDateRule: 'Days after period end',
  billDayOffset: 2,
  dueDateRule: 'Fixed day of month',
  dueDay: 5,
  gracePeriodDays: 0,
  generateLeadDays: 3,
};

test('a mid-month period anchor reproduces a real 17th-to-16th telecom bill cycle', () => {
  const cycles = buildRecurringCycleSchedule(telecomMaster, { from: asOf('2026-06-20'), count: 3 });
  assert.deepEqual(
    cycles.map((cycle) => [cycle.billingPeriodStart, cycle.billingPeriodEnd, cycle.expectedBillDate, cycle.dueDate]),
    [
      ['2026-06-17', '2026-07-16', '2026-07-18', '2026-08-05'],
      ['2026-07-17', '2026-08-16', '2026-08-18', '2026-09-05'],
      ['2026-08-17', '2026-09-16', '2026-09-18', '2026-10-05'],
    ],
  );
  // Anchored periods span two calendar months, so they're labelled as a range, not "Jul 2026".
  assert.equal(cycles[0].label, '2026-06-17 to 2026-07-16');
});

test('an anchored cycle claims dates on both sides of the anchor day', () => {
  // 16 Jul still belongs to the period that opened 17 Jun; 17 Jul opens the next one.
  assert.equal(buildRecurringCycle(telecomMaster, asOf('2026-07-16')).billingPeriodStart, '2026-06-17');
  assert.equal(buildRecurringCycle(telecomMaster, asOf('2026-07-17')).billingPeriodStart, '2026-07-17');
});

test('the default anchor leaves calendar-month periods and cycle keys untouched', () => {
  const anchored = { ...utilityMaster, periodAnchorDay: 1 };
  const plain = buildRecurringCycle(utilityMaster, asOf('2026-09-10'));
  assert.deepEqual(buildRecurringCycle(anchored, asOf('2026-09-10')), plain);
  assert.equal(plain.billingPeriodStart, '2026-09-01');
  assert.equal(plain.billingPeriodEnd, '2026-09-30');
  assert.equal(plain.key, '2026-09');
});

test('an anchor day past a short month clamps rather than skipping the period', () => {
  const master = { ...telecomMaster, startDate: '2027-01-31', periodAnchorDay: 31 };
  const cycle = buildRecurringCycle(master, asOf('2027-02-10'));
  assert.equal(cycle.billingPeriodStart, '2027-01-31');
  assert.equal(cycle.billingPeriodEnd, '2027-02-27');
});

test('describeRecurrence names the anchored period window', () => {
  assert.match(
    describeRecurrence(telecomMaster),
    /period runs day 17 to day 16 of the next month/,
  );
});

test('describeRecurrence states every rule in the chain', () => {
  const summary = describeRecurrence({ ...utilityMaster, gracePeriodDays: 3 });
  assert.match(summary, /^Monthly · /);
  assert.match(summary, /bill expected on the last day of each period/);
  assert.match(summary, /payment due 25 day\(s\) after the bill date/);
  assert.match(summary, /overdue after 3 grace day\(s\)/);
  assert.match(summary, /obligation created 1 day\(s\) before the bill date/);
});
