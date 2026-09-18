'use client';

/**
 * The team register (§6).
 *
 * Archived teams are hidden by default and shown on a toggle rather than removed from the register,
 * because §6's instruction is to keep historical team information — and a team that has been
 * archived is exactly the one somebody comes looking for when they are reading last year's minutes.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Crown, Plus, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  OFFICE_HUB_BASE_PATH,
  normalizeSearchTerm,
  scoreMatch,
  type OfficeHubTeam,
} from '@/lib/office-hub';
import { listTeams } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  HrCellLink,
  OfficeHubAccessDenied,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubKpiCard,
  OfficeHubPageHeader,
  PersonChip,
  ResultCount,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';
import { TeamDialog, emptyTeamDraft } from '@/components/office-hub/team-form';

export default function TeamsPage() {
  const searchParams = useSearchParams();
  const { viewer, capabilities, isLoading } = useOfficeHub();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(searchParams?.get('new') === '1');
  const [draft, setDraft] = useState(() => emptyTeamDraft(viewer));

  // The draft is seeded from the viewer, which is not known on the first render.
  useEffect(() => {
    if (viewer.userId) setDraft(emptyTeamDraft(viewer));
  }, [viewer.userId, viewer.name, viewer.departmentId, viewer.departmentName]);

  const teamsQuery = useOfficeHubQuery(
    () => listTeams({ includeArchived: true }),
    [],
    { enabled: capabilities.canViewTeams, initial: [] },
  );

  const all = teamsQuery.data ?? [];

  const filtered = useMemo(() => {
    const needle = normalizeSearchTerm(debouncedSearch);
    return all
      .filter((team) => (includeArchived ? true : team.status !== 'Archived'))
      .filter((team) => {
        if (needle.length < 2) return true;
        return (
          scoreMatch(needle, [
            { value: team.name, weight: 1 },
            { value: team.leaderName, weight: 0.5 },
            { value: team.description, weight: 0.3 },
            { value: team.departmentName, weight: 0.4 },
          ]).score > 0
        );
      });
  }, [all, includeArchived, debouncedSearch]);

  const myTeams = useMemo(
    () => all.filter((team) => (team.memberUserIds ?? []).includes(viewer.userId) && team.status !== 'Archived'),
    [all, viewer.userId],
  );
  const ledByMe = useMemo(
    () => all.filter((team) => team.leaderId === viewer.userId && team.status !== 'Archived'),
    [all, viewer.userId],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!capabilities.canViewTeams) return <OfficeHubAccessDenied what="teams" />;

  const columns: OfficeHubListColumn<OfficeHubTeam>[] = [
    {
      header: 'Team',
      mobile: 'title',
      cell: (team) => (
        <div className="min-w-0">
          <HrCellLink
            href={`${OFFICE_HUB_BASE_PATH}/teams/${team.id}`}
            className="block truncate font-medium hover:underline"
          >
            {team.name}
          </HrCellLink>
          <p className="truncate text-xs text-muted-foreground">
            {team.departmentName ?? 'Cross-department'}
            {team.description ? ` · ${team.description}` : ''}
          </p>
        </div>
      ),
    },
    {
      header: 'Leader',
      mobile: 'detail',
      className: 'w-48',
      cell: (team) => <PersonChip name={team.leaderName} />,
    },
    {
      header: 'Members',
      mobile: 'aside',
      className: 'w-24',
      align: 'right',
      cell: (team) => (
        <span className="inline-flex items-center gap-1 text-sm tabular-nums text-slate-700">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          {team.memberCount}
        </span>
      ),
    },
    {
      header: 'Status',
      mobile: 'detail',
      className: 'w-28',
      cell: (team) => (
        <Badge
          variant="outline"
          className={
            team.status === 'Archived'
              ? 'border-slate-200 bg-slate-50 text-[11px] text-slate-500'
              : 'border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700'
          }
        >
          {team.status}
        </Badge>
      ),
    },
    {
      header: '',
      mobile: 'footer',
      align: 'right',
      cell: (team) => (
        <Button size="sm" variant="ghost" asChild>
          <Link href={`${OFFICE_HUB_BASE_PATH}/teams/${team.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Teams"
        description="Groups that can be invited to a meeting or assigned a task as one."
        actions={
          capabilities.canCreateTeam ? (
            <Button onClick={() => setCreating(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create team
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <OfficeHubKpiCard label="Active teams" value={all.filter((team) => team.status !== 'Archived').length} icon={Users} tone="indigo" />
        <OfficeHubKpiCard label="I am a member of" value={myTeams.length} icon={Users} tone="blue" />
        <OfficeHubKpiCard label="I lead" value={ledByMe.length} icon={Crown} tone="amber" />
        <OfficeHubKpiCard label="Archived" value={all.filter((team) => team.status === 'Archived').length} icon={Users} tone="slate" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search teams by name, leader or department"
            className="bg-white pl-8"
            aria-label="Search teams"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={includeArchived} onCheckedChange={(value) => setIncludeArchived(value === true)} />
          Show archived
        </label>
      </div>

      <ResultCount shown={filtered.length} total={all.length} noun="team" />

      {teamsQuery.isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <OfficeHubDataList
          rows={filtered}
          columns={columns}
          cardHref={(team) => `${OFFICE_HUB_BASE_PATH}/teams/${team.id}`}
          rowClassName={(team) => (team.status === 'Archived' ? 'opacity-60' : undefined)}
          empty={
            <OfficeHubEmptyState
              icon={Users}
              title={search ? 'No teams match that search.' : 'No teams yet.'}
              description={
                search
                  ? undefined
                  : 'A team lets you invite a whole group to a meeting, or hand one task to several people, without picking names each time.'
              }
              action={
                capabilities.canCreateTeam && !search ? (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    Create the first team
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <TeamDialog
        open={creating}
        onOpenChange={setCreating}
        draft={draft}
        setDraft={setDraft}
        onSaved={() => {
          setDraft(emptyTeamDraft(viewer));
          teamsQuery.reload();
        }}
      />
    </div>
  );
}
