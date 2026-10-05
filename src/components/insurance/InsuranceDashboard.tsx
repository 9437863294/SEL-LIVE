'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { addDays, format } from 'date-fns';
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  HardHat,
  IndianRupee,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldHalf,
  Users,
} from 'lucide-react';
import type { InsurancePolicy, InsuranceTask, ProjectInsurancePolicy } from '@/lib/types';
import {
  annualisedPremium,
  bucketByMonth,
  compactInr,
  daysUntil,
  formatDay,
  formatInr,
  MATURITY_SOON_DAYS,
  personalPolicyState,
  policyFrequency,
  premiumByInsurer,
  premiumOutflows,
  projectPolicyState,
  relativeDays,
  toDate,
} from '@/lib/insurance';
import { OPEN_TASK_STATUSES } from '@/lib/insurance-service';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import {
  ForecastTable,
  InsurerBreakdown,
  PremiumForecastChart,
  SeriesLegend,
  StandingMeter,
  StatTile,
  useInsuranceSeries,
} from '@/components/insurance/dashboard-parts';
import { cn } from '@/lib/utils';

// ─── action queue ─────────────────────────────────────────────────────────────

type Queue = 'overdue' | 'expired' | 'upcoming' | 'maturing' | 'tasks';

interface ActionItem {
  key: string;
  kind: 'personal' | 'project' | 'task';
  label: string;
  detail: string;
  amount: number;
  date: Date | null;
  href: string;
  status: string;
  tone: StatusTone;
  rank: number;
}

const QUEUES: Array<{ key: Queue; label: string; empty: string; viewAll: string; viewLabel: string }> = [
  { key: 'overdue',  label: 'Overdue',        empty: 'No premiums in arrears.',                     viewAll: '/insurance/premium-due',         viewLabel: 'Premium Due' },
  { key: 'expired',  label: 'Expired cover',  empty: 'No project cover has run out.',               viewAll: '/insurance/project/premium-due', viewLabel: 'Project renewals' },
  { key: 'upcoming', label: 'Due in 30 days', empty: 'Nothing falls due in the next 30 days.',      viewAll: '/insurance/premium-due',         viewLabel: 'Premium Due' },
  { key: 'maturing', label: 'Maturing',       empty: `No maturities in the next ${MATURITY_SOON_DAYS} days.`, viewAll: '/insurance/maturity-due', viewLabel: 'Maturity Due' },
  { key: 'tasks',    label: 'My tasks',       empty: 'Nothing is waiting on you.',                  viewAll: '/insurance/my-tasks',            viewLabel: 'My Tasks' },
];

const MAX_ROWS = 7;

/** Personal and project insurance are separate books, each with its own dashboard page. */
export type DashboardScope = 'personal' | 'project';

export function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-52 rounded-xl lg:col-span-2" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

/** What each register the viewer may see and do; the dashboard shows only those parts. */
export interface DashboardAccess {
  personal: boolean;
  project: boolean;
  tasks: boolean;
  reports: boolean;
  addPersonal: boolean;
  addProject: boolean;
}

interface Props {
  /** Which book this dashboard is for; its policies and tasks are the only ones counted. */
  scope: DashboardScope;
  personalPolicies: InsurancePolicy[];
  projectPolicies: ProjectInsurancePolicy[];
  tasks: InsuranceTask[];
  userId: string;
  access: DashboardAccess;
  /** When the data was read — "now" for every due date on the page. */
  loadedAt: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}

/**
 * The insurance dashboard, drawn from policies and tasks already loaded. Kept apart from the page so
 * it renders from plain data: the page owns fetching and access, this owns what the numbers mean.
 */
