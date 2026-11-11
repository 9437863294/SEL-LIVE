'use client';

/**
 * The Master Drawing List's landing page: figures over every drawing list the user may view —
 * how much is approved, what waits with the client and with SEL and for how long, and each
 * project's status split. Figures only; navigation is the sidebar's job.
 *
 * Charts: segment colours are the status tones (emerald approved, sky with client, amber comments,
 * slate not submitted, rose vendor not finalised, violet on hold), checked with the dataviz
 * validator in light and dark (CVD and normal-vision separation pass; slate is the deliberate
 * neutral). Every chart carries a legend and a table of the same figures, so no value is told by
 * colour alone.
 */

import { CircleCheck, Clock, FileStack, LayoutDashboard, MessageSquare, PackageX, Send } from 'lucide-react';

import { KpiCard, KpiGrid } from '@/components/shared/kpi-card';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/master-drawing-list/derive';
import { AGE_BANDS, type ProjectSummary } from '@/lib/master-drawing-list/register';
import type { DashboardData } from '@/lib/master-drawing-list/server/queries';
import { STATUS_LABEL, type MdlStatus } from '@/lib/master-drawing-list/types';
import { cn } from '@/lib/utils';

import { useMdl, useMdlQuery } from './mdl-client';
import { MdlError, MdlLoading, NoDrawingList, STATUS_ORDER } from './mdl-ui';

const FILL: Record<MdlStatus, string> = {
  approved: 'bg-emerald-500',
  under_review: 'bg-sky-500',
  comments_received: 'bg-amber-500',
  not_submitted: 'bg-slate-400',
  vendor_not_finalised: 'bg-rose-500',
  on_hold: 'bg-violet-400',
};

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const n = (value: number) => value.toLocaleString('en-IN');

