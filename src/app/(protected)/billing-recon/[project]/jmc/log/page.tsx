'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { collection, getDocs, orderBy, query, deleteDoc, doc, getDoc, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import ExcelJS from 'exceljs';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Download,
  File as FileIcon,
  HardHat,
  History,
  IndianRupee,
  Inbox,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { JmcEntry, WorkflowStep, ActionLog, BoqItem, Attachment } from '@/lib/types';
import ViewJmcEntryDialog from '@/components/billing-recon/ViewJmcEntryDialog';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BR_TONE } from '@/components/billing-recon/page-kit';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { WORKFLOWS_COLLECTION } from '@/lib/billing-recon/register';
import { formatAmountCompact } from '@/lib/billing-recon/lines';

/* ---------- helpers ---------- */
/** A Date from a stored value, or null — never an Invalid Date, which `format()` throws on. */
function toDateSafe(value: any): Date | null {
  if (!value) return null;
  let d: Date | null = null;
  if (value instanceof Date) d = value;
  else if (value instanceof Timestamp) d = value.toDate();
  else if (typeof value === 'number') d = new Date(value);
  else if (typeof value === 'string') d = new Date(value);
  else if (typeof value?.toDate === 'function') d = value.toDate();
  else if (typeof value?.seconds === 'number') d = new Date(value.seconds * 1000);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

const timeOf = (value: unknown) => toDateSafe(value)?.getTime() ?? 0;

function formatCurrency(amount: number) {
  const n = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `₹${n.toFixed(2)}`;
  }
}

type CertifiedAttachment = {
  name: string;
  url: string;
  size: number;
  contentType?: string | null;
  uploadedAt: string;
};

type EnrichedJmcEntry = JmcEntry & {
  stageDates: Record<string, string>;
  certifiedJmcAttachment?: Attachment;
  totalAmount: number;
  certifiedValue: number;
  certifiedAttachments?: CertifiedAttachment[];
};

/* pick the latest approving action per step */
const APPROVE_ACTIONS = new Set(['Approve', 'Complete', 'Verified']);

const CERTIFIED = new Set(['completed', 'certified']);
const VOID = new Set(['rejected', 'cancelled', 'canceled']);
const statusKey = (status: unknown) => String(status ?? '').trim().toLowerCase();

/* remove any id field coming from Firestore doc data to avoid TS2783 (duplicate keys) */
function stripId<T extends object>(obj: T & { id?: any }): Omit<T, 'id'> {
  const { id: _ignored, ...rest } = obj as any;
  return rest as Omit<T, 'id'>;
}

const computeTotals = (items: any[] = []) => {
  let total = 0;
  let certified = 0;
  for (const it of Array.isArray(items) ? items : []) {
    const rate = Number(it?.rate ?? 0);
    const explicit = Number(it?.totalAmount ?? NaN);
    const qtyForTotal = Number.isFinite(explicit)
      ? null
      : Number(it?.certifiedQty ?? it?.executedQty ?? 0);
    total += Number.isFinite(explicit)
      ? explicit
      : Number.isFinite(qtyForTotal) && Number.isFinite(rate)
      ? (qtyForTotal as number) * rate
      : 0;

    const certQty = Number(it?.certifiedQty ?? 0);
    certified += Number.isFinite(certQty) && Number.isFinite(rate)
      ? certQty * rate
      : 0;
  }
  return { total, certified };
};

const getStageDetails = (steps: WorkflowStep[], rawHistory: ActionLog[] = []) => {
  const history = Array.isArray(rawHistory) ? rawHistory : [];
  const stageDates: Record<string, string> = {};

  // Find the latest attachment from any approval action in the history. An action without a
  // timestamp sorts last instead of throwing (which used to fail the whole log).
  const latestApprovalWithAttachment = history
    .filter((h) => APPROVE_ACTIONS.has(h?.action) && h.attachment)
    .sort((a, b) => timeOf(b.timestamp) - timeOf(a.timestamp))[0];

  const certifiedJmcAttachment = latestApprovalWithAttachment?.attachment;

  for (const step of steps) {
    const logsForStep = history.filter((h) => h?.stepName === step.name && APPROVE_ACTIONS.has(h.action));
    if (logsForStep.length > 0) {
      const latestLog = logsForStep.sort((a, b) => timeOf(b.timestamp) - timeOf(a.timestamp))[0];
      const d = toDateSafe(latestLog.timestamp);
      stageDates[step.name] = d ? format(d, 'dd-MM-yyyy') : '-';
    } else {
      stageDates[step.name] = '-';
    }
  }
  return { stageDates, certifiedJmcAttachment };
};

