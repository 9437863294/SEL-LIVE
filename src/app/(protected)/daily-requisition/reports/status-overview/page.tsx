'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { BarChart3, ChevronLeft, Workflow } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { DailyRequisitionEntry } from '@/lib/types';
import { balanceOf, paidOf } from '@/lib/requisition-progress';
import { pipelineKeyOf, pipelineOf, placeSteps, stepWorkLabel, type PipelinePosition } from '@/lib/daily-requisition-flow';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DAILY_STATUS_TONE, dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { useDailyRequisitionWorkflowSteps } from '@/components/daily-requisition/nav';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import {
  ExportExcelButton,
  REPORT_ROW,
  REPORT_TABLE,
  ReportAccessDenied,
  ReportHeaderCard,
  ReportPeriodFilter,
  ReportSkeleton,
  addTo,
  dateKeyOf,
  emptyTotals,
  inDateRange,
  inr,
  inrWhole,
  pctOf,
  round2,
  totalsOf,
  useReportPeriod,
  type RequisitionTotals,
} from '../_components/report-kit';

/** The pipeline, furthest along first. A status found in the data but not here is listed after it. */
const STATUS_LIST = [
  'Paid',
  'Partially Paid',
  'Received for Payment',
  'Verified',
  'Received',
  'Needs Review',
  'Pending',
  'Cancelled',
] as const;

const STATUS_GRADIENT: Record<string, string> = {
  Paid: 'from-emerald-500 to-teal-500',
  'Partially Paid': 'from-violet-500 to-purple-500',
  'Received for Payment': 'from-sky-500 to-blue-500',
  Verified: 'from-cyan-500 to-sky-400',
  Received: 'from-blue-500 to-indigo-500',
  'Needs Review': 'from-orange-400 to-amber-500',
  Pending: 'from-amber-400 to-yellow-500',
  Cancelled: 'from-rose-500 to-pink-500',
};
const OTHER_GRADIENT = 'from-slate-400 to-slate-500';

/** Each workflow position's bar, by the work done there. */
const ROLE_GRADIENT: Record<PipelinePosition['role'], string> = {
  verification: 'from-sky-500 to-blue-500',
  receiving: 'from-amber-400 to-yellow-500',
  gst: 'from-cyan-500 to-sky-400',
  payment: 'from-violet-500 to-purple-500',
};
/** What kind of place each is, under its name. */
const ROLE_CAPTION: Record<PipelinePosition['role'], string> = {
  verification: 'Approval step',
  receiving: 'Finance · receiving',
  gst: 'Finance · sending for payment',
  payment: 'Payment page',
};

const DESCRIPTION = 'Where requisitions are in the workflow, and by status: count, net amount, paid and outstanding.';