export function InsuranceDashboard({ scope, personalPolicies: allPersonal, projectPolicies: allProject, tasks, userId, access, loadedAt, isRefreshing, onRefresh }: Props) {
  // Everything below reads only this dashboard's book, so no figure adds personal and project together.
  const isPersonal = scope === 'personal';
  const canViewPersonal = access.personal && isPersonal;
  const canViewProject = access.project && !isPersonal;
  const canAddPersonal = access.addPersonal && isPersonal;
  const canAddProject = access.addProject && !isPersonal;
  const { tasks: canViewTasks, reports: canViewReports } = access;
  const personalPolicies = useMemo(() => (canViewPersonal ? allPersonal : []), [canViewPersonal, allPersonal]);
  const projectPolicies = useMemo(() => (canViewProject ? allProject : []), [canViewProject, allProject]);
  const dueHref = isPersonal ? '/insurance/premium-due' : '/insurance/project/premium-due';

  const series = useInsuranceSeries();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [forecastView, setForecastView] = useState<'chart' | 'table'>('chart');

  // "Now" is the moment the data was read, so every figure on the page agrees about what is due.
  const now = useMemo(() => loadedAt ?? new Date(), [loadedAt]);

  const portfolio = useMemo(() => {
    const personal = personalPolicies.map((p) => ({ p, s: personalPolicyState(p, now) }));
    const project = projectPolicies.map((p) => ({ p, s: projectPolicyState(p, now) }));
    const personalLive = personal.filter((r) => r.s === 'active' || r.s === 'due-soon' || r.s === 'grace');
    const projectLive = project.filter((r) => r.s === 'active' || r.s === 'expiring');
    const count = <T extends { s: string }>(rows: T[], ...states: string[]) => rows.filter((r) => states.includes(r.s)).length;
    const lapsed = personal.filter((r) => r.s === 'lapsed');
    const grace = personal.filter((r) => r.s === 'grace');
    const maturedUnclaimed = count(personal, 'matured');
    return {
      personal,
      project,
      coverPersonal: personalLive.reduce((s, r) => s + (r.p.sum_insured || 0), 0),
      coverProject: projectLive.reduce((s, r) => s + (r.p.sum_insured || 0), 0),
      yearly: personalLive.reduce((s, r) => s + annualisedPremium(r.p.premium, policyFrequency(r.p)), 0)
        + projectLive.reduce((s, r) => s + (r.p.premium || 0), 0),
      live: personalLive.length + projectLive.length,
      lapsed: lapsed.length,
      grace: grace.length,
      arrears: [...lapsed, ...grace].reduce((s, r) => s + (r.p.premium || 0), 0),
      expiring: count(project, 'expiring'),
      expired: count(project, 'expired'),
      good: count(personal, 'active', 'due-soon') + count(project, 'active', 'expiring'),
      maturedUnclaimed,
    };
  }, [personalPolicies, projectPolicies, now]);

  const outflows = useMemo(
    () => premiumOutflows(personalPolicies, projectPolicies, now, addDays(now, 366), now),
    [personalPolicies, projectPolicies, now],
  );
  const buckets = useMemo(() => bucketByMonth(outflows, now, 12), [outflows, now]);
  const next30 = useMemo(() => outflows.filter((o) => !o.overdue && daysUntil(o.date, now) <= 30), [outflows, now]);
  const insurers = useMemo(() => premiumByInsurer(personalPolicies, projectPolicies, now), [personalPolicies, projectPolicies, now]);

  // The viewer's own workflow tasks, soonest deadline first.
  const myTasks = useMemo(() => {
    const open = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status) && t.assignees?.includes(userId));
    return [...open].sort((a, b) => (toDate(a.deadline)?.getTime() ?? Infinity) - (toDate(b.deadline)?.getTime() ?? Infinity));
  }, [tasks, userId]);

  const queues = useMemo(() => {
    const items: Record<Queue, ActionItem[]> = { overdue: [], expired: [], upcoming: [], maturing: [], tasks: [] };
    for (const t of myTasks) {
      const deadline = toDate(t.deadline);
      const late = !!deadline && deadline < now;
      items.tasks.push({
        key: `t-${t.id}`, kind: 'task', label: t.insuredPerson, detail: `${t.taskType} · ${t.policyNo}`,
        amount: t.amount ?? 0, date: deadline, href: '/insurance/my-tasks',
        status: late ? 'Past deadline' : t.currentStage, tone: late ? 'danger' : 'progress', rank: late ? 0 : 1,
      });
    }
    for (const { p, s } of portfolio.personal) {
      const due = toDate(p.due_date);
      const base = { kind: 'personal' as const, label: p.insured_person, detail: `${p.policy_no} · ${p.insurance_company}`, href: `/insurance/personal/${p.id}` };
      if (s === 'lapsed' || s === 'grace') {
        items.overdue.push({ ...base, key: `o-${p.id}`, amount: p.premium, date: due, status: s === 'lapsed' ? 'Lapsed' : 'In Grace', tone: s === 'lapsed' ? 'danger' : 'warning', rank: s === 'lapsed' ? 0 : 1 });
      } else if (s === 'due-soon') {
        items.upcoming.push({ ...base, key: `u-${p.id}`, amount: p.premium, date: due, status: 'Premium', tone: 'info', rank: 0 });
      }
      const maturity = toDate(p.date_of_maturity);
      const toMaturity = maturity ? daysUntil(maturity, now) : null;
      if (maturity && toMaturity !== null && p.status !== 'Claimed' && p.status !== 'Surrendered' && p.status !== 'Closed'
        && toMaturity <= MATURITY_SOON_DAYS && (toMaturity >= 0 || s === 'matured')) {
        items.maturing.push({
          ...base, key: `m-${p.id}`, amount: p.sum_insured, date: maturity,
          status: toMaturity <= 0 ? 'Unclaimed' : 'Maturing', tone: toMaturity <= 0 ? 'danger' : 'info', rank: toMaturity <= 0 ? 0 : 1,
        });
      }
    }
    for (const { p, s } of portfolio.project) {
      const end = toDate(p.insured_until);
      const base = { kind: 'project' as const, label: p.assetName, detail: `${p.policy_category} · ${p.insurance_company}`, href: `/insurance/project/${p.assetId}`, amount: p.premium, date: end };
      if (s === 'expired') items.expired.push({ ...base, key: `e-${p.id}`, status: 'Expired', tone: 'danger', rank: 0 });
      else if (s === 'expiring') items.upcoming.push({ ...base, key: `x-${p.id}`, status: 'Renewal', tone: 'warning', rank: 0 });
    }
    for (const list of Object.values(items)) {
      list.sort((a, b) => a.rank - b.rank || (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
    }
    return items;
  }, [portfolio.personal, portfolio.project, myTasks, now]);

  const visibleQueues = QUEUES.filter((q) =>
    q.key === 'tasks' ? canViewTasks
      : q.key === 'expired' ? canViewProject
      : q.key === 'maturing' || q.key === 'overdue' ? canViewPersonal
      : canViewPersonal || canViewProject);
  const activeQueue = queue ?? visibleQueues.find((q) => queues[q.key].length > 0)?.key ?? visibleQueues[0]?.key ?? 'upcoming';
  const baseMeta = QUEUES.find((q) => q.key === activeQueue)!;
  const activeMeta = baseMeta.key === 'upcoming' && !isPersonal
    ? { ...baseMeta, viewAll: dueHref, viewLabel: 'Project renewals' }
    : baseMeta;
  const activeItems = queues[activeQueue];
  const attentionCount = queues.overdue.length + queues.expired.length;

  const hasPolicies = canViewPersonal || canViewProject;
  const forecastTotal = buckets.reduce((s, b) => s + b.total, 0);
  const arrearsCarried = outflows.filter((o) => o.overdue).reduce((s, o) => s + o.amount, 0);
  const peak = buckets.reduce((best, b) => (b.total > best.total ? b : best), buckets[0]);
  const next30Total = next30.reduce((s, o) => s + o.amount, 0);
  const legend = [
    ...(canViewPersonal ? [{ label: 'Personal', color: series.personal }] : []),
    ...(canViewProject ? [{ label: 'Project', color: series.project }] : []),
  ];

  const newPolicy = canAddPersonal && canAddProject ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New Policy <ChevronDown className="h-3.5 w-3.5 opacity-70" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link href="/insurance/personal/new"><Users className="mr-2 h-4 w-4" /> Personal policy</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/insurance/project/new"><HardHat className="mr-2 h-4 w-4" /> Project policy</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : canAddPersonal || canAddProject ? (
    <Link href={canAddPersonal ? '/insurance/personal/new' : '/insurance/project/new'}>
      <Button size="sm" className="w-full gap-1.5"><Plus className="h-3.5 w-3.5" /> New Policy</Button>
    </Link>
  ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={isPersonal ? Users : HardHat}
        title={isPersonal ? 'Personal Insurance Dashboard' : 'Project Insurance Dashboard'}
        description={loadedAt ? `Portfolio overview · updated ${format(loadedAt, 'dd MMM, HH:mm')}` : 'Portfolio overview'}
        badge={attentionCount > 0 && (
          <Badge variant="danger" className="gap-1.5">
            <AlertTriangle className="h-3 w-3" /> {attentionCount} need{attentionCount === 1 ? 's' : ''} action
          </Badge>
        )}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={onRefresh} disabled={isRefreshing} className="gap-1.5">
              {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
            </Button>
            {newPolicy}
          </>
        }
      />

      <div className={cn('space-y-4 transition-opacity', isRefreshing && 'opacity-60')}>
        {hasPolicies && (
          /* ── Headline: the cover in force, and the four numbers that move it ─────────── */
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="border-border/60">
              <CardContent className="flex h-full flex-col justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Cover in force</p>
                  <p className="mt-1 text-5xl font-semibold leading-none tracking-tight text-foreground">
                    {compactInr(portfolio.coverPersonal + portfolio.coverProject)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sum assured and insured across {portfolio.live} live {portfolio.live === 1 ? 'policy' : 'policies'}
                  </p>
                  {personalPolicies.length + projectPolicies.length === 0 && (canAddPersonal || canAddProject) && (
                    <p className="mt-3 text-sm text-foreground">
                      Nothing is recorded yet.{' '}
                      <Link href={canAddPersonal ? '/insurance/personal/new' : '/insurance/project/new'} className="font-medium text-primary hover:underline">
                        Add the first policy
                      </Link>{' '}
                      to start tracking premiums, renewals and maturities.
                    </p>
                  )}
                </div>
                {canViewPersonal && canViewProject && (
                  <dl className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-sm">
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series.personal }} /> Personal
                      </dt>
                      <dd className="truncate font-semibold text-foreground">{compactInr(portfolio.coverPersonal)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series.project }} /> Project
                      </dt>
                      <dd className="truncate font-semibold text-foreground">{compactInr(portfolio.coverProject)}</dd>
                    </div>
                  </dl>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4 lg:col-span-2 [&>*:last-child:nth-child(odd)]:col-span-2">
              <StatTile
                label="Yearly premium"
                value={compactInr(portfolio.yearly)}
                sub={`${formatInr(portfolio.yearly)} outgo`}
                icon={IndianRupee}
                href={canViewReports ? '/insurance/reports/premium-forecast' : undefined}
              />
              <StatTile
                label="Due in 30 days"
                value={compactInr(next30Total)}
                sub={`${next30.length} payment${next30.length === 1 ? '' : 's'}`}
                icon={CalendarClock}
                href={dueHref}
              />
              {canViewPersonal && (
                <StatTile
                  label="Premium arrears"
                  value={compactInr(portfolio.arrears)}
                  sub={portfolio.lapsed + portfolio.grace > 0 ? `${portfolio.lapsed} lapsed · ${portfolio.grace} in grace` : 'None overdue'}
                  icon={AlertTriangle}
                  attention={portfolio.lapsed > 0 ? 'critical' : portfolio.grace > 0 ? 'warning' : undefined}
                  href="/insurance/premium-due"
                />
              )}
              {canViewProject && (
                <StatTile
                  label="Project renewals"
                  value={String(portfolio.expired + portfolio.expiring)}
                  sub={`${portfolio.expired} expired · ${portfolio.expiring} within 30 days`}
                  icon={ShieldAlert}
                  attention={portfolio.expired > 0 ? 'critical' : portfolio.expiring > 0 ? 'warning' : undefined}
                  href="/insurance/project/premium-due"
                />
              )}
            </div>
          </div>
        )}

        {/* ── Work: what needs doing, and how healthy the book is ───────────────────────── */}
        {(visibleQueues.length > 0 || hasPolicies) && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {visibleQueues.length > 0 && (
              <Card className={cn('min-w-0 border-border/60', hasPolicies ? 'lg:col-span-2' : 'lg:col-span-3')}>
                <CardHeader className="space-y-3 pb-3">
                  <div>
                    <CardTitle className="text-base">Action centre</CardTitle>
                    <CardDescription>Premiums, renewals, maturities and tasks that need someone to act</CardDescription>
                  </div>
                  <Tabs value={activeQueue} onValueChange={(v) => setQueue(v as Queue)}>
                    <TabsList className="h-auto w-full justify-start overflow-x-auto">
                      {visibleQueues.map((q) => (
                        <TabsTrigger key={q.key} value={q.key} className="group/tab shrink-0 gap-1.5 text-xs">
                          {q.label}
                          <span className={cn(
                            'rounded-full px-1.5 text-[10px] font-semibold tabular-nums group-data-[state=active]/tab:bg-[rgba(255,255,255,0.24)] group-data-[state=active]/tab:text-[color:var(--sel-tab-on)]',
                            queues[q.key].length && (q.key === 'overdue' || q.key === 'expired') ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground',
                          )}>
                            {queues[q.key].length}
                          </span>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </CardHeader>
                <CardContent className="pt-0">
                  {activeItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                      <CheckCircle2 className="h-9 w-9 text-emerald-500" aria-hidden />
                      <p className="text-sm text-muted-foreground">{activeMeta.empty}</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {activeItems.slice(0, MAX_ROWS).map((item) => (
                        <li key={item.key}>
                          <Link href={item.href} className="-mx-2 flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/40">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
                              {item.kind === 'personal' ? <Users className="h-4 w-4" /> : item.kind === 'project' ? <HardHat className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-medium text-foreground">{item.label}</span>
                                <StatusBadge status={item.status} tone={item.tone} className="hidden shrink-0 sm:inline-flex" />
                              </span>
                              <span className="block truncate text-xs text-muted-foreground"><span className="font-medium text-foreground sm:hidden">{item.status} · </span>{item.detail}</span>
                            </span>
                            <span className="shrink-0 text-right">
                              {item.amount > 0 && <span className="block text-sm font-semibold tabular-nums text-foreground">{formatInr(item.amount)}</span>}
                              <span className="block text-xs text-muted-foreground">
                                {item.date
                                  ? `${item.kind === 'task' ? 'Deadline ' : ''}${formatDay(item.date, 'dd MMM')} · ${relativeDays(item.date, now)}`
                                  : '—'}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link href={activeMeta.viewAll} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {activeItems.length > MAX_ROWS ? `View all ${activeItems.length} in ${activeMeta.viewLabel}` : `Open ${activeMeta.viewLabel}`}
                    <ChevronRight className="h-3 w-3" />
                  </Link>
                </CardContent>
              </Card>
            )}

            {hasPolicies && (
              <Card className={cn('min-w-0 border-border/60', visibleQueues.length === 0 && 'lg:col-span-3')}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Portfolio standing</CardTitle>
                  <CardDescription>Of the policies that should be in force, how many are paid up and in cover</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <StandingMeter
                    good={portfolio.good}
                    total={portfolio.good + portfolio.grace + portfolio.lapsed + portfolio.expired}
                    icon={{ good: CheckCircle2, warning: Clock, critical: AlertTriangle }}
                  />
                  <dl className="space-y-2 text-sm">
                    {[
                      { label: 'In good standing', value: portfolio.good, icon: CheckCircle2, show: true },
                      { label: 'In grace period', value: portfolio.grace, icon: Clock, show: canViewPersonal },
                      { label: 'Lapsed', value: portfolio.lapsed, icon: AlertTriangle, show: canViewPersonal },
                      { label: 'Expired cover', value: portfolio.expired, icon: ShieldAlert, show: canViewProject },
                      { label: 'Matured, unclaimed', value: portfolio.maturedUnclaimed, icon: CalendarCheck, show: canViewPersonal },
                    ].filter((r) => r.show).map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-3">
                        <dt className="inline-flex items-center gap-2 text-muted-foreground"><r.icon className="h-3.5 w-3.5" aria-hidden /> {r.label}</dt>
                        <dd className="font-medium tabular-nums text-foreground">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── Money: what the book will cost, and with whom ─────────────────────────────── */}
        {hasPolicies && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="min-w-0 border-border/60 lg:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">Premium outflow — next 12 months</CardTitle>
                    <CardDescription>
                      {formatInr(forecastTotal)} in all
                      {peak && peak.total > 0 ? ` · peak ${compactInr(peak.total)} in ${format(peak.month, 'MMM yyyy')}` : ''}
                      {arrearsCarried > 0 ? ` · ${compactInr(arrearsCarried)} arrears carried into this month` : ''}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {legend.length > 1 && forecastView === 'chart' && <SeriesLegend items={legend} />}
                    <div className="inline-flex rounded-md border border-border/60 p-0.5" role="group" aria-label="Show forecast as">
                      {(['chart', 'table'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setForecastView(v)}
                          aria-pressed={forecastView === v}
                          className={cn(
                            'rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors',
                            forecastView === v ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                {forecastView === 'chart'
                  ? <PremiumForecastChart buckets={buckets} showPersonal={canViewPersonal} showProject={canViewProject} />
                  : <ForecastTable buckets={buckets} showPersonal={canViewPersonal} showProject={canViewProject} />}
                {canViewReports && (
                  <Link href="/insurance/reports/premium-forecast" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    Full forecast &amp; Excel export <ChevronRight className="h-3 w-3" />
                  </Link>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 border-border/60">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">Premium by insurer</CardTitle>
                    <CardDescription>Yearly outgo on live cover</CardDescription>
                  </div>
                  {legend.length > 1 && <SeriesLegend items={legend} />}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <InsurerBreakdown rows={insurers} showPersonal={canViewPersonal} showProject={canViewProject} />
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
