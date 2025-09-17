
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
import { Badge } from '@/components/ui/badge';

const initialFormState: Omit<BankAccount, 'id' | 'currentBalance' | 'drawingPower' | 'openingUtilization' | 'openingDate'> = {
  bankName: '',
  shortName: '',
  accountNumber: '',
  accountType: 'Current Account',
  status: 'Active',
  branch: '',
  ifsc: '',
};

export default function ManageBanksPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<Omit<BankAccount, 'id' | 'currentBalance' | 'drawingPower' | 'openingUtilization' | 'openingDate'>>(initialFormState);
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
        // Ensure all fields are present, providing defaults if not
        const accountData = {
          bankName: account.bankName || '',
          shortName: account.shortName || '',
          accountNumber: account.accountNumber || '',
          accountType: account.accountType || 'Current Account',
          status: account.status || 'Active',
          branch: account.branch || '',
          ifsc: account.ifsc || '',
        };
        setFormData(accountData);
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
    if (!formData.bankName || !formData.accountNumber) {
        toast({ title: 'Validation Error', description: 'Please fill in Bank Name and Account Number.', variant: 'destructive'});
        return;
    }

    try {
        if (dialogMode === 'edit' && editingId) {
            await updateDoc(doc(db, 'bankAccounts', editingId), formData);
            toast({ title: 'Success', description: 'Bank account updated successfully.'});
        } else {
            await addDoc(collection(db, 'bankAccounts'), {...formData, currentBalance: 0, drawingPower: [], openingUtilization: 0, openingDate: ''});
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

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
       <div className="mb-6">
        <div className="flex items-center gap-2">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Manage Banks</h1>
            <p className="text-muted-foreground">View, add, edit, or remove bank configurations.</p>
          </div>
        </div>
      </div>
      
      <Card>
        <CardHeader>
           <div className="flex justify-end">
              <Button onClick={() => openDialog('add')}>
                <Plus className="mr-2 h-4 w-4" /> Add Bank
              </Button>
           </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank Name</TableHead>
                <TableHead>Short Name</TableHead>
                <TableHead>Account No.</TableHead>
                <TableHead>Account Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>IFSC</TableHead>
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
              ) : accounts.length > 0 ? (
                accounts.map(acc => (
                <TableRow key={acc.id}>
                  <TableCell className="font-medium">{acc.bankName}</TableCell>
                  <TableCell>{acc.shortName}</TableCell>
                  <TableCell>{acc.accountNumber}</TableCell>
                  <TableCell>{acc.accountType}</TableCell>
                  <TableCell><Badge variant={acc.status === 'Active' ? 'default' : 'secondary'}>{acc.status}</Badge></TableCell>
                  <TableCell>{acc.branch}</TableCell>
                  <TableCell>{acc.ifsc}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => openDialog('edit', acc)}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(acc.id)} className="ml-2"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                  </TableCell>
                </TableRow>
              ))) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center h-24">No banks configured.</TableCell>
                </TableRow>
              )
            }
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
       <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{dialogMode === 'add' ? 'Add New Bank' : 'Edit Bank'}</DialogTitle>
              <DialogDescription>Fill in the details of the bank account.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
               <div className="space-y-2">
                <Label htmlFor="bankName">Bank Name</Label>
                <Input id="bankName" value={formData.bankName} onChange={(e) => handleFormChange('bankName', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shortName">Short Name</Label>
                <Input id="shortName" value={formData.shortName} onChange={(e) => handleFormChange('shortName', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountNumber">Account Number</Label>
                <Input id="accountNumber" value={formData.accountNumber} onChange={(e) => handleFormChange('accountNumber', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountType">Account Type</Label>
                 <Select value={formData.accountType} onValueChange={(v: 'Current Account' | 'Cash Credit') => handleFormChange('accountType', v)} >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="Current Account">Current Account</SelectItem>
                        <SelectItem value="Cash Credit">Cash Credit</SelectItem>
                    </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch">Branch</Label>
                <Input id="branch" value={formData.branch} onChange={(e) => handleFormChange('branch', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ifsc">IFSC</Label>
                <Input id="ifsc" value={formData.ifsc} onChange={(e) => handleFormChange('ifsc', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={formData.status} onValueChange={(v: 'Active' | 'Inactive') => handleFormChange('status', v)} >
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
