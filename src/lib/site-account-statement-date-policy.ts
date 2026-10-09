/**
 * The back-dating rule for Site Account Statement transactions.
 *
 * Pure date arithmetic, deliberately free of Firebase and React so the boundary conditions — the
 * ones that decide whether a site clerk can file yesterday's bill — are exercised directly by
 * `tests/site-account-statement-date-policy.test.mjs` rather than only by clicking through a form.
 *
 * One thing gates an entry date: the configured window (Settings → Date Control). No permission
 * lifts it. An earlier version let a `Backdated Entry` role — and module administrators — skip the
 * window entirely, which made the rule a matter of who was filling in the form rather than of the
 * date being entered. Now the window is the same for everyone, and the way to allow older entries
 * is to widen it, which is visible to everyone and recorded against the settings document.
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

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True only for a real calendar date written as `YYYY-MM-DD`.
 *
 * The window is checked by comparing strings, which is correct for well-formed dates and silently
 * wrong for anything else: `2026-10-05x` sorts between the 5th and the 6th and would pass, and
 * `2026-02-30` passes too while meaning a day that does not exist. A date input never produces
 * either, but an Excel import, a pasted value or a hand-built request can.
 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  // Day 0 of the next month is the last day of this one, leap years included.
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
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
/** Ten years back and one year forward — beyond either, the window is no longer limiting anything. */
export const MAX_BACKDATE_DAYS = 3650;
export const MAX_FUTURE_DAYS = 365;

/**
 * A day count as typed into the settings form, made safe to store.
 *
 * Whole days only, never negative, never above the cap. The inputs carry `min`/`max` attributes,
 * but those are hints the browser applies loosely — `1.5`, `-3` and `99999` all reach `onChange`.
 */
export function clampDays(value: unknown, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(max, Math.max(0, Math.floor(parsed)));
}

export function resolveDateControl(stored: Partial<SASDateControlSettings> | undefined | null): SASDateControlSettings {
  const clamp = (value: unknown, fallback: number, max: number) => {
    // Only a real number is read as a setting. `Number(null)` and `Number('')` are both 0, which
    // would quietly turn a half-written document into "today only" for every site.
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
    return Math.min(max, Math.floor(value));
  };
  return {
    enabled: stored?.enabled === true,
    backdateDays: clamp(stored?.backdateDays, DEFAULT_DATE_CONTROL.backdateDays, MAX_BACKDATE_DAYS),
    futureDays: clamp(stored?.futureDays, DEFAULT_DATE_CONTROL.futureDays, MAX_FUTURE_DAYS),
    applyToExpenses: stored?.applyToExpenses !== false,
    applyToPayments: stored?.applyToPayments !== false,
  };
}

/**
 * What the submit check answers before the rules are known.
 *
 * The hook starts from defaults, and the defaults say "off". Answering from them while the real
 * settings are still on their way — or after they failed to arrive — would wave through exactly
 * the entries the window exists to stop, so the check refuses until it actually knows.
 */
export const RULES_LOADING: DateCheck = {
  ok: false,
  reason: 'The date rules are still loading. Try again in a moment.',
};

export const RULES_UNAVAILABLE: DateCheck = {
  ok: false,
  reason: 'The date rules could not be loaded, so nothing can be recorded right now. '
    + 'Refresh the page and try again.',
};

export interface DateWindow {
  /** Earliest allowed date, or null when unrestricted. */
  min: string | null;
  /** Latest allowed date, or null when unrestricted. */
  max: string | null;
  /** False only when the setting is off or excludes this record type. Never because of a role. */
  enforced: boolean;
}

const UNRESTRICTED: DateWindow = { min: null, max: null, enforced: false };

/** Whether the window applies to this record type at all. */
function appliesTo(settings: SASDateControlSettings, kind: SASDatedRecord): boolean {
  return kind === 'expense' ? settings.applyToExpenses : settings.applyToPayments;
}

/**
 * The date range anyone may pick for a given record type.
 *
 * Takes no permission, deliberately. There is no argument a caller could pass to get a wider
 * window, so the rule cannot be argued with from a form — only changed in Settings → Date Control.
 */
export function resolveDateWindow({
  settings,
  kind,
  today = todayLocal(),
}: {
  settings: SASDateControlSettings;
  kind: SASDatedRecord;
  today?: string;
}): DateWindow {
  if (!settings.enabled || !appliesTo(settings, kind)) return UNRESTRICTED;
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
 * The rejection message names the window and says what would change it, because "invalid date" on
 * a form that accepted the same value last week is the kind of error people work around by
 * entering a wrong date rather than by asking.
 *
 * The date's own validity is checked before the window, and regardless of whether the window is
 * on: a malformed date is never a legitimate entry, and the window comparison below is only sound
 * for well-formed ones.
 */
export function validateEntryDate({
  date,
  settings,
  kind,
  today = todayLocal(),
}: {
  date: string;
  settings: SASDateControlSettings;
  kind: SASDatedRecord;
  today?: string;
}): DateCheck {
  if (!date) return { ok: false, reason: `${KIND_LABEL[kind]} is required.` };
  if (!isIsoDate(date)) {
    return { ok: false, reason: `${KIND_LABEL[kind]} must be a real date in YYYY-MM-DD format.` };
  }

  const window = resolveDateWindow({ settings, kind, today });
  if (!window.enforced) return { ok: true };

  if (window.min && date < window.min) {
    return {
      ok: false,
      reason: `${KIND_LABEL[kind]} cannot be earlier than ${window.min}. `
        + `Back-dating is limited to ${humanDays(settings.backdateDays)} for everyone. `
        + 'To record an older transaction, an administrator has to widen the window in '
        + 'Settings → Date Control.',
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
