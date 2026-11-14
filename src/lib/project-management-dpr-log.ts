/**
 * Daily Progress log — what each filed sheet says in counts, the totals over the sheets shown, and
 * the findings worth a second look.
 *
 * Quantities are never totalled across a sheet's lines — they are in different units — so a sheet
 * is summarised by counts: lines on it, lines worked, and lines that fell short of the plan snapshot
 * written onto the line when it was filed. Headcount and lost hours are the only sums, and both are
 * in one unit already.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import {
  daysInRange,
  dprNumber,
  eachDayInRange,
  type DprEntry,
  type DprScope,
} from "./project-management-dpr.ts";
import { dprShortDate, type DprCalendar } from "./project-management-dpr-plan.ts";

/* ── One sheet ──────────────────────────────────────────────────────────────────────────────── */

export interface DprLogSheetStats {
  /** Lines on the sheet. */
  lines: number;
  /** Lines with an actual above zero. */
  worked: number;
  /** Planned lines (by the snapshot on the line) whose actual fell short of it. */
  behind: number;
  /** Headcount across every manpower row. */
  manpower: number;
  lostHours: number;
}

export function dprLogSheetStats(entry: DprEntry): DprLogSheetStats {
  const lines = entry.lines ?? [];
  return {
    lines: lines.length,
    worked: lines.filter((line) => dprNumber(line?.actualQty) > 0).length,
    behind: lines.filter(
      (line) => dprNumber(line?.plannedQty) > 0 && dprNumber(line?.actualQty) < dprNumber(line?.plannedQty),
    ).length,
    manpower: (entry.manpower ?? []).reduce((sum, line) => sum + dprNumber(line?.count), 0),
    lostHours: dprNumber(entry.lostTimeHours),
  };
}

/* ── The sheets shown ───────────────────────────────────────────────────────────────────────── */

export interface DprLogSummary {
  sheets: number;
  drafts: number;
  worked: number;
  behind: number;
  manpower: number;
  lostHours: number;
  /** Sheets that lost any time. */
  lostDays: number;
}

export function summariseDprLog(entries: readonly DprEntry[]): DprLogSummary {
  const summary: DprLogSummary = { sheets: 0, drafts: 0, worked: 0, behind: 0, manpower: 0, lostHours: 0, lostDays: 0 };
  for (const entry of entries) {
    const stats = dprLogSheetStats(entry);
    summary.sheets += 1;
    if (entry.status !== "Submitted") summary.drafts += 1;
    summary.worked += stats.worked;
    summary.behind += stats.behind;
    summary.manpower += stats.manpower;
    summary.lostHours += stats.lostHours;
    if (stats.lostHours > 0) summary.lostDays += 1;
  }
  return summary;
}

/* ── Findings ───────────────────────────────────────────────────────────────────────────────── */

export type DprLogCheckTone = "danger" | "warning" | "success" | "info";

export interface DprLogCheck {
  key: string;
  tone: DprLogCheckTone;
  /** Short text for the finding's chip: the day of the month, or "i". */
  mark: string;
  title: string;
  detail: string;
  /** The dates the finding is about, oldest first. */
  dates: string[];
}

export interface DprLogCheckContext {
  calendar: DprCalendar;
  today: string;
  /** How many days back a sheet may still be filed (Daily Progress › Settings). */
  backdateDays: number;
  /** The scope the sheets were filtered to; with "All", a day with a sheet of either scope is covered. */
  scope?: DprScope | "All";
}

/** Individual findings of one kind before the rest are summed into one. */
const PER_KIND = 3;
const LIMIT = 6;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const dayMark = (isoDate: string) => String(Number(isoDate.slice(8, 10)) || "");

/** "10 Nov, 11 Nov, 13 Nov, 17 Nov and 2 more" */
const listDates = (dates: readonly string[], shown = 4) => {
  const head = dates.slice(0, shown).map(dprShortDate).join(", ");
  return dates.length > shown ? `${head} and ${dates.length - shown} more` : head;
};

