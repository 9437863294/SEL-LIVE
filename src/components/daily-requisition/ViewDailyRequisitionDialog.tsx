'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { collection, doc, getDocs, query, runTransaction, Timestamp, updateDoc, where } from 'firebase/firestore';
import { format, isValid, parseISO } from 'date-fns';
import { Download, Eye, Loader2, Lock, Paperclip, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusBadge } from '@/components/shared/status-badge';
import { RecordActivity } from '@/components/shared/record-history';
import { DAILY_STATUS_TONE } from '@/components/daily-requisition/module-shell';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { formatDay, formatInr } from '@/lib/bank-balance-ledger';
import { isPaymentStageStatus } from '@/lib/bank-payments';
import { db } from '@/lib/firebase';
import { balanceOf, isPaymentLocked, paidOf, voucherHref } from '@/lib/requisition-progress';
import type { BankAccount, DailyRequisitionEntry, Department, ExpenseRequest, Project } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ViewDailyRequisitionDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  entry: DailyRequisitionEntry | null;
  projects: Project[];
  departments: Department[];
  expenseRequest?: ExpenseRequest | null;
  /** Bank accounts, if the page has loaded them: names the account each payment was drawn on. */
  bankAccounts?: Array<Pick<BankAccount, 'id' | 'shortName' | 'bankName'>>;
  onActionComplete?: () => void;
}

/** A Firestore Timestamp, Date, ISO string or yyyy-MM-dd day as a Date. */
const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  if (typeof value === 'string') {
    const parsed = parseISO(value);
    if (isValid(parsed)) return parsed;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return isValid(parsed) ? parsed : null;
  }
  return null;
};

const formatDateSafe = (value: unknown): string => {
  if (!value) return 'N/A';
  const date = toDate(value);
  if (date) return format(date, 'dd MMM yyyy');
  return typeof value === 'string' ? value : 'N/A';
};

type DeductionKey = 'igstAmount' | 'cgstAmount' | 'sgstAmount' | 'tdsAmount' | 'retentionAmount' | 'otherDeduction';

/** Net = gross + GST - TDS - retention - other deduction, as GST & TDS Verification works it out. */
const DEDUCTION_LINES: Array<{ key: DeductionKey; label: string }> = [
  { key: 'igstAmount', label: 'Add: IGST' },
  { key: 'cgstAmount', label: 'Add: CGST' },
  { key: 'sgstAmount', label: 'Add: SGST' },
  { key: 'tdsAmount', label: 'Less: TDS' },
  { key: 'retentionAmount', label: 'Less: Retention' },
  { key: 'otherDeduction', label: 'Less: Other deduction' },
];

const amountOf = (value: unknown) => Number(value) || 0;

/** Whether GST & TDS Verification has recorded anything on this requisition. */
const hasDeductions = (entry: DailyRequisitionEntry) =>
  DEDUCTION_LINES.some(({ key }) => amountOf(entry[key]) !== 0) ||
  !!entry.gstNo?.trim() ||
  !!entry.invoiceNo?.trim() ||
  !!entry.verificationNotes?.trim();

const LOCKED_BY_VOUCHER =
  'Payments have been made against this requisition. Reverse the voucher in the Bank Balance Cheque Register first.';
const LOCKED_AS_PAID = 'This requisition is recorded as paid, so it can no longer be sent back or cancelled.';

const lockedMessage = (req: Pick<DailyRequisitionEntry, 'payments'>) =>
  (req.payments?.length ?? 0) > 0 ? LOCKED_BY_VOUCHER : LOCKED_AS_PAID;

/**
 * Thrown inside a status transaction when the stored requisition no longer allows the change.
 * Firestore rejects runTransaction with a callback's own error unchanged and does not retry it.
 */
const BLOCKED = 'RequisitionActionBlocked';
const blocked = (message: string) => Object.assign(new Error(message), { name: BLOCKED });
const isBlocked = (error: unknown): error is Error => error instanceof Error && error.name === BLOCKED;

type BusyAction = 'receive' | 'return' | 'cancel' | 'missing' | 'not-required';

interface StatusChange {
  busy: BusyAction;
  /** The activity-log action. */
  action: string;
  to: DailyRequisitionEntry['status'];
  /** Whether the stored status still allows the change. */
  allowedFrom: (status: string | undefined) => boolean;
  fields: (userId: string) => Record<string, unknown>;
  /** Unlink the expense request (DEP) this requisition was received from, so it can be received again. */
  releaseExpenseRequest?: boolean;
  done: string;
}

