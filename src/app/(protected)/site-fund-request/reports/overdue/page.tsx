'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, Download, Loader2, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { Requisition, Project, Department, User } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useSFRProjectAccess } from '@/hooks/useSFRProjectAccess';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

// ─── helpers ─────────────────────────────────────────────────────────────────

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);

function daysOverdue(deadlineDate: Date, now: Date): number {
  return Math.ceil((now.getTime() - deadlineDate.getTime()) / 86_400_000);
}

function overdueColorClass(days: number): string {
  if (days > 30) return 'text-red-600 font-bold';
  if (days > 7) return 'text-orange-600 font-semibold';
  return 'text-amber-600 font-semibold';
}

function overdueBadgeClass(days: number): string {
  if (days > 30) return 'bg-red-100 text-red-700';
  if (days > 7) return 'bg-orange-100 text-orange-700';
  return 'bg-amber-100 text-amber-700';
}

// ─── component ───────────────────────────────────────────────────────────────

export default function OverdueRequestsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Site Fund Request.Reports');
  const accessData = useSFRProjectAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [requests, setRequests] = useState<Requisition[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [filterProject, setFilterProject] = useState('all');
  const [filterDept, setFilterDept] = useState('all');
  const [filterStage, setFilterStage] = useState('all');

  // ── fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAuthLoading || accessData.isLoading) return;
    if (!canView) { setIsLoading(false); return; }
    const load = async () => {
      setIsLoading(true);
      try {
        const [reqSnap, projSnap, deptSnap, userSnap] = await Promise.all([
          getDocs(collection(db, 'siteFundRequests')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
          getDocs(collection(db, 'users')),
        ]);
        const allDocs = reqSnap.docs.map(d => ({ id: d.id, ...d.data() } as Requisition));
        let filteredByAccess = allDocs;
        if (!accessData.canViewAll && accessData.accessibleProjectIds !== null) {
          filteredByAccess = allDocs.filter(r => accessData.accessibleProjectIds!.has(r.projectId));
        }
        setRequests(filteredByAccess);
        setProjects(projSnap.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
        setDepartments(deptSnap.docs.map(d => ({ id: d.id, ...d.data() } as Department)));
        setUsers(userSnap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
      } catch (err) {
        console.error('Failed to load overdue report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView, accessData.isLoading, accessData.canViewAll]);

  // ── derived ────────────────────────────────────────────────────────────────
  const now = useMemo(() => new Date(), []);

  const projectMap = useMemo(() => {
    const m: Record<string, string> = {};
    projects.forEach(p => { m[p.id] = p.projectName; });
    return m;
  }, [projects]);

  const deptMap = useMemo(() => {
    const m: Record<string, string> = {};
    departments.forEach(d => { m[d.id] = d.name; });
    return m;
  }, [departments]);

  const userMap = useMemo(() => {
    const m: Record<string, string> = {};
    users.forEach(u => { m[u.id] = u.name; });
    return m;
  }, [users]);

  // All overdue requests (before UI filters)
  const allOverdue = useMemo(() =>
    requests.filter(r =>
      r.status !== 'Completed' &&
      r.status !== 'Rejected' &&
      r.deadline !== null &&
      r.deadline != null &&
      r.deadline.toDate() < now
    ),
    [requests, now]);

  // Unique stages from overdue set
  const stageOptions = useMemo(() => {
    const set = new Set<string>();
    allOverdue.forEach(r => { if (r.stage) set.add(r.stage); });
    return Array.from(set).sort();
  }, [allOverdue]);

  // Filtered with UI controls
  const filtered = useMemo(() => allOverdue.filter(r => {
    if (filterProject !== 'all' && r.projectId !== filterProject) return false;
    if (filterDept !== 'all' && r.departmentId !== filterDept) return false;
    if (filterStage !== 'all' && r.stage !== filterStage) return false;
    return true;
  }), [allOverdue, filterProject, filterDept, filterStage]);

  const totalAmount = useMemo(() => filtered.reduce((s, r) => s + (r.amount || 0), 0), [filtered]);

  const avgDaysOverdue = useMemo(() => {
    if (filtered.length === 0) return 0;
    const total = filtered.reduce((s, r) => s + daysOverdue(r.deadline!.toDate(), now), 0);
    return Math.round(total / filtered.length);
  }, [filtered, now]);

  // ── export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Overdue Requests');
      ws.addRow([
        'Request ID', 'Date', 'Project', 'Department', 'Party Name',
        'Amount', 'Stage', 'Assigned To', 'Deadline', 'Days Overdue',
      ]);
      ws.getRow(1).font = { bold: true };
      filtered.forEach(r => {
        ws.addRow([
          r.requisitionId,
          r.date,
          projectMap[r.projectId] || r.projectId,
          deptMap[r.departmentId] || r.departmentId,
          r.partyName,
          r.amount,
          r.stage,
          (r.assignees || []).map(id => userMap[id] || id).join(', '),
          r.deadline ? r.deadline.toDate().toLocaleDateString('en-IN') : '',
          r.deadline ? daysOverdue(r.deadline.toDate(), now) : '',
        ]);
      });
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'overdue-requests.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  // ── loading ────────────────────────────────────────────────────────────────
  if (isAuthLoading || accessData.isLoading || (isLoading && canView)) {
    return (
      <div className="w-full space-y-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-80 w-full rounded-2xl" />
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Overdue Requests</h1>
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Overdue Requests</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Active requests that have exceeded their deadline.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || filtered.length === 0}
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
        <div className="h-1.5 w-full bg-gradient-to-r from-rose-400 via-red-400 to-orange-400 opacity-70" />
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Department</p>
              <Select value={filterDept} onValueChange={setFilterDept}>
                <SelectTrigger className="bg-white/80 border-white/70"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Stage</p>
              <Select value={filterStage} onValueChange={setFilterStage}>
                <SelectTrigger className="bg-white/80 border-white/70"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stages</SelectItem>
                  {stageOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Overdue', value: filtered.length.toString(), gradient: 'from-rose-400 to-red-400' },
          { label: 'Total Amount at Risk', value: formatCurrency(totalAmount), gradient: 'from-orange-400 to-amber-400' },
          { label: 'Avg Days Overdue', value: `${avgDaysOverdue} days`, gradient: 'from-red-400 to-rose-400' },
        ].map(card => (
          <Card key={card.label} className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_18px_60px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
            <div className={`h-1.5 w-full bg-gradient-to-r ${card.gradient} opacity-70`} />
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-xl font-bold text-slate-800">{card.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-rose-400 via-red-400 to-orange-400 opacity-70" />
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Overdue Requests</CardTitle>
          <CardDescription>{filtered.length} record{filtered.length !== 1 ? 's' : ''} found</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <AlertTriangle className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-slate-500">No overdue requests for the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-auto rounded-b-2xl border-t border-white/70 bg-white/80 max-h-[calc(100vh-440px)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 sticky top-0 z-10">
                    {[
                      'Request ID', 'Date', 'Project', 'Department', 'Party Name',
                      'Amount', 'Stage', 'Assigned To', 'Deadline', 'Days Overdue',
                    ].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const deadlineDate = r.deadline!.toDate();
                    const days = daysOverdue(deadlineDate, now);
                    return (
                      <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800 whitespace-nowrap">
                          {r.requisitionId}
                        </td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.date}</td>
                        <td className="px-4 py-3 text-slate-700">{projectMap[r.projectId] || r.projectId}</td>
                        <td className="px-4 py-3 text-slate-700">{deptMap[r.departmentId] || r.departmentId}</td>
                        <td className="px-4 py-3 text-slate-700">{r.partyName}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900">
                          {formatCurrency(r.amount)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                            {r.stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {(r.assignees || []).map(id => userMap[id] || id).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                          {deadlineDate.toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs ${overdueBadgeClass(days)}`}>
                            <span className={overdueColorClass(days)}>{days}d</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
