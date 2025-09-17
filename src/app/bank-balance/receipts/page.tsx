
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
import { format, compareDesc } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, runTransaction, Timestamp, query, orderBy, deleteDoc, where } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";


const initialReceiptItem = {
  id: Date.now(),
  description: '',
  amount: 0,
};

type ReceiptItem = typeof initialReceiptItem;

export default function ReceiptsEntryPage() {
  const { toast } = useToast();
  // Entry Tab State
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<string>('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([initialReceiptItem]);
  const [isSaving, setIsSaving] = useState(false);

  // Log Tab State
  const [logEntries, setLogEntries] = useState<BankExpense[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [bankFilter, setBankFilter] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');

  const fetchBankAccountsAndReceipts = async () => {
      try {
        const [accountsSnap, receiptsSnap] = await Promise.all([
            getDocs(collection(db, 'bankAccounts')),
            getDocs(query(collection(db, 'bankExpenses'), where('type', '==', 'Credit')))
        ]);
        
        const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
        setBankAccounts(accounts);
        
        const receiptsData = receiptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense));
        receiptsData.sort((a, b) => compareDesc(a.date.toDate(), b.date.toDate()));
        setLogEntries(receiptsData);

      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Error', description: 'Failed to load initial data.', variant: 'destructive' });
      }
      setIsLogLoading(false);
  };

  useEffect(() => {
    fetchBankAccountsAndReceipts();
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
            entry.description.toLowerCase().includes(searchFilter.toLowerCase());
            
        return inDateRange && bankMatch && searchMatch;
    });
  }, [logEntries, dateRange, bankFilter, searchFilter]);

  const totalAmount = receipts.reduce((sum, rec) => sum + rec.amount, 0);

  const handleReceiptChange = (id: number, field: keyof ReceiptItem, value: any) => {
    setReceipts(prev =>
      prev.map(rec => (rec.id === id ? { ...rec, [field]: value } : rec))
    );
  };

  const addReceipt = () => {
    setReceipts(prev => [...prev, { ...initialReceiptItem, id: Date.now() }]);
  };

  const removeReceipt = (id: number) => {
    setReceipts(prev => prev.filter(rec => rec.id !== id));
  };
  
  const handleSave = async () => {
    if (!date || !selectedBank || receipts.length === 0 || receipts.some(r => !r.description || r.amount <= 0)) {
        toast({ title: 'Validation Error', description: 'Please fill all required fields for each receipt.', variant: 'destructive' });
        return;
    }
    setIsSaving(true);
    
    try {
        await runTransaction(db, async (transaction) => {
            const bankAccountRef = doc(db, 'bankAccounts', selectedBank);
            const bankAccountDoc = await transaction.get(bankAccountRef);
            if (!bankAccountDoc.exists()) throw new Error("Bank account not found.");
            
            for (const receipt of receipts) {
                const receiptData: Omit<BankExpense, 'id'> = {
                    date: Timestamp.fromDate(date),
                    accountId: selectedBank,
                    description: receipt.description,
                    amount: receipt.amount,
                    type: 'Credit',
                    isContra: false, // Receipts are not contra
                    createdAt: Timestamp.now(),
                };

                const receiptRef = doc(collection(db, 'bankExpenses'));
                transaction.set(receiptRef, receiptData);
            }
        });
        
        toast({ title: 'Success', description: `${receipts.length} receipt(s) saved successfully.`});
        setReceipts([initialReceiptItem]);
        setDate(new Date());
        setSelectedBank('');
        fetchBankAccountsAndReceipts(); // Refresh log data

    } catch (error) {
        console.error("Error saving receipts:", error);
        toast({ title: 'Save Failed', description: 'An error occurred while saving.', variant: 'destructive' });
    }
    setIsSaving(false);
  }
  
  const handleDeleteReceipt = async (receiptToDelete: BankExpense) => {
    try {
      await runTransaction(db, async (transaction) => {
        const receiptRef = doc(db, 'bankExpenses', receiptToDelete.id);
        transaction.delete(receiptRef);
      });
      
      toast({ title: 'Success', description: 'Receipt deleted successfully.' });
      fetchBankAccountsAndReceipts(); // Refresh data

    } catch (error) {
      console.error("Error deleting receipt:", error);
      toast({ title: 'Delete Failed', description: 'An error occurred while deleting the receipt.', variant: 'destructive' });
    }
  };

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
          <h1 className="text-2xl font-bold">Receipts Entry</h1>
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
              <CardTitle>Record Receipts</CardTitle>
              <CardDescription>Enter individual receipts for a specific date and bank.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
                    <div className="space-y-1">
                        <Label className="mb-2">Date</Label>
                        <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                        <PopoverTrigger asChild>
                            <Button
                            variant={"outline"}
                            className={cn(
                                "w-full sm:w-[240px] justify-start text-left font-normal",
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
                    <div className="space-y-1">
                        <Label className="mb-2">Select Bank</Label>
                        <Select value={selectedBank} onValueChange={setSelectedBank}>
                            <SelectTrigger className="w-full sm:w-[280px]">
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
                {receipts.map((receipt, index) => (
                  <Collapsible key={receipt.id} defaultOpen className="border p-4 rounded-lg">
                    <div className="flex justify-between items-center">
                      <CollapsibleTrigger asChild>
                        <h4 className="text-lg font-semibold cursor-pointer">
                          Receipt #{index + 1}
                        </h4>
                      </CollapsibleTrigger>
                      <div className="flex items-center gap-4">
                         <span className="font-semibold text-lg">{formatCurrency(receipt.amount)}</span>
                         <Button variant="destructive" size="icon" onClick={() => removeReceipt(receipt.id)}>
                            <Trash2 className="h-4 w-4" />
                         </Button>
                      </div>
                    </div>
                    <CollapsibleContent className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-4">
                        <Textarea placeholder="e.g. Received from Client X" value={receipt.description} onChange={(e) => handleReceiptChange(receipt.id, 'description', e.target.value)} className="md:col-span-3"/>
                        <div className="md:col-span-2">
                             <Input type="number" placeholder="Amount" value={receipt.amount || ''} onChange={(e) => handleReceiptChange(receipt.id, 'amount', e.target.valueAsNumber || 0)} />
                        </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>

              <div className="flex justify-between items-center">
                <Button variant="outline" onClick={addReceipt}><Plus className="mr-2 h-4 w-4" /> Add Another Receipt</Button>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
                    Save Receipts
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="log">
           <Card>
                <CardHeader>
                    <CardTitle>Receipts Log</CardTitle>
                    <CardDescription>History of all receipt entries.</CardDescription>
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
                                    <SelectItem key={acc.id} value={acc.id}>{acc.shortName} - {acc.bankName}</SelectItem>
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
                                <TableHead>Amount</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLogLoading ? (
                                Array.from({length: 5}).map((_, i) => <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6" /></TableCell></TableRow>)
                            ) : filteredLogEntries.length > 0 ? (
                                filteredLogEntries.map(entry => {
                                    const bank = bankAccounts.find(b => b.id === entry.accountId);
                                    return (
                                        <TableRow key={entry.id}>
                                            <TableCell>{format(entry.date.toDate(), 'dd MMM, yyyy')}</TableCell>
                                            <TableCell>{bank?.shortName || 'N/A'}</TableCell>
                                            <TableCell>{entry.description}</TableCell>
                                            <TableCell>{formatCurrency(entry.amount)}</TableCell>
                                            <TableCell className="text-right">
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="destructive" size="sm">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                This action cannot be undone. This will permanently delete this receipt.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => handleDeleteReceipt(entry)}>Delete</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : (
                               <TableRow><TableCell colSpan={5} className="text-center h-24">No receipt records found.</TableCell></TableRow>
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

    
