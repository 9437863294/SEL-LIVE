'use client';
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { endOfDay, format, startOfDay } from 'date-fns';
import {
  AlertTriangle, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowRightLeft, Check, ChevronDown, Copy, History, Info, Landmark, Loader2,
  Plus, Save, Search, Trash2, X,
} from 'lucide-react';
import { collection, doc, getDocs, runTransaction, Timestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import heroStyles from '@/components/bank-balance/dashboard-designs/aurora.module.css';
import { BANK_PAGE, BankAccessDenied, BankPageSkeleton, accountLabel } from '@/components/bank-balance/page-kit';
import { AccountPicker, Message, TILE_COLOURS, Tile } from '@/components/bank-balance/account-picker';
import { useEntryControls } from '@/components/bank-balance/controls/use-entry-controls';
import { useBBFieldControl } from '@/components/bank-balance/controls/use-field-control';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { balanceAt, buildLedger, compactInr, dayKey, formatDay, formatInr, isCashCredit, parseDay, txnDate } from '@/lib/bank-balance-ledger';
import {
  TRANSFER_KIND_LABEL,
  TRANSFER_MODES,
  batchEffects,
  modeWarning,
  parseAmountInput,
  rupeesInWords,
  transferKind,
  type TransferMode,
} from '@/lib/bank-balance-transfer';
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Row {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  /** As typed: digits and a decimal point. */
  amount: string;
  mode: TransferMode;
  ref: string;
  narration: string;
}

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const newRow = (patch: Partial<Row> = {}): Row => ({ id: makeId(), fromAccountId: '', toAccountId: '', amount: '', mode: 'Internal', ref: '', narration: '', ...patch });
const amountOf = (row: Row) => {
  const value = Number(row.amount);
  return Number.isFinite(value) ? value : 0;
};

/**
 * What the account can pay out at the end of `day`, from the engine (so the opening date is
 * honoured): a current account's balance, or a Cash Credit account's limit in force less its
 * utilisation.
 */
const availableOn = (account: BankAccount, txns: BankExpense[], day: Date) => {
  const figure = balanceAt(buildLedger(account, txns), day);
  return isCashCredit(account) ? getApplicableCcLimit(account, day) - figure : figure;
};

const QUICK_AMOUNTS = [100000, 500000, 1000000, 5000000, 10000000];

// The unsent form, kept in this browser by "Save as draft".
const DRAFT_KEY = 'bankBalance.transferDraft';
interface Draft {
  date: string;
  rows: Row[];
  savedAt: string;
}
function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    const draft = raw ? (JSON.parse(raw) as Draft) : null;
    return draft && Array.isArray(draft.rows) && draft.rows.length ? draft : null;
  } catch {
    return null;
  }
}
function writeDraft(draft: Draft | null) {
  try {
    if (draft) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private windows and blocked storage: the draft just isn't kept.
  }
}

/**
 * New Internal Transfer: one or more transfers between the company's own accounts on one date.
 *
 * Each row moves money from one account to another and writes two legs to `bankExpenses` — a
 * Debit on the source, a Credit on the destination — sharing a `contraId`, all in one
 * transaction. Mode, reference and narration ride on both legs. Every check the form has always
 * made still runs: different accounts, an amount, funds per source across the whole batch, the
 * accounts' opening dates, nothing dated ahead, and Date Control / Month Closure for both accounts.
 */
