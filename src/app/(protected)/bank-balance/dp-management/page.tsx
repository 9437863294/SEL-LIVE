'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  ShieldAlert,
} from 'lucide-react';
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
import {
  collection,
  getDocs,
  doc,
  updateDoc,
} from 'firebase/firestore';
import type {
  BankAccount,
  DpLogEntry,
} from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, subDays } from 'date-fns';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useAuthorization } from '@/hooks/useAuthorization';
import { getEffectiveCcLimitFromEntry } from '@/lib/bank-balance-limit';

export default function DpManagementPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } =
    useAuthorization();

  const [accounts, setAccounts] =
    useState<BankAccount[]>([]);
  const [newDpEntries, setNewDpEntries] =
    useState<
      Record<
        string,
        {
          fromDate: string;
          amount: string;
          todAmount: string;
        }
      >
    >({});
  const [isLoading, setIsLoading] =
    useState(true);
  const [isSaving, setIsSaving] =
    useState<Record<string, boolean>>({});
  const [openAddForm, setOpenAddForm] =
    useState<string | null>(null);

  const canView =
    !authLoading &&
    can(
      'View',
      'Bank Balance.DP Management'
    );
  const canAdd =
    !authLoading &&
    can(
      'Add',
      'Bank Balance.DP Management'
    );
  const canDelete =
    !authLoading &&
    can(
      'Delete',
      'Bank Balance.DP Management'
    );

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(
        collection(db, 'bankAccounts')
      );
      const allAccounts = snap.docs.map(
        (d) =>
          ({
            id: d.id,
            ...d.data(),
          } as BankAccount)
      );

      const ccAccounts = allAccounts
        .filter(
          (acc) =>
            acc.accountType ===
            'Cash Credit'
        )
        .map((acc) => ({
          ...acc,
          drawingPower: Array.isArray(
            acc.drawingPower
          )
            ? [...acc.drawingPower].sort(
                (a, b) =>
                  new Date(
                    b.fromDate
                  ).getTime() -
                  new Date(
                    a.fromDate
                  ).getTime()
              )
            : [],
        }));

      setAccounts(ccAccounts);
    } catch (error) {
      console.error(
        'Error fetching accounts: ',
        error
      );
      toast({
        title: 'Error',
        description:
          'Failed to fetch bank accounts.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;

    if (!canView) {
      setIsLoading(false);
      return;
    }

    void fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const handleNewDpChange = (
    accountId: string,
    field:
      | 'fromDate'
      | 'amount'
      | 'todAmount',
    value: string
  ) => {
    setNewDpEntries((prev) => ({
      ...prev,
      [accountId]: {
        ...(prev[accountId] ?? {
          fromDate: '',
          amount: '',
          todAmount: '',
        }),
        [field]: value,
      },
    }));
  };

  const handleAddDp = async (
    accountId: string
  ) => {
    const newEntry =
      newDpEntries[accountId];

    if (
      !newEntry ||
      !newEntry.fromDate ||
      !newEntry.amount
    ) {
      toast({
        title: 'Validation Error',
        description:
          'Please provide both a date and an amount.',
        variant: 'destructive',
      });
      return;
    }

    const account = accounts.find(
      (acc) => acc.id === accountId
    );
    if (!account) return;

    setIsSaving((prev) => ({
      ...prev,
      [accountId]: true,
    }));

    const updatedDpLog: DpLogEntry[] = [
      ...(account.drawingPower ?? []),
    ];

    // Close previous open-ended entry
    const latestEntry =
      updatedDpLog.find(
        (entry) =>
          entry.toDate === null
      );
    if (latestEntry) {
      latestEntry.toDate = format(
        subDays(
          new Date(newEntry.fromDate),
          1
        ),
        'yyyy-MM-dd'
      );
    }

    // Add new entry
    updatedDpLog.push({
      id:
        globalThis.crypto
          ?.randomUUID?.() ??
        `${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`,
      fromDate: newEntry.fromDate,
      toDate: null,
      amount: parseFloat(
        newEntry.amount
      ),
      odAmount: 0,
      todAmount: parseFloat(
        newEntry.todAmount || '0'
      ),
    });

    updatedDpLog.sort(
      (a, b) =>
        new Date(
          b.fromDate
        ).getTime() -
        new Date(
          a.fromDate
        ).getTime()
    );

    try {
      await updateDoc(
        doc(
          db,
          'bankAccounts',
          accountId
        ),
        { drawingPower: updatedDpLog }
      );

      toast({
        title: 'Success',
        description:
          'Limit log updated successfully.',
      });

      setAccounts((prev) =>
        prev.map((acc) =>
          acc.id === accountId
            ? {
                ...acc,
                drawingPower:
                  updatedDpLog,
              }
            : acc
        )
      );

      setNewDpEntries((prev) => ({
        ...prev,
        [accountId]: {
          fromDate: '',
          amount: '',
          todAmount: '',
        },
      }));

      setOpenAddForm(null);
    } catch (error) {
      console.error(
        'Error saving new DP entry:',
        error
      );
      toast({
        title: 'Error',
        description:
          'Failed to save new DP entry.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving((prev) => ({
        ...prev,
        [accountId]: false,
      }));
    }
  };

  const handleDeleteDp = async (
    accountId: string,
    entryToDelete: DpLogEntry
  ) => {
    const account = accounts.find(
      (acc) => acc.id === accountId
    );
    if (!account) return;

    setIsSaving((prev) => ({
      ...prev,
      [accountId]: true,
    }));

    let updatedDpLog =
      (account.drawingPower ?? []).filter(
        (entry) =>
          entry.id !==
          entryToDelete.id
      );

    // If deleting the latest entry, make new latest open-ended
    if (entryToDelete.toDate === null) {
      updatedDpLog = [
        ...updatedDpLog,
      ].sort(
        (a, b) =>
          new Date(
            b.fromDate
          ).getTime() -
          new Date(
            a.fromDate
          ).getTime()
      );
      if (updatedDpLog[0]) {
        updatedDpLog[0].toDate = null;
      }
    }

    try {
      await updateDoc(
        doc(
          db,
          'bankAccounts',
          accountId
        ),
        { drawingPower: updatedDpLog }
      );

      toast({
        title: 'Success',
        description:
          'DP entry deleted.',
      });

      setAccounts((prev) =>
        prev.map((acc) =>
          acc.id === accountId
            ? {
                ...acc,
                drawingPower:
                  updatedDpLog,
              }
            : acc
        )
      );
    } catch (error) {
      console.error(
        'Error deleting DP entry:',
        error
      );
      toast({
        title: 'Error',
        description:
          'Failed to delete DP entry.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving((prev) => ({
        ...prev,
        [accountId]: false,
      }));
    }
  };

  // Loading state
  if (authLoading || (isLoading && canView)) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    );
  }

  // No permission
  if (!canView) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">DP Management</h1>
        </div>
        <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  // Page
  return (
    <>
      {/* ── Animated Background (Purple theme for DP Management) ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-50/60 via-background to-violet-50/40 dark:from-purple-950/20 dark:via-background dark:to-violet-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-purple-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-violet-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(168,85,247,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>
    <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
      <div className="mb-5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-purple-50 dark:hover:bg-purple-950/30" aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">DP Management</h1>
            <p className="text-xs text-muted-foreground">Manage dated limits for Cash Credit accounts using DP and temporary overdrawn amount.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isLoading ? (
          Array.from({ length: 2 }).map(
            (_, i) => (
              <Skeleton
                key={i}
                className="h-96"
              />
            )
          )
        ) : accounts.length >
          0 ? (
          accounts.map((acc) => (
            <Collapsible
              asChild
              key={acc.id}
              open={
                openAddForm === acc.id
              }
              onOpenChange={(
                isOpen
              ) =>
                setOpenAddForm(
                  isOpen
                    ? acc.id
                    : null
                )
              }
            >
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle>
                        {acc.bankName} (
                        {acc.shortName})
                      </CardTitle>
                      <CardDescription>
                        {
                          acc.accountNumber
                        }
                      </CardDescription>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={!canAdd}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add New Limit Entry
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </CardHeader>
                <CardContent>
                  <CollapsibleContent className="mb-4">
                    <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-end">
                      <div className="flex-1 space-y-1">
                        <label
                          htmlFor={`date-${acc.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Effective
                          From
                        </label>
                        <Input
                          id={`date-${acc.id}`}
                          type="date"
                          value={
                            newDpEntries[
                              acc.id
                            ]
                              ?.fromDate ||
                            ''
                          }
                          onChange={(
                            e
                          ) =>
                            handleNewDpChange(
                              acc.id,
                              'fromDate',
                              e
                                .target
                                .value
                            )
                          }
                        />
                      </div>
                      <div className="flex-1 space-y-1">
                        <label
                          htmlFor={`amount-${acc.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          DP
                        </label>
                        <Input
                          id={`amount-${acc.id}`}
                          type="number"
                          placeholder="DP"
                          value={
                            newDpEntries[
                              acc.id
                            ]
                              ?.amount ||
                            ''
                          }
                          onChange={(
                            e
                          ) =>
                            handleNewDpChange(
                              acc.id,
                              'amount',
                              e
                                .target
                                .value
                            )
                          }
                        />
                      </div>
                      <div className="flex-1 space-y-1">
                        <label
                          htmlFor={`tod-${acc.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          TOD
                        </label>
                        <Input
                          id={`tod-${acc.id}`}
                          type="number"
                          placeholder="Temporary Overdrawn"
                          value={
                            newDpEntries[
                              acc.id
                            ]
                              ?.todAmount ||
                            ''
                          }
                          onChange={(
                            e
                          ) =>
                            handleNewDpChange(
                              acc.id,
                              'todAmount',
                              e
                                .target
                                .value
                            )
                          }
                        />
                      </div>
                      <Button
                        onClick={() =>
                          handleAddDp(
                            acc.id
                          )
                        }
                        disabled={
                          isSaving[
                            acc.id
                          ]
                        }
                      >
                        {isSaving[
                          acc.id
                        ] ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="mr-2 h-4 w-4" />
                        )}
                        Add
                      </Button>
                    </div>
                  </CollapsibleContent>

                  <h4 className="font-semibold mb-2">
                    Limit History
                  </h4>
                  <div className="border rounded-md max-h-60 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            Effective
                            From
                          </TableHead>
                          <TableHead>
                            Effective
                            To
                          </TableHead>
                          <TableHead>
                            DP
                          </TableHead>
                          <TableHead>
                            TOD
                          </TableHead>
                          <TableHead>
                            Total Limit
                          </TableHead>
                          <TableHead className="text-right">
                            Action
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {acc.drawingPower &&
                        acc
                          .drawingPower
                          .length >
                          0 ? (
                          acc.drawingPower.map(
                            (
                              dp
                            ) => (
                              <TableRow
                                key={
                                  dp.id
                                }
                              >
                                <TableCell>
                                  {dp.fromDate
                                    ? format(
                                        new Date(
                                          dp.fromDate
                                        ),
                                        'dd MMM, yyyy'
                                      )
                                    : 'N/A'}
                                </TableCell>
                                <TableCell>
                                  {dp.toDate
                                    ? format(
                                        new Date(
                                          dp.toDate
                                        ),
                                        'dd MMM, yyyy'
                                      )
                                    : 'Current'}
                                </TableCell>
                                <TableCell>
                                  {new Intl.NumberFormat(
                                    'en-IN',
                                    {
                                      style:
                                        'currency',
                                      currency:
                                        'INR',
                                    }
                                  ).format(
                                    (dp.amount ||
                                      0) +
                                      (dp.odAmount ||
                                        0)
                                  )}
                                </TableCell>
                                <TableCell>
                                  {new Intl.NumberFormat(
                                    'en-IN',
                                    {
                                      style:
                                        'currency',
                                      currency:
                                        'INR',
                                    }
                                  ).format(
                                    dp.todAmount ||
                                      0
                                  )}
                                </TableCell>
                                <TableCell className="font-medium">
                                  {new Intl.NumberFormat(
                                    'en-IN',
                                    {
                                      style:
                                        'currency',
                                      currency:
                                        'INR',
                                    }
                                  ).format(
                                    getEffectiveCcLimitFromEntry(
                                      dp
                                    )
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive"
                                    onClick={() =>
                                      handleDeleteDp(
                                        acc.id,
                                        dp
                                      )
                                    }
                                    disabled={
                                      !canDelete ||
                                      (acc.drawingPower?.length ??
                                        0) <=
                                        1
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          )
                        ) : (
                          <TableRow>
                            <TableCell
                              colSpan={
                                6
                              }
                              className="text-center h-24"
                            >
                              No
                              limit
                              history.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </Collapsible>
          ))
        ) : (
          <Card className="col-span-full">
            <CardContent className="text-center p-12 text-muted-foreground">
              No Cash Credit accounts
              found.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
    </>
  );
}
