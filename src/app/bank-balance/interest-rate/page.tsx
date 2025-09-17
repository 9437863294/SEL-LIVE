
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import type { BankAccount } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function InterestRateManagementPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [interestRates, setInterestRates] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchAccountsAndRates = async () => {
      setIsLoading(true);
      try {
        const accountsQuerySnapshot = await getDocs(collection(db, 'bankAccounts'));
        const allAccounts = accountsQuerySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
        const ccAccounts = allAccounts.filter(acc => acc.accountType === 'Cash Credit');
        setAccounts(ccAccounts);
        
        const ratesQuerySnapshot = await getDocs(collection(db, 'interestRates'));
        const ratesData = ratesQuerySnapshot.docs.reduce((acc, doc) => {
            acc[doc.id] = doc.data().rate;
            return acc;
        }, {} as Record<string, number>);
        
        const initialRates = ccAccounts.reduce((acc, account) => {
            acc[account.id] = ratesData[account.id] || 10; // Default to 10%
            return acc;
        }, {} as Record<string, number>);
        setInterestRates(initialRates);

      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Error', description: 'Failed to fetch bank accounts or interest rates.', variant: 'destructive' });
      }
      setIsLoading(false);
    };

    fetchAccountsAndRates();
  }, [toast]);

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
                  {isLoading ? (
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
                        const projectedInterest = calculateProjectedInterest(acc.currentBalance, currentRate);
                        return(
                           <TableRow key={acc.id}>
                            <TableCell className="font-medium">{acc.bankName}</TableCell>
                            <TableCell>{formatCurrency(acc.currentBalance)}</TableCell>
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
          <p>Daily Log coming soon.</p>
        </TabsContent>
        <TabsContent value="monthly-summary">
          <p>Monthly Summary coming soon.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
