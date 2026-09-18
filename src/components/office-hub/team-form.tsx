'use client';

/**
 * The team form and member list (§6).
 *
 * ── Archive, never delete ───────────────────────────────────────────────────────────────────────
 *
 * §6 is explicit: "do not delete historical team information". A team's name appears on every
 * meeting it was invited to and every task assigned to it, and deleting the record would turn all
 * of those into dangling ids. So the only destructive action here is Archive, which sets a status
 * and stops the team being offered in pickers while leaving its history intact — and Restore undoes
 * it.
 *
 * ── The leader is always a member ───────────────────────────────────────────────────────────────
 *
 * `normalizeTeamMembers` guarantees it on every write, and the form shows why: a leader who is not
 * a member would be missing from the team's own task-assignment list and from any meeting invited
 * by team.
 */

import { useMemo, useState } from 'react';
import {
  ArchiveRestore,
  Archive,
  Crown,
  Search,
  UserMinus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  normalizeTeamMembers,
  validateTeamInput,
  type OfficeHubFieldErrors,
  type OfficeHubTeam,
  type OfficeHubTeamMember,
} from '@/lib/office-hub';
import { archiveTeam, createTeam, restoreTeam, updateTeam } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from './hooks';
import { DepartmentSelector, UserSelector } from './selectors';
import { FieldError, OfficeHubEmptyState, PersonChip, officeHubDialog } from './ui';

interface TeamDraft {
  id?: string;
  name: string;
  description: string;
  leaderId: string | null;
  leaderName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  memberUserIds: string[];
}

export function emptyTeamDraft(viewer: { userId: string; name: string; departmentId?: string | null; departmentName?: string | null }): TeamDraft {
  return {
    name: '',
    description: '',
    leaderId: viewer.userId,
    leaderName: viewer.name,
    departmentId: viewer.departmentId ?? null,
    departmentName: viewer.departmentName ?? null,
    memberUserIds: [viewer.userId],
  };
}

export function teamDraftFrom(team: OfficeHubTeam): TeamDraft {
  return {
    id: team.id,
    name: team.name,
    description: team.description ?? '',
    leaderId: team.leaderId,
    leaderName: team.leaderName,
    departmentId: team.departmentId ?? null,
    departmentName: team.departmentName ?? null,
    memberUserIds: [...(team.memberUserIds ?? [])],
  };
}

