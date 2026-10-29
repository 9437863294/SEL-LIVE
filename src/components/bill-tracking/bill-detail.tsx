'use client';

/**
 * The 360° bill record (`/bill-tracking/bills/[billId]`).
 *
 * Header and amount cards, then tabs: overview, deductions, receipts with the bill's ledger,
 * retention, documents, follow-ups with commitments, comments and the immutable activity trail.
 * Every action posts to the API, which re-checks permission and recomputes the bill; the page then
 * reloads the record rather than patching numbers locally.
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  HandCoins,
  History,
  Hourglass,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  PhoneCall,
  PiggyBank,
  Scissors,
  ShieldCheck,
  StickyNote,
  Trash2,
  Undo2,
  Upload,
  UploadCloud,
  Wallet,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { OverflowActions, type OverflowAction } from '@/components/shared/overflow-actions';
import { TableCard } from '@/components/shared/table-card';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { SectionHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { PM_DIALOG } from '@/components/project-management/pm-shell';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { RETENTION_KINDS, WORKFLOW_PATH, daysBetween, deductionsOfKind, effectiveDeductions, totalDeduction, type LedgerLine } from '@/lib/bill-tracking/calculations';
import { categoryName } from '@/lib/bill-tracking/categories';
import { receiptBlockReason, type CertificationComparison } from '@/lib/bill-tracking/certification';
import { availableActions, certificationBlocked, certificationNotDue, isAfterPayment, isStepEnabled, stepLabel, stepPermissionText, waitingFor, workflowPath, type AvailableMove, type WorkflowMove } from '@/lib/bill-tracking/workflow';
import { formatINR, subtractMoney, sumMoney, toPaise } from '@/lib/bill-tracking/money';
import { billRetentionSlabs, formatRate, releaseSlabKey, retentionSource, type BillSlab, type LineBasis } from '@/lib/bill-tracking/retention';
import {
  AGEING_BASIS_LABELS,
  COMMITMENT_STATUS_LABELS,
  DOCUMENT_CATEGORIES,
  FOLLOW_UP_METHODS,
  PAYMENT_STATUS_LABELS,
  WORKFLOW_STATUS_LABELS,
  type BillWorkflowStatus,
  type CertificationState,
  type Bill,
  type BillActivity,
  type BillDocumentCategory,
  type BillCollection,
  type BillComment,
  type BillDeduction,
  type BillDocument,
  type BillFollowUp,
  type BillPaymentStatus,
  type RetentionRelease,
} from '@/lib/bill-tracking/types';

import { btDownload, btFetch, useBt, useBtQuery, useLookups, useStepLabel, useWorkflowActor } from './bt-client';
import { billReference, type BillRow } from './bill-register';
import { AgeingBadge, Amount, BtEmpty, BtError, BtLoading, Notice, TransactionTypeBadge, dateText, dateTimeText, BT_TAB, BT_TABS_LIST, StatStrip, TabCount } from './bt-ui';

interface Detail {
  bill: BillRow;
  ledger: LedgerLine[];
  collections: BillCollection[];
  followUps: BillFollowUp[];
  comments: BillComment[];
  documents: BillDocument[];
  activity: BillActivity[];
  retention: RetentionRelease[];
  /** Raised vs notes vs the client's certification; null for a credit / debit note. */
  certification: CertificationComparison | null;
  /** Credit / debit notes raised against this invoice. */
  notes: { id: string; transactionType: Bill['transactionType']; billSerialNumber?: string; gstInvoiceNumber?: string; billDate: string; taxableAmount: number; gstAmount: number; grossAmount: number; netReceivable: number }[];
  /**
   * For a note: its invoice's retention as the slabs read it (`retentionSource` — the certified lines
   * and taxable once the client has certified the invoice), which decides the slabs the note's lands in.
   */
  noteInvoice?: Pick<Bill, 'deductions' | 'taxableAmount' | 'grossAmount'> | null;
}


export default function BillDetail({ billId }: { billId: string }) {
  const { data, loading, error, reload } = useBtQuery<Detail>(`bills/${billId}`);
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') ?? 'overview');
  if (loading && !data) return <BtLoading label="Loading bill…" />;
  if (!data) return <BtError message={error ?? 'Bill not found.'} onRetry={reload} />;
  return <DetailBody detail={data} reload={reload} tab={tab} setTab={setTab} />;
}

/** Copies a reference to the clipboard — invoice and bill numbers are long and pasted into mails and portals. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 print:hidden"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={() => void navigator.clipboard.writeText(value).then(() => toast({ title: `${label} copied` }))}
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

type StepTone = 'done' | 'current' | 'attention' | 'pending' | 'danger';

const STEP_DOT: Record<StepTone, string> = {
  done: 'border-emerald-700 bg-emerald-700 text-white',
  current: 'border-emerald-700 bg-emerald-700',
  attention: 'border-amber-500 bg-amber-50',
  pending: 'border-slate-300 bg-white',
  danger: 'border-rose-600 bg-rose-50',
};
const STEP_INNER: Record<StepTone, string | null> = { done: null, current: 'bg-white', attention: 'bg-amber-500', pending: null, danger: 'bg-rose-600' };
const STEP_LABEL: Record<StepTone, string> = { done: 'text-slate-700', current: 'text-slate-900', attention: 'text-amber-800', pending: 'text-slate-400', danger: 'text-rose-700' };
const STEP_CAPTION: Record<StepTone, string> = { done: 'text-slate-500', current: 'text-emerald-700', attention: 'text-amber-700', pending: 'text-slate-400', danger: 'text-rose-700' };


interface PipelineStep {
  status: BillWorkflowStatus;
  label: string;
  /** A word under the stage: "Current", the certification, the payment. */
  caption?: string;
  tone: StepTone;
  current: boolean;
}

/**
 * The bill's pipeline up to its payment — every workflow stage in use (Settings → Workflow switches the optional
 * ones off) — and where it stands on it. Stages behind it are done, its own is current, those ahead
 * are to come. *Certified by client* says what the client did; the payment follow-up stage, which is
 * optional work rather than a milestone, is shown as *Payment* — what has been received.
 */
function billPipeline(bill: BillRow, certificationState: CertificationState | null, settings: Parameters<typeof isStepEnabled>[0]): PipelineStep[] {
  // A returned bill sits at the stage it was returned from, marked as such.
  const at = bill.workflowStatus === 'returned' ? (bill.returnedFrom ?? 'draft') : bill.workflowStatus;
  // The line is the configured workflow up to the payment: reconciliation and closing are
  // book-keeping after it, so a bill at either is past every step shown (the payment step says which).
  const stages = workflowPath(settings).filter((status) => !isAfterPayment(status) && (isStepEnabled(settings, status) || status === at));
  const atIndex = isAfterPayment(at) ? stages.length : stages.indexOf(at);
  const paid = bill.paymentStatus === 'received' || bill.paymentStatus === 'adjusted';
  const partly = bill.paymentStatus === 'partially_received' || bill.paymentStatus === 'over_received';
  return stages.map((status, index) => {
    const current = index === atIndex;
    let tone: StepTone = index < atIndex ? 'done' : current ? 'current' : 'pending';
    let caption: string | undefined = current ? 'Current' : undefined;
    if (current && bill.workflowStatus === 'returned') {
      tone = 'danger';
      caption = 'Returned for correction';
    }
    if (current && bill.isDeleted) {
      tone = 'danger';
      caption = 'Bill deleted';
    }
    if (status === 'certified') {
      if (certificationState === null) {
        caption = isNote(bill.transactionType) ? 'Not needed for a note' : caption;
      } else if (certificationState === 'not_certified') {
        // The client is waiting to certify only once the bill has gone to them (raised); before
        // that the stage is simply ahead, like the rest (certificationNotDue).
        if (atIndex >= stages.indexOf('raised')) {
          tone = 'attention';
          caption = 'Awaiting';
        }
      } else if (certificationState === 'adjustment_pending') {
        tone = 'attention';
        caption = 'Note pending';
      } else {
        tone = index <= atIndex ? (current ? 'current' : 'done') : 'done';
        caption = 'Certified';
      }
    }
    if (status === 'payment_followup') {
      // Following up is optional work, not a milestone: this place on the line shows the payment
      // itself — done once received, amber while part-paid or still unpaid after the bill moved on.
      const caption = current ? `Following up · ${PAYMENT_STATUS_LABELS[bill.paymentStatus]}` : isAfterPayment(at) ? `${PAYMENT_STATUS_LABELS[bill.paymentStatus]} · ${stepLabel(settings, at)}` : PAYMENT_STATUS_LABELS[bill.paymentStatus];
      const tone: StepTone = paid ? 'done' : partly || index < atIndex ? 'attention' : current ? 'current' : 'pending';
      return { status, label: 'Payment', caption, tone, current };
    }
    return { status, label: stepLabel(settings, status), caption, tone, current };
  });
}

const isNote = (type: BillRow['transactionType']) => type === 'credit_note' || type === 'debit_note';

