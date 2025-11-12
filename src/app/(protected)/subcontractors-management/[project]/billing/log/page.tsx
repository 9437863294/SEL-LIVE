
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, View, Edit, Trash2, Check, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  collectionGroup,
  deleteDoc,
  doc,
  Timestamp,
  writeBatch,
  runTransaction,
  arrayUnion,
  getDoc,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format, getYear } from 'date-fns';
import type { Bill, Project, ProformaBill, Subcontractor, WorkOrder, WorkflowStep, ActionLog } from '@/lib/types';
import ViewBillDialog from '@/components/subcontractors-management/ViewBillDialog';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import ViewProformaBillDialog from '@/components/subcontractors-management/ViewProformaBillDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/components/auth/AuthProvider';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';

const slugify = (text: string) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

type UnifiedBill = (Omit<Bill, 'id'> | Omit<ProformaBill, 'id'>) & {
  id: string;
  type: 'Regular' | 'Retention' | 'Proforma';
  sortDate: Date;
  projectName?: string;
  projectId?: string;
  workOrderNo?: string;
  subcontractorName?: string;
  subcontractorId?: string;
  netPayable: number;
  retentionAmount?: number;
  advanceDeductions?: Bill['advanceDeductions'];
  status: string;
  stage: string;
  assignees: string[];
  currentStepId: string | null;
  history: ActionLog[];
};

function stripId<T extends object>(obj: T & { id?: any }): Omit<T, 'id'> {
  const { id: _ignored, ...rest } = obj as any;
  return rest as Omit<T, 'id'>;
}

function toDateSafe(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Timestamp) return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

const pastTense = (action: string) => action.endsWith('e') ? `${action}d` : `${action}ed`;

