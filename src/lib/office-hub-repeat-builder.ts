/**
 * Office Hub — the "Repeats" builder's arithmetic (2026-11-06 redesign, from the user's mockup).
 *
 * Pure and tested. The builder edits a `MeetingRecurrence` exactly as stored; everything here
 * derives what the screen shows from it: every date the rule produces (skipped ones included, so
 * they can be shown struck through), company holidays it would land on, quick end dates, and the
 * warnings worth saying before the invitations go out.
 *
 * ── Holidays ────────────────────────────────────────────────────────────────────────────────────
 *
 * The stored rule has one way to leave a date out: `exceptions`. "Skip company holidays" therefore
 * writes the holiday dates the rule lands on into `exceptions` (and takes them out again when it is
 * switched off), leaving any date the organiser skipped by hand alone. The materialiser already
 * honours `exceptions`, so a skipped holiday is never created — no new field, no new rule.
 *
 * Note what the model does with counts: an "after N meetings" series counts skipped dates towards
 * N (see `expandRecurrence`), so skipping a holiday shortens it by one. The screen says so.
 */

import { addDays, addMonths, weekdayOf, type IsoDate } from './office-hub-time.ts';
import type { MeetingRecurrence } from './office-hub-model.ts';
import { OFFICE_HUB_RECURRENCE_HORIZON_DAYS, expandRecurrence, normalizeRecurrence } from './office-hub-recurrence.ts';

export interface RepeatDate {
  date: IsoDate;
  /** Left out by an exception — by hand or for a holiday. */
  skipped: boolean;
  /** The company holiday on that date, if any. */
  holiday: string | null;
  first: boolean;
}

export interface RepeatPreview {
  dates: RepeatDate[];
  /** Meetings that will actually be created. */
  meetings: number;
  /** An open-ended series: the list is the next twelve weeks, and it carries on after. */
  openEnded: boolean;
}

/** Every date the rule produces, skipped ones included and marked. */
export function repeatPreview(
  recurrence: MeetingRecurrence,
  startDate: IsoDate,
  holidays: readonly { date: IsoDate; name: string }[] = [],
): RepeatPreview {
  const rule = normalizeRecurrence(recurrence, startDate);
  const exceptions = new Set(rule.exceptions ?? []);
  const holidayByDate = new Map(holidays.map((holiday) => [holiday.date, holiday.name]));
  const raw = expandRecurrence({ ...rule, exceptions: [] }, startDate);
  const dates = raw.map((occurrence, index) => ({
    date: occurrence.date,
    skipped: exceptions.has(occurrence.date),
    holiday: holidayByDate.get(occurrence.date) ?? null,
    first: index === 0,
  }));
  return {
    dates,
    meetings: dates.filter((entry) => !entry.skipped).length,
    openEnded: rule.frequency !== 'None' && rule.endMode === 'never',
  };
}

/** Holiday dates the rule lands on, looking as far as the last configured holiday. */
function holidayHits(rule: MeetingRecurrence, startDate: IsoDate, holidays: readonly { date: IsoDate }[]): IsoDate[] {
  if (rule.frequency === 'None' || !holidays.length) return [];
  const lastHoliday = holidays.reduce((max, holiday) => (holiday.date > max ? holiday.date : max), startDate);
  const set = new Set(holidays.map((holiday) => holiday.date));
  return expandRecurrence({ ...rule, exceptions: [] }, startDate, { until: lastHoliday })
    .map((occurrence) => occurrence.date)
    .filter((date) => set.has(date) && date !== startDate);
}

/**
 * The rule with holiday skips applied (or removed). Dates skipped by hand that are not holidays are
 * kept either way. The start date is never skipped — it is the meeting being scheduled.
 */
export function withHolidaySkips(
  recurrence: MeetingRecurrence,
  startDate: IsoDate,
  holidays: readonly { date: IsoDate }[],
  skip: boolean,
): MeetingRecurrence {
  if (recurrence.frequency === 'None') return recurrence;
  const holidaySet = new Set(holidays.map((holiday) => holiday.date));
  const manual = (recurrence.exceptions ?? []).filter((date) => !holidaySet.has(date));
  const added = skip ? holidayHits(recurrence, startDate, holidays) : [];
  const exceptions = [...new Set([...manual, ...added])].sort();
  const next: MeetingRecurrence = { ...recurrence };
  if (exceptions.length) next.exceptions = exceptions;
  else delete next.exceptions;
  return next;
}

