'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Save,
  Loader2,
  History,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

type ReceiptItem = {
  id: number;
  description: string;
  amount: number;
};

const createInitialReceiptItem = (): ReceiptItem => ({
  id: Date.now(),
  description: '',
  amount: 0,
});

export default function NewReceiptPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<string>('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([
    createInitialReceiptItem(),
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);

  const canView = can('View', 'Bank Balance.Receipts');
  const canAdd = can('Add', 'Bank Balance.Receipts');

  useEffect(() => {
    const fetchBankAccounts = async () => {
      setIsLoadingAccounts(true);
      try {
        const accountsSnap = await getDocs(collection(db, 'bankAccounts'));
        const accounts = accountsSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as BankAccount)
        );
        setBankAccounts(accounts);
      } catch (error) {
        console.error('Error fetching bank accounts:', error);
        toast({
          title: 'Error',
          description: 'Failed to load bank accounts.',
          variant: 'destructive',
        });
      } finally {
        setIsLoadingAccounts(false);
      }
    };

    if (!authLoading && canView) {
      void fetchBankAccounts();
    } else if (!authLoading && !canView) {
      setIsLoadingAccounts(false);
    }
  }, [authLoading, canView, toast]);

  const totalAmount = receipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);

  const handleReceiptChange = (
    id: number,
    field: keyof ReceiptItem,
    value: any
  ) => {
    setReceipts((prev) =>
      prev.map((rec) => (rec.id === id ? { ...rec, [field]: value } : rec))
    );
  };

  const addReceipt = () => {
    setReceipts((prev) => [...prev, createInitialReceiptItem()]);
  };

  const removeReceipt = (id: number) => {
    setReceipts((prev) => {
      if (prev.length <= 1) {
        return [createInitialReceiptItem()];
      }
      return prev.filter((rec) => rec.id !== id);
    });
  };

  const handleSave = async () => {
    if (!canAdd) {
      toast({
        title: 'Not allowed',
        description: 'You do not have permission to add receipts.',
        variant: 'destructive',
      });
      return;
    }

    if (
      !date ||
      !selectedBank ||
      receipts.length === 0 ||
      receipts.some((r) => !r.description || r.amount <= 0)
    ) {
      toast({
        title: 'Validation Error',
        description:
          'Please fill all required fields (description & amount) for each receipt and select date & bank.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);

    try {
      await runTransaction(db, async (transaction) => {
        for (const receipt of receipts) {
          const receiptData: Omit<BankExpense, 'id'> = {
            date: Timestamp.fromDate(date),
            accountId: selectedBank,
            description: receipt.description,
            amount: receipt.amount,
            type: 'Credit',
            isContra: false,
            createdAt: Timestamp.now(),
          };

          const receiptRef = doc(collection(db, 'bankExpenses'));
          transaction.set(receiptRef, receiptData);
        }
      });

      toast({
        title: 'Success',
        description: `${receipts.length} receipt(s) saved successfully.`,
      });

      setReceipts([createInitialReceiptItem()]);
      setDate(new Date());
      setSelectedBank('');
    } catch (error) {
      console.error('Error saving receipts:', error);
      toast({
        title: 'Save Failed',
        description: 'An error occurred while saving.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount || 0);

  if (authLoading || (isLoadingAccounts && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/bank-balance/receipts">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">New Receipt Entry</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to view this page.
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
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/bank-balance/receipts">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">New Receipt Entry</h1>
        </div>
        <Link href="/bank-balance/receipts">
          <Button variant="outline">
            <History className="mr-2 h-4 w-4" />
            Receipts Log
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Popover
                  open={isDatePickerOpen}
                  onOpenChange={setIsDatePickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-[240px] justify-start text-left font-normal',
                        !date && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date
                        ? format(date, 'PPP')
                        : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={(selectedDate) => {
                        setDate(selectedDate);
                        setIsDatePickerOpen(false);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Select Bank</Label>
                <Select
                  value={selectedBank}
                  onValueChange={setSelectedBank}
                >
                  <SelectTrigger className="w-[280px]">
                    <SelectValue placeholder="Select a bank account" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((acc) => (
                      <SelectItem
                        key={acc.id}
                        value={acc.id}
                      >
                        {acc.shortName} - {acc.bankName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="text-right flex-shrink-0 w-full sm:w-auto mt-4 sm:mt-0">
              <p className="text-muted-foreground">
                Total
              </p>
              <p className="text-2xl font-bold">
                {formatCurrency(totalAmount)}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {receipts.map((receipt, index) => (
              <Collapsible
                key={receipt.id}
                defaultOpen
                className="border p-4 rounded-lg"
              >
                <div className="flex justify-between items-center">
                  <CollapsibleTrigger asChild>
                    <h4 className="text-lg font-semibold cursor-pointer">
                      Receipt #{index + 1}
                    </h4>
                  </CollapsibleTrigger>
                  <div className="flex items-center gap-4">
                    <span className="font-semibold text-lg">
                      {formatCurrency(receipt.amount)}
                    </span>
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() =>
                        removeReceipt(receipt.id)
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CollapsibleContent className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-4">
                  <Textarea
                    placeholder="e.g. Received from Client X"
                    value={receipt.description}
                    onChange={(e) =>
                      handleReceiptChange(
                        receipt.id,
                        'description',
                        e.target.value
                      )
                    }
                    className="md:col-span-3"
                  />
                  <div className="md:col-span-2">
                    <Input
                      type="number"
                      placeholder="Amount"
                      value={receipt.amount || ''}
                      onChange={(e) =>
                        handleReceiptChange(
                          receipt.id,
                          'amount',
                          e.target.valueAsNumber || 0
                        )
                      }
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>

          <div className="flex justify-between items-center">
            <Button
              variant="outline"
              onClick={addReceipt}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Another Receipt
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !canAdd}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Receipts
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
