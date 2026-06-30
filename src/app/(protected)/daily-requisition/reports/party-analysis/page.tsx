'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Download, ShieldAlert } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DailyRequisitionEntry } from '@/lib/types';
import {
  DailyPageHeader,
  DailyMetricCard,
  dailyPageContainerClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

function entryDate(entry: DailyRequisitionEntry): Date {
  const d = entry.date;
  if (!d) return new Date(0);
  if (d instanceof Timestamp) return d.toDate();
  return new Date(d as string);
}

interface PartyRow {
  partyName: string;
  count: number;
  totalGross: number;
  totalNet: number;
  paidCount: number;
  avgNet: number;
}

export default function PartyAnalysisReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) { setIsLoading(false); return; }
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'dailyRequisitions'));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry)));
      } catch (err) {
        console.error('Failed to load daily requisitions for party analysis', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView]);

  const filtered = useMemo(() => {
    let items = entries;
    if (dateFrom) {
      const from = new Date(dateFrom);
      items = items.filter((e) => entryDate(e) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      items = items.filter((e) => entryDate(e) <= to);
    }
    return items;
  }, [entries, dateFrom, dateTo]);

  const rows = useMemo((): PartyRow[] => {
    const map = new Map<string, PartyRow>();
    filtered.forEach((e) => {
      const key = e.partyName || '(Unknown)';
      if (!map.has(key)) {
        map.set(key, { partyName: key, count: 0, totalGross: 0, totalNet: 0, paidCount: 0, avgNet: 0 });
      }
      const row = map.get(key)!;
      row.count += 1;
      row.totalGross += e.grossAmount || 0;
      row.totalNet += e.netAmount || 0;
      if (e.status === 'Paid') row.paidCount += 1;
    });
    const result = Array.from(map.values()).map((r) => ({
      ...r,
      avgNet: r.count > 0 ? r.totalNet / r.count : 0,
    }));
    result.sort((a, b) => b.totalNet - a.totalNet);
    return result;
  }, [filtered]);

  const maxNet = useMemo(() => rows.reduce((m, r) => Math.max(m, r.totalNet), 0), [rows]);
  const totalNet = useMemo(() => rows.reduce((s, r) => s + r.totalNet, 0), [rows]);
  const totalGross = useMemo(() => rows.reduce((s, r) => s + r.totalGross, 0), [rows]);
  const topParty = rows[0]?.partyName ?? '—';

  const exportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Party Analysis');
      ws.columns = [
        { header: 'Party Name', key: 'partyName', width: 30 },
        { header: 'Count', key: 'count', width: 10 },
        { header: 'Total Gross (INR)', key: 'totalGross', width: 20 },
        { header: 'Total Net (INR)', key: 'totalNet', width: 20 },
        { header: 'Paid Count', key: 'paidCount', width: 12 },
        { header: 'Avg Net (INR)', key: 'avgNet', width: 18 },
      ];
      rows.forEach((r) =>
        ws.addRow({
          partyName: r.partyName,
          count: r.count,
          totalGross: r.totalGross,
          totalNet: r.totalNet,
          paidCount: r.paidCount,
          avgNet: Math.round(r.avgNet),
        })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = dateFrom || dateTo ? `${dateFrom || 'all'}_to_${dateTo || 'all'}` : 'all';
      a.download = `party-analysis-${suffix}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-6 h-10 w-72" />
        <Skeleton className="mb-4 h-16 w-full rounded-2xl" />
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className={dailyPageContainerClass}>
        <DailyPageHeader
          title="Party Analysis"
          description="Group requisitions by party and compare volumes and values."
          backHref="/daily-requisition/reports"
        />
        <Card className={dailySurfaceCardClass}>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this report.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={dailyPageContainerClass}>
      <DailyPageHeader
        title="Party / Vendor Analysis"
        description="Group requisitions by party name — count, gross, net, and paid entries."
        backHref="/daily-requisition/reports"
        actions={
          <Button
            variant="outline"
            onClick={exportExcel}
            disabled={isExporting || rows.length === 0}
            className="bg-white/80 hover:bg-white border-white/70"
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? 'Exporting…' : 'Export Excel'}
          </Button>
        }
      />

      {/* Date range filter */}
      <Card className="mb-6 overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-sm backdrop-blur">
        <div className="h-1 w-full bg-gradient-to-r from-rose-400 via-pink-400 to-fuchsia-400 opacity-70" />
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">From</span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40 bg-white/80 border-white/70"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">To</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40 bg-white/80 border-white/70"
            />
          </div>
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="text-slate-500"
            >
              Clear
            </Button>
          )}
          <span className="ml-auto text-xs text-slate-500">
            {filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'} in range
          </span>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <DailyMetricCard label="Unique Parties" value={rows.length} />
        <DailyMetricCard label="Total Entries" value={filtered.length} />
        <DailyMetricCard label="Total Net Amount" value={fmt(totalNet)} />
        <DailyMetricCard label="Top Party" value={topParty} hint={rows[0] ? fmt(rows[0].totalNet) : undefined} />
      </div>

      {/* Table */}
      <Card className={`${dailySurfaceCardClass}`}>
        <div className="h-1 w-full bg-gradient-to-r from-rose-400 via-pink-400 to-fuchsia-400 opacity-70" />
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Party Breakdown</CardTitle>
          <CardDescription>Sorted by total net amount descending. Bar shows proportion of max.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No entries found for the selected date range.
            </div>
          ) : (
            <div className="overflow-auto [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200 h-[calc(100vh-420px)]">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-sm">
                  <TableRow>
                    <TableHead className="pl-4">Party Name</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Gross</TableHead>
                    <TableHead className="min-w-[180px]">Total Net</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right pr-4">Avg Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const pct = maxNet > 0 ? (row.totalNet / maxNet) * 100 : 0;
                    return (
                      <TableRow key={row.partyName} className="hover:bg-rose-50/40 transition-colors">
                        <TableCell className="pl-4 font-medium">{row.partyName}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(row.totalGross)}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <span className="tabular-nums">{fmt(row.totalNet)}</span>
                            <div className="h-1.5 w-full max-w-[160px] rounded-full bg-slate-100">
                              <div
                                className="h-1.5 rounded-full bg-gradient-to-r from-rose-400 to-pink-500 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.paidCount}</TableCell>
                        <TableCell className="text-right tabular-nums pr-4">{fmt(row.avgNet)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals row */}
                  <TableRow className="border-t-2 border-slate-200 bg-slate-50/80 font-semibold">
                    <TableCell className="pl-4">Total</TableCell>
                    <TableCell className="text-right tabular-nums">{filtered.length}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totalGross)}</TableCell>
                    <TableCell className="tabular-nums">{fmt(totalNet)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rows.reduce((s, r) => s + r.paidCount, 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums pr-4">—</TableCell>
                  </TableRow>
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
