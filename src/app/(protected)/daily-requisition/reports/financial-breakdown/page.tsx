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

const VERIFIED_STATUSES: DailyRequisitionEntry['status'][] = [
  'Verified',
  'Received for Payment',
  'Paid',
];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const fmtPct = (n: number, total: number) =>
  total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '0.0%';

function entryDate(entry: DailyRequisitionEntry): Date {
  const d = entry.date;
  if (!d) return new Date(0);
  if (d instanceof Timestamp) return d.toDate();
  return new Date(d as string);
}

export default function FinancialBreakdownReportPage() {
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
        console.error('Failed to load daily requisitions for financial breakdown', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView]);

  const verified = useMemo(
    () => entries.filter((e) => VERIFIED_STATUSES.includes(e.status)),
    [entries]
  );

  const filtered = useMemo(() => {
    let items = verified;
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
  }, [verified, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const t = {
      gross: 0, net: 0,
      igst: 0, cgst: 0, sgst: 0,
      tds: 0, retention: 0, other: 0,
    };
    filtered.forEach((e) => {
      t.gross += e.grossAmount || 0;
      t.net += e.netAmount || 0;
      t.igst += e.igstAmount || 0;
      t.cgst += e.cgstAmount || 0;
      t.sgst += e.sgstAmount || 0;
      t.tds += e.tdsAmount || 0;
      t.retention += e.retentionAmount || 0;
      t.other += e.otherDeduction || 0;
    });
    return t;
  }, [filtered]);

  const totalDeductions = totals.gross - totals.net;

  const deductionRows = [
    { label: 'IGST', value: totals.igst },
    { label: 'CGST', value: totals.cgst },
    { label: 'SGST', value: totals.sgst },
    { label: 'TDS', value: totals.tds },
    { label: 'Retention', value: totals.retention },
    { label: 'Other Deductions', value: totals.other },
  ];

  const exportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();

      // Sheet 1: Summary
      const wsSummary = wb.addWorksheet('Deduction Summary');
      wsSummary.columns = [
        { header: 'Deduction Type', key: 'label', width: 24 },
        { header: 'Total Amount (INR)', key: 'value', width: 22 },
        { header: '% of Gross', key: 'pct', width: 14 },
      ];
      deductionRows.forEach((r) =>
        wsSummary.addRow({ label: r.label, value: r.value, pct: fmtPct(r.value, totals.gross) })
      );
      wsSummary.addRow({});
      wsSummary.addRow({ label: 'Total Gross', value: totals.gross, pct: '100.0%' });
      wsSummary.addRow({ label: 'Total Net', value: totals.net, pct: fmtPct(totals.net, totals.gross) });
      wsSummary.addRow({ label: 'Total Deductions', value: totalDeductions, pct: fmtPct(totalDeductions, totals.gross) });

      // Sheet 2: Detail
      const wsDetail = wb.addWorksheet('Entries');
      wsDetail.columns = [
        { header: 'Reception No', key: 'receptionNo', width: 18 },
        { header: 'Party Name', key: 'partyName', width: 26 },
        { header: 'Gross (INR)', key: 'gross', width: 16 },
        { header: 'Net (INR)', key: 'net', width: 16 },
        { header: 'IGST (INR)', key: 'igst', width: 14 },
        { header: 'CGST (INR)', key: 'cgst', width: 14 },
        { header: 'SGST (INR)', key: 'sgst', width: 14 },
        { header: 'TDS (INR)', key: 'tds', width: 14 },
        { header: 'Retention (INR)', key: 'retention', width: 16 },
        { header: 'Other (INR)', key: 'other', width: 14 },
      ];
      filtered.forEach((e) =>
        wsDetail.addRow({
          receptionNo: e.receptionNo,
          partyName: e.partyName,
          gross: e.grossAmount || 0,
          net: e.netAmount || 0,
          igst: e.igstAmount || 0,
          cgst: e.cgstAmount || 0,
          sgst: e.sgstAmount || 0,
          tds: e.tdsAmount || 0,
          retention: e.retentionAmount || 0,
          other: e.otherDeduction || 0,
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
      a.download = `financial-breakdown-${suffix}.xlsx`;
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
        <Skeleton className="mb-4 h-64 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className={dailyPageContainerClass}>
        <DailyPageHeader
          title="Financial Breakdown"
          description="Gross vs net with full deduction split across verified entries."
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
        title="Financial Breakdown"
        description="Gross vs net analysis with full deduction split — GST, TDS, retention, and other charges. Only Verified, Received for Payment, and Paid entries."
        backHref="/daily-requisition/reports"
        actions={
          <Button
            variant="outline"
            onClick={exportExcel}
            disabled={isExporting || filtered.length === 0}
            className="bg-white/80 hover:bg-white border-white/70"
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? 'Exporting…' : 'Export Excel'}
          </Button>
        }
      />

      {/* Date range filter */}
      <Card className="mb-6 overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-sm backdrop-blur">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-400 via-blue-400 to-cyan-400 opacity-70" />
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
            {filtered.length} verified entr{filtered.length === 1 ? 'y' : 'ies'} in range
          </span>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <DailyMetricCard label="Total Entries" value={filtered.length} />
        <DailyMetricCard label="Total Gross" value={fmt(totals.gross)} />
        <DailyMetricCard label="Total Net" value={fmt(totals.net)} />
        <DailyMetricCard
          label="Total Deductions"
          value={fmt(totalDeductions)}
          hint={fmtPct(totalDeductions, totals.gross) + ' of gross'}
        />
      </div>

      {/* Deduction breakdown */}
      <Card className={`${dailySurfaceCardClass} mb-6`}>
        <div className="h-1 w-full bg-gradient-to-r from-indigo-400 via-blue-400 to-cyan-400 opacity-70" />
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Deduction Breakdown</CardTitle>
          <CardDescription>Each deduction component as a share of total gross.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {deductionRows.map((row) => {
              const pct = totals.gross > 0 ? (row.value / totals.gross) * 100 : 0;
              return (
                <div key={row.label} className="grid grid-cols-[140px_1fr_80px_80px] items-center gap-3">
                  <span className="text-sm font-medium text-slate-700">{row.label}</span>
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-indigo-400 to-blue-500 transition-all"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-right text-xs tabular-nums text-slate-500">{fmtPct(row.value, totals.gross)}</span>
                  <span className="text-right text-sm tabular-nums font-medium">{fmt(row.value)}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Full detail table */}
      <Card className={dailySurfaceCardClass}>
        <div className="h-1 w-full bg-gradient-to-r from-indigo-400 via-blue-400 to-cyan-400 opacity-70" />
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Entry-level Detail</CardTitle>
          <CardDescription>Full deduction breakdown per requisition entry.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No verified entries found for the selected date range.
            </div>
          ) : (
            <div className="overflow-auto [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200 h-[calc(100vh-420px)]">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-sm">
                  <TableRow>
                    <TableHead className="pl-4 min-w-[120px]">Reception No</TableHead>
                    <TableHead className="min-w-[160px]">Party</TableHead>
                    <TableHead className="text-right min-w-[110px]">Gross</TableHead>
                    <TableHead className="text-right min-w-[110px]">Net</TableHead>
                    <TableHead className="text-right min-w-[90px]">IGST</TableHead>
                    <TableHead className="text-right min-w-[90px]">CGST</TableHead>
                    <TableHead className="text-right min-w-[90px]">SGST</TableHead>
                    <TableHead className="text-right min-w-[90px]">TDS</TableHead>
                    <TableHead className="text-right min-w-[100px]">Retention</TableHead>
                    <TableHead className="text-right min-w-[90px] pr-4">Other</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => (
                    <TableRow key={e.id} className="hover:bg-indigo-50/40 transition-colors">
                      <TableCell className="pl-4 font-mono text-xs">{e.receptionNo}</TableCell>
                      <TableCell className="font-medium">{e.partyName}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(e.grossAmount || 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(e.netAmount || 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">{fmt(e.igstAmount || 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">{fmt(e.cgstAmount || 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">{fmt(e.sgstAmount || 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">{fmt(e.tdsAmount || 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">{fmt(e.retentionAmount || 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600 pr-4">{fmt(e.otherDeduction || 0)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="border-t-2 border-slate-200 bg-slate-50/80 font-semibold">
                    <TableCell className="pl-4" colSpan={2}>Total ({filtered.length} entries)</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.gross)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.net)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.igst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.cgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.sgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.tds)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.retention)}</TableCell>
                    <TableCell className="text-right tabular-nums pr-4">{fmt(totals.other)}</TableCell>
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
