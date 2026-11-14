/**
 * BOQ sub-items — breaking a contract line into the parts you actually buy and build.
 *
 * "Earthing system, 1 LOT" is really earth pits in Nos, strip in Rmt and testing in Nos. Those are
 * what gets indented, ordered and sub-contracted; the LOT is only what the client agreed to pay
 * for. So the breakdown is an **internal** subdivision:
 *
 *  - **The client never sees it.** JMC, MVAC and RA bills stay on the contract line and read the
 *    sub-items' progress rolled up into it. That is why sub-items live in their own collection
 *    rather than as `boqItems` documents with a parent — a sub-item in `boqItems` would appear in
 *    every BOQ count, export and print, and in the client's register.
 *  - **The contract total cannot drift.** A sub-item takes a *share* of its parent, never its own
 *    typed rate, so the parts always add back to exactly the line's value.
 *  - **A line with work against it cannot be broken down.** Its existing indents, orders and
 *    measurements point at the line; adding children would count the line's records and its
 *    children's twice. See `checkBoqSubItem`.
 *
 * One weight does two jobs: it is the share of the parent for progress *and* for money. A line
 * carries two values — what the client pays (contract) and what it should cost (budget) — and the
 * same share divides both, so a sub-item has a contract rate and a budget rate without needing two
 * independent weights that could disagree about how much of the parent a part is.
 *
 * The tree arithmetic is `boq-breakdown.ts`, shared with Daily Progress's own breakdown. The two
 * trees are separate records on purpose — DPR splits a line for how work is sequenced day to day,
 * this splits it for what is bought — but they share one implementation of the maths.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import {
  DEFAULT_MAX_BREAKDOWN_DEPTH,
  breakdownNumber,
  buildBreakdown,
  nextSubItemSlNo,
  unitKey,
  type Breakdown,
  type BreakdownLine,
  type BreakdownNode,
  type BreakdownSubItem,
} from "./boq-breakdown.ts";

export { nextSubItemSlNo };

/** `projects/{globalProjectId}/boqSubItems/{id}`. */
export const BOQ_SUB_ITEM_COLLECTION = "boqSubItems";

/** Levels of sub-items below a BOQ line. The same limit the DPR breakdown uses. */
export const BOQ_MAX_BREAKDOWN_DEPTH = DEFAULT_MAX_BREAKDOWN_DEPTH;

/** Breaking a line down is its own right: it changes what everybody downstream can order against. */
export const BOQ_BREAKDOWN_PERMISSION_ACTION = "Break Down";

/**
 * Units counted in whole numbers. You cannot order 2.5 earth pits.
 *
 * Deliberately a constant here rather than read from Daily Progress's settings document: the BOQ
 * breakdown must not depend on another module's configuration being present.
 */
export const BOQ_WHOLE_NUMBER_UNITS: readonly string[] = [
  "Nos",
  "No",
  "Each",
  "Set",
  "Sets",
  "Pair",
  "Pairs",
  "Pcs",
  "Piece",
  "Lot",
  "LOT",
];

