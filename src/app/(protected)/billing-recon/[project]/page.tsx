'use client';

/**
 * A project's Billing Recon overview: what has been measured, certified and billed, what waits at
 * which stage, and the latest RA bills — all from the project's own register
 * (src/lib/billing-recon/register.ts). Navigation is the sidebar's job; nothing here is a link card.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { AlertTriangle, ClipboardList, Clock, GitBranch, Layers, RefreshCw, TrendingUp, Wallet } from 'lucide-react';
import { collection, getCountFromServer } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { PageAccessDenied } from '@/components/shared/module-shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { useProjectSummaries } from '@/components/billing-recon/dashboard/use-project-summaries';
import { StagePipelineChart, ValueFunnel, ValueTrendChart, compactInr, formatInr } from '@/components/billing-recon/dashboard/br-charts';
import { lastMonths, percent, toMillis, type PendingEntry } from '@/lib/billing-recon/dashboard';
import type { RaBill } from '@/lib/billing-recon/types';

const fmtDate = (ms: number | null) => (ms === null ? '—' : format(new Date(ms), 'dd MMM yyyy'));

type PendingRow = PendingEntry & { id: string };
type BillRow = RaBill;

export default function ProjectOverviewPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const { currentProject, loading: projectsLoading, register, currentSlug } = useBillingReconProjects();
  const projects = useMemo(() => (currentProject ? [currentProject] : []), [currentProject]);
  const { rows, loading, now, reload } = useProjectSummaries(projects, Boolean(currentProject));
  const loaded = rows[0];
  const [boqCount, setBoqCount] = useState<number | null>(null);

  useEffect(() => {
    if (!currentProject) return;
    let cancelled = false;
    getCountFromServer(collection(db, 'projects', currentProject.id, register.boqItems))
      .then((snap) => !cancelled && setBoqCount(snap.data().count))
      .catch(() => !cancelled && setBoqCount(null));
    return () => {
      cancelled = true;
    };
  }, [currentProject, register.boqItems]);

  const summary = loaded?.summary;
  const trend = useMemo(() => (summary ? lastMonths(summary.byMonth, now, 12) : []), [summary, now]);
  const pendingRows: PendingRow[] = useMemo(() => (summary?.pending ?? []).slice(0, 10).map((p) => ({ ...p, id: `${p.kind}:${p.id}` })), [summary]);
  const recentBills: BillRow[] = useMemo(
    () => [...(loaded?.bills ?? [])].sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0)).slice(0, 5),
    [loaded],
  );

  if (authLoading || projectsLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!can('View Module', 'Billing Recon')) return <PageAccessDenied message="You do not have permission to view this project's Billing Recon overview." />;
  if (!currentProject) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project not found</CardTitle>
          <CardDescription>No project matches “{currentSlug}”. Pick one from the project switcher in the menu.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const busy = loading || !summary;
  const v = summary?.values;
  const contractValue = Number(currentProject.contractValue) || 0;

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
    { header: 'Bill', mobile: 'title', cell: (b) => <span className="font-medium text-foreground">{b.billNo}</span> },
    { header: 'RA', cell: (b) => (b.raSequence ? `RA ${b.raSequence}` : '—') },
    { header: 'Date', cell: (b) => b.billDate || '—' },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (b) => <StatusBadge tone={b.status === 'Submitted' ? 'success' : b.status === 'Cancelled' ? 'neutral' : 'warning'} status={b.status} />,
    },
    { header: 'Amount', align: 'right', cell: (b) => <span className="tabular-nums">{formatInr(b.totalAmount)}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={currentProject.projectName}
        description="Measured, certified by the client, and billed — for this project."
        actions={
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={busy}>
            <RefreshCw className={busy ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
            Refresh
          </Button>
        }
      />

      {!register.separated && (
        <Alert>
          <GitBranch className="h-4 w-4" />
          <AlertTitle>This project still shares its BOQ and JMC register with Project Management</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>JMCs raised in either module show in both. Separate the project to give Billing Recon its own records.</span>
            {can('View', 'Billing Recon.Data Separation') && (
              <Button asChild size="sm" variant="secondary">
                <Link href="/billing-recon/settings/data-separation">Review separation</Link>
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {busy || !v ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <KpiCard label="BOQ items" value={boqCount === null ? '—' : boqCount.toLocaleString('en-IN')} hint={contractValue ? `Contract ${compactInr(contractValue)}` : register.separated ? 'Billing Recon BOQ' : 'Shared BOQ'} icon={ClipboardList} tone="slate" />
            <KpiCard label="Executed" value={compactInr(v.executed)} hint={`${summary!.counts.jmc} JMC · ${summary!.counts.mvac} MVAC`} icon={Layers} tone="blue" />
            <KpiCard label="Certified" value={compactInr(v.certified)} hint={`${percent(v.certified, v.executed)}% of executed`} icon={TrendingUp} tone="orange" />
            <KpiCard label="Billed" value={compactInr(v.billed)} hint={`${summary!.counts.bills} RA bills · ${summary!.counts.draftBills} draft`} icon={Wallet} tone="teal" />
            <KpiCard label="Certified, not billed" value={compactInr(v.certifiedUnbilled)} hint="Ready for the next RA bill" icon={Wallet} tone="emerald" />
            <KpiCard label="Open entries" value={summary!.pending.length.toLocaleString('en-IN')} hint={`${summary!.overdueCount} overdue`} icon={summary!.overdueCount ? AlertTriangle : Clock} tone={summary!.overdueCount ? 'rose' : 'slate'} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">From measured to billed</CardTitle>
            <CardDescription className="text-xs">{contractValue ? 'Against the contract value on the project.' : 'Executed, certified and billed value.'}</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {busy || !v ? (
              <Skeleton className="h-40" />
            ) : (
              <ValueFunnel executed={v.executed} certified={v.certified} billed={v.billed} reference={contractValue || undefined} referenceLabel="Contract value" />
            )}
          </CardContent>
        </Card>
        <div className="min-w-0 xl:col-span-2">{busy ? <Skeleton className="h-72 rounded-xl" /> : <ValueTrendChart points={trend} />}</div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {busy ? <Skeleton className="h-64 rounded-xl" /> : <StagePipelineChart stages={summary!.byStage} />}
        <Card className="min-w-0">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Latest RA bills</CardTitle>
            <CardDescription className="text-xs">Quantity bills to the client; their money is tracked in Bill Tracking.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-4 sm:pt-0">
            {busy ? <Skeleton className="m-4 h-32" /> : <DataList rows={recentBills} columns={billColumns} dense empty="No RA bill yet." />}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Longest waiting</CardTitle>
          <CardDescription className="text-xs">Open JMC and MVAC entries, overdue first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-4 sm:pt-0">
          {busy ? <Skeleton className="m-4 h-32" /> : <DataList rows={pendingRows} columns={pendingColumns} dense empty="Nothing is waiting." />}
        </CardContent>
      </Card>
    </div>
  );
}
