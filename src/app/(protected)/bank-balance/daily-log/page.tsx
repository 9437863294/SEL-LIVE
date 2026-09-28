'use client';
export const dynamic = 'force-dynamic';

/**
 * Daily Log — the one day-by-day view of every account, and the old Daily Balance report
 * (`reports/daily-balance` now redirects here): pick a single account in the "By account" view to
 * get exactly that report, with its period totals.
 *
 * Every figure comes from the ledger engine, built once: an account starts at its opening date
 * (an account without one counts every entry), internal transfers move the balance and are shown
 * as their own in / out figures, and Cash Credit reads as utilisation while a current account reads
 * as balance — the two are never added together.
 */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DateRange } from 'react-day-picker';
import { startOfDay } from 'date-fns';
import {
  Activity,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpDown,
  ArrowUpRight,
  CalendarDays,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { getDateRangeFromPreset, type DateRangePreset } from '@/lib/date-range-presets';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import {
  buildLedgers,
  dailyInterest,
  dailyRows,
  formatDay,
  formatInr,
  getApplicableRate,
  isCashCredit,
  type DailyRow,
} from '@/lib/bank-balance-ledger';
import type { BankAccount, BankExpense, UserSettings } from '@/lib/types';
import { cn } from '@/lib/utils';

type SectionKey = 'utilised' | 'caBalance' | 'interTransfer' | 'expenses' | 'receipts' | 'dp' | 'balanceToDraw' | 'interest';
type SectionVisibility = Record<SectionKey, boolean>;

/** Stored at `userSettings/{uid}.columnPreferences.<key>.visibility` — the path this page has always used. */
const SECTION_SETTINGS_KEY = 'bank_balance_daily_log_section_visibility';

const SECTION_DEFAULTS: SectionVisibility = {
  utilised: true,
  caBalance: true,
  interTransfer: true,
  expenses: true,
  receipts: true,
  dp: true,
  balanceToDraw: true,
  interest: true,
};

const SECTION_OPTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: 'utilised', label: 'Cash Credit utilisation' },
  { key: 'caBalance', label: 'Current account balance' },
  { key: 'interTransfer', label: 'Internal transfers (in / out)' },
  { key: 'expenses', label: 'Payments of the day' },
  { key: 'receipts', label: 'Receipts of the day' },
  { key: 'dp', label: 'DP / TOD limit' },
  { key: 'balanceToDraw', label: 'Balance to draw' },
  { key: 'interest', label: 'Interest (projected)' },
];

interface AccountDay {
  row: DailyRow;
  /** Limit (DP + OD + TOD) in force that day; 0 for a current account. */
  limit: number;
  /** Cash Credit: limit − utilisation. Current account: the balance. */
  available: number;
  rate: number;
  interest: number;
}

interface AccountSeries {
  account: BankAccount;
  cc: boolean;
  days: AccountDay[];
}

/** A flow (receipts, payments, transfers, a limit): a dash when there is none. */
const flow = (value: number) => (value ? formatInr(value) : '—');

const typeBadge = (account: BankAccount) => (
  <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
    {isCashCredit(account) ? 'CC' : 'CA'}
  </Badge>
);

