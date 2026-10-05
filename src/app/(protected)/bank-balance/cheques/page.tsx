'use client';
export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Ban, BookOpenCheck, CalendarClock, CheckCircle2, Eye, Loader2, Plus, Printer, RefreshCw, Undo2, Wallet } from 'lucide-react';
import { collection, deleteField, doc, getDocs, runTransaction, Timestamp } from 'firebase/firestore';
import { format, startOfMonth } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { BANK_PAGE, BankAccessDenied, BankBalanceBackground, BankPageSkeleton, accountLabel } from '@/components/bank-balance/page-kit';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { formatDay, formatInr } from '@/lib/bank-balance-ledger';
import {
  CHEQUE_VALIDITY_MONTHS,
  canBounce,
  displayStatus,
  instrumentKey,
  isPaymentStageStatus,
  modeConfig,
  reversePayment,
  type BankPaymentVoucher,
  type PayableRequisition,
  type VoucherDisplayStatus,
} from '@/lib/bank-payments';
import { requisitionHref } from '@/lib/requisition-progress';
import type { BankAccount, DailyRequisitionEntry } from '@/lib/types';

const STATUS_TONE: Record<VoucherDisplayStatus, StatusTone> = {
  'Post-dated': 'info',
  Issued: 'progress',
  Stale: 'warning',
  Cleared: 'success',
  Cancelled: 'neutral',
  Bounced: 'danger',
};

type Closing = { voucher: BankPaymentVoucher; action: 'Cancelled' | 'Bounced' };

/** A linked requisition that got its money back but kept the status Daily Requisition had given it. */
type KeptStatus = { receptionNo: string; status: string };

const todayKey = () => format(new Date(), 'yyyy-MM-dd');

/** The printable A4 voucher, opened in a new tab from the View dialog. */
const printHref = (voucherId: string) => `/bank-balance/cheques/${encodeURIComponent(voucherId)}/print`;

/**
 * Reads `?voucher=<id>` — the link other modules build with `voucherHref` — and hands the id up.
 * A component of its own so the Suspense boundary `useSearchParams` asks for wraps only this, not
 * the register.
 */
function VoucherDeepLink({ onOpen }: { onOpen: (voucherId: string) => void }) {
  const voucherId = useSearchParams().get('voucher');
  useEffect(() => {
    if (voucherId) onOpen(voucherId);
  }, [voucherId, onOpen]);
  return null;
}

/**
 * Cheque Register — every payment voucher (cheque, e-cheque, RTGS/NEFT batch, DD) with its status:
 * post-dated until its date, issued, stale once a cheque is more than three months past its date
 * uncleared, cleared, cancelled or bounced.
 *
 * Clearing stamps the voucher and its bankExpenses Debits (the balance already moved on the
 * instrument date). Cancelling or recording a bounce reverses it in one transaction: its Debits are
 * removed and every linked Daily Requisition gets the amount back — its status recomputed only while
 * it is still in the payment stage, so one cancelled or sent back meanwhile keeps that status.
 * Cancelling also frees the instrument number for reuse; a bounced leaf stays used. Only an issued
 * cheque or DD can bounce — once the bank has paid it (cleared) it cannot.
 *
 * `?voucher=<id>` opens that voucher.
 */
