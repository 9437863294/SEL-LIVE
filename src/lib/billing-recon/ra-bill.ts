/**
 * RA bill abstracts: which certified JMC / MVAC quantities are still there to bill, and whether a
 * draft bill is valid.
 *
 * ## The balance of a line
 *
 * A bill line points at one line of one certified entry — `(source, entryId, itemIndex)` — and
 * bills part or all of that line's certified quantity:
 *
 *   balance = certified − Σ billedQty on every *other* bill that is not Cancelled
 *
 * Drafts count: a quantity on an unsubmitted draft is spoken for, so two drafts cannot bill the
 * same quantity twice. A cancelled bill frees its quantities again. When a draft is edited it is
 * left out of the sum, so its own quantities are part of what it may bill.
 *
 * Only lines with a certified quantity are billable, and only on entries that still count — not
 * Rejected or Cancelled ones.
 *
 * Money stays in Bill Tracking: an RA bill carries quantity × the entry line's rate as `amount`
 * for reference, and no GST, retention or deductions.
 *
 * Pure (no Firebase, no React) — tests/billing-recon-ra-bill.test.mjs.
 */

import type { RaBillItem, RaBillSource, RaBillStatus } from './types';
import { countsAsBilled } from './types.ts';
import {
  QTY_TOLERANCE,
  compareNatural,
  entryIsVoid,
  formatQty,
  isIsoDate,
  parseQtyInput,
  readEntryLine,
  round2,
  roundQty,
  toIsoDate,
  toNumber,
} from './lines.ts';

/** The fields of a JMC / MVAC entry this file reads. `JmcEntry` and `MvacEntry` both fit. */
export interface RegisterEntryLike {
  id: string;
  status?: unknown;
  items?: unknown;
  jmcNo?: unknown;
  mvacNo?: unknown;
  jmcDate?: unknown;
  mvacDate?: unknown;
}

/** The fields of an RA bill this file reads. `RaBill` fits. */
export interface BillLike {
  id: string;
  status?: unknown;
  billNo?: unknown;
  raSequence?: unknown;
  totalAmount?: unknown;
  items?: unknown;
}

/** The key of one entry line: `JMC|abc123|0`. */
export function lineRef(source: string, entryId: string, itemIndex: number): string {
  return `${source}|${entryId}|${itemIndex}`;
}

/** The key of a stored bill line. */
export function billItemRef(item: unknown): string {
  const record = (item ?? {}) as Record<string, unknown>;
  return lineRef(String(record.source ?? ''), String(record.entryId ?? ''), Number(record.itemIndex ?? -1));
}

const itemsOf = (bill: BillLike): unknown[] => (Array.isArray(bill.items) ? bill.items : []);

/** Σ billedQty per entry line over the bills that count (not Cancelled), less any one bill. */
export function billedQtyByLine(bills: readonly BillLike[], options: { excludeBillId?: string } = {}): Map<string, number> {
  const totals = new Map<string, number>();
  for (const bill of bills) {
    if (!countsAsBilled(bill)) continue;
    if (options.excludeBillId && bill.id === options.excludeBillId) continue;
    for (const item of itemsOf(bill)) {
      const qty = toNumber((item as Record<string, unknown> | null)?.billedQty);
      if (!qty) continue;
      const ref = billItemRef(item);
      totals.set(ref, roundQty((totals.get(ref) ?? 0) + qty));
    }
  }
  return totals;
}

/** One certified entry line, with what is left of it to bill. */
export interface BillableLine {
  ref: string;
  source: RaBillSource;
  entryId: string;
  entryNo: string;
  /** yyyy-mm-dd, '' when the entry has none. */
  entryDate: string;
  itemIndex: number;
  boqSlNo: string;
  scope1: string;
  scope2: string;
  description: string;
  unit: string;
  rate: number;
  executedQty: number;
  certifiedQty: number;
  previouslyBilledQty: number;
  /** certified − previously billed, never below 0. */
  balanceQty: number;
}

function linesOfEntries(source: RaBillSource, entries: readonly RegisterEntryLike[], billed: Map<string, number>): BillableLine[] {
  const out: BillableLine[] = [];
  for (const entry of entries) {
    if (!entry || entryIsVoid(entry.status)) continue;
    const items = Array.isArray(entry.items) ? entry.items : [];
    const entryNo = String((source === 'JMC' ? entry.jmcNo : entry.mvacNo) ?? '').trim();
    const entryDate = toIsoDate(source === 'JMC' ? entry.jmcDate : entry.mvacDate);
    items.forEach((item, itemIndex) => {
      const fields = readEntryLine(item);
      const certifiedQty = roundQty(fields.certifiedQty);
      if (!(certifiedQty > QTY_TOLERANCE)) return;
      const ref = lineRef(source, entry.id, itemIndex);
      const previouslyBilledQty = roundQty(billed.get(ref) ?? 0);
      out.push({
        ref,
        source,
        entryId: entry.id,
        entryNo,
        entryDate,
        itemIndex,
        boqSlNo: fields.boqSlNo,
        scope1: fields.scope1,
        scope2: fields.scope2,
        description: fields.description,
        unit: fields.unit,
        rate: fields.rate,
        executedQty: roundQty(fields.executedQty),
        certifiedQty,
        previouslyBilledQty,
        balanceQty: Math.max(0, roundQty(certifiedQty - previouslyBilledQty)),
      });
    });
  }
  return out;
}

