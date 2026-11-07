'use client';

/**
 * The team register (§6). Redesigned 2026-11-07 from the user's mockup
 * (`sel-decisions-actions-teams-redesign.html`): a teal band whose figures filter, then teams as
 * cards — colour by home department, leader, members, the departments they come from, what the team
 * has on, and buttons to invite it to a meeting or hand it a task.
 *
 * Archived teams are hidden by default and shown on a switch rather than removed, because §6 says to
 * keep historical team information — and an archived team is exactly the one somebody comes looking
 * for when reading last year's minutes.
 *
 * "What the team has on" follows the team page's rule (`buildTeamDashboard`: the team's own work or
 * its members'), read once for every card. Each figure needs the viewer's wide read grant for that
 * kind of record; without it the figure shows "—" rather than a misleading zero.
 *
 * Left out from the mockup on purpose: its "Start from a common team" sample teams, and its
 * "Your data / Sample data" preview switch.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Archive, ArchiveRestore, CalendarPlus, Crown, Pencil, Plus, Search, SquareCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  OFFICE_HUB_BASE_PATH,
  buildTeamDashboard,
  canEditTeam,
  teamDepartments,
  teamsInView,
  type OfficeHubTeam,
  type TeamView,
} from '@/lib/office-hub';
import { listActionItems, listMeetings, listTasks, listTeams, restoreTeam } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import { OfficeHubAccessDenied } from '@/components/office-hub/ui';
import { NewTaskDialog } from '@/components/office-hub/task-create-dialog';
import { TeamCard, TeamUsage } from '@/components/office-hub/team-card';
import { TeamWindow } from '@/components/office-hub/team-window';
import { EmptyPanel, HeroButton, RegisterHero, SearchBox, type HeroFigureSpec } from '@/components/office-hub/register-parts';

const BASE = OFFICE_HUB_BASE_PATH;

export default function TeamsPage() {
  const searchParams = useSearchParams();
  const { actor, viewer, capabilities, directory, today, periods, refreshDirectory, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [view, setView] = useState<TeamView>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [windowFor, setWindowFor] = useState<{ team: OfficeHubTeam | null; key: number } | null>(
    searchParams?.get('new') === '1' ? { team: null, key: 0 } : null,
  );
  const [assignTo, setAssignTo] = useState<string | null>(null);

  const teamsQuery = useOfficeHubQuery(() => listTeams({ includeArchived: true }), [], { enabled: capabilities.canViewTeams, initial: [] });

  /** One read of each kind for every card; a kind the viewer may not read in full stays null. */
  const usageQuery = useOfficeHubQuery(
    async () => {
      const [tasks, meetings, actionItems] = await Promise.all([
        capabilities.canViewAllTasks ? listTasks('all', viewer, { limit: 400 }).catch(() => null) : Promise.resolve(null),
        capabilities.canViewAllMeetings ? listMeetings('all', viewer, { fromDate: today, direction: 'asc', limit: 300 }).catch(() => null) : Promise.resolve(null),
        capabilities.canViewActionItems ? listActionItems({ limit: 500 }).catch(() => null) : Promise.resolve(null),
      ]);
      return { tasks, meetings, actionItems };
    },
    [viewer.userId, today, capabilities.canViewAllTasks, capabilities.canViewAllMeetings, capabilities.canViewActionItems],
    { enabled: capabilities.canViewTeams && Boolean(actor) },
  );

  const all = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const active = all.filter((team) => team.status !== 'Archived');
  const shown = useMemo(
    () => teamsInView(all, view, { viewerId: viewer.userId, showArchived, search: debouncedSearch }),
    [all, view, viewer.userId, showArchived, debouncedSearch],
  );

  const usage = (team: OfficeHubTeam) => {
    const data = usageQuery.data;
    if (!data) return null;
    const summary = buildTeamDashboard({
      team,
      tasks: data.tasks ?? [],
      meetings: data.meetings ?? [],
      actionItems: data.actionItems ?? [],
      today,
      weekStart: periods.weekStart,
      weekEnd: periods.weekEnd,
    });
    return [
      ['Meetings ahead', data.meetings ? summary.meetingsUpcoming : null],
      ['Open tasks', data.tasks ? summary.tasksPending : null],
      ['Open actions', data.actionItems ? summary.actionItems : null],
    ] as [string, number | null][];
  };

  const restore = async (team: OfficeHubTeam) => {
    if (!actor) return;
    const ok = await run(
      async () => {
        await restoreTeam(actor, team.id);
        return true;
      },
      { success: `${team.name} restored`, failure: 'Could not restore the team', describe: 'Restore team' },
    );
    if (!ok) return;
    await refreshDirectory();
    teamsQuery.reload();
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full rounded-[22px]" />
        <Skeleton className="h-[28rem] w-full rounded-[18px]" />
      </div>
    );
  }
  if (!capabilities.canViewTeams) return <OfficeHubAccessDenied what="teams" />;

  const pick = (next: TeamView) => () => {
    setView((current) => (current === next && next !== 'all' ? 'all' : next));
  };
  const figures: HeroFigureSpec[] = [
    { key: 'all', label: 'Active teams', value: active.length, icon: Users, tone: ['#a5f3fc', '#0e7490'], on: view === 'all', onPick: pick('all') },
    { key: 'member', label: 'I am a member of', value: active.filter((team) => (team.memberUserIds ?? []).includes(viewer.userId)).length, icon: Users, tone: ['#93c5fd', '#1d4ed8'], on: view === 'member', onPick: pick('member') },
    { key: 'lead', label: 'I lead', value: active.filter((team) => team.leaderId === viewer.userId).length, icon: Crown, tone: ['#fcd34d', '#b45309'], on: view === 'lead', onPick: pick('lead') },
    { key: 'archived', label: 'Archived', value: all.length - active.length, icon: Archive, tone: ['#e2e8f0', '#64748b'], on: view === 'archived', onPick: pick('archived') },
  ];

  return (
    <div className="space-y-3.5">
      <RegisterHero
        tone="teal"
        eyebrow="Teams"
        title="Teams"
        subtitle="Groups that can be invited to a meeting or assigned a task as one."
        loading={teamsQuery.isLoading}
        figures={figures}
        actions={
          capabilities.canCreateTeam ? (
            <HeroButton primary onClick={() => setWindowFor({ team: null, key: Date.now() })}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create team
            </HeroButton>
          ) : undefined
        }
      />

      <section className="overflow-hidden rounded-[18px] border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-3.5 py-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search teams by name, leader or member…" label="Search teams" className="sm:w-72" />
          {view !== 'archived' && (
            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-muted-foreground">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
          )}
          <span className="flex-1" />
          <span className="text-xs font-semibold text-muted-foreground">Membership is resolved when the team is invited or assigned, so changes apply from then on.</span>
        </div>

        {teamsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-3.5 p-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-80 w-full rounded-[18px]" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          all.length === 0 ? (
            <EmptyPanel
              icon={Users}
              tone={['#5eead4', '#0f766e']}
              title="No teams yet"
              body="A team lets you invite a whole group to a meeting, or hand one task to several people, without picking names each time."
              action={
                capabilities.canCreateTeam ? (
                  <Button size="sm" onClick={() => setWindowFor({ team: null, key: Date.now() })} className="gap-1.5 bg-gradient-to-r from-cyan-700 to-blue-600 text-white">
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Create the first team
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyPanel
              icon={Search}
              tone={['#e2e8f0', '#94a3b8']}
              title="No teams match"
              body={view === 'lead' ? 'You do not lead an active team.' : view === 'member' ? 'You are not on an active team.' : 'Try another name, or show archived teams.'}
            />
          )
        ) : (
          <div className="grid grid-cols-1 gap-3.5 p-3.5 sm:grid-cols-[repeat(auto-fill,minmax(310px,1fr))]">
            {shown.map((team) => {
              const archived = team.status === 'Archived';
              const leaderMember = (team.members ?? []).find((member) => member.userId === team.leaderId);
              const counts = usage(team);
              const mayEdit = canEditTeam(team, viewer, capabilities).allowed;
              return (
                <TeamCard
                  key={team.id}
                  name={team.name}
                  description={team.description}
                  toneKey={team.departmentId ?? team.id}
                  archived={archived}
                  role={team.leaderId === viewer.userId ? 'lead' : (team.memberUserIds ?? []).includes(viewer.userId) ? 'member' : null}
                  departmentName={team.departmentName}
                  leader={{ userId: team.leaderId, name: team.leaderName, subtitle: leaderMember?.designation ?? null, you: team.leaderId === viewer.userId }}
                  members={team.members ?? []}
                  departments={teamDepartments(team)}
                  href={`${BASE}/teams/${team.id}`}
                  usage={!archived && (counts ? <TeamUsage items={counts} /> : usageQuery.isLoading ? <Skeleton className="mb-2.5 mt-1.5 h-[42px] w-full rounded-[10px]" /> : null)}
                  actions={
                    archived ? (
                      capabilities.canArchiveTeam ? (
                        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void restore(team)} className="flex-1 gap-1.5">
                          <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                          Restore
                        </Button>
                      ) : null
                    ) : (
                      <>
                        {capabilities.canCreateMeeting && (
                          <Button size="sm" variant="outline" asChild className="flex-1 gap-1.5">
                            <Link href={`${BASE}/meetings/new?team=${team.id}`}>
                              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                              Invite
                            </Link>
                          </Button>
                        )}
                        {capabilities.canCreateTask && (
                          <Button size="sm" variant="outline" onClick={() => setAssignTo(team.id)} className="flex-1 gap-1.5">
                            <SquareCheck className="h-3.5 w-3.5" aria-hidden />
                            Assign task
                          </Button>
                        )}
                        {mayEdit && (
                          <Button size="sm" variant="outline" onClick={() => setWindowFor({ team, key: Date.now() })} className="flex-1 gap-1.5">
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            Edit
                          </Button>
                        )}
                      </>
                    )
                  }
                />
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5 text-xs text-muted-foreground">
          {shown.length} team{shown.length === 1 ? '' : 's'}
          {usageQuery.data && (!usageQuery.data.tasks || !usageQuery.data.meetings) && <span>· a “—” figure is one you do not have the access to count</span>}
        </div>
      </section>

      {windowFor && (
        <TeamWindow
          key={windowFor.key}
          team={windowFor.team}
          open
          onOpenChange={(open) => !open && setWindowFor(null)}
          onSaved={() => teamsQuery.reload()}
        />
      )}

      {assignTo && (
        <NewTaskDialog
          key={assignTo}
          open
          initialTeamId={assignTo}
          knownTasks={[]}
          onOpenChange={(open) => !open && setAssignTo(null)}
          onCreated={() => usageQuery.reload()}
        />
      )}
    </div>
  );
}
