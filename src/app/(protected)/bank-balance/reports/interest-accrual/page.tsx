'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Percent, CreditCard, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { BankAccount, BankExpense, InterestRateLogEntry } from '@/lib/types';
import { format, eachMonthOfInterval, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';

interface MonthlyInterestRow {
  month: string;
  monthLabel: string;
  closingUtilization: number;
  rate: number;
  daysInMonth: number;
  estimatedInterest: number;
}

interface AccountInterestData {
  account: BankAccount;
  rows: MonthlyInterestRow[];
  totalInterest: number;
}

function getApplicableRate(account: BankAccount, monthStart: Date): number {
  if (!Array.isArray(account.interestRateLog) || account.interestRateLog.length === 0) return 0;
  const target = monthStart;
  const sorted = [...account.interestRateLog].sort(
    (a: InterestRateLogEntry, b: InterestRateLogEntry) =>
      new Date(b.fromDate).getTime() - new Date(a.fromDate).getTime(),
  );
  const entry = sorted.find((e: InterestRateLogEntry) => {
    const from = new Date(e.fromDate);
    const to = e.toDate ? new Date(e.toDate) : null;
    return from <= target && (to === null || to >= target);
  });
  return entry?.rate ?? 0;
}

export default function InterestAccrualPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [allExpenses, setAllExpenses] = useState<BankExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canView = can('View', 'Bank Balance.Reports');

  useEffect(() => {
    if (authLoading) return;
    if (!canView) { setIsLoading(false); return; }

    const fetchData = async () => {
      try {
        const [accountsSnap, expensesSnap] = await Promise.all([
          getDocs(collection(db, 'bankAccounts')),
          getDocs(collection(db, 'bankExpenses')),
        ]);
        setAccounts(accountsSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount)));
        setAllExpenses(expensesSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankExpense)));
      } catch (error) {
        console.error(error);
        toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [authLoading, canView, toast]);

  const ccAccounts = useMemo(
    () => accounts.filter(a => a.accountType === 'Cash Credit' && a.status === 'Active'),
    [accounts],
  );

  const interestData = useMemo<AccountInterestData[]>(() => {
    return ccAccounts.map(account => {
      const txns = allExpenses
        .filter(t => t.accountId === account.id && !t.isContra)
        .sort((a, b) => a.date.toMillis() - b.date.toMillis());

      if (txns.length === 0) return { account, rows: [], totalInterest: 0 };

      const firstDate = txns[0].date.toDate();
      const lastDate = txns[txns.length - 1].date.toDate();

      const months = eachMonthOfInterval({
        start: startOfMonth(firstDate),
        end: endOfMonth(lastDate),
      });

      let runningUtil = account.openingUtilization || 0;

      const rows: MonthlyInterestRow[] = months.map(monthStart => {
        const monthStr = format(monthStart, 'yyyy-MM');
        const monthEnd = endOfMonth(monthStart);

        // Apply all txns in this month
        txns
          .filter(t => format(t.date.toDate(), 'yyyy-MM') === monthStr)
          .forEach(t => {
            runningUtil += t.type === 'Debit' ? t.amount : -t.amount;
          });

        const rate = getApplicableRate(account, monthStart);
        const days = getDaysInMonth(monthStart);
        // Simple interest: utilization × rate/100 / 365 × days
        const estimatedInterest = runningUtil > 0 ? (runningUtil * rate) / 100 / 365 * days : 0;

        return {
          month: monthStr,
          monthLabel: format(monthStart, 'MMM yyyy'),
          closingUtilization: Math.max(0, runningUtil),
          rate,
          daysInMonth: days,
          estimatedInterest: Math.max(0, estimatedInterest),
        };
      });

      const totalInterest = rows.reduce((s, r) => s + r.estimatedInterest, 0);
      return { account, rows: rows.reverse(), totalInterest };
    });
  }, [ccAccounts, allExpenses]);

  const grandTotalInterest = useMemo(
    () => interestData.reduce((s, d) => s + d.totalInterest, 0),
    [interestData],
  );

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(v || 0);

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4 py-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/bank-balance/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <h1 className="text-xl font-bold">Interest Accrual</h1>
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
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50/60 via-background to-purple-50/40 dark:from-violet-950/20 dark:via-background dark:to-purple-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-violet-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-purple-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <Link href="/bank-balance/reports">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-violet-50 dark:hover:bg-violet-950/30">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Percent className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              Interest Accrual Report
            </h1>
            <p className="text-xs text-muted-foreground">Estimated monthly interest for Cash Credit accounts. Formula: Utilization × Rate / 365 × Days.</p>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-violet-200/60 bg-violet-50/50 dark:bg-violet-950/20 dark:border-violet-800/30 px-4 py-3">
          <Info className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Interest is estimated using the closing utilization of each month and the applicable interest rate.
            Actual interest charged by the bank may vary based on daily balances and bank-specific methods.
          </p>
        </div>

        {/* Grand Total */}
        {interestData.length > 0 && (
          <Card className="mb-5 rounded-xl border-violet-200/60 bg-gradient-to-br from-violet-500/5 to-background shadow-sm overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 to-purple-400" />
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-xl bg-violet-100 dark:bg-violet-900/40 p-2.5">
                <Percent className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Estimated Interest (All CC Accounts)</p>
                <p className="text-2xl font-bold text-violet-700 dark:text-violet-400">{formatCurrency(grandTotalInterest)}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {ccAccounts.length === 0 ? (
          <Card className="rounded-xl border-border/60">
            <CardContent className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
              <CreditCard className="h-10 w-10 opacity-30" />
              <p className="text-sm">No active Cash Credit accounts found.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {interestData.map(({ account, rows, totalInterest }) => (
              <Card key={account.id} className="rounded-xl border-border/60 shadow-sm overflow-hidden">
                <CardHeader className="border-b border-border/40 pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-violet-500" />
                      <div>
                        <CardTitle className="text-sm">{account.bankName} — {account.shortName}</CardTitle>
                        <CardDescription className="text-xs">{account.accountNumber}</CardDescription>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Total Est. Interest</p>
                      <p className="font-bold text-violet-700 dark:text-violet-400">{formatCurrency(totalInterest)}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableHead className="font-semibold text-xs">Month</TableHead>
                          <TableHead className="text-right font-semibold text-xs">Closing Utilization</TableHead>
                          <TableHead className="text-right font-semibold text-xs w-28">Rate (%)</TableHead>
                          <TableHead className="text-right font-semibold text-xs w-20">Days</TableHead>
                          <TableHead className="text-right font-semibold text-xs">Est. Interest</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center h-20 text-muted-foreground text-sm">
                              No transaction data.
                            </TableCell>
                          </TableRow>
                        ) : rows.map(row => (
                          <TableRow key={row.month} className="hover:bg-muted/20 text-xs transition-colors">
                            <TableCell className="font-medium">{row.monthLabel}</TableCell>
                            <TableCell className="text-right font-mono">{formatCurrency(row.closingUtilization)}</TableCell>
                            <TableCell className="text-right">
                              {row.rate > 0 ? (
                                <Badge variant="outline" className="text-xs border-violet-200 text-violet-700 bg-violet-50 dark:bg-violet-950/20">
                                  {row.rate.toFixed(2)}%
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">{row.daysInMonth}</TableCell>
                            <TableCell className={cn('text-right font-semibold font-mono', row.estimatedInterest > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
                              {row.estimatedInterest > 0 ? formatCurrency(row.estimatedInterest) : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      {rows.length > 0 && (
                        <TableFooter>
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={4} className="font-bold text-xs">TOTAL ESTIMATED INTEREST</TableCell>
                            <TableCell className="text-right font-bold text-xs text-rose-700 dark:text-rose-400 font-mono">{formatCurrency(totalInterest)}</TableCell>
                          </TableRow>
                        </TableFooter>
                      )}
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
