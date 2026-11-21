/**
 * Daily Progress — the recording schedule: on which days each scope is expected to file its sheet.
 *
 * Sheets stay one per scope per day (the user, 2026-11-21: "Daily sheets, on a schedule"). What the
 * schedule changes is which days a sheet is *expected* on, set per scope in each project's Daily
 * Progress › Settings:
 *
 *  - **Daily**: every working day of the project calendar — how the module has always behaved, and
 *    the default for every scope.
 *  - **Weekly**: one chosen weekday (e.g. Supply on Saturdays).
 *  - **Specific days**: chosen weekdays (e.g. Mon and Thu).
 *
 * A scheduled weekday that is not a working day (a weekly off or a holiday) is skipped: no sheet is
 * expected on it, and the next recording day's sheet covers it.
 *
 * A sheet on a weekly or specific-days scope **covers** the days since the previous recording day,
 * so its Planned is the plan over that window (a weekly Supply sheet compares with the week's plan).
 * A daily sheet, and a sheet filed on a day off the schedule, covers its own day only.
 *
 * Recording off the schedule stays allowed — the schedule says what is expected, never what is
 * refused.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 * The calendar comes in as an argument (`dprCalendar` lives in the plan module, which imports this
 * one), so there is no import cycle.
 */

import {
  DPR_SCOPES,
  addDays,
  eachDayInRange,
  parseIsoDate,
  type DprDateRange,
  type DprScope,
} from "./project-management-dpr.ts";

/* ── The setting ────────────────────────────────────────────────────────────────────────────── */

export const DPR_RECORDING_FREQUENCIES = ["daily", "weekly", "days"] as const;
export type DprRecordingFrequency = (typeof DPR_RECORDING_FREQUENCIES)[number];

export const DPR_RECORDING_FREQUENCY_LABELS: Record<DprRecordingFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  days: "Specific days",
};

export interface DprScopeSchedule {
  frequency: DprRecordingFrequency;
  /**
   * `Date.getDay()` numbers, 0 = Sunday … 6 = Saturday. Weekly: exactly one. Specific days: one or
   * more. Daily: empty (every working day).
   */
  weekdays: number[];
}

/** One schedule per scope — `DprSettings.recordingSchedule`. */
export type DprRecordingSchedule = Record<DprScope, DprScopeSchedule>;

/** A weekly scope with no weekday stored reports at the end of the site week. */
export const DPR_DEFAULT_WEEKLY_DAY = 6;

export const defaultDprScopeSchedule = (): DprScopeSchedule => ({ frequency: "daily", weekdays: [] });

/** Every scope daily: exactly the behaviour before the schedule existed. */
export const defaultDprRecordingSchedule = (): DprRecordingSchedule =>
  Object.fromEntries(DPR_SCOPES.map((scope) => [scope, defaultDprScopeSchedule()])) as DprRecordingSchedule;