/** Whether every holiday the rule lands on is already skipped (and there is at least one). */
export function holidaySkipsActive(recurrence: MeetingRecurrence, startDate: IsoDate, holidays: readonly { date: IsoDate }[]): boolean {
  const hits = holidayHits(recurrence, startDate, holidays);
  if (!hits.length) return false;
  const exceptions = new Set(recurrence.exceptions ?? []);
  return hits.every((date) => exceptions.has(date));
}

/** Toggle one date in or out of the exceptions. The first meeting cannot be skipped. */
export function toggleSkip(recurrence: MeetingRecurrence, startDate: IsoDate, date: IsoDate): MeetingRecurrence {
  if (date === startDate) return recurrence;
  const current = new Set(recurrence.exceptions ?? []);
  if (current.has(date)) current.delete(date);
  else current.add(date);
  const next: MeetingRecurrence = { ...recurrence };
  if (current.size) next.exceptions = [...current].sort();
  else delete next.exceptions;
  return next;
}

/**
 * Quick end dates: the end of the calendar year, the end of the Indian financial year (31 March),
 * and three and six months on. Only ones after the start are offered.
 */
export function endDatePresets(startDate: IsoDate): { label: string; date: IsoDate }[] {
  const year = Number(startDate.slice(0, 4));
  const month = Number(startDate.slice(5, 7));
  const fyEndYear = month >= 4 ? year + 1 : year;
  const presets = [
    { label: `End of Dec ${year}`, date: `${year}-12-31` },
    { label: `End of FY ${String(fyEndYear - 1).slice(2)}-${String(fyEndYear).slice(2)}`, date: `${fyEndYear}-03-31` },
    { label: '3 months', date: addDays(addMonths(startDate, 3), -1) },
    { label: '6 months', date: addDays(addMonths(startDate, 6), -1) },
  ];
  return presets.filter((preset) => preset.date > startDate);
}

export interface RepeatWarning {
  tone: 'caution' | 'info';
  text: string;
}

/** What is worth saying about a rule before the invitations go out. */
export function repeatWarnings(
  recurrence: MeetingRecurrence,
  startDate: IsoDate,
  options: { workingDays?: readonly number[]; formatDate?: (date: IsoDate) => string } = {},
): RepeatWarning[] {
  if (recurrence.frequency === 'None') return [];
  const rule = normalizeRecurrence(recurrence, startDate);
  const warnings: RepeatWarning[] = [];
  const weekly = rule.frequency === 'Weekly' || rule.frequency === 'Custom';
  if (rule.endMode === 'never') {
    warnings.push({
      tone: 'caution',
      text: `A series with no end keeps adding meetings until somebody ends it — meetings are created ${Math.round(
        OFFICE_HUB_RECURRENCE_HORIZON_DAYS / 7,
      )} weeks ahead and topped up. Old series like that fill the calendar and the register; an end date (say, the end of the financial year) is safer.`,
    });
  }
  if (weekly) {
    const workingDays = new Set(options.workingDays ?? [1, 2, 3, 4, 5, 6]);
    const offDays = (rule.weekdays ?? []).filter((day) => !workingDays.has(day));
    if (offDays.length) {
      warnings.push({ tone: 'info', text: `${offDays.length === 1 ? 'A non-working day is' : 'Non-working days are'} included. Most people won't be in the office.` });
    }
    if (!(rule.weekdays ?? []).includes(weekdayOf(startDate))) {
      warnings.push({
        tone: 'info',
        text: `The start date isn't one of the chosen days. The first meeting stays on ${options.formatDate?.(startDate) ?? startDate}; the rest follow the pattern.`,
      });
    }
  }
  if (rule.frequency === 'Monthly' && rule.monthlyMode !== 'weekday-of-month' && (rule.dayOfMonth ?? 1) > 28) {
    warnings.push({ tone: 'info', text: 'Shorter months use their last day instead.' });
  }
  return warnings;
}
