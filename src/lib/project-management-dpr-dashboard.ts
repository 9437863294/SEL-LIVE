/**
 * Daily Progress — the dashboard's readings.
 *
 * Everything here is derived from the register through the planning engine
 * (`project-management-dpr-plan.ts`): no figure is invented, and quantities in different units are
 * never added — anything shown across lines is a share of each line's own plan. Drafts are not
 * counted, as everywhere in the register; the filing calendar is the one place a draft shows, as a
 * draft.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import {
  DPR_SCOPES,
  addDays,
  daysInRange,
  dprNumber,
  eachDayInRange,
  filterDprEntries,
  parseIsoDate,
  type DprDateRange,
  type DprEntry,
  type DprScope,
} from "./project-management-dpr.ts";
import {
  buildDprBoard,
  dprCalendar,
  dprShortDate,
  isValidRange,
  type DprAchievementBasis,
  type DprBoard,
  type DprBoardItem,
  type DprBoardRow,
  type DprLineStatus,
  type DprPlan,
  type DprSettings,
} from "./project-management-dpr-plan.ts";

const tidy = (value: number): number => Math.round(value * 1e6) / 1e6;

/* ── Headline ───────────────────────────────────────────────────────────────────────────────── */

export interface DprProgressReading {
  /** The day the reading is taken: today, or the period's last day once it has ended. */
  date: string;
  /** Cumulative plan by that day, as a share of the whole period's plan. */
  plannedPct: number;
  actualPct: number;
}

/**
 * Where the period stands today on the S-curve: how much of the period plan should be done by now,
 * and how much is. null before the period starts, or when nothing is planned in it.
 */
export function dprProgressAt(board: DprBoard, today: string): DprProgressReading | null {
  if (board.curve.length === 0 || !isValidRange(board.range)) return null;
  if (today < board.range.startDate) return null;
  const date = board.range.endDate < today ? board.range.endDate : today;
  const point = board.curve.find((candidate) => candidate.date === date);
  if (!point) return null;
  return { date, plannedPct: point.plannedPct, actualPct: point.actualPct ?? 0 };
}

/* ── Lines ──────────────────────────────────────────────────────────────────────────────────── */

export interface DprLineAchievementBar {
  id: string;
  /** A short axis label: the BOQ number, else the start of the description. */
  label: string;
  description: string;
  unit: string;
  /** actual ÷ plan to date, in percent. */
  pct: number;
  status: DprLineStatus;
  planToDate: number;
  actual: number;
}

const shortLabel = (row: DprBoardRow): string => {
  const { boqSlNo, erpSlNo, description } = row.item;
  if (boqSlNo) return boqSlNo;
  if (erpSlNo) return erpSlNo;
  const text = String(description ?? "").trim();
  return text.length > 18 ? `${text.slice(0, 17)}…` : text || "BOQ line";
};

/** Lines already due, worst achievement first — the bars worth reading first. */
export function lineAchievementBars(board: DprBoard, limit = 10): DprLineAchievementBar[] {
  return board.rows
    .filter((row) => row.planToDate > 0 && row.achievementPct !== null)
    .sort(
      (a, b) =>
        (a.achievementPct ?? 0) - (b.achievementPct ?? 0) ||
        a.item.boqSlNo.localeCompare(b.item.boqSlNo, undefined, { numeric: true }),
    )
    .slice(0, limit)
    .map((row) => ({
      id: row.item.id,
      label: shortLabel(row),
      description: row.item.description,
      unit: row.item.unit,
      pct: tidy(row.achievementPct ?? 0),
      status: row.status,
      planToDate: row.planToDate,
      actual: row.actual,
    }));
}

/** Lines behind plan, furthest behind first (lowest achievement, then the largest balance). */
export function furthestBehind(board: DprBoard, limit = 5): DprBoardRow[] {
  return board.rows
    .filter((row) => row.status === "behind")
    .sort(
      (a, b) =>
        (a.achievementPct ?? 0) - (b.achievementPct ?? 0) ||
        b.planToDate - b.actual - (a.planToDate - a.actual),
    )
    .slice(0, limit);
}

/* ── Site diary per day ─────────────────────────────────────────────────────────────────────── */

export interface DprDiaryDay {
  date: string;
  label: string;
  /** Headcount across the day's counted sheets. */
  headcount: number;
  lostHours: number;
  /** Whether any counted sheet was filed for the day. */
  reported: boolean;
}

