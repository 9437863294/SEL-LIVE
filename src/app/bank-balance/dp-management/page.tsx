

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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

type DpLogEntry = { date: string; amount: number };

export default function DpManagementPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [newDpEntries, setNewDpEntries] = useState<Record<string, { date: string; amount: string }>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [openAddForm, setOpenAddForm] = useState<string | null>(null);

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
          drawingPower: Array.isArray(acc.drawingPower) 
            ? acc.drawingPower.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) 
            : [],
        }));
      setAccounts(ccAccounts);
    } catch (error) {
      console.error("Error fetching accounts: ", error);
      toast({ title: 'Error', description: 'Failed to fetch bank accounts.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  const handleNewDpChange = (accountId: string, field: 'date' | 'amount', value: string) => {
    setNewDpEntries(prev => ({
        ...prev,
        [accountId]: {
            ...(prev[accountId] || { date: '', amount: '' }),
            [field]: value
        }
    }));
  };

  const handleAddDp = async (accountId: string) => {
    const newEntry = newDpEntries[accountId];
    if (!newEntry || !newEntry.date || !newEntry.amount) {
        toast({ title: 'Validation Error', description: 'Please provide both a date and an amount.', variant: 'destructive' });
        return;
    }

    const account = accounts.find(acc => acc.id === accountId);
    if (!account) return;
    
    setIsSaving(prev => ({...prev, [accountId]: true}));
    try {
        const updatedDpLog: DpLogEntry[] = [
            ...(account.drawingPower || []),
            { date: newEntry.date, amount: parseFloat(newEntry.amount) }
        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        await updateDoc(doc(db, 'bankAccounts', accountId), { drawingPower: updatedDpLog });
        toast({ title: 'Success', description: 'Drawing Power log updated successfully.' });
        
        // Refresh local state
        setAccounts(prev => prev.map(acc => acc.id === accountId ? {...acc, drawingPower: updatedDpLog } : acc));
        setNewDpEntries(prev => ({ ...prev, [accountId]: { date: '', amount: '' } }));
        setOpenAddForm(null); // Close the form on success

    } catch (error) {
        console.error("Error saving new DP entry:", error);
        toast({ title: 'Error', description: 'Failed to save new DP entry.', variant: 'destructive' });
    } finally {
        setIsSaving(prev => ({...prev, [accountId]: false}));
    }
  };
  
  const handleDeleteDp = async (accountId: string, entryToDelete: DpLogEntry) => {
    const account = accounts.find(acc => acc.id === accountId);
    if (!account) return;

    setIsSaving(prev => ({...prev, [accountId]: true}));
    try {
        const updatedDpLog = (account.drawingPower || []).filter(entry => 
            entry.date !== entryToDelete.date || entry.amount !== entryToDelete.amount
        );

        await updateDoc(doc(db, 'bankAccounts', accountId), { drawingPower: updatedDpLog });
        toast({ title: 'Success', description: 'DP entry deleted.' });
        
        setAccounts(prev => prev.map(acc => acc.id === accountId ? {...acc, drawingPower: updatedDpLog } : acc));
    } catch (error) {
        console.error("Error deleting DP entry:", error);
        toast({ title: 'Error', description: 'Failed to delete DP entry.', variant: 'destructive' });
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
                    <h1 className="text-2xl font-bold">DP Management</h1>
                    <p className="text-muted-foreground">Manage Drawing Power history for Cash Credit accounts.</p>
                </div>
            </div>
       </div>
      
       <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         {isLoading ? (
            Array.from({length: 2}).map((_, i) => <Skeleton key={i} className="h-96" />)
         ) : accounts.length > 0 ? (
            accounts.map(acc => (
                <Collapsible asChild key={acc.id} open={openAddForm === acc.id} onOpenChange={(isOpen) => setOpenAddForm(isOpen ? acc.id : null)}>
                    <Card>
                        <CardHeader>
                            <div className="flex justify-between items-start">
                                <div>
                                    <CardTitle>{acc.bankName} ({acc.shortName})</CardTitle>
                                    <CardDescription>{acc.accountNumber}</CardDescription>
                                </div>
                                <CollapsibleTrigger asChild>
                                    <Button variant="outline">
                                        <Plus className="mr-2 h-4 w-4"/> Add New DP Entry
                                    </Button>
                                </CollapsibleTrigger>
                            </div>
                        </CardHeader>
                        <CardContent>
                             <CollapsibleContent className="mb-4">
                                 <div className="flex items-end gap-2 p-4 border rounded-lg">
                                     <div className="flex-1 space-y-1">
                                        <label htmlFor={`date-${acc.id}`} className="text-xs text-muted-foreground">Effective Date</label>
                                        <Input 
                                            id={`date-${acc.id}`}
                                            type="date"
                                            value={newDpEntries[acc.id]?.date || ''}
                                            onChange={e => handleNewDpChange(acc.id, 'date', e.target.value)}
                                        />
                                     </div>
                                      <div className="flex-1 space-y-1">
                                        <label htmlFor={`amount-${acc.id}`} className="text-xs text-muted-foreground">Amount</label>
                                        <Input
                                            id={`amount-${acc.id}`}
                                            type="number"
                                            placeholder="Enter new DP amount"
                                            value={newDpEntries[acc.id]?.amount || ''}
                                            onChange={e => handleNewDpChange(acc.id, 'amount', e.target.value)}
                                        />
                                    </div>
                                    <Button onClick={() => handleAddDp(acc.id)} disabled={isSaving[acc.id]}>
                                        {isSaving[acc.id] ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Plus className="mr-2 h-4 w-4"/>}
                                        Add
                                    </Button>
                                </div>
                            </CollapsibleContent>
                            <h4 className="font-semibold mb-2">DP History</h4>
                             <div className="border rounded-md max-h-60 overflow-y-auto">
                                 <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Effective Date</TableHead>
                                            <TableHead>Amount</TableHead>
                                            <TableHead className="text-right">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {acc.drawingPower.length > 0 ? acc.drawingPower.map((dp, index) => (
                                            <TableRow key={index}>
                                                <TableCell>{format(new Date(dp.date), 'dd MMM, yyyy')}</TableCell>
                                                <TableCell>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(dp.amount)}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteDp(acc.id, dp)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        )) : (
                                            <TableRow><TableCell colSpan={3} className="text-center h-24">No DP history.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                             </div>
                        </CardContent>
                    </Card>
                </Collapsible>
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
