/**
 * The back-dating rule for Site Account Statement transactions.
 *
 * Pure date arithmetic, deliberately free of Firebase and React so the boundary conditions — the
 * ones that decide whether a site clerk can file yesterday's bill — are exercised directly by
 * `tests/site-account-statement-date-policy.test.mjs` rather than only by clicking through a form.
 *
 * Two things gate an entry date:
 *   1. The configured window (Settings → Date Control), which an administrator tunes.
 *   2. The `Backdated Entry` permission, which lifts the window entirely for the roles that hold it.
 *
 * Both the input's `min`/`max` attributes and the submit-time check come from here, so the form
 * cannot offer a date it will then refuse — and the submit check exists because `min`/`max` on a
 * date input is a hint a determined user can walk straight past.
 *
 * Deliberately importless: a module with no imports can be loaded directly by `node --test` without
 * resolving the rest of the application, which is why the settings shape and its defaults live here
 * rather than in `site-account-statement.ts`. That file re-exports both.
 */

/**
 * How far from today a transaction may be dated.
 *
 * Site staff record expenses days after the fact — a bill surfaces late, someone was off site — so
 * back-dating cannot simply be forbidden. What it needs is a boundary: a window wide enough for
 * normal catch-up, past which the entry needs someone who is accountable for reopening a period
 * that has probably already been reported on.
 *
 * `backdateDays` counts calendar days *before* today, inclusive of today. 0 means today only.
 * `futureDays` counts days after today; 0 — the default — means money cannot be recorded as spent
 * before it has been.
 */
export interface SASDateControlSettings {
  /** Master switch. Off means no date restriction at all, which is the shipped default. */
  enabled: boolean;
  backdateDays: number;
  futureDays: number;
  applyToExpenses: boolean;
  applyToPayments: boolean;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

/**
 * Disabled out of the box.
 *
 * Same reasoning as Field Control's defaults: switching this on retroactively would start rejecting
 * entries that were perfectly acceptable yesterday, on an installation whose administrator never
 * asked for the feature. It does nothing until somebody opts in.
 */
export const DEFAULT_DATE_CONTROL: SASDateControlSettings = {
  enabled: false,
  backdateDays: 7,
  futureDays: 0,
  applyToExpenses: true,
  applyToPayments: true,
};

export type SASDatedRecord = 'expense' | 'payment';

/** Today as `YYYY-MM-DD` in the viewer's own timezone — site staff think in local dates. */
export function todayLocal(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Shifts a `YYYY-MM-DD` string by whole days, staying on calendar days across DST and year ends. */
export function shiftDays(date: string, delta: number): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  // UTC arithmetic on a date-only value: no timezone offset can nudge it onto the wrong day.
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + delta);
  return shifted.toISOString().slice(0, 10);
}

/** Normalises whatever is stored — a partial or hand-edited document — into usable settings. */
export function resolveDateControl(stored: Partial<SASDateControlSettings> | undefined | null): SASDateControlSettings {
  const clamp = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    // A negative window is meaningless and would invert the range, locking out every date.
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
  };
  return {
    enabled: stored?.enabled === true,
    backdateDays: clamp(stored?.backdateDays, DEFAULT_DATE_CONTROL.backdateDays),
    futureDays: clamp(stored?.futureDays, DEFAULT_DATE_CONTROL.futureDays),
    applyToExpenses: stored?.applyToExpenses !== false,
    applyToPayments: stored?.applyToPayments !== false,
  };
}

export interface DateWindow {
  /** Earliest allowed date, or null when unrestricted. */
  min: string | null;
  /** Latest allowed date, or null when unrestricted. */
  max: string | null;
  /** False when no restriction applies — settings off, record type excluded, or holder bypasses. */
  enforced: boolean;
}

const UNRESTRICTED: DateWindow = { min: null, max: null, enforced: false };

/** Whether the window applies to this record type at all. */
function appliesTo(settings: SASDateControlSettings, kind: SASDatedRecord): boolean {
  return kind === 'expense' ? settings.applyToExpenses : settings.applyToPayments;
}

/**
 * The date range a given user may pick for a given record type.
 *
 * `canBypass` is the `Backdated Entry` permission. It lifts the window completely rather than
 * widening it: the point of the permission is that somebody accountable can file a genuinely old
 * entry, and a second, larger limit on top of the first would just move the argument.
 */
export function resolveDateWindow({
  settings,
  kind,
  canBypass,
  today = todayLocal(),
}: {
  settings: SASDateControlSettings;
  kind: SASDatedRecord;
  canBypass: boolean;
  today?: string;
}): DateWindow {
  if (!settings.enabled || canBypass || !appliesTo(settings, kind)) return UNRESTRICTED;
  return {
    min: shiftDays(today, -settings.backdateDays),
    max: shiftDays(today, settings.futureDays),
    enforced: true,
  };
}

export interface DateCheck {
  ok: boolean;
  /** Present when `ok` is false — a message written for the person filling in the form. */
  reason?: string;
}

const KIND_LABEL: Record<SASDatedRecord, string> = {
  expense: 'Expense date',
  payment: 'Receipt date',
};

function humanDays(days: number): string {
  if (days === 0) return 'today only';
  if (days === 1) return 'today or yesterday';
  return `the last ${days} days`;
}

/**
 * Checks one date against the window.
 *
 * The rejection message names the window and says who to ask, because "invalid date" on a form that
 * accepted the same value last week is the kind of error people work around by entering a wrong
 * date rather than by asking.
 */
export function validateEntryDate({
  date,
  settings,
  kind,
  canBypass,
  today = todayLocal(),
}: {
  date: string;
  settings: SASDateControlSettings;
  kind: SASDatedRecord;
  canBypass: boolean;
  today?: string;
}): DateCheck {
  if (!date) return { ok: false, reason: `${KIND_LABEL[kind]} is required.` };

  const window = resolveDateWindow({ settings, kind, canBypass, today });
  if (!window.enforced) return { ok: true };

  if (window.min && date < window.min) {
    return {
      ok: false,
      reason: `${KIND_LABEL[kind]} cannot be earlier than ${window.min}. `
        + `Back-dating is limited to ${humanDays(settings.backdateDays)}. `
        + 'Ask an administrator for the Backdated Entry permission to record older transactions.',
    };
  }

  if (window.max && date > window.max) {
    return {
      ok: false,
      reason: settings.futureDays === 0
        ? `${KIND_LABEL[kind]} cannot be in the future.`
        : `${KIND_LABEL[kind]} cannot be more than ${settings.futureDays} day${settings.futureDays === 1 ? '' : 's'} ahead (latest ${window.max}).`,
    };
  }

  return { ok: true };
}

/** One-line summary of the active rule, for the hint under a date field. */
export function describeDateWindow(window: DateWindow, settings: SASDateControlSettings): string | null {
  if (!window.enforced) return null;
  if (settings.backdateDays === 0) return 'Today only';
  const future = settings.futureDays === 0 ? 'today' : window.max;
  return `From ${window.min} to ${future}`;
}
