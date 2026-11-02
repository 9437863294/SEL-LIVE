/**
 * Date Control and Month Closure for Bank Balance entries: payments, receipts and internal
 * transfers.
 *
 * The rules are Site Account Statement's, applied to bank accounts instead of projects:
 *
 *  - Date Control is a rolling window ("back-dating up to 7 days"), off until an administrator
 *    switches it on, the same for every user — no permission widens it. An account may carry a
 *    rule of its own in place of the all-accounts one.
 *  - Month Closure freezes a period once it has been reported on. A closed month refuses any entry
 *    dated inside it — new, edited, moved into it or deleted out of it — whoever is asking. The
 *    closure calendar, its per-account exceptions, automatic closing and timed reopens are Site
 *    Account's engine (`site-account-statement-month-closure.ts`) unchanged, with an account id
 *    where it says project; this file only words the refusals for bank entries.
 *
 * What differs from Site Account, because banking differs:
 *
 *  - Three kinds of entry, each of which the window can apply to or not.
 *  - A post-dated cheque or DD is a legitimate future-dated payment, so it has its own forward
 *    limit (`postDatedDays`, 90 by default — a cheque is valid for three months) separate from the
 *    forward limit for everything else (`futureDays`, 0: money cannot be recorded as moved before
 *    it has).
 *  - A transfer touches two accounts, and both accounts' rules and calendars apply to it.
 *
 * Importless apart from the two Site Account domain files, which are importless themselves, so
 * `node --test` loads it directly (tests/bank-balance-entry-controls.test.mjs).
 */

import {
  MAX_BACKDATE_DAYS,
  MAX_FUTURE_DAYS,
  RULES_LOADING,
  RULES_UNAVAILABLE,
  clampDays,
  isIsoDate,
  shiftDays,
  todayLocal,
  type DateCheck,
  type DateWindow,
} from './site-account-statement-date-policy.ts';
import {
  effectiveClosure,
  isMonthClosed,
  isPeriodKey,
  type SASMonthClosureSettings,
} from './site-account-statement-month-closure.ts';
import { periodLabel } from './site-account-statement-period-range.ts';

export { MAX_BACKDATE_DAYS, MAX_FUTURE_DAYS, RULES_LOADING, RULES_UNAVAILABLE, clampDays, shiftDays, todayLocal };
export type { DateCheck, DateWindow };

/** Where the three controls (and Field Control's sort order) are stored: one document each. */
export const BB_SETTINGS_COLLECTION = 'bankBalanceSettings';
export const BB_CONTROL_DOCS = {
  fieldControl: 'fieldControl',
  sortControl: 'sortControl',
  dateControl: 'dateControl',
  monthClosure: 'monthClosure',
} as const;

export type BBEntryKind = 'payment' | 'receipt' | 'transfer';

/** The all-accounts scope's key in the settings screens. */
export const ALL_ACCOUNTS = 'all' as const;
export const ALL_ACCOUNTS_LABEL = 'All accounts';

// ── Date Control ─────────────────────────────────────────────────────────────────────────────

export interface BBDateRule {
  /** Master switch. Off, the shipped default, means no restriction at all. */
  enabled: boolean;
  /** Calendar days before today an entry may be dated; 0 means today only. */
  backdateDays: number;
  /** Days after today a receipt, transfer or non-cheque payment may be dated. */
  futureDays: number;
  /** Days after today a cheque or demand draft may be dated (post-dated). */
  postDatedDays: number;
  applyToPayments: boolean;
  applyToReceipts: boolean;
  applyToTransfers: boolean;
}

/**
 * The all-accounts rule plus the accounts that have one of their own. An account's rule is whole,
 * not a patch: it keeps its numbers when the all-accounts rule later changes.
 */