/** Headcount and lost time per day, up to today — days not yet lived have nothing to show. */
export function buildDprDiaryDays(input: {
  entries: readonly DprEntry[];
  range: DprDateRange;
  scope?: DprScope;
  today: string;
}): DprDiaryDay[] {
  const { entries, range, scope, today } = input;
  if (!isValidRange(range) || range.startDate > today) return [];
  const last = range.endDate < today ? range.endDate : today;
  const byDate = new Map<string, { headcount: number; lostHours: number }>();
  for (const entry of filterDprEntries(entries, { scope, range: { startDate: range.startDate, endDate: last } })) {
    const day = byDate.get(entry.date) ?? { headcount: 0, lostHours: 0 };
    day.headcount += (entry.manpower ?? []).reduce((sum, line) => sum + dprNumber(line?.count), 0);
    day.lostHours += dprNumber(entry.lostTimeHours);
    byDate.set(entry.date, day);
  }
  return eachDayInRange(range.startDate, last).map((date) => {
    const day = byDate.get(date);
    return {
      date,
      label: dprShortDate(date),
      headcount: tidy(day?.headcount ?? 0),
      lostHours: tidy(day?.lostHours ?? 0),
      reported: Boolean(day),
    };
  });
}

/* ── Filing calendar ────────────────────────────────────────────────────────────────────────── */

/**
 * One scope's sheet for one day: filed, still a draft, missing on a working day, not expected
 * (a non-working day, or outside the project's dates), or not yet due.
 */
export type DprFilingState = "submitted" | "draft" | "missing" | "off" | "future";

export const DPR_FILING_STATES: readonly DprFilingState[] = ["submitted", "draft", "missing", "off", "future"];

export interface DprFilingDay {
  date: string;
  /** Day of the month. */
  day: number;
  /** 0 = Monday … 6 = Sunday, the column it sits in. */
  column: number;
  isToday: boolean;
  states: Partial<Record<DprScope, DprFilingState>>;
}

export interface DprFilingCalendar {
  /** The days actually shown — the whole period, or its most recent `maxDays` when longer. */
  range: DprDateRange;
  truncated: boolean;
  scopes: DprScope[];
  /** Monday-first weeks; null pads the days before the first and after the last. */
  weeks: Array<Array<DprFilingDay | null>>;
  /** Per scope, how many shown days are in each state. */
  counts: Partial<Record<DprScope, Record<DprFilingState, number>>>;
}

const emptyCounts = (): Record<DprFilingState, number> => ({
  submitted: 0,
  draft: 0,
  missing: 0,
  off: 0,
  future: 0,
});

/** The window a long period is cut to: `maxDays` ending today (or the period's end). */
function filingWindow(range: DprDateRange, today: string, maxDays: number): DprDateRange {
  if (daysInRange(range.startDate, range.endDate) <= maxDays) return range;
  const anchor = today < range.startDate ? range.startDate : today > range.endDate ? range.endDate : today;
  let startDate = addDays(anchor, -(maxDays - 1));
  if (startDate < range.startDate) startDate = range.startDate;
  let endDate = addDays(startDate, maxDays - 1);
  if (endDate > range.endDate) endDate = range.endDate;
  return { startDate, endDate };
}

