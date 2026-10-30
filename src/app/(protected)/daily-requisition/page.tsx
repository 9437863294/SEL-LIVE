'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { Activity, AlertTriangle, Download, History, ListChecks, Plus, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react';

import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import {
  dailyRequisitionAccess,
  dailyStepNameProblem,
  dailyStepSlug,
  useDailyRequisitionWorkflowSteps,
} from '@/components/daily-requisition/nav';
import { DashboardPanel, FlowBacklogChart, Legend, useDashboardPalette, type FlowPoint, type PanelAction } from '@/components/daily-requisition/dashboard-charts';
import {
  BandLegend,
  Kpi,
  KpiGroup,
  LiveStatus,
  MiniTabs,
  PeriodSegments,
  Sparkline,
  StageFlow,
  Tag,
  WaitBars,
  days,
  inrShort,
  type TagTone,
} from '@/components/daily-requisition/dashboard-overview';
import ViewDailyRequisitionDialog from '@/components/daily-requisition/ViewDailyRequisitionDialog';
import { PageHeader } from '@/components/shared/page-header';
import { BtToolbar, ToolbarDate, ToolbarSelect } from '@/components/bill-tracking/bt-toolbar';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { dateKeyOf, formatDay, localDateKey, toJsDate } from '@/app/(protected)/daily-requisition/reports/_components/report-kit';
import { formatInr } from '@/lib/bank-balance-ledger';
import {
  BACKLOG_DAYS,
  DASHBOARD_PERIODS,
  NO_FILTERS,
  OVERDUE_DAYS,
  WAIT_BANDS,
  activeFilterCount,
  buildDashboard,
  buildOverview,
  daysBetween,
  describePeriod,
  filterRows,
  previousRange,
  stageOfStatus,
  topWithOther,
  type DashboardFilters,
  type DashboardPeriod,
  type DashboardRow,
  type OpenStage,
  type PaidEvent,
  type WeekPoint,
} from '@/lib/daily-requisition-dashboard';
import { balanceOf, paidOf, requisitionProgress } from '@/lib/requisition-progress';
import type { DailyRequisitionEntry, Department, Project } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Stage names when the workflow has fewer than three steps configured. */
const FALLBACK_STAGE_NAMES: Record<OpenStage, string> = {
  receiving: 'Receiving at Finance',
  verification: 'GST & TDS Verification',
  payment: 'Processed for Payment',
};

const STAGE_ORDER: OpenStage[] = ['receiving', 'verification', 'payment'];

/** Each queue's chip in the Needs action list. */
const STAGE_TONE: Record<OpenStage, TagTone> = { receiving: 'blue', verification: 'amber', payment: 'green' };

const OTHER_KEY = '__other__';

/** "At least this much", on the larger of gross and net. */
const AMOUNT_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 10_000, label: '₹10,000+' },
  { value: 50_000, label: '₹50,000+' },
  { value: 100_000, label: '₹1 lakh+' },
  { value: 500_000, label: '₹5 lakh+' },
  { value: 1_000_000, label: '₹10 lakh+' },
];

/** Supporting documents, each with its colour in the Data quality bar. */
const DOCUMENT_BARS = [
  ['Uploaded', 'bg-emerald-500'],
  ['Not Required', 'bg-slate-400'],
  ['Pending', 'bg-amber-500'],
  ['Missing', 'bg-red-500'],
] as const;

type ActionTab = 'oldest' | 'largest' | 'missing';
type GroupTab = 'project' | 'department' | 'party';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** A row of the overview's tables: tight and striped, like Bill Tracking's dashboard. */
const STRIPED_ROW = 'border-slate-100 even:bg-slate-50 hover:bg-emerald-50';

/** A column head of the overview's tables. */
const TH = 'h-8 whitespace-nowrap bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

/** When money went out on a requisition: each voucher line on its instrument date, else the day it was marked paid. */
function paidEventsOf(entry: DailyRequisitionEntry, paid: number, receptionKey: string): PaidEvent[] {
  const payments = entry.payments ?? [];
  if (payments.length > 0) {
    return payments.map((payment) => ({ dateKey: dateKeyOf(payment.instrumentDate), amount: Number(payment.amount) || 0 }));
  }
  if (paid <= 0) return [];
  return [{ dateKey: dateKeyOf(entry.paidAt) || dateKeyOf(entry.lastPaidAt) || receptionKey, amount: paid }];
}

function toRow(entry: DailyRequisitionEntry): DashboardRow {
  const paid = paidOf(entry);
  const dateKey = dateKeyOf(entry.date);
  return {
    id: entry.id,
    receptionNo: entry.receptionNo || '',
    depNo: entry.depNo || '',
    partyName: entry.partyName || '',
    description: entry.description || '',
    departmentId: entry.departmentId || '',
    projectId: entry.projectId || '',
    status: entry.status || 'Pending',
    documentStatus: entry.documentStatus || 'Pending',
    gross: Number(entry.grossAmount) || 0,
    net: Number(entry.netAmount) || 0,
    paid,
    balance: balanceOf(entry),
    dateKey,
    createdMs: toJsDate(entry.createdAt)?.getTime() ?? 0,
    paidEvents: paidEventsOf(entry, paid, dateKey),
  };
}

