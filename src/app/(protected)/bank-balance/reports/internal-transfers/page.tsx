'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, ArrowRightLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';

interface TransferRow {
  contraId: string;
  date: Date;
  fromAccountId: string;
  toAccountId: string;
  fromAccountName: string;
  toAccountName: string;
  amount: number;
  description: string;
}

type AccountFilter = 'all' | string;

export default function InternalTransfersPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [allExpenses, setAllExpenses] = useState<BankExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [fromDate, setFromDate] = useState<string>(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState<string>(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');

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

  const accountMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    accounts.forEach(a => { map[a.id] = `${a.bankName} (${a.shortName})`; });
    return map;
  }, [accounts]);

  const transfers = useMemo<TransferRow[]>(() => {
    const from = new Date(fromDate + 'T00:00:00');
    const to = new Date(toDate + 'T23:59:59');

    const contraEntries = allExpenses.filter(t => t.isContra && t.contraId);

    // Group by contraId — each pair shares the same contraId
    const grouped = new Map<string, BankExpense[]>();
    contraEntries.forEach(t => {
      const key = t.contraId!;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(t);
    });

    const rows: TransferRow[] = [];
    grouped.forEach((entries, contraId) => {
      const debit = entries.find(e => e.type === 'Debit');
      const credit = entries.find(e => e.type === 'Credit');
      if (!debit || !credit) return;

      const txnDate = debit.date.toDate();
      if (txnDate < from || txnDate > to) return;

      rows.push({
        contraId,
        date: txnDate,
        fromAccountId: debit.accountId,
        toAccountId: credit.accountId,
        fromAccountName: accountMap[debit.accountId] || debit.accountId,
        toAccountName: accountMap[credit.accountId] || credit.accountId,
        amount: debit.amount,
        description: debit.description || credit.description || '',
      });
    });

    rows.sort((a, b) => b.date.getTime() - a.date.getTime());

    if (accountFilter !== 'all') {
      return rows.filter(r => r.fromAccountId === accountFilter || r.toAccountId === accountFilter);
    }
    return rows;
  }, [allExpenses, accountMap, fromDate, toDate, accountFilter]);

  const totalAmount = useMemo(() => transfers.reduce((s, r) => s + r.amount, 0), [transfers]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(v || 0);

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4 py-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/bank-balance/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <h1 className="text-xl font-bold">Inter-bank Transfers</h1>
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
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/60 via-background to-blue-50/40 dark:from-indigo-950/20 dark:via-background dark:to-blue-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-indigo-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-blue-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <Link href="/bank-balance/reports">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-indigo-50 dark:hover:bg-indigo-950/30">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              Inter-bank Transfers
            </h1>
            <p className="text-xs text-muted-foreground">All internal fund transfers (contra entries) between bank accounts.</p>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-5 rounded-xl border-border/60 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[220px]">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Account (From or To)</Label>
                <Select value={accountFilter} onValueChange={setAccountFilter}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="All accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Accounts</SelectItem>
                    {accounts.map(acc => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.bankName} — {acc.shortName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">From Date</Label>
                <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-9 w-40" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">To Date</Label>
                <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-9 w-40" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="rounded-xl border-border/60 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-border/40 pb-4">
            <CardTitle className="text-base">Transfer Log</CardTitle>
            <CardDescription>
              {fromDate && toDate
                ? `${format(new Date(fromDate), 'dd MMM yyyy')} to ${format(new Date(toDate), 'dd MMM yyyy')}`
                : ''}
              &nbsp;·&nbsp; {transfers.length} transfer{transfers.length !== 1 ? 's' : ''}
              {accountFilter !== 'all' && ` · filtered by ${accountMap[accountFilter] ?? accountFilter}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-semibold text-xs w-28">Date</TableHead>
                    <TableHead className="font-semibold text-xs">From Account</TableHead>
                    <TableHead className="font-semibold text-xs w-8 text-center"></TableHead>
                    <TableHead className="font-semibold text-xs">To Account</TableHead>
                    <TableHead className="font-semibold text-xs">Description</TableHead>
                    <TableHead className="text-right font-semibold text-xs w-36">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center h-32 text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <Search className="h-8 w-8 opacity-30" />
                          <p className="text-sm">No inter-bank transfers found for this period.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : transfers.map(row => (
                    <TableRow key={row.contraId} className="hover:bg-muted/20 text-xs transition-colors">
                      <TableCell className="font-mono text-xs">
                        {format(row.date, 'dd/MM/yyyy')}
                        <span className="text-[10px] text-muted-foreground ml-1">{format(row.date, 'EEE')}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-red-600 dark:text-red-400">{row.fromAccountName}</span>
                      </TableCell>
                      <TableCell className="text-center px-1">
                        <ArrowRightLeft className="h-3.5 w-3.5 text-indigo-400 mx-auto" />
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-green-600 dark:text-green-400">{row.toAccountName}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs">
                        <span className="line-clamp-1">{row.description || '—'}</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold font-mono text-indigo-600 dark:text-indigo-400">
                        {formatCurrency(row.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {transfers.length > 0 && (
                  <TableFooter>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={5} className="font-bold text-xs">TOTAL ({transfers.length} transfers)</TableCell>
                      <TableCell className="text-right font-bold text-xs font-mono text-indigo-700 dark:text-indigo-400">
                        {formatCurrency(totalAmount)}
                      </TableCell>
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
