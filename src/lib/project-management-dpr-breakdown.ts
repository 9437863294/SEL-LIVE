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

/** `projects/{globalProjectId}/dprSubItems/{id}`. */
export const DPR_SUB_ITEM_COLLECTION = "dprSubItems";

/** Levels of sub-items below a BOQ line. Deep enough for real breakdowns, shallow enough to read. */
export const DPR_MAX_BREAKDOWN_DEPTH = 5;

export interface DprSubItem {
  id: string;
  /** The BOQ line this breakdown hangs from. */
  boqItemId: string;
  /** The direct parent: the BOQ line itself, or another sub-item of it. */
  parentId: string;
  slNo: string;
  description: string;
  unit: string;
  qty: number;
  /** Share of the parent, in percent. null shares out whatever the set ones leave. */
  weightPct: number | null;
  /** Position among its siblings. */
  order: number;
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

export interface DprBreakdownNode {
  id: string;
  kind: "boq" | "sub";
  /** The BOQ line at the top of this node's branch (itself, for a BOQ line). */
  boqItemId: string;
  parentId: string | null;
  /** 0 for a BOQ line, 1 for its sub-items, and so on. */
  depth: number;
  slNo: string;
  erpSlNo?: string;
  description: string;
  unit: string;
  qty: number;
  scope: DprScope;
  /** The share as set (sub-items only). */
  weightPct: number | null;
  /** The share of its parent actually used, 0–1. 1 for a BOQ line. */
  weight: number;
  /** This node's share of its BOQ line: the product of the weights on the way down. */
  shareOfLine: number;
  /**
   * The rate that makes `qty × rate` this node's share of the BOQ line's value. The line's own rate
   * for a BOQ line; 0 where the line carries no rate.
   */
  rate: number;
  childIds: string[];
  isLeaf: boolean;
  /** SL No and description of every ancestor, top first — for a row's tooltip. */
  ancestors: Array<{ slNo: string; description: string }>;
}

export interface DprBreakdown {
  nodes: ReadonlyMap<string, DprBreakdownNode>;
  /** Every node, depth first, BOQ lines in the order given and sub-items in their own order. */
  ordered: readonly DprBreakdownNode[];
  /** What progress is planned and recorded against. */
  leaves: readonly DprBreakdownNode[];
  /** Ids of BOQ lines that have sub-items — groups, which take no records of their own. */
  groupLineIds: ReadonlySet<string>;
  childrenOf(id: string): DprBreakdownNode[];
  /** Every node under `id`, not including it. */
  descendantIds(id: string): string[];
  /** The leaves under `id` (itself, if it is one). */
  leavesUnder(id: string): DprBreakdownNode[];
  /**
   * A figure per leaf (in the leaf's unit), rolled up to every node in that node's own unit:
   * a group's value is Σ child weight × (child value ÷ child qty) × the group's qty.
   */
  rollUp(perLeaf: (leafId: string) => number): Map<string, number>;
}

const unitKey = (unit: unknown): string =>
  String(unit ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const compareSlNo = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Each child's share of its parent, 0–1.
 *
 * Set shares are used as given. Blank ones split what is left: by quantity when every child is in
 * the parent's unit and has a quantity (so same-unit parts simply add up), otherwise equally.
 */
export function effectiveWeights(
  parent: { unit: string },
  children: ReadonlyArray<{ id: string; unit: string; qty: number; weightPct: number | null }>,
): Map<string, number> {
  const weights = new Map<string, number>();
  if (children.length === 0) return weights;
  const isSet = (child: { weightPct: number | null }) =>
    typeof child.weightPct === "number" && Number.isFinite(child.weightPct) && child.weightPct > 0;
  const set = children.filter(isSet);
  const blank = children.filter((child) => !isSet(child));
  let taken = 0;
  for (const child of set) {
    const share = Math.min(1, (child.weightPct as number) / 100);
    weights.set(child.id, share);
    taken += share;
  }
  const left = Math.max(0, 1 - taken);
  if (blank.length > 0) {
    const sameUnit =
      blank.every((child) => unitKey(child.unit) === unitKey(parent.unit) && dprNumber(child.qty) > 0);
    const totalQty = blank.reduce((sum, child) => sum + dprNumber(child.qty), 0);
    for (const child of blank) {
      const share =
        sameUnit && totalQty > 0 ? (left * dprNumber(child.qty)) / totalQty : left / blank.length;
      weights.set(child.id, share);
    }
  }
  return weights;
}

export function buildDprBreakdown(
  boqLines: readonly DprBreakdownLine[],
  subItems: readonly DprSubItem[],
): DprBreakdown {
  const lineIds = new Set(boqLines.map((line) => line.id));
  const subById = new Map(subItems.map((sub) => [sub.id, sub]));
  // Only sub-items whose chain reaches a BOQ line on this list, within the depth limit, are real;
  // an orphan (its parent deleted elsewhere) or a loop is ignored rather than trusted.
  const depthOf = new Map<string, number>();
  const resolveDepth = (sub: DprSubItem, seen: Set<string>): number => {
    const known = depthOf.get(sub.id);
    if (known !== undefined) return known;
    if (seen.has(sub.id)) return -1;
    seen.add(sub.id);
    let depth = -1;
    if (lineIds.has(sub.parentId)) depth = sub.parentId === sub.boqItemId ? 1 : -1;
    else {
      const parent = subById.get(sub.parentId);
      if (parent && parent.boqItemId === sub.boqItemId) {
        const parentDepth = resolveDepth(parent, seen);
        depth = parentDepth > 0 ? parentDepth + 1 : -1;
      }
    }
    if (depth > DPR_MAX_BREAKDOWN_DEPTH) depth = -1;
    depthOf.set(sub.id, depth);
    return depth;
  };
  const valid = subItems.filter((sub) => resolveDepth(sub, new Set()) > 0);

  const childrenByParent = new Map<string, DprSubItem[]>();
  for (const sub of valid) {
    const list = childrenByParent.get(sub.parentId) ?? [];
    list.push(sub);
    childrenByParent.set(sub.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => dprNumber(a.order) - dprNumber(b.order) || compareSlNo(a.slNo, b.slNo));
  }

  const nodes = new Map<string, DprBreakdownNode>();
  const ordered: DprBreakdownNode[] = [];

  const visit = (node: DprBreakdownNode, lineValue: number) => {
    nodes.set(node.id, node);
    ordered.push(node);
    const children = childrenByParent.get(node.id) ?? [];
    const weights = effectiveWeights(node, children);
    for (const child of children) {
      const weight = weights.get(child.id) ?? 0;
      const shareOfLine = node.shareOfLine * weight;
      const qty = dprNumber(child.qty);
      const childNode: DprBreakdownNode = {
        id: child.id,
        kind: "sub",
        boqItemId: node.boqItemId,
        parentId: node.id,
        depth: node.depth + 1,
        slNo: String(child.slNo ?? "").trim(),
        erpSlNo: node.erpSlNo,
        description: String(child.description ?? "").trim(),
        unit: String(child.unit ?? "").trim(),
        qty,
        scope: node.scope,
        weightPct: typeof child.weightPct === "number" ? child.weightPct : null,
        weight,
        shareOfLine,
        rate: qty > 0 ? (lineValue * shareOfLine) / qty : 0,
        childIds: (childrenByParent.get(child.id) ?? []).map((grandchild) => grandchild.id),
        isLeaf: !childrenByParent.has(child.id),
        ancestors: [...node.ancestors, { slNo: node.slNo, description: node.description }],
      };
      visit(childNode, lineValue);
    }
  };

  for (const line of boqLines) {
    const rate = dprNumber(line.rate);
    const qty = dprNumber(line.boqQty);
    visit(
      {
        id: line.id,
        kind: "boq",
        boqItemId: line.id,
        parentId: null,
        depth: 0,
        slNo: line.boqSlNo,
        erpSlNo: line.erpSlNo,
        description: line.description,
        unit: line.unit,
        qty,
        scope: line.scope,
        weightPct: null,
        weight: 1,
        shareOfLine: 1,
        rate,
        childIds: (childrenByParent.get(line.id) ?? []).map((child) => child.id),
        isLeaf: !childrenByParent.has(line.id),
        ancestors: [],
      },
      rate * qty,
    );
  }

  const leaves = ordered.filter((node) => node.isLeaf);
  const groupLineIds = new Set(
    ordered.filter((node) => node.kind === "boq" && !node.isLeaf).map((node) => node.id),
  );
  const childrenOf = (id: string) =>
    (nodes.get(id)?.childIds ?? []).map((childId) => nodes.get(childId)!).filter(Boolean);
  const descendantIds = (id: string): string[] =>
    childrenOf(id).flatMap((child) => [child.id, ...descendantIds(child.id)]);
  const leavesUnder = (id: string): DprBreakdownNode[] => {
    const node = nodes.get(id);
    if (!node) return [];
    return node.isLeaf ? [node] : childrenOf(id).flatMap((child) => leavesUnder(child.id));
  };

  const rollUp = (perLeaf: (leafId: string) => number): Map<string, number> => {
    const values = new Map<string, number>();
    /** Progress as a fraction of the node's own quantity. */
    const fraction = (node: DprBreakdownNode): number => {
      if (node.isLeaf) {
        const value = dprNumber(perLeaf(node.id));
        values.set(node.id, value);
        return node.qty > 0 ? value / node.qty : 0;
      }
      let sum = 0;
      for (const child of childrenOf(node.id)) sum += child.weight * fraction(child);
      values.set(node.id, Math.round(sum * node.qty * 1e6) / 1e6);
      return sum;
    };
    for (const node of ordered) if (node.depth === 0) fraction(node);
    return values;
  };

  return { nodes, ordered, leaves, groupLineIds, childrenOf, descendantIds, leavesUnder, rollUp };
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

/** The next free SL No under a parent: "2.2" → "2.2.1", then "2.2.2"… */
export function nextSubItemSlNo(parentSlNo: string, siblings: ReadonlyArray<{ slNo: string }>): string {
  const prefix = `${String(parentSlNo ?? "").trim() || "1"}.`;
  let highest = 0;
  for (const sibling of siblings) {
    const slNo = String(sibling.slNo ?? "").trim();
    if (!slNo.startsWith(prefix)) continue;
    const last = Number(slNo.slice(prefix.length).split(".")[0]);
    if (Number.isInteger(last) && last > highest) highest = last;
  }
  return `${prefix}${highest + 1}`;
}

/** Rules for adding or editing a sub-item. `editingId` is the sub-item being edited, if any. */
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

/* ── Showing the tree ───────────────────────────────────────────────────────────────────────── */

export interface DprTreeRow<R> {
  node: DprBreakdownNode;
  /** The leaf's own row; null for a group. */
  row: R | null;
  /** For a group, each field rolled up from its leaves, in the group's unit. */
  rolled: Record<string, number>;
}

/**
 * Leaf rows arranged under their groups, depth first, for a table that shows the breakdown.
 * A group is shown when any leaf under it has a row; its fields are rolled up from those leaves.
 */
export function arrangeByBreakdown<R>(
  breakdown: DprBreakdown,
  rows: ReadonlyMap<string, R>,
  fields: Record<string, (row: R) => number>,
): DprTreeRow<R>[] {
  const rolled: Record<string, Map<string, number>> = {};
  for (const [key, read] of Object.entries(fields)) {
    rolled[key] = breakdown.rollUp((leafId) => {
      const row = rows.get(leafId);
      return row ? read(row) : 0;
    });
  }
  const shown = (node: DprBreakdownNode): boolean =>
    node.isLeaf ? rows.has(node.id) : breakdown.leavesUnder(node.id).some((leaf) => rows.has(leaf.id));
  return breakdown.ordered.filter(shown).map((node) => ({
    node,
    row: node.isLeaf ? (rows.get(node.id) ?? null) : null,
    rolled: node.isLeaf
      ? {}
      : Object.fromEntries(Object.keys(fields).map((key) => [key, rolled[key]!.get(node.id) ?? 0])),
  }));
}

export const compareDprSlNo = compareSlNo;
