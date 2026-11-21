/**
 * Daily Progress — projection records.
 *
 * A projection (`dprTargets`) is stored per BOQ line. The lines planned for one scope over the same
 * dates read as one **record** (the user, 2026-11-21: every projection record should show the items
 * given in it, and the record can be changed — items edited, added and removed). The record is
 * derived, not stored: projections saved before records existed group the same way, and a line
 * planned later for the same scope and dates joins its record.
 *
 * Editing a record keeps every projection rule:
 *  - a quantity change is a revision (rule P7): a reason, the baseline kept, the history appended;
 *  - an added line is a new projection over the record's period, checked like any other (P1–P6);
 *  - a removed line is deleted;
 *  - an ended record is locked.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import {
  DPR_SCOPES,
  dprNumber,
  type DprDateRange,
  type DprDistribution,
  type DprProjectionPeriod,
  type DprScope,
  type DprTarget,
} from "./project-management-dpr.ts";
import {
  checkDprProjection,
  type DprActualIndex,
  type DprCheckResult,
  type DprOverlapPolicy,
} from "./project-management-dpr-plan.ts";
import type { DprSettings } from "./project-management-dpr-plan.ts";

export type DprRecordStatus = "upcoming" | "running" | "ended";

export interface DprProjectionRecord {
  /** `{scope}~{startDate}~{endDate}` — stable, so it can sit in the address. */
  key: string;
  scope: DprScope;
  startDate: string;
  endDate: string;
  /** The period type most of its lines were set at (Day / Week / Month / Custom). */
  periodType: DprProjectionPeriod;
  /** Its lines' spread, or "mixed" when they differ. */
  distribution: DprDistribution | "mixed";
  /** The spread a line added to the record takes: the record's own, or the commonest when mixed. */
  spreadForNew: DprDistribution;
  /** Its projections, in BOQ number order. */
  targets: DprTarget[];
  /** How many of its lines have been revised at least once. */
  revisedCount: number;
  status: DprRecordStatus;
  /** Who set its lines, each name once, in line order. */
  madeBy: string[];
}

export const dprRecordKey = (range: { scope: DprScope; startDate: string; endDate: string }): string =>
  `${range.scope}~${range.startDate}~${range.endDate}`;

export function parseDprRecordKey(
  key: string | null | undefined,
): { scope: DprScope; startDate: string; endDate: string } | null {
  const [scope, startDate, endDate, ...rest] = String(key ?? "").split("~");
  if (rest.length > 0 || !DPR_SCOPES.includes(scope as DprScope)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(endDate ?? "")) return null;
  return { scope: scope as DprScope, startDate, endDate };
}

/** Upcoming before its first day, running through its last, ended (and locked) after. */
export function dprRecordStatus(range: DprDateRange, today: string): DprRecordStatus {
  if (range.endDate < today) return "ended";
  if (range.startDate > today) return "upcoming";
  return "running";
}

const compareSlNo = (a: DprTarget, b: DprTarget): number =>
  String(a.boqSlNo ?? "").localeCompare(String(b.boqSlNo ?? ""), undefined, { numeric: true }) ||
  a.id.localeCompare(b.id);

/** The value most of `values` carry; the first seen wins a tie. */
function commonest<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Every record over `targets`, newest period first; within a start date the shorter period first,
 * then Civil before Erection.
 */
export function buildDprProjectionRecords(
  targets: readonly DprTarget[],
  today: string,
): DprProjectionRecord[] {
  const groups = new Map<string, DprTarget[]>();
  for (const target of targets) {
    if (!target.startDate || !target.endDate) continue;
    const key = dprRecordKey(target);
    const list = groups.get(key);
    if (list) list.push(target);
    else groups.set(key, [target]);
  }

  const records: DprProjectionRecord[] = [];
  for (const [key, list] of groups) {
    const lines = [...list].sort(compareSlNo);
    const first = lines[0];
    const spreads = lines.map((target) => target.distribution ?? "even");
    const distinctSpreads = new Set(spreads);
    const madeBy: string[] = [];
    for (const target of lines) {
      const name = String(target.createdByName ?? "").trim();
      if (name && !madeBy.includes(name)) madeBy.push(name);
    }
    records.push({
      key,
      scope: first.scope,
      startDate: first.startDate,
      endDate: first.endDate,
      periodType: commonest(lines.map((target) => target.periodType)) ?? first.periodType,
      distribution: distinctSpreads.size === 1 ? spreads[0] : "mixed",
      spreadForNew: commonest(spreads) ?? "even",
      targets: lines,
      revisedCount: lines.filter((target) => (target.revisionNo ?? 0) > 0).length,
      status: dprRecordStatus(first, today),
      madeBy,
    });
  }

  const scopeRank = (scope: DprScope) => DPR_SCOPES.indexOf(scope);
  return records.sort(
    (a, b) =>
      b.startDate.localeCompare(a.startDate) ||
      a.endDate.localeCompare(b.endDate) ||
      scopeRank(a.scope) - scopeRank(b.scope),
  );
}

/* ── Editing a record ───────────────────────────────────────────────────────────────────────── */

/** A line already in the record, as the editor holds it. */
export interface DprRecordRowDraft {
  qty: string;
  remarks: string;
  removed: boolean;
}

/** A line being added to the record. */
export interface DprRecordAddedDraft {
  boqItemId: string;
  qty: string;
  remarks: string;
}

/** The editor's key for an added line, beside the projection ids of the lines already there. */
export const dprAddedRowKey = (boqItemId: string): string => `add:${boqItemId}`;

/** A typed quantity: null when blank, NaN when it is not a number. */
export function readDprQtyText(text: string): number | null {
  const cleaned = String(text ?? "").replace(/,/g, "").trim();
  return cleaned === "" ? null : Number(cleaned);
}