export function buildDprFilingCalendar(input: {
  entries: readonly DprEntry[];
  settings: Pick<DprSettings, "weeklyOff" | "holidays">;
  range: DprDateRange;
  scopes: readonly DprScope[];
  today: string;
  projectDates?: DprDateRange;
  maxDays?: number;
}): DprFilingCalendar {
  const { entries, settings, range, today, projectDates } = input;
  const scopes = DPR_SCOPES.filter((scope) => input.scopes.includes(scope));
  const counts: DprFilingCalendar["counts"] = Object.fromEntries(
    scopes.map((scope) => [scope, emptyCounts()]),
  );
  if (!isValidRange(range) || scopes.length === 0) {
    return { range, truncated: false, scopes, weeks: [], counts };
  }
  const shown = filingWindow(range, today, input.maxDays ?? 91);
  const calendar = dprCalendar(settings);
  // Latest status per scope and date. Drafts count here — that a draft exists is the point.
  const sheets = new Map<string, DprEntry["status"]>();
  for (const entry of entries) {
    if (!scopes.includes(entry.scope)) continue;
    const key = `${entry.scope}|${entry.date}`;
    if (sheets.get(key) !== "Submitted") sheets.set(key, entry.status);
  }

  const days: DprFilingDay[] = eachDayInRange(shown.startDate, shown.endDate).map((date) => {
    const parsed = parseIsoDate(date)!;
    const outside =
      (projectDates?.startDate && date < projectDates.startDate) ||
      (projectDates?.endDate && date > projectDates.endDate);
    const states: DprFilingDay["states"] = {};
    for (const scope of scopes) {
      const status = sheets.get(`${scope}|${date}`);
      const state: DprFilingState =
        date > today
          ? "future"
          : status === "Submitted"
            ? "submitted"
            : status === "Draft"
              ? "draft"
              : outside || !calendar.isWorkingDay(date)
                ? "off"
                : "missing";
      states[scope] = state;
      counts[scope]![state] += 1;
    }
    return {
      date,
      day: parsed.getDate(),
      column: (parsed.getDay() + 6) % 7,
      isToday: date === today,
      states,
    };
  });

  const weeks: DprFilingCalendar["weeks"] = [];
  let week: Array<DprFilingDay | null> = Array.from({ length: days[0]!.column }, () => null);
  for (const day of days) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  return { range: shown, truncated: shown.startDate !== range.startDate || shown.endDate !== range.endDate, scopes, weeks, counts };
}

/* ── Civil against Erection ─────────────────────────────────────────────────────────────────── */

export interface DprScopeSplitRow {
  scope: DprScope;
  achievementToDatePct: number | null;
  achievementFullPct: number | null;
  basis: DprAchievementBasis;
  linesDue: number;
  linesBehind: number;
  linesInPeriod: number;
}

/** Each scope read on its own board, for the scopes this project has BOQ lines in. */
export function buildDprScopeSplit(input: {
  items: readonly DprBoardItem[];
  entries: readonly DprEntry[];
  plan: DprPlan;
  settings: DprSettings;
  range: DprDateRange;
  today: string;
}): DprScopeSplitRow[] {
  const { items } = input;
  return DPR_SCOPES.filter((scope) => items.some((item) => item.scope === scope)).map((scope) => {
    const { stats } = buildDprBoard({ ...input, scope });
    return {
      scope,
      achievementToDatePct: stats.achievementToDatePct,
      achievementFullPct: stats.achievementFullPct,
      basis: stats.basis,
      linesDue: stats.linesDue,
      linesBehind: stats.linesBehind,
      linesInPeriod: stats.linesInPeriod,
    };
  });
}

/* ── Coming up ──────────────────────────────────────────────────────────────────────────────── */

export interface DprComingUpDay {
  date: string;
  label: string;
  working: boolean;
}

export interface DprComingUpRow<T extends DprBoardItem = DprBoardItem> {
  item: T;
  total: number;
  /** One quantity per day in `days`. */
  perDay: number[];
}

export interface DprComingUp<T extends DprBoardItem = DprBoardItem> {
  range: DprDateRange;
  days: DprComingUpDay[];
  rows: DprComingUpRow<T>[];
}

/** What the projections ask of each line over the next `days` days, today included. */
export function buildDprComingUp<T extends DprBoardItem>(input: {
  items: readonly T[];
  plan: DprPlan;
  settings: Pick<DprSettings, "weeklyOff" | "holidays">;
  today: string;
  scope?: DprScope;
  days?: number;
}): DprComingUp<T> {
  const { items, plan, settings, today, scope } = input;
  const count = Math.max(1, input.days ?? 7);
  const range = { startDate: today, endDate: addDays(today, count - 1) };
  const calendar = dprCalendar(settings);
  const days = eachDayInRange(range.startDate, range.endDate).map((date) => ({
    date,
    label: dprShortDate(date),
    working: calendar.isWorkingDay(date),
  }));
  const rows: DprComingUpRow<T>[] = [];
  for (const item of items) {
    if (scope && item.scope !== scope) continue;
    const perDay = days.map((day) => plan.onDate(item.id, day.date));
    const total = tidy(perDay.reduce((sum, qty) => sum + qty, 0));
    if (total > 0) rows.push({ item, total, perDay });
  }
  return { range, days, rows };
}
