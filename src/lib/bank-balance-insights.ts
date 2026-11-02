import { addDays, startOfDay } from 'date-fns';
import {
  type AccountLedger,
  type LedgerAccount,
  dailyInterest,
  dailyRows,
  formatInr,
  getApplicableRate,
  isCashCredit,
  utilisationLevel,
} from './bank-balance-ledger.ts';

/**
 * Derived figures the Bank Balance dashboard shows beyond the raw ledgers: interest accrued so
 * far this month, the cash outlook over the booked entries ahead, and the "needs attention" list.
 *
 * Kept free of Firebase and React imports, like bank-balance-ledger, so plain node can test it
 * (tests/bank-balance-insights.test.mjs).
 */

/**
 * Interest accrued on Cash Credit utilisation between `from` and `to` inclusive: each day's closing
 * utilisation at that day's rate. Days before an account's opening date accrue nothing, and a
 * credit balance earns nothing (see `dailyInterest`).
 */
export function accruedCcInterest(ledgers: Array<AccountLedger>, from: Date, to: Date): number {
  let total = 0;
  for (const ledger of ledgers) {
    if (!isCashCredit(ledger.account)) continue;
    for (const row of dailyRows(ledger, from, to)) {
      if (!row.open) continue;
      total += dailyInterest(Math.max(0, row.closing), getApplicableRate(ledger.account, row.day));
    }
  }
  return total;
}

export interface OutlookPoint {
  day: Date;
  /** Total spendable at the day's close: current balances plus Cash Credit headroom. */
  available: number;
  /** Entries booked on that day (post-dated cheques and future-dated receipts included). */
  entries: number;
}

/**
 * The next `days` days of total spendable money, as already booked: each account's closing figure
 * per day — balance for a current account, limit in force that day less utilisation for Cash
 * Credit — summed across the ledgers given. A post-dated cheque's Debit sits on its instrument
 * date, so the curve dips where the books say it will; `lowest` is the tightest of these points.
 */
export function cashOutlook<A extends LedgerAccount>(
  ledgers: Array<AccountLedger<A>>,
  limitOn: (account: A, day: Date) => number,
  from: Date,
  days: number,
): { points: OutlookPoint[]; lowest: OutlookPoint | null } {
  const count = Math.max(0, Math.floor(days));
  if (count === 0) return { points: [], lowest: null };
  const start = startOfDay(from);
  const points: OutlookPoint[] = Array.from({ length: count }, (_, index) => ({ day: addDays(start, index), available: 0, entries: 0 }));

  for (const ledger of ledgers) {
    dailyRows(ledger, start, addDays(start, count - 1)).forEach((row, index) => {
      if (!row.open) return;
      points[index].entries += row.count;
      // A Cash Credit account in credit (negative utilisation) adds that credit on top of the limit.
      points[index].available += isCashCredit(ledger.account) ? limitOn(ledger.account, row.day) - row.closing : row.closing;
    });
  }

  let lowest: OutlookPoint | null = null;
  for (const point of points) if (!lowest || point.available < lowest.available) lowest = point;
  return { points, lowest };
}

export type AttentionSeverity = 'critical' | 'warning' | 'info';

/** Where acting on an item leads; the dashboard maps each target to a page it may link. */
export type AttentionTarget = 'utilisation' | 'limits' | 'cheques' | 'accounts';

export interface AttentionItem {
  severity: AttentionSeverity;
  text: string;
  target: AttentionTarget;
}

export interface AttentionInput {
  /** Active Cash Credit accounts: today's limit against what is drawn. */
  cc: Array<{ name: string; limit: number; utilised: number }>;
  /** Active current accounts and today's balance. */
  current: Array<{ name: string; balance: number }>;
  /** The Cheque Register's buckets; null when the viewer cannot see the register. */
  cheques?: { staleCount: number; staleAmount: number; dueSoonCount: number; dueSoonAmount: number } | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Everything on the books that needs a decision, worst first: limits breached or nearly so,
 * overdrawn current accounts, stale cheques, and post-dated cheques about to fall due. An empty
 * list means the dashboard can say "all clear".
 */
export function attentionItems({ cc, current, cheques }: AttentionInput): AttentionItem[] {
  const bySeverity: Record<AttentionSeverity, AttentionItem[]> = { critical: [], warning: [], info: [] };
  const add = (severity: AttentionSeverity, target: AttentionTarget, text: string) =>
    bySeverity[severity].push({ severity, target, text });

  for (const row of cc) {
    const utilised = Math.max(0, row.utilised);
    if (row.limit <= 0) continue; // listed once, below
    if (utilised > row.limit) {
      add('critical', 'utilisation', `${row.name} is over its limit by ${formatInr(utilised - row.limit, 0)}`);
      continue;
    }
    const pct = (utilised / row.limit) * 100;
    const level = utilisationLevel(pct);
    if (level === 'critical') add('critical', 'utilisation', `${row.name} at ${pct.toFixed(0)}% of its limit — ${formatInr(row.limit - utilised, 0)} left to draw`);
    else if (level === 'high') add('warning', 'utilisation', `${row.name} at ${pct.toFixed(0)}% of its limit`);
  }

  const withoutLimit = cc.filter((row) => row.limit <= 0);
  if (withoutLimit.length > 0) {
    add('info', 'limits', withoutLimit.length <= 2
      ? `No DP limit set for ${withoutLimit.map((row) => row.name).join(' and ')}`
      : `No DP limit set on ${withoutLimit.length} Cash Credit accounts`);
  }

  for (const row of current) {
    if (row.balance < 0) add('critical', 'accounts', `${row.name} is overdrawn by ${formatInr(-row.balance, 0)}`);
  }

  if (cheques?.staleCount) {
    add('warning', 'cheques', `${plural(cheques.staleCount, 'stale cheque')} worth ${formatInr(cheques.staleAmount, 0)} to reverse or revalidate`);
  }
  if (cheques?.dueSoonCount) {
    add('info', 'cheques', `${formatInr(cheques.dueSoonAmount, 0)} in post-dated cheques falls due within 7 days (${plural(cheques.dueSoonCount, 'cheque')})`);
  }

  return [...bySeverity.critical, ...bySeverity.warning, ...bySeverity.info];
}