function AmountRow({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1 text-sm', total && 'mt-1 border-t pt-2 font-semibold text-slate-900')}>
      <span className={total ? undefined : 'text-muted-foreground'}>{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

/** One label / value pair of the details grid. */
function Detail({ label, mono = false, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-sm font-medium text-slate-900', mono && 'font-mono')}>{children}</dd>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>;
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' }) {
  return (
    <div className="min-w-0 rounded-lg border bg-white px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={cn('truncate text-sm font-semibold tabular-nums text-slate-900', tone === 'emerald' && 'text-emerald-700', tone === 'amber' && 'text-amber-700')}>{value}</p>
    </div>
  );
}

export default function ViewDailyRequisitionDialog({
  isOpen,
  onOpenChange,
  entry,
  projects,
  departments,
  expenseRequest,
  bankAccounts,
  onActionComplete,
}: ViewDailyRequisitionDialogProps) {
  const { can } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const handleOpenChange = (open: boolean) => {
    if (!open) setConfirmCancelOpen(false);
    onOpenChange(open);
  };

  const handlePrint = () => {
    if (!entry) return;
    window.open(`/daily-requisition/entry-sheet/${entry.id}/print`, '_blank');
  };

  /**
   * One status change, checked against the stored requisition rather than the copy this dialog
   * opened with: a voucher may have paid it, or someone else moved it on, in the meantime. The
   * voucher save re-reads the requisition in its own transaction, so the two can never cross.
   */
  const changeStatus = async (change: StatusChange) => {
    if (!entry || !user) return;
    setBusy(change.busy);
    const receptionNo = entry.receptionNo || '';
    const depNo = entry.depNo || '';
    try {
      const requisitionRef = doc(db, 'dailyRequisitions', entry.id);
      // A transaction reads documents only by reference, so the linked expense request is found
      // first — by both numbers, so a DEP already received again under a newer requisition is left alone.
      const expenseRefs =
        change.releaseExpenseRequest && depNo.trim() && receptionNo.trim()
          ? (
              await getDocs(
                query(collection(db, 'expenseRequests'), where('requestNo', '==', depNo), where('receptionNo', '==', receptionNo)),
              )
            ).docs.map((d) => d.ref)
          : [];

      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(requisitionRef);
        if (!snap.exists()) throw blocked(`${receptionNo} no longer exists.`);
        const current = snap.data() as DailyRequisitionEntry;
        if (isPaymentLocked(current)) throw blocked(lockedMessage(current));
        if (!change.allowedFrom(current.status)) {
          throw blocked(`${receptionNo} is now "${current.status || 'Pending'}", so it was not changed.`);
        }
        const expenseSnaps = await Promise.all(expenseRefs.map((ref) => tx.get(ref)));

        tx.update(requisitionRef, change.fields(user.id));
        const released: string[] = [];
        for (const expenseSnap of expenseSnaps) {
          if (!expenseSnap.exists() || expenseSnap.get('receptionNo') !== receptionNo) continue;
          tx.update(expenseSnap.ref, { receptionNo: '', receptionDate: '' });
          released.push(expenseSnap.id);
        }
        return { from: current.status || '', released };
      });

      void log(
        change.action,
        {
          receptionNo,
          depNo,
          partyName: entry.partyName || '',
          netAmount: amountOf(entry.netAmount),
          from: result.from,
          to: change.to,
          ...(change.releaseExpenseRequest ? { releasedExpenseRequestIds: result.released } : {}),
        },
        { recordId: entry.id, recordRef: receptionNo },
      );

      toast({
        title: 'Success',
        description: result.released.length ? `${change.done} ${depNo} can be received again.` : change.done,
      });
      onActionComplete?.();
      handleOpenChange(false);
    } catch (error) {
      if (isBlocked(error)) {
        toast({ title: 'Not changed', description: error.message, variant: 'destructive' });
        // The list is out of date: refresh it, and close so the requisition is reopened as it now stands.
        onActionComplete?.();
        handleOpenChange(false);
      } else {
        console.error('Error updating entry status: ', error);
        toast({ title: 'Error', description: 'Failed to update status.', variant: 'destructive' });
      }
    } finally {
      setBusy(null);
      setConfirmCancelOpen(false);
    }
  };

  const handleReceive = () => {
    if (!entry) return;
    void changeStatus({
      busy: 'receive',
      action: 'Mark Requisition Received',
      to: 'Received',
      allowedFrom: (status) => status === 'Pending',
      fields: (userId) => ({ status: 'Received', receivedAt: Timestamp.now(), receivedById: userId }),
      done: `${entry.receptionNo} marked as received.`,
    });
  };

  const handleReturnToPending = () => {
    if (!entry) return;
    void changeStatus({
      busy: 'return',
      action: 'Return Requisition to Pending',
      to: 'Pending',
      allowedFrom: (status) => status === 'Received',
      fields: () => ({ status: 'Pending', receivedAt: null, receivedById: null }),
      done: `${entry.receptionNo} returned to pending.`,
    });
  };

  const handleCancel = () => {
    if (!entry) return;
    void changeStatus({
      busy: 'cancel',
      action: 'Cancel Requisition',
      to: 'Cancelled',
      allowedFrom: (status) => status !== 'Cancelled',
      fields: () => ({ status: 'Cancelled' }),
      releaseExpenseRequest: true,
      done: `${entry.receptionNo} cancelled.`,
    });
  };

  const handleDocumentStatusUpdate = async (newDocStatus: 'Missing' | 'Not Required') => {
    if (!entry || !user) return;
    setBusy(newDocStatus === 'Missing' ? 'missing' : 'not-required');
    try {
      await updateDoc(doc(db, 'dailyRequisitions', entry.id), {
        documentStatus: newDocStatus,
        documentStatusUpdatedById: user.id,
        documentStatusUpdatedAt: Timestamp.now(),
      });
      void log(
        newDocStatus === 'Missing' ? 'Mark Requisition Documents Missing' : 'Mark Requisition Documents Not Required',
        { receptionNo: entry.receptionNo || '', from: entry.documentStatus || '', to: newDocStatus },
        { recordId: entry.id, recordRef: entry.receptionNo || '' },
      );
      toast({ title: 'Success', description: `Document status set to ${newDocStatus}.` });
      onActionComplete?.();
      handleOpenChange(false);
    } catch (error) {
      console.error('Error updating document status:', error);
      toast({ title: 'Error', description: 'Failed to update document status.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (!entry) return null;

  const status = entry.status || 'Pending';
  const payments = entry.payments ?? [];
  const locked = isPaymentLocked(entry);
  const showDeductions = hasDeductions(entry);
  const showPayment = locked || !!entry.manualPaid || isPaymentStageStatus(entry.status);

  const accountNames = new Map((bankAccounts ?? []).map((a) => [a.id, (a.shortName || a.bankName || 'Unknown').trim()]));
  const showAccount = payments.some((p) => accountNames.has(p.accountId));

  const canReceive = can('Mark as Received', 'Daily Requisition.Receiving at Finance');
  const canReturn = can('Return to Pending', 'Daily Requisition.Receiving at Finance');
  const canCancel = can('Cancel', 'Daily Requisition.Receiving at Finance');
  const canMarkMissing = can('Mark as Missing', 'Daily Requisition.Manage Documents');
  const canMarkNotRequired = can('Mark as Not Required', 'Daily Requisition.Manage Documents');

  // Mark as Received is the Receiving at Finance step, so only for a requisition still waiting there
  // (on a later stage it would move the requisition backwards). Once any money has gone out,
  // nothing here may send it back or cancel it: the payment voucher owns it.
  const offerReceive = canReceive && status === 'Pending' && !locked;
  const offerReturn = canReturn && status === 'Received' && !locked;
  const offerCancel = canCancel && status !== 'Cancelled' && !locked;
  const explainLock = locked && status !== 'Cancelled' && (canReceive || canReturn || canCancel);

  const projectName = projects.find((p) => p.id === entry.projectId)?.projectName || 'N/A';
  const departmentName = departments.find((d) => d.id === entry.departmentId)?.name || 'N/A';

  const manualPaidNote = `Marked paid by hand (outside Bank Balance)${entry.paidByName ? ` by ${entry.paidByName}` : ''}${
    entry.paidAt ? ` on ${formatDateSafe(entry.paidAt)}` : ''
  }.`;

  const spinner = (action: BusyAction) => (busy === action ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="hr-mobile-dialog sm:max-w-3xl sm:gap-0 sm:p-0">
        <DialogHeader className="hr-dialog-header no-print space-y-1 border-b px-5 py-4 text-left sm:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-2 pr-6">
            <DialogTitle className="min-w-0 break-words font-mono text-base font-semibold tracking-tight sm:text-lg">{entry.receptionNo}</DialogTitle>
            <StatusBadge status={status} tone={DAILY_STATUS_TONE[status]} className="shrink-0">
              {status}
            </StatusBadge>
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span>Daily requisition</span>
            {entry.depNo ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  from <span className="font-mono font-medium text-slate-700">{entry.depNo}</span>
                </span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span>received {formatDateSafe(entry.date)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="hr-dialog-body space-y-4 px-5 py-4 sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:px-6">
          <div className="mb-2 hidden text-center print:block">
            <h2 className="text-lg font-bold">Daily Requisition - {entry.receptionNo}</h2>
          </div>

          {/* Who is paid, for what, and how much — at a glance */}
          <div className="flex flex-col gap-3 rounded-lg border bg-slate-50/70 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Party</p>
              <p className="break-words text-base font-semibold text-slate-900">{entry.partyName || '—'}</p>
              <p className={cn('whitespace-pre-wrap break-words text-sm', entry.description?.trim() ? 'text-slate-600' : 'italic text-muted-foreground')}>
                {entry.description?.trim() || 'No description'}
              </p>
            </div>
            <div className="shrink-0 border-t pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0 sm:text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Net amount</p>
              <p className="text-xl font-bold tabular-nums text-emerald-700">{formatInr(entry.netAmount)}</p>
              {amountOf(entry.grossAmount) !== amountOf(entry.netAmount) && (
                <p className="text-xs tabular-nums text-muted-foreground">Gross {formatInr(entry.grossAmount)}</p>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
            <Detail label="Project">{projectName}</Detail>
            <Detail label="Department">{departmentName}</Detail>
            <Detail label="Reception date">{formatDateSafe(entry.date)}</Detail>
            {expenseRequest && <Detail label="Head of A/c">{expenseRequest.headOfAccount || '—'}</Detail>}
            {expenseRequest && <Detail label="Sub-head of A/c">{expenseRequest.subHeadOfAccount || '—'}</Detail>}
            <Detail label="Created">{formatDateSafe(entry.createdAt)}</Detail>
          </dl>

          {showDeductions && (
            <section className="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="min-w-0">
                <SectionTitle>Amount working</SectionTitle>
                <div className="rounded-lg border px-3 py-1.5">
                  <AmountRow label="Gross amount" value={formatInr(entry.grossAmount)} />
                  {DEDUCTION_LINES.filter(({ key }) => amountOf(entry[key]) !== 0).map(({ key, label }) => (
                    <AmountRow key={key} label={label} value={formatInr(amountOf(entry[key]))} />
                  ))}
                  <AmountRow label="Net amount" value={formatInr(entry.netAmount)} total />
                </div>
              </div>
              <div className="min-w-0">
                <SectionTitle>GST &amp; TDS</SectionTitle>
                {/* Carried from the expense request's Statutory section (src/lib/statutory.ts). */}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Detail label="GSTIN" mono>{entry.gstNo?.trim() || '—'}</Detail>
                  {entry.panNo ? <Detail label="PAN" mono>{entry.panNo}</Detail> : null}
                  {entry.invoiceNo ? (
                    <Detail label="Invoice">
                      {entry.invoiceNo}
                      {entry.invoiceDate ? <span className="block text-xs font-normal text-muted-foreground">{formatDateSafe(entry.invoiceDate)}</span> : null}
                    </Detail>
                  ) : null}
                  {entry.tdsSection && entry.tdsSection !== 'none' ? (
                    <Detail label="TDS section">{entry.tdsSection} @ {entry.tdsRate ?? 0}%</Detail>
                  ) : null}
                  {entry.verifiedAt ? <Detail label="Verified on">{formatDateSafe(entry.verifiedAt)}</Detail> : null}
                  {entry.reverseCharge ? (
                    <div className="col-span-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">Reverse charge — GST is not paid to the supplier.</div>
                  ) : null}
                  {entry.verificationNotes?.trim() ? (
                    <div className="col-span-2">
                      <Detail label="Verification notes">
                        <span className="whitespace-pre-wrap font-normal">{entry.verificationNotes.trim()}</span>
                      </Detail>
                    </div>
                  ) : null}
                </dl>
              </div>
            </section>
          )}

          {showPayment && (
            <section className="space-y-2.5 border-t pt-4">
              <SectionTitle>Payment</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                <Figure label="Net amount" value={formatInr(entry.netAmount)} />
                <Figure label="Paid" value={formatInr(paidOf(entry))} tone="emerald" />
                <Figure label="Balance" value={formatInr(balanceOf(entry))} tone={balanceOf(entry) > 0 ? 'amber' : undefined} />
              </div>
              {payments.length > 0 && (
                <Table containerClassName="rounded-lg border">
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead className="h-9 text-xs">Voucher No.</TableHead>
                      <TableHead className="h-9 text-xs">Mode</TableHead>
                      <TableHead className="h-9 text-xs">Instrument</TableHead>
                      <TableHead className="h-9 text-xs">Date</TableHead>
                      {showAccount && <TableHead className="h-9 text-xs">Account</TableHead>}
                      <TableHead className="h-9 text-right text-xs">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment, index) => (
                      <TableRow key={`${payment.bankPaymentId}-${payment.lineId}-${index}`}>
                        <TableCell className="whitespace-nowrap py-2 font-medium">
                          {payment.bankPaymentId ? (
                            <Link href={voucherHref(payment.bankPaymentId)} className="text-primary underline-offset-2 hover:underline">
                              {payment.voucherNo || 'View voucher'}
                            </Link>
                          ) : (
                            payment.voucherNo || '—'
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2">{payment.mode || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap py-2">{payment.instrumentNo || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap py-2">{formatDay(payment.instrumentDate)}</TableCell>
                        {showAccount && <TableCell className="whitespace-nowrap py-2">{accountNames.get(payment.accountId) ?? '—'}</TableCell>}
                        <TableCell className="whitespace-nowrap py-2 text-right tabular-nums">{formatInr(payment.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {entry.manualPaid && <p className="text-xs text-muted-foreground">{manualPaidNote}</p>}
            </section>
          )}

          {entry.attachments && entry.attachments.length > 0 && (
            <section className="space-y-2 border-t pt-4">
              <SectionTitle>Attachments ({entry.attachments.length})</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {entry.attachments.map((file, index) => (
                  <div key={index} className="flex max-w-full items-center gap-1 rounded-md border bg-white py-1 pl-2.5 pr-1 text-sm">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="max-w-[14rem] truncate font-medium text-slate-700">{file.name}</span>
                    <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="View">
                      <a href={file.url} target="_blank" rel="noopener noreferrer" aria-label={`View ${file.name}`}>
                        <Eye className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="Download">
                      <a href={file.url} download={file.name} aria-label={`Download ${file.name}`}>
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {explainLock && (
            <div className="no-print flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {payments.length > 0 ? (
                  <>
                    Payments have been made against this requisition. Reverse the voucher in the Bank Balance{' '}
                    <Link href="/bank-balance/cheques" className="font-medium underline underline-offset-2">
                      Cheque Register
                    </Link>{' '}
                    first.
                  </>
                ) : (
                  LOCKED_AS_PAID
                )}
              </span>
            </div>
          )}

          {/* Who did what to this requisition. Keyed so another entry opens closed. */}
          <RecordActivity
            key={entry.id}
            recordId={entry.id}
            recordRef={entry.receptionNo}
            sectionClassName="border-t pt-4"
          />
        </div>

        <DialogFooter className="hr-dialog-footer no-print flex-wrap gap-2 border-t bg-slate-50/60 px-5 py-3 sm:shrink-0 sm:justify-end sm:space-x-0 sm:px-6">
          <Button variant="ghost" onClick={handlePrint} size="sm" className="sm:mr-auto">
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
          {offerCancel && (
            <Button
              variant="outline"
              onClick={() => setConfirmCancelOpen(true)}
              disabled={busy !== null}
              size="sm"
              className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            >
              Cancel requisition
            </Button>
          )}
          {entry.documentStatus === 'Pending' && canMarkMissing && (
            <Button variant="outline" onClick={() => handleDocumentStatusUpdate('Missing')} disabled={busy !== null} size="sm">
              {spinner('missing')}
              Mark as Missing
            </Button>
          )}
          {entry.documentStatus === 'Pending' && canMarkNotRequired && (
            <Button variant="outline" onClick={() => handleDocumentStatusUpdate('Not Required')} disabled={busy !== null} size="sm">
              {spinner('not-required')}
              Mark as Not Required
            </Button>
          )}
          {offerReturn && (
            <Button variant="outline" onClick={handleReturnToPending} disabled={busy !== null} size="sm">
              {spinner('return')}
              Return to Pending
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="outline" size="sm">Close</Button>
          </DialogClose>
          {offerReceive && (
            <Button onClick={handleReceive} disabled={busy !== null} size="sm">
              {spinner('receive')}
              Mark as Received
            </Button>
          )}
        </DialogFooter>

        <AlertDialog
          open={confirmCancelOpen}
          onOpenChange={(open) => {
            if (busy !== 'cancel') setConfirmCancelOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel {entry.receptionNo}?</AlertDialogTitle>
              <AlertDialogDescription>
                {entry.depNo
                  ? `It will be marked Cancelled, and expense request ${entry.depNo} released so it can be received again.`
                  : 'It will be marked Cancelled.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy === 'cancel'}>Keep it</AlertDialogCancel>
              <Button variant="destructive" onClick={handleCancel} disabled={busy === 'cancel'}>
                {spinner('cancel')}
                Cancel requisition
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
