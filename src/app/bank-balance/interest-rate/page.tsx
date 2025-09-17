
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Calendar as CalendarIcon, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import type { BankAccount, BankExpense, BankDailyLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { format, startOfDay, endOfDay, eachDayOfInterval, compareDesc } from 'date-fns';
import { DateRange } from 'react-day-picker';

interface DailyInterestLog {
    id: string;
    date: string;
    accountId: string;
    bankName: string;
    interestRate: number;
    closingUtilization: number;
    interestAmount: number;
}

export default function InterestRateManagementPage() {
  const { toast } = useToast();
  // Manage Rates Tab State
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [interestRates, setInterestRates] = useState<Record<string, number>>({});
  const [isRatesLoading, setIsRatesLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Daily Log Tab State
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [dailyLogs, setDailyLogs] = useState<BankDailyLog[]>([]);
  const [interestLogs, setInterestLogs] = useState<DailyInterestLog[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [logDateRange, setLogDateRange] = useState<DateRange | undefined>();
  const [logBankFilter, setLogBankFilter] = useState('all');

  useEffect(() => {
    const fetchAllData = async () => {
      setIsRatesLoading(true);
      setIsLogLoading(true);
      try {
        const [accountsSnap, ratesSnap, expensesSnap] = await Promise.all([
            getDocs(collection(db, 'bankAccounts')),
            getDocs(collection(db, 'interestRates')),
            getDocs(collection(db, 'bankExpenses'))
        ]);
        
        // Data for both tabs
        const allAccounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
        const ccAccounts = allAccounts.filter(acc => acc.accountType === 'Cash Credit');
        setAccounts(ccAccounts);
        
        const ratesData = ratesSnap.docs.reduce((acc, doc) => {
            acc[doc.id] = doc.data().rate;
            return acc;
        }, {} as Record<string, number>);
        
        const initialRates = ccAccounts.reduce((acc, account) => {
            acc[account.id] = ratesData[account.id] || 10;
            return acc;
        }, {} as Record<string, number>);
        setInterestRates(initialRates);

        setAllTransactions(expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense)));

      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Error', description: 'Failed to fetch initial data.', variant: 'destructive' });
      }
      setIsRatesLoading(false);
      setIsLogLoading(false);
    };

    fetchAllData();
  }, [toast]);
  
  // Calculations for Daily Utilization Log (from daily-log page)
  useEffect(() => {
    if (isLogLoading || accounts.length === 0) return;

    const calculateUtilLogs = () => {
        const logs: BankDailyLog[] = [];
        accounts.forEach(account => {
            if (account.accountType !== 'Cash Credit' || !account.openingDate) return;

            let runningBalance = account.openingUtilization || 0;
            const interval = { start: startOfDay(new Date(account.openingDate)), end: endOfDay(new Date()) };
            const days = eachDayOfInterval(interval);

            days.forEach(day => {
                const dayString = format(day, 'yyyy-MM-dd');
                const transactionsToday = allTransactions.filter(t => t.accountId === account.id && format(t.date.toDate(), 'yyyy-MM-dd') === dayString);
                const expenses = transactionsToday.filter(t => t.type === 'Debit').reduce((sum, t) => sum + t.amount, 0);
                const receipts = transactionsToday.filter(t => t.type === 'Credit').reduce((sum, t) => sum + t.amount, 0);

                const openingBalance = runningBalance;
                const closingBalance = openingBalance - receipts + expenses;
                
                logs.push({
                    id: `${dayString}-${account.id}`, date: dayString, accountId: account.id,
                    accountName: account.shortName, openingBalance, closingBalance,
                    totalExpenses: expenses, totalReceipts: receipts, totalContra: 0 // Simplified for this context
                });
                runningBalance = closingBalance;
            });
        });
        setDailyLogs(logs);
    };
    calculateUtilLogs();
  }, [accounts, allTransactions, isLogLoading]);

  // Calculations for Daily Interest Log
  useEffect(() => {
    if (dailyLogs.length === 0 || Object.keys(interestRates).length === 0) return;

    const newInterestLogs = dailyLogs.map(log => {
        const rate = interestRates[log.accountId] || 0;
        const interestAmount = (log.closingBalance * (rate / 100)) / 365;
        return {
            id: log.id,
            date: log.date,
            accountId: log.accountId,
            bankName: accounts.find(a => a.id === log.accountId)?.bankName || 'N/A',
            interestRate: rate,
            closingUtilization: log.closingBalance,
            interestAmount: interestAmount,
        };
    }).sort((a,b) => compareDesc(new Date(a.date), new Date(b.date)));

    setInterestLogs(newInterestLogs);
  }, [dailyLogs, interestRates, accounts]);

  const filteredInterestLogs = useMemo(() => {
      return interestLogs.filter(log => {
        const logDate = new Date(log.date);
        const inDateRange = logDateRange && logDateRange.from && logDateRange.to ? 
            (logDate >= startOfDay(logDateRange.from) && logDate <= endOfDay(logDateRange.to)) : true;
        const bankMatch = logBankFilter === 'all' || log.accountId === logBankFilter;
        return inDateRange && bankMatch;
      });
  }, [interestLogs, logDateRange, logBankFilter]);


  const handleRateChange = (accountId: string, value: string) => {
    setInterestRates(prev => ({
      ...prev,
      [accountId]: parseFloat(value) || 0,
    }));
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
        const promises = Object.entries(interestRates).map(([accountId, rate]) => {
            const rateRef = doc(db, 'interestRates', accountId);
            return setDoc(rateRef, { rate: rate });
        });
        await Promise.all(promises);
        toast({ title: 'Success', description: 'All interest rates have been saved.' });
    } catch (error) {
        console.error("Error saving interest rates:", error);
        toast({ title: 'Error', description: 'Failed to save interest rates.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };
  
  const calculateProjectedInterest = (utilization: number, rate: number) => {
      if (utilization <= 0 || rate <= 0) return 0;
      return (utilization * (rate / 100)) / 365;
  };
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const clearLogFilters = () => {
      setLogDateRange(undefined);
      setLogBankFilter('all');
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/bank-balance/settings">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
        </Link>
        <h1 className="text-2xl font-bold">Interest Rate Management</h1>
      </div>
      
      <Tabs defaultValue="manage-rates">
        <TabsList>
          <TabsTrigger value="manage-rates">Manage Rates</TabsTrigger>
          <TabsTrigger value="daily-log">Daily Log</TabsTrigger>
          <TabsTrigger value="monthly-summary">Monthly Summary</TabsTrigger>
        </TabsList>
        <TabsContent value="manage-rates" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Set Interest Rates</CardTitle>
              <CardDescription>Update the current interest rate (%) for each Cash Credit account.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bank Name</TableHead>
                    <TableHead>Current Day Utilization</TableHead>
                    <TableHead className="w-[150px]">Interest Rate (%)</TableHead>
                    <TableHead>Projected Daily Interest</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isRatesLoading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-8" /></TableCell>
                        <TableCell><Skeleton className="h-8" /></TableCell>
                        <TableCell><Skeleton className="h-8" /></TableCell>
                        <TableCell><Skeleton className="h-8" /></TableCell>
                      </TableRow>
                    ))
                  ) : accounts.length > 0 ? (
                    accounts.map(acc => {
                        const currentRate = interestRates[acc.id] || 0;
                        const latestLog = dailyLogs.filter(l => l.accountId === acc.id).sort((a,b) => compareDesc(new Date(a.date), new Date(b.date)))[0];
                        const currentBalance = latestLog ? latestLog.closingBalance : acc.openingUtilization;
                        const projectedInterest = calculateProjectedInterest(currentBalance, currentRate);
                        return(
                           <TableRow key={acc.id}>
                            <TableCell className="font-medium">{acc.bankName}</TableCell>
                            <TableCell>{formatCurrency(currentBalance)}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={currentRate}
                                onChange={(e) => handleRateChange(acc.id, e.target.value)}
                                placeholder="e.g. 10"
                              />
                            </TableCell>
                            <TableCell>{formatCurrency(projectedInterest)}</TableCell>
                          </TableRow>
                        )
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center h-24">No Cash Credit accounts found.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="flex justify-end mt-6">
                <Button onClick={handleSaveAll} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                    Save Rates
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="daily-log">
           <Card>
            <CardHeader>
                <CardTitle>Daily Interest Rate Log</CardTitle>
                <CardDescription>History of all interest rate updates.</CardDescription>
                <div className="flex flex-wrap items-center gap-4 pt-4">
                   <Popover>
                        <PopoverTrigger asChild>
                            <Button id="date" variant={"outline"} className={cn("w-[300px] justify-start text-left font-normal", !logDateRange && "text-muted-foreground")}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {logDateRange?.from ? (logDateRange.to ? (<>{format(logDateRange.from, "LLL dd, y")} - {format(logDateRange.to, "LLL dd, y")}</>) : (format(logDateRange.from, "LLL dd, y"))) : (<span>Pick a date range</span>)}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar initialFocus mode="range" defaultMonth={logDateRange?.from} selected={logDateRange} onSelect={setLogDateRange} numberOfMonths={2} />
                        </PopoverContent>
                    </Popover>
                    <Select value={logBankFilter} onValueChange={setLogBankFilter}>
                        <SelectTrigger className="w-[240px]">
                            <SelectValue placeholder="All Banks" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Banks</SelectItem>
                            {accounts.map(acc => (
                                <SelectItem key={acc.id} value={acc.id}>{acc.bankName}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button onClick={clearLogFilters} variant="secondary">Clear Filters</Button>
                </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Bank Name</TableHead>
                    <TableHead>Interest Rate (%)</TableHead>
                    <TableHead>Closing Utilization</TableHead>
                    <TableHead>Interest Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLogLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-6" /></TableCell></TableRow>
                    ))
                  ) : filteredInterestLogs.length > 0 ? (
                    filteredInterestLogs.map(log => (
                      <TableRow key={log.id}>
                        <TableCell>{format(new Date(log.date), 'dd MMM, yyyy')}</TableCell>
                        <TableCell>{log.bankName}</TableCell>
                        <TableCell>{log.interestRate.toFixed(2)}%</TableCell>
                        <TableCell>{formatCurrency(log.closingUtilization)}</TableCell>
                        <TableCell>{formatCurrency(log.interestAmount)}</TableCell>
                        <TableCell className="text-right">
                            <Button variant="outline" size="sm"><Edit className="mr-2 h-4 w-4" />Edit</Button>
                            <Button variant="destructive" size="sm" className="ml-2"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={6} className="text-center h-24">No logs found for the selected criteria.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="monthly-summary">
          <p>Monthly Summary coming soon.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
