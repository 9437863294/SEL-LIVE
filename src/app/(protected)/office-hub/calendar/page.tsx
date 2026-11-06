'use client';

/**
 * The calendar route (§8). Redesigned 2026-11-06 from the user's mockup (`sel-calendar-redesign.html`):
 * a band with the month's figures, a side rail (mini month, what to show, what the styles mean,
 * holidays ahead), and the views with search, jump-to-date and a drawer for whatever is clicked.
 *
 * ── Reads ───────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Meetings for the chosen "Show" scope over a window wider than any view needs from the anchor,
 *     so switching views or paging a week rarely refetches.
 *   • My invitation rows that are not Accepted (`listMyUnacceptedResponses`), which turns each
 *     meeting into *my* state: going, waiting for my reply, declined, cancelled.
 *   • Task deadlines (mine, or everyone's when showing everyone's meetings and allowed to).
 *
 * A drag-reschedule goes through `updateMeeting`, the same path as the form, so participants are
 * notified, reminders rebuilt, and the audit trail records it as a reschedule.
 *
 * Left out from the mockup on purpose: its "Your data / A busy month" preview switch, "End series"
 * in the drawer (that is on the meeting's page, where it asks how far to go), and colours per meeting
 * type (configurable types outnumber any safe palette — state is what is coloured instead).
 */

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarPlus, ChevronLeft, ChevronRight, Move, Repeat, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  CALENDAR_VIEWS,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_WEEKDAYS,
  addDays,
  calendarMeetingState,
  calendarMonthSummary,
  canEditMeeting,
  canEditTask,
  clockToMinutes,
  endOfMonth,
  formatHours,
  formatIsoDate,
  isDismissedState,
  isTaskOverdue,
  meetingJoinView,
  meetingMatches,
  meetingSpan,
  meetingTimeState,
  startOfMonth,
  startOfWeek,
  utcToZonedParts,
  weekdayOf,
  type CalendarView,
  type OfficeHubMeeting,
  type OfficeHubTask,
} from '@/lib/office-hub';
import {
  listMeetings,
  listMyTasks,
  listMyUnacceptedResponses,
  listTasks,
  respondToInvitation,
  setTaskStatus,
  updateMeeting,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import { OfficeHubAccessDenied, useTickingNow } from '@/components/office-hub/ui';
import { MiniSegmented } from '@/components/office-hub/dashboard-parts';
import {
  AgendaView,
  MiniMonth,
  MonthView,
  TimeGridView,
  monthTitle,
  type CalendarHoliday,
  type CalendarItem,
} from '@/components/office-hub/meeting-calendar';
import { CalendarDrawer } from '@/components/office-hub/calendar-drawer';

type Scope = 'mine' | 'organized' | 'team' | 'department' | 'all';
const BASE = OFFICE_HUB_BASE_PATH;
const VIEW_LABEL: Record<CalendarView, string> = { day: 'Day', week: 'Week', month: 'Month', agenda: 'Agenda' };

export default function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = useTickingNow(60_000);
  const { actor, viewer, capabilities, settings, userSettings, directory, today, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [view, setView] = useState<CalendarView>(
    (searchParams?.get('view') as CalendarView) ?? userSettings?.defaultCalendarView ?? 'month',
  );
  const [anchor, setAnchor] = useState(searchParams?.get('date') ?? today);
  const [scope, setScope] = useState<Scope>('mine');
  const [layers, setLayers] = useState({ meetings: true, tasks: true, holidays: true });
  const [showDismissed, setShowDismissed] = useState(true);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const timeZone = viewer.timeZone ?? settings.defaultTimeZone;

  /** Wider than any view needs from the anchor: a month grid spans six weeks, agenda 31 days. */
  const range = useMemo(() => {
    const from = addDays(startOfWeek(startOfMonth(anchor)), -7);
    const monthEnd = addDays(endOfMonth(anchor), 21);
    const agendaEnd = addDays(anchor, 35);
    return { from, to: monthEnd > agendaEnd ? monthEnd : agendaEnd };
  }, [anchor]);

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
    () => listMeetings(effectiveScope, viewer, { fromDate: range.from, toDate: range.to, limit: 500 }),
    [effectiveScope, viewer.userId, viewer.departmentId, range.from, range.to],
    { enabled: Boolean(actor) && capabilities.canViewCalendar, initial: [] },
  );
  const responsesQuery = useOfficeHubQuery(() => listMyUnacceptedResponses(viewer.userId), [viewer.userId], {
    enabled: Boolean(actor),
    initial: new Map(),
  });
  const tasksQuery = useOfficeHubQuery(
    () =>
      effectiveScope === 'all' && capabilities.canViewAllTasks
        ? listTasks('all', viewer, { limit: 400 })
        : listMyTasks(viewer.userId, { limit: 400 }),
    [effectiveScope, viewer.userId, capabilities.canViewAllTasks],
    { enabled: Boolean(actor) && capabilities.canViewTasks, initial: [] },
  );

  const holidays = useMemo(() => {
    const map = new Map<string, CalendarHoliday>();
    for (const holiday of settings.holidays ?? []) map.set(holiday.date, { date: holiday.date, name: holiday.name });
    return map;
  }, [settings.holidays]);

  /* ── everything on the calendar, with my state on each meeting ── */
  const allItems = useMemo(() => {
    const responses = responsesQuery.data ?? new Map();
    const items: CalendarItem[] = [];
    for (const meeting of meetingsQuery.data ?? []) {
      if (meeting.isDeleted) continue;
      const state = calendarMeetingState(meeting, { viewerId: viewer.userId, responses });
      const span = meetingSpan(meeting);
      items.push({
        kind: 'meeting',
        id: meeting.id,
        date: meeting.date,
        title: meeting.title,
        start: span.start,
        end: span.end,
        meeting,
        state,
        live: meetingTimeState(meeting, now) === 'live',
        draggable:
          capabilities.canRescheduleFromCalendar && meeting.status !== 'Cancelled' && meeting.status !== 'Completed' && state !== 'declined',
      });
    }
    for (const task of tasksQuery.data ?? []) {
      if (!task.dueDate || task.status === 'Cancelled' || task.isDeleted) continue;
      items.push({
        kind: 'task',
        id: `task-${task.id}`,
        date: task.dueDate,
        title: task.title,
        task,
        state: task.status === 'Completed' ? 'done' : isTaskOverdue(task, today) ? 'late' : 'due',
      });
    }
    return items;
  }, [meetingsQuery.data, responsesQuery.data, tasksQuery.data, viewer.userId, capabilities.canRescheduleFromCalendar, now, today]);

  /** What the layers, the declined switch and the search leave on screen, by date. */
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of allItems) {
      if (item.kind === 'meeting') {
        if (!layers.meetings) continue;
        if (!showDismissed && isDismissedState(item.state)) continue;
        if (!meetingMatches(item.meeting, search)) continue;
      } else {
        if (!layers.tasks) continue;
        if (search.trim() && !item.title.toLowerCase().includes(search.trim().toLowerCase())) continue;
      }
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.kind === 'task' ? 1 : 0) - (b.kind === 'task' ? 1 : 0) || (a.kind === 'meeting' && b.kind === 'meeting' ? a.start - b.start : 0));
    }
    return map;
  }, [allItems, layers, showDismissed, search]);
  const shownHolidays = layers.holidays ? holidays : new Map<string, CalendarHoliday>();

  const meetingItems = allItems.filter((item): item is Extract<CalendarItem, { kind: 'meeting' }> => item.kind === 'meeting');
  const summary = calendarMonthSummary({
    anchor,
    meetings: meetingItems.map((item) => ({ date: item.date, state: item.state, minutes: item.end - item.start })),
    tasks: (tasksQuery.data ?? []).filter((task) => !task.isDeleted),
    holidays: settings.holidays ?? [],
  });
  const monthFrom = startOfMonth(anchor);
  const monthTo = endOfMonth(anchor);
  const monthMeetings = meetingItems.filter((item) => item.date >= monthFrom && item.date <= monthTo);
  const monthTasks = allItems.filter((item) => item.kind === 'task' && item.date >= monthFrom && item.date <= monthTo).length;
  const allDismissed = monthMeetings.length > 0 && monthMeetings.every((item) => isDismissedState(item.state));
  const dismissedSeries = new Set(monthMeetings.filter((item) => item.meeting.seriesId).map((item) => item.meeting.seriesId)).size;

  const marks = useMemo(() => {
    const map = new Map<string, { meeting: boolean; task: boolean }>();
    for (const item of allItems) {
      if (item.kind === 'meeting' && isDismissedState(item.state)) continue;
      const mark = map.get(item.date) ?? { meeting: false, task: false };
      if (item.kind === 'meeting') mark.meeting = true;
      else if (item.state !== 'done') mark.task = true;
      map.set(item.date, mark);
    }
    return map;
  }, [allItems]);

  const zoned = utcToZonedParts(now, timeZone);
  const nowMinute = zoned.date === today ? clockToMinutes(zoned.time) : null;

  /* ── navigation ── */
  const changeView = (next: CalendarView) => {
    setView(next);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('view', next);
    router.replace(`${BASE}/calendar?${params.toString()}`, { scroll: false });
  };
  const step = (direction: -1 | 1) => {
    if (view === 'day') return setAnchor(addDays(anchor, direction));
    if (view === 'week') return setAnchor(addDays(anchor, 7 * direction));
    if (view === 'agenda') return setAnchor(addDays(anchor, 31 * direction));
    setAnchor(startOfMonth(direction === 1 ? addDays(endOfMonth(anchor), 1) : addDays(startOfMonth(anchor), -1)));
  };
  const stepMonth = (direction: -1 | 1) =>
    setAnchor(startOfMonth(direction === 1 ? addDays(endOfMonth(anchor), 1) : addDays(startOfMonth(anchor), -1)));
  const showDay = (date: string) => {
    setAnchor(date);
    changeView('day');
  };
  const pickSlot = capabilities.canCreateMeeting
    ? (date: string, time?: string) => router.push(`${BASE}/meetings/new?date=${date}${time ? `&time=${time}` : ''}`)
    : undefined;

  const periodTitle =
    view === 'month'
      ? monthTitle(anchor)
      : view === 'week'
        ? `${formatIsoDate(startOfWeek(anchor), { year: false })} – ${formatIsoDate(addDays(startOfWeek(anchor), 6))}`
        : view === 'day'
          ? `${OFFICE_HUB_WEEKDAYS[weekdayOf(anchor)].name}, ${formatIsoDate(anchor)}`
          : `From ${formatIsoDate(anchor)}`;

  /* ── actions ── */
  const reschedule = useCallback(
    async (meeting: OfficeHubMeeting, toDate: string) => {
      if (!actor) return;
      const done = await run(
        async () => {
          await updateMeeting(actor, meeting.id, { date: toDate }, { settings, reason: 'Rescheduled from the calendar', scope: 'occurrence' });
          return true;
        },
        {
          success: `“${meeting.title}” moved to ${formatIsoDate(toDate, { withWeekday: true, year: false })} · participants notified`,
          failure: 'Could not reschedule the meeting',
          describe: 'Reschedule meeting',
        },
      );
      if (done) meetingsQuery.reload();
    },
    [actor, run, settings, meetingsQuery],
  );

  const openItem = allItems.find((item) => item.id === openId) ?? null;
  const openMeeting = openItem?.kind === 'meeting' ? openItem.meeting : null;
  const invited = Boolean(openMeeting && openMeeting.organizerId !== viewer.userId && (openMeeting.participantUserIds ?? []).includes(viewer.userId));
  const myResponse = openMeeting && invited ? responsesQuery.data?.get(openMeeting.id) ?? 'Accepted' : null;
  const join = openMeeting ? meetingJoinView(openMeeting, viewer.userId, { canViewAllMeetings: capabilities.canViewAllMeetings, now }) : null;

  const reply = async (response: 'Accepted' | 'Maybe' | 'Declined') => {
    if (!actor || !openMeeting) return;
    const done = await run(
      async () => {
        await respondToInvitation(actor, openMeeting.id, response, { settings });
        return true;
      },
      {
        success: response === 'Accepted' ? 'Accepted · the organizer is told' : response === 'Declined' ? 'Declined · the organizer is told' : 'Marked as maybe',
        failure: 'Could not send your reply',
        describe: 'Respond to invitation',
      },
    );
    if (done) responsesQuery.reload();
  };

  const completeTask = async (task: OfficeHubTask) => {
    if (!actor) return;
    const done = await run(
      async () => {
        await setTaskStatus(actor, task.id, 'Completed', { settings });
        return true;
      },
      { success: 'Task marked done', failure: 'Could not mark the task done', describe: 'Complete task' },
    );
    if (done) {
      tasksQuery.reload();
      setOpenId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-[20px]" />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[286px_minmax(0,1fr)]">
          <Skeleton className="h-80 rounded-[18px]" />
          <Skeleton className="h-[32rem] rounded-[18px]" />
        </div>
      </div>
    );
  }
  if (!capabilities.canViewCalendar) return <OfficeHubAccessDenied what="the calendar" />;

  const loading = meetingsQuery.isLoading || responsesQuery.isLoading;
  const upcomingHolidays = (settings.holidays ?? []).filter((holiday) => holiday.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  const figures: { label: string; value: number; note?: string }[] = [
    { label: 'Meetings', value: summary.going, note: summary.goingMinutes ? formatHours(summary.goingMinutes) : undefined },
    { label: 'Reply needed', value: summary.pending },
    { label: 'Cancelled or declined', value: summary.dismissed },
    { label: 'Task deadlines', value: summary.tasksDue },
    { label: 'Holidays', value: summary.holidays },
  ];

  return (
    <div className="space-y-3.5">
      {/* ── band ── */}
      <section className="oh-hero oh-hero--glow keep-light relative flex flex-wrap items-center gap-4 overflow-hidden rounded-[20px] px-4 py-4 text-white sm:px-6">
        <div aria-hidden className="wd-hero-dots pointer-events-none absolute inset-0" />
        <div className="relative min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-violet-100">Office Hub · Calendar · {timeZone}</div>
          <h1 className="mt-0.5 text-[23px] font-extrabold tracking-tight">Calendar</h1>
          <p className="text-[12.5px] text-indigo-100">Meetings, task deadlines and holidays in one place</p>
        </div>
        <span className="hidden flex-1 lg:block" />
        <div className="relative flex flex-wrap gap-2" aria-label={`${monthTitle(anchor)} at a glance`}>
          {figures.map((figure) => (
            <div key={figure.label} className="min-w-[104px] rounded-[14px] border border-white/20 bg-white/10 px-3.5 py-2">
              <small className="block text-[11px] font-semibold text-violet-100">{figure.label}</small>
              <b className="text-xl font-extrabold leading-tight">{loading ? '–' : figure.value}</b>
              {figure.note && <span className="ml-1 text-[11px] text-indigo-200">{figure.note}</span>}
            </div>
          ))}
        </div>
        {capabilities.canCreateMeeting && (
          <Link
            href={`${BASE}/meetings/new?date=${anchor < today ? today : anchor}`}
            className="relative flex items-center gap-1.5 rounded-[11px] border border-white bg-white px-3.5 py-2 text-[13px] font-bold text-violet-900 hover:bg-violet-50"
          >
            <CalendarPlus className="h-4 w-4" aria-hidden />
            Schedule meeting
          </Link>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[286px_minmax(0,1fr)]">
        {/* ── rail ── */}
        <aside className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-[18px] border bg-card p-3.5">
            <MiniMonth
              anchor={anchor}
              selected={anchor}
              today={today}
              marks={marks}
              holidays={holidays}
              settings={settings}
              onStep={stepMonth}
              onPick={(date) => {
                setAnchor(date);
                if (view === 'month') changeView('day');
              }}
            />
          </div>

          <div className="rounded-[18px] border bg-card p-3.5">
            <label className="mb-1 block text-[11px] font-bold text-muted-foreground">Show</label>
            <Select value={effectiveScope} onValueChange={(next) => setScope(next as Scope)}>
              <SelectTrigger className="h-9 rounded-[10px] text-left">
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
            <h5 className="mb-1.5 mt-3.5 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">On the calendar</h5>
            {(
              [
                ['meetings', 'Meetings', 'bg-primary', monthMeetings.length],
                ['tasks', 'Task deadlines', 'bg-amber-500', monthTasks],
                ['holidays', 'Holidays', 'bg-pink-500', summary.holidays],
              ] as const
            ).map(([key, label, colour, count]) => (
              <button
                key={key}
                type="button"
                role="checkbox"
                aria-checked={layers[key]}
                onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
                className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left hover:bg-muted"
              >
                <span
                  aria-hidden
                  className={cn('grid h-[18px] w-[18px] place-items-center rounded-md text-white', layers[key] ? colour : 'border-2 border-muted-foreground/40')}
                >
                  {layers[key] && <span className="text-[11px] font-black leading-none">✓</span>}
                </span>
                <span className="flex-1 text-[13px] font-semibold">{label}</span>
                <em className="rounded-full bg-muted px-2 text-[11px] font-bold not-italic text-muted-foreground">{count}</em>
              </button>
            ))}
            {capabilities.canViewTasks ? null : (
              <p className="mt-1 text-[11px] text-muted-foreground">Task deadlines need access to Office Hub tasks.</p>
            )}
          </div>

          <div className="rounded-[18px] border bg-card p-3.5">
            <h5 className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">What the styles mean</h5>
            <div className="space-y-1.5 text-xs font-semibold text-muted-foreground">
              <div className="flex items-center gap-2">
                <span aria-hidden className="h-3.5 w-[30px] shrink-0 rounded border-l-[3px] border-l-primary bg-primary/15" />
                Going (you accepted or organise it)
              </div>
              <div className="flex items-center gap-2">
                <span aria-hidden className="oh-cal-pending h-3.5 w-[30px] shrink-0 rounded border-0 border-l-[3px] border-dashed border-l-primary" />
                Waiting for your reply
              </div>
              <div className="flex items-center gap-2">
                <span aria-hidden className="h-3.5 w-[30px] shrink-0 rounded border-l-[3px] border-l-muted-foreground/40 bg-muted" />
                Declined or cancelled
              </div>
              {effectiveScope !== 'mine' && (
                <div className="flex items-center gap-2">
                  <span aria-hidden className="h-3.5 w-[30px] shrink-0 rounded border-l-[3px] border-l-sky-600 bg-sky-500/15" />
                  Someone else’s meeting
                </div>
              )}
              <div className="flex items-center gap-2">
                <span aria-hidden className="ml-2 mr-2 h-3.5 w-3.5 shrink-0 rounded border-2 border-amber-500" />
                Task deadline
              </div>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Switch checked={showDismissed} onCheckedChange={setShowDismissed} />
              Show declined &amp; cancelled
            </label>
          </div>

          <div className="rounded-[18px] border bg-card p-3.5">
            <h5 className="mb-1 flex items-center text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
              Holidays ahead
              {capabilities.canEditSettings && (
                <Link href={`${BASE}/settings`} className="ml-auto text-[11.5px] normal-case tracking-normal text-primary hover:underline">
                  + Add holidays
                </Link>
              )}
            </h5>
            {upcomingHolidays.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                No holidays set{capabilities.canEditSettings ? ' — add the office’s list in Office Hub settings.' : '.'}
              </p>
            ) : (
              upcomingHolidays.map((holiday, index) => (
                <div key={holiday.date} className={cn('flex items-center gap-2.5 py-1.5', index > 0 && 'border-t border-dashed')}>
                  <div className="w-[38px] shrink-0 rounded-[9px] bg-pink-500/10 py-0.5 text-center text-pink-700 dark:text-pink-300">
                    <b className="block text-sm leading-tight">{Number(holiday.date.slice(8, 10))}</b>
                    <small className="text-[9px] font-extrabold uppercase">{formatIsoDate(holiday.date, { year: false }).split(' ')[1]}</small>
                  </div>
                  <div className="min-w-0">
                    <strong className="block truncate text-[12.5px] leading-snug">{holiday.name}</strong>
                    <span className="text-[11px] text-muted-foreground">{OFFICE_HUB_WEEKDAYS[weekdayOf(holiday.date)].name}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ── main ── */}
        <section className="min-w-0 overflow-hidden rounded-[18px] border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-3.5">
            <Button type="button" size="icon" variant="outline" className="h-8 w-8 rounded-[9px]" onClick={() => step(-1)} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="outline" className="h-8 w-8 rounded-[9px]" onClick={() => step(1)} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-[9px] font-bold" onClick={() => setAnchor(today)}>
              Today
            </Button>
            <h2 className="mx-1 min-w-0 truncate text-[17px] font-extrabold tracking-tight sm:text-[19px]">{periodTitle}</h2>
            <span className="hidden flex-1 md:block" />
            <label className="flex h-8 w-full items-center gap-1.5 rounded-[10px] border px-2.5 text-muted-foreground md:w-56">
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search meetings, people, places…"
                aria-label="Search the calendar"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
            <label className="flex h-8 items-center gap-1.5 rounded-[9px] border px-2 text-xs font-bold">
              Jump to
              <input
                type="date"
                value={anchor}
                onChange={(event) => event.target.value && setAnchor(event.target.value)}
                aria-label="Jump to date"
                className="bg-transparent text-xs font-semibold outline-none"
              />
            </label>
            <MiniSegmented
              label="Calendar view"
              value={view}
              onChange={changeView}
              options={CALENDAR_VIEWS.map((entry) => ({ value: entry, label: VIEW_LABEL[entry] }))}
            />
          </div>

          {view === 'month' && allDismissed && (
            <div className="m-3.5 flex flex-wrap items-center gap-3 rounded-[14px] bg-gradient-to-r from-primary/10 to-blue-500/10 px-3.5 py-3 text-[12.5px]">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-violet-300 to-violet-700 text-white">
                <Repeat className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <b className="block text-[13px]">
                  All {monthMeetings.length} meetings in {monthTitle(anchor)} are cancelled or declined.
                </b>
                {dismissedSeries > 0
                  ? `They come from ${dismissedSeries} repeating series. Ending a series on its meeting page stops it filling the calendar.`
                  : 'Nothing on the calendar this month needs you.'}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowDismissed((current) => !current)}>
                {showDismissed ? 'Hide them' : 'Show them'}
              </Button>
            </div>
          )}

          {loading ? (
            <div className="p-3.5">
              <Skeleton className="h-[30rem] w-full rounded-xl" />
            </div>
          ) : view === 'month' ? (
            <MonthView
              anchor={anchor}
              byDate={byDate}
              holidays={shownHolidays}
              settings={settings}
              today={today}
              onOpen={(item) => setOpenId(item.id)}
              onShowDay={showDay}
              onPickSlot={pickSlot}
              onReschedule={capabilities.canRescheduleFromCalendar && !search.trim() ? reschedule : undefined}
            />
          ) : view === 'agenda' ? (
            <AgendaView anchor={anchor} byDate={byDate} holidays={shownHolidays} today={today} onOpen={(item) => setOpenId(item.id)} />
          ) : (
            <TimeGridView
              days={view === 'day' ? [anchor] : Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index))}
              byDate={byDate}
              holidays={shownHolidays}
              settings={settings}
              today={today}
              nowMinute={nowMinute}
              onOpen={(item) => setOpenId(item.id)}
              onPickSlot={pickSlot}
            />
          )}

          <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5 text-xs text-muted-foreground">
            <Move className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            {capabilities.canRescheduleFromCalendar
              ? 'Drag a meeting to another day in Month view to reschedule it. The time stays the same, participants are notified and reminders move with it.'
              : 'Click a meeting or deadline to see it, and a day or an empty hour to schedule something there.'}
          </div>
        </section>
      </div>

      <CalendarDrawer
        item={openItem}
        onClose={() => setOpenId(null)}
        people={directory.people}
        myResponse={myResponse}
        canReply={Boolean(invited && openMeeting && openMeeting.status !== 'Cancelled' && openMeeting.status !== 'Completed')}
        canEdit={Boolean(openMeeting && canEditMeeting(openMeeting, viewer, capabilities).allowed)}
        joinUrl={join?.canJoin && join.url ? join.url : null}
        canCompleteTask={Boolean(openItem?.kind === 'task' && canEditTask(openItem.task, viewer, capabilities).allowed)}
        busy={isBusy}
        onReply={(response) => void reply(response)}
        onCompleteTask={() => openItem?.kind === 'task' && void completeTask(openItem.task)}
      />
    </div>
  );
}
