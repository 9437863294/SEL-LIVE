'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { BarChart3, ChevronLeft, Download } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { DailyRequisitionEntry } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DAILY_STATUS_TONE, dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const STATUS_LIST = [
  'Paid',
  'Received for Payment',
  'Verified',
  'Received',
  'Needs Review',
  'Pending',
  'Cancelled',
] as const;


const STATUS_GRADIENT: Record<string, string> = {
  Paid: 'from-emerald-500 to-teal-500',
  Verified: 'from-cyan-500 to-sky-400',
  'Received for Payment': 'from-sky-500 to-blue-500',
  Received: 'from-blue-500 to-indigo-500',
  Pending: 'from-amber-400 to-yellow-500',
  'Needs Review': 'from-orange-400 to-amber-500',
  Cancelled: 'from-rose-500 to-pink-500',
};

function entryDateKey(entry: DailyRequisitionEntry): string {
  if (entry.date instanceof Timestamp) return entry.date.toDate().toISOString().slice(0, 10);
  return String(entry.date || '').slice(0, 10);
}

export default function StatusOverviewReportPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');
  const canExport = can('Export', 'Daily Requisition.Reports') || can('Export', 'Daily Requisition.Entry Sheet') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'dailyRequisitions'));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry)));
      } catch (err) {
        console.error('Failed to load status overview report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const key = entryDateKey(e);
      if (dateFrom && key < dateFrom) return false;
      if (dateTo && key > dateTo) return false;
      return true;
    });
  }, [entries, dateFrom, dateTo]);

  const stats = useMemo(() => {
    const map: Record<string, { count: number; totalNet: number }> = {};
    for (const s of STATUS_LIST) {
      map[s] = { count: 0, totalNet: 0 };
    }
    for (const e of filtered) {
      const s = e.status || 'Pending';
      if (map[s]) {
        map[s].count += 1;
        map[s].totalNet += Number(e.netAmount || 0);
      }
    }
    return map;
  }, [filtered]);

  const grandTotal = useMemo(
    () => STATUS_LIST.reduce((sum, s) => sum + stats[s].totalNet, 0),
    [stats]
  );
  const grandCount = useMemo(
    () => STATUS_LIST.reduce((sum, s) => sum + stats[s].count, 0),
    [stats]
  );

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Status Overview');
      ws.columns = [
        { header: 'Status', key: 'status', width: 24 },
        { header: 'Count', key: 'count', width: 10 },
        { header: 'Total Net Amount (INR)', key: 'totalNet', width: 26 },
        { header: '% of Total', key: 'pct', width: 14 },
      ];
      for (const s of STATUS_LIST) {
        const row = stats[s];
        ws.addRow({
          status: s,
          count: row.count,
          totalNet: row.totalNet,
          pct: grandTotal > 0 ? Number(((row.totalNet / grandTotal) * 100).toFixed(1)) : 0,
        });
      }
      ws.addRow({});
      ws.addRow({ status: 'Total', count: grandCount, totalNet: grandTotal, pct: 100 });

      const ws2 = wb.addWorksheet('All Entries');
      ws2.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Reception No', key: 'receptionNo', width: 18 },
        { header: 'Party', key: 'partyName', width: 28 },
        { header: 'Status', key: 'status', width: 20 },
        { header: 'Gross Amount', key: 'grossAmount', width: 18 },
        { header: 'Net Amount', key: 'netAmount', width: 16 },
      ];
      filtered.forEach((e) =>
        ws2.addRow({
          date: entryDateKey(e),
          receptionNo: e.receptionNo || '',
          partyName: e.partyName || '',
          status: e.status || '',
          grossAmount: Number(e.grossAmount || 0),
          netAmount: Number(e.netAmount || 0),
        })
      );

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily-requisition-status-overview.xlsx`;
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7">
            {STATUS_LIST.map((s) => (
              <Skeleton key={s} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader
        title="Status Overview"
        description="Count and total net amounts by requisition status across the pipeline."
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

      {/* Date range filter */}
      <FilterBar
        className="mb-5"
        activeCount={(dateFrom ? 1 : 0) + (dateTo ? 1 : 0)}
        onClear={() => { setDateFrom(''); setDateTo(''); }}
        summary={`${filtered.length} of ${entries.length} entries`}
      >
        <label className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">From</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">To</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
      </FilterBar>

      {/* Stat cards — one per status */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {STATUS_LIST.map((s) => {
          const { count, totalNet } = stats[s];
          return (
            <Card key={s} className="overflow-hidden border border-white/70 bg-white/70 backdrop-blur shadow-sm">
              <div className={`h-1 w-full bg-gradient-to-r ${STATUS_GRADIENT[s]}`} />
              <CardHeader className="pb-1 pt-3 px-3">
                <CardDescription className="text-[11px]">
                  <StatusBadge status={s} tone={DAILY_STATUS_TONE[s]}>{s}</StatusBadge>
                </CardDescription>
                <CardTitle className="mt-1 text-xl leading-none">{count}</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 text-xs text-muted-foreground">
                {formatCurrency(totalNet)}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Summary table */}
      <TableCard
        icon={BarChart3}
        title="Summary by Status"
        description={<>{grandCount} total entries · {formatCurrency(grandTotal)} total net amount</>}
        scroll="natural"
      >
          {grandCount === 0 ? (
            <div className="px-4 py-10 text-center text-muted-foreground">
              No data found for selected date range.
            </div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">Status</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Net Amount</TableHead>
                    <TableHead className="text-right">% of Total</TableHead>
                    <TableHead className="w-40">Distribution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {STATUS_LIST.map((s) => {
                    const { count, totalNet } = stats[s];
                    const pct = grandTotal > 0 ? (totalNet / grandTotal) * 100 : 0;
                    return (
                      <TableRow key={s}>
                        <TableCell className="whitespace-nowrap">
                          <StatusBadge status={s} tone={DAILY_STATUS_TONE[s]}>{s}</StatusBadge>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{count}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(totalNet)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pct.toFixed(1)}%
                        </TableCell>
                        <TableCell>
                          <div className="h-2 w-full rounded-full bg-slate-100">
                            <div
                              className={`h-2 rounded-full bg-gradient-to-r ${STATUS_GRADIENT[s]} transition-all duration-500`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{grandCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(grandTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">100%</TableCell>
                    <TableCell />
                  </TableRow>
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
