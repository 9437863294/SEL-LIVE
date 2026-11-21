/**
 * Daily Progress values — a quantity in money, so planned and done can be read across lines that
 * are in different units: value = quantity × the BOQ line's rate.
 *
 * The rate is the one `useDprData` reads onto each leaf (`DprBoqItem.rate`): the BOQ line's own rate
 * (Budget Price, Unit Rate or Rate), or, for a sub-item, the derived rate that makes `qty × rate` its
 * share of the line's value (`boq-breakdown.ts`). So a value here adds up to the line's value
 * whatever the line is broken into.
 *
 * A line with no rate has no value — it is never given one. Totals skip it and count it, so a
 * screen can say how many lines are left out.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import {
  DPR_SCOPES,
  bucketsInRange,
  dprNumber,
  formatPeriodLabel,
  periodRangeFor,
  type DprDateRange,
  type DprEntry,
  type DprLine,
  type DprPeriodRow,
  type DprPeriodType,
  type DprScope,
  type DprTarget,
} from "./project-management-dpr.ts";
import {
  dprRecordedThrough,
  indexDprActuals,
  isValidRange,
  type DprPlan,
  type DprSettings,
} from "./project-management-dpr-plan.ts";
import { formatINR, formatINRCompact } from "./bill-tracking/money.ts";

/* ── Display ────────────────────────────────────────────────────────────────────────────────── */

/**
 * A value as the tables show it: whole rupees with Indian grouping (`₹1,75,051`), "—" for a line
 * with no rate. The app's own money formatter (`bill-tracking/money.ts`).
 */
export function formatDprValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return formatINR(Math.round(value));
}

/** A rate per unit: paise shown only when it has them (`₹250.50`, `₹5,000`); "—" for no rate. */
export function formatDprRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= 0) return "—";
  return formatINR(rate);
}

/** A value as a figure tile shows it: `₹12.43 Cr`, `₹76.25 L`, `₹85,430`. The full value goes in a title. */
export function formatDprValueCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return formatINRCompact(value);
}

/** A BOQ leaf's rate by its id, from whatever carries `{ id, rate }` (`DprBoqItem`). */
export type DprRateLookup = ReadonlyMap<string, number>;

/** Rates above zero only: a line priced at 0, or not priced, has no rate. */
export function buildDprRateLookup(items: ReadonlyArray<{ id: string; rate?: number | null }>): DprRateLookup {
  const map = new Map<string, number>();
  for (const item of items) {
    const rate = dprNumber(item?.rate);
    if (item?.id && rate > 0) map.set(item.id, rate);
  }
  return map;
}

/** The rate of a BOQ leaf, or null when it has none. */
export function dprRateOf(rates: DprRateLookup, boqItemId: string | null | undefined): number | null {
  if (!boqItemId) return null;
  return rates.get(boqItemId) ?? null;
}

/** quantity × rate, or null when the line has no rate. */
export function dprLineValue(rates: DprRateLookup, boqItemId: string | null | undefined, qty: unknown): number | null {
  const rate = dprRateOf(rates, boqItemId);
  return rate === null ? null : dprNumber(qty) * rate;
}

/* ── A projection record ────────────────────────────────────────────────────────────────────── */

export interface DprValueTotal {
  value: number;
  /** Lines counted in `value` (they have a rate). */
  priced: number;
  /** Lines left out because their BOQ line has no rate. */
  unpriced: number;
}

/** Σ planned quantity × rate over a record's projections (or any projections). */
export function dprPlannedValue(
  targets: ReadonlyArray<Pick<DprTarget, "boqItemId" | "plannedQty">>,
  rates: DprRateLookup,
): DprValueTotal {
  const total: DprValueTotal = { value: 0, priced: 0, unpriced: 0 };
  for (const target of targets) {
    const value = dprLineValue(rates, target.boqItemId, target.plannedQty);
    if (value === null) total.unpriced += 1;
    else {
      total.value += value;
      total.priced += 1;
    }
  }
  return total;
}

/* ── A progress sheet ───────────────────────────────────────────────────────────────────────── */

export interface DprSheetValue {
  /** Σ planned (the plan snapshot saved on each line) × rate. */
  planned: number;
  /** Σ actual × rate. A line saved with its Actual left empty adds nothing. */
  actual: number;
  priced: number;
  /** Lines left out of both figures because their BOQ line has no rate. */
  unpriced: number;
}

/** A sheet's planned and actual value, from the lines recorded on it. */
export function dprSheetValue(
  lines: ReadonlyArray<Pick<DprLine, "boqItemId" | "plannedQty" | "actualQty" | "actualEntered">> | undefined,
  rates: DprRateLookup,
): DprSheetValue {
  const total: DprSheetValue = { planned: 0, actual: 0, priced: 0, unpriced: 0 };
  for (const line of lines ?? []) {
    if (!line) continue;
    const rate = dprRateOf(rates, line.boqItemId);
    if (rate === null) {
      total.unpriced += 1;
      continue;
    }
    total.priced += 1;
    total.planned += dprNumber(line.plannedQty) * rate;
    if (line.actualEntered !== false) total.actual += dprNumber(line.actualQty) * rate;
  }
  return total;
}

