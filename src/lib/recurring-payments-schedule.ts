/**
 * Schedule math for the Recurring Payments module: given a master's recurrence rules, resolves the
 * dates of each billing cycle.
 *
 * Deliberately dependency-free — no Firestore SDK, no React — because the same math has to run in
 * three places that can't share a client: the browser form (live preview of an unsaved master), the
 * client-side "Generate now" actions, and the Admin-SDK cron route. It also keeps the logic
 * directly unit-testable, since `recurring-payments.ts` re-exports a client-SDK-only helper that
 * can't be loaded outside a bundler.
 *
 * Every cycle resolves five dates in a fixed derivation order, which is what makes the schedule
 * explainable to the user configuring it:
 *
 *   billing period → expectedBillDate → dueDate → overdueDate
 *                    generationDate = expectedBillDate − lead time
 *
 * The bill date is the anchor rather than the due date. That ordering is what makes rules like
 * "payment due N days after the bill date" computable at all, and it prevents a due date from ever
 * landing before the bill it settles exists.
 */

export type RecurrenceFrequency = 'Weekly' | 'Monthly' | 'Bi-monthly' | 'Quarterly' | 'Half-yearly' | 'Yearly' | 'Renewable' | 'Custom';

/**
 * When the vendor's bill for a billing period is expected to exist. Utility-style bills arrive
 * after the service period ("End of billing period"), whereas rent and subscriptions are billed
 * up-front ("Start of billing period").
 */
export type BillDateRule = 'End of billing period' | 'Start of billing period' | 'Fixed day of month' | 'Days after period end';

/** When payment is due, always measured from the expected bill date. */
export type DueDateRule = 'Days after bill date' | 'Fixed day of month' | 'Last day of month' | 'Last working day of month' | 'Same as bill date';

/** Rule values saved before the schedule was made computable; normalized on read. */
export type LegacyDueDateRule = 'Days after generation date' | 'Last working day' | 'Custom date logic';

export const BILL_DATE_RULES: BillDateRule[] = ['End of billing period', 'Start of billing period', 'Fixed day of month', 'Days after period end'];
export const DUE_DATE_RULES: DueDateRule[] = ['Days after bill date', 'Fixed day of month', 'Last day of month', 'Last working day of month', 'Same as bill date'];

/**
 * The recurrence fields of a master. `RecurringPaymentMaster` extends this, so a master can always
 * be passed straight to any function here and the two can't drift apart.
 */
export interface RecurrenceRuleInput {
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string;
  /** Interval for the `Custom` frequency; ignored otherwise. */
  customIntervalDays?: number | null;
  /**
   * Day of the month a billing period opens on, for the month-based frequencies (Monthly through
   * Yearly). Defaults to 1, i.e. periods aligned to calendar months. Set it to 17 for a vendor who
   * bills the 17th to the 16th, as most postpaid telecom accounts do. Ignored by the Weekly,
   * Custom and Renewable frequencies, which are already anchored to the master's start date.
   */
  periodAnchorDay?: number;
  billDateRule?: BillDateRule;
  /** Day-of-month for the `Fixed day of month` bill rule, or the day offset for `Days after period end`. */
  billDayOffset?: number;
  dueDateRule?: DueDateRule | LegacyDueDateRule;
  /** Day-of-month for the `Fixed day of month` due rule, or the day offset for `Days after bill date`. */
  dueDay: number;
  /** Days after the due date before the obligation counts as overdue. */
  gracePeriodDays?: number;
  /** Days before the expected bill date that the obligation record is created. */
  generateLeadDays?: number;
  /** @deprecated Fallback for `generateLeadDays` on masters saved while the lead time was anchored to the due date. */
  generateBeforeDueDays?: number;
}

/** One billing cycle of a master, with every date in the derivation chain resolved. */
export interface RecurringCycle {
  key: string;
  label: string;
  /** Cycle number relative to the period containing the master's start date (0-based). */
  index: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  /** When the vendor's bill is expected, per the master's `billDateRule`. */
  expectedBillDate: string;
  dueDate: string;
  /** `dueDate` + `gracePeriodDays` — payment is only late after this date. */
  overdueDate: string;
  /** When automation creates the obligation record: `expectedBillDate` − lead time, never before the master starts. */
  generationDate: string;
}

