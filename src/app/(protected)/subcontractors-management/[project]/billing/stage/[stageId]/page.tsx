
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Clock, Loader2, MoreHorizontal, Eye, Edit } from 'lucide-react';
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
  collectionGroup,
} from 'firebase/firestore';
import type {
  Bill,
  WorkflowStep,
  ActionLog,
  Project,
  ProformaBill,
  ActionConfig,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import ViewBillDialog from '@/components/subcontractors-management/ViewBillDialog';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import ViewProformaBillDialog from '@/components/subcontractors-management/ViewProformaBillDialog';
import { Textarea } from '@/components/ui/textarea';


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
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pastTense(action: string) {
  const map: Record<string, string> = { Approve: 'approved', Verify: 'verified', Complete: 'completed', Reject: 'rejected' };
  return map[action] ?? `${action.toLowerCase()}ed`;
}

function formatINR(n?: number) {
    const v = Number.isFinite(n as number) ? (n as number) : 0;
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v);
    } catch {
      return `₹${v.toFixed(2)}`;
    }
}

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};


/* -------- component -------- */
export default function BillStagePage() {
  const { project: projectSlug, stageId } = useParams() as {
    project: string;
    stageId: string;
  };
  const { user } = useAuth();
  const userId = user?.id || '';
  const userName = user?.name || 'System';

  const { toast } = useToast();
  const router = useRouter();

  const [tasks, setTasks] = useState<Bill[]>([]);
  const [stage, setStage] = useState<WorkflowStep | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [proformaBills, setProformaBills] = useState<ProformaBill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null); // <-- cache once
  const [actionComment, setActionComment] = useState('');


  const fetchTasks = useCallback(async () => {
    if (!userId || !stageId || !projectSlug) return;

    setIsLoading(true);
    try {
      // 1) workflow + stage
      const workflowRef = doc(db, 'workflows', 'billing-workflow');
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

      // 2) project by slug (cache id)
      const projectsQueryRef = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQueryRef);
      const slugify = (text: string) =>
        text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const projectData = projectsSnapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as Project))
        .find((p) => slugify(p.projectName) === projectSlug);

      if (!projectData) throw new Error('Project not found');
      const pid = projectData.id;
      setProjectId(pid);

      // 3) stage tasks + BOQ + bills (for cached project id)
      const stageTasksQuery = query(
          collectionGroup(db, 'bills'), 
          where('currentStepId', '==', stageId)
      );

      const [stageTasksSnap, proformaSnap] = await Promise.all([
          getDocs(stageTasksQuery),
          getDocs(query(collection(db, 'projects', pid, 'proformaBills'))),
      ]);
      
      const projectTasks = stageTasksSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) } as Bill))
        .filter(task => task.projectId === pid);
      
      setTasks(projectTasks);
      setProformaBills(proformaSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ProformaBill)));

    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      router.back();
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, stageId, toast, router, userId]);
  
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!userId || !stage) return { pendingTasks: [], completedTasks: [] };
    const myPending = tasks.filter(t => (t.assignees ?? []).includes(userId) && t.status !== 'Completed' && t.status !== 'Rejected');
    const myCompleted = tasks.filter(t => !myPending.some(pt => pt.id === t.id) && (t.history ?? []).some(h => h.stepName === stage.name && h.userId === userId));
    return { pendingTasks: myPending, completedTasks: myCompleted };
  }, [tasks, userId, stage]);

  const handleAction = async (taskId: string, action: string | ActionConfig, comment: string = '') => {
    const currentBill = selectedBill;
    if (!workflow || !user || !userName || !stage || !projectSlug || !currentBill) return;

    const collectionName = (currentBill as any).proformaNo ? 'proformaBills' : 'bills';
    const projectId = currentBill.projectId;

    if(!projectId) {
       toast({ title: 'Action Failed', description: 'Could not determine project for this bill.', variant: 'destructive'});
       return;
    }

    setIsActionLoading(taskId);
    try {
      const docRef = doc(db, 'projects', projectId, collectionName, taskId);

      await runTransaction(db, async (tx) => {
        const taskDoc = await tx.get(docRef);
        if (!taskDoc.exists()) throw new Error('Task document not found!');
        const currentTaskData = taskDoc.data() as Bill | ProformaBill;
        
        const actionName = typeof action === 'string' ? action : action.name;
        const newActionLog: ActionLog = { action: actionName, comment, userId, userName, timestamp: Timestamp.now(), stepName: stage.name };
        
        const nextStep = workflow[workflow.findIndex(s => s.id === stage.id) + 1];
        let newStatus: Bill['status'] = 'In Progress';
        let newStage = nextStep?.name || 'Completed';
        let newCurrentStepId: string | null = nextStep?.id || null;
        let newAssignees: string[] = [];
        let newDeadline: Timestamp | null = null;
        
        if (action === 'Approve' || action === 'Verified') {
            if (nextStep) {
                const assignees = await getAssigneeForStep(nextStep, currentTaskData as any);
                if (assignees.length === 0) {
                  throw new Error(`No assignee for step: ${nextStep.name}`);
                }
                newAssignees = assignees;
                newDeadline = Timestamp.fromDate(
                  await calculateDeadline(new Date(), nextStep.tat),
                );
            } else {
                newStatus = 'Completed';
            }
        } else if (action === 'Reject') {
            newStage = 'Rejected';
            newStatus = 'Rejected';
            newCurrentStepId = null;
        }

        const updateData: any = {
            status: newStatus,
            stage: newStage,
            currentStepId: newCurrentStepId,
            assignees: newAssignees,
            deadline: newDeadline,
            history: arrayUnion(newActionLog),
        };

        tx.update(docRef, updateData);
      });
      toast({ title: 'Success', description: `Task has been ${pastTense(typeof action === 'string' ? action : action.name)}.` });
      await fetchTasks();
      setIsViewOpen(false);
    } catch (error: any) {
      toast({
        title: 'Action Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsActionLoading(null);
    }
  };

  const renderTable = (data: Bill[], type: 'pending' | 'completed') => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill No.</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Subcontractor</TableHead>
              <TableHead>Net Amount</TableHead>
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
              data.map((task) => {
                const currentStep = workflow?.find((s) => s.id === task.currentStepId);
                const actions = Array.isArray(currentStep?.actions) ? (currentStep.actions) : [];
                return (
                  <TableRow key={task.id} onClick={() => { setSelectedBill(task); setIsViewOpen(true); }} className="cursor-pointer">
                    <TableCell>{task.billNo}</TableCell>
                    <TableCell>{humanDate(task.billDate)}</TableCell>
                    <TableCell>{task.subcontractorName}</TableCell>
                    <TableCell>{formatINR(task.netPayable)}</TableCell>
                    <TableCell><Badge>{task.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {isActionLoading === task.id ? <Loader2 className="h-4 w-4 animate-spin ml-auto" /> : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => e.stopPropagation()}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                             <DropdownMenuItem onSelect={() => { setSelectedBill(task); setIsViewOpen(true); }}>
                               <Eye className="mr-2 h-4 w-4" /> View Details
                             </DropdownMenuItem>
                             {type === 'pending' && actions.map((action) => {
                                const actionName = typeof action === 'string' ? action : action.name;
                                return (
                                 <DropdownMenuItem key={actionName} onSelect={(e) => { e.preventDefault(); handleAction(task.id, actionName) }}>
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
              <TableRow><TableCell colSpan={6} className="text-center h-24">No {type} tasks.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href={`/subcontractors-management/${projectSlug}/billing`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">{stage?.name || 'Billing Stage'}</h1>
        </div>
        <Tabs defaultValue="pending">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pending"><Clock className="mr-2 h-4 w-4" /> Pending ({pendingTasks.length})</TabsTrigger>
            <TabsTrigger value="completed"><Check className="mr-2 h-4 w-4" /> Completed ({completedTasks.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">{renderTable(pendingTasks, 'pending')}</TabsContent>
          <TabsContent value="completed" className="mt-4">{renderTable(completedTasks, 'completed')}</TabsContent>
        </Tabs>
      </div>

       <ViewBillDialog
          isOpen={isViewOpen}
          onOpenChange={setIsViewOpen}
          bill={selectedBill}
          workflow={workflow}
          onAction={handleAction}
          isActionLoading={!!isActionLoading}
       />
    </>
  );
}

    