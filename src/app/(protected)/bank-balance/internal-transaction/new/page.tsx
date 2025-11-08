
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, startOfDay } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, runTransaction, Timestamp } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';

const initialTransactionItem = {
  id: Date.now(),
  fromAccountId: '',
  toAccountId: '',
  amount: 0,
};

type TransactionItem = typeof initialTransactionItem;

export default function NewInternalTransactionPage() {
  const { toast } = useToast();
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([initialTransactionItem]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [accountsSnap, transactionsSnap] = await Promise.all([
          getDocs(collection(db, 'bankAccounts')),
          getDocs(collection(db, 'bankExpenses'))
        ]);
        setBankAccounts(accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount)));
        setAllTransactions(transactionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense)));
      } catch (error) {
        toast({ title: 'Error', description: 'Failed to load initial data.', variant: 'destructive' });
      }
    };
    fetchData();
  }, [toast]);

  const handleTransactionChange = (id: number, field: keyof TransactionItem, value: any) => {
    setTransactions(prev =>
      prev.map(t => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const addTransaction = () => {
    setTransactions(prev => [...prev, { ...initialTransactionItem, id: Date.now() }]);
  };

  const removeTransaction = (id: number) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
  };
  
  const getLatestDp = (account: BankAccount, onDate: Date): number => {
    if (!account.drawingPower || account.drawingPower.length === 0) return 0;
    const sortedDp = account.drawingPower.sort((a, b) => new Date(b.fromDate).getTime() - new Date(a.fromDate).getTime());
    const applicableDp = sortedDp.find(dp => new Date(dp.fromDate) <= startOfDay(onDate));
    return applicableDp?.amount || 0;
  };


  const handleSave = async () => {
    if (!date || transactions.length === 0 || transactions.some(t => !t.fromAccountId || !t.toAccountId || t.amount <= 0 || t.fromAccountId === t.toAccountId)) {
      toast({ title: 'Validation Error', description: 'Please fill all fields correctly for each transaction. "From" and "To" accounts cannot be the same.', variant: 'destructive' });
      return;
    }
    
    // --- Balance Validation ---
    for (const item of transactions) {
      const fromAccount = bankAccounts.find(acc => acc.id === item.fromAccountId);
      if (!fromAccount) {
        toast({ title: 'Validation Error', description: `Source account for a transaction not found.`, variant: 'destructive' });
        return;
      }
      
      let balance = fromAccount.openingUtilization || 0;
      if(fromAccount.openingDate) {
        const historicalTransactions = allTransactions
            .filter(t => t.accountId === fromAccount.id && t.date.toDate() < startOfDay(date))
            .sort((a, b) => a.date.toMillis() - b.date.toMillis());
        
        historicalTransactions.forEach(t => {
            balance += (t.type === 'Credit' ? t.amount : -t.amount);
        });
      }

      if (fromAccount.accountType === 'Cash Credit') {
          const availableDp = getLatestDp(fromAccount, date) - balance;
          if (item.amount > availableDp) {
              toast({ title: 'Insufficient Funds', description: `Transfer from ${fromAccount.shortName} exceeds available drawing power of ${availableDp.toLocaleString()}.`, variant: 'destructive' });
              return;
          }
      } else { // Current Account
          if (item.amount > balance) {
              toast({ title: 'Insufficient Funds', description: `Transfer from ${fromAccount.shortName} exceeds available balance of ${balance.toLocaleString()}.`, variant: 'destructive' });
              return;
          }
      }
    }
    // --- End Balance Validation ---

    setIsSaving(true);
    
    try {
        await runTransaction(db, async (transaction) => {
            for (const item of transactions) {
                const fromAccountRef = doc(db, 'bankAccounts', item.fromAccountId);
                const toAccountRef = doc(db, 'bankAccounts', item.toAccountId);

                const fromAccountDoc = await transaction.get(fromAccountRef);
                const toAccountDoc = await transaction.get(toAccountRef);

                if (!fromAccountDoc.exists() || !toAccountDoc.exists()) throw new Error("One or both bank accounts in a transaction not found.");
                
                const fromAccountData = fromAccountDoc.data() as BankAccount;
                const toAccountData = toAccountDoc.data() as BankAccount;

                // Update account balances - THIS LOGIC WAS MISSING
                const newFromBalance = (fromAccountData.currentBalance || 0) - item.amount;
                const newToBalance = (toAccountData.currentBalance || 0) + item.amount;
                transaction.update(fromAccountRef, { currentBalance: newFromBalance });
                transaction.update(toAccountRef, { currentBalance: newToBalance });

                const contraId = doc(collection(db, 'contraIds')).id;

                const debitData: Omit<BankExpense, 'id'> = {
                    date: Timestamp.fromDate(date),
                    accountId: item.fromAccountId,
                    description: `Transfer to ${toAccountData.shortName} - ${toAccountData.bankName}`,
                    amount: item.amount,
                    type: 'Debit',
                    isContra: true,
                    contraId: contraId,
                    createdAt: Timestamp.now(),
                };
                const debitRef = doc(collection(db, 'bankExpenses'));
                transaction.set(debitRef, debitData);

                const creditData: Omit<BankExpense, 'id'> = {
                    date: Timestamp.fromDate(date),
                    accountId: item.toAccountId,
                    description: `Transfer from ${fromAccountData.shortName} - ${fromAccountData.bankName}`,
                    amount: item.amount,
                    type: 'Credit',
                    isContra: true,
                    contraId: contraId,
                    createdAt: Timestamp.now(),
                };
                const creditRef = doc(collection(db, 'bankExpenses'));
                transaction.set(creditRef, creditData);
            }
        });
        
        toast({ title: 'Success', description: `${transactions.length} transaction(s) saved successfully.`});
        setTransactions([initialTransactionItem]);
        setDate(new Date());

    } catch (error) {
        console.error("Error saving transactions:", error);
        toast({ title: 'Save Failed', description: 'An error occurred while saving.', variant: 'destructive' });
    }
    setIsSaving(false);
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/bank-balance/internal-transaction">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">New Contra Entry</h1>
        </div>
         <Link href="/bank-balance/internal-transaction">
            <Button variant="outline"><History className="mr-2 h-4 w-4" /> Transaction Log</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
            <div className="w-full max-w-xs">
            <Label className="mb-2 block">Transaction Date</Label>
            <Popover>
            <PopoverTrigger asChild>
                <Button
                variant={"outline"}
                className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                )}
                >
                {date ? format(date, "PPP") : <span>Pick a date</span>}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
            </PopoverContent>
            </Popover>
            </div>

            <div className="space-y-4">
            {transactions.map((item, index) => (
                <div key={item.id} className="border p-4 rounded-lg flex items-end gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-grow">
                    <div className="space-y-2">
                        <Label>From Bank</Label>
                        <Select value={item.fromAccountId} onValueChange={(val) => handleTransactionChange(item.id, 'fromAccountId', val)}>
                        <SelectTrigger><SelectValue placeholder="Select Account" /></SelectTrigger>
                        <SelectContent>
                            {bankAccounts.map(acc => (
                            <SelectItem key={acc.id} value={acc.id} disabled={acc.id === item.toAccountId}>
                                {acc.shortName} - {acc.bankName}
                            </SelectItem>
                            ))}
                        </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>To Bank</Label>
                        <Select value={item.toAccountId} onValueChange={(val) => handleTransactionChange(item.id, 'toAccountId', val)}>
                        <SelectTrigger><SelectValue placeholder="Select Account" /></SelectTrigger>
                        <SelectContent>
                            {bankAccounts.map(acc => (
                            <SelectItem key={acc.id} value={acc.id} disabled={acc.id === item.fromAccountId}>
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
                        onChange={e => handleTransactionChange(item.id, 'amount', e.target.valueAsNumber || 0)}
                        />
                    </div>
                    </div>
                    <Button variant="destructive" size="icon" onClick={() => removeTransaction(item.id)}>
                    <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ))}
            </div>

            <div className="flex justify-between items-center">
            <Button variant="outline" onClick={addTransaction}><Plus className="mr-2 h-4 w-4" /> Add Another Transaction</Button>
            <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
                Save Transactions
            </Button>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
