import { addDays, endOfDay, endOfMonth, startOfDay } from 'date-fns';
import {
  type AccountLedger,
  type LedgerAccount,
  type LedgerTxn,
  dailyRows,
  compactInr,
  dayKey,
  formatInr,
  getApplicableRate,
  isCashCredit,
  parseDay,
} from './bank-balance-ledger.ts';

/**
 * The Bank Balance dashboard designs, and the figures the three newer designs add to the classic
 * page's: each account's position, the drawn-against-limit history, money in and out over a span,
 * what is dated ahead, and the latest movements.
 *
 * Which design the dashboard shows is a company-wide choice made on Bank Balance › Settings and
 * stored in `bankBalanceSettings/dashboard`. Every design reads the same ledgers, so switching
 * changes the layout, never a figure.
 *
 * Kept free of Firebase and React imports, like bank-balance-ledger, so plain node can test it
 * (tests/bank-balance-dashboard.test.mjs).
 */

export type BankDashboardDesign = 'classic' | 'overview' | 'accounts' | 'position' | 'aurora';

export interface BankDashboardDesignOption {
  id: BankDashboardDesign;
  label: string;
  description: string;
}

export const BANK_DASHBOARD_DESIGNS: ReadonlyArray<BankDashboardDesignOption> = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'The original dashboard: balance banner, figure cards for the month, limits and cheques, account cards and five charts.',
  },
  {
    id: 'overview',
    label: 'Overview',
    description: 'One headline figure with its trend line, the accounts as a list, and the month and what is coming up beside them.',
  },
  {
    id: 'accounts',
    label: 'Account workspace',
    description: 'Accounts down the left. Pick all or one to see its figures, drawn-against-limit bars, what is coming up and recent movements.',
  },
  {
    id: 'position',
    label: 'Position table',
    description: 'Today’s position and checks on top, then every account in one table with limit, drawn, available and subtotals.',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    description: 'A colour banner with available liquidity and where it comes from, quick entries, today’s figures, utilisation bars, limit by bank, and accounts as cards or a table.',
  },
];

/** The design shown until someone chooses one: the page as it has always looked. */
export const DEFAULT_BANK_DASHBOARD_DESIGN: BankDashboardDesign = 'classic';

/** The collection and document id the choice is stored under. */
export const BANK_DASHBOARD_SETTINGS = { collection: 'bankBalanceSettings', id: 'dashboard' } as const;

/** A stored or requested design, falling back to the default for anything unknown. */
export function normaliseDashboardDesign(value: unknown): BankDashboardDesign {
  return BANK_DASHBOARD_DESIGNS.some((option) => option.id === value) ? (value as BankDashboardDesign) : DEFAULT_BANK_DASHBOARD_DESIGN;
}

export const dashboardDesignLabel = (design: BankDashboardDesign) =>
  BANK_DASHBOARD_DESIGNS.find((option) => option.id === design)?.label ?? 'Classic';

const SMALL_WORDS = new Set(['of', 'and', 'the', '&', 'ltd', 'limited']);

/**
 * The two- or three-letter badge for an account: the short name's first part when that is
 * already an abbreviation (PNB, SBI, KBL), otherwise the bank name's initials (Canara Bank → CB).
 */
