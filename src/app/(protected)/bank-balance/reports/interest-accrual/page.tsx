'use client';
export const dynamic = 'force-dynamic';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, Coins, Info, Landmark, Percent, ReceiptText, RefreshCw } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
  startOfMonth,
  subMonths,
} from 'date-fns';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import {
  BANK_PAGE,
  BankAccessDenied,
  BankBalanceBackground,
  BankDateRangeFilter,
  BankPageSkeleton,
  accountLabel,
  useBankData,
} from '@/components/bank-balance/page-kit';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { getDateRangeFromPreset, type DateRangePreset } from '@/lib/date-range-presets';
import {
  buildLedgers,
  compactInr,
  dailyInterest,
  dailyRows,
  formatDay,
  formatInr,
  getApplicableRate,
  isCashCredit,
} from '@/lib/bank-balance-ledger';
import type { MonthlyInterestData } from '@/lib/types';

type MonthRange = '6' | '12' | 'fy' | '24';

const MONTH_RANGES: Array<{ value: MonthRange; label: string }> = [
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
  { value: 'fy', label: 'This FY' },
  { value: '24', label: 'Last 24 months' },
];

/** One account on one day: null before the account's opening date (no figure yet). */
type DayCell = { utilised: number; rate: number; interest: number } | null;

type MonthCell = { projected: number; actual: number | null; diff: number | null };

const monthKeyOf = (day: Date) => format(day, 'yyyy-MM');

const formatRate = (rate: number) => `${(Number(rate) || 0).toFixed(2)}%`;

/** A stored actual counts once it is a real, non-zero figure: blank entries were saved as 0. */
const storedActual = (doc: MonthlyInterestData | undefined, accountId: string): number | null => {
  const value = Number(doc?.[accountId]?.actual);
  return Number.isFinite(value) && value !== 0 ? value : null;
};

/** Over the projection costs more than planned (rose); under it is a saving (emerald). */
const diffClass = (diff: number | null) =>
  diff === null || Math.abs(diff) < 0.005 ? 'text-muted-foreground' : diff > 0 ? 'text-rose-600' : 'text-emerald-600';

const signedInr = (value: number | null) =>
  value === null ? '—' : `${value > 0.005 ? '+' : value < -0.005 ? '−' : ''}${formatInr(Math.abs(value))}`;

