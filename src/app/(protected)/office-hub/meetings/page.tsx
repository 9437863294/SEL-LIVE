'use client';

/**
 * The meetings register (§14's list, §38's filters, §65's export).
 *
 * The Firestore query is chosen from the viewer's widest grant and a date range; everything else —
 * type, status, priority, department, team, organizer, recurring-only, free text — is applied in
 * memory by `applyMeetingFilters`. That split is deliberate (§50, §58): the indexed dimensions are
 * the ones that bound the read, and the multi-selects would need a composite index per permutation,
 * which is an index list that grows combinatorially for no benefit on a few hundred documents.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarDays, CalendarPlus, Download, Filter, Search, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MEETING_MODES,
  MEETING_STATUSES,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  activeFilterCount,
  addDays,
  applyMeetingFilters,
  formatIsoDate,
  hasActiveFilters,
  meetingJoinView,
  type MeetingFilters,
  type MeetingMode,
  type MeetingStatus,
  type OfficeHubMeeting,
  type OfficeHubPriority,
} from '@/lib/office-hub';
import { listMeetings, listMyParticipations } from '@/lib/office-hub-service';
import {
  useDebouncedValue,
  useOfficeHub,
  useOfficeHubQuery,
} from '@/components/office-hub/hooks';
import {
  HrCellLink,
  MeetingModeBadge,
  MeetingStatusBadge,
  MeetingWhen,
  MeetingWhenBadge,
  MomStageBadge,
  OfficeHubAccessDenied,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubFilterCard,
  OfficeHubPageHeader,
  PriorityBadge,
  ResponseSummaryChip,
  ResultCount,
  useTickingNow,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';
import { DateRangePicker, MultiSelect } from '@/components/office-hub/selectors';

type Scope = 'mine' | 'organized' | 'team' | 'department' | 'all';

export default function MeetingsRegisterPage() {
  const searchParams = useSearchParams();
  const now = useTickingNow();
  const { actor, viewer, capabilities, settings, directory, today, isLoading } = useOfficeHub();

  const requestedScope = searchParams?.get('scope') as Scope | null;
  const awaitingOnly = searchParams?.get('filter') === 'awaiting';

  const [scope, setScope] = useState<Scope>(requestedScope ?? 'mine');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [filters, setFilters] = useState<MeetingFilters>({
    // A register that opens on "everything ever" is a register nobody can read. Six weeks back is
    // where the useful history is; the date filter widens it on demand.
    fromDate: addDays(today, -42),
    toDate: addDays(today, 120),
  });

  /** Scopes the viewer is entitled to ask for. */
  const availableScopes = useMemo(() => {
    const scopes: { value: Scope; label: string }[] = [
      { value: 'mine', label: 'My meetings' },
      { value: 'organized', label: 'Organized by me' },
    ];
    if (capabilities.canViewTeamMeetings && (viewer.teamIds?.length ?? 0) > 0) {
      scopes.push({ value: 'team', label: 'My teams' });
    }
    if (capabilities.canViewDepartmentMeetings && viewer.departmentId) {
      scopes.push({ value: 'department', label: 'My department' });
    }
    if (capabilities.canViewAllMeetings) scopes.push({ value: 'all', label: 'All meetings' });
    return scopes;
  }, [capabilities, viewer.teamIds, viewer.departmentId]);

  const effectiveScope: Scope = availableScopes.some((entry) => entry.value === scope) ? scope : 'mine';

  const meetingsQuery = useOfficeHubQuery(
    () =>
      listMeetings(effectiveScope, viewer, {
        fromDate: filters.fromDate ?? undefined,
        toDate: filters.toDate ?? undefined,
        limit: 400,
        direction: 'desc',
      }),
    [effectiveScope, viewer.userId, viewer.departmentId, filters.fromDate, filters.toDate],
    { enabled: Boolean(actor) && capabilities.canViewMeetings, initial: [] },
  );

  /** Only loaded for the "awaiting my response" view, which needs the participant rows. */
  const participationQuery = useOfficeHubQuery(
    () => listMyParticipations(viewer.userId, { limit: 400 }),
    [viewer.userId],
    { enabled: awaitingOnly && Boolean(actor), initial: [] },
  );

  const all = meetingsQuery.data ?? [];

  const filtered = useMemo(() => {
    let rows = applyMeetingFilters(all, { ...filters, search: debouncedSearch });
    if (awaitingOnly) {
      const outstanding = new Set(
        (participationQuery.data ?? [])
          .filter((participant) => participant.response === 'No Response')
          .map((participant) => participant.meetingId),
      );
      rows = rows.filter((meeting) => outstanding.has(meeting.id));
    }
    return rows.sort((a, b) => b.startAt.localeCompare(a.startAt));
  }, [all, filters, debouncedSearch, awaitingOnly, participationQuery.data]);

  const clearFilters = () => {
    setFilters({ fromDate: addDays(today, -42), toDate: addDays(today, 120) });
    setSearch('');
  };

  /**
   * Export (§65).
   *
   * Exports the *filtered* rows, not everything: the user has just spent a moment narrowing the
   * register to what they care about, and an export that ignores that is a different report.
   */
  const exportRows = async () => {
    // The app's shared workbook helper, so an Office Hub export opens looking like every other
    // module's: frozen header row, auto-filter, real .xlsx rather than a CSV with a misleading name.
    const { exportRowsToExcel } = await import('@/lib/report-excel');
    await exportRowsToExcel(
      'Meetings',
      filtered.map((meeting) => ({
        Date: meeting.date,
        Start: meeting.startTime,
        End: meeting.endTime,
        'Time zone': meeting.timeZone,
        Title: meeting.title,
        Type: meeting.meetingType,
        Mode: meeting.mode,
        Organizer: meeting.organizerName,
        Status: meeting.status,
        Priority: meeting.priority,
        Location:
          meeting.mode === 'Online'
            ? meeting.onlinePlatform ?? 'Online'
            : [meeting.location, meeting.room].filter(Boolean).join(' · '),
        Project: meeting.projectName ?? '',
        Participants: meeting.participantCount,
        Accepted: meeting.responseSummary.accepted,
        Maybe: meeting.responseSummary.maybe,
        Declined: meeting.responseSummary.declined,
        Awaiting: meeting.responseSummary.noResponse,
        Minutes: meeting.momStage ?? '—',
        Recurring: meeting.recurrence.frequency === 'None' ? 'No' : meeting.recurrence.frequency,
      })),
      { filename: `office-hub-meetings-${today}.xlsx` },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!capabilities.canViewMeetings) return <OfficeHubAccessDenied what="the meeting register" />;

  const columns: OfficeHubListColumn<OfficeHubMeeting>[] = [
    {
      header: 'When',
      mobile: 'aside',
      className: 'w-40',
      cell: (meeting) => (
        <div>
          <MeetingWhen meeting={meeting} />
          <MeetingWhenBadge meeting={meeting} now={now} className="mt-0.5" />
        </div>
      ),
    },
    {
      header: 'Meeting',
      mobile: 'title',
      cell: (meeting) => (
        <div className="min-w-0">
          <HrCellLink
            href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}
            className="block truncate font-medium hover:underline"
          >
            {meeting.title}
          </HrCellLink>
          <p className="truncate text-xs text-muted-foreground">
            {meeting.meetingType} · {meeting.organizerName}
            {meeting.projectName ? ` · ${meeting.projectName}` : ''}
          </p>
        </div>
      ),
    },
    {
      header: 'Mode',
      mobile: 'detail',
      className: 'hidden md:table-cell w-28',
      cell: (meeting) => <MeetingModeBadge mode={meeting.mode} />,
    },
    {
      header: 'Responses',
      mobile: 'detail',
      className: 'hidden lg:table-cell w-28',
      cell: (meeting) => <ResponseSummaryChip summary={meeting.responseSummary} />,
    },
    {
      header: 'Priority',
      mobile: 'detail',
      className: 'hidden xl:table-cell w-24',
      cell: (meeting) => <PriorityBadge priority={meeting.priority} />,
    },
    {
      header: 'Minutes',
      mobile: 'omit',
      className: 'hidden xl:table-cell w-28',
      cell: (meeting) => <MomStageBadge stage={meeting.momStage} />,
    },
    {
      header: 'Status',
      mobile: 'detail',
      className: 'w-28',
      cell: (meeting) => <MeetingStatusBadge status={meeting.status} />,
    },
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (meeting) => {
        const join = meetingJoinView(meeting, viewer.userId, {
          canViewAllMeetings: capabilities.canViewAllMeetings,
          now,
        });
        return join.canJoin && join.url ? (
          <Button size="sm" variant={join.emphasise ? 'default' : 'outline'} asChild className="gap-1.5">
            <a href={join.url} target="_blank" rel="noopener noreferrer">
              <Video className="h-3.5 w-3.5" />
              Join
            </a>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" asChild>
            <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}>Open</Link>
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Meetings"
        description={
          awaitingOnly
            ? 'Meetings you have not responded to yet.'
            : 'Everything you can see, newest first. Narrow it with the filters.'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {capabilities.canExportMeetings && filtered.length > 0 && (
              <Button variant="outline" onClick={() => void exportRows()} className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            {capabilities.canCreateMeeting && (
              <Button asChild className="gap-2">
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/new`}>
                  <CalendarPlus className="h-4 w-4" />
                  Schedule meeting
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <OfficeHubFilterCard
        summary={
          hasActiveFilters({ ...filters, search: debouncedSearch })
            ? `${activeFilterCount({ ...filters, search: debouncedSearch })} filter(s) active`
            : 'Showing your recent and upcoming meetings'
        }
        actions={
          hasActiveFilters({ ...filters, search: debouncedSearch }) ? (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-7 gap-1 px-2 text-[11px]">
              <X className="h-3 w-3" />
              Clear
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Label className="mb-1 block text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Title, type, organizer, location, notes"
                className="bg-white pl-8"
              />
            </div>
          </div>

          <div>
            <Label className="mb-1 block text-xs">Scope</Label>
            <Select value={effectiveScope} onValueChange={(next) => setScope(next as Scope)}>
              <SelectTrigger className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableScopes.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DateRangePicker
            from={filters.fromDate}
            to={filters.toDate}
            onChange={(range) => setFilters((current) => ({ ...current, ...range }))}
          />

          <MultiSelect
            label="Meeting type"
            placeholder="Any type"
            options={settings.meetingTypes.map((type) => ({ value: type, label: type }))}
            value={filters.meetingTypes ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, meetingTypes: next }))}
          />

          <MultiSelect
            label="Status"
            placeholder="Any status"
            options={MEETING_STATUSES.map((status) => ({ value: status, label: status }))}
            value={filters.statuses ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, statuses: next as MeetingStatus[] }))}
          />

          <MultiSelect
            label="Priority"
            placeholder="Any priority"
            options={OFFICE_HUB_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
            value={filters.priorities ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, priorities: next as OfficeHubPriority[] }))}
          />

          <MultiSelect
            label="Mode"
            placeholder="Any mode"
            options={MEETING_MODES.map((mode) => ({ value: mode, label: mode }))}
            value={filters.modes ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, modes: next as MeetingMode[] }))}
          />

          <MultiSelect
            label="Department"
            placeholder="Any department"
            options={directory.departments.map((department) => ({ value: department.id, label: department.name }))}
            value={filters.departmentIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, departmentIds: next }))}
          />

          <MultiSelect
            label="Team"
            placeholder="Any team"
            options={directory.teams.map((team) => ({ value: team.id, label: team.name }))}
            value={filters.teamIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, teamIds: next }))}
          />

          <MultiSelect
            label="Organizer"
            placeholder="Anyone"
            options={directory.people.map((person) => ({
              value: person.userId,
              label: person.name,
              hint: person.departmentName ?? undefined,
            }))}
            value={filters.organizerIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, organizerIds: next }))}
          />

          <MultiSelect
            label="Participant"
            placeholder="Anyone"
            options={directory.people.map((person) => ({ value: person.userId, label: person.name }))}
            value={filters.participantIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, participantIds: next }))}
          />

          <div>
            <Label className="mb-1 block text-xs">Recurrence</Label>
            <Select
              value={filters.recurringOnly == null ? '__any__' : filters.recurringOnly ? 'recurring' : 'single'}
              onValueChange={(next) =>
                setFilters((current) => ({
                  ...current,
                  recurringOnly: next === '__any__' ? undefined : next === 'recurring',
                }))
              }
            >
              <SelectTrigger className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any</SelectItem>
                <SelectItem value="recurring">Recurring only</SelectItem>
                <SelectItem value="single">One-off only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </OfficeHubFilterCard>

      <div className="flex items-center justify-between">
        <ResultCount shown={filtered.length} total={all.length} noun="meeting" />
        {meetingsQuery.error && (
          <p className="text-xs text-destructive">
            The register could not be loaded. Check your connection and try again.
          </p>
        )}
      </div>

      {meetingsQuery.isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <OfficeHubDataList
          rows={filtered}
          columns={columns}
          cardHref={(meeting) => `${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}
          maxHeightClassName="sm:max-h-[42rem]"
          rowClassName={(meeting) => (meeting.status === 'Cancelled' ? 'opacity-60' : undefined)}
          empty={
            <OfficeHubEmptyState
              icon={CalendarDays}
              title={
                hasActiveFilters({ ...filters, search: debouncedSearch })
                  ? 'No meetings match these filters.'
                  : 'No meetings in this period.'
              }
              description={
                hasActiveFilters({ ...filters, search: debouncedSearch })
                  ? 'Widen the date range or clear a filter.'
                  : `Nothing between ${formatIsoDate(filters.fromDate ?? today)} and ${formatIsoDate(
                      filters.toDate ?? today,
                    )}.`
              }
              action={
                hasActiveFilters({ ...filters, search: debouncedSearch }) ? (
                  <Button size="sm" variant="outline" onClick={clearFilters} className="gap-2">
                    <Filter className="h-4 w-4" />
                    Clear filters
                  </Button>
                ) : capabilities.canCreateMeeting ? (
                  <Button size="sm" asChild>
                    <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/new`}>Schedule a meeting</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      {filtered.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Times shown in {viewer.timeZone ?? settings.defaultTimeZone}. A meeting scheduled in
          another zone shows a note on its own page.
        </p>
      )}
    </div>
  );
}
