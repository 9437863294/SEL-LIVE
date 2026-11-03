/**
 * BOQ reconciliation: per BOQ item, how much of the tendered quantity has been executed, certified
 * and billed, and what is left at each step.
 *
 *   to execute = BOQ qty − executed (JMC + MVAC)
 *   to certify = executed − certified
 *   to bill    = certified − billed (RA bills that are not Cancelled)
 *
 * Balances keep their sign: a negative "to execute" is work beyond the BOQ (flagged
 * over-executed), a negative "to bill" is more billed than certified (flagged over-billed). The
 * outstanding *values* — to-execute, to-certify, to-bill — add up only the positive balances, so
 * one over-billed item never hides another item's unbilled quantity; the excess is reported apart.
 *
 * Lines are matched to BOQ items by scope 1 / scope 2 / BOQ SL No (see `lines.ts`). A JMC, MVAC or
 * RA bill line that matches no BOQ item is listed as **unmatched** rather than dropped. Rejected
 * and Cancelled JMC / MVAC entries are left out, as the RA bill screens leave them out.
 *
 * Values are quantity × the BOQ item's rate; an unmatched line is valued at its own rate.
 *
 * Pure (no Firebase, no React) — tests/billing-recon-reconciliation.test.mjs.
 */

import { countsAsBilled } from './types.ts';
import {
  QTY_TOLERANCE,
  compareNatural,
  entryIsVoid,
  lineKey,
  normaliseScope,
  readBoqRow,
  readEntryLine,
  readNumber,
  round2,
  roundQty,
  toIsoDate,
  toNumber,
} from './lines.ts';
import type { BillLike, RegisterEntryLike } from './ra-bill.ts';

export interface ReconciliationRow {
  /** The BOQ item's document id. */
  id: string;
  key: string;
  boqSlNo: string;
  erpSlNo: string;
  scope1: string;
  scope2: string;
  description: string;
  unit: string;
  boqQty: number;
  rate: number;
  boqAmount: number;
  jmcExecutedQty: number;
  jmcCertifiedQty: number;
  mvacExecutedQty: number;
  mvacCertifiedQty: number;
  executedQty: number;
  certifiedQty: number;
  billedQty: number;
  toExecuteQty: number;
  toCertifyQty: number;
  toBillQty: number;
  executedValue: number;
  certifiedValue: number;
  billedValue: number;
  /** Positive balances only, × rate. */
  toExecuteValue: number;
  toCertifyValue: number;
  toBillValue: number;
  overExecuted: boolean;
  overBilled: boolean;
  /**
   * The id of an earlier BOQ item with the same scope / SL No key. Its quantities went to that
   * item, so they are not counted twice; this row shows none.
   */
  duplicateOf: string | null;
  /** Executed but not certified, or certified but not billed (either way round). */
  hasGap: boolean;
  /** Over-executed, over-billed or a duplicate key. */
  isException: boolean;
}

export type UnmatchedSource = 'JMC' | 'MVAC' | 'RA Bill';

export interface UnmatchedLine {
  /** `${source}|${docId}|${itemIndex}` */
  id: string;
  source: UnmatchedSource;
  docId: string;
  docNo: string;
  /** yyyy-mm-dd or ''. */
  docDate: string;
  itemIndex: number;
  boqSlNo: string;
  scope1: string;
  scope2: string;
  description: string;
  unit: string;
  rate: number;
  executedQty: number;
  certifiedQty: number;
  billedQty: number;
  /** Certified × rate for a JMC / MVAC line, billed × rate for a bill line. */
  value: number;
  reason: string;
}

export interface ReconciliationTotals {
  items: number;
  boqValue: number;
  executedValue: number;
  certifiedValue: number;
  billedValue: number;
  toExecuteValue: number;
  toCertifyValue: number;
  toBillValue: number;
  /** Value of work beyond the BOQ quantity. */
  overExecutedValue: number;
  /** Value billed beyond the certified quantity. */
  overBilledValue: number;
  gapItems: number;
  overExecutedItems: number;
  overBilledItems: number;
  duplicateItems: number;
}