/**
 * Every certified line of the project's JMC and MVAC entries with its billed-so-far and balance —
 * fully billed lines included (balance 0), so a screen can show or hide them. JMC first, then
 * MVAC; within each by entry date, entry number, then line order.
 */
export function computeBillableLines(input: {
  jmcEntries?: readonly RegisterEntryLike[];
  mvacEntries?: readonly RegisterEntryLike[];
  bills?: readonly BillLike[];
  /** The draft being edited: its own quantities do not count against it. */
  excludeBillId?: string;
}): BillableLine[] {
  const billed = billedQtyByLine(input.bills ?? [], { excludeBillId: input.excludeBillId });
  const lines = [
    ...linesOfEntries('JMC', input.jmcEntries ?? [], billed),
    ...linesOfEntries('MVAC', input.mvacEntries ?? [], billed),
  ];
  return lines.sort(
    (a, b) =>
      (a.source === b.source ? 0 : a.source === 'JMC' ? -1 : 1) ||
      (a.entryDate || '9999').localeCompare(b.entryDate || '9999') ||
      compareNatural(a.entryNo, b.entryNo) ||
      a.entryId.localeCompare(b.entryId) ||
      a.itemIndex - b.itemIndex,
  );
}

/** What is certified and not yet on a bill, at each line's own rate. */
export function unbilledCertifiedValue(lines: readonly BillableLine[]): number {
  return round2(lines.reduce((sum, line) => sum + line.balanceQty * line.rate, 0));
}

/* ── Numbering ─────────────────────────────────────────────────────────────────────────────── */

/** The next RA number: one more than the highest any bill of the project holds (cancelled too). */
export function nextRaSequence(bills: readonly BillLike[]): number {
  let max = 0;
  for (const bill of bills) {
    const n = Math.floor(toNumber(bill.raSequence));
    if (n > max) max = n;
  }
  return max + 1;
}

/** The suggested bill number: `${prefix}RA-${nn}` — "RA-01", or "SEL/220KV/RA-03" with a prefix. */
export function formatRaBillNo(sequence: number, prefix = ''): string {
  const n = Math.max(1, Math.floor(Number(sequence) || 1));
  return `${prefix ?? ''}RA-${String(n).padStart(2, '0')}`;
}

