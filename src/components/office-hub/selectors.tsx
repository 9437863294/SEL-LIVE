'use client';

/**
 * The pickers every form in the module shares (§78).
 *
 * All of them read the directory from `useOfficeHub`, so none of them fetches — which is what makes
 * it safe to put four of them on one form. `ParticipantSelector` is the interesting one; the rest
 * are thin wrappers that exist so a department picker looks and behaves identically everywhere.
 */

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  expandParticipantSelection,
  isIsoDate,
  type OfficeHubPerson,
  type ParticipantSelection,
  type ResolvedParticipant,
} from '@/lib/office-hub';
import { useOfficeHub } from './hooks';
import { FieldError, PersonChip } from './ui';

/* ── single-value pickers ────────────────────────────────────────────────────────────────────── */

/**
 * One person.
 *
 * A searchable command list rather than a `<select>`: a `<select>` with 300 options is unusable, and
 * the thing people reach for is a name they already know.
 */
export function UserSelector({
  value,
  onChange,
  label,
  placeholder = 'Select an employee',
  error,
  allowClear = true,
  restrictTo,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (userId: string | null, person: OfficeHubPerson | null) => void;
  label?: string;
  placeholder?: string;
  error?: string | null;
  allowClear?: boolean;
  /** Narrow the list, e.g. to a team's members. */
  restrictTo?: readonly string[];
  disabled?: boolean;
}) {
  const { directory } = useOfficeHub();
  const [open, setOpen] = useState(false);

  const people = useMemo(
    () => (restrictTo ? directory.people.filter((person) => restrictTo.includes(person.userId)) : directory.people),
    [directory.people, restrictTo],
  );
  const selected = people.find((person) => person.userId === value) ?? null;

  return (
    <div className="min-w-0">
      {label && <Label className="mb-1 block text-xs">{label}</Label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn('w-full justify-between bg-white font-normal', error && 'border-destructive')}
          >
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected ? selected.name : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,90vw)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search by name, designation or department" />
            <CommandList>
              <CommandEmpty>No matching employee.</CommandEmpty>
              <CommandGroup>
                {allowClear && value && (
                  <CommandItem
                    value="__clear__"
                    onSelect={() => {
                      onChange(null, null);
                      setOpen(false);
                    }}
                  >
                    <X className="mr-2 h-4 w-4 text-muted-foreground" />
                    Clear selection
                  </CommandItem>
                )}
                {people.map((person) => (
                  <CommandItem
                    key={person.userId}
                    // The searchable haystack: name plus the two things people search by instead.
                    value={`${person.name} ${person.designation ?? ''} ${person.departmentName ?? ''} ${person.employeeId ?? ''}`}
                    onSelect={() => {
                      onChange(person.userId, person);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === person.userId ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{person.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[person.designation, person.departmentName].filter(Boolean).join(' · ') || 'No department'}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FieldError message={error} />
    </div>
  );
}

export function DepartmentSelector({
  value,
  onChange,
  label,
  placeholder = 'All departments',
  includeAll = true,
  error,
}: {
  value: string | null | undefined;
  onChange: (departmentId: string | null, name: string | null) => void;
  label?: string;
  placeholder?: string;
  includeAll?: boolean;
  error?: string | null;
}) {
  const { directory } = useOfficeHub();
  return (
    <div className="min-w-0">
      {label && <Label className="mb-1 block text-xs">{label}</Label>}
      <Select
        value={value ?? '__all__'}
        onValueChange={(next) => {
          if (next === '__all__') return onChange(null, null);
          const department = directory.departments.find((entry) => entry.id === next);
          onChange(next, department?.name ?? null);
        }}
      >
        <SelectTrigger className={cn('bg-white', error && 'border-destructive')}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {includeAll && <SelectItem value="__all__">{placeholder}</SelectItem>}
          {directory.departments.map((department) => (
            <SelectItem key={department.id} value={department.id}>
              {department.name}
              {department.status && department.status !== 'Active' ? ' (inactive)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={error} />
    </div>
  );
}

export function TeamSelector({
  value,
  onChange,
  label,
  placeholder = 'No team',
  error,
}: {
  value: string | null | undefined;
  onChange: (teamId: string | null, name: string | null) => void;
  label?: string;
  placeholder?: string;
  error?: string | null;
}) {
  const { directory } = useOfficeHub();
  return (
    <div className="min-w-0">
      {label && <Label className="mb-1 block text-xs">{label}</Label>}
      <Select
        value={value ?? '__none__'}
        onValueChange={(next) => {
          if (next === '__none__') return onChange(null, null);
          const team = directory.teams.find((entry) => entry.id === next);
          onChange(next, team?.name ?? null);
        }}
      >
        <SelectTrigger className={cn('bg-white', error && 'border-destructive')}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{placeholder}</SelectItem>
          {directory.teams.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {team.name} ({team.memberCount})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={error} />
    </div>
  );
}

export function ProjectSelector({
  value,
  onChange,
  label,
  placeholder = 'Not linked to a project',
}: {
  value: string | null | undefined;
  onChange: (projectId: string | null, name: string | null) => void;
  label?: string;
  placeholder?: string;
}) {
  const { directory } = useOfficeHub();
  const [open, setOpen] = useState(false);
  const selected = directory.projects.find((project) => project.id === value) ?? null;

  return (
    <div className="min-w-0">
      {label && <Label className="mb-1 block text-xs">{label}</Label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" className="w-full justify-between bg-white font-normal">
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected ? selected.name : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(24rem,90vw)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search projects" />
            <CommandList>
              <CommandEmpty>No matching project.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange(null, null);
                    setOpen(false);
                  }}
                >
                  <X className="mr-2 h-4 w-4 text-muted-foreground" />
                  {placeholder}
                </CommandItem>
                {directory.projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={project.name}
                    onSelect={() => {
                      onChange(project.id, project.name);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === project.id ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{project.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ── multi-select ────────────────────────────────────────────────────────────────────────────── */

/** A multi-select of arbitrary options, used by every filter panel. */
export function MultiSelect({
  options,
  value,
  onChange,
  label,
  placeholder = 'Any',
  className,
}: {
  options: readonly { value: string; label: string; hint?: string }[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value.length;

  return (
    <div className={cn('min-w-0', className)}>
      {label && <Label className="mb-1 block text-xs">{label}</Label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between bg-white font-normal">
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected === 0
                ? placeholder
                : selected === 1
                  ? options.find((option) => option.value === value[0])?.label ?? '1 selected'
                  : `${selected} selected`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(20rem,90vw)] p-0" align="start">
          <Command>
            {options.length > 8 && <CommandInput placeholder="Filter options" />}
            <CommandList>
              <CommandEmpty>Nothing matches.</CommandEmpty>
              <CommandGroup>
                {selected > 0 && (
                  <CommandItem value="__clear__" onSelect={() => onChange([])}>
                    <X className="mr-2 h-4 w-4 text-muted-foreground" />
                    Clear {selected}
                  </CommandItem>
                )}
                {options.map((option) => {
                  const checked = value.includes(option.value);
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.label}
                      onSelect={() =>
                        onChange(
                          checked ? value.filter((entry) => entry !== option.value) : [...value, option.value],
                        )
                      }
                    >
                      <Checkbox checked={checked} className="mr-2" aria-hidden tabIndex={-1} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{option.label}</span>
                        {option.hint && (
                          <span className="block truncate text-[11px] text-muted-foreground">{option.hint}</span>
                        )}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ── dates ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * A date field.
 *
 * A native `<input type="date">` rather than a custom picker: it is keyboard-accessible for free,
 * it uses the device's own locale and calendar, and on a phone it opens the OS picker, which is
 * better than anything this module could build. The value is `yyyy-MM-dd`, which is exactly the
 * shape the model stores.
 */
export function DateField({
  value,
  onChange,
  label,
  min,
  max,
  error,
  required,
  disabled,
  className,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  label?: string;
  min?: string;
  max?: string;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <Label className="mb-1 block text-xs">
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
      )}
      <Input
        type="date"
        value={value ?? ''}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next && isIsoDate(next) ? next : next ? next : null);
        }}
        className={cn('bg-white', error && 'border-destructive')}
      />
      <FieldError message={error} />
    </div>
  );
}

export function TimeField({
  value,
  onChange,
  label,
  error,
  required,
  disabled,
  className,
}: {
  value: string | null | undefined;
  onChange: (next: string) => void;
  label?: string;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <Label className="mb-1 block text-xs">
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
      )}
      <Input
        type="time"
        value={value ?? ''}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        className={cn('bg-white', error && 'border-destructive')}
      />
      <FieldError message={error} />
    </div>
  );
}

/** A from/to pair, used by every register's filter panel. */
export function DateRangePicker({
  from,
  to,
  onChange,
  label = 'Date range',
}: {
  from: string | null | undefined;
  to: string | null | undefined;
  onChange: (range: { from: string | null; to: string | null }) => void;
  label?: string;
}) {
  return (
    <div className="min-w-0">
      <Label className="mb-1 block text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={from ?? ''}
          // The two bound each other, so the picker itself cannot produce a backwards range.
          max={to ?? undefined}
          onChange={(event) => onChange({ from: event.target.value || null, to: to ?? null })}
          className="bg-white"
          aria-label={`${label} from`}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={to ?? ''}
          min={from ?? undefined}
          onChange={(event) => onChange({ from: from ?? null, to: event.target.value || null })}
          className="bg-white"
          aria-label={`${label} to`}
        />
      </div>
    </div>
  );
}

/* ── the participant selector ────────────────────────────────────────────────────────────────── */

/**
 * Pick participants as people, teams and departments at the same time (§10).
 *
 * The important design decision: the *selection* is stored, not the flattened list of people. A
 * meeting invited "the Finance department" keeps that fact, so the follow-up next month invites
 * whoever is in Finance then — not last month's roster (§84). The flattened list is shown live
 * underneath, via the same `expandParticipantSelection` the service uses at save time, so what the
 * organizer sees is exactly what will be written, duplicates already collapsed.
 */
export function ParticipantSelector({
  selection,
  onChange,
  organizerId,
  error,
}: {
  selection: ParticipantSelection;
  onChange: (next: ParticipantSelection) => void;
  organizerId: string | null;
  error?: string | null;
}) {
  const { directory } = useOfficeHub();
  const [tab, setTab] = useState<'people' | 'teams' | 'departments'>('people');
  const [search, setSearch] = useState('');

  const organizer = useMemo(
    () => directory.people.find((person) => person.userId === organizerId) ?? null,
    [directory.people, organizerId],
  );

  const expansion = useMemo(
    () => expandParticipantSelection(selection, directory, organizer),
    [selection, directory, organizer],
  );

  const toggle = (bucket: 'userIds' | 'teamIds' | 'departmentIds', id: string) => {
    const current = selection[bucket] ?? [];
    const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    onChange({ ...selection, [bucket]: next });
  };

  const toggleOptional = (
    bucket: 'optionalUserIds' | 'optionalTeamIds' | 'optionalDepartmentIds',
    id: string,
  ) => {
    const current = selection[bucket] ?? [];
    const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    onChange({ ...selection, [bucket]: next });
  };

  const filteredPeople = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return directory.people;
    return directory.people.filter((person) =>
      `${person.name} ${person.designation ?? ''} ${person.departmentName ?? ''} ${person.employeeId ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [directory.people, search]);

  const required = expansion.participants.filter((participant) => participant.attendanceRole === 'Required');
  const optional = expansion.participants.filter((participant) => participant.attendanceRole === 'Optional');

  return (
    <div className="space-y-3">
      <Tabs value={tab} onValueChange={(next) => setTab(next as typeof tab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="people" className="text-xs">
            Employees{selection.userIds.length ? ` (${selection.userIds.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="teams" className="text-xs">
            Teams{selection.teamIds.length ? ` (${selection.teamIds.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="departments" className="text-xs">
            Departments{selection.departmentIds.length ? ` (${selection.departmentIds.length})` : ''}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'people' && (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employees"
              className="bg-white pl-8"
              aria-label="Search employees"
            />
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border bg-white p-1.5">
            {filteredPeople.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No matching employee.</p>
            )}
            {filteredPeople.map((person) => {
              const picked = selection.userIds.includes(person.userId);
              const isOrganizer = person.userId === organizerId;
              return (
                <div
                  key={person.userId}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5',
                    picked && 'bg-indigo-50',
                    isOrganizer && 'opacity-70',
                  )}
                >
                  <Checkbox
                    checked={picked || isOrganizer}
                    // The organizer cannot be removed: a meeting whose organizer is not a
                    // participant cannot be joined by them and opens with a missing attendance row.
                    disabled={isOrganizer}
                    onCheckedChange={() => toggle('userIds', person.userId)}
                    aria-label={`Invite ${person.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {person.name}
                      {isOrganizer && <span className="ml-1 text-[11px] text-muted-foreground">(organizer)</span>}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {[person.designation, person.departmentName].filter(Boolean).join(' · ') || 'No department'}
                    </p>
                  </div>
                  {picked && !isOrganizer && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[11px]"
                      onClick={() => toggleOptional('optionalUserIds', person.userId)}
                    >
                      {(selection.optionalUserIds ?? []).includes(person.userId) ? 'Optional' : 'Required'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'teams' && (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border bg-white p-1.5">
          {directory.teams.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No teams yet. Create one to invite a whole group at once.
            </p>
          )}
          {directory.teams.map((team) => {
            const picked = selection.teamIds.includes(team.id);
            return (
              <div key={team.id} className={cn('flex items-center gap-2 rounded-md px-2 py-1.5', picked && 'bg-indigo-50')}>
                <Checkbox
                  checked={picked}
                  onCheckedChange={() => toggle('teamIds', team.id)}
                  aria-label={`Invite ${team.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{team.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {team.memberCount} member{team.memberCount === 1 ? '' : 's'} · led by {team.leaderName}
                  </p>
                </div>
                {picked && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => toggleOptional('optionalTeamIds', team.id)}
                  >
                    {(selection.optionalTeamIds ?? []).includes(team.id) ? 'Optional' : 'Required'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'departments' && (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border bg-white p-1.5">
          {directory.departments.map((department) => {
            const picked = selection.departmentIds.includes(department.id);
            const headcount = directory.people.filter((person) => person.departmentId === department.id).length;
            return (
              <div
                key={department.id}
                className={cn('flex items-center gap-2 rounded-md px-2 py-1.5', picked && 'bg-indigo-50')}
              >
                <Checkbox
                  checked={picked}
                  onCheckedChange={() => toggle('departmentIds', department.id)}
                  aria-label={`Invite the ${department.name} department`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{department.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {headcount} active employee{headcount === 1 ? '' : 's'} with a login
                  </p>
                </div>
                {picked && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => toggleOptional('optionalDepartmentIds', department.id)}
                  >
                    {(selection.optionalDepartmentIds ?? []).includes(department.id) ? 'Optional' : 'Required'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <FieldError message={error} />

      {/* The live expansion: exactly what will be written, duplicates already collapsed. */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Users className="h-4 w-4 text-indigo-600" />
          <p className="text-xs font-semibold text-indigo-900">
            {expansion.participants.length} participant{expansion.participants.length === 1 ? '' : 's'}
            {optional.length > 0 && ` · ${required.length} required, ${optional.length} optional`}
          </p>
        </div>

        {expansion.participants.length === 0 ? (
          <p className="text-xs text-indigo-900/70">Nobody selected yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {expansion.participants.slice(0, 40).map((participant) => (
              <ParticipantChip key={participant.userId} participant={participant} />
            ))}
            {expansion.participants.length > 40 && (
              <Badge variant="outline" className="border-indigo-200 bg-white text-[11px]">
                +{expansion.participants.length - 40} more
              </Badge>
            )}
          </div>
        )}

        {expansion.warnings.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {expansion.warnings.map((warning) => (
              <li key={warning} className="text-[11px] text-amber-800">
                {warning}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ParticipantChip({ participant }: { participant: ResolvedParticipant }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border bg-white text-[11px] font-normal',
        participant.attendanceRole === 'Optional' ? 'border-slate-200 text-slate-500' : 'border-indigo-200 text-slate-700',
      )}
      title={`${participant.name}${participant.sourceName ? ` — via ${participant.sourceName}` : ''}${
        participant.attendanceRole === 'Optional' ? ' (optional)' : ''
      }`}
    >
      {participant.name}
      {participant.source === 'Team' && <span className="ml-1 opacity-60">· team</span>}
      {participant.source === 'Department' && <span className="ml-1 opacity-60">· dept</span>}
    </Badge>
  );
}

/** A compact read-only participant list, for the meeting detail and preparation screens. */
export function ParticipantList({
  participants,
  emptyLabel = 'Nobody invited yet.',
}: {
  participants: readonly { userId: string; name: string; designation?: string | null; departmentName?: string | null }[];
  emptyLabel?: string;
}) {
  if (!participants.length) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="flex flex-wrap gap-3">
      {participants.map((participant) => (
        <PersonChip
          key={participant.userId}
          name={participant.name}
          subtitle={[participant.designation, participant.departmentName].filter(Boolean).join(' · ') || null}
        />
      ))}
    </div>
  );
}
