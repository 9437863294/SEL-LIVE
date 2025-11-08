
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Check, RefreshCw, Loader2, MoreHorizontal, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db, storage } from '@/lib/firebase';
import { collection, query, getDocs, doc, updateDoc, Timestamp, runTransaction, arrayUnion, where, getDoc } from 'firebase/firestore';
import type { InsuranceTask, WorkflowStep, ActionLog, User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { syncInsuranceTasks } from '../actions';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import ViewInsuranceTaskDialog from '@/components/ViewInsuranceTaskDialog';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuthorization } from '@/hooks/useAuthorization';


export default function MyTasksPage() {
    const { can, isLoading: authLoading } = useAuthorization();
    const { user, users: allUsers } = useAuth();
    const { toast } = useToast();
    const router = useRouter();

    const [allTasks, setAllTasks] = useState<InsuranceTask[]>([]);
    const [workflow, setWorkflow] = useState<WorkflowStep[] | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
    const [selectedTask, setSelectedTask] = useState<InsuranceTask | null>(null);
    const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
    
    const canViewPage = can('View', 'Insurance.My Tasks');

    const fetchData = useCallback(async () => {
      setIsLoading(true);
      try {
        const [workflowDoc, tasksSnapshot] = await Promise.all([
          getDoc(doc(db, 'workflows', 'insurance-workflow')),
          getDocs(collection(db, 'insuranceTasks')),
        ]);

        if (workflowDoc.exists()) {
          setWorkflow(workflowDoc.data().steps as WorkflowStep[]);
        }
        
        const tasksData = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceTask));
        setAllTasks(tasksData);
        
      } catch (error: any) {
        toast({ title: 'Error', description: error.message || 'Failed to fetch tasks or workflow.', variant: 'destructive' });
        console.error("Error fetching data:", error);
      } finally {
        setIsLoading(false);
      }
    }, [toast]);
    
    const handleSync = useCallback(async (showToast = false) => {
        if (!user) return;
        setIsSyncing(true);
        try {
            const result = await syncInsuranceTasks(user.id);
            if (result.success) {
                if (showToast) {
                    toast({ title: 'Sync Complete', description: result.message });
                }
                await fetchData(); // Fetch data after a successful sync
            } else {
                throw new Error(result.message);
            }
        } catch (e: any) {
             if (showToast) {
                toast({ title: 'Sync Failed', description: e.message.includes('permission-denied') ? "You don't have permission to perform this action." : e.message, variant: 'destructive' });
             }
             console.error("Sync error:", e);
        } finally {
            setIsSyncing(false);
        }
    }, [user, fetchData, toast]);

    useEffect(() => {
        if (authLoading) return;
        if (canViewPage) {
            handleSync(false); // Auto-sync on page load without showing toast
        } else {
            setIsLoading(false);
        }
    }, [canViewPage, authLoading, handleSync]);
    
    const { pendingTasks, completedTasks } = useMemo(() => {
        if (!user) return { pendingTasks: [], completedTasks: [] };
        
        const myPending = allTasks
          .filter(task => task.assignees?.includes(user.id) && ['Pending', 'In Progress', 'Needs Review'].includes(task.status))
          .sort((a, b) => a.dueDate.toMillis() - b.dueDate.toMillis());

        const myCompleted = allTasks
          .filter(task => ['Completed', 'Rejected'].includes(task.status))
          .sort((a,b) => b.createdAt.toMillis() - a.createdAt.toMillis());
          
        return { pendingTasks: myPending, completedTasks: myCompleted };
    }, [allTasks, user]);


    const handleAction = async (taskId: string, action: string, comment: string, file?: File) => {
        if (!workflow || !user) return;
        setIsActionLoading(taskId);
        
        try {
            const taskRef = doc(db, 'insuranceTasks', taskId);
            const taskDocInitial = await getDoc(taskRef);
             if (!taskDocInitial.exists()) {
                throw new Error("Task document not found!");
            }
            const currentTaskData = taskDocInitial.data() as InsuranceTask;
            const currentStep = workflow.find(s => s.id === currentTaskData.currentStepId);
            if (!currentStep) throw new Error("Current workflow step not found.");

            let attachmentData: { name: string; url: string } | undefined;
            if (file) {
                const storagePath = `insurance-actions/${taskId}/${currentStep.name}/${file.name}`;
                const storageRef = ref(storage, storagePath);
                await uploadBytes(storageRef, file);
                const downloadURL = await getDownloadURL(storageRef);
                attachmentData = { name: file.name, url: downloadURL };
            }

            await runTransaction(db, async (transaction) => {
                const taskDoc = await transaction.get(taskRef);
                if (!taskDoc.exists()) {
                    throw new Error("Task document not found!");
                }
                const latestTaskData = taskDoc.data() as InsuranceTask;

                const newActionLog: ActionLog = {
                    action,
                    comment: comment, 
                    userId: user.id,
                    userName: user.name,
                    timestamp: Timestamp.now(),
                    stepName: currentStep.name,
                    attachment: attachmentData,
                };
                
                let nextStep: WorkflowStep | undefined;
                let newStatus: InsuranceTask['status'] = latestTaskData.status;
                let newStage = latestTaskData.currentStage;
                let newCurrentStepId: string | null = latestTaskData.currentStepId || null;
                let newAssignees: string[] = [];
                let newDeadline: Timestamp | null = null;
    
                if (action === 'Approve' || action === 'Verified' || action === 'Update Approved Amount') {
                    const currentStepIndex = workflow.findIndex(s => s.id === currentStep.id);
                    nextStep = workflow[currentStepIndex + 1];
                    if (nextStep) {
                        newStage = nextStep.name;
                        newStatus = 'In Progress';
                        newCurrentStepId = nextStep.id;
                        const tempRequisitionDataForAssignment = {
                            projectId: (latestTaskData as any).projectId || '',
                            departmentId: '',
                            amount: (latestTaskData as any).premium || 0,
                        };
                        const assignees = await getAssigneeForStep(nextStep, tempRequisitionDataForAssignment);
                        if (assignees.length === 0) throw new Error(`Could not find assignee for step: ${nextStep.name}`);
                        newAssignees = assignees;
                        const deadline = await calculateDeadline(new Date(), nextStep.tat);
                        newDeadline = Timestamp.fromDate(deadline);
                    } else {
                        newStage = 'Completed';
                        newStatus = 'Completed';
                        newCurrentStepId = null;
                    }
                } else if (action === 'Reject') {
                    newStage = 'Rejected';
                    newStatus = 'Rejected';
                    newCurrentStepId = null;
                    newAssignees = [];
                    newDeadline = null;
                } else {
                    newAssignees = latestTaskData.assignees || [];
                    newDeadline = latestTaskData.deadline;
                }
    
                const updateData = {
                    status: newStatus,
                    currentStage: newStage,
                    currentStepId: newCurrentStepId,
                    assignees: newAssignees,
                    deadline: newDeadline,
                    history: arrayUnion(newActionLog),
                };
                
                transaction.update(taskRef, updateData);
            });
            
            toast({ title: 'Success', description: `Task has been ${action.toLowerCase()}ed.` });
            fetchData();
            
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to perform action.', variant: 'destructive'});
        } finally {
            setIsActionLoading(null);
        }
    };


    const handleRowClick = (task: InsuranceTask) => {
        setSelectedTask(task);
        setIsViewDialogOpen(true);
    };


    const renderTable = (data: InsuranceTask[], isPending: boolean) => {
        if (isLoading) {
            return (
                <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
            );
        }
        
        return (
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Created At</TableHead>
                                <TableHead>Policy No.</TableHead>
                                <TableHead>Insured Person</TableHead>
                                <TableHead>Due Date</TableHead>
                                <TableHead>{isPending ? 'Current Stage' : 'Status'}</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.length > 0 ? (
                                data.map(task => {
                                    const currentStep = workflow?.find(s => s.id === task.currentStepId);
                                    const actions = currentStep?.actions || [];
                                    return (
                                        <TableRow key={task.id} className="cursor-pointer" onClick={() => handleRowClick(task)}>
                                            <TableCell>{format(task.createdAt.toDate(), 'dd MMM, yyyy HH:mm')}</TableCell>
                                            <TableCell>{task.policyNo}</TableCell>
                                            <TableCell>{task.insuredPerson}</TableCell>
                                            <TableCell>{format(task.dueDate.toDate(), 'dd MMM, yyyy')}</TableCell>
                                            <TableCell>{isPending ? task.currentStage : task.status}</TableCell>
                                            <TableCell className="text-right">
                                                 {isActionLoading === task.id ? <Loader2 className="h-4 w-4 animate-spin ml-auto" /> : (
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => e.stopPropagation()}>
                                                                <MoreHorizontal className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            {isPending && actions.length > 0 ? (
                                                                actions.map(action => (
                                                                    <DropdownMenuItem key={action} onSelect={(e) => { e.preventDefault(); handleAction(task.id, action, '')}}>
                                                                        {action}
                                                                    </DropdownMenuItem>
                                                                ))
                                                            ) : (
                                                                <DropdownMenuItem onSelect={() => handleRowClick(task)}>
                                                                    <Eye className="mr-2 h-4 w-4" /> View
                                                                </DropdownMenuItem>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={isPending ? 6 : 5} className="h-24 text-center">
                                        No {isPending ? 'pending' : 'completed'} tasks.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        );
    };
    
    if (authLoading) {
        return (
            <div className="w-full">
                <Skeleton className="h-10 w-64 mb-6" />
                <Skeleton className="h-96 w-full" />
            </div>
        );
    }
    
    if (!canViewPage) {
        return (
            <div className="w-full">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold">My Insurance Tasks</h1>
                    </div>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view this page.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
                </Card>
            </div>
        );
    }
    

    return (
        <>
            <div className="w-full">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold">My Insurance Tasks</h1>
                        <p className="text-sm text-muted-foreground">
                            A list of all insurance-related tasks.
                        </p>
                    </div>
                     <Button onClick={() => handleSync(true)} disabled={isSyncing}>
                        {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Sync Tasks
                    </Button>
                </div>
                
                <Tabs defaultValue="pending">
                     <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="pending">My Pending Tasks ({pendingTasks.length})</TabsTrigger>
                        <TabsTrigger value="completed">Completed / Rejected ({completedTasks.length})</TabsTrigger>
                    </TabsList>
                    <TabsContent value="pending" className="mt-4">
                        {renderTable(pendingTasks, true)}
                    </TabsContent>
                    <TabsContent value="completed" className="mt-4">
                        {renderTable(completedTasks, false)}
                    </TabsContent>
                </Tabs>
            </div>

            <ViewInsuranceTaskDialog
                isOpen={isViewDialogOpen}
                onOpenChange={setIsViewDialogOpen}
                task={selectedTask}
                workflow={workflow}
                onAction={handleAction}
                isActionLoading={!!isActionLoading}
            />
        </>
    );
}
