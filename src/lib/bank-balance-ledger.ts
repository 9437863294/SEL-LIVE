import { addDays, endOfDay, format, isValid, parseISO, startOfDay, subDays } from 'date-fns';

/**
 * The one Bank Balance calculation engine.
 *
 * Every page used to run its own copy of "opening figure plus every entry", and the copies
 * disagreed: the reports ignored `openingDate` while the dashboard and Daily Log honoured it, one
 * report dropped internal transfers from Cash Credit utilisation, four rate look-ups differed on
 * whether a rate's `toDate` counts, and the same figure was shown with 0 or 2 decimals. The rules,
 * once, here:
 *
 *  - An account's figure runs in its own sign. Cash Credit: utilisation — a Debit draws on the
 *    limit (+), a Credit repays it (−). Current Account: balance — Credit +, Debit −.
 *  - The opening figure (`openingUtilization` / `openingBalance`) is the position at the start of
 *    `openingDate`. Entries dated before it are already inside that figure and are ignored. An
 *    account with no opening date counts every entry.
 *  - Internal transfers (contra legs) move money like any other entry and always count toward the
 *    balance. They are reported separately from receipts and payments, never dropped.
 *  - Dated logs (DP limits, interest rates) are read by calendar day in local time: an entry
 *    applies from `fromDate` through `toDate` inclusive, open-ended when `toDate` is null.
 *
 * Kept free of Firebase and React imports so it can be tested with plain node.
 */

export interface LedgerAccount {
  id: string;
  accountType: 'Current Account' | 'Cash Credit';
  status?: 'Active' | 'Inactive';
  openingBalance?: number;
  openingUtilization?: number;
  openingDate?: string | null;
  interestRateLog?: Array<{ fromDate: string; toDate: string | null; rate: number }>;
}

export interface LedgerTxn {
  accountId: string;
  amount: number;
  type: 'Debit' | 'Credit';
  isContra?: boolean;
  /** A Firestore Timestamp or a Date. */
  date: { toDate(): Date } | Date;
}

export const isCashCredit = (account: Pick<LedgerAccount, 'accountType'>) => account.accountType === 'Cash Credit';

export const txnDate = (txn: Pick<LedgerTxn, 'date'>): Date =>
  txn.date instanceof Date ? txn.date : txn.date.toDate();

/**
 * The entry's date, or null when the document has none that can be read (a missing `date` field,
 * or a Timestamp that converts to an Invalid Date — imported or hand-edited rows).
 *
 * The ledger drops such an entry rather than carrying it: an Invalid Date compares false against
 * everything, so it used to be added to `balanceAt` (every comparison that would have stopped it
 * failed) while `dailyRows` stalled its cursor on it and silently dropped every LATER entry for
 * that account. One unreadable row made the dashboard and the Daily Log disagree.
 */
function entryDate(txn: Pick<LedgerTxn, 'date'>): Date | null {
  const value = txn.date as unknown;
  if (!value) return null;
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      date = (value as { toDate(): Date }).toDate();
    } catch {
      return null;
    }
  } else return null;
  return date instanceof Date && isValid(date) ? date : null;
}

/** A `yyyy-MM-dd` string as the start of that day in local time, or null when blank/invalid. */
export function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? startOfDay(parsed) : null;
}

export const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');

export const accountStartDate = (account: Pick<LedgerAccount, 'openingDate'>) => parseDay(account.openingDate);

export const openingFigure = (account: LedgerAccount) =>
  (isCashCredit(account) ? account.openingUtilization : account.openingBalance) || 0;

/** What one entry does to the account's running figure (see the sign rule above). */
export function signedEffect(account: Pick<LedgerAccount, 'accountType'>, txn: Pick<LedgerTxn, 'type' | 'amount'>): number {
  const amount = Number(txn.amount) || 0;
  if (isCashCredit(account)) return txn.type === 'Debit' ? amount : -amount;
  return txn.type === 'Credit' ? amount : -amount;
}

export interface LedgerEntry<T extends LedgerTxn = LedgerTxn> {
  txn: T;
  at: Date;
  effect: number;
}

export interface AccountLedger<A extends LedgerAccount = LedgerAccount, T extends LedgerTxn = LedgerTxn> {
  account: A;
  /** Start of `openingDate`; null when the account has none. */
  start: Date | null;
  opening: number;
  /** Entries on or after `start`, oldest first. */
  entries: Array<LedgerEntry<T>>;
}

