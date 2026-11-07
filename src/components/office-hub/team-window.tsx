'use client';

/**
 * The "Create a team" window (2026-11-07 redesign, from the user's mockup
 * `sel-decisions-actions-teams-redesign.html`); it edits a team too. Members are picked from a grid
 * narrowed by search or by department — with "add everyone in" a department — and the card on the
 * right shows the team as the register will.
 *
 * The rules are the old form's: the leader is always a member and cannot be taken off the team
 * without choosing another leader first; members are written through `normalizeTeamMembers`, and a
 * member who was already on the team keeps their original "added" record. A new team needs a second
 * member (a team of one cannot be invited or assigned as a group); an existing one is not held to it.
 *
 * Archive lives here as well, behind a second click, for whoever holds the Archive grant. Nothing is
 * deleted: the team stops appearing in pickers and keeps its history.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Archive, Loader2, Search, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  firstFieldError,
  normalizeTeamMembers,
  validateTeamInput,
  type OfficeHubFieldErrors,
  type OfficeHubTeam,
  type OfficeHubTeamMember,
} from '@/lib/office-hub';
import { archiveTeam, createTeam, updateTeam } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from './hooks';
import { Avatar } from './meeting-form-parts';
import { PeopleGrid } from './people-grid';
import { TeamCard } from './team-card';
import { FieldError } from './ui';
import { KeyHint, ReadyList, WindowBand, WindowLabel } from './register-parts';

export function TeamWindow({
  team,
  open,
  onOpenChange,
  onSaved,
}: {
  /** The team to edit, or null to create one. Mount with a `key` so the fields reset. */
  team: OfficeHubTeam | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (teamId: string) => void;
}) {
  const { actor, viewer, capabilities, directory, settings, refreshDirectory } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [leaderId, setLeaderId] = useState(team?.leaderId ?? viewer.userId);
  const [departmentId, setDepartmentId] = useState<string | null>(team ? team.departmentId ?? null : viewer.departmentId ?? null);
  const [memberIds, setMemberIds] = useState<string[]>(() => (team ? [...(team.memberUserIds ?? [])] : [viewer.userId]));
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [errors, setErrors] = useState<OfficeHubFieldErrors>({});

  /** Everyone pickable, plus any current member no longer in the directory, so they are not lost. */
  const people = useMemo(() => {
    const known = new Set(directory.people.map((person) => person.userId));
    const missing = (team?.members ?? [])
      .filter((member) => !known.has(member.userId))
      .map((member) => ({ userId: member.userId, name: member.name, designation: member.designation ?? null, departmentId: member.departmentId ?? null, departmentName: member.departmentName ?? null }));
    return [...directory.people, ...missing];
  }, [directory.people, team?.members]);

  const personOf = (userId: string) => people.find((person) => person.userId === userId);
  const leader = personOf(leaderId);
  const members = memberIds.map((userId) => personOf(userId) ?? { userId, name: 'Unknown', departmentName: null, departmentId: null, designation: null });

  const departmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of people) if (person.departmentId) counts.set(person.departmentId, (counts.get(person.departmentId) ?? 0) + 1);
    return counts;
  }, [people]);

  const choices = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return people.filter(
      (person) =>
        (!departmentFilter || person.departmentId === departmentFilter) &&
        (!needle || `${person.name} ${person.designation ?? ''} ${person.departmentName ?? ''}`.toLowerCase().includes(needle)),
    );
  }, [people, search, departmentFilter]);

  const memberDepartments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of members) if (member.departmentName) counts.set(member.departmentName, (counts.get(member.departmentName) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([department]) => department);
  }, [members]);

  const homeDepartment = directory.departments.find((entry) => entry.id === departmentId) ?? null;
  const homeDepartmentName = homeDepartment?.name ?? (departmentId && departmentId === team?.departmentId ? team?.departmentName ?? null : null);

  const toggle = (userId: string) => {
    setNotice(null);
    if (memberIds.includes(userId)) {
      if (userId === leaderId) {
        setNotice('Choose another leader first — the leader is always a member.');
        return;
      }
      setMemberIds(memberIds.filter((entry) => entry !== userId));
    } else {
      setMemberIds([...memberIds, userId]);
    }
    if (errors.members) setErrors((current) => ({ ...current, members: '' }));
  };

  const addDepartment = (id: string) => {
    const everyone = people.filter((person) => person.departmentId === id).map((person) => person.userId);
    setMemberIds(Array.from(new Set([...memberIds, ...everyone])));
  };

  const submit = async () => {
    if (!actor) return;
    const found = validateTeamInput({ name, leaderId, memberUserIds: memberIds });
    if (!team && !found.members && memberIds.length < 2) found.members = 'Add at least one more member.';
    setErrors(found);
    if (Object.keys(found).length) return;

    const leaderName = leader?.name ?? team?.leaderName ?? 'Unknown';
    const nextMembers: OfficeHubTeamMember[] = normalizeTeamMembers(
      memberIds.map((userId) => {
        const existing = team?.members?.find((member) => member.userId === userId);
        if (existing) return existing;
        const person = personOf(userId);
        return {
          userId,
          name: person?.name ?? 'Unknown',
          employeeId: directory.people.find((entry) => entry.userId === userId)?.employeeId ?? null,
          designation: person?.designation ?? null,
          departmentId: person?.departmentId ?? null,
          departmentName: person?.departmentName ?? null,
          addedAt: new Date().toISOString(),
          addedByName: actor.userName,
        };
      }),
      leaderId,
      { name: leaderName },
    );

    const fields = {
      name: name.trim(),
      description: description.trim() || null,
      leaderId,
      leaderName,
      departmentId,
      departmentName: homeDepartmentName,
      members: nextMembers,
    };

    const id = await run(
      async () => {
        if (team) {
          await updateTeam(actor, team.id, fields, { settings });
          return team.id;
        }
        return createTeam(actor, fields, { settings });
      },
      {
        success: `${fields.name} ${team ? 'saved' : 'created'} · ${nextMembers.length} member${nextMembers.length === 1 ? '' : 's'}`,
        failure: 'Could not save the team',
        describe: 'Save team',
      },
    );
    if (!id) return;
    await refreshDirectory();
    onSaved(id);
    onOpenChange(false);
  };

  const archive = async () => {
    if (!actor || !team) return;
    const ok = await run(
      async () => {
        await archiveTeam(actor, team.id);
        return true;
      },
      { success: `${team.name} archived · its meetings and tasks keep their history`, failure: 'Could not archive the team', describe: 'Archive team' },
    );
    if (!ok) return;
    await refreshDirectory();
    onSaved(team.id);
    onOpenChange(false);
  };

  const checks: [boolean, string][] = [
    [Boolean(name.trim()), 'A name'],
    [memberIds.length > 1, 'At least two members'],
    [Boolean(leaderId), 'A leader'],
    [Boolean(description.trim()), 'A short purpose (optional)'],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        className="flex flex-col gap-0 overflow-hidden p-0"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <WindowBand
          tone="teal"
          icon={Users}
          title={team ? `Edit ${team.name}` : 'Create a team'}
          description="A team can draw members from any department. Invite the whole team to a meeting, or assign it a task, and the membership is resolved at that moment."
        />

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── the team ── */}
          <div className="min-w-0 px-5 py-4">
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (errors.name) setErrors((current) => ({ ...current, name: '' }));
              }}
              autoFocus
              placeholder="Team name, e.g. Finance team"
              aria-label="Team name"
              aria-invalid={Boolean(errors.name)}
              className={cn(
                'w-full border-0 border-b-2 bg-transparent pb-2 pt-1 text-lg font-extrabold outline-none transition-colors focus:border-cyan-600',
                errors.name ? 'border-destructive' : 'border-border',
              )}
            />
            <FieldError message={errors.name} />
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this team is for."
              rows={2}
              className="mt-2.5 rounded-xl"
              aria-label="What this team is for"
            />

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <WindowLabel>Team leader</WindowLabel>
                <Select value={leaderId} onValueChange={setLeaderId}>
                  <SelectTrigger className="rounded-[10px]" aria-label="Team leader">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {member.name}
                        {member.userId === viewer.userId ? ' (you)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">Pick from the members below. The leader gets the team&rsquo;s notifications.</p>
              </div>
              <div>
                <WindowLabel>Home department</WindowLabel>
                <Select value={departmentId ?? 'none'} onValueChange={(next) => setDepartmentId(next === 'none' ? null : next)}>
                  <SelectTrigger className="rounded-[10px]" aria-label="Home department">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No department</SelectItem>
                    {departmentId && !homeDepartment && <SelectItem value={departmentId}>{homeDepartmentName ?? 'Current department'}</SelectItem>}
                    {directory.departments.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <WindowLabel action={<span className="text-[11.5px] font-bold text-cyan-700">{memberIds.length} selected</span>}>Members *</WindowLabel>
            <label className="mb-2 flex h-9 items-center gap-2 rounded-[10px] border px-2.5 text-muted-foreground">
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employees by name, designation or department"
                aria-label="Search employees"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              <DepartmentChip on={!departmentFilter} onClick={() => setDepartmentFilter(null)}>
                All
              </DepartmentChip>
              {directory.departments
                .filter((entry) => departmentCounts.get(entry.id))
                .map((entry) => (
                  <DepartmentChip key={entry.id} on={departmentFilter === entry.id} onClick={() => setDepartmentFilter(entry.id)}>
                    {entry.name} · {departmentCounts.get(entry.id)}
                  </DepartmentChip>
                ))}
              {departmentFilter && (
                <button
                  type="button"
                  onClick={() => addDepartment(departmentFilter)}
                  className="rounded-full border border-dashed border-cyan-600 px-2.5 py-0.5 text-[11.5px] font-bold text-cyan-700 hover:bg-cyan-50"
                >
                  + Add everyone in {directory.departments.find((entry) => entry.id === departmentFilter)?.name}
                </button>
              )}
            </div>
            <PeopleGrid people={choices} picked={memberIds} onPick={toggle} viewerId={viewer.userId} leaderId={leaderId} multiple label="Members" />
            {notice && <p className="mt-1 text-xs font-semibold text-amber-700">{notice}</p>}
            <FieldError message={errors.members || errors.leaderId} />
          </div>

          {/* ── the card it will make ── */}
          <aside className="border-t bg-cyan-50/40 p-4 lg:border-l lg:border-t-0">
            <h6 className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">Team card preview</h6>
            <TeamCard
              compact
              name={name}
              description={description}
              toneKey={departmentId ?? team?.id ?? name}
              role={leaderId === viewer.userId ? 'lead' : memberIds.includes(viewer.userId) ? 'member' : null}
              departmentName={homeDepartmentName}
              leader={leader ? { userId: leader.userId, name: leader.name, subtitle: leader.designation ?? null } : null}
              members={members}
              departments={memberDepartments}
            />
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {members.map((member) => (
                <span key={member.userId} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card py-0.5 pl-0.5 pr-2 text-[11.5px] font-bold">
                  <Avatar seed={member.userId} name={member.name} size={20} />
                  <span className="truncate">{member.name}</span>
                  {member.userId !== leaderId && (
                    <button type="button" aria-label={`Remove ${member.name}`} onClick={() => toggle(member.userId)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {memberDepartments.length > 1 && (
              <p className="mt-2 text-[11px] font-semibold text-cyan-700">Cross-department team: {memberDepartments.join(', ')}.</p>
            )}
            <ReadyList title={team ? 'Before you save' : 'Before you create'} items={checks} />
            {firstFieldError(errors) && <p className="mt-2 text-xs font-semibold text-destructive">{firstFieldError(errors)}</p>}
          </aside>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t bg-muted/30 px-5 py-3">
          {team && team.status === 'Active' && capabilities.canArchiveTeam && (
            confirmArchive ? (
              <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-rose-700">
                Archive {team.name}? It leaves the pickers; nothing is deleted.
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmArchive(false)} disabled={isBusy}>
                  Keep it
                </Button>
                <Button type="button" size="sm" variant="destructive" onClick={() => void archive()} disabled={isBusy} className="gap-1.5">
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </Button>
              </span>
            ) : (
              <Button type="button" variant="outline" onClick={() => setConfirmArchive(true)} disabled={isBusy} className="gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800">
                <Archive className="h-4 w-4" />
                Archive team
              </Button>
            )
          )}
          <span className="flex-1" />
          <KeyHint action={team ? 'save' : 'create'} />
          <Button type="button" variant="outline" disabled={isBusy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={isBusy} onClick={() => void submit()} className="gap-1.5 bg-gradient-to-r from-cyan-700 to-blue-600 text-white">
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            {team ? 'Save team' : 'Create team'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold transition-colors',
        on ? 'border-cyan-300 bg-cyan-50 text-cyan-800 dark:text-cyan-200' : 'bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
