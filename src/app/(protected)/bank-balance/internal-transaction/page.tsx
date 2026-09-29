'use client';
export const dynamic = 'force-dynamic';

/**
 * Transfers: every internal transfer (a Debit and a Credit contra leg sharing a `contraId`), with
 * edit and delete. The Internal Transfers report was a second copy of this list; its account
 * filter, description column and totals were folded in here and its address now redirects.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { DateRange } from 'react-day-picker';
import { compareDesc, endOfDay, startOfDay } from 'date-fns';
import { collection, doc, getDocs, query, Timestamp, where, writeBatch } from 'firebase/firestore';
import { ArrowRight, ArrowRightLeft, Loader2, Pencil, Plus, Route, Save, Trash2, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import {
  BANK_PAGE,
  BankAccessDenied,
  BankBalanceBackground,
  BankDateRangeFilter,
  BankPageSkeleton,
  accountLabel,
} from '@/components/bank-balance/page-kit';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { diffFields } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { balanceAt, buildLedger, dayKey, formatDay, formatInr, isCashCredit, parseDay, txnDate } from '@/lib/bank-balance-ledger';
import type { DateRangePreset } from '@/lib/date-range-presets';
import type { BankAccount, BankExpense } from '@/lib/types';

type Transfer = {
  id: string; // contraId
  contraId: string;
  at: Date;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description: string;
};

type EditForm = { day: string; fromAccountId: string; toAccountId: string; amount: string };

const EMPTY_FORM: EditForm = { day: '', fromAccountId: '', toAccountId: '', amount: '' };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * What the account can pay out at the end of `day`, from the engine (so the opening date is
 * honoured): a Current Account's balance, or a Cash Credit account's limit in force less its
 * utilisation.
 */
const availableOn = (account: BankAccount, txns: BankExpense[], day: Date) => {
  const figure = balanceAt(buildLedger(account, txns), day);
  return isCashCredit(account) ? getApplicableCcLimit(account, day) - figure : figure;
};

/** Pairs the contra legs into transfers, newest first; a transfer missing a leg is left out. */
function groupTransfers(expenses: BankExpense[]): Transfer[] {
  const legs = expenses.filter((entry) => entry.isContra).sort((a, b) => compareDesc(txnDate(a), txnDate(b)));
  const grouped = new Map<string, Partial<Transfer>>();
  for (const leg of legs) {
    const contraId = leg.contraId;
    if (!contraId) continue;
    let transfer = grouped.get(contraId);
    if (!transfer) {
      transfer = { id: contraId, contraId, amount: leg.amount, at: txnDate(leg), description: '' };
      grouped.set(contraId, transfer);
    }
    if (leg.type === 'Debit') {
      transfer.fromAccountId = leg.accountId;
      transfer.description = leg.description || transfer.description;
    } else if (leg.type === 'Credit') {
      transfer.toAccountId = leg.accountId;
      transfer.description = transfer.description || leg.description || '';
    }
  }
  return Array.from(grouped.values()).filter(
    (transfer): transfer is Transfer => Boolean(transfer.fromAccountId && transfer.toAccountId),
  );
}

