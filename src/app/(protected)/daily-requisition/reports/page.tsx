'use client';

/**
 * Daily Requisition › Reports: every report as a card with the one figure worth reading before
 * opening it and a small chart of it, grouped Overview / Breakdowns / Tax, under a header with the
 * totals for the range chosen there (which every card's figure covers too, except the 12-month trend
 * and the live ageing). Search and the group pills narrow the cards; "Export all" puts every
 * report's figures, and the requisitions behind them, in one workbook.
 *
 * Beside them: the reports pinned here and the reports last exported here (this browser — see
 * _components/hub-parts.tsx). Figures come from src/lib/daily-requisition-report-hub.ts.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { format, isToday } from 'date-fns';
import {
  ArrowRight,
  BarChart3,
  ChevronLeft,
  Clock,
  Download,
  FolderOpen,
  Landmark,
  Layers,
  Loader2,
  Percent,
  Search,
  Star,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { inrShort } from '@/components/daily-requisition/dashboard-overview';
import { useDailyRequisitionWorkflowSteps } from '@/components/daily-requisition/nav';
import { useAuthorization } from '@/hooks/useAuthorization';
import { periodRange, type DashboardPeriod } from '@/lib/daily-requisition-dashboard';
import { pipelineKeyOf, pipelineOf, placeSteps, stepWorkLabel } from '@/lib/daily-requisition-flow';
import { hubFigures, HUB_BACKLOG_DAYS, type HubRow } from '@/lib/daily-requisition-report-hub';
import { db } from '@/lib/firebase';
import { balanceOf, paidOf } from '@/lib/requisition-progress';
import type { DailyRequisitionEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { dateKeyOf, localDateKey, ReportAccessDenied } from './_components/report-kit';
import { MiniArea, MiniBars, MiniColumns, MiniDonut, recordExport, useExportedReports, usePinnedReports } from './_components/hub-parts';

type GroupKey = 'overview' | 'breakdowns' | 'tax';

interface ReportCard {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** The icon's gradient, and the card's accent. */
  from: string;
  to: string;
  /** What the report covers: a period you choose, months back from now, or what is open now. */
  scope: 'Date range' | 'Monthly' | 'Live';
  group: GroupKey;
}

const BASE = '/daily-requisition/reports';

const REPORTS: ReportCard[] = [
  { key: 'status-overview', title: 'Status Overview', description: 'Count, net, paid and outstanding by workflow step and by status: the full pipeline at a glance.', icon: BarChart3, from: '#67e8f9', to: '#0891b2', scope: 'Date range', group: 'overview' },
  { key: 'monthly-trend', title: 'Monthly Trend', description: 'Volume and value month over month for the last 6, 12 or 24 months.', icon: TrendingUp, from: '#c4b5fd', to: '#7c3aed', scope: 'Monthly', group: 'overview' },
  { key: 'ageing', title: 'Ageing Report', description: 'Open requisitions bucketed by age: what is stuck, for how long, and what is still owed.', icon: Clock, from: '#fda4af', to: '#e11d48', scope: 'Live', group: 'overview' },
  { key: 'financial-breakdown', title: 'Financial Breakdown', description: 'Gross vs net with the full deduction split: GST, TDS, retention and other charges.', icon: Wallet, from: '#a5b4fc', to: '#4f46e5', scope: 'Date range', group: 'overview' },
  { key: 'department-analysis', title: 'Department Analysis', description: 'Requisitions, net, paid and outstanding grouped by department.', icon: Layers, from: '#6ee7b7', to: '#059669', scope: 'Date range', group: 'breakdowns' },
  { key: 'project-analysis', title: 'Project Analysis', description: 'Requisition count, net, paid and outstanding broken down by project.', icon: FolderOpen, from: '#fcd34d', to: '#d97706', scope: 'Date range', group: 'breakdowns' },
  { key: 'party-analysis', title: 'Party / Vendor Analysis', description: 'Top parties by amount and frequency, with what is paid and still owed to each.', icon: Users, from: '#f9a8d4', to: '#db2777', scope: 'Date range', group: 'breakdowns' },
  { key: 'gst-by-registration', title: 'GST & TDS by Registration', description: "Per the company's own GSTINs: input credit on purchase bills, output GST under reverse charge, and TDS withheld, kept apart as the return keeps them.", icon: Landmark, from: '#5eead4', to: '#0d9488', scope: 'Date range', group: 'tax' },
];

