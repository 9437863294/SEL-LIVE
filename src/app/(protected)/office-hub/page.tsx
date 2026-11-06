'use client';

/**
 * The Office Hub dashboard (§7). Redesigned 2026-11-06 from the user's mockup
 * (`sel-office-hub-dashboard.html`): a band with the day's summary and quick actions, then
 * Meetings, Tasks and Schedule sections of figures and charts.
 *
 * ── Whose dashboard ─────────────────────────────────────────────────────────────────────────────
 *
 * Personal throughout: *my* meetings, *my* replies, *my* tasks. The office-wide picture is Reports,
 * Workload and the Management Overview, each a sidebar entry of its own.
 *
 * ── Reads ───────────────────────────────────────────────────────────────────────────────────────
 *
 *   1. My meetings, eight weeks back and five forward (two indexed queries, so a busy calendar
 *      cannot crowd the future out of a single limit).
 *   2. My invitation rows that are *not* Accepted — with (1) that gives my reply to every meeting
 *      (`myMeetings`), without a read per meeting.
 *   3. My tasks, my open action items, and the decisions I own.
 *
 * Everything else — every count, chart and list — is derived in `office-hub-dashboard.ts`, which is
 * unit-tested, so the figures here are not eyeballed.
 *
 * What the mockup had and this leaves out: its "Your data / A busy week" preview switch (sample
 * data has no place on a working screen), "Block focus time" (there is no such thing to create),
 * and per-category colours (meeting types are configurable and can outnumber any safe palette).
 */

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import {
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckSquare,
  Clock,
  Gavel,
  Hourglass,
  Inbox,
  PieChart,
  Radio,
  TriangleAlert,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  addDays,
  buildTaskStatistics,
  clockToMinutes,
  dailyMeetingCounts,
  daysFrom,
  describeResponses,
  dueOffset,
  formatClockTime,
  formatHours,
  formatIsoDate,
  invitationBoard,
  isGoing,
  isOpenActionItemStatus,
  isTaskClosed,
  meetingJoinView,
  meetingTimeState,
  minutesByType,
  myMeetings,
  OFFICE_HUB_WEEKDAYS,
  utcToZonedParts,
  weekdayOf,
  weeklyTaskFlow,
  workingMinutesPerWeek,
  type MyMeeting,
  type OfficeHubActionItem,
  type OfficeHubMeeting,
  type OfficeHubTask,
} from '@/lib/office-hub';
import {
  listActionItems,
  listDecisions,
  listMeetings,
  listMyTasks,
  listMyUnacceptedResponses,
  respondToInvitation,
  tidyPastInvitations,
  updateActionItem,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import { OfficeHubCallout, useTickingNow } from '@/components/office-hub/ui';
import { Avatar } from '@/components/office-hub/meeting-form-parts';
import {
  AppTile,
  CardLink,
  DashCard,
  DateTile,
  DayTimeline,
  Donut,
  EmptyNote,
  HBars,
  KpiTile,
  Legend,
  MiniSegmented,
  SectionLabel,
  StatTrio,
  TrendLines,
  WeekBars,
  type TimelineEvent,
} from '@/components/office-hub/dashboard-parts';

const BASE = OFFICE_HUB_BASE_PATH;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type TaskFilter = 'all' | 'notStarted' | 'inProgress' | 'completed' | 'overdue' | 'dueToday';

export default function OfficeHubDashboardPage() {
  const { actor, viewer, capabilities, settings, userSettings, directory, today, periods, isLoading, refreshUserSettings } =
    useOfficeHub();
  const now = useTickingNow();
  const { isBusy, run } = useOfficeHubAction();

  const [invitationView, setInvitationView] = useState<'upcoming' | 'past'>('upcoming');
  const [fromMeetings, setFromMeetings] = useState<'actions' | 'decisions'>('actions');
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');
  /** Rows answered or dismissed this visit, hidden at once rather than after the re-read. */
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());

  const windowFrom = addDays(today, -56);
  const windowTo = addDays(today, 35);

  /* ── reads ── */
  const meetingsQuery = useOfficeHubQuery(
    async () => {
      // Two queries, so a crowded past can never push the coming weeks out of one limit.
      const [past, ahead] = await Promise.all([
        listMeetings('mine', viewer, { fromDate: windowFrom, toDate: addDays(today, -1), direction: 'desc', limit: 300 }),
        listMeetings('mine', viewer, { fromDate: today, toDate: windowTo, direction: 'asc', limit: 300 }),
      ]);
      return [...past, ...ahead];
    },
    [viewer.userId, windowFrom, windowTo, today],
    { enabled: Boolean(actor), initial: [] },
  );
  const responsesQuery = useOfficeHubQuery(() => listMyUnacceptedResponses(viewer.userId), [viewer.userId], {
    enabled: Boolean(actor),
    initial: new Map(),
  });
  const tasksQuery = useOfficeHubQuery(() => listMyTasks(viewer.userId, { limit: 300 }), [viewer.userId], {
    enabled: Boolean(actor) && capabilities.canViewTasks,
    initial: [],
  });
  const actionItemsQuery = useOfficeHubQuery(
    () => listActionItems({ responsibleUserId: viewer.userId, limit: 100 }),
    [viewer.userId],
    { enabled: Boolean(actor) && capabilities.canViewActionItems, initial: [] },
  );
  const decisionsQuery = useOfficeHubQuery(() => listDecisions({ ownerId: viewer.userId, limit: 30 }), [viewer.userId], {
    enabled: Boolean(actor) && capabilities.canViewDecisions && fromMeetings === 'decisions',
    initial: [],
  });

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const nowMs = now.getTime();
  const zoned = utcToZonedParts(now, viewer.timeZone ?? settings.defaultTimeZone);
  const nowMinute = zoned.date === today ? clockToMinutes(zoned.time) : null;

  /* ── meetings ── */
  const mine = useMemo(
    () => myMeetings(meetingsQuery.data ?? [], { viewerId: viewer.userId, responses: responsesQuery.data ?? new Map() }),
    [meetingsQuery.data, responsesQuery.data, viewer.userId],
  );
  const board = useMemo(
    () =>
      invitationBoard(mine, {
        nowMs,
        hiddenMeetingIds: userSettings?.hiddenInvitationMeetingIds,
        pastClearedAt: userSettings?.pastInvitationsClearedAt,
      }),
    [mine, nowMs, userSettings?.hiddenInvitationMeetingIds, userSettings?.pastInvitationsClearedAt],
  );
  const upcomingInvites = board.upcoming.filter((entry) => !settled.has(entry.meeting.id));
  const pastInvites = board.past.filter((entry) => !settled.has(entry.meeting.id));
  const waiting = upcomingInvites.length + pastInvites.length;

  const next7 = useMemo(() => daysFrom(today, 7), [today]);
  const ahead = useMemo(() => dailyMeetingCounts(mine, next7), [mine, next7]);
  const last7 = useMemo(() => dailyMeetingCounts(mine, daysFrom(addDays(today, -6), 7)), [mine, today]);
  const thisWeek = useMemo(() => dailyMeetingCounts(mine, daysFrom(periods.weekStart, 7)), [mine, periods.weekStart]);

  const todays = mine.filter((entry) => entry.meeting.date === today && entry.response !== 'Declined');
  const nextToday = todays.find((entry) => Date.parse(entry.meeting.endAt) > nowMs);
  const goingAhead = ahead.reduce((sum, day) => sum + day.going, 0);
  const weekMinutes = thisWeek.reduce((sum, day) => sum + day.minutes, 0);
  const weekCapacity = workingMinutesPerWeek(settings);

  const organisedThisMonth = mine.filter(
    (entry) => entry.response === 'Organizer' && entry.meeting.date >= periods.monthStart && entry.meeting.date <= periods.monthEnd,
  );
  const organisedAcceptance = useMemo(() => {
    let accepted = 0;
    let asked = 0;
    for (const entry of organisedThisMonth) {
      const summary = entry.meeting.responseSummary;
      if (!summary) continue;
      accepted += summary.accepted;
      asked += summary.accepted + summary.maybe + summary.declined + summary.noResponse;
    }
    return asked ? Math.round((accepted / asked) * 100) : null;
  }, [organisedThisMonth]);
  const organisedPerWeek = Array.from({ length: 7 }, (_, index) => {
    const to = addDays(today, -7 * (6 - index));
    const from = addDays(to, -6);
    return mine.filter((entry) => entry.response === 'Organizer' && entry.meeting.date >= from && entry.meeting.date <= to).length;
  });

  const live = todays
    .filter((entry) => {
      const state = meetingTimeState(entry.meeting, now, 60);
      return state === 'live' || state === 'starting-soon';
    })
    .slice(0, 2);

  /* ── tasks ── */
  const taskStats = useMemo(() => buildTaskStatistics(tasks, today), [tasks, today]);
  const openTasks = taskStats.notStarted + taskStats.inProgress + taskStats.onHold;
  const flow = useMemo(
    () => weeklyTaskFlow(tasks, { today, timeZone: viewer.timeZone ?? settings.defaultTimeZone }),
    [tasks, today, viewer.timeZone, settings.defaultTimeZone],
  );
  const filteredTasks = useMemo(() => {
    const matches = (task: OfficeHubTask) => {
      switch (taskFilter) {
        case 'notStarted':
          return task.status === 'Not Started';
        case 'inProgress':
          return task.status === 'In Progress';
        case 'completed':
          return task.status === 'Completed';
        case 'overdue':
          return !isTaskClosed(task.status) && Boolean(task.dueDate) && (task.dueDate as string) < today;
        case 'dueToday':
          return !isTaskClosed(task.status) && task.dueDate === today;
        default:
          return !isTaskClosed(task.status);
      }
    };
    return tasks
      .filter(matches)
      .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'))
      .slice(0, 7);
  }, [tasks, taskFilter, today]);

  const openActionItems = useMemo(
    () =>
      (actionItemsQuery.data ?? [])
        .filter((item) => isOpenActionItemStatus(item.status) && !settled.has(item.id))
        .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')),
    [actionItemsQuery.data, settled],
  );
  const openDecisions = (decisionsQuery.data ?? []).filter((decision) => decision.status === 'Open' || decision.status === 'In Progress');

  /* ── schedule ── */
  const upcomingGoing = mine.filter((entry) => entry.meeting.date > today && entry.meeting.date <= addDays(today, 7) && isGoing(entry.response));
  const byType = useMemo(() => minutesByType(mine, { from: periods.weekStart, to: periods.weekEnd, maxTypes: 6 }), [mine, periods]);
  const weekGoing = mine.filter((entry) => entry.meeting.date >= periods.weekStart && entry.meeting.date <= periods.weekEnd && isGoing(entry.response));
  const longest = weekGoing.reduce((max, entry) => Math.max(max, entry.minutes), 0);

  /* ── actions ── */
  const settle = (id: string) => setSettled((current) => new Set(current).add(id));

  const reply = async (entry: MyMeeting, response: 'Accepted' | 'Maybe' | 'Declined') => {
    if (!actor) return;
    const done = await run(
      async () => {
        await respondToInvitation(actor, entry.meeting.id, response, { settings });
        return true;
      },
      {
        success: response === 'Accepted' ? 'Accepted · added to your calendar' : response === 'Declined' ? 'Declined · the organizer is told' : 'Marked as maybe',
        failure: 'Could not send your reply',
        describe: 'Respond to invitation',
      },
    );
    if (done) {
      settle(entry.meeting.id);
      responsesQuery.reload();
    }
  };

  const dismiss = async (entry: MyMeeting) => {
    if (!actor) return;
    settle(entry.meeting.id);
    const done = await run(
      async () => {
        await tidyPastInvitations(actor, { meetingId: entry.meeting.id, alreadyHidden: userSettings?.hiddenInvitationMeetingIds ?? [] });
        return true;
      },
      { failure: 'Could not dismiss that invitation', describe: 'Dismiss invitation' },
    );
    if (done) void refreshUserSettings();
  };

  const clearPast = async () => {
    if (!actor) return;
    const count = pastInvites.length;
    const done = await run(
      async () => {
        await tidyPastInvitations(actor, { clearAll: true });
        return true;
      },
      { success: `Cleared ${count} past invitation${count === 1 ? '' : 's'}`, failure: 'Could not clear them', describe: 'Clear past invitations' },
    );
    if (done) {
      pastInvites.forEach((entry) => settle(entry.meeting.id));
      setInvitationView('upcoming');
      void refreshUserSettings();
    }
  };

  const completeActionItem = async (item: OfficeHubActionItem) => {
    if (!actor) return;
    const done = await run(
      async () => {
        await updateActionItem(actor, item.id, { status: 'Completed' });
        return true;
      },
      { success: 'Action item done', failure: 'Could not mark it done', describe: 'Complete action item' },
    );
    if (done) {
      settle(item.id);
      actionItemsQuery.reload();
    }
  };

  if (isLoading) return <DashboardSkeleton />;

  const firstName = viewer.name.split(' ')[0] || viewer.name;
  const hour = Number(zoned.time.slice(0, 2));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const weekday = OFFICE_HUB_WEEKDAYS[weekdayOf(today)]?.name ?? '';
  const loadingMeetings = meetingsQuery.isLoading || responsesQuery.isLoading;

  const summary: { strong: string; rest?: string }[] = [];
  summary.push(
    todays.length
      ? { strong: `${todays.length} meeting${todays.length === 1 ? '' : 's'} today`, rest: nextToday ? `, next at ${formatClockTime(nextToday.meeting.startTime, { lowercaseMeridiem: true })}` : ', all done' }
      : { strong: 'No meetings today' },
  );
  summary.push(
    upcomingInvites.length
      ? { strong: `${upcomingInvites.length} invitation${upcomingInvites.length === 1 ? '' : 's'}`, rest: ' waiting for your answer' }
      : { strong: '', rest: 'every invitation answered' },
  );
  if (capabilities.canViewTasks && openTasks) summary.push({ strong: `${openTasks} open task${openTasks === 1 ? '' : 's'}` });
  if (openActionItems.length) summary.push({ strong: `${openActionItems.length} action item${openActionItems.length === 1 ? '' : 's'}` });

  const quickActions: { label: string; href: string; icon: typeof CalendarPlus; primary?: boolean }[] = [];
  if (capabilities.canCreateMeeting) quickActions.push({ label: 'Schedule meeting', href: `${BASE}/meetings/new`, icon: CalendarPlus, primary: true });
  if (capabilities.canCreateTask) quickActions.push({ label: 'New task', href: `${BASE}/tasks/new`, icon: CheckSquare });
  if (capabilities.canCreateDecision) quickActions.push({ label: 'Record decision', href: `${BASE}/decisions?new=1`, icon: Gavel });
  if (capabilities.canCreateTeam) quickActions.push({ label: 'New team', href: `${BASE}/teams?new=1`, icon: UserPlus });
  quickActions.push({ label: 'Calendar', href: `${BASE}/calendar`, icon: CalendarDays });

  const invitationList = invitationView === 'upcoming' ? upcomingInvites : pastInvites;
  const pastShare = waiting ? Math.round((pastInvites.length / waiting) * 100) : 0;

  const timelineEvents: TimelineEvent[] = todays.map((entry) => ({
    id: entry.meeting.id,
    href: `${BASE}/meetings/${entry.meeting.id}`,
    title: entry.meeting.title,
    detail: `${formatClockTime(entry.meeting.startTime, { lowercaseMeridiem: true })} · ${placeOf(entry.meeting)}${isGoing(entry.response) ? '' : ' · not answered'}`,
    start: clockToMinutes(entry.meeting.startTime) ?? 0,
    end: (clockToMinutes(entry.meeting.startTime) ?? 0) + entry.minutes,
    colour: isGoing(entry.response) ? 'hsl(var(--primary))' : 'var(--oh-amber)',
  }));
  const workStart = clockToMinutes(settings.workingHoursStart) ?? 540;
  const workEnd = clockToMinutes(settings.workingHoursEnd) ?? 1080;
  const dayFrom = Math.floor(Math.min(workStart, ...timelineEvents.map((event) => event.start)) / 60) * 60;
  const dayTo = Math.min(1440, Math.ceil(Math.max(workEnd, ...timelineEvents.map((event) => event.end)) / 60) * 60);
  const tomorrow = mine.filter((entry) => entry.meeting.date === addDays(today, 1) && entry.response !== 'Declined');

  return (
    <div className="oh-dash space-y-0 pb-6">
      {/* ── band ── */}
      <section className="oh-hero oh-hero--glow keep-light relative flex flex-wrap items-center gap-4 overflow-hidden rounded-[20px] px-4 py-4 text-white sm:px-6">
        <div aria-hidden className="wd-hero-dots pointer-events-none absolute inset-0" />
        <div className="relative min-w-0 flex-1 basis-72">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-violet-100">
            Office Hub · {weekday}, {formatIsoDate(today)}
          </div>
          <h1 className="mt-0.5 text-[23px] font-extrabold tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="text-[12.5px] text-indigo-100">
            {summary.map((part, index) => (
              <span key={index}>
                {index > 0 && (index === 1 ? '. ' : ' · ')}
                {part.strong && <b className="text-white">{part.strong}</b>}
                {part.rest}
              </span>
            ))}
            .
          </p>
        </div>
        <div className="relative flex flex-wrap gap-2">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.label}
                href={action.href}
                className={cn(
                  'flex items-center gap-1.5 rounded-[11px] border px-3 py-1.5 text-[12.5px] font-bold transition-colors',
                  action.primary ? 'border-white bg-white text-violet-900 hover:bg-violet-50' : 'border-white/25 bg-white/10 text-white hover:bg-white/20',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {action.label}
              </Link>
            );
          })}
        </div>
      </section>

      {live.map((entry) => {
        const join = meetingJoinView(entry.meeting, viewer.userId, { canViewAllMeetings: capabilities.canViewAllMeetings, now });
        const state = meetingTimeState(entry.meeting, now, 60);
        return (
          <div key={entry.meeting.id} className="mt-3">
            <OfficeHubCallout
              tone={state === 'live' ? 'emerald' : 'amber'}
              icon={state === 'live' ? Radio : CalendarDays}
              title={state === 'live' ? `${entry.meeting.title} is happening now` : `${entry.meeting.title} starts soon`}
              description={`${formatClockTime(entry.meeting.startTime)} – ${formatClockTime(entry.meeting.endTime)} · ${entry.meeting.organizerName}${
                entry.meeting.responseSummary ? ` · ${describeResponses(entry.meeting.responseSummary)}` : ''
              }`}
              action={
                <div className="flex flex-wrap gap-2">
                  {join.canJoin && join.url && (
                    <Button size="sm" asChild className="gap-1.5">
                      <a href={join.url} target="_blank" rel="noopener noreferrer">
                        <Video className="h-3.5 w-3.5" />
                        Join meeting
                      </a>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`${BASE}/meetings/${entry.meeting.id}`}>Open</Link>
                  </Button>
                </div>
              }
            />
          </div>
        );
      })}

      {/* ── meetings ── */}
      <SectionLabel>Meetings</SectionLabel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          icon={Clock}
          tone="blue"
          label="Today’s meetings"
          value={loadingMeetings ? '–' : todays.length}
          foot={nextToday ? `next at ${formatClockTime(nextToday.meeting.startTime, { lowercaseMeridiem: true })}` : todays.length ? 'all done for today' : 'clear day'}
          spark={last7.map((day) => day.going + day.unsettled)}
          href={`${BASE}/calendar`}
        />
        <KpiTile
          icon={CalendarDays}
          tone="violet"
          label="Next 7 days"
          value={loadingMeetings ? '–' : goingAhead}
          foot={goingAhead ? 'meetings you are going to' : 'nothing accepted yet'}
          spark={ahead.map((day) => day.going)}
          href={`${BASE}/calendar`}
        />
        <KpiTile
          icon={Inbox}
          tone="amber"
          label="Pending invitations"
          value={loadingMeetings ? '–' : waiting}
          foot={waiting ? `${upcomingInvites.length} upcoming · ${pastInvites.length} past` : 'all answered'}
          spark={ahead.map((day) => day.unsettled)}
          hot={upcomingInvites.length > 0}
          href={`${BASE}/meetings?filter=awaiting`}
        />
        <KpiTile
          icon={Hourglass}
          tone="teal"
          label="Hours in meetings"
          value={loadingMeetings ? '–' : formatHours(weekMinutes)}
          foot={weekCapacity ? `this week · ${Math.round((weekMinutes / weekCapacity) * 100)}% of a ${formatHours(weekCapacity)} week` : 'this week'}
          spark={thisWeek.map((day) => day.minutes)}
        />
        <KpiTile
          icon={Users}
          tone="pink"
          label="Organised by me"
          value={loadingMeetings ? '–' : organisedThisMonth.length}
          foot={organisedThisMonth.length ? (organisedAcceptance != null ? `this month · ${organisedAcceptance}% accepted` : 'this month') : 'none this month'}
          spark={organisedPerWeek}
          href={`${BASE}/meetings?scope=organized`}
        />
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        {/* Invitations */}
        <DashCard
          id="oh-invitations"
          icon={Inbox}
          tone="amber"
          title="Invitations"
          description="Your replies and what’s still open"
          className="lg:col-span-7 xl:col-span-5"
          aside={
            <MiniSegmented
              label="Which invitations"
              value={invitationView}
              onChange={setInvitationView}
              options={[
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'past', label: 'Already past' },
              ]}
            />
          }
        >
          <div className="grid grid-cols-1 items-center gap-4 border-b px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
            <div className="mx-auto">
              <Donut
                centreLabel="invitations"
                parts={[
                  { label: 'Waiting · upcoming', value: upcomingInvites.length, colour: 'var(--oh-amber)' },
                  { label: 'Waiting · already past', value: pastInvites.length, colour: 'var(--oh-neutral)' },
                  { label: 'Accepted', value: board.counts.accepted, colour: 'var(--oh-good)' },
                  { label: 'Maybe', value: board.counts.maybe, colour: 'var(--oh-blue)' },
                  { label: 'Declined', value: board.counts.declined, colour: 'var(--oh-bad)' },
                ]}
              />
            </div>
            <div>
              {[
                ['var(--oh-amber)', 'Waiting · upcoming', upcomingInvites.length],
                ['var(--oh-neutral)', 'Waiting · already past', pastInvites.length],
                ['var(--oh-good)', 'Accepted', board.counts.accepted],
                ['var(--oh-blue)', 'Maybe', board.counts.maybe],
                ['var(--oh-bad)', 'Declined', board.counts.declined],
              ].map(([colour, label, value], index) => (
                <div key={label as string} className={cn('flex items-center gap-2 py-1 text-xs', index > 0 && 'border-t border-dashed')}>
                  <i aria-hidden className="h-[9px] w-[9px] rounded-[3px]" style={{ background: colour as string }} />
                  <span className="flex-1 font-semibold text-muted-foreground">{label}</span>
                  <b className="text-[13px] tabular-nums">{value}</b>
                </div>
              ))}
              <p className="mt-1 text-[11px] text-muted-foreground">Meetings from the last eight weeks and the next five.</p>
              {pastInvites.length > 0 && (
                <p className="mt-1 text-[11.5px] font-semibold text-amber-700">
                  {pastShare}% of what’s waiting is for meetings that already happened.
                </p>
              )}
            </div>
          </div>

          {invitationView === 'past' && pastInvites.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <b>
                  {pastInvites.length} meeting{pastInvites.length === 1 ? '' : 's'} already happened
                </b>{' '}
                without an answer from you. Clearing only tidies your dashboard.
              </span>
              <Button size="sm" variant="outline" className="h-7 bg-white text-xs" disabled={isBusy} onClick={() => void clearPast()}>
                Clear all past
              </Button>
            </div>
          )}

          {loadingMeetings ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : invitationList.length === 0 ? (
            <EmptyNote
              icon={Check}
              tone="green"
              title="Nothing waiting here"
              text={`You’re up to date on ${invitationView === 'upcoming' ? 'upcoming' : 'past'} invitations.`}
            />
          ) : (
            <div className="flex flex-1 flex-col">
              {invitationList.slice(0, 4).map((entry, index) => (
                <div
                  key={entry.meeting.id}
                  className={cn('grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2', index > 0 && 'border-t')}
                >
                  <DateTile date={entry.meeting.date} colour={invitationView === 'past' ? '#94a3b8' : '#7c3aed'} />
                  <Link href={`${BASE}/meetings/${entry.meeting.id}`} className="min-w-0 hover:underline">
                    <b className={cn('block truncate text-[12.5px] leading-snug', invitationView === 'past' && 'text-muted-foreground')}>
                      {entry.meeting.title}
                    </b>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {OFFICE_HUB_WEEKDAYS[weekdayOf(entry.meeting.date)]?.short} {formatClockTime(entry.meeting.startTime, { lowercaseMeridiem: true })} · {placeOf(entry.meeting)} · from{' '}
                      {entry.meeting.organizerName}
                    </span>
                  </Link>
                  {invitationView === 'past' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={isBusy}
                      title="Hide it from your dashboard. The organizer’s record is unchanged."
                      onClick={() => void dismiss(entry)}
                    >
                      Dismiss
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <ReplyButton label="Accept" tone="ok" disabled={isBusy} onClick={() => void reply(entry, 'Accepted')}>
                        <Check className="h-3.5 w-3.5" />
                      </ReplyButton>
                      <ReplyButton label="Maybe" disabled={isBusy} onClick={() => void reply(entry, 'Maybe')}>
                        <span className="text-xs font-extrabold">?</span>
                      </ReplyButton>
                      <ReplyButton label="Decline" tone="no" disabled={isBusy} onClick={() => void reply(entry, 'Declined')}>
                        <X className="h-3.5 w-3.5" />
                      </ReplyButton>
                    </div>
                  )}
                </div>
              ))}
              {invitationList.length > 4 && (
                <Link
                  href={`${BASE}/meetings?filter=awaiting`}
                  className="mt-auto block border-t bg-muted/40 py-2 text-center text-xs font-bold text-primary hover:bg-muted"
                >
                  View all {invitationList.length} {invitationView === 'upcoming' ? 'upcoming' : 'past'} invitations
                </Link>
              )}
            </div>
          )}
        </DashCard>

        {/* Meetings per day */}
        <DashCard
          icon={CalendarCheck}
          tone="violet"
          title="Your next 7 days"
          description="Meetings per day · going vs not settled"
          className="lg:col-span-5 xl:col-span-4"
          aside={<CardLink href={`${BASE}/calendar`}>Calendar →</CardLink>}
        >
          <div className="flex-1 px-4 py-3">
            <Legend
              items={[
                { label: 'Going', colour: 'hsl(var(--primary))' },
                { label: 'Maybe or not answered', colour: 'var(--oh-amber)' },
              ]}
            />
            <WeekBars
              bars={ahead.map((day, index) => ({
                label: index === 0 ? 'Today' : OFFICE_HUB_WEEKDAYS[weekdayOf(day.date)]?.short ?? '',
                title: `${formatIsoDate(day.date, { withWeekday: true, year: false })}: ${day.going} going, ${day.unsettled} not settled`,
                going: day.going,
                unsettled: day.unsettled,
                emphasis: index === 0,
              }))}
            />
            {(() => {
              const busiest = ahead.reduce((best, day, index) => (day.going + day.unsettled > ahead[best].going + ahead[best].unsettled ? index : best), 0);
              const busiestDay = ahead[busiest];
              return (
                <StatTrio
                  items={[
                    { label: 'Going', value: goingAhead },
                    { label: 'Not settled', value: ahead.reduce((sum, day) => sum + day.unsettled, 0), tone: 'amber' },
                    {
                      label: 'Busiest day',
                      value:
                        busiestDay && busiestDay.going + busiestDay.unsettled
                          ? busiest === 0
                            ? 'Today'
                            : formatIsoDate(busiestDay.date, { withWeekday: true, year: false }).replace(/ \w+$/, '')
                          : '—',
                    },
                  ]}
                />
              );
            })()}
          </div>
        </DashCard>

        {/* Today */}
        <DashCard
          icon={Clock}
          tone="blue"
          title="Today’s meetings"
          description={todays.length ? `${todays.length} meeting${todays.length === 1 ? '' : 's'} · ${formatHours(todays.reduce((sum, entry) => sum + entry.minutes, 0))}` : 'Nothing on your calendar'}
          className="lg:col-span-12 xl:col-span-3"
        >
          {loadingMeetings ? (
            <div className="p-4">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : todays.length ? (
            <DayTimeline events={timelineEvents} from={dayFrom} to={dayTo} now={nowMinute} />
          ) : (
            <div className="flex flex-1 flex-col">
              <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-[14px] bg-gradient-to-r from-emerald-500/10 to-blue-500/10 p-3">
                <AppTile icon={Check} tone="green" size={32} />
                <div className="min-w-0">
                  <b className="block text-[13px]">A clear day</b>
                  <small className="block truncate text-[11.5px] text-muted-foreground">
                    Tomorrow:{' '}
                    {tomorrow.length
                      ? `${tomorrow[0].meeting.title}, ${formatClockTime(tomorrow[0].meeting.startTime, { lowercaseMeridiem: true })}${tomorrow.length > 1 ? ` (+${tomorrow.length - 1})` : ''}`
                      : 'nothing yet'}
                  </small>
                </div>
              </div>
              {capabilities.canCreateMeeting && (
                <EmptyNote
                  icon={CalendarPlus}
                  tone="blue"
                  title="Line up the week"
                  className="py-4"
                  action={
                    <Button size="sm" variant="outline" asChild className="gap-1.5">
                      <Link href={`${BASE}/meetings/new`}>
                        <CalendarPlus className="h-3.5 w-3.5" />
                        Schedule
                      </Link>
                    </Button>
                  }
                />
              )}
            </div>
          )}
        </DashCard>
      </div>

      {/* ── tasks ── */}
      {(capabilities.canViewTasks || capabilities.canViewActionItems) && (
        <>
          <SectionLabel>Tasks</SectionLabel>
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
            {capabilities.canViewTasks && (
              <DashCard
                icon={CheckSquare}
                tone="green"
                title="My tasks"
                description={
                  taskStats.total ? `${openTasks} open · ${taskStats.overdue} overdue · ${taskStats.dueToday} due today` : 'Nothing assigned to you yet'
                }
                className={capabilities.canViewActionItems ? 'lg:col-span-12 xl:col-span-8' : 'lg:col-span-12'}
                aside={<CardLink href={`${BASE}/tasks`}>All tasks →</CardLink>}
              >
                <div className="grid grid-cols-2 gap-2.5 border-b px-4 py-3 sm:grid-cols-3 2xl:grid-cols-6">
                  {(
                    [
                      ['all', 'Open tasks', openTasks, '#64748b', taskStats.total ? `${taskStats.total} in all` : 'none assigned'],
                      ['notStarted', 'To do', taskStats.notStarted, '#94a3b8', taskStats.onHold ? `${taskStats.onHold} on hold` : 'not started'],
                      ['inProgress', 'In progress', taskStats.inProgress, '#2a78d6', 'under way'],
                      ['completed', 'Completed', taskStats.completed, '#16a34a', taskStats.total ? `${Math.round((taskStats.completed / taskStats.total) * 100)}% done` : '—'],
                      ['overdue', 'Overdue', taskStats.overdue, '#e11d48', taskStats.overdue ? 'past due date' : 'nothing late'],
                      ['dueToday', 'Due today', taskStats.dueToday, '#d97706', taskStats.dueSoon ? `${taskStats.dueSoon} more this week` : '—'],
                    ] as const
                  ).map(([key, label, value, colour, foot]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={taskFilter === key}
                      onClick={() => setTaskFilter(key)}
                      className={cn(
                        'relative overflow-hidden rounded-[13px] border py-2 pl-3 pr-2 text-left transition-colors hover:bg-muted/50',
                        taskFilter === key && 'border-primary/40 bg-primary/5',
                      )}
                    >
                      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: colour }} />
                      <small className="block text-[11px] font-semibold text-muted-foreground">{label}</small>
                      <b className={cn('block text-xl font-extrabold leading-tight', key === 'overdue' && value > 0 && 'text-rose-600')}>
                        {tasksQuery.isLoading ? '–' : value}
                      </b>
                      <span className="block truncate text-[10.5px] font-semibold text-muted-foreground">{foot}</span>
                    </button>
                  ))}
                </div>
                <div className="grid flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                  <div className="min-w-0 px-4 py-3">
                    <b className="text-[12.5px]">Status split</b>
                    {(() => {
                      const parts = [
                        { label: 'Not started', value: taskStats.notStarted, colour: 'var(--oh-neutral)' },
                        { label: 'On hold', value: taskStats.onHold, colour: 'var(--oh-amber)' },
                        { label: 'In progress', value: taskStats.inProgress, colour: 'var(--oh-blue)' },
                        { label: 'Completed', value: taskStats.completed, colour: 'var(--oh-good)' },
                      ];
                      const total = parts.reduce((sum, part) => sum + part.value, 0);
                      return (
                        <>
                          <div className="my-2 flex h-3 gap-[2px] overflow-hidden rounded-md bg-muted">
                            {total > 0 &&
                              parts
                                .filter((part) => part.value > 0)
                                .map((part) => (
                                  <i
                                    key={part.label}
                                    title={`${part.label}: ${part.value}`}
                                    className="block h-full"
                                    style={{ width: `${(part.value / total) * 100}%`, background: part.colour }}
                                  />
                                ))}
                          </div>
                          <Legend items={parts.map((part) => ({ label: <>{part.label} <b className="text-foreground">{part.value}</b></>, colour: part.colour }))} />
                        </>
                      );
                    })()}
                    <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
                      <b className="text-[12.5px]">Created vs completed · 8 weeks</b>
                      <Legend
                        items={[
                          { label: 'Created', colour: 'var(--oh-blue)' },
                          { label: 'Completed', colour: 'var(--oh-good)' },
                        ]}
                      />
                    </div>
                    <TrendLines
                      emptyNote="No task activity yet"
                      points={flow.map((week, index) => ({
                        label: index === flow.length - 1 ? 'Now' : `${Number(week.from.slice(8, 10))} ${MONTHS[Number(week.from.slice(5, 7)) - 1]}`,
                        title: `${formatIsoDate(week.from, { year: false })} – ${formatIsoDate(week.to, { year: false })}: ${week.created} created, ${week.completed} completed`,
                        created: week.created,
                        completed: week.completed,
                      }))}
                    />
                  </div>
                  <div className="min-w-0 border-t md:border-l md:border-t-0">
                    {tasksQuery.isLoading ? (
                      <div className="space-y-2 p-4">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    ) : taskStats.total === 0 ? (
                      <EmptyNote
                        icon={Check}
                        tone="green"
                        title="No pending tasks"
                        text="Tasks assigned to you, and action items from meetings turned into tasks, list here by due date."
                        action={
                          capabilities.canCreateTask ? (
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`${BASE}/tasks/new`}>Create a task</Link>
                            </Button>
                          ) : undefined
                        }
                      />
                    ) : filteredTasks.length === 0 ? (
                      <p className="px-4 py-8 text-center text-xs text-muted-foreground">No tasks in this group.</p>
                    ) : (
                      <ul>
                        {filteredTasks.map((task, index) => (
                          <TaskRow key={task.id} task={task} today={today} first={index === 0} />
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </DashCard>
            )}

            {capabilities.canViewActionItems && (
              <DashCard
                icon={Gavel}
                tone="pink"
                title={fromMeetings === 'actions' ? 'Open action items' : 'My decisions'}
                description={fromMeetings === 'actions' ? 'Assigned to you in meeting minutes' : 'Open decisions you own'}
                className={capabilities.canViewTasks ? 'lg:col-span-12 xl:col-span-4' : 'lg:col-span-12'}
                aside={
                  capabilities.canViewDecisions ? (
                    <MiniSegmented
                      label="From meetings"
                      value={fromMeetings}
                      onChange={setFromMeetings}
                      options={[
                        { value: 'actions', label: 'Action items' },
                        { value: 'decisions', label: 'Decisions' },
                      ]}
                    />
                  ) : undefined
                }
              >
                {fromMeetings === 'actions' ? (
                  actionItemsQuery.isLoading ? (
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-9 w-full" />
                      <Skeleton className="h-9 w-full" />
                    </div>
                  ) : openActionItems.length === 0 ? (
                    <EmptyNote icon={Gavel} tone="pink" title="No open action items" text="Items raised for you in meeting minutes land here with their due dates." />
                  ) : (
                    <ul className="flex-1">
                      {openActionItems.slice(0, 6).map((item, index) => {
                        const offset = dueOffset(item.dueDate, today);
                        return (
                          <li key={item.id} className={cn('flex items-center gap-2.5 px-4 py-2', index > 0 && 'border-t')}>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void completeActionItem(item)}
                              aria-label={`Mark “${item.title}” done`}
                              title="Mark done"
                              className="h-[17px] w-[17px] shrink-0 rounded-[5px] border-2 border-muted-foreground/40 transition-colors hover:border-emerald-600 hover:bg-emerald-600/15"
                            />
                            <div className="min-w-0 flex-1">
                              <b className="block truncate text-[12.5px] leading-snug">{item.title}</b>
                              <small className="block truncate text-[11px] text-muted-foreground">
                                {[item.meetingTitle, item.meetingDate ? formatIsoDate(item.meetingDate, { year: false }) : null].filter(Boolean).join(' · ') || item.reference}
                              </small>
                            </div>
                            <DueChip offset={offset} date={item.dueDate ?? null} />
                          </li>
                        );
                      })}
                      {openActionItems.length > 6 && (
                        <li className="border-t">
                          <Link href={`${BASE}/action-items`} className="block bg-muted/40 py-2 text-center text-xs font-bold text-primary hover:bg-muted">
                            View all {openActionItems.length} action items
                          </Link>
                        </li>
                      )}
                    </ul>
                  )
                ) : decisionsQuery.isLoading ? (
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ) : openDecisions.length === 0 ? (
                  <EmptyNote
                    icon={Gavel}
                    tone="violet"
                    title="No open decisions"
                    text="Record what was agreed so nobody has to remember it."
                    action={
                      capabilities.canCreateDecision ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`${BASE}/decisions?new=1`}>Record a decision</Link>
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <ul className="flex-1">
                    {openDecisions.slice(0, 6).map((decision, index) => (
                      <li key={decision.id} className={cn('flex items-stretch gap-2.5 px-4 py-2', index > 0 && 'border-t')}>
                        <span aria-hidden className="w-1 shrink-0 rounded-sm bg-primary/70" />
                        <Link href={`${BASE}/decisions/${decision.id}`} className="min-w-0 flex-1 hover:underline">
                          <b className="block truncate text-[12.5px] leading-snug">{decision.title}</b>
                          <small className="block truncate text-[11px] text-muted-foreground">
                            {[decision.meetingTitle, formatIsoDate(decision.decisionDate, { year: false }), decision.status].filter(Boolean).join(' · ')}
                          </small>
                        </Link>
                        <DueChip offset={dueOffset(decision.dueDate, today)} date={decision.dueDate ?? null} />
                      </li>
                    ))}
                  </ul>
                )}
              </DashCard>
            )}
          </div>
        </>
      )}

      {/* ── schedule ── */}
      <SectionLabel>Schedule</SectionLabel>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        <DashCard
          icon={CalendarDays}
          tone="teal"
          title="Upcoming meetings"
          description="Next 7 days, ones you are going to"
          className="lg:col-span-7"
          aside={<CardLink href={`${BASE}/meetings`}>All meetings →</CardLink>}
        >
          {loadingMeetings ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : upcomingGoing.length === 0 ? (
            <EmptyNote
              icon={CalendarDays}
              tone="teal"
              title="No accepted meetings in the next 7 days"
              text={
                upcomingInvites.length
                  ? `${upcomingInvites.length} invitation${upcomingInvites.length === 1 ? ' is' : 's are'} still waiting for your reply.`
                  : 'Your week is open.'
              }
              action={
                upcomingInvites.length ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setInvitationView('upcoming');
                      document.getElementById('oh-invitations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    Review invitations
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="flex-1">
              {upcomingGoing.slice(0, 8).map((entry, index) => {
                const people = (entry.meeting.participantUserIds ?? []).slice(0, 4);
                const extra = (entry.meeting.participantUserIds ?? []).length - people.length;
                return (
                  <li key={entry.meeting.id} className={cn('grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 px-4 py-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]', index > 0 && 'border-t')}>
                    <div className="text-xs">
                      <b className="block">
                        {entry.meeting.date === addDays(today, 1)
                          ? 'Tomorrow'
                          : formatIsoDate(entry.meeting.date, { withWeekday: true, year: false })}
                      </b>
                      <span className="text-muted-foreground">{formatClockTime(entry.meeting.startTime, { lowercaseMeridiem: true })}</span>
                    </div>
                    <Link href={`${BASE}/meetings/${entry.meeting.id}`} className="min-w-0 hover:underline">
                      <b className="block truncate text-[12.5px]">{entry.meeting.title}</b>
                      <span className="block truncate text-[11.5px] text-muted-foreground">
                        {placeOf(entry.meeting)} · {formatHours(entry.minutes)}
                        {entry.response === 'Organizer' ? ' · you organise' : ''}
                      </span>
                    </Link>
                    <span className="col-span-2 flex items-center sm:col-span-1">
                      {people.map((userId, position) => {
                        const person = directory.people.find((candidate) => candidate.userId === userId);
                        return (
                          <span key={userId} title={person?.name} className={cn('rounded-full border-2 border-card', position > 0 && '-ml-1.5')}>
                            <Avatar seed={userId} name={person?.name ?? '?'} size={22} />
                          </span>
                        );
                      })}
                      {extra > 0 && <span className="ml-1 text-[11px] font-bold text-muted-foreground">+{extra}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </DashCard>

        <DashCard
          icon={PieChart}
          tone="orange"
          title="Where your meeting time goes"
          description="This week, by meeting type"
          className="lg:col-span-5"
        >
          <div className="flex-1 px-4 py-3">
            {loadingMeetings ? (
              <Skeleton className="h-32 w-full" />
            ) : byType.length === 0 ? (
              <EmptyNote
                icon={PieChart}
                tone="orange"
                title="No meeting time this week"
                text="Accept invitations to see how your hours split across meeting types."
              />
            ) : (
              <>
                <HBars rows={byType.map((row) => ({ label: row.type, value: row.minutes }))} format={formatHours} />
                <StatTrio
                  items={[
                    { label: 'Total', value: formatHours(weekMinutes) },
                    { label: 'Longest meeting', value: formatHours(longest) },
                    { label: 'Free working time', value: weekCapacity ? formatHours(Math.max(0, weekCapacity - weekMinutes)) : '—' },
                  ]}
                />
              </>
            )}
          </div>
        </DashCard>
      </div>
    </div>
  );
}

function placeOf(meeting: Pick<OfficeHubMeeting, 'mode' | 'room' | 'location' | 'onlinePlatform'>): string {
  if (meeting.mode === 'Online') return meeting.onlinePlatform ?? 'Online';
  const place = [meeting.room, meeting.location].map((part) => part?.trim()).filter(Boolean).join(', ');
  if (meeting.mode === 'Hybrid') return place ? `${place} + online` : 'Hybrid';
  return place || 'Place to be confirmed';
}

function ReplyButton({
  label,
  tone,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tone?: 'ok' | 'no';
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-lg border transition-colors disabled:opacity-50',
        tone === 'ok' && 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700',
        tone === 'no' && 'border-rose-200 text-rose-600 hover:bg-rose-500/10',
        !tone && 'bg-card hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function DueChip({ offset, date }: { offset: number | null; date: string | null }) {
  if (offset == null || !date) return <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[10.5px] font-bold text-muted-foreground">No due date</span>;
  const label =
    offset < 0
      ? `Overdue ${-offset} d`
      : offset === 0
        ? 'Due today'
        : offset < 7
          ? `Due ${OFFICE_HUB_WEEKDAYS[weekdayOf(date)]?.short}`
          : `Due ${formatIsoDate(date, { year: false })}`;
  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-bold',
        offset < 0 ? 'bg-rose-100 text-rose-700' : offset <= 1 ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
}

const STATUS_CHIP: Record<string, string> = {
  'Not Started': 'bg-muted text-muted-foreground',
  'In Progress': 'bg-blue-100 text-blue-700',
  'On Hold': 'bg-amber-100 text-amber-800',
  Completed: 'bg-emerald-100 text-emerald-700',
  Cancelled: 'bg-muted text-muted-foreground',
};

function TaskRow({ task, today, first }: { task: OfficeHubTask; today: string; first: boolean }) {
  const overdue = !isTaskClosed(task.status) && Boolean(task.dueDate) && (task.dueDate as string) < today;
  return (
    <li className={cn('flex items-center gap-2.5 px-4 py-2', !first && 'border-t', overdue && 'bg-rose-500/5')}>
      <span
        aria-hidden
        className={cn('h-[7px] w-[7px] shrink-0 rounded-full', {
          'bg-rose-600': task.priority === 'Critical' || overdue,
          'bg-orange-500': task.priority === 'High' && !overdue,
          'bg-blue-500': task.priority === 'Medium' && !overdue,
          'bg-slate-400': task.priority === 'Low' && !overdue,
        })}
        title={`${task.priority} priority`}
      />
      <Link href={`${BASE}/tasks/${task.id}`} className="min-w-0 flex-1 hover:underline">
        <b className="block truncate text-[12.5px] leading-snug">{task.title}</b>
        <small className="block truncate text-[11px] text-muted-foreground">
          {task.dueDate ? (overdue ? `Overdue since ${formatIsoDate(task.dueDate, { year: false })}` : `Due ${task.dueDate === today ? 'today' : formatIsoDate(task.dueDate, { withWeekday: true, year: false })}`) : 'No due date'}
          {task.meetingTitle ? ` · ${task.meetingTitle}` : ''}
        </small>
      </Link>
      <span className={cn('hidden shrink-0 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-bold sm:inline', STATUS_CHIP[task.status])}>
        {task.status}
      </span>
      {task.assigneeName && (
        <span title={task.assigneeName} className="shrink-0">
          <Avatar seed={task.assigneeId ?? task.assigneeName} name={task.assigneeName} size={22} />
        </span>
      )}
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-28 w-full rounded-[20px]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Skeleton className="h-72 rounded-[18px] lg:col-span-6" />
        <Skeleton className="h-72 rounded-[18px] lg:col-span-6" />
      </div>
    </div>
  );
}
