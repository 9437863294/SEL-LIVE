'use client';

/**
 * The selectors the assignment workflow is built from: users (§12), roles (§4), and projects.
 *
 * Both are extracted rather than inlined because §5 and §13 are the same workflow entered from
 * opposite ends — "pick roles then users" and "filter users then pick roles" — and the only honest
 * way to support both without two divergent implementations is for the pickers to be independent of
 * the order they are used in.
 *
 * ── The one thing that makes the user picker usable at scale ────────────────────────────────────
 *
 * "Select all filtered" selects what the filter matched, not what is on screen. With a thousand
 * users the visible list is a window onto the result, and a control that only selected the window
 * would silently do a fraction of what an administrator asked for. The count next to it is
 * therefore the filtered total, and the list itself is windowed for rendering only.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, FolderKanban, Search, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { Department, Employee, Project, Role, User } from '@/lib/types';
import {
  countPermissions,
  detectPrivilegedAccess,
  detectSodConflicts,
  isProtectedRole,
  type EffectiveAccess,
  type UserAccessGrant,
} from '@/lib/access-control';
import { RiskBadges, RoleBadge } from './access-ui';

/* ------------------------------------------------------------------------------------------------
 * User selection (§12)
 * ---------------------------------------------------------------------------------------------- */

export interface UserFilterState {
  term: string;
  departmentId: string;
  designation: string;
  roleName: string;
  projectId: string;
  status: 'all' | 'Active' | 'Inactive';
  /** Only users holding this `resource::action` pair. §29's filter-by-permission. */
  permissionPair: string;
}

export const EMPTY_USER_FILTER: UserFilterState = {
  term: '',
  departmentId: 'all',
  designation: 'all',
  roleName: 'all',
  projectId: 'all',
  status: 'Active',
  permissionPair: '',
};

export interface UserDirectoryContext {
  users: User[];
  roles: Role[];
  grants: Record<string, UserAccessGrant>;
  accessByUser: Record<string, EffectiveAccess>;
  departments: Department[];
  projects: Project[];
  designations: string[];
  employees: Employee[];
}

/**
 * The employee record behind a user, matched on email.
 *
 * `users` and `employees` are separate collections with no foreign key — `employees` is a GreytHR
 * mirror and predates the app's own accounts. Email is the only field both reliably carry, so it is
 * the join, and a user with no matching employee simply has no department or designation to filter
 * on rather than being excluded.
 */
export function employeeForUser(user: User, employees: Employee[]): Employee | undefined {
  const email = (user.email || '').trim().toLowerCase();
  if (!email) return undefined;
  return employees.find((employee) => (employee.email || '').trim().toLowerCase() === email);
}

