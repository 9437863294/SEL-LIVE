'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Download, FileText, Hourglass, Users, Wallet } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilterBar } from '@/components/shared/filter-bar';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import type { DailyRequisitionEntry } from '@/lib/types';
import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import {
  KpiRow,
  ReportAccessDenied,
  ReportSkeleton,
  dateKeyOf,
  groupTotals,
  inDateRange,
  inr,
  inrWhole,
  round2,
  totalsOf,
} from '../_components/report-kit';

const UNKNOWN_PARTY = '(Unknown)';

export default function PartyAnalysisReportPage() {
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
        console.error('Failed to load daily requisitions for party analysis', err);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [isAuthLoading, canView]);

  const filtered = useMemo(
    () => entries.filter((e) => inDateRange(dateKeyOf(e.date), dateFrom, dateTo)),
    [entries, dateFrom, dateTo]
  );

  // Largest net first. Paid counts part payments; Outstanding is what is still to pay.
  const rows = useMemo(
    () =>
      groupTotals(filtered, (e) => (e.partyName || '').trim() || UNKNOWN_PARTY, (key) => key)
        .map((r) => ({ ...r, avgNet: r.count > 0 ? r.net / r.count : 0 }))
        .sort((a, b) => b.net - a.net),
    [filtered]
  );

  const totals = useMemo(() => totalsOf(filtered), [filtered]);
  const maxNet = useMemo(() => rows.reduce((m, r) => Math.max(m, r.net), 0), [rows]);
  const topParty = rows[0] ?? null;

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
        { header: 'Paid (INR)', key: 'paid', width: 18 },
        { header: 'Outstanding (INR)', key: 'outstanding', width: 20 },
        { header: 'Part Paid', key: 'partPaid', width: 12 },
        { header: 'Avg Net (INR)', key: 'avgNet', width: 18 },
      ];
      rows.forEach((r) =>
        ws.addRow({
          partyName: r.name,
          count: r.count,
          totalGross: round2(r.gross),
          totalNet: round2(r.net),
          paid: round2(r.paid),
          outstanding: round2(r.outstanding),
          partPaid: r.partPaid,
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

  if (isAuthLoading || (isLoading && canView)) return <ReportSkeleton />;

  if (!canView) {
    return (
      <ReportAccessDenied
        title="Party Analysis"
        description="Group requisitions by party and compare volumes and values."
      />
    );
  }

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader eyebrow="Daily Requisition"
        title="Party / Vendor Analysis"
        description="Group requisitions by party name — count, gross, net, paid and still outstanding."
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
      <FilterBar
        className="mb-6"
        activeCount={(dateFrom ? 1 : 0) + (dateTo ? 1 : 0)}
        onClear={() => { setDateFrom(''); setDateTo(''); }}
        summary={`${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'} in range`}
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
          label="Unique parties"
          value={rows.length}
          hint={topParty ? `Top: ${topParty.name}` : undefined}
          icon={Users}
          tone="rose"
          accent
        />
        <KpiCard
          label="Entries"
          value={totals.count}
          hint={totals.partPaid > 0 ? `${totals.partPaid} part paid` : 'In range'}
          icon={FileText}
          tone="cyan"
          accent
        />
        <KpiCard label="Net amount" value={inrWhole(totals.net)} hint={`Gross ${inrWhole(totals.gross)}`} icon={Wallet} tone="violet" accent />
        <KpiCard
          label="Outstanding"
          value={inrWhole(totals.outstanding)}
          hint={`${inrWhole(totals.paid)} paid`}
          icon={Hourglass}
          tone="amber"
          accent
        />
      </KpiRow>

      {/* Table */}
      <TableCard
        title="Party Breakdown"
        description="Sorted by total net amount descending. Bar shows proportion of max."
        count={rows.length}
      >
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No entries found for the selected date range.
            </div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[10rem]">Party Name</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Gross</TableHead>
                    <TableHead className="min-w-[180px]">Total Net</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Part paid</TableHead>
                    <TableHead className="text-right">Avg Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const pct = maxNet > 0 ? (row.net / maxNet) * 100 : 0;
                    return (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.gross)}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <span className="whitespace-nowrap tabular-nums">{inr(row.net)}</span>
                            <div className="h-1.5 w-full max-w-[160px] rounded-full bg-slate-100">
                              <div
                                className="h-1.5 rounded-full bg-gradient-to-r from-rose-400 to-pink-500 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.paid)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.outstanding)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.partPaid}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.avgNet)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.count}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.gross)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{inr(totals.net)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.paid)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.outstanding)}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.partPaid}</TableCell>
                    <TableCell className="text-right tabular-nums">—</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
          )}
      </TableCard>
    </div>
  );
}
