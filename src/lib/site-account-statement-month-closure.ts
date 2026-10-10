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
 * Months can also close themselves. An automatic rule — "close each month on day D of the next
 * month" — is not a job that runs on a timer and writes a closure; it is part of how a month's
 * state is worked out. A month is closed from the moment its trigger day arrives, on every form and
 * in the database rules alike, with nothing to schedule and no run that can be missed.
 *
 * The order of authority, highest first:
 *   1. A project's own manual entry (close, or reopen).
 *   2. The organisation's manual entry for that month.
 *   3. The automatic rule — the project's own if it has one, otherwise the organisation's.
 * Anything decided by a person outranks anything decided by a rule, and within each, the more
 * specific scope wins.
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
  /**
   * When a reopened month locks again by itself, `YYYY-MM-DD`. From that day it reads as closed.
   *
   * A reopen is nearly always for one correction, and a month left open "until someone remembers"
   * is how a closed period quietly stops being one. Absent means open until closed by hand.
   */
  relockOn?: string;
}

/**
 * When months close themselves.
 *
 * One trigger, deliberately: the day of the following month on which a month closes. "Close
 * September on 5 October" is how books are actually closed, and "N days after month end" is the
 * same rule spelt differently. Capped at the 28th so the day exists in every month.
 */
export interface SASAutoCloseRule {
  /**
   * Off is meaningful at project level: a project carrying a rule with `enabled: false` never
   * closes automatically, even while the organisation's rule is on.
   */
  enabled: boolean;
  /** 1–28: the day of the following month on which a month closes. */
  dayOfNextMonth: number;
  /**
   * The first month the rule applies to. Without it, switching the rule on would close the whole
   * of a site's history in one go — including months still being reconciled.
   */
  startPeriod: SASPeriodKey;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
  /** Recorded when a change reopened months the previous rule had closed. */
  changeReason?: string;
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
  /** The organisation's automatic rule, or null when there is none. */
  autoClose: SASAutoCloseRule | null;
  /** Per-project rules. Present means the project does not follow the organisation's rule. */
  projectAutoClose: Record<string, SASAutoCloseRule>;
  /**
   * The day this snapshot was resolved for, `YYYY-MM-DD`.
   *
   * Automatic closing and timed reopens both depend on what day it is. Carrying the date on the
   * resolved settings — rather than threading a `today` argument through every function here —
   * means one snapshot answers every question consistently, and a test can pin the date in one
   * place.
   */
  asOf: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export const EMPTY_MONTH_CLOSURE: SASMonthClosureSettings = {
  months: {}, projects: {}, autoClose: null, projectAutoClose: {}, asOf: '',
};

// ── Calendar helpers ───────────────────────────────────────────────────────────
// Kept local so this file stays importless. They are small, and the date-policy module that has
// its own copies cannot be imported by `node --test` without resolving the rest of the app.

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date, `YYYY-MM-DD`. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DAY_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Today in the viewer's own timezone — the calendar a site actually works to. */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Whole calendar days added to a `YYYY-MM-DD` date, in UTC so no offset nudges the day. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** The month after `period`, rolling the year over. */
export function nextPeriod(period: SASPeriodKey): SASPeriodKey {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Every period from `from` to `to` inclusive, capped so a bad range cannot run away. */
function periodSpan(from: SASPeriodKey, to: SASPeriodKey, cap = 600): SASPeriodKey[] {
  const out: SASPeriodKey[] = [];
  for (let p = from; p <= to && out.length < cap; p = nextPeriod(p)) out.push(p);
  return out;
}

/** The snapshot's day, falling back to the clock when it was resolved without one. */
function asOfOf(settings: SASMonthClosureSettings): string {
  return isIsoDay(settings.asOf) ? settings.asOf : localToday();
}

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
      // An empty or malformed date means "no timed relock", never "relock now".
      relockOn: isIsoDay(entry.relockOn) ? entry.relockOn : undefined,
    };
  }
  return months;
}

export const AUTO_CLOSE_DAY_MIN = 1;
export const AUTO_CLOSE_DAY_MAX = 28;

/**
 * Reads one stored rule, or null when it cannot be trusted.
 *
 * An enabled rule needs both a valid day and a valid start month; missing either, it is dropped
 * rather than repaired, because a guessed start month would close history nobody chose to close.
 * A disabled rule is kept even when the rest is incomplete — at project level its whole meaning
 * is "do not close this site automatically", and that survives a missing day.
 */
