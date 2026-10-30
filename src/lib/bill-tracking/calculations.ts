/**
 * Every financial formula in Bill Tracking, in one place.
 *
 * The legacy workbook computes these per row with sheet formulas:
 *
 *   Total Deduction = SUM(Building Cess … Other)              (K:U)
 *   Net Amount      = ROUND(Taxable + GST − Total Deduction, 0) (I + J − V)
 *   Shortfall       = Net − Net Amount Received               (W − X)
 *
 * and the finance team types STATUS (RECEIVED / NOT RECEIVED) by hand. Here the same arithmetic is
 * applied to the bill's source values (taxable, GST, deduction lines, verified receipts) and the
 * status is derived from it. The deduction lines are the ones the bill is paid against: the raised
 * ones until the client certifies the bill, its certified ones after (`effectiveDeductions`); the
 * raised total and net are kept beside them for raised vs certified. Nothing else in the module is
 * allowed to recompute these: the API routes call `deriveBillTotals` before every write, the import
 * calls it to validate legacy rows, and the UI only ever displays the stored result.
 *
 * Signs are preserved throughout. The legacy book carries negative taxable amounts (credit notes,
 * reversals) and negative deductions (crop-compensation rows enter the compensation as a negative
 * "Mob Adv" so that it adds to the net). Applying `Math.abs` anywhere would silently change those
 * books.
 *
 * The net is rounded to the whole rupee when `roundNetToRupee` is on (the default), because that is
 * the business rule the sheet encodes: `ROUND(I+J−V, 0)`, half away from zero as Sheets rounds.
 * With it on, the 2026-27 book's nets reproduce exactly except where someone typed over the
 * formula — which is precisely what the import should flag.
 */

import { roundMoney, subtractMoney, sumBy, sumMoney, toPaise, withinTolerance } from './money.ts';
import type {
  AgeingBucketConfig,
  Bill,
  BillCertification,
  BillCollectionRef,
  BillDeduction,
  BillPaymentStatus,
  BillWorkflowStatus,
  DeductionKind,
} from './types';

export const RETENTION_KINDS: readonly DeductionKind[] = [
  'retention_cpbg',
  'retention_invoice',
  'retention_time_extension',
  'retention_other',
];

export const isRetentionKind = (kind: DeductionKind): boolean => RETENTION_KINDS.includes(kind);

/* ── bill totals ─────────────────────────────────────────────────────────── */

export const grossAmount = (taxable: number, gst: number): number => sumMoney([taxable, gst]);

export const totalDeduction = (deductions: readonly Pick<BillDeduction, 'amount'>[]): number =>
  sumBy(deductions, (line) => line.amount);

export const deductionsOfKind = (
  deductions: readonly Pick<BillDeduction, 'amount' | 'kind'>[],
  kinds: readonly DeductionKind[],
): number => sumBy(deductions.filter((line) => kinds.includes(line.kind)), (line) => line.amount);

