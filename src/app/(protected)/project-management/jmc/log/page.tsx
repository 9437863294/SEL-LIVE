'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Trash2,
  File as FileIcon,
} from 'lucide-react';
import { JmcLogView, type JmcLogRow } from '@/components/jmc/jmc-log-view';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { jmcStageIndex, jmcTotals } from '@/lib/project-management-jmc-dashboard';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, deleteDoc, doc, getDoc, Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import type { JmcEntry, WorkflowStep, ActionLog, BoqItem, Bill, Project, Attachment } from '@/lib/types';
import ViewJmcEntryDialog from '@/components/billing-recon/ViewJmcEntryDialog';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useProjectManagementJmcContext } from '@/components/jmc/use-jmc-host-context';
import {
  JmcAccessDenied,
  JmcProjectNotFound,
} from '@/components/jmc/jmc-page-shell';
import { jmcSlugify } from '@/lib/jmc-module';
import { logUserActivity } from '@/lib/activity-logger';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import ExcelJS from 'exceljs';

/* ---------- helpers ---------- */
function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(+d) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

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

/* remove any id field coming from Firestore doc data to avoid TS2783 (duplicate keys) */
function stripId<T extends object>(obj: T & { id?: any }): Omit<T, 'id'> {
  const { id: _ignored, ...rest } = obj as any;
  return rest as Omit<T, 'id'>;
}

export default function JmcLogPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get('project') ?? '';
  const { context, isResolving, notFound, projectName } =
    useProjectManagementJmcContext(mappingId);
  const { can, isLoading: authIsLoading } = useAuthorization();
  const back = useBackNavigation(context.jmcHref(), { fallbackLabel: 'Back to JMC' });
  const [jmcEntries, setJmcEntries] = useState<EnrichedJmcEntry[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedEntry, setSelectedEntry] = useState<EnrichedJmcEntry | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);

  const userId = (user as any)?.id ?? (user as any)?.uid ?? 'unknown';

  /* ---------- permission checks ---------- */
  const canViewLog = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('View Log', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context.permissionResource]);

  const canCreateJmc = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('Create JMC Entry', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context.permissionResource]);

  const canDeleteJmc = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('Delete JMC', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context.permissionResource]);

  /* Label for the export file name and activity-log details — the project handle this screen used
     to take from the URL slug. */
  const projectHandle = jmcSlugify(projectName || mappingId);

  /**
   * The value arithmetic moved to `jmcTotals`, which the dashboard reads too — the two screens
   * must never report different totals for the same certificates. It is the same rule this screen
   * had inline, now with tests on it.
   */
  const computeTotals = jmcTotals;

  const getStageDetails = (steps: WorkflowStep[], history: ActionLog[] = []) => {
    const stageDates: Record<string, string> = {};

    // Find the latest attachment from any approval action in the history
    const latestApprovalWithAttachment = (history || [])
      .filter((h) => APPROVE_ACTIONS.has(h.action) && h.attachment)
      .sort(
        (a, b) =>
          toDateSafe(b.timestamp)!.getTime() -
          toDateSafe(a.timestamp)!.getTime()
      )[0];

    const certifiedJmcAttachment = latestApprovalWithAttachment?.attachment;

    for (const step of steps) {
      const logsForStep = history.filter(
        (h) => h.stepName === step.name && APPROVE_ACTIONS.has(h.action)
      );
      if (logsForStep.length > 0) {
        const latestLog = logsForStep.sort(
          (a, b) =>
            toDateSafe(b.timestamp)!.getTime() -
            toDateSafe(a.timestamp)!.getTime()
        )[0];
        const d = toDateSafe(latestLog.timestamp);
        stageDates[step.name] = d ? format(d, 'dd-MM-yyyy') : '-';
      } else {
        stageDates[step.name] = '-';
      }
    }
    return { stageDates, certifiedJmcAttachment };
  };

  const fetchAll = useCallback(async () => {
    if (!context.globalProjectId) return;
    setIsLoading(true);
    try {
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const projectsData = projectsSnapshot.docs.map(
        (docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Project)
      );
      const projectData = context.resolveProject(projectsData) as Project | null;

      if (!projectData) {
        throw new Error('Project not found');
      }
      const projectId = projectData.id;

      const workflowRef = doc(db, 'workflows', 'jmc-workflow');
      const [workflowSnap, boqSnap, billsSnap, jmcSnap] = await Promise.all([
        getDoc(workflowRef),
        getDocs(query(collection(db, 'projects', projectId, 'boqItems'))),
        getDocs(query(collection(db, 'projects', projectId, 'bills'))),
        getDocs(
          query(
            collection(db, 'projects', projectId, 'jmcEntries'),
            orderBy('createdAt', 'desc')
          )
        ),
      ]);

      const steps =
        (workflowSnap.exists()
          ? (workflowSnap.data().steps as WorkflowStep[])
          : []) ?? [];
      setWorkflowSteps(steps);

      setBoqItems(
        boqSnap.docs.map(
          (d) => ({ id: d.id, ...(stripId(d.data() as any)) } as BoqItem)
        )
      );
      setBills(
        billsSnap.docs.map(
          (d) => ({ id: d.id, ...(stripId(d.data() as any)) } as Bill)
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
  }, [context, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

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
      a.download = `jmc_workflow_log_${projectHandle}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      toast({ title: 'Export Failed', description: 'Could not generate the Excel file.', variant: 'destructive' });
    }
  };

  const handleDelete = async (entry: EnrichedJmcEntry) => {
    if (!context.globalProjectId) return;
    if (!canDeleteJmc) {
      toast({
        title: 'Permission Denied',
        description: 'You do not have permission to delete JMC entries.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const projectsData = projectsSnapshot.docs.map(
        (docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Project)
      );
      const projectData = context.resolveProject(projectsData) as Project | null;

      if (!projectData) {
        throw new Error('Project not found');
      }

      await deleteDoc(
        doc(db, 'projects', projectData.id, 'jmcEntries', entry.id!)
      );
      await logUserActivity({
        userId,
        userName: (user as any)?.name ?? (user as any)?.displayName,
        userEmail: (user as any)?.email,
        module: context.activityModule,
        action: 'Delete JMC Entry',
        details: { project: projectHandle, jmcNo: entry.jmcNo, entryId: entry.id },
      });
      toast({ title: 'Deleted', description: `JMC ${entry.jmcNo} removed.` });
      fetchAll();
    } catch (err) {
      console.error(err);
      toast({
        title: 'Error',
        description: 'Failed to delete JMC entry.',
        variant: 'destructive',
      });
    }
  };

  /* Hold the table's existing skeleton until auth, the project mapping and the data have settled. */
  const showSkeleton = authIsLoading || isResolving || isLoading;

  /* The configured stage names, in order — the tracker on every row is built from these. */
  const stepNames = workflowSteps.map((step) => step.name);

  /**
   * The register as the log view reads it: identity, where it has got to, and what it is worth.
   *
   * `jmcStageIndex` is the dashboard's rule, not a second one — a step counts as done when the
   * history holds an approving action naming it, and the certificate sits at the earliest step
   * that has none. The stored `stage` field is kept only for its label.
   */
  const logRows: JmcLogRow[] = jmcEntries.map((entry) => {
    const jmcDate = toDateSafe((entry as any).jmcDate) ?? toDateSafe(entry.createdAt);
    return {
      id: entry.id,
      jmcNo: String(entry.jmcNo ?? ''),
      dateLabel: jmcDate ? format(jmcDate, 'dd MMM, yyyy') : '-',
      stageIndex: jmcStageIndex(entry as any, workflowSteps as any),
      stageName: String((entry as any).stage ?? ''),
      status: String((entry as any).status ?? ''),
      value: entry.totalAmount,
      certified: entry.certifiedValue,
      stageDates: entry.stageDates ?? {},
    };
  });

  /**
   * A row's own buttons — the certified document, and deleting it.
   *
   * Passed into the view rather than built there: what may be deleted is this page's question,
   * and the confirm dialog belongs with the handler that does the deleting.
   */
  const rowActions = (entry: EnrichedJmcEntry) => {
    // Prefer the workflow attachment, falling back to the first uploaded certified document.
    const docUrl =
      entry.certifiedJmcAttachment?.url ||
      (Array.isArray(entry.certifiedAttachments) && entry.certifiedAttachments[0]?.url);

    return (
      <>
        {docUrl ? (
          <Button variant="outline" size="sm" className="h-8" asChild>
            <a href={docUrl} target="_blank" rel="noopener noreferrer">
              <FileIcon className="mr-2 h-4 w-4" /> View Doc
            </a>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-dashed text-muted-foreground"
            disabled
            title="No document attached to this JMC yet"
          >
            <FileIcon className="mr-2 h-4 w-4" /> No Doc
          </Button>
        )}

        {canDeleteJmc && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 text-destructive"
                aria-label={`Delete JMC ${entry.jmcNo ?? ''}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete JMC {entry.jmcNo}. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleDelete(entry)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  };

  if (!authIsLoading && !canViewLog) {
    return <JmcAccessDenied description="You do not have permission to view the JMC log." />;
  }

  if (!isResolving && notFound) {
    return (
      <JmcProjectNotFound description="This JMC log could not be resolved to a project. Open it from a Project Management project so the right project is carried through." />
    );
  }

  return (
    <>
      <JmcLogView
        back={back}
        crumbs={[{ label: 'JMC Management', href: context.jmcHref() }]}
        projectName={projectName}
        description={
          projectName
            ? `Every JMC raised on ${projectName}, with its workflow stage dates and certified value`
            : 'Every JMC raised on this project, with its workflow stage dates and certified value'
        }
        steps={stepNames}
        rows={logRows}
        // Raising a certificate starts here, at the register it joins — the dashboard reports on
        // the register rather than being the way in to it.
        create={canCreateJmc ? { href: context.jmcHref('entry') } : undefined}
        onExport={handleExportAll}
        onOpen={(row) => {
          const entry = jmcEntries.find((candidate) => candidate.id === row.id);
          if (entry) handleViewDetails(entry);
        }}
        renderActions={(row) => {
          const entry = jmcEntries.find((candidate) => candidate.id === row.id);
          return entry ? rowActions(entry) : null;
        }}
        isLoading={showSkeleton}
      />

      <ViewJmcEntryDialog
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        jmcEntry={selectedEntry}
        printRegister="project"
        boqItems={boqItems}
        bills={bills}
        isEditMode={false}
        isLoading={false}
      />
    </>
  );
}