export default function ChequeRegisterPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.Expenses');
  const canAdd = !authLoading && can('Add', 'Bank Balance.Expenses');
  const canDelete = !authLoading && can('Delete', 'Bank Balance.Expenses');

  const [vouchers, setVouchers] = useState<BankPaymentVoucher[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | VoucherDisplayStatus | 'open'>('open');
  const [modeFilter, setModeFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');

  const [viewing, setViewing] = useState<BankPaymentVoucher | null>(null);
  const [pendingVoucherId, setPendingVoucherId] = useState<string | null>(null);
  const [clearing, setClearing] = useState<BankPaymentVoucher | null>(null);
  const [clearDate, setClearDate] = useState('');
  const [closing, setClosing] = useState<Closing | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const [voucherSnap, accountSnap] = await Promise.all([getDocs(collection(db, 'bankPayments')), getDocs(collection(db, 'bankAccounts'))]);
        setVouchers(
          voucherSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as BankPaymentVoucher))
            .sort((a, b) => (b.instrumentDate || '').localeCompare(a.instrumentDate || '') || (b.voucherNo || '').localeCompare(a.voucherNo || '')),
        );
        setAccounts(accountSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount)));
      } catch (error) {
        console.error('Error loading the cheque register:', error);
        toast({ title: 'Error', description: 'Failed to load payment vouchers.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (authLoading) return;
    if (canView) void load();
    else setIsLoading(false);
  }, [authLoading, canView, load]);

  // A deep link opens its voucher once the register has loaded — once: closing it keeps it closed.
  useEffect(() => {
    if (!pendingVoucherId || isLoading) return;
    const target = vouchers.find((v) => v.id === pendingVoucherId);
    setPendingVoucherId(null);
    if (target) setViewing(target);
    else toast({ title: 'Voucher not found', description: 'The payment voucher this link points to no longer exists.', variant: 'destructive' });
  }, [pendingVoucherId, isLoading, vouchers, toast]);

  const today = todayKey();
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const statusOf = (v: BankPaymentVoucher) => displayStatus(v, today);
  /** Only an issued cheque or DD that has reached its date can come back unpaid. */
  const bounceable = (v: BankPaymentVoucher) => v.status === 'Issued' && v.instrumentDate <= today && canBounce(v.mode);

  const summary = useMemo(() => {
    const postDated = vouchers.filter((v) => displayStatus(v, today) === 'Post-dated');
    const issued = vouchers.filter((v) => {
      const status = displayStatus(v, today);
      return status === 'Issued' || status === 'Stale';
    });
    const stale = issued.filter((v) => displayStatus(v, today) === 'Stale');
    const clearedThisMonth = vouchers.filter((v) => v.status === 'Cleared' && (v.clearedDate || '') >= monthStart);
    const closedThisMonth = vouchers.filter((v) => (v.status === 'Cancelled' || v.status === 'Bounced') && (v.closedAt || '') >= monthStart);
    const sum = (list: BankPaymentVoucher[]) => list.reduce((s, v) => s + (Number(v.total) || 0), 0);
    const nextDue = [...postDated].sort((a, b) => a.instrumentDate.localeCompare(b.instrumentDate))[0];
    return { postDated, issued, stale, clearedThisMonth, closedThisMonth, sum, nextDue };
  }, [vouchers, today, monthStart]);

  const modes = useMemo(() => [...new Set(vouchers.map((v) => v.mode))].sort(), [vouchers]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vouchers.filter((v) => {
      const status = displayStatus(v, today);
      if (statusFilter === 'open' && !(status === 'Post-dated' || status === 'Issued' || status === 'Stale')) return false;
      if (statusFilter !== 'all' && statusFilter !== 'open' && status !== statusFilter) return false;
      if (modeFilter !== 'all' && v.mode !== modeFilter) return false;
      if (accountFilter !== 'all' && v.accountId !== accountFilter) return false;
      if (!q) return true;
      return [v.voucherNo, v.instrumentNo, ...(v.lines || []).flatMap((l) => [l.partyName, l.receptionNo, l.utrNumber, l.description])]
        .some((field) => (field || '').toLowerCase().includes(q));
    });
  }, [vouchers, search, statusFilter, modeFilter, accountFilter, today]);

  const handleClear = async () => {
    if (!clearing || !canAdd || !clearDate) return;
    const day = todayKey();
    if (clearing.instrumentDate > day) {
      toast({ title: 'Not yet due', description: `This cheque is dated ${formatDay(clearing.instrumentDate)} and cannot clear before then.`, variant: 'destructive' });
      return;
    }
    if (clearDate < clearing.instrumentDate) {
      toast({ title: 'Check the date', description: `A cheque dated ${formatDay(clearing.instrumentDate)} cannot clear before that date.`, variant: 'destructive' });
      return;
    }
    if (clearDate > day) {
      toast({ title: 'Check the date', description: 'The clearing date cannot be in the future.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const result = await runTransaction(db, async (tx) => {
        const ref = doc(db, 'bankPayments', clearing.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('This voucher no longer exists.');
        const current = { id: snap.id, ...snap.data() } as BankPaymentVoucher;
        if (current.status !== 'Issued') throw new Error(`This voucher is no longer open — it is ${current.status.toLowerCase()}.`);
        if (current.instrumentDate > day) throw new Error(`It is dated ${formatDay(current.instrumentDate)} and cannot clear before then.`);
        if (clearDate < current.instrumentDate) throw new Error(`A cheque dated ${formatDay(current.instrumentDate)} cannot clear before that date.`);

        // Every read before any write: each line's bank entry is stamped with the clearing date too.
        const expenseSnaps = await Promise.all(
          (current.lines || []).filter((line) => line.expenseId).map((line) => tx.get(doc(db, 'bankExpenses', line.expenseId))),
        );
        expenseSnaps.forEach((expenseSnap) => {
          if (expenseSnap.exists()) tx.update(expenseSnap.ref, { clearedDate: clearDate });
        });
        tx.update(ref, { status: 'Cleared', clearedDate: clearDate, clearedById: user?.id || '', clearedByName: user?.name || '' });
        return { voucherNo: current.voucherNo, missing: expenseSnaps.filter((expenseSnap) => !expenseSnap.exists()).length };
      });
      toast({
        title: 'Cleared',
        description: `${result.voucherNo} marked cleared on ${formatDay(clearDate)}.${
          result.missing ? ` ${result.missing} of its bank entr${result.missing === 1 ? 'y was' : 'ies were'} missing and could not be stamped.` : ''
        }`,
      });
      void log(
        'Clear Payment Voucher',
        {
          voucherNo: result.voucherNo,
          mode: clearing.mode || '',
          instrumentNo: clearing.instrumentNo || '',
          instrumentDate: clearing.instrumentDate || '',
          accountId: clearing.accountId || '',
          amount: Number(clearing.total) || 0,
          clearedDate: clearDate,
        },
        { recordId: clearing.id, recordRef: result.voucherNo },
      );
      setClearing(null);
      void load(true);
    } catch (error) {
      toast({ title: 'Not updated', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (!closing || !canDelete) return;
    const why = reason.trim();
    if (!why) {
      toast({ title: 'Reason needed', description: 'Say why the voucher is being cancelled or bounced.', variant: 'destructive' });
      return;
    }
    const { voucher, action } = closing;
    const day = todayKey();
    setBusy(true);
    try {
      const result = await runTransaction(db, async (tx) => {
        const voucherRef = doc(db, 'bankPayments', voucher.id);
        const snap = await tx.get(voucherRef);
        if (!snap.exists()) throw new Error('This voucher no longer exists.');
        const current = { id: snap.id, ...snap.data() } as BankPaymentVoucher;
        if (current.status === 'Cleared') {
          throw new Error('The bank has already paid this voucher (it is cleared), so it can no longer be cancelled or bounced. Record any refund as a receipt.');
        }
        if (current.status !== 'Issued') throw new Error(`Already ${current.status.toLowerCase()}.`);
        if (action === 'Bounced' && !canBounce(current.mode)) throw new Error(`A ${current.mode} transfer cannot bounce — cancel it instead.`);
        if (action === 'Bounced' && current.instrumentDate > day) {
          throw new Error(`It is dated ${formatDay(current.instrumentDate)} and cannot have been presented yet — cancel it instead.`);
        }
        const lines = current.lines || [];

        // Every read before any write: the linked requisitions and, on a cancel, the number's reservation.
        const reqIds = [...new Set(lines.map((l) => l.requisitionId).filter(Boolean) as string[])];
        const reqSnaps = await Promise.all(reqIds.map((id) => tx.get(doc(db, 'dailyRequisitions', id))));
        const key = action === 'Cancelled' ? instrumentKey(current.accountId, current.mode, current.instrumentNo || '') : null;
        const reservationRef = key ? doc(db, 'bankInstrumentNos', key) : null;
        const reservation = reservationRef ? await tx.get(reservationRef) : null;

        lines.forEach((line) => {
          if (line.expenseId) tx.delete(doc(db, 'bankExpenses', line.expenseId));
        });

        const keptStatus: KeptStatus[] = [];
        const missing: string[] = [];
        reqSnaps.forEach((reqSnap) => {
          const reqLines = lines.filter((l) => l.requisitionId === reqSnap.id);
          if (!reqSnap.exists()) {
            missing.push(reqLines[0]?.receptionNo || reqSnap.id);
            return;
          }
          const data = reqSnap.data() as DailyRequisitionEntry;
          // Its current status goes in with it: reversePayment recomputes the status only while the
          // requisition is in the payment stage, so one cancelled or sent back meanwhile keeps its status.
          const status: string | undefined = data.status;
          let req: PayableRequisition = { netAmount: data.netAmount, paidAmount: data.paidAmount, payments: data.payments, status };
          reqLines.forEach((l) => {
            req = { ...req, ...reversePayment(req, current.id, l.lineId) };
          });
          const inPaymentStage = status === undefined || isPaymentStageStatus(status);
          if (!inPaymentStage) keptStatus.push({ receptionNo: data.receptionNo || reqLines[0]?.receptionNo || reqSnap.id, status: status || '(none)' });
          const payments = req.payments ?? [];
          tx.update(reqSnap.ref, {
            paidAmount: req.paidAmount ?? 0,
            payments,
            ...(inPaymentStage && req.status ? { status: req.status } : {}),
            ...(req.status === 'Paid' ? {} : { paidAt: deleteField() }),
            ...(payments.length ? {} : { lastPaidAt: deleteField() }),
          });
        });

        // A cancel frees the number so a mistyped one can be issued again — only this voucher's own
        // reservation, never one another voucher holds. A bounced leaf was used: its number stays taken.
        const owner = reservation?.exists() ? (reservation.data() as { voucherId?: string }).voucherId : undefined;
        const released = !!reservationRef && !!reservation?.exists() && (!owner || owner === current.id);
        if (released && reservationRef) tx.delete(reservationRef);

        tx.update(voucherRef, {
          status: action,
          closedReason: why,
          closedAt: day,
          closedAtTs: Timestamp.now(),
          closedById: user?.id || '',
          closedByName: user?.name || '',
        });

        return {
          voucherNo: current.voucherNo,
          total: Number(current.total) || 0,
          instrument: `${modeConfig(current.mode).instrumentLabel} ${current.instrumentNo || ''}`.trim(),
          returnedTo: reqSnaps.length - missing.length,
          keptStatus,
          missing,
          released,
          receptionNos: [...new Set(lines.map((l) => l.receptionNo || '').filter(Boolean))],
        };
      });

      const back = result.returnedTo ? ` and returned to ${result.returnedTo === 1 ? 'its requisition' : `its ${result.returnedTo} requisitions`}` : '';
      const notes = [
        ...result.keptStatus.map((k) => `${k.receptionNo} left as ${k.status}`),
        ...(result.missing.length ? [`${result.missing.join(', ')} no longer ${result.missing.length === 1 ? 'exists' : 'exist'}`] : []),
        ...(result.released ? [`${result.instrument} can be used again`] : []),
      ];
      toast({
        title: action === 'Cancelled' ? 'Voucher cancelled' : 'Bounce recorded',
        description: `${result.voucherNo}: ${formatInr(result.total)} reversed from the balance${back}${notes.length ? `; ${notes.join('; ')}` : ''}.`,
      });
      void log(
        action === 'Cancelled' ? 'Cancel Payment Voucher' : 'Record Cheque Bounce',
        {
          voucherNo: result.voucherNo,
          mode: voucher.mode || '',
          instrumentNo: voucher.instrumentNo || '',
          instrumentDate: voucher.instrumentDate || '',
          accountId: voucher.accountId || '',
          amount: result.total,
          reason: why,
          requisitions: result.receptionNos,
          ...(result.keptStatus.length ? { statusKept: result.keptStatus.map((k) => `${k.receptionNo}: ${k.status}`) } : {}),
          ...(action === 'Cancelled' ? { instrumentNoReleased: result.released } : {}),
        },
        { recordId: voucher.id, recordRef: result.voucherNo },
      );
      setClosing(null);
      setReason('');
      void load(true);
    } catch (error) {
      toast({ title: 'Not updated', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} blocks={1} />;
  if (!canView) return <BankAccessDenied title="Cheque Register" />;

  /** What the cancel / bounce confirmation says will happen. */
  const closingNote = ({ voucher, action }: Closing) => {
    const linked = new Set((voucher.lines || []).map((l) => l.requisitionId).filter(Boolean)).size;
    const back = linked ? ` and returned to the ${linked} linked requisition${linked === 1 ? '' : 's'}, which become payable again` : '';
    const leaf =
      action === 'Bounced'
        ? ' The leaf stays used: its number cannot be issued again.'
        : instrumentKey(voucher.accountId, voucher.mode, voucher.instrumentNo || '')
          ? ` ${modeConfig(voucher.mode).instrumentLabel} ${voucher.instrumentNo} is released and can be used again.`
          : '';
    return `${formatInr(voucher.total)} is taken back out of the balance${back}.${leaf}`;
  };

  const columns: Array<ListColumn<BankPaymentVoucher>> = [
    {
      header: 'Voucher',
      mobile: 'title',
      cell: (v) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap font-mono text-xs font-semibold">{v.voucherNo}</p>
          <p className="text-xs text-muted-foreground">Issued {formatDay(v.issueDate)}</p>
        </div>
      ),
    },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (v) => (
        <StatusBadge tone={STATUS_TONE[statusOf(v)]} dot>
          {statusOf(v)}
        </StatusBadge>
      ),
    },
    {
      header: 'Instrument',
      cell: (v) => (
        <div className="min-w-0 text-xs">
          <p className="font-medium">{v.mode}</p>
          <p className="font-mono text-muted-foreground">{v.instrumentNo || '—'}</p>
        </div>
      ),
    },
    {
      header: 'Date',
      cell: (v) => (
        <div className="text-xs">
          <p className="whitespace-nowrap font-medium">{formatDay(v.instrumentDate)}</p>
          {statusOf(v) === 'Stale' && <p className="text-amber-700">Over {CHEQUE_VALIDITY_MONTHS} months old</p>}
          {v.status === 'Cleared' && <p className="text-emerald-700">Cleared {formatDay(v.clearedDate)}</p>}
          {(v.status === 'Cancelled' || v.status === 'Bounced') && <p className="text-muted-foreground">{v.status} {formatDay(v.closedAt)}</p>}
        </div>
      ),
    },
    { header: 'Account', cell: (v) => <span className="whitespace-nowrap">{accountLabel(accountById.get(v.accountId))}</span> },
    {
      header: 'Payees',
      cell: (v) => {
        const lines = v.lines || [];
        return (
          <div className="min-w-0 text-xs">
            <p className="truncate font-medium">{lines[0]?.partyName || '—'}</p>
            {lines.length > 1 && <p className="text-muted-foreground">+ {lines.length - 1} more</p>}
          </div>
        );
      },
    },
    { header: 'Amount', align: 'right', cell: (v) => <span className="font-semibold tabular-nums">{formatInr(v.total)}</span> },
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (v) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setViewing(v)}>
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            View
          </Button>
          {canAdd && v.status === 'Issued' && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                setClearDate(v.instrumentDate > today ? v.instrumentDate : today);
                setClearing(v);
              }}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Clear
            </Button>
          )}
          {canDelete && v.status === 'Issued' && (
            <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => { setReason(''); setClosing({ voucher: v, action: 'Cancelled' }); }}>
              <Ban className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          {canDelete && bounceable(v) && (
            <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => { setReason(''); setClosing({ voucher: v, action: 'Bounced' }); }}>
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              Bounced
            </Button>
          )}
        </div>
      ),
    },
  ];

  const viewingAccount = viewing ? accountById.get(viewing.accountId) : undefined;

  return (
    <>
      <Suspense fallback={null}>
        <VoucherDeepLink onOpen={setPendingVoucherId} />
      </Suspense>
      <BankBalanceBackground tone="indigo" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Cheque Register"
          description="Every payment voucher — cheques, e-cheques and transfer batches — from issue to clearing."
          icon={BookOpenCheck}
          backHref="/bank-balance"
          backLabel="Back to dashboard"
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={isRefreshing}>
                <RefreshCw className={isRefreshing ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
                Refresh
              </Button>
              {canAdd && (
                <Button asChild>
                  <Link href="/bank-balance/expenses/new">
                    <Plus className="mr-2 h-4 w-4" />
                    New Payment
                  </Link>
                </Button>
              )}
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Post-dated"
            value={formatInr(summary.sum(summary.postDated))}
            hint={
              summary.nextDue
                ? `${summary.postDated.length} voucher${summary.postDated.length === 1 ? '' : 's'} · next ${formatDay(summary.nextDue.instrumentDate)}`
                : 'None dated ahead'
            }
            icon={CalendarClock}
            tone="blue"
            accent
          />
          <KpiCard
            label="Issued, not cleared"
            value={formatInr(summary.sum(summary.issued))}
            hint={`${summary.issued.length} voucher${summary.issued.length === 1 ? '' : 's'}${summary.stale.length ? ` · ${summary.stale.length} stale` : ''}`}
            icon={Wallet}
            tone={summary.stale.length ? 'amber' : 'violet'}
            accent
          />
          <KpiCard label="Cleared this month" value={formatInr(summary.sum(summary.clearedThisMonth))} hint={`${summary.clearedThisMonth.length} voucher${summary.clearedThisMonth.length === 1 ? '' : 's'}`} icon={CheckCircle2} tone="emerald" accent />
          <KpiCard
            label="Cancelled / bounced this month"
            value={summary.closedThisMonth.length}
            hint={summary.closedThisMonth.length ? formatInr(summary.sum(summary.closedThisMonth)) + ' reversed' : 'None'}
            icon={Ban}
            tone={summary.closedThisMonth.length ? 'rose' : 'slate'}
            accent
          />
        </div>

        <TableCard
          title="Payment vouchers"
          count={rows.length}
          noun="voucher"
          toolbar={
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: 'Voucher, cheque no., payee, reception no., UTR…' }}
              activeCount={(statusFilter === 'open' ? 0 : 1) + (modeFilter === 'all' ? 0 : 1) + (accountFilter === 'all' ? 0 : 1)}
              onClear={() => {
                setStatusFilter('open');
                setModeFilter('all');
                setAccountFilter('all');
                setSearch('');
              }}
            >
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="sm:w-44" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open (not cleared)</SelectItem>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="Post-dated">Post-dated</SelectItem>
                  <SelectItem value="Issued">Issued</SelectItem>
                  <SelectItem value="Stale">Stale (over {CHEQUE_VALIDITY_MONTHS} months)</SelectItem>
                  <SelectItem value="Cleared">Cleared</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                  <SelectItem value="Bounced">Bounced</SelectItem>
                </SelectContent>
              </Select>
              <Select value={modeFilter} onValueChange={setModeFilter}>
                <SelectTrigger className="sm:w-40" aria-label="Mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All modes</SelectItem>
                  {modes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="sm:w-48" aria-label="Account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterBar>
          }
        >
          <DataList
            rows={rows}
            columns={columns}
            empty={
              <p className="py-12 text-center text-sm text-muted-foreground">
                {vouchers.length === 0 ? 'No payment vouchers yet — they appear here once issued from New Payment.' : 'No vouchers match the filters.'}
              </p>
            }
          />
        </TableCard>
      </div>

      {/* View */}
      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="hr-mobile-dialog gap-4 sm:max-h-[90dvh] sm:max-w-4xl">
          <DialogHeader className="hr-dialog-header pr-8">
            <DialogTitle>{viewing?.voucherNo}</DialogTitle>
            <DialogDescription>
              {viewing ? `${viewing.mode}${viewing.instrumentNo ? ` ${viewing.instrumentNo}` : ''} · ${accountLabel(viewingAccount)} · dated ${formatDay(viewing.instrumentDate)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {viewing && (
            <div className="hr-dialog-body min-h-0 flex-1 space-y-4 overflow-y-auto">
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Status</dt>
                  <dd>
                    <StatusBadge tone={STATUS_TONE[statusOf(viewing)]} dot>
                      {statusOf(viewing)}
                    </StatusBadge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Issued</dt>
                  <dd>
                    {formatDay(viewing.issueDate)}
                    {viewing.createdByName ? ` · ${viewing.createdByName}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total</dt>
                  <dd className="font-semibold tabular-nums">{formatInr(viewing.total)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Copy</dt>
                  <dd>
                    {viewing.transferCopyUrl ? (
                      <a href={viewing.transferCopyUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                        Open
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                {viewing.status === 'Cleared' && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Cleared</dt>
                    <dd>
                      {formatDay(viewing.clearedDate)}
                      {viewing.clearedByName ? ` · ${viewing.clearedByName}` : ''}
                    </dd>
                  </div>
                )}
              </dl>
              {statusOf(viewing) === 'Stale' && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  More than {CHEQUE_VALIDITY_MONTHS} months past its date and still not cleared, so a bank will refuse it now. If it was never paid, cancel it and issue a fresh one.
                </p>
              )}
              {viewing.remarks && <p className="rounded-md bg-muted/40 px-3 py-2 text-sm">{viewing.remarks}</p>}
              {(viewing.status === 'Cancelled' || viewing.status === 'Bounced') && (
                <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {viewing.status} on {formatDay(viewing.closedAt)}
                  {viewing.closedByName ? ` by ${viewing.closedByName}` : ''}
                  {viewing.closedReason ? `: ${viewing.closedReason}` : ''}
                </p>
              )}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-2 py-2">Requisition / Ref</th>
                      <th className="px-2 py-2">Payee</th>
                      <th className="px-2 py-2">Description</th>
                      <th className="px-2 py-2">UTR</th>
                      <th className="px-2 py-2">Approval</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(viewing.lines || []).map((line, index) => (
                      <tr key={line.lineId}>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{index + 1}</td>
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">
                          {line.requisitionId && line.receptionNo ? (
                            <Link href={requisitionHref(line.receptionNo)} className="text-primary underline-offset-2 hover:underline" title="Open in Daily Requisition">
                              {line.receptionNo}
                            </Link>
                          ) : (
                            line.receptionNo || '—'
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <span className="block font-medium">{line.partyName || '—'}</span>
                          {line.projectName && <span className="block text-xs text-muted-foreground">{line.projectName}</span>}
                        </td>
                        <td className="px-2 py-2 text-xs">{line.description}</td>
                        <td className="px-2 py-2 font-mono text-xs">{line.utrNumber || '—'}</td>
                        <td className="px-2 py-2 text-xs">
                          {line.approvalCopyUrl ? (
                            <a href={line.approvalCopyUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                              Open
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formatInr(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter className="hr-dialog-footer gap-2 sm:gap-0">
            {viewing && (
              <Button variant="outline" asChild>
                <Link href={printHref(viewing.id)} target="_blank" rel="noopener noreferrer">
                  <Printer className="mr-2 h-4 w-4" />
                  Print voucher
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => setViewing(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear */}
      <Dialog open={!!clearing} onOpenChange={(open) => { if (!open && !busy) setClearing(null); }}>
        <DialogContent className="hr-mobile-dialog gap-4 sm:max-w-md">
          <DialogHeader className="hr-dialog-header pr-8">
            <DialogTitle>Mark {clearing?.voucherNo} cleared</DialogTitle>
            <DialogDescription>
              {clearing ? `${clearing.mode} ${clearing.instrumentNo} for ${formatInr(clearing.total)}, dated ${formatDay(clearing.instrumentDate)}.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="hr-dialog-body space-y-1.5">
            <Label htmlFor="clear-date">Cleared on (per bank statement)</Label>
            <Input id="clear-date" type="date" value={clearDate} min={clearing?.instrumentDate} max={today} onChange={(e) => setClearDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">The balance already moved on the cheque date; clearing records that the bank has paid it.</p>
            {clearing && statusOf(clearing) === 'Stale' && (
              <p className="text-xs text-amber-700">
                This cheque is more than {CHEQUE_VALIDITY_MONTHS} months past its date. Mark it cleared only if the bank statement shows it was paid.
              </p>
            )}
          </div>
          <DialogFooter className="hr-dialog-footer gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setClearing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void handleClear()} disabled={busy || !clearDate || (clearing ? clearing.instrumentDate > today : false)}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Mark Cleared
            </Button>
          </DialogFooter>
          {clearing && clearing.instrumentDate > today && (
            <p className="px-6 pb-4 text-xs text-amber-700">This cheque is post-dated to {formatDay(clearing.instrumentDate)} and cannot clear before then.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel / bounce */}
      <Dialog open={!!closing} onOpenChange={(open) => { if (!open && !busy) setClosing(null); }}>
        <DialogContent className="hr-mobile-dialog gap-4 sm:max-w-md">
          <DialogHeader className="hr-dialog-header pr-8">
            <DialogTitle>{closing?.action === 'Cancelled' ? 'Cancel' : 'Record bounce of'} {closing?.voucher.voucherNo}?</DialogTitle>
            <DialogDescription>{closing ? closingNote(closing) : ''}</DialogDescription>
          </DialogHeader>
          <div className="hr-dialog-body space-y-1.5">
            <Label htmlFor="close-reason">Reason</Label>
            <Textarea
              id="close-reason"
              rows={3}
              placeholder={closing?.action === 'Bounced' ? 'e.g. Returned — insufficient funds / signature mismatch' : 'e.g. Cheque torn, wrong payee'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter className="hr-dialog-footer gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setClosing(null)} disabled={busy}>
              Keep voucher
            </Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void handleClose()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
              {closing?.action === 'Cancelled' ? 'Cancel Voucher' : 'Record Bounce'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
