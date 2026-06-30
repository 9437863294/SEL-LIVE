'use client';

import Link from 'next/link';
import {
  BarChart3, Clock, FileSpreadsheet,
  FolderOpen, Layers, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DailyPageHeader, dailyPageContainerClass } from '@/components/daily-requisition/module-shell';

const REPORTS = [
  {
    href: '/daily-requisition/reports/status-overview',
    title: 'Status Overview',
    description: 'Count and total amounts by requisition status — see the full pipeline at a glance.',
    icon: BarChart3,
    color: 'from-cyan-500 to-sky-500',
    iconBg: 'bg-cyan-50 text-cyan-600',
    scope: 'All time',
    scopeColor: 'bg-slate-100 text-slate-600',
  },
  {
    href: '/daily-requisition/reports/monthly-trend',
    title: 'Monthly Trend',
    description: 'Volume and value of requisitions month-over-month for the last 6 months.',
    icon: TrendingUp,
    color: 'from-violet-500 to-purple-600',
    iconBg: 'bg-violet-50 text-violet-600',
    scope: '6 Months',
    scopeColor: 'bg-violet-50 text-violet-700',
  },
  {
    href: '/daily-requisition/reports/department-analysis',
    title: 'Department Analysis',
    description: 'Total requisitions and net amounts grouped by department.',
    icon: Layers,
    color: 'from-emerald-500 to-teal-500',
    iconBg: 'bg-emerald-50 text-emerald-600',
    scope: 'Date range',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/daily-requisition/reports/project-analysis',
    title: 'Project Analysis',
    description: 'Requisition count and amounts broken down by project.',
    icon: FolderOpen,
    color: 'from-amber-500 to-orange-500',
    iconBg: 'bg-amber-50 text-amber-600',
    scope: 'Date range',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/daily-requisition/reports/party-analysis',
    title: 'Party / Vendor Analysis',
    description: 'Top parties by total amount and frequency — identify high-value vendors.',
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
    description: 'Open requisitions bucketed by age — spot what is stuck and for how long.',
    icon: Clock,
    color: 'from-red-500 to-rose-600',
    iconBg: 'bg-red-50 text-red-600',
    scope: 'Live',
    scopeColor: 'bg-rose-50 text-rose-700',
  },
];

export default function DailyRequisitionReportsHubPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Daily Requisition.Reports') || can('View', 'Daily Requisition.Entry Sheet') || can('View', 'Daily Requisition.Settings');

  return (
    <div className={dailyPageContainerClass}>
      <DailyPageHeader
        title="Reports"
        description="Select a report to view focused analytics and export to Excel."
        backHref="/daily-requisition"
        meta={
          <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-slate-600 backdrop-blur">
            {REPORTS.length} reports available
          </span>
        }
      />

      {!canView ? (
        <Card>
          <CardHeader>
            <CardTitle>Access Restricted</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You do not have permission to view reports.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {REPORTS.map((report) => {
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
                      <Badge variant="outline" className={`text-xs ${report.scopeColor}`}>
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