export interface Reconciliation {
  rows: ReconciliationRow[];
  unmatched: UnmatchedLine[];
  totals: ReconciliationTotals;
  /** Σ value of the unmatched lines. */
  unmatchedValue: number;
}

export interface ReconciliationInput {
  boqItems: ReadonlyArray<{ id: string }>;
  jmcEntries?: readonly RegisterEntryLike[];
  mvacEntries?: readonly RegisterEntryLike[];
  bills?: readonly BillLike[];
}

interface Agg {
  jmcExecuted: number;
  jmcCertified: number;
  mvacExecuted: number;
  mvacCertified: number;
  billed: number;
}

const emptyAgg = (): Agg => ({ jmcExecuted: 0, jmcCertified: 0, mvacExecuted: 0, mvacCertified: 0, billed: 0 });

const NO_SL_NO = 'The line has no BOQ SL No.';
const NO_BOQ_ITEM = 'No BOQ item has this scope and BOQ SL No.';

const positive = (n: number) => (n > QTY_TOLERANCE ? n : 0);
const nonZero = (n: number) => Math.abs(n) > QTY_TOLERANCE;

export function buildReconciliation(input: ReconciliationInput): Reconciliation {
  // BOQ rows in BOQ order: ERP SL No, then BOQ SL No, read as numbers where they are numbers.
  const boq = input.boqItems
    .map((item) => ({ id: String(item.id), fields: readBoqRow(item) }))
    .sort(
      (a, b) =>
        (a.fields.erpSlNo ? 0 : 1) - (b.fields.erpSlNo ? 0 : 1) ||
        compareNatural(a.fields.erpSlNo, b.fields.erpSlNo) ||
        compareNatural(a.fields.boqSlNo, b.fields.boqSlNo) ||
        a.id.localeCompare(b.id),
    );

  // The first BOQ item holding a key owns it; a later one with the same key is a duplicate.
  const ownerByKey = new Map<string, string>();
  for (const row of boq) {
    if (!row.fields.boqSlNo) continue;
    const key = lineKey(row.fields);
    if (!ownerByKey.has(key)) ownerByKey.set(key, row.id);
  }

  const aggByKey = new Map<string, Agg>();
  const unmatched: UnmatchedLine[] = [];
  const aggFor = (key: string) => {
    let agg = aggByKey.get(key);
    if (!agg) {
      agg = emptyAgg();
      aggByKey.set(key, agg);
    }
    return agg;
  };

  const addEntries = (source: 'JMC' | 'MVAC', entries: readonly RegisterEntryLike[]) => {
    for (const entry of entries) {
      if (!entry || entryIsVoid(entry.status)) continue;
      const items = Array.isArray(entry.items) ? entry.items : [];
      items.forEach((item, itemIndex) => {
        const line = readEntryLine(item);
        const key = lineKey(item);
        if (line.boqSlNo && ownerByKey.has(key)) {
          const agg = aggFor(key);
          if (source === 'JMC') {
            agg.jmcExecuted += line.executedQty;
            agg.jmcCertified += line.certifiedQty;
          } else {
            agg.mvacExecuted += line.executedQty;
            agg.mvacCertified += line.certifiedQty;
          }
          return;
        }
        if (!nonZero(line.executedQty) && !nonZero(line.certifiedQty)) return;
        unmatched.push({
          id: `${source}|${entry.id}|${itemIndex}`,
          source,
          docId: entry.id,
          docNo: String((source === 'JMC' ? entry.jmcNo : entry.mvacNo) ?? '').trim(),
          docDate: toIsoDate(source === 'JMC' ? entry.jmcDate : entry.mvacDate),
          itemIndex,
          boqSlNo: line.boqSlNo,
          scope1: line.scope1,
          scope2: line.scope2,
          description: line.description,
          unit: line.unit,
          rate: line.rate,
          executedQty: roundQty(line.executedQty),
          certifiedQty: roundQty(line.certifiedQty),
          billedQty: 0,
          value: round2(line.certifiedQty * line.rate),
          reason: line.boqSlNo ? NO_BOQ_ITEM : NO_SL_NO,
        });
      });
    }
  };

  addEntries('JMC', input.jmcEntries ?? []);
  addEntries('MVAC', input.mvacEntries ?? []);

  for (const bill of input.bills ?? []) {
    if (!countsAsBilled(bill)) continue;
    const items = Array.isArray(bill.items) ? bill.items : [];
    items.forEach((item, itemIndex) => {
      const billedQty = readNumber(item, ['billedQty']);
      if (!nonZero(billedQty)) return;
      const line = readEntryLine(item);
      const key = lineKey(item);
      if (line.boqSlNo && ownerByKey.has(key)) {
        aggFor(key).billed += billedQty;
        return;
      }
      const record = (item ?? {}) as Record<string, unknown>;
      const amount = toNumber(record.amount) || billedQty * line.rate;
      unmatched.push({
        id: `RA Bill|${bill.id}|${itemIndex}`,
        source: 'RA Bill',
        docId: bill.id,
        docNo: String(bill.billNo ?? '').trim(),
        docDate: toIsoDate((bill as { billDate?: unknown }).billDate),
        itemIndex,
        boqSlNo: line.boqSlNo,
        scope1: line.scope1,
        scope2: line.scope2,
        description: line.description,
        unit: line.unit,
        rate: line.rate,
        executedQty: 0,
        certifiedQty: 0,
        billedQty: roundQty(billedQty),
        value: round2(amount),
        reason: line.boqSlNo ? NO_BOQ_ITEM : NO_SL_NO,
      });
    });
  }

  const rows: ReconciliationRow[] = boq.map(({ id, fields }) => {
    const key = lineKey(fields);
    const owner = fields.boqSlNo ? ownerByKey.get(key) : undefined;
    const duplicateOf = owner && owner !== id ? owner : null;
    const agg = owner === id ? aggByKey.get(key) ?? emptyAgg() : emptyAgg();

    const jmcExecutedQty = roundQty(agg.jmcExecuted);
    const jmcCertifiedQty = roundQty(agg.jmcCertified);
    const mvacExecutedQty = roundQty(agg.mvacExecuted);
    const mvacCertifiedQty = roundQty(agg.mvacCertified);
    const executedQty = roundQty(agg.jmcExecuted + agg.mvacExecuted);
    const certifiedQty = roundQty(agg.jmcCertified + agg.mvacCertified);
    const billedQty = roundQty(agg.billed);
    const boqQty = roundQty(fields.qty);
    const toExecuteQty = roundQty(boqQty - executedQty);
    const toCertifyQty = roundQty(executedQty - certifiedQty);
    const toBillQty = roundQty(certifiedQty - billedQty);
    const rate = fields.rate;
    const overExecuted = executedQty > boqQty + QTY_TOLERANCE;
    const overBilled = billedQty > certifiedQty + QTY_TOLERANCE;

    return {
      id,
      key,
      boqSlNo: fields.boqSlNo,
      erpSlNo: fields.erpSlNo,
      scope1: fields.scope1,
      scope2: fields.scope2,
      description: fields.description,
      unit: fields.unit,
      boqQty,
      rate,
      boqAmount: fields.amount,
      jmcExecutedQty,
      jmcCertifiedQty,
      mvacExecutedQty,
      mvacCertifiedQty,
      executedQty,
      certifiedQty,
      billedQty,
      toExecuteQty,
      toCertifyQty,
      toBillQty,
      executedValue: round2(executedQty * rate),
      certifiedValue: round2(certifiedQty * rate),
      billedValue: round2(billedQty * rate),
      toExecuteValue: round2(positive(toExecuteQty) * rate),
      toCertifyValue: round2(positive(toCertifyQty) * rate),
      toBillValue: round2(positive(toBillQty) * rate),
      overExecuted,
      overBilled,
      duplicateOf,
      hasGap: nonZero(toCertifyQty) || nonZero(toBillQty),
      isException: overExecuted || overBilled || duplicateOf !== null,
    };
  });

  return {
    rows,
    unmatched,
    totals: totalsOf(rows),
    unmatchedValue: round2(unmatched.reduce((sum, line) => sum + line.value, 0)),
  };
}

