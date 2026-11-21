/**
 * Daily Progress recording status — per scope, when the next actual is due by its recording
 * schedule (Daily Progress › Settings), the last sheet filed, and the gaps: past recording days
 * with no submitted sheet.
 *
 * Rules:
 *  - **Due.** Today is a recording day with nothing submitted: due today (a draft for today shows
 *    as a draft, not yet submitted). Otherwise the next recording day after today — none when the
 *    project's completion date comes first.
 *  - **Gaps** run from the scope's start of use — the earlier of its first projection's start and
 *    its first sheet, never before the project start — up to yesterday (and never past the project's
 *    completion). Every recording day in that span without a submitted sheet is a gap; one with only
 *    a draft is a gap too, marked as a draft. Today is never a gap: the day is not over.
 *  - A scope with neither a projection nor a sheet has **not started**: no gaps are counted, rather
 *    than every recording day since the project began.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import {
  DPR_SCOPES,
  addDays,
  eachDayInRange,
  parseIsoDate,
  type DprDateRange,
  type DprEntry,
  type DprScope,
  type DprStatus,
  type DprTarget,
} from "./project-management-dpr.ts";
import { dprCalendar, type DprSettings } from "./project-management-dpr-plan.ts";
import {
  describeDprSchedule,
  dprIsRecordingDay,
  dprScopeScheduleOf,
  type DprScopeSchedule,
} from "./project-management-dpr-schedule.ts";

export type DprDueState =
  /** Today is a recording day and nothing is filed for it. */
  | "due-today"
  /** Today is a recording day and its sheet is still a draft. */
  | "draft-today"
  /** The next recording day after today (today's sheet, if any was due, is submitted). */
  | "next"
  /** No recording day left before the project's completion date (or within reach). */
  | "none";

export interface DprRecordingGap {
  date: string;
  /** A draft exists for the day but was never submitted. */
  draft: boolean;
}

export interface DprRecordingStatusRow {
  scope: DprScope;
  schedule: DprScopeSchedule;
  /** "Every working day", "Weekly on Saturday", "Mon, Thu". */
  scheduleText: string;
  /** The scope has a projection or a sheet; until then no gaps are counted. */
  started: boolean;
  /** Where gaps are counted from; null when not started. */
  countedFrom: string | null;
  /** The latest sheet by date, of either status. */
  lastSheet: { date: string; status: DprStatus } | null;
  /** The latest submitted sheet by date. */
  lastSubmitted: string | null;
  due: { state: DprDueState; date: string | null };
  /** Today was a recording day and its sheet is submitted. */
  todayDone: boolean;
  /** Past recording days without a submitted sheet, latest first. */
  gaps: DprRecordingGap[];
}

const minDate = (dates: readonly string[]): string | null =>
  dates.reduce<string | null>((earliest, date) => (earliest === null || date < earliest ? date : earliest), null);

/**
 * When a scope started being used: the earlier of its first projection's start and its first
 * sheet's date (either status), or null when it has neither. Days before it are not gaps — the
 * recording status and the filing calendar both read it, so they never disagree.
 */
export function dprScopeFirstUse(
  scope: DprScope,
  targets: readonly Pick<DprTarget, "scope" | "startDate">[],
  entries: readonly Pick<DprEntry, "scope" | "date">[],
): string | null {
  return minDate([
    ...targets.filter((target) => target.scope === scope && parseIsoDate(target.startDate)).map((target) => target.startDate),
    ...entries.filter((entry) => entry.scope === scope && parseIsoDate(entry.date)).map((entry) => entry.date),
  ]);
}

