'use client';

/**
 * RA Bills — the register of a project's running-account bill abstracts: which certified JMC /
 * MVAC quantities have been billed to the client, on which bill.
 *
 * Quantities only. The bill's money — GST, retention, deductions, what the client certified and
 * paid — is Bill Tracking's; `billTrackingRef` links an RA bill to its Bill Tracking bill. Bills
 * live in `projects/{id}/billingReconBills` (never Subcontractors' `bills`). Rules:
 * src/lib/billing-recon/ra-bill.ts.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { deleteField, doc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { AlertTriangle, Calculator, Eye, FilePlus, Hourglass, IndianRupee, Link2, Pencil, Printer, Receipt, Scale, Send, XCircle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FormDialog } from '@/components/shared/form-dialog';
import { BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BR_TONE } from '@/components/billing-recon/page-kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBillingReconData } from '@/components/billing-recon/ra-bills/use-billing-recon-data';
import { RaBillStatusBadge, RaBillViewDialog, periodText } from '@/components/billing-recon/ra-bills/ra-bill-ui';
import type { RaBill, RaBillStatus } from '@/lib/billing-recon/types';
import {
  canCancelRaBill,
  canEditRaBill,
  canSubmitRaBill,
  computeBillableLines,
  summarizeRaBills,
  unbilledCertifiedValue,
} from '@/lib/billing-recon/ra-bill';
import { compareNatural, formatAmount, formatAmountCompact, formatIsoDate } from '@/lib/billing-recon/lines';

const MODULE = 'Billing Recon';
const RESOURCE = 'Billing Recon.Billing';

type StatusFilter = 'all' | RaBillStatus;

export default function RaBillRegisterPage() {
  const { project: projectSlug } = useParams() as { project: string };
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const canView = can('View', RESOURCE);
  const canCreate = can('Create Bill', RESOURCE);
  const canEdit = can('Edit Bill', RESOURCE);
  const canCancel = can('Delete Bill', RESOURCE);
  const canSeeReconciliation = can('View', 'Billing Recon.Reconciliation');

  const { project, register, jmcEntries, mvacEntries, bills, loading, error, reload, setBills } = useBillingReconData(
    projectSlug,
    { entries: true, bills: true },
    !authLoading && canView,
  );

  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const [viewId, setViewId] = useState<string | null>(null);
  const [submitId, setSubmitId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [refId, setRefId] = useState<string | null>(null);
  const [refValue, setRefValue] = useState('');
  const [savingRef, setSavingRef] = useState(false);

  const billById = useMemo(() => new Map(bills.map((bill) => [bill.id, bill])), [bills]);
  const viewing = viewId ? billById.get(viewId) ?? null : null;
  const submitting = submitId ? billById.get(submitId) ?? null : null;
  const cancelling = cancelId ? billById.get(cancelId) ?? null : null;
  const linking = refId ? billById.get(refId) ?? null : null;

  const summary = useMemo(() => summarizeRaBills(bills), [bills]);
  const billableLines = useMemo(() => computeBillableLines({ jmcEntries, mvacEntries, bills }), [jmcEntries, mvacEntries, bills]);
  const unbilledValue = useMemo(() => unbilledCertifiedValue(billableLines), [billableLines]);
  const linesWithBalance = useMemo(() => billableLines.filter((line) => line.balanceQty > 0).length, [billableLines]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return bills
      .filter((bill) => status === 'all' || bill.status === status)
      .filter(
        (bill) =>
          !needle ||
          String(bill.billNo ?? '').toLowerCase().includes(needle) ||
          String(bill.billTrackingRef ?? '').toLowerCase().includes(needle),
      )
      .sort(
        (a, b) =>
          (Number(b.raSequence) || 0) - (Number(a.raSequence) || 0) ||
          String(b.billDate ?? '').localeCompare(String(a.billDate ?? '')) ||
          compareNatural(b.billNo, a.billNo),
      );
  }, [bills, status, search]);

  const projectId = project?.id ?? '';
  const billRef = (id: string) => doc(db, 'projects', projectId, register.raBills, id);
  const actorName = user?.name || user?.email || 'Unknown user';
  const printHref = (bill: RaBill) => `/billing-recon/${projectSlug}/ra-bill/${bill.id}/print`;
  const openPrint = (bill: RaBill) => {
    window.open(printHref(bill), '_blank', 'noopener');
  };

  const log = (action: string, bill: RaBill, details: Record<string, unknown> = {}) => {
    if (!user) return;
    void logUserActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      module: MODULE,
      action,
      recordId: bill.id,
      recordRef: bill.billNo,
      details: {
        projectId,
        projectName: project?.projectName ?? '',
        billNo: bill.billNo,
        raSequence: bill.raSequence,
        totalAmount: bill.totalAmount,
        ...details,
      },
    });
  };

  const fail = (title: string, err: unknown) => {
    console.error(title, err);
    toast({ title, description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
  };

  /** Draft → Submitted, only if it is still a draft. */
  const submitBill = async () => {
    const bill = submitting;
    if (!bill || !user || !projectId) return;
    const changes = { status: 'Submitted' as const, submittedAt: new Date().toISOString(), submittedByName: actorName };
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(billRef(bill.id));
        if (!snap.exists()) throw new Error('This bill no longer exists — reload the page.');
        if (snap.data()?.status !== 'Draft') throw new Error('Only a draft can be submitted — reload to see its current status.');
        tx.update(billRef(bill.id), { ...changes, updatedAt: serverTimestamp() });
      });
    } catch (err) {
      fail('Could not submit the bill', err);
      throw err;
    }
    setBills((prev) => prev.map((b) => (b.id === bill.id ? { ...b, ...changes } : b)));
    log('Submit RA Bill', bill);
    toast({ title: 'Bill submitted', description: `${bill.billNo} is submitted.` });
  };

  /** Any bill not yet cancelled; its quantities become billable again. */
  const cancelBill = async () => {
    const bill = cancelling;
    if (!bill || !user || !projectId) return;
    const reason = cancelReason.trim();
    if (!reason) {
      toast({ title: 'Give a reason', description: 'Say why the bill is being cancelled.', variant: 'destructive' });
      throw new Error('A reason is required.');
    }
    const changes = { status: 'Cancelled' as const, cancelledAt: new Date().toISOString(), cancelledByName: actorName, cancelReason: reason };
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(billRef(bill.id));
        if (!snap.exists()) throw new Error('This bill no longer exists — reload the page.');
        if (snap.data()?.status === 'Cancelled') throw new Error('This bill is already cancelled.');
        tx.update(billRef(bill.id), { ...changes, updatedAt: serverTimestamp() });
      });
    } catch (err) {
      fail('Could not cancel the bill', err);
      throw err;
    }
    setBills((prev) => prev.map((b) => (b.id === bill.id ? { ...b, ...changes } : b)));
    log('Cancel RA Bill', bill, { reason, previousStatus: bill.status });
    toast({ title: 'Bill cancelled', description: `${bill.billNo}'s quantities can be billed again.` });
    setCancelReason('');
  };

  const saveRef = async () => {
    const bill = linking;
    if (!bill || !user || !projectId) return;
    const value = refValue.trim();
    setSavingRef(true);
    try {
      await updateDoc(billRef(bill.id), {
        billTrackingRef: value ? value : deleteField(),
        updatedAt: serverTimestamp(),
      });
      setBills((prev) =>
        prev.map((b) => {
          if (b.id !== bill.id) return b;
          const next = { ...b };
          if (value) next.billTrackingRef = value;
          else delete next.billTrackingRef;
          return next;
        }),
      );
      log(value ? 'Link RA Bill to Bill Tracking' : 'Unlink RA Bill from Bill Tracking', bill, {
        from: bill.billTrackingRef ?? null,
        to: value || null,
      });
      toast({ title: value ? 'Bill Tracking ref saved' : 'Bill Tracking ref removed', description: bill.billNo });
      setRefId(null);
    } catch (err) {
      fail('Could not save the ref', err);
    } finally {
      setSavingRef(false);
    }
  };

  const openRef = (bill: RaBill) => {
    setRefValue(bill.billTrackingRef ?? '');
    setRefId(bill.id);
  };

  const columns: Array<ListColumn<RaBill>> = [
    {
      header: 'Bill no',
      mobile: 'title',
      cell: (bill) => <span className="font-medium text-foreground">{bill.billNo || '—'}</span>,
    },
    { header: 'RA #', cell: (bill) => (bill.raSequence ? `RA ${bill.raSequence}` : '—') },
    { header: 'Date', cell: (bill) => <span className="whitespace-nowrap">{formatIsoDate(bill.billDate)}</span> },
    {
      header: 'Period',
      className: 'hidden lg:table-cell',
      cell: (bill) => <span className="whitespace-nowrap text-muted-foreground">{periodText(bill)}</span>,
    },
    { header: 'Lines', align: 'right', cell: (bill) => (Array.isArray(bill.items) ? bill.items.length : 0) },
    {
      header: 'Amount',
      align: 'right',
      cell: (bill) => <span className="whitespace-nowrap tabular-nums">{formatAmount(Number(bill.totalAmount) || 0)}</span>,
    },
    { header: 'Status', mobile: 'aside', cell: (bill) => <RaBillStatusBadge status={bill.status} /> },
    {
      header: 'Bill Tracking ref',
      cell: (bill) =>
        bill.billTrackingRef ? (
          <span className="whitespace-nowrap">{bill.billTrackingRef}</span>
        ) : (
          <span className="text-muted-foreground">Not linked</span>
        ),
    },
    {
      header: 'Actions',
      align: 'right',
      mobile: 'omit',
      cell: (bill) => (
        <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="View" aria-label={`View ${bill.billNo}`} onClick={() => setViewId(bill.id)}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Print" aria-label={`Print ${bill.billNo}`} onClick={() => openPrint(bill)}>
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const header = (
    <PageHeader
      title="RA Bills"
      icon={Calculator}
      description="Running-account bill abstracts: which certified JMC and MVAC quantities are billed to the client. Money, GST and collections stay in Bill Tracking."
      meta={project ? [{ label: 'Project', value: project.projectName }] : undefined}
      actions={
        <>
          {canSeeReconciliation && (
            <Button asChild variant="outline">
              <Link href={`/billing-recon/${projectSlug}/reconciliation`}>
                <Scale className="mr-2 h-4 w-4" /> Reconciliation
              </Link>
            </Button>
          )}
          {canCreate && (
            <Button asChild>
              <Link href={`/billing-recon/${projectSlug}/billing/create`}>
                <FilePlus className="mr-2 h-4 w-4" /> New RA bill
              </Link>
            </Button>
          )}
        </>
      }
    />
  );

  if (authLoading) return <BrPageSkeleton kpis={4} />;

  if (!canView) return <BrAccessDenied message="You do not have permission to view this project's RA bills." />;

  if (error) {
    return (
      <BrPage tone={BR_TONE.billing}>
        {header}
        <BrNotice
          tone="danger"
          icon={AlertTriangle}
          title={error === 'not-found' ? 'Project not found' : 'Could not load the RA bills'}
          action={
            error === 'failed' ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
                Try again
              </Button>
            ) : undefined
          }
        >
          {error === 'not-found' ? 'This link does not match any project. It may have been renamed or removed.' : 'Check your connection and try again.'}
        </BrNotice>
      </BrPage>
    );
  }

  const viewActions = viewing ? (
    <>
      <Button type="button" variant="outline" onClick={() => openPrint(viewing)}>
        <Printer className="mr-2 h-4 w-4" /> Print
      </Button>
      {canEdit && canEditRaBill(viewing) && (
        <Button type="button" variant="outline" onClick={() => router.push(`/billing-recon/${projectSlug}/billing/create?edit=${viewing.id}`)}>
          <Pencil className="mr-2 h-4 w-4" /> Edit draft
        </Button>
      )}
      {canEdit && canCancelRaBill(viewing) && (
        <Button type="button" variant="outline" onClick={() => openRef(viewing)}>
          <Link2 className="mr-2 h-4 w-4" /> {viewing.billTrackingRef ? 'Edit Bill Tracking ref' : 'Set Bill Tracking ref'}
        </Button>
      )}
      {canCancel && canCancelRaBill(viewing) && (
        <Button
          type="button"
          variant="outline"
          className="border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-800/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
          onClick={() => {
            setCancelReason('');
            setCancelId(viewing.id);
          }}
        >
          <XCircle className="mr-2 h-4 w-4" /> Cancel bill
        </Button>
      )}
      {canEdit && canSubmitRaBill(viewing) && (
        <Button type="button" onClick={() => setSubmitId(viewing.id)}>
          <Send className="mr-2 h-4 w-4" /> Submit
        </Button>
      )}
    </>
  ) : null;

  return (
    <BrPage tone={BR_TONE.billing}>
      {header}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="RA bills"
          value={loading ? '…' : summary.count}
          hint={loading ? undefined : `${summary.submittedCount} submitted · ${summary.cancelledCount} cancelled`}
          icon={Receipt}
          tone="cyan"
          accent
        />
        <KpiCard
          label="Billed value"
          value={loading ? '…' : formatAmountCompact(summary.billedValue)}
          hint={loading ? undefined : formatAmount(summary.billedValue)}
          icon={IndianRupee}
          tone="emerald"
          accent
          info="The total of every RA bill that is not cancelled, drafts included — quantity × the JMC / MVAC line's rate."
        />
        <KpiCard
          label="Drafts"
          value={loading ? '…' : summary.draftCount}
          hint="Not yet submitted"
          icon={Hourglass}
          tone="amber"
          accent
        />
        <KpiCard
          label="Certified, not billed"
          value={loading ? '…' : formatAmountCompact(unbilledValue)}
          hint={loading ? undefined : `${linesWithBalance} line${linesWithBalance === 1 ? '' : 's'} with a balance`}
          icon={Scale}
          tone="violet"
          accent
          info="Certified JMC and MVAC quantities not yet on any RA bill, at each line's rate. Rejected and cancelled entries are left out."
        />
      </div>

      {!loading && summary.draftCount > 0 && status !== 'Draft' && (
        <BrNotice
          tone="warning"
          icon={Hourglass}
          title={`${summary.draftCount} draft${summary.draftCount === 1 ? '' : 's'} not yet submitted`}
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => setStatus('Draft')}>
              Show drafts
            </Button>
          }
        >
          A draft&apos;s quantities already count as billed, so other bills can&apos;t take them. Submit it, or cancel it to free them.
        </BrNotice>
      )}

      <TableCard
        title="Bills"
        icon={Receipt}
        count={loading ? undefined : rows.length}
        total={loading ? undefined : bills.length}
        noun="bill"
        scroll="natural"
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Bill no or Bill Tracking ref' }}
            activeCount={status === 'all' ? 0 : 1}
            onClear={() => {
              setStatus('all');
              setSearch('');
            }}
          >
            <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
              <SelectTrigger aria-label="Status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Submitted">Submitted</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        <div className="p-3 sm:p-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <DataList
              rows={rows}
              columns={columns}
              onRowClick={(bill) => setViewId(bill.id)}
              rowClassName={(bill) => (bill.status === 'Cancelled' ? 'opacity-70' : undefined)}
              dense
              empty={
                <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
                  <p>{bills.length === 0 ? 'No RA bills yet for this project.' : 'No bills match these filters.'}</p>
                  {bills.length === 0 && canCreate && (
                    <Button asChild size="sm">
                      <Link href={`/billing-recon/${projectSlug}/billing/create`}>
                        <FilePlus className="mr-2 h-4 w-4" /> New RA bill
                      </Link>
                    </Button>
                  )}
                </div>
              }
            />
          )}
        </div>
      </TableCard>

      <RaBillViewDialog bill={viewing} open={Boolean(viewing)} onOpenChange={(open) => !open && setViewId(null)} actions={viewActions} />

      <ConfirmDialog
        open={Boolean(submitting)}
        onOpenChange={(open) => !open && setSubmitId(null)}
        title={`Submit ${submitting?.billNo ?? 'this bill'}?`}
        description="A submitted bill can no longer be edited. It can still be cancelled, which frees its quantities."
        confirmLabel="Submit"
        onConfirm={submitBill}
      />

      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelId(null);
            setCancelReason('');
          }
        }}
        destructive
        title={`Cancel ${cancelling?.billNo ?? 'this bill'}?`}
        description="Its quantities stop counting as billed and can go on another bill. The bill stays in the register, marked Cancelled, and its number is not reused."
        confirmLabel="Cancel bill"
        cancelLabel="Keep bill"
        onConfirm={cancelBill}
      >
        <div className="space-y-1.5">
          <Label htmlFor="ra-bill-cancel-reason">Reason</Label>
          <Textarea
            id="ra-bill-cancel-reason"
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Why is this bill being cancelled?"
            rows={3}
          />
        </div>
      </ConfirmDialog>

      <FormDialog
        open={Boolean(linking)}
        onOpenChange={(open) => !open && setRefId(null)}
        title={linking?.billTrackingRef ? 'Edit Bill Tracking ref' : 'Set Bill Tracking ref'}
        description={`The number of ${linking?.billNo ?? 'this bill'}'s bill in Bill Tracking, where its money is recorded.`}
        size="sm"
        onSubmit={saveRef}
        submitting={savingRef}
        submitLabel="Save"
      >
        <div className="space-y-1.5">
          <Label htmlFor="ra-bill-tracking-ref">Bill Tracking bill no</Label>
          <Input
            id="ra-bill-tracking-ref"
            value={refValue}
            onChange={(event) => setRefValue(event.target.value)}
            placeholder="e.g. INV/2026-27/014"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">Leave it empty to remove the link.</p>
        </div>
      </FormDialog>
    </BrPage>
  );
}
