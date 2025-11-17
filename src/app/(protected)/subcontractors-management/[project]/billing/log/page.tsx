
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
  FileText,
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
  QuerySnapshot,
  DocumentSnapshot,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle as ShadDialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/components/auth/AuthProvider';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';


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

interface UnifiedBill {
  id: string;
  type: 'Regular' | 'Retention' | 'Proforma';
  date: string;
  sortDate: Date;
  billNo: string;
  netPayable: number;
  projectName?: string;
  projectId: string;
  subcontractorId: string;
  subcontractorName: string;
  workOrderNo: string;
  status?: 'Pending' | 'In Progress' | 'Completed' | 'Rejected';
  stage?: string;
  assignees?: string[];
  currentStepId?: string | null;
  history?: ActionLog[];
  retentionAmount?: number;
  totalDeductions?: number;
  isRetentionBill?: boolean;
}


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

  const [bills, setBills] = useState<Bill[]>([]);
  const [proformaBills, setProformaBills] = useState<ProformaBill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);

  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [selectedProforma, setSelectedProforma] = useState<ProformaBill | null>(null);
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
      woSnaps.forEach((snap) => {
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

      const billEntries: Bill[] = billsSnapshot.docs.map((doc: DocumentSnapshot) => ({ id: doc.id, ...doc.data() } as Bill));
      const proformaEntries: ProformaBill[] = proformaSnapshot.docs.map((doc: DocumentSnapshot) => ({ id: doc.id, ...doc.data() } as ProformaBill));
      
      setBills(billEntries);
      setProformaBills(proformaEntries);

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

  const { pendingTasks, completedTasks, holdTasks, allFilteredBills } = useMemo(() => {
    const displayBills: DisplayBill[] = bills.map(b => {
      const project = projects.find(p => p.id === b.projectId);
      return {
        ...b,
        type: b.isRetentionBill ? 'Retention' : 'Regular',
        date: b.billDate,
        sortDate: toDateSafe(b.createdAt) || toDateSafe(b.billDate) || new Date(0),
        projectName: project?.projectName,
        subcontractorName: b.subcontractorName || 'N/A',
      }
    });

    const displayProformas: DisplayBill[] = proformaBills.map(p => {
       const project = projects.find(proj => proj.id === p.projectId);
       return {
        ...p,
        type: 'Proforma',
        date: p.date,
        billNo: p.proformaNo,
        netPayable: p.payableAmount,
        sortDate: toDateSafe(p.createdAt) || toDateSafe(p.date) || new Date(0),
        projectName: project?.projectName,
        subcontractorName: p.subcontractorName || 'N/A',
       }
    });

    const combined: DisplayBill[] = [...displayBills, ...displayProformas].sort((a,b) => b.sortDate.getTime() - a.sortDate.getTime());

    const filterFn = (bill: DisplayBill) => {
        const projectMatch = filters.project === 'all' || slugify(bill.projectName) === filters.project;
        const subMatch = filters.subcontractor === 'all' || bill.subcontractorId === filters.subcontractor;
        const sortDate = bill.sortDate;
        if (!sortDate) return false;
        
        const yearMatch = filters.year === 'all' || getYear(sortDate).toString() === filters.year;
        const monthMatch = filters.month === 'all' || sortDate.getMonth().toString() === filters.month;
        const typeMatch = filters.type === 'all' || bill.type === filters.type;
        return projectMatch && subMatch && yearMatch && monthMatch && typeMatch;
    };
    
    const filtered = combined.filter(filterFn);
    
    const pending: DisplayBill[] = [];
    const completed: DisplayBill[] = [];
    const hold: DisplayBill[] = [];

    filtered.forEach(bill => {
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
    
    return {
        pendingTasks: pending,
        completedTasks: completed,
        holdTasks: hold,
        allFilteredBills: filtered,
    };
}, [bills, proformaBills, filters, user?.id, projects]);
  
  const filterOptions = useMemo(() => {
    const allItems = [...bills, ...proformaBills];
    const visibleProjects = projects.filter(p => allItems.some(b => b.projectId === p.id));
    const visibleSubs = subcontractors.filter(s => allItems.some(b => b.subcontractorId === s.id));
    const years = [...new Set(allItems.map(b => getYear(toDateSafe((b as Bill).billDate || (b as ProformaBill).date)!)?.toString()))].filter(Boolean).sort((a,b) => parseInt(b) - parseInt(a));
    const months = Array.from({length: 12}, (_, i) => ({ value: i.toString(), label: format(new Date(0, i), 'MMMM') }));

    return { projects: visibleProjects, workOrders, subcontractors: visibleSubs, years, months };
  }, [bills, proformaBills, projects, workOrders, subcontractors]);

  const handleViewDetails = (unifiedBill: UnifiedBill) => {
    if (unifiedBill.type === 'Proforma') {
      const original = proformaBills.find((p: ProformaBill) => p.id === unifiedBill.id);
      setSelectedProforma(original || null);
    } else {
      const original = bills.find((b: Bill) => b.id === unifiedBill.id);
      setSelectedBill(original || null);
    }
    setIsViewOpen(true);
  };
  
  const handleViewDeductionDetails = (e: React.MouseEvent, bill: UnifiedBill) => {
      e.stopPropagation();
      const original = bills.find((b: Bill) => b.id === bill.id);
      setSelectedBill(original || null);
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
          toast({ title: 'Success', description: `Bill has been deleted.`});
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
  
  const handleAction = async (taskId: string, action: string, comment: string = '') => {
    const currentBill = selectedBill || selectedProforma;
    if (!workflow || !user || !projectSlug || !currentBill) return;

    const collectionName = (currentBill as any).proformaNo ? 'proformaBills' : 'bills';
    
    setIsActionLoading(taskId);
    try {
        const docRef = doc(db, 'projects', currentBill.projectId, collectionName, taskId);

        await runTransaction(db, async (tx) => {
            const taskDoc = await tx.get(docRef);
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
            tx.update(docRef, updateData);
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
              <TableHead>Retention</TableHead>
              <TableHead>Deductions</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={projectSlug === 'all' ? 10 : 9}><Skeleton className="h-5" /></TableCell></TableRow>
              ))
            ) : data.length > 0 ? (
              data.map((bill) => {
                const retentionDisplay = bill.isRetentionBill
                    ? `+${formatCurrency(bill.netPayable)}`
                    : bill.type !== 'Proforma' ? formatCurrency(bill.retentionAmount || 0) : 'N/A';
                return (
                  <TableRow key={bill.id} onClick={() => handleViewDetails(bill)} className="cursor-pointer">
                    {projectSlug === 'all' && <TableCell>{bill.projectName}</TableCell>}
                    <TableCell>{bill.billNo}</TableCell>
                    <TableCell>{formatDateSafe(bill.date)}</TableCell>
                    <TableCell>
                      <Badge variant={bill.type === 'Regular' ? 'default' : (bill.type === 'Retention' ? 'secondary' : 'outline')}>{bill.type}</Badge>
                    </TableCell>
                    <TableCell>{bill.workOrderNo}</TableCell>
                    <TableCell>{formatCurrency(bill.netPayable)}</TableCell>
                    <TableCell className={bill.isRetentionBill ? "text-green-600" : ""}>{retentionDisplay}</TableCell>
                    <TableCell>
                        {bill.type !== 'Proforma' ? (
                          <Button variant="link" className="p-0 h-auto" onClick={(e) => handleViewDeductionDetails(e, bill)}>
                            {formatCurrency(bill.totalDeductions || 0)}
                          </Button>
                        ) : 'N/A'}
                    </TableCell>
                    <TableCell>{bill.stage}</TableCell>
                    <TableCell className="text-right">
                       <AlertDialog>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => handleViewDetails(bill)}>
                                    <Eye className="mr-2 h-4 w-4" /> View Details
                                </DropdownMenuItem>
                                {can('Edit Bill', 'Subcontractors Management.Billing') && (
                                <DropdownMenuItem onSelect={(e) => { e.stopPropagation(); router.push(`/subcontractors-management/${projectSlug}/billing/edit/${bill.id}`)}}>
                                    <Edit className="mr-2 h-4 w-4" /> Edit
                                </DropdownMenuItem>
                                )}
                                {canDeleteBill && (
                                <AlertDialogTrigger asChild>
                                    <DropdownMenuItem className="text-destructive" onSelect={(e) => e.stopPropagation()}>
                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </DropdownMenuItem>
                                </AlertDialogTrigger>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                This will permanently delete bill {bill.billNo}. This action cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteBill(bill)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow><TableCell colSpan={projectSlug === 'all' ? 10 : 9} className="text-center h-24">No bills found for this category.</TableCell></TableRow>
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
        
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all"><FileText className="mr-2 h-4 w-4"/>All Bills ({allFilteredBills.length})</TabsTrigger>
            <TabsTrigger value="pending"><Clock className="mr-2 h-4 w-4"/>Pending Tasks ({pendingTasks.length})</TabsTrigger>
            <TabsTrigger value="hold"><HistoryIcon className="mr-2 h-4 w-4"/>On Hold / Other Stages ({holdTasks.length})</TabsTrigger>
            <TabsTrigger value="completed"><Check className="mr-2 h-4 w-4"/>Completed / Rejected ({completedTasks.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-4">{renderTable(allFilteredBills)}</TabsContent>
          <TabsContent value="pending" className="mt-4">{renderTable(pendingTasks)}</TabsContent>
          <TabsContent value="hold" className="mt-4">{renderTable(holdTasks)}</TabsContent>
          <TabsContent value="completed" className="mt-4">{renderTable(completedTasks)}</TabsContent>
        </Tabs>
      </div>

      {isViewOpen && (selectedBill ? (
        <ViewBillDialog
          isOpen={isViewOpen}
          onOpenChange={setIsViewOpen}
          bill={selectedBill}
          workflow={workflow}
          onAction={handleAction}
          isActionLoading={isActionLoading === selectedBill.id}
        />
      ) : selectedProforma ? (
        <ViewProformaBillDialog
          isOpen={isViewOpen}
          onOpenChange={setIsViewOpen}
          bill={selectedProforma}
          workflow={workflow}
          onAction={handleAction}
          isActionLoading={isActionLoading === selectedProforma.id}
        />
      ) : null)}
      
      <Dialog open={isDeductionDetailsOpen} onOpenChange={setIsDeductionDetailsOpen}>
          <DialogContent>
              <DialogHeader>
                  <ShadDialogTitle>Advance Deductions for Bill {selectedBill?.billNo}</ShadDialogTitle>
              </DialogHeader>
              <Table>
                  <TableHeader>
                      <TableRow>
                          <TableHead>Proforma Bill No.</TableHead>
                          <TableHead className="text-right">Deducted Amount</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {selectedBill?.advanceDeductions?.map((deduction, index) => {
                          const proforma = proformaBills.find(p => p.id === deduction.reference);
                          return (
                            <TableRow key={index}>
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

    