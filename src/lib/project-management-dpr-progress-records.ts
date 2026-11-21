/**
 * Progress records — every Daily Progress sheet filed on a project, as Record progress lists them:
 * newest day first, each with the BOQ lines recorded on it, its state, and whether this user may
 * open it for editing or delete it.
 *
 * A record *is* a sheet (`dprEntries`, one per scope per day), so nothing here is stored; it only
 * reads sheets. Editing goes through the sheet editor, which holds every rule about a sheet. The
 * one rule repeated here is the lock: a submitted sheet is changed only after a DPR approver (the
 * `Reopen` action) turns it back into a draft, and it is deleted only after that too.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import { DPR_SCOPES, dprNumber, type DprEntry, type DprLine } from "./project-management-dpr.ts";

/* ── State ──────────────────────────────────────────────────────────────────────────────────── */

export type DprProgressRecordState = "draft" | "reopened" | "submitted";

/** Submitted (locked), a draft never submitted, or a submitted sheet reopened as a draft. */
export function dprProgressRecordState(
  entry: Pick<DprEntry, "status" | "reopenedBy" | "reopenedAt">,
): DprProgressRecordState {
  if (entry.status === "Submitted") return "submitted";
  return entry.reopenedBy || entry.reopenedAt ? "reopened" : "draft";
}

/* ── Order and search ───────────────────────────────────────────────────────────────────────── */

const scopeRank = (scope: string): number => {
  const index = (DPR_SCOPES as readonly string[]).indexOf(scope);
  return index === -1 ? DPR_SCOPES.length : index;
};

/** Newest day first; on one day, the scopes in their fixed order (Civil, Erection, Supply). */
export function sortDprProgressRecords<T extends Pick<DprEntry, "id" | "date" | "scope">>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(
    (a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "") ||
      scopeRank(a.scope) - scopeRank(b.scope) ||
      (a.id ?? "").localeCompare(b.id ?? ""),
  );
}

const lineSlNo = (line: Pick<DprLine, "boqSlNo" | "erpSlNo">): string =>
  (line.boqSlNo || line.erpSlNo || "").trim();

export interface DprRecordBoqLine {
  /** The BOQ line's id, or its SL No and description on a line saved without one. */
  key: string;
  slNo: string;
  description: string;
  /** Rows the line has on the sheet — more than one when it was recorded at several locations. */
  rows: number;
}

/**
 * The BOQ lines on a sheet, once each, in the order they were recorded — a line recorded twice
 * (two locations) is listed once, with `rows: 2`. A line saved without an SL No reads "—".
 */
export function dprRecordBoqLines(entry: Pick<DprEntry, "lines">): DprRecordBoqLine[] {
  const byKey = new Map<string, DprRecordBoqLine>();
  for (const line of entry.lines ?? []) {
    if (!line) continue;
    const key = line.boqItemId || `${lineSlNo(line)}|${line.description ?? ""}`;
    const known = byKey.get(key);
    if (known) {
      known.rows += 1;
      continue;
    }
    byKey.set(key, { key, slNo: lineSlNo(line) || "—", description: (line.description ?? "").trim(), rows: 1 });
  }
  return [...byKey.values()];
}

/** The SL Nos of `dprRecordBoqLines`, for a one-line preview. */
export function dprRecordSlNos(entry: Pick<DprEntry, "lines">): string[] {
  return dprRecordBoqLines(entry).map((line) => line.slNo);
}

/**
 * Whether a sheet matches what was typed in the search box: its date (as stored, yyyy-mm-dd), its
 * scope, who prepared it, its notes, or any line's SL No or description. Every word must match
 * somewhere; case is ignored.
 */
