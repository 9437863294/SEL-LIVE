
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import type { JmcEntry, WorkflowStep, ActionLog } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import ViewJmcEntryDialog from '@/components/ViewJmcEntryDialog';
import { Badge } from '@/components/ui/badge';

export default function StagePage() {
  const { project: projectSlug, stageId } = useParams() as { project: string; stageId: string };
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [tasks, setTasks] = useState<JmcEntry[]>([]);
  const [stage, setStage] = useState<WorkflowStep | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJmc, setSelectedJmc] = useState<JmcEntry | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);

  useEffect(() => {
    if (!user || !stageId) return;

    const fetchTasks = async () => {
      setIsLoading(true);
      try {
        const workflowRef = doc(db, 'workflows', 'jmc-workflow');
        const workflowSnap = await getDoc(workflowRef);
        if (workflowSnap.exists()) {
          const steps = workflowSnap.data().steps as WorkflowStep[];
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
        
        const tasksSnapshot = await getDocs(q);
        const tasksData = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JmcEntry));
        setTasks(tasksData);

      } catch (error) {
        console.error("Error fetching tasks for stage:", error);
        toast({ title: 'Error', description: 'Failed to fetch tasks.', variant: 'destructive' });
      }
      setIsLoading(false);
    };

    fetchTasks();
  }, [stageId, user, projectSlug, toast, router]);

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!user) return { pendingTasks: [], completedTasks: [] };
    const pending = tasks.filter(task => task.assignees?.includes(user.id));
    const completed = tasks.filter(task => 
      task.history?.some(h => h.stepName === stage?.name && h.userId === user.id)
    );
    return { pendingTasks: pending, completedTasks: completed };
  }, [tasks, user, stage]);

  const handleViewDetails = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsViewOpen(true);
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
                <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
              ))
            ) : data.length > 0 ? (
              data.map(entry => (
                <TableRow key={entry.id} onClick={() => handleViewDetails(entry)} className="cursor-pointer">
                  <TableCell>{entry.jmcNo}</TableCell>
                  <TableCell>{format(new Date(entry.jmcDate), 'dd MMM, yyyy')}</TableCell>
                  <TableCell>{entry.woNo}</TableCell>
                  <TableCell>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(entry.totalAmount || 0)}</TableCell>
                  <TableCell><Badge variant={entry.status === 'Completed' ? 'default' : 'secondary'}>{entry.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm">View</Button>
                  </TableCell>
                </TableRow>
              ))
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
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        jmcEntry={selectedJmc}
      />
    </>
  );
}
