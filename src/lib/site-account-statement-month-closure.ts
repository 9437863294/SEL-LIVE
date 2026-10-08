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

/**
 * The stored document.
 *
 * Two layers, because sites do not close in step. `months` is the organisation's calendar — the
 * usual case, where September is settled everywhere at once. `projects` holds exceptions for a
 * single site, in both directions: a site that reported early and can be frozen ahead of the
 * others, and a site that has to be let back in to fix one bill without reopening the month for
 * everybody.
 *
 * A project's own entry always wins over the organisation's. That is what makes the exception an
 * exception rather than a second opinion.
 */
export interface SASMonthClosureSettings {
  /** All-projects calendar, keyed by period. */
  months: Record<SASPeriodKey, SASMonthClosure>;
  /** Per-project overrides, keyed by project id and then period. */
  projects: Record<string, Record<SASPeriodKey, SASMonthClosure>>;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export const EMPTY_MONTH_CLOSURE: SASMonthClosureSettings = { months: {}, projects: {} };

/** Which calendar an action applies to: the whole organisation, or one project. */
export const ALL_PROJECTS = 'all' as const;
export type ClosureScope = typeof ALL_PROJECTS | string;

export function isAllProjectsScope(scope: ClosureScope): boolean {
  return scope === ALL_PROJECTS;
}

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
function resolvePeriodMap(raw: unknown): Record<SASPeriodKey, SASMonthClosure> {
  const months: Record<SASPeriodKey, SASMonthClosure> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return months;
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
  return months;
}

export function resolveMonthClosure(
  stored: Partial<SASMonthClosureSettings> | undefined | null,
): SASMonthClosureSettings {
  const projects: Record<string, Record<SASPeriodKey, SASMonthClosure>> = {};
  const rawProjects = stored?.projects;
  if (rawProjects && typeof rawProjects === 'object' && !Array.isArray(rawProjects)) {
    for (const [projectId, value] of Object.entries(rawProjects)) {
      if (!projectId) continue;
      const periods = resolvePeriodMap(value);
      // A project whose every entry was malformed carries no exception, so it is left out
      // entirely rather than kept as an empty object that reads like a deliberate one.
      if (Object.keys(periods).length > 0) projects[projectId] = periods;
    }
  }
  return { months: resolvePeriodMap(stored?.months), projects };
}

/**
 * Where a month's state for a project comes from.
 *
 * `source` matters to the screen as much as `closed` does: "closed because the whole organisation
 * closed September" and "closed because this one site was frozen early" call for different
 * actions, and an administrator who cannot tell them apart will reopen the wrong one.
 */
export interface EffectiveClosure {
  closed: boolean;
  source: 'all' | 'project' | 'none';
  record: SASMonthClosure | null;
}

export function effectiveClosure(
  settings: SASMonthClosureSettings,
  period: SASPeriodKey,
  projectId?: string,
): EffectiveClosure {
  const own = projectId ? settings.projects[projectId]?.[period] : undefined;
  // Present and explicitly false is a real answer — it is how a single site is let back in while
  // the organisation's month stays shut — so this tests for presence, not for truthiness.
  if (own) return { closed: own.closed === true, source: 'project', record: own };

  const all = settings.months[period];
  if (all) return { closed: all.closed === true, source: 'all', record: all };

  return { closed: false, source: 'none', record: null };
}

/** The record governing this period for this project — its own, or the organisation's. */
export function closureFor(
  settings: SASMonthClosureSettings,
  period: SASPeriodKey,
  projectId?: string,
): SASMonthClosure | null {
  return effectiveClosure(settings, period, projectId).record;
}

/** Whether the period is closed for a given project; without one, for the organisation. */
export function isMonthClosed(
  settings: SASMonthClosureSettings,
  period: SASPeriodKey,
  projectId?: string,
): boolean {
  return effectiveClosure(settings, period, projectId).closed;
}

/** Every closed period for a project (or for the organisation), oldest first. */
export function closedPeriods(
  settings: SASMonthClosureSettings,
  projectId?: string,
): SASPeriodKey[] {
  const keys = new Set<SASPeriodKey>([
    ...Object.keys(settings.months),
    ...(projectId ? Object.keys(settings.projects[projectId] ?? {}) : []),
  ]);
  return [...keys].filter(period => isMonthClosed(settings, period, projectId)).sort();
}

/**
 * Projects that depart from the organisation's calendar for this period.
 *
 * Shown on the all-projects view so closing or reopening everywhere never silently hides the fact
 * that two sites are somewhere else.
 */
export function projectsWithOverride(
  settings: SASMonthClosureSettings,
  period: SASPeriodKey,
): { projectId: string; closed: boolean }[] {
  const all = settings.months[period]?.closed === true;
  return Object.entries(settings.projects)
    .filter(([, periods]) => periods[period])
    .map(([projectId, periods]) => ({ projectId, closed: periods[period].closed === true }))
    .filter(entry => entry.closed !== all)
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
}

/**
 * The newest closed month.
 *
 * Useful as a floor: everything up to here is settled, so a form can start a new entry after it
 * rather than offering a date it will refuse.
 */
export function latestClosedPeriod(
  settings: SASMonthClosureSettings,
  projectId?: string,
): SASPeriodKey | null {
  const all = closedPeriods(settings, projectId);
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
  projectId?: string,
): MonthState {
  if (isMonthClosed(settings, period, projectId)) return 'closed';
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
  projectId?: string,
): ClosureCheck {
  if (!isPeriodKey(period)) return { ok: false, reason: 'Not a valid month.' };
  if (isMonthClosed(settings, period, projectId)) {
    return { ok: false, reason: 'This month is already closed.' };
  }
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
  projectId?: string,
): ClosureCheck {
  if (!isMonthClosed(settings, period, projectId)) {
    return { ok: false, reason: 'This month is not closed.' };
  }
  return { ok: true };
}

/**
 * Whether a project's exception can simply be dropped, putting it back on the organisation's
 * calendar.
 *
 * Offered instead of "reopen" when a site's own entry already agrees with everyone else's — the
 * useful action there is to stop carrying an exception, not to change a state that is not
 * actually different.
 */
export function canFollowAllProjects(
  period: SASPeriodKey,
  settings: SASMonthClosureSettings,
  projectId: string,
): ClosureCheck {
  if (!settings.projects[projectId]?.[period]) {
    return { ok: false, reason: 'This project already follows the all-projects calendar.' };
  }
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
 * There is deliberately no override. A permission that let its holder post into a closed month
 * would make the lock a matter of who you are rather than what state the period is in, and the
 * whole value of closing a month is that the figures cannot move without that movement being
 * visible. The way in is to reopen the month — which needs a reason, is recorded against the
 * month, and shows on the closure screen afterwards.
 */
export function validateAgainstClosure({
  date,
  settings,
  kind,
  projectId,
}: {
  date: string;
  settings: SASMonthClosureSettings;
  kind: SASClosureRecord;
  /** The record's project. Omitted, only the all-projects calendar applies. */
  projectId?: string;
}): ClosureCheck {
  if (!date) return { ok: true };
  const period = date.slice(0, 7);
  if (!isPeriodKey(period) || !isMonthClosed(settings, period, projectId)) return { ok: true };
  return {
    ok: false,
    reason: `${RECORD_LABEL[kind]} falls in ${period}, which has been closed. `
      + 'The month must be reopened before anything can be recorded against it.',
  };
}

/**
 * Whether an existing record is frozen by its own date.
 *
 * The entry-date check above asks "may this date be used?", which is the right question for a new
 * record and the wrong one for an existing September expense being edited to an October date: that
 * date is perfectly allowed, and the edit still takes money out of a month somebody has reported
 * on. What locks a stored record is where it already sits.
 */
export function isRecordLocked({
  date,
  settings,
  projectId,
}: {
  date: string | undefined | null;
  settings: SASMonthClosureSettings;
  projectId?: string;
}): boolean {
  if (!date) return false;
  const period = date.slice(0, 7);
  return isPeriodKey(period) && isMonthClosed(settings, period, projectId);
}

export type ClosureAction = 'edit' | 'delete';

const ACTION_LABEL: Record<ClosureAction, string> = {
  edit: 'changed',
  delete: 'deleted',
};

const RECORD_NOUN: Record<SASClosureRecord, string> = {
  expense: 'expense',
  payment: 'receipt',
};

/**
 * Whether a stored record may be edited or deleted.
 *
 * Two separate refusals, and both matter:
 *
 *   - The record's *current* month is closed. Nothing about it may change — not its amount, not
 *     its category, and not its date, because moving it out is the most damaging edit of all: the
 *     closed month silently loses a figure that has already been reported.
 *   - The record is being moved *into* a closed month. Its own month is open, so the first rule
 *     lets it through, but the destination is settled.
 *
 * `nextDate` is omitted for a delete, where there is no destination.
 *
 * No permission lifts either refusal — see `validateAgainstClosure` for why. Reopening the month
 * is the only route, and it leaves a record.
 */
export function validateRecordChange({
  originalDate,
  nextDate,
  settings,
  kind,
  action,
  originalProjectId,
  nextProjectId,
}: {
  originalDate: string | undefined | null;
  nextDate?: string | null;
  settings: SASMonthClosureSettings;
  kind: SASClosureRecord;
  action: ClosureAction;
  /** The project the record belongs to now. */
  originalProjectId?: string;
  /** The project the edit would move it to; defaults to the original. */
  nextProjectId?: string;
}): ClosureCheck {
  const noun = RECORD_NOUN[kind];
  // An expense can be reassigned between projects, so the destination is checked against the
  // destination project's calendar — the one that will actually hold the figure.
  const destinationProject = nextProjectId ?? originalProjectId;

  if (isRecordLocked({ date: originalDate, settings, projectId: originalProjectId })) {
    return {
      ok: false,
      reason: `This ${noun} is dated in ${originalDate!.slice(0, 7)}, which has been closed. `
        + `A ${noun} in a closed month cannot be ${ACTION_LABEL[action]} by anyone. `
        + 'The month has to be reopened first.',
    };
  }

  if (action === 'edit' && isRecordLocked({ date: nextDate, settings, projectId: destinationProject })) {
    return {
      ok: false,
      reason: `${nextDate!.slice(0, 7)} has been closed`
        + `${nextProjectId && nextProjectId !== originalProjectId ? ' for the project you are moving this to' : ''}`
        + `, so this ${noun} cannot be moved into it.`,
    };
  }

  return { ok: true };
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
  projectId?: string,
): ClosureSummary {
  let closed = 0, closable = 0;
  for (const period of periods) {
    const state = monthState(period, settings, currentPeriodKey, projectId);
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
  projectId?: string,
): SASPeriodKey[] {
  return periods
    .filter(period => period <= through && canClosePeriod(period, settings, currentPeriodKey, projectId).ok)
    .sort();
}
