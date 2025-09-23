
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
import type { InsuranceTask, Project, User, WorkflowStep, ActionLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

interface SummaryStats {
    totalTasks: number;
    totalAmount: number;
    completed: number;
    pending: number;
    rejected: number;
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

export default function MyTasksSummaryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [summaryStats, setSummaryStats] = useState<SummaryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [allTasks, setAllTasks] = useState<InsuranceTask[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<InsuranceTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [workflow, setWorkflow] = useState<{steps: WorkflowStep[]} | null>(null);

  const [filters, setFilters] = useState({
      year: 'all',
      month: 'all',
      project: 'all',
      applicant: 'all',
  });
  
  const canViewPage = can('View Reports', 'Insurance');

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
          const [tasksSnapshot, projectsSnapshot, usersSnapshot, workflowDoc] = await Promise.all([
              getDocs(collection(db, 'insuranceTasks')),
              getDocs(collection(db, 'projects')),
              getDocs(collection(db, 'users')),
              getDoc(doc(db, 'workflows', 'insurance-workflow'))
          ]);
          
          const tasksData = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceTask));
          setAllTasks(tasksData);
          setFilteredTasks(tasksData);

          setProjects(projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
          setUsers(usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User)));
          
          if(workflowDoc.exists()) {
            setWorkflow(workflowDoc.data() as { steps: WorkflowStep[] });
          }

      } catch (error) {
          console.error("Error fetching summary data: ", error);
      }
      setIsLoading(false);
  };
  
   useEffect(() => {
        let items = allTasks;

        if (filters.year !== 'all') {
            items = items.filter(task => new Date(task.createdAt.toDate()).getFullYear().toString() === filters.year);
        }
        if (filters.month !== 'all') {
            items = items.filter(task => (new Date(task.createdAt.toDate()).getMonth() + 1).toString() === filters.month);
        }
        if (filters.project !== 'all') {
            items = items.filter(task => task.projectId === filters.project);
        }
        if (filters.applicant !== 'all') {
            // Assuming applicant is the one who took the first action after creation
            const firstActorId = (task: InsuranceTask) => (task.history && task.history.length > 1) ? task.history[1].userId : null;
            items = items.filter(task => firstActorId(task) === filters.applicant);
        }
        
        setFilteredTasks(items);
    }, [filters, allTasks]);


  useEffect(() => {
        if (isLoading || allTasks.length === 0) {
           setSummaryStats({ totalTasks: 0, totalAmount: 0, completed: 0, pending: 0, rejected: 0 });
           return;
        };

        const totalTasks = filteredTasks.length;
        const totalAmount = 0; // Policy premium not on task, would need another join
        const rejected = filteredTasks.filter(task => task.status === 'Rejected').length;
        const completed = filteredTasks.filter(req => req.status === 'Completed').length;
        const pending = totalTasks - rejected - completed;
        
        setSummaryStats({ totalTasks, totalAmount, rejected, completed, pending });
  }, [filteredTasks, isLoading, allTasks]);
  
  const stepWiseReport = useMemo((): StepWiseReportData => {
    if (!workflow || !users.length || !filteredTasks.length) {
        return {};
    }

    const report: StepWiseReportData = {};
    const userMap = new Map(users.map(u => [u.id, u.name]));
    const stepMap = new Map(workflow.steps.map(s => [s.name, s]));

    workflow.steps.forEach(step => {
        report[step.name] = {};
    });

    const initializeUserInStep = (stepName: string, userName: string) => {
        if (!report[stepName]) report[stepName] = {};
        if (!report[stepName][userName]) {
            report[stepName][userName] = { total: 0, completed: 0, onTime: 0, rejected: 0 };
        }
    };
    
    const isCompletionAction = (action: string) => ['approve', 'complete', 'verified'].includes(action.toLowerCase());

    filteredTasks.forEach(task => {
        const history: ActionLog[] = (task as any).history || [];
        const processedStepsForTotal = new Set<string>();

        history.forEach(log => {
            if (!log.stepName || log.action === 'Created') return;

            const userName = userMap.get(log.userId) || 'Unknown User';
            initializeUserInStep(log.stepName, userName);

            if (!processedStepsForTotal.has(log.stepName)) {
                report[log.stepName][userName].total++;
                processedStepsForTotal.add(log.stepName);
            }

            if (isCompletionAction(log.action)) {
                report[log.stepName][userName].completed++;
            } else if (log.action.toLowerCase() === 'reject') {
                report[log.stepName][userName].rejected++;
            }
        });
    });

    return report;
}, [filteredTasks, workflow, users]);


  const getFilterOptions = (key: 'year' | 'month' | 'project' | 'applicant') => {
      const unique = (arr: any[]) => [...new Set(arr)];
      switch (key) {
          case 'year':
              return unique(allTasks.map(r => new Date(r.createdAt.toDate()).getFullYear().toString())).sort((a,b) => Number(b) - Number(a));
          case 'month':
              return Array.from({ length: 12 }, (_, i) => ({ value: (i + 1).toString(), label: new Date(0, i).toLocaleString('default', { month: 'long' }) }));
          case 'project':
              return projects.filter(p => allTasks.some(r => r.projectId === p.id));
          case 'applicant':
              return users.filter(u => allTasks.some(r => r.history && r.history.length > 1 && r.history[1].userId === u.id));
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
      { title: 'Total Tasks', value: summaryStats?.totalTasks.toLocaleString() },
      { title: 'Completed', value: summaryStats?.completed.toLocaleString() },
      { title: 'Pending', value: summaryStats?.pending.toLocaleString() },
      { title: 'Rejected', value: summaryStats?.rejected.toLocaleString() },
  ];
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-24 w-full mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 mb-8">
                {Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
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
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/insurance/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">My Tasks Summary</h1>
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
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/insurance/reports">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">My Tasks Summary</h1>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4 flex flex-col md:flex-row items-center gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full">
            <div className="space-y-1">
              <p className="text-sm font-medium">Year</p>
              <Select value={filters.year} onValueChange={(val) => handleFilterChange('year', val)}>
                <SelectTrigger>
                  <SelectValue placeholder="All Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                   {getFilterOptions('year').map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Month</p>
              <Select value={filters.month} onValueChange={(val) => handleFilterChange('month', val)}>
                <SelectTrigger>
                  <SelectValue placeholder="All Months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {getFilterOptions('month').map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Project</p>
              <Select value={filters.project} onValueChange={(val) => handleFilterChange('project', val)}>
                <SelectTrigger>
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {getFilterOptions('project').map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Applicant</p>
              <Select value={filters.applicant} onValueChange={(val) => handleFilterChange('applicant', val)}>
                <SelectTrigger>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        {isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
                <Card key={index}>
                    <CardHeader className="p-4"><Skeleton className="h-4 w-3/4" /></CardHeader>
                    <CardContent className="p-4 pt-0"><Skeleton className="h-8 w-1/2" /></CardContent>
                </Card>
            ))
        ) : (
            statsToDisplay.map((stat) => (
              <Card key={stat.title}>
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
        <h2 className="text-xl font-bold">Step-wise Report</h2>
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
              <Card key={step.name}>
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
                        <TableHead>On Time</TableHead>
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
