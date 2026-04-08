'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Building2, CreditCard, TrendingUp, Wallet, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';

interface BankPosition {
  id: string;
  bankName: string;
  shortName: string;
  accountNumber: string;
  accountType: string;
  closingBalance: number;
  status: string;
}

export default function BankPositionReportPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [bankPositions, setBankPositions] = useState<BankPosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const canView = can('View', 'Bank Balance.Reports');

  const fetchAndCalculate = async () => {
    setIsLoading(true);
    try {
      const [accountsSnap, expensesSnap] = await Promise.all([
        getDocs(query(collection(db, 'bankAccounts'), orderBy('bankName'))),
        getDocs(collection(db, 'bankExpenses')),
      ]);
      const accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount));
      const transactions = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankExpense));

      const positions: BankPosition[] = accounts.map(account => {
        const isCC = account.accountType === 'Cash Credit';
        let closingBalance = isCC ? (account.openingUtilization || 0) : (account.openingBalance || 0);
        transactions
          .filter(t => t.accountId === account.id)
          .sort((a, b) => a.date.toMillis() - b.date.toMillis())
          .forEach(t => {
            const amt = t.amount || 0;
            if (isCC) closingBalance += t.type === 'Debit' ? amt : -amt;
            else closingBalance += t.type === 'Credit' ? amt : -amt;
          });
        return { id: account.id, bankName: account.bankName, shortName: account.shortName, accountNumber: account.accountNumber, accountType: account.accountType, closingBalance, status: account.status || 'Active' };
      });

      setBankPositions(positions);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error calculating bank positions:', error);
      toast({ title: 'Error', description: 'Failed to calculate bank positions.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && canView) void fetchAndCalculate();
    else if (!authLoading && !canView) setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const grandTotal = useMemo(() => bankPositions.reduce((sum, pos) => sum + pos.closingBalance, 0), [bankPositions]);
  const totalCC = useMemo(() => bankPositions.filter(p => p.accountType === 'Cash Credit').reduce((s, p) => s + p.closingBalance, 0), [bankPositions]);
  const totalCA = useMemo(() => bankPositions.filter(p => p.accountType !== 'Cash Credit').reduce((s, p) => s + p.closingBalance, 0), [bankPositions]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount || 0);

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <h1 className="text-xl font-bold">Bank Position Report</h1>
        </div>
        <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/bank-balance/reports">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Bank Position Report</h1>
            <p className="text-xs text-muted-foreground">
              As of {format(new Date(), 'MMMM do, yyyy')} &nbsp;·&nbsp; Updated {format(lastUpdated, 'HH:mm:ss')}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => void fetchAndCalculate()} disabled={isLoading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-xl border-primary/20 bg-gradient-to-br from-primary/5 to-background shadow-sm overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-violet-400" />
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Grand Total</p>
              <p className="text-xl font-bold text-primary">{formatCurrency(grandTotal)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-sky-200/60 bg-sky-50/50 dark:bg-sky-950/20 dark:border-sky-800/30 shadow-sm overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-400 to-blue-400" />
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-xl bg-sky-100 dark:bg-sky-900/40 p-2.5">
              <Building2 className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Current Accounts</p>
              <p className="text-xl font-bold text-sky-700 dark:text-sky-400">{formatCurrency(totalCA)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-violet-200/60 bg-violet-50/50 dark:bg-violet-950/20 dark:border-violet-800/30 shadow-sm overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-400 to-purple-400" />
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-xl bg-violet-100 dark:bg-violet-900/40 p-2.5">
              <CreditCard className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">CC Utilization</p>
              <p className="text-xl font-bold text-violet-700 dark:text-violet-400">{formatCurrency(totalCC)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card className="rounded-xl border-border/60 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-border/40 pb-4">
          <CardTitle className="text-base">Account-wise Positions</CardTitle>
          <CardDescription>Calculated from opening balances/utilizations and all ledger entries.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Bank Name</TableHead>
                  <TableHead className="font-semibold">Short Name</TableHead>
                  <TableHead className="font-semibold">Account No.</TableHead>
                  <TableHead className="font-semibold">Type</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="text-right font-semibold">Balance / Utilization</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8 rounded-lg" /></TableCell></TableRow>
                  ))
                  : bankPositions.length > 0
                    ? bankPositions.map(pos => (
                      <TableRow key={pos.id} className="hover:bg-muted/20 transition-colors">
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {pos.accountType === 'Cash Credit'
                              ? <CreditCard className="h-4 w-4 text-violet-500 shrink-0" />
                              : <Building2 className="h-4 w-4 text-sky-500 shrink-0" />
                            }
                            {pos.bankName}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{pos.shortName}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{pos.accountNumber}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-xs', pos.accountType === 'Cash Credit' ? 'border-violet-200 text-violet-700 bg-violet-50 dark:bg-violet-950/20' : 'border-sky-200 text-sky-700 bg-sky-50 dark:bg-sky-950/20')}>
                            {pos.accountType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={pos.status === 'Active' ? 'default' : 'secondary'} className={cn('text-xs', pos.status === 'Active' && 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border border-green-200/60')}>
                            {pos.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn('font-semibold text-sm', pos.closingBalance < 0 ? 'text-red-600 dark:text-red-400' : '')}>
                            {formatCurrency(pos.closingBalance)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                    : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center h-32 text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <Building2 className="h-8 w-8 opacity-30" />
                            <p>No bank accounts found.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                }
              </TableBody>
              {bankPositions.length > 0 && (
                <TableFooter>
                  <TableRow className="bg-primary/5 hover:bg-primary/5">
                    <TableCell colSpan={5} className="text-right font-bold text-base">Grand Total</TableCell>
                    <TableCell className="text-right font-bold text-base text-primary">{formatCurrency(grandTotal)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
