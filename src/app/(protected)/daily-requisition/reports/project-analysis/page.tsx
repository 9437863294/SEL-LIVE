'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { FolderOpen } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { DailyRequisitionEntry } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableCard } from '@/components/shared/table-card';
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

const NO_PROJECT = '__unknown__';

export default function ProjectAnalysisPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');
  const canExport = can('Export', 'Daily Requisition.Reports') || can('Export', 'Daily Requisition.Entry Sheet') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [projectNameMap, setProjectNameMap] = useState<Record<string, string>>({});

  // This month, as the report always opened.
  const period = useReportPeriod('this-month');
  const { dateFrom, dateTo } = period;

  useEffect(() => {
    // Until permissions load `can` answers false — wait for them rather than fetch without them.
    if (isAuthLoading || !canView) return;
    let active = true;
    const load = async () => {
      try {
        const [entriesSnap, projectsSnap] = await Promise.all([
          getDocs(collection(db, 'dailyRequisitions')),
          getDocs(collection(db, 'projects')),
        ]);
        if (!active) return;

        const nameMap: Record<string, string> = {};
        projectsSnap.docs.forEach((d) => {
          const data = d.data();
          nameMap[d.id] = (data.projectName as string) || (data.name as string) || d.id;
        });
        setProjectNameMap(nameMap);

        setEntries(
          entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry))
        );
      } catch (err) {
        console.error('Failed to load project analysis', err);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [isAuthLoading, canView]);

  // `date` is a Firestore Timestamp on entries from the entry sheet and the importer.
  const filtered = useMemo(
    () => entries.filter((e) => inDateRange(dateKeyOf(e.date), dateFrom, dateTo)),
    [entries, dateFrom, dateTo]
  );

  const rows = useMemo(
    () =>
      groupTotals(
        filtered,
        (e) => e.projectId || NO_PROJECT,
        (key) => (key === NO_PROJECT ? '(No project)' : projectNameMap[key] || key)
      ).sort((a, b) => b.count - a.count),
    [filtered, projectNameMap]
  );

  const totals = useMemo(() => totalsOf(filtered), [filtered]);
  const topProject = rows[0] ?? null;
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0);

  const exportExcel = async () => {
    if (!canExport || isExporting || rows.length === 0) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Project Analysis');
      ws.columns = [
        { header: 'Project', key: 'name', width: 36 },
        { header: 'Count', key: 'count', width: 10 },
        { header: 'Total Gross (INR)', key: 'totalGross', width: 22 },
        { header: 'Total Net (INR)', key: 'totalNet', width: 20 },
        { header: 'Paid (INR)', key: 'paid', width: 18 },
        { header: 'Outstanding (INR)', key: 'outstanding', width: 20 },
        { header: 'Part Paid', key: 'partPaid', width: 12 },
      ];
      rows.forEach((r) =>
        ws.addRow({
          name: r.name,
          count: r.count,
          totalGross: round2(r.gross),
          totalNet: round2(r.net),
          paid: round2(r.paid),
          outstanding: round2(r.outstanding),
          partPaid: r.partPaid,
        })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-analysis-${dateFrom || 'all'}-to-${dateTo || 'all'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  if (isAuthLoading || (isLoading && canView)) return <ReportSkeleton />;

  if (!canView) return <ReportAccessDenied title="Project Analysis" description="Requisitions grouped by project." />;

  return (
    <div className={`${dailyPageContainerClass} space-y-3`}>
      <ReportHeaderCard
        icon={FolderOpen}
        title="Project Analysis"
        description="Requisitions grouped by project for the selected period — net, paid and still outstanding."
        actions={canExport ? <ExportExcelButton onClick={exportExcel} busy={isExporting} disabled={rows.length === 0} /> : null}
        stats={[
          {
            label: 'Active projects',
            value: rows.length.toLocaleString('en-IN'),
            hint: topProject ? `Top: ${topProject.name} (${topProject.count.toLocaleString('en-IN')})` : undefined,
          },
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

      <TableCard icon={FolderOpen} title="Project Breakdown" description="Most requisitions first; the bar compares each with the busiest.">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No entries found for the selected period.
            </div>
          ) : (
              <Table className={REPORT_TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[10rem]">Project</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Gross</TableHead>
                    <TableHead className="text-right">Total Net</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Part paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.key} className={REPORT_ROW}>
                      <TableCell className="font-medium">
                        <CellName text={row.name} />
                      </TableCell>
                      <TableCell className="text-right">
                        <ValueBar
                          value={row.count.toLocaleString('en-IN')}
                          share={maxCount > 0 ? row.count / maxCount : 0}
                          barClassName="from-amber-500 to-orange-500"
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.gross)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{inr(row.net)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.paid)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.outstanding)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.partPaid}</TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.count.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.gross)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.net)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.paid)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(totals.outstanding)}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.partPaid}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
          )}
      </TableCard>
    </div>
  );
}
