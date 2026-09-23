'use client';

import { useMemo, useState } from 'react';
import { Building2, Check, HardHat, Plus, Shield, User as UserIcon, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HrDataList, type HrListColumn } from '@/components/hr/hr-ui';
import { cn } from '@/lib/utils';
import {
  describeEApprovalAssignment,
  type EApprovalAssignment,
  type EApprovalDepartmentMode,
  type EApprovalProjectMode,
} from '@/lib/e-approval';
import {
  personJobTitle,
  personSearchText,
  resolveDesignation,
} from '@/lib/people-directory';
import type { User } from '@/lib/types';
import type { EApprovalDirectory } from './hooks';

/**
 * Builds the `EApprovalAssignment` list every routing decision needs — a person, a department, a
 * project post or a role (spec section 11).
 *
 * Names are captured alongside ids at selection time, because the engine denormalises them onto the
 * step: history has to still read "Approved by Sarika Palo (Finance Manager)" after that user is
 * deactivated, and a step that stored only an id would render as a blank.
 *
 * What is captured alongside the name is the person's **designation** — their job title, from the
 * greytHR-synced employee record — and not `users.role`, which is the permission bundle an
 * administrator attached to the login. The two are different facts and only one of them belongs in a
 * sentence a human reads. Rows with no linked HR record still show the role, because a blank line
 * under a name looks like a bug (see `src/lib/people-directory.ts`).
 *
 * Two entries in each of the Department and Project lists carry **no id on purpose** — "the request's
 * own department", "the request's own project". Those are the ones that make a workflow reusable: a
 * stage bound to the project in front of it reaches the right site in-charge on every site, where a
 * stage naming a person reaches the same person regardless of where the work is.
 */
