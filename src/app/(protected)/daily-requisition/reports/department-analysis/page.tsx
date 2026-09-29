'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Download, FileText, Hourglass, Layers, Wallet } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { DailyRequisitionEntry } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilterBar } from '@/components/shared/filter-bar';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
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
  localDateKey,
  round2,
  totalsOf,
} from '../_components/report-kit';

const NO_DEPARTMENT = '__unknown__';

export default function DepartmentAnalysisPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');
  const canExport = can('Export', 'Daily Requisition.Reports') || can('Export', 'Daily Requisition.Entry Sheet') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [deptNameMap, setDeptNameMap] = useState<Record<string, string>>({});

  // This month so far, in local days (toISOString would give the UTC day — a day early here).
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date();
    return localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [toDate, setToDate] = useState(() => localDateKey(new Date()));

  useEffect(() => {
    // Until permissions load `can` answers false — wait for them rather than fetch without them.
    if (isAuthLoading || !canView) return;
    let active = true;
    const load = async () => {
      try {
        const [entriesSnap, deptsSnap] = await Promise.all([
          getDocs(collection(db, 'dailyRequisitions')),
          getDocs(collection(db, 'departments')),
        ]);
        if (!active) return;

        const nameMap: Record<string, string> = {};
        deptsSnap.docs.forEach((d) => {
          const data = d.data();
          nameMap[d.id] = (data.name as string) || d.id;
        });
        setDeptNameMap(nameMap);

        setEntries(
          entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry))
        );
      } catch (err) {
        console.error('Failed to load department analysis', err);
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
    () => entries.filter((e) => inDateRange(dateKeyOf(e.date), fromDate, toDate)),
    [entries, fromDate, toDate]
  );

  const rows = useMemo(
    () =>
      groupTotals(
        filtered,
        (e) => e.departmentId || NO_DEPARTMENT,
        (key) => (key === NO_DEPARTMENT ? '(No department)' : deptNameMap[key] || key)
      ).sort((a, b) => b.count - a.count),
    [filtered, deptNameMap]
  );

  const totals = useMemo(() => totalsOf(filtered), [filtered]);
  const topDept = rows[0] ?? null;
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0);

  const exportExcel = async () => {
    if (!canExport || isExporting || rows.length === 0) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Department Analysis');
      ws.columns = [
        { header: 'Department', key: 'name', width: 32 },
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
      a.download = `department-analysis-${fromDate || 'all'}-to-${toDate || 'all'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  if (isAuthLoading || (isLoading && canView)) return <ReportSkeleton />;

  if (!canView) return <ReportAccessDenied title="Department Analysis" description="Requisitions grouped by department." />;

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader
        title="Department Analysis"
        description="Requisitions grouped by department for the selected date range — net, paid and still outstanding."
        backHref="/daily-requisition/reports"
        eyebrow="Daily Requisition"
        actions={
          canExport ? (
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={isExporting || rows.length === 0}
              className="bg-white/80 hover:bg-white border-white/70"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? 'Exporting…' : 'Export Excel'}
            </Button>
          ) : null
        }
      />

      {/* Date filters */}
      <FilterBar className="mb-4" summary={`${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'} in range`}>
        <label className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">From</span>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">To</span>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
      </FilterBar>

      <KpiRow>
        <KpiCard
          label="Departments"
          value={rows.length}
          hint={topDept ? `Top: ${topDept.name} (${topDept.count})` : undefined}
          icon={Layers}
          tone="emerald"
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
        icon={Layers}
        title="Department Breakdown"
        description={<>{rows.length} department{rows.length !== 1 ? 's' : ''} · {totals.count} entries in range</>}
      >
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No entries found for the selected date range.
            </div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[10rem]">Department</TableHead>
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
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right">
                        <div className="space-y-1">
                          <div className="tabular-nums">{row.count}</div>
                          <div className="ml-auto h-1.5 w-32 rounded-full bg-slate-100">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all"
                              style={{
                                width: `${maxCount > 0 ? (row.count / maxCount) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {inr(row.gross)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                        {inr(row.net)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.paid)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.outstanding)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.partPaid}</TableCell>
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
                  </TableRow>
                </TableBody>
              </Table>
          )}
      </TableCard>
    </div>
  );
}
