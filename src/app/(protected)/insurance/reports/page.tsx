
'use client';

import Link from 'next/link';
import { BarChart3, ChevronRight, ClipboardCheck, ShieldAlert } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const REPORTS = [
  {
    icon: ClipboardCheck,
    title: 'My Tasks Summary',
    description: 'Step-wise breakdown of insurance task assignments — total, done, on-time, and rejected.',
    href: '/insurance/reports/my-tasks-summary',
    gradient: 'from-cyan-500 to-sky-600',
    bg: 'bg-cyan-50',
    iconColor: 'text-cyan-600',
    permission: 'View Reports',
  },
  {
    icon: BarChart3,
    title: 'Premium Analytics',
    description: 'Monthly premium payment trends and overdue analysis across all policy holders.',
    href: '#',
    gradient: 'from-violet-500 to-purple-600',
    bg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    permission: 'View Reports',
    disabled: true,
    soon: true,
  },
];

export default function InsuranceReportsPage() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View Reports', 'Insurance.Reports');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied</CardTitle>
          <CardDescription>You do not have permission to view reports.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500" />
        <CardHeader className="flex items-center gap-3 flex-row">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 ring-1 ring-indigo-100">
            <BarChart3 className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <CardTitle className="tracking-tight">Insurance Reports</CardTitle>
            <CardDescription>Analytics and summaries for insurance policies and tasks</CardDescription>
          </div>
        </CardHeader>
      </Card>

      {/* ── Report cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((item) => {
          const isDisabled = item.disabled || !can(item.permission, 'Insurance.Reports');
          const content = (
            <div className={cn(
              'group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200',
              isDisabled
                ? 'cursor-not-allowed opacity-60 border-border/40 bg-muted/30'
                : 'cursor-pointer border-border/60 bg-background hover:-translate-y-1 hover:shadow-md hover:border-border'
            )}>
              <div className={cn('h-1 w-full bg-gradient-to-r', item.gradient)} />
              <div className="p-5 flex flex-col gap-4 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', item.bg)}>
                    <item.icon className={cn('h-5 w-5', item.iconColor)} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {item.soon && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">Coming Soon</span>
                    )}
                    {!isDisabled && <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />}
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-sm leading-tight">{item.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                </div>
              </div>
            </div>
          );

          if (isDisabled) return <div key={item.title}>{content}</div>;
          return <Link key={item.title} href={item.href} className="no-underline">{content}</Link>;
        })}
      </div>

    </div>
  );
}
