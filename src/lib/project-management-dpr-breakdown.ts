/**
 * Daily Progress — work breakdown: sub-items under a BOQ line, and sub-items under those.
 *
 * A BOQ line is often too coarse to plan or record against — "Earthing system, 1 LOT" is really
 * earth pits in Nos, strip in Rmt and testing in Nos. The breakdown lets a project split any BOQ
 * line into sub-items, to any depth up to `DPR_MAX_BREAKDOWN_DEPTH`, without touching the BOQ
 * register itself (billing, JMC and the BOQ stay on the client's lines).
 *
 * The rules:
 *  - **Work is recorded and planned on leaves only** — BOQ lines with no sub-items, and sub-items
 *    with none of their own. A line with sub-items is a group: its figures are rolled up.
 *  - **A group's progress is the weighted progress of its children**, in the group's own unit. Each
 *    child carries a share of its parent (`weightPct`). Blank shares split what the set ones leave:
 *    by quantity when every child is in the parent's unit (so 400 + 600 Cum under a 1000 Cum line
 *    simply add up), otherwise equally. A 1 LOT line whose sub-items are 40% done reads 0.4 LOT.
 *  - **A sub-item inherits its share of the BOQ line's value**, so value-weighted achievement and
 *    the Civil hub's money figures still add up to the line's own value.
 *  - **Nothing is counted twice**: sub-items cannot be added under a line (or sub-item) that already
 *    has projections or recorded progress of its own.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import {
  dprNumber,
  type DprBoqLike,
  type DprEntry,
  type DprScope,
  type DprTarget,
} from "./project-management-dpr.ts";
import {
  dprUnitDecimals,
  fitsUnitPrecision,
  precisionMessage,
  type DprCheckResult,
  type DprSettings,
} from "./project-management-dpr-plan.ts";
import {
  arrangeByBreakdown as sharedArrange,
  buildBreakdown,
  compareSlNo,
  unitKey,
  effectiveWeights as sharedEffectiveWeights,
  nextSubItemSlNo as sharedNextSubItemSlNo,
  type Breakdown,
  type BreakdownNode,
  type BreakdownSubItem,
  type TreeRow,
} from "./boq-breakdown.ts";

/** `projects/{globalProjectId}/dprSubItems/{id}`. */
export const DPR_SUB_ITEM_COLLECTION = "dprSubItems";

/** Levels of sub-items below a BOQ line. Deep enough for real breakdowns, shallow enough to read. */
export const DPR_MAX_BREAKDOWN_DEPTH = 5;