export interface BBDateControlSettings extends BBDateRule {
  accounts: Record<string, BBDateRule>;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

/** Cheques are valid for three months, so the post-dated limit defaults to about that. */
export const DEFAULT_POST_DATED_DAYS = 90;

export const DEFAULT_BB_DATE_RULE: BBDateRule = {
  enabled: false,
  backdateDays: 7,
  futureDays: 0,
  postDatedDays: DEFAULT_POST_DATED_DAYS,
  applyToPayments: true,
  applyToReceipts: true,
  applyToTransfers: true,
};

/** One stored rule made usable. Only real, non-negative numbers are read as settings. */
export function resolveBBDateRule(stored: Partial<BBDateRule> | undefined | null): BBDateRule {
  const days = (value: unknown, fallback: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(max, Math.floor(value)) : fallback;
  return {
    enabled: stored?.enabled === true,
    backdateDays: days(stored?.backdateDays, DEFAULT_BB_DATE_RULE.backdateDays, MAX_BACKDATE_DAYS),
    futureDays: days(stored?.futureDays, DEFAULT_BB_DATE_RULE.futureDays, MAX_FUTURE_DAYS),
    postDatedDays: days(stored?.postDatedDays, DEFAULT_BB_DATE_RULE.postDatedDays, MAX_FUTURE_DAYS),
    applyToPayments: stored?.applyToPayments !== false,
    applyToReceipts: stored?.applyToReceipts !== false,
    applyToTransfers: stored?.applyToTransfers !== false,
  };
}

export function resolveBBDateControl(stored: Partial<BBDateControlSettings> | undefined | null): BBDateControlSettings {
  const accounts: Record<string, BBDateRule> = {};
  const raw = stored?.accounts;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [accountId, rule] of Object.entries(raw)) {
      if (accountId && rule && typeof rule === 'object') accounts[accountId] = resolveBBDateRule(rule);
    }
  }
  return { ...resolveBBDateRule(stored), accounts };
}

/** The fields of a rule only — what is written for the all-accounts rule or an account's. */
export function bbRuleOnly(rule: BBDateRule): BBDateRule {
  return {
    enabled: rule.enabled,
    backdateDays: clampDays(rule.backdateDays, MAX_BACKDATE_DAYS),
    futureDays: clampDays(rule.futureDays, MAX_FUTURE_DAYS),
    postDatedDays: clampDays(rule.postDatedDays, MAX_FUTURE_DAYS),
    applyToPayments: rule.applyToPayments,
    applyToReceipts: rule.applyToReceipts,
    applyToTransfers: rule.applyToTransfers,
  };
}

/** The rule an account is held to: its own when it has one, otherwise the all-accounts rule. */
export function bbDateRuleFor(
  settings: BBDateControlSettings,
  accountId?: string | null,
): BBDateRule & { source: 'account' | 'all' } {
  const own = accountId ? settings.accounts[accountId] : undefined;
  if (own) return { ...own, source: 'account' };
  return { ...bbRuleOnly(settings), source: 'all' };
}

export function accountsWithOwnRule(settings: BBDateControlSettings): string[] {
  return Object.keys(settings.accounts);
}

function appliesTo(rule: BBDateRule, kind: BBEntryKind): boolean {
  return kind === 'payment' ? rule.applyToPayments : kind === 'receipt' ? rule.applyToReceipts : rule.applyToTransfers;
}

const UNRESTRICTED: DateWindow = { min: null, max: null, enforced: false };

/**
 * The dates anyone may pick for one kind of entry on one account. `postDated` is for a cheque or
 * DD, whose forward limit is the post-dated one. Takes no permission: there is nothing a caller
 * can pass to get a wider window.
 */
export function bbDateWindow({
  settings,
  kind,
  accountId,
  postDated = false,
  today = todayLocal(),
}: {
  settings: BBDateControlSettings | BBDateRule;
  kind: BBEntryKind;
  accountId?: string | null;
  postDated?: boolean;
  today?: string;
}): DateWindow {
  const rule = 'accounts' in settings ? bbDateRuleFor(settings, accountId) : settings;
  if (!rule.enabled || !appliesTo(rule, kind)) return UNRESTRICTED;
  return {
    min: shiftDays(today, -rule.backdateDays),
    max: shiftDays(today, postDated ? rule.postDatedDays : rule.futureDays),
    enforced: true,
  };
}

