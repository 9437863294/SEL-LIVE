/**
 * Civil progress — planned against actual against certified, for the Civil hub.
 *
 * One rule runs through all of it: **value is the only common denominator.** A civil BOQ mixes
 * Cum, Sqm, Rmt, MT and lump sums, so summing quantities across lines is meaningless. Every
 * headline figure here is therefore Σ quantity × the BOQ line's own rate, and a percentage is
 * always a share of the civil BOQ's value. Quantities stay per line, where they mean something.
 *
 * Three series, from three different registers, answering three different questions:
 *   - **planned**   — DPR projections: what was undertaken.
 *   - **actual**    — DPR daily entries: what the site says it built.
 *   - **certified** — JMC entries: what the client has agreed was built, which is the only one
 *                     that can be billed. It trails actual, and the gap between them is work done
 *                     but not yet measured.
 *
 * Pure (no Firebase, no React), so every rule here is unit-testable with `node --test`.
 */

import {
  bucketsInRange,
  dprNumber,
  filterDprEntries,
  formatPeriodLabel,
  isDateInRange,
  periodRangeFor,
  plannedQtyByBoqItem,
  type DprDateRange,
  type DprEntry,
  type DprPeriodType,
  type DprPlanReader,
  type DprTarget,
} from "./project-management-dpr.ts";
import type { DprBreakdown } from "./project-management-dpr-breakdown.ts";
import {
  civilBoqKey,
  readBoqSlNo,
  readErpSlNo,
  readLooseScope,
  type MeasurementEntryLike,
  type SubcontractorBillLike,
  type WorkOrderLike,
} from "./civil-execution.ts";

/**
 * Civil quantity planned per BOQ item over a range. With the DPR planning engine (working calendar,
 * spread, shorter period owning overlapped days) the figure matches Daily Progress exactly; without
 * it, projections are spread evenly over calendar days and overlaps add up.
 */
/**
 * A Daily Progress work-breakdown sub-item, as the part of its BOQ line it stands for: a quantity
 * booked on the sub-item × `factor` is the equivalent quantity of the BOQ line (its share of the
 * line ÷ its own quantity × the line's quantity). So sub-item progress lands on its line here, in
 * the line's unit, and is priced at the line's rate.
 */
export interface CivilSubItemLink {
  boqItemId: string;
  factor: number;
}
export type CivilSubItemLinks = ReadonlyMap<string, CivilSubItemLink>;

/** The link for every leaf sub-item in a work breakdown. */
export function civilSubItemLinks(breakdown: DprBreakdown): Map<string, CivilSubItemLink> {
  const links = new Map<string, CivilSubItemLink>();
  for (const leaf of breakdown.leaves) {
    if (leaf.kind !== "sub") continue;
    const lineQty = breakdown.nodes.get(leaf.boqItemId)?.qty ?? 0;
    links.set(leaf.id, {
      boqItemId: leaf.boqItemId,
      factor: leaf.qty > 0 ? (leaf.shareOfLine * lineQty) / leaf.qty : 0,
    });
  }
  return links;
}

/** A quantity booked against `id`, carried onto its BOQ line when `id` is a sub-item. */
const toLineQty = (id: string, qty: number, links?: CivilSubItemLinks): [string, number] => {
  const link = links?.get(id);
  return link ? [link.boqItemId, qty * link.factor] : [id, qty];
};

const civilPlanned = (
  targets: readonly DprTarget[],
  range: DprDateRange,
  plan: DprPlanReader | undefined,
  links?: CivilSubItemLinks,
): Map<string, number> => {
  const planned = plan
    ? plan.byItemInRange(range, { scope: "Civil" })
    : plannedQtyByBoqItem(targets, range, { scope: "Civil" });
  if (!links || links.size === 0) return planned;
  const onLines = new Map<string, number>();
  for (const [id, qty] of planned) {
    const [lineId, lineQty] = toLineQty(id, qty, links);
    onLines.set(lineId, (onLines.get(lineId) ?? 0) + lineQty);
  }
  return onLines;
};

