import { addDays, addMonths, differenceInCalendarDays, format, startOfDay, startOfMonth } from 'date-fns';

/**
 * Insurance domain rules — premium schedules, due and grace states, policy standing, forecasts.
 *
 * Every page of the module used to derive these on its own, and they disagreed: the list page
 * called a policy "overdue" the day after its due date while the dashboard counted the same policy
 * differently, the premium schedule decided an instalment was paid only when a payment happened to
 * fall on its exact due date, and the next-due calculation looped forever for a One-Time policy
 * whose commencement date was in the past. This module is the one place those rules live, and it
 * is pure so the rules can be tested without Firestore.
 */

// ─── vocabulary ───────────────────────────────────────────────────────────────

export const PREMIUM_FREQUENCIES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', 'One-Time'] as const;
type FixedFrequency = (typeof PREMIUM_FREQUENCIES)[number];
/**
 * A premium paid once every N years (N ≥ 2), e.g. "Every 5 Years". The interval lives in the stored
 * frequency itself, so badges, exports and every rule below read it without a second field.
 */
export type MultiYearFrequency = `Every ${number} Years`;
export type PremiumFrequency = FixedFrequency | MultiYearFrequency;

/** Longest multi-year interval the form accepts. */
export const MAX_INTERVAL_YEARS = 50;

const MULTI_YEAR = /^Every (\d{1,2}) Years$/;

export function multiYearFrequency(years: number): MultiYearFrequency {
  return `Every ${years} Years`;
}

/** The N of "Every N Years", or null for any other frequency. */
export function intervalYears(frequency: string | null | undefined): number | null {
  const m = typeof frequency === 'string' ? MULTI_YEAR.exec(frequency) : null;
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 2 && n <= MAX_INTERVAL_YEARS ? n : null;
}

/** Months between two instalments; One-Time has a single instalment at commencement. */
const FIXED_MONTHS: Record<FixedFrequency, number> = {
  Monthly: 1,
  Quarterly: 3,
  'Half-Yearly': 6,
  Yearly: 12,
  'One-Time': 0,
};

function monthsBetween(frequency: PremiumFrequency): number {
  const years = intervalYears(frequency);
  return years ? years * 12 : FIXED_MONTHS[frequency as FixedFrequency] ?? 12;
}

/**
 * The stored standing of a personal policy — what a person decided, not what the calendar says.
 * "Lapsed", "In Grace" and "Matured" are derived from dates and are never stored.
 */
export const PERSONAL_LIFECYCLE = ['Active', 'Paid-Up', 'Surrendered', 'Claimed', 'Closed'] as const;
export type PersonalLifecycle = (typeof PERSONAL_LIFECYCLE)[number];

export const PROJECT_LIFECYCLE = ['Active', 'Close', 'Not Required', 'Expired'] as const;
export type ProjectLifecycle = (typeof PROJECT_LIFECYCLE)[number];

export const PAYMENT_MODES = ['Auto Debit', 'Net Banking', 'UPI', 'Cheque', 'Card', 'Cash', 'NEFT/RTGS'] as const;

// ─── settlement ───────────────────────────────────────────────────────────────

/** Ways a personal policy ends with money paid out by the insurer. */
export const SETTLEMENT_TYPES = ['Maturity Claim', 'Death Claim', 'Surrender', 'Premature Closure'] as const;
export type SettlementType = (typeof SETTLEMENT_TYPES)[number];

/** The stored lifecycle each settlement leaves the policy in. */
export const SETTLEMENT_STATUS: Record<SettlementType, PersonalLifecycle> = {
  'Maturity Claim': 'Claimed',
  'Death Claim': 'Claimed',
  Surrender: 'Surrendered',
  'Premature Closure': 'Closed',
};

export const SETTLEMENT_HINT: Record<SettlementType, string> = {
  'Maturity Claim': 'The policy reached maturity and the maturity value is claimed.',
  'Death Claim': 'The insured has died and the nominee claims the sum assured.',
  Surrender: 'The policy is given up early for its surrender value.',
  'Premature Closure': 'The policy is closed before maturity, e.g. foreclosure or free-look cancellation.',
};

