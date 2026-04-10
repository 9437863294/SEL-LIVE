'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Search,
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { format, compareDesc, startOfDay, endOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  runTransaction,
  query,
  where,
} from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  DATE_RANGE_PRESET_OPTIONS,
  type DateRangePreset,
  getDateRangeFromPreset,
} from '@/lib/date-range-presets';

export default function ReceiptsLogPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [logEntries, setLogEntries] = useState<BankExpense[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [datePreset, setDatePreset] = useState<DateRangePreset>('custom');
  const [bankFilter, setBankFilter] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [viewMode, setViewMode] = useState<'current' | 'dateWise'>('current');

  const canView = !authLoading && can('View', 'Bank Balance.Receipts');
  const canAdd = !authLoading && can('Add', 'Bank Balance.Receipts');
  const canDelete = !authLoading && can('Delete', 'Bank Balance.Receipts');

  const fetchBankAccountsAndReceipts = useCallback(async () => {
    if (!canView) {
      setIsLogLoading(false);
      return;
    }

    setIsLogLoading(true);
    try {
      const [accountsSnap, receiptsSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(
          query(
            collection(db, 'bankExpenses'),
            where('type', '==', 'Credit'),
            where('isContra', '==', false)
          )
        ),
      ]);

      const accounts = accountsSnap.docs.map(
        (docSnap) =>
          ({ id: docSnap.id, ...docSnap.data() } as BankAccount)
      );
      setBankAccounts(accounts);

      const receiptsData = receiptsSnap.docs.map(
        (docSnap) =>
          ({ id: docSnap.id, ...docSnap.data() } as BankExpense)
      );
      receiptsData.sort((a, b) =>
        compareDesc(a.date.toDate(), b.date.toDate())
      );
      setLogEntries(receiptsData);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load initial data.',
        variant: 'destructive',
      });
    } finally {
      setIsLogLoading(false);
    }
  }, [canView, toast]);

  useEffect(() => {
    if (!authLoading) {
      void fetchBankAccountsAndReceipts();
    }
  }, [authLoading, fetchBankAccountsAndReceipts]);

  const filteredLogEntries = useMemo(() => {
    return logEntries.filter((entry) => {
      const entryDate = entry.date.toDate();

      const inDateRange =
        !dateRange ||
        ((!dateRange.from || entryDate >= startOfDay(dateRange.from)) &&
          (!dateRange.to || entryDate <= endOfDay(dateRange.to)));

      const bankMatch =
        bankFilter === 'all' || entry.accountId === bankFilter;

      const searchMatch =
        !searchFilter ||
        entry.description
          ?.toLowerCase()
          .includes(searchFilter.toLowerCase());

      return inDateRange && bankMatch && searchMatch;
    });
  }, [logEntries, dateRange, bankFilter, searchFilter]);

  const visibleBankAccounts = useMemo(() => {
    if (bankFilter !== 'all') {
      return bankAccounts.filter((acc) => acc.id === bankFilter);
    }

    const usedAccountIds = new Set(filteredLogEntries.map((entry) => entry.accountId));
    return bankAccounts
      .filter((acc) => usedAccountIds.has(acc.id))
      .sort((a, b) => (a.shortName || '').localeCompare(b.shortName || ''));
  }, [bankAccounts, bankFilter, filteredLogEntries]);

  const dateWiseRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        date: string;
        bankTotals: Record<string, number>;
        total: number;
      }
    >();

    filteredLogEntries.forEach((entry) => {
      const dateKey = format(entry.date.toDate(), 'yyyy-MM-dd');
      const existing = grouped.get(dateKey) ?? {
        date: dateKey,
        bankTotals: {},
        total: 0,
      };

      existing.bankTotals[entry.accountId] =
        (existing.bankTotals[entry.accountId] || 0) + entry.amount;
      existing.total += entry.amount;
      grouped.set(dateKey, existing);
    });

    return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredLogEntries]);

  const handleDeleteReceipt = async (receiptToDelete: BankExpense) => {
    if (!canDelete) {
      toast({
        title: 'Not allowed',
        description:
          'You do not have permission to delete receipts.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const receiptRef = doc(
          db,
          'bankExpenses',
          receiptToDelete.id
        );
        transaction.delete(receiptRef);
      });

      toast({
        title: 'Success',
        description: 'Receipt deleted successfully.',
      });
      void fetchBankAccountsAndReceipts();
    } catch (error) {
      console.error('Error deleting receipt:', error);
      toast({
        title: 'Delete Failed',
        description:
          'An error occurred while deleting the receipt.',
        variant: 'destructive',
      });
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);

  const clearFilters = () => {
    setDateRange(undefined);
    setDatePreset('custom');
    setBankFilter('all');
    setSearchFilter('');
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
          <h1 className="text-xl font-bold">Receipts Log</h1>
        </div>
        <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Animated Background (Green theme for Receipts) ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-green-50/60 via-background to-emerald-50/40 dark:from-green-950/20 dark:via-background dark:to-emerald-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-green-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-emerald-300/12 blur-3xl" />
        <div className="animate-bb-orb-3 absolute top-[40%] left-[30%] w-[25vw] h-[25vw] rounded-full bg-teal-200/10 blur-2xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(34,197,94,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

    <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
      {/* ── Header ── */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-green-50 dark:hover:bg-green-950/30">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Receipts Log</h1>
            <p className="text-xs text-muted-foreground">{filteredLogEntries.length} records · {formatCurrency(totalFiltered)}</p>
          </div>
        </div>
        {canAdd ? (
          <Link href="/bank-balance/receipts/new">
            <Button className="rounded-full shadow-md shadow-green-200/50 dark:shadow-green-900/20 bg-green-600 hover:bg-green-700">
              <Plus className="mr-2 h-4 w-4" />New Receipt
            </Button>
          </Link>
        ) : (
          <Button disabled className="rounded-full"><Plus className="mr-2 h-4 w-4" />New Receipt</Button>
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
                    <span>
                      Pick a date range
                    </span>
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
                  defaultMonth={
                    dateRange?.from
                  }
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
                {bankAccounts.map(
                  (acc) => (
                    <SelectItem
                      key={acc.id}
                      value={acc.id}
                    >
                      {acc.shortName} -{' '}
                      {acc.bankName}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                className="pl-8"
                value={searchFilter}
                onChange={(e) =>
                  setSearchFilter(
                    e.target.value
                  )
                }
              />
            </div>

            <Button onClick={clearFilters} variant="secondary" className="rounded-lg">
              Clear Filters
            </Button>
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
                <TableHead>Bank</TableHead>
                <TableHead>
                  Description
                </TableHead>
                <TableHead>
                  Amount
                </TableHead>
                <TableHead className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLogLoading ? (
                Array.from({
                  length: 5,
                }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell
                      colSpan={5}
                    >
                      <Skeleton className="h-6" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredLogEntries.length >
                0 ? (
                filteredLogEntries.map(
                  (entry) => {
                    const bank =
                      bankAccounts.find(
                        (b) =>
                          b.id ===
                          entry.accountId
                      );
                    return (
                      <TableRow
                        key={
                          entry.id
                        }
                      >
                        <TableCell>
                          {format(
                            entry.date.toDate(),
                            'dd MMM, yyyy'
                          )}
                        </TableCell>
                        <TableCell>
                          {bank?.shortName ||
                            'N/A'}
                        </TableCell>
                        <TableCell>
                          {
                            entry.description
                          }
                        </TableCell>
                        <TableCell>
                          {formatCurrency(
                            entry.amount
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={
                                  !canDelete
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Are you sure?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This action cannot be undone. This will permanently delete this receipt.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() =>
                                    handleDeleteReceipt(
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
                    );
                  }
                )
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center h-24"
                  >
                    No receipt
                    records
                    found.
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
                  {visibleBankAccounts.map((acc) => (
                    <TableHead key={acc.id} className="text-right">
                      {acc.shortName}
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
                      {visibleBankAccounts.map((acc) => (
                        <TableCell key={`${row.date}-${acc.id}`} className="text-right">
                          {row.bankTotals[acc.id] ? formatCurrency(row.bankTotals[acc.id]) : '-'}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-semibold">{formatCurrency(row.total)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={Math.max(2, visibleBankAccounts.length + 2)}
                      className="text-center h-24"
                    >
                      No date-wise receipt data found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}
