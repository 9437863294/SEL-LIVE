
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Home, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import type { Requisition, Project, User, WorkflowStep, ActionLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { format, getYear } from 'date-fns';

interface SummaryStats {
    totalRequisitions: number;
    totalAmount: number;
    cancelled: number;
    approved: number;
    balance: number;
}

interface StepWiseReportData {
    [stepName: string]: {
        [userName: string]: {
            total: number;
            completed: number;
            onTime: number; 
            rejected: number;
        }
    }
}

export default function SiteFundSummaryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [summaryStats, setSummaryStats] = useState<SummaryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [allRequisitions, setAllRequisitions] = useState<Requisition[]>([]);
  const [filteredRequisitions, setFilteredRequisitions] = useState<Requisition[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [workflow, setWorkflow] = useState<{steps: WorkflowStep[]} | null>(null);

  const [filters, setFilters] = useState({
      year: 'all',
      month: 'all',
      project: 'all',
      applicant: 'all',
  });
  
  const canViewPage = can('View', 'Site Fund Requisition 2.Reports.Site Fund Summary');

  useEffect(() => {
    if (!isAuthLoading) {
      if(canViewPage) {
          fetchSummaryData();
      } else {
          setIsLoading(false);
      }
    }
  }, [isAuthLoading, canViewPage]);

  const fetchSummaryData = async () => {
      setIsLoading(true);
      try {
          const [reqsSnapshot, projectsSnapshot, usersSnapshot, workflowDoc] = await Promise.all([
              getDocs(collection(db, 'requisitions')),
              getDocs(collection(db, 'projects')),
              getDocs(collection(db, 'users')),
              getDoc(doc(db, 'workflows', 'site-fund-requisition-2-workflow'))
          ]);
          
          const requisitionsData = reqsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Requisition));
          setAllRequisitions(requisitionsData);
          setFilteredRequisitions(requisitionsData);

          setProjects(projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
          setUsers(usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User)));
          
          if(workflowDoc.exists()) {
            setWorkflow(workflowDoc.data() as { steps: WorkflowStep[] });
          }

      } catch (error) {
          console.error("Error fetching summary data: ", error);
          // Handle error, e.g., show a toast notification
      }
      setIsLoading(false);
  };
  
   useEffect(() => {
        let items = allRequisitions;

        if (filters.year !== 'all') {
            items = items.filter(req => new Date(req.date).getFullYear().toString() === filters.year);
        }
        if (filters.month !== 'all') {
            items = items.filter(req => (new Date(req.date).getMonth() + 1).toString() === filters.month);
        }
        if (filters.project !== 'all') {
            items = items.filter(req => req.projectId === filters.project);
        }
        if (filters.applicant !== 'all') {
            items = items.filter(req => req.raisedById === filters.applicant);
        }
        
        setFilteredRequisitions(items);
    }, [filters, allRequisitions]);


  useEffect(() => {
        if (isLoading || allRequisitions.length === 0) {
           setSummaryStats({ totalRequisitions: 0, totalAmount: 0, cancelled: 0, approved: 0, balance: 0 });
           return;
        };

        const totalRequisitions = filteredRequisitions.length;
        const totalAmount = filteredRequisitions.reduce((sum, req) => sum + req.amount, 0);
        const cancelled = filteredRequisitions.filter(req => req.status === 'Rejected').length;
        const approved = filteredRequisitions
            .filter(req => req.status === 'Completed') // Changed from 'Approved'
            .reduce((sum, req) => sum + req.amount, 0);
        const balance = totalAmount - approved;
        
        setSummaryStats({ totalRequisitions, totalAmount, cancelled, approved, balance });
  }, [filteredRequisitions, isLoading, allRequisitions]);
  
  const stepWiseReport = useMemo((): StepWiseReportData => {
    if (!workflow || !users.length || !filteredRequisitions.length) {
        return {};
    }

    const report: StepWiseReportData = {};
    const userMap = new Map(users.map(u => [u.id, u.name]));
    const stepMap = new Map(workflow.steps.map(s => [s.name, s]));


    // Initialize report structure
    workflow.steps.forEach(step => {
        report[step.name] = {};
    });

    const initializeUserInStep = (stepName: string, userName: string) => {
        if (!report[stepName]) {
            report[stepName] = {};
        }
        if (!report[stepName][userName]) {
            report[stepName][userName] = { total: 0, completed: 0, onTime: 0, rejected: 0 };
        }
    };
    
    const isCompletionAction = (action: string) => ['approve', 'complete', 'verified', 'update approved amount'].includes(action.toLowerCase());

    filteredRequisitions.forEach(req => {
        const history: ActionLog[] = req.history || [];
        const processedStepsForTotal = new Set<string>();

        // Pass 1: Determine who was assigned what and when
        const stepAssignments: Record<string, { userId: string, timestamp: Date }> = {};
        let previousStepCompletionTime = req.createdAt.toDate();

        workflow.steps.forEach((step, index) => {
             const stepReached = history.some(h => h.stepName === step.name) || req.currentStepId === step.id;
             if (stepReached) {
                const assigneeId = req.history.find(h => h.stepName === step.name)?.userId || (req.assignees ? req.assignees[0] : undefined);
                if(assigneeId) {
                   stepAssignments[step.name] = { userId: assigneeId, timestamp: previousStepCompletionTime };
                   const completionLog = history.find(h => h.stepName === step.name && isCompletionAction(h.action));
                   if(completionLog) {
                       previousStepCompletionTime = completionLog.timestamp.toDate();
                   }
                }
             }
        });
        
         // Add current assignment if not completed
        if (req.currentStepId && req.status !== 'Completed' && req.status !== 'Rejected') {
            const currentStep = workflow.steps.find(s => s.id === req.currentStepId);
            if(currentStep && req.assignees && req.assignees.length > 0) {
                 stepAssignments[currentStep.name] = { userId: req.assignees[0], timestamp: previousStepCompletionTime };
            }
        }
        
        // Pass 2: Calculate stats based on assignments and history
        Object.keys(stepAssignments).forEach(stepName => {
            const { userId } = stepAssignments[stepName];
            const userName = userMap.get(userId) || 'Unknown User';
            
            initializeUserInStep(stepName, userName);
            
            // Increment total for the user assigned to this step
            if(!processedStepsForTotal.has(stepName)){
                report[stepName][userName].total++;
                processedStepsForTotal.add(stepName);
            }
            
            const completionLog = history.find(h => h.stepName === stepName && h.userId === userId && isCompletionAction(h.action));
            const rejectionLog = history.find(h => h.stepName === stepName && h.userId === userId && h.action.toLowerCase() === 'reject');

            if (completionLog) {
                report[stepName][userName].completed++;
                
                const stepConfig = stepMap.get(stepName);
                if (stepConfig) {
                    const stepStartTime = stepAssignments[stepName].timestamp;
                    const deadline = new Date(stepStartTime.getTime() + stepConfig.tat * 60 * 60 * 1000);
                    const completionTime = completionLog.timestamp.toDate();
                    
                    if(completionTime <= deadline) {
                        report[stepName][userName].onTime++;
                    }
                }
            }
            
            if (rejectionLog) {
                report[stepName][userName].rejected++;
                 // In some workflows, a rejection might also count as "completed" from the user's queue.
                if(!completionLog) {
                   report[stepName][userName].completed++;
                }
            }
        });
    });

    return report;
}, [filteredRequisitions, workflow, users]);


  const getFilterOptions = (key: 'year' | 'month' | 'project' | 'applicant') => {
      const unique = (arr: any[]) => [...new Set(arr)];
      switch (key) {
          case 'year':
              return unique(allRequisitions.map(r => new Date(r.date).getFullYear().toString())).sort((a,b) => Number(b) - Number(a));
          case 'month':
              return Array.from({ length: 12 }, (_, i) => ({ value: (i + 1).toString(), label: new Date(0, i).toLocaleString('default', { month: 'long' }) }));
          case 'project':
              return projects.filter(p => allRequisitions.some(r => r.projectId === p.id));
          case 'applicant':
              return users.filter(u => allRequisitions.some(r => r.raisedById === u.id));
          default:
              return [];
      }
  }

  const handleFilterChange = (filterName: string, value: string) => {
      setFilters(prev => ({ ...prev, [filterName]: value }));
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(amount);
  }

  const statsToDisplay = [
      { title: 'Total Requisitions', value: summaryStats?.totalRequisitions.toLocaleString() },
      { title: 'Total Amount', value: formatCurrency(summaryStats?.totalAmount || 0) },
      { title: 'Cancelled', value: summaryStats?.cancelled.toLocaleString() },
      { title: 'Balance', value: formatCurrency(summaryStats?.balance || 0) },
      { title: 'Approved', value: formatCurrency(summaryStats?.approved || 0) },
  ];
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-24 w-full mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 mb-8">
                {Array.from({length: 5}).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
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
        <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/site-fund-requisition-2/reports">
                      <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                      </Button>
                    </Link>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Site Fund Requisition 2</p>
                      <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Site Fund Summary</h1>
                    </div>
                </div>
            </div>
            <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
                <div className="h-1.5 w-full bg-gradient-to-r from-rose-400 via-amber-300 to-cyan-400 opacity-70" />
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
    <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/site-fund-requisition-2/reports">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Site Fund Requisition 2</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Site Fund Summary</h1>
            <p className="mt-1 text-sm text-slate-600">Totals, approvals, and step-wise performance.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="outline" className="bg-white/70 border-white/70">
              <Home className="mr-2 h-4 w-4" />
              Home
            </Button>
          </Link>
        </div>
      </div>

      <Card className="mb-6 overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70" />
        <CardContent className="p-4 flex flex-col md:flex-row items-center gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Year</p>
              <Select value={filters.year} onValueChange={(val) => handleFilterChange('year', val)}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue placeholder="All Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                   {getFilterOptions('year').map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Month</p>
              <Select value={filters.month} onValueChange={(val) => handleFilterChange('month', val)}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue placeholder="All Months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {getFilterOptions('month').map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Project</p>
              <Select value={filters.project} onValueChange={(val) => handleFilterChange('project', val)}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {getFilterOptions('project').map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Applicant</p>
              <Select value={filters.applicant} onValueChange={(val) => handleFilterChange('applicant', val)}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue placeholder="All Applicants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Applicants</SelectItem>
                  {getFilterOptions('applicant').map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 mb-8">
        {isLoading ? (
            Array.from({ length: 5 }).map((_, index) => (
                <Card key={index} className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 backdrop-blur">
                    <CardHeader className="p-4"><Skeleton className="h-4 w-3/4" /></CardHeader>
                    <CardContent className="p-4 pt-0"><Skeleton className="h-8 w-1/2" /></CardContent>
                </Card>
            ))
        ) : (
            statsToDisplay.map((stat, idx) => (
              <Card key={stat.title} className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_18px_60px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
                <div
                  className={
                    idx % 5 === 0
                      ? 'h-1.5 w-full bg-gradient-to-r from-cyan-400 to-sky-300 opacity-70'
                      : idx % 5 === 1
                      ? 'h-1.5 w-full bg-gradient-to-r from-fuchsia-400 to-rose-300 opacity-70'
                      : idx % 5 === 2
                      ? 'h-1.5 w-full bg-gradient-to-r from-amber-300 to-orange-300 opacity-70'
                      : idx % 5 === 3
                      ? 'h-1.5 w-full bg-gradient-to-r from-emerald-400 to-lime-300 opacity-70'
                      : 'h-1.5 w-full bg-gradient-to-r from-indigo-400 to-cyan-300 opacity-70'
                  }
                />
                <CardHeader className="p-4">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <p className="text-2xl font-bold">{stat.value}</p>
                </CardContent>
              </Card>
            ))
        )}
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-900">Step-wise Report</h2>
        <p className="mt-1 text-sm text-slate-600">Workload and outcomes by workflow step and user.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array.from({length: 3}).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)
        ) : (
          workflow?.steps.map((step) => {
              const stepData = stepWiseReport[step.name];
              if (!stepData || Object.keys(stepData).every(userName => stepData[userName].total === 0)) {
                return null; 
              }
              return (
              <Card key={step.name} className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_18px_60px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
                <div className="h-1.5 w-full bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-amber-200 opacity-70" />
                <CardHeader className="p-4">
                  <CardTitle className="text-base text-center text-slate-900">{step.name}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-white/80 border-y border-white/70">
                      <TableRow>
                        <TableHead className="text-slate-700">User</TableHead>
                        <TableHead className="text-slate-700">Total</TableHead>
                        <TableHead className="text-slate-700">Done</TableHead>
                        <TableHead className="text-slate-700">On Time</TableHead>
                        <TableHead className="text-slate-700">Rejected</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                     {Object.entries(stepData).map(([userName, data]) => {
                         if (data.total === 0 && data.completed === 0) return null;
                         return (
                             <TableRow key={userName} className="hover:bg-slate-50/70">
                                 <TableCell>{userName}</TableCell>
                                 <TableCell>{data.total}</TableCell>
                                 <TableCell>{data.completed}</TableCell>
                                 <TableCell>{data.onTime}</TableCell>
                                 <TableCell>{data.rejected}</TableCell>
                             </TableRow>
                         )
                     })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )})
        )}
      </div>
    </div>
  );
}