const readWeekdays = (value: unknown): number[] =>
  Array.isArray(value)
    ? [...new Set(value.map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];

/** Monday-first order, the way site weeks run here (and the way `DPR_WEEKDAYS` lists them). */
const mondayFirst = (a: number, b: number): number => ((a + 6) % 7) - ((b + 6) % 7);

/**
 * Whatever is stored for one scope, as a schedule every screen can rely on: an unknown frequency
 * reads as daily; weekly keeps its first weekday (Saturday when none); specific days with none
 * chosen reads as daily, and all seven as daily too.
 */
export function sanitizeDprScopeSchedule(raw: unknown): DprScopeSchedule {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const frequency = (DPR_RECORDING_FREQUENCIES as readonly unknown[]).includes(source.frequency)
    ? (source.frequency as DprRecordingFrequency)
    : "daily";
  const weekdays = readWeekdays(source.weekdays);
  if (frequency === "weekly") return { frequency, weekdays: [weekdays[0] ?? DPR_DEFAULT_WEEKLY_DAY] };
  if (frequency === "days") {
    if (weekdays.length === 0 || weekdays.length === 7) return defaultDprScopeSchedule();
    return { frequency, weekdays: weekdays.sort(mondayFirst) };
  }
  return defaultDprScopeSchedule();
}

export function sanitizeDprRecordingSchedule(raw: unknown): DprRecordingSchedule {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(
    DPR_SCOPES.map((scope) => [scope, sanitizeDprScopeSchedule(source[scope])]),
  ) as DprRecordingSchedule;
}

/* ── Reading it against the calendar ────────────────────────────────────────────────────────── */

/** The one part of the project calendar the schedule needs. */
export interface DprWorkingDays {
  isWorkingDay(isoDate: string): boolean;
}

/** How far back or forward a recording day is looked for before giving up. */
const SEARCH_DAYS = 400;

export const dprScheduleIsDaily = (schedule: DprScopeSchedule): boolean => schedule.frequency === "daily";

/** A sheet is expected on this day: a working day, on one of the schedule's weekdays. */
export function dprIsRecordingDay(
  schedule: DprScopeSchedule,
  calendar: DprWorkingDays,
  isoDate: string,
): boolean {
  const date = parseIsoDate(isoDate);
  if (!date || !calendar.isWorkingDay(isoDate)) return false;
  return dprScheduleIsDaily(schedule) || schedule.weekdays.includes(date.getDay());
}

/** The recording days in a range, oldest first. */
export function dprRecordingDaysIn(
  schedule: DprScopeSchedule,
  calendar: DprWorkingDays,
  range: DprDateRange,
): string[] {
  if (!parseIsoDate(range.startDate) || !parseIsoDate(range.endDate) || range.startDate > range.endDate) return [];
  return eachDayInRange(range.startDate, range.endDate).filter((date) => dprIsRecordingDay(schedule, calendar, date));
}

/** The last recording day strictly before a date, or null within the search window. */
export function dprPreviousRecordingDay(
  schedule: DprScopeSchedule,
  calendar: DprWorkingDays,
  isoDate: string,
): string | null {
  if (!parseIsoDate(isoDate)) return null;
  for (let step = 1; step <= SEARCH_DAYS; step += 1) {
    const day = addDays(isoDate, -step);
    if (dprIsRecordingDay(schedule, calendar, day)) return day;
  }
  return null;
}

/** The first recording day strictly after a date, or null within the search window. */
export function dprNextRecordingDay(
  schedule: DprScopeSchedule,
  calendar: DprWorkingDays,
  isoDate: string,
): string | null {
  if (!parseIsoDate(isoDate)) return null;
  for (let step = 1; step <= SEARCH_DAYS; step += 1) {
    const day = addDays(isoDate, step);
    if (dprIsRecordingDay(schedule, calendar, day)) return day;
  }
  return null;
}

/** The latest recording day on or before a date — the sheet a site owes as of that date. */
export function dprLatestRecordingDay(
  schedule: DprScopeSchedule,
  calendar: DprWorkingDays,
  isoDate: string,
): string | null {
  if (!parseIsoDate(isoDate)) return null;
  return dprIsRecordingDay(schedule, calendar, isoDate)
    ? isoDate
    : dprPreviousRecordingDay(schedule, calendar, isoDate);
}

/**
 * The days a sheet covers: from the day after the previous recording day to the sheet's own date.
 * A daily scope, a date off the schedule, or one with no earlier recording day in reach covers its
 * own day only.
 */
export function dprSheetCover(
  schedule: DprScopeSchedule,
  calendar: DprWorkingDays,
  isoDate: string,
): DprDateRange {
  const own = { startDate: isoDate, endDate: isoDate };
  if (dprScheduleIsDaily(schedule) || !dprIsRecordingDay(schedule, calendar, isoDate)) return own;
  const previous = dprPreviousRecordingDay(schedule, calendar, isoDate);
  return previous ? { startDate: addDays(previous, 1), endDate: isoDate } : own;
}

/** Whether a cover window is more than the sheet's own day. */
export const dprCoverIsWindow = (cover: DprDateRange): boolean => cover.startDate !== cover.endDate;

/* ── Words ──────────────────────────────────────────────────────────────────────────────────── */

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "Every working day", "Weekly on Saturday", "Mon, Thu". */
export function describeDprSchedule(schedule: DprScopeSchedule): string {
  if (schedule.frequency === "weekly") return `Weekly on ${LONG_DAYS[schedule.weekdays[0] ?? DPR_DEFAULT_WEEKLY_DAY]}`;
  if (schedule.frequency === "days") return [...schedule.weekdays].sort(mondayFirst).map((day) => SHORT_DAYS[day]).join(", ");
  return "Every working day";
}

/** "weekly on Sat", "on Mon, Thu", "every working day" — to follow "recorded …" in a sentence. */
export function describeDprScheduleShort(schedule: DprScopeSchedule): string {
  if (schedule.frequency === "weekly") return `weekly on ${SHORT_DAYS[schedule.weekdays[0] ?? DPR_DEFAULT_WEEKLY_DAY]}`;
  if (schedule.frequency === "days") return `on ${describeDprSchedule(schedule)}`;
  return "every working day";
}

/**
 * The days at least one of `scopes` expects a sheet on, oldest first — what "All scopes" expects.
 * With every scope daily this is simply the working days.
 */
export function dprExpectedDaysIn(
  /** Settings built by hand (older callers, tests) may carry none: every scope is then daily. */
  schedule: DprRecordingSchedule | undefined,
  scopes: readonly DprScope[],
  calendar: DprWorkingDays,
  range: DprDateRange,
): string[] {
  if (!parseIsoDate(range.startDate) || !parseIsoDate(range.endDate) || range.startDate > range.endDate) return [];
  const chosen = scopes.length > 0 ? scopes : DPR_SCOPES;
  return eachDayInRange(range.startDate, range.endDate).filter((date) =>
    chosen.some((scope) => dprIsRecordingDay(dprScopeScheduleOf(schedule, scope), calendar, date)),
  );
}

/** One scope's schedule, daily when none is stored. */
export const dprScopeScheduleOf = (
  schedule: Partial<DprRecordingSchedule> | undefined,
  scope: DprScope,
): DprScopeSchedule => schedule?.[scope] ?? defaultDprScopeSchedule();
