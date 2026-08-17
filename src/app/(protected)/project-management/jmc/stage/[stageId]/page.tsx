'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Check,
  Clock,
  GitMerge,
  Loader2,
  MoreHorizontal,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  JMC_GRADIENT,
  JmcAccessDenied,
  JmcLoadingState,
  JmcPageHeader,
  JmcPageShell,
  JmcProjectNotFound,
} from '@/components/jmc/jmc-page-shell';
import { JmcNav } from '@/components/jmc/jmc-nav';
import { Skeleton } from '@/components/ui/skeleton';
import ViewJmcEntryDialog from '@/components/billing-recon/ViewJmcEntryDialog';
import { Badge } from '@/components/ui/badge';
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

function computeTotalAmount(entry: JmcEntry | undefined): number {
  if (!entry) return 0;
  const explicit = (entry as any).totalAmount;
  if (Number.isFinite(explicit)) return explicit as number;
  const items = entry.items ?? [];
  let total = 0;
  for (const it of items) {
    const qty = Number(it.certifiedQty ?? it.executedQty ?? 0);
    const rate = Number(it.rate ?? 0);
    if (Number.isFinite(qty) && Number.isFinite(rate)) total += qty * rate;
  }
  return total;
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

  const { toast } = useToast();
  const router = useRouter();

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

  const renderTable = (data: JmcEntry[], type: 'pending' | 'completed') => (
    <Card className="border-border/60">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[880px]">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">JMC No.</TableHead>
                <TableHead className="whitespace-nowrap">JMC Date</TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  Total Amount
                </TableHead>
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
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data.length > 0 ? (
                data.map((entry) => {
                  const currentStep = workflow?.find(
                    (s) => s.id === entry.currentStepId
                  );
                  const actions = Array.isArray(currentStep?.actions)
                    ? (currentStep!.actions as (string | ActionConfig)[])
                    : [];
                  const total = computeTotalAmount(entry);

                  return (
                    <TableRow
                      key={entry.id}
                      onClick={() => handleViewDetails(entry)}
                      className="cursor-pointer"
                    >
                      <TableCell className="whitespace-nowrap">
                        {entry.jmcNo ?? '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {humanDate(entry.jmcDate)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {formatINR(total)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge
                          variant={
                            entry.status === 'Completed'
                              ? 'default'
                              : 'secondary'
                          }
                        >
                          {entry.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isActionLoading === entry.id ? (
                          <Loader2 className="ml-auto h-4 w-4 animate-spin" />
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
                              {type === 'pending' &&
                                actions.map((action) => {
                                  const actionName =
                                    typeof action === 'string'
                                      ? action
                                      : action.name;
                                  const isVerify = actionName
                                    .toLowerCase()
                                    .includes('verify');
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
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    No {type} tasks found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );

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
      <JmcPageShell>
        <JmcPageHeader
          title={stage?.name || 'JMC Stage'}
          subtitle={
            projectName
              ? `Workflow stage tasks assigned to you for ${projectName}`
              : 'Workflow stage tasks assigned to you'
          }
          icon={GitMerge}
          backHref={context.jmcHref()}
          gradient={JMC_GRADIENT}
        />

        <JmcNav context={context} active="hub" />

        <Tabs defaultValue="pending">
          <TabsList className="grid w-full grid-cols-2">
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
      </JmcPageShell>

      {/* Complete dialog with custom date */}
      <Dialog open={isCompleteDialogOpen} onOpenChange={setIsCompleteDialogOpen}>
        <DialogContent className="sm:max-w-md w-full">
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
