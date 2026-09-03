import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from the schedule module rather than `recurring-payments.ts`, which re-exports a
// Firestore-client helper that only resolves inside the bundler.
import {
  actionableRecurringCycle,
  buildRecurringCycle,
  buildRecurringCycleSchedule,
  describeRecurrence,
  normalizeDueDateRule,
  pendingRecurringCycles,
  recurrenceLeadDays,
} from '../src/lib/recurring-payments-schedule.ts';
// Workflow entry logic lives in its own dependency-free module for exactly this reason.
import {
  isWorkflowActivationDue,
  resolveAssignees,
  resolveEntryAssignees,
  resolveWorkflowActivation,
  stepStatus,
} from '../src/lib/recurring-payments-workflow.ts';

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
  // The key is the obligation's Firestore document id, so these must not drift.
  assert.equal(buildRecurringCycle(utilityMaster, asOf('2026-09-10')).key, '2026-09');
  // Multi-month frequencies are phased from the master's start period (this master starts
  // 18 Aug), not snapped to an absolute every-third-month grid. The snapped grid put the start
  // date at the tail of a bucket that predated the master and produced stub first periods — see
  // the dedicated test below. That re-phasing moved this key from '2026-07-3M' to '2026-08-3M',
  // the one deliberate key change; Monthly/Weekly/Custom/Renewable are untouched.
  assert.equal(
    buildRecurringCycle({ ...utilityMaster, frequency: 'Quarterly' }, asOf('2026-09-10')).key,
    '2026-08-3M',
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
  assert.deepEqual(cycles.map((cycle) => cycle.key), ['2026-08', '2026-09', '2026-10']);
});

test('nothing is pending while the first cycle is still ahead of its lead-time window', () => {
  // Bill isn't expected until 31 Aug and the lead time is one day, so on 20 Aug the obligation
  // must not exist yet — the lead time is the whole point of the setting.
  assert.deepEqual(pendingRecurringCycles(utilityMaster, asOf('2026-08-20')), []);
  assert.deepEqual(
    pendingRecurringCycles(utilityMaster, asOf('2026-08-30')).map((cycle) => cycle.key),
    ['2026-08'],
  );
});

test('a closed cycle whose bill has arrived stays pending until it is written', () => {
  // On 10 Sep the August period has closed and its bill (31 Aug) is due 25 Sep, so it is still
  // owed an obligation even though today sits in the September period.
  const cycles = pendingRecurringCycles(utilityMaster, asOf('2026-09-10'));
  assert.deepEqual(cycles.map((cycle) => cycle.key), ['2026-08']);
});

test('a cycle whose window opened long ago still comes back so a missed run catches up', () => {
  // Bill expected 31 Oct with a 25-day lead: the window opened on 6 Oct. Three weeks later the
  // cycle must still be generated rather than skipped for good.
  const cycles = pendingRecurringCycles(
    { ...utilityMaster, generateLeadDays: 25 },
    asOf('2026-10-28'),
  );
  assert.ok(cycles.some((cycle) => cycle.key === '2026-10'));
});

