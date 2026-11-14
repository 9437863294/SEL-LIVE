/**
 * Breaking a BOQ line into the parts you actually buy and build.
 *
 * A client's BOQ line is often too coarse to work with. "Earthing system, 1 LOT" is really earth
 * pits in Nos, strip in Rmt and testing in Nos — and those are what gets indented, ordered,
 * sub-contracted and measured. This module turns a flat list of lines plus a flat list of
 * sub-items into a tree, and rolls figures from the leaves back up to the line.
 *
 * Three ideas do all the work:
 *
 *  - **Work belongs to leaves.** A line with sub-items is a *group*: it takes no records of its
 *    own, because its children's records are its records. Counting both would double-count.
 *
 *  - **Roll-up carries a fraction, never a quantity.** A leaf contributes `value ÷ its own qty`;
 *    a group's fraction is `Σ child.weight × child.fraction`; the group's figure is that fraction
 *    times *the group's own qty*. Units therefore never enter the arithmetic, which is why a 1 LOT
 *    line whose parts are 40% done reads 0.4 LOT even though its children are in Nos and Rmt.
 *
 *  - **A child's rate is derived, not typed.** `rate = (line value × shareOfLine) ÷ qty` makes
 *    `Σ leaf qty × leaf rate` come to exactly the line's value, whatever the units. That is what
 *    stops a contract total drifting because somebody broke a line down.
 *
 * Blank weights split whatever the set ones leave — by quantity when every child is in the
 * parent's unit (so 400 + 600 Cum under a 1000 Cum line simply add up), equally otherwise. They
 * are deliberately **not** renormalised: shares totalling 70% leave the group 70% covered, which
 * is a thing a caller should warn about rather than something this module should paper over.
 *
 * Generic over the scope type so a module with a closed scope union keeps it: Daily Progress wraps
 * this as `DprBreakdown` with `scope: DprScope`, and the BOQ module wraps it for its own register.
 * Both wrappers share this arithmetic rather than reimplementing it — this repo already carries
 * four divergent `civilBoqKey` implementations and four disagreeing rate readers, and a second
 * copy of *this* maths would be far harder to notice going wrong.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

/** Levels of sub-items below a BOQ line. Deep enough for real breakdowns, shallow enough to read. */
export const DEFAULT_MAX_BREAKDOWN_DEPTH = 5;