/** A civil BOQ line, priced, with the composite key JMC measurement items join on. */
export interface CivilBoqLine {
  id: string;
  boqSlNo: string;
  erpSlNo: string;
  description: string;
  unit: string;
  boqQty: number;
  rate: number;
  /** boqQty × rate — what finishing this line is worth. */
  value: number;
  /** `civilBoqKey(scope1, scope2, boqSlNo)` — JMC items carry no boqItemId. */
  civilKey: string;
}

type UnknownRecord = Record<string, unknown>;

const readText = (item: UnknownRecord, keys: string[]): string => {
  for (const key of keys) {
    const value = item[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
};

const readRate = (item: UnknownRecord): number =>
  dprNumber(item["Budget Price"] ?? item["Unit Rate"] ?? item.Rate ?? item.rate);

/** The project's civil BOQ lines, priced. Section headers (no unit, no quantity) are left out. */
export function buildCivilBoqLines(boqItems: readonly UnknownRecord[]): CivilBoqLine[] {
  const lines: CivilBoqLine[] = [];
  for (const item of boqItems) {
    if (String(item["Scope 2"] ?? "").trim().toLowerCase() !== "civil") continue;
    const boqQty = dprNumber(item.QTY ?? item.Quantity ?? item.quantity);
    const unit = readText(item, ["Unit", "UNIT", "Units"]);
    // A caption row carries neither a unit nor a quantity; it is not work.
    if (!unit && boqQty === 0) continue;
    const rate = readRate(item);
    const storedTotal = dprNumber(item["Total Amount"] ?? item.totalAmount);
    const boqSlNo = readBoqSlNo(item);
    lines.push({
      id: String(item.id ?? ""),
      boqSlNo,
      erpSlNo: readErpSlNo(item),
      description: readText(item, ["Description", "DESCRIPTION OF ITEMS"]),
      unit,
      boqQty,
      rate,
      value: storedTotal > 0 ? storedTotal : boqQty * rate,
      civilKey: civilBoqKey(readLooseScope(item, 1), readLooseScope(item, 2), boqSlNo),
    });
  }
  return lines;
}

export const civilBoqValue = (lines: readonly CivilBoqLine[]): number =>
  lines.reduce((sum, line) => sum + line.value, 0);

const rateByBoqItemId = (lines: readonly CivilBoqLine[]): Map<string, number> =>
  new Map(lines.map((line) => [line.id, line.rate]));

/* ── JMC, by date ───────────────────────────────────────────────────────────────────────────── */

const VOID_MEASUREMENT_STATUSES = new Set(["Rejected", "Cancelled"]);

/** Statuses that mean a measurement entry is still being certified rather than agreed. */
const OPEN_MEASUREMENT_STATUSES = new Set([
  "Draft",
  "Submitted",
  "In Review",
  "Pending",
  "Partially Approved",
]);

export interface CivilCertifiedEvent {
  /** yyyy-mm-dd. */
  date: string;
  value: number;
}

const measurementDate = (entry: MeasurementEntryLike): string => {
  const raw = entry.jmcDate ?? entry.mvacDate;
  if (typeof raw !== "string") return "";
  return raw.trim().match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
};

/** Certified value per JMC entry, with its date — the raw material for the certified curve. */
export function buildCivilCertifiedEvents(
  jmcEntries: readonly MeasurementEntryLike[],
): CivilCertifiedEvent[] {
  const events: CivilCertifiedEvent[] = [];
  for (const entry of jmcEntries) {
    if (VOID_MEASUREMENT_STATUSES.has(String(entry.status ?? ""))) continue;
    const date = measurementDate(entry);
    if (!date) continue;
    const items = Array.isArray(entry.items) ? (entry.items as UnknownRecord[]) : [];
    let value = 0;
    for (const item of items) {
      value += dprNumber(item.rate) * dprNumber(item.certifiedQty);
    }
    if (value !== 0) events.push({ date, value });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/* ── The S-curve ────────────────────────────────────────────────────────────────────────────── */

export interface CivilProgressPoint {
  bucketStart: string;
  label: string;
  /** Cumulative value to the end of this bucket. */
  plannedValue: number;
  actualValue: number;
  certifiedValue: number;
  /** The same, as a share of the civil BOQ value. null when the BOQ carries no value. */
  plannedPct: number | null;
  actualPct: number | null;
  certifiedPct: number | null;
}

const share = (value: number, total: number): number | null =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : null;

/** Σ of a DPR entry's lines, priced at each line's BOQ rate (a sub-item at its line's). */
const entryValue = (
  entry: DprEntry,
  rates: Map<string, number>,
  pick: (line: DprEntry["lines"][number]) => number,
  links?: CivilSubItemLinks,
): number => {
  let total = 0;
  for (const line of entry.lines ?? []) {
    const [lineId, lineQty] = toLineQty(line.boqItemId, pick(line), links);
    total += lineQty * (rates.get(lineId) ?? 0);
  }
  return total;
};

/**
 * Cumulative planned, actual and certified value across the range, bucketed.
 *
 * Each point is cumulative *from the beginning of the project*, not from the start of the range —
 * an S-curve that restarts at zero whenever you narrow the window is not an S-curve.
 */
export function buildCivilProgressCurve(input: {
  lines: readonly CivilBoqLine[];
  entries: readonly DprEntry[];
  targets: readonly DprTarget[];
  certifiedEvents: readonly CivilCertifiedEvent[];
  periodType: DprPeriodType;
  range: DprDateRange;
  includeDrafts?: boolean;
  /** The DPR planning engine, so planned value agrees with Daily Progress. */
  plan?: DprPlanReader;
  /** Work-breakdown sub-items, so their progress counts on their BOQ lines. */
  subItemLinks?: CivilSubItemLinks;
}): CivilProgressPoint[] {
  const { lines, entries, targets, certifiedEvents, periodType, range, includeDrafts, plan, subItemLinks } =
    input;
  const total = civilBoqValue(lines);
  const rates = rateByBoqItemId(lines);
  const buckets = bucketsInRange(periodType, range.startDate, range.endDate);
  const civilEntries = filterDprEntries(entries, { scope: "Civil", includeDrafts });

  return buckets.map((bucketStart) => {
    const bucket = periodRangeFor(periodType, bucketStart);
    // Everything up to the end of this bucket, clipped to the range's end.
    const upTo = bucket.endDate > range.endDate ? range.endDate : bucket.endDate;
    const toDate: DprDateRange = { startDate: "", endDate: upTo };

    let actualValue = 0;
    for (const entry of civilEntries) {
      if (!isDateInRange(entry.date, toDate)) continue;
      actualValue += entryValue(entry, rates, (line) => dprNumber(line.actualQty), subItemLinks);
    }

    // Projections are pro-rated by day, so a month's plan contributes only its elapsed share.
    let plannedValue = 0;
    const plannedQty = civilPlanned(targets, { startDate: "", endDate: upTo }, plan, subItemLinks);
    for (const [boqItemId, qty] of plannedQty) {
      plannedValue += qty * (rates.get(boqItemId) ?? 0);
    }

    let certifiedValue = 0;
    for (const event of certifiedEvents) {
      if (isDateInRange(event.date, toDate)) certifiedValue += event.value;
    }

    return {
      bucketStart,
      label: formatPeriodLabel(periodType, bucketStart),
      plannedValue,
      actualValue,
      certifiedValue,
      plannedPct: share(plannedValue, total),
      actualPct: share(actualValue, total),
      certifiedPct: share(certifiedValue, total),
    };
  });
}

/* ── Headline ───────────────────────────────────────────────────────────────────────────────── */

export type CivilStatusTone = "ok" | "warn" | "bad" | "idle";

export interface CivilHeadline {
  boqValue: number;
  boqLineCount: number;
  /** Σ actual qty × rate, to today. */
  actualValue: number;
  actualPct: number | null;
  /** What the projections say should have been done by today. */
  plannedToDateValue: number;
  plannedToDatePct: number | null;
  /** actualPct − plannedToDatePct, in percentage points. null when either is unknown. */
  gapPoints: number | null;
  certifiedValue: number;
  certifiedPct: number | null;
  certifiedEntryCount: number;
  /** Measurement entries still in certification — work done but not yet agreed. */
  openMeasurementCount: number;
  tone: CivilStatusTone;
}

export function buildCivilHeadline(input: {
  lines: readonly CivilBoqLine[];
  entries: readonly DprEntry[];
  targets: readonly DprTarget[];
  jmcEntries: readonly MeasurementEntryLike[];
  today: string;
  includeDrafts?: boolean;
  plan?: DprPlanReader;
  subItemLinks?: CivilSubItemLinks;
}): CivilHeadline {
  const { lines, entries, targets, jmcEntries, today, includeDrafts, plan, subItemLinks } = input;
  const boqValue = civilBoqValue(lines);
  const rates = rateByBoqItemId(lines);
  const toToday: DprDateRange = { startDate: "", endDate: today };

  let actualValue = 0;
  for (const entry of filterDprEntries(entries, { scope: "Civil", includeDrafts })) {
    if (!isDateInRange(entry.date, toToday)) continue;
    actualValue += entryValue(entry, rates, (line) => dprNumber(line.actualQty), subItemLinks);
  }

  let plannedToDateValue = 0;
  for (const [boqItemId, qty] of civilPlanned(targets, toToday, plan, subItemLinks)) {
    plannedToDateValue += qty * (rates.get(boqItemId) ?? 0);
  }

  const live = jmcEntries.filter(
    (entry) => !VOID_MEASUREMENT_STATUSES.has(String(entry.status ?? "")),
  );
  const certifiedEvents = buildCivilCertifiedEvents(live);
  const certifiedValue = certifiedEvents.reduce((sum, event) => sum + event.value, 0);

  const actualPct = share(actualValue, boqValue);
  const plannedToDatePct = share(plannedToDateValue, boqValue);
  const gapPoints =
    actualPct === null || plannedToDatePct === null
      ? null
      : Math.round((actualPct - plannedToDatePct) * 10) / 10;

  return {
    boqValue,
    boqLineCount: lines.length,
    actualValue,
    actualPct,
    plannedToDateValue,
    plannedToDatePct,
    gapPoints,
    certifiedValue,
    certifiedPct: share(certifiedValue, boqValue),
    certifiedEntryCount: live.length,
    openMeasurementCount: live.filter((entry) =>
      OPEN_MEASUREMENT_STATUSES.has(String(entry.status ?? "")),
    ).length,
    tone:
      gapPoints === null
        ? "idle"
        : gapPoints < -8
          ? "bad"
          : gapPoints < 0
            ? "warn"
            : "ok",
  };
}

/* ── Work items ─────────────────────────────────────────────────────────────────────────────── */

export interface CivilWorkItem {
  id: string;
  boqSlNo: string;
  description: string;
  unit: string;
  boqQty: number;
  /** Quantity booked through the DPR. */
  doneQty: number;
  /** doneQty ÷ boqQty, as a percentage. null when the line carries no quantity. */
  progressPct: number | null;
  /** Where the projections say this line should be by today, as a percentage. */
  planPct: number | null;
  /** progressPct − planPct, in percentage points. */
  gapPoints: number | null;
  /** The subcontractor holding the live work order for this line, where there is one. */
  subcontractorName: string;
  certifiedQty: number;
  tone: CivilStatusTone;
  statusLabel: string;
}

const CANCELLED_WORK_ORDER_STATUSES = new Set(["Cancelled"]);

/** Which subcontractor holds each BOQ line, from the project's live work orders. */
export function subcontractorByBoqItem(
  workOrders: readonly WorkOrderLike[],
): Map<string, string> {
  const holders = new Map<string, string>();
  for (const workOrder of workOrders) {
    if (CANCELLED_WORK_ORDER_STATUSES.has(String(workOrder.status ?? ""))) continue;
    const name = String(workOrder.subcontractorName ?? "").trim();
    if (!name) continue;
    const items = Array.isArray(workOrder.items) ? (workOrder.items as UnknownRecord[]) : [];
    for (const item of items) {
      const boqItemId = String(item.boqItemId ?? "");
      if (boqItemId && !holders.has(boqItemId)) holders.set(boqItemId, name);
    }
  }
  return holders;
}

/**
 * Per-line progress against the plan.
 *
 * Only lines that are planned, worked, or certified are returned — a civil BOQ of hundreds of
 * lines would otherwise bury the dozen the project is actually on.
 */
export function buildCivilWorkItems(input: {
  lines: readonly CivilBoqLine[];
  entries: readonly DprEntry[];
  targets: readonly DprTarget[];
  jmcEntries: readonly MeasurementEntryLike[];
  workOrders: readonly WorkOrderLike[];
  today: string;
  includeDrafts?: boolean;
  plan?: DprPlanReader;
  subItemLinks?: CivilSubItemLinks;
}): CivilWorkItem[] {
  const { lines, entries, targets, jmcEntries, workOrders, today, includeDrafts, plan, subItemLinks } =
    input;
  const toToday: DprDateRange = { startDate: "", endDate: today };

  const doneByItem = new Map<string, number>();
  for (const entry of filterDprEntries(entries, { scope: "Civil", includeDrafts })) {
    if (!isDateInRange(entry.date, toToday)) continue;
    for (const line of entry.lines ?? []) {
      // A sub-item's quantity lands on its BOQ line, in the line's unit.
      const [lineId, lineQty] = toLineQty(line.boqItemId, dprNumber(line.actualQty), subItemLinks);
      doneByItem.set(lineId, (doneByItem.get(lineId) ?? 0) + lineQty);
    }
  }

  const plannedByItem = civilPlanned(targets, toToday, plan, subItemLinks);

  // JMC items join on the composite key, not on a boqItemId.
  const certifiedByKey = new Map<string, number>();
  for (const entry of jmcEntries) {
    if (VOID_MEASUREMENT_STATUSES.has(String(entry.status ?? ""))) continue;
    const items = Array.isArray(entry.items) ? (entry.items as UnknownRecord[]) : [];
    for (const item of items) {
      const key = civilBoqKey(readLooseScope(item, 1), readLooseScope(item, 2), readBoqSlNo(item));
      certifiedByKey.set(key, (certifiedByKey.get(key) ?? 0) + dprNumber(item.certifiedQty));
    }
  }

  const holders = subcontractorByBoqItem(workOrders);

  const items: CivilWorkItem[] = [];
  for (const line of lines) {
    const doneQty = doneByItem.get(line.id) ?? 0;
    const plannedQty = plannedByItem.get(line.id) ?? 0;
    const certifiedQty = certifiedByKey.get(line.civilKey) ?? 0;
    if (doneQty === 0 && plannedQty === 0 && certifiedQty === 0) continue;

    const progressPct = line.boqQty > 0 ? Math.round((doneQty / line.boqQty) * 1000) / 10 : null;
    const planPct = line.boqQty > 0 ? Math.round((plannedQty / line.boqQty) * 1000) / 10 : null;
    const gapPoints =
      progressPct === null || planPct === null
        ? null
        : Math.round((progressPct - planPct) * 10) / 10;

    let tone: CivilStatusTone = "ok";
    let statusLabel = "On track";
    if (doneQty === 0 && plannedQty > 0) {
      tone = "bad";
      statusLabel = "Not started";
    } else if (gapPoints === null) {
      tone = "idle";
      statusLabel = "No plan";
    } else if (gapPoints < -8) {
      tone = "bad";
      statusLabel = "Behind";
    } else if (gapPoints < 0) {
      tone = "warn";
      statusLabel = "Slightly behind";
    }

    items.push({
      id: line.id,
      boqSlNo: line.boqSlNo,
      description: line.description,
      unit: line.unit,
      boqQty: line.boqQty,
      doneQty,
      progressPct,
      planPct,
      gapPoints,
      subcontractorName: holders.get(line.id) ?? "",
      certifiedQty,
      tone,
      statusLabel,
    });
  }

  // Worst shortfall first; that is the list worth reading.
  return items.sort((a, b) => {
    const aGap = a.gapPoints ?? Number.POSITIVE_INFINITY;
    const bGap = b.gapPoints ?? Number.POSITIVE_INFINITY;
    if (aGap !== bGap) return aGap - bGap;
    return a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true });
  });
}

/* ── Today on site ──────────────────────────────────────────────────────────────────────────── */

export interface CivilTodaySnapshot {
  /** The date the snapshot is from — the latest DPR on or before today, which may not be today. */
  date: string;
  isToday: boolean;
  manpower: number;
  equipmentCount: number;
  weather: string;
  lostTimeHours: number;
  /** The day's biggest booked line, in its own unit — quantities are not summed across units. */
  headlineQty: number;
  headlineUnit: string;
  headlineDescription: string;
}

/** The most recent civil DPR at or before `today`, summarised. null when nothing has been filed. */
export function buildCivilToday(
  entries: readonly DprEntry[],
  today: string,
  includeDrafts = true,
): CivilTodaySnapshot | null {
  const candidates = filterDprEntries(entries, {
    scope: "Civil",
    range: { startDate: "", endDate: today },
    includeDrafts,
  }).sort((a, b) => b.date.localeCompare(a.date));
  const entry = candidates[0];
  if (!entry) return null;

  let headline = { qty: 0, unit: "", description: "" };
  for (const line of entry.lines ?? []) {
    const qty = dprNumber(line.actualQty);
    if (qty > headline.qty) {
      headline = { qty, unit: line.unit ?? "", description: line.description ?? "" };
    }
  }

  return {
    date: entry.date,
    isToday: entry.date === today,
    manpower: (entry.manpower ?? []).reduce((sum, line) => sum + dprNumber(line.count), 0),
    equipmentCount: (entry.equipment ?? []).filter((line) => dprNumber(line.deployed) > 0).length,
    weather: String(entry.weather ?? "").trim(),
    lostTimeHours: dprNumber(entry.lostTimeHours),
    headlineQty: headline.qty,
    headlineUnit: headline.unit,
    headlineDescription: headline.description,
  };
}

/* ── Subcontractors ─────────────────────────────────────────────────────────────────────────── */

export interface CivilSubcontractorSummary {
  name: string;
  workOrderCount: number;
  orderedValue: number;
  billedValue: number;
  /** billed ÷ ordered, as a percentage. null when nothing is ordered. */
  billedPct: number | null;
}

/** Work order commitment and billing per subcontractor. Retention bills are not work billed. */
export function buildCivilSubcontractors(
  workOrders: readonly WorkOrderLike[],
  bills: readonly SubcontractorBillLike[],
): CivilSubcontractorSummary[] {
  const byName = new Map<string, CivilSubcontractorSummary>();
  const ensure = (name: string) => {
    const existing = byName.get(name);
    if (existing) return existing;
    const created: CivilSubcontractorSummary = {
      name,
      workOrderCount: 0,
      orderedValue: 0,
      billedValue: 0,
      billedPct: null,
    };
    byName.set(name, created);
    return created;
  };

  for (const workOrder of workOrders) {
    if (CANCELLED_WORK_ORDER_STATUSES.has(String(workOrder.status ?? ""))) continue;
    const name = String(workOrder.subcontractorName ?? "").trim();
    if (!name) continue;
    const row = ensure(name);
    row.workOrderCount += 1;
    const stored = dprNumber((workOrder as UnknownRecord).totalAmount);
    if (stored > 0) {
      row.orderedValue += stored;
    } else {
      const items = Array.isArray(workOrder.items) ? (workOrder.items as UnknownRecord[]) : [];
      for (const item of items) row.orderedValue += dprNumber(item.totalAmount);
    }
  }

  for (const bill of bills) {
    if (VOID_MEASUREMENT_STATUSES.has(String(bill.status ?? ""))) continue;
    if (bill.isRetentionBill) continue;
    const name = String((bill as UnknownRecord).subcontractorName ?? "").trim();
    if (!name) continue;
    ensure(name).billedValue += dprNumber(bill.totalAmount);
  }

  return [...byName.values()]
    .map((row) => ({
      ...row,
      billedPct:
        row.orderedValue > 0 ? Math.round((row.billedValue / row.orderedValue) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.orderedValue - a.orderedValue);
}

/* ── Attention ──────────────────────────────────────────────────────────────────────────────── */

export interface CivilAttentionItem {
  id: string;
  tone: "warn" | "bad";
  title: string;
  detail: string;
  /** A short figure for the chip — a count, a gap, a value. */
  badge: string;
}

/**
 * What is wrong on this scope right now, worst first.
 *
 * Every entry is derived from a register, not from a rule of thumb: a missing DPR, lines behind
 * their own projection, work measured but not certified, and lines with no subcontractor to do
 * them.
 */
export function buildCivilAttention(input: {
  today: CivilTodaySnapshot | null;
  headline: CivilHeadline;
  workItems: readonly CivilWorkItem[];
  todayDate: string;
}): CivilAttentionItem[] {
  const items: CivilAttentionItem[] = [];

  if (!input.today || !input.today.isToday) {
    items.push({
      id: "dpr-missing",
      tone: "warn",
      title: "Today's progress not logged",
      detail: input.today
        ? `Daily Progress · last entry ${input.today.date}`
        : "Daily Progress · nothing recorded yet",
      badge: "Today",
    });
  }

  const notStarted = input.workItems.filter((item) => item.statusLabel === "Not started");
  if (notStarted.length > 0) {
    items.push({
      id: "not-started",
      tone: "bad",
      title: `${notStarted.length} planned line${notStarted.length === 1 ? "" : "s"} not started`,
      detail: notStarted
        .slice(0, 2)
        .map((item) => item.description || item.boqSlNo)
        .join(", "),
      badge: String(notStarted.length),
    });
  }

  const behind = input.workItems.filter((item) => item.statusLabel === "Behind");
  if (behind.length > 0) {
    items.push({
      id: "behind",
      tone: "bad",
      title: `${behind.length} line${behind.length === 1 ? "" : "s"} behind plan`,
      detail: behind
        .slice(0, 2)
        .map((item) => `${item.description || item.boqSlNo} (${item.gapPoints} pts)`)
        .join(", "),
      badge: String(behind.length),
    });
  }

  if (input.headline.openMeasurementCount > 0) {
    items.push({
      id: "jmc-open",
      tone: "warn",
      title: `${input.headline.openMeasurementCount} JMC${input.headline.openMeasurementCount === 1 ? "" : "s"} not yet certified`,
      detail: "Work measured but not agreed with the client — it cannot be billed yet",
      badge: String(input.headline.openMeasurementCount),
    });
  }

  const unassigned = input.workItems.filter(
    (item) => !item.subcontractorName && item.doneQty === 0 && (item.planPct ?? 0) > 0,
  );
  if (unassigned.length > 0) {
    items.push({
      id: "unassigned",
      tone: "warn",
      title: `${unassigned.length} planned line${unassigned.length === 1 ? "" : "s"} with no work order`,
      detail: "Planned, but nobody is contracted to build it",
      badge: String(unassigned.length),
    });
  }

  return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "bad" ? -1 : 1));
}
