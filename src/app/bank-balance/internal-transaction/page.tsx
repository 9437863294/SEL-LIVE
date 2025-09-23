
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
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, compareDesc } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, runTransaction, Timestamp, query, where, writeBatch } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { DateRange } from 'react-day-picker';
import { useAuthorization } from '@/hooks/useAuthorization';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

type UnifiedTransaction = {
  id: string;
  contraId: string;
  date: string;
  fromAccountId: string;
  toAccountId: string;
  fromBankName: string;
  toBankName: string;
  amount: number;
};

export default function InternalTransactionPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [logEntries, setLogEntries] = useState<UnifiedTransaction[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const canView = can('View', 'Bank Balance.Internal Transaction');
  const canDelete = can('Delete', 'Bank Balance.Internal Transaction');

  const fetchBankAccountsAndLog = async () => {
    setIsLogLoading(true);
    try {
        const [accountsSnap, expensesSnap] = await Promise.all([
            getDocs(collection(db, 'bankAccounts')),
            getDocs(query(collection(db, 'bankExpenses'), where('isContra', '==', true)))
        ]);
        
        const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
        setBankAccounts(accounts);
        
        const contraEntries = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankExpense));
        
        contraEntries.sort((a,b) => compareDesc(a.date.toDate(), b.date.toDate()));
        
        const groupedTransactions: Record<string, Partial<UnifiedTransaction> & { ids?: string[] }> = {};

        contraEntries.forEach(entry => {
            const contraId = entry.contraId;
            if (!contraId) return;

            if (!groupedTransactions[contraId]) {
                groupedTransactions[contraId] = {
                    ids: [],
                    amount: entry.amount,
                    date: format(entry.date.toDate(), 'yyyy-MM-dd')
                };
            }
            
            groupedTransactions[contraId].ids?.push(entry.id);

            if (entry.type === 'Debit') {
                groupedTransactions[contraId].fromAccountId = entry.accountId;
            } else if (entry.type === 'Credit') {
                groupedTransactions[contraId].toAccountId = entry.accountId;
            }
        });

        const unifiedLog: UnifiedTransaction[] = Object.values(groupedTransactions)
            .filter(t => t.fromAccountId && t.toAccountId && t.ids && t.ids.length > 0)
            .map(t => ({
                id: t.ids![0],
                contraId: t.ids![0], // Using the first document ID as a proxy for contraId
                date: t.date!,
                fromAccountId: t.fromAccountId!,
                toAccountId: t.toAccountId!,
                amount: t.amount!,
                fromBankName: accounts.find(acc => acc.id === t.fromAccountId)?.shortName || 'N/A',
                toBankName: accounts.find(acc => acc.id === t.toAccountId)?.shortName || 'N/A',
            } as UnifiedTransaction));

        setLogEntries(unifiedLog);
    } catch (error: any) {
        console.error("Error fetching data:", error);
        if (error.code === 'failed-precondition') {
            toast({
                title: 'Database Index Required',
                description: 'The query for the transaction log requires a Firestore index. Please create one for the `bankExpenses` collection on `isContra` and `date`.',
                variant: 'destructive',
                duration: 10000,
            });
        } else {
           toast({ title: 'Error', description: 'Failed to load log data.', variant: 'destructive' });
        }
    }
    setIsLogLoading(false);
  };
  
  useEffect(() => {
    if(!authLoading) {
      if(canView) {
        fetchBankAccountsAndLog();
      } else {
        setIsLogLoading(false);
      }
    }
  }, [toast, authLoading, canView]);
  
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
  
  const handleDeleteTransaction = async (entry: UnifiedTransaction) => {
    try {
        const expensesRef = collection(db, 'bankExpenses');
        const q = query(expensesRef, where('contraId', '==', entry.contraId));
        const querySnapshot = await getDocs(q);

        const batch = writeBatch(db);
        querySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        toast({ title: 'Success', description: 'Internal transaction deleted.' });
        fetchBankAccountsAndLog();
    } catch (error) {
        console.error("Error deleting internal transaction:", error);
        toast({ title: 'Delete Failed', description: 'An error occurred while deleting.', variant: 'destructive' });
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const clearFilters = () => {
    setDateRange(undefined);
  }

  if (authLoading || (isLogLoading && canView)) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-96 w-full" />
        </div>
    );
  }

  if (!canView) {
     return (
         <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href="/bank-balance"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                <h1 className="text-xl font-bold">Internal Transaction Log</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view this page.</CardDescription>
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
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Internal Transaction Log</h1>
        </div>
        <Link href="/bank-balance/internal-transaction/new">
          <Button><Plus className="mr-2 h-4 w-4" /> New Contra Entry</Button>
        </Link>
      </div>

       <Card>
            <CardContent className="pt-6">
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
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="destructive" size="sm" className="ml-2" disabled={!canDelete}>
                                                    <Trash2 className="mr-2 h-4 w-4" />Delete
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                                    <AlertDialogDescription>This action will permanently delete both the debit and credit entries for this transaction.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDeleteTransaction(entry)}>Delete</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
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
    </div>
  );
}
