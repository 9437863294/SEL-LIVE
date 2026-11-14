/**
 * Daily Progress — what the six-week look-ahead says about the current week, in words.
 *
 * Read off `buildDprLookAhead`'s rows and weeks: for the week that holds today, which lines are
 * behind their plan, which are ahead, and which had work done with nothing planned for them in
 * any of the six weeks. Lines in different units are never added or compared by quantity — the
 * "worst" line is the one furthest behind as a share of its own plan.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import { dprShortDate, type DprLookAheadWeek } from "./project-management-dpr-plan.ts";

/** What these checks need of a look-ahead row: the line, and planned / done per week. */
export interface DprLookAheadCheckRow {
  item: { id: string; boqSlNo: string; unit: string };
  cells: ReadonlyArray<{ planned: number; done: number | null }>;
}

export type DprLookAheadCheckTone = "danger" | "warning" | "success";

export interface DprLookAheadCheck {
  key: string;
  tone: DprLookAheadCheckTone;
  /** The line's SL No, for the callout's chip. */
  mark: string;
  title: string;
  detail: string;
  itemId: string;
}

/** The current week's worst line: furthest behind as a share of its own plan. */
export interface DprLookAheadShortfall {
  itemId: string;
  slNo: string;
  unit: string;
  planned: number;
  done: number;
  /** 0–1: how much of the week's plan is not done. */
  shortShare: number;
}

const EPSILON = 1e-9;

/** A quantity at its unit's precision, as the screens show it. */
const qty = (value: number, decimals: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: decimals }).format(
    Math.round(value * 10 ** decimals) / 10 ** decimals,
  );

const itemLabel = (slNo: string) => (slNo ? `item ${slNo}` : "this line");

/** The six weeks' first and last day, and the week holding today (null if none does). */
export function dprLookAheadWindow(weeks: readonly DprLookAheadWeek[]): {
  startDate: string;
  endDate: string;
  current: DprLookAheadWeek | null;
} {
  return {
    startDate: weeks[0]?.startDate ?? "",
    endDate: weeks[weeks.length - 1]?.endDate ?? "",
    current: weeks.find((week) => week.isCurrent) ?? null,
  };
}

/** Every line planned in the current week, with what was done against it. */
function currentWeekLines(rows: readonly DprLookAheadCheckRow[], weeks: readonly DprLookAheadWeek[]) {
  const index = weeks.findIndex((week) => week.isCurrent);
  if (index < 0) return { index, lines: [] };
  const lines = rows.map((row) => {
    const cell = row.cells[index];
    return {
      row,
      planned: cell?.planned ?? 0,
      done: cell?.done ?? 0,
      sixWeekPlanned: row.cells.reduce((sum, candidate) => sum + (candidate.planned || 0), 0),
    };
  });
  return { index, lines };
}

/** The line furthest behind this week as a share of its plan; null when none is behind. */
export function dprLookAheadShortfall(
  rows: readonly DprLookAheadCheckRow[],
  weeks: readonly DprLookAheadWeek[],
): DprLookAheadShortfall | null {
  const { lines } = currentWeekLines(rows, weeks);
  let worst: DprLookAheadShortfall | null = null;
  for (const { row, planned, done } of lines) {
    if (!(planned > EPSILON) || done + EPSILON >= planned) continue;
    const shortShare = (planned - done) / planned;
    if (!worst || shortShare > worst.shortShare + EPSILON || (Math.abs(shortShare - worst.shortShare) <= EPSILON && planned > worst.planned)) {
      worst = { itemId: row.item.id, slNo: row.item.boqSlNo, unit: row.item.unit, planned, done, shortShare };
    }
  }
  return worst;
}

/**
 * Findings for the current week, worst first: lines behind their plan (furthest behind first),
 * lines with work done and nothing planned in any of the six weeks, then lines ahead of plan.
 */
export function buildDprLookAheadChecks(
  rows: readonly DprLookAheadCheckRow[],
  weeks: readonly DprLookAheadWeek[],
  decimalsFor: (unit: string) => number,
  options: { limit?: number } = {},
): DprLookAheadCheck[] {
  const { index, lines } = currentWeekLines(rows, weeks);
  if (index < 0) return [];
  const week = weeks[index]!;
  const weekLabel = dprShortDate(week.startDate);
  const behind: Array<DprLookAheadCheck & { order: number }> = [];
  const noPlan: Array<DprLookAheadCheck & { order: number }> = [];
  const ahead: Array<DprLookAheadCheck & { order: number }> = [];

  for (const { row, planned, done, sixWeekPlanned } of lines) {
    const { id, boqSlNo, unit } = row.item;
    const decimals = decimalsFor(unit);
    const unitText = unit ? ` ${unit}` : "";
    const base = { mark: boqSlNo || "—", itemId: id };
    if (planned > EPSILON && done + EPSILON < planned) {
      behind.push({
        ...base,
        key: `behind-${id}`,
        tone: "danger",
        title: `Behind this week on ${itemLabel(boqSlNo)}`,
        detail: `${qty(done, decimals)}${unitText} done against ${qty(planned, decimals)} planned — and ${qty(sixWeekPlanned, decimals)}${unitText} planned over the six weeks.`,
        order: (planned - done) / planned,
      });
    } else if (planned > EPSILON && done > planned + EPSILON) {
      ahead.push({
        ...base,
        key: `ahead-${id}`,
        tone: "success",
        title: `Ahead this week on ${itemLabel(boqSlNo)}`,
        detail: `${qty(done, decimals)}${unitText} done against ${qty(planned, decimals)} planned for week ${weekLabel}.`,
        order: (done - planned) / planned,
      });
    } else if (!(sixWeekPlanned > EPSILON) && done > EPSILON) {
      noPlan.push({
        ...base,
        key: `no-plan-${id}`,
        tone: "warning",
        title: `Done without a plan on ${itemLabel(boqSlNo)}`,
        detail: `${qty(done, decimals)}${unitText} done in week ${weekLabel} with no projection for any week.`,
        order: done,
      });
    }
  }

  const byOrder = (a: { order: number; mark: string }, b: { order: number; mark: string }) =>
    b.order - a.order || a.mark.localeCompare(b.mark, undefined, { numeric: true });
  return [...behind.sort(byOrder), ...noPlan.sort(byOrder), ...ahead.sort(byOrder)]
    .slice(0, options.limit ?? 6)
    .map(({ order: _order, ...check }) => check);
}