export default function JmcLogPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const params = useParams();
  const projectSlug = params.project as string;
  const { currentProject, register: reg, loading: projectsLoading } = useBillingReconProjects();
  const projectId = currentProject?.id ?? '';

  const [jmcEntries, setJmcEntries] = useState<EnrichedJmcEntry[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedEntry, setSelectedEntry] = useState<EnrichedJmcEntry | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<EnrichedJmcEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const userId = (user as any)?.id ?? (user as any)?.uid ?? 'unknown';
  const canView = can('View Log', 'Billing Recon.JMC', projectSlug);
  const canDelete = can('Delete JMC', 'Billing Recon.JMC', projectSlug);
  const canCreate = can('Create JMC Entry', 'Billing Recon.JMC', projectSlug);

  const fetchAll = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      // Subcontractors' `bills` are no longer read here: the log never showed them, and they are
      // what the company pays, not client billing.
      const workflowRef = doc(db, WORKFLOWS_COLLECTION, reg.jmcWorkflowId);
      const [workflowSnap, boqSnap, jmcSnap] = await Promise.all([
        getDoc(workflowRef),
        getDocs(query(collection(db, 'projects', projectId, reg.boqItems))),
        getDocs(
          query(
            collection(db, 'projects', projectId, reg.jmcEntries),
            orderBy('createdAt', 'desc')
          )
        ),
      ]);

      const rawSteps = workflowSnap.exists() ? workflowSnap.data().steps : [];
      const steps = (Array.isArray(rawSteps) ? rawSteps : []) as WorkflowStep[];
      setWorkflowSteps(steps);

      setBoqItems(
        boqSnap.docs.map(
          (d) => ({ id: d.id, ...(stripId(d.data() as any)) } as BoqItem)
        )
      );

      const entries: EnrichedJmcEntry[] = jmcSnap.docs.map((d) => {
        const raw = d.data() as JmcEntry & {
          createdAt?: any;
          id?: string;
          certifiedAttachments?: CertifiedAttachment[];
        };
        const data = stripId(raw);
        const { total, certified } = computeTotals((data as any).items);
        const { stageDates, certifiedJmcAttachment } = getStageDetails(
          steps,
          (data as any).history as ActionLog[]
        );

        return {
          id: d.id,
          ...(data as any),
          createdAt: (data as any).createdAt,
          totalAmount: total,
          certifiedValue: certified,
          stageDates,
          certifiedJmcAttachment,
          certifiedAttachments: (data as any).certifiedAttachments || [],
        };
      });

      setJmcEntries(entries);
    } catch (err) {
      console.error('Error fetching JMC entries: ', err);
      toast({
        title: 'Error',
        description: 'Failed to fetch JMC entries for this project.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, reg.jmcWorkflowId, reg.boqItems, reg.jmcEntries, toast]);

  useEffect(() => {
    if (canView) fetchAll();
  }, [fetchAll, canView]);

  const handleViewDetails = (entry: EnrichedJmcEntry) => {
    setSelectedEntry(entry);
    setIsViewOpen(true);
  };

  const handleExportAll = async () => {
    if (!jmcEntries.length) return;

    const rows = jmcEntries.map((e) => {
      const jmcDate =
        toDateSafe((e as any).jmcDate) ?? toDateSafe((e as any).createdAt);
      const row: Record<string, any> = {
        'JMC No.': e.jmcNo,
        'JMC Date': jmcDate ? format(jmcDate, 'dd MMM, yyyy') : '-',
      };
      for (const step of workflowSteps) {
        row[step.name] = e.stageDates[step.name] || '-';
      }
      row['JMC Value'] = e.totalAmount;
      row['Certified Value'] = e.certifiedValue;
      row['Stage'] = e.stage;
      row['Status'] = e.status;
      return row;
    });

    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('JMC Workflow Log');
      const keys = Object.keys(rows[0] || {});
      ws.columns = keys.map((k) => ({
        header: k,
        key: k,
        width: Math.max(12, k.length, ...rows.map((r) => String(r[k] ?? '').length)),
      }));
      rows.forEach((row) => ws.addRow(row));
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jmc_workflow_log_${projectSlug}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      toast({ title: 'Export Failed', description: 'Could not generate the Excel file.', variant: 'destructive' });
    }
  };

  const handleDelete = async (entry: EnrichedJmcEntry) => {
    if (!projectId || !entry.id) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'projects', projectId, reg.jmcEntries, entry.id));
      await logUserActivity({
        userId,
        userName: (user as any)?.name ?? (user as any)?.displayName,
        userEmail: (user as any)?.email,
        module: 'Billing Recon',
        action: 'Delete JMC Entry',
        details: { project: projectSlug, jmcNo: entry.jmcNo, entryId: entry.id },
      });
      toast({ title: 'Deleted', description: `JMC ${entry.jmcNo} removed.` });
      setPendingDelete(null);
      fetchAll();
    } catch (err) {
      console.error(err);
      toast({
        title: 'Error',
        description: 'Failed to delete JMC entry.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  /* ---------- figures and filters ---------- */
  const kpis = useMemo(() => {
    let open = 0;
    let certified = 0;
    let voided = 0;
    let executed = 0;
    let certifiedValue = 0;
    for (const e of jmcEntries) {
      const s = statusKey(e.status);
      if (VOID.has(s)) {
        voided += 1;
        continue;
      }
      if (CERTIFIED.has(s)) certified += 1;
      else open += 1;
      executed += Number.isFinite(e.totalAmount) ? e.totalAmount : 0;
      certifiedValue += Number.isFinite(e.certifiedValue) ? e.certifiedValue : 0;
    }
    return { total: jmcEntries.length, open, certified, voided, executed, certifiedValue };
  }, [jmcEntries]);

  const statusOptions = useMemo(
    () => Array.from(new Set(jmcEntries.map((e) => String(e.status ?? '').trim()).filter(Boolean))).sort(),
    [jmcEntries]
  );

  const shownEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return jmcEntries.filter((e) => {
      if (statusFilter !== 'all' && String(e.status ?? '').trim() !== statusFilter) return false;
      if (!needle) return true;
      return [e.jmcNo, e.woNo, e.stage, e.status].some((v) => String(v ?? '').toLowerCase().includes(needle));
    });
  }, [jmcEntries, search, statusFilter]);

  const columnCount = 7 + workflowSteps.length;

  /* ---------- states ---------- */
  if (isAuthLoading || projectsLoading) return <BrPageSkeleton kpis={5} />;
  if (!canView) return <BrAccessDenied message="You don't have permission to view the JMC log." />;

  if (!currentProject) {
    return (
      <BrPage tone={BR_TONE.jmc}>
        <PageHeader title="JMC Log" icon={History} backHref="/billing-recon" backLabel="Back to Billing Recon" />
        <BrNotice tone="warning" icon={AlertTriangle} title="Project not found">
          No project matches this address. Choose a project from the switcher at the top of the menu.
        </BrNotice>
      </BrPage>
    );
  }

  return (
    <BrPage tone={BR_TONE.jmc}>
      <PageHeader
        title="JMC Log"
        description="Every JMC raised on this project, with the date each workflow step signed it off."
        icon={History}
        backHref={`/billing-recon/${projectSlug}/jmc`}
        backLabel="Back to JMC"
        actions={
          <>
            {canCreate && (
              <Button asChild variant="outline">
                <Link href={`/billing-recon/${projectSlug}/jmc/entry`}>
                  <Plus className="mr-2 h-4 w-4" /> New JMC
                </Link>
              </Button>
            )}
            <Button onClick={handleExportAll} disabled={jmcEntries.length === 0} title="Every entry, whatever the filters">
              <Download className="mr-2 h-4 w-4" /> Export all
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Entries" value={isLoading ? '—' : kpis.total} hint="Raised on this project" icon={HardHat} tone="orange" accent />
        <KpiCard label="Open" value={isLoading ? '—' : kpis.open} hint="Still in the workflow" icon={Clock} tone="amber" accent />
        <KpiCard label="Certified" value={isLoading ? '—' : kpis.certified} hint="Workflow complete" icon={CheckCircle2} tone="emerald" accent />
        <KpiCard
          label="Rejected / cancelled"
          value={isLoading ? '—' : kpis.voided}
          hint="Count toward nothing"
          icon={Ban}
          tone={kpis.voided ? 'rose' : 'slate'}
          accent
        />
        <KpiCard
          label="Executed value"
          value={isLoading ? '—' : formatAmountCompact(kpis.executed)}
          hint={isLoading ? undefined : `Certified ${formatAmountCompact(kpis.certifiedValue)}`}
          icon={IndianRupee}
          tone="indigo"
          accent
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <TableCard
        title="JMC entries"
        description="Open a row for its lines; the dated columns are when each step approved it."
        icon={History}
        count={isLoading ? undefined : shownEntries.length}
        total={isLoading ? undefined : jmcEntries.length}
        noun="JMC"
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Search JMC No, WO No, stage…' }}
            activeCount={statusFilter === 'all' ? 0 : 1}
            onClear={() => {
              setSearch('');
              setStatusFilter('all');
            }}
          >
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="text-left" aria-label="Status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        {/* Give the table a sensible min width so columns don’t squish */}
        <Table className="min-w-[1200px]">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">JMC No.</TableHead>
              <TableHead className="whitespace-nowrap">JMC Date</TableHead>
              {workflowSteps.map((step) => (
                <TableHead key={step.id} className="whitespace-nowrap">
                  {step.name}
                </TableHead>
              ))}
              <TableHead className="whitespace-nowrap text-right">JMC Value</TableHead>
              <TableHead className="whitespace-nowrap text-right">Certified Value</TableHead>
              <TableHead className="whitespace-nowrap">Stage</TableHead>
              <TableHead className="whitespace-nowrap">Stage Status</TableHead>
              <TableHead className="whitespace-nowrap text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {/* one skeleton cell spanning the visible columns */}
                  <TableCell colSpan={columnCount}>
                    <Skeleton className="h-5" />
                  </TableCell>
                </TableRow>
              ))
            ) : shownEntries.length > 0 ? (
              shownEntries.map((entry) => {
                const jmcDate =
                  toDateSafe((entry as any).jmcDate) ??
                  toDateSafe(entry.createdAt);

                // Prefer workflow attachment, fallback to first certifiedAttachments
                const docUrl =
                  entry.certifiedJmcAttachment?.url ||
                  (Array.isArray(entry.certifiedAttachments) &&
                    entry.certifiedAttachments[0]?.url);

                return (
                  <TableRow
                    key={entry.id}
                    className="cursor-pointer"
                    onClick={() => handleViewDetails(entry)}
                  >
                    <TableCell className="whitespace-nowrap font-medium">
                      {entry.jmcNo ?? '-'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {jmcDate ? format(jmcDate, 'dd MMM, yyyy') : '-'}
                    </TableCell>

                    {workflowSteps.map((step) => (
                      <TableCell key={step.id} className="whitespace-nowrap">
                        {entry.stageDates[step.name] ?? '-'}
                      </TableCell>
                    ))}

                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatCurrency(entry.totalAmount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatCurrency(entry.certifiedValue)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{entry.stage ?? '-'}</TableCell>
                    <TableCell>
                      <StatusBadge status={entry.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {/* Action button: ONLY for opening uploaded doc */}
                        {docUrl ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            asChild
                            onClick={(e) => e.stopPropagation()} // don't trigger row click
                          >
                            <a
                              href={docUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <FileIcon className="mr-2 h-4 w-4" /> View Doc
                            </a>
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled
                            onClick={(e) => e.stopPropagation()}
                          >
                            <FileIcon className="mr-2 h-4 w-4" /> No Doc
                          </Button>
                        )}

                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            aria-label={`Delete JMC ${entry.jmcNo ?? ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDelete(entry);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableEmpty colSpan={columnCount} icon={<Inbox />}>
                {jmcEntries.length === 0 ? 'No JMC entries on this project yet.' : 'No entries match the search or filter.'}
              </TableEmpty>
            )}
          </TableBody>
        </Table>
      </TableCard>

      {/* One confirmation for the page, outside the table rows. */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && !isDeleting && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete JMC {pendingDelete?.jmcNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the entry and its workflow history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) handleDelete(pendingDelete);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ViewJmcEntryDialog
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        jmcEntry={selectedEntry}
        boqItems={boqItems}
        isEditMode={false}
        isLoading={false}
      />
    </BrPage>
  );
}
