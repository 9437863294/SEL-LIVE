'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import type { BankAccount } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAuthorization } from '@/hooks/useAuthorization';

type FormData = Omit<
  BankAccount,
  'id' | 'currentBalance' | 'drawingPower' | 'interestRateLog' | 'openingBalance' | 'openingUtilization'
> & {
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
  const [formData, setFormData] =
    useState<FormData>(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Permission flags (safe while loading)
  const canView =
    !authLoading && can('View', 'Bank Balance.Accounts');
  const canAdd =
    !authLoading && can('Add', 'Bank Balance.Accounts');
  const canEdit =
    !authLoading && can('Edit', 'Bank Balance.Accounts');
  const canDelete =
    !authLoading && can('Delete', 'Bank Balance.Accounts');

  useEffect(() => {
    if (authLoading) return;

    if (!canView) {
      setIsLoading(false);
      return;
    }

    void fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(
        collection(db, 'bankAccounts')
      );
      const accountsData = querySnapshot.docs.map(
        (d) =>
          ({
            id: d.id,
            ...d.data(),
          } as BankAccount)
      );
      setAccounts(accountsData);
    } catch (error) {
      console.error('Error fetching accounts: ', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch bank accounts.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const openDialog = (
    mode: 'add' | 'edit',
    account?: BankAccount
  ) => {
    setDialogMode(mode);

    if (mode === 'edit' && account) {
      setFormData({
        bankName: account.bankName || '',
        shortName: account.shortName || '',
        accountNumber: account.accountNumber || '',
        accountType:
          account.accountType || 'Current Account',
        status: account.status || 'Active',
        branch: account.branch || '',
        ifsc: account.ifsc || '',
        openingDate:
          account.openingDate || todayISO(),
        openingBalanceOrUtilization:
          account.accountType === 'Cash Credit'
            ? account.openingUtilization || 0
            : account.openingBalance || 0,
      });
      setEditingId(account.id);
    } else {
      setFormData(initialFormState);
      setEditingId(null);
    }

    setIsDialogOpen(true);
  };

  const handleFormChange = (
    field: keyof FormData,
    value: any
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async () => {
    if (!formData.bankName || !formData.accountNumber) {
      toast({
        title: 'Validation Error',
        description:
          'Please fill in Bank Name and Account Number.',
        variant: 'destructive',
      });
      return;
    }

    const {
      openingBalanceOrUtilization,
      ...restOfForm
    } = formData;

    const openingValue =
      Number(openingBalanceOrUtilization) || 0;

    const dataToSave: Partial<BankAccount> = {
      ...restOfForm,
      openingBalance:
        restOfForm.accountType === 'Current Account'
          ? openingValue
          : 0,
      openingUtilization:
        restOfForm.accountType === 'Cash Credit'
          ? openingValue
          : 0,
    };

    try {
      if (dialogMode === 'edit' && editingId) {
        await updateDoc(
          doc(db, 'bankAccounts', editingId),
          dataToSave
        );
        toast({
          title: 'Success',
          description:
            'Bank account updated successfully.',
        });
      } else {
        const fullData: BankAccount = {
          id: '',
          ...dataToSave,
          currentBalance: 0,
          drawingPower: [],
          interestRateLog: [],
        } as BankAccount;

        await addDoc(
          collection(db, 'bankAccounts'),
          fullData
        );
        toast({
          title: 'Success',
          description: 'New bank account added.',
        });
      }

      setIsDialogOpen(false);
      void fetchAccounts();
    } catch (error) {
      console.error('Error saving account:', error);
      toast({
        title: 'Error',
        description: 'Failed to save bank account.',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'bankAccounts', id));
      toast({
        title: 'Success',
        description: 'Account deleted.',
      });
      void fetchAccounts();
    } catch (error) {
      console.error('Error deleting account:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete account.',
        variant: 'destructive',
      });
    }
  };

  // Loading skeleton
  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // No access
  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance/settings">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back"
            >
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">
            Manage Banks
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to view this
              page.
            </CardDescription>
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
      {/* Header */}
      <div className="mb-6 flex items-center gap-2">
        <Link href="/bank-balance/settings">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">
            Manage Banks
          </h1>
          <p className="text-sm text-muted-foreground">
            View, add, edit, or remove bank
            configurations.
          </p>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-end">
            <Button
              onClick={() => openDialog('add')}
              disabled={!canAdd}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Bank
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
                <TableHead className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map(
                  (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-8" />
                      </TableCell>
                    </TableRow>
                  )
                )
              ) : accounts.length > 0 ? (
                accounts.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell className="font-medium">
                      {acc.bankName}
                    </TableCell>
                    <TableCell>
                      {acc.shortName}
                    </TableCell>
                    <TableCell>
                      {acc.accountNumber}
                    </TableCell>
                    <TableCell>
                      {acc.accountType}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          acc.status === 'Active'
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {acc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {acc.branch}
                    </TableCell>
                    <TableCell>
                      {acc.ifsc}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          openDialog('edit', acc)
                        }
                        disabled={!canEdit}
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          handleDelete(acc.id)
                        }
                        disabled={!canDelete}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center h-24"
                  >
                    No banks configured.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'add'
                ? 'Add New Bank'
                : 'Edit Bank'}
            </DialogTitle>
            <DialogDescription>
              Fill in the details of the bank account.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="bankName">
                Bank Name
              </Label>
              <Input
                id="bankName"
                value={formData.bankName}
                onChange={(e) =>
                  handleFormChange(
                    'bankName',
                    e.target.value
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="shortName">
                Short Name
              </Label>
              <Input
                id="shortName"
                value={formData.shortName}
                onChange={(e) =>
                  handleFormChange(
                    'shortName',
                    e.target.value
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountNumber">
                Account Number
              </Label>
              <Input
                id="accountNumber"
                value={
                  formData.accountNumber
                }
                onChange={(e) =>
                  handleFormChange(
                    'accountNumber',
                    e.target.value
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountType">
                Account Type
              </Label>
              <Select
                value={formData.accountType}
                onValueChange={(v) =>
                  handleFormChange(
                    'accountType',
                    v
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Current Account">
                    Current Account
                  </SelectItem>
                  <SelectItem value="Cash Credit">
                    Cash Credit
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch">
                Branch
              </Label>
              <Input
                id="branch"
                value={formData.branch}
                onChange={(e) =>
                  handleFormChange(
                    'branch',
                    e.target.value
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ifsc">
                IFSC
              </Label>
              <Input
                id="ifsc"
                value={formData.ifsc}
                onChange={(e) =>
                  handleFormChange(
                    'ifsc',
                    e.target.value
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="openingDate">
                Opening Date
              </Label>
              <Input
                id="openingDate"
                type="date"
                value={formData.openingDate}
                onChange={(e) =>
                  handleFormChange(
                    'openingDate',
                    e.target.value
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="openingBalanceOrUtilization">
                {formData.accountType ===
                'Cash Credit'
                  ? 'Opening Utilization'
                  : 'Opening Balance'}
              </Label>
              <Input
                id="openingBalanceOrUtilization"
                type="number"
                value={
                  formData.openingBalanceOrUtilization
                }
                onChange={(e) =>
                  handleFormChange(
                    'openingBalanceOrUtilization',
                    e.target.value === ''
                      ? ''
                      : e.target.valueAsNumber
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">
                Status
              </Label>
              <Select
                value={formData.status}
                onValueChange={(v) =>
                  handleFormChange('status', v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">
                    Active
                  </SelectItem>
                  <SelectItem value="Inactive">
                    Inactive
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={handleSubmit}
            >
              Save Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