/** Every account's ledger, built in one pass over the transactions. */
export function buildLedgers<A extends LedgerAccount, T extends LedgerTxn>(accounts: A[], txns: T[]): Map<string, AccountLedger<A, T>> {
  const ledgers = new Map<string, AccountLedger<A, T>>();
  for (const account of accounts) {
    ledgers.set(account.id, { account, start: accountStartDate(account), opening: openingFigure(account), entries: [] });
  }
  for (const txn of txns) {
    const ledger = ledgers.get(txn.accountId);
    if (!ledger) continue;
    const at = entryDate(txn);
    if (!at) continue;
    if (ledger.start && at < ledger.start) continue;
    ledger.entries.push({ txn, at, effect: signedEffect(ledger.account, txn) });
  }
  for (const ledger of ledgers.values()) ledger.entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  return ledgers;
}

export const buildLedger = <A extends LedgerAccount, T extends LedgerTxn>(account: A, txns: T[]) =>
  buildLedgers([account], txns).get(account.id) as AccountLedger<A, T>;

/**
 * The running figure at the end of `day` (inclusive of every entry that day). Before the opening
 * date the account has no figure yet, which reads as 0.
 */
export function balanceAt(ledger: AccountLedger, day: Date = new Date()): number {
  const end = endOfDay(day);
  if (ledger.start && end < ledger.start) return 0;
  let figure = ledger.opening;
  for (const entry of ledger.entries) {
    if (entry.at > end) break;
    figure += entry.effect;
  }
  return figure;
}

/**
 * The tightest point from `fromDay` on: what can be spent at the end of `fromDay`, and again after
 * each later day that has entries (post-dated cheques already on the books included). A payment on
 * `fromDay` must fit under the lowest of these, or a cheque dated later would bounce.
 *
 * `availableOn(day, figure)` turns the running figure into spendable funds — the balance itself for
 * a current account; limit in force on `day` less utilisation for Cash Credit.
 */
export function lowestAvailableFrom(
  ledger: AccountLedger,
  fromDay: Date,
  availableOn: (day: Date, figure: number) => number,
): { amount: number; day: Date } {
  // Before its opening date the account has no position yet — `balanceAt` reads 0 there, and
  // adding the later entries to that 0 dropped the opening figure, overstating the funds by it.
  // The scan therefore starts no earlier than the opening date.
  const base = ledger.start && startOfDay(fromDay) < ledger.start ? ledger.start : startOfDay(fromDay);
  const first = endOfDay(base);
  let figure = balanceAt(ledger, base);
  let lowest = { amount: availableOn(base, figure), day: base };
  const later = ledger.entries.filter((entry) => entry.at > first);
  for (let i = 0; i < later.length; i += 1) {
    figure += later[i].effect;
    const day = startOfDay(later[i].at);
    const lastOfDay = i === later.length - 1 || startOfDay(later[i + 1].at).getTime() !== day.getTime();
    if (!lastOfDay) continue;
    const amount = availableOn(day, figure);
    if (amount < lowest.amount) lowest = { amount, day };
  }
  return lowest;
}

/** Each account's figure at the end of `day`. */
export function balancesAt(ledgers: Map<string, AccountLedger>, day: Date = new Date()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, ledger] of ledgers) out[id] = balanceAt(ledger, day);
  return out;
}

export interface DailyRow {
  day: Date;
  key: string;
  /** False for days before the account's opening date: every figure is 0 and means "no data". */
  open: boolean;
  opening: number;
  /** Money in / out, internal transfers excluded. */
  receipts: number;
  payments: number;
  /** Internal transfer legs: in = Credit, out = Debit. */
  transfersIn: number;
  transfersOut: number;
  closing: number;
  count: number;
}

