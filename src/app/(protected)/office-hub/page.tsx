'use client';

/**
 * The Office Hub dashboard (§7).
 *
 * ── What is on it, and why in this order ────────────────────────────────────────────────────────
 *
 * The order is not §7's list order; it is the order of how urgent each thing is to the person
 * reading it at 9am:
 *
 *   1. A meeting that is live or starting within the hour, as a banner. Nothing else on the screen
 *      matters if a meeting starts in four minutes.
 *   2. Invitations awaiting an answer, also as a banner, because the organizer is blocked on it.
 *   3. Today's meetings, with a Join button per row.
 *   4. Work that is late or due today.
 *   5. Statistics, upcoming meetings, open action items — the things worth knowing but not acting
 *      on this minute.
 *
 * Everything is one query per box, scoped by the viewer's widest grant, and the whole page is five
 * reads. The alternative — a live listener per box — would be about right for a wall display and
 * quite wrong for the eighty people who open this once and navigate away (§52's cost warning).
 */

import Link from 'next/link';
import { useMemo } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  CheckSquare,
  ClipboardList,
  Gauge,
  Gavel,
  ListTodo,
  Radio,
  Users,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  OFFICE_HUB_BASE_PATH,
  addDays,
  buildMeetingStatistics,
  buildTaskStatistics,
  describeResponses,
  formatIsoDate,
  isOpenActionItemStatus,
  isTaskOverdue,
  meetingJoinView,
  meetingTimeState,
  taskDueBucket,
  type OfficeHubActionItem,
  type OfficeHubMeeting,
  type OfficeHubTask,
} from '@/lib/office-hub';
import {
  countAwaitingMyResponse,
  listActionItems,
  listMeetings,
  listMyTasks,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  MeetingStatusBadge,
  MeetingWhen,
  MeetingWhere,
  MeetingWhenBadge,
  OfficeHubCallout,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubKpiCard,
  OfficeHubPageHeader,
  OfficeHubSection,
  PriorityBadge,
  QuickActionRow,
  ResponseSummaryChip,
  TaskDueDate,
  TaskProgressBar,
  TaskStatusBadge,
  useTickingNow,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';

export default function OfficeHubDashboardPage() {
  const { actor, viewer, capabilities, today, periods, meetingScope, isLoading } = useOfficeHub();
  const now = useTickingNow();

  /**
   * One window for every meeting box on this page.
   *
   * A month back and a month forward, fetched once and sliced in memory for "today", "upcoming" and
   * the statistics tiles. Three separate date-range queries would be three reads for overlapping
   * data, and the month either side is a few dozen documents.
   */
  const meetingsQuery = useOfficeHubQuery(
    () =>
      listMeetings(meetingScope, viewer, {
        fromDate: periods.monthStart,
        toDate: addDays(periods.monthEnd, 31),
        limit: 250,
      }),
    [meetingScope, viewer.userId, viewer.departmentId, periods.monthStart, periods.monthEnd],
    { enabled: Boolean(actor) && capabilities.canViewMeetings, initial: [] },
  );

  const tasksQuery = useOfficeHubQuery(
    () => listMyTasks(viewer.userId, { limit: 250 }),
    [viewer.userId],
    { enabled: Boolean(actor) && capabilities.canViewTasks, initial: [] },
  );

  const actionItemsQuery = useOfficeHubQuery(
    () => listActionItems({ responsibleUserId: viewer.userId, limit: 100 }),
    [viewer.userId],
    { enabled: Boolean(actor) && capabilities.canViewActionItems, initial: [] },
  );

  const awaitingQuery = useOfficeHubQuery(
    () => countAwaitingMyResponse(viewer.userId),
    [viewer.userId],
    { enabled: Boolean(actor), initial: 0 },
  );

  const meetings = meetingsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const actionItems = actionItemsQuery.data ?? [];
  const awaiting = awaitingQuery.data ?? 0;

  const live = useMemo(
    () =>
      meetings
        .filter((meeting) => meeting.status !== 'Cancelled')
        .filter((meeting) => {
          const state = meetingTimeState(meeting, now, 60);
          return state === 'live' || state === 'starting-soon';
        })
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [meetings, now],
  );

  const todaysMeetings = useMemo(
    () =>
      meetings
        .filter((meeting) => meeting.date === today && meeting.status !== 'Cancelled')
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [meetings, today],
  );

  const upcoming = useMemo(
    () =>
      meetings
        .filter((meeting) => meeting.date > today && meeting.status !== 'Cancelled' && meeting.status !== 'Completed')
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
        .slice(0, 8),
    [meetings, today],
  );

  const meetingStats = useMemo(
    () =>
      buildMeetingStatistics({
        meetings,
        awaitingResponse: awaiting,
        viewerUserId: viewer.userId,
        today,
        weekStart: periods.weekStart,
        weekEnd: periods.weekEnd,
        monthStart: periods.monthStart,
        monthEnd: periods.monthEnd,
      }),
    [meetings, awaiting, viewer.userId, today, periods],
  );

  const taskStats = useMemo(() => buildTaskStatistics(tasks, today), [tasks, today]);

  const { overdue, dueToday, upcomingTasks } = useMemo(() => {
    const buckets = { overdue: [] as OfficeHubTask[], dueToday: [] as OfficeHubTask[], upcomingTasks: [] as OfficeHubTask[] };
    for (const task of tasks) {
      const bucket = taskDueBucket(task, today);
      if (bucket === 'overdue') buckets.overdue.push(task);
      else if (bucket === 'due-today') buckets.dueToday.push(task);
      else if (bucket === 'due-soon') buckets.upcomingTasks.push(task);
    }
    return buckets;
  }, [tasks, today]);

  const openActionItems = useMemo(
    () => actionItems.filter((item) => isOpenActionItemStatus(item.status)).slice(0, 8),
    [actionItems],
  );

  const quickActions = useMemo(() => {
    const actions: { label: string; href: string; icon: React.ElementType; tone?: string }[] = [];
    if (capabilities.canCreateMeeting) {
      actions.push({ label: 'Schedule Meeting', href: `${OFFICE_HUB_BASE_PATH}/meetings/new`, icon: CalendarPlus, tone: 'text-indigo-600' });
    }
    if (capabilities.canCreateTask) {
      actions.push({ label: 'Create Task', href: `${OFFICE_HUB_BASE_PATH}/tasks/new`, icon: ListTodo, tone: 'text-emerald-600' });
    }
    if (capabilities.canCreateTeam) {
      actions.push({ label: 'Create Team', href: `${OFFICE_HUB_BASE_PATH}/teams?new=1`, icon: Users, tone: 'text-fuchsia-600' });
    }
    if (capabilities.canCreateDecision) {
      actions.push({ label: 'Add Decision', href: `${OFFICE_HUB_BASE_PATH}/decisions?new=1`, icon: Gavel, tone: 'text-amber-600' });
    }
    actions.push({ label: 'View Calendar', href: `${OFFICE_HUB_BASE_PATH}/calendar`, icon: CalendarDays, tone: 'text-sky-600' });
    return actions;
  }, [capabilities]);

  if (isLoading) return <DashboardSkeleton />;

  const meetingColumns: OfficeHubListColumn<OfficeHubMeeting>[] = [
    {
      header: 'Time',
      mobile: 'aside',
      cell: (meeting) => <MeetingWhen meeting={meeting} />,
      className: 'w-40',
    },
    {
      header: 'Meeting',
      mobile: 'title',
      cell: (meeting) => (
        <div className="min-w-0">
          <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`} className="block truncate font-medium hover:underline">
            {meeting.title}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {meeting.meetingType} · {meeting.organizerName}
          </p>
        </div>
      ),
    },
    {
      header: 'Where',
      mobile: 'detail',
      className: 'hidden md:table-cell',
      cell: (meeting) => <MeetingWhere meeting={meeting} />,
    },
    {
      header: 'Participants',
      mobile: 'detail',
      className: 'hidden lg:table-cell',
      cell: (meeting) => <ResponseSummaryChip summary={meeting.responseSummary} />,
    },
    {
      header: 'Status',
      mobile: 'detail',
      cell: (meeting) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <MeetingStatusBadge status={meeting.status} />
          <MeetingWhenBadge meeting={meeting} now={now} />
        </div>
      ),
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
        if (!join.canJoin || !join.url) {
          return (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}>Open</Link>
            </Button>
          );
        }
        return (
          <Button size="sm" variant={join.emphasise ? 'default' : 'outline'} asChild className="gap-1.5">
            <a href={join.url} target="_blank" rel="noopener noreferrer">
              <Video className="h-3.5 w-3.5" />
              Join
            </a>
          </Button>
        );
      },
    },
  ];

  const taskColumns: OfficeHubListColumn<OfficeHubTask>[] = [
    {
      header: 'Task',
      mobile: 'title',
      cell: (task) => (
        <div className="min-w-0">
          <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/${task.id}`} className="block truncate font-medium hover:underline">
            {task.title}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {task.reference}
            {task.meetingTitle ? ` · from ${task.meetingTitle}` : ''}
          </p>
        </div>
      ),
    },
    {
      header: 'Due',
      mobile: 'aside',
      className: 'w-32',
      cell: (task) => <TaskDueDate task={task} today={today} />,
    },
    {
      header: 'Priority',
      mobile: 'detail',
      className: 'hidden sm:table-cell w-24',
      cell: (task) => <PriorityBadge priority={task.priority} />,
    },
    {
      header: 'Status',
      mobile: 'detail',
      className: 'hidden md:table-cell w-32',
      cell: (task) => <TaskStatusBadge status={task.status} />,
    },
    {
      header: 'Progress',
      mobile: 'detail',
      className: 'hidden lg:table-cell w-32',
      cell: (task) => <TaskProgressBar task={task} />,
    },
  ];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title={`Good ${greeting()}, ${viewer.name.split(' ')[0]}`}
        description={`${formatIsoDate(today, { withWeekday: true })} · ${
          todaysMeetings.length
            ? `${todaysMeetings.length} meeting${todaysMeetings.length === 1 ? '' : 's'} today`
            : 'no meetings today'
        }`}
        actions={
          capabilities.canCreateMeeting ? (
            <Button asChild className="gap-2">
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/new`}>
                <CalendarPlus className="h-4 w-4" />
                Schedule meeting
              </Link>
            </Button>
          ) : undefined
        }
      />

      {live.map((meeting) => {
        const join = meetingJoinView(meeting, viewer.userId, {
          canViewAllMeetings: capabilities.canViewAllMeetings,
          now,
        });
        const state = meetingTimeState(meeting, now, 60);
        return (
          <OfficeHubCallout
            key={meeting.id}
            tone={state === 'live' ? 'emerald' : 'amber'}
            icon={state === 'live' ? Radio : CalendarDays}
            title={state === 'live' ? `${meeting.title} is happening now` : `${meeting.title} starts soon`}
            description={`${meeting.startTime} – ${meeting.endTime} · ${meeting.organizerName} · ${describeResponses(
              meeting.responseSummary,
            )}`}
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
                  <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}>Open</Link>
                </Button>
              </div>
            }
          />
        );
      })}

      {awaiting > 0 && (
        <OfficeHubCallout
          tone="indigo"
          icon={ClipboardList}
          title={`${awaiting} invitation${awaiting === 1 ? '' : 's'} waiting for your answer`}
          description="Organizers are planning around whether you can attend."
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings?filter=awaiting`}>Respond</Link>
            </Button>
          }
        />
      )}

      {overdue.length > 0 && (
        <OfficeHubCallout
          tone="rose"
          icon={AlertTriangle}
          title={`${overdue.length} task${overdue.length === 1 ? '' : 's'} overdue`}
          description={overdue
            .slice(0, 3)
            .map((task) => task.title)
            .join(' · ')}
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/tasks?view=overdue`}>Review</Link>
            </Button>
          }
        />
      )}

      <QuickActionRow actions={quickActions} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <OfficeHubKpiCard label="Meetings today" value={meetingStats.today} icon={CalendarDays} tone="indigo" href={`${OFFICE_HUB_BASE_PATH}/calendar`} />
        <OfficeHubKpiCard label="This week" value={meetingStats.thisWeek} icon={CalendarDays} tone="blue" />
        <OfficeHubKpiCard label="This month" value={meetingStats.thisMonth} icon={CalendarDays} tone="teal" />
        <OfficeHubKpiCard label="Organized by me" value={meetingStats.organizedByMe} icon={Gauge} tone="violet" href={`${OFFICE_HUB_BASE_PATH}/meetings?scope=organized`} />
        <OfficeHubKpiCard label="Awaiting my reply" value={meetingStats.awaitingMyResponse} icon={ClipboardList} tone={meetingStats.awaitingMyResponse ? 'amber' : 'slate'} />
      </div>

      <OfficeHubSection title="Today's meetings" description="Everything on your calendar for today.">
        {meetingsQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <OfficeHubDataList
            rows={todaysMeetings}
            columns={meetingColumns}
            cardHref={(meeting) => `${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}
            empty={
              <OfficeHubEmptyState
                icon={CalendarDays}
                title="No meetings scheduled for today."
                description="A clear day. Use it on the work that is due."
                action={
                  capabilities.canCreateMeeting ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/new`}>Schedule a meeting</Link>
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </OfficeHubSection>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <OfficeHubSection
          title="My tasks"
          description="Late first, then due today, then the week ahead."
          actions={
            <Button size="sm" variant="ghost" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/tasks`}>All tasks</Link>
            </Button>
          }
        >
          {tasksQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <OfficeHubDataList
              rows={[...overdue, ...dueToday, ...upcomingTasks].slice(0, 10)}
              columns={taskColumns}
              cardHref={(task) => `${OFFICE_HUB_BASE_PATH}/tasks/${task.id}`}
              rowClassName={(task) => (isTaskOverdue(task, today) ? 'bg-rose-50/60' : undefined)}
              empty={
                <OfficeHubEmptyState
                  icon={CheckSquare}
                  title="No pending tasks."
                  description="Nothing assigned to you is due in the next week."
                />
              }
            />
          )}
        </OfficeHubSection>

        <OfficeHubSection
          title="Upcoming meetings"
          description="The next few, after today."
          actions={
            <Button size="sm" variant="ghost" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings`}>All meetings</Link>
            </Button>
          }
        >
          {meetingsQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : upcoming.length === 0 ? (
            <OfficeHubEmptyState icon={CalendarDays} title="Nothing scheduled yet." />
          ) : (
            <ul className="divide-y">
              {upcoming.map((meeting) => (
                <li key={meeting.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link
                      href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {meeting.title}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatIsoDate(meeting.date, { withWeekday: true })} · {meeting.startTime} · {meeting.organizerName}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <ResponseSummaryChip summary={meeting.responseSummary} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </OfficeHubSection>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <OfficeHubKpiCard label="Total tasks" value={taskStats.total} icon={ListTodo} tone="slate" href={`${OFFICE_HUB_BASE_PATH}/tasks`} />
        <OfficeHubKpiCard label="Not started" value={taskStats.notStarted} icon={ListTodo} tone="slate" />
        <OfficeHubKpiCard label="In progress" value={taskStats.inProgress} icon={ListTodo} tone="blue" />
        <OfficeHubKpiCard label="Completed" value={taskStats.completed} icon={CheckSquare} tone="emerald" />
        <OfficeHubKpiCard label="Due today" value={taskStats.dueToday} icon={CalendarDays} tone={taskStats.dueToday ? 'amber' : 'slate'} />
        <OfficeHubKpiCard
          label="Overdue"
          value={taskStats.overdue}
          icon={AlertTriangle}
          tone={taskStats.overdue ? 'rose' : 'slate'}
          href={`${OFFICE_HUB_BASE_PATH}/tasks?view=overdue`}
        />
      </div>

      <OfficeHubSection
        title="Open action items"
        description="Raised in meetings and assigned to you."
        actions={
          <Button size="sm" variant="ghost" asChild>
            <Link href={`${OFFICE_HUB_BASE_PATH}/action-items`}>All action items</Link>
          </Button>
        }
      >
        {actionItemsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : openActionItems.length === 0 ? (
          <OfficeHubEmptyState icon={CheckSquare} title="No open action items." />
        ) : (
          <ul className="divide-y">
            {openActionItems.map((item: OfficeHubActionItem) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.reference}
                    {item.meetingTitle ? ` · ${item.meetingTitle}` : ''}
                    {item.dueDate ? ` · due ${formatIsoDate(item.dueDate)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <PriorityBadge priority={item.priority} />
                  {item.taskId ? (
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/${item.taskId}`}>View task</Link>
                    </Button>
                  ) : item.meetingId ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${item.meetingId}`}>Open meeting</Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </OfficeHubSection>

      {capabilities.canViewWorkload && (
        <Card className="border-white/60 bg-white/70">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">Looking for the wider picture?</p>
              <p className="text-xs text-muted-foreground">
                Workload by person, reports by department, and the management overview.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href={`${OFFICE_HUB_BASE_PATH}/workload`}>Workload</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`${OFFICE_HUB_BASE_PATH}/reports`}>Reports</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}
