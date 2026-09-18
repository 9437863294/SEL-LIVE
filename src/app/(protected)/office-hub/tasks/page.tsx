'use client';

/**
 * The task register (§25's eight views, §38's filters, §65's export).
 *
 * §25 lists My Tasks, Team Tasks, Department Tasks, All Tasks, Overdue, Completed, Calendar and
 * Kanban. Those are not eight screens — they are one screen with a scope, a filter and a display
 * mode, and building them separately would mean eight copies of the same filter panel drifting
 * apart. So:
 *
 *   • **Scope** picks the Firestore query (mine / created / team / department / all), bounded by
 *     what the viewer's grants allow.
 *   • **View** is a preset over the filters — Overdue sets `overdueOnly`, Completed sets the status.
 *   • **Display** is table or board. The calendar view lives on the calendar route, which already
 *     shows task deadlines alongside meetings, rather than being a third rendering here.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckSquare,
  Download,
  KanbanSquare,
  ListTodo,
  Plus,
  Rows3,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  TASK_STATUSES,
  activeFilterCount,
  applyTaskFilters,
  buildTaskStatistics,
  hasActiveFilters,
  isTaskOverdue,
  type OfficeHubPriority,
  type OfficeHubTask,
  type TaskFilters,
  type TaskStatus,
} from '@/lib/office-hub';
import { listMyTasks, listTasks } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  HrCellLink,
  OfficeHubAccessDenied,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubFilterCard,
  OfficeHubKpiCard,
  OfficeHubPageHeader,
  PersonChip,
  PriorityBadge,
  ResultCount,
  TaskDueDate,
  TaskProgressBar,
  TaskStatusBadge,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';
import { DateRangePicker, MultiSelect } from '@/components/office-hub/selectors';
import { TaskKanban, TaskKanbanSkeleton } from '@/components/office-hub/task-kanban';
import { QuickCreateTaskDialog } from '@/components/office-hub/task-form';

type Scope = 'mine' | 'created' | 'team' | 'department' | 'all';
type View = 'all' | 'overdue' | 'completed' | 'unassigned';
type Display = 'table' | 'board';

export default function TasksPage() {
  const searchParams = useSearchParams();
  const { actor, viewer, capabilities, directory, today, isLoading } = useOfficeHub();

  const [scope, setScope] = useState<Scope>((searchParams?.get('scope') as Scope) ?? 'mine');
  const [view, setView] = useState<View>((searchParams?.get('view') as View) ?? 'all');
  const [display, setDisplay] = useState<Display>((searchParams?.get('display') as Display) ?? 'table');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [filters, setFilters] = useState<TaskFilters>({});
  const [creating, setCreating] = useState(false);

  /** A meeting id in the query narrows the register to that meeting's tasks (§14's "View tasks"). */
  const meetingId = searchParams?.get('meeting') ?? null;
  useEffect(() => {
    if (meetingId) setFilters((current) => ({ ...current, meetingIds: [meetingId] }));
  }, [meetingId]);

  const availableScopes = useMemo(() => {
    const scopes: { value: Scope; label: string }[] = [
      { value: 'mine', label: 'Assigned to me' },
      { value: 'created', label: 'Raised by me' },
    ];
    if (capabilities.canViewTeamTasks && (viewer.teamIds?.length ?? 0) > 0) {
      scopes.push({ value: 'team', label: 'My teams' });
    }
    if (capabilities.canViewDepartmentTasks && viewer.departmentId) {
      scopes.push({ value: 'department', label: 'My department' });
    }
    if (capabilities.canViewAllTasks) scopes.push({ value: 'all', label: 'All tasks' });
    return scopes;
  }, [capabilities, viewer.teamIds, viewer.departmentId]);

  const effectiveScope: Scope = availableScopes.some((entry) => entry.value === scope) ? scope : 'mine';

  const tasksQuery = useOfficeHubQuery(
    () =>
      effectiveScope === 'mine'
        ? // "Assigned to me" deliberately includes tasks the viewer watches — a task they raised or
          // commented on is theirs to follow even after it is reassigned.
          listMyTasks(viewer.userId, { limit: 400 })
        : listTasks(effectiveScope, viewer, { limit: 400 }),
    [effectiveScope, viewer.userId, viewer.departmentId],
    { enabled: Boolean(actor) && capabilities.canViewTasks, initial: [] },
  );

  const all = tasksQuery.data ?? [];

  /** The view presets, layered over whatever the user has set by hand. */
  const effectiveFilters = useMemo<TaskFilters>(() => {
    const base: TaskFilters = { ...filters, search: debouncedSearch };
    if (view === 'overdue') return { ...base, overdueOnly: true };
    if (view === 'completed') return { ...base, statuses: ['Completed'] };
    if (view === 'unassigned') return base;
    return base;
  }, [filters, debouncedSearch, view]);

  const filtered = useMemo(() => {
    let rows = applyTaskFilters(all, effectiveFilters, today);
    if (view === 'unassigned') rows = rows.filter((task) => !task.assigneeId && !task.teamId);
    if (view === 'all') rows = rows.filter((task) => task.status !== 'Cancelled');
    return rows;
  }, [all, effectiveFilters, today, view]);

  const stats = useMemo(() => buildTaskStatistics(all, today), [all, today]);

  const clearFilters = () => {
    setFilters({});
    setSearch('');
    setView('all');
  };

  const exportRows = async () => {
    const { exportRowsToExcel } = await import('@/lib/report-excel');
    await exportRowsToExcel(
      'Tasks',
      filtered.map((task) => ({
        Reference: task.reference,
        Title: task.title,
        Assignee: task.assigneeName ?? '',
        Team: task.teamName ?? '',
        Department: task.departmentName ?? '',
        'Start date': task.startDate ?? '',
        'Due date': task.dueDate ?? '',
        Priority: task.priority,
        Status: task.status,
        'Progress %': task.progress ?? 0,
        Overdue: isTaskOverdue(task, today) ? 'Yes' : 'No',
        'Source meeting': task.meetingTitle ?? '',
        Project: task.projectName ?? '',
        Tags: (task.tags ?? []).join(', '),
        Comments: task.commentCount ?? 0,
      })),
      { filename: `office-hub-tasks-${today}.xlsx` },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!capabilities.canViewTasks) return <OfficeHubAccessDenied what="the task register" />;

  const columns: OfficeHubListColumn<OfficeHubTask>[] = [
    {
      header: 'Task',
      mobile: 'title',
      cell: (task) => (
        <div className="min-w-0">
          <HrCellLink
            href={`${OFFICE_HUB_BASE_PATH}/tasks/${task.id}`}
            className="block truncate font-medium hover:underline"
          >
            {task.title}
          </HrCellLink>
          <p className="truncate text-xs text-muted-foreground">
            {task.reference}
            {task.meetingTitle ? ` · from ${task.meetingTitle}` : ''}
            {task.parentTaskTitle ? ` · under ${task.parentTaskTitle}` : ''}
          </p>
        </div>
      ),
    },
    {
      header: 'Assignee',
      mobile: 'detail',
      className: 'w-44',
      cell: (task) => (
        <PersonChip
          name={task.assigneeName ?? task.teamName ?? null}
          subtitle={task.assigneeName && task.teamName ? task.teamName : task.departmentName}
        />
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
      className: 'w-32',
      cell: (task) => <TaskStatusBadge status={task.status} />,
    },
    {
      header: 'Progress',
      mobile: 'footer',
      className: 'hidden md:table-cell w-32',
      cell: (task) => <TaskProgressBar task={task} />,
    },
  ];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Tasks"
        description="One register, scoped to what you can see. Switch to the board to move work along."
        actions={
          <div className="flex flex-wrap gap-2">
            {capabilities.canExportTasks && filtered.length > 0 && (
              <Button variant="outline" onClick={() => void exportRows()} className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            {capabilities.canCreateTask && (
              <>
                <Button onClick={() => setCreating(true)} className="gap-2">
                  <Plus className="h-4 w-4" />
                  New task
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/new`}>Full form</Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <OfficeHubKpiCard label="Total" value={stats.total} icon={ListTodo} tone="slate" />
        <OfficeHubKpiCard label="Not started" value={stats.notStarted} icon={ListTodo} tone="slate" />
        <OfficeHubKpiCard label="In progress" value={stats.inProgress} icon={ListTodo} tone="blue" />
        <OfficeHubKpiCard label="On hold" value={stats.onHold} icon={ListTodo} tone="amber" />
        <OfficeHubKpiCard label="Completed" value={stats.completed} icon={CheckSquare} tone="emerald" />
        <OfficeHubKpiCard
          label="Overdue"
          value={stats.overdue}
          icon={AlertTriangle}
          tone={stats.overdue ? 'rose' : 'slate'}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={view} onValueChange={(next) => setView(next as View)}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="all" className="text-xs">
              Open
            </TabsTrigger>
            <TabsTrigger value="overdue" className="text-xs">
              Overdue{stats.overdue ? ` (${stats.overdue})` : ''}
            </TabsTrigger>
            <TabsTrigger value="completed" className="text-xs">
              Completed
            </TabsTrigger>
            <TabsTrigger value="unassigned" className="text-xs">
              Unassigned
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1 rounded-lg border bg-white p-0.5" role="group" aria-label="Display">
          <Button
            size="sm"
            variant={display === 'table' ? 'default' : 'ghost'}
            aria-pressed={display === 'table'}
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setDisplay('table')}
          >
            <Rows3 className="h-3.5 w-3.5" />
            List
          </Button>
          <Button
            size="sm"
            variant={display === 'board' ? 'default' : 'ghost'}
            aria-pressed={display === 'board'}
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setDisplay('board')}
          >
            <KanbanSquare className="h-3.5 w-3.5" />
            Board
          </Button>
        </div>
      </div>

      <OfficeHubFilterCard
        summary={
          hasActiveFilters(effectiveFilters)
            ? `${activeFilterCount(effectiveFilters)} filter(s) active`
            : `${availableScopes.find((entry) => entry.value === effectiveScope)?.label ?? 'My tasks'}`
        }
        actions={
          hasActiveFilters(effectiveFilters) ? (
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
                placeholder="Reference, title, assignee"
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
            label="Due between"
            from={filters.dueFrom}
            to={filters.dueTo}
            onChange={(range) => setFilters((current) => ({ ...current, dueFrom: range.from, dueTo: range.to }))}
          />

          <MultiSelect
            label="Status"
            placeholder="Any status"
            options={TASK_STATUSES.map((status) => ({ value: status, label: status }))}
            value={filters.statuses ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, statuses: next as TaskStatus[] }))}
          />

          <MultiSelect
            label="Priority"
            placeholder="Any priority"
            options={OFFICE_HUB_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
            value={filters.priorities ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, priorities: next as OfficeHubPriority[] }))}
          />

          <MultiSelect
            label="Assignee"
            placeholder="Anyone"
            options={directory.people.map((person) => ({
              value: person.userId,
              label: person.name,
              hint: person.departmentName ?? undefined,
            }))}
            value={filters.assigneeIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, assigneeIds: next }))}
          />

          <MultiSelect
            label="Team"
            placeholder="Any team"
            options={directory.teams.map((team) => ({ value: team.id, label: team.name }))}
            value={filters.teamIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, teamIds: next }))}
          />

          <MultiSelect
            label="Department"
            placeholder="Any department"
            options={directory.departments.map((department) => ({ value: department.id, label: department.name }))}
            value={filters.departmentIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, departmentIds: next }))}
          />

          <MultiSelect
            label="Project"
            placeholder="Any project"
            options={directory.projects.map((project) => ({ value: project.id, label: project.name }))}
            value={filters.projectIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, projectIds: next }))}
          />
        </div>
      </OfficeHubFilterCard>

      <div className="flex items-center justify-between">
        <ResultCount shown={filtered.length} total={all.length} noun="task" />
        {meetingId && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={clearFilters}>
            <X className="h-3 w-3" />
            Showing one meeting&rsquo;s tasks
          </Button>
        )}
      </div>

      {tasksQuery.isLoading ? (
        display === 'board' ? (
          <TaskKanbanSkeleton />
        ) : (
          <Skeleton className="h-96 w-full rounded-xl" />
        )
      ) : display === 'board' ? (
        <TaskKanban tasks={filtered} onChanged={tasksQuery.reload} />
      ) : (
        <OfficeHubDataList
          rows={filtered}
          columns={columns}
          cardHref={(task) => `${OFFICE_HUB_BASE_PATH}/tasks/${task.id}`}
          maxHeightClassName="sm:max-h-[42rem]"
          rowClassName={(task) =>
            cn(isTaskOverdue(task, today) && 'bg-rose-50/60', task.status === 'Cancelled' && 'opacity-60')
          }
          empty={
            <OfficeHubEmptyState
              icon={view === 'overdue' ? CheckSquare : ListTodo}
              title={
                view === 'overdue'
                  ? 'Nothing is overdue.'
                  : view === 'completed'
                    ? 'No completed tasks in this scope.'
                    : hasActiveFilters(effectiveFilters)
                      ? 'No tasks match these filters.'
                      : 'No pending tasks.'
              }
              description={
                view === 'overdue'
                  ? 'Everything with a due date is on time.'
                  : hasActiveFilters(effectiveFilters)
                    ? 'Clear a filter or widen the scope.'
                    : undefined
              }
              action={
                hasActiveFilters(effectiveFilters) ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : capabilities.canCreateTask ? (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    Create a task
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <QuickCreateTaskDialog open={creating} onOpenChange={setCreating} onCreated={() => tasksQuery.reload()} />
    </div>
  );
}
