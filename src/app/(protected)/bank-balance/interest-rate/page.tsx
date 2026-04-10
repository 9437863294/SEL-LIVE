'use client';
export const dynamic = 'force-dynamic';

import { Fragment, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Calendar as CalendarIcon,
  ShieldAlert,
  Loader2,
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
  BankExpense,
  InterestRateLogEntry,
  MonthlyInterestData,
} from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import {
  format,
  startOfDay,
  endOfDay,
  eachDayOfInterval,
  compareDesc,
  subDays,
} from 'date-fns';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { DateRange } from 'react-day-picker';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  DATE_RANGE_PRESET_OPTIONS,
  type DateRangePreset,
  getDateRangeFromPreset,
} from '@/lib/date-range-presets';

interface DailyInterestLog {
  id: string;
  date: string;
  accountId: string;
  accountName: string;
  closingUtilization: number;
  rate: number;
  dailyInterest: number;
}

interface MonthlySummary {
  monthKey: string; // "yyyy-MM"
  monthLabel: string; // "August 2025"
  banks: {
    accountId: string;
    accountName: string;
    projected: number;
    actual: number;
    diff: number;
  }[];
  totalProjected: number;
  totalActual: number;
  totalDiff: number;
}

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export default function InterestRatePage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [newRateEntries, setNewRateEntries] = useState<
    Record<string, { fromDate: string; rate: string }>
  >({});
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});
  const [openAddForm, setOpenAddForm] = useState<string | null>(null);

  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [monthlyInterestDocs, setMonthlyInterestDocs] = useState<Record<string, MonthlyInterestData>>({});
  const [dailyLogs, setDailyLogs] = useState<DailyInterestLog[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [datePreset, setDatePreset] = useState<DateRangePreset>('custom');
  const [bankFilter, setBankFilter] = useState('all');

  const canView = can('View', 'Bank Balance.Interest Rate');
  const canAdd = can('Add', 'Bank Balance.Interest Rate');
  const canDelete = can('Delete', 'Bank Balance.Interest Rate');

  const fetchData = async () => {
    setIsLoading(true);
    setIsLogLoading(true);
    try {
      const [accountsSnap, expensesSnap, monthlyInterestSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses')),
        getDocs(collection(db, 'monthlyInterest')),
      ]);

      const allAccounts = accountsSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as BankAccount)
      );

      const ccAccounts = allAccounts
        .filter((acc) => acc.accountType === 'Cash Credit')
        .map((acc) => ({
          ...acc,
          interestRateLog: Array.isArray(acc.interestRateLog)
            ? [...acc.interestRateLog].sort(
                (a, b) =>
                  new Date(b.fromDate).getTime() -
                  new Date(a.fromDate).getTime()
              )
            : [],
        }));

      setAccounts(ccAccounts);

      const transactions = expensesSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as BankExpense)
      );
      setAllTransactions(transactions);

      const monthlyInterestMap: Record<string, MonthlyInterestData> = {};
      monthlyInterestSnap.forEach((docSnap) => {
        monthlyInterestMap[docSnap.id] = docSnap.data() as MonthlyInterestData;
      });
      setMonthlyInterestDocs(monthlyInterestMap);
    } catch (error) {
      console.error('Error fetching data: ', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch bank accounts or transactions.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setIsLogLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (canView) {
      void fetchData();
    } else {
      setIsLoading(false);
      setIsLogLoading(false);
    }
  }, [authLoading, canView]);

  useEffect(() => {
    if (isLoading || isLogLoading || !canView) return;

    const logs: DailyInterestLog[] = [];

    accounts.forEach((account) => {
      if (account.accountType !== 'Cash Credit' || !account.openingDate) return;

      let runningBalance = account.openingUtilization || 0;

      const rateLog: InterestRateLogEntry[] = Array.isArray(
        account.interestRateLog
      )
        ? [...account.interestRateLog].sort((a, b) =>
            compareDesc(
              new Date(a.fromDate),
              new Date(b.fromDate)
            )
          )
        : [];

      const getRateForDate = (date: Date): number => {
        if (rateLog.length === 0) return 0;
        const entry = rateLog.find((r) => {
          const from = startOfDay(new Date(r.fromDate));
          const to = r.toDate
            ? endOfDay(new Date(r.toDate))
            : new Date(8640000000000000);
          return date >= from && date <= to;
        });
        return entry ? entry.rate : 0;
      };

      const interval = {
        start: startOfDay(new Date(account.openingDate)),
        end: endOfDay(new Date()),
      };

      const days = eachDayOfInterval(interval);

      days.forEach((day) => {
        const dayString = format(day, 'yyyy-MM-dd');

        const transactionsToday = allTransactions.filter(
          (t) =>
            t.accountId === account.id &&
            format(t.date.toDate(), 'yyyy-MM-dd') === dayString
        );

        const expenses = transactionsToday
          .filter((t) => t.type === 'Debit' && !t.isContra)
          .reduce((sum, t) => sum + t.amount, 0);

        const receipts = transactionsToday
          .filter((t) => t.type === 'Credit' && !t.isContra)
          .reduce((sum, t) => sum + t.amount, 0);

        const contra = transactionsToday
          .filter((t) => t.isContra)
          .reduce(
            (sum, t) =>
              sum + (t.type === 'Debit' ? t.amount : -t.amount),
            0
          );

        // For CC, utilization increases with debit, decreases with credit
        const closingBalance =
          runningBalance + expenses - receipts + contra;

        const rate = getRateForDate(day);
        const dailyInterest = (closingBalance * (rate / 100)) / 365;

        logs.push({
          id: `${dayString}-${account.id}`,
          date: dayString,
          accountId: account.id,
          accountName: account.shortName,
          closingUtilization: closingBalance,
          rate,
          dailyInterest,
        });

        runningBalance = closingBalance;
      });
    });

    logs.sort((a, b) =>
      compareDesc(new Date(a.date), new Date(b.date))
    );
    setDailyLogs(logs);

    // Monthly Summary
    const monthlyProjected: Record<
      string,
      Record<string, { accountName: string; projected: number }>
    > = {};

    logs.forEach((log) => {
      const monthKey = format(new Date(log.date), 'yyyy-MM');
      if (!monthlyProjected[monthKey]) {
        monthlyProjected[monthKey] = {};
      }
      if (!monthlyProjected[monthKey][log.accountId]) {
        monthlyProjected[monthKey][log.accountId] = {
          accountName: log.accountName,
          projected: 0,
        };
      }
      monthlyProjected[monthKey][log.accountId].projected +=
        log.dailyInterest;
    });

    const monthKeys = Array.from(
      new Set([
        ...Object.keys(monthlyProjected),
        ...Object.keys(monthlyInterestDocs),
      ])
    );

    const summary: MonthlySummary[] = monthKeys
      .map((monthKey) => {
        const projectedByAccount = monthlyProjected[monthKey] || {};
        const actualByAccount = monthlyInterestDocs[monthKey] || {};

        const banks = accounts
          .map((acc) => {
            const projected = projectedByAccount[acc.id]?.projected || 0;
            const actual = actualByAccount[acc.id]?.actual || 0;
            return {
              accountId: acc.id,
              accountName: acc.shortName,
              projected,
              actual,
              diff: actual - projected,
            };
          });

        const totalProjected = banks.reduce((sum, b) => sum + b.projected, 0);
        const totalActual = banks.reduce((sum, b) => sum + b.actual, 0);
        const totalDiff = totalActual - totalProjected;

        return {
          monthKey,
          monthLabel: format(new Date(`${monthKey}-01`), 'MMMM yyyy'),
          banks,
          totalProjected,
          totalActual,
          totalDiff,
        };
      })
      // Sort by actual date (1st of that month) desc
      .sort((a, b) =>
        compareDesc(
          new Date(`${a.monthKey}-01`),
          new Date(`${b.monthKey}-01`)
        )
      );

    setMonthlySummary(summary);
  }, [accounts, allTransactions, monthlyInterestDocs, isLoading, isLogLoading, canView]);

  const filteredLogs = useMemo(() => {
    return dailyLogs.filter((log) => {
      const logDate = new Date(log.date);
      const inDateRange =
        dateRange && dateRange.from && dateRange.to
          ? logDate >= startOfDay(dateRange.from) &&
            logDate <= endOfDay(dateRange.to)
          : true;

      const bankMatch =
        bankFilter === 'all' || log.accountId === bankFilter;

      return inDateRange && bankMatch;
    });
  }, [dailyLogs, dateRange, bankFilter]);

  const dailyLogStats = useMemo(() => {
    const totalInterest = filteredLogs.reduce((sum, row) => sum + row.dailyInterest, 0);
    return {
      entries: filteredLogs.length,
      totalInterest,
    };
  }, [filteredLogs]);

  const visibleLogAccounts = useMemo(() => {
    if (bankFilter !== 'all') {
      return accounts.filter((acc) => acc.id === bankFilter);
    }
    return [...accounts].sort((a, b) =>
      (a.shortName || '').localeCompare(b.shortName || '')
    );
  }, [accounts, bankFilter]);

  const dailyLogMatrix = useMemo(() => {
    const grouped = new Map<
      string,
      {
        date: string;
        byBank: Record<
          string,
          {
            closingUtilization: number;
            rate: number;
            dailyInterest: number;
          }
        >;
        totalDailyInterest: number;
      }
    >();

    filteredLogs.forEach((log) => {
      const existing = grouped.get(log.date) ?? {
        date: log.date,
        byBank: {},
        totalDailyInterest: 0,
      };

      existing.byBank[log.accountId] = {
        closingUtilization: log.closingUtilization,
        rate: log.rate,
        dailyInterest: log.dailyInterest,
      };
      existing.totalDailyInterest += log.dailyInterest;

      grouped.set(log.date, existing);
    });

    return Array.from(grouped.values()).sort((a, b) =>
      compareDesc(new Date(a.date), new Date(b.date))
    );
  }, [filteredLogs]);

  const monthlySummaryStats = useMemo(() => {
    const totalMonths = monthlySummary.length;
    const totalRows = monthlySummary.length;
    const totalProjected = monthlySummary.reduce(
      (sum, m) => sum + m.totalProjected,
      0
    );
    const totalActual = monthlySummary.reduce(
      (sum, m) => sum + m.totalActual,
      0
    );
    return { totalMonths, totalRows, totalProjected, totalActual };
  }, [monthlySummary]);

  const handleNewRateChange = (
    accountId: string,
    field: 'fromDate' | 'rate',
    value: string
  ) => {
    setNewRateEntries((prev) => ({
      ...prev,
      [accountId]: {
        ...(prev[accountId] || { fromDate: '', rate: '' }),
        [field]: value,
      },
    }));
  };

  const handleAddRate = async (accountId: string) => {
    if (!canAdd) {
      toast({
        title: 'Not allowed',
        description: 'You do not have permission to add rate entries.',
        variant: 'destructive',
      });
      return;
    }

    const newEntry = newRateEntries[accountId];
    if (!newEntry || !newEntry.fromDate || !newEntry.rate) {
      toast({
        title: 'Validation Error',
        description: 'Please provide both a date and a rate.',
        variant: 'destructive',
      });
      return;
    }

    const account = accounts.find((acc) => acc.id === accountId);
    if (!account) return;

    setIsSaving((prev) => ({ ...prev, [accountId]: true }));

    try {
      const updatedRateLog: InterestRateLogEntry[] = [
        ...(account.interestRateLog || []),
      ];

      const latestEntry = updatedRateLog.find(
        (entry) => entry.toDate === null
      );
      if (latestEntry) {
        latestEntry.toDate = format(
          subDays(new Date(newEntry.fromDate), 1),
          'yyyy-MM-dd'
        );
      }

      updatedRateLog.push({
        id: makeId(),
        fromDate: newEntry.fromDate,
        toDate: null,
        rate: parseFloat(newEntry.rate),
      });

      updatedRateLog.sort(
        (a, b) =>
          new Date(b.fromDate).getTime() -
          new Date(a.fromDate).getTime()
      );

      await updateDoc(doc(db, 'bankAccounts', accountId), {
        interestRateLog: updatedRateLog,
      });

      toast({
        title: 'Success',
        description: 'Interest Rate log updated successfully.',
      });

      setAccounts((prev) =>
        prev.map((acc) =>
          acc.id === accountId
            ? { ...acc, interestRateLog: updatedRateLog }
            : acc
        )
      );
      setNewRateEntries((prev) => ({
        ...prev,
        [accountId]: { fromDate: '', rate: '' },
      }));
      setOpenAddForm(null);
    } catch (error) {
      console.error('Error saving new rate entry:', error);
      toast({
        title: 'Error',
        description: 'Failed to save new rate entry.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving((prev) => ({ ...prev, [accountId]: false }));
    }
  };

  const handleDeleteRate = async (
    accountId: string,
    entryToDelete: InterestRateLogEntry
  ) => {
    if (!canDelete) {
      toast({
        title: 'Not allowed',
        description: 'You do not have permission to delete rate entries.',
        variant: 'destructive',
      });
      return;
    }

    const account = accounts.find((acc) => acc.id === accountId);
    if (!account) return;

    setIsSaving((prev) => ({ ...prev, [accountId]: true }));

    try {
      let updatedRateLog = (account.interestRateLog || []).filter(
        (entry) => entry.id !== entryToDelete.id
      );

      if (entryToDelete.toDate === null && updatedRateLog.length) {
        updatedRateLog.sort(
          (a, b) =>
            new Date(b.fromDate).getTime() -
            new Date(a.fromDate).getTime()
        );
        updatedRateLog[0].toDate = null;
      }

      await updateDoc(doc(db, 'bankAccounts', accountId), {
        interestRateLog: updatedRateLog,
      });

      toast({
        title: 'Success',
        description: 'Rate entry deleted.',
      });

      setAccounts((prev) =>
        prev.map((acc) =>
          acc.id === accountId
            ? { ...acc, interestRateLog: updatedRateLog }
            : acc
        )
      );
    } catch (error) {
      console.error('Error deleting rate entry:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete rate entry.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving((prev) => ({ ...prev, [accountId]: false }));
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount || 0);

  const clearLogFilters = () => {
    setDateRange(undefined);
    setDatePreset('custom');
    setBankFilter('all');
  };

  const handleDatePresetChange = (value: string) => {
    const preset = value as DateRangePreset;
    setDatePreset(preset);
    if (preset === 'custom') return;
    setDateRange(getDateRangeFromPreset(preset));
  };

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <Skeleton className="h-10 w-80 rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Interest Rate Management</h1>
        </div>
        <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Animated Background (Indigo theme for Interest Rate) ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/60 via-background to-violet-50/40 dark:from-indigo-950/20 dark:via-background dark:to-violet-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-indigo-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-violet-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>
    <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
      <div className="mb-5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-indigo-50 dark:hover:bg-indigo-950/30">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Interest Rate Management</h1>
            <p className="text-xs text-muted-foreground">Manage interest rate history and view daily interest logs.</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="daily-log">
        <TabsList className="mb-4">
          <TabsTrigger value="manage-rates">
            Manage Rates
          </TabsTrigger>
          <TabsTrigger value="daily-log">
            Daily Log
          </TabsTrigger>
          <TabsTrigger value="monthly-summary">
            Monthly Summary
          </TabsTrigger>
        </TabsList>

        {/* Manage Rates */}
        <TabsContent value="manage-rates">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {accounts.length > 0 ? (
              accounts.map((acc) => (
                <Collapsible
                  asChild
                  key={acc.id}
                  open={openAddForm === acc.id}
                  onOpenChange={(isOpen) =>
                    setOpenAddForm(isOpen ? acc.id : null)
                  }
                >
                  <Card>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle>
                            {acc.bankName} ({acc.shortName})
                          </CardTitle>
                          <CardDescription>
                            {acc.accountNumber}
                          </CardDescription>
                        </div>
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="outline"
                            disabled={!canAdd}
                          >
                            <Plus className="mr-2 h-4 w-4" /> Add New
                            Rate
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CollapsibleContent className="mb-4">
                        <div className="flex items-end gap-2 p-4 border rounded-lg">
                          <div className="flex-1 space-y-1">
                            <label
                              htmlFor={`date-${acc.id}`}
                              className="text-xs text-muted-foreground"
                            >
                              Effective From
                            </label>
                            <Input
                              id={`date-${acc.id}`}
                              type="date"
                              value={
                                newRateEntries[acc.id]?.fromDate ||
                                ''
                              }
                              onChange={(e) =>
                                handleNewRateChange(
                                  acc.id,
                                  'fromDate',
                                  e.target.value
                                )
                              }
                              disabled={!canAdd}
                            />
                          </div>
                          <div className="flex-1 space-y-1">
                            <label
                              htmlFor={`rate-${acc.id}`}
                              className="text-xs text-muted-foreground"
                            >
                              Rate (%)
                            </label>
                            <Input
                              id={`rate-${acc.id}`}
                              type="number"
                              placeholder="e.g., 10.5"
                              value={
                                newRateEntries[acc.id]?.rate || ''
                              }
                              onChange={(e) =>
                                handleNewRateChange(
                                  acc.id,
                                  'rate',
                                  e.target.value
                                )
                              }
                              disabled={!canAdd}
                            />
                          </div>
                          <Button
                            onClick={() =>
                              handleAddRate(acc.id)
                            }
                            disabled={
                              isSaving[acc.id] || !canAdd
                            }
                          >
                            {isSaving[acc.id] ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Plus className="mr-2 h-4 w-4" />
                            )}
                            Add
                          </Button>
                        </div>
                      </CollapsibleContent>

                      <h4 className="font-semibold mb-2 mt-6">
                        Interest Rate History
                      </h4>
                      <div className="border rounded-md max-h-60 overflow-y-auto mb-4">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>
                                Effective From
                              </TableHead>
                              <TableHead>
                                Effective To
                              </TableHead>
                              <TableHead>
                                Rate (%)
                              </TableHead>
                              <TableHead className="text-right">
                                Action
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {acc.interestRateLog &&
                            acc.interestRateLog.length > 0 ? (
                              acc.interestRateLog.map((rate) => (
                                <TableRow key={rate.id}>
                                  <TableCell>
                                    {rate.fromDate
                                      ? format(
                                          new Date(
                                            rate.fromDate
                                          ),
                                          'dd MMM, yyyy'
                                        )
                                      : 'N/A'}
                                  </TableCell>
                                  <TableCell>
                                    {rate.toDate
                                      ? format(
                                          new Date(
                                            rate.toDate
                                          ),
                                          'dd MMM, yyyy'
                                        )
                                      : 'Current'}
                                  </TableCell>
                                  <TableCell>
                                    {rate.rate.toFixed(2)}%
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-destructive"
                                      onClick={() =>
                                        handleDeleteRate(
                                          acc.id,
                                          rate
                                        )
                                      }
                                      disabled={
                                        !canDelete ||
                                        (acc.interestRateLog
                                          ?.length ??
                                          0) <= 1
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))
                            ) : (
                              <TableRow>
                                <TableCell
                                  colSpan={4}
                                  className="text-center h-24"
                                >
                                  No interest rate history.
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
                  No Cash Credit accounts found.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Daily Log */}
        <TabsContent value="daily-log">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-4">
                <Select value={datePreset} onValueChange={handleDatePresetChange}>
                  <SelectTrigger className="w-[190px]">
                    <SelectValue placeholder="Quick filter" />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_RANGE_PRESET_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="date"
                      variant="outline"
                      className={cn(
                        'w-[300px] justify-start text-left font-normal',
                        !dateRange &&
                          'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(
                              dateRange.from,
                              'LLL dd, y'
                            )}{' '}
                            -{' '}
                            {format(
                              dateRange.to,
                              'LLL dd, y'
                            )}
                          </>
                        ) : (
                          format(
                            dateRange.from,
                            'LLL dd, y'
                          )
                        )
                      ) : (
                        <span>Pick a date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-auto p-0"
                    align="start"
                  >
                    <Calendar
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={(range) => {
                        setDateRange(range);
                        setDatePreset('custom');
                      }}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>

                <Select
                  value={bankFilter}
                  onValueChange={setBankFilter}
                >
                  <SelectTrigger className="w-[240px]">
                    <SelectValue placeholder="All Banks" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      All Banks
                    </SelectItem>
                    {accounts.map((acc) => (
                      <SelectItem
                        key={acc.id}
                        value={acc.id}
                      >
                        {acc.shortName} - {acc.bankName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  onClick={clearLogFilters}
                  variant="secondary"
                >
                  Clear Filters
                </Button>
                <Badge variant="outline" className="ml-auto">
                  {dailyLogMatrix.length} day{dailyLogMatrix.length !== 1 ? 's' : ''}
                </Badge>
              </div>
              <CardDescription>
                Total projected daily interest for selection:{' '}
                <span className="font-semibold text-foreground">{formatCurrency(dailyLogStats.totalInterest)}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden">
              <div className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-background">
                <ScrollArea className="h-[calc(100vh-24rem)]" showHorizontalScrollbar>
                  <div className="min-w-[1100px]">
                    <Table containerClassName="w-full overflow-visible" className="w-full">
                      <TableHeader className="sticky top-0 z-10 bg-background border-b border-border/60">
                        <TableRow>
                          <TableHead rowSpan={2} className="min-w-[130px] border-r bg-background align-middle">
                            Date
                          </TableHead>
                          {visibleLogAccounts.map((acc) => (
                            <TableHead
                              key={`${acc.id}-group`}
                              colSpan={3}
                              className="border-r text-center"
                            >
                              {acc.shortName}
                            </TableHead>
                          ))}
                          <TableHead rowSpan={2} className="min-w-[140px] text-right align-middle">
                            Total Interest
                          </TableHead>
                        </TableRow>
                        <TableRow>
                          {visibleLogAccounts.map((acc) => (
                            <Fragment key={`${acc.id}-cols`}>
                              <TableHead className="text-right whitespace-nowrap">
                                Utilised
                              </TableHead>
                              <TableHead className="text-right whitespace-nowrap">
                                Rate
                              </TableHead>
                              <TableHead className="text-right whitespace-nowrap border-r">
                                Interest
                              </TableHead>
                            </Fragment>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isLogLoading ? (
                          Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                              <TableCell colSpan={visibleLogAccounts.length * 3 + 2}>
                                <Skeleton className="h-6" />
                              </TableCell>
                            </TableRow>
                          ))
                        ) : dailyLogMatrix.length > 0 ? (
                          dailyLogMatrix.map((row) => (
                            <TableRow key={row.date}>
                              <TableCell className="font-medium border-r">
                                {format(new Date(row.date), 'dd MMM, yyyy')}
                              </TableCell>
                              {visibleLogAccounts.map((acc) => {
                                const item = row.byBank[acc.id];
                                return (
                                  <Fragment key={`${row.date}-${acc.id}`}>
                                    <TableCell className="text-right whitespace-nowrap">
                                      {item ? formatCurrency(item.closingUtilization) : '—'}
                                    </TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                      {item ? `${item.rate.toFixed(2)}%` : '—'}
                                    </TableCell>
                                    <TableCell className="text-right whitespace-nowrap border-r font-medium">
                                      {item ? formatCurrency(item.dailyInterest) : '—'}
                                    </TableCell>
                                  </Fragment>
                                );
                              })}
                              <TableCell className="text-right font-semibold whitespace-nowrap">
                                {formatCurrency(row.totalDailyInterest)}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell
                              colSpan={visibleLogAccounts.length * 3 + 2}
                              className="text-center h-24"
                            >
                              No logs found for the selected criteria.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Monthly Summary */}
        <TabsContent value="monthly-summary">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>
                    Monthly Interest Summary
                  </CardTitle>
                  <CardDescription>
                    Total interest accrued per bank for each month.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Months: {monthlySummaryStats.totalMonths}</Badge>
                  <Badge variant="outline">Rows: {monthlySummaryStats.totalRows}</Badge>
                  <Badge variant="outline">Projected: {formatCurrency(monthlySummaryStats.totalProjected)}</Badge>
                  <Badge variant="outline">Actual: {formatCurrency(monthlySummaryStats.totalActual)}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden">
              <div className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-background">
                <ScrollArea className="h-[calc(100vh-24rem)]" showHorizontalScrollbar>
              <Table containerClassName="w-max overflow-visible" className="w-max min-w-[980px]">
                <TableHeader className="sticky top-0 z-10 bg-background border-b border-border/60">
                  <TableRow>
                    <TableHead rowSpan={2} className="min-w-[140px]">Month</TableHead>
                    {accounts.map((acc) => (
                      <TableHead key={`group-${acc.id}`} colSpan={3} className="text-center">
                        {acc.shortName}
                      </TableHead>
                    ))}
                    <TableHead colSpan={3} className="text-center">Total</TableHead>
                  </TableRow>
                  <TableRow>
                    {accounts.map((acc) => (
                      <Fragment key={`cols-${acc.id}`}>
                        <TableHead key={`proj-${acc.id}`} className="text-right">Projected</TableHead>
                        <TableHead key={`act-${acc.id}`} className="text-right">Actual</TableHead>
                        <TableHead key={`diff-${acc.id}`} className="text-right">Diff</TableHead>
                      </Fragment>
                    ))}
                    <TableHead className="text-right">Projected</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLogLoading ? (
                    <TableRow>
                      <TableCell colSpan={Math.max(4, 1 + (accounts.length * 3) + 3)}>
                        <Skeleton className="h-20" />
                      </TableCell>
                    </TableRow>
                  ) : monthlySummary.length > 0 ? (
                    monthlySummary.map((summary) => (
                      <TableRow key={summary.monthKey}>
                        <TableCell className="font-medium">{summary.monthLabel}</TableCell>
                        {summary.banks.map((bank) => (
                          <Fragment key={`${summary.monthKey}-${bank.accountId}`}>
                            <TableCell key={`${summary.monthKey}-${bank.accountId}-p`} className="text-right">
                              {formatCurrency(bank.projected)}
                            </TableCell>
                            <TableCell key={`${summary.monthKey}-${bank.accountId}-a`} className="text-right">
                              {formatCurrency(bank.actual)}
                            </TableCell>
                            <TableCell
                              key={`${summary.monthKey}-${bank.accountId}-d`}
                              className={cn(
                                'text-right',
                                bank.diff > 0 ? 'text-red-600 dark:text-red-400' : bank.diff < 0 ? 'text-green-600 dark:text-green-400' : ''
                              )}
                            >
                              {formatCurrency(bank.diff)}
                            </TableCell>
                          </Fragment>
                        ))}
                        <TableCell className="text-right font-semibold">{formatCurrency(summary.totalProjected)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(summary.totalActual)}</TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-semibold',
                            summary.totalDiff > 0 ? 'text-red-600 dark:text-red-400' : summary.totalDiff < 0 ? 'text-green-600 dark:text-green-400' : ''
                          )}
                        >
                          {formatCurrency(summary.totalDiff)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={Math.max(4, 1 + (accounts.length * 3) + 3)}
                        className="text-center h-24"
                      >
                        No data to summarize.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </>
  );
}
