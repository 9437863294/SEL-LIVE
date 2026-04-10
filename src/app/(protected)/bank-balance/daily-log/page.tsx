'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight, ArrowUpDown, Calendar as CalendarIcon, Settings2, ShieldAlert, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import type { BankAccount, BankExpense, BankDailyLog, UserSettings } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, startOfDay, endOfDay, eachDayOfInterval, compareDesc } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  DATE_RANGE_PRESET_OPTIONS,
  type DateRangePreset,
  getDateRangeFromPreset,
} from '@/lib/date-range-presets';
import { useAuth } from '@/components/auth/AuthProvider';

interface EnrichedBankDailyLog extends BankDailyLog {
  availableBalance: number;
}

export default function DailyLogPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const { user } = useAuth();

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [dailyLogs, setDailyLogs] = useState<EnrichedBankDailyLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: new Date(), to: new Date() });
  const [datePreset, setDatePreset] = useState<DateRangePreset>('today');
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'current' | 'dateWise'>('dateWise');
  const [dateSortOrder, setDateSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [sectionsPopoverOpen, setSectionsPopoverOpen] = useState(false);
  const [sectionVisibility, setSectionVisibility] = useState({
    utilised: true,
    interTransfer: true,
    expenses: true,
    receipts: true,
    dp: true,
    balanceToDraw: true,
    interest: true,
  });

  const sectionSettingsKey = 'bank_balance_daily_log_section_visibility';

  const canView = !authLoading && can('View', 'Bank Balance.Daily Log');

  useEffect(() => {
    if (authLoading) return;
    if (!canView) { setIsLoading(false); return; }
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [accountsSnap, expensesSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses')),
      ]);
      setBankAccounts(accountsSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount)));
      setAllTransactions(expensesSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankExpense)));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const getDpForDate = (account: BankAccount, date: Date): number => {
    return getApplicableCcLimit(account, date);
  };

  const getRateForDate = (account: BankAccount, date: Date): number => {
    if (account.accountType !== 'Cash Credit' || !account.interestRateLog?.length) return 0;
    const sorted = [...account.interestRateLog].sort((a, b) => new Date(b.fromDate).getTime() - new Date(a.fromDate).getTime());
    const applicable = sorted.find(rate => new Date(rate.fromDate) <= startOfDay(date));
    return applicable ? applicable.rate : 0;
  };


  useEffect(() => {
    if (isLoading || !canView) return;
    const logs: EnrichedBankDailyLog[] = [];
    bankAccounts.forEach(account => {
      const isCC = account.accountType === 'Cash Credit';
      const opening = isCC ? (account.openingUtilization || 0) : (account.openingBalance || 0);
      if (!account.openingDate) return;
      let runningBalance = opening;
      const days = eachDayOfInterval({ start: startOfDay(new Date(account.openingDate)), end: endOfDay(new Date()) });
      days.forEach(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        const todaysTx = allTransactions.filter(t => t.accountId === account.id && format(t.date.toDate(), 'yyyy-MM-dd') === dayStr);
        const expenses = todaysTx.filter(t => t.type === 'Debit' && !t.isContra).reduce((s, t) => s + t.amount, 0);
        const receipts = todaysTx.filter(t => t.type === 'Credit' && !t.isContra).reduce((s, t) => s + t.amount, 0);
        let contra = 0;
        if (isCC) {
          contra = todaysTx.filter(t => t.isContra).reduce((s, t) => s + (t.type === 'Debit' ? t.amount : -t.amount), 0);
        } else {
          contra = todaysTx.filter(t => t.isContra).reduce((s, t) => s + (t.type === 'Credit' ? t.amount : -t.amount), 0);
        }
        const openingBalance = runningBalance;
        const closingBalance = isCC ? openingBalance + expenses - receipts + contra : openingBalance - expenses + receipts + contra;
        const dp = isCC ? getDpForDate(account, day) : 0;
        const availableBalance = isCC ? dp - closingBalance : closingBalance;
        logs.push({ id: `${dayStr}-${account.id}`, date: dayStr, accountId: account.id, accountName: account.shortName, openingBalance, totalExpenses: expenses, totalReceipts: receipts, totalContra: contra, closingBalance, availableBalance });
        runningBalance = closingBalance;
      });
    });
    logs.sort((a, b) => compareDesc(new Date(a.date), new Date(b.date)));
    setDailyLogs(logs);
  }, [bankAccounts, allTransactions, isLoading, canView]);

  const filteredLogs = useMemo(() => {
    return dailyLogs.filter(log => {
      const logDate = new Date(log.date);
      const inRange = dateRange?.from && dateRange.to
        ? logDate >= startOfDay(dateRange.from) && logDate <= endOfDay(dateRange.to)
        : true;
      return inRange && (bankFilter === 'all' || log.accountId === bankFilter);
    });
  }, [dailyLogs, dateRange, bankFilter]);

  const selectedAccounts = useMemo(() => {
    const activeAccounts = bankAccounts.filter((acc) => acc.status === 'Active');
    const filtered = bankFilter === 'all'
      ? activeAccounts
      : activeAccounts.filter((acc) => acc.id === bankFilter);
    return [...filtered].sort((a, b) =>
      `${a.shortName} ${a.accountType}`.localeCompare(`${b.shortName} ${b.accountType}`)
    );
  }, [bankAccounts, bankFilter]);

  const dateWiseRows = useMemo(() => {
    const accountById = new Map(bankAccounts.map((acc) => [acc.id, acc]));
    const selectedIds = new Set(selectedAccounts.map((acc) => acc.id));
    const makeMap = () => Object.fromEntries(selectedAccounts.map((acc) => [acc.id, 0])) as Record<string, number>;

    const grouped = new Map<
      string,
      {
        date: string;
        utilisedByAccount: Record<string, number>;
        interTransferByAccount: Record<string, number>;
        expensesByAccount: Record<string, number>;
        receiptsByAccount: Record<string, number>;
        dpByAccount: Record<string, number>;
        balanceToDrawByAccount: Record<string, number>;
        interestRateByAccount: Record<string, number>;
        interestProjectedByAccount: Record<string, number>;
      }
    >();

    filteredLogs.forEach((log) => {
      if (!selectedIds.has(log.accountId)) return;
      const account = accountById.get(log.accountId);
      if (!account) return;

      const row = grouped.get(log.date) ?? {
        date: log.date,
        utilisedByAccount: makeMap(),
        interTransferByAccount: makeMap(),
        expensesByAccount: makeMap(),
        receiptsByAccount: makeMap(),
        dpByAccount: makeMap(),
        balanceToDrawByAccount: makeMap(),
        interestRateByAccount: makeMap(),
        interestProjectedByAccount: makeMap(),
      };

      const rowDate = new Date(log.date);
      row.utilisedByAccount[log.accountId] = log.closingBalance;
      row.expensesByAccount[log.accountId] = log.totalExpenses;
      row.receiptsByAccount[log.accountId] = log.totalReceipts;
      row.dpByAccount[log.accountId] = getDpForDate(account, rowDate);
      row.balanceToDrawByAccount[log.accountId] = log.availableBalance;

      const rate = getRateForDate(account, rowDate);
      row.interestRateByAccount[log.accountId] = rate;
      row.interestProjectedByAccount[log.accountId] =
        rate > 0 ? (log.closingBalance * (rate / 100)) / 365 : 0;

      grouped.set(log.date, row);
    });

    allTransactions.forEach((tx) => {
      if (!tx.isContra || tx.type !== 'Credit') return;
      if (!selectedIds.has(tx.accountId)) return;
      const txDate = format(tx.date.toDate(), 'yyyy-MM-dd');
      const row = grouped.get(txDate) ?? {
        date: txDate,
        utilisedByAccount: makeMap(),
        interTransferByAccount: makeMap(),
        expensesByAccount: makeMap(),
        receiptsByAccount: makeMap(),
        dpByAccount: makeMap(),
        balanceToDrawByAccount: makeMap(),
        interestRateByAccount: makeMap(),
        interestProjectedByAccount: makeMap(),
      };
      row.interTransferByAccount[tx.accountId] += tx.amount;
      grouped.set(txDate, row);
    });

    return Array.from(grouped.values()).sort((a, b) =>
      dateSortOrder === 'newest'
        ? compareDesc(new Date(a.date), new Date(b.date))
        : a.date.localeCompare(b.date)
    );
  }, [filteredLogs, bankAccounts, selectedAccounts, allTransactions, dateSortOrder]);

  useEffect(() => {
    const loadSectionPrefs = async () => {
      if (!user) return;
      try {
        const settingsRef = doc(db, 'userSettings', user.id);
        const settingsSnap = await getDoc(settingsRef);
        if (!settingsSnap.exists()) return;
        const settings = settingsSnap.data() as UserSettings;
        const saved = settings.columnPreferences?.[sectionSettingsKey]?.visibility as
          | Partial<typeof sectionVisibility>
          | undefined;
        if (!saved) return;
        setSectionVisibility((prev) => ({ ...prev, ...saved }));
      } catch (error) {
        console.error('Failed to load section visibility preferences', error);
      }
    };
    void loadSectionPrefs();
  }, [user, sectionSettingsKey]);

  // Summary stats for filtered period
  const summary = useMemo(() => ({
    totalExpenses: filteredLogs.reduce((s, l) => s + l.totalExpenses, 0),
    totalReceipts: filteredLogs.reduce((s, l) => s + l.totalReceipts, 0),
    entries: filteredLogs.length,
  }), [filteredLogs]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

  const saveSectionVisibility = async (nextVisibility: typeof sectionVisibility) => {
    if (!user) return;
    try {
      const settingsRef = doc(db, 'userSettings', user.id);
      await setDoc(
        settingsRef,
        { columnPreferences: { [sectionSettingsKey]: { visibility: nextVisibility } } },
        { mergeFields: [`columnPreferences.${sectionSettingsKey}`] }
      );
    } catch (error) {
      console.error('Failed to save section visibility preferences', error);
      toast({
        title: 'Error',
        description: 'Could not save section visibility preferences.',
        variant: 'destructive',
      });
    }
  };

  const toggleSectionVisibility = (key: keyof typeof sectionVisibility, checked: boolean) => {
    const next = { ...sectionVisibility, [key]: checked };
    setSectionVisibility(next);
    void saveSectionVisibility(next);
  };

  const dateWiseColSpan =
    1 +
    (sectionVisibility.utilised ? selectedAccounts.length + 1 : 0) +
    (sectionVisibility.interTransfer ? selectedAccounts.length + 1 : 0) +
    (sectionVisibility.expenses ? selectedAccounts.length + 1 : 0) +
    (sectionVisibility.receipts ? selectedAccounts.length + 1 : 0) +
    (sectionVisibility.dp ? selectedAccounts.length + 1 : 0) +
    (sectionVisibility.balanceToDraw ? selectedAccounts.length + 1 : 0) +
    (sectionVisibility.interest ? (selectedAccounts.length * 2) + 1 : 0);

  const handleDatePresetChange = (value: string) => {
    const preset = value as DateRangePreset;
    setDatePreset(preset);
    if (preset === 'custom') return;
    setDateRange(getDateRangeFromPreset(preset));
  };

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance"><Button variant="ghost" size="icon" className="rounded-full"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-xl font-bold">Daily Utilization Log</h1>
        </div>
        <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Animated Background (Blue theme for Daily Log) ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/60 via-background to-indigo-50/40 dark:from-blue-950/20 dark:via-background dark:to-indigo-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-blue-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-indigo-300/12 blur-3xl" />
        <div className="animate-bb-orb-3 absolute top-[40%] left-[30%] w-[25vw] h-[25vw] rounded-full bg-sky-200/10 blur-2xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(59,130,246,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>
    <div className="relative w-full px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/bank-balance">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Daily Balance Log</h1>
            <p className="text-xs text-muted-foreground">History of daily balances and utilization across all accounts.</p>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-red-200/60 bg-red-50/60 dark:bg-red-950/20 dark:border-red-800/30 p-3 flex items-center gap-3">
          <div className="rounded-full bg-red-100 dark:bg-red-900/40 p-2">
            <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Period Payments</p>
            <p className="text-sm font-bold text-red-700 dark:text-red-400">{formatCurrency(summary.totalExpenses)}</p>
          </div>
        </div>
        <div className="rounded-xl border border-green-200/60 bg-green-50/60 dark:bg-green-950/20 dark:border-green-800/30 p-3 flex items-center gap-3">
          <div className="rounded-full bg-green-100 dark:bg-green-900/40 p-2">
            <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Period Receipts</p>
            <p className="text-sm font-bold text-green-700 dark:text-green-400">{formatCurrency(summary.totalReceipts)}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 flex items-center gap-3">
          <div className="rounded-full bg-muted p-2">
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Log Entries</p>
            <p className="text-sm font-bold">{summary.entries}</p>
          </div>
        </div>
      </div>

      <Card className="rounded-xl border-border/60 shadow-sm">
        {/* Filters */}
        <CardHeader className="border-b border-border/40 pb-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Select value={datePreset} onValueChange={handleDatePresetChange}>
              <SelectTrigger className="w-[180px] shrink-0 rounded-xl">
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
                <Button id="date" variant="outline" className={cn('w-[280px] shrink-0 justify-start text-left font-normal rounded-xl', !dateRange && 'text-muted-foreground')}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to
                      ? <>{format(dateRange.from, 'LLL dd, y')} – {format(dateRange.to, 'LLL dd, y')}</>
                      : format(dateRange.from, 'LLL dd, y')
                  ) : <span>Pick a date range</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
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

            <Select value={bankFilter} onValueChange={setBankFilter}>
              <SelectTrigger className="w-[200px] shrink-0 rounded-xl">
                <SelectValue placeholder="All Banks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Banks</SelectItem>
                {bankAccounts.filter((acc) => acc.status === 'Active').map(acc => (
                  <SelectItem key={acc.id} value={acc.id}>{acc.shortName} – {acc.bankName}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={() => {
                setDateRange(undefined);
                setDatePreset('custom');
                setBankFilter('all');
              }}
              variant="secondary"
              className="shrink-0 rounded-xl"
            >
              Clear Filters
            </Button>

            <Button
              className="shrink-0"
              variant="outline"
              size="icon"
              onClick={() => setViewMode((prev) => (prev === 'dateWise' ? 'current' : 'dateWise'))}
              title={viewMode === 'dateWise' ? 'Switch to Current View' : 'Switch to Date-wise View'}
              aria-label={viewMode === 'dateWise' ? 'Switch to Current View' : 'Switch to Date-wise View'}
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>

          {viewMode === 'dateWise' && (
            <Popover open={sectionsPopoverOpen} onOpenChange={setSectionsPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="shrink-0 rounded-xl">
                  <Settings2 className="mr-2 h-4 w-4" />
                  Sections
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[320px]">
                <div className="space-y-3">
                  <p className="text-sm font-medium">Show/Hide Sections</p>
                  {[
                    { key: 'utilised', label: 'Utilised Balance in Bank' },
                    { key: 'interTransfer', label: 'Inter Bank Transfer' },
                    { key: 'expenses', label: 'Expenses of the Day' },
                    { key: 'receipts', label: 'Receipt of the Day' },
                    { key: 'dp', label: 'DP / TOD Limit' },
                    { key: 'balanceToDraw', label: 'Balance to Draw' },
                    { key: 'interest', label: 'Interest Calculation' },
                  ].map((section) => (
                    <div key={section.key} className="flex items-center justify-between gap-3">
                      <span className="text-sm">{section.label}</span>
                      <Switch
                        checked={sectionVisibility[section.key as keyof typeof sectionVisibility]}
                        onCheckedChange={(checked) =>
                          toggleSectionVisibility(
                            section.key as keyof typeof sectionVisibility,
                            checked
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

            {filteredLogs.length > 0 && (
              <Badge variant="outline" className="shrink-0">
                {filteredLogs.length} record{filteredLogs.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0 overflow-hidden">
          <div className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-background">
            <ScrollArea
              className={cn(
                'h-[calc(100vh-22rem)]',
                viewMode === 'dateWise'
                  ? '[&_[data-orientation=vertical]]:mt-[5.5rem] [&_[data-orientation=vertical]]:h-[calc(100%-5.5rem)]'
                  : '[&_[data-orientation=vertical]]:mt-[2.75rem] [&_[data-orientation=vertical]]:h-[calc(100%-2.75rem)]'
              )}
              showHorizontalScrollbar
            >
            {viewMode === 'current' ? (
              <Table
                containerClassName="w-full overflow-visible"
                className="w-full min-w-[900px]"
              >
                <TableHeader className="sticky top-0 z-10 bg-background border-b border-border/60">
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-semibold">Date</TableHead>
                    <TableHead className="font-semibold">Bank</TableHead>
                    <TableHead className="font-semibold text-right">Opening</TableHead>
                    <TableHead className="font-semibold text-right">Payments</TableHead>
                    <TableHead className="font-semibold text-right">Receipts</TableHead>
                    <TableHead className="font-semibold text-right">Contra</TableHead>
                    <TableHead className="font-semibold text-right">Closing</TableHead>
                    <TableHead className="font-semibold text-right">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={8}><Skeleton className="h-6 rounded-lg" /></TableCell>
                      </TableRow>
                    ))
                    : filteredLogs.length > 0
                      ? filteredLogs.map(log => (
                        <TableRow key={log.id} className="hover:bg-muted/20 transition-colors">
                          <TableCell className="font-medium text-sm">
                            {format(new Date(log.date), 'dd MMM, yyyy')}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm font-medium">{log.accountName}</span>
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(log.openingBalance)}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn('text-sm font-medium', log.totalExpenses > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                              {log.totalExpenses > 0 ? `−${formatCurrency(log.totalExpenses)}` : '—'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={cn('text-sm font-medium', log.totalReceipts > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground')}>
                              {log.totalReceipts > 0 ? `+${formatCurrency(log.totalReceipts)}` : '—'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {log.totalContra !== 0 ? formatCurrency(log.totalContra) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold">{formatCurrency(log.closingBalance)}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn('text-sm font-bold', log.availableBalance < 0 ? 'text-red-600 dark:text-red-400' : 'text-primary')}>
                              {formatCurrency(log.availableBalance)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                      : (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center h-32 text-muted-foreground">
                            <div className="flex flex-col items-center gap-2">
                              <CalendarIcon className="h-8 w-8 opacity-30" />
                              <p>No logs found for the selected criteria.</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                  }
                </TableBody>
              </Table>
            ) : (
              <Table
                containerClassName="w-max overflow-visible"
                className="w-max min-w-[1200px]"
              >
                <TableHeader className="sticky top-0 z-10 bg-background border-b border-border/60">
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead rowSpan={2} className="sticky top-0 left-0 z-30 bg-muted/30 font-semibold border-r border-border/50 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <span>Date</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setDateSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
                          title={dateSortOrder === 'newest' ? 'Sorted by newest first. Click for oldest first.' : 'Sorted by oldest first. Click for newest first.'}
                          aria-label={dateSortOrder === 'newest' ? 'Sort by oldest first' : 'Sort by newest first'}
                        >
                          <ArrowUpDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableHead>
                    {sectionVisibility.utilised && (
                      <TableHead colSpan={selectedAccounts.length + 1} className="font-semibold text-center border-r border-border/50">Utilised Balance in Bank</TableHead>
                    )}
                    {sectionVisibility.interTransfer && (
                      <TableHead colSpan={selectedAccounts.length + 1} className="font-semibold text-center border-r border-border/50">Inter Bank Transfer</TableHead>
                    )}
                    {sectionVisibility.expenses && (
                      <TableHead colSpan={selectedAccounts.length + 1} className="font-semibold text-center border-r border-border/50">Expenses of the Day</TableHead>
                    )}
                    {sectionVisibility.receipts && (
                      <TableHead colSpan={selectedAccounts.length + 1} className="font-semibold text-center border-r border-border/50">Receipt of the Day</TableHead>
                    )}
                    {sectionVisibility.dp && (
                      <TableHead colSpan={selectedAccounts.length + 1} className="font-semibold text-center border-r border-border/50">DP / TOD Limit</TableHead>
                    )}
                    {sectionVisibility.balanceToDraw && (
                      <TableHead colSpan={selectedAccounts.length + 1} className="font-semibold text-center border-r border-border/50">Balance to Draw</TableHead>
                    )}
                    {sectionVisibility.interest && (
                      <TableHead colSpan={(selectedAccounts.length * 2) + 1} className="font-semibold text-center">Interest Calculation</TableHead>
                    )}
                  </TableRow>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    {sectionVisibility.utilised && (
                      <>
                        {selectedAccounts.map((acc) => (
                          <TableHead key={`util-head-${acc.id}`} className="font-semibold text-right">
                            {acc.shortName}
                          </TableHead>
                        ))}
                        <TableHead className="font-semibold text-right border-r border-border/50">Total</TableHead>
                      </>
                    )}

                    {sectionVisibility.interTransfer && (
                      <>
                        {selectedAccounts.map((acc) => (
                          <TableHead key={`contra-head-${acc.id}`} className="font-semibold text-right">
                            {acc.shortName}
                          </TableHead>
                        ))}
                        <TableHead className="font-semibold text-right border-r border-border/50">Total</TableHead>
                      </>
                    )}

                    {sectionVisibility.expenses && (
                      <>
                        {selectedAccounts.map((acc) => (
                          <TableHead key={`exp-head-${acc.id}`} className="font-semibold text-right">
                            {acc.shortName}
                          </TableHead>
                        ))}
                        <TableHead className="font-semibold text-right border-r border-border/50">Total</TableHead>
                      </>
                    )}

                    {sectionVisibility.receipts && (
                      <>
                        {selectedAccounts.map((acc) => (
                          <TableHead key={`rec-head-${acc.id}`} className="font-semibold text-right">
                            {acc.shortName}
                          </TableHead>
                        ))}
                        <TableHead className="font-semibold text-right border-r border-border/50">Total</TableHead>
                      </>
                    )}

                    {sectionVisibility.dp && (
                      <>
                        {selectedAccounts.map((acc) => (
                          <TableHead key={`dp-head-${acc.id}`} className="font-semibold text-right">
                            {acc.shortName}
                          </TableHead>
                        ))}
                        <TableHead className="font-semibold text-right border-r border-border/50">Total</TableHead>
                      </>
                    )}

                    {sectionVisibility.balanceToDraw && (
                      <>
                        {selectedAccounts.map((acc) => (
                          <TableHead key={`btd-head-${acc.id}`} className="font-semibold text-right">
                            {acc.shortName}
                          </TableHead>
                        ))}
                        <TableHead className="font-semibold text-right border-r border-border/50">Total</TableHead>
                      </>
                    )}

                    {sectionVisibility.interest && (
                      <>
                        {selectedAccounts.map((acc) => (
                          <TableHead key={`rate-head-${acc.id}`} className="font-semibold text-right">
                            Rate {acc.shortName}
                          </TableHead>
                        ))}
                        {selectedAccounts.map((acc) => (
                          <TableHead key={`int-head-${acc.id}`} className="font-semibold text-right">
                            Projected {acc.shortName}
                          </TableHead>
                        ))}
                        <TableHead className="font-semibold text-right">Total (Projected)</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dateWiseRows.length > 0 ? (
                    dateWiseRows.map((row) => (
                      <TableRow key={row.date} className="hover:bg-muted/20 transition-colors">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium text-sm border-r border-border/50">
                          {format(new Date(row.date), 'dd MMM, yyyy')}
                        </TableCell>

                        {sectionVisibility.utilised && (
                          <>
                            {selectedAccounts.map((acc) => (
                              <TableCell key={`${row.date}-util-${acc.id}`} className="text-right text-sm">
                                {row.utilisedByAccount[acc.id] ? formatCurrency(row.utilisedByAccount[acc.id]) : '—'}
                              </TableCell>
                            ))}
                            <TableCell className="text-right text-sm font-semibold border-r border-border/50">
                              {formatCurrency(selectedAccounts.reduce((s, acc) => s + row.utilisedByAccount[acc.id], 0))}
                            </TableCell>
                          </>
                        )}

                        {sectionVisibility.interTransfer && (
                          <>
                            {selectedAccounts.map((acc) => (
                              <TableCell key={`${row.date}-contra-${acc.id}`} className="text-right text-sm">
                                {row.interTransferByAccount[acc.id] ? formatCurrency(row.interTransferByAccount[acc.id]) : '—'}
                              </TableCell>
                            ))}
                            <TableCell className="text-right text-sm font-semibold border-r border-border/50">
                              {formatCurrency(selectedAccounts.reduce((s, acc) => s + row.interTransferByAccount[acc.id], 0))}
                            </TableCell>
                          </>
                        )}

                        {sectionVisibility.expenses && (
                          <>
                            {selectedAccounts.map((acc) => (
                              <TableCell key={`${row.date}-exp-${acc.id}`} className="text-right text-sm">
                                {row.expensesByAccount[acc.id] ? formatCurrency(row.expensesByAccount[acc.id]) : '—'}
                              </TableCell>
                            ))}
                            <TableCell className="text-right text-sm font-semibold border-r border-border/50">
                              {formatCurrency(selectedAccounts.reduce((s, acc) => s + row.expensesByAccount[acc.id], 0))}
                            </TableCell>
                          </>
                        )}

                        {sectionVisibility.receipts && (
                          <>
                            {selectedAccounts.map((acc) => (
                              <TableCell key={`${row.date}-rec-${acc.id}`} className="text-right text-sm">
                                {row.receiptsByAccount[acc.id] ? formatCurrency(row.receiptsByAccount[acc.id]) : '—'}
                              </TableCell>
                            ))}
                            <TableCell className="text-right text-sm font-semibold border-r border-border/50">
                              {formatCurrency(selectedAccounts.reduce((s, acc) => s + row.receiptsByAccount[acc.id], 0))}
                            </TableCell>
                          </>
                        )}

                        {sectionVisibility.dp && (
                          <>
                            {selectedAccounts.map((acc) => (
                              <TableCell key={`${row.date}-dp-${acc.id}`} className="text-right text-sm">
                                {row.dpByAccount[acc.id] ? formatCurrency(row.dpByAccount[acc.id]) : '—'}
                              </TableCell>
                            ))}
                            <TableCell className="text-right text-sm font-semibold border-r border-border/50">
                              {formatCurrency(selectedAccounts.reduce((s, acc) => s + row.dpByAccount[acc.id], 0))}
                            </TableCell>
                          </>
                        )}

                        {sectionVisibility.balanceToDraw && (
                          <>
                            {selectedAccounts.map((acc) => (
                              <TableCell key={`${row.date}-btd-${acc.id}`} className="text-right text-sm">
                                {row.balanceToDrawByAccount[acc.id] ? formatCurrency(row.balanceToDrawByAccount[acc.id]) : '—'}
                              </TableCell>
                            ))}
                            <TableCell className="text-right text-sm font-semibold border-r border-border/50">
                              {formatCurrency(selectedAccounts.reduce((s, acc) => s + row.balanceToDrawByAccount[acc.id], 0))}
                            </TableCell>
                          </>
                        )}

                        {sectionVisibility.interest && (
                          <>
                            {selectedAccounts.map((acc) => (
                              <TableCell key={`${row.date}-rate-${acc.id}`} className="text-right text-sm">
                                {row.interestRateByAccount[acc.id] > 0 ? `${row.interestRateByAccount[acc.id].toFixed(2)}%` : '—'}
                              </TableCell>
                            ))}
                            {selectedAccounts.map((acc) => (
                              <TableCell key={`${row.date}-int-${acc.id}`} className="text-right text-sm">
                                {row.interestProjectedByAccount[acc.id] ? formatCurrency(row.interestProjectedByAccount[acc.id]) : '—'}
                              </TableCell>
                            ))}
                            <TableCell className="text-right text-sm font-semibold">
                              {formatCurrency(selectedAccounts.reduce((s, acc) => s + row.interestProjectedByAccount[acc.id], 0))}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={Math.max(2, dateWiseColSpan)}
                        className="text-center h-32 text-muted-foreground"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <CalendarIcon className="h-8 w-8 opacity-30" />
                          <p>No date-wise logs found for the selected criteria.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </div>
    </>
  );
}