/** "12 and 14 Nov" when both are in one month, else "12 Nov and 03 Dec". */
const pairText = (a: string, b: string) =>
  a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8, 10))} and ${dprShortDate(b)}` : `${dprShortDate(a)} and ${dprShortDate(b)}`;

/**
 * Findings over the sheets shown, worst first:
 *  - danger: drafts past the backdating window — only a DPR approver can now submit them;
 *  - warning: sheets with work recorded and no manpower;
 *  - info: working days between the first and last sheet shown with no sheet at all.
 */
export function buildDprLogChecks(entries: readonly DprEntry[], context: DprLogCheckContext): DprLogCheck[] {
  const { calendar, today, backdateDays } = context;
  const checks: DprLogCheck[] = [];

  const kind = (
    key: string,
    tone: DprLogCheckTone,
    found: readonly DprEntry[],
    one: (entry: DprEntry) => Omit<DprLogCheck, "key" | "tone" | "mark" | "dates">,
    rest: (count: number) => Omit<DprLogCheck, "key" | "tone" | "mark" | "dates">,
  ) => {
    const oldestFirst = [...found].sort((a, b) => a.date.localeCompare(b.date));
    oldestFirst.slice(0, PER_KIND).forEach((entry) =>
      checks.push({ key: `${key}-${entry.id}`, tone, mark: dayMark(entry.date), dates: [entry.date], ...one(entry) }),
    );
    const more = oldestFirst.slice(PER_KIND);
    if (more.length > 0) {
      checks.push({ key: `${key}-more`, tone, mark: `+${more.length}`, dates: more.map((entry) => entry.date), ...rest(more.length) });
    }
  };

  // Drafts that can no longer be submitted by the recorder: older than the backdating window.
  const stale = entries.filter(
    (entry) => entry.status !== "Submitted" && entry.date <= today && daysInRange(entry.date, today) - 1 > backdateDays,
  );
  kind(
    "stale-draft",
    "danger",
    stale,
    (entry) => ({
      title: `${dprShortDate(entry.date)}: ${entry.scope} draft never submitted`,
      detail: `It is past the ${plural(backdateDays, "day")} backdating window, so only a DPR approver can submit it now.`,
    }),
    (count) => ({
      title: `${plural(count, "more draft")} never submitted`,
      detail: `Also past the ${plural(backdateDays, "day")} backdating window.`,
    }),
  );

  const noCrew = entries.filter((entry) => {
    const stats = dprLogSheetStats(entry);
    return stats.worked > 0 && stats.manpower === 0;
  });
  kind(
    "no-manpower",
    "warning",
    noCrew,
    (entry) => {
      const worked = dprLogSheetStats(entry).worked;
      return {
        title: `${dprShortDate(entry.date)}: ${plural(worked, "line")} worked with 0 manpower`,
        detail: `Work was recorded on ${worked === 1 ? "a line" : `${worked} lines`} but no workers were entered on the ${entry.scope} sheet.`,
      };
    },
    (count) => ({
      title: `${plural(count, "more sheet")} with work and no manpower`,
      detail: "Work was recorded but no workers were entered.",
    }),
  );

  // Working days between the first and last sheet shown that have no sheet.
  const dates = [...new Set(entries.map((entry) => entry.date))].filter(Boolean).sort();
  if (dates.length >= 2) {
    const first = dates[0];
    const last = dates[dates.length - 1] < today ? dates[dates.length - 1] : today;
    const covered = new Set(dates);
    const missing = eachDayInRange(first, last).filter((date) => calendar.isWorkingDay(date) && !covered.has(date));
    if (missing.length > 0) {
      const scopeText = context.scope && context.scope !== "All" ? `${context.scope} sheet` : "sheet";
      checks.push({
        key: "missing-days",
        tone: "info",
        mark: "i",
        dates: missing,
        title: missing.length === 1 ? `No ${scopeText} for ${dprShortDate(missing[0])}` : `No ${scopeText} on ${plural(missing.length, "working day")}`,
        detail:
          missing.length === 1 && dates.length === 2
            ? `Sheets exist for ${pairText(dates[0], dates[1])} only.`
            : missing.length === 1
              ? `It is a working day between ${dprShortDate(first)} and ${dprShortDate(last)} with no sheet.`
              : `Between ${dprShortDate(first)} and ${dprShortDate(last)}: ${listDates(missing)}.`,
      });
    }
  }

  return checks.slice(0, LIMIT);
}
