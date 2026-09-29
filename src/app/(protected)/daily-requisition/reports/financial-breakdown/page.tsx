'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Banknote, Download, FileText, Receipt, Wallet } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilterBar } from '@/components/shared/filter-bar';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import type { DailyRequisitionEntry } from '@/lib/types';
import {
  dailyPageContainerClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import {
  KpiRow,
  ReportAccessDenied,
  ReportSkeleton,
  dateKeyOf,
  inDateRange,
  inr,
  inrWhole,
  pctOf,
} from '../_components/report-kit';

/** Verified and on: GST / TDS have been checked, and the entry is payable, part paid or paid. */
const VERIFIED_STATUSES: readonly string[] = [
  'Verified',
  'Received for Payment',
  'Partially Paid',
  'Paid',
];

export default function FinancialBreakdownReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    // Until permissions load `can` answers false — wait for them rather than fetch without them.
    if (isAuthLoading || !canView) return;
    let active = true;
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, 'dailyRequisitions'));
        if (active) setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry)));
      } catch (err) {
        console.error('Failed to load daily requisitions for financial breakdown', err);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [isAuthLoading, canView]);

  const verified = useMemo(
    () => entries.filter((e) => VERIFIED_STATUSES.includes(e.status)),
    [entries]
  );

  const filtered = useMemo(
    () => verified.filter((e) => inDateRange(dateKeyOf(e.date), dateFrom, dateTo)),
    [verified, dateFrom, dateTo]
  );

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
  const partPaid = useMemo(() => filtered.filter((e) => e.status === 'Partially Paid').length, [filtered]);

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
        wsSummary.addRow({ label: r.label, value: r.value, pct: pctOf(r.value, totals.gross) })
      );
      wsSummary.addRow({});
      wsSummary.addRow({ label: 'Total Gross', value: totals.gross, pct: '100.0%' });
      wsSummary.addRow({ label: 'Total Net', value: totals.net, pct: pctOf(totals.net, totals.gross) });
      wsSummary.addRow({ label: 'Total Deductions', value: totalDeductions, pct: pctOf(totalDeductions, totals.gross) });

      // Sheet 2: Detail
      const wsDetail = wb.addWorksheet('Entries');
      wsDetail.columns = [
        { header: 'Reception No', key: 'receptionNo', width: 18 },
        { header: 'Party Name', key: 'partyName', width: 26 },
        { header: 'Status', key: 'status', width: 20 },
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
          status: e.status,
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

  if (isAuthLoading || (isLoading && canView)) return <ReportSkeleton panel />;

  if (!canView) {
    return (
      <ReportAccessDenied
        title="Financial Breakdown"
        description="Gross vs net with full deduction split across verified entries."
      />
    );
  }

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader eyebrow="Daily Requisition"
        title="Financial Breakdown"
        description="Gross vs net analysis with full deduction split — GST, TDS, retention, and other charges. Only Verified, Received for Payment, Partially Paid and Paid entries."
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
      <FilterBar
        className="mb-6"
        activeCount={(dateFrom ? 1 : 0) + (dateTo ? 1 : 0)}
        onClear={() => { setDateFrom(''); setDateTo(''); }}
        summary={`${filtered.length} verified entr${filtered.length === 1 ? 'y' : 'ies'} in range`}
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

      <KpiRow>
        <KpiCard
          label="Verified entries"
          value={filtered.length}
          hint={partPaid > 0 ? `${partPaid} part paid` : 'Verified through paid'}
          icon={FileText}
          tone="indigo"
          accent
        />
        <KpiCard label="Total gross" value={inrWhole(totals.gross)} icon={Wallet} tone="blue" accent />
        <KpiCard label="Total net" value={inrWhole(totals.net)} hint={`${pctOf(totals.net, totals.gross)} of gross`} icon={Banknote} tone="emerald" accent />
        <KpiCard
          label="Total deductions"
          value={inrWhole(totalDeductions)}
          hint={`${pctOf(totalDeductions, totals.gross)} of gross`}
          icon={Receipt}
          tone="rose"
          accent
        />
      </KpiRow>

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
                // A phone gets two lines — label and amount, then the bar and its share; from `sm`
                // one line: label, bar, share, amount.
                <div
                  key={row.label}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[140px_minmax(0,1fr)_64px_144px]"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-slate-700 sm:order-1">{row.label}</span>
                  <span className="whitespace-nowrap text-right text-sm tabular-nums font-medium sm:order-4">{inr(row.value)}</span>
                  <div className="h-2 w-full rounded-full bg-slate-100 sm:order-2">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-indigo-400 to-blue-500 transition-all"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-right text-xs tabular-nums text-slate-500 sm:order-3">{pctOf(row.value, totals.gross)}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Full detail table */}
      <TableCard
        title="Entry-level Detail"
        description="Full deduction breakdown per requisition entry."
      >
          {filtered.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No verified entries found for the selected date range.
            </div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px]">Reception No</TableHead>
                    <TableHead className="min-w-[160px]">Party</TableHead>
                    <TableHead className="text-right min-w-[120px]">Gross</TableHead>
                    <TableHead className="text-right min-w-[120px]">Net</TableHead>
                    <TableHead className="text-right min-w-[100px]">IGST</TableHead>
                    <TableHead className="text-right min-w-[100px]">CGST</TableHead>
                    <TableHead className="text-right min-w-[100px]">SGST</TableHead>
                    <TableHead className="text-right min-w-[100px]">TDS</TableHead>
                    <TableHead className="text-right min-w-[110px]">Retention</TableHead>
                    <TableHead className="text-right min-w-[100px]">Other</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap font-mono">{e.receptionNo}</TableCell>
                      <TableCell className="font-medium">{e.partyName}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(e.grossAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(e.netAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(e.igstAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(e.cgstAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(e.sgstAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(e.tdsAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(e.retentionAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(e.otherDeduction)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell colSpan={2}>Total ({filtered.length} entries)</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.gross)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.net)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.igst)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.cgst)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.sgst)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.tds)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.retention)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.other)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
          )}
      </TableCard>
    </div>
  );
}
