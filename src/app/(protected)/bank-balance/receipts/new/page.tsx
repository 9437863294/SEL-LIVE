'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Save,
  Loader2,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent } from '@/components/ui/card';
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
import { useAuthorization } from '@/hooks/useAuthorization';
import { formatInr } from '@/lib/bank-balance-ledger';
import {
  BANK_PAGE,
  BankAccessDenied,
  BankBalanceBackground,
  BankPageSkeleton,
} from '@/components/bank-balance/page-kit';

type ReceiptItem = {
  id: string;
  description: string;
  amount: number;
};

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createInitialReceiptItem = (): ReceiptItem => ({
  id: makeId(),
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
  const [receipts, setReceipts] = useState<ReceiptItem[]>(() => [
    createInitialReceiptItem(),
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);

  // A form that writes receipts is gated on Add, not View.
  const canAdd = !authLoading && can('Add', 'Bank Balance.Receipts');
  const activeBankAccounts = bankAccounts.filter(
    (account) => account.status === 'Active'
  );

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

    if (authLoading) return;
    if (canAdd) {
      void fetchBankAccounts();
    } else {
      setIsLoadingAccounts(false);
    }
  }, [authLoading, canAdd, toast]);

  const totalAmount = receipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);

  const handleReceiptChange = (
    id: string,
    field: keyof ReceiptItem,
    value: ReceiptItem[keyof ReceiptItem]
  ) => {
    setReceipts((prev) =>
      prev.map((rec) => (rec.id === id ? { ...rec, [field]: value } : rec))
    );
  };

  const addReceipt = () => {
    setReceipts((prev) => [...prev, createInitialReceiptItem()]);
  };

  const removeReceipt = (id: string) => {
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
        description: `${receipts.length} receipt(s) totalling ${formatInr(totalAmount)} saved successfully.`,
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

  if (authLoading || (isLoadingAccounts && canAdd)) {
    return <BankPageSkeleton kpis={0} />;
  }

  if (!canAdd) {
    return (
      <BankAccessDenied
        title="New Receipt Entry"
        backHref="/bank-balance/receipts"
        backLabel="Back to receipts"
        what="the receipt entry form"
      />
    );
  }

  return (
    <>
      <BankBalanceBackground tone="green" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="New Receipt Entry"
          description="Record a new receipt transaction"
          backHref="/bank-balance/receipts"
          backLabel="Back to receipts"
          actions={
            <Button asChild variant="outline">
              <Link href="/bank-balance/receipts">
                <History className="mr-2 h-4 w-4" />
                Receipts
              </Link>
            </Button>
          }
        />

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="receipt-date">Date</Label>
                  <Popover
                    open={isDatePickerOpen}
                    onOpenChange={setIsDatePickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        id="receipt-date"
                        variant="outline"
                        className={cn(
                          'w-full justify-start text-left font-normal sm:w-60',
                          !date && 'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date ? format(date, 'PPP') : 'Pick a date'}
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
                  <Label htmlFor="receipt-bank">Select Bank</Label>
                  <Select value={selectedBank} onValueChange={setSelectedBank}>
                    <SelectTrigger id="receipt-bank" className="w-full sm:w-[280px]">
                      <SelectValue placeholder="Select a bank account" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeBankAccounts.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.shortName} - {acc.bankName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="w-full flex-shrink-0 text-left sm:w-auto sm:text-right">
                <p className="text-muted-foreground">Total</p>
                <p className="text-2xl font-bold tabular-nums">{formatInr(totalAmount)}</p>
              </div>
            </div>

            <div className="space-y-4">
              {receipts.map((receipt, index) => (
                <Collapsible
                  key={receipt.id}
                  defaultOpen
                  className="rounded-lg border p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <CollapsibleTrigger asChild>
                      <h4 className="min-w-0 cursor-pointer text-lg font-semibold">
                        Receipt #{index + 1}
                      </h4>
                    </CollapsibleTrigger>
                    <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                      <span className="text-lg font-semibold tabular-nums">
                        {formatInr(receipt.amount)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label={`Remove receipt #${index + 1}`}
                        onClick={() => removeReceipt(receipt.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <CollapsibleContent className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-5">
                    <div className="space-y-2 md:col-span-3">
                      <Label htmlFor={`receipt-description-${receipt.id}`}>
                        Description <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        id={`receipt-description-${receipt.id}`}
                        placeholder="e.g. Received from Client X"
                        value={receipt.description}
                        onChange={(e) =>
                          handleReceiptChange(receipt.id, 'description', e.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor={`receipt-amount-${receipt.id}`}>
                        Amount <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id={`receipt-amount-${receipt.id}`}
                        type="number"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={receipt.amount || ''}
                        onChange={(e) =>
                          handleReceiptChange(receipt.id, 'amount', e.target.valueAsNumber || 0)
                        }
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="outline" onClick={addReceipt}>
                <Plus className="mr-2 h-4 w-4" />
                Add Another Receipt
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || !canAdd || activeBankAccounts.length === 0}
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
    </>
  );
}
