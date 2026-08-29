'use client';

/**
 * The Overview dashboard (§37) — the first screen an administrator sees, and the one that has to
 * answer "is access in good shape?" before they click anything.
 *
 * It reads top to bottom the way a review does: a headline (what share of active users hold a role
 * with no separation-of-duties conflict), the eight counts, what needs attention, how access has
 * been moving over the last month, and then the specific people and grants worth a look. Every
 * number opens the tab or report that explains it — a count you cannot act on is trivia.
 *
 * Extracted from `access-control-center.tsx` when it grew charts of its own: the shell file is the
 * ten tabs' plumbing, not a dashboard.
 *
 * ── The charts ──────────────────────────────────────────────────────────────────────────────────
 *
 * Three, deliberately: a column chart of changes per day (the only time series the module has),
 * and two ranked bar lists (roles by holders, modules by reach). Each is a single hue except the
 * column chart, whose two series — granted and removed — wear the same emerald and rose the audit
 * tables' +/− badges use, so the reader has already learned them. Both hues were validated
 * together for colour-vision separation against the white card surface; the legend and a
 * per-column readout carry identity and value, so colour never does either job alone. The audit
 * tab is the table view of the same data.
 */

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  KeyRound,
  Layers,
  Link2,
  ShieldAlert,
  ShieldCheck,
  ShieldMinus,
  ShieldPlus,
  Sparkles,
  UserCog,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SpotlightCard } from '@/components/effects/SpotlightCard';
import { CountUp } from '@/components/effects/CountUp';
import { cn } from '@/lib/utils';
import {
  describeAuditEntry,
  detectPrivilegedAccess,
  detectSodConflicts,
  expiringTemporaryGrants,
  formatGrantDate,
  registryPermissionCount,
  type AccessAuditEntry,
} from '@/lib/access-control';
import { listAccessAuditEntries } from '@/lib/access-control-service';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import type { ReportId } from './access-reports';
import { AccessCard, AccessKpiCard, RiskBadges } from './access-ui';

/** The tabs the Overview can send somebody to — everything but itself. */
export type OverviewTab =
  | 'users'
  | 'roles'
  | 'permissions'
  | 'assign'
  | 'matrix'
  | 'effective'
  | 'templates'
  | 'reports'
  | 'audit';

/** How many days the change chart and the "changes" figure cover. */
const CHANGE_WINDOW_DAYS = 30;

