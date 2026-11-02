import { format } from 'date-fns';
import { compactInr, getApplicableRate, isCashCredit, parseDay, type LedgerAccount } from './bank-balance-ledger.ts';
import type { BBDateControlSettings } from './bank-balance-entry-controls.ts';
import { BB_FORM_KEYS, BB_FORM_REGISTRY, resolveAllForms, type BBFieldControlDoc } from './bank-balance-field-registry.ts';
import {
  autoRuleFor,
  canClosePeriod,
  effectiveClosure,
  latestClosedPeriod,
  type SASMonthClosureSettings,
} from './site-account-statement-month-closure.ts';
import { periodLabel, shiftPeriod } from './site-account-statement-period-range.ts';

/**
 * What each card on Bank Balance › Settings says before it is opened: a few figures, a status and
 * a one-line note, plus the setup-health score and the "needs attention" list built from them.
 *
 * Every figure is read from the stored data — nothing here is a placeholder. A card whose source
 * could not be read (no permission, offline) says so as neutral rather than guessing.
 *
 * Importless apart from the module's other node-loadable domain files
 * (tests/bank-balance-settings-overview.test.mjs).
 */

export type SettingsCardKey = 'accounts' | 'dp' | 'rates' | 'fieldControl' | 'dateControl' | 'monthClosure' | 'monthlyInterest' | 'appearance';

/** ok: set up; warn: something is missing; due: an action is waiting; neutral: optional and not in use, or unknown. */
export type CardStatus = 'ok' | 'warn' | 'due' | 'neutral';

export interface CardSummary {
  stats: Array<{ value: string; label: string }>;
  status: CardStatus;
  statusLabel: string;
  note: string;
}

export interface SettingsIssue {
  card: SettingsCardKey;
  text: string;
}

export interface SettingsOverview {
  cards: Record<SettingsCardKey, CardSummary>;
  /** What needs fixing, most important first. */
  issues: SettingsIssue[];
  /** Cards that have a status to judge (not neutral, and not Appearance — a preference), and how many are fine. */
  health: { ok: number; total: number };
}

