'use client';

import Link from 'next/link';
import { AlertTriangle, BarChart3, Car, Fuel, FolderOpen, Layers, TrendingUp, Wrench } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { vmToneChip, type VmTone } from '@/components/vehicle-management/vm-ui';

const REPORTS = [
  {
    href: '/vehicle-management/reports/fuel-per-vehicle',
    title: 'Fuel Cost Per Vehicle',
    description:
      'Monthly fuel spend, liters consumed, mileage efficiency, and cost per kilometer for each vehicle.',
    icon: Fuel,
    tone: 'cyan' as VmTone,
    scope: 'Monthly',
  },
  {
    href: '/vehicle-management/reports/project-fuel-cost',
    title: 'Project-wise Fuel Cost',
    description: 'Total fuel expenditure grouped by project with bar visualization and ranking.',
    icon: Layers,
    tone: 'emerald' as VmTone,
    scope: 'Monthly',
  },
  {
    href: '/vehicle-management/reports/monthly-trends',
    title: 'Monthly Cost Trends',
    description:
      'Six-month fuel and maintenance spend overview with top expense vehicles ranked.',
    icon: TrendingUp,
    tone: 'violet' as VmTone,
    scope: '6 Months',
  },
  {
    href: '/vehicle-management/reports/maintenance-cost',
    title: 'Maintenance Cost',
    description:
      'Maintenance expenditure per vehicle — total cost, service visit count, and labour vs parts breakdown.',
    icon: Wrench,
    tone: 'amber' as VmTone,
    scope: 'Monthly',
  },
  {
    href: '/vehicle-management/reports/expiry-alerts',
    title: 'Expiry-wise Report',
    description:
      'All compliance alerts — expired, due today, and within 7/15/30 days across insurance, PUC, fitness, road tax, permit, and driver licenses.',
    icon: AlertTriangle,
    tone: 'rose' as VmTone,
    scope: 'Month / Year',
  },
  {
    href: '/vehicle-management/reports/vehicle-age',
    title: 'Vehicle Age Report',
    description:
      'Fleet age analysis grouped into New, Moderate, Old, and Aging brackets with purchase value and project details.',
    icon: Car,
    tone: 'pink' as VmTone,
    scope: 'Fleet-wide',
  },
  {
    href: '/vehicle-management/reports/project-vehicles',
    title: 'Project Vehicle Count',
    description:
      'Number of vehicles deployed per project with active/inactive status and vehicle type breakdown.',
    icon: FolderOpen,
    tone: 'fuchsia' as VmTone,
    scope: 'Fleet-wide',
  },
];

export default function VehicleReportsHubPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Vehicle Management.Reports');

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view reports.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="vm-report-page space-y-3">
      <PageHeader
        title="Vehicle Reports"
        description="Select a report to view focused analytics, apply date filters, and export to Excel."
        icon={BarChart3}
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          return (
            <Link key={report.href} href={report.href} className="group block">
              <Card className="h-full overflow-hidden border-slate-200 bg-white transition-colors hover:border-slate-300 hover:bg-slate-50">
                <CardHeader className="p-2.5 pb-1.5 sm:p-3 sm:pb-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-md ${vmToneChip(report.tone)}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {report.scope}
                    </Badge>
                  </div>
                  <CardTitle className="mt-1.5 line-clamp-2 text-xs leading-snug sm:text-sm">{report.title}</CardTitle>
                </CardHeader>
                <CardContent className="hidden px-3 pb-3 sm:block">
                  <p className="line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">{report.description}</p>
                  <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-slate-600 transition-all duration-150 group-hover:gap-2">
                    Open Report <span>→</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
