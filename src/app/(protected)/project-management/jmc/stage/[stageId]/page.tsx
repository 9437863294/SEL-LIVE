'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, MoreHorizontal, Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PM_DIALOG } from '@/components/project-management/pm-shell';
import { cn } from '@/lib/utils';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  Timestamp,
  runTransaction,
  arrayUnion,
} from 'firebase/firestore';
import type {
  JmcEntry,
  WorkflowStep,
  ActionLog,
  BoqItem,
  Bill,
  ActionConfig,
  Project,
  JmcItem,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { jmcSlugify } from '@/lib/jmc-module';
import { useProjectManagementJmcContext } from '@/components/jmc/use-jmc-host-context';
import {
  JmcAccessDenied,
  JmcLoadingState,
  JmcProjectNotFound,
} from '@/components/jmc/jmc-page-shell';
import {
  JmcStageView,
  type JmcStageTab,
  type JmcStageTask,
} from '@/components/jmc/jmc-stage-view';
import { jmcTotals } from '@/lib/project-management-jmc-dashboard';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import ViewJmcEntryDialog from '@/components/billing-recon/ViewJmcEntryDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { UpdateCertifiedQtyDialog } from '@/components/billing-recon/UpdateCertifiedQtyDialog';
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

/* -------- helpers -------- */
function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
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
    Complete: 'completed',
    Reject: 'rejected',
    Revert: 'reverted',
  };
  return map[action] ?? `${action.toLowerCase()}ed`;
}

/**
 * What a certificate is worth: its stored total if it has one, otherwise its lines added up.
 *
 * The line rule itself is `jmcTotals`, which the dashboard and the log also read, so a certificate
 * cannot be worth one figure on this desk and another in the register.
 */
function computeTotalAmount(entry: JmcEntry | undefined): number {
  if (!entry) return 0;
  const explicit = (entry as any).totalAmount;
  if (Number.isFinite(explicit)) return explicit as number;
  return jmcTotals((entry.items ?? []) as any).total;
}

/**
 * The deadline as a person reads it. Returned only where the certificate has one — most completed
 * tasks do not, and "no deadline" is not the same as "on time".
 */
