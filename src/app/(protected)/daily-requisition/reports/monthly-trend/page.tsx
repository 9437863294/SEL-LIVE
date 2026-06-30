'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { ChevronLeft, Download, TrendingUp } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { DailyRequisitionEntry } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DailyPageHeader, dailyPageContainerClass } from '@/components/daily-requisition/module-shell';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

function entryMonth(entry: DailyRequisitionEntry): string {
  if (entry.date instanceof Timestamp) return entry.date.toDate().toISOString().slice(0, 7);
  return String(entry.date || '').slice(0, 7);
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-IN', { month: 'short', year: '2-digit' });
}

export default function MonthlyTrendReportPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');
  const canExport = can('Export', 'Daily Requisition.Reports') || can('Export', 'Daily Requisition.Entry Sheet') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'dailyRequisitions'));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry)));
      } catch (err) {
        console.error('Failed to load monthly trend report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Last 6 calendar months (oldest → newest)
  const months = useMemo(() => {
    const base = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(base.getFullYear(), base.getMonth() - (5 - i), 1);
      return d.toISOString().slice(0, 7);
    });
  }, []);

  const currentMonth = months[months.length - 1];
  const prevMonth = months[months.length - 2];

  const trends = useMemo(() => {
    return months.map((m) => {
      const monthEntries = entries.filter((e) => entryMonth(e) === m);
      const count = monthEntries.length;
      const totalGross = monthEntries.reduce((s, e) => s + Number(e.grossAmount || 0), 0);
      const totalNet = monthEntries.reduce((s, e) => s + Number(e.netAmount || 0), 0);
      const avgNet = count > 0 ? totalNet / count : 0;
      return { month: m, count, totalGross, totalNet, avgNet };
    });
  }, [months, entries]);

  const maxCount = useMemo(() => trends.reduce((mx, r) => Math.max(mx, r.count), 0), [trends]);
  const maxNet = useMemo(() => trends.reduce((mx, r) => Math.max(mx, r.totalNet), 0), [trends]);

  const EMPTY = { month: '', count: 0, totalGross: 0, totalNet: 0, avgNet: 0 };
  const currentTrend = trends[trends.length - 1] ?? EMPTY;
  const prevTrend = trends[trends.length - 2] ?? EMPTY;

  const pctChange =
    prevTrend.totalNet > 0
      ? ((currentTrend.totalNet - prevTrend.totalNet) / prevTrend.totalNet) * 100
      : null;

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Monthly Trend');
      ws.columns = [
        { header: 'Month', key: 'month', width: 14 },
        { header: 'Count', key: 'count', width: 10 },
        { header: 'Total Gross (INR)', key: 'totalGross', width: 22 },
        { header: 'Total Net (INR)', key: 'totalNet', width: 20 },
        { header: 'Avg Net (INR)', key: 'avgNet', width: 18 },
      ];
      trends.forEach((r) => ws.addRow({ ...r, avgNet: Math.round(r.avgNet) }));
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily-requisition-monthly-trend.xlsx`;
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
        <Card className="border border-white/70 bg-white/70 backdrop-blur">
          <CardHeader>
            <CardTitle>Access Restricted</CardTitle>
            <CardDescription>You do not have permission to view reports.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={dailyPageContainerClass}>
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className={dailyPageContainerClass}>
      <DailyPageHeader
        title="Monthly Trend"
        description="Volume and value of requisitions month-over-month — last 6 months."
        backHref="/daily-requisition/reports"
        eyebrow="Reports"
        actions={
          canExport ? (
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={isExporting}
              className="bg-white/80 hover:bg-white border-white/70"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? 'Exporting...' : 'Export Excel'}
            </Button>
          ) : null
        }
      />

      {/* Stat cards */}
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Card className="overflow-hidden border border-white/70 bg-white/70 backdrop-blur shadow-sm">
          <div className="h-1 w-full bg-gradient-to-r from-violet-500/80 to-purple-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>This Month Count</CardDescription>
            <CardTitle className="text-xl">{currentTrend.count}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{currentMonth}</CardContent>
        </Card>

        <Card className="overflow-hidden border border-white/70 bg-white/70 backdrop-blur shadow-sm">
          <div className="h-1 w-full bg-gradient-to-r from-cyan-500/80 to-sky-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>This Month Net Amount</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(currentTrend.totalNet)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{currentMonth}</CardContent>
        </Card>

        <Card className="overflow-hidden border border-white/70 bg-white/70 backdrop-blur shadow-sm">
          <div className="h-1 w-full bg-gradient-to-r from-slate-400/80 to-slate-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Prev Month Amount</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(prevTrend.totalNet)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{prevMonth}</CardContent>
        </Card>

        <Card className="overflow-hidden border border-white/70 bg-white/70 backdrop-blur shadow-sm">
          <div
            className={`h-1 w-full bg-gradient-to-r ${
              pctChange !== null && pctChange > 0
                ? 'from-rose-500/80 to-orange-500/80'
                : 'from-emerald-500/80 to-teal-500/80'
            }`}
          />
          <CardHeader className="pb-2">
            <CardDescription>Month-on-Month Change</CardDescription>
            <CardTitle
              className={`text-xl ${
                pctChange !== null && pctChange > 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              {pctChange !== null
                ? `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`
                : 'N/A'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">vs previous month</CardContent>
        </Card>
      </div>

      {/* 6-month bar visualisation */}
      <Card className="mb-5 overflow-hidden border border-white/70 bg-white/70 backdrop-blur shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-violet-500" />
            <CardTitle className="text-base">6-Month Trend</CardTitle>
          </div>
          <CardDescription>
            Count (violet) and Net Amount (cyan) — stacked bars scaled to monthly maximum.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {trends.map((row) => (
            <div key={row.month} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span
                  className={`w-16 font-semibold ${
                    row.month === currentMonth ? 'text-violet-600' : 'text-slate-500'
                  }`}
                >
                  {formatMonthLabel(row.month)}
                </span>
                <div className="flex gap-3 text-muted-foreground">
                  <span>{row.count} entries</span>
                  <span>{formatCurrency(row.totalNet)}</span>
                </div>
              </div>
              {/* Count bar */}
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-500"
                  style={{ width: `${maxCount > 0 ? (row.count / maxCount) * 100 : 0}%` }}
                />
              </div>
              {/* Net amount bar */}
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-sky-500 transition-all duration-500"
                  style={{ width: `${maxNet > 0 ? (row.totalNet / maxNet) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-4 pt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500" /> Count
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-500" /> Net Amount
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Summary table */}
      <Card className="overflow-hidden border border-white/70 bg-white/70 backdrop-blur shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Month-by-Month Summary</CardTitle>
          <CardDescription>Gross, net, and average net per entry for the last 6 months.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {trends.every((r) => r.count === 0) ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-4 py-10 text-center text-muted-foreground">
              No requisition data found for the last 6 months.
            </div>
          ) : (
            <div className="overflow-auto h-[calc(100vh-420px)] rounded-lg border border-white/70 bg-white/80">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-sm">
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Gross</TableHead>
                    <TableHead className="text-right">Total Net</TableHead>
                    <TableHead className="text-right">Avg Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trends.map((row) => (
                    <TableRow
                      key={row.month}
                      className={`transition-colors ${
                        row.month === currentMonth
                          ? 'bg-violet-50/60 hover:bg-violet-50/90'
                          : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <TableCell>
                        <span
                          className={`font-medium ${
                            row.month === currentMonth ? 'text-violet-700' : ''
                          }`}
                        >
                          {formatMonthLabel(row.month)}
                          {row.month === currentMonth && (
                            <span className="ml-2 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
                              current
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.totalGross)}</TableCell>
                      <TableCell className="text-right font-medium">
                        <div className="space-y-1">
                          <div>{formatCurrency(row.totalNet)}</div>
                          <div className="h-1.5 w-28 rounded-full bg-slate-100 ml-auto">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-sky-500 transition-all"
                              style={{ width: `${maxNet > 0 ? (row.totalNet / maxNet) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {row.count > 0 ? formatCurrency(row.avgNet) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        <Link
          href="/daily-requisition/reports"
          className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back to Reports
        </Link>
      </p>
    </div>
  );
}
