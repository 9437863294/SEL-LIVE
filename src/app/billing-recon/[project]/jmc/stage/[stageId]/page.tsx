

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Clock, Eye, Loader2, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db, storage } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, Timestamp, runTransaction, arrayUnion } from 'firebase/firestore';
import type { JmcEntry, WorkflowStep, ActionLog, BoqItem, Bill, ActionConfig } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import ViewJmcEntryDialog from '@/components/ViewJmcEntryDialog';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';


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
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);

  const fetchTasks = useCallback(async () => {
    if (!user || !stageId) return;

    setIsLoading(true);
    try {
      const workflowRef = doc(db, 'workflows', 'jmc-workflow');
      const workflowSnap = await getDoc(workflowRef);
      if (workflowSnap.exists()) {
        const steps = workflowSnap.data().steps as WorkflowStep[];
        setWorkflow(steps);
        const currentStage = steps.find(s => s.id === stageId);
        if (currentStage) {
          setStage(currentStage);
        } else {
          toast({ title: 'Error', description: 'Workflow stage not found.', variant: 'destructive' });
          router.back();
          return;
        }
      }

      const q = query(
        collection(db, 'projects', projectSlug, 'jmcEntries'),
        where('currentStepId', '==', stageId)
      );
      
      const [tasksSnapshot, boqSnapshot, billsSnapshot] = await Promise.all([
        getDocs(q),
        getDocs(query(collection(db, 'projects', projectSlug, 'boqItems'))),
        getDocs(query(collection(db, 'projects', projectSlug, 'bills'))),
      ]);
      
      const tasksData = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JmcEntry));
      setTasks(tasksData);

      setBoqItems(boqSnapshot.docs.map(d => ({id: d.id, ...d.data()} as BoqItem)));
      setBills(billsSnapshot.docs.map(d => ({id: d.id, ...d.data()} as Bill)));

    } catch (error) {
      console.error("Error fetching tasks for stage:", error);
      toast({ title: 'Error', description: 'Failed to fetch tasks.', variant: 'destructive' });
    }
    setIsLoading(false);
  }, [stageId, user, projectSlug, toast, router]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!user || !stage) return { pendingTasks: [], completedTasks: [] };
    const myPendingTasks = tasks.filter(task => 
      task.assignees?.includes(user.id) && 
      task.status !== 'Completed' && 
      task.status !== 'Rejected'
    );
    const myCompletedTasks = tasks.filter(task => {
        // It's not in my pending list AND...
        return !myPendingTasks.some(pt => pt.id === task.id) &&
               // ... I have an action in its history for this stage.
               task.history?.some(h => h.stepName === stage.name && h.userId === user.id);
    });
    return { pendingTasks: myPendingTasks, completedTasks: myCompletedTasks };
  }, [tasks, user, stage]);

  const handleAction = async (taskId: string, action: string | ActionConfig, comment: string = '', updatedItems?: any[]) => {
    if (!workflow || !user || !stage) return;
    const actionName = typeof action === 'string' ? action : action.name;
    setIsActionLoading(taskId);
    
    try {
        const taskRef = doc(db, 'projects', projectSlug, 'jmcEntries', taskId);

        await runTransaction(db, async (transaction) => {
            const taskDoc = await transaction.get(taskRef);
            if (!taskDoc.exists()) throw new Error("Task document not found!");
            
            const currentTaskData = taskDoc.data() as JmcEntry;

            const newActionLog: ActionLog = {
                action: actionName,
                comment,
                userId: user.id,
                userName: user.name,
                timestamp: Timestamp.now(),
                stepName: stage.name,
            };

            let nextStep: WorkflowStep | undefined;
            let newStatus: JmcEntry['status'] = currentTaskData.status;
            let newStage = currentTaskData.stage;
            let newCurrentStepId: string | null = currentTaskData.currentStepId || null;
            let newAssignees: string[] = [];
            let newDeadline: Timestamp | null = null;
            
            const isCompletionAction = ['Approve', 'Complete', 'Verified'].includes(actionName);

            if (isCompletionAction) {
                const currentStepIndex = workflow.findIndex(s => s.id === stage.id);
                nextStep = workflow[currentStepIndex + 1];

                if (nextStep) {
                    newStage = nextStep.name;
                    newStatus = 'In Progress';
                    newCurrentStepId = nextStep.id;
                    const assignees = await getAssigneeForStep(nextStep, currentTaskData as any);
                    if (assignees.length === 0) throw new Error(`Could not find assignee for step: ${nextStep.name}`);
                    newAssignees = assignees;
                    const deadlineDate = await calculateDeadline(new Date(), nextStep.tat);
                    newDeadline = Timestamp.fromDate(deadlineDate);
                } else {
                    newStage = 'Completed';
                    newStatus = 'Completed';
                    newCurrentStepId = null;
                }
            } else if (actionName === 'Reject') {
                newStage = 'Rejected';
                newStatus = 'Rejected';
                newCurrentStepId = null;
            } else {
                 newAssignees = currentTaskData.assignees || [];
                 newDeadline = currentTaskData.deadline;
            }

            const updateData: any = {
                status: newStatus,
                stage: newStage,
                currentStepId: newCurrentStepId,
                assignees: newAssignees,
                deadline: newDeadline,
                history: arrayUnion(newActionLog),
            };

            if (updatedItems) {
                updateData.items = updatedItems;
            }
            
            transaction.update(taskRef, updateData);
        });

        toast({ title: 'Success', description: `Task has been ${actionName.toLowerCase()}ed.` });
        fetchTasks();

    } catch (error: any) {
        toast({ title: 'Error', description: error.message || 'Failed to perform action.', variant: 'destructive' });
    } finally {
        setIsActionLoading(null);
        setIsVerifyOpen(false);
    }
  };


  const handleViewDetails = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsViewOpen(true);
  };
  
  const handleVerifyClick = (entry: JmcEntry) => {
      setSelectedJmc(entry);
      setIsVerifyOpen(true);
  }
  
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
                <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
              ))
            ) : data.length > 0 ? (
              data.map(entry => {
                  const currentStep = workflow?.find(s => s.id === entry.currentStepId);
                  const actions = currentStep?.actions || [];
                  return (
                    <TableRow key={entry.id} onClick={() => handleViewDetails(entry)} className="cursor-pointer">
                      <TableCell>{entry.jmcNo}</TableCell>
                      <TableCell>{format(new Date(entry.jmcDate), 'dd MMM, yyyy')}</TableCell>
                      <TableCell>{entry.woNo}</TableCell>
                      <TableCell>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((entry as any).totalAmount || 0)}</TableCell>
                      <TableCell><Badge variant={entry.status === 'Completed' ? 'default' : 'secondary'}>{entry.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {isActionLoading === entry.id ? <Loader2 className="h-4 w-4 animate-spin ml-auto" /> : (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {type === 'pending' && actions.map(action => {
                                        const actionName = typeof action === 'string' ? action : action.name;
                                        const isVerify = actionName === 'Verify';
                                        return (
                                            <DropdownMenuItem key={actionName} onSelect={(e) => { e.preventDefault(); if(isVerify) { handleVerifyClick(entry) } else { handleAction(entry.id, action); } }}>
                                                {actionName}
                                            </DropdownMenuItem>
                                        )
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  )
              })
            ) : (
              <TableRow><TableCell colSpan={6} className="text-center h-24">No {type} tasks found.</TableCell></TableRow>
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
        onOpenChange={isVerifyOpen ? setIsVerifyOpen : setIsViewOpen}
        jmcEntry={selectedJmc}
        boqItems={boqItems}
        bills={bills}
        isEditMode={isVerifyOpen}
        onVerify={handleAction}
        isLoading={isActionLoading === selectedJmc?.id}
      />
    </>
  );
}


