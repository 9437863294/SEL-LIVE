
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

export default function DpManagementPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
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
      // Filter for Cash Credit accounts only
      const ccAccounts = allAccounts.filter(acc => acc.accountType === 'Cash Credit');
      setAccounts(ccAccounts);
    } catch (error) {
      console.error("Error fetching accounts: ", error);
      toast({ title: 'Error', description: 'Failed to fetch bank accounts.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const handleDpChange = (id: string, value: string) => {
    const newAmount = parseFloat(value);
    if (isNaN(newAmount)) return;
    setAccounts(prev => 
        prev.map(acc => acc.id === id ? {...acc, drawingPower: newAmount} : acc)
    );
  }

  const handleSave = async () => {
      setIsSaving(true);
      try {
          const batch = writeBatch(db);
          accounts.forEach(account => {
              const docRef = doc(db, 'bankAccounts', account.id);
              batch.update(docRef, { drawingPower: account.drawingPower });
          });
          await batch.commit();
          toast({ title: 'Success', description: 'Drawing Power for all accounts saved.' });
      } catch (error) {
          console.error("Error saving drawing power:", error);
          toast({ title: 'Error', description: 'Failed to save updates.', variant: 'destructive' });
      }
      setIsSaving(false);
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
                    <p className="text-muted-foreground">Manage Drawing Power for Cash Credit accounts.</p>
                </div>
            </div>
            <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                Save All
            </Button>
       </div>
      
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank Name</TableHead>
                <TableHead>Account No.</TableHead>
                <TableHead>Current DP</TableHead>
                <TableHead className="w-48">New DP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({length: 3}).map((_, i) => (
                    <TableRow key={i}>
                        <TableCell colSpan={4}><Skeleton className="h-8" /></TableCell>
                    </TableRow>
                ))
              ) : accounts.length > 0 ? (
                accounts.map(acc => (
                <TableRow key={acc.id}>
                  <TableCell className="font-medium">{acc.bankName} ({acc.shortName})</TableCell>
                  <TableCell>{acc.accountNumber}</TableCell>
                  <TableCell>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(acc.drawingPower || 0)}</TableCell>
                  <TableCell>
                      <Input 
                        type="number" 
                        value={acc.drawingPower || ''} 
                        onChange={(e) => handleDpChange(acc.id, e.target.value)}
                      />
                  </TableCell>
                </TableRow>
              ))) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24">No Cash Credit accounts found.</TableCell>
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