test('pending cycles are empty outside the master date range, distinctly from not-yet-due', () => {
  assert.deepEqual(pendingRecurringCycles(utilityMaster, asOf('2026-08-01')), []);
  assert.equal(buildRecurringCycle(utilityMaster, asOf('2026-08-01')), null);
  // Not yet due: empty pending list, but the cycle itself resolves.
  assert.deepEqual(pendingRecurringCycles(utilityMaster, asOf('2026-08-20')), []);
  assert.ok(buildRecurringCycle(utilityMaster, asOf('2026-08-20')));
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

test('an arrears cycle is generated after its period closes, not skipped', () => {
  // The reported defect: on 19 Aug the 17 Jul – 16 Aug period has closed, but its bill is dated
  // 18 Aug and due 5 Sep, so its obligation must exist. Looking only forward from the cycle
  // containing today found nothing at all and dropped that bill permanently.
  const cycles = pendingRecurringCycles(telecomMaster, asOf('2026-08-19'));
  const july = cycles.find((cycle) => cycle.billingPeriodStart === '2026-07-17');
  assert.ok(july, 'the closed July cycle must be pending generation');
  assert.equal(july.expectedBillDate, '2026-08-18');
  assert.equal(july.dueDate, '2026-09-05');
  // The cycle today actually falls inside is not yet due — its bill arrives 18 Sep.
  assert.ok(!cycles.some((cycle) => cycle.billingPeriodStart === '2026-08-17'));
});

test('lookbehind is bounded so activating an old master does not backfill its history', () => {
  const old = { ...telecomMaster, startDate: '2024-01-17' };
  const cycles = pendingRecurringCycles(old, asOf('2026-08-19'));
  assert.equal(cycles.length, 3, 'three cycles back, not two and a half years of them');
  assert.equal(cycles.at(-1).billingPeriodStart, '2026-07-17');
  assert.deepEqual(
    pendingRecurringCycles(old, asOf('2026-08-19'), { lookbehind: 0 }),
    [],
    'with no lookbehind the arrears cycle is missed, which is what the default guards against',
  );
});

test('manual generation targets the same cycle automation would', () => {
  // A master started on its own anchor day: on 19 Aug the only cycle that exists is 17 Jul – 16 Aug,
  // whose bill (18 Aug) is due 5 Sep. "Generate now" previously created 17 Aug – 16 Sep instead —
  // a period the vendor has not billed — leaving the outstanding one missing.
  const master = { ...telecomMaster, startDate: '2026-07-17' };
  const today = asOf('2026-08-19');
  const actionable = actionableRecurringCycle(master, today);
  assert.equal(actionable.billingPeriodStart, '2026-07-17');
  assert.equal(actionable.billingPeriodEnd, '2026-08-16');
  assert.equal(actionable.dueDate, '2026-09-05');
  // Whereas the cycle today merely falls inside is the wrong one to write.
  assert.equal(buildRecurringCycle(master, today).billingPeriodStart, '2026-08-17');
  assert.equal(actionable.key, pendingRecurringCycles(master, today)[0].key);
});

test('manual generation falls back to the current cycle when nothing is pending', () => {
  // Nothing is due yet on 20 Aug, but "Generate now" must still offer a cycle to create.
  assert.deepEqual(pendingRecurringCycles(utilityMaster, asOf('2026-08-20')), []);
  assert.equal(
    actionableRecurringCycle(utilityMaster, asOf('2026-08-20')).key,
    buildRecurringCycle(utilityMaster, asOf('2026-08-20')).key,
  );
  // And nothing at all outside the master's date range.
  assert.equal(actionableRecurringCycle(utilityMaster, asOf('2026-08-01')), null);
});

test('the preview opens on the earliest cycle still awaiting generation', () => {
  // Otherwise the form hides the obligation automation is about to create.
  const cycles = buildRecurringCycleSchedule(telecomMaster, { from: asOf('2026-08-19'), count: 3 });
  assert.equal(cycles[0].billingPeriodStart, '2026-06-17');
  assert.deepEqual(
    cycles.map((cycle) => cycle.dueDate),
    ['2026-08-05', '2026-09-05', '2026-10-05'],
  );
});

test('workflow activation starts when the bill is expected, not only near the due date', () => {
  // The reported defect: bill raised 18 Aug, due 5 Sep, org activation window 7 days. Anchored to
  // the due date alone the obligation stayed Scheduled and unassigned until 29 Aug — through the
  // whole period its owner was supposed to be collecting that bill.
  const payment = { dueDate: '2026-09-05', expectedBillDate: '2026-08-18' };
  const options = { activationDays: 7 };
  assert.equal(isWorkflowActivationDue(payment, { ...options, today: asOf('2026-08-17') }), false);
  assert.equal(isWorkflowActivationDue(payment, { ...options, today: asOf('2026-08-18') }), true);
  assert.equal(isWorkflowActivationDue(payment, { ...options, today: asOf('2026-08-19') }), true);
});

test('the due-date activation window still applies when no bill date is stored', () => {
  // Manual payments and pre-rewrite obligations have no expectedBillDate and must not change.
  const legacy = { dueDate: '2026-09-05' };
  const options = { activationDays: 7 };
  assert.equal(isWorkflowActivationDue(legacy, { ...options, today: asOf('2026-08-19') }), false);
  assert.equal(isWorkflowActivationDue(legacy, { ...options, today: asOf('2026-08-29') }), true);
  // And an obligation already overdue is always activation-due.
  assert.equal(isWorkflowActivationDue(legacy, { ...options, today: asOf('2026-10-01') }), true);
});

test('activation timing ignores the time of day it is evaluated at', () => {
  const payment = { dueDate: '2026-09-05' };
  const options = { activationDays: 7 };
  // 29 Aug is exactly 7 days out; the answer must not flip with the clock.
  for (const hour of ['T00:30:00', 'T13:45:00', 'T23:15:00']) {
    assert.equal(
      isWorkflowActivationDue(payment, { ...options, today: new Date(`2026-08-29${hour}`) }),
      true,
      `failed at ${hour}`,
    );
  }
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

/* ---------------------------------------------------------------------------
 * Workflow entry. This path has regressed repeatedly — obligations generating
 * but never reaching anyone's queue — so each failure mode is pinned here.
 * ------------------------------------------------------------------------- */

const ownerPayment = {
  assignedTo: 'user-owner',
  backupAssignedTo: 'user-backup',
  expectedAmount: 17_658,
  dueDate: '2026-09-05',
  expectedBillDate: '2026-08-18',
};
const billCollection = {
  id: '1',
  name: 'Bill Collection',
  description: '',
  tat: 24,
  assignmentType: 'Payment-owner',
  assignedTo: [],
  actions: [],
  uploadRequired: true,
};

test('an unconfigured User-based entry step falls back to the payment owner', () => {
  // The reported defect: "Generate all" created obligations that never entered the workflow. A
  // first step left as User-based with no users chosen resolved to nobody, so the obligation was
  // written as Scheduled with an empty assignee list — work no queue showed and nobody owned.
  const unconfigured = { ...billCollection, assignmentType: 'User-based', assignedTo: [] };
  assert.deepEqual(resolveAssignees(unconfigured, ownerPayment), []);
  assert.deepEqual(resolveEntryAssignees(unconfigured, ownerPayment), ['user-owner']);

  const activation = resolveWorkflowActivation(unconfigured, ownerPayment, {
    activationDays: 7,
    today: asOf('2026-08-22'),
  });
  assert.ok(activation, 'the obligation must enter the workflow');
  assert.deepEqual(activation.assignees, ['user-owner']);
  assert.equal(activation.currentStepId, '1');
  assert.equal(activation.workflowStatus, 'In Progress');
});

test('the entry fallback reaches the backup owner when there is no primary', () => {
  const unconfigured = { ...billCollection, assignmentType: 'User-based', assignedTo: [] };
  assert.deepEqual(
    resolveEntryAssignees(unconfigured, { ...ownerPayment, assignedTo: '' }),
    ['user-backup'],
  );
  // Nobody at all is still nobody — the caller has to report that, not invent an assignee.
  assert.deepEqual(
    resolveEntryAssignees(unconfigured, { ...ownerPayment, assignedTo: '', backupAssignedTo: '' }),
    [],
  );
  assert.equal(
    resolveWorkflowActivation(
      unconfigured,
      { ...ownerPayment, assignedTo: '', backupAssignedTo: '' },
      { activationDays: 7, today: asOf('2026-08-22') },
    ),
    null,
  );
});

test('the owner fallback does not apply to a mid-workflow approval step', () => {
  // Routing an unconfigured approval step to the payment owner would let them approve their own
  // bill, so the fallback is scoped to workflow entry only.
  const approval = {
    ...billCollection,
    id: '3',
    name: 'Payment Approval',
    assignmentType: 'User-based',
    assignedTo: [],
  };
  assert.deepEqual(resolveAssignees(approval, { ...ownerPayment, approverId: '' }), []);
  assert.deepEqual(
    resolveAssignees(approval, { ...ownerPayment, approverId: 'user-approver' }),
    ['user-approver'],
  );
});

test('a configured entry step is untouched by the fallback', () => {
  const configured = { ...billCollection, assignmentType: 'User-based', assignedTo: ['user-clerk'] };
  assert.deepEqual(resolveEntryAssignees(configured, ownerPayment), ['user-clerk']);
  // Payment-owner steps keep resolving to the owner, as before.
  assert.deepEqual(resolveEntryAssignees(billCollection, ownerPayment), ['user-owner']);
});

test('activation still waits when the bill is not expected yet', () => {
  // The fallback must not short-circuit the timing gate.
  assert.equal(
    resolveWorkflowActivation(billCollection, ownerPayment, {
      activationDays: 7,
      today: asOf('2026-08-10'),
    }),
    null,
  );
});

test('the entry step sets the status its name implies', () => {
  assert.equal(stepStatus(billCollection), 'Awaiting Bill');
  assert.equal(stepStatus({ ...billCollection, name: 'Bill Verification' }), 'Under Verification');
  assert.equal(stepStatus({ ...billCollection, name: 'Payment Approval' }), 'Pending Approval');
  assert.equal(stepStatus(undefined), 'Generated');
});

test('a multi-month master never opens with a stub period', () => {
  // The reported "Quarterly frequency" defect. Multi-month buckets used to snap to an absolute
  // month grid, so a quarterly master starting 1 Jan with a 17th anchor landed at the tail end of
  // the Oct-17→Jan-16 bucket and its first "quarter" was 1–16 Jan: sixteen days carrying a full
  // quarter's expected amount, with the bill and due dates derived from that stub.
  const days = (cycle) =>
    Math.round(
      (new Date(`${cycle.billingPeriodEnd}T00:00:00`) - new Date(`${cycle.billingPeriodStart}T00:00:00`))
        / 86_400_000,
    ) + 1;

  for (const [frequency, minDays] of [['Bi-monthly', 45], ['Quarterly', 75], ['Half-yearly', 150], ['Yearly', 320]])
  for (const anchor of [1, 5, 17, 28]) {
    const master = {
      frequency, startDate: '2026-01-01', periodAnchorDay: anchor,
      billDateRule: 'End of billing period', dueDateRule: 'Days after bill date', dueDay: 15,
    };
    const cycles = buildRecurringCycleSchedule(master, { from: asOf('2026-01-05'), count: 3 });
    assert.ok(cycles.length >= 3, `${frequency}/anchor ${anchor}: expected a schedule`);
    // The first period may legitimately be clamped — a master starting on the 1st when the vendor
    // bills from the 5th covers only the remainder of the period it joined. What must never happen
    // is the *second* period being short, which is the signature of the bug: the grid was phased on
    // a bucket that predated the master, so index 0 was a fragment and the real periods followed.
    for (const [position, cycle] of cycles.slice(1).entries()) {
      assert.ok(
        days(cycle) >= minDays,
        `${frequency}/anchor ${anchor}: period ${position + 2} is only ${days(cycle)} day(s) (${cycle.billingPeriodStart}..${cycle.billingPeriodEnd})`,
      );
    }
    // And the first period must still reach the end of the period the start date falls inside —
    // it is never a sliver. Half a period is the floor: the worst case is starting one day after
    // an anchor, which still leaves nearly all of it.
    assert.ok(
      days(cycles[0]) > minDays / 2,
      `${frequency}/anchor ${anchor}: first period is only ${days(cycles[0])} day(s) (${cycles[0].billingPeriodStart}..${cycles[0].billingPeriodEnd})`,
    );
  }
});

test('multi-month cycles are phased from the master start date, not a calendar grid', () => {
  // Quarterly from 1 Aug means Aug–Oct, Nov–Jan. Snapping to the absolute grid instead made the
  // first quarter a two-month stub (Aug–Sep) so it could align to Jul–Sep.
  const master = {
    frequency: 'Quarterly', startDate: '2026-08-01', periodAnchorDay: 1,
    billDateRule: 'End of billing period', dueDateRule: 'Days after bill date', dueDay: 15,
  };
  const cycles = buildRecurringCycleSchedule(master, { from: asOf('2026-08-05'), count: 2 });
  assert.deepEqual(
    cycles.map((cycle) => [cycle.billingPeriodStart, cycle.billingPeriodEnd]),
    [['2026-08-01', '2026-10-31'], ['2026-11-01', '2027-01-31']],
  );
});

test('monthly and week/interval frequencies keep their original phasing', () => {
  // The re-phasing above must not touch these: their keys are live document ids.
  assert.equal(buildRecurringCycle({ ...utilityMaster, frequency: 'Monthly' }, asOf('2026-10-05')).key, '2026-10');
  assert.equal(buildRecurringCycle({ ...utilityMaster, frequency: 'Weekly' }, asOf('2026-09-10')).key, '2026-W37');
  assert.equal(
    buildRecurringCycle({ ...utilityMaster, frequency: 'Custom', customIntervalDays: 30 }, asOf('2026-09-10')).key,
    'C0001-2026-08-18',
  );
  assert.equal(buildRecurringCycle({ ...utilityMaster, frequency: 'Renewable' }, asOf('2026-09-10')).key, 'R2026-08-18');
});
