/**
 * Recurring meeting expansion (§11).
 *
 * Pure and dependency-free, so the same expansion runs in the create form's preview, in the cron
 * route that materialises upcoming instances, and in `tests/office-hub-recurrence.test.mjs`.
 *
 * ── The three things this module exists to get right ────────────────────────────────────────────
 *
 *  1. **Expansion is over calendar dates, not instants.** "Every Monday at 10:00" is a statement
 *     about the local clock, so the walk below produces `yyyy-MM-dd` strings and the instants are
 *     computed per instance at the end, each with its own UTC offset. Adding 7 × 86400 seconds to
 *     an instant instead would move the meeting by an hour across a DST boundary — §59's
 *     "always avoid timezone bugs with recurring meetings", which is not a warning about a subtle
 *     edge case so much as a description of what every naive implementation does.
 *
 *  2. **Generation is idempotent.** Each instance's identity is its `occurrenceKey` — its own date
 *     within the series — so running the generator twice produces the same set, and §86's
 *     "do not create duplicate recurring meetings" holds by construction rather than by remembering
 *     to check. `pendingOccurrences` takes the keys that already exist and returns only what is
 *     missing.
 *
 *  3. **The series is bounded.** A "never ends" series is not expanded forever; it is expanded up
 *     to a horizon (`OFFICE_HUB_RECURRENCE_HORIZON_DAYS`), and the cron route extends the horizon as
 *     time passes. An unbounded expansion is how a recurrence rule turns into ten thousand
 *     documents and a Firestore bill.
 */

import {
  addDays,
  addMonths,
  addYears,
  daysBetween,
  endOfMonth,
  formatIsoDate,
  nthWeekdayOfMonth,
  startOfMonth,
  weekdayOf,
  OFFICE_HUB_WEEKDAYS,
  type IsoDate,
} from './office-hub-time.ts';
import type { MeetingRecurrence, RecurrenceFrequency } from './office-hub-model.ts';

/**
 * How far ahead an open-ended series is materialised, and the window the cron route keeps topped up.
 *
 * Twelve weeks is chosen so that a weekly series always has the next quarter visible on the
 * calendar — far enough ahead to plan against, close enough that a rule change does not leave a
 * year of stale instances to clean up.
 */
export const OFFICE_HUB_RECURRENCE_HORIZON_DAYS = 84;

/** Hard ceiling on instances produced in one expansion, whatever the rule says. */
export const OFFICE_HUB_MAX_OCCURRENCES = 260;

export interface RecurrenceOccurrence {
  /** The instance's date, and its identity within the series. */
  occurrenceKey: IsoDate;
  date: IsoDate;
  /** 1-based position in the series, counting the first instance as 1. */
  occurrenceNumber: number;
}

export const isRecurring = (recurrence: MeetingRecurrence | null | undefined): boolean =>
  Boolean(recurrence && recurrence.frequency !== 'None');

/**
 * Normalise a recurrence rule so the expander can trust it.
 *
 * Every field the chosen frequency needs is filled in from the series start date when the form left
 * it blank — a weekly rule with no weekdays means "the weekday it starts on", a monthly rule with no
 * day means "the day of the month it starts on". Doing this here rather than in the expander means
 * the stored rule is explicit, so reading a series document tells you what it does without having to
 * also know its start date.
 */
