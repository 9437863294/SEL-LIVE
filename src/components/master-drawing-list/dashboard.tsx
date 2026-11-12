'use client';

/**
 * The Master Drawing List dashboard — the module's landing page for one drawing list, laid out the
 * way EPC document control reviews a drawing register:
 *
 *   1. Where the ball is: approved share, and how many deliverables sit with the client, with SEL
 *      or are not yet submitted, with how long they have waited.
 *   2. Control figures: overdue against plan, late to submit, overdue against the contract's review
 *      periods (Settings), turnaround on both sides, first-time approvals, rounds to approval.
 *   3. Trends: planned against actual submissions and approvals (S-curve), monthly throughput, the
 *      client's verdict per round, ageing, and progress per scope and schedule.
 *   4. The status summary: every scope, schedule and group, in the register's order, downloadable.
 *   5. What needs attention, each row opening its drawing and saying where it sits.
 *
 * Figures count deliverables: each sub-drawing, else the item itself (`analytics.ts`).
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  AlarmClock,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileStack,
  Hourglass,
  Repeat,
  Send,
  Target,
  TrendingUp,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { DataList, type ListColumn } from '@/components/shared/data-list';
import { KpiCard, KpiGrid } from '@/components/shared/kpi-card';
import { SectionHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { Card, CardContent } from '@/components/ui/card';
import { chartChrome } from '@/components/ui/chart';
import { useToast } from '@/hooks/use-toast';
import { dashboardStats, progressOf, progressSheet, progressTree, type UnitDays } from '@/lib/master-drawing-list/analytics';
import { COURT_LABEL, formatMdlDate, type DrawingItem, type DrawingUnit, type SubDrawing } from '@/lib/master-drawing-list/drawings';
import { exportFileName } from '@/lib/master-drawing-list/register';
import { listOrder } from '@/lib/master-drawing-list/settings';
import { exportWorkbook } from '@/lib/report-excel';
import { cn } from '@/lib/utils';

import { useMdlSettings, type MdlProjectView } from './mdl-client';
import { MdlEmpty, MdlStatus } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';
import { MDL_COLOURS, ScopeProgress, StatusSummary } from './progress-summary';

const C = MDL_COLOURS;

function ChartCard({ title, description, children, className, action }: { title: string; description?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <Card className={cn('min-w-0', className)}>
      <CardContent className="p-4 sm:p-5">
        <SectionHeader title={title} description={description} actions={action} />
        {children}
      </CardContent>
    </Card>
  );
}

function Ring({ value }: { value: number }) {
  const radius = 42;
  const length = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 sm:h-28 sm:w-28" role="img" aria-label={`${value}% approved`}>
      <circle cx="50" cy="50" r={radius} fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="9" />
      <circle cx="50" cy="50" r={radius} fill="none" stroke="#34d399" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(value / 100) * length} ${length}`} transform="rotate(-90 50 50)" />
      <text x="50" y="49" textAnchor="middle" className="fill-white text-[22px] font-bold">
        {value}%
      </text>
      <text x="50" y="65" textAnchor="middle" className="fill-white/70 text-[9px] font-medium uppercase tracking-wider">
        approved
      </text>
    </svg>
  );
}

function HeroTile({ label, value, hint, icon: Icon, dot }: { label: string; value: number; hint?: string; icon: LucideIcon; dot: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/10 p-3 ring-1 ring-inset ring-white/15 backdrop-blur-sm">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/75">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums text-white">{value.toLocaleString('en-IN')}</span>
        <Icon className="h-3.5 w-3.5 text-white/60" aria-hidden="true" />
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-white/70">{hint}</p>}
    </div>
  );
}

/** A drawing in an attention list, with the scope and schedule it sits under. */
function UnitName({ unit }: { unit: DrawingUnit }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate" title={unit.label}>
        {unit.label}
      </span>
      <span className="block truncate text-[11px] text-muted-foreground">
        {unit.item.scope} › {unit.item.schedule}
        {unit.item.group ? ` › ${unit.item.group}` : ''}
      </span>
    </span>
  );
}

const days = (value: number | null, unit = 'd') => (value === null ? '—' : `${value}${unit}`);

