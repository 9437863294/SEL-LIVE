/**
 * Daily Progress — the Record progress sheet's "Worth checking" findings and each line's standing
 * against its BOQ quantity, after the user's mock-up (`sel-dpr-edit-sheet`).
 *
 * These are hints read off the sheet as it is typed. They never block anything: what stops a
 * submit is `checkDprSheet` (rules D1–D10), whose messages the screen shows on their own. Some of
 * the same facts appear in both — a line past its BOQ limit, time lost with no reason — because a
 * hint is there while typing and the check only when Submit is pressed.
 *
 * Quantities are only ever quoted line by line, in each line's own unit, never added across lines.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import { boqLimit } from "./project-management-dpr-plan.ts";

const EPSILON = 1e-9;

/** "" → null (not typed); otherwise the number, or NaN when it is not one. Commas are ignored. */
const readTyped = (value: string): number | null => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  return text === "" ? null : Number(text);
};

/** A typed quantity that is a number of zero or more, else 0. */
const typedQty = (value: string): number => {
  const parsed = readTyped(value);
  return parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const qty = (value: number, decimals: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: decimals }).format(
    Math.round(value * 10 ** decimals) / 10 ** decimals,
  );

/** "1.5 Cum", or the bare figure for a line with no unit. */
const amount = (value: number, decimals: number, unit: string): string =>
  [qty(value, decimals), unit.trim()].filter(Boolean).join(" ");

/* ── A line against its BOQ quantity ───────────────────────────────────────────────────────── */

/** Every row's actual on the sheet, added up per BOQ line (a line can sit on two rows, by location). */
export function dprSheetLineQty(
  rows: ReadonlyArray<{ boqItemId: string; actual: string }>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.boqItemId) continue;
    totals.set(row.boqItemId, (totals.get(row.boqItemId) ?? 0) + typedQty(row.actual));
  }
  return totals;
}

export interface DprSheetBoqState {
  /** Done before this sheet plus everything on it for the line. */
  total: number;
  /** Share of the BOQ quantity done before this sheet, 0–100. */
  beforePct: number;
  /** Share with today's work added. Not capped: above 100 is above the BOQ quantity. */
  withTodayPct: number;
  /** Past the BOQ quantity itself. */
  overBoq: boolean;
  /** Past the BOQ quantity plus the tolerance: the sheet cannot be submitted like this. */
  overLimit: boolean;
}

/** Where a line stands with today's work, or null when it has no BOQ quantity to measure against. */
export function dprSheetBoqState(input: {
  boqQty: number;
  doneBefore: number;
  /** Everything on this sheet for the line (`dprSheetLineQty`). */
  sheetQty: number;
  tolerancePct: number;
}): DprSheetBoqState | null {
  const { boqQty, doneBefore, sheetQty, tolerancePct } = input;
  const limit = boqLimit(boqQty, { tolerancePct });
  if (limit === null) return null;
  const total = doneBefore + sheetQty;
  return {
    total,
    beforePct: Math.min(100, Math.max(0, (doneBefore / boqQty) * 100)),
    withTodayPct: Math.max(0, (total / boqQty) * 100),
    overBoq: total > boqQty + EPSILON,
    overLimit: total > limit + EPSILON,
  };
}

/* ── Worth checking ─────────────────────────────────────────────────────────────────────────── */

export type DprSheetCheckTone = "danger" | "warning" | "info" | "success";

export interface DprSheetFinding {
  key: string;
  tone: DprSheetCheckTone;
  /** Short text for the finding's chip — the SL No it is about, or "?" — else the tone's icon. */
  mark?: string;
  title: string;
  detail: string;
}

export interface DprSheetCheckRow {
  /** "" while the row has no BOQ line chosen; such a row is left to the submit checks. */
  boqItemId: string;
  slNo: string;
  unit: string;
  /** Decimal places for the unit. */
  decimals: number;
  /** 0 when the line has no BOQ quantity. */
  boqQty: number;
  /** Planned for the day, from Projections. */
  planned: number;
  /** Submitted before this sheet, this sheet left out. */
  doneBefore: number;
  /** As typed. */
  actual: string;
  location: string;
  agency: string;
}

export interface DprSheetChecksInput {
  rows: readonly DprSheetCheckRow[];
  weather: string;
  lostTimeHours: string;
  lostTimeReason: string;
  tolerancePct: number;
}

/** How many lines one finding names before it says "and N more". */
const NAMED = 3;

/** "5, 2.2 and 7.4" / "5, 2.2, 7.4 and 2 more". */
const nameList = (names: readonly string[]): string => {
  const named = names.slice(0, NAMED);
  const more = names.length - named.length;
  if (more > 0) return `${named.join(", ")} and ${more} more`;
  if (named.length <= 1) return named.join("");
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
};