/** Several sheets' values added up — the figures over the sheets a list shows. */
export function dprSheetsValue(
  sheets: ReadonlyArray<{ lines?: ReadonlyArray<Pick<DprLine, "boqItemId" | "plannedQty" | "actualQty" | "actualEntered">> }>,
  rates: DprRateLookup,
): DprSheetValue {
  const total: DprSheetValue = { planned: 0, actual: 0, priced: 0, unpriced: 0 };
  for (const sheet of sheets) {
    const value = dprSheetValue(sheet.lines, rates);
    total.planned += value.planned;
    total.actual += value.actual;
    total.priced += value.priced;
    total.unpriced += value.unpriced;
  }
  return total;
}

/** Actual as a share of planned, or null when nothing (priced) was planned. */
export function dprValuePct(actual: number, planned: number): number | null {
  return planned > 0 ? (actual / planned) * 100 : null;
}

/** "2 lines have no rate" — or "" when every line is priced. */
export function dprUnpricedText(unpriced: number): string {
  if (unpriced <= 0) return "";
  return `${unpriced} line${unpriced === 1 ? " has" : "s have"} no rate`;
}

/* ── A report's period ──────────────────────────────────────────────────────────────────────── */

type DprPeriodRowQuantities = Pick<
  DprPeriodRow,
  "id" | "plannedQty" | "actualQty" | "cumulativeQty" | "boqQty" | "balanceQty"
>;

export interface DprPeriodRowValue {
  rate: number | null;
  /** Projected for the period × rate. */
  planned: number | null;
  /** Done in the period × rate. */
  actual: number | null;
  /** Everything done up to the period end × rate. */
  toDate: number | null;
  /** The BOQ quantity × rate — the line's whole value. */
  boq: number | null;
  /** The BOQ balance × rate. */
  balance: number | null;
}

/** A report row's quantities in money; every figure null when the line has no rate. */
export function dprPeriodRowValue(row: DprPeriodRowQuantities, rates: DprRateLookup): DprPeriodRowValue {
  const rate = dprRateOf(rates, row.id);
  if (rate === null) return { rate, planned: null, actual: null, toDate: null, boq: null, balance: null };
  return {
    rate,
    planned: dprNumber(row.plannedQty) * rate,
    actual: dprNumber(row.actualQty) * rate,
    toDate: dprNumber(row.cumulativeQty) * rate,
    boq: dprNumber(row.boqQty) * rate,
    balance: dprNumber(row.balanceQty) * rate,
  };
}

export interface DprPeriodValueSummary {
  planned: number;
  actual: number;
  toDate: number;
  boq: number;
  balance: number;
  /** Actual ÷ planned value, in percent; null when nothing priced was planned. */
  achievementPct: number | null;
  /** Value to date ÷ BOQ value, in percent; null when no priced line has a BOQ quantity. */
  progressPct: number | null;
  priced: number;
  unpriced: number;
}

/** The period's value figures over a report's rows; lines without a rate are counted, not valued. */
export function summariseDprPeriodValues(
  rows: ReadonlyArray<DprPeriodRowQuantities>,
  rates: DprRateLookup,
): DprPeriodValueSummary {
  const summary = { planned: 0, actual: 0, toDate: 0, boq: 0, balance: 0, priced: 0, unpriced: 0 };
  for (const row of rows) {
    const value = dprPeriodRowValue(row, rates);
    if (value.rate === null) {
      summary.unpriced += 1;
      continue;
    }
    summary.priced += 1;
    summary.planned += value.planned ?? 0;
    summary.actual += value.actual ?? 0;
    summary.toDate += value.toDate ?? 0;
    summary.boq += value.boq ?? 0;
    summary.balance += value.balance ?? 0;
  }
  return {
    ...summary,
    achievementPct: dprValuePct(summary.actual, summary.planned),
    progressPct: summary.boq > 0 ? (summary.toDate / summary.boq) * 100 : null,
  };
}

export interface DprScopeValueRow extends DprPeriodValueSummary {
  scope: DprScope;
  /** The report's lines in this scope. */
  lines: number;
}

/** The period's value figures scope by scope, in the fixed scope order, for scopes with lines. */
export function dprPeriodValuesByScope(
  rows: ReadonlyArray<DprPeriodRowQuantities>,
  rates: DprRateLookup,
  scopeOf: (boqItemId: string) => DprScope | undefined,
): DprScopeValueRow[] {
  return DPR_SCOPES.map((scope) => {
    const inScope = rows.filter((row) => scopeOf(row.id) === scope);
    return { scope, lines: inScope.length, ...summariseDprPeriodValues(inScope, rates) };
  }).filter((row) => row.lines > 0);
}

/* ── Planned against actual value to date ───────────────────────────────────────────────────── */

export interface DprValueToDate {
  /** The latest of the scopes' recorded-up-to days (never after today or the period end). */
  asOf: string;
  /** The scopes shown stop on different days (one daily, one weekly, say). */
  mixed: boolean;
  plannedValue: number;
  actualValue: number;
}

