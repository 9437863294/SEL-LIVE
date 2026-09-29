'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { CalendarClock, CalendarDays, ChevronLeft, Download, Minus, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { DailyRequisitionEntry } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import {
  KpiRow,
  ReportAccessDenied,
  ReportSkeleton,
  dateKeyOf,
  inr,
  inrWhole,
  localDateKey,
  round2,
} from '../_components/report-kit';

/** yyyy-MM of a local day. (`toISOString` gives the UTC day — for an Indian midnight on the 1st, the month before.) */
const monthKeyOf = (d: Date): string => localDateKey(d).slice(0, 7);

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-IN', { month: 'short', year: '2-digit' });
}

const DESCRIPTION = 'Volume and value of requisitions month-over-month — last 6 months.';

export default function MonthlyTrendReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');
  const canExport = can('Export', 'Daily Requisition.Reports') || can('Export', 'Daily Requisition.Entry Sheet') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);

  // Last 6 calendar months (oldest → newest), fixed when the page opens.
  const [months] = useState(() => {
    const base = new Date();
    return Array.from({ length: 6 }, (_, i) => monthKeyOf(new Date(base.getFullYear(), base.getMonth() - (5 - i), 1)));
  });

  useEffect(() => {
    // Until permissions load `can` answers false — wait for them rather than fetch without them.
    if (isAuthLoading || !canView) return;
    let active = true;
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, 'dailyRequisitions'));
        if (active) setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry)));
      } catch (err) {
        console.error('Failed to load monthly trend report', err);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [isAuthLoading, canView]);

  const currentMonth = months[months.length - 1];
  const prevMonth = months[months.length - 2];

  const trends = useMemo(() => {
    const byMonth = new Map<string, DailyRequisitionEntry[]>();
    for (const e of entries) {
      // `date` is a Firestore Timestamp on entries from the entry sheet and the importer.
      const month = dateKeyOf(e.date).slice(0, 7);
      if (!month) continue;
      const list = byMonth.get(month);
      if (list) list.push(e);
      else byMonth.set(month, [e]);
    }
    return months.map((m) => {
      const monthEntries = byMonth.get(m) ?? [];
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
      trends.forEach((r) =>
        ws.addRow({
          month: r.month,
          count: r.count,
          totalGross: round2(r.totalGross),
          totalNet: round2(r.totalNet),
          avgNet: round2(r.avgNet),
        })
      );
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

  if (isAuthLoading || (isLoading && canView)) return <ReportSkeleton filters={false} panel />;

  if (!canView) return <ReportAccessDenied title="Monthly Trend" description={DESCRIPTION} />;

  const rising = pctChange !== null && pctChange > 0;
  const falling = pctChange !== null && pctChange < 0;

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader
        title="Monthly Trend"
        description={DESCRIPTION}
        backHref="/daily-requisition/reports"
        eyebrow="Daily Requisition"
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

      <KpiRow>
        <KpiCard
          label="This month entries"
          value={currentTrend.count}
          hint={formatMonthLabel(currentMonth)}
          icon={CalendarDays}
          tone="violet"
          accent
        />
        <KpiCard
          label="This month net"
          value={inrWhole(currentTrend.totalNet)}
          hint={formatMonthLabel(currentMonth)}
          icon={Wallet}
          tone="cyan"
          accent
        />
        <KpiCard
          label="Previous month net"
          value={inrWhole(prevTrend.totalNet)}
          hint={formatMonthLabel(prevMonth)}
          icon={CalendarClock}
          tone="slate"
          accent
        />
        <KpiCard
          label="Month-on-month"
          value={pctChange !== null ? `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%` : 'N/A'}
          hint="Net vs previous month"
          icon={rising ? TrendingUp : falling ? TrendingDown : Minus}
          tone={rising ? 'rose' : 'emerald'}
          accent
        />
      </KpiRow>

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
              <div className="flex items-center justify-between gap-3 text-xs">
                <span
                  className={`w-16 shrink-0 font-semibold ${
                    row.month === currentMonth ? 'text-violet-600' : 'text-slate-500'
                  }`}
                >
                  {formatMonthLabel(row.month)}
                </span>
                <div className="flex min-w-0 flex-wrap justify-end gap-x-3 text-muted-foreground">
                  <span>{row.count} entries</span>
                  <span className="tabular-nums">{inrWhole(row.totalNet)}</span>
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
      <TableCard
        title="Month-by-Month Summary"
        description="Gross, net, and average net per entry for the last 6 months."
        scroll="natural"
      >
          {trends.every((r) => r.count === 0) ? (
            <div className="px-4 py-10 text-center text-muted-foreground">
              No requisition data found for the last 6 months.
            </div>
          ) : (
              <Table>
                <TableHeader>
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
                      className={row.month === currentMonth ? 'bg-violet-50/60' : undefined}
                    >
                      <TableCell className="whitespace-nowrap font-medium">
                        {formatMonthLabel(row.month)}
                        {row.month === currentMonth && (
                          <Badge variant="info" className="ml-2">
                            current
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.totalGross)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                        <div className="space-y-1">
                          <div>{inr(row.totalNet)}</div>
                          <div className="h-1.5 w-28 rounded-full bg-slate-100 ml-auto">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-sky-500 transition-all"
                              style={{ width: `${maxNet > 0 ? (row.totalNet / maxNet) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {row.count > 0 ? inr(row.avgNet) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          )}
      </TableCard>

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
