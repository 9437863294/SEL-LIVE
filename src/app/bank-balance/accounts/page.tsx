
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { BankAccount } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

const initialFormState: Omit<BankAccount, 'id'> = {
  accountName: '',
  accountNumber: '',
  bankName: '',
  accountType: 'Current',
  drawingPower: 0,
  currentBalance: 0,
  status: 'Active',
};

export default function ManageBankAccountsPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<Omit<BankAccount, 'id'>>(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'bankAccounts'));
      const accountsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
      setAccounts(accountsData);
    } catch (error) {
      console.error("Error fetching accounts: ", error);
      toast({ title: 'Error', description: 'Failed to fetch bank accounts.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  const openDialog = (mode: 'add' | 'edit', account?: BankAccount) => {
    setDialogMode(mode);
    if (mode === 'edit' && account) {
        setFormData(account);
        setEditingId(account.id);
    } else {
        setFormData(initialFormState);
        setEditingId(null);
    }
    setIsDialogOpen(true);
  };

  const handleFormChange = (field: keyof typeof formData, value: string | number) => {
    setFormData(prev => ({...prev, [field]: value}));
  }

  const handleSubmit = async () => {
    if (!formData.accountName || !formData.accountNumber || !formData.bankName) {
        toast({ title: 'Validation Error', description: 'Please fill in all required fields.', variant: 'destructive'});
        return;
    }

    try {
        if (dialogMode === 'edit' && editingId) {
            await updateDoc(doc(db, 'bankAccounts', editingId), formData);
            toast({ title: 'Success', description: 'Bank account updated successfully.'});
        } else {
            await addDoc(collection(db, 'bankAccounts'), formData);
            toast({ title: 'Success', description: 'New bank account added.'});
        }
        setIsDialogOpen(false);
        fetchAccounts();
    } catch (error) {
        console.error("Error saving account:", error);
        toast({ title: 'Error', description: 'Failed to save bank account.', variant: 'destructive'});
    }
  };

  const handleDelete = async (id: string) => {
      try {
          await deleteDoc(doc(db, 'bankAccounts', id));
          toast({ title: 'Success', description: 'Account deleted.'});
          fetchAccounts();
      } catch (error) {
          console.error("Error deleting account:", error);
          toast({ title: 'Error', description: 'Failed to delete account.', variant: 'destructive'});
      }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Manage Bank Accounts</h1>
        </div>
        <Button onClick={() => openDialog('add')}>
          <Plus className="mr-2 h-4 w-4" /> Add Account
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Name</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>Account Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Drawing Power</TableHead>
                <TableHead>Current Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({length: 3}).map((_, i) => (
                    <TableRow key={i}>
                        <TableCell colSpan={8}><Skeleton className="h-8" /></TableCell>
                    </TableRow>
                ))
              ) : accounts.map(acc => (
                <TableRow key={acc.id}>
                  <TableCell className="font-medium">{acc.accountName}</TableCell>
                  <TableCell>{acc.bankName}</TableCell>
                  <TableCell>{acc.accountNumber}</TableCell>
                  <TableCell>{acc.accountType}</TableCell>
                  <TableCell>{acc.accountType === 'CC' ? formatCurrency(acc.drawingPower || 0) : 'N/A'}</TableCell>
                  <TableCell>{formatCurrency(acc.currentBalance)}</TableCell>
                  <TableCell>{acc.status}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openDialog('edit', acc)}><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(acc.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
       <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialogMode === 'add' ? 'Add New Account' : 'Edit Account'}</DialogTitle>
              <DialogDescription>Fill in the details of the bank account.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="accountName" className="text-right">Account Name</Label>
                <Input id="accountName" value={formData.accountName} onChange={(e) => handleFormChange('accountName', e.target.value)} className="col-span-3" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="bankName" className="text-right">Bank Name</Label>
                <Input id="bankName" value={formData.bankName} onChange={(e) => handleFormChange('bankName', e.target.value)} className="col-span-3" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="accountNumber" className="text-right">Account Number</Label>
                <Input id="accountNumber" value={formData.accountNumber} onChange={(e) => handleFormChange('accountNumber', e.target.value)} className="col-span-3" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="accountType" className="text-right">Account Type</Label>
                 <Select value={formData.accountType} onValueChange={(v) => handleFormChange('accountType', v)} >
                    <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="Current">Current</SelectItem>
                        <SelectItem value="CC">CC</SelectItem>
                    </SelectContent>
                </Select>
              </div>
               {formData.accountType === 'CC' && (
                 <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="drawingPower" className="text-right">Drawing Power</Label>
                    <Input id="drawingPower" type="number" value={formData.drawingPower} onChange={(e) => handleFormChange('drawingPower', e.target.valueAsNumber || 0)} className="col-span-3" />
                 </div>
               )}
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="currentBalance" className="text-right">Current Balance</Label>
                <Input id="currentBalance" type="number" value={formData.currentBalance} onChange={(e) => handleFormChange('currentBalance', e.target.valueAsNumber || 0)} className="col-span-3" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="status" className="text-right">Status</Label>
                <Select value={formData.status} onValueChange={(v) => handleFormChange('status', v)} >
                    <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="button" onClick={handleSubmit}>Save Account</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

    </div>
  );
}
