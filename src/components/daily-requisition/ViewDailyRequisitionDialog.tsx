'use client';

import { useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDocs, query, runTransaction, Timestamp, updateDoc, where } from 'firebase/firestore';
import { format, isValid, parseISO } from 'date-fns';
import { Download, Eye, Loader2, Lock, Paperclip, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '@/components/shared/status-badge';
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

function AmountRow({ label, value, total = false, muted = false }: { label: string; value: string; total?: boolean; muted?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1 text-sm', total && 'mt-1 border-t pt-2 font-semibold')}>
      <span className={total ? undefined : 'text-muted-foreground'}>{label}</span>
      <span className={cn('shrink-0 tabular-nums', muted && 'text-muted-foreground')}>{value}</span>
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
      <DialogContent className="hr-mobile-dialog sm:max-w-3xl sm:gap-4">
        <DialogHeader className="hr-dialog-header no-print">
          <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 pr-6 sm:justify-start">
            <DialogTitle className="min-w-0 break-words">Details for {entry.receptionNo}</DialogTitle>
            <StatusBadge status={status} tone={DAILY_STATUS_TONE[status]} className="shrink-0">
              {status}
            </StatusBadge>
          </div>
        </DialogHeader>

        <div className="hr-dialog-body space-y-3 sm:-mx-1 sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:px-1">
          <div className="mb-4 hidden text-center print:block">
            <h2 className="text-lg font-bold">Daily Requisition - {entry.receptionNo}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 [&>div]:min-w-0 [&_p]:break-words">
            <div><Label className="text-xs">Reception No.</Label><p className="font-medium">{entry.receptionNo}</p></div>
            <div><Label className="text-xs">Date</Label><p className="font-medium">{formatDateSafe(entry.date)}</p></div>
            <div><Label className="text-xs">Created At</Label><p className="font-medium">{formatDateSafe(entry.createdAt)}</p></div>
            <div><Label className="text-xs">Project</Label><p className="font-medium">{projectName}</p></div>
            <div><Label className="text-xs">Department</Label><p className="font-medium">{departmentName}</p></div>
            <div><Label className="text-xs">DEP No.</Label><p className="font-medium">{entry.depNo || 'N/A'}</p></div>
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-3 text-sm [&_p]:break-words">
            <div>
              <Label className="text-xs">Party Name</Label>
              <p className="font-medium">{entry.partyName}</p>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <p className="min-h-[40px] whitespace-pre-wrap rounded-md bg-muted p-2 font-medium">{entry.description}</p>
            </div>
          </div>

          <Separator />

          {expenseRequest && (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm [&>div]:min-w-0 [&_p]:break-words">
                <div><Label className="text-xs">Head of A/c</Label><p className="font-medium">{expenseRequest.headOfAccount}</p></div>
                <div><Label className="text-xs">Sub-Head of A/c</Label><p className="font-medium">{expenseRequest.subHeadOfAccount}</p></div>
              </div>
              <Separator />
            </>
          )}

          {showDeductions ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Deductions</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0 rounded-md border px-3 py-2">
                  <AmountRow label="Gross amount" value={formatInr(entry.grossAmount)} />
                  {DEDUCTION_LINES.map(({ key, label }) => {
                    const value = amountOf(entry[key]);
                    return <AmountRow key={key} label={label} value={value ? formatInr(value) : '—'} muted={!value} />;
                  })}
                  <AmountRow label="Net amount" value={formatInr(entry.netAmount)} total />
                </div>
                <div className="min-w-0 space-y-3 text-sm [&_p]:break-words">
                  <div><Label className="text-xs">GST No.</Label><p className="font-medium">{entry.gstNo?.trim() || 'N/A'}</p></div>
                  {entry.verifiedAt ? (
                    <div><Label className="text-xs">Verified On</Label><p className="font-medium">{formatDateSafe(entry.verifiedAt)}</p></div>
                  ) : null}
                  <div>
                    <Label className="text-xs">Verification Notes</Label>
                    <p className="whitespace-pre-wrap font-medium">{entry.verificationNotes?.trim() || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm [&>div]:min-w-0">
              <div><Label className="text-xs">Gross Amount</Label><p className="font-medium tabular-nums">{formatInr(entry.grossAmount)}</p></div>
              <div><Label className="text-xs">Net Amount</Label><p className="font-medium tabular-nums">{formatInr(entry.netAmount)}</p></div>
            </div>
          )}

          {showPayment && (
            <>
              <Separator />
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Payment</h3>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 [&>div]:min-w-0">
                  <div><Label className="text-xs">Net Amount</Label><p className="font-medium tabular-nums">{formatInr(entry.netAmount)}</p></div>
                  <div><Label className="text-xs">Paid</Label><p className="font-medium tabular-nums">{formatInr(paidOf(entry))}</p></div>
                  <div><Label className="text-xs">Balance</Label><p className="font-medium tabular-nums">{formatInr(balanceOf(entry))}</p></div>
                </div>
                {payments.length > 0 && (
                  <Table containerClassName="rounded-md border">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Voucher No.</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Instrument No.</TableHead>
                        <TableHead>Instrument Date</TableHead>
                        {showAccount && <TableHead>Account</TableHead>}
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((payment, index) => (
                        <TableRow key={`${payment.bankPaymentId}-${payment.lineId}-${index}`}>
                          <TableCell className="whitespace-nowrap font-medium">
                            {payment.bankPaymentId ? (
                              <Link href={voucherHref(payment.bankPaymentId)} className="text-primary underline-offset-2 hover:underline">
                                {payment.voucherNo || 'View voucher'}
                              </Link>
                            ) : (
                              payment.voucherNo || '—'
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{payment.mode || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap">{payment.instrumentNo || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDay(payment.instrumentDate)}</TableCell>
                          {showAccount && <TableCell className="whitespace-nowrap">{accountNames.get(payment.accountId) ?? '—'}</TableCell>}
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(payment.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {entry.manualPaid && <p className="text-xs text-muted-foreground">{manualPaidNote}</p>}
              </section>
            </>
          )}

          {entry.attachments && entry.attachments.length > 0 && (
            <div>
              <Label className="text-xs">Attachments</Label>
              <div className="mt-1 space-y-2">
                {entry.attachments.map((file, index) => (
                  <div key={index} className="flex items-center justify-between gap-2 rounded-md bg-muted p-2">
                    <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                      <Paperclip className="h-4 w-4 shrink-0" />
                      <span className="truncate text-sm font-medium">{file.name}</span>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <Button asChild variant="outline" size="sm" className="mr-2 h-7">
                        <a href={file.url} target="_blank" rel="noopener noreferrer">
                          <Eye className="mr-2 h-3 w-3" /> View
                        </a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="h-7">
                        <a href={file.url} download={file.name}>
                          <Download className="mr-2 h-3 w-3" /> Download
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {explainLock && (
          <div className="no-print flex shrink-0 items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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

        <DialogFooter className="hr-dialog-footer no-print flex-wrap gap-2 sm:shrink-0 sm:justify-end sm:space-x-0">
          <Button variant="outline" onClick={handlePrint} size="sm">
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
          <DialogClose asChild>
            <Button variant="outline" size="sm">Close</Button>
          </DialogClose>
          {offerReceive && (
            <Button onClick={handleReceive} disabled={busy !== null} size="sm">
              {spinner('receive')}
              Mark as Received
            </Button>
          )}
          {offerReturn && (
            <Button variant="secondary" onClick={handleReturnToPending} disabled={busy !== null} size="sm">
              {spinner('return')}
              Return to Pending
            </Button>
          )}
          {entry.documentStatus === 'Pending' && canMarkMissing && (
            <Button variant="secondary" onClick={() => handleDocumentStatusUpdate('Missing')} disabled={busy !== null} size="sm">
              {spinner('missing')}
              Mark as Missing
            </Button>
          )}
          {entry.documentStatus === 'Pending' && canMarkNotRequired && (
            <Button variant="secondary" onClick={() => handleDocumentStatusUpdate('Not Required')} disabled={busy !== null} size="sm">
              {spinner('not-required')}
              Mark as Not Required
            </Button>
          )}
          {offerCancel && (
            <Button variant="destructive" onClick={() => setConfirmCancelOpen(true)} disabled={busy !== null} size="sm">
              Cancel
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