export interface RecurrenceOptions {
  /** Used by the `Last working day of month` due rule. Defaults to Mon–Fri when the org's working calendar isn't loaded. */
  isWorkingDay?: (date: Date) => boolean;
}

/**
 * Maps the free-form rule values that could previously be saved onto the computable set. The old
 * options were never read by any calculation, so nothing depended on their distinctions: "Days
 * after generation date" and "Custom date logic" both collapse to a plain offset from the bill
 * date, and "Last working day" gains the month qualifier it always implied.
 */
export function normalizeDueDateRule(value?: string): DueDateRule {
  if (value === 'Last working day' || value === 'Last working day of month') return 'Last working day of month';
  if (value === 'Fixed day of month') return 'Fixed day of month';
  if (value === 'Last day of month') return 'Last day of month';
  if (value === 'Same as bill date') return 'Same as bill date';
  return 'Days after bill date';
}

const DAY_MS = 86_400_000;

const padDatePart = (value: number) => String(value).padStart(2, '0');

export function recurringDateOnly(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function localDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isoWeek(date: Date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return { year: utc.getUTCFullYear(), week: Math.ceil((((utc.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7) };
}

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
/** Last calendar day of a month; `month` may be out of range (12 → January of the next year). */
const monthEnd = (year: number, month: number) => new Date(year, month + 1, 0);
/** A day-of-month clamped into the given month, so "the 31st" resolves to Feb 28/29 rather than spilling into March. */
const dayOfMonth = (year: number, month: number, day: number) =>
  new Date(year, month, Math.min(Math.max(1, Math.round(day) || 1), monthEnd(year, month).getDate()));
const defaultIsWorkingDay = (date: Date) => date.getDay() !== 0 && date.getDay() !== 6;

function previousWorkingDay(date: Date, isWorkingDay: (value: Date) => boolean) {
  let cursor = date;
  // A calendar with every day marked non-working would otherwise loop forever; a month is the
  // widest meaningful search, past which the unadjusted date is the honest answer.
  for (let guard = 0; guard < 31 && !isWorkingDay(cursor); guard += 1) cursor = addDays(cursor, -1);
  return cursor;
}

const monthsPerCycle = (frequency: RecurrenceFrequency) =>
  frequency === 'Bi-monthly' ? 2 : frequency === 'Quarterly' ? 3 : frequency === 'Half-yearly' ? 6 : frequency === 'Yearly' ? 12 : 1;

const anchorDayOf = (master: RecurrenceRuleInput) =>
  Math.min(31, Math.max(1, Math.round(Number(master.periodAnchorDay || 1)) || 1));

/**
 * A month index (year * 12 + month) shifted so it names the period a date belongs to rather than
 * the calendar month it sits in. With an anchor of 17, 10 July belongs to the period that opened on
 * 17 June, so it counts as June. With the default anchor of 1 this is just the calendar month,
 * which is what keeps existing cycle keys byte-identical.
 */
function anchoredMonthIndex(date: Date, anchorDay: number) {
  return date.getFullYear() * 12 + date.getMonth() - (date.getDate() < anchorDay ? 1 : 0);
}

/**
 * The nominal (unclamped) bounds of cycle `index`, where index 0 is the cycle containing the
 * master's start date. Period bucketing is deliberately unchanged from the original
 * implementation — the cycle key it produces forms the obligation's Firestore document id, so any
 * shift here would make automation regenerate obligations that already exist under the old key.
 */
function cyclePeriod(master: RecurrenceRuleInput, index: number) {
  const masterStart = localDate(master.startDate);
  if (master.frequency === 'Weekly') {
    const weekday = masterStart.getDay() || 7;
    const nominalStart = addDays(masterStart, -weekday + 1 + index * 7);
    const week = isoWeek(nominalStart);
    return { nominalStart, nominalEnd: addDays(nominalStart, 6), key: `${week.year}-W${padDatePart(week.week)}` };
  }
  if (master.frequency === 'Renewable') {
    const nominalStart = new Date(masterStart.getFullYear() + index, masterStart.getMonth(), masterStart.getDate());
    return {
      nominalStart,
      nominalEnd: new Date(nominalStart.getFullYear() + 1, nominalStart.getMonth(), nominalStart.getDate() - 1),
      key: `R${nominalStart.getFullYear()}-${padDatePart(nominalStart.getMonth() + 1)}-${padDatePart(nominalStart.getDate())}`,
    };
  }
  if (master.frequency === 'Custom') {
    const interval = Math.max(1, Number(master.customIntervalDays || 30));
    const nominalStart = addDays(masterStart, index * interval);
    return {
      nominalStart,
      nominalEnd: addDays(nominalStart, interval - 1),
      key: `C${String(index + 1).padStart(4, '0')}-${recurringDateOnly(nominalStart)}`,
    };
  }
  const months = monthsPerCycle(master.frequency);
  const anchorDay = anchorDayOf(master);
  const startBucket = Math.floor(anchoredMonthIndex(masterStart, anchorDay) / months) * months;
  const bucket = startBucket + index * months;
  const nominalStart = dayOfMonth(Math.floor(bucket / 12), bucket % 12, anchorDay);
  // The period runs up to the day before the next one opens, so an anchored cycle ends on the 16th
  // when it started on the 17th. With the default anchor of 1 this is the last day of the month.
  const nominalEnd = addDays(dayOfMonth(Math.floor(bucket / 12), (bucket % 12) + months, anchorDay), -1);
  return {
    nominalStart,
    nominalEnd,
    key: `${nominalStart.getFullYear()}-${padDatePart(nominalStart.getMonth() + 1)}${months === 1 ? '' : `-${months}M`}`,
  };
}

/** Index of the cycle containing `date`, counting from the cycle that contains the master's start date. */
function cycleIndexAt(master: RecurrenceRuleInput, date: Date) {
  const masterStart = localDate(master.startDate);
  if (master.frequency === 'Weekly') {
    const startMonday = addDays(masterStart, -(masterStart.getDay() || 7) + 1);
    const monday = addDays(date, -(date.getDay() || 7) + 1);
    return Math.round((monday.getTime() - startMonday.getTime()) / DAY_MS / 7);
  }
  if (master.frequency === 'Renewable') {
    const elapsedMonths = (date.getFullYear() - masterStart.getFullYear()) * 12 + date.getMonth() - masterStart.getMonth();
    const index = Math.floor(elapsedMonths / 12);
    // This year's anniversary hasn't come round yet when the day-of-month is still ahead.
    return date < new Date(masterStart.getFullYear() + index, masterStart.getMonth(), masterStart.getDate()) ? index - 1 : index;
  }
  if (master.frequency === 'Custom') {
    const interval = Math.max(1, Number(master.customIntervalDays || 30));
    return Math.floor(Math.round((date.getTime() - masterStart.getTime()) / DAY_MS) / interval);
  }
  const months = monthsPerCycle(master.frequency);
  const anchorDay = anchorDayOf(master);
  const startBucket = Math.floor(anchoredMonthIndex(masterStart, anchorDay) / months) * months;
  const bucket = Math.floor(anchoredMonthIndex(date, anchorDay) / months) * months;
  return (bucket - startBucket) / months;
}

/**
 * When the vendor's bill for this period is expected to exist.
 *
 * Defaults to `Start of billing period` when the master has no rule saved. That's the
 * backwards-compatible default, not the recommended one: combined with the `Fixed day of month`
 * due rule it reproduces exactly what masters created before the schedule became computable
 * already resolved to (`periodStart + dueDay - 1`). New masters default to `End of billing period`
 * in the form, which is what actually matches how utility and service bills arrive.
 */
function resolveExpectedBillDate(master: RecurrenceRuleInput, periodStart: Date, periodEnd: Date) {
  const offset = Number(master.billDayOffset ?? 1);
  switch (master.billDateRule || 'Start of billing period') {
    case 'End of billing period':
      return periodEnd;
    case 'Days after period end':
      return addDays(periodEnd, Math.max(0, Math.round(offset) || 0));
    case 'Fixed day of month': {
      const candidate = dayOfMonth(periodEnd.getFullYear(), periodEnd.getMonth(), offset);
      // A billing day that already passed within this period belongs to the next month.
      return candidate < periodStart ? dayOfMonth(periodEnd.getFullYear(), periodEnd.getMonth() + 1, offset) : candidate;
    }
    default:
      return periodStart;
  }
}

/**
 * When payment is due. Every rule is measured from the expected bill date, never from the period,
 * so a due date can't land before the bill it settles exists — the defect in the original
 * offset-from-period-start calculation, which for a master starting mid-month resolved the first
 * cycle's due date to the end of the partial period instead of the configured day.
 */
function resolveDueDate(master: RecurrenceRuleInput, billDate: Date, isWorkingDay: (value: Date) => boolean) {
  const dueDay = Number(master.dueDay ?? 1);
  switch (normalizeDueDateRule(master.dueDateRule)) {
    case 'Same as bill date':
      return billDate;
    case 'Fixed day of month': {
      const candidate = dayOfMonth(billDate.getFullYear(), billDate.getMonth(), dueDay);
      return candidate < billDate ? dayOfMonth(billDate.getFullYear(), billDate.getMonth() + 1, dueDay) : candidate;
    }
    case 'Last day of month':
      return monthEnd(billDate.getFullYear(), billDate.getMonth());
    case 'Last working day of month': {
      const candidate = previousWorkingDay(monthEnd(billDate.getFullYear(), billDate.getMonth()), isWorkingDay);
      return candidate < billDate
        ? previousWorkingDay(monthEnd(billDate.getFullYear(), billDate.getMonth() + 1), isWorkingDay)
        : candidate;
    }
    default:
      return addDays(billDate, Math.max(0, Math.round(dueDay) || 0));
  }
}

/** Lead time in days, falling back to the pre-rewrite field for masters saved before it was re-anchored to the bill date. */
export function recurrenceLeadDays(master: Pick<RecurrenceRuleInput, 'generateLeadDays' | 'generateBeforeDueDays'>) {
  return Math.min(365, Math.max(0, Number(master.generateLeadDays ?? master.generateBeforeDueDays ?? 7)));
}

/** Resolves cycle `index` against the master's rules, or null when it falls outside the master's start/end dates. */
function buildCycleAtIndex(master: RecurrenceRuleInput, index: number, options: RecurrenceOptions = {}): RecurringCycle | null {
  if (index < 0) return null;
  const masterStart = localDate(master.startDate);
  const masterEnd = master.endDate ? localDate(master.endDate) : null;
  const { nominalStart, nominalEnd, key } = cyclePeriod(master, index);
  const periodStart = nominalStart < masterStart ? masterStart : nominalStart;
  const periodEnd = masterEnd && nominalEnd > masterEnd ? masterEnd : nominalEnd;
  if (periodStart > periodEnd) return null;

  const isWorkingDay = options.isWorkingDay || defaultIsWorkingDay;
  const expectedBillDate = resolveExpectedBillDate(master, periodStart, periodEnd);
  const dueDate = resolveDueDate(master, expectedBillDate, isWorkingDay);
  const overdueDate = addDays(dueDate, Math.max(0, Math.round(Number(master.gracePeriodDays || 0))));
  const generationDate = addDays(expectedBillDate, -recurrenceLeadDays(master));

  return {
    key,
    index,
    label: master.frequency === 'Weekly'
      ? `Week ${isoWeek(nominalStart).week}, ${isoWeek(nominalStart).year}`
      // A period anchored mid-month spans two calendar months, so naming it after one of them
      // would misdescribe it — show the range instead, as Custom/Renewable cycles already do.
      : ['Custom', 'Renewable'].includes(master.frequency) || anchorDayOf(master) > 1
        ? `${recurringDateOnly(periodStart)} to ${recurringDateOnly(periodEnd)}`
        : nominalStart.toLocaleString('en-IN', { month: 'short', year: 'numeric' }),
    billingPeriodStart: recurringDateOnly(periodStart),
    billingPeriodEnd: recurringDateOnly(periodEnd),
    expectedBillDate: recurringDateOnly(expectedBillDate),
    dueDate: recurringDateOnly(dueDate),
    overdueDate: recurringDateOnly(overdueDate),
    // Never before the master itself starts, however long the lead time.
    generationDate: recurringDateOnly(generationDate < masterStart ? masterStart : generationDate),
  };
}

/**
 * Returns the billing cycle containing `asOf`. The cycle key is stable, so both
 * browser and cron generation can safely use organization + master + cycle.
 */
export function buildRecurringCycle(master: RecurrenceRuleInput, asOf = new Date(), options: RecurrenceOptions = {}): RecurringCycle | null {
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  if (today < localDate(master.startDate)) return null;
  if (master.endDate && today > localDate(master.endDate)) return null;
  return buildCycleAtIndex(master, cycleIndexAt(master, today), options);
}

/**
 * The next `count` cycles from `from` (or from the master's start date, whichever is later), for
 * previewing a schedule before it's saved. Stops early at the master's end date.
 *
 * Starts at the earliest cycle still awaiting generation rather than strictly at the cycle
 * containing `from`. Under arrears billing those differ (see `pendingRecurringCycles`), and a
 * preview that opened at the current period would hide the very obligation automation is about to
 * create — the closed period whose bill has just arrived and is already due.
 */
export function buildRecurringCycleSchedule(
  master: RecurrenceRuleInput,
  options: RecurrenceOptions & { from?: Date; count?: number } = {},
): RecurringCycle[] {
  const { from = new Date(), count = 3 } = options;
  const masterStart = localDate(master.startDate);
  if (Number.isNaN(masterStart.getTime())) return [];
  const anchor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const pending = pendingRecurringCycles(master, anchor, options);
  const firstIndex = pending.length
    ? pending[0].index
    : Math.max(0, cycleIndexAt(master, anchor < masterStart ? masterStart : anchor));
  const cycles: RecurringCycle[] = [];
  for (let offset = 0; cycles.length < count && offset < count + 12; offset += 1) {
    const cycle = buildCycleAtIndex(master, firstIndex + offset, options);
    if (!cycle) break;
    cycles.push(cycle);
  }
  return cycles;
}

/**
 * Cycles whose generation date has already arrived and whose obligation should therefore exist by
 * now. Empty when nothing is due yet, so a caller must not treat an empty result as "outside the
 * master's date range"; use `buildRecurringCycle` to tell those two cases apart.
 *
 * This deliberately searches *backwards* as well as forwards, because the cycle that needs an
 * obligation today is often not the cycle today falls inside. Under arrears billing the bill
 * arrives after the period it covers, so a cycle's generation date lands in the *following* period:
 * a 17th-to-16th telecom account billed on the 18th has its 17 Jul – 16 Aug bill generated on
 * 17 Aug, by which point today is already inside the 17 Aug – 16 Sep cycle. Looking only forward
 * from the current cycle skipped that obligation permanently — the bill would arrive, be due, and
 * go overdue without the system ever creating a record for it.
 *
 * `lookbehind` is bounded rather than open-ended so that activating a master with an old start date
 * backfills only the last few cycles instead of its entire history. That bound is the reason a
 * long automation outage can still drop cycles beyond it — deliberate, since silently generating a
 * year of untracked obligations is worse than the gap.
 *
 * The lookahead covers the opposite case: a long lead time puts the next cycle's obligation due for
 * creation while today still sits inside the current one. Callers skip the ones already written.
 */
export function pendingRecurringCycles(
  master: RecurrenceRuleInput,
  asOf = new Date(),
  options: RecurrenceOptions & { lookahead?: number; lookbehind?: number } = {},
): RecurringCycle[] {
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const current = buildRecurringCycle(master, today, options);
  if (!current) return [];
  const lookahead = Math.max(0, options.lookahead ?? 2);
  const lookbehind = Math.max(0, options.lookbehind ?? 3);
  const cycles: RecurringCycle[] = [];
  for (let index = Math.max(0, current.index - lookbehind); index <= current.index + lookahead; index += 1) {
    const cycle = index === current.index ? current : buildCycleAtIndex(master, index, options);
    if (!cycle) {
      // Only the end-date clamp yields a null, which can't happen for a cycle before the current
      // one — so this always means the master has run out of future cycles.
      if (index > current.index) break;
      continue;
    }
    // Generation dates advance with the cycle index, so the first one still ahead of its window
    // ends the search — no later cycle can qualify either.
    if (localDate(cycle.generationDate) > today) break;
    cycles.push(cycle);
  }
  return cycles;
}

/**
 * The cycle a manual "generate now" should create, and the one worth showing as a master's current
 * position: the earliest cycle still awaiting an obligation, falling back to the cycle today sits
 * inside when nothing is due yet.
 *
 * Manual generation must not use `buildRecurringCycle` directly. Under arrears billing the cycle
 * containing today is *not* the one that needs generating — its bill hasn't been raised yet — so
 * generating it produces an obligation for a period the vendor hasn't billed while the closed
 * period whose bill is already due stays missing. Automation resolves that through
 * `pendingRecurringCycles`; routing every manual path through here keeps the two in agreement.
 */
export function actionableRecurringCycle(
  master: RecurrenceRuleInput,
  asOf = new Date(),
  options: RecurrenceOptions = {},
): RecurringCycle | null {
  return pendingRecurringCycles(master, asOf, options)[0] || buildRecurringCycle(master, asOf, options);
}

/** The timing fields an obligation needs for its workflow to be scheduled; a structural subset of `PaymentObligation`. */
export interface ActivationTimingPayment {
  dueDate: string;
  expectedBillDate?: string;
}

/**
 * Whether an obligation should be in its workflow's first step by `today`.
 *
 * Two triggers, whichever comes first:
 *
 * 1. **Its bill is expected.** The first step is Bill Collection, and that step has real work to do
 *    the moment the vendor's bill exists. This is the trigger that matters under arrears billing,
 *    where the gap between bill date and due date is routinely wider than an organization's
 *    activation window — a telecom bill raised on the 18th and due on the 5th is 18 days apart, so
 *    a 7-day window left the obligation sitting Scheduled and *unassigned* for eleven days, through
 *    exactly the period its owner was meant to be chasing the bill. Anchoring only to the due date
 *    also made the master's own lead time pointless: the record was created early, then hidden.
 * 2. **Its due date is inside the organization's activation window.** Retained as the backstop for
 *    obligations with no expected bill date at all — manual payments, and anything generated before
 *    the bill date became computable — which must keep behaving exactly as they did.
 *
 * Lives here rather than beside the workflow helpers because it is schedule arithmetic, and because
 * both the client generate actions and the Admin-SDK cron sweep need it; those two had already
 * drifted into separate inline copies of the due-date rule.
 */
export function isWorkflowActivationDue(
  payment: ActivationTimingPayment,
  options: { activationDays: number; today: Date },
): boolean {
  // Callers pass `new Date()`, so normalize to midnight before any day arithmetic — otherwise the
  // time of day skews the rounding and activation can land a day early or late.
  const today = new Date(options.today.getFullYear(), options.today.getMonth(), options.today.getDate());
  if (payment.expectedBillDate && localDate(payment.expectedBillDate) <= today) return true;
  return Math.round((localDate(payment.dueDate).getTime() - today.getTime()) / DAY_MS) <= options.activationDays;
}

/** One-line plain-English summary of a master's schedule rules, shown wherever the schedule is configured or reviewed. */
export function describeRecurrence(master: RecurrenceRuleInput): string {
  const billRule = master.billDateRule || 'Start of billing period';
  const billOffset = Math.max(0, Math.round(Number(master.billDayOffset ?? 1)));
  const bill = billRule === 'End of billing period' ? 'bill expected on the last day of each period'
    : billRule === 'Start of billing period' ? 'bill expected on the first day of each period'
      : billRule === 'Days after period end' ? `bill expected ${billOffset} day(s) after each period ends`
        : `bill expected on day ${billOffset} of the month`;
  const dueDay = Math.max(0, Math.round(Number(master.dueDay ?? 1)));
  const dueRule = normalizeDueDateRule(master.dueDateRule);
  const due = dueRule === 'Days after bill date' ? `payment due ${dueDay} day(s) after the bill date`
    : dueRule === 'Fixed day of month' ? `payment due on day ${dueDay} of the month`
      : dueRule === 'Last day of month' ? 'payment due on the last day of the month'
        : dueRule === 'Last working day of month' ? 'payment due on the last working day of the month'
          : 'payment due on the bill date itself';
  const grace = Math.max(0, Math.round(Number(master.gracePeriodDays || 0)));
  const anchorDay = anchorDayOf(master);
  return [
    `${master.frequency}${master.frequency === 'Custom' ? ` (every ${Math.max(1, Number(master.customIntervalDays || 30))} days)` : ''}`,
    ...(anchorDay > 1 ? [`period runs day ${anchorDay} to day ${anchorDay - 1} of the next month`] : []),
    bill,
    due,
    grace ? `overdue after ${grace} grace day(s)` : 'overdue the day after it falls due',
    `obligation created ${recurrenceLeadDays(master)} day(s) before the bill date`,
  ].join(' · ');
}