/** Ways money comes back from an insurer. */
export const RECEIPT_MODES = ['NEFT/RTGS', 'Cheque', 'Net Banking', 'UPI', 'Cash'] as const;

/** Net payout: gross less deductions, never below zero; null until a gross amount is known. */
export function settlementNet(gross: number | null | undefined, deductions: number | null | undefined): number | null {
  if (gross === null || gross === undefined || !Number.isFinite(gross)) return null;
  const less = deductions && Number.isFinite(deductions) ? deductions : 0;
  return Math.max(0, gross - less);
}

export const NOMINEE_RELATIONSHIPS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other'] as const;

/** Window, in days, in which an upcoming premium or expiry counts as "due soon". */
export const DUE_SOON_DAYS = 30;
/** Window, in days, in which an upcoming maturity counts as "maturing soon". */
export const MATURITY_SOON_DAYS = 90;

// ─── dates ────────────────────────────────────────────────────────────────────

/** Firestore Timestamp, Date, `{ seconds }`, ISO string or nothing → Date or null. */
export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object') {
    const v = value as { toDate?: () => Date; seconds?: number };
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Calendar-day key; instalments and payments are matched on it, never on the time of day. */
export const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');

/** Whole calendar days from `now` to `date` — negative once it has passed. */
export const daysUntil = (date: Date, now: Date = new Date()) => differenceInCalendarDays(date, now);

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * A date typed by hand, day first as written in India: 15/03/2026, 15-3-26, 15.03.2026, 15032026,
 * 15 Mar 2026, 15-March-2026, or ISO 2026-03-15. Two-digit years up to 79 are 20xx, the rest 19xx.
 * Returns null for anything that is not a real calendar date (31/02 is rejected, not rolled over).
 */
