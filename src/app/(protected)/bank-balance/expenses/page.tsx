
'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Search,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { format, compareDesc } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, runTransaction, query, deleteDoc, where } from 'firebase/firestore';
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


export default function ExpensesLogPage() {
  const { toast } = useToast();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [logEntries, setLogEntries] = useState<BankExpense[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [bankFilter, setBankFilter] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');

  const fetchBankAccountsAndExpenses = async () => {
      setIsLogLoading(true);
      try {
        const [accountsSnap, expensesSnap] = await Promise.all([
            getDocs(collection(db, 'bankAccounts')),
            getDocs(query(collection(db, 'bankExpenses'), where('type', '==', 'Debit'), where('isContra', '==', false)))
        ]);
        
        const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
        setBankAccounts(accounts);
        
        const expensesData = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense));
        expensesData.sort((a, b) => compareDesc(a.date.toDate(), b.date.toDate()));
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

  
  const handleDeleteExpense = async (expenseToDelete: BankExpense) => {
    try {
      await runTransaction(db, async (transaction) => {
        const expenseRef = doc(db, 'bankExpenses', expenseToDelete.id);
        transaction.delete(expenseRef);
      });
      
      toast({ title: 'Success', description: 'Expense deleted.' });
      fetchBankAccountsAndExpenses(); // Refresh data

    } catch (error) {
      console.error("Error deleting expense:", error);
      toast({ title: 'Delete Failed', description: 'An error occurred while deleting the expense.', variant: 'destructive' });
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
          <h1 className="text-2xl font-bold">Payments Log</h1>
        </div>
        <Link href="/bank-balance/expenses/new">
            <Button><Plus className="mr-2 h-4 w-4"/> New Payment</Button>
        </Link>
      </div>

       <Card>
            <CardContent className="p-4">
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
                                        <TableCell>{bank?.shortName || 'N/A'}</TableCell>
                                        <TableCell>{entry.description}</TableCell>
                                        <TableCell>{entry.paymentRequestRefNo}</TableCell>
                                        <TableCell>{entry.utrNumber}</TableCell>
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
                                                            This action cannot be undone. This will permanently delete this payment.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleDeleteExpense(entry)}>Delete</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        ) : (
                           <TableRow><TableCell colSpan={7} className="text-center h-24">No payment records found.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    </div>
  );
}