export function dprRecordMatches(
  entry: Pick<
    DprEntry,
    "date" | "scope" | "lines" | "preparedByName" | "createdByName" | "remarks" | "hindrances"
  >,
  query: string,
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    entry.date,
    entry.scope,
    entry.preparedByName ?? "",
    entry.createdByName ?? "",
    entry.remarks ?? "",
    entry.hindrances ?? "",
    ...(entry.lines ?? []).map((line) => `${lineSlNo(line ?? {})} ${line?.description ?? ""}`),
  ]
    .join(" \n ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/* ── One line against its plan snapshot ─────────────────────────────────────────────────────── */

export type DprRecordLineStanding = "not-entered" | "met" | "ahead" | "behind" | "unplanned" | "none";

export interface DprRecordLineFigures {
  planned: number;
  actual: number;
  /** false when a draft was saved with the Actual box left empty. */
  entered: boolean;
  /** Actual less planned, when something was planned and an actual was entered. */
  variance: number | null;
  standing: DprRecordLineStanding;
}

/**
 * A recorded line against the plan snapshot written onto it when the sheet was saved — not the
 * plan as it stands now, which may have been revised since. Lines saved before `actualEntered`
 * existed read as entered. `tolerance` absorbs rounding (a 3-dp unit's 0.0004).
 */
export function dprRecordLineFigures(
  line: Pick<DprLine, "plannedQty" | "actualQty" | "actualEntered">,
  tolerance = 1e-9,
): DprRecordLineFigures {
  const planned = dprNumber(line.plannedQty);
  const actual = dprNumber(line.actualQty);
  const entered = line.actualEntered !== false;
  if (!entered) return { planned, actual: 0, entered, variance: null, standing: "not-entered" };
  if (planned <= 0) {
    return { planned, actual, entered, variance: null, standing: actual > 0 ? "unplanned" : "none" };
  }
  const variance = actual - planned;
  const standing = Math.abs(variance) <= tolerance ? "met" : variance > 0 ? "ahead" : "behind";
  return { planned, actual, entered, variance, standing };
}

/* ── What this user may do with a record ────────────────────────────────────────────────────── */

export interface DprRecordAccess {
  /** The Add action: record progress, so edit a sheet that is open. */
  canRecord: boolean;
  /** The Reopen action: turn a submitted sheet back into a draft. */
  canReopen: boolean;
  /** The Delete action. */
  canDelete: boolean;
}

export interface DprRecordAction {
  allowed: boolean;
  /** A submitted sheet: it is reopened as a draft first (and so stops counting until resubmitted). */
  reopenFirst: boolean;
  /** Why it is not allowed — shown on the disabled button. */
  reason: string | null;
}

const NEEDS_ADD = "Editing a sheet needs the Add action on Daily Progress.";

/** Edit a record: open sheets with the Add action; submitted ones only by a DPR approver, reopened first. */
export function dprRecordEditAction(
  entry: Pick<DprEntry, "status">,
  access: DprRecordAccess,
): DprRecordAction {
  if (entry.status === "Submitted") {
    if (!access.canReopen) {
      return {
        allowed: false,
        reopenFirst: true,
        reason: "Submitted and locked — only a DPR approver can reopen it for editing.",
      };
    }
    if (!access.canRecord) return { allowed: false, reopenFirst: true, reason: NEEDS_ADD };
    return { allowed: true, reopenFirst: true, reason: null };
  }
  if (!access.canRecord) return { allowed: false, reopenFirst: false, reason: NEEDS_ADD };
  return { allowed: true, reopenFirst: false, reason: null };
}

/** Delete a record: the Delete action, and never a submitted sheet — it is reopened first. */
export function dprRecordDeleteAction(
  entry: Pick<DprEntry, "status">,
  access: DprRecordAccess,
): DprRecordAction {
  if (!access.canDelete) {
    return { allowed: false, reopenFirst: false, reason: "Deleting a sheet needs the Delete action on Daily Progress." };
  }
  if (entry.status === "Submitted") {
    return {
      allowed: false,
      reopenFirst: true,
      reason: "Submitted and locked — a DPR approver reopens it before it can be deleted.",
    };
  }
  return { allowed: true, reopenFirst: false, reason: null };
}