/** Tolerant number coercion: the BOQ is a spreadsheet, so "1,200" is a number. */
export function breakdownNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** "Cu.M" and "cum" are the same unit. */
export const unitKey = (unit: unknown): string =>
  String(unit ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** `2.10` sorts after `2.9`, not before it. */
export const compareSlNo = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

/** A BOQ line as the breakdown needs it. */
export interface BreakdownLine<S = string> {
  id: string;
  boqSlNo: string;
  erpSlNo?: string;
  description: string;
  unit: string;
  boqQty: number;
  /** Where the line carries one. A line with no rate gives its children a derived rate of 0. */
  rate?: number;
  scope: S;
}

/** A sub-item as stored. The parent is the BOQ line itself, or another sub-item of it. */
export interface BreakdownSubItem {
  id: string;
  /** The BOQ line this breakdown hangs from. */
  boqItemId: string;
  parentId: string;
  slNo: string;
  description: string;
  unit: string;
  qty: number;
  /** Share of the parent, in percent. null shares out whatever the set ones leave. */
  weightPct: number | null;
  /** Position among its siblings. */
  order: number;
}

export interface BreakdownNode<S = string> {
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
  scope: S;
  /** The share as set (sub-items only). */
  weightPct: number | null;
  /** The share of its parent actually used, 0–1. 1 for a BOQ line. */
  weight: number;
  /** This node's share of its BOQ line: the product of the weights on the way down. */
  shareOfLine: number;
  /**
   * The rate that makes `qty × rate` this node's share of the BOQ line's value. The line's own
   * rate for a BOQ line; 0 where the line carries no rate.
   */
  rate: number;
  childIds: string[];
  isLeaf: boolean;
  /** SL No and description of every ancestor, top first — for a row's tooltip. */
  ancestors: Array<{ slNo: string; description: string }>;
}

export interface Breakdown<S = string> {
  nodes: ReadonlyMap<string, BreakdownNode<S>>;
  /** Every node, depth first, BOQ lines in the order given and sub-items in their own order. */
  ordered: readonly BreakdownNode<S>[];
  /** What progress is planned and recorded against. */
  leaves: readonly BreakdownNode<S>[];
  /** Ids of BOQ lines that have sub-items — groups, which take no records of their own. */
  groupLineIds: ReadonlySet<string>;
  childrenOf(id: string): BreakdownNode<S>[];
  /** Every node under `id`, not including it. */
  descendantIds(id: string): string[];
  /** The leaves under `id` (itself, if it is one). */
  leavesUnder(id: string): BreakdownNode<S>[];
  /**
   * A figure per leaf (in the leaf's unit), rolled up to every node in that node's own unit:
   * a group's value is Σ child weight × (child value ÷ child qty) × the group's qty.
   */
  rollUp(perLeaf: (leafId: string) => number): Map<string, number>;
}

/**
 * Each child's share of its parent, 0–1.
 *
 * Set shares are used as given. Blank ones split what is left: by quantity when every child is in
 * the parent's unit and has a quantity (so same-unit parts simply add up), otherwise equally.
 */
export function effectiveWeights(
  parent: Pick<BreakdownNode, "unit">,
  children: readonly Pick<BreakdownSubItem, "id" | "unit" | "qty" | "weightPct">[],
): Map<string, number> {
  const weights = new Map<string, number>();
  const blank: Pick<BreakdownSubItem, "id" | "unit" | "qty" | "weightPct">[] = [];
  let taken = 0;

  for (const child of children) {
    const set =
      typeof child.weightPct === "number" &&
      Number.isFinite(child.weightPct) &&
      child.weightPct > 0;
    if (set) {
      const weight = Math.min(1, (child.weightPct as number) / 100);
      weights.set(child.id, weight);
      taken += weight;
    } else {
      blank.push(child);
    }
  }

  if (blank.length === 0) return weights;

  const left = Math.max(0, 1 - taken);
  const sameUnit = blank.every(
    (child) => unitKey(child.unit) === unitKey(parent.unit) && breakdownNumber(child.qty) > 0,
  );
  const totalQty = sameUnit
    ? blank.reduce((sum, child) => sum + breakdownNumber(child.qty), 0)
    : 0;

  for (const child of blank) {
    weights.set(
      child.id,
      sameUnit && totalQty > 0
        ? (left * breakdownNumber(child.qty)) / totalQty
        : left / blank.length,
    );
  }
  return weights;
}

export interface BuildBreakdownOptions {
  /** Levels of sub-items below a BOQ line. Deeper chains are dropped as unreadable. */
  maxDepth?: number;
}

export function buildBreakdown<S>(
  boqLines: readonly BreakdownLine<S>[],
  subItems: readonly BreakdownSubItem[],
  options: BuildBreakdownOptions = {},
): Breakdown<S> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_BREAKDOWN_DEPTH;
  const lineIds = new Set(boqLines.map((line) => line.id));
  const subById = new Map(subItems.map((sub) => [sub.id, sub]));

  // Only sub-items whose chain reaches a BOQ line on this list, within the depth limit, are real;
  // an orphan (its parent deleted elsewhere) or a loop is ignored rather than trusted.
  const depthOf = new Map<string, number>();
  const resolveDepth = (sub: BreakdownSubItem, seen: Set<string>): number => {
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
    if (depth > maxDepth) depth = -1;
    depthOf.set(sub.id, depth);
    return depth;
  };
  const valid = subItems.filter((sub) => resolveDepth(sub, new Set()) > 0);

  const childrenByParent = new Map<string, BreakdownSubItem[]>();
  for (const sub of valid) {
    const list = childrenByParent.get(sub.parentId) ?? [];
    list.push(sub);
    childrenByParent.set(sub.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort(
      (a, b) => breakdownNumber(a.order) - breakdownNumber(b.order) || compareSlNo(a.slNo, b.slNo),
    );
  }

  const nodes = new Map<string, BreakdownNode<S>>();
  const ordered: BreakdownNode<S>[] = [];

  const visit = (node: BreakdownNode<S>, lineValue: number) => {
    nodes.set(node.id, node);
    ordered.push(node);
    const children = childrenByParent.get(node.id) ?? [];
    const weights = effectiveWeights(node, children);
    for (const child of children) {
      const weight = weights.get(child.id) ?? 0;
      const shareOfLine = node.shareOfLine * weight;
      const qty = breakdownNumber(child.qty);
      visit(
        {
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
        },
        lineValue,
      );
    }
  };

  for (const line of boqLines) {
    const rate = breakdownNumber(line.rate);
    const qty = breakdownNumber(line.boqQty);
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
  const leavesUnder = (id: string): BreakdownNode<S>[] => {
    const node = nodes.get(id);
    if (!node) return [];
    return node.isLeaf ? [node] : childrenOf(id).flatMap((child) => leavesUnder(child.id));
  };

  const rollUp = (perLeaf: (leafId: string) => number): Map<string, number> => {
    const values = new Map<string, number>();
    /** Progress as a fraction of the node's own quantity. */
    const fraction = (node: BreakdownNode<S>): number => {
      if (node.isLeaf) {
        const value = breakdownNumber(perLeaf(node.id));
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

/* ── Reading the tree ───────────────────────────────────────────────────────────────────────── */

export interface TreeRow<R, S = string> {
  node: BreakdownNode<S>;
  /** The leaf's own row; null for a group. */
  row: R | null;
  /** For a group, each field rolled up from its leaves, in the group's unit. */
  rolled: Record<string, number>;
}

/**
 * Leaf rows arranged under their groups, depth first, for a table that shows the breakdown.
 * A group is shown when any leaf under it has a row; its fields are rolled up from those leaves.
 */
export function arrangeByBreakdown<R, S>(
  breakdown: Breakdown<S>,
  rows: ReadonlyMap<string, R>,
  fields: Record<string, (row: R) => number>,
): TreeRow<R, S>[] {
  const rolled: Record<string, Map<string, number>> = {};
  for (const [key, read] of Object.entries(fields)) {
    rolled[key] = breakdown.rollUp((leafId) => {
      const row = rows.get(leafId);
      return row ? read(row) : 0;
    });
  }
  const shown = (node: BreakdownNode<S>): boolean =>
    node.isLeaf
      ? rows.has(node.id)
      : breakdown.leavesUnder(node.id).some((leaf) => rows.has(leaf.id));
  return breakdown.ordered.filter(shown).map((node) => ({
    node,
    row: node.isLeaf ? (rows.get(node.id) ?? null) : null,
    rolled: node.isLeaf
      ? {}
      : Object.fromEntries(Object.keys(fields).map((key) => [key, rolled[key]!.get(node.id) ?? 0])),
  }));
}

/**
 * Fold a map keyed by leaf id into one keyed by the contract BOQ line, in the line's own unit.
 *
 * This is what lets a register that now points at sub-items still be read per BOQ line: an indent
 * for 8 of 12 earth pits becomes its share of the parent's 1 LOT. Entries whose key is not a node
 * of this breakdown are passed through unchanged — a record against a line that was never broken
 * down is already keyed by the line.
 */
export function foldLeavesToLines<S>(
  breakdown: Breakdown<S>,
  byLeaf: ReadonlyMap<string, number>,
): Map<string, number> {
  const rolled = breakdown.rollUp((leafId) => byLeaf.get(leafId) ?? 0);
  const byLine = new Map<string, number>();
  for (const line of breakdown.ordered) {
    if (line.depth !== 0) continue;
    const value = rolled.get(line.id) ?? 0;
    if (value !== 0 || byLeaf.has(line.id)) byLine.set(line.id, value);
  }
  // Anything keyed by something this breakdown does not know stays as it is, rather than being
  // dropped: silently losing a quantity is worse than reporting one we cannot place.
  for (const [key, value] of byLeaf) {
    if (!breakdown.nodes.has(key)) byLine.set(key, (byLine.get(key) ?? 0) + value);
  }
  return byLine;
}

/**
 * The next free SL No under a parent: `2.2` → `2.2.1`, then `2.2.2`.
 *
 * Gaps are not reused — a deleted `2.2.2` stays deleted, because a number that once named a
 * different sub-item should not be handed to a new one.
 */
export function nextSubItemSlNo(
  parentSlNo: string,
  siblings: ReadonlyArray<{ slNo: string }>,
): string {
  const prefix = `${String(parentSlNo ?? "").trim() || "1"}.`;
  let highest = 0;
  for (const sibling of siblings) {
    const slNo = String(sibling?.slNo ?? "").trim();
    if (!slNo.startsWith(prefix)) continue;
    const next = Number(slNo.slice(prefix.length).split(".")[0]);
    if (Number.isInteger(next) && next > highest) highest = next;
  }
  return `${prefix}${highest + 1}`;
}
