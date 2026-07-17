'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { ArrowLeft, Download, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { Requisition, Department } from '@/lib/types';
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

interface DeptRow {
  departmentId: string;
  departmentName: string;
  total: number;
  totalAmount: number;
  pending: number;
  inProgress: number;
  completed: number;
  rejected: number;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function DepartmentWiseReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Site Fund Request.Reports');
  const accessData = useSFRProjectAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [requests, setRequests] = useState<Requisition[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [filters, setFilters] = useState({ fy: 'all', month: 'all', status: 'all' });

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
        const [reqSnap, deptSnap] = await Promise.all([
          getDocs(collection(db, 'siteFundRequests')),
          getDocs(collection(db, 'departments')),
        ]);
        const allDocs = reqSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Requisition));
        let filteredByAccess = allDocs;
        if (!accessData.canViewAll && accessData.accessibleProjectIds !== null) {
          filteredByAccess = allDocs.filter(r => accessData.accessibleProjectIds!.has(r.projectId));
        }
        setRequests(filteredByAccess);
        setDepartments(deptSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Department)));
      } catch (err) {
        console.error('Failed to load department-wise report', err);
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
      if (filters.status !== 'all' && r.status !== filters.status) return false;
      return true;
    });
  }, [requests, filters]);

  const rows = useMemo((): DeptRow[] => {
    const map: Record<string, DeptRow> = {};
    filtered.forEach((r) => {
      const key = r.departmentId || '__unknown__';
      if (!map[key]) {
        map[key] = {
          departmentId: key,
          departmentName: deptMap[key] || key,
          total: 0,
          totalAmount: 0,
          pending: 0,
          inProgress: 0,
          completed: 0,
          rejected: 0,
        };
      }
      const row = map[key];
      row.total += 1;
      row.totalAmount += r.amount || 0;
      if (r.status === 'Pending' || r.status === 'Needs Review') row.pending += 1;
      if (r.status === 'In Progress') row.inProgress += 1;
      if (r.status === 'Completed') row.completed += 1;
      if (r.status === 'Rejected') row.rejected += 1;
    });
    return Object.values(map).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filtered, deptMap]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          total: acc.total + r.total,
          totalAmount: acc.totalAmount + r.totalAmount,
          pending: acc.pending + r.pending,
          inProgress: acc.inProgress + r.inProgress,
          completed: acc.completed + r.completed,
          rejected: acc.rejected + r.rejected,
        }),
        { total: 0, totalAmount: 0, pending: 0, inProgress: 0, completed: 0, rejected: 0 }
      ),
    [rows]
  );

  // ── export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Department-wise Report');
      ws.addRow(['Department', 'Total Requests', 'Total Amount', 'Pending', 'In Progress', 'Completed', 'Rejected']);
      rows.forEach((r) =>
        ws.addRow([r.departmentName, r.total, r.totalAmount, r.pending, r.inProgress, r.completed, r.rejected])
      );
      ws.addRow(['TOTAL', totals.total, totals.totalAmount, totals.pending, totals.inProgress, totals.completed, totals.rejected]);
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'site-fund-request-department-wise.xlsx';
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
        <Skeleton className="h-20 w-full rounded-2xl" />
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Department-wise Report</h1>
          </div>
        </div>
        <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
          <div className="h-1.5 w-full bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400 opacity-70" />
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Department-wise Report</h1>
            <p className="mt-0.5 text-sm text-slate-600">Requests and amounts grouped by department.</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || rows.length === 0}
          className="bg-white/80 border-white/70"
        >
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? 'Exporting…' : 'Export Excel'}
        </Button>
      </div>

      {/* Filters */}
      <Card className="overflow-hidden bg-white/70 border border-white/70 rounded-2xl shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400 opacity-70" />
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      {/* Table */}
      <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400 opacity-70" />
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Department Breakdown</CardTitle>
          <CardDescription>
            {rows.length} department{rows.length !== 1 ? 's' : ''} · {totals.total} request{totals.total !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              No records match the selected filters.
            </div>
          ) : (
            <div className="overflow-auto rounded-b-2xl border-t border-white/70 bg-white/80 max-h-[calc(100vh-380px)]">
              <table className="w-full caption-bottom text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 sticky top-0 z-10">
                    {[
                      'Department',
                      'Total Requests',
                      'Total Amount',
                      'Pending',
                      'In Progress',
                      'Completed',
                      'Rejected',
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
                  {rows.map((row) => (
                    <tr
                      key={row.departmentId}
                      className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">{row.departmentName}</td>
                      <td className="px-4 py-3 text-slate-700">{row.total}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{formatCurrency(row.totalAmount)}</td>
                      <td className="px-4 py-3 text-amber-700">{row.pending}</td>
                      <td className="px-4 py-3 text-blue-700">{row.inProgress}</td>
                      <td className="px-4 py-3 text-emerald-700">{row.completed}</td>
                      <td className="px-4 py-3 text-red-700">{row.rejected}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-100/80 font-semibold">
                    <td className="px-4 py-3 text-slate-900">Total</td>
                    <td className="px-4 py-3 text-slate-900">{totals.total}</td>
                    <td className="px-4 py-3 text-slate-900">{formatCurrency(totals.totalAmount)}</td>
                    <td className="px-4 py-3 text-amber-700">{totals.pending}</td>
                    <td className="px-4 py-3 text-blue-700">{totals.inProgress}</td>
                    <td className="px-4 py-3 text-emerald-700">{totals.completed}</td>
                    <td className="px-4 py-3 text-red-700">{totals.rejected}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
