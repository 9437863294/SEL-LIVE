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
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DailyRequisitionEntry } from '@/lib/types';
import {
  DailyPageHeader,
  DailyMetricCard,
  dailyPageContainerClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';

const CLOSED_STATUSES: DailyRequisitionEntry['status'][] = ['Paid', 'Cancelled'];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const ageInDays = (ts: Timestamp | string | undefined): number => {
  if (!ts) return 0;
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts as string);
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
};

interface AgeBracket {
  label: string;
  min: number;
  max: number;
  color: string;
  bgColor: string;
  badgeClass: string;
  barClass: string;
}

const BRACKETS: AgeBracket[] = [
  {
    label: '0–3 days',
    min: 0,
    max: 3,
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50 border-emerald-200',
    badgeClass: 'bg-emerald-100 text-emerald-700',
    barClass: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
  },
  {
    label: '4–7 days',
    min: 4,
    max: 7,
    color: 'text-sky-700',
    bgColor: 'bg-sky-50 border-sky-200',
    badgeClass: 'bg-sky-100 text-sky-700',
    barClass: 'bg-gradient-to-r from-sky-400 to-sky-500',
  },
  {
    label: '8–15 days',
    min: 8,
    max: 15,
    color: 'text-amber-700',
    bgColor: 'bg-amber-50 border-amber-200',
    badgeClass: 'bg-amber-100 text-amber-700',
    barClass: 'bg-gradient-to-r from-amber-400 to-amber-500',
  },
  {
    label: '16–30 days',
    min: 16,
    max: 30,
    color: 'text-orange-700',
    bgColor: 'bg-orange-50 border-orange-200',
    badgeClass: 'bg-orange-100 text-orange-700',
    barClass: 'bg-gradient-to-r from-orange-400 to-orange-500',
  },
  {
    label: '30+ days',
    min: 31,
    max: Infinity,
    color: 'text-rose-700',
    bgColor: 'bg-rose-50 border-rose-200',
    badgeClass: 'bg-rose-100 text-rose-700',
    barClass: 'bg-gradient-to-r from-rose-400 to-rose-500',
  },
];

function getBracket(age: number): AgeBracket {
  return BRACKETS.find((b) => age >= b.min && age <= b.max) ?? BRACKETS[BRACKETS.length - 1];
}

interface AgeingRow {
  entry: DailyRequisitionEntry;
  age: number;
  bracket: AgeBracket;
}

