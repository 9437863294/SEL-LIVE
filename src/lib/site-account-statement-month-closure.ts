/**
 * Month closure — freezing an accounting period once it has been reported on.
 *
 * Date Control answers "how late may this be filed?" with a rolling window measured in days. That
 * is the right question while a month is still live, and the wrong one afterwards: the moment
 * September's figures have been sent to Head Office, no amount of "within seven days" makes it
 * acceptable for a September expense to appear and quietly change a number somebody has already
 * acted on. What is needed then is a hard boundary on the period itself.
 *
 * So a closed month rejects any expense or receipt dated inside it — new, edited, moved into it, or
 * deleted out of it — regardless of how recent today is. Reopening is a deliberate act that
 * requires a reason and leaves a record, because the whole value of the lock is that crossing it is
 * visible.
 *
 * Importless on purpose, like the module's other domain files: `node --test` loads this directly,
 * so the rules that decide whether a site can still record work are exercised without Firestore or
 * a browser. It deliberately does not know how to enumerate a financial year — callers pass the
 * periods in, from `site-account-statement-period-range.ts`, so there is one definition of what a
 * financial year is rather than two that can drift.
 */

/** A period key, `YYYY-MM`. */
export type SASPeriodKey = string;

/**
 * The closure record for one month.
 *
 * Reopening does not erase the previous closure, it supersedes it: `reopenedAt` and `reopenReason`
 * sit alongside `closedAt`, so a month that was closed, reopened and closed again still shows what
 * happened rather than only where it ended up.
 */
export interface SASMonthClosure {
  period: SASPeriodKey;
  closed: boolean;
  closedAt?: unknown;
  closedBy?: string;
  closedByName?: string;
  /** Optional note recorded when closing — "reported to HO on the 5th". */
  note?: string;
  reopenedAt?: unknown;
  reopenedBy?: string;
  reopenedByName?: string;
  /** Required when reopening. The reason the period had to be unlocked. */
  reopenReason?: string;
}

/** The stored document: one map of period → closure, under a single settings document. */
export interface SASMonthClosureSettings {
  months: Record<SASPeriodKey, SASMonthClosure>;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export const EMPTY_MONTH_CLOSURE: SASMonthClosureSettings = { months: {} };

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriodKey(value: unknown): value is SASPeriodKey {
  return typeof value === 'string' && PERIOD_RE.test(value);
}

/**
 * Normalises whatever is stored into a usable map.
 *
 * Anything malformed is dropped rather than repaired. A half-understood entry in this document
 * would either lock a month nobody closed or, worse, silently unlock one somebody did; discarding
 * it leaves the month open, which is the state the rest of the system already copes with.
 */
export function resolveMonthClosure(
  stored: Partial<SASMonthClosureSettings> | undefined | null,
): SASMonthClosureSettings {
  const months: Record<SASPeriodKey, SASMonthClosure> = {};
  const raw = stored?.months;
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (!isPeriodKey(key) || !value || typeof value !== 'object') continue;
      const entry = value as Partial<SASMonthClosure>;
      months[key] = {
        period: key,
        closed: entry.closed === true,
        closedAt: entry.closedAt,
        closedBy: typeof entry.closedBy === 'string' ? entry.closedBy : undefined,
        closedByName: typeof entry.closedByName === 'string' ? entry.closedByName : undefined,
        note: typeof entry.note === 'string' ? entry.note : undefined,
        reopenedAt: entry.reopenedAt,
        reopenedBy: typeof entry.reopenedBy === 'string' ? entry.reopenedBy : undefined,
        reopenedByName: typeof entry.reopenedByName === 'string' ? entry.reopenedByName : undefined,
        reopenReason: typeof entry.reopenReason === 'string' ? entry.reopenReason : undefined,
      };
    }
  }
  return { months };
}

export function closureFor(
  settings: SASMonthClosureSettings,
  period: SASPeriodKey,
): SASMonthClosure | null {
  return settings.months[period] ?? null;
}

export function isMonthClosed(settings: SASMonthClosureSettings, period: SASPeriodKey): boolean {
  return settings.months[period]?.closed === true;
}

/** Every closed period, oldest first. */
export function closedPeriods(settings: SASMonthClosureSettings): SASPeriodKey[] {
  return Object.values(settings.months)
    .filter(m => m.closed)
    .map(m => m.period)
    .sort();
}

/**
 * The newest closed month.
 *
 * Useful as a floor: everything up to here is settled, so a form can start a new entry after it
 * rather than offering a date it will refuse.
 */
export function latestClosedPeriod(settings: SASMonthClosureSettings): SASPeriodKey | null {
  const all = closedPeriods(settings);
  return all.length ? all[all.length - 1] : null;
}

export type MonthState = 'closed' | 'current' | 'open' | 'future';