export default function InternalTransactionPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [datePreset, setDatePreset] = useState<DateRangePreset>('custom');
  const [accountFilter, setAccountFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'current' | 'dateWise'>('current');

  const [editingEntry, setEditingEntry] = useState<Transfer | null>(null);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Transfer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reports access also opens this list read-only: it absorbed the Inter-bank Transfers report,
  // which only needed Reports View, so nobody who could read that report loses it.
  const canView =
    !authLoading && (can('View', 'Bank Balance.Internal Transaction') || can('View', 'Bank Balance.Reports'));
  const canAdd = !authLoading && can('Add', 'Bank Balance.Internal Transaction');
  const canEdit = !authLoading && (can('Edit', 'Bank Balance.Internal Transaction') || canAdd);
  const canDelete = !authLoading && can('Delete', 'Bank Balance.Internal Transaction');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      try {
        const [accountsSnap, expensesSnap] = await Promise.all([
          getDocs(collection(db, 'bankAccounts')),
          getDocs(collection(db, 'bankExpenses')),
        ]);
        setBankAccounts(
          accountsSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as BankAccount))
            .sort((a, b) => accountLabel(a).localeCompare(accountLabel(b))),
        );
        setAllTransactions(expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankExpense)));
      } catch (error) {
        console.error('Error fetching data:', error);
        toast({ title: 'Error', description: 'Failed to load transfers.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (authLoading) return;
    if (canView) void load();
    else setIsLoading(false);
  }, [authLoading, canView, load]);

  const accountById = useMemo(() => new Map(bankAccounts.map((account) => [account.id, account])), [bankAccounts]);
  const nameOf = useCallback(
    (accountId: string) => (accountById.has(accountId) ? accountLabel(accountById.get(accountId)) : 'N/A'),
    [accountById],
  );

  const transfers = useMemo(() => groupTransfers(allTransactions), [allTransactions]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = dateRange?.from ? startOfDay(dateRange.from) : null;
    const to = dateRange?.to ? endOfDay(dateRange.to) : null;
    return transfers.filter((transfer) => {
      if (from && transfer.at < from) return false;
      if (to && transfer.at > to) return false;
      if (accountFilter !== 'all' && transfer.fromAccountId !== accountFilter && transfer.toAccountId !== accountFilter) return false;
      if (!term) return true;
      return [transfer.description, nameOf(transfer.fromAccountId), nameOf(transfer.toAccountId)].some((value) =>
        value.toLowerCase().includes(term),
      );
    });
  }, [transfers, dateRange, accountFilter, search, nameOf]);

  const summary = useMemo(() => {
    const total = filtered.reduce((sum, transfer) => sum + (Number(transfer.amount) || 0), 0);
    const routes = new Map<string, { fromAccountId: string; toAccountId: string; count: number; amount: number }>();
    for (const transfer of filtered) {
      const key = `${transfer.fromAccountId}>${transfer.toAccountId}`;
      const route = routes.get(key) ?? { fromAccountId: transfer.fromAccountId, toAccountId: transfer.toAccountId, count: 0, amount: 0 };
      route.count += 1;
      route.amount += Number(transfer.amount) || 0;
      routes.set(key, route);
    }
    const topRoute = Array.from(routes.values()).sort((a, b) => b.count - a.count || b.amount - a.amount)[0];
    return { total, topRoute };
  }, [filtered]);

  // Date-wise pivot: one column per route, keyed by account ids so two accounts sharing a short
  // name do not merge.
  const routeColumns = useMemo(() => {
    const keys = new Map<string, string>();
    for (const transfer of filtered) {
      keys.set(`${transfer.fromAccountId}>${transfer.toAccountId}`, `${nameOf(transfer.fromAccountId)} → ${nameOf(transfer.toAccountId)}`);
    }
    return Array.from(keys, ([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered, nameOf]);

  const dateWiseRows = useMemo(() => {
    const grouped = new Map<string, { key: string; totals: Record<string, number>; total: number }>();
    for (const transfer of filtered) {
      const key = dayKey(transfer.at);
      const row = grouped.get(key) ?? { key, totals: {}, total: 0 };
      const route = `${transfer.fromAccountId}>${transfer.toAccountId}`;
      const amount = Number(transfer.amount) || 0;
      row.totals[route] = (row.totals[route] || 0) + amount;
      row.total += amount;
      grouped.set(key, row);
    }
    return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered]);

  // The edit dialog's figures, with the transfer being edited left out of the history.
  // An unchanged day keeps the saved timestamp; a new day is that day's local midnight.
  const editDate = useMemo(
    () => (editingEntry ? (form.day === dayKey(editingEntry.at) ? editingEntry.at : parseDay(form.day)) : null),
    [editingEntry, form.day],
  );
  const editFromAccount = form.fromAccountId ? accountById.get(form.fromAccountId) : undefined;
  const editAvailable = useMemo(() => {
    if (!editingEntry || !editDate || !editFromAccount) return null;
    return availableOn(
      editFromAccount,
      allTransactions.filter((txn) => txn.contraId !== editingEntry.contraId),
      editDate,
    );
  }, [allTransactions, editDate, editFromAccount, editingEntry]);

  const editOptions = useMemo(
    () =>
      bankAccounts.filter(
        (account) =>
          account.status === 'Active' ||
          account.id === editingEntry?.fromAccountId ||
          account.id === editingEntry?.toAccountId,
      ),
    [bankAccounts, editingEntry],
  );

  const openEditDialog = (transfer: Transfer) => {
    setEditingEntry(transfer);
    setForm({
      day: dayKey(transfer.at),
      fromAccountId: transfer.fromAccountId,
      toAccountId: transfer.toAccountId,
      amount: String(transfer.amount || ''),
    });
  };

  const resetEditDialog = () => {
    setEditingEntry(null);
    setForm(EMPTY_FORM);
    setIsEditSaving(false);
  };

  const handleEditTransaction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingEntry) return;

    if (!canEdit) {
      toast({ title: 'Not allowed', description: 'You do not have permission to edit internal transactions.', variant: 'destructive' });
      return;
    }

    const amount = Number(form.amount);
    if (!editDate) {
      toast({ title: 'Validation Error', description: 'Enter the transfer date.', variant: 'destructive' });
      return;
    }
    // As on New Transfer, a transfer cannot be dated ahead. One already dated ahead keeps its day.
    if (form.day !== dayKey(editingEntry.at) && editDate > endOfDay(new Date())) {
      toast({ title: 'Validation Error', description: 'A transfer cannot be dated after today.', variant: 'destructive' });
      return;
    }
    if (
      !form.fromAccountId ||
      !form.toAccountId ||
      form.fromAccountId === form.toAccountId ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      toast({
        title: 'Validation Error',
        description: 'Please select different source and destination accounts and enter a positive amount.',
        variant: 'destructive',
      });
      return;
    }

    const fromAccount = accountById.get(form.fromAccountId);
    const toAccount = accountById.get(form.toAccountId);
    if (!fromAccount || !toAccount) {
      toast({ title: 'Validation Error', description: 'One or both selected accounts could not be found.', variant: 'destructive' });
      return;
    }

    const availableFunds = availableOn(
      fromAccount,
      allTransactions.filter((txn) => txn.contraId !== editingEntry.contraId),
      editDate,
    );
    if (amount > availableFunds) {
      toast({
        title: 'Insufficient Funds',
        description: `Transfer from ${accountLabel(fromAccount)} exceeds the available amount of ${formatInr(availableFunds)}.`,
        variant: 'destructive',
      });
      return;
    }

    setIsEditSaving(true);
    try {
      const existingContraSnap = await getDocs(
        query(collection(db, 'bankExpenses'), where('contraId', '==', editingEntry.contraId)),
      );

      const batch = writeBatch(db);
      existingContraSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // The legs are rewritten, but the transfer keeps the time it was first entered.
      const createdStamps = existingContraSnap.docs
        .map((docSnap) => docSnap.data().createdAt)
        .filter((value): value is Timestamp => value instanceof Timestamp);
      const createdAt = createdStamps.length
        ? createdStamps.reduce((earliest, stamp) => (stamp.toMillis() < earliest.toMillis() ? stamp : earliest))
        : Timestamp.now();

      const baseData = {
        date: Timestamp.fromDate(editDate),
        isContra: true,
        contraId: editingEntry.contraId,
        createdAt,
      };

      batch.set(doc(collection(db, 'bankExpenses')), {
        ...baseData,
        accountId: form.fromAccountId,
        description: `Transfer to ${toAccount.shortName} - ${toAccount.bankName}`,
        amount,
        type: 'Debit',
      } as Omit<BankExpense, 'id'>);

      batch.set(doc(collection(db, 'bankExpenses')), {
        ...baseData,
        accountId: form.toAccountId,
        description: `Transfer from ${fromAccount.shortName} - ${fromAccount.bankName}`,
        amount,
        type: 'Credit',
      } as Omit<BankExpense, 'id'>);

      await batch.commit();

      toast({ title: 'Success', description: 'Internal transaction updated.' });
      const before = {
        date: dayKey(editingEntry.at),
        fromAccount: nameOf(editingEntry.fromAccountId),
        toAccount: nameOf(editingEntry.toAccountId),
        amount: Number(editingEntry.amount) || 0,
      };
      const after = { date: dayKey(editDate), fromAccount: accountLabel(fromAccount), toAccount: accountLabel(toAccount), amount };
      void log(
        'Edit Transfer',
        {
          contraId: editingEntry.contraId,
          fromAccountId: form.fromAccountId,
          toAccountId: form.toAccountId,
          ...after,
          changes: diffFields(before, after),
        },
        { recordId: editingEntry.contraId, recordRef: `${after.fromAccount} → ${after.toAccount}` },
      );
      resetEditDialog();
      void load(true);
    } catch (error) {
      console.error('Error editing internal transaction:', error);
      toast({ title: 'Update Failed', description: 'An error occurred while updating the internal transaction.', variant: 'destructive' });
      setIsEditSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (!canDelete) {
      toast({ title: 'Not allowed', description: 'You do not have permission to delete internal transactions.', variant: 'destructive' });
      setDeleteTarget(null);
      return;
    }

    setIsDeleting(true);
    try {
      const snapshot = await getDocs(query(collection(db, 'bankExpenses'), where('contraId', '==', deleteTarget.contraId)));

      if (snapshot.empty) {
        toast({ title: 'Not found', description: 'No matching contra entries found to delete.', variant: 'destructive' });
        setDeleteTarget(null);
        return;
      }

      const batch = writeBatch(db);
      snapshot.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();

      toast({ title: 'Success', description: 'Internal transaction deleted.' });
      // The legs are gone, so the log row is the only trace of the transfer: record what it was.
      const fromName = nameOf(deleteTarget.fromAccountId);
      const toName = nameOf(deleteTarget.toAccountId);
      void log(
        'Delete Transfer',
        {
          contraId: deleteTarget.contraId,
          date: dayKey(deleteTarget.at),
          fromAccountId: deleteTarget.fromAccountId,
          fromAccount: fromName,
          toAccountId: deleteTarget.toAccountId,
          toAccount: toName,
          amount: Number(deleteTarget.amount) || 0,
          description: deleteTarget.description || '',
          legs: snapshot.size,
        },
        { recordId: deleteTarget.contraId, recordRef: `${fromName} → ${toName}` },
      );
      setDeleteTarget(null);
      void load(true);
    } catch (error) {
      console.error('Error deleting internal transaction:', error);
      toast({ title: 'Delete Failed', description: 'An error occurred while deleting the internal transaction.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const clearFilters = () => {
    setDateRange(undefined);
    setDatePreset('custom');
    setAccountFilter('all');
    setSearch('');
  };

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={3} />;
  if (!canView) return <BankAccessDenied title="Transfers" />;

  const renderRoute = (transfer: Pick<Transfer, 'fromAccountId' | 'toAccountId'>) => (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="font-medium text-rose-700">{nameOf(transfer.fromAccountId)}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="to" />
      <span className="font-medium text-emerald-700">{nameOf(transfer.toAccountId)}</span>
    </span>
  );

  const columns: Array<ListColumn<Transfer>> = [
    {
      header: 'Date',
      mobile: 'title',
      cell: (transfer) => <span className="whitespace-nowrap font-medium">{formatDay(transfer.at)}</span>,
    },
    {
      header: 'From → To',
      mobile: 'title',
      cell: (transfer) => renderRoute(transfer),
    },
    {
      header: 'Description',
      cell: (transfer) => <span className="line-clamp-2 break-words">{transfer.description || '—'}</span>,
    },
    {
      header: 'Amount',
      align: 'right',
      mobile: 'aside',
      cell: (transfer) => <span className="whitespace-nowrap font-semibold tabular-nums text-indigo-700">{formatInr(transfer.amount)}</span>,
    },
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (transfer) =>
        canEdit || canDelete ? (
          <div className="flex justify-end gap-1">
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => openEditDialog(transfer)}
                disabled={isEditSaving || isDeleting}
                aria-label={`Edit transfer of ${formatInr(transfer.amount)} on ${formatDay(transfer.at)}`}
              >
                <Pencil className="h-4 w-4" />
                <span className="ml-1.5 sm:hidden">Edit</span>
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-destructive hover:text-destructive"
                onClick={() => setDeleteTarget(transfer)}
                disabled={isEditSaving || isDeleting}
                aria-label={`Delete transfer of ${formatInr(transfer.amount)} on ${formatDay(transfer.at)}`}
              >
                <Trash2 className="h-4 w-4" />
                <span className="ml-1.5 sm:hidden">Delete</span>
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  const activeFilters = (dateRange ? 1 : 0) + (accountFilter !== 'all' ? 1 : 0);
  const emptyMessage = (
    <div className="px-6 py-10 text-center text-sm text-muted-foreground">
      {transfers.length === 0 ? 'No internal transfers recorded yet.' : 'No internal transfers match these filters.'}
    </div>
  );
  const topRoute = summary.topRoute;
  const editAmount = Number(form.amount) || 0;
  // Transfers cannot be dated ahead; one already dated ahead (entered before that rule) keeps its day.
  const todayKey = dayKey(new Date());
  const editMaxDay = editingEntry && dayKey(editingEntry.at) > todayKey ? undefined : todayKey;

  return (
    <>
      <BankBalanceBackground tone="blue" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Transfers"
          description={`${plural(filtered.length, 'transfer')} · ${formatInr(summary.total)}`}
          backHref="/bank-balance"
          backLabel="Back to dashboard"
          actions={
            canAdd ? (
              <Button asChild>
                <Link href="/bank-balance/internal-transaction/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New Transfer
                </Link>
              </Button>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            label="Transfers in range"
            value={filtered.length}
            hint={filtered.length === transfers.length ? 'All transfers' : `of ${transfers.length} recorded`}
            icon={ArrowRightLeft}
            tone="blue"
            accent
          />
          <KpiCard label="Total moved" value={formatInr(summary.total)} icon={Wallet} tone="indigo" accent />
          <KpiCard
            label="Most-used route"
            value={topRoute ? `${nameOf(topRoute.fromAccountId)} → ${nameOf(topRoute.toAccountId)}` : '—'}
            hint={topRoute ? `${plural(topRoute.count, 'transfer')} · ${formatInr(topRoute.amount)}` : 'No transfers in range'}
            icon={Route}
            tone="violet"
            accent
          />
        </div>

        <TableCard
          title={viewMode === 'current' ? 'Transfers' : 'Transfers by date'}
          count={filtered.length}
          noun="transfer"
          scroll={viewMode === 'dateWise' ? 'contained' : 'natural'}
          actions={
            <>
              <Button size="sm" variant={viewMode === 'current' ? 'default' : 'outline'} onClick={() => setViewMode('current')}>
                Current view
              </Button>
              <Button size="sm" variant={viewMode === 'dateWise' ? 'default' : 'outline'} onClick={() => setViewMode('dateWise')}>
                Date-wise view
              </Button>
            </>
          }
          toolbar={
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: 'Search description or account…' }}
              activeCount={activeFilters}
              onClear={clearFilters}
            >
              <BankDateRangeFilter
                range={dateRange}
                preset={datePreset}
                onChange={(range, preset) => {
                  setDateRange(range);
                  setDatePreset(preset);
                }}
              />
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="sm:w-56" aria-label="Account, from or to">
                  <SelectValue placeholder="From or to account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts (from or to)</SelectItem>
                  {bankAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {accountLabel(account)} - {account.bankName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterBar>
          }
          footer={
            filtered.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Total of {plural(filtered.length, 'transfer')}
                  {accountFilter !== 'all' && ` involving ${nameOf(accountFilter)}`}
                </span>
                <span className="font-semibold tabular-nums text-foreground">{formatInr(summary.total)}</span>
              </div>
            ) : undefined
          }
        >
          {viewMode === 'current' ? (
            <div className="p-3 sm:p-0">
              <DataList rows={filtered} columns={columns} frameless dense maxHeightClassName="sm:max-h-[36rem]" empty={emptyMessage} />
            </div>
          ) : dateWiseRows.length === 0 ? (
            emptyMessage
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  {routeColumns.map((column) => (
                    <TableHead key={column.key} className="whitespace-nowrap text-right">
                      {column.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dateWiseRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="whitespace-nowrap font-medium">{formatDay(row.key)}</TableCell>
                    {routeColumns.map((column) => (
                      <TableCell key={column.key} className="whitespace-nowrap text-right tabular-nums">
                        {row.totals[column.key] ? formatInr(row.totals[column.key]) : '-'}
                      </TableCell>
                    ))}
                    <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatInr(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  {routeColumns.map((column) => (
                    <TableCell key={column.key} className="whitespace-nowrap text-right font-semibold tabular-nums">
                      {formatInr(dateWiseRows.reduce((sum, row) => sum + (row.totals[column.key] || 0), 0))}
                    </TableCell>
                  ))}
                  <TableCell className="whitespace-nowrap text-right font-bold tabular-nums">{formatInr(summary.total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </TableCard>
      </div>

      <Dialog
        open={!!editingEntry}
        onOpenChange={(open) => {
          if (!open && !isEditSaving) resetEditDialog();
        }}
      >
        <DialogContent className="hr-mobile-dialog gap-5 sm:max-w-lg">
          <DialogHeader className="hr-dialog-header pr-8">
            <DialogTitle>Edit transfer</DialogTitle>
            <DialogDescription>
              {editingEntry && (
                <>
                  {nameOf(editingEntry.fromAccountId)} → {nameOf(editingEntry.toAccountId)} · {formatInr(editingEntry.amount)} on{' '}
                  {formatDay(editingEntry.at)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <form id="transfer-edit-form" onSubmit={handleEditTransaction} className="hr-dialog-body space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="transfer-edit-date">Transfer date</Label>
              <Input
                id="transfer-edit-date"
                type="date"
                required
                max={editMaxDay}
                value={form.day}
                onChange={(event) => setForm((prev) => ({ ...prev, day: event.target.value }))}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="transfer-edit-from">From account</Label>
                <Select value={form.fromAccountId} onValueChange={(value) => setForm((prev) => ({ ...prev, fromAccountId: value }))}>
                  <SelectTrigger id="transfer-edit-from">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {editOptions.map((account) => (
                      <SelectItem key={account.id} value={account.id} disabled={account.id === form.toAccountId}>
                        {accountLabel(account)} - {account.bankName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="transfer-edit-to">To account</Label>
                <Select value={form.toAccountId} onValueChange={(value) => setForm((prev) => ({ ...prev, toAccountId: value }))}>
                  <SelectTrigger id="transfer-edit-to">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {editOptions.map((account) => (
                      <SelectItem key={account.id} value={account.id} disabled={account.id === form.fromAccountId}>
                        {accountLabel(account)} - {account.bankName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="transfer-edit-amount">Amount</Label>
              <Input
                id="transfer-edit-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                required
                placeholder="0.00"
                value={form.amount}
                onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
              />
            </div>

            {editFromAccount && editAvailable !== null && (
              <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-muted-foreground">
                    {isCashCredit(editFromAccount) ? 'Available limit' : 'Available balance'} in {accountLabel(editFromAccount)}
                    <span className="block text-xs">end of {formatDay(editDate)}, without this transfer</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatInr(editAvailable)}</span>
                </div>
                {editAmount > editAvailable && (
                  <p className="border-t pt-2 text-xs text-rose-700">
                    The amount is {formatInr(editAmount - editAvailable)} more than is available.
                  </p>
                )}
              </div>
            )}
          </form>

          <DialogFooter className="hr-dialog-footer gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={resetEditDialog} disabled={isEditSaving}>
              Cancel
            </Button>
            <Button type="submit" form="transfer-edit-form" disabled={isEditSaving}>
              {isEditSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transfer?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  {formatInr(deleteTarget.amount)} from {nameOf(deleteTarget.fromAccountId)} to {nameOf(deleteTarget.toAccountId)} on{' '}
                  {formatDay(deleteTarget.at)}. This permanently deletes both the debit and the credit entry.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
            >
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
