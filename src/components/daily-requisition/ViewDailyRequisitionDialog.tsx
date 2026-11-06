'use client';

/**
 * One Daily Requisition, in full: where it is in the workflow (a track across the header, from
 * creation through each step that applies to it to payment), who it is with now and how long they
 * have, what it is for and what it comes to, everything that has happened to it (the activity log,
 * each change field by field), and what can be done with it from here.
 *
 * Its own actions are Finance's (Mark as Received, Return to Pending, Cancel) and Manage Documents'
 * (Missing / Not Required); a page that opens it for the person it is with adds that step's own
 * (`stepActions`: Approve or Verify (GST & TDS), Send back, Hand over — workflow-flow.tsx).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { collection, doc, getDocs, limit, query, runTransaction, Timestamp, updateDoc, where } from 'firebase/firestore';
import { format, formatDistanceStrict, formatDistanceToNowStrict, isToday, isValid, parseISO } from 'date-fns';
import {
  ArrowRightLeft,
  Check,
  ClipboardCheck,
  Clock3,
  Download,
  Eye,
  FileText,
  History as HistoryIcon,
  Landmark,
  Link2,
  Loader2,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  Receipt,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CompanyLetterhead } from '@/components/shared/company-letterhead';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  avatarTone,
  changesOf,
  formatAuditValue,
  humanizeField,
  logDate,
  toAuditLog,
  userLabel,
  type AuditLogEntry,
} from '@/components/shared/record-history';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { formatDay, formatInr } from '@/lib/bank-balance-ledger';
import { isPaymentStageStatus } from '@/lib/bank-payments';
import { amountInWords } from '@/lib/daily-requisition-print';
import { db } from '@/lib/firebase';
import { personOptionLabel } from '@/lib/people-directory';
import { balanceOf, isPaymentLocked, paidOf, voucherHref } from '@/lib/requisition-progress';
import { registrationLabel } from '@/lib/gst-registrations';
import { treatmentWarning, useBillRegistration } from '@/components/expenses/bill-registration';
import type { BankAccount, DailyRequisitionEntry, Department, ExpenseRequest, Project, WorkflowStep } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  approvalActionsOf,
  assignedStageOf,
  heldStep,
  holdForMove,
  isHeld,
  placeSteps,
  positionOf,
  resolveStepAssignees,
  stageOfStatus,
  verifiesGst,
  type PlacedStep,
} from '@/lib/daily-requisition-flow';
import { useDailyRequisitionWorkflowSteps } from '@/components/daily-requisition/nav';
import { BANNER_DIALOG_CLASS } from '@/components/daily-requisition/GstTdsVerificationDialog';
import { dueText, useStepDeadline } from '@/components/daily-requisition/step-deadline';
import { FlowTrail } from '@/components/daily-requisition/workflow-flow';

interface StepAction {
  label: string;
  onClick: () => void;
}

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
  /**
   * What the step it is at offers the person it is with, from the page that knows (a Verification
   * step's: Approve, Verify (GST & TDS), Send back, Hand over). Each closes this dialog first.
   */
  stepActions?: { approve?: StepAction; gstVerify?: StepAction; sendBack?: StepAction; handOver?: StepAction; reject?: StepAction };
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
/** "10:52" today, "6 Nov, 10:52" otherwise. */
const shortWhen = (date: Date) => (isToday(date) ? format(date, 'HH:mm') : format(date, 'd MMM, HH:mm'));

const amountOf = (value: unknown) => Number(value) || 0;

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
  /** What to write, worked out from the requisition as the transaction read it. */
  fields: (userId: string, current: DailyRequisitionEntry) => Record<string, unknown>;
  /** Unlink the expense request (DEP) this requisition was received from, so it can be received again. */
  releaseExpenseRequest?: boolean;
  done: string;
}

/* ── where it is ────────────────────────────────────────────────────────── */

type StopState = 'done' | 'current' | 'next';

interface Stop {
  key: string;
  label: string;
  state: StopState;
  /** When it was done there, where that is recorded. */
  when: Date | null;
  note: string;
}

interface Progress {
  stops: Stop[];
  /** The step it waits at (null at the payment page, or once paid or cancelled). */
  currentStep: PlacedStep<WorkflowStep> | null;
  /** At the payment page, waiting to be paid. */
  atPayment: boolean;
  /** Since when it has waited where it is. */
  since: Date | null;
}

/**
 * The track: created, then every step of the workflow that applies to it (an approval step that
 * names nobody for its project or department passes it by), then payment — each done, current or
 * still to come, with when it was done where that is recorded.
 */
