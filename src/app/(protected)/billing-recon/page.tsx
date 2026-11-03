'use client';

/**
 * Billing Recon's dashboard: every billing project's BOQ, executed, certified and billed value;
 * what waits where and for how long; this month against last month and the financial year; the
 * scopes waiting to be billed; exceptions; and RA bills that need attention. Filter by project and
 * by register (JMC / MVAC); export everything to Excel.
 *
 * Figures come from each project's own register (src/lib/billing-recon/register.ts), so a separated
 * project never counts Project Management's JMCs. Navigation is the sidebar's job; rows open a
 * details dialog in place.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  FileWarning,
  FolderOpen,
  GitBranch,
  HardHat,
  Layers,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Scale,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { FormDialog } from '@/components/shared/form-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { billingReconSlug, useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { BR_TONE, BrHero, BrNotice, BrPage, HeroBar, HeroPanelTitle, HeroStat, type HeroAction } from '@/components/billing-recon/page-kit';
import { useProjectSummaries } from '@/components/billing-recon/dashboard/use-project-summaries';
import {
  ProjectValueChart,
  StagePipelineChart,
  ValueFunnel,
  ValueTrendChart,
  compactInr,
  formatInr,
} from '@/components/billing-recon/dashboard/br-charts';
import {
  AgeingPanel,
  BillsPanel,
  ConversionPanel,
  ExceptionsPanel,
  PeriodPanel,
  ScopesPanel,
  StatusPanel,
} from '@/components/billing-recon/dashboard/dashboard-sections';
import { exportDashboard } from '@/components/billing-recon/dashboard/export-dashboard';
import {
  combineSummaries,
  lastMonths,
  percent,
  summarizeProject,
  type DashboardEntry,
  type PendingEntry,
  type ProjectSummary,
} from '@/lib/billing-recon/dashboard';
import {
  ageingBuckets,
  billRows,
  billsForRegister,
  exceptionList,
  periodComparison,
  statusBreakdown,
  topScopes,
  type RegisterFilter,
} from '@/lib/billing-recon/dashboard-detail';
import { buildReconciliation, type Reconciliation } from '@/lib/billing-recon/reconciliation';
import { isBillingReconSeparated } from '@/lib/billing-recon/register';
import type { RaBill } from '@/lib/billing-recon/types';
import type { Project } from '@/lib/types';

type PendingRow = PendingEntry & { id: string; entryId: string; projectName: string };

interface ProjectView {
  id: string;
  project: Project;
  error?: string;
  jmc: DashboardEntry[];
  mvac: DashboardEntry[];
  bills: RaBill[];
  summary: ProjectSummary;
  reconciliation: Reconciliation | null;
  exceptions: number;
}

type SortKey = 'toBill' | 'awaiting' | 'open' | 'overdue' | 'executed' | 'name';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'toBill', label: 'Certified, not billed' },
  { key: 'awaiting', label: 'Awaiting certification' },
  { key: 'open', label: 'Open entries' },
  { key: 'overdue', label: 'Overdue entries' },
  { key: 'executed', label: 'Executed value' },
  { key: 'name', label: 'Project name' },
];

const REGISTERS: Array<{ key: RegisterFilter; label: string }> = [
  { key: 'all', label: 'JMC + MVAC' },
  { key: 'JMC', label: 'JMC only' },
  { key: 'MVAC', label: 'MVAC only' },
];

const fmtDate = (ms: number | null) => (ms === null ? '—' : format(new Date(ms), 'dd MMM yyyy'));

function sortViews(views: ProjectView[], key: SortKey): ProjectView[] {
  const list = [...views];
  const by = (f: (v: ProjectView) => number) => list.sort((a, b) => f(b) - f(a) || a.project.projectName.localeCompare(b.project.projectName));
  switch (key) {
    case 'name':
      return list.sort((a, b) => a.project.projectName.localeCompare(b.project.projectName));
    case 'awaiting':
      return by((v) => v.summary.values.awaitingCertification);
    case 'open':
      return by((v) => v.summary.pending.length);
    case 'overdue':
      return by((v) => v.summary.overdueCount);
    case 'executed':
      return by((v) => v.summary.values.executed);
    default:
      return by((v) => v.summary.values.certifiedUnbilled);
  }
}

export default function BillingReconDashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { can } = useAuthorization();
  const { billingProjects, loading: projectsLoading } = useBillingReconProjects();
  const { rows, loading, now, reload } = useProjectSummaries(billingProjects, !projectsLoading, { withBoq: true });

  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [register, setRegister] = useState<RegisterFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('toBill');
  const [selected, setSelected] = useState<ProjectView | null>(null);
  const [exporting, setExporting] = useState(false);

  /* Filtered per-project figures. Reconciliation is rebuilt only when a filter changes. */
  const views: ProjectView[] = useMemo(
    () =>
      rows
        .filter((r) => projectFilter === 'all' || r.project.id === projectFilter)
        .map((r) => {
          const jmc = register === 'MVAC' ? [] : r.jmcEntries;
          const mvac = register === 'JMC' ? [] : r.mvacEntries;
          const bills = billsForRegister(r.bills, register);
          const summary = register === 'all' ? r.summary : summarizeProject({ jmcEntries: jmc, mvacEntries: mvac, bills }, now);
          const reconciliation = r.boqItems ? buildReconciliation({ boqItems: r.boqItems, jmcEntries: jmc, mvacEntries: mvac, bills }) : null;
          const t = reconciliation?.totals;
          const exceptions = t ? t.overExecutedItems + t.overBilledItems + t.duplicateItems + reconciliation!.unmatched.length : 0;
          return { id: r.project.id, project: r.project, error: r.error, jmc, mvac, bills, summary, reconciliation, exceptions };
        }),
    [rows, projectFilter, register, now],
  );

  const combined = useMemo(() => combineSummaries(views.map((v) => v.summary)), [views]);
  const trend = useMemo(() => lastMonths(combined.byMonth, now, 12), [combined.byMonth, now]);
  const boq = useMemo(() => {
    const withBoq = views.filter((v) => v.reconciliation);
    return {
      loaded: views.length > 0 && withBoq.length === views.length,
      value: withBoq.reduce((s, v) => s + v.reconciliation!.totals.boqValue, 0),
      items: withBoq.reduce((s, v) => s + v.reconciliation!.totals.items, 0),
    };
  }, [views]);
  const pendingAll: PendingRow[] = useMemo(
    () =>
      views
        .flatMap((v) => v.summary.pending.map((p) => ({ ...p, id: `${v.id}:${p.kind}:${p.id}`, entryId: p.id, projectName: v.project.projectName })))
        .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (b.ageDays ?? 0) - (a.ageDays ?? 0)),
    [views],
  );
  const ageing = useMemo(() => ageingBuckets(pendingAll), [pendingAll]);
  const period = useMemo(() => periodComparison(views.map((v) => ({ jmcEntries: v.jmc, mvacEntries: v.mvac, bills: v.bills })), now), [views, now]);
  const statuses = useMemo(() => statusBreakdown(views.map((v) => ({ jmcEntries: v.jmc, mvacEntries: v.mvac }))), [views]);
  const recProjects = useMemo(
    () => views.filter((v) => v.reconciliation).map((v) => ({ projectId: v.id, projectName: v.project.projectName, reconciliation: v.reconciliation!, rows: v.reconciliation!.rows })),
    [views],
  );
  const scopes = useMemo(() => topScopes(recProjects, 10), [recProjects]);
  const exceptions = useMemo(() => exceptionList(recProjects), [recProjects]);
  const bills = useMemo(() => billRows(views.map((v) => ({ projectId: v.id, projectName: v.project.projectName, bills: v.bills })), now), [views, now]);
  const sortedViews = useMemo(() => sortViews(views, sortKey), [views, sortKey]);

  const sharedProjects = billingProjects.filter((p) => !isBillingReconSeparated(p));
  const canSeparate = can('View', 'Billing Recon.Data Separation');
  const busy = projectsLoading || loading;
  const v = combined.values;
  const many = views.length > 1;
  const exceptionCount = Object.values(exceptions.counts).reduce((s, n) => s + n, 0);

  const filtersLabel = `${projectFilter === 'all' ? 'All billing projects' : views[0]?.project.projectName ?? ''} · ${REGISTERS.find((r) => r.key === register)?.label}`;

  const onExport = async () => {
    setExporting(true);
    try {
      await exportDashboard({
        title: 'Billing Recon dashboard',
        filters: filtersLabel,
        projects: sortedViews.map((pv) => ({
          name: pv.project.projectName,
          register: isBillingReconSeparated(pv.project) ? 'Separated' : 'Shared with PM',
          summary: pv.summary,
          totals: pv.reconciliation?.totals ?? null,
          exceptions: pv.exceptions,
        })),
        pending: pendingAll,
        ageing: ageing.buckets,
        period,
        statuses,
        scopes: topScopes(recProjects, 500),
        exceptions: exceptions.rows,
        bills,
      });
    } catch (error) {
      console.error(error);
      toast({ title: 'Export failed', description: error instanceof Error ? error.message : 'Could not build the workbook.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const projectColumns: ListColumn<ProjectView>[] = [
    {
      header: 'Project',
      mobile: 'title',
      cell: (r) => (
        <div className="min-w-0">
          <span className="block max-w-[16rem] truncate font-medium text-foreground">{r.project.projectName}</span>
          {r.error ? (
            <span className="block text-xs text-destructive">Could not read: {r.error}</span>
          ) : (
            <span className="block text-xs text-muted-foreground">
              {r.summary.counts.jmc} JMC · {r.summary.counts.mvac} MVAC · {r.summary.counts.bills} RA bills
            </span>
          )}
        </div>
      ),
    },
    {
      header: 'Register',
      mobile: 'aside',
      cell: (r) =>
        isBillingReconSeparated(r.project) ? (
          <StatusBadge tone="success" status="Separated" />
        ) : (
          <StatusBadge tone="warning" status="Shared" title="Still shares BOQ and JMC with Project Management" />
        ),
    },
    { header: 'BOQ', align: 'right', cell: (r) => <span className="tabular-nums">{r.reconciliation ? compactInr(r.reconciliation.totals.boqValue) : '—'}</span> },
    {
      header: 'Executed',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums">
          {compactInr(r.summary.values.executed)}
          {r.reconciliation?.totals.boqValue ? <span className="block text-[11px] text-muted-foreground">{percent(r.summary.values.executed, r.reconciliation.totals.boqValue)}% of BOQ</span> : null}
        </span>
      ),
    },
    {
      header: 'Certified',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums">
          {compactInr(r.summary.values.certified)}
          <span className="block text-[11px] text-muted-foreground">{percent(r.summary.values.certified, r.summary.values.executed)}%</span>
        </span>
      ),
    },
    {
      header: 'Billed',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums">
          {compactInr(r.summary.values.billed)}
          <span className="block text-[11px] text-muted-foreground">{percent(r.summary.values.billed, r.summary.values.certified)}%</span>
        </span>
      ),
    },
    { header: 'To bill', align: 'right', cell: (r) => <span className="font-semibold tabular-nums">{compactInr(r.summary.values.certifiedUnbilled)}</span> },
    {
      header: 'Open',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums">
          {r.summary.pending.length}
          {r.summary.overdueCount ? <span className="block text-[11px] text-destructive">{r.summary.overdueCount} overdue</span> : null}
        </span>
      ),
    },
    { header: 'Exceptions', align: 'right', cell: (r) => <span className={r.exceptions ? 'tabular-nums text-foreground' : 'tabular-nums text-muted-foreground'}>{r.reconciliation ? r.exceptions : '—'}</span> },
    { header: 'Last activity', mobile: 'footer', cell: (r) => <span className="text-muted-foreground">{fmtDate(r.summary.lastActivity)}</span> },
  ];

  const pendingColumns: ListColumn<PendingRow>[] = [
    { header: 'Entry', mobile: 'title', cell: (p) => <span className="font-medium text-foreground">{p.kind} {p.number}</span> },
    ...(many ? [{ header: 'Project', cell: (p: PendingRow) => <span className="block max-w-[14rem] truncate">{p.projectName}</span> }] : []),
    { header: 'WO', cell: (p) => p.woNo || '—' },
    { header: 'Stage', cell: (p) => p.stage },
    { header: 'Age', align: 'right', cell: (p) => (p.ageDays === null ? '—' : `${p.ageDays} d`) },
    {
      header: 'Due',
      mobile: 'aside',
      cell: (p) => (p.overdue ? <StatusBadge tone="danger" status={`Overdue · ${fmtDate(p.deadline)}`} /> : <span className="text-muted-foreground">{fmtDate(p.deadline)}</span>),
    },
    { header: 'Value', align: 'right', cell: (p) => <span className="tabular-nums">{compactInr(p.executedValue)}</span> },
  ];

  const singleSlug = projectFilter !== 'all' && views[0] ? billingReconSlug(views[0].project) : '';
  const heroActions: HeroAction[] = singleSlug
    ? [
        ...(can('Create Bill', 'Billing Recon.Billing') ? [{ href: `/billing-recon/${singleSlug}/billing/create`, label: 'New RA bill', icon: Plus, primary: true }] : []),
        ...(can('View', 'Billing Recon.Reconciliation') ? [{ href: `/billing-recon/${singleSlug}/reconciliation`, label: 'Reconciliation', icon: Scale }] : []),
        ...(can('Create JMC Entry', 'Billing Recon.JMC') ? [{ href: `/billing-recon/${singleSlug}/jmc/entry`, label: 'New JMC', icon: HardHat }] : []),
      ]
    : [];

  return (
    <BrPage tone={BR_TONE.dashboard}>
      <PageHeader
        title="Billing Recon"
        description="Client billing reconciliation across projects: what is measured, certified by the client, billed — and what is waiting."
        icon={Receipt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void onExport()} disabled={busy || exporting || views.length === 0}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => reload()} disabled={busy}>
              <RefreshCw className={busy ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Filters: one row above everything they change. */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-9 w-full text-left sm:w-72" aria-label="Project">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All billing projects ({billingProjects.length})</SelectItem>
            {billingProjects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="block max-w-[18rem] truncate">{p.projectName}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={register} onValueChange={(value) => setRegister(value as RegisterFilter)}>
          <SelectTrigger className="h-9 w-full text-left sm:w-44" aria-label="Register">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REGISTERS.map((r) => (
              <SelectItem key={r.key} value={r.key}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{busy ? 'Loading…' : `Updated ${now ? format(new Date(now), 'dd MMM, HH:mm') : '—'}`}</span>
      </div>

      {!projectsLoading && billingProjects.length > 0 && (
        busy ? (
          <Skeleton className="h-48 w-full rounded-3xl" />
        ) : (
          <BrHero
            eyebrow="Certified, not billed"
            live={now ? `Updated ${format(new Date(now), 'HH:mm')}` : undefined}
            value={formatInr(v.certifiedUnbilled)}
            caption={
              <>
                Ready for the next RA bill across {views.length} project{views.length === 1 ? '' : 's'} · <b className="text-white">{percent(v.billed, v.certified)}%</b> of certified value billed
                {boq.loaded && boq.value ? (
                  <>
                    {' '}
                    · <b className="text-white">{percent(v.executed, boq.value)}%</b> of {compactInr(boq.value)} BOQ executed
                  </>
                ) : null}
              </>
            }
            actions={heroActions}
            aside={
              <>
                <HeroPanelTitle left="Where executed work stands" right={`Executed ${compactInr(v.executed)}`} />
                <HeroBar
                  parts={[
                    { label: 'Billed', value: v.billed, color: '#4ade80' },
                    { label: 'Certified, not billed', value: v.certifiedUnbilled, color: '#ffffff' },
                    { label: 'Awaiting certification', value: v.awaitingCertification, color: '#fbbf24' },
                  ]}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <HeroStat label="Billed (RA bills)" value={compactInr(v.billed)} swatch="#4ade80" title={formatInr(v.billed)} hint={`${combined.counts.bills} bills`} />
                  <HeroStat label="Certified, not billed" value={compactInr(v.certifiedUnbilled)} swatch="#ffffff" title={formatInr(v.certifiedUnbilled)} hint="next RA bill" />
                  <HeroStat label="Awaiting certification" value={compactInr(v.awaitingCertification)} swatch="#fbbf24" title={formatInr(v.awaitingCertification)} hint={`${combined.pendingCount} open entries`} />
                </div>
              </>
            }
          />
        )
      )}

      {!projectsLoading && canSeparate && sharedProjects.length > 0 && (
        <BrNotice
          tone="warning"
          icon={GitBranch}
          title={`${sharedProjects.length} of ${billingProjects.length} billing projects still share their register with Project Management`}
          action={
            <Button asChild size="sm" variant="outline" className="bg-white/70 dark:bg-transparent">
              <Link href="/billing-recon/settings/data-separation">Review separation</Link>
            </Button>
          }
        >
          Their BOQ and JMC entries are the same records Project Management sees. Separate them to give Billing Recon its own copy.
        </BrNotice>
      )}

      {!projectsLoading && billingProjects.length === 0 ? (
        <BrNotice
          tone="info"
          icon={FolderOpen}
          title="No project has billing switched on"
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/billing-recon/settings/billing-status">Open Billing Status</Link>
            </Button>
          }
        >
          Billing Recon lists the projects marked as billing-required.
        </BrNotice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {busy ? (
              Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            ) : (
              <>
                <KpiCard label="BOQ value" value={boq.loaded ? compactInr(boq.value) : '—'} hint={`${boq.items.toLocaleString('en-IN')} BOQ items · ${views.length} project${views.length === 1 ? '' : 's'}`} icon={ClipboardList} tone="slate" accent />
                <KpiCard label="Executed" value={compactInr(v.executed)} hint={boq.value ? `${percent(v.executed, boq.value)}% of BOQ · ${combined.counts.jmc} JMC · ${combined.counts.mvac} MVAC` : `${combined.counts.jmc} JMC · ${combined.counts.mvac} MVAC`} icon={Layers} tone="blue" accent />
                <KpiCard label="Certified" value={compactInr(v.certified)} hint={`${percent(v.certified, v.executed)}% of executed`} icon={TrendingUp} tone="orange" accent />
                <KpiCard label="Billed" value={compactInr(v.billed)} hint={`${percent(v.billed, v.certified)}% of certified · ${combined.counts.bills} RA bills`} icon={Wallet} tone="teal" accent />
                <KpiCard label="Certified, not billed" value={compactInr(v.certifiedUnbilled)} hint="Ready for the next RA bill" icon={Wallet} tone="emerald" accent />
                <KpiCard label="Awaiting certification" value={compactInr(v.awaitingCertification)} hint="Executed, not yet certified" icon={Clock} tone="amber" accent />
                <KpiCard label="Open entries" value={combined.pendingCount.toLocaleString('en-IN')} hint={`${combined.overdueCount} overdue · ${combined.counts.draftBills} draft bills`} icon={AlertTriangle} tone={combined.overdueCount ? 'rose' : 'slate'} accent />
                <KpiCard label="Exceptions" value={exceptionCount.toLocaleString('en-IN')} hint={`${exceptions.counts['Over-executed']} over-executed · ${exceptions.counts['Unmatched line']} unmatched`} icon={FileWarning} tone={exceptionCount ? 'violet' : 'slate'} accent />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {busy ? (
              <>
                <Skeleton className="h-64 rounded-xl" />
                <Skeleton className="h-64 rounded-xl" />
              </>
            ) : (
              <>
                <ConversionPanel boq={boq.value} executed={v.executed} certified={v.certified} billed={v.billed} boqLoaded={boq.loaded} />
                <PeriodPanel comparison={period} />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {busy ? (
              <>
                <Skeleton className="h-72 rounded-xl" />
                <Skeleton className="h-72 rounded-xl" />
              </>
            ) : (
              <>
                <ValueTrendChart points={trend} />
                <AgeingPanel buckets={ageing.buckets} undated={ageing.undated} />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {busy ? (
              <>
                <Skeleton className="h-64 rounded-xl" />
                <Skeleton className="h-64 rounded-xl" />
              </>
            ) : (
              <>
                <StagePipelineChart stages={combined.byStage} />
                <StatusPanel rows={statuses} />
              </>
            )}
          </div>

          {!busy && many && (
            <ProjectValueChart
              rows={views.map((pv) => ({ id: pv.id, name: pv.project.projectName, executed: pv.summary.values.executed, certified: pv.summary.values.certified, billed: pv.summary.values.billed }))}
            />
          )}

          <Card className="min-w-0">
            <CardHeader className="flex flex-col gap-2 p-4 pb-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="text-base">Projects</CardTitle>
                <CardDescription className="text-xs">Percentages: executed of BOQ, certified of executed, billed of certified. Select a project for its breakdown.</CardDescription>
              </div>
              <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                <SelectTrigger className="h-8 w-full text-left text-xs sm:w-56" aria-label="Sort projects">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      Sort: {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0 sm:p-4 sm:pt-0">
              {busy ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <DataList rows={sortedViews} columns={projectColumns} onRowClick={setSelected} empty="No billing projects." />
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {busy ? (
              <>
                <Skeleton className="h-64 rounded-xl" />
                <Skeleton className="h-64 rounded-xl" />
              </>
            ) : (
              <>
                <ScopesPanel rows={scopes} showProject={many} />
                <ExceptionsPanel summary={exceptions} showProject={many} />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {busy ? (
              <>
                <Skeleton className="h-64 rounded-xl" />
                <Skeleton className="h-64 rounded-xl" />
              </>
            ) : (
              <>
                <BillsPanel rows={bills} showProject={many} />
                <Card className="min-w-0">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base">Longest waiting</CardTitle>
                    <CardDescription className="text-xs">Open JMC and MVAC entries, overdue first ({pendingAll.length} open).</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 sm:p-4 sm:pt-0">
                    <DataList rows={pendingAll.slice(0, 10)} columns={pendingColumns} dense empty="Nothing is waiting." />
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </>
      )}

      <ProjectDetailsDialog
        view={selected}
        now={now}
        onClose={() => setSelected(null)}
        onOpen={(path) => router.push(path)}
      />
    </BrPage>
  );
}

/* ── one project's breakdown ───────────────────────────────────────────────────────────────── */

function ProjectDetailsDialog({ view, now, onClose, onOpen }: { view: ProjectView | null; now: number; onClose: () => void; onOpen: (path: string) => void }) {
  const { can } = useAuthorization();
  const detail = useMemo(() => {
    if (!view) return null;
    const rec = view.reconciliation;
    const recProjects = rec ? [{ projectId: view.id, projectName: view.project.projectName, reconciliation: rec, rows: rec.rows }] : [];
    return {
      ageing: ageingBuckets(view.summary.pending),
      scopes: topScopes(recProjects, 5),
      exceptions: exceptionList(recProjects),
      bills: billRows([{ projectId: view.id, projectName: view.project.projectName, bills: view.bills }], now).slice(0, 4),
    };
  }, [view, now]);

  const slug = view ? billingReconSlug(view.project) : '';
  const s = view?.summary;
  const t = view?.reconciliation?.totals;

  return (
    <FormDialog
      open={view !== null}
      onOpenChange={(open) => !open && onClose()}
      title={view?.project.projectName ?? ''}
      description={view ? (isBillingReconSeparated(view.project) ? 'Billing Recon register' : 'Still shared with Project Management') : undefined}
      size="xl"
      footer={
        view ? (
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {can('View', 'Billing Recon.Reconciliation') && (
              <Button variant="outline" onClick={() => onOpen(`/billing-recon/${slug}/reconciliation`)}>
                Reconciliation
              </Button>
            )}
            <Button onClick={() => onOpen(`/billing-recon/${slug}`)}>Open project</Button>
          </div>
        ) : undefined
      }
    >
      {view && s && detail && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <MiniStat label="BOQ items" value={t ? t.items.toLocaleString('en-IN') : '—'} />
            <MiniStat label="JMC entries" value={s.counts.jmc.toLocaleString('en-IN')} />
            <MiniStat label="MVAC entries" value={s.counts.mvac.toLocaleString('en-IN')} />
            <MiniStat label="RA bills" value={`${s.counts.bills}${s.counts.draftBills ? ` (${s.counts.draftBills} draft)` : ''}`} />
            <MiniStat label="Exceptions" value={t ? String(view.exceptions) : '—'} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">From BOQ to billed</p>
              <ValueFunnel executed={s.values.executed} certified={s.values.certified} billed={s.values.billed} reference={t?.boqValue || undefined} referenceLabel="BOQ value" />
              <p className="text-xs text-muted-foreground">
                Awaiting certification <span className="font-medium text-foreground">{formatInr(s.values.awaitingCertification)}</span> · Certified, not billed{' '}
                <span className="font-medium text-foreground">{formatInr(s.values.certifiedUnbilled)}</span>
                {t ? (
                  <>
                    {' '}
                    · Left to execute <span className="font-medium text-foreground">{formatInr(t.toExecuteValue)}</span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">
                Open entries <span className="font-normal text-muted-foreground">({s.pending.length}{s.overdueCount ? `, ${s.overdueCount} overdue` : ''})</span>
              </p>
              {s.pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing is waiting.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                  {detail.ageing.buckets
                    .filter((b) => b.count)
                    .map((b) => (
                      <li key={b.key} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <span className="text-muted-foreground">{b.label}</span>
                        <span className="tabular-nums">
                          {b.count}
                          {b.overdue ? <span className="text-destructive"> · {b.overdue} overdue</span> : null}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              {s.byStage.length > 0 && (
                <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                  {s.byStage.map((st) => (
                    <li key={st.stage} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className="min-w-0 truncate">{st.stage}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {st.jmc} JMC · {st.mvac} MVAC
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {detail.scopes.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Scopes waiting to be billed</p>
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {detail.scopes.map((sc) => (
                  <li key={sc.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0 truncate">{[sc.scope2, sc.scope1].filter(Boolean).join(' › ') || 'No scope'}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className="font-medium text-foreground">{compactInr(sc.toBillValue)}</span>
                      <span className="text-muted-foreground"> to bill · {compactInr(sc.toCertifyValue)} to certify</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Exceptions</p>
              {!t ? (
                <p className="text-sm text-muted-foreground">BOQ not loaded.</p>
              ) : detail.exceptions.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">None — every line matches its BOQ item.</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {Object.entries(detail.exceptions.counts)
                    .filter(([, n]) => n)
                    .map(([k, n]) => `${n} ${k.toLowerCase()}`)
                    .join(' · ')}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Latest RA bills</p>
              {detail.bills.length === 0 ? (
                <p className="text-sm text-muted-foreground">No RA bill yet.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                  {detail.bills.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className="min-w-0 truncate">
                        {b.billNo} <span className="text-muted-foreground">· {b.status}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatInr(b.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Last activity {fmtDate(s.lastActivity)}</p>
        </div>
      )}
    </FormDialog>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
