'use client';

/**
 * Pick participants by typing: people, teams and departments in one box (2026-11-06 redesign).
 *
 * The *selection* is what is stored, exactly as with the older tabbed `ParticipantSelector`: a
 * department stays a department, so next month's follow-up invites whoever is in it then. The
 * expansion underneath (`expandParticipantSelection`, passed in by the form) is what will actually be
 * written, duplicates already removed.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Building2, Search, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OfficeHubPerson, OfficeHubTeam, ParticipantExpansion, ParticipantSelection } from '@/lib/office-hub';
import { Avatar } from './meeting-form-parts';
import { FieldError } from './ui';

type Kind = 'person' | 'team' | 'department';

interface Option {
  kind: Kind;
  id: string;
  name: string;
  detail: string;
}

const BUCKETS = {
  person: ['userIds', 'optionalUserIds'],
  team: ['teamIds', 'optionalTeamIds'],
  department: ['departmentIds', 'optionalDepartmentIds'],
} as const;

export function ParticipantPicker({
  selection,
  onChange,
  organizerId,
  directory,
  viewer,
  expansion,
  isBusy,
  error,
}: {
  selection: ParticipantSelection;
  onChange: (next: ParticipantSelection) => void;
  organizerId: string | null;
  /** Office Hub's directory (from `useOfficeHub`), passed in so the picker holds no context of its own. */
  directory: {
    people: OfficeHubPerson[];
    teams: Pick<OfficeHubTeam, 'id' | 'name' | 'memberCount' | 'status'>[];
    departments: { id: string; name: string; status?: string }[];
  };
  viewer: { userId: string; departmentId?: string | null; departmentName?: string | null; teamIds?: string[] };
  expansion: ParticipantExpansion;
  /** Whether someone is in another meeting at the chosen time; null while that is unknown. */
  isBusy: (userId: string) => boolean | null;
  error?: string | null;
}) {
  const viewerId = viewer.userId || null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Close on a click anywhere else. Registered only while open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const peopleById = useMemo(() => new Map(directory.people.map((person) => [person.userId, person])), [directory.people]);
  const headcount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of directory.people) {
      if (person.departmentId) counts.set(person.departmentId, (counts.get(person.departmentId) ?? 0) + 1);
    }
    return counts;
  }, [directory.people]);

  const options = useMemo<Option[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
    const people = directory.people
      .filter(
        (person) =>
          person.userId !== organizerId &&
          !selection.userIds.includes(person.userId) &&
          matches(`${person.name} ${person.designation ?? ''} ${person.departmentName ?? ''} ${person.employeeId ?? ''}`),
      )
      .slice(0, needle ? 8 : 6)
      .map<Option>((person) => ({
        kind: 'person',
        id: person.userId,
        name: person.name,
        detail: [person.designation, person.departmentName].filter(Boolean).join(' · ') || 'No department',
      }));
    const teams = directory.teams
      .filter((team) => team.status !== 'Archived' && !selection.teamIds.includes(team.id) && matches(team.name))
      .slice(0, 5)
      .map<Option>((team) => ({
        kind: 'team',
        id: team.id,
        name: team.name,
        detail: `Team · ${team.memberCount} member${team.memberCount === 1 ? '' : 's'}`,
      }));
    const departments = directory.departments
      .filter((department) => !selection.departmentIds.includes(department.id) && matches(department.name))
      .slice(0, 5)
      .map<Option>((department) => {
        const count = headcount.get(department.id) ?? 0;
        return {
          kind: 'department',
          id: department.id,
          name: department.name,
          detail: `Department · ${count} ${count === 1 ? 'person' : 'people'}${
            department.status && department.status !== 'Active' ? ' · inactive' : ''
          }`,
        };
      });
    return [...people, ...teams, ...departments];
  }, [query, directory, organizerId, selection.userIds, selection.teamIds, selection.departmentIds, headcount]);

  const add = (kind: Kind, id: string) => {
    const [main] = BUCKETS[kind];
    if (selection[main].includes(id)) return;
    onChange({ ...selection, [main]: [...selection[main], id] });
  };

  const remove = (kind: Kind, id: string) => {
    const [main, optional] = BUCKETS[kind];
    onChange({
      ...selection,
      [main]: selection[main].filter((entry) => entry !== id),
      [optional]: (selection[optional] ?? []).filter((entry) => entry !== id),
    });
  };

  const toggleOptional = (kind: Kind, id: string) => {
    const [, optional] = BUCKETS[kind];
    const current = selection[optional] ?? [];
    onChange({ ...selection, [optional]: current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id] });
  };

  const choose = (option: Option) => {
    add(option.kind, option.id);
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      // Never submit the form from here: Enter picks the highlighted entry.
      event.preventDefault();
      const option = options[active];
      if (open && option) choose(option);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((current) => Math.min(current + 1, Math.max(0, options.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Backspace' && !query) {
      const lastPerson = [...selection.userIds].reverse().find((id) => id !== organizerId);
      if (lastPerson) remove('person', lastPerson);
      else if (selection.departmentIds.length) remove('department', selection.departmentIds[selection.departmentIds.length - 1]);
      else if (selection.teamIds.length) remove('team', selection.teamIds[selection.teamIds.length - 1]);
    }
  };

  /* ── tags ── */
  const optionalSet = (kind: Kind) => new Set(selection[BUCKETS[kind][1]] ?? []);
  const optionalTeams = optionalSet('team');
  const optionalDepartments = optionalSet('department');
  const optionalPeople = optionalSet('person');
  const organizer = organizerId ? peopleById.get(organizerId) : null;
  const otherPeople = selection.userIds.filter((id) => id !== organizerId);

  const quickAdd = useMemo(() => {
    const entries: { kind: Kind; id: string; label: string }[] = [];
    if (viewer.departmentId && !selection.departmentIds.includes(viewer.departmentId)) {
      entries.push({ kind: 'department', id: viewer.departmentId, label: `${viewer.departmentName ?? 'My'} department` });
    }
    for (const team of directory.teams) {
      if (entries.length >= 4) break;
      if ((viewer.teamIds ?? []).includes(team.id) && team.status !== 'Archived' && !selection.teamIds.includes(team.id)) {
        entries.push({ kind: 'team', id: team.id, label: team.name });
      }
    }
    return entries;
  }, [viewer.departmentId, viewer.departmentName, viewer.teamIds, directory.teams, selection.departmentIds, selection.teamIds]);

  const groupsChosen = selection.teamIds.length + selection.departmentIds.length > 0;
  const required = expansion.participants.filter((participant) => participant.attendanceRole === 'Required').length;
  const optionalCount = expansion.participants.length - required;
  const activeId = open && options[active] ? `${listId}-${active}` : undefined;

  return (
    <div id="oh-who-picker" className="scroll-mt-24">
      <div ref={rootRef} className="relative">
        <div
          onClick={() => {
            setOpen(true);
            inputRef.current?.focus();
          }}
          className={cn(
            'flex min-h-[46px] cursor-text flex-wrap items-center gap-1.5 rounded-xl border bg-card px-2 py-1.5 transition-shadow',
            open && 'border-primary/60 ring-[3px] ring-primary/15',
            error && !open && 'border-destructive',
          )}
        >
          {selection.teamIds.map((id) => {
            const team = directory.teams.find((entry) => entry.id === id);
            return (
              <GroupTag
                key={`t-${id}`}
                icon="team"
                name={team?.name ?? 'Unknown team'}
                count={team?.memberCount ?? 0}
                optional={optionalTeams.has(id)}
                onToggle={() => toggleOptional('team', id)}
                onRemove={() => remove('team', id)}
              />
            );
          })}
          {selection.departmentIds.map((id) => {
            const department = directory.departments.find((entry) => entry.id === id);
            return (
              <GroupTag
                key={`d-${id}`}
                icon="department"
                name={department?.name ?? 'Unknown department'}
                count={headcount.get(id) ?? 0}
                optional={optionalDepartments.has(id)}
                onToggle={() => toggleOptional('department', id)}
                onRemove={() => remove('department', id)}
              />
            );
          })}
          {organizer && (
            <span className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 py-0.5 pl-0.5 pr-2.5 text-xs font-bold">
              <Avatar seed={organizer.userId} name={organizer.name} />
              {organizer.name}
              <span className="font-semibold text-muted-foreground">{organizer.userId === viewerId ? '(you, organizer)' : '(organizer)'}</span>
            </span>
          )}
          {otherPeople.map((id) => {
            const person = peopleById.get(id);
            const optional = optionalPeople.has(id);
            return (
              <span
                key={`p-${id}`}
                className={cn(
                  'flex max-w-full items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pl-0.5 pr-1.5 text-xs font-bold',
                  optional && 'border-dashed bg-transparent',
                )}
              >
                <Avatar seed={id} name={person?.name ?? '?'} />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleOptional('person', id);
                  }}
                  title={optional ? 'Optional. Click to make required.' : 'Required. Click to make optional.'}
                  className="min-w-0 truncate text-left"
                >
                  {person?.name ?? 'Former employee'}
                </button>
                {/* Outside the truncating name, so a long name never hides that it is optional. */}
                {optional && <span className="shrink-0 font-semibold text-muted-foreground">optional</span>}
                <button
                  type="button"
                  aria-label={`Remove ${person?.name ?? 'this person'}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    remove('person', id);
                  }}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            );
          })}
          <span className="flex min-w-[10rem] flex-1 items-center gap-1.5 px-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-label="Add people, teams or departments"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder="Add people, teams or departments…"
              className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
          </span>
        </div>

        {open && (
          <div
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-80 overflow-auto rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
          >
            {options.length === 0 && (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">
                {query ? 'Nobody, no team and no department matches that.' : 'Everyone is already invited.'}
              </p>
            )}
            {(['person', 'team', 'department'] as const).map((kind) => {
              const group = options.map((option, index) => ({ option, index })).filter(({ option }) => option.kind === kind);
              if (!group.length) return null;
              return (
                <div key={kind}>
                  <h6 className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {kind === 'person' ? 'People' : kind === 'team' ? 'Teams' : 'Departments'}
                  </h6>
                  {group.map(({ option, index }) => {
                    const busy = option.kind === 'person' ? isBusy(option.id) : null;
                    return (
                      <div
                        key={`${option.kind}-${option.id}`}
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={index === active}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => choose(option)}
                        onMouseEnter={() => setActive(index)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5',
                          index === active && 'bg-muted',
                        )}
                      >
                        {option.kind === 'person' ? (
                          <Avatar seed={option.id} name={option.name} size={28} />
                        ) : (
                          <span
                            aria-hidden
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white"
                            style={{ background: option.kind === 'team' ? '#4f46e5' : '#0891b2' }}
                          >
                            {option.kind === 'team' ? <Users className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-[12.5px] leading-tight">{option.name}</b>
                          <small className="block truncate text-[11px] text-muted-foreground">{option.detail}</small>
                        </span>
                        {busy === true && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-px text-[11px] font-bold text-amber-800">Busy then</span>
                        )}
                        {busy === false && (
                          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-px text-[11px] font-bold text-emerald-700">Free</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <FieldError message={error} />

      {quickAdd.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-bold text-muted-foreground">Quick add:</span>
          {quickAdd.map((entry) => (
            <button
              key={`${entry.kind}-${entry.id}`}
              type="button"
              onClick={() => add(entry.kind, entry.id)}
              className="rounded-full border border-dashed px-2.5 py-0.5 text-xs font-bold text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="flex">
          {expansion.participants.slice(0, 8).map((participant, index) => (
            <Avatar
              key={participant.userId}
              seed={participant.userId}
              name={participant.name}
              size={24}
              className={cn('border-2 border-card', index > 0 && '-ml-1.5')}
            />
          ))}
        </span>
        <b className="text-foreground">
          {expansion.participants.length} participant{expansion.participants.length === 1 ? '' : 's'}
        </b>
        {optionalCount > 0 && <span>· {required} required, {optionalCount} optional</span>}
        {groupsChosen && <span>· teams and departments expanded, duplicates removed</span>}
      </div>
      {(otherPeople.length > 0 || groupsChosen) && (
        <p className="mt-1 text-[11px] text-muted-foreground">Click a name to make it optional: optional people are invited but not expected.</p>
      )}
      {expansion.warnings.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {expansion.warnings.map((warning) => (
            <li key={warning} className="text-[11px] text-amber-800">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupTag({
  icon,
  name,
  count,
  optional,
  onToggle,
  onRemove,
}: {
  icon: 'team' | 'department';
  name: string;
  count: number;
  optional: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const Icon = icon === 'team' ? Users : Building2;
  return (
    <span
      className={cn(
        'flex max-w-full items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 py-0.5 pl-0.5 pr-1.5 text-xs font-bold text-blue-900',
        optional && 'border-dashed bg-transparent text-foreground',
      )}
    >
      <span
        aria-hidden
        className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] text-white"
        style={{ background: icon === 'team' ? '#4f46e5' : '#0891b2' }}
      >
        <Icon className="h-3 w-3" />
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        title={optional ? 'Optional. Click to make required.' : 'Required. Click to make optional.'}
        className="min-w-0 truncate text-left"
      >
        {name} · {count}
      </button>
      {optional && <span className="shrink-0 font-semibold text-muted-foreground">optional</span>}
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="rounded-full p-0.5 opacity-70 hover:bg-blue-100 hover:opacity-100"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}