/** A change against the period before, as a tag: up green, down red; nothing to compare with, nothing. */
function ChangeTag({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return null;
  if (previous === 0) return current > 0 ? <Tag tone="grey">new</Tag> : null;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.05) return <Tag tone="grey">no change</Tag>;
  const size = Math.abs(change) < 10 ? Math.abs(change).toFixed(1) : Math.round(Math.abs(change)).toLocaleString('en-IN');
  return <Tag tone={change > 0 ? 'green' : 'red'}>{`${change > 0 ? '▲' : '▼'} ${size}%`}</Tag>;
}

export default function DailyRequisitionDashboardPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const { steps, isLoading: stepsLoading } = useDailyRequisitionWorkflowSteps();
  const access = useMemo(() => dailyRequisitionAccess(can), [can]);
  const palette = useDashboardPalette();

  // The dashboard shows every requisition's figures, so it opens for whoever may already see them
  // in bulk: the Entry Sheet, the Reports, or any stage queue.
  const canView =
    access.entrySheet || can('View', 'Daily Requisition.Reports') || steps.some((step) => access.stage(step.name));
  const canExport = can('Export', 'Daily Requisition.Reports') || can('Export', 'Daily Requisition.Entry Sheet');
  const canAdd = can('Add', 'Daily Requisition.Entry Sheet');
  const canLoad = !isAuthLoading && !stepsLoading && canView;

  const [entries, setEntries] = useState<DailyRequisitionEntry[] | null>(null);
  const [lookups, setLookups] = useState<{ projects: Project[]; departments: Department[] } | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [todayKey] = useState(() => localDateKey(new Date()));

  const [period, setPeriod] = useState<DashboardPeriod>('this-month');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [filters, setFilters] = useState<DashboardFilters>(NO_FILTERS);
  const [stageFocus, setStageFocus] = useState<OpenStage | null>(null);
  const [actionTab, setActionTab] = useState<ActionTab>('oldest');
  const [groupTab, setGroupTab] = useState<GroupTab>('project');
  const [ageBy, setAgeBy] = useState<'amount' | 'count'>('amount');
  const [selected, setSelected] = useState<DailyRequisitionEntry | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const setFilter = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setPeriod('this-month');
    setCustomRange({ from: '', to: '' });
  };

  // Projects and departments once; they only name things.
  useEffect(() => {
    if (!canLoad) return;
    let active = true;
    Promise.all([getDocs(collection(db, 'projects')), getDocs(collection(db, 'departments'))])
      .then(([projectSnap, departmentSnap]) => {
        if (!active) return;
        setLookups({
          projects: projectSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Project),
          departments: departmentSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department),
        });
      })
      .catch((error) => {
        console.error('Could not load projects and departments for the dashboard:', error);
        if (active) setLookups({ projects: [], departments: [] });
      });
    return () => {
      active = false;
    };
  }, [canLoad]);

  // The requisitions live: a change anywhere — a stage page, the entry sheet, a voucher — shows here
  // as it happens. "Live" is only claimed while the listener is connected to the server.
  useEffect(() => {
    if (!canLoad) return;
    return onSnapshot(
      collection(db, 'dailyRequisitions'),
      { includeMetadataChanges: true },
      (snap) => {
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DailyRequisitionEntry));
        setIsLive(!snap.metadata.fromCache);
        setUpdatedAt(new Date());
        setLoadError(false);
      },
      (error) => {
        console.error('Could not load the Daily Requisition dashboard:', error);
        setIsLive(false);
        setLoadError(true);
        setEntries((current) => current ?? []);
      },
    );
  }, [canLoad]);

  const isLoading = canLoad && (entries === null || lookups === null);

  const rows = useMemo(() => (entries ?? []).map(toRow), [entries]);
  const filtered = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const figures = useMemo(
    () => buildDashboard(filtered, { todayKey, period, custom: customRange }),
    [filtered, todayKey, period, customRange],
  );
  const overview = useMemo(() => buildOverview(filtered, { todayKey, range: figures.range }), [filtered, todayKey, figures.range]);
  const priorRange = useMemo(() => previousRange(figures.range), [figures.range]);
  const prior = useMemo(
    () => (priorRange ? buildDashboard(filtered, { todayKey, period: 'custom', custom: priorRange }) : null),
    [filtered, todayKey, priorRange],
  );
  const filterCount = activeFilterCount(filters);
  const rangeLabel = describePeriod(figures.range);
  const periodLabel = period === 'custom' ? 'Custom' : (DASHBOARD_PERIODS.find((option) => option.value === period)?.label ?? 'Period');

  const stageNames: Record<OpenStage, string> = {
    receiving: steps[0]?.name || FALLBACK_STAGE_NAMES.receiving,
    verification: steps[1]?.name || FALLBACK_STAGE_NAMES.verification,
    payment: steps[2]?.name || FALLBACK_STAGE_NAMES.payment,
  };
  /** Each stage's queue page, where the viewer may open it. */
  const stageHrefs = useMemo(() => {
    const hrefs: Partial<Record<OpenStage, string>> = {};
    STAGE_ORDER.forEach((stage, index) => {
      const step = steps[index];
      if (step && !dailyStepNameProblem(step.name) && access.stage(step.name)) hrefs[stage] = `/daily-requisition/${dailyStepSlug(step.name)}`;
    });
    return hrefs;
  }, [steps, access]);
  /** A panel's link to the report its figures come from, for those who may open the reports. */
  const reportLink = (slug: string, label: string): PanelAction | undefined =>
    access.reports ? { href: `/daily-requisition/reports/${slug}`, label } : undefined;

  const projectName = useMemo(() => {
    const names = new Map((lookups?.projects ?? []).map((p) => [p.id, p.projectName || p.id]));
    return (id: string) => (id ? names.get(id) || id : 'No project');
  }, [lookups]);
  const departmentName = useMemo(() => {
    const names = new Map((lookups?.departments ?? []).map((d) => [d.id, d.name]));
    return (id: string) => (id ? names.get(id) || id : 'No department');
  }, [lookups]);

  /** Only the departments and projects that actually appear, so the lists stay short. */
  const departmentOptions = useMemo(() => {
    const ids = new Set(rows.map((row) => row.departmentId).filter(Boolean));
    return (lookups?.departments ?? []).filter((d) => ids.has(d.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, lookups]);
  const projectOptions = useMemo(() => {
    const ids = new Set(rows.map((row) => row.projectId).filter(Boolean));
    return (lookups?.projects ?? []).filter((p) => ids.has(p.id)).sort((a, b) => (a.projectName || '').localeCompare(b.projectName || ''));
  }, [rows, lookups]);

  const entryById = useMemo(() => new Map((entries ?? []).map((entry) => [entry.id, entry])), [entries]);
  const ageOf = (row: DashboardRow) => (row.dateKey ? Math.max(0, daysBetween(row.dateKey, todayKey)) : null);

  /** Open requisitions to act on: the oldest, the largest, or those whose documents are missing. */
  const needsAction = useMemo(() => {
    const open = filtered.filter((row) => {
      const stage = stageOfStatus(row.status);
      return stage !== 'paid' && stage !== 'cancelled' && (!stageFocus || stage === stageFocus);
    });
    const age = (row: DashboardRow) => (row.dateKey ? daysBetween(row.dateKey, todayKey) : -1);
    const list = actionTab === 'missing' ? open.filter((row) => row.documentStatus === 'Missing') : open;
    const sorted = [...list].sort(
      actionTab === 'largest' ? (a, b) => b.balance - a.balance || age(b) - age(a) : (a, b) => age(b) - age(a) || b.balance - a.balance,
    );
    return { total: list.length, rows: sorted.slice(0, 8) };
  }, [filtered, stageFocus, actionTab, todayKey]);

  const recent = useMemo(() => {
    const allowed = new Set(filtered.map((row) => row.id));
    return (entries ?? [])
      .filter((entry) => allowed.has(entry.id))
      .sort((a, b) => (toJsDate(b.createdAt)?.getTime() ?? 0) - (toJsDate(a.createdAt)?.getTime() ?? 0))
      .slice(0, 8);
  }, [entries, filtered]);

  const flowPoints: FlowPoint[] = figures.monthly.map((month, index) => ({ ...month, backlog: overview.backlogByMonth[index] ?? 0 }));

  // "Due by": the open amount by project, department or party, the top six and the rest as Others.
  const groupSource = groupTab === 'project' ? overview.byProject : groupTab === 'department' ? figures.byDepartment : figures.byParty;
  const groupRows = topWithOther(groupSource.filter((group) => group.balance > 0), 6, OTHER_KEY);
  const groupMax = Math.max(0, ...groupRows.map((group) => group.balance));
  const groupName = (key: string) =>
    key === OTHER_KEY ? 'Others' : groupTab === 'project' ? projectName(key) : groupTab === 'department' ? departmentName(key) : key || '—';

  const openBalance = overview.bands.reduce((sum, band) => sum + band.balance, 0);
  const staleBalance = overview.bands.find((band) => band.key === 'stale')?.balance ?? 0;
  const daysSinceLastPayment = overview.lastPaidKey ? daysBetween(overview.lastPaidKey, todayKey) : null;
  const documentTotal = Object.values(figures.documents).reduce((sum, n) => sum + n, 0);

  // Flow health: the last four weeks against the four before, beside the twelve-week line.
  const lastFour = overview.weekly.slice(-4);
  const priorFour = overview.weekly.slice(-8, -4);
  const perWeek = (weeks: WeekPoint[], pick: (week: WeekPoint) => number) => weeks.reduce((sum, week) => sum + pick(week), 0) / (weeks.length || 1);
  const cycleOf = (weeks: WeekPoint[]) => {
    let total = 0;
    let count = 0;
    for (const week of weeks) {
      if (week.cycleDays === null) continue;
      total += week.cycleDays * week.settled;
      count += week.settled;
    }
    return count ? Math.round(total / count) : null;
  };
  const cycleNow = cycleOf(lastFour);
  const cycleBefore = cycleOf(priorFour);
  const health: Array<{ label: string; value: string; note: string; change: ReactNode; spark: Array<number | null>; tone: string }> = [
    {
      label: 'Avg. cycle time',
      value: days(cycleNow),
      note: 'reception → paid',
      change:
        cycleNow !== null && cycleBefore !== null && cycleNow !== cycleBefore ? (
          <Tag tone={cycleNow > cycleBefore ? 'red' : 'green'}>{`${cycleNow > cycleBefore ? '+' : '−'}${Math.abs(cycleNow - cycleBefore)} d`}</Tag>
        ) : null,
      spark: overview.weekly.map((week) => week.cycleDays),
      tone: cycleNow !== null && cycleBefore !== null && cycleNow > cycleBefore ? 'text-red-600' : 'text-emerald-600',
    },
    {
      label: 'Settled',
      value: `${perWeek(lastFour, (week) => week.settled).toFixed(1).replace(/\.0$/, '')} / wk`,
      note: 'paid in full',
      change: <ChangeTag current={perWeek(lastFour, (week) => week.settled)} previous={perWeek(priorFour, (week) => week.settled)} />,
      spark: overview.weekly.map((week) => week.settled),
      tone: perWeek(lastFour, (week) => week.settled) < perWeek(priorFour, (week) => week.settled) ? 'text-red-600' : 'text-emerald-600',
    },
    {
      label: 'Paid out',
      value: `${inrShort(perWeek(lastFour, (week) => week.paid))} / wk`,
      note: 'by payment date',
      change: <ChangeTag current={perWeek(lastFour, (week) => week.paid)} previous={perWeek(priorFour, (week) => week.paid)} />,
      spark: overview.weekly.map((week) => week.paid),
      tone: perWeek(lastFour, (week) => week.paid) < perWeek(priorFour, (week) => week.paid) ? 'text-red-600' : 'text-emerald-600',
    },
    {
      label: 'Received',
      value: `${perWeek(lastFour, (week) => week.received).toFixed(1).replace(/\.0$/, '')} / wk`,
      note: 'new requisitions',
      change: <ChangeTag current={perWeek(lastFour, (week) => week.received)} previous={perWeek(priorFour, (week) => week.received)} />,
      spark: overview.weekly.map((week) => week.received),
      tone: 'text-blue-600',
    },
  ];

  const quality: Array<{ label: string; count: number; tone: TagTone }> = [
    { label: 'Documents missing', count: overview.quality.missingDocuments, tone: 'red' },
    { label: 'Documents still pending', count: overview.quality.pendingDocuments, tone: 'amber' },
    { label: 'Possible duplicates (same party and amount within 7 days)', count: overview.quality.possibleDuplicates, tone: 'amber' },
    { label: 'Net amount above gross', count: overview.quality.netAboveGross, tone: 'red' },
    { label: 'No project tagged', count: overview.quality.noProject, tone: 'grey' },
    { label: 'No department', count: overview.quality.noDepartment, tone: 'grey' },
    { label: 'No reception date', count: overview.quality.undated, tone: 'grey' },
  ];

  const stageLabel = (row: DashboardRow) => {
    const stage = stageOfStatus(row.status);
    return stage === 'paid' ? 'Paid' : stage === 'cancelled' ? 'Cancelled' : stageNames[stage];
  };

  /** Every requisition the filters allow, newest first, with where it stands. */
  const exportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Requisitions');
      sheet.columns = [
        { header: 'Reception No', key: 'receptionNo', width: 16 },
        { header: 'DEP No', key: 'depNo', width: 14 },
        { header: 'Reception date', key: 'date', width: 14 },
        { header: 'Party', key: 'party', width: 30 },
        { header: 'Project', key: 'project', width: 28 },
        { header: 'Department', key: 'department', width: 22 },
        { header: 'Status', key: 'status', width: 20 },
        { header: 'Stage', key: 'stage', width: 24 },
        { header: 'Days waiting', key: 'age', width: 13 },
        { header: 'Documents', key: 'documents', width: 14 },
        { header: 'Gross (INR)', key: 'gross', width: 16 },
        { header: 'Net (INR)', key: 'net', width: 16 },
        { header: 'Paid (INR)', key: 'paid', width: 16 },
        { header: 'Still due (INR)', key: 'due', width: 16 },
      ];
      for (const row of [...filtered].sort((a, b) => b.dateKey.localeCompare(a.dateKey))) {
        const stage = stageOfStatus(row.status);
        sheet.addRow({
          receptionNo: row.receptionNo,
          depNo: row.depNo,
          date: row.dateKey,
          party: row.partyName,
          project: row.projectId ? projectName(row.projectId) : '',
          department: row.departmentId ? departmentName(row.departmentId) : '',
          status: row.status,
          stage: stageLabel(row),
          age: stage === 'paid' || stage === 'cancelled' ? null : ageOf(row),
          documents: row.documentStatus,
          gross: row.gross,
          net: row.net,
          paid: row.paid,
          due: row.balance,
        });
      }
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `requisitions-overview-${todayKey}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Could not export the requisitions:', error);
      toast({ title: 'Export failed', description: 'The requisitions could not be exported. Try again.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  if (isAuthLoading || stepsLoading) return <DashboardSkeleton />;

  if (!canView) {
    return (
      <div className={dailyPageContainerClass}>
        <PageHeader eyebrow="Daily Requisition" title="Requisitions overview" />
        <Card className="mx-auto max-w-lg border-white/60 bg-white/80">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <ShieldAlert className="h-8 w-8 text-slate-400" />
            <p className="font-medium text-slate-800">No dashboard for your role</p>
            <p className="text-sm text-muted-foreground">
              The dashboard summarises every requisition. Ask an administrator for access to the Entry Sheet, the Reports or a workflow stage.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const backlogHref = overview.backlog.stage ? stageHrefs[overview.backlog.stage] : undefined;
  const readyToPay = overview.stages[2];

  return (
    <div className={cn(dailyPageContainerClass, 'space-y-3')}>
      {/* 1. What this is, how fresh it is, and the two things to do from here. */}
      <PageHeader
        eyebrow="Daily Requisition"
        title="Requisitions overview"
        actions={
          <>
            <LiveStatus live={isLive} updatedAt={updatedAt} />
            {canExport ? (
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void exportExcel()} disabled={isExporting || isLoading || filtered.length === 0}>
                <Download className="h-4 w-4" />
                {isExporting ? 'Exporting…' : 'Export'}
              </Button>
            ) : null}
            {canAdd ? (
              <Button asChild size="sm" className="h-9 gap-1.5">
                <Link href="/daily-requisition/entry-sheet?new=1">
                  <Plus className="h-4 w-4" /> New requisition
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {/* 2. Bill Tracking's filter toolbar, the period as one switch. Everything below reads only the
          requisitions these filters allow; the period decides which days "this period" covers. */}
      <BtToolbar
        controls={
          <>
            <PeriodSegments value={period} onChange={setPeriod} />
            {period === 'custom' && (
              <>
                <ToolbarDate label="From" value={customRange.from} onChange={(value) => setCustomRange((range) => ({ ...range, from: value }))} />
                <ToolbarDate label="To" value={customRange.to} onChange={(value) => setCustomRange((range) => ({ ...range, to: value }))} />
              </>
            )}
            <ToolbarSelect
              label="Department"
              value={filters.departmentId}
              onChange={(value) => setFilter('departmentId', value)}
              options={departmentOptions.map((d) => ({ value: d.id, label: d.name }))}
              allLabel="All"
            />
            <ToolbarSelect
              label="Project"
              value={filters.projectId}
              onChange={(value) => setFilter('projectId', value)}
              options={projectOptions.map((p) => ({ value: p.id, label: p.projectName || p.id }))}
              allLabel="All"
            />
            <ToolbarSelect
              label="Documents"
              value={filters.documentStatus}
              onChange={(value) => setFilter('documentStatus', value)}
              options={[
                { value: 'Uploaded', label: 'Uploaded' },
                { value: 'Pending', label: 'Pending' },
                { value: 'Missing', label: 'Missing' },
                { value: 'Not Required', label: 'Not required' },
              ]}
              allLabel="Any"
            />
            <ToolbarSelect
              label="Amount"
              value={filters.minAmount ? String(filters.minAmount) : ''}
              onChange={(value) => setFilter('minAmount', Number(value) || 0)}
              options={AMOUNT_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
              allLabel="Any"
            />
            <button
              type="button"
              aria-pressed={filters.dueOnly}
              onClick={() => setFilter('dueOnly', !filters.dueOnly)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium shadow-sm transition-colors',
                filters.dueOnly ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-input bg-white text-muted-foreground hover:text-foreground',
              )}
            >
              Still due only
              {filters.dueOnly ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </button>
          </>
        }
        activeCount={filterCount + (period === 'this-month' ? 0 : 1)}
        onClear={clearFilters}
        summary={
          <span>
            <span className="font-semibold text-slate-700">{filtered.length.toLocaleString('en-IN')}</span>
            {filtered.length !== rows.length && <> of {rows.length.toLocaleString('en-IN')}</>} requisition
            {filtered.length === 1 ? '' : 's'} · <span className="whitespace-nowrap">{rangeLabel}</span>
          </span>
        }
      />

      {loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          The requisitions could not be loaded. Check the connection and reload the page.
        </div>
      )}

      {isLoading ? (
        <DashboardSkeleton bare />
      ) : filtered.length === 0 && rows.length > 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card p-10 text-center">
          <Search className="h-7 w-7 text-muted-foreground/50" />
          <p className="font-medium text-foreground">No requisition matches these filters</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {rows.length.toLocaleString('en-IN')} requisitions were loaded. Widen the filters, or clear them to start again.
          </p>
          <Button variant="outline" size="sm" className="mt-1" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          {/* 3. The one thing to deal with first: open work past BACKLOG_DAYS. */}
          {overview.backlog.count > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 sm:flex-row sm:items-center">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-red-700 shadow-sm" aria-hidden="true">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <p className="min-w-0 flex-1 text-sm text-red-950">
                <b className="text-red-700">
                  {plural(overview.backlog.count, 'requisition')} ({inrShort(overview.backlog.balance)}) {overview.backlog.count === 1 ? 'has' : 'have'} waited
                  more than {BACKLOG_DAYS} days
                </b>
                {overview.backlog.stage ? (
                  <>
                    {overview.backlog.stageCount === overview.backlog.count
                      ? overview.backlog.count === 1
                        ? ', at '
                        : ', all of them at '
                      : `, ${overview.backlog.stageCount.toLocaleString('en-IN')} of them at `}
                    <b className="text-red-700">{stageNames[overview.backlog.stage]}</b>
                  </>
                ) : null}
                .
                {daysSinceLastPayment === null
                  ? ' Nothing has been paid yet.'
                  : daysSinceLastPayment > 30
                    ? ` Nothing has been paid in ${daysSinceLastPayment.toLocaleString('en-IN')} days.`
                    : ''}{' '}
                Clear or cancel it, so the rest of these figures mean something.
              </p>
              {backlogHref ? (
                <Button asChild variant="outline" size="sm" className="shrink-0 border-red-200 bg-white text-red-700 hover:bg-red-100 hover:text-red-800">
                  <Link href={backlogHref}>Review backlog →</Link>
                </Button>
              ) : null}
            </div>
          )}

          {/* 4. The headline figures: what stands now, whatever the period, and what moved in it. */}
          <div className="grid gap-3 xl:grid-cols-5">
            <KpiGroup title="Right now" note="Ignores the period" className="xl:col-span-3">
              <Kpi
                label="Open requisitions"
                value={figures.open.count.toLocaleString('en-IN')}
                sub={<span title={formatInr(figures.open.balance)}>{inrShort(figures.open.balance)} still due</span>}
              />
              <Kpi
                label="Waiting"
                tag={<Tag tone="red">{`> ${OVERDUE_DAYS} days`}</Tag>}
                value={overview.overdue.count.toLocaleString('en-IN')}
                valueClassName={overview.overdue.count > 0 ? 'text-red-700' : undefined}
                sub={
                  <span title={formatInr(overview.overdue.balance)}>
                    {inrShort(overview.overdue.balance)} ·{' '}
                    {figures.open.count ? `${((overview.overdue.count / figures.open.count) * 100).toFixed(1)}%` : '0%'} of open
                  </span>
                }
              />
              <Kpi
                label="Ready to pay"
                value={inrShort(readyToPay.balance)}
                valueTitle={formatInr(readyToPay.balance)}
                sub={`${plural(readyToPay.count, 'requisition')}${readyToPay.oldestDays !== null ? ` · oldest ${days(readyToPay.oldestDays)}` : ''}`}
                href={stageHrefs.payment}
              />
            </KpiGroup>
            <KpiGroup
              title={period === 'all' ? 'All time' : `${periodLabel} · ${rangeLabel}`}
              note={priorRange ? `vs ${describePeriod(priorRange)}` : undefined}
              className="xl:col-span-2"
            >
              <Kpi
                label="Received"
                value={inrShort(figures.received.net)}
                valueTitle={formatInr(figures.received.net)}
                sub={
                  <>
                    {plural(figures.received.count, 'requisition')}
                    <ChangeTag current={figures.received.net} previous={prior ? prior.received.net : null} />
                  </>
                }
              />
              <Kpi
                label="Paid out"
                value={inrShort(figures.paidOut.amount)}
                valueTitle={formatInr(figures.paidOut.amount)}
                sub={
                  <>
                    {plural(figures.paidOut.requisitions, 'requisition')}
                    {figures.paidOut.amount === 0 ? (
                      <Tag tone="amber">No payments</Tag>
                    ) : (
                      <ChangeTag current={figures.paidOut.amount} previous={prior ? prior.paidOut.amount : null} />
                    )}
                  </>
                }
              />
            </KpiGroup>
          </div>

          {/* 5. Each queue with its wait profile, then what has been paid. */}
          <DashboardPanel
            title="Workflow pipeline"
            description="Where open requisitions sit, how long they have waited and what is due at each stage. Pick a stage to narrow Needs action."
            legend={<BandLegend bands={WAIT_BANDS} />}
          >
            <StageFlow
              stages={STAGE_ORDER.map((stage, index) => ({ key: stage, name: stageNames[stage], profile: overview.stages[index] }))}
              selected={stageFocus}
              onSelect={setStageFocus}
              paid={{
                label: period === 'custom' ? rangeLabel : periodLabel.toLowerCase(),
                count: figures.paidOut.requisitions,
                amount: figures.paidOut.amount,
                avgCycleDays: overview.settled.avgCycleDays,
                lastPaidDays: daysSinceLastPayment,
              }}
              overdueDays={OVERDUE_DAYS}
              backlogDays={BACKLOG_DAYS}
            />
          </DashboardPanel>

          {/* 6. Money in and out, and how long the rest has waited. */}
          <div className="grid gap-3 xl:grid-cols-5">
            <DashboardPanel
              className="xl:col-span-3"
              title="Received vs paid, and the backlog it leaves"
              description="Net received (by reception date) and paid out each month, and what was still owed at each month end — last 12 months."
              legend={
                <Legend
                  items={[
                    { label: 'Received', color: palette.received },
                    { label: 'Paid', color: palette.paid },
                    { label: 'Open backlog', color: palette.backlog, line: true },
                  ]}
                />
              }
              action={reportLink('monthly-trend', 'Monthly trend')}
            >
              <FlowBacklogChart points={flowPoints} />
              {figures.paidAhead.count > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatInr(figures.paidAhead.amount)} in post-dated payments ({plural(figures.paidAhead.count, 'payment')}) is not counted until its date.
                </p>
              )}
            </DashboardPanel>

            <DashboardPanel
              className="xl:col-span-2"
              title="Ageing of open requisitions"
              description="Days since the reception date, by amount still due or by count."
              tools={
                <MiniTabs
                  label="Measure ageing by"
                  value={ageBy}
                  onChange={setAgeBy}
                  options={[
                    { value: 'amount', label: 'Amount' },
                    { value: 'count', label: 'Count' },
                  ]}
                />
              }
            >
              {overview.bands.every((band) => band.count === 0) ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No open requisitions.</p>
              ) : (
                <>
                  <WaitBars bands={overview.bands} by={ageBy} />
                  {staleBalance > 0 && openBalance > 0 ? (
                    <p className="mt-4 text-xs text-muted-foreground">
                      <b className="text-foreground">{Math.round((staleBalance / openBalance) * 100)}%</b> of the open amount is older than {BACKLOG_DAYS} days.
                    </p>
                  ) : null}
                  {access.reports ? (
                    <Link href="/daily-requisition/reports/ageing" className="mt-3 inline-flex text-xs font-medium text-emerald-700 hover:underline">
                      Ageing report →
                    </Link>
                  ) : null}
                </>
              )}
            </DashboardPanel>
          </div>

          {/* 7. Where the money is owed, and what to pick up first. */}
          <div className="grid gap-3 xl:grid-cols-3">
            <DashboardPanel
              title="Due by"
              description="Top six by amount still due."
              tools={
                <MiniTabs
                  label="Group what is due by"
                  value={groupTab}
                  onChange={setGroupTab}
                  options={[
                    { value: 'project', label: 'Project' },
                    { value: 'department', label: 'Dept' },
                    { value: 'party', label: 'Vendor' },
                  ]}
                />
              }
              contentClassName="p-0"
            >
              {groupRows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing is due.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={cn(TH, 'pl-4')}>{groupTab === 'project' ? 'Project' : groupTab === 'department' ? 'Department' : 'Vendor'}</TableHead>
                      <TableHead className={cn(TH, 'text-right')}>Open</TableHead>
                      <TableHead className={cn(TH, 'pr-4 text-right')}>Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupRows.map((group) => {
                      const name = groupName(group.key);
                      return (
                        <TableRow key={group.key} className={STRIPED_ROW}>
                          <TableCell className="w-full max-w-0 py-2 pl-4">
                            {groupTab === 'party' && access.entrySheet && group.key && group.key !== OTHER_KEY && group.key !== '—' ? (
                              <Link
                                href={`/daily-requisition/entry-sheet?q=${encodeURIComponent(group.key)}`}
                                className="block truncate text-sm font-medium hover:text-emerald-700 hover:underline"
                                title={`${name} — open on the Entry Sheet`}
                              >
                                {name}
                              </Link>
                            ) : (
                              <span className="block truncate text-sm font-medium" title={name}>
                                {name}
                              </span>
                            )}
                            <div className="mt-1 h-1 rounded-full bg-muted">
                              <div className="h-1 rounded-full" style={{ width: `${groupMax ? (group.balance / groupMax) * 100 : 0}%`, backgroundColor: palette.received }} />
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums">{group.count.toLocaleString('en-IN')}</TableCell>
                          <TableCell className="whitespace-nowrap py-2 pr-4 text-right font-semibold tabular-nums" title={formatInr(group.balance)}>
                            {inrShort(group.balance)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </DashboardPanel>

            <DashboardPanel
              className="xl:col-span-2"
              title="Needs action"
              icon={ListChecks}
              description={
                actionTab === 'largest'
                  ? 'Open requisitions with the most still due.'
                  : actionTab === 'missing'
                    ? 'Open requisitions whose documents are marked missing, oldest first.'
                    : 'Open requisitions that have waited longest.'
              }
              tools={
                <MiniTabs
                  label="Which requisitions need action"
                  value={actionTab}
                  onChange={setActionTab}
                  options={[
                    { value: 'oldest', label: 'Oldest' },
                    { value: 'largest', label: 'Largest' },
                    { value: 'missing', label: 'Missing docs' },
                  ]}
                />
              }
              contentClassName="p-0"
            >
              {stageFocus ? (
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs">
                  <span className="text-muted-foreground">Only</span>
                  <Tag tone={STAGE_TONE[stageFocus]}>{stageNames[stageFocus]}</Tag>
                  <button type="button" onClick={() => setStageFocus(null)} className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" aria-hidden="true" /> Every stage
                  </button>
                  {stageHrefs[stageFocus] ? (
                    <Link href={stageHrefs[stageFocus]!} className="ml-auto font-medium text-emerald-700 hover:underline">
                      Open {stageNames[stageFocus]} →
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {needsAction.rows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {actionTab === 'missing' ? 'No open requisition has missing documents.' : 'Nothing is open.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className={cn(TH, 'pl-4')}>Req. no</TableHead>
                        <TableHead className={TH}>Project · Vendor</TableHead>
                        <TableHead className={TH}>Stage</TableHead>
                        <TableHead className={cn(TH, 'text-right')}>Age</TableHead>
                        <TableHead className={cn(TH, 'pr-4 text-right')}>Due</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {needsAction.rows.map((row) => {
                        const entry = entryById.get(row.id);
                        const age = ageOf(row);
                        const stage = stageOfStatus(row.status) as OpenStage;
                        return (
                          <TableRow
                            key={row.id}
                            className={cn('cursor-pointer', STRIPED_ROW)}
                            tabIndex={0}
                            onClick={() => entry && setSelected(entry)}
                            onKeyDown={(event) => {
                              if ((event.key === 'Enter' || event.key === ' ') && entry) {
                                event.preventDefault();
                                setSelected(entry);
                              }
                            }}
                          >
                            <TableCell className="whitespace-nowrap py-1.5 pl-4 font-mono text-xs font-semibold">{row.receptionNo || '—'}</TableCell>
                            <TableCell className="max-w-[18rem] py-1.5">
                              <span className="block truncate text-sm" title={`${projectName(row.projectId)} · ${row.partyName}`}>
                                <span className="text-muted-foreground">{projectName(row.projectId)} · </span>
                                {row.partyName || '—'}
                              </span>
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Tag tone={STAGE_TONE[stage] ?? 'grey'}>{stageNames[stage] ?? row.status}</Tag>
                            </TableCell>
                            <TableCell className="py-1.5 text-right">
                              {age === null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <Tag tone={age > BACKLOG_DAYS ? 'red' : age > OVERDUE_DAYS ? 'amber' : 'green'}>{`${age.toLocaleString('en-IN')} d`}</Tag>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5 pr-4 text-right font-semibold tabular-nums" title={formatInr(row.balance)}>
                              {inrShort(row.balance)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {needsAction.total > needsAction.rows.length ? (
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                  Showing {needsAction.rows.length} of {needsAction.total.toLocaleString('en-IN')}. Click a row for its details.
                </p>
              ) : null}
            </DashboardPanel>
          </div>

          {/* 8. Is the team keeping up? */}
          <DashboardPanel
            title="Flow health"
            icon={Activity}
            description="The last 4 weeks against the 4 before, with the 12-week trend."
            contentClassName="p-0"
          >
            <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
              {health.map((metric) => (
                <div key={metric.label} className="flex min-w-0 items-end justify-between gap-3 bg-card px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                    <p className="mt-0.5 truncate text-xl font-bold tracking-tight tabular-nums text-foreground">{metric.value}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {metric.note}
                      {metric.change}
                    </p>
                  </div>
                  <Sparkline values={metric.spark} className={metric.tone} />
                </div>
              ))}
            </div>
          </DashboardPanel>

          {/* 9. What to fix in the data, and what came in last. */}
          <div className="grid gap-3 xl:grid-cols-3">
            <DashboardPanel
              title="Data quality"
              icon={ShieldCheck}
              description="Open requisitions to fix before they reach payment."
              action={access.manageDocuments ? { href: '/daily-requisition/manage-documents', label: 'Documents' } : undefined}
            >
              {documentTotal > 0 ? (
                <div className="mb-3">
                  <div
                    className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={DOCUMENT_BARS.map(([label]) => `${label}: ${figures.documents[label]}`).join(', ')}
                  >
                    {DOCUMENT_BARS.filter(([label]) => figures.documents[label] > 0).map(([label, bar]) => (
                      <span
                        key={label}
                        className={cn('h-full', bar)}
                        style={{ width: `${(figures.documents[label] / documentTotal) * 100}%`, minWidth: 3 }}
                        title={`${label}: ${figures.documents[label].toLocaleString('en-IN')}`}
                      />
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {DOCUMENT_BARS.map(([label, bar]) => (
                      <span key={label} className="inline-flex items-center gap-1">
                        <span aria-hidden className={cn('h-2 w-2 rounded-sm', bar)} />
                        {label} {Math.round((figures.documents[label] / documentTotal) * 100)}%
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <ul className="divide-y">
                {quality.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 text-foreground">{item.label}</span>
                    <Tag tone={item.count > 0 ? item.tone : 'grey'}>{item.count.toLocaleString('en-IN')}</Tag>
                  </li>
                ))}
              </ul>
            </DashboardPanel>

            <DashboardPanel
              title="Recently added"
              icon={History}
              description="The latest requisitions keyed in. Click one for its details."
              className="xl:col-span-2"
              action={access.entrySheet ? { href: '/daily-requisition/entry-sheet', label: 'Entry sheet' } : undefined}
              contentClassName="p-0"
            >
              {recent.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">No requisitions yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className={cn(TH, 'pl-4')}>Reception No</TableHead>
                        <TableHead className={TH}>Date</TableHead>
                        <TableHead className={TH}>Party</TableHead>
                        <TableHead className={TH}>Status</TableHead>
                        <TableHead className={cn(TH, 'pr-4 text-right')}>Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.map((entry) => {
                        const progress = requisitionProgress(entry);
                        return (
                          <TableRow
                            key={entry.id}
                            className={cn('cursor-pointer', STRIPED_ROW)}
                            tabIndex={0}
                            onClick={() => setSelected(entry)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelected(entry);
                              }
                            }}
                          >
                            <TableCell className="whitespace-nowrap py-1.5 pl-4 font-mono text-xs font-medium">{entry.receptionNo}</TableCell>
                            <TableCell className="whitespace-nowrap py-1.5 text-sm">{formatDay(entry.date)}</TableCell>
                            <TableCell className="max-w-[14rem] truncate py-1.5 text-sm" title={entry.partyName}>
                              {entry.partyName || '—'}
                            </TableCell>
                            <TableCell className="py-1.5">
                              <StatusBadge tone={progress.tone}>{progress.label}</StatusBadge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5 pr-4 text-right tabular-nums">{formatInr(entry.netAmount)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </DashboardPanel>
          </div>
        </>
      )}

      {selected && (
        <ViewDailyRequisitionDialog
          isOpen={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          entry={selected}
          projects={lookups?.projects ?? []}
          departments={lookups?.departments ?? []}
          // The list is live: whatever the dialog changes arrives through the listener.
          onActionComplete={() => undefined}
        />
      )}
    </div>
  );
}

function DashboardSkeleton({ bare = false }: { bare?: boolean }) {
  const body = (
    <div className="space-y-3" aria-busy="true">
      <div className="grid gap-3 xl:grid-cols-5">
        <Skeleton className="h-28 rounded-xl xl:col-span-3" />
        <Skeleton className="h-28 rounded-xl xl:col-span-2" />
      </div>
      <Skeleton className="h-52 rounded-xl" />
      <div className="grid gap-3 xl:grid-cols-5">
        <Skeleton className="h-80 rounded-xl xl:col-span-3" />
        <Skeleton className="h-80 rounded-xl xl:col-span-2" />
      </div>
    </div>
  );
  if (bare) return body;
  return (
    <div className={cn(dailyPageContainerClass, 'space-y-3')}>
      <Skeleton className="h-12 w-full max-w-md" />
      <Skeleton className="h-14 w-full rounded-xl" />
      {body}
    </div>
  );
}
