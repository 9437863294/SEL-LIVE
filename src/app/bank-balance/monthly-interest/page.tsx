
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
import type { BankAccount, BankExpense } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, startOfMonth, subMonths, eachMonthOfInterval, compareDesc } from 'date-fns';

type MonthlyInterestData = {
  [accountId: string]: {
    projected: number;
    actual: number;
  };
};

export default function MonthlyInterestPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [interestData, setInterestData] = useState<MonthlyInterestData>({});
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);

  const ccAccounts = useMemo(() => accounts.filter(acc => acc.accountType === 'Cash Credit'), [accounts]);

  const fetchBaseData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [accountsSnap, expensesSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses'))
      ]);
      setAccounts(accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount)));
      setAllTransactions(expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense)));
    } catch (error) {
      console.error("Error fetching base data:", error);
      toast({ title: 'Error', description: 'Failed to load accounts and transactions.', variant: 'destructive' });
    }
  }, [toast]);
  
  const calculatedProjectedInterest = useMemo(() => {
    const monthData: Record<string, number> = {};
    ccAccounts.forEach(account => {
        if (!account.openingDate) return;

        let runningBalance = account.openingUtilization || 0;
        const getRateForDate = (date: Date): number => {
            const sortedLog = (account.interestRateLog || []).sort((a,b) => compareDesc(new Date(a.date), new Date(b.date)));
            const rateEntry = sortedLog.find(entry => new Date(entry.date) <= date);
            return rateEntry ? rateEntry.rate : 0;
        }

        const interval = { start: startOfMonth(new Date(account.openingDate)), end: new Date() };
        const days = eachMonthOfInterval(interval).flatMap(monthStart => {
          const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
          const daysInMonth = Array.from({length: monthEnd.getDate()}, (_, i) => new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1));
          return daysInMonth;
        });

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

            const monthKey = format(day, 'yyyy-MM');
            if(monthKey === selectedMonth) {
              if(!monthData[account.id]) monthData[account.id] = 0;
              monthData[account.id] += dailyInterest;
            }

            runningBalance = closingBalance;
        });
    });
    return monthData;
  }, [ccAccounts, allTransactions, selectedMonth]);

  useEffect(() => {
    fetchBaseData();
  }, [fetchBaseData]);
  
  useEffect(() => {
    if (isLoading) return;
    
    const fetchInterestData = async () => {
        const docRef = doc(db, 'monthlyInterest', selectedMonth);
        const docSnap = await getDoc(docRef);
        
        let existingData: MonthlyInterestData = {};
        if (docSnap.exists()) {
            existingData = docSnap.data() as MonthlyInterestData;
        }

        const newInterestData = ccAccounts.reduce((acc, account) => {
            acc[account.id] = {
                projected: existingData[account.id]?.projected ?? calculatedProjectedInterest[account.id] ?? 0,
                actual: existingData[account.id]?.actual ?? 0,
            };
            return acc;
        }, {} as MonthlyInterestData);
        
        setInterestData(newInterestData);
        setIsLoading(false);
    };

    fetchInterestData();

  }, [selectedMonth, accounts, isLoading, calculatedProjectedInterest, ccAccounts]);
  
  const handleInterestChange = (accountId: string, field: 'projected' | 'actual', value: string) => {
      setInterestData(prev => ({
          ...prev,
          [accountId]: {
              ...(prev[accountId] || { projected: 0, actual: 0 }),
              [field]: parseFloat(value) || 0
          }
      }));
  };
  
  const handleSave = async () => {
    setIsSaving(true);
    try {
        const docRef = doc(db, 'monthlyInterest', selectedMonth);
        await setDoc(docRef, interestData, { merge: true });
        toast({ title: "Success", description: "Monthly interest data saved." });
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
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Monthly Interest
        </Button>
      </div>

      <Card>
        <CardHeader>
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
        </CardHeader>
        <CardContent>
            {isLoading ? <Skeleton className="h-48" /> : (
                <div className="space-y-6">
                    <div className="grid grid-cols-3 gap-4 font-semibold text-muted-foreground px-4">
                        <div className="col-span-1">Bank Name</div>
                        <div className="col-span-1">Projected Interest</div>
                        <div className="col-span-1">Actual Interest</div>
                    </div>
                     <div className="divide-y">
                        {ccAccounts.map(account => (
                            <div key={account.id} className="grid grid-cols-3 gap-4 items-center py-3 px-4">
                                <span className="font-medium col-span-1">{account.bankName} ({account.shortName})</span>
                                <div className="col-span-1">
                                    <Input 
                                        type="number" 
                                        value={interestData[account.id]?.projected || ''}
                                        onChange={(e) => handleInterestChange(account.id, 'projected', e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                                 <div className="col-span-1">
                                    <Input 
                                        type="number" 
                                        value={interestData[account.id]?.actual || ''}
                                        onChange={(e) => handleInterestChange(account.id, 'actual', e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        ))}
                     </div>
                </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
