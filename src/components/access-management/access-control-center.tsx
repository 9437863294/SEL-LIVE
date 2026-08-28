'use client';

/**
 * The Access Control Center — the page shell, the Overview dashboard (§37) and the Users tab (§12).
 *
 * Ten tabs over one loaded directory (`useAccessDirectory`), so switching between Permission Matrix
 * and Audit History costs a render rather than five collection reads. The Assign Access tab is the
 * one everything else feeds into: the role library's "Assign", the template's "Apply to users" and a
 * user profile's "Add access" all hand their selection to it and switch to it.
 *
 * ── Who can open this ───────────────────────────────────────────────────────────────────────────
 *
 * `canOpenAccessManagement` accepts either the new `Settings.Access Management · View` permission or
 * the User Management + Role Management pair that existing administrators already hold. On the day
 * this ships nobody has the new permission — it did not exist when the roles were written — so
 * without the fallback the screen that grants it would itself be unreachable.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  Clock,
  Grid3x3,
  History,
  KeyRound,
  Layers,
  LayoutDashboard,
  Link2,
  RefreshCw,
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  HrAccessDenied,
  HrDataList,
  HrEmptyState,
  HrLoader,
  HrPageHeader,
  type HrListColumn,
} from '@/components/hr/hr-ui';
import { SpotlightCard } from '@/components/effects/SpotlightCard';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAccessDirectory } from '@/hooks/useAccessDirectory';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  countPermissions,
  detectPrivilegedAccess,
  detectSodConflicts,
  expiringTemporaryGrants,
  registryPermissionCount,
} from '@/lib/access-control';
import {
  actorFromUser,
  canAssignAccess,
  canManageRoles,
  canOpenAccessManagement,
  canRevokeAccess,
  revokeAccess,
} from '@/lib/access-control-service';
import { AssignAccess } from './assign-access';
import { RemovalPreviewDialog } from './assignment-preview';
import { RemoveAccessDialog, type RemoveAccessSelection } from './remove-access';
import { RoleLibrary } from './role-library';
import { EffectiveAccessViewer } from './effective-access';
import { PermissionMatrixView } from './permission-matrix';
import { AuditHistory } from './audit-history';
import { TemplatesAndScopes } from './templates-and-scopes';
import { AccessReports, type ReportId } from './access-reports';
import { PermissionTree } from './permission-tree';
import {
  EMPTY_USER_FILTER,
  UserFilterBar,
  employeeForUser,
  filterUsers,
  type UserDirectoryContext,
  type UserFilterState,
} from './pickers';
import { AccessCard, AccessKpiCard, AccessPageShell, RiskBadges, RoleBadge } from './access-ui';

type TabId =
  | 'overview'
  | 'users'
  | 'roles'
  | 'permissions'
  | 'assign'
  | 'matrix'
  | 'effective'
  | 'templates'
  | 'reports'
  | 'audit';

export function AccessControlCenter() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();

  const allowed = useMemo(() => canOpenAccessManagement(can), [can]);
  const state = useAccessDirectory(!authLoading && allowed);

  const [tab, setTab] = useState<TabId>('overview');
  /**
   * What the Assign Access tab should open with.
   *
   * Bumping `key` remounts the workspace so it picks the seed up; without that a second handover
   * (assign role A, then role B) would leave the first selection in place, because the seed is an
   * initial value rather than a controlled one.
   */
  const [assignSeed, setAssignSeed] = useState<{
    key: number;
    userIds: string[];
    roleIds: string[];
    templateIds: string[];
  }>({ key: 0, userIds: [], roleIds: [], templateIds: [] });

  /** Same remount idiom for the two other tabs the Overview deep-links into. */
  const [reportSeed, setReportSeed] = useState<{ key: number; report?: ReportId }>({ key: 0 });
  const [effectiveSeed, setEffectiveSeed] = useState<{ key: number; userId?: string }>({ key: 0 });

  const actor = useMemo(() => actorFromUser(user), [user]);

  /**
   * Two deep links, read once on mount rather than kept in sync — the tabs are a working surface
   * after that, and re-seeding either on every render would fight whatever the administrator has
   * since selected.
   *
   *   `?assignTo=<userId>` opens Assign Access with that user already selected — used by the user
   *   profile's "Add access" button.
   *
   *   `?assignRole=<roleId>` opens Assign Access with that role already selected — used by the Role
   *   Builder (now its own page under `/roles/new` and `/roles/[roleId]`) after *creating* a role.
   *   The dialog it replaced handed a new role straight to the assignment step in-process; a separate
   *   page cannot call back into this component, so it says the same thing in the URL instead. Only on
   *   create: saving an existing role changes nothing about who holds it.
   *
   *   `?tab=<TabId>` opens any tab directly — used by the template editor (now its own page under
   *   `/templates/new` and `/templates/[templateId]`) to land back on Templates after Save or Cancel,
   *   rather than always returning to Overview.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const search = new URLSearchParams(window.location.search);

    const assignTo = search.get('assignTo');
    if (assignTo) {
      setAssignSeed((current) => ({ ...current, key: current.key + 1, userIds: [assignTo] }));
      setTab('assign');
      return;
    }

    const assignRole = search.get('assignRole');
    if (assignRole) {
      setAssignSeed((current) => ({ ...current, key: current.key + 1, roleIds: [assignRole] }));
      setTab('assign');
      return;
    }

    const requestedTab = search.get('tab') as TabId | null;
    const validTabs: TabId[] = [
      'overview', 'users', 'roles', 'permissions', 'assign', 'matrix', 'effective', 'templates', 'reports', 'audit',
    ];
    if (requestedTab && validTabs.includes(requestedTab)) setTab(requestedTab);
  }, []);

  /** Hand a selection to the Assign Access tab and switch to it. */
  const openAssignWith = useCallback(
    (seed: { userIds?: string[]; roleIds?: string[]; templateIds?: string[] }) => {
      setAssignSeed((current) => ({
        key: current.key + 1,
        userIds: seed.userIds ?? [],
        roleIds: seed.roleIds ?? [],
        templateIds: seed.templateIds ?? [],
      }));
      setTab('assign');
    },
    [],
  );

  /** Open the Reports tab on a specific report — the Overview's alerts land on the finding, not the default. */
  const openReportWith = useCallback((report: ReportId) => {
    setReportSeed((current) => ({ key: current.key + 1, report }));
    setTab('reports');
  }, []);

  /** Open Effective Access with a user already selected. */
  const openEffectiveWith = useCallback((userId: string) => {
    setEffectiveSeed((current) => ({ key: current.key + 1, userId }));
    setTab('effective');
  }, []);

  if (authLoading || (state.isLoading && !state.isRefreshing && allowed)) {
    return (
      <AccessPageShell>
        <HrLoader label="Loading users, roles and grants…" />
      </AccessPageShell>
    );
  }

  if (!allowed) {
    return (
      <AccessPageShell
        backHref="/settings"
        backLabel="Back to settings"
        aside={<h1 className="text-xl font-semibold text-slate-800">Access Management</h1>}
      >
        <HrAccessDenied what="access management" />
      </AccessPageShell>
    );
  }

  if (!actor) {
    return (
      <AccessPageShell backHref="/settings" backLabel="Back to settings">
        <HrAccessDenied what="access management" />
      </AccessPageShell>
    );
  }

  const canAssign = canAssignAccess(can);
  const canRevoke = canRevokeAccess(can);
  const canRoles = canManageRoles(can);

  return (
    <AccessPageShell
      backHref="/settings"
      backLabel="Back to settings"
      aside={
        <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
          <ShieldCheck className="h-3 w-3" />
          Additive only — existing permissions are never replaced
        </Badge>
      }
    >
      <HrPageHeader
        title="Access Control Center"
        description="Users, roles, permissions, departments, designations, projects, reports and approval rights — from one screen."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void state.refresh()} disabled={state.isRefreshing}>
              <RefreshCw className={cn('mr-1.5 h-4 w-4', state.isRefreshing && 'animate-spin')} />
              {state.isRefreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            {canAssign && (
              <Button size="sm" onClick={() => openAssignWith({})}>
                <ShieldPlus className="mr-1.5 h-4 w-4" />
                Assign access
              </Button>
            )}
          </>
        }
      />

      {state.error && (
        <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
        <ScrollArea className="w-full pb-1" showHorizontalScrollbar>
          <TabsList className="inline-flex w-max">
            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
            <TabsTrigger value="users" className="text-xs">Users</TabsTrigger>
            <TabsTrigger value="roles" className="text-xs">Roles</TabsTrigger>
            <TabsTrigger value="permissions" className="text-xs">Permissions</TabsTrigger>
            <TabsTrigger value="assign" className="text-xs">Assign Access</TabsTrigger>
            <TabsTrigger value="matrix" className="text-xs">Permission Matrix</TabsTrigger>
            <TabsTrigger value="effective" className="text-xs">Effective Access</TabsTrigger>
            <TabsTrigger value="templates" className="text-xs">Templates &amp; Rules</TabsTrigger>
            <TabsTrigger value="reports" className="text-xs">Reports</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs">Audit History</TabsTrigger>
          </TabsList>
        </ScrollArea>

        <TabsContent value="overview" className="mt-3">
          <AccessOverview
            state={state}
            onNavigate={setTab}
            onAssign={openAssignWith}
            onOpenReport={openReportWith}
            onInspect={openEffectiveWith}
          />
        </TabsContent>

        <TabsContent value="users" className="mt-3">
          <UsersTab
            state={state}
            actor={actor}
            canAssign={canAssign}
            canRevoke={canRevoke}
            onAssign={openAssignWith}
          />
        </TabsContent>

        <TabsContent value="roles" className="mt-3">
          <RoleLibrary
            state={state}
            actor={actor}
            canManage={canRoles}
            onAssignRole={(roleId) => openAssignWith({ roleIds: [roleId] })}
          />
        </TabsContent>

        <TabsContent value="permissions" className="mt-3">
          <PermissionRegistryTab state={state} />
        </TabsContent>

        <TabsContent value="assign" className="mt-3">
          <AssignAccess
            key={assignSeed.key}
            state={state}
            actor={actor}
            canAssign={canAssign}
            initialUserIds={assignSeed.userIds}
            initialRoleIds={assignSeed.roleIds}
            initialTemplateIds={assignSeed.templateIds}
          />
        </TabsContent>

        <TabsContent value="matrix" className="mt-3">
          <PermissionMatrixView state={state} />
        </TabsContent>

        <TabsContent value="effective" className="mt-3">
          <EffectiveAccessViewer key={effectiveSeed.key} state={state} initialUserId={effectiveSeed.userId} />
        </TabsContent>

        <TabsContent value="templates" className="mt-3">
          <TemplatesAndScopes
            state={state}
            actor={actor}
            canManage={canRoles}
            onApplyTemplate={(templateId) => openAssignWith({ templateIds: [templateId] })}
          />
        </TabsContent>

        <TabsContent value="reports" className="mt-3">
          <AccessReports key={reportSeed.key} state={state} initialReport={reportSeed.report} />
        </TabsContent>

        <TabsContent value="audit" className="mt-3">
          <AuditHistory state={state} />
        </TabsContent>
      </Tabs>
    </AccessPageShell>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Overview dashboard (§37)
 * ---------------------------------------------------------------------------------------------- */

function AccessOverview({
  state,
  onNavigate,
  onAssign,
  onOpenReport,
  onInspect,
}: {
  state: ReturnType<typeof useAccessDirectory>;
  onNavigate: (tab: TabId) => void;
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

  return (
    <div className="space-y-3">
      {/* Every KPI opens the tab (or report) that explains its number — a count you cannot act on is trivia. */}
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

      {(dashboard.inactiveUsersHoldingAccess > 0 ||
        usersWithoutRoles.length > 0 ||
        unlinkedActiveUsers.length > 0) && (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {dashboard.inactiveUsersHoldingAccess > 0 && (
            <AlertCard
              tone="amber"
              icon={UserX}
              title={`${dashboard.inactiveUsersHoldingAccess} inactive user(s) still hold permissions`}
              description="They cannot sign in, but reactivating the account restores everything. Worth reviewing for anybody who has left permanently."
              actionLabel="Open the report"
              onAction={() => onOpenReport('inactive')}
            />
          )}
          {usersWithoutRoles.length > 0 && (
            <AlertCard
              tone="rose"
              icon={ShieldAlert}
              title={`${usersWithoutRoles.length} user(s) have no role at all`}
              description={`${usersWithoutRoles
                .slice(0, 4)
                .map((user) => user.name || user.email)
                .join(', ')}${usersWithoutRoles.length > 4 ? `, +${usersWithoutRoles.length - 4} more` : ''}. They can sign in but see nothing.`}
              actionLabel="Assign access"
              onAction={() => onAssign({ userIds: usersWithoutRoles.map((user) => user.id) })}
            />
          )}
          {unlinkedActiveUsers.length > 0 && (
            <AlertCard
              tone="amber"
              icon={Link2}
              title={`${unlinkedActiveUsers.length} active login(s) are not linked to a greytHR employee`}
              description="Department, designation and joining date come from greytHR. Until a login is linked, its profile data has to be maintained by hand — and the linking console proposes the confident matches for you."
              actionLabel="Open greytHR linking"
              actionHref="/settings/user-management/greythr-linking"
            />
          )}
        </div>
      )}

      <div className="grid gap-2.5 lg:grid-cols-2">
        {/* Expiring temporary access */}
        <SpotlightCard
          spotlightColor="rgba(217, 119, 6, 0.14)"
          style={{ animationDelay: '480ms', animationFillMode: 'both' }}
          className="animate-am-card-in rounded-lg"
        >
          <AccessCard className="h-full transition-shadow duration-300 hover:shadow-lg">
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Clock className="h-4 w-4 text-amber-600" />
                Access expiring soon
              </CardTitle>
              <CardDescription className="text-xs">
                Temporary grants lapsing within seven days. They expire on their own — no action needed
                unless somebody still needs them.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 px-4 pb-4">
              {expiring.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing expiring in the next week.</p>
              ) : (
                expiring.map(({ user, entry }) => (
                  <div
                    key={`${user.id}-${entry.id}`}
                    className="flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-amber-100 bg-amber-50/50 px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{user.name || user.email}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {entry.roleName || 'Direct permissions'} · until {entry.expiresAt.slice(0, 10)}
                      </p>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                      <Link href={`/settings/access-management/users/${user.id}`}>
                        View
                        <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </AccessCard>
        </SpotlightCard>

        {/* Users with the most access */}
        <SpotlightCard
          spotlightColor="rgba(79, 70, 229, 0.14)"
          style={{ animationDelay: '540ms', animationFillMode: 'both' }}
          className="animate-am-card-in rounded-lg"
        >
          <AccessCard className="h-full transition-shadow duration-300 hover:shadow-lg">
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <UserCog className="h-4 w-4 text-indigo-600" />
                Widest access
              </CardTitle>
              <CardDescription className="text-xs">
                Not a problem by itself — but the first place to look when reviewing whether access has
                accumulated beyond what a role needs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 px-4 pb-4">
              {mostAccess.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No effective access computed yet — this fills in once users hold roles or grants.
                </p>
              ) : (
                mostAccess.map(({ user, access }) => (
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
                        <RiskBadges
                          privileges={detectPrivilegedAccess(access)}
                          conflicts={detectSodConflicts(access)}
                        />
                      )}
                      <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700">
                        {access?.permissionCount ?? 0}
                      </Badge>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </AccessCard>
        </SpotlightCard>
      </div>

      {unusedRoles.length > 0 && (
        <SpotlightCard
          spotlightColor="rgba(100, 116, 139, 0.14)"
          style={{ animationDelay: '600ms', animationFillMode: 'both' }}
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

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <QuickLink index={0} icon={ShieldPlus} label="Assign access" hint="Roles, permissions, projects" onClick={() => onNavigate('assign')} />
        <QuickLink index={1} icon={Grid3x3} label="Permission matrix" hint="Compare coverage" onClick={() => onNavigate('matrix')} />
        <QuickLink index={2} icon={LayoutDashboard} label="Effective access" hint="What one person can do" onClick={() => onNavigate('effective')} />
        <QuickLink index={3} icon={History} label="Audit history" hint="Every change, with reasons" onClick={() => onNavigate('audit')} />
        {/*
          greytHR linking is a route rather than a tab (it is reached from User Management too), and
          before this it had no entry point on this screen at all — the only way in was a button
          inside one user's profile card, which made the module's most automated screen its least
          reachable one.
        */}
        <QuickLink
          index={4}
          icon={Link2}
          label="greytHR linking"
          hint="Match logins to employee records"
          href="/settings/user-management/greythr-linking"
        />
      </div>
    </div>
  );
}

function AlertCard({
  tone,
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
}: {
  tone: 'amber' | 'rose';
  icon: React.ElementType;
  title: string;
  description: string;
  actionLabel: string;
  /** An in-page action — switch tabs, open the assignment workspace. */
  onAction?: () => void;
  /** A route instead, for the findings whose fix lives on another screen. */
  actionHref?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-2 rounded-xl border px-3 py-2.5',
        tone === 'amber' ? 'border-amber-200 bg-amber-50/70' : 'border-rose-200 bg-rose-50/70',
      )}
    >
      <div className="flex min-w-0 gap-2">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'amber' ? 'text-amber-700' : 'text-rose-700')} />
        <div className="min-w-0">
          <p className={cn('text-sm font-semibold', tone === 'amber' ? 'text-amber-900' : 'text-rose-900')}>{title}</p>
          <p className={cn('text-xs', tone === 'amber' ? 'text-amber-800' : 'text-rose-800')}>{description}</p>
        </div>
      </div>
      {actionHref ? (
        <Button asChild variant="outline" size="sm" className="h-7 shrink-0 bg-white/80 text-xs">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="h-7 shrink-0 bg-white/80 text-xs" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

function QuickLink({
  icon: Icon,
  label,
  hint,
  onClick,
  href,
  index = 0,
}: {
  icon: React.ElementType;
  label: string;
  hint: string;
  /** A tab on this screen. */
  onClick?: () => void;
  /** A route, for the one quick link that leaves this screen. */
  href?: string;
  /** Position in the row — staggers the entrance so the tiles don't pop in all at once. */
  index?: number;
}) {
  const shell = cn(
    'group flex items-center gap-2.5 rounded-xl border border-white/70 bg-white/80 px-3 py-2.5 text-left shadow-sm',
    'animate-am-card-in transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md',
  );
  const style = { animationDelay: `${660 + index * 60}ms`, animationFillMode: 'both' } as const;
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 ring-4 ring-indigo-50/50 transition-transform duration-300 group-hover:scale-110">
        <Icon className="h-4 w-4 text-indigo-600" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-800">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={shell} style={style}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={shell} style={style}>
      {body}
    </button>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Users tab (§12, §29)
 * ---------------------------------------------------------------------------------------------- */

function UsersTab({
  state,
  actor,
  canAssign,
  canRevoke,
  onAssign,
}: {
  state: ReturnType<typeof useAccessDirectory>;
  actor: NonNullable<ReturnType<typeof actorFromUser>>;
  canAssign: boolean;
  canRevoke: boolean;
  onAssign: (seed: { userIds?: string[]; roleIds?: string[]; templateIds?: string[] }) => void;
}) {
  const { toast } = useToast();
  const { directory, accessByUser, departments, projects, designations, employees } = state;
  const [filter, setFilter] = useState<UserFilterState>({ ...EMPTY_USER_FILTER, status: 'all' });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removalSelection, setRemovalSelection] = useState<RemoveAccessSelection | null>(null);

  const context: UserDirectoryContext = useMemo(
    () => ({
      users: directory.users,
      roles: directory.roles,
      grants: directory.grants,
      accessByUser,
      departments,
      projects,
      designations,
      employees,
    }),
    [directory, accessByUser, departments, projects, designations, employees],
  );

  const filtered = useMemo(() => filterUsers(context, filter), [context, filter]);

  /**
   * Who a removal applies to: the ticked users, or everyone matching the filter if none are ticked.
   *
   * Same rule the assign button uses, so the two read consistently. Deliberately *not* "all users" —
   * a destructive default of the entire directory is the wrong shape of mistake to make easy.
   */
  const targets = useMemo(
    () => (selectedIds.length ? filtered.filter((user) => selectedIds.includes(user.id)) : filtered),
    [filtered, selectedIds],
  );

  const rows = useMemo(
    () =>
      filtered.map((user) => {
        const access = accessByUser[user.id];
        const grant = directory.grants[user.id];
        const employee = employeeForUser(user, employees);
        return { id: user.id, user, access, grant, employee };
      }),
    [filtered, accessByUser, directory.grants, employees],
  );

  const columns: Array<HrListColumn<(typeof rows)[number]>> = [
    {
      header: 'User',
      mobile: 'title',
      cell: (row) => (
        <Link href={`/settings/access-management/users/${row.id}`} className="font-medium text-slate-800 hover:underline">
          {row.user.name || row.user.email}
        </Link>
      ),
    },
    {
      header: 'Employee / contact',
      mobile: 'detail',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {[row.employee?.employeeId, row.user.email].filter(Boolean).join(' · ')}
        </span>
      ),
    },
    {
      header: 'Department · designation',
      className: 'hidden lg:table-cell',
      mobile: 'detail',
      cell: (row) => [row.employee?.department, row.employee?.designation].filter(Boolean).join(' · ') || '—',
    },
    {
      header: 'Roles',
      mobile: 'detail',
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.user.role && <RoleBadge name={row.user.role} kind="base" />}
          {(row.grant?.additionalRoles ?? []).slice(0, 2).map((assignment) => (
            <RoleBadge key={assignment.roleId} name={assignment.roleName} kind="additional" />
          ))}
          {(row.grant?.additionalRoles?.length ?? 0) > 2 && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              +{(row.grant?.additionalRoles?.length ?? 0) - 2}
            </Badge>
          )}
          {(row.access?.temporaryActive.length ?? 0) > 0 && (
            <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-[10px] text-amber-800">
              <CalendarClock className="h-3 w-3" />
              {row.access?.temporaryActive.length}
            </Badge>
          )}
        </span>
      ),
    },
    {
      header: 'Permissions',
      align: 'right',
      mobile: 'aside',
      cell: (row) => (
        <span className="text-sm font-medium text-slate-700">{countPermissions(row.access?.permissions)}</span>
      ),
    },
    {
      header: 'Risk',
      mobile: 'detail',
      cell: (row) =>
        row.access ? (
          <RiskBadges privileges={detectPrivilegedAccess(row.access)} conflicts={detectSodConflicts(row.access)} />
        ) : null,
    },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (row) => (
        <Badge
          variant="outline"
          className={
            row.user.status === 'Inactive'
              ? 'border-slate-300 bg-slate-100 text-slate-600'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }
        >
          {row.user.status ?? 'Active'}
        </Badge>
      ),
    },
    {
      header: 'Actions',
      align: 'right',
      mobile: 'footer',
      cell: (row) => (
        <Button asChild variant="outline" size="sm" className="h-8 text-xs">
          <Link href={`/settings/access-management/users/${row.id}`}>Access profile</Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <AccessCard>
        <CardContent className="space-y-2.5 p-3">
          <UserFilterBar filter={filter} onChange={setFilter} context={context} registry={state.registry} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {filtered.length} of {directory.users.length} users
              </span>
              {selectedIds.length > 0 && (
                <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                  {selectedIds.length} selected
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {canAssign && (
                // A link, not a dialog trigger: the form is its own page now, and it comes back here
                // with the new user preselected via `assignTo`.
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/access-management/users/new?returnTo=%2Fsettings%2Faccess-management">
                    <UserPlus className="mr-1.5 h-4 w-4" />
                    Add user
                  </Link>
                </Button>
              )}
              {/*
                Revocation sits beside assignment deliberately.

                Granting was bulk and prominent; removing was single-user and reachable only from a
                profile page — so a permission given to forty people could only be taken back forty
                times. An operation whose inverse is forty times harder to find is an operation
                administrators avoid, which is worse for access hygiene than the button being here.
              */}
              {canRevoke && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/30 text-destructive hover:bg-destructive/5"
                  disabled={!targets.length}
                  onClick={() => setRemoveOpen(true)}
                >
                  <ShieldMinus className="mr-1.5 h-4 w-4" />
                  Remove access from {targets.length}
                </Button>
              )}
              {canAssign && (
                <Button
                  size="sm"
                  disabled={!filtered.length}
                  onClick={() => onAssign({ userIds: filtered.map((user) => user.id) })}
                >
                  <ShieldPlus className="mr-1.5 h-4 w-4" />
                  Assign access to {filtered.length} filtered
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </AccessCard>

      {rows.length === 0 ? (
        <HrEmptyState icon={Users} title="No users match these filters" description="Try widening the search." />
      ) : (
        <ScrollArea className="h-[30rem]">
          <HrDataList
            rows={rows.slice(0, 250)}
            columns={columns}
            cardHref={(row) => `/settings/access-management/users/${row.id}`}
          />
          {rows.length > 250 && (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Showing the first 250 of {rows.length}. Narrow the filter to see the rest — bulk actions
              still apply to all {rows.length}.
            </p>
          )}
        </ScrollArea>
      )}

      {/* Step 1: what to remove. */}
      <RemoveAccessDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        users={targets}
        grants={directory.grants}
        projectName={(id) => projects.find((project) => project.id === id)?.projectName ?? id}
        onContinue={setRemovalSelection}
      />

      {/* Step 2: what it costs, and the confirmation. The same dialog the profile uses. */}
      <RemovalPreviewDialog
        open={!!removalSelection}
        onOpenChange={(open) => !open && setRemovalSelection(null)}
        users={targets}
        roleIdsToRemove={removalSelection?.roleIds ?? []}
        projectIdsToRemove={removalSelection?.projectIds ?? []}
        directPermissionsToRemove={removalSelection?.directPermissions}
        roles={directory.roles}
        grants={directory.grants}
        scopeGrants={directory.scopeGrants}
        onConfirm={async (reason) => {
          if (!removalSelection) return;
          await revokeAccess({
            users: targets,
            request: {
              roleIds: removalSelection.roleIds,
              projectIds: removalSelection.projectIds,
              directPermissions: removalSelection.directPermissions,
            },
            directory,
            actor,
            reason,
            label: `Remove additional access from ${targets.length} user(s)`,
          });
          setRemovalSelection(null);
          await state.refresh();
          toast({
            title: 'Access removed',
            description: `${targets.length} user(s) updated. Base roles untouched, and anything another source still grants is retained.`,
          });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Permissions registry tab (§32)
 * ---------------------------------------------------------------------------------------------- */

/**
 * The application's own resource registry, browsable.
 *
 * Read-only, and that is the point: the registry is derived from `permissionModules` in code, so a
 * module that adds a page gets it here on deploy with nothing to configure (§41). An editable copy
 * in the database would be a second source of truth that drifts from what the code actually
 * enforces — and a permission that appears in the UI but gates nothing is worse than one that is
 * missing.
 */
function PermissionRegistryTab({ state }: { state: ReturnType<typeof useAccessDirectory> }) {
  const { registry } = state;
  const [selection, setSelection] = useState<Record<string, string[]>>({});

  const moduleCount = useMemo(() => new Set(registry.map((node) => node.module)).size, [registry]);
  const total = useMemo(() => registryPermissionCount(registry), [registry]);

  return (
    <div className="space-y-3">
      <AccessCard>
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-sm">Module, page &amp; action registry</CardTitle>
          <CardDescription className="text-xs">
            {moduleCount} modules · {registry.length} pages · {total} grantable permissions. Derived from
            the application itself, so a new module appears here as soon as it ships — there is nothing
            to register by hand.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="mb-2.5 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-900">
            Browse and search the whole registry below. Ticking boxes here is a scratchpad for working
            out a permission set — nothing is saved. Use <span className="font-semibold">Roles</span> to
            build a role or <span className="font-semibold">Assign Access</span> to grant permissions
            directly.
          </div>
          <PermissionTree
            registry={registry}
            value={selection}
            onChange={setSelection}
            heightClassName="h-[28rem]"
          />
        </CardContent>
      </AccessCard>
    </div>
  );
}
