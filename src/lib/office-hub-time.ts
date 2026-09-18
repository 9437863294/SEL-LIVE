/**
 * Time-zone arithmetic for Office Hub.
 *
 * Dependency-free on purpose: this module runs in the browser, inside `node --test`, and in the
 * Admin-SDK cron route, so it may not import Firebase or any date library. `date-fns` is in the
 * project but `date-fns-tz` is not, and the one thing this module exists to do — convert a wall
 * clock reading in a named zone to a UTC instant — is exactly what plain `date-fns` cannot do.
 *
 * ── Why a meeting is stored as wall clock *plus* zone, not only as an instant ──────────────────
 *
 * A recurring meeting is "every Monday at 10:00 in Asia/Kolkata", not "every 604800 seconds from
 * this instant". Those two readings agree until a zone crosses a DST boundary, at which point the
 * instant-based reading silently moves the meeting an hour — which is §59's "always avoid timezone
 * bugs with recurring meetings". So `date` + `startTime` + `timeZone` are the source of truth, and
 * `startAt`/`endAt` are the *derived* instants, recomputed whenever any of the three change. The
 * instants exist because Firestore can only range-query and sort on them; they are a cache, and
 * `meetingInstants` below is the only thing allowed to produce them.
 *
 * Asia/Kolkata has no DST, so for the default office zone the distinction never bites. It bites for
 * a user in a zone that does, and the whole point of storing the zone is that such a user is
 * possible.
 */

