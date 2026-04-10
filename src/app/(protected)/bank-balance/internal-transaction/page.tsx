'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Edit,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, compareDesc, startOfDay, endOfDay } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  doc,
  Timestamp,
} from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { DateRange } from 'react-day-picker';
import { useAuthorization } from '@/hooks/useAuthorization';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DATE_RANGE_PRESET_OPTIONS,
  type DateRangePreset,
  getDateRangeFromPreset,
} from '@/lib/date-range-presets';

type UnifiedTransaction = {
  id: string; // contraId
  contraId: string;
  date: string;
  fromAccountId: string;
  toAccountId: string;
  fromBankName: string;
  toBankName: string;
  amount: number;
};

export default function InternalTransactionPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [logEntries, setLogEntries] = useState<UnifiedTransaction[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [datePreset, setDatePreset] = useState<DateRangePreset>('custom');
  const [viewMode, setViewMode] = useState<'current' | 'dateWise'>('current');
  const [editingEntry, setEditingEntry] = useState<UnifiedTransaction | null>(null);
  const [editDate, setEditDate] = useState<Date | undefined>(undefined);
  const [editFromAccountId, setEditFromAccountId] = useState('');
  const [editToAccountId, setEditToAccountId] = useState('');
  const [editAmount, setEditAmount] = useState<number>(0);
  const [isEditSaving, setIsEditSaving] = useState(false);

  const canView = can('View', 'Bank Balance.Internal Transaction');
  const canAdd = can('Add', 'Bank Balance.Internal Transaction');
  const canEdit =
    can('Edit', 'Bank Balance.Internal Transaction') ||
    canAdd;
  const canDelete = can('Delete', 'Bank Balance.Internal Transaction');
  const activeBankAccounts = useMemo(
    () => bankAccounts.filter((account) => account.status === 'Active'),
    [bankAccounts]
  );

  const fetchBankAccountsAndLog = useCallback(async () => {
    setIsLogLoading(true);
    try {
      const [accountsSnap, expensesSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses')),
      ]);

      const accounts = accountsSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as BankAccount)
      );
      setBankAccounts(accounts);

      const expenses = expensesSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as BankExpense)
      );
      setAllTransactions(expenses);

      const contraEntries = expenses.filter((entry) => entry.isContra);

      // Sort without mutating original array
      const sortedContra = [...contraEntries].sort((a, b) =>
        compareDesc(a.date.toDate(), b.date.toDate())
      );

      const grouped: Record<string, Partial<UnifiedTransaction>> = {};

      sortedContra.forEach((entry) => {
        const contraId = entry.contraId;
        if (!contraId) return;

        if (!grouped[contraId]) {
          grouped[contraId] = {
            contraId,
            amount: entry.amount,
            date: format(entry.date.toDate(), 'yyyy-MM-dd'),
          };
        }

        if (entry.type === 'Debit') {
          grouped[contraId].fromAccountId = entry.accountId;
        } else if (entry.type === 'Credit') {
          grouped[contraId].toAccountId = entry.accountId;
        }
      });

      const unifiedLog: UnifiedTransaction[] = Object.values(grouped)
        .filter((t) => t.fromAccountId && t.toAccountId)
        .map((t) => {
          const fromBank =
            accounts.find((acc) => acc.id === t.fromAccountId)
              ?.shortName || 'N/A';
          const toBank =
            accounts.find((acc) => acc.id === t.toAccountId)
              ?.shortName || 'N/A';

          return {
            id: t.contraId as string,
            contraId: t.contraId as string,
            date: t.date as string,
            fromAccountId: t.fromAccountId as string,
            toAccountId: t.toAccountId as string,
            amount: t.amount as number,
            fromBankName: fromBank,
            toBankName: toBank,
          };
        });

      setLogEntries(unifiedLog);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load log data.',
        variant: 'destructive',
      });
    } finally {
      setIsLogLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (authLoading) return;
    if (canView) {
      void fetchBankAccountsAndLog();
    } else {
      setIsLogLoading(false);
    }
  }, [authLoading, canView, fetchBankAccountsAndLog]);

  const filteredLogEntries = useMemo(() => {
    return logEntries.filter((entry) => {
      const entryDate = new Date(entry.date);
      const inDateRange =
        !dateRange ||
        ((!dateRange.from || entryDate >= startOfDay(dateRange.from)) &&
          (!dateRange.to || entryDate <= endOfDay(dateRange.to)));
      return inDateRange;
    });
  }, [logEntries, dateRange]);

  const transferColumns = useMemo(() => {
    const keys = new Set(filteredLogEntries.map((entry) => `${entry.fromBankName} -> ${entry.toBankName}`));
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [filteredLogEntries]);

  const dateWiseRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        date: string;
        transferTotals: Record<string, number>;
        total: number;
      }
    >();

    filteredLogEntries.forEach((entry) => {
      const dateKey = entry.date;
      const transferKey = `${entry.fromBankName} -> ${entry.toBankName}`;
      const existing = grouped.get(dateKey) ?? {
        date: dateKey,
        transferTotals: {},
        total: 0,
      };

      existing.transferTotals[transferKey] =
        (existing.transferTotals[transferKey] || 0) + entry.amount;
      existing.total += entry.amount;
      grouped.set(dateKey, existing);
    });

    return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredLogEntries]);

  const getLatestDp = (account: BankAccount, onDate: Date) => {
    return getApplicableCcLimit(account, onDate);
  };

  const getAvailableFunds = (
    account: BankAccount,
    onDate: Date,
    excludedContraId?: string
  ) => {
    let balance =
      account.accountType === 'Cash Credit'
        ? account.openingUtilization || 0
        : account.openingBalance || 0;

    const openingDate = account.openingDate
      ? new Date(account.openingDate)
      : new Date(0);

    const historical = allTransactions
      .filter(
        (transaction) =>
          transaction.accountId === account.id &&
          transaction.date.toDate() >= openingDate &&
          transaction.date.toDate() < onDate &&
          transaction.contraId !== excludedContraId
      )
      .sort(
        (a, b) => a.date.toMillis() - b.date.toMillis()
      );

    historical.forEach((transaction) => {
      if (account.accountType === 'Cash Credit') {
        balance +=
          transaction.type === 'Debit'
            ? transaction.amount
            : -transaction.amount;
      } else {
        balance +=
          transaction.type === 'Credit'
            ? transaction.amount
            : -transaction.amount;
      }
    });

    if (account.accountType === 'Cash Credit') {
      return getLatestDp(account, onDate) - balance;
    }

    return balance;
  };

  const editAvailableFunds = useMemo(() => {
    if (!editingEntry || !editDate || !editFromAccountId) {
      return 0;
    }

    const account = bankAccounts.find(
      (item) => item.id === editFromAccountId
    );

    if (!account) {
      return 0;
    }

    return getAvailableFunds(
      account,
      editDate,
      editingEntry.contraId
    );
  }, [
    bankAccounts,
    editDate,
    editFromAccountId,
    editingEntry,
    allTransactions,
  ]);

  const openEditDialog = (entry: UnifiedTransaction) => {
    setEditingEntry(entry);
    setEditDate(new Date(entry.date));
    setEditFromAccountId(entry.fromAccountId);
    setEditToAccountId(entry.toAccountId);
    setEditAmount(entry.amount);
  };

  const resetEditDialog = () => {
    setEditingEntry(null);
    setEditDate(undefined);
    setEditFromAccountId('');
    setEditToAccountId('');
    setEditAmount(0);
    setIsEditSaving(false);
  };

  const handleEditTransaction = async () => {
    if (!editingEntry || !editDate) {
      return;
    }

    if (!canEdit) {
      toast({
        title: 'Not allowed',
        description:
          'You do not have permission to edit internal transactions.',
        variant: 'destructive',
      });
      return;
    }

    if (
      !editFromAccountId ||
      !editToAccountId ||
      editFromAccountId === editToAccountId ||
      editAmount <= 0
    ) {
      toast({
        title: 'Validation Error',
        description:
          'Please select different source and destination accounts and enter a positive amount.',
        variant: 'destructive',
      });
      return;
    }

    const fromAccount = bankAccounts.find(
      (account) => account.id === editFromAccountId
    );
    const toAccount = bankAccounts.find(
      (account) => account.id === editToAccountId
    );

    if (!fromAccount || !toAccount) {
      toast({
        title: 'Validation Error',
        description:
          'One or both selected accounts could not be found.',
        variant: 'destructive',
      });
      return;
    }

    const availableFunds = getAvailableFunds(
      fromAccount,
      editDate,
      editingEntry.contraId
    );

    if (editAmount > availableFunds) {
      toast({
        title: 'Insufficient Funds',
        description: `Transfer from ${fromAccount.shortName} exceeds the available amount of ${formatCurrency(
          availableFunds
        )}.`,
        variant: 'destructive',
      });
      return;
    }

    setIsEditSaving(true);

    try {
      const existingContraSnap = await getDocs(
        query(
          collection(db, 'bankExpenses'),
          where('contraId', '==', editingEntry.contraId)
        )
      );

      const batch = writeBatch(db);

      existingContraSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      const baseData = {
        date: Timestamp.fromDate(editDate),
        isContra: true,
        contraId: editingEntry.contraId,
        createdAt: Timestamp.now(),
      };

      batch.set(doc(collection(db, 'bankExpenses')), {
        ...baseData,
        accountId: editFromAccountId,
        description: `Transfer to ${toAccount.shortName} - ${toAccount.bankName}`,
        amount: editAmount,
        type: 'Debit',
      } as Omit<BankExpense, 'id'>);

      batch.set(doc(collection(db, 'bankExpenses')), {
        ...baseData,
        accountId: editToAccountId,
        description: `Transfer from ${fromAccount.shortName} - ${fromAccount.bankName}`,
        amount: editAmount,
        type: 'Credit',
      } as Omit<BankExpense, 'id'>);

      await batch.commit();

      toast({
        title: 'Success',
        description: 'Internal transaction updated.',
      });

      resetEditDialog();
      void fetchBankAccountsAndLog();
    } catch (error) {
      console.error('Error editing internal transaction:', error);
      toast({
        title: 'Update Failed',
        description:
          'An error occurred while updating the internal transaction.',
        variant: 'destructive',
      });
      setIsEditSaving(false);
    }
  };

  const handleDeleteTransaction = async (entry: UnifiedTransaction) => {
    if (!canDelete) {
      toast({
        title: 'Not allowed',
        description:
          'You do not have permission to delete internal transactions.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const expensesRef = collection(db, 'bankExpenses');
      const q = query(expensesRef, where('contraId', '==', entry.contraId));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        toast({
          title: 'Not found',
          description: 'No matching contra entries found to delete.',
          variant: 'destructive',
        });
        return;
      }

      const batch = writeBatch(db);
      snapshot.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();

      toast({
        title: 'Success',
        description: 'Internal transaction deleted.',
      });

      void fetchBankAccountsAndLog();
    } catch (error) {
      console.error('Error deleting internal transaction:', error);
      toast({
        title: 'Delete Failed',
        description:
          'An error occurred while deleting the internal transaction.',
        variant: 'destructive',
      });
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount || 0);

  const clearFilters = () => {
    setDateRange(undefined);
    setDatePreset('custom');
  };

  const handleDatePresetChange = (value: string) => {
    const preset = value as DateRangePreset;
    setDatePreset(preset);
    if (preset === 'custom') return;
    setDateRange(getDateRangeFromPreset(preset));
  };

  const totalFiltered = filteredLogEntries.reduce((s, e) => s + e.amount, 0);

  if (authLoading || (isLogLoading && canView)) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
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
          <h1 className="text-xl font-bold">Internal Transaction Log</h1>
        </div>
        <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Animated Background (Violet/Blue theme for Transfers) ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50/60 via-background to-blue-50/40 dark:from-violet-950/20 dark:via-background dark:to-blue-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-violet-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-blue-300/12 blur-3xl" />
        <div className="animate-bb-orb-3 absolute top-[40%] left-[30%] w-[25vw] h-[25vw] rounded-full bg-indigo-200/10 blur-2xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

    <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
      {/* ── Header ── */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-violet-50 dark:hover:bg-violet-950/30">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Internal Transfers</h1>
            <p className="text-xs text-muted-foreground">{filteredLogEntries.length} transfers · {formatCurrency(totalFiltered)}</p>
          </div>
        </div>
        {canAdd ? (
          <Link href="/bank-balance/internal-transaction/new">
            <Button className="rounded-full shadow-md shadow-violet-200/50 dark:shadow-violet-900/20 bg-violet-600 hover:bg-violet-700">
              <Plus className="mr-2 h-4 w-4" />New Transfer
            </Button>
          </Link>
        ) : (
          <Button disabled className="rounded-full"><Plus className="mr-2 h-4 w-4" />New Transfer</Button>
        )}
      </div>

      {/* ── Filter Card ── */}
      <div className="mb-4 rounded-xl border border-border/50 bg-background/80 backdrop-blur-sm p-4 shadow-sm">
        <div className="flex flex-wrap gap-3 mb-3">
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
                    !dateRange && 'text-muted-foreground'
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
            <Button onClick={clearFilters} variant="secondary" className="rounded-lg">Clear Filter</Button>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant={viewMode === 'current' ? 'default' : 'outline'} onClick={() => setViewMode('current')} className="rounded-full">
              Current View
            </Button>
            <Button size="sm" variant={viewMode === 'dateWise' ? 'default' : 'outline'} onClick={() => setViewMode('dateWise')} className="rounded-full">
              Date-wise View
            </Button>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="rounded-xl border border-border/50 bg-background/80 backdrop-blur-sm overflow-hidden shadow-sm">

          {viewMode === 'current' ? (
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>From Bank</TableHead>
                <TableHead>To Bank</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLogLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-6" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredLogEntries.length > 0 ? (
                filteredLogEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      {format(
                        new Date(entry.date),
                        'dd MMM, yyyy'
                      )}
                    </TableCell>
                    <TableCell>
                      {entry.fromBankName}
                    </TableCell>
                    <TableCell>
                      {entry.toBankName}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(entry.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          openEditDialog(entry)
                        }
                        disabled={!canEdit}
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="ml-2"
                            disabled={!canDelete}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Are you absolutely sure?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete
                              both the debit and credit
                              entries for this internal
                              transaction.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                handleDeleteTransaction(
                                  entry
                                )
                              }
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center h-24"
                  >
                    No internal transfers found for the
                    selected criteria.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  {transferColumns.map((column) => (
                    <TableHead key={column} className="text-right">
                      {column}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dateWiseRows.length > 0 ? (
                  dateWiseRows.map((row) => (
                    <TableRow key={row.date}>
                      <TableCell>{format(new Date(row.date), 'dd MMM, yyyy')}</TableCell>
                      {transferColumns.map((column) => (
                        <TableCell key={`${row.date}-${column}`} className="text-right">
                          {row.transferTotals[column] ? formatCurrency(row.transferTotals[column]) : '-'}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-semibold">{formatCurrency(row.total)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={Math.max(2, transferColumns.length + 2)}
                      className="text-center h-24"
                    >
                      No date-wise transfer data found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog
        open={!!editingEntry}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            resetEditDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Internal Transaction</DialogTitle>
            <DialogDescription>
              Update the source bank, destination bank, date, or amount for this contra entry.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Transaction Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !editDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {editDate ? format(editDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={editDate}
                    onSelect={setEditDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>From Bank</Label>
                <Select
                  value={editFromAccountId}
                  onValueChange={setEditFromAccountId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBankAccounts.map((account) => (
                      <SelectItem
                        key={account.id}
                        value={account.id}
                        disabled={account.id === editToAccountId}
                      >
                        {account.shortName} - {account.bankName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>To Bank</Label>
                <Select
                  value={editToAccountId}
                  onValueChange={setEditToAccountId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBankAccounts.map((account) => (
                      <SelectItem
                        key={account.id}
                        value={account.id}
                        disabled={account.id === editFromAccountId}
                      >
                        {account.shortName} - {account.bankName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={editAmount || ''}
                onChange={(event) =>
                  setEditAmount(event.target.valueAsNumber || 0)
                }
              />
            </div>

            {editFromAccountId && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                Available from source account: <span className="font-semibold">{formatCurrency(editAvailableFunds)}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={resetEditDialog}
              disabled={isEditSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleEditTransaction()}
              disabled={isEditSaving}
            >
              {isEditSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
