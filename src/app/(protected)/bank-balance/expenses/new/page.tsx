'use client';
export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle, ArrowDown, ArrowLeft, BookOpenCheck, Check, CheckCircle2, FileText, History, Inbox, Info, Link2, ListPlus, Loader2, Plus, Printer, Save,
  Search, Send, Stamp, Trash2, X,
} from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, runTransaction, Timestamp, where, type DocumentReference } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes, type StorageReference } from 'firebase/storage';
import { differenceInCalendarDays, format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BANK_PAGE, BankAccessDenied, BankPageSkeleton, accountLabel } from '@/components/bank-balance/page-kit';
import { FileCell, fileSize } from '@/components/bank-balance/entry-grid';
import { AccountPicker, Tile, tileColours } from '@/components/bank-balance/account-picker';
import heroStyles from '@/components/bank-balance/dashboard-designs/aurora.module.css';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { balanceAt, buildLedger, compactInr, formatDay, formatInr, isCashCredit, lowestAvailableFrom, parseDay } from '@/lib/bank-balance-ledger';
import { rupeesInWords } from '@/lib/bank-balance-transfer';
import {
  applyPayments,
  financialYear,
  instrumentKey,
  modeConfig,
  nextVoucherNo,
  paymentModes,
  requisitionBalance,
  type BankPaymentVoucher,
  type PaymentModeConfig,
  type RequisitionPaymentRef,
  type VoucherLine,
} from '@/lib/bank-payments';
import { voucherHref } from '@/lib/requisition-progress';
import type { BankAccount, BankExpense, DailyRequisitionEntry, WorkflowStep } from '@/lib/types';
import { isHeld } from '@/lib/daily-requisition-flow';
import { useEntryControls } from '@/components/bank-balance/controls/use-entry-controls';
import { useBBFieldControl } from '@/components/bank-balance/controls/use-field-control';
import { cn } from '@/lib/utils';

type MandatoryField = 'paymentRequestRefNo' | 'utrNumber' | 'paymentMethod' | 'paymentRefNo' | 'approvalCopy' | 'bankTransferCopy';
type MandatoryFields = Record<MandatoryField, boolean>;


/** A requisition that can still be paid (status Received for Payment or Partially Paid). */
type Payable = DailyRequisitionEntry & { projectName: string; balance: number; dateText: string };

type Line = {
  id: string;
  requisitionId?: string;
  /** The requisition's Reception No. — or, on a manual row, whatever reference was typed. */
  ref: string;
  partyName: string;
  projectId?: string;
  projectName?: string;
  description: string;
  amount: string;
  utr: string;
  approvalCopy: File | null;
  /** Shown under the reference cell after a lookup that found nothing payable. */
  refNote?: string;
};

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const todayKey = () => format(new Date(), 'yyyy-MM-dd');
const newLine = (): Line => ({ id: makeId(), ref: '', partyName: '', description: '', amount: '', utr: '', approvalCopy: null });
const amountOf = (line: Line) => {
  const value = Number(line.amount);
  return Number.isFinite(value) ? value : 0;
};
const norm = (value: string | undefined) => (value || '').trim().toLowerCase();
const hasContent = (line: Line) => Boolean(line.ref || line.partyName || line.description || line.amount || line.utr || line.approvalCopy);

const reqDateText = (value: DailyRequisitionEntry['date']) => {
  if (!value) return '—';
  if (typeof value === 'string') return formatDay(value.slice(0, 10));
  try {
    return formatDay(value.toDate());
  } catch {
    return '—';
  }
};

/** A voucher row paying what is still due on a requisition. */
const lineFromPayable = (payable: Payable, id = makeId()): Line => ({
  id,
  requisitionId: payable.id,
  ref: payable.receptionNo,
  partyName: payable.partyName || '',
  projectId: payable.projectId,
  projectName: payable.projectName,
  description: payable.description || '',
  amount: String(payable.balance),
  utr: '',
  approvalCopy: null,
});

/** What can be spent on `day` from the account's running figure: the balance, or for Cash Credit the limit in force that day less what is drawn. */
const spendable = (account: BankAccount) => (day: Date, figure: number) =>
  isCashCredit(account) ? getApplicableCcLimit(account, day) - figure : figure;

/** The printable voucher, opened from the success panel. */
const voucherPrintHref = (voucherId: string) => `/bank-balance/cheques/${encodeURIComponent(voucherId)}/print`;

/** How many days a requisition has been waiting, or null when its date cannot be read. */
const waitingDays = (value: DailyRequisitionEntry['date']): number | null => {
  if (!value) return null;
  let day: Date | null = null;
  if (typeof value === 'string') day = parseDay(value.slice(0, 10));
  else {
    try {
      day = value.toDate();
    } catch {
      day = null;
    }
  }
  return day ? Math.max(0, differenceInCalendarDays(new Date(), day)) : null;
};

/** The line under each payment method on its card; a method added in Settings gets its kind's. */
const MODE_NOTE: Record<string, string> = {
  Cheque: 'Can be post-dated',
  'e-Cheque': 'From net banking, can be post-dated',
  RTGS: '₹2 lakh and above, same day',
  NEFT: 'Any amount, in batches',
  IMPS: 'Instant, up to ₹5 lakh',
  'Fund Transfer': 'Within the same bank',
  'Demand Draft': 'Drawn by the bank',
};
const KIND_NOTE: Record<PaymentModeConfig['kind'], string> = { cheque: 'Cheque', transfer: 'Bank transfer', draft: 'Bank draft' };

/** A voucher put aside in this browser. Attachments are not kept — a file cannot be stored there. */
interface PaymentDraft {
  mode: string;
  accountId: string;
  instrumentNo: string;
  instrumentDate: string;
  remarks: string;
  lines: Line[];
  savedAt: string;
}
const PAYMENT_DRAFT_KEY = 'bankBalance.paymentDraft';
const readPaymentDraft = (): PaymentDraft | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PAYMENT_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as PaymentDraft;
    return draft && Array.isArray(draft.lines) && typeof draft.savedAt === 'string' && !Number.isNaN(Date.parse(draft.savedAt)) ? draft : null;
  } catch {
    return null;
  }
};
const writePaymentDraft = (draft: PaymentDraft | null) => {
  try {
    if (draft) window.localStorage.setItem(PAYMENT_DRAFT_KEY, JSON.stringify(draft));
    else window.localStorage.removeItem(PAYMENT_DRAFT_KEY);
  } catch {
    // Storage blocked (a private window, say): the draft is simply not kept.
  }
};

/** The note shown when some requisitions sent by "Pay via voucher" could not go on the voucher. */
const skippedNote = (skipped: number, asked: number) =>
  `${skipped} of ${asked} requisition${asked === 1 ? '' : 's'} sent to this voucher ${skipped === 1 ? 'is' : 'are'} not waiting for payment ` +
  `(already paid, cancelled or not yet processed for payment) and ${skipped === 1 ? 'was' : 'were'} left off.`;

/**
 * Every line of one voucher paying the same requisition, applied in line order to ONE running copy — so the
 * second line is checked against what the first leaves due and the requisition gets a single update. Throws,
 * naming the rows, if together they pay more than is due.
 */
