'use client';
export const dynamic = 'force-dynamic';

/**
 * Transaction Summary — account-wise monthly receipts, payments and net, and the cashflow
 * statement (`reports/cashflow-statement` now redirects here): the grand-total rows of the pivot,
 * listed month by month below it.
 *
 * Entries come from the ledger engine, so an entry dated before its account's opening date (already
 * inside the opening figure) is not counted as a flow. Internal transfers are left out by default;
 * switched on, they count as the receipt / payment each leg is.
 *
 * Only what has happened is reported: months run up to the current one, which counts through today.
 * A post-dated cheque's Debit, dated after today, is left out of every figure until its date, and a
 * note says how much is waiting.
 */

import { Fragment, useMemo, useState } from 'react';
import { eachMonthOfInterval, endOfDay, endOfMonth, format, isSameMonth, parse, startOfMonth, subMonths } from 'date-fns';
import { ArrowDownLeft, ArrowUpRight, Building2, CalendarClock, CalendarRange, CreditCard, LayoutGrid, RefreshCw, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import {
  BANK_PAGE,
  BankAccessDenied,
  BankBalanceBackground,
  BankPageSkeleton,
  accountLabel,
  useBankData,
} from '@/components/bank-balance/page-kit';
import { useAuthorization } from '@/hooks/useAuthorization';
import { buildLedgers, formatDay, formatInr, isCashCredit } from '@/lib/bank-balance-ledger';
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

type RangeOption = '3' | '6' | '12' | 'ytd' | 'custom';

interface MonthCell {
  receipts: number;
  payments: number;
  count: number;
}

interface AccountSummaryRow {
  account: BankAccount;
  months: Record<string, MonthCell>;
  total: MonthCell;
}

const emptyCell = (): MonthCell => ({ receipts: 0, payments: 0, count: 0 });
const monthKey = (date: Date) => format(date, 'yyyy-MM');
const parseMonth = (value: string) => {
  const parsed = parse(value, 'yyyy-MM', new Date());
  return Number.isNaN(parsed.getTime()) ? null : startOfMonth(parsed);
};

/** The months to report, never past the current one: a custom range reaching ahead stops there. */
function getRangeMonths(option: RangeOption, customFrom: string, customTo: string): { start: Date; end: Date } {
  const today = new Date();
  const end = endOfMonth(today);
  if (option === 'custom') {
    const thisMonth = startOfMonth(today);
    const from = parseMonth(customFrom) ?? thisMonth;
    const to = parseMonth(customTo) ?? thisMonth;
    const [a, b] = from <= to ? [from, to] : [to, from];
    const last = b > thisMonth ? thisMonth : b;
    return { start: a > last ? last : a, end: endOfMonth(last) };
  }
  if (option === 'ytd') return { start: new Date(today.getFullYear(), 0, 1), end };
  return { start: startOfMonth(subMonths(today, Number(option) - 1)), end };
}

const netClass = (net: number) => (net < 0 ? 'text-rose-600' : net > 0 ? 'text-emerald-600' : 'text-muted-foreground');

export default function TransactionSummaryPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.Reports');
  const { accounts, transactions, isLoading, isRefreshing, refresh } = useBankData({ enabled: canView, transactions: true });

  const [rangeOption, setRangeOption] = useState<RangeOption>('6');
  const [customFrom, setCustomFrom] = useState(() => monthKey(subMonths(new Date(), 2)));
  const [customTo, setCustomTo] = useState(() => monthKey(new Date()));
  const [excludeContra, setExcludeContra] = useState(true);

  const ledgers = useMemo(() => buildLedgers<BankAccount, BankExpense>(accounts, transactions), [accounts, transactions]);

  const { months, summaryRows, grandMonths, grandTotal, postDated } = useMemo(() => {
    const { start, end } = getRangeMonths(rangeOption, customFrom, customTo);
    const monthDates = eachMonthOfInterval({ start, end });
    const keys = monthDates.map(monthKey);
    const todayEnd = endOfDay(new Date());
    // Entries dated after today — post-dated cheques — are not flows yet: counted here, not below.
    const waiting = emptyCell();

    const rows: AccountSummaryRow[] = [];
    for (const account of accounts) {
      const ledger = ledgers.get(account.id);
      if (!ledger) continue;
      const cells: Record<string, MonthCell> = Object.fromEntries(keys.map((key) => [key, emptyCell()]));
      const total = emptyCell();
      for (const { txn, at } of ledger.entries) {
        if (excludeContra && txn.isContra) continue;
        if (at > todayEnd) {
          const amount = Number(txn.amount) || 0;
          if (txn.type === 'Credit') waiting.receipts += amount;
          else waiting.payments += amount;
          waiting.count += 1;
          continue;
        }
        if (at < start || at > end) continue;
        const cell = cells[monthKey(at)];
        if (!cell) continue;
        const amount = Number(txn.amount) || 0;
        if (txn.type === 'Credit') {
          cell.receipts += amount;
          total.receipts += amount;
        } else {
          cell.payments += amount;
          total.payments += amount;
        }
        cell.count += 1;
        total.count += 1;
      }
      // Inactive accounts only when they moved money in the range.
      if (account.status === 'Active' || total.count > 0) rows.push({ account, months: cells, total });
    }

    const grand: Record<string, MonthCell> = Object.fromEntries(keys.map((key) => [key, emptyCell()]));
    const grandTotalCell = emptyCell();
    for (const row of rows) {
      for (const key of keys) {
        grand[key].receipts += row.months[key].receipts;
        grand[key].payments += row.months[key].payments;
        grand[key].count += row.months[key].count;
      }
      grandTotalCell.receipts += row.total.receipts;
      grandTotalCell.payments += row.total.payments;
      grandTotalCell.count += row.total.count;
    }

    return { months: monthDates, summaryRows: rows, grandMonths: grand, grandTotal: grandTotalCell, postDated: waiting };
  }, [accounts, ledgers, rangeOption, customFrom, customTo, excludeContra]);

  const cashflowRows = useMemo(
    () =>
      [...months].reverse().map((month) => {
        const cell = grandMonths[monthKey(month)] ?? emptyCell();
        return { id: monthKey(month), month, ...cell, net: cell.receipts - cell.payments };
      }),
    [months, grandMonths],
  );

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} blocks={2} />;
  if (!canView) return <BankAccessDenied title="Transaction Summary" what="this report" />;

  const today = new Date();
  const isCurrentMonth = (month: Date) => isSameMonth(month, today);
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  // The current month counts only through today, so the period says so.
  const periodLabel =
    firstMonth && lastMonth
      ? `${format(firstMonth, 'MMM yyyy')} – ${isCurrentMonth(lastMonth) ? formatDay(today) : format(lastMonth, 'MMM yyyy')}`
      : '—';
  const grandNet = grandTotal.receipts - grandTotal.payments;
  const postDatedAmounts = [
    postDated.payments ? `${formatInr(postDated.payments)} in payments` : '',
    postDated.receipts ? `${formatInr(postDated.receipts)} in receipts` : '',
  ].filter(Boolean);
  const postDatedNote =
    postDated.count > 0
      ? `Left out until their date: ${postDated.count} post-dated entr${postDated.count === 1 ? 'y' : 'ies'} dated after today${
          postDatedAmounts.length ? ` — ${postDatedAmounts.join(' and ')}` : ''
        }.`
      : null;

  const cashflowColumns: Array<ListColumn<(typeof cashflowRows)[number]>> = [
    {
      header: 'Month',
      mobile: 'title',
      cell: (row) => (
        <span className="whitespace-nowrap font-medium">
          {format(row.month, 'MMMM yyyy')}
          {isCurrentMonth(row.month) && <span className="ml-1.5 text-xs font-normal text-muted-foreground">to date</span>}
        </span>
      ),
    },
    {
      header: 'Net',
      align: 'right',
      mobile: 'aside',
      cell: (row) => <span className={cn('whitespace-nowrap font-semibold tabular-nums', netClass(row.net))}>{formatInr(row.net)}</span>,
    },
    { header: 'Receipts', align: 'right', cell: (row) => <span className="whitespace-nowrap tabular-nums text-emerald-700">{formatInr(row.receipts)}</span> },
    { header: 'Payments', align: 'right', cell: (row) => <span className="whitespace-nowrap tabular-nums text-rose-700">{formatInr(row.payments)}</span> },
    { header: 'Entries', align: 'right', cell: (row) => <span className="tabular-nums">{row.count || '—'}</span> },
  ];

  const toolbar = (
    <FilterBar
      activeCount={(rangeOption !== '6' ? 1 : 0) + (excludeContra ? 0 : 1)}
      onClear={() => {
        setRangeOption('6');
        setExcludeContra(true);
      }}
    >
      <Select value={rangeOption} onValueChange={(value) => setRangeOption(value as RangeOption)}>
        <SelectTrigger className="sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="3">Last 3 months</SelectItem>
          <SelectItem value="6">Last 6 months</SelectItem>
          <SelectItem value="12">Last 12 months</SelectItem>
          <SelectItem value="ytd">Year to date</SelectItem>
          <SelectItem value="custom">Custom months</SelectItem>
        </SelectContent>
      </Select>
      {rangeOption === 'custom' && (
        <>
          <Input type="month" aria-label="From month" max={monthKey(today)} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="sm:w-44" />
          <Input type="month" aria-label="To month" max={monthKey(today)} value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="sm:w-44" />
        </>
      )}
      <div className="flex h-10 items-center gap-2 rounded-md border px-3">
        <Switch id="summary-exclude-contra" checked={excludeContra} onCheckedChange={setExcludeContra} />
        <Label htmlFor="summary-exclude-contra" className="text-sm font-normal">
          Exclude internal transfers
        </Label>
      </div>
    </FilterBar>
  );

  return (
    <>
      <BankBalanceBackground tone="sky" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Transaction Summary"
          icon={LayoutGrid}
          description="Account-wise monthly receipts, payments and net, with the month-by-month cashflow statement."
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
          <KpiCard label="Receipts" value={formatInr(grandTotal.receipts)} hint={periodLabel} icon={ArrowDownLeft} tone="emerald" accent />
          <KpiCard label="Payments" value={formatInr(grandTotal.payments)} hint={periodLabel} icon={ArrowUpRight} tone="rose" accent />
          <KpiCard
            label="Net cashflow"
            value={formatInr(grandNet)}
            hint={excludeContra ? 'Internal transfers excluded' : 'Internal transfers included'}
            icon={Scale}
            tone={grandNet < 0 ? 'rose' : 'indigo'}
            accent
          />
          <KpiCard
            label="Months covered"
            value={months.length}
            hint={`${grandTotal.count} entr${grandTotal.count === 1 ? 'y' : 'ies'} · ${summaryRows.length} account${summaryRows.length === 1 ? '' : 's'}`}
            icon={CalendarRange}
            tone="cyan"
            accent
          />
        </div>

        {postDatedNote && (
          <p className="flex items-start gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
            {postDatedNote}
          </p>
        )}

        <TableCard
          title="Monthly breakdown by account"
          description={
            <>
              {periodLabel} · {months.length} month{months.length === 1 ? '' : 's'}
              {excludeContra ? ' · Internal transfers excluded' : ' · Internal transfers included'} · Receipts are credits, payments are debits
            </>
          }
          count={summaryRows.length}
          noun="account"
          toolbar={toolbar}
        >
          <Table className="w-max min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2} className="sticky left-0 !z-30 min-w-[180px] border-r">
                  Account
                </TableHead>
                {months.map((m) => (
                  <TableHead key={monthKey(m)} colSpan={3} className="border-l text-center">
                    {format(m, 'MMM yyyy')}
                    {isCurrentMonth(m) && <span className="ml-1 text-[10px] font-normal text-muted-foreground">to date</span>}
                  </TableHead>
                ))}
                <TableHead colSpan={3} className="border-l text-center">
                  Total
                </TableHead>
              </TableRow>
              <TableRow className="[&>th]:!top-[var(--table-head-h,2.5rem)]">
                {[...months.map(monthKey), 'total'].map((key) => (
                  <Fragment key={`${key}-sub`}>
                    <TableHead className="border-l text-right">Receipts</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </Fragment>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={1 + months.length * 3 + 3} className="py-12 text-center text-muted-foreground">
                    No accounts found.
                  </TableCell>
                </TableRow>
              ) : (
                summaryRows.map((row) => (
                  <TableRow key={row.account.id}>
                    <TableCell className="sticky left-0 z-[1] border-r bg-background font-medium">
                      <div className="flex items-center gap-1.5">
                        {isCashCredit(row.account) ? (
                          <CreditCard className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                        ) : (
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                        )}
                        <div className="min-w-0">
                          <p className="leading-none">
                            {accountLabel(row.account)}
                            {row.account.status !== 'Active' && <span className="ml-1 text-[10px] text-muted-foreground">(inactive)</span>}
                          </p>
                          <p className="mt-0.5 text-[10px] leading-none text-muted-foreground">{row.account.bankName}</p>
                        </div>
                      </div>
                    </TableCell>
                    {[...months.map(monthKey), 'total'].map((key) => {
                      const cell = key === 'total' ? row.total : row.months[key];
                      const net = cell.receipts - cell.payments;
                      const active = cell.count > 0;
                      return (
                        <Fragment key={key}>
                          <TableCell className={cn('whitespace-nowrap border-l text-right tabular-nums', active ? 'text-emerald-700' : 'text-muted-foreground', key === 'total' && 'font-medium')}>
                            {cell.receipts ? formatInr(cell.receipts) : '—'}
                          </TableCell>
                          <TableCell className={cn('whitespace-nowrap text-right tabular-nums', active ? 'text-rose-700' : 'text-muted-foreground', key === 'total' && 'font-medium')}>
                            {cell.payments ? formatInr(cell.payments) : '—'}
                          </TableCell>
                          <TableCell className={cn('whitespace-nowrap text-right font-medium tabular-nums', netClass(net))}>
                            {active ? formatInr(net) : '—'}
                          </TableCell>
                        </Fragment>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
            {summaryRows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="sticky left-0 z-[1] border-r bg-muted">Grand total</TableCell>
                  {[...months.map(monthKey), 'total'].map((key) => {
                    const cell = key === 'total' ? grandTotal : grandMonths[key];
                    const net = cell.receipts - cell.payments;
                    return (
                      <Fragment key={key}>
                        <TableCell className="whitespace-nowrap border-l text-right tabular-nums text-emerald-700">{formatInr(cell.receipts)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums text-rose-700">{formatInr(cell.payments)}</TableCell>
                        <TableCell className={cn('whitespace-nowrap text-right tabular-nums', netClass(net))}>{formatInr(net)}</TableCell>
                      </Fragment>
                    );
                  })}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </TableCard>

        <TableCard
          title="Cashflow statement"
          description="All accounts together, month by month — the grand-total rows above, newest month first."
          count={cashflowRows.length}
          noun="month"
          scroll="natural"
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Total for {periodLabel}</span>
              <span className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                <span className="text-emerald-700">Receipts {formatInr(grandTotal.receipts)}</span>
                <span className="text-rose-700">Payments {formatInr(grandTotal.payments)}</span>
                <span className={cn('font-semibold', netClass(grandNet))}>Net {formatInr(grandNet)}</span>
              </span>
            </div>
          }
        >
          <div className="p-3 sm:p-0">
            <DataList rows={cashflowRows} columns={cashflowColumns} dense frameless />
          </div>
        </TableCard>
      </div>
    </>
  );
}
