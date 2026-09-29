'use client';

/**
 * The Payments and Receipts registers. The two pages were near-identical copies — same query
 * shape, same filters, same date-wise pivot — that had drifted (only one searched by reference,
 * only one re-checked the delete permission), so both now render this with a `kind`.
 *
 *  - payment: `bankExpenses` where type == 'Debit' and isContra == false, permission
 *    `Bank Balance.Expenses`.
 *  - receipt: `bankExpenses` where type == 'Credit' and isContra == false, permission
 *    `Bank Balance.Receipts`.
 *
 * Internal transfers (contra legs) are never listed here; they have their own page.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { DateRange } from 'react-day-picker';
import { compareDesc, endOfDay, startOfDay } from 'date-fns';
import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { BookOpenCheck, ChevronRight, Landmark, Loader2, Paperclip, Plus, Receipt, Trash2, TrendingUp, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import { KpiCard, type Tone } from '@/components/shared/kpi-card';
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
  type BankTone,
} from '@/components/bank-balance/page-kit';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { dayKey, formatDay, formatInr, txnDate } from '@/lib/bank-balance-ledger';
import type { DateRangePreset } from '@/lib/date-range-presets';
import type { BankAccount, BankExpense } from '@/lib/types';

export type TransactionLogKind = 'payment' | 'receipt';

interface KindConfig {
  title: string;
  noun: string;
  type: BankExpense['type'];
  permission: string;
  newHref: string;
  newLabel: string;
  background: BankTone;
  tone: Tone;
  amountClass: string;
  searchPlaceholder: string;
}

const KINDS: Record<TransactionLogKind, KindConfig> = {
  payment: {
    title: 'Payments',
    noun: 'payment',
    type: 'Debit',
    permission: 'Bank Balance.Expenses',
    newHref: '/bank-balance/expenses/new',
    newLabel: 'New Payment',
    background: 'red',
    tone: 'rose',
    amountClass: 'text-rose-700',
    searchPlaceholder: 'Search description, Ref No., UTR…',
  },
  receipt: {
    title: 'Receipts',
    noun: 'receipt',
    type: 'Credit',
    permission: 'Bank Balance.Receipts',
    newHref: '/bank-balance/receipts/new',
    newLabel: 'New Receipt',
    background: 'green',
    tone: 'emerald',
    amountClass: 'text-emerald-700',
    searchPlaceholder: 'Search description or reference…',
  },
};

type DateWiseRow = { id: string; key: string; bankTotals: Record<string, number>; total: number };

/** The grouped register: date → bank → payment method (instrument) → the entries themselves. */
type MethodGroup = { key: string; method: string; instrumentNo: string; voucher: boolean; total: number; entries: BankExpense[] };
type BankGroup = { key: string; accountId: string; total: number; count: number; methods: MethodGroup[] };
type DateGroup = { key: string; day: string; total: number; count: number; banks: BankGroup[] };

type ViewMode = 'grouped' | 'list' | 'dateWise';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** A saved attachment, opened in a new tab. Plain anchors: the list has no card links to nest in. */
function AttachmentLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 underline-offset-2 hover:underline"
    >
      <Paperclip className="h-3 w-3 shrink-0" />
      {label}
    </a>
  );
}