/** The pipeline as a progress line; scrolled so the current stage is in view where it overflows (a phone). */
function Pipeline({ steps }: { steps: PipelineStep[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  const currentIndex = steps.findIndex((step) => step.current);
  useEffect(() => {
    const list = listRef.current;
    const item = list?.children[currentIndex] as HTMLElement | undefined;
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = Math.max(0, item.offsetLeft - list.clientWidth / 2 + item.offsetWidth / 2);
  }, [currentIndex]);
  return (
    <ol ref={listRef} className="flex overflow-x-auto border-t border-slate-200 px-4 py-5 sm:px-6" aria-label="Bill pipeline">
      {steps.map((step, index) => (
        // The last stage has no line after it, so it takes only its label's width — not an equal share
        // left empty — and the line runs the full width of the card, ending at the last dot.
        <li key={step.status} className={cn('min-w-24', index < steps.length - 1 ? 'flex-1' : 'flex-none')} aria-current={step.current ? 'step' : undefined}>
          <div className="flex items-center">
            <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2', STEP_DOT[step.tone], step.current && 'ring-4 ring-emerald-100')} aria-hidden="true">
              {step.tone === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : STEP_INNER[step.tone] ? <span className={cn('h-2 w-2 rounded-full', STEP_INNER[step.tone])} /> : null}
            </span>
            {index < steps.length - 1 ? <span className={cn('mx-2 h-0.5 flex-1 rounded-full', index < currentIndex ? 'bg-emerald-600' : 'bg-slate-200')} aria-hidden="true" /> : null}
          </div>
          <p className={cn('mt-3 pr-3 text-xs font-semibold leading-snug', STEP_LABEL[step.tone])}>{step.label}</p>
          {step.caption ? <p className={cn('mt-0.5 pr-3 text-xs leading-snug', STEP_CAPTION[step.tone])}>{step.caption}</p> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The top of a bill: back, the project it belongs to, what it is called (the GST invoice, or the
 * internal bill number where there is none) and what can be done with it; then, under a rule, its
 * pipeline from draft to payment, with the certification and the payment on their stages. The
 * actions sit on their own row beneath the title; on a phone the pipeline scrolls sideways, opened at
 * the current stage.
 */
function BillHeader({ bill, certificationState, actions }: { bill: BillRow; certificationState: CertificationState | null; actions: ReactNode }) {
  const title = bill.gstInvoiceNumber || bill.billSerialNumber || 'Bill';
  const { config } = useLookups();
  const steps = billPipeline(bill, certificationState, config.settings);
  return (
    <header className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* The actions on a row of their own under the title, at every width: beside it, the workflow
          buttons squeezed the invoice number into two lines. Indented to the title's edge. */}
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <Button asChild variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-lg print:hidden">
            <Link href="/bill-tracking/bills" aria-label="Bill register" title="Bill register">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            {/* The invoice number and its project on one row — the project after a rule, as a link to
                its bills — wrapping only where the screen is too narrow for both. */}
            <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <h1 className="min-w-0 break-all text-xl font-bold leading-tight tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
              <CopyButton value={title} label={bill.gstInvoiceNumber ? 'Invoice number' : 'Bill number'} />
              {bill.transactionType !== 'invoice' ? <TransactionTypeBadge type={bill.transactionType} /> : null}
              <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" aria-hidden="true" />
              <Link href={`/bill-tracking/bills?project=${bill.projectId}&fy=all`} className="min-w-0 max-w-full truncate text-xs font-semibold uppercase tracking-wide text-emerald-700 hover:underline" title={`All bills of ${bill.projectNameSnapshot}`}>
                {bill.projectNameSnapshot}
              </Link>
            </div>
            {/* The long internal bill number is not repeated here: it heads the Overview's
                "Invoice & GST" card, with its own copy button. */}
          </div>
        </div>
        {actions ? <div className="page-header-actions flex w-full min-w-0 flex-wrap items-center gap-2.5 print:hidden sm:pl-14">{actions}</div> : null}
      </div>
      <Pipeline steps={steps} />
    </header>
  );
}

/**
 * The bill's key facts, under its header: dates, client, year and category in a grid that reflows
 * from two columns on a phone to six on a desktop; then what the bill waits for, and — while payment
 * waits for the client's certification — that hold, all in one card rather than a row of tiny labels
 * and a separate banner.
 */
function BillFacts({
  bill,
  category,
  today,
  waitingOn,
  awaitingCertification,
  onOpenCertification,
}: {
  bill: BillRow;
  category: string;
  today: string;
  waitingOn: { stage: string; who: string } | null;
  awaitingCertification: boolean;
  onOpenCertification?: () => void;
}) {
  const overdueDays = bill.overdue && bill.dueDate ? Math.max(0, daysBetween(bill.dueDate, today) ?? 0) : 0;
  const facts: { label: string; value: ReactNode; hint?: ReactNode; wide?: boolean }[] = [
    { label: 'Bill date', value: dateText(bill.billDate) },
    {
      label: 'Due date',
      value: <span className={bill.overdue ? 'text-rose-700' : undefined}>{dateText(bill.dueDate)}</span>,
      hint: bill.overdue ? <span className="font-medium text-rose-600">{overdueDays ? `${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue` : 'Overdue'}</span> : undefined,
    },
    { label: 'Client', value: bill.clientNameSnapshot ? bill.clientNameSnapshot : <span className="font-normal text-slate-400">Not set</span> },
    { label: 'Financial year', value: bill.financialYear },
    // The widest value: it claims more of the row, and a row of its own on a phone.
    { label: 'Category', value: category, hint: bill.billTypeName, wide: true },
  ];
  return (
    <section aria-label="Bill details" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Each fact grows from a base width, so every row fills the card edge to edge at any screen
          width — two to a row on a phone, all on one line on a desktop — and gap-px over a tinted
          background draws the dividers wherever the rows break. */}
      <dl className="flex flex-wrap gap-px bg-slate-100">
        {facts.map((fact) => (
          <div key={fact.label} className={cn('min-w-0 grow bg-white px-4 py-3', fact.wide ? 'basis-60 grow-[2]' : 'basis-36')}>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{fact.label}</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-slate-900">{fact.value}</dd>
            {fact.hint ? <dd className="mt-0.5 break-words text-xs text-slate-500">{fact.hint}</dd> : null}
          </div>
        ))}
      </dl>
      {/* What the bill waits for and the certification hold share one row from a tablet up, each
          taking half; on a phone they stack. Inside the half, the button goes under the message until
          a wide screen leaves room beside it, so the sentence is never squeezed into a ragged wrap. */}
      {waitingOn || awaitingCertification ? (
        <div className="flex flex-col border-t border-slate-200 md:flex-row">
          {waitingOn ? (
            <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500" aria-hidden="true">
                <Hourglass className="h-4 w-4" />
              </span>
              <div className="min-w-0 text-sm">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Waiting for</p>
                <p className="mt-0.5 break-words text-slate-700">
                  <span className="font-semibold text-slate-900">{waitingOn.stage}</span>
                  <span className="text-slate-400"> · </span>
                  {waitingOn.who}
                </p>
              </div>
            </div>
          ) : null}
          {awaitingCertification ? (
            <div className={cn('flex min-w-0 flex-1 flex-col gap-2.5 bg-amber-50 px-4 py-3 xl:flex-row xl:items-center xl:gap-3', waitingOn && 'border-t border-amber-200 md:border-l md:border-t-0')}>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700" aria-hidden="true">
                  <ClipboardCheck className="h-4 w-4" />
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-amber-900">Awaiting the client’s certification</p>
                  <p className="mt-0.5 text-amber-800">Payment can be received once the client certifies this bill.</p>
                </div>
              </div>
              {onOpenCertification ? (
                <Button type="button" size="sm" variant="outline" className="w-full shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100 sm:ml-11 sm:w-auto sm:self-start xl:ml-0 xl:self-auto" onClick={onOpenCertification}>
                  Open certification
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The bill's tabs share the bar's width from a laptop up, so the row is filled edge to edge instead
 * of bunching on the left; below that they keep their size and the bar scrolls sideways.
 */
const DETAIL_TAB = cn(BT_TAB, 'lg:flex-1');

function DetailBody({ detail, reload, tab, setTab }: { detail: Detail; reload: () => void; tab: string; setTab: (tab: string) => void }) {
  const { bill } = detail;
  const lookups = useLookups();
  const { can } = useBt();
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<null | 'workflow' | 'override' | 'due' | 'mismatch' | 'delete' | 'email'>(null);
  const [pendingAction, setPendingAction] = useState<WorkflowMove | null>(null);
  // What the remark dialog is for: returning, closing or reopening.
  const pendingKind = !pendingAction ? null : pendingAction.action === 'return' ? 'return' : pendingAction.action === 'reopen' ? 'reopen' : 'close';
  const reference = billReference(bill);
  // Payment waits for the client's certification when Settings → Workflow says so.
  const receiptBlock = receiptBlockReason(bill, lookups.config.settings.certificationBeforeReceipt);
  // Once certified, the stored deduction total and net are the certified deductions' — what the bill
  // is paid — with the raised ones kept beside them (a bill stored before 2026-10-27 has one pair).
  const raisedNet = bill.raisedNetReceivable ?? bill.netReceivable;
  const comparison = detail.certification;

  // Settings → Workflow: the stages in use and who may move this bill on (named people or permission holders).
  const actor = useWorkflowActor();
  const settings = lookups.config.settings;
  const actions = availableActions(bill, settings, actor);
  const canCertify = certificationBlocked(bill, settings, actor) === null;
  const waiting = waitingFor(bill, settings);
  const nameOf = (id: string) => lookups.users.find((user) => user.id === id)?.name ?? 'Unknown user';
  // The next stage and who can take it, said apart so the header can set the stage in bold.
  const waitingOn = !waiting
    ? null
    : waiting.status === null
      ? { stage: 'Correction', who: waiting.userIds.map(nameOf).join(', ') || 'The preparer' }
      : { stage: stepLabel(settings, waiting.status), who: waiting.userIds.length ? waiting.userIds.map(nameOf).join(', ') : `Anyone with ${stepPermissionText(settings, waiting.status)}` };
  const runWorkflow = async (move: WorkflowMove, remarks?: string) => {
    try {
      await btFetch(`bills/${bill.id}/workflow`, { body: { action: move.action, to: move.to, remarks } });
      toast({ title: 'Workflow updated' });
      reload();
    } catch (caught) {
      toast({ title: 'Could not update the workflow', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
    }
  };
  // Return, close and reopen ask for a remark first; the rest move the bill at once.
  const startWorkflow = (move: WorkflowMove) => {
    if (move.action === 'return' || move.action === 'reopen' || move.to === 'closed') {
      setPendingAction(move);
      setDialog('workflow');
    } else void runWorkflow(move);
  };
  // The move into the step the bill is waiting for is the one to make, so it is the solid button.
  const moveKey = (move: AvailableMove) => `wf-${move.action}-${move.to ?? ''}`;
  const nextMove = actions.find((entry) => entry.tone !== 'danger' && entry.to === waiting?.status) ?? actions.find((entry) => entry.tone !== 'danger');
  const nextAction = nextMove ? moveKey(nextMove) : null;
  // The remark dialog's wording: the move's own label (a renamed Close says so).
  const pendingLabel = pendingAction ? actions.find((entry) => entry.action === pendingAction.action && entry.to === pendingAction.to)?.label : undefined;
  // The header's actions, most important first: the next workflow step, then taking the money (or
  // the certification it waits for), the other workflow moves, Edit, and the tools after them.
  const certificationLabel = bill.certification ? 'Edit client certification' : 'Record certification';
  const headerActions: OverflowAction[] = [
    ...actions.map((entry): OverflowAction => ({
      key: moveKey(entry),
      label: entry.label,
      icon: entry.tone === 'danger' ? Undo2 : CheckCircle2,
      variant: moveKey(entry) === nextAction ? 'primary' : entry.tone === 'danger' ? 'danger' : 'secondary',
      priority: moveKey(entry) === nextAction ? 0 : entry.tone === 'danger' ? 3 : 2,
      onSelect: () => startWorkflow(entry),
    })),
    ...(can('Collections', 'Add') && bill.outstandingAmount !== 0 && !receiptBlock
      ? [{ key: 'receive', label: 'Receive', icon: Wallet, href: `/bill-tracking/collections/new?bill=${bill.id}`, variant: 'primary', priority: 1 } satisfies OverflowAction]
      : []),
    // Payment waiting on the certification makes recording it a main action; otherwise a tool.
    ...(canCertify && (receiptBlock || detail.certification)
      ? [{ key: 'certify', label: certificationLabel, icon: ClipboardCheck, href: `/bill-tracking/bills/${bill.id}/certify`, variant: receiptBlock ? 'primary' : 'secondary', priority: receiptBlock ? 1 : 6 } satisfies OverflowAction]
      : []),
    ...(can('Bills', 'Edit') ? [{ key: 'edit', label: 'Edit', icon: Pencil, href: `/bill-tracking/bills/${bill.id}/edit`, priority: 4 } satisfies OverflowAction] : []),
    ...(can('Follow-ups', 'Add') ? [{ key: 'follow-up', label: 'Add follow-up', icon: PhoneCall, onSelect: () => setTab('followup'), priority: 5 } satisfies OverflowAction] : []),
    ...(bill.netMismatch && !bill.netMismatch.resolvedAt && can('Bills', 'Verify')
      ? [{ key: 'mismatch', label: 'Resolve net mismatch', icon: AlertTriangle, onSelect: () => setDialog('mismatch'), priority: 6 } satisfies OverflowAction]
      : []),
    ...(detail.certification?.suggestedNote && can('Bills', 'Add')
      ? [{ key: 'match-note', label: 'Raise note to match certification', icon: Undo2, href: matchNoteHref(bill), priority: 7 } satisfies OverflowAction]
      : []),
    ...(can('Bills', 'Add') && bill.transactionType !== 'credit_note' && bill.transactionType !== 'debit_note'
      ? ([
          { key: 'credit-note', label: 'Raise credit note', icon: Undo2, href: `/bill-tracking/bills/new?type=credit_note&project=${bill.projectId}&against=${bill.id}`, priority: 8 },
          { key: 'debit-note', label: 'Raise debit note', icon: FileText, href: `/bill-tracking/bills/new?type=debit_note&project=${bill.projectId}&against=${bill.id}`, priority: 8 },
        ] satisfies OverflowAction[])
      : []),
    { key: 'email', label: 'Draft follow-up email', icon: Mail, onSelect: () => setDialog('email'), priority: 9 },
    ...(can('Bills', 'Approve') ? [{ key: 'due', label: 'Revise due date', icon: CalendarClock, onSelect: () => setDialog('due'), priority: 9 } satisfies OverflowAction] : []),
    ...(can('Bills', 'Override Status') ? [{ key: 'override', label: 'Override payment status', icon: ShieldCheck, onSelect: () => setDialog('override'), priority: 10 } satisfies OverflowAction] : []),
    ...(can('Bills', 'Delete')
      ? [{ key: 'delete', label: 'Delete bill', icon: Trash2, onSelect: () => setDialog('delete'), variant: 'danger', menuOnly: true, separatorBefore: true } satisfies OverflowAction]
      : []),
  ];

  return (
    <div className="space-y-4">
      <BillHeader
        bill={bill}
        certificationState={detail.certification && !bill.isDeleted ? detail.certification.summary.state : null}
        actions={
          bill.isDeleted ? null : (
            // As many as fit the width, by priority; the rest — and Delete, always — in the menu.
            <OverflowActions moreLabel="Actions" actions={headerActions} />
          )
        }
      />

      <BillFacts
        bill={bill}
        category={categoryName(bill.billCategory, lookups.config.billCategories, bill.billCategoryName)}
        today={lookups.today}
        waitingOn={bill.isDeleted ? null : waitingOn}
        // Only once the bill has gone to the client: before it is raised there is nothing for the
        // client to certify yet, and the stage it waits for is said beside this already.
        awaitingCertification={Boolean(receiptBlock) && !bill.isDeleted && bill.outstandingAmount !== 0 && certificationNotDue(bill, settings) === null}
        onOpenCertification={detail.certification ? () => setTab('certification') : undefined}
      />
      {bill.isDeleted ? <Notice tone="rose" title="This bill has been deleted">{bill.deleteReason ?? 'No reason recorded.'} It is excluded from every total.</Notice> : null}
      {bill.againstBillId ? (
        <Notice tone="blue" title={`${bill.transactionType === 'credit_note' ? 'Credit' : 'Debit'} note against invoice ${bill.againstBillRef ?? ''}`}>
          Raised against the invoice of {dateText(bill.againstBillDate)}.{' '}
          <Link className="font-medium text-emerald-700 hover:underline" href={`/bill-tracking/bills/${bill.againstBillId}`}>
            Open the invoice
          </Link>
        </Notice>
      ) : bill.transactionType === 'credit_note' ? (
        <Notice tone="amber" title="Credit note not linked to an invoice">Edit it to choose the invoice it is against.</Notice>
      ) : null}
      {/* Only the invoice value takes a note: the certified deductions already apply to the bill. */}
      {comparison?.summary.state === 'adjustment_pending' && bill.certification && !bill.isDeleted ? (
        <Notice tone="blue" title={`Client certified an invoice value of ${formatINR(bill.certification.grossAmount)} against ${formatINR(bill.grossAmount)} raised`}>
          A {comparison.suggestedNote?.transactionType === 'debit_note' ? 'debit' : 'credit'} note of <b>{formatINR(Math.abs(comparison.suggestedNote?.netAmount ?? comparison.summary.pendingGross ?? 0))}</b> is still to be raised against this bill for the taxable and GST.
          {toPaise(comparison.summary.deductionChange ?? 0) !== 0 ? ' The client’s certified deductions already apply — they need no note.' : ''}{' '}
          <button type="button" className="font-medium text-emerald-700 hover:underline" onClick={() => setTab('certification')}>
            See the comparison
          </button>
        </Notice>
      ) : null}
      {detail.notes.length ? <NotesAgainst bill={bill} notes={detail.notes} /> : null}
      {bill.workflowStatus === 'returned' ? <Notice tone="rose" title="Returned for correction">See the activity tab for what needs correcting, then edit and resubmit.</Notice> : null}
      {bill.netMismatch && !bill.netMismatch.resolvedAt ? (
        <Notice tone="amber" title="Net amount mismatch from the legacy workbook">
          Imported net <b>{formatINR(bill.netMismatch.imported, { paise: true })}</b> vs calculated net <b>{formatINR(bill.netMismatch.calculated, { paise: true })}</b>. The bill uses the calculated figure; a finance user should review and resolve it.
        </Notice>
      ) : null}
      {bill.paymentStatusOverride ? (
        <Notice tone="blue" title={`Payment status overridden to ${PAYMENT_STATUS_LABELS[bill.paymentStatusOverride.status]}`}>
          Reason: {bill.paymentStatusOverride.reason} · {dateTimeText(bill.paymentStatusOverride.at)}
        </Notice>
      ) : null}
      {bill.legacyStatus && ((bill.legacyStatus.toUpperCase() === 'RECEIVED' && bill.paymentStatus !== 'received') || (bill.legacyStatus.toUpperCase() === 'NOT RECEIVED' && bill.paymentStatus !== 'not_received')) ? (
        <Notice tone="amber" title="Legacy status mismatch">
          The workbook said <b>{bill.legacyStatus}</b>, but the receipts show {PAYMENT_STATUS_LABELS[bill.paymentStatus].toLowerCase()} with {formatINR(bill.shortfallSurplus)} short.
        </Notice>
      ) : null}

      <StatStrip
        items={[
          { label: 'Taxable', value: <Amount value={bill.taxableAmount} signed /> },
          { label: 'GST', value: <Amount value={bill.gstAmount} signed />, hint: bill.gstType === 'cgst-sgst' ? 'CGST + SGST' : bill.gstType === 'igst' ? 'IGST' : undefined },
          { label: 'Gross', value: <Amount value={bill.grossAmount} signed /> },
          {
            label: 'Deduction',
            value: <Amount value={bill.totalDeduction} signed />,
            tone: 'text-orange-700',
            hint: bill.certification ? <span title={`As raised ${formatINR(bill.raisedTotalDeduction ?? bill.totalDeduction)}`}>As certified</span> : undefined,
          },
          { label: 'Net receivable', value: <Amount value={bill.netReceivable} signed />, hint: bill.certification && toPaise(raisedNet) !== toPaise(bill.netReceivable) ? `Raised ${formatINR(raisedNet)}` : undefined },
          { label: 'Received', value: <Amount value={bill.totalReceived} signed />, tone: 'text-emerald-700' },
          { label: 'Outstanding', value: <Amount value={bill.outstandingAmount} signed />, tone: bill.outstandingAmount > 0 ? 'text-rose-700' : 'text-slate-900' },
        ]}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={BT_TABS_LIST}>
          <TabsTrigger className={DETAIL_TAB} value="overview">
            <FileText className="h-4 w-4" aria-hidden="true" /> Overview
          </TabsTrigger>
          {detail.certification ? (
            <TabsTrigger className={DETAIL_TAB} value="certification">
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Certification
              {detail.certification.summary.state === 'adjustment_pending' ? <span className="h-1.5 w-1.5 rounded-full bg-violet-500" aria-label="note still to raise" /> : null}
            </TabsTrigger>
          ) : null}
          <TabsTrigger className={DETAIL_TAB} value="deductions">
            <Scissors className="h-4 w-4" aria-hidden="true" /> Deductions <TabCount value={effectiveDeductions(bill).length} />
          </TabsTrigger>
          <TabsTrigger className={DETAIL_TAB} value="collections">
            <Wallet className="h-4 w-4" aria-hidden="true" /> Receipts <TabCount value={detail.collections.length} />
          </TabsTrigger>
          <TabsTrigger className={DETAIL_TAB} value="retention">
            <PiggyBank className="h-4 w-4" aria-hidden="true" /> Retention
          </TabsTrigger>
          <TabsTrigger className={DETAIL_TAB} value="documents">
            <Paperclip className="h-4 w-4" aria-hidden="true" /> Documents <TabCount value={detail.documents.length} />
          </TabsTrigger>
          <TabsTrigger className={DETAIL_TAB} value="followup">
            <PhoneCall className="h-4 w-4" aria-hidden="true" /> Follow-up <TabCount value={detail.followUps.length} />
          </TabsTrigger>
          <TabsTrigger className={DETAIL_TAB} value="comments">
            <MessageSquare className="h-4 w-4" aria-hidden="true" /> Comments <TabCount value={detail.comments.length} />
          </TabsTrigger>
          <TabsTrigger className={DETAIL_TAB} value="activity">
            <Activity className="h-4 w-4" aria-hidden="true" /> Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab bill={bill} />
        </TabsContent>
        <TabsContent value="certification">
          <CertificationTab detail={detail} reload={reload} />
        </TabsContent>
        <TabsContent value="deductions">
          <DeductionsTab bill={bill} />
        </TabsContent>
        <TabsContent value="collections">
          <CollectionsTab detail={detail} reload={reload} />
        </TabsContent>
        <TabsContent value="retention">
          <RetentionTab bill={bill} releases={detail.retention} invoice={detail.noteInvoice} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab bill={bill} documents={detail.documents} reload={reload} />
        </TabsContent>
        <TabsContent value="followup">
          <FollowUpTab bill={bill} followUps={detail.followUps} reload={reload} />
        </TabsContent>
        <TabsContent value="comments">
          <CommentsTab bill={bill} comments={detail.comments} reload={reload} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTimeline entries={detail.activity} billNumber={bill.billSerialNumber} />
        </TabsContent>
      </Tabs>

      <ReasonDialog
        open={dialog === 'workflow'}
        title={pendingKind === 'return' ? 'Return for correction' : pendingLabel ?? (pendingKind === 'close' ? 'Close bill' : 'Reopen bill')}
        description={pendingKind === 'return' ? 'Say what needs correcting. The bill goes back to its preparer with your note.' : 'Recorded in the audit trail.'}
        label={pendingKind === 'return' ? 'What needs correcting *' : 'Remarks'}
        required={pendingKind === 'return'}
        confirm={pendingKind === 'return' ? 'Return' : pendingLabel ?? (pendingKind === 'close' ? 'Close bill' : 'Reopen')}
        onClose={() => setDialog(null)}
        onConfirm={async (remarks) => {
          if (pendingAction) await runWorkflow(pendingAction, remarks || undefined);
          setDialog(null);
        }}
      />
      <OverrideDialog open={dialog === 'override'} bill={bill} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      <ReasonDialog
        open={dialog === 'due'}
        title="Revise due date"
        description={`Current due date ${dateText(bill.dueDate)} (originally ${dateText(bill.originalDueDate)}). Every revision is kept with its reason.`}
        label="Reason *"
        required
        dateLabel="New due date"
        confirm="Revise"
        onClose={() => setDialog(null)}
        onConfirm={async (reason, date) => {
          await btFetch(`bills/${bill.id}/due-date`, { body: { dueDate: date, reason } });
          setDialog(null);
          reload();
        }}
      />
      <ReasonDialog
        open={dialog === 'mismatch'}
        title="Resolve net mismatch"
        description="The bill keeps the calculated net (it follows the taxable, GST and deductions). Record why the workbook differed."
        label="Resolution note *"
        required
        confirm="Mark resolved"
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          await btFetch(`bills/${bill.id}/mismatch`, { body: { resolution: 'accept_calculated', reason } });
          setDialog(null);
          reload();
        }}
      />
      <ReasonDialog
        open={dialog === 'delete'}
        title="Delete bill"
        description="The bill is kept for the audit trail but removed from every list and total. Receipts must be cancelled first."
        label="Reason *"
        required
        confirm="Delete"
        destructive
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          await btFetch(`bills/${bill.id}`, { method: 'DELETE', body: { reason } });
          toast({ title: 'Bill deleted' });
          router.push('/bill-tracking/bills');
        }}
      />
      <EmailDraftDialog open={dialog === 'email'} bill={bill} followUps={detail.followUps} onClose={() => setDialog(null)} userName={lookups.user.name} reference={reference} />
    </div>
  );
}

/* ── tabs ────────────────────────────────────────────────────────────────── */

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 break-words text-slate-800">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A value, or a muted dash where the bill has none — so an empty field reads as empty at a glance. */
function orDash(value: ReactNode): ReactNode {
  return value === null || value === undefined || value === '' || value === '—' ? <span className="font-normal text-slate-400">—</span> : value;
}

/**
 * One group of the Overview: a titled card of label / value rows, labels to the left and values to
 * the right, a hairline between rows. Grouped by what a reader is looking for — the invoice, where
 * the bill belongs, its dates, its collection — rather than one 25-field grid read left to right.
 */
function DetailGroup({ icon: Icon, title, rows, children }: { icon: typeof FileText; title: string; rows: [string, ReactNode][]; children?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <h3 className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 text-sm font-semibold text-slate-800">
        <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
        {title}
      </h3>
      <dl className="divide-y divide-slate-100 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 px-4 py-2.5">
            <dt className="shrink-0 text-slate-500">{label}</dt>
            <dd className="min-w-0 break-words text-right font-medium text-slate-800">{orDash(value)}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}

/** The GST as its lines — each component with its rate, then the total — rather than one long sum. */
function GstLines({ bill }: { bill: Bill }) {
  const lines: [string, number][] =
    bill.gstType === 'cgst-sgst'
      ? [[`CGST ${bill.cgstRate ?? 0}%`, bill.cgstAmount ?? 0], [`SGST ${bill.sgstRate ?? 0}%`, bill.sgstAmount ?? 0]]
      : bill.gstType === 'igst'
        ? [[`IGST ${bill.igstRate ?? 0}%`, bill.igstAmount ?? bill.gstAmount]]
        : [];
  if (bill.gstType === 'none') return <span>No GST</span>;
  if (!lines.length) return <>{orDash(bill.gstAmount ? gstSummary(bill) : null)}</>;
  return (
    <span className="inline-grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums">
      {lines.map(([label, amount]) => (
        <Fragment key={label}>
          <span className="font-normal text-slate-500">{label}</span>
          <Amount value={amount} signed />
        </Fragment>
      ))}
      <span className="border-t border-slate-200 pt-0.5 font-normal text-slate-500">Total</span>
      <span className="border-t border-slate-200 pt-0.5">
        <Amount value={bill.gstAmount} signed />
      </span>
    </span>
  );
}

function OverviewTab({ bill }: { bill: BillRow }) {
  const lookups = useLookups();
  const basis = lookups.config.settings.defaultAgeingBasis;
  const notes = [bill.description && ['Description', bill.description], bill.remarks && ['Remarks', bill.remarks]].filter(Boolean) as [string, string][];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DetailGroup
          icon={FileText}
          title="Invoice & GST"
          rows={[
            ['Bill number', bill.billSerialNumber ? <span className="inline-flex items-center gap-0.5">{bill.billSerialNumber}<CopyButton value={bill.billSerialNumber} label="Bill number" /></span> : null],
            ['GST invoice', bill.gstInvoiceNumber ?? 'NA'],
            ['GST', <GstLines key="gst" bill={bill} />],
            ['SEL GST registration', bill.gstRegistrationLabel ? `${bill.gstRegistrationLabel}${bill.gstRegistrationGstin ? ` · ${bill.gstRegistrationGstin}` : ''}` : null],
            ['Client GSTIN', bill.clientGstin],
            ['Legacy Sl. No.', bill.serialNumber],
          ]}
        />
        <DetailGroup
          icon={Building2}
          title="Project & classification"
          rows={[
            ['Project', bill.projectNameSnapshot],
            ['Client', bill.clientNameSnapshot],
            ['DGM office', bill.dgmOffice],
            ['Main category', categoryName(bill.billCategory, lookups.config.billCategories, bill.billCategoryName)],
            ['Sub category', `${bill.billTypeName}${bill.isRetentionBill ? ' · retention bill' : ''}`],
            ['Stage', bill.currentStage],
          ]}
        />
        <DetailGroup
          icon={CalendarDays}
          title="Dates"
          rows={[
            ['Bill date', dateText(bill.billDate)],
            ['Submission date', dateText(bill.submissionDate)],
            ['Bill passed date', dateText(bill.passedDate)],
            [
              'Due date',
              bill.dueDate ? (
                <span key="due" className={bill.overdue ? 'text-rose-700' : undefined}>
                  {dateText(bill.dueDate)}
                  {bill.overdue ? <span className="ml-1.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">Overdue</span> : null}
                </span>
              ) : null,
            ],
            ['Expected payment', dateText(bill.expectedPaymentDate)],
          ]}
        />
        <DetailGroup
          icon={Wallet}
          title="Collection"
          rows={[
            ['Ageing', bill.ageingBucket ? <AgeingBadge key="age" label={bill.ageingBucket} days={bill.ageingDays} buckets={lookups.config.settings.ageingBuckets} /> : null],
            ['Collection owner', bill.collectionOwnerName],
            ['Target week', bill.targetWeek],
            ['Received week', bill.receivedWeek],
            ['Last receipt', dateText(bill.lastReceiptDate)],
            ['Shortfall / surplus', <Amount key="sf" value={bill.shortfallSurplus} signed />],
          ]}
        />
      </div>

      {notes.length ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <StickyNote className="h-4 w-4 text-slate-500" aria-hidden="true" /> Notes
          </h3>
          <dl className="space-y-3 text-sm">
            {notes.map(([label, text]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="mt-0.5 whitespace-pre-line break-words text-slate-800">{text}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {bill.dueDateRevisions?.length ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <SectionHeader descriptionAs="info" title="Due date revisions" as="h3" />
          <ul className="mt-2 space-y-1 text-sm">
            {bill.dueDateRevisions.map((revision) => (
              <li key={revision.changedAt} className="text-slate-700">
                {dateText(revision.previousDueDate)} → <b>{dateText(revision.dueDate)}</b> · {revision.reason} · {revision.changedByName ?? revision.changedBy} · {dateTimeText(revision.changedAt)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {bill.source === 'excel_import' ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Imported from the legacy workbook (row {bill.importRowNumber}). Sheet values: net {bill.importedNetAmount ?? '—'}, total deduction {bill.importedTotalDeduction ?? '—'}, received {bill.importedReceived ?? '—'}, status {bill.legacyStatus ?? '—'}.{' '}
          {bill.importJobId ? (
            <Link className="text-emerald-700 hover:underline" href={`/bill-tracking/import/${bill.importJobId}`}>
              Open the import
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* The record's own history, out of the way at the foot. */}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Created {dateTimeText(bill.createdAt)} by {bill.createdByName ?? bill.createdBy}
        </span>
        <span>Last changed {dateTimeText(bill.updatedAt)}</span>
        <span>
          Ageing from the {AGEING_BASIS_LABELS[basis].toLowerCase()}
          {basis === 'billDate' ? '' : ' (the bill date where it is not set)'}
        </span>
      </p>
    </div>
  );
}

/** The new-note form, pre-filled to make this bill plus its notes equal the client's certification. */
const matchNoteHref = (bill: Pick<Bill, 'id' | 'projectId'>) => `/bill-tracking/bills/new?match=1&against=${bill.id}&project=${bill.projectId}`;

function CertificationTab({ detail, reload }: { detail: Detail; reload: () => void }) {
  const { bill, certification: comparison } = detail;
  const { can } = useBt();
  const lookups = useLookups();
  const actor = useWorkflowActor();
  const { toast } = useToast();
  const [removing, setRemoving] = useState(false);
  if (!comparison) return null;
  const certification = bill.certification;
  const canCertify = certificationBlocked(bill, lookups.config.settings, actor) === null;
  const certifyHref = `/bill-tracking/bills/${bill.id}/certify`;

  if (!certification) {
    return (
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <BtEmpty
            icon={ClipboardCheck}
            title="The client has not certified this bill yet"
            description="When the client certifies it, record what they approved and what they deduct. It starts from the raised figures — change only what the client changed. The raised bill itself is never altered: the certified deductions apply to it as they are, and a credit / debit note against it settles any difference in taxable or GST."
            action={
              canCertify ? (
                <Button asChild size="sm" className="gap-1.5">
                  <Link href={certifyHref}>
                    <ClipboardCheck className="h-4 w-4" /> Record certification
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </CardContent>
      </Card>
    );
  }

  const { summary, lines, suggestedNote } = comparison;
  const noteWord = suggestedNote?.transactionType === 'debit_note' ? 'debit' : 'credit';
  // Deductions take no note: the certified ones apply to the bill as they are. Said wherever they moved,
  // even when a line changed and the total did not.
  const deductionChange = summary.deductionChange ?? 0;
  const deductionsMoved = lines.some((line) => line.settledBy === 'certification' && toPaise(line.difference ?? 0) !== 0);
  const deductionText = deductionsMoved
    ? `${toPaise(deductionChange) === 0 ? 'The client changed the deductions, not their total' : `${formatINR(Math.abs(deductionChange))} ${deductionChange > 0 ? 'more' : 'less'} deducted by the client`} — applied from the certification, no note needed.`
    : null;
  // The net still to adjust is the note to raise plus whatever the notes deduct themselves, which counts on
  // top of the certification. A note raised to match a certification before 2026-10-27 copied the client's
  // deduction changes onto it; with the certified deductions now applied to the bill, those count twice.
  const notesDeducted = subtractMoney(summary.pendingNet, summary.pendingGross);
  return (
    <div className="space-y-4">
      {/* Client changed = note to raise + notes raised − deductions changed (which the certification applies). */}
      <StatStrip
        items={[
          { label: 'Raised net', value: <Amount value={summary.raisedNet} signed /> },
          { label: 'Certified net', value: <Amount value={summary.certifiedNet} signed />, tone: 'text-emerald-700' },
          { label: 'Client changed', value: <Amount value={summary.variance} signed />, tone: (summary.variance ?? 0) < 0 ? 'text-rose-700' : 'text-slate-900' },
          ...(deductionsMoved ? [{ label: 'Deductions changed', value: <Amount value={deductionChange} />, tone: deductionChange > 0 ? 'text-rose-700' : 'text-slate-900', hint: 'Applied — no note' }] : []),
          { label: `Notes raised · ${summary.notesCount}`, value: <Amount value={summary.notesNet} signed /> },
          { label: 'Note to raise', value: <Amount value={summary.pendingGross} signed />, tone: summary.state === 'matched' ? 'text-emerald-700' : 'text-violet-700', hint: summary.state === 'matched' ? 'Matched' : 'Taxable + GST' },
        ]}
      />

      {summary.state === 'matched' ? (
        <Notice tone="emerald" title="Matched">
          The raised bill{summary.notesCount ? ` and its ${summary.notesCount} note${summary.notesCount === 1 ? '' : 's'} match` : ' matches'} the client’s certification {deductionText ? 'in taxable and GST.' : '— taxable, GST and deductions.'}
          {deductionText ? <span className="mt-0.5 block">{deductionText}</span> : null}
        </Notice>
      ) : suggestedNote ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4">
          <div className="min-w-0 text-sm text-violet-900">
            <div className="font-semibold">
              {noteWord === 'credit' ? 'Credit' : 'Debit'} note of {formatINR(Math.abs(suggestedNote.netAmount))} still to raise
            </div>
            <div className="mt-0.5 text-xs">
              Taxable {formatINR(suggestedNote.taxableAmount)} · GST {formatINR(suggestedNote.gstAmount)} — raised against this bill, it brings the bill plus its notes to the taxable and GST the client certified.
            </div>
            {deductionText ? <div className="mt-0.5 text-xs">{deductionText}</div> : null}
          </div>
          {can('Bills', 'Add') && !bill.isDeleted ? (
            <Button asChild size="sm" className="gap-1.5 bg-violet-700 hover:bg-violet-800">
              <Link href={matchNoteHref(bill)}>
                <Undo2 className="h-4 w-4" /> Raise {noteWord} note
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {toPaise(notesDeducted) !== 0 ? (
        <Notice tone="amber" title={`Deductions carried on the notes: ${formatINR(notesDeducted)}`}>
          These count on top of the certification, so the net line below shows them still to adjust beyond the note to raise. One copied onto a note from the certification counts twice — edit it off the note. Keep it if the client deducted it on the note itself (TDS on a debit note, say).
        </Notice>
      ) : null}

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-3 p-4">
          <SectionHeader descriptionAs="info"
            title="Client’s certificate"
            as="h3"
            actions={
              canCertify ? (
                <>
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <Link href={certifyHref}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Link>
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1.5 text-rose-700" onClick={() => setRemoving(true)}>
                    <Trash2 className="h-4 w-4" /> Remove
                  </Button>
                </>
              ) : null
            }
          />
          <Facts
            items={[
              ['Certified date', dateText(certification.certifiedDate)],
              ['Certificate / MB reference', certification.reference ?? '—'],
              ['Certified by', certification.certifiedBy ?? '—'],
              // The certification carries the same GST fields as a bill, so the bill's summary reads it.
              ['Certified GST', gstSummary({ ...bill, gstType: certification.gstType, gstAmount: certification.gstAmount, cgstRate: certification.cgstRate, sgstRate: certification.sgstRate, igstRate: certification.igstRate, cgstAmount: certification.cgstAmount, sgstAmount: certification.sgstAmount, igstAmount: certification.igstAmount })],
              ['Recorded', `${certification.recordedByName ?? certification.recordedBy} · ${dateTimeText(certification.recordedAt)}`],
              ['Last changed', certification.updatedAt ? `${certification.updatedByName ?? certification.updatedBy ?? ''} · ${dateTimeText(certification.updatedAt)} (revision ${certification.revision})` : '—'],
              ['Remarks', certification.remarks ?? '—'],
            ]}
          />
        </CardContent>
      </Card>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">Raised vs certified, line by line</h3>
          <p className="mt-0.5 text-xs text-slate-500">Still to adjust = certified − (raised + notes raised against this bill): what a credit / debit note settles. Deductions need none — the client’s certified deductions apply as they are.</p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left">Line</th>
                <th className="px-3 py-2.5 text-right">Raised</th>
                <th className="px-3 py-2.5 text-right">Certified</th>
                <th className="px-3 py-2.5 text-right">Client change</th>
                <th className="px-3 py-2.5 text-right">Notes raised</th>
                <th className="px-3 py-2.5 text-right">Still to adjust</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const change = line.difference ?? 0;
                // More deducted means less to receive, so on a deduction line an increase reads red.
                const inverse = line.group === 'deduction' || line.key === 'totalDeduction';
                const worse = inverse ? change > 0 : change < 0;
                return (
                  <Fragment key={line.key}>
                    {line.group === 'deduction' && lines[index - 1]?.group !== 'deduction' ? (
                      <tr className="border-t border-slate-100 bg-slate-50/60">
                        <td colSpan={6} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Deductions
                        </td>
                      </tr>
                    ) : null}
                    <tr className={cn('border-t border-slate-100', line.group === 'total' && 'bg-slate-50 font-semibold text-slate-900')}>
                      <td className={cn('px-3 py-2', line.group === 'deduction' && 'pl-6')}>{line.label}</td>
                      <td className="px-3 py-2 text-right">
                        <Amount value={line.raised} signed />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Amount value={line.certified} signed />
                      </td>
                      <td className={cn('px-3 py-2 text-right', worse ? 'text-rose-700' : change ? 'text-emerald-700' : 'text-slate-400')}>{change ? <Amount value={change} signed={!inverse} /> : '—'}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{line.notes ? <Amount value={line.notes} signed /> : '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {/* A deduction the client changed is settled by the certification itself, never by a note. */}
                        {line.settledBy === 'certification' && toPaise(change) !== 0 ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-sky-700" title="The client’s certified figure applies to the bill as it is — no note needed.">
                            <ClipboardCheck className="h-3.5 w-3.5" /> Applied by certification
                          </span>
                        ) : line.matched ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Matched
                          </span>
                        ) : (
                          <Amount value={line.pending} signed className="font-semibold text-violet-700" />
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ReasonDialog
        open={removing}
        title="Remove client certification"
        description="The bill goes back to awaiting certification. Notes already raised against it stay as they are. Kept in the audit trail."
        label="Reason *"
        required
        confirm="Remove"
        destructive
        onClose={() => setRemoving(false)}
        onConfirm={async (reason) => {
          await btFetch(`bills/${bill.id}/certification`, { method: 'DELETE', body: { reason } });
          setRemoving(false);
          toast({ title: 'Certification removed' });
          reload();
        }}
      />
    </div>
  );
}

/** "CGST 9% ₹1,000 + SGST 9% ₹1,000", "IGST 18% ₹2,000", or the single imported figure. */
function gstSummary(bill: Bill): string {
  if (bill.gstType === 'cgst-sgst') return `CGST ${bill.cgstRate ?? 0}% ${formatINR(bill.cgstAmount ?? 0)} + SGST ${bill.sgstRate ?? 0}% ${formatINR(bill.sgstAmount ?? 0)} = ${formatINR(bill.gstAmount)}`;
  if (bill.gstType === 'igst') return `IGST ${bill.igstRate ?? 0}% = ${formatINR(bill.gstAmount)}`;
  if (bill.gstType === 'none') return 'No GST';
  return bill.gstAmount ? `${formatINR(bill.gstAmount)} (not split into CGST / SGST / IGST)` : '—';
}

function NotesAgainst({ bill, notes }: { bill: BillRow; notes: Detail['notes'] }) {
  const credited = notes.reduce((sum, note) => sum + note.netReceivable, 0);
  // The invoice's net is its gross less the deductions that apply — the certified ones once certified.
  const afterCertified = Boolean(bill.certification) && toPaise(bill.raisedNetReceivable ?? bill.netReceivable) !== toPaise(bill.netReceivable);
  return (
    <Card className="border-violet-200 bg-violet-50/50 shadow-sm">
      <CardContent className="space-y-2 p-4">
        <SectionHeader descriptionAs="info" title="Credit / debit notes against this invoice" as="h3" description="Each note is its own document with its own receivable; this shows their effect on the invoice." />
        <ul className="divide-y divide-violet-100 text-sm">
          {notes.map((note) => (
            <li key={note.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                <Link className="font-medium text-emerald-700 hover:underline" href={`/bill-tracking/bills/${note.id}`}>
                  {note.gstInvoiceNumber || note.billSerialNumber || 'Note'}
                </Link>{' '}
                · {note.transactionType === 'credit_note' ? 'Credit note' : 'Debit note'} · {dateText(note.billDate)}
              </span>
              <Amount value={note.netReceivable} signed />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-between gap-2 border-t border-violet-200 pt-2 text-sm font-semibold">
          <span>
            Invoice net {formatINR(bill.netReceivable)}
            {afterCertified ? ' (after the certified deductions)' : ''} {credited < 0 ? '−' : '+'} notes {formatINR(Math.abs(credited))}
          </span>
          <span>
            Net after notes <Amount value={bill.netReceivable + credited} signed />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The bill's deductions. Once the client has certified it, the certified deductions are the ones that
 * apply — the net, outstanding, reports and retention follow them (`effectiveDeductions`) — and the
 * raised lines stay a switch away, as the bill was issued.
 */
function DeductionsTab({ bill }: { bill: BillRow }) {
  const [shown, setShown] = useState<'certified' | 'raised'>('certified');
  const certification = bill.certification;
  if (!certification) {
    return (
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <DeductionLines lines={bill.deductions} emptyText="No deductions on this bill." />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="p-0">
        <Tabs value={shown} onValueChange={(next) => setShown(next === 'raised' ? 'raised' : 'certified')}>
          <div className="px-4 pt-4">
            <SectionHeader descriptionAs="info"
              as="h3"
              title="Deductions on this bill"
              description={`Certified by the client on ${dateText(certification.certifiedDate)}. The certified deductions apply — the net receivable, outstanding, reports and retention follow them, with no credit / debit note. The raised lines are kept as the bill was issued.`}
              actions={
                <TabsList aria-label="Deductions shown">
                  <TabsTrigger className={BT_TAB} value="certified">
                    Certified · applies <TabCount value={certification.deductions?.length ?? 0} />
                  </TabsTrigger>
                  <TabsTrigger className={BT_TAB} value="raised">
                    As raised <TabCount value={bill.deductions.length} />
                  </TabsTrigger>
                </TabsList>
              }
            />
          </div>
          <TabsContent value="certified" className="mt-0">
            <DeductionLines lines={certification.deductions ?? []} emptyText="The client deducts nothing on this bill." />
          </TabsContent>
          <TabsContent value="raised" className="mt-0">
            <DeductionLines lines={bill.deductions} emptyText="No deductions were raised on this bill." />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/** One set of deduction lines — raised or certified — with its total and its statutory / retention parts. */
function DeductionLines({ lines, emptyText }: { lines: readonly BillDeduction[]; emptyText: string }) {
  if (lines.length === 0) return <p className="p-6 text-sm text-muted-foreground">{emptyText}</p>;
  const withGst = lines.some((line) => line.gstAmount);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Deduction</th>
            <th className="px-3 py-2 text-right">%</th>
            <th className="px-3 py-2 text-right">Of</th>
            {withGst ? <th className="px-3 py-2 text-right">Base</th> : null}
            {withGst ? <th className="px-3 py-2 text-right">GST</th> : null}
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-left">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-t border-slate-100">
              <td className="px-3 py-2">
                <Scissors className="mr-1.5 inline h-3.5 w-3.5 text-orange-500" />
                {line.deductionTypeName}
              </td>
              <td className="px-3 py-2 text-right">{line.percentage !== undefined ? `${line.percentage}%` : '—'}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">{line.calculationBase !== undefined ? <Amount value={line.calculationBase} /> : '—'}</td>
              {withGst ? (
                <td className="px-3 py-2 text-right">
                  <Amount value={line.baseAmount ?? line.amount} signed />
                </td>
              ) : null}
              {withGst ? (
                <td className="px-3 py-2 text-right text-xs">
                  {!line.gstAmount ? (
                    '—'
                  ) : line.igstAmount ? (
                    <span>
                      IGST {line.igstRate}% <Amount value={line.igstAmount} />
                    </span>
                  ) : line.cgstAmount !== undefined ? (
                    <span className="space-y-0.5">
                      <span className="block">
                        CGST {line.cgstRate}% <Amount value={line.cgstAmount} />
                      </span>
                      <span className="block">
                        SGST {line.sgstRate}% <Amount value={line.sgstAmount ?? 0} />
                      </span>
                    </span>
                  ) : (
                    <span>
                      GST {line.gstRate}% <Amount value={line.gstAmount} />
                    </span>
                  )}
                </td>
              ) : null}
              <td className="px-3 py-2 text-right">
                <Amount value={line.amount} signed />
              </td>
              <td className="px-3 py-2 text-muted-foreground">{line.remarks ?? ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-100 font-semibold">
          <tr>
            <td className="px-3 py-2">Total deduction</td>
            <td />
            <td />
            {withGst ? <td /> : null}
            {withGst ? <td /> : null}
            <td className="px-3 py-2 text-right">
              <Amount value={totalDeduction(lines)} signed />
            </td>
            <td className="px-3 py-2 text-xs font-normal text-muted-foreground">
              Statutory <Amount value={deductionsOfKind(lines, ['statutory'])} /> · Retention <Amount value={deductionsOfKind(lines, RETENTION_KINDS)} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function CollectionsTab({ detail, reload }: { detail: Detail; reload: () => void }) {
  const { can } = useBt();
  const { toast } = useToast();
  const [cancelling, setCancelling] = useState<BillCollection | null>(null);
  const verify = async (id: string) => {
    try {
      await btFetch(`collections/${id}`, { body: { action: 'verify' } });
      toast({ title: 'Receipt verified' });
      reload();
    } catch (caught) {
      toast({ title: 'Could not verify', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
    }
  };
  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-3 p-4">
          <SectionHeader descriptionAs="info" title="Receipts" as="h3" description="Only verified receipts reduce the outstanding." />
          {detail.collections.length === 0 ? <p className="text-sm text-muted-foreground">No collection records found for this bill.</p> : null}
          <div className="space-y-2">
            {detail.collections.map((collection) => {
              const share = collection.allocations.find((allocation) => allocation.billId === detail.bill.id)?.amount ?? collection.amount;
              return (
                <div key={collection.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">
                      <Amount value={share} /> <span className="text-xs font-normal text-muted-foreground">on {dateText(collection.receiptDate)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {collection.paymentMode ?? 'Mode not recorded'}
                      {collection.utrNumber ? ` · UTR ${collection.utrNumber}` : ''}
                      {collection.bankAccountName ? ` · into ${collection.bankAccountName}` : ''}
                      {collection.allocations.length > 1 ? ` · part of a ${formatINR(collection.amount)} receipt across ${collection.allocations.length} bills` : ''}
                      {collection.remarks ? ` · ${collection.remarks}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={collection.status === 'verified' ? 'success' : collection.status === 'draft' ? 'warning' : 'neutral'}>{collection.status === 'draft' ? 'Awaiting verification' : collection.status === 'verified' ? 'Verified' : 'Cancelled'}</StatusBadge>
                    {collection.status === 'draft' && can('Collections', 'Verify') ? (
                      <Button size="sm" variant="outline" onClick={() => void verify(collection.id)}>
                        Verify
                      </Button>
                    ) : null}
                    {collection.status !== 'cancelled' && can('Collections', 'Cancel') ? (
                      <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => setCancelling(collection)}>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-3 p-4">
          <SectionHeader descriptionAs="info" title="Payment ledger" as="h3" description="Bill raised, then every verified receipt — the running balance ends at the outstanding." />
          <LedgerTable lines={detail.ledger} />
        </CardContent>
      </Card>

      <ReasonDialog
        open={Boolean(cancelling)}
        title="Cancel receipt"
        description={cancelling ? `Cancels the ${formatINR(cancelling.amount)} receipt of ${dateText(cancelling.receiptDate)} on every bill it was allocated to. It stays in the audit trail.` : ''}
        label="Reason *"
        required
        destructive
        confirm="Cancel receipt"
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          if (!cancelling) return;
          await btFetch(`collections/${cancelling.id}`, { body: { action: 'cancel', reason } });
          setCancelling(null);
          reload();
        }}
      />
    </div>
  );
}

export function LedgerTable({ lines }: { lines: LedgerLine[] }) {
  if (!lines.length) return <p className="text-sm text-muted-foreground">No ledger entries.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Transaction</th>
            <th className="px-3 py-2 text-left">Reference</th>
            <th className="px-3 py-2 text-right">Debit</th>
            <th className="px-3 py-2 text-right">Credit</th>
            <th className="px-3 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.reference}-${index}`} className="border-t border-slate-100">
              <td className="whitespace-nowrap px-3 py-1.5">{dateText(line.date)}</td>
              <td className="px-3 py-1.5">{line.description}</td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {line.billId ? (
                  <Link href={`/bill-tracking/bills/${line.billId}`} className="hover:underline">
                    {line.reference}
                  </Link>
                ) : (
                  line.reference
                )}
              </td>
              <td className="px-3 py-1.5 text-right">{line.debit ? <Amount value={line.debit} /> : ''}</td>
              <td className="px-3 py-1.5 text-right">{line.credit ? <Amount value={line.credit} /> : ''}</td>
              <td className="px-3 py-1.5 text-right font-medium">
                <Amount value={line.balance} signed />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Retention Against Invoice @ 30%" / "… · fixed amount" — worded as `retention.ts` labels a slab. */
const slabLabel = (name: string, rate: number | null) => (rate === null ? `${name} · fixed amount` : `${name} @ ${formatRate(rate)}%`);

const SLAB_BASIS_LABELS: Record<LineBasis, string> = { percent: 'Typed %', amount: 'From amount', invoice: 'From the invoice' };

/**
 * Retention held on this bill slab by slab — head plus rate, since one invoice often deducts 10% and
 * 30% under the same head — and what has been released against it. A retention bill also says
 * which slab it releases; a note's retention lands in its invoice's slabs. A certified bill holds
 * the retention the client certified, read on the certified taxable (`retentionSource`).
 */
function RetentionTab({ bill, releases, invoice }: { bill: BillRow; releases: RetentionRelease[]; invoice?: Detail['noteInvoice'] }) {
  const { config } = useLookups();
  const { can } = useBt();
  const source = retentionSource(bill);
  const slabs = billRetentionSlabs(source, config.deductionTypes, invoice);
  const slabList = slabs.map((entry) => entry.slab);
  const typeOf = (id: string) => config.deductionTypes.find((type) => type.id === id);
  const isRetentionBill = bill.isRetentionBill || bill.transactionType === 'retention_bill';
  const released = bill.releasesRetention;
  // The slab a release names: the matching row above, else its head and rate as recorded.
  const releaseLabel = (release: RetentionRelease) => {
    if (release.rate === undefined) return null;
    const key = releaseSlabKey(release, slabList);
    const match = key ? slabList.find((slab) => slab.key === key) : undefined;
    if (match) return match.label;
    const head = release.deductionTypeId ? typeOf(release.deductionTypeId)?.name : undefined;
    if (head) return slabLabel(head, release.rate);
    return release.rate === null ? 'Fixed amount' : `${formatRate(release.rate)}%`;
  };
  const basisTip = (entry: BillSlab) => {
    const base = typeOf(entry.slab.deductionTypeId)?.percentBase === 'gross' ? 'gross' : 'taxable';
    const fromAmount = `Worked out from the amount: read against the ${bill.certification ? 'client’s certified' : 'bill’s'} ${base} of ${formatINR(base === 'gross' ? source.grossAmount : source.taxableAmount)} (${base === 'gross' ? 'this head is taken on gross' : 'gross only for a head taken on gross'}) and counted at a rate when it lands on a half-percent; anything else stays a fixed amount.`;
    const tips: Record<LineBasis, string> = {
      percent: 'The percentage typed on the deduction line (0, a negative or over 100 counts as a fixed amount).',
      amount: fromAmount,
      invoice: 'This note’s retention did not read as a rate its invoice holds, so it is shared over the invoice’s rates under this head, in proportion to what each holds.',
    };
    return entry.bases.map((basis) => tips[basis]).join(' ');
  };
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-4 p-4">
        <SectionHeader descriptionAs="info" title="Retention on this bill" icon={PiggyBank} as="h3" description={bill.certification ? 'As the client certified it — the certified retention lines replace the raised ones.' : undefined} />
        {isRetentionBill ? (
          released ? (
            <p className="text-sm text-slate-700">
              Releases: <span className="font-medium text-slate-900">{slabLabel(typeOf(released.deductionTypeId)?.name ?? 'A retention head no longer in Settings', released.rate)}</span>
              <span className="text-xs text-muted-foreground"> · receipts on this bill release that retention.</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not tied to a retention rate — edit the bill to choose which retention it releases.
              {can('Bills', 'Edit') && !bill.isDeleted ? (
                <>
                  {' '}
                  <Link href={`/bill-tracking/bills/${bill.id}/edit`} className="text-emerald-700 hover:underline">
                    Edit
                  </Link>
                </>
              ) : null}
            </p>
          )
        ) : null}
        {slabs.length === 0 && releases.length === 0 ? <p className="text-sm text-muted-foreground">No retention deducted on or released against this bill.</p> : null}
        {slabs.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left">Head</th>
                    <th className="px-3 py-2.5 text-right">Rate</th>
                    <th className="px-3 py-2.5 text-left">Rate from</th>
                    <th className="px-3 py-2.5 text-right">Held</th>
                  </tr>
                </thead>
                <tbody>
                  {slabs.map((entry) => (
                    <tr key={entry.slab.key} className="border-t border-slate-100">
                      <td className="px-3 py-2">{entry.slab.name}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{entry.slab.rate === null ? <span className="text-slate-500">Fixed amount</span> : `${formatRate(entry.slab.rate)}%`}</td>
                      <td className="px-3 py-2 text-slate-600">
                        <span title={basisTip(entry)} className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">
                          {entry.bases.map((basis) => SLAB_BASIS_LABELS[basis]).join(' + ')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Amount value={entry.held} signed />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold text-slate-900">
                  <tr className="border-t border-slate-200">
                    <td className="px-3 py-2" colSpan={3}>
                      Total retention held
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Amount value={sumMoney(slabs.map((entry) => entry.held))} signed />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : null}
        {releases.length ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Releases</p>
            <ul className="mt-1 space-y-1 text-sm">
              {releases.map((release) => {
                const label = releaseLabel(release);
                return (
                  <li key={release.id} className={`flex justify-between gap-2 ${release.status === 'cancelled' ? 'text-muted-foreground line-through' : ''}`}>
                    <span className="min-w-0">
                      {dateText(release.releaseDate)} · {release.remarks ?? 'Release'}
                      {label ? <span className="text-xs text-slate-500"> · {label}</span> : null}
                    </span>
                    <Amount value={release.amount} />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Expected release: {dateText(bill.retentionExpectedReleaseDate)}
          {bill.retentionDisputed ? ' · marked disputed' : ''}. Releases are recorded on the{' '}
          <Link href={`/bill-tracking/retention?project=${bill.projectId}`} className="text-emerald-700 hover:underline">
            Retention ledger
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc,.csv,.zip';

/** "348 KB", "2.4 MB". */
const fileSizeText = (bytes: number | undefined) =>
  !bytes ? '—' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** An icon for the kind of file, from its type or, failing that, its name. */
function documentIcon(document: Pick<BillDocument, 'contentType' | 'fileName'>) {
  const type = document.contentType ?? '';
  const name = document.fileName.toLowerCase();
  if (type.startsWith('image/') || /\.(jpe?g|png|webp)$/.test(name)) return FileImage;
  if (type.includes('sheet') || type.includes('excel') || /\.(xlsx?|csv)$/.test(name)) return FileSpreadsheet;
  if (type.includes('zip') || name.endsWith('.zip')) return FileArchive;
  return FileText;
}

/**
 * The bill's documents. The categories head the tab as chips — each says how many files are filed
 * under it, so what is still missing shows at a glance, and picking one files the next upload
 * there. Files are dropped on (or chosen through) one upload area, several at a time; the list
 * beneath is a table of what is attached, with Open, Download and Remove on each row.
 */
function DocumentsTab({ bill, documents, reload }: { bill: BillRow; documents: BillDocument[]; reload: () => void }) {
  const { can } = useBt();
  const { toast } = useToast();
  const [category, setCategory] = useState<BillDocumentCategory>('Invoice');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const canUpload = can('Bills', 'Edit') && !bill.isDeleted;
  const counts = new Map<string, number>();
  for (const document of documents) counts.set(document.category, (counts.get(document.category) ?? 0) + 1);

  const upload = async (files: File[]) => {
    if (!files.length || progress) return;
    const tooBig = files.filter((file) => file.size > MAX_DOCUMENT_BYTES);
    if (tooBig.length) toast({ title: 'Too large to upload', description: `${tooBig.map((file) => file.name).join(', ')} — the limit is 20 MB a file.`, variant: 'destructive' });
    const queue = files.filter((file) => file.size <= MAX_DOCUMENT_BYTES);
    if (!queue.length) return;
    let uploaded = 0;
    setProgress({ done: 0, total: queue.length });
    for (const file of queue) {
      try {
        const form = new FormData();
        form.set('file', file);
        form.set('category', category);
        await btFetch(`bills/${bill.id}/documents`, { form });
        uploaded += 1;
      } catch (caught) {
        toast({ title: `Could not upload ${file.name}`, description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
      }
      setProgress({ done: uploaded, total: queue.length });
    }
    setProgress(null);
    if (uploaded) {
      toast({ title: uploaded === 1 ? 'Document uploaded' : `${uploaded} documents uploaded`, description: `Filed under ${category}.` });
      reload();
    }
  };

  const remove = async (document: BillDocument) => {
    if (!window.confirm(`Remove ${document.fileName} from this bill? The file is kept in the audit trail.`)) return;
    try {
      await btFetch(`documents/${document.id}`, { method: 'DELETE' });
      reload();
    } catch (caught) {
      toast({ title: 'Could not remove the document', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
    }
  };
  const open = (document: BillDocument, inline: boolean) =>
    void btDownload(`documents/${document.id}`, document.fileName, inline).catch((caught) => toast({ title: 'Could not open', description: String(caught), variant: 'destructive' }));

  return (
    <TableCard descriptionAs="info"
      title="Documents"
      icon={Paperclip}
      description="Invoice, submission, measurement, payment advice, bank proof, TDS certificate, letters."
      count={documents.length}
      noun="document"
      scroll="natural"
      toolbar={
        <div className="space-y-3">
          <div role={canUpload ? 'radiogroup' : undefined} aria-label={canUpload ? 'File the upload under' : 'Documents by category'} className="flex flex-wrap gap-1.5">
            {DOCUMENT_CATEGORIES.map((entry) => {
              const count = counts.get(entry) ?? 0;
              const selected = canUpload && entry === category;
              return (
                <button
                  key={entry}
                  type="button"
                  role={canUpload ? 'radio' : undefined}
                  aria-checked={canUpload ? selected : undefined}
                  disabled={!canUpload}
                  onClick={() => setCategory(entry)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-default',
                    selected ? 'border-emerald-600 bg-emerald-600 text-white' : count ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-300' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  {count ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5 opacity-40" aria-hidden="true" />}
                  {entry}
                  {count ? <span className={cn('tabular-nums', selected ? 'text-white/80' : 'text-emerald-700')}>{count}</span> : null}
                </button>
              );
            })}
          </div>
          {canUpload ? (
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void upload(Array.from(event.dataTransfer.files));
              }}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
                dragging ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50/50 hover:border-emerald-300 hover:bg-emerald-50/40',
                progress && 'pointer-events-none opacity-70',
              )}
            >
              {progress ? <Loader2 className="h-6 w-6 animate-spin text-emerald-600" aria-hidden="true" /> : <UploadCloud className="h-6 w-6 text-emerald-600" aria-hidden="true" />}
              <span className="text-sm font-medium text-slate-800">
                {progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : (
                  <>
                    Drop files here or <span className="text-emerald-700 underline underline-offset-2">browse</span>
                  </>
                )}
              </span>
              <span className="text-xs text-slate-500">
                Filed under <b className="font-semibold text-slate-700">{category}</b> · PDF, images, Excel, Word, CSV or ZIP · up to 20 MB each · stored privately, opened only through Bill Tracking
              </span>
              <input
                type="file"
                multiple
                className="sr-only"
                disabled={Boolean(progress)}
                accept={DOCUMENT_ACCEPT}
                onChange={(event) => {
                  void upload(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
            </label>
          ) : null}
        </div>
      }
    >
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead className="w-36">Category</TableHead>
            <TableHead className="w-20 text-right">Size</TableHead>
            <TableHead className="w-40">Uploaded by</TableHead>
            <TableHead className="w-40">Uploaded</TableHead>
            <TableHead className="w-44 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.length === 0 ? (
            <TableEmpty colSpan={6} icon={<Paperclip />}>
              No documents attached yet.
            </TableEmpty>
          ) : (
            documents.map((document) => {
              const Icon = documentIcon(document);
              return (
                <TableRow key={document.id}>
                  <TableCell>
                    <button type="button" className="flex min-w-0 items-center gap-2 text-left font-medium text-slate-800 hover:text-emerald-700 hover:underline" onClick={() => open(document, true)} title={`Open ${document.fileName}`}>
                      <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                      <span className="truncate">{document.fileName}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{document.category}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">{fileSizeText(document.size)}</TableCell>
                  <TableCell className="text-slate-700">{document.uploadedByName ?? document.uploadedBy}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-slate-600">{dateTimeText(document.uploadedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => open(document, true)}>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => open(document, false)} aria-label={`Download ${document.fileName}`} title="Download">
                        <Download className="h-4 w-4" />
                      </Button>
                      {can('Bills', 'Edit') ? (
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-rose-700 hover:bg-rose-50" aria-label={`Remove ${document.fileName}`} title="Remove" onClick={() => void remove(document)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableCard>
  );
}

function FollowUpTab({ bill, followUps, reload }: { bill: BillRow; followUps: BillFollowUp[]; reload: () => void }) {
  const lookups = useLookups();
  const { can } = useBt();
  const { toast } = useToast();
  const blank = { followUpDate: lookups.today, method: 'Phone', contactPerson: '', discussion: '', nextFollowUpDate: '', ownerId: bill.collectionOwnerId ?? '', commitmentDate: '', commitmentAmount: '', confidence: 'medium' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await btFetch(`bills/${bill.id}/follow-ups`, {
        body: {
          followUpDate: form.followUpDate,
          method: form.method,
          contactPerson: form.contactPerson,
          discussion: form.discussion,
          nextFollowUpDate: form.nextFollowUpDate,
          ownerId: form.ownerId || undefined,
          commitment: form.commitmentDate && form.commitmentAmount ? { date: form.commitmentDate, amount: Number(form.commitmentAmount), confidence: form.confidence } : undefined,
        },
      });
      setForm(blank);
      toast({ title: 'Follow-up recorded' });
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const updateCommitment = async (followUp: BillFollowUp, status: string) => {
    let fulfilledAmount: number | undefined;
    if (status === 'partially_fulfilled') {
      const answer = window.prompt('Amount received against this commitment (₹)');
      if (!answer) return;
      fulfilledAmount = Number(answer);
    }
    try {
      await btFetch(`bills/${bill.id}/follow-ups/${followUp.id}`, { method: 'PATCH', body: { status, fulfilledAmount, fulfilledDate: lookups.today } });
      reload();
    } catch (caught) {
      toast({ title: 'Could not update', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-3 p-4">
          <SectionHeader descriptionAs="info" title="Follow-up history" icon={PhoneCall} as="h3" />
          {followUps.length === 0 ? <p className="text-sm text-muted-foreground">No follow-ups recorded yet.</p> : null}
          <ol className="relative space-y-4 border-l border-slate-200 pl-4">
            {followUps.map((followUp) => (
              <li key={followUp.id} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <p className="text-sm font-medium text-slate-800">
                  {dateText(followUp.followUpDate)} · {followUp.method}
                  {followUp.contactPerson ? ` with ${followUp.contactPerson}` : ''}
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{followUp.discussion}</p>
                <p className="text-xs text-muted-foreground">
                  {followUp.ownerName ? `Owner ${followUp.ownerName} · ` : ''}
                  {followUp.nextFollowUpDate ? `Next ${dateText(followUp.nextFollowUpDate)} · ` : ''}by {followUp.createdByName ?? followUp.createdBy}
                </p>
                {followUp.commitment ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    <HandCoins className="h-3.5 w-3.5" />
                    Client committed <b>{formatINR(followUp.commitment.amount)}</b> by <b>{dateText(followUp.commitment.date)}</b>
                    <StatusBadge tone={followUp.commitment.status === 'fulfilled' ? 'success' : followUp.commitment.status === 'missed' || (followUp.commitment.status === 'pending' && followUp.commitment.date < lookups.today) ? 'danger' : 'warning'}>
                      {followUp.commitment.status === 'pending' && followUp.commitment.date < lookups.today ? 'Missed' : COMMITMENT_STATUS_LABELS[followUp.commitment.status]}
                    </StatusBadge>
                    {followUp.commitment.fulfilledAmount ? <span>received {formatINR(followUp.commitment.fulfilledAmount)}</span> : null}
                    {can('Follow-ups', 'Edit') && ['pending', 'partially_fulfilled'].includes(followUp.commitment.status) ? (
                      <span className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => void updateCommitment(followUp, 'fulfilled')}>
                          Fulfilled
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => void updateCommitment(followUp, 'partially_fulfilled')}>
                          Partly
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => void updateCommitment(followUp, 'missed')}>
                          Missed
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => void updateCommitment(followUp, 'revised')}>
                          Revised
                        </Button>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {can('Follow-ups', 'Add') && !bill.isDeleted ? (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="space-y-3 p-4">
            <SectionHeader descriptionAs="info" title="Record a follow-up" as="h3" />
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input type="date" value={form.followUpDate} onChange={(event) => setForm({ ...form, followUpDate: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Method</Label>
                <Select value={form.method} onValueChange={(value) => setForm({ ...form, method: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLLOW_UP_METHODS.map((method) => (
                      <SelectItem key={method} value={method}>
                        {method}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Contact person</Label>
              <Input value={form.contactPerson} onChange={(event) => setForm({ ...form, contactPerson: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Discussion *</Label>
              <Textarea rows={3} value={form.discussion} onChange={(event) => setForm({ ...form, discussion: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Next follow-up</Label>
                <Input type="date" value={form.nextFollowUpDate} onChange={(event) => setForm({ ...form, nextFollowUpDate: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Owner</Label>
                <Select value={form.ownerId || 'none'} onValueChange={(value) => setForm({ ...form, ownerId: value === 'none' ? '' : value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="none">Me</SelectItem>
                    {lookups.users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2">
              <p className="mb-1 text-xs font-semibold text-amber-900">Client commitment (optional)</p>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" aria-label="Commitment date" value={form.commitmentDate} onChange={(event) => setForm({ ...form, commitmentDate: event.target.value })} />
                <Input inputMode="decimal" aria-label="Commitment amount" placeholder="Amount ₹" value={form.commitmentAmount} onChange={(event) => setForm({ ...form, commitmentAmount: event.target.value })} />
              </div>
            </div>
            <BtError message={error} />
            <Button className="w-full" disabled={saving || form.discussion.trim().length < 2} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save follow-up'}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CommentsTab({ bill, comments, reload }: { bill: BillRow; comments: BillComment[]; reload: () => void }) {
  const lookups = useLookups();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const mentionable = lookups.users;
  // "@Name" tokens resolve to user ids so the mentioned people are notified.
  const mentions = mentionable.filter((user) => text.includes(`@${user.name}`)).map((user) => user.id);
  const post = async () => {
    setSaving(true);
    try {
      await btFetch(`bills/${bill.id}/comments`, { body: { text, mentions } });
      setText('');
      reload();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-3 p-4">
        <SectionHeader descriptionAs="info" title="Internal comments" icon={MessageSquare} as="h3" description="Comments are kept in full — nothing overwrites an earlier remark. Type @Name to notify someone." />
        <div className="space-y-2">
          <Textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a comment…" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              aria-label="Mention someone"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value=""
              onChange={(event) => {
                const user = mentionable.find((entry) => entry.id === event.target.value);
                if (user) setText((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${user.name} `);
              }}
            >
              <option value="">@ Mention…</option>
              {mentionable.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={saving || !text.trim()} onClick={() => void post()}>
              {saving ? 'Posting…' : 'Post comment'}
            </Button>
          </div>
        </div>
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs text-muted-foreground">
                {comment.createdByName ?? comment.createdBy} · {dateTimeText(comment.createdAt)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{comment.text}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** "workflowStatus" → "Workflow status". */
const fieldLabel = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A stored value as a person reads it: a stage or payment status by its name, an amount in rupees. */
function activityValue(key: string, value: unknown, label: (status: string) => string): string {
  if (value === null || value === undefined || value === '') return '—';
  if ((key === 'workflowStatus' || key === 'returnedFrom') && typeof value === 'string') return label(value);
  if (key === 'paymentStatus' && typeof value === 'string') return PAYMENT_STATUS_LABELS[value as keyof typeof PAYMENT_STATUS_LABELS] ?? value;
  if (typeof value === 'number') return /amount|net|deduction|received|outstanding|gross|taxable|gst|receivable/i.test(key) ? formatINR(value) : value.toLocaleString('en-IN');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** What an entry changed: each field whose value differs between before and after. */
function activityChanges(entry: BillActivity, label: (status: string) => string): { field: string; before: string; after: string }[] {
  if (!entry.previous && !entry.next) return [];
  const before = entry.previous ?? {};
  const after = entry.next ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ field: fieldLabel(key), before: activityValue(key, before[key], label), after: activityValue(key, after[key], label) }));
}

/**
 * The bill's audit trail as a table — when, who, what, what changed and why — one row an entry,
 * newest first as stored. The action drops the "Bill <number>" every entry starts with, since this
 * is that bill's page, and the change is read out field by field ("Workflow status: Bill Raised →
 * Payment Follow-up") instead of two blocks of raw before / after data.
 */
export function ActivityTimeline({ entries, billNumber }: { entries: BillActivity[]; billNumber?: string }) {
  // Steps by their configured names (Settings → Workflow).
  const stepName = useStepLabel();
  const action = (summary: string) => {
    const prefix = billNumber ? `Bill ${billNumber}` : null;
    if (!prefix || !summary.startsWith(prefix)) return summary;
    const rest = summary.slice(prefix.length).replace(/^:\s*/, '').trim();
    return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : summary;
  };
  return (
    <TableCard descriptionAs="info"
      title="Activity"
      icon={Activity}
      description="Immutable audit trail — every financial action with who, when, what changed and the reason."
      count={entries.length}
      noun="event"
      scroll="natural"
    >
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">When</TableHead>
            <TableHead className="w-44">By</TableHead>
            <TableHead>Action</TableHead>
            <TableHead className="w-[30%]">Change</TableHead>
            <TableHead className="w-48">Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableEmpty colSpan={5}>No activity recorded.</TableEmpty>
          ) : (
            entries.map((entry) => {
              const changes = activityChanges(entry, stepName);
              return (
                <TableRow key={entry.id} className="align-top">
                  <TableCell className="whitespace-nowrap align-top tabular-nums text-slate-600">{dateTimeText(entry.at)}</TableCell>
                  <TableCell className="align-top font-medium text-slate-800">{entry.actorName ?? entry.actorId}</TableCell>
                  <TableCell className="align-top text-slate-800">{action(entry.summary)}</TableCell>
                  <TableCell className="align-top">
                    {changes.length ? (
                      <ul className="space-y-0.5 text-xs">
                        {changes.map((change) => (
                          <li key={change.field} className="text-slate-600">
                            <span className="font-medium text-slate-700">{change.field}:</span> <span className="text-slate-500">{change.before}</span>
                            <span className="mx-1 text-slate-400" aria-label="to">→</span>
                            <span className="font-medium text-emerald-700">{change.after}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-xs text-slate-600">{entry.reason || <span className="text-slate-400">—</span>}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableCard>
  );
}

/* ── dialogs ─────────────────────────────────────────────────────────────── */

function ReasonDialog({
  open,
  title,
  description,
  label,
  required,
  confirm,
  destructive,
  dateLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  required?: boolean;
  confirm: string;
  destructive?: boolean;
  dateLabel?: string;
  onClose: () => void;
  onConfirm: (reason: string, date: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim(), date);
      setReason('');
      setDate('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={PM_DIALOG.content}>
        <DialogHeader className={PM_DIALOG.header}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className={PM_DIALOG.body}>
          {dateLabel ? (
            <div className="space-y-1">
              <Label>{dateLabel}</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label>{label}</Label>
            <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <BtError message={error} />
        </div>
        <DialogFooter className={PM_DIALOG.footer}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={busy || (required && reason.trim().length < 3) || (Boolean(dateLabel) && !date)} onClick={() => void submit()}>
            {busy ? 'Working…' : confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OverrideDialog({ open, bill, onClose, onDone }: { open: boolean; bill: Bill; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<string>(bill.paymentStatusOverride?.status ?? 'adjusted');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (clear = false) => {
    setBusy(true);
    setError(null);
    try {
      await btFetch(`bills/${bill.id}/status`, { body: { status: clear ? null : status, reason } });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={PM_DIALOG.content}>
        <DialogHeader className={PM_DIALOG.header}>
          <DialogTitle>Override payment status</DialogTitle>
          <DialogDescription>The status is normally calculated from verified receipts. An override needs a reason and is recorded in the audit trail; “Adjusted” and “Received” set the outstanding to zero.</DialogDescription>
        </DialogHeader>
        <div className={PM_DIALOG.body}>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['adjusted', 'received', 'partially_received', 'not_received', 'over_received'] as BillPaymentStatus[]).map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {PAYMENT_STATUS_LABELS[entry]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Reason *</Label>
            <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Client deducted LD of ₹35,000 — accepted by management" />
          </div>
          <BtError message={error} />
        </div>
        <DialogFooter className={PM_DIALOG.footer}>
          {bill.paymentStatusOverride ? (
            <Button variant="ghost" disabled={busy || reason.trim().length < 3} onClick={() => void submit(true)}>
              Remove override
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>
            Override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A follow-up email written from the bill's facts. It is only a draft: the user copies it into their
 * mail client after reviewing it — nothing is sent from here.
 */
function EmailDraftDialog({ open, bill, followUps, onClose, userName, reference }: { open: boolean; bill: BillRow; followUps: BillFollowUp[]; onClose: () => void; userName: string; reference: string }) {
  const { toast } = useToast();
  const lastCommitment = followUps.find((entry) => entry.commitment)?.commitment;
  const { today } = useLookups();
  const overdueDays = bill.overdue && bill.dueDate ? Math.max(0, daysBetween(bill.dueDate, today) ?? 0) : 0;
  const subject = `Payment follow-up — ${reference} (${bill.projectNameSnapshot})`;
  const body = [
    'Dear Sir/Madam,',
    '',
    `This is regarding our bill ${bill.billSerialNumber ?? ''}${bill.gstInvoiceNumber ? ` / GST invoice ${bill.gstInvoiceNumber}` : ''} dated ${dateText(bill.billDate)} for ${bill.projectNameSnapshot}.`,
    '',
    `Net amount receivable: ${formatINR(bill.netReceivable)}`,
    `Received so far: ${formatINR(bill.totalReceived)}`,
    `Balance outstanding: ${formatINR(bill.outstandingAmount)}`,
    bill.dueDate ? `Due date: ${dateText(bill.dueDate)}${overdueDays ? ` (${overdueDays} days overdue)` : ''}` : '',
    lastCommitment ? `As per our last discussion, payment of ${formatINR(lastCommitment.amount)} was committed by ${dateText(lastCommitment.date)}.` : '',
    '',
    'We request you to kindly arrange release of the balance payment at the earliest and share the payment advice / UTR details once processed.',
    '',
    'Regards,',
    userName,
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={PM_DIALOG.contentWide}>
        <DialogHeader className={PM_DIALOG.header}>
          <DialogTitle>Draft follow-up email</DialogTitle>
          <DialogDescription>Generated from the bill’s figures. Review and edit it in your mail client — nothing is sent from SEL LIVE.</DialogDescription>
        </DialogHeader>
        <div className={PM_DIALOG.body}>
          <Input readOnly value={subject} aria-label="Subject" />
          <Textarea readOnly rows={14} value={body} aria-label="Email body" className="font-mono text-xs" />
        </div>
        <DialogFooter className={PM_DIALOG.footer}>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            className="gap-1.5"
            onClick={() => {
              void navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => toast({ title: 'Copied to clipboard' }));
            }}
          >
            <Copy className="h-4 w-4" /> Copy
          </Button>
          <Button asChild variant="secondary" className="gap-1.5">
            <a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
              <Mail className="h-4 w-4" /> Open in mail app
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
