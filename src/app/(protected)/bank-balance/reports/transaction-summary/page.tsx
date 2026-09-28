'use client';
export const dynamic = 'force-dynamic';

import { Fragment, useState, useEffect, useMemo } from 'react';
import { ShieldAlert, LayoutGrid, Building2, CreditCard } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableCard } from '@/components/shared/table-card';
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
        <PageHeader title="Transaction Summary" backHref="/bank-balance/reports" backLabel="Back to reports" />
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
        <PageHeader
          title="Transaction Summary"
          description="Account-wise monthly receipts, payments, and net cashflow."
          icon={LayoutGrid}
          backHref="/bank-balance/reports"
          backLabel="Back to reports"
        />

        {/* Filters */}
        <Card className="mb-5 rounded-xl border-border/60 shadow-sm">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-end lg:max-w-2xl">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Date Range</Label>
                <Select value={rangeOption} onValueChange={v => setRangeOption(v as RangeOption)}>
                  <SelectTrigger>
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
                  <SelectTrigger>
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
        <TableCard
          title="Monthly Breakdown by Account"
          description={
            <>
              {format(months[0] ?? new Date(), 'MMM yyyy')} — {format(months[months.length - 1] ?? new Date(), 'MMM yyyy')}
              &nbsp;·&nbsp; {months.length} month{months.length !== 1 ? 's' : ''}
              {excludeContra && ' · Contra excluded'}
            </>
          }
          count={summaryRows.length}
          noun="account"
        >
              <Table className="w-max min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead rowSpan={2} className="sticky left-0 !z-30 min-w-[180px] border-r">Account</TableHead>
                    {months.map(m => (
                      <TableHead key={format(m, 'yyyy-MM')} colSpan={3} className="text-center border-l">
                        {format(m, 'MMM yyyy')}
                      </TableHead>
                    ))}
                    <TableHead colSpan={3} className="text-center border-l">
                      Total
                    </TableHead>
                  </TableRow>
                  <TableRow className="[&>th]:!top-[var(--table-head-h,2.5rem)]">
                    {[...months.map(m => format(m, 'yyyy-MM')), 'total'].map(key => (
                      <Fragment key={`${key}-sub`}>
                        <TableHead className="text-right border-l">Receipts</TableHead>
                        <TableHead className="text-right">Payments</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                      </Fragment>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={1 + months.length * 3 + 3} className="text-center py-12 text-muted-foreground">
                        No accounts found.
                      </TableCell>
                    </TableRow>
                  ) : summaryRows.map(row => (
                    <TableRow key={row.account.id}>
                      <TableCell className="sticky left-0 z-[1] border-r bg-background font-medium">
                        <div className="flex items-center gap-1.5">
                          {row.account.accountType === 'Cash Credit'
                            ? <CreditCard className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                            : <Building2 className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                          }
                          <div>
                            <p className="leading-none">{row.account.shortName}</p>
                            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">{row.account.bankName}</p>
                          </div>
                        </div>
                      </TableCell>
                      {months.map(m => {
                        const mk = format(m, 'yyyy-MM');
                        const cell = row.months[mk] || { receipts: 0, payments: 0, net: 0 };
                        const hasActivity = cell.receipts > 0 || cell.payments > 0;
                        return (
                          <Fragment key={mk}>
                            <TableCell className={cn('whitespace-nowrap border-l text-right font-mono text-green-700 dark:text-green-400', !hasActivity && 'opacity-30')}>
                              {cell.receipts > 0 ? formatCurrency(cell.receipts) : '—'}
                            </TableCell>
                            <TableCell className={cn('whitespace-nowrap text-right font-mono text-red-700 dark:text-red-400', !hasActivity && 'opacity-30')}>
                              {cell.payments > 0 ? formatCurrency(cell.payments) : '—'}
                            </TableCell>
                            <TableCell className={cn('whitespace-nowrap text-right font-medium font-mono', cell.net < 0 ? 'text-red-600' : cell.net > 0 ? 'text-emerald-600' : 'text-muted-foreground', !hasActivity && 'opacity-30')}>
                              {hasActivity ? formatCurrency(cell.net) : '—'}
                            </TableCell>
                          </Fragment>
                        );
                      })}
                      <TableCell className="whitespace-nowrap border-l text-right font-medium font-mono text-green-700 dark:text-green-400">{formatCurrency(row.totalReceipts)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium font-mono text-red-700 dark:text-red-400">{formatCurrency(row.totalPayments)}</TableCell>
                      <TableCell className={cn('whitespace-nowrap text-right font-medium font-mono', row.totalNet < 0 ? 'text-red-600' : 'text-emerald-600')}>{formatCurrency(row.totalNet)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {/* Grand Total Footer */}
                {summaryRows.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell className="sticky left-0 z-[1] border-r bg-slate-50">GRAND TOTAL</TableCell>
                      {months.map(m => {
                        const mk = format(m, 'yyyy-MM');
                        const cell = grandRow.months[mk] || { receipts: 0, payments: 0, net: 0 };
                        return (
                          <Fragment key={mk}>
                            <TableCell className="whitespace-nowrap border-l text-right font-mono text-green-700">{formatCurrency(cell.receipts)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right font-mono text-red-700">{formatCurrency(cell.payments)}</TableCell>
                            <TableCell className={cn('whitespace-nowrap text-right font-mono', cell.net < 0 ? 'text-red-700' : 'text-emerald-700')}>{formatCurrency(cell.net)}</TableCell>
                          </Fragment>
                        );
                      })}
                      <TableCell className="whitespace-nowrap border-l text-right font-mono text-green-700">{formatCurrency(grandRow.totalReceipts)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-red-700">{formatCurrency(grandRow.totalPayments)}</TableCell>
                      <TableCell className={cn('whitespace-nowrap text-right font-mono', grandRow.totalNet < 0 ? 'text-red-700' : 'text-emerald-700')}>{formatCurrency(grandRow.totalNet)}</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
        </TableCard>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-sky-500" /> Current Account</div>
          <div className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 text-violet-500" /> Cash Credit</div>
          <Badge variant="success">Receipts = Credits</Badge>
          <Badge variant="danger">Payments = Debits</Badge>
        </div>
      </div>
    </>
  );
}