export default function InterestReportPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const canView = can('View', 'Bank Balance.Reports');
  const canEnterActual = can('View', 'Bank Balance.Monthly Interest');

  const { accounts, transactions, isLoading, loadedAt, refresh } = useBankData({
    enabled: !authLoading && canView,
    transactions: true,
  });

  const [interestDocs, setInterestDocs] = useState<Record<string, MonthlyInterestData>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tab, setTab] = useState<'monthly' | 'daily'>('monthly');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [monthRange, setMonthRange] = useState<MonthRange>('6');
  const [dailyRange, setDailyRange] = useState<DateRange | undefined>(() => getDateRangeFromPreset('thisMonth'));
  const [dailyPreset, setDailyPreset] = useState<DateRangePreset>('thisMonth');
  const [dailyAccount, setDailyAccount] = useState('all');

  const loadInterestDocs = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'monthlyInterest'));
      const next: Record<string, MonthlyInterestData> = {};
      snap.forEach((d) => {
        next[d.id] = d.data() as MonthlyInterestData;
      });
      setInterestDocs(next);
    } catch (error) {
      console.error('Error loading monthly interest:', error);
      toast({ title: 'Error', description: 'Failed to load the actual interest figures.', variant: 'destructive' });
    }
  }, [toast]);

  useEffect(() => {
    if (!authLoading && canView) void loadInterestDocs();
  }, [authLoading, canView, loadInterestDocs]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refresh(), loadInterestDocs()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const today = useMemo(() => startOfDay(loadedAt ?? new Date()), [loadedAt]);

  const allCc = useMemo(() => accounts.filter(isCashCredit), [accounts]);
  const inactiveCount = allCc.filter((acc) => acc.status === 'Inactive').length;
  const ccAccounts = useMemo(
    () => allCc.filter((acc) => includeInactive || acc.status !== 'Inactive'),
    [allCc, includeInactive],
  );

  // The months of the Monthly tab, newest first.
  const months = useMemo(() => {
    const oldest =
      monthRange === 'fy'
        ? startOfMonth(getDateRangeFromPreset('thisFY', today).from ?? today)
        : startOfMonth(subMonths(today, Number(monthRange) - 1));
    const out: Date[] = [];
    for (let m = startOfMonth(today); m >= oldest; m = subMonths(m, 1)) out.push(m);
    return out;
  }, [monthRange, today]);

  const { dailyFrom, dailyTo } = useMemo(() => {
    const from = dailyRange?.from ? startOfDay(dailyRange.from) : startOfMonth(today);
    const to = dailyRange?.to ? startOfDay(dailyRange.to) : dailyRange?.from ? from : today;
    return { dailyFrom: from, dailyTo: to };
  }, [dailyRange, today]);

  // One span covers every figure on the page: the oldest month shown, last month (for the KPI) and
  // the daily range. Each account's ledger is walked once over it.
  const spanStart = useMemo(() => {
    const candidates = [months[months.length - 1], startOfMonth(subMonths(today, 1)), dailyFrom < today ? dailyFrom : today];
    return new Date(Math.min(...candidates.map((d) => d.getTime())));
  }, [months, today, dailyFrom]);

  const ledgers = useMemo(() => buildLedgers(allCc, transactions), [allCc, transactions]);

  const series = useMemo(() => {
    const byAccount = new Map<string, DayCell[]>();
    for (const acc of allCc) {
      const ledger = ledgers.get(acc.id);
      if (!ledger) continue;
      byAccount.set(
        acc.id,
        dailyRows(ledger, spanStart, today).map((row) => {
          if (!row.open) return null;
          const rate = getApplicableRate(acc, row.day);
          return { utilised: row.closing, rate, interest: dailyInterest(row.closing, rate) };
        }),
      );
    }
    return byAccount;
  }, [allCc, ledgers, spanStart, today]);

  // Projected interest per month per account: the sum of each day's interest.
  const projectedByMonth = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    const keys: string[] = [];
    for (let day = spanStart; day <= today; day = addDays(day, 1)) keys.push(monthKeyOf(day));
    for (const [accountId, cells] of series) {
      cells.forEach((cell, index) => {
        if (!cell) return;
        const key = keys[index];
        out[key] ??= {};
        out[key][accountId] = (out[key][accountId] || 0) + cell.interest;
      });
    }
    return out;
  }, [series, spanStart, today]);

  const monthCell = useCallback(
    (key: string, accountId: string): MonthCell => {
      const projected = projectedByMonth[key]?.[accountId] || 0;
      const actual = storedActual(interestDocs[key], accountId);
      return { projected, actual, diff: actual === null ? null : actual - projected };
    },
    [projectedByMonth, interestDocs],
  );

  const monthlyRows = useMemo(
    () =>
      months.map((month) => {
        const key = monthKeyOf(month);
        const cells = ccAccounts.map((acc) => monthCell(key, acc.id));
        const withActual = cells.filter((cell) => cell.actual !== null);
        return {
          key,
          month,
          cells,
          projected: cells.reduce((sum, cell) => sum + cell.projected, 0),
          actual: withActual.length ? withActual.reduce((sum, cell) => sum + (cell.actual || 0), 0) : null,
          diff: withActual.length ? withActual.reduce((sum, cell) => sum + (cell.diff || 0), 0) : null,
        };
      }),
    [months, ccAccounts, monthCell],
  );

  const monthlyTotals = useMemo(() => {
    const perAccount = ccAccounts.map((_, index) => {
      const cells = monthlyRows.map((row) => row.cells[index]);
      const withActual = cells.filter((cell) => cell.actual !== null);
      return {
        projected: cells.reduce((sum, cell) => sum + cell.projected, 0),
        actual: withActual.length ? withActual.reduce((sum, cell) => sum + (cell.actual || 0), 0) : null,
        diff: withActual.length ? withActual.reduce((sum, cell) => sum + (cell.diff || 0), 0) : null,
      };
    });
    const withActual = monthlyRows.filter((row) => row.actual !== null);
    return {
      perAccount,
      projected: monthlyRows.reduce((sum, row) => sum + row.projected, 0),
      actual: withActual.length ? withActual.reduce((sum, row) => sum + (row.actual || 0), 0) : null,
      diff: withActual.length ? withActual.reduce((sum, row) => sum + (row.diff || 0), 0) : null,
    };
  }, [ccAccounts, monthlyRows]);

  const kpis = useMemo(() => {
    const thisKey = monthKeyOf(today);
    const lastKey = monthKeyOf(subMonths(today, 1));
    const lastCells = ccAccounts.map((acc) => monthCell(lastKey, acc.id));
    const lastWithActual = lastCells.filter((cell) => cell.actual !== null);
    const rates = ccAccounts.map((acc) => getApplicableRate(acc, today)).filter((rate) => rate > 0);
    return {
      projectedThisMonth: ccAccounts.reduce((sum, acc) => sum + (projectedByMonth[thisKey]?.[acc.id] || 0), 0),
      lastMonthLabel: format(subMonths(today, 1), 'MMMM yyyy'),
      actualLastMonth: lastWithActual.length ? lastWithActual.reduce((sum, cell) => sum + (cell.actual || 0), 0) : null,
      projectedLastMonth: lastCells.reduce((sum, cell) => sum + cell.projected, 0),
      averageRate: rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null,
      ratedAccounts: rates.length,
    };
  }, [ccAccounts, monthCell, projectedByMonth, today]);

  // The Daily tab: newest day first, never past today (there is nothing to project yet).
  const dailyAccounts = useMemo(() => {
    const picked = ccAccounts.find((acc) => acc.id === dailyAccount);
    return picked ? [picked] : ccAccounts;
  }, [ccAccounts, dailyAccount]);

  const dailyTable = useMemo(() => {
    const last = dailyTo > today ? today : dailyTo;
    const first = dailyFrom < spanStart ? spanStart : dailyFrom;
    const rows: Array<{ day: Date; cells: DayCell[]; total: number }> = [];
    for (let day = last; day >= first; day = addDays(day, -1)) {
      const index = differenceInCalendarDays(day, spanStart);
      const cells = dailyAccounts.map((acc) => series.get(acc.id)?.[index] ?? null);
      rows.push({ day, cells, total: cells.reduce((sum, cell) => sum + (cell?.interest || 0), 0) });
    }
    return {
      rows,
      perAccount: dailyAccounts.map((_, i) => rows.reduce((sum, row) => sum + (row.cells[i]?.interest || 0), 0)),
      total: rows.reduce((sum, row) => sum + row.total, 0),
    };
  }, [dailyAccounts, dailyFrom, dailyTo, series, spanStart, today]);

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} blocks={1} />;

  if (!canView) return <BankAccessDenied title="Interest Report" what="the interest report" />;

  const thisMonthLabel = format(today, 'MMMM');
  const lastMonthDiff = kpis.actualLastMonth === null ? null : kpis.actualLastMonth - kpis.projectedLastMonth;

  return (
    <>
      <BankBalanceBackground tone="violet" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Interest Report"
          description="Projected interest on every Cash Credit account, day by day and month by month, against what the bank actually charged."
          icon={Percent}
          backHref="/bank-balance"
          backLabel="Back to dashboard"
          actions={
            <>
              <Button variant="outline" onClick={() => void handleRefresh()} disabled={isRefreshing}>
                <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
                Refresh
              </Button>
              {canEnterActual && (
                <Button asChild>
                  <Link href="/bank-balance/monthly-interest">
                    <ReceiptText className="mr-2 h-4 w-4" />
                    Enter actual interest
                  </Link>
                </Button>
              )}
            </>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Projected interest this month"
            value={formatInr(kpis.projectedThisMonth)}
            hint={`${thisMonthLabel} to date (${format(today, 'd MMM')})`}
            icon={Coins}
            tone="violet"
            accent
          />
          <KpiCard
            label="Actual interest last month"
            value={kpis.actualLastMonth === null ? '—' : formatInr(kpis.actualLastMonth)}
            hint={
              kpis.actualLastMonth === null
                ? `${kpis.lastMonthLabel}: not entered yet · ${compactInr(kpis.projectedLastMonth)} projected`
                : `${kpis.lastMonthLabel} vs ${compactInr(kpis.projectedLastMonth)} projected (${lastMonthDiff !== null && lastMonthDiff > 0 ? '+' : lastMonthDiff !== null && lastMonthDiff < 0 ? '−' : ''}${compactInr(Math.abs(lastMonthDiff ?? 0))})`
            }
            icon={ReceiptText}
            tone={lastMonthDiff !== null && lastMonthDiff > 0.005 ? 'rose' : 'emerald'}
            accent
          />
          <KpiCard
            label="Average rate in force today"
            value={kpis.averageRate === null ? '—' : formatRate(kpis.averageRate)}
            hint={
              kpis.ratedAccounts
                ? `Simple mean of ${kpis.ratedAccounts} account${kpis.ratedAccounts === 1 ? '' : 's'} with a rate`
                : 'No rate in force today'
            }
            icon={Percent}
            tone="indigo"
            accent
          />
          <KpiCard
            label="Cash Credit accounts"
            value={ccAccounts.length}
            hint={inactiveCount ? `${inactiveCount} inactive ${includeInactive ? 'included' : 'hidden'}` : 'All active'}
            icon={Landmark}
            tone="blue"
            accent
          />
        </div>

        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Projected interest is each day&apos;s closing utilisation × the rate in force that day ÷ 365, summed over the
            month. Internal transfers count toward utilisation, and a credit balance earns nothing. Actual figures are the
            amounts entered on the Monthly Interest page; the bank&apos;s own method may differ.
          </p>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as 'monthly' | 'daily')} className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
              <TabsTrigger value="daily">Daily</TabsTrigger>
            </TabsList>
            {inactiveCount > 0 && (
              <div className="flex items-center gap-2">
                <Switch id="include-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
                <Label htmlFor="include-inactive" className="text-sm font-normal">
                  Include inactive accounts
                </Label>
              </div>
            )}
          </div>

          <TabsContent value="monthly" className="mt-0">
            <TableCard
              icon={CalendarDays}
              title="Projected vs actual, by month"
              description="Diff is actual minus projected: red when the bank charged more than projected, green when less."
              count={monthlyRows.length}
              noun="month"
              toolbar={
                <FilterBar>
                  <Select value={monthRange} onValueChange={(value) => setMonthRange(value as MonthRange)}>
                    <SelectTrigger className="sm:w-44" aria-label="Months shown">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_RANGES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterBar>
              }
            >
              {ccAccounts.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">No Cash Credit accounts to report on.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead rowSpan={2} className="left-0 !z-20 border-r align-bottom">
                        Month
                      </TableHead>
                      {ccAccounts.map((acc) => (
                        <TableHead key={acc.id} colSpan={3} className="whitespace-nowrap border-r text-center">
                          {accountLabel(acc)}
                        </TableHead>
                      ))}
                      <TableHead colSpan={3} className="text-center">
                        Total
                      </TableHead>
                    </TableRow>
                    <TableRow className="[&>th]:!top-[var(--table-head-h,2.5rem)]">
                      {[...ccAccounts.map((acc) => acc.id), 'total'].map((id, index, all) => (
                        <Fragment key={id}>
                          <TableHead className="whitespace-nowrap text-right">Projected</TableHead>
                          <TableHead className="whitespace-nowrap text-right">Actual</TableHead>
                          <TableHead className={cn('whitespace-nowrap text-right', index < all.length - 1 && 'border-r')}>
                            Diff
                          </TableHead>
                        </Fragment>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyRows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="sticky left-0 z-[5] whitespace-nowrap border-r bg-background font-medium">
                          {format(row.month, 'MMM yyyy')}
                          {row.key === monthKeyOf(today) && (
                            <span className="block text-xs font-normal text-muted-foreground">to date</span>
                          )}
                        </TableCell>
                        {row.cells.map((cell, index) => (
                          <Fragment key={ccAccounts[index].id}>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(cell.projected)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                              {cell.actual === null ? <span className="text-muted-foreground">—</span> : formatInr(cell.actual)}
                            </TableCell>
                            <TableCell className={cn('whitespace-nowrap border-r text-right tabular-nums', diffClass(cell.diff))}>
                              {signedInr(cell.diff)}
                            </TableCell>
                          </Fragment>
                        ))}
                        <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatInr(row.projected)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                          {row.actual === null ? <span className="text-muted-foreground">—</span> : formatInr(row.actual)}
                        </TableCell>
                        <TableCell className={cn('whitespace-nowrap text-right font-semibold tabular-nums', diffClass(row.diff))}>
                          {signedInr(row.diff)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="sticky left-0 z-[5] whitespace-nowrap border-r bg-slate-50">Total</TableCell>
                      {monthlyTotals.perAccount.map((cell, index) => (
                        <Fragment key={ccAccounts[index].id}>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(cell.projected)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {cell.actual === null ? '—' : formatInr(cell.actual)}
                          </TableCell>
                          <TableCell className={cn('whitespace-nowrap border-r text-right tabular-nums', diffClass(cell.diff))}>
                            {signedInr(cell.diff)}
                          </TableCell>
                        </Fragment>
                      ))}
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(monthlyTotals.projected)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {monthlyTotals.actual === null ? '—' : formatInr(monthlyTotals.actual)}
                      </TableCell>
                      <TableCell className={cn('whitespace-nowrap text-right tabular-nums', diffClass(monthlyTotals.diff))}>
                        {signedInr(monthlyTotals.diff)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              )}
            </TableCard>
          </TabsContent>

          <TabsContent value="daily" className="mt-0">
            <TableCard
              icon={CalendarDays}
              title="Daily interest"
              description="Closing utilisation, the rate in force and that day's projected interest. Days before an account's opening date show —."
              count={dailyTable.rows.length}
              noun="day"
              toolbar={
                <FilterBar
                  activeCount={(dailyPreset !== 'thisMonth' ? 1 : 0) + (dailyAccount !== 'all' ? 1 : 0)}
                  onClear={() => {
                    setDailyRange(getDateRangeFromPreset('thisMonth'));
                    setDailyPreset('thisMonth');
                    setDailyAccount('all');
                  }}
                >
                  <BankDateRangeFilter
                    range={dailyRange}
                    preset={dailyPreset}
                    onChange={(range, preset) => {
                      setDailyRange(range);
                      setDailyPreset(preset);
                    }}
                  />
                  <Select value={ccAccounts.some((acc) => acc.id === dailyAccount) ? dailyAccount : 'all'} onValueChange={setDailyAccount}>
                    <SelectTrigger className="sm:w-52" aria-label="Account">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All CC accounts</SelectItem>
                      {ccAccounts.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {accountLabel(acc)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterBar>
              }
            >
              {dailyAccounts.length === 0 || dailyTable.rows.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">
                  {dailyAccounts.length === 0 ? 'No Cash Credit accounts to report on.' : 'No days up to today in the selected range.'}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead rowSpan={2} className="left-0 !z-20 border-r align-bottom">
                        Date
                      </TableHead>
                      {dailyAccounts.map((acc) => (
                        <TableHead key={acc.id} colSpan={3} className="whitespace-nowrap border-r text-center">
                          {accountLabel(acc)}
                        </TableHead>
                      ))}
                      <TableHead rowSpan={2} className="whitespace-nowrap text-right align-bottom">
                        Total interest
                      </TableHead>
                    </TableRow>
                    <TableRow className="[&>th]:!top-[var(--table-head-h,2.5rem)]">
                      {dailyAccounts.map((acc) => (
                        <Fragment key={acc.id}>
                          <TableHead className="whitespace-nowrap text-right">Utilised</TableHead>
                          <TableHead className="whitespace-nowrap text-right">Rate</TableHead>
                          <TableHead className="whitespace-nowrap border-r text-right">Interest</TableHead>
                        </Fragment>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailyTable.rows.map((row) => (
                      <TableRow key={row.day.getTime()}>
                        <TableCell className="sticky left-0 z-[5] whitespace-nowrap border-r bg-background font-medium">
                          {formatDay(row.day)}
                        </TableCell>
                        {row.cells.map((cell, index) => (
                          <Fragment key={dailyAccounts[index].id}>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                              {cell ? formatInr(cell.utilised) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                              {cell ? (cell.rate > 0 ? formatRate(cell.rate) : <span className="text-muted-foreground">No rate</span>) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="whitespace-nowrap border-r text-right tabular-nums">
                              {cell ? formatInr(cell.interest) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          </Fragment>
                        ))}
                        <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatInr(row.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="sticky left-0 z-[5] whitespace-nowrap border-r bg-slate-50">Total</TableCell>
                      {dailyTable.perAccount.map((sum, index) => (
                        <Fragment key={dailyAccounts[index].id}>
                          <TableCell />
                          <TableCell />
                          <TableCell className="whitespace-nowrap border-r text-right tabular-nums">{formatInr(sum)}</TableCell>
                        </Fragment>
                      ))}
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(dailyTable.total)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              )}
            </TableCard>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
