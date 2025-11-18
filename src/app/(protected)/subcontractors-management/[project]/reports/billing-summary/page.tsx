
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ShieldAlert,
  Wallet,
  IndianRupee,
  BookCheck,
  TrendingDown,
  TrendingUp,
  Receipt,
  PiggyBank,
  Combine,
  FileText,
  BarChart3,
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
  doc,
  setDoc,
  getDoc,
  query,
  where,
  collectionGroup,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format, getYear } from 'date-fns';
import type { Bill, Project, ProformaBill, Subcontractor, WorkOrder, WorkflowStep, ActionLog } from '@/lib/types';
import { useParams, useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/components/auth/AuthProvider';
import { Progress } from '@/components/ui/progress';


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

interface SummaryStats {
    totalWorkOrderValue: number;
    totalBilled: number;
    balanceToBeBilled: number;
    totalRetentionDeducted: number;
    totalRetentionClaimed: number;
    retentionBalance: number;
    totalAdvance: number;
    totalAdvanceRecovered: number;
    netAdvance: number;
}

interface WorkOrderSummary {
    woNo: string;
    subcontractorName: string;
    woValue: number;
    totalBilled: number;
    advanceTaken: number;
    advanceDeducted: number;
    progress: number;
}

function stripId<T extends object>(obj: T & { id?: any }): Omit<T, 'id'> {
  const { id: _ignored, ...rest } = obj as any;
  return rest as Omit<T, 'id'>;
}

function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
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
  const { user } = useAuth();
  const projectSlug = params.project as string;
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [bills, setBills] = useState<Bill[]>([]);
  const [proformaBills, setProformaBills] = useState<ProformaBill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allWorkOrders, setAllWorkOrders] = useState<WorkOrder[]>([]);
  const [allSubcontractors, setAllSubcontractors] = useState<Subcontractor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [filters, setFilters] = useState({
    project: projectSlug === 'all' ? 'all' : projectSlug,
    subcontractor: 'all',
    year: 'all',
    month: 'all',
  });
  
  const canViewPage = can('View', 'Subcontractors Management.Reports.Billing Summary');

  const fetchBillingData = useCallback(async () => {
    setIsLoading(true);
    try {
        const [projectsSnap, subsSnap, woSnap, billsSnap, proformaSnap] = await Promise.all([
            getDocs(collection(db, 'projects')),
            getDocs(collectionGroup(db, 'subcontractors')),
            getDocs(collectionGroup(db, 'workOrders')),
            getDocs(collectionGroup(db, 'bills')),
            getDocs(collectionGroup(db, 'proformaBills')),
        ]);
        
        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setAllSubcontractors(subsSnap.docs.map(d => ({id: d.id, ...d.data()} as Subcontractor)));
        setAllWorkOrders(woSnap.docs.map(d => ({id: d.id, ...d.data()} as WorkOrder)));
        setBills(billsSnap.docs.map(d => ({id: d.id, ...d.data()} as Bill)));
        setProformaBills(proformaSnap.docs.map(d => ({id: d.id, ...d.data()} as ProformaBill)));
        
    } catch (error) {
        console.error('Error fetching bills: ', error);
        toast({ title: 'Error', description: 'Failed to load bill data.', variant: 'destructive' });
    }
    setIsLoading(false);
  }, [toast]);
  
  useEffect(() => {
    fetchBillingData();
  }, [fetchBillingData]);

  const handleFilterChange = (field: keyof typeof filters, value: string) => {
    setFilters(prev => {
        const next = { ...prev, [field]: value };
        if (field === 'project') {
            next.subcontractor = 'all'; // Reset sub when project changes
        }
        return next;
    });
  };

  const filteredProjects = useMemo(() => {
    if (filters.project === 'all') return projects;
    return projects.filter(p => slugify(p.projectName) === filters.project);
  }, [projects, filters.project]);

  const filterOptions = useMemo(() => {
    const visibleProjectIds = new Set(filteredProjects.map(p => p.id));
    
    const visibleWorkOrders = allWorkOrders.filter(wo => visibleProjectIds.has(wo.projectId));
    const visibleSubcontractorIds = new Set(visibleWorkOrders.map(wo => wo.subcontractorId));
    const visibleSubs = allSubcontractors.filter(s => visibleSubcontractorIds.has(s.id));

    const combinedBills = [...bills, ...proformaBills];
    const yearSet = new Set<string>();
    combinedBills.forEach((b) => {
      const d = toDateSafe('billDate' in b ? b.billDate : b.date);
      if (d) yearSet.add(getYear(d).toString());
    });
    const years = Array.from(yearSet).sort((a, b) => parseInt(b) - parseInt(a));
    const months = Array.from({ length: 12 }, (_, i) => ({ value: i.toString(), label: format(new Date(0, i), 'MMMM') }));

    return { projects, subcontractors: visibleSubs, years, months };
  }, [projects, allWorkOrders, allSubcontractors, bills, proformaBills, filteredProjects]);
  
  const filteredData = useMemo(() => {
    const visibleProjectIds = new Set(filteredProjects.map(p => p.id));

    const filterFn = (bill: Bill | ProformaBill) => {
        const projectMatch = filters.project === 'all' || visibleProjectIds.has(bill.projectId);
        const subMatch = filters.subcontractor === 'all' || bill.subcontractorId === filters.subcontractor;
        const sortDate = toDateSafe('billDate' in bill ? bill.billDate : bill.date);
        if (!sortDate) return false;
        
        const yearMatch = filters.year === 'all' || getYear(sortDate).toString() === filters.year;
        const monthMatch = filters.month === 'all' || sortDate.getMonth().toString() === filters.month;

        return projectMatch && subMatch && yearMatch && monthMatch;
    };
    
    const filteredBills = bills.filter(filterFn);
    const filteredProformas = proformaBills.filter(filterFn);
    
    const relevantWoIds = new Set([...filteredBills.map(b => b.workOrderId), ...filteredProformas.map(p => p.workOrderId)]);
    const filteredWorkOrders = allWorkOrders.filter(wo => relevantWoIds.has(wo.id));
    
    return { filteredBills, filteredProformas, filteredWorkOrders };
  }, [filters, bills, proformaBills, allWorkOrders, filteredProjects]);


  const summaryStats: SummaryStats = useMemo(() => {
    const { filteredBills, filteredProformas, filteredWorkOrders } = filteredData;

    const totalWorkOrderValue = filteredWorkOrders.reduce((sum, wo) => sum + (wo.totalAmount || 0), 0);
    const totalBilled = filteredBills.filter(b => !b.isRetentionBill).reduce((sum, bill) => sum + (bill.netPayable || 0), 0);
    const totalRetentionDeducted = filteredBills.filter(b => !b.isRetentionBill).reduce((sum, bill) => sum + (bill.retentionAmount || 0), 0);
    const totalRetentionClaimed = filteredBills.filter(b => b.isRetentionBill).reduce((sum, bill) => sum + (bill.netPayable || 0), 0);
    const retentionBalance = totalRetentionDeducted - totalRetentionClaimed;
    const totalAdvance = filteredProformas.reduce((sum, bill) => sum + (bill.payableAmount || 0), 0);
    const totalAdvanceRecovered = filteredBills.flatMap(b => b.advanceDeductions || []).reduce((sum, d) => sum + d.amount, 0);
    const netAdvance = totalAdvance - totalAdvanceRecovered;
    const balanceToBeBilled = totalWorkOrderValue - totalBilled;

    return { totalWorkOrderValue, totalBilled, balanceToBeBilled, totalRetentionDeducted, totalRetentionClaimed, retentionBalance, totalAdvance, totalAdvanceRecovered, netAdvance };
  }, [filteredData]);
  
   const workOrderSummary: WorkOrderSummary[] = useMemo(() => {
    const { filteredBills, filteredProformas, filteredWorkOrders } = filteredData;
    
    const woMap = new Map<string, WorkOrderSummary>();

    filteredWorkOrders.forEach(wo => {
      woMap.set(wo.id, {
        woNo: wo.workOrderNo,
        subcontractorName: wo.subcontractorName,
        woValue: wo.totalAmount,
        totalBilled: 0,
        advanceTaken: 0,
        advanceDeducted: 0,
        progress: 0,
      });
    });

    filteredBills.forEach(bill => {
      const summary = woMap.get(bill.workOrderId);
      if (summary) {
        if (!bill.isRetentionBill) {
            summary.totalBilled += bill.netPayable || 0;
        }
        (bill.advanceDeductions || []).forEach(deduction => {
          summary.advanceDeducted += deduction.amount;
        });
      }
    });

    filteredProformas.forEach(proforma => {
      const summary = woMap.get(proforma.workOrderId);
      if (summary) {
        summary.advanceTaken += proforma.payableAmount || 0;
      }
    });
    
    woMap.forEach(summary => {
        summary.progress = summary.woValue > 0 ? (summary.totalBilled / summary.woValue) * 100 : 0;
    });

    return Array.from(woMap.values()).filter(s => s.woValue > 0 || s.totalBilled > 0 || s.advanceTaken > 0);
  }, [filteredData]);

  const statsToDisplay = [
      { title: 'Total Work Order Value', value: formatCurrency(summaryStats.totalWorkOrderValue), icon: FileText },
      { title: 'Total Billed', value: formatCurrency(summaryStats.totalBilled), icon: Receipt },
      { title: 'Balance To Be Billed', value: formatCurrency(summaryStats.balanceToBeBilled), icon: Wallet },
      { title: 'Total Retention Deducted', value: formatCurrency(summaryStats.totalRetentionDeducted), icon: TrendingDown },
      { title: 'Total Retention Paid', value: formatCurrency(summaryStats.totalRetentionClaimed), icon: TrendingUp },
      { title: 'Retention Balance', value: formatCurrency(summaryStats.retentionBalance), icon: PiggyBank },
      { title: 'Total Advance', value: formatCurrency(summaryStats.totalAdvance), icon: TrendingUp },
      { title: 'Advance Recovered', value: formatCurrency(summaryStats.totalAdvanceRecovered), icon: TrendingDown },
      { title: 'Net Advance Balance', value: formatCurrency(summaryStats.netAdvance), icon: Wallet },
  ];
  
  if (isAuthLoading) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-24 w-full mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 xl:grid-cols-9 gap-4 mb-8">
                {Array.from({length: 9}).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
            <Skeleton className="h-96 w-full" />
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
                    <CardDescription>You do not have permission to view reports.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
    );
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
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
                            {filterOptions.years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
            {isLoading ? (
                Array.from({ length: 9 }).map((_, index) => (
                    <Card key={index}>
                        <CardHeader className="p-4 pb-2 min-h-[4.5rem]"><Skeleton className="h-4 w-3/4" /></CardHeader>
                        <CardContent className="p-4 pt-0"><Skeleton className="h-8 w-1/2" /></CardContent>
                    </Card>
                ))
            ) : (
                statsToDisplay.map((stat) => (
                  <Card key={stat.title} className="flex flex-col h-full">
                    <CardHeader className="flex flex-row items-start justify-between space-y-0 p-4 pb-2 min-h-[4.5rem]">
                      <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                      <stat.icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent className="p-4 pt-0 mt-auto">
                      <p className="text-2xl font-bold">{stat.value}</p>
                    </CardContent>
                  </Card>
                ))
            )}
        </div>
        
        <Card>
          <CardHeader><CardTitle>Work Order Wise Summary</CardTitle></CardHeader>
          <CardContent>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>WO No</TableHead>
                        <TableHead>Subcontractor</TableHead>
                        <TableHead>WO Value</TableHead>
                        <TableHead>Total Billed</TableHead>
                        <TableHead>Progress</TableHead>
                        <TableHead>Advance Taken</TableHead>
                        <TableHead>Advance Deducted</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                   {isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6" /></TableCell></TableRow>
                        ))
                   ) : workOrderSummary.length > 0 ? (
                       workOrderSummary.map(wo => (
                        <TableRow key={wo.woNo}>
                            <TableCell>{wo.woNo}</TableCell>
                            <TableCell>{wo.subcontractorName}</TableCell>
                            <TableCell>{formatCurrency(wo.woValue)}</TableCell>
                            <TableCell>{formatCurrency(wo.totalBilled)}</TableCell>
                             <TableCell>
                                <div className="flex items-center gap-2">
                                    <Progress value={wo.progress} className="w-24 h-2" />
                                    <span>{wo.progress.toFixed(1)}%</span>
                                </div>
                            </TableCell>
                            <TableCell>{formatCurrency(wo.advanceTaken)}</TableCell>
                            <TableCell>{formatCurrency(wo.advanceDeducted)}</TableCell>
                        </TableRow>
                       ))
                   ) : (
                        <TableRow>
                            <TableCell colSpan={7} className="text-center h-24">No data to display for the selected filters.</TableCell>
                        </TableRow>
                   )}
                </TableBody>
            </Table>
          </CardContent>
        </Card>

      </div>
    </>
  );
}

```