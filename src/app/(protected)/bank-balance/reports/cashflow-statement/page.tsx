'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
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
import type { BankExpense, BankAccount } from '@/lib/types';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachMonthOfInterval,
} from 'date-fns';
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
        const [expensesSnap, accountsSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, 'bankExpenses'),
              where('isContra', '==', false)
            )
          ),
          getDocs(collection(db, 'bankAccounts')),
        ]);

        const transactions = expensesSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as BankExpense)
        );
        const accounts = accountsSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as BankAccount)
        );

        if (transactions.length === 0) {
          setData([]);
          setIsLoading(false);
          return;
        }

        // Sort by date ascending
        transactions.sort(
          (a, b) => a.date.toMillis() - b.date.toMillis()
        );

        const firstDate = transactions[0].date.toDate();
        const lastDate =
          transactions[transactions.length - 1].date.toDate();

        const interval = {
          start: startOfMonth(firstDate),
          end: endOfMonth(lastDate),
        };
        const monthsInInterval = eachMonthOfInterval(interval);

        // Map for quick account lookup
        const accountMap = new Map<string, BankAccount>();
        accounts.forEach((acc) => accountMap.set(acc.id, acc));

        // Initial opening balance across all accounts:
        // - Current / others: +openingBalance
        // - Cash Credit: -openingUtilization (treated as overdraft)
        let runningBalance = accounts.reduce((sum, acc) => {
          if (acc.accountType === 'Cash Credit') {
            return sum - (acc.openingUtilization || 0);
          }
          return sum + (acc.openingBalance || 0);
        }, 0);

        const firstMonthStart = startOfMonth(firstDate);

        // Apply all non-contra flows before firstMonthStart to get true opening
        const preTransactions = transactions.filter(
          (t) => t.date.toDate() < firstMonthStart
        );

        preTransactions.forEach((t) => {
          // We already encoded CC as negative in opening, so:
          // Credit = inflow (+), Debit = outflow (-) globally
          runningBalance += t.type === 'Credit' ? t.amount : -t.amount;
        });

        // Build monthly rows
        const monthlyData: MonthlyData[] = monthsInInterval.map(
          (monthStart) => {
            const monthString = format(monthStart, 'yyyy-MM');
            const monthLabel = format(monthStart, 'MMMM yyyy');

            const monthTransactions = transactions.filter(
              (t) =>
                format(t.date.toDate(), 'yyyy-MM') === monthString
            );

            const inflow = monthTransactions
              .filter((t) => t.type === 'Credit')
              .reduce((sum, t) => sum + t.amount, 0);

            const outflow = monthTransactions
              .filter((t) => t.type === 'Debit')
              .reduce((sum, t) => sum + t.amount, 0);

            const net = inflow - outflow;
            const openingBalance = runningBalance;
            const closingBalance = openingBalance + net;

            // Prepare for next month
            runningBalance = closingBalance;

            return {
              month: monthString,
              monthLabel,
              openingBalance,
              inflow,
              outflow,
              net,
              closingBalance,
            };
          }
        );

        // Show most recent first
        setData(monthlyData.reverse());
      } catch (error: any) {
        console.error('Error fetching cashflow data:', error);
        if (error.code === 'failed-precondition') {
          toast({
            title: 'Database Index Required',
            description:
              "This query may require a custom index. Please create it in the Firebase console for the 'bankExpenses' collection.",
            variant: 'destructive',
            duration: 10000,
          });
        } else {
          toast({
            title: 'Error',
            description: 'Failed to fetch transaction data.',
            variant: 'destructive',
          });
        }
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();
  }, [toast]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value || 0);

  const totalInflow = data.reduce((s, m) => s + m.inflow, 0);
  const totalOutflow = data.reduce((s, m) => s + m.outflow, 0);
  const totalNet = data.reduce((s, m) => s + m.net, 0);

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/bank-balance/reports">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Cashflow Statement</h1>
          <p className="text-sm text-muted-foreground">
            Monthly inflow vs outflow across all non-contra transactions.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly Cashflow</CardTitle>
          <CardDescription>
            Based on bankExpenses (excluding contra) and opening balances /
            utilizations.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold text-xs p-2">
                    MONTH
                  </TableHead>
                  <TableHead className="text-right font-bold text-xs p-2">
                    INFLOW (RECEIPTS)
                  </TableHead>
                  <TableHead className="text-right font-bold text-xs p-2">
                    OUTFLOW (PAYMENTS)
                  </TableHead>
                  <TableHead className="text-right font-bold text-xs p-2">
                    NET CASHFLOW
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4} className="p-2">
                        <Skeleton className="h-5" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data.length > 0 ? (
                  data.map((row) => (
                    <TableRow key={row.month} className="text-xs">
                      <TableCell className="font-medium p-2">
                        {row.monthLabel}
                      </TableCell>
                      <TableCell className="text-right text-green-600 p-2">
                        {formatCurrency(row.inflow)}
                      </TableCell>
                      <TableCell className="text-right text-red-600 p-2">
                        {formatCurrency(row.outflow)}
                      </TableCell>
                      <TableCell className="text-right font-medium p-2">
                        {formatCurrency(row.net)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center h-24"
                    >
                      No transaction data found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {!isLoading && data.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold text-xs p-2">
                      TOTAL
                    </TableCell>
                    <TableCell className="text-right font-bold text-xs p-2 text-green-700">
                      {formatCurrency(totalInflow)}
                    </TableCell>
                    <TableCell className="text-right font-bold text-xs p-2 text-red-700">
                      {formatCurrency(totalOutflow)}
                    </TableCell>
                    <TableCell className="text-right font-bold text-xs p-2">
                      {formatCurrency(totalNet)}
                    </TableCell>
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
