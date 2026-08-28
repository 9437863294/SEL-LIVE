'use client';

/**
 * The assignment workspace — §5 and §13 are the same screen entered from opposite ends.
 *
 * §5 says "select roles, then users, then Add Access". §13 says "filter to a department, select 12
 * users, then pick a role". Both are satisfied by one screen with two independent panels and no
 * enforced order: an administrator can build the grant first or the audience first, and the Add
 * Access button lights up when both halves are non-empty.
 *
 * Building it as a wizard would have forced one order and made the other into a second
 * implementation. The panels are on one screen for the same reason the preview exists — an
 * administrator needs to see the whole operation before committing it.
 */

import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  Copy,
  KeyRound,
  Layers,
  ShieldPlus,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { hrDialog, HrEmptyState } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { User } from '@/lib/types';
import {
  buildCopyAccessRequest,
  countPermissions,
  emptyUserAccessGrant,
  mergePermissionMaps,
  type AccessAssignmentRequest,
  type PermissionMap,
  type RoleLike,
} from '@/lib/access-control';
import { grantAccess, type AccessActor } from '@/lib/access-control-service';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import { AssignmentPreviewDialog } from './assignment-preview';
import { PermissionTree } from './permission-tree';
import {
  EMPTY_USER_FILTER,
  RolePicker,
  UserPicker,
  type UserDirectoryContext,
  type UserFilterState,
} from './pickers';
import { AccessCard, StatLine } from './access-ui';

export interface AssignAccessProps {
  state: AccessDirectoryState;
  actor: AccessActor;
  canAssign: boolean;
  /**
   * Pre-selected users, roles and templates.
   *
   * These are *seeds*, not controlled values: the shell remounts this component with a fresh key
   * when it wants to hand over a new selection (the Roles tab's "Assign", the Users tab's "Assign to
   * N filtered", a `?assignTo=` deep link). Making them controlled would mean the shell owning every
   * checkbox on this screen, and ten sibling tabs re-rendering whenever one moved.
   */
  initialUserIds?: string[];
  initialRoleIds?: string[];
  initialTemplateIds?: string[];
}

