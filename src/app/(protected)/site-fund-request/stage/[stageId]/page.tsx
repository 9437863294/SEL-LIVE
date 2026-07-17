'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  Clock,
  Loader2,
  MoreHorizontal,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/firebase';
import {
  collection, query, where, getDocs, doc, getDoc, Timestamp, runTransaction, arrayUnion,
} from 'firebase/firestore';
import type { Requisition, WorkflowStep, ActionLog, Department, ActionConfig, AccountHead, SubAccountHead } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import ViewRequestDialog from '@/components/site-fund-request/ViewRequestDialog';
import { cn } from '@/lib/utils';

const MODULE_LABEL = 'Site Fund Request';
const WORKFLOW_DOC = 'site-fund-request';
const COLLECTION = 'siteFundRequests';
const BASE_ROUTE = '/site-fund-request';

function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') { const d = new Date(value); return isNaN(d.getTime()) ? null : d; }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

function humanDate(value: any) {
  const d = toDateSafe(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatINR(n?: number) {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v); }
  catch { return `₹${v.toFixed(2)}`; }
}

function statusBadgeClass(status?: string) {
  switch (status) {
    case 'Completed':  return 'border-emerald-200/80 bg-emerald-50 text-emerald-700';
    case 'Rejected':   return 'border-rose-200/80 bg-rose-50 text-rose-700';
    case 'In Progress': return 'border-sky-200/80 bg-sky-50 text-sky-700';
    case 'Pending':    return 'border-amber-200/80 bg-amber-50 text-amber-700';
    default:           return 'border-slate-200/80 bg-slate-50 text-slate-700';
  }
}

const stepDisplay = (step: WorkflowStep): string => step?.name || 'Unknown Step';

