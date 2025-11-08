'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
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
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';

interface BankPosition {
  id: string;
  bankName: string;
  shortName: string;
  accountNumber: string;
  accountType: string;
  closingBalance: number; // For CC: utilization; For Current: positive balance
}

export default function BankPositionReportPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [bankPositions, setBankPositions] = useState<BankPosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canView = can('View', 'Bank Balance.Reports');

  useEffect(() => {
    const fetchAndCalculatePositions = async () => {
      setIsLoading(true);
      try {
        const [accountsSnap, expensesSnap] = await Promise.all([
          getDocs(query(collection(db, 'bankAccounts'), orderBy('bankName'))),
          getDocs(collection(db, 'bankExpenses')),
        ]);

        const accounts = accountsSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as BankAccount)
        );
        const transactions = expensesSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as BankExpense)
        );

        const positions: BankPosition[] = accounts.map((account) => {
          const isCC = account.accountType === 'Cash Credit';

          // Starting point
          let closingBalance = isCC
            ? account.openingUtilization || 0
            : account.openingBalance || 0;

          const accountTransactions = transactions
            .filter((t) => t.accountId === account.id)
            .sort((a, b) => a.date.toMillis() - b.date.toMillis());

          accountTransactions.forEach((t) => {
            const amt = t.amount || 0;

            if (isCC) {
              // For Cash Credit, we treat balance as UTILIZATION:
              // Debit -> utilization increases, Credit -> utilization decreases
              if (t.type === 'Debit') {
                closingBalance += amt;
              } else if (t.type === 'Credit') {
                closingBalance -= amt;
              }
            } else {
              // For Current / non-CC: standard bank balance
              // Debit -> outflow, Credit -> inflow
              if (t.type === 'Debit') {
                closingBalance -= amt;
              } else if (t.type === 'Credit') {
                closingBalance += amt;
              }
            }
          });

          return {
            id: account.id,
            bankName: account.bankName,
            shortName: account.shortName,
            accountNumber: account.accountNumber,
            accountType: account.accountType,
            closingBalance,
          };
        });

        setBankPositions(positions);
      } catch (error) {
        console.error('Error calculating bank positions:', error);
        toast({
          title: 'Error',
          description: 'Failed to calculate bank positions.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    if (!authLoading && canView) {
      void fetchAndCalculatePositions();
    } else if (!authLoading && !canView) {
      setIsLoading(false);
    }
  }, [authLoading, canView, toast]);

  const grandTotal = useMemo(
    () => bankPositions.reduce((sum, pos) => sum + pos.closingBalance, 0),
    [bankPositions]
  );

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount || 0);

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance/reports">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Bank Position Report</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to view this page.
            </CardDescription>
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
        <div className="flex items-center gap-2">
          <Link href="/bank-balance/reports">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Bank Position Report</h1>
            <p className="text-sm text-muted-foreground">
              Summary of balances across all bank accounts as of today.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {format(new Date(), 'MMMM do, yyyy')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Bank Positions</CardTitle>
          <CardDescription>
            Calculated from opening balances/utilizations and all ledger entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank Name</TableHead>
                <TableHead>Short Name</TableHead>
                <TableHead>Account No.</TableHead>
                <TableHead>Account Type</TableHead>
                <TableHead className="text-right">Closing Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : bankPositions.length > 0 ? (
                bankPositions.map((pos) => (
                  <TableRow key={pos.id}>
                    <TableCell className="font-medium">
                      {pos.bankName}
                    </TableCell>
                    <TableCell>{pos.shortName}</TableCell>
                    <TableCell>{pos.accountNumber}</TableCell>
                    <TableCell>{pos.accountType}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(pos.closingBalance)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center h-24"
                  >
                    No bank accounts found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            <TableFooter>
              <TableRow className="bg-muted/50">
                <TableCell
                  colSpan={4}
                  className="text-right font-bold text-lg"
                >
                  Grand Total
                </TableCell>
                <TableCell className="text-right font-bold text-lg">
                  {formatCurrency(grandTotal)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
