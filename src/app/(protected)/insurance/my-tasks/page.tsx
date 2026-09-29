
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { arrayUnion, collection, doc, getDoc, getDocs, runTransaction, Timestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { format, isPast } from 'date-fns';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { syncInsuranceTasks } from '@/lib/insurance-service';
import { formatInr } from '@/lib/insurance';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import type { ActionConfig, ActionLog, InsuranceTask, WorkflowStep } from '@/lib/types';
import ViewInsuranceTaskDialog from '@/components/insurance/ViewInsuranceTaskDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

const getActionName = (action: string | ActionConfig): string =>
  typeof action === 'string' ? action : action.name;

/** A rejection needs its reason and some steps need a document, so those go through the dialog. */
const needsDialog = (step: WorkflowStep | undefined, action: string) => action === 'Reject' || step?.upload === 'Required';

// ─── page ─────────────────────────────────────────────────────────────────────

export default function MyTasksPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();

  const [allTasks, setAllTasks] = useState<InsuranceTask[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStep[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<InsuranceTask | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

  const canViewPage = can('View', 'Insurance.My Tasks');

  // ─── data ────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [workflowDoc, tasksSnapshot] = await Promise.all([
        getDoc(doc(db, 'workflows', 'insurance-workflow')),
        getDocs(collection(db, 'insuranceTasks')),
      ]);
      if (workflowDoc.exists()) setWorkflow(workflowDoc.data().steps as WorkflowStep[]);
      setAllTasks(tasksSnapshot.docs.map((d) => ({ id: d.id, ...d.data() } as InsuranceTask)));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to fetch tasks.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // The task list loads whether or not the sync succeeds — a failed sync used to leave the page on
  // its loading skeleton for good, because only a successful sync went on to fetch the tasks.
  const handleSync = useCallback(async (showToast = false) => {
    if (!user) return;
    setIsSyncing(true);
    try {
      const result = await syncInsuranceTasks();
      if (showToast) {
        const parts = [`${result.created} new task${result.created === 1 ? '' : 's'} raised`, `${result.existing} already open or done`];
        if (result.unassigned.length) parts.push(`no assignee for ${result.unassigned.join(', ')}`);
        toast({ title: 'Sync complete', description: parts.join(' · ') + '.' });
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (showToast) toast({ title: 'Sync failed', description: msg.includes('permission') ? "You don't have permission to raise insurance tasks." : msg, variant: 'destructive' });
      else console.warn('Insurance task sync failed:', e);
    } finally {
      setIsSyncing(false);
      await fetchData();
    }
  }, [user, fetchData, toast]);

  useEffect(() => {
    if (authLoading) return;
    if (canViewPage) handleSync(false);
    else setIsLoading(false);
  }, [canViewPage, authLoading, handleSync]);

  // ─── derived ──────────────────────────────────────────────────────────────

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!user) return { pendingTasks: [], completedTasks: [] };
    const myPending = allTasks
      .filter((t) => t.assignees?.includes(user.id) && ['Pending', 'In Progress', 'Needs Review'].includes(t.status))
      .sort((a, b) => a.dueDate.toMillis() - b.dueDate.toMillis());
    // Closed tasks this user worked on — assignees are cleared on completion, so the history says who.
    const myCompleted = allTasks
      .filter((t) => ['Completed', 'Rejected'].includes(t.status) && (t.history ?? []).some((h) => h.userId === user.id))
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    return { pendingTasks: myPending, completedTasks: myCompleted };
  }, [allTasks, user]);

  // ─── action handler (unchanged logic) ────────────────────────────────────

  const openTask = (task: InsuranceTask) => { setSelectedTask(task); setIsViewDialogOpen(true); };

  const handleAction = async (taskId: string, action: string, comment: string, file?: File) => {
    if (!workflow || !user) return;
    if (action === 'Reject' && !comment.trim()) {
      toast({ title: 'Reason required', description: 'Add a comment explaining the rejection.', variant: 'destructive' });
      return;
    }
    setIsActionLoading(taskId);
    try {
      const taskRef = doc(db, 'insuranceTasks', taskId);
      const taskDocInitial = await getDoc(taskRef);
      if (!taskDocInitial.exists()) throw new Error('Task document not found!');
      const currentTaskData = taskDocInitial.data() as InsuranceTask;
      const currentStep = workflow.find((s) => s.id === currentTaskData.currentStepId);
      if (!currentStep) throw new Error('Current workflow step not found.');

      let attachmentData: { name: string; url: string } | undefined;
      if (file) {
        const storageRef = ref(storage, `insurance-actions/${taskId}/${currentStep.name}/${file.name}`);
        await uploadBytes(storageRef, file);
        attachmentData = { name: file.name, url: await getDownloadURL(storageRef) };
      }

      await runTransaction(db, async (transaction) => {
        const taskDoc = await transaction.get(taskRef);
        if (!taskDoc.exists()) throw new Error('Task document not found!');
        const latestTaskData = taskDoc.data() as InsuranceTask;

        const newActionLog: ActionLog = { action, comment, userId: user.id, userName: user.name, timestamp: Timestamp.now(), stepName: currentStep.name, attachment: attachmentData };

        let nextStep: WorkflowStep | undefined;
        let newStatus: InsuranceTask['status'] = latestTaskData.status;
        let newStage = latestTaskData.currentStage;
        let newCurrentStepId: string | null = latestTaskData.currentStepId || null;
        let newAssignees: string[] = [];
        let newDeadline: Timestamp | null = null;

        if (['Approve', 'Verified', 'Update Approved Amount'].includes(action)) {
          const idx = workflow.findIndex((s) => s.id === currentStep.id);
          nextStep = workflow[idx + 1];
          if (nextStep) {
            newStage = nextStep.name; newStatus = 'In Progress'; newCurrentStepId = nextStep.id;
            const tempData = { projectId: (latestTaskData as any).projectId || '', departmentId: '', amount: (latestTaskData as any).premium || 0 };
            const assignees = await getAssigneeForStep(nextStep, tempData);
            if (assignees.length === 0) throw new Error(`Could not find assignee for step: ${nextStep.name}`);
            newAssignees = assignees;
            newDeadline = Timestamp.fromDate(await calculateDeadline(new Date(), nextStep.tat));
          } else {
            newStage = 'Completed'; newStatus = 'Completed'; newCurrentStepId = null;
          }
        } else if (action === 'Reject') {
          newStage = 'Rejected'; newStatus = 'Rejected'; newCurrentStepId = null; newAssignees = []; newDeadline = null;
        } else {
          newAssignees = latestTaskData.assignees || []; newDeadline = latestTaskData.deadline;
        }

        transaction.update(taskRef, { status: newStatus, currentStage: newStage, currentStepId: newCurrentStepId, assignees: newAssignees, deadline: newDeadline, history: arrayUnion(newActionLog) });
      });

      toast({ title: 'Done', description: `${action} recorded.` });
      setIsViewDialogOpen(false);
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to perform action.', variant: 'destructive' });
    } finally {
      setIsActionLoading(null);
    }
  };

  // ─── render helpers ───────────────────────────────────────────────────────

  const renderTaskTable = (data: InsuranceTask[], isPending: boolean) => {
    if (isLoading) {
      return (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      );
    }
    if (data.length === 0) {
      return (
        <Card className="border-border/60">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            {isPending
              ? <><CheckCircle2 className="h-12 w-12 text-emerald-400" /><p className="text-sm font-medium text-slate-600">No pending tasks</p><p className="text-xs text-muted-foreground">You're all caught up!</p></>
              : <><ClipboardCheck className="h-12 w-12 text-muted-foreground/30" /><p className="text-sm text-muted-foreground">No completed or rejected tasks yet.</p></>}
          </CardContent>
        </Card>
      );
    }
    return (
      <TableCard title={isPending ? 'Pending tasks' : 'Completed / rejected tasks'} count={data.length} noun="task">
        {/* Mobile cards */}
        <div className="space-y-2 p-3 sm:hidden">
          {data.map((task) => {
            const currentStep = workflow?.find((s) => s.id === task.currentStepId);
            const isOverdue = task.deadline && isPast(task.deadline.toDate());
            return (
              <div key={task.id} className={cn('rounded-xl border p-3 space-y-2 cursor-pointer transition-colors', isOverdue ? 'border-red-200 bg-red-50/40' : 'border-border/60 hover:bg-muted/30')} onClick={() => { setSelectedTask(task); setIsViewDialogOpen(true); }}>
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold text-sm">{task.insuredPerson}</p><p className="text-xs text-muted-foreground font-mono">{task.policyNo}</p></div>
                  <StatusBadge status={task.status} className="shrink-0" />
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div><span className="text-muted-foreground">{task.taskType === 'Maturity Due' ? 'Matures' : 'Due'}: </span>{format(task.dueDate.toDate(), 'dd MMM yyyy')}</div>
                  <div><span className="text-muted-foreground">Type: </span>{task.taskType}{task.amount ? ` · ${formatInr(task.amount)}` : ''}</div>
                  {isPending && <div><span className="text-muted-foreground">Stage: </span>{task.currentStage}</div>}
                  {task.deadline && <div className={cn('col-span-2', isOverdue && 'text-red-600 font-medium')}><span className={isOverdue ? '' : 'text-muted-foreground'}>Deadline: </span>{format(task.deadline.toDate(), 'dd MMM yyyy HH:mm')}</div>}
                </div>
                {isPending && currentStep?.actions && currentStep.actions.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                    {currentStep.actions.slice(0, 3).map((action) => {
                      const name = getActionName(action);
                      return (
                        <Button key={name} size="sm" variant={name === 'Reject' ? 'destructive' : 'default'} className="h-7 text-xs gap-1" disabled={isActionLoading === task.id} onClick={() => (needsDialog(currentStep, name) ? openTask(task) : handleAction(task.id, name, ''))}>
                          {isActionLoading === task.id ? <Loader2 className="h-3 w-3 animate-spin" /> : name}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
          <Table containerClassName="hidden sm:block">
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Insured Person</TableHead>
                <TableHead>Due / Maturity</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>{isPending ? 'Stage' : 'Status'}</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((task) => {
                const currentStep = workflow?.find((s) => s.id === task.currentStepId);
                const actions = currentStep?.actions || [];
                const isOverdue = task.deadline && isPast(task.deadline.toDate());
                return (
                  <TableRow key={task.id} className={cn('cursor-pointer', isOverdue && 'bg-rose-50/60')} onClick={() => { setSelectedTask(task); setIsViewDialogOpen(true); }}>
                    <TableCell className="whitespace-nowrap">{format(task.createdAt.toDate(), 'dd MMM yy, HH:mm')}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p className="text-xs font-medium">{task.taskType}</p>
                      {task.amount ? <p className="text-[11px] text-muted-foreground tabular-nums">{formatInr(task.amount)}</p> : null}
                    </TableCell>
                    <TableCell className="font-mono font-medium whitespace-nowrap">{task.policyNo}</TableCell>
                    <TableCell className="font-medium">{task.insuredPerson}</TableCell>
                    <TableCell className="whitespace-nowrap">{format(task.dueDate.toDate(), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {task.deadline ? (
                        <span className={cn(isOverdue && 'text-red-600 font-semibold')}>
                          {format(task.deadline.toDate(), 'dd MMM yy, HH:mm')}
                          {isOverdue && <span className="ml-1 text-[10px]">(overdue)</span>}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={task.status}>{isPending ? task.currentStage : undefined}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {isActionLoading === task.id ? (
                        <Loader2 className="h-4 w-4 animate-spin ml-auto text-muted-foreground" />
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => { setSelectedTask(task); setIsViewDialogOpen(true); }}>
                              <Eye className="mr-2 h-4 w-4" /> View Details
                            </DropdownMenuItem>
                            {isPending && actions.length > 0 && actions.map((action) => {
                              const name = getActionName(action);
                              return (
                                <DropdownMenuItem key={`${task.id}-${name}`} onSelect={(e) => { e.preventDefault(); if (needsDialog(currentStep, name)) openTask(task); else handleAction(task.id, name, ''); }}>
                                  {name === 'Reject' ? <XCircle className="mr-2 h-4 w-4 text-red-500" /> : <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />}
                                  {name}
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
      </TableCard>
    );
  };

  // ─── access guard ─────────────────────────────────────────────────────────

  if (authLoading) return <div className="space-y-4"><Skeleton className="h-28 w-full rounded-xl" /><Skeleton className="h-64 w-full rounded-xl" /></div>;

  if (!canViewPage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied</CardTitle>
          <CardDescription>You do not have permission to view this page.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="space-y-4">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <PageHeader
          icon={ClipboardCheck}
          title="My Insurance Tasks"
          description="Premium, renewal and maturity tasks assigned to you — approve, verify, or reject"
          badge={
            /* Quick stats */
            !isLoading && (
              <div className="flex items-center gap-2 text-sm">
                {pendingTasks.length > 0 && (
                  <Badge variant="warning" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {pendingTasks.length} pending
                  </Badge>
                )}
                {completedTasks.filter((t) => t.status === 'Completed').length > 0 && (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {completedTasks.filter((t) => t.status === 'Completed').length} done
                  </Badge>
                )}
              </div>
            )
          }
          actions={
            <Button size="sm" onClick={() => handleSync(true)} disabled={isSyncing} className="gap-1.5">
              {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync Tasks
            </Button>
          }
        />

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <Tabs defaultValue="pending">
          <TabsList className="h-9 gap-1 bg-muted/60 p-1">
            <TabsTrigger value="pending" className="h-7 text-xs">
              My Pending Tasks
              {!isLoading && pendingTasks.length > 0 && (
                <Badge variant="warning" className="ml-1.5 h-4 min-w-4 px-1 text-[10px]">{pendingTasks.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed" className="h-7 text-xs">
              Completed / Rejected
              {!isLoading && completedTasks.length > 0 && (
                <Badge variant="neutral" className="ml-1.5 h-4 min-w-4 px-1 text-[10px]">{completedTasks.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-3">{renderTaskTable(pendingTasks, true)}</TabsContent>
          <TabsContent value="completed" className="mt-3">{renderTaskTable(completedTasks, false)}</TabsContent>
        </Tabs>

        <ViewInsuranceTaskDialog isOpen={isViewDialogOpen} onOpenChange={setIsViewDialogOpen} task={selectedTask} workflow={workflow} onAction={handleAction} isActionLoading={!!isActionLoading} />
      </div>
    </TooltipProvider>
  );
}