function Legend({ items }: { items: { key: string; label: string; fill: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600" aria-label="Legend">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', item.fill)} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** One project's items split by status: thin segments, 2px gaps, rounded ends. */
function StatusBar({ summary, label }: { summary: ProjectSummary; label: string }) {
  const parts = STATUS_ORDER.filter((status) => summary.counts[status] > 0);
  return (
    <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${label}: ${parts.map((status) => `${STATUS_LABEL[status]} ${summary.counts[status]}`).join(', ')}`}>
      {parts.map((status) => (
        <span
          key={status}
          className={cn('h-full first:rounded-l-full last:rounded-r-full', FILL[status])}
          style={{ width: `${(summary.counts[status] / summary.total) * 100}%` }}
          title={`${STATUS_LABEL[status]}: ${n(summary.counts[status])} (${pct(summary.counts[status], summary.total)}%)`}
        />
      ))}
    </div>
  );
}

function ByProject({ data }: { data: DashboardData }) {
  return (
    <Card className="min-w-0">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <SectionHeader title="Status by project" description="Every item of each drawing list, by where it stands today." />
        <Legend items={STATUS_ORDER.map((status) => ({ key: status, label: STATUS_LABEL[status], fill: FILL[status] }))} />
        <div className="space-y-3">
          {data.projects.map(({ project, summary }) => (
            <div key={project.code} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-slate-800" title={project.displayName}>
                  {project.short}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {n(summary.counts.approved)} of {n(summary.total)} approved · <b className="font-semibold text-slate-800">{pct(summary.counts.approved, summary.total)}%</b>
                </span>
              </div>
              {summary.total ? <StatusBar summary={summary} label={project.short} /> : <p className="text-xs text-muted-foreground">No items yet.</p>}
            </div>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              {STATUS_ORDER.map((status) => (
                <TableHead key={status} className="text-right">
                  {STATUS_LABEL[status]}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.projects.map(({ project, summary }) => (
              <TableRow key={project.code}>
                <TableCell className="whitespace-nowrap font-medium">{project.short}</TableCell>
                {STATUS_ORDER.map((status) => (
                  <TableCell key={status} className="text-right tabular-nums">
                    {n(summary.counts[status])}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold tabular-nums">{n(summary.total)}</TableCell>
              </TableRow>
            ))}
            {data.projects.length > 1 && (
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableCell className="font-semibold">All</TableCell>
                {STATUS_ORDER.map((status) => (
                  <TableCell key={status} className="text-right font-semibold tabular-nums">
                    {n(data.total.counts[status])}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold tabular-nums">{n(data.total.total)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Items waiting with the client and with SEL, by how long — two thin bars per band on one scale. */
function Waiting({ data }: { data: DashboardData }) {
  const { withClient, withSel } = data.total;
  const max = Math.max(1, ...withClient, ...withSel);
  const series = [
    { key: 'client', label: 'With client (under review)', fill: 'bg-sky-500', values: withClient },
    { key: 'sel', label: 'With SEL (comments to comply)', fill: 'bg-amber-500', values: withSel },
  ];
  const anyWaiting = withClient.some(Boolean) || withSel.some(Boolean);
  return (
    <Card className="min-w-0">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <SectionHeader title="How long items have waited" description="Days since the last submission (with the client) or the client's last comments (with SEL)." />
        {!anyWaiting ? (
          <p className="text-sm text-muted-foreground">Nothing is waiting with the client or with SEL.</p>
        ) : (
          <>
            <Legend items={series} />
            <div className="space-y-3">
              {AGE_BANDS.map((band, index) => (
                <div key={band.label} className="grid grid-cols-[6.5rem,1fr] items-center gap-x-3 gap-y-1 text-xs">
                  <span className="row-span-2 text-slate-600">{band.label}</span>
                  {series.map((entry) => (
                    <span key={entry.key} className="flex min-w-0 items-center gap-2" title={`${entry.label}, ${band.label}: ${entry.values[index]}`}>
                      <span className="h-2 min-w-0 rounded-r-[4px] bg-slate-100" style={{ width: '100%' }}>
                        <span className={cn('block h-2 rounded-r-[4px]', entry.fill)} style={{ width: `${(entry.values[index] / max) * 100}%` }} />
                      </span>
                      <span className="w-7 shrink-0 text-right tabular-nums text-slate-700">{entry.values[index]}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead className="text-right">With client</TableHead>
              <TableHead className="text-right">Longest (days)</TableHead>
              <TableHead className="text-right">With SEL</TableHead>
              <TableHead className="text-right">Longest (days)</TableHead>
              <TableHead className="text-right">Median days to approval</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.projects.map(({ project, summary }) => (
              <TableRow key={project.code}>
                <TableCell className="whitespace-nowrap font-medium">{project.short}</TableCell>
                <TableCell className="text-right tabular-nums">{n(summary.counts.under_review)}</TableCell>
                <TableCell className="text-right tabular-nums">{summary.oldestWithClient ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{n(summary.counts.comments_received)}</TableCell>
                <TableCell className="text-right tabular-nums">{summary.oldestWithSel ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{summary.medianCycleDays ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { lookups } = useMdl();
  const query = useMdlQuery<DashboardData>(lookups ? 'dashboard' : null);
  const data = query.data;

  if (!lookups || (query.loading && !data)) return <MdlLoading />;
  const total = data?.total;

  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        title="Master Drawing List"
        description={
          data
            ? `${data.projects.length} drawing list${data.projects.length === 1 ? '' : 's'} · figures as of ${formatDate(data.today)}`
            : 'Drawings and documents submitted to the client for approval.'
        }
      />
      <MdlError message={query.error} onRetry={query.reload} />
      {data && !data.projects.length ? (
        <NoDrawingList />
      ) : total ? (
        <>
          <KpiGrid>
            <KpiCard label="Drawing items" value={n(total.total)} hint={`${data.projects.length} project${data.projects.length === 1 ? '' : 's'}`} icon={FileStack} tone="slate" />
            <KpiCard label="Approved" value={n(total.counts.approved)} hint={`${pct(total.counts.approved, total.total)}% of all items`} icon={CircleCheck} tone="emerald" />
            <KpiCard label="With client" value={n(total.counts.under_review)} hint={total.oldestWithClient === null ? 'Under review' : `Longest ${total.oldestWithClient} days`} icon={Send} tone="blue" />
            <KpiCard label="Comments to comply" value={n(total.counts.comments_received)} hint={total.oldestWithSel === null ? 'With SEL' : `Longest ${total.oldestWithSel} days`} icon={MessageSquare} tone="amber" />
            <KpiCard label="Not submitted" value={n(total.counts.not_submitted)} hint="Vendor finalised, with SEL" icon={Clock} tone="slate" />
            <KpiCard label="Vendor not finalised" value={n(total.counts.vendor_not_finalised)} hint="With procurement" icon={PackageX} tone="rose" />
          </KpiGrid>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ByProject data={data} />
            <Waiting data={data} />
          </div>
        </>
      ) : null}
    </>
  );
}
