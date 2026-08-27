'use client';

/**
 * The Effective Access viewer (§9), the "why does this user have this?" explainer (§44) and the
 * access simulator (§45).
 *
 * These are one screen because they answer one question from three angles: *what* can this person
 * do, *why* can they do it, and *what will they actually see* when they log in. An administrator
 * troubleshooting an access complaint moves between all three in the same minute.
 *
 * ── The simulation is a projection, not an impersonation ────────────────────────────────────────
 *
 * §45 is explicit that previewing somebody's access must not alter audit ownership. This computes
 * their effective permissions and evaluates the navigation against them — it never signs anybody in
 * as anybody. The existing impersonation feature in User Management is the other thing, and remains
 * the other thing.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Eye,
  FolderKanban,
  HelpCircle,
  Layers,
  Search,
  ShieldCheck,
  UserSearch,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HrEmptyState, HrField } from '@/components/hr/hr-ui';
import { cn } from '@/lib/utils';
import type { User } from '@/lib/types';
import {
  canAccessModule,
  countPermissions,
  detectPrivilegedAccess,
  detectSodConflicts,
  explainPermission,
  formatGrantDate,
  searchRegistry,
  temporaryGrantState,
  type EffectiveAccess,
  type RegistryNode,
} from '@/lib/access-control';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import { AccessCard, PermissionPair, RiskBadges, RoleBadge, SourceBadges, StatLine } from './access-ui';

export function EffectiveAccessViewer({
  state,
  initialUserId,
}: {
  state: AccessDirectoryState;
  initialUserId?: string;
}) {
  const { directory, accessByUser, departments, projects, registry } = state;
  const [userId, setUserId] = useState(initialUserId ?? '');
  const [term, setTerm] = useState('');

  const user = directory.users.find((entry) => entry.id === userId);
  const access = userId ? accessByUser[userId] : undefined;

  return (
    <div className="space-y-3">
      <AccessCard>
        <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
          <Label className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Inspect
          </Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select a user to see exactly what they can access" />
            </SelectTrigger>
            <SelectContent>
              {directory.users
                .slice()
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name || entry.email}
                    {entry.role ? ` · ${entry.role}` : ''}
                    {entry.status === 'Inactive' ? ' (inactive)' : ''}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </CardContent>
      </AccessCard>

      {!user || !access ? (
        <HrEmptyState
          icon={UserSearch}
          title="Pick a user"
          description="You'll see their base role, everything added on top, where each permission comes from, and what they would see in the app."
        />
      ) : (
        <UserEffectiveAccessPanel
          user={user}
          access={access}
          registry={registry}
          departmentName={(id) => departments.find((department) => department.id === id)?.name ?? id}
          projectName={(id) => projects.find((project) => project.id === id)?.projectName ?? id}
          term={term}
          onTermChange={setTerm}
        />
      )}
    </div>
  );
}

/**
 * The §9 readout for one user.
 *
 * Extracted so the user access profile page (§25) renders the identical panel — an administrator
 * should not have to learn two layouts for the same information depending on which route they took.
 */
