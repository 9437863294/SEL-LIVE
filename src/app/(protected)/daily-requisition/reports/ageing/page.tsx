'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { AlertTriangle, Clock, Download, FileText, Hourglass } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import type { DailyRequisitionEntry } from '@/lib/types';
import { balanceOf, paidOf } from '@/lib/requisition-progress';
import { DAILY_STATUS_TONE, dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import {
  ChipStrip,
  KpiRow,
  ReportAccessDenied,
  ReportSkeleton,
  formatDay,
  inr,
  inrWhole,
  localDateKey,
  pctOf,
  toJsDate,
} from '../_components/report-kit';

/** Settled: nothing more will be paid. Partially Paid stays open — its balance is what ages. */
const CLOSED_STATUSES: readonly string[] = ['Paid', 'Cancelled'];

const DAY_MS = 1000 * 60 * 60 * 24;

const ageInDays = (value: unknown, now: number): number => {
  const d = toJsDate(value);
  return d ? Math.max(0, Math.floor((now - d.getTime()) / DAY_MS)) : 0;
};

interface AgeBracket {
  label: string;
  min: number;
  max: number;
  tone: StatusTone;
}

const BRACKETS: AgeBracket[] = [
  { label: '0–3 days', min: 0, max: 3, tone: 'success' },
  { label: '4–7 days', min: 4, max: 7, tone: 'info' },
  { label: '8–15 days', min: 8, max: 15, tone: 'warning' },
  { label: '16–30 days', min: 16, max: 30, tone: 'warning' },
  { label: '30+ days', min: 31, max: Infinity, tone: 'danger' },
];

function getBracket(age: number): AgeBracket {
  return BRACKETS.find((b) => age >= b.min && age <= b.max) ?? BRACKETS[BRACKETS.length - 1];
}

interface AgeingRow {
  entry: DailyRequisitionEntry;
  age: number;
  bracket: AgeBracket;
  /** What is still to pay — the net, less any part payment. */
  outstanding: number;
}

export default function AgeingReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet');

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [deptNameMap, setDeptNameMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  // Every row ages against the same clock: when the page opened.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    // Until permissions load `can` answers false — wait for them rather than fetch without them.
    if (isAuthLoading || !canView) return;
    let active = true;
    const load = async () => {
      try {
        const [snap, deptsSnap] = await Promise.all([
          getDocs(collection(db, 'dailyRequisitions')),
          // Names are a nicety: without them the column falls back to the department id.
          getDocs(collection(db, 'departments')).catch(() => null),
        ]);
        if (!active) return;
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRequisitionEntry)));
        const names: Record<string, string> = {};
        deptsSnap?.docs.forEach((d) => {
          names[d.id] = (d.data().name as string) || d.id;
        });
        setDeptNameMap(names);
      } catch (err) {
        console.error('Failed to load daily requisitions for ageing report', err);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [isAuthLoading, canView]);

  const rows = useMemo(
    (): AgeingRow[] =>
      entries
        .filter((e) => !CLOSED_STATUSES.includes(e.status))
        .map((e) => {
          const age = ageInDays(e.createdAt, now);
          return { entry: e, age, bracket: getBracket(age), outstanding: balanceOf(e) };
        })
        .sort((a, b) => b.age - a.age || b.outstanding - a.outstanding),
    [entries, now]
  );

  const summary = useMemo(() => {
    const byBracket = new Map(
      BRACKETS.map((b): [string, { count: number; outstanding: number }] => [b.label, { count: 0, outstanding: 0 }])
    );
    let outstanding = 0;
    let net = 0;
    let partPaid = 0;
    let critical = 0;
    let criticalOutstanding = 0;
    let ageSum = 0;
    for (const r of rows) {
      const bucket = byBracket.get(r.bracket.label);
      if (bucket) {
        bucket.count += 1;
        bucket.outstanding += r.outstanding;
      }
      outstanding += r.outstanding;
      net += Number(r.entry.netAmount) || 0;
      if (r.entry.status === 'Partially Paid') partPaid += 1;
      if (r.age > 30) {
        critical += 1;
        criticalOutstanding += r.outstanding;
      }
      ageSum += r.age;
    }
    return {
      byBracket,
      outstanding,
      net,
      partPaid,
      critical,
      criticalOutstanding,
      avgAge: rows.length > 0 ? Math.round(ageSum / rows.length) : 0,
      oldestAge: rows[0]?.age ?? 0,
    };
  }, [rows]);

  const deptName = (id: string) => (id ? deptNameMap[id] || id : '—');

  const exportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Ageing Report');
      ws.columns = [
        { header: 'Reception No', key: 'receptionNo', width: 18 },
        { header: 'Party Name', key: 'partyName', width: 26 },
        { header: 'Department', key: 'department', width: 22 },
        { header: 'Status', key: 'status', width: 22 },
        { header: 'Created Date', key: 'createdDate', width: 16 },
        { header: 'Age (days)', key: 'age', width: 12 },
        { header: 'Net Amount (INR)', key: 'netAmount', width: 18 },
        { header: 'Paid (INR)', key: 'paid', width: 16 },
        { header: 'Outstanding (INR)', key: 'outstanding', width: 18 },
        { header: 'Age Bracket', key: 'bracket', width: 14 },
      ];
      rows.forEach((r) =>
        ws.addRow({
          receptionNo: r.entry.receptionNo,
          partyName: r.entry.partyName,
          department: deptName(r.entry.departmentId),
          status: r.entry.status,
          createdDate: toJsDate(r.entry.createdAt)?.toLocaleDateString('en-IN') ?? '—',
          age: r.age,
          netAmount: r.entry.netAmount || 0,
          paid: paidOf(r.entry),
          outstanding: r.outstanding,
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
      a.download = `ageing-report-${localDateKey(new Date())}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  if (isAuthLoading || (isLoading && canView)) return <ReportSkeleton filters={false} strip />;

  if (!canView) {
    return (
      <ReportAccessDenied
        title="Ageing Report"
        description="Open requisitions bucketed by age — spot what is stuck, for how long, and what is still owed."
      />
    );
  }

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader eyebrow="Daily Requisition"
        title="Ageing Report"
        description="Open requisitions (excluding Paid and Cancelled; Partially Paid stays open for its balance) sorted by age — oldest first. Live snapshot, no date filter."
        backHref="/daily-requisition/reports"
        meta={
          <Badge variant="neutral">
            Live — as of today
          </Badge>
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

      <KpiRow>
        <KpiCard
          label="Open requisitions"
          value={rows.length}
          hint={summary.partPaid > 0 ? `${summary.partPaid} part paid` : 'None part paid'}
          icon={FileText}
          tone="blue"
          accent
        />
        <KpiCard
          label="Outstanding"
          value={inrWhole(summary.outstanding)}
          hint={`of ${inrWhole(summary.net)} net`}
          icon={Hourglass}
          tone="amber"
          accent
        />
        <KpiCard
          label="Critical (30+ days)"
          value={summary.critical}
          hint={rows.length > 0 ? `${pctOf(summary.critical, rows.length)} of open · ${inrWhole(summary.criticalOutstanding)}` : undefined}
          icon={AlertTriangle}
          tone="rose"
          accent
        />
        <KpiCard
          label="Average age"
          value={`${summary.avgAge} days`}
          hint={`Oldest ${summary.oldestAge} days`}
          icon={Clock}
          tone="violet"
          accent
        />
      </KpiRow>

      <ChipStrip
        label="Open requisitions by age"
        chips={BRACKETS.map((b) => {
          const bucket = summary.byBracket.get(b.label);
          return { key: b.label, label: b.label, count: bucket?.count ?? 0, tone: b.tone, hint: inrWhole(bucket?.outstanding ?? 0) };
        })}
      />

      {/* Ageing table */}
      <TableCard
        title="Open Requisitions"
        description="Sorted oldest first. Age calculated from created date to today; Outstanding is the net less any part payment."
        count={rows.length}
      >
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No open requisitions found — everything is up to date.
            </div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px]">Reception No</TableHead>
                    <TableHead className="min-w-[160px]">Party</TableHead>
                    <TableHead className="min-w-[130px]">Department</TableHead>
                    <TableHead className="min-w-[160px]">Status</TableHead>
                    <TableHead className="min-w-[120px]">Created Date</TableHead>
                    <TableHead className="text-right min-w-[90px]">Age (days)</TableHead>
                    <TableHead className="text-right min-w-[120px]">Net Amount</TableHead>
                    <TableHead className="text-right min-w-[120px]">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ entry: e, age, bracket, outstanding }) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap font-mono">{e.receptionNo}</TableCell>
                      <TableCell className="font-medium">{e.partyName}</TableCell>
                      <TableCell>{deptName(e.departmentId)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={e.status} tone={DAILY_STATUS_TONE[e.status]}>{e.status}</StatusBadge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDay(e.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={bracket.tone} className="tabular-nums">
                          {age}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(e.netAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{inr(outstanding)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell colSpan={6}>Total ({rows.length} open)</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(summary.net)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{inr(summary.outstanding)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
          )}
      </TableCard>
    </div>
  );
}