export default function StagePage() {
  const { stageId } = useParams() as { stageId: string };
  const { user } = useAuth();
  const userId = (user as any)?.id ?? (user as any)?.uid ?? '';
  const userName = (user as any)?.name ?? (user as any)?.displayName ?? 'User';
  const { toast } = useToast();
  const router = useRouter();

  const [tasks, setTasks] = useState<Requisition[]>([]);
  const [stage, setStage] = useState<WorkflowStep | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  const [selectedRequisition, setSelectedRequisition] = useState<Requisition | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);

  const fetchTasks = useCallback(async () => {
    if (!userId || !stageId) return;
    setIsLoading(true);
    try {
      const workflowSnap = await getDoc(doc(db, 'workflows', WORKFLOW_DOC));
      if (!workflowSnap.exists()) {
        toast({ title: 'Error', description: 'Workflow not found.', variant: 'destructive' });
        router.back(); return;
      }
      const steps = (workflowSnap.data().steps || []) as WorkflowStep[];
      setWorkflow(steps);
      const currentStage = steps.find(s => s.id === stageId);
      if (!currentStage) {
        toast({ title: 'Error', description: 'Workflow stage not found.', variant: 'destructive' });
        router.back(); return;
      }
      setStage(currentStage);

      const [deptsSnap, reqsSnap] = await Promise.all([
        getDocs(collection(db, 'departments')),
        getDocs(query(collection(db, COLLECTION), where('currentStepId', '==', stageId))),
      ]);
      setDepartments(deptsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Department)));
      setTasks(reqsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Requisition)));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      router.back();
    } finally {
      setIsLoading(false);
    }
  }, [stageId, toast, router, userId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!userId || !stage) return { pendingTasks: [], completedTasks: [] };
    const myPending = tasks.filter(t =>
      (t.assignees ?? []).includes(userId) && t.status !== 'Completed' && t.status !== 'Rejected'
    );
    const myCompleted = tasks.filter(t =>
      !myPending.some(pt => pt.id === t.id) &&
      (t.history ?? []).some(h => h.stepName === stage.name && h.userId === userId)
    );
    return { pendingTasks: myPending, completedTasks: myCompleted };
  }, [tasks, userId, stage]);

  const handleAction = async (taskId: string, action: string | ActionConfig, comment = '') => {
    const currentRequisition = tasks.find(t => t.id === taskId);
    if (!user || !currentRequisition || !workflow || !stage) return;
    const actionName = typeof action === 'string' ? action : action.name;

    setIsActionLoading(taskId);
    try {
      const requisitionRef = doc(db, COLLECTION, taskId);
      await runTransaction(db, async (transaction) => {
        const reqDoc = await transaction.get(requisitionRef);
        if (!reqDoc.exists()) throw new Error('Request document not found!');
        const currentData = { ...reqDoc.data(), id: reqDoc.id } as Requisition;

        const newActionLog: ActionLog = {
          action: actionName, comment, userId, userName,
          timestamp: Timestamp.now(), stepName: stage.name,
        };

        const isCompletionAction = ['Approve', 'Complete', 'Verified', 'Update Approved Amount'].includes(actionName);
        let newStatus: Requisition['status'] = currentData.status;
        let newStage = currentData.stage;
        let newCurrentStepId: string | null = currentData.currentStepId || null;
        let newAssignees: string[] = [];
        let newDeadline: Timestamp | null = null;

        if (isCompletionAction) {
          const idx = workflow.findIndex(s => s.id === stage.id);
          const nextStep = idx >= 0 ? workflow[idx + 1] : undefined;
          if (nextStep) {
            newStage = stepDisplay(nextStep as any);
            newStatus = 'In Progress';
            newCurrentStepId = nextStep.id;
            const assignees = await getAssigneeForStep(nextStep, currentData as any);
            if (!assignees || assignees.length === 0) throw new Error(`No assignee for step: ${stepDisplay(nextStep as any)}`);
            newAssignees = assignees;
            newDeadline = Timestamp.fromDate(await calculateDeadline(new Date(), (nextStep as any).tat));
          } else {
            newStage = 'Completed'; newStatus = 'Completed'; newCurrentStepId = null;
          }
        } else if (actionName === 'Reject') {
          newStage = 'Rejected'; newStatus = 'Rejected'; newCurrentStepId = null;
        }

        transaction.update(requisitionRef, {
          status: newStatus, stage: newStage, currentStepId: newCurrentStepId,
          assignees: newAssignees, deadline: newDeadline, history: arrayUnion(newActionLog),
        });
      });

      toast({ title: 'Success', description: `Action "${actionName}" applied successfully.` });
      await fetchTasks();
      setIsViewOpen(false);
    } catch (error: any) {
      toast({ title: 'Action Failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsActionLoading(null);
    }
  };

  const renderTable = (data: Requisition[], type: 'pending' | 'completed') => (
    <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
      <div className="h-1.5 w-full bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 opacity-70" />
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-white/80 border-b border-white/70">
            <TableRow>
              <TableHead>Request ID</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-8" /></TableCell></TableRow>
              ))
            ) : data.length > 0 ? data.map(task => {
              const currentStep = workflow.find(s => s.id === task.currentStepId);
              const actions = Array.isArray(currentStep?.actions) ? (currentStep!.actions as (string | ActionConfig)[]) : [];
              return (
                <TableRow key={task.id} onClick={() => { setSelectedRequisition(task); setIsViewOpen(true); }} className="cursor-pointer hover:bg-slate-50/70">
                  <TableCell className="font-mono text-sm">{task.requisitionId ?? '-'}</TableCell>
                  <TableCell>{humanDate(task.date)}</TableCell>
                  <TableCell>{formatINR(task.amount)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('whitespace-nowrap', statusBadgeClass(task.status))}>
                      {task.status || '—'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isActionLoading === task.id ? (
                      <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => e.stopPropagation()}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => { setSelectedRequisition(task); setIsViewOpen(true); }}>
                            <Eye className="mr-2 h-4 w-4" /> View Details
                          </DropdownMenuItem>
                          {type === 'pending' && actions.map(action => {
                            const name = typeof action === 'string' ? action : action.name;
                            return (
                              <DropdownMenuItem key={name} onSelect={e => { e.preventDefault(); handleAction(task.id, action); }}>
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
            }) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24 text-slate-500">
                  No {type} tasks for this stage.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <>
      <div className="w-full space-y-6 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Link href={BASE_ROUTE}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{MODULE_LABEL}</p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{stage?.name || 'Stage'}</h1>
            <p className="text-sm text-slate-600">
              Pending: {pendingTasks.length} · Completed: {completedTasks.length}
            </p>
          </div>
        </div>

        <Tabs defaultValue="pending">
          <TabsList className="grid w-full grid-cols-2 rounded-2xl border border-white/70 bg-white/70 p-1 backdrop-blur">
            <TabsTrigger value="pending"><Clock className="mr-2 h-4 w-4" /> Pending ({pendingTasks.length})</TabsTrigger>
            <TabsTrigger value="completed"><Check className="mr-2 h-4 w-4" /> Completed ({completedTasks.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">{renderTable(pendingTasks, 'pending')}</TabsContent>
          <TabsContent value="completed" className="mt-4">{renderTable(completedTasks, 'completed')}</TabsContent>
        </Tabs>
      </div>

      <ViewRequestDialog
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        requisition={selectedRequisition}
        projects={[]}
        departments={departments}
        onRequisitionUpdate={fetchTasks}
      />
    </>
  );
}