/** Each scope's recording status as of `today`, for the scopes asked for, in the fixed scope order. */
export function buildDprRecordingStatus(input: {
  entries: readonly Pick<DprEntry, "scope" | "date" | "status">[];
  targets: readonly Pick<DprTarget, "scope" | "startDate">[];
  settings: Pick<DprSettings, "weeklyOff" | "holidays"> & Partial<Pick<DprSettings, "recordingSchedule">>;
  scopes: readonly DprScope[];
  today: string;
  projectDates?: DprDateRange;
}): DprRecordingStatusRow[] {
  const { entries, targets, settings, today, projectDates } = input;
  const calendar = dprCalendar(settings);
  const projectStart = parseIsoDate(projectDates?.startDate ?? "") ? projectDates!.startDate : "";
  const projectEnd = parseIsoDate(projectDates?.endDate ?? "") ? projectDates!.endDate : "";
  const inProject = (date: string) => (!projectStart || date >= projectStart) && (!projectEnd || date <= projectEnd);

  return DPR_SCOPES.filter((scope) => input.scopes.includes(scope)).map((scope) => {
    const schedule = dprScopeScheduleOf(settings.recordingSchedule, scope);
    const isRecordingDay = (date: string) => inProject(date) && dprIsRecordingDay(schedule, calendar, date);

    // One status per date: a submitted sheet wins over a draft for the same day.
    const sheets = new Map<string, DprStatus>();
    for (const entry of entries) {
      if (entry.scope !== scope || !parseIsoDate(entry.date)) continue;
      if (sheets.get(entry.date) !== "Submitted") sheets.set(entry.date, entry.status);
    }
    const sheetDates = [...sheets.keys()].sort();
    const lastDate = sheetDates[sheetDates.length - 1] ?? null;
    const lastSheet = lastDate ? { date: lastDate, status: sheets.get(lastDate)! } : null;
    const lastSubmitted = [...sheetDates].reverse().find((date) => sheets.get(date) === "Submitted") ?? null;

    // When the next actual is due.
    const todayStatus = sheets.get(today);
    let due: DprRecordingStatusRow["due"];
    let todayDone = false;
    if (isRecordingDay(today) && todayStatus !== "Submitted") {
      due = { state: todayStatus === "Draft" ? "draft-today" : "due-today", date: today };
    } else {
      todayDone = isRecordingDay(today) && todayStatus === "Submitted";
      // The first recording day after today — or, before the project starts, from its start.
      const tomorrow = addDays(today, 1);
      const from = projectStart && tomorrow < projectStart ? projectStart : tomorrow;
      const next = firstRecordingDayFrom(from, isRecordingDay, projectEnd);
      due = next ? { state: "next", date: next } : { state: "none", date: null };
    }

    // Gaps, from the scope's start of use to yesterday.
    const firstUse = dprScopeFirstUse(scope, targets, entries);
    const started = firstUse !== null;
    let countedFrom: string | null = null;
    const gaps: DprRecordingGap[] = [];
    if (started) {
      countedFrom = projectStart && firstUse! < projectStart ? projectStart : firstUse!;
      let until = addDays(today, -1);
      if (projectEnd && until > projectEnd) until = projectEnd;
      if (countedFrom <= until) {
        for (const date of eachDayInRange(countedFrom, until)) {
          if (!isRecordingDay(date)) continue;
          const status = sheets.get(date);
          if (status === "Submitted") continue;
          gaps.push({ date, draft: status === "Draft" });
        }
        gaps.reverse();
      }
    }

    return {
      scope,
      schedule,
      scheduleText: describeDprSchedule(schedule),
      started,
      countedFrom,
      lastSheet,
      lastSubmitted,
      due,
      todayDone,
      gaps,
    };
  });
}

/**
 * The first recording day on or after `from`, within the project; null when the project's
 * completion comes first or none is within reach (a schedule whose only days are all off).
 */
function firstRecordingDayFrom(
  from: string,
  isRecordingDay: (date: string) => boolean,
  projectEnd: string,
): string | null {
  for (let step = 0; step <= 400; step += 1) {
    const day = addDays(from, step);
    if (projectEnd && day > projectEnd) return null;
    if (isRecordingDay(day)) return day;
  }
  return null;
}