export default function BillLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const { can } = useAuthorization();
  const { user } = useAuth();
  const userId = user?.id || '';

  const [allBills, setAllBills] = useState<UnifiedBill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [proformaBills, setProformaBills] = useState<ProformaBill[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState<UnifiedBill | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  
  const canDeleteBill = can('Delete Bill', 'Subcontractors Management.Billing');

  const fetchBills = useCallback(async () => {
    setIsLoading(true);
    try {
      const projectsQuery = query(collection(db, 'projects'));
      const projectSnap = await getDocs(projectsQuery);
      const allProjects = projectSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      setProjects(allProjects);

      const workflowDoc = await getDoc(doc(db, 'workflows', 'billing-workflow'));
      if (workflowDoc.exists()) {
        setWorkflow(workflowDoc.data().steps as WorkflowStep[]);
      }

      const allSubcontractors: Subcontractor[] = [];
      const subsQueryPromises = allProjects.map(p => getDocs(collection(db, 'projects', p.id, 'subcontractors')));
      const subsSnaps = await Promise.all(subsQueryPromises);
      subsSnaps.forEach(snap => {
        allSubcontractors.push(...snap.docs.map(d => ({id: d.id, ...d.data()} as Subcontractor)));
      });
      setSubcontractors(allSubcontractors);

      const billsQuery = query(collectionGroup(db, 'bills'));
      const proformaQuery = query(collectionGroup(db, 'proformaBills'));
      
      const [billsSnapshot, proformaSnapshot] = await Promise.all([
        getDocs(billsQuery),
        getDocs(proformaQuery),
      ]);

      const billEntries: UnifiedBill[] = billsSnapshot.docs.map((doc) => {
        const data = doc.data() as Bill;
        const projectId = doc.ref.parent.parent?.id;
        const project = allProjects.find(p => p.id === projectId);
        return {
          ...(stripId(data as any)),
          id: doc.id,
          projectId: projectId,
          projectName: project?.projectName || 'Unknown',
          type: data.isRetentionBill ? 'Retention' : 'Regular',
          sortDate: toDateSafe(data.createdAt) || toDateSafe(data.billDate) || new Date(),
        } as UnifiedBill;
      });

      const proformaData = proformaSnapshot.docs.map((doc) => ({id: doc.id, ...stripId(doc.data() as any)} as ProformaBill));
      setProformaBills(proformaData);

      const proformaEntries: UnifiedBill[] = proformaData.map((data) => {
        const projectId = data.projectId;
        const project = allProjects.find(p => p.id === projectId);
        return {
          ...data,
          id: data.id,
          billNo: data.proformaNo,
          billDate: data.date,
          netPayable: data.payableAmount,
          projectName: project?.projectName || 'Unknown',
          type: 'Proforma',
          sortDate: toDateSafe(data.createdAt) || toDateSafe(data.date) || new Date(),
        } as UnifiedBill;
      });

      const combined = [...billEntries, ...proformaEntries];
      combined.sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime());
      setAllBills(combined);

    } catch (error) {
      console.error('Error fetching bills: ', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch bills for this project.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  }, [projectSlug, toast]);
  
  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!userId) return { pendingTasks: [], completedTasks: [] };
    
    const myPending = allBills.filter(t => t.assignees?.includes(userId) && t.status !== 'Completed' && t.status !== 'Rejected');
    const myCompleted = allBills.filter(t => !myPending.some(pt => pt.id === t.id) && t.history?.some(h => h.userId === userId));

    return { pendingTasks: myPending, completedTasks: myCompleted };
  }, [allBills, userId]);

  const handleAction = async (taskId: string, billType: 'bills' | 'proformaBills', action: string, comment: string = '') => {
    if (!workflow || !user) return;
    
    const currentTask = allBills.find(b => b.id === taskId);
    if (!currentTask || !currentTask.projectId) return;

    const currentStep = workflow.find(s => s.id === currentTask.currentStepId);
    if (!currentStep) return;

    try {
      const taskRef = doc(db, 'projects', currentTask.projectId, billType, taskId);
      await runTransaction(db, async (tx) => {
        const taskDoc = await tx.get(taskRef);
        if (!taskDoc.exists()) throw new Error('Task not found!');
        const taskData = taskDoc.data() as Bill | ProformaBill;

        const newActionLog: ActionLog = { action, comment, userId: user.id, userName: user.name, timestamp: Timestamp.now(), stepName: currentStep.name };
        
        let nextStep: WorkflowStep | undefined = workflow[workflow.findIndex(s => s.id === currentStep.id) + 1];
        let newStatus = 'In Progress';
        let newStage = nextStep?.name || 'Completed';
        let newCurrentStepId: string | null = nextStep?.id || null;
        let newAssignees: string[] = [];
        let newDeadline: Timestamp | null = null;
        
        if (action === 'Approve' || action === 'Verified') {
            if (nextStep) {
                const assignees = await getAssigneeForStep(nextStep, taskData as any);
                if (assignees.length === 0) throw new Error(`No assignee for step: ${nextStep.name}`);
                newAssignees = assignees;
                newDeadline = Timestamp.fromDate(await calculateDeadline(new Date(), nextStep.tat));
            } else {
                newStatus = 'Completed';
            }
        } else if (action === 'Reject') {
            newStage = 'Rejected';
            newStatus = 'Rejected';
            newCurrentStepId = null;
        } else {
           newAssignees = taskData.assignees || [];
           newDeadline = (taskData as any).deadline || null;
        }

        const updateData: any = {
            status: newStatus,
            stage: newStage,
            currentStepId: newCurrentStepId,
            assignees: newAssignees,
            deadline: newDeadline,
            history: arrayUnion(newActionLog),
        };
        tx.update(taskRef, updateData);
      });
      toast({ title: 'Success', description: `Task has been ${pastTense(action)}.` });
      fetchBills();
    } catch (error: any) {
      toast({ title: 'Action Failed', description: error.message, variant: 'destructive' });
    }
  };

  const handleViewDetails = (bill: UnifiedBill) => {
    setSelectedBill(bill);
    setIsViewOpen(true);
  };

  const renderTable = (data: UnifiedBill[]) => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Work Order No.</TableHead>
              <TableHead>Net Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
              ))
            ) : data.length > 0 ? (
              data.map((bill) => {
                const billDate = bill.type === 'Proforma' ? (bill as ProformaBill).date : (bill as Bill).billDate;
                return (
                <TableRow key={bill.id} onClick={() => handleViewDetails(bill)} className="cursor-pointer">
                  <TableCell className="font-medium">{bill.type === 'Proforma' ? (bill as ProformaBill).proformaNo : (bill as Bill).billNo}</TableCell>
                  <TableCell>{formatDateSafe(billDate)}</TableCell>
                  <TableCell><Badge variant={bill.type === 'Regular' ? 'default' : (bill.type === 'Retention' ? 'secondary' : 'outline')}>{bill.type}</Badge></TableCell>
                  <TableCell>{bill.workOrderNo}</TableCell>
                  <TableCell>{formatCurrency(bill.netPayable)}</TableCell>
                  <TableCell><Badge variant="secondary">{bill.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleViewDetails(bill); }}>
                      <View className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              )})
            ) : (
              <TableRow><TableCell colSpan={7} className="text-center h-24">No bills found.</TableCell></TableRow>
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
            <Link href={`/subcontractors-management/${projectSlug === 'all' ? '' : projectSlug}`}>
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <h1 className="text-2xl font-bold">Billing Log</h1>
          </div>
        </div>
        
        <Tabs defaultValue="pending">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pending"><Clock className="mr-2 h-4 w-4"/>Pending Tasks ({pendingTasks.length})</TabsTrigger>
            <TabsTrigger value="completed"><Check className="mr-2 h-4 w-4"/>Completed by Me ({completedTasks.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">{renderTable(pendingTasks)}</TabsContent>
          <TabsContent value="completed" className="mt-4">{renderTable(completedTasks)}</TabsContent>
        </Tabs>
      </div>

      {selectedBill && (selectedBill.type === 'Proforma' ? (
        <ViewProformaBillDialog
          isOpen={isViewOpen}
          onOpenChange={setIsViewOpen}
          bill={selectedBill as ProformaBill | null}
        />
      ) : (
        <ViewBillDialog
          isOpen={isViewOpen}
          onOpenChange={setIsViewOpen}
          bill={selectedBill as Bill | null}
          workflow={workflow}
          onAction={handleAction}
          isActionLoading={!!isActionLoading}
        />
      ))}
    </>
  );
}