export function normalizeRecurrence(
  recurrence: Partial<MeetingRecurrence> | null | undefined,
  startDate: IsoDate,
): MeetingRecurrence {
  const frequency: RecurrenceFrequency = recurrence?.frequency ?? 'None';
  if (frequency === 'None') {
    return { frequency: 'None', interval: 1, endMode: 'never' };
  }

  const interval = Math.max(1, Math.round(recurrence?.interval ?? 1));
  const endMode = recurrence?.endMode ?? 'never';

  const normalized: MeetingRecurrence = {
    frequency,
    interval,
    endMode,
    occurrences:
      endMode === 'after-occurrences'
        ? Math.max(1, Math.min(OFFICE_HUB_MAX_OCCURRENCES, Math.round(recurrence?.occurrences ?? 10)))
        : undefined,
    endDate: endMode === 'on-date' ? recurrence?.endDate ?? undefined : undefined,
    exceptions: recurrence?.exceptions?.length ? [...new Set(recurrence.exceptions)] : undefined,
  };

  if (frequency === 'Weekly' || (frequency === 'Custom' && recurrence?.weekdays?.length)) {
    const weekdays = (recurrence?.weekdays ?? []).filter((day) => day >= 0 && day <= 6);
    normalized.weekdays = weekdays.length ? [...new Set(weekdays)].sort((a, b) => a - b) : [weekdayOf(startDate)];
  }

  if (frequency === 'Monthly') {
    const mode = recurrence?.monthlyMode ?? 'day-of-month';
    normalized.monthlyMode = mode;
    if (mode === 'day-of-month') {
      normalized.dayOfMonth = Math.min(31, Math.max(1, recurrence?.dayOfMonth ?? Number(startDate.slice(8, 10))));
    } else {
      normalized.weekday = recurrence?.weekday ?? weekdayOf(startDate);
      normalized.weekdayOrdinal = recurrence?.weekdayOrdinal ?? ordinalOfDateInMonth(startDate);
    }
  }

  if (frequency === 'Custom' && !normalized.weekdays?.length) {
    // Custom with no weekday selection is a plain "every N days" rule, which is exactly Daily with
    // an interval. Storing it as such means the expander needs no separate Custom branch.
    normalized.frequency = 'Daily';
  }

  return normalized;
}

function ordinalOfDateInMonth(date: IsoDate): number {
  const day = Number(date.slice(8, 10));
  const ordinal = Math.floor((day - 1) / 7) + 1;
  const lastDay = Number(endOfMonth(date).slice(8, 10));
  // A date in the last seven days of its month is stored as "last <weekday>" rather than "4th",
  // because "the last Friday" is what a monthly review actually means and it survives a 5-Friday
  // month, where "the 4th Friday" silently moves a week.
  return day + 7 > lastDay ? -1 : ordinal;
}

export interface ExpandRecurrenceOptions {
  /** Stop at this date, inclusive. Defaults to the horizon from the start date. */
  until?: IsoDate;
  /** Cap on how many instances to return. */
  limit?: number;
  /** Skip instances on or before this date — used to materialise only the future. */
  after?: IsoDate;
}

/**
 * Every date in the series, from `startDate` onwards.
 *
 * The first instance is always the start date itself, even when the rule would not otherwise select
 * it (a weekly Mon/Wed series starting on a Tuesday still has its first meeting on that Tuesday).
 * That is what the organizer just scheduled, and dropping it in favour of the rule would move the
 * meeting they were looking at.
 */
