
'use client';

import Link from 'next/link';
import { BarChart3, CalendarCheck, ChevronRight, TrendingUp } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const REPORTS = [
  {
    icon: CalendarCheck,
    title: 'Month-wise EMI Status',
    description: 'Track paid and unpaid EMIs across each month of the financial year.',
    href: '/loan/reports/month-wise-status',
    gradient: 'from-violet-500 to-purple-600',
    bg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    permission: 'View Month-wise Status',
  },
  {
    icon: TrendingUp,
    title: 'Loan Amortization',
    description: 'View principal vs interest breakdown across the full loan tenure.',
    href: '#',
    gradient: 'from-blue-500 to-indigo-600',
    bg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    permission: null,
    soon: true,
  },
];

export default function LoanReportsPage() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View', 'Loan.Reports');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Skeleton className="h-36 rounded-xl" /><Skeleton className="h-36 rounded-xl" /></div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to view reports.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-blue-500 to-violet-500" />
        <CardHeader className="flex items-center gap-3 flex-row">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 ring-1 ring-indigo-100">
            <BarChart3 className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <CardTitle className="tracking-tight">Loan Reports</CardTitle>
            <CardDescription>Analytics and month-wise summaries for loan EMIs</CardDescription>
          </div>
        </CardHeader>
      </Card>

      {/* Report tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((item) => {
          const isDisabled = item.soon || (item.permission && !can('View', 'Loan.Reports'));
          const content = (
            <div className={cn(
              'group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200',
              isDisabled
                ? 'cursor-not-allowed opacity-60 border-border/40 bg-muted/30'
                : 'cursor-pointer border-border/60 bg-background hover:-translate-y-1 hover:shadow-md'
            )}>
              <div className={cn('h-1 w-full bg-gradient-to-r', item.gradient)} />
              <div className="flex items-center gap-3 p-4">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', item.bg)}>
                  <item.icon className={cn('h-5 w-5', item.iconColor)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm leading-tight">{item.title}</p>
                    {item.soon && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Soon</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>
                </div>
                {!isDisabled && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />}
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
