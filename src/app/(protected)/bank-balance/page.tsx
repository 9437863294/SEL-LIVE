
'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Home, Banknote, Plus, Settings, Scale, ArrowDown, ArrowUp,
  ArrowRightLeft, BarChart3, ShieldAlert, Activity, TrendingUp,
  TrendingDown, RefreshCw, CreditCard, Building2, Wallet,
  ChevronRight, BookOpen, Percent, Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { format, startOfDay, endOfDay, isToday } from 'date-fns';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogClose, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export default function BankBalanceDashboard() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDailyEntryOpen, setIsDailyEntryOpen] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const canView = can('View Module', 'Bank Balance');

  const fetchData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setRefreshing(true);
    try {
      const [accountsSnap, expensesSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses')),
      ]);
      setAccounts(accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount)));
      setAllTransactions(expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense)));
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
  }, [canView, authLoading]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount || 0);

  const getLatestDp = (account: BankAccount) => {
    if (!account.drawingPower || account.drawingPower.length === 0) return 0;
    return account.drawingPower[0].amount || 0;
  };

  const calculatedBalances = useMemo(() => {
    const balances: Record<string, number> = {};
    accounts.forEach(account => {
      const isCC = account.accountType === 'Cash Credit';
      let current = isCC ? (account.openingUtilization || 0) : (account.openingBalance || 0);
      if (account.openingDate) {
        const start = startOfDay(new Date(account.openingDate));
        const end = endOfDay(new Date());
        allTransactions
          .filter(t => t.accountId === account.id && t.date.toDate() >= start && t.date.toDate() <= end)
          .sort((a, b) => a.date.toMillis() - b.date.toMillis())
          .forEach(t => {
            current += isCC
              ? (t.type === 'Debit' ? t.amount : -t.amount)
              : (t.type === 'Credit' ? t.amount : -t.amount);
          });
      }
      balances[account.id] = current;
    });
    return balances;
  }, [accounts, allTransactions]);

  const totalConsolidatedBalance = useMemo(() => {
    let total = 0;
    accounts.forEach(account => {
      const balance = calculatedBalances[account.id] || 0;
      total += account.accountType === 'Cash Credit'
        ? getLatestDp(account) - balance
        : balance;
    });
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculatedBalances, accounts]);

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

  const activeAccounts = accounts.filter(a => a.status === 'Active');
  const ccAccounts = activeAccounts.filter(a => a.accountType === 'Cash Credit');
  const currentAccounts = activeAccounts.filter(a => a.accountType === 'Current Account');

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
        <div className="mb-6 flex items-center gap-2">
          <Link href="/"><Button variant="ghost" size="icon"><Home className="h-6 w-6" /></Button></Link>
          <h1 className="text-2xl font-bold">Bank Balance Dashboard</h1>
        </div>
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
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10">
                <Home className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Bank Balance</h1>
              <p className="text-xs text-muted-foreground">
                {format(new Date(), 'EEEE, MMMM do, yyyy')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            <Link href="/bank-balance/reports">
              <Button variant="outline" size="sm" className="rounded-full border-border/60" disabled={!can('View', 'Bank Balance.Reports')}>
                <BarChart3 className="mr-2 h-4 w-4" />
                Reports
              </Button>
            </Link>
            <Button size="sm" className="rounded-full shadow-md shadow-primary/20" onClick={() => setIsDailyEntryOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Daily Entry
            </Button>
            <Link href="/bank-balance/settings">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>

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
                <Badge variant="outline" className="text-xs border-primary/30 text-primary/80 bg-primary/5">
                  Live
                </Badge>
                <span className="text-xs text-muted-foreground">{format(lastRefreshed, 'HH:mm:ss')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Today's Stats Row ── */}
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-green-200/60 bg-green-50/70 dark:bg-green-950/20 dark:border-green-800/30 p-3 flex items-center gap-3 shadow-sm">
            <div className="rounded-full bg-green-100 dark:bg-green-900/40 p-2">
              <ArrowUp className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-green-700/70 dark:text-green-400/70 font-medium">Today's Receipts</p>
              <p className="text-sm font-bold text-green-700 dark:text-green-400">{formatCurrency(todayStats.credits)}</p>
            </div>
          </div>
          <div className="rounded-xl border border-red-200/60 bg-red-50/70 dark:bg-red-950/20 dark:border-red-800/30 p-3 flex items-center gap-3 shadow-sm">
            <div className="rounded-full bg-red-100 dark:bg-red-900/40 p-2">
              <ArrowDown className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-xs text-red-700/70 dark:text-red-400/70 font-medium">Today's Payments</p>
              <p className="text-sm font-bold text-red-700 dark:text-red-400">{formatCurrency(todayStats.debits)}</p>
            </div>
          </div>
          <div className="rounded-xl border border-blue-200/60 bg-blue-50/70 dark:bg-blue-950/20 dark:border-blue-800/30 p-3 flex items-center gap-3 shadow-sm">
            <div className="rounded-full bg-blue-100 dark:bg-blue-900/40 p-2">
              <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-blue-700/70 dark:text-blue-400/70 font-medium">Today's Transactions</p>
              <p className="text-sm font-bold text-blue-700 dark:text-blue-400">{todayStats.count} entries</p>
            </div>
          </div>
        </div>

        {/* ── Account Cards ── */}
        <ScrollArea className="flex-grow">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
            {accounts.map((account, idx) => {
              const isCC = account.accountType === 'Cash Credit';
              const currentBalance = calculatedBalances[account.id] || 0;
              const latestDp = getLatestDp(account);
              const displayBalance = isCC ? latestDp - currentBalance : currentBalance;
              const utilizationPct = isCC && latestDp > 0 ? Math.min(100, (currentBalance / latestDp) * 100) : 0;

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
                          <CardTitle className="text-sm font-semibold truncate">{account.shortName}</CardTitle>
                          <p className="text-xs text-muted-foreground truncate">{account.bankName}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge
                          variant={account.status === 'Active' ? 'default' : 'secondary'}
                          className={cn('text-[10px] px-1.5 py-0', account.status === 'Active' && 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border border-green-200/60')}
                        >
                          {account.status}
                        </Badge>
                        <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', isCC ? 'border-violet-200/60 text-violet-600' : 'border-sky-200/60 text-sky-600')}>
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
                          <span>Drawing Power: <span className="font-medium text-foreground">{formatCurrency(latestDp)}</span></span>
                          <span>Limit Left: <span className={cn('font-medium', utilizationColor)}>{formatCurrency(Math.max(0, displayBalance))}</span></span>
                        </div>
                      </>
                    )}

                    {/* Footer */}
                    <div className="pt-1 border-t border-border/40 flex justify-between items-center">
                      <span className="text-[10px] text-muted-foreground">{account.branch || '—'}</span>
                      <span className="text-[10px] text-muted-foreground">Since {account.openingDate ? format(new Date(account.openingDate), 'MMM yy') : '—'}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Add Account card */}
            <Link href="/bank-balance/accounts">
              <Card className="h-full min-h-[200px] border-2 border-dashed border-border/50 flex flex-col items-center justify-center text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all duration-300 cursor-pointer group rounded-xl">
                <div className="rounded-full border-2 border-dashed border-current p-3 mb-2 group-hover:scale-110 transition-transform duration-300">
                  <Plus className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium">Add New Account</p>
                <p className="text-xs opacity-70 mt-1">Configure a bank account</p>
              </Card>
            </Link>
          </div>

          {/* ── Quick Navigation Row ── */}
          <div className="mt-2 mb-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Quick Navigation</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {[
                { href: '/bank-balance/daily-log', icon: Calendar, label: 'Daily Log', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-800/30 hover:bg-blue-100/70' },
                { href: '/bank-balance/expenses', icon: ArrowDown, label: 'Payments', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-800/30 hover:bg-red-100/70' },
                { href: '/bank-balance/receipts', icon: ArrowUp, label: 'Receipts', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/20 border-green-200/60 dark:border-green-800/30 hover:bg-green-100/70' },
                { href: '/bank-balance/internal-transaction', icon: ArrowRightLeft, label: 'Transfers', color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-950/20 border-violet-200/60 dark:border-violet-800/30 hover:bg-violet-100/70' },
                { href: '/bank-balance/interest-rate', icon: Percent, label: 'Interest', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-800/30 hover:bg-amber-100/70' },
                { href: '/bank-balance/monthly-interest', icon: TrendingUp, label: 'Monthly', color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200/60 dark:border-indigo-800/30 hover:bg-indigo-100/70' },
              ].map(item => (
                <Link key={item.href} href={item.href}>
                  <div className={cn('flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all duration-200 cursor-pointer group', item.bg)}>
                    <item.icon className={cn('h-5 w-5', item.color)} />
                    <span className="text-xs font-medium text-foreground/80">{item.label}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* ── Daily Entry Dialog ── */}
      <Dialog open={isDailyEntryOpen} onOpenChange={setIsDailyEntryOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader className="text-center">
            <DialogTitle className="text-xl">Daily Entry</DialogTitle>
            <DialogDescription>Select the type of transaction to record.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-4 pt-2">
            <Link href="/bank-balance/expenses/new" onClick={() => setIsDailyEntryOpen(false)}>
              <div className="group relative overflow-hidden rounded-2xl border border-red-200 bg-gradient-to-b from-red-50 to-red-100/50 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800/40 p-6 cursor-pointer hover:shadow-lg hover:shadow-red-100/50 transition-all duration-300 hover:-translate-y-1 flex flex-col items-center text-center">
                <div className="rounded-full bg-red-100 dark:bg-red-900/50 p-3 mb-3 group-hover:scale-110 transition-transform">
                  <ArrowDown className="h-7 w-7 text-red-600 dark:text-red-400" />
                </div>
                <p className="font-semibold text-red-800 dark:text-red-300">Payment</p>
                <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-0.5">Record a debit</p>
              </div>
            </Link>
            <Link href="/bank-balance/receipts/new" onClick={() => setIsDailyEntryOpen(false)}>
              <div className="group relative overflow-hidden rounded-2xl border border-green-200 bg-gradient-to-b from-green-50 to-green-100/50 dark:from-green-950/30 dark:to-green-900/20 dark:border-green-800/40 p-6 cursor-pointer hover:shadow-lg hover:shadow-green-100/50 transition-all duration-300 hover:-translate-y-1 flex flex-col items-center text-center">
                <div className="rounded-full bg-green-100 dark:bg-green-900/50 p-3 mb-3 group-hover:scale-110 transition-transform">
                  <ArrowUp className="h-7 w-7 text-green-600 dark:text-green-400" />
                </div>
                <p className="font-semibold text-green-800 dark:text-green-300">Receipt</p>
                <p className="text-xs text-green-600/70 dark:text-green-400/70 mt-0.5">Record a credit</p>
              </div>
            </Link>
            <Link href="/bank-balance/internal-transaction/new" onClick={() => setIsDailyEntryOpen(false)}>
              <div className="group relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-b from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 dark:border-blue-800/40 p-6 cursor-pointer hover:shadow-lg hover:shadow-blue-100/50 transition-all duration-300 hover:-translate-y-1 flex flex-col items-center text-center">
                <div className="rounded-full bg-blue-100 dark:bg-blue-900/50 p-3 mb-3 group-hover:scale-110 transition-transform">
                  <ArrowRightLeft className="h-7 w-7 text-blue-600 dark:text-blue-400" />
                </div>
                <p className="font-semibold text-blue-800 dark:text-blue-300">Transfer</p>
                <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-0.5">Move between accounts</p>
              </div>
            </Link>
          </div>
          <DialogFooter className="mt-2">
            <DialogClose asChild>
              <Button variant="outline" className="w-full rounded-xl">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
