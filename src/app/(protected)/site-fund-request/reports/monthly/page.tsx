'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { ArrowLeft, Download, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { Requisition } from '@/lib/types';
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

/** Returns the start calendar year from a FY label like "2024-25" → 2024 */
function fyStartYear(fy: string): number {
  return Number(fy.split('-')[0]);
}

/** All 12 months of a FY in Apr→Mar order as 'YYYY-MM' strings */
function fyMonths(fy: string): { ym: string; label: string }[] {
  const startYear = fyStartYear(fy);
  const result: { ym: string; label: string }[] = [];
  // April–December of startYear
  for (let m = 4; m <= 12; m++) {
    const ym = `${startYear}-${String(m).padStart(2, '0')}`;
    const label = new Date(startYear, m - 1, 1).toLocaleString('en-IN', {
      month: 'short',
      year: 'numeric',
    });
    result.push({ ym, label });
  }
  // January–March of startYear+1
  for (let m = 1; m <= 3; m++) {
    const ym = `${startYear + 1}-${String(m).padStart(2, '0')}`;
    const label = new Date(startYear + 1, m - 1, 1).toLocaleString('en-IN', {
      month: 'short',
      year: 'numeric',
    });
    result.push({ ym, label });
  }
  return result;
}

interface MonthRow {
  ym: string;
  label: string;
  total: number;
  totalAmount: number;
  pending: number;
  inProgress: number;
  completed: number;
  rejected: number;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function MonthlyComparisonPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Site Fund Request.Reports');
  const accessData = useSFRProjectAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [requests, setRequests] = useState<Requisition[]>([]);

  const [selectedFY, setSelectedFY] = useState<string>(currentFY());

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
        const reqSnap = await getDocs(collection(db, 'siteFundRequests'));
        const allDocs = reqSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Requisition));
        let filteredByAccess = allDocs;
        if (!accessData.canViewAll && accessData.accessibleProjectIds !== null) {
          filteredByAccess = allDocs.filter(r => accessData.accessibleProjectIds!.has(r.projectId));
        }
        setRequests(filteredByAccess);
      } catch (err) {
        console.error('Failed to load monthly comparison report', err);
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

  // Ensure selectedFY stays valid when fyOptions change
  const effectiveFY = fyOptions.includes(selectedFY) ? selectedFY : (fyOptions[0] ?? currentFY());

  const rows = useMemo((): MonthRow[] => {
    const months = fyMonths(effectiveFY);

    // Build a lookup keyed by 'YYYY-MM'
    const byMonth: Record<string, Requisition[]> = {};
    months.forEach(({ ym }) => { byMonth[ym] = []; });

    requests.forEach((r) => {
      if (!r.date) return;
      if (getFY(r.date) !== effectiveFY) return;
      const ym = r.date.slice(0, 7);
      if (byMonth[ym]) byMonth[ym].push(r);
    });

    return months.map(({ ym, label }) => {
      const group = byMonth[ym] ?? [];
      return {
        ym,
        label,
        total: group.length,
        totalAmount: group.reduce((s, r) => s + (r.amount || 0), 0),
        pending: group.filter((r) => r.status === 'Pending' || r.status === 'Needs Review').length,
        inProgress: group.filter((r) => r.status === 'In Progress').length,
        completed: group.filter((r) => r.status === 'Completed').length,
        rejected: group.filter((r) => r.status === 'Rejected').length,
      };
    });
  }, [requests, effectiveFY]);

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
      const ws = wb.addWorksheet('Monthly Comparison');
      ws.addRow(['Month', 'Total Requests', 'Total Amount', 'Pending', 'In Progress', 'Completed', 'Rejected']);
      rows.forEach((r) =>
        ws.addRow([r.label, r.total, r.totalAmount, r.pending, r.inProgress, r.completed, r.rejected])
      );
      ws.addRow(['TOTAL', totals.total, totals.totalAmount, totals.pending, totals.inProgress, totals.completed, totals.rejected]);
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `site-fund-request-monthly-${effectiveFY}.xlsx`;
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Monthly Comparison</h1>
          </div>
        </div>
        <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
          <div className="h-1.5 w-full bg-gradient-to-r from-emerald-400 via-teal-400 to-green-400 opacity-70" />
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Monthly Comparison</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Month-wise request volumes and amounts for a financial year.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || totals.total === 0}
          className="bg-white/80 border-white/70"
        >
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? 'Exporting…' : 'Export Excel'}
        </Button>
      </div>

      {/* FY Filter */}
      <Card className="overflow-hidden bg-white/70 border border-white/70 rounded-2xl shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-emerald-400 via-teal-400 to-green-400 opacity-70" />
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Financial Year</p>
              <Select value={effectiveFY} onValueChange={setSelectedFY}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fyOptions.map((fy) => (
                    <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Requests', value: totals.total.toLocaleString('en-IN'), gradient: 'from-emerald-400 to-teal-400' },
          { label: 'Total Amount', value: formatCurrency(totals.totalAmount), gradient: 'from-teal-400 to-cyan-400' },
          { label: 'Completed', value: totals.completed.toLocaleString('en-IN'), gradient: 'from-green-400 to-emerald-400' },
          { label: 'Pending / Review', value: totals.pending.toLocaleString('en-IN'), gradient: 'from-amber-400 to-orange-400' },
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

      {/* Monthly table */}
      <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-emerald-400 via-teal-400 to-green-400 opacity-70" />
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Month-by-Month Breakdown — FY {effectiveFY}</CardTitle>
          <CardDescription>
            All 12 months (Apr → Mar) · {totals.total} total request{totals.total !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto rounded-b-2xl border-t border-white/70 bg-white/80">
            <table className="w-full caption-bottom text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90 sticky top-0 z-10">
                  {[
                    'Month',
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
                {rows.map((row) => {
                  const isCurrentMonth =
                    row.ym === new Date().toISOString().slice(0, 7);
                  return (
                    <tr
                      key={row.ym}
                      className={`border-b border-slate-100 transition-colors ${
                        isCurrentMonth
                          ? 'bg-emerald-50/60 hover:bg-emerald-50/90'
                          : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {row.label}
                        {isCurrentMonth && (
                          <span className="ml-2 inline-flex rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            current
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.total > 0 ? row.total : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {row.totalAmount > 0 ? formatCurrency(row.totalAmount) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-amber-700">
                        {row.pending > 0 ? row.pending : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-blue-700">
                        {row.inProgress > 0 ? row.inProgress : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-emerald-700">
                        {row.completed > 0 ? row.completed : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-red-700">
                        {row.rejected > 0 ? row.rejected : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
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
        </CardContent>
      </Card>
    </div>
  );
}
