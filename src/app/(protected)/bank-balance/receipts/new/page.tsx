'use client';
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format, startOfDay } from 'date-fns';
import {
  ArrowLeft, ArrowUp, Check, ChevronDown, Copy, ExternalLink, History, Info, Link2, Loader2, Plus, Save, Search, Trash2, X,
} from 'lucide-react';
import { collection, doc, getDocs, runTransaction, Timestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import heroStyles from '@/components/bank-balance/dashboard-designs/aurora.module.css';
import { BANK_PAGE, BankAccessDenied, BankPageSkeleton, accountLabel } from '@/components/bank-balance/page-kit';
import { AccountPicker, Message, TILE_COLOURS, Tile, tileColours } from '@/components/bank-balance/account-picker';
import { useEntryControls } from '@/components/bank-balance/controls/use-entry-controls';
import { useBBFieldControl } from '@/components/bank-balance/controls/use-field-control';
import { BtApiError, btFetch } from '@/components/bill-tracking/bt-client';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { balanceAt, buildLedger, compactInr, dayKey, formatDay, formatInr, isCashCredit, parseDay, txnDate } from '@/lib/bank-balance-ledger';
import { parseAmountInput, rupeesInWords } from '@/lib/bank-balance-transfer';
import {
  RECEIPT_MODES,
  RECEIPT_TYPES,
  billTracked,
  duplicateRefs,
  initials,
  isInstrumentMode,
  nameHash,
  normRef,
  payerOf,
  receiptDescription,
  refLabelFor,
  type ReceiptMode,
  type ReceiptType,
} from '@/lib/bank-balance-receipts';
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Row {
  id: string;
  type: ReceiptType;
  payer: string;
  /** Set when the payer was picked from the client list; empty for a typed name. */
  payerClientId: string;
  mode: ReceiptMode;
  ref: string;
  description: string;
  /** As typed: digits and a decimal point. */
  amount: string;
}

interface ClientOption {
  id: string;
  name: string;
}

/** What Bill Tracking's open-bills endpoint returns that this page shows. */
interface OpenBill {
  id: string;
  transactionType?: string;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  billDate?: string;
  projectNameSnapshot?: string;
  outstandingAmount: number;
  isRetentionBill?: boolean;
}
type BillsState = { status: 'ok'; bills: OpenBill[] } | { status: 'denied' } | { status: 'error' };

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const newRow = (patch: Partial<Row> = {}): Row => ({
  id: makeId(), type: 'Client bill', payer: '', payerClientId: '', mode: 'RTGS', ref: '', description: '', amount: '', ...patch,
});
const amountOf = (row: Row) => {
  const value = Number(row.amount);
  return Number.isFinite(value) ? value : 0;
};
const hasContent = (row: Row) => Boolean(row.payer || row.ref || row.description || row.amount);

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

const payerColours = (name: string) => TILE_COLOURS[nameHash(name, TILE_COLOURS.length)];

/** Where a client-bill receipt is recorded: Bill Tracking's receipt form, opened on the bill when there is one. */
const billTrackingHref = (billId?: string) => `/bill-tracking/collections/new${billId ? `?bill=${encodeURIComponent(billId)}` : ''}`;

// The unsent form, kept in this browser by "Save draft".
const DRAFT_KEY = 'bankBalance.receiptDraft';
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

/**
 * Received from: a client from the client list, someone who has paid before, or any name typed in.
 * Picking a client keeps its id, which is what finds its open bills in Bill Tracking.
 */
function PayerPicker({
  label,
  required,
  value,
  clients,
  earlier,
  onChange,
  invalid,
}: {
  label: string;
  required: boolean;
  value: { payer: string; clientId: string };
  /** `null` when the client list could not be read. */
  clients: ClientOption[] | null;
  earlier: string[];
  onChange: (payer: string, clientId: string) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const clientMatches = (clients ?? []).filter((c) => !needle || c.name.toLowerCase().includes(needle)).slice(0, 40);
  const clientNames = new Set((clients ?? []).map((c) => c.name.toLowerCase()));
  const earlierMatches = earlier.filter((name) => !clientNames.has(name.toLowerCase()) && (!needle || name.toLowerCase().includes(needle))).slice(0, 20);
  const typed = search.trim();
  const exact = typed && [...(clients ?? []).map((c) => c.name), ...earlier].some((name) => name.toLowerCase() === typed.toLowerCase());
  const choose = (payer: string, clientId: string) => {
    onChange(payer, clientId);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="min-w-0">
      <span className={LABEL}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex min-h-[40px] w-full items-center gap-2 rounded-xl border bg-card py-1 pl-1 pr-2.5 text-left transition hover:border-emerald-300',
              open && 'border-emerald-600 ring-[3px] ring-emerald-600/15',
              invalid && !open && 'border-destructive bg-rose-50/60 dark:bg-rose-950/20',
            )}
          >
            {value.payer ? (
              <>
                <Tile colours={payerColours(value.payer)} size={28}>
                  <span className="text-[10px] font-extrabold">{initials(value.payer)}</span>
                </Tile>
                <b className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={value.payer}>{value.payer}</b>
              </>
            ) : (
              <span className="flex-1 pl-2 text-sm text-muted-foreground">Choose payer</span>
            )}
            <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-1.5">
          <label className="relative mb-1 block">
            <span className="sr-only">Search or type a payer</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typed) {
                  e.preventDefault();
                  const client = (clients ?? []).find((c) => c.name.toLowerCase() === typed.toLowerCase());
                  choose(client?.name ?? typed, client?.id ?? '');
                }
              }}
              placeholder="Search clients, or type a name…"
              className="h-9 pl-8"
            />
          </label>
          <div className="max-h-72 overflow-y-auto">
            {typed && !exact && (
              <button type="button" onClick={() => choose(typed, '')} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted">
                <span aria-hidden className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="min-w-0 text-[13px]">
                  Use <b className="text-foreground">“{typed}”</b>
                </span>
              </button>
            )}
            {clientMatches.length > 0 && (
              <>
                <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">Clients</p>
                {clientMatches.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => choose(client.name, client.id)}
                    className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted', value.clientId === client.id && 'bg-muted')}
                  >
                    <Tile colours={payerColours(client.name)} size={30}>
                      <span className="text-[10.5px] font-extrabold">{initials(client.name)}</span>
                    </Tile>
                    <b className="min-w-0 flex-1 truncate text-[13px] text-foreground">{client.name}</b>
                    {value.clientId === client.id && <Check aria-hidden className="h-4 w-4 text-emerald-600" />}
                  </button>
                ))}
              </>
            )}
            {earlierMatches.length > 0 && (
              <>
                <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">Paid before</p>
                {earlierMatches.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => choose(name, '')}
                    className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted', !value.clientId && value.payer === name && 'bg-muted')}
                  >
                    <Tile colours={payerColours(name)} size={30}>
                      <span className="text-[10.5px] font-extrabold">{initials(name)}</span>
                    </Tile>
                    <b className="min-w-0 flex-1 truncate text-[13px] text-foreground">{name}</b>
                  </button>
                ))}
              </>
            )}
            {!typed && clientMatches.length === 0 && earlierMatches.length === 0 && (
              <p className="px-2.5 py-4 text-sm text-muted-foreground">{clients === null ? 'Type the payer’s name.' : 'No clients yet — type the payer’s name.'}</p>
            )}
            {clients === null && <p className="px-2.5 pb-1.5 pt-1 text-[11.5px] text-muted-foreground">The client list isn’t open to you, so names are typed in.</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Against bill: never a link this page writes. A client's open bills come from Bill Tracking, and
 * each opens Bill Tracking's receipt form on that bill — which marks it collected and posts the credit
 * here when verified.
 */
function BillBox({ row, state }: { row: Row; state: BillsState | undefined }) {
  if (!row.payer.trim()) {
    return <div className="flex min-h-[40px] items-center rounded-xl border bg-card px-3 text-[13px] text-muted-foreground">Pick the payer first</div>;
  }
  if (!row.payerClientId) {
    return (
      <a
        href={billTrackingHref()}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-[40px] items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-3 text-[12.5px] font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
      >
        <Link2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">Record in Bill Tracking</span>
        <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0" />
      </a>
    );
  }
  if (!state) {
    return (
      <div className="flex min-h-[40px] items-center gap-2 rounded-xl border bg-card px-3 text-[13px] text-muted-foreground">
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        Looking up open bills…
      </div>
    );
  }
  if (state.status !== 'ok') {
    return (
      <a
        href={billTrackingHref()}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-[40px] items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-3 text-[12.5px] font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
        title={state.status === 'denied' ? 'Your Bill Tracking access does not include recording receipts' : 'Bill Tracking could not be reached'}
      >
        <Link2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{state.status === 'denied' ? 'Open bills are in Bill Tracking' : 'Bill Tracking didn’t answer — open it'}</span>
        <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0" />
      </a>
    );
  }
  const bills = state.bills;
  const due = bills.reduce((sum, bill) => sum + bill.outstandingAmount, 0);
  if (!bills.length) {
    return <div className="flex min-h-[40px] items-center rounded-xl border bg-card px-3 text-[13px] text-muted-foreground">No open bills for {row.payer}</div>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-[40px] w-full items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-3 text-left text-[12.5px] font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
        >
          <Link2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {bills.length} open bill{bills.length === 1 ? '' : 's'} · {compactInr(due)} due
          </span>
          <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-1.5">
        <p className="px-2.5 pb-1.5 pt-1.5 text-[11.5px] leading-snug text-muted-foreground">
          Bill Tracking records the payment against the bill, marks it collected and posts the credit here when it is verified. Record it there — not here as well.
        </p>
        <div className="max-h-72 overflow-y-auto">
          {bills.map((bill) => (
            <a
              key={bill.id}
              href={billTrackingHref(bill.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-muted"
            >
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[13px] text-foreground">
                  {bill.gstInvoiceNumber || bill.billSerialNumber || 'Bill'}
                  {bill.isRetentionBill && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Retention</span>}
                </b>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {[bill.projectNameSnapshot, bill.billDate ? formatDay(bill.billDate) : ''].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs font-bold tabular-nums text-foreground">
                {formatInr(bill.outstandingAmount, 0)}
                <span className="block text-[11px] font-semibold text-muted-foreground">due</span>
              </span>
              <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * New Receipt: one or more receipts into one bank account on one date, one card per receipt.
 *
 * Each card writes one `bankExpenses` Credit, all in one transaction: the description as every
 * statement shows it ("<payer> — <description>"), plus the receipt's type, payer, mode and UTR or
 * cheque number for the Receipts register. Every check the form always made still runs: the
 * account's opening date, Date Control's window and Month Closure.
 *
 * It never marks a client bill collected. Bill Tracking does that from its own receipts, and posts
 * their Credit here; this form shows the client's open bills and sends the user there.
 */
export default function NewReceiptPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  // A form that writes receipts is gated on Add, not View.
  const canAdd = !authLoading && can('Add', 'Bank Balance.Receipts');
  const canViewList = can('View', 'Bank Balance.Receipts');

  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  const [accountId, setAccountId] = useState('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankExpense[]>([]);
  const [clients, setClients] = useState<ClientOption[] | null>([]);
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [focusedAmount, setFocusedAmount] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState<'save' | 'new' | null>(null);
  const savingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  // This page renders in the browser only once data is in (the server sends the skeleton), so
  // reading storage on the first render cannot disagree with server markup.
  const [draft, setDraft] = useState<Draft | null>(() => (typeof window === 'undefined' ? null : readDraft()));
  const [bills, setBills] = useState<Record<string, BillsState>>({});
  const requestedBills = useRef(new Set<string>());

  // Field Control (labels, which fields show and which are required), Date Control's window and
  // the Month Closure calendar — the same for every user.
  const fc = useBBFieldControl('receipt');
  const nameOf = (id: string) => accountLabel(bankAccounts.find((account) => account.id === id));
  const controls = useEntryControls('receipt', nameOf);
  const show = {
    type: fc.field('receiptType').visible,
    payer: fc.field('payer').visible,
    mode: fc.field('mode').visible,
    ref: fc.field('ref').visible,
    description: fc.field('description').visible,
  };
  const need = {
    payer: show.payer && fc.field('payer').required,
    ref: show.ref && fc.field('ref').required,
    description: show.description && fc.field('description').required,
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
        console.error('Error loading receipt data:', error);
        if (!cancelled) toast({ title: 'Error', description: 'Failed to load the bank accounts.', variant: 'destructive' });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, canAdd, toast, reloadKey]);

  // The client list, for "Received from". Not everyone may read it; names can always be typed.
  useEffect(() => {
    if (authLoading || !canAdd) return;
    let cancelled = false;
    getDocs(collection(db, 'clients'))
      .then((snap) => {
        if (cancelled) return;
        setClients(
          snap.docs
            .map((d) => ({ id: d.id, name: String(d.data().name ?? '').trim(), status: String(d.data().status ?? 'Active') }))
            .filter((c) => c.name && c.status !== 'Inactive')
            .map(({ id, name }) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch((error) => {
        console.warn('Client list not readable here; payers are typed in.', error);
        if (!cancelled) setClients(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, canAdd]);

  // Leaving with typed-in receipts loses them; ask first.
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
  const addRow = useCallback(() => setRows((prev) => [...prev, newRow({ type: prev[prev.length - 1]?.type, mode: prev[prev.length - 1]?.mode })]), []);
  const removeRow = (id: string) => setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  const duplicateRow = (id: string) =>
    setRows((prev) => {
      const index = prev.findIndex((row) => row.id === id);
      if (index < 0) return prev;
      // A copy is a second receipt from the same payer: its UTR is its own.
      const copy = { ...prev[index], id: makeId(), ref: '' };
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
    });

  // ── Figures on the chosen date ──
  const dateKey = dayKey(date);
  const available = useMemo(() => {
    const day = parseDay(dateKey) ?? new Date();
    const map = new Map<string, number>();
    for (const a of activeAccounts) map.set(a.id, availableOn(a, transactions, day));
    return map;
  }, [activeAccounts, transactions, dateKey]);
  const availableOf = (id: string) => available.get(id) ?? 0;
  const colourOf = (id: string) => tileColours(activeAccounts.findIndex((a) => a.id === id));
  const total = rows.reduce((sum, row) => sum + amountOf(row), 0);
  // The account's own figure that day: a current account's balance, or what a Cash Credit has drawn.
  const figure = useMemo(() => {
    if (!account) return null;
    const day = parseDay(dateKey) ?? new Date();
    return balanceAt(buildLedger(account, transactions.filter((t) => t.accountId === account.id)), day);
  }, [account, transactions, dateKey]);

  // Every receipt already on record, for "used recently", earlier payers and a UTR seen before.
  const credits = useMemo(
    () =>
      transactions
        .filter((t) => t.type === 'Credit' && !t.isContra)
        .map((t) => ({ entry: t, at: safeDate(t) }))
        .filter((t): t is { entry: BankExpense; at: Date } => t.at !== null)
        .sort((a, b) => b.at.getTime() - a.at.getTime()),
    [transactions],
  );
  const recentAccounts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const { entry } of credits) seen.set(entry.accountId, (seen.get(entry.accountId) ?? 0) + 1);
    const order: string[] = [];
    for (const { entry } of credits) if (!order.includes(entry.accountId) && activeAccounts.some((a) => a.id === entry.accountId)) order.push(entry.accountId);
    return order.slice(0, 3).map((id) => ({ id, count: seen.get(id) ?? 0 }));
  }, [credits, activeAccounts]);
  const earlierPayers = useMemo(() => {
    const names = new Map<string, string>();
    for (const { entry } of credits) {
      const name = payerOf(entry);
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
    return [...names.values()].slice(0, 200);
  }, [credits]);
  const knownRefs = useMemo(() => {
    const map = new Map<string, { entry: BankExpense; at: Date }>();
    for (const item of credits) {
      const key = normRef(item.entry.utrNumber || item.entry.paymentRefNo);
      if (key && !map.has(key)) map.set(key, item);
    }
    return map;
  }, [credits]);

  // Open bills for each client picked on a client-bill row — fetched once per client.
  const billRow = (row: Row) => show.type && billTracked(row.type);
  const wantedClients = [...new Set(rows.filter((row) => billRow(row) && row.payerClientId).map((row) => row.payerClientId))].sort().join(',');
  useEffect(() => {
    for (const id of wantedClients ? wantedClients.split(',') : []) {
      if (requestedBills.current.has(id)) continue;
      requestedBills.current.add(id);
      btFetch<{ bills: OpenBill[] }>(`bills/open?client=${encodeURIComponent(id)}`)
        .then((data) => {
          const open = (data.bills ?? []).filter((bill) => bill.outstandingAmount > 0.5 && bill.transactionType !== 'credit_note' && bill.transactionType !== 'debit_note');
          setBills((prev) => ({ ...prev, [id]: { status: 'ok', bills: open } }));
        })
        .catch((error) => {
          const denied = error instanceof BtApiError && (error.status === 401 || error.status === 403);
          setBills((prev) => ({ ...prev, [id]: { status: denied ? 'denied' : 'error' } }));
        });
    }
  }, [wantedClients]);

  // ── Checks ──
  const openingDay = account ? parseDay(account.openingDate) : null;
  const beforeOpening = Boolean(openingDay && date < openingDay);
  const dateLabel = fc.label('date');
  const touched = accountId ? [accountId] : [];
  const dateWindow = controls.windowFor(touched);
  const dateCheck = !controls.loading ? controls.check(dateKey, touched, { label: dateLabel }) : null;
  const dupes = show.ref ? duplicateRefs(rows) : new Set<string>();
  const rowMissing = (row: Row) => ({
    payer: need.payer && !row.payer.trim(),
    amount: !(amountOf(row) > 0),
    ref: need.ref && !row.ref.trim(),
    description: need.description && !row.description.trim(),
  });
  const descriptionLabel = fc.label('description');
  const checks = [
    { ok: Boolean(account), text: 'Bank account selected' },
    ...(need.payer ? [{ ok: rows.every((row) => row.payer.trim()), text: 'Every receipt has a payer' }] : []),
    { ok: rows.every((row) => amountOf(row) > 0), text: 'Every receipt has an amount' },
    ...(need.description ? [{ ok: rows.every((row) => row.description.trim()), text: `Every receipt has a ${descriptionLabel.toLowerCase()}` }] : []),
    ...(need.ref ? [{ ok: rows.every((row) => row.ref.trim()), text: 'Every receipt has its UTR or number' }] : []),
    ...(show.ref ? [{ ok: dupes.size === 0, text: 'No UTR typed twice' }] : []),
    { ok: !beforeOpening, text: 'The account was open on this date' },
    { ok: dateCheck?.ok ?? false, text: 'The date is allowed (Date Control, Month Closure)' },
  ];
  const ready = checks.every((check) => check.ok) && activeAccounts.length > 0;
  const billRows = rows.filter((row) => billRow(row) && hasContent(row));

  const save = async (then: 'save' | 'new') => {
    if (savingRef.current) return;
    if (!canAdd) {
      toast({ title: 'Not allowed', description: 'You do not have permission to add receipts.', variant: 'destructive' });
      return;
    }
    setShowErrors(true);
    if (!account) {
      toast({ title: 'Check the receipt', description: 'Choose the bank account the money came into.', variant: 'destructive' });
      return;
    }
    const firstBad = rows.findIndex((row) => Object.values(rowMissing(row)).some(Boolean));
    if (firstBad >= 0) {
      const missing = rowMissing(rows[firstBad]);
      toast({
        title: `Receipt ${firstBad + 1} is incomplete`,
        description: missing.payer
          ? `${fc.label('payer')} is required.`
          : missing.amount
            ? 'Enter an amount above zero.'
            : missing.ref
              ? `${fc.label('ref', refLabelFor(rows[firstBad].mode))} is required.`
              : `${descriptionLabel} is required.`,
        variant: 'destructive',
      });
      return;
    }
    if (dupes.size) {
      toast({ title: 'The same UTR twice', description: 'Two receipts in this batch carry the same UTR or number — one of them is probably a repeat.', variant: 'destructive' });
      return;
    }
    // A receipt dated before the account opened is already inside its opening figure: the engine
    // would ignore it and no balance would move. New Payment and New Transfer refuse this too.
    if (beforeOpening && openingDay) {
      toast({
        title: 'Date before the account opened',
        description: `${accountLabel(account)} opened ${formatDay(openingDay)}. Receipts dated earlier would not count toward its balance.`,
        variant: 'destructive',
      });
      return;
    }
    // Date Control's window and the closed months, checked at the moment of saving. No role lifts
    // either: the window is widened, or the month reopened, in Settings.
    const allowed = controls.check(dateKey, [accountId], { label: dateLabel });
    if (!allowed.ok) {
      toast({ title: 'Date not allowed', description: allowed.reason, variant: 'destructive' });
      return;
    }

    savingRef.current = true;
    setSaving(then);
    // Ids fixed up front, so the activity log can name the documents written.
    const planned = rows.map((row) => ({ row, ref: doc(collection(db, 'bankExpenses')) }));
    try {
      await runTransaction(db, async (tx) => {
        for (const { row, ref } of planned) {
          const payer = show.payer ? row.payer.trim() : '';
          const description = show.description ? row.description.trim() : '';
          const instrument = show.ref ? row.ref.trim() : '';
          // No undefined values: the SDK refuses a document carrying one.
          tx.set(ref, {
            date: Timestamp.fromDate(date),
            accountId,
            description: receiptDescription(payer, description),
            amount: Math.round(amountOf(row) * 100) / 100,
            type: 'Credit',
            isContra: false,
            createdAt: Timestamp.now(),
            ...(show.type ? { receiptType: row.type } : {}),
            ...(payer ? { payerName: payer } : {}),
            ...(payer && row.payerClientId ? { payerClientId: row.payerClientId } : {}),
            ...(show.mode ? { paymentMethod: row.mode } : {}),
            ...(instrument ? (isInstrumentMode(row.mode) ? { paymentRefNo: instrument } : { utrNumber: instrument }) : {}),
          });
        }
      });
      toast({
        title: 'Saved',
        description: `${rows.length} receipt${rows.length === 1 ? '' : 's'} of ${formatInr(total)} into ${accountLabel(account)} saved.`,
      });
      void log(
        'Add Receipts',
        {
          count: planned.length,
          total,
          accountId,
          account: accountLabel(account),
          date: dateKey,
          receipts: planned.map(({ row, ref }) => ({
            id: ref.id,
            ...(show.payer ? { payer: row.payer.trim() } : {}),
            ...(show.type ? { type: row.type } : {}),
            description: show.description ? row.description.trim() : '',
            amount: amountOf(row),
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
        router.push('/bank-balance/receipts');
        return;
      }
      // Keep the date and account: the next batch is usually for the same day and bank.
      setRows([newRow()]);
      setReloadKey((k) => k + 1);
    } catch (error) {
      console.error('Error saving receipts:', error);
      toast({ title: 'Save failed', description: 'Nothing was saved. Please try again.', variant: 'destructive' });
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };

  const saveDraft = () => {
    writeDraft({ date: dateKey, accountId, rows, savedAt: new Date().toISOString() });
    toast({ title: 'Draft saved', description: 'Kept in this browser. It comes back the next time you open New Receipt here.' });
  };

  // Alt+N adds a receipt; Ctrl+Enter saves. Read through refs, so the listener stays one.
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
    return <BankAccessDenied title="New Receipt" backHref="/bank-balance/receipts" backLabel="Back to receipts" what="the receipt entry form" />;
  }

  const restoreDraft = () => {
    if (!draft) return;
    setRows(draft.rows.map((row) => ({ ...newRow(), ...row, id: makeId() })));
    if (activeAccounts.some((a) => a.id === draft.accountId)) setAccountId(draft.accountId);
    const day = parseDay(draft.date);
    if (day) setDate(day);
    writeDraft(null);
    setDraft(null);
  };
  const discardDraft = () => {
    writeDraft(null);
    setDraft(null);
  };

  const cc = account ? isCashCredit(account) : false;
  const after = figure === null ? null : cc ? figure - total : figure + total;
  const windowHint = controls.hintFor(touched);

  return (
    <div className={cn(BANK_PAGE, 'pb-10')}>
      {/* Where this is, and the way back. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
        <Link href="/bank-balance/receipts" aria-label="Back to receipts" className="mr-1 flex h-[30px] w-[30px] items-center justify-center rounded-lg border bg-card hover:bg-muted">
          <ArrowLeft className="h-[15px] w-[15px]" />
        </Link>
        <Link href="/bank-balance" className="hover:text-foreground">Bank Balance</Link>
        <span aria-hidden>›</span>
        <Link href="/bank-balance/receipts" className="hover:text-foreground">Receipts</Link>
        <span aria-hidden>›</span>
        <span className="text-foreground">New receipt</span>
      </nav>

      {/* ── The banner: what this is, the date, and the batch so far ── */}
      <section className={cn(heroStyles.hero, 'keep-light flex flex-wrap items-center gap-4 p-5 sm:p-6')} data-tint="aurora">
        <span aria-hidden className={cn(heroStyles.glass, 'flex h-14 w-14 items-center justify-center rounded-2xl')}>
          <ArrowUp className="h-7 w-7 text-white" />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <h1 className="text-2xl font-extrabold tracking-tight">New receipt</h1>
          <p className={heroStyles.muted}>Record one or more receipts into a bank account on the same date, one card per receipt.</p>
        </div>
        <label className={cn(heroStyles.glass, 'relative flex min-w-[130px] flex-1 cursor-pointer flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
          <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>{dateLabel} ✎</span>
          <b className="text-xl font-extrabold tracking-tight">{format(date, 'd MMM yyyy')}</b>
          <input
            type="date"
            aria-label={dateLabel}
            value={dateKey}
            min={dateWindow.min ?? undefined}
            max={dateWindow.max ?? undefined}
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
          <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>Receipts</span>
          <b className="text-xl font-extrabold tabular-nums">{rows.length}</b>
        </div>
        <div className={cn(heroStyles.glass, 'flex min-w-[120px] flex-1 flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
          <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>Total</span>
          <b className="text-xl font-extrabold tabular-nums">{compactInr(total)}</b>
        </div>
        {canViewList && (
          <Link href="/bank-balance/receipts" className={heroStyles.action}>
            <History aria-hidden className="h-4 w-4" />
            Receipts
          </Link>
        )}
      </section>

      {draft && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-100">
          <Info aria-hidden className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            A draft of {draft.rows.length} receipt{draft.rows.length === 1 ? '' : 's'} from {format(new Date(draft.savedAt), 'd MMM, HH:mm')} is saved in this browser.
          </span>
          <Button size="sm" variant="outline" onClick={restoreDraft}>Restore</Button>
          <Button size="sm" variant="ghost" onClick={discardDraft}>Discard</Button>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_370px]">
        <div className="min-w-0 space-y-3.5">
          {/* ── Step 1: into account ── */}
          <section className="rounded-[20px] border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3.5 sm:px-[18px]">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal-700 to-blue-600 text-[12.5px] font-extrabold text-white">1</span>
              <div className="min-w-0">
                <b className="block text-[15px] leading-tight text-foreground">Into account</b>
                <p className="text-xs text-muted-foreground">The bank account the money landed in</p>
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
                effectOf={(id) => (id === accountId ? total : 0)}
                colourOf={colourOf}
                invalid={showErrors && !account}
              />
              {recentAccounts.length > 0 && (
                <div className="min-w-0">
                  <span className={LABEL}>Used recently</span>
                  <div className="flex flex-col gap-1.5">
                    {recentAccounts.map(({ id, count }) => {
                      const a = activeAccounts.find((x) => x.id === id);
                      if (!a) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setAccountId(id)}
                          className={cn(
                            'flex items-center gap-2 rounded-xl border bg-card px-2.5 py-1.5 text-left text-[12.5px] font-semibold transition hover:border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30',
                            id === accountId && 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
                          )}
                        >
                          <Tile colours={colourOf(id)} size={24} />
                          <span className="min-w-0 flex-1 truncate text-foreground">{accountLabel(a)}</span>
                          <span className="shrink-0 text-[11.5px] text-muted-foreground">{count} receipt{count === 1 ? '' : 's'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── Step 2: the receipts ── */}
          <section className="rounded-[20px] border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3.5 sm:px-[18px]">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal-700 to-blue-600 text-[12.5px] font-extrabold text-white">2</span>
              <div className="min-w-0 flex-1 basis-60">
                <b className="block text-[15px] leading-tight text-foreground">Receipts</b>
                <p className="text-xs text-muted-foreground">Who paid, what for, and how much.</p>
              </div>
            </header>
            <div className="space-y-3 px-4 pb-2 pt-4 sm:px-[18px]">
              {rows.map((row, index) => {
                const missing = rowMissing(row);
                const amount = amountOf(row);
                const refKey = normRef(row.ref);
                const seen = refKey ? knownRefs.get(refKey) : undefined;
                const twice = Boolean(refKey && dupes.has(refKey));
                const bad = twice || (showErrors && Object.values(missing).some(Boolean));
                const refLabel = fc.label('ref', refLabelFor(row.mode));
                const amountText = focusedAmount === row.id || !row.amount ? row.amount : Number(row.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
                return (
                  <article key={row.id} className={cn('rounded-[18px] border transition-colors', bad && 'border-rose-200 dark:border-rose-900/60')}>
                    <header className="flex flex-wrap items-center gap-2.5 border-b px-3.5 py-2.5">
                      <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 text-[11.5px] font-extrabold text-white">
                        {index + 1}
                      </span>
                      {show.type ? (
                        <div role="radiogroup" aria-label={`Receipt ${index + 1} ${fc.label('receiptType').toLowerCase()}`} className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                          {RECEIPT_TYPES.map((type) => (
                            <button
                              key={type}
                              type="button"
                              role="radio"
                              aria-checked={row.type === type}
                              onClick={() => update(row.id, { type })}
                              className={cn(
                                'rounded-full border px-2.5 py-0.5 text-xs font-bold',
                                row.type === type
                                  ? 'border-emerald-800 bg-emerald-800 text-white dark:border-emerald-600 dark:bg-emerald-700'
                                  : 'bg-card text-muted-foreground hover:text-foreground',
                              )}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <b className="min-w-0 flex-1 text-sm text-foreground">Receipt {index + 1}</b>
                      )}
                      <div className="ml-auto flex shrink-0 gap-1.5">
                      <Button type="button" variant="outline" size="icon" className="h-[30px] w-[30px]" title="Duplicate" aria-label={`Duplicate receipt ${index + 1}`} onClick={() => duplicateRow(row.id)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      {rows.length > 1 && (
                        <Button
                          type="button" variant="outline" size="icon" className="h-[30px] w-[30px] hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                          title="Remove" aria-label={`Remove receipt ${index + 1}`} onClick={() => removeRow(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      </div>
                    </header>

                    <div className="grid grid-cols-1 gap-3 p-3.5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.95fr)]">
                      {show.payer && (
                        <div className="min-w-0">
                          <PayerPicker
                            label={fc.label('payer')}
                            required={need.payer}
                            value={{ payer: row.payer, clientId: row.payerClientId }}
                            clients={clients}
                            earlier={earlierPayers}
                            onChange={(payer, payerClientId) => update(row.id, { payer, payerClientId })}
                            invalid={showErrors && missing.payer}
                          />
                          <p className="mt-1 min-h-[17px] truncate text-[11.5px] text-muted-foreground">
                            {row.payerClientId ? 'From the client list' : row.payer ? 'Typed name' : ''}
                          </p>
                        </div>
                      )}

                      <div className="min-w-0">
                        <span className={LABEL}>Against bill</span>
                        {billRow(row) ? (
                          <BillBox row={row} state={row.payerClientId ? bills[row.payerClientId] : undefined} />
                        ) : (
                          <div className="flex min-h-[40px] items-center rounded-xl border bg-card px-3 text-[13px] text-muted-foreground">Not linked to a bill</div>
                        )}
                        <p className="mt-1 min-h-[17px] text-[11.5px] text-muted-foreground">{billRow(row) ? 'Bill Tracking marks bills collected' : ''}</p>
                      </div>

                      <div className="min-w-0">
                        <span className={LABEL}>
                          {fc.label('amount')} <span className="text-destructive">*</span>
                        </span>
                        <div
                          className={cn(
                            'flex items-center gap-1 rounded-xl border bg-card px-2.5 transition focus-within:border-emerald-600 focus-within:ring-[3px] focus-within:ring-emerald-600/15',
                            showErrors && missing.amount && 'border-destructive bg-rose-50/60 dark:bg-rose-950/20',
                          )}
                        >
                          <span aria-hidden className="text-base font-extrabold text-muted-foreground">₹</span>
                          <input
                            inputMode="decimal"
                            aria-label={`Receipt ${index + 1} amount`}
                            placeholder="0"
                            value={amountText}
                            onFocus={() => setFocusedAmount(row.id)}
                            onBlur={() => setFocusedAmount(null)}
                            onChange={(event) => update(row.id, { amount: parseAmountInput(event.target.value) })}
                            className="w-full min-w-0 bg-transparent py-1.5 text-right text-lg font-extrabold tabular-nums text-foreground outline-none"
                          />
                        </div>
                        <p className="mt-1 min-h-[17px] text-[11.5px] leading-snug text-muted-foreground">{rupeesInWords(amount)}</p>
                      </div>

                      {show.mode && (
                        <div className="min-w-0">
                          <span className={LABEL}>{fc.label('mode')}</span>
                          <div role="radiogroup" aria-label={`Receipt ${index + 1} mode`} className="flex flex-wrap gap-1.5">
                            {RECEIPT_MODES.map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                role="radio"
                                aria-checked={row.mode === mode}
                                onClick={() => update(row.id, { mode })}
                                className={cn(
                                  'rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold',
                                  row.mode === mode ? 'border-foreground bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground',
                                )}
                              >
                                {mode}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {show.ref && (
                        <label className="min-w-0">
                          <span className={LABEL}>
                            {refLabel}
                            {need.ref && <span className="text-destructive"> *</span>}
                          </span>
                          <Input
                            value={row.ref}
                            placeholder={row.mode === 'Cheque' ? '000123' : row.mode === 'DD' ? 'DD number' : 'e.g. SBIN26110200841'}
                            onChange={(event) => update(row.id, { ref: event.target.value })}
                            className={cn('h-10 rounded-xl font-mono text-[13px]', (twice || (showErrors && missing.ref)) && 'border-destructive')}
                          />
                        </label>
                      )}

                      {show.description && (
                        <label className={cn('min-w-0', !show.mode && !show.ref && 'md:col-span-3')}>
                          <span className={LABEL}>
                            {descriptionLabel}
                            {need.description && <span className="text-destructive"> *</span>}
                          </span>
                          <Input
                            value={row.description}
                            placeholder="e.g. RA bill 14 · Lapanga GSS"
                            onChange={(event) => update(row.id, { description: event.target.value })}
                            className={cn('h-10 rounded-xl', showErrors && missing.description && 'border-destructive')}
                          />
                        </label>
                      )}
                    </div>

                    {(twice || seen) && (
                      <div className="px-3.5 pb-3">
                        {twice && <Message tone="bad">The same {refLabel} appears twice in this batch.</Message>}
                        {!twice && seen && (
                          <Message tone="warn">
                            {refLabel} {row.ref.trim()} is already on a receipt of {formatInr(Number(seen.entry.amount) || 0)} on {formatDay(seen.at)} into {nameOf(seen.entry.accountId)}. Check this is not the same money.
                          </Message>
                        )}
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
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-slate-300 p-3 font-bold text-muted-foreground transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:border-slate-700 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300"
              >
                <Plus aria-hidden className="h-4 w-4" />
                Add another receipt
                <span className="hidden font-semibold opacity-70 sm:inline">(Alt + N)</span>
              </button>
            </div>
          </section>
        </div>

        {/* ── The batch as a whole, and saving it ── */}
        <aside className="min-w-0 overflow-hidden rounded-[20px] border bg-card shadow-sm xl:sticky xl:top-20">
          <header className="px-[18px] pb-2.5 pt-4">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Total received</p>
            <p className="text-[30px] font-extrabold leading-tight tracking-tight tabular-nums text-emerald-700 dark:text-emerald-400">{formatInr(total, total % 1 ? 2 : 0)}</p>
            <p className="text-xs text-muted-foreground">{total ? rupeesInWords(total) : 'Enter an amount to see it in words'}</p>
          </header>

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
                  <span className="shrink-0 text-right text-[12.5px] font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
                    +{compactInr(total)}
                    <span className="block text-[11px] font-semibold text-muted-foreground">{cc ? 'repays CC' : 'credited'}</span>
                  </span>
                </div>
                {cc && total > 0 && after < -0.004 && (
                  <Message tone="warn">{accountLabel(account)} has {formatInr(figure, 0)} drawn, so it will run {formatInr(-after, 0)} in credit.</Message>
                )}
              </>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">Choose the account in step 1.</p>
            )}
          </div>

          <div className="border-t px-[18px] py-3">
            <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Client bills</h2>
            {billRows.length > 0 ? (
              <Message tone="info">
                {billRows.length === 1 ? 'One receipt here is' : `${billRows.length} receipts here are`} client-bill money. Bill Tracking records that against the bill and posts the
                credit here itself once verified — if it is recorded there, don’t save it here as well.
              </Message>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">Payments against client bills are recorded in Bill Tracking, which marks the bill collected and posts the credit here.</p>
            )}
            <a href="/bill-tracking/collections" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold text-emerald-700 hover:underline dark:text-emerald-400">
              Bill Tracking receipts
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
            </a>
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
              <Message tone="bad">{accountLabel(account)} opened {formatDay(openingDay)}; receipts dated earlier would not count toward its balance.</Message>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t px-[18px] pb-[18px] pt-3.5">
            <Button
              onClick={() => void save('save')}
              disabled={saving !== null || !ready}
              className="h-11 gap-2 border-0 bg-gradient-to-r from-teal-700 via-blue-600 to-violet-600 text-white shadow-md hover:opacity-95"
            >
              {saving === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save {rows.length > 1 ? `${rows.length} receipts` : 'receipt'}
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
            <p className="text-center text-[11.5px] text-muted-foreground">
              {windowHint ?? 'Dates follow Date Control and Month Closure.'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
