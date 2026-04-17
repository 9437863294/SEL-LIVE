'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Gauge, CreditCard, RefreshCw, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';
import { getApplicableCcLimit, getApplicableCcLimitEntry, getEffectiveCcLimitFromEntry } from '@/lib/bank-balance-limit';

interface DpUtilizationRow {
  id: string;
  bankName: string;
  shortName: string;
  accountNumber: string;
  status: string;
  dpAmount: number;
  odAmount: number;
  todAmount: number;
  totalLimit: number;
  currentUtilization: number;
  availableHeadroom: number;
  utilizationPct: number;
  dpFromDate: string;
}

export default function DpUtilizationPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [rows, setRows] = useState<DpUtilizationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const canView = can('View', 'Bank Balance.Reports');

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [accountsSnap, expensesSnap] = await Promise.all([
        getDocs(query(collection(db, 'bankAccounts'), orderBy('bankName'))),
        getDocs(collection(db, 'bankExpenses')),
      ]);
      const accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount));
      const expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankExpense));

      const today = new Date();
      const ccAccounts = accounts.filter(a => a.accountType === 'Cash Credit');

      const result: DpUtilizationRow[] = ccAccounts.map(account => {
        // Calculate current utilization
        let utilization = account.openingUtilization || 0;
        expenses
          .filter(t => t.accountId === account.id)
          .sort((a, b) => a.date.toMillis() - b.date.toMillis())
          .forEach(t => {
            utilization += t.type === 'Debit' ? t.amount : -t.amount;
          });
        utilization = Math.max(0, utilization);

        // Get applicable DP entry for today
        const dpEntry = getApplicableCcLimitEntry(account, today);
        const totalLimit = getEffectiveCcLimitFromEntry(dpEntry);
        const availableHeadroom = Math.max(0, totalLimit - utilization);
        const utilizationPct = totalLimit > 0 ? (utilization / totalLimit) * 100 : 0;

        return {
          id: account.id,
          bankName: account.bankName,
          shortName: account.shortName,
          accountNumber: account.accountNumber,
          status: account.status || 'Active',
          dpAmount: dpEntry?.amount || 0,
          odAmount: dpEntry?.odAmount || 0,
          todAmount: dpEntry?.todAmount || 0,
          totalLimit,
          currentUtilization: utilization,
          availableHeadroom,
          utilizationPct,
          dpFromDate: dpEntry?.fromDate || '',
        };
      });

      setRows(result);
      setLastUpdated(new Date());
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to calculate DP utilization.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && canView) void fetchData();
    else if (!authLoading && !canView) setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const totalLimit = useMemo(() => rows.reduce((s, r) => s + r.totalLimit, 0), [rows]);
  const totalUtilization = useMemo(() => rows.reduce((s, r) => s + r.currentUtilization, 0), [rows]);
  const totalHeadroom = useMemo(() => rows.reduce((s, r) => s + r.availableHeadroom, 0), [rows]);
  const overallPct = totalLimit > 0 ? (totalUtilization / totalLimit) * 100 : 0;

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v || 0);

  function utilizationColor(pct: number) {
    if (pct >= 90) return 'text-red-600 dark:text-red-400';
    if (pct >= 75) return 'text-orange-600 dark:text-orange-400';
    if (pct >= 50) return 'text-amber-600 dark:text-amber-400';
    return 'text-emerald-600 dark:text-emerald-400';
  }

  function progressColor(pct: number) {
    if (pct >= 90) return '[&>div]:bg-red-500';
    if (pct >= 75) return '[&>div]:bg-orange-500';
    if (pct >= 50) return '[&>div]:bg-amber-500';
    return '[&>div]:bg-emerald-500';
  }

  function utilizationBadge(pct: number) {
    if (pct >= 90) return { label: 'Critical', cls: 'border-red-200 text-red-700 bg-red-50 dark:bg-red-950/20' };
    if (pct >= 75) return { label: 'High', cls: 'border-orange-200 text-orange-700 bg-orange-50 dark:bg-orange-950/20' };
    if (pct >= 50) return { label: 'Moderate', cls: 'border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-950/20' };
    return { label: 'Healthy', cls: 'border-emerald-200 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20' };
  }

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4 py-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-3 gap-4"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/bank-balance/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <h1 className="text-xl font-bold">DP Utilization</h1>
        </div>
        <Card>
          <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-rose-50/60 via-background to-pink-50/40 dark:from-rose-950/20 dark:via-background dark:to-pink-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-rose-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-pink-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(244,63,94,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/bank-balance/reports">
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/30">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                <Gauge className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                DP Utilization Report
              </h1>
              <p className="text-xs text-muted-foreground">
                Drawing power limits and current utilization for Cash Credit accounts &nbsp;·&nbsp; As of {format(new Date(), 'dd MMM yyyy HH:mm')}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => void fetchData()} disabled={isLoading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="rounded-xl border-rose-200/60 bg-gradient-to-br from-rose-500/5 to-background shadow-sm overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-rose-500 to-pink-400" />
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Total DP Limit</p>
              <p className="text-xl font-bold text-rose-700 dark:text-rose-400">{formatCurrency(totalLimit)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{rows.length} CC account{rows.length !== 1 ? 's' : ''}</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl border-orange-200/60 bg-gradient-to-br from-orange-500/5 to-background shadow-sm overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-400" />
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Utilization</p>
              <p className={cn('text-xl font-bold', utilizationColor(overallPct))}>{formatCurrency(totalUtilization)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{overallPct.toFixed(1)}% of total limit used</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl border-emerald-200/60 bg-gradient-to-br from-emerald-500/5 to-background shadow-sm overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500 to-teal-400" />
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Available Headroom</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(totalHeadroom)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{(100 - overallPct).toFixed(1)}% headroom remaining</p>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card className="rounded-xl border-border/60 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-border/40 pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-rose-500" />
              Account-wise DP Utilization
            </CardTitle>
            <CardDescription>Based on drawing power logs and current calculated utilization.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-semibold text-xs">Bank / Account</TableHead>
                    <TableHead className="text-right font-semibold text-xs">DP</TableHead>
                    <TableHead className="text-right font-semibold text-xs">OD</TableHead>
                    <TableHead className="text-right font-semibold text-xs">TOD</TableHead>
                    <TableHead className="text-right font-semibold text-xs">Total Limit</TableHead>
                    <TableHead className="text-right font-semibold text-xs">Utilization</TableHead>
                    <TableHead className="text-right font-semibold text-xs">Headroom</TableHead>
                    <TableHead className="font-semibold text-xs w-40">Usage</TableHead>
                    <TableHead className="font-semibold text-xs w-24">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center h-32 text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <CreditCard className="h-8 w-8 opacity-30" />
                          <p className="text-sm">No Cash Credit accounts found.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : rows.map(row => {
                    const badge = utilizationBadge(row.utilizationPct);
                    return (
                      <TableRow key={row.id} className="hover:bg-muted/20 text-xs transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-rose-400 shrink-0" />
                            <div>
                              <p className="font-semibold">{row.bankName}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{row.accountNumber}</p>
                              {row.dpFromDate && (
                                <p className="text-[10px] text-muted-foreground">DP since {format(new Date(row.dpFromDate), 'dd MMM yyyy')}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(row.dpAmount)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{row.odAmount > 0 ? formatCurrency(row.odAmount) : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{row.todAmount > 0 ? formatCurrency(row.todAmount) : '—'}</TableCell>
                        <TableCell className="text-right font-semibold font-mono">{formatCurrency(row.totalLimit)}</TableCell>
                        <TableCell className={cn('text-right font-semibold font-mono', utilizationColor(row.utilizationPct))}>
                          {formatCurrency(row.currentUtilization)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(row.availableHeadroom)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 min-w-[120px]">
                            <Progress
                              value={Math.min(100, row.utilizationPct)}
                              className={cn('h-2', progressColor(row.utilizationPct))}
                            />
                            <span className={cn('text-[10px] font-semibold', utilizationColor(row.utilizationPct))}>
                              {row.utilizationPct.toFixed(1)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-xs', badge.cls)}>{badge.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {rows.length > 0 && (
                  <TableFooter>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={4} className="font-bold text-xs">TOTAL</TableCell>
                      <TableCell className="text-right font-bold text-xs font-mono">{formatCurrency(totalLimit)}</TableCell>
                      <TableCell className={cn('text-right font-bold text-xs font-mono', utilizationColor(overallPct))}>{formatCurrency(totalUtilization)}</TableCell>
                      <TableCell className="text-right font-bold text-xs font-mono text-emerald-700">{formatCurrency(totalHeadroom)}</TableCell>
                      <TableCell colSpan={2} className="text-xs text-muted-foreground font-mono">{overallPct.toFixed(1)}% overall</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
