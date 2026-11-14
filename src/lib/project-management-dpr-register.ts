/**
 * Daily Progress — the BOQ register's own arithmetic: which section a line sits in, the rows
 * grouped by section, which lines a "Show" choice keeps, and the leaf furthest along.
 *
 * A section is the first segment of a BOQ line's SL No ("2" for 2.1.3); a sub-item belongs to the
 * section of the BOQ line at the top of its branch. Pure — no Firebase, no React — so it is tested
 * with `node --experimental-strip-types --test`.
 */

/** "2.1.3" → "2"; a line with no SL No sits in "—". */
export function dprSectionOf(slNo: string): string {
  const head = String(slNo ?? "").trim().split(".")[0]?.trim() ?? "";
  return head || "—";
}

/** Rows grouped by section, sections in the order they first appear, rows in their own order. */
export function groupDprRegisterSections<T>(
  rows: readonly T[],
  sectionOf: (row: T) => string,
): Array<{ key: string; rows: T[] }> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = sectionOf(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, rows: list }));
}

/** The register's "Show" choices. */
export const DPR_REGISTER_SHOWS = ["all", "progress", "notStarted", "broken", "whole"] as const;
export type DprRegisterShow = (typeof DPR_REGISTER_SHOWS)[number];

/**
 * Whether a BOQ line (and so its whole branch) is shown. Decided on the line at the top of the
 * branch, so a branch is never split: `broken` = it has sub-items, `done` = work rolled up to it.
 */
export function dprRegisterShows(show: DprRegisterShow, line: { broken: boolean; done: number }): boolean {
  switch (show) {
    case "progress":
      return line.done > 1e-9;
    case "notStarted":
      return !(line.done > 1e-9);
    case "broken":
      return line.broken;
    case "whole":
      return !line.broken;
    default:
      return true;
  }
}

/** The leaf with the largest share of its own quantity done — never comparing quantities across units. */
export function dprFurthestAlong<T extends { qty: number; done: number }>(
  leaves: readonly T[],
): (T & { pct: number }) | null {
  let best: (T & { pct: number }) | null = null;
  for (const leaf of leaves) {
    if (!(leaf.qty > 0) || !(leaf.done > 0)) continue;
    const pct = (leaf.done / leaf.qty) * 100;
    if (!best || pct > best.pct) best = { ...leaf, pct };
  }
  return best;
}