const GROUPS: Array<{ key: GroupKey; title: string; hint: string; icon: LucideIcon; from: string; to: string }> = [
  { key: 'overview', title: 'Overview', hint: 'The whole pipeline: status, trend, age and money', icon: BarChart3, from: '#67e8f9', to: '#0891b2' },
  { key: 'breakdowns', title: 'Breakdowns', hint: 'Grouped by department, project or party', icon: Layers, from: '#6ee7b7', to: '#059669' },
  { key: 'tax', title: 'Tax', hint: 'GST and TDS, by our registration', icon: Percent, from: '#5eead4', to: '#0d9488' },
];

type HubRange = Extract<DashboardPeriod, 'this-month' | 'this-quarter' | 'this-fy' | 'all' | 'custom'>;

const DESCRIPTION = 'Focused analytics on requisitions, with one-click Excel export';

/** The pipeline by status alone, until the workflow is there to place requisitions by. */
const STATUS_PIPELINE = [
  { key: 'work:receiving', name: 'Receiving at Finance' },
  { key: 'work:gst', name: 'GST & TDS Verification' },
  { key: 'work:payment', name: 'Processed for Payment' },
];

const pctText = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : '0%');
/** A name short enough for a chart's label. */
const shortLabel = (name: string) => {
  const word = name.trim().split(/\s+/)[0] ?? '';
  return word.length > 7 ? `${word.slice(0, 6)}…` : word;
};

export default function DailyRequisitionReportsHubPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet') || can('View', 'Daily Requisition.Settings');
  const canExport = can('Export', 'Daily Requisition.Reports') || can('Export', 'Daily Requisition.Entry Sheet');
  const { steps } = useDailyRequisitionWorkflowSteps();

  const [entries, setEntries] = useState<DailyRequisitionEntry[] | null>(null);
  const [names, setNames] = useState<{ projects: Map<string, string>; departments: Map<string, string> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<HubRange>('this-fy');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<GroupKey | 'all'>('all');
  const [isExporting, setIsExporting] = useState(false);
  const [todayKey] = useState(() => localDateKey(new Date()));
  const [pins, togglePin] = usePinnedReports();
  const exported = useExportedReports();

  // The requisitions, and the names they point at, once — as each report reads them.
  useEffect(() => {
    if (isAuthLoading || !canView) return;
    let active = true;
    Promise.all([getDocs(collection(db, 'dailyRequisitions')), getDocs(collection(db, 'projects')), getDocs(collection(db, 'departments'))])
      .then(([requisitions, projects, departments]) => {
        if (!active) return;
        setEntries(requisitions.docs.map((d) => ({ id: d.id, ...d.data() }) as DailyRequisitionEntry));
        setNames({
          projects: new Map(projects.docs.map((d) => [d.id, String(d.data().projectName || d.id)])),
          departments: new Map(departments.docs.map((d) => [d.id, String(d.data().name || d.id)])),
        });
      })
      .catch((error) => {
        console.error('Could not load the report figures', error);
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [isAuthLoading, canView]);

  /* ── where each requisition is, and the figures ── */
  const placed = useMemo(() => placeSteps(steps), [steps]);
  const positions = useMemo(() => {
    if (!steps.length) return STATUS_PIPELINE;
    return pipelineOf(steps).map((position) => {
      const p = position.stepIndex !== null ? placed[position.stepIndex] : null;
      const name =
        position.role === 'payment'
          ? 'Payment'
          : p && position.role !== 'verification' && p.roles.length > 1
            ? `${p.step.name} · ${stepWorkLabel(p.step, position.role)}`
            : position.stepName;
      return { key: position.key, name };
    });
  }, [steps, placed]);
  const positionName = useMemo(() => new Map(positions.map((p) => [p.key, p.name])), [positions]);

  const rows = useMemo<HubRow[]>(
    () =>
      (entries ?? []).map((entry) => ({
        dateKey: dateKeyOf(entry.date),
        status: entry.status || 'Pending',
        gross: Number(entry.grossAmount) || 0,
        net: Number(entry.netAmount) || 0,
        paid: paidOf(entry),
        balance: balanceOf(entry),
        igst: Number(entry.igstAmount) || 0,
        cgst: Number(entry.cgstAmount) || 0,
        sgst: Number(entry.sgstAmount) || 0,
        tds: Number(entry.tdsAmount) || 0,
        retention: Number(entry.retentionAmount) || 0,
        other: Number(entry.otherDeduction) || 0,
        departmentId: entry.departmentId || '',
        projectId: entry.projectId || '',
        party: entry.partyName || '',
        stage: pipelineKeyOf(placed, entry),
      })),
    [entries, placed],
  );
  const dates = useMemo(() => periodRange(range, todayKey, custom), [range, todayKey, custom]);
  const figures = useMemo(
    () => hubFigures(rows, { todayKey, range: dates, stages: positions.map((p) => p.key) }),
    [rows, todayKey, dates, positions],
  );
  const ready = entries !== null && names !== null;

  const fyStart = Number(periodRange('this-fy', todayKey).from.slice(0, 4));
  const fyLabel = `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  const rangeLabel =
    range === 'this-month' ? 'this month' : range === 'this-quarter' ? 'this quarter' : range === 'this-fy' ? fyLabel : range === 'all' ? 'all time' : 'the chosen dates';
  const departmentName = (key: string) => (key ? (names?.departments.get(key) ?? key) : 'No department');
  const projectName = (key: string) => (key ? (names?.projects.get(key) ?? key) : 'No project');

  /** Each card's figure, what it means, and its small chart. */
  const cardFigure = (key: string): { value: string; caption: string; hot?: boolean; viz: ReactNode } => {
    const card = REPORTS.find((r) => r.key === key)!;
    switch (key) {
      case 'status-overview': {
        const open = figures.pipeline.reduce((sum, p) => sum + p.balance, 0);
        const top = [...figures.pipeline].sort((a, b) => b.balance - a.balance)[0];
        const shown = [...figures.pipeline].sort((a, b) => b.balance - a.balance).slice(0, 4);
        const ordered = figures.pipeline.filter((p) => shown.includes(p));
        return open > 0 && top
          ? {
              value: pctText(top.balance, open),
              caption: `of open value sits at ${positionName.get(top.key) ?? top.key}`,
              viz: <MiniBars colour={card.to} rows={ordered.map((p) => ({ label: shortLabel(positionName.get(p.key) ?? p.key), value: p.balance }))} />,
            }
          : { value: '0', caption: `nothing open, ${rangeLabel}`, viz: <MiniBars colour={card.to} rows={positions.slice(0, 4).map((p) => ({ label: shortLabel(p.name), value: 0 }))} /> };
      }
      case 'monthly-trend': {
        const months = figures.monthly;
        const current = months[months.length - 1];
        const previous = months[months.length - 2];
        const change = previous && previous.net > 0 ? Math.round(((current.net - previous.net) / previous.net) * 100) : null;
        return {
          value: inrShort(current.net),
          caption: `received in ${current.label.split(' ')[0]}${change !== null ? ` · ${change >= 0 ? '+' : '−'}${Math.abs(change)}% vs ${previous.label.split(' ')[0]}` : ''}`,
          viz: <MiniArea id="hub-trend" colour={card.to} values={months.map((m) => m.net)} />,
        };
      }
      case 'ageing': {
        const stale = figures.ageing[figures.ageing.length - 1];
        return {
          value: stale.count.toLocaleString('en-IN'),
          caption: `older than ${HUB_BACKLOG_DAYS} days · ${inrShort(stale.balance)}`,
          hot: stale.count > 0,
          viz: (
            <MiniColumns
              bars={figures.ageing.map((bucket, i) => ({ label: bucket.label, value: bucket.count, colour: ['#22c55e', '#f59e0b', '#f97316', '#e11d48'][i] }))}
            />
          ),
        };
      }
      case 'financial-breakdown': {
        const m = figures.money;
        return {
          value: inrShort(m.gross),
          caption: `gross → ${inrShort(m.net)} net`,
          viz: (
            <MiniDonut
              parts={[
                { label: 'Net', value: m.net, colour: '#2563eb' },
                { label: 'GST', value: m.gst, colour: '#7c3aed' },
                { label: 'TDS', value: m.tds, colour: '#e11d48' },
                { label: 'Ret.', value: m.retention + m.other, colour: '#f59e0b' },
              ]}
            />
          ),
        };
      }
      case 'department-analysis': {
        const top = figures.departments[0];
        return top
          ? {
              value: departmentName(top.key),
              caption: `largest · ${pctText(top.net, figures.money.net)} of net`,
              viz: <MiniBars colour={card.to} rows={figures.departments.slice(0, 5).map((d) => ({ value: d.net }))} />,
            }
          : { value: '—', caption: `nothing ${rangeLabel}`, viz: <MiniBars colour={card.to} rows={[]} /> };
      }
      case 'project-analysis': {
        const top = figures.projects[0];
        return top
          ? {
              value: projectName(top.key),
              caption: `${inrShort(top.outstanding)} outstanding`,
              viz: <MiniBars colour={card.to} rows={figures.projects.slice(0, 5).map((p) => ({ value: p.outstanding }))} />,
            }
          : { value: '—', caption: `nothing ${rangeLabel}`, viz: <MiniBars colour={card.to} rows={[]} /> };
      }
      case 'party-analysis': {
        const topTen = figures.parties.slice(0, 10).reduce((sum, p) => sum + p.net, 0);
        return {
          value: figures.parties.length.toLocaleString('en-IN'),
          caption: `parties · top 10 hold ${pctText(topTen, figures.money.net)}`,
          viz: <MiniBars colour={card.to} rows={figures.parties.slice(0, 5).map((p) => ({ value: p.net }))} />,
        };
      }
      default: {
        const x = figures.tax;
        return {
          value: inrShort(x.igst + x.cgst + x.sgst),
          caption: `GST recorded · ${inrShort(x.tds)} TDS`,
          viz: (
            <MiniBars
              colour={card.to}
              rows={[
                { label: 'IGST', value: x.igst, colour: '#0d9488' },
                { label: 'CGST', value: x.cgst, colour: '#14b8a6' },
                { label: 'SGST', value: x.sgst, colour: '#5eead4' },
                { label: 'TDS', value: x.tds, colour: '#f43f5e' },
              ]}
            />
          ),
        };
      }
    }
  };

  /* ── narrowing ── */
  const needle = search.trim().toLowerCase();
  const matches = (r: ReportCard) => !needle || `${r.title} ${r.description} ${r.scope} ${r.group}`.toLowerCase().includes(needle);
  const shownGroups = GROUPS.filter((g) => group === 'all' || group === g.key)
    .map((g) => ({ ...g, cards: REPORTS.filter((r) => r.group === g.key && matches(r)) }))
    .filter((g) => g.cards.length > 0);

  /* ── one workbook of everything ── */
  const exportAll = async () => {
    if (!ready || isExporting) return;
    setIsExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const sheet = (name: string, columns: Array<{ header: string; key: string; width: number }>, data: Array<Record<string, unknown>>) => {
        const ws = wb.addWorksheet(name);
        ws.columns = columns;
        ws.getRow(1).font = { bold: true };
        data.forEach((row) => ws.addRow(row));
      };
      const money = (n: number) => Math.round(n * 100) / 100;
      const t = figures.totals;
      sheet('Summary', [{ header: 'Figure', key: 'k', width: 34 }, { header: 'Value', key: 'v', width: 22 }], [
        { k: 'Range', v: range === 'custom' ? `${dates.from || 'start'} to ${dates.to}` : rangeLabel },
        { k: 'Requisitions (cancelled left out)', v: t.count },
        { k: 'Net value (INR)', v: money(t.net) },
        { k: 'Paid (INR)', v: money(t.paid) },
        { k: 'Outstanding (INR)', v: money(t.outstanding) },
        { k: 'Open', v: t.open },
        { k: `Open over ${HUB_BACKLOG_DAYS} days`, v: t.overBacklog },
      ]);
      sheet('Workflow steps', [{ header: 'Where it waits', key: 'step', width: 36 }, { header: 'Open', key: 'count', width: 10 }, { header: 'Outstanding (INR)', key: 'balance', width: 20 }],
        figures.pipeline.map((p) => ({ step: positionName.get(p.key) ?? p.key, count: p.count, balance: money(p.balance) })));
      sheet('Monthly trend', [{ header: 'Month', key: 'm', width: 12 }, { header: 'Net received (INR)', key: 'net', width: 20 }],
        figures.monthly.map((m) => ({ m: m.label, net: money(m.net) })));
      sheet('Ageing (open now)', [{ header: 'Days waiting', key: 'b', width: 14 }, { header: 'Open', key: 'count', width: 10 }, { header: 'Outstanding (INR)', key: 'balance', width: 20 }],
        figures.ageing.map((b) => ({ b: b.label, count: b.count, balance: money(b.balance) })));
      const m = figures.money;
      sheet('Financial breakdown', [{ header: 'Line', key: 'k', width: 24 }, { header: 'Amount (INR)', key: 'v', width: 20 }], [
        { k: 'Gross', v: money(m.gross) },
        { k: 'GST', v: money(m.gst) },
        { k: 'TDS', v: money(m.tds) },
        { k: 'Retention', v: money(m.retention) },
        { k: 'Other deduction', v: money(m.other) },
        { k: 'Net', v: money(m.net) },
      ]);
      const groupColumns = (label: string) => [
        { header: label, key: 'name', width: 34 },
        { header: 'Requisitions', key: 'count', width: 14 },
        { header: 'Net (INR)', key: 'net', width: 18 },
        { header: 'Outstanding (INR)', key: 'outstanding', width: 20 },
      ];
      sheet('Departments', groupColumns('Department'), figures.departments.map((g) => ({ name: departmentName(g.key), count: g.count, net: money(g.net), outstanding: money(g.outstanding) })));
      sheet('Projects', groupColumns('Project'), figures.projects.map((g) => ({ name: projectName(g.key), count: g.count, net: money(g.net), outstanding: money(g.outstanding) })));
      sheet('Parties', groupColumns('Party'), figures.parties.map((g) => ({ name: g.key, count: g.count, net: money(g.net), outstanding: money(g.outstanding) })));
      const x = figures.tax;
      sheet('GST & TDS', [{ header: 'Line', key: 'k', width: 24 }, { header: 'Amount (INR)', key: 'v', width: 20 }], [
        { k: 'IGST', v: money(x.igst) },
        { k: 'CGST', v: money(x.cgst) },
        { k: 'SGST', v: money(x.sgst) },
        { k: 'TDS', v: money(x.tds) },
        { k: 'Bills with GST or TDS', v: x.bills },
      ]);
      const inRange = (key: string) => (!dates.from && !dates.to) || (key !== '' && (!dates.from || key >= dates.from) && (!dates.to || key <= dates.to));
      sheet(
        'Requisitions',
        [
          { header: 'Date', key: 'date', width: 12 },
          { header: 'Reception No', key: 'no', width: 22 },
          { header: 'Party', key: 'party', width: 28 },
          { header: 'Project', key: 'project', width: 26 },
          { header: 'Department', key: 'department', width: 20 },
          { header: 'Status', key: 'status', width: 18 },
          { header: 'Where it waits', key: 'step', width: 28 },
          { header: 'Gross (INR)', key: 'gross', width: 14 },
          { header: 'Net (INR)', key: 'net', width: 14 },
          { header: 'Paid (INR)', key: 'paid', width: 14 },
          { header: 'Outstanding (INR)', key: 'due', width: 16 },
        ],
        (entries ?? [])
          .filter((e) => inRange(dateKeyOf(e.date)))
          .map((e) => {
            const stage = pipelineKeyOf(placed, e);
            return {
              date: dateKeyOf(e.date),
              no: e.receptionNo || '',
              party: e.partyName || '',
              project: projectName(e.projectId || ''),
              department: departmentName(e.departmentId || ''),
              status: e.status || 'Pending',
              step: stage ? (positionName.get(stage) ?? '') : '',
              gross: money(Number(e.grossAmount) || 0),
              net: money(Number(e.netAmount) || 0),
              paid: money(paidOf(e)),
              due: money(balanceOf(e)),
            };
          }),
      );
      const buffer = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily-requisition-reports-${todayKey}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      recordExport(BASE);
    } catch (error) {
      console.error('Could not export the reports', error);
    } finally {
      setIsExporting(false);
    }
  };

  // Until permissions load `can` answers false — show the page, not a refusal.
  if (!isAuthLoading && !canView) {
    return <ReportAccessDenied title="Reports" description={DESCRIPTION} message="You do not have permission to view reports." />;
  }

  const t = figures.totals;
  const kpis = [
    { label: 'Requisitions', value: t.count.toLocaleString('en-IN'), sub: `${figures.thisMonthCount.toLocaleString('en-IN')} this month` },
    { label: 'Net value', value: inrShort(t.net), sub: 'after GST, TDS & deductions' },
    { label: 'Paid', value: inrShort(t.paid), sub: `${t.net > 0 ? ((t.paid / t.net) * 100).toFixed(1) : '0.0'}% of net` },
    {
      label: 'Outstanding',
      value: inrShort(t.outstanding),
      sub: `${t.open.toLocaleString('en-IN')} open · ${t.overBacklog.toLocaleString('en-IN')} over ${HUB_BACKLOG_DAYS} days`,
      hot: t.overBacklog > 0,
    },
  ];
  const reportOf = (path: string) => REPORTS.find((r) => `${BASE}/${r.key}` === path);

  return (
    <div className={cn(dailyPageContainerClass, 'space-y-4')}>
      {/* The hero drifts slowly, unless motion is to be reduced. */}
      <style>{`@keyframes dr-hub-drift{to{background-position:100% 50%}}@media (prefers-reduced-motion:no-preference){.dr-hub-hero{animation:dr-hub-drift 18s ease-in-out infinite alternate}}`}</style>

      <nav className="flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/daily-requisition" className="grid h-[30px] w-[30px] place-items-center rounded-[9px] border bg-card" aria-label="Back to Daily Requisition">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <Link href="/daily-requisition" className="hover:text-foreground">
          Daily Requisition
        </Link>
        <span aria-hidden>›</span>
        <span className="text-foreground">Reports</span>
      </nav>

      {/* ── hero: the range, and its totals ── */}
      <section
        className="dr-hub-hero keep-light relative overflow-hidden rounded-3xl px-5 py-5 text-white sm:px-[26px] sm:py-[22px]"
        style={{
          backgroundImage:
            'radial-gradient(520px 260px at 95% 0%, rgba(245,158,11,0.69), transparent 65%), radial-gradient(560px 300px at 70% 120%, rgba(219,39,119,0.75), transparent 65%), radial-gradient(600px 340px at 0% 100%, rgba(15,118,110,0.95), transparent 70%), linear-gradient(115deg, #0f766e, #2563eb 40%, #7c3aed 75%, #db2777)',
          backgroundSize: '140% 140%',
        }}
      >
        <div className="relative flex flex-wrap items-center gap-3.5">
          <span className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-2xl bg-white/20">
            <BarChart3 className="h-[26px] w-[26px]" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/75">Daily Requisition</p>
            <h1 className="text-[25px] font-extrabold leading-tight tracking-tight">Reports</h1>
            <p className="text-white/85">{DESCRIPTION}</p>
          </div>
          <span className="hidden flex-1 lg:block" />
          <div className="flex flex-wrap items-center gap-1.5 rounded-[14px] border border-white/30 bg-white/10 p-1" role="radiogroup" aria-label="Range">
            {(
              [
                ['this-month', 'This month'],
                ['this-quarter', 'Quarter'],
                ['this-fy', fyLabel],
                ['all', 'All time'],
                ['custom', 'Custom…'],
              ] as Array<[HubRange, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={range === value}
                onClick={() => setRange(value)}
                className={cn('rounded-[10px] px-3 py-1.5 text-[12.5px] font-bold text-sky-100', range === value && 'bg-white text-slate-800')}
              >
                {label}
              </button>
            ))}
            {range === 'custom' && (
              <span className="flex flex-wrap items-center gap-1.5 px-1">
                <input
                  type="date"
                  aria-label="From"
                  value={custom.from}
                  onChange={(event) => setCustom((c) => ({ ...c, from: event.target.value }))}
                  className="rounded-lg border border-white/40 bg-white/15 px-2 py-1 text-xs text-white"
                  style={{ colorScheme: 'dark' }}
                />
                <span className="text-xs">to</span>
                <input
                  type="date"
                  aria-label="To"
                  value={custom.to}
                  onChange={(event) => setCustom((c) => ({ ...c, to: event.target.value }))}
                  className="rounded-lg border border-white/40 bg-white/15 px-2 py-1 text-xs text-white"
                  style={{ colorScheme: 'dark' }}
                />
              </span>
            )}
          </div>
        </div>
        <div className="relative mt-[18px] grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="min-w-0 rounded-2xl border border-white/30 bg-white/10 px-[15px] py-[11px]">
              <small className="block text-[11.5px] font-semibold text-sky-100">{kpi.label}</small>
              <b className={cn('block truncate text-[21px] font-extrabold tracking-tight tabular-nums', kpi.hot && 'text-rose-200')}>{ready ? kpi.value : '…'}</b>
              <span className="block truncate text-[11.5px] text-indigo-100">{ready ? kpi.sub : failed ? 'Could not be read' : 'Working it out'}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── narrowing, and everything in one workbook ── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-muted-foreground sm:w-[300px]">
          <Search className="h-4 w-4 shrink-0" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reports, e.g. ageing, GST, party…"
            aria-label="Search reports"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {[{ key: 'all' as const, title: 'All', to: '', count: REPORTS.length }, ...GROUPS.map((g) => ({ key: g.key, title: g.title, to: g.to, count: REPORTS.filter((r) => r.group === g.key).length }))].map((pill) => (
            <button
              key={pill.key}
              type="button"
              aria-pressed={group === pill.key}
              onClick={() => setGroup(pill.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border bg-card py-1.5 pl-2.5 pr-3 text-sm font-semibold text-muted-foreground',
                group === pill.key && 'border-slate-900 bg-slate-900 text-white',
              )}
            >
              {pill.to && <i className="h-[9px] w-[9px] rounded-[3px]" style={{ background: pill.to }} />}
              {pill.title} <em className={cn('not-italic font-bold', group === pill.key ? 'text-slate-400' : 'text-muted-foreground')}>{pill.count}</em>
            </button>
          ))}
        </div>
        <span className="hidden flex-1 md:block" />
        {canExport && (
          <Button variant="outline" onClick={() => void exportAll()} disabled={!ready || isExporting} className="rounded-xl">
            {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export all to Excel
          </Button>
        )}
      </div>

      <div className="grid items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_330px]">
        {/* ── the reports ── */}
        <div className="min-w-0">
          {shownGroups.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">No report matches “{search.trim()}”.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => { setSearch(''); setGroup('all'); }}>
                Show every report
              </Button>
            </div>
          ) : (
            shownGroups.map((g) => (
              <section key={g.key} className="mb-6" aria-labelledby={`reports-${g.key}`}>
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-[9px] text-white" style={{ backgroundImage: `linear-gradient(145deg, ${g.from}, ${g.to})` }}>
                    <g.icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <h2 id={`reports-${g.key}`} className="text-[15.5px] font-extrabold">
                      {g.title}
                    </h2>
                    <p className="text-[12.5px] text-muted-foreground">{g.hint}</p>
                  </div>
                  <span className="h-px flex-1 bg-border" aria-hidden />
                </div>
                <div className="grid grid-cols-1 gap-3.5 2xl:grid-cols-2">
                  {g.cards.map((card) => {
                    const figure = ready ? cardFigure(card.key) : null;
                    const pinned = pins.includes(card.key);
                    return (
                      <article
                        key={card.key}
                        className="group relative grid grid-cols-1 gap-3.5 overflow-hidden rounded-[20px] border bg-card p-4 transition hover:-translate-y-[3px] hover:shadow-[0_18px_32px_-18px_rgba(15,23,42,0.35)] sm:grid-cols-[minmax(0,1fr)_150px]"
                      >
                        {/* The whole card opens the report; the star sits above the link. */}
                        <Link href={`${BASE}/${card.key}`} className="absolute inset-0 z-[1] rounded-[20px]" aria-label={`Open ${card.title}`} />
                        <button
                          type="button"
                          onClick={() => togglePin(card.key)}
                          aria-pressed={pinned}
                          title={pinned ? 'Unpin' : 'Pin'}
                          className={cn(
                            'absolute right-2.5 top-2.5 z-[2] grid h-[26px] w-[26px] place-items-center rounded-lg bg-card text-slate-300 opacity-0 transition hover:text-amber-500 focus-visible:opacity-100 group-hover:opacity-100',
                            pinned && 'text-amber-500 opacity-100',
                          )}
                        >
                          <Star className={cn('h-3.5 w-3.5', pinned && 'fill-amber-500')} />
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-start gap-3">
                            <ReportIcon card={card} />
                            <div className="min-w-0">
                              <b className="block text-[14.5px] leading-snug">{card.title}</b>
                              <small className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{card.description}</small>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-baseline gap-2">
                            <b className={cn('max-w-full truncate text-xl font-extrabold tracking-tight tabular-nums', figure?.hot && 'text-rose-700')}>
                              {figure ? figure.value : '…'}
                            </b>
                            <span className="text-xs font-semibold text-muted-foreground">{figure ? figure.caption : failed ? 'figures could not be read' : 'working it out'}</span>
                          </div>
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-px text-[11px] font-bold text-slate-600">
                              {card.scope === 'Live' && <i className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />}
                              {card.scope}
                            </span>
                            <span className="ml-auto flex items-center gap-1 text-xs font-bold text-muted-foreground transition group-hover:text-foreground">
                              Open <ArrowRight className="h-3.5 w-3.5" />
                            </span>
                          </div>
                        </div>
                        <div
                          className="hidden place-items-center rounded-[14px] border p-2 sm:grid"
                          style={{ backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${card.from} 14%, transparent), transparent)` }}
                        >
                          {figure ? figure.viz : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {/* ── pinned here, and exported here ── */}
        <aside className="flex flex-col gap-3.5 xl:sticky xl:top-4">
          <RailBox title="Pinned" aside={pins.length ? undefined : '☆ a card to pin'}>
            {pins.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Nothing pinned yet.</p>
            ) : (
              REPORTS.filter((r) => pins.includes(r.key)).map((card) => {
                const figure = ready ? cardFigure(card.key) : null;
                return (
                  <Link key={card.key} href={`${BASE}/${card.key}`} className="flex items-center gap-2.5 border-b border-dashed py-2 last:border-b-0 hover:text-indigo-700">
                    <ReportIcon card={card} size={30} />
                    <span className="min-w-0">
                      <b className="block truncate text-[12.5px]">{card.title}</b>
                      <small className="block truncate text-[11.5px] text-muted-foreground">{figure ? `${figure.value} · ${figure.caption}` : '…'}</small>
                    </span>
                  </Link>
                );
              })
            )}
          </RailBox>
          <RailBox title="Recently exported" aside="this browser">
            {exported.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Exports you make from the reports show here.</p>
            ) : (
              exported.map((item) => {
                const card = reportOf(item.path);
                const when = new Date(item.at);
                return (
                  <div key={`${item.path}-${item.at}`} className="flex items-center gap-2.5 border-b border-dashed py-2 last:border-b-0">
                    {card ? <ReportIcon card={card} size={30} /> : <ReportIcon card={{ ...REPORTS[0], icon: Download, from: '#94a3b8', to: '#475569' }} size={30} />}
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[12.5px]">{card ? card.title : 'All reports workbook'}</b>
                      <small className="block text-[11.5px] text-muted-foreground">{isToday(when) ? `Today ${format(when, 'HH:mm')}` : format(when, 'd MMM, HH:mm')}</small>
                    </span>
                    <Link href={item.path} className="shrink-0 text-xs font-bold text-indigo-600 hover:underline">
                      Open
                    </Link>
                  </div>
                );
              })
            )}
          </RailBox>
        </aside>
      </div>
    </div>
  );
}

function ReportIcon({ card, size = 40 }: { card: Pick<ReportCard, 'icon' | 'from' | 'to'>; size?: number }) {
  const Icon = card.icon;
  return (
    <span
      className="grid shrink-0 place-items-center text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.27)]"
      style={{ width: size, height: size, borderRadius: size * 0.3, backgroundImage: `linear-gradient(145deg, ${card.from}, ${card.to})` }}
    >
      <Icon style={{ width: size * 0.48, height: size * 0.48 }} />
    </span>
  );
}

function RailBox({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[20px] border bg-card">
      <header className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <b className="text-sm">{title}</b>
        {aside && <small className="text-[11.5px] font-semibold text-muted-foreground">{aside}</small>}
      </header>
      <div className="px-4 pb-3.5">{children}</div>
    </section>
  );
}
