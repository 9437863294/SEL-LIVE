'use client';

/**
 * The 360° bill record (`/bill-tracking/bills/[billId]`).
 *
 * Header and amount cards, then tabs: overview, deductions, receipts with the bill's ledger,
 * retention, documents, follow-ups with commitments, comments and the immutable activity trail.
 * Every action posts to the API, which re-checks permission and recomputes the bill; the page then
 * reloads the record rather than patching numbers locally.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Copy,
  FileText,
  HandCoins,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  PhoneCall,
  PiggyBank,
  ReceiptIndianRupee,
  Scissors,
  ShieldCheck,
  Trash2,
  Undo2,
  Upload,
  Wallet,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { PM_DIALOG } from '@/components/project-management/pm-shell';
import { useToast } from '@/hooks/use-toast';
import { daysBetween, type LedgerLine } from '@/lib/bill-tracking/calculations';
import { formatINR } from '@/lib/bill-tracking/money';
import {
  AGEING_BASIS_LABELS,
  COMMITMENT_STATUS_LABELS,
  DOCUMENT_CATEGORIES,
  FOLLOW_UP_METHODS,
  PAYMENT_STATUS_LABELS,
  type Bill,
  type BillActivity,
  type BillCollection,
  type BillComment,
  type BillDocument,
  type BillFollowUp,
  type BillPaymentStatus,
  type BillWorkflowStatus,
  type RetentionRelease,
} from '@/lib/bill-tracking/types';

import { btDownload, btFetch, useBt, useBtQuery, useLookups } from './bt-client';
import { billReference, type BillRow } from './bill-register';
import { AgeingBadge, Amount, BtError, BtLoading, Notice, PaymentStatusBadge, TransactionTypeBadge, WorkflowStatusBadge, dateText, dateTimeText } from './bt-ui';

interface Detail {
  bill: BillRow;
  ledger: LedgerLine[];
  collections: BillCollection[];
  followUps: BillFollowUp[];
  comments: BillComment[];
  documents: BillDocument[];
  activity: BillActivity[];
  retention: RetentionRelease[];
}

type WorkflowAction = 'submit' | 'start_verification' | 'verify' | 'approve' | 'raise' | 'start_followup' | 'reconcile' | 'close' | 'return' | 'resubmit' | 'reopen';

/** Mirrors the server's rules, so only actions the API will accept are offered. */
const WORKFLOW_ACTIONS: { action: WorkflowAction; label: string; from: BillWorkflowStatus[]; resource: string; permission: string; tone?: 'danger' }[] = [
  { action: 'submit', label: 'Submit', from: ['draft'], resource: 'Bills', permission: 'Edit' },
  { action: 'start_verification', label: 'Start verification', from: ['submitted'], resource: 'Bills', permission: 'Verify' },
  { action: 'verify', label: 'Verify', from: ['submitted', 'under_verification'], resource: 'Bills', permission: 'Verify' },
  { action: 'approve', label: 'Approve', from: ['verified'], resource: 'Bills', permission: 'Approve' },
  { action: 'raise', label: 'Mark bill raised', from: ['approved'], resource: 'Bills', permission: 'Edit' },
  { action: 'start_followup', label: 'Start payment follow-up', from: ['raised'], resource: 'Bills', permission: 'Edit' },
  { action: 'reconcile', label: 'Send to reconciliation', from: ['raised', 'payment_followup'], resource: 'Bills', permission: 'Verify' },
  { action: 'close', label: 'Close bill', from: ['raised', 'payment_followup', 'reconciliation'], resource: 'Bills', permission: 'Approve' },
  { action: 'resubmit', label: 'Resubmit after correction', from: ['returned'], resource: 'Bills', permission: 'Edit' },
  { action: 'reopen', label: 'Reopen', from: ['closed'], resource: 'Bills', permission: 'Approve' },
  { action: 'return', label: 'Return for correction', from: ['submitted', 'under_verification', 'verified', 'approved'], resource: 'Bills', permission: 'Verify', tone: 'danger' },
];

