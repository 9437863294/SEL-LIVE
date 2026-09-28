'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import { ShieldAlert, CalendarDays, Search, Building2, CreditCard } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { TableCard } from '@/components/shared/table-card';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { format, eachDayOfInterval, startOfMonth, endOfMonth } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';

interface DailyRow {
  date: Date;
  dateKey: string;
  openingBalance: number;
  receipts: number;
  payments: number;
  contraIn: number;
  contraOut: number;
  txnCount: number;
  closingBalance: number;
}

export default function DailyBalancePage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [allExpenses, setAllExpenses] = useState<BankExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState<string>(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const canView = can('View', 'Bank Balance.Reports');

  useEffect(() => {
    if (authLoading) return;
    if (!canView) { setIsLoading(false); return; }

    const fetchData = async () => {
      try {
        const [accountsSnap, expensesSnap] = await Promise.all([
          getDocs(collection(db, 'bankAccounts')),
          getDocs(collection(db, 'bankExpenses')),
        ]);
        const accs = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount));
        accs.sort((a, b) => a.bankName.localeCompare(b.bankName));
        setAccounts(accs);
        setAllExpenses(expensesSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankExpense)));
        if (accs.length > 0) setSelectedAccountId(accs[0].id);
      } catch (error) {
        console.error(error);
        toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [authLoading, canView, toast]);

  const selectedAccount = useMemo(
    () => accounts.find(a => a.id === selectedAccountId),
    [accounts, selectedAccountId],
  );

  const { rows, openingBalance: periodOpening } = useMemo<{ rows: DailyRow[]; openingBalance: number }>(() => {
    if (!selectedAccount || !selectedAccountId) return { rows: [], openingBalance: 0 };

    const isCC = selectedAccount.accountType === 'Cash Credit';
    const from = new Date(fromDate + 'T00:00:00');
    const to = new Date(toDate + 'T23:59:59');

    if (from > to) return { rows: [], openingBalance: 0 };

    const accountTxns = allExpenses
      .filter(t => t.accountId === selectedAccountId)
      .sort((a, b) => a.date.toMillis() - b.date.toMillis());

    // Running balance up to start of period
    let running = isCC
      ? (selectedAccount.openingUtilization || 0)
      : (selectedAccount.openingBalance || 0);

    accountTxns.filter(t => t.date.toDate() < from).forEach(t => {
      if (isCC) running += t.type === 'Debit' ? t.amount : -t.amount;
      else running += t.type === 'Credit' ? t.amount : -t.amount;
    });

    const periodOpening = running;
    const days = eachDayOfInterval({ start: from, end: to });

    const dailyRows: DailyRow[] = days.map(day => {
      const dateKey = format(day, 'yyyy-MM-dd');
      const dayStart = new Date(dateKey + 'T00:00:00');
      const dayEnd = new Date(dateKey + 'T23:59:59');

      const dayTxns = accountTxns.filter(t => {
        const d = t.date.toDate();
        return d >= dayStart && d <= dayEnd;
      });

      const receipts = dayTxns.filter(t => t.type === 'Credit' && !t.isContra).reduce((s, t) => s + t.amount, 0);
      const payments = dayTxns.filter(t => t.type === 'Debit' && !t.isContra).reduce((s, t) => s + t.amount, 0);
      const contraIn = dayTxns.filter(t => t.type === 'Credit' && t.isContra).reduce((s, t) => s + t.amount, 0);
      const contraOut = dayTxns.filter(t => t.type === 'Debit' && t.isContra).reduce((s, t) => s + t.amount, 0);

      const openingBalance = running;

      dayTxns.forEach(t => {
        if (isCC) running += t.type === 'Debit' ? t.amount : -t.amount;
        else running += t.type === 'Credit' ? t.amount : -t.amount;
      });

      return {
        date: day,
        dateKey,
        openingBalance,
        receipts,
        payments,
        contraIn,
        contraOut,
        txnCount: dayTxns.length,
        closingBalance: running,
      };
    });

    return { rows: dailyRows, openingBalance: periodOpening };
  }, [selectedAccount, selectedAccountId, allExpenses, fromDate, toDate]);

  const activeRows = useMemo(() => rows.filter(r => r.txnCount > 0), [rows]);
  const totalReceipts = useMemo(() => rows.reduce((s, r) => s + r.receipts, 0), [rows]);
  const totalPayments = useMemo(() => rows.reduce((s, r) => s + r.payments, 0), [rows]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(v || 0);

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4 py-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <PageHeader title="Daily Balance Report" backHref="/bank-balance/reports" backLabel="Back to reports" />
        <Card>
          <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  const closingBalance = rows[rows.length - 1]?.closingBalance ?? periodOpening;

  return (
    <>
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-50/60 via-background to-emerald-50/40 dark:from-teal-950/20 dark:via-background dark:to-emerald-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-teal-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-emerald-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(20,184,166,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
        {/* Header */}
        <PageHeader
          title="Daily Balance Report"
          description="Day-by-day opening and closing balance for a selected account."
          icon={CalendarDays}
          backHref="/bank-balance/reports"
          backLabel="Back to reports"
        />

        {/* Filters */}
        <Card className="mb-5 rounded-xl border-border/60 shadow-sm">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr] sm:items-end">
              <div className="min-w-0">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Account</Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map(acc => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.bankName} — {acc.shortName} ({acc.accountType})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">From Date</Label>
                <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">To Date</Label>
                <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary strip */}
        {selectedAccount && rows.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-3">
            {[
              { label: 'Opening Balance', value: periodOpening, color: '' },
              { label: 'Total Receipts', value: totalReceipts, color: 'text-green-700 dark:text-green-400' },
              { label: 'Total Payments', value: totalPayments, color: 'text-red-700 dark:text-red-400' },
              { label: 'Closing Balance', value: closingBalance, color: closingBalance < 0 ? 'text-red-600' : 'text-teal-700 dark:text-teal-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className={cn('font-bold text-sm', color)}>{formatCurrency(value)}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2">
              <span className="text-xs text-muted-foreground">Active Days</span>
              <span className="font-bold text-sm">{activeRows.length} / {rows.length}</span>
            </div>
          </div>
        )}

        {/* Table */}
        <TableCard
          icon={selectedAccount?.accountType === 'Cash Credit' ? CreditCard : Building2}
          title={
            selectedAccount
              ? `${selectedAccount.bankName} — ${selectedAccount.accountNumber}`
              : 'Select an account'
          }
          description={
            fromDate && toDate
              ? `${format(new Date(fromDate), 'dd MMM yyyy')} to ${format(new Date(toDate), 'dd MMM yyyy')}`
              : undefined
          }
          count={rows.length}
          noun="day"
          actions={selectedAccount ? <Badge variant="neutral">{selectedAccount.accountType}</Badge> : undefined}
        >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead className="w-10 text-center">Txns</TableHead>
                    <TableHead className="text-right">Opening Balance</TableHead>
                    <TableHead className="text-right">Receipts</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                    <TableHead className="text-right">Transfers In/Out</TableHead>
                    <TableHead className="text-right">Closing Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center h-32 text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <Search className="h-8 w-8 opacity-30" />
                          <p className="text-sm">Select an account and date range to view daily balances.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : rows.map(row => {
                    const hasActivity = row.txnCount > 0;
                    return (
                      <TableRow
                        key={row.dateKey}
                        className={cn(!hasActivity && 'opacity-60')}
                      >
                        <TableCell className="whitespace-nowrap font-mono font-medium">
                          {format(row.date, 'dd MMM yyyy')}
                          <span className="text-[10px] text-muted-foreground ml-1">{format(row.date, 'EEE')}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          {hasActivity ? (
                            <Badge variant="neutral">{row.txnCount}</Badge>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{formatCurrency(row.openingBalance)}</TableCell>
                        <TableCell className={cn('whitespace-nowrap text-right font-mono', row.receipts > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground')}>
                          {row.receipts > 0 ? formatCurrency(row.receipts) : '—'}
                        </TableCell>
                        <TableCell className={cn('whitespace-nowrap text-right font-mono', row.payments > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                          {row.payments > 0 ? formatCurrency(row.payments) : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">
                          {(row.contraIn > 0 || row.contraOut > 0)
                            ? <span>{row.contraIn > 0 ? `+${formatCurrency(row.contraIn)}` : ''}{row.contraIn > 0 && row.contraOut > 0 ? ' / ' : ''}{row.contraOut > 0 ? `-${formatCurrency(row.contraOut)}` : ''}</span>
                            : '—'}
                        </TableCell>
                        <TableCell className={cn('whitespace-nowrap text-right font-medium font-mono', row.closingBalance < 0 ? 'text-red-600 dark:text-red-400' : '')}>
                          {formatCurrency(row.closingBalance)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {rows.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={2}>PERIOD TOTAL</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{formatCurrency(periodOpening)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-green-700 dark:text-green-400 font-mono">{formatCurrency(totalReceipts)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-red-700 dark:text-red-400 font-mono">{formatCurrency(totalPayments)}</TableCell>
                      <TableCell />
                      <TableCell className={cn('whitespace-nowrap text-right font-mono', closingBalance < 0 ? 'text-red-700' : 'text-teal-700 dark:text-teal-400')}>
                        {formatCurrency(closingBalance)}
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
