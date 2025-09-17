

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import type { BankAccount, DpLogEntry } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, subDays } from 'date-fns';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuthorization } from '@/hooks/useAuthorization';


export default function DpManagementPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [newDpEntries, setNewDpEntries] = useState<Record<string, { fromDate: string; amount: string }>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [openAddForm, setOpenAddForm] = useState<string | null>(null);
  
  const canView = can('View', 'Bank Balance.DP Management');
  const canAdd = can('Add', 'Bank Balance.DP Management');
  const canDelete = can('Delete', 'Bank Balance.DP Management');

  useEffect(() => {
    if (authLoading) return;
    if (!canView) {
        setIsLoading(false);
        return;
    }
    fetchAccounts();
  }, [authLoading, canView]);

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
            ? acc.drawingPower.sort((a, b) => new Date(b.fromDate).getTime() - new Date(a.fromDate).getTime()) 
            : [],
        }));
      setAccounts(ccAccounts);
    } catch (error) {
      console.error("Error fetching accounts: ", error);
      toast({ title: 'Error', description: 'Failed to fetch bank accounts.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  const handleNewDpChange = (accountId: string, field: 'fromDate' | 'amount', value: string) => {
    setNewDpEntries(prev => ({
        ...prev,
        [accountId]: {
            ...(prev[accountId] || { fromDate: '', amount: '' }),
            [field]: value
        }
    }));
  };

  const handleAddDp = async (accountId: string) => {
    const newEntry = newDpEntries[accountId];
    if (!newEntry || !newEntry.fromDate || !newEntry.amount) {
        toast({ title: 'Validation Error', description: 'Please provide both a date and an amount.', variant: 'destructive' });
        return;
    }

    let account = accounts.find(acc => acc.id === accountId);
    if (!account) return;
    
    setIsSaving(prev => ({...prev, [accountId]: true}));
    
    const updatedDpLog: DpLogEntry[] = [...(account.drawingPower || [])];
    
    // Find the latest entry to update its toDate
    const latestEntry = updatedDpLog.find(entry => entry.toDate === null);
    if (latestEntry) {
        latestEntry.toDate = format(subDays(new Date(newEntry.fromDate), 1), 'yyyy-MM-dd');
    }
    
    // Add the new entry
    updatedDpLog.push({
        id: crypto.randomUUID(),
        fromDate: newEntry.fromDate,
        toDate: null,
        amount: parseFloat(newEntry.amount)
    });
    
    // Sort again
    updatedDpLog.sort((a, b) => new Date(b.fromDate).getTime() - new Date(a.fromDate).getTime());

    try {
        await updateDoc(doc(db, 'bankAccounts', accountId), { drawingPower: updatedDpLog });
        toast({ title: 'Success', description: 'Drawing Power log updated successfully.' });
        
        // Refresh local state
        setAccounts(prev => prev.map(acc => acc.id === accountId ? {...acc, drawingPower: updatedDpLog } : acc));
        setNewDpEntries(prev => ({ ...prev, [accountId]: { fromDate: '', amount: '' } }));
        setOpenAddForm(null); // Close the form on success

    } catch (error) {
        console.error("Error saving new DP entry:", error);
        toast({ title: 'Error', description: 'Failed to save new DP entry.', variant: 'destructive' });
    } finally {
        setIsSaving(prev => ({...prev, [accountId]: false}));
    }
  };
  
  const handleDeleteDp = async (accountId: string, entryToDelete: DpLogEntry) => {
    let account = accounts.find(acc => acc.id === accountId);
    if (!account) return;

    setIsSaving(prev => ({...prev, [accountId]: true}));
    
    let updatedDpLog = (account.drawingPower || []).filter(entry => entry.id !== entryToDelete.id);
    
    // Find the entry that now becomes the latest and clear its toDate
    if(entryToDelete.toDate === null) { // We are deleting the latest entry
      updatedDpLog.sort((a, b) => new Date(b.fromDate).getTime() - new Date(a.fromDate).getTime());
      if(updatedDpLog.length > 0) {
        updatedDpLog[0].toDate = null;
      }
    }

    try {
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

  if (authLoading || (isLoading && canView)) {
      return (
          <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
              <Skeleton className="h-10 w-64" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Skeleton className="h-96" />
                <Skeleton className="h-96" />
              </div>
          </div>
      )
  }
  
  if (!canView) {
      return (
         <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href="/bank-balance/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                <h1 className="text-xl font-bold">DP Management</h1>
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
       <div className="mb-6 flex justify-between items-center">
            <div className="flex items-center gap-2">
                <Link href="/bank-balance/settings">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
                </Link>
                <div>
                    <h1 className="text-xl font-bold">DP Management</h1>
                    <p className="text-sm text-muted-foreground">Manage Drawing Power history for Cash Credit accounts.</p>
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
                                    <Button variant="outline" disabled={!canAdd}>
                                        <Plus className="mr-2 h-4 w-4"/> Add New DP Entry
                                    </Button>
                                </CollapsibleTrigger>
                            </div>
                        </CardHeader>
                        <CardContent>
                             <CollapsibleContent className="mb-4">
                                 <div className="flex items-end gap-2 p-4 border rounded-lg">
                                     <div className="flex-1 space-y-1">
                                        <label htmlFor={`date-${acc.id}`} className="text-xs text-muted-foreground">Effective From</label>
                                        <Input 
                                            id={`date-${acc.id}`}
                                            type="date"
                                            value={newDpEntries[acc.id]?.fromDate || ''}
                                            onChange={e => handleNewDpChange(acc.id, 'fromDate', e.target.value)}
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
                                            <TableHead>Effective From</TableHead>
                                            <TableHead>Effective To</TableHead>
                                            <TableHead>Amount</TableHead>
                                            <TableHead className="text-right">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {acc.drawingPower.length > 0 ? acc.drawingPower.map((dp) => (
                                            <TableRow key={dp.id}>
                                                <TableCell>{dp.fromDate ? format(new Date(dp.fromDate), 'dd MMM, yyyy') : 'N/A'}</TableCell>
                                                <TableCell>{dp.toDate ? format(new Date(dp.toDate), 'dd MMM, yyyy') : 'Current'}</TableCell>
                                                <TableCell>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(dp.amount)}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteDp(acc.id, dp)} disabled={!canDelete || acc.drawingPower.length <= 1}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        )) : (
                                            <TableRow><TableCell colSpan={4} className="text-center h-24">No DP history.</TableCell></TableRow>
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
