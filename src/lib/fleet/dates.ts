/**
 * Fleet dates. Everything is stored in UTC; "today", a trip's day and the report month are the
 * Asia/Kolkata calendar's. India keeps one offset all year (+05:30, no daylight saving), so the
 * conversion is a fixed shift rather than a time-zone database lookup.
 */

const IST_OFFSET_MINUTES = 330;
const MINUTE_MS = 60_000;

const pad = (value: number) => String(value).padStart(2, '0');

export const isDateKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
export const isMonthKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export const toMs = (iso: string | null | undefined): number => {
  if (!iso) return Number.NaN;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NaN;
};

/** The IST calendar date of an instant. */
export function istDateKey(iso: string | Date = new Date()): string {
  const ms = typeof iso === 'string' ? toMs(iso) : iso.getTime();
  const shifted = new Date(ms + IST_OFFSET_MINUTES * MINUTE_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export const istMonthKey = (iso: string | Date = new Date()) => istDateKey(iso).slice(0, 7);
export const monthOfDate = (dateKey: string) => dateKey.slice(0, 7);

/** The UTC instant IST midnight begins `dateKey`. */
export function istDayStartIso(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) - IST_OFFSET_MINUTES * MINUTE_MS).toISOString();
}

export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const addMinutesIso = (iso: string, minutes: number) => new Date(toMs(iso) + minutes * MINUTE_MS).toISOString();

export const minutesBetween = (fromIso: string, toIso: string) => (toMs(toIso) - toMs(fromIso)) / MINUTE_MS;

/** First and last day of a month. */
export function monthRange(monthKey: string): { from: string; to: string } {
  const [year, month] = monthKey.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${pad(last)}` };
}

export function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`;
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to && out.length < 400; day = addDays(day, 1)) out.push(day);
  return out;
}

/** "25 Oct", "25 Oct 2026" when not this year. */
export function shortDateLabel(dateKey: string, today = istDateKey()): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const name = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1] ?? '';
  return year === Number(today.slice(0, 4)) ? `${day} ${name}` : `${day} ${name} ${year}`;
}

/** "14:05" in IST. */
export function istTimeLabel(iso: string | null | undefined): string {
  const ms = toMs(iso);
  if (!Number.isFinite(ms)) return '—';
  const shifted = new Date(ms + IST_OFFSET_MINUTES * MINUTE_MS);
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const name = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1] ?? '';
  return `${name} ${year}`;
}

export function durationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) return '<1 min';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`;
}