export function expandRecurrence(
  recurrence: MeetingRecurrence,
  startDate: IsoDate,
  options: ExpandRecurrenceOptions = {},
): RecurrenceOccurrence[] {
  const rule = normalizeRecurrence(recurrence, startDate);
  if (rule.frequency === 'None') {
    return [{ occurrenceKey: startDate, date: startDate, occurrenceNumber: 1 }];
  }

  const exceptions = new Set(rule.exceptions ?? []);
  const hardLimit = Math.min(options.limit ?? OFFICE_HUB_MAX_OCCURRENCES, OFFICE_HUB_MAX_OCCURRENCES);

  /**
   * How many dates the walk should produce, and how far it may look.
   *
   * These are two different bounds and conflating them was a bug worth naming, because it is the
   * obvious way to write this: applying the day horizon to *every* rule truncated the ones the rule
   * itself already bounds. "Monthly, 5 times" ends after five months; capping the walk at 84 days
   * gave three meetings, and "yearly, 3 times" gave one. The horizon exists to bound a series with
   * **no logical end** — it is not a second opinion about a series that stated its own.
   *
   * So: a counted series is bounded by its count, a dated series by its date, and only an
   * open-ended one by the horizon. Callers materialising into a window (the cron route) pass
   * `options.until` and get exactly that window, whatever the rule says.
   */
  const targetCount =
    rule.endMode === 'after-occurrences' && rule.occurrences
      ? Math.min(rule.occurrences, hardLimit)
      : null;

  const until =
    options.until ??
    (rule.endMode === 'on-date' && rule.endDate
      ? rule.endDate
      : targetCount
        ? // Bounded by the count instead; this only has to be far enough not to interfere, and
          // `maxDates` is what actually stops the walk.
          OPEN_ENDED_WALK_LIMIT
        : addDays(startDate, OFFICE_HUB_RECURRENCE_HORIZON_DAYS));

  const dates = generateDates(rule, startDate, until, targetCount ?? hardLimit);

  const occurrences: RecurrenceOccurrence[] = [];
  let ordinal = 0;
  for (const date of dates) {
    ordinal += 1;
    if (targetCount && ordinal > targetCount) break;
    if (exceptions.has(date)) continue;
    if (options.after && date <= options.after) continue;
    occurrences.push({ occurrenceKey: date, date, occurrenceNumber: ordinal });
    if (occurrences.length >= hardLimit) break;
  }
  return occurrences;
}

/**
 * The far edge of the calendar, for a walk bounded by a count rather than a date.
 *
 * A literal rather than `addYears(startDate, n)`: a yearly series with 260 occurrences needs 260
 * years of headroom, and picking a number of years large enough for every frequency is just this
 * date written less clearly.
 */
const OPEN_ENDED_WALK_LIMIT: IsoDate = '9999-12-31';

/**
 * The raw date walk, before exceptions are removed.
 *
 * Kept separate from `expandRecurrence` because the occurrence *number* has to count instances the
 * rule selects, including ones later removed as exceptions — otherwise cancelling the third meeting
 * of a ten-meeting series silently gives you an eleventh, since the count would never reach ten.
 *
 * `maxDates` is a hard stop on the output, so every loop below terminates on either the date bound
 * or the count, whichever comes first.
 */
function generateDates(
  rule: MeetingRecurrence,
  startDate: IsoDate,
  until: IsoDate,
  maxDates: number,
): IsoDate[] {
  const dates: IsoDate[] = [startDate];
  /** Returns false when the walk should stop: past the end date, or enough dates collected. */
  const push = (date: IsoDate): boolean => {
    if (date > until) return false;
    if (dates[dates.length - 1] !== date) dates.push(date);
    return dates.length < maxDates;
  };
  // Every loop is additionally bounded by an iteration guard, so a rule that selects nothing (a
  // monthly weekday ordinal that no month satisfies) cannot spin.
  const guardLimit = Math.max(maxDates * 2, 64);

  switch (rule.frequency) {
    case 'Daily': {
      let cursor = startDate;
      for (let guard = 0; guard < guardLimit; guard += 1) {
        cursor = addDays(cursor, rule.interval);
        if (!push(cursor)) break;
      }
      break;
    }

    case 'Weekly':
    case 'Custom': {
      const weekdays = rule.weekdays?.length ? rule.weekdays : [weekdayOf(startDate)];
      // Walk week by week from the start of the series' own week, so a Mon/Wed/Fri rule with
      // interval 2 means "those three days, every other week" rather than "every other selected
      // day" — which is what a fortnightly stand-up means and what every calendar app does.
      let weekAnchor = addDays(startDate, -weekdayOf(startDate));
      for (let week = 0; week < guardLimit; week += 1) {
        if (week > 0) weekAnchor = addDays(weekAnchor, 7 * rule.interval);
        if (weekAnchor > until) break;
        let exhausted = false;
        for (const weekday of weekdays) {
          const candidate = addDays(weekAnchor, weekday);
          if (candidate < startDate) continue;
          if (!push(candidate)) {
            exhausted = true;
            break;
          }
        }
        if (exhausted) break;
      }
      break;
    }

    case 'Monthly': {
      let cursor = startOfMonth(startDate);
      for (let month = 0; month < guardLimit; month += 1) {
        if (month > 0) cursor = addMonths(cursor, rule.interval);
        if (cursor > until) break;
        const candidate = monthlyCandidate(rule, cursor);
        // A month the rule does not satisfy (no fifth Monday) is skipped, not treated as the end of
        // the series — `continue`, so the walk carries on into the next month.
        if (!candidate || candidate < startDate) continue;
        if (!push(candidate)) break;
      }
      break;
    }

    case 'Yearly': {
      let cursor = startDate;
      for (let year = 0; year < guardLimit; year += 1) {
        cursor = addYears(cursor, rule.interval);
        if (!push(cursor)) break;
      }
      break;
    }

    default:
      break;
  }

  return [...new Set(dates)].sort();
}