/**
 * How a month should be presented.
 *
 * `current` and `future` are distinguished from plain `open` because they are not the same
 * proposition: the current month is still being worked in, and a future one holds nothing to
 * settle. Closing either is almost always a mis-click, which `canClosePeriod` refuses.
 */
export function monthState(
  period: SASPeriodKey,
  settings: SASMonthClosureSettings,
  currentPeriodKey: SASPeriodKey,
): MonthState {
  if (isMonthClosed(settings, period)) return 'closed';
  if (period === currentPeriodKey) return 'current';
  return period > currentPeriodKey ? 'future' : 'open';
}

export interface ClosureCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Whether a month may be closed.
 *
 * A month still in progress has entries yet to be made, and a future month has nothing in it at
 * all — closing either would block ordinary work for no benefit, and the person doing it would
 * discover the mistake only when a site clerk could not file today's bill.
 */
export function canClosePeriod(
  period: SASPeriodKey,
  settings: SASMonthClosureSettings,
  currentPeriodKey: SASPeriodKey,
): ClosureCheck {
  if (!isPeriodKey(period)) return { ok: false, reason: 'Not a valid month.' };
  if (isMonthClosed(settings, period)) return { ok: false, reason: 'This month is already closed.' };
  if (period === currentPeriodKey) {
    return { ok: false, reason: 'The current month is still in progress. Close it once it has ended.' };
  }
  if (period > currentPeriodKey) {
    return { ok: false, reason: 'A future month cannot be closed — there is nothing in it yet.' };
  }
  return { ok: true };
}

export function canReopenPeriod(
  period: SASPeriodKey,
  settings: SASMonthClosureSettings,
): ClosureCheck {
  if (!isMonthClosed(settings, period)) return { ok: false, reason: 'This month is not closed.' };
  return { ok: true };
}

/** A reopen must say why. An unexplained reopen is indistinguishable from the lock not existing. */
export function validateReopenReason(reason: string): ClosureCheck {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'Give the reason this month is being reopened.' };
  if (trimmed.length < 10) {
    return { ok: false, reason: 'Give a little more detail — this reason is kept as the audit record.' };
  }
  return { ok: true };
}

export type SASClosureRecord = 'expense' | 'payment';

const RECORD_LABEL: Record<SASClosureRecord, string> = {
  expense: 'Expense date',
  payment: 'Receipt date',
};

/**
 * Checks one entry date against the closed periods.
 *
 * Runs after the rolling Date Control window, not instead of it: the two answer different
 * questions and either can reject a date the other would allow.
 *
 * `canOverride` is the `Month Closure` / `Close` permission. Whoever is accountable for closing a
 * period is the one person who can reasonably post into it — typically to correct the very thing
 * that prompted the reopen request — and giving them the override avoids a lock whose only escape
 * is to unlock the whole month for everyone.
 */
export function validateAgainstClosure({
  date,
  settings,
  kind,
  canOverride,
}: {
  date: string;
  settings: SASMonthClosureSettings;
  kind: SASClosureRecord;
  canOverride: boolean;
}): ClosureCheck {
  if (!date || canOverride) return { ok: true };
  const period = date.slice(0, 7);
  if (!isPeriodKey(period) || !isMonthClosed(settings, period)) return { ok: true };
  return {
    ok: false,
    reason: `${RECORD_LABEL[kind]} falls in ${period}, which has been closed. `
      + 'Ask an administrator to reopen the month, or record this against an open one.',
  };
}

export interface ClosureSummary {
  total: number;
  closed: number;
  open: number;
  /** Months that could be closed right now — past, and not already closed. */
  closable: number;
}

/** Counts across a list of periods, for the header line above the month grid. */
export function summariseClosure(
  periods: SASPeriodKey[],
  settings: SASMonthClosureSettings,
  currentPeriodKey: SASPeriodKey,
): ClosureSummary {
  let closed = 0, closable = 0;
  for (const period of periods) {
    const state = monthState(period, settings, currentPeriodKey);
    if (state === 'closed') closed++;
    else if (state === 'open') closable++;
  }
  return { total: periods.length, closed, open: periods.length - closed, closable };
}

/**
 * The months a "close everything through here" action would actually act on.
 *
 * Bulk closing is how a year-end is really done — nobody clicks twelve padlocks — but it is also
 * the action most able to lock work out by accident, so it resolves to an explicit list the person
 * can read before confirming, and silently skips anything `canClosePeriod` would refuse.
 */
export function periodsToBulkClose(
  periods: SASPeriodKey[],
  through: SASPeriodKey,
  settings: SASMonthClosureSettings,
  currentPeriodKey: SASPeriodKey,
): SASPeriodKey[] {
  return periods
    .filter(period => period <= through && canClosePeriod(period, settings, currentPeriodKey).ok)
    .sort();
}