/** A DPR sub-item: the shared record, plus the remarks and audit DPR stores beside it. */
export interface DprSubItem extends BreakdownSubItem {
  remarks?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export type DprSubItemDraft = Omit<
  DprSubItem,
  "id" | "createdAt" | "createdBy" | "createdByName" | "updatedAt" | "updatedBy" | "updatedByName"
>;

/** A BOQ line as the breakdown needs it. */
export type DprBreakdownLine = DprBoqLike & { scope: DprScope };

/** The generic node, with DPR's closed scope union kept rather than widened to string. */
export type DprBreakdownNode = BreakdownNode<DprScope>;
export type DprBreakdown = Breakdown<DprScope>;
export type DprTreeRow<R> = TreeRow<R, DprScope>;

/* ── The tree ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The arithmetic lives in `boq-breakdown.ts`, shared with the BOQ module's own register.
 *
 * Daily Progress and the BOQ break a line down for different reasons — DPR for how work is
 * sequenced day to day, the BOQ for what is bought and sub-contracted — so the two trees are
 * separate records. They must still agree on the maths, which is why only the records differ and
 * the engine does not.
 */
export const effectiveWeights = sharedEffectiveWeights;
export const arrangeByBreakdown = sharedArrange;
export const nextSubItemSlNo = sharedNextSubItemSlNo;
export const compareDprSlNo = compareSlNo;

export function buildDprBreakdown(
  boqLines: readonly DprBreakdownLine[],
  subItems: readonly DprSubItem[],
): DprBreakdown {
  return buildBreakdown<DprScope>(boqLines, subItems, { maxDepth: DPR_MAX_BREAKDOWN_DEPTH });
}

/* ── Records and checks ─────────────────────────────────────────────────────────────────────── */

/** Whether anything — a projection, or a line on any sheet, draft or not — is booked against `id`. */
export function hasDprRecords(
  id: string,
  targets: readonly DprTarget[],
  entries: readonly DprEntry[],
): boolean {
  return (
    targets.some((target) => target.boqItemId === id) ||
    entries.some((entry) => (entry.lines ?? []).some((line) => line?.boqItemId === id))
  );
}

export function checkDprSubItem(input: {
  draft: Pick<DprSubItemDraft, "parentId" | "slNo" | "description" | "unit" | "qty" | "weightPct">;
  editingId?: string;
  breakdown: DprBreakdown;
  targets: readonly DprTarget[];
  entries: readonly DprEntry[];
  settings: Pick<DprSettings, "wholeNumberUnits">;
}): DprCheckResult {
  const { draft, editingId, breakdown, targets, entries, settings } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const parent = breakdown.nodes.get(draft.parentId);
  if (!parent) {
    errors.push("Choose the line this sub-item belongs under.");
    return { errors, warnings };
  }
  const editing = editingId ? breakdown.nodes.get(editingId) : undefined;

  if (!editing) {
    if (parent.depth + 1 > DPR_MAX_BREAKDOWN_DEPTH) {
      errors.push(`Sub-items go at most ${DPR_MAX_BREAKDOWN_DEPTH} levels below a BOQ line.`);
    }
    // A parent becomes a group the moment it gets its first sub-item; one that already carries
    // records of its own would then count those and its children's twice.
    if (parent.isLeaf && hasDprRecords(parent.id, targets, entries)) {
      errors.push(
        `${parent.slNo || "This line"} already has projections or progress recorded against it. Sub-items can only be added before anything is planned or recorded on it, so nothing is counted twice.`,
      );
    }
  }

  const slNo = String(draft.slNo ?? "").trim();
  if (!slNo) errors.push("Give the sub-item an SL No.");
  else {
    const clash = [...breakdown.nodes.values()].find(
      (node) =>
        node.id !== editingId &&
        node.boqItemId === parent.boqItemId &&
        node.slNo.toLowerCase() === slNo.toLowerCase(),
    );
    if (clash) errors.push(`SL No ${slNo} is already used in this BOQ line's breakdown.`);
  }
  if (!String(draft.description ?? "").trim()) errors.push("Describe the sub-item.");
  const unit = String(draft.unit ?? "").trim();
  if (!unit) errors.push("Give the unit it is measured in.");

  const qty = dprNumber(draft.qty);
  const decimals = dprUnitDecimals(unit, settings);
  if (!(qty > 0)) errors.push("Quantity must be greater than zero.");
  else if (!fitsUnitPrecision(qty, decimals)) errors.push(precisionMessage(unit, decimals));

  const weight = draft.weightPct;
  if (weight !== null && weight !== undefined) {
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
      errors.push("Share of the parent must be above 0 and at most 100%, or left blank.");
    } else {
      const siblingsSet = breakdown
        .childrenOf(parent.id)
        .filter((sibling) => sibling.id !== editingId)
        .reduce((sum, sibling) => sum + (sibling.weightPct ?? 0), 0);
      if (siblingsSet + weight > 100 + 1e-9) {
        errors.push(
          `Shares under ${parent.slNo || "this line"} would total ${Math.round((siblingsSet + weight) * 100) / 100}%. They can be at most 100%.`,
        );
      }
    }
  }

  if (editing && unitKey(editing.unit) !== unitKey(unit) && hasDprRecords(editing.id, targets, entries)) {
    errors.push("The unit cannot change once something is planned or recorded against this sub-item.");
  }

  // Shares that do not reach 100% leave part of the parent with nothing under it.
  if (errors.length === 0) {
    const siblings = breakdown.childrenOf(parent.id).filter((sibling) => sibling.id !== editingId);
    const all = [...siblings.map((s) => s.weightPct), weight ?? null];
    const anyBlank = all.some((share) => share === null);
    const total = all.reduce<number>((sum, share) => sum + (share ?? 0), 0);
    if (!anyBlank && total < 100 - 1e-9) {
      warnings.push(
        `Shares under ${parent.slNo || "this line"} total ${Math.round(total * 100) / 100}%, so ${Math.round((100 - total) * 100) / 100}% of it is not covered by any sub-item.`,
      );
    }
  }

  return { errors, warnings };
}

/** Whether a sub-item (and everything under it) can be deleted, and what would go. */
export function checkDprSubItemDelete(input: {
  id: string;
  breakdown: DprBreakdown;
  targets: readonly DprTarget[];
  entries: readonly DprEntry[];
}): { errors: string[]; deleteIds: string[] } {
  const { id, breakdown, targets, entries } = input;
  const node = breakdown.nodes.get(id);
  if (!node || node.kind !== "sub") return { errors: ["Only a sub-item can be deleted here."], deleteIds: [] };
  const deleteIds = [id, ...breakdown.descendantIds(id)];
  const booked = deleteIds
    .filter((candidate) => hasDprRecords(candidate, targets, entries))
    .map((candidate) => breakdown.nodes.get(candidate)?.slNo || "a sub-item");
  return booked.length > 0
    ? {
        errors: [
          `${booked.join(", ")} ${booked.length === 1 ? "has" : "have"} projections or progress recorded, so ${node.slNo} cannot be deleted. Remove those first.`,
        ],
        deleteIds,
      }
    : { errors: [], deleteIds };
}