function monthlyCandidate(rule: MeetingRecurrence, monthStart: IsoDate): IsoDate | null {
  if (rule.monthlyMode === 'weekday-of-month') {
    return nthWeekdayOfMonth(monthStart, rule.weekday ?? 1, rule.weekdayOrdinal ?? 1);
  }
  const lastDay = Number(endOfMonth(monthStart).slice(8, 10));
  // Clamped rather than skipped: a "31st of the month" series should meet on 28 February, not miss
  // February altogether.
  const day = Math.min(rule.dayOfMonth ?? 1, lastDay);
  return `${monthStart.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

/**
 * The occurrences that still need creating (§11's "do not create broken duplicate records").
 *
 * `existingKeys` is every `occurrenceKey` already in the database for the series. Anything the rule
 * produces that is not in that set is missing; anything in the set that the rule no longer produces
 * is *left alone* rather than deleted, because an instance may have been individually rescheduled,
 * minuted, or had tasks raised from it. Removing it would destroy records that outlive the rule.
 */
export function pendingOccurrences(
  recurrence: MeetingRecurrence,
  startDate: IsoDate,
  existingKeys: readonly string[],
  options: ExpandRecurrenceOptions = {},
): RecurrenceOccurrence[] {
  const existing = new Set(existingKeys);
  return expandRecurrence(recurrence, startDate, options).filter(
    (occurrence) => !existing.has(occurrence.occurrenceKey),
  );
}

/** The next occurrence on or after a date, for "next meeting" displays. */
export function nextOccurrenceOnOrAfter(
  recurrence: MeetingRecurrence,
  startDate: IsoDate,
  from: IsoDate,
): RecurrenceOccurrence | null {
  const horizon = addDays(from, OFFICE_HUB_RECURRENCE_HORIZON_DAYS);
  return (
    expandRecurrence(recurrence, startDate, { until: horizon }).find(
      (occurrence) => occurrence.date >= from,
    ) ?? null
  );
}

/**
 * The rule in words: "Every 2 weeks on Monday, Wednesday, until 31 Dec 2026".
 *
 * Shown on the meeting form as the user builds the rule and on the meeting page afterwards, because
 * a recurrence rule assembled from four dropdowns is very easy to get subtly wrong and almost
 * impossible to check by re-reading the dropdowns.
 */
export function describeRecurrence(
  recurrence: MeetingRecurrence | null | undefined,
  startDate?: IsoDate,
): string {
  if (!recurrence || recurrence.frequency === 'None') return 'Does not repeat';
  const rule = startDate ? normalizeRecurrence(recurrence, startDate) : recurrence;
  const every = rule.interval > 1 ? `Every ${rule.interval} ` : 'Every ';

  let body: string;
  switch (rule.frequency) {
    case 'Daily':
      body = `${every}${rule.interval > 1 ? 'days' : 'day'}`;
      break;
    case 'Weekly':
    case 'Custom': {
      const names = (rule.weekdays ?? [])
        .map((day) => OFFICE_HUB_WEEKDAYS[day]?.name)
        .filter(Boolean)
        .join(', ');
      body = `${every}${rule.interval > 1 ? 'weeks' : 'week'}${names ? ` on ${names}` : ''}`;
      break;
    }
    case 'Monthly': {
      if (rule.monthlyMode === 'weekday-of-month') {
        const ordinalWord =
          rule.weekdayOrdinal === -1
            ? 'last'
            : ['', 'first', 'second', 'third', 'fourth'][rule.weekdayOrdinal ?? 1] ?? 'first';
        const weekdayName = OFFICE_HUB_WEEKDAYS[rule.weekday ?? 1]?.name ?? 'Monday';
        body = `${every}${rule.interval > 1 ? 'months' : 'month'} on the ${ordinalWord} ${weekdayName}`;
      } else {
        body = `${every}${rule.interval > 1 ? 'months' : 'month'} on day ${rule.dayOfMonth ?? 1}`;
      }
      break;
    }
    case 'Yearly':
      body = `${every}${rule.interval > 1 ? 'years' : 'year'}`;
      break;
    default:
      body = 'Repeats';
  }

  if (rule.endMode === 'after-occurrences' && rule.occurrences) {
    return `${body}, ${rule.occurrences} times`;
  }
  if (rule.endMode === 'on-date' && rule.endDate) {
    return `${body}, until ${formatIsoDate(rule.endDate)}`;
  }
  return body;
}

/** What "edit this occurrence" vs "edit the whole series" may touch (§11). */
export type SeriesEditScope = 'occurrence' | 'series';

export interface SeriesEditPlan {
  scope: SeriesEditScope;
  /** Whether the edit changes the recurrence rule itself, which only a series edit may. */
  changesRule: boolean;
  /** Human sentence for the confirmation dialog. */
  confirmation: string;
}

/**
 * What a given edit will actually do, for the dialog that asks before it happens.
 *
 * Changing the rule from a single occurrence is refused rather than silently promoted to a series
 * edit: "edit this occurrence" and "change how often this meeting happens" are different
 * intentions, and one quietly becoming the other is how somebody rescheduling next Tuesday moves
 * every Tuesday for the next year.
 */
export function planSeriesEdit(input: {
  scope: SeriesEditScope;
  changesRule: boolean;
  instanceCount: number;
  instanceDate?: IsoDate;
}): SeriesEditPlan {
  if (input.scope === 'occurrence' && input.changesRule) {
    throw new OfficeHubRecurrenceError(
      'Changing how often a meeting repeats applies to the whole series. Choose "Edit entire series".',
    );
  }
  return {
    scope: input.scope,
    changesRule: input.changesRule,
    confirmation:
      input.scope === 'series'
        ? `This will update all ${input.instanceCount} meeting${input.instanceCount === 1 ? '' : 's'} in the series.`
        : `This will update only the meeting on ${
            input.instanceDate ? formatIsoDate(input.instanceDate) : 'this date'
          }. The rest of the series is unchanged.`,
  };
}

export class OfficeHubRecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficeHubRecurrenceError';
  }
}

/**
 * How many days of the horizon are already materialised, so the cron route can report progress and
 * an organizer can see that an open-ended series is genuinely being kept topped up.
 */
export function seriesCoverage(
  existingDates: readonly IsoDate[],
  from: IsoDate,
): { lastDate: IsoDate | null; daysCovered: number } {
  const future = [...existingDates].filter((date) => date >= from).sort();
  const lastDate = future[future.length - 1] ?? null;
  return { lastDate, daysCovered: lastDate ? daysBetween(from, lastDate) : 0 };
}
