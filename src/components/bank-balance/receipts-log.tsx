'use client';

/**
 * The Receipts register: every Credit into a bank account that is not one leg of an internal
 * transfer (`bankExpenses` where type == 'Credit' and isContra == false), on Receipts · View.
 *
 * A period (today, this week, this month, the financial year, all, or two dates), a bank and a
 * search narrow it; the result reads grouped by day and bank, as a flat list, or day by day as a
 * chart over a date × bank table. Beside it: who paid most, and into which account.
 *
 * Deleting follows the old register's rules — Receipts · Delete, never in a closed month — plus one:
 * a Credit Bill Tracking posted (it carries `billCollectionId`) is reversed by cancelling its receipt
 * in Bill Tracking, never deleted here, or Bill Tracking would show money that is not in the bank.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { ArrowLeft, ArrowUp, Download, ExternalLink, Inbox, Landmark, List, Loader2, Lock, Plus, Search, Trash2, TrendingUp, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import heroStyles from '@/components/bank-balance/dashboard-designs/aurora.module.css';
import { BANK_PAGE, BankAccessDenied, BankPageSkeleton, accountLabel } from '@/components/bank-balance/page-kit';
import { TILE_COLOURS, Tile, tileColours } from '@/components/bank-balance/account-picker';
import { useEntryControls } from '@/components/bank-balance/controls/use-entry-controls';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { compactInr, dayKey, formatDay, formatInr, parseDay, txnDate } from '@/lib/bank-balance-ledger';
import { fyOf, inRange, initials, nameHash, payerOf, periodRange, type ReceiptPeriod } from '@/lib/bank-balance-receipts';
import { exportRowsToExcel } from '@/lib/report-excel';
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

type View = 'grouped' | 'list' | 'date';

interface Item {
  entry: BankExpense;
  day: string;
  amount: number;
  payer: string;
  /** Posted by Bill Tracking from one of its receipts. */
  fromBillTracking: boolean;
  ref: string;
}

const PERMISSION = 'Bank Balance.Receipts';
/** Days shown at first in the grouped view; more on request, so a year's register stays quick. */
const DAYS_PER_PAGE = 15;

const payerColours = (name: string) => TILE_COLOURS[nameHash(name, TILE_COLOURS.length)];

const safeDate = (entry: BankExpense): Date | null => {
  try {
    const at = txnDate(entry);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
};

const dayLabel = (day: string) => {
  const at = parseDay(day);
  return at ? format(at, 'd MMM yyyy') : day;
};

function PayerTile({ name, size }: { name: string; size: number }) {
  return name ? (
    <Tile colours={payerColours(name)} size={size}>
      <span className="font-extrabold" style={{ fontSize: Math.round(size * 0.32) }}>{initials(name)}</span>
    </Tile>
  ) : (
    <Tile colours={['#cbd5e1', '#64748b']} size={size}>
      <ArrowUp style={{ width: size * 0.45, height: size * 0.45 }} />
    </Tile>
  );
}

/** A thin magnitude meter: one hue, the identity is in the tile beside it. */
function Meter({ share }: { share: number }) {
  return (
    <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded bg-muted">
      <span className="block h-full rounded bg-teal-600 dark:bg-teal-500" style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }} />
    </span>
  );
}

