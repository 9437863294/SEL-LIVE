'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { ArrowLeft, Download, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { Requisition, Project, Department } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useSFRProjectAccess } from '@/hooks/useSFRProjectAccess';
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
import { Skeleton } from '@/components/ui/skeleton';

// ─── helpers ────────────────────────────────────────────────────────────────

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(amount);

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

const STATUS_BADGE: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-700',
  'In Progress': 'bg-blue-100 text-blue-700',
  Completed: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  'Needs Review': 'bg-orange-100 text-orange-700',
};

const ALL_STATUSES: Requisition['status'][] = [
  'Pending',
  'In Progress',
  'Completed',
  'Rejected',
  'Needs Review',
];

const MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

// ─── component ───────────────────────────────────────────────────────────────

export default function SummaryReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Site Fund Request.Reports');
  const accessData = useSFRProjectAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [requests, setRequests] = useState<Requisition[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [filters, setFilters] = useState({
    fy: 'all',
    month: 'all',
    project: 'all',
    department: 'all',
    status: 'all',
  });

  // ── fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAuthLoading || accessData.isLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      try {
        const [reqSnap, projSnap, deptSnap] = await Promise.all([
          getDocs(collection(db, 'siteFundRequests')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
        ]);
        const allDocs = reqSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Requisition));
        let filteredByAccess = allDocs;
        if (!accessData.canViewAll && accessData.accessibleProjectIds !== null) {
          filteredByAccess = allDocs.filter(r => accessData.accessibleProjectIds!.has(r.projectId));
        }
        setRequests(filteredByAccess);
        setProjects(projSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Project)));
        setDepartments(deptSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Department)));
      } catch (err) {
        console.error('Failed to load summary report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView, accessData.isLoading, accessData.canViewAll]);

  // ── derived ────────────────────────────────────────────────────────────────
  const fyOptions = useMemo(() => {
    const fys = new Set<string>([currentFY()]);
    requests.forEach((r) => { if (r.date) fys.add(getFY(r.date)); });
    return Array.from(fys).sort((a, b) => b.localeCompare(a));
  }, [requests]);

  const projectMap = useMemo(() => {
    const m: Record<string, string> = {};
    projects.forEach((p) => { m[p.id] = p.projectName; });
    return m;
  }, [projects]);

  const deptMap = useMemo(() => {
    const m: Record<string, string> = {};
    departments.forEach((d) => { m[d.id] = d.name; });
    return m;
  }, [departments]);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (!r.date) return false;
      if (filters.fy !== 'all' && getFY(r.date) !== filters.fy) return false;
      if (filters.month !== 'all' && r.date.split('-')[1] !== filters.month.padStart(2, '0')) return false;
      if (filters.project !== 'all' && r.projectId !== filters.project) return false;
      if (filters.department !== 'all' && r.departmentId !== filters.department) return false;
      if (filters.status !== 'all' && r.status !== filters.status) return false;
      return true;
    });
  }, [requests, filters]);

  const stats = useMemo(() => ({
    totalRequests: filtered.length,
    totalAmount: filtered.reduce((s, r) => s + (r.amount || 0), 0),
    pendingCount: filtered.filter((r) => r.status === 'Pending' || r.status === 'Needs Review').length,
    inProgressCount: filtered.filter((r) => r.status === 'In Progress').length,
    completedAmount: filtered.filter((r) => r.status === 'Completed').reduce((s, r) => s + (r.amount || 0), 0),
    rejectedCount: filtered.filter((r) => r.status === 'Rejected').length,
  }), [filtered]);

  // ── export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Summary Report');
      ws.addRow(['Request ID', 'Date', 'Project', 'Department', 'Party Name', 'Amount', 'Status', 'Raised By']);
      filtered.forEach((r) =>
        ws.addRow([
          r.requisitionId,
          r.date,
          projectMap[r.projectId] || r.projectId,
          deptMap[r.departmentId] || r.departmentId,
          r.partyName,
          r.amount,
          r.status,
          r.raisedBy,
        ])
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'site-fund-request-summary.xlsx';
      a.click();
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
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
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Site Fund Request</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Summary Report</h1>
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
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Site Fund Request — Reports
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Summary Report</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Status breakdown and total amounts for fund requests.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || filtered.length === 0}
          className="bg-white/80 border-white/70"
        >
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? 'Exporting…' : 'Export Excel'}
        </Button>
      </div>

      {/* Filters */}
      <Card className="overflow-hidden bg-white/70 border border-white/70 rounded-2xl shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 opacity-70" />
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {/* FY */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Financial Year</p>
              <Select value={filters.fy} onValueChange={(v) => setFilters((f) => ({ ...f, fy: v }))}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {fyOptions.map((fy) => (
                    <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Month */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Month</p>
              <Select value={filters.month} onValueChange={(v) => setFilters((f) => ({ ...f, month: v }))}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Project */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Project</p>
              <Select value={filters.project} onValueChange={(v) => setFilters((f) => ({ ...f, project: v }))}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Department */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Department</p>
              <Select value={filters.department} onValueChange={(v) => setFilters((f) => ({ ...f, department: v }))}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Status */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Status</p>
              <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Total Requests', value: stats.totalRequests.toLocaleString('en-IN'), gradient: 'from-indigo-400 to-violet-400' },
          { label: 'Total Amount', value: formatCurrency(stats.totalAmount), gradient: 'from-violet-400 to-blue-400' },
          { label: 'Pending', value: stats.pendingCount.toLocaleString('en-IN'), gradient: 'from-amber-400 to-orange-400' },
          { label: 'In Progress', value: stats.inProgressCount.toLocaleString('en-IN'), gradient: 'from-sky-400 to-blue-400' },
          { label: 'Completed Amount', value: formatCurrency(stats.completedAmount), gradient: 'from-emerald-400 to-green-400' },
          { label: 'Rejected', value: stats.rejectedCount.toLocaleString('en-IN'), gradient: 'from-rose-400 to-red-400' },
        ].map((card) => (
          <Card
            key={card.label}
            className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_18px_60px_-55px_rgba(2,6,23,0.55)] backdrop-blur"
          >
            <div className={`h-1.5 w-full bg-gradient-to-r ${card.gradient} opacity-70`} />
            <CardHeader className="p-4 pb-1">
              <CardDescription className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                {card.label}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <p className="truncate text-xl font-bold text-slate-900">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 opacity-70" />
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Fund Requests</CardTitle>
          <CardDescription>
            {filtered.length} record{filtered.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              No records match the selected filters.
            </div>
          ) : (
            <div className="overflow-auto rounded-b-2xl border-t border-white/70 bg-white/80 max-h-[calc(100vh-420px)]">
              <table className="w-full caption-bottom text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 sticky top-0 z-10">
                    {[
                      'Request ID',
                      'Date',
                      'Project',
                      'Department',
                      'Party Name',
                      'Amount',
                      'Status',
                      'Raised By',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800">
                        {r.requisitionId}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.date}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {projectMap[r.projectId] || r.projectId}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {deptMap[r.departmentId] || r.departmentId}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.partyName}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {formatCurrency(r.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[r.status] ?? 'bg-slate-100 text-slate-700'}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.raisedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