export function UserEffectiveAccessPanel({
  user,
  access,
  registry,
  departmentName,
  projectName,
  term,
  onTermChange,
}: {
  user: User;
  access: EffectiveAccess;
  registry: RegistryNode[];
  departmentName: (id: string) => string;
  projectName: (id: string) => string;
  term: string;
  onTermChange: (next: string) => void;
}) {
  const privileges = useMemo(() => detectPrivilegedAccess(access), [access]);
  const conflicts = useMemo(() => detectSodConflicts(access), [access]);

  /** Held permissions, grouped by module, filtered by the search box. */
  const heldByModule = useMemo(() => {
    const nodes = searchRegistry(registry, term);
    const allowed = new Set(nodes.map((node) => node.resource));
    const grouped = new Map<string, Array<{ resource: string; action: string }>>();

    for (const [resource, actions] of Object.entries(access.permissions)) {
      // Scoped keys (`Resource.projectId`) resolve to a registry node by dropping the scope segment.
      const base = allowed.has(resource)
        ? resource
        : [...allowed].find((candidate) => resource.startsWith(`${candidate}.`));
      if (!base) continue;
      const moduleName = base.split('.')[0];
      const list = grouped.get(moduleName) ?? [];
      for (const action of actions) list.push({ resource, action });
      grouped.set(moduleName, list);
    }

    return [...grouped.entries()]
      .map(([moduleName, entries]) => [moduleName, entries.sort((a, b) => a.resource.localeCompare(b.resource))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [access.permissions, registry, term]);

  return (
    <div className="space-y-3">
      {/* Summary */}
      <AccessCard>
        <CardHeader className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{user.name || user.email}</CardTitle>
              <CardDescription className="text-xs">
                {[user.email, user.mobile].filter((value) => value && value !== 'N/A').join(' · ')}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={
                  user.status === 'Inactive'
                    ? 'border-slate-300 bg-slate-100 text-slate-600'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                }
              >
                {user.status ?? 'Active'}
              </Badge>
              <RiskBadges privileges={privileges} conflicts={conflicts} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatLine label="Effective permissions" value={access.permissionCount} tone="indigo" />
            <StatLine label="Modules reachable" value={access.modules.length} />
            <StatLine label="Roles in force" value={access.effectiveRoleNames.length} />
            <StatLine
              label="Temporary active"
              value={access.temporaryActive.length}
              tone={access.temporaryActive.length ? 'amber' : 'slate'}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HrField label="Base role">
              {access.baseRoleName ? (
                <RoleBadge name={access.baseRoleName} kind="base" />
              ) : (
                <span className="text-xs text-muted-foreground">None — this user has no primary role</span>
              )}
            </HrField>
            <HrField label="Additional roles">
              {access.additionalRoleNames.length ? (
                <span className="flex flex-wrap gap-1">
                  {access.additionalRoleNames.map((name) => (
                    <RoleBadge key={name} name={name} kind="additional" />
                  ))}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">None</span>
              )}
            </HrField>
            <HrField label="Project / site access">
              {access.projectIds.length ? (
                <span className="flex flex-wrap gap-1">
                  {access.projectIds.map((id) => (
                    <Badge key={id} variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                      <FolderKanban className="h-3 w-3" />
                      {projectName(id)}
                    </Badge>
                  ))}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">All projects (no project restriction)</span>
              )}
            </HrField>
            <HrField label="Departments / designations">
              <span className="flex flex-wrap gap-1">
                {access.departmentIds.map((id) => (
                  <Badge key={id} variant="outline" className="gap-1 border-cyan-200 bg-cyan-50 text-cyan-700">
                    <Building2 className="h-3 w-3" />
                    {departmentName(id)}
                  </Badge>
                ))}
                {access.designations.map((designation) => (
                  <Badge key={designation} variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
                    {designation}
                  </Badge>
                ))}
                {!access.departmentIds.length && !access.designations.length && (
                  <span className="text-xs text-muted-foreground">None assigned</span>
                )}
              </span>
            </HrField>
          </div>

          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Effective modules
            </p>
            <div className="flex flex-wrap gap-1.5">
              {access.modules.length ? (
                access.modules.map((moduleName) => (
                  <Badge key={moduleName} variant="outline" className="text-[11px] text-slate-700">
                    {moduleName}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">No modules — this user cannot access anything.</span>
              )}
            </div>
          </div>

          {(access.temporaryActive.length > 0 ||
            access.temporaryUpcoming.length > 0 ||
            access.temporaryExpired.length > 0) && (
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-900">
                <CalendarClock className="h-3.5 w-3.5" />
                Temporary access
              </p>
              <div className="space-y-1.5">
                {[...access.temporaryActive, ...access.temporaryUpcoming, ...access.temporaryExpired].map((grant) => {
                  const grantState = temporaryGrantState(grant);
                  return (
                    <div key={grant.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          grantState === 'Active'
                            ? 'border-amber-300 bg-amber-100 text-amber-900'
                            : grantState === 'Upcoming'
                              ? 'border-sky-200 bg-sky-50 text-sky-700'
                              : 'border-slate-200 bg-white text-slate-500',
                        )}
                      >
                        {grantState}
                      </Badge>
                      <span className="font-medium text-slate-800">{grant.roleName || 'Direct permissions'}</span>
                      <span className="text-muted-foreground">
                        {formatGrantDate(grant.startAt)} → {formatGrantDate(grant.expiresAt)}
                      </span>
                      {grant.reason && <span className="text-muted-foreground">· {grant.reason}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </AccessCard>

      {/* Detail tabs */}
      <Tabs defaultValue="permissions">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="permissions" className="text-xs">Permissions &amp; sources</TabsTrigger>
          <TabsTrigger value="explain" className="text-xs">Why?</TabsTrigger>
          <TabsTrigger value="simulate" className="text-xs">Preview as user</TabsTrigger>
        </TabsList>

        <TabsContent value="permissions" className="mt-3 space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={term}
              onChange={(event) => onTermChange(event.target.value)}
              placeholder="Filter permissions…"
              className="pl-9"
            />
          </div>

          <ScrollArea className="h-[28rem] rounded-xl border border-white/70 bg-white/60">
            {heldByModule.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                No permissions match this filter.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {heldByModule.map(([moduleName, entries]) => (
                  <div key={moduleName} className="px-3 py-2.5">
                    <p className="mb-1.5 text-xs font-semibold text-slate-800">
                      {moduleName}
                      <span className="ml-1.5 font-normal text-muted-foreground">({entries.length})</span>
                    </p>
                    <div className="space-y-1">
                      {entries.map((entry) => (
                        <div
                          key={`${entry.resource}::${entry.action}`}
                          className="flex flex-wrap items-center justify-between gap-1.5"
                        >
                          <PermissionPair pair={`${entry.resource}::${entry.action}`} />
                          <SourceBadges
                            sources={access.sources[`${entry.resource}::${entry.action}`] ?? []}
                            max={3}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="explain" className="mt-3">
          <PermissionExplainer access={access} registry={registry} />
        </TabsContent>

        <TabsContent value="simulate" className="mt-3">
          <AccessSimulation access={access} registry={registry} userName={user.name || user.email} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * §44 — "Why does this user have this permission?"
 * ---------------------------------------------------------------------------------------------- */

function PermissionExplainer({
  access,
  registry,
}: {
  access: EffectiveAccess;
  registry: RegistryNode[];
}) {
  const [resource, setResource] = useState('');
  const [action, setAction] = useState('');

  const node = registry.find((entry) => entry.resource === resource);
  const explanation = resource && action ? explainPermission(access, resource, action) : null;

  return (
    <div className="space-y-3">
      <AccessCard>
        <CardHeader className="px-4 py-3">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <HelpCircle className="h-4 w-4 text-indigo-600" />
            Why does this user have this permission?
          </CardTitle>
          <CardDescription className="text-xs">
            Pick any permission — held or not — and see exactly which grant provides it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
          <Select
            value={resource}
            onValueChange={(value) => {
              setResource(value);
              setAction('');
            }}
          >
            <SelectTrigger><SelectValue placeholder="Module › page" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {registry.map((entry) => (
                <SelectItem key={entry.resource} value={entry.resource}>
                  {entry.resource.split('.').join(' › ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={setAction} disabled={!node}>
            <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              {(node?.actions ?? []).map((entry) => (
                <SelectItem key={entry} value={entry}>{entry}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </AccessCard>

      {explanation && (
        <Card
          className={cn(
            'shadow-sm backdrop-blur-sm',
            explanation.granted
              ? 'border-emerald-200 bg-emerald-50/60'
              : 'border-slate-200 bg-white/80',
          )}
        >
          <CardContent className="space-y-2.5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <PermissionPair pair={`${resource}::${action}`} className="text-sm" />
              <Badge
                variant="outline"
                className={
                  explanation.granted
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                    : 'border-slate-300 bg-slate-100 text-slate-600'
                }
              >
                {explanation.granted ? 'Granted' : 'Not granted'}
              </Badge>
            </div>

            <p className="text-sm text-slate-700">{explanation.summary}</p>

            {explanation.sources.length > 0 && (
              <div className="space-y-1.5 rounded-xl border border-white bg-white/80 p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Granted through
                </p>
                {explanation.sources.map((source, index) => (
                  <div key={`${source.kind}-${source.refId ?? index}`} className="text-xs text-slate-700">
                    <span className="font-medium">{source.label}</span>
                    <span className="text-muted-foreground"> · {source.kind}</span>
                    {source.assignedByName && (
                      <span className="text-muted-foreground"> · assigned by {source.assignedByName}</span>
                    )}
                    {source.assignedAt && (
                      <span className="text-muted-foreground"> on {formatGrantDate(source.assignedAt)}</span>
                    )}
                    {source.expiresAt && (
                      <span className="text-amber-700"> · expires {formatGrantDate(source.expiresAt)}</span>
                    )}
                    {source.reason && <span className="text-muted-foreground"> · “{source.reason}”</span>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * §45 — Preview access as user
 * ---------------------------------------------------------------------------------------------- */

/**
 * What this user would see, evaluated against their effective permissions.
 *
 * Uses the same `canAccessModule` the Module Hub and the layout shells use, so the module list here
 * is the module list they get — not a separate opinion about it that could drift.
 */
function AccessSimulation({
  access,
  registry,
  userName,
}: {
  access: EffectiveAccess;
  registry: RegistryNode[];
  userName: string;
}) {
  const modules = useMemo(() => [...new Set(registry.map((node) => node.module))].sort(), [registry]);

  const evaluated = useMemo(
    () =>
      modules.map((moduleName) => {
        const nodes = registry.filter((node) => node.module === moduleName && node.depth > 0);
        const pages = nodes.map((node) => ({
          resource: node.resource,
          label: node.resource.split('.').slice(1).join(' › '),
          actions: node.actions.filter((action) => (access.permissions[node.resource] ?? []).includes(action)),
          total: node.actions.length,
        }));
        return {
          moduleName,
          reachable: canAccessModule(access, moduleName),
          pages: pages.filter((page) => page.actions.length > 0),
          hiddenPages: pages.filter((page) => page.actions.length === 0).length,
        };
      }),
    [modules, registry, access],
  );

  const reachable = evaluated.filter((entry) => entry.reachable);
  const blocked = evaluated.filter((entry) => !entry.reachable);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-sky-900">
          <Eye className="h-4 w-4" />
          Simulating {userName}
        </p>
        <p className="mt-0.5 text-xs text-sky-800">
          A read-only projection of their permissions. Nobody is signed in as anybody — nothing here
          writes, and no audit record is attributed to them.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatLine label="Modules visible" value={reachable.length} tone="emerald" />
        <StatLine label="Modules hidden" value={blocked.length} />
        <StatLine label="Pages visible" value={reachable.reduce((sum, entry) => sum + entry.pages.length, 0)} />
        <StatLine label="Actions available" value={access.permissionCount} tone="indigo" />
      </div>

      <ScrollArea className="h-[24rem] rounded-xl border border-white/70 bg-white/60">
        <div className="divide-y divide-slate-100">
          {reachable.length === 0 && (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              This user would see no modules at all.
            </p>
          )}
          {reachable.map((entry) => (
            <div key={entry.moduleName} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <p className="text-sm font-semibold text-slate-800">{entry.moduleName}</p>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                  {entry.pages.length} page{entry.pages.length === 1 ? '' : 's'}
                </Badge>
                {entry.hiddenPages > 0 && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {entry.hiddenPages} hidden
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 space-y-1 pl-5">
                {entry.pages.map((page) => (
                  <div key={page.resource} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-medium text-slate-700">{page.label || 'Module access'}</span>
                    <span className="text-muted-foreground">
                      {page.actions.join(', ')}
                      {page.actions.length < page.total && (
                        <span className="text-slate-400"> ({page.total - page.actions.length} more not granted)</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {blocked.length > 0 && (
            <div className="px-3 py-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                Not visible to this user
              </p>
              <div className="flex flex-wrap gap-1">
                {blocked.map((entry) => (
                  <Badge key={entry.moduleName} variant="outline" className="text-[10px] text-slate-500">
                    {entry.moduleName}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <p className="px-1 text-[11px] text-muted-foreground">
        {countPermissions(access.permissions)} permissions in force
        {access.temporaryActive.length > 0 &&
          `, including ${access.temporaryActive.length} temporary grant(s) that will lapse`}
        .
      </p>
    </div>
  );
}
