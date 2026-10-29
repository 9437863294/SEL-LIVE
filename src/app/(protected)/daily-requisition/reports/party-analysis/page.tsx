'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Users } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableCard } from '@/components/shared/table-card';
import type { DailyRequisitionEntry } from '@/lib/types';
import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import {
  CellName,
  ExportExcelButton,
  REPORT_ROW,
  REPORT_TABLE,
  ReportAccessDenied,
  ReportHeaderCard,
  ReportPeriodFilter,
  ReportSkeleton,
  ValueBar,
  dateKeyOf,
  groupTotals,
  inDateRange,
  inr,
  inrWhole,
  round2,
  totalsOf,
  useReportPeriod,
} from '../_components/report-kit';

const UNKNOWN_PARTY = '(Unknown)';

export default function PartyAnalysisReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const period = useReportPeriod();
  const { dateFrom, dateTo } = period;

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
    <div className={`${dailyPageContainerClass} space-y-3`}>
      <ReportHeaderCard
        icon={Users}
        title="Party / Vendor Analysis"
        description="Group requisitions by party name — count, gross, net, paid and still outstanding."
        actions={<ExportExcelButton onClick={exportExcel} busy={isExporting} disabled={rows.length === 0} />}
        stats={[
          { label: 'Unique parties', value: rows.length.toLocaleString('en-IN'), hint: topParty ? `Top: ${topParty.name}` : undefined },
          { label: 'Entries', value: totals.count.toLocaleString('en-IN'), hint: period.label },
          { label: 'Net amount', value: inrWhole(totals.net), hint: `Gross ${inrWhole(totals.gross)}` },
          {
            label: 'Outstanding',
            value: inrWhole(totals.outstanding),
            hint: `${inrWhole(totals.paid)} paid`,
            tone: totals.outstanding > 0 ? 'text-amber-700' : undefined,
          },
        ]}
      />

      <ReportPeriodFilter state={period} />

      <TableCard icon={Users} title="Party Breakdown" description="Largest net amount first; the bar compares each with the largest.">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No entries found for the selected period.
            </div>
          ) : (
              <Table className={REPORT_TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[10rem]">Party Name</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Gross</TableHead>
                    <TableHead className="text-right">Total Net</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Part paid</TableHead>
                    <TableHead className="text-right">Avg Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.key} className={REPORT_ROW}>
                      <TableCell className="font-medium">
                        <CellName text={row.name} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.gross)}</TableCell>
                      <TableCell className="text-right">
                        <ValueBar value={inr(row.net)} share={maxNet > 0 ? row.net / maxNet : 0} barClassName="from-rose-400 to-pink-500" />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.paid)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.outstanding)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.partPaid}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.avgNet)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.count}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.gross)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.net)}</TableCell>
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
