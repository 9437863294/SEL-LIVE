
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Upload,
  Save,
  Loader2,
  Home,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, runTransaction, Timestamp, query, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { BankAccount, BankExpense } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';


const initialExpenseItem = {
  id: Date.now(),
  description: '',
  paymentRequestRefNo: '',
  utrNumber: '',
  amount: 0,
  paymentMethod: '',
  paymentRefNo: '',
  approvalCopy: null as File | null,
  bankTransferCopy: null as File | null,
};

type ExpenseItem = typeof initialExpenseItem;

export default function ExpensesEntryPage() {
  const { toast } = useToast();
  // Entry Tab State
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedBank, setSelectedBank] = useState<string>('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([initialExpenseItem]);
  const [isSaving, setIsSaving] = useState(false);

  // Log Tab State
  const [logEntries, setLogEntries] = useState<BankExpense[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [bankFilter, setBankFilter] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');

  const fetchBankAccountsAndExpenses = async () => {
      try {
        const [accountsSnap, expensesSnap] = await Promise.all([
            getDocs(collection(db, 'bankAccounts')),
            getDocs(query(collection(db, 'bankExpenses'), orderBy('date', 'desc')))
        ]);
        
        const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
        setBankAccounts(accounts);
        
        const expensesData = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense));
        setLogEntries(expensesData);

      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Error', description: 'Failed to load initial data.', variant: 'destructive' });
      }
      setIsLogLoading(false);
  };

  useEffect(() => {
    fetchBankAccountsAndExpenses();
  }, [toast]);
  
  const filteredLogEntries = useMemo(() => {
    return logEntries.filter(entry => {
        const entryDate = entry.date.toDate();
        const inDateRange = !dateRange || (
            (!dateRange.from || entryDate >= dateRange.from) &&
            (!dateRange.to || entryDate <= dateRange.to)
        );
        const bankMatch = bankFilter === 'all' || entry.accountId === bankFilter;
        const searchMatch = !searchFilter || 
            entry.description.toLowerCase().includes(searchFilter.toLowerCase()) ||
            entry.paymentRequestRefNo?.toLowerCase().includes(searchFilter.toLowerCase()) ||
            entry.utrNumber?.toLowerCase().includes(searchFilter.toLowerCase());
            
        return inDateRange && bankMatch && searchMatch;
    });
  }, [logEntries, dateRange, bankFilter, searchFilter]);

  const totalAmount = expenses.reduce((sum, exp) => sum + exp.amount, 0);

  const handleExpenseChange = (id: number, field: keyof ExpenseItem, value: any) => {
    setExpenses(prev =>
      prev.map(exp => (exp.id === id ? { ...exp, [field]: value } : exp))
    );
  };

  const addExpense = () => {
    setExpenses(prev => [...prev, { ...initialExpenseItem, id: Date.now() }]);
  };

  const removeExpense = (id: number) => {
    setExpenses(prev => prev.filter(exp => exp.id !== id));
  };
  
  const handleFileChange = (id: number, field: 'approvalCopy' | 'bankTransferCopy', file: File | null) => {
    setExpenses(prev => 
        prev.map(exp => exp.id === id ? {...exp, [field]: file} : exp)
    );
  }

  const handleSave = async () => {
    if (!date || !selectedBank || expenses.length === 0 || expenses.some(e => !e.description || e.amount <= 0)) {
        toast({ title: 'Validation Error', description: 'Please fill all required fields for each expense.', variant: 'destructive' });
        return;
    }
    setIsSaving(true);
    
    try {
        await runTransaction(db, async (transaction) => {
            const bankAccountRef = doc(db, 'bankAccounts', selectedBank);
            const bankAccountDoc = await transaction.get(bankAccountRef);
            if (!bankAccountDoc.exists()) throw new Error("Bank account not found.");
            
            let totalExpenseAmount = 0;

            for (const expense of expenses) {
                totalExpenseAmount += expense.amount;
                let approvalCopyUrl = '';
                let bankTransferCopyUrl = '';

                if (expense.approvalCopy) {
                    const approvalRef = ref(storage, `expenses/${date.toISOString()}/${expense.approvalCopy.name}`);
                    await uploadBytes(approvalRef, expense.approvalCopy);
                    approvalCopyUrl = await getDownloadURL(approvalRef);
                }
                if (expense.bankTransferCopy) {
                    const transferRef = ref(storage, `expenses/${date.toISOString()}/${expense.bankTransferCopy.name}`);
                    await uploadBytes(transferRef, expense.bankTransferCopy);
                    bankTransferCopyUrl = await getDownloadURL(transferRef);
                }
                
                const expenseData: Omit<BankExpense, 'id'> = {
                    date: Timestamp.fromDate(date),
                    accountId: selectedBank,
                    description: expense.description,
                    amount: expense.amount,
                    type: 'Debit',
                    isContra: false,
                    paymentRequestRefNo: expense.paymentRequestRefNo,
                    utrNumber: expense.utrNumber,
                    paymentMethod: expense.paymentMethod,
                    paymentRefNo: expense.paymentRefNo,
                    approvalCopyUrl,
                    bankTransferCopyUrl,
                    createdAt: Timestamp.now(),
                };

                const expenseRef = doc(collection(db, 'bankExpenses'));
                transaction.set(expenseRef, expenseData);
            }
            
            const newBalance = bankAccountDoc.data().currentBalance - totalExpenseAmount;
            transaction.update(bankAccountRef, { currentBalance: newBalance });
        });
        
        toast({ title: 'Success', description: `${expenses.length} expense(s) saved successfully.`});
        setExpenses([initialExpenseItem]);
        setDate(new Date());
        setSelectedBank('');
        fetchBankAccountsAndExpenses(); // Refresh log data

    } catch (error) {
        console.error("Error saving expenses:", error);
        toast({ title: 'Save Failed', description: 'An error occurred while saving.', variant: 'destructive' });
    }
    setIsSaving(false);
  }
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const clearFilters = () => {
    setDateRange(undefined);
    setBankFilter('all');
    setSearchFilter('');
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Expenses Entry</h1>
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
              <CardTitle>Record Expenses</CardTitle>
              <CardDescription>Enter individual expenses for a specific date and bank.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <Label>Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-[240px] justify-start text-left font-normal",
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
                  <div className="space-y-1">
                    <Label>Select Bank</Label>
                    <Select value={selectedBank} onValueChange={setSelectedBank}>
                        <SelectTrigger className="w-[280px]">
                            <SelectValue placeholder="Select a bank account" />
                        </SelectTrigger>
                        <SelectContent>
                            {bankAccounts.map(acc => (
                                <SelectItem key={acc.id} value={acc.id}>{acc.accountName} - {acc.bankName}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="text-right w-full sm:w-auto">
                  <p className="text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(totalAmount)}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {expenses.map((expense, index) => (
                  <Collapsible key={expense.id} defaultOpen className="border p-4 rounded-lg">
                    <div className="flex justify-between items-center">
                      <CollapsibleTrigger asChild>
                        <h4 className="text-lg font-semibold cursor-pointer">
                          Expense #{index + 1}
                        </h4>
                      </CollapsibleTrigger>
                      <div className="flex items-center gap-4">
                         <span className="font-semibold text-lg">{formatCurrency(expense.amount)}</span>
                         <Button variant="destructive" size="icon" onClick={() => removeExpense(expense.id)}>
                            <Trash2 className="h-4 w-4" />
                         </Button>
                      </div>
                    </div>
                    <CollapsibleContent className="mt-4 space-y-4">
                        <Textarea placeholder="e.g. Office supplies" value={expense.description} onChange={(e) => handleExpenseChange(expense.id, 'description', e.target.value)} />
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                             <Input placeholder="Payment Request Ref No." value={expense.paymentRequestRefNo} onChange={(e) => handleExpenseChange(expense.id, 'paymentRequestRefNo', e.target.value)} />
                             <Input placeholder="UTR Number" value={expense.utrNumber} onChange={(e) => handleExpenseChange(expense.id, 'utrNumber', e.target.value)} />
                             <Input type="number" placeholder="Amount" value={expense.amount || ''} onChange={(e) => handleExpenseChange(expense.id, 'amount', e.target.valueAsNumber || 0)} />
                        </div>
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                             <Select value={expense.paymentMethod} onValueChange={(val) => handleExpenseChange(expense.id, 'paymentMethod', val)}>
                                <SelectTrigger><SelectValue placeholder="Select method"/></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="NEFT">NEFT</SelectItem>
                                    <SelectItem value="RTGS">RTGS</SelectItem>
                                    <SelectItem value="IMPS">IMPS</SelectItem>
                                    <SelectItem value="Cash">Cash</SelectItem>
                                </SelectContent>
                             </Select>
                             <Input placeholder="Payment Ref No." value={expense.paymentRefNo} onChange={(e) => handleExpenseChange(expense.id, 'paymentRefNo', e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label>Approval Copy</Label>
                                <div className="flex items-center gap-2">
                                  <Input type="file" className="flex-1" onChange={(e) => handleFileChange(expense.id, 'approvalCopy', e.target.files ? e.target.files[0] : null)} />
                                </div>
                            </div>
                             <div className="space-y-1">
                                <Label>Bank Transfer Copy</Label>
                                <div className="flex items-center gap-2">
                                  <Input type="file" className="flex-1" onChange={(e) => handleFileChange(expense.id, 'bankTransferCopy', e.target.files ? e.target.files[0] : null)} />
                                </div>
                            </div>
                        </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>

              <div className="flex justify-between items-center">
                <Button variant="outline" onClick={addExpense}><Plus className="mr-2 h-4 w-4" /> Add Another Expense</Button>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
                    Save Expenses
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="log">
           <Card>
                <CardHeader>
                    <CardTitle>Expenses Log</CardTitle>
                    <CardDescription>History of all expense entries.</CardDescription>
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
                        <Select value={bankFilter} onValueChange={setBankFilter}>
                            <SelectTrigger className="w-[240px]">
                                <SelectValue placeholder="All Banks" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Banks</SelectItem>
                                {bankAccounts.map(acc => (
                                    <SelectItem key={acc.id} value={acc.id}>{acc.accountName} - {acc.bankName}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search..." className="pl-8" value={searchFilter} onChange={e => setSearchFilter(e.target.value)} />
                        </div>
                        <Button onClick={clearFilters} variant="secondary">Clear Filters</Button>
                    </div>

                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Bank</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead>Ref No.</TableHead>
                                <TableHead>UTR No.</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLogLoading ? (
                                Array.from({length: 5}).map((_, i) => <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6" /></TableCell></TableRow>)
                            ) : filteredLogEntries.length > 0 ? (
                                filteredLogEntries.map(entry => {
                                    const bank = bankAccounts.find(b => b.id === entry.accountId);
                                    return (
                                        <TableRow key={entry.id}>
                                            <TableCell>{format(entry.date.toDate(), 'dd MMM, yyyy')}</TableCell>
                                            <TableCell>{bank?.accountName || 'N/A'}</TableCell>
                                            <TableCell>{entry.description}</TableCell>
                                            <TableCell>{entry.paymentRequestRefNo}</TableCell>
                                            <TableCell>{entry.utrNumber}</TableCell>
                                            <TableCell>{formatCurrency(entry.amount)}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : (
                               <TableRow><TableCell colSpan={7} className="text-center h-24">No expense records found.</TableCell></TableRow>
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