function resolveAutoRule(raw: unknown): SASAutoCloseRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rule = raw as Partial<SASAutoCloseRule>;
  const day = rule.dayOfNextMonth;
  const dayOk = typeof day === 'number' && Number.isInteger(day)
    && day >= AUTO_CLOSE_DAY_MIN && day <= AUTO_CLOSE_DAY_MAX;
  const startOk = isPeriodKey(rule.startPeriod);
  if (rule.enabled === true && (!dayOk || !startOk)) return null;
  return {
    enabled: rule.enabled === true,
    dayOfNextMonth: dayOk ? day : 5,
    startPeriod: startOk ? rule.startPeriod! : '',
    updatedAt: rule.updatedAt,
    updatedBy: typeof rule.updatedBy === 'string' ? rule.updatedBy : undefined,
    updatedByName: typeof rule.updatedByName === 'string' ? rule.updatedByName : undefined,
    changeReason: typeof rule.changeReason === 'string' ? rule.changeReason : undefined,
  };
}

/**
 * @param asOf The day to read the snapshot for. Defaults to today in the viewer's timezone; tests
 *   and the database-rule mirror pin it.
 */
export function resolveMonthClosure(
  stored: Partial<SASMonthClosureSettings> | undefined | null,
  asOf: string = localToday(),
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

  const projectAutoClose: Record<string, SASAutoCloseRule> = {};
  const rawRules = stored?.projectAutoClose;
  if (rawRules && typeof rawRules === 'object' && !Array.isArray(rawRules)) {
    for (const [projectId, value] of Object.entries(rawRules)) {
      const rule = projectId ? resolveAutoRule(value) : null;
      if (rule) projectAutoClose[projectId] = rule;
    }
  }

  return {
    months: resolvePeriodMap(stored?.months),
    projects,
    autoClose: resolveAutoRule(stored?.autoClose),
    projectAutoClose,
    asOf: isIsoDay(asOf) ? asOf : localToday(),
  };
}

// ── Automatic closing ──────────────────────────────────────────────────────────

/** The day a month closes under a rule: day D of the following month. */
export function autoCloseDateFor(period: SASPeriodKey, rule: Pick<SASAutoCloseRule, 'dayOfNextMonth'>): string {
  return `${nextPeriod(period)}-${String(rule.dayOfNextMonth).padStart(2, '0')}`;
}

/**
 * The rule that governs a project: its own if it has one, otherwise the organisation's.
 *
 * A project's own rule is used even when disabled — that is how a single site opts out.
 */
export function autoRuleFor(
  settings: SASMonthClosureSettings,
  projectId?: string,
): { rule: SASAutoCloseRule; scope: 'project' | 'all' } | null {
  const own = projectId ? settings.projectAutoClose[projectId] : undefined;
  if (own) return { rule: own, scope: 'project' };
  if (settings.autoClose) return { rule: settings.autoClose, scope: 'all' };
  return null;
}

/** Whether the rule reaches this month at all — on, and not before its start month. */
function ruleCovers(rule: SASAutoCloseRule, period: SASPeriodKey): boolean {
  return rule.enabled && isPeriodKey(rule.startPeriod) && period >= rule.startPeriod;
}

/** One manual entry, read for the snapshot's day: closed, or reopened with a lock date passed. */
function manualState(entry: SASMonthClosure, asOf: string): { closed: boolean; relocked: boolean } {
  if (entry.closed) return { closed: true, relocked: false };
  if (entry.relockOn && asOf >= entry.relockOn) return { closed: true, relocked: true };
  return { closed: false, relocked: false };
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
  /**
   * What decided it: a manual entry for this project, a manual entry for every project, the
   * automatic rule, or nothing at all.
   */
  source: 'all' | 'project' | 'auto' | 'none';
  /** The manual entry behind the answer, when there is one. */
  record: SASMonthClosure | null;
  /** For `auto`, and for an open month a rule will close later: whose rule it is. */
  autoScope?: 'project' | 'all';
  /** For `auto`: the day it closed. For an open month under a rule: the day it will. */
  closesOn?: string;
  /** True when a reopened month has passed its lock-again date and is closed once more. */
  relocked?: boolean;
}

