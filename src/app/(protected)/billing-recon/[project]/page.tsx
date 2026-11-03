'use client';

/**
 * A project's Billing Recon overview: what has been measured, certified and billed against its
 * BOQ, what waits at which stage and for how long, the scopes waiting to be billed, exceptions,
 * and the latest RA bills — all from the project's own register (src/lib/billing-recon/register.ts).
 * Navigation is the sidebar's job; the banner carries the few actions people start from here.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Calculator,
  ClipboardList,
  Clock,
  FileWarning,
  GitBranch,
  HardHat,
  History,
  LayoutDashboard,
  Layers,
  Plus,
  RefreshCw,
  Scale,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { useProjectSummaries } from '@/components/billing-recon/dashboard/use-project-summaries';
import { StagePipelineChart, ValueTrendChart, compactInr, formatInr } from '@/components/billing-recon/dashboard/br-charts';
import {
  AgeingPanel,
  ConversionPanel,
  ExceptionsPanel,
  Panel,
  PeriodPanel,
  ScopesPanel,
  statusTone,
} from '@/components/billing-recon/dashboard/dashboard-sections';
import {
  BR_TONE,
  BrAccessDenied,
  BrHero,
  BrNotice,
  BrPage,
  BrPageSkeleton,
  HeroBar,
  HeroPanelTitle,
  HeroStat,
  type HeroAction,
} from '@/components/billing-recon/page-kit';
import { lastMonths, percent, type PendingEntry } from '@/lib/billing-recon/dashboard';
import { ageingBuckets, billRows, exceptionList, periodComparison, topScopes, type BillRow } from '@/lib/billing-recon/dashboard-detail';
import { buildReconciliation } from '@/lib/billing-recon/reconciliation';

const fmtDate = (ms: number | null) => (ms === null ? '—' : format(new Date(ms), 'dd MMM yyyy'));

type PendingRow = PendingEntry & { id: string; entryId: string };

export default function ProjectOverviewPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const { currentProject, loading: projectsLoading, register, currentSlug } = useBillingReconProjects();
  const projects = useMemo(() => (currentProject ? [currentProject] : []), [currentProject]);
  const { rows, loading, now, reload } = useProjectSummaries(projects, Boolean(currentProject), { withBoq: true });
  const loaded = rows[0];

  const detail = useMemo(() => {
    if (!loaded) return null;
    const reconciliation = loaded.boqItems
      ? buildReconciliation({ boqItems: loaded.boqItems, jmcEntries: loaded.jmcEntries, mvacEntries: loaded.mvacEntries, bills: loaded.bills })
      : null;
    const recProjects = reconciliation ? [{ projectId: loaded.project.id, projectName: loaded.project.projectName, reconciliation, rows: reconciliation.rows }] : [];
    return {
      reconciliation,
      trend: lastMonths(loaded.summary.byMonth, now, 12),
      ageing: ageingBuckets(loaded.summary.pending),
      period: periodComparison([{ jmcEntries: loaded.jmcEntries, mvacEntries: loaded.mvacEntries, bills: loaded.bills }], now),
      scopes: topScopes(recProjects, 8),
      exceptions: exceptionList(recProjects),
      bills: billRows([{ projectId: loaded.project.id, projectName: loaded.project.projectName, bills: loaded.bills }], now).slice(0, 6),
      pending: loaded.summary.pending.slice(0, 10).map((p) => ({ ...p, id: `${p.kind}:${p.id}`, entryId: p.id })),
    };
  }, [loaded, now]);

  if (authLoading || projectsLoading) return <BrPageSkeleton hero kpis={4} blocks={2} />;
  if (!can('View Module', 'Billing Recon')) return <BrAccessDenied message="You do not have permission to view this project's Billing Recon overview." />;
  if (!currentProject) {
    return (
      <BrPage tone={BR_TONE.project}>
        <PageHeader title="Project not found" icon={LayoutDashboard} />
        <BrNotice tone="info" icon={LayoutDashboard} title={`No project matches “${currentSlug}”`}>
          Pick one from the project switcher at the top of the menu.
        </BrNotice>
      </BrPage>
    );
  }

  const summary = loaded?.summary;
  const busy = loading || !summary || !detail;
  const v = summary?.values;
  const t = detail?.reconciliation?.totals;
  const contractValue = Number(currentProject.contractValue) || 0;
  const boqValue = t?.boqValue ?? 0;
  const slug = currentSlug;
  const exceptionCount = detail ? Object.values(detail.exceptions.counts).reduce((s, n) => s + n, 0) : 0;

  const actions: HeroAction[] = [
    ...(can('Create JMC Entry', 'Billing Recon.JMC') ? [{ href: `/billing-recon/${slug}/jmc/entry`, label: 'New JMC', icon: HardHat, primary: true }] : []),
    // MVAC rights can be granted per project (scope = the URL slug), as the MVAC pages check them.
    ...(can('Create MVAC Entry', 'Billing Recon.MVAC', slug) ? [{ href: `/billing-recon/${slug}/mvac/entry`, label: 'New MVAC', icon: Truck }] : []),
    ...(can('Create Bill', 'Billing Recon.Billing') ? [{ href: `/billing-recon/${slug}/billing/create`, label: 'New RA bill', icon: Plus }] : []),
    ...(can('View', 'Billing Recon.Reconciliation') ? [{ href: `/billing-recon/${slug}/reconciliation`, label: 'Reconciliation', icon: Scale }] : []),
  ];

  const pendingColumns: ListColumn<PendingRow>[] = [
    { header: 'Entry', mobile: 'title', cell: (p) => <span className="font-medium text-foreground">{p.kind} {p.number}</span> },
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

  const billColumns: ListColumn<BillRow>[] = [
    {
      header: 'Bill',
      mobile: 'title',
      cell: (b) => (
        <span className="font-medium text-foreground">
          {b.billNo}
          {b.raSequence ? <span className="font-normal text-muted-foreground"> · RA {b.raSequence}</span> : null}
        </span>
      ),
    },
    { header: 'Date', cell: (b) => b.billDate || '—' },
    { header: 'Status', mobile: 'aside', cell: (b) => <StatusBadge tone={b.status === 'Draft' ? 'warning' : statusTone(b.status)} status={b.status} /> },
    { header: 'Needs', cell: (b) => (b.issue ? <span className="text-amber-700 dark:text-amber-300">{b.issue}</span> : <span className="text-muted-foreground">—</span>) },
    { header: 'Amount', align: 'right', cell: (b) => <span className="tabular-nums">{formatInr(b.amount)}</span> },
  ];

  return (
    <BrPage tone={BR_TONE.project}>
      <PageHeader
        title={currentProject.projectName}
        description="Measured, certified by the client, and billed — for this project."
        icon={LayoutDashboard}
        actions={
          <Button variant="outline" size="sm" onClick={() => reload()} disabled={busy}>
            <RefreshCw className={busy ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
            Refresh
          </Button>
        }
      />

      {busy || !v ? (
        <Skeleton className="h-48 w-full rounded-3xl" />
      ) : (
        <BrHero
          eyebrow={register.separated ? 'Certified, not billed · own register' : 'Certified, not billed'}
          live={now ? `Updated ${format(new Date(now), 'HH:mm')}` : undefined}
          value={formatInr(v.certifiedUnbilled)}
          caption={
            <>
              <b className="text-white">{percent(v.billed, v.certified)}%</b> of certified value billed
              {boqValue ? (
                <>
                  {' '}
                  · <b className="text-white">{percent(v.executed, boqValue)}%</b> of {compactInr(boqValue)} BOQ executed
                </>
              ) : null}
              {contractValue ? <> · contract {compactInr(contractValue)}</> : null}
            </>
          }
          actions={actions}
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
                <HeroStat label="Billed (RA bills)" value={compactInr(v.billed)} swatch="#4ade80" title={formatInr(v.billed)} hint={`${summary!.counts.bills} bills`} />
                <HeroStat label="Certified, not billed" value={compactInr(v.certifiedUnbilled)} swatch="#ffffff" title={formatInr(v.certifiedUnbilled)} hint="next RA bill" />
                <HeroStat label="Awaiting certification" value={compactInr(v.awaitingCertification)} swatch="#fbbf24" title={formatInr(v.awaitingCertification)} hint={`${summary!.pending.length} open entries`} />
              </div>
            </>
          }
        />
      )}

      {!register.separated && (
        <BrNotice
          tone="warning"
          icon={GitBranch}
          title="This project still shares its BOQ and JMC register with Project Management"
          action={
            can('View', 'Billing Recon.Data Separation') ? (
              <Button asChild size="sm" variant="outline" className="bg-white/70 dark:bg-transparent">
                <Link href="/billing-recon/settings/data-separation">Review separation</Link>
              </Button>
            ) : undefined
          }
        >
          JMCs raised in either module show in both. Separate the project to give Billing Recon its own records.
        </BrNotice>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {busy || !v ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <KpiCard label="BOQ value" value={t ? compactInr(t.boqValue) : '—'} hint={t ? `${t.items.toLocaleString('en-IN')} BOQ items · ${register.separated ? 'own BOQ' : 'shared BOQ'}` : undefined} icon={ClipboardList} tone="slate" accent />
            <KpiCard label="Executed" value={compactInr(v.executed)} hint={boqValue ? `${percent(v.executed, boqValue)}% of BOQ · ${summary!.counts.jmc} JMC · ${summary!.counts.mvac} MVAC` : `${summary!.counts.jmc} JMC · ${summary!.counts.mvac} MVAC`} icon={Layers} tone="blue" accent />
            <KpiCard label="Certified" value={compactInr(v.certified)} hint={`${percent(v.certified, v.executed)}% of executed`} icon={TrendingUp} tone="orange" accent />
            <KpiCard label="Billed" value={compactInr(v.billed)} hint={`${percent(v.billed, v.certified)}% of certified · ${summary!.counts.bills} RA bills`} icon={Wallet} tone="teal" accent />
            <KpiCard label="Left to execute" value={t ? compactInr(t.toExecuteValue) : '—'} hint="BOQ quantity not yet measured" icon={Calculator} tone="indigo" accent />
            <KpiCard label="Awaiting certification" value={compactInr(v.awaitingCertification)} hint="Executed, not yet certified" icon={Clock} tone="amber" accent />
            <KpiCard label="Open entries" value={summary!.pending.length.toLocaleString('en-IN')} hint={`${summary!.overdueCount} overdue · ${summary!.counts.draftBills} draft bills`} icon={AlertTriangle} tone={summary!.overdueCount ? 'rose' : 'slate'} accent />
            <KpiCard label="Exceptions" value={t ? exceptionCount.toLocaleString('en-IN') : '—'} hint={detail ? `${detail.exceptions.counts['Over-executed']} over-executed · ${detail.exceptions.counts['Unmatched line']} unmatched` : undefined} icon={FileWarning} tone={exceptionCount ? 'violet' : 'slate'} accent />
          </>
        )}
      </div>

      {busy || !detail || !v ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ConversionPanel boq={boqValue} executed={v.executed} certified={v.certified} billed={v.billed} boqLoaded={Boolean(t)} />
            <PeriodPanel comparison={detail.period} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ValueTrendChart points={detail.trend} />
            <AgeingPanel buckets={detail.ageing.buckets} undated={detail.ageing.undated} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <StagePipelineChart stages={summary!.byStage} />
            <Panel title="Longest waiting" description={`Open JMC and MVAC entries, overdue first (${summary!.pending.length} open).`} icon={History} tone="orange" bodyClassName="p-0 sm:p-4 sm:pt-2">
              <DataList rows={detail.pending} columns={pendingColumns} dense empty="Nothing is waiting." />
            </Panel>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ScopesPanel rows={detail.scopes} showProject={false} />
            <ExceptionsPanel summary={detail.exceptions} showProject={false} />
          </div>
          <Panel title="Latest RA bills" description="Quantity bills to the client; their money is followed in Bill Tracking." icon={Scale} tone="sky" bodyClassName="p-0 sm:p-4 sm:pt-2">
            <DataList rows={detail.bills} columns={billColumns} dense empty="No RA bill yet." />
          </Panel>
        </>
      )}
    </BrPage>
  );
}
