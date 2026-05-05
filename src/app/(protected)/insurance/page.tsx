
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Files,
  HardHat,
  IndianRupee,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldHalf,
  TrendingUp,
  Users,
} from 'lucide-react';
import { addDays, format, isPast, isWithinInterval, startOfDay } from 'date-fns';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { InsurancePolicy, InsuranceTask, InsuredAsset, ProjectInsurancePolicy } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmt = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

function personalStatus(policy: InsurancePolicy): 'overdue' | 'due-soon' | 'active' | 'matured' {
  const today = startOfDay(new Date());
  const maturity = policy.date_of_maturity?.toDate?.();
  if (maturity && isPast(maturity)) return 'matured';
  const due = policy.due_date?.toDate?.();
  if (!due) return 'active';
  if (isPast(startOfDay(due))) return 'overdue';
  if (isWithinInterval(due, { start: today, end: addDays(today, 30) })) return 'due-soon';
  return 'active';
}

// ─── loading skeleton ─────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-52 rounded-xl" />
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function InsuranceDashboardPage() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const canViewModule     = can('View Module', 'Insurance');
  const canViewPersonal   = can('View', 'Insurance.Personal Insurance');
  const canViewProject    = can('View', 'Insurance.Project Insurance');
  const canViewTasks      = can('View', 'Insurance.My Tasks');
  const canViewReports    = can('View', 'Insurance.Reports');
  const canViewSettings   = can('View', 'Insurance.Settings');

  const [isLoading, setIsLoading]         = useState(true);
  const [personalPolicies, setPersonal]   = useState<InsurancePolicy[]>([]);
  const [projectPolicies, setProject]     = useState<ProjectInsurancePolicy[]>([]);
  const [tasks, setTasks]                 = useState<InsuranceTask[]>([]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const fetches = await Promise.all([
        canViewPersonal ? getDocs(collection(db, 'insurance_policies'))   : null,
        canViewProject  ? getDocs(collection(db, 'project_insurance_policies')) : null,
        canViewTasks    ? getDocs(collection(db, 'insuranceTasks'))        : null,
      ]);
      if (fetches[0]) setPersonal(fetches[0].docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy)));
      if (fetches[1]) setProject(fetches[1].docs.map((d) => ({ id: d.id, ...d.data() } as ProjectInsurancePolicy)));
      if (fetches[2]) setTasks(fetches[2].docs.map((d) => ({ id: d.id, ...d.data() } as InsuranceTask)));
    } catch (err) {
      console.error('Insurance dashboard load error', err);
    } finally {
      setIsLoading(false);
    }
  }, [canViewPersonal, canViewProject, canViewTasks]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  // ─── computed stats ───────────────────────────────────────────────────────

  const personalStats = useMemo(() => {
    const overdue  = personalPolicies.filter((p) => personalStatus(p) === 'overdue');
    const dueSoon  = personalPolicies.filter((p) => personalStatus(p) === 'due-soon');
    const matured  = personalPolicies.filter((p) => personalStatus(p) === 'matured');
    const active   = personalPolicies.filter((p) => personalStatus(p) === 'active');
    const overdueAmount = overdue.reduce((s, p) => s + (p.premium || 0), 0);
    const dueSoonAmount = dueSoon.reduce((s, p) => s + (p.premium || 0), 0);
    return { total: personalPolicies.length, overdue, dueSoon, matured, active, overdueAmount, dueSoonAmount };
  }, [personalPolicies]);

  const projectStats = useMemo(() => {
    const today   = new Date();
    const active   = projectPolicies.filter((p) => p.status === 'Active');
    const expired  = projectPolicies.filter((p) => p.status === 'Expired');
    const expiring = active.filter((p) => {
      const d = p.insured_until?.toDate?.();
      return d && isWithinInterval(d, { start: today, end: addDays(today, 30) });
    });
    return { total: projectPolicies.length, active: active.length, expired: expired.length, expiring: expiring.length };
  }, [projectPolicies]);

  const taskStats = useMemo(() => {
    const myPending = tasks.filter(
      (t) => (t.status === 'Pending' || t.status === 'In Progress') && t.assignees?.includes(user?.id ?? '')
    );
    const allPending = tasks.filter((t) => t.status === 'Pending' || t.status === 'In Progress');
    return { myPending: myPending.length, allPending: allPending.length };
  }, [tasks, user?.id]);

  // Upcoming premiums (personal, next 5 by due date)
  const upcomingPremiums = useMemo(() =>
    personalPolicies
      .filter((p) => {
        const d = p.due_date?.toDate?.();
        return d && !isPast(startOfDay(d)) && isWithinInterval(d, { start: new Date(), end: addDays(new Date(), 60) });
      })
      .sort((a, b) => {
        const da = a.due_date?.toDate?.()?.getTime() ?? 0;
        const db = b.due_date?.toDate?.()?.getTime() ?? 0;
        return da - db;
      })
      .slice(0, 5),
  [personalPolicies]);

  // Critical alerts (overdue personal + expired project)
  const criticalAlerts = useMemo(() => {
    const personal = personalStats.overdue.slice(0, 4).map((p) => ({
      type: 'personal' as const,
      label: p.insured_person,
      detail: p.policy_no,
      amount: p.premium,
      dueDate: p.due_date?.toDate?.() ?? null,
    }));
    const project = projectPolicies
      .filter((p) => p.status === 'Expired')
      .slice(0, 4)
      .map((p) => ({
        type: 'project' as const,
        label: p.assetName,
        detail: p.policy_no,
        amount: p.premium,
        dueDate: p.insured_until?.toDate?.() ?? null,
      }));
    return [...personal, ...project];
  }, [personalStats.overdue, projectPolicies]);

  if (authLoading || isLoading) return <DashboardSkeleton />;

  if (!canViewModule) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied
          </CardTitle>
          <CardDescription>You do not have permission to access the Insurance module.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-0 bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white shadow-lg">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_white_0%,_transparent_60%)]" />
        <CardContent className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <ShieldHalf className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Insurance</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Comprehensive coverage management for personal &amp; project assets
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {criticalAlerts.length > 0 && (
              <Badge className="gap-1.5 bg-red-500/90 text-white shadow-sm text-xs">
                <AlertTriangle className="h-3 w-3" />
                {criticalAlerts.length} Critical Alert{criticalAlerts.length !== 1 ? 's' : ''}
              </Badge>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={load}
              className="gap-1.5 bg-white/20 text-white hover:bg-white/30 border-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── KPI Stats ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: 'Personal Policies',
            value: personalStats.total,
            sub: `${personalStats.active.length} active`,
            icon: Users,
            gradient: 'from-violet-500 to-purple-600',
            show: canViewPersonal,
          },
          {
            label: 'Project Policies',
            value: projectStats.total,
            sub: `${projectStats.active} active`,
            icon: HardHat,
            gradient: 'from-emerald-500 to-teal-600',
            show: canViewProject,
          },
          {
            label: 'Overdue Premiums',
            value: personalStats.overdue.length,
            sub: personalStats.overdueAmount > 0 ? fmt(personalStats.overdueAmount) : 'None',
            icon: AlertTriangle,
            gradient: 'from-rose-500 to-red-600',
            show: canViewPersonal,
          },
          {
            label: 'My Pending Tasks',
            value: taskStats.myPending,
            sub: `${taskStats.allPending} total pending`,
            icon: ClipboardCheck,
            gradient: 'from-cyan-500 to-sky-600',
            show: canViewTasks,
          },
        ]
          .filter((s) => s.show)
          .map((stat) => (
            <Card key={stat.label} className="overflow-hidden border-border/60">
              <div className={cn('h-0.5 w-full bg-gradient-to-r', stat.gradient)} />
              <CardContent className="flex items-center gap-3 p-4">
                <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm', stat.gradient)}>
                  <stat.icon className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground truncate">{stat.label}</p>
                  <p className="text-2xl font-bold leading-tight">{stat.value}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{stat.sub}</p>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>

      {/* ── Critical Alerts + Upcoming Premiums ─────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

        {/* Critical Alerts */}
        <Card className="overflow-hidden border-border/60">
          <div className="h-1 w-full bg-gradient-to-r from-rose-500 to-red-600" />
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              Critical Alerts
            </CardTitle>
            <CardDescription>Overdue premiums &amp; expired project policies</CardDescription>
          </CardHeader>
          <CardContent>
            {criticalAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                <p className="text-sm font-medium text-slate-600">All Clear</p>
                <p className="text-xs text-muted-foreground">No overdue premiums or expired policies.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {criticalAlerts.map((alert, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-100">
                        {alert.type === 'personal'
                          ? <Users className="h-3.5 w-3.5 text-rose-600" />
                          : <Building2 className="h-3.5 w-3.5 text-rose-600" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{alert.label}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{alert.detail}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-semibold text-rose-600">{fmt(alert.amount)}</p>
                      {alert.dueDate && (
                        <p className="text-[11px] text-muted-foreground">
                          {format(alert.dueDate, 'dd MMM yy')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {(personalStats.overdue.length + projectPolicies.filter((p) => p.status === 'Expired').length) > criticalAlerts.length && (
                  <Link href="/insurance/premium-due">
                    <Button variant="ghost" size="sm" className="w-full mt-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 text-xs">
                      View all alerts <ChevronRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Premiums */}
        <Card className="overflow-hidden border-border/60">
          <div className="h-1 w-full bg-gradient-to-r from-amber-400 to-orange-500" />
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-amber-500" />
              Upcoming Premiums
            </CardTitle>
            <CardDescription>Next 60 days — personal insurance</CardDescription>
          </CardHeader>
          <CardContent>
            {!canViewPersonal ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No access to personal insurance.</p>
            ) : upcomingPremiums.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <ShieldCheck className="h-10 w-10 text-emerald-400" />
                <p className="text-sm font-medium text-slate-600">No upcoming premiums</p>
                <p className="text-xs text-muted-foreground">No payments due in the next 60 days.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingPremiums.map((p) => {
                  const due = p.due_date?.toDate?.();
                  const daysLeft = due
                    ? Math.ceil((due.getTime() - new Date().getTime()) / 86_400_000)
                    : null;
                  const urgent = daysLeft !== null && daysLeft <= 7;
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5',
                        urgent ? 'border-amber-200 bg-amber-50/60' : 'border-border/60 bg-muted/30'
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', urgent ? 'bg-amber-100' : 'bg-slate-100')}>
                          <Shield className={cn('h-3.5 w-3.5', urgent ? 'text-amber-600' : 'text-slate-500')} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">{p.insured_person}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{p.policy_no} · {p.payment_type}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-semibold text-slate-700">{fmt(p.premium)}</p>
                        {due && (
                          <p className={cn('text-[11px]', urgent ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
                            {daysLeft === 0 ? 'Today' : daysLeft === 1 ? '1 day' : `${daysLeft}d`} · {format(due, 'dd MMM')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
                <Link href="/insurance/premium-due">
                  <Button variant="ghost" size="sm" className="w-full mt-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50 text-xs">
                    View all upcoming <ChevronRight className="h-3 w-3 ml-1" />
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Second stats row — project expiring + due-soon personal ─────── */}
      {(canViewPersonal || canViewProject) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {canViewPersonal && (
            <Card className="overflow-hidden border-border/60">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-sm">
                  <CalendarClock className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Due Within 30 Days</p>
                  <p className="text-2xl font-bold leading-tight">{personalStats.dueSoon.length}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {personalStats.dueSoonAmount > 0 ? fmt(personalStats.dueSoonAmount) : 'No personal premiums'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          {canViewProject && (
            <Card className="overflow-hidden border-border/60">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 shadow-sm">
                  <ShieldAlert className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Project Policies Expiring</p>
                  <p className="text-2xl font-bold leading-tight">{projectStats.expiring}</p>
                  <p className="text-[11px] text-muted-foreground">within 30 days</p>
                </div>
              </CardContent>
            </Card>
          )}
          {canViewPersonal && (
            <Card className="overflow-hidden border-border/60">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-400 to-slate-600 shadow-sm">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Matured Policies</p>
                  <p className="text-2xl font-bold leading-tight">{personalStats.matured.length}</p>
                  <p className="text-[11px] text-muted-foreground">personal policies matured</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Quick Navigation ─────────────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Access</CardTitle>
          <CardDescription>Jump to any section of the Insurance module</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {[
              { href: '/insurance/personal',          label: 'Personal Insurance', desc: 'Policies & premiums',     icon: Users,          gradient: 'from-violet-500 to-purple-600', show: canViewPersonal },
              { href: '/insurance/premium-due',        label: 'Premium Due',        desc: 'Upcoming & overdue',     icon: CalendarClock,  gradient: 'from-amber-400 to-orange-500',  show: canViewPersonal },
              { href: '/insurance/maturity-due',       label: 'Maturity Due',       desc: 'Policies near maturity', icon: ShieldCheck,    gradient: 'from-rose-400 to-rose-600',     show: canViewPersonal },
              { href: '/insurance/project',            label: 'Project Insurance',  desc: 'Assets & properties',   icon: HardHat,        gradient: 'from-emerald-500 to-teal-600',  show: canViewProject },
              { href: '/insurance/project/all-policies', label: 'All Policies',     desc: 'Project policy list',    icon: Files,          gradient: 'from-teal-500 to-cyan-600',     show: canViewProject },
              { href: '/insurance/my-tasks',           label: 'My Tasks',           desc: 'Pending approvals',     icon: ClipboardCheck, gradient: 'from-cyan-500 to-sky-600',      show: canViewTasks },
              { href: '/insurance/reports',            label: 'Reports',            desc: 'Analytics & exports',    icon: BarChart3,      gradient: 'from-indigo-500 to-blue-600',   show: canViewReports },
              { href: '/insurance/settings',           label: 'Settings',           desc: 'Workflow & masters',     icon: IndianRupee,    gradient: 'from-slate-500 to-slate-700',   show: canViewSettings },
            ]
              .filter((n) => n.show)
              .map((nav) => (
                <Link key={nav.href} href={nav.href}>
                  <div className="group flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3 cursor-pointer transition-all duration-200 hover:bg-background hover:shadow-sm hover:-translate-y-0.5">
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm', nav.gradient)}>
                      <nav.icon className="h-4 w-4 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight truncate">{nav.label}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{nav.desc}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 ml-auto group-hover:text-muted-foreground transition-colors" />
                  </div>
                </Link>
              ))}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
