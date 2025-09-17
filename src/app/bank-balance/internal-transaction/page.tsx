
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Save,
  Loader2,
  Home,
  Edit,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, runTransaction, Timestamp, query, where, orderBy } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { DateRange } from 'react-day-picker';

type UnifiedTransaction = {
  id: string;
  date: string;
  fromAccountId: string;
  toAccountId: string;
  fromBankName: string;
  toBankName: string;
  amount: number;
};

const initialTransactionItem = {
  id: Date.now(),
  fromAccountId: '',
  toAccountId: '',
  amount: 0,
};

type TransactionItem = typeof initialTransactionItem;

export default function InternalTransactionPage() {
  const { toast } = useToast();
  // Entry Tab State
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([initialTransactionItem]);
  const [isSaving, setIsSaving] = useState(false);

  // Log Tab State
  const [logEntries, setLogEntries] = useState<UnifiedTransaction[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const fetchBankAccountsAndLog = async () => {
    setIsLogLoading(true);
    try {
        const [accountsSnap, expensesSnap] = await Promise.all([
            getDocs(collection(db, 'bankAccounts')),
            getDocs(query(collection(db, 'bankExpenses'), where('isContra', '==', true)))
        ]);
        
        const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
        setBankAccounts(accounts);
        
        const contraEntries = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense))
            .sort((a,b) => b.date.toDate().getTime() - a.date.toDate().getTime());
        
        const groupedTransactions: Record<string, Partial<UnifiedTransaction>> = {};

        contraEntries.forEach(entry => {
            const entryDate = format(entry.date.toDate(), 'yyyy-MM-dd');
            // Group by a key that combines date, amount, and involved accounts to handle multiple transfers on the same day
            const accountsKey = [entry.accountId, entry.type].sort().join('-');
            const key = `${entryDate}-${entry.amount}-${accountsKey}`;

            if (!groupedTransactions[key]) {
                groupedTransactions[key] = { amount: entry.amount, date: entryDate };
            }

            if (entry.type === 'Debit') {
                groupedTransactions[key].fromAccountId = entry.accountId;
            } else if (entry.type === 'Credit') {
                groupedTransactions[key].toAccountId = entry.accountId;
            }
             groupedTransactions[key].id = entry.id; // Use one of the doc ids as a key
        });

        const unifiedLog: UnifiedTransaction[] = Object.values(groupedTransactions)
            .filter(t => t.fromAccountId && t.toAccountId) // Ensure it's a complete pair
            .map(t => ({
                ...t,
                fromBankName: accounts.find(acc => acc.id === t.fromAccountId)?.shortName || 'N/A',
                toBankName: accounts.find(acc => acc.id === t.toAccountId)?.shortName || 'N/A',
            } as UnifiedTransaction));

        setLogEntries(unifiedLog);
    } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Error', description: 'Failed to load log data.', variant: 'destructive' });
    }
    setIsLogLoading(false);
  };
  
  useEffect(() => {
    fetchBankAccountsAndLog();
  }, [toast]);
  
  const filteredLogEntries = useMemo(() => {
    return logEntries.filter(entry => {
        const entryDate = new Date(entry.date);
        const inDateRange = !dateRange || (
            (!dateRange.from || entryDate >= dateRange.from) &&
            (!dateRange.to || entryDate <= dateRange.to)
        );
        return inDateRange;
    });
  }, [logEntries, dateRange]);


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

  const handleSave = async () => {
    if (!date || transactions.length === 0 || transactions.some(t => !t.fromAccountId || !t.toAccountId || t.amount <= 0 || t.fromAccountId === t.toAccountId)) {
        toast({ title: 'Validation Error', description: 'Please fill all fields correctly for each transaction. "From" and "To" accounts cannot be the same.', variant: 'destructive' });
        return;
    }
    setIsSaving(true);
    
    try {
        await runTransaction(db, async (transaction) => {
            for (const item of transactions) {
                const fromAccountRef = doc(db, 'bankAccounts', item.fromAccountId);
                const toAccountRef = doc(db, 'bankAccounts', item.toAccountId);

                const fromAccountDoc = await transaction.get(fromAccountRef);
                const toAccountDoc = await transaction.get(toAccountRef);

                if (!fromAccountDoc.exists() || !toAccountDoc.exists()) throw new Error("One or both bank accounts in a transaction not found.");
                
                const fromAccountData = fromAccountDoc.data();
                const toAccountData = toAccountDoc.data();

                const debitData: Omit<BankExpense, 'id'> = {
                    date: Timestamp.fromDate(date),
                    accountId: item.fromAccountId,
                    description: `Transfer to ${toAccountData.shortName} - ${toAccountData.bankName}`,
                    amount: item.amount,
                    type: 'Debit',
                    isContra: true,
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
                    createdAt: Timestamp.now(),
                };
                const creditRef = doc(collection(db, 'bankExpenses'));
                transaction.set(creditRef, creditData);

                // No balance update needed as per new logic
            }
        });
        
        toast({ title: 'Success', description: `${transactions.length} transaction(s) saved successfully.`});
        setTransactions([initialTransactionItem]);
        setDate(new Date());
        fetchBankAccountsAndLog(); // Refresh log

    } catch (error) {
        console.error("Error saving transactions:", error);
        toast({ title: 'Save Failed', description: 'An error occurred while saving.', variant: 'destructive' });
    }
    setIsSaving(false);
  }
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const clearFilters = () => {
    setDateRange(undefined);
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Internal Transaction</h1>
        </div>
        <Link href="/">
          <Button variant="ghost" size="icon"><Home className="h-6 w-6" /></Button>
        </Link>
      </div>

      <Tabs defaultValue="entry">
        <TabsList className="mb-4">
          <TabsTrigger value="entry">Entry</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>
        <TabsContent value="entry">
          <Card>
            <CardHeader>
              <CardTitle>Contra Voucher</CardTitle>
              <CardDescription>Record fund transfers between bank accounts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                    <CalendarIcon className="mr-2 h-4 w-4" />
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
                          <Label>From Bank (Debit)</Label>
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
                          <Label>To Bank (Credit)</Label>
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
        </TabsContent>
        <TabsContent value="log">
           <Card>
                <CardHeader>
                    <CardTitle>Transaction Log</CardTitle>
                    <CardDescription>History of all internal bank transfers.</CardDescription>
                </CardHeader>
                <CardContent>
                     <div className="flex flex-wrap gap-4 mb-4">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button id="date" variant={"outline"} className={cn("w-[300px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {dateRange?.from ? (dateRange.to ? (<>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</>) : (format(dateRange.from, "LLL dd, y"))) : (<span>Pick a date range</span>)}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
                            </PopoverContent>
                        </Popover>
                        <Button onClick={clearFilters} variant="secondary">Clear Filter</Button>
                    </div>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>From Bank</TableHead>
                                <TableHead>To Bank</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                             {isLogLoading ? (
                                Array.from({length: 5}).map((_, i) => <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6" /></TableCell></TableRow>)
                            ) : filteredLogEntries.length > 0 ? (
                                filteredLogEntries.map(entry => (
                                    <TableRow key={entry.id}>
                                        <TableCell>{format(new Date(entry.date), 'dd MMM, yyyy')}</TableCell>
                                        <TableCell>{entry.fromBankName}</TableCell>
                                        <TableCell>{entry.toBankName}</TableCell>
                                        <TableCell>{formatCurrency(entry.amount)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="outline" size="sm" disabled><Edit className="mr-2 h-4 w-4" />Edit</Button>
                                            <Button variant="destructive" size="sm" className="ml-2" disabled><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                               <TableRow><TableCell colSpan={5} className="text-center h-24">No internal transfers found for the selected criteria.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