export default function NewInternalTransactionPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);

  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [focusedAmount, setFocusedAmount] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState<'save' | 'new' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // This page renders in the browser only once data is in (the server sends the skeleton), so
  // reading storage on the first render cannot disagree with server markup.
  const [draft, setDraft] = useState<Draft | null>(() => (typeof window === 'undefined' ? null : readDraft()));

  const fc = useBBFieldControl('transfer');
  const nameOf = (id: string) => accountLabel(bankAccounts.find((account) => account.id === id));
  const controls = useEntryControls('transfer', nameOf);

  const canAdd = !authLoading && can('Add', 'Bank Balance.Internal Transaction');
  const canViewList = can('View', 'Bank Balance.Internal Transaction');
  const activeAccounts = useMemo(
    () =>
      bankAccounts
        .filter((account) => account.status === 'Active')
        .sort((a, b) => Number(isCashCredit(b)) - Number(isCashCredit(a)) || accountLabel(a).localeCompare(accountLabel(b))),
    [bankAccounts],
  );

  // Bumped after a save, so the next batch is checked against balances that include this one.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (authLoading || !canAdd) return;
    let cancelled = false;
    Promise.all([getDocs(collection(db, 'bankAccounts')), getDocs(collection(db, 'bankExpenses'))])
      .then(([accountsSnap, transactionsSnap]) => {
        if (cancelled) return;
        setBankAccounts(accountsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount)));
        setAllTransactions(transactionsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankExpense)));
      })
      .catch((error) => {
        console.error('Error loading initial data:', error);
        if (!cancelled) toast({ title: 'Error', description: 'Failed to load the accounts.', variant: 'destructive' });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, canAdd, toast, reloadKey]);

  // Leaving with typed-in transfers loses them; ask first — as New Payment and New Receipt do.
  const isDirty = rows.some((row) => row.fromAccountId || row.toAccountId || amountOf(row) > 0);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const update = (id: string, patch: Partial<Row>) => setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const addRow = useCallback((patch: Partial<Row> = {}) => {
    setRows((prev) => {
      // A single blank row is replaced rather than added to.
      const blank = prev.length === 1 && !prev[0].fromAccountId && !prev[0].toAccountId && !prev[0].amount;
      return blank ? [newRow(patch)] : [...prev, newRow(patch)];
    });
  }, []);
  const removeRow = (id: string) => setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  const duplicateRow = (id: string) =>
    setRows((prev) => {
      const index = prev.findIndex((row) => row.id === id);
      if (index < 0) return prev;
      const copy = { ...prev[index], id: makeId() };
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
    });

  // ── Figures on the chosen date ──
  const dateKey = dayKey(date);
  // Keyed by the day, so a new Date for the same day recomputes nothing.
  const available = useMemo(() => {
    const day = parseDay(dateKey) ?? new Date();
    const map = new Map<string, number>();
    for (const account of activeAccounts) map.set(account.id, availableOn(account, allTransactions, day));
    return map;
  }, [activeAccounts, allTransactions, dateKey]);
  const availableOf = (id: string) => available.get(id) ?? 0;
  const figures = rows.map((row) => ({ fromAccountId: row.fromAccountId, toAccountId: row.toAccountId, amount: amountOf(row) }));
  const effects = batchEffects(figures);
  const effectOf = (id: string) => effects.get(id) ?? 0;
  const colourOf = (id: string) => TILE_COLOURS[Math.max(0, activeAccounts.findIndex((a) => a.id === id)) % TILE_COLOURS.length];
  const total = figures.reduce((sum, row) => sum + row.amount, 0);

  // Each source's outgoing total across the batch against what it has — every row from the same
  // account together, so two rows cannot each spend the whole balance.
  const outgoing = new Map<string, number>();
  for (const row of figures) if (row.fromAccountId && row.amount > 0) outgoing.set(row.fromAccountId, (outgoing.get(row.fromAccountId) ?? 0) + row.amount);
  const overdrawn = [...outgoing.entries()].filter(([id, out]) => out > availableOf(id) + 0.004).map(([id]) => id);

  const touched = [...new Set(rows.flatMap((row) => [row.fromAccountId, row.toAccountId]).filter(Boolean))];
  const beforeOpening = activeAccounts.filter((account) => {
    if (!touched.includes(account.id)) return false;
    const start = parseDay(account.openingDate);
    return !!start && startOfDay(date) < start;
  });

  // Date Control and Month Closure, for every account in the batch. Never dated ahead.
  const dateLabel = fc.label('date');
  const dateWindow = controls.windowFor(touched);
  const todayKey = dayKey(new Date());
  const minKey = dateWindow.min ?? undefined;
  const maxKey = dateWindow.max && dateWindow.max < todayKey ? dateWindow.max : todayKey;
  const dateCheck = !controls.loading ? controls.check(dateKey, touched, { label: dateLabel }) : null;
  const dateAhead = date > endOfDay(new Date());

  const showMode = fc.field('mode').visible;
  const showRef = fc.field('ref').visible;
  const showNarration = fc.field('narration').visible;
  const refRequired = showRef && fc.field('ref').required;
  const narrationRequired = showNarration && fc.field('narration').required;
  const rowMissing = (row: Row) => ({
    accounts: !row.fromAccountId || !row.toAccountId,
    same: Boolean(row.fromAccountId) && row.fromAccountId === row.toAccountId,
    amount: !(amountOf(row) > 0),
    ref: refRequired && !row.ref.trim(),
    narration: narrationRequired && !row.narration.trim(),
  });

  const checks = [
    { ok: rows.every((row) => row.fromAccountId && row.toAccountId && row.fromAccountId !== row.toAccountId), text: 'Every transfer has two different accounts' },
    { ok: rows.every((row) => amountOf(row) > 0), text: 'Every transfer has an amount' },
    { ok: overdrawn.length === 0, text: 'No account sends more than it has' },
    { ok: beforeOpening.length === 0, text: 'Every account was open on this date' },
    { ok: !dateAhead && (dateCheck?.ok ?? false), text: 'The date is allowed (Date Control, Month Closure)' },
    ...(refRequired || narrationRequired
      ? [{ ok: rows.every((row) => !rowMissing(row).ref && !rowMissing(row).narration), text: 'Required details are filled in' }]
      : []),
  ];
  const ready = checks.every((check) => check.ok) && activeAccounts.length >= 2;

  // The latest transfers, for Repeat: each pair of legs once.
  const recent = useMemo(() => {
    const legs = allTransactions.filter((t) => t.isContra && t.contraId);
    const byContra = new Map<string, { from?: BankExpense; to?: BankExpense }>();
    for (const leg of legs) {
      const pair = byContra.get(leg.contraId!) ?? {};
      if (leg.type === 'Debit') pair.from = leg;
      else pair.to = leg;
      byContra.set(leg.contraId!, pair);
    }
    return [...byContra.values()]
      .flatMap((pair) => {
        if (!pair.from || !pair.to) return [];
        try {
          return [{ at: txnDate(pair.from), from: pair.from.accountId, to: pair.to.accountId, amount: Number(pair.from.amount) || 0, mode: pair.from.transferMode }];
        } catch {
          return [];
        }
      })
      .filter((t) => t.at <= endOfDay(new Date()))
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 5);
  }, [allTransactions]);

  const save = async (then: 'save' | 'new') => {
    if (!canAdd) {
      toast({ title: 'Not allowed', description: 'You do not have permission to add transfers.', variant: 'destructive' });
      return;
    }
    setShowErrors(true);
    const firstBad = rows.findIndex((row) => Object.values(rowMissing(row)).some(Boolean));
    if (firstBad >= 0) {
      const missing = rowMissing(rows[firstBad]);
      toast({
        title: `Transfer ${firstBad + 1} is incomplete`,
        description: missing.same
          ? 'From and To are the same account.'
          : missing.accounts
            ? 'Choose both accounts.'
            : missing.amount
              ? 'Enter an amount above zero.'
              : missing.ref
                ? `${fc.label('ref', rows[firstBad].mode === 'Cheque' ? 'Cheque no.' : undefined)} is required.`
                : `${fc.label('narration')} is required.`,
        variant: 'destructive',
      });
      return;
    }
    if (dateAhead) {
      toast({ title: 'Date not allowed', description: 'A transfer cannot be dated after today.', variant: 'destructive' });
      return;
    }
    if (beforeOpening.length) {
      toast({
        title: 'Date before the account opened',
        description: `${beforeOpening.map((a) => `${accountLabel(a)} opened ${formatDay(a.openingDate)}`).join('; ')}. A transfer dated ${formatDay(date)} would not count toward ${beforeOpening.length === 1 ? 'its balance' : 'their balances'}.`,
        variant: 'destructive',
      });
      return;
    }
    // Date Control's window and the closed months of every account in the batch, checked now.
    const allowed = controls.check(dateKey, touched, { label: dateLabel });
    if (!allowed.ok) {
      toast({ title: 'Date not allowed', description: allowed.reason, variant: 'destructive' });
      return;
    }
    if (overdrawn.length) {
      const id = overdrawn[0];
      const account = activeAccounts.find((a) => a.id === id);
      toast({
        title: 'Insufficient funds',
        description: `Transfers from ${nameOf(id)} total ${formatInr(outgoing.get(id) ?? 0)}, more than the available ${account && isCashCredit(account) ? 'limit' : 'balance'} of ${formatInr(availableOf(id))}.`,
        variant: 'destructive',
      });
      return;
    }

    setSaving(then);
    // Each transfer's shared contraId, fixed up front so a retried transaction writes the same ids.
    const planned = rows.map((row) => ({ row, contraId: doc(collection(db, 'contraIds')).id }));
    try {
      await runTransaction(db, async (tx) => {
        // Firestore needs every read before the first write: each account once, then the legs.
        const snaps = await Promise.all(touched.map((id) => tx.get(doc(db, 'bankAccounts', id))));
        const byId = new Map(snaps.map((snap) => [snap.id, snap]));
        for (const { row, contraId } of planned) {
          const fromSnap = byId.get(row.fromAccountId);
          const toSnap = byId.get(row.toAccountId);
          if (!fromSnap?.exists() || !toSnap?.exists()) throw new Error('One or both bank accounts in a transaction were not found.');
          const from = fromSnap.data() as BankAccount;
          const to = toSnap.data() as BankAccount;
          const narration = showNarration ? row.narration.trim() : '';
          const ref = showRef ? row.ref.trim() : '';
          // No undefined values: the SDK refuses a document carrying one.
          const shared: Record<string, unknown> = {
            date: Timestamp.fromDate(date),
            isContra: true,
            contraId,
            createdAt: Timestamp.now(),
            amount: amountOf(row),
            ...(showMode ? { transferMode: row.mode } : {}),
            ...(narration ? { narration } : {}),
            ...(ref ? (row.mode === 'Cheque' ? { paymentRefNo: ref } : { utrNumber: ref }) : {}),
          };
          const suffix = narration ? ` — ${narration}` : '';
          tx.set(doc(collection(db, 'bankExpenses')), {
            ...shared,
            accountId: row.fromAccountId,
            description: `Transfer to ${to.shortName} - ${to.bankName}${suffix}`,
            type: 'Debit',
          });
          tx.set(doc(collection(db, 'bankExpenses')), {
            ...shared,
            accountId: row.toAccountId,
            description: `Transfer from ${from.shortName} - ${from.bankName}${suffix}`,
            type: 'Credit',
          });
        }
      });

      toast({ title: 'Saved', description: `${rows.length} transfer${rows.length === 1 ? '' : 's'} totalling ${formatInr(total)} saved.` });
      const first = planned[0];
      void log(
        'Add Transfer',
        {
          date: dateKey,
          count: planned.length,
          total,
          transfers: planned.map(({ row, contraId }) => ({
            contraId,
            fromAccountId: row.fromAccountId,
            from: nameOf(row.fromAccountId),
            toAccountId: row.toAccountId,
            to: nameOf(row.toAccountId),
            amount: amountOf(row),
            ...(showMode ? { mode: row.mode } : {}),
          })),
        },
        planned.length === 1
          ? { recordId: first.contraId, recordRef: `${nameOf(first.row.fromAccountId)} → ${nameOf(first.row.toAccountId)}` }
          : { recordRef: `${planned.length} transfers on ${dateKey}` },
      );
      writeDraft(null);
      setDraft(null);
      setShowErrors(false);
      if (then === 'save' && canViewList) {
        router.push('/bank-balance/internal-transaction');
        return;
      }
      // Keep the date: the next batch is usually for the same day. Its checks use balances that
      // include this one.
      setRows([newRow()]);
      setReloadKey((k) => k + 1);
    } catch (error) {
      console.error('Error saving transfers:', error);
      toast({ title: 'Save failed', description: error instanceof Error ? error.message : 'Nothing was saved. Please try again.', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const saveDraft = () => {
    const next: Draft = { date: dateKey, rows, savedAt: new Date().toISOString() };
    writeDraft(next);
    toast({ title: 'Draft saved', description: 'Kept in this browser. It comes back the next time you open New Transfer here.' });
  };

  // Alt+N adds a transfer; Ctrl+Enter saves. Read through refs, so the listener stays one.
  const saveRef = useRef(save);
  const readyRef = useRef(ready);
  useEffect(() => {
    saveRef.current = save;
    readyRef.current = ready;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        addRow();
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && readyRef.current) {
        event.preventDefault();
        void saveRef.current('save');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addRow]);

  if (authLoading || (isLoading && canAdd)) return <BankPageSkeleton kpis={0} />;
  if (!canAdd) {
    return <BankAccessDenied title="New Internal Transfer" backHref="/bank-balance/internal-transaction" backLabel="Back to transfers" what="the transfer entry form" />;
  }

  const restoreDraft = () => {
    if (!draft) return;
    setRows(draft.rows.map((row) => ({ ...newRow(), ...row, id: makeId() })));
    const day = parseDay(draft.date);
    if (day && day <= endOfDay(new Date())) setDate(day);
    writeDraft(null);
    setDraft(null);
  };
  const discardDraft = () => {
    writeDraft(null);
    setDraft(null);
  };

  const accountsById = new Map(activeAccounts.map((a) => [a.id, a]));
  const effectList = [...effects.entries()].filter(([, delta]) => delta !== 0);

  return (
    <div className={cn(BANK_PAGE, 'pb-10')}>
      {/* Where this is, and the way back. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
        <Link href="/bank-balance/internal-transaction" aria-label="Back to transfers" className="mr-1 flex h-[30px] w-[30px] items-center justify-center rounded-lg border bg-card hover:bg-muted">
          <ArrowLeft className="h-[15px] w-[15px]" />
        </Link>
        <Link href="/bank-balance" className="hover:text-foreground">Bank Balance</Link>
        <span aria-hidden>›</span>
        <Link href="/bank-balance/internal-transaction" className="hover:text-foreground">Transfers</Link>
        <span aria-hidden>›</span>
        <span className="text-foreground">New internal transfer</span>
      </nav>

      {/* ── The banner: what this is, the date, and the batch so far ── */}
      <section className={cn(heroStyles.hero, 'keep-light flex flex-wrap items-center gap-4 p-5 sm:p-6')} data-tint="aurora">
        <span aria-hidden className={cn(heroStyles.glass, 'flex h-14 w-14 items-center justify-center rounded-2xl')}>
          <ArrowRightLeft className="h-7 w-7 text-white" />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <h1 className="text-2xl font-extrabold tracking-tight">New internal transfer</h1>
          <p className={heroStyles.muted}>Move money between the company’s own bank and cash credit accounts.</p>
        </div>
        <label className={cn(heroStyles.glass, 'relative flex min-w-[130px] flex-1 cursor-pointer flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
          <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>{dateLabel} ✎</span>
          <b className="text-xl font-extrabold tracking-tight">{format(date, 'd MMM yyyy')}</b>
          <input
            type="date"
            aria-label={dateLabel}
            value={dateKey}
            min={minKey}
            max={maxKey}
            className="absolute inset-0 cursor-pointer opacity-0"
            onClick={(event) => {
              try {
                event.currentTarget.showPicker?.();
              } catch {
                // Some browsers only open it from the icon; focusing is enough there.
              }
            }}
            onChange={(event) => {
              const day = parseDay(event.target.value);
              if (day) setDate(day);
            }}
          />
        </label>
        <div className={cn(heroStyles.glass, 'flex min-w-[110px] flex-1 flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
          <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>Transfers</span>
          <b className="text-xl font-extrabold tabular-nums">{rows.length}</b>
        </div>
        <div className={cn(heroStyles.glass, 'flex min-w-[130px] flex-1 flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
          <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>Total</span>
          <b className="text-xl font-extrabold tabular-nums">{compactInr(total)}</b>
        </div>
        {canViewList && (
          <Link href="/bank-balance/internal-transaction" className={heroStyles.action}>
            <History aria-hidden className="h-4 w-4" />
            History
          </Link>
        )}
      </section>

      {draft && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-100">
          <Info aria-hidden className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            A draft of {draft.rows.length} transfer{draft.rows.length === 1 ? '' : 's'} from {format(new Date(draft.savedAt), 'd MMM, HH:mm')} is saved in this browser.
          </span>
          <Button size="sm" variant="outline" onClick={restoreDraft}>Restore</Button>
          <Button size="sm" variant="ghost" onClick={discardDraft}>Discard</Button>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3.5">
          {rows.map((row, index) => {
            const from = accountsById.get(row.fromAccountId);
            const to = accountsById.get(row.toAccountId);
            const kind = transferKind(from?.accountType, to?.accountType);
            const missing = rowMissing(row);
            const amount = amountOf(row);
            const messages: Array<{ tone: 'bad' | 'warn'; text: string }> = [];
            if (missing.same) messages.push({ tone: 'bad', text: 'From and To are the same account.' });
            if (from && amount > 0 && overdrawn.includes(from.id)) {
              messages.push({
                tone: 'bad',
                text: `${accountLabel(from)} has ${formatInr(availableOf(from.id), 0)} available on ${format(date, 'd MMM')}; this batch sends ${formatInr(outgoing.get(from.id) ?? 0, 0)} out of it.`,
              });
            }
            if (to && isCashCredit(to) && amount > 0) {
              const drawnAfter = getApplicableCcLimit(to, date) - (availableOf(to.id) + effectOf(to.id));
              if (drawnAfter < -0.004) messages.push({ tone: 'warn', text: `${accountLabel(to)} would end ${formatInr(-drawnAfter, 0)} in credit — more is repaid than is drawn.` });
            }
            const warning = showMode ? modeWarning(row.mode, amount) : null;
            if (warning) messages.push({ tone: 'warn', text: warning });
            const bad = messages.some((m) => m.tone === 'bad') || (showErrors && Object.values(missing).some(Boolean));
            const refLabel = fc.label('ref', row.mode === 'Cheque' ? 'Cheque no.' : undefined);
            const amountText = focusedAmount === row.id || !row.amount ? row.amount : Number(row.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });

            return (
              <article key={row.id} className={cn('rounded-[20px] border bg-card shadow-sm transition-colors', bad && 'border-rose-200 dark:border-rose-900/60')}>
                <header className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3 sm:px-[18px]">
                  <span aria-hidden className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-xs font-extrabold text-white">
                    {index + 1}
                  </span>
                  <b className="text-sm text-foreground">Transfer {index + 1}</b>
                  {kind && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11.5px] font-bold',
                        kind === 'repay' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : kind === 'move' ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
                            : 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
                      )}
                    >
                      {TRANSFER_KIND_LABEL[kind]}
                    </span>
                  )}
                  <span className="flex-1" />
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8" title="Duplicate" aria-label={`Duplicate transfer ${index + 1}`} onClick={() => duplicateRow(row.id)}>
                    <Copy className="h-[15px] w-[15px]" />
                  </Button>
                  {rows.length > 1 && (
                    <Button
                      type="button" variant="outline" size="icon" className="h-8 w-8 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                      title="Remove" aria-label={`Remove transfer ${index + 1}`} onClick={() => removeRow(row.id)}
                    >
                      <Trash2 className="h-[15px] w-[15px]" />
                    </Button>
                  )}
                </header>

                <div className="px-4 pb-[18px] pt-4 sm:px-[18px]">
                  <div className="grid grid-cols-1 items-stretch gap-2.5 md:grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)]">
                    <AccountPicker
                      label={fc.label('fromAccountId')}
                      accounts={activeAccounts}
                      value={row.fromAccountId}
                      onChange={(id) => update(row.id, { fromAccountId: id })}
                      otherId={row.toAccountId}
                      availableOf={availableOf}
                      effectOf={effectOf}
                      colourOf={colourOf}
                      invalid={showErrors && (missing.accounts || missing.same)}
                    />
                    <button
                      type="button"
                      title="Swap From and To"
                      aria-label={`Swap From and To on transfer ${index + 1}`}
                      onClick={() => update(row.id, { fromAccountId: row.toAccountId, toAccountId: row.fromAccountId })}
                      className="flex h-10 w-10 rotate-90 items-center justify-center self-center justify-self-center rounded-full border bg-card text-muted-foreground shadow-sm transition hover:border-violet-300 hover:text-violet-600 md:mt-5 md:rotate-0"
                    >
                      <ArrowLeftRight className="h-4 w-4" />
                    </button>
                    <AccountPicker
                      label={fc.label('toAccountId')}
                      accounts={activeAccounts}
                      value={row.toAccountId}
                      onChange={(id) => update(row.id, { toAccountId: id })}
                      otherId={row.fromAccountId}
                      availableOf={availableOf}
                      effectOf={effectOf}
                      colourOf={colourOf}
                      invalid={showErrors && (missing.accounts || missing.same)}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{fc.label('amount')}</span>
                      <div
                        className={cn(
                          'rounded-2xl border bg-card px-3.5 py-2.5 transition focus-within:border-violet-600 focus-within:ring-[3px] focus-within:ring-violet-600/15',
                          showErrors && missing.amount && 'border-destructive',
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span aria-hidden className="text-[26px] font-extrabold text-muted-foreground">₹</span>
                          <input
                            inputMode="decimal"
                            aria-label={`Transfer ${index + 1} amount`}
                            placeholder="0"
                            value={amountText}
                            onFocus={() => setFocusedAmount(row.id)}
                            onBlur={() => setFocusedAmount(null)}
                            onChange={(event) => update(row.id, { amount: parseAmountInput(event.target.value) })}
                            className="w-full min-w-0 bg-transparent text-[28px] font-extrabold tabular-nums tracking-tight text-foreground outline-none"
                          />
                        </div>
                        <p className="min-h-[18px] text-xs text-muted-foreground">{rupeesInWords(amount)}</p>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {QUICK_AMOUNTS.map((step) => (
                          <button
                            key={step}
                            type="button"
                            onClick={() => update(row.id, { amount: String(Math.round((amount + step) * 100) / 100) })}
                            className="rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs font-bold text-muted-foreground hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:hover:bg-violet-950/40"
                          >
                            +{compactInr(step)}
                          </button>
                        ))}
                        {row.amount && (
                          <button type="button" onClick={() => update(row.id, { amount: '' })} className="rounded-full border px-2.5 py-0.5 text-xs font-bold text-muted-foreground hover:text-foreground">
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {showMode && (
                        <div className="sm:col-span-2">
                          <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{fc.label('mode')}</span>
                          <div role="radiogroup" aria-label={`Transfer ${index + 1} mode`} className="flex flex-wrap gap-1.5">
                            {TRANSFER_MODES.map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                role="radio"
                                aria-checked={row.mode === mode}
                                onClick={() => update(row.id, { mode })}
                                className={cn(
                                  'rounded-[10px] border px-2.5 py-1.5 text-[12.5px] font-semibold',
                                  row.mode === mode ? 'border-foreground bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground',
                                )}
                              >
                                {mode}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {showRef && (
                        <label className="min-w-0">
                          <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                            {refLabel}
                            {refRequired && <span className="text-destructive"> *</span>}
                          </span>
                          <Input
                            value={row.ref}
                            placeholder={row.mode === 'Cheque' ? '000123' : refRequired ? '' : 'Optional'}
                            onChange={(event) => update(row.id, { ref: event.target.value })}
                            className={cn('h-10 rounded-xl font-mono', showErrors && missing.ref && 'border-destructive')}
                          />
                        </label>
                      )}
                      {showNarration && (
                        <label className="min-w-0">
                          <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                            {fc.label('narration')}
                            {narrationRequired && <span className="text-destructive"> *</span>}
                          </span>
                          <Input
                            value={row.narration}
                            placeholder={narrationRequired ? 'What the transfer is for' : 'e.g. Repay the CC'}
                            maxLength={120}
                            onChange={(event) => update(row.id, { narration: event.target.value })}
                            className={cn('h-10 rounded-xl', showErrors && missing.narration && 'border-destructive')}
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  {messages.map((message) => (
                    <Message key={message.text} tone={message.tone}>{message.text}</Message>
                  ))}
                </div>
              </article>
            );
          })}

          <button
            type="button"
            onClick={() => addRow()}
            className="flex w-full items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-slate-300 py-3.5 font-bold text-muted-foreground transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:hover:bg-violet-950/30"
          >
            <Plus aria-hidden className="h-4 w-4" />
            Add another transfer <span className="hidden font-semibold text-muted-foreground sm:inline">(Alt + N)</span>
          </button>

          {recent.length > 0 && (
            <section className="overflow-hidden rounded-[20px] border bg-card shadow-sm">
              <header className="flex items-center justify-between px-4 py-3.5 sm:px-[18px]">
                <b className="text-[14.5px] text-foreground">Recent transfers</b>
                {canViewList && (
                  <Link href="/bank-balance/internal-transaction" className="text-[12.5px] font-bold text-indigo-600 hover:underline dark:text-indigo-400">View all →</Link>
                )}
              </header>
              <ul>
                {recent.map((t, i) => (
                  <li
                    key={`${t.at.getTime()}-${i}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 text-[12.5px] sm:grid-cols-[70px_minmax(0,1fr)_80px_110px_70px] sm:px-[18px]"
                  >
                    <span className="font-semibold text-muted-foreground">{format(t.at, 'd MMM')}</span>
                    <span className="col-span-2 row-start-2 flex min-w-0 items-center gap-2 font-bold text-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">
                      <Tile colours={colourOf(t.from)} size={22} />
                      <span className="truncate">{nameOf(t.from)}</span>
                      <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <Tile colours={colourOf(t.to)} size={22} />
                      <span className="truncate">{nameOf(t.to)}</span>
                    </span>
                    <span className="hidden text-muted-foreground sm:block">{t.mode || '—'}</span>
                    <span className="text-right font-extrabold tabular-nums text-foreground">{compactInr(t.amount)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        addRow({ fromAccountId: accountsById.has(t.from) ? t.from : '', toAccountId: accountsById.has(t.to) ? t.to : '', ...(t.mode && (TRANSFER_MODES as readonly string[]).includes(t.mode) ? { mode: t.mode as TransferMode } : {}) });
                        toast({ title: 'Added a copy of that transfer', description: 'Enter the amount.' });
                      }}
                      className="col-start-2 row-start-2 text-right font-bold text-indigo-600 hover:underline sm:col-start-auto sm:row-start-auto dark:text-indigo-400"
                    >
                      Repeat
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ── The batch as a whole, and saving it ── */}
        <aside className="min-w-0 overflow-hidden rounded-[20px] border bg-card shadow-sm xl:sticky xl:top-20">
          <header className="px-[18px] pb-2.5 pt-4">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Total to transfer</p>
            <p className="text-[30px] font-extrabold leading-tight tracking-tight tabular-nums text-foreground">{formatInr(total, total % 1 ? 2 : 0)}</p>
            <p className="text-xs text-muted-foreground">{total ? rupeesInWords(total) : 'Enter an amount to see it in words'}</p>
          </header>
          <div className="border-t px-[18px] py-3">
            <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Effect on accounts</h2>
            {effectList.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Pick accounts and an amount to see how each balance changes.</p>
            ) : (
              <ul className="space-y-1">
                {effectList.map(([id, delta]) => {
                  const account = accountsById.get(id);
                  if (!account) return null;
                  const cc = isCashCredit(account);
                  const now = availableOf(id);
                  return (
                    <li key={id} className="flex items-center gap-2.5 py-1.5">
                      <Tile colours={colourOf(id)} size={28} />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[12.5px] text-foreground">{accountLabel(account)}</b>
                        <span className="block truncate text-[11.5px] text-muted-foreground">
                          {cc ? 'Avail. limit' : 'Balance'} {compactInr(now)} → {compactInr(now + delta)}
                        </span>
                      </span>
                      <span className={cn('shrink-0 text-right text-[12.5px] font-extrabold tabular-nums', delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                        {delta > 0 ? '+' : '−'}{compactInr(Math.abs(delta))}
                        <span className="block text-[11px] font-semibold">{cc ? (delta > 0 ? 'repaid' : 'drawn') : delta > 0 ? 'in' : 'out'}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t px-[18px] py-3">
            <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Before you save</h2>
            <ul className="space-y-1">
              {checks.map((check) => (
                <li key={check.text} className="flex items-center gap-2 py-0.5 text-[12.5px] font-semibold text-foreground">
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full',
                      check.ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
                    )}
                  >
                    {check.ok ? <Check className="h-[11px] w-[11px]" strokeWidth={3} /> : <X className="h-[11px] w-[11px]" strokeWidth={3} />}
                  </span>
                  <span className="sr-only">{check.ok ? 'Done:' : 'Not yet:'}</span>
                  {check.text}
                </li>
              ))}
            </ul>
            {dateCheck && !dateCheck.ok && !controls.loading && <p className="mt-2 text-xs text-destructive">{dateCheck.reason}</p>}
          </div>
          <div className="flex flex-col gap-2 border-t px-[18px] pb-[18px] pt-3.5">
            <Button
              onClick={() => void save('save')}
              disabled={!ready || saving !== null}
              className="h-11 gap-2 border-0 bg-gradient-to-r from-teal-700 via-blue-600 to-violet-600 text-white shadow-md hover:opacity-95"
            >
              {saving === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save transfer{rows.length > 1 ? 's' : ''}
              <span className="ml-1 hidden rounded border border-white/50 px-1 text-[10.5px] font-semibold opacity-85 sm:inline">Ctrl ↵</span>
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => void save('new')} disabled={!ready || saving !== null}>
                {saving === 'new' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Save &amp; new
              </Button>
              <Button variant="outline" className="flex-1" onClick={saveDraft} disabled={!isDirty || saving !== null}>
                Save as draft
              </Button>
            </div>
            <p className="text-center text-[11.5px] text-muted-foreground">
              {dateWindow.enforced && dateWindow.min ? `Dates allowed: ${formatDay(dateWindow.min)} – ${maxKey === todayKey ? 'today' : formatDay(maxKey)} (Date Control)` : 'Any date up to today'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
