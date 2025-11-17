
'use client';

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ShieldAlert,
  Users,
  Wallet,
  IndianRupee,
  BookCheck,
  TrendingDown,
  TrendingUp,
  Receipt,
  PiggyBank,
  Combine,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { useParams, useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/components/auth/AuthProvider';


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

interface StepWiseReportData {
    [stepName: string]: {
        [userName: string]: {
            total: number;
            completed: number;
            rejected: number;
        }
    }
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
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
};


export default function BillingSummaryReport() {
  const { toast } = useToast();
  const params = useParams();
  const { user, users } = useAuth();
  const projectSlug = params.project as string;
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [bills, setBills] = useState<Bill[]>([]);
  const [proformaBills, setProformaBills] = useState<ProformaBill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [filters, setFilters] = useState({
    project: projectSlug === 'all' ? 'all' : projectSlug,
    subcontractor: 'all',
    year: 'all',
    month: 'all',
  });
  
  const canViewPage = can('View', 'Subcontractors Management.Reports.Billing Summary');

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
        description: 'Failed to load bill data.',
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

  const { filteredBills, filteredProformas } = useMemo(() => {
    const filterFn = (bill: Bill | ProformaBill) => {
        const projectMatch = filters.project === 'all' || slugify((projects.find(p=>p.id === bill.projectId))?.projectName || '') === filters.project;
        const subMatch = filters.subcontractor === 'all' || bill.subcontractorId === filters.subcontractor;
        const sortDate = toDateSafe((bill as Bill).billDate || (bill as ProformaBill).date);
        if (!sortDate) return false;
        
        const yearMatch = filters.year === 'all' || getYear(sortDate).toString() === filters.year;
        const monthMatch = filters.month === 'all' || sortDate.getMonth().toString() === filters.month;

        return projectMatch && subMatch && yearMatch && monthMatch;
    };
    
    return {
      filteredBills: bills.filter(filterFn),
      filteredProformas: proformaBills.filter(filterFn)
    };
}, [bills, proformaBills, filters, projects]);

  const summaryStats = useMemo(() => {
    const totalBilled = filteredBills.filter(b => !b.isRetentionBill).reduce((sum, bill) => sum + (bill.netPayable || 0), 0);
    const totalRetentionDeducted = filteredBills.filter(b => !b.isRetentionBill).reduce((sum, bill) => sum + (bill.retentionAmount || 0), 0);
    const totalRetentionClaimed = filteredBills.filter(b => b.isRetentionBill).reduce((sum, bill) => sum + (bill.netPayable || 0), 0);
    const retentionBalance = totalRetentionDeducted - totalRetentionClaimed;
    const totalAdvance = filteredProformas.reduce((sum, bill) => sum + (bill.payableAmount || 0), 0);
    const totalAdvanceRecovered = filteredBills.flatMap(b => b.advanceDeductions || []).reduce((sum, d) => sum + d.amount, 0);
    const netAdvance = totalAdvance - totalAdvanceRecovered;

    return { totalBilled, totalRetentionDeducted, totalRetentionClaimed, retentionBalance, totalAdvance, totalAdvanceRecovered, netAdvance };
  }, [filteredBills, filteredProformas]);

  const stepWiseReport = useMemo((): StepWiseReportData => {
    if (!workflow || !users.length) return {};
  
    const report: StepWiseReportData = {};
    const userMap = new Map(users.map(u => [u.id, u.name]));
    
    workflow.forEach(step => {
        report[step.name] = {};
    });
  
    const initializeUserInStep = (stepName: string, userName: string) => {
      if (!report[stepName]) report[stepName] = {};
      if (!report[stepName][userName]) {
        report[stepName][userName] = { total: 0, completed: 0, rejected: 0, onTime: 0 };
      }
    };
    
    const isCompletionAction = (action: string) => ['approve', 'complete', 'verified'].includes(action.toLowerCase());
  
    [...filteredBills, ...filteredProformas].forEach(bill => {
        const history: ActionLog[] = bill.history || [];
        
        history.forEach(log => {
          if (!log.stepName || !workflow.some(s => s.name === log.stepName)) return;

          const userName = log.userName || userMap.get(log.userId) || 'Unknown User';
          initializeUserInStep(log.stepName, userName);
          
          report[log.stepName][userName].total++;

          if (isCompletionAction(log.action)) {
              report[log.stepName][userName].completed++;
          }
          if (log.action === 'Reject') {
              report[log.stepName][userName].rejected++;
          }
        });
    });
  
    return report;
  }, [filteredBills, filteredProformas, workflow, users]);
  
  const filterOptions = useMemo(() => {
    const allItems = [...bills, ...proformaBills];
    const visibleProjects = projects.filter(p => allItems.some(b => b.projectId === p.id));
    const visibleSubs = subcontractors.filter(s => allItems.some(b => b.subcontractorId === s.id));
    const years = [...new Set(allItems.map(b => getYear(toDateSafe((b as Bill).billDate || (b as ProformaBill).date)!)?.toString()))].filter(Boolean).sort((a,b) => parseInt(b) - parseInt(a));
    const months = Array.from({length: 12}, (_, i) => ({ value: i.toString(), label: format(new Date(0, i), 'MMMM') }));

    return { projects: visibleProjects, subcontractors: visibleSubs, years, months };
  }, [bills, proformaBills, projects, subcontractors]);
  
   const statsToDisplay = [
      { title: 'Total Billed', value: formatCurrency(summaryStats.totalBilled), icon: Receipt },
      { title: 'Total Retention Deducted', value: formatCurrency(summaryStats.totalRetentionDeducted), icon: TrendingDown },
      { title: 'Total Retention Paid', value: formatCurrency(summaryStats.totalRetentionClaimed), icon: TrendingUp },
      { title: 'Retention Balance', value: formatCurrency(summaryStats.retentionBalance), icon: PiggyBank },
      { title: 'Total Advance', value: formatCurrency(summaryStats.totalAdvance), icon: TrendingUp },
      { title: 'Advance Recovered', value: formatCurrency(summaryStats.totalAdvanceRecovered), icon: TrendingDown },
      { title: 'Net Advance Balance', value: formatCurrency(summaryStats.netAdvance), icon: Wallet },
  ];
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-24 w-full mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-6 mb-8">
                {Array.from({length: 7}).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
            <Skeleton className="h-6 w-48 mb-6" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-48 w-full" />
            </div>
        </div>
    )
  }

  if(!canViewPage) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href={`/subcontractors-management/${projectSlug}/reports`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">Billing Summary</h1>
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
    )
  }


  return (
      <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}/reports`}>
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <h1 className="text-2xl font-bold">Billing Summary Report</h1>
          </div>
        </div>
        
        <Card className="mb-6">
            <CardHeader className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {projectSlug === 'all' && (
                        <Select value={filters.project} onValueChange={(v) => handleFilterChange('project', v)}>
                            <SelectTrigger><SelectValue placeholder="All Projects" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Projects</SelectItem>
                                {filterOptions.projects.map(p => <SelectItem key={p.id} value={slugify(p.projectName)}>{p.projectName}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                     <Select value={filters.subcontractor} onValueChange={(v) => handleFilterChange('subcontractor', v)}>
                        <SelectTrigger><SelectValue placeholder="All Subcontractors" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Subcontractors</SelectItem>
                            {filterOptions.subcontractors.map(s => <SelectItem key={s.id} value={s.id}>{s.legalName}</SelectItem>)}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
            {isLoading ? (
                Array.from({ length: 7 }).map((_, index) => (
                    <Card key={index} className="flex flex-col justify-between">
                        <CardHeader className="p-4 pb-2"><Skeleton className="h-4 w-3/4" /></CardHeader>
                        <CardContent className="p-4 pt-0"><Skeleton className="h-8 w-1/2" /></CardContent>
                    </Card>
                ))
            ) : (
                statsToDisplay.map((stat) => (
                  <Card key={stat.title} className="flex flex-col justify-between">
                    <CardHeader className="flex flex-row items-start justify-between space-y-0 p-4 pb-2">
                      <CardTitle className="text-sm font-medium min-h-[3em]">{stat.title}</CardTitle>
                      <stat.icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <p className="text-2xl font-bold">{stat.value}</p>
                    </CardContent>
                  </Card>
                ))
            )}
        </div>

        <div className="mb-6"><h2 className="text-xl font-bold">Step-wise Report</h2></div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {isLoading ? (
                Array.from({length: 3}).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)
            ) : (
                workflow.map((step) => {
                    const stepData = stepWiseReport[step.name];
                    if (!stepData || Object.keys(stepData).every(userName => stepData[userName].total === 0)) {
                        return null; 
                    }
                    return (
                        <Card key={step.id}>
                            <CardHeader className="p-4 bg-muted/50"><CardTitle className="text-base text-center">{step.name}</CardTitle></CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>User</TableHead>
                                            <TableHead>Total</TableHead>
                                            <TableHead>Done</TableHead>
                                            <TableHead>Rejected</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {Object.entries(stepData).map(([userName, data]) => {
                                            if (data.total === 0 && data.completed === 0) return null;
                                            return (
                                                <TableRow key={userName}>
                                                    <TableCell>{userName}</TableCell>
                                                    <TableCell>{data.total}</TableCell>
                                                    <TableCell>{data.completed}</TableCell>
                                                    <TableCell>{data.rejected}</TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )
                })
            )}
        </div>
      </div>
    </>
  );
}
