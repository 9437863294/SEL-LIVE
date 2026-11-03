'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlarmClock,
  AlertTriangle,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  Clock,
  Hourglass,
  Inbox,
  IndianRupee,
  Info,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  getDocs,
  doc,
  getDoc,
  Timestamp,
  runTransaction,
  arrayUnion,
} from 'firebase/firestore';
import type {
  MvacEntry,
  WorkflowStep,
  ActionLog,
  BoqItem,
  ActionConfig,
  MvacItem,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import ViewMvacEntryDialog from '@/components/billing-recon/ViewMvacEntryDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { UpdateMvacCertifiedQtyDialog } from '@/components/billing-recon/UpdateMvacCertifiedQtyDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, subDays } from 'date-fns';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { BrNotice, BrPage, BrPageSkeleton, BR_TONE } from '@/components/billing-recon/page-kit';
import { BILLING_RECON_FIXED, WORKFLOWS_COLLECTION } from '@/lib/billing-recon/register';
import { formatAmountCompact } from '@/lib/billing-recon/lines';

/* -------- helpers -------- */
/** A Date from a stored value, or null — never an Invalid Date, which `format()` throws on. */
function toDateSafe(value: any): Date | null {
  if (!value) return null;
  let d: Date | null = null;
  if (value instanceof Timestamp) d = value.toDate();
  else if (value instanceof Date) d = value;
  else if (typeof value === 'number') d = new Date(value);
  else if (typeof value === 'string') d = new Date(value);
  else if (typeof value?.toDate === 'function') d = value.toDate();
  else if (typeof value?.seconds === 'number') d = new Date(value.seconds * 1000);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function humanDate(value: any) {
  const d = toDateSafe(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function pastTense(action: string) {
  const map: Record<string, string> = {
    Approve: 'approved',
    Verify: 'verified',
    Verified: 'verified',
    Complete: 'completed',
    Reject: 'rejected',
    Revert: 'reverted',
  };
  return map[action] ?? `${action.toLowerCase()}ed`;
}

function formatINR(n?: number) {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `₹${v.toFixed(2)}`;
  }
}

function computeTotalAmount(entry: MvacEntry | undefined): number {
  if (!entry) return 0;
  const explicit = (entry as any).totalAmount;
  if (Number.isFinite(explicit)) return explicit as number;
  const items = Array.isArray(entry.items) ? entry.items : [];
  let total = 0;
  for (const it of items) {
    const qty = Number(it?.certifiedQty ?? it?.executedQty ?? 0);
    const rate = Number(it?.rate ?? 0);
    if (Number.isFinite(qty) && Number.isFinite(rate)) total += qty * rate;
  }
  return total;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '');

/**
 * The workflow's steps, as the MVAC desk reads them: named steps only, each with an id (its
 * name, slugged, when a saved step has none), so a stage link from the desk always finds its step.
 */
function readSteps(raw: unknown): WorkflowStep[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((s): s is WorkflowStep => Boolean(s && typeof s === 'object' && (s as { name?: unknown }).name))
    .map((s) => ({ ...s, id: String(s.id || slugify(String(s.name))), name: String(s.name) }) as WorkflowStep);
}

const isVerifyAction = (name: string) => name === 'Verify' || name === 'Verified';

const DAY_MS = 86_400_000;
const CLOSED = new Set(['completed', 'certified', 'rejected', 'cancelled', 'canceled']);
const isOpenStatus = (status: unknown) => !CLOSED.has(String(status ?? '').trim().toLowerCase());

type LoadProblem = 'workflow' | 'stage' | 'error' | null;

/* -------- component -------- */
export default function StagePage() {
  const { project: projectSlug, stageId } = useParams() as {
    project: string;
    stageId: string;
  };
  const { user } = useAuth();
  const userId = (user as any)?.id ?? (user as any)?.uid ?? '';
  const userName = (user as any)?.name ?? (user as any)?.displayName ?? 'User';

  const { toast } = useToast();
  const { currentProject, register: reg, loading: projectsLoading } = useBillingReconProjects();
  const projectId = currentProject?.id ?? null;

  const [tasks, setTasks] = useState<MvacEntry[]>([]);
  const [stage, setStage] = useState<WorkflowStep | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadProblem, setLoadProblem] = useState<LoadProblem>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  const [selectedMvac, setSelectedMvac] = useState<MvacEntry | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isUpdateQtyOpen, setIsUpdateQtyOpen] = useState(false);
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);

  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [completionDate, setCompletionDate] = useState<Date | undefined>(new Date());

  const fetchTasks = useCallback(async () => {
    if (!userId || !stageId || !projectId) return;

    setIsLoading(true);
    setLoadProblem(null);
    try {
      // 1) workflow + stage (the MVAC workflow is Billing Recon's alone, the same for every
      // project). A missing workflow or stage is shown on the page (it used to bounce back with
      // router.back(), which leaves the app when the stage was opened from a link).
      const workflowRef = doc(db, WORKFLOWS_COLLECTION, BILLING_RECON_FIXED.mvacWorkflowId);
      const workflowSnap = await getDoc(workflowRef);
      if (!workflowSnap.exists()) {
        setWorkflow([]);
        setStage(null);
        setLoadProblem('workflow');
        return;
      }
      const steps = readSteps(workflowSnap.data().steps);
      setWorkflow(steps);
      const currentStage = steps.find((s) => s.id === stageId) ?? null;
      setStage(currentStage);
      if (!currentStage) {
        setLoadProblem('stage');
        return;
      }

      // 2) the project's MVAC entries + BOQ. All entries, not just those at this step: the
      // Completed tab lists entries you acted on here, which have since moved on to the next step
      // (a query on `currentStepId` could never return them, so that tab stayed empty).
      // Subcontractors' `bills` are no longer read: nothing here showed them, and they are what
      // the company pays, not client billing.
      const [entriesSnap, boqSnap] = await Promise.all([
        getDocs(query(collection(db, 'projects', projectId, reg.mvacEntries))),
        getDocs(query(collection(db, 'projects', projectId, reg.boqItems))),
      ]);

      setTasks(
        entriesSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) } as MvacEntry)
        )
      );
      setBoqItems(
        boqSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) } as BoqItem)
        )
      );
      setLoadedAt(Date.now());
    } catch (error: any) {
      console.error('Error fetching tasks for stage:', error);
      setLoadProblem('error');
      toast({
        title: 'Error',
        description: error?.message || 'Failed to fetch tasks.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, reg.mvacEntries, reg.boqItems, stageId, toast, userId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  /** Every open entry at this step, whoever it is assigned to. */
  const waitingHere = useMemo(
    () => tasks.filter((t) => t.currentStepId === stageId && isOpenStatus(t.status)),
    [tasks, stageId]
  );

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!userId || !stage)
      return { pendingTasks: [] as MvacEntry[], completedTasks: [] as MvacEntry[] };

    const myPending = tasks.filter(
      (t) =>
        t.currentStepId === stage.id &&
        (t.assignees ?? []).includes(userId) &&
        t.status !== 'Completed' &&
        t.status !== 'Rejected'
    );

    const myCompleted = tasks.filter(
      (t) =>
        !myPending.some((pt) => pt.id === t.id) &&
        (Array.isArray(t.history) ? t.history : []).some(
          (h) => h?.stepName === stage.name && h?.userId === userId
        )
    );

    return { pendingTasks: myPending, completedTasks: myCompleted };
  }, [tasks, userId, stage]);

  const kpis = useMemo(() => {
    let overdue = 0;
    let oldestDays: number | null = null;
    let value = 0;
    for (const t of waitingHere) {
      const deadline = toDateSafe(t.deadline)?.getTime();
      if (deadline !== undefined && deadline < loadedAt) overdue += 1;
      const raised = toDateSafe(t.createdAt)?.getTime() ?? toDateSafe(t.mvacDate)?.getTime();
      if (raised !== undefined) {
        const days = Math.max(0, Math.floor((loadedAt - raised) / DAY_MS));
        if (oldestDays === null || days > oldestDays) oldestDays = days;
      }
      value += computeTotalAmount(t);
    }
    return { waiting: waitingHere.length, overdue, oldestDays, value };
  }, [waitingHere, loadedAt]);

  // Dialog visibility
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setIsViewOpen(false);
      setIsVerifyOpen(false);
      setIsUpdateQtyOpen(false);
      setSelectedMvac(null);
    }
  };

  const handleUpdateQtyClick = (entry: MvacEntry) => {
    setSelectedMvac(entry);
    setIsUpdateQtyOpen(true);
  };

  const handleViewDetails = (entry: MvacEntry) => {
    setSelectedMvac(entry);
    setIsViewOpen(true);
  };

  const handleVerifyClick = (entry: MvacEntry) => {
    setSelectedMvac(entry);
    setIsVerifyOpen(true);
  };

  const openCompleteDialog = (task: MvacEntry) => {
    setSelectedMvac(task);
    setCompletionDate(new Date());
    setIsCompleteDialogOpen(true);
  };

  /* ---------- handleAction with overloads ---------- */

  // Overload for ViewMvacEntryDialog.onVerify
  async function handleAction(
    taskId: string,
    action: string,
    comment: string,
    updatedItems: MvacItem[]
  ): Promise<void>;

  // General overload (internal usage, including completion date)
  async function handleAction(
    taskId: string,
    action: string | ActionConfig,
    comment?: string,
    extra?: MvacItem[] | Date
  ): Promise<void>;

  async function handleAction(
    taskId: string,
    action: string | ActionConfig,
    comment: string = '',
    extra?: MvacItem[] | Date
  ): Promise<void> {
    if (!workflow || !userId || !userName || !stage || !projectSlug || !projectId)
      return;

    const actionName = typeof action === 'string' ? action : action.name;
    setIsActionLoading(taskId);

    // interpret extra
    const updatedItems = Array.isArray(extra) ? (extra as MvacItem[]) : undefined;
    const completionDateOverride =
      extra instanceof Date ? (extra as Date) : undefined;

    try {
      const taskRef = doc(db, 'projects', projectId, reg.mvacEntries, taskId);

      await runTransaction(db, async (transaction) => {
        const preSnap = await transaction.get(taskRef);
        if (!preSnap.exists()) throw new Error('Task document not found!');
        const preData = preSnap.data() as MvacEntry;

        let nextStep: WorkflowStep | undefined;
        let newStatus: MvacEntry['status'] = preData.status;
        let newStage = preData.stage;
        let newCurrentStepId: string | null = preData.currentStepId || null;
        let newAssignees: string[] = preData.assignees || [];
        let newDeadline: Timestamp | null = preData.deadline ?? null;

        const isCompletionAction = [
          'Approve',
          'Complete',
          'Verified',
          'Verify',
        ].includes(actionName);

        if (isCompletionAction) {
          const idx = workflow.findIndex((s) => s.id === stage.id);
          nextStep = workflow[idx + 1];

          if (nextStep) {
            const serializableData = {
              ...preData,
              createdAt:
                toDateSafe(preData.createdAt)?.toISOString() ??
                new Date().toISOString(),
              deadline:
                toDateSafe(preData.deadline)?.toISOString() ?? null,
              mvacDate:
                toDateSafe(preData.mvacDate)?.toISOString() ??
                new Date().toISOString(),
              history: (preData.history || []).map((h) => ({
                ...h,
                timestamp:
                  toDateSafe(h.timestamp)?.toISOString() ??
                  new Date().toISOString(),
              })),
            };
            const computedAssignees = await getAssigneeForStep(
              nextStep,
              serializableData as any
            );
            if (!computedAssignees || computedAssignees.length === 0) {
              throw new Error(
                `Could not find assignee for step: ${nextStep.name}`
              );
            }
            const deadlineDate = await calculateDeadline(
              new Date(),
              nextStep.tat
            );
            newAssignees = computedAssignees;
            newDeadline = Timestamp.fromDate(deadlineDate);
            newStage = nextStep.name;
            newStatus = 'In Progress';
            newCurrentStepId = nextStep.id;
          } else {
            // End of workflow
            newStage = 'Completed';
            newStatus = 'Completed';
            newCurrentStepId = null;
            newAssignees = [];
            newDeadline = null;
          }
        } else if (actionName === 'Reject') {
          newStage = 'Rejected';
          newStatus = 'Rejected';
          newCurrentStepId = null;
          newAssignees = [];
          newDeadline = null;
        } else {
          newAssignees = preData.assignees || [];
          newDeadline = preData.deadline ?? null;
        }

        const newActionLog: ActionLog = {
          action: actionName,
          comment,
          userId,
          userName,
          timestamp: completionDateOverride
            ? Timestamp.fromDate(completionDateOverride)
            : Timestamp.now(),
          stepName: stage.name,
        };

        const updateData: any = {
          status: newStatus,
          stage: newStage,
          currentStepId: newCurrentStepId,
          assignees: newAssignees,
          deadline: newDeadline,
          history: arrayUnion(newActionLog),
          version: (preData as any).version
            ? (preData as any).version + 1
            : 1,
        };

        // if verify dialog passed updatedItems, persist them
        if (updatedItems) {
          updateData.items = updatedItems;
        }

        transaction.update(taskRef, updateData);
      });

      toast({
        title: 'Success',
        description: `Task has been ${pastTense(actionName)}.`,
      });
      await fetchTasks();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to perform action.',
        variant: 'destructive',
      });
    } finally {
      setIsActionLoading(null);
      setIsVerifyOpen(false);
      setIsCompleteDialogOpen(false);
    }
  }

  const renderTable = (data: MvacEntry[], type: 'pending' | 'completed') => (
    <TableCard
      title={type === 'pending' ? 'Waiting for you' : 'Acted on by you'}
      description={
        type === 'pending'
          ? 'Open a row to see its lines; the menu on the right holds this step’s actions.'
          : 'Entries you have already acted on at this step, wherever they are now.'
      }
      count={isLoading ? undefined : data.length}
      noun="MVAC"
    >
      <Table className="min-w-[880px]">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">MVAC No.</TableHead>
            <TableHead className="whitespace-nowrap">MVAC Date</TableHead>
            <TableHead className="whitespace-nowrap">WO No.</TableHead>
            <TableHead className="text-right whitespace-nowrap">
              Total Amount
            </TableHead>
            <TableHead className="whitespace-nowrap">{type === 'pending' ? 'Deadline' : 'Now at'}</TableHead>
            <TableHead className="whitespace-nowrap">Status</TableHead>
            <TableHead className="text-right whitespace-nowrap">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7}>
                  <Skeleton className="h-8" />
                </TableCell>
              </TableRow>
            ))
          ) : data.length > 0 ? (
            data.map((entry) => {
              // A pending row is at this step by definition; fall back to it when the entry's
              // own step id isn't in the workflow, so the actions menu is never empty.
              const currentStep =
                workflow?.find((s) => s.id === entry.currentStepId) ??
                (type === 'pending' ? stage ?? undefined : undefined);
              const actions = Array.isArray(currentStep?.actions)
                ? (currentStep!.actions as (string | ActionConfig)[])
                : [];
              const total = computeTotalAmount(entry);
              const deadline = toDateSafe(entry.deadline);
              const overdue = deadline !== null && deadline.getTime() < loadedAt;

              return (
                <TableRow
                  key={entry.id}
                  onClick={() => handleViewDetails(entry)}
                  className="cursor-pointer"
                >
                  <TableCell className="whitespace-nowrap font-medium">
                    {entry.mvacNo ?? '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {humanDate(entry.mvacDate)}
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate whitespace-nowrap" title={entry.woNo || undefined}>
                    {entry.woNo || '—'}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {formatINR(total)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {type === 'pending' ? (
                      <span className="inline-flex items-center gap-2">
                        {humanDate(entry.deadline)}
                        {overdue && <StatusBadge tone="danger" status="Overdue" />}
                      </span>
                    ) : (
                      entry.stage || '—'
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <StatusBadge status={entry.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {isActionLoading === entry.id ? (
                      <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                    ) : type === 'completed' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewDetails(entry);
                        }}
                      >
                        View
                      </Button>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {actions.length === 0 && (
                            <DropdownMenuItem disabled>No actions set for this step</DropdownMenuItem>
                          )}
                          {actions.map((action) => {
                            const actionName =
                              typeof action === 'string'
                                ? action
                                : action.name;
                            const isVerify = isVerifyAction(actionName);
                            const isUpdateQty =
                              actionName === 'Update Certified Qty';
                            const isComplete = actionName === 'Complete';

                            return (
                              <DropdownMenuItem
                                key={actionName}
                                onSelect={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (isVerify) {
                                    handleVerifyClick(entry);
                                  } else if (isUpdateQty) {
                                    handleUpdateQtyClick(entry);
                                  } else if (isComplete) {
                                    openCompleteDialog(entry);
                                  } else {
                                    handleAction(entry.id!, action);
                                  }
                                }}
                              >
                                {actionName}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableEmpty colSpan={7} icon={<Inbox />}>
              {type === 'pending' ? 'Nothing is waiting for you at this step.' : 'You haven’t acted on any entry at this step yet.'}
            </TableEmpty>
          )}
        </TableBody>
      </Table>
    </TableCard>
  );

  /* ---------- states ---------- */
  const deskHref = `/billing-recon/${projectSlug}/mvac`;
  const stepIndex = stage ? workflow.findIndex((s) => s.id === stage.id) : -1;

  if (projectsLoading || (currentProject && isLoading && !stage && !loadProblem)) return <BrPageSkeleton kpis={4} />;

  if (!currentProject || loadProblem === 'workflow' || loadProblem === 'stage' || (loadProblem === 'error' && !stage)) {
    return (
      <BrPage tone={BR_TONE.mvac}>
        <PageHeader title="MVAC Stage" icon={Workflow} backHref={currentProject ? deskHref : '/billing-recon'} backLabel={currentProject ? 'Back to MVAC' : 'Back to Billing Recon'} />
        {!currentProject ? (
          <BrNotice tone="warning" icon={AlertTriangle} title="Project not found">
            No project matches this address. Choose a project from the switcher at the top of the menu.
          </BrNotice>
        ) : loadProblem === 'workflow' ? (
          <BrNotice
            tone="warning"
            icon={AlertTriangle}
            title="The MVAC workflow isn't set up"
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={`/billing-recon/${projectSlug}/mvac/settings/workflow-configuration`}>Workflow settings</Link>
              </Button>
            }
          >
            The MVAC workflow (one for every project) has no saved steps yet, so there are no stage queues.
          </BrNotice>
        ) : loadProblem === 'stage' ? (
          <BrNotice
            tone="warning"
            icon={AlertTriangle}
            title="This stage isn't in the MVAC workflow"
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={deskHref}>MVAC desk</Link>
              </Button>
            }
          >
            The link may be from before the workflow&apos;s steps were changed. Open the stage again from the MVAC desk.
          </BrNotice>
        ) : (
          <BrNotice
            tone="danger"
            icon={AlertTriangle}
            title="This stage couldn't be loaded"
            action={
              <Button size="sm" variant="outline" onClick={() => fetchTasks()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Try again
              </Button>
            }
          >
            Check the connection and try again.
          </BrNotice>
        )}
      </BrPage>
    );
  }

  return (
    <>
      <BrPage tone={BR_TONE.mvac}>
        <PageHeader
          title={stage?.name || 'MVAC Stage'}
          eyebrow={stepIndex >= 0 ? `MVAC workflow · step ${stepIndex + 1} of ${workflow.length}` : 'MVAC workflow'}
          description={stage?.description || 'MVAC entries waiting for you at this step, and the ones you have already acted on.'}
          icon={Workflow}
          backHref={deskHref}
          backLabel="Back to MVAC"
          actions={
            <Button variant="outline" onClick={() => fetchTasks()} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          }
        />

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            label="Waiting at this stage"
            value={isLoading ? '—' : kpis.waiting}
            hint={isLoading ? undefined : `${pendingTasks.length} assigned to you`}
            icon={Clock}
            tone="orange"
            accent
          />
          <KpiCard
            label="Overdue"
            value={isLoading ? '—' : kpis.overdue}
            hint="Past the step's turnaround"
            icon={AlarmClock}
            tone={kpis.overdue ? 'rose' : 'emerald'}
            accent
          />
          <KpiCard
            label="Oldest waiting"
            value={isLoading ? '—' : kpis.oldestDays === null ? '—' : `${kpis.oldestDays} d`}
            hint="Days since it was raised"
            icon={Hourglass}
            tone="amber"
            accent
          />
          <KpiCard
            label="Value waiting"
            value={isLoading ? '—' : formatAmountCompact(kpis.value)}
            hint={isLoading ? undefined : formatINR(kpis.value)}
            icon={IndianRupee}
            tone="indigo"
            accent
          />
        </div>

        {loadProblem === 'error' && (
          <BrNotice
            tone="danger"
            icon={AlertTriangle}
            title="The queue couldn't be refreshed"
            action={
              <Button size="sm" variant="outline" onClick={() => fetchTasks()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Try again
              </Button>
            }
          >
            The figures below are from the last successful load.
          </BrNotice>
        )}
        {!isLoading && !loadProblem && kpis.waiting === 0 && (
          <BrNotice tone="success" icon={CheckCircle2} title={`Nothing is waiting at ${stage?.name ?? 'this stage'}`}>
            Every MVAC on this project has moved past this step, or none has reached it yet.
          </BrNotice>
        )}
        {!isLoading && !loadProblem && kpis.waiting > 0 && pendingTasks.length === 0 && (
          <BrNotice tone="info" icon={Info} title="None of these is assigned to you">
            {kpis.waiting} {kpis.waiting === 1 ? 'entry is' : 'entries are'} waiting here with other assignees.
          </BrNotice>
        )}

        <Tabs defaultValue="pending">
          <TabsList className="grid w-full grid-cols-2 sm:max-w-md">
            <TabsTrigger value="pending">
              <Clock className="mr-2 h-4 w-4" /> Pending ({pendingTasks.length})
            </TabsTrigger>
            <TabsTrigger value="completed">
              <Check className="mr-2 h-4 w-4" /> Completed ({completedTasks.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">
            {renderTable(pendingTasks, 'pending')}
          </TabsContent>
          <TabsContent value="completed" className="mt-4">
            {renderTable(completedTasks, 'completed')}
          </TabsContent>
        </Tabs>
      </BrPage>

      {/* Complete dialog with custom date */}
      <Dialog open={isCompleteDialogOpen} onOpenChange={setIsCompleteDialogOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Confirm Completion</DialogTitle>
            <DialogDescription>
              Please select the date this task was completed.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {completionDate ? format(completionDate, 'PPP') : 'Select date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <Calendar
                  mode="single"
                  selected={completionDate}
                  onSelect={setCompletionDate}
                  disabled={{
                    after: new Date(),
                    before: subDays(new Date(), 7),
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() =>
                selectedMvac &&
                handleAction(
                  selectedMvac.id,
                  'Complete',
                  'Task marked as complete.',
                  completionDate
                )
              }
              disabled={!completionDate || (selectedMvac ? isActionLoading === selectedMvac.id : false)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ViewMvacEntryDialog
        isOpen={isViewOpen || isVerifyOpen}
        onOpenChange={handleDialogOpenChange}
        MvacEntry={selectedMvac}
        boqItems={boqItems}
        isEditMode={isVerifyOpen}
        onVerify={handleAction}
        isLoading={selectedMvac ? isActionLoading === selectedMvac.id : false}
      />

      {selectedMvac && (
        <UpdateMvacCertifiedQtyDialog
          isOpen={isUpdateQtyOpen}
          onOpenChange={setIsUpdateQtyOpen}
          mvacEntry={selectedMvac}
          projectSlug={projectSlug}
          onSaveSuccess={fetchTasks}
        />
      )}
    </>
  );
}