/** The office default (§59). Every record that omits a zone is read as this one. */
export const OFFICE_HUB_DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** `yyyy-MM-dd`. */
export type IsoDate = string;
/** `HH:mm`, 24-hour. */
export type ClockTime = string;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject 31 February and friends by round-tripping through UTC.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isClockTime(value: unknown): value is ClockTime {
  if (typeof value !== 'string') return false;
  const match = TIME_PATTERN.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/** Minutes since midnight, or null when the input is not a clock time. */
export function clockToMinutes(value: unknown): number | null {
  if (!isClockTime(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** 615 → "10:15". Wraps within the day, so callers cannot produce "26:00". */
export function minutesToClock(totalMinutes: number): ClockTime {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** "10:15" → "10:15 AM", for display. */
export function formatClockTime(value: unknown, options: { lowercaseMeridiem?: boolean } = {}): string {
  const minutes = clockToMinutes(value);
  if (minutes == null) return '—';
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, '0')} ${
    options.lowercaseMeridiem ? meridiem.toLowerCase() : meridiem
  }`;
}

/* ── zone offsets ──────────────────────────────────────────────────────────────────────────────── */

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = offsetFormatterCache.get(timeZone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatterCache.set(timeZone, formatter);
    return formatter;
  } catch {
    // An unknown or misspelt zone. Callers fall back to the office default rather than throwing —
    // a bad zone on one record must not take down the calendar.
    return null;
  }
}

/** Whether the runtime recognises this IANA zone name. */
export function isKnownTimeZone(timeZone: string): boolean {
  return offsetFormatter(timeZone) != null;
}

/**
 * How far ahead of UTC `timeZone` is at the given instant, in minutes.
 *
 * Works by asking `Intl` to render the instant in the target zone, reading that rendering back as
 * if it were UTC, and taking the difference. That is the only way to get at the IANA database from
 * a dependency-free module, and it is correct across DST because the answer is asked *per instant*.
 */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = offsetFormatter(timeZone);
  if (!formatter) return zoneOffsetMinutes(instant, OFFICE_HUB_DEFAULT_TIME_ZONE);

  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((entry) => entry.type === type);
    return part ? Number(part.value) : 0;
  };

  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The UTC instant at which the clock in `timeZone` reads `date` `time`.
 *
 * Two passes: guess using the offset that applies at the naive instant, then re-read the offset at
 * the guessed instant and correct. That second pass is what makes the hour either side of a DST
 * transition come out right, where the offset at the naive instant is not the offset that actually
 * applies.
 *
 * Ambiguous and non-existent local times (the repeated hour when a zone falls back, the skipped
 * hour when it springs forward) resolve to the later and the shifted-forward instant respectively.
 * Both are the conventional choice, and neither can be avoided — the local time genuinely does not
 * identify one instant.
 */
export function zonedTimeToUtc(date: IsoDate, time: ClockTime, timeZone: string): Date {
  const minutes = clockToMinutes(time) ?? 0;
  const [year, month, day] = date.split('-').map(Number);
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0);

  const firstGuess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  const correctedOffset = zoneOffsetMinutes(firstGuess, timeZone);
  return new Date(naive - correctedOffset * 60_000);
}

/** The wall clock reading of `instant` in `timeZone`, as `{ date, time }`. */
export function utcToZonedParts(
  instant: Date,
  timeZone: string,
): { date: IsoDate; time: ClockTime; weekday: number } {
  const offset = zoneOffsetMinutes(instant, timeZone);
  const shifted = new Date(instant.getTime() + offset * 60_000);
  return {
    date: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
      shifted.getUTCDate(),
    ).padStart(2, '0')}`,
    time: minutesToClock(shifted.getUTCHours() * 60 + shifted.getUTCMinutes()),
    weekday: shifted.getUTCDay(),
  };
}

/** Today's date as read in `timeZone`. */
export function todayInZone(timeZone: string = OFFICE_HUB_DEFAULT_TIME_ZONE, now: Date = new Date()): IsoDate {
  return utcToZonedParts(now, timeZone).date;
}

/* ── plain date arithmetic ─────────────────────────────────────────────────────────────────────── */

/**
 * Calendar arithmetic on `yyyy-MM-dd` strings, done in UTC.
 *
 * Deliberately *not* zone-aware: "the day after 2026-03-29" is a question about the calendar, not
 * about instants, and answering it through local time is how a date shifts by a day near midnight.
 * Everything below shares that property, which is why recurrence expansion works on these and only
 * converts to instants at the very end.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoFromUtcDate(shifted);
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = date.split('-').map(Number);
  const targetMonth = month - 1 + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  // Clamp to the last day of the target month, so 31 January + 1 month is 28/29 February rather
  // than silently rolling into March.
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return isoFromUtcDate(new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay))));
}

export function addYears(date: IsoDate, years: number): IsoDate {
  return addMonths(date, years * 12);
}

function isoFromUtcDate(value: Date): IsoDate {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(
    value.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
export function weekdayOf(date: IsoDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const parse = (value: IsoDate) => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** The Monday-based start of the week containing `date`. */
export function startOfWeek(date: IsoDate, weekStartsOn = 1): IsoDate {
  const weekday = weekdayOf(date);
  const delta = (weekday - weekStartsOn + 7) % 7;
  return addDays(date, -delta);
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const [year, month] = date.split('-').map(Number);
  return isoFromUtcDate(new Date(Date.UTC(year, month, 0)));
}

/** `2026-09` — the bucket key every monthly report groups on. */
export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

/** Which occurrence of its weekday a date is within its month: 1st, 2nd … and -1 for the last. */
export function weekdayOrdinalInMonth(date: IsoDate): { ordinal: number; isLast: boolean } {
  const day = Number(date.slice(8, 10));
  const ordinal = Math.floor((day - 1) / 7) + 1;
  const lastDay = Number(endOfMonth(date).slice(8, 10));
  return { ordinal, isLast: day + 7 > lastDay };
}

/**
 * The date of the `ordinal`-th `weekday` in the month containing `date`; `ordinal` of -1 means the
 * last one. Returns null when the month has no such occurrence (a 5th Monday, usually).
 */
export function nthWeekdayOfMonth(date: IsoDate, weekday: number, ordinal: number): IsoDate | null {
  const first = startOfMonth(date);
  const lastDayOfMonth = Number(endOfMonth(date).slice(8, 10));

  if (ordinal === -1) {
    const last = endOfMonth(date);
    const delta = (weekdayOf(last) - weekday + 7) % 7;
    return addDays(last, -delta);
  }

  const delta = (weekday - weekdayOf(first) + 7) % 7;
  const day = 1 + delta + (ordinal - 1) * 7;
  return day <= lastDayOfMonth ? addDays(first, day - 1) : null;
}

/* ── display ──────────────────────────────────────────────────────────────────────────────────── */

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const OFFICE_HUB_WEEKDAYS = WEEKDAY_NAMES.map((name, index) => ({
  index,
  name,
  short: name.slice(0, 3),
}));

/** "18 Sep 2026". Built by hand so the same string renders on the server and the client. */
export function formatIsoDate(date: unknown, options: { withWeekday?: boolean; year?: boolean } = {}): string {
  if (!isIsoDate(date)) return '—';
  const [year, month, day] = date.split('-').map(Number);
  const base = `${day} ${MONTH_NAMES[month - 1]}${options.year === false ? '' : ` ${year}`}`;
  return options.withWeekday ? `${WEEKDAY_NAMES[weekdayOf(date)].slice(0, 3)}, ${base}` : base;
}

/** "18 Sep 2026, 10:00 AM – 11:00 AM". */
export function formatMeetingWhen(
  date: unknown,
  startTime: unknown,
  endTime?: unknown,
  options: { withWeekday?: boolean } = {},
): string {
  const datePart = formatIsoDate(date, { withWeekday: options.withWeekday });
  const start = formatClockTime(startTime);
  if (datePart === '—') return '—';
  if (!isClockTime(endTime)) return `${datePart}, ${start}`;
  return `${datePart}, ${start} – ${formatClockTime(endTime)}`;
}

/** "1h 30m" from a minute count. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '—';
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  if (!hours) return `${mins}m`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** "in 20 minutes" / "2 days ago", for reminder and overdue copy. */
export function formatRelativeToNow(instant: Date | null | undefined, now: Date = new Date()): string {
  if (!instant || Number.isNaN(instant.getTime())) return '—';
  const deltaMinutes = Math.round((instant.getTime() - now.getTime()) / 60_000);
  const magnitude = Math.abs(deltaMinutes);
  const future = deltaMinutes >= 0;

  const phrase = (value: number, unit: string) =>
    `${value} ${unit}${value === 1 ? '' : 's'}`;

  let body: string;
  if (magnitude < 1) return 'now';
  if (magnitude < 60) body = phrase(magnitude, 'minute');
  else if (magnitude < 1440) body = phrase(Math.round(magnitude / 60), 'hour');
  else if (magnitude < 43_200) body = phrase(Math.round(magnitude / 1440), 'day');
  else body = phrase(Math.round(magnitude / 43_200), 'month');

  return future ? `in ${body}` : `${body} ago`;
}

/** Minutes between two clock times on the same day; negative when the end precedes the start. */
export function clockSpanMinutes(startTime: unknown, endTime: unknown): number | null {
  const start = clockToMinutes(startTime);
  const end = clockToMinutes(endTime);
  if (start == null || end == null) return null;
  return end - start;
}
