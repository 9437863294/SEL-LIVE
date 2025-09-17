
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import type { BankAccount } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

type RateLogEntry = { date: string; rate: number };

export default function InterestRatePage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [newRateEntries, setNewRateEntries] = useState<Record<string, { date: string; rate: string }>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'bankAccounts'));
      const allAccounts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
      const ccAccounts = allAccounts
        .filter(acc => acc.accountType === 'Cash Credit')
        .map(acc => ({
          ...acc,
          interestRateLog: Array.isArray(acc.interestRateLog) 
            ? acc.interestRateLog.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) 
            : [],
        }));
      setAccounts(ccAccounts);
    } catch (error) {
      console.error("Error fetching accounts: ", error);
      toast({ title: 'Error', description: 'Failed to fetch bank accounts.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
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


  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
       <div className="mb-6 flex justify-between items-center">
            <div className="flex items-center gap-2">
                <Link href="/bank-balance/settings">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Interest Rate Management</h1>
                    <p className="text-muted-foreground">Manage interest rate history for Cash Credit accounts.</p>
                </div>
            </div>
       </div>
      
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
    </div>
  );
}
