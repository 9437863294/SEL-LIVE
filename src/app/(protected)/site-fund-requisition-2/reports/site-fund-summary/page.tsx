
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
}, [filteredRequisitions, workflow, users]);
  
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
        <div className="w-full pr-14">
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
        <div className="w-full pr-14">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/site-fund-requisition-2/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">Site Fund Summary</h1>
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
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/site-fund-requisition-2/reports">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Site Fund Summary</h1>
        </div>
      </div>
    </div>
  );
}
