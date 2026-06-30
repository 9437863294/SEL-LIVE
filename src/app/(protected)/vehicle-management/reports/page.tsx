'use client';

import Link from 'next/link';
import { AlertTriangle, BarChart3, Car, Fuel, FolderOpen, Layers, TrendingUp, Wrench } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const REPORTS = [
  {
    href: '/vehicle-management/reports/fuel-per-vehicle',
    title: 'Fuel Cost Per Vehicle',
    description:
      'Monthly fuel spend, liters consumed, mileage efficiency, and cost per kilometer for each vehicle.',
    icon: Fuel,
    color: 'from-cyan-500 to-sky-500',
    iconBg: 'bg-cyan-50 text-cyan-600',
    scope: 'Monthly',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/vehicle-management/reports/project-fuel-cost',
    title: 'Project-wise Fuel Cost',
    description: 'Total fuel expenditure grouped by project with bar visualization and ranking.',
    icon: Layers,
    color: 'from-emerald-500 to-teal-500',
    iconBg: 'bg-emerald-50 text-emerald-600',
    scope: 'Monthly',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/vehicle-management/reports/monthly-trends',
    title: 'Monthly Cost Trends',
    description:
      'Six-month fuel and maintenance spend overview with top expense vehicles ranked.',
    icon: TrendingUp,
    color: 'from-violet-500 to-purple-600',
    iconBg: 'bg-violet-50 text-violet-600',
    scope: '6 Months',
    scopeColor: 'bg-violet-50 text-violet-700',
  },
  {
    href: '/vehicle-management/reports/maintenance-cost',
    title: 'Maintenance Cost',
    description:
      'Maintenance expenditure per vehicle — total cost, service visit count, and labour vs parts breakdown.',
    icon: Wrench,
    color: 'from-amber-500 to-orange-500',
    iconBg: 'bg-amber-50 text-amber-600',
    scope: 'Monthly',
    scopeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/vehicle-management/reports/expiry-alerts',
    title: 'Expiry Alert Center',
    description:
      'All compliance alerts — expired, due today, and within 7/15/30 days across insurance, PUC, fitness, road tax, permit, and driver licenses.',
    icon: AlertTriangle,
    color: 'from-rose-500 to-red-600',
    iconBg: 'bg-rose-50 text-rose-600',
    scope: 'Fleet-wide',
    scopeColor: 'bg-slate-100 text-slate-600',
  },
  {
    href: '/vehicle-management/reports/vehicle-age',
    title: 'Vehicle Age Report',
    description:
      'Fleet age analysis grouped into New, Moderate, Old, and Aging brackets with purchase value and project details.',
    icon: Car,
    color: 'from-pink-500 to-rose-500',
    iconBg: 'bg-pink-50 text-pink-600',
    scope: 'Fleet-wide',
    scopeColor: 'bg-slate-100 text-slate-600',
  },
  {
    href: '/vehicle-management/reports/project-vehicles',
    title: 'Project Vehicle Count',
    description:
      'Number of vehicles deployed per project with active/inactive status and vehicle type breakdown.',
    icon: FolderOpen,
    color: 'from-fuchsia-500 to-violet-500',
    iconBg: 'bg-fuchsia-50 text-fuchsia-600',
    scope: 'Fleet-wide',
    scopeColor: 'bg-slate-100 text-slate-600',
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
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 animate-bb-gradient" />
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-500" />
            <CardTitle className="tracking-tight">Vehicle Reports</CardTitle>
          </div>
          <CardDescription>
            Select a report to view focused analytics, apply date filters, and export to Excel.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          return (
            <Link key={report.href} href={report.href} className="group block">
              <Card className="vm-panel h-full overflow-hidden transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
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
    </div>
  );
}
