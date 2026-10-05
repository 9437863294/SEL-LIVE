
'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Plus, Scale, ArrowDown, ArrowUp,
  ArrowRightLeft, ShieldAlert, Activity, TrendingUp,
  RefreshCw, CreditCard, Building2, Percent, Calendar,
  Gauge, Landmark, Wallet, CalendarClock, Hourglass, CalendarX, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { endOfDay, format, isToday, subDays, startOfMonth, subMonths } from 'date-fns';
import { balancesAt, buildLedgers, dailyRows, formatDay, formatInr, parseDay } from '@/lib/bank-balance-ledger';
import { CHEQUE_VALIDITY_MONTHS, displayStatus, type BankPaymentVoucher } from '@/lib/bank-payments';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { KpiCard } from '@/components/shared/kpi-card';
import {
  LimitUtilisationChart,
  MonthlyFlowChart,
  UtilisationTrendChart,
  compactInr,
  type FlowDatedAhead,
  type MonthlyFlowPoint,
  type UtilisationTrendPoint,
} from '@/components/bank-balance/dashboard-charts';
import { cn } from '@/lib/utils';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';

const voucherCount = (n: number) => `${n} voucher${n === 1 ? '' : 's'}`;

/**
 * The account card's "Since MMM yy". Through `parseDay`, not `new Date(…)`: an opening date that
 * does not parse gives an Invalid Date, and `format` throws on one — which would take the whole
 * dashboard down, not just the card.
 */
const openingMonth = (openingDate: string | null | undefined) => {
  const day = parseDay(openingDate);
  return day ? format(day, 'MMM yy') : '—';
};