export default function AgeingReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) { setIsLoading(false); return; }
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'dailyRequisitions'));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry)));
      } catch (err) {
        console.error('Failed to load daily requisitions for ageing report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView]);

  const rows = useMemo((): AgeingRow[] => {
    const open = entries.filter((e) => !CLOSED_STATUSES.includes(e.status));
    return open
      .map((e) => {
        const age = ageInDays(e.createdAt);
        return { entry: e, age, bracket: getBracket(age) };
      })
      .sort((a, b) => b.age - a.age);
  }, [entries]);

  const totalOpen = rows.length;
  const critical = rows.filter((r) => r.age > 30).length;
  const avgAge = totalOpen > 0 ? Math.round(rows.reduce((s, r) => s + r.age, 0) / totalOpen) : 0;
  const oldestAge = rows[0]?.age ?? 0;

  const bracketCounts = useMemo(() => {
    const map = new Map<string, number>();
    BRACKETS.forEach((b) => map.set(b.label, 0));
    rows.forEach((r) => map.set(r.bracket.label, (map.get(r.bracket.label) ?? 0) + 1));
    return map;
  }, [rows]);

  const formatDate = (ts: Timestamp | undefined): string => {
    if (!ts) return '—';
    const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const exportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Ageing Report');
      ws.columns = [
        { header: 'Reception No', key: 'receptionNo', width: 18 },
        { header: 'Party Name', key: 'partyName', width: 26 },
        { header: 'Department', key: 'departmentId', width: 18 },
        { header: 'Status', key: 'status', width: 22 },
        { header: 'Created Date', key: 'createdDate', width: 16 },
        { header: 'Age (days)', key: 'age', width: 12 },
        { header: 'Net Amount (INR)', key: 'netAmount', width: 18 },
        { header: 'Age Bracket', key: 'bracket', width: 14 },
      ];
      rows.forEach((r) =>
        ws.addRow({
          receptionNo: r.entry.receptionNo,
          partyName: r.entry.partyName,
          departmentId: r.entry.departmentId,
          status: r.entry.status,
          createdDate: r.entry.createdAt instanceof Timestamp
            ? r.entry.createdAt.toDate().toLocaleDateString('en-IN')
            : '—',
          age: r.age,
          netAmount: r.entry.netAmount || 0,
          bracket: r.bracket.label,
        })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ageing-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className={dailyPageContainerClass}>
        <DailyPageHeader
          title="Ageing Report"
          description="Open requisitions bucketed by age — spot what is stuck and for how long."
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
        title="Ageing Report"
        description="Open requisitions (excluding Paid and Cancelled) sorted by age — oldest first. Live snapshot, no date filter."
        backHref="/daily-requisition/reports"
        meta={
          <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-slate-600 backdrop-blur">
            Live — as of today
          </span>
        }
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

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <DailyMetricCard label="Total Open" value={totalOpen} />
        <DailyMetricCard
          label="Critical (30+ days)"
          value={critical}
          hint={totalOpen > 0 ? `${Math.round((critical / totalOpen) * 100)}% of open` : undefined}
        />
        <DailyMetricCard label="Average Age" value={`${avgAge} days`} />
        <DailyMetricCard label="Oldest Entry" value={`${oldestAge} days`} />
      </div>

      {/* Bracket summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {BRACKETS.map((b) => {
          const count = bracketCounts.get(b.label) ?? 0;
          return (
            <div
              key={b.label}
              className={`flex flex-col rounded-2xl border p-4 shadow-sm backdrop-blur ${b.bgColor}`}
            >
              <span className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${b.color}`}>
                {b.label}
              </span>
              <span className={`mt-2 text-3xl font-bold ${b.color}`}>{count}</span>
              <span className={`mt-1 text-xs ${b.color} opacity-70`}>
                entr{count === 1 ? 'y' : 'ies'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Ageing table */}
      <Card className={dailySurfaceCardClass}>
        <div className="h-1 w-full bg-gradient-to-r from-red-400 via-rose-400 to-pink-400 opacity-70" />
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Open Requisitions</CardTitle>
          <CardDescription>Sorted oldest first. Age calculated from created date to today.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No open requisitions found — everything is up to date.
            </div>
          ) : (
            <div className="overflow-auto [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200 h-[calc(100vh-420px)]">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-sm">
                  <TableRow>
                    <TableHead className="pl-4 min-w-[120px]">Reception No</TableHead>
                    <TableHead className="min-w-[160px]">Party</TableHead>
                    <TableHead className="min-w-[130px]">Department</TableHead>
                    <TableHead className="min-w-[160px]">Status</TableHead>
                    <TableHead className="min-w-[120px]">Created Date</TableHead>
                    <TableHead className="text-right min-w-[90px]">Age (days)</TableHead>
                    <TableHead className="text-right min-w-[120px] pr-4">Net Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ entry: e, age, bracket }) => (
                    <TableRow key={e.id} className="hover:bg-slate-50/60 transition-colors">
                      <TableCell className="pl-4 font-mono text-xs">{e.receptionNo}</TableCell>
                      <TableCell className="font-medium">{e.partyName}</TableCell>
                      <TableCell className="text-slate-600 text-xs">{e.departmentId || '—'}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${bracket.badgeClass}`}>
                          {e.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-slate-600">{formatDate(e.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <span className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${bracket.badgeClass}`}>
                          {age}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums pr-4">{fmt(e.netAmount || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
