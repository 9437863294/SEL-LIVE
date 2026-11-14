/**
 * Daily Progress — the BOQ progress report's headline counts and its "Worth checking" findings.
 *
 * Every finding is read straight off the period's report rows; nothing is estimated. Quantities are
 * only ever quoted line by line, in each line's own unit — never added across lines, whose units
 * differ (Cum, Nos, Lot).
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import type { DprPeriodRow } from "./project-management-dpr.ts";
import { dprShortDate } from "./project-management-dpr-plan.ts";

const EPSILON = 1e-9;

/* ── Headline counts ────────────────────────────────────────────────────────────────────────── */

export interface DprProgressSummary {
  /** Lines with work recorded in the period. */
  withProgress: DprPeriodRow[];
  /** Lines whose cumulative reaches the BOQ quantity. */
  completed: DprPeriodRow[];
  /** Lines whose actual falls short of the period plan. */
  behind: DprPeriodRow[];
  /** Lines whose actual passes the period plan. */
  ahead: DprPeriodRow[];
}

export function summariseDprProgress(rows: readonly DprPeriodRow[]): DprProgressSummary {
  return {
    withProgress: rows.filter((row) => row.actualQty > EPSILON),
    completed: rows.filter((row) => row.progressPct !== null && row.progressPct >= 100 - EPSILON),
    behind: rows.filter((row) => row.varianceQty < -EPSILON),
    ahead: rows.filter((row) => row.varianceQty > EPSILON),
  };
}

/* ── Worth checking ─────────────────────────────────────────────────────────────────────────── */

export type DprProgressCheckTone = "danger" | "warning" | "success" | "info";

export interface DprProgressCheck {
  key: string;
  tone: DprProgressCheckTone;
  title: string;
  detail: string;
  /** The lines the finding is about. */
  ids: string[];
}

export interface DprProgressCheckContext {
  /** Working days in the period, by the project calendar. */
  workingDays: number;
  /** Working days in the period up to today. */
  workingDaysToDate: number;
  /** Dates in the period (up to today) with any work recorded on a counted sheet. */
  progressDays: number;
  /** "month", "week", "day" or "period". */
  periodNoun: string;
  decimalsFor: (unit: string) => number;
}

/** How many lines a finding names before it says "and N more". */
const NAMED = 3;

const slNoOf = (row: DprPeriodRow): string =>
  row.boqSlNo || row.erpSlNo || (row.description ? row.description.slice(0, 24) : "a line");

/** "5, 2.2 and 7.4" / "5, 2.2, 7.4 and 2 more". */
const nameList = (rows: readonly DprPeriodRow[]): string => {
  const named = rows.slice(0, NAMED).map(slNoOf);
  const more = rows.length - named.length;
  if (more > 0) return `${named.join(", ")} and ${more} more`;
  if (named.length <= 1) return named.join("");
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
};

const qty = (value: number, decimals: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: decimals }).format(
    Math.round(value * 10 ** decimals) / 10 ** decimals,
  );

/** A share, to one decimal below 10% and whole above it: "0.5%", "62%". */
const share = (value: number): string =>
  `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)}%`;

/** "+12", "−48" (a true minus), "0". */
const signed = (value: number, decimals: number): string =>
  value > EPSILON ? `+${qty(value, decimals)}` : value < -EPSILON ? `−${qty(-value, decimals)}` : "0";

/** "25 times", "1.5 times". */
const times = (ratio: number): string =>
  `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: ratio < 10 ? 1 : 0 }).format(ratio)} times`;

