'use client';

/**
 * The meetings register (§14's list, §38's filters, §65's export). Redesigned 2026-11-06 from the
 * user's mockup (`sel-meetings-register-redesign.html`): a band whose figures are tabs, a banner for
 * repeating series that have filled the register with cancelled rows, filters with removable pills,
 * bulk actions, repeats grouped under one row, and a drawer per meeting.
 *
 * The Firestore query is chosen from the viewer's widest grant and a date range; every other filter
 * is applied in memory (`applyMeetingFilters`, and the tab/minutes/grouping helpers in
 * `office-hub-register.ts`). That split is deliberate (§50, §58): the indexed dimensions bound the
 * read, and the multi-selects would need a composite index per permutation.
 *
 * Every action here is real: reminders go through `remindNonResponders` (notifications to the
 * people who have not replied), and "clear" archives cancelled meetings (`archiveMeeting`, a soft
 * delete that `restoreMeeting` undoes) — the same writes the meeting page makes, under the same
 * rules: only whoever runs a meeting may chase its replies or clear it.
 */

import Link from 'next/link';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  FileText,
  Filter,
  MapPin,
  MonitorSmartphone,
  Repeat,
  Search,
  Video,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  MEETING_MODES,
  MINUTES_LABEL,
  MOM_STAGES,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  OFFICE_HUB_WEEKDAYS,
  REGISTER_TABS,
  addDays,
  applyMeetingFilters,
  canEditMeeting,
  cancelledSeries,
  formatClockTime,
  formatIsoDate,
  groupRepeats,
  inRegisterTab,
  isMeetingOrganizer,
  minutesState,
  responseLine,
  seriesKeyOf,
  weekdayOf,
  type MeetingFilters,
  type MeetingMode,
  type MinutesState,
  type OfficeHubMeeting,
  type OfficeHubPriority,
  type RegisterTab,
} from '@/lib/office-hub';
import { archiveMeeting, listMeetings, listMyUnacceptedResponses, remindNonResponders } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import { OfficeHubAccessDenied, useTickingNow } from '@/components/office-hub/ui';
import { MultiSelect } from '@/components/office-hub/selectors';
import { Avatar } from '@/components/office-hub/meeting-form-parts';
import { RegisterDrawer } from '@/components/office-hub/register-drawer';

type Scope = 'mine' | 'organized' | 'team' | 'department' | 'all';
const BASE = OFFICE_HUB_BASE_PATH;
const PAGE_SIZE = 25;
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_CHIP: Record<string, string> = {
  Draft: 'bg-muted text-muted-foreground',
  Scheduled: 'bg-blue-100 text-blue-700',
  'In Progress': 'bg-emerald-100 text-emerald-700',
  Completed: 'bg-teal-100 text-teal-700',
  Cancelled: 'bg-muted text-muted-foreground',
  Postponed: 'bg-amber-100 text-amber-800',
};

const PRIORITY_TONE: Record<OfficeHubPriority, { bars: number; text: string; fill: string }> = {
  Low: { bars: 1, text: 'text-emerald-700 dark:text-emerald-300', fill: 'bg-emerald-500' },
  Medium: { bars: 2, text: 'text-amber-700 dark:text-amber-300', fill: 'bg-amber-500' },
  High: { bars: 3, text: 'text-orange-700 dark:text-orange-300', fill: 'bg-orange-500' },
  Critical: { bars: 4, text: 'text-rose-700 dark:text-rose-300', fill: 'bg-rose-600' },
};

function minutesTone(state: MinutesState): string {
  if (state === 'due') return 'text-rose-700 dark:text-rose-300';
  if (state === 'Approved' || state === 'Published') return 'text-emerald-700 dark:text-emerald-300';
  if (state === 'not-needed' || state === 'later') return 'text-muted-foreground';
  return 'text-amber-700 dark:text-amber-300';
}

