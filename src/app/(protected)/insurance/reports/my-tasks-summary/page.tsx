
'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, CheckCircle2, ClipboardCheck, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { ActionLog, InsuranceTask, Project, User, WorkflowStep } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────

interface SummaryStats { totalTasks: number; completed: number; pending: number; rejected: number }
type StepReport = Record<string, Record<string, { total: number; completed: number; onTime: number; rejected: number }>>;

// ─── page ─────────────────────────────────────────────────────────────────────

export default function MyTasksSummaryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewPage = can('View', 'Insurance.My Tasks');

  const [isLoading, setIsLoading] = useState(true);
  const [allTasks, setAllTasks] = useState<InsuranceTask[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<InsuranceTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [workflow, setWorkflow] = useState<{ steps: WorkflowStep[] } | null>(null);
  const [stats, setStats] = useState<SummaryStats>({ totalTasks: 0, completed: 0, pending: 0, rejected: 0 });
  const [filters, setFilters] = useState({ year: 'all', month: 'all', project: 'all', applicant: 'all' });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [tasksSnap, projectsSnap, usersSnap, wfDoc] = await Promise.all([
        getDocs(collection(db, 'insuranceTasks')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'users')),
        getDoc(doc(db, 'workflows', 'insurance-workflow')),
      ]);
      const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InsuranceTask));
      setAllTasks(tasks);
      setFilteredTasks(tasks);
      setProjects(projectsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Project)));
      setUsers(usersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as User)));
      if (wfDoc.exists()) setWorkflow(wfDoc.data() as { steps: WorkflowStep[] });
    } catch (err) {
      console.error('Error fetching summary data', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (!isAuthLoading) { if (canViewPage) fetchData(); else setIsLoading(false); } }, [isAuthLoading, canViewPage]); // eslint-disable-line

  // Apply filters
  useEffect(() => {
    let items = allTasks;
    if (filters.year !== 'all') items = items.filter((t) => t.createdAt.toDate().getFullYear().toString() === filters.year);
    if (filters.month !== 'all') items = items.filter((t) => (t.createdAt.toDate().getMonth() + 1).toString() === filters.month);
    if (filters.project !== 'all') items = items.filter((t) => t.projectId === filters.project);
    if (filters.applicant !== 'all') {
      items = items.filter((t) => t.history?.length > 1 && t.history[1].userId === filters.applicant);
    }
    setFilteredTasks(items);
  }, [filters, allTasks]);

  // Recompute stats
  useEffect(() => {
    const completed = filteredTasks.filter((t) => t.status === 'Completed').length;
    const rejected  = filteredTasks.filter((t) => t.status === 'Rejected').length;
    setStats({ totalTasks: filteredTasks.length, completed, rejected, pending: filteredTasks.length - completed - rejected });
  }, [filteredTasks]);

  // Step-wise report
  const stepReport = useMemo((): StepReport => {
    if (!workflow || !users.length || !filteredTasks.length) return {};
    const report: StepReport = {};
    const userMap = new Map(users.map((u) => [u.id, u.name]));
    workflow.steps.forEach((s) => { report[s.name] = {}; });
    const isCompletion = (a: string) => ['approve', 'complete', 'verified'].includes(a.toLowerCase());

    filteredTasks.forEach((task) => {
      const history: ActionLog[] = (task as any).history || [];
      const processed = new Set<string>();
      history.forEach((log) => {
        if (!log.stepName || log.action === 'Created') return;
        const name = userMap.get(log.userId) || 'Unknown';
        if (!report[log.stepName]) report[log.stepName] = {};
        if (!report[log.stepName][name]) report[log.stepName][name] = { total: 0, completed: 0, onTime: 0, rejected: 0 };
        if (!processed.has(log.stepName)) { report[log.stepName][name].total++; processed.add(log.stepName); }
        if (isCompletion(log.action)) report[log.stepName][name].completed++;
        else if (log.action.toLowerCase() === 'reject') report[log.stepName][name].rejected++;
      });
    });
    return report;
  }, [filteredTasks, workflow, users]);

  // Filter option helpers
  const yearOpts = useMemo(() => [...new Set(allTasks.map((t) => t.createdAt.toDate().getFullYear().toString()))].sort((a, b) => Number(b) - Number(a)), [allTasks]);
  const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: (i + 1).toString(), label: new Date(0, i).toLocaleString('default', { month: 'long' }) }));
  const projectOpts = useMemo(() => projects.filter((p) => allTasks.some((t) => t.projectId === p.id)), [projects, allTasks]);
  const applicantOpts = useMemo(() => users.filter((u) => allTasks.some((t) => t.history?.length > 1 && t.history[1].userId === u.id)), [users, allTasks]);

  const setFilter = (k: string, v: string) => setFilters((p) => ({ ...p, [k]: v }));

  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewPage) {
    return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader></Card>;
  }

  const STAT_CARDS = [
    { label: 'Total Tasks',  value: stats.totalTasks, icon: ClipboardCheck, gradient: 'from-indigo-500 to-blue-600',   color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Completed',    value: stats.completed,  icon: CheckCircle2,   gradient: 'from-emerald-500 to-teal-600',  color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Pending',      value: stats.pending,    icon: Loader2,        gradient: 'from-amber-400 to-orange-500',  color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Rejected',     value: stats.rejected,   icon: XCircle,        gradient: 'from-red-500 to-rose-600',      color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 ring-1 ring-cyan-100">
              <BarChart3 className="h-5 w-5 text-cyan-600" />
            </div>
            <div>
              <CardTitle className="tracking-tight">My Tasks Summary</CardTitle>
              <CardDescription>Step-wise breakdown of insurance task performance</CardDescription>
            </div>
          </div>
          <Link href="/insurance/reports">
            <Button variant="outline" size="sm" className="gap-1.5 w-fit">← Back to Reports</Button>
          </Link>
        </CardHeader>
      </Card>

      {/* Filters */}
      <Card className="border-border/60">
        <CardContent className="p-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { key: 'year',      placeholder: 'All Years',      opts: yearOpts.map((y) => ({ value: y, label: y })) },
            { key: 'month',     placeholder: 'All Months',     opts: monthOpts },
            { key: 'project',   placeholder: 'All Projects',   opts: projectOpts.map((p) => ({ value: p.id, label: p.projectName })) },
            { key: 'applicant', placeholder: 'All Applicants', opts: applicantOpts.map((u) => ({ value: u.id, label: u.name })) },
          ].map(({ key, placeholder, opts }) => (
            <Select key={key} value={filters[key as keyof typeof filters]} onValueChange={(v) => setFilter(key, v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={placeholder} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{placeholder}</SelectItem>
                {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ))}
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STAT_CARDS.map((s) => (
          <Card key={s.label} className="overflow-hidden border-border/60">
            <div className={cn('h-0.5 w-full bg-gradient-to-r', s.gradient)} />
            <CardContent className="flex items-center gap-3 p-4">
              <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', s.bg)}>
                <s.icon className={cn('h-4 w-4', s.color)} />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
                <p className="text-xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Step-wise report */}
      <div>
        <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Step-wise Breakdown</p>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1,2,3].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
          </div>
        ) : !workflow?.steps.length ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No workflow configured yet.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workflow.steps.map((step) => {
              const stepData = stepReport[step.name] ?? {};
              const users = Object.entries(stepData).filter(([, d]) => d.total > 0);
              if (users.length === 0) return null;
              return (
                <Card key={step.name} className="overflow-hidden border-border/60">
                  <div className="h-1 w-full bg-gradient-to-r from-cyan-400 to-blue-500" />
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">{step.name}</CardTitle>
                    <CardDescription className="text-[11px]">TAT: {step.tat}h</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="text-xs">User</TableHead>
                          <TableHead className="text-xs text-center">Total</TableHead>
                          <TableHead className="text-xs text-center">Done</TableHead>
                          <TableHead className="text-xs text-center">Rejected</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map(([userName, data]) => (
                          <TableRow key={userName} className="hover:bg-muted/20">
                            <TableCell className="text-xs font-medium">{userName}</TableCell>
                            <TableCell className="text-xs text-center">{data.total}</TableCell>
                            <TableCell className="text-xs text-center">
                              <span className={cn('font-semibold', data.completed > 0 ? 'text-emerald-600' : 'text-muted-foreground')}>{data.completed}</span>
                            </TableCell>
                            <TableCell className="text-xs text-center">
                              <span className={cn('font-semibold', data.rejected > 0 ? 'text-red-500' : 'text-muted-foreground')}>{data.rejected}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
