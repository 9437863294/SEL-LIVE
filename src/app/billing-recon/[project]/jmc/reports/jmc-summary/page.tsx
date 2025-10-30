
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Home, ShieldAlert } from 'lucide-react';
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
import type { Requisition, Project, User, WorkflowStep, ActionLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useParams } from 'next/navigation';

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

export default function JmcSummaryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { project: projectSlug } = useParams() as { project: string };
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
      applicant: 'all',
  });
  
  const canViewPage = can('View Reports', 'Billing Recon.JMC');

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
        
        const [reqsSnapshot, usersSnapshot, workflowDoc] = await Promise.all([
          getDocs(query(collection(db, 'jmcEntries'), where('projectId', '==', currentProjectId))),
          getDocs(collection(db, 'users')),
          getDoc(doc(db, 'workflows', 'jmc-workflow')),
        ]);
        
        const requisitionsData = reqsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Requisition));
        setAllRequisitions(requisitionsData);
        setFilteredRequisitions(requisitionsData);

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
        let items = allRequisitions;

        if (filters.year !== 'all') {
            items = items.filter(req => {
              const date = req.date || (req as any).jmcDate;
              return date && new Date(date).getFullYear().toString() === filters.year;
            });
        }
        if (filters.month !== 'all') {
            items = items.filter(req => {
              const date = req.date || (req as any).jmcDate;
              return date && (new Date(date).getMonth() + 1).toString() === filters.month;
            });
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
        const totalAmount = filteredRequisitions.reduce((sum, req) => sum + (req.amount || 0), 0);
        const cancelled = filteredRequisitions.filter(req => req.status === 'Rejected').length;
        const approved = filteredRequisitions
            .filter(req => req.status === 'Completed')
            .reduce((sum, req) => sum + (req.amount || 0), 0);
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

    filteredRequisitions.forEach(req => {
        const history: ActionLog[] = req.history || [];
        const processedStepsForTotal = new Set<string>();
        const processedStepsForActions = new Set<string>();

        history.forEach(log => {
            if (!log.stepName || log.action === 'Created') return;

            const userName = userMap.get(log.userId) || 'Unknown User';
            initializeUserInStep(log.stepName, userName);

            if (!processedStepsForTotal.has(log.stepName)) {
                report[log.stepName][userName].total++;
                processedStepsForTotal.add(log.stepName);
            }
        });
        
        history.slice().reverse().forEach(log => {
            if (!log.stepName || log.action === 'Created') return;
            
            if (processedStepsForActions.has(log.stepName)) return;

            const userName = userMap.get(log.userId) || 'Unknown User';
            initializeUserInStep(log.stepName, userName);

            if (isCompletionAction(log.action)) {
                report[log.stepName][userName].completed++;
                processedStepsForActions.add(log.stepName);
            } else if (log.action.toLowerCase() === 'reject') {
                report[log.stepName][userName].rejected++;
                processedStepsForActions.add(log.stepName);
            }
        });
    });

    return report;
}, [filteredRequisitions, workflow, users]);


  const getFilterOptions = (key: 'year' | 'month' | 'project' | 'applicant') => {
      const unique = (arr: any[]) => [...new Set(arr)];
      const allDates = allRequisitions.map(r => r.date || (r as any).jmcDate).filter(Boolean);

      switch (key) {
          case 'year':
              return unique(allDates.map(d => new Date(d).getFullYear().toString())).sort((a,b) => Number(b) - Number(a));
          case 'month':
              return Array.from({ length: 12 }, (_, i) => ({ value: (i + 1).toString(), label: new Date(0, i).toLocaleString('default', { month: 'long' }) }));
          case 'applicant':
              const applicantIds = new Set(allRequisitions.map(r => r.raisedById));
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
      { title: 'Total JMCs', value: summaryStats?.totalRequisitions.toLocaleString() || '0' },
      { title: 'Total Certified Value', value: formatCurrency(summaryStats?.totalAmount || 0) },
      { title: 'Rejected', value: summaryStats?.cancelled.toLocaleString() || '0' },
  ];
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full pr-14">
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
        <div className="w-full pr-14">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href={`/billing-recon/${projectSlug}/jmc/reports`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">JMC Summary</h1>
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
          <Link href={`/billing-recon/${projectSlug}/jmc/reports`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">JMC Summary</h1>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4 flex flex-col md:flex-row items-center gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 w-full">
            <Select value={filters.year} onValueChange={(v) => handleFilterChange('year', v)}>
              <SelectTrigger><SelectValue placeholder="Select Year" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {(getFilterOptions('year') as string[]).map(year => (
                  <SelectItem key={year} value={year}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.month} onValueChange={(v) => handleFilterChange('month', v)}>
              <SelectTrigger><SelectValue placeholder="Select Month" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
  {(getFilterOptions('month') as { value: string, label: string }[]).map(month => (
                  <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.applicant} onValueChange={(v) => handleFilterChange('applicant', v)}>
              <SelectTrigger><SelectValue placeholder="Select Applicant" /></SelectTrigger>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mb-8">
        {isLoading ? (
            Array.from({ length: 3 }).map((_, index) => (
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
          (workflow?.steps || []).map((step) => {
              const stepData = stepWiseReport[step.name];
              if (!stepData || Object.values(stepData).every(data => data.total === 0 && data.completed === 0 && data.rejected === 0)) {
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
                         if (data.total === 0 && data.completed === 0 && data.rejected === 0) return null;
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