export function AssignAccess({
  state,
  actor,
  canAssign,
  initialUserIds = [],
  initialRoleIds = [],
  initialTemplateIds = [],
}: AssignAccessProps) {
  const { toast } = useToast();
  const { directory, accessByUser, departments, projects, designations, employees, registry, roleUsage } = state;

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(initialUserIds);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(initialRoleIds);
  const [directPermissions, setDirectPermissions] = useState<PermissionMap>({});
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([]);
  const [selectedDesignations, setSelectedDesignations] = useState<string[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(initialTemplateIds);
  const [filter, setFilter] = useState<UserFilterState>(EMPTY_USER_FILTER);

  const [temporaryEnabled, setTemporaryEnabled] = useState(false);
  const [temporaryStart, setTemporaryStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [temporaryExpiry, setTemporaryExpiry] = useState('');
  const [temporaryReason, setTemporaryReason] = useState('');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

  const userContext: UserDirectoryContext = useMemo(
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

  const selectedUsers = useMemo(
    () => directory.users.filter((user) => selectedUserIds.includes(user.id)),
    [directory.users, selectedUserIds],
  );

  const selectedRoles = useMemo(
    () => directory.roles.filter((role) => selectedRoleIds.includes(role.id)),
    [directory.roles, selectedRoleIds],
  );

  /**
   * Everything the selected roles and templates contain, merged — the "see the permissions inside
   * these roles" of §5 step 2.
   */
  const roleContents = useMemo(() => {
    const templateMaps = selectedTemplateIds.map(
      (id) => directory.templates.find((template) => template.id === id)?.permissions,
    );
    const templateRoleMaps = selectedTemplateIds.flatMap((id) =>
      (directory.templates.find((template) => template.id === id)?.roleIds ?? []).map(
        (roleId) => directory.roles.find((role) => role.id === roleId)?.permissions,
      ),
    );
    return mergePermissionMaps(
      ...selectedRoles.map((role) => role.permissions),
      ...templateMaps,
      ...templateRoleMaps,
    );
  }, [selectedRoles, selectedTemplateIds, directory.templates, directory.roles]);

  /**
   * What the selected users already hold, intersected across them.
   *
   * Passed to the permission tree as `inherited`, so an administrator granting direct permissions to
   * a group sees which boxes are already satisfied for *everybody* in it. Using the intersection
   * rather than the union is the conservative choice: a permission only one of twelve users has is
   * still worth granting to the other eleven, and locking the box would prevent that.
   */
  const inheritedByAll = useMemo(() => {
    if (!selectedUsers.length) return {};
    const maps = selectedUsers.map((user) => accessByUser[user.id]?.permissions ?? {});
    let result = maps[0] ?? {};
    for (const map of maps.slice(1)) {
      const next: PermissionMap = {};
      for (const [resource, actions] of Object.entries(result)) {
        const kept = actions.filter((action) => (map[resource] ?? []).includes(action));
        if (kept.length) next[resource] = kept;
      }
      result = next;
    }
    return result;
  }, [selectedUsers, accessByUser]);

  const request: AccessAssignmentRequest = useMemo(
    () => ({
      roleIds: selectedRoleIds,
      directPermissions,
      projectIds: selectedProjectIds,
      departmentIds: selectedDepartmentIds,
      designations: selectedDesignations,
      templateIds: selectedTemplateIds,
      temporary:
        temporaryEnabled && temporaryStart && temporaryExpiry
          ? {
              startAt: new Date(`${temporaryStart}T00:00:00`).toISOString(),
              expiresAt: new Date(`${temporaryExpiry}T23:59:59`).toISOString(),
              reason: temporaryReason.trim(),
            }
          : null,
    }),
    [
      selectedRoleIds,
      directPermissions,
      selectedProjectIds,
      selectedDepartmentIds,
      selectedDesignations,
      selectedTemplateIds,
      temporaryEnabled,
      temporaryStart,
      temporaryExpiry,
      temporaryReason,
    ],
  );

  const hasGrantToMake =
    selectedRoleIds.length > 0 ||
    Object.keys(directPermissions).length > 0 ||
    selectedProjectIds.length > 0 ||
    selectedDepartmentIds.length > 0 ||
    selectedDesignations.length > 0 ||
    selectedTemplateIds.length > 0;

  /**
   * `request.temporary` is only built once start and expiry are both set — so a half-filled
   * temporary section would otherwise save a *permanent* grant, which is the opposite of what the
   * switch promised. Blocked here rather than silently degraded.
   */
  const temporaryIncomplete =
    temporaryEnabled && (!temporaryStart || !temporaryExpiry || !temporaryReason.trim());

  const resetGrant = () => {
    setSelectedRoleIds([]);
    setDirectPermissions({});
    setSelectedProjectIds([]);
    setSelectedDepartmentIds([]);
    setSelectedDesignations([]);
    setSelectedTemplateIds([]);
    setTemporaryEnabled(false);
    setTemporaryExpiry('');
    setTemporaryReason('');
  };

  const handleConfirm = useCallback(
    async (reason: string) => {
      const result = await grantAccess({
        users: selectedUsers,
        request,
        directory,
        actor,
        reason,
        label:
          selectedRoles.length > 0
            ? `Add ${selectedRoles.map((role) => role.name).join(', ')} to ${selectedUsers.length} user(s)`
            : `Add access to ${selectedUsers.length} user(s)`,
      });
      await state.refresh();
      resetGrant();
      setSelectedUserIds([]);
      return result;
    },
    [selectedUsers, request, directory, actor, selectedRoles, state],
  );

  if (!canAssign) {
    return (
      <HrEmptyState
        icon={ShieldPlus}
        title="You can view access, but not change it"
        description="Assigning access needs the Assign permission on Settings › Access Management."
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Sticky action toolbar (§33) */}
      <div className="sticky top-0 z-20 -mx-1 rounded-xl border border-white/70 bg-white/85 px-3 py-2.5 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className="gap-1 border-indigo-200 bg-indigo-50 text-indigo-700">
              <Users className="h-3.5 w-3.5" />
              {selectedUserIds.length} user{selectedUserIds.length === 1 ? '' : 's'}
            </Badge>
            <Badge variant="outline" className="gap-1 border-violet-200 bg-violet-50 text-violet-700">
              <Layers className="h-3.5 w-3.5" />
              {selectedRoleIds.length} role{selectedRoleIds.length === 1 ? '' : 's'}
            </Badge>
            {Object.keys(directPermissions).length > 0 && (
              <Badge variant="outline" className="gap-1 border-violet-200 bg-violet-50 text-violet-700">
                <KeyRound className="h-3.5 w-3.5" />
                {countPermissions(directPermissions)} direct
              </Badge>
            )}
            {selectedProjectIds.length > 0 && (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                {selectedProjectIds.length} project{selectedProjectIds.length === 1 ? '' : 's'}
              </Badge>
            )}
            {temporaryEnabled && (
              <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-800">
                <CalendarClock className="h-3.5 w-3.5" />
                Temporary
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {/*
              Leaves the page rather than opening a dialog, and comes back with the new user selected
              through `?assignTo=`. Any selection already made here is lost on the way — which is why
              the entry point sits beside "Add user" in the *user* picker rather than mid-assignment,
              and why the new user arrives preselected so the trip is not wasted.
            */}
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/access-management/users/new?returnTo=%2Fsettings%2Faccess-management">
                <UserPlus className="mr-1.5 h-4 w-4" />
                Add user
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={selectedUserIds.length === 0}
              onClick={() => setCopyOpen(true)}
            >
              <Copy className="mr-1.5 h-4 w-4" />
              Copy access from…
            </Button>
            <Button variant="ghost" size="sm" onClick={resetGrant} disabled={!hasGrantToMake}>
              Clear grant
            </Button>
            <Button
              size="sm"
              disabled={selectedUserIds.length === 0 || !hasGrantToMake || temporaryIncomplete}
              onClick={() => setPreviewOpen(true)}
            >
              <ShieldPlus className="mr-1.5 h-4 w-4" />
              Add access to {selectedUserIds.length || 0} user{selectedUserIds.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
        {selectedUserIds.length > 0 && hasGrantToMake && (
          <p className="mt-1.5 text-[11px] text-emerald-700">
            Additive only — existing permissions are never removed. You'll see the full impact before
            anything is saved.
          </p>
        )}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {/* ---- What to grant ---- */}
        <AccessCard>
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">1 · What to grant</CardTitle>
            <CardDescription className="text-xs">
              Roles, templates, individual permissions, projects, departments or designations. Mix as
              needed — everything selected is added together.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4">
            <Tabs defaultValue="roles">
              <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
                <TabsTrigger value="roles" className="text-xs">Roles</TabsTrigger>
                <TabsTrigger value="permissions" className="text-xs">Permissions</TabsTrigger>
                <TabsTrigger value="scope" className="text-xs">Scope</TabsTrigger>
                <TabsTrigger value="templates" className="text-xs">Templates</TabsTrigger>
              </TabsList>

              <TabsContent value="roles" className="mt-3 space-y-2">
                <RolePicker
                  roles={directory.roles}
                  roleUsage={roleUsage}
                  selectedIds={selectedRoleIds}
                  onSelectionChange={setSelectedRoleIds}
                  heightClassName="h-[19rem]"
                />
                {Object.keys(roleContents).length > 0 && (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-2.5">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                      These roles contain {countPermissions(roleContents)} permissions
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {Object.keys(roleContents)
                        .map((resource) => resource.split('.')[0])
                        .filter((moduleName, index, all) => all.indexOf(moduleName) === index)
                        .slice(0, 14)
                        .map((moduleName) => (
                          <Badge key={moduleName} variant="outline" className="text-[10px] text-indigo-700">
                            {moduleName}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="permissions" className="mt-3">
                <PermissionTree
                  registry={registry}
                  value={directPermissions}
                  onChange={setDirectPermissions}
                  inherited={selectedUsers.length ? inheritedByAll : undefined}
                  inheritedLabel={
                    selectedUsers.length === 1
                      ? `by ${selectedUsers[0].name || 'this user'}`
                      : `by all ${selectedUsers.length} selected users`
                  }
                  heightClassName="h-[21rem]"
                />
              </TabsContent>

              <TabsContent value="scope" className="mt-3 space-y-3">
                <ScopeMultiSelect
                  label="Projects / sites"
                  hint="Grants access scoped to these projects only. Combine with a role to say what they can do there."
                  options={projects.map((project) => ({
                    id: project.id,
                    label: project.projectName || project.siteCode || project.id,
                    hint: project.location,
                  }))}
                  selected={selectedProjectIds}
                  onChange={setSelectedProjectIds}
                />
                <ScopeMultiSelect
                  label="Departments"
                  hint="Adds the user to the department, so whatever the department grants reaches them."
                  options={departments.map((department) => ({ id: department.id, label: department.name }))}
                  selected={selectedDepartmentIds}
                  onChange={setSelectedDepartmentIds}
                />
                <ScopeMultiSelect
                  label="Designations"
                  hint="Same, for designation-based access."
                  options={designations.map((designation) => ({ id: designation, label: designation }))}
                  selected={selectedDesignations}
                  onChange={setSelectedDesignations}
                />
              </TabsContent>

              <TabsContent value="templates" className="mt-3">
                {directory.templates.filter((template) => template.active !== false).length === 0 ? (
                  <HrEmptyState
                    icon={Sparkles}
                    title="No access templates yet"
                    description="Create one under the Templates tab to reuse a common bundle — Site Engineer, Finance Executive, and so on."
                  />
                ) : (
                  <div className="space-y-2">
                    {directory.templates
                      .filter((template) => template.active !== false)
                      .map((template) => {
                        const selected = selectedTemplateIds.includes(template.id);
                        return (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() =>
                              setSelectedTemplateIds((current) =>
                                selected ? current.filter((id) => id !== template.id) : [...current, template.id],
                              )
                            }
                            className={cn(
                              'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                              selected
                                ? 'border-violet-300 bg-violet-50'
                                : 'border-white bg-white/80 hover:bg-slate-50',
                            )}
                          >
                            <p className="text-sm font-semibold text-slate-800">{template.name}</p>
                            {template.description && (
                              <p className="text-xs text-muted-foreground">{template.description}</p>
                            )}
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {(template.roleIds ?? []).length} role(s) ·{' '}
                              {countPermissions(template.permissions)} direct permission(s)
                              {(template.projectIds ?? []).length
                                ? ` · ${(template.projectIds ?? []).length} project(s)`
                                : ''}
                            </p>
                          </button>
                        );
                      })}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {/* Temporary access (§22) */}
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                    <CalendarClock className="h-4 w-4" />
                    Make this temporary
                  </p>
                  <p className="text-[11px] text-amber-800">
                    Lapses on its own at the expiry date. The record stays for the audit trail.
                  </p>
                </div>
                <Switch checked={temporaryEnabled} onCheckedChange={setTemporaryEnabled} />
              </div>

              {temporaryEnabled && (
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="temp-start" className="text-xs">Start date *</Label>
                    <Input
                      id="temp-start"
                      type="date"
                      value={temporaryStart}
                      onChange={(event) => setTemporaryStart(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="temp-expiry" className="text-xs">Expiry date *</Label>
                    <Input
                      id="temp-expiry"
                      type="date"
                      min={temporaryStart}
                      value={temporaryExpiry}
                      onChange={(event) => setTemporaryExpiry(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="temp-reason" className="text-xs">Reason *</Label>
                    <Textarea
                      id="temp-reason"
                      rows={2}
                      value={temporaryReason}
                      onChange={(event) => setTemporaryReason(event.target.value)}
                      placeholder="e.g. Covering BG approvals while Anil is on leave"
                    />
                  </div>
                  {temporaryIncomplete && (
                    <p className="text-[11px] font-medium text-rose-700 sm:col-span-2">
                      Start date, expiry date and reason are all required — without them this would be
                      saved as a permanent grant.
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </AccessCard>

        {/* ---- Who to grant it to ---- */}
        <AccessCard>
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">2 · Who gets it</CardTitle>
            <CardDescription className="text-xs">
              Search or filter, then tick users. “Select all filtered” selects everything the filter
              matched, not just what is visible.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4">
            <UserPicker
              context={userContext}
              filter={filter}
              onFilterChange={setFilter}
              selectedIds={selectedUserIds}
              onSelectionChange={setSelectedUserIds}
              registry={state.registry}
              heightClassName="h-[25rem]"
            />

            {selectedUsers.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatLine label="Selected" value={selectedUsers.length} tone="indigo" />
                <StatLine
                  label="Already hold all roles"
                  value={
                    selectedUsers.filter((user) =>
                      selectedRoles.every((role) =>
                        (accessByUser[user.id]?.effectiveRoleNames ?? []).includes(role.name),
                      ),
                    ).length
                  }
                />
                <StatLine
                  label="Inactive"
                  value={selectedUsers.filter((user) => user.status === 'Inactive').length}
                  tone={selectedUsers.some((user) => user.status === 'Inactive') ? 'amber' : 'slate'}
                />
                <StatLine label="Permissions removed" value={0} tone="emerald" />
              </div>
            )}
          </CardContent>
        </AccessCard>
      </div>

      <AssignmentPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        users={selectedUsers}
        request={request}
        roles={directory.roles}
        grants={directory.grants}
        scopeGrants={directory.scopeGrants}
        templates={directory.templates}
        projects={projects}
        onConfirm={handleConfirm}
      />

      <CopyAccessDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        state={state}
        targets={selectedUsers}
        onApply={(applied) => {
          setSelectedRoleIds((current) => [...new Set([...current, ...(applied.roleIds ?? [])])]);
          setDirectPermissions((current) => mergePermissionMaps(current, applied.directPermissions));
          setSelectedProjectIds((current) => [...new Set([...current, ...(applied.projectIds ?? [])])]);
          setSelectedDepartmentIds((current) => [...new Set([...current, ...(applied.departmentIds ?? [])])]);
          setSelectedDesignations((current) => [...new Set([...current, ...(applied.designations ?? [])])]);
          toast({
            title: 'Copied into the grant',
            description: 'Review it below, then use Add Access. Nothing has been saved yet.',
          });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Scope multi-select
 * ---------------------------------------------------------------------------------------------- */

function ScopeMultiSelect({
  label,
  hint,
  options,
  selected,
  onChange,
}: {
  label: string;
  hint?: string;
  options: Array<{ id: string; label: string; hint?: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [pending, setPending] = useState('');
  const available = options.filter((option) => !selected.includes(option.id));

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <div className="flex gap-2">
        <Select
          value={pending}
          onValueChange={(value) => {
            onChange([...selected, value]);
            setPending('');
          }}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={available.length ? `Add ${label.toLowerCase()}…` : 'All added'} />
          </SelectTrigger>
          <SelectContent>
            {available.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
                {option.hint ? ` — ${option.hint}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const option = options.find((entry) => entry.id === id);
            return (
              <Badge key={id} variant="outline" className="gap-1 border-slate-200 bg-white text-xs">
                {option?.label ?? id}
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((entry) => entry !== id))}
                  aria-label={`Remove ${option?.label ?? id}`}
                  className="rounded-full px-1 text-slate-400 hover:bg-slate-100"
                >
                  ×
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Copy access from another user (§23)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Copy one person's additive access into the grant being built.
 *
 * Deliberately loads the request into the workspace rather than writing it. The administrator still
 * goes through the preview, still sees "existing permissions removed: 0" for each target, and can
 * still add or drop pieces before saving — which is what §23's "preview, then apply" asks for and
 * what a one-click copy would skip.
 */
function CopyAccessDialog({
  open,
  onOpenChange,
  state,
  targets,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AccessDirectoryState;
  targets: User[];
  onApply: (request: AccessAssignmentRequest) => void;
}) {
  const { directory, projects } = state;
  const [sourceId, setSourceId] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  const [includeBaseRole, setIncludeBaseRole] = useState(false);

  /**
   * The dropdown renders at most 400 rows to keep the popover responsive on a ~1,300-user
   * directory — the search narrows the list rather than the truncation hiding people silently.
   */
  const sourceCandidates = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase();
    return directory.users
      .filter((user) => user.status !== 'Inactive')
      .filter(
        (user) =>
          !query ||
          [user.name, user.email, user.role].filter(Boolean).join(' ').toLowerCase().includes(query),
      );
  }, [directory.users, sourceSearch]);

  const source = directory.users.find((user) => user.id === sourceId);
  const sourceGrant = sourceId ? (directory.grants[sourceId] ?? emptyUserAccessGrant(sourceId)) : null;

  const request = useMemo(() => {
    if (!source || !sourceGrant) return null;
    return buildCopyAccessRequest(sourceGrant, source, {
      roles: directory.roles as RoleLike[],
      includeBaseRoleAsAdditional: includeBaseRole,
    });
  }, [source, sourceGrant, directory.roles, includeBaseRole]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Copy access from another user</DialogTitle>
          <DialogDescription>
            Loads their additional access into the grant you are building. Nothing is removed from the{' '}
            {targets.length} selected user{targets.length === 1 ? '' : 's'}.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div className="space-y-1.5">
            <Label>Copy from</Label>
            <Input
              value={sourceSearch}
              onChange={(event) => setSourceSearch(event.target.value)}
              placeholder="Search by name, email or role…"
            />
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger><SelectValue placeholder="Select a user" /></SelectTrigger>
              <SelectContent>
                {sourceCandidates.slice(0, 400).map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name || user.email} {user.role ? `· ${user.role}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sourceCandidates.length > 400 && (
              <p className="text-[11px] text-muted-foreground">
                Showing the first 400 of {sourceCandidates.length} — search to find anyone else.
              </p>
            )}
          </div>

          {source && (
            <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  Also copy their base role ({source.role || 'none'}) as an additional role
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Their primary role is not copied by default — writing another user's primary role
                  belongs in User Management. Granting it additionally has the same effect on access and
                  leaves the target's own primary role intact.
                </p>
              </div>
              <Switch checked={includeBaseRole} onCheckedChange={setIncludeBaseRole} />
            </label>
          )}

          {request && (
            <div className="space-y-2 rounded-xl border border-white/70 bg-white/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Will be added to the grant
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(request.roleIds ?? []).length === 0 &&
                  Object.keys(request.directPermissions ?? {}).length === 0 &&
                  (request.projectIds ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      This user has no additional access to copy — their access comes entirely from their
                      base role.
                    </p>
                  )}
                {(request.roleIds ?? []).map((roleId) => {
                  const role = directory.roles.find((entry) => entry.id === roleId);
                  return (
                    <Badge key={roleId} variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                      {role?.name ?? roleId}
                    </Badge>
                  );
                })}
                {Object.keys(request.directPermissions ?? {}).length > 0 && (
                  <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                    {countPermissions(request.directPermissions)} direct permissions
                  </Badge>
                )}
                {(request.projectIds ?? []).map((projectId) => (
                  <Badge key={projectId} variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                    {projects.find((project) => project.id === projectId)?.projectName ?? projectId}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!request}
            onClick={() => {
              if (request) onApply(request);
              setSourceId('');
              setIncludeBaseRole(false);
              onOpenChange(false);
            }}
          >
            Load into grant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