export function effectiveClosure(
  settings: SASMonthClosureSettings,
  period: SASPeriodKey,
  projectId?: string,
): EffectiveClosure {
  const asOf = asOfOf(settings);

  // 1–2. Manual entries, the project's before the organisation's. Present-and-reopened is a real
  // answer — it is how one site is let back in while the rest stay shut — so presence is tested,
  // not truthiness.
  const own = projectId ? settings.projects[projectId]?.[period] : undefined;
  if (own) {
    const state = manualState(own, asOf);
    return { closed: state.closed, source: 'project', record: own, relocked: state.relocked };
  }
  const all = settings.months[period];
  if (all) {
    const state = manualState(all, asOf);
    return { closed: state.closed, source: 'all', record: all, relocked: state.relocked };
  }

  // 3. The automatic rule.
  const governing = autoRuleFor(settings, projectId);
  if (governing && ruleCovers(governing.rule, period)) {
    const closesOn = autoCloseDateFor(period, governing.rule);
    const closed = asOf >= closesOn;
    return {
      closed,
      source: closed ? 'auto' : 'none',
      record: null,
      autoScope: governing.scope,
      closesOn,
    };
  }

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
  // Automatically closed months have no stored entry, so they are found by walking the rule's
  // span up to the snapshot's month rather than by reading keys.
  const governing = autoRuleFor(settings, projectId);
  if (governing && ruleCovers(governing.rule, governing.rule.startPeriod)) {
    for (const period of periodSpan(governing.rule.startPeriod, asOfOf(settings).slice(0, 7))) {
      keys.add(period);
    }
  }
  return [...keys].filter(period => isMonthClosed(settings, period, projectId)).sort();
}

/**
 * Projects whose state for this period differs from the organisation's.
 *
 * Shown on the all-projects view so closing or reopening everywhere never silently hides the fact
 * that two sites are somewhere else. A project counts whether it differs by a manual entry or by
 * carrying its own automatic rule — what matters is that its answer is not the organisation's.
 */