/** The totals of any set of rows — the whole project, or what a filter shows. */
export function totalsOf(rows: readonly ReconciliationRow[]): ReconciliationTotals {
  const totals: ReconciliationTotals = {
    items: rows.length,
    boqValue: 0,
    executedValue: 0,
    certifiedValue: 0,
    billedValue: 0,
    toExecuteValue: 0,
    toCertifyValue: 0,
    toBillValue: 0,
    overExecutedValue: 0,
    overBilledValue: 0,
    gapItems: 0,
    overExecutedItems: 0,
    overBilledItems: 0,
    duplicateItems: 0,
  };
  for (const row of rows) {
    totals.boqValue += row.boqAmount;
    totals.executedValue += row.executedValue;
    totals.certifiedValue += row.certifiedValue;
    totals.billedValue += row.billedValue;
    totals.toExecuteValue += row.toExecuteValue;
    totals.toCertifyValue += row.toCertifyValue;
    totals.toBillValue += row.toBillValue;
    if (row.overExecuted) {
      totals.overExecutedItems += 1;
      totals.overExecutedValue += (row.executedQty - row.boqQty) * row.rate;
    }
    if (row.overBilled) {
      totals.overBilledItems += 1;
      totals.overBilledValue += (row.billedQty - row.certifiedQty) * row.rate;
    }
    if (row.hasGap) totals.gapItems += 1;
    if (row.duplicateOf) totals.duplicateItems += 1;
  }
  for (const key of [
    'boqValue',
    'executedValue',
    'certifiedValue',
    'billedValue',
    'toExecuteValue',
    'toCertifyValue',
    'toBillValue',
    'overExecutedValue',
    'overBilledValue',
  ] as const) {
    totals[key] = round2(totals[key]);
  }
  return totals;
}