/** One row per calendar day from `from` to `to`, in a single pass over the ledger. */
export function dailyRows(ledger: AccountLedger, from: Date, to: Date): DailyRow[] {
  const first = startOfDay(from);
  const last = startOfDay(to);
  const rows: DailyRow[] = [];
  if (first > last) return rows;

  // Carry the figure forward to the start of the range.
  let figure = ledger.opening;
  let cursor = 0;
  while (cursor < ledger.entries.length && ledger.entries[cursor].at < first) figure += ledger.entries[cursor++].effect;

  for (let day = first; day <= last; day = addDays(day, 1)) {
    const end = endOfDay(day);
    const open = !ledger.start || end >= ledger.start;
    const row: DailyRow = { day, key: dayKey(day), open, opening: open ? figure : 0, receipts: 0, payments: 0, transfersIn: 0, transfersOut: 0, closing: 0, count: 0 };
    while (cursor < ledger.entries.length && ledger.entries[cursor].at <= end) {
      const { txn, effect } = ledger.entries[cursor++];
      const amount = Number(txn.amount) || 0;
      if (txn.isContra) {
        if (txn.type === 'Credit') row.transfersIn += amount;
        else row.transfersOut += amount;
      } else if (txn.type === 'Credit') row.receipts += amount;
      else row.payments += amount;
      row.count += 1;
      figure += effect;
    }
    row.closing = open ? figure : 0;
    rows.push(row);
  }
  return rows;
}

/** Whether a dated log entry (DP limit, interest rate) is in force on `day`. */
export function entryAppliesOn(entry: { fromDate: string; toDate: string | null }, day: Date): boolean {
  const from = parseDay(entry.fromDate);
  if (!from) return false;
  const target = startOfDay(day);
  const to = parseDay(entry.toDate);
  return from <= target && (!to || to >= target);
}

/** The interest rate (% per annum) in force on `day`, or 0 when none is. */
export function getApplicableRate(account: Pick<LedgerAccount, 'interestRateLog'>, day: Date): number {
  const log = Array.isArray(account.interestRateLog) ? account.interestRateLog : [];
  const entry = [...log].sort((a, b) => b.fromDate.localeCompare(a.fromDate)).find((item) => entryAppliesOn(item, day));
  return Number(entry?.rate) || 0;
}

/** One day's interest on a Cash Credit utilisation. A credit balance earns no interest. */
export const dailyInterest = (utilised: number, ratePercent: number) =>
  utilised > 0 && ratePercent > 0 ? (utilised * ratePercent) / 100 / 365 : 0;

/**
 * A dated log newest first, each entry closing the day before the next one starts and the newest
 * left open-ended. Rebuilt on every add and delete, so a back-dated entry slots into the middle
 * and deleting one leaves no gap. Returns new objects; the input is not modified.
 */
export function normaliseDatedLog<T extends { fromDate: string; toDate: string | null }>(entries: T[]): T[] {
  return [...entries]
    .sort((a, b) => b.fromDate.localeCompare(a.fromDate))
    .map((entry, index, sorted) => ({
      ...entry,
      toDate: index === 0 ? null : dayKey(subDays(parseISO(sorted[index - 1].fromDate), 1)),
    }));
}

export type UtilisationLevel = 'critical' | 'high' | 'moderate' | 'healthy';

/** One set of thresholds for every utilisation badge and colour in the module. */
export function utilisationLevel(percent: number): UtilisationLevel {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'high';
  if (percent >= 50) return 'moderate';
  return 'healthy';
}

export const UTILISATION_LABEL: Record<UtilisationLevel, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  healthy: 'Healthy',
};

const inrFormatters = new Map<number, Intl.NumberFormat>();

/** Rupees, as every table in the module shows them: two decimals unless told otherwise. */
export function formatInr(value: number | null | undefined, decimals = 2): string {
  let formatter = inrFormatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    inrFormatters.set(decimals, formatter);
  }
  return formatter.format(Number(value) || 0);
}

/** Axis- and tile-sized rupees in the units a treasury desk reads: crore, lakh, thousand. */
export function compactInr(input: number): string {
  // Guarded like formatInr: an unset or non-numeric figure reads as ₹0, never "₹NaN".
  const value = Number(input) || 0;
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  const trim = (n: number) => String(Number(n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)));
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)} K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** The module's one date format for tables and headers. */
export const formatDay = (value: Date | string | null | undefined): string => {
  if (!value) return '—';
  // An Invalid Date reads as "no date", like a blank string: `format` throws on one.
  const date = value instanceof Date ? (isValid(value) ? value : null) : parseDay(value);
  return date ? format(date, 'dd MMM yyyy') : '—';
};