/** The window several accounts share — a transfer's two — as the overlap of each one's. */
export function bbDateWindowForAccounts(args: {
  settings: BBDateControlSettings;
  kind: BBEntryKind;
  accountIds: Array<string | null | undefined>;
  postDated?: boolean;
  today?: string;
}): DateWindow {
  const ids = args.accountIds.filter((id): id is string => Boolean(id));
  const windows = (ids.length ? ids : [undefined]).map((accountId) => bbDateWindow({ ...args, accountId }));
  const enforced = windows.filter((window) => window.enforced);
  if (enforced.length === 0) return UNRESTRICTED;
  const mins = enforced.map((window) => window.min!).sort();
  const maxes = enforced.map((window) => window.max!).sort();
  return { min: mins[mins.length - 1], max: maxes[0], enforced: true };
}

export const BB_DATE_LABEL: Record<BBEntryKind, string> = {
  payment: 'Payment date',
  receipt: 'Receipt date',
  transfer: 'Transfer date',
};

function humanDays(days: number): string {
  if (days === 0) return 'today only';
  if (days === 1) return 'today or yesterday';
  return `the last ${days} days`;
}

/**
 * Checks one date against the window of each account it touches.
 *
 * The rejection names the window and what would change it, because "invalid date" on a form that
 * accepted the same value last week is the kind of error people work around by entering a wrong
 * date rather than by asking.
 */
export function validateBBEntryDate({
  date,
  settings,
  kind,
  accountIds = [],
  nameOf = (id) => id,
  label = BB_DATE_LABEL[kind],
  postDated = false,
  today = todayLocal(),
}: {
  date: string;
  settings: BBDateControlSettings;
  kind: BBEntryKind;
  accountIds?: Array<string | null | undefined>;
  nameOf?: (accountId: string) => string;
  /** The form's own name for the date — "Cheque date". */
  label?: string;
  postDated?: boolean;
  today?: string;
}): DateCheck {
  if (!date) return { ok: false, reason: `${label} is required.` };
  if (!isIsoDate(date)) return { ok: false, reason: `${label} must be a real date in YYYY-MM-DD format.` };

  const ids = accountIds.filter((id): id is string => Boolean(id));
  for (const accountId of ids.length ? ids : [undefined]) {
    const rule = bbDateRuleFor(settings, accountId);
    const window = bbDateWindow({ settings: rule, kind, postDated, today });
    if (!window.enforced) continue;
    const whose = rule.source === 'account' && accountId ? `for ${nameOf(accountId)}` : 'for every account';
    if (window.min && date < window.min) {
      return {
        ok: false,
        reason: `${label} cannot be earlier than ${window.min}. Back-dating is limited to ${humanDays(rule.backdateDays)} ${whose}. `
          + 'To record an older entry, an administrator has to widen the window in Bank Balance › Settings › Date Control.',
      };
    }
    if (window.max && date > window.max) {
      const ahead = postDated ? rule.postDatedDays : rule.futureDays;
      return {
        ok: false,
        reason: ahead === 0
          ? `${label} cannot be in the future${postDated ? ` ${whose} — post-dated cheques are switched off in Date Control` : ''}.`
          : `${label} cannot be more than ${ahead} day${ahead === 1 ? '' : 's'} ahead ${whose} (latest ${window.max}).`,
      };
    }
  }
  return { ok: true };
}

/** One line for under a date field, or null when unrestricted. */
export function describeBBDateWindow(window: DateWindow, today: string = todayLocal()): string | null {
  if (!window.enforced || !window.min || !window.max) return null;
  if (window.min === today && window.max === today) return 'Today only';
  return `From ${window.min} to ${window.max === today ? 'today' : window.max}`;
}