export function filterUsers(context: UserDirectoryContext, filter: UserFilterState): User[] {
  const term = filter.term.trim().toLowerCase();
  const employeeIndex = new Map(
    context.employees.map((employee) => [(employee.email || '').trim().toLowerCase(), employee]),
  );

  return context.users.filter((user) => {
    if (filter.status !== 'all' && (user.status ?? 'Active') !== filter.status) return false;

    const employee = employeeIndex.get((user.email || '').trim().toLowerCase());
    const grant = context.grants[user.id];
    const access = context.accessByUser[user.id];

    if (term) {
      const haystack = [
        user.name,
        user.email,
        user.mobile,
        user.role,
        employee?.employeeId,
        employee?.employeeNo,
        employee?.department,
        employee?.designation,
        employee?.phone,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }

    if (filter.departmentId !== 'all') {
      // A department can be recorded on the employee master or granted through the access layer;
      // both count as "in this department" for selection purposes.
      const department = context.departments.find((entry) => entry.id === filter.departmentId);
      const byEmployee = employee?.department && department?.name && employee.department === department.name;
      const byGrant = grant?.departmentIds.includes(filter.departmentId);
      if (!byEmployee && !byGrant) return false;
    }

    if (filter.designation !== 'all') {
      const byEmployee = employee?.designation === filter.designation;
      const byGrant = grant?.designations.includes(filter.designation);
      if (!byEmployee && !byGrant) return false;
    }

    if (filter.roleName !== 'all') {
      const holds = access
        ? access.effectiveRoleNames.includes(filter.roleName)
        : user.role === filter.roleName;
      if (!holds) return false;
    }

    if (filter.projectId !== 'all') {
      const byGrant = access?.projectIds.includes(filter.projectId);
      const project = context.projects.find((entry) => entry.id === filter.projectId);
      const isSiteInCharge = project?.siteInCharge === user.id;
      if (!byGrant && !isSiteInCharge) return false;
    }

    if (filter.permissionPair) {
      const [resource, action] = filter.permissionPair.split('::');
      if (!(access?.permissions[resource] ?? []).includes(action)) return false;
    }

    return true;
  });
}

export function UserFilterBar({
  filter,
  onChange,
  context,
  className,
}: {
  filter: UserFilterState;
  onChange: (next: UserFilterState) => void;
  context: UserDirectoryContext;
  className?: string;
}) {
  const set = <K extends keyof UserFilterState>(key: K, value: UserFilterState[K]) =>
    onChange({ ...filter, [key]: value });

  return (
    <div className={cn('grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3', className)}>
      <div className="relative lg:col-span-2">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <Input
          value={filter.term}
          onChange={(event) => set('term', event.target.value)}
          placeholder="Name, employee ID, email, phone, department, designation…"
          className="pl-9"
        />
        {filter.term && (
          <button
            type="button"
            onClick={() => set('term', '')}
            aria-label="Clear search"
            className="absolute right-2 top-2 rounded-full p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <Select value={filter.status} onValueChange={(value) => set('status', value as UserFilterState['status'])}>
        <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="Active">Active only</SelectItem>
          <SelectItem value="Inactive">Inactive only</SelectItem>
          <SelectItem value="all">All statuses</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filter.departmentId} onValueChange={(value) => set('departmentId', value)}>
        <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All departments</SelectItem>
          {context.departments.map((department) => (
            <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filter.designation} onValueChange={(value) => set('designation', value)}>
        <SelectTrigger><SelectValue placeholder="Designation" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All designations</SelectItem>
          {context.designations.map((designation) => (
            <SelectItem key={designation} value={designation}>{designation}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filter.roleName} onValueChange={(value) => set('roleName', value)}>
        <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All roles</SelectItem>
          {context.roles.map((role) => (
            <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filter.projectId} onValueChange={(value) => set('projectId', value)}>
        <SelectTrigger><SelectValue placeholder="Project / site" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All projects</SelectItem>
          {context.projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.projectName || project.siteCode || project.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** How many rows the list renders at once. Everything beyond is reachable by narrowing the filter. */
const USER_WINDOW = 120;

export function UserPicker({
  context,
  filter,
  onFilterChange,
  selectedIds,
  onSelectionChange,
  heightClassName = 'h-[24rem]',
  showFilters = true,
}: {
  context: UserDirectoryContext;
  filter: UserFilterState;
  onFilterChange: (next: UserFilterState) => void;
  selectedIds: string[];
  onSelectionChange: (next: string[]) => void;
  heightClassName?: string;
  showFilters?: boolean;
}) {
  const filtered = useMemo(() => filterUsers(context, filter), [context, filter]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const windowed = filtered.slice(0, USER_WINDOW);

  const employeeIndex = useMemo(
    () => new Map(context.employees.map((employee) => [(employee.email || '').trim().toLowerCase(), employee])),
    [context.employees],
  );

  const toggle = (userId: string) => {
    onSelectionChange(
      selected.has(userId) ? selectedIds.filter((id) => id !== userId) : [...selectedIds, userId],
    );
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((user) => selected.has(user.id));

  return (
    <div className="space-y-2.5">
      {showFilters && <UserFilterBar filter={filter} onChange={onFilterChange} context={context} />}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/70 bg-white/70 px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
            {selectedIds.length} selected
          </Badge>
          <span className="text-muted-foreground">{filtered.length} match the filter</span>
          {filtered.length > windowed.length && (
            <span className="text-muted-foreground">· showing first {windowed.length}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!filtered.length}
            onClick={() =>
              onSelectionChange(
                allFilteredSelected
                  ? selectedIds.filter((id) => !filtered.some((user) => user.id === id))
                  : [...new Set([...selectedIds, ...filtered.map((user) => user.id)])],
              )
            }
          >
            {allFilteredSelected ? 'Deselect' : 'Select all'} {filtered.length} filtered
          </Button>
          {selectedIds.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onSelectionChange([])}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className={cn('rounded-xl border border-white/70 bg-white/60', heightClassName)}>
        {windowed.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Users className="h-8 w-8 text-slate-300" />
            <p className="text-sm text-muted-foreground">No users match these filters.</p>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-slate-100/80">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10" />
                <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Name
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Contact
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Roles
                </TableHead>
                <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Permissions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {windowed.map((user) => {
                const access = context.accessByUser[user.id];
                const grant = context.grants[user.id];
                const employee = employeeIndex.get((user.email || '').trim().toLowerCase());
                const isSelected = selected.has(user.id);

                return (
                  <TableRow
                    key={user.id}
                    onClick={() => toggle(user.id)}
                    className={cn('cursor-pointer', isSelected && 'bg-indigo-50/70')}
                  >
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox checked={isSelected} onCheckedChange={() => toggle(user.id)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-800">{user.name || user.email}</span>
                        {(user.status ?? 'Active') !== 'Active' && (
                          <Badge variant="outline" className="border-slate-200 bg-white text-[10px] text-slate-500">
                            Inactive
                          </Badge>
                        )}
                        {access && (
                          <RiskBadges
                            privileges={detectPrivilegedAccess(access)}
                            conflicts={detectSodConflicts(access)}
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[user.email, employee?.employeeId, employee?.department, employee?.designation]
                        .filter(Boolean)
                        .join(' · ')}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {user.role && <RoleBadge name={user.role} kind="base" />}
                        {(grant?.additionalRoles ?? []).slice(0, 3).map((assignment) => (
                          <RoleBadge key={assignment.roleId} name={assignment.roleName} kind="additional" />
                        ))}
                        {(grant?.additionalRoles?.length ?? 0) > 3 && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            +{(grant?.additionalRoles?.length ?? 0) - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {access ? countPermissions(access.permissions) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ScrollArea>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Role selection (§4)
 * ---------------------------------------------------------------------------------------------- */

export function RolePicker({
  roles,
  roleUsage,
  selectedIds,
  onSelectionChange,
  heightClassName = 'h-[18rem]',
  multiple = true,
}: {
  roles: Role[];
  roleUsage?: Record<string, { base: number; additional: number; total: number }>;
  selectedIds: string[];
  onSelectionChange: (next: string[]) => void;
  heightClassName?: string;
  multiple?: boolean;
}) {
  const [term, setTerm] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtered = useMemo(() => {
    const query = term.trim().toLowerCase();
    const active = roles.filter((role) => role.status !== 'Inactive' && role.status !== 'Disabled');
    if (!query) return active.sort((a, b) => a.name.localeCompare(b.name));
    return active
      .filter(
        (role) =>
          role.name.toLowerCase().includes(query) ||
          (role.description ?? '').toLowerCase().includes(query) ||
          Object.keys(role.permissions ?? {}).some((resource) => resource.toLowerCase().includes(query)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [roles, term]);

  const toggle = (roleId: string) => {
    if (!multiple) {
      onSelectionChange(selected.has(roleId) ? [] : [roleId]);
      return;
    }
    onSelectionChange(selected.has(roleId) ? selectedIds.filter((id) => id !== roleId) : [...selectedIds, roleId]);
  };

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search roles or the permissions they contain…"
          className="pl-9"
        />
      </div>

      <ScrollArea className={cn('rounded-xl border border-white/70 bg-white/60', heightClassName)}>
        {filtered.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">No roles match “{term}”.</p>
        ) : (
          // As many cards as fit a row, wrapping to the next one — not a single-column list of rows,
          // which left most of a wide dialog empty next to a narrow strip of text.
          <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((role) => {
              const isSelected = selected.has(role.id);
              const usage = roleUsage?.[role.name];
              return (
                <label
                  key={role.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2.5 shadow-sm transition-colors',
                    isSelected
                      ? 'border-indigo-300 bg-indigo-50/70'
                      : 'border-white/70 bg-white/80 hover:border-indigo-200 hover:bg-slate-50/70',
                  )}
                >
                  <Checkbox checked={isSelected} onCheckedChange={() => toggle(role.id)} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-slate-800">{role.name}</span>
                      {isProtectedRole(role.name) && (
                        <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">
                          Protected
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] text-slate-500">
                        {role.type === 'Custom' ? 'Custom' : 'System'}
                      </Badge>
                    </div>
                    {role.description && (
                      <p className="truncate text-xs text-muted-foreground">{role.description}</p>
                    )}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {countPermissions(role.permissions)} permissions
                      {usage ? ` · ${usage.total} user${usage.total === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  {isSelected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />}
                </label>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Project selection
 * ---------------------------------------------------------------------------------------------- */

const projectLabel = (project: Project): string => project.projectName || project.siteCode || project.id;

/**
 * A search-as-you-pop combobox rather than a wall of pill buttons. With a few hundred projects a flat
 * `flex-wrap` of buttons ran to several visual rows before anyone had chosen anything — the picker
 * itself was the largest thing on the form. Collapsing it into one trigger, opened on demand, means
 * the form's size reflects what has been picked, not how many projects exist to pick from; the chips
 * below the trigger are the "good view" of the selection, each removable without reopening the popover.
 */
export function ProjectPicker({
  projects,
  selectedIds,
  onSelectionChange,
  placeholder = 'Add a project…',
}: {
  projects: Project[];
  selectedIds: string[];
  onSelectionChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const sorted = useMemo(
    () => [...projects].sort((a, b) => projectLabel(a).localeCompare(projectLabel(b))),
    [projects],
  );
  const selectedProjects = useMemo(
    () => selectedIds.map((id) => projects.find((project) => project.id === id)).filter((project): project is Project => !!project),
    [selectedIds, projects],
  );

  const toggle = (projectId: string) => {
    onSelectionChange(
      selected.has(projectId) ? selectedIds.filter((id) => id !== projectId) : [...selectedIds, projectId],
    );
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between sm:w-auto sm:min-w-[18rem]"
          >
            <span className="flex items-center gap-1.5 text-slate-600">
              <FolderKanban className="h-4 w-4 text-slate-400" />
              {selectedIds.length > 0
                ? `${selectedIds.length} project${selectedIds.length === 1 ? '' : 's'} selected`
                : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[20rem] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search projects or sites…" />
            <CommandList>
              <CommandEmpty>No project matches.</CommandEmpty>
              <CommandGroup>
                <ScrollArea className="h-64">
                  {sorted.map((project) => {
                    const isSelected = selected.has(project.id);
                    return (
                      <CommandItem
                        key={project.id}
                        value={`${projectLabel(project)} ${project.id}`}
                        onSelect={() => toggle(project.id)}
                      >
                        <Check
                          className={cn('mr-2 h-4 w-4 shrink-0 text-indigo-600', isSelected ? 'opacity-100' : 'opacity-0')}
                        />
                        <span className="truncate">{projectLabel(project)}</span>
                      </CommandItem>
                    );
                  })}
                </ScrollArea>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedProjects.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-white/70 bg-white/70 p-2">
          {selectedProjects.map((project) => (
            <Badge
              key={project.id}
              variant="outline"
              className="flex items-center gap-1 border-emerald-200 bg-emerald-50 py-1 pl-2 pr-1 text-xs text-emerald-700"
            >
              <FolderKanban className="h-3 w-3 shrink-0" />
              <span className="max-w-[14rem] truncate">{projectLabel(project)}</span>
              <button
                type="button"
                onClick={() => toggle(project.id)}
                aria-label={`Remove ${projectLabel(project)}`}
                className="rounded-full p-0.5 hover:bg-emerald-100"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No projects selected — this template will not scope to any site.</p>
      )}
    </div>
  );
}