export function parseTypedDate(text: string): Date | null {
  const s = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  let d: number, m: number, y: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (match[3].length === 2) y += y <= 79 ? 2000 : 1900;
  } else if ((match = /^(\d{2})(\d{2})(\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[\-. ]?([a-z]{3,9})[\-. ]?(\d{2}|\d{4})$/.exec(s))) {
    // "Mar", "march" and "sept" all name a month; "marc h" or "xyz" do not.
    const word = match[2];
    const idx = MONTH_NAMES.findIndex((name) => name.startsWith(word));
    if (idx < 0) return null;
    [d, m, y] = [Number(match[1]), idx + 1, Number(match[3])];
    if (match[3].length === 2) y += y <= 79 ? 2000 : 1900;
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  // new Date rolls 31/02 over into March; a typed date must be exactly the day written.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

export function isPremiumFrequency(value: unknown): value is PremiumFrequency {
  return typeof value === 'string' && ((PREMIUM_FREQUENCIES as readonly string[]).includes(value) || intervalYears(value) !== null);
}

// ─── premium schedule ─────────────────────────────────────────────────────────

/**
 * Every instalment due date across the premium-paying term.
 *
 * Each date is stepped from commencement (`commencement + i × step`), never from the previous
 * instalment, so a policy starting on the 31st keeps falling on month-end instead of drifting to
 * the 28th after February. The count is capped so a mistyped term cannot hang the page.
 */
export function premiumSchedule(commencement: Date | null, frequency: PremiumFrequency, termYears: number): Date[] {
  if (!commencement) return [];
  if (frequency === 'One-Time') return [commencement];
  const step = monthsBetween(frequency);
  const years = Number.isFinite(termYears) ? Math.max(0, Math.floor(termYears)) : 0;
  // Rounded up: every 5 years over a 12-year term pays in years 0, 5 and 10.
  const count = Math.min(Math.ceil((years * 12) / step), 1200);
  return Array.from({ length: count }, (_, i) => addMonths(commencement, i * step));
}

/** Instalments per year — the multiplier from one premium to the yearly outgo (0.2 for every 5 years). */
export function instalmentsPerYear(frequency: PremiumFrequency): number {
  return frequency === 'One-Time' ? 0 : 12 / monthsBetween(frequency);
}

/** The yearly premium outgo; a One-Time (single-premium) policy has none after its first year. */
export function annualisedPremium(premium: number, frequency: PremiumFrequency): number {
  return (premium || 0) * instalmentsPerYear(frequency);
}

/** The first instalment falling on or after today — the suggested next due date for a new record. */
export function firstInstalmentFrom(schedule: Date[], now: Date = new Date()): Date | null {
  const today = startOfDay(now);
  return schedule.find((d) => startOfDay(d) >= today) ?? null;
}

interface ScheduleInputs {
  commencement: Date | null;
  frequency: PremiumFrequency;
  termYears: number;
  maturity: Date | null;
}

/**
 * The instalment that falls due after `paidDue` has been paid, or null when that was the last one.
 *
 * Policies recorded before commencement date and term were captured have no schedule; for those the
 * next date is one frequency step on, stopping at maturity.
 */
export function nextDueAfterPayment(inputs: ScheduleInputs, paidDue: Date): Date | null {
  if (inputs.frequency === 'One-Time') return null;
  const schedule = premiumSchedule(inputs.commencement, inputs.frequency, inputs.termYears);
  const paidKey = dayKey(paidDue);
  let next: Date | null;
  if (schedule.length > 0) {
    next = schedule.find((d) => dayKey(d) > paidKey) ?? null;
  } else {
    next = addMonths(paidDue, monthsBetween(inputs.frequency));
  }
  if (next && inputs.maturity && startOfDay(next) >= startOfDay(inputs.maturity)) return null;
  return next;
}

// ─── due and grace ────────────────────────────────────────────────────────────

/**
 * Grace period after a due date during which the policy stays in force — 15 days for monthly
 * premiums, 30 for every other frequency, as insurers in India apply it. A policy may override it.
 */
export function graceDays(frequency: PremiumFrequency, override?: number | null): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override;
  return frequency === 'Monthly' ? 15 : 30;
}

export type DueState = 'lapsed' | 'grace' | 'due-soon' | 'upcoming';

/** Where an unpaid instalment stands today. Due today counts as due soon, not overdue. */
export function dueState(due: Date, now: Date, grace: number, soonDays: number = DUE_SOON_DAYS): DueState {
  const days = daysUntil(due, now);
  if (days < -grace) return 'lapsed';
  if (days < 0) return 'grace';
  if (days <= soonDays) return 'due-soon';
  return 'upcoming';
}

// ─── personal policy standing ─────────────────────────────────────────────────

export type PersonalPolicyState =
  | 'active'
  | 'due-soon'
  | 'grace'
  | 'lapsed'
  | 'matured'
  | 'paid-up'
  | 'surrendered'
  | 'claimed'
  | 'closed';

export const PERSONAL_STATE_LABEL: Record<PersonalPolicyState, string> = {
  active: 'Active',
  'due-soon': 'Due Soon',
  grace: 'In Grace',
  lapsed: 'Lapsed',
  matured: 'Matured',
  'paid-up': 'Paid-Up',
  surrendered: 'Surrendered',
  claimed: 'Claimed',
  closed: 'Closed',
};

/** States that need someone to pay a premium. */
export const PREMIUM_ACTION_STATES: readonly PersonalPolicyState[] = ['due-soon', 'grace', 'lapsed'];

/** A personal policy as far as these rules need it — the Firestore document satisfies it. */
export interface PersonalPolicyLike {
  status?: string | null;
  payment_type?: string | null;
  due_date?: unknown;
  date_of_maturity?: unknown;
  date_of_comm?: unknown;
  tenure?: number | null;
  grace_period_days?: number | null;
}

export function policyFrequency(policy: { payment_type?: string | null }): PremiumFrequency {
  return isPremiumFrequency(policy.payment_type) ? policy.payment_type : 'Yearly';
}

/** True while premiums may still be collected — no stored status counts as Active (legacy rows). */
export function isPersonalInForce(policy: { status?: string | null }): boolean {
  return !policy.status || policy.status === 'Active';
}

/**
 * The standing of a personal policy today.
 *
 * A stored lifecycle other than Active wins — a surrendered policy is surrendered whatever its
 * dates say. Then maturity; then the next unpaid premium against its grace period. A policy in force
 * with no next due date has paid every premium.
 */
export function personalPolicyState(policy: PersonalPolicyLike, now: Date = new Date()): PersonalPolicyState {
  switch (policy.status) {
    case 'Paid-Up': return 'paid-up';
    case 'Surrendered': return 'surrendered';
    case 'Claimed': return 'claimed';
    case 'Closed': return 'closed';
    default: break;
  }
  const maturity = toDate(policy.date_of_maturity);
  if (maturity && startOfDay(maturity) <= startOfDay(now)) return 'matured';
  const due = toDate(policy.due_date);
  if (!due) return 'active';
  const state = dueState(due, now, graceDays(policyFrequency(policy), policy.grace_period_days));
  return state === 'upcoming' ? 'active' : state;
}

// ─── instalment register ──────────────────────────────────────────────────────

export interface PaymentLike {
  id: string;
  paymentDate: unknown;
  /** The instalment this payment settled. Absent on payments recorded before it was captured. */
  instalmentDueDate?: unknown;
}

export type InstalmentState = 'paid' | 'lapsed' | 'grace' | 'due-soon' | 'due' | 'upcoming';

export interface InstalmentRow<P extends PaymentLike> {
  no: number;
  dueDate: Date;
  state: InstalmentState;
  /** The recorded payment, when there is one; a paid row without one was settled before tracking. */
  payment: P | null;
  /** True for the single instalment the policy is currently waiting on. */
  isCurrent: boolean;
}

/**
 * The premium schedule joined to what has been paid.
 *
 * The policy's stored next due date is the ledger's high-water mark: every instalment before it has
 * been settled (in this system or before the policy was recorded here), it is the one awaiting
 * payment, and everything after is upcoming. Payments that name their instalment attach to it;
 * older payments that do not are laid onto the latest settled instalments in date order, because
 * each of them advanced the due date by exactly one instalment.
 */
export function instalmentRegister<P extends PaymentLike>(
  schedule: Date[],
  nextDue: Date | null,
  payments: P[],
  now: Date,
  grace: number,
): InstalmentRow<P>[] {
  const nextKey = nextDue ? dayKey(nextDue) : null;
  const byKey = new Map<string, P>();
  const unlabelled: P[] = [];
  for (const p of payments) {
    const due = toDate(p.instalmentDueDate);
    if (due) byKey.set(dayKey(due), p);
    else unlabelled.push(p);
  }

  const settled = (d: Date) => nextKey === null || dayKey(d) < nextKey;
  const openSettled = schedule.filter((d) => settled(d) && !byKey.has(dayKey(d)));
  const legacy = [...unlabelled].sort(
    (a, b) => (toDate(a.paymentDate)?.getTime() ?? 0) - (toDate(b.paymentDate)?.getTime() ?? 0),
  );
  const tail = openSettled.slice(Math.max(0, openSettled.length - legacy.length));
  const offset = legacy.length - tail.length;
  tail.forEach((d, i) => byKey.set(dayKey(d), legacy[i + offset]));

  return schedule.map((dueDate, i) => {
    const key = dayKey(dueDate);
    const payment = byKey.get(key) ?? null;
    const isCurrent = key === nextKey;
    let state: InstalmentState;
    if (payment || settled(dueDate)) state = 'paid';
    else if (isCurrent) {
      const s = dueState(dueDate, now, grace);
      state = s === 'upcoming' ? 'due' : s;
    } else state = 'upcoming';
    return { no: i + 1, dueDate, state, payment, isCurrent };
  });
}

// ─── project policy standing ──────────────────────────────────────────────────

export type ProjectPolicyState = 'active' | 'expiring' | 'expired' | 'not-required' | 'closed';

export const PROJECT_STATE_LABEL: Record<ProjectPolicyState, string> = {
  active: 'Active',
  expiring: 'Expiring',
  expired: 'Expired',
  'not-required': 'Not Required',
  closed: 'Closed',
};

export interface ProjectPolicyLike {
  status?: string | null;
  insured_until?: unknown;
}

/**
 * The standing of a project policy today. The stored "Active" was never moved to "Expired" by
 * anything, so a policy past its end date used to keep counting as active cover; the end date
 * decides now.
 */
export function projectPolicyState(policy: ProjectPolicyLike, now: Date = new Date()): ProjectPolicyState {
  if (policy.status === 'Not Required') return 'not-required';
  if (policy.status === 'Close') return 'closed';
  if (policy.status === 'Expired') return 'expired';
  const end = toDate(policy.insured_until);
  if (!end) return 'active';
  const days = daysUntil(end, now);
  if (days < 0) return 'expired';
  if (days <= DUE_SOON_DAYS) return 'expiring';
  return 'active';
}

/**
 * The last day of cover for a period starting on `start`: the day before the same date a full term
 * later, the way insurers write it — 1 Apr 2026 for one year runs to 31 Mar 2027 — so a renewal
 * starting the day after lines up exactly instead of drifting a day every year.
 */
export function coverEndDate(start: Date, years: number, months: number): Date | null {
  const y = Math.max(0, Math.floor(years || 0));
  const m = Math.max(0, Math.floor(months || 0));
  if (y === 0 && m === 0) return null;
  return addDays(addMonths(start, y * 12 + m), -1);
}

/** A project policy that can be renewed: cover that is running out or has run out, not one retired. */
export const isProjectRenewable = (state: ProjectPolicyState) => state === 'expiring' || state === 'expired';

// ─── identity ─────────────────────────────────────────────────────────────────

/** Policy numbers compared the way people mistype them: case, spaces and dashes ignored. */
export const normalisePolicyNo = (value: string) => value.toUpperCase().replace(/[\s\-/]+/g, '');

/** The key that stops the task sync raising the same task twice. Premium keys predate this module. */
export function taskCheckId(policyId: string, date: Date, kind: 'premium' | 'maturity' = 'premium'): string {
  return kind === 'premium' ? `${policyId}-${dayKey(date)}` : `${policyId}-maturity-${dayKey(date)}`;
}

// ─── forecast ─────────────────────────────────────────────────────────────────

export interface Outflow {
  date: Date;
  amount: number;
  kind: 'personal' | 'project';
  policyId: string;
  policyNo: string;
  label: string;
  company: string;
  /** True when the date comes from an unpaid, already-passed instalment. */
  overdue: boolean;
}

interface ForecastPersonal extends PersonalPolicyLike {
  id: string;
  policy_no: string;
  insured_person: string;
  insurance_company: string;
  premium: number;
}

interface ForecastProject extends ProjectPolicyLike {
  id: string;
  policy_no: string;
  assetName: string;
  insurance_company: string;
  premium: number;
}

/**
 * Premium cash-outflows from `from` up to (not including) `to`.
 *
 * Personal policies contribute every instalment from their next due date on, while they are in
 * force and not matured; an already-passed due date is carried at `from` so arrears are not lost.
 * Project policies contribute one renewal at their end date at the current premium — an estimate,
 * since the renewed premium is not known until quoted.
 */
export function premiumOutflows(
  personal: ForecastPersonal[],
  project: ForecastProject[],
  from: Date,
  to: Date,
  now: Date = new Date(),
): Outflow[] {
  const start = startOfDay(from);
  const end = startOfDay(to);
  const out: Outflow[] = [];

  for (const p of personal) {
    const state = personalPolicyState(p, now);
    if (!['active', 'due-soon', 'grace', 'lapsed'].includes(state)) continue;
    const due = toDate(p.due_date);
    if (!due) continue;
    const inputs: ScheduleInputs = {
      commencement: toDate(p.date_of_comm),
      frequency: policyFrequency(p),
      termYears: p.tenure ?? 0,
      maturity: toDate(p.date_of_maturity),
    };
    let cursor: Date | null = due;
    let guard = 0;
    while (cursor && startOfDay(cursor) < end && guard++ < 600) {
      const overdue = startOfDay(cursor) < start;
      out.push({
        date: overdue ? start : cursor,
        amount: p.premium || 0,
        kind: 'personal',
        policyId: p.id,
        policyNo: p.policy_no,
        label: p.insured_person,
        company: p.insurance_company,
        overdue,
      });
      cursor = nextDueAfterPayment(inputs, cursor);
    }
  }

  for (const p of project) {
    const state = projectPolicyState(p, now);
    if (state === 'not-required' || state === 'closed') continue;
    const endDate = toDate(p.insured_until);
    if (!endDate || startOfDay(endDate) >= end) continue;
    const overdue = startOfDay(endDate) < start;
    out.push({
      date: overdue ? start : endDate,
      amount: p.premium || 0,
      kind: 'project',
      policyId: p.id,
      policyNo: p.policy_no,
      label: p.assetName,
      company: p.insurance_company,
      overdue,
    });
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export interface MonthBucket {
  key: string;
  month: Date;
  personal: number;
  project: number;
  total: number;
  count: number;
}

/** Outflows totalled per calendar month for `months` months starting at `from`'s month. */
export function bucketByMonth(outflows: Outflow[], from: Date, months: number): MonthBucket[] {
  const first = startOfMonth(from);
  const buckets: MonthBucket[] = Array.from({ length: months }, (_, i) => {
    const month = addMonths(first, i);
    return { key: format(month, 'yyyy-MM'), month, personal: 0, project: 0, total: 0, count: 0 };
  });
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const o of outflows) {
    const i = index.get(format(o.date, 'yyyy-MM'));
    if (i === undefined) continue;
    const b = buckets[i];
    b[o.kind] += o.amount;
    b.total += o.amount;
    b.count += 1;
  }
  return buckets;
}

// ─── portfolio breakdown ──────────────────────────────────────────────────────

export interface InsurerRow {
  name: string;
  personal: number;
  project: number;
  total: number;
  policies: number;
}

/**
 * Yearly premium per insurer across live cover — personal policies in force (annualised) and
 * project policies still running (their current premium) — largest first. Past `top`, the tail is
 * folded into one "Other" row, so the list never needs more rows than it can show.
 */
export function premiumByInsurer(
  personal: (PersonalPolicyLike & { insurance_company?: string; premium?: number })[],
  project: (ProjectPolicyLike & { insurance_company?: string; premium?: number })[],
  now: Date = new Date(),
  top = 6,
): InsurerRow[] {
  const rows = new Map<string, InsurerRow>();
  const row = (name: string) => {
    const key = name?.trim() || 'Unspecified';
    let r = rows.get(key);
    if (!r) { r = { name: key, personal: 0, project: 0, total: 0, policies: 0 }; rows.set(key, r); }
    return r;
  };
  for (const p of personal) {
    const s = personalPolicyState(p, now);
    if (s !== 'active' && s !== 'due-soon' && s !== 'grace') continue;
    const amount = annualisedPremium(p.premium || 0, policyFrequency(p));
    const r = row(p.insurance_company || '');
    r.personal += amount; r.total += amount; r.policies += 1;
  }
  for (const p of project) {
    const s = projectPolicyState(p, now);
    if (s !== 'active' && s !== 'expiring') continue;
    const r = row(p.insurance_company || '');
    r.project += p.premium || 0; r.total += p.premium || 0; r.policies += 1;
  }
  const sorted = [...rows.values()].filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  if (sorted.length <= top) return sorted;
  const other = sorted.slice(top - 1).reduce<InsurerRow>(
    (o, r) => ({ ...o, personal: o.personal + r.personal, project: o.project + r.project, total: o.total + r.total, policies: o.policies + r.policies }),
    { name: 'Other', personal: 0, project: 0, total: 0, policies: 0 },
  );
  return [...sorted.slice(0, top - 1), other];
}

// ─── formatting ───────────────────────────────────────────────────────────────

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const formatInr = (amount: number | null | undefined) => INR.format(amount || 0);

/** ₹950 · ₹12.5 K · ₹4.2 L · ₹1.35 Cr — Indian units, for tiles and axis ticks. */
export function compactInr(value: number): string {
  const abs = Math.abs(value || 0);
  const sign = value < 0 ? '−' : '';
  const trim = (n: number) => String(Number(n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)));
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)} K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function formatDay(value: unknown, pattern = 'dd MMM yyyy'): string {
  const d = toDate(value);
  return d ? format(d, pattern) : '—';
}

/** "12d left", "Today", "3d ago" — the relative phrase the registers show beside a date. */
export function relativeDays(date: Date, now: Date = new Date()): string {
  const days = daysUntil(date, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return days > 0 ? `${days}d left` : `${Math.abs(days)}d ago`;
}
