'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2, ShieldAlert, Building2, CreditCard, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { BankAccount } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';

type FormData = Omit<BankAccount, 'id' | 'currentBalance' | 'drawingPower' | 'interestRateLog' | 'openingBalance' | 'openingUtilization'> & {
  openingBalanceOrUtilization: number | '';
};

const todayISO = () => new Date().toISOString().split('T')[0];

const initialFormState: FormData = {
  bankName: '',
  shortName: '',
  accountNumber: '',
  accountType: 'Current Account',
  status: 'Active',
  branch: '',
  ifsc: '',
  openingBalanceOrUtilization: '',
  openingDate: todayISO(),
};

export default function ManageBanksPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<FormData>(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canView   = !authLoading && can('View',   'Bank Balance.Accounts');
  const canAdd    = !authLoading && can('Add',    'Bank Balance.Accounts');
  const canEdit   = !authLoading && can('Edit',   'Bank Balance.Accounts');
  const canDelete = !authLoading && can('Delete', 'Bank Balance.Accounts');

  useEffect(() => {
    if (authLoading) return;
    if (!canView) { setIsLoading(false); return; }
    void fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'bankAccounts'));
      setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount)));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch bank accounts.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const openDialog = (mode: 'add' | 'edit', account?: BankAccount) => {
    setDialogMode(mode);
    if (mode === 'edit' && account) {
      setFormData({
        bankName: account.bankName || '',
        shortName: account.shortName || '',
        accountNumber: account.accountNumber || '',
        accountType: account.accountType || 'Current Account',
        status: account.status || 'Active',
        branch: account.branch || '',
        ifsc: account.ifsc || '',
        openingDate: account.openingDate || todayISO(),
        openingBalanceOrUtilization:
          account.accountType === 'Cash Credit' ? account.openingUtilization || 0 : account.openingBalance || 0,
      });
      setEditingId(account.id);
    } else {
      setFormData(initialFormState);
      setEditingId(null);
    }
    setIsDialogOpen(true);
  };

  const handleFormChange = (field: keyof FormData, value: unknown) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.bankName || !formData.accountNumber) {
      toast({ title: 'Validation Error', description: 'Bank Name and Account Number are required.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    const { openingBalanceOrUtilization, ...rest } = formData;
    const openingValue = Number(openingBalanceOrUtilization) || 0;
    const dataToSave: Partial<BankAccount> = {
      ...rest,
      openingBalance: rest.accountType === 'Current Account' ? openingValue : 0,
      openingUtilization: rest.accountType === 'Cash Credit' ? openingValue : 0,
    };
    try {
      if (dialogMode === 'edit' && editingId) {
        await updateDoc(doc(db, 'bankAccounts', editingId), dataToSave);
        toast({ title: 'Success', description: 'Bank account updated.' });
      } else {
        await addDoc(collection(db, 'bankAccounts'), { ...dataToSave, currentBalance: 0, drawingPower: [], interestRateLog: [] });
        toast({ title: 'Success', description: 'New bank account added.' });
      }
      setIsDialogOpen(false);
      void fetchAccounts();
    } catch {
      toast({ title: 'Error', description: 'Failed to save bank account.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'bankAccounts', id));
      toast({ title: 'Success', description: 'Account deleted.' });
      void fetchAccounts();
    } catch {
      toast({ title: 'Error', description: 'Failed to delete account.', variant: 'destructive' });
    }
  };

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <h1 className="text-xl font-bold">Manage Banks</h1>
        </div>
        <Card>
          <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  const activeCount = accounts.filter(a => a.status === 'Active').length;
  const ccCount = accounts.filter(a => a.accountType === 'Cash Credit').length;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Manage Banks</h1>
            <p className="text-xs text-muted-foreground">
              {accounts.length} accounts &nbsp;·&nbsp; {activeCount} active &nbsp;·&nbsp; {ccCount} CC
            </p>
          </div>
        </div>
        <Button onClick={() => openDialog('add')} disabled={!canAdd} className="rounded-full shadow-md shadow-primary/20">
          <Plus className="mr-2 h-4 w-4" />
          Add Bank
        </Button>
      </div>

      <Card className="rounded-xl border-border/60 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="font-semibold">Bank Name</TableHead>
                  <TableHead className="font-semibold">Short Name</TableHead>
                  <TableHead className="font-semibold">Account No.</TableHead>
                  <TableHead className="font-semibold">Type</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Branch</TableHead>
                  <TableHead className="font-semibold">IFSC</TableHead>
                  <TableHead className="text-right font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}><Skeleton className="h-8 rounded-lg" /></TableCell>
                    </TableRow>
                  ))
                  : accounts.length > 0
                    ? accounts.map(acc => (
                      <TableRow key={acc.id} className="hover:bg-muted/20 transition-colors">
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {acc.accountType === 'Cash Credit'
                              ? <CreditCard className="h-4 w-4 text-violet-500 shrink-0" />
                              : <Building2 className="h-4 w-4 text-sky-500 shrink-0" />
                            }
                            {acc.bankName}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{acc.shortName}</TableCell>
                        <TableCell className="font-mono text-sm">{acc.accountNumber}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(
                            'text-xs',
                            acc.accountType === 'Cash Credit'
                              ? 'border-violet-200 text-violet-700 bg-violet-50 dark:bg-violet-950/20'
                              : 'border-sky-200 text-sky-700 bg-sky-50 dark:bg-sky-950/20',
                          )}>
                            {acc.accountType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {acc.status === 'Active'
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                              : <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            }
                            <span className={cn('text-sm', acc.status === 'Active' ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>
                              {acc.status}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{acc.branch}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{acc.ifsc}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openDialog('edit', acc)} disabled={!canEdit} className="h-8 px-3 rounded-lg hover:bg-primary/10">
                              <Edit className="mr-1.5 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" disabled={!canDelete} className="h-8 px-3 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive">
                                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                  Delete
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Bank Account</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete <strong>{acc.bankName}</strong>? This cannot be undone and may affect related transactions.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => void handleDelete(acc.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                    : (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center h-32 text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <Building2 className="h-8 w-8 opacity-30" />
                            <p>No banks configured. Add one to get started.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                }
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg">{dialogMode === 'add' ? 'Add New Bank Account' : 'Edit Bank Account'}</DialogTitle>
            <DialogDescription>Fill in the details for the bank account.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            {[
              { id: 'bankName', label: 'Bank Name', type: 'text', field: 'bankName' as keyof FormData },
              { id: 'shortName', label: 'Short Name', type: 'text', field: 'shortName' as keyof FormData },
              { id: 'accountNumber', label: 'Account Number', type: 'text', field: 'accountNumber' as keyof FormData },
              { id: 'branch', label: 'Branch', type: 'text', field: 'branch' as keyof FormData },
              { id: 'ifsc', label: 'IFSC Code', type: 'text', field: 'ifsc' as keyof FormData },
              { id: 'openingDate', label: 'Opening Date', type: 'date', field: 'openingDate' as keyof FormData },
            ].map(({ id, label, type, field }) => (
              <div key={id} className="space-y-1.5">
                <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
                <Input
                  id={id}
                  type={type}
                  value={formData[field] as string}
                  onChange={e => handleFormChange(field, e.target.value)}
                  className="rounded-lg"
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Account Type</Label>
              <Select value={formData.accountType} onValueChange={v => handleFormChange('accountType', v)}>
                <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Current Account">Current Account</SelectItem>
                  <SelectItem value="Cash Credit">Cash Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="openingAmt" className="text-sm font-medium">
                {formData.accountType === 'Cash Credit' ? 'Opening Utilization (₹)' : 'Opening Balance (₹)'}
              </Label>
              <Input
                id="openingAmt"
                type="number"
                value={formData.openingBalanceOrUtilization}
                onChange={e => handleFormChange('openingBalanceOrUtilization', e.target.value === '' ? '' : e.target.valueAsNumber)}
                className="rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Status</Label>
              <Select value={formData.status} onValueChange={v => handleFormChange('status', v)}>
                <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="rounded-xl">Cancel</Button>
            </DialogClose>
            <Button onClick={() => void handleSubmit()} disabled={isSaving} className="rounded-xl shadow-md shadow-primary/20">
              {isSaving ? 'Saving…' : 'Save Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