export function ReceiptsLog() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  const canView = !authLoading && can('View', PERMISSION);
  const canAdd = !authLoading && can('Add', PERMISSION);
  const canDelete = !authLoading && can('Delete', PERMISSION);

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [entries, setEntries] = useState<BankExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState<ReceiptPeriod>('month');
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [bank, setBank] = useState('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('grouped');
  const [dayCount, setDayCount] = useState(DAYS_PER_PAGE);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const nameOf = (id: string) => (accountById.has(id) ? accountLabel(accountById.get(id)) : 'Unknown account');
  // Month Closure: an entry dated in a closed month cannot be deleted by anyone.
  const controls = useEntryControls('receipt', nameOf);

  useEffect(() => {
    if (authLoading || !canView) return;
    let cancelled = false;
    Promise.all([
      getDocs(collection(db, 'bankAccounts')),
      getDocs(query(collection(db, 'bankExpenses'), where('type', '==', 'Credit'), where('isContra', '==', false))),
    ])
      .then(([accountsSnap, entriesSnap]) => {
        if (cancelled) return;
        setAccounts(accountsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount)).sort((a, b) => accountLabel(a).localeCompare(accountLabel(b))));
        setEntries(entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankExpense)));
      })
      .catch((error) => {
        console.error('Error loading receipts:', error);
        if (!cancelled) toast({ title: 'Error', description: 'Failed to load receipt data.', variant: 'destructive' });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, canView, toast]);

  const todayKey = dayKey(new Date());
  const range = useMemo(() => periodRange(period, todayKey, custom), [period, todayKey, custom]);

  // Every receipt once, newest first; an entry whose date cannot be read is left out, as the ledger does.
  const items = useMemo<Item[]>(
    () =>
      entries
        .flatMap((entry) => {
          const at = safeDate(entry);
          if (!at) return [];
          return [{
            entry,
            day: dayKey(at),
            amount: Number(entry.amount) || 0,
            payer: payerOf(entry),
            fromBillTracking: Boolean(entry.billCollectionId),
            ref: (entry.utrNumber || entry.paymentRefNo || '').trim(),
          }];
        })
        .sort((a, b) => b.day.localeCompare(a.day) || b.amount - a.amount),
    [entries],
  );

  const term = search.trim().toLowerCase();
  const inPeriod = useMemo(
    () =>
      items.filter((item) => {
        if (!inRange(item.day, range)) return false;
        if (!term) return true;
        const e = item.entry;
        return [e.description, item.payer, item.ref, e.receiptType, e.paymentMethod, String(item.amount)].some((value) => (value || '').toLowerCase().includes(term));
      }),
    [items, range, term],
  );
  const shown = useMemo(() => (bank === 'all' ? inPeriod : inPeriod.filter((item) => item.entry.accountId === bank)), [inPeriod, bank]);

  const summary = useMemo(() => {
    const total = shown.reduce((sum, item) => sum + item.amount, 0);
    const largest = shown.reduce((max, item) => Math.max(max, item.amount), 0);
    return {
      total,
      count: shown.length,
      average: shown.length ? total / shown.length : 0,
      largest,
      payers: new Set(shown.map((item) => item.payer.toLowerCase()).filter(Boolean)).size,
      accounts: new Set(shown.map((item) => item.entry.accountId)).size,
      lastDay: shown[0]?.day ?? null,
    };
  }, [shown]);

  // Banks with money in this period (and search), largest first — the chips.
  const bankChips = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of inPeriod) totals.set(item.entry.accountId, (totals.get(item.entry.accountId) ?? 0) + item.amount);
    if (bank !== 'all' && !totals.has(bank)) totals.set(bank, 0);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [inPeriod, bank]);
  const colourOf = (id: string) => tileColours(accounts.findIndex((a) => a.id === id));

  // Newest day first; within a day the banks by name, then the receipts largest first.
  const days = useMemo(() => {
    const map = new Map<string, { day: string; total: number; banks: Map<string, { total: number; items: Item[] }> }>();
    for (const item of shown) {
      const group = map.get(item.day) ?? { day: item.day, total: 0, banks: new Map() };
      const bankGroup = group.banks.get(item.entry.accountId) ?? { total: 0, items: [] };
      bankGroup.items.push(item);
      bankGroup.total += item.amount;
      group.banks.set(item.entry.accountId, bankGroup);
      group.total += item.amount;
      map.set(item.day, group);
    }
    return [...map.values()];
  }, [shown]);

  const payers = useMemo(() => {
    const totals = new Map<string, { name: string; total: number; count: number }>();
    let unknown = { total: 0, count: 0 };
    for (const item of shown) {
      if (!item.payer) {
        unknown = { total: unknown.total + item.amount, count: unknown.count + 1 };
        continue;
      }
      const key = item.payer.toLowerCase();
      const row = totals.get(key) ?? { name: item.payer, total: 0, count: 0 };
      row.total += item.amount;
      row.count += 1;
      totals.set(key, row);
    }
    return { ranked: [...totals.values()].sort((a, b) => b.total - a.total).slice(0, 8), unknown };
  }, [shown]);

  const byBank = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of shown) totals.set(item.entry.accountId, (totals.get(item.entry.accountId) ?? 0) + item.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [shown]);

  // Day by day, oldest first, with each bank's share — the chart and the table under it.
  const dateWise = useMemo(() => {
    const ordered = [...days].sort((a, b) => a.day.localeCompare(b.day));
    const label = (id: string) => accountLabel(accountById.get(id));
    const bankIds = [...new Set(shown.map((item) => item.entry.accountId))].sort((a, b) => label(a).localeCompare(label(b)));
    return { rows: ordered, bankIds };
  }, [days, shown, accountById]);

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} />;
  if (!canView) return <BankAccessDenied title="Receipts" />;

  const fyLabel = `FY ${fyOf(todayKey).slice(2)}`;
  const PERIODS: Array<{ key: ReceiptPeriod; label: string }> = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'fy', label: fyLabel },
    { key: 'all', label: 'All' },
    { key: 'custom', label: 'Dates…' },
  ];
  const rangeLabel =
    range.from && range.to
      ? range.from === range.to
        ? dayLabel(range.from)
        : `${dayLabel(range.from)} – ${dayLabel(range.to)}`
      : range.from
        ? `From ${dayLabel(range.from)}`
        : range.to
          ? `Up to ${dayLabel(range.to)}`
          : 'All dates';
  const filtersOn = bank !== 'all' || Boolean(term) || period !== 'month';
  const clearFilters = () => {
    setPeriod('month');
    setCustom({});
    setBank('all');
    setSearch('');
  };

  const exportExcel = async () => {
    const rows = shown.map((item) => ({
      Date: formatDay(item.day),
      Bank: nameOf(item.entry.accountId),
      'Received from': item.payer,
      Type: item.entry.receiptType || '',
      Mode: item.entry.paymentMethod || '',
      'UTR / Ref': item.ref,
      Description: item.entry.description || '',
      Source: item.fromBillTracking ? 'Bill Tracking' : 'Bank Balance',
      Amount: item.amount,
    }));
    try {
      await exportRowsToExcel('Receipts', rows, { filename: `Receipts ${todayKey}.xlsx` });
    } catch (error) {
      console.error('Error exporting receipts:', error);
      toast({ title: 'Export failed', description: 'The workbook could not be built.', variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    if (target.fromBillTracking) {
      toast({ title: 'Posted by Bill Tracking', description: 'Cancel the receipt in Bill Tracking › Receipts; that removes this credit too.', variant: 'destructive' });
      setDeleteTarget(null);
      return;
    }
    if (!canDelete) {
      toast({ title: 'Not allowed', description: 'You do not have permission to delete receipts.', variant: 'destructive' });
      setDeleteTarget(null);
      return;
    }
    const allowed = controls.checkChange({ originalDate: target.day, action: 'delete', originalAccountIds: [target.entry.accountId] });
    if (!allowed.ok) {
      toast({ title: 'Month closed', description: allowed.reason, variant: 'destructive' });
      setDeleteTarget(null);
      return;
    }
    setIsDeleting(true);
    try {
      await runTransaction(db, async (tx) => {
        tx.delete(doc(db, 'bankExpenses', target.entry.id));
      });
      setEntries((prev) => prev.filter((entry) => entry.id !== target.entry.id));
      toast({ title: 'Deleted', description: 'Receipt record deleted.' });
      void log(
        'Delete Receipt',
        { date: target.day, accountId: target.entry.accountId, account: nameOf(target.entry.accountId), amount: target.amount, description: target.entry.description || '', payer: target.payer },
        { recordId: target.entry.id, recordRef: `${nameOf(target.entry.accountId)} · ${target.day}` },
      );
      setDeleteTarget(null);
    } catch (error) {
      console.error('Error deleting receipt:', error);
      toast({ title: 'Delete failed', description: 'An error occurred while deleting the receipt.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  /** What can be done to one receipt from here. */
  const action = (item: Item) => {
    if (item.fromBillTracking) {
      return (
        <a
          href="/bill-tracking/collections"
          target="_blank"
          rel="noopener noreferrer"
          title="Posted by Bill Tracking — cancel the receipt there to reverse it"
          className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[11.5px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          Bill Tracking
        </a>
      );
    }
    if (!canDelete) return null;
    if (controls.isLocked(item.day, [item.entry.accountId])) {
      return (
        <span className="inline-flex h-8 items-center gap-1 whitespace-nowrap px-2 text-[11.5px] text-muted-foreground" title="Dated in a closed month — reopen the month in Settings › Month Closure to delete it">
          <Lock aria-hidden className="h-3.5 w-3.5" />
          Closed
        </span>
      );
    }
    return (
      <Button
        type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
        aria-label={`Delete receipt of ${formatInr(item.amount)} on ${formatDay(item.day)}`}
        onClick={() => setDeleteTarget(item)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    );
  };

  const tags = (item: Item) => (
    <>
      {item.entry.receiptType && (
        <span className="ml-1.5 rounded-md bg-emerald-50 px-1.5 py-px align-[1px] text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{item.entry.receiptType}</span>
      )}
      {item.fromBillTracking && (
        <span className="ml-1.5 rounded-md bg-indigo-50 px-1.5 py-px align-[1px] text-[11px] font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">Bill Tracking</span>
      )}
      {item.day > todayKey && (
        <span className="ml-1.5 rounded-md bg-sky-50 px-1.5 py-px align-[1px] text-[11px] font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">Dated ahead</span>
      )}
    </>
  );

  const kpis = [
    { label: 'Receipts in range', value: String(summary.count), extra: summary.lastDay ? `Last on ${format(parseDay(summary.lastDay) ?? new Date(), 'd MMM')}` : 'Nothing recorded', icon: List, colours: ['#86efac', '#16a34a'] as [string, string] },
    { label: 'Total received', value: compactInr(summary.total), extra: summary.count ? formatInr(summary.total, 0) : '—', icon: ArrowUp, colours: ['#5eead4', '#0f766e'] as [string, string] },
    { label: 'Average per receipt', value: compactInr(summary.average), extra: summary.count ? `Largest ${compactInr(summary.largest)}` : '—', icon: TrendingUp, colours: ['#a5b4fc', '#4f46e5'] as [string, string] },
    { label: 'Payers · Accounts', value: `${summary.payers} · ${summary.accounts}`, extra: summary.count ? 'named payers · banks' : '—', icon: Landmark, colours: ['#93c5fd', '#1d4ed8'] as [string, string] },
  ];
  const payerMax = Math.max(1, ...payers.ranked.map((p) => p.total));
  const bankMax = Math.max(1, ...byBank.map(([, v]) => v));

  return (
    <div className={cn(BANK_PAGE, 'pb-10')}>
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
        <Link href="/bank-balance" aria-label="Back to Bank Balance" className="mr-1 flex h-[30px] w-[30px] items-center justify-center rounded-lg border bg-card hover:bg-muted">
          <ArrowLeft className="h-[15px] w-[15px]" />
        </Link>
        <Link href="/bank-balance" className="hover:text-foreground">Bank Balance</Link>
        <span aria-hidden>›</span>
        <span className="text-foreground">Receipts</span>
      </nav>

      {/* ── The banner ── */}
      <section className={cn(heroStyles.hero, 'keep-light flex flex-wrap items-center gap-4 p-5 sm:p-6')} data-tint="forest">
        <span aria-hidden className={cn(heroStyles.glass, 'flex h-14 w-14 items-center justify-center rounded-2xl')}>
          <ArrowUp className="h-7 w-7 text-white" />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <h1 className="text-2xl font-extrabold tracking-tight">Receipts</h1>
          <p className={heroStyles.muted}>
            {summary.count} receipt{summary.count === 1 ? '' : 's'} · {rangeLabel}
          </p>
        </div>
        <div className={cn(heroStyles.glass, 'flex min-w-[140px] flex-1 flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
          <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>Received in range</span>
          <b className="text-xl font-extrabold tabular-nums">{compactInr(summary.total)}</b>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void exportExcel()} disabled={!shown.length} className={cn(heroStyles.action, 'disabled:cursor-not-allowed disabled:opacity-60')}>
            <Download aria-hidden className="h-4 w-4" />
            Export
          </button>
          {canAdd && (
            <Link href="/bank-balance/receipts/new" className={cn(heroStyles.action, heroStyles.actionPrimary)}>
              <Plus aria-hidden className="h-4 w-4" />
              New receipt
            </Link>
          )}
        </div>
      </section>

      {/* ── The figures ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="flex min-w-0 items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-sm">
            <Tile colours={kpi.colours} size={38}>
              <kpi.icon className="h-[18px] w-[18px]" />
            </Tile>
            <div className="min-w-0">
              <span className="block text-[11.5px] font-semibold text-muted-foreground">{kpi.label}</span>
              <b className="block truncate text-xl font-extrabold tabular-nums tracking-tight text-foreground">{kpi.value}</b>
              <span className="block truncate text-[11.5px] text-muted-foreground">{kpi.extra}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 overflow-hidden rounded-[20px] border bg-card shadow-sm">
          {/* Search, period and view */}
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border bg-card px-2.5">
              <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="sr-only">Search receipts</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search payer, description, UTR…"
                className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
              />
              {search && (
                <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <div role="radiogroup" aria-label="Period" className="flex max-w-full flex-wrap rounded-xl border bg-card p-[3px]">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={period === p.key}
                  onClick={() => {
                    setPeriod(p.key);
                    setDayCount(DAYS_PER_PAGE);
                  }}
                  className={cn('rounded-lg px-2.5 py-1 text-[12.5px] font-semibold', period === p.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label="View" className="flex rounded-xl border bg-card p-[3px]">
              {([['grouped', 'Grouped'], ['list', 'List'], ['date', 'Date-wise']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={view === key}
                  onClick={() => setView(key)}
                  className={cn('rounded-lg px-2.5 py-1 text-[12.5px] font-semibold', view === key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {period === 'custom' && (
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-[12.5px] font-semibold text-muted-foreground">
              <label className="flex items-center gap-2">
                From
                <Input type="date" value={custom.from ?? ''} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || undefined }))} className="h-9 w-auto rounded-lg" />
              </label>
              <label className="flex items-center gap-2">
                to
                <Input type="date" value={custom.to ?? ''} min={custom.from || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || undefined }))} className="h-9 w-auto rounded-lg" />
              </label>
            </div>
          )}
          {/* Banks with money in this period */}
          {bankChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5">
              <button
                type="button"
                aria-pressed={bank === 'all'}
                onClick={() => setBank('all')}
                className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', bank === 'all' ? 'border-foreground text-foreground ring-1 ring-inset ring-foreground' : 'bg-card text-muted-foreground hover:text-foreground')}
              >
                All banks
              </button>
              {bankChips.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={bank === id}
                  onClick={() => setBank(bank === id ? 'all' : id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs font-semibold',
                    bank === id ? 'border-foreground text-foreground ring-1 ring-inset ring-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Tile colours={colourOf(id)} size={20} />
                  {nameOf(id)}
                </button>
              ))}
            </div>
          )}

          {/* The register */}
          {shown.length === 0 ? (
            <div className="px-5 py-12 text-center text-muted-foreground">
              <span aria-hidden className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-[20px] bg-gradient-to-br from-emerald-400 to-teal-700 text-white shadow-lg shadow-teal-700/30">
                <Inbox className="h-7 w-7" />
              </span>
              <b className="block text-base text-foreground">{items.length === 0 ? 'No receipts recorded yet' : 'Nothing matches'}</b>
              <p className="mx-auto mt-1 max-w-md text-sm">
                {items.length === 0
                  ? 'When a client pays, record it here so the bank balance stays current.'
                  : `No receipts ${term ? `match “${search.trim()}” ` : ''}in ${rangeLabel.toLowerCase() === 'all dates' ? 'any period' : rangeLabel}${bank !== 'all' ? ` for ${nameOf(bank)}` : ''}.`}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {items.length === 0 && canAdd && (
                  <Button asChild>
                    <Link href="/bank-balance/receipts/new">
                      <Plus className="mr-2 h-4 w-4" />
                      Record the first receipt
                    </Link>
                  </Button>
                )}
                {items.length > 0 && filtersOn && <Button variant="outline" onClick={clearFilters}>Clear filters</Button>}
                {items.length > 0 && period !== 'all' && <Button variant="outline" onClick={() => setPeriod('all')}>Show all dates</Button>}
              </div>
            </div>
          ) : view === 'grouped' ? (
            <div>
              {days.slice(0, dayCount).map((group) => {
                const at = parseDay(group.day);
                const banks = [...group.banks.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
                const count = banks.reduce((sum, [, g]) => sum + g.items.length, 0);
                return (
                  <div key={group.day} className="border-b last:border-b-0">
                    <div className="flex items-center gap-2.5 bg-muted/40 px-4 py-2.5">
                      <span className="w-[42px] shrink-0 rounded-[10px] border bg-card py-0.5 text-center leading-tight">
                        <b className="block text-[15px] text-foreground">{at ? format(at, 'd') : '?'}</b>
                        <span className="block text-[9.5px] font-extrabold uppercase text-muted-foreground">{at ? format(at, 'MMM') : ''}</span>
                      </span>
                      <span className="min-w-0">
                        <b className="block text-[13px] text-foreground">{at ? format(at, 'EEEE') : group.day}</b>
                        <span className="block text-[11.5px] font-semibold text-muted-foreground">
                          {count} receipt{count === 1 ? '' : 's'} · {banks.length} account{banks.length === 1 ? '' : 's'}
                        </span>
                      </span>
                      <b className="ml-auto text-sm tabular-nums text-emerald-700 dark:text-emerald-400">+{compactInr(group.total)}</b>
                    </div>
                    {banks.map(([accountId, bankGroup]) => (
                      <Fragment key={accountId}>
                        <div className="flex items-center gap-2 px-4 pb-1 pt-2 text-[11.5px] font-extrabold uppercase tracking-[0.05em] text-muted-foreground sm:pl-[68px]">
                          <Tile colours={colourOf(accountId)} size={18} />
                          <span className="min-w-0 truncate">{nameOf(accountId)}</span>
                          <span className="ml-auto tabular-nums text-foreground/70">{formatInr(bankGroup.total, 0)}</span>
                        </div>
                        {bankGroup.items.map((item) => (
                          <div key={item.entry.id} className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 hover:bg-muted/30 sm:grid-cols-[34px_minmax(0,1fr)_minmax(0,150px)_auto_auto] sm:pl-[68px]">
                            <PayerTile name={item.payer} size={34} />
                            <div className="min-w-0">
                              <b className="block text-[13px] leading-snug text-foreground">
                                <span className="break-words">{item.payer || item.entry.description || 'Receipt'}</span>
                                {tags(item)}
                              </b>
                              <span className="block truncate text-[11.5px] text-muted-foreground" title={item.entry.description}>
                                {item.payer ? item.entry.description : ''}
                                <span className="sm:hidden">{item.entry.paymentMethod || item.ref ? `${item.payer ? ' · ' : ''}${[item.entry.paymentMethod, item.ref].filter(Boolean).join(' ')}` : ''}</span>
                              </span>
                            </div>
                            <span className="hidden min-w-0 text-xs text-muted-foreground sm:block">
                              <span className="block truncate font-mono text-[11.5px]">{item.entry.paymentMethod || '—'}</span>
                              {item.ref && <span className="block truncate font-mono text-[11px]" title={item.ref}>{item.ref}</span>}
                            </span>
                            <span className="text-right font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">+{formatInr(item.amount, item.amount % 1 ? 2 : 0)}</span>
                            <span className="col-start-3 row-start-2 justify-self-end sm:col-start-auto sm:row-start-auto">{action(item)}</span>
                          </div>
                        ))}
                      </Fragment>
                    ))}
                  </div>
                );
              })}
              {days.length > dayCount && (
                <div className="flex justify-center border-t px-4 py-3">
                  <Button variant="outline" onClick={() => setDayCount((n) => n + DAYS_PER_PAGE)}>
                    Show {Math.min(DAYS_PER_PAGE, days.length - dayCount)} more day{Math.min(DAYS_PER_PAGE, days.length - dayCount) === 1 ? '' : 's'}
                    <span className="ml-1.5 text-muted-foreground">({days.length - dayCount} left)</span>
                  </Button>
                </div>
              )}
            </div>
          ) : view === 'list' ? (
            // A table from `sm` up; on a phone each row stacks as a card (one mount either way).
            <div className="min-w-0 sm:overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-sm max-sm:block sm:min-w-[760px]">
                <thead className="max-sm:hidden">
                  <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="border-b bg-muted/40 py-2.5 pl-4 pr-2.5 font-bold">Date</th>
                    <th className="border-b bg-muted/40 px-2.5 py-2.5 font-bold">Received from</th>
                    <th className="border-b bg-muted/40 px-2.5 py-2.5 font-bold">Type</th>
                    <th className="border-b bg-muted/40 px-2.5 py-2.5 font-bold">Account</th>
                    <th className="border-b bg-muted/40 px-2.5 py-2.5 font-bold">Mode · UTR</th>
                    <th className="border-b bg-muted/40 px-2.5 py-2.5 text-right font-bold">Amount</th>
                    <th className="border-b bg-muted/40 py-2.5 pl-2 pr-4"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="max-sm:block max-sm:space-y-2.5 max-sm:p-3">
                  {shown.map((item) => (
                    <tr key={item.entry.id} className="max-sm:relative max-sm:block max-sm:rounded-2xl max-sm:border max-sm:p-3">
                      <td className="whitespace-nowrap border-b py-2.5 pl-4 pr-2.5 align-top text-muted-foreground max-sm:block max-sm:border-0 max-sm:p-0 max-sm:text-xs">{formatDay(item.day)}</td>
                      <td className="border-b px-2.5 py-2.5 align-top max-sm:block max-sm:border-0 max-sm:p-0 max-sm:pr-24">
                        <b className="block text-foreground">{item.payer || '—'}</b>
                        <span className="block text-[11.5px] text-muted-foreground">{item.entry.description}</span>
                      </td>
                      <td className="border-b px-2.5 py-2.5 align-top max-sm:inline-block max-sm:border-0 max-sm:p-0 max-sm:pr-2 max-sm:pt-1.5">
                        <span className="text-[12.5px]">{item.entry.receiptType || (item.fromBillTracking ? 'Bill Tracking' : '—')}</span>
                      </td>
                      <td className="border-b px-2.5 py-2.5 align-top max-sm:inline-block max-sm:border-0 max-sm:p-0 max-sm:pt-1.5 max-sm:text-[12.5px] max-sm:text-muted-foreground">{nameOf(item.entry.accountId)}</td>
                      <td className="border-b px-2.5 py-2.5 align-top font-mono text-[11.5px] text-muted-foreground max-sm:block max-sm:border-0 max-sm:p-0 max-sm:pt-1">
                        {[item.entry.paymentMethod, item.ref].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="whitespace-nowrap border-b px-2.5 py-2.5 text-right align-top font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400 max-sm:absolute max-sm:right-3 max-sm:top-3 max-sm:border-0 max-sm:p-0">
                        {formatInr(item.amount)}
                      </td>
                      <td className="border-b py-1.5 pl-2 pr-4 text-right align-top max-sm:block max-sm:border-0 max-sm:p-0 max-sm:pt-1">{action(item)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="max-sm:hidden">
                  <tr className="font-extrabold text-foreground">
                    <td colSpan={5} className="bg-muted/40 py-2.5 pl-4">Total · {summary.count} receipt{summary.count === 1 ? '' : 's'}</td>
                    <td className="bg-muted/40 px-2.5 py-2.5 text-right tabular-nums">{formatInr(summary.total)}</td>
                    <td className="bg-muted/40 pr-4" />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <h2 className="mb-2 text-[13px] font-bold text-foreground">Received per day</h2>
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dateWise.rows.map((row) => ({ day: row.day, total: row.total }))} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                    <CartesianGrid vertical={false} stroke="#94a3b8" strokeOpacity={0.25} />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(day: string) => {
                        const at = parseDay(day);
                        return at ? format(at, 'd MMM') : day;
                      }}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={{ stroke: '#94a3b8', strokeOpacity: 0.4 }}
                      minTickGap={12}
                    />
                    <YAxis tickFormatter={(value: number) => compactInr(value)} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={64} />
                    <Tooltip
                      cursor={{ fill: '#94a3b8', fillOpacity: 0.12 }}
                      content={({ active, payload }) => {
                        const point = active && payload?.[0] ? (payload[0].payload as { day: string; total: number }) : null;
                        if (!point) return null;
                        return (
                          <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                            <b className="block text-foreground">{formatDay(point.day)}</b>
                            <span className="tabular-nums text-muted-foreground">{formatInr(point.total)}</span>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="total" fill="#0d9488" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* The same figures as a table: each day, and each bank's share of it. */}
              <div className="mt-4 min-w-0 overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                      <th className="px-3 py-2 font-bold">Date</th>
                      {dateWise.bankIds.map((id) => <th key={id} className="whitespace-nowrap px-3 py-2 text-right font-bold">{nameOf(id)}</th>)}
                      <th className="px-3 py-2 text-right font-bold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...dateWise.rows].reverse().map((row) => (
                      <tr key={row.day} className="border-t">
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDay(row.day)}</td>
                        {dateWise.bankIds.map((id) => (
                          <td key={id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{row.banks.get(id) ? formatInr(row.banks.get(id)!.total, 0) : '—'}</td>
                        ))}
                        <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums">{formatInr(row.total, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/40 font-extrabold">
                      <td className="px-3 py-2">Total</td>
                      {dateWise.bankIds.map((id) => (
                        <td key={id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatInr(byBank.find(([b]) => b === id)?.[1] ?? 0, 0)}</td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatInr(summary.total, 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* ── Who paid, and where it went ── */}
        <aside className="min-w-0 space-y-3.5">
          <section className="rounded-[20px] border bg-card px-4 pb-3.5 pt-3.5 shadow-sm">
            <h2 className="mb-1.5 text-[13.5px] font-bold text-foreground">Top payers</h2>
            {payers.ranked.length ? (
              payers.ranked.map((payer) => (
                <div key={payer.name} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 py-1.5">
                  <PayerTile name={payer.name} size={28} />
                  <div className="min-w-0">
                    <b className="block truncate text-[12.5px] text-foreground" title={payer.name}>{payer.name}</b>
                    <Meter share={payer.total / payerMax} />
                  </div>
                  <span className="text-right text-[12.5px] font-extrabold tabular-nums text-foreground">{compactInr(payer.total)}</span>
                </div>
              ))
            ) : (
              <p className="text-[12.5px] text-muted-foreground">Payers named on receipts are ranked here.</p>
            )}
            {payers.unknown.count > 0 && (
              <p className="mt-1.5 border-t pt-2 text-[11.5px] text-muted-foreground">
                {payers.unknown.count} receipt{payers.unknown.count === 1 ? '' : 's'} ({compactInr(payers.unknown.total)}) {payers.unknown.count === 1 ? 'has' : 'have'} no payer recorded — entered before New Receipt asked for one.
              </p>
            )}
          </section>
          <section className="rounded-[20px] border bg-card px-4 pb-3.5 pt-3.5 shadow-sm">
            <h2 className="mb-1.5 text-[13.5px] font-bold text-foreground">By bank account</h2>
            {byBank.length ? (
              byBank.map(([id, value]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBank(bank === id ? 'all' : id)}
                  className={cn('grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg py-1.5 text-left hover:bg-muted/40', bank === id && 'bg-muted/50')}
                  aria-pressed={bank === id}
                >
                  <Tile colours={colourOf(id)} size={28} />
                  <div className="min-w-0">
                    <b className="block truncate text-[12.5px] text-foreground">{nameOf(id)}</b>
                    <Meter share={value / bankMax} />
                  </div>
                  <span className="text-right text-[12.5px] font-extrabold tabular-nums text-foreground">{compactInr(value)}</span>
                </button>
              ))
            ) : (
              <p className="text-[12.5px] text-muted-foreground">No money received in this period.</p>
            )}
          </section>
        </aside>
      </div>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this receipt?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${formatInr(deleteTarget.amount)} into ${nameOf(deleteTarget.entry.accountId)} on ${formatDay(deleteTarget.day)}${deleteTarget.payer ? ` from ${deleteTarget.payer}` : ''}. The account's balance changes from that day on. This cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