export default function DailyLogPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.Daily Log');
  const { accounts, transactions, isLoading, isRefreshing, refresh } = useBankData({ enabled: canView, transactions: true });

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => getDateRangeFromPreset('today'));
  const [datePreset, setDatePreset] = useState<DateRangePreset>('today');
  const [bankFilter, setBankFilter] = useState('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [viewMode, setViewMode] = useState<'dateWise' | 'current'>('dateWise');
  const [dateSortOrder, setDateSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [sectionVisibility, setSectionVisibility] = useState<SectionVisibility>(SECTION_DEFAULTS);

  useEffect(() => {
    if (!user) return;
    const loadSectionPrefs = async () => {
      try {
        const snap = await getDoc(doc(db, 'userSettings', user.id));
        if (!snap.exists()) return;
        const saved = (snap.data() as UserSettings).columnPreferences?.[SECTION_SETTINGS_KEY]?.visibility as
          | Partial<SectionVisibility>
          | undefined;
        if (saved) setSectionVisibility((prev) => ({ ...prev, ...saved }));
      } catch (error) {
        console.error('Failed to load section visibility preferences', error);
      }
    };
    void loadSectionPrefs();
  }, [user]);

  const toggleSection = (key: SectionKey, checked: boolean) => {
    const next = { ...sectionVisibility, [key]: checked };
    setSectionVisibility(next);
    if (!user) return;
    setDoc(
      doc(db, 'userSettings', user.id),
      { columnPreferences: { [SECTION_SETTINGS_KEY]: { visibility: next } } },
      { mergeFields: [`columnPreferences.${SECTION_SETTINGS_KEY}`] },
    ).catch((error) => {
      console.error('Failed to save section visibility preferences', error);
      toast({ title: 'Error', description: 'Could not save section visibility preferences.', variant: 'destructive' });
    });
  };

  // One account scope for both views: active accounts unless "Include inactive" is on.
  const scopeAccounts = useMemo(
    () => accounts.filter((account) => includeInactive || account.status === 'Active'),
    [accounts, includeInactive],
  );
  const effectiveBank = scopeAccounts.some((account) => account.id === bankFilter) ? bankFilter : 'all';
  const selectedAccounts = useMemo(
    () => (effectiveBank === 'all' ? scopeAccounts : scopeAccounts.filter((account) => account.id === effectiveBank)),
    [scopeAccounts, effectiveBank],
  );

  const ledgers = useMemo(() => buildLedgers<BankAccount, BankExpense>(accounts, transactions), [accounts, transactions]);

  // The days shown: the picked range, never past today. With no range, the whole history from the
  // earliest opening date (or first entry) of the selected accounts.
  const span = useMemo(() => {
    const today = startOfDay(new Date());
    let from = dateRange?.from ? startOfDay(dateRange.from) : null;
    if (!from) {
      const starts = selectedAccounts.map((account) => {
        const ledger = ledgers.get(account.id);
        return ledger?.start ?? ledger?.entries[0]?.at ?? today;
      });
      from = starts.length ? startOfDay(new Date(Math.min(...starts.map((d) => d.getTime())))) : today;
    }
    let to = dateRange?.to ? startOfDay(dateRange.to) : dateRange?.from ? from : today;
    if (to > today) to = today;
    return from > to ? null : { from, to };
  }, [dateRange, selectedAccounts, ledgers]);

  const series = useMemo<AccountSeries[]>(() => {
    if (!span) return [];
    return selectedAccounts.flatMap((account) => {
      const ledger = ledgers.get(account.id);
      if (!ledger) return [];
      const cc = isCashCredit(account);
      const days = dailyRows(ledger, span.from, span.to).map((row): AccountDay => {
        const limit = cc && row.open ? getApplicableCcLimit(account, row.day) : 0;
        const rate = cc && row.open ? getApplicableRate(account, row.day) : 0;
        return {
          row,
          limit,
          available: cc ? limit - row.closing : row.closing,
          rate,
          interest: cc ? dailyInterest(row.closing, rate) : 0,
        };
      });
      return [{ account, cc, days }];
    });
  }, [selectedAccounts, ledgers, span]);

  const dayCount = series[0]?.days.length ?? 0;

  const summary = useMemo(() => {
    const totals = { receipts: 0, payments: 0, transfersIn: 0, transfersOut: 0, count: 0 };
    for (const { days } of series) {
      for (const { row } of days) {
        totals.receipts += row.receipts;
        totals.payments += row.payments;
        totals.transfersIn += row.transfersIn;
        totals.transfersOut += row.transfersOut;
        totals.count += row.count;
      }
    }
    return totals;
  }, [series]);

  // "By account" rows: one per account per open day.
  const accountRows = useMemo(() => {
    const rows = series.flatMap(({ account, days }) =>
      days.filter((d) => d.row.open).map((d) => ({ id: `${d.row.key}-${account.id}`, account, ...d })),
    );
    return rows.sort((a, b) => {
      const byDate = a.row.day.getTime() - b.row.day.getTime();
      if (byDate !== 0) return dateSortOrder === 'newest' ? -byDate : byDate;
      return accountLabel(a.account).localeCompare(accountLabel(b.account));
    });
  }, [series, dateSortOrder]);

  // Date-wise rows: day indices on which at least one selected account is open.
  const pivotDays = useMemo(() => {
    const indices = Array.from({ length: dayCount }, (_, i) => i).filter((i) => series.some((s) => s.days[i].row.open));
    return dateSortOrder === 'newest' ? indices.reverse() : indices;
  }, [series, dayCount, dateSortOrder]);

  const singleAccount = effectiveBank !== 'all' ? series[0] : undefined;
  const singleTotals = useMemo(() => {
    if (!singleAccount) return null;
    const open = singleAccount.days.filter((d) => d.row.open);
    if (!open.length) return null;
    const sum = (pick: (d: AccountDay) => number) => open.reduce((s, d) => s + pick(d), 0);
    return {
      opening: open[0].row.opening,
      receipts: sum((d) => d.row.receipts),
      payments: sum((d) => d.row.payments),
      transfersIn: sum((d) => d.row.transfersIn),
      transfersOut: sum((d) => d.row.transfersOut),
      closing: open[open.length - 1].row.closing,
      available: open[open.length - 1].available,
      count: sum((d) => d.row.count),
      activeDays: open.filter((d) => d.row.count > 0).length,
      days: open.length,
    };
  }, [singleAccount]);

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} />;
  if (!canView) return <BankAccessDenied title="Daily Log" backHref="/bank-balance/settings" backLabel="Back to settings" />;

  // ── Date-wise pivot sections ────────────────────────────────────────────────────────────────
  const ccSeries = series.filter((s) => s.cc);
  const caSeries = series.filter((s) => !s.cc);

  type PivotColumn = { id: string; header: ReactNode; render: (i: number) => ReactNode; total?: boolean };
  type PivotSection = { key: SectionKey; title: string; columns: PivotColumn[] };

  const perAccount = (
    list: AccountSeries[],
    prefix: string,
    value: (d: AccountDay) => ReactNode,
    total?: (days: AccountDay[]) => ReactNode,
  ): PivotColumn[] => [
    ...list.map((s) => ({
      id: `${prefix}-${s.account.id}`,
      header: accountLabel(s.account),
      render: (i: number) => (s.days[i].row.open ? value(s.days[i]) : '—'),
    })),
    ...(total
      ? [{ id: `${prefix}-total`, header: 'Total', total: true, render: (i: number) => total(list.map((s) => s.days[i]).filter((d) => d.row.open)) }]
      : []),
  ];
  const sumOf = (pick: (d: AccountDay) => number, show: (v: number) => string = formatInr) => (days: AccountDay[]) =>
    show(days.reduce((s, d) => s + pick(d), 0));
  const inOut = (tIn: number, tOut: number) =>
    tIn || tOut ? (
      <span className="inline-flex flex-col items-end leading-tight">
        {tIn > 0 && <span className="text-emerald-600">+{formatInr(tIn)}</span>}
        {tOut > 0 && <span className="text-rose-600">−{formatInr(tOut)}</span>}
      </span>
    ) : (
      '—'
    );

  const sections: PivotSection[] = [
    {
      key: 'utilised' as const,
      title: 'Cash Credit utilisation',
      columns: ccSeries.length ? perAccount(ccSeries, 'util', (d) => formatInr(d.row.closing), sumOf((d) => d.row.closing)) : [],
    },
    {
      key: 'caBalance' as const,
      title: 'Current account balance',
      columns: caSeries.length ? perAccount(caSeries, 'bal', (d) => formatInr(d.row.closing), sumOf((d) => d.row.closing)) : [],
    },
    {
      key: 'interTransfer' as const,
      title: 'Internal transfers (in / out)',
      columns: perAccount(
        series,
        'contra',
        (d) => inOut(d.row.transfersIn, d.row.transfersOut),
        (days) => inOut(days.reduce((s, d) => s + d.row.transfersIn, 0), days.reduce((s, d) => s + d.row.transfersOut, 0)),
      ),
    },
    {
      key: 'expenses' as const,
      title: 'Payments of the day',
      columns: perAccount(series, 'exp', (d) => flow(d.row.payments), sumOf((d) => d.row.payments, flow)),
    },
    {
      key: 'receipts' as const,
      title: 'Receipts of the day',
      columns: perAccount(series, 'rec', (d) => flow(d.row.receipts), sumOf((d) => d.row.receipts, flow)),
    },
    {
      key: 'dp' as const,
      title: 'DP / TOD limit',
      columns: ccSeries.length ? perAccount(ccSeries, 'dp', (d) => flow(d.limit), sumOf((d) => d.limit, flow)) : [],
    },
    {
      key: 'balanceToDraw' as const,
      title: 'Balance to draw',
      columns: perAccount(series, 'btd', (d) => formatInr(d.available), sumOf((d) => d.available)),
    },
    {
      key: 'interest' as const,
      title: 'Interest (projected, per day)',
      columns: ccSeries.length
        ? [
            ...ccSeries.map((s) => ({
              id: `rate-${s.account.id}`,
              header: `Rate ${accountLabel(s.account)}`,
              render: (i: number) => (s.days[i].row.open && s.days[i].rate > 0 ? `${s.days[i].rate.toFixed(2)}%` : '—'),
            })),
            ...perAccount(ccSeries, 'int', (d) => flow(d.interest), sumOf((d) => d.interest, flow)),
          ]
        : [],
    },
  ].filter((section) => sectionVisibility[section.key] && section.columns.length > 0);

  const pivotColumnCount = 1 + sections.reduce((n, s) => n + s.columns.length, 0);

  const sortButton = (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={() => setDateSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
      title={dateSortOrder === 'newest' ? 'Newest first. Click for oldest first.' : 'Oldest first. Click for newest first.'}
      aria-label={dateSortOrder === 'newest' ? 'Sort oldest first' : 'Sort newest first'}
    >
      <ArrowUpDown className="h-3.5 w-3.5" />
    </Button>
  );

  const activeFilters = (dateRange ? 1 : 0) + (effectiveBank !== 'all' ? 1 : 0) + (includeInactive ? 1 : 0);

  const toolbar = (
    <FilterBar
      activeCount={activeFilters}
      onClear={() => {
        setDateRange(undefined);
        setDatePreset('custom');
        setBankFilter('all');
        setIncludeInactive(false);
      }}
      actions={
        <>
          <div className="inline-flex rounded-md border p-0.5">
            <Button
              size="sm"
              variant={viewMode === 'dateWise' ? 'secondary' : 'ghost'}
              className="h-8"
              onClick={() => setViewMode('dateWise')}
            >
              Date-wise
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'current' ? 'secondary' : 'ghost'}
              className="h-8"
              onClick={() => setViewMode('current')}
            >
              By account
            </Button>
          </div>
          {viewMode === 'dateWise' && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Settings2 className="mr-2 h-4 w-4" />
                  Sections
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1.5rem))]">
                <div className="space-y-3">
                  <p className="text-sm font-medium">Show / hide sections</p>
                  {SECTION_OPTIONS.map((section) => (
                    <div key={section.key} className="flex items-center justify-between gap-3">
                      <Label htmlFor={`daily-log-section-${section.key}`} className="text-sm font-normal">
                        {section.label}
                      </Label>
                      <Switch
                        id={`daily-log-section-${section.key}`}
                        checked={sectionVisibility[section.key]}
                        onCheckedChange={(checked) => toggleSection(section.key, checked)}
                      />
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </>
      }
    >
      <BankDateRangeFilter
        range={dateRange}
        preset={datePreset}
        onChange={(range, preset) => {
          setDateRange(range);
          setDatePreset(preset);
        }}
      />
      <Select value={effectiveBank} onValueChange={setBankFilter}>
        <SelectTrigger className="sm:w-56">
          <SelectValue placeholder="All accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All accounts</SelectItem>
          {scopeAccounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {accountLabel(account)} – {account.bankName}
              {account.status !== 'Active' ? ' (inactive)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex h-10 items-center gap-2 rounded-md border px-3">
        <Switch id="daily-log-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
        <Label htmlFor="daily-log-inactive" className="text-sm font-normal">
          Include inactive
        </Label>
      </div>
    </FilterBar>
  );

  const empty = (colSpan: number, message: string) => (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-32 text-center text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <CalendarDays className="h-8 w-8 opacity-30" />
          <p>{message}</p>
        </div>
      </TableCell>
    </TableRow>
  );

  const rangeLabel = span
    ? span.from.getTime() === span.to.getTime()
      ? formatDay(span.from)
      : `${formatDay(span.from)} – ${formatDay(span.to)}`
    : 'No days in range';

  return (
    <>
      <BankBalanceBackground tone="blue" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Daily Log"
          icon={CalendarDays}
          description="Day-by-day opening, movement and closing for every account — Cash Credit as utilisation, current accounts as balance."
          backHref="/bank-balance/settings"
          backLabel="Back to settings"
          actions={
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={isRefreshing}>
              <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
              Refresh
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Receipts" value={formatInr(summary.receipts)} hint={rangeLabel} icon={ArrowDownLeft} tone="emerald" accent />
          <KpiCard label="Payments" value={formatInr(summary.payments)} hint={rangeLabel} icon={ArrowUpRight} tone="rose" accent />
          <KpiCard
            label="Internal transfers in"
            value={formatInr(summary.transfersIn)}
            hint={`${formatInr(summary.transfersOut)} out · not in receipts or payments`}
            icon={ArrowLeftRight}
            tone="violet"
            accent
          />
          <KpiCard
            label="Entries"
            value={summary.count}
            hint={`${selectedAccounts.length} account${selectedAccounts.length === 1 ? '' : 's'} · ${dayCount} day${dayCount === 1 ? '' : 's'}`}
            icon={Activity}
            tone="blue"
            accent
          />
        </div>

        {viewMode === 'current' ? (
          <TableCard
            title={singleAccount ? `${accountLabel(singleAccount.account)} — daily balance` : 'Daily balances by account'}
            description={
              <>
                {rangeLabel}
                {singleAccount
                  ? ` · ${singleAccount.cc ? 'Figures are utilisation' : 'Figures are balance'}`
                  : ' · Cash Credit opening / closing are utilisation; current accounts are balance'}
                {singleTotals ? ` · ${singleTotals.activeDays} of ${singleTotals.days} days with entries` : ''}
              </>
            }
            count={accountRows.length}
            noun="record"
            toolbar={toolbar}
          >
            <Table className="w-full min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <div className="flex items-center gap-2">
                      <span>Date</span>
                      {sortButton}
                    </div>
                  </TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Receipts</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Transfers in</TableHead>
                  <TableHead className="text-right">Transfers out</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountRows.length === 0
                  ? empty(10, 'No days found for the selected accounts and dates.')
                  : accountRows.map((r) => (
                      <TableRow key={r.id} className={cn(r.row.count === 0 && 'text-muted-foreground')}>
                        <TableCell className="whitespace-nowrap font-medium">{formatDay(r.row.day)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            {accountLabel(r.account)}
                            {typeBadge(r.account)}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(r.row.opening)}</TableCell>
                        <TableCell className={cn('whitespace-nowrap text-right tabular-nums', r.row.receipts > 0 && 'text-emerald-600')}>
                          {flow(r.row.receipts)}
                        </TableCell>
                        <TableCell className={cn('whitespace-nowrap text-right tabular-nums', r.row.payments > 0 && 'text-rose-600')}>
                          {flow(r.row.payments)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{flow(r.row.transfersIn)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{flow(r.row.transfersOut)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{formatInr(r.row.closing)}</TableCell>
                        <TableCell className={cn('whitespace-nowrap text-right font-medium tabular-nums', r.available < 0 && 'text-rose-600')}>
                          {formatInr(r.available)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.row.count || '—'}</TableCell>
                      </TableRow>
                    ))}
              </TableBody>
              {singleTotals && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2}>Period total</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(singleTotals.opening)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-700">{formatInr(singleTotals.receipts)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-rose-700">{formatInr(singleTotals.payments)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(singleTotals.transfersIn)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(singleTotals.transfersOut)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(singleTotals.closing)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(singleTotals.available)}</TableCell>
                    <TableCell className="text-right tabular-nums">{singleTotals.count}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </TableCard>
        ) : (
          <TableCard
            title="Date-wise position"
            description={`${rangeLabel} · Cash Credit utilisation and current account balance are shown apart, never added together`}
            count={pivotDays.length}
            noun="day"
            toolbar={toolbar}
          >
            <Table className="w-max min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="sticky left-0 !z-30 min-w-[140px] border-r">
                    <div className="flex items-center gap-2">
                      <span>Date</span>
                      {sortButton}
                    </div>
                  </TableHead>
                  {sections.map((section) => (
                    <TableHead key={section.key} colSpan={section.columns.length} className="border-r text-center">
                      {section.title}
                    </TableHead>
                  ))}
                </TableRow>
                <TableRow className="[&>th]:!top-[var(--table-head-h,2.5rem)]">
                  {sections.map((section) => (
                    <Fragment key={section.key}>
                      {section.columns.map((column, index) => (
                        <TableHead
                          key={column.id}
                          className={cn('whitespace-nowrap text-right', index === section.columns.length - 1 && 'border-r')}
                        >
                          {column.header}
                        </TableHead>
                      ))}
                    </Fragment>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pivotDays.length === 0
                  ? empty(Math.max(2, pivotColumnCount), 'No days found for the selected accounts and dates.')
                  : pivotDays.map((i) => (
                      <TableRow key={series[0].days[i].row.key}>
                        <TableCell className="sticky left-0 z-[1] whitespace-nowrap border-r bg-background font-medium">
                          {formatDay(series[0].days[i].row.day)}
                        </TableCell>
                        {sections.map((section) => (
                          <Fragment key={section.key}>
                            {section.columns.map((column, index) => (
                              <TableCell
                                key={column.id}
                                className={cn(
                                  'whitespace-nowrap text-right tabular-nums',
                                  column.total && 'font-medium',
                                  index === section.columns.length - 1 && 'border-r',
                                )}
                              >
                                {column.render(i)}
                              </TableCell>
                            ))}
                          </Fragment>
                        ))}
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </div>
    </>
  );
}