export function AccessOverview({
  state,
  onNavigate,
  onAssign,
  onOpenReport,
  onInspect,
}: {
  state: AccessDirectoryState;
  onNavigate: (tab: OverviewTab) => void;
  onAssign: (seed: { userIds?: string[]; roleIds?: string[]; templateIds?: string[] }) => void;
  onOpenReport: (report: ReportId) => void;
  onInspect: (userId: string) => void;
}) {
  const { dashboard, directory, accessByUser, registry, roleUsage } = state;

  const registryTotal = useMemo(() => registryPermissionCount(registry), [registry]);

  const usersWithoutRoles = useMemo(
    () => directory.users.filter((user) => !user.role && !(directory.grants[user.id]?.additionalRoles.length)),
    [directory],
  );

  const expiring = useMemo(() => {
    const grants = directory.users.flatMap((user) =>
      (directory.grants[user.id]?.temporaryAccess ?? []).map((entry) => ({ user, entry })),
    );
    const soon = expiringTemporaryGrants(grants.map((row) => row.entry), 7);
    const ids = new Set(soon.map((entry) => entry.id));
    return grants.filter((row) => ids.has(row.entry.id));
  }, [directory]);

  const mostAccess = useMemo(
    () =>
      directory.users
        .map((user) => ({ user, access: accessByUser[user.id] }))
        .filter((row) => row.access)
        .sort((a, b) => (b.access?.permissionCount ?? 0) - (a.access?.permissionCount ?? 0))
        .slice(0, 8),
    [directory.users, accessByUser],
  );

  const unusedRoles = useMemo(
    () => directory.roles.filter((role) => (roleUsage[role.name]?.total ?? 0) === 0),
    [directory.roles, roleUsage],
  );

  /**
   * Active logins with no greytHR employee record behind them.
   *
   * Only counted for active users: an inactive account with no link is somebody who left before the
   * mirror existed, and nagging about it every time this screen opens teaches administrators to
   * ignore the alert. A live login with no employee record is different — every piece of profile data
   * on it has to be typed by hand and stays wrong when HR changes it.
   */
  const unlinkedActiveUsers = useMemo(
    () => directory.users.filter((user) => user.status === 'Active' && !user.employeeId),
    [directory.users],
  );

  /**
   * The headline: of the people who can sign in, how many hold a role and cannot both create and
   * approve the same thing. Privileged access is not counted against anybody — administrators
   * legitimately hold it — and inactive accounts are not in the denominator, because a resigned
   * employee's stale record says nothing about how the live population is set up.
   */
  const posture = useMemo(() => {
    const active = directory.users.filter((user) => (user.status ?? 'Active') === 'Active');
    const attention = active.filter((user) => {
      const noRole = !user.role && !(directory.grants[user.id]?.additionalRoles.length);
      const access = accessByUser[user.id];
      const conflicted = access ? detectSodConflicts(access).length > 0 : false;
      return noRole || conflicted;
    });
    const healthy = active.length - attention.length;
    return {
      active: active.length,
      healthy,
      attention: attention.length,
      healthyShare: active.length ? Math.round((healthy / active.length) * 100) : 100,
    };
  }, [directory, accessByUser]);

  const audit = useRecentAudit(directory);
  const changeDays = useMemo(() => bucketByDay(audit.entries, CHANGE_WINDOW_DAYS), [audit.entries]);
  const changeTotals = useMemo(
    () =>
      changeDays.reduce(
        (sum, day) => ({
          granted: sum.granted + day.granted,
          removed: sum.removed + day.removed,
          total: sum.total + day.granted + day.removed,
        }),
        { granted: 0, removed: 0, total: 0 },
      ),
    [changeDays],
  );
  const recentEntries = useMemo(
    () => [...audit.entries].sort((a, b) => b.changedAt.localeCompare(a.changedAt)).slice(0, 6),
    [audit.entries],
  );

  /** Roles by how many people hold them, base or additional — the shape of the organisation's access. */
  const rolesByHolders = useMemo(
    () =>
      directory.roles
        .map((role) => ({ id: role.id, label: role.name, value: roleUsage[role.name]?.total ?? 0 }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    [directory.roles, roleUsage],
  );

  /** Modules by how many active users can reach them. */
  const modulesByReach = useMemo(() => {
    const counts = new Map<string, number>();
    for (const user of directory.users) {
      if ((user.status ?? 'Active') !== 'Active') continue;
      for (const moduleName of accessByUser[user.id]?.modules ?? []) {
        counts.set(moduleName, (counts.get(moduleName) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ id: label, label, value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }, [directory.users, accessByUser]);

  /* ---- What needs attention. Rose is "somebody cannot work or should not be able to"; amber is
     "worth a look"; slate is "know this". ---- */
  const findings: Finding[] = [];
  if (usersWithoutRoles.length > 0) {
    findings.push({
      id: 'no-role',
      tone: 'rose',
      icon: ShieldAlert,
      title: `${usersWithoutRoles.length} user(s) have no role at all`,
      description: `${usersWithoutRoles
        .slice(0, 4)
        .map((user) => user.name || user.email)
        .join(', ')}${usersWithoutRoles.length > 4 ? `, +${usersWithoutRoles.length - 4} more` : ''}. They can sign in but see nothing.`,
      actionLabel: 'Assign access',
      onAction: () => onAssign({ userIds: usersWithoutRoles.map((user) => user.id) }),
    });
  }
  if (dashboard.usersWithSodConflicts > 0) {
    findings.push({
      id: 'sod',
      tone: 'rose',
      icon: AlertTriangle,
      title: `${dashboard.usersWithSodConflicts} user(s) can both create and approve`,
      description:
        'A separation-of-duties conflict: the same person can raise something and sign it off. Allowed, but every one should be a decision somebody made.',
      actionLabel: 'Open the report',
      onAction: () => onOpenReport('privileged'),
    });
  }
  if (dashboard.inactiveUsersHoldingAccess > 0) {
    findings.push({
      id: 'inactive',
      tone: 'amber',
      icon: UserX,
      title: `${dashboard.inactiveUsersHoldingAccess} inactive user(s) still hold permissions`,
      description:
        'They cannot sign in, but reactivating the account restores everything. Worth reviewing for anybody who has left permanently.',
      actionLabel: 'Open the report',
      onAction: () => onOpenReport('inactive'),
    });
  }
  if (unlinkedActiveUsers.length > 0) {
    findings.push({
      id: 'unlinked',
      tone: 'amber',
      icon: Link2,
      title: `${unlinkedActiveUsers.length} active login(s) are not linked to a greytHR employee`,
      description:
        'Department, designation and joining date come from greytHR. Until a login is linked, its profile data has to be maintained by hand — the linking console proposes the confident matches for you.',
      actionLabel: 'Open greytHR linking',
      actionHref: '/settings/user-management/greythr-linking',
    });
  }
  if (dashboard.privilegedUsers > 0) {
    findings.push({
      id: 'privileged',
      tone: 'slate',
      icon: UserCog,
      title: `${dashboard.privilegedUsers} user(s) hold a high-risk capability`,
      description:
        'Managing accounts or roles, deleting financial records, releasing payments or bank instruments. Not a problem — the list to know by heart.',
      actionLabel: 'See who',
      onAction: () => onOpenReport('privileged'),
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- Headline ---- */}
      <section
        className="animate-am-card-in relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-4 text-white shadow-lg sm:p-5"
        style={{ animationFillMode: 'both' }}
      >
        {/* Two soft highlights, so the gradient reads as light on a surface rather than a flat block. */}
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-fuchsia-300/25 blur-3xl" />

        <div className="relative grid gap-4 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-6">
          <div className="flex items-center gap-4 lg:contents">
            <RingGauge percent={posture.healthyShare} />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">Access posture</p>
              {/* The one hero figure on the page — the same sans as everything else, proportional figures. */}
              <p className="mt-1 text-4xl font-semibold leading-none sm:text-5xl">
                <CountUp value={posture.healthyShare} />%
              </p>
              <p className="mt-2 max-w-xl text-sm text-white/85">
                {posture.healthy} of {posture.active} active users hold a role with no separation-of-duties
                conflict.{' '}
                {posture.attention > 0
                  ? `${posture.attention} need${posture.attention === 1 ? 's' : ''} attention below.`
                  : 'Nothing needs attention right now.'}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[19rem] lg:grid-cols-2">
            <HeroStat label="Active users" value={dashboard.activeUsers} hint={`of ${dashboard.totalUsers} accounts`} />
            <HeroStat
              label="Roles in use"
              value={dashboard.totalRoles - unusedRoles.length}
              hint={`of ${dashboard.totalRoles} defined`}
            />
            <HeroStat
              label={`Changes · ${CHANGE_WINDOW_DAYS} days`}
              value={changeTotals.total}
              hint={audit.loading ? 'Loading…' : `${changeTotals.granted} granted · ${changeTotals.removed} removed`}
              dim={audit.loading}
            />
            <HeroStat
              label="Expiring · 7 days"
              value={dashboard.temporaryAccessExpiringSoon}
              hint={`${dashboard.temporaryAccessActive} temporary grant(s) active`}
            />
          </dl>
        </div>
      </section>

      {/* ---- The eight counts. Every one opens the tab (or report) that explains its number. ---- */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <AccessKpiCard index={0} label="Total users" value={dashboard.totalUsers} hint={`${dashboard.activeUsers} active`} icon={Users} tone="blue" onClick={() => onNavigate('users')} />
        <AccessKpiCard index={1} label="Roles" value={dashboard.totalRoles} hint={`${dashboard.customRoles} custom`} icon={Layers} tone="indigo" onClick={() => onNavigate('roles')} />
        <AccessKpiCard
          index={2}
          label="Grantable permissions"
          value={registryTotal}
          hint={`${dashboard.totalPermissions} used by roles`}
          icon={KeyRound}
          tone="violet"
          onClick={() => onNavigate('permissions')}
        />
        <AccessKpiCard
          index={3}
          label="Users with added access"
          value={dashboard.usersWithAdditionalAccess}
          hint="On top of their base role"
          icon={ShieldPlus}
          tone="emerald"
          onClick={() => onOpenReport('user-access')}
        />
        <AccessKpiCard
          index={4}
          label="Privileged users"
          value={dashboard.privilegedUsers}
          hint="Hold a high-risk capability"
          icon={UserCog}
          tone="amber"
          onClick={() => onOpenReport('privileged')}
        />
        <AccessKpiCard
          index={5}
          label="SoD conflicts"
          value={dashboard.usersWithSodConflicts}
          hint="Can create and approve"
          icon={AlertTriangle}
          tone={dashboard.usersWithSodConflicts ? 'rose' : 'slate'}
          onClick={() => onOpenReport('privileged')}
        />
        <AccessKpiCard
          index={6}
          label="Temporary active"
          value={dashboard.temporaryAccessActive}
          hint={`${dashboard.temporaryAccessExpiringSoon} expiring in 7 days`}
          icon={CalendarClock}
          tone="orange"
          onClick={() => onOpenReport('temporary')}
        />
        <AccessKpiCard
          index={7}
          label="Users without a role"
          value={dashboard.usersWithoutRoles}
          hint="Cannot access anything"
          icon={UserX}
          tone={dashboard.usersWithoutRoles ? 'rose' : 'slate'}
          onClick={() => onNavigate('users')}
        />
      </div>

      {/* ---- Needs attention ---- */}
      <section className="space-y-2">
        <SectionLabel
          icon={ShieldAlert}
          title="Needs attention"
          hint={findings.length ? `${findings.length} finding${findings.length === 1 ? '' : 's'}` : 'All clear'}
        />
        {findings.length === 0 ? (
          <div
            className="animate-am-card-in flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3"
            style={{ animationDelay: '480ms', animationFillMode: 'both' }}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-emerald-900">All clear</p>
              <p className="text-xs text-emerald-800">
                Every active user holds a role, nobody can both create and approve the same thing, no
                deactivated account still holds permissions, and every active login is linked to a greytHR
                employee.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-2.5 lg:grid-cols-2">
            {findings.map((finding, index) => (
              <AlertCard key={finding.id} finding={finding} delay={480 + index * 60} />
            ))}
          </div>
        )}
      </section>

      {/* ---- Trends ---- */}
      <section className="space-y-2">
        <SectionLabel icon={BarChart3} title="Shape of access" hint={`Last ${CHANGE_WINDOW_DAYS} days · top 8`} />
        <div className="grid gap-2.5 lg:grid-cols-3">
          <ChartCard
            delay={660}
            spotlight="rgba(5, 150, 105, 0.14)"
            icon={Activity}
            iconClassName="text-emerald-600"
            title="Access changes"
            description={
              audit.loading
                ? 'Loading recent changes…'
                : audit.error
                  ? audit.error
                  : `${changeTotals.granted} granted · ${changeTotals.removed} removed, per day.`
            }
            action={<OpenLink label="Audit history" onClick={() => onNavigate('audit')} />}
          >
            <div className={cn('transition-opacity duration-300', audit.loading && 'opacity-40')}>
              <ChangesColumnChart days={changeDays} onOpen={() => onNavigate('audit')} />
            </div>
          </ChartCard>

          <ChartCard
            delay={720}
            spotlight="rgba(79, 70, 229, 0.14)"
            icon={Layers}
            iconClassName="text-indigo-600"
            title="Most-held roles"
            description="Holders per role, base and additional together."
            action={<OpenLink label="Role usage" onClick={() => onOpenReport('role-usage')} />}
          >
            <RankedBars
              rows={rolesByHolders.slice(0, 8)}
              unit="user(s)"
              onSelect={() => onOpenReport('role-usage')}
              emptyLabel="No role has a holder yet."
              footer={rolesByHolders.length > 8 ? `+${rolesByHolders.length - 8} more roles` : undefined}
            />
          </ChartCard>

          <ChartCard
            delay={780}
            spotlight="rgba(139, 92, 246, 0.14)"
            icon={KeyRound}
            iconClassName="text-violet-600"
            title="Most-reached modules"
            description="Active users who can open each module."
            action={<OpenLink label="Permission matrix" onClick={() => onNavigate('matrix')} />}
          >
            <RankedBars
              rows={modulesByReach.slice(0, 8)}
              unit="user(s)"
              onSelect={() => onNavigate('matrix')}
              emptyLabel="No effective access computed yet."
              footer={modulesByReach.length > 8 ? `+${modulesByReach.length - 8} more modules` : undefined}
            />
          </ChartCard>
        </div>
      </section>

      {/* ---- People and grants ---- */}
      <section className="space-y-2">
        <SectionLabel icon={Users} title="Worth a look" />
        <div className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
          <ChartCard
            delay={840}
            spotlight="rgba(217, 119, 6, 0.14)"
            icon={Clock}
            iconClassName="text-amber-600"
            title="Access expiring soon"
            description="Temporary grants lapsing within seven days. They expire on their own — no action needed unless somebody still needs them."
            action={<OpenLink label="Temporary" onClick={() => onOpenReport('temporary')} />}
          >
            {expiring.length === 0 ? (
              <EmptyNote>Nothing expiring in the next week.</EmptyNote>
            ) : (
              <div className="space-y-1.5">
                {expiring.map(({ user, entry }) => (
                  <div
                    key={`${user.id}-${entry.id}`}
                    className="flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-amber-100 bg-amber-50/50 px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{user.name || user.email}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {entry.roleName || 'Direct permissions'} · until {formatGrantDate(entry.expiresAt)}
                      </p>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                      <Link href={`/settings/access-management/users/${user.id}`}>
                        View
                        <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>

          <ChartCard
            delay={900}
            spotlight="rgba(79, 70, 229, 0.14)"
            icon={UserCog}
            iconClassName="text-indigo-600"
            title="Widest access"
            description="Not a problem by itself — but the first place to look when reviewing whether access has accumulated beyond what a role needs."
            action={<OpenLink label="Effective access" onClick={() => onNavigate('effective')} />}
          >
            {mostAccess.length === 0 ? (
              <EmptyNote>No effective access computed yet — this fills in once users hold roles or grants.</EmptyNote>
            ) : (
              <div className="space-y-1.5">
                {mostAccess.map(({ user, access }) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => onInspect(user.id)}
                    title="Open in Effective Access"
                    className="flex w-full flex-wrap items-center justify-between gap-1.5 rounded-xl border border-white bg-white/80 px-2.5 py-2 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{user.name || user.email}</p>
                      <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {access?.baseRoleName ?? 'no base role'}
                        {(access?.additionalRoleNames.length ?? 0) > 0 &&
                          ` + ${access?.additionalRoleNames.length} additional`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {access && (
                        <RiskBadges privileges={detectPrivilegedAccess(access)} conflicts={detectSodConflicts(access)} />
                      )}
                      <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700">
                        {access?.permissionCount ?? 0}
                      </Badge>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ChartCard>

          <ChartCard
            delay={960}
            spotlight="rgba(100, 116, 139, 0.14)"
            icon={Activity}
            iconClassName="text-slate-500"
            title="Recent activity"
            description="The latest changes, with who made them. Open one for the exact permissions."
            action={<OpenLink label="Audit history" onClick={() => onNavigate('audit')} />}
          >
            {audit.loading ? (
              <EmptyNote>Loading recent changes…</EmptyNote>
            ) : recentEntries.length === 0 ? (
              <EmptyNote>No access changes in the last {CHANGE_WINDOW_DAYS} days.</EmptyNote>
            ) : (
              <div className="space-y-1">
                {recentEntries.map((entry, index) => {
                  const Icon = activityIcon(entry.action);
                  const removal = REMOVAL_ACTIONS.has(entry.action);
                  return (
                    <button
                      key={entry.id ?? `${entry.targetUserId}-${entry.changedAt}-${index}`}
                      type="button"
                      onClick={() => onNavigate('audit')}
                      className="flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-slate-50/80"
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                          removal ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-800">{describeAuditEntry(entry)}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {formatGrantDate(entry.changedAt)}{' '}
                          {new Date(entry.changedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                          {entry.changedByName}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </ChartCard>
        </div>
      </section>

      {unusedRoles.length > 0 && (
        <SpotlightCard
          spotlightColor="rgba(100, 116, 139, 0.14)"
          style={{ animationDelay: '1020ms', animationFillMode: 'both' }}
          className="animate-am-card-in rounded-lg"
        >
          <AccessCard className="transition-shadow duration-300 hover:shadow-lg">
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Sparkles className="h-4 w-4 text-slate-400" />
                Roles nobody holds
              </CardTitle>
              <CardDescription className="text-xs">
                {unusedRoles.length} role(s) with no holders. Safe to leave — but also safe to disable if
                they were created for a project that has ended.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5 px-4 pb-4">
              {unusedRoles.slice(0, 24).map((role) => (
                <Badge key={role.id} variant="outline" className="text-[10px] text-slate-500">
                  {role.name}
                </Badge>
              ))}
              {unusedRoles.length > 24 && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  +{unusedRoles.length - 24} more
                </Badge>
              )}
            </CardContent>
          </AccessCard>
        </SpotlightCard>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Recent changes — the one thing the Overview fetches for itself
 * ---------------------------------------------------------------------------------------------- */

/**
 * The last month of the audit trail. Re-fetched whenever the directory does (a Refresh), so the
 * chart and the "changes" figure move with the counts around them; the previous render is held at
 * reduced opacity while it loads rather than swapped for a skeleton.
 */
function useRecentAudit(directory: AccessDirectoryState['directory']) {
  const [audit, setAudit] = useState<{ entries: AccessAuditEntry[]; loading: boolean; error: string | null }>({
    entries: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const from = new Date();
    from.setDate(from.getDate() - (CHANGE_WINDOW_DAYS - 1));
    from.setHours(0, 0, 0, 0);
    setAudit((current) => ({ ...current, loading: true }));
    listAccessAuditEntries({ from: from.toISOString(), limit: 1000 })
      .then((entries) => {
        if (!cancelled) setAudit({ entries, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAudit({
            entries: [],
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load recent changes.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [directory]);

  return audit;
}

/** Actions that take access away — the rose series, and the rose icon in the activity list. */
const REMOVAL_ACTIONS = new Set<AccessAuditEntry['action']>([
  'Revoke Access',
  'Revoke Temporary Access',
  'Suspend Access Layer',
  'Disable Role',
  'Deactivate Account',
  'Deactivate Account Temporarily',
]);

function activityIcon(action: AccessAuditEntry['action']): React.ElementType {
  switch (action) {
    case 'Create User':
      return UserPlus;
    case 'Deactivate Account':
    case 'Deactivate Account Temporarily':
      return UserX;
    case 'Reactivate Account':
      return ShieldCheck;
    default:
      return REMOVAL_ACTIONS.has(action) ? ShieldMinus : ShieldPlus;
  }
}

interface DayBucket {
  key: string;
  date: Date;
  granted: number;
  removed: number;
}

const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** One bucket per calendar day (local time), the oldest first, every day present even when empty. */
function bucketByDay(entries: AccessAuditEntry[], days: number): DayBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets: DayBucket[] = [];
  const index = new Map<string, DayBucket>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const bucket = { key: dayKey(date), date, granted: 0, removed: 0 };
    buckets.push(bucket);
    index.set(bucket.key, bucket);
  }
  for (const entry of entries) {
    const at = new Date(entry.changedAt);
    if (Number.isNaN(at.getTime())) continue;
    const bucket = index.get(dayKey(at));
    if (!bucket) continue;
    if (REMOVAL_ACTIONS.has(entry.action)) bucket.removed += 1;
    else bucket.granted += 1;
  }
  return buckets;
}

/* ------------------------------------------------------------------------------------------------
 * Charts
 * ---------------------------------------------------------------------------------------------- */

/** The smallest of 1, 2, 5 × 10ⁿ that is at least `value` — a clean top tick. */
function niceCeiling(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

/** A column with a rounded top and a square base — the data end is rounded, the baseline is not. */
function columnPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height);
  if (r <= 0) return `M${x},${y}h${width}v${height}h${-width}Z`;
  return (
    `M${x},${y + r}` +
    `a${r},${r} 0 0 1 ${r},${-r}` +
    `h${width - 2 * r}` +
    `a${r},${r} 0 0 1 ${r},${r}` +
    `v${height - r}` +
    `h${-width}Z`
  );
}

const shortDay = (date: Date): string =>
  `${date.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()]}`;

/**
 * Changes per day: one column per day, granted (emerald) stacked under removed (rose) with a 2px
 * surface gap between them. Hairline gridlines, a clean top tick, three date labels, and a readout
 * that follows the pointer or the keyboard focus — each day's column is its own hit target, full
 * height, so nobody has to land on a 4px bar.
 */
function ChangesColumnChart({ days, onOpen }: { days: DayBucket[]; onOpen: () => void }) {
  const [active, setActive] = useState<number | null>(null);

  const width = 600;
  const height = 176;
  const pad = { top: 12, right: 6, bottom: 22, left: 28 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const baseline = pad.top + plotHeight;

  const peak = Math.max(0, ...days.map((day) => day.granted + day.removed));
  const ceiling = niceCeiling(peak);
  const ticks = ceiling % 2 === 0 ? [0, ceiling / 2, ceiling] : [0, ceiling];
  const y = (value: number) => baseline - (value / ceiling) * plotHeight;

  const slot = plotWidth / Math.max(1, days.length);
  const barWidth = Math.min(24, Math.max(3, slot - 3));
  const labelIndexes = [0, Math.floor(days.length / 2), days.length - 1];
  const activeDay = active !== null ? days[active] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-44 w-full"
        role="img"
        aria-label={`Access changes per day over the last ${days.length} days`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-slate-200"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">
              {tick}
            </text>
          </g>
        ))}

        {days.map((day, index) => {
          const x = pad.left + index * slot + (slot - barWidth) / 2;
          const grantedHeight = (day.granted / ceiling) * plotHeight;
          const removedHeight = (day.removed / ceiling) * plotHeight;
          const gap = day.granted && day.removed ? 2 : 0;
          const dimmed = active !== null && active !== index;
          return (
            <g key={day.key} className="transition-opacity" opacity={dimmed ? 0.45 : 1}>
              {day.granted > 0 && (
                <path
                  d={columnPath(x, baseline - grantedHeight, barWidth, grantedHeight, day.removed ? 0 : 4)}
                  className="fill-emerald-600"
                />
              )}
              {day.removed > 0 && (
                <path
                  d={columnPath(x, baseline - grantedHeight - gap - removedHeight, barWidth, removedHeight, 4)}
                  className="fill-rose-500"
                />
              )}
              <rect
                x={pad.left + index * slot}
                y={pad.top}
                width={slot}
                height={plotHeight}
                fill="transparent"
                tabIndex={0}
                aria-label={`${formatGrantDate(day.date.toISOString())}: ${day.granted} granted, ${day.removed} removed`}
                className="cursor-pointer outline-none"
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                onClick={onOpen}
              />
            </g>
          );
        })}

        {labelIndexes.map((index) =>
          days[index] ? (
            <text
              key={index}
              x={pad.left + index * slot + slot / 2}
              y={height - 6}
              textAnchor={index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'}
              className="fill-slate-400 text-[10px]"
            >
              {shortDay(days[index].date)}
            </text>
          ) : null,
        )}
      </svg>

      {activeDay && active !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `clamp(4rem, ${((pad.left + active * slot + slot / 2) / width) * 100}%, calc(100% - 4rem))` }}
        >
          <p className="font-semibold text-slate-800">{formatGrantDate(activeDay.date.toISOString())}</p>
          <p className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
            <span className="inline-block h-0.5 w-3 rounded bg-emerald-600" />
            <span className="font-semibold tabular-nums text-slate-800">{activeDay.granted}</span>
            <span className="text-muted-foreground">granted</span>
          </p>
          <p className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="inline-block h-0.5 w-3 rounded bg-rose-500" />
            <span className="font-semibold tabular-nums text-slate-800">{activeDay.removed}</span>
            <span className="text-muted-foreground">removed</span>
          </p>
        </div>
      )}

      {/* Two series, so a legend — rect keys, mirroring the marks. */}
      <div className="mt-1 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
          Granted
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
          Removed
        </span>
      </div>
    </div>
  );
}

/**
 * A ranked bar list — one hue, because these are nominal categories and the length already says
 * the magnitude. Thin bars, square at the baseline, rounded at the data end, the value at the tip.
 */
function RankedBars({
  rows,
  unit,
  onSelect,
  emptyLabel,
  footer,
}: {
  rows: Array<{ id: string; label: string; value: number }>;
  unit: string;
  onSelect?: () => void;
  emptyLabel: string;
  footer?: string;
}) {
  // Bars grow in from the baseline on first paint — a small thing, but it is what makes a dashboard
  // feel like it is showing you something rather than printing it.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!rows.length) return <EmptyNote>{emptyLabel}</EmptyNote>;
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <div>
      <ol className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={onSelect}
              title={`${row.label}: ${row.value} ${unit}`}
              className="group flex w-full items-center gap-2.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-slate-50/80"
            >
              <span className="w-28 shrink-0 truncate text-xs text-slate-700 sm:w-36">{row.label}</span>
              <span className="relative h-2.5 flex-1 overflow-hidden rounded-r-[4px] bg-slate-100">
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] bg-indigo-500 transition-[width] duration-700 ease-out group-hover:bg-indigo-600"
                  style={{ width: ready ? `${(row.value / max) * 100}%` : '0%' }}
                />
              </span>
              <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">{row.value}</span>
            </button>
          </li>
        ))}
      </ol>
      {footer && <p className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</p>}
    </div>
  );
}

/** The headline's ring: the healthy share as an arc, drawn in from zero on mount. */
function RingGauge({ percent }: { percent: number }) {
  const size = 104;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const filled = ready ? (Math.max(0, Math.min(100, percent)) / 100) * circumference : 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={`${percent}% of active users have clean access`}
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="white"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference - filled}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 900ms ease-out' }}
      />
      <ShieldCheck
        x={size / 2 - 11}
        y={size / 2 - 11}
        width={22}
        height={22}
        className="text-white"
        aria-hidden
      />
    </svg>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Small presentational pieces
 * ---------------------------------------------------------------------------------------------- */

function HeroStat({ label, value, hint, dim }: { label: string; value: number; hint?: string; dim?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15 backdrop-blur-sm transition-opacity',
        dim && 'opacity-60',
      )}
    >
      <dt className="text-[10px] font-medium uppercase tracking-wide text-white/70">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold leading-tight">
        <CountUp value={value} />
      </dd>
      {hint && <dd className="text-[11px] text-white/70">{hint}</dd>}
    </div>
  );
}

function SectionLabel({ icon: Icon, title, hint }: { icon: React.ElementType; title: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function OpenLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs text-indigo-700" onClick={onClick}>
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </Button>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-xs text-muted-foreground">{children}</p>;
}

/** A card with a titled header, an "open" link on the right, and a body that fills the rest. */
function ChartCard({
  icon: Icon,
  iconClassName,
  title,
  description,
  action,
  children,
  delay,
  spotlight,
}: {
  icon: React.ElementType;
  iconClassName?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  delay: number;
  spotlight: string;
}) {
  return (
    <SpotlightCard
      spotlightColor={spotlight}
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
      className="animate-am-card-in rounded-lg"
    >
      <AccessCard className="flex h-full flex-col transition-shadow duration-300 hover:shadow-lg">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 px-4 py-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Icon className={cn('h-4 w-4', iconClassName)} />
              {title}
            </CardTitle>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
          {action}
        </CardHeader>
        <CardContent className="flex-1 px-4 pb-4">{children}</CardContent>
      </AccessCard>
    </SpotlightCard>
  );
}

interface Finding {
  id: string;
  tone: 'rose' | 'amber' | 'slate';
  icon: React.ElementType;
  title: string;
  description: string;
  actionLabel: string;
  /** An in-page action — switch tabs, open the assignment workspace. */
  onAction?: () => void;
  /** A route instead, for the findings whose fix lives on another screen. */
  actionHref?: string;
}

const FINDING_TONES = {
  rose: { shell: 'border-rose-200 bg-rose-50/70', icon: 'bg-rose-100 text-rose-700', title: 'text-rose-900', body: 'text-rose-800' },
  amber: { shell: 'border-amber-200 bg-amber-50/70', icon: 'bg-amber-100 text-amber-700', title: 'text-amber-900', body: 'text-amber-800' },
  slate: { shell: 'border-slate-200 bg-white/80', icon: 'bg-slate-100 text-slate-600', title: 'text-slate-800', body: 'text-slate-600' },
} as const;

function AlertCard({ finding, delay }: { finding: Finding; delay: number }) {
  const tone = FINDING_TONES[finding.tone];
  const Icon = finding.icon;
  return (
    <div
      className={cn('animate-am-card-in flex flex-wrap items-start justify-between gap-2 rounded-xl border px-3 py-2.5', tone.shell)}
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <div className="flex min-w-0 gap-2.5">
        <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', tone.icon)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className={cn('text-sm font-semibold', tone.title)}>{finding.title}</p>
          <p className={cn('text-xs', tone.body)}>{finding.description}</p>
        </div>
      </div>
      {finding.actionHref ? (
        <Button asChild variant="outline" size="sm" className="h-7 shrink-0 bg-white/80 text-xs">
          <Link href={finding.actionHref}>{finding.actionLabel}</Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="h-7 shrink-0 bg-white/80 text-xs" onClick={finding.onAction}>
          {finding.actionLabel}
        </Button>
      )}
    </div>
  );
}
