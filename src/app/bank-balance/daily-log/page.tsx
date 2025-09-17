
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Calendar as CalendarIcon, Edit, ShieldAlert, Trash2 } from 'lucide-react';
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

export default function DailyLogPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [dailyLogs, setDailyLogs] = useState<BankDailyLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [bankFilter, setBankFilter] = useState('all');

  const canView = can('View', 'Bank Balance.Daily Log');

  useEffect(() => {
    if (authLoading) return;
    if (!canView) {
        setIsLoading(false);
        return;
    }
    fetchData();
  }, [canView, authLoading]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [accountsSnap, expensesSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses'))
      ]);
      const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
      const transactions = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense));
      setBankAccounts(accounts);
      setAllTransactions(transactions);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    if (isLoading || !canView) return;
    
    const calculateLogs = () => {
        const logs: BankDailyLog[] = [];
        
        bankAccounts.forEach(account => {
            let runningBalance = account.openingUtilization || 0;
            if (!account.openingDate) return; // Skip if no opening date

            const interval = {
                start: startOfDay(new Date(account.openingDate)),
                end: endOfDay(new Date()),
            };

            const days = eachDayOfInterval(interval);

            days.forEach(day => {
                const dayString = format(day, 'yyyy-MM-dd');
                const transactionsToday = allTransactions.filter(t => 
                    t.accountId === account.id && 
                    format(t.date.toDate(), 'yyyy-MM-dd') === dayString
                );

                const expenses = transactionsToday.filter(t => t.type === 'Debit' && !t.isContra).reduce((sum, t) => sum + t.amount, 0);
                const receipts = transactionsToday.filter(t => t.type === 'Credit' && !t.isContra).reduce((sum, t) => sum + t.amount, 0);
                const contra = transactionsToday.filter(t => t.isContra).reduce((sum, t) => sum + (t.type === 'Debit' ? -t.amount : t.amount), 0);

                const openingBalance = runningBalance;
                const closingBalance = openingBalance + receipts - expenses + contra;
                
                logs.push({
                    id: `${dayString}-${account.id}`,
                    date: dayString,
                    accountId: account.id,
                    accountName: account.shortName,
                    openingBalance,
                    totalExpenses: expenses,
                    totalReceipts: receipts,
                    totalContra: contra,
                    closingBalance,
                });

                runningBalance = closingBalance;
            });
        });
        
        logs.sort((a,b) => compareDesc(new Date(a.date), new Date(b.date)));
        setDailyLogs(logs);
    };

    calculateLogs();
  }, [bankAccounts, allTransactions, isLoading, canView]);
  
  const filteredLogs = useMemo(() => {
      return dailyLogs.filter(log => {
        const logDate = new Date(log.date);
        const inDateRange = dateRange && dateRange.from && dateRange.to ? 
            (logDate >= startOfDay(dateRange.from) && logDate <= endOfDay(dateRange.to)) : true;
            
        const bankMatch = bankFilter === 'all' || log.accountId === bankFilter;

        return inDateRange && bankMatch;
      });
  }, [dailyLogs, dateRange, bankFilter]);
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const clearFilters = () => {
      setDateRange(undefined);
      setBankFilter('all');
  }

  if (authLoading || (isLoading && canView)) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-96 w-full" />
        </div>
    )
  }

  if (!canView) {
      return (
         <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href="/bank-balance/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                <h1 className="text-2xl font-bold">Daily Utilization Log</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view this page.</CardDescription>
                </CardHeader>
                 <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
      );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Daily Utilization Log</h1>
            <p className="text-muted-foreground">History of all opening utilization updates.</p>
          </div>
        </div>
      </div>
      
      <Card>
        <CardHeader>
            <div className="flex flex-wrap items-center gap-4">
               <Popover>
                    <PopoverTrigger asChild>
                        <Button id="date" variant={"outline"} className={cn("w-[300px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dateRange?.from ? (dateRange.to ? (<>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</>) : (format(dateRange.from, "LLL dd, y"))) : (<span>Pick a date range</span>)}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
                    </PopoverContent>
                </Popover>
                <Select value={bankFilter} onValueChange={setBankFilter}>
                    <SelectTrigger className="w-[240px]">
                        <SelectValue placeholder="All Banks" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Banks</SelectItem>
                        {bankAccounts.map(acc => (
                            <SelectItem key={acc.id} value={acc.id}>{acc.shortName} - {acc.bankName}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button onClick={clearFilters} variant="secondary">Clear Filters</Button>
            </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Bank Name</TableHead>
                <TableHead>Opening Utilization</TableHead>
                <TableHead>Expenses</TableHead>
                <TableHead>Receipts</TableHead>
                <TableHead>Contra</TableHead>
                <TableHead>Closing Utilization</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6" /></TableCell></TableRow>
                ))
              ) : filteredLogs.length > 0 ? (
                filteredLogs.map(log => (
                  <TableRow key={log.id}>
                    <TableCell>{format(new Date(log.date), 'dd MMM, yyyy')}</TableCell>
                    <TableCell>{log.accountName}</TableCell>
                    <TableCell>{formatCurrency(log.openingBalance)}</TableCell>
                    <TableCell className="text-red-600">{formatCurrency(log.totalExpenses)}</TableCell>
                    <TableCell className="text-green-600">{formatCurrency(log.totalReceipts)}</TableCell>
                    <TableCell>{formatCurrency(log.totalContra)}</TableCell>
                    <TableCell>{formatCurrency(log.closingBalance)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={7} className="text-center h-24">No logs found for the selected criteria.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