/** What a rule does, in one line, for the account list and the history. */
export function describeBBRule(rule: BBDateRule): string {
  if (!rule.enabled) return 'No restriction';
  const back = rule.backdateDays === 0 ? 'Today only' : `Back-dating up to ${rule.backdateDays} day${rule.backdateDays === 1 ? '' : 's'}`;
  const ahead = rule.futureDays > 0 ? `, up to ${rule.futureDays} day${rule.futureDays === 1 ? '' : 's'} ahead` : '';
  const cheques = rule.applyToPayments ? `, cheques up to ${rule.postDatedDays} day${rule.postDatedDays === 1 ? '' : 's'} ahead` : '';
  return `${back}${ahead}${cheques}`;
}

// ── Month Closure, worded for bank entries ───────────────────────────────────────────────────

const NOUN: Record<BBEntryKind, string> = { payment: 'payment', receipt: 'receipt', transfer: 'transfer' };

/** "which has been closed", said precisely — who or what closed it, and for whom. */
function closedClause(settings: SASMonthClosureSettings, period: string, accountId: string | undefined, nameOf: (id: string) => string): string {
  const effect = effectiveClosure(settings, period, accountId);
  if (effect.source === 'auto') return `which closed automatically on ${effect.closesOn}`;
  if (effect.relocked) return 'which was reopened for a while and has locked again';
  if (effect.source === 'project' && accountId) return `which has been closed for ${nameOf(accountId)}`;
  return 'which has been closed';
}

/** The first of these accounts whose calendar has this period closed, or null. */
function closedFor(settings: SASMonthClosureSettings, period: string, accountIds: Array<string | null | undefined>): { accountId: string | undefined } | null {
  const ids = accountIds.filter((id): id is string => Boolean(id));
  for (const accountId of ids.length ? ids : [undefined]) {
    if (isMonthClosed(settings, period, accountId)) return { accountId };
  }
  return null;
}

/** True when an entry dated `date` sits in a month closed for any of these accounts. */
export function isEntryLocked({
  date,
  settings,
  accountIds = [],
}: {
  date: string | null | undefined;
  settings: SASMonthClosureSettings;
  accountIds?: Array<string | null | undefined>;
}): boolean {
  if (!date) return false;
  const period = date.slice(0, 7);
  return isPeriodKey(period) && closedFor(settings, period, accountIds) !== null;
}

/**
 * Checks a new entry's date against the closed months of every account it touches. Runs after the
 * Date Control window, not instead of it. There is deliberately no override: the way in is to
 * reopen the month, which needs a reason and stays on the record.
 */
export function validateBBEntryAgainstClosure({
  date,
  settings,
  kind,
  accountIds = [],
  nameOf = (id) => id,
  label = BB_DATE_LABEL[kind],
}: {
  date: string;
  settings: SASMonthClosureSettings;
  kind: BBEntryKind;
  accountIds?: Array<string | null | undefined>;
  nameOf?: (accountId: string) => string;
  label?: string;
}): DateCheck {
  if (!date) return { ok: true };
  const period = date.slice(0, 7);
  if (!isPeriodKey(period)) return { ok: true };
  const hit = closedFor(settings, period, accountIds);
  if (!hit) return { ok: true };
  return {
    ok: false,
    reason: `${label} falls in ${periodLabel(period)}, ${closedClause(settings, period, hit.accountId, nameOf)}. `
      + 'The month must be reopened in Bank Balance › Settings › Month Closure before anything can be recorded against it.',
  };
}

/**
 * Whether a stored entry may be changed or deleted: refused when it sits in a closed month (moving
 * it out is the most damaging edit of all), and when an edit would move it into one.
 */