export function TeamDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: TeamDraft;
  setDraft: (next: TeamDraft) => void;
  onSaved: (teamId: string) => void;
}) {
  const { actor, settings, directory, refreshDirectory } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [errors, setErrors] = useState<OfficeHubFieldErrors>({});
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return directory.people;
    return directory.people.filter((person) =>
      `${person.name} ${person.designation ?? ''} ${person.departmentName ?? ''}`.toLowerCase().includes(needle),
    );
  }, [directory.people, search]);

  const toggle = (userId: string) => {
    const has = draft.memberUserIds.includes(userId);
    // The leader cannot be removed from their own team — the write would put them back anyway.
    if (has && userId === draft.leaderId) return;
    setDraft({
      ...draft,
      memberUserIds: has
        ? draft.memberUserIds.filter((entry) => entry !== userId)
        : [...draft.memberUserIds, userId],
    });
  };

  const save = async () => {
    const found = validateTeamInput(draft);
    setErrors(found);
    if (Object.keys(found).length || !actor || !draft.leaderId || !draft.leaderName) return;

    const members: OfficeHubTeamMember[] = normalizeTeamMembers(
      draft.memberUserIds.map((userId) => {
        const person = directory.people.find((entry) => entry.userId === userId);
        return {
          userId,
          name: person?.name ?? 'Unknown',
          employeeId: person?.employeeId ?? null,
          designation: person?.designation ?? null,
          departmentId: person?.departmentId ?? null,
          departmentName: person?.departmentName ?? null,
          addedAt: new Date().toISOString(),
          addedByName: actor.userName,
        };
      }),
      draft.leaderId,
      { name: draft.leaderName },
    );

    const result = await run<string>(
      async () => {
        if (draft.id) {
          await updateTeam(
            actor,
            draft.id,
            {
              name: draft.name.trim(),
              description: draft.description.trim() || null,
              leaderId: draft.leaderId!,
              leaderName: draft.leaderName!,
              departmentId: draft.departmentId,
              departmentName: draft.departmentName,
              members,
            },
            { settings },
          );
          return draft.id;
        }
        return createTeam(
          actor,
          {
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            leaderId: draft.leaderId!,
            leaderName: draft.leaderName!,
            members,
            departmentId: draft.departmentId,
            departmentName: draft.departmentName,
          },
          { settings },
        );
      },
      { success: draft.id ? 'Team updated' : 'Team created', failure: 'Could not save the team' },
    );

    if (result) {
      await refreshDirectory();
      onOpenChange(false);
      onSaved(result);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={officeHubDialog.contentTall}>
        <DialogHeader className={officeHubDialog.header}>
          <DialogTitle>{draft.id ? 'Edit team' : 'Create a team'}</DialogTitle>
          <DialogDescription>
            A team can draw members from any department. Invite the whole team to a meeting, or
            assign it a task, and the membership is resolved at that moment.
          </DialogDescription>
        </DialogHeader>

        <div className={officeHubDialog.bodyScroll}>
          <div>
            <Label className="mb-1 block text-xs">
              Team name<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="e.g. Finance Team"
              className={cn('bg-white', errors.name && 'border-destructive')}
              autoFocus
            />
            <FieldError message={errors.name} />
          </div>

          <div>
            <Label className="mb-1 block text-xs">Description</Label>
            <Textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              rows={2}
              className="bg-white"
              placeholder="What this team is for."
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UserSelector
              label="Team leader"
              value={draft.leaderId}
              allowClear={false}
              error={errors.leaderId}
              onChange={(userId, person) =>
                setDraft({
                  ...draft,
                  leaderId: userId,
                  leaderName: person?.name ?? null,
                  // The leader is always a member — adding them here saves the user a second step
                  // and the validation message that would otherwise follow.
                  memberUserIds: userId
                    ? Array.from(new Set([...draft.memberUserIds, userId]))
                    : draft.memberUserIds,
                })
              }
            />

            <DepartmentSelector
              label="Home department"
              value={draft.departmentId}
              placeholder="No department"
              onChange={(departmentId, name) => setDraft({ ...draft, departmentId, departmentName: name })}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-xs">
                Members<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <span className="text-[11px] text-muted-foreground">{draft.memberUserIds.length} selected</span>
            </div>

            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employees"
                className="bg-white pl-8"
                aria-label="Search employees"
              />
            </div>

            <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border bg-white p-1.5">
              {filtered.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No matching employee.</p>
              )}
              {filtered.map((person) => {
                const picked = draft.memberUserIds.includes(person.userId);
                const isLeader = person.userId === draft.leaderId;
                return (
                  <label
                    key={person.userId}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                      picked && 'bg-indigo-50',
                      isLeader && 'opacity-80',
                    )}
                  >
                    <Checkbox
                      checked={picked}
                      disabled={isLeader}
                      onCheckedChange={() => toggle(person.userId)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">
                        {person.name}
                        {isLeader && (
                          <Badge variant="outline" className="ml-1.5 border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                            <Crown className="mr-0.5 h-2.5 w-2.5" />
                            Leader
                          </Badge>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[person.designation, person.departmentName].filter(Boolean).join(' · ') || 'No department'}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <FieldError message={errors.members} />
          </div>
        </div>

        <DialogFooter className={officeHubDialog.footer}>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={isBusy} className="gap-2">
            <Users className="h-4 w-4" />
            {draft.id ? 'Save team' : 'Create team'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The member list on a team's own page, with remove and change-leader. */
export function TeamMemberList({
  team,
  canManage,
  canChangeLeader,
  onChanged,
}: {
  team: OfficeHubTeam;
  canManage: boolean;
  canChangeLeader: boolean;
  onChanged: () => void;
}) {
  const { actor, settings, directory, refreshDirectory } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [adding, setAdding] = useState<string | null>(null);

  const members = team.members ?? [];

  const write = async (memberUserIds: string[], leaderId: string, leaderName: string) => {
    if (!actor) return;
    const nextMembers = normalizeTeamMembers(
      memberUserIds.map((userId) => {
        const existing = members.find((member) => member.userId === userId);
        const person = directory.people.find((entry) => entry.userId === userId);
        return (
          existing ?? {
            userId,
            name: person?.name ?? 'Unknown',
            employeeId: person?.employeeId ?? null,
            designation: person?.designation ?? null,
            departmentId: person?.departmentId ?? null,
            departmentName: person?.departmentName ?? null,
            addedAt: new Date().toISOString(),
            addedByName: actor.userName,
          }
        );
      }),
      leaderId,
      { name: leaderName },
    );

    const ok = await run(
      () => updateTeam(actor, team.id, { leaderId, leaderName, members: nextMembers }, { settings }),
      { failure: 'Could not update the team' },
    );
    if (ok !== null) {
      await refreshDirectory();
      onChanged();
    }
  };

  const remove = async (userId: string) => {
    await write(
      (team.memberUserIds ?? []).filter((entry) => entry !== userId),
      team.leaderId,
      team.leaderName,
    );
  };

  const promote = async (userId: string, name: string) => {
    await write(Array.from(new Set([...(team.memberUserIds ?? []), userId])), userId, name);
  };

  const add = async (userId: string) => {
    const person = directory.people.find((entry) => entry.userId === userId);
    if (!person) return;
    setAdding(null);
    await write(
      Array.from(new Set([...(team.memberUserIds ?? []), userId])),
      team.leaderId,
      team.leaderName,
    );
  };

  return (
    <div className="space-y-3">
      {members.length === 0 ? (
        <OfficeHubEmptyState icon={Users} title="This team has no members." />
      ) : (
        <ul className="divide-y rounded-lg border bg-white">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 px-3 py-2">
              <PersonChip
                name={member.name}
                subtitle={[member.designation, member.departmentName].filter(Boolean).join(' · ') || null}
              />
              {member.isLeader && (
                <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-50 text-[11px] text-amber-800">
                  <Crown className="mr-0.5 h-3 w-3" />
                  Leader
                </Badge>
              )}
              <span className="flex-1" />
              {canChangeLeader && !member.isLeader && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={isBusy}
                  onClick={() => void promote(member.userId, member.name)}
                >
                  <Crown className="h-3 w-3" />
                  Make leader
                </Button>
              )}
              {canManage && !member.isLeader && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  disabled={isBusy}
                  onClick={() => void remove(member.userId)}
                  aria-label={`Remove ${member.name} from the team`}
                >
                  <UserMinus className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && team.status === 'Active' && (
        <div className="max-w-sm">
          <UserSelector
            label="Add a member"
            value={adding}
            placeholder="Search employees"
            allowClear={false}
            onChange={(userId) => userId && void add(userId)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            New members are notified, and can be invited to the team&rsquo;s meetings from then on.
          </p>
        </div>
      )}
    </div>
  );
}

/** Archive and restore. */
export function TeamArchiveControls({
  team,
  canArchive,
  onChanged,
}: {
  team: OfficeHubTeam;
  canArchive: boolean;
  onChanged: () => void;
}) {
  const { actor, refreshDirectory } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!canArchive) return null;

  const archive = async () => {
    if (!actor) return;
    const ok = await run(() => archiveTeam(actor, team.id, reason.trim() || undefined), {
      success: 'Team archived',
      failure: 'Could not archive the team',
    });
    if (ok !== null) {
      await refreshDirectory();
      setOpen(false);
      onChanged();
    }
  };

  const restore = async () => {
    if (!actor) return;
    const ok = await run(() => restoreTeam(actor, team.id), {
      success: 'Team restored',
      failure: 'Could not restore the team',
    });
    if (ok !== null) {
      await refreshDirectory();
      onChanged();
    }
  };

  if (team.status === 'Archived') {
    return (
      <Button variant="outline" onClick={() => void restore()} disabled={isBusy} className="gap-2">
        <ArchiveRestore className="h-4 w-4" />
        Restore team
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} className="gap-2 text-destructive">
        <Archive className="h-4 w-4" />
        Archive
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {team.name}?</DialogTitle>
            <DialogDescription>
              The team stops appearing in pickers, and its members are told. Nothing is deleted — its
              meetings, tasks and history stay exactly as they are, and the team can be restored.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1 block text-xs">Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              className="bg-white"
              placeholder="e.g. Project completed"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isBusy}>
              Keep it active
            </Button>
            <Button variant="destructive" onClick={() => void archive()} disabled={isBusy} className="gap-2">
              <Archive className="h-4 w-4" />
              Archive team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
