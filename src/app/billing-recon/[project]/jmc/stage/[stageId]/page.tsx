
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Clock, Loader2, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import type { JmcEntry, WorkflowStep, ActionLog, BoqItem, Bill, ActionConfig, Project } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import ViewJmcEntryDialog from '@/components/ViewJmcEntryDialog';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { UpdateCertifiedQtyDialog } from '@/components/UpdateCertifiedQtyDialog';

/* -------- helpers -------- */
function formatINR(n?: number) {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v);
  } catch {
    return `₹${v.toFixed(2)}`;
  }
}

function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(+d) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

function humanDate(value: any) {
  const d = toDateSafe(value);
  if (!d) return '-';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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

const isVerifyAction = (name: string) => name === 'Verify' || name === 'Verified';

function computeTotalAmount(entry: JmcEntry | undefined): number {
  if (!entry) return 0;
  const explicit = (entry as any).totalAmount;
  if (Number.isFinite(explicit)) return explicit as number;
  // Fallback: sum of items (executedQty * rate) or (certifiedQty * rate) if present
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
  const { project: projectSlug, stageId } = useParams() as { project: string; stageId: string };
  const { user } = useAuth();
  const userId = (user as any)?.id ?? (user as any)?.uid ?? '';
  const userName = (user as any)?.name ?? (user as any)?.displayName ?? 'User';

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

  const fetchTasks = useCallback(async () => {
    if (!userId || !stageId || !projectSlug) return;

    setIsLoading(true);
    try {
      // 1. workflow + stage
      const workflowRef = doc(db, 'workflows', 'jmc-workflow');
      const workflowSnap = await getDoc(workflowRef);
      if (!workflowSnap.exists()) {
        toast({ title: 'Error', description: 'Workflow not found.', variant: 'destructive' });
        router.back();
        return;
      }
      const steps = (workflowSnap.data().steps || []) as WorkflowStep[];
      setWorkflow(steps);
      const currentStage = steps.find((s) => s.id === stageId);
      if (!currentStage) {
        toast({ title: 'Error', description: 'Workflow stage not found.', variant: 'destructive' });
        router.back();
        return;
      }
      setStage(currentStage);

      // 2. Find project by slug
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const projectData = projectsSnapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as Project))
        .find(p => slugify(p.projectName) === projectSlug);

      if (!projectData) {
        throw new Error("Project not found");
      }
      const projectId = projectData.id;

      // 3) tasks + BOQ + bills for the correct project ID
      const [stageTasksSnap, boqSnap, billsSnap] = await Promise.all([
        getDocs(query(collection(db, 'projects', projectId, 'jmcEntries'), where('currentStepId', '==', stageId))),
        getDocs(query(collection(db, 'projects', projectId, 'boqItems'))),
        getDocs(query(collection(db, 'projects', projectId, 'bills'))),
      ]);

      setTasks(stageTasksSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry)));
      setBoqItems(boqSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as BoqItem)));
      setBills(billsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Bill)));
    } catch (error) {
      console.error('Error fetching tasks for stage:', error);
      toast({ title: 'Error', description: 'Failed to fetch tasks.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, stageId, toast, router, userId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!userId || !stage) return { pendingTasks: [] as JmcEntry[], completedTasks: [] as JmcEntry[] };

    const myPending = tasks.filter(
      (t) => (t.assignees ?? []).includes(userId) && t.status !== 'Completed' && t.status !== 'Rejected'
    );

    const myCompleted = tasks.filter(
      (t) =>
        !myPending.some((pt) => pt.id === t.id) &&
        (t.history ?? []).some((h) => h.stepName === stage.name && h.userId === userId)
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

  const handleAction = async (
    taskId: string,
    action: string | ActionConfig,
    comment: string = '',
    updatedItems?: any[]
  ) => {
    if (!workflow || !userId || !userName || !stage || !projectSlug) return;
    const actionName = typeof action === 'string' ? action : action.name;
    setIsActionLoading(taskId);

    try {
        const projectsQuery = query(collection(db, 'projects'));
        const projectsSnapshot = await getDocs(projectsQuery);
        const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
        const projectData = projectsSnapshot.docs
            .map(d => ({ id: d.id, ...d.data() } as Project))
            .find(p => slugify(p.projectName) === projectSlug);

        if (!projectData) throw new Error("Project not found");
        const projectId = projectData.id;

      const taskRef = doc(db, 'projects', projectId, 'jmcEntries', taskId);
      const preSnap = await getDoc(taskRef);
      if (!preSnap.exists()) throw new Error('Task document not found!');
      const preData = preSnap.data() as JmcEntry;

      let nextStep: WorkflowStep | undefined;
      let newStatus: JmcEntry['status'] = preData.status;
      let newStage = preData.stage;
      let newCurrentStepId: string | null = preData.currentStepId || null;
      let newAssignees: string[] = preData.assignees || [];
      let newDeadline: Timestamp | null = preData.deadline ?? null;

      const isCompletionAction = ['Approve', 'Complete', 'Verified', 'Verify'].includes(actionName);

      if (isCompletionAction) {
        const idx = workflow.findIndex((s) => s.id === stage.id);
        nextStep = workflow[idx + 1];

        if (nextStep) {
          const serializableData = {
            ...preData,
            createdAt: toDateSafe(preData.createdAt)?.toISOString() ?? new Date().toISOString(),
          };
          const computedAssignees = await getAssigneeForStep(nextStep, serializableData as any);
          if (!computedAssignees || computedAssignees.length === 0) {
            throw new Error(`Could not find assignee for step: ${nextStep.name}`);
          }
          const deadlineDate = await calculateDeadline(new Date(), nextStep.tat);
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
      }

      const newActionLog: ActionLog = {
        action: actionName,
        comment,
        userId,
        userName,
        timestamp: Timestamp.now(),
        stepName: stage.name,
      };

      await runTransaction(db, async (tx) => {
        const liveSnap = await tx.get(taskRef);
        if (!liveSnap.exists()) throw new Error('Task document not found!');
        const live = liveSnap.data() as JmcEntry;

        if ((preData.currentStepId ?? null) !== (live.currentStepId ?? null)) {
          throw new Error('Task changed while you were taking action. Please refresh.');
        }

        const updateData: any = {
          status: newStatus,
          stage: newStage,
          currentStepId: newCurrentStepId,
          assignees: newAssignees,
          deadline: newDeadline,
          history: arrayUnion(newActionLog),
          version: (live as any).version ? (live as any).version + 1 : 1,
        };

        if (updatedItems) {
          updateData.items = updatedItems;
        }

        tx.update(taskRef, updateData);
      });

      toast({ title: 'Success', description: `Task has been ${pastTense(actionName)}.` });
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
    }
  };

  const renderTable = (data: JmcEntry[], type: 'pending' | 'completed') => (
    <Card>
      {/* Make the table horizontally scrollable so columns never overflow */}
      <CardContent className="p-0 overflow-x-auto">
        {/* Give the table a sensible minimum width so columns don’t squish */}
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">JMC No.</TableHead>
              <TableHead className="whitespace-nowrap">Date</TableHead>
              <TableHead className="whitespace-nowrap">WO No.</TableHead>
              <TableHead className="text-right whitespace-nowrap">Total Amount</TableHead>
              <TableHead className="whitespace-nowrap">Status</TableHead>
              <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8" />
                  </TableCell>
                </TableRow>
              ))
            ) : data.length > 0 ? (
              data.map((entry) => {
                const currentStep = workflow?.find((s) => s.id === entry.currentStepId);
                const actions = (currentStep?.actions ?? []) as (string | ActionConfig)[];
                const total = computeTotalAmount(entry);

                return (
                  <TableRow
                    key={entry.id}
                    onClick={() => handleViewDetails(entry)}
                    className="cursor-pointer"
                  >
                    <TableCell className="whitespace-nowrap">{entry.jmcNo ?? '-'}</TableCell>
                    <TableCell className="whitespace-nowrap">{humanDate(entry.jmcDate)}</TableCell>
                    <TableCell className="whitespace-nowrap">{entry.woNo ?? '-'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatINR(total)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={entry.status === 'Completed' ? 'default' : 'secondary'}>
                        {entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {isActionLoading === entry.id ? (
                        <Loader2 className="h-4 w-4 animate-spin ml-auto" />
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
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            {type === 'pending' &&
                              actions.map((action) => {
                                const actionName = typeof action === 'string' ? action : action.name;
                                const wantsVerify = isVerifyAction(actionName);
                                const isUpdateQty = actionName === 'Update Certified Qty';
                                return (
                                  <DropdownMenuItem
                                    key={actionName}
                                    onSelect={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (wantsVerify) {
                                        handleVerifyClick(entry);
                                      } else if (isUpdateQty) {
                                        handleUpdateQtyClick(entry);
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
                <TableCell colSpan={6} className="text-center h-24">
                  No {type} tasks found.
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
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/jmc`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">{stage?.name || 'JMC Stage'}</h1>
          </div>
        </div>
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
      </div>

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
