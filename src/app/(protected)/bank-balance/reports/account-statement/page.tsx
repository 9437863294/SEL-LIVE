'use client';
export const dynamic = 'force-dynamic';

/**
 * Account Statement — one account's entries in a date range with a running figure, from the ledger
 * engine: entries dated before the account's opening date are already inside the opening figure and
 * are left out, and internal transfers count toward the balance, marked as transfers.
 */

import { useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { endOfDay, startOfDay, subDays, subMonths } from 'date-fns';
import { ArrowDownLeft, ArrowUpRight, FileText, Flag, RefreshCw, Search, Wallet } from 'lucide-react';
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
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

interface StatementRow {
  id: string;
  date: Date;
  description: string;
  ref: string;
  debit: number;
  credit: number;
  figure: number;
  isContra: boolean;
}

export default function AccountStatementPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.Reports');
  const { accounts, transactions, isLoading, isRefreshing, refresh } = useBankData({ enabled: canView, transactions: true });

  const [pickedAccountId, setPickedAccountId] = useState('');
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

    let figure = opening;
    const rows: StatementRow[] = [];
    const totals = { receipts: 0, payments: 0, transfersIn: 0, transfersOut: 0 };
    for (const { txn, at, effect } of ledger.entries) {
      if (at < from || at > to) continue;
      figure += effect;
      const amount = Number(txn.amount) || 0;
      if (txn.isContra) {
        if (txn.type === 'Credit') totals.transfersIn += amount;
        else totals.transfersOut += amount;
      } else if (txn.type === 'Credit') totals.receipts += amount;
      else totals.payments += amount;
      rows.push({
        id: txn.id,
        date: at,
        description: txn.description,
        ref: txn.paymentRequestRefNo || txn.paymentRefNo || txn.utrNumber || '',
        debit: txn.type === 'Debit' ? amount : 0,
        credit: txn.type === 'Credit' ? amount : 0,
        figure,
        isContra: !!txn.isContra,
      });
    }
    return { opening, openingDay, startsAtOpening, closing: figure, rows, totals, from, to };
  }, [ledger, dateRange]);

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} />;
  if (!canView) return <BankAccessDenied title="Account Statement" what="this report" />;

  const cc = account ? isCashCredit(account) : false;
  const figureLabel = cc ? 'Utilisation' : 'Balance';
  const totalDebit = statement?.rows.reduce((s, r) => s + r.debit, 0) ?? 0;
  const totalCredit = statement?.rows.reduce((s, r) => s + r.credit, 0) ?? 0;
  const rangeLabel = statement ? `${formatDay(statement.from)} – ${formatDay(statement.to)}` : 'Pick a date range';

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
            hint={statement ? (statement.startsAtOpening ? `Opening figure on ${formatDay(statement.openingDay)}` : `Start of ${formatDay(statement.from)}`) : '—'}
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
            hint={statement ? `End of ${formatDay(statement.to)}` : '—'}
            icon={Wallet}
            tone={cc ? 'violet' : 'blue'}
            accent
          />
        </div>

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
          <Table className="w-full min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-40">Ref / UTR</TableHead>
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
                    <TableCell className="whitespace-nowrap">{formatDay(row.date)}</TableCell>
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
                    <TableCell className="whitespace-nowrap font-mono text-xs">{row.ref || '—'}</TableCell>
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
                  <TableCell colSpan={3}>Total · closing {figureLabel.toLowerCase()}</TableCell>
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
