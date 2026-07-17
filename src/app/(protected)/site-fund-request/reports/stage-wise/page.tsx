'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { ArrowLeft, CheckCircle2, Clock, AlertTriangle, Download, Loader2, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { Requisition, WorkflowStep, Project } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

// ─── helpers ─────────────────────────────────────────────────────────────────

function getFY(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  if (m >= 4) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

function currentFY(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 4) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

const MONTHS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
];

const COMPLETION_KEYWORDS = ['approv', 'complet', 'verif', 'forward', 'done'];
const isCompletion = (a: string) => COMPLETION_KEYWORDS.some(k => a.toLowerCase().includes(k));
const isRejection = (a: string) => a.toLowerCase().includes('reject');

// ─── types ────────────────────────────────────────────────────────────────────

interface UserStepStat {
  userId: string;
  userName: string;
  totalAssigned: number;
  completed: number;
  onTime: number;
  rejected: number;
}

interface StepAnalysis {
  step: WorkflowStep;
  userStats: UserStepStat[];
}

// ─── component ───────────────────────────────────────────────────────────────

export default function StageWiseAnalysisPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Site Fund Request.Reports');

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [requests, setRequests] = useState<Requisition[]>([]);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [filterFY, setFilterFY] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterProject, setFilterProject] = useState('all');

  // ── fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) { setIsLoading(false); return; }
    const load = async () => {
      setIsLoading(true);
      try {
        const [reqSnap, wfSnap, projSnap] = await Promise.all([
          getDocs(collection(db, 'siteFundRequests')),
          getDoc(doc(db, 'workflows', 'site-fund-request')),
          getDocs(collection(db, 'projects')),
        ]);
        setRequests(reqSnap.docs.map(d => ({ id: d.id, ...d.data() } as Requisition)));
        setSteps((wfSnap.data()?.steps ?? []) as WorkflowStep[]);
        setProjects(projSnap.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
      } catch (err) {
        console.error('Failed to load stage-wise report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView]);

  // ── derived ────────────────────────────────────────────────────────────────
  const fyOptions = useMemo(() => {
    const fys = new Set<string>([currentFY()]);
    requests.forEach(r => { if (r.date) fys.add(getFY(r.date)); });
    return Array.from(fys).sort((a, b) => b.localeCompare(a));
  }, [requests]);

  const filtered = useMemo(() => requests.filter(r => {
    if (!r.date) return false;
    if (filterFY !== 'all' && getFY(r.date) !== filterFY) return false;
    if (filterMonth !== 'all' && r.date.split('-')[1] !== filterMonth.padStart(2, '0')) return false;
    if (filterProject !== 'all' && r.projectId !== filterProject) return false;
    return true;
  }), [requests, filterFY, filterMonth, filterProject]);

  const now = new Date();

  const activeCount = useMemo(() =>
    filtered.filter(r => r.status !== 'Completed' && r.status !== 'Rejected').length,
    [filtered]);

  const completedCount = useMemo(() =>
    filtered.filter(r => r.status === 'Completed').length,
    [filtered]);

  const overdueCount = useMemo(() =>
    filtered.filter(r =>
      r.status !== 'Completed' &&
      r.status !== 'Rejected' &&
      r.deadline !== null &&
      r.deadline != null &&
      r.deadline.toDate() < now
    ).length,
    [filtered]);

  const stepAnalyses = useMemo<StepAnalysis[]>(() => {
    return steps.map((step, stepIndex) => {
      const prevStepName = stepIndex > 0 ? steps[stepIndex - 1].name : null;
      const userMap = new Map<string, UserStepStat>();

      for (const req of filtered) {
        const history = req.history || [];
        const stepHistory = history.filter(h => h.stepName === step.name);
        if (stepHistory.length === 0) continue;

        // Compute step start time
        let stepStart: Date;
        if (prevStepName) {
          const prevActions = history
            .filter(h => h.stepName === prevStepName)
            .sort((a, b) => a.timestamp.toDate().getTime() - b.timestamp.toDate().getTime());
          stepStart = prevActions.length > 0
            ? prevActions[prevActions.length - 1].timestamp.toDate()
            : req.createdAt.toDate();
        } else {
          stepStart = req.createdAt.toDate();
        }

        const tatMs = step.tat * 3600_000;

        // Group actions by user for this request + step
        const byUser = new Map<string, typeof stepHistory>();
        for (const action of stepHistory) {
          const uid = action.userId || 'unknown';
          if (!byUser.has(uid)) byUser.set(uid, []);
          byUser.get(uid)!.push(action);
        }

        for (const [uid, actions] of byUser) {
          const uname = actions[0].userName || 'Unknown';
          if (!userMap.has(uid)) {
            userMap.set(uid, { userId: uid, userName: uname, totalAssigned: 0, completed: 0, onTime: 0, rejected: 0 });
          }
          const stat = userMap.get(uid)!;
          stat.totalAssigned++;

          const completionAction = actions.find(a => isCompletion(a.action));
          const rejectionAction = actions.find(a => isRejection(a.action));

          if (completionAction) {
            stat.completed++;
            if (completionAction.timestamp.toDate().getTime() <= stepStart.getTime() + tatMs) {
              stat.onTime++;
            }
          }
          if (rejectionAction) {
            stat.rejected++;
          }
        }
      }

      return { step, userStats: Array.from(userMap.values()) };
    });
  }, [steps, filtered]);

  // ── export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      for (const { step, userStats } of stepAnalyses) {
        const ws = wb.addWorksheet(step.name.slice(0, 31));
        ws.addRow(['User', 'Total Assigned', 'Completed', 'On Time', 'Rejected']);
        ws.getRow(1).font = { bold: true };
        userStats.forEach(u => ws.addRow([u.userName, u.totalAssigned, u.completed, u.onTime, u.rejected]));
        ws.columns = [
          { key: 'col1', width: 28 },
          { key: 'col2', width: 16 },
          { key: 'col3', width: 14 },
          { key: 'col4', width: 12 },
          { key: 'col5', width: 12 },
        ];
      }
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'stage-wise-analysis.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  // ── loading ────────────────────────────────────────────────────────────────
  if (isAuthLoading || (isLoading && canView)) {
    return (
      <div className="w-full space-y-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
      </div>
    );
  }

  // ── access denied ──────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="w-full space-y-4 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Link href="/site-fund-request/reports">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Site Fund Request</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Stage-wise Analysis</h1>
          </div>
        </div>
        <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
          <div className="h-1.5 w-full bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 opacity-70" />
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Access Denied
            </CardTitle>
            <CardDescription>You do not have permission to view this report.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-full space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/site-fund-request/reports">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Site Fund Request — Reports
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Stage-wise Analysis</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Workflow step performance with TAT compliance and user workload.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || steps.length === 0}
          className="bg-white/80 border-white/70"
        >
          {isExporting
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <Download className="mr-2 h-4 w-4" />}
          {isExporting ? 'Exporting…' : 'Export Excel'}
        </Button>
      </div>

      {/* Filters */}
      <Card className="overflow-hidden bg-white/70 border border-white/70 rounded-2xl shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-fuchsia-400 via-violet-400 to-purple-400 opacity-70" />
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Financial Year</p>
              <Select value={filterFY} onValueChange={setFilterFY}>
                <SelectTrigger className="bg-white/80 border-white/70"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {fyOptions.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Month</p>
              <Select value={filterMonth} onValueChange={setFilterMonth}>
                <SelectTrigger className="bg-white/80 border-white/70"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Project</p>
              <Select value={filterProject} onValueChange={setFilterProject}>
                <SelectTrigger className="bg-white/80 border-white/70"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Active Requests', value: activeCount, icon: Clock, bg: 'bg-blue-50', color: 'text-blue-600', gradient: 'from-blue-400 to-indigo-400' },
          { label: 'Completed This Period', value: completedCount, icon: CheckCircle2, bg: 'bg-emerald-50', color: 'text-emerald-600', gradient: 'from-emerald-400 to-teal-400' },
          { label: 'Overdue', value: overdueCount, icon: AlertTriangle, bg: 'bg-rose-50', color: 'text-rose-600', gradient: 'from-rose-400 to-red-400' },
        ].map(card => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_18px_60px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
              <div className={`h-1.5 w-full bg-gradient-to-r ${card.gradient} opacity-70`} />
              <CardContent className="flex items-center gap-4 p-5">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${card.bg}`}>
                  <Icon className={`h-5 w-5 ${card.color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="text-2xl font-bold text-slate-800">{card.value}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Step cards */}
      {steps.length === 0 ? (
        <Card className="rounded-2xl bg-white/70">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-muted-foreground">No workflow steps configured.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {stepAnalyses.map(({ step, userStats }) => (
            <Card key={step.id} className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
              <div className="h-1.5 w-full bg-gradient-to-r from-fuchsia-400 via-violet-400 to-purple-400 opacity-70" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-base font-semibold text-slate-800">
                  {step.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">TAT: {step.tat}h</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {userStats.length === 0 ? (
                  <p className="px-5 pb-5 text-xs text-muted-foreground">No activity in the selected period.</p>
                ) : (
                  <div className="overflow-auto rounded-b-2xl border-t border-white/70 bg-white/80 max-h-72">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-slate-50/90 sticky top-0 z-10">
                          {['User', 'Total Assigned', 'Completed', 'On Time', 'Rejected'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {userStats.map(u => (
                          <tr key={u.userId} className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
                            <td className="px-4 py-2.5 font-medium text-slate-700">{u.userName}</td>
                            <td className="px-4 py-2.5 text-slate-600">{u.totalAssigned}</td>
                            <td className="px-4 py-2.5 text-slate-600">{u.completed}</td>
                            <td className="px-4 py-2.5 font-medium text-emerald-600">{u.onTime}</td>
                            <td className="px-4 py-2.5 font-medium text-rose-600">{u.rejected}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

    </div>
  );
}
