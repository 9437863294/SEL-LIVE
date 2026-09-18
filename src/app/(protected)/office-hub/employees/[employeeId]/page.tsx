'use client';

/**
 * An employee's Office Hub profile (§4).
 *
 * §4 asks for three sections — Overview, Work, Activity — and that is what this is. The identity
 * half comes from the existing masters; the work half is what this module knows.
 *
 * ── Whose data a viewer may see ────────────────────────────────────────────────────────────────
 *
 * Anybody in the directory can look up anybody's basic details — that is what a directory is for.
 * The *work* half is narrower: your own always, and somebody else's only with a wider grant or
 * because you lead their team or head their department. Otherwise the tabs say so rather than
 * showing empty lists, because an empty list reads as "this person has no work".
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarDays,
  CheckSquare,
  Crown,
  ListTodo,
  Mail,
  Phone,
  UserRound,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  OFFICE_HUB_BASE_PATH,
  formatIsoDate,
  isOpenActionItemStatus,
  isTaskClosed,
  isTaskOverdue,
  taskDueBucket,
  type OfficeHubMeeting,
  type OfficeHubTask,
} from '@/lib/office-hub';
import {
  listActionItems,
  listMeetings,
  listMyTasks,
  listTasks,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  MeetingStatusBadge,
  OfficeHubAccessDenied,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubField,
  OfficeHubKpiCard,
  OfficeHubLoader,
  OfficeHubPageHeader,
  PriorityBadge,
  TaskDueDate,
  TaskStatusBadge,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';

export default function EmployeeProfilePage() {
  const params = useParams<{ employeeId: string }>();
  const userId = params?.employeeId ?? '';
  const { viewer, capabilities, directory, today, periods, isLoading } = useOfficeHub();

  const person = useMemo(
    () => directory.people.find((entry) => entry.userId === userId) ?? null,
    [directory.people, userId],
  );

  const teams = useMemo(
    () => directory.teams.filter((team) => (team.memberUserIds ?? []).includes(userId)),
    [directory.teams, userId],
  );

  const isSelf = userId === viewer.userId;
  const leadsTheirTeam = teams.some((team) => team.leaderId === viewer.userId);
  const headsTheirDepartment = Boolean(
    person?.departmentId && (viewer.headsDepartmentIds ?? []).includes(person.departmentId),
  );

  /**
   * Whether the viewer may see this person's work.
   *
   * Deliberately not the same test as seeing the *directory*: knowing who somebody is and knowing
   * what they are carrying are different questions, and only the second needs a grant.
   */
  const canSeeWork =
    isSelf || capabilities.canViewAllTasks || capabilities.canViewWorkload || leadsTheirTeam || headsTheirDepartment;

  const workQuery = useOfficeHubQuery(
    async () => {
      const [tasks, meetings, actionItems] = await Promise.all([
        isSelf
          ? listMyTasks(userId, { limit: 300 })
          : listTasks('all', viewer, { limit: 400 }).catch(() => [] as OfficeHubTask[]),
        listMeetings(capabilities.canViewAllMeetings ? 'all' : 'mine', viewer, {
          fromDate: periods.monthStart,
          limit: 300,
        }).catch(() => [] as OfficeHubMeeting[]),
        listActionItems({ responsibleUserId: userId, limit: 200 }).catch(() => []),
      ]);
      return { tasks, meetings, actionItems };
    },
    [userId, isSelf, viewer.userId, capabilities.canViewAllMeetings, periods.monthStart],
    { enabled: Boolean(userId) && canSeeWork },
  );

  const theirTasks = useMemo(
    () => (workQuery.data?.tasks ?? []).filter((task) => task.assigneeId === userId),
    [workQuery.data?.tasks, userId],
  );

  const theirMeetings = useMemo(
    () => (workQuery.data?.meetings ?? []).filter((meeting) => (meeting.participantUserIds ?? []).includes(userId)),
    [workQuery.data?.meetings, userId],
  );

  const organized = useMemo(
    () => (workQuery.data?.meetings ?? []).filter((meeting) => meeting.organizerId === userId),
    [workQuery.data?.meetings, userId],
  );

  const counts = useMemo(() => {
    const active = theirTasks.filter((task) => !isTaskClosed(task.status));
    return {
      active: active.length,
      overdue: active.filter((task) => isTaskOverdue(task, today)).length,
      dueSoon: active.filter((task) => ['due-today', 'due-soon'].includes(taskDueBucket(task, today))).length,
      completed: theirTasks.filter((task) => task.status === 'Completed').length,
      meetings: theirMeetings.length,
      upcomingMeetings: theirMeetings.filter((meeting) => meeting.date >= today && meeting.status !== 'Cancelled').length,
      organized: organized.length,
      actionItems: (workQuery.data?.actionItems ?? []).filter((item) => isOpenActionItemStatus(item.status)).length,
    };
  }, [theirTasks, theirMeetings, organized, workQuery.data?.actionItems, today]);

  if (isLoading) return <OfficeHubLoader label="Loading the profile" />;

  if (!capabilities.canViewEmployees && !isSelf) {
    return <OfficeHubAccessDenied what="employee profiles" />;
  }

  if (!person) {
    return (
      <OfficeHubEmptyState
        icon={AlertTriangle}
        title="That employee could not be found."
        description="They may not have an Office Hub login, or the link may be wrong."
        action={
          <Button variant="outline" asChild>
            <Link href={`${OFFICE_HUB_BASE_PATH}/employees`}>Back to the directory</Link>
          </Button>
        }
      />
    );
  }

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
    { header: 'Due', mobile: 'aside', className: 'w-32', cell: (task) => <TaskDueDate task={task} today={today} /> },
    { header: 'Priority', mobile: 'detail', className: 'hidden sm:table-cell w-24', cell: (task) => <PriorityBadge priority={task.priority} /> },
    { header: 'Status', mobile: 'detail', className: 'w-32', cell: (task) => <TaskStatusBadge status={task.status} /> },
  ];

  const meetingColumns: OfficeHubListColumn<OfficeHubMeeting>[] = [
    {
      header: 'When',
      mobile: 'aside',
      className: 'w-36',
      cell: (meeting) => (
        <div>
          <p className="text-sm font-medium">{formatIsoDate(meeting.date, { withWeekday: true })}</p>
          <p className="text-xs text-muted-foreground">{meeting.startTime}</p>
        </div>
      ),
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
    { header: 'Status', mobile: 'detail', className: 'w-28', cell: (meeting) => <MeetingStatusBadge status={meeting.status} /> },
  ];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title={person.name}
        description={[person.designation, person.departmentName].filter(Boolean).join(' · ') || 'Employee'}
        actions={
          <div className="flex flex-wrap gap-2">
            {capabilities.canCreateTask && (
              <Button variant="outline" asChild className="gap-2">
                <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/new?assignee=${person.userId}`}>
                  <ListTodo className="h-4 w-4" />
                  Assign a task
                </Link>
              </Button>
            )}
            {capabilities.canCreateMeeting && (
              <Button variant="outline" asChild className="gap-2">
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/new`}>
                  <CalendarDays className="h-4 w-4" />
                  Schedule a meeting
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <OfficeHubField label="Employee ID">{person.employeeId ?? '—'}</OfficeHubField>
          <OfficeHubField label="Designation">{person.designation ?? '—'}</OfficeHubField>
          <OfficeHubField label="Department">{person.departmentName ?? '—'}</OfficeHubField>
          <OfficeHubField label="Email">
            {person.email ? (
              <a href={`mailto:${person.email}`} className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="break-all">{person.email}</span>
              </a>
            ) : (
              '—'
            )}
          </OfficeHubField>
          <OfficeHubField label="Teams">
            {teams.length === 0 ? (
              '—'
            ) : (
              <div className="flex flex-wrap gap-1">
                {teams.map((team) => (
                  <Link key={team.id} href={`${OFFICE_HUB_BASE_PATH}/teams/${team.id}`}>
                    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px] hover:bg-slate-100">
                      {team.leaderId === person.userId && <Crown className="mr-0.5 h-2.5 w-2.5 text-amber-500" />}
                      {team.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </OfficeHubField>
          <OfficeHubField label="Time zone">{viewer.userId === userId ? viewer.timeZone ?? '—' : '—'}</OfficeHubField>
        </CardContent>
      </Card>

      {!canSeeWork ? (
        <Card className="border-slate-200 bg-slate-50">
          <CardContent className="flex items-start gap-2 px-4 py-4">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <div>
              <p className="text-sm font-medium text-slate-700">Work details are not shown</p>
              <p className="text-xs text-muted-foreground">
                You can look anybody up in the directory. Seeing what somebody is carrying needs a
                wider grant, or that you lead their team or head their department.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <OfficeHubKpiCard label="Active tasks" value={counts.active} icon={ListTodo} tone="blue" />
            <OfficeHubKpiCard label="Overdue" value={counts.overdue} icon={AlertTriangle} tone={counts.overdue ? 'rose' : 'slate'} />
            <OfficeHubKpiCard label="Due soon" value={counts.dueSoon} icon={CalendarDays} tone={counts.dueSoon ? 'amber' : 'slate'} />
            <OfficeHubKpiCard label="Completed" value={counts.completed} icon={CheckSquare} tone="emerald" />
            <OfficeHubKpiCard label="Meetings" value={counts.upcomingMeetings} icon={CalendarDays} tone="indigo" hint="upcoming" />
            <OfficeHubKpiCard label="Action items" value={counts.actionItems} icon={CheckSquare} tone="teal" hint="open" />
          </div>

          <Tabs defaultValue="tasks">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="tasks" className="text-xs">
                Tasks ({theirTasks.length})
              </TabsTrigger>
              <TabsTrigger value="meetings" className="text-xs">
                Meetings ({theirMeetings.length})
              </TabsTrigger>
              <TabsTrigger value="organized" className="text-xs">
                Organized ({organized.length})
              </TabsTrigger>
              <TabsTrigger value="actions" className="text-xs">
                Action items ({counts.actionItems})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tasks" className="mt-3">
              <OfficeHubDataList
                rows={theirTasks}
                columns={taskColumns}
                cardHref={(task) => `${OFFICE_HUB_BASE_PATH}/tasks/${task.id}`}
                rowClassName={(task) => (isTaskOverdue(task, today) ? 'bg-rose-50/60' : undefined)}
                maxHeightClassName="sm:max-h-[32rem]"
                empty={<OfficeHubEmptyState icon={ListTodo} title="No tasks assigned." />}
              />
            </TabsContent>

            <TabsContent value="meetings" className="mt-3">
              <OfficeHubDataList
                rows={theirMeetings}
                columns={meetingColumns}
                cardHref={(meeting) => `${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}
                maxHeightClassName="sm:max-h-[32rem]"
                empty={<OfficeHubEmptyState icon={CalendarDays} title="Not in any meetings this month." />}
              />
            </TabsContent>

            <TabsContent value="organized" className="mt-3">
              <OfficeHubDataList
                rows={organized}
                columns={meetingColumns}
                cardHref={(meeting) => `${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}
                maxHeightClassName="sm:max-h-[32rem]"
                empty={<OfficeHubEmptyState icon={CalendarDays} title="Has not organized a meeting this month." />}
              />
            </TabsContent>

            <TabsContent value="actions" className="mt-3">
              {(workQuery.data?.actionItems ?? []).filter((item) => isOpenActionItemStatus(item.status)).length === 0 ? (
                <OfficeHubEmptyState icon={CheckSquare} title="No open action items." />
              ) : (
                <ul className="divide-y rounded-lg border bg-white">
                  {(workQuery.data?.actionItems ?? [])
                    .filter((item) => isOpenActionItemStatus(item.status))
                    .map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
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
                          {item.taskId && (
                            <Button size="sm" variant="ghost" asChild>
                              <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/${item.taskId}`}>Task</Link>
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>

          <p className="text-[11px] text-muted-foreground">
            Counts only. Office Hub does not rate or rank people — see the note on the Workload page.
          </p>
        </>
      )}

      {teams.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Users className="mr-1 inline h-3 w-3" />
              Team memberships
            </p>
            <ul className="space-y-1.5">
              {teams.map((team) => (
                <li key={team.id} className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`${OFFICE_HUB_BASE_PATH}/teams/${team.id}`}
                    className="text-sm font-medium text-slate-800 hover:underline"
                  >
                    {team.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {team.leaderId === person.userId ? 'Leader' : 'Member'} · {team.memberCount} member
                    {team.memberCount === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Phone is on the HR record rather than the login, so it is shown only when the join found it. */}
      {person.email && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Phone className="h-3 w-3" />
          Contact details come from the company directory. Update them there, not here.
        </p>
      )}
    </div>
  );
}