/** Sheets/Excel ROUND(x, 0): half away from zero (JavaScript's Math.round rounds −0.5 up to 0). */
export const roundToRupee = (rupees: number): number => {
  const rounded = Math.sign(rupees) * Math.round(Math.abs(rupees));
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const netReceivable = (gross: number, deduction: number, roundNetToRupee = false): number => {
  const net = subtractMoney(gross, deduction);
  return roundNetToRupee ? roundToRupee(net) : net;
};

export interface CalculationOptions {
  /** Rupees within which two amounts count as equal. */
  tolerance: number;
  /** Round the net receivable to the whole rupee, as the legacy sheet does. */
  roundNetToRupee?: boolean;
}

/**
 * Only verified receipts count. A draft receipt is someone's typing, not money in the bank; a
 * cancelled one never happened. Both stay on the bill's receipt list for the audit trail.
 */
export const countedCollections = (collections: readonly BillCollectionRef[]): BillCollectionRef[] =>
  collections.filter((entry) => entry.status === 'verified');

export const totalReceived = (collections: readonly BillCollectionRef[]): number =>
  sumBy(countedCollections(collections), (entry) => entry.amount);

export const lastReceiptDate = (collections: readonly BillCollectionRef[]): string | undefined =>
  countedCollections(collections)
    .map((entry) => entry.receiptDate)
    .filter(Boolean)
    .sort()
    .at(-1);

/**
 * The automatic payment status.
 *
 * Works on the magnitude the bill is owed in, so a credit note (net −₹50,000, "received" −₹50,000
 * when it is adjusted) reads the same way an invoice does. A zero-net bill is `received` — there is
 * nothing left to collect — unless something was paid against it, which is an over-receipt.
 */
export function computePaymentStatus(net: number, received: number, tolerance: number): BillPaymentStatus {
  const direction = net < 0 ? -1 : 1;
  const owed = toPaise(net) * direction;
  const paid = toPaise(received) * direction;
  const tol = toPaise(Math.abs(tolerance));

  if (paid > owed + tol) return 'over_received';
  if (Math.abs(owed - paid) <= tol) return 'received';
  if (paid <= tol) return 'not_received';
  return 'partially_received';
}

/**
 * A bill whose whole value is held back as retention, with nothing received: a debit note billing the
 * balance of a SUPPLY-70% invoice, say, its 20% + 10% taken of the invoice plus the note. Its status is
 * `received`, since nothing is owed, which reads as if money arrived; screens show *Held as retention*.
 * `received` with nothing received already means the net is within the amount tolerance of ₹0.
 */
export const isHeldAsRetention = (bill: Pick<Bill, 'paymentStatus' | 'totalReceived' | 'retentionDeducted' | 'paymentStatusOverride'>): boolean =>
  bill.paymentStatus === 'received' && !bill.paymentStatusOverride && toPaise(bill.totalReceived ?? 0) === 0 && toPaise(bill.retentionDeducted ?? 0) > 0;

export interface BillSourceValues {
  taxableAmount: number;
  gstAmount: number;
  /** The deductions as raised. */
  deductions: readonly BillDeduction[];
  collections: readonly BillCollectionRef[];
  transactionType?: Bill['transactionType'];
  paymentStatusOverride?: Bill['paymentStatusOverride'];
  isDeleted?: boolean;
  /** The client's certification, once recorded — its deductions replace the raised ones (`effectiveDeductions`). */
  certification?: Pick<BillCertification, 'deductions'> | null;
}

/**
 * The deductions a bill is paid against: the client's certified deductions once it has certified the
 * bill, else the raised ones. A change of deductions needs no credit / debit note — the client simply
 * pays the invoice less what it certified as deducted. Only a change of the invoice value (taxable and
 * its GST) is settled by a note (`certification.ts`). Every receivable, report and retention figure
 * reads these; the raised lines stay on the bill as issued, for the comparison. A certification with
 * no lines (or none stored) certifies no deductions — the comparison reads it the same way.
 */
export const effectiveDeductions = (bill: { deductions?: readonly BillDeduction[] | null; certification?: Pick<BillCertification, 'deductions'> | null }): readonly BillDeduction[] =>
  bill.certification ? (bill.certification.deductions ?? []) : (bill.deductions ?? []);

export interface BillDerivedTotals {
  grossAmount: number;
  /** Of the effective deductions — the certified ones once certified. */
  totalDeduction: number;
  statutoryDeduction: number;
  retentionDeducted: number;
  /** Gross less the effective deductions: what this bill is paid. */
  netReceivable: number;
  /** The raised deductions' total and net, kept beside the effective ones for raised vs certified. */
  raisedTotalDeduction: number;
  raisedNetReceivable: number;
  totalReceived: number;
  outstandingAmount: number;
  shortfallSurplus: number;
  lastReceiptDate?: string;
  paymentStatus: BillPaymentStatus;
  /** What the money says, regardless of any override — shown next to an overridden status. */
  computedPaymentStatus: BillPaymentStatus;
}

/**
 * Derives every computed field of a bill from its source values. This is the only function that
 * produces `outstandingAmount` / `paymentStatus`; the API writes its result inside the same
 * transaction that changes a source value, so a stale client total can never be persisted.
 */
export function deriveBillTotals(source: BillSourceValues, options: CalculationOptions): BillDerivedTotals {
  const { tolerance } = options;
  const gross = grossAmount(source.taxableAmount, source.gstAmount);
  const deductions = effectiveDeductions(source);
  const deduction = totalDeduction(deductions);
  const raisedDeduction = totalDeduction(source.deductions ?? []);
  const net = netReceivable(gross, deduction, options.roundNetToRupee);
  const received = totalReceived(source.collections);
  const shortfall = subtractMoney(net, received);
  const computed = computePaymentStatus(net, received, tolerance);
  const status: BillPaymentStatus = source.isDeleted
    ? 'cancelled'
    : (source.paymentStatusOverride?.status ?? computed);
  // A settled or adjusted bill owes nothing even if a rupee of rounding remains on the sheet.
  const outstanding = status === 'received' || status === 'adjusted' || status === 'cancelled' ? 0 : shortfall;

  return {
    grossAmount: gross,
    totalDeduction: deduction,
    statutoryDeduction: deductionsOfKind(deductions, ['statutory']),
    retentionDeducted: deductionsOfKind(deductions, RETENTION_KINDS),
    netReceivable: net,
    raisedTotalDeduction: raisedDeduction,
    raisedNetReceivable: netReceivable(gross, raisedDeduction, options.roundNetToRupee),
    totalReceived: received,
    outstandingAmount: roundMoney(outstanding),
    shortfallSurplus: shortfall,
    lastReceiptDate: lastReceiptDate(source.collections),
    paymentStatus: status,
    computedPaymentStatus: computed,
  };
}

/** Percentage helper for deduction rows and GST presets — rounded to the paisa, sign kept. */
export const percentOf = (base: number, percent: number): number => roundMoney((base * percent) / 100);

/** Collection %: received ÷ net. `null` when there is nothing billed to divide by. */
export const collectionPercent = (received: number, net: number): number | null =>
  toPaise(net) === 0 ? null : Math.round((received / net) * 1000) / 10;

/* ── legacy reconciliation ───────────────────────────────────────────────── */

export interface NetComparison {
  calculated: number;
  imported: number;
  difference: number;
  matches: boolean;
}

export const compareNet = (calculated: number, imported: number, tolerance: number): NetComparison => ({
  calculated,
  imported,
  difference: subtractMoney(imported, calculated),
  matches: withinTolerance(calculated, imported, tolerance),
});

/**
 * Legacy STATUS vs the computed one. The sheet only knows two words, so `partially_received` and
 * `over_received` both disagree with "RECEIVED" — which is exactly the case finance needs to see:
 * the sheet calls a bill received while ₹35,000 of it never arrived.
 */
export function legacyStatusMismatch(legacyStatus: string | undefined, computed: BillPaymentStatus): boolean {
  const text = String(legacyStatus ?? '').trim().toUpperCase();
  if (!text) return false;
  if (text === 'RECEIVED') return computed !== 'received';
  if (text === 'NOT RECEIVED') return computed !== 'not_received';
  if (text.startsWith('PART')) return computed !== 'partially_received';
  return false;
}

/* ── ledgers ─────────────────────────────────────────────────────────────── */

export interface LedgerLine {
  date: string;
  kind: 'bill' | 'collection' | 'credit' | 'debit' | 'adjustment';
  reference: string;
  description: string;
  billId?: string;
  debit: number;
  credit: number;
  balance: number;
}

/**
 * A bill's receivable ledger: its net as a debit, each verified receipt as a credit. The net is the
 * stored one — less the client's certified deductions once it has certified the bill — so the
 * running balance ends at the outstanding amount (before any settlement override).
 */
export function billLedger(bill: Pick<Bill, 'id' | 'billDate' | 'netReceivable' | 'billSerialNumber' | 'gstInvoiceNumber' | 'transactionType' | 'description' | 'collections'>): LedgerLine[] {
  const net = bill.netReceivable;
  const lines: Omit<LedgerLine, 'balance'>[] = [
    {
      date: bill.billDate,
      kind: bill.transactionType === 'credit_note' ? 'credit' : bill.transactionType === 'debit_note' ? 'debit' : 'bill',
      reference: bill.gstInvoiceNumber || bill.billSerialNumber || bill.id,
      description: bill.description || 'Bill raised',
      billId: bill.id,
      debit: net >= 0 ? net : 0,
      credit: net < 0 ? -net : 0,
    },
    ...countedCollections(bill.collections)
      .slice()
      .sort((a, b) => a.receiptDate.localeCompare(b.receiptDate))
      .map((entry) => ({
        date: entry.receiptDate,
        kind: (entry.paymentMode === 'ADJUSTMENT' ? 'adjustment' : 'collection') as LedgerLine['kind'],
        reference: entry.utrNumber || entry.collectionId,
        description: entry.paymentMode === 'ADJUSTMENT' ? 'Adjustment' : 'Collection',
        billId: bill.id,
        debit: entry.amount < 0 ? -entry.amount : 0,
        credit: entry.amount >= 0 ? entry.amount : 0,
      })),
  ];
  return withRunningBalance(lines);
}

/** Merges many bills' ledgers into one project/client ledger ordered by date. */
export function combinedLedger(bills: Parameters<typeof billLedger>[0][]): LedgerLine[] {
  const lines = bills
    .flatMap((bill) => billLedger(bill).map(({ balance: _balance, ...line }) => line))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'bill' ? -1 : 1) - (b.kind === 'bill' ? -1 : 1));
  return withRunningBalance(lines);
}

