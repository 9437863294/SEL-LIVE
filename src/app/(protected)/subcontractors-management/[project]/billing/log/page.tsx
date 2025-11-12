
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  View,
  Edit,
  Trash2,
  Clock,
  Check,
  MoreHorizontal,
  Loader2,
  History as HistoryIcon,
} from 'lucide-react';
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
  runTransaction,
  arrayUnion,
  getDoc,
  DocumentSnapshot,
  QuerySnapshot,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format, getYear } from 'date-fns';
import type { Bill, Project, ProformaBill, Subcontractor, WorkOrder, WorkflowStep, ActionLog } from '@/lib/types';
import ViewBillDialog from '@/components/subcontractors-management/ViewBillDialog';
import { useParams, useRouter } from 'next/navigation';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle as DialogTitleShad, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/components/auth/AuthProvider';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';


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

type UnifiedBill = (Bill | ProformaBill) & {
  type: 'Regular' | 'Retention' | 'Proforma';
  sortDate: Date;
  projectName?: string;
  projectId: string;
  netPayable: number;
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

const formatDateSafe = (dateInput: any): string => {
    const d = toDateSafe(dateInput);
    if (!d) return 'N/A';
    try {
      return format(d, 'dd MMM, yyyy');
    } catch {
      return 'Invalid Date';
    }
};

const formatCurrency = (amount: number) => {
    if (isNaN(amount)) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
};


export default function BillLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const { user } = useAuth();
  const projectSlug = params.project as string;
  const { can } = useAuthorization();

  const [allBills, setAllBills] = useState<UnifiedBill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);

  const [selectedBill, setSelectedBill] = useState<UnifiedBill | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isDeductionDetailsOpen, setIsDeductionDetailsOpen] = useState(false);
  
  const [filters, setFilters] = useState({
    project: projectSlug === 'all' ? 'all' : projectSlug,
    workOrder: 'all',
    subcontractor: 'all',
    year: 'all',
    month: 'all',
    type: 'all',
  });

  const canDeleteBill = can('Delete Bill', 'Subcontractors Management.Billing');

  const fetchBills = useCallback(async () => {
    setIsLoading(true);
    try {
      const projectsQuery = query(collection(db, 'projects'));
      const projectSnap = await getDocs(projectsQuery);
      const allProjects = projectSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      setProjects(allProjects);

      const allSubcontractors: Subcontractor[] = [];
      const subsQueryPromises = allProjects.map(p => getDocs(collection(db, 'projects', p.id, 'subcontractors')));
      const subsSnaps = await Promise.all(subsQueryPromises);
      subsSnaps.forEach((snap: QuerySnapshot) => {
        allSubcontractors.push(...snap.docs.map(d => ({id: d.id, ...d.data()} as Subcontractor)));
      });
      setSubcontractors(allSubcontractors);

      const allWorkOrders: WorkOrder[] = [];
      const woQueryPromises = allProjects.map(p => getDocs(collection(db, 'projects', p.id, 'workOrders')));
      const woSnaps = await Promise.all(woQueryPromises);
      woSnaps.forEach((snap: QuerySnapshot) => {
        allWorkOrders.push(...snap.docs.map(d => ({id: d.id, ...d.data()} as WorkOrder)));
      });
      setWorkOrders(allWorkOrders);

      const billsQuery = query(collectionGroup(db, 'bills'));
      const proformaQuery = query(collectionGroup(db, 'proformaBills'));
      const workflowSnap = await getDoc(doc(db, 'workflows', 'billing-workflow'));
      
      const [billsSnapshot, proformaSnapshot, workflowDoc] = await Promise.all([
        getDocs(billsQuery),
        getDocs(proformaQuery),
        workflowSnap
      ]);

      if (workflowDoc.exists()) {
        setWorkflow(workflowDoc.data().steps as WorkflowStep[]);
      }

      const billEntries: UnifiedBill[] = billsSnapshot.docs.map((doc: DocumentSnapshot) => {
        const data = doc.data() as Bill;
        const projectId = doc.ref.parent.parent?.id || '';
        const project = allProjects.find(p => p.id === projectId);
        return {
          ...(stripId(data as any)),
          id: doc.id,
          projectId: projectId,
          projectName: project?.projectName || 'Unknown',
          type: data.isRetentionBill ? 'Retention' : 'Regular',
          sortDate: toDateSafe(data.createdAt) || toDateSafe(data.billDate) || new Date(),
          status: data.status,
          stage: data.stage,
          assignees: data.assignees,
          currentStepId: data.currentStepId,
          history: data.history,
          netPayable: data.netPayable,
        } as UnifiedBill;
      });
      
      const proformaEntries: UnifiedBill[] = proformaSnapshot.docs.map((doc: DocumentSnapshot) => {
        const data = doc.data() as ProformaBill;
        const projectId = doc.ref.parent.parent?.id || '';
        const project = allProjects.find(p => p.id === projectId);
        return {
          ...stripId(data),
          id: doc.id,
          billNo: data.proformaNo,
          billDate: data.date,
          netPayable: data.payableAmount,
          projectName: project?.projectName || 'Unknown',
          type: 'Proforma',
          sortDate: toDateSafe(data.createdAt) || toDateSafe(data.date) || new Date(),
          projectId: projectId,
          status: data.status || 'Pending',
          stage: data.stage || 'N/A',
          assignees: data.assignees || [],
          currentStepId: data.currentStepId || null,
          history: data.history || [],
        } as UnifiedBill;
      });

      const combined = [...billEntries, ...proformaEntries];
      combined.sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime());
      setAllBills(combined);

    } catch (error) {
      console.error('Error fetching bills: ', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch bills.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  }, [projectSlug, toast]);
  
  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  const handleFilterChange = (field: keyof typeof filters, value: string) => {
    setFilters(prev => ({...prev, [field]: value}));
  }

  const { pendingTasks, completedTasks, holdTasks } = useMemo(() => {
    const pending: UnifiedBill[] = [];
    const completed: UnifiedBill[] = [];
    const hold: UnifiedBill[] = [];

    allBills.forEach(bill => {
        const isAssigned = (bill.assignees ?? []).includes(user?.id || '');
        const status = bill.status;

        if (isAssigned && (status === 'Pending' || status === 'In Progress')) {
            pending.push(bill);
        } else if (status === 'Completed' || status === 'Rejected') {
            completed.push(bill);
        } else {
            hold.push(bill);
        }
    });

    const filterFn = (bill: UnifiedBill) => {
        const projectMatch = filters.project === 'all' || slugify(bill.projectName || '') === filters.project;
        const woMatch = filters.workOrder === 'all' || bill.workOrderNo === filters.workOrder;
        const subMatch = filters.subcontractor === 'all' || bill.subcontractorId === filters.subcontractor;
        const yearMatch = filters.year === 'all' || getYear(bill.sortDate).toString() === filters.year;
        const monthMatch = filters.month === 'all' || bill.sortDate.getMonth().toString() === filters.month;
        const typeMatch = filters.type === 'all' || bill.type === filters.type;
        return projectMatch && woMatch && subMatch && yearMatch && monthMatch && typeMatch;
    };
    
    return {
        pendingTasks: pending.filter(filterFn),
        completedTasks: completed.filter(filterFn),
        holdTasks: hold.filter(filterFn),
    };
}, [allBills, filters, user?.id]);
  
  const filterOptions = useMemo(() => {
    const visibleProjects = projects.filter(p => allBills.some(b => b.projectId === p.id));
    const visibleWOs = workOrders.filter(wo => allBills.some(b => b.workOrderNo === wo.workOrderNo));
    const visibleSubs = subcontractors.filter(s => allBills.some(b => b.subcontractorId === s.id));
    const years = [...new Set(allBills.map(b => getYear(b.sortDate).toString()))].sort((a,b) => parseInt(b) - parseInt(a));
    const months = Array.from({length: 12}, (_, i) => ({ value: i.toString(), label: format(new Date(0, i), 'MMMM') }));

    return { projects: visibleProjects, workOrders: visibleWOs, subcontractors: visibleSubs, years, months };
  }, [allBills, projects, workOrders, subcontractors]);

  const handleViewDetails = (bill: UnifiedBill) => {
    setSelectedBill(bill);
    setIsViewOpen(true);
  };
  
  const handleViewDeductionDetails = (e: React.MouseEvent, bill: UnifiedBill) => {
      e.stopPropagation();
      setSelectedBill(bill);
      setIsDeductionDetailsOpen(true);
  }
  
  const handleDeleteBill = async (billToDelete: UnifiedBill) => {
      const collectionName = billToDelete.type === 'Proforma' ? 'proformaBills' : 'bills';
      if (!billToDelete.projectId) {
          toast({ title: 'Error', description: 'Cannot delete bill without project information.', variant: 'destructive'});
          return;
      }
      try {
          await deleteDoc(doc(db, 'projects', billToDelete.projectId, collectionName, billToDelete.id));
          toast({ title: 'Success', description: `Bill ${billToDelete.type === 'Proforma' ? (billToDelete as any).proformaNo : (billToDelete as any).billNo} has been deleted.`});
          fetchBills();
      } catch (error) {
          console.error("Error deleting bill:", error);
          toast({ title: 'Error', description: 'Failed to delete the bill.', variant: 'destructive'});
      }
  }

  const pastTense = (action: string) => {
    const map: Record<string, string> = { Approve: 'approved', Verify: 'verified', Complete: 'completed', Reject: 'rejected' };
    return map[action] ?? `${action.toLowerCase()}ed`;
  };
  
  const handleAction = async (taskId: string, billType: 'proformaBills' | 'bills', action: string, comment: string = '') => {
    if (!workflow || !user || !projectSlug || !selectedBill) return;

    setIsActionLoading(taskId);
    try {
        const docRef = doc(db, 'projects', selectedBill.projectId, billType, taskId);

        await runTransaction(db, async (transaction) => {
            const taskDoc = await transaction.get(docRef);
            if (!taskDoc.exists()) throw new Error('Task document not found!');
            const currentTaskData = taskDoc.data() as Bill | ProformaBill;

            const currentStep = workflow.find(s => s.id === currentTaskData.currentStepId);
            if (!currentStep) throw new Error('Current workflow step not found!');

            const newActionLog: ActionLog = { action, comment, userId: user.id, userName: user.name, timestamp: Timestamp.now(), stepName: currentStep.name };
            
            const nextStep = workflow[workflow.findIndex(s => s.id === currentStep.id) + 1];
            let newStatus: Bill['status'] = 'In Progress';
            let newStage = nextStep?.name || 'Completed';
            let newCurrentStepId: string | null = nextStep?.id || null;
            let newAssignees: string[] = [];
            let newDeadline: Timestamp | null = null;
            
            if (action === 'Approve' || action === 'Verified') {
                if (nextStep) {
                    const assignees = await getAssigneeForStep(nextStep, currentTaskData as any);
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
            }

            const updateData: any = {
                status: newStatus,
                stage: newStage,
                currentStepId: newCurrentStepId,
                assignees: newAssignees,
                deadline: newDeadline,
                history: arrayUnion(newActionLog),
            };
            transaction.update(docRef, updateData);
        });

        toast({ title: 'Success', description: `Task has been ${pastTense(action)}.` });
        await fetchBills();
        setIsViewOpen(false);

    } catch (error: any) {
        toast({ title: 'Action Failed', description: error.message, variant: 'destructive' });
    } finally {
        setIsActionLoading(null);
    }
  };

  const renderTable = (data: UnifiedBill[]) => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {projectSlug === 'all' && <TableHead>Project</TableHead>}
              <TableHead>Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>WO No.</TableHead>
              <TableHead>Net Amt</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={projectSlug === 'all' ? 8 : 7}><Skeleton className="h-5" /></TableCell></TableRow>
              ))
            ) : data.length > 0 ? (
              data.map((bill) => {
                const billDate = bill.type === 'Proforma' ? bill.date : bill.billDate;
                return (
                  <TableRow key={bill.id} onClick={() => handleViewDetails(bill)} className="cursor-pointer">
                    {projectSlug === 'all' && <TableCell>{bill.projectName}</TableCell>}
                    <TableCell>{bill.type === 'Proforma' ? (bill as ProformaBill).proformaNo : (bill as Bill).billNo}</TableCell>
                    <TableCell>{formatDateSafe(billDate)}</TableCell>
                    <TableCell>
                      <Badge variant={bill.type === 'Regular' ? 'default' : (bill.type === 'Retention' ? 'secondary' : 'outline')}>{bill.type}</Badge>
                    </TableCell>
                    <TableCell>{bill.workOrderNo}</TableCell>
                    <TableCell>{formatCurrency(bill.netPayable)}</TableCell>
                    <TableCell>{bill.stage}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon"><View className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow><TableCell colSpan={projectSlug === 'all' ? 8 : 7} className="text-center h-24">No bills found for this category.</TableCell></TableRow>
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
        
        <Card className="mb-6">
            <CardHeader className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {projectSlug === 'all' && (
                        <Select value={filters.project} onValueChange={(v) => handleFilterChange('project', v)}>
                            <SelectTrigger><SelectValue placeholder="All Projects" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Projects</SelectItem>
                                {filterOptions.projects.map(p => <SelectItem key={p.id} value={slugify(p.projectName)}>{p.projectName}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                     <Select value={filters.workOrder} onValueChange={(v) => handleFilterChange('workOrder', v)}>
                        <SelectTrigger><SelectValue placeholder="All Work Orders" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Work Orders</SelectItem>
                            {filterOptions.workOrders.map(wo => <SelectItem key={wo.id} value={wo.workOrderNo}>{wo.workOrderNo}</SelectItem>)}
                        </SelectContent>
                    </Select>
                     <Select value={filters.subcontractor} onValueChange={(v) => handleFilterChange('subcontractor', v)}>
                        <SelectTrigger><SelectValue placeholder="All Subcontractors" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Subcontractors</SelectItem>
                            {filterOptions.subcontractors.map(s => <SelectItem key={s.id} value={s.id}>{s.legalName}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={filters.type} onValueChange={(v) => handleFilterChange('type', v)}>
                        <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Types</SelectItem>
                            <SelectItem value="Regular">Regular</SelectItem>
                            <SelectItem value="Retention">Retention</SelectItem>
                            <SelectItem value="Proforma">Proforma</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={filters.year} onValueChange={(v) => handleFilterChange('year', v)}>
                        <SelectTrigger><SelectValue placeholder="All Years" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Years</SelectItem>
                            {filterOptions.years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                        </SelectContent>
                    </Select>
                     <Select value={filters.month} onValueChange={(v) => handleFilterChange('month', v)}>
                        <SelectTrigger><SelectValue placeholder="All Months" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Months</SelectItem>
                            {filterOptions.months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            </CardHeader>
        </Card>
        
        <Tabs defaultValue="pending" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pending"><Clock className="mr-2 h-4 w-4"/>Pending Tasks ({pendingTasks.length})</TabsTrigger>
            <TabsTrigger value="hold"><HistoryIcon className="mr-2 h-4 w-4"/>On Hold / Other Stages ({holdTasks.length})</TabsTrigger>
            <TabsTrigger value="completed"><Check className="mr-2 h-4 w-4"/>Completed / Rejected ({completedTasks.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">{renderTable(pendingTasks)}</TabsContent>
          <TabsContent value="hold" className="mt-4">{renderTable(holdTasks)}</TabsContent>
          <TabsContent value="completed" className="mt-4">{renderTable(completedTasks)}</TabsContent>
        </Tabs>
      </div>

      {selectedBill && (selectedBill.type === 'Proforma' ? (
        <ViewProformaBillDialog
          isOpen={isViewOpen}
          onOpenChange={setIsViewOpen}
          bill={selectedBill as ProformaBill | null}
          workflow={workflow}
          onAction={(taskId, action, comment) => handleAction(taskId, 'proformaBills', action, comment)}
          isActionLoading={isActionLoading === selectedBill.id}
        />
      ) : (
        <ViewBillDialog
          isOpen={isViewOpen}
          onOpenChange={setIsViewOpen}
          bill={selectedBill as Bill | null}
          workflow={workflow}
          onAction={(taskId, action, comment) => handleAction(taskId, 'bills', action, comment)}
          isActionLoading={isActionLoading === selectedBill.id}
        />
      ))}
      
      <Dialog open={isDeductionDetailsOpen} onOpenChange={setIsDeductionDetailsOpen}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitleShad>Advance Deductions for Bill {(selectedBill as Bill)?.billNo}</DialogTitleShad>
              </DialogHeader>
              <Table>
                  <TableHeader>
                      <TableRow>
                          <TableHead>Proforma Bill No.</TableHead>
                          <TableHead className="text-right">Deducted Amount</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {(selectedBill as Bill)?.advanceDeductions?.map((deduction, index) => {
                          const proforma = proformaBills.find(p => p.id === deduction.reference);
                          return (
                            <TableRow key={deduction.id || index}>
                                <TableCell>{proforma?.proformaNo || deduction.reference}</TableCell>
                                <TableCell className="text-right">{formatCurrency(deduction.amount)}</TableCell>
                            </TableRow>
                          )
                      })}
                  </TableBody>
              </Table>
              <DialogFooter>
                  <DialogClose asChild>
                      <Button variant="outline">Close</Button>
                  </DialogClose>
              </DialogFooter>
          </DialogContent>
      </Dialog>
    </>
  );
}
