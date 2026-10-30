'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart3, ChevronRight, Clock,
  FolderOpen, Landmark, Layers, TrendingUp, Users, Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BtToolbar, ToolbarSearch } from '@/components/bill-tracking/bt-toolbar';
import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import { cn } from '@/lib/utils';
import { ReportAccessDenied } from './_components/report-kit';

type ReportGroup = 'overview' | 'breakdown';

interface ReportLink {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** The icon chip's colours. */
  iconBg: string;
  /** What the report covers: a period you choose, months back from now, or today's open entries. */
  scope: 'Date range' | 'Monthly' | 'Live';
  group: ReportGroup;
}

const REPORTS: ReportLink[] = [
  {
    href: '/daily-requisition/reports/status-overview',
    title: 'Status Overview',
    description: 'Count, net, paid and outstanding by requisition status — see the full pipeline at a glance.',
    icon: BarChart3,
    iconBg: 'bg-cyan-50 text-cyan-600',
    scope: 'Date range',
    group: 'overview',
  },
  {
    href: '/daily-requisition/reports/monthly-trend',
    title: 'Monthly Trend',
    description: 'Volume and value of requisitions month-over-month for the last 6, 12 or 24 months.',
    icon: TrendingUp,
    iconBg: 'bg-violet-50 text-violet-600',
    scope: 'Monthly',
    group: 'overview',
  },
  {
    href: '/daily-requisition/reports/ageing',
    title: 'Ageing Report',
    description: 'Open requisitions bucketed by age — spot what is stuck, for how long, and what is still owed.',
    icon: Clock,
    iconBg: 'bg-red-50 text-red-600',
    scope: 'Live',
    group: 'overview',
  },
  {
    href: '/daily-requisition/reports/financial-breakdown',
    title: 'Financial Breakdown',
    description: 'Gross vs net analysis with full deduction split — GST, TDS, retention, and other charges.',
    icon: Wallet,
    iconBg: 'bg-indigo-50 text-indigo-600',
    scope: 'Date range',
    group: 'overview',
  },
  {
    href: '/daily-requisition/reports/department-analysis',
    title: 'Department Analysis',
    description: 'Requisitions, net, paid and outstanding amounts grouped by department.',
    icon: Layers,
    iconBg: 'bg-emerald-50 text-emerald-600',
    scope: 'Date range',
    group: 'breakdown',
  },
  {
    href: '/daily-requisition/reports/project-analysis',
    title: 'Project Analysis',
    description: 'Requisition count, net, paid and outstanding amounts broken down by project.',
    icon: FolderOpen,
    iconBg: 'bg-amber-50 text-amber-600',
    scope: 'Date range',
    group: 'breakdown',
  },
  {
    href: '/daily-requisition/reports/party-analysis',
    title: 'Party / Vendor Analysis',
    description: 'Top parties by total amount and frequency, with what is paid and still owed to each.',
    icon: Users,
    iconBg: 'bg-rose-50 text-rose-600',
    scope: 'Date range',
    group: 'breakdown',
  },
  {
    href: '/daily-requisition/reports/gst-by-registration',
    title: 'GST & TDS by Registration',
    description:
      "Per the company's own GSTINs: input credit on purchase bills, output GST owed under reverse charge, and TDS withheld — kept apart, as the return keeps them.",
    icon: Landmark,
    iconBg: 'bg-teal-50 text-teal-600',
    scope: 'Date range',
    group: 'breakdown',
  },
];

const GROUPS: { key: ReportGroup; title: string; hint: string }[] = [
  { key: 'overview', title: 'Overview', hint: 'The whole pipeline — status, trend, age and money' },
  { key: 'breakdown', title: 'Breakdowns', hint: 'Grouped by department, project, party or GSTIN' },
];

const DESCRIPTION = 'Select a report to view focused analytics and export to Excel.';

/** A group's frame: a card with its name, a line on what is in it, and a count. */
const GROUP_CARD = 'overflow-hidden rounded-xl border bg-card shadow-sm';
const GROUP_HEAD = 'flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5 sm:px-5';

function ScopePill({ scope }: { scope: ReportLink['scope'] }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium leading-[18px] text-muted-foreground">
      {scope === 'Live' ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> : null}
      {scope}
    </span>
  );
}

export default function DailyRequisitionReportsHubPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet') || can('View', 'Daily Requisition.Settings');

  // Bill Tracking's filter toolbar, as on the Bill Register: a search over each report's name,
  // what it shows and what it covers.
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const shown = REPORTS.filter(
    (report) => !needle || `${report.title} ${report.description} ${report.scope}`.toLowerCase().includes(needle)
  );
  const clearFilters = () => setSearch('');

  // Until permissions load `can` answers false — show the page's outline, not a refusal.
  if (!isAuthLoading && !canView) {
    return <ReportAccessDenied title="Reports" description={DESCRIPTION} message="You do not have permission to view reports." />;
  }

  return (
    <div className={`${dailyPageContainerClass} space-y-3`}>
      {/* One card, as on the module's other pages: where you are and what this is, then the search. */}
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* A `space-y-*` parent: globals.css then drops the header's own bottom margin. */}
        <div className="space-y-0 px-4 py-3 sm:px-5 sm:py-4">
          <PageHeader
            backHref="/daily-requisition"
            breadcrumbs={[{ label: 'Daily Requisition', href: '/daily-requisition' }, { label: 'Reports' }]}
            title="Reports"
            description={DESCRIPTION}
          />
        </div>
        <div className="border-t bg-muted/40 px-4 py-2.5 sm:px-5">
          <BtToolbar
            framed={false}
            search={<ToolbarSearch className="flex-1 sm:w-72 sm:flex-none" value={search} onChange={setSearch} placeholder="Search reports…" />}
            activeCount={needle ? 1 : 0}
            onClear={clearFilters}
            summary={needle ? `${shown.length} of ${REPORTS.length} reports` : `${REPORTS.length} reports`}
          />
        </div>
      </section>

      {isAuthLoading ? (
        <div className="grid items-start gap-3 lg:grid-cols-2" aria-busy="true">
          {GROUPS.map((group) => (
            <div key={group.key} className={GROUP_CARD}>
              <div className={GROUP_HEAD}>
                <Skeleton className="h-4 w-48" />
              </div>
              <div className="divide-y">
                {REPORTS.filter((report) => report.group === group.key).map((report) => (
                  <div key={report.href} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-full max-w-sm" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No report matches “{search.trim()}”.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {GROUPS.map((group) => {
            const items = shown.filter((report) => report.group === group.key);
            if (items.length === 0) return null;
            return (
              <section key={group.key} aria-labelledby={`reports-${group.key}`} className={GROUP_CARD}>
                <div className={GROUP_HEAD}>
                  <div className="min-w-0">
                    <h2 id={`reports-${group.key}`} className="text-sm font-semibold text-foreground">
                      {group.title}
                    </h2>
                    <p className="truncate text-xs text-muted-foreground">{group.hint}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 text-xs font-semibold leading-5 tabular-nums text-foreground">
                    {items.length}
                  </span>
                </div>
                <ul className="divide-y">
                  {items.map((report) => {
                    const Icon = report.icon;
                    return (
                      <li key={report.href}>
                        <Link
                          href={report.href}
                          className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:px-5"
                        >
                          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', report.iconBg)} aria-hidden="true">
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-semibold text-foreground group-hover:text-primary">{report.title}</span>
                              <ScopePill scope={report.scope} />
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{report.description}</p>
                          </div>
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
