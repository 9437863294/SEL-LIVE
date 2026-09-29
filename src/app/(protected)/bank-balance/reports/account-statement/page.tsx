'use client';
export const dynamic = 'force-dynamic';

/**
 * Account Statement — one account's entries in a date range with a running figure, from the ledger
 * engine: entries dated before the account's opening date are already inside the opening figure and
 * are left out, and internal transfers count toward the balance, marked as transfers.
 *
 * A post-dated cheque's Debit is dated on the cheque date, after today. The default range and every
 * preset end today, so the statement shows what has happened; a custom range that runs past today
 * includes those entries, badged "Post-dated", and says its closing figure is projected.
 */

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { DateRange } from 'react-day-picker';
import { endOfDay, startOfDay, subDays, subMonths } from 'date-fns';
import { ArrowDownLeft, ArrowUpRight, CalendarClock, FileText, Flag, RefreshCw, Search, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import {
  BANK_PAGE,
  BankAccessDenied,
  BankBalanceBackground,
  BankDateRangeFilter,
  BankPageSkeleton,
  accountLabel,
  useBankData,
} from '@/components/bank-balance/page-kit';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { DateRangePreset } from '@/lib/date-range-presets';
import { balanceAt, buildLedger, formatDay, formatInr, isCashCredit } from '@/lib/bank-balance-ledger';
import { modeConfig } from '@/lib/bank-payments';
import { requisitionHref, voucherHref } from '@/lib/requisition-progress';
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

interface StatementRow {
  id: string;
  date: Date;
  description: string;
  /** The payment voucher the Debit was issued on (`bankPayments` id and BP/… number), if any. */
  bankPaymentId: string;
  voucherNo: string;
  /** Cheque / DD / batch number, and the mode it was paid by. */
  instrumentNo: string;
  method: string;
  /** Reception No. of the Daily Requisition it settles — or a plain request reference without one. */
  requestRef: string;
  requisitionId: string;
  utr: string;
  debit: number;
  credit: number;
  figure: number;
  isContra: boolean;
  /** Dated after today — a post-dated cheque that has not happened yet. */
  postDated: boolean;
}

/** What the instrument number is called on the mode it was paid by: "Cheque", "DD", "RTGS ref". */
function instrumentLabel(method: string) {
  if (!method) return 'Chq / Ref';
  const kind = modeConfig(method).kind;
  return kind === 'transfer' ? `${method} ref` : kind === 'draft' ? 'DD' : method;
}

const REF_LINK = 'text-primary underline-offset-2 hover:underline';

/** The entry's references, one labelled line each — voucher, instrument, reception, UTR. */
function ReferenceCell({ row }: { row: StatementRow }) {
  const items: Array<{ key: string; label: string; value: ReactNode }> = [];
  if (row.bankPaymentId || row.voucherNo) {
    const text = row.voucherNo || 'Open';
    items.push({
      key: 'voucher',
      label: 'Voucher',
      value: row.bankPaymentId ? (
        <Link href={voucherHref(row.bankPaymentId)} className={REF_LINK}>
          {text}
        </Link>
      ) : (
        text
      ),
    });
  }
  if (row.instrumentNo) items.push({ key: 'instrument', label: instrumentLabel(row.method), value: row.instrumentNo });
  if (row.requestRef) {
    items.push({
      key: 'request',
      label: row.requisitionId ? 'Reception' : 'Ref',
      value: row.requisitionId ? (
        <Link href={requisitionHref(row.requestRef)} className={REF_LINK}>
          {row.requestRef}
        </Link>
      ) : (
        row.requestRef
      ),
    });
  }
  if (row.utr) items.push({ key: 'utr', label: 'UTR', value: row.utr });
  if (!items.length) return <span className="text-muted-foreground">—</span>;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
      {items.map((item) => (
        <Fragment key={item.key}>
          <dt className="whitespace-nowrap text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-all font-mono">{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export default function AccountStatementPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.Reports');
  const { accounts, transactions, isLoading, isRefreshing, refresh } = useBankData({ enabled: canView, transactions: true });

  const [pickedAccountId, setPickedAccountId] = useState('');
  // Ends today, like every preset: post-dated entries show only in a custom range reaching past it.
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => ({ from: startOfDay(subMonths(new Date(), 1)), to: endOfDay(new Date()) }));
  const [datePreset, setDatePreset] = useState<DateRangePreset>('custom');

  // Active accounts first; the first of them is picked until the user chooses.
  const orderedAccounts = useMemo(
    () => [...accounts.filter((a) => a.status === 'Active'), ...accounts.filter((a) => a.status !== 'Active')],
    [accounts],
  );
  const account = orderedAccounts.find((a) => a.id === pickedAccountId) ?? orderedAccounts[0];

  const ledger = useMemo(
    () => (account ? buildLedger<BankAccount, BankExpense>(account, transactions.filter((t) => t.accountId === account.id)) : null),
    [account, transactions],
  );

  const statement = useMemo(() => {
    if (!ledger || !dateRange?.from) return null;
    const from = startOfDay(dateRange.from);
    const to = endOfDay(dateRange.to ?? dateRange.from);
    // From on or before the opening date, the statement opens on the opening figure itself.
    const startsAtOpening = !!ledger.start && from <= ledger.start;
    const opening = startsAtOpening ? ledger.opening : balanceAt(ledger, subDays(from, 1));
    const openingDay = startsAtOpening && ledger.start ? ledger.start : from;

    // Anything dated after today has not happened yet (a post-dated cheque's Debit sits on its date).
    const today = new Date();
    const todayEnd = endOfDay(today);
    const runsPastToday = to > todayEnd;
    // Then the opening figure already carries post-dated entries dated between today and `from`.
    const startsAfterToday = from > todayEnd;

    let figure = opening;
    const rows: StatementRow[] = [];
    const totals = { receipts: 0, payments: 0, transfersIn: 0, transfersOut: 0 };
    const postDated = { count: 0, amount: 0 };
    for (const { txn, at, effect } of ledger.entries) {
      if (at < from || at > to) continue;
      figure += effect;
      const amount = Number(txn.amount) || 0;
      if (txn.isContra) {
        if (txn.type === 'Credit') totals.transfersIn += amount;
        else totals.transfersOut += amount;
      } else if (txn.type === 'Credit') totals.receipts += amount;
      else totals.payments += amount;
      const isPostDated = at > todayEnd;
      if (isPostDated) {
        postDated.count += 1;
        postDated.amount += amount;
      }
      rows.push({
        id: txn.id,
        date: at,
        description: txn.description,
        bankPaymentId: txn.bankPaymentId || '',
        voucherNo: txn.voucherNo || '',
        instrumentNo: txn.paymentRefNo || '',
        method: txn.paymentMethod || '',
        requestRef: txn.paymentRequestRefNo || '',
        requisitionId: txn.requisitionId || '',
        utr: txn.utrNumber || '',
        debit: txn.type === 'Debit' ? amount : 0,
        credit: txn.type === 'Credit' ? amount : 0,
        figure,
        isContra: !!txn.isContra,
        postDated: isPostDated,
      });
    }
    return { opening, openingDay, startsAtOpening, closing: figure, rows, totals, from, to, today, runsPastToday, startsAfterToday, postDated };
  }, [ledger, dateRange]);

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} />;
  if (!canView) return <BankAccessDenied title="Account Statement" what="this report" />;

  const cc = account ? isCashCredit(account) : false;
  const figureLabel = cc ? 'Utilisation' : 'Balance';
  const totalDebit = statement?.rows.reduce((s, r) => s + r.debit, 0) ?? 0;
  const totalCredit = statement?.rows.reduce((s, r) => s + r.credit, 0) ?? 0;
  const rangeLabel = statement ? `${formatDay(statement.from)} – ${formatDay(statement.to)}` : 'Pick a date range';
  const figureWord = figureLabel.toLowerCase();
  const pd = statement?.postDated;
  const projectedNote = !statement?.runsPastToday
    ? null
    : statement.startsAfterToday
      ? `This range is after today (${formatDay(statement.today)}): its opening and closing ${figureWord} are projected from post-dated entries, not actual.`
      : pd && pd.count > 0
        ? `This range runs past today (${formatDay(statement.today)}): ${pd.count} post-dated entr${pd.count === 1 ? 'y' : 'ies'} of ${formatInr(pd.amount)} ${
            pd.count === 1 ? 'is' : 'are'
          } included, so the closing ${figureWord} is projected, not actual.`
        : `This range runs past today (${formatDay(statement.today)}), so the closing ${figureWord} is projected — no post-dated entries fall in it yet.`;

  const toolbar = (
    <FilterBar>
      <Select value={account?.id ?? ''} onValueChange={setPickedAccountId}>
        <SelectTrigger className="sm:w-72">
          <SelectValue placeholder="Select account…" />
        </SelectTrigger>
        <SelectContent>
          {orderedAccounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {accountLabel(a)} – {a.bankName} ({isCashCredit(a) ? 'CC' : 'CA'}){a.status !== 'Active' ? ' · inactive' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <BankDateRangeFilter
        range={dateRange}
        preset={datePreset}
        onChange={(range, preset) => {
          setDateRange(range);
          setDatePreset(preset);
        }}
      />
    </FilterBar>
  );

  return (
    <>
      <BankBalanceBackground tone="amber" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Account Statement"
          icon={FileText}
          description="One account's entries with a running balance — Cash Credit shown as utilisation."
          backHref="/bank-balance"
          backLabel="Back to dashboard"
          actions={
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={isRefreshing}>
              <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
              Refresh
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label={`Opening ${figureLabel.toLowerCase()}`}
            value={formatInr(statement?.opening ?? 0)}
            hint={
              statement
                ? statement.startsAtOpening
                  ? `Opening figure on ${formatDay(statement.openingDay)}`
                  : `${statement.startsAfterToday ? 'Projected, start' : 'Start'} of ${formatDay(statement.from)}`
                : '—'
            }
            icon={Flag}
            tone="amber"
            accent
          />
          <KpiCard
            label="Receipts"
            value={formatInr(statement?.totals.receipts ?? 0)}
            hint={statement?.totals.transfersIn ? `+ ${formatInr(statement.totals.transfersIn)} transfers in` : 'Credits, transfers excluded'}
            icon={ArrowDownLeft}
            tone="emerald"
            accent
          />
          <KpiCard
            label="Payments"
            value={formatInr(statement?.totals.payments ?? 0)}
            hint={statement?.totals.transfersOut ? `+ ${formatInr(statement.totals.transfersOut)} transfers out` : 'Debits, transfers excluded'}
            icon={ArrowUpRight}
            tone="rose"
            accent
          />
          <KpiCard
            label={`Closing ${figureLabel.toLowerCase()}`}
            value={formatInr(statement?.closing ?? 0)}
            hint={statement ? `${statement.runsPastToday ? 'Projected, end' : 'End'} of ${formatDay(statement.to)}` : '—'}
            icon={Wallet}
            tone={cc ? 'violet' : 'blue'}
            accent
          />
        </div>

        {projectedNote && (
          <p className="flex items-start gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
            {projectedNote}
          </p>
        )}

        <TableCard
          title={account ? `${accountLabel(account)} — ${account.bankName}` : 'Select an account'}
          description={
            account ? (
              <>
                {account.accountType} · {account.accountNumber} · {rangeLabel}
              </>
            ) : undefined
          }
          count={statement?.rows.length ?? 0}
          noun="transaction"
          actions={account ? <StatusBadge status={account.status} /> : undefined}
          toolbar={toolbar}
        >
          <Table className="w-full min-w-[880px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-56">Reference</TableHead>
                <TableHead className="w-36 text-right">Debit</TableHead>
                <TableHead className="w-36 text-right">Credit</TableHead>
                <TableHead className="w-40 text-right">{figureLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statement && (
                <TableRow className="bg-muted">
                  <TableCell className="whitespace-nowrap font-medium">{formatDay(statement.openingDay)}</TableCell>
                  <TableCell colSpan={4} className="font-medium">
                    {statement.startsAtOpening ? `Opening ${figureLabel.toLowerCase()} (account opening date)` : `Opening ${figureLabel.toLowerCase()}`}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{formatInr(statement.opening)}</TableCell>
                </TableRow>
              )}
              {!statement || statement.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="h-8 w-8 opacity-30" />
                      <p className="text-sm">{statement ? 'No transactions in this period.' : 'Pick an account and a date range.'}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                statement.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        <span>{formatDay(row.date)}</span>
                        {row.postDated && (
                          <Badge variant="info" title="Dated after today — it has not happened yet">
                            Post-dated
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <div className="flex items-start gap-2">
                        <span className="line-clamp-2 min-w-0">{row.description || '—'}</span>
                        {row.isContra && (
                          <Badge variant="progress" className="shrink-0">
                            Transfer
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <ReferenceCell row={row} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-rose-600">{row.debit ? formatInr(row.debit) : '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-600">{row.credit ? formatInr(row.credit) : '—'}</TableCell>
                    <TableCell className={cn('whitespace-nowrap text-right font-medium tabular-nums', row.figure < 0 && 'text-rose-600')}>
                      {formatInr(row.figure)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {statement && statement.rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>
                    Total · {statement.runsPastToday ? 'projected ' : ''}closing {figureWord}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums text-rose-700">{formatInr(totalDebit)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-700">{formatInr(totalCredit)}</TableCell>
                  <TableCell className={cn('whitespace-nowrap text-right tabular-nums', statement.closing < 0 && 'text-rose-700')}>
                    {formatInr(statement.closing)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </TableCard>
      </div>
    </>
  );
}
