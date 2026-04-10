'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Upload,
  Save,
  Loader2,
  ChevronUp,
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, startOfDay } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  runTransaction,
  Timestamp,
  getDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { BankAccount, BankExpense } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';

type ExpenseItem = {
  id: number;
  description: string;
  paymentRequestRefNo: string;
  utrNumber: string;
  amount: number;
  paymentMethod: string;
  paymentRefNo: string;
  approvalCopy: File | null;
  bankTransferCopy: File | null;
};

interface PaymentSettings {
  mandatoryFields: {
    paymentRequestRefNo: boolean;
    utrNumber: boolean;
    paymentMethod: boolean;
    paymentRefNo: boolean;
    approvalCopy: boolean;
    bankTransferCopy: boolean;
  };
  paymentMethods: { id: string; name: string }[];
}

const createExpenseItem = (): ExpenseItem => ({
  id: Date.now() + Math.floor(Math.random() * 100000),
  description: '',
  paymentRequestRefNo: '',
  utrNumber: '',
  amount: 0,
  paymentMethod: '',
  paymentRefNo: '',
  approvalCopy: null,
  bankTransferCopy: null,
});

export default function NewPaymentPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const [selectedBank, setSelectedBank] = useState('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);

  const [expenses, setExpenses] = useState<ExpenseItem[]>([createExpenseItem()]);
  const [openCollapsibleId, setOpenCollapsibleId] = useState<number | null>(
    expenses[0]?.id ?? null
  );

  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(
    null
  );
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const canAdd = !authLoading && can('Add', 'Bank Balance.Expenses');
  const activeBankAccounts = useMemo(
    () => bankAccounts.filter((account) => account.status === 'Active'),
    [bankAccounts]
  );

  const fetchBankAccountsAndSettings = useCallback(async () => {
    setIsSettingsLoading(true);
    try {
      const [accountsSnap, settingsDocSnap, methodsSnap, transactionsSnap] =
        await Promise.all([
          getDocs(collection(db, 'bankAccounts')),
          getDoc(doc(db, 'bankBalanceSettings', 'paymentEntry')),
          getDocs(collection(db, 'paymentMethods')),
          getDocs(collection(db, 'bankExpenses')),
        ]);

      const accounts = accountsSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as BankAccount)
      );
      setBankAccounts(accounts);

      const mandatoryFields =
        settingsDocSnap.exists() && settingsDocSnap.data().mandatoryFields
          ? settingsDocSnap.data().mandatoryFields
          : {
              paymentRequestRefNo: false,
              utrNumber: false,
              paymentMethod: false,
              paymentRefNo: false,
              approvalCopy: false,
              bankTransferCopy: false,
            };

      const paymentMethods = methodsSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().name as string,
      }));

      setPaymentSettings({ mandatoryFields, paymentMethods });

      const allTx = transactionsSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as BankExpense)
      );
      setAllTransactions(allTx);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load bank/payment settings.',
        variant: 'destructive',
      });
    } finally {
      setIsSettingsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (authLoading) return;
    if (!canAdd) {
      setIsSettingsLoading(false);
      return;
    }
    void fetchBankAccountsAndSettings();
  }, [authLoading, canAdd, fetchBankAccountsAndSettings]);

  const totalAmount = useMemo(
    () => expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0),
    [expenses]
  );

  const getLatestDp = (account: BankAccount, onDate: Date): number => {
    return getApplicableCcLimit(account, onDate);
  };

  const availableBalance = useMemo(() => {
    if (!selectedBank || !date) return 0;
    const account = bankAccounts.find((acc) => acc.id === selectedBank);
    if (!account) return 0;

    let balance =
      account.accountType === 'Cash Credit'
        ? account.openingUtilization || 0
        : account.openingBalance || 0;

    if (account.openingDate) {
      const openingDate = startOfDay(new Date(account.openingDate));
      const cutoff = startOfDay(date);

      const historicalTransactions = allTransactions
        .filter(
          (t) =>
            t.accountId === selectedBank &&
            t.date.toDate() >= openingDate &&
            t.date.toDate() < cutoff
        )
        .sort(
          (a, b) => a.date.toMillis() - b.date.toMillis()
        );

      historicalTransactions.forEach((t) => {
        const amount = t.amount;
        if (account.accountType === 'Cash Credit') {
          // Debit = more utilization, Credit = less utilization
          balance += t.type === 'Debit' ? amount : -amount;
        } else {
          // Current: Credit increases, Debit decreases
          balance += t.type === 'Credit' ? amount : -amount;
        }
      });
    }

    if (account.accountType === 'Cash Credit') {
      const currentDp = getLatestDp(account, date);
      return currentDp - balance; // available sanctioned limit
    }

    return balance;
  }, [selectedBank, bankAccounts, allTransactions, date]);

  const handleExpenseChange = (
    id: number,
    field: keyof ExpenseItem,
    value: any
  ) => {
    setExpenses((prev) =>
      prev.map((exp) =>
        exp.id === id ? { ...exp, [field]: value } : exp
      )
    );
  };

  const addExpense = () => {
    const newItem = createExpenseItem();
    setExpenses((prev) => [...prev, newItem]);
    setOpenCollapsibleId(newItem.id);
  };

  const removeExpense = (id: number) => {
    setExpenses((prev) => {
      const updated = prev.filter((exp) => exp.id !== id);
      if (updated.length === 0) {
        const fresh = createExpenseItem();
        setOpenCollapsibleId(fresh.id);
        return [fresh];
      }
      if (openCollapsibleId === id) {
        setOpenCollapsibleId(updated[0]?.id ?? null);
      }
      return updated;
    });
  };

  const handleFileChange = (
    id: number,
    field: 'approvalCopy' | 'bankTransferCopy',
    file: File | null
  ) => {
    setExpenses((prev) =>
      prev.map((exp) =>
        exp.id === id ? { ...exp, [field]: file } : exp
      )
    );
  };

  const handleSave = async () => {
    if (!canAdd) {
      toast({
        title: 'Not allowed',
        description: 'You do not have permission to add payments.',
        variant: 'destructive',
      });
      return;
    }

    if (!date || !selectedBank) {
      toast({
        title: 'Validation Error',
        description: 'Please select a date and a bank account.',
        variant: 'destructive',
      });
      return;
    }

    const mandatory = paymentSettings?.mandatoryFields;

    for (const [idx, expense] of expenses.entries()) {
      const line = idx + 1;
      if (!expense.description || expense.amount <= 0) {
        toast({
          title: 'Validation Error',
          description: `Please fill Description and a positive Amount for Payment #${line}.`,
          variant: 'destructive',
        });
        return;
      }
      if (mandatory) {
        if (mandatory.paymentRequestRefNo && !expense.paymentRequestRefNo) {
          toast({
            title: 'Validation Error',
            description: `Payment Request Ref No. is required for Payment #${line}.`,
            variant: 'destructive',
          });
          return;
        }
        if (mandatory.utrNumber && !expense.utrNumber) {
          toast({
            title: 'Validation Error',
            description: `UTR Number is required for Payment #${line}.`,
            variant: 'destructive',
          });
          return;
        }
        if (mandatory.paymentMethod && !expense.paymentMethod) {
          toast({
            title: 'Validation Error',
            description: `Payment Method is required for Payment #${line}.`,
            variant: 'destructive',
          });
          return;
        }
        if (mandatory.paymentRefNo && !expense.paymentRefNo) {
          toast({
            title: 'Validation Error',
            description: `Payment Ref No. is required for Payment #${line}.`,
            variant: 'destructive',
          });
          return;
        }
        if (mandatory.approvalCopy && !expense.approvalCopy) {
          toast({
            title: 'Validation Error',
            description: `Approval Copy is required for Payment #${line}.`,
            variant: 'destructive',
          });
          return;
        }
        if (mandatory.bankTransferCopy && !expense.bankTransferCopy) {
          toast({
            title: 'Validation Error',
            description: `Bank Transfer Copy is required for Payment #${line}.`,
            variant: 'destructive',
          });
          return;
        }
      }
    }

    if (totalAmount > availableBalance) {
      toast({
        title: 'Insufficient Funds',
        description: `Total payment amount (${formatCurrency(
          totalAmount
        )}) exceeds the available balance / limit (${formatCurrency(
          availableBalance
        )}).`,
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);

    try {
      // 1) Upload files first (outside transaction)
      const prepared = await Promise.all(
        expenses.map(async (expense) => {
          let approvalCopyUrl = '';
          let bankTransferCopyUrl = '';

          if (expense.approvalCopy) {
            const approvalRef = ref(
              storage,
              `expenses/${date.toISOString()}/${expense.id}-approval-${expense.approvalCopy.name}`
            );
            await uploadBytes(approvalRef, expense.approvalCopy);
            approvalCopyUrl = await getDownloadURL(approvalRef);
          }

          if (expense.bankTransferCopy) {
            const transferRef = ref(
              storage,
              `expenses/${date.toISOString()}/${expense.id}-transfer-${expense.bankTransferCopy.name}`
            );
            await uploadBytes(transferRef, expense.bankTransferCopy);
            bankTransferCopyUrl = await getDownloadURL(transferRef);
          }

          return {
            expense,
            approvalCopyUrl,
            bankTransferCopyUrl,
          };
        })
      );

      // 2) Write all docs in a single transaction
      await runTransaction(db, async (transaction) => {
        prepared.forEach(({ expense, approvalCopyUrl, bankTransferCopyUrl }) => {
          const expenseRef = doc(collection(db, 'bankExpenses'));
          const expenseData: Omit<BankExpense, 'id'> = {
            date: Timestamp.fromDate(date),
            accountId: selectedBank,
            description: expense.description,
            amount: expense.amount,
            type: 'Debit',
            isContra: false,
            paymentRequestRefNo: expense.paymentRequestRefNo || '',
            utrNumber: expense.utrNumber || '',
            paymentMethod: expense.paymentMethod || '',
            paymentRefNo: expense.paymentRefNo || '',
            approvalCopyUrl,
            bankTransferCopyUrl,
            createdAt: Timestamp.now(),
          };
          transaction.set(expenseRef, expenseData);
        });
      });

      toast({
        title: 'Success',
        description: `${expenses.length} payment${
          expenses.length > 1 ? 's' : ''
        } saved successfully.`,
      });

      const fresh = createExpenseItem();
      setExpenses([fresh]);
      setOpenCollapsibleId(fresh.id);
      setDate(new Date());
      setSelectedBank('');
      void fetchBankAccountsAndSettings();
    } catch (error) {
      console.error('Error saving expenses:', error);
      toast({
        title: 'Save Failed',
        description: 'An error occurred while saving payments.',
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

  // Loading / permission states
  if (authLoading || (isSettingsLoading && canAdd)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canAdd) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance/expenses">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">New Payment Entry</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to add new payments.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main UI
  return (
    <>
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-red-50/60 via-background to-rose-50/40 dark:from-red-950/20 dark:via-background dark:to-rose-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-red-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-rose-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(239,68,68,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>
    <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/bank-balance/expenses">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-red-50 dark:hover:bg-red-950/30">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">New Payment Entry</h1>
            <p className="text-xs text-muted-foreground">Record a new payment transaction</p>
          </div>
        </div>
        <Link href="/bank-balance/expenses">
          <Button variant="outline" className="rounded-full border-border/60">
            <History className="mr-2 h-4 w-4" />
            Payments Log
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          {/* Top controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-4">
              {/* Date */}
              <div className="space-y-2">
                <Label htmlFor="payment-date">Date</Label>
                <Popover
                  open={isDatePickerOpen}
                  onOpenChange={setIsDatePickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      id="payment-date"
                      variant="outline"
                      className={cn(
                        'w-[240px] justify-start text-left font-normal',
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
                        setDate(selectedDate || undefined);
                        setIsDatePickerOpen(false);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Bank select */}
              <div className="space-y-2">
                <Label htmlFor="bank-select">Select Bank</Label>
                <Select
                  value={selectedBank}
                  onValueChange={setSelectedBank}
                >
                  <SelectTrigger
                    id="bank-select"
                    className="w-[280px]"
                  >
                    <SelectValue placeholder="Select a bank account" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBankAccounts.map((acc) => (
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

              {/* Available balance */}
              {selectedBank && (
                <div className="space-y-2">
                  <Label>Available Balance</Label>
                  <p className="font-bold text-lg">
                    {formatCurrency(availableBalance)}
                  </p>
                </div>
              )}
            </div>

            {/* Total */}
            <div className="text-right flex-shrink-0 w-full sm:w-auto mt-4 sm:mt-0">
              <p className="text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">
                {formatCurrency(totalAmount)}
              </p>
            </div>
          </div>

          {/* Payment Items */}
          <div className="space-y-4">
            {isSettingsLoading ? (
              <Skeleton className="h-64" />
            ) : (
              expenses.map((expense, index) => (
                <Collapsible
                  key={expense.id}
                  open={openCollapsibleId === expense.id}
                  onOpenChange={(isOpen) =>
                    setOpenCollapsibleId(isOpen ? expense.id : null)
                  }
                  className="border p-4 rounded-lg"
                >
                  <div className="flex justify-between items-center">
                    <CollapsibleTrigger
                      asChild
                      className="flex-grow cursor-pointer"
                    >
                      <div className="flex flex-col w-full">
                        <div className="flex justify-between items-center w-full">
                          <h4 className="text-lg font-semibold">
                            Payment #{index + 1}
                          </h4>
                          <div className="flex items-center gap-4">
                            <span className="font-semibold text-lg">
                              {formatCurrency(expense.amount)}
                            </span>
                            <ChevronUp
                              className={cn(
                                'h-5 w-5 transition-transform',
                                openCollapsibleId === expense.id &&
                                  'rotate-180'
                              )}
                            />
                          </div>
                        </div>
                        {openCollapsibleId !== expense.id && (
                          <div className="mt-2 text-sm text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                            <span>
                              <span className="font-medium">
                                P.R. Ref:
                              </span>{' '}
                              {expense.paymentRequestRefNo || 'N/A'}
                            </span>
                            <span>
                              <span className="font-medium">
                                UTR No:
                              </span>{' '}
                              {expense.utrNumber || 'N/A'}
                            </span>
                            <span>
                              <span className="font-medium">
                                Method:
                              </span>{' '}
                              {expense.paymentMethod || 'N/A'}
                            </span>
                            <span>
                              <span className="font-medium">
                                Pmt. Ref:
                              </span>{' '}
                              {expense.paymentRefNo || 'N/A'}
                            </span>
                          </div>
                        )}
                      </div>
                    </CollapsibleTrigger>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 ml-2 flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeExpense(expense.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <CollapsibleContent className="mt-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>
                          Payment Request Ref No.
                          {paymentSettings?.mandatoryFields
                            .paymentRequestRefNo && (
                            <span className="text-destructive">
                              *
                            </span>
                          )}
                        </Label>
                        <Input
                          placeholder="Enter Ref No."
                          value={expense.paymentRequestRefNo}
                          onChange={(e) =>
                            handleExpenseChange(
                              expense.id,
                              'paymentRequestRefNo',
                              e.target.value
                            )
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>
                          UTR Number
                          {paymentSettings?.mandatoryFields
                            .utrNumber && (
                            <span className="text-destructive">
                              *
                            </span>
                          )}
                        </Label>
                        <Input
                          placeholder="Enter UTR No."
                          value={expense.utrNumber}
                          onChange={(e) =>
                            handleExpenseChange(
                              expense.id,
                              'utrNumber',
                              e.target.value
                            )
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>
                          Amount{' '}
                          <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={
                            Number.isNaN(expense.amount)
                              ? ''
                              : expense.amount
                          }
                          onChange={(e) =>
                            handleExpenseChange(
                              expense.id,
                              'amount',
                              e.target.valueAsNumber || 0
                            )
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                      <div className="space-y-2">
                        <Label>
                          Payment Method
                          {paymentSettings?.mandatoryFields
                            .paymentMethod && (
                            <span className="text-destructive">
                              *
                            </span>
                          )}
                        </Label>
                        <Select
                          value={expense.paymentMethod}
                          onValueChange={(val) =>
                            handleExpenseChange(
                              expense.id,
                              'paymentMethod',
                              val
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select method" />
                          </SelectTrigger>
                          <SelectContent>
                            {paymentSettings?.paymentMethods.map(
                              (method) => (
                                <SelectItem
                                  key={method.id}
                                  value={method.name}
                                >
                                  {method.name}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>
                          Payment Ref No.
                          {paymentSettings?.mandatoryFields
                            .paymentRefNo && (
                            <span className="text-destructive">
                              *
                            </span>
                          )}
                        </Label>
                        <Input
                          placeholder="Enter Payment Ref"
                          value={expense.paymentRefNo}
                          onChange={(e) =>
                            handleExpenseChange(
                              expense.id,
                              'paymentRefNo',
                              e.target.value
                            )
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Approval Copy */}
                      <div className="space-y-2">
                        <Label>
                          Approval Copy
                          {paymentSettings?.mandatoryFields
                            .approvalCopy && (
                            <span className="text-destructive">
                              *
                            </span>
                          )}
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="file"
                            id={`approval-copy-${expense.id}`}
                            className="hidden"
                            onChange={(e) =>
                              handleFileChange(
                                expense.id,
                                'approvalCopy',
                                e.target.files
                                  ? e.target.files[0]
                                  : null
                              )
                            }
                          />
                          <Label
                            htmlFor={`approval-copy-${expense.id}`}
                            className="flex-grow border rounded-md p-2 text-sm text-muted-foreground truncate cursor-pointer hover:bg-muted/50"
                          >
                            {expense.approvalCopy
                              ? expense.approvalCopy.name
                              : 'No file selected'}
                          </Label>
                          <Button asChild variant="outline">
                            <Label
                              htmlFor={`approval-copy-${expense.id}`}
                              className="cursor-pointer"
                            >
                              <Upload className="mr-2 h-4 w-4" />
                              Upload
                            </Label>
                          </Button>
                        </div>
                      </div>

                      {/* Bank Transfer Copy */}
                      <div className="space-y-2">
                        <Label>
                          Bank Transfer Copy
                          {paymentSettings?.mandatoryFields
                            .bankTransferCopy && (
                            <span className="text-destructive">
                              *
                            </span>
                          )}
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="file"
                            id={`transfer-copy-${expense.id}`}
                            className="hidden"
                            onChange={(e) =>
                              handleFileChange(
                                expense.id,
                                'bankTransferCopy',
                                e.target.files
                                  ? e.target.files[0]
                                  : null
                              )
                            }
                          />
                          <Label
                            htmlFor={`transfer-copy-${expense.id}`}
                            className="flex-grow border rounded-md p-2 text-sm text-muted-foreground truncate cursor-pointer hover:bg-muted/50"
                          >
                            {expense.bankTransferCopy
                              ? expense.bankTransferCopy.name
                              : 'No file selected'}
                          </Label>
                          <Button asChild variant="outline">
                            <Label
                              htmlFor={`transfer-copy-${expense.id}`}
                              className="cursor-pointer"
                            >
                              <Upload className="mr-2 h-4 w-4" />
                              Upload
                            </Label>
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Description{' '}
                        <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        placeholder="e.g. Office supplies..."
                        value={expense.description}
                        onChange={(e) =>
                          handleExpenseChange(
                            expense.id,
                            'description',
                            e.target.value
                          )
                        }
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center">
            <Button
              variant="outline"
              onClick={addExpense}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Another Payment
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                isSaving ||
                activeBankAccounts.length === 0
              }
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Payments
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
    </>
  );
}