function progressOf(steps: WorkflowStep[], entry: DailyRequisitionEntry): Progress {
  const placed = placeSteps(steps);
  const status = entry.status || 'Pending';
  const trail = entry.flowTrail ?? [];
  const held = heldStep(placed, entry);
  const closed = status === 'Paid' || status === 'Cancelled';
  const atPayment = !held && (status === 'Received for Payment' || status === 'Partially Paid');
  const position = closed || atPayment ? null : positionOf(placed, entry);
  const created = toDate(entry.createdAt) ?? toDate(entry.date);

  const stops: Stop[] = [{ key: 'created', label: 'Created', state: 'done', when: created, note: '' }];
  let currentStep: PlacedStep<WorkflowStep> | null = null;
  for (const p of placed) {
    const applies = p.role === 'verification' ? p.segment !== null && resolveStepAssignees(p.step, entry).length > 0 : p.roles.length > 0;
    if (!applies) continue;
    const state: StopState =
      status === 'Paid' || atPayment ? 'done' : position === null ? 'next' : p.index < position ? 'done' : p.index === position ? 'current' : 'next';
    const verified = [...trail].reverse().find((e) => e.stepKey === p.key && e.action === 'Verified');
    const when =
      state !== 'done'
        ? null
        : p.role === 'verification'
          ? toDate(verified?.at)
          : p.roles.includes('gst') && entry.verifiedAt
            ? toDate(entry.verifiedAt)
            : p.roles.includes('receiving')
              ? toDate(entry.receivedAt)
              : null;
    stops.push({ key: p.key, label: p.step.name, state, when, note: '' });
    if (state === 'current') currentStep = p;
  }
  stops.push({
    key: 'payment',
    label: 'Payment',
    state: status === 'Paid' ? 'done' : atPayment ? 'current' : 'next',
    when: status === 'Paid' ? (toDate(entry.paidAt) ?? toDate(entry.lastPaidAt)) : null,
    note: '',
  });

  // Since when it has waited: at a Verification step since it got there (or was handed on), at a
  // stage handed to someone since then, otherwise since the last thing done before it.
  let lastDone: Date | null = null;
  for (const stop of stops) {
    if (stop.state === 'done' && stop.when) lastDone = stop.when;
  }
  const assigned = currentStep && assignedStageOf(placed, entry)?.index === currentStep.index;
  const since = held ? toDate(entry.heldSince) : assigned ? toDate(entry.assignedSince) : currentStep || atPayment ? lastDone : null;

  // Each stop's note: when, and how long it took; where it waits, for how long.
  let previous: Date | null = null;
  for (const stop of stops) {
    if (stop.state === 'done') {
      stop.note = stop.when ? `${shortWhen(stop.when)}${previous && stop.key !== 'created' ? ` · ${formatDistanceStrict(stop.when, previous)}` : ''}` : 'done';
      if (stop.when) previous = stop.when;
    } else if (stop.state === 'current') {
      stop.note = since ? `waiting · ${formatDistanceToNowStrict(since)}` : 'waiting';
    } else {
      stop.note = status === 'Cancelled' ? 'cancelled' : '—';
    }
  }
  return { stops, currentStep, atPayment, since };
}

/* ── the dialog ─────────────────────────────────────────────────────────── */