/** A sub-item as stored. */
export interface BoqSubItem extends BreakdownSubItem {
  remarks?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export type BoqSubItemDraft = Omit<
  BoqSubItem,
  "id" | "createdAt" | "createdBy" | "createdByName" | "updatedAt" | "updatedBy" | "updatedByName"
>;

/** A BOQ line as the breakdown needs it. `scope` is free text — the BOQ's `Scope 2` column. */
export type BoqBreakdownLine = BreakdownLine<string>;
export type BoqBreakdownNode = BreakdownNode<string>;
export type BoqBreakdown = Breakdown<string>;

export function buildBoqBreakdown(
  boqLines: readonly BoqBreakdownLine[],
  subItems: readonly BoqSubItem[],
): BoqBreakdown {
  return buildBreakdown<string>(boqLines, subItems, { maxDepth: BOQ_MAX_BREAKDOWN_DEPTH });
}

/* ── The two values ─────────────────────────────────────────────────────────────────────────── */

export interface BoqNodeValue {
  /** This node's slice of the line's contract value — what the client pays for it. */
  contractValue: number;
  /** Its slice of the line's budget value — what it should cost to do. */
  budgetValue: number;
  /** `qty × contractRate === contractValue`, so a quantity can be priced directly. */
  contractRate: number;
  budgetRate: number;
}

/**
 * Each node's share of its line's two values.
 *
 * The share is the node's `shareOfLine` — the product of the weights on the way down — so both
 * values are divided by the same structure. A caller supplies how to read a line's two values,
 * because this repo has four disagreeing rate readers and the breakdown must not add a fifth:
 * pass the *one* helper each screen already trusts.
 */
export function boqNodeValues(
  breakdown: BoqBreakdown,
  readLineValues: (lineId: string) => { contract: number; budget: number },
): Map<string, BoqNodeValue> {
  const values = new Map<string, BoqNodeValue>();
  const lineValues = new Map<string, { contract: number; budget: number }>();

  for (const node of breakdown.ordered) {
    if (node.depth === 0) {
      const read = readLineValues(node.id);
      lineValues.set(node.id, {
        contract: breakdownNumber(read?.contract),
        budget: breakdownNumber(read?.budget),
      });
    }
    const line = lineValues.get(node.boqItemId) ?? { contract: 0, budget: 0 };
    const contractValue = line.contract * node.shareOfLine;
    const budgetValue = line.budget * node.shareOfLine;
    values.set(node.id, {
      contractValue,
      budgetValue,
      contractRate: node.qty > 0 ? contractValue / node.qty : 0,
      budgetRate: node.qty > 0 ? budgetValue / node.qty : 0,
    });
  }
  return values;
}

/**
 * A BOQ line's two values, read one way.
 *
 * This repo has four expressions for "what is this line worth" and they disagree: the dashboard
 * and the Civil hub prefer `"Budget Price"`, Billing Recon prefers `"Unit Rate"` and back-derives
 * `amount ÷ qty`, and the Costing grid uses `"Unit Rate"` alone for its JMC column. A sub-item's
 * share must divide one definite figure, or the same part would be worth different amounts on
 * different screens — so the breakdown reads values only through here.
 *
 * The two are the sheet's own pair, as the BOQ Add form writes them: `"Total Amount"` is
 * `QTY × "Unit Rate"` (the contract), `"Total Budget Price"` is the budget side. A stored total
 * wins over a recomputation, because an imported sheet's own arithmetic is what was agreed.
 */
export function boqLineValues(item: Record<string, unknown> | null | undefined): {
  contract: number;
  budget: number;
} {
  if (!item) return { contract: 0, budget: 0 };
  const qty = breakdownNumber(item.QTY ?? item.Quantity ?? item.quantity);

  const storedContract = breakdownNumber(item["Total Amount"] ?? item.totalAmount);
  const contract =
    storedContract > 0 ? storedContract : qty * breakdownNumber(item["Unit Rate"] ?? item.Rate ?? item.rate);

  const storedBudget = breakdownNumber(item["Total Budget Price"] ?? item.totalBudgetPrice);
  const budget = storedBudget > 0 ? storedBudget : qty * breakdownNumber(item["Budget Price"]);

  return { contract, budget };
}

/* ── What blocks a breakdown ────────────────────────────────────────────────────────────────── */

/**
 * Ids that already carry work.
 *
 * The caller resolves this from whatever registers it loaded — indents, purchase orders, work
 * orders, measurements. Keeping it a plain set is what lets this module stay pure and lets the
 * rule tighten later without a signature change.
 */
export type BoqRecordedIds = ReadonlySet<string>;

export interface BoqCheckResult {
  errors: string[];
  warnings: string[];
}

export interface CheckBoqSubItemInput {
  draft: BoqSubItemDraft;
  /** Set when editing an existing sub-item, so it does not clash with itself. */
  editingId?: string;
  breakdown: BoqBreakdown;
  recordedIds: BoqRecordedIds;
  wholeNumberUnits?: readonly string[];
}

const isWholeNumberUnit = (unit: string, units: readonly string[]): boolean =>
  units.some((candidate) => unitKey(candidate) === unitKey(unit));

/** Whether `qty` fits the decimals this unit allows. A tolerance check, not a rounder. */
export function fitsBoqPrecision(qty: number, decimals: number): boolean {
  const scaled = qty * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

export function checkBoqSubItem(input: CheckBoqSubItemInput): BoqCheckResult {
  const {
    draft,
    editingId,
    breakdown,
    recordedIds,
    wholeNumberUnits = BOQ_WHOLE_NUMBER_UNITS,
  } = input;
  const errors: string[] = [];
  const warnings: string[] = [];

  const parent = breakdown.nodes.get(draft.parentId);
  if (!parent) {
    errors.push("Choose the line this sub-item belongs under.");
    return { errors, warnings };
  }
  const editing = editingId ? breakdown.nodes.get(editingId) : undefined;

  if (!editing) {
    if (parent.depth + 1 > BOQ_MAX_BREAKDOWN_DEPTH) {
      errors.push(`Sub-items go at most ${BOQ_MAX_BREAKDOWN_DEPTH} levels below a BOQ line.`);
    }
    // A parent becomes a group the moment it gets its first sub-item. One that already carries
    // records of its own would then have both its own and its children's counted.
    if (parent.isLeaf && recordedIds.has(parent.id)) {
      errors.push(
        `${parent.slNo || "This line"} already has work recorded against it — an indent, an order, a measurement or progress. Break a line down before work starts on it, so nothing is counted twice.`,
      );
    }
  }

  const slNo = String(draft.slNo ?? "").trim();
  if (!slNo) {
    errors.push("Give the sub-item an SL No.");
  } else {
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

  const qty = breakdownNumber(draft.qty);
  const decimals = unit && isWholeNumberUnit(unit, wholeNumberUnits) ? 0 : 3;
  if (!(qty > 0)) {
    errors.push("Quantity must be greater than zero.");
  } else if (!fitsBoqPrecision(qty, decimals)) {
    errors.push(
      decimals === 0
        ? `${unit} is counted in whole numbers.`
        : `Use at most 3 decimals for ${unit.toLowerCase()}.`,
    );
  }

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

  // Changing the unit would silently change what every stored quantity means.
  if (editing && unitKey(editing.unit) !== unitKey(unit) && recordedIds.has(editing.id)) {
    errors.push("The unit cannot change once something is ordered or recorded against this sub-item.");
  }

  // Shares that do not reach 100% leave part of the parent with nothing under it — which is a
  // thing to point out, not to correct: the missing share may be work nobody has listed yet.
  if (errors.length === 0) {
    const siblings = breakdown.childrenOf(parent.id).filter((sibling) => sibling.id !== editingId);
    const all = [...siblings.map((sibling) => sibling.weightPct), weight ?? null];
    const anyBlank = all.some((share) => share === null || share === undefined);
    const total = all.reduce<number>((sum, share) => sum + (share ?? 0), 0);
    if (!anyBlank && total < 100 - 1e-9) {
      warnings.push(
        `Shares under ${parent.slNo || "this line"} total ${Math.round(total * 100) / 100}%, so ${Math.round((100 - total) * 100) / 100}% of it is not covered by any sub-item.`,
      );
    }
  }

  return { errors, warnings };
}

export interface BoqSubItemDeleteCheck {
  errors: string[];
  /** The sub-item and everything under it — all of which go together. */
  deleteIds: string[];
}

export function checkBoqSubItemDelete(input: {
  id: string;
  breakdown: BoqBreakdown;
  recordedIds: BoqRecordedIds;
}): BoqSubItemDeleteCheck {
  const { id, breakdown, recordedIds } = input;
  const node = breakdown.nodes.get(id);
  if (!node || node.kind !== "sub") {
    return { errors: ["Only a sub-item can be deleted here."], deleteIds: [] };
  }
  const deleteIds = [id, ...breakdown.descendantIds(id)];
  const blocked = deleteIds.filter((candidate) => recordedIds.has(candidate));
  if (blocked.length > 0) {
    const names = blocked
      .map((candidate) => breakdown.nodes.get(candidate)?.slNo || candidate)
      .join(", ");
    return {
      errors: [
        `Work is recorded against ${names}. Remove or re-point it before deleting the sub-item.`,
      ],
      deleteIds: [],
    };
  }
  return { errors: [], deleteIds };
}
