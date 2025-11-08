
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import type { BankExpense, BankAccount } from '@/lib/types';
import { format, startOfMonth, endOfMonth, eachMonthOfInterval, compareAsc, parseISO } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';


interface MonthlyData {
  month: string;
  monthLabel: string;
  openingBalance: number;
  inflow: number;
  outflow: number;
  net: number;
  closingBalance: number;
}

export default function CashflowStatementPage() {
  const { toast } = useToast();
  const [data, setData] = useState<MonthlyData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [expensesQuery, accountsQuery] = await Promise.all([
          getDocs(query(collection(db, 'bankExpenses'), where('isContra', '==', false))),
          getDocs(collection(db, 'bankAccounts'))
        ]);
        
        const transactions = expensesQuery.docs.map(doc => doc.data() as BankExpense);
        const accounts = accountsQuery.docs.map(doc => doc.data() as BankAccount);

        if (transactions.length === 0) {
            setData([]);
            setIsLoading(false);
            return;
        }

        transactions.sort((a,b) => a.date.toMillis() - b.date.toMillis());

        const firstDate = transactions[0].date.toDate();
        const lastDate = transactions[transactions.length - 1].date.toDate();

        const interval = { start: startOfMonth(firstDate), end: endOfMonth(lastDate) };
        const monthsInInterval = eachMonthOfInterval(interval);

        // Calculate initial opening balance
        let runningBalance = accounts.reduce((sum, acc) => sum + (acc.openingUtilization || 0), 0);
        const firstMonthStart = startOfMonth(firstDate);
        
        const preTransactions = transactions.filter(t => t.date.toDate() < firstMonthStart);

        preTransactions.forEach(t => {
            runningBalance += t.type === 'Credit' ? t.amount : -t.amount;
        });


        const monthlyData = monthsInInterval.map(monthStart => {
            const monthString = format(monthStart, 'yyyy-MM');
            const monthLabel = format(monthStart, 'MMMM yyyy');

            const monthTransactions = transactions.filter(t => format(t.date.toDate(), 'yyyy-MM') === monthString);

            const inflow = monthTransactions.filter(t => t.type === 'Credit').reduce((sum, t) => sum + t.amount, 0);
            const outflow = monthTransactions.filter(t => t.type === 'Debit').reduce((sum, t) => sum + t.amount, 0);
            const net = inflow - outflow;
            
            const openingBalance = runningBalance;
            const closingBalance = openingBalance + net;

            runningBalance = closingBalance; // Set up for next month

            return {
                month: monthString,
                monthLabel,
                openingBalance,
                inflow,
                outflow,
                net,
                closingBalance,
            };
        });

        setData(monthlyData.reverse()); // Show most recent months first

      } catch (error: any) {
          console.error("Error fetching cashflow data:", error);
           if (error.code === 'failed-precondition') {
             toast({
                title: 'Database Index Required',
                description: "This query may require a custom index. Please check the Firebase console for the 'bankExpenses' collection.",
                variant: 'destructive',
                duration: 10000,
             });
        } else {
            toast({ title: 'Error', description: 'Failed to fetch transaction data.', variant: 'destructive' });
        }
      }
      setIsLoading(false);
    };

    fetchData();
  }, [toast]);
  

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };
  
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/bank-balance/reports">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Cashflow Statement</h1>
      </div>
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-bold text-xs p-2">MONTH</TableHead>
                    <TableHead className="text-right font-bold text-xs p-2">INFLOW (RECEIPTS)</TableHead>
                    <TableHead className="text-right font-bold text-xs p-2">OUTFLOW (PAYMENTS)</TableHead>
                    <TableHead className="text-right font-bold text-xs p-2">NET CASHFLOW</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({length: 5}).map((_, i) => (
                        <TableRow key={i}>
                            <TableCell colSpan={4} className="p-2"><Skeleton className="h-5" /></TableCell>
                        </TableRow>
                    ))
                  ) : data.length > 0 ? (
                    data.map((row) => (
                        <TableRow key={row.month} className="text-xs">
                          <TableCell className="font-medium p-2">{row.monthLabel}</TableCell>
                          <TableCell className="text-right text-green-600 p-2">{formatCurrency(row.inflow)}</TableCell>
                          <TableCell className="text-right text-red-600 p-2">{formatCurrency(row.outflow)}</TableCell>
                          <TableCell className="text-right font-medium p-2">{formatCurrency(row.net)}</TableCell>
                        </TableRow>
                    ))
                  ) : (
                    <TableRow>
                        <TableCell colSpan={4} className="text-center h-24">No transaction data found.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