/** A bill number as uniqueness compares it: trimmed, inner spaces collapsed, case ignored. */
export function normaliseBillNo(billNo: unknown): string {
  return String(billNo ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * True when another bill of the project already has this number. Every bill is checked —
 * cancelled ones too — so a number is never reused.
 */
export function isDuplicateBillNo(billNo: unknown, bills: readonly BillLike[], excludeBillId?: string): boolean {
  const wanted = normaliseBillNo(billNo);
  if (!wanted) return false;
  return bills.some((bill) => bill.id !== excludeBillId && normaliseBillNo(bill.billNo) === wanted);
}

/* ── Validating a draft ────────────────────────────────────────────────────────────────────── */

export interface DraftLineInput {
  /** `lineRef(source, entryId, itemIndex)` of the entry line. */
  ref: string;
  /** As typed: a number or the input's text. Blank or 0 leaves the line off the bill. */
  billedQty: unknown;
}

export interface RaBillDraftInput {
  billNo: string;
  billDate: string;
  periodFrom?: string;
  periodTo?: string;
  lines: readonly DraftLineInput[];
}

export interface RaBillValidation {
  ok: boolean;
  /** Problems with the bill as a whole. */
  errors: string[];
  /** Problems with one line, by its ref. */
  lineErrors: Record<string, string>;
  /** The bill's lines — those with a quantity — in billable-line order. */
  items: RaBillItem[];
  totalAmount: number;
}

/**
 * Checks a draft against the current billable lines and the project's other bills, and builds the
 * lines to store. `billableLines` must come from `computeBillableLines` with the same
 * `excludeBillId` when editing, so the draft's own quantities are in the balances.
 */
export function validateRaBillDraft(
  draft: RaBillDraftInput,
  billableLines: readonly BillableLine[],
  existingBills: readonly BillLike[],
  options: { editingBillId?: string } = {},
): RaBillValidation {
  const errors: string[] = [];
  const lineErrors: Record<string, string> = {};

  const billNo = String(draft.billNo ?? '').trim();
  if (!billNo) errors.push('Enter the bill number.');
  else if (isDuplicateBillNo(billNo, existingBills, options.editingBillId)) {
    errors.push(`Bill number “${billNo}” is already used by another RA bill of this project.`);
  }

  if (!isIsoDate(draft.billDate)) errors.push('Enter the bill date.');
  const from = draft.periodFrom?.trim() ?? '';
  const to = draft.periodTo?.trim() ?? '';
  if (from && !isIsoDate(from)) errors.push('The period start is not a valid date.');
  if (to && !isIsoDate(to)) errors.push('The period end is not a valid date.');
  if (isIsoDate(from) && isIsoDate(to) && from > to) errors.push('The period ends before it starts.');

  // The last value typed for a line wins.
  const typed = new Map<string, unknown>();
  for (const line of draft.lines) typed.set(line.ref, line.billedQty);

  const items: RaBillItem[] = [];
  const known = new Set<string>();
  for (const line of billableLines) {
    known.add(line.ref);
    if (!typed.has(line.ref)) continue;
    const qty = parseQtyInput(typed.get(line.ref));
    if (Number.isNaN(qty)) {
      lineErrors[line.ref] = 'Enter a number.';
      continue;
    }
    if (qty < 0) {
      lineErrors[line.ref] = 'The quantity cannot be negative.';
      continue;
    }
    if (qty === 0) continue;
    if (qty > line.balanceQty + QTY_TOLERANCE) {
      lineErrors[line.ref] =
        line.balanceQty > QTY_TOLERANCE
          ? `Only ${formatQty(line.balanceQty)} ${line.unit}`.trim() + ' is left to bill on this line.'
          : 'Nothing is left to bill on this line.';
      continue;
    }
    if (!(line.rate >= 0)) {
      lineErrors[line.ref] = 'The line’s rate is negative — correct the JMC / MVAC entry first.';
      continue;
    }
    const billedQty = roundQty(Math.min(qty, line.balanceQty));
    items.push({
      source: line.source,
      entryId: line.entryId,
      entryNo: line.entryNo,
      itemIndex: line.itemIndex,
      boqSlNo: line.boqSlNo,
      scope1: line.scope1,
      scope2: line.scope2,
      description: line.description,
      unit: line.unit,
      rate: line.rate,
      certifiedQty: line.certifiedQty,
      previouslyBilledQty: line.previouslyBilledQty,
      billedQty,
      amount: round2(billedQty * line.rate),
    });
  }

  // Quantities on lines that are no longer certified (entry rejected, line decertified).
  let stale = 0;
  for (const [ref, value] of typed) {
    if (known.has(ref)) continue;
    const qty = parseQtyInput(value);
    if (Number.isNaN(qty) || qty !== 0) {
      lineErrors[ref] = 'This line is no longer certified — remove its quantity.';
      stale += 1;
    }
  }
  if (stale) errors.push(`${stale} line${stale === 1 ? ' is' : 's are'} no longer certified — remove ${stale === 1 ? 'its quantity' : 'their quantities'}.`);

  const lineErrorCount = Object.keys(lineErrors).length;
  if (!items.length && !lineErrorCount) errors.push('Enter a quantity on at least one line.');
  if (lineErrorCount && lineErrorCount > stale) {
    const n = lineErrorCount - stale;
    errors.push(`${n} line${n === 1 ? ' needs' : 's need'} correcting.`);
  }

  const totalAmount = round2(items.reduce((sum, item) => sum + item.amount, 0));
  return { ok: errors.length === 0, errors, lineErrors, items, totalAmount };
}

/* ── The register ──────────────────────────────────────────────────────────────────────────── */

export interface RaBillSummary {
  /** Bills that count (not Cancelled). */
  count: number;
  draftCount: number;
  submittedCount: number;
  cancelledCount: number;
  /** Σ totalAmount of the bills that count. */
  billedValue: number;
}

export function summarizeRaBills(bills: readonly BillLike[]): RaBillSummary {
  let count = 0;
  let draftCount = 0;
  let submittedCount = 0;
  let cancelledCount = 0;
  let billedValue = 0;
  for (const bill of bills) {
    if (!countsAsBilled(bill)) {
      cancelledCount += 1;
      continue;
    }
    count += 1;
    if (bill.status === 'Draft') draftCount += 1;
    if (bill.status === 'Submitted') submittedCount += 1;
    billedValue += toNumber(bill.totalAmount);
  }
  return { count, draftCount, submittedCount, cancelledCount, billedValue: round2(billedValue) };
}

/** Only a draft can be edited. */
export const canEditRaBill = (bill: { status?: unknown }): boolean => bill.status === 'Draft';

/** A draft is submitted once it is final. */
export const canSubmitRaBill = (bill: { status?: unknown }): boolean => bill.status === 'Draft';

/** Any bill not already cancelled can be cancelled, which frees its quantities. */
export const canCancelRaBill = (bill: { status?: unknown }): boolean => bill.status !== 'Cancelled';

export const isRaBillStatus = (value: unknown): value is RaBillStatus =>
  value === 'Draft' || value === 'Submitted' || value === 'Cancelled';

/**
 * For printing: per entry line, what the project's earlier RA bills (lower `raSequence`, not
 * Cancelled) billed before this one — "up to previous bill" on the abstract. Worked out from the
 * bills as they stand, so a bill cancelled after this one was made no longer counts.
 */
export function billedBefore(bill: BillLike, bills: readonly BillLike[]): Map<string, number> {
  const sequence = toNumber(bill.raSequence);
  const earlier = bills.filter((other) => other.id !== bill.id && sequence > 0 && toNumber(other.raSequence) < sequence);
  return billedQtyByLine(earlier);
}
