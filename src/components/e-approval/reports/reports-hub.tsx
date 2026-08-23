'use client';

import Link from 'next/link';
import {
  AlarmClock,
  BarChart3,
  ChevronRight,
  Clock,
  Gauge,
  Hourglass,
  Loader2,
  PieChart,
  TrafficCone,
  UserCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import { useEApprovalPermissions } from '../hooks';

/**
 * The reporting hub — one card per analytics area, each its own page.
 *
 * Built like the settings hub rather than as tabs, for the same reason and one more: these pages each
 * carry their own filter state and their own heavy aggregation, and a tab strip that recomputes six
 * dashboards on every switch is slower than a link.
 *
 * `status: 'planned'` marks areas whose requirements have not arrived yet. Shown greyed rather than
 * hidden, so the gap is visible instead of looking like a finished product with pieces missing.
 */
const AREAS = [
  {
    icon: Gauge,
    text: 'Executive Command Center',
    href: `${E_APPROVAL_BASE_PATH}/reports/executive`,
    description: 'The KPI block, period-on-period comparison, financial exposure and the oldest file in the system.',
    gradient: 'from-sky-500 to-blue-600',
    bg: 'bg-sky-50',
    iconColor: 'text-sky-600',
    status: 'ready',
  },
  {
    icon: PieChart,
    text: 'Status Distribution',
    href: `${E_APPROVAL_BASE_PATH}/reports/status`,
    description: 'Every status, its share and its value — with drill-down to the underlying register.',
    gradient: 'from-indigo-500 to-violet-600',
    bg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    status: 'ready',
  },
  {
    icon: Hourglass,
    text: 'Approval Aging',
    href: `${E_APPROVAL_BASE_PATH}/reports/aging`,
    description: 'The nine age buckets, value at each, and the oldest-pending table with escalation level.',
    gradient: 'from-amber-500 to-orange-500',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    status: 'ready',
  },
  {
    icon: TrafficCone,
    text: 'Bottleneck Intelligence',
    href: `${E_APPROVAL_BASE_PATH}/reports/bottlenecks`,
    description: 'Which desk, which department and which workflow stage is costing the most time.',
    gradient: 'from-rose-500 to-red-600',
    bg: 'bg-rose-50',
    iconColor: 'text-rose-600',
    status: 'ready',
  },
  {
    icon: AlarmClock,
    text: 'SLA & Escalation',
    href: `${E_APPROVAL_BASE_PATH}/reports/sla`,
    description: 'Compliance by department, approver and type; breach trend; escalation by level.',
    gradient: 'from-teal-500 to-emerald-600',
    bg: 'bg-teal-50',
    iconColor: 'text-teal-600',
    status: 'ready',
  },
  {
    icon: UserCheck,
    text: 'Approver Performance',
    href: `${E_APPROVAL_BASE_PATH}/reports/approvers`,
    description: 'Per-person workflow metrics and rankings. Response time excludes time spent waiting on others.',
    gradient: 'from-fuchsia-500 to-pink-600',
    bg: 'bg-fuchsia-50',
    iconColor: 'text-fuchsia-600',
    status: 'ready',
  },
  {
    icon: BarChart3,
    text: 'Department Performance',
    href: `${E_APPROVAL_BASE_PATH}/reports`,
    description: 'Awaiting requirements — the spec for this section did not survive the paste.',
    gradient: 'from-slate-400 to-slate-500',
    bg: 'bg-slate-100',
    iconColor: 'text-slate-500',
    status: 'planned',
  },
  {
    icon: Clock,
    text: 'Financial · Rework · Verification · Workflow · Requester · Delegation · Category · Project · Audit · Report Builder',
    href: `${E_APPROVAL_BASE_PATH}/reports`,
    description:
      'Ten further areas awaiting requirements. The metrics for most of them are already computed and tested in e-approval-analytics.ts.',
    gradient: 'from-slate-400 to-slate-500',
    bg: 'bg-slate-100',
    iconColor: 'text-slate-500',
    status: 'planned',
  },
] as const;

export function EApprovalReportsHub() {
  const permissions = useEApprovalPermissions();

  if (permissions.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-sky-600" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-none bg-gradient-to-r from-slate-800 to-slate-900 text-white shadow-lg">
        <CardContent className="flex items-center gap-3 p-5 sm:p-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Approval Intelligence</h1>
            <p className="mt-1 text-sm text-white/85">
              Where approvals are stuck, who is holding them, what it is worth, and how long it took. Every figure is
              computed from the live record — nothing here is stored or cached.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AREAS.map((area) => {
          const planned = area.status === 'planned';
          const body = (
            <div
              className={cn(
                'group relative flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-background transition-all duration-200',
                planned ? 'opacity-60' : 'hover:-translate-y-1 hover:shadow-md',
              )}
            >
              <div className={cn('h-1 w-full bg-gradient-to-r', area.gradient)} />
              <div className="flex items-start gap-3 p-4">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', area.bg)}>
                  <area.icon className={cn('h-5 w-5', area.iconColor)} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold leading-tight">
                    <span className="min-w-0">{area.text}</span>
                    {planned && (
                      <Badge variant="outline" className="shrink-0 text-[9px] font-normal">
                        Not built
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{area.description}</p>
                </div>
                {!planned && (
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                )}
              </div>
            </div>
          );

          return planned ? (
            <div key={area.text}>{body}</div>
          ) : (
            <Link key={area.text} href={area.href} className="no-underline">
              {body}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