export function AssigneePicker({
  directory,
  value,
  onChange,
  multiple = false,
  label = 'Send to',
  allowDepartment = true,
  allowDesignation = true,
  allowRequester = false,
  allowProject = true,
  /** Off on the request form, where the request's own project is already known and picked. */
  allowDynamic = true,
  disabled,
}: {
  directory: EApprovalDirectory;
  value: EApprovalAssignment[];
  onChange: (next: EApprovalAssignment[]) => void;
  multiple?: boolean;
  label?: string;
  allowDepartment?: boolean;
  allowDesignation?: boolean;
  allowRequester?: boolean;
  allowProject?: boolean;
  allowDynamic?: boolean;
  disabled?: boolean;
}) {
  const [kind, setKind] = useState<EApprovalAssignment['kind']>('User');
  const [search, setSearch] = useState('');
  const [departmentMode, setDepartmentMode] = useState<EApprovalDepartmentMode>('Anyone');
  const [projectMode, setProjectMode] = useState<EApprovalProjectMode>('Role');
  const [projectRole, setProjectRole] = useState('');

  const keyOf = (entry: EApprovalAssignment) => {
    switch (entry.kind) {
      case 'User':
        return `User:${entry.userId ?? ''}`;
      case 'Department':
        return `Department:${entry.departmentId ?? 'SELF'}:${entry.departmentMode ?? 'Anyone'}`;
      case 'Project':
        return `Project:${entry.projectId ?? 'SELF'}:${entry.projectMode ?? 'Head'}:${(entry.projectRole ?? '').toLowerCase()}`;
      case 'Designation':
        return `Designation:${entry.designation ?? ''}`;
      case 'Role':
        return `Role:${entry.role ?? ''}`;
      default:
        return 'Requester';
    }
  };

  const chosenKeys = useMemo(() => new Set(value.map(keyOf)), [value]);

  const add = (assignment: EApprovalAssignment) => {
    if (chosenKeys.has(keyOf(assignment))) return;
    onChange(multiple ? [...value, assignment] : [assignment]);
    setSearch('');
  };

  const remove = (index: number) => onChange(value.filter((_, position) => position !== index));

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = term
      ? directory.users.filter((row) => personSearchText(row).includes(term))
      : directory.users;
    // The directory arrives A→Z, so the cap is the first 60 alphabetically rather than an arbitrary
    // 60 — and typing narrows the list instead of shuffling which slice of it you get.
    return rows.slice(0, 60);
  }, [directory.users, search]);

  const filteredDepartments = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? directory.departments.filter((row) => row.name?.toLowerCase().includes(term)) : directory.departments;
  }, [directory.departments, search]);

  /**
   * The greytHR job titles, not the ERP roles.
   *
   * This tab has always been labelled "Designation" and has always listed `directory.roles` — the
   * permission bundles — so it offered "Default", "Office Hub" and a handful of people's own names
   * as things to address an approval to. `directory.designations` is the list it was describing.
   */
  const filteredDesignations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? directory.designations.filter((row) => row.toLowerCase().includes(term))
      : directory.designations;
  }, [directory.designations, search]);

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? directory.projects.filter((row) => row.projectName?.toLowerCase().includes(term))
      : directory.projects;
  }, [directory.projects, search]);

  /**
   * Every post name any project has configured.
   *
   * Offered as suggestions rather than a closed list, because a post is matched by name at build time
   * and typing "Project manager" where the routing says "Project Manager" would silently miss — the
   * suggestions exist to stop that, not to stop somebody adding the first "QA/QC Head".
   */
  const knownProjectRoles = useMemo(
    () =>
      Array.from(
        new Set(
          directory.projectRouting.flatMap((row) => (row.roleHolders ?? []).map((holder) => holder.role.trim())),
        ),
      )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [directory.projectRouting],
  );

  const choosePerson = (row: User) =>
    add({
      kind: 'User',
      userId: row.id,
      userName: row.name,
      // The job title only — never the department or email `personSubtitle` would fall back to.
      // This is denormalised onto the step and read back as "Approved by X (Y)" long after the
      // user record has changed.
      designation: personJobTitle(row) || undefined,
    });

  /**
   * Name, designation, location, employee ID — the four facts that identify a colleague.
   *
   * All four come off the row itself: `AuthProvider` joined the greytHR record onto the directory
   * once, so nothing here reads a database or needs the index passed down.
   */
  const personColumns: HrListColumn<User>[] = [
    {
      header: 'Name',
      mobile: 'title',
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{row.name || row.email}</span>
          {chosenKeys.has(`User:${row.id}`) && (
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Already added" />
          )}
        </span>
      ),
    },
    {
      header: 'Designation',
      mobile: 'title',
      cell: (row) => {
        const { designation, source } = resolveDesignation(row);
        return designation ? (
          <span className="truncate">{designation}</span>
        ) : (
          // Named rather than left blank: an empty cell reads as a rendering fault, where "not in
          // greytHR" is a fact about the account — usually a contractor or a service login.
          <span className="text-muted-foreground/70">{source === 'none' ? 'Not in greytHR' : '—'}</span>
        );
      },
    },
    {
      header: 'Location',
      mobile: 'detail',
      cell: (row) => resolveDesignation(row).location ?? <span className="text-muted-foreground/70">—</span>,
    },
    {
      header: 'Emp ID',
      mobile: 'detail',
      className: 'font-mono text-[11px]',
      cell: (row) => resolveDesignation(row).employeeCode ?? <span className="font-sans text-muted-foreground/70">—</span>,
    },
  ];

  const nothingMatches =
    (kind === 'Department' && !filteredDepartments.length && !allowDynamic) ||
    (kind === 'Project' && !filteredProjects.length && !allowDynamic) ||
    (kind === 'Designation' && !filteredDesignations.length);

  const iconFor = (assignment: EApprovalAssignment) =>
    assignment.kind === 'User' ? (
      <UserIcon className="h-3 w-3" />
    ) : assignment.kind === 'Department' ? (
      <Building2 className="h-3 w-3" />
    ) : assignment.kind === 'Project' ? (
      <HardHat className="h-3 w-3" />
    ) : (
      <Shield className="h-3 w-3" />
    );

  const addProject = (projectId?: string, projectName?: string) =>
    add({
      kind: 'Project',
      projectId,
      projectName,
      projectMode,
      projectRole: projectMode === 'Role' ? projectRole.trim() : undefined,
    });

  return (
    <div className="space-y-2">
      {/* An empty label means the surrounding section already names this control. */}
      {label !== '' && (
        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      )}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((assignment, index) => (
            <Badge key={`${keyOf(assignment)}-${index}`} variant="secondary" className="gap-1 py-1 pl-2 pr-1">
              {iconFor(assignment)}
              <span className="max-w-[180px] truncate">{describeEApprovalAssignment(assignment)}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="rounded-full p-0.5 hover:bg-black/10"
                  aria-label={`Remove ${describeEApprovalAssignment(assignment)}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="rounded-lg border bg-muted/20 p-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={kind === 'User' ? 'default' : 'outline'}
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setKind('User')}
            >
              <UserIcon className="h-3.5 w-3.5" /> Person
            </Button>
            {allowDepartment && (
              <Button
                type="button"
                size="sm"
                variant={kind === 'Department' ? 'default' : 'outline'}
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setKind('Department')}
              >
                <Building2 className="h-3.5 w-3.5" /> Department
              </Button>
            )}
            {allowProject && (
              <Button
                type="button"
                size="sm"
                variant={kind === 'Project' ? 'default' : 'outline'}
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setKind('Project')}
              >
                <HardHat className="h-3.5 w-3.5" /> Project
              </Button>
            )}
            {allowDesignation && (
              <Button
                type="button"
                size="sm"
                variant={kind === 'Designation' ? 'default' : 'outline'}
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setKind('Designation')}
              >
                <Shield className="h-3.5 w-3.5" /> Designation
              </Button>
            )}
            {allowRequester && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => add({ kind: 'Requester' })}
              >
                <Plus className="h-3.5 w-3.5" /> Requester
              </Button>
            )}
          </div>

          {kind === 'Department' && (
            <div className="mt-2">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                How the department picks it up
              </Label>
              <Select
                value={departmentMode}
                onValueChange={(next) => setDepartmentMode(next as EApprovalDepartmentMode)}
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Anyone">Anyone in the department can take it</SelectItem>
                  <SelectItem value="Head">Route to the department head</SelectItem>
                  <SelectItem value="Queue">Hold in the department queue for assignment</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {kind === 'Project' && (
            <div className="mt-2 space-y-2">
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Who on the project this reaches
                </Label>
                <Select value={projectMode} onValueChange={(next) => setProjectMode(next as EApprovalProjectMode)}>
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Role">A named post — different person on each project</SelectItem>
                    <SelectItem value="Head">The project head</SelectItem>
                    <SelectItem value="Anyone">Anyone on the project team</SelectItem>
                    <SelectItem value="Queue">Queued for the project head to assign</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {projectMode === 'Role' && (
                <div>
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Which post
                  </Label>
                  <Input
                    value={projectRole}
                    onChange={(event) => setProjectRole(event.target.value)}
                    placeholder="Project Manager"
                    list="e-approval-project-roles"
                    className="mt-1 h-8 text-xs"
                  />
                  <datalist id="e-approval-project-roles">
                    {knownProjectRoles.map((role) => (
                      <option key={role} value={role} />
                    ))}
                  </datalist>
                  {projectRole.trim() && !knownProjectRoles.some((role) => role.toLowerCase() === projectRole.trim().toLowerCase()) && (
                    <p className="mt-1 text-[10px] text-amber-700">
                      No project has a “{projectRole.trim()}” configured yet — set one under Settings → Project
                      Routing, or the stage will fall back to the project head.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              kind === 'User'
                ? 'Search people…'
                : kind === 'Department'
                  ? 'Search departments…'
                  : kind === 'Project'
                    ? 'Search projects…'
                    : 'Search designations…'
            }
            className="mt-2 h-8 text-xs"
          />

          {/*
            * People get a table; the other three tabs stay a plain list.
            *
            * A person is picked by recognising them, and four facts do that where a name alone does
            * not — this organisation has two people called Sahoo and several titles that differ only
            * by their bracketed suffix. Departments and projects have one identifying field each, so
            * a table around them would be three empty columns.
            *
            * `HrDataList` rather than a hand-rolled `<table>`: it already collapses to one card per
            * person under `sm`, where four columns do not fit. `maxHeightClassName` is its own
            * scroll container with a pinned header — deliberately *not* wrapped in the `ScrollArea`
            * the other tabs use, inside which a sticky header never sticks.
            */}
          {kind === 'User' ? (
            <div className="mt-1.5">
              <HrDataList
                rows={filteredUsers}
                columns={personColumns}
                dense
                maxHeightClassName="sm:max-h-52"
                onRowClick={choosePerson}
                rowClassName={(row) =>
                  cn(
                    'cursor-pointer',
                    chosenKeys.has(`User:${row.id}`) && 'opacity-50',
                  )
                }
                empty={
                  <p className="rounded-md border bg-background px-2 py-6 text-center text-xs text-muted-foreground">
                    Nothing matches that search.
                  </p>
                }
              />
            </div>
          ) : (
            <ScrollArea className="mt-1.5 h-32 rounded-md border bg-background">
              <div className="p-1">
                {/* The dynamic entry sits first because it is the right answer more often than any one
                    named department is: it is what makes a workflow reusable across all of them. */}
                {kind === 'Department' && allowDynamic && !search.trim() && (
                  <button
                    type="button"
                    onClick={() => add({ kind: 'Department', departmentMode })}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded border border-dashed border-sky-300 bg-sky-50/60 px-2 py-1.5 text-left text-xs hover:bg-sky-100/60',
                      chosenKeys.has(`Department:SELF:${departmentMode}`) && 'opacity-50',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-sky-900">The request&rsquo;s own department</span>
                      <span className="block truncate text-[10px] text-sky-700">
                        Resolved when the approval is raised — one workflow serves every department
                      </span>
                    </span>
                    {chosenKeys.has(`Department:SELF:${departmentMode}`) && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    )}
                  </button>
                )}

                {kind === 'Project' && allowDynamic && !search.trim() && (
                  <button
                    type="button"
                    onClick={() => addProject()}
                    disabled={projectMode === 'Role' && !projectRole.trim()}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded border border-dashed border-sky-300 bg-sky-50/60 px-2 py-1.5 text-left text-xs hover:bg-sky-100/60 disabled:opacity-40',
                      chosenKeys.has(
                        `Project:SELF:${projectMode}:${projectRole.trim().toLowerCase()}`,
                      ) && 'opacity-50',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-sky-900">
                        {projectMode === 'Role'
                          ? `${projectRole.trim() || 'The post'} on the request’s project`
                          : 'The request’s own project'}
                      </span>
                      <span className="block truncate text-[10px] text-sky-700">
                        {projectMode === 'Role'
                          ? 'A different person on each project — this is the reusable option'
                          : 'Resolved when the approval is raised'}
                      </span>
                    </span>
                    {chosenKeys.has(`Project:SELF:${projectMode}:${projectRole.trim().toLowerCase()}`) && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    )}
                  </button>
                )}

                {kind === 'Project' &&
                  filteredProjects.map((row) => {
                    const key = `Project:${row.id}:${projectMode}:${projectRole.trim().toLowerCase()}`;
                    const chosen = chosenKeys.has(key);
                    const configured = directory.projectRouting.find((entry) => entry.projectId === row.id);
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => addProject(row.id, row.projectName)}
                        disabled={projectMode === 'Role' && !projectRole.trim()}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-40',
                          chosen && 'opacity-50',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{row.projectName}</span>
                          {!configured && (
                            <span className="block truncate text-[10px] text-amber-700">No routing configured</span>
                          )}
                        </span>
                        {chosen && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                      </button>
                    );
                  })}

                {kind === 'Department' &&
                  filteredDepartments.map((row) => {
                    const chosen = chosenKeys.has(`Department:${row.id}:${departmentMode}`);
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() =>
                          add({
                            kind: 'Department',
                            departmentId: row.id,
                            departmentName: row.name,
                            departmentMode,
                          })
                        }
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted',
                          chosen && 'opacity-50',
                        )}
                      >
                        <span className="truncate font-medium">{row.name}</span>
                        {chosen && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                      </button>
                    );
                  })}

                {kind === 'Designation' &&
                  filteredDesignations.map((row) => {
                    const chosen = chosenKeys.has(`Designation:${row}`);
                    return (
                      <button
                        key={row}
                        type="button"
                        onClick={() => add({ kind: 'Designation', designation: row })}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted',
                          chosen && 'opacity-50',
                        )}
                      >
                        <span className="truncate font-medium">{row}</span>
                        {chosen && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                      </button>
                    );
                  })}

                {nothingMatches && (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing matches that search.</p>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}