const withRunningBalance = (lines: Omit<LedgerLine, 'balance'>[]): LedgerLine[] => {
  let paise = 0;
  return lines.map((line) => {
    paise += toPaise(line.debit) - toPaise(line.credit);
    return { ...line, balance: roundMoney(paise / 100) };
  });
};

/* ── calendar: financial year, month, week ───────────────────────────────── */

const pad = (value: number) => String(value).padStart(2, '0');

/** Parses a `yyyy-MM-dd` key at local midnight. `null` for anything else. */
export function parseDateKey(key: string | undefined | null): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getMonth() === Number(match[2]) - 1 ? date : null;
}

export const toDateKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const todayKey = (now: Date = new Date()): string => toDateKey(now);

/** Indian FY of a date: 1 April – 31 March, labelled `2026-27`. */
export function financialYearOf(dateKey: string): string {
  const date = parseDateKey(dateKey);
  if (!date) return '';
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function financialYearRange(fy: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!match) return null;
  const start = Number(match[1]);
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** FYs from `fromStartYear` to the current one, newest first — the FY selector's options. */
export function financialYearOptions(now: Date = new Date(), fromStartYear = 2021): string[] {
  const current = financialYearOf(toDateKey(now));
  const currentStart = Number(current.slice(0, 4));
  const options: string[] = [];
  for (let year = currentStart + 1; year >= fromStartYear; year -= 1) {
    options.push(`${year}-${String((year + 1) % 100).padStart(2, '0')}`);
  }
  return options;
}

/** The twelve `yyyy-MM` month keys of an FY, April first. */
export function financialYearMonths(fy: string): string[] {
  const range = financialYearRange(fy);
  if (!range) return [];
  const start = Number(range.from.slice(0, 4));
  return Array.from({ length: 12 }, (_, index) => {
    const month = (3 + index) % 12;
    const year = index < 9 ? start : start + 1;
    return `${year}-${pad(month + 1)}`;
  });
}

export const monthKeyOf = (dateKey: string): string => dateKey.slice(0, 7);

export const monthLabel = (monthKey: string): string => {
  const date = parseDateKey(`${monthKey}-01`);
  return date ? date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : monthKey;
};

export function monthRange(monthKey: string): { from: string; to: string } {
  const [year, month] = monthKey.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${pad(last)}` };
}

/** ISO-8601 week key (`2026-W41`): weeks start Monday, week 1 holds the year's first Thursday. */
export function isoWeekOf(dateKey: string): string {
  const date = parseDateKey(dateKey);
  if (!date) return '';
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${pad(week)}`;
}

/** Monday and Sunday of an ISO week key. */
export function isoWeekRange(week: string): { from: string; to: string } | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const jan4 = new Date(year, 0, 4);
  const mondayOfWeek1 = new Date(year, 0, 4 - ((jan4.getDay() || 7) - 1));
  const monday = new Date(mondayOfWeek1);
  monday.setDate(mondayOfWeek1.getDate() + (Number(match[2]) - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: toDateKey(monday), to: toDateKey(sunday) };
}

/**
 * Legacy TARGET WEEK cells are free text ("41", "WK-41", "Week 41"). Resolves them to an ISO week
 * of the bill's year; anything unreadable is kept as-is by the caller.
 */
export function normaliseWeekKey(raw: string | number | undefined, referenceDateKey: string): string | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const text = String(raw).trim();
  if (/^\d{4}-W\d{2}$/.test(text)) return text;
  const number = /(\d{1,2})\s*$/.exec(text);
  if (!number) return undefined;
  const week = Number(number[1]);
  if (week < 1 || week > 53) return undefined;
  // The week of the bill's ISO year, rolled to the next year when it falls more than 26 weeks before
  // the bill and to the last when more than 39 after — target and received weeks lie ahead of the bill:
  // week 2 on a bill of 20 December is next January's, and week 52 on a bill of 3 January last December's.
  const reference = /^(\d{4})-W(\d{2})$/.exec(parseDateKey(referenceDateKey) ? isoWeekOf(referenceDateKey) : '');
  if (!reference) return `${Number(referenceDateKey.slice(0, 4)) || new Date().getFullYear()}-W${pad(week)}`;
  const offset = week - Number(reference[2]);
  const year = Number(reference[1]) + (offset < -26 ? 1 : offset > 39 ? -1 : 0);
  return `${year}-W${pad(week)}`;
}