/**
 * Planned and done value to date, schedule-aware: a line's planned value counts up to the day its
 * scope is recorded up to (`dprRecordedThrough`) — today for a daily scope, the last recording
 * day for one recorded weekly or on set days. Priced lines with anything planned or submitted in
 * the range; null before the period starts.
 */
export function buildDprValueToDate(input: {
  items: ReadonlyArray<{ id: string; scope: DprScope; rate?: number | null }>;
  entries: readonly DprEntry[];
  plan: Pick<DprPlan, "qtyInRange">;
  range: DprDateRange;
  scope?: DprScope;
  settings: Pick<DprSettings, "weeklyOff" | "holidays" | "recordingSchedule">;
  today: string;
}): DprValueToDate | null {
  const { items, entries, plan, range, scope, settings, today } = input;
  if (!isValidRange(range) || today < range.startDate) return null;
  const last = range.endDate < today ? range.endDate : today;
  const actuals = indexDprActuals(entries);
  const ends = new Map<DprScope, string>();
  let plannedValue = 0;
  let actualValue = 0;
  for (const item of items) {
    if (scope && item.scope !== scope) continue;
    const rate = dprNumber(item.rate);
    if (rate <= 0) continue;
    if (!(plan.qtyInRange(item.id, range) > 0 || actuals.total(item.id, range) > 0)) continue;
    let end = ends.get(item.scope);
    if (end === undefined) {
      const through = dprRecordedThrough(settings, item.scope, today);
      end = through < last ? through : last;
      ends.set(item.scope, end);
    }
    if (end >= range.startDate) plannedValue += plan.qtyInRange(item.id, { startDate: range.startDate, endDate: end }) * rate;
    actualValue += actuals.total(item.id, { startDate: range.startDate, endDate: last }) * rate;
  }
  const stops = [...new Set(ends.values())];
  return {
    asOf: stops.length > 0 ? stops.reduce((latest, day) => (day > latest ? day : latest)) : last,
    mixed: stops.length > 1,
    plannedValue,
    actualValue,
  };
}

/* ── Planned against actual value over time ─────────────────────────────────────────────────── */

export interface DprValueBucket {
  bucketStart: string;
  label: string;
  plannedValue: number;
  actualValue: number;
  cumulativePlannedValue: number;
  cumulativeActualValue: number;
}

export interface DprValueTrend {
  points: DprValueBucket[];
  /** Σ planned value over the whole range. */
  plannedValue: number;
  /** Σ actual value over the whole range. */
  actualValue: number;
  /** Lines planned or worked in the range that have a rate (and so are in the figures). */
  priced: number;
  /** Lines planned or worked in the range left out for having no rate. */
  unpriced: number;
}

/**
 * Planned and actual value per bucket (day, week or month) across the range, and running totals —
 * the money counterpart of the share trend. Lines are the scope's leaves with anything planned or
 * submitted in the range; a line with no rate is counted, never valued. Actuals are submitted
 * sheets only, as everywhere progress is counted.
 */
export function buildDprValueTrend(input: {
  items: ReadonlyArray<{ id: string; scope: DprScope; rate?: number | null }>;
  entries: readonly DprEntry[];
  plan: Pick<DprPlan, "qtyInRange">;
  range: DprDateRange;
  periodType: DprPeriodType;
  scope?: DprScope;
}): DprValueTrend {
  const { items, entries, plan, range, periodType, scope } = input;
  const empty: DprValueTrend = { points: [], plannedValue: 0, actualValue: 0, priced: 0, unpriced: 0 };
  if (!isValidRange(range)) return empty;
  const actuals = indexDprActuals(entries);
  const active = items
    .filter((item) => !scope || item.scope === scope)
    .filter((item) => plan.qtyInRange(item.id, range) > 0 || actuals.total(item.id, range) > 0);
  const priced = active.filter((item) => dprNumber(item.rate) > 0);

  let cumulativePlannedValue = 0;
  let cumulativeActualValue = 0;
  const points = bucketsInRange(periodType, range.startDate, range.endDate).map((bucketStart) => {
    const full = periodRangeFor(periodType, bucketStart);
    const bucket: DprDateRange = {
      startDate: full.startDate < range.startDate ? range.startDate : full.startDate,
      endDate: full.endDate > range.endDate ? range.endDate : full.endDate,
    };
    let plannedValue = 0;
    let actualValue = 0;
    for (const item of priced) {
      const rate = dprNumber(item.rate);
      plannedValue += plan.qtyInRange(item.id, bucket) * rate;
      actualValue += actuals.total(item.id, bucket) * rate;
    }
    cumulativePlannedValue += plannedValue;
    cumulativeActualValue += actualValue;
    return {
      bucketStart,
      label: formatPeriodLabel(periodType, bucketStart),
      plannedValue,
      actualValue,
      cumulativePlannedValue,
      cumulativeActualValue,
    };
  });
  return {
    points,
    plannedValue: cumulativePlannedValue,
    actualValue: cumulativeActualValue,
    priced: priced.length,
    unpriced: active.length - priced.length,
  };
}
