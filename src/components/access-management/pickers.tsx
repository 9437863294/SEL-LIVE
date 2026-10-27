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
import { Check, ChevronsUpDown, FolderKanban, KeyRound, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilterBar, SearchInput } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { HrDataList, type HrListColumn } from '@/components/hr/hr-ui';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { Department, Employee, Project, Role, User } from '@/lib/types';
import {
  countPermissions,
  detectPrivilegedAccess,
  detectSodConflicts,
  isProtectedRole,
  type EffectiveAccess,
  type RegistryNode,
  type UserAccessGrant,
} from '@/lib/access-control';
import {
  employeeFactsFor,
  personSubtitle,
  type EmployeeFacts,
  type EmployeeFactsIndex,
} from '@/lib/people-directory';
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
  /** Built once by `useAccessDirectory` over both greytHR collections. */
  employeeIndex: EmployeeFactsIndex<EmployeeFacts>;
}

export function filterUsers(context: UserDirectoryContext, filter: UserFilterState): User[] {
  const term = filter.term.trim().toLowerCase();
  const employeeIndex = context.employeeIndex;

  return context.users.filter((user) => {
    if (filter.status !== 'all' && (user.status ?? 'Active') !== filter.status) return false;

    const employee = employeeFactsFor(user, employeeIndex);
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
  registry,
  defaultFilter = EMPTY_USER_FILTER,
  trailing,
  className,
}: {
  filter: UserFilterState;
  onChange: (next: UserFilterState) => void;
  context: UserDirectoryContext;
  /** When provided, offers §29's filter-by-permission ("who can approve bank guarantees?"). */
  registry?: RegistryNode[];
  /**
   * The bar's resting state — what "no filter in effect" means for the count on the Filters button.
   * The Users tab starts on all statuses, so for it `status: 'all'` is the baseline, not a filter.
   */
  defaultFilter?: UserFilterState;
  /**
   * Rendered at the end of the bar (the `FilterBar`'s actions) — the user picker puts its selection
   * summary and "Select all" here, so everything above the list is one bar.
   */
  trailing?: React.ReactNode;
  className?: string;
}) {
  const set = <K extends keyof UserFilterState>(key: K, value: UserFilterState[K]) =>
    onChange({ ...filter, [key]: value });

  // Filters in effect, measured against the bar's resting state — the count on the phone
  // "Filters (n)" toggle and what enables Clear. The search box is not counted.
  const activeCount = (Object.keys(filter) as Array<keyof UserFilterState>).filter(
    (key) => key !== 'term' && filter[key] !== defaultFilter[key],
  ).length;

  return (
    <FilterBar
      className={className}
      search={{
        value: filter.term,
        onChange: (value) => set('term', value),
        // Short enough to read whole in the box; department and designation are searched too.
        placeholder: 'Name, ID, email, phone…',
        label: 'Search users by name, employee ID, email, phone, department or designation',
      }}
      activeCount={activeCount}
      // Back to the resting state, not to empty: the Users tab rests on all statuses.
      onClear={() => onChange({ ...defaultFilter, term: '' })}
      actions={trailing}
    >
      <Select value={filter.status} onValueChange={(value) => set('status', value as UserFilterState['status'])}>
        <SelectTrigger aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="Active">Active only</SelectItem>
          <SelectItem value="Inactive">Inactive only</SelectItem>
          <SelectItem value="all">All statuses</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filter.departmentId} onValueChange={(value) => set('departmentId', value)}>
        <SelectTrigger aria-label="Department"><SelectValue placeholder="Department" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All departments</SelectItem>
          {context.departments.map((department) => (
            <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filter.designation} onValueChange={(value) => set('designation', value)}>
        <SelectTrigger aria-label="Designation"><SelectValue placeholder="Designation" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All designations</SelectItem>
          {context.designations.map((designation) => (
            <SelectItem key={designation} value={designation}>{designation}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filter.roleName} onValueChange={(value) => set('roleName', value)}>
        <SelectTrigger aria-label="Role"><SelectValue placeholder="Role" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All roles</SelectItem>
          {context.roles.map((role) => (
            <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filter.projectId} onValueChange={(value) => set('projectId', value)}>
        <SelectTrigger aria-label="Project / site"><SelectValue placeholder="Project / site" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All projects</SelectItem>
          {context.projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.projectName || project.siteCode || project.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {registry && (
        <PermissionPairFilter
          registry={registry}
          value={filter.permissionPair}
          onChange={(pair) => set('permissionPair', pair)}
        />
      )}
    </FilterBar>
  );
}

/**
 * "Who holds this exact permission?" — a combobox over the ~1,200-leaf registry.
 *
 * Items only render once the search has two characters: mounting every resource × action pair
 * (several thousand rows) into the popover just to filter them again is what made this feature sit
 * unshipped in the first place.
 */
function PermissionPairFilter({
  registry,
  value,
  onChange,
}: {
  registry: RegistryNode[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const queryReady = search.trim().replace(/\s+/g, '').length >= 2;
  const matches = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens.join('').length < 2) return [];
    const rows: Array<{ pair: string; resource: string; action: string }> = [];
    for (const node of registry) {
      for (const action of node.actions) {
        const haystack = `${node.module} ${node.resource} ${node.label} ${action}`.toLowerCase();
        if (tokens.every((token) => haystack.includes(token))) {
          rows.push({ pair: `${node.resource}::${action}`, resource: node.resource, action });
          if (rows.length >= 120) return rows;
        }
      }
    }
    return rows;
  }, [registry, search]);

  const [selectedResource, selectedAction] = value ? value.split('::') : ['', ''];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="truncate">
              {value ? `${selectedResource} · ${selectedAction}` : 'Holding permission…'}
            </span>
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(26rem,90vw)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search a page or action, e.g. bank approve…"
          />
          <CommandList>
            <CommandEmpty>
              {queryReady
                ? 'No permission matches that search.'
                : 'Type at least two characters to search the registry.'}
            </CommandEmpty>
            {value && (
              <CommandGroup>
                <CommandItem
                  value="__clear"
                  onSelect={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  <X className="mr-2 h-3.5 w-3.5" />
                  Any permission (clear filter)
                </CommandItem>
              </CommandGroup>
            )}
            {matches.length > 0 && (
              <CommandGroup>
                {matches.map((row) => (
                  <CommandItem
                    key={row.pair}
                    value={row.pair}
                    onSelect={() => {
                      onChange(row.pair);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('mr-2 h-3.5 w-3.5', value === row.pair ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{row.resource}</span>
                      <span className="block text-[11px] text-muted-foreground">{row.action}</span>
                    </span>
                  </CommandItem>
                ))}
                {matches.length >= 120 && (
                  <p className="px-3 py-1.5 text-[11px] text-muted-foreground">
                    Showing the first 120 — keep typing to narrow it down.
                  </p>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
  registry,
  heightClassName = 'sm:max-h-[24rem]',
  showFilters = true,
}: {
  context: UserDirectoryContext;
  filter: UserFilterState;
  onFilterChange: (next: UserFilterState) => void;
  selectedIds: string[];
  onSelectionChange: (next: string[]) => void;
  /** Forwarded to the filter bar's permission filter; omit to hide that filter. */
  registry?: RegistryNode[];
  /** Max height of the desktop list from `sm` up (`'sm:max-h-[25rem]'`); the header stays pinned while it scrolls. */
  heightClassName?: string;
  showFilters?: boolean;
}) {
  const filtered = useMemo(() => filterUsers(context, filter), [context, filter]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const windowed = filtered.slice(0, USER_WINDOW);

  const employeeIndex = context.employeeIndex;

  const toggle = (userId: string) => {
    onSelectionChange(
      selected.has(userId) ? selectedIds.filter((id) => id !== userId) : [...selectedIds, userId],
    );
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((user) => selected.has(user.id));

  // One column spec for both the desktop table and the phone cards (HrDataList). The checkbox is
  // the card's aside on a phone and the whole card toggles; on a desktop the row does.
  const columns: Array<HrListColumn<User>> = [
    {
      header: '',
      className: 'w-10',
      mobile: 'aside',
      cell: (user) => (
        <span className="inline-flex" onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={selected.has(user.id)}
            onCheckedChange={() => toggle(user.id)}
            aria-label={`Select ${user.name || user.email}`}
          />
        </span>
      ),
    },
    {
      header: 'Name',
      mobile: 'title',
      cell: (user) => {
        const access = context.accessByUser[user.id];
        const employee = employeeFactsFor(user, employeeIndex);
        return (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:whitespace-nowrap">
              <span className="font-semibold text-slate-800">{user.name || user.email}</span>
              {/* Job title, not role: the Roles column two along already says what they may do. */}
              {personSubtitle(user, employeeIndex) && (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {personSubtitle(user, employeeIndex)}
                </span>
              )}
              {(user.status ?? 'Active') !== 'Active' && <StatusBadge status="Inactive" />}
              {access && (
                <RiskBadges
                  privileges={detectPrivilegedAccess(access)}
                  conflicts={detectSodConflicts(access)}
                  className="sm:flex-nowrap"
                />
              )}
            </div>
            {/* The contact line lives here on a phone (a card's two-column detail grid would truncate it). */}
            {/* The contact line, minus the designation the title line above now carries. */}
            <p className="mt-0.5 break-words text-xs font-normal text-muted-foreground sm:hidden">
              {[user.email, employee?.employeeId, employee?.department].filter(Boolean).join(' · ')}
            </p>
          </div>
        );
      },
    },
    {
      header: 'Contact',
      mobile: 'omit',
      className: 'max-w-[16rem] truncate',
      cell: (user) => {
        const employee = employeeFactsFor(user, employeeIndex);
        return [user.email, employee?.employeeId, employee?.department, employee?.designation].filter(Boolean).join(' · ');
      },
    },
    {
      header: 'Roles',
      cell: (user) => {
        const grant = context.grants[user.id];
        return (
          <div className="flex flex-wrap items-center gap-1 sm:flex-nowrap sm:whitespace-nowrap">
            {user.role && <RoleBadge name={user.role} kind="base" />}
            {(grant?.additionalRoles ?? []).slice(0, 3).map((assignment) => (
              <RoleBadge key={assignment.roleId} name={assignment.roleName} kind="additional" />
            ))}
            {(grant?.additionalRoles?.length ?? 0) > 3 && (
              <Badge variant="neutral">+{(grant?.additionalRoles?.length ?? 0) - 3}</Badge>
            )}
          </div>
        );
      },
    },
    {
      header: 'Permissions',
      align: 'right',
      className: 'tabular-nums',
      cell: (user) => {
        const access = context.accessByUser[user.id];
        return access ? countPermissions(access.permissions) : '—';
      },
    },
  ];

  /** "0 selected · 36 match the filter · Select all 36 filtered" — shares the filter bar. */
  const selectionControls = (
    <>
      <Badge variant="neutral">{selectedIds.length} selected</Badge>
      <span className="text-xs text-muted-foreground">
        {filtered.length} match the filter
        {filtered.length > windowed.length ? ` · showing first ${windowed.length}` : ''}
      </span>
      <Button
        type="button"
        variant="outline"
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
        // "selection", because the filter bar's own Clear (the filters) sits in the same row.
        <Button type="button" variant="ghost" onClick={() => onSelectionChange([])}>
          Clear selection
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-2.5">
      {showFilters ? (
        <UserFilterBar
          filter={filter}
          onChange={onFilterChange}
          context={context}
          registry={registry}
          trailing={selectionControls}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">{selectionControls}</div>
      )}

      {/*
        A plain box, not a ScrollArea: the list scrolls itself so its header can stay put. The box is
        the frame, so the list inside is frameless (no box in a box); its rows take the app's table
        format and the user's density setting. The tint marks a selected row.
      */}
      <div className="overflow-hidden rounded-xl border border-white/70 bg-white/60">
        {windowed.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Users className="h-8 w-8 text-slate-300" />
            <p className="text-sm text-muted-foreground">No users match these filters.</p>
          </div>
        ) : (
          <div className="p-2 sm:p-0">
            <HrDataList
              rows={windowed}
              columns={columns}
              onRowClick={(user) => toggle(user.id)}
              rowClassName={(user) => (selected.has(user.id) ? 'border-indigo-200 bg-indigo-50/70' : undefined)}
              maxHeightClassName={heightClassName}
              frameless
            />
          </div>
        )}
      </div>
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
  heightClassName = 'sm:h-[18rem]',
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
      <SearchInput
        value={term}
        onChange={setTerm}
        placeholder="Search roles or the permissions they contain…"
        label="Search roles"
      />

      {/*
        A table, one role a row: the numbers line up in their own columns to be compared down the
        list, where cards made them a line of small print under each name. A click anywhere on a row
        selects it. On a phone the type moves under the name, so the name keeps the width to be read;
        from `sm` it is a column of its own and the description joins the name.

        `table-fixed` with set widths for the narrow columns, so the name takes what is left and a
        long description is cut short instead of widening the table past a phone's screen.
      */}
      <Table
        stickyHeader
        className="table-fixed"
        containerClassName={cn('h-auto rounded-xl border border-white/70 bg-white/60', heightClassName)}
      >
        <TableHeader>
          <TableRow>
            <TableHead className="w-9 px-2 sm:px-3">
              <span className="sr-only">Select</span>
            </TableHead>
            <TableHead className="px-2 sm:px-3">Role</TableHead>
            <TableHead className="hidden w-24 px-3 sm:table-cell">Type</TableHead>
            <TableHead className="w-16 px-2 text-right sm:w-28 sm:px-3" title="Permissions">
              <span className="sm:hidden">Perms</span>
              <span className="hidden sm:inline">Permissions</span>
            </TableHead>
            {roleUsage && <TableHead className="w-16 px-2 text-right sm:w-20 sm:px-3">Users</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableEmpty colSpan={roleUsage ? 5 : 4}>No roles match “{term}”.</TableEmpty>
          ) : (
            filtered.map((role) => {
              const isSelected = selected.has(role.id);
              const usage = roleUsage?.[role.name];
              const type = role.type === 'Custom' ? 'Custom' : 'System';
              return (
                <TableRow
                  key={role.id}
                  aria-selected={isSelected}
                  // Forms dark-compat.css already remaps; a `data-[state=selected]:` one it does not.
                  className={cn('cursor-pointer', isSelected && 'bg-indigo-50/70 hover:bg-indigo-50')}
                  onClick={() => toggle(role.id)}
                >
                  <TableCell className="px-2 sm:px-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggle(role.id)}
                      // The row's own click would toggle it a second time.
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Select ${role.name}`}
                    />
                  </TableCell>
                  <TableCell className="px-2 sm:px-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="break-words font-semibold text-slate-800">{role.name}</span>
                      {isProtectedRole(role.name) && <Badge variant="danger">Protected</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground sm:hidden">{type}</div>
                    {role.description && (
                      <div className="hidden truncate text-xs text-muted-foreground sm:block">{role.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="hidden px-3 text-muted-foreground sm:table-cell">{type}</TableCell>
                  <TableCell className="px-2 text-right tabular-nums sm:px-3">{countPermissions(role.permissions)}</TableCell>
                  {roleUsage && (
                    <TableCell className="px-2 text-right tabular-nums sm:px-3">{usage?.total ?? 0}</TableCell>
                  )}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
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
        <PopoverContent
          className="w-[--radix-popover-trigger-width] max-w-[calc(100vw-2rem)] p-0 sm:min-w-[20rem]"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search projects or sites…" />
            <CommandList>
              <CommandEmpty>No project matches.</CommandEmpty>
              <CommandGroup>
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
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedProjects.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-white/70 bg-white/70 p-2">
          {selectedProjects.map((project) => (
            <Badge key={project.id} variant="neutral" className="gap-1 py-1 pl-2 pr-1">
              <FolderKanban className="h-3 w-3 shrink-0" />
              <span className="max-w-[14rem] truncate">{projectLabel(project)}</span>
              <button
                type="button"
                onClick={() => toggle(project.id)}
                aria-label={`Remove ${projectLabel(project)}`}
                className="hr-inline-action inline-flex items-center justify-center rounded-full p-0.5 transition-colors hover:bg-black/10"
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