export function addDays(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/** Whole days from `from` to `to` (calendar days, not DAYS360). */
export function daysBetween(from: string, to: string): number | null {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

/* ── ageing ──────────────────────────────────────────────────────────────── */

export const DEFAULT_AGEING_BUCKETS: AgeingBucketConfig[] = [
  { from: 0, to: 30, label: '0–30' },
  { from: 31, to: 60, label: '31–60' },
  { from: 61, to: 90, label: '61–90' },
  { from: 91, to: 180, label: '91–180' },
  { from: 181, to: 365, label: '181–365' },
  { from: 366, to: null, label: '365+' },
];

/** The bucket a day count falls in. Negative ages (dated after the as-on date) go in the first. */
export function ageingBucketOf(days: number, buckets: readonly AgeingBucketConfig[] = DEFAULT_AGEING_BUCKETS): AgeingBucketConfig {
  const sorted = [...buckets].sort((a, b) => a.from - b.from);
  if (days < (sorted[0]?.from ?? 0)) return sorted[0];
  return sorted.find((bucket) => days >= bucket.from && (bucket.to === null || days <= bucket.to)) ?? sorted[sorted.length - 1];
}

/** Rejects overlapping or gapped bucket configurations before they are saved. */
export function validateAgeingBuckets(buckets: readonly AgeingBucketConfig[]): string | null {
  if (!buckets.length) return 'Add at least one ageing bucket.';
  const sorted = [...buckets].sort((a, b) => a.from - b.from);
  if (sorted[0].from !== 0) return 'The first bucket must start at day 0.';
  for (let index = 0; index < sorted.length; index += 1) {
    const bucket = sorted[index];
    if (!bucket.label.trim()) return 'Every bucket needs a label.';
    if (bucket.to !== null && bucket.to < bucket.from) return `Bucket ${bucket.label} ends before it starts.`;
    const next = sorted[index + 1];
    if (next) {
      if (bucket.to === null) return `Only the last bucket can be open-ended (${bucket.label}).`;
      if (next.from !== bucket.to + 1) return `Buckets ${bucket.label} and ${next.label} leave a gap or overlap.`;
    } else if (bucket.to !== null) {
      return 'The last bucket must be open-ended so every age has a bucket.';
    }
  }
  return null;
}

export type AgeingSource = Pick<Bill, 'billDate' | 'submissionDate' | 'dueDate' | 'passedDate'>;

/**
 * The date ageing is measured from. Falls back to the bill date when the chosen basis is not
 * recorded on a bill (most legacy rows have no submission or due date), so a bill never silently
 * drops out of the ageing report.
 */
export const ageingBaseDate = (bill: AgeingSource, basis: keyof AgeingSource): string => bill[basis] || bill.billDate;

export const ageingDays = (bill: AgeingSource, basis: keyof AgeingSource, asOf: string): number =>
  daysBetween(ageingBaseDate(bill, basis), asOf) ?? 0;

/* ── as-on-date balances ─────────────────────────────────────────────────── */

/**
 * Outstanding on a past date, from transaction dates: the bill counts only if it was raised by
 * then, and only receipts dated on or before then reduce it. This is what lets "Outstanding as on
 * 31-Aug-2026" differ from today's balance. The net is the bill's stored one, so a certification's
 * deductions count from the bill date, not from the date the client certified.
 */
export function outstandingAsOf(
  bill: Pick<Bill, 'billDate' | 'netReceivable' | 'collections' | 'paymentStatusOverride' | 'isDeleted'>,
  asOf: string,
  tolerance: number,
): { included: boolean; received: number; outstanding: number; status: BillPaymentStatus } {
  if (bill.isDeleted || bill.billDate > asOf) {
    return { included: false, received: 0, outstanding: 0, status: 'not_received' };
  }
  const received = totalReceived(bill.collections.filter((entry) => entry.receiptDate <= asOf));
  // An override counts from the day it was set — an earlier "as on" date shows the bill as it then
  // stood — and a cancelled bill owes nothing, as `deriveBillTotals` has it.
  const override = bill.paymentStatusOverride;
  const status = (override && (!override.at || override.at.slice(0, 10) <= asOf) ? override.status : undefined) ?? computePaymentStatus(bill.netReceivable, received, tolerance);
  const outstanding = status === 'received' || status === 'adjusted' || status === 'cancelled' ? 0 : subtractMoney(bill.netReceivable, received);
  return { included: true, received, outstanding, status };
}

/* ── workflow ────────────────────────────────────────────────────────────── */

/** The forward path of the default workflow. */
export const WORKFLOW_PATH: readonly BillWorkflowStatus[] = [
  'draft',
  'submitted',
  'under_verification',
  'verified',
  'approved',
  'raised',
  'certified',
  'payment_followup',
  'reconciliation',
  'closed',
];

export const nextWorkflowStatus = (status: BillWorkflowStatus): BillWorkflowStatus | null => {
  const index = WORKFLOW_PATH.indexOf(status);
  return index >= 0 && index < WORKFLOW_PATH.length - 1 ? WORKFLOW_PATH[index + 1] : null;
};

/**
 * Where a returned bill goes once corrected: one step before the stage that returned it (at the
 * earliest, `draft`), so the stage that objected sees it again next.
 */
export const resubmitTarget = (returnedFrom: BillWorkflowStatus | undefined): BillWorkflowStatus => {
  const index = returnedFrom ? WORKFLOW_PATH.indexOf(returnedFrom) : -1;
  return index > 0 ? WORKFLOW_PATH[index - 1] : 'draft';
};

/** The bill fields that lock at the amount-lock step: changing one needs Edit After Approval and a reason. */
export const PROTECTED_BILL_FIELDS = ['taxableAmount', 'gstType', 'gstAmount', 'cgstAmount', 'sgstAmount', 'igstAmount', 'gstRegistrationId', 'deductions', 'gstInvoiceNumber', 'billDate', 'projectId', 'transactionType', 'againstBillId', 'adjustsNoteId'] as const;
export type ProtectedBillField = (typeof PROTECTED_BILL_FIELDS)[number];

/** A deduction line as the lock sees it: what it deducts, never its name, remarks or the order of its keys. */
const lockedLine = (line: BillDeduction): string =>
  [line.deductionTypeId, toPaise(line.amount), toPaise(line.baseAmount ?? line.amount), line.percentage ?? '', toPaise(line.cgstAmount ?? 0), toPaise(line.sgstAmount ?? 0), toPaise(line.igstAmount ?? 0)].join('|');

/**
 * The protected fields an edit changes, compared by value: money to the paisa, a blank and a missing
 * text alike, a bill with no GST type and no GST the same as "No GST", and deduction lines by what they
 * deduct, in any order. A renamed head, a reworded remark or the order Firestore returns a map's keys
 * in is therefore no change. The server and the bill form share it, so the form asks for a reason
 * exactly when the server will.
 */
export function protectedChanges(before: Partial<Pick<Bill, ProtectedBillField>>, after: Partial<Pick<Bill, ProtectedBillField>>): ProtectedBillField[] {
  const text = (value: unknown) => (value === undefined || value === null ? '' : String(value).trim());
  const money = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? toPaise(value) : 0);
  const gstType = (bill: typeof before) => bill.gstType ?? (money(bill.gstAmount) === 0 ? 'none' : '');
  const lines = (value: readonly BillDeduction[] | undefined) => (value ?? []).map(lockedLine).sort().join(';');
  return PROTECTED_BILL_FIELDS.filter((key) => {
    if (key === 'deductions') return lines(before.deductions) !== lines(after.deductions);
    if (key === 'gstType') return gstType(before) !== gstType(after);
    if (key === 'taxableAmount' || key === 'gstAmount' || key === 'cgstAmount' || key === 'sgstAmount' || key === 'igstAmount') return money(before[key]) !== money(after[key]);
    return text(before[key]) !== text(after[key]);
  });
}

export const isPastApproval = (status: BillWorkflowStatus): boolean =>
  WORKFLOW_PATH.indexOf(status) >= WORKFLOW_PATH.indexOf('approved');
