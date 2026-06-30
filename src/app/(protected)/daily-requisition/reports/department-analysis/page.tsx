'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Download, Layers } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { DailyRequisitionEntry } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DailyPageHeader,
  dailyPageContainerClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount || 0);

interface DeptRow {
  departmentId: string;
  name: string;
  count: number;
  totalGross: number;
  totalNet: number;
  paid: number;
  pendingOther: number;
}

export default function DepartmentAnalysisPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');
  const canExport = can('Export', 'Daily Requisition.Reports') || can('Export', 'Daily Requisition.Entry Sheet') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [deptNameMap, setDeptNameMap] = useState<Record<string, string>>({});

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate] = useState(today);

  useEffect(() => {
    if (!canView) {
      setIsLoading(false);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      try {
        const [entriesSnap, deptsSnap] = await Promise.all([
          getDocs(collection(db, 'dailyRequisitions')),
          getDocs(collection(db, 'departments')),
        ]);

        const nameMap: Record<string, string> = {};
        deptsSnap.docs.forEach((d) => {
          const data = d.data();
          nameMap[d.id] = (data.name as string) || d.id;
        });
        setDeptNameMap(nameMap);

        setEntries(
          entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry))
        );
      } catch (err) {
        console.error('Failed to load department analysis', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const d = String(e.date || '').slice(0, 10);
      return d >= fromDate && d <= toDate;
    });
  }, [entries, fromDate, toDate]);

  const rows = useMemo((): DeptRow[] => {
    const map: Record<string, DeptRow> = {};
    filtered.forEach((e) => {
      const key = e.departmentId || '__unknown__';
      if (!map[key]) {
        map[key] = {
          departmentId: key,
          name: deptNameMap[key] || key,
          count: 0,
          totalGross: 0,
          totalNet: 0,
          paid: 0,
          pendingOther: 0,
        };
      }
      const row = map[key];
      row.count += 1;
      row.totalGross += Number(e.grossAmount || 0);
      row.totalNet += Number(e.netAmount || 0);
      if (e.status === 'Paid') {
        row.paid += 1;
      } else {
        row.pendingOther += 1;
      }
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [filtered, deptNameMap]);

  const totalDepts = rows.length;
  const totalEntries = rows.reduce((s, r) => s + r.count, 0);
  const totalNet = rows.reduce((s, r) => s + r.totalNet, 0);
  const topDept = rows[0] ?? null;
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0);

  const exportExcel = async () => {
    if (!canExport || isExporting || rows.length === 0) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Department Analysis');
      ws.columns = [
        { header: 'Department', key: 'name', width: 32 },
        { header: 'Count', key: 'count', width: 10 },
        { header: 'Total Gross (INR)', key: 'totalGross', width: 22 },
        { header: 'Total Net (INR)', key: 'totalNet', width: 20 },
        { header: 'Paid', key: 'paid', width: 10 },
        { header: 'Pending / Other', key: 'pendingOther', width: 16 },
      ];
      rows.forEach((r) =>
        ws.addRow({
          name: r.name,
          count: r.count,
          totalGross: r.totalGross,
          totalNet: r.totalNet,
          paid: r.paid,
          pendingOther: r.pendingOther,
        })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `department-analysis-${fromDate}-to-${toDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  if (!canView) {
    return (
      <div className={dailyPageContainerClass}>
        <DailyPageHeader
          title="Department Analysis"
          description="Requisitions grouped by department."
          backHref="/daily-requisition/reports"
        />
        <Card className={dailySurfaceCardClass}>
          <CardHeader>
            <CardTitle>Access Restricted</CardTitle>
            <CardDescription>You do not have permission to view this report.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-6 h-20 w-full rounded-2xl" />
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className={dailyPageContainerClass}>
      <DailyPageHeader
        title="Department Analysis"
        description="Requisitions grouped by department for the selected date range."
        backHref="/daily-requisition/reports"
        eyebrow="Daily Requisition — Reports"
        actions={
          canExport ? (
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={isExporting || rows.length === 0}
              className="bg-white/80 hover:bg-white border-white/70"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? 'Exporting…' : 'Export Excel'}
            </Button>
          ) : null
        }
      />

      {/* Date filters */}
      <Card className="mb-4 overflow-hidden border border-white/70 bg-white/70 shadow-sm backdrop-blur">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-500" />
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-600">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40 bg-white/80 border-white/70"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-600">To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40 bg-white/80 border-white/70"
            />
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: 'Total Departments',
            value: totalDepts,
            gradient: 'from-emerald-500 to-teal-500',
          },
          {
            label: 'Total Entries',
            value: totalEntries,
            gradient: 'from-sky-500 to-cyan-500',
          },
          {
            label: 'Total Net Amount',
            value: formatCurrency(totalNet),
            gradient: 'from-violet-500 to-purple-600',
          },
          {
            label: 'Top Department',
            value: topDept ? topDept.name : '—',
            hint: topDept ? `${topDept.count} entries` : undefined,
            gradient: 'from-amber-500 to-orange-500',
          },
        ].map((card) => (
          <Card
            key={card.label}
            className="overflow-hidden border border-white/70 bg-white/70 shadow-sm backdrop-blur"
          >
            <div className={`h-1 w-full bg-gradient-to-r ${card.gradient}`} />
            <CardHeader className="pb-1 pt-3">
              <CardDescription className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                {card.label}
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-3">
              <p className="truncate text-xl font-semibold text-slate-900">{card.value}</p>
              {(card as { hint?: string }).hint ? (
                <p className="mt-0.5 text-xs text-slate-500">{(card as { hint?: string }).hint}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden border border-white/70 bg-white/70 shadow-sm backdrop-blur">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-500" />
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-emerald-500" />
            Department Breakdown
          </CardTitle>
          <CardDescription>
            {rows.length} department{rows.length !== 1 ? 's' : ''} · {totalEntries} entries in
            range
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              No entries found for the selected date range.
            </div>
          ) : (
            <div className="overflow-auto rounded-b-2xl border-t border-white/70 bg-white/80 h-[calc(100vh-420px)] [&_th]:sticky [&_th]:top-0 [&_th]:z-10">
              <table className="w-full caption-bottom text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 backdrop-blur">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Department
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Count
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Total Gross
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Total Net
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Paid
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Pending / Other
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.departmentId}
                      className="border-b border-slate-100 transition-colors hover:bg-emerald-50/60"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">{row.name}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="space-y-1">
                          <div className="text-slate-800">{row.count}</div>
                          <div className="ml-auto h-1.5 w-32 rounded-full bg-slate-100">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all"
                              style={{
                                width: `${maxCount > 0 ? (row.count / maxCount) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatCurrency(row.totalGross)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {formatCurrency(row.totalNet)}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-700">{row.paid}</td>
                      <td className="px-4 py-3 text-right text-amber-700">{row.pendingOther}</td>
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
