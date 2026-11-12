'use client';
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { endOfDay, format, startOfDay } from 'date-fns';
import { ArrowLeft, Check, Copy, History, Info, Loader2, Plus, Receipt, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { collection, doc, getDocs, runTransaction, Timestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import heroStyles from '@/components/bank-balance/dashboard-designs/aurora.module.css';
import { BANK_PAGE, BankAccessDenied, BankPageSkeleton, accountLabel } from '@/components/bank-balance/page-kit';
import { AccountPicker, Message, Tile, tileColours } from '@/components/bank-balance/account-picker';
import { useEntryControls } from '@/components/bank-balance/controls/use-entry-controls';
import { useBBFieldControl } from '@/components/bank-balance/controls/use-field-control';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { balanceAt, buildLedger, compactInr, dayKey, formatDay, formatInr, isCashCredit, parseDay, txnDate } from '@/lib/bank-balance-ledger';
import { parseAmountInput, rupeesInWords } from '@/lib/bank-balance-transfer';
import {
  BANK_CHARGES_METHOD,
  CHARGE_TYPES,
  DEFAULT_GST_RATE,
  GST_RATES,
  GST_SPLITS,
  chargeDescription,
  chargeName,
  chargeTotal,
  gstOn,
  lastChargeLike,
  round2,
  splitGst,
  type ChargeType,
  type GstSplit,
} from '@/lib/bank-balance-charges';
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Row {
  id: string;
  type: ChargeType;
  /** The name typed for an "Other" charge. */
  otherName: string;
  /** As typed: digits and a decimal point. */
  charge: string;
  gstRate: number;
  gstSplit: GstSplit;
  /** The GST as printed on the statement, when it differs from the rate's arithmetic; null = worked out. */
  gstTyped: string | null;
  other: string;
  otherLabel: string;
  ref: string;
  note: string;
}

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const newRow = (patch: Partial<Row> = {}): Row => ({
  id: makeId(), type: 'RTGS', otherName: '', charge: '', gstRate: DEFAULT_GST_RATE, gstSplit: 'CGST + SGST', gstTyped: null,
  other: '', otherLabel: '', ref: '', note: '', ...patch,
});
const num = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const hasContent = (row: Row) => Boolean(row.charge || row.other || row.ref || row.note || row.otherName);

/** An entry's date, or null when it cannot be read (imported or hand-edited rows). */
const safeDate = (entry: BankExpense): Date | null => {
  try {
    const at = txnDate(entry);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
};

/** What the account can pay out at the end of `day`: a current account's balance, or a Cash Credit's limit less what is drawn. */
const availableOn = (account: BankAccount, txns: BankExpense[], day: Date) => {
  const figure = balanceAt(buildLedger(account, txns), day);
  return isCashCredit(account) ? getApplicableCcLimit(account, day) - figure : figure;
};

// The unsent form, kept in this browser by "Save draft".
const DRAFT_KEY = 'bankBalance.chargeDraft';
interface Draft {
  date: string;
  accountId: string;
  rows: Row[];
  savedAt: string;
}
function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    const draft = raw ? (JSON.parse(raw) as Draft) : null;
    return draft && Array.isArray(draft.rows) && draft.rows.length && !Number.isNaN(Date.parse(draft.savedAt)) ? draft : null;
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

const LABEL = 'mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground';
const CHIP = 'rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold';
const CHIP_ON = 'border-foreground bg-foreground text-background';
const CHIP_OFF = 'bg-card text-muted-foreground hover:text-foreground';

/**
 * Bank Charges: what the bank debits on its own — RTGS/NEFT/IMPS charges, cheque books, returns,
 * alerts, maintenance and processing fees — with the GST it adds and any other levy.
 *
 * Each card writes one `bankExpenses` Debit for the whole debit (charge + GST + other), all in one
 * transaction, with `paymentMethod` "Bank Charges" and the breakdown on the same document. So it
 * lowers the account's balance from that day, is listed on Payments, and is held to Date Control
 * and Month Closure as a payment. It is recorded even if it overdraws the account: the bank has
 * already taken the money, and the page says so instead of refusing.
 */
export default function NewBankChargesPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  // A charge is a payment out of the account: the same right as New Payment.
  const canAdd = !authLoading && can('Add', 'Bank Balance.Expenses');
  const canViewList = can('View', 'Bank Balance.Expenses');

  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  const [accountId, setAccountId] = useState('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankExpense[]>([]);
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [focused, setFocused] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState<'save' | 'new' | null>(null);
  const savingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  // This page renders in the browser only once data is in (the server sends the skeleton), so
  // reading storage on the first render cannot disagree with server markup.
  const [draft, setDraft] = useState<Draft | null>(() => (typeof window === 'undefined' ? null : readDraft()));

  // Field Control (labels, which fields show and which are required), Date Control's window and
  // the Month Closure calendar — a charge is held to them as a payment.
  const fc = useBBFieldControl('charge');
  const nameOf = (id: string) => accountLabel(bankAccounts.find((account) => account.id === id));
  const controls = useEntryControls('payment', nameOf);
  const show = { gst: fc.field('gst').visible, other: fc.field('other').visible, ref: fc.field('ref').visible, note: fc.field('note').visible };
  const need = {
    other: show.other && fc.field('other').required,
    ref: show.ref && fc.field('ref').required,
    note: show.note && fc.field('note').required,
  };

  // Bumped after a save, so the next batch sees balances that include this one.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (authLoading || !canAdd) return;
    let cancelled = false;
    Promise.all([getDocs(collection(db, 'bankAccounts')), getDocs(collection(db, 'bankExpenses'))])
      .then(([accountsSnap, txnSnap]) => {
        if (cancelled) return;
        setBankAccounts(accountsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount)));
        setTransactions(txnSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankExpense)));
      })
      .catch((error) => {
        console.error('Error loading bank charge data:', error);
        if (!cancelled) toast({ title: 'Error', description: 'Failed to load the bank accounts.', variant: 'destructive' });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, canAdd, toast, reloadKey]);

  // Leaving with typed-in charges loses them; ask first.
  const isDirty = rows.some(hasContent);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const activeAccounts = useMemo(
    () =>
      bankAccounts
        .filter((account) => account.status === 'Active')
        .sort((a, b) => Number(isCashCredit(b)) - Number(isCashCredit(a)) || accountLabel(a).localeCompare(accountLabel(b))),
    [bankAccounts],
  );
  const account = activeAccounts.find((a) => a.id === accountId);

  const update = (id: string, patch: Partial<Row>) => setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const addRow = useCallback(() => setRows((prev) => [...prev, newRow({ gstSplit: prev[prev.length - 1]?.gstSplit })]), []);
  const removeRow = (id: string) => setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  const duplicateRow = (id: string) =>
    setRows((prev) => {
      const index = prev.findIndex((row) => row.id === id);
      if (index < 0) return prev;
      const copy = { ...prev[index], id: makeId(), ref: '' };
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
    });

  // ── Each card's figures ──
  const figuresOf = (row: Row) => {
    const charge = round2(num(row.charge));
    const worked = gstOn(charge, row.gstRate);
    const gst = show.gst ? round2(row.gstTyped !== null ? num(row.gstTyped) : worked) : 0;
    const other = show.other ? round2(num(row.other)) : 0;
    return { charge, worked, gst, other, total: chargeTotal(charge, gst, other), split: splitGst(gst, row.gstSplit) };
  };
  const all = rows.map(figuresOf);
  const sum = (pick: (f: (typeof all)[number]) => number) => round2(all.reduce((s, f) => s + pick(f), 0));
  const totals = {
    charge: sum((f) => f.charge),
    gst: sum((f) => f.gst),
    cgst: sum((f) => f.split.cgst),
    sgst: sum((f) => f.split.sgst),
    igst: sum((f) => f.split.igst),
    other: sum((f) => f.other),
    total: sum((f) => f.total),
  };

  // ── The account on the chosen date ──
  const dateKey = dayKey(date);
  const available = useMemo(() => {
    const day = parseDay(dateKey) ?? new Date();
    const map = new Map<string, number>();
    for (const a of activeAccounts) map.set(a.id, availableOn(a, transactions, day));
    return map;
  }, [activeAccounts, transactions, dateKey]);
  const availableOf = (id: string) => available.get(id) ?? 0;
  const colourOf = (id: string) => tileColours(activeAccounts.findIndex((a) => a.id === id));
  const figure = useMemo(() => {
    if (!account) return null;
    const day = parseDay(dateKey) ?? new Date();
    return balanceAt(buildLedger(account, transactions.filter((t) => t.accountId === account.id)), day);
  }, [account, transactions, dateKey]);

  // Charges already on record, newest first: "used recently" accounts and last time's amount per type.
  const history = useMemo(
    () =>
      transactions
        .filter((t) => t.entryKind === 'bankCharge' && t.type === 'Debit')
        .map((t) => ({ ...t, at: safeDate(t) }))
        .filter((t): t is BankExpense & { at: Date } => t.at !== null)
        .sort((a, b) => b.at.getTime() - a.at.getTime()),
    [transactions],
  );
  const recentAccounts = useMemo(() => {
    const order: string[] = [];
    for (const item of history) if (!order.includes(item.accountId) && activeAccounts.some((a) => a.id === item.accountId)) order.push(item.accountId);
    return order.slice(0, 3);
  }, [history, activeAccounts]);

  // ── Checks ──
  const openingDay = account ? parseDay(account.openingDate) : null;
  const beforeOpening = Boolean(openingDay && date < openingDay);
  const dateLabel = fc.label('date');
  const touched = accountId ? [accountId] : [];
  const dateWindow = controls.windowFor(touched);
  const todayKey = dayKey(new Date());
  const maxKey = dateWindow.max && dateWindow.max < todayKey ? dateWindow.max : todayKey;
  const dateAhead = date > endOfDay(new Date());
  const dateCheck = !controls.loading ? controls.check(dateKey, touched, { label: dateLabel }) : null;
  const rowMissing = (row: Row, f: ReturnType<typeof figuresOf>) => ({
    charge: !(f.charge > 0),
    name: row.type === 'Other' && !row.otherName.trim(),
    other: need.other && !(f.other > 0),
    ref: need.ref && !row.ref.trim(),
    note: need.note && !row.note.trim(),
    negative: f.gst < 0 || f.other < 0,
  });
  const missingAt = rows.map((row, i) => rowMissing(row, all[i]));
  const checks = [
    { ok: Boolean(account), text: 'Bank account selected' },
    { ok: missingAt.every((m) => !m.charge), text: 'Every charge has an amount' },
    ...(rows.some((row) => row.type === 'Other') ? [{ ok: missingAt.every((m) => !m.name), text: 'Every “Other” charge is named' }] : []),
    ...(need.other || need.ref || need.note ? [{ ok: missingAt.every((m) => !m.other && !m.ref && !m.note), text: 'Required details are filled in' }] : []),
    { ok: !beforeOpening, text: 'The account was open on this date' },
    { ok: !dateAhead && (dateCheck?.ok ?? false), text: 'The date is allowed (Date Control, Month Closure)' },
  ];
  const ready = checks.every((check) => check.ok) && missingAt.every((m) => !m.negative) && activeAccounts.length > 0;

  const save = async (then: 'save' | 'new') => {
    if (savingRef.current) return;
    if (!canAdd) {
      toast({ title: 'Not allowed', description: 'You do not have permission to add payments, which bank charges are.', variant: 'destructive' });
      return;
    }
    setShowErrors(true);
    if (!account) {
      toast({ title: 'Check the charges', description: 'Choose the bank account that was charged.', variant: 'destructive' });
      return;
    }
    const firstBad = missingAt.findIndex((m) => Object.values(m).some(Boolean));
    if (firstBad >= 0) {
      const m = missingAt[firstBad];
      toast({
        title: `Charge ${firstBad + 1} is incomplete`,
        description: m.charge
          ? `Enter the ${fc.label('amount').toLowerCase()} above zero.`
          : m.name
            ? 'Name the charge.'
            : m.negative
              ? 'GST and other charges cannot be below zero.'
              : m.other
                ? `${fc.label('other')} is required.`
                : m.ref
                  ? `${fc.label('ref')} is required.`
                  : `${fc.label('note')} is required.`,
        variant: 'destructive',
      });
      return;
    }
    if (dateAhead) {
      toast({ title: 'Date not allowed', description: 'A bank charge cannot be dated after today.', variant: 'destructive' });
      return;
    }
    if (beforeOpening && openingDay) {
      toast({
        title: 'Date before the account opened',
        description: `${accountLabel(account)} opened ${formatDay(openingDay)}. A charge dated earlier would not count toward its balance.`,
        variant: 'destructive',
      });
      return;
    }
    // Date Control's window and the closed months, checked at the moment of saving.
    const allowed = controls.check(dateKey, [accountId], { label: dateLabel });
    if (!allowed.ok) {
      toast({ title: 'Date not allowed', description: allowed.reason, variant: 'destructive' });
      return;
    }

    savingRef.current = true;
    setSaving(then);
    const planned = rows.map((row, index) => ({ row, f: all[index], ref: doc(collection(db, 'bankExpenses')) }));
    try {
      await runTransaction(db, async (tx) => {
        for (const { row, f, ref } of planned) {
          const otherLabel = row.otherLabel.trim();
          const reference = show.ref ? row.ref.trim() : '';
          const note = show.note ? row.note.trim() : '';
          // No undefined values: the SDK refuses a document carrying one.
          tx.set(ref, {
            date: Timestamp.fromDate(date),
            accountId,
            description: chargeDescription({
              type: row.type, otherName: row.otherName, charge: f.charge, gst: f.gst, gstRate: row.gstRate, other: f.other, otherLabel, note,
            }),
            amount: f.total,
            type: 'Debit',
            isContra: false,
            createdAt: Timestamp.now(),
            paymentMethod: BANK_CHARGES_METHOD,
            entryKind: 'bankCharge',
            chargeType: row.type,
            ...(row.type === 'Other' ? { chargeName: row.otherName.trim() } : {}),
            chargeAmount: f.charge,
            ...(show.gst
              ? { gstRate: row.gstRate, gstAmount: f.gst, gstSplit: row.gstSplit, cgstAmount: f.split.cgst, sgstAmount: f.split.sgst, igstAmount: f.split.igst }
              : {}),
            ...(f.other > 0 ? { otherChargeAmount: f.other, ...(otherLabel ? { otherChargeLabel: otherLabel } : {}) } : {}),
            ...(reference ? { utrNumber: reference } : {}),
          });
        }
      });
      toast({
        title: 'Saved',
        description: `${rows.length} bank charge${rows.length === 1 ? '' : 's'} of ${formatInr(totals.total)} debited from ${accountLabel(account)}. They are on Payments.`,
      });
      void log(
        'Add Bank Charges',
        {
          count: planned.length,
          total: totals.total,
          gst: totals.gst,
          accountId,
          account: accountLabel(account),
          date: dateKey,
          charges: planned.map(({ row, f, ref }) => ({
            id: ref.id, type: chargeName(row.type, row.otherName), charge: f.charge, gst: f.gst, other: f.other, total: f.total,
          })),
        },
        {
          ...(planned.length === 1 ? { recordId: planned[0].ref.id } : {}),
          recordRef: `${accountLabel(account)} · ${dateKey}`,
        },
      );
      writeDraft(null);
      setDraft(null);
      setShowErrors(false);
      if (then === 'save' && canViewList) {
        router.push('/bank-balance/expenses');
        return;
      }
      // Keep the date and account: the next batch is usually for the same day and bank.
      setRows([newRow({ gstSplit: rows[rows.length - 1]?.gstSplit })]);
      setReloadKey((k) => k + 1);
    } catch (error) {
      console.error('Error saving bank charges:', error);
      toast({ title: 'Save failed', description: 'Nothing was saved. Please try again.', variant: 'destructive' });
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };

  const saveDraft = () => {
    writeDraft({ date: dateKey, accountId, rows, savedAt: new Date().toISOString() });
    toast({ title: 'Draft saved', description: 'Kept in this browser. It comes back the next time you open Bank Charges here.' });
  };

  // Alt+N adds a charge; Ctrl+Enter saves. Read through refs, so the listener stays one.
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
    return <BankAccessDenied title="Bank Charges" backHref="/bank-balance/expenses" backLabel="Back to payments" what="the bank charges form" />;
  }

  const restoreDraft = () => {
    if (!draft) return;
    setRows(draft.rows.map((row) => ({ ...newRow(), ...row, id: makeId() })));
    if (activeAccounts.some((a) => a.id === draft.accountId)) setAccountId(draft.accountId);
    const day = parseDay(draft.date);
    if (day && day <= endOfDay(new Date())) setDate(day);
    writeDraft(null);
    setDraft(null);
  };
  const discardDraft = () => {
    writeDraft(null);
    setDraft(null);
  };

  const cc = account ? isCashCredit(account) : false;
  const after = figure === null ? null : cc ? figure + totals.total : figure - totals.total;
  const limit = account && cc ? getApplicableCcLimit(account, date) : 0;
  // Overdrawn: a current account below zero, or a Cash Credit drawn past its limit.
  const overdrawn = after !== null && totals.total > 0 && (cc ? after > limit + 0.004 : after < -0.004);
  const amountText = (id: string, value: string) => (focused === id || !value ? value : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

  return (
    <div className={cn(BANK_PAGE, 'pb-10')}>
      {/* Where this is, and the way back. */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
        <Link href="/bank-balance/expenses" aria-label="Back to payments" className="mr-1 flex h-[30px] w-[30px] items-center justify-center rounded-lg border bg-card hover:bg-muted">
          <ArrowLeft className="h-[15px] w-[15px]" />
        </Link>
        <Link href="/bank-balance" className="hover:text-foreground">Bank Balance</Link>
        <span aria-hidden>›</span>
        <Link href="/bank-balance/expenses" className="hover:text-foreground">Payments</Link>
        <span aria-hidden>›</span>
        <span className="text-foreground">Bank charges</span>
      </nav>

      {/* ── The banner ── */}
      <section className={cn(heroStyles.hero, 'keep-light flex flex-wrap items-center gap-4 p-5 sm:p-6')} data-tint="sunset">
        <span aria-hidden className={cn(heroStyles.glass, 'flex h-14 w-14 items-center justify-center rounded-2xl')}>
          <Receipt className="h-7 w-7 text-white" />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <h1 className="text-2xl font-extrabold tracking-tight">Bank charges</h1>
          <p className={heroStyles.muted}>RTGS, NEFT and other charges the bank debited, with GST. Each one is a payment out of the account.</p>
        </div>
        <label className={cn(heroStyles.glass, 'relative flex min-w-[130px] flex-1 cursor-pointer flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
          <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>{dateLabel} ✎</span>
          <b className="text-xl font-extrabold tracking-tight">{format(date, 'd MMM yyyy')}</b>
          <input
            type="date"
            aria-label={dateLabel}
            value={dateKey}
            min={dateWindow.min ?? undefined}
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
        <div className={cn(heroStyles.glass, 'flex min-w-[100px] flex-1 flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
          <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>Charges</span>
          <b className="text-xl font-extrabold tabular-nums">{rows.length}</b>
        </div>
        <div className={cn(heroStyles.glass, 'flex min-w-[120px] flex-1 flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
          <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>Total debit</span>
          <b className="text-xl font-extrabold tabular-nums">{compactInr(totals.total)}</b>
        </div>
        {canViewList && (
          <Link href="/bank-balance/expenses" className={heroStyles.action}>
            <History aria-hidden className="h-4 w-4" />
            Payments
          </Link>
        )}
      </section>

      {draft && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-100">
          <Info aria-hidden className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            A draft of {draft.rows.length} charge{draft.rows.length === 1 ? '' : 's'} from {format(new Date(draft.savedAt), 'd MMM, HH:mm')} is saved in this browser.
          </span>
          <Button size="sm" variant="outline" onClick={restoreDraft}>Restore</Button>
          <Button size="sm" variant="ghost" onClick={discardDraft}>Discard</Button>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_370px]">
        <div className="min-w-0 space-y-3.5">
          {/* ── Step 1: the account ── */}
          <section className="rounded-[20px] border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3.5 sm:px-[18px]">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-rose-600 text-[12.5px] font-extrabold text-white">1</span>
              <div className="min-w-0">
                <b className="block text-[15px] leading-tight text-foreground">Charged to</b>
                <p className="text-xs text-muted-foreground">The bank account the charges were debited from</p>
              </div>
            </header>
            <div className="grid grid-cols-1 items-start gap-3.5 px-4 pb-[18px] pt-4 sm:px-[18px] lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <AccountPicker
                label={`${fc.label('accountId')} *`}
                accounts={activeAccounts}
                value={accountId}
                onChange={setAccountId}
                otherId=""
                availableOf={availableOf}
                effectOf={(id) => (id === accountId ? -totals.total : 0)}
                colourOf={colourOf}
                invalid={showErrors && !account}
              />
              {recentAccounts.length > 0 && (
                <div className="min-w-0">
                  <span className={LABEL}>Charged recently</span>
                  <div className="flex flex-col gap-1.5">
                    {recentAccounts.map((id) => {
                      const a = activeAccounts.find((x) => x.id === id);
                      if (!a) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setAccountId(id)}
                          className={cn(
                            'flex items-center gap-2 rounded-xl border bg-card px-2.5 py-1.5 text-left text-[12.5px] font-semibold transition hover:border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30',
                            id === accountId && 'border-orange-500 bg-orange-50 dark:bg-orange-950/30',
                          )}
                        >
                          <Tile colours={colourOf(id)} size={24} />
                          <span className="min-w-0 flex-1 truncate text-foreground">{accountLabel(a)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── Step 2: the charges ── */}
          <section className="rounded-[20px] border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3.5 sm:px-[18px]">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-rose-600 text-[12.5px] font-extrabold text-white">2</span>
              <div className="min-w-0 flex-1 basis-60">
                <b className="block text-[15px] leading-tight text-foreground">Charges</b>
                <p className="text-xs text-muted-foreground">One card per debit on the statement: the charge, its GST and any other levy.</p>
              </div>
            </header>
            <div className="space-y-3 px-4 pb-2 pt-4 sm:px-[18px]">
              {rows.map((row, index) => {
                const f = all[index];
                const m = missingAt[index];
                const bad = m.negative || (showErrors && Object.values(m).some(Boolean));
                const last = lastChargeLike(history, accountId, row.type);
                const lastDiffers = last && (round2(last.chargeAmount ?? 0) !== f.charge || (last.gstRate ?? DEFAULT_GST_RATE) !== row.gstRate);
                const gstText = row.gstTyped !== null ? row.gstTyped : f.worked ? f.worked.toFixed(2) : '';
                return (
                  <article key={row.id} className={cn('rounded-[18px] border transition-colors', bad && 'border-rose-200 dark:border-rose-900/60')}>
                    <header className="flex flex-wrap items-center gap-2.5 border-b px-3.5 py-2.5">
                      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-rose-600 text-[11.5px] font-extrabold text-white">
                        {index + 1}
                      </span>
                      <div role="radiogroup" aria-label={`Charge ${index + 1} ${fc.label('chargeType').toLowerCase()}`} className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                        {CHARGE_TYPES.map((type) => (
                          <button
                            key={type}
                            type="button"
                            role="radio"
                            aria-checked={row.type === type}
                            onClick={() => update(row.id, { type })}
                            className={cn(
                              'rounded-full border px-2.5 py-0.5 text-xs font-bold',
                              row.type === type ? 'border-orange-600 bg-orange-600 text-white dark:border-orange-500 dark:bg-orange-600' : 'bg-card text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                      <div className="ml-auto flex shrink-0 gap-1.5">
                        <Button type="button" variant="outline" size="icon" className="h-[30px] w-[30px]" title="Duplicate" aria-label={`Duplicate charge ${index + 1}`} onClick={() => duplicateRow(row.id)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        {rows.length > 1 && (
                          <Button
                            type="button" variant="outline" size="icon" className="h-[30px] w-[30px] hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                            title="Remove" aria-label={`Remove charge ${index + 1}`} onClick={() => removeRow(row.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </header>

                    <div className="grid grid-cols-1 gap-3 p-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
                      {/* The charge itself */}
                      <div className="min-w-0 space-y-3">
                        {row.type === 'Other' && (
                          <label className="block min-w-0">
                            <span className={LABEL}>
                              Charge name <span className="text-destructive">*</span>
                            </span>
                            <Input
                              value={row.otherName}
                              placeholder="e.g. Locker rent, Stock audit fee"
                              onChange={(event) => update(row.id, { otherName: event.target.value })}
                              className={cn('h-10 rounded-xl', showErrors && m.name && 'border-destructive')}
                            />
                          </label>
                        )}
                        <div className="min-w-0">
                          <span className={LABEL}>
                            {fc.label('amount')} <span className="text-destructive">*</span>
                          </span>
                          <div
                            className={cn(
                              'flex items-center gap-1 rounded-xl border bg-card px-2.5 transition focus-within:border-orange-500 focus-within:ring-[3px] focus-within:ring-orange-500/15',
                              showErrors && m.charge && 'border-destructive bg-rose-50/60 dark:bg-rose-950/20',
                            )}
                          >
                            <span aria-hidden className="text-base font-extrabold text-muted-foreground">₹</span>
                            <input
                              inputMode="decimal"
                              aria-label={`Charge ${index + 1} amount`}
                              placeholder="0"
                              value={amountText(`${row.id}:charge`, row.charge)}
                              onFocus={() => setFocused(`${row.id}:charge`)}
                              onBlur={() => setFocused(null)}
                              onChange={(event) => update(row.id, { charge: parseAmountInput(event.target.value) })}
                              className="w-full min-w-0 bg-transparent py-1.5 text-right text-lg font-extrabold tabular-nums text-foreground outline-none"
                            />
                          </div>
                          {last && lastDiffers ? (
                            <button
                              type="button"
                              onClick={() =>
                                update(row.id, {
                                  charge: String(last.chargeAmount ?? ''),
                                  gstRate: last.gstRate ?? DEFAULT_GST_RATE,
                                  gstSplit: last.gstSplit === 'IGST' ? 'IGST' : 'CGST + SGST',
                                  gstTyped: null,
                                  ...(last.otherChargeAmount ? { other: String(last.otherChargeAmount), otherLabel: last.otherChargeLabel ?? '' } : {}),
                                })
                              }
                              className="mt-1 text-left text-[11.5px] font-semibold text-orange-700 hover:underline dark:text-orange-400"
                            >
                              Last time {formatInr(last.chargeAmount ?? 0)}{last.gstRate ? ` + GST ${last.gstRate}%` : ''}
                              {last.accountId !== accountId ? ` on ${nameOf(last.accountId)}` : ''} · use it
                            </button>
                          ) : (
                            <p className="mt-1 min-h-[17px] text-[11.5px] leading-snug text-muted-foreground">{rupeesInWords(f.charge)}</p>
                          )}
                        </div>
                      </div>

                      {/* GST */}
                      {show.gst ? (
                        <div className="min-w-0">
                          <span className={LABEL}>{fc.label('gst')}</span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <div role="radiogroup" aria-label={`Charge ${index + 1} GST rate`} className="flex flex-wrap gap-1.5">
                              {GST_RATES.map((rate) => (
                                <button
                                  key={rate}
                                  type="button"
                                  role="radio"
                                  aria-checked={row.gstRate === rate}
                                  onClick={() => update(row.id, { gstRate: rate, gstTyped: null })}
                                  className={cn(CHIP, row.gstRate === rate ? CHIP_ON : CHIP_OFF)}
                                >
                                  {rate}%
                                </button>
                              ))}
                            </div>
                            <div role="radiogroup" aria-label={`Charge ${index + 1} GST type`} className="flex rounded-[10px] border bg-card p-[2px]">
                              {GST_SPLITS.map((split) => (
                                <button
                                  key={split}
                                  type="button"
                                  role="radio"
                                  aria-checked={row.gstSplit === split}
                                  onClick={() => update(row.id, { gstSplit: split })}
                                  disabled={row.gstRate === 0}
                                  className={cn('rounded-lg px-2 py-1 text-[11.5px] font-semibold disabled:opacity-50', row.gstSplit === split ? CHIP_ON : 'text-muted-foreground hover:text-foreground')}
                                >
                                  {split}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <div
                              className={cn(
                                'flex min-w-0 flex-1 items-center gap-1 rounded-xl border bg-card px-2.5 transition focus-within:border-orange-500 focus-within:ring-[3px] focus-within:ring-orange-500/15',
                                f.gst < 0 && 'border-destructive',
                              )}
                            >
                              <span aria-hidden className="font-extrabold text-muted-foreground">₹</span>
                              <input
                                inputMode="decimal"
                                aria-label={`Charge ${index + 1} GST amount`}
                                placeholder="0"
                                value={gstText}
                                disabled={row.gstRate === 0 && row.gstTyped === null}
                                onChange={(event) => update(row.id, { gstTyped: parseAmountInput(event.target.value) })}
                                className="w-full min-w-0 bg-transparent py-2 text-right font-bold tabular-nums text-foreground outline-none disabled:text-muted-foreground"
                              />
                            </div>
                            {row.gstTyped !== null && round2(num(row.gstTyped)) !== f.worked && (
                              <button
                                type="button"
                                title={`Back to ${row.gstRate}% of the charge (${formatInr(f.worked)})`}
                                aria-label="Work the GST out from the rate again"
                                onClick={() => update(row.id, { gstTyped: null })}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-muted-foreground hover:text-foreground"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <p className="mt-1 min-h-[17px] text-[11.5px] leading-snug text-muted-foreground">
                            {f.gst > 0
                              ? row.gstSplit === 'IGST'
                                ? `IGST ${formatInr(f.split.igst)}`
                                : `CGST ${formatInr(f.split.cgst)} · SGST ${formatInr(f.split.sgst)}`
                              : row.gstRate === 0
                                ? 'No GST on this charge'
                                : ''}
                            {row.gstTyped !== null && round2(num(row.gstTyped)) !== f.worked && <span className="text-amber-700 dark:text-amber-400"> · as on the statement</span>}
                          </p>
                        </div>
                      ) : (
                        <div className="hidden md:block" />
                      )}

                      {/* Other levies */}
                      {show.other ? (
                        <div className="min-w-0">
                          <span className={LABEL}>
                            {fc.label('other')}
                            {need.other && <span className="text-destructive"> *</span>}
                          </span>
                          <Input
                            value={row.otherLabel}
                            placeholder="What it is (stamp duty, cess…)"
                            onChange={(event) => update(row.id, { otherLabel: event.target.value })}
                            className="h-9 rounded-xl text-[13px]"
                          />
                          <div
                            className={cn(
                              'mt-2 flex items-center gap-1 rounded-xl border bg-card px-2.5 transition focus-within:border-orange-500 focus-within:ring-[3px] focus-within:ring-orange-500/15',
                              ((showErrors && m.other) || f.other < 0) && 'border-destructive',
                            )}
                          >
                            <span aria-hidden className="font-extrabold text-muted-foreground">₹</span>
                            <input
                              inputMode="decimal"
                              aria-label={`Charge ${index + 1} other charges`}
                              placeholder="0"
                              value={amountText(`${row.id}:other`, row.other)}
                              onFocus={() => setFocused(`${row.id}:other`)}
                              onBlur={() => setFocused(null)}
                              onChange={(event) => update(row.id, { other: parseAmountInput(event.target.value) })}
                              className="w-full min-w-0 bg-transparent py-2 text-right font-bold tabular-nums text-foreground outline-none"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="hidden md:block" />
                      )}

                      {show.ref && (
                        <label className="min-w-0">
                          <span className={LABEL}>
                            {fc.label('ref')}
                            {need.ref && <span className="text-destructive"> *</span>}
                          </span>
                          <Input
                            value={row.ref}
                            placeholder="Bank reference or the UTR charged for"
                            onChange={(event) => update(row.id, { ref: event.target.value })}
                            className={cn('h-10 rounded-xl font-mono text-[13px]', showErrors && m.ref && 'border-destructive')}
                          />
                        </label>
                      )}
                      {show.note && (
                        <label className={cn('min-w-0', show.ref ? 'md:col-span-2' : 'md:col-span-3')}>
                          <span className={LABEL}>
                            {fc.label('note')}
                            {need.note && <span className="text-destructive"> *</span>}
                          </span>
                          <Input
                            value={row.note}
                            placeholder="e.g. 12 RTGS on 31 Oct, monthly consolidated"
                            onChange={(event) => update(row.id, { note: event.target.value })}
                            className={cn('h-10 rounded-xl', showErrors && m.note && 'border-destructive')}
                          />
                        </label>
                      )}
                    </div>

                    <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3.5 py-2 text-[12.5px]">
                      <span className="text-muted-foreground">
                        {formatInr(f.charge)}
                        {show.gst && f.gst > 0 ? ` + GST ${formatInr(f.gst)}` : ''}
                        {f.other > 0 ? ` + ${row.otherLabel.trim() || 'other'} ${formatInr(f.other)}` : ''}
                      </span>
                      <b className="tabular-nums text-rose-700 dark:text-rose-400">Debit {formatInr(f.total)}</b>
                    </footer>
                    {m.negative && (
                      <div className="px-3.5 pb-3">
                        <Message tone="bad">GST and other charges cannot be below zero. A reversal by the bank is a receipt.</Message>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="px-4 pb-4 pt-1 sm:px-[18px]">
              <button
                type="button"
                onClick={addRow}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-slate-300 p-3 font-bold text-muted-foreground transition hover:border-orange-300 hover:bg-orange-50 hover:text-orange-800 dark:border-slate-700 dark:hover:bg-orange-950/30 dark:hover:text-orange-300"
              >
                <Plus aria-hidden className="h-4 w-4" />
                Add another charge
                <span className="hidden font-semibold opacity-70 sm:inline">(Alt + N)</span>
              </button>
            </div>
          </section>
        </div>

        {/* ── The batch as a whole, and saving it ── */}
        <aside className="min-w-0 overflow-hidden rounded-[20px] border bg-card shadow-sm xl:sticky xl:top-20">
          <header className="px-[18px] pb-2.5 pt-4">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Total debit</p>
            <p className="text-[30px] font-extrabold leading-tight tracking-tight tabular-nums text-rose-700 dark:text-rose-400">{formatInr(totals.total)}</p>
            <p className="text-xs text-muted-foreground">{totals.total ? rupeesInWords(totals.total) : 'Enter a charge to see it in words'}</p>
          </header>

          <div className="border-t px-[18px] py-3">
            <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Breakdown</h2>
            <dl className="space-y-1 text-[12.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Charges</dt>
                <dd className="font-semibold tabular-nums text-foreground">{formatInr(totals.charge)}</dd>
              </div>
              {show.gst && (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">GST</dt>
                    <dd className="font-semibold tabular-nums text-foreground">{formatInr(totals.gst)}</dd>
                  </div>
                  {totals.cgst + totals.sgst > 0 && (
                    <div className="flex justify-between gap-3 pl-3 text-[11.5px]">
                      <dt className="text-muted-foreground">CGST · SGST</dt>
                      <dd className="tabular-nums text-muted-foreground">{formatInr(totals.cgst)} · {formatInr(totals.sgst)}</dd>
                    </div>
                  )}
                  {totals.igst > 0 && (
                    <div className="flex justify-between gap-3 pl-3 text-[11.5px]">
                      <dt className="text-muted-foreground">IGST</dt>
                      <dd className="tabular-nums text-muted-foreground">{formatInr(totals.igst)}</dd>
                    </div>
                  )}
                </>
              )}
              {show.other && totals.other > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Other charges</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{formatInr(totals.other)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 border-t pt-1.5 font-extrabold">
                <dt className="text-foreground">Debited</dt>
                <dd className="tabular-nums text-foreground">{formatInr(totals.total)}</dd>
              </div>
            </dl>
          </div>

          <div className="border-t px-[18px] py-3">
            <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Effect on account</h2>
            {account && figure !== null && after !== null ? (
              <>
                <div className="flex items-center gap-2.5">
                  <Tile colours={colourOf(account.id)} size={28} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[12.5px] text-foreground">{accountLabel(account)}</b>
                    <span className="block text-[11.5px] text-muted-foreground">
                      {cc ? 'Drawn' : 'Balance'} {formatInr(figure, 0)} → {formatInr(after, 0)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[12.5px] font-extrabold tabular-nums text-rose-700 dark:text-rose-400">
                    −{compactInr(totals.total)}
                    <span className="block text-[11px] font-semibold text-muted-foreground">{cc ? 'drawn more' : 'debited'}</span>
                  </span>
                </div>
                {overdrawn && (
                  <Message tone="warn">
                    {cc
                      ? `This takes ${accountLabel(account)} ${formatInr(after - limit, 0)} past its limit of ${formatInr(limit, 0)}.`
                      : `This takes ${accountLabel(account)} ${formatInr(-after, 0)} below zero.`}{' '}
                    The bank has already debited it, so it is recorded anyway — check the balance.
                  </Message>
                )}
              </>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">Choose the account in step 1.</p>
            )}
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Listed on Payments under <b className="text-foreground">{BANK_CHARGES_METHOD}</b>, and counted in every balance and report from {format(date, 'd MMM')}.
            </p>
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
            {dateCheck && !dateCheck.ok && dateCheck.reason && <Message tone="bad">{dateCheck.reason}</Message>}
            {beforeOpening && openingDay && account && (
              <Message tone="bad">{accountLabel(account)} opened {formatDay(openingDay)}; a charge dated earlier would not count toward its balance.</Message>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t px-[18px] pb-[18px] pt-3.5">
            <Button
              onClick={() => void save('save')}
              disabled={saving !== null || !ready}
              className="h-11 gap-2 border-0 bg-gradient-to-r from-orange-600 via-rose-600 to-violet-600 text-white shadow-md hover:opacity-95"
            >
              {saving === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save {rows.length > 1 ? `${rows.length} charges` : 'charge'}
              <span className="ml-1 hidden rounded border border-white/50 px-1 text-[10.5px] font-semibold opacity-85 sm:inline">Ctrl ↵</span>
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => void save('new')} disabled={saving !== null || !ready}>
                {saving === 'new' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Save &amp; new
              </Button>
              <Button variant="outline" className="flex-1" onClick={saveDraft} disabled={saving !== null || !rows.some(hasContent)}>
                Save draft
              </Button>
            </div>
            <p className="text-center text-[11.5px] text-muted-foreground">{controls.hintFor(touched) ?? 'Dates follow Date Control and Month Closure.'}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