export default function BankBalanceDashboard() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  // Payment vouchers for the cheque tiles; null when not loaded (no register access, or the read failed).
  const [vouchers, setVouchers] = useState<BankPaymentVoucher[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const canView = can('View Module', 'Bank Balance');
  const canViewReports = can('View', 'Bank Balance.Reports');
  const canViewAccounts = can('View', 'Bank Balance.Accounts');
  // The Cheque Register's own permission: without it the vouchers are neither read nor shown.
  const canViewCheques = can('View', 'Bank Balance.Expenses');

  const fetchData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setRefreshing(true);
    try {
      const [accountsSnap, expensesSnap, vouchersSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses')),
        // Caught on its own: a failed voucher read drops the cheque tiles, never the balances.
        canViewCheques
          ? getDocs(collection(db, 'bankPayments')).catch(error => {
              console.error('Error fetching payment vouchers:', error);
              toast({ title: 'Cheque figures unavailable', description: 'Failed to load payment vouchers.', variant: 'destructive' });
              return null;
            })
          : Promise.resolve(null),
      ]);
      setAccounts(accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount)));
      setAllTransactions(expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense)));
      setVouchers(vouchersSnap ? vouchersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankPaymentVoucher)) : null);
      setLastRefreshed(new Date());
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({ title: 'Error', description: 'Failed to fetch bank data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!canView) { setIsLoading(false); return; }
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewCheques, authLoading]);

  const formatCurrency = (amount: number) => formatInr(amount);

  const getLatestDp = (account: BankAccount) => {
    return getApplicableCcLimit(account, new Date());
  };

  // Every figure on this page comes from the shared ledger (opening date honoured, transfers
  // counted), so the dashboard and every report agree.
  const ledgers = useMemo(() => buildLedgers(accounts, allTransactions), [accounts, allTransactions]);
  const calculatedBalances = useMemo(() => balancesAt(ledgers, new Date()), [ledgers]);

  const activeAccounts = useMemo(() => accounts.filter(a => a.status === 'Active'), [accounts]);
  const ccAccounts = useMemo(() => activeAccounts.filter(a => a.accountType === 'Cash Credit'), [activeAccounts]);
  const currentAccounts = useMemo(() => activeAccounts.filter(a => a.accountType === 'Current Account'), [activeAccounts]);
  const displayAccounts = useMemo(
    () => [...activeAccounts, ...accounts.filter(a => a.status !== 'Active')],
    [accounts, activeAccounts]
  );
  const quickLinks = [
    {
      href: '/bank-balance/daily-log',
      icon: Calendar,
      label: 'Daily Log',
      color: 'text-blue-600',
      bg: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-800/30 hover:bg-blue-100/70',
      enabled: can('View', 'Bank Balance.Daily Log'),
    },
    {
      href: '/bank-balance/expenses',
      icon: ArrowDown,
      label: 'Payments',
      color: 'text-red-600',
      bg: 'bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-800/30 hover:bg-red-100/70',
      enabled: can('View', 'Bank Balance.Expenses'),
    },
    {
      href: '/bank-balance/receipts',
      icon: ArrowUp,
      label: 'Receipts',
      color: 'text-green-600',
      bg: 'bg-green-50 dark:bg-green-950/20 border-green-200/60 dark:border-green-800/30 hover:bg-green-100/70',
      enabled: can('View', 'Bank Balance.Receipts'),
    },
    {
      href: '/bank-balance/internal-transaction',
      icon: ArrowRightLeft,
      label: 'Transfers',
      color: 'text-violet-600',
      bg: 'bg-violet-50 dark:bg-violet-950/20 border-violet-200/60 dark:border-violet-800/30 hover:bg-violet-100/70',
      enabled: can('View', 'Bank Balance.Internal Transaction'),
    },
    {
      href: '/bank-balance/reports/interest-accrual',
      icon: Percent,
      label: 'Interest',
      color: 'text-amber-600',
      bg: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-800/30 hover:bg-amber-100/70',
      enabled: canViewReports,
    },
    {
      href: '/bank-balance/monthly-interest',
      icon: TrendingUp,
      label: 'Monthly',
      color: 'text-indigo-600',
      bg: 'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200/60 dark:border-indigo-800/30 hover:bg-indigo-100/70',
      enabled: can('View', 'Bank Balance.Monthly Interest'),
    },
  ] as const;

  const totalConsolidatedBalance = useMemo(() => {
    let total = 0;
    activeAccounts.forEach(account => {
      const balance = calculatedBalances[account.id] || 0;
      total += account.accountType === 'Cash Credit'
        ? getLatestDp(account) - balance
        : balance;
    });
    return total;
  }, [activeAccounts, calculatedBalances]);

  // Today's totals
  const todayStats = useMemo(() => {
    const today = allTransactions.filter(t => {
      try { return isToday(t.date.toDate()); } catch { return false; }
    });
    return {
      debits: today.filter(t => t.type === 'Debit' && !t.isContra).reduce((s, t) => s + t.amount, 0),
      credits: today.filter(t => t.type === 'Credit' && !t.isContra).reduce((s, t) => s + t.amount, 0),
      count: today.filter(t => !t.isContra).length,
    };
  }, [allTransactions]);

  // Cash Credit position today: limit (DP + TOD) against utilisation, per account and in total.
  const ccPosition = useMemo(() => {
    const rows = ccAccounts.map(account => ({
      id: account.id,
      name: (account.shortName || account.bankName || '').trim(),
      limit: getLatestDp(account),
      utilised: calculatedBalances[account.id] || 0,
    }));
    const limit = rows.reduce((sum, row) => sum + row.limit, 0);
    const utilised = rows.reduce((sum, row) => sum + Math.max(0, row.utilised), 0);
    const currentBalance = currentAccounts.reduce((sum, account) => sum + (calculatedBalances[account.id] || 0), 0);
    return {
      rows,
      limit,
      utilised,
      available: Math.max(0, limit - utilised),
      pct: limit > 0 ? (utilised / limit) * 100 : 0,
      withoutLimit: rows.filter(row => row.limit <= 0).length,
      currentBalance,
    };
  }, [ccAccounts, currentAccounts, calculatedBalances]);

  // Each of the last 30 days' closing utilisation across CC accounts, against the limit in force
  // that day. An account contributes nothing before its opening date.
  const utilisationTrend = useMemo<UtilisationTrendPoint[]>(() => {
    const today = new Date();
    const first = subDays(today, 29);
    const totals = Array.from({ length: 30 }, () => ({ utilised: 0, limit: 0 }));

    ccAccounts.forEach(account => {
      const ledger = ledgers.get(account.id);
      if (!ledger) return;
      dailyRows(ledger, first, today).forEach((row, index) => {
        if (!row.open) return;
        totals[index].utilised += Math.max(0, row.closing);
        totals[index].limit += getApplicableCcLimit(account, row.day);
      });
    });

    return totals.map((total, index) => {
      const day = subDays(today, 29 - index);
      return { date: format(day, 'dd MMM yyyy'), label: format(day, 'dd MMM'), ...total };
    });
  }, [ccAccounts, ledgers]);

  // Only entries dated up to today count, as in the balances above: a post-dated cheque's Debit sits
  // on its instrument date and must not swell this month before then. What is dated ahead is
  // totalled for the note under the chart.
  const monthlyFlow = useMemo<{ points: MonthlyFlowPoint[]; datedAhead: FlowDatedAhead }>(() => {
    const now = new Date();
    const cutoff = endOfDay(now);
    const months = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(now, 5 - i)));
    const points = months.map(month => ({ key: format(month, 'yyyy-MM'), month: format(month, 'MMM yy'), receipts: 0, payments: 0 }));
    const byKey = new Map(points.map(point => [point.key, point]));
    const datedAhead: FlowDatedAhead = { payments: 0, paymentCount: 0, receipts: 0, receiptCount: 0 };
    allTransactions.forEach(t => {
      if (t.isContra) return;
      // Guarded like today's totals above: a row whose date cannot be read is left out rather than
      // throwing out of this useMemo and blanking the dashboard.
      let at: Date;
      try {
        at = t.date.toDate();
      } catch {
        return;
      }
      if (!at || Number.isNaN(at.getTime())) return;
      const amount = Number(t.amount) || 0;
      if (at > cutoff) {
        if (t.type === 'Credit') { datedAhead.receipts += amount; datedAhead.receiptCount += 1; }
        else { datedAhead.payments += amount; datedAhead.paymentCount += 1; }
        return;
      }
      const point = byKey.get(format(at, 'yyyy-MM'));
      if (!point) return;
      if (t.type === 'Credit') point.receipts += amount;
      else point.payments += amount;
    });
    return { points: points.map(({ key: _key, ...point }) => point), datedAhead };
  }, [allTransactions]);

  // The Cheque Register's buckets, read through the same displayStatus, so these tiles and the
  // register always agree: post-dated, issued (awaiting clearing), stale, cleared this month.
  const chequeSummary = useMemo(() => {
    if (!vouchers) return null;
    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');
    const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
    const bucket = () => ({ count: 0, amount: 0 });
    const postDated = bucket();
    const issued = bucket();
    const stale = bucket();
    const cleared = bucket();
    let nextDue: string | undefined;
    for (const v of vouchers) {
      const status = displayStatus(v, today);
      const target =
        status === 'Post-dated' ? postDated
        : status === 'Issued' ? issued
        : status === 'Stale' ? stale
        : status === 'Cleared' && (v.clearedDate || '') >= monthStart ? cleared
        : null;
      if (!target) continue;
      target.count += 1;
      target.amount += Number(v.total) || 0;
      if (status === 'Post-dated' && (!nextDue || v.instrumentDate < nextDue)) nextDue = v.instrumentDate;
    }
    return { postDated: { ...postDated, nextDue }, issued, stale, cleared };
  }, [vouchers]);

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="relative w-full min-h-screen overflow-hidden">
        {/* skeleton background */}
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-background to-blue-50 dark:from-violet-950/30 dark:via-background dark:to-blue-950/20" />
        <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-36 w-full rounded-2xl" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Skeleton className="h-52 rounded-xl" />
            <Skeleton className="h-52 rounded-xl" />
            <Skeleton className="h-52 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <PageHeader title="Bank Balance Dashboard" backHref="/" backLabel="Home" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this module.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center items-center p-8 flex-col gap-4">
            <ShieldAlert className="h-16 w-16 text-destructive" />
            <p>Contact your administrator for access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Animated Background ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50/80 via-background to-sky-50/60 dark:from-violet-950/40 dark:via-background dark:to-sky-950/30" />
        {/* Drifting orbs */}
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[45vw] h-[45vw] rounded-full bg-gradient-radial from-violet-400/20 via-purple-300/10 to-transparent dark:from-violet-600/15 dark:via-purple-500/8 dark:to-transparent blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[50vw] h-[50vw] rounded-full bg-gradient-radial from-sky-400/15 via-blue-300/8 to-transparent dark:from-sky-600/12 dark:via-blue-500/6 dark:to-transparent blur-3xl" />
        <div className="animate-bb-orb-3 absolute top-[40%] left-[30%] w-[30vw] h-[30vw] rounded-full bg-gradient-radial from-indigo-300/10 via-violet-200/6 to-transparent dark:from-indigo-700/10 dark:to-transparent blur-2xl" />
        {/* Subtle dot grid */}
        <div className="absolute inset-0 opacity-30 dark:opacity-20"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.15) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
      </div>

      <div className="relative w-full flex flex-col px-4 sm:px-6 lg:px-8 py-4">
        {/* ── Header ── */}
        <PageHeader
          title="Bank Balance"
          description={format(new Date(), 'EEEE, MMMM do, yyyy')}
          backHref="/"
          backLabel="Home"
          actions={
            // Reports, Daily Entry and Settings used to sit here too; the module sidebar (and the
            // phone's bottom bar, whose middle tab is the new entry) now carries all three.
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8 rounded-full', refreshing && 'animate-spin')}
              onClick={() => void fetchData(true)}
              disabled={refreshing}
              title={`Last refreshed: ${format(lastRefreshed, 'HH:mm:ss')}`}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* ── Consolidated Balance Hero ── */}
        <div className="mb-4 relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-violet-500/8 to-sky-500/8 dark:from-primary/15 dark:via-violet-600/10 dark:to-sky-600/10 shadow-lg shadow-primary/5">
          {/* shimmer overlay */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="animate-bb-shimmer absolute top-0 bottom-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12" />
          </div>
          <div className="relative p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-primary/70 mb-1">
                  <Scale className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Total Consolidated Balance</span>
                </div>
                <p className="text-4xl font-bold text-primary animate-bb-count">
                  {formatCurrency(totalConsolidatedBalance)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Across {activeAccounts.length} active account{activeAccounts.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
                  {ccAccounts.length} CC &nbsp;·&nbsp; {currentAccounts.length} Current
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status="Live" tone="success" dot />
                <span className="text-xs text-muted-foreground">{format(lastRefreshed, 'HH:mm:ss')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Today's Stats Row ── */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-green-200/60 bg-green-50/70 dark:bg-green-950/20 dark:border-green-800/30 p-3 flex items-center gap-3 shadow-sm">
            <div className="rounded-full bg-green-100 dark:bg-green-900/40 p-2">
              <ArrowUp className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-green-700/70 dark:text-green-400/70 font-medium">Today&apos;s Receipts</p>
              <p className="text-sm font-bold text-green-700 dark:text-green-400">{formatCurrency(todayStats.credits)}</p>
            </div>
          </div>
          <div className="rounded-xl border border-red-200/60 bg-red-50/70 dark:bg-red-950/20 dark:border-red-800/30 p-3 flex items-center gap-3 shadow-sm">
            <div className="rounded-full bg-red-100 dark:bg-red-900/40 p-2">
              <ArrowDown className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-xs text-red-700/70 dark:text-red-400/70 font-medium">Today&apos;s Payments</p>
              <p className="text-sm font-bold text-red-700 dark:text-red-400">{formatCurrency(todayStats.debits)}</p>
            </div>
          </div>
          <div className="rounded-xl border border-blue-200/60 bg-blue-50/70 dark:bg-blue-950/20 dark:border-blue-800/30 p-3 flex items-center gap-3 shadow-sm">
            <div className="rounded-full bg-blue-100 dark:bg-blue-900/40 p-2">
              <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-blue-700/70 dark:text-blue-400/70 font-medium">Today&apos;s Transactions</p>
              <p className="text-sm font-bold text-blue-700 dark:text-blue-400">{todayStats.count} entries</p>
            </div>
          </div>
        </div>

        {/* ── Cash Credit: DP & utilisation ── */}
        <SectionHeader title="DP & utilisation" description="Cash Credit limits (DP + TOD) in force today, against what is drawn." />
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total limit (DP + TOD)"
            value={formatCurrency(ccPosition.limit)}
            hint={
              ccPosition.withoutLimit
                ? `${ccPosition.withoutLimit} of ${ccAccounts.length} CC account${ccAccounts.length !== 1 ? 's' : ''} without a limit`
                : `${ccAccounts.length} Cash Credit account${ccAccounts.length !== 1 ? 's' : ''}`
            }
            icon={Landmark}
            tone="violet"
            accent
            href={can('View', 'Bank Balance.DP Management') ? '/bank-balance/dp-management' : undefined}
          />
          <KpiCard
            label="Utilised"
            value={formatCurrency(ccPosition.utilised)}
            hint={ccPosition.limit > 0 ? `${ccPosition.pct.toFixed(1)}% of limit` : 'No limit set'}
            icon={Gauge}
            tone={ccPosition.pct >= 90 ? 'rose' : ccPosition.pct >= 70 ? 'amber' : 'blue'}
            accent
            href={canViewReports ? '/bank-balance/reports/dp-utilization' : undefined}
          />
          <KpiCard
            label="Available headroom"
            value={formatCurrency(ccPosition.available)}
            hint={ccPosition.limit > 0 ? `${compactInr(ccPosition.available)} left to draw` : '—'}
            icon={TrendingUp}
            tone="emerald"
            accent
          />
          <KpiCard
            label="Current account balance"
            value={formatCurrency(ccPosition.currentBalance)}
            hint={`${currentAccounts.length} current account${currentAccounts.length !== 1 ? 's' : ''}`}
            icon={Wallet}
            tone="cyan"
            accent
          />
        </div>

        {/* ── Account Cards ── */}
        <SectionHeader title="Accounts" badge={<Badge variant="neutral">{displayAccounts.length}</Badge>} />
        <div>
          {/* auto-fill, not auto-fit: a short list keeps card-sized cards instead of stretching two
              of them across the whole screen. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4 pb-4">
            {displayAccounts.map((account, idx) => {
              const isCC = account.accountType === 'Cash Credit';
              const currentBalance = calculatedBalances[account.id] || 0;
              const latestDp = getLatestDp(account);
              const displayBalance = isCC ? latestDp - currentBalance : currentBalance;
              // Clamped at both ends: a Cash Credit account in credit gives a negative percentage,
              // and `width: -5%` is invalid CSS — the browser dropped the declaration and drew the
              // progress bar FULL.
              const utilizationPct = isCC && latestDp > 0 ? Math.min(100, Math.max(0, (currentBalance / latestDp) * 100)) : 0;

              const utilizationColor =
                utilizationPct >= 90 ? 'text-red-600 dark:text-red-400' :
                utilizationPct >= 70 ? 'text-amber-600 dark:text-amber-400' :
                'text-green-600 dark:text-green-400';

              const progressColor =
                utilizationPct >= 90 ? 'bg-red-500' :
                utilizationPct >= 70 ? 'bg-amber-500' :
                'bg-green-500';

              const isInactive = account.status === 'Inactive';

              return (
                <Card
                  key={account.id}
                  className={cn(
                    'relative overflow-hidden border transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 animate-bb-card-in group',
                    isCC ? 'border-violet-200/60 bg-gradient-to-br from-violet-50/50 to-background dark:from-violet-950/20 dark:border-violet-800/30'
                         : 'border-sky-200/60 bg-gradient-to-br from-sky-50/50 to-background dark:from-sky-950/20 dark:border-sky-800/30',
                    isInactive && 'opacity-60 grayscale',
                  )}
                  style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'both' }}
                >
                  {/* Top accent line */}
                  <div className={cn(
                    'absolute top-0 left-0 right-0 h-0.5 transition-all duration-300 group-hover:h-1',
                    isCC ? 'bg-gradient-to-r from-violet-400 to-purple-500' : 'bg-gradient-to-r from-sky-400 to-blue-500',
                  )} />

                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          'rounded-lg p-1.5 shrink-0',
                          isCC ? 'bg-violet-100 dark:bg-violet-900/40' : 'bg-sky-100 dark:bg-sky-900/40',
                        )}>
                          {isCC
                            ? <CreditCard className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                            : <Building2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                          }
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="truncate">{account.shortName}</CardTitle>
                          <p className="text-xs text-muted-foreground truncate">{account.bankName}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <StatusBadge status={account.status} />
                        <Badge variant="outline">
                          {isCC ? 'CC' : 'CA'}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-4 pt-0 space-y-3">
                    {/* Account number */}
                    <p className="text-[11px] text-muted-foreground font-mono tracking-wider">
                      ···· {account.accountNumber?.slice(-4) ?? '????'}
                    </p>

                    {/* Balance display */}
                    <div>
                      <p className={cn('text-2xl font-bold', displayBalance < 0 ? 'text-red-600 dark:text-red-400' : '')}>
                        {formatCurrency(displayBalance)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isCC ? 'Available Balance' : 'Current Balance'}
                      </p>
                    </div>

                    {/* CC Details */}
                    {isCC && (
                      <>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Utilization: <span className={cn('font-semibold', utilizationColor)}>{formatCurrency(currentBalance)}</span></span>
                          <span className={cn('font-semibold', utilizationColor)}>{utilizationPct.toFixed(1)}%</span>
                        </div>
                        <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all duration-700', progressColor)}
                            style={{ width: `${utilizationPct}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>Total Limit: <span className="font-medium text-foreground">{formatCurrency(latestDp)}</span></span>
                          <span>Limit Left: <span className={cn('font-medium', utilizationColor)}>{formatCurrency(Math.max(0, displayBalance))}</span></span>
                        </div>
                      </>
                    )}

                    {/* Footer */}
                    <div className="pt-1 border-t border-border/40 flex justify-between items-center">
                      <span className="text-[10px] text-muted-foreground">{account.branch || '—'}</span>
                      <span className="text-[10px] text-muted-foreground">Since {openingMonth(account.openingDate)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {displayAccounts.length === 0 && (
              <Card className="col-span-full border-dashed">
                <CardContent className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <Building2 className="h-8 w-8 opacity-40" />
                  <div>
                    <p className="font-medium text-foreground">No bank accounts configured</p>
                    <p className="text-sm">Add your first account to start tracking balances and daily entries.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Add Account card */}
            {canViewAccounts ? (
              <Link href="/bank-balance/accounts">
                <Card className="h-full min-h-[200px] border-2 border-dashed border-border/50 flex flex-col items-center justify-center text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all duration-300 cursor-pointer group rounded-xl">
                  <div className="rounded-full border-2 border-dashed border-current p-3 mb-2 group-hover:scale-110 transition-transform duration-300">
                    <Plus className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-medium">Add New Account</p>
                  <p className="text-xs opacity-70 mt-1">Configure a bank account</p>
                </Card>
              </Link>
            ) : (
              <Card className="h-full min-h-[200px] border-2 border-dashed border-border/50 flex flex-col items-center justify-center text-muted-foreground/70 rounded-xl">
                <div className="rounded-full border-2 border-dashed border-current p-3 mb-2 group-hover:scale-110 transition-transform duration-300">
                  <Plus className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium">Add New Account</p>
                <p className="text-xs opacity-70 mt-1">Account access required</p>
              </Card>
            )}
          </div>

          {/* ── Cheques & payments ── (the Cheque Register's figures. A row of four is too tall on a
              phone to sit inside DP & utilisation, so it comes after the accounts, keeping the order
              DP & utilisation → accounts → trends) */}
          {canViewCheques && chequeSummary && (
            <>
              <SectionHeader title="Cheques & payments" description="Payment vouchers in the Cheque Register — dated ahead, awaiting clearing, past validity, and cleared." />
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label="Post-dated"
                  value={formatCurrency(chequeSummary.postDated.amount)}
                  hint={
                    chequeSummary.postDated.nextDue
                      ? `${voucherCount(chequeSummary.postDated.count)} · next ${formatDay(chequeSummary.postDated.nextDue)}`
                      : 'None dated ahead'
                  }
                  icon={CalendarClock}
                  tone="blue"
                  accent
                  href="/bank-balance/cheques"
                />
                <KpiCard
                  label="Issued, not cleared"
                  value={formatCurrency(chequeSummary.issued.amount)}
                  hint={voucherCount(chequeSummary.issued.count)}
                  icon={Hourglass}
                  tone="violet"
                  accent
                  href="/bank-balance/cheques"
                />
                <KpiCard
                  label="Stale cheques"
                  value={chequeSummary.stale.count}
                  hint={
                    chequeSummary.stale.count
                      ? `${formatCurrency(chequeSummary.stale.amount)} past ${CHEQUE_VALIDITY_MONTHS}-month validity`
                      : `None past ${CHEQUE_VALIDITY_MONTHS}-month validity`
                  }
                  icon={CalendarX}
                  tone={chequeSummary.stale.count ? 'amber' : 'slate'}
                  accent
                  href="/bank-balance/cheques"
                />
                <KpiCard
                  label="Cleared this month"
                  value={formatCurrency(chequeSummary.cleared.amount)}
                  hint={voucherCount(chequeSummary.cleared.count)}
                  icon={CheckCircle2}
                  tone="emerald"
                  accent
                  href="/bank-balance/cheques"
                />
              </div>
            </>
          )}

          {/* ── Charts ── (after the account cards: the cards are the day-to-day view, the charts the trend) */}
          <SectionHeader title="Trends & Analysis" description="Limit against utilisation, its last 30 days, and money in and out by month." />
          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <LimitUtilisationChart rows={ccPosition.rows} />
            <UtilisationTrendChart points={utilisationTrend} />
            <div className="min-w-0 xl:col-span-2">
              <MonthlyFlowChart points={monthlyFlow.points} datedAhead={monthlyFlow.datedAhead} />
            </div>
          </div>

          {/* ── Quick Navigation Row ── (below lg only: from lg the module sidebar lists every page) */}
          <div className="mt-2 mb-4 lg:hidden">
            <SectionHeader title="Quick Navigation" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {quickLinks.map(item => {
                const content = (
                  <div
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all duration-200 group',
                      item.bg,
                      item.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50 saturate-50'
                    )}
                  >
                    <item.icon className={cn('h-5 w-5', item.color)} />
                    <span className="text-xs font-medium text-foreground/80">{item.label}</span>
                  </div>
                );

                return item.enabled
                  ? <Link key={item.href} href={item.href}>{content}</Link>
                  : <div key={item.href}>{content}</div>;
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
