'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, ShieldAlert, Edit } from 'lucide-react';

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
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import type { BankAccount } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

type UtilizationData = {
  amount: number;
  date: string;
};

export default function OpeningUtilizationPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [utilizations, setUtilizations] = useState<
    Record<string, UtilizationData>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const canView = can('View', 'Bank Balance.Opening Utilization');
  const canEdit = can('Edit', 'Bank Balance.Opening Utilization');

  const fetchAccounts = useCallback(async () => {
    if (!canView) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'bankAccounts'));
      const allAccounts = snapshot.docs.map(
        (d) => ({ id: d.id, ...d.data() } as BankAccount)
      );

      const ccAccounts = allAccounts.filter(
        (acc) => acc.accountType === 'Cash Credit'
      );

      setAccounts(ccAccounts);

      const initialUtils = ccAccounts.reduce(
        (acc, account) => {
          acc[account.id] = {
            amount: account.openingUtilization || 0,
            date: account.openingDate || '',
          };
          return acc;
        },
        {} as Record<string, UtilizationData>
      );

      setUtilizations(initialUtils);
    } catch (error) {
      console.error('Error fetching accounts:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch bank accounts.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [canView, toast]);

  useEffect(() => {
    if (!authLoading) {
      void fetchAccounts();
    }
  }, [authLoading, fetchAccounts]);

  const handleUtilizationChange = (
    accountId: string,
    field: 'amount' | 'date',
    value: string
  ) => {
    setUtilizations((prev) => {
      const existing = prev[accountId] || { amount: 0, date: '' };

      if (field === 'amount') {
        const parsed = parseFloat(value);
        return {
          ...prev,
          [accountId]: {
            ...existing,
            amount: Number.isNaN(parsed) ? 0 : parsed,
          },
        };
      }

      return {
        ...prev,
        [accountId]: {
          ...existing,
          date: value,
        },
      };
    });
  };

  const handleSaveAll = async () => {
    if (!canEdit) {
      toast({
        title: 'Not allowed',
        description:
          'You do not have permission to edit opening utilization.',
        variant: 'destructive',
      });
      return;
    }

    if (accounts.length === 0) {
      toast({
        title: 'No accounts',
        description: 'There are no Cash Credit accounts to update.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const batch = writeBatch(db);

      accounts.forEach((acc) => {
        const utilData = utilizations[acc.id] || {
          amount: 0,
          date: '',
        };

        const ref = doc(db, 'bankAccounts', acc.id);

        batch.update(ref, {
          openingUtilization: utilData.amount,
          openingDate: utilData.date || null,
        });
      });

      await batch.commit();

      toast({
        title: 'Success',
        description:
          'All opening utilizations have been saved.',
      });

      setIsEditing(false);
      void fetchAccounts();
    } catch (error) {
      console.error('Error saving utilizations:', error);
      toast({
        title: 'Error',
        description:
          'Failed to save opening utilizations.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">
            Opening Utilization
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              Access Denied
            </CardTitle>
            <CardDescription>
              You do not have permission
              to view this page.
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
      <div className="mb-6 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              Opening Utilization
            </h1>
            <p className="text-muted-foreground">
              Manage opening utilization
              for Cash Credit accounts.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <Button
              onClick={handleSaveAll}
              disabled={isSaving || !canEdit}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save All
            </Button>
          ) : (
            <Button
              onClick={() => setIsEditing(true)}
              disabled={!canEdit}
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Cash Credit Accounts
          </CardTitle>
          <CardDescription>
            Enter the opening
            utilization values and
            dates for each account.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  Bank Name
                </TableHead>
                <TableHead>
                  Account No.
                </TableHead>
                <TableHead className="w-[200px]">
                  Opening Date
                </TableHead>
                <TableHead className="w-[250px]">
                  Opening
                  Utilization
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length > 0 ? (
                accounts.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell className="font-medium">
                      {acc.bankName} (
                      {acc.shortName})
                    </TableCell>
                    <TableCell>
                      {
                        acc.accountNumber
                      }
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        value={
                          utilizations[
                            acc.id
                          ]?.date ||
                          ''
                        }
                        onChange={(
                          e
                        ) =>
                          handleUtilizationChange(
                            acc.id,
                            'date',
                            e
                              .target
                              .value
                          )
                        }
                        disabled={
                          !isEditing
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={
                          utilizations[
                            acc.id
                          ]
                            ?.amount ??
                          0
                        }
                        onChange={(
                          e
                        ) =>
                          handleUtilizationChange(
                            acc.id,
                            'amount',
                            e
                              .target
                              .value
                          )
                        }
                        placeholder="Enter amount"
                        disabled={
                          !isEditing
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={
                      4
                    }
                    className="text-center h-24"
                  >
                    No Cash
                    Credit
                    accounts
                    found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
