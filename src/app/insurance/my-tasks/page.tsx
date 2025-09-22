
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Check, RefreshCw, Loader2, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, onSnapshot, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import type { InsuranceTask, WorkflowStep } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { syncInsuranceTasks } from '../actions';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import ViewInsuranceTaskDialog from '@/components/ViewInsuranceTaskDialog';


export default function MyTasksPage() {
    const { can, isLoading: authLoading } = useAuthorization();
    const { user } = useAuth();
    const { toast } = useToast();
    const router = useRouter();

    const [tasks, setTasks] = useState<InsuranceTask[]>([]);
    const [workflow, setWorkflow] = useState<WorkflowStep[] | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
    const [selectedTask, setSelectedTask] = useState<InsuranceTask | null>(null);
    const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
    
    const canViewPage = can('View', 'Insurance.My Tasks');

    const fetchTasks = async () => {
        if (!user || !canViewPage) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        const tasksQuery = query(
            collection(db, 'insuranceTasks'),
            where('assignedTo', '==', user.id)
        );
        try {
            const querySnapshot = await getDocs(tasksQuery);
            const tasksData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceTask));
            tasksData.sort((a, b) => a.dueDate.toMillis() - b.dueDate.toMillis());
            setTasks(tasksData);
        } catch (error) {
            console.error("Error fetching tasks:", error);
            toast({ title: 'Error', description: 'Failed to fetch tasks.', variant: 'destructive' });
        }
        setIsLoading(false);
    };
    
    const fetchWorkflow = async () => {
        const workflowDoc = await getDoc(doc(db, 'workflows', 'insurance-workflow'));
        if(workflowDoc.exists()){
            setWorkflow(workflowDoc.data().steps as WorkflowStep[]);
        }
    }

    useEffect(() => {
        if (user && canViewPage) {
            fetchWorkflow();
            fetchTasks(); 

            const tasksQuery = query(
                collection(db, 'insuranceTasks'),
                where('assignedTo', '==', user.id)
            );
            
            const unsubscribe = onSnapshot(tasksQuery, (querySnapshot) => {
                const tasksData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceTask));
                tasksData.sort((a,b) => a.dueDate.toMillis() - b.dueDate.toMillis());
                setTasks(tasksData);
            }, (error) => {
                console.error("Error with real-time task listener:", error);
            });

            return () => unsubscribe();
        } else if (!authLoading) {
            setIsLoading(false);
        }
    }, [user, canViewPage, authLoading]);
    
    const handleAction = async (task: InsuranceTask, action: string) => {
        if (!workflow || !user) return;
        setIsActionLoading(task.id);
        
        try {
            const taskRef = doc(db, 'insuranceTasks', task.id);
            const currentStepIndex = workflow.findIndex(s => s.id === task.currentStepId);
            const currentStep = workflow[currentStepIndex];
            const nextStep = workflow[currentStepIndex + 1];

            let updateData: any = {};
            
            if (action === 'Approve' || action === 'Complete') {
                if (nextStep) {
                    const assignee = await getAssigneeForStep(nextStep, { projectId: (task as any).projectId || '', departmentId: '', amount: 0 });
                    if (!assignee) throw new Error(`Could not find assignee for step: ${nextStep.name}`);
                    const deadline = await calculateDeadline(new Date(), nextStep.tat);

                    updateData = {
                        status: 'In Progress',
                        currentStepId: nextStep.id,
                        currentStage: nextStep.name,
                        assignedTo: assignee,
                        deadline: Timestamp.fromDate(deadline),
                    };
                } else {
                    updateData = { status: 'Completed', currentStepId: null, currentStage: 'Completed', assignedTo: null, deadline: null };
                }
            } else if (action === 'Reject') {
                 updateData = { status: 'Rejected', currentStepId: null, currentStage: 'Rejected', assignedTo: null, deadline: null };
            }
            
            await updateDoc(taskRef, updateData);
            toast({ title: 'Success', description: `Task has been ${action.toLowerCase()}ed.` });
            
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

    const handleSync = async () => {
        if (!user) return;
        setIsSyncing(true);
        try {
            const result = await syncInsuranceTasks(user.id);
            if (result.success) {
                toast({ title: 'Sync Complete', description: result.message });
                fetchTasks();
            } else {
                throw new Error(result.message);
            }
        } catch (e: any) {
            toast({ title: 'Sync Failed', description: e.message.includes('permission-denied') ? "You don't have permission to perform this action." : e.message, variant: 'destructive' });
        } finally {
            setIsSyncing(false);
        }
    };

    if (authLoading || (isLoading && canViewPage)) {
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
                    <CardContent className="flex justify-center p-8">
                        <ShieldAlert className="h-16 w-16 text-destructive" />
                    </CardContent>
                </Card>
            </div>
        );
    }
    
    const pendingTasks = tasks.filter(t => t.status !== 'Completed' && t.status !== 'Rejected');
    const completedTasks = tasks.filter(t => t.status === 'Completed' || t.status === 'Rejected');
    
    const renderTable = (data: InsuranceTask[], isPending: boolean) => {
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
                                {isPending && <TableHead className="text-right">Action</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.length > 0 ? (
                                data.map(task => {
                                    const currentStep = workflow?.find(s => s.id === task.currentStepId);
                                    return (
                                        <TableRow key={task.id} className="cursor-pointer" onClick={() => handleRowClick(task)}>
                                            <TableCell>{format(task.createdAt.toDate(), 'dd MMM, yyyy HH:mm')}</TableCell>
                                            <TableCell>{task.policyNo}</TableCell>
                                            <TableCell>{task.insuredPerson}</TableCell>
                                            <TableCell>{format(task.dueDate.toDate(), 'dd MMM, yyyy')}</TableCell>
                                            <TableCell>{isPending ? task.currentStage : task.status}</TableCell>
                                            {isPending && (
                                                <TableCell className="text-right">
                                                    {isActionLoading === task.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                                                    ) : (
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button variant="outline" size="sm">
                                                                    Actions <MoreHorizontal className="ml-2 h-4 w-4" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent>
                                                                {currentStep?.actions.map(action => (
                                                                    <DropdownMenuItem key={action} onSelect={() => handleAction(task, action)}>
                                                                        {action}
                                                                    </DropdownMenuItem>
                                                                ))}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    )}
                                                </TableCell>
                                            )}
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

    return (
        <>
            <div className="w-full">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold">My Insurance Tasks</h1>
                        <p className="text-sm text-muted-foreground">
                            A list of all insurance-related tasks assigned to you.
                        </p>
                    </div>
                     <Button onClick={handleSync} disabled={isSyncing}>
                        {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Sync Tasks
                    </Button>
                </div>
                
                <Tabs defaultValue="pending">
                     <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="pending">Pending ({pendingTasks.length})</TabsTrigger>
                        <TabsTrigger value="completed">Completed ({completedTasks.length})</TabsTrigger>
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
            />
        </>
    );
}