export function buildDprProgressChecks(
  rows: readonly DprPeriodRow[],
  ctx: DprProgressCheckContext,
): DprProgressCheck[] {
  const checks: DprProgressCheck[] = [];
  const unitQty = (row: DprPeriodRow, value: number) => `${qty(value, ctx.decimalsFor(row.unit))} ${row.unit}`.trim();

  // a. Planned above the BOQ quantity — most often a projection typed in the wrong unit.
  const overPlanned = rows
    .filter((row) => row.boqQty > EPSILON && row.plannedQty > row.boqQty + EPSILON)
    .sort((a, b) => b.plannedQty / b.boqQty - a.plannedQty / a.boqQty);
  if (overPlanned.length === 1) {
    const row = overPlanned[0];
    const decimals = ctx.decimalsFor(row.unit);
    const done = row.progressPct !== null && row.progressPct >= 100 - EPSILON;
    checks.push({
      key: "planned-above-boq",
      tone: "danger",
      title: `Item ${slNoOf(row)} is planned at ${unitQty(row, row.plannedQty)} against a BOQ of ${qty(row.boqQty, decimals)}`,
      detail: `The plan is ${times(row.plannedQty / row.boqQty)} the BOQ quantity, so the variance shows ${signed(
        row.varianceQty,
        decimals,
      )}${done ? ` even though the item is ${share(row.progressPct ?? 0)} done` : ""}. The planned figure probably needs correcting.`,
      ids: [row.id],
    });
  } else if (overPlanned.length > 1) {
    checks.push({
      key: "planned-above-boq",
      tone: "danger",
      title: `Items ${nameList(overPlanned)} are planned above their BOQ quantity`,
      detail: `${overPlanned
        .slice(0, NAMED)
        .map((row) => `${slNoOf(row)}: ${unitQty(row, row.plannedQty)} planned against ${qty(row.boqQty, ctx.decimalsFor(row.unit))}`)
        .join("; ")}. The planned figures probably need correcting.`,
      ids: overPlanned.map((row) => row.id),
    });
  }

  // b. Little of the BOQ done on a line that is in the period's report.
  const lowDone = rows
    .filter((row) => row.progressPct !== null && row.progressPct < 10 && row.balanceQty > EPSILON)
    .sort((a, b) => (a.progressPct ?? 0) - (b.progressPct ?? 0));
  if (lowDone.length === 1) {
    const row = lowDone[0];
    checks.push({
      key: "little-done",
      tone: "warning",
      title: `Item ${slNoOf(row)} has only ${share(row.progressPct ?? 0)} of BOQ done`,
      detail: `${qty(row.cumulativeQty, ctx.decimalsFor(row.unit))} of ${unitQty(row, row.boqQty)} to date, with ${unitQty(
        row,
        row.balanceQty,
      )} balance.`,
      ids: [row.id],
    });
  } else if (lowDone.length > 1) {
    checks.push({
      key: "little-done",
      tone: "warning",
      title: `Items ${nameList(lowDone)} have under 10% of BOQ done`,
      detail: `${lowDone
        .slice(0, NAMED)
        .map(
          (row) =>
            `${slNoOf(row)}: ${share(row.progressPct ?? 0)} (${qty(row.cumulativeQty, ctx.decimalsFor(row.unit))} of ${unitQty(row, row.boqQty)})`,
        )
        .join("; ")}${lowDone.length > NAMED ? `; and ${lowDone.length - NAMED} more` : ""}.`,
      ids: lowDone.map((row) => row.id),
    });
  }

  // c. Worked with nothing planned — progress the plan does not track.
  const unplanned = rows.filter((row) => row.actualQty > EPSILON && row.plannedQty <= EPSILON);
  if (unplanned.length > 0) {
    const allDone = unplanned.every((row) => row.progressPct !== null && row.progressPct >= 100 - EPSILON);
    const verb = allDone ? "completed" : "worked";
    if (unplanned.length === 1) {
      const row = unplanned[0];
      const when = row.lastWorkedDate
        ? row.workedDays > 1
          ? ` over ${row.workedDays} days, last on ${dprShortDate(row.lastWorkedDate)}`
          : ` on ${dprShortDate(row.lastWorkedDate)}`
        : "";
      checks.push({
        key: "no-plan",
        tone: "success",
        title: `Item ${slNoOf(row)} ${verb} with no plan`,
        detail: `${unitQty(row, row.actualQty)} done${when} with 0 planned — add it to the plan so it is tracked.`,
        ids: [row.id],
      });
    } else {
      checks.push({
        key: "no-plan",
        tone: "success",
        title: `${unplanned.length} lines ${verb} with no plan`,
        detail: `${nameList(unplanned)} — add them to the plan so they are tracked.`,
        ids: unplanned.map((row) => row.id),
      });
    }
  }

  // d. Sparse recording: fewer days with progress than working days so far.
  if (rows.length > 0 && ctx.workingDaysToDate > 0 && ctx.progressDays < ctx.workingDaysToDate) {
    const everyLineOneDay = rows.every((row) => row.workedDays === 1);
    const title = everyLineOneDay
      ? "Each line has 1 day of progress"
      : ctx.progressDays === 0
        ? `No progress recorded on any of the ${ctx.workingDaysToDate} working days so far`
        : `Progress recorded on ${ctx.progressDays} of ${ctx.workingDaysToDate} working day${ctx.workingDaysToDate === 1 ? "" : "s"} so far`;
    checks.push({
      key: "sparse",
      tone: "info",
      title,
      detail: `${ctx.workingDays} working day${ctx.workingDays === 1 ? "" : "s"} in the ${ctx.periodNoun} — check daily entries are being made.`,
      ids: [],
    });
  }

  return checks.slice(0, 5);
}
