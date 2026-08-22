'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CornerDownLeft,
  FilePlus2,
  FileStack,
  HelpCircle,
  Inbox,
  PauseCircle,
  RefreshCw,
  Search,
  Stamp,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  eApprovalAgeingBucket,
  E_APPROVAL_BASE_PATH,
  isOpenEApprovalStatus,
  isTerminalEApprovalStatus,
  summarizeEApprovalDashboard,
  type EApprovalDashboardCounts,
  type EApprovalRequest,
} from '@/lib/e-approval';
import { loadEApprovalWorkload } from '@/lib/e-approval-service';
import { EApprovalActionList } from '@/components/e-approval/request-table';
import { useEApprovalActor, useEApprovalPermissions } from '@/components/e-approval/hooks';

const STATUS_COLORS: Record<string, string> = {
  'Pending Approval': '#0ea5e9',
  'Pending Verification': '#8b5cf6',
  'Pending Clarification': '#f59e0b',
  Returned: '#fb923c',
  'On Hold': '#a1a1aa',
  'Partially Approved': '#14b8a6',
  Approved: '#10b981',
  Rejected: '#e11d48',
  Cancelled: '#94a3b8',
  Draft: '#cbd5e1',
  Resubmitted: '#38bdf8',
  Submitted: '#0ea5e9',
};

interface CardConfig {
  key: keyof EApprovalDashboardCounts;
  label: string;
  href: string;
  icon: typeof Inbox;
  tone: string;
}

