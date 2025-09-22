

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Check, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, onSnapshot, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import type { InsuranceTask } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { syncInsuranceTasks } from '../actions';

export default function MyTasksPage() {
    const { can, isLoading: authLoading } = useAuthorization();
    const { user } = useAuth();
    const { toast } = useToast();
    const router = useRouter();

    const [tasks, setTasks] = useState<InsuranceTask[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    
    const canViewPage = can('View', 'Insurance.My Tasks');

    const fetchTasks = () => {
        if (!user || !canViewPage) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        const tasksQuery = query(
            collection(db, 'insuranceTasks'),
            where('assignedTo', '==', user.id)
        );

        const unsubscribe = onSnapshot(tasksQuery, (querySnapshot) => {
            const tasksData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceTask));
            tasksData.sort((a,b) => a.dueDate.toMillis() - b.dueDate.toMillis());
            setTasks(tasksData);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching tasks:", error);
            toast({ title: 'Error', description: 'Failed to fetch tasks.', variant: 'destructive' });
            setIsLoading(false);
        });

        return unsubscribe;
    }
    
    useEffect(() => {
        const unsubscribe = fetchTasks();
        return () => unsubscribe && unsubscribe();
    }, [user, canViewPage, toast]);
    
    const handleMarkAsComplete = async (taskId: string) => {
        try {
            await updateDoc(doc(db, 'insuranceTasks', taskId), {
                status: 'Completed'
            });
            toast({ title: 'Success', description: 'Task marked as complete.' });
        } catch (error) {
             toast({ title: 'Error', description: 'Failed to update task status.', variant: 'destructive' });
        }
    }

    const handleRowClick = (policyId: string) => {
        router.push(`/insurance/personal/${policyId}`);
    };

    const handleSync = async () => {
        if (!user) return;
        setIsSyncing(true);
        try {
            const result = await syncInsuranceTasks(user.id);
            if (result.success) {
                toast({ title: 'Sync Complete', description: result.message });
            } else {
                throw new Error(result.message);
            }
        } catch (e: any) {
            toast({ title: 'Sync Failed', description: e.message, variant: 'destructive' });
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
    
    const pendingTasks = tasks.filter(t => t.status === 'Pending');
    const completedTasks = tasks.filter(t => t.status === 'Completed');

    return (
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
                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Policy No.</TableHead>
                                        <TableHead>Insured Person</TableHead>
                                        <TableHead>Due Date</TableHead>
                                        <TableHead>Task Type</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pendingTasks.length > 0 ? (
                                        pendingTasks.map(task => (
                                            <TableRow key={task.id} className="cursor-pointer" onClick={() => handleRowClick(task.policyId)}>
                                                <TableCell>{task.policyNo}</TableCell>
                                                <TableCell>{task.insuredPerson}</TableCell>
                                                <TableCell>{format(task.dueDate.toDate(), 'dd MMM, yyyy')}</TableCell>
                                                <TableCell>{task.taskType}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleMarkAsComplete(task.id); }}>
                                                        <Check className="mr-2 h-4 w-4"/> Mark Complete
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center">
                                                No pending tasks.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
                <TabsContent value="completed" className="mt-4">
                    <Card>
                        <CardContent className="p-0">
                             <Table>
                                <TableHeader>
                                     <TableRow>
                                        <TableHead>Policy No.</TableHead>
                                        <TableHead>Insured Person</TableHead>
                                        <TableHead>Due Date</TableHead>
                                        <TableHead>Task Type</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                   {completedTasks.length > 0 ? (
                                        completedTasks.map(task => (
                                            <TableRow key={task.id} className="text-muted-foreground cursor-pointer" onClick={() => handleRowClick(task.policyId)}>
                                                <TableCell>{task.policyNo}</TableCell>
                                                <TableCell>{task.insuredPerson}</TableCell>
                                                <TableCell>{format(task.dueDate.toDate(), 'dd MMM, yyyy')}</TableCell>
                                                <TableCell>{task.taskType}</TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-24 text-center">
                                                No completed tasks yet.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
