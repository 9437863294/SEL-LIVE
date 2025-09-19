
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
  ChevronUp,
  History,
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
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, runTransaction, Timestamp, getDoc } from 'firebase/firestore';
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

interface PaymentSettings {
  mandatoryFields: {
    paymentRequestRefNo: boolean;
    utrNumber: boolean;
    paymentMethod: boolean;
    paymentRefNo: boolean;
    approvalCopy: boolean;
    bankTransferCopy: boolean;
  };
  paymentMethods: { id: string, name: string }[];
}


export default function NewPaymentPage() {
  const { toast } = useToast();
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<string>('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([initialExpenseItem]);
  const [isSaving, setIsSaving] = useState(false);
  const [openCollapsibleId, setOpenCollapsibleId] = useState<number | null>(Date.now());
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);

  const fetchBankAccountsAndSettings = async () => {
      setIsSettingsLoading(true);
      try {
        const [accountsSnap, settingsDoc, methodsSnap] = await Promise.all([
            getDocs(collection(db, 'bankAccounts')),
            getDoc(doc(db, 'bankBalanceSettings', 'paymentEntry')),
            getDocs(collection(db, 'paymentMethods')),
        ]);
        
        const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
        setBankAccounts(accounts);
        
        const mandatoryFields = settingsDoc.exists() 
            ? settingsDoc.data().mandatoryFields 
            : { paymentRequestRefNo: false, utrNumber: false, paymentMethod: false, paymentRefNo: false, approvalCopy: false, bankTransferCopy: false };
        const paymentMethods = methodsSnap.docs.map(d => ({id: d.id, name: d.data().name}));
        setPaymentSettings({ mandatoryFields, paymentMethods });

      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Error', description: 'Failed to load initial data.', variant: 'destructive' });
      }
      setIsSettingsLoading(false);
  };

  useEffect(() => {
    fetchBankAccountsAndSettings();
  }, [toast]);
  

  const totalAmount = expenses.reduce((sum, exp) => sum + exp.amount, 0);

  const handleExpenseChange = (id: number, field: keyof ExpenseItem, value: any) => {
    setExpenses(prev =>
      prev.map(exp => (exp.id === id ? { ...exp, [field]: value } : exp))
    );
  };

  const addExpense = () => {
    const newId = Date.now();
    setExpenses(prev => [...prev, { ...initialExpenseItem, id: newId }]);
    setOpenCollapsibleId(newId);
  };

  const removeExpense = (id: number) => {
    const newExpenses = expenses.filter(exp => exp.id !== id);
    if (newExpenses.length === 0) {
        const newId = Date.now();
        setExpenses([{...initialExpenseItem, id: newId}]);
        setOpenCollapsibleId(newId);
    } else {
        setExpenses(newExpenses);
        if (openCollapsibleId === id) {
            setOpenCollapsibleId(newExpenses[0]?.id ?? null);
        }
    }
  };
  
  const handleFileChange = (id: number, field: 'approvalCopy' | 'bankTransferCopy', file: File | null) => {
    setExpenses(prev => 
        prev.map(exp => exp.id === id ? {...exp, [field]: file} : exp)
    );
  }

  const handleSave = async () => {
    if (!date || !selectedBank) {
        toast({ title: 'Validation Error', description: 'Please select a date and a bank account.', variant: 'destructive' });
        return;
    }
    
    // Validation
    const mandatory = paymentSettings?.mandatoryFields;
    for(const expense of expenses) {
        if (!expense.description || expense.amount <= 0) {
            toast({ title: 'Validation Error', description: `Please fill out Description and Amount for Payment #${expenses.indexOf(expense) + 1}.`, variant: 'destructive' });
            return;
        }
        if (mandatory) {
            if(mandatory.paymentRequestRefNo && !expense.paymentRequestRefNo) {
                toast({ title: 'Validation Error', description: `Payment Request Ref No. is required for Payment #${expenses.indexOf(expense) + 1}.`, variant: 'destructive' }); return;
            }
            if(mandatory.utrNumber && !expense.utrNumber) {
                toast({ title: 'Validation Error', description: `UTR Number is required for Payment #${expenses.indexOf(expense) + 1}.`, variant: 'destructive' }); return;
            }
            if(mandatory.paymentMethod && !expense.paymentMethod) {
                toast({ title: 'Validation Error', description: `Payment Method is required for Payment #${expenses.indexOf(expense) + 1}.`, variant: 'destructive' }); return;
            }
            if(mandatory.paymentRefNo && !expense.paymentRefNo) {
                toast({ title: 'Validation Error', description: `Payment Ref No. is required for Payment #${expenses.indexOf(expense) + 1}.`, variant: 'destructive' }); return;
            }
            if(mandatory.approvalCopy && !expense.approvalCopy) {
                toast({ title: 'Validation Error', description: `Approval Copy is required for Payment #${expenses.indexOf(expense) + 1}.`, variant: 'destructive' }); return;
            }
            if(mandatory.bankTransferCopy && !expense.bankTransferCopy) {
                toast({ title: 'Validation Error', description: `Bank Transfer Copy is required for Payment #${expenses.indexOf(expense) + 1}.`, variant: 'destructive' }); return;
            }
        }
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

                const expenseRef = doc(collection(db, 'bankExpenses'));
                transaction.set(expenseRef, expenseData);
            }
        });
        
        toast({ title: 'Success', description: `${expenses.length} expense(s) saved successfully.`});
        const newId = Date.now();
        const newInitialExpense = { ...initialExpenseItem, id: newId };
        setExpenses([newInitialExpense]);
        setOpenCollapsibleId(newId);
        setDate(new Date());
        setSelectedBank('');

    } catch (error) {
        console.error("Error saving expenses:", error);
        toast({ title: 'Save Failed', description: 'An error occurred while saving.', variant: 'destructive' });
    }
    setIsSaving(false);
  }
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/bank-balance/expenses">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-xl font-bold">New Payment Entry</h1>
        </div>
        <Link href="/bank-balance/expenses">
            <Button variant="outline">
                <History className="mr-2 h-4 w-4" />
                Payments Log
            </Button>
        </Link>
      </div>

        <Card>
            <CardContent className="space-y-6 pt-6">
               <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
                  <div className="flex flex-wrap items-end gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="payment-date">Date</Label>
                        <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                id="payment-date"
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
                          <Label htmlFor="bank-select">Select Bank</Label>
                          <Select value={selectedBank} onValueChange={setSelectedBank}>
                              <SelectTrigger id="bank-select" className="w-[280px]">
                                  <SelectValue placeholder="Select a bank account" />
                              </SelectTrigger>
                              <SelectContent>
                                  {bankAccounts.map(acc => (
                                      <SelectItem key={acc.id} value={acc.id}>{acc.shortName} - {acc.bankName}</SelectItem>
                                  ))}
                              </SelectContent>
                          </Select>
                      </div>
                  </div>
                  <div className="text-right flex-shrink-0 w-full sm:w-auto mt-4 sm:mt-0">
                    <p className="text-muted-foreground">Total</p>
                    <p className="text-2xl font-bold">
                        {formatCurrency(totalAmount)}
                    </p>
                  </div>
              </div>

              <div className="space-y-4">
                {isSettingsLoading ? <Skeleton className="h-64" /> : expenses.map((expense, index) => (
                  <Collapsible 
                    key={expense.id} 
                    open={openCollapsibleId === expense.id}
                    onOpenChange={(isOpen) => setOpenCollapsibleId(isOpen ? expense.id : null)}
                    className="border p-4 rounded-lg"
                  >
                    <div className="flex justify-between items-center">
                      <CollapsibleTrigger asChild className="flex-grow cursor-pointer">
                        <div className="flex flex-col">
                          <div className="flex justify-between items-center w-full">
                             <h4 className="text-lg font-semibold">Payment #{index + 1}</h4>
                             <div className="flex items-center gap-4">
                               <span className="font-semibold text-lg">{formatCurrency(expense.amount)}</span>
                                <ChevronUp className={cn("h-5 w-5 transition-transform", openCollapsibleId === expense.id && "rotate-180")} />
                             </div>
                          </div>
                           {openCollapsibleId !== expense.id && (
                            <div className="mt-2 text-sm text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                                <span><span className="font-medium">P.R. Ref:</span> {expense.paymentRequestRefNo || 'N/A'}</span>
                                <span><span className="font-medium">UTR No:</span> {expense.utrNumber || 'N/A'}</span>
                                <span><span className="font-medium">Method:</span> {expense.paymentMethod || 'N/A'}</span>
                                <span><span className="font-medium">Pmt. Ref:</span> {expense.paymentRefNo || 'N/A'}</span>
                            </div>
                           )}
                        </div>
                      </CollapsibleTrigger>
                      <Button variant="ghost" size="icon" className="h-8 w-8 ml-2 flex-shrink-0" onClick={(e) => { e.stopPropagation(); removeExpense(expense.id); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <CollapsibleContent className="mt-4 space-y-4">
                       <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label>Payment Request Ref No. {paymentSettings?.mandatoryFields.paymentRequestRefNo && <span className="text-destructive">*</span>}</Label>
                            <Input placeholder="Enter Ref No." value={expense.paymentRequestRefNo} onChange={(e) => handleExpenseChange(expense.id, 'paymentRequestRefNo', e.target.value)} />
                          </div>
                          <div className="space-y-2">
                            <Label>UTR Number {paymentSettings?.mandatoryFields.utrNumber && <span className="text-destructive">*</span>}</Label>
                            <Input placeholder="Enter UTR No." value={expense.utrNumber} onChange={(e) => handleExpenseChange(expense.id, 'utrNumber', e.target.value)} />
                          </div>
                          <div className="space-y-2">
                            <Label>Amount <span className="text-destructive">*</span></Label>
                            <Input type="number" placeholder="0.00" value={expense.amount || ''} onChange={(e) => handleExpenseChange(expense.id, 'amount', e.target.valueAsNumber || 0)} />
                          </div>
                       </div>
                       
                       <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                          <div className="space-y-2">
                            <Label>Payment Method {paymentSettings?.mandatoryFields.paymentMethod && <span className="text-destructive">*</span>}</Label>
                             <Select value={expense.paymentMethod} onValueChange={(val) => handleExpenseChange(expense.id, 'paymentMethod', val)}>
                                <SelectTrigger><SelectValue placeholder="Select method"/></SelectTrigger>
                                <SelectContent>
                                    {paymentSettings?.paymentMethods.map(method => (
                                        <SelectItem key={method.id} value={method.name}>{method.name}</SelectItem>
                                    ))}
                                </SelectContent>
                             </Select>
                          </div>
                           <div className="space-y-2">
                            <Label>Payment Ref No. {paymentSettings?.mandatoryFields.paymentRefNo && <span className="text-destructive">*</span>}</Label>
                            <Input placeholder="Enter Payment Ref" value={expense.paymentRefNo} onChange={(e) => handleExpenseChange(expense.id, 'paymentRefNo', e.target.value)} />
                          </div>
                       </div>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="space-y-2">
                             <Label>Approval Copy {paymentSettings?.mandatoryFields.approvalCopy && <span className="text-destructive">*</span>}</Label>
                              <div className="flex items-center gap-2">
                                <Input type="file" id={`approval-copy-${expense.id}`} className="hidden" onChange={(e) => handleFileChange(expense.id, 'approvalCopy', e.target.files ? e.target.files[0] : null)} />
                                <Label htmlFor={`approval-copy-${expense.id}`} className="flex-grow border rounded-md p-2 text-sm text-muted-foreground truncate cursor-pointer hover:bg-muted/50">
                                    {expense.approvalCopy ? expense.approvalCopy.name : 'No file selected'}
                                </Label>
                                <Button asChild variant="outline">
                                    <Label htmlFor={`approval-copy-${expense.id}`} className="cursor-pointer">
                                        <Upload className="mr-2 h-4 w-4"/> Upload
                                    </Label>
                                </Button>
                              </div>
                          </div>
                           <div className="space-y-2">
                              <Label>Bank Transfer Copy {paymentSettings?.mandatoryFields.bankTransferCopy && <span className="text-destructive">*</span>}</Label>
                               <div className="flex items-center gap-2">
                                <Input type="file" id={`transfer-copy-${expense.id}`} className="hidden" onChange={(e) => handleFileChange(expense.id, 'bankTransferCopy', e.target.files ? e.target.files[0] : null)} />
                                <Label htmlFor={`transfer-copy-${expense.id}`} className="flex-grow border rounded-md p-2 text-sm text-muted-foreground truncate cursor-pointer hover:bg-muted/50">
                                    {expense.bankTransferCopy ? expense.bankTransferCopy.name : 'No file selected'}
                                </Label>
                                <Button asChild variant="outline">
                                    <Label htmlFor={`transfer-copy-${expense.id}`} className="cursor-pointer">
                                        <Upload className="mr-2 h-4 w-4"/> Upload
                                    </Label>
                                </Button>
                               </div>
                           </div>
                       </div>
                       <div className="space-y-2">
                        <Label>Description <span className="text-destructive">*</span></Label>
                        <Textarea 
                          placeholder="e.g. Office supplies for the month of September" 
                          value={expense.description} 
                          onChange={(e) => handleExpenseChange(expense.id, 'description', e.target.value)} 
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>

              <div className="flex justify-between items-center">
                <Button variant="outline" onClick={addExpense}><Plus className="mr-2 h-4 w-4" /> Add Another Payment</Button>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
                    Save Payments
                </Button>
              </div>
            </CardContent>
          </Card>
    </div>
  );
}


    

    