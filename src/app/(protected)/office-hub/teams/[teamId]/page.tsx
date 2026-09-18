'use client';

/**
 * The team dashboard (§41) and its members, meetings, tasks and activity (§6).
 *
 * ── What "the team's work" means, and why it is a union ─────────────────────────────────────────
 *
 * A task belongs to a team either because it names the team, or because it is assigned to one of
 * its members. A meeting belongs to a team either because the team was invited as a team, or
 * because its members are participants. Counting only the explicit link would report a team with
 * twenty individually-assigned tasks as having none, which is the number a team leader least wants
 * to be given. `buildTeamDashboard` takes the union, and this page reads the same figures.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarDays,
  CheckSquare,
  Crown,
  ListTodo,
  Pencil,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatAuditStamp } from '@/lib/audit-fields';
import {
  OFFICE_HUB_BASE_PATH,
  buildTeamDashboard,
  buildWorkload,
  canEditTeam,
  canManageTeamMembers,
  formatIsoDate,
  isOpenActionItemStatus,
  isTaskOverdue,
  type OfficeHubMeeting,
  type OfficeHubTask,
} from '@/lib/office-hub';
import {
  getTeam,
  listActionItems,
  listMeetings,
  listTasks,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  HrCellLink,
  MeetingStatusBadge,
  OfficeHubAccessDenied,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubField,
  OfficeHubKpiCard,
  OfficeHubLoader,
  OfficeHubMeter,
  OfficeHubPageHeader,
  PersonChip,
  PriorityBadge,
  ResponseSummaryChip,
  TaskDueDate,
  TaskProgressBar,
  TaskStatusBadge,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';
import {
  TeamArchiveControls,
  TeamDialog,
  TeamMemberList,
  teamDraftFrom,
} from '@/components/office-hub/team-form';

export default function TeamDetailPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = params?.teamId ?? '';
  const { viewer, capabilities, today, periods, isLoading } = useOfficeHub();
  const [editing, setEditing] = useState(false);

  const teamQuery = useOfficeHubQuery(() => getTeam(teamId), [teamId], { enabled: Boolean(teamId) });
  const team = teamQuery.data ?? null;

  const [draft, setDraft] = useState<ReturnType<typeof teamDraftFrom> | null>(null);

  /**
   * The team's work.
   *
   * Fetched with `all` scope because a team leader is entitled to their team's work by virtue of
   * leading it — `buildTeamDashboard` then narrows to what is actually the team's, and the register
   * below shows only those rows. A member without a wider grant gets the same team view, which is
   * the point of the team page.
   */
  const workQuery = useOfficeHubQuery(
    async () => {
      if (!team) return null;
      const [tasks, meetings, actionItems] = await Promise.all([
        listTasks('all', viewer, { limit: 400 }).catch(() => []),
        listMeetings('all', viewer, { fromDate: periods.monthStart, limit: 300 }).catch(() => []),
        listActionItems({ limit: 300 }).catch(() => []),
      ]);
      return { tasks, meetings, actionItems };
    },
    [team?.id, viewer.userId, periods.monthStart],
    { enabled: Boolean(team) },
  );

  const members = useMemo(() => new Set(team?.memberUserIds ?? []), [team?.memberUserIds]);

  const teamTasks = useMemo(
    () =>
      (workQuery.data?.tasks ?? []).filter(
        (task) => task.teamId === team?.id || (task.assigneeId ? members.has(task.assigneeId) : false),
      ),
    [workQuery.data?.tasks, team?.id, members],
  );

  const teamMeetings = useMemo(
    () =>
      (workQuery.data?.meetings ?? []).filter(
        (meeting) =>
          (meeting.teamIds ?? []).includes(team?.id ?? '') ||
          (meeting.participantUserIds ?? []).some((userId) => members.has(userId)),
      ),
    [workQuery.data?.meetings, team?.id, members],
  );

  const teamActionItems = useMemo(
    () =>
      (workQuery.data?.actionItems ?? []).filter(
        (item) =>
          item.responsibleTeamId === team?.id ||
          (item.responsibleUserId ? members.has(item.responsibleUserId) : false),
      ),
    [workQuery.data?.actionItems, team?.id, members],
  );

  const summary = useMemo(() => {
    if (!team) return null;
    return buildTeamDashboard({
      team,
      tasks: workQuery.data?.tasks ?? [],
      meetings: workQuery.data?.meetings ?? [],
      actionItems: workQuery.data?.actionItems ?? [],
      today,
      weekStart: periods.weekStart,
      weekEnd: periods.weekEnd,
    });
  }, [team, workQuery.data, today, periods.weekStart, periods.weekEnd]);

  /** Per-member workload, so a leader can see where the work has piled up (§41). */
  const workload = useMemo(() => {
    if (!team) return [];
    return buildWorkload({
      people: (team.members ?? []).map((member) => ({
        userId: member.userId,
        name: member.name,
        departmentName: member.departmentName ?? null,
      })),
      tasks: teamTasks,
      meetings: teamMeetings,
      actionItems: teamActionItems,
      today,
    });
  }, [team, teamTasks, teamMeetings, teamActionItems, today]);

  if (isLoading || teamQuery.isLoading) return <OfficeHubLoader label="Loading the team" />;

  if (!team) {
    return (
      <OfficeHubEmptyState
        icon={AlertTriangle}
        title="That team could not be found."
        action={
          <Button variant="outline" asChild>
            <Link href={`${OFFICE_HUB_BASE_PATH}/teams`}>Back to teams</Link>
          </Button>
        }
      />
    );
  }

  if (!capabilities.canViewTeams) return <OfficeHubAccessDenied what="this team" />;

  const editVerdict = canEditTeam(team, viewer, capabilities);
  const memberVerdict = canManageTeamMembers(team, viewer, capabilities);

  const taskColumns: OfficeHubListColumn<OfficeHubTask>[] = [
    {
      header: 'Task',
      mobile: 'title',
      cell: (task) => (
        <div className="min-w-0">
          <HrCellLink href={`${OFFICE_HUB_BASE_PATH}/tasks/${task.id}`} className="block truncate font-medium hover:underline">
            {task.title}
          </HrCellLink>
          <p className="truncate text-xs text-muted-foreground">{task.reference}</p>
        </div>
      ),
    },
    { header: 'Assignee', mobile: 'detail', className: 'w-40', cell: (task) => <PersonChip name={task.assigneeName ?? null} /> },
    { header: 'Due', mobile: 'aside', className: 'w-32', cell: (task) => <TaskDueDate task={task} today={today} /> },
    { header: 'Priority', mobile: 'detail', className: 'hidden sm:table-cell w-24', cell: (task) => <PriorityBadge priority={task.priority} /> },
    { header: 'Status', mobile: 'detail', className: 'w-32', cell: (task) => <TaskStatusBadge status={task.status} /> },
    { header: 'Progress', mobile: 'footer', className: 'hidden md:table-cell w-32', cell: (task) => <TaskProgressBar task={task} /> },
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
          <HrCellLink href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`} className="block truncate font-medium hover:underline">
            {meeting.title}
          </HrCellLink>
          <p className="truncate text-xs text-muted-foreground">
            {meeting.meetingType} · {meeting.organizerName}
          </p>
        </div>
      ),
    },
    { header: 'Responses', mobile: 'detail', className: 'hidden md:table-cell w-28', cell: (meeting) => <ResponseSummaryChip summary={meeting.responseSummary} /> },
    { header: 'Status', mobile: 'detail', className: 'w-28', cell: (meeting) => <MeetingStatusBadge status={meeting.status} /> },
  ];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title={team.name}
        description={
          team.description ??
          `${team.memberCount} member${team.memberCount === 1 ? '' : 's'} · led by ${team.leaderName}`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {capabilities.canCreateMeeting && team.status === 'Active' && (
              <Button variant="outline" asChild className="gap-2">
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/new`}>
                  <CalendarDays className="h-4 w-4" />
                  Schedule a meeting
                </Link>
              </Button>
            )}
            {editVerdict.allowed && (
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(teamDraftFrom(team));
                  setEditing(true);
                }}
                className="gap-2"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
            <TeamArchiveControls team={team} canArchive={capabilities.canArchiveTeam} onChanged={teamQuery.reload} />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
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
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Crown className="h-3.5 w-3.5 text-amber-500" />
          {team.leaderName}
        </span>
        {team.departmentName && (
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
            {team.departmentName}
          </Badge>
        )}
      </div>

      {team.status === 'Archived' && (
        <Card className="border-slate-200 bg-slate-50">
          <CardContent className="px-4 py-3">
            <p className="text-sm font-medium text-slate-700">This team is archived.</p>
            <p className="text-xs text-muted-foreground">
              {team.archivedReason ?? 'It is kept so its past meetings and tasks still make sense.'}
            </p>
          </CardContent>
        </Card>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <OfficeHubKpiCard label="Members" value={summary.memberCount} icon={Users} tone="indigo" />
          <OfficeHubKpiCard label="Meetings this week" value={summary.meetingsThisWeek} icon={CalendarDays} tone="blue" />
          <OfficeHubKpiCard label="Tasks" value={summary.tasksTotal} icon={ListTodo} tone="slate" />
          <OfficeHubKpiCard label="Completed" value={summary.tasksCompleted} icon={CheckSquare} tone="emerald" />
          <OfficeHubKpiCard label="Pending" value={summary.tasksPending} icon={ListTodo} tone="amber" />
          <OfficeHubKpiCard
            label="Overdue"
            value={summary.tasksOverdue}
            icon={AlertTriangle}
            tone={summary.tasksOverdue ? 'rose' : 'slate'}
          />
        </div>
      )}

      {summary && summary.tasksTotal > 0 && (
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
            <OfficeHubMeter label="Tasks completed" percent={summary.completionRate} hint={`${summary.tasksCompleted} of ${summary.tasksTotal}`} />
            <OfficeHubField label="Open action items">{summary.actionItems}</OfficeHubField>
            <OfficeHubField label="Upcoming meetings">{summary.meetingsUpcoming}</OfficeHubField>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="members">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="members" className="text-xs">
            Members ({team.memberCount})
          </TabsTrigger>
          <TabsTrigger value="workload" className="text-xs">
            Who has what
          </TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs">
            Tasks ({teamTasks.length})
          </TabsTrigger>
          <TabsTrigger value="meetings" className="text-xs">
            Meetings ({teamMeetings.length})
          </TabsTrigger>
          <TabsTrigger value="actions" className="text-xs">
            Action items ({teamActionItems.filter((item) => isOpenActionItemStatus(item.status)).length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-3">
          <TeamMemberList
            team={team}
            canManage={memberVerdict.allowed}
            canChangeLeader={capabilities.canChangeTeamLeader || team.leaderId === viewer.userId}
            onChanged={teamQuery.reload}
          />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Created by {formatAuditStamp(team.createdByName, team.createdAt)}
          </p>
        </TabsContent>

        <TabsContent value="workload" className="mt-3">
          {/* §40/§73: plain counts per person. No score, no ranking. */}
          <OfficeHubDataList
            rows={workload.map((row) => ({ ...row, id: row.userId }))}
            columns={[
              { header: 'Member', mobile: 'title', cell: (row) => <PersonChip name={row.name} subtitle={row.departmentName} /> },
              { header: 'Active tasks', align: 'right', mobile: 'detail', cell: (row) => <span className="tabular-nums">{row.activeTasks}</span> },
              {
                header: 'Overdue',
                align: 'right',
                mobile: 'detail',
                cell: (row) => (
                  <span className={row.overdueTasks ? 'font-medium tabular-nums text-rose-700' : 'tabular-nums'}>
                    {row.overdueTasks}
                  </span>
                ),
              },
              { header: 'Due soon', align: 'right', mobile: 'detail', cell: (row) => <span className="tabular-nums">{row.upcomingTasks}</span> },
              { header: 'Completed', align: 'right', mobile: 'detail', cell: (row) => <span className="tabular-nums">{row.completedTasks}</span> },
              { header: 'Meetings', align: 'right', mobile: 'detail', cell: (row) => <span className="tabular-nums">{row.meetings}</span> },
              { header: 'Action items', align: 'right', mobile: 'footer', cell: (row) => <span className="tabular-nums">{row.actionItems}</span> },
            ]}
            empty={<OfficeHubEmptyState icon={Users} title="No members to report on." />}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Counts only. Office Hub does not score or rank people.
          </p>
        </TabsContent>

        <TabsContent value="tasks" className="mt-3">
          <OfficeHubDataList
            rows={teamTasks}
            columns={taskColumns}
            cardHref={(task) => `${OFFICE_HUB_BASE_PATH}/tasks/${task.id}`}
            rowClassName={(task) => (isTaskOverdue(task, today) ? 'bg-rose-50/60' : undefined)}
            maxHeightClassName="sm:max-h-[32rem]"
            empty={<OfficeHubEmptyState icon={ListTodo} title="No tasks for this team." />}
          />
        </TabsContent>

        <TabsContent value="meetings" className="mt-3">
          <OfficeHubDataList
            rows={teamMeetings}
            columns={meetingColumns}
            cardHref={(meeting) => `${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}
            maxHeightClassName="sm:max-h-[32rem]"
            empty={<OfficeHubEmptyState icon={CalendarDays} title="No meetings involving this team." />}
          />
        </TabsContent>

        <TabsContent value="actions" className="mt-3">
          {teamActionItems.filter((item) => isOpenActionItemStatus(item.status)).length === 0 ? (
            <OfficeHubEmptyState icon={CheckSquare} title="No open action items." />
          ) : (
            <ul className="divide-y rounded-lg border bg-white">
              {teamActionItems
                .filter((item) => isOpenActionItemStatus(item.status))
                .map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.reference} · {item.responsibleUserName || item.responsibleTeamName || 'Unassigned'}
                        {item.dueDate ? ` · due ${formatIsoDate(item.dueDate)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <PriorityBadge priority={item.priority} />
                      {item.taskId ? (
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/${item.taskId}`}>Task</Link>
                        </Button>
                      ) : item.meetingId ? (
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${item.meetingId}`}>Meeting</Link>
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      {draft && (
        <TeamDialog
          open={editing}
          onOpenChange={(open) => {
            setEditing(open);
            if (!open) setDraft(null);
          }}
          draft={draft}
          setDraft={setDraft}
          onSaved={() => {
            setDraft(null);
            teamQuery.reload();
          }}
        />
      )}
    </div>
  );
}
