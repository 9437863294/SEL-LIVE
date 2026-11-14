/**
 * Daily Progress — the figures behind the Reports screen that the register's plain summaries do
 * not give: a manpower report counted by day, a stable colour order for trades, and stepping a
 * period to the one before or after it.
 *
 * Manpower is counted **per date**: a trade's headcount on every counted sheet of a day (both
 * scopes, every row) is that day's strength. So "days" is the number of dates the trade was on
 * site, "peak" the largest single day, and a Civil and an Erection sheet on the same day never
 * make a trade's one day into two.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import {
  addDays,
  daysInRange,
  dprNumber,
  filterDprEntries,
  type DprDateRange,
  type DprEntry,
  type DprScope,
} from "./project-management-dpr.ts";
import type { DprCalendar } from "./project-management-dpr-plan.ts";

/* ── Manpower ───────────────────────────────────────────────────────────────────────────────── */

export interface DprManpowerTradeRow {
  trade: string;
  /** Headcount summed over the days on site. */
  manDays: number;
  /** Dates in the period the trade was on site. */
  days: number;
  /** The largest headcount on any one date. */
  peak: number;
  /** manDays ÷ days. */
  avgPerDay: number;
  /** This trade's share of every man-day in the period, 0–100. */
  sharePct: number;
}

export interface DprManpowerReport {
  /** Largest first; ties by trade name. */
  rows: DprManpowerTradeRow[];
  totalManDays: number;
  largest: DprManpowerTradeRow | null;
  /** Dates in the period with any manpower on a counted sheet, oldest first. */
  recordedDates: string[];
  /** Working days in the period, by the project calendar. */
  workingDays: number;
  /** Working days in the period up to today — the ones a sheet could already exist for. */
  workingDaysToDate: number;
  /** Working days up to today with no manpower recorded, oldest first. */
  missingDates: string[];
}

export function buildDprManpowerReport(
  entries: readonly DprEntry[],
  options: { scope?: DprScope; range: DprDateRange; calendar: DprCalendar; today: string },
): DprManpowerReport {
  const { scope, range, calendar, today } = options;
  /** trade → date → headcount that day. */
  const byTrade = new Map<string, Map<string, number>>();
  const recorded = new Set<string>();
  for (const entry of filterDprEntries(entries, { scope, range })) {
    for (const line of entry.manpower ?? []) {
      const trade = String(line?.trade ?? "").trim();
      const count = dprNumber(line?.count);
      if (!trade || !(count > 0)) continue;
      const perDay = byTrade.get(trade) ?? new Map<string, number>();
      perDay.set(entry.date, (perDay.get(entry.date) ?? 0) + count);
      byTrade.set(trade, perDay);
      recorded.add(entry.date);
    }
  }

  const totalManDays = [...byTrade.values()].reduce(
    (sum, perDay) => sum + [...perDay.values()].reduce((a, b) => a + b, 0),
    0,
  );
  const rows: DprManpowerTradeRow[] = [...byTrade.entries()]
    .map(([trade, perDay]) => {
      const counts = [...perDay.values()];
      const manDays = counts.reduce((a, b) => a + b, 0);
      return {
        trade,
        manDays,
        days: counts.length,
        peak: Math.max(...counts),
        avgPerDay: counts.length > 0 ? manDays / counts.length : 0,
        sharePct: totalManDays > 0 ? (manDays / totalManDays) * 100 : 0,
      };
    })
    .sort((a, b) => b.manDays - a.manDays || a.trade.localeCompare(b.trade));

  const working = range.startDate && range.endDate ? calendar.workingDays(range.startDate, range.endDate) : [];
  const toDate = working.filter((date) => date <= today);
  return {
    rows,
    totalManDays,
    largest: rows[0] ?? null,
    recordedDates: [...recorded].sort(),
    workingDays: working.length,
    workingDaysToDate: toDate.length,
    missingDates: toDate.filter((date) => !recorded.has(date)),
  };
}

/**
 * Dates in the period, up to today, with any work recorded — at least one line with an actual above
 * zero on a counted sheet (drafts left out, as everywhere in the reports).
 */
export function dprProgressDates(
  entries: readonly DprEntry[],
  options: { scope?: DprScope; range: DprDateRange; today: string },
): string[] {
  const dates = new Set<string>();
  for (const entry of filterDprEntries(entries, { scope: options.scope, range: options.range })) {
    if (entry.date > options.today) continue;
    if ((entry.lines ?? []).some((line) => dprNumber(line?.actualQty) > 0)) dates.add(entry.date);
  }
  return [...dates].sort();
}

/* ── A trade's colour ───────────────────────────────────────────────────────────────────────── */

/**
 * The order trades take colours in: every trade used anywhere in the register (any scope, any
 * date, drafts too), in the order of the project's configured list, then alphabetically. Read over
 * the whole register rather than the period shown, so a trade keeps its colour when the period or
 * scope changes — a colour follows the trade, never its rank.
 */
export function dprTradeOrder(entries: readonly DprEntry[], configured: readonly string[]): string[] {
  const used = new Map<string, string>();
  for (const entry of entries) {
    for (const line of entry?.manpower ?? []) {
      const trade = String(line?.trade ?? "").trim();
      if (trade && !used.has(trade.toLowerCase())) used.set(trade.toLowerCase(), trade);
    }
  }
  const position = new Map(configured.map((trade, index) => [trade.trim().toLowerCase(), index]));
  return [...used.values()].sort((a, b) => {
    const pa = position.get(a.toLowerCase()) ?? Number.POSITIVE_INFINITY;
    const pb = position.get(b.toLowerCase()) ?? Number.POSITIVE_INFINITY;
    return pa !== pb ? pa - pb : a.localeCompare(b);
  });
}

/* ── Stepping a period ──────────────────────────────────────────────────────────────────────── */

/** The range of the same length right before (−1) or after (+1) this one. */
export function shiftDprRange(range: DprDateRange, direction: -1 | 1): DprDateRange {
  const span = daysInRange(range.startDate, range.endDate);
  if (span === 0) return range;
  return {
    startDate: addDays(range.startDate, direction * span),
    endDate: addDays(range.endDate, direction * span),
  };
}

/** A date inside the neighbouring day, week or month: the day before this one starts, or after it ends. */
export const neighbourAnchor = (range: DprDateRange, direction: -1 | 1): string =>
  direction < 0 ? addDays(range.startDate, -1) : addDays(range.endDate, 1);
