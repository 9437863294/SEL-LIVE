'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { balanceAt, buildLedger, formatInr, isCashCredit } from '@/lib/bank-balance-ledger';
import {
  BANK_PAGE,
  BankAccessDenied,
  BankBalanceBackground,
  BankPageSkeleton,
  accountLabel,
} from '@/components/bank-balance/page-kit';

type TransactionItem = {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
};

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createTransactionItem = (): TransactionItem => ({
  id: makeId(),
  fromAccountId: '',
  toAccountId: '',
  amount: 0,
});

/**
 * What the account can pay out at the end of `day`, from the engine (so the opening date is
 * honoured): a Current Account's balance, or a Cash Credit account's limit in force less its
 * utilisation.
 */
const availableOn = (account: BankAccount, txns: BankExpense[], day: Date) => {
  const figure = balanceAt(buildLedger(account, txns), day);
  return isCashCredit(account) ? getApplicableCcLimit(account, day) - figure : figure;
};

export default function NewInternalTransactionPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>(() => [
    createTransactionItem(),
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const canAdd = !authLoading && can('Add', 'Bank Balance.Internal Transaction');
  const activeBankAccounts = useMemo(
    () => bankAccounts.filter((account) => account.status === 'Active'),
    [bankAccounts]
  );

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
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
  }, [toast]);

  useEffect(() => {
    if (authLoading) return;
    if (!canAdd) {
      setIsLoading(false);
      return;
    }
    void fetchData();
  }, [authLoading, canAdd, fetchData]);

  const handleTransactionChange = (
    id: string,
    field: keyof TransactionItem,
    value: TransactionItem[keyof TransactionItem]
  ) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const addTransaction = () => {
    setTransactions((prev) => [...prev, createTransactionItem()]);
  };

  const removeTransaction = (id: string) => {
    setTransactions((prev) =>
      prev.length > 1 ? prev.filter((t) => t.id !== id) : prev
    );
  };

  // Each source account's available funds on the chosen date, and what this batch draws on it —
  // every row from the same account together, so two rows cannot each spend the whole balance.
  const sources = useMemo(() => {
    const map = new Map<string, { account: BankAccount; available: number; requested: number }>();
    if (!date) return map;
    for (const item of transactions) {
      if (!item.fromAccountId) continue;
      const account = bankAccounts.find((acc) => acc.id === item.fromAccountId);
      if (!account) continue;
      const source =
        map.get(account.id) ?? { account, available: availableOn(account, allTransactions, date), requested: 0 };
      source.requested += item.amount || 0;
      map.set(account.id, source);
    }
    return map;
  }, [transactions, bankAccounts, allTransactions, date]);

  const totalAmount = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);

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

    // Balance / DP validation, per source account across every row.
    if (transactions.some((item) => !bankAccounts.some((acc) => acc.id === item.fromAccountId))) {
      toast({
        title: 'Validation Error',
        description:
          'One of the selected source accounts could not be found.',
        variant: 'destructive',
      });
      return;
    }
    for (const { account, available, requested } of sources.values()) {
      if (requested > available) {
        toast({
          title: 'Insufficient Funds',
          description: `Transfers from ${accountLabel(account)} total ${formatInr(requested)}, more than the available ${
            isCashCredit(account) ? 'limit' : 'balance'
          } of ${formatInr(available)}.`,
          variant: 'destructive',
        });
        return;
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
        description: `${transactions.length} transaction(s) totalling ${formatInr(totalAmount)} saved successfully.`,
      });

      setTransactions([createTransactionItem()]);
      setDate(new Date());
      // The next batch is checked against balances that include this one.
      void fetchData(true);
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
    return <BankPageSkeleton kpis={0} />;
  }

  if (!canAdd) {
    return (
      <BankAccessDenied
        title="New Internal Transfer"
        backHref="/bank-balance/internal-transaction"
        backLabel="Back to transfers"
        what="the transfer entry form"
      />
    );
  }

  return (
    <>
      <BankBalanceBackground tone="blue" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="New Internal Transfer"
          description="Record a transfer between bank accounts"
          backHref="/bank-balance/internal-transaction"
          backLabel="Back to transfers"
          actions={
            <Button asChild variant="outline">
              <Link href="/bank-balance/internal-transaction">
                <History className="mr-2 h-4 w-4" />
                Transfers
              </Link>
            </Button>
          }
        />

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-2">
                <Label htmlFor="transfer-date">Transaction Date</Label>
                <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="transfer-date"
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal sm:w-60',
                        !date && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? format(date, 'PPP') : <span>Pick a date</span>}
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

              <div className="w-full flex-shrink-0 text-left sm:w-auto sm:text-right">
                <p className="text-muted-foreground">Total</p>
                <p className="text-2xl font-bold tabular-nums">{formatInr(totalAmount)}</p>
              </div>
            </div>

            <div className="space-y-4">
              {transactions.map((item, index) => {
                const source = item.fromAccountId ? sources.get(item.fromAccountId) : undefined;
                const sharedRows = transactions.filter((t) => t.fromAccountId && t.fromAccountId === item.fromAccountId).length;
                const overdrawn = !!source && source.requested > source.available;
                return (
                  <div key={item.id} className="space-y-4 rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-base font-semibold">Transfer #{index + 1}</h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeTransaction(item.id)}
                        disabled={transactions.length <= 1}
                        aria-label={`Remove transfer #${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="ml-1.5 sm:hidden">Remove</span>
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor={`transfer-from-${item.id}`}>From Bank</Label>
                        <Select
                          value={item.fromAccountId}
                          onValueChange={(val) => handleTransactionChange(item.id, 'fromAccountId', val)}
                        >
                          <SelectTrigger id={`transfer-from-${item.id}`}>
                            <SelectValue placeholder="Select Account" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeBankAccounts.map((acc) => (
                              <SelectItem key={acc.id} value={acc.id} disabled={acc.id === item.toAccountId}>
                                {acc.shortName} - {acc.bankName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {source && (
                          <p className={cn('text-xs', overdrawn ? 'text-destructive' : 'text-muted-foreground')}>
                            {isCashCredit(source.account) ? 'Available limit' : 'Available balance'}{' '}
                            <span className="font-medium tabular-nums">{formatInr(source.available)}</span>
                            {sharedRows > 1 && (
                              <>
                                {' '}· {sharedRows} rows draw <span className="tabular-nums">{formatInr(source.requested)}</span>
                              </>
                            )}
                            {overdrawn && ' — more than is available'}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`transfer-to-${item.id}`}>To Bank</Label>
                        <Select
                          value={item.toAccountId}
                          onValueChange={(val) => handleTransactionChange(item.id, 'toAccountId', val)}
                        >
                          <SelectTrigger id={`transfer-to-${item.id}`}>
                            <SelectValue placeholder="Select Account" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeBankAccounts.map((acc) => (
                              <SelectItem key={acc.id} value={acc.id} disabled={acc.id === item.fromAccountId}>
                                {acc.shortName} - {acc.bankName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`transfer-amount-${item.id}`}>Amount</Label>
                        <Input
                          id={`transfer-amount-${item.id}`}
                          type="number"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={item.amount || ''}
                          onChange={(e) => handleTransactionChange(item.id, 'amount', e.target.valueAsNumber || 0)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="outline" onClick={addTransaction}>
                <Plus className="mr-2 h-4 w-4" /> Add Another Transaction
              </Button>
              <Button onClick={handleSave} disabled={isSaving || activeBankAccounts.length < 2}>
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
    </>
  );
}
