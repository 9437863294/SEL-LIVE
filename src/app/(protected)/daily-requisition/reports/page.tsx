'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart3, Clock,
  FolderOpen, Landmark, Layers, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BtToolbar, ToolbarSearch, ToolbarSelect } from '@/components/bill-tracking/bt-toolbar';
import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import { ReportAccessDenied } from './_components/report-kit';

const REPORTS = [
  {
    href: '/daily-requisition/reports/status-overview',
    title: 'Status Overview',
    description: 'Count, net, paid and outstanding by requisition status — see the full pipeline at a glance.',
    icon: BarChart3,
    color: 'from-cyan-500 to-sky-500',
    iconBg: 'bg-cyan-50 text-cyan-600',
    scope: 'Date range',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/daily-requisition/reports/monthly-trend',
    title: 'Monthly Trend',
    description: 'Volume and value of requisitions month-over-month for the last 6, 12 or 24 months.',
    icon: TrendingUp,
    color: 'from-violet-500 to-purple-600',
    iconBg: 'bg-violet-50 text-violet-600',
    scope: 'Monthly',
    scopeColor: 'bg-violet-50 text-violet-700',
  },
  {
    href: '/daily-requisition/reports/department-analysis',
    title: 'Department Analysis',
    description: 'Requisitions, net, paid and outstanding amounts grouped by department.',
    icon: Layers,
    color: 'from-emerald-500 to-teal-500',
    iconBg: 'bg-emerald-50 text-emerald-600',
    scope: 'Date range',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/daily-requisition/reports/project-analysis',
    title: 'Project Analysis',
    description: 'Requisition count, net, paid and outstanding amounts broken down by project.',
    icon: FolderOpen,
    color: 'from-amber-500 to-orange-500',
    iconBg: 'bg-amber-50 text-amber-600',
    scope: 'Date range',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/daily-requisition/reports/party-analysis',
    title: 'Party / Vendor Analysis',
    description: 'Top parties by total amount and frequency, with what is paid and still owed to each.',
    icon: Users,
    color: 'from-rose-500 to-pink-500',
    iconBg: 'bg-rose-50 text-rose-600',
    scope: 'Date range',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/daily-requisition/reports/financial-breakdown',
    title: 'Financial Breakdown',
    description: 'Gross vs net analysis with full deduction split — GST, TDS, retention, and other charges.',
    icon: Wallet,
    color: 'from-indigo-500 to-blue-600',
    iconBg: 'bg-indigo-50 text-indigo-600',
    scope: 'Date range',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/daily-requisition/reports/ageing',
    title: 'Ageing Report',
    description: 'Open requisitions bucketed by age — spot what is stuck, for how long, and what is still owed.',
    icon: Clock,
    color: 'from-red-500 to-rose-600',
    iconBg: 'bg-red-50 text-red-600',
    scope: 'Live',
    scopeColor: 'bg-rose-50 text-rose-700',
  },
  {
    href: '/daily-requisition/reports/gst-by-registration',
    title: 'GST & TDS by Registration',
    description:
      "Per the company's own GSTINs: input credit on purchase bills, output GST owed under reverse charge, and TDS withheld — kept apart, as the return keeps them.",
    icon: Landmark,
    color: 'from-teal-500 to-emerald-600',
    iconBg: 'bg-teal-50 text-teal-600',
    scope: 'Date range',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
];

const DESCRIPTION = 'Select a report to view focused analytics and export to Excel.';

const SCOPE_OPTIONS = [...new Set(REPORTS.map((report) => report.scope))].map((scope) => ({ value: scope, label: scope }));

export default function DailyRequisitionReportsHubPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet') || can('View', 'Daily Requisition.Settings');

  // Bill Tracking's filter toolbar, as on the Bill Register: a search over each report's name and
  // what it shows, and its scope.
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('');
  const needle = search.trim().toLowerCase();
  const shown = REPORTS.filter(
    (report) => (!scope || report.scope === scope) && (!needle || `${report.title} ${report.description}`.toLowerCase().includes(needle))
  );
  const clearFilters = () => {
    setSearch('');
    setScope('');
  };

  // Until permissions load `can` answers false — show the grid's outline, not a refusal.
  if (!isAuthLoading && !canView) {
    return <ReportAccessDenied title="Reports" description={DESCRIPTION} message="You do not have permission to view reports." />;
  }

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader eyebrow="Daily Requisition"
        title="Reports"
        description={DESCRIPTION}
        backHref="/daily-requisition"
      />

      <div className="mb-4">
        <BtToolbar
          search={<ToolbarSearch className="flex-1 sm:w-64 sm:flex-none" value={search} onChange={setSearch} placeholder="Search reports…" />}
          controls={<ToolbarSelect label="Scope" value={scope} onChange={setScope} options={SCOPE_OPTIONS} allLabel="All scopes" />}
          activeCount={(needle ? 1 : 0) + (scope ? 1 : 0)}
          onClear={clearFilters}
          summary={`${shown.length} of ${REPORTS.length} reports`}
        />
      </div>

      {isAuthLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {REPORTS.map((report) => (
            <Skeleton key={report.href} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No report matches these filters.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((report) => {
            const Icon = report.icon;
            return (
              <Link key={report.href} href={report.href} className="group block">
                <Card className="h-full overflow-hidden border border-white/70 bg-white/70 backdrop-blur-xl shadow-sm transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md active:scale-[0.98]">
                  <div className={`h-1 w-full bg-gradient-to-r ${report.color}`} />
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${report.iconBg}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge variant="outline">
                        {report.scope}
                      </Badge>
                    </div>
                    <CardTitle className="mt-3 text-base">{report.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">{report.description}</p>
                    <div className="mt-4 flex items-center gap-1 text-sm font-medium text-indigo-600 transition-all duration-150 group-hover:gap-2">
                      Open Report <span>→</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