export function ReportsView({
  items,
  today,
  project,
  canExport = false,
  onSelect,
}: {
  items: DrawingItem[];
  today: string;
  project: MdlProjectView;
  /** Drawings · Export: the status summary's download. */
  canExport?: boolean;
  onSelect: (item: DrawingItem, sub: SubDrawing | null) => void;
}) {
  const stats = useMemo(() => dashboardStats(items, today, { reviewDays: project.reviewDays, resubmitDays: project.resubmitDays }), [items, today, project.reviewDays, project.resubmitDays]);
  const { masterData } = useMdlSettings();
  const tree = useMemo(() => progressTree(items, today, listOrder(masterData)), [items, today, masterData]);
  const total = useMemo(() => progressOf(items, today), [items, today]);
  const { toast } = useToast();
  const downloadSummary = async () => {
    try {
      await exportWorkbook(exportFileName(project, today, 'MDL-Summary'), [progressSheet(tree, total, project)]);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Download failed', description: error instanceof Error ? error.message : 'The workbook could not be built.' });
    }
  };

  if (!items.length) {
    return <MdlEmpty icon={FileStack} title="No drawings in this list yet" description="Add items on the Register, or bring the project's workbook in on the Excel Import page." />;
  }

  const nowPoint = stats.sCurve.find((point) => point.month === today.slice(0, 7));
  const variance = nowPoint ? nowPoint.actualSubmission - nowPoint.plannedSubmission : null;
  const avgWait = (list: UnitDays[]) => (list.length ? Math.round(list.reduce((sum, entry) => sum + entry.days, 0) / list.length) : null);
  const courtData = [
    { name: COURT_LABEL.closed, value: stats.courts.closed, fill: C.approved },
    { name: COURT_LABEL.client, value: stats.courts.client, fill: C.client },
    { name: COURT_LABEL.sel, value: stats.courts.sel, fill: C.sel },
    { name: COURT_LABEL.not_started, value: stats.courts.not_started, fill: C.notStarted },
  ].filter((entry) => entry.value > 0);
  const hasPlan = stats.sCurve.some((point) => point.plannedSubmission || point.plannedApproval);

  const unitColumns = (kind: 'client' | 'sel' | 'overdue'): ListColumn<UnitDays & { id: string }>[] => [
    { header: 'Drawing', mobile: 'title', className: 'max-w-[18rem]', cell: ({ unit }) => <UnitName unit={unit} /> },
    { header: kind === 'overdue' ? 'Planned end' : 'Since', className: 'whitespace-nowrap', cell: ({ since }) => formatMdlDate(since) },
    { header: 'Days', mobile: 'aside', align: 'right', cell: ({ days: d }) => <span className={cn('font-semibold tabular-nums', d > 30 ? 'text-rose-700' : 'text-slate-800')}>{d}</span> },
  ];
  const listOf = (list: UnitDays[]) => list.map((entry, index) => ({ ...entry, id: `${entry.unit.item.id}-${entry.unit.sub?.id ?? 'item'}-${index}` }));
  const openUnit = (unit: DrawingUnit) => onSelect(unit.item, unit.sub);

  return (
    <div className="space-y-5">
      {/* 1 · where the ball is */}
      <section className="wd-hero keep-light relative overflow-hidden rounded-2xl p-4 text-white shadow-lg sm:p-6">
        <div className="wd-hero-dots pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-center gap-4 lg:w-[22rem] lg:shrink-0">
            <Ring value={stats.approvedPct} />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Master Drawing List</p>
              <h2 className="mt-0.5 line-clamp-2 text-lg font-semibold leading-snug sm:text-xl">{project.displayName}</h2>
              <p className="mt-1 text-xs text-white/75">
                {stats.units.toLocaleString('en-IN')} drawings in {stats.items.toLocaleString('en-IN')} items · {stats.submittedPct}% submitted
              </p>
              {variance !== null && hasPlan && (
                <p className={cn('mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', variance >= 0 ? 'bg-emerald-400/20 text-emerald-100' : 'bg-rose-400/20 text-rose-100')}>
                  <TrendingUp className="h-3 w-3" aria-hidden="true" />
                  {variance >= 0 ? `${variance} ahead of` : `${-variance} behind`} the submission plan
                </p>
              )}
            </div>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2.5 sm:grid-cols-4">
            <HeroTile label={COURT_LABEL.client} value={stats.courts.client} hint={stats.longestClient.length ? `avg ${avgWait(stats.longestClient)} d waiting` : 'nothing waiting'} icon={Send} dot={C.client} />
            <HeroTile label={COURT_LABEL.sel} value={stats.courts.sel} hint={stats.longestSel.length ? `avg ${avgWait(stats.longestSel)} d to comply` : 'nothing to comply'} icon={Undo2} dot={C.sel} />
            <HeroTile label={COURT_LABEL.not_started} value={stats.courts.not_started} hint={stats.lateToSubmit ? `${stats.lateToSubmit} past planned date` : 'none late'} icon={Hourglass} dot={C.notStarted} />
            <HeroTile label={COURT_LABEL.closed} value={stats.courts.closed} hint={stats.firstTime.pct !== null ? `${stats.firstTime.pct}% at first submission` : undefined} icon={CheckCircle2} dot={C.approved} />
          </div>
        </div>
      </section>

      {/* 2 · control figures */}
      <KpiGrid>
        <KpiCard label="Overdue vs plan" value={stats.overdue} hint="planned end passed" icon={AlarmClock} tone="rose" accent />
        <KpiCard label="Late to submit" value={stats.lateToSubmit} hint="planned start passed" icon={CalendarClock} tone="orange" accent />
        <KpiCard
          label="Overdue at client"
          value={stats.clientOverdue ?? '—'}
          hint={project.reviewDays ? `over ${project.reviewDays} d review` : 'set review period'}
          icon={Clock}
          tone="blue"
          accent
          href={project.reviewDays ? undefined : `${MDL_BASE}/settings`}
        />
        <KpiCard
          label="Overdue with SEL"
          value={stats.selOverdue ?? '—'}
          hint={project.resubmitDays ? `over ${project.resubmitDays} d to resubmit` : 'set resubmission period'}
          icon={Undo2}
          tone="amber"
          accent
          href={project.resubmitDays ? undefined : `${MDL_BASE}/settings`}
        />
        <KpiCard label="Client turnaround" value={days(stats.avgClientDays, ' d')} hint="average per round" icon={Send} tone="cyan" accent />
        <KpiCard label="SEL resubmission" value={days(stats.avgSelDays, ' d')} hint="comments to next round" icon={Repeat} tone="violet" accent />
        <KpiCard label="First-time approval" value={stats.firstTime.pct === null ? '—' : `${stats.firstTime.pct}%`} hint={`${stats.firstTime.atFirst} of ${stats.firstTime.approved} at R0`} icon={Target} tone="emerald" accent />
        <KpiCard label="Rounds to approval" value={stats.avgRounds ?? '—'} hint="average submissions" icon={FileStack} tone="slate" accent />
      </KpiGrid>

      {/* 3 · trends */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard title="Planned vs actual" description="Cumulative submissions and approvals against the plan (planned dashed)." className="xl:col-span-2">
          {hasPlan || stats.sCurve.some((point) => point.actualSubmission) ? (
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={stats.sCurve} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={chartChrome.axis} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis stroke={chartChrome.axis} tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip {...chartChrome.tooltip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line name="Planned submission" dataKey="plannedSubmission" stroke={C.submission} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  <Line name="Submitted" dataKey="actualSubmission" stroke={C.submission} strokeWidth={2.5} dot={false} connectNulls={false} />
                  <Line name="Planned approval" dataKey="plannedApproval" stroke={C.approved} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  <Line name="Approved" dataKey="actualApproval" stroke={C.approved} strokeWidth={2.5} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">Set planned dates or record submissions to draw the curve.</p>
          )}
        </ChartCard>
        <ChartCard title="Ball in court" description="Who has to act next, per drawing.">
          <div className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={courtData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2} stroke={chartChrome.surface}>
                  {courtData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip {...chartChrome.tooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="Monthly throughput" description="Rounds submitted, comments received and approvals, by month.">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={stats.monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke={chartChrome.axis} tick={{ fontSize: 11 }} />
                <YAxis stroke={chartChrome.axis} tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip {...chartChrome.tooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar name="Submitted" dataKey="submitted" fill={C.submission} radius={[4, 4, 0, 0]} />
                <Bar name="Comments" dataKey="comments" fill={C.sel} radius={[4, 4, 0, 0]} />
                <Bar name="Approved" dataKey="approved" fill={C.approved} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Client verdict per round" description="How each revision round came back.">
          {stats.outcomes.length ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={stats.outcomes} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="round" stroke={chartChrome.axis} tick={{ fontSize: 11 }} />
                  <YAxis stroke={chartChrome.axis} tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip {...chartChrome.tooltip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar name="Approved" dataKey="approved" stackId="v" fill={C.approved} />
                  <Bar name="Approved with Comments" dataKey="approvedWithComments" stackId="v" fill={C.withComments} />
                  <Bar name="Resubmission Required" dataKey="resubmission" stackId="v" fill={C.resubmit} />
                  <Bar name="Rejected" dataKey="rejected" stackId="v" fill={C.rejected} />
                  <Bar name="Under Review" dataKey="underReview" stackId="v" fill={C.review} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">No round submitted yet.</p>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="Ageing" description="How long open drawings have waited, with the client and with SEL.">
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: C.client }} aria-hidden="true" /> With client
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: C.sel }} aria-hidden="true" /> With SEL
              </span>
            </div>
            {stats.ageing.map((band) => {
              const max = Math.max(1, ...stats.ageing.flatMap((entry) => [entry.client, entry.sel]));
              return (
                <div key={band.band} className="grid grid-cols-[4.5rem,1fr] items-center gap-x-3 gap-y-1 text-xs">
                  <span className="row-span-2 text-slate-600">{band.band}</span>
                  {(['client', 'sel'] as const).map((side) => (
                    <span key={side} className="flex items-center gap-2" title={`${side === 'client' ? 'With client' : 'With SEL'}, ${band.band}: ${band[side]}`}>
                      <span className="h-2 flex-1 overflow-hidden rounded-r-[4px] bg-slate-100">
                        <span className="block h-2 rounded-r-[4px]" style={{ width: `${(band[side] / max) * 100}%`, backgroundColor: side === 'client' ? C.client : C.sel }} />
                      </span>
                      <span className="w-7 text-right tabular-nums text-slate-700">{band[side]}</span>
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </ChartCard>
        <ChartCard title="Progress by scope and schedule" description="Each scope, then its schedules: approved, with the client, with SEL and not submitted.">
          <ScopeProgress tree={tree} />
        </ChartCard>
      </div>

      {/* 4 · the status summary */}
      <StatusSummary tree={tree} total={total} onDownload={canExport ? () => void downloadSummary() : undefined} />

      {/* 5 · what needs attention */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TableCard title="Longest with the client" description="Submitted and waiting for comments or approval" icon={Send} count={stats.courts.client} noun="drawing" scroll="natural">
          {stats.longestClient.length ? <DataList rows={listOf(stats.longestClient)} columns={unitColumns('client')} onRowClick={({ unit }) => openUnit(unit)} frameless dense /> : <p className="p-4 text-sm text-muted-foreground">Nothing with the client.</p>}
        </TableCard>
        <TableCard title="Longest with SEL" description="Comments back from the client, to revise and resubmit" icon={Undo2} count={stats.courts.sel} noun="drawing" scroll="natural">
          {stats.longestSel.length ? <DataList rows={listOf(stats.longestSel)} columns={unitColumns('sel')} onRowClick={({ unit }) => openUnit(unit)} frameless dense /> : <p className="p-4 text-sm text-muted-foreground">No comments to comply with.</p>}
        </TableCard>
        <TableCard title="Overdue against plan" description="Planned end date passed without approval" icon={AlarmClock} count={stats.overdue} noun="drawing" scroll="natural">
          {stats.overdueList.length ? <DataList rows={listOf(stats.overdueList)} columns={unitColumns('overdue')} onRowClick={({ unit }) => openUnit(unit)} frameless dense /> : <p className="p-4 text-sm text-muted-foreground">Nothing overdue.</p>}
        </TableCard>
        <TableCard title="Coming up in 14 days" description="Planned submissions and approvals due soon" icon={CalendarClock} count={stats.upcoming.length} noun="drawing" scroll="natural">
          {stats.upcoming.length ? (
            <DataList
              rows={stats.upcoming.map((entry, index) => ({ ...entry, id: `${entry.unit.item.id}-${entry.unit.sub?.id ?? 'item'}-${index}` }))}
              columns={[
                { header: 'Drawing', mobile: 'title', className: 'max-w-[18rem]', cell: ({ unit }) => <UnitName unit={unit} /> },
                { header: 'Due', className: 'whitespace-nowrap', cell: ({ date }) => formatMdlDate(date) },
                { header: 'For', mobile: 'aside', cell: ({ kind }) => <MdlStatus status={kind === 'submission' ? 'Pending' : 'Under Review'}>{kind === 'submission' ? 'Submission' : 'Approval'}</MdlStatus> },
              ]}
              onRowClick={({ unit }) => openUnit(unit)}
              frameless
              dense
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">Nothing planned in the next two weeks.</p>
          )}
        </TableCard>
      </div>
      {!project.reviewDays && (
        <p className="text-xs text-muted-foreground">
          Overdue at the client and with SEL need the contract&apos;s review and resubmission periods —{' '}
          <Link href={`${MDL_BASE}/settings`} className="font-medium text-primary underline underline-offset-2">
            set them in Settings
          </Link>
          .
        </p>
      )}
    </div>
  );
}