export default function MeetingsRegisterPage() {
  const searchParams = useSearchParams();
  const now = useTickingNow();
  const { actor, viewer, capabilities, settings, directory, today, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const { toast } = useToast();

  const [scope, setScope] = useState<Scope>((searchParams?.get('scope') as Scope | null) ?? 'mine');
  const [tab, setTab] = useState<RegisterTab>(searchParams?.get('filter') === 'awaiting' ? 'awaiting' : 'all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [filters, setFilters] = useState<MeetingFilters>({
    // Six weeks back is where the useful history is; the date filter widens it on demand.
    fromDate: addDays(today, -42),
    toDate: addDays(today, 120),
  });
  const [minutesFilter, setMinutesFilter] = useState<MinutesState | ''>('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<{ ids: string[]; label: string } | null>(null);

  const scopes = useMemo(() => {
    const list: { value: Scope; label: string }[] = [
      { value: 'mine', label: 'My meetings' },
      { value: 'organized', label: 'Organised by me' },
    ];
    if (capabilities.canViewTeamMeetings && (viewer.teamIds?.length ?? 0) > 0) list.push({ value: 'team', label: 'My teams' });
    if (capabilities.canViewDepartmentMeetings && viewer.departmentId) list.push({ value: 'department', label: 'My department' });
    if (capabilities.canViewAllMeetings) list.push({ value: 'all', label: 'Everyone’s meetings' });
    return list;
  }, [capabilities, viewer.teamIds, viewer.departmentId]);
  const effectiveScope: Scope = scopes.some((entry) => entry.value === scope) ? scope : 'mine';

  const meetingsQuery = useOfficeHubQuery(
    () =>
      listMeetings(effectiveScope, viewer, {
        fromDate: filters.fromDate ?? undefined,
        toDate: filters.toDate ?? undefined,
        limit: 500,
        direction: 'desc',
      }),
    [effectiveScope, viewer.userId, viewer.departmentId, filters.fromDate, filters.toDate],
    { enabled: Boolean(actor) && capabilities.canViewMeetings, initial: [] },
  );
  const responsesQuery = useOfficeHubQuery(() => listMyUnacceptedResponses(viewer.userId), [viewer.userId], {
    enabled: Boolean(actor),
    initial: new Map(),
  });

  const all = useMemo(() => meetingsQuery.data ?? [], [meetingsQuery.data]);
  const awaitingIds = useMemo(
    () => new Set([...(responsesQuery.data ?? new Map()).entries()].filter(([, response]) => response === 'No Response').map(([id]) => id)),
    [responsesQuery.data],
  );
  const tabContext = useMemo(() => ({ today, nowMs: now.getTime(), awaitingIds }), [today, now, awaitingIds]);

  /** Everything the filters and search leave, before the tab narrows it. */
  const filtered = useMemo(() => {
    const rows = applyMeetingFilters(all, { ...filters, search: debouncedSearch });
    return minutesFilter ? rows.filter((meeting) => minutesState(meeting) === minutesFilter) : rows;
  }, [all, filters, debouncedSearch, minutesFilter]);

  const inTab = useMemo(
    () =>
      filtered
        .filter((meeting) => inRegisterTab(meeting, tab, tabContext))
        .sort((a, b) => (ascending ? 1 : -1) * a.startAt.localeCompare(b.startAt)),
    [filtered, tab, tabContext, ascending],
  );
  const rows = useMemo(() => groupRepeats(inTab, grouped), [inTab, grouped]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const tabCount = (value: RegisterTab) => filtered.filter((meeting) => inRegisterTab(meeting, value, tabContext)).length;
  const series = useMemo(() => cancelledSeries(all), [all]);
  const cancelledTotal = series.reduce((sum, entry) => sum + entry.ids.length, 0);

  /* ── permissions per meeting ── */
  const runsMeeting = (meeting: OfficeHubMeeting) => isMeetingOrganizer(meeting, viewer) || capabilities.canEditAnyMeeting;
  const canRemind = (meeting: OfficeHubMeeting) =>
    (meeting.status === 'Scheduled' || meeting.status === 'In Progress') &&
    (meeting.responseSummary?.noResponse ?? 0) > 0 &&
    Date.parse(meeting.endAt) > now.getTime() &&
    (isMeetingOrganizer(meeting, viewer) || capabilities.canManageAnyParticipants);
  const canClear = (meeting: OfficeHubMeeting) => (meeting.status === 'Cancelled' || meeting.status === 'Postponed') && runsMeeting(meeting);

  const byId = useMemo(() => new Map(all.map((meeting) => [meeting.id, meeting])), [all]);
  const departmentName = (id: string) => directory.departments.find((department) => department.id === id)?.name ?? null;
  const teamName = (id: string) => directory.teams.find((team) => team.id === id)?.name ?? null;
  const personName = (id: string) => directory.people.find((person) => person.userId === id)?.name ?? 'Someone';

  /* ── actions ── */
  const remind = async (meetings: OfficeHubMeeting[]) => {
    if (!actor || !meetings.length) return;
    const total = await run(
      async () => {
        let people = 0;
        for (const meeting of meetings) people += await remindNonResponders(actor, meeting.id, { settings });
        return people;
      },
      { failure: 'Could not send the reminders', describe: 'Remind non-responders' },
    );
    if (total != null) {
      // Written here rather than as `run`'s success message, because the count is only known now.
      toast({
        title: total ? `Reminded ${total} ${total === 1 ? 'person' : 'people'}` : 'Nobody to remind',
        description: total ? `Across ${meetings.length} meeting${meetings.length === 1 ? '' : 's'}.` : 'Everyone has already replied.',
      });
      meetingsQuery.reload();
    }
  };

  const clear = async (ids: string[]) => {
    if (!actor || !ids.length) return;
    const done = await run(
      async () => {
        for (const id of ids) await archiveMeeting(actor, id, 'Cleared from the register (cancelled)');
        return true;
      },
      {
        success: `${ids.length} cancelled meeting${ids.length === 1 ? '' : 's'} cleared from the register`,
        failure: 'Could not clear them',
        describe: 'Clear cancelled meetings',
      },
    );
    if (done) {
      setSelected(new Set());
      setOpenId(null);
      meetingsQuery.reload();
    }
  };

  const exportRows = async (meetings: OfficeHubMeeting[]) => {
    const { exportRowsToExcel } = await import('@/lib/report-excel');
    await exportRowsToExcel(
      'Meetings',
      meetings.map((meeting) => ({
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
        Location: meeting.mode === 'Online' ? meeting.onlinePlatform ?? 'Online' : [meeting.location, meeting.room].filter(Boolean).join(' · '),
        Project: meeting.projectName ?? '',
        Participants: meeting.participantCount,
        Accepted: meeting.responseSummary.accepted,
        Maybe: meeting.responseSummary.maybe,
        Declined: meeting.responseSummary.declined,
        Awaiting: meeting.responseSummary.noResponse,
        Minutes: MINUTES_LABEL[minutesState(meeting)],
        Recurring: meeting.recurrence?.frequency && meeting.recurrence.frequency !== 'None' ? meeting.recurrence.frequency : meeting.seriesId ? 'Series' : 'No',
      })),
      { filename: `office-hub-meetings-${today}.xlsx` },
    );
  };

  const resetFilters = () => {
    setFilters({ fromDate: addDays(today, -42), toDate: addDays(today, 120) });
    setMinutesFilter('');
    setSearch('');
    setPage(1);
  };
  const patchFilters = (patch: Partial<MeetingFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full rounded-[20px]" />
        <Skeleton className="h-[30rem] w-full rounded-[18px]" />
      </div>
    );
  }
  if (!capabilities.canViewMeetings) return <OfficeHubAccessDenied what="the meeting register" />;

  /* ── pills ── */
  const pills: { key: string; label: string; clear: () => void }[] = [];
  const listPill = (key: keyof MeetingFilters, label: string, values: string[] | undefined, name: (value: string) => string | null) => {
    if (values?.length) pills.push({ key, label: `${label}: ${values.map((value) => name(value) ?? value).join(', ')}`, clear: () => patchFilters({ [key]: [] }) });
  };
  listPill('meetingTypes', 'Type', filters.meetingTypes, (value) => value);
  listPill('priorities', 'Priority', filters.priorities, (value) => value);
  listPill('modes', 'Mode', filters.modes, (value) => (value === 'Offline' ? 'In person' : value));
  listPill('departmentIds', 'Department', filters.departmentIds, departmentName);
  listPill('teamIds', 'Team', filters.teamIds, teamName);
  listPill('organizerIds', 'Organiser', filters.organizerIds, personName);
  listPill('participantIds', 'Participant', filters.participantIds, personName);
  if (filters.recurringOnly != null) {
    pills.push({ key: 'rec', label: filters.recurringOnly ? 'Repeating only' : 'One-time only', clear: () => patchFilters({ recurringOnly: undefined }) });
  }
  if (minutesFilter) pills.push({ key: 'min', label: `Minutes: ${MINUTES_LABEL[minutesFilter]}`, clear: () => setMinutesFilter('') });
  if (debouncedSearch.trim()) pills.push({ key: 'q', label: `Search: “${debouncedSearch.trim()}”`, clear: () => setSearch('') });
  const moreCount =
    (filters.departmentIds?.length ? 1 : 0) +
    (filters.teamIds?.length ? 1 : 0) +
    (filters.organizerIds?.length ? 1 : 0) +
    (filters.participantIds?.length ? 1 : 0) +
    (filters.recurringOnly != null ? 1 : 0) +
    (minutesFilter ? 1 : 0);

  const selectedMeetings = [...selected].map((id) => byId.get(id)).filter((meeting): meeting is OfficeHubMeeting => Boolean(meeting));
  const selectedRemindable = selectedMeetings.filter(canRemind);
  const selectedClearable = selectedMeetings.filter(canClear);
  const allSelected = inTab.length > 0 && inTab.every((meeting) => selected.has(meeting.id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openMeeting = openId ? byId.get(openId) ?? null : null;
  const openSeriesKey = openMeeting ? seriesKeyOf(openMeeting) : null;
  const openSeries = openSeriesKey
    ? all.filter((meeting) => seriesKeyOf(meeting) === openSeriesKey).sort((a, b) => a.startAt.localeCompare(b.startAt))
    : [];

  const figures: { tab: RegisterTab; label: string; value: number }[] = [
    { tab: 'all', label: 'In register', value: all.length },
    { tab: 'upcoming', label: 'Upcoming', value: all.filter((meeting) => inRegisterTab(meeting, 'upcoming', tabContext)).length },
    { tab: 'completed', label: 'Completed', value: all.filter((meeting) => meeting.status === 'Completed').length },
    { tab: 'minutes', label: 'Minutes pending', value: all.filter((meeting) => inRegisterTab(meeting, 'minutes', tabContext)).length },
    { tab: 'cancelled', label: 'Cancelled', value: all.filter((meeting) => inRegisterTab(meeting, 'cancelled', tabContext)).length },
  ];

  const monthLabel = (date: string) => `${MONTHS_LONG[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
  const monthHeaders = pageRows.map(
    (row, index) => index === 0 || monthLabel(row.meeting.date) !== monthLabel(pageRows[index - 1].meeting.date),
  );

  return (
    <div className="space-y-3.5">
      {/* ── band ── */}
      <section className="oh-hero oh-hero--glow keep-light relative flex flex-wrap items-center gap-4 overflow-hidden rounded-[20px] px-4 py-4 text-white sm:px-6">
        <div aria-hidden className="wd-hero-dots pointer-events-none absolute inset-0" />
        <div className="relative min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-violet-100">Office Hub · Meetings</div>
          <h1 className="mt-0.5 text-[23px] font-extrabold tracking-tight">Meeting register</h1>
          <p className="text-[12.5px] text-indigo-100">
            Every meeting you can see · {formatIsoDate(filters.fromDate ?? today)} – {formatIsoDate(filters.toDate ?? today)}
          </p>
        </div>
        <span className="hidden flex-1 lg:block" />
        <div className="relative flex flex-wrap gap-2">
          {figures.map((figure) => (
            <button
              key={figure.tab}
              type="button"
              aria-pressed={tab === figure.tab}
              onClick={() => {
                setTab(figure.tab);
                setPage(1);
              }}
              className={cn(
                'min-w-[104px] rounded-[14px] border px-3.5 py-2 text-left transition-colors',
                tab === figure.tab ? 'border-white bg-white text-slate-900' : 'border-white/20 bg-white/10 text-white hover:bg-white/15',
              )}
            >
              <small className={cn('block text-[11px] font-semibold', tab === figure.tab ? 'text-slate-500' : 'text-violet-100')}>{figure.label}</small>
              <b className="text-[21px] font-extrabold leading-tight">{meetingsQuery.isLoading ? '–' : figure.value}</b>
            </button>
          ))}
        </div>
        <div className="relative flex flex-row gap-2 sm:flex-col">
          {capabilities.canCreateMeeting && (
            <Link
              href={`${BASE}/meetings/new`}
              className="flex items-center justify-center gap-1.5 rounded-[10px] border border-white bg-white px-3 py-1.5 text-[12.5px] font-bold text-violet-900 hover:bg-violet-50"
            >
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
              Schedule meeting
            </Link>
          )}
          {capabilities.canExportMeetings && (
            <button
              type="button"
              disabled={!inTab.length}
              onClick={() => void exportRows(inTab)}
              className="flex items-center justify-center gap-1.5 rounded-[10px] border border-white/25 bg-white/10 px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-white/20 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export
            </button>
          )}
        </div>
      </section>

      {/* ── cancelled series ── */}
      {series.length > 0 && (
        <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-500/10 to-pink-500/10 px-4 py-3">
          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-orange-300 to-orange-700 text-white">
            <Repeat className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <b className="block text-[13.5px]">
              {cancelledTotal} cancelled meetings come from {series.length} repeating series.
            </b>
            <span className="text-[12.5px] text-orange-900 dark:text-orange-200">
              Each occurrence is its own row and still shows on the calendar. Clearing them archives the cancelled rows; nothing that is still happening changes.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {series.map((entry) => {
              const clearable = entry.ids.filter((id) => {
                const meeting = byId.get(id);
                return meeting ? canClear(meeting) : false;
              });
              return (
                <div key={entry.key} className="flex items-center gap-2 rounded-xl border border-orange-200 bg-card py-1.5 pl-3 pr-1.5 text-xs">
                  <span className="min-w-0">
                    <b className="text-[12.5px]">{entry.title}</b> · {entry.ids.length} cancelled
                  </span>
                  {clearable.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-rose-200 text-xs text-rose-700"
                      disabled={isBusy}
                      onClick={() => setConfirmClear({ ids: clearable, label: `“${entry.title}”` })}
                    >
                      Clear {clearable.length}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-[18px] border bg-card">
        {/* tabs */}
        <div className="flex gap-1 overflow-x-auto border-b px-3.5 pt-2.5" role="tablist" aria-label="Which meetings">
          {REGISTER_TABS.map((entry) => {
            const count = tabCount(entry.value);
            const on = tab === entry.value;
            return (
              <button
                key={entry.value}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setTab(entry.value);
                  setPage(1);
                }}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-2 text-[13px] font-bold transition-colors',
                  on ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {entry.label}
                <em className={cn('rounded-full px-1.5 text-[11px] not-italic', on ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
                  {count}
                </em>
              </button>
            );
          })}
        </div>

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
          <label className="flex h-9 w-full items-center gap-2 rounded-[10px] border px-2.5 text-muted-foreground sm:w-72">
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Title, type, organiser, location…"
              aria-label="Search the register"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <Select
            value={effectiveScope}
            onValueChange={(next) => {
              setScope(next as Scope);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Whose meetings" className="h-9 w-auto min-w-[150px] rounded-[10px] font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scopes.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex h-9 items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-semibold text-muted-foreground">
            From
            <input
              type="date"
              value={filters.fromDate ?? ''}
              max={filters.toDate ?? undefined}
              onChange={(event) => event.target.value && patchFilters({ fromDate: event.target.value })}
              className="bg-transparent font-semibold text-foreground outline-none"
              aria-label="From date"
            />
            to
            <input
              type="date"
              value={filters.toDate ?? ''}
              min={filters.fromDate ?? undefined}
              onChange={(event) => event.target.value && patchFilters({ toDate: event.target.value })}
              className="bg-transparent font-semibold text-foreground outline-none"
              aria-label="To date"
            />
          </label>
          <FilterBox>
            <MultiSelect
              placeholder="Any meeting type"
              options={settings.meetingTypes.map((type) => ({ value: type, label: type }))}
              value={filters.meetingTypes ?? []}
              onChange={(next) => patchFilters({ meetingTypes: next })}
            />
          </FilterBox>
          <FilterBox>
            <MultiSelect
              placeholder="Any priority"
              options={OFFICE_HUB_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
              value={filters.priorities ?? []}
              onChange={(next) => patchFilters({ priorities: next as OfficeHubPriority[] })}
            />
          </FilterBox>
          <FilterBox>
            <MultiSelect
              placeholder="Any mode"
              options={MEETING_MODES.map((mode) => ({ value: mode, label: mode === 'Offline' ? 'In person' : mode }))}
              value={filters.modes ?? []}
              onChange={(next) => patchFilters({ modes: next as MeetingMode[] })}
            />
          </FilterBox>
          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-[10px] font-bold" aria-expanded={moreOpen} onClick={() => setMoreOpen((current) => !current)}>
            <Filter className="h-3.5 w-3.5" aria-hidden />
            More filters
            {moreCount > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-[11px] text-primary">{moreCount}</span>}
          </Button>
          <span className="hidden flex-1 lg:block" />
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-muted-foreground">
            <Switch checked={grouped} onCheckedChange={setGrouped} />
            Group repeating meetings
          </label>
        </div>

        {moreOpen && (
          <div className="flex flex-wrap gap-2 px-3.5 pb-3">
            <FilterBox>
              <MultiSelect
                placeholder="Any department"
                options={directory.departments.map((department) => ({ value: department.id, label: department.name }))}
                value={filters.departmentIds ?? []}
                onChange={(next) => patchFilters({ departmentIds: next })}
              />
            </FilterBox>
            <FilterBox>
              <MultiSelect
                placeholder="Any team"
                options={directory.teams.map((team) => ({ value: team.id, label: team.name }))}
                value={filters.teamIds ?? []}
                onChange={(next) => patchFilters({ teamIds: next })}
              />
            </FilterBox>
            <FilterBox>
              <MultiSelect
                placeholder="Any organiser"
                options={directory.people.map((person) => ({ value: person.userId, label: person.name, hint: person.departmentName ?? undefined }))}
                value={filters.organizerIds ?? []}
                onChange={(next) => patchFilters({ organizerIds: next })}
              />
            </FilterBox>
            <FilterBox>
              <MultiSelect
                placeholder="Any participant"
                options={directory.people.map((person) => ({ value: person.userId, label: person.name }))}
                value={filters.participantIds ?? []}
                onChange={(next) => patchFilters({ participantIds: next })}
              />
            </FilterBox>
            <Select
              value={filters.recurringOnly == null ? 'any' : filters.recurringOnly ? 'recurring' : 'single'}
              onValueChange={(next) => patchFilters({ recurringOnly: next === 'any' ? undefined : next === 'recurring' })}
            >
              <SelectTrigger aria-label="Recurrence" className="h-9 w-44 rounded-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any recurrence</SelectItem>
                <SelectItem value="recurring">Repeating only</SelectItem>
                <SelectItem value="single">One-time only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={minutesFilter || 'any'} onValueChange={(next) => setMinutesFilter(next === 'any' ? '' : (next as MinutesState))}>
              <SelectTrigger aria-label="Minutes" className="h-9 w-48 rounded-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any minutes status</SelectItem>
                <SelectItem value="due">Minutes due</SelectItem>
                {MOM_STAGES.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {stage}
                  </SelectItem>
                ))}
                <SelectItem value="later">{MINUTES_LABEL.later}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {pills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-3">
            {pills.map((pill) => (
              <span key={pill.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/25 bg-primary/10 py-0.5 pl-2.5 pr-1 text-[11.5px] font-bold text-primary">
                <span className="truncate">{pill.label}</span>
                <button type="button" onClick={pill.clear} aria-label={`Remove ${pill.label}`} className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary/20 hover:bg-primary/30">
                  <X className="h-2.5 w-2.5" strokeWidth={3} />
                </button>
              </span>
            ))}
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={resetFilters}>
              <X className="h-3 w-3" aria-hidden />
              Clear all
            </Button>
          </div>
        )}

        {selected.size > 0 && (
          <div className="keep-light flex flex-wrap items-center gap-2 bg-indigo-950 px-3.5 py-2 text-[13px] font-semibold text-white">
            <span>{selected.size} selected</span>
            {capabilities.canExportMeetings && (
              <BulkButton onClick={() => void exportRows(selectedMeetings)}>
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export selected
              </BulkButton>
            )}
            <BulkButton disabled={isBusy || !selectedRemindable.length} onClick={() => void remind(selectedRemindable)} title="Reminds the people who have not replied, in meetings you run">
              <Bell className="h-3.5 w-3.5" aria-hidden />
              Send reminder{selectedRemindable.length ? ` (${selectedRemindable.length})` : ''}
            </BulkButton>
            <BulkButton
              disabled={isBusy || !selectedClearable.length}
              onClick={() => setConfirmClear({ ids: selectedClearable.map((meeting) => meeting.id), label: 'the selected cancelled meetings' })}
              title="Archives the cancelled meetings you run among those selected"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear cancelled{selectedClearable.length ? ` (${selectedClearable.length})` : ''}
            </BulkButton>
            <span className="flex-1" />
            <BulkButton onClick={() => setSelected(new Set())}>Clear selection</BulkButton>
          </div>
        )}

        {meetingsQuery.error && <p className="px-3.5 pb-2 text-xs text-destructive">The register could not be loaded. Check your connection and try again.</p>}

        {meetingsQuery.isLoading ? (
          <div className="p-3.5">
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        ) : pageRows.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground">
            <span aria-hidden className="mx-auto mb-2.5 grid h-[54px] w-[54px] place-items-center rounded-[17px] bg-gradient-to-br from-violet-300 to-violet-700 text-white shadow-lg">
              <CalendarDays className="h-6 w-6" />
            </span>
            <b className="block text-sm text-foreground">No meetings match</b>
            <p className="mb-3 text-xs">Try another tab, widen the dates or clear the filters.</p>
            {pills.length > 0 && (
              <Button size="sm" variant="outline" onClick={resetFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* desktop */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[960px] border-collapse">
                <thead>
                  <tr className="bg-muted/40 text-left text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="w-9 border-b px-3 py-2">
                      <CheckBox checked={allSelected} label="Select every meeting in this tab" onChange={() => setSelected(allSelected ? new Set() : new Set(inTab.map((meeting) => meeting.id)))} />
                    </th>
                    <th className="border-b px-3 py-2">
                      <button type="button" onClick={() => setAscending((current) => !current)} className="inline-flex items-center gap-1 uppercase hover:text-foreground">
                        When {ascending ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                      </button>
                    </th>
                    <th className="border-b px-3 py-2">Meeting</th>
                    <th className="hidden border-b px-3 py-2 xl:table-cell">Mode</th>
                    <th className="border-b px-3 py-2">People</th>
                    <th className="border-b px-3 py-2">Responses</th>
                    <th className="hidden border-b px-3 py-2 xl:table-cell">Priority</th>
                    <th className="border-b px-3 py-2">Minutes</th>
                    <th className="border-b px-3 py-2">Status</th>
                    <th className="border-b px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, index) => {
                    const key = seriesKeyOf(row.meeting);
                    const isOpen = Boolean(key && expanded.has(key));
                    return (
                      <Fragment key={row.meeting.id}>
                        {monthHeaders[index] && (
                          <tr>
                            <td colSpan={10} className="border-b bg-muted/40 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                              {monthLabel(row.meeting.date)}
                            </td>
                          </tr>
                        )}
                        <MeetingRow
                          meeting={row.meeting}
                          repeats={row.repeats.length}
                          expanded={isOpen}
                          onToggleRepeats={key ? () => setExpanded((current) => toggleIn(current, key)) : undefined}
                          selected={selected.has(row.meeting.id)}
                          onSelect={() => toggle(row.meeting.id)}
                          onOpen={() => setOpenId(row.meeting.id)}
                          onRemind={canRemind(row.meeting) ? () => void remind([row.meeting]) : undefined}
                          busy={isBusy}
                          today={today}
                          departmentName={departmentName}
                          people={directory.people}
                        />
                        {isOpen &&
                          row.repeats.map((repeat) => (
                            <MeetingRow
                              key={repeat.id}
                              sub
                              meeting={repeat}
                              repeats={0}
                              expanded={false}
                              selected={selected.has(repeat.id)}
                              onSelect={() => toggle(repeat.id)}
                              onOpen={() => setOpenId(repeat.id)}
                              onRemind={canRemind(repeat) ? () => void remind([repeat]) : undefined}
                              busy={isBusy}
                              today={today}
                              departmentName={departmentName}
                              people={directory.people}
                            />
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* phones and tablets */}
            <ul className="lg:hidden">
              {pageRows.map((row) => (
                <MeetingCard
                  key={row.meeting.id}
                  meeting={row.meeting}
                  repeats={row.repeats.length}
                  selected={selected.has(row.meeting.id)}
                  onSelect={() => toggle(row.meeting.id)}
                  onOpen={() => setOpenId(row.meeting.id)}
                  today={today}
                />
              ))}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5 text-xs text-muted-foreground">
          <span>
            Showing <b className="text-foreground">{pageRows.length}</b> row{pageRows.length === 1 ? '' : 's'}
            {grouped && rows.length !== inTab.length ? (
              <>
                {' '}
                · <b className="text-foreground">{inTab.length}</b> meetings, repeats grouped
              </>
            ) : (
              <>
                {' '}
                of <b className="text-foreground">{rows.length}</b>
              </>
            )}
          </span>
          <span className="flex-1" />
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">
                <ChevronRight className="h-4 w-4 rotate-180" />
              </Button>
              <span className="px-2 font-semibold">
                Page {currentPage} of {pages}
              </span>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </section>

      <RegisterDrawer
        meeting={openMeeting}
        series={openSeries}
        departmentNames={(openMeeting?.departmentIds ?? []).map(departmentName).filter(Boolean).join(', ')}
        canEdit={Boolean(openMeeting && canEditMeeting(openMeeting, viewer, capabilities).allowed)}
        canRemind={Boolean(openMeeting && canRemind(openMeeting))}
        canClear={Boolean(openMeeting && canClear(openMeeting))}
        busy={isBusy}
        onClose={() => setOpenId(null)}
        onRemind={() => openMeeting && void remind([openMeeting])}
        onClear={() => openMeeting && setConfirmClear({ ids: [openMeeting.id], label: `“${openMeeting.title}” on ${formatIsoDate(openMeeting.date)}` })}
      />

      <ConfirmDialog
        open={Boolean(confirmClear)}
        onOpenChange={(open) => !open && setConfirmClear(null)}
        title={`Clear ${confirmClear?.ids.length ?? 0} cancelled meeting${confirmClear?.ids.length === 1 ? '' : 's'}?`}
        description={`This archives ${confirmClear?.label ?? 'them'} — they leave the register and the calendar. Nothing that is still happening changes, and an archived meeting can be restored.`}
        confirmLabel="Clear them"
        destructive
        loading={isBusy}
        onConfirm={async () => {
          if (confirmClear) await clear(confirmClear.ids);
          setConfirmClear(null);
        }}
      />
    </div>
  );
}

function toggleIn(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function FilterBox({ children }: { children: ReactNode }) {
  return <div className="w-[calc(50%-4px)] sm:w-44">{children}</div>;
}

function BulkButton({ children, onClick, disabled, title }: { children: ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-1.5 rounded-[9px] border border-white/25 bg-white/10 px-2.5 py-1 text-xs font-bold hover:bg-white/20 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function CheckBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
      className={cn(
        'grid h-[17px] w-[17px] place-items-center rounded-[5px] border-2 transition-colors',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 bg-card',
      )}
    >
      {checked && <Check className="h-[11px] w-[11px]" strokeWidth={3.2} />}
    </button>
  );
}

function DateTile({ date, muted }: { date: string; muted?: boolean }) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return (
    <div className="w-11 shrink-0 overflow-hidden rounded-[10px] border bg-card text-center">
      <small className={cn('block text-[8.5px] font-extrabold tracking-wider text-white', muted ? 'bg-slate-400' : 'bg-primary')}>
        {months[Number(date.slice(5, 7)) - 1]}
      </small>
      <b className="block text-base leading-snug">{Number(date.slice(8, 10))}</b>
    </div>
  );
}

function whenLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const label = `${OFFICE_HUB_WEEKDAYS[weekdayOf(date)].short}, ${formatIsoDate(date, { year: date.slice(0, 4) !== today.slice(0, 4) })}`;
  return label;
}

function ModeLabel({ mode }: { mode: MeetingMode }) {
  const Icon = mode === 'Online' ? Video : mode === 'Hybrid' ? MonitorSmartphone : MapPin;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {mode === 'Offline' ? 'In person' : mode}
    </span>
  );
}

function ResponsesCell({ meeting }: { meeting: OfficeHubMeeting }) {
  const cancelled = meeting.status === 'Cancelled' || meeting.status === 'Postponed';
  const summary = meeting.responseSummary;
  const line = responseLine(summary);
  if (cancelled || !summary || !line.total) return <span className="text-xs text-muted-foreground">—</span>;
  const part = (value: number) => `${(value / line.total) * 100}%`;
  return (
    <div className="min-w-[96px]" title={line.text}>
      <div className="mb-1 flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-muted">
        {summary.accepted > 0 && <i className="block h-full bg-emerald-600" style={{ width: part(summary.accepted) }} />}
        {summary.maybe > 0 && <i className="block h-full bg-sky-500" style={{ width: part(summary.maybe) }} />}
        {summary.declined > 0 && <i className="block h-full bg-rose-500" style={{ width: part(summary.declined) }} />}
      </div>
      <small className="text-[11px] font-semibold text-muted-foreground">
        {summary.accepted} of {line.total} accepted{summary.noResponse ? ` · ${summary.noResponse} waiting` : ''}
      </small>
    </div>
  );
}

function MeetingRow({
  meeting,
  repeats,
  expanded,
  onToggleRepeats,
  sub,
  selected,
  onSelect,
  onOpen,
  onRemind,
  busy,
  today,
  departmentName,
  people,
}: {
  meeting: OfficeHubMeeting;
  repeats: number;
  expanded: boolean;
  onToggleRepeats?: () => void;
  sub?: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRemind?: () => void;
  busy: boolean;
  today: string;
  departmentName: (id: string) => string | null;
  people: readonly { userId: string; name: string }[];
}) {
  const cancelled = meeting.status === 'Cancelled' || meeting.status === 'Postponed';
  const minutes = minutesState(meeting);
  const tone = PRIORITY_TONE[meeting.priority] ?? PRIORITY_TONE.Medium;
  const department = (meeting.departmentIds ?? []).map(departmentName).filter(Boolean)[0];
  const participantIds = meeting.participantUserIds ?? [];
  const isSeries = Boolean(meeting.seriesId || meeting.isSeriesParent);
  return (
    <tr
      onClick={onOpen}
      className={cn('cursor-pointer border-b transition-colors hover:bg-primary/[0.04]', sub && 'bg-muted/25', selected && 'bg-primary/[0.06]')}
    >
      <td className="px-3 py-2.5">
        <CheckBox checked={selected} onChange={onSelect} label={`Select ${meeting.title} on ${meeting.date}`} />
      </td>
      <td className={cn('px-3 py-2.5', sub && 'pl-8')}>
        <div className={cn('flex items-center gap-2.5', cancelled && 'opacity-60')}>
          <DateTile date={meeting.date} muted={cancelled} />
          <div>
            <strong className="block whitespace-nowrap text-[12.5px]">{whenLabel(meeting.date, today)}</strong>
            <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">
              {formatClockTime(meeting.startTime)} – {formatClockTime(meeting.endTime)}
            </span>
          </div>
        </div>
      </td>
      <td className="max-w-[340px] px-3 py-2.5">
        <div className={cn('min-w-0', cancelled && 'opacity-70')}>
          <span className={cn('block truncate text-[13px] font-bold', cancelled && 'line-through decoration-muted-foreground/50')}>{meeting.title}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted-foreground">
            <span className="truncate">{[meeting.meetingType, department, meeting.organizerName].filter(Boolean).join(' · ')}</span>
            {repeats > 0 && onToggleRepeats ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleRepeats();
                }}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 text-[11px] font-bold text-primary hover:bg-primary/15"
                aria-expanded={expanded}
              >
                <Repeat className="h-3 w-3" aria-hidden />
                {repeats + 1} in range
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            ) : isSeries && !sub ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 text-[11px] font-bold text-primary">
                <Repeat className="h-3 w-3" aria-hidden />
                Repeats
              </span>
            ) : null}
          </span>
        </div>
      </td>
      <td className="hidden px-3 py-2.5 xl:table-cell">
        <ModeLabel mode={meeting.mode} />
      </td>
      <td className="px-3 py-2.5">
        <span className="flex">
          {participantIds.slice(0, 4).map((userId, index) => {
            const person = people.find((candidate) => candidate.userId === userId);
            return (
              <span key={userId} title={person?.name} className={cn('rounded-full border-2 border-card', index > 0 && '-ml-1.5')}>
                <Avatar seed={userId} name={person?.name ?? '?'} size={22} />
              </span>
            );
          })}
          {participantIds.length > 4 && (
            <span className="-ml-1.5 grid h-[26px] min-w-[26px] place-items-center rounded-full border-2 border-card bg-muted px-1 text-[9px] font-extrabold text-muted-foreground">
              +{participantIds.length - 4}
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <ResponsesCell meeting={meeting} />
      </td>
      <td className="hidden px-3 py-2.5 xl:table-cell">
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-bold', tone.text)}>
          <span aria-hidden className="flex items-end gap-0.5">
            {[6, 8, 10, 12].map((height, index) => (
              <em key={height} className={cn('w-[3px] rounded-[1px]', index < tone.bars ? tone.fill : 'bg-muted')} style={{ height }} />
            ))}
          </span>
          {meeting.priority}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold', minutesTone(minutes))}>
          <FileText className="h-3.5 w-3.5" aria-hidden />
          {MINUTES_LABEL[minutes]}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', STATUS_CHIP[meeting.status])}>
          <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {meeting.status}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span className="flex justify-end gap-1">
          {onRemind && (
            <button
              type="button"
              title="Remind the people who haven’t replied"
              aria-label={`Remind non-responders for ${meeting.title}`}
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onRemind();
              }}
              className="grid h-[30px] w-[30px] place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Bell className="h-[15px] w-[15px]" />
            </button>
          )}
          <Link
            href={`${BASE}/meetings/${meeting.id}`}
            onClick={(event) => event.stopPropagation()}
            title="Open the meeting"
            aria-label={`Open ${meeting.title}`}
            className="grid h-[30px] w-[30px] place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-[15px] w-[15px]" />
          </Link>
        </span>
      </td>
    </tr>
  );
}

function MeetingCard({
  meeting,
  repeats,
  selected,
  onSelect,
  onOpen,
  today,
}: {
  meeting: OfficeHubMeeting;
  repeats: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  today: string;
}) {
  const cancelled = meeting.status === 'Cancelled' || meeting.status === 'Postponed';
  const minutes = minutesState(meeting);
  return (
    <li className={cn('flex items-start gap-2.5 border-b px-3.5 py-3', selected && 'bg-primary/[0.06]')}>
      <span className="pt-3">
        <CheckBox checked={selected} onChange={onSelect} label={`Select ${meeting.title}`} />
      </span>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
        <DateTile date={meeting.date} muted={cancelled} />
        <span className="min-w-0 flex-1">
          <b className={cn('block truncate text-[13px]', cancelled && 'text-muted-foreground line-through')}>{meeting.title}</b>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {whenLabel(meeting.date, today)} · {formatClockTime(meeting.startTime, { lowercaseMeridiem: true })} · {meeting.organizerName}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-bold', STATUS_CHIP[meeting.status])}>{meeting.status}</span>
            {!cancelled && <span className="text-[11px] text-muted-foreground">{responseLine(meeting.responseSummary).text}</span>}
            {minutes === 'due' && <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">Minutes due</span>}
            {repeats > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                <Repeat className="h-3 w-3" aria-hidden />+{repeats} more
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
