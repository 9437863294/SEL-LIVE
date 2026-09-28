'use client';

import { useState, useEffect, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Download, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { db } from '@/lib/firebase';
import type { Requisition, Department } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useSFRProjectAccess } from '@/hooks/useSFRProjectAccess';
import { Button } from '@/components/ui/button';
import {
  Card,
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
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';

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
        <PageHeader
          backHref="/site-fund-request/reports"
          backLabel="Back to reports"
          eyebrow="Site Fund Request"
          title="Department-wise Report"
        />
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
      <PageHeader
        backHref="/site-fund-request/reports"
        backLabel="Back to reports"
        eyebrow="Site Fund Request — Reports"
        title="Department-wise Report"
        description="Requests and amounts grouped by department."
        actions={
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isExporting || rows.length === 0}
            className="bg-white/80 border-white/70"
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? 'Exporting…' : 'Export Excel'}
          </Button>
        }
      />

      {/* Table */}
      <TableCard
        title="Department Breakdown"
        description={<>{rows.length} department{rows.length !== 1 ? 's' : ''} · {totals.total} request{totals.total !== 1 ? 's' : ''}</>}
        scroll="natural"
        toolbar={
          <FilterBar
            activeCount={Object.values(filters).filter((v) => v !== 'all').length}
            onClear={() => setFilters({ fy: 'all', month: 'all', status: 'all' })}
          >
            <Select value={filters.fy} onValueChange={(v) => setFilters((f) => ({ ...f, fy: v }))}>
              <SelectTrigger aria-label="Financial Year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {fyOptions.map((fy) => (
                  <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.month} onValueChange={(v) => setFilters((f) => ({ ...f, month: v }))}>
              <SelectTrigger aria-label="Month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
              <SelectTrigger aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No records match the selected filters.
            </div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      'Department',
                      'Total Requests',
                      'Total Amount',
                      'Pending',
                      'In Progress',
                      'Completed',
                      'Rejected',
                    ].map((h) => (
                      <TableHead key={h} className={h === 'Department' ? undefined : 'text-right'}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.departmentId}>
                      <TableCell className="font-medium">{row.departmentName}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">{formatCurrency(row.totalAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.pending}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.inProgress}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.completed}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.rejected}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.total}</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatCurrency(totals.totalAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.pending}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.inProgress}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.completed}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.rejected}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
          )}
      </TableCard>
    </div>
  );
}
