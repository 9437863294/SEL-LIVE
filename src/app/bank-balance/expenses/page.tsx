
'use client';

import { useState, useEffect } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, runTransaction, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { BankAccount, BankExpense } from '@/lib/types';

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
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedBank, setSelectedBank] = useState<string>('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([initialExpenseItem]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchBankAccounts = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'bankAccounts'));
        const accounts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
        setBankAccounts(accounts);
      } catch (error) {
        console.error("Error fetching bank accounts:", error);
        toast({ title: 'Error', description: 'Failed to load bank accounts.', variant: 'destructive' });
      }
    };
    fetchBankAccounts();
  }, [toast]);

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
            for (const expense of expenses) {
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

                // Add to bankExpenses collection
                const expenseRef = doc(collection(db, 'bankExpenses'));
                transaction.set(expenseRef, expenseData);

                // Update bank account balance
                const bankAccountRef = doc(db, 'bankAccounts', selectedBank);
                const bankAccountDoc = await transaction.get(bankAccountRef);
                if (!bankAccountDoc.exists()) throw new Error("Bank account not found.");
                
                const newBalance = bankAccountDoc.data().currentBalance - expense.amount;
                transaction.update(bankAccountRef, { currentBalance: newBalance });
            }
        });
        
        toast({ title: 'Success', description: `${expenses.length} expense(s) saved successfully.`});
        setExpenses([initialExpenseItem]);
        setDate(new Date());
        setSelectedBank('');

    } catch (error) {
        console.error("Error saving expenses:", error);
        toast({ title: 'Save Failed', description: 'An error occurred while saving.', variant: 'destructive' });
    }
    setIsSaving(false);
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
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
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
                <div className="text-right">
                  <p className="text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold">
                    {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(totalAmount)}
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
                         <span className="font-semibold text-lg">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(expense.amount)}</span>
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
            <CardHeader><CardTitle>Expense Log</CardTitle></CardHeader>
            <CardContent>
                <p>The expense log will be displayed here.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