export default function ViewDailyRequisitionDialog({
  isOpen,
  onOpenChange,
  entry,
  projects,
  departments,
  expenseRequest,
  bankAccounts,
  onActionComplete,
  stepActions,
}: ViewDailyRequisitionDialogProps) {
  const { can } = useAuthorization();
  /** Which of the company's GST registrations this bill belongs to (src/lib/gst-registrations.ts). */
  const bill = useBillRegistration({
    gstRegistrationId: entry?.gstRegistrationId,
    projectId: entry?.projectId,
    departmentId: entry?.departmentId,
  });
  const { user, users } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  /** The workflow, for its Verification steps: receiving one here lands it at the first of them. */
  const { steps: workflowSteps } = useDailyRequisitionWorkflowSteps();

  const progress = useMemo(() => (entry ? progressOf(workflowSteps, entry) : null), [workflowSteps, entry]);
  const currentStep = progress?.currentStep ?? null;
  const deadline = useStepDeadline(progress?.since ?? null, Number(currentStep?.step.tat) || 0);

  const handleOpenChange = (open: boolean) => {
    if (!open) setConfirmCancelOpen(false);
    onOpenChange(open);
  };

  const handlePrint = () => {
    if (!entry) return;
    window.open(`/daily-requisition/entry-sheet/${entry.id}/print`, '_blank');
  };

  /** A link that finds it on the Entry Sheet. */
  const copyLink = async () => {
    if (!entry) return;
    const url = `${window.location.origin}/daily-requisition/entry-sheet?q=${encodeURIComponent(entry.receptionNo || entry.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied', description: 'It opens the Entry Sheet, searched for this requisition.' });
    } catch {
      toast({ title: 'Could not copy', description: url });
    }
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

        tx.update(requisitionRef, change.fields(user.id, current));
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
      fields: (userId, current) => ({
        status: 'Received',
        receivedAt: Timestamp.now(),
        receivedById: userId,
        ...holdForMove(workflowSteps, current, 'Received', Timestamp.now()),
      }),
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
      fields: (_userId, current) => ({
        status: 'Pending',
        receivedAt: null,
        receivedById: null,
        ...holdForMove(workflowSteps, current, 'Pending', Timestamp.now()),
      }),
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
      fields: (_userId, current) => ({ status: 'Cancelled', ...holdForMove(workflowSteps, current, 'Cancelled', Timestamp.now()) }),
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

  if (!entry || !progress) return null;

  const status = entry.status || 'Pending';
  const payments = entry.payments ?? [];
  const locked = isPaymentLocked(entry);
  const treatment = treatmentWarning(bill, entry.gstNo, entry.gstType);
  const showPayment = locked || !!entry.manualPaid || isPaymentStageStatus(entry.status);

  const accountNames = new Map((bankAccounts ?? []).map((a) => [a.id, (a.shortName || a.bankName || 'Unknown').trim()]));
  const showAccount = payments.some((p) => accountNames.has(p.accountId));

  const canReceive = can('Mark as Received', 'Daily Requisition.Receiving at Finance');
  const canReturn = can('Return to Pending', 'Daily Requisition.Receiving at Finance');
  const canCancel = can('Cancel', 'Daily Requisition.Receiving at Finance');
  const canMarkMissing = can('Mark as Missing', 'Daily Requisition.Manage Documents');
  const canMarkNotRequired = can('Mark as Not Required', 'Daily Requisition.Manage Documents');
  const canUpload = can('Upload', 'Daily Requisition.Manage Documents');

  // Mark as Received is the Receiving at Finance step, so only for a requisition waiting there —
  // not one still at a Verification step before Finance, nor on a later stage, where it would move
  // backwards. Once any money has gone out, nothing here may send it back or cancel it: the payment
  // voucher owns it.
  const offerReceive = canReceive && status === 'Pending' && !locked && !isHeld(workflowSteps, entry);
  const offerReturn = canReturn && status === 'Received' && !locked;
  const offerCancel = canCancel && status !== 'Cancelled' && !locked;
  const explainLock = locked && status !== 'Cancelled' && (canReceive || canReturn || canCancel);

  const projectName = projects.find((p) => p.id === entry.projectId)?.projectName || 'N/A';
  const departmentName = departments.find((d) => d.id === entry.departmentId)?.name || 'N/A';
  const nameOf = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u?.name || u?.email || id;
  };
  const titleOf = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u ? (personOptionLabel(u, undefined, { separator: '\u0000' }).split('\u0000')[1] ?? '') : '';
  };

  /* ── who it is with, and what they do there ── */
  const placed = placeSteps(workflowSteps);
  const assignedHere = currentStep ? assignedStageOf(placed, entry)?.index === currentStep.index : false;
  const holders: string[] = currentStep
    ? currentStep.role === 'verification'
      ? (entry.heldAssignees ?? [])
      : assignedHere
        ? (entry.assignedTo ?? [])
        : resolveStepAssignees(currentStep.step, entry)
    : [];
  const stageWide = Boolean(currentStep && currentStep.role !== 'verification' && !assignedHere);
  const approval = approvalActionsOf(currentStep?.step);
  const doing = !currentStep
    ? progress.atPayment
      ? 'pay'
      : ''
    : currentStep.role === 'verification'
      ? approval.forward
        ? approval.forward.toLowerCase()
        : 'verify GST & TDS'
      : stageOfStatus(status) === 'receiving'
        ? 'receive'
        : verifiesGst(currentStep.step) && status !== 'Verified'
          ? 'verify GST & TDS'
          : 'send for payment';
  const tat = Number(currentStep?.step.tat) || 0;
  const now = new Date();
  const due = deadline ? dueText(deadline, now) : null;
  const waitedShare =
    deadline && progress.since ? Math.min(1, Math.max(0.02, (now.getTime() - progress.since.getTime()) / Math.max(1, deadline.getTime() - progress.since.getTime()))) : null;

  // Someone who verified it at an earlier step is among those approving it now: one person, checking twice.
  const earlierKeys = new Set(currentStep ? placed.slice(0, currentStep.index).map((p) => p.key) : []);
  const earlierVerifiers = new Map(
    (entry.flowTrail ?? []).filter((e) => e.action === 'Verified' && earlierKeys.has(e.stepKey)).map((e) => [e.userId, e]),
  );
  const twice = currentStep?.role === 'verification' ? holders.filter((id) => earlierVerifiers.has(id)) : [];

  const statusChip =
    status === 'Paid'
      ? { text: 'Paid', tone: 'bg-green-200 text-green-900' }
      : status === 'Cancelled'
        ? { text: 'Cancelled', tone: 'bg-rose-200 text-rose-900' }
        : { text: progress.atPayment ? (status === 'Partially Paid' ? 'Part paid' : 'At Payment') : `At ${currentStep?.step.name ?? status}`, tone: 'bg-yellow-300 text-yellow-900', live: true };

  const gst = amountOf(entry.igstAmount) + amountOf(entry.cgstAmount) + amountOf(entry.sgstAmount);
  const retentionAndOther = amountOf(entry.retentionAmount) + amountOf(entry.otherDeduction);
  const manualPaidNote = `Marked paid by hand (outside Bank Balance)${entry.paidByName ? ` by ${entry.paidByName}` : ''}${
    entry.paidAt ? ` on ${formatDateSafe(entry.paidAt)}` : ''
  }.`;
  const attachments = entry.attachments ?? [];

  const spinner = (action: BusyAction) => (busy === action ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null);
  const runStepAction = (action: StepAction) => {
    handleOpenChange(false);
    action.onClick();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn('hr-mobile-dialog max-w-[98vw] gap-0 p-0 sm:max-w-[980px]', BANNER_DIALOG_CLASS)}
        style={{ scrollbarGutter: 'auto' }}
        windowTitle={entry.receptionNo}
      >
        {/* ── header: what it is, and where it is ── */}
        <header className="hr-dialog-header keep-light no-print relative shrink-0 overflow-hidden bg-gradient-to-r from-teal-700 via-blue-600 to-violet-600 px-5 pb-4 pt-[18px] text-white sm:px-[22px]">
          <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(420px_200px_at_95%_0%,rgba(245,158,11,0.6),transparent_65%)]" aria-hidden />
          <div className="relative flex items-start gap-3.5 pr-24">
            <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] bg-white/20">
              <ClipboardCheck className="h-[22px] w-[22px]" />
            </span>
            <div className="min-w-0">
              <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-white/75">Daily requisition</p>
              <DialogTitle className="my-0.5 flex flex-wrap items-center gap-2.5 text-xl font-extrabold leading-tight text-white">
                <span className="break-all font-mono text-lg">{entry.receptionNo}</span>
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-extrabold', statusChip.tone)}>
                  {statusChip.live && <i className="h-[7px] w-[7px] animate-pulse rounded-full bg-yellow-700" aria-hidden />}
                  {statusChip.text}
                </span>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-sky-100">
                {entry.depNo ? (
                  <span>
                    From expense request <span className="font-mono font-bold text-white">{entry.depNo}</span>
                  </span>
                ) : (
                  <span>Entered on the Entry Sheet</span>
                )}
                <span aria-hidden>·</span>
                <span>dated {formatDateSafe(entry.date)}</span>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="hr-inline-action inline-flex items-center gap-1 rounded-md bg-white/15 px-1.5 py-0.5 text-[11.5px] font-bold text-white hover:bg-white/25"
                >
                  <Link2 className="h-3.5 w-3.5" /> Copy link
                </button>
              </DialogDescription>
            </div>
          </div>

          <ol
            className="relative mt-4 grid overflow-x-auto"
            style={{ gridTemplateColumns: `repeat(${progress.stops.length}, minmax(84px, 1fr))` }}
            aria-label="Where it is"
          >
            {progress.stops.map((stop, i) => (
              <li key={stop.key} className="relative flex flex-col items-center px-1 text-center text-[11.5px]">
                {i > 0 && (
                  <span
                    aria-hidden
                    className={cn('absolute right-1/2 top-[15px] h-[3px] w-full', stop.state === 'next' ? 'bg-white/25' : 'bg-white')}
                  />
                )}
                <span
                  className={cn(
                    'relative z-[1] grid h-8 w-8 place-items-center rounded-full border-2 text-[11px] font-extrabold',
                    stop.state === 'done' && 'border-white bg-white text-teal-700',
                    stop.state === 'current' && 'border-yellow-300 bg-yellow-300 text-yellow-900 shadow-[0_0_0_5px_rgba(253,224,71,0.25)]',
                    stop.state === 'next' && 'border-white/40 bg-white/15',
                  )}
                >
                  {stop.state === 'done' ? <Check className="h-[15px] w-[15px]" strokeWidth={3} /> : i + 1}
                </span>
                <b className="mt-1.5 line-clamp-2 text-[12.5px] leading-tight">{stop.label}</b>
                <small className="text-blue-100">{stop.note}</small>
              </li>
            ))}
          </ol>
        </header>

        {/* ── body ── */}
        <div className="hr-dialog-body grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
          <div className="min-w-0 px-4 py-4 sm:px-[22px] lg:overflow-y-auto">
            <CompanyLetterhead compact title={`Daily Requisition - ${entry.receptionNo}`} className="mb-2 hidden print:block" />

            {twice.length > 0 && (
              <div className="mb-3.5 flex items-start gap-2.5 rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <span>
                  <b>Same person verifying and approving.</b> {twice.map(nameOf).join(', ')} verified this at{' '}
                  {[...new Set(twice.map((id) => earlierVerifiers.get(id)?.stepName ?? 'an earlier step'))].join(', ')} and{' '}
                  {twice.length === 1 ? 'is' : 'are'} also approving it here. Consider handing it to someone else, or set a different approver in
                  Workflow Configuration.
                </span>
              </div>
            )}

            {/* Who is paid, for what, and how much */}
            <div className="grid grid-cols-1 items-center gap-4 rounded-[18px] border bg-gradient-to-r from-slate-50 to-background p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-blue-400 to-blue-700 font-extrabold text-white">
                  {(entry.partyName || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                </span>
                <div className="min-w-0">
                  <small className="block text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">Paid to</small>
                  <b className="block break-words text-base">{entry.partyName || '—'}</b>
                  <p className={cn('whitespace-pre-wrap break-words text-[12.5px]', entry.description?.trim() ? 'text-muted-foreground' : 'italic text-muted-foreground')}>
                    {entry.description?.trim() || 'No description'}
                  </p>
                </div>
              </div>
              <div className="sm:text-right">
                <small className="block text-[11px] font-extrabold uppercase tracking-[0.06em] text-emerald-700">Net amount</small>
                <b className="block text-[28px] font-extrabold leading-tight tracking-tight text-emerald-700 tabular-nums">{formatInr(entry.netAmount)}</b>
                <span className="text-[11.5px] text-muted-foreground">{amountInWords(amountOf(entry.netAmount))}</span>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <Fact label="Project">{projectName}</Fact>
              <Fact label="Department">{departmentName}</Fact>
              <Fact label="Reception date">{formatDateSafe(entry.date)}</Fact>
              <Fact label="Created">{toDate(entry.createdAt) ? format(toDate(entry.createdAt) as Date, 'dd MMM, HH:mm') : 'N/A'}</Fact>
              {expenseRequest && <Fact label="Head of A/c">{expenseRequest.headOfAccount || '—'}</Fact>}
              {expenseRequest && <Fact label="Sub-head of A/c">{expenseRequest.subHeadOfAccount || '—'}</Fact>}
            </dl>

            {/* What it comes to */}
            <Heading aside={entry.verifiedAt ? <Chip tone="grey">Recorded at verification · {formatDateSafe(entry.verifiedAt)}</Chip> : <Chip tone="grey">Not verified yet</Chip>}>
              Amount breakdown
            </Heading>
            <div className="overflow-hidden rounded-2xl border">
              <MoneyRow label="Gross amount" value={formatInr(entry.grossAmount)} />
              {entry.taxableValue !== undefined && Math.abs(amountOf(entry.taxableValue) - amountOf(entry.grossAmount)) > 0.01 && (
                <MoneyRow label="Taxable value" value={formatInr(entry.taxableValue)} quiet />
              )}
              <MoneyRow
                label={`GST${entry.gstType && entry.gstType !== 'none' ? ` · ${entry.gstType === 'igst' ? 'IGST' : 'CGST + SGST'}${entry.gstRate ? ` ${entry.gstRate}%` : ''}` : ''}${entry.gstInclusive ? ' (in the gross)' : ''}`}
                value={gst ? formatInr(gst) : 'None'}
                quiet
              />
              <MoneyRow
                label={`TDS${entry.tdsSection && entry.tdsSection !== 'none' ? ` · ${entry.tdsSection.split('-')[0]} @ ${entry.tdsRate ?? 0}%` : ''}`}
                value={amountOf(entry.tdsAmount) ? `− ${formatInr(entry.tdsAmount)}` : 'None'}
                quiet
              />
              <MoneyRow
                label={`Retention · Other deduction${entry.otherDeductionReason ? ` (${entry.otherDeductionReason})` : ''}`}
                value={retentionAndOther ? `− ${formatInr(retentionAndOther)}` : formatInr(0)}
                quiet
              />
              <MoneyRow label="Net payable" value={formatInr(entry.netAmount)} total />
            </div>
            {(entry.gstNo || entry.panNo || entry.invoiceNo || bill.canChoose || treatment || entry.reverseCharge || entry.verificationNotes?.trim()) && (
              <dl className="mt-2.5 grid grid-cols-2 gap-2.5 md:grid-cols-3">
                {bill.canChoose && (
                  <Fact label="GST registration">
                    {registrationLabel(bill.registration)}
                    {bill.registration ? <span className="block font-mono text-xs font-normal text-muted-foreground">{bill.registration.gstin}</span> : null}
                  </Fact>
                )}
                {entry.gstNo?.trim() && <Fact label="Party GSTIN" mono>{entry.gstNo}</Fact>}
                {entry.panNo && <Fact label="PAN" mono>{entry.panNo}</Fact>}
                {entry.invoiceNo && (
                  <Fact label="Invoice">
                    {entry.invoiceNo}
                    {entry.invoiceDate ? <span className="block text-xs font-normal text-muted-foreground">{formatDateSafe(entry.invoiceDate)}</span> : null}
                  </Fact>
                )}
                {entry.verificationNotes?.trim() && (
                  <div className="col-span-2 md:col-span-3">
                    <Fact label="Verification notes">
                      <span className="whitespace-pre-wrap font-normal">{entry.verificationNotes.trim()}</span>
                    </Fact>
                  </div>
                )}
                {treatment && <p className="col-span-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 md:col-span-3">{treatment.message}</p>}
                {entry.reverseCharge && (
                  <p className="col-span-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 md:col-span-3">Reverse charge — GST is not paid to the supplier.</p>
                )}
              </dl>
            )}

            {showPayment && (
              <>
                <Heading>Payment</Heading>
                <div className="grid grid-cols-3 gap-2">
                  <Figure label="Net amount" value={formatInr(entry.netAmount)} />
                  <Figure label="Paid" value={formatInr(paidOf(entry))} tone="emerald" />
                  <Figure label="Balance" value={formatInr(balanceOf(entry))} tone={balanceOf(entry) > 0 ? 'amber' : undefined} />
                </div>
                {payments.length > 0 && (
                  <Table containerClassName="mt-2.5 rounded-lg border">
                    <TableHeader>
                      <TableRow className="bg-slate-50">
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
                {entry.manualPaid && <p className="mt-2 text-xs text-muted-foreground">{manualPaidNote}</p>}
              </>
            )}

            {explainLock && (
              <div className="no-print mt-3.5 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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

            {/* Everything that has happened to it. Keyed so another requisition starts afresh. */}
            <History
              key={entry.id}
              entry={entry}
              steps={workflowSteps}
              now={
                currentStep || progress.atPayment
                  ? {
                      who: holders.length ? holders.map(nameOf).join(', ') : progress.atPayment ? 'Finance' : `whoever works ${currentStep?.step.name}`,
                      doing,
                      where: currentStep?.step.name ?? 'Payment',
                      since: progress.since,
                      tat,
                    }
                  : null
              }
            />
          </div>

          {/* ── the side: who has it, what it links to, its files ── */}
          <aside className="no-print flex min-w-0 flex-col gap-3.5 border-t bg-slate-50 p-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <SideBox title="Now with" aside={currentStep?.step.name ?? (progress.atPayment ? 'Payment' : undefined)}>
              {currentStep || progress.atPayment ? (
                <>
                  {holders.length > 0 ? (
                    <div className="space-y-2">
                      {holders.slice(0, 3).map((id) => (
                        <div key={id} className="flex items-center gap-2.5">
                          <span className={cn('grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full text-xs font-extrabold', avatarTone(id))}>
                            {nameOf(id).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <b className="block truncate text-[13.5px]">{nameOf(id)}</b>
                            <small className="block truncate text-xs text-muted-foreground">
                              {[titleOf(id), id === user?.id ? "that's you" : ''].filter(Boolean).join(' · ') || '—'}
                            </small>
                          </div>
                        </div>
                      ))}
                      {holders.length > 3 && <small className="text-xs text-muted-foreground">+ {holders.length - 3} more</small>}
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-muted-foreground">
                      {progress.atPayment ? 'Whoever holds the Processed for Payment permissions.' : 'Nobody is named on this step for it.'}
                    </p>
                  )}
                  {stageWide && holders.length > 0 && (
                    <p className="mt-1.5 text-[11.5px] text-muted-foreground">…and anyone with this step&apos;s permissions.</p>
                  )}
                  {progress.since && tat > 0 && (
                    <div className="mt-2.5">
                      <div className="flex justify-between text-xs font-bold text-muted-foreground">
                        <span>Waiting {formatDistanceToNowStrict(progress.since)}</span>
                        <span>{tat} h allowed</span>
                      </div>
                      <div className="mt-1.5 h-[7px] overflow-hidden rounded bg-slate-200">
                        <i
                          className={cn(
                            'block h-full rounded',
                            due?.late ? 'bg-rose-500' : (waitedShare ?? 0) > 0.75 ? 'bg-amber-500' : 'bg-gradient-to-r from-green-300 to-green-600',
                          )}
                          style={{ width: `${Math.round((waitedShare ?? 0.02) * 100)}%` }}
                        />
                      </div>
                      {due && <p className={cn('mt-1 text-xs font-bold', due.late ? 'text-rose-700' : due.soon ? 'text-amber-700' : 'text-muted-foreground')}>{due.text}</p>}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">{status === 'Paid' ? 'Paid — nothing waits on anyone.' : status === 'Cancelled' ? 'Cancelled.' : 'Not at a step.'}</p>
              )}
            </SideBox>

            <SideBox title="Linked records">
              <LinkedRow icon={Receipt} tone="from-rose-400 to-rose-600" title="Expense request" detail={entry.depNo || 'None — entered directly'} mono={Boolean(entry.depNo)} />
              <LinkedRow
                icon={Landmark}
                tone="from-indigo-400 to-indigo-800"
                title="Payment"
                detail={
                  payments.length
                    ? `${payments.length} voucher${payments.length === 1 ? '' : 's'} · ${formatInr(paidOf(entry))} paid`
                    : entry.manualPaid
                      ? 'Paid by hand'
                      : 'Not paid yet'
                }
                href={payments[0]?.bankPaymentId ? voucherHref(payments[0].bankPaymentId) : undefined}
              />
            </SideBox>

            <SideBox title="Attachments" aside={String(attachments.length)}>
              {attachments.length > 0 ? (
                <ul className="space-y-1.5">
                  {attachments.map((file, index) => (
                    <li key={index} className="flex min-w-0 items-center gap-1 rounded-lg border bg-background py-1 pl-2.5 pr-1 text-[12.5px]">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate font-medium" title={file.name}>
                        {file.name}
                      </span>
                      <Button asChild variant="ghost" size="icon" className="hr-inline-action h-7 w-7" title="View">
                        <a href={file.url} target="_blank" rel="noopener noreferrer" aria-label={`View ${file.name}`}>
                          <Eye className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button asChild variant="ghost" size="icon" className="hr-inline-action h-7 w-7" title="Download">
                        <a href={file.url} download={file.name} aria-label={`Download ${file.name}`}>
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl border-[1.5px] border-dashed border-slate-300 p-3 text-center text-[12.5px] font-semibold text-muted-foreground">
                  <FileText className="mx-auto mb-1 h-4 w-4" />
                  No bill attached
                  {canUpload && (
                    <Link href="/daily-requisition/manage-documents" className="mt-0.5 block font-bold text-indigo-600 hover:underline">
                      + Attach one in Manage Documents
                    </Link>
                  )}
                </div>
              )}
            </SideBox>
          </aside>
        </div>

        {/* ── what can be done from here ── */}
        <footer className="hr-dialog-footer no-print flex shrink-0 flex-wrap items-center gap-2 border-t bg-background px-4 py-3 sm:px-[22px]">
          <Button variant="ghost" onClick={handlePrint} size="sm">
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
              <X className="mr-1.5 h-4 w-4" /> Cancel requisition
            </Button>
          )}
          {stepActions?.reject && (
            <Button
              variant="outline"
              size="sm"
              className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => runStepAction(stepActions.reject as StepAction)}
            >
              <X className="mr-1.5 h-4 w-4" /> {stepActions.reject.label}
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
          <span className="hidden flex-1 sm:block" />
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Close
            </Button>
          </DialogClose>
          {offerReturn && (
            <Button variant="outline" onClick={handleReturnToPending} disabled={busy !== null} size="sm">
              {spinner('return')}
              Return to Pending
            </Button>
          )}
          {stepActions?.sendBack && (
            <Button variant="outline" size="sm" className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800" onClick={() => runStepAction(stepActions.sendBack as StepAction)}>
              <Undo2 className="mr-1.5 h-4 w-4" /> {stepActions.sendBack.label}
            </Button>
          )}
          {stepActions?.handOver && (
            <Button variant="outline" size="sm" onClick={() => runStepAction(stepActions.handOver as StepAction)}>
              <ArrowRightLeft className="mr-1.5 h-4 w-4" /> {stepActions.handOver.label}
            </Button>
          )}
          {stepActions?.gstVerify && (
            <Button size="sm" className="border-0 bg-gradient-to-r from-teal-700 via-blue-600 to-violet-600 text-white" onClick={() => runStepAction(stepActions.gstVerify as StepAction)}>
              <ShieldCheck className="mr-1.5 h-4 w-4" /> {stepActions.gstVerify.label}
            </Button>
          )}
          {stepActions?.approve && (
            <Button size="sm" className="border-0 bg-gradient-to-r from-teal-700 to-green-600 text-white" onClick={() => runStepAction(stepActions.approve as StepAction)}>
              <Check className="mr-1.5 h-4 w-4" /> {stepActions.approve.label}
            </Button>
          )}
          {offerReceive && (
            <Button onClick={handleReceive} disabled={busy !== null} size="sm">
              {spinner('receive')}
              Mark as Received
            </Button>
          )}
        </footer>

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

/* ── history ────────────────────────────────────────────────────────────── */

interface Waiting {
  who: string;
  doing: string;
  where: string;
  since: Date | null;
  tat: number;
}

/** What the activity log calls each kind of action: its badge's icon and colour. */
function actionLook(action: string): { icon: typeof Check; tone: string } {
  const a = action.toLowerCase();
  if (/cancel|reject|delete/.test(a)) return { icon: X, tone: 'bg-rose-600' };
  if (/hand over|handed/.test(a)) return { icon: ArrowRightLeft, tone: 'bg-violet-600' };
  if (/send back|sent back|return|revise/.test(a)) return { icon: Undo2, tone: 'bg-amber-500' };
  if (/verif|approv|receiv|paid|send for payment/.test(a)) return { icon: Check, tone: 'bg-green-600' };
  if (/add|create|import|new/.test(a)) return { icon: Plus, tone: 'bg-blue-600' };
  return { icon: Pencil, tone: 'bg-slate-500' };
}

/** A GST & TDS verification's figures, as chips: what it was recorded as. */
function verificationChips(details: Record<string, unknown>): Array<{ text: string; tone: 'grey' | 'ok' | 'warn' }> {
  const changes = (details.changes ?? {}) as Record<string, { to?: unknown }>;
  const to = (field: string) => changes[field]?.to;
  const chips: Array<{ text: string; tone: 'grey' | 'ok' | 'warn' }> = [];
  const gstType = to('gstType');
  if (gstType !== undefined) chips.push({ text: gstType === 'none' ? 'GST: none' : `GST: ${gstType === 'igst' ? 'IGST' : 'CGST + SGST'}${to('gstRate') ? ` ${to('gstRate')}%` : ''}`, tone: 'grey' });
  const tds = to('tdsAmount');
  if (tds !== undefined) chips.push({ text: Number(tds) ? `TDS: ${formatInr(Number(tds))}` : 'TDS: none', tone: 'grey' });
  const taxable = to('taxableValue');
  if (taxable !== undefined) chips.push({ text: `Taxable value ${formatInr(Number(taxable))}`, tone: 'grey' });
  if (details.amountMismatch === true) chips.push({ text: 'Net differs — for review', tone: 'warn' });
  else if (details.amountMismatch === false || details.atApprovalStep === true) chips.push({ text: 'Net unchanged', tone: 'ok' });
  return chips;
}

/**
 * Everything that has happened to it, newest first, from the activity log: who did what, any note
 * they left, and — opened — each field it changed. Where it waits now heads the list. If the log
 * cannot be read, the workflow trail the requisition carries is shown instead.
 *
 * Closed until asked for ("View history"), and only read from the log then: the dialog opens on
 * what the requisition is and where it stands.
 */
function History({ entry, steps, now }: { entry: DailyRequisitionEntry; steps: WorkflowStep[]; now: Waiting | null }) {
  const [shown, setShown] = useState(false);
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (!shown || logs !== null) return;
    let cancelled = false;
    const logsRef = collection(db, 'userLogs');
    const ref = entry.receptionNo?.trim();
    Promise.all([
      getDocs(query(logsRef, where('recordId', '==', entry.id), limit(300))),
      ref ? getDocs(query(logsRef, where('recordRef', '==', ref), limit(300))) : null,
    ])
      .then((snaps) => {
        if (cancelled) return;
        const byId = new Map<string, AuditLogEntry>();
        snaps.forEach((snap) => snap?.docs.forEach((d) => byId.set(d.id, toAuditLog(d))));
        setLogs([...byId.values()].sort((a, b) => (logDate(b)?.getTime() ?? 0) - (logDate(a)?.getTime() ?? 0)));
      })
      .catch((error) => {
        console.error('Could not load the requisition history', error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shown, logs, entry.id, entry.receptionNo]);

  const created = toDate(entry.createdAt);
  const withChanges = (logs ?? []).filter((l) => changesOf(l.details).length > 0);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="no-print" aria-label="History">
      <Heading
        aside={
          <span className="flex items-center gap-3">
            {shown && withChanges.length > 0 && (
              <button type="button" className="hr-inline-action text-xs font-bold text-indigo-600 hover:underline" onClick={() => setAll((v) => !v)}>
                {all ? 'Hide field changes' : 'Show all field changes'}
              </button>
            )}
            <button
              type="button"
              aria-expanded={shown}
              onClick={() => setShown((v) => !v)}
              className="hr-inline-action inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-bold text-muted-foreground hover:border-violet-400 hover:text-violet-700"
            >
              <HistoryIcon className="h-3.5 w-3.5" /> {shown ? 'Hide history' : 'View history'}
            </button>
          </span>
        }
      >
        History
      </Heading>
      {shown && (
      <ol className="relative">
        {now && (
          <TimelineItem avatar={now.who} badge={{ icon: Clock3, tone: 'bg-amber-500' }} current last={!logs?.length && !failed}>
            <p className="text-[13px]">
              <span className="font-bold text-muted-foreground">Waiting for</span> <b>{now.who}</b>{' '}
              {now.doing && <span className="font-bold text-muted-foreground">to {now.doing}</span>}
            </p>
            <small className="block text-[11.5px] text-muted-foreground">
              {now.where}
              {now.since ? ` · arrived ${formatDistanceToNowStrict(now.since, { addSuffix: true })}` : ''}
              {now.tat > 0 ? ` · ${now.tat} h allowed` : ''}
            </small>
          </TimelineItem>
        )}
        {failed ? (
          <li className="ml-[46px] pb-2">
            <p className="mb-2 text-xs text-muted-foreground">The activity log could not be read here; this is what the requisition records of its workflow.</p>
            <FlowTrail entry={entry} steps={steps} />
          </li>
        ) : logs === null ? (
          <li className="ml-[46px] flex items-center gap-2 pb-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading its history…
          </li>
        ) : logs.length === 0 ? (
          <li className="ml-[46px] pb-2 text-xs text-muted-foreground">No activity recorded yet.</li>
        ) : (
          logs.map((logEntry, index) => {
            const name = userLabel(logEntry);
            const when = logDate(logEntry);
            const details = (logEntry.details ?? {}) as Record<string, unknown>;
            const changes = changesOf(logEntry.details);
            const isOpen = all || open.has(logEntry.id);
            const note = [details.comment, details.note, details.reason].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
            const chips = /gst & tds/i.test(logEntry.action ?? '') ? verificationChips(details) : [];
            return (
              <TimelineItem key={logEntry.id} avatar={name} avatarKey={logEntry.userId || name} badge={actionLook(logEntry.action ?? '')} last={index === logs.length - 1}>
                <p className="text-[13px]">
                  <b>{name}</b> {(logEntry.action || 'did something').toLowerCase()}
                </p>
                <small className="block text-[11.5px] text-muted-foreground">
                  {when ? format(when, 'dd MMM yyyy, HH:mm') : 'Time not recorded'}
                  {when && created && when.getTime() - created.getTime() > 60_000 ? ` · ${formatDistanceStrict(when, created)} after creation` : ''}
                </small>
                {note && <p className="mt-1.5 rounded-r-[10px] border-l-[3px] border-violet-400 bg-slate-50 px-2.5 py-1.5 text-[12.5px] italic text-muted-foreground">“{note.trim()}”</p>}
                {chips.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {chips.map((chip) => (
                      <Chip key={chip.text} tone={chip.tone}>
                        {chip.text}
                      </Chip>
                    ))}
                  </div>
                )}
                {changes.length > 0 && (
                  <>
                    {!all && (
                      <button type="button" className="hr-inline-action mt-1.5 text-xs font-bold text-indigo-600 hover:underline" onClick={() => toggle(logEntry.id)}>
                        {isOpen ? 'Hide field changes ▴' : `Show ${changes.length} field change${changes.length === 1 ? '' : 's'} ▾`}
                      </button>
                    )}
                    {isOpen && (
                      <ul className="mt-2 overflow-hidden rounded-xl border text-xs">
                        {changes.map(([field, change]) => (
                          <li key={field} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-2 border-t px-2.5 py-1.5 first:border-t-0">
                            <span className="truncate text-muted-foreground">{humanizeField(field)}</span>
                            <s className="text-rose-600 no-underline opacity-60">{formatAuditValue(change.from)}</s>
                            <em className="not-italic text-muted-foreground">→</em>
                            <b className="font-bold text-green-700">{formatAuditValue(change.to)}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </TimelineItem>
            );
          })
        )}
      </ol>
      )}
    </section>
  );
}

function TimelineItem({
  avatar,
  avatarKey,
  badge,
  current,
  last,
  children,
}: {
  avatar: string;
  avatarKey?: string;
  badge: { icon: typeof Check; tone: string };
  current?: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  const Icon = badge.icon;
  return (
    <li className="relative grid grid-cols-[34px_minmax(0,1fr)] gap-3 pb-4">
      {!last && <span aria-hidden className="absolute bottom-0 left-4 top-[34px] w-0.5 bg-slate-200" />}
      <span
        className={cn(
          'relative grid h-[34px] w-[34px] place-items-center rounded-full text-[11px] font-extrabold',
          avatarTone(avatarKey ?? avatar),
          current && 'ring-4 ring-amber-200',
        )}
      >
        {avatar.trim().split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'}
        <span className={cn('absolute -bottom-[3px] -right-[3px] grid h-4 w-4 place-items-center rounded-full border-2 border-background text-white', badge.tone)}>
          <Icon className="h-[9px] w-[9px]" strokeWidth={3.4} />
        </span>
      </span>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function Heading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <h3 className="mb-2.5 mt-5 flex items-center gap-2 text-sm font-extrabold">
      {children}
      <span className="flex-1" />
      {aside}
    </h3>
  );
}

function Fact({ label, mono = false, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
      <dt className="text-[11px] font-bold text-muted-foreground">{label}</dt>
      <dd className={cn('break-words text-[13.5px] font-bold', mono && 'font-mono')}>{children}</dd>
    </div>
  );
}

function MoneyRow({ label, value, quiet, total }: { label: string; value: string; quiet?: boolean; total?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 border-t px-3.5 py-2 text-[13px] first:border-t-0', total && 'bg-green-50 font-extrabold')}>
      <span className={total ? undefined : 'text-muted-foreground'}>{label}</span>
      <b className={cn('shrink-0 tabular-nums', quiet && 'font-semibold text-muted-foreground', total && 'text-[15px] text-emerald-700')}>{value}</b>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('truncate text-sm font-semibold tabular-nums', tone === 'emerald' && 'text-emerald-700', tone === 'amber' && 'text-amber-700')}>{value}</p>
    </div>
  );
}

function Chip({ tone, children }: { tone: 'grey' | 'ok' | 'warn'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold',
        tone === 'grey' && 'bg-slate-100 text-slate-600',
        tone === 'ok' && 'bg-green-100 text-green-700',
        tone === 'warn' && 'bg-amber-100 text-amber-700',
      )}
    >
      {children}
    </span>
  );
}

function SideBox({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-background">
      <header className="flex items-center justify-between gap-2 px-3.5 pb-1.5 pt-3 text-[13px] font-extrabold">
        {title}
        {aside && <small className="truncate font-semibold text-muted-foreground">{aside}</small>}
      </header>
      <div className="px-3.5 pb-3">{children}</div>
    </section>
  );
}

function LinkedRow({
  icon: Icon,
  tone,
  title,
  detail,
  mono,
  href,
}: {
  icon: typeof Check;
  tone: string;
  title: string;
  detail: string;
  mono?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <span className={cn('grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-gradient-to-br text-white', tone)}>
        <Icon className="h-[15px] w-[15px]" />
      </span>
      <span className="min-w-0">
        <b className="block">{title}</b>
        <small className={cn('block truncate text-[11.5px] text-muted-foreground', mono && 'font-mono')}>{detail}</small>
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-center gap-2.5 border-b border-dashed py-2 text-[12.5px] last:border-b-0 hover:text-indigo-700">
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-2.5 border-b border-dashed py-2 text-[12.5px] last:border-b-0">{body}</div>
  );
}
