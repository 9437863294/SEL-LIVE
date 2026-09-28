'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/shared/page-header';
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
import { TableCard } from '@/components/shared/table-card';
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
import { useAuthorization } from '@/hooks/useAuthorization';
import { ShieldAlert } from 'lucide-react';

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
  const { can, isLoading: authLoading } = useAuthorization();
  const [data, setData] = useState<MonthlyData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const canView = can('View', 'Bank Balance.Reports');

  useEffect(() => {
    if (authLoading) {
      return;
    }

    const fetchData = async () => {
      if (!canView) {
        setIsLoading(false);
        return;
      }

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
  }, [authLoading, canView, toast]);

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

  if (authLoading || (isLoading && canView)) {
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
        <PageHeader title="Cashflow Statement" backHref="/bank-balance/reports" backLabel="Back to reports" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this report.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 via-background to-teal-50/40 dark:from-emerald-950/20 dark:via-background dark:to-teal-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-emerald-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-teal-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(16,185,129,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>
    <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
      <PageHeader
        title="Cashflow Statement"
        description="Monthly inflow vs outflow across all non-contra transactions."
        backHref="/bank-balance/reports"
        backLabel="Back to reports"
      />

      <TableCard
        title="Monthly Cashflow"
        description="Based on bankExpenses (excluding contra) and opening balances / utilizations."
        count={data.length}
        noun="month"
      >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    MONTH
                  </TableHead>
                  <TableHead className="text-right">
                    INFLOW (RECEIPTS)
                  </TableHead>
                  <TableHead className="text-right">
                    OUTFLOW (PAYMENTS)
                  </TableHead>
                  <TableHead className="text-right">
                    NET CASHFLOW
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-5" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data.length > 0 ? (
                  data.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {row.monthLabel}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-green-600">
                        {formatCurrency(row.inflow)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-red-600">
                        {formatCurrency(row.outflow)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
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
                    <TableCell>
                      TOTAL
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-green-700">
                      {formatCurrency(totalInflow)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-red-700">
                      {formatCurrency(totalOutflow)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatCurrency(totalNet)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
      </TableCard>
    </div>
    </>
  );
}