export interface OverviewAccount extends LedgerAccount {
  shortName?: string;
  bankName?: string;
  drawingPower?: Array<{ fromDate: string; toDate: string | null }>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nameOf = (a: OverviewAccount) => (a.shortName || a.bankName || '').trim() || 'An account';
const listNames = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`);

export function settingsOverview<A extends OverviewAccount>({
  accounts,
  limitOn,
  today,
  lastMonthEntered,
  fieldControl,
  legacyMandatory,
  dateControl,
  closure,
  dashboardDesign,
}: {
  /** null when the accounts could not be read. */
  accounts: A[] | null;
  limitOn: (account: A, day: Date) => number;
  today: Date;
  /** Whether last month's actual interest is in; null when unknown. */
  lastMonthEntered: boolean | null;
  /** The stored Field Control document (null when none) and when it was saved; undefined when unreadable. */
  fieldControl?: { doc: BBFieldControlDoc | null; updatedAt: Date | null };
  legacyMandatory?: Record<string, unknown> | null;
  /** undefined when unreadable. */
  dateControl?: BBDateControlSettings;
  /** Resolved for today; undefined when unreadable. */
  closure?: SASMonthClosureSettings;
  /** The dashboard design in use and who chose it; undefined when unknown. */
  dashboardDesign?: { label: string; designs: number; chosenBy?: string; chosenAt?: Date | null };
}): SettingsOverview {
  const issues: SettingsIssue[] = [];
  const unknown = (stats: CardSummary['stats'] = []): CardSummary => ({ stats, status: 'neutral', statusLabel: 'Not available', note: 'Could not be read' });
  const todayKey = format(today, 'yyyy-MM-dd');
  const currentPeriod = todayKey.slice(0, 7);
  const lastPeriod = shiftPeriod(currentPeriod, -1);

  // ── Setup ──
  let accountsCard: CardSummary;
  let dpCard: CardSummary;
  let ratesCard: CardSummary;
  if (!accounts) {
    accountsCard = unknown();
    dpCard = unknown();
    ratesCard = unknown();
  } else {
    const active = accounts.filter((a) => (a.status ?? 'Active') === 'Active');
    const cc = active.filter(isCashCredit);
    const missingOpening = active.filter((a) => !a.openingDate);
    accountsCard = {
      stats: [
        { value: String(active.length), label: active.length === 1 ? 'account' : 'accounts' },
        { value: String(cc.length), label: 'CC' },
        { value: String(active.length - cc.length), label: 'current' },
      ],
      status: active.length === 0 || missingOpening.length ? 'warn' : 'ok',
      statusLabel: active.length === 0 || missingOpening.length ? 'Needs attention' : 'Configured',
      note: active.length === 0 ? 'No active accounts yet' : missingOpening.length ? `Opening date missing for ${missingOpening.length}` : 'Every account has an opening date',
    };
    if (active.length === 0) issues.push({ card: 'accounts', text: 'No active bank accounts are set up' });
    else if (missingOpening.length) issues.push({ card: 'accounts', text: `${plural(missingOpening.length, 'account')} without an opening date (${listNames(missingOpening.map(nameOf))})` });

    const noLimit = cc.filter((a) => (Number(limitOn(a, today)) || 0) <= 0);
    const totalLimit = cc.reduce((sum, a) => sum + (Number(limitOn(a, today)) || 0), 0);
    const lastChange = cc
      .flatMap((a) => (Array.isArray(a.drawingPower) ? a.drawingPower.map((e) => e.fromDate) : []))
      .filter((d) => typeof d === 'string' && d <= todayKey)
      .sort()
      .pop();
    const lastDay = lastChange ? parseDay(lastChange) : null;
    dpCard = cc.length === 0
      ? { stats: [{ value: '0', label: 'CC accounts' }], status: 'neutral', statusLabel: 'Not needed', note: 'No Cash Credit accounts' }
      : {
          stats: [
            { value: compactInr(totalLimit), label: 'total limit' },
            ...(lastDay ? [{ value: format(lastDay, 'd MMM'), label: 'last change' }] : []),
          ],
          status: noLimit.length ? 'warn' : 'ok',
          statusLabel: noLimit.length ? 'Needs attention' : 'Configured',
          note: noLimit.length ? `${listNames(noLimit.map(nameOf))} without a limit` : `${plural(cc.length, 'CC account')} with a limit`,
        };
    if (noLimit.length) issues.push({ card: 'dp', text: `no limit in force for ${listNames(noLimit.map(nameOf))}` });

    const rates = cc.map((a) => ({ account: a, rate: getApplicableRate(a, today) }));
    const noRate = rates.filter((r) => r.rate <= 0);
    const highest = Math.max(0, ...rates.map((r) => r.rate));
    ratesCard = cc.length === 0
      ? { stats: [{ value: '0', label: 'CC accounts' }], status: 'neutral', statusLabel: 'Not needed', note: 'No Cash Credit accounts' }
      : {
          stats: [
            { value: `${cc.length - noRate.length} of ${cc.length}`, label: 'CC rates set' },
            ...(highest > 0 ? [{ value: `${highest}%`, label: 'highest' }] : []),
          ],
          status: noRate.length ? 'warn' : 'ok',
          statusLabel: noRate.length ? 'Needs attention' : 'Configured',
          note: noRate.length ? `${listNames(noRate.map((r) => nameOf(r.account)))} ${noRate.length === 1 ? 'has' : 'have'} no rate` : 'Every CC account has a rate',
        };
    if (noRate.length) issues.push({ card: 'rates', text: `no interest rate for ${listNames(noRate.map((r) => nameOf(r.account)))}` });
  }

  // ── Entry controls ──
  let fieldCard: CardSummary;
  if (!fieldControl) fieldCard = unknown();
  else {
    const forms = resolveAllForms(fieldControl.doc, legacyMandatory);
    const fields = BB_FORM_KEYS.reduce((sum, key) => sum + BB_FORM_REGISTRY[key].fields.length, 0);
    const required = BB_FORM_KEYS.reduce((sum, key) => sum + Object.values(forms[key]).filter((f) => f.visible && f.required).length, 0);
    const saved = Boolean(fieldControl.doc);
    fieldCard = {
      stats: [
        { value: String(BB_FORM_KEYS.length), label: 'forms' },
        { value: String(fields), label: 'fields' },
        { value: String(required), label: 'required' },
      ],
      status: saved ? 'ok' : 'neutral',
      statusLabel: saved ? 'Configured' : 'Defaults',
      note: saved && fieldControl.updatedAt ? `Updated ${format(fieldControl.updatedAt, 'd MMM')}` : saved ? 'Configured' : 'Built-in defaults in use',
    };
  }

  let dateCard: CardSummary;
  if (!dateControl) dateCard = unknown();
  else if (!dateControl.enabled) {
    const own = Object.keys(dateControl.accounts).length;
    dateCard = {
      stats: [{ value: 'Off', label: 'for all accounts' }, ...(own ? [{ value: String(own), label: own === 1 ? 'account rule' : 'account rules' }] : [])],
      status: 'neutral',
      statusLabel: 'Off',
      note: own ? `${plural(own, 'account')} with a rule of its own` : 'Any date is accepted',
    };
  } else {
    const own = Object.keys(dateControl.accounts).length;
    dateCard = {
      stats: [
        { value: dateControl.backdateDays === 0 ? 'Today' : `${dateControl.backdateDays} day${dateControl.backdateDays === 1 ? '' : 's'}`, label: 'back' },
        { value: `${dateControl.futureDays} day${dateControl.futureDays === 1 ? '' : 's'}`, label: 'forward' },
        ...(dateControl.applyToPayments ? [{ value: `${dateControl.postDatedDays} days`, label: 'cheques ahead' }] : []),
      ],
      status: 'ok',
      statusLabel: 'On',
      note: own ? `${plural(own, 'account')} with a rule of its own` : 'Same rule for all accounts',
    };
  }

  let closureCard: CardSummary;
  if (!closure) closureCard = unknown();
  else {
    const latest = latestClosedPeriod(closure);
    const rule = autoRuleFor(closure)?.rule;
    const ruleOn = Boolean(rule?.enabled);
    const lastState = effectiveClosure(closure, lastPeriod);
    const inUse = Boolean(latest) || ruleOn;
    const stats = [
      { value: latest ? periodLabel(latest) : 'None', label: latest ? 'closed up to' : 'closed' },
      { value: periodLabel(currentPeriod).split(' ')[0], label: 'open' },
    ];
    if (!inUse) {
      closureCard = { stats, status: 'neutral', statusLabel: 'Not in use', note: 'No month has been closed' };
    } else if (lastState.closed) {
      closureCard = { stats, status: 'ok', statusLabel: 'Up to date', note: ruleOn ? `Closes on day ${rule!.dayOfNextMonth} of each month` : `${periodLabel(lastPeriod)} is closed` };
    } else if (!lastState.closed && lastState.closesOn) {
      closureCard = { stats, status: 'ok', statusLabel: 'Automatic', note: `${periodLabel(lastPeriod)} closes automatically on ${format(parseDay(lastState.closesOn)!, 'd MMM')}` };
    } else if (canClosePeriod(lastPeriod, closure, currentPeriod).ok) {
      closureCard = { stats, status: 'due', statusLabel: 'Action due', note: `${periodLabel(lastPeriod)} can be closed` };
      issues.push({ card: 'monthClosure', text: `${periodLabel(lastPeriod)} has not been closed yet` });
    } else {
      closureCard = { stats, status: 'ok', statusLabel: 'Up to date', note: `${periodLabel(lastPeriod)} is open` };
    }
  }

  // ── Monthly ──
  const lastLabel = periodLabel(lastPeriod);
  const interestCard: CardSummary =
    lastMonthEntered === null
      ? { stats: [{ value: lastLabel, label: 'last month' }], status: 'neutral', statusLabel: 'Not available', note: 'Could not be read' }
      : lastMonthEntered
        ? { stats: [{ value: lastLabel, label: 'entered' }], status: 'ok', statusLabel: 'Up to date', note: `${lastLabel} actuals recorded` }
        : { stats: [{ value: lastLabel, label: 'not entered' }], status: 'warn', statusLabel: 'Needs attention', note: `${lastLabel} not entered yet` };
  if (lastMonthEntered === false) issues.push({ card: 'monthlyInterest', text: `${lastLabel} interest has not been entered` });

  const appearanceCard: CardSummary = !dashboardDesign
    ? unknown()
    : {
        stats: [
          { value: dashboardDesign.label, label: 'in use' },
          { value: String(dashboardDesign.designs), label: 'designs' },
        ],
        status: dashboardDesign.chosenBy ? 'ok' : 'neutral',
        statusLabel: dashboardDesign.chosenBy ? 'Chosen' : 'Default',
        note: dashboardDesign.chosenBy
          ? `Set by ${dashboardDesign.chosenBy}${dashboardDesign.chosenAt ? ` · ${format(dashboardDesign.chosenAt, 'd MMM')}` : ''}`
          : 'Nobody has chosen one yet',
      };

  const cards: Record<SettingsCardKey, CardSummary> = {
    accounts: accountsCard,
    dp: dpCard,
    rates: ratesCard,
    fieldControl: fieldCard,
    dateControl: dateCard,
    monthClosure: closureCard,
    monthlyInterest: interestCard,
    appearance: appearanceCard,
  };
  const judged = Object.entries(cards).filter(([key, card]) => key !== 'appearance' && card.status !== 'neutral').map(([, card]) => card);
  return { cards, issues, health: { ok: judged.filter((card) => card.status === 'ok').length, total: judged.length } };
}
