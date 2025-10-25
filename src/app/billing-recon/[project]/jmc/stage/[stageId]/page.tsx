
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
  updateDoc,
  Timestamp,
  runTransaction,
  arrayUnion,
} from 'firebase/firestore';
import type { JmcEntry, WorkflowStep, ActionLog, BoqItem, Bill, ActionConfig } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import ViewJmcEntryDialog from '@/components/ViewJmcEntryDialog';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { UpdateCertifiedQtyDialog } from '@/components/UpdateCertifiedQtyDialog';

function formatINR(n: number | undefined) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n ?? 0);
  } catch {
    return `₹${(n ?? 0).toFixed(2)}`;
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
  if (value?.seconds) {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function humanDate(value: any) {
  const d = toDateSafe(value);
  if (!d) return '-';
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
    Verified: 'verified',
    Reject: 'rejected',
    Revert: 'reverted',
    Edit: 'saved',
    Save: 'saved',
  };
  return map[action] ?? `${action.toLowerCase()}ed`;
}

export default function StagePage() {
  const { project: projectSlug, stageId } = useParams() as { project: string; stageId: string };
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [tasks, setTasks] = useState<JmcEntry[]>([]);
  const [stage, setStage] = useState<WorkflowStep | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  const [selectedJmc, setSelectedJmc] = useState<JmcEntry | null>(null);

  // Dialog states
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isUpdateQtyOpen, setIsUpdateQtyOpen] = useState(false);

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);

  const handleUpdateQtyClick = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsUpdateQtyOpen(true);
  };

  const fetchTasks = useCallback(async () => {
    if (!user || !stageId) return;

    setIsLoading(true);
    try {
      const workflowRef = doc(db, 'workflows', 'jmc-workflow');
      const workflowSnap = await getDoc(workflowRef);
      if (workflowSnap.exists()) {
        const steps = (workflowSnap.data().steps || []) as WorkflowStep[];
        setWorkflow(steps);
        const currentStage = steps.find((s) => s.id === stageId);
        if (currentStage) {
          setStage(currentStage);
        } else {
          toast({
            title: 'Error',
            description: 'Workflow stage not found.',
            variant: 'destructive',
          });
          router.back();
          return;
        }
      }

      const qTasks = query(
        collection(db, 'projects', projectSlug, 'jmcEntries'),
        where('currentStepId', '==', stageId)
      );

      const [tasksSnapshot, boqSnapshot, billsSnapshot] = await Promise.all([
        getDocs(qTasks),
        getDocs(query(collection(db, 'projects', projectSlug, 'boqItems'))),
        getDocs(query(collection(db, 'projects', projectSlug, 'bills'))),
      ]);

      const tasksData = tasksSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as JmcEntry);
      setTasks(tasksData);

      setBoqItems(boqSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as BoqItem)));
      setBills(billsSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Bill)));
    } catch (error) {
      console.error('Error fetching tasks for stage:', error);
      toast({ title: 'Error', description: 'Failed to fetch tasks.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [stageId, user, projectSlug, toast, router]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!user || !stage) return { pendingTasks: [] as JmcEntry[], completedTasks: [] as JmcEntry[] };

    const myPending = tasks.filter(
      (t) => t.assignees?.includes(user.id) && t.status !== 'Completed' && t.status !== 'Rejected'
    );

    const myCompleted = tasks.filter(
      (t) =>
        !myPending.some((pt) => pt.id === t.id) &&
        (t.history ?? []).some((h) => h.stepName === stage.name && h.userId === user.id)
    );

    return { pendingTasks: myPending, completedTasks: myCompleted };
  }, [tasks, user, stage]);

  // Close all dialogs together
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setIsViewOpen(false);
      setIsVerifyOpen(false);
      setIsEditOpen(false);
      setIsUpdateQtyOpen(false);
      setSelectedJmc(null);
    }
  };

  const handleAction = async (
    taskId: string,
    action: string | ActionConfig,
    comment: string = '',
    updatedItems?: any[]
  ) => {
    if (!workflow || !user || !stage) return;
    const actionName = typeof action === 'string' ? action : action.name;
    setIsActionLoading(taskId);

    try {
      const taskRef = doc(db, 'projects', projectSlug, 'jmcEntries', taskId);
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
          const computedAssignees = await getAssigneeForStep(nextStep, preData as any);
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
      // For Edit/Save: we just keep same stage/currentStep; history is still logged.

      const newActionLog: ActionLog = {
        action: actionName,
        comment,
        userId: user.id,
        userName: user.name,
        timestamp: Timestamp.now(),
        stepName: stage.name,
      };

      await runTransaction(db, async (tx) => {
        const liveSnap = await tx.get(taskRef);
        if (!liveSnap.exists()) throw new Error('Task document not found!');
        const live = liveSnap.data() as JmcEntry;

        if (preData.currentStepId !== live.currentStepId) {
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
      setIsEditOpen(false);
    }
  };

  const handleViewDetails = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsViewOpen(true);
  };

  const handleVerifyClick = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsVerifyOpen(true);
  };

  const handleEditClick = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsEditOpen(true);
  };

  const renderTable = (data: JmcEntry[], type: 'pending' | 'completed') => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>JMC No.</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>WO No.</TableHead>
              <TableHead>Total Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
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

                return (
                  <TableRow
                    key={entry.id}
                    onClick={() => handleViewDetails(entry)}
                    className="cursor-pointer"
                  >
                    <TableCell>{entry.jmcNo ?? '-'}</TableCell>
                    <TableCell>{humanDate(entry.jmcDate)}</TableCell>
                    <TableCell>{entry.woNo ?? '-'}</TableCell>
                    <TableCell>{formatINR((entry as any).totalAmount)}</TableCell>
                    <TableCell>
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
                            {/* Always allow Edit here */}
                            {type === 'pending' && (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleEditClick(entry);
                                }}
                              >
                                Edit
                              </DropdownMenuItem>
                            )}

                            {/* Show Verify only if workflow allows or if you want it always at this stage */}
                            {type === 'pending' &&
                              (actions.length === 0 || actions.some(a => (typeof a === 'string' ? a : a.name) === 'Verify')) && (
                                <DropdownMenuItem
                                  onSelect={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleVerifyClick(entry);
                                  }}
                                >
                                  Verify
                                </DropdownMenuItem>
                              )}

                            {/* Render remaining configured actions except Edit/Verify (handled above) */}
                            {type === 'pending' &&
                              actions
                                .filter(a => {
                                  const name = typeof a === 'string' ? a : a.name;
                                  return name !== 'Verify' && name !== 'Edit';
                                })
                                .map(a => {
                                  const name = typeof a === 'string' ? a : a.name;
                                  return (
                                    <DropdownMenuItem
                                      key={name}
                                      onSelect={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleAction(entry.id, a);
                                      }}
                                    >
                                      {name}
                                    </DropdownMenuItem>
                                  );
                                })}

                            {type === 'completed' && (
                              <DropdownMenuItem onSelect={() => handleViewDetails(entry)}>
                                <Eye className="mr-2 h-4 w-4" /> View Only
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No {type} tasks found in this stage.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/billing-recon/${projectSlug}/jmc`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">{stage?.name ?? 'JMC Stage'}</h1>
        </div>
      </div>

      <Tabs defaultValue="pending-tasks">
        <TabsList>
          <TabsTrigger value="pending-tasks">Pending Tasks ({pendingTasks.length})</TabsTrigger>
          <TabsTrigger value="completed-tasks">Completed ({completedTasks.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending-tasks" className="mt-4">
          {renderTable(pendingTasks, 'pending')}
        </TabsContent>
        <TabsContent value="completed-tasks" className="mt-4">
          {renderTable(completedTasks, 'completed')}
        </TabsContent>
      </Tabs>
      
      <ViewJmcEntryDialog
        isOpen={isViewOpen}
        onOpenChange={handleDialogOpenChange}
        jmcEntry={selectedJmc}
        boqItems={boqItems}
        bills={bills}
        isEditMode={false}
      />
      <ViewJmcEntryDialog
        isOpen={isVerifyOpen}
        onOpenChange={handleDialogOpenChange}
        jmcEntry={selectedJmc}
        boqItems={boqItems}
        bills={bills}
        isEditMode={true}
        onVerify={handleAction}
        isLoading={!!isActionLoading}
      />
      <ViewJmcEntryDialog
        isOpen={isEditOpen}
        onOpenChange={handleDialogOpenChange}
        jmcEntry={selectedJmc}
        boqItems={boqItems}
        bills={bills}
        isEditMode={true}
        onVerify={handleAction}
        isLoading={!!isActionLoading}
      />
       <UpdateCertifiedQtyDialog
        isOpen={isUpdateQtyOpen}
        onOpenChange={handleDialogOpenChange}
        jmcEntry={selectedJmc!}
        projectSlug={projectSlug}
        onSaveSuccess={() => {
            handleDialogOpenChange(false);
            fetchTasks();
        }}
      />
    </div>
  );
}

