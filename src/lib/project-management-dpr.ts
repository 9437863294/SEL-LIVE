/**
 * Daily Progress Report — projected and actual work against BOQ lines.
 *
 * Two records make up the register:
 *
 *  - a **projection** (`DprTarget`) is a quantity someone commits to for a BOQ line over a period.
 *    The period is stored as an explicit inclusive date range, whatever granularity it was set at,
 *    so a month's projection and a day's actual can still be compared. That is what makes the
 *    reports dynamic: asking "how did this week go?" pro-rates whatever projections cover the week.
 *  - an **entry** (`DprEntry`) is one day's site record for one scope: the quantity actually done
 *    per BOQ line, plus the site diary — manpower, plant, weather, lost time and hindrances.
 *
 * Nothing here touches Firebase, so it is testable with `node --experimental-strip-types --test`.
 */

export const DPR_ENTRY_COLLECTION = "dprEntries";
export const DPR_TARGET_COLLECTION = "dprTargets";

export const DPR_PERMISSION_RESOURCE = "Project Management.DPR";
export const DPR_BASE_PATH = "/project-management/dpr";

/** The BOQ scopes a DPR covers. Matches the `Scope 2` values the execution workspaces filter on. */
export const DPR_SCOPES = ["Civil", "Erection"] as const;
export type DprScope = (typeof DPR_SCOPES)[number];

export const DPR_PERIOD_TYPES = ["Day", "Week", "Month"] as const;
export type DprPeriodType = (typeof DPR_PERIOD_TYPES)[number];

/**
 * The preset a projection was set with. Day, week and month are presets over the same stored
 * from/to range; "Custom" is any other range. Reports never read this — they read the dates.
 */
export const DPR_PROJECTION_PERIODS = ["Day", "Week", "Month", "Custom"] as const;
export type DprProjectionPeriod = (typeof DPR_PROJECTION_PERIODS)[number];

/**
 * How a projection's quantity is spread over the working days of its period: evenly, heavier at
 * the start, or heavier at the end. A projection saved before this existed reads as even.
 */
export const DPR_DISTRIBUTIONS = ["even", "front", "back"] as const;
export type DprDistribution = (typeof DPR_DISTRIBUTIONS)[number];

/** No approval walk — a DPR is a field log. Submitting only marks the day closed off. */
export const DPR_STATUSES = ["Draft", "Submitted"] as const;
export type DprStatus = (typeof DPR_STATUSES)[number];

export interface DprLine {
  id: string;
  boqItemId: string;
  boqSlNo: string;
  erpSlNo?: string;
  description: string;
  unit: string;
  /** The day's target: carried from whatever projection covers the date, and overridable. */
  plannedQty: number;
  actualQty: number;
  /**
   * false when a draft was saved with the Actual box left empty, so reopening it shows the box
   * empty rather than a 0 nobody typed. Absent on older lines, which read as entered.
   */
  actualEntered?: boolean;
  location?: string;
  agency?: string;
  remarks?: string;
}

export interface DprManpowerLine {
  id: string;
  trade: string;
  count: number;
}

export interface DprEquipmentLine {
  id: string;
  name: string;
  deployed: number;
  runningHours?: number;
  idleHours?: number;
}

