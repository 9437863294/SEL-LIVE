'use client';
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BookOpenCheck, CalendarClock, History, Link2, ListPlus, Search, Trash2, X } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, runTransaction, Timestamp, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { BANK_PAGE, BankAccessDenied, BankBalanceBackground, BankPageSkeleton, accountLabel } from '@/components/bank-balance/page-kit';
import { EntryCard, EntryFooter, EntryTable, FileCell, TD, TH, cellInput, fileSize, type FooterFigure, type FooterNote } from '@/components/bank-balance/entry-grid';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { balanceAt, buildLedger, formatDay, formatInr, isCashCredit, parseDay } from '@/lib/bank-balance-ledger';
import {
  applyPayment,
  modeConfig,
  nextVoucherNo,
  paymentModes,
  requisitionBalance,
  type BankPaymentVoucher,
  type RequisitionPaymentRef,
  type VoucherLine,
} from '@/lib/bank-payments';
import type { BankAccount, BankExpense, DailyRequisitionEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

type MandatoryField = 'paymentRequestRefNo' | 'utrNumber' | 'paymentMethod' | 'paymentRefNo' | 'approvalCopy' | 'bankTransferCopy';
type MandatoryFields = Record<MandatoryField, boolean>;

const NO_MANDATORY: MandatoryFields = {
  paymentRequestRefNo: false,
  utrNumber: false,
  paymentMethod: false,
  paymentRefNo: false,
  approvalCopy: false,
  bankTransferCopy: false,
};

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

/**
 * New Payment — a payment VOUCHER: one instrument (cheque, e-cheque, RTGS/NEFT batch, DD) drawn on
 * one bank account, paying one or many payees. Payees are picked from the Daily Requisitions
 * waiting for payment (or found by typing a Reception No.); each line may pay all or part of what
 * is still due. A cheque may be post-dated: it enters the balance from the date written on it.
 *
 * Saving writes the voucher, one bankExpenses Debit per line (dated on the instrument date) and the
 * requisitions' paid amounts in ONE transaction, re-reading each requisition first so two people
 * cannot pay the same balance twice. See src/lib/bank-payments.ts.
 */
export default function NewPaymentPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const canAdd = !authLoading && can('Add', 'Bank Balance.Expenses');

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
  const [mandatory, setMandatory] = useState<MandatoryFields>(NO_MANDATORY);
  const [customMethods, setCustomMethods] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Requisition picker.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerProject, setPickerProject] = useState('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [accountSnap, txnSnap, voucherSnap, reqSnap, projectSnap, settingsSnap, methodSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDocs(collection(db, 'bankExpenses')),
        getDocs(collection(db, 'bankPayments')),
        getDocs(query(collection(db, 'dailyRequisitions'), where('status', 'in', ['Received for Payment', 'Partially Paid']))),
        getDocs(collection(db, 'projects')),
        getDoc(doc(db, 'bankBalanceSettings', 'paymentEntry')),
        getDocs(collection(db, 'paymentMethods')),
      ]);
      const projectNames = new Map(projectSnap.docs.map((d) => [d.id, String(d.data().projectName ?? '')]));
      setAccounts(accountSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount)).sort((a, b) => accountLabel(a).localeCompare(accountLabel(b))));
      setTransactions(txnSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankExpense)));
      setVouchers(voucherSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankPaymentVoucher)));
      setPayables(
        reqSnap.docs
          .map((d) => {
            const entry = { id: d.id, ...d.data() } as DailyRequisitionEntry;
            return { ...entry, projectName: projectNames.get(entry.projectId) || '—', balance: requisitionBalance(entry), dateText: reqDateText(entry.date) };
          })
          .filter((entry) => entry.balance > 0)
          .sort((a, b) => (a.receptionNo || '').localeCompare(b.receptionNo || '')),
      );
      setMandatory({ ...NO_MANDATORY, ...(settingsSnap.exists() ? settingsSnap.data().mandatoryFields || {} : {}) });
      setCustomMethods(methodSnap.docs.map((d) => String(d.data().name ?? '')));
    } catch (error) {
      console.error('Error loading payment data:', error);
      toast({ title: 'Error', description: 'Failed to load accounts, requisitions and payment settings.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

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

  // Funds on the instrument date — everything already dated up to then, post-dated cheques included.
  const instrumentDay = useMemo(() => parseDay(instrumentDate), [instrumentDate]);
  const available = useMemo(() => {
    if (!account || !instrumentDay) return null;
    const figure = balanceAt(buildLedger(account, transactions), instrumentDay);
    return isCashCredit(account) ? getApplicableCcLimit(account, instrumentDay) - figure : figure;
  }, [account, transactions, instrumentDay]);

  const total = lines.reduce((sum, line) => sum + amountOf(line), 0);
  const remaining = available === null ? null : available - total;
  const overBy = remaining !== null && remaining < 0 ? -remaining : 0;

  const duplicateInstrument =
    instrumentNo.trim() && cfg.kind !== 'transfer'
      ? vouchers.find((v) => v.accountId === accountId && v.mode === mode && norm(v.instrumentNo) === norm(instrumentNo) && v.status !== 'Cancelled')
      : undefined;

  /** Why a line cannot be saved yet, per column. */
  const lineErrors = (line: Line) => {
    const payable = line.requisitionId ? payableById.get(line.requisitionId) : undefined;
    const amount = amountOf(line);
    return {
      ref: mandatory.paymentRequestRefNo && !line.ref.trim(),
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
  };

  const update = (id: string, patch: Partial<Line>) => setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  const removeLine = (id: string) =>
    setLines((prev) => {
      const rest = prev.filter((line) => line.id !== id);
      return rest.length ? rest : [newLine()];
    });

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

  const linkedIds = new Set(lines.map((line) => line.requisitionId).filter(Boolean) as string[]);

  /** Typing a Reception No. and leaving the cell (or Enter) links that requisition and fills the row. */
  const lookup = (line: Line) => {
    const code = norm(line.ref);
    if (!code || line.requisitionId) return;
    const match = payables.find((p) => norm(p.receptionNo) === code || (p.depNo && norm(p.depNo) === code));
    if (!match) {
      update(line.id, { refNote: 'No requisition waiting for payment has this number — kept as a plain reference.' });
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
    if (available !== null && total > available) {
      toast({ title: 'Insufficient funds', description: `The voucher totals ${formatInr(total)}; ${accountLabel(account)} has ${formatInr(available)} available on ${formatDay(instrumentDate)}.`, variant: 'destructive' });
      return;
    }

    const day = instrumentDay;
    setIsSaving(true);
    try {
      const voucherRef = doc(collection(db, 'bankPayments'));
      const counterRef = doc(db, 'bankBalanceCounters', 'paymentVoucher');
      const stamp = Date.now();

      // 1) Uploads first — Storage is outside the transaction.
      const transferCopyUrl = transferCopy
        ? await (async () => {
            const fileRef = ref(storage, `bank-payments/${voucherRef.id}/${stamp}-transfer-${transferCopy.name}`);
            await uploadBytes(fileRef, transferCopy);
            return getDownloadURL(fileRef);
          })()
        : '';
      const approvalUrls = await Promise.all(
        lines.map(async (line) => {
          if (!line.approvalCopy) return '';
          const fileRef = ref(storage, `bank-payments/${voucherRef.id}/${line.id}-approval-${line.approvalCopy.name}`);
          await uploadBytes(fileRef, line.approvalCopy);
          return getDownloadURL(fileRef);
        }),
      );

      // 2) One transaction: re-read every requisition and the counter, then write everything.
      const voucherNo = await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const reqRefs = lines.filter((l) => l.requisitionId).map((l) => doc(db, 'dailyRequisitions', l.requisitionId as string));
        const reqSnaps = await Promise.all(reqRefs.map((r) => tx.get(r)));
        const reqById = new Map(reqSnaps.map((snap) => [snap.id, snap]));

        const { voucherNo: number, counter } = nextVoucherNo(counterSnap.exists() ? (counterSnap.data() as { fy?: string; next?: number }) : undefined, today);
        const instrumentTs = Timestamp.fromDate(day);

        const voucherLines: VoucherLine[] = [];
        const reqUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];

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
            const paymentRef: RequisitionPaymentRef = {
              bankPaymentId: voucherRef.id,
              voucherNo: number,
              lineId: line.id,
              amount,
              mode,
              instrumentNo: instrumentNo.trim(),
              instrumentDate,
              accountId,
            };
            const next = applyPayment(req, paymentRef); // throws if more than the balance
            reqUpdates.push({
              id: line.requisitionId,
              data: { ...next, lastPaidAt: Timestamp.now(), ...(next.status === 'Paid' ? { paidAt: Timestamp.now() } : {}) },
            });
          }

          const expense: Omit<BankExpense, 'id'> = {
            date: instrumentTs,
            accountId,
            description: party && !description.toLowerCase().includes(party.toLowerCase()) ? `${party} — ${description}` : description,
            amount,
            type: 'Debit',
            isContra: false,
            paymentRequestRefNo: line.ref.trim(),
            utrNumber: line.utr.trim(),
            paymentMethod: mode,
            paymentRefNo: instrumentNo.trim(),
            approvalCopyUrl: approvalUrls[index],
            bankTransferCopyUrl: transferCopyUrl,
            bankPaymentId: voucherRef.id,
            ...(line.requisitionId ? { requisitionId: line.requisitionId } : {}),
            createdAt: Timestamp.now(),
          };
          tx.set(expenseRef, expense);

          voucherLines.push({
            lineId: line.id,
            ...(line.requisitionId ? { requisitionId: line.requisitionId } : {}),
            receptionNo: line.ref.trim(),
            partyName: party,
            ...(line.projectId ? { projectId: line.projectId, projectName: line.projectName || '' } : {}),
            description,
            amount,
            utrNumber: line.utr.trim(),
            approvalCopyUrl: approvalUrls[index],
            expenseId: expenseRef.id,
          });
        });

        const voucher: Omit<BankPaymentVoucher, 'id'> & { createdAt: Timestamp } = {
          voucherNo: number,
          mode,
          accountId,
          instrumentNo: instrumentNo.trim(),
          instrumentDate,
          issueDate: today,
          lines: voucherLines,
          total: Math.round(total * 100) / 100,
          status: 'Issued',
          transferCopyUrl,
          remarks: remarks.trim(),
          createdById: user?.id || '',
          createdByName: user?.name || '',
          createdAt: Timestamp.now(),
        };
        tx.set(voucherRef, voucher);
        reqUpdates.forEach(({ id, data }) => tx.update(doc(db, 'dailyRequisitions', id), data));
        tx.set(counterRef, counter);
        return number;
      });

      toast({
        title: `Voucher ${voucherNo} issued`,
        description: `${lines.length} payment${lines.length === 1 ? '' : 's'} of ${formatInr(total)} by ${mode}${instrumentNo ? ` ${instrumentNo}` : ''}${
          postDated ? ` — post-dated to ${formatDay(instrumentDate)}` : ''
        }.`,
      });
      // Keep the account and mode for the next voucher; clear the rest.
      setLines([newLine()]);
      setInstrumentNo('');
      setRemarks('');
      setTransferCopy(null);
      setShowErrors(false);
      void load();
    } catch (error) {
      console.error('Error issuing payment voucher:', error);
      toast({ title: 'Voucher not saved', description: error instanceof Error ? error.message : 'Nothing was saved. Please try again.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || (isLoading && canAdd)) return <BankPageSkeleton kpis={0} blocks={1} />;
  if (!canAdd) return <BankAccessDenied title="New Payment" backHref="/bank-balance/expenses" backLabel="Back to payments" what="the payment entry form" />;

  const err = (flag: boolean | undefined) => Boolean(showErrors && flag);
  const projects = [...new Map(payables.map((p) => [p.projectId, p.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const pickerRows = payables.filter((p) => {
    if (pickerProject !== 'all' && p.projectId !== pickerProject) return false;
    const q = norm(pickerSearch);
    return !q || [p.receptionNo, p.depNo, p.partyName, p.description, p.projectName].some((field) => norm(field).includes(q));
  });
  const pickedTotal = payables.filter((p) => picked.has(p.id)).reduce((sum, p) => sum + p.balance, 0);

  const figures: FooterFigure[] = [
    ...(available !== null ? [{ label: `${account && isCashCredit(account) ? 'Available limit' : 'Available balance'} on ${formatDay(instrumentDate)}`, value: formatInr(available) }] : []),
    { label: `Voucher total (${lines.length} payee${lines.length === 1 ? '' : 's'})`, value: formatInr(total) },
    ...(remaining !== null ? [{ label: 'Left after this voucher', value: formatInr(remaining), tone: overBy > 0 ? ('bad' as const) : ('good' as const) }] : []),
  ];

  const notes: FooterNote[] = [];
  if (overBy > 0) notes.push({ tone: 'error', text: `Over the funds available on ${formatDay(instrumentDate)} by ${formatInr(overBy)}.` });
  if (showErrors && incomplete.length)
    notes.push({ tone: 'error', text: `Incomplete rows (marked in red): ${incomplete.map((line) => lines.indexOf(line) + 1).join(', ')}.` });
  if (duplicateInstrument)
    notes.push({ tone: 'warning', text: `${cfg.instrumentLabel} ${instrumentNo} is already on voucher ${duplicateInstrument.voucherNo} (${formatDay(duplicateInstrument.instrumentDate)}) for this account.` });
  if (!accountId) notes.push({ tone: 'warning', text: 'Pick the bank account to see the funds available on the instrument date.' });

  return (
    <>
      <BankBalanceBackground tone="red" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="New Payment"
          description="One voucher per cheque, e-cheque or transfer batch — pay one or many requisitions, in full or in part."
          backHref="/bank-balance/expenses"
          backLabel="Back to payments"
          actions={
            <>
              <Button asChild variant="outline">
                <Link href="/bank-balance/cheques">
                  <BookOpenCheck className="mr-2 h-4 w-4" />
                  Cheque Register
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/bank-balance/expenses">
                  <History className="mr-2 h-4 w-4" />
                  Payments
                </Link>
              </Button>
            </>
          }
        />

        <EntryCard>
          {/* The instrument */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="pay-mode">Payment mode<span className="text-destructive"> *</span></Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger id="pay-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modes.map((m) => (
                    <SelectItem key={m.mode} value={m.mode}>
                      {m.mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-bank">Bank account<span className="text-destructive"> *</span></Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="pay-bank" className={cn(err(headerErrors.account) && 'border-destructive')}>
                  <SelectValue placeholder={activeAccounts.length ? 'Select a bank account' : 'No active accounts'} />
                </SelectTrigger>
                <SelectContent>
                  {activeAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountLabel(a)} — {a.bankName}
                      {isCashCredit(a) ? ' (CC)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-instrument">
                {cfg.instrumentLabel}
                {(cfg.instrumentRequired || mandatory.paymentRefNo) && <span className="text-destructive"> *</span>}
              </Label>
              <Input
                id="pay-instrument"
                placeholder={cfg.kind === 'transfer' ? 'Bank batch / upload reference' : 'e.g. 000451'}
                value={instrumentNo}
                className={cn('font-mono', err(headerErrors.instrumentNo) && 'border-destructive', duplicateInstrument && 'border-amber-400')}
                onChange={(e) => setInstrumentNo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">
                {cfg.kind === 'cheque' ? 'Cheque date' : cfg.kind === 'draft' ? 'DD date' : 'Transfer date'}
                <span className="text-destructive"> *</span>
              </Label>
              <Input
                id="pay-date"
                type="date"
                value={instrumentDate}
                max={cfg.allowsFutureDate ? undefined : today}
                className={cn(err(headerErrors.instrumentDate) && 'border-destructive')}
                onChange={(e) => setInstrumentDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pay-remarks">Remarks</Label>
              <Input id="pay-remarks" placeholder="Optional note on the voucher" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2 xl:col-span-1">
              <Label htmlFor="pay-transfer-copy">
                {cfg.kind === 'transfer' ? 'Bank advice / upload file' : 'Cheque / covering letter copy'}
                {mandatory.bankTransferCopy && <span className="text-destructive"> *</span>}
              </Label>
              <FileCell
                id="pay-transfer-copy"
                label="Voucher copy"
                file={transferCopy}
                onChange={setTransferCopy}
                onTooLarge={tooLarge}
                invalid={err(headerErrors.transferCopy)}
              />
            </div>
          </div>

          {postDated && (
            <p className="flex items-start gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
              Post-dated {mode.toLowerCase()} — it enters the balance on {formatDay(instrumentDate)}. Until then the Cheque Register lists it as
              post-dated, and today&apos;s balance is unaffected.
            </p>
          )}

          {/* Payees */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">Payees</p>
              <p className="text-xs text-muted-foreground">
                Pick requisitions waiting for payment, or type a Reception No. in the first column. Amount defaults to what is still due; lower it
                for a part payment.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => setPickerOpen(true)} disabled={payables.length === 0}>
              <ListPlus className="mr-2 h-4 w-4" />
              Add from requisitions ({payables.filter((p) => !linkedIds.has(p.id)).length})
            </Button>
          </div>

          <EntryTable
            minWidth={cfg.utrPerLine ? 1420 : 1260}
            head={
              <tr>
                <TH className="w-10">#</TH>
                <TH className="w-52" required={mandatory.paymentRequestRefNo}>
                  Requisition / Ref
                </TH>
                <TH className="w-48" required>
                  Payee
                </TH>
                <TH className="w-36">Project</TH>
                <TH required>Description</TH>
                <TH className="w-32 text-right">Due</TH>
                <TH className="w-36 text-right" required>
                  Amount (₹)
                </TH>
                {cfg.utrPerLine && (
                  <TH className="w-44" required={mandatory.utrNumber}>
                    UTR No.
                  </TH>
                )}
                <TH className="w-32" required={mandatory.approvalCopy}>
                  Approval
                </TH>
                <TH className="w-10">
                  <span className="sr-only">Remove</span>
                </TH>
              </tr>
            }
            foot={
              <tr>
                <TD />
                <TD />
                <TD />
                <TD />
                <TD className="py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total</TD>
                <TD />
                <TD className="py-2.5 text-right font-bold tabular-nums">{formatInr(total)}</TD>
                {cfg.utrPerLine && <TD />}
                <TD />
                <TD />
              </tr>
            }
          >
            {lines.map((line, index) => {
              const e = lineErrors(line);
              const payable = line.requisitionId ? payableById.get(line.requisitionId) : undefined;
              const amount = amountOf(line);
              const partial = payable && amount > 0 && amount < payable.balance - 0.01;
              return (
                <tr key={line.id} className="bg-background/60">
                  <TD className="pt-4 text-xs font-semibold text-muted-foreground">{index + 1}</TD>
                  <TD>
                    {line.requisitionId ? (
                      <div className="flex h-9 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 pl-2 pr-1 text-emerald-800">
                        <Link2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium" title={line.ref}>
                          {line.ref}
                        </span>
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => unlink(line)} aria-label={`Unlink ${line.ref}`}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Input
                          aria-label={`Row ${index + 1} reception no. or reference`}
                          placeholder="Reception No. + Enter"
                          value={line.ref}
                          className={cn(cellInput(err(e.ref)), 'font-mono')}
                          onChange={(ev) => update(line.id, { ref: ev.target.value, refNote: undefined })}
                          onBlur={() => lookup(line)}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') {
                              ev.preventDefault();
                              lookup(line);
                            }
                          }}
                        />
                        {line.refNote && <p className="mt-1 text-[11px] leading-snug text-amber-700">{line.refNote}</p>}
                      </>
                    )}
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Row ${index + 1} payee`}
                      placeholder="Payee / party"
                      value={line.partyName}
                      readOnly={!!line.requisitionId}
                      className={cn(cellInput(err(e.party)), line.requisitionId && 'bg-muted/40')}
                      onChange={(ev) => update(line.id, { partyName: ev.target.value })}
                    />
                  </TD>
                  <TD className="pt-4 text-xs text-muted-foreground">
                    <span className="line-clamp-2">{line.projectName || '—'}</span>
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Row ${index + 1} description`}
                      placeholder="What the payment is for"
                      value={line.description}
                      className={cellInput(err(e.description))}
                      onChange={(ev) => update(line.id, { description: ev.target.value })}
                    />
                  </TD>
                  <TD className="pt-4 text-right text-xs tabular-nums text-muted-foreground">
                    {payable ? (
                      <>
                        {formatInr(payable.balance)}
                        {payable.status === 'Partially Paid' && <span className="block text-[10px]">of {formatInr(payable.netAmount)}</span>}
                      </>
                    ) : (
                      '—'
                    )}
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Row ${index + 1} amount`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      placeholder="0.00"
                      value={line.amount}
                      className={cn(cellInput(err(e.amount) || (payable ? amount > payable.balance + 0.01 : false)), 'text-right tabular-nums')}
                      onChange={(ev) => update(line.id, { amount: ev.target.value })}
                    />
                    {payable && amount > payable.balance + 0.01 && <p className="mt-1 text-right text-[11px] text-destructive">More than due</p>}
                    {partial && <p className="mt-1 text-right text-[11px] text-sky-700">Part payment</p>}
                  </TD>
                  {cfg.utrPerLine && (
                    <TD>
                      <Input
                        aria-label={`Row ${index + 1} UTR number`}
                        placeholder="UTR"
                        value={line.utr}
                        className={cn(cellInput(err(e.utr)), 'font-mono')}
                        onChange={(ev) => update(line.id, { utr: ev.target.value })}
                      />
                    </TD>
                  )}
                  <TD>
                    <FileCell
                      id={`approval-${line.id}`}
                      label={`Row ${index + 1} approval copy`}
                      file={line.approvalCopy}
                      onChange={(file) => update(line.id, { approvalCopy: file })}
                      onTooLarge={tooLarge}
                      invalid={err(e.approval)}
                    />
                  </TD>
                  <TD>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive hover:text-destructive"
                      aria-label={`Remove row ${index + 1}`}
                      onClick={() => removeLine(line.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TD>
                </tr>
              );
            })}
          </EntryTable>

          <EntryFooter
            addLabel="Add manual row"
            onAdd={() => setLines((prev) => [...prev, newLine()])}
            figures={figures}
            notes={notes}
            saveLabel={`Issue Voucher${lines.length > 1 ? ` (${lines.length} payees)` : ''}`}
            saving={isSaving}
            saveDisabled={activeAccounts.length === 0 || overBy > 0}
            onSave={() => void handleSave()}
          />
        </EntryCard>
      </div>

      {/* Requisition picker */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="hr-mobile-dialog gap-4 sm:max-h-[90dvh] sm:max-w-5xl">
          <DialogHeader className="hr-dialog-header pr-8">
            <DialogTitle>Requisitions waiting for payment</DialogTitle>
            <DialogDescription>From Daily Requisition → Processed for Payment. Each is added for the amount still due.</DialogDescription>
          </DialogHeader>
          <div className="hr-dialog-body flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Search requisitions"
                  placeholder="Search reception no., party, description…"
                  value={pickerSearch}
                  className="pl-8"
                  onChange={(e) => setPickerSearch(e.target.value)}
                />
              </div>
              <Select value={pickerProject} onValueChange={setPickerProject}>
                <SelectTrigger className="sm:w-56" aria-label="Project">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {projects.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border sm:max-h-[55dvh]">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        aria-label="Select all shown"
                        checked={pickerRows.length > 0 && pickerRows.every((p) => linkedIds.has(p.id) || picked.has(p.id))}
                        onCheckedChange={(checked) =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            pickerRows.forEach((p) => {
                              if (linkedIds.has(p.id)) return;
                              if (checked === true) next.add(p.id);
                              else next.delete(p.id);
                            });
                            return next;
                          })
                        }
                      />
                    </th>
                    <th className="px-2 py-2">Reception No.</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Project</th>
                    <th className="px-2 py-2">Party</th>
                    <th className="px-2 py-2 text-right">Net</th>
                    <th className="px-3 py-2 text-right">Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pickerRows.map((p) => {
                    const onVoucher = linkedIds.has(p.id);
                    return (
                      <tr
                        key={p.id}
                        className={cn('cursor-pointer hover:bg-muted/40', onVoucher && 'cursor-default opacity-50')}
                        onClick={() => {
                          if (onVoucher) return;
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.id)) next.delete(p.id);
                            else next.add(p.id);
                            return next;
                          });
                        }}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Select ${p.receptionNo}`}
                            disabled={onVoucher}
                            checked={onVoucher || picked.has(p.id)}
                            onCheckedChange={(checked) =>
                              setPicked((prev) => {
                                const next = new Set(prev);
                                if (checked === true) next.add(p.id);
                                else next.delete(p.id);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-xs font-medium">{p.receptionNo}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-xs">{p.dateText}</td>
                        <td className="max-w-[12rem] truncate px-2 py-2 text-xs" title={p.projectName}>
                          {p.projectName}
                        </td>
                        <td className="max-w-[14rem] px-2 py-2">
                          <span className="block truncate font-medium" title={p.partyName}>
                            {p.partyName || '—'}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground" title={p.description}>
                            {p.description}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatInr(p.netAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                          {formatInr(p.balance)}
                          {p.status === 'Partially Paid' && <span className="block text-[10px] font-normal text-sky-700">part paid</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {pickerRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                        No requisitions match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter className="hr-dialog-footer items-center gap-2 sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {picked.size} selected · {formatInr(pickedTotal)}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPickerOpen(false)}>
                Cancel
              </Button>
              <Button onClick={addPicked} disabled={picked.size === 0}>
                <ListPlus className="mr-2 h-4 w-4" />
                Add {picked.size || ''} to voucher
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