function dueFrom(value: any, now: Date): JmcStageTask['due'] {
  const deadline = toDateSafe(value);
  if (!deadline) return null;
  const days = Math.round(
    (new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86400000
  );
  if (days < 0) {
    const late = Math.abs(days);
    return { label: `${late} day${late === 1 ? '' : 's'} overdue`, overdue: true };
  }
  if (days === 0) return { label: 'Due today', overdue: false };
  return { label: `Due in ${days} day${days === 1 ? '' : 's'}`, overdue: false };
}

/** A certificate as the queue shows it. */
function toStageTask(entry: JmcEntry, now: Date): JmcStageTask {
  return {
    id: entry.id!,
    jmcNo: String(entry.jmcNo ?? ''),
    dateLabel: humanDate(entry.jmcDate),
    amount: computeTotalAmount(entry),
    status: String(entry.status ?? ''),
    due: dueFrom((entry as any).deadline, now),
  };
}

/* -------- component -------- */
export default function StagePage() {
  // The stage is still a route segment; only the project handle moved to `?project=`.
  const { stageId } = useParams() as { stageId: string };
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get('project') ?? '';
  const { context, isResolving, notFound, projectName } =
    useProjectManagementJmcContext(mappingId);

  const { user } = useAuth();
  const userId = (user as any)?.id ?? (user as any)?.uid ?? '';
  const userName = (user as any)?.name ?? (user as any)?.displayName ?? 'User';

  const { can, isLoading: authIsLoading } = useAuthorization();

  const canView = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('View', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context.permissionResource]);

  // The empty state offers "Create JMC", so it has to know whether this person may.
  const canCreate = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('Create JMC Entry', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context.permissionResource]);

  const { toast } = useToast();
  const router = useRouter();
  const back = useBackNavigation(context.jmcHref(), { fallbackLabel: 'Back to JMC' });

  const [tasks, setTasks] = useState<JmcEntry[]>([]);
  const [stage, setStage] = useState<WorkflowStep | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  const [selectedJmc, setSelectedJmc] = useState<JmcEntry | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isUpdateQtyOpen, setIsUpdateQtyOpen] = useState(false);
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  // Billing Recon's slug for the resolved project. Only the shared UpdateCertifiedQtyDialog needs
  // it — that component (also used by MVAC) still identifies its project by slug, so it is derived
  // from the resolved project rather than read from the route.
  const [projectSlug, setProjectSlug] = useState('');

  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [completionDate, setCompletionDate] = useState<Date | undefined>(new Date());

  const fetchTasks = useCallback(async () => {
    if (!userId || !stageId || !context.globalProjectId) return;

    setIsLoading(true);
    try {
      // 1) workflow + stage
      const workflowRef = doc(db, 'workflows', 'jmc-workflow');
      const workflowSnap = await getDoc(workflowRef);
      if (!workflowSnap.exists()) {
        toast({
          title: 'Error',
          description: 'Workflow not found.',
          variant: 'destructive',
        });
        router.back();
        return;
      }
      const steps = (workflowSnap.data().steps || []) as WorkflowStep[];
      setWorkflow(steps);
      const currentStage = steps.find((s) => s.id === stageId);
      if (!currentStage) {
        toast({
          title: 'Error',
          description: 'Workflow stage not found.',
          variant: 'destructive',
        });
        router.back();
        return;
      }
      setStage(currentStage);

      // 2) project for this route (cache id)
      const projectsQueryRef = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQueryRef);
      const projectsData = projectsSnapshot.docs.map(
        (d) => ({ id: d.id, ...d.data() } as Project)
      );
      const projectData = context.resolveProject(projectsData) as Project | null;

      if (!projectData) throw new Error('Project not found');
      const pid = projectData.id;
      setProjectId(pid);
      setProjectSlug(jmcSlugify((projectData as any).projectName || ''));

      // 3) stage tasks + BOQ + bills (for cached project id)
      const [stageTasksSnap, boqSnap, billsSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'projects', pid, 'jmcEntries'),
            where('currentStepId', '==', stageId)
          )
        ),
        getDocs(query(collection(db, 'projects', pid, 'boqItems'))),
        getDocs(query(collection(db, 'projects', pid, 'bills'))),
      ]);

      setTasks(
        stageTasksSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry)
        )
      );
      setBoqItems(
        boqSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) } as BoqItem)
        )
      );
      setBills(
        billsSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) } as Bill)
        )
      );
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      router.back();
    } finally {
      setIsLoading(false);
    }
  }, [context, stageId, toast, router, userId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!userId || !stage)
      return { pendingTasks: [] as JmcEntry[], completedTasks: [] as JmcEntry[] };

    const myPending = tasks.filter(
      (t) =>
        (t.assignees ?? []).includes(userId) &&
        t.status !== 'Completed' &&
        t.status !== 'Rejected'
    );

    const myCompleted = tasks.filter(
      (t) =>
        !myPending.some((pt) => pt.id === t.id) &&
        (t.history ?? []).some(
          (h) => h.stepName === stage.name && h.userId === userId
        )
    );

    return { pendingTasks: myPending, completedTasks: myCompleted };
  }, [tasks, userId, stage]);

  // Dialog visibility
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setIsViewOpen(false);
      setIsVerifyOpen(false);
      setIsUpdateQtyOpen(false);
      setSelectedJmc(null);
    }
  };

  const handleUpdateQtyClick = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsUpdateQtyOpen(true);
  };

  const handleViewDetails = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsViewOpen(true);
  };

  const handleVerifyClick = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsVerifyOpen(true);
  };

  const openCompleteDialog = (task: JmcEntry) => {
    setSelectedJmc(task);
    setCompletionDate(new Date());
    setIsCompleteDialogOpen(true);
  };

  /* ---------- handleAction with overloads ---------- */

  // Overload for ViewJmcEntryDialog.onVerify
  async function handleAction(
    taskId: string,
    action: string,
    comment: string,
    updatedItems: JmcItem[]
  ): Promise<void>;

  // General overload (internal usage, including completion date)
  async function handleAction(
    taskId: string,
    action: string | ActionConfig,
    comment?: string,
    extra?: JmcItem[] | Date
  ): Promise<void>;

  async function handleAction(
    taskId: string,
    action: string | ActionConfig,
    comment: string = '',
    extra?: JmcItem[] | Date
  ): Promise<void> {
    if (
      !workflow ||
      !userId ||
      !userName ||
      !stage ||
      !context.globalProjectId ||
      !projectId
    )
      return;

    const actionName = typeof action === 'string' ? action : action.name;
    setIsActionLoading(taskId);

    // interpret extra
    const updatedItems = Array.isArray(extra) ? (extra as JmcItem[]) : undefined;
    const completionDateOverride =
      extra instanceof Date ? (extra as Date) : undefined;

    try {
      const taskRef = doc(db, 'projects', projectId, 'jmcEntries', taskId);

      await runTransaction(db, async (transaction) => {
        const preSnap = await transaction.get(taskRef);
        if (!preSnap.exists()) throw new Error('Task document not found!');
        const preData = preSnap.data() as JmcEntry;

        let nextStep: WorkflowStep | undefined;
        let newStatus: JmcEntry['status'] = preData.status;
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
              jmcDate:
                toDateSafe(preData.jmcDate)?.toISOString() ??
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

  /* The configured run, and where this stage sits in it. */
  const stepNames = useMemo(() => workflow.map((step) => step.name), [workflow]);
  const stageIndex = useMemo(
    () => workflow.findIndex((step) => step.id === stageId),
    [workflow, stageId]
  );

  /* The two queues as the view reads them. One `now` for the whole render, so two rows cannot
     word the same deadline differently. */
  const stageRows = useMemo(() => {
    const now = new Date();
    return {
      pending: pendingTasks.map((entry) => toStageTask(entry, now)),
      completed: completedTasks.map((entry) => toStageTask(entry, now)),
    };
  }, [pendingTasks, completedTasks]);

  /* The view carries the certificate's figures, not the record; the handlers need the record. */
  const entriesById = useMemo(
    () => new Map(tasks.filter((entry) => entry.id).map((entry) => [entry.id!, entry])),
    [tasks]
  );

  /**
   * A task's own buttons.
   *
   * Passed into the view rather than built there: which actions a step offers is configured on
   * the workflow, and taking one runs a transaction that belongs with this page.
   */
  const renderActions = (task: JmcStageTask, tab: JmcStageTab) => {
    const entry = entriesById.get(task.id);
    if (!entry) return null;

    const currentStep = workflow?.find((s) => s.id === entry.currentStepId);
    const actions = Array.isArray(currentStep?.actions)
      ? (currentStep!.actions as (string | ActionConfig)[])
      : [];

    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => handleViewDetails(entry)}
        >
          Details
        </Button>

        {isActionLoading === entry.id ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-label="Working" />
        ) : tab === 'pending' && actions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="h-8"
                aria-label={`Actions for JMC ${entry.jmcNo ?? ''}`}
              >
                Actions
                <MoreHorizontal className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action) => {
                const actionName = typeof action === 'string' ? action : action.name;
                const isVerify = actionName.toLowerCase().includes('verify');
                const isUpdateQty = actionName === 'Update Certified Qty';
                const isComplete = actionName === 'Complete';

                return (
                  <DropdownMenuItem
                    key={actionName}
                    onSelect={(e) => {
                      e.preventDefault();
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
        ) : null}
      </>
    );
  };

  if (isResolving || authIsLoading) {
    return <JmcLoadingState />;
  }

  // Access Denied is checked before the project guard, matching the other seven JMC screens: a
  // user without the right should be told that, not shown which project failed to resolve.
  if (!canView) {
    return (
      <JmcAccessDenied description="You do not have permission to view JMC stage tasks." />
    );
  }

  if (notFound) {
    return (
      <JmcProjectNotFound description="This JMC stage could not be resolved to a project. Open it from a project in Project Management." />
    );
  }

  return (
    <>
      <JmcStageView
        back={back}
        crumbs={[
          { label: 'JMC Management', href: context.jmcHref() },
          ...(stageIndex >= 0 ? [{ label: `Stage ${stageIndex + 1}` }] : []),
        ]}
        stageName={stage?.name || 'JMC Stage'}
        stageIndex={stageIndex}
        steps={stepNames}
        projectName={projectName}
        description={
          projectName
            ? `Workflow stage tasks assigned to you for ${projectName}`
            : 'Workflow stage tasks assigned to you'
        }
        pending={stageRows.pending}
        completed={stageRows.completed}
        logHref={context.jmcHref('log')}
        createHref={canCreate ? context.jmcHref('entry') : undefined}
        onOpen={(task) => {
          const entry = entriesById.get(task.id);
          if (entry) handleViewDetails(entry);
        }}
        renderActions={renderActions}
        isLoading={isLoading}
      />

      {/* Complete dialog with custom date */}
      <Dialog open={isCompleteDialogOpen} onOpenChange={setIsCompleteDialogOpen}>
        <DialogContent className={cn(PM_DIALOG.content, 'sm:max-w-md w-full')}>
          <DialogHeader className={PM_DIALOG.header}>
            <DialogTitle>Confirm Completion</DialogTitle>
            <DialogDescription>
              Please select the date this task was completed.
            </DialogDescription>
          </DialogHeader>
          <div className={cn(PM_DIALOG.body, 'py-4')}>
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
          <DialogFooter className={PM_DIALOG.footer}>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() =>
                selectedJmc &&
                handleAction(
                  selectedJmc.id,
                  'Complete',
                  'Task marked as complete.',
                  completionDate
                )
              }
              disabled={!completionDate}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ViewJmcEntryDialog
        isOpen={isViewOpen || isVerifyOpen}
        onOpenChange={handleDialogOpenChange}
        jmcEntry={selectedJmc}
        printRegister="project"
        boqItems={boqItems}
        bills={bills}
        isEditMode={isVerifyOpen}
        onVerify={handleAction}
        isLoading={selectedJmc ? isActionLoading === selectedJmc.id : false}
      />

      {selectedJmc && (
        <UpdateCertifiedQtyDialog
          isOpen={isUpdateQtyOpen}
          onOpenChange={setIsUpdateQtyOpen}
          jmcEntry={selectedJmc}
          projectSlug={projectSlug}
          onSaveSuccess={fetchTasks}
        />
      )}
    </>
  );
}