export interface DprEntry {
  id: string;
  scope: DprScope;
  /** yyyy-mm-dd. One entry per scope per date. */
  date: string;
  status: DprStatus;
  lines: DprLine[];
  manpower: DprManpowerLine[];
  equipment: DprEquipmentLine[];
  weather?: string;
  lostTimeHours?: number;
  lostTimeReason?: string;
  hindrances?: string;
  remarks?: string;
  preparedByName?: string;
  /** Who submitted (and so locked) the sheet. Cleared nowhere: a reopen is logged beside it. */
  submittedAt?: unknown;
  submittedBy?: string;
  submittedByName?: string;
  /** The last reopen of a submitted sheet back to Draft. Only a DPR approver can do it. */
  reopenedAt?: unknown;
  reopenedBy?: string;
  reopenedByName?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export interface DprTarget {
  id: string;
  scope: DprScope;
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  periodType: DprProjectionPeriod;
  /** Inclusive ISO dates. Always stored, whatever `periodType` the projection was set at. */
  startDate: string;
  endDate: string;
  /** The current quantity. A revision changes this; the first figure stays in `baselineQty`. */
  plannedQty: number;
  /** Absent on projections saved before spreads existed, which read as "even". */
  distribution?: DprDistribution;
  /** The quantity as first saved. Absent before revisions existed, when it equals `plannedQty`. */
  baselineQty?: number;
  /** 0 for the baseline, then 1, 2… for each revision. */
  revisionNo?: number;
  /** Every change to the quantity, oldest first. A revision needs a reason; the baseline is kept. */
  revisions?: DprProjectionRevision[];
  remarks?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export interface DprProjectionRevision {
  revisionNo: number;
  fromQty: number;
  toQty: number;
  reason: string;
  /** ISO timestamp. Not a server timestamp, which Firestore refuses inside an array. */
  changedAt: string;
  changedBy: string;
  changedByName: string;
}

export type DprEntryDraft = Omit<
  DprEntry,
  "id" | "createdAt" | "createdBy" | "createdByName" | "updatedAt" | "updatedBy" | "updatedByName"
>;

export type DprTargetDraft = Omit<
  DprTarget,
  "id" | "createdAt" | "createdBy" | "createdByName" | "updatedAt" | "updatedBy" | "updatedByName"
>;

/* ── Numbers and dates ──────────────────────────────────────────────────────────────────────── */

/** Tolerates the comma-grouped strings BOQ imports carry. Never NaN, never negative-zero. */
export function dprNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

const DAY_MS = 86_400_000;

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Parses yyyy-mm-dd as a *local* midnight, matching how the rest of the module reads dates. */
export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  // Rejects 2026-02-31 and friends, which Date would roll forward.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;
  return toIsoDate(new Date(date.getTime() + days * DAY_MS));
}

/** Monday-first, which is how site weeks are run here. */
export function startOfWeek(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;
  const weekday = (date.getDay() + 6) % 7;
  return toIsoDate(new Date(date.getTime() - weekday * DAY_MS));
}

export function startOfMonth(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function endOfMonth(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;
  return toIsoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export interface DprDateRange {
  startDate: string;
  endDate: string;
}

/** The inclusive range the given period type covers around `anchorDate`. */
export function periodRangeFor(periodType: DprPeriodType, anchorDate: string): DprDateRange {
  if (!parseIsoDate(anchorDate)) return { startDate: anchorDate, endDate: anchorDate };
  if (periodType === "Day") return { startDate: anchorDate, endDate: anchorDate };
  if (periodType === "Week") {
    const startDate = startOfWeek(anchorDate);
    return { startDate, endDate: addDays(startDate, 6) };
  }
  return { startDate: startOfMonth(anchorDate), endDate: endOfMonth(anchorDate) };
}

/** Inclusive day count. 0 when either end is unparseable or the range is inverted. */
export function daysInRange(startDate: string, endDate: string): number {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) return 0;
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  return days > 0 ? days : 0;
}

export function eachDayInRange(startDate: string, endDate: string): string[] {
  const total = daysInRange(startDate, endDate);
  const days: string[] = [];
  for (let index = 0; index < total; index += 1) days.push(addDays(startDate, index));
  return days;
}

/**
 * A range bound: `undefined` when it is deliberately left blank (unbounded on that side), `null`
 * when it was given but could not be read — which is an error, not an invitation to assume.
 */
const rangeBound = (value: string): Date | null | undefined =>
  value ? parseIsoDate(value) : undefined;

/**
 * Inclusive overlap, in days, between two ranges.
 *
 * Either end of either range may be left blank to mean "unbounded", matching `isDateInRange`; the
 * other range's bound then governs. That is what lets a cumulative question — "everything up to
 * this date" — be asked of a projection without inventing a sentinel start date for it.
 */
export function overlapDays(a: DprDateRange, b: DprDateRange): number {
  const startA = rangeBound(a.startDate);
  const endA = rangeBound(a.endDate);
  const startB = rangeBound(b.startDate);
  const endB = rangeBound(b.endDate);
  if (startA === null || endA === null || startB === null || endB === null) return 0;

  const start = startA && startB ? Math.max(startA.getTime(), startB.getTime()) : (startA ?? startB)?.getTime();
  const end = endA && endB ? Math.min(endA.getTime(), endB.getTime()) : (endA ?? endB)?.getTime();
  // Unbounded on the same side in both ranges: there is no finite overlap to measure.
  if (start === undefined || end === undefined) return 0;
  if (end < start) return 0;
  return Math.round((end - start) / DAY_MS) + 1;
}

/**
 * Whether a date falls in a range, where either end may be left blank to mean "unbounded".
 *
 * ISO dates compare correctly as plain strings, so this needs no parsing — which also avoids
 * sentinel dates: `new Date(0, 0, 1)` is 1900, not year zero, so a "0000-01-01" lower bound
 * silently matched nothing at all.
 */
export function isDateInRange(isoDate: string, range: DprDateRange): boolean {
  if (!parseIsoDate(isoDate)) return false;
  if (range.startDate && isoDate < range.startDate) return false;
  if (range.endDate && isoDate > range.endDate) return false;
  return true;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** A short label for a period bucket — "05 Nov 2026", "Wk 03 Nov", "Nov 2026". */
export function formatPeriodLabel(periodType: DprPeriodType, startDate: string): string {
  const date = parseIsoDate(startDate);
  if (!date) return startDate;
  const day = String(date.getDate()).padStart(2, "0");
  const month = MONTH_LABELS[date.getMonth()];
  if (periodType === "Day") return `${day} ${month} ${date.getFullYear()}`;
  if (periodType === "Week") return `Wk ${day} ${month}`;
  return `${month} ${date.getFullYear()}`;
}

/** The start of the bucket a date falls in, for the given granularity. */
export function bucketStartFor(periodType: DprPeriodType, isoDate: string): string {
  if (periodType === "Day") return isoDate;
  if (periodType === "Week") return startOfWeek(isoDate);
  return startOfMonth(isoDate);
}

/** Every bucket start between two dates, inclusive of the buckets the ends fall in. */
export function bucketsInRange(
  periodType: DprPeriodType,
  startDate: string,
  endDate: string,
): string[] {
  if (!parseIsoDate(startDate) || !parseIsoDate(endDate)) return [];
  if (daysInRange(startDate, endDate) === 0) return [];
  const buckets: string[] = [];
  let cursor = bucketStartFor(periodType, startDate);
  // The final bucket is the one the end date sits in, so compare on bucket starts.
  const lastBucket = bucketStartFor(periodType, endDate);
  // Bounded by the day count so a malformed step can never spin.
  const guard = daysInRange(startDate, endDate) + 2;
  for (let index = 0; index < guard; index += 1) {
    buckets.push(cursor);
    if (cursor === lastBucket) break;
    const next =
      periodType === "Day"
        ? addDays(cursor, 1)
        : periodType === "Week"
          ? addDays(cursor, 7)
          : startOfMonth(addDays(endOfMonth(cursor), 1));
    if (next === cursor) break;
    cursor = next;
  }
  return buckets;
}

/* ── Projections ────────────────────────────────────────────────────────────────────────────── */

/**
 * How much of a projection falls inside `range`, pro-rated by day.
 *
 * A projection is a quantity over a span, with no finer shape to it, so the only honest way to
 * ask "how much of it belongs to these days?" is to spread it evenly and take the overlap. That
 * is what lets a monthly projection answer a weekly question.
 */
export function targetQtyInRange(target: DprTarget, range: DprDateRange): number {
  const span = daysInRange(target.startDate, target.endDate);
  if (span <= 0) return 0;
  const covered = overlapDays({ startDate: target.startDate, endDate: target.endDate }, range);
  if (covered <= 0) return 0;
  return (dprNumber(target.plannedQty) * covered) / span;
}

export interface DprTargetFilter {
  scope?: DprScope;
  boqItemId?: string;
}

const matchesTarget = (target: DprTarget, filter: DprTargetFilter): boolean => {
  if (filter.scope && target.scope !== filter.scope) return false;
  if (filter.boqItemId && target.boqItemId !== filter.boqItemId) return false;
  return true;
};

/** Projected quantity per BOQ item for a range, pro-rated across every covering projection. */
export function plannedQtyByBoqItem(
  targets: readonly DprTarget[],
  range: DprDateRange,
  filter: DprTargetFilter = {},
): Map<string, number> {
  const planned = new Map<string, number>();
  for (const target of targets) {
    if (!matchesTarget(target, filter)) continue;
    const qty = targetQtyInRange(target, range);
    if (qty === 0) continue;
    planned.set(target.boqItemId, (planned.get(target.boqItemId) ?? 0) + qty);
  }
  return planned;
}

/**
 * Anything that can answer "how much is planned per BOQ item over this range?".
 *
 * `plannedQtyByBoqItem` above is the plain answer: every projection spread evenly over calendar
 * days, overlaps added together. The planning engine in `project-management-dpr-plan.ts` is the
 * one the screens use — working days only, a chosen spread, and the shorter of two overlapping
 * projections owning the shared days. The report builders below take either, so a caller that
 * has the engine passes it and one that does not still gets the plain figure.
 */
export interface DprPlanReader {
  byItemInRange(range: DprDateRange, filter?: DprTargetFilter): Map<string, number>;
}

/** The day's share of every projection covering `isoDate` — what a fresh DPR line starts at. */
export function dailyPlannedByBoqItem(
  targets: readonly DprTarget[],
  isoDate: string,
  filter: DprTargetFilter = {},
): Map<string, number> {
  return plannedQtyByBoqItem(targets, { startDate: isoDate, endDate: isoDate }, filter);
}

/* ── Actuals ────────────────────────────────────────────────────────────────────────────────── */

export interface DprEntryFilter {
  scope?: DprScope;
  range?: DprDateRange;
  /** Draft days are excluded from reporting totals unless this is true. */
  includeDrafts?: boolean;
}

export function filterDprEntries(
  entries: readonly DprEntry[],
  filter: DprEntryFilter = {},
): DprEntry[] {
  return entries.filter((entry) => {
    if (filter.scope && entry.scope !== filter.scope) return false;
    if (!filter.includeDrafts && entry.status !== "Submitted") return false;
    if (filter.range && !isDateInRange(entry.date, filter.range)) return false;
    return true;
  });
}

export interface DprActualAggregate {
  actualQty: number;
  plannedQty: number;
  /** Days on which this line was worked at all. */
  workedDays: number;
  lastWorkedDate: string;
}

/** Actual (and as-recorded planned) quantity per BOQ item across the matching entries. */
export function aggregateActualsByBoqItem(
  entries: readonly DprEntry[],
  filter: DprEntryFilter = {},
): Map<string, DprActualAggregate> {
  const totals = new Map<string, DprActualAggregate>();
  for (const entry of filterDprEntries(entries, filter)) {
    for (const line of entry.lines ?? []) {
      if (!line?.boqItemId) continue;
      const actualQty = dprNumber(line.actualQty);
      const plannedQty = dprNumber(line.plannedQty);
      const current = totals.get(line.boqItemId) ?? {
        actualQty: 0,
        plannedQty: 0,
        workedDays: 0,
        lastWorkedDate: "",
      };
      current.actualQty += actualQty;
      current.plannedQty += plannedQty;
      if (actualQty > 0) {
        current.workedDays += 1;
        if (entry.date > current.lastWorkedDate) current.lastWorkedDate = entry.date;
      }
      totals.set(line.boqItemId, current);
    }
  }
  return totals;
}

/* ── The period report ──────────────────────────────────────────────────────────────────────── */

/** A BOQ line as the DPR reports it. Quantities only — a DPR measures work, not money. */
export interface DprBoqLike {
  id: string;
  boqSlNo: string;
  erpSlNo?: string;
  description: string;
  unit: string;
  boqQty: number;
  /**
   * The BOQ rate, where the line carries one. Used only to weight achievement across lines of
   * different units — never shown as money on a DPR screen.
   */
  rate?: number;
}

export interface DprPeriodRow extends DprBoqLike {
  /** Projected for the period, pro-rated from whatever projections cover it. */
  plannedQty: number;
  actualQty: number;
  /** actual − planned. Negative is a shortfall. */
  varianceQty: number;
  /** actual ÷ planned, as a percentage. null when nothing was projected. */
  achievementPct: number | null;
  /** Everything booked up to and including the period end. */
  cumulativeQty: number;
  /** cumulative ÷ BOQ quantity, as a percentage. null when the BOQ carries no quantity. */
  progressPct: number | null;
  balanceQty: number;
  workedDays: number;
  lastWorkedDate: string;
}

export interface DprPeriodReport {
  range: DprDateRange;
  scope?: DprScope;
  rows: DprPeriodRow[];
  totals: {
    plannedQty: number;
    actualQty: number;
    varianceQty: number;
    achievementPct: number | null;
    linesProjected: number;
    linesWorked: number;
    linesBehind: number;
  };
}

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

/**
 * Projected vs actual per BOQ line for one period, with progress against the BOQ quantity.
 *
 * Lines are kept when they were projected, worked, or already carry progress — a BOQ of hundreds
 * of lines would otherwise bury the handful that the period is actually about.
 */
export function buildDprPeriodReport(input: {
  boqItems: readonly DprBoqLike[];
  entries: readonly DprEntry[];
  targets: readonly DprTarget[];
  range: DprDateRange;
  scope?: DprScope;
  includeDrafts?: boolean;
  /** The planning engine. Without it, projections are spread evenly and overlaps add up. */
  plan?: DprPlanReader;
}): DprPeriodReport {
  const { boqItems, entries, targets, range, scope, includeDrafts, plan } = input;
  const planned = plan
    ? plan.byItemInRange(range, scope ? { scope } : {})
    : plannedQtyByBoqItem(targets, range, scope ? { scope } : {});
  const period = aggregateActualsByBoqItem(entries, { scope, range, includeDrafts });
  // Cumulative is open-ended at the start: everything up to the period end counts as progress.
  const cumulative = aggregateActualsByBoqItem(entries, {
    scope,
    range: { startDate: "", endDate: range.endDate },
    includeDrafts,
  });

  const rows: DprPeriodRow[] = [];
  for (const item of boqItems) {
    const plannedQty = planned.get(item.id) ?? 0;
    const actual = period.get(item.id);
    const actualQty = actual?.actualQty ?? 0;
    const cumulativeQty = cumulative.get(item.id)?.actualQty ?? 0;
    if (plannedQty === 0 && actualQty === 0 && cumulativeQty === 0) continue;
    rows.push({
      ...item,
      plannedQty,
      actualQty,
      varianceQty: actualQty - plannedQty,
      achievementPct: pct(actualQty, plannedQty),
      cumulativeQty,
      progressPct: pct(cumulativeQty, item.boqQty),
      balanceQty: Math.max(item.boqQty - cumulativeQty, 0),
      workedDays: actual?.workedDays ?? 0,
      lastWorkedDate: actual?.lastWorkedDate ?? "",
    });
  }
  rows.sort((a, b) => {
    // Worst shortfall against a real projection first — that is the list worth reading.
    const aBehind = a.plannedQty > 0 ? a.varianceQty : Number.POSITIVE_INFINITY;
    const bBehind = b.plannedQty > 0 ? b.varianceQty : Number.POSITIVE_INFINITY;
    if (aBehind !== bBehind) return aBehind - bBehind;
    return a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true });
  });

  const plannedTotal = rows.reduce((sum, row) => sum + row.plannedQty, 0);
  const actualTotal = rows.reduce((sum, row) => sum + row.actualQty, 0);
  return {
    range,
    scope,
    rows,
    totals: {
      plannedQty: plannedTotal,
      actualQty: actualTotal,
      varianceQty: actualTotal - plannedTotal,
      // Quantities across different units cannot be added into one meaningful total, so this is
      // reported only as an achievement ratio and the caller shows it as such.
      achievementPct: pct(actualTotal, plannedTotal),
      linesProjected: rows.filter((row) => row.plannedQty > 0).length,
      linesWorked: rows.filter((row) => row.actualQty > 0).length,
      linesBehind: rows.filter((row) => row.plannedQty > 0 && row.varianceQty < 0).length,
    },
  };
}

/* ── Trend / S-curve ────────────────────────────────────────────────────────────────────────── */

export interface DprTrendPoint {
  bucketStart: string;
  label: string;
  plannedQty: number;
  actualQty: number;
  cumulativePlannedQty: number;
  cumulativeActualQty: number;
}

/**
 * Projected and actual per bucket across a range, with running totals for an S-curve.
 *
 * `periodType` is the granularity to read at and is independent of the granularity the projections
 * were set at — that is the dynamic part the register is built around.
 */
export function buildDprTrend(input: {
  entries: readonly DprEntry[];
  targets: readonly DprTarget[];
  periodType: DprPeriodType;
  range: DprDateRange;
  scope?: DprScope;
  boqItemId?: string;
  includeDrafts?: boolean;
  plan?: DprPlanReader;
}): DprTrendPoint[] {
  const { entries, targets, periodType, range, scope, boqItemId, includeDrafts, plan } = input;
  const buckets = bucketsInRange(periodType, range.startDate, range.endDate);
  const scoped = filterDprEntries(entries, { scope, range, includeDrafts });

  let cumulativePlanned = 0;
  let cumulativeActual = 0;
  return buckets.map((bucketStart) => {
    // Clip each bucket to the range so a part-week at either end is not over-counted.
    const full = periodRangeFor(periodType, bucketStart);
    const bucket: DprDateRange = {
      startDate: full.startDate < range.startDate ? range.startDate : full.startDate,
      endDate: full.endDate > range.endDate ? range.endDate : full.endDate,
    };
    const filter: DprTargetFilter = {
      ...(scope ? { scope } : {}),
      ...(boqItemId ? { boqItemId } : {}),
    };
    const plannedMap = plan
      ? plan.byItemInRange(bucket, filter)
      : plannedQtyByBoqItem(targets, bucket, filter);
    let plannedQty = 0;
    for (const qty of plannedMap.values()) plannedQty += qty;

    let actualQty = 0;
    for (const entry of scoped) {
      if (!isDateInRange(entry.date, bucket)) continue;
      for (const line of entry.lines ?? []) {
        if (boqItemId && line.boqItemId !== boqItemId) continue;
        actualQty += dprNumber(line.actualQty);
      }
    }

    cumulativePlanned += plannedQty;
    cumulativeActual += actualQty;
    return {
      bucketStart,
      label: formatPeriodLabel(periodType, bucketStart),
      plannedQty,
      actualQty,
      cumulativePlannedQty: cumulativePlanned,
      cumulativeActualQty: cumulativeActual,
    };
  });
}

/* ── Site diary roll-ups ────────────────────────────────────────────────────────────────────── */

export interface DprManpowerSummaryRow {
  trade: string;
  /** Person-days: headcount summed over the days worked. */
  manDays: number;
  daysPresent: number;
  peakCount: number;
}

export function buildDprManpowerSummary(
  entries: readonly DprEntry[],
  filter: DprEntryFilter = {},
): DprManpowerSummaryRow[] {
  const byTrade = new Map<string, DprManpowerSummaryRow>();
  for (const entry of filterDprEntries(entries, filter)) {
    for (const line of entry.manpower ?? []) {
      const trade = String(line?.trade ?? "").trim();
      if (!trade) continue;
      const count = dprNumber(line.count);
      const row = byTrade.get(trade) ?? { trade, manDays: 0, daysPresent: 0, peakCount: 0 };
      row.manDays += count;
      if (count > 0) row.daysPresent += 1;
      if (count > row.peakCount) row.peakCount = count;
      byTrade.set(trade, row);
    }
  }
  return [...byTrade.values()].sort((a, b) => b.manDays - a.manDays);
}

export interface DprEquipmentSummaryRow {
  name: string;
  deployedDays: number;
  runningHours: number;
  idleHours: number;
  /** running ÷ (running + idle), as a percentage. null when no hours were logged. */
  utilisationPct: number | null;
}

export function buildDprEquipmentSummary(
  entries: readonly DprEntry[],
  filter: DprEntryFilter = {},
): DprEquipmentSummaryRow[] {
  const byName = new Map<string, DprEquipmentSummaryRow>();
  for (const entry of filterDprEntries(entries, filter)) {
    for (const line of entry.equipment ?? []) {
      const name = String(line?.name ?? "").trim();
      if (!name) continue;
      const row = byName.get(name) ?? {
        name,
        deployedDays: 0,
        runningHours: 0,
        idleHours: 0,
        utilisationPct: null,
      };
      row.deployedDays += dprNumber(line.deployed) > 0 ? 1 : 0;
      row.runningHours += dprNumber(line.runningHours);
      row.idleHours += dprNumber(line.idleHours);
      byName.set(name, row);
    }
  }
  return [...byName.values()]
    .map((row) => ({ ...row, utilisationPct: pct(row.runningHours, row.runningHours + row.idleHours) }))
    .sort((a, b) => b.runningHours - a.runningHours);
}

export interface DprLostTimeRow {
  date: string;
  scope: DprScope;
  hours: number;
  reason: string;
  weather: string;
}

export function buildDprLostTime(
  entries: readonly DprEntry[],
  filter: DprEntryFilter = {},
): DprLostTimeRow[] {
  return filterDprEntries(entries, filter)
    .filter((entry) => dprNumber(entry.lostTimeHours) > 0)
    .map((entry) => ({
      date: entry.date,
      scope: entry.scope,
      hours: dprNumber(entry.lostTimeHours),
      reason: String(entry.lostTimeReason ?? "").trim(),
      weather: String(entry.weather ?? "").trim(),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface DprHindranceRow {
  date: string;
  scope: DprScope;
  hindrances: string;
}

export function buildDprHindrances(
  entries: readonly DprEntry[],
  filter: DprEntryFilter = {},
): DprHindranceRow[] {
  return filterDprEntries(entries, filter)
    .filter((entry) => String(entry.hindrances ?? "").trim().length > 0)
    .map((entry) => ({
      date: entry.date,
      scope: entry.scope,
      hindrances: String(entry.hindrances).trim(),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/* ── Headline ───────────────────────────────────────────────────────────────────────────────── */

export interface DprHeadline {
  plannedQty: number;
  actualQty: number;
  achievementPct: number | null;
  linesWorked: number;
  linesBehind: number;
  manDays: number;
  lostTimeHours: number;
  openHindrances: number;
  daysReported: number;
  daysInPeriod: number;
}

export function buildDprHeadline(input: {
  boqItems: readonly DprBoqLike[];
  entries: readonly DprEntry[];
  targets: readonly DprTarget[];
  range: DprDateRange;
  scope?: DprScope;
  includeDrafts?: boolean;
  plan?: DprPlanReader;
}): DprHeadline {
  const report = buildDprPeriodReport(input);
  const scoped = filterDprEntries(input.entries, {
    scope: input.scope,
    range: input.range,
    includeDrafts: input.includeDrafts,
  });
  const manDays = buildDprManpowerSummary(input.entries, {
    scope: input.scope,
    range: input.range,
    includeDrafts: input.includeDrafts,
  }).reduce((sum, row) => sum + row.manDays, 0);
  return {
    plannedQty: report.totals.plannedQty,
    actualQty: report.totals.actualQty,
    achievementPct: report.totals.achievementPct,
    linesWorked: report.totals.linesWorked,
    linesBehind: report.totals.linesBehind,
    manDays,
    lostTimeHours: scoped.reduce((sum, entry) => sum + dprNumber(entry.lostTimeHours), 0),
    openHindrances: scoped.filter((entry) => String(entry.hindrances ?? "").trim()).length,
    // Distinct dates, because Civil and Erection each file their own entry for the same day.
    daysReported: new Set(scoped.map((entry) => entry.date)).size,
    daysInPeriod: daysInRange(input.range.startDate, input.range.endDate),
  };
}

/* ── Validation ─────────────────────────────────────────────────────────────────────────────── */

export interface DprValidationError {
  field: string;
  message: string;
}

export function validateDprEntry(draft: DprEntryDraft): DprValidationError[] {
  const errors: DprValidationError[] = [];
  if (!parseIsoDate(draft.date)) {
    errors.push({ field: "date", message: "Pick the date this progress was recorded on." });
  }
  if (!DPR_SCOPES.includes(draft.scope)) {
    errors.push({ field: "scope", message: "Choose Civil or Erection." });
  }
  const lines = draft.lines ?? [];
  if (lines.length === 0) {
    errors.push({ field: "lines", message: "Add at least one BOQ line." });
  }
  if (lines.some((line) => !line.boqItemId)) {
    errors.push({ field: "lines", message: "Every line needs a BOQ item selected." });
  }
  if (lines.some((line) => dprNumber(line.actualQty) < 0 || dprNumber(line.plannedQty) < 0)) {
    errors.push({ field: "lines", message: "Quantities cannot be negative." });
  }
  // The same BOQ item may appear on two rows only when each row names a different location — two
  // gangs on one item at two places is a real day. Same item, same (or no) location is a double.
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.boqItemId) continue;
    const key = `${line.boqItemId}|${String(line.location ?? "").trim().toLowerCase()}`;
    if (seen.has(key)) {
      errors.push({
        field: "lines",
        message:
          "A BOQ item appears twice for the same location — merge the rows, or give each its own location.",
      });
      break;
    }
    seen.add(key);
  }
  if (dprNumber(draft.lostTimeHours) < 0 || dprNumber(draft.lostTimeHours) > 24) {
    errors.push({ field: "lostTimeHours", message: "Lost time must be between 0 and 24 hours." });
  }
  if (dprNumber(draft.lostTimeHours) > 0 && !String(draft.lostTimeReason ?? "").trim()) {
    errors.push({ field: "lostTimeReason", message: "Give the reason for the lost time." });
  }
  return errors;
}

export function validateDprTarget(draft: DprTargetDraft): DprValidationError[] {
  const errors: DprValidationError[] = [];
  if (!draft.boqItemId) {
    errors.push({ field: "boqItemId", message: "Choose the BOQ item being projected." });
  }
  if (!DPR_SCOPES.includes(draft.scope)) {
    errors.push({ field: "scope", message: "Choose Civil or Erection." });
  }
  if (!DPR_PROJECTION_PERIODS.includes(draft.periodType)) {
    errors.push({ field: "periodType", message: "Choose a day, week, month or custom range." });
  }
  if (draft.distribution !== undefined && !DPR_DISTRIBUTIONS.includes(draft.distribution)) {
    errors.push({ field: "distribution", message: "Choose how the quantity is spread." });
  }
  if (!parseIsoDate(draft.startDate) || !parseIsoDate(draft.endDate)) {
    errors.push({ field: "startDate", message: "The projection needs a valid period." });
  } else if (daysInRange(draft.startDate, draft.endDate) === 0) {
    errors.push({ field: "endDate", message: "The period must end on or after it starts." });
  }
  if (dprNumber(draft.plannedQty) <= 0) {
    errors.push({ field: "plannedQty", message: "Projected quantity must be more than zero." });
  }
  return errors;
}

/**
 * Projections for the same BOQ item whose periods overlap the draft's.
 *
 * Overlapping projections are not rejected — a month's plan plus a catch-up week on top of it is
 * a real thing to want — but they are additive, so the screen says so before the figure doubles.
 */
export function overlappingTargets(
  draft: DprTargetDraft,
  targets: readonly DprTarget[],
  ignoreId?: string,
): DprTarget[] {
  return targets.filter(
    (target) =>
      target.id !== ignoreId &&
      target.boqItemId === draft.boqItemId &&
      target.scope === draft.scope &&
      overlapDays(target, { startDate: draft.startDate, endDate: draft.endDate }) > 0,
  );
}

/* ── Export ─────────────────────────────────────────────────────────────────────────────────── */

/** Excel reads a leading =, +, - or @ as a formula, so those cells are prefixed with a quote. */
const csvCell = (value: unknown): string => {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const dprToCsv = (headers: string[], rows: Array<Array<unknown>>): string =>
  [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");

const round2 = (value: number) => Math.round(value * 100) / 100;

export function dprPeriodReportCsv(report: DprPeriodReport): string {
  return dprToCsv(
    [
      "ERP SL No",
      "BOQ SL No",
      "Description",
      "Unit",
      "BOQ Qty",
      "Projected Qty",
      "Actual Qty",
      "Variance Qty",
      "Achievement %",
      "Cumulative Qty",
      "Progress %",
      "Balance Qty",
      "Days Worked",
      "Last Worked",
    ],
    report.rows.map((row) => [
      row.erpSlNo ?? "",
      row.boqSlNo,
      row.description,
      row.unit,
      round2(row.boqQty),
      round2(row.plannedQty),
      round2(row.actualQty),
      round2(row.varianceQty),
      row.achievementPct === null ? "" : round2(row.achievementPct),
      round2(row.cumulativeQty),
      row.progressPct === null ? "" : round2(row.progressPct),
      round2(row.balanceQty),
      row.workedDays,
      row.lastWorkedDate,
    ]),
  );
}