export function validateBBEntryChange({
  originalDate,
  nextDate,
  settings,
  kind,
  action,
  originalAccountIds = [],
  nextAccountIds,
  nameOf = (id) => id,
}: {
  originalDate: string | null | undefined;
  nextDate?: string | null;
  settings: SASMonthClosureSettings;
  kind: BBEntryKind;
  action: 'edit' | 'delete' | 'cancel';
  originalAccountIds?: Array<string | null | undefined>;
  /** The accounts after the edit; defaults to the original ones. */
  nextAccountIds?: Array<string | null | undefined>;
  nameOf?: (accountId: string) => string;
}): DateCheck {
  const noun = NOUN[kind];
  const verb = action === 'edit' ? 'changed' : action === 'delete' ? 'deleted' : 'cancelled or bounced';
  if (originalDate) {
    const period = originalDate.slice(0, 7);
    const hit = isPeriodKey(period) ? closedFor(settings, period, originalAccountIds) : null;
    if (hit) {
      return {
        ok: false,
        reason: `This ${noun} is dated in ${periodLabel(period)}, ${closedClause(settings, period, hit.accountId, nameOf)}. `
          + `A ${noun} in a closed month cannot be ${verb} by anyone. The month has to be reopened first.`,
      };
    }
  }
  if (action === 'edit' && nextDate) {
    const period = nextDate.slice(0, 7);
    const hit = isPeriodKey(period) ? closedFor(settings, period, nextAccountIds ?? originalAccountIds) : null;
    if (hit) {
      return {
        ok: false,
        reason: `${periodLabel(period)} has been closed${hit.accountId ? ` for ${nameOf(hit.accountId)}` : ''}, so this ${noun} cannot be moved into it.`,
      };
    }
  }
  return { ok: true };
}

// ── What a month holds, for the closure screen ──────────────────────────────────────────────

export interface MonthContents {
  paymentCount: number;
  paymentTotal: number;
  receiptCount: number;
  receiptTotal: number;
  /** Transfers, counted once each (by their outgoing leg). */
  transferCount: number;
  transferTotal: number;
  /** Cheques and DDs dated in the month that have not cleared: a bounce or cancel would need a reopen. */
  unclearedCheques: number;
}

export const EMPTY_MONTH_CONTENTS: MonthContents = {
  paymentCount: 0, paymentTotal: 0, receiptCount: 0, receiptTotal: 0, transferCount: 0, transferTotal: 0, unclearedCheques: 0,
};

/**
 * Tallies entries by month. `entries` carry their day as `YYYY-MM-DD`; with `accountId`, only that
 * account's are counted (and a transfer counts when either leg is on it).
 */
export function tallyMonths({
  entries,
  cheques = [],
  accountId,
}: {
  entries: Array<{ day: string; accountId: string; type: 'Debit' | 'Credit'; isContra?: boolean; amount: number }>;
  cheques?: Array<{ instrumentDate: string; accountId: string; uncleared: boolean }>;
  accountId?: string;
}): Record<string, MonthContents> {
  const tally: Record<string, MonthContents> = {};
  const bucket = (period: string) => (tally[period] ??= { ...EMPTY_MONTH_CONTENTS });
  for (const entry of entries) {
    const period = entry.day.slice(0, 7);
    if (!isPeriodKey(period)) continue;
    const amount = Number(entry.amount) || 0;
    if (entry.isContra) {
      // Each transfer has one Debit leg; with an account in scope, either leg on it counts.
      if (accountId ? entry.accountId !== accountId : entry.type !== 'Debit') continue;
      const b = bucket(period);
      b.transferCount += 1;
      b.transferTotal += amount;
      continue;
    }
    if (accountId && entry.accountId !== accountId) continue;
    const b = bucket(period);
    if (entry.type === 'Credit') {
      b.receiptCount += 1;
      b.receiptTotal += amount;
    } else {
      b.paymentCount += 1;
      b.paymentTotal += amount;
    }
  }
  for (const cheque of cheques) {
    if (!cheque.uncleared || (accountId && cheque.accountId !== accountId)) continue;
    const period = (cheque.instrumentDate || '').slice(0, 7);
    if (isPeriodKey(period)) bucket(period).unclearedCheques += 1;
  }
  return tally;
}