const sameQty = (a: number, b: number) => Math.abs(a - b) < 1e-9;

export interface DprRecordEditPlan {
  /** Lines whose quantity changes — each becomes a revision. `remarks` is the (possibly new) note. */
  revise: Array<{ target: DprTarget; toQty: number; remarks: string }>;
  /** Lines where only the note changes — no revision. */
  remarksOnly: Array<{ target: DprTarget; remarks: string }>;
  remove: DprTarget[];
  add: Array<{ boqItemId: string; qty: number; remarks: string }>;
  /** Row keys whose quantity cannot be saved as typed (blank, not a number, zero or less). */
  invalid: string[];
  /** Revisions, note changes, removals and additions together. */
  changeCount: number;
  /** A quantity changes or a line goes: the edit needs a reason. */
  needsReason: boolean;
  /** Every line already in the record is removed and none is added. */
  removesAll: boolean;
}

/**
 * What saving the editor would write. A row with nothing changed is left out; a row the editor
 * never touched reads as unchanged (`rows` need only hold the touched ones).
 */
export function planDprRecordEdit(
  record: Pick<DprProjectionRecord, "targets">,
  rows: ReadonlyMap<string, DprRecordRowDraft>,
  added: readonly DprRecordAddedDraft[],
): DprRecordEditPlan {
  const plan: DprRecordEditPlan = {
    revise: [],
    remarksOnly: [],
    remove: [],
    add: [],
    invalid: [],
    changeCount: 0,
    needsReason: false,
    removesAll: false,
  };

  for (const target of record.targets) {
    const row = rows.get(target.id);
    if (!row) continue;
    if (row.removed) {
      plan.remove.push(target);
      continue;
    }
    const currentQty = dprNumber(target.plannedQty);
    const qty = readDprQtyText(row.qty);
    const remarks = row.remarks.trim();
    const remarksChanged = remarks !== String(target.remarks ?? "").trim();
    if (qty === null || !Number.isFinite(qty) || qty <= 0) {
      plan.invalid.push(target.id);
      continue;
    }
    if (!sameQty(qty, currentQty)) plan.revise.push({ target, toQty: qty, remarks });
    else if (remarksChanged) plan.remarksOnly.push({ target, remarks });
  }

  for (const line of added) {
    const qty = readDprQtyText(line.qty);
    if (qty === null || !Number.isFinite(qty) || qty <= 0) {
      plan.invalid.push(dprAddedRowKey(line.boqItemId));
      continue;
    }
    plan.add.push({ boqItemId: line.boqItemId, qty, remarks: line.remarks.trim() });
  }

  plan.changeCount = plan.revise.length + plan.remarksOnly.length + plan.remove.length + plan.add.length;
  plan.needsReason = plan.revise.length > 0 || plan.remove.length > 0;
  plan.removesAll =
    record.targets.length > 0 && plan.remove.length === record.targets.length && added.length === 0;
  return plan;
}

/**
 * The projection checks for every row the edit would write, keyed like the editor's rows: a
 * changed line is checked as a revision of its projection, an added line as a new projection over
 * the record's period. Unchanged and removed lines are not checked.
 */
export function checkDprRecordRows(input: {
  record: Pick<DprProjectionRecord, "scope" | "startDate" | "endDate" | "periodType" | "spreadForNew" | "targets">;
  rows: ReadonlyMap<string, DprRecordRowDraft>;
  added: readonly DprRecordAddedDraft[];
  items: ReadonlyMap<string, { unit: string; boqQty: number }>;
  targets: readonly DprTarget[];
  actuals: DprActualIndex;
  settings: DprSettings;
  projectDates: DprDateRange;
  today: string;
  overlapPolicy: DprOverlapPolicy;
}): Map<string, DprCheckResult> {
  const { record, rows, added, items, targets, actuals, settings, projectDates, today, overlapPolicy } = input;
  const results = new Map<string, DprCheckResult>();
  const shared = { targets, actuals, settings, projectDates, today, overlapPolicy };

  for (const target of record.targets) {
    const row = rows.get(target.id);
    if (!row || row.removed) continue;
    const qty = readDprQtyText(row.qty);
    const currentQty = dprNumber(target.plannedQty);
    if (qty !== null && Number.isFinite(qty) && sameQty(qty, currentQty)) continue;
    const item = items.get(target.boqItemId) ?? { unit: target.unit, boqQty: 0 };
    if (qty === null || !Number.isFinite(qty)) {
      results.set(target.id, {
        errors: ["Enter the new quantity, or take the line off the record."],
        warnings: [],
      });
      continue;
    }
    results.set(
      target.id,
      checkDprProjection({
        ...shared,
        candidate: {
          scope: target.scope,
          boqItemId: target.boqItemId,
          periodType: target.periodType,
          startDate: target.startDate,
          endDate: target.endDate,
          plannedQty: qty,
          distribution: target.distribution ?? "even",
        },
        item,
        revising: target,
      }),
    );
  }

  for (const line of added) {
    const key = dprAddedRowKey(line.boqItemId);
    const qty = readDprQtyText(line.qty);
    if (qty === null || !Number.isFinite(qty)) {
      results.set(key, { errors: ["Enter a quantity, or take the line off the record."], warnings: [] });
      continue;
    }
    results.set(
      key,
      checkDprProjection({
        ...shared,
        candidate: {
          scope: record.scope,
          boqItemId: line.boqItemId,
          periodType: record.periodType,
          startDate: record.startDate,
          endDate: record.endDate,
          plannedQty: qty,
          distribution: record.spreadForNew,
        },
        item: items.get(line.boqItemId) ?? { unit: "", boqQty: 0 },
      }),
    );
  }

  return results;
}
