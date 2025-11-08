
'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Home, Loader2, ShieldAlert, Users, CheckCircle, BarChart, Activity, XCircle } from 'lucide-react';
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
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import type { MvacEntry, Project, User, WorkflowStep, ActionLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

interface SummaryStats {
    totalMVACs: number;
    totalExecutedValue: number;
    totalCertifiedValue: number;
    rejected: number;
    completed: number;
}

interface StepWiseReportData {
    [stepName: string]: {
        [userName: string]: {
            total: number;
            completed: number;
            rejected: number;
        }
    }
}


export default function MvacSummaryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { project: projectSlug } = useParams() as { project: string };
  const [summaryStats, setSummaryStats] = useState<SummaryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [allTasks, setAllTasks] = useState<MvacEntry[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<MvacEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [workflow, setWorkflow] = useState<{steps: WorkflowStep[]} | null>(null);
  const { toast } = useToast();

  const [filters, setFilters] = useState({
      year: 'all',
      month: 'all',
      applicant: 'all',
  });
  
  const canViewPage = can('View Reports', 'Billing Recon.MVAC');

  const computeExecutedValue = (items: any[] = []) => {
    return items.reduce((sum, it) => {
        const rate = Number(it?.rate ?? 0);
        const qty = Number(it?.executedQty ?? 0);
        return sum + (rate * qty);
    }, 0);
  };
  
  const fetchSummaryData = useCallback(async () => {
      setIsLoading(true);
      try {
        const projectsQuery = query(collection(db, 'projects'));
        const projectsSnapshot = await getDocs(projectsQuery);
        
        const allProjects = projectsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Project));
        
        const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
        const currentProject = allProjects.find(p => slugify(p.projectName) === projectSlug);

        if (!currentProject) {
          console.error("Project not found for slug:", projectSlug);
          setIsLoading(false);
          return;
        }

        const currentProjectId = currentProject.id;
        
        const [tasksSnapshot, usersSnapshot, workflowDoc] = await Promise.all([
          getDocs(query(collection(db, 'projects', currentProjectId, 'mvacEntries'))),
          getDocs(collection(db, 'users')),
          getDoc(doc(db, 'workflows', 'mvac-workflow')),
        ]);
        
        const tasksData = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MvacEntry));
        setAllTasks(tasksData);
        setFilteredTasks(tasksData);

        setProjects(allProjects);
        setUsers(usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User)));
        
        if(workflowDoc.exists()) {
          setWorkflow(workflowDoc.data() as { steps: WorkflowStep[] });
        }

      } catch (error) {
          console.error("Error fetching summary data: ", error);
      }
      setIsLoading(false);
  }, [projectSlug]);
  
  useEffect(() => {
    if (!isAuthLoading) {
      if(canViewPage) {
          fetchSummaryData();
      } else {
          setIsLoading(false);
      }
    }
  }, [isAuthLoading, canViewPage, fetchSummaryData]);

    useEffect(() => {
        let items = allTasks;

        if (filters.year !== 'all') {
            items = items.filter(task => {
              const date = (task as any).mvacDate;
              return date && new Date(date).getFullYear().toString() === filters.year;
            });
        }
        if (filters.month !== 'all') {
            items = items.filter(task => {
              const date = (task as any).mvacDate;
              return date && (new Date(date).getMonth() + 1).toString() === filters.month;
            });
        }
        if (filters.applicant !== 'all') {
            const firstActorId = (task: MvacEntry) => (task.history && task.history.length > 0) ? task.history[0].userId : null;
            items = items.filter(task => firstActorId(task) === filters.applicant);
        }
        
        setFilteredTasks(items);
    }, [filters, allTasks]);


  useEffect(() => {
        if (isLoading || allTasks.length === 0) {
           setSummaryStats({ totalMVACs: 0, totalExecutedValue: 0, totalCertifiedValue: 0, rejected: 0, completed: 0 });
           return;
        };
        
        const totalMVACs = filteredTasks.length;
        const totalExecutedValue = filteredTasks.reduce((sum, task) => sum + computeExecutedValue(task.items), 0);
        const totalCertifiedValue = filteredTasks.reduce((sum, task) => sum + (task.items.reduce((itemSum, item) => itemSum + (item.certifiedQty || 0) * item.rate, 0) || 0), 0);
        const rejected = filteredTasks.filter(task => task.status === 'Rejected').length;
        const completed = filteredTasks.filter(req => req.status === 'Completed').length;
        
        setSummaryStats({ totalMVACs, totalExecutedValue, totalCertifiedValue, rejected, completed });
  }, [filteredTasks, isLoading, allTasks]);
  
  const stepWiseReport = useMemo((): StepWiseReportData => {
    if (!workflow || !users.length || !filteredTasks.length) {
      return {};
    }
  
    const report: StepWiseReportData = {};
    const userMap = new Map(users.map(u => [u.id, u.name]));
    
    // Manually add a "Created" step at the beginning
    const allSteps = [{ id: 'created', name: 'Created' }, ...workflow.steps];

    allSteps.forEach(step => {
        report[step.name] = {};
    });
  
    const initializeUserInStep = (stepName: string, userName: string) => {
      if (!report[stepName]) report[stepName] = {};
      if (!report[stepName][userName]) {
        report[stepName][userName] = { total: 0, completed: 0, rejected: 0, onTime: 0 };
      }
    };
    
    const isCompletionAction = (action: string) => ['approve', 'complete', 'verified'].includes(action.toLowerCase());
  
    filteredTasks.forEach(task => {
        const history: ActionLog[] = (task as any).history || [];
        
        // Handle "Created" stage
        const creationLog = history.find(h => h.action === 'Created');
        if (creationLog) {
            const creatorName = userMap.get(creationLog.userId) || 'Unknown User';
            initializeUserInStep('Created', creatorName);
            report['Created'][creatorName].total++;
            report['Created'][creatorName].completed++; // Creation is always a "completed" action for this stage
        }
        
        // Handle workflow stages
        const stepAssignments: { [stepName: string]: string } = {};

        workflow.steps.forEach((step, index) => {
            const stepLogs = history.filter(h => h.stepName === step.name);
            const assigneeLog = stepLogs.find(l => l.userId); // First user to act on this step is the assignee
            
            if (assigneeLog) {
                stepAssignments[step.name] = assigneeLog.userId;
            } else if (task.currentStepId === step.id && task.assignees?.length > 0) {
                 // If it's the current step, the assignee is known
                stepAssignments[step.name] = task.assignees[0];
            }
        });

        Object.entries(stepAssignments).forEach(([stepName, userId]) => {
            const userName = userMap.get(userId) || 'Unknown User';
            initializeUserInStep(stepName, userName);

            report[stepName][userName].total++;

            const completionLog = history.find(h => h.stepName === stepName && isCompletionAction(h.action));
            const rejectionLog = history.find(h => h.stepName === stepName && h.action.toLowerCase() === 'reject');

            if (completionLog) {
                report[stepName][userName].completed++;
            }
            if (rejectionLog) {
                report[stepName][userName].rejected++;
            }
        });
    });
  
    return report;
  }, [filteredTasks, workflow, users]);
  
  
  const getFilterOptions = (key: 'year' | 'month' | 'project' | 'applicant') => {
      const unique = (arr: any[]) => [...new Set(arr)];
      switch (key) {
          case 'year':
              const allYears = allTasks.map(r => (r as any).mvacDate ? new Date((r as any).mvacDate).getFullYear().toString() : null).filter(Boolean);
              return unique(allYears).sort((a,b) => Number(b) - Number(a));
          case 'month':
              return Array.from({ length: 12 }, (_, i) => ({ value: (i + 1).toString(), label: new Date(0, i).toLocaleString('default', { month: 'long' }) }));
          case 'project':
              const projectIdsInTasks = new Set(allTasks.map(t => t.projectId));
              return projects.filter(p => projectIdsInTasks.has(p.id));
          case 'applicant':
               const applicantIds = new Set(allTasks.map(r => (r.history && r.history.length > 0) ? r.history[0].userId : null).filter(Boolean));
              return users.filter(u => applicantIds.has(u.id));
          default:
              return [];
      }
  }

  const handleFilterChange = (filterName: string, value: string) => {
      setFilters(prev => ({ ...prev, [filterName]: value }));
  };

  const formatCurrency = (amount: number) => {
    if (isNaN(amount)) amount = 0;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(amount);
  }

  const statsToDisplay = [
      { title: 'Total MVACs', value: summaryStats?.totalMVACs.toLocaleString() || '0' },
      { title: 'MVAC Executed Value', value: formatCurrency(summaryStats?.totalExecutedValue || 0) },
      { title: 'Total Certified Value', value: formatCurrency(summaryStats?.totalCertifiedValue || 0) },
      { title: 'Completed', value: summaryStats?.completed.toLocaleString() || '0' },
      { title: 'Rejected', value: summaryStats?.rejected.toLocaleString() || '0' },
  ];
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full pr-14">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-24 w-full mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-6 mb-8">
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
        <div className="w-full pr-14">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href={`/billing-recon/${projectSlug}/mvac/reports`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">MVAC Summary</h1>
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
    <div className="w-full pr-14">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/billing-recon/${projectSlug}/mvac/reports`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">MVAC Summary</h1>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4 flex flex-col md:flex-row items-center gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full">
            <Select value={filters.year} onValueChange={(val) => handleFilterChange('year', val)}>
              <SelectTrigger><SelectValue placeholder="All Years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {(getFilterOptions('year') as string[]).map(year => (
                  <SelectItem key={year} value={year}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.month} onValueChange={(val) => handleFilterChange('month', val)}>
              <SelectTrigger><SelectValue placeholder="All Months" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {(getFilterOptions('month') as { value: string, label: string }[]).map(month => (
                  <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.applicant} onValueChange={(val) => handleFilterChange('applicant', val)}>
              <SelectTrigger><SelectValue placeholder="All Applicants" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Applicants</SelectItem>
                {(getFilterOptions('applicant') as User[]).map(user => (
                  <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 mb-8">
        {isLoading ? (
            Array.from({ length: 5 }).map((_, index) => (
                <Card key={index}>
                    <CardHeader className="p-4"><Skeleton className="h-4 w-3/4" /></CardHeader>
                    <CardContent className="p-4 pt-0"><Skeleton className="h-8 w-1/2" /></CardContent>
                </Card>
            ))
        ) : (
            statsToDisplay.map((stat) => (
              <Card key={stat.title}>
                <CardHeader className="p-4 flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <p className="text-2xl font-bold">{stat.value}</p>
                </CardContent>
              </Card>
            ))
        )}
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-bold">Step-wise Report</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array.from({length: 3}).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)
        ) : (
          [{ id: 'created', name: 'Created' }, ...(workflow?.steps || [])].map((step) => {
              const stepData = stepWiseReport[step.name];
              if (!stepData || Object.keys(stepData).length === 0) {
                return null; 
              }
              return (
              <Card key={step.id}>
                <CardHeader className="p-4 bg-muted/50">
                  <CardTitle className="text-base text-center">{step.name}</CardTitle>
                </CardHeader>
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
                         if (data.total === 0 && data.completed === 0 && data.rejected === 0) return null;
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
            )})
        )}
      </div>
    </div>
  );
}
