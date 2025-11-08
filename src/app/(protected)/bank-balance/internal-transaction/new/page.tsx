'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, startOfDay } from 'date-fns';
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

type TransactionItem = {
  id: number;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
};

const createTransactionItem = (): TransactionItem => ({
  id: Date.now() + Math.floor(Math.random() * 1000),
  fromAccountId: '',
  toAccountId: '',
  amount: 0,
});

export default function NewInternalTransactionPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([
    createTransactionItem(),
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const canAdd = can('Add', 'Bank Balance.Internal Transaction');

  useEffect(() => {
    const fetchData = async () => {
      if (!canAdd) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const [accountsSnap, transactionsSnap] = await Promise.all([
          getDocs(collection(db, 'bankAccounts')),
          getDocs(collection(db, 'bankExpenses')),
        ]);

        const accounts = accountsSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as BankAccount)
        );
        setBankAccounts(accounts);

        const expenses = transactionsSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as BankExpense)
        );
        setAllTransactions(expenses);
      } catch (error) {
        console.error('Error loading initial data:', error);
        toast({
          title: 'Error',
          description: 'Failed to load initial data.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    if (!authLoading) {
      void fetchData();
    }
  }, [authLoading, canAdd, toast]);

  const handleTransactionChange = (
    id: number,
    field: keyof TransactionItem,
    value: any
  ) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const addTransaction = () => {
    setTransactions((prev) => [...prev, createTransactionItem()]);
  };

  const removeTransaction = (id: number) => {
    setTransactions((prev) =>
      prev.length > 1 ? prev.filter((t) => t.id !== id) : prev
    );
  };

  const getLatestDp = (account: BankAccount, onDate: Date): number => {
    if (!account.drawingPower || account.drawingPower.length === 0) return 0;
    const sortedDp = [...account.drawingPower].sort(
      (a, b) =>
        new Date(b.fromDate).getTime() - new Date(a.fromDate).getTime()
    );
    const applicableDp = sortedDp.find(
      (dp) => new Date(dp.fromDate) <= startOfDay(onDate)
    );
    return applicableDp?.amount || 0;
  };

  const handleSave = async () => {
    if (!canAdd) {
      toast({
        title: 'Not allowed',
        description:
          'You do not have permission to create internal transactions.',
        variant: 'destructive',
      });
      return;
    }

    if (
      !date ||
      transactions.length === 0 ||
      transactions.some(
        (t) =>
          !t.fromAccountId ||
          !t.toAccountId ||
          t.amount <= 0 ||
          t.fromAccountId === t.toAccountId
      )
    ) {
      toast({
        title: 'Validation Error',
        description:
          'Please fill all fields correctly for each transaction. "From" and "To" accounts cannot be the same and amount must be greater than 0.',
        variant: 'destructive',
      });
      return;
    }

    // Balance / DP validation
    for (const item of transactions) {
      const fromAccount = bankAccounts.find(
        (acc) => acc.id === item.fromAccountId
      );
      if (!fromAccount) {
        toast({
          title: 'Validation Error',
          description:
            'One of the selected source accounts could not be found.',
          variant: 'destructive',
        });
        return;
      }

      let balance =
        fromAccount.accountType === 'Cash Credit'
          ? fromAccount.openingUtilization || 0
          : fromAccount.openingBalance || 0;

      if (fromAccount.openingDate) {
        const historical = allTransactions
          .filter(
            (t) =>
              t.accountId === fromAccount.id &&
              t.date.toDate() < startOfDay(date)
          )
          .sort(
            (a, b) => a.date.toMillis() - b.date.toMillis()
          );

        historical.forEach((t) => {
          const amt = t.amount;
          if (fromAccount.accountType === 'Cash Credit') {
            // Utilization: Debit increases, Credit decreases
            balance += t.type === 'Debit' ? amt : -amt;
          } else {
            // Current: Debit decreases, Credit increases
            balance += t.type === 'Debit' ? -amt : amt;
          }
        });
      }

      if (fromAccount.accountType === 'Cash Credit') {
        const availableDp = getLatestDp(fromAccount, date) - balance;
        if (item.amount > availableDp) {
          toast({
            title: 'Insufficient Funds',
            description: `Transfer from ${fromAccount.shortName} exceeds available drawing power of ${availableDp.toLocaleString(
              'en-IN'
            )}.`,
            variant: 'destructive',
          });
          return;
        }
      } else {
        if (item.amount > balance) {
          toast({
            title: 'Insufficient Funds',
            description: `Transfer from ${fromAccount.shortName} exceeds available balance of ${balance.toLocaleString(
              'en-IN'
            )}.`,
            variant: 'destructive',
          });
          return;
        }
      }
    }

    setIsSaving(true);

    try {
      await runTransaction(db, async (tx) => {
        for (const item of transactions) {
          const fromRef = doc(db, 'bankAccounts', item.fromAccountId);
          const toRef = doc(db, 'bankAccounts', item.toAccountId);

          const fromSnap = await tx.get(fromRef);
          const toSnap = await tx.get(toRef);

          if (!fromSnap.exists() || !toSnap.exists()) {
            throw new Error(
              'One or both bank accounts in a transaction not found.'
            );
          }

          const from = fromSnap.data() as BankAccount;
          const to = toSnap.data() as BankAccount;

          const newFromBalance = (from.currentBalance || 0) - item.amount;
          const newToBalance = (to.currentBalance || 0) + item.amount;

          tx.update(fromRef, { currentBalance: newFromBalance });
          tx.update(toRef, { currentBalance: newToBalance });

          // Generate a shared contraId
          const contraId = doc(collection(db, 'contraIds')).id;

          const baseData = {
            date: Timestamp.fromDate(date),
            isContra: true,
            contraId,
            createdAt: Timestamp.now(),
          };

          const debitRef = doc(collection(db, 'bankExpenses'));
          tx.set(debitRef, {
            ...baseData,
            accountId: item.fromAccountId,
            description: `Transfer to ${to.shortName} - ${to.bankName}`,
            amount: item.amount,
            type: 'Debit',
          } as Omit<BankExpense, 'id'>);

          const creditRef = doc(collection(db, 'bankExpenses'));
          tx.set(creditRef, {
            ...baseData,
            accountId: item.toAccountId,
            description: `Transfer from ${from.shortName} - ${from.bankName}`,
            amount: item.amount,
            type: 'Credit',
          } as Omit<BankExpense, 'id'>);
        }
      });

      toast({
        title: 'Success',
        description: `${transactions.length} transaction(s) saved successfully.`,
      });

      setTransactions([createTransactionItem()]);
      setDate(new Date());
    } catch (error) {
      console.error('Error saving transactions:', error);
      toast({
        title: 'Save Failed',
        description: 'An error occurred while saving.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || (isLoading && canAdd)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-80 mb-6" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canAdd) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance/internal-transaction">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">New Contra Entry</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to create internal transactions.
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
          <Link href="/bank-balance/internal-transaction">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">New Contra Entry</h1>
        </div>
        <Link href="/bank-balance/internal-transaction">
          <Button variant="outline">
            <History className="mr-2 h-4 w-4" />
            Transaction Log
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="w-full max-w-xs">
            <Label className="mb-2 block">Transaction Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
                >
                  {date ? (
                    format(date, 'PPP')
                  ) : (
                    <span>Pick a date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-4">
            {transactions.map((item) => (
              <div
                key={item.id}
                className="border p-4 rounded-lg flex items-end gap-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-grow">
                  <div className="space-y-2">
                    <Label>From Bank</Label>
                    <Select
                      value={item.fromAccountId}
                      onValueChange={(val) =>
                        handleTransactionChange(
                          item.id,
                          'fromAccountId',
                          val
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Account" />
                      </SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map((acc) => (
                          <SelectItem
                            key={acc.id}
                            value={acc.id}
                            disabled={
                              acc.id === item.toAccountId
                            }
                          >
                            {acc.shortName} - {acc.bankName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>To Bank</Label>
                    <Select
                      value={item.toAccountId}
                      onValueChange={(val) =>
                        handleTransactionChange(
                          item.id,
                          'toAccountId',
                          val
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Account" />
                      </SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map((acc) => (
                          <SelectItem
                            key={acc.id}
                            value={acc.id}
                            disabled={
                              acc.id === item.fromAccountId
                            }
                          >
                            {acc.shortName} - {acc.bankName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={item.amount || ''}
                      onChange={(e) =>
                        handleTransactionChange(
                          item.id,
                          'amount',
                          e.target.valueAsNumber || 0
                        )
                      }
                    />
                  </div>
                </div>

                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() =>
                    removeTransaction(item.id)
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center">
            <Button
              variant="outline"
              onClick={addTransaction}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Another
              Transaction
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Transactions
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
