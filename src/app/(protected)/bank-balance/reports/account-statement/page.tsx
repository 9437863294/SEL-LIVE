'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, FileText, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { BankAccount, BankExpense } from '@/lib/types';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';

interface TransactionRow {
  id: string;
  date: Date;
  description: string;
  ref: string;
  debit: number;
  credit: number;
  balance: number;
  isContra: boolean;
}

export default function AccountStatementPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [allExpenses, setAllExpenses] = useState<BankExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return format(d, 'yyyy-MM-dd');
  });
  const [toDate, setToDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

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

  const { openingBalance, statement } = useMemo<{ openingBalance: number; statement: TransactionRow[] }>(() => {
    if (!selectedAccount || !selectedAccountId) return { openingBalance: 0, statement: [] };

    const isCC = selectedAccount.accountType === 'Cash Credit';
    const from = new Date(fromDate + 'T00:00:00');
    const to = new Date(toDate + 'T23:59:59');

    const accountTxns = allExpenses
      .filter(t => t.accountId === selectedAccountId)
      .sort((a, b) => a.date.toMillis() - b.date.toMillis());

    // Calculate opening balance as of fromDate
    let running = isCC
      ? (selectedAccount.openingUtilization || 0)
      : (selectedAccount.openingBalance || 0);

    accountTxns.filter(t => t.date.toDate() < from).forEach(t => {
      if (isCC) running += t.type === 'Debit' ? t.amount : -t.amount;
      else running += t.type === 'Credit' ? t.amount : -t.amount;
    });

    const ob = running;

    const rows: TransactionRow[] = [];
    accountTxns.filter(t => { const d = t.date.toDate(); return d >= from && d <= to; }).forEach(t => {
      if (isCC) running += t.type === 'Debit' ? t.amount : -t.amount;
      else running += t.type === 'Credit' ? t.amount : -t.amount;
      rows.push({
        id: t.id,
        date: t.date.toDate(),
        description: t.description,
        ref: t.paymentRequestRefNo || t.paymentRefNo || t.utrNumber || '',
        debit: t.type === 'Debit' ? t.amount : 0,
        credit: t.type === 'Credit' ? t.amount : 0,
        balance: running,
        isContra: t.isContra,
      });
    });

    return { openingBalance: ob, statement: rows };
  }, [selectedAccount, selectedAccountId, allExpenses, fromDate, toDate]);

  const totalDebit = useMemo(() => statement.reduce((s, r) => s + r.debit, 0), [statement]);
  const totalCredit = useMemo(() => statement.reduce((s, r) => s + r.credit, 0), [statement]);

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
        <div className="mb-6 flex items-center gap-3">
          <Link href="/bank-balance/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <h1 className="text-xl font-bold">Account Statement</h1>
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
        <div className="absolute inset-0 bg-gradient-to-br from-amber-50/60 via-background to-orange-50/40 dark:from-amber-950/20 dark:via-background dark:to-orange-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-amber-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-orange-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(245,158,11,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>

      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <Link href="/bank-balance/reports">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-amber-50 dark:hover:bg-amber-950/30">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Account Statement
            </h1>
            <p className="text-xs text-muted-foreground">Transaction ledger with running balance for a selected account and date range.</p>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-5 rounded-xl border-border/60 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[220px]">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Account</Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger className="h-9">
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
                <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-9 w-40" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">To Date</Label>
                <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-9 w-40" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Opening Balance banner */}
        {selectedAccount && (
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-amber-200/60 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800/30 px-4 py-2 text-sm">
              <span className="text-muted-foreground text-xs">Opening Balance as of {format(new Date(fromDate), 'dd MMM yyyy')}</span>
              <span className={cn('font-bold', openingBalance < 0 ? 'text-red-600' : 'text-amber-700 dark:text-amber-400')}>
                {formatCurrency(openingBalance)}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2 text-sm">
              <span className="text-muted-foreground text-xs">Closing Balance</span>
              <span className={cn('font-bold', (statement[statement.length - 1]?.balance ?? openingBalance) < 0 ? 'text-red-600' : '')}>
                {formatCurrency(statement[statement.length - 1]?.balance ?? openingBalance)}
              </span>
            </div>
          </div>
        )}

        {/* Statement Table */}
        <Card className="rounded-xl border-border/60 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-border/40 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {selectedAccount
                    ? `${selectedAccount.bankName} — ${selectedAccount.accountNumber}`
                    : 'Select an account'}
                </CardTitle>
                <CardDescription>
                  {selectedAccount?.accountType} &nbsp;·&nbsp;
                  {fromDate && toDate
                    ? `${format(new Date(fromDate), 'dd MMM yyyy')} to ${format(new Date(toDate), 'dd MMM yyyy')}`
                    : ''}
                  &nbsp;·&nbsp; {statement.length} transaction{statement.length !== 1 ? 's' : ''}
                </CardDescription>
              </div>
              {selectedAccount && (
                <Badge variant="outline" className={cn('text-xs', selectedAccount.status === 'Active' ? 'border-green-200 text-green-700 bg-green-50 dark:bg-green-950/20' : 'border-gray-200')}>
                  {selectedAccount.status}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-semibold text-xs w-28">Date</TableHead>
                    <TableHead className="font-semibold text-xs">Description</TableHead>
                    <TableHead className="font-semibold text-xs w-36">Ref / UTR</TableHead>
                    <TableHead className="text-right font-semibold text-xs w-32">Debit</TableHead>
                    <TableHead className="text-right font-semibold text-xs w-32">Credit</TableHead>
                    <TableHead className="text-right font-semibold text-xs w-36">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center h-32 text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <Search className="h-8 w-8 opacity-30" />
                          <p className="text-sm">No transactions found for this period.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    statement.map(row => (
                      <TableRow key={row.id} className={cn('hover:bg-muted/20 text-xs transition-colors', row.isContra && 'opacity-65 italic')}>
                        <TableCell className="font-mono text-xs">{format(row.date, 'dd/MM/yyyy')}</TableCell>
                        <TableCell className="max-w-xs">
                          <span className="line-clamp-2">{row.description}</span>
                          {row.isContra && <span className="ml-1 text-[10px] text-muted-foreground not-italic">(Contra)</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.ref || '—'}</TableCell>
                        <TableCell className="text-right text-red-600 dark:text-red-400 font-mono text-xs">
                          {row.debit > 0 ? formatCurrency(row.debit) : ''}
                        </TableCell>
                        <TableCell className="text-right text-green-600 dark:text-green-400 font-mono text-xs">
                          {row.credit > 0 ? formatCurrency(row.credit) : ''}
                        </TableCell>
                        <TableCell className={cn('text-right font-semibold font-mono text-xs', row.balance < 0 ? 'text-red-600 dark:text-red-400' : '')}>
                          {formatCurrency(row.balance)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {statement.length > 0 && (
                  <TableFooter>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={3} className="font-bold text-xs">TOTAL</TableCell>
                      <TableCell className="text-right font-bold text-xs text-red-700 dark:text-red-400 font-mono">{formatCurrency(totalDebit)}</TableCell>
                      <TableCell className="text-right font-bold text-xs text-green-700 dark:text-green-400 font-mono">{formatCurrency(totalCredit)}</TableCell>
                      <TableCell className={cn('text-right font-bold text-xs font-mono', (statement[statement.length - 1]?.balance ?? 0) < 0 ? 'text-red-700' : '')}>
                        {formatCurrency(statement[statement.length - 1]?.balance ?? 0)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