export function bankInitials(account: { shortName?: string | null; bankName?: string | null }): string {
  const token = (account.shortName || '').trim().split(/[\s\-_/.]+/)[0] || '';
  if (/^[A-Za-z]{2,3}$/.test(token)) return token.toUpperCase();
  const words = (account.bankName || account.shortName || '')
    .trim()
    .split(/\s+/)
    .filter((word) => word && !SMALL_WORDS.has(word.toLowerCase()));
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export interface AccountPosition<A extends LedgerAccount = LedgerAccount> {
  account: A;
  cc: boolean;
  /** Cash Credit: the limit (DP + OD + TOD) in force. Current account: 0. */
  limit: number;
  /** The ledger figure: utilisation for Cash Credit (a credit balance is negative), balance otherwise. */
  figure: number;
  /** What is drawn: utilisation, never below 0. Always 0 for a current account. */
  drawn: number;
  /** Spendable: limit less utilisation for Cash Credit (a credit balance adds to it), the balance otherwise. */
  available: number;
  /** Drawn as a share of the limit, 0–100+ (over 100 is over the limit); 0 without a limit. */
  pct: number;
}

/** Each account's position from its ledger figure and the limit in force. */
export function accountPositions<A extends LedgerAccount>(
  accounts: A[],
  figures: Record<string, number>,
  limitOf: (account: A) => number,
): Array<AccountPosition<A>> {
  return accounts.map((account) => {
    const figure = Number(figures[account.id]) || 0;
    if (!isCashCredit(account)) return { account, cc: false, limit: 0, figure, drawn: 0, available: figure, pct: 0 };
    const limit = Number(limitOf(account)) || 0;
    const drawn = Math.max(0, figure);
    return { account, cc: true, limit, figure, drawn, available: limit - figure, pct: limit > 0 ? (drawn / limit) * 100 : 0 };
  });
}

export interface PositionTotals {
  /** Everything spendable: current balances plus Cash Credit headroom — the headline figure. */
  available: number;
  currentBalance: number;
  currentCount: number;
  ccLimit: number;
  ccDrawn: number;
  /** Cash Credit limit less utilisation, summed (so current balance + headroom = available). */
  ccHeadroom: number;
  ccCount: number;
  /** Drawn as a share of the combined limit; 0 without one. */
  drawnPct: number;
}

export function positionTotals(rows: Array<AccountPosition>): PositionTotals {
  const totals: PositionTotals = { available: 0, currentBalance: 0, currentCount: 0, ccLimit: 0, ccDrawn: 0, ccHeadroom: 0, ccCount: 0, drawnPct: 0 };
  for (const row of rows) {
    totals.available += row.available;
    if (row.cc) {
      totals.ccCount += 1;
      totals.ccLimit += row.limit;
      totals.ccDrawn += row.drawn;
      totals.ccHeadroom += row.available;
    } else {
      totals.currentCount += 1;
      totals.currentBalance += row.figure;
    }
  }
  totals.drawnPct = totals.ccLimit > 0 ? (totals.ccDrawn / totals.ccLimit) * 100 : 0;
  return totals;
}

export interface DrawnPoint {
  day: Date;
  /** Closing utilisation that day, credit balances counting as nothing drawn. */
  drawn: number;
  /** The limits in force that day. */
  limit: number;
}

/**
 * Each day's closing Cash Credit utilisation against the limit in force that day, summed over the
 * ledgers given (current accounts are skipped). An account adds nothing before its opening date.
 */
export function drawnHistory<A extends LedgerAccount>(
  ledgers: Array<AccountLedger<A>>,
  limitOn: (account: A, day: Date) => number,
  from: Date,
  to: Date,
): DrawnPoint[] {
  const first = startOfDay(from);
  const last = startOfDay(to);
  const points: DrawnPoint[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) points.push({ day, drawn: 0, limit: 0 });
  if (points.length === 0) return points;

  for (const ledger of ledgers) {
    if (!isCashCredit(ledger.account)) continue;
    dailyRows(ledger, first, last).forEach((row, index) => {
      if (!row.open) return;
      points[index].drawn += Math.max(0, row.closing);
      points[index].limit += Number(limitOn(ledger.account, row.day)) || 0;
    });
  }
  return points;
}

/** The last point of each calendar month: a daily series read at month ends (the current month at its latest day). */
export function monthEndPoints<P extends { day: Date }>(points: P[]): P[] {
  return points.filter((point, index) => {
    const next = points[index + 1];
    return !next || next.day.getMonth() !== point.day.getMonth() || next.day.getFullYear() !== point.day.getFullYear();
  });
}

export interface FlowTotals {
  /** Money in and out, internal transfers excluded. */
  receipts: number;
  payments: number;
  net: number;
  /** Money moved between the company's own accounts (each transfer's outgoing leg). */
  transfers: number;
  receiptCount: number;
  paymentCount: number;
  /** Entries of any kind, both legs of a transfer included. */
  count: number;
  /** The latest entry in the span; null when there is none. */
  lastAt: Date | null;
}

/** Money in and out between two days inclusive, over the ledgers given. */
export function flowBetween(ledgers: Array<AccountLedger>, from: Date, to: Date): FlowTotals {
  const first = startOfDay(from);
  const last = endOfDay(to);
  const totals: FlowTotals = { receipts: 0, payments: 0, net: 0, transfers: 0, receiptCount: 0, paymentCount: 0, count: 0, lastAt: null };
  for (const ledger of ledgers) {
    for (const { txn, at } of ledger.entries) {
      if (at < first || at > last) continue;
      const amount = Number(txn.amount) || 0;
      if (txn.isContra) {
        if (txn.type === 'Debit') totals.transfers += amount;
      } else if (txn.type === 'Credit') {
        totals.receipts += amount;
        totals.receiptCount += 1;
      } else {
        totals.payments += amount;
        totals.paymentCount += 1;
      }
      totals.count += 1;
      if (!totals.lastAt || at > totals.lastAt) totals.lastAt = at;
    }
  }
  totals.net = totals.receipts - totals.payments;
  return totals;
}

/** The account's latest entry dated up to `cutoff`; null when it has none yet. */
export function lastEntryAt(ledger: AccountLedger | undefined, cutoff: Date): Date | null {
  if (!ledger) return null;
  for (let index = ledger.entries.length - 1; index >= 0; index -= 1) {
    if (ledger.entries[index].at <= cutoff) return ledger.entries[index].at;
  }
  return null;
}

export interface Movement<A extends LedgerAccount = LedgerAccount, T extends LedgerTxn = LedgerTxn> {
  txn: T;
  at: Date;
  account: A;
}

/**
 * The latest entries dated up to `cutoff`, newest first. Entries dated ahead stay out: a post-dated
 * cheque would sit on top of the list for weeks without being activity.
 */
export function recentMovements<A extends LedgerAccount, T extends LedgerTxn>(
  ledgers: Array<AccountLedger<A, T>>,
  cutoff: Date,
  limit: number,
): Array<Movement<A, T>> {
  const out: Array<Movement<A, T>> = [];
  for (const ledger of ledgers) {
    for (const entry of ledger.entries) if (entry.at <= cutoff) out.push({ txn: entry.txn, at: entry.at, account: ledger.account });
  }
  out.sort((a, b) => b.at.getTime() - a.at.getTime());
  return out.slice(0, Math.max(0, limit));
}

export type UpcomingKind = 'entries' | 'limit' | 'rate' | 'interest';

export interface UpcomingItem {
  day: Date;
  kind: UpcomingKind;
  title: string;
  detail: string;
  /** The figure the item is about, when it has one (shown beside it, never inside the title). */
  amount?: number;
}

type DatedLogAccount = LedgerAccount & {
  drawingPower?: Array<{ fromDate: string; toDate: string | null }>;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const listNames = (names: string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;

/**
 * What the books already say is coming, soonest first, from the day after `today` up to
 * `horizonDays` ahead:
 *
 *  - entries dated ahead (post-dated cheques, future-dated receipts), one item per day;
 *  - limit and interest-rate changes that start in the window;
 *  - the month's interest, at month end, while Cash Credit interest is accruing.
 *
 * Nothing here is invented: an empty list means nothing is dated ahead.
 */
export function upcomingItems<A extends DatedLogAccount, T extends LedgerTxn>({
  ledgers,
  nameOf,
  limitOn,
  today,
  horizonDays,
  interestAccrued = 0,
}: {
  ledgers: Array<AccountLedger<A, T>>;
  nameOf: (account: A) => string;
  limitOn: (account: A, day: Date) => number;
  today: Date;
  horizonDays: number;
  /** Interest accrued so far this month, est.; 0 leaves the month-end item out. */
  interestAccrued?: number;
}): UpcomingItem[] {
  const after = endOfDay(today);
  const until = endOfDay(addDays(today, Math.max(0, horizonDays)));
  const items: UpcomingItem[] = [];

  const days = new Map<string, { day: Date; receipts: number; payments: number; transfers: number; count: number; names: Set<string> }>();
  for (const ledger of ledgers) {
    for (const { txn, at } of ledger.entries) {
      if (at <= after || at > until) continue;
      const key = dayKey(at);
      let bucket = days.get(key);
      if (!bucket) {
        bucket = { day: startOfDay(at), receipts: 0, payments: 0, transfers: 0, count: 0, names: new Set() };
        days.set(key, bucket);
      }
      const amount = Number(txn.amount) || 0;
      if (txn.isContra) {
        if (txn.type === 'Debit') bucket.transfers += amount;
      } else if (txn.type === 'Credit') bucket.receipts += amount;
      else bucket.payments += amount;
      bucket.count += 1;
      bucket.names.add(nameOf(ledger.account));
    }
  }
  for (const bucket of days.values()) {
    const kinds = [
      { label: 'Payments', amount: bucket.payments },
      { label: 'Receipts', amount: bucket.receipts },
      { label: 'Transfers', amount: bucket.transfers },
    ].filter((kind) => kind.amount > 0);
    const names = listNames([...bucket.names]);
    const count = plural(bucket.count, 'entry', 'entries');
    if (kinds.length === 1) {
      items.push({ day: bucket.day, kind: 'entries', title: `${kinds[0].label} dated ahead`, detail: `${count} · ${names}`, amount: kinds[0].amount });
    } else {
      items.push({
        day: bucket.day,
        kind: 'entries',
        title: kinds.length ? `${kinds.map((kind) => kind.label.toLowerCase()).join(' and ').replace(/^./, (c) => c.toUpperCase())} dated ahead` : 'Entries dated ahead',
        detail: [...kinds.map((kind) => `${kind.label} ${formatInr(kind.amount, 0)}`), names].join(' · '),
      });
    }
  }

  const inWindow = (value: string) => {
    const day = parseDay(value);
    return day && day > after && day <= until ? day : null;
  };

  for (const ledger of ledgers) {
    const account = ledger.account;
    if (!isCashCredit(account)) continue;
    const name = nameOf(account);

    for (const entry of Array.isArray(account.drawingPower) ? account.drawingPower : []) {
      const day = inWindow(entry.fromDate);
      if (!day) continue;
      const next = Number(limitOn(account, day)) || 0;
      const before = Number(limitOn(account, addDays(day, -1))) || 0;
      if (next === before) continue;
      items.push({
        day,
        kind: 'limit',
        title: `${name} limit ${next > before ? 'rises' : 'falls'}`,
        detail: before > 0 ? `From ${compactInr(before)} · DP + OD + TOD` : 'No limit before · DP + OD + TOD',
        amount: next,
      });
    }

    for (const entry of Array.isArray(account.interestRateLog) ? account.interestRateLog : []) {
      const day = inWindow(entry.fromDate);
      if (!day) continue;
      const next = getApplicableRate(account, day);
      const before = getApplicableRate(account, addDays(day, -1));
      if (next === before) continue;
      items.push({
        day,
        kind: 'rate',
        title: `${name} rate ${next > before ? 'rises' : 'falls'} to ${next}%`,
        detail: before > 0 ? `From ${before}% a year` : 'No rate before',
      });
    }
  }

  const monthEnd = startOfDay(endOfMonth(today));
  if (interestAccrued > 0 && monthEnd > startOfDay(today) && endOfDay(monthEnd) <= until) {
    items.push({
      day: monthEnd,
      kind: 'interest',
      title: 'Month-end interest',
      detail: 'Accrued on Cash Credit so far this month, est.',
      amount: interestAccrued,
    });
  }

  const order: Record<UpcomingKind, number> = { entries: 0, limit: 1, rate: 2, interest: 3 };
  return items.sort((a, b) => a.day.getTime() - b.day.getTime() || order[a.kind] - order[b.kind]);
}
