
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, getDoc } from 'firebase/firestore';
import type { BankAccount, BankExpense, MonthlyInterestData } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, startOfMonth, endOfMonth, subMonths, eachDayOfInterval, compareDesc, parse } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface MonthlyLogEntry {
    month: string;
    accountId: string;
    accountName: string;
    projected: number;
    actual: number;
    difference: number;
}


export default function MonthlyInterestPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [interestData, setInterestData] = useState<MonthlyInterestData>({});
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [isLoading, setIsLoading] = useState(true);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [logData, setLogData] = useState<MonthlyLogEntry[]>([]);

  const ccAccounts = useMemo(() => accounts.filter(acc => acc.accountType === 'Cash Credit'), [accounts]);

  const fetchBaseData = useCallback(async () => {
    setIsLoading(true);
    setIsLogLoading(true);
    try {
      const [accountsSnap, expensesSnap, monthlyInterestSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses')),
        getDocs(collection(db, 'monthlyInterest'))
      ]);
      const fetchedAccounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
      setAccounts(fetchedAccounts.sort((a,b) => a.shortName.localeCompare(b.shortName)));
      setAllTransactions(expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense)));
      
      const accountsMap = new Map(fetchedAccounts.map(acc => [acc.id, acc.shortName]));
      const rawLogData: MonthlyLogEntry[] = [];
      monthlyInterestSnap.forEach(doc => {
          const month = doc.id;
          const data = doc.data() as MonthlyInterestData;
          Object.entries(data).forEach(([accountId, values]) => {
              rawLogData.push({
                  month,
                  accountId,
                  accountName: accountsMap.get(accountId) || 'Unknown',
                  projected: values.projected || 0,
                  actual: values.actual || 0,
                  difference: (values.actual || 0) - (values.projected || 0),
              });
          });
      });

      rawLogData.sort((a,b) => compareDesc(parse(a.month, 'yyyy-MM', new Date()), parse(b.month, 'yyyy-MM', new Date())));
      setLogData(rawLogData);

    } catch (error) {
      console.error("Error fetching base data:", error);
      toast({ title: 'Error', description: 'Failed to load accounts and transactions.', variant: 'destructive' });
    } finally {
        setIsLoading(false);
        setIsLogLoading(false);
    }
  }, [toast]);
  
  const calculatedProjectedInterest = useMemo(() => {
    const monthData: Record<string, number> = {};
    if (ccAccounts.length === 0 || allTransactions.length === 0) return monthData;

    const [year, month] = selectedMonth.split('-').map(Number);
    const selectedMonthStart = startOfMonth(new Date(year, month - 1));
    const selectedMonthEnd = endOfMonth(new Date(year, month - 1));

    ccAccounts.forEach(account => {
        if (!account.openingDate) return;
        
        const openingDate = new Date(account.openingDate);
        if(selectedMonthEnd < openingDate) {
            monthData[account.id] = 0;
            return;
        }

        let runningBalance = account.openingUtilization || 0;
        
        const getRateForDate = (date: Date): number => {
            const sortedLog = (account.interestRateLog || []).sort((a,b) => compareDesc(new Date(a.date), new Date(b.date)));
            const rateEntry = sortedLog.find(entry => new Date(entry.date) <= date);
            return rateEntry ? rateEntry.rate : 0;
        }
        
        const preInterval = { start: openingDate, end: subMonths(selectedMonthStart, 1) };
        if (preInterval.end >= preInterval.start) {
            const preDays = eachDayOfInterval(preInterval);
            preDays.forEach(day => {
                const dayString = format(day, 'yyyy-MM-dd');
                const transactionsToday = allTransactions.filter(t => t.accountId === account.id && format(t.date.toDate(), 'yyyy-MM-dd') === dayString);
                const receipts = transactionsToday.filter(t => t.type === 'Credit' && !t.isContra).reduce((sum, t) => sum + t.amount, 0);
                const expenses = transactionsToday.filter(t => t.type === 'Debit' && !t.isContra).reduce((sum, t) => sum + t.amount, 0);
                const contra = transactionsToday.filter(t => t.isContra).reduce((sum, t) => sum + (t.type === 'Debit' ? -t.amount : t.amount), 0);
                runningBalance += receipts - expenses + contra;
            });
        }
        
        let monthInterest = 0;
        const daysInSelectedMonth = eachDayOfInterval({ start: selectedMonthStart, end: selectedMonthEnd });

        daysInSelectedMonth.forEach(day => {
            if(day < openingDate) return; 
            
            const dayString = format(day, 'yyyy-MM-dd');
            const transactionsToday = allTransactions.filter(t => t.accountId === account.id && format(t.date.toDate(), 'yyyy-MM-dd') === dayString);
            
            const receipts = transactionsToday.filter(t => t.type === 'Credit' && !t.isContra).reduce((sum, t) => sum + t.amount, 0);
            const expenses = transactionsToday.filter(t => t.type === 'Debit' && !t.isContra).reduce((sum, t) => sum + t.amount, 0);
            const contra = transactionsToday.filter(t => t.isContra).reduce((sum, t) => sum + (t.type === 'Debit' ? -t.amount : t.amount), 0);

            const closingBalance = runningBalance + receipts - expenses + contra;
            
            const rate = getRateForDate(day);
            const dailyInterest = (closingBalance * (rate / 100)) / 365;
            
            monthInterest += dailyInterest;
            runningBalance = closingBalance;
        });

        monthData[account.id] = monthInterest;
    });
    return monthData;
  }, [ccAccounts, allTransactions, selectedMonth]);


  useEffect(() => {
    fetchBaseData();
  }, [fetchBaseData]);
  
  useEffect(() => {
    if (isLoading) return;

    const fetchAndSetInterestData = async () => {
        const docRef = doc(db, 'monthlyInterest', selectedMonth);
        const docSnap = await getDoc(docRef);
        
        const existingData = docSnap.exists() ? (docSnap.data() as MonthlyInterestData) : {};

        const newInterestData = ccAccounts.reduce((acc, account) => {
            acc[account.id] = {
                projected: calculatedProjectedInterest[account.id] ?? 0,
                actual: existingData[account.id]?.actual ?? 0,
            };
            return acc;
        }, {} as MonthlyInterestData);
        
        setInterestData(newInterestData);
    };

    fetchAndSetInterestData();

  }, [selectedMonth, ccAccounts, calculatedProjectedInterest, isLoading]);
  
  const handleInterestChange = (accountId: string, value: string) => {
      const numValue = parseFloat(value);
      setInterestData(prev => ({
          ...prev,
          [accountId]: {
              ...prev[accountId],
              actual: isNaN(numValue) ? 0 : numValue
          }
      }));
  };
  
  const handleSave = async () => {
    setIsSaving(true);
    try {
        const docRef = doc(db, 'monthlyInterest', selectedMonth);
        await setDoc(docRef, interestData, { merge: true });
        toast({ title: "Success", description: "Monthly interest data saved." });
        fetchBaseData(); // Refresh log data
    } catch(error) {
        console.error("Error saving data: ", error);
        toast({ title: "Error", description: "Could not save monthly interest data.", variant: "destructive" });
    } finally {
        setIsSaving(false);
    }
  };

  const monthOptions = Array.from({ length: 24 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy'),
    };
  });
  
  const formatCurrency = (amount: number) => {
    if(isNaN(amount)) return '₹ 0.00';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Monthly Interest</h1>
            <p className="text-muted-foreground">Enter projected vs. actual interest for each bank.</p>
          </div>
        </div>
      </div>
      
       <Tabs defaultValue="entry">
        <TabsList className="mb-4">
            <TabsTrigger value="entry">Entry</TabsTrigger>
            <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>
        <TabsContent value="entry">
            <Card>
                <CardHeader>
                   <div className="flex justify-between items-center">
                        <div className="w-full max-w-xs">
                                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select Month" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {monthOptions.map(opt => (
                                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                        </div>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save Monthly Interest
                        </Button>
                   </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? <Skeleton className="h-48" /> : (
                        <div className="space-y-6">
                            <div className="grid grid-cols-4 gap-4 font-semibold text-muted-foreground px-4">
                                <div className="col-span-2">Bank Name</div>
                                <div className="col-span-1">Projected Interest</div>
                                <div className="col-span-1">Actual Interest</div>
                            </div>
                             <div className="divide-y">
                                {ccAccounts.length > 0 ? ccAccounts.map(account => (
                                    <div key={account.id} className="grid grid-cols-4 gap-4 items-center py-3 px-4">
                                        <span className="font-medium col-span-2">{account.bankName} ({account.shortName})</span>
                                        <div className="col-span-1">
                                            <Input 
                                                type="text" 
                                                value={formatCurrency(interestData[account.id]?.projected || 0)}
                                                readOnly
                                                className="font-medium bg-muted"
                                            />
                                        </div>
                                         <div className="col-span-1">
                                            <Input 
                                                type="number" 
                                                value={interestData[account.id]?.actual || ''}
                                                onChange={(e) => handleInterestChange(account.id, e.target.value)}
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                )) : (
                                    <p className="text-center text-muted-foreground py-10">No Cash Credit accounts configured.</p>
                                )}
                             </div>
                              {ccAccounts.length > 0 && (
                                <div className="grid grid-cols-4 gap-4 font-bold text-lg border-t pt-4 px-4">
                                    <span className="col-span-2 text-right">Total</span>
                                    <span className="col-span-1">
                                        {formatCurrency(Object.values(interestData).reduce((sum, d) => sum + (d.projected || 0), 0))}
                                    </span>
                                     <span className="col-span-1">
                                        {formatCurrency(Object.values(interestData).reduce((sum, d) => sum + (d.actual || 0), 0))}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="log">
            <Card>
                <CardHeader>
                    <CardTitle>Monthly Interest Log</CardTitle>
                    <CardDescription>History of all saved monthly interest data.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Month</TableHead>
                                <TableHead>Bank</TableHead>
                                <TableHead>Projected</TableHead>
                                <TableHead>Actual</TableHead>
                                <TableHead>Difference</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLogLoading ? (
                                Array.from({length: 5}).map((_, i) => <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6" /></TableCell></TableRow>)
                            ) : logData.length > 0 ? (
                                logData.map(log => (
                                    <TableRow key={`${log.month}-${log.accountId}`}>
                                        <TableCell>{format(parse(log.month, 'yyyy-MM', new Date()), 'MMMM yyyy')}</TableCell>
                                        <TableCell>{log.accountName}</TableCell>
                                        <TableCell>{formatCurrency(log.projected)}</TableCell>
                                        <TableCell>{formatCurrency(log.actual)}</TableCell>
                                        <TableCell className={log.difference < 0 ? 'text-red-600' : 'text-green-600'}>
                                            {formatCurrency(log.difference)}
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow><TableCell colSpan={5} className="text-center h-24">No log data found.</TableCell></TableRow>
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
