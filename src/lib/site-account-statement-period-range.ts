/**
 * Month ranges for the Site Account Statement reports.
 *
 * The unit here is deliberately the **month**, not the day. Budgets in this module are set per
 * month, per FY or per project total — there is no such thing as a budget for the 7th to the 19th.
 * A day-level range would let someone ask a question the data cannot answer, and the report would
 * have to invent a denominator to show them a "% used". A month range asks only what the ledger
 * can actually say.
 *
 * Importless on purpose, like the sort registry and the date policy: `node --test` loads it
 * directly, so the boundary arithmetic — quarters, FY wrap, ranges spanning two financial years —
 * is exercised without a browser.
 *
 * Periods are `YYYY-MM` throughout, which sorts lexicographically in calendar order.
 */

/** The Indian financial year starts in April. */
const FY_START_MONTH = 4;

export type SASPeriod = string; // 'YYYY-MM'

/** Current month as `YYYY-MM`, in the viewer's own timezone. */
export function currentPeriod(now: Date = new Date()): SASPeriod {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Shifts a period by whole months, rolling the year over as needed. */
export function shiftPeriod(period: SASPeriod, delta: number): SASPeriod {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  const total = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = total % 12;
  return `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`;
}

/** How many months from `from` to `to`, inclusive. Negative when the range is inverted. */
export function periodSpan(from: SASPeriod, to: SASPeriod): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty * 12 + tm) - (fy * 12 + fm) + 1;
}

/**
 * Every month from `from` to `to` inclusive.
 *
 * Capped at 120 months. A range that wide is a mis-click rather than a question, and the report
 * builds a row per project per month — left unbounded it would lock the tab up rendering years
 * nobody asked for.
 */
export function periodsBetween(from: SASPeriod, to: SASPeriod, maxMonths = 120): SASPeriod[] {
  if (!from || !to) return [];
  const [start, end] = from <= to ? [from, to] : [to, from];
  const months: SASPeriod[] = [];
  let cursor = start;
  while (cursor <= end && months.length < maxMonths) {
    months.push(cursor);
    cursor = shiftPeriod(cursor, 1);
  }
  return months;
}

/** The FY a period belongs to, as its starting calendar year. April 2026 → 2026; March 2026 → 2025. */
export function fyStartOf(period: SASPeriod): number {
  const [year, month] = period.split('-').map(Number);
  return month >= FY_START_MONTH ? year : year - 1;
}

/** All twelve months of an FY, April first. */
export function fyPeriods(fyStart: number): SASPeriod[] {
  return Array.from({ length: 12 }, (_, i) => shiftPeriod(`${fyStart}-04`, i));
}

/** `2026-27` for FY starting 2026. */
export function fyLabelOf(fyStart: number): string {
  return `${fyStart}-${String(fyStart + 1).slice(-2)}`;
}

export interface PeriodRange {
  from: SASPeriod;
  to: SASPeriod;
}

export type SASRangePreset =
  | 'thisMonth'
  | 'lastMonth'
  | 'last3'
  | 'last6'
  | 'last12'
  | 'fyToDate'
  | 'thisFy'
  | 'lastFy'
  | 'custom';

export const RANGE_PRESETS: { key: SASRangePreset; label: string }[] = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'last3',     label: 'Last 3 months' },
  { key: 'last6',     label: 'Last 6 months' },
  { key: 'last12',    label: 'Last 12 months' },
  { key: 'fyToDate',  label: 'FY to date' },
  { key: 'thisFy',    label: 'This financial year' },
  { key: 'lastFy',    label: 'Last financial year' },
  { key: 'custom',    label: 'Custom range' },
];

/**
 * The months a preset covers.
 *
 * `custom` has no answer of its own — it means "whatever the two pickers say" — so the caller keeps
 * the existing range rather than asking here.
 */
export function resolvePreset(preset: SASRangePreset, today: SASPeriod = currentPeriod()): PeriodRange | null {
  const fy = fyStartOf(today);
  switch (preset) {
    case 'thisMonth': return { from: today, to: today };
    case 'lastMonth': {
      const previous = shiftPeriod(today, -1);
      return { from: previous, to: previous };
    }
    // Inclusive of the current month, so "last 3 months" in September means July–September.
    case 'last3':  return { from: shiftPeriod(today, -2), to: today };
    case 'last6':  return { from: shiftPeriod(today, -5), to: today };
    case 'last12': return { from: shiftPeriod(today, -11), to: today };
    case 'fyToDate': return { from: `${fy}-04`, to: today };
    case 'thisFy':   return { from: `${fy}-04`, to: `${fy + 1}-03` };
    case 'lastFy':   return { from: `${fy - 1}-04`, to: `${fy}-03` };
    case 'custom':   return null;
  }
}

/** Which preset a range corresponds to, or `custom` when it matches none. */
export function matchPreset(range: PeriodRange, today: SASPeriod = currentPeriod()): SASRangePreset {
  for (const { key } of RANGE_PRESETS) {
    if (key === 'custom') continue;
    const candidate = resolvePreset(key, today);
    if (candidate && candidate.from === range.from && candidate.to === range.to) return key;
  }
  return 'custom';
}

/**
 * Keeps a range the right way round.
 *
 * Moving `from` past `to` drags `to` with it rather than producing an empty report — an empty table
 * reads as "no data for this period", which is a different and wrong answer.
 */
export function clampRange(range: PeriodRange, moved: 'from' | 'to'): PeriodRange {
  if (range.from <= range.to) return range;
  return moved === 'from'
    ? { from: range.from, to: range.from }
    : { from: range.to, to: range.to };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Sep 2026` — short, because these appear inside dense filter bars and table headers. */
export function periodLabel(period: SASPeriod): string {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return period;
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * A range as a person would say it.
 *
 * Collapses to a single month when both ends agree, and names the financial year when the range is
 * exactly one — "FY 2026-27" carries more than "Apr 2026 – Mar 2027" to anyone reading a budget.
 */
export function describeRange(range: PeriodRange): string {
  if (range.from === range.to) return periodLabel(range.from);

  const fy = fyStartOf(range.from);
  if (range.from === `${fy}-04` && range.to === `${fy + 1}-03`) return `FY ${fyLabelOf(fy)}`;

  const months = periodSpan(range.from, range.to);
  return `${periodLabel(range.from)} – ${periodLabel(range.to)} (${months} month${months === 1 ? '' : 's'})`;
}

/**
 * The months offered in the From/To pickers.
 *
 * Spans every month the data touches, widened to include the whole of the current financial year so
 * a fresh installation still has something to pick, and padded by a year either side so a range can
 * be set before the first expense of a period is recorded.
 */
export function selectablePeriods(dataPeriods: SASPeriod[], today: SASPeriod = currentPeriod()): SASPeriod[] {
  const fy = fyStartOf(today);
  const candidates = [...dataPeriods.filter(Boolean), `${fy}-04`, `${fy + 1}-03`, today];
  const earliest = candidates.reduce((min, p) => (p < min ? p : min), candidates[0]);
  const latest = candidates.reduce((max, p) => (p > max ? p : max), candidates[0]);
  return periodsBetween(shiftPeriod(earliest, -12), shiftPeriod(latest, 12));
}