export interface ReconciliationFilters {
  /** '' or 'all' for every scope. */
  scope1?: string;
  scope2?: string;
  search?: string;
  onlyGaps?: boolean;
  /** Over-executed, over-billed or duplicate rows. (Unmatched lines are listed apart.) */
  onlyExceptions?: boolean;
}

const isAll = (value: string | undefined) => !value || value === 'all';

export function filterReconciliationRows(rows: readonly ReconciliationRow[], filters: ReconciliationFilters): ReconciliationRow[] {
  const search = (filters.search ?? '').trim().toLowerCase();
  const scope1 = isAll(filters.scope1) ? null : normaliseScope(filters.scope1);
  const scope2 = isAll(filters.scope2) ? null : normaliseScope(filters.scope2);
  return rows.filter((row) => {
    if (scope1 !== null && normaliseScope(row.scope1) !== scope1) return false;
    if (scope2 !== null && normaliseScope(row.scope2) !== scope2) return false;
    if (filters.onlyGaps && !row.hasGap) return false;
    if (filters.onlyExceptions && !row.isException) return false;
    if (!search) return true;
    return [row.boqSlNo, row.erpSlNo, row.description, row.scope1, row.scope2, row.unit].some((text) =>
      text.toLowerCase().includes(search),
    );
  });
}

/** The scopes the BOQ uses, for the filters: scope 2 narrowed to the chosen scope 1. */
export function scopeOptions(rows: readonly ReconciliationRow[], scope1?: string): { scope1: string[]; scope2: string[] } {
  const first = new Map<string, string>();
  const second = new Map<string, string>();
  const wanted = isAll(scope1) ? null : normaliseScope(scope1);
  for (const row of rows) {
    if (row.scope1 && !first.has(normaliseScope(row.scope1))) first.set(normaliseScope(row.scope1), row.scope1);
    if (wanted !== null && normaliseScope(row.scope1) !== wanted) continue;
    if (row.scope2 && !second.has(normaliseScope(row.scope2))) second.set(normaliseScope(row.scope2), row.scope2);
  }
  return {
    scope1: [...first.values()].sort(compareNatural),
    scope2: [...second.values()].sort(compareNatural),
  };
}