/** A long reason quoted in a title, cut to a readable length. */
const quote = (text: string, max = 40): string => {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

const lineName = (row: DprSheetCheckRow): string => row.slNo || "A line";

/**
 * What is worth a second look on the sheet as typed: work done on a line with nothing planned,
 * a line taken past its BOQ quantity, lost time and its reason out of step, and the optional
 * fields left blank. With nothing to say it says so ("Nothing to flag").
 */
export function buildDprSheetChecks(input: DprSheetChecksInput): DprSheetFinding[] {
  const { weather, lostTimeHours, lostTimeReason, tolerancePct } = input;
  const rows = input.rows.filter((row) => row.boqItemId);
  const findings: DprSheetFinding[] = [];

  // Done without a plan — allowed (a projection is a reference, not a precondition), but the plan
  // for the line may want setting.
  const unplanned = rows.filter((row) => row.planned <= EPSILON && typedQty(row.actual) > 0);
  const unplannedLines = [...new Map(unplanned.map((row) => [row.boqItemId, row])).values()];
  if (unplannedLines.length === 1) {
    const row = unplannedLines[0];
    const onSheet = unplanned
      .filter((candidate) => candidate.boqItemId === row.boqItemId)
      .reduce((sum, candidate) => sum + typedQty(candidate.actual), 0);
    const wholeBoq = row.boqQty > 0 && row.doneBefore <= EPSILON && onSheet >= row.boqQty - EPSILON;
    findings.push({
      key: "unplanned",
      tone: "danger",
      mark: row.slNo || undefined,
      title: "Done without a plan",
      detail: `${amount(onSheet, row.decimals, row.unit)} recorded on a line with no projection for the day${
        wholeBoq ? " — the whole BOQ quantity in one day" : ""
      }.`,
    });
  } else if (unplannedLines.length > 1) {
    findings.push({
      key: "unplanned",
      tone: "danger",
      mark: String(unplannedLines.length),
      title: "Done without a plan",
      detail: `${nameList(unplannedLines.map(lineName))} have work recorded but nothing projected for the day.`,
    });
  }

  // Above the BOQ quantity, line by line (a line on two rows counts once, with both rows' work).
  const sheetQty = dprSheetLineQty(rows);
  const seen = new Set<string>();
  const over: Array<{ row: DprSheetCheckRow; state: DprSheetBoqState }> = [];
  for (const row of rows) {
    if (seen.has(row.boqItemId)) continue;
    seen.add(row.boqItemId);
    const state = dprSheetBoqState({
      boqQty: row.boqQty,
      doneBefore: row.doneBefore,
      sheetQty: sheetQty.get(row.boqItemId) ?? 0,
      tolerancePct,
    });
    if (state?.overBoq) over.push({ row, state });
  }
  const toleranceText = tolerancePct > 0 ? ` plus the ${tolerancePct}% tolerance` : "";
  if (over.length > 0 && over.length <= NAMED) {
    for (const { row, state } of over) {
      findings.push({
        key: `over-${row.boqItemId}`,
        tone: state.overLimit ? "danger" : "warning",
        mark: row.slNo || undefined,
        title: "Above BOQ quantity",
        detail: `${lineName(row)}: ${qty(state.total, row.decimals)} against a BOQ of ${amount(row.boqQty, row.decimals, row.unit)}${
          state.overLimit
            ? ` — past the BOQ quantity${toleranceText}, so the sheet cannot be submitted.`
            : `, within the ${tolerancePct}% tolerance.`
        }`,
      });
    }
  } else if (over.length > NAMED) {
    const blocking = over.some(({ state }) => state.overLimit);
    findings.push({
      key: "over",
      tone: blocking ? "danger" : "warning",
      mark: String(over.length),
      title: "Above BOQ quantity",
      detail: `${nameList(over.map(({ row }) => lineName(row)))} would pass their BOQ quantity${
        blocking ? `; past the BOQ${toleranceText}, the sheet cannot be submitted.` : ", within the tolerance."
      }`,
    });
  }

  // Lost time and its reason.
  const lostTyped = readTyped(lostTimeHours);
  const lost = lostTyped !== null && Number.isFinite(lostTyped) ? lostTyped : null;
  const reason = lostTimeReason.trim();
  if (reason && (lost === null || lost <= 0)) {
    findings.push({
      key: "reason-no-time",
      tone: "warning",
      mark: "?",
      title: `Reason “${quote(reason)}” with no time lost`,
      detail: `Time lost is ${lost === null ? "blank" : "0"}, so the reason may not be needed — or the hours are missing.`,
    });
  }
  if (lost !== null && lost > 0 && !reason) {
    findings.push({
      key: "time-no-reason",
      tone: "warning",
      mark: "?",
      title: "Time lost without a reason",
      detail: `${qty(lost, 2)} hr${lost === 1 ? "" : "s"} lost — add the reason; the sheet cannot be submitted without it.`,
    });
  }

  // The optional fields left blank.
  const blanks: string[] = [];
  if (!weather.trim()) blanks.push("weather");
  const noLocation = rows.filter((row) => !row.location.trim()).length;
  const noAgency = rows.filter((row) => !row.agency.trim()).length;
  const of = (count: number) => (rows.length === 1 ? "" : ` on ${count} of ${rows.length} lines`);
  if (noLocation > 0) blanks.push(`location${of(noLocation)}`);
  if (noAgency > 0) blanks.push(`agency${of(noAgency)}`);
  if (blanks.length > 0) {
    const names = [!weather.trim() && "Weather", noLocation > 0 && "location", noAgency > 0 && "agency"].filter(
      (name): name is string => Boolean(name),
    );
    const title = `${nameList(names)} not recorded`;
    findings.push({
      key: "blanks",
      tone: "info",
      title: title.charAt(0).toUpperCase() + title.slice(1),
      detail: `Left blank: ${blanks.join("; ")}. Optional, but it backs a delay or a hindrance later.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      key: "clear",
      tone: "success",
      title: "Nothing to flag",
      detail: "This sheet looks complete.",
    });
  }
  return findings;
}
