
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, startOfDay, endOfDay, eachDayOfInterval, compareDesc } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { DateRange } from 'react-day-picker';

type RateLogEntry = { date: string; rate: number };

interface DailyInterestLog {
    id: string;
    date: string;
    accountId: string;
    accountName: string;
    closingUtilization: number;
    rate: number;
    dailyInterest: number;
}

export default function InterestRatePage() {
  const { toast } = useToast();
  // Common state
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Manage Rates Tab State
  const [newRateEntries, setNewRateEntries] = useState<Record<string, { date: string; rate: string }>>({});
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  
  // Daily Log Tab State
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyInterestLog[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [bankFilter, setBankFilter] = useState('all');


  const fetchData = async () => {
    setIsLoading(true);
    setIsLogLoading(true);
    try {
      const [accountsSnap, expensesSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses'))
      ]);
      
      const allAccounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
      const ccAccounts = allAccounts
        .filter(acc => acc.accountType === 'Cash Credit')
        .map(acc => ({
          ...acc,
          interestRateLog: Array.isArray(acc.interestRateLog) 
            ? acc.interestRateLog.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) 
            : [],
        }));
      setAccounts(ccAccounts);
      
      const transactions = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense));
      setAllTransactions(transactions);

    } catch (error) {
      console.error("Error fetching data: ", error);
      toast({ title: 'Error', description: 'Failed to fetch bank accounts or transactions.', variant: 'destructive' });
    }
    setIsLoading(false);
    setIsLogLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);
  
  useEffect(() => {
    if (isLoading || isLogLoading) return;

    const calculateLogs = () => {
        const logs: DailyInterestLog[] = [];
        
        accounts.forEach(account => {
            if (account.accountType !== 'Cash Credit' || !account.openingDate) return;

            let runningBalance = account.openingUtilization || 0;
            
            const getRateForDate = (date: Date): number => {
                const sortedLog = (account.interestRateLog || []).sort((a,b) => compareDesc(new Date(a.date), new Date(b.date)));
                const rateEntry = sortedLog.find(entry => new Date(entry.date) <= date);
                return rateEntry ? rateEntry.rate : 0;
            }

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

                const closingBalance = runningBalance + receipts - expenses + contra;
                
                const rate = getRateForDate(day);
                const dailyInterest = (closingBalance * (rate / 100)) / 365;
                
                logs.push({
                    id: `${dayString}-${account.id}`,
                    date: dayString,
                    accountId: account.id,
                    accountName: account.shortName,
                    closingUtilization: closingBalance,
                    rate,
                    dailyInterest,
                });

                runningBalance = closingBalance;
            });
        });
        
        logs.sort((a,b) => compareDesc(new Date(a.date), new Date(b.date)));
        setDailyLogs(logs);
    };

    calculateLogs();
  }, [accounts, allTransactions, isLoading, isLogLoading]);

  const filteredLogs = useMemo(() => {
    return dailyLogs.filter(log => {
      const logDate = new Date(log.date);
      const inDateRange = dateRange && dateRange.from && dateRange.to ? 
          (logDate >= startOfDay(dateRange.from) && logDate <= endOfDay(dateRange.to)) : true;
          
      const bankMatch = bankFilter === 'all' || log.accountId === bankFilter;

      return inDateRange && bankMatch;
    });
  }, [dailyLogs, dateRange, bankFilter]);
  
  const handleNewRateChange = (accountId: string, field: 'date' | 'rate', value: string) => {
    setNewRateEntries(prev => ({
        ...prev,
        [accountId]: {
            ...(prev[accountId] || { date: '', rate: '' }),
            [field]: value
        }
    }));
  };

  const handleAddRate = async (accountId: string) => {
    const newEntry = newRateEntries[accountId];
    if (!newEntry || !newEntry.date || !newEntry.rate) {
        toast({ title: 'Validation Error', description: 'Please provide both a date and a rate.', variant: 'destructive' });
        return;
    }

    const account = accounts.find(acc => acc.id === accountId);
    if (!account) return;
    
    setIsSaving(prev => ({...prev, [accountId]: true}));
    try {
        const updatedRateLog: RateLogEntry[] = [
            ...(account.interestRateLog || []),
            { date: newEntry.date, rate: parseFloat(newEntry.rate) }
        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        await updateDoc(doc(db, 'bankAccounts', accountId), { interestRateLog: updatedRateLog });
        toast({ title: 'Success', description: 'Interest Rate log updated successfully.' });
        
        // Refresh local state without refetching everything
        setAccounts(prev => prev.map(acc => acc.id === accountId ? {...acc, interestRateLog: updatedRateLog } : acc));
        setNewRateEntries(prev => ({ ...prev, [accountId]: { date: '', rate: '' } }));

    } catch (error) {
        console.error("Error saving new rate entry:", error);
        toast({ title: 'Error', description: 'Failed to save new rate entry.', variant: 'destructive' });
    } finally {
        setIsSaving(prev => ({...prev, [accountId]: false}));
    }
  };
  
  const handleDeleteRate = async (accountId: string, entryToDelete: RateLogEntry) => {
    const account = accounts.find(acc => acc.id === accountId);
    if (!account) return;

    setIsSaving(prev => ({...prev, [accountId]: true}));
    try {
        const updatedRateLog = (account.interestRateLog || []).filter(entry => 
            entry.date !== entryToDelete.date || entry.rate !== entryToDelete.rate
        );

        await updateDoc(doc(db, 'bankAccounts', accountId), { interestRateLog: updatedRateLog });
        toast({ title: 'Success', description: 'Rate entry deleted.' });
        
        setAccounts(prev => prev.map(acc => acc.id === accountId ? {...acc, interestRateLog: updatedRateLog } : acc));
    } catch (error) {
        console.error("Error deleting rate entry:", error);
        toast({ title: 'Error', description: 'Failed to delete rate entry.', variant: 'destructive' });
    } finally {
        setIsSaving(prev => ({...prev, [accountId]: false}));
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const clearLogFilters = () => {
      setDateRange(undefined);
      setBankFilter('all');
  }


  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
       <div className="mb-6 flex justify-between items-center">
            <div className="flex items-center gap-2">
                <Link href="/bank-balance/settings">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Interest Rate Management</h1>
                    <p className="text-muted-foreground">Manage interest rate history and view daily interest logs.</p>
                </div>
            </div>
       </div>
      
       <Tabs defaultValue="manage-rates">
            <TabsList className="mb-4">
                <TabsTrigger value="manage-rates">Manage Rates</TabsTrigger>
                <TabsTrigger value="daily-log">Daily Log</TabsTrigger>
            </TabsList>
            <TabsContent value="manage-rates">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {isLoading ? (
                    Array.from({length: 2}).map((_, i) => <Skeleton key={i} className="h-96" />)
                ) : accounts.length > 0 ? (
                    accounts.map(acc => (
                        <Card key={acc.id}>
                            <CardHeader>
                                <CardTitle>{acc.bankName} ({acc.shortName})</CardTitle>
                                <CardDescription>{acc.accountNumber}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <h4 className="font-semibold mb-2">Interest Rate History</h4>
                                <div className="border rounded-md max-h-60 overflow-y-auto mb-4">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Effective Date</TableHead>
                                                <TableHead>Rate (%)</TableHead>
                                                <TableHead className="text-right">Action</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {acc.interestRateLog.length > 0 ? acc.interestRateLog.map((rate, index) => (
                                                <TableRow key={index}>
                                                    <TableCell>{format(new Date(rate.date), 'dd MMM, yyyy')}</TableCell>
                                                    <TableCell>{rate.rate.toFixed(2)}%</TableCell>
                                                    <TableCell className="text-right">
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteRate(acc.id, rate)}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            )) : (
                                                <TableRow><TableCell colSpan={3} className="text-center h-24">No interest rate history.</TableCell></TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                                
                                <h4 className="font-semibold mb-2 mt-6">Add New Rate Entry</h4>
                                <div className="flex items-end gap-2">
                                    <div className="flex-1 space-y-1">
                                        <label htmlFor={`date-${acc.id}`} className="text-xs text-muted-foreground">Effective Date</label>
                                        <Input 
                                            id={`date-${acc.id}`}
                                            type="date"
                                            value={newRateEntries[acc.id]?.date || ''}
                                            onChange={e => handleNewRateChange(acc.id, 'date', e.target.value)}
                                        />
                                    </div>
                                    <div className="flex-1 space-y-1">
                                        <label htmlFor={`rate-${acc.id}`} className="text-xs text-muted-foreground">Rate (%)</label>
                                        <Input
                                            id={`rate-${acc.id}`}
                                            type="number"
                                            placeholder="e.g., 10.5"
                                            value={newRateEntries[acc.id]?.rate || ''}
                                            onChange={e => handleNewRateChange(acc.id, 'rate', e.target.value)}
                                        />
                                    </div>
                                    <Button onClick={() => handleAddRate(acc.id)} disabled={isSaving[acc.id]}>
                                        {isSaving[acc.id] ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Plus className="mr-2 h-4 w-4"/>}
                                        Add
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                ) : (
                    <Card className="col-span-full">
                        <CardContent className="text-center p-12 text-muted-foreground">
                            No Cash Credit accounts found.
                        </CardContent>
                    </Card>
                )}
                </div>
            </TabsContent>
            <TabsContent value="daily-log">
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
                                {accounts.map(acc => (
                                    <SelectItem key={acc.id} value={acc.id}>{acc.shortName} - {acc.bankName}</SelectItem>
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
                            <TableHead>Closing Utilization</TableHead>
                            <TableHead>Interest Rate (%)</TableHead>
                            <TableHead>Daily Interest</TableHead>
                        </TableRow>
                        </TableHeader>
                        <TableBody>
                        {isLogLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6" /></TableCell></TableRow>
                            ))
                        ) : filteredLogs.length > 0 ? (
                            filteredLogs.map(log => (
                            <TableRow key={log.id}>
                                <TableCell>{format(new Date(log.date), 'dd MMM, yyyy')}</TableCell>
                                <TableCell>{log.accountName}</TableCell>
                                <TableCell>{formatCurrency(log.closingUtilization)}</TableCell>
                                <TableCell>{log.rate.toFixed(2)}%</TableCell>
                                <TableCell>{formatCurrency(log.dailyInterest)}</TableCell>
                            </TableRow>
                            ))
                        ) : (
                            <TableRow><TableCell colSpan={5} className="text-center h-24">No logs found for the selected criteria.</TableCell></TableRow>
                        )}
                        </TableBody>
                    </Table>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    </div>
  );
}
