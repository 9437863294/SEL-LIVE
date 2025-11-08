'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Edit, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
} from 'firebase/firestore';
import type {
  BankAccount,
  BankExpense,
  MonthlyInterestData,
} from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import {
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
  eachDayOfInterval,
  compareDesc,
  parse,
  subMonths as dfSubMonths,
} from 'date-fns';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuthorization } from '@/hooks/useAuthorization';

interface MonthlyLogEntry {
  month: string; // "yyyy-MM"
  accountId: string;
  accountName: string;
  projected: number;
  actual: number;
  difference: number;
}

export default function MonthlyInterestPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [interestData, setInterestData] = useState<MonthlyInterestData>({});
  const [initialInterestData, setInitialInterestData] =
    useState<MonthlyInterestData>({});
  const [selectedMonth, setSelectedMonth] = useState(
    format(new Date(), 'yyyy-MM')
  );

  const [isLoading, setIsLoading] = useState(true);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [logData, setLogData] = useState<MonthlyLogEntry[]>([]);

  const [logFilters, setLogFilters] = useState({
    year: 'all',
    month: 'all',
    bank: 'all',
  });
  const [activeTab, setActiveTab] = useState<'entry' | 'log'>('entry');

  const canView = can('View', 'Bank Balance.Monthly Interest');
  const canEdit = can('Edit', 'Bank Balance.Monthly Interest');

  const ccAccounts = useMemo(
    () => accounts.filter((acc) => acc.accountType === 'Cash Credit'),
    [accounts]
  );

  const hasUnsavedChanges = useMemo(
    () =>
      JSON.stringify(interestData) !==
      JSON.stringify(initialInterestData),
    [interestData, initialInterestData]
  );

  const fetchBaseData = useCallback(async () => {
    if (!canView) {
      setIsLoading(false);
      setIsLogLoading(false);
      return;
    }

    setIsLoading(true);
    setIsLogLoading(true);

    try {
      const [accountsSnap, expensesSnap, monthlyInterestSnap] =
        await Promise.all([
          getDocs(collection(db, 'bankAccounts')),
          getDocs(collection(db, 'bankExpenses')),
          getDocs(collection(db, 'monthlyInterest')),
        ]);

      const fetchedAccounts = accountsSnap.docs
        .map(
          (d) => ({ id: d.id, ...d.data() } as BankAccount)
        )
        .sort((a, b) =>
          (a.shortName || '').localeCompare(b.shortName || '')
        );

      setAccounts(fetchedAccounts);

      const expenses = expensesSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as BankExpense)
      );
      setAllTransactions(expenses);

      // Build log data from monthlyInterest docs
      const accountsMap = new Map(
        fetchedAccounts.map((acc) => [acc.id, acc.shortName])
      );

      const rawLogData: MonthlyLogEntry[] = [];
      monthlyInterestSnap.forEach((docSnap) => {
        const monthKey = docSnap.id; // "yyyy-MM"
        const data = docSnap.data() as MonthlyInterestData;

        Object.entries(data).forEach(([accountId, values]) => {
          const projected = values.projected || 0;
          const actual = values.actual || 0;
          rawLogData.push({
            month: monthKey,
            accountId,
            accountName:
              accountsMap.get(accountId) || 'Unknown',
            projected,
            actual,
            difference: actual - projected,
          });
        });
      });

      rawLogData.sort((a, b) =>
        compareDesc(
          parse(a.month, 'yyyy-MM', new Date()),
          parse(b.month, 'yyyy-MM', new Date())
        )
      );

      setLogData(rawLogData);
    } catch (error) {
      console.error('Error fetching base data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load accounts and interest data.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setIsLogLoading(false);
    }
  }, [canView, toast]);

  useEffect(() => {
    if (!authLoading) {
      void fetchBaseData();
    }
  }, [authLoading, fetchBaseData]);

  // Compute projected interest for selected month
  const calculatedProjectedInterest = useMemo(() => {
    const monthData: Record<string, number> = {};

    if (!canView || isLoading || ccAccounts.length === 0) {
      return monthData;
    }

    const [year, month] = selectedMonth
      .split('-')
      .map((n) => Number(n));
    const monthStart = startOfMonth(new Date(year, month - 1));
    const monthEnd = endOfMonth(new Date(year, month - 1));

    ccAccounts.forEach((account) => {
      if (!account.openingDate) {
        monthData[account.id] = 0;
        return;
      }

      const openingDate = new Date(account.openingDate);
      if (monthEnd < openingDate) {
        monthData[account.id] = 0;
        return;
      }

      let runningBalance =
        account.openingUtilization || 0;

      const getRateForDate = (date: Date): number => {
        const sortedLog = [...(account.interestRateLog || [])].sort(
          (a, b) =>
            compareDesc(
              new Date(a.fromDate),
              new Date(b.fromDate)
            )
        );
        // Use latest entry with fromDate <= date (ignoring toDate for simplicity)
        const rateEntry = sortedLog.find(
          (entry) =>
            new Date(entry.fromDate) <= date
        );
        return rateEntry ? rateEntry.rate : 0;
      };

      // Apply all days from openingDate until the day before selected month
      const preEnd = new Date(monthStart);
      preEnd.setDate(preEnd.getDate() - 1);

      if (preEnd >= openingDate) {
        const preDays = eachDayOfInterval({
          start: openingDate,
          end: preEnd,
        });

        preDays.forEach((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const txToday = allTransactions.filter(
            (t) =>
              t.accountId === account.id &&
              format(t.date.toDate(), 'yyyy-MM-dd') === key
          );

          const receipts = txToday
            .filter(
              (t) => t.type === 'Credit' && !t.isContra
            )
            .reduce(
              (sum, t) => sum + t.amount,
              0
            );
          const expenses = txToday
            .filter(
              (t) => t.type === 'Debit' && !t.isContra
            )
            .reduce(
              (sum, t) => sum + t.amount,
              0
            );
          const contra = txToday
            .filter((t) => t.isContra)
            .reduce(
              (sum, t) =>
                sum +
                (t.type === 'Debit'
                  ? -t.amount
                  : t.amount),
              0
            );

          const closing = runningBalance +
            receipts -
            expenses +
            contra;
          runningBalance = closing;
        });
      }

      // Now calculate interest within selected month
      let monthInterest = 0;
      const days = eachDayOfInterval({
        start: monthStart,
        end: monthEnd,
      });

      days.forEach((day) => {
        if (day < openingDate) return;

        const key = format(day, 'yyyy-MM-dd');
        const txToday = allTransactions.filter(
          (t) =>
            t.accountId === account.id &&
            format(t.date.toDate(), 'yyyy-MM-dd') === key
        );

        const receipts = txToday
          .filter(
            (t) => t.type === 'Credit' && !t.isContra
          )
          .reduce(
            (sum, t) => sum + t.amount,
            0
          );
        const expenses = txToday
          .filter(
            (t) => t.type === 'Debit' && !t.isContra
          )
          .reduce(
            (sum, t) => sum + t.amount,
            0
          );
        const contra = txToday
          .filter((t) => t.isContra)
          .reduce(
            (sum, t) =>
              sum +
              (t.type === 'Debit'
                ? -t.amount
                : t.amount),
            0
          );

        const closing =
          runningBalance +
          receipts -
          expenses +
          contra;
        const rate = getRateForDate(day);
        const dailyInterest =
          (closing * (rate / 100)) / 365;

        monthInterest += dailyInterest;
        runningBalance = closing;
      });

      monthData[account.id] = monthInterest;
    });

    return monthData;
  }, [
    canView,
    isLoading,
    ccAccounts,
    allTransactions,
    selectedMonth,
  ]);

  // Load / hydrate interestData for current month + accounts
  useEffect(() => {
    if (!canView || isLoading) return;

    const load = async () => {
      try {
        const ref = doc(
          db,
          'monthlyInterest',
          selectedMonth
        );
        const snap = await getDoc(ref);
        const existing = snap.exists()
          ? (snap.data() as MonthlyInterestData)
          : {};

        const merged: MonthlyInterestData =
          ccAccounts.reduce(
            (acc, account) => {
              acc[account.id] = {
                projected:
                  calculatedProjectedInterest[
                    account.id
                  ] ?? 0,
                actual:
                  existing[account.id]?.actual ?? 0,
              };
              return acc;
            },
            {} as MonthlyInterestData
          );

        setInterestData(merged);
        setInitialInterestData(
          JSON.parse(JSON.stringify(merged))
        );
      } catch (error) {
        console.error(
          'Error loading month interest data:',
          error
        );
        toast({
          title: 'Error',
          description:
            'Failed to load monthly interest data.',
          variant: 'destructive',
        });
      }
    };

    void load();
  }, [
    canView,
    isLoading,
    selectedMonth,
    ccAccounts,
    calculatedProjectedInterest,
    toast,
  ]);

  const handleInterestChange = (
    accountId: string,
    value: string
  ) => {
    const num = parseFloat(value);
    setInterestData((prev) => ({
      ...prev,
      [accountId]: {
        ...(prev[accountId] || {
          projected: 0,
          actual: 0,
        }),
        actual: Number.isNaN(num) ? 0 : num,
      },
    }));
  };

  const handleSave = async () => {
    if (!canEdit) {
      toast({
        title: 'Not allowed',
        description:
          'You do not have permission to edit monthly interest.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const ref = doc(
        db,
        'monthlyInterest',
        selectedMonth
      );
      await setDoc(ref, interestData, {
        merge: true,
      });

      toast({
        title: 'Success',
        description: 'Monthly interest data saved.',
      });

      setInitialInterestData(
        JSON.parse(
          JSON.stringify(interestData)
        )
      );

      void fetchBaseData(); // refresh log
    } catch (error) {
      console.error('Error saving data:', error);
      toast({
        title: 'Error',
        description:
          'Could not save monthly interest data.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditFromLog = (logItem: MonthlyLogEntry) => {
    setSelectedMonth(logItem.month);
    setActiveTab('entry');
  };

  const monthOptions = Array.from(
    { length: 24 },
    (_, i) => {
      const date = subMonths(new Date(), i);
      return {
        value: format(date, 'yyyy-MM'),
        label: format(date, 'MMMM yyyy'),
      };
    }
  );

  const formatCurrency = (amount: number) => {
    if (Number.isNaN(amount))
      return '₹ 0.00';
    return new Intl.NumberFormat(
      'en-IN',
      {
        style: 'currency',
        currency: 'INR',
      }
    ).format(amount);
  };

  const logYearOptions = useMemo(
    () =>
      [
        ...new Set(
          logData.map(
            (log) => log.month.split('-')[0]
          )
        ),
      ].sort((a, b) =>
        b.localeCompare(a)
      ),
    [logData]
  );

  const logMonthOptions = useMemo(
    () =>
      Array.from(
        { length: 12 },
        (_, i) => ({
          value: String(i + 1).padStart(
            2,
            '0'
          ),
          label: format(
            new Date(0, i),
            'MMMM'
          ),
        })
      ),
    []
  );

  const filteredLogData = useMemo(
    () =>
      logData.filter((log) => {
        const yearMatch =
          logFilters.year === 'all' ||
          log.month.startsWith(
            logFilters.year
          );
        const monthMatch =
          logFilters.month === 'all' ||
          log.month.split('-')[1] ===
            logFilters.month;
        const bankMatch =
          logFilters.bank === 'all' ||
          log.accountId ===
            logFilters.bank;
        return (
          yearMatch &&
          monthMatch &&
          bankMatch
        );
      }),
    [logData, logFilters]
  );

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
        <div className="mb-6 flex items-center gap-4">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              Monthly Interest
            </h1>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              Access Denied
            </CardTitle>
            <CardDescription>
              You do not have
              permission to view this
              page.
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
        <div className="flex items-center gap-4">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              Monthly Interest
            </h1>
            <p className="text-muted-foreground">
              Enter projected vs.
              actual interest for each
              Cash Credit account.
            </p>
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          setActiveTab(
            v as 'entry' | 'log'
          )
        }
      >
        <TabsList className="mb-4">
          <TabsTrigger value="entry">
            Entry
          </TabsTrigger>
          <TabsTrigger value="log">
            Log
          </TabsTrigger>
        </TabsList>

        {/* ENTRY TAB */}
        <TabsContent value="entry">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center gap-4">
                <div className="w-full max-w-xs">
                  <Select
                    value={selectedMonth}
                    onValueChange={
                      setSelectedMonth
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Month" />
                    </SelectTrigger>
                    <SelectContent>
                      {monthOptions.map(
                        (opt) => (
                          <SelectItem
                            key={
                              opt.value
                            }
                            value={
                              opt.value
                            }
                          >
                            {
                              opt.label
                            }
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {hasUnsavedChanges &&
                  canEdit && (
                    <Button
                      onClick={
                        handleSave
                      }
                      disabled={
                        isSaving
                      }
                    >
                      {isSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save Monthly
                      Interest
                    </Button>
                  )}
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-48" />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-4 gap-4 font-semibold text-muted-foreground px-4">
                    <div className="col-span-2">
                      Bank Name
                    </div>
                    <div className="col-span-1">
                      Projected
                      Interest
                    </div>
                    <div className="col-span-1">
                      Actual
                      Interest
                    </div>
                  </div>

                  <div className="divide-y">
                    {ccAccounts.length >
                    0 ? (
                      ccAccounts.map(
                        (
                          account
                        ) => (
                          <div
                            key={
                              account.id
                            }
                            className="grid grid-cols-4 gap-4 items-center py-3 px-4"
                          >
                            <span className="font-medium col-span-2">
                              {
                                account.bankName
                              }{' '}
                              (
                              {
                                account.shortName
                              }
                              )
                            </span>
                            <div className="col-span-1">
                              <Input
                                type="text"
                                value={formatCurrency(
                                  interestData[
                                    account
                                      .id
                                  ]
                                    ?.projected ||
                                    0
                                )}
                                readOnly
                                className="font-medium bg-muted"
                              />
                            </div>
                            <div className="col-span-1">
                              <Input
                                type="number"
                                value={
                                  interestData[
                                    account
                                      .id
                                  ]
                                    ?.actual ??
                                  ''
                                }
                                onChange={(
                                  e
                                ) =>
                                  handleInterestChange(
                                    account.id,
                                    e
                                      .target
                                      .value
                                  )
                                }
                                placeholder="0.00"
                                disabled={
                                  !canEdit
                                }
                              />
                            </div>
                          </div>
                        )
                      )
                    ) : (
                      <p className="text-center text-muted-foreground py-10">
                        No Cash
                        Credit
                        accounts
                        configured.
                      </p>
                    )}
                  </div>

                  {ccAccounts.length >
                    0 && (
                    <div className="grid grid-cols-4 gap-4 font-bold text-lg border-t pt-4 px-4">
                      <span className="col-span-2 text-right">
                        Total
                      </span>
                      <span className="col-span-1">
                        {formatCurrency(
                          Object.values(
                            interestData
                          ).reduce(
                            (
                              sum,
                              d
                            ) =>
                              sum +
                              (d.projected ||
                                0),
                            0
                          )
                        )}
                      </span>
                      <span className="col-span-1">
                        {formatCurrency(
                          Object.values(
                            interestData
                          ).reduce(
                            (
                              sum,
                              d
                            ) =>
                              sum +
                              (d.actual ||
                                0),
                            0
                          )
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* LOG TAB */}
        <TabsContent value="log">
          <Card>
            <CardHeader>
              <CardTitle>
                Monthly Interest
                Log
              </CardTitle>
              <div className="flex flex-wrap gap-4 mt-2">
                <Select
                  value={logFilters.year}
                  onValueChange={(
                    val
                  ) =>
                    setLogFilters(
                      (prev) => ({
                        ...prev,
                        year: val,
                      })
                    )
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Years" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      All
                      Years
                    </SelectItem>
                    {logYearOptions.map(
                      (year) => (
                        <SelectItem
                          key={
                            year
                          }
                          value={
                            year
                          }
                        >
                          {
                            year
                          }
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>

                <Select
                  value={logFilters.month}
                  onValueChange={(
                    val
                  ) =>
                    setLogFilters(
                      (prev) => ({
                        ...prev,
                        month: val,
                      })
                    )
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Months" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      All
                      Months
                    </SelectItem>
                    {logMonthOptions.map(
                      (
                        m
                      ) => (
                        <SelectItem
                          key={
                            m.value
                          }
                          value={
                            m.value
                          }
                        >
                          {
                            m.label
                          }
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>

                <Select
                  value={logFilters.bank}
                  onValueChange={(
                    val
                  ) =>
                    setLogFilters(
                      (prev) => ({
                        ...prev,
                        bank: val,
                      })
                    )
                  }
                >
                  <SelectTrigger className="w-[240px]">
                    <SelectValue placeholder="All Banks" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      All
                      Banks
                    </SelectItem>
                    {ccAccounts.map(
                      (acc) => (
                        <SelectItem
                          key={
                            acc.id
                          }
                          value={
                            acc.id
                          }
                        >
                          {
                            acc.shortName
                          }
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      Month
                    </TableHead>
                    <TableHead>
                      Bank
                    </TableHead>
                    <TableHead>
                      Projected
                    </TableHead>
                    <TableHead>
                      Actual
                    </TableHead>
                    <TableHead>
                      Difference
                    </TableHead>
                    <TableHead className="text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLogLoading ? (
                    Array.from(
                      {
                        length: 5,
                      }
                    ).map(
                      (
                        _,
                        i
                      ) => (
                        <TableRow
                          key={
                            i
                          }
                        >
                          <TableCell colSpan={6}>
                            <Skeleton className="h-6" />
                          </TableCell>
                        </TableRow>
                      )
                    )
                  ) : filteredLogData.length >
                    0 ? (
                    filteredLogData.map(
                      (
                        log
                      ) => (
                        <TableRow
                          key={`${log.month}-${log.accountId}`}
                        >
                          <TableCell>
                            {format(
                              parse(
                                log.month,
                                'yyyy-MM',
                                new Date()
                              ),
                              'MMMM yyyy'
                            )}
                          </TableCell>
                          <TableCell>
                            {
                              log.accountName
                            }
                          </TableCell>
                          <TableCell>
                            {formatCurrency(
                              log.projected
                            )}
                          </TableCell>
                          <TableCell>
                            {formatCurrency(
                              log.actual
                            )}
                          </TableCell>
                          <TableCell
                            className={
                              log.difference >
                              0
                                ? 'text-red-600'
                                : 'text-green-600'
                            }
                          >
                            {formatCurrency(
                              log.difference
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleEditFromLog(
                                  log
                                )
                              }
                              disabled={
                                !canEdit
                              }
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
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
                        No log
                        data
                        found
                        for
                        the
                        selected
                        filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
