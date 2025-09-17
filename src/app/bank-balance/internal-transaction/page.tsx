
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
import { cn } from '@/lib/utils';
import { format, compareDesc } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, runTransaction, Timestamp, query, where } from 'firebase/firestore';
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

export default function InternalTransactionPage() {
  const { toast } = useToast();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
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
    </div>
  );
}
