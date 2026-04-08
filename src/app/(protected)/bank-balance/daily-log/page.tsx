'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Calendar as CalendarIcon, ShieldAlert, Download, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { BankAccount, BankExpense, BankDailyLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, startOfDay, endOfDay, eachDayOfInterval, compareDesc } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';

interface EnrichedBankDailyLog extends BankDailyLog {
  availableBalance: number;
}

export default function DailyLogPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [dailyLogs, setDailyLogs] = useState<EnrichedBankDailyLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: new Date(), to: new Date() });
  const [bankFilter, setBankFilter] = useState<string>('all');

  const canView = !authLoading && can('View', 'Bank Balance.Daily Log');

  useEffect(() => {
    if (authLoading) return;
    if (!canView) { setIsLoading(false); return; }
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [accountsSnap, expensesSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses')),
      ]);
      setBankAccounts(accountsSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount)));
      setAllTransactions(expensesSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankExpense)));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const getDpForDate = (account: BankAccount, date: Date): number => {
    if (account.accountType !== 'Cash Credit' || !account.drawingPower?.length) return 0;
    const sorted = [...account.drawingPower].sort((a, b) => new Date(b.fromDate).getTime() - new Date(a.fromDate).getTime());
    const applicable = sorted.find(dp => new Date(dp.fromDate) <= startOfDay(date));
    return applicable ? applicable.amount : 0;
  };

  useEffect(() => {
    if (isLoading || !canView) return;
    const logs: EnrichedBankDailyLog[] = [];
    bankAccounts.forEach(account => {
      const isCC = account.accountType === 'Cash Credit';
      const opening = isCC ? (account.openingUtilization || 0) : (account.openingBalance || 0);
      if (!account.openingDate) return;
      let runningBalance = opening;
      const days = eachDayOfInterval({ start: startOfDay(new Date(account.openingDate)), end: endOfDay(new Date()) });
      days.forEach(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        const todaysTx = allTransactions.filter(t => t.accountId === account.id && format(t.date.toDate(), 'yyyy-MM-dd') === dayStr);
        const expenses = todaysTx.filter(t => t.type === 'Debit' && !t.isContra).reduce((s, t) => s + t.amount, 0);
        const receipts = todaysTx.filter(t => t.type === 'Credit' && !t.isContra).reduce((s, t) => s + t.amount, 0);
        let contra = 0;
        if (isCC) {
          contra = todaysTx.filter(t => t.isContra).reduce((s, t) => s + (t.type === 'Debit' ? t.amount : -t.amount), 0);
        } else {
          contra = todaysTx.filter(t => t.isContra).reduce((s, t) => s + (t.type === 'Credit' ? t.amount : -t.amount), 0);
        }
        const openingBalance = runningBalance;
        const closingBalance = isCC ? openingBalance + expenses - receipts + contra : openingBalance - expenses + receipts + contra;
        const dp = isCC ? getDpForDate(account, day) : 0;
        const availableBalance = isCC ? dp - closingBalance : closingBalance;
        logs.push({ id: `${dayStr}-${account.id}`, date: dayStr, accountId: account.id, accountName: account.shortName, openingBalance, totalExpenses: expenses, totalReceipts: receipts, totalContra: contra, closingBalance, availableBalance });
        runningBalance = closingBalance;
      });
    });
    logs.sort((a, b) => compareDesc(new Date(a.date), new Date(b.date)));
    setDailyLogs(logs);
  }, [bankAccounts, allTransactions, isLoading, canView]);

  const filteredLogs = useMemo(() => {
    return dailyLogs.filter(log => {
      const logDate = new Date(log.date);
      const inRange = dateRange?.from && dateRange.to
        ? logDate >= startOfDay(dateRange.from) && logDate <= endOfDay(dateRange.to)
        : true;
      return inRange && (bankFilter === 'all' || log.accountId === bankFilter);
    });
  }, [dailyLogs, dateRange, bankFilter]);

  // Summary stats for filtered period
  const summary = useMemo(() => ({
    totalExpenses: filteredLogs.reduce((s, l) => s + l.totalExpenses, 0),
    totalReceipts: filteredLogs.reduce((s, l) => s + l.totalReceipts, 0),
    entries: filteredLogs.length,
  }), [filteredLogs]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4">
        <Skeleton className="h-10 w-64" />
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
          <Link href="/bank-balance/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <h1 className="text-xl font-bold">Daily Utilization Log</h1>
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
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Daily Balance Log</h1>
            <p className="text-xs text-muted-foreground">History of daily balances and utilization across all accounts.</p>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-red-200/60 bg-red-50/60 dark:bg-red-950/20 dark:border-red-800/30 p-3 flex items-center gap-3">
          <div className="rounded-full bg-red-100 dark:bg-red-900/40 p-2">
            <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Period Payments</p>
            <p className="text-sm font-bold text-red-700 dark:text-red-400">{formatCurrency(summary.totalExpenses)}</p>
          </div>
        </div>
        <div className="rounded-xl border border-green-200/60 bg-green-50/60 dark:bg-green-950/20 dark:border-green-800/30 p-3 flex items-center gap-3">
          <div className="rounded-full bg-green-100 dark:bg-green-900/40 p-2">
            <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Period Receipts</p>
            <p className="text-sm font-bold text-green-700 dark:text-green-400">{formatCurrency(summary.totalReceipts)}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 flex items-center gap-3">
          <div className="rounded-full bg-muted p-2">
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Log Entries</p>
            <p className="text-sm font-bold">{summary.entries}</p>
          </div>
        </div>
      </div>

      <Card className="rounded-xl border-border/60 shadow-sm">
        {/* Filters */}
        <CardHeader className="border-b border-border/40 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button id="date" variant="outline" className={cn('w-[300px] justify-start text-left font-normal rounded-xl', !dateRange && 'text-muted-foreground')}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to
                      ? <>{format(dateRange.from, 'LLL dd, y')} – {format(dateRange.to, 'LLL dd, y')}</>
                      : format(dateRange.from, 'LLL dd, y')
                  ) : <span>Pick a date range</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
              </PopoverContent>
            </Popover>

            <Select value={bankFilter} onValueChange={setBankFilter}>
              <SelectTrigger className="w-[220px] rounded-xl">
                <SelectValue placeholder="All Banks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Banks</SelectItem>
                {bankAccounts.map(acc => (
                  <SelectItem key={acc.id} value={acc.id}>{acc.shortName} – {acc.bankName}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button onClick={() => { setDateRange(undefined); setBankFilter('all'); }} variant="secondary" className="rounded-xl">
              Clear Filters
            </Button>

            {filteredLogs.length > 0 && (
              <Badge variant="outline" className="ml-auto">
                {filteredLogs.length} record{filteredLogs.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Date</TableHead>
                  <TableHead className="font-semibold">Bank</TableHead>
                  <TableHead className="font-semibold text-right">Opening</TableHead>
                  <TableHead className="font-semibold text-right">Payments</TableHead>
                  <TableHead className="font-semibold text-right">Receipts</TableHead>
                  <TableHead className="font-semibold text-right">Contra</TableHead>
                  <TableHead className="font-semibold text-right">Closing</TableHead>
                  <TableHead className="font-semibold text-right">Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}><Skeleton className="h-6 rounded-lg" /></TableCell>
                    </TableRow>
                  ))
                  : filteredLogs.length > 0
                    ? filteredLogs.map(log => (
                      <TableRow key={log.id} className="hover:bg-muted/20 transition-colors">
                        <TableCell className="font-medium text-sm">
                          {format(new Date(log.date), 'dd MMM, yyyy')}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-medium">{log.accountName}</span>
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(log.openingBalance)}</TableCell>
                        <TableCell className="text-right">
                          <span className={cn('text-sm font-medium', log.totalExpenses > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                            {log.totalExpenses > 0 ? `−${formatCurrency(log.totalExpenses)}` : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn('text-sm font-medium', log.totalReceipts > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground')}>
                            {log.totalReceipts > 0 ? `+${formatCurrency(log.totalReceipts)}` : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {log.totalContra !== 0 ? formatCurrency(log.totalContra) : '—'}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">{formatCurrency(log.closingBalance)}</TableCell>
                        <TableCell className="text-right">
                          <span className={cn('text-sm font-bold', log.availableBalance < 0 ? 'text-red-600 dark:text-red-400' : 'text-primary')}>
                            {formatCurrency(log.availableBalance)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                    : (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center h-32 text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <CalendarIcon className="h-8 w-8 opacity-30" />
                            <p>No logs found for the selected criteria.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                }
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