const cards: CardConfig[] = [
  { key: 'pendingApprovals', label: 'My Pending Approvals', href: `${E_APPROVAL_BASE_PATH}/inbox`, icon: Stamp, tone: 'text-sky-700 bg-sky-50 ring-sky-100' },
  { key: 'verificationTasks', label: 'My Verification Tasks', href: `${E_APPROVAL_BASE_PATH}/inbox`, icon: Search, tone: 'text-violet-700 bg-violet-50 ring-violet-100' },
  { key: 'clarifications', label: 'Pending Clarification', href: `${E_APPROVAL_BASE_PATH}/inbox`, icon: HelpCircle, tone: 'text-amber-700 bg-amber-50 ring-amber-100' },
  { key: 'returnedToMe', label: 'Returned to Me', href: `${E_APPROVAL_BASE_PATH}/inbox`, icon: CornerDownLeft, tone: 'text-orange-700 bg-orange-50 ring-orange-100' },
  { key: 'createdByMe', label: 'Created by Me', href: `${E_APPROVAL_BASE_PATH}/created-by-me`, icon: FileStack, tone: 'text-indigo-700 bg-indigo-50 ring-indigo-100' },
  { key: 'approvedThisMonth', label: 'Approved This Month', href: `${E_APPROVAL_BASE_PATH}/completed`, icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50 ring-emerald-100' },
  { key: 'overdue', label: 'Overdue', href: `${E_APPROVAL_BASE_PATH}/inbox`, icon: AlertTriangle, tone: 'text-rose-700 bg-rose-50 ring-rose-100' },
  { key: 'onHold', label: 'On Hold', href: `${E_APPROVAL_BASE_PATH}/inbox`, icon: PauseCircle, tone: 'text-zinc-700 bg-zinc-50 ring-zinc-100' },
];

/**
 * The dashboard of spec section 14.
 *
 * Every card is counted from a single fetch of "requests I am involved in" rather than from a query
 * per card: nine independent counts disagree with each other the moment a file moves between two of
 * them, and a dashboard that cannot agree with itself stops being used. The counting itself is
 * `summarizeEApprovalDashboard`, which is unit-tested.
 */
export default function EApprovalDashboardPage() {
  const { serviceActor, engineActor, isLoading: actorLoading } = useEApprovalActor();
  const permissions = useEApprovalPermissions();
  const [rows, setRows] = useState<EApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!serviceActor || !engineActor) return;
    setIsLoading(true);
    try {
      setRows(await loadEApprovalWorkload(engineActor, serviceActor.organizationId));
      setLastUpdated(new Date());
    } catch (error) {
      console.error('[e-approval] dashboard load failed', error);
    } finally {
      setIsLoading(false);
    }
  }, [serviceActor, engineActor]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => (engineActor ? summarizeEApprovalDashboard(rows, engineActor) : null),
    [rows, engineActor],
  );

  const requiresMyAction = useMemo(() => {
    if (!engineActor) return [];
    const departments = engineActor.departmentIds ?? [];
    return rows
      .filter((row) => isOpenEApprovalStatus(row.status))
      .filter(
        (row) =>
          (row.currentAssigneeIds ?? []).includes(engineActor.userId) ||
          (row.currentDepartmentIds ?? []).some((id) => departments.includes(id)) ||
          (engineActor.role ? (row.currentRoles ?? []).includes(engineActor.role) : false),
      )
      .sort((a, b) => {
        const left = a.currentDueAt ? new Date(a.currentDueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const right = b.currentDueAt ? new Date(b.currentDueAt).getTime() : Number.MAX_SAFE_INTEGER;
        return left - right;
      });
  }, [rows, engineActor]);

  const statusChart = useMemo(() => {
    const tally = new Map<string, number>();
    rows.forEach((row) => tally.set(row.status, (tally.get(row.status) ?? 0) + 1));
    return Array.from(tally.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const ageingChart = useMemo(() => {
    const buckets = ['0-1 day', '2-3 days', '4-7 days', '8-15 days', '15+ days'];
    const tally = new Map<string, number>(buckets.map((bucket) => [bucket, 0]));
    rows
      .filter((row) => isOpenEApprovalStatus(row.status))
      .forEach((row) => {
        const bucket = eApprovalAgeingBucket(row.submittedAt);
        if (tally.has(bucket)) tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
      });
    return buckets.map((bucket) => ({ bucket, count: tally.get(bucket) ?? 0 }));
  }, [rows]);

  const loading = isLoading || actorLoading;

  return (
    <div className="min-w-0 space-y-3 sm:space-y-4">
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-sky-500/10 via-white/5 to-indigo-500/10" />
        <CardHeader className="relative flex flex-row flex-wrap items-start justify-between gap-3 px-3 pb-2 pt-2.5 sm:p-3">
          <div className="min-w-0">
            <CardTitle className="text-base tracking-tight sm:text-xl">E-Approval</CardTitle>
            <CardDescription className="text-xs">
              Note-sheets, verification and approval across departments.
              {lastUpdated && (
                <span className="ml-1">
                  Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-white/80" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {permissions.canCreate && (
              <Button asChild size="sm" className="h-8 gap-1.5">
                <Link href={`${E_APPROVAL_BASE_PATH}/create`}>
                  <FilePlus2 className="h-3.5 w-3.5" /> Create Approval
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className={cn(
              'rounded-xl border bg-background p-2.5 shadow-sm ring-1 transition-transform hover:-translate-y-0.5',
              card.tone,
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide sm:text-[11px]">
                {card.label}
              </p>
              <card.icon className="h-4 w-4 shrink-0 opacity-70" />
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">
              {loading || !counts ? '…' : counts[card.key]}
            </p>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
          <div>
            <CardTitle className="text-sm">Requires My Action</CardTitle>
            <CardDescription className="text-xs">Soonest deadline first.</CardDescription>
          </div>
          <Button asChild size="sm" variant="ghost" className="h-8 text-xs">
            <Link href={`${E_APPROVAL_BASE_PATH}/inbox`}>Open inbox</Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {loading ? (
            <div className="space-y-2 px-3">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <EApprovalActionList rows={requiresMyAction.slice(0, 8)} />
          )}
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
            <CardTitle className="text-sm">Where My Files Are</CardTitle>
            <CardDescription className="text-xs">Status of every approval you are involved in.</CardDescription>
          </CardHeader>
          <CardContent className="px-1 pb-2 sm:px-3 sm:pb-3">
            {loading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : statusChart.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">Nothing to show yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    isAnimationActive={false}
                    data={statusChart}
                    dataKey="count"
                    nameKey="status"
                    innerRadius={48}
                    outerRadius={82}
                    paddingAngle={2}
                  >
                    {statusChart.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || '#64748b'} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
            <CardTitle className="text-sm">Ageing of Open Approvals</CardTitle>
            <CardDescription className="text-xs">How long open files have been in the system.</CardDescription>
          </CardHeader>
          <CardContent className="px-1 pb-2 sm:px-3 sm:pb-3">
            {loading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={ageingChart} margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="bucket" fontSize={11} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} fontSize={11} stroke="#94a3b8" />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                  <Bar isAnimationActive={false} dataKey="count" name="Approvals" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {!loading && rows.every((row) => isTerminalEApprovalStatus(row.status)) && rows.length > 0 && (
        <p className="px-1 text-center text-xs text-muted-foreground">
          Nothing open — every approval you are involved in has been closed.
        </p>
      )}
    </div>
  );
}