export default function StatusOverviewReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');
  const canExport = can('Export', 'Daily Requisition.Reports') || can('Export', 'Daily Requisition.Entry Sheet') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
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
        console.error('Failed to load status overview report', err);
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

  // Every pipeline status, then any other status the data holds — so no entry goes uncounted.
  const stats = useMemo(() => {
    const map = new Map(STATUS_LIST.map((s): [string, RequisitionTotals] => [s, emptyTotals()]));
    for (const e of filtered) {
      const status = e.status || 'Pending';
      let totals = map.get(status);
      if (!totals) {
        totals = emptyTotals();
        map.set(status, totals);
      }
      addTo(totals, e);
    }
    return map;
  }, [filtered]);

  const statuses = useMemo(() => Array.from(stats.keys()), [stats]);
  const grand = useMemo(() => totalsOf(filtered), [filtered]);

  /**
   * Where each requisition is in the workflow as configured: the approval step holding it, else the
   * finance work its status is at, else the payment page — then paid and cancelled. A Pending
   * requisition still with an approver is counted at that step, not at Finance.
   */
  const { steps } = useDailyRequisitionWorkflowSteps();
  const byStep = useMemo(() => {
    const placed = placeSteps(steps);
    const keyOf = (e: DailyRequisitionEntry) => {
      const status = e.status || 'Pending';
      return status === 'Paid' ? 'paid' : status === 'Cancelled' ? 'cancelled' : (pipelineKeyOf(placed, e) ?? status);
    };
    const positions = steps.length ? pipelineOf(steps) : [];
    const rows = new Map<string, { name: string; caption: string; gradient: string; totals: RequisitionTotals }>();
    for (const position of positions) {
      const p = position.stepIndex !== null ? placed[position.stepIndex] : null;
      const name = p && position.role !== 'verification' && p.roles.length > 1 ? `${p.step.name} · ${stepWorkLabel(p.step, position.role)}` : position.stepName;
      rows.set(position.key, { name, caption: ROLE_CAPTION[position.role], gradient: ROLE_GRADIENT[position.role], totals: emptyTotals() });
    }
    rows.set('paid', { name: 'Paid', caption: 'Paid in full', gradient: STATUS_GRADIENT.Paid, totals: emptyTotals() });
    rows.set('cancelled', { name: 'Cancelled', caption: 'Rejected or cancelled', gradient: STATUS_GRADIENT.Cancelled, totals: emptyTotals() });
    for (const e of filtered) {
      const key = keyOf(e);
      let row = rows.get(key);
      if (!row) {
        row = { name: e.status || 'Pending', caption: 'Not at a configured step', gradient: OTHER_GRADIENT, totals: emptyTotals() };
        rows.set(key, row);
      }
      addTo(row.totals, e);
    }
    return { rows, keyOf };
  }, [steps, filtered]);
  const paidInFull = stats.get('Paid')?.count ?? 0;

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const wsSteps = wb.addWorksheet('By Workflow Step');
      wsSteps.columns = [
        { header: 'Workflow step', key: 'step', width: 34 },
        { header: 'Kind', key: 'kind', width: 26 },
        { header: 'Count', key: 'count', width: 10 },
        { header: 'Total Net Amount (INR)', key: 'totalNet', width: 24 },
        { header: 'Paid (INR)', key: 'paid', width: 18 },
        { header: 'Outstanding (INR)', key: 'outstanding', width: 20 },
        { header: '% of Net', key: 'pct', width: 12 },
      ];
      for (const row of byStep.rows.values()) {
        wsSteps.addRow({
          step: row.name,
          kind: row.caption,
          count: row.totals.count,
          totalNet: round2(row.totals.net),
          paid: round2(row.totals.paid),
          outstanding: round2(row.totals.outstanding),
          pct: grand.net > 0 ? Number(((row.totals.net / grand.net) * 100).toFixed(1)) : 0,
        });
      }

      const ws = wb.addWorksheet('Status Overview');
      ws.columns = [
        { header: 'Status', key: 'status', width: 24 },
        { header: 'Count', key: 'count', width: 10 },
        { header: 'Total Net Amount (INR)', key: 'totalNet', width: 24 },
        { header: 'Paid (INR)', key: 'paid', width: 18 },
        { header: 'Outstanding (INR)', key: 'outstanding', width: 20 },
        { header: '% of Net', key: 'pct', width: 12 },
      ];
      for (const s of statuses) {
        const row = stats.get(s) ?? emptyTotals();
        ws.addRow({
          status: s,
          count: row.count,
          totalNet: round2(row.net),
          paid: round2(row.paid),
          outstanding: round2(row.outstanding),
          pct: grand.net > 0 ? Number(((row.net / grand.net) * 100).toFixed(1)) : 0,
        });
      }
      ws.addRow({});
      ws.addRow({
        status: 'Total',
        count: grand.count,
        totalNet: round2(grand.net),
        paid: round2(grand.paid),
        outstanding: round2(grand.outstanding),
        pct: grand.net > 0 ? 100 : 0,
      });

      const ws2 = wb.addWorksheet('All Entries');
      ws2.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Reception No', key: 'receptionNo', width: 18 },
        { header: 'Party', key: 'partyName', width: 28 },
        { header: 'Status', key: 'status', width: 20 },
        { header: 'Workflow step', key: 'step', width: 30 },
        { header: 'Gross Amount', key: 'grossAmount', width: 18 },
        { header: 'Net Amount', key: 'netAmount', width: 16 },
        { header: 'Paid', key: 'paid', width: 16 },
        { header: 'Outstanding', key: 'outstanding', width: 16 },
      ];
      filtered.forEach((e) =>
        ws2.addRow({
          date: dateKeyOf(e.date),
          receptionNo: e.receptionNo || '',
          partyName: e.partyName || '',
          status: e.status || '',
          step: byStep.rows.get(byStep.keyOf(e))?.name ?? '',
          grossAmount: Number(e.grossAmount || 0),
          netAmount: Number(e.netAmount || 0),
          paid: paidOf(e),
          outstanding: balanceOf(e),
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

  if (isAuthLoading || (isLoading && canView)) return <ReportSkeleton />;

  if (!canView) return <ReportAccessDenied title="Status Overview" description={DESCRIPTION} />;

  return (
    <div className={`${dailyPageContainerClass} space-y-3`}>
      <ReportHeaderCard
        icon={BarChart3}
        title="Status Overview"
        description={DESCRIPTION}
        actions={canExport ? <ExportExcelButton onClick={exportExcel} busy={isExporting} /> : null}
        stats={[
          { label: 'Entries', value: grand.count.toLocaleString('en-IN'), hint: period.label },
          { label: 'Net amount', value: inrWhole(grand.net), hint: `Gross ${inrWhole(grand.gross)}` },
          {
            label: 'Paid',
            value: inrWhole(grand.paid),
            hint: `${paidInFull.toLocaleString('en-IN')} paid in full`,
            tone: grand.paid > 0 ? 'text-emerald-700' : undefined,
          },
          {
            label: 'Outstanding',
            value: inrWhole(grand.outstanding),
            hint: grand.partPaid > 0 ? `${grand.partPaid.toLocaleString('en-IN')} part paid` : 'Still to pay',
            tone: grand.outstanding > 0 ? 'text-amber-700' : undefined,
          },
        ]}
      />

      <ReportPeriodFilter state={period} />

      {/* Where they are: the workflow as configured, step by step */}
      <TableCard
        icon={Workflow}
        title="Summary by Workflow Step"
        description="Where each requisition is now — the approval step holding it, the finance step working it, or payment."
        scroll="natural"
      >
        {grand.count === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground">No data found for the selected period.</div>
        ) : (
          <Table className={REPORT_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[14rem]">Workflow step</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Total Net Amount</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">% of Net</TableHead>
                <TableHead className="min-w-[8rem]">Distribution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...byStep.rows.entries()].map(([key, row], index) => {
                const pct = grand.net > 0 ? (row.totals.net / grand.net) * 100 : 0;
                return (
                  <TableRow key={key} className={REPORT_ROW}>
                    <TableCell>
                      <span className="block font-medium">
                        {key === 'paid' || key === 'cancelled' ? row.name : `${index + 1}. ${row.name}`}
                      </span>
                      <span className="block text-xs text-muted-foreground">{row.caption}</span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{row.totals.count}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.totals.net)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.totals.paid)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.totals.outstanding)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pctOf(row.totals.net, grand.net)}</TableCell>
                    <TableCell>
                      <div className="h-2 w-full rounded-full bg-slate-100">
                        <div className={`h-2 rounded-full bg-gradient-to-r ${row.gradient} transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/50 font-medium">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{grand.count}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(grand.net)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(grand.paid)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(grand.outstanding)}</TableCell>
                <TableCell className="text-right tabular-nums">{grand.net > 0 ? '100%' : '—'}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </TableCard>

      {/* Summary table */}
      <TableCard icon={BarChart3} title="Summary by Status" description="Each status's share of the net amount." scroll="natural">
          {grand.count === 0 ? (
            <div className="px-4 py-10 text-center text-muted-foreground">
              No data found for the selected period.
            </div>
          ) : (
              <Table className={REPORT_TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[11rem]">Status</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Net Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">% of Net</TableHead>
                    <TableHead className="min-w-[8rem]">Distribution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statuses.map((s) => {
                    const row = stats.get(s) ?? emptyTotals();
                    const pct = grand.net > 0 ? (row.net / grand.net) * 100 : 0;
                    return (
                      <TableRow key={s} className={REPORT_ROW}>
                        <TableCell className="whitespace-nowrap">
                          <StatusBadge status={s} tone={DAILY_STATUS_TONE[s]}>{s}</StatusBadge>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{row.count}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.net)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.paid)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(row.outstanding)}</TableCell>
                        <TableCell className="text-right tabular-nums">{pctOf(row.net, grand.net)}</TableCell>
                        <TableCell>
                          <div className="h-2 w-full rounded-full bg-slate-100">
                            <div
                              className={`h-2 rounded-full bg-gradient-to-r ${STATUS_GRADIENT[s] ?? OTHER_GRADIENT} transition-all duration-500`}
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
                    <TableCell className="text-right tabular-nums">{grand.count}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(grand.net)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(grand.paid)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(grand.outstanding)}</TableCell>
                    <TableCell className="text-right tabular-nums">{grand.net > 0 ? '100%' : '—'}</TableCell>
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