export function BankTransactionLog({ kind }: { kind: TransactionLogKind }) {
  const config = KINDS[kind];
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [entries, setEntries] = useState<BankExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [datePreset, setDatePreset] = useState<DateRangePreset>('custom');
  const [bankFilter, setBankFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  /** Collapsed group keys in the grouped view; everything starts expanded. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [deleteTarget, setDeleteTarget] = useState<BankExpense | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const canView = !authLoading && can('View', config.permission);
  const canAdd = !authLoading && can('Add', config.permission);
  const canDelete = !authLoading && can('Delete', config.permission);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [accountsSnap, entriesSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(query(collection(db, 'bankExpenses'), where('type', '==', config.type), where('isContra', '==', false))),
      ]);
      setBankAccounts(
        accountsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as BankAccount))
          .sort((a, b) => accountLabel(a).localeCompare(accountLabel(b))),
      );
      setEntries(
        entriesSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as BankExpense))
          .sort((a, b) => compareDesc(txnDate(a), txnDate(b))),
      );
    } catch (error) {
      console.error(`Error loading ${config.noun}s:`, error);
      toast({ title: 'Error', description: `Failed to load ${config.noun} data.`, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [config.noun, config.type, toast]);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    void load();
  }, [authLoading, canView, load]);

  const accountById = useMemo(() => new Map(bankAccounts.map((account) => [account.id, account])), [bankAccounts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = dateRange?.from ? startOfDay(dateRange.from) : null;
    const to = dateRange?.to ? endOfDay(dateRange.to) : null;
    return entries.filter((entry) => {
      const at = txnDate(entry);
      if (from && at < from) return false;
      if (to && at > to) return false;
      if (bankFilter !== 'all' && entry.accountId !== bankFilter) return false;
      if (!term) return true;
      return [entry.description, entry.paymentRequestRefNo, entry.utrNumber, entry.paymentRefNo].some((value) =>
        (value || '').toLowerCase().includes(term),
      );
    });
  }, [entries, dateRange, bankFilter, search]);

  const summary = useMemo(() => {
    const total = filtered.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
    const largest = filtered.reduce<BankExpense | null>(
      (best, entry) => (!best || (Number(entry.amount) || 0) > (Number(best.amount) || 0) ? entry : best),
      null,
    );
    const accountIds = new Set(filtered.map((entry) => entry.accountId));
    return { total, largest, accounts: accountIds.size, average: filtered.length ? total / filtered.length : 0 };
  }, [filtered]);

  const visibleAccounts = useMemo(() => {
    if (bankFilter !== 'all') return bankAccounts.filter((account) => account.id === bankFilter);
    const used = new Set(filtered.map((entry) => entry.accountId));
    return bankAccounts.filter((account) => used.has(account.id));
  }, [bankAccounts, bankFilter, filtered]);

  const dateWiseRows = useMemo(() => {
    const grouped = new Map<string, DateWiseRow>();
    for (const entry of filtered) {
      const key = dayKey(txnDate(entry));
      const row = grouped.get(key) ?? { id: key, key, bankTotals: {}, total: 0 };
      const amount = Number(entry.amount) || 0;
      row.bankTotals[entry.accountId] = (row.bankTotals[entry.accountId] || 0) + amount;
      row.total += amount;
      grouped.set(key, row);
    }
    return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered]);

  // Newest day first; within a day banks by name, then methods (a cheque / RTGS batch keeps its
  // payees together), then the entries. Receipts have no method level — one group per bank.
  const groupedTree = useMemo<DateGroup[]>(() => {
    const days = new Map<string, DateGroup>();
    for (const entry of filtered) {
      const day = dayKey(txnDate(entry));
      const amount = Number(entry.amount) || 0;
      const dateGroup = days.get(day) ?? { key: day, day, total: 0, count: 0, banks: [] };
      let bank = dateGroup.banks.find((b) => b.accountId === entry.accountId);
      if (!bank) {
        bank = { key: `${day}|${entry.accountId}`, accountId: entry.accountId, total: 0, count: 0, methods: [] };
        dateGroup.banks.push(bank);
      }
      const method = kind === 'payment' ? (entry.paymentMethod || '').trim() || 'Method not recorded' : '';
      const instrumentNo = kind === 'payment' ? (entry.paymentRefNo || '').trim() : '';
      const methodKey = `${bank.key}|${method}|${instrumentNo}`;
      let methodGroup = bank.methods.find((m) => m.key === methodKey);
      if (!methodGroup) {
        methodGroup = { key: methodKey, method, instrumentNo, voucher: false, total: 0, entries: [] };
        bank.methods.push(methodGroup);
      }
      methodGroup.entries.push(entry);
      methodGroup.total += amount;
      methodGroup.voucher = methodGroup.voucher || Boolean(entry.bankPaymentId);
      bank.total += amount;
      bank.count += 1;
      dateGroup.total += amount;
      dateGroup.count += 1;
      days.set(day, dateGroup);
    }
    const tree = [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
    for (const dateGroup of tree) {
      dateGroup.banks.sort((a, b) => accountLabel(accountById.get(a.accountId)).localeCompare(accountLabel(accountById.get(b.accountId))));
      for (const bank of dateGroup.banks) {
        bank.methods.sort((a, b) => a.method.localeCompare(b.method) || a.instrumentNo.localeCompare(b.instrumentNo));
        for (const m of bank.methods) m.entries.sort((a, b) => (a.paymentRequestRefNo || a.description || '').localeCompare(b.paymentRequestRefNo || b.description || ''));
      }
    }
    return tree;
  }, [filtered, kind, accountById]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const columnTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const row of dateWiseRows) {
      for (const [accountId, amount] of Object.entries(row.bankTotals)) totals[accountId] = (totals[accountId] || 0) + amount;
    }
    return totals;
  }, [dateWiseRows]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.bankPaymentId) {
      toast({ title: 'Part of a voucher', description: 'Cancel the whole voucher from the Cheque Register instead.', variant: 'destructive' });
      setDeleteTarget(null);
      return;
    }
    if (!canDelete) {
      toast({ title: 'Not allowed', description: `You do not have permission to delete ${config.noun}s.`, variant: 'destructive' });
      setDeleteTarget(null);
      return;
    }
    setIsDeleting(true);
    try {
      await runTransaction(db, async (transaction) => {
        transaction.delete(doc(db, 'bankExpenses', deleteTarget.id));
      });
      setEntries((prev) => prev.filter((entry) => entry.id !== deleteTarget.id));
      toast({ title: 'Deleted', description: `${kind === 'payment' ? 'Payment' : 'Receipt'} record deleted.` });
      setDeleteTarget(null);
    } catch (error) {
      console.error(`Error deleting ${config.noun}:`, error);
      toast({ title: 'Delete Failed', description: `An error occurred while deleting the ${config.noun} record.`, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const clearFilters = () => {
    setDateRange(undefined);
    setDatePreset('custom');
    setBankFilter('all');
    setSearch('');
  };

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} />;
  if (!canView) return <BankAccessDenied title={config.title} />;

  const bankName = (accountId: string) => (accountById.has(accountId) ? accountLabel(accountById.get(accountId)) : 'N/A');

  const actionCell = (entry: BankExpense) =>
        // A line of a payment voucher is reversed with its whole voucher, from the Cheque Register —
        // deleting one line here would leave the voucher and its requisitions out of step.
        entry.bankPaymentId ? (
          <Link href="/bank-balance/cheques" className="inline-flex h-8 items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground">
            <BookOpenCheck className="h-3.5 w-3.5" />
            Voucher
          </Link>
        ) : canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(entry)}
            disabled={isDeleting}
            aria-label={`Delete ${config.noun} of ${formatInr(entry.amount)} on ${formatDay(txnDate(entry))}`}
          >
            <Trash2 className="h-4 w-4" />
            <span className="ml-1.5 sm:hidden">Delete</span>
          </Button>
        ) : null;

  const columns: Array<ListColumn<BankExpense>> = [
    {
      header: 'Date',
      mobile: 'title',
      cell: (entry) => <span className="whitespace-nowrap font-medium">{formatDay(txnDate(entry))}</span>,
    },
    {
      header: 'Description',
      mobile: 'title',
      cell: (entry) => <span className="line-clamp-2 min-w-[12rem] break-words">{entry.description || '—'}</span>,
    },
    {
      header: 'Bank',
      cell: (entry) => <span className="whitespace-nowrap">{bankName(entry.accountId)}</span>,
    },
  ];

  if (kind === 'payment') {
    columns.push(
      {
        header: 'Ref No. / UTR',
        cell: (entry) =>
          entry.paymentRequestRefNo || entry.utrNumber ? (
            <div className="space-y-0.5 text-xs">
              {entry.paymentRequestRefNo && <div className="truncate">Ref: {entry.paymentRequestRefNo}</div>}
              {entry.utrNumber && <div className="truncate text-muted-foreground">UTR: {entry.utrNumber}</div>}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        header: 'Payment',
        cell: (entry) => {
          const method = [entry.paymentMethod, entry.paymentRefNo].filter(Boolean).join(' · ');
          const hasFiles = Boolean(entry.approvalCopyUrl || entry.bankTransferCopyUrl);
          if (!method && !hasFiles) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="space-y-1 text-xs">
              {method && <div className="truncate">{method}</div>}
              {hasFiles && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {entry.approvalCopyUrl && <AttachmentLink href={entry.approvalCopyUrl} label="Approval" />}
                  {entry.bankTransferCopyUrl && <AttachmentLink href={entry.bankTransferCopyUrl} label="Transfer copy" />}
                </div>
              )}
            </div>
          );
        },
      },
    );
  }

  columns.push(
    {
      header: 'Amount',
      align: 'right',
      mobile: 'aside',
      cell: (entry) => (
        <span className={`whitespace-nowrap font-semibold tabular-nums ${config.amountClass}`}>{formatInr(entry.amount)}</span>
      ),
    },
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (entry) => actionCell(entry),
    },
  );

  const activeFilters = (dateRange ? 1 : 0) + (bankFilter !== 'all' ? 1 : 0);
  const emptyMessage = (
    <div className="px-6 py-10 text-center text-sm text-muted-foreground">
      {entries.length === 0 ? `No ${config.noun} records yet.` : `No ${config.noun}s match these filters.`}
    </div>
  );

  return (
    <>
      <BankBalanceBackground tone={config.background} />
      <div className={BANK_PAGE}>
        <PageHeader
          title={config.title}
          description={`${plural(filtered.length, config.noun)} · ${formatInr(summary.total)}`}
          backHref="/bank-balance"
          backLabel="Back to dashboard"
          actions={
            canAdd ? (
              <Button asChild>
                <Link href={config.newHref}>
                  <Plus className="mr-2 h-4 w-4" />
                  {config.newLabel}
                </Link>
              </Button>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Entries in range"
            value={filtered.length}
            hint={filtered.length === entries.length ? `All ${config.noun}s` : `of ${entries.length} recorded`}
            icon={Receipt}
            tone={config.tone}
            accent
          />
          <KpiCard label="Total amount" value={formatInr(summary.total)} icon={Wallet} tone={config.tone} accent />
          <KpiCard
            label="Average per entry"
            value={formatInr(summary.average)}
            hint={
              summary.largest
                ? `Largest ${formatInr(summary.largest.amount)} on ${formatDay(txnDate(summary.largest))}`
                : 'No entries in range'
            }
            icon={TrendingUp}
            tone="indigo"
            accent
          />
          <KpiCard
            label="Accounts involved"
            value={summary.accounts}
            hint={summary.accounts === 1 && visibleAccounts[0] ? accountLabel(visibleAccounts[0]) : 'Distinct bank accounts'}
            icon={Landmark}
            tone="slate"
            accent
          />
        </div>

        <TableCard
          title={viewMode === 'dateWise' ? `${config.title} by date` : config.title}
          description={
            viewMode === 'grouped'
              ? kind === 'payment'
                ? 'Grouped by date, bank and payment method — each cheque or transfer batch with its payees.'
                : 'Grouped by date and bank.'
              : undefined
          }
          count={filtered.length}
          noun={config.noun}
          scroll={viewMode === 'list' ? 'natural' : 'contained'}
          actions={
            <>
              {viewMode === 'grouped' && groupedTree.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setCollapsed((prev) =>
                      prev.size ? new Set() : new Set(groupedTree.flatMap((d) => [d.key, ...d.banks.map((b) => b.key)])),
                    )
                  }
                >
                  {collapsed.size ? 'Expand all' : 'Collapse all'}
                </Button>
              )}
              {(
                [
                  ['grouped', 'Grouped'],
                  ['list', 'List'],
                  ['dateWise', 'Date-wise'],
                ] as Array<[ViewMode, string]>
              ).map(([mode, label]) => (
                <Button key={mode} size="sm" variant={viewMode === mode ? 'default' : 'outline'} onClick={() => setViewMode(mode)}>
                  {label}
                </Button>
              ))}
            </>
          }
          toolbar={
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: config.searchPlaceholder }}
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
              <Select value={bankFilter} onValueChange={setBankFilter}>
                <SelectTrigger className="sm:w-56">
                  <SelectValue placeholder="All banks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All banks</SelectItem>
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
                <span>Total of {plural(filtered.length, config.noun)}</span>
                <span className="font-semibold tabular-nums text-foreground">{formatInr(summary.total)}</span>
              </div>
            ) : undefined
          }
        >
          {viewMode === 'grouped' ? (
            groupedTree.length === 0 ? (
              emptyMessage
            ) : (
              <table className="w-full border-collapse text-sm" style={{ minWidth: kind === 'payment' ? 860 : 560 }}>
                <thead className="sticky top-0 z-10 bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {kind === 'payment' && <th className="w-56 px-3 py-2.5">Requisition / Ref</th>}
                    <th className="px-3 py-2.5">Description</th>
                    {kind === 'payment' && <th className="w-44 px-2 py-2.5">UTR</th>}
                    {kind === 'payment' && <th className="w-40 px-2 py-2.5">Files</th>}
                    <th className="w-40 px-3 py-2.5 text-right">Amount</th>
                    <th className="w-24 px-3 py-2.5">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupedTree.map((dateGroup) => {
                    const span = kind === 'payment' ? 4 : 1;
                    const dateOpen = !collapsed.has(dateGroup.key);
                    return (
                      <Fragment key={dateGroup.key}>
                        {/* Level 1 — the day */}
                        <tr className="border-t bg-muted/60">
                          <td colSpan={span} className="px-3 py-2">
                            <button type="button" onClick={() => toggle(dateGroup.key)} className="flex items-center gap-2 font-semibold" aria-expanded={dateOpen}>
                              <ChevronRight className={`h-4 w-4 transition-transform ${dateOpen ? 'rotate-90' : ''}`} />
                              {formatDay(dateGroup.day)}
                              <span className="text-xs font-normal text-muted-foreground">
                                {plural(dateGroup.count, config.noun)} · {plural(dateGroup.banks.length, 'bank')}
                              </span>
                            </button>
                          </td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums ${config.amountClass}`}>{formatInr(dateGroup.total)}</td>
                          <td />
                        </tr>
                        {dateOpen &&
                          dateGroup.banks.map((bank) => {
                            const bankOpen = !collapsed.has(bank.key);
                            return (
                              <Fragment key={bank.key}>
                                {/* Level 2 — the bank account */}
                                <tr className="border-t bg-muted/25">
                                  <td colSpan={span} className="py-1.5 pl-8 pr-3">
                                    <button type="button" onClick={() => toggle(bank.key)} className="flex items-center gap-2 font-medium" aria-expanded={bankOpen}>
                                      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${bankOpen ? 'rotate-90' : ''}`} />
                                      <Landmark className="h-3.5 w-3.5 text-muted-foreground" />
                                      {bankName(bank.accountId)}
                                      <span className="text-xs font-normal text-muted-foreground">{plural(bank.count, config.noun)}</span>
                                    </button>
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{formatInr(bank.total)}</td>
                                  <td />
                                </tr>
                                {bankOpen &&
                                  bank.methods.map((methodGroup) => (
                                    <Fragment key={methodGroup.key}>
                                      {/* Level 3 — the payment method / instrument (payments only) */}
                                      {kind === 'payment' && (
                                        <tr className="border-t">
                                          <td colSpan={span} className="py-1.5 pl-16 pr-3">
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                                              <span className="font-semibold uppercase tracking-wide text-foreground">{methodGroup.method}</span>
                                              {methodGroup.instrumentNo && <span className="font-mono text-muted-foreground">{methodGroup.instrumentNo}</span>}
                                              <span className="text-muted-foreground">· {plural(methodGroup.entries.length, 'payee')}</span>
                                              {methodGroup.voucher && (
                                                <Link href="/bank-balance/cheques" className="inline-flex items-center gap-1 text-sky-700 hover:underline">
                                                  <BookOpenCheck className="h-3 w-3" />
                                                  Voucher
                                                </Link>
                                              )}
                                            </div>
                                          </td>
                                          <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs font-semibold tabular-nums">{formatInr(methodGroup.total)}</td>
                                          <td />
                                        </tr>
                                      )}
                                      {/* Level 4 — each requisition / payment */}
                                      {methodGroup.entries.map((entry) => (
                                        <tr key={entry.id} className="border-t border-dashed hover:bg-muted/20">
                                          {kind === 'payment' && (
                                            <td className="py-2 pl-24 pr-3 font-mono text-xs">{entry.paymentRequestRefNo || <span className="text-muted-foreground">—</span>}</td>
                                          )}
                                          <td className={`py-2 pr-3 ${kind === 'payment' ? 'pl-3' : 'pl-16'}`}>
                                            <span className="line-clamp-2 break-words">{entry.description || '—'}</span>
                                          </td>
                                          {kind === 'payment' && <td className="px-2 py-2 font-mono text-xs">{entry.utrNumber || <span className="text-muted-foreground">—</span>}</td>}
                                          {kind === 'payment' && (
                                            <td className="px-2 py-2">
                                              <div className="flex flex-wrap gap-x-3 gap-y-1">
                                                {entry.approvalCopyUrl && <AttachmentLink href={entry.approvalCopyUrl} label="Approval" />}
                                                {entry.bankTransferCopyUrl && <AttachmentLink href={entry.bankTransferCopyUrl} label="Copy" />}
                                                {!entry.approvalCopyUrl && !entry.bankTransferCopyUrl && <span className="text-xs text-muted-foreground">—</span>}
                                              </div>
                                            </td>
                                          )}
                                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatInr(entry.amount)}</td>
                                          <td className="px-3 py-1 text-right">{actionCell(entry)}</td>
                                        </tr>
                                      ))}
                                    </Fragment>
                                  ))}
                              </Fragment>
                            );
                          })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : viewMode === 'list' ? (
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
                  {visibleAccounts.map((account) => (
                    <TableHead key={account.id} className="whitespace-nowrap text-right">
                      {accountLabel(account)}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dateWiseRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap font-medium">{formatDay(row.key)}</TableCell>
                    {visibleAccounts.map((account) => (
                      <TableCell key={account.id} className="whitespace-nowrap text-right tabular-nums">
                        {row.bankTotals[account.id] ? formatInr(row.bankTotals[account.id]) : '-'}
                      </TableCell>
                    ))}
                    <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatInr(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  {visibleAccounts.map((account) => (
                    <TableCell key={account.id} className="whitespace-nowrap text-right font-semibold tabular-nums">
                      {formatInr(columnTotals[account.id] || 0)}
                    </TableCell>
                  ))}
                  <TableCell className="whitespace-nowrap text-right font-bold tabular-nums">{formatInr(summary.total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </TableCard>
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {config.noun}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  {formatInr(deleteTarget.amount)} {kind === 'payment' ? 'from' : 'into'} {bankName(deleteTarget.accountId)} on{' '}
                  {formatDay(txnDate(deleteTarget))}
                  {deleteTarget.description ? ` — ${deleteTarget.description}` : ''}. This permanently deletes the record
                  and changes the account balance from that day on.
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