function foldPayments(req: DailyRequisitionEntry, receptionNo: string, rows: number[], refs: RequisitionPaymentRef[]) {
  try {
    return applyPayments(req, refs);
  } catch (error) {
    throw new Error(`Row${rows.length === 1 ? '' : 's'} ${rows.join(', ')} (${receptionNo}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The voucher just issued, for the success panel. */
interface IssuedVoucher {
  id: string;
  voucherNo: string;
  total: number;
  payees: number;
  mode: string;
  instrumentNo: string;
  instrumentDate: string;
  postDated: boolean;
}

/**
 * New Payment — a payment VOUCHER: one instrument (cheque, e-cheque, RTGS/NEFT batch, DD) drawn on
 * one bank account, paying one or many payees. Payees are picked from the Daily Requisitions
 * waiting for payment (or found by typing a Reception No.); each line may pay all or part of what
 * is still due. A cheque may be post-dated: it enters the balance from the date written on it.
 *
 * Saving writes the voucher, one bankExpenses Debit per line (dated on the instrument date), the
 * requisitions' paid amounts and — for a cheque, e-cheque or DD — a reservation of the instrument
 * number (bankInstrumentNos) in ONE transaction, re-reading each requisition first so two people
 * cannot pay the same balance twice. See src/lib/bank-payments.ts.
 *
 * Daily Requisition's "Pay via voucher" opens this page with ?requisitions=<id,id,…>; those
 * requisitions start on the voucher for what is still due.
 */
function NewPaymentForm() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const canAdd = !authLoading && can('Add', 'Bank Balance.Expenses');
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  const searchParams = useSearchParams();
  const requestedIds = searchParams.get('requisitions') ?? '';

  // Voucher header.
  const [mode, setMode] = useState('Cheque');
  const [accountId, setAccountId] = useState('');
  const [instrumentNo, setInstrumentNo] = useState('');
  const [instrumentDate, setInstrumentDate] = useState(todayKey());
  const [remarks, setRemarks] = useState('');
  const [transferCopy, setTransferCopy] = useState<File | null>(null);
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [showErrors, setShowErrors] = useState(false);

  // Loaded data.
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankExpense[]>([]);
  const [vouchers, setVouchers] = useState<BankPaymentVoucher[]>([]);
  const [payables, setPayables] = useState<Payable[]>([]);
  /*
   * Field Control: each field's label, whether it is shown and whether it is required. Payment
   * Entry's old mandatory switches are its defaults until Field Control is saved, so `mandatory`
   * reads exactly as it did. A hidden field is never required.
   */
  const fc = useBBFieldControl('payment');
  const need = (key: string) => fc.field(key).visible && fc.field(key).required;
  const mandatory: MandatoryFields = {
    paymentRequestRefNo: need('ref'),
    utrNumber: need('utr'),
    paymentMethod: false,
    paymentRefNo: need('instrumentNo'),
    approvalCopy: need('approvalCopy'),
    bankTransferCopy: need('transferCopy'),
  };
  // Date Control's window and Month Closure's calendar for this account — the same for everyone.
  const controls = useEntryControls('payment', (id) => accountLabel(accounts.find((a) => a.id === id)));
  /** Field Control › Payment options: may a row be paid against a typed reference with no requisition behind it? */
  const [allowDirect, setAllowDirect] = useState(true);
  const [customMethods, setCustomMethods] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /** The first load has finished; later reloads (after a save) refresh in place instead of blanking the form. */
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastIssued, setLastIssued] = useState<IssuedVoucher | null>(null);
  const issuedRef = useRef<HTMLDivElement>(null);

  // Requisitions sent by "Pay via voucher": which ?requisitions= value has been applied, and what was left off.
  const preloadedFor = useRef<string | null>(null);
  /**
   * Daily Requisition's workflow, for its Verification steps: a requisition one of them holds before
   * payment is not payable until it is verified (src/lib/daily-requisition-flow.ts).
   */
  const requisitionStepsRef = useRef<WorkflowStep[]>([]);
  const [preloadNote, setPreloadNote] = useState('');

  // Requisition picker.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerProject, setPickerProject] = useState('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // A row with no requisition behind it has been asked for, so the table shows though it is empty.
  const [manualOpen, setManualOpen] = useState(false);
  // The Reception No. typed in the quick-add box under the payees.
  const [quickRef, setQuickRef] = useState('');
  // A voucher put aside earlier in this browser, offered back once.
  const [draft, setDraft] = useState<PaymentDraft | null>(readPaymentDraft);
  // The number the next voucher should get; the final one is taken inside the save's transaction.
  const [nextNo, setNextNo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [accountSnap, txnSnap, voucherSnap, reqSnap, projectSnap, settingsSnap, methodSnap, requisitionWorkflowSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses')),
        getDocs(collection(db, 'bankPayments')),
        getDocs(query(collection(db, 'dailyRequisitions'), where('status', 'in', ['Received for Payment', 'Partially Paid']))),
        getDocs(collection(db, 'projects')),
        getDoc(doc(db, 'bankBalanceSettings', 'paymentEntry')),
        getDocs(collection(db, 'paymentMethods')),
        // Without it nothing counts as held, as before Verification steps existed.
        getDoc(doc(db, 'workflows', 'daily-requisition-workflow')).catch(() => null),
      ]);
      const requisitionSteps = requisitionWorkflowSnap?.exists() ? requisitionWorkflowSnap.data().steps : [];
      requisitionStepsRef.current = Array.isArray(requisitionSteps) ? (requisitionSteps as WorkflowStep[]) : [];
      const projectNames = new Map(projectSnap.docs.map((d) => [d.id, String(d.data().projectName ?? '')]));
      const payable: Payable[] = reqSnap.docs
        .map((d) => {
          const entry = { id: d.id, ...d.data() } as DailyRequisitionEntry;
          return { ...entry, projectName: projectNames.get(entry.projectId) || '—', balance: requisitionBalance(entry), dateText: reqDateText(entry.date) };
        })
        .filter((entry) => entry.balance > 0 && !isHeld(requisitionStepsRef.current, entry))
        .sort((a, b) => (a.receptionNo || '').localeCompare(b.receptionNo || ''));
      setAccounts(accountSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount)).sort((a, b) => accountLabel(a).localeCompare(accountLabel(b))));
      setTransactions(txnSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankExpense)));
      setVouchers(voucherSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankPaymentVoucher)));
      setPayables(payable);
      // Absent means allowed, so nothing changes for a site that has never opened the setting.
      setAllowDirect(settingsSnap.exists() ? settingsSnap.data().allowDirectPayments !== false : true);
      setCustomMethods(methodSnap.docs.map((d) => String(d.data().name ?? '')));
      setHasLoaded(true);

      // Requisitions sent by "Pay via voucher" (?requisitions=<id,id,…>) go on the voucher for what is still due —
      // once, not again each time the data reloads (after a save, say). Ids not waiting for payment are left off.
      if (requestedIds && preloadedFor.current !== requestedIds) {
        preloadedFor.current = requestedIds;
        const ids = [...new Set(requestedIds.split(',').map((id) => id.trim()).filter(Boolean))];
        const byId = new Map(payable.map((p) => [p.id, p]));
        const found = ids.flatMap((id) => {
          const match = byId.get(id);
          return match ? [match] : [];
        });
        if (found.length) {
          setLines((prev) => {
            const onVoucher = new Set(prev.map((line) => line.requisitionId));
            const add = found.filter((p) => !onVoucher.has(p.id));
            return add.length ? [...prev.filter(hasContent), ...add.map((p) => lineFromPayable(p))] : prev;
          });
        }
        const skipped = ids.length - found.length;
        setPreloadNote(skipped > 0 ? skippedNote(skipped, ids.length) : '');
      }
    } catch (error) {
      console.error('Error loading payment data:', error);
      toast({ title: 'Error', description: 'Failed to load accounts, requisitions and payment settings.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, requestedIds]);

  useEffect(() => {
    if (authLoading) return;
    if (!canAdd) {
      setIsLoading(false);
      return;
    }
    void load();
  }, [authLoading, canAdd, load]);

  // Leaving with typed-in lines loses them; ask first.
  const isDirty = lines.some(hasContent) || Boolean(instrumentNo);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const modes = useMemo(() => paymentModes(customMethods), [customMethods]);
  const cfg = modeConfig(mode, modes);
  const today = todayKey();
  const activeAccounts = useMemo(() => accounts.filter((a) => a.status === 'Active'), [accounts]);
  const account = accounts.find((a) => a.id === accountId);
  const payableById = useMemo(() => new Map(payables.map((p) => [p.id, p])), [payables]);
  const postDated = cfg.allowsFutureDate && instrumentDate > today;

  // If the mode changes to one that cannot be dated ahead, bring a future date back to today.
  useEffect(() => {
    if (!cfg.allowsFutureDate && instrumentDate > today) setInstrumentDate(today);
  }, [cfg.allowsFutureDate, instrumentDate, today]);

  const instrumentDay = useMemo(() => parseDay(instrumentDate), [instrumentDate]);
  const modeDateLabel = cfg.kind === 'cheque' ? 'Cheque date' : cfg.kind === 'draft' ? 'DD date' : 'Transfer date';
  const dateLabel = fc.label('instrumentDate', modeDateLabel);
  const instrumentLabel = fc.label('instrumentNo', cfg.instrumentLabel);
  // A cheque or DD number is always asked for; for a transfer the reference can be hidden.
  const showInstrumentNo = cfg.instrumentRequired || fc.field('instrumentNo').visible;
  const showRemarks = fc.field('remarks').visible;
  const showTransferCopy = fc.field('transferCopy').visible;
  const showUtr = cfg.utrPerLine && fc.field('utr').visible;
  const showApproval = fc.field('approvalCopy').visible;
  const transferCopyLabel = fc.label('transferCopy', cfg.kind === 'transfer' ? 'Bank advice / upload file' : 'Cheque / covering letter copy');
  // The window: back-dating, and how far ahead a cheque or DD (or anything else) may be dated.
  const dateWindow = controls.windowFor([accountId], { postDated: cfg.allowsFutureDate });
  const dateCheck = instrumentDate && !controls.loading
    ? controls.check(instrumentDate, [accountId], { postDated: cfg.allowsFutureDate, label: dateLabel })
    : null;

  // An entry dated before the account's opening date is already inside its opening figure, so the ledger
  // ignores it: a payment dated then would never count toward the balance.
  const accountStart = account ? parseDay(account.openingDate) : null;
  const beforeOpening = Boolean(accountStart && instrumentDay && instrumentDay < accountStart);
  const openingNote =
    beforeOpening && account
      ? `${dateLabel} ${formatDay(instrumentDate)} is before the account's opening date ${formatDay(account.openingDate)}; the payment would not count toward its balance.`
      : '';

  // Funds from the instrument date on — everything already dated up to then, post-dated cheques included. The
  // voucher must fit under the LOWEST point from that date onward: cheques already booked for later dates draw
  // on the same money, and one of them would bounce if this voucher took it.
  const funds = useMemo(() => {
    if (!account || !instrumentDay || beforeOpening) return null;
    const ledger = buildLedger(account, transactions);
    const availableOn = spendable(account);
    const onDate = availableOn(instrumentDay, balanceAt(ledger, instrumentDay));
    const lowest = lowestAvailableFrom(ledger, instrumentDay, availableOn);
    return { onDate, lowest: lowest.amount, lowestDay: lowest.day, lowestAhead: lowest.day > instrumentDay && lowest.amount < onDate };
  }, [account, transactions, instrumentDay, beforeOpening]);
  const fundsLabel = account && isCashCredit(account) ? 'Available limit' : 'Available balance';

  const total = lines.reduce((sum, line) => sum + amountOf(line), 0);
  const remaining = funds ? funds.lowest - total : null;
  const overBy = remaining !== null && remaining < -0.004 ? -remaining : 0;

  const duplicateInstrument =
    instrumentNo.trim() && cfg.kind !== 'transfer'
      ? vouchers.find((v) => v.accountId === accountId && v.mode === mode && norm(v.instrumentNo) === norm(instrumentNo) && v.status !== 'Cancelled')
      : undefined;

  /** Why a line cannot be saved yet, per column. */
  const lineErrors = (line: Line) => {
    const payable = line.requisitionId ? payableById.get(line.requisitionId) : undefined;
    const amount = amountOf(line);
    return {
      // With direct payments off, a reference alone is not enough — the row must settle a requisition.
      ref: (mandatory.paymentRequestRefNo && !line.ref.trim()) || (!allowDirect && !line.requisitionId),
      party: !line.partyName.trim(),
      description: !line.description.trim(),
      amount: !(amount > 0) || (payable ? amount > payable.balance + 0.01 : false),
      utr: cfg.utrPerLine && mandatory.utrNumber && !line.utr.trim(),
      approval: mandatory.approvalCopy && !line.approvalCopy,
    };
  };
  const incomplete = lines.filter((line) => Object.values(lineErrors(line)).some(Boolean));
  const headerErrors = {
    account: !accountId,
    instrumentNo: (cfg.instrumentRequired || mandatory.paymentRefNo) && !instrumentNo.trim(),
    instrumentDate: !instrumentDay || (!cfg.allowsFutureDate && instrumentDate > today),
    transferCopy: mandatory.bankTransferCopy && !transferCopy,
    remarks: need('remarks') && !remarks.trim(),
  };

  const update = (id: string, patch: Partial<Line>) => setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  const removeLine = (id: string) =>
    setLines((prev) => {
      const rest = prev.filter((line) => line.id !== id);
      return rest.length ? rest : [newLine()];
    });

  const linkedIds = new Set(lines.map((line) => line.requisitionId).filter(Boolean) as string[]);

  /** Typing a Reception No. and leaving the cell (or Enter) links that requisition and fills the row. */
  const lookup = (line: Line) => {
    const code = norm(line.ref);
    if (!code || line.requisitionId) return;
    const match = payables.find((p) => norm(p.receptionNo) === code || (p.depNo && norm(p.depNo) === code));
    if (!match) {
      update(line.id, {
        refNote: allowDirect
          ? 'Not waiting for payment in the system — this row will be paid directly against this reference.'
          : 'No requisition waiting for payment has this number. Payments without a requisition are switched off in Settings › Field Control › Payment options.',
      });
      return;
    }
    if (linkedIds.has(match.id)) {
      update(line.id, { refNote: `${match.receptionNo} is already on another row.` });
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...lineFromPayable(match, line.id), utr: l.utr, approvalCopy: l.approvalCopy } : l)));
  };

  const unlink = (line: Line) => update(line.id, { requisitionId: undefined, projectId: undefined, projectName: undefined, refNote: undefined });

  const addPicked = () => {
    const chosen = payables.filter((p) => picked.has(p.id) && !linkedIds.has(p.id));
    setLines((prev) => {
      const kept = prev.filter(hasContent);
      return [...kept, ...chosen.map((p) => lineFromPayable(p))];
    });
    setPicked(new Set());
    setPickerOpen(false);
  };

  const tooLarge = (file: File) => toast({ title: 'File too large', description: `${file.name} is ${fileSize(file.size)}; the limit is 10 MB.`, variant: 'destructive' });

  const handleSave = async () => {
    if (!canAdd) {
      toast({ title: 'Not allowed', description: 'You do not have permission to add payments.', variant: 'destructive' });
      return;
    }
    setShowErrors(true);
    if (Object.values(headerErrors).some(Boolean) || incomplete.length || !account || !instrumentDay) {
      toast({
        title: 'Check the voucher',
        description: incomplete.length
          ? `${incomplete.length} row${incomplete.length === 1 ? ' is' : 's are'} incomplete — see the cells marked in red.`
          : 'Fill in the bank account, instrument details and dates marked in red.',
        variant: 'destructive',
      });
      return;
    }
    if (beforeOpening) {
      toast({ title: 'Date before the account opened', description: openingNote, variant: 'destructive' });
      return;
    }
    // Date Control's window and the closed months, checked at the moment of saving. No role lifts
    // either: the window is widened, or the month reopened, in Settings.
    const allowed = controls.check(instrumentDate, [accountId], { postDated: cfg.allowsFutureDate, label: dateLabel });
    if (!allowed.ok) {
      toast({ title: 'Date not allowed', description: allowed.reason, variant: 'destructive' });
      return;
    }
    if (funds && total > funds.lowest + 0.004) {
      toast({
        title: 'Insufficient funds',
        description: funds.lowestAhead
          ? `The voucher totals ${formatInr(total)}. ${accountLabel(account)} has ${formatInr(funds.onDate)} on ${formatDay(instrumentDate)}, but payments already booked for later dates (post-dated cheques) bring that down to ${formatInr(funds.lowest)} on ${formatDay(funds.lowestDay)} — paying more now would leave too little for them.`
          : `The voucher totals ${formatInr(total)}; ${accountLabel(account)} has ${formatInr(funds.onDate)} available on ${formatDay(instrumentDate)}.`,
        variant: 'destructive',
      });
      return;
    }

    const day = instrumentDay;
    // "Today" as of this click, not as of the last render: the page may have been open since yesterday, and the
    // voucher number restarts each financial year.
    const issueDay = todayKey();
    const instrument = instrumentNo.trim();
    const reservationKey = instrumentKey(accountId, mode, instrument);
    const voucherTotal = Math.round(total * 100) / 100;
    const payees = lines.length;
    const reqIds = [...new Set(lines.flatMap((line) => (line.requisitionId ? [line.requisitionId] : [])))];

    setIsSaving(true);
    setLastIssued(null);
    // Every file uploaded for this voucher, so a save that fails can take them back out of Storage.
    const uploaded: StorageReference[] = [];
    let issued: IssuedVoucher | null = null;
    try {
      const voucherRef = doc(collection(db, 'bankPayments'));
      const counterRef = doc(db, 'bankBalanceCounters', 'paymentVoucher');
      // A cheque, e-cheque or DD reserves its number on the account; a transfer's batch reference is free text.
      const reservationRef = reservationKey ? doc(db, 'bankInstrumentNos', reservationKey) : null;
      const stamp = Date.now();

      // 1) Uploads first — Storage is outside the transaction. allSettled, so every upload has finished (and is
      //    on the clean-up list) before a failure is reported.
      const upload = async (path: string, file: File) => {
        const fileRef = ref(storage, path);
        await uploadBytes(fileRef, file);
        uploaded.push(fileRef);
        return getDownloadURL(fileRef);
      };
      const settled = await Promise.allSettled([
        transferCopy ? upload(`bank-payments/${voucherRef.id}/${stamp}-transfer-${transferCopy.name}`, transferCopy) : Promise.resolve(''),
        ...lines.map((line) =>
          line.approvalCopy ? upload(`bank-payments/${voucherRef.id}/${line.id}-approval-${line.approvalCopy.name}`, line.approvalCopy) : Promise.resolve(''),
        ),
      ]);
      const failedUpload = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failedUpload) throw failedUpload.reason;
      const [transferCopyUrl, ...approvalUrls] = settled.map((result) => (result.status === 'fulfilled' ? result.value : ''));

      // 2) One transaction. Every read first — the voucher itself, the counter, the instrument number's
      //    reservation and each requisition once — then every write.
      const voucherNo = await runTransaction(db, async (tx) => {
        const existingSnap = await tx.get(voucherRef);
        const counterSnap = await tx.get(counterRef);
        const reservationSnap = reservationRef ? await tx.get(reservationRef) : null;
        const reqSnaps = await Promise.all(reqIds.map((id) => tx.get(doc(db, 'dailyRequisitions', id))));

        // A retry after a commit that did land (only its reply was lost) must not book the voucher twice.
        if (existingSnap.exists()) return String(existingSnap.data().voucherNo ?? '');
        if (reservationSnap?.exists()) {
          const taken = reservationSnap.data() as { voucherNo?: string };
          throw new Error(`${cfg.instrumentLabel} ${instrument} is already used on voucher ${taken.voucherNo || '(number not recorded)'}.`);
        }

        const reqById = new Map(reqSnaps.map((snap) => [snap.id, snap]));
        const storedCounter = counterSnap.exists() ? (counterSnap.data() as { fy?: string; next?: number }) : undefined;
        // The number series restarts at 1 each financial year and must never run backwards: on a
        // device whose date is behind (a day either side of 1 April), numbering into the closed year
        // would re-issue a number already used AND reset the shared counter, so the next voucher of
        // the new year would collide too. Refuse rather than duplicate.
        if (storedCounter?.fy && storedCounter.fy > financialYear(issueDay)) {
          throw new Error(
            `Voucher numbering is already in FY ${storedCounter.fy}, but this device's date reads ${formatDay(issueDay)} (FY ${financialYear(issueDay)}). Check the date on this device and try again.`,
          );
        }
        const { voucherNo: number, counter } = nextVoucherNo(storedCounter, issueDay);
        const instrumentTs = Timestamp.fromDate(day);
        const now = Timestamp.now();

        // Build everything first; nothing is written until every line and requisition has checked out.
        const expenses: Array<{ docRef: DocumentReference; data: Omit<BankExpense, 'id'> }> = [];
        const voucherLines: VoucherLine[] = [];
        const byRequisition = new Map<string, { req: DailyRequisitionEntry; receptionNo: string; rows: number[]; refs: RequisitionPaymentRef[] }>();

        lines.forEach((line, index) => {
          const expenseRef = doc(collection(db, 'bankExpenses'));
          const amount = Math.round(amountOf(line) * 100) / 100;
          const party = line.partyName.trim();
          const description = line.description.trim();

          if (line.requisitionId) {
            const snap = reqById.get(line.requisitionId);
            if (!snap?.exists()) throw new Error(`Row ${index + 1}: requisition ${line.ref} no longer exists.`);
            const req = snap.data() as DailyRequisitionEntry;
            if (req.status !== 'Received for Payment' && req.status !== 'Partially Paid') {
              throw new Error(`Row ${index + 1}: ${line.ref} is now "${req.status}" and can no longer be paid here.`);
            }
            if (isHeld(requisitionStepsRef.current, req)) {
              throw new Error(`Row ${index + 1}: ${line.ref} is waiting at a Daily Requisition verification step and cannot be paid until it is verified.`);
            }
            // Lines grouped by requisition, in line order — folded into one update below.
            const group = byRequisition.get(line.requisitionId) ?? { req, receptionNo: line.ref.trim(), rows: [], refs: [] };
            group.rows.push(index + 1);
            group.refs.push({ bankPaymentId: voucherRef.id, voucherNo: number, lineId: line.id, amount, mode, instrumentNo: instrument, instrumentDate, accountId });
            byRequisition.set(line.requisitionId, group);
          }

          expenses.push({
            docRef: expenseRef,
            data: {
              date: instrumentTs,
              accountId,
              description: party && !description.toLowerCase().includes(party.toLowerCase()) ? `${party} — ${description}` : description,
              amount,
              type: 'Debit',
              isContra: false,
              paymentRequestRefNo: line.ref.trim(),
              utrNumber: line.utr.trim(),
              paymentMethod: mode,
              paymentRefNo: instrument,
              approvalCopyUrl: approvalUrls[index] ?? '',
              bankTransferCopyUrl: transferCopyUrl,
              bankPaymentId: voucherRef.id,
              voucherNo: number,
              ...(line.requisitionId ? { requisitionId: line.requisitionId } : {}),
              createdAt: now,
            },
          });

          voucherLines.push({
            lineId: line.id,
            ...(line.requisitionId ? { requisitionId: line.requisitionId } : {}),
            receptionNo: line.ref.trim(),
            partyName: party,
            ...(line.projectId ? { projectId: line.projectId, projectName: line.projectName || '' } : {}),
            description,
            amount,
            utrNumber: line.utr.trim(),
            approvalCopyUrl: approvalUrls[index] ?? '',
            expenseId: expenseRef.id,
          });
        });

        // ONE update per requisition, however many lines pay it (throws if together they pay more than is due).
        const reqUpdates = [...byRequisition].map(([id, group]) => {
          const next = foldPayments(group.req, group.receptionNo, group.rows, group.refs);
          return { id, data: { ...next, lastPaidAt: now, ...(next.status === 'Paid' ? { paidAt: now } : {}) } };
        });

        const voucher: Omit<BankPaymentVoucher, 'id'> & { createdAt: Timestamp } = {
          voucherNo: number,
          mode,
          accountId,
          instrumentNo: instrument,
          instrumentDate,
          issueDate: issueDay,
          lines: voucherLines,
          total: voucherTotal,
          status: 'Issued',
          transferCopyUrl,
          remarks: remarks.trim(),
          createdById: user?.id || '',
          createdByName: user?.name || '',
          createdAt: now,
        };

        expenses.forEach(({ docRef, data }) => tx.set(docRef, data));
        tx.set(voucherRef, voucher);
        reqUpdates.forEach(({ id, data }) => tx.update(doc(db, 'dailyRequisitions', id), data));
        if (reservationRef) {
          tx.set(reservationRef, { voucherId: voucherRef.id, voucherNo: number, accountId, mode, instrumentNo: instrument, createdAt: now });
        }
        tx.set(counterRef, counter);
        return number;
      });

      issued = {
        id: voucherRef.id,
        voucherNo,
        total: voucherTotal,
        payees,
        mode,
        instrumentNo: instrument,
        instrumentDate,
        postDated: cfg.allowsFutureDate && instrumentDate > issueDay,
      };
    } catch (error) {
      console.error('Error issuing payment voucher:', error);
      // Nothing was saved, so the files uploaded for it belong to nothing: take them back out (best effort).
      if (uploaded.length) void Promise.allSettled(uploaded.map((fileRef) => deleteObject(fileRef)));
      toast({ title: 'Voucher not saved', description: error instanceof Error ? error.message : 'Nothing was saved. Please try again.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
    if (!issued) return;

    const paidBy = `${mode}${instrument ? ` ${instrument}` : ''}`;
    toast({
      title: `Voucher ${issued.voucherNo} issued`,
      description: `${payees} payment${payees === 1 ? '' : 's'} of ${formatInr(voucherTotal)} by ${paidBy}${
        issued.postDated ? ` — post-dated to ${formatDay(instrumentDate)}` : ''
      }.`,
    });
    void log(
      'Issue Payment Voucher',
      {
        summary: `${issued.voucherNo}: ${payees} payee${payees === 1 ? '' : 's'}, ${formatInr(voucherTotal)} by ${paidBy}`,
        voucherNo: issued.voucherNo,
        account: accountLabel(account),
        accountId,
        mode,
        instrumentNo: instrument,
        instrumentDate,
        payees,
        total: voucherTotal,
        requisitions: reqIds.length,
      },
      { recordId: issued.id, recordRef: issued.voucherNo },
    );
    setLastIssued(issued);
    // Keep the account and mode for the next voucher; clear the rest.
    setLines([newLine()]);
    setInstrumentNo('');
    setRemarks('');
    setTransferCopy(null);
    setShowErrors(false);
    setPreloadNote('');
    setManualOpen(false);
    writePaymentDraft(null);
    setDraft(null);
    void load();
  };

  // Bring the success panel into view — Save sits at the foot of what can be a long form.
  useEffect(() => {
    if (lastIssued) issuedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [lastIssued]);

  // The voucher number the counter would give now — refreshed after each issue.
  useEffect(() => {
    if (!canAdd) return;
    let cancelled = false;
    getDoc(doc(db, 'bankBalanceCounters', 'paymentVoucher'))
      .then((snap) => {
        if (cancelled) return;
        const stored = snap.exists() ? (snap.data() as { fy?: string; next?: number }) : undefined;
        const day = todayKey();
        setNextNo(stored?.fy && stored.fy > financialYear(day) ? null : nextVoucherNo(stored, day).voucherNo);
      })
      .catch(() => {
        if (!cancelled) setNextNo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canAdd, lastIssued]);

  // What each active account can spend on the instrument date, for the account picker.
  const availableByAccount = useMemo(() => {
    const map = new Map<string, number>();
    if (!instrumentDay) return map;
    for (const a of activeAccounts) map.set(a.id, spendable(a)(instrumentDay, balanceAt(buildLedger(a, transactions), instrumentDay)));
    return map;
  }, [activeAccounts, transactions, instrumentDay]);

  // One issue at a time, from the button or from Ctrl+Enter.
  const issuingRef = useRef(false);
  const issue = async () => {
    if (issuingRef.current) return;
    issuingRef.current = true;
    try {
      await handleSave();
    } finally {
      issuingRef.current = false;
    }
  };
  const issueBlocked =
    isSaving || isLoading || activeAccounts.length === 0 || overBy > 0 || Boolean(dateCheck && !dateCheck.ok) || !lines.some(hasContent);

  // Ctrl+Enter issues the voucher. Read through refs, so the listener stays one.
  const issueRef = useRef(issue);
  const blockedRef = useRef(issueBlocked);
  useEffect(() => {
    issueRef.current = issue;
    blockedRef.current = issueBlocked;
  });
  useEffect(() => {
    if (pickerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !blockedRef.current) {
        event.preventDefault();
        void issueRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  // Only the first load blanks the page; a reload after a save refreshes the figures in place (Save waits for it).
  if (authLoading || (isLoading && canAdd && !hasLoaded)) return <BankPageSkeleton kpis={0} blocks={1} />;
  if (!canAdd) return <BankAccessDenied title="New Payment" backHref="/bank-balance/expenses" backLabel="Back to payments" what="the payment entry form" />;

  const err = (flag: boolean | undefined) => Boolean(showErrors && flag);
  const projects = [...new Map(payables.map((p) => [p.projectId, p.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const pickerRows = payables.filter((p) => {
    if (pickerProject !== 'all' && p.projectId !== pickerProject) return false;
    const q = norm(pickerSearch);
    return !q || [p.receptionNo, p.depNo, p.partyName, p.description, p.projectName].some((field) => norm(field).includes(q));
  });
  const pickedTotal = payables.filter((p) => picked.has(p.id)).reduce((sum, p) => sum + p.balance, 0);
  const waiting = payables.filter((p) => !linkedIds.has(p.id));
  const waitingTotal = waiting.reduce((sum, p) => sum + p.balance, 0);

  const payeeLines = lines.filter(hasContent);
  const showTable = payeeLines.length > 0 || manualOpen;
  const colourOf = (id: string) => tileColours(activeAccounts.findIndex((a) => a.id === id));
  const availableOf = (id: string) => availableByAccount.get(id) ?? 0;

  // The last number this account used on this mode, and the one after it, when they are plain digits.
  const lastUsed = account
    ? vouchers
        .filter((v) => v.accountId === account.id && v.mode === mode && v.instrumentNo)
        .sort((a, b) => (b.instrumentDate || '').localeCompare(a.instrumentDate || '') || (b.voucherNo || '').localeCompare(a.voucherNo || ''))[0]
    : undefined;
  const suggested = lastUsed && /^\d+$/.test(lastUsed.instrumentNo) ? String(Number(lastUsed.instrumentNo) + 1).padStart(lastUsed.instrumentNo.length, '0') : null;

  const quickAdd = () => {
    const code = norm(quickRef);
    if (!code) return;
    const match = payables.find((p) => norm(p.receptionNo) === code || (p.depNo && norm(p.depNo) === code));
    if (!match) {
      toast({
        title: 'Not waiting for payment',
        description: `No requisition ${quickRef.trim()} is waiting for payment.${allowDirect ? ' Use “Payment without a requisition” to pay it directly.' : ''}`,
        variant: 'destructive',
      });
      return;
    }
    if (linkedIds.has(match.id)) {
      toast({ title: 'Already on this voucher', description: `${match.receptionNo} is already a row.` });
      return;
    }
    setLines((prev) => [...prev.filter(hasContent), lineFromPayable(match)]);
    setQuickRef('');
    toast({ title: `Added ${match.receptionNo}`, description: match.partyName || '' });
  };
  const addManual = () => {
    if (!lines.some(hasContent)) setManualOpen(true);
    else setLines((prev) => [...prev, newLine()]);
  };

  const saveDraft = () => {
    writePaymentDraft({
      mode, accountId, instrumentNo, instrumentDate, remarks,
      lines: lines.filter(hasContent).map((line) => ({ ...line, approvalCopy: null })),
      savedAt: new Date().toISOString(),
    });
    toast({ title: 'Draft saved', description: 'Kept in this browser. Attachments are not kept in a draft — add them again before issuing.' });
  };
  const restoreDraft = () => {
    if (!draft) return;
    // A requisition paid (or cancelled) since the draft was put aside no longer belongs on it.
    const kept = draft.lines.filter((line) => !line.requisitionId || payableById.has(line.requisitionId));
    const dropped = draft.lines.length - kept.length;
    setMode(draft.mode);
    setAccountId(draft.accountId);
    setInstrumentNo(draft.instrumentNo);
    setInstrumentDate(draft.instrumentDate);
    setRemarks(draft.remarks);
    setLines(kept.length ? kept.map((line) => ({ ...newLine(), ...line, approvalCopy: null })) : [newLine()]);
    if (kept.some((line) => !line.requisitionId)) setManualOpen(true);
    writePaymentDraft(null);
    setDraft(null);
    if (dropped) {
      toast({
        title: 'Draft restored',
        description: `${dropped} requisition${dropped === 1 ? ' is' : 's are'} no longer waiting for payment and ${dropped === 1 ? 'was' : 'were'} left off.`,
      });
    }
  };
  const discardDraft = () => {
    writePaymentDraft(null);
    setDraft(null);
  };

  const batchMode = modes.find((m) => m.mode === 'NEFT') ?? modes.find((m) => m.kind === 'transfer');
  const messages: Array<{ tone: 'bad' | 'warn' | 'info'; text: string; action?: { label: string; run: () => void } }> = [];
  if (!accountId) messages.push({ tone: 'warn', text: 'Pick the bank account to see the funds available on the instrument date.' });
  if (openingNote) messages.push({ tone: 'bad', text: openingNote });
  if (overBy > 0 && funds) {
    messages.push({
      tone: 'bad',
      text: funds.lowestAhead
        ? `Over by ${formatInr(overBy)}. ${formatInr(funds.onDate)} is available on ${formatDay(instrumentDate)}, but payments already booked for later dates (post-dated cheques) bring it down to ${formatInr(funds.lowest)} on ${formatDay(funds.lowestDay)} — this voucher has to fit under that, or one of them would bounce.`
        : `${accountLabel(account)} has ${formatInr(funds.onDate)} on ${formatDay(instrumentDate)}. This voucher needs ${formatInr(total)} — over by ${formatInr(overBy)}.`,
    });
  }
  if (showErrors && incomplete.length) messages.push({ tone: 'bad', text: `Incomplete rows (marked in red): ${incomplete.map((line) => lines.indexOf(line) + 1).join(', ')}.` });
  if (!allowDirect && lines.some((line) => hasContent(line) && !line.requisitionId)) {
    messages.push({ tone: 'bad', text: 'Every row has to settle a requisition waiting for payment. Payments without a requisition are switched off in Settings › Field Control › Payment options.' });
  }
  if (duplicateInstrument) messages.push({ tone: 'warn', text: `${cfg.instrumentLabel} ${instrumentNo} is already on voucher ${duplicateInstrument.voucherNo} (${formatDay(duplicateInstrument.instrumentDate)}) for this account.` });
  if (cfg.kind !== 'transfer' && payeeLines.length > 1) {
    messages.push({
      tone: 'info',
      text: `One ${mode} for ${payeeLines.length} payees needs a covering letter to the bank. Paying them as a transfer batch is usually easier.`,
      ...(batchMode ? { action: { label: `Switch to ${batchMode.mode}`, run: () => setMode(batchMode.mode) } } : {}),
    });
  }
  if (postDated) {
    messages.push({ tone: 'info', text: `Post-dated ${mode} — it enters the balance on ${formatDay(instrumentDate)}. Until then the Cheque Register lists it as post-dated, and today’s balance is unaffected.` });
  }

  const checks = [
    { ok: Boolean(account), text: 'Bank account selected' },
    ...(cfg.instrumentRequired || mandatory.paymentRefNo ? [{ ok: Boolean(instrumentNo.trim()), text: `${instrumentLabel} entered` }] : []),
    { ok: payeeLines.length > 0, text: 'At least one payee' },
    { ok: payeeLines.length > 0 && incomplete.length === 0, text: 'Every payee is complete' },
    ...(mandatory.bankTransferCopy || need('remarks') ? [{ ok: !headerErrors.transferCopy && !headerErrors.remarks, text: 'Required attachment and remarks' }] : []),
    { ok: Boolean(account) && overBy === 0 && !beforeOpening, text: 'Enough funds on the instrument date' },
    { ok: !headerErrors.instrumentDate && !(dateCheck && !dateCheck.ok), text: 'The date is allowed' },
  ];
  const singlePayee = payeeLines.length === 1 ? payeeLines[0].partyName.trim() : '';
  const dateDigits = instrumentDay ? format(instrumentDay, 'ddMMyyyy') : '';
  // As a cheque is written: "Twelve lakh … five hundred and fifty paise only" after the printed "Rupees".
  const chequeWords = total ? rupeesInWords(total).replace(/ rupees?(?= and| only)/, '') : '';
  const chequeFigure = total ? `${total.toLocaleString('en-IN', { minimumFractionDigits: total % 1 ? 2 : 0, maximumFractionDigits: 2 })}/-` : '';
  /** The caption a phone's stacked row shows in place of the column header. */
  const phoneLabel = (text: string) => (
    <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground sm:hidden">{text}</span>
  );
  const modeTile = (m: PaymentModeConfig): [string, string] =>
    m.mode === 'e-Cheque' ? ['#c4b5fd', '#6d28d9'] : m.kind === 'cheque' ? ['#fdba74', '#ea580c'] : m.kind === 'draft' ? ['#93c5fd', '#1d4ed8'] : ['#5eead4', '#0d9488'];
  const ModeIcon = (m: PaymentModeConfig) => (m.kind === 'cheque' ? FileText : m.kind === 'draft' ? Stamp : Send);

  return (
    <>
      <div className={cn(BANK_PAGE, 'pb-10')}>
        {/* Where this is, and the way back. */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
          <Link href="/bank-balance/expenses" aria-label="Back to payments" className="mr-1 flex h-[30px] w-[30px] items-center justify-center rounded-lg border bg-card hover:bg-muted">
            <ArrowLeft className="h-[15px] w-[15px]" />
          </Link>
          <Link href="/bank-balance" className="hover:text-foreground">Bank Balance</Link>
          <span aria-hidden>›</span>
          <Link href="/bank-balance/expenses" className="hover:text-foreground">Payments</Link>
          <span aria-hidden>›</span>
          <span className="text-foreground">New payment</span>
        </nav>

        {/* ── The banner ── */}
        <section className={cn(heroStyles.hero, 'keep-light flex flex-wrap items-center gap-4 p-5 sm:p-6')} data-tint="aurora">
          <span aria-hidden className={cn(heroStyles.glass, 'flex h-14 w-14 items-center justify-center rounded-2xl')}>
            <ArrowDown className="h-7 w-7 text-white" />
          </span>
          <div className="min-w-0 flex-1 basis-72">
            <h1 className="text-2xl font-extrabold tracking-tight">New payment voucher</h1>
            <p className={heroStyles.muted}>One voucher per cheque, e-cheque or transfer batch. Pay one or many requisitions, in full or in part.</p>
          </div>
          <div className={cn(heroStyles.glass, 'flex min-w-[130px] flex-1 flex-col rounded-2xl px-4 py-2.5 sm:flex-none')} title="The number this voucher should get. The final one is taken when it is issued.">
            <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>Next voucher no.</span>
            <b className={cn('mt-0.5 text-[15px] font-bold', nextNo && 'font-mono')}>{nextNo ?? 'Given on issue'}</b>
          </div>
          <div className={cn(heroStyles.glass, 'flex min-w-[100px] flex-1 flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
            <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>Payees</span>
            <b className="text-xl font-extrabold tabular-nums">{payeeLines.length}</b>
          </div>
          <div className={cn(heroStyles.glass, 'flex min-w-[120px] flex-1 flex-col rounded-2xl px-4 py-2.5 sm:flex-none')}>
            <span className={cn(heroStyles.muted, 'text-[11.5px] font-semibold')}>Total</span>
            <b className="text-xl font-extrabold tabular-nums">{compactInr(total)}</b>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-col">
            <Link href="/bank-balance/cheques" className={heroStyles.action}>
              <BookOpenCheck aria-hidden className="h-4 w-4" />
              Cheque register
            </Link>
            <Link href="/bank-balance/expenses" className={heroStyles.action}>
              <History aria-hidden className="h-4 w-4" />
              Payments
            </Link>
          </div>
        </section>

        {lastIssued && (
          <div
            ref={issuedRef}
            role="status"
            className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-100"
          >
            <div className="flex min-w-0 items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="font-semibold">
                  Voucher <span className="font-mono">{lastIssued.voucherNo}</span> issued
                </p>
                <p className="break-words text-sm opacity-90">
                  {formatInr(lastIssued.total)} to {lastIssued.payees} payee{lastIssued.payees === 1 ? '' : 's'} by {lastIssued.mode}
                  {lastIssued.instrumentNo ? ` ${lastIssued.instrumentNo}` : ''}
                  {lastIssued.postDated ? ` — post-dated to ${formatDay(lastIssued.instrumentDate)}` : ''}.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm">
                <Link href={voucherHref(lastIssued.id)}>
                  <BookOpenCheck className="mr-2 h-4 w-4" />
                  View in Cheque Register
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={voucherPrintHref(lastIssued.id)} target="_blank" rel="noopener noreferrer" prefetch={false}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print voucher
                </Link>
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Dismiss" onClick={() => setLastIssued(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {draft && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-100">
            <Info aria-hidden className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              A draft voucher with {draft.lines.length} payee{draft.lines.length === 1 ? '' : 's'} from {format(new Date(draft.savedAt), 'd MMM, HH:mm')} is saved in this browser.
            </span>
            <Button size="sm" variant="outline" onClick={restoreDraft}>Restore</Button>
            <Button size="sm" variant="ghost" onClick={discardDraft}>Discard</Button>
          </div>
        )}

        {preloadNote && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{preloadNote}</span>
            <button type="button" className="shrink-0 rounded p-0.5 hover:bg-amber-100" aria-label="Dismiss note" onClick={() => setPreloadNote('')}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-3.5">
            {/* ── Step 1: pay from ── */}
            <section className="rounded-[20px] border bg-card shadow-sm">
              <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3.5 sm:px-[18px]">
                <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-[12.5px] font-extrabold text-white">1</span>
                <div className="min-w-0">
                  <b className="block text-[15px] leading-tight text-foreground">Pay from</b>
                  <p className="text-xs text-muted-foreground">How the money leaves, and from which account</p>
                </div>
              </header>
              <div className="px-4 pb-[18px] pt-4 sm:px-[18px]">
                <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  {fc.label('mode')} <span className="text-destructive">*</span>
                </span>
                <div role="radiogroup" aria-label={fc.label('mode')} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-4">
                  {modes.map((m) => {
                    const Icon = ModeIcon(m);
                    const on = mode === m.mode;
                    return (
                      <button
                        key={m.mode}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setMode(m.mode)}
                        className={cn(
                          'flex min-w-0 items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 text-left transition hover:border-indigo-200',
                          on && 'border-violet-600 bg-violet-50 ring-[3px] ring-violet-600/15 dark:bg-violet-950/30',
                        )}
                      >
                        <Tile colours={modeTile(m)} size={34}>
                          <Icon className="h-[17px] w-[17px]" />
                        </Tile>
                        <span className="min-w-0">
                          <b className="block truncate text-[13.5px] text-foreground">{m.mode}</b>
                          <span className="block text-[11.5px] leading-snug text-muted-foreground">{MODE_NOTE[m.mode] ?? KIND_NOTE[m.kind]}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3.5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <AccountPicker
                    label={`${fc.label('accountId')} *`}
                    accounts={activeAccounts}
                    value={accountId}
                    onChange={setAccountId}
                    otherId=""
                    availableOf={availableOf}
                    effectOf={(id) => (id === accountId ? -total : 0)}
                    colourOf={colourOf}
                    invalid={err(headerErrors.account)}
                  />
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                    {showInstrumentNo && (
                      <label className="min-w-0">
                        <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                          {instrumentLabel}
                          {(cfg.instrumentRequired || mandatory.paymentRefNo) && <span className="text-destructive"> *</span>}
                        </span>
                        <Input
                          placeholder={cfg.kind === 'transfer' ? 'Bank batch / upload reference' : 'e.g. 000451'}
                          value={instrumentNo}
                          className={cn('h-10 rounded-xl font-mono', err(headerErrors.instrumentNo) && 'border-destructive', duplicateInstrument && 'border-amber-400')}
                          onChange={(e) => setInstrumentNo(e.target.value)}
                        />
                        <span className="mt-1 block text-[11.5px] text-muted-foreground">
                          {cfg.kind === 'transfer' ? (
                            'Can be filled in once the bank confirms the batch.'
                          ) : lastUsed ? (
                            <>
                              Last used on this account: <span className="font-mono">{lastUsed.instrumentNo}</span>
                              {suggested && suggested !== instrumentNo && (
                                <>
                                  {' · '}
                                  <button type="button" className="font-bold text-violet-700 hover:underline dark:text-violet-400" onClick={() => setInstrumentNo(suggested)}>
                                    use {suggested}
                                  </button>
                                </>
                              )}
                            </>
                          ) : account ? (
                            'No earlier voucher on this account and mode.'
                          ) : (
                            'Pick the account to see the last number it used.'
                          )}
                        </span>
                      </label>
                    )}
                    <label className="min-w-0">
                      <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                        {dateLabel} <span className="text-destructive">*</span>
                      </span>
                      <Input
                        type="date"
                        value={instrumentDate}
                        min={[accountStart ? format(accountStart, 'yyyy-MM-dd') : '', dateWindow.min ?? ''].sort().pop() || undefined}
                        max={cfg.allowsFutureDate ? dateWindow.max ?? undefined : dateWindow.max && dateWindow.max < today ? dateWindow.max : today}
                        className={cn('h-10 rounded-xl', (err(headerErrors.instrumentDate) || beforeOpening || (dateCheck && !dateCheck.ok)) && 'border-destructive')}
                        onChange={(e) => setInstrumentDate(e.target.value)}
                      />
                      <span className={cn('mt-1 block text-[11.5px] leading-snug', beforeOpening || (dateCheck && !dateCheck.ok) ? 'text-destructive' : 'text-muted-foreground')}>
                        {beforeOpening && account
                          ? `Before the account’s opening date, ${formatDay(account.openingDate)}.`
                          : dateCheck && !dateCheck.ok
                            ? dateCheck.reason
                            : controls.hintFor([accountId], { postDated: cfg.allowsFutureDate }) ?? (cfg.allowsFutureDate ? 'Can be post-dated.' : 'Up to today.')}
                      </span>
                    </label>
                  </div>
                </div>

                {(showRemarks || showTransferCopy) && (
                  <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {showRemarks && (
                      <label className="min-w-0">
                        <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                          {fc.label('remarks')}
                          {need('remarks') && <span className="text-destructive"> *</span>}
                        </span>
                        <Input
                          placeholder={need('remarks') ? 'Note on the voucher' : 'Optional note on the voucher'}
                          value={remarks}
                          className={cn('h-10 rounded-xl', err(headerErrors.remarks) && 'border-destructive')}
                          onChange={(e) => setRemarks(e.target.value)}
                        />
                      </label>
                    )}
                    {showTransferCopy && (
                      <div className="min-w-0">
                        <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                          {transferCopyLabel}
                          {mandatory.bankTransferCopy && <span className="text-destructive"> *</span>}
                        </span>
                        <FileCell id="pay-transfer-copy" label="Voucher copy" file={transferCopy} onChange={setTransferCopy} onTooLarge={tooLarge} invalid={err(headerErrors.transferCopy)} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* ── Step 2: payees ── */}
            <section className="rounded-[20px] border bg-card shadow-sm">
              <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3.5 sm:px-[18px]">
                <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-[12.5px] font-extrabold text-white">2</span>
                <div className="min-w-0 flex-1 basis-60">
                  <b className="block text-[15px] leading-tight text-foreground">Payees</b>
                  <p className="text-xs text-muted-foreground">Pick requisitions waiting for payment. Amount defaults to what is still due; lower it for a part payment.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                  onClick={() => setPickerOpen(true)}
                  disabled={payables.length === 0}
                >
                  <ListPlus className="mr-2 h-4 w-4" />
                  Add from requisitions
                  <span className="ml-1.5 rounded-full bg-violet-600 px-1.5 text-[11px] font-bold text-white">{waiting.length}</span>
                </Button>
              </header>

              {!showTable ? (
                <div className="px-4 py-9 text-center text-muted-foreground">
                  <span aria-hidden className="mx-auto mb-2.5 flex h-14 w-14 items-center justify-center rounded-[18px] bg-gradient-to-br from-violet-400 to-violet-700 text-white shadow-lg shadow-violet-600/30">
                    <Inbox className="h-[26px] w-[26px]" />
                  </span>
                  <b className="block text-[15px] text-foreground">No payees yet</b>
                  <p className="text-sm">
                    {waiting.length
                      ? `${waiting.length} requisition${waiting.length === 1 ? '' : 's'} (${compactInr(waitingTotal)}) ${waiting.length === 1 ? 'is' : 'are'} ready to pay.`
                      : 'No requisitions are waiting for payment.'}
                  </p>
                  {waiting.length > 0 && (
                    <Button className="mt-3" onClick={() => setPickerOpen(true)}>
                      <ListPlus className="mr-2 h-4 w-4" />
                      Pick requisitions
                    </Button>
                  )}
                </div>
              ) : (
                // From `sm` up a table that scrolls in its own box; on a phone each row stacks as a card.
                // One mount either way, so the inputs and file pickers are never rendered twice.
                <div className="min-w-0 sm:overflow-x-auto">
                  <table
                    className="w-full border-separate border-spacing-0 text-sm max-sm:block sm:min-w-[680px]"
                  >
                    <thead className="max-sm:hidden">
                      <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                        <th className="w-10 border-b bg-muted/40 py-2.5 pl-[18px] pr-2 font-bold">#</th>
                        <th className="w-[160px] border-b bg-muted/40 px-2.5 py-2.5 font-bold">
                          {fc.label('ref')}
                          {mandatory.paymentRequestRefNo && <span className="text-destructive"> *</span>}
                        </th>
                        <th className="border-b bg-muted/40 px-2.5 py-2.5 font-bold">
                          {fc.label('partyName')} <span className="text-destructive">*</span>
                          <span className="font-semibold normal-case tracking-normal"> &amp; </span>
                          {fc.label('description')} <span className="text-destructive">*</span>
                        </th>
                        <th className="w-24 border-b bg-muted/40 px-2.5 py-2.5 text-right font-bold">Due</th>
                        <th className="w-[150px] border-b bg-muted/40 px-2.5 py-2.5 text-right font-bold">
                          {fc.label('amount')} (₹) <span className="text-destructive">*</span>
                          {showUtr && (
                            <span className="block">
                              {fc.label('utr')}
                              {mandatory.utrNumber && <span className="text-destructive"> *</span>}
                            </span>
                          )}
                        </th>
                        <th className="w-12 border-b bg-muted/40 py-2.5 pl-2 pr-[18px]"><span className="sr-only">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody className="max-sm:block max-sm:space-y-3 max-sm:px-4 max-sm:pt-3">
                      {lines.map((line, index) => {
                        const e = lineErrors(line);
                        const payable = line.requisitionId ? payableById.get(line.requisitionId) : undefined;
                        const amount = amountOf(line);
                        const over = payable ? amount > payable.balance + 0.01 : false;
                        const part = payable && amount > 0 && amount < payable.balance - 0.01;
                        const days = payable ? waitingDays(payable.date) : null;
                        const rowBad = showErrors && Object.values(e).some(Boolean);
                        const cell = cn(
                          'border-b px-2.5 py-2.5 align-top max-sm:block max-sm:border-0 max-sm:px-0 max-sm:py-1',
                          rowBad && 'sm:bg-rose-50/60 sm:dark:bg-rose-950/20',
                        );
                        return (
                          <tr
                            key={line.id}
                            className={cn(
                              'max-sm:relative max-sm:block max-sm:rounded-2xl max-sm:border max-sm:p-3',
                              rowBad && 'max-sm:border-rose-300 max-sm:bg-rose-50/60 max-sm:dark:border-rose-800 max-sm:dark:bg-rose-950/20',
                            )}
                          >
                            <td className={cn(cell, 'pl-[18px] pt-4 font-bold text-muted-foreground max-sm:pt-0 max-sm:text-xs')}>
                              <span className="sm:hidden">Payee </span>
                              {index + 1}
                            </td>
                            <td className={cell}>
                              {phoneLabel(fc.label('ref'))}
                              {line.requisitionId ? (
                                <div className="min-w-0">
                                  <span className="flex items-center gap-1.5">
                                    <Link2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                    <b className="min-w-0 truncate font-mono text-xs text-foreground" title={line.ref}>{line.ref}</b>
                                    <button type="button" className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted" onClick={() => unlink(line)} aria-label={`Unlink ${line.ref}`}>
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </span>
                                  {line.projectName && (
                                    <span className="mt-1 inline-block max-w-full truncate rounded-md bg-sky-100 px-1.5 py-px text-[11px] font-bold text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" title={line.projectName}>
                                      {line.projectName}
                                    </span>
                                  )}
                                  {days !== null && (
                                    <span className={cn('mt-0.5 block text-[11px]', days > 90 ? 'font-bold text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
                                      Waiting {days} day{days === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <Input
                                    aria-label={`Row ${index + 1} reception no. or reference`}
                                    placeholder="Reception No. + Enter"
                                    value={line.ref}
                                    className={cn('h-9 rounded-lg font-mono text-[13px]', err(e.ref) && 'border-destructive')}
                                    onChange={(ev) => update(line.id, { ref: ev.target.value, refNote: undefined })}
                                    onBlur={() => lookup(line)}
                                    onKeyDown={(ev) => {
                                      if (ev.key === 'Enter') {
                                        ev.preventDefault();
                                        lookup(line);
                                      }
                                    }}
                                  />
                                  {line.refNote ? (
                                    <p className={cn('mt-1 text-[11px] leading-snug', allowDirect ? 'text-muted-foreground' : 'text-destructive')}>{line.refNote}</p>
                                  ) : (
                                    <span className="mt-1 inline-block rounded-md bg-amber-100 px-1.5 py-px text-[11px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">No requisition</span>
                                  )}
                                </>
                              )}
                              {/* The approval belongs with the requisition it approves — and keeps the table narrow enough to sit beside the summary. */}
                              {showApproval && (
                                <div className="mt-2">
                                  <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                                    {fc.label('approvalCopy')}
                                    {mandatory.approvalCopy && <span className="text-destructive"> *</span>}
                                  </span>
                                  <FileCell
                                    id={`approval-${line.id}`}
                                    label={`Row ${index + 1} approval copy`}
                                    file={line.approvalCopy}
                                    onChange={(file) => update(line.id, { approvalCopy: file })}
                                    onTooLarge={tooLarge}
                                    invalid={err(e.approval)}
                                  />
                                </div>
                              )}
                            </td>
                            <td className={cell}>
                              {phoneLabel(fc.label('partyName'))}
                              {line.requisitionId ? (
                                <b className="block truncate pb-0.5 pt-1.5 text-foreground" title={line.partyName}>{line.partyName || '—'}</b>
                              ) : (
                                <Input
                                  aria-label={`Row ${index + 1} payee`}
                                  placeholder="Payee / party"
                                  value={line.partyName}
                                  className={cn('h-9 rounded-lg', err(e.party) && 'border-destructive')}
                                  onChange={(ev) => update(line.id, { partyName: ev.target.value })}
                                />
                              )}
                              <span className="mt-2 block sm:hidden">{phoneLabel(fc.label('description'))}</span>
                              <Input
                                aria-label={`Row ${index + 1} description`}
                                placeholder="What the payment is for"
                                value={line.description}
                                className={cn('h-8 rounded-lg text-[13px] sm:mt-1.5', err(e.description) && 'border-destructive')}
                                onChange={(ev) => update(line.id, { description: ev.target.value })}
                              />
                            </td>
                            <td className={cn(cell, 'whitespace-nowrap pt-4 text-right font-semibold tabular-nums text-muted-foreground max-sm:pt-1 max-sm:text-left', !payable && 'max-sm:hidden')}>
                              {phoneLabel('Due')}
                              {payable ? (
                                <>
                                  {formatInr(payable.balance, 0)}
                                  {payable.status === 'Partially Paid' && <span className="block text-[10px] font-normal max-sm:inline max-sm:pl-1">of {formatInr(payable.netAmount, 0)}</span>}
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className={cn(cell, 'text-right max-sm:text-left')}>
                              {phoneLabel(`${fc.label('amount')} (₹)`)}
                              <div
                                className={cn(
                                  'flex items-center rounded-lg border bg-card px-2 focus-within:border-violet-600 focus-within:ring-[3px] focus-within:ring-violet-600/15',
                                  (over || err(e.amount)) && 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30',
                                )}
                              >
                                <span aria-hidden className="font-bold text-muted-foreground">₹</span>
                                <input
                                  aria-label={`Row ${index + 1} amount`}
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="any"
                                  placeholder="0"
                                  value={line.amount}
                                  className="w-full min-w-0 bg-transparent py-[7px] pl-1.5 text-right font-extrabold tabular-nums text-foreground outline-none"
                                  onChange={(ev) => update(line.id, { amount: ev.target.value })}
                                />
                              </div>
                              {payable && amount > 0 && (
                                <span
                                  className={cn(
                                    'mt-1 inline-block rounded-md px-1.5 py-px text-[11px] font-bold',
                                    over
                                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                                      : part
                                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                                  )}
                                >
                                  {over ? 'More than due' : part ? `Part · ${compactInr(payable.balance - amount)} left` : 'Full'}
                                </span>
                              )}
                              {/* Each payee of a transfer batch gets its own UTR from the bank. */}
                              {showUtr && (
                                <>
                                  <span className="mt-2 block sm:hidden">{phoneLabel(fc.label('utr'))}</span>
                                  <Input
                                    aria-label={`Row ${index + 1} UTR number`}
                                    placeholder={mandatory.utrNumber ? 'UTR *' : 'UTR'}
                                    value={line.utr}
                                    className={cn('h-8 rounded-lg font-mono text-[12.5px] sm:mt-1.5', err(e.utr) && 'border-destructive')}
                                    onChange={(ev) => update(line.id, { utr: ev.target.value })}
                                  />
                                </>
                              )}
                            </td>
                            <td className={cn(cell, 'pl-2 pr-[18px] max-sm:absolute max-sm:right-2 max-sm:top-2 max-sm:p-0')}>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-[30px] w-[30px] text-muted-foreground hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                                aria-label={`Remove row ${index + 1}`}
                                onClick={() => removeLine(line.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* A phone has the voucher total in the summary below; the per-column totals are for the table. */}
                    <tfoot className="max-sm:hidden">
                      <tr className="font-extrabold text-foreground">
                        <td className="bg-muted/40 pl-[18px]" />
                        <td colSpan={2} className="bg-muted/40 px-2.5 py-2.5">
                          Total · {payeeLines.length} payee{payeeLines.length === 1 ? '' : 's'}
                        </td>
                        <td className="bg-muted/40 px-2.5 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatInr(lines.reduce((sum, line) => sum + (line.requisitionId ? payableById.get(line.requisitionId)?.balance ?? 0 : 0), 0), 0)}
                        </td>
                        <td className="bg-muted/40 px-2.5 py-2.5 text-right tabular-nums">{formatInr(total)}</td>
                        <td className="bg-muted/40 pr-[18px]" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {messages.length > 0 && (
                <div className="space-y-2 px-4 pb-1 pt-3 sm:px-[18px]">
                  {messages.map((message) => (
                    <div
                      key={message.text}
                      className={cn(
                        'flex flex-wrap items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold',
                        message.tone === 'bad' && 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
                        message.tone === 'warn' && 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
                        message.tone === 'info' && 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
                      )}
                    >
                      {message.tone === 'bad' ? <X aria-hidden className="mt-px h-4 w-4 shrink-0" /> : message.tone === 'warn' ? <AlertTriangle aria-hidden className="mt-px h-4 w-4 shrink-0" /> : <Info aria-hidden className="mt-px h-4 w-4 shrink-0" />}
                      <span className="min-w-0 flex-1">{message.text}</span>
                      {message.action && (
                        <button type="button" className="shrink-0 font-extrabold underline" onClick={message.action.run}>{message.action.label}</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-[18px]">
                <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border bg-card px-2.5">
                  <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="sr-only">Add a requisition by Reception No.</span>
                  <input
                    value={quickRef}
                    onChange={(e) => setQuickRef(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        quickAdd();
                      }
                    }}
                    placeholder="Type a Reception No. and press Enter"
                    className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                  />
                </label>
                {allowDirect ? (
                  <Button type="button" variant="outline" onClick={addManual}>
                    <Plus className="mr-2 h-4 w-4" />
                    Payment without a requisition
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Payments without a requisition are switched off in Settings › Field Control › Payment options.</span>
                )}
              </div>
            </section>
          </div>

          {/* ── The voucher as a whole, and issuing it ── */}
          <aside className="min-w-0 overflow-hidden rounded-[20px] border bg-card shadow-sm xl:sticky xl:top-20">
            <header className="px-[18px] pb-2.5 pt-4">
              <p className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Voucher total</p>
              <p className="text-[30px] font-extrabold leading-tight tracking-tight tabular-nums text-foreground">{formatInr(total, total % 1 ? 2 : 0)}</p>
              <p className="text-xs text-muted-foreground">{total ? rupeesInWords(total) : 'Add a payee to begin'}</p>
            </header>
            <div className="border-t px-[18px] py-3">
              <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Funds on instrument date</h2>
              {account && funds ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <Tile colours={colourOf(account.id)} size={30} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[13px] text-foreground">{accountLabel(account)}</b>
                      <span className="block text-[11.5px] text-muted-foreground">{fundsLabel} {formatInr(funds.onDate, 0)}</span>
                    </span>
                    <span className={cn('shrink-0 text-right font-extrabold tabular-nums', overBy > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground')}>
                      {formatInr(remaining ?? 0, 0)}
                      <span className="block text-[11px] font-semibold text-muted-foreground">{funds.lowestAhead ? `left on ${formatDay(funds.lowestDay)}` : 'left after'}</span>
                    </span>
                  </div>
                  <div aria-hidden className="mt-2.5 h-2 overflow-hidden rounded bg-muted">
                    <div
                      className={cn('h-full rounded', overBy > 0 ? 'bg-rose-600' : 'bg-gradient-to-r from-violet-400 to-violet-600')}
                      style={{ width: `${funds.lowest > 0 ? Math.min(100, (total / funds.lowest) * 100) : total > 0 ? 100 : 0}%`, minWidth: total ? 3 : 0 }}
                    />
                  </div>
                  {funds.lowestAhead && (
                    <p className="mt-2 text-[11.5px] text-muted-foreground">
                      Post-dated cheques bring the account down to {formatInr(funds.lowest, 0)} on {formatDay(funds.lowestDay)}; the voucher has to fit under that.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">{account ? 'Pick a date on or after the account’s opening date.' : 'Select a bank account in step 1.'}</p>
              )}
            </div>

            {cfg.kind === 'cheque' && (
              <div className="border-t px-[18px] pb-4 pt-3">
                <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Cheque preview</h2>
                <div
                  className="keep-light relative overflow-hidden rounded-xl border border-indigo-200 px-3.5 py-3 text-[11px] text-slate-800"
                  style={{ background: 'repeating-linear-gradient(135deg, #ffffff00 0 8px, #ffffff55 8px 9px), linear-gradient(120deg, #e0f2fe, #ede9fe 60%, #fce7f3)' }}
                  aria-label="Cheque preview"
                >
                  <div className="flex items-start gap-2.5">
                    <span aria-hidden className="mt-1 shrink-0 -rotate-12 border-y-[1.5px] border-rose-700 px-1 text-[9px] font-extrabold leading-tight text-rose-700">A/c Payee</span>
                    <span className="min-w-0 flex-1 text-xs font-extrabold">
                      <span className="block truncate">{account?.bankName || 'Bank name'}</span>
                      <span className="block truncate text-[10px] font-semibold text-slate-500">{account?.branch ? `${account.branch} Branch` : 'Branch'}</span>
                    </span>
                    <span className="shrink-0 rounded border border-slate-400 bg-white/70 px-1.5 py-px font-mono text-[10.5px] tracking-[0.2em]">{dateDigits || 'DDMMYYYY'}</span>
                  </div>
                  <div className="mt-3.5 flex min-h-[20px] items-end gap-1.5 border-b border-slate-400 pb-px">
                    <span className="whitespace-nowrap text-[10px] text-slate-500">Pay</span>
                    <span className="truncate font-serif text-[15px] italic leading-none text-blue-900">{singlePayee || (payeeLines.length > 1 ? 'As per covering letter' : '')}</span>
                  </div>
                  <div className="mt-2.5 flex min-h-[20px] items-end gap-1.5 border-b border-slate-400 pb-px">
                    <span className="whitespace-nowrap text-[10px] text-slate-500">Rupees</span>
                    <span className="line-clamp-2 min-w-0 font-serif text-[12.5px] italic leading-tight text-blue-900">{chequeWords}</span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-[10px] tracking-[0.12em] text-slate-600">
                      {cfg.instrumentLabel} {instrumentNo.trim() || '——'}
                    </span>
                    <span className="shrink-0 rounded border-[1.5px] border-slate-500 bg-white px-2 py-0.5 text-[13px] font-extrabold tabular-nums">₹ {chequeFigure}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t px-[18px] py-3">
              <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Before you issue</h2>
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
            </div>
            <div className="flex flex-col gap-2 border-t px-[18px] pb-[18px] pt-3.5">
              <Button
                onClick={() => void issue()}
                disabled={issueBlocked}
                className="h-11 gap-2 border-0 bg-gradient-to-r from-teal-700 via-blue-600 to-violet-600 text-white shadow-md hover:opacity-95"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Issue voucher{payeeLines.length > 1 ? ` (${payeeLines.length} payees)` : ''}
                <span className="ml-1 hidden rounded border border-white/50 px-1 text-[10.5px] font-semibold opacity-85 sm:inline">Ctrl ↵</span>
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={saveDraft} disabled={isSaving || !lines.some(hasContent)}>
                  Save draft
                </Button>
                {lastIssued ? (
                  <Button asChild variant="outline" className="flex-1">
                    <Link href={voucherPrintHref(lastIssued.id)} target="_blank" rel="noopener noreferrer" prefetch={false}>
                      <Printer className="mr-1.5 h-4 w-4" />
                      Print voucher
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" className="flex-1" disabled title="Available once the voucher is issued">
                    <Printer className="mr-1.5 h-4 w-4" />
                    Print voucher
                  </Button>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ── Requisition picker ── */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent size="xl" className="hr-mobile-dialog gap-0 overflow-hidden p-0 sm:max-h-[90dvh]">
          <DialogHeader className="hr-dialog-header flex-row items-center gap-3 space-y-0 border-b px-[18px] py-4 pr-12 text-left">
            <Tile colours={['#fdba74', '#ea580c']} size={38}>
              <ListPlus className="h-[18px] w-[18px]" />
            </Tile>
            <div className="min-w-0">
              <DialogTitle>Requisitions waiting for payment</DialogTitle>
              <DialogDescription>Processed for Payment in Daily Requisition. Each is added for the amount still due.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 border-b px-[18px] py-2.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input aria-label="Search requisitions" placeholder="Search payee, project, reception no…" value={pickerSearch} className="pl-8" onChange={(e) => setPickerSearch(e.target.value)} />
            </div>
            <Select value={pickerProject} onValueChange={setPickerProject}>
              <SelectTrigger className="w-full sm:w-52" aria-label="Project"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  pickerRows.forEach((p) => {
                    if (!linkedIds.has(p.id)) next.add(p.id);
                  });
                  return next;
                })
              }
            >
              Select all
            </Button>
          </div>
          <div className="hr-dialog-body min-h-0 flex-1 overflow-y-auto p-0 sm:max-h-[55dvh]">
            {pickerRows.map((p) => {
              const onVoucher = linkedIds.has(p.id);
              const selected = picked.has(p.id);
              const days = waitingDays(p.date);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={onVoucher}
                  aria-pressed={selected}
                  onClick={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    })
                  }
                  className={cn(
                    'grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b px-[18px] py-2.5 text-left hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-45 sm:grid-cols-[28px_140px_minmax(0,1fr)_110px_100px]',
                    selected && 'bg-violet-50 dark:bg-violet-950/30',
                  )}
                >
                  <span aria-hidden className={cn('flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-2', selected ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300 dark:border-slate-600')}>
                    {selected && <Check className="h-[11px] w-[11px]" strokeWidth={3.2} />}
                  </span>
                  <span className="hidden min-w-0 sm:block">
                    <b className="block truncate font-mono text-xs text-foreground">{p.receptionNo}</b>
                    <span className={cn('block text-[11.5px]', days !== null && days > 90 ? 'font-bold text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
                      {days !== null ? `Waiting ${days} day${days === 1 ? '' : 's'}` : p.dateText}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <b className="block truncate text-[13px] text-foreground">{p.partyName || '—'}</b>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      <span className="font-mono sm:hidden">{p.receptionNo} · </span>
                      {p.projectName} · {p.description}
                    </span>
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:block">{onVoucher ? 'Already added' : p.status === 'Partially Paid' ? 'Part paid' : ''}</span>
                  <b className="text-right tabular-nums text-foreground">{formatInr(p.balance, 0)}</b>
                </button>
              );
            })}
            {pickerRows.length === 0 && <p className="px-[18px] py-10 text-center text-sm text-muted-foreground">No requisitions match.</p>}
          </div>
          <DialogFooter className="hr-dialog-footer items-center gap-2 border-t px-[18px] py-3 sm:justify-between">
            <p className="text-sm font-bold text-foreground">{picked.size ? `${picked.size} selected · ${formatInr(pickedTotal, 0)}` : 'Nothing selected'}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPickerOpen(false)}>Cancel</Button>
              <Button onClick={addPicked} disabled={picked.size === 0}>
                <ListPlus className="mr-2 h-4 w-4" />
                Add {picked.size || ''} selected
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The form reads ?requisitions= with useSearchParams, which needs a Suspense boundary above it. */
export default function NewPaymentPage() {
  return (
    <Suspense fallback={<BankPageSkeleton kpis={0} blocks={1} />}>
      <NewPaymentForm />
    </Suspense>
  );
}
