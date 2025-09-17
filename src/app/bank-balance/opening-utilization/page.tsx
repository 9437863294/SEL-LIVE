
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import type { BankAccount } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function OpeningUtilizationPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [utilizations, setUtilizations] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'bankAccounts'));
      const allAccounts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
      const ccAccounts = allAccounts.filter(acc => acc.accountType === 'Cash Credit');
      setAccounts(ccAccounts);
      
      const initialUtils = ccAccounts.reduce((acc, account) => {
        acc[account.id] = account.openingUtilization || 0;
        return acc;
      }, {} as Record<string, number>);
      setUtilizations(initialUtils);

    } catch (error) {
      console.error("Error fetching accounts: ", error);
      toast({ title: 'Error', description: 'Failed to fetch bank accounts.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  const handleUtilizationChange = (accountId: string, value: string) => {
    setUtilizations(prev => ({
        ...prev,
        [accountId]: parseFloat(value) || 0
    }));
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
        const batch = writeBatch(db);
        accounts.forEach(acc => {
            const accRef = doc(db, 'bankAccounts', acc.id);
            batch.update(accRef, { openingUtilization: utilizations[acc.id] || 0 });
        });
        await batch.commit();
        toast({ title: 'Success', description: 'All opening utilizations have been saved.' });
        fetchAccounts(); // to refresh the view with persisted data
    } catch (error) {
        console.error("Error saving utilizations:", error);
        toast({ title: 'Error', description: 'Failed to save opening utilizations.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };


  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
       <div className="mb-6 flex justify-between items-center">
            <div className="flex items-center gap-2">
                <Link href="/bank-balance/settings">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Opening Utilization</h1>
                    <p className="text-muted-foreground">Manage opening utilization for Cash Credit accounts.</p>
                </div>
            </div>
            <Button onClick={handleSaveAll} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                Save All
            </Button>
       </div>
      
        <Card>
          <CardHeader>
            <CardTitle>Cash Credit Accounts</CardTitle>
            <CardDescription>Enter the opening utilization values for each account.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bank Name</TableHead>
                  <TableHead>Account No.</TableHead>
                  <TableHead className="w-[250px]">Opening Utilization</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({length: 3}).map((_, i) => (
                      <TableRow key={i}>
                          <TableCell><Skeleton className="h-8" /></TableCell>
                          <TableCell><Skeleton className="h-8" /></TableCell>
                          <TableCell><Skeleton className="h-8" /></TableCell>
                      </TableRow>
                  ))
                ) : accounts.length > 0 ? (
                  accounts.map(acc => (
                  <TableRow key={acc.id}>
                    <TableCell className="font-medium">{acc.bankName} ({acc.shortName})</TableCell>
                    <TableCell>{acc.accountNumber}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={utilizations[acc.id] || ''}
                        onChange={(e) => handleUtilizationChange(acc.id, e.target.value)}
                        placeholder="Enter amount"
                      />
                    </TableCell>
                  </TableRow>
                ))) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center h-24">No Cash Credit accounts found.</TableCell>
                  </TableRow>
                )
              }
              </TableBody>
            </Table>
          </CardContent>
        </Card>
    </div>
  );
}