export function projectsWithOverride(
  settings: SASMonthClosureSettings,
  period: SASPeriodKey,
): { projectId: string; closed: boolean }[] {
  const all = isMonthClosed(settings, period);
  const candidates = new Set<string>([
    ...Object.entries(settings.projects).filter(([, periods]) => periods[period]).map(([id]) => id),
    ...Object.keys(settings.projectAutoClose),
  ]);
  return [...candidates]
    .map(projectId => ({ projectId, closed: isMonthClosed(settings, period, projectId) }))
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
 * "which has been closed", said precisely.
 *
 * A clerk told only that a month is closed goes looking for who closed it. "Closed automatically
 * on 5 October" tells them nobody did, and that the answer is a reopen rather than a phone call.
 */
function closedClause(settings: SASMonthClosureSettings, period: SASPeriodKey, projectId?: string): string {
  const effect = effectiveClosure(settings, period, projectId);
  if (effect.source === 'auto') return `which closed automatically on ${effect.closesOn}`;
  if (effect.relocked) return 'which was reopened for a while and has locked again';
  return 'which has been closed';
}

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
    reason: `${RECORD_LABEL[kind]} falls in ${period}, ${closedClause(settings, period, projectId)}. `
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
    const period = originalDate!.slice(0, 7);
    return {
      ok: false,
      reason: `This ${noun} is dated in ${period}, ${closedClause(settings, period, originalProjectId)}. `
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

// ── Editing automatic rules ────────────────────────────────────────────────────

/** Common trigger days, so the usual choice is one click. */
export const AUTO_CLOSE_DAY_PRESETS = [1, 3, 5, 7, 10, 15] as const;

/** Whether a project carries its own rule, which "follow all projects" would remove. */
export function hasOwnAutoRule(settings: SASMonthClosureSettings, projectId: string): boolean {
  return Boolean(settings.projectAutoClose[projectId]);
}

/** A trigger day as typed, made whole and kept inside the 1–28 every month has. */
export function clampAutoCloseDay(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return AUTO_CLOSE_DAY_MIN;
  return Math.min(AUTO_CLOSE_DAY_MAX, Math.max(AUTO_CLOSE_DAY_MIN, Math.floor(parsed)));
}

export function validateAutoCloseRule(rule: Pick<SASAutoCloseRule, 'enabled' | 'dayOfNextMonth' | 'startPeriod'>): ClosureCheck {
  if (!rule.enabled) return { ok: true };
  if (!Number.isInteger(rule.dayOfNextMonth)
    || rule.dayOfNextMonth < AUTO_CLOSE_DAY_MIN || rule.dayOfNextMonth > AUTO_CLOSE_DAY_MAX) {
    return { ok: false, reason: `Pick a day between ${AUTO_CLOSE_DAY_MIN} and ${AUTO_CLOSE_DAY_MAX}.` };
  }
  if (!isPeriodKey(rule.startPeriod)) {
    return { ok: false, reason: 'Pick the first month the rule should apply to.' };
  }
  return { ok: true };
}

/** One line describing a rule, for cards and confirmations. */
export function describeAutoRule(rule: SASAutoCloseRule | null | undefined): string {
  if (!rule) return 'No automatic closing';
  if (!rule.enabled) return 'Never closes automatically';
  return `Closes on day ${rule.dayOfNextMonth} of the following month, from ${rule.startPeriod}`;
}

/**
 * The settings as they would be with a different rule in one scope.
 *
 * `next` of null removes the rule: for a project, it goes back to following the organisation's;
 * for the organisation, there is simply no rule.
 */
export function withAutoRule(
  settings: SASMonthClosureSettings,
  projectId: string | undefined,
  next: SASAutoCloseRule | null,
): SASMonthClosureSettings {
  if (!projectId) return { ...settings, autoClose: next };
  const projectAutoClose = { ...settings.projectAutoClose };
  if (next) projectAutoClose[projectId] = next;
  else delete projectAutoClose[projectId];
  return { ...settings, projectAutoClose };
}

export interface AutoRuleChangePreview {
  /** Months that are open now and would close the moment the change is saved. */
  closesNow: SASPeriodKey[];
  /**
   * Months the current rule has closed that the new one would open again.
   *
   * Not empty means the change is a reopen in disguise — turning a rule off, moving its day later
   * or its start month later all do it — and is held to the same standard as a reopen: the
   * permission, and a written reason.
   */
  reopens: SASPeriodKey[];
}

/**
 * What saving a rule change would do, read on the calendar of the scope being edited.
 *
 * On the all-projects scope this is also exactly what happens to every project that follows the
 * organisation: those with their own rule or a manual entry for a month are not affected by it.
 */
export function previewAutoRuleChange(
  settings: SASMonthClosureSettings,
  projectId: string | undefined,
  next: SASAutoCloseRule | null,
): AutoRuleChangePreview {
  const after = withAutoRule(settings, projectId, next);
  const starts = [autoRuleFor(settings, projectId), autoRuleFor(after, projectId)]
    .map(governing => governing?.rule.startPeriod)
    .filter((period): period is string => isPeriodKey(period))
    .sort();
  if (starts.length === 0) return { closesNow: [], reopens: [] };

  const closesNow: SASPeriodKey[] = [];
  const reopens: SASPeriodKey[] = [];
  for (const period of periodSpan(starts[0], asOfOf(settings).slice(0, 7))) {
    const before = isMonthClosed(settings, period, projectId);
    const later = isMonthClosed(after, period, projectId);
    if (!before && later) closesNow.push(period);
    if (before && !later) reopens.push(period);
  }
  return { closesNow, reopens };
}

/**
 * Open months in a list that a rule will close later, with the day each one closes.
 *
 * Drives the "closes automatically on 5 Nov" line on a month card, so nobody is surprised.
 */
export function upcomingAutoCloses(
  periods: SASPeriodKey[],
  settings: SASMonthClosureSettings,
  projectId?: string,
): Record<SASPeriodKey, string> {
  const out: Record<SASPeriodKey, string> = {};
  for (const period of periods) {
    const effect = effectiveClosure(settings, period, projectId);
    if (!effect.closed && effect.source === 'none' && effect.closesOn) out[period] = effect.closesOn;
  }
  return out;
}

// ── Reopening for a limited time ───────────────────────────────────────────────

/**
 * How long a reopen lasts before the month locks again by itself. `null` keeps it open until
 * someone closes it by hand.
 */
export const RELOCK_PRESETS = [
  { days: 1, label: 'Until tomorrow' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: null, label: 'Until closed by hand' },
] as const;

/** The lock-again date for a reopen made on `asOf` lasting `days`; undefined for no limit. */
export function relockDateFor(asOf: string, days: number | null): string | undefined {
  if (days === null || !Number.isFinite(days) || days < 1) return undefined;
  return addDays(asOf, Math.floor(days));
}