export default function BillDetail({ billId }: { billId: string }) {
  const { data, loading, error, reload } = useBtQuery<Detail>(`bills/${billId}`);
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') ?? 'overview');
  if (loading && !data) return <BtLoading label="Loading bill…" />;
  if (!data) return <BtError message={error ?? 'Bill not found.'} onRetry={reload} />;
  return <DetailBody detail={data} reload={reload} tab={tab} setTab={setTab} />;
}

function DetailBody({ detail, reload, tab, setTab }: { detail: Detail; reload: () => void; tab: string; setTab: (tab: string) => void }) {
  const { bill } = detail;
  const lookups = useLookups();
  const { can } = useBt();
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<null | 'workflow' | 'override' | 'due' | 'mismatch' | 'delete' | 'email'>(null);
  const [pendingAction, setPendingAction] = useState<WorkflowAction | null>(null);
  const reference = billReference(bill);

  const actions = WORKFLOW_ACTIONS.filter((entry) => entry.from.includes(bill.workflowStatus) && can(entry.resource, entry.permission) && !bill.isDeleted);
  const runWorkflow = async (action: WorkflowAction, remarks?: string) => {
    try {
      await btFetch(`bills/${bill.id}/workflow`, { body: { action, remarks } });
      toast({ title: 'Workflow updated' });
      reload();
    } catch (caught) {
      toast({ title: 'Could not update the workflow', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ReceiptIndianRupee}
        backHref="/bill-tracking/bills"
        backLabel="Bill register"
        eyebrow={bill.projectNameSnapshot}
        title={`Bill ${bill.billSerialNumber ?? ''}${bill.gstInvoiceNumber ? ` · ${bill.gstInvoiceNumber}` : ''}`}
        badge={
          <div className="flex flex-wrap gap-1.5">
            <PaymentStatusBadge status={bill.paymentStatus} overridden={Boolean(bill.paymentStatusOverride)} />
            <WorkflowStatusBadge status={bill.workflowStatus} />
            <TransactionTypeBadge type={bill.transactionType} />
            {bill.isDeleted ? <StatusBadge tone="danger">Deleted</StatusBadge> : null}
          </div>
        }
        meta={[
          { label: 'Bill date', value: dateText(bill.billDate) },
          { label: 'Type', value: bill.billTypeName },
          { label: 'Client', value: bill.clientNameSnapshot ?? '—' },
          { label: 'FY', value: bill.financialYear },
          { label: 'Due', value: dateText(bill.dueDate) },
        ]}
        actions={
          bill.isDeleted ? null : (
            <div className="flex flex-wrap gap-2">
              {can('Collections', 'Add') && bill.outstandingAmount !== 0 ? (
                <Button asChild size="sm" className="gap-1.5">
                  <Link href={`/bill-tracking/collections/new?bill=${bill.id}`}>
                    <Wallet className="h-4 w-4" /> Receive
                  </Link>
                </Button>
              ) : null}
              {can('Bills', 'Edit') ? (
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <Link href={`/bill-tracking/bills/${bill.id}/edit`}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Link>
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5" aria-label="More actions">
                    <MoreHorizontal className="h-4 w-4" /> Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {actions.map((entry) => (
                    <DropdownMenuItem
                      key={entry.action}
                      className={entry.tone === 'danger' ? 'text-rose-700' : undefined}
                      onSelect={() => {
                        if (entry.action === 'return' || entry.action === 'close' || entry.action === 'reopen') {
                          setPendingAction(entry.action);
                          setDialog('workflow');
                        } else void runWorkflow(entry.action);
                      }}
                    >
                      {entry.action === 'return' ? <Undo2 className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      {entry.label}
                    </DropdownMenuItem>
                  ))}
                  {actions.length ? <DropdownMenuSeparator /> : null}
                  {can('Follow-ups', 'Add') ? (
                    <DropdownMenuItem onSelect={() => setTab('followup')}>
                      <PhoneCall className="mr-2 h-4 w-4" /> Add follow-up
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={() => setDialog('email')}>
                    <Mail className="mr-2 h-4 w-4" /> Draft follow-up email
                  </DropdownMenuItem>
                  {can('Bills', 'Approve') ? (
                    <DropdownMenuItem onSelect={() => setDialog('due')}>
                      <CalendarClock className="mr-2 h-4 w-4" /> Revise due date
                    </DropdownMenuItem>
                  ) : null}
                  {can('Bills', 'Override Status') ? (
                    <DropdownMenuItem onSelect={() => setDialog('override')}>
                      <ShieldCheck className="mr-2 h-4 w-4" /> Override payment status
                    </DropdownMenuItem>
                  ) : null}
                  {bill.netMismatch && !bill.netMismatch.resolvedAt && can('Bills', 'Verify') ? (
                    <DropdownMenuItem onSelect={() => setDialog('mismatch')}>
                      <AlertTriangle className="mr-2 h-4 w-4" /> Resolve net mismatch
                    </DropdownMenuItem>
                  ) : null}
                  {can('Bills', 'Delete') ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-rose-700" onSelect={() => setDialog('delete')}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete bill
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />

      {bill.isDeleted ? <Notice tone="rose" title="This bill has been deleted">{bill.deleteReason ?? 'No reason recorded.'} It is excluded from every total.</Notice> : null}
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {[
          ['Taxable', bill.taxableAmount],
          ['GST', bill.gstAmount],
          ['Gross', bill.grossAmount],
          ['Deduction', bill.totalDeduction],
          ['Net receivable', bill.netReceivable],
          ['Received', bill.totalReceived],
          ['Outstanding', bill.outstandingAmount],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-white/60 bg-white/85 p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`mt-0.5 text-base font-semibold ${label === 'Outstanding' && (value as number) > 0 ? 'text-rose-700' : label === 'Received' ? 'text-emerald-700' : 'text-slate-800'}`}>
              <Amount value={value as number} signed />
            </p>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-white/70 p-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="deductions">Deductions ({bill.deductions.length})</TabsTrigger>
          <TabsTrigger value="collections">Receipts ({detail.collections.length})</TabsTrigger>
          <TabsTrigger value="retention">Retention</TabsTrigger>
          <TabsTrigger value="documents">Documents ({detail.documents.length})</TabsTrigger>
          <TabsTrigger value="followup">Follow-up ({detail.followUps.length})</TabsTrigger>
          <TabsTrigger value="comments">Comments ({detail.comments.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab bill={bill} />
        </TabsContent>
        <TabsContent value="deductions">
          <DeductionsTab bill={bill} />
        </TabsContent>
        <TabsContent value="collections">
          <CollectionsTab detail={detail} reload={reload} />
        </TabsContent>
        <TabsContent value="retention">
          <RetentionTab bill={bill} releases={detail.retention} />
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
          <ActivityTimeline entries={detail.activity} />
        </TabsContent>
      </Tabs>

      <ReasonDialog
        open={dialog === 'workflow'}
        title={pendingAction === 'return' ? 'Return for correction' : pendingAction === 'close' ? 'Close bill' : 'Reopen bill'}
        description={pendingAction === 'return' ? 'Say what needs correcting. The bill goes back to its preparer with your note.' : 'Recorded in the audit trail.'}
        label={pendingAction === 'return' ? 'What needs correcting *' : 'Remarks'}
        required={pendingAction === 'return'}
        confirm={pendingAction === 'return' ? 'Return' : pendingAction === 'close' ? 'Close bill' : 'Reopen'}
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

function OverviewTab({ bill }: { bill: BillRow }) {
  const lookups = useLookups();
  return (
    <Card className="border-white/60 bg-white/85 shadow-sm">
      <CardContent className="space-y-5 p-4">
        <Facts
          items={[
            ['Bill number', bill.billSerialNumber ?? '—'],
            ['GST invoice', bill.gstInvoiceNumber ?? 'NA'],
            ['Legacy Sl. No.', bill.serialNumber ?? '—'],
            ['Project', bill.projectNameSnapshot],
            ['Client', bill.clientNameSnapshot ?? '—'],
            ['DGM office', bill.dgmOffice ?? '—'],
            ['Bill type', `${bill.billTypeName} (${bill.billCategory})${bill.isRetentionBill ? ' · retention bill' : ''}`],
            ['Description', bill.description ?? '—'],
            ['Stage', bill.currentStage ?? '—'],
            ['Bill date', dateText(bill.billDate)],
            ['Submission date', dateText(bill.submissionDate)],
            ['Bill passed date', dateText(bill.passedDate)],
            ['Due date', <span key="due" className={bill.overdue ? 'font-medium text-rose-700' : undefined}>{dateText(bill.dueDate)}{bill.overdue ? ' · overdue' : ''}</span>],
            ['Expected payment', dateText(bill.expectedPaymentDate)],
            ['Ageing', <AgeingBadge key="age" label={bill.ageingBucket} days={bill.ageingBucket ? bill.ageingDays : undefined} buckets={lookups.config.settings.ageingBuckets} />],
            ['Target week', bill.targetWeek ?? '—'],
            ['Received week', bill.receivedWeek ?? '—'],
            ['Collection owner', bill.collectionOwnerName ?? '—'],
            ['Last receipt', dateText(bill.lastReceiptDate)],
            ['Shortfall / surplus', <Amount key="sf" value={bill.shortfallSurplus} signed />],
            ['Remarks', bill.remarks ?? '—'],
          ]}
        />
        {bill.dueDateRevisions?.length ? (
          <div>
            <SectionHeader title="Due date revisions" as="h3" />
            <ul className="mt-2 space-y-1 text-sm">
              {bill.dueDateRevisions.map((revision) => (
                <li key={revision.changedAt} className="text-slate-700">
                  {dateText(revision.previousDueDate)} → <b>{dateText(revision.dueDate)}</b> · {revision.reason} · {revision.changedByName ?? revision.changedBy} · {dateTimeText(revision.changedAt)}
                </li>
              ))}
            </ul>
          </div>
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
        <p className="text-xs text-muted-foreground">
          Ageing is measured from the {AGEING_BASIS_LABELS[lookups.config.settings.defaultAgeingBasis].toLowerCase()} (falls back to the bill date). Created {dateTimeText(bill.createdAt)} by {bill.createdByName ?? bill.createdBy}; last changed {dateTimeText(bill.updatedAt)}.
        </p>
      </CardContent>
    </Card>
  );
}

function DeductionsTab({ bill }: { bill: BillRow }) {
  return (
    <Card className="border-white/60 bg-white/85 shadow-sm">
      <CardContent className="p-0">
        {bill.deductions.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No deductions on this bill.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Deduction</th>
                  <th className="px-3 py-2 text-right">%</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {bill.deductions.map((line) => (
                  <tr key={line.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Scissors className="mr-1.5 inline h-3.5 w-3.5 text-orange-500" />
                      {line.deductionTypeName}
                    </td>
                    <td className="px-3 py-2 text-right">{line.percentage !== undefined ? `${line.percentage}%` : '—'}</td>
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
                  <td className="px-3 py-2 text-right">
                    <Amount value={bill.totalDeduction} signed />
                  </td>
                  <td className="px-3 py-2 text-xs font-normal text-muted-foreground">
                    Statutory <Amount value={bill.statutoryDeduction} /> · Retention <Amount value={bill.retentionDeducted} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
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
      <Card className="border-white/60 bg-white/85 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <SectionHeader title="Receipts" as="h3" description="Only verified receipts reduce the outstanding." />
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

      <Card className="border-white/60 bg-white/85 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <SectionHeader title="Payment ledger" as="h3" description="Bill raised, then every verified receipt — the running balance ends at the outstanding." />
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
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
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

function RetentionTab({ bill, releases }: { bill: BillRow; releases: RetentionRelease[] }) {
  const retentionLines = bill.deductions.filter((line) => line.kind.startsWith('retention'));
  return (
    <Card className="border-white/60 bg-white/85 shadow-sm">
      <CardContent className="space-y-4 p-4">
        <SectionHeader title="Retention on this bill" icon={PiggyBank} as="h3" />
        {retentionLines.length === 0 && releases.length === 0 ? <p className="text-sm text-muted-foreground">No retention deducted on or released against this bill.</p> : null}
        {retentionLines.length ? (
          <ul className="space-y-1 text-sm">
            {retentionLines.map((line) => (
              <li key={line.id} className="flex justify-between gap-2">
                <span>Held · {line.deductionTypeName}</span>
                <Amount value={line.amount} />
              </li>
            ))}
          </ul>
        ) : null}
        {releases.length ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Releases</p>
            <ul className="mt-1 space-y-1 text-sm">
              {releases.map((release) => (
                <li key={release.id} className={`flex justify-between gap-2 ${release.status === 'cancelled' ? 'text-muted-foreground line-through' : ''}`}>
                  <span>
                    {dateText(release.releaseDate)} · {release.remarks ?? 'Release'}
                  </span>
                  <Amount value={release.amount} />
                </li>
              ))}
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

function DocumentsTab({ bill, documents, reload }: { bill: BillRow; documents: BillDocument[]; reload: () => void }) {
  const { can } = useBt();
  const { toast } = useToast();
  const [category, setCategory] = useState<string>('Invoice');
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('category', category);
      await btFetch(`bills/${bill.id}/documents`, { form });
      toast({ title: 'Document uploaded', description: file.name });
      reload();
    } catch (caught) {
      toast({ title: 'Upload failed', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };
  return (
    <Card className="border-white/60 bg-white/85 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <SectionHeader title="Documents" icon={Paperclip} as="h3" description="Invoice, submission, measurement, payment advice, bank proof, TDS certificate, letters." />
        {can('Bills', 'Edit') && !bill.isDeleted ? (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-300 p-3">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700">
              <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload file'}
              <input type="file" className="sr-only" disabled={uploading} onChange={(event) => void upload(event.target.files?.[0])} accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc,.csv,.zip" />
            </Label>
            <span className="text-xs text-muted-foreground">Up to 20 MB. Stored privately; opened only through Bill Tracking.</span>
          </div>
        ) : null}
        {documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents attached.</p> : null}
        <ul className="divide-y divide-slate-100">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  <FileText className="mr-1.5 inline h-4 w-4 text-slate-500" />
                  {document.fileName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {document.category} · {document.size ? `${Math.round(document.size / 1024)} KB` : ''} · {document.uploadedByName ?? document.uploadedBy} · {dateTimeText(document.uploadedAt)}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => void btDownload(`documents/${document.id}`, document.fileName, true).catch((caught) => toast({ title: 'Could not open', description: String(caught), variant: 'destructive' }))}>
                  Open
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void btDownload(`documents/${document.id}`, document.fileName)}>
                  Download
                </Button>
                {can('Bills', 'Edit') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-700"
                    aria-label={`Remove ${document.fileName}`}
                    onClick={async () => {
                      if (!window.confirm(`Remove ${document.fileName} from this bill? The file is kept in the audit trail.`)) return;
                      await btFetch(`documents/${document.id}`, { method: 'DELETE' });
                      reload();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
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
      <Card className="border-white/60 bg-white/85 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <SectionHeader title="Follow-up history" icon={PhoneCall} as="h3" />
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
        <Card className="border-white/60 bg-white/85 shadow-sm">
          <CardContent className="space-y-3 p-4">
            <SectionHeader title="Record a follow-up" as="h3" />
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
    <Card className="border-white/60 bg-white/85 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <SectionHeader title="Internal comments" icon={MessageSquare} as="h3" description="Comments are kept in full — nothing overwrites an earlier remark. Type @Name to notify someone." />
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

export function ActivityTimeline({ entries }: { entries: BillActivity[] }) {
  return (
    <Card className="border-white/60 bg-white/85 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <SectionHeader title="Activity" icon={Activity} as="h3" description="Immutable audit trail — every financial action with who, when, before and after, and the reason." />
        {entries.length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded.</p> : null}
        <ol className="relative space-y-3 border-l border-slate-200 pl-4">
          {entries.map((entry) => (
            <li key={entry.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-400" />
              <p className="text-xs text-muted-foreground">
                {dateTimeText(entry.at)} · {entry.actorName ?? entry.actorId}
              </p>
              <p className="text-sm text-slate-800">{entry.summary}</p>
              {entry.reason ? <p className="text-xs text-slate-600">Reason: {entry.reason}</p> : null}
              {entry.previous && entry.next ? (
                <details className="mt-1 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Before / after</summary>
                  <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                    <pre className="overflow-x-auto rounded bg-slate-50 p-2">{JSON.stringify(entry.previous, null, 1)}</pre>
                    <pre className="overflow-x-auto rounded bg-emerald-50 p-2">{JSON.stringify(entry.next, null, 1)}</pre>
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
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
