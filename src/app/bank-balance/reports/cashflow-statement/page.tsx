
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
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { BankExpense } from '@/lib/types';
import { format, startOfMonth, endOfMonth, eachMonthOfInterval } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';


interface MonthlyData {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
}

export default function CashflowStatementPage() {
  const { toast } = useToast();
  const [data, setData] = useState<MonthlyData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const expensesQuery = query(collection(db, 'bankExpenses'), where('isContra', '==', false));
        const querySnapshot = await getDocs(expensesQuery);
        const transactions = querySnapshot.docs.map(doc => doc.data() as BankExpense);

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

        const monthlyData = monthsInInterval.map(monthStart => {
            const monthString = format(monthStart, 'yyyy-MM');
            const monthLabel = format(monthStart, 'MMMM yyyy');

            const monthTransactions = transactions.filter(t => format(t.date.toDate(), 'yyyy-MM') === monthString);

            const inflow = monthTransactions.filter(t => t.type === 'Credit').reduce((sum, t) => sum + t.amount, 0);
            const outflow = monthTransactions.filter(t => t.type === 'Debit').reduce((sum, t) => sum + t.amount, 0);
            
            return {
                month: monthLabel,
                inflow,
                outflow,
                net: inflow - outflow,
            };
        });

        setData(monthlyData.reverse()); // Show most recent months first

      } catch (error) {
          console.error("Error fetching cashflow data:", error);
          toast({ title: 'Error', description: 'Failed to fetch transaction data.', variant: 'destructive' });
      }
      setIsLoading(false);
    };

    fetchData();
  }, [toast]);
  

  const totals = useMemo(() => {
    return data.reduce((acc, row) => ({
      inflow: acc.inflow + row.inflow,
      outflow: acc.outflow + row.outflow,
      net: acc.net + row.net,
    }), { inflow: 0, outflow: 0, net: 0 });
  }, [data]);


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
        <h1 className="text-2xl font-bold">Cashflow Statement</h1>
      </div>
      <Card>
        <CardHeader>
            <CardTitle>Cashflow Summary</CardTitle>
            <CardDescription>Monthly breakdown of cash inflow and outflow.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-bold">MONTH</TableHead>
                    <TableHead className="text-right font-bold">INFLOW (RECEIPTS)</TableHead>
                    <TableHead className="text-right font-bold">OUTFLOW (PAYMENTS)</TableHead>
                    <TableHead className="text-right font-bold">NET CASHFLOW</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({length: 5}).map((_, i) => (
                        <TableRow key={i}>
                            <TableCell><Skeleton className="h-6" /></TableCell>
                            <TableCell><Skeleton className="h-6" /></TableCell>
                            <TableCell><Skeleton className="h-6" /></TableCell>
                            <TableCell><Skeleton className="h-6" /></TableCell>
                        </TableRow>
                    ))
                  ) : data.length > 0 ? (
                    data.map((row) => (
                        <TableRow key={row.month}>
                        <TableCell className="font-medium">{row.month}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.inflow)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.outflow)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.net)}</TableCell>
                        </TableRow>
                    ))
                  ) : (
                    <TableRow>
                        <TableCell colSpan={4} className="text-center h-24">No transaction data found for the selected period.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
                {!isLoading && data.length > 0 && (
                    <TableFooter>
                        <TableRow className="font-bold bg-muted/50 text-lg">
                            <TableCell>TOTAL</TableCell>
                            <TableCell className="text-right">{formatCurrency(totals.inflow)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(totals.outflow)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(totals.net)}</TableCell>
                        </TableRow>
                    </TableFooter>
                )}
              </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
