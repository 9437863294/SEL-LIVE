'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, LayoutGrid, Building2, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { format, subMonths, startOfMonth, endOfMonth, eachMonthOfInterval } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';

type RangeOption = '3' | '6' | '12' | 'ytd';

interface MonthCell {
  receipts: number;
  payments: number;
  net: number;
}

interface AccountSummaryRow {
  account: BankAccount;
  months: Record<string, MonthCell>;
  totalReceipts: number;
  totalPayments: number;
  totalNet: number;
}

function getRangeMonths(option: RangeOption): { start: Date; end: Date } {
  const today = new Date();
  const end = endOfMonth(today);
  if (option === 'ytd') {
    return { start: startOfMonth(new Date(today.getFullYear(), 0, 1)), end };
  }
  return { start: startOfMonth(subMonths(today, parseInt(option) - 1)), end };
}

export default function TransactionSummaryPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [allExpenses, setAllExpenses] = useState<BankExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rangeOption, setRangeOption] = useState<RangeOption>('6');
  const [excludeContra, setExcludeContra] = useState<boolean>(true);

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
      } catch (error) {
        console.error(error);
        toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchData();
  }, [authLoading, canView, toast]);

  const { months, summaryRows, grandRow } = useMemo(() => {
    const { start, end } = getRangeMonths(rangeOption);
    const monthDates = eachMonthOfInterval({ start, end });
    const monthKeys = monthDates.map(d => format(d, 'yyyy-MM'));

    const txns = excludeContra ? allExpenses.filter(t => !t.isContra) : allExpenses;

    const rows: AccountSummaryRow[] = accounts.map(account => {
      const accountTxns = txns.filter(t => t.accountId === account.id);
      const monthCells: Record<string, MonthCell> = {};

      monthKeys.forEach(mk => {
        const monthTxns = accountTxns.filter(t => format(t.date.toDate(), 'yyyy-MM') === mk);
        const receipts = monthTxns.filter(t => t.type === 'Credit').reduce((s, t) => s + t.amount, 0);
        const payments = monthTxns.filter(t => t.type === 'Debit').reduce((s, t) => s + t.amount, 0);
        monthCells[mk] = { receipts, payments, net: receipts - payments };
      });

      const totalReceipts = Object.values(monthCells).reduce((s, c) => s + c.receipts, 0);
      const totalPayments = Object.values(monthCells).reduce((s, c) => s + c.payments, 0);
      return { account, months: monthCells, totalReceipts, totalPayments, totalNet: totalReceipts - totalPayments };
    });

    // Grand total row
    const grandMonths: Record<string, MonthCell> = {};
    monthKeys.forEach(mk => {
      const receipts = rows.reduce((s, r) => s + (r.months[mk]?.receipts || 0), 0);
      const payments = rows.reduce((s, r) => s + (r.months[mk]?.payments || 0), 0);
      grandMonths[mk] = { receipts, payments, net: receipts - payments };
    });
    const grandReceipts = rows.reduce((s, r) => s + r.totalReceipts, 0);
    const grandPayments = rows.reduce((s, r) => s + r.totalPayments, 0);
    const grandRow = { months: grandMonths, totalReceipts: grandReceipts, totalPayments: grandPayments, totalNet: grandReceipts - grandPayments };

    return { months: monthDates, summaryRows: rows, grandRow };
  }, [accounts, allExpenses, rangeOption, excludeContra]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v || 0);

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4 py-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/bank-balance/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <h1 className="text-xl font-bold">Transaction Summary</h1>
        </div>
        <Card>
          <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-50/60 via-background to-cyan-50/40 dark:from-sky-950/20 dark:via-background dark:to-cyan-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-sky-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-cyan-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(14,165,233,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <Link href="/bank-balance/reports">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-sky-50 dark:hover:bg-sky-950/30">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-sky-600 dark:text-sky-400" />
              Transaction Summary
            </h1>
            <p className="text-xs text-muted-foreground">Account-wise monthly receipts, payments, and net cashflow.</p>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-5 rounded-xl border-border/60 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Date Range</Label>
                <Select value={rangeOption} onValueChange={v => setRangeOption(v as RangeOption)}>
                  <SelectTrigger className="h-9 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">Last 3 Months</SelectItem>
                    <SelectItem value="6">Last 6 Months</SelectItem>
                    <SelectItem value="12">Last 12 Months</SelectItem>
                    <SelectItem value="ytd">Year to Date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Transaction Type</Label>
                <Select value={excludeContra ? 'exclude' : 'include'} onValueChange={v => setExcludeContra(v === 'exclude')}>
                  <SelectTrigger className="h-9 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exclude">Exclude Contra / Transfers</SelectItem>
                    <SelectItem value="include">Include All Transactions</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary Table */}
        <Card className="rounded-xl border-border/60 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-border/40 pb-4">
            <CardTitle className="text-base">Monthly Breakdown by Account</CardTitle>
            <CardDescription>
              {format(months[0] ?? new Date(), 'MMM yyyy')} — {format(months[months.length - 1] ?? new Date(), 'MMM yyyy')}
              &nbsp;·&nbsp; {months.length} month{months.length !== 1 ? 's' : ''}
              {excludeContra && ' · Contra excluded'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                {/* Header */}
                <thead>
                  <tr className="bg-muted/40 border-b border-border/40">
                    <th className="sticky left-0 bg-muted/40 text-left font-semibold px-3 py-2.5 min-w-[180px] z-10">Account</th>
                    {months.map(m => (
                      <th key={format(m, 'yyyy-MM')} colSpan={3} className="text-center font-semibold px-2 py-2.5 min-w-[180px] border-l border-border/20">
                        {format(m, 'MMM yyyy')}
                      </th>
                    ))}
                    <th colSpan={3} className="text-center font-semibold px-2 py-2.5 min-w-[180px] border-l border-border/40 bg-primary/5">
                      Total
                    </th>
                  </tr>
                  <tr className="bg-muted/20 border-b border-border/40">
                    <th className="sticky left-0 bg-muted/20 z-10" />
                    {months.map(m => (
                      <th key={format(m, 'yyyy-MM') + '-sub'} className="border-l border-border/20" colSpan={3}>
                        <div className="grid grid-cols-3 text-[10px] font-medium text-muted-foreground">
                          <span className="px-2 py-1 text-green-700 dark:text-green-400">Receipts</span>
                          <span className="px-2 py-1 text-red-700 dark:text-red-400">Payments</span>
                          <span className="px-2 py-1">Net</span>
                        </div>
                      </th>
                    ))}
                    <th className="border-l border-border/40 bg-primary/5" colSpan={3}>
                      <div className="grid grid-cols-3 text-[10px] font-medium text-muted-foreground">
                        <span className="px-2 py-1 text-green-700 dark:text-green-400">Receipts</span>
                        <span className="px-2 py-1 text-red-700 dark:text-red-400">Payments</span>
                        <span className="px-2 py-1">Net</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.length === 0 ? (
                    <tr>
                      <td colSpan={1 + months.length * 3 + 3} className="text-center py-12 text-muted-foreground">
                        No accounts found.
                      </td>
                    </tr>
                  ) : summaryRows.map((row, idx) => (
                    <tr key={row.account.id} className={cn('border-b border-border/20 hover:bg-muted/10 transition-colors', idx % 2 === 1 && 'bg-muted/5')}>
                      <td className={cn('sticky left-0 z-10 px-3 py-2 font-medium', idx % 2 === 1 ? 'bg-muted/10' : 'bg-background')}>
                        <div className="flex items-center gap-1.5">
                          {row.account.accountType === 'Cash Credit'
                            ? <CreditCard className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                            : <Building2 className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                          }
                          <div>
                            <p className="font-semibold leading-none">{row.account.shortName}</p>
                            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">{row.account.bankName}</p>
                          </div>
                        </div>
                      </td>
                      {months.map(m => {
                        const mk = format(m, 'yyyy-MM');
                        const cell = row.months[mk] || { receipts: 0, payments: 0, net: 0 };
                        const hasActivity = cell.receipts > 0 || cell.payments > 0;
                        return (
                          <td key={mk} colSpan={3} className="border-l border-border/10 p-0">
                            <div className={cn('grid grid-cols-3', !hasActivity && 'opacity-30')}>
                              <span className="px-2 py-2 text-green-700 dark:text-green-400 font-mono text-right">
                                {cell.receipts > 0 ? formatCurrency(cell.receipts) : '—'}
                              </span>
                              <span className="px-2 py-2 text-red-700 dark:text-red-400 font-mono text-right">
                                {cell.payments > 0 ? formatCurrency(cell.payments) : '—'}
                              </span>
                              <span className={cn('px-2 py-2 font-semibold font-mono text-right', cell.net < 0 ? 'text-red-600' : cell.net > 0 ? 'text-emerald-600' : 'text-muted-foreground')}>
                                {hasActivity ? formatCurrency(cell.net) : '—'}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                      <td colSpan={3} className="border-l border-border/40 bg-primary/3 p-0">
                        <div className="grid grid-cols-3">
                          <span className="px-2 py-2 text-green-700 dark:text-green-400 font-mono font-semibold text-right">{formatCurrency(row.totalReceipts)}</span>
                          <span className="px-2 py-2 text-red-700 dark:text-red-400 font-mono font-semibold text-right">{formatCurrency(row.totalPayments)}</span>
                          <span className={cn('px-2 py-2 font-bold font-mono text-right', row.totalNet < 0 ? 'text-red-600' : 'text-emerald-600')}>{formatCurrency(row.totalNet)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Grand Total Footer */}
                {summaryRows.length > 0 && (
                  <tfoot>
                    <tr className="bg-muted/40 border-t-2 border-border/60 font-bold">
                      <td className="sticky left-0 bg-muted/40 z-10 px-3 py-2.5 font-bold text-xs">GRAND TOTAL</td>
                      {months.map(m => {
                        const mk = format(m, 'yyyy-MM');
                        const cell = grandRow.months[mk] || { receipts: 0, payments: 0, net: 0 };
                        return (
                          <td key={mk} colSpan={3} className="border-l border-border/20 p-0">
                            <div className="grid grid-cols-3">
                              <span className="px-2 py-2.5 text-green-700 font-mono font-bold text-right">{formatCurrency(cell.receipts)}</span>
                              <span className="px-2 py-2.5 text-red-700 font-mono font-bold text-right">{formatCurrency(cell.payments)}</span>
                              <span className={cn('px-2 py-2.5 font-bold font-mono text-right', cell.net < 0 ? 'text-red-700' : 'text-emerald-700')}>{formatCurrency(cell.net)}</span>
                            </div>
                          </td>
                        );
                      })}
                      <td colSpan={3} className="border-l border-border/40 bg-primary/5 p-0">
                        <div className="grid grid-cols-3">
                          <span className="px-2 py-2.5 text-green-700 font-mono font-bold text-right">{formatCurrency(grandRow.totalReceipts)}</span>
                          <span className="px-2 py-2.5 text-red-700 font-mono font-bold text-right">{formatCurrency(grandRow.totalPayments)}</span>
                          <span className={cn('px-2 py-2.5 font-bold font-mono text-right', grandRow.totalNet < 0 ? 'text-red-700' : 'text-emerald-700')}>{formatCurrency(grandRow.totalNet)}</span>
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-sky-500" /> Current Account</div>
          <div className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 text-violet-500" /> Cash Credit</div>
          <Badge variant="outline" className="text-[10px] border-green-200 text-green-700 bg-green-50">Receipts = Credits</Badge>
          <Badge variant="outline" className="text-[10px] border-red-200 text-red-700 bg-red-50">Payments = Debits</Badge>
        </div>
      </div>
    </>
  );
}
