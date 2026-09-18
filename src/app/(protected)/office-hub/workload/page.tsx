'use client';

/**
 * Employee workload (§40).
 *
 * ── The constraint that shapes this whole screen ────────────────────────────────────────────────
 *
 * §40 says "do not create performance ratings automatically — only display factual workload
 * information", and §73 repeats it. That is not decoration, and it is worth being explicit about
 * what it rules out here:
 *
 *   • **No composite figure.** There is no "workload score", no utilisation percentage, no index.
 *     The moment several counts are folded into one number, that number gets used to compare
 *     people, and nobody involved agreed to the weights.
 *   • **No default ranking.** The table sorts by name until the reader picks a column. Sorting by
 *     "most tasks" out of the box tells the reader the top row is the answer to a question they
 *     had not asked.
 *   • **No completion-rate column per person.** A rate reads as a grade. Counts of completed and
 *     outstanding work say the same factual thing without it.
 *
 * What the screen *is* for: seeing where work has piled up, so it can be moved.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, CalendarDays, CheckSquare, ListTodo, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  buildWorkload,
  isTaskClosed,
  type WorkloadRow,
} from '@/lib/office-hub';
import { listActionItems, listMeetings, listTasks } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubKpiCard,
  OfficeHubPageHeader,
  PersonChip,
  PriorityBadge,
  ResultCount,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';
import { CategoryBarChart } from '@/components/office-hub/charts';
import { MultiSelect } from '@/components/office-hub/selectors';

type SortKey = 'name' | 'activeTasks' | 'overdueTasks' | 'upcomingTasks' | 'completedTasks' | 'meetings' | 'actionItems';

export default function WorkloadPage() {
  const { viewer, capabilities, directory, today, periods, isLoading } = useOfficeHub();
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  // Alphabetical until the reader asks otherwise — see the note at the top of this file.
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });

  const dataQuery = useOfficeHubQuery(
    async () => {
      const [tasks, meetings, actionItems] = await Promise.all([
        listTasks('all', viewer, { limit: 600 }).catch(() => []),
        listMeetings('all', viewer, { fromDate: periods.monthStart, limit: 500 }).catch(() => []),
        listActionItems({ limit: 500 }).catch(() => []),
      ]);
      return { tasks, meetings, actionItems };
    },
    [viewer.userId, periods.monthStart],
    { enabled: capabilities.canViewWorkload },
  );

  /** The people in scope: everybody, narrowed by department and team. */
  const people = useMemo(() => {
    const teamMembers = teamIds.length
      ? new Set(
          directory.teams
            .filter((team) => teamIds.includes(team.id))
            .flatMap((team) => team.memberUserIds ?? []),
        )
      : null;

    return directory.people
      .filter((person) => (departmentIds.length ? departmentIds.includes(person.departmentId ?? '') : true))
      .filter((person) => (teamMembers ? teamMembers.has(person.userId) : true));
  }, [directory.people, directory.teams, departmentIds, teamIds]);

  const rows = useMemo(() => {
    if (!dataQuery.data) return [];
    return buildWorkload({
      people,
      tasks: dataQuery.data.tasks,
      meetings: dataQuery.data.meetings,
      actionItems: dataQuery.data.actionItems,
      today,
    });
  }, [people, dataQuery.data, today]);

  const sorted = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * factor;
      return ((a[sort.key] as number) - (b[sort.key] as number)) * factor;
    });
  }, [rows, sort]);

  /** Totals across the people in scope — the only aggregate on this page. */
  const totals = useMemo(
    () =>
      rows.reduce(
        (accumulator, row) => ({
          active: accumulator.active + row.activeTasks,
          overdue: accumulator.overdue + row.overdueTasks,
          soon: accumulator.soon + row.upcomingTasks,
          completed: accumulator.completed + row.completedTasks,
          meetings: accumulator.meetings + row.meetings,
          actionItems: accumulator.actionItems + row.actionItems,
        }),
        { active: 0, overdue: 0, soon: 0, completed: 0, meetings: 0, actionItems: 0 },
      ),
    [rows],
  );

  /** Unassigned work, which belongs to nobody and therefore appears in no row above. */
  const unassigned = useMemo(() => {
    const tasks = dataQuery.data?.tasks ?? [];
    return tasks.filter((task) => !task.assigneeId && !task.teamId && !isTaskClosed(task.status));
  }, [dataQuery.data?.tasks]);

  const byDepartment = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of dataQuery.data?.tasks ?? []) {
      if (isTaskClosed(task.status)) continue;
      const label = task.departmentName ?? 'No department';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [dataQuery.data?.tasks]);

  const exportRows = async () => {
    const { exportRowsToExcel } = await import('@/lib/report-excel');
    await exportRowsToExcel(
      'Workload',
      sorted.map((row) => ({
        Name: row.name,
        Department: row.departmentName ?? '',
        'Active tasks': row.activeTasks,
        'Overdue tasks': row.overdueTasks,
        'Due soon': row.upcomingTasks,
        'Completed tasks': row.completedTasks,
        Meetings: row.meetings,
        'Open action items': row.actionItems,
        'Highest open priority': row.topPriority ?? '',
      })),
      { filename: `office-hub-workload-${today}.xlsx` },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!capabilities.canViewWorkload) return <OfficeHubAccessDenied what="the workload view" />;

  const columns: OfficeHubListColumn<WorkloadRow & { id: string }>[] = [
    {
      header: 'Employee',
      mobile: 'title',
      cell: (row) => (
        <PersonChip
          name={row.name}
          subtitle={row.departmentName}
          href={`${OFFICE_HUB_BASE_PATH}/employees/${row.userId}`}
        />
      ),
    },
    {
      header: 'Active',
      align: 'right',
      mobile: 'detail',
      className: 'w-20',
      cell: (row) => <span className="tabular-nums text-sm">{row.activeTasks}</span>,
    },
    {
      header: 'Overdue',
      align: 'right',
      mobile: 'detail',
      className: 'w-20',
      cell: (row) => (
        <span className={cn('tabular-nums text-sm', row.overdueTasks > 0 && 'font-semibold text-rose-700')}>
          {row.overdueTasks}
        </span>
      ),
    },
    {
      header: 'Due soon',
      align: 'right',
      mobile: 'detail',
      className: 'hidden sm:table-cell w-24',
      cell: (row) => (
        <span className={cn('tabular-nums text-sm', row.upcomingTasks > 0 && 'text-amber-700')}>
          {row.upcomingTasks}
        </span>
      ),
    },
    {
      header: 'Completed',
      align: 'right',
      mobile: 'detail',
      className: 'hidden md:table-cell w-24',
      cell: (row) => <span className="tabular-nums text-sm text-emerald-700">{row.completedTasks}</span>,
    },
    {
      header: 'Meetings',
      align: 'right',
      mobile: 'detail',
      className: 'hidden lg:table-cell w-24',
      cell: (row) => <span className="tabular-nums text-sm">{row.meetings}</span>,
    },
    {
      header: 'Action items',
      align: 'right',
      mobile: 'detail',
      className: 'hidden lg:table-cell w-28',
      cell: (row) => <span className="tabular-nums text-sm">{row.actionItems}</span>,
    },
    {
      header: 'Top priority',
      mobile: 'footer',
      className: 'hidden xl:table-cell w-28',
      cell: (row) =>
        row.topPriority ? (
          <PriorityBadge priority={row.topPriority} />
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        ),
    },
  ];

  /** The columns that can be sorted, and the label each chip shows. */
  const headers: [SortKey, string][] = [
    ['name', 'Employee'],
    ['activeTasks', 'Active'],
    ['overdueTasks', 'Overdue'],
    ['upcomingTasks', 'Due soon'],
    ['completedTasks', 'Completed'],
    ['meetings', 'Meetings'],
    ['actionItems', 'Action items'],
  ];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Workload"
        description="Where the work sits, so it can be moved. Counts only — no scores, no ranking."
        actions={
          sorted.length > 0 ? (
            <Button variant="outline" onClick={() => void exportRows()}>
              Export
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <OfficeHubKpiCard label="People in scope" value={rows.length} icon={Users} tone="indigo" />
        <OfficeHubKpiCard label="Active tasks" value={totals.active} icon={ListTodo} tone="blue" />
        <OfficeHubKpiCard
          label="Overdue"
          value={totals.overdue}
          icon={AlertTriangle}
          tone={totals.overdue ? 'rose' : 'slate'}
        />
        <OfficeHubKpiCard label="Due soon" value={totals.soon} icon={CalendarDays} tone={totals.soon ? 'amber' : 'slate'} />
        <OfficeHubKpiCard label="Completed" value={totals.completed} icon={CheckSquare} tone="emerald" />
        <OfficeHubKpiCard label="Open action items" value={totals.actionItems} icon={CheckSquare} tone="teal" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MultiSelect
          label="Department"
          placeholder="All departments"
          options={directory.departments.map((department) => ({ value: department.id, label: department.name }))}
          value={departmentIds}
          onChange={setDepartmentIds}
        />
        <MultiSelect
          label="Team"
          placeholder="All teams"
          options={directory.teams.map((team) => ({ value: team.id, label: team.name }))}
          value={teamIds}
          onChange={setTeamIds}
        />
      </div>

      {unassigned.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                {unassigned.length} open task{unassigned.length === 1 ? '' : 's'} belong to nobody
              </p>
              <p className="text-xs text-amber-900/80">
                Unassigned work appears in no row below, which is how it stays invisible.
              </p>
            </div>
            <Button size="sm" variant="outline" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/tasks?view=unassigned`}>Assign them</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sort by</span>
        {headers.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={sort.key === key}
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
              sort.key === key
                ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
            )}
            onClick={() =>
              setSort((current) =>
                current.key === key
                  ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                  : { key, direction: key === 'name' ? 'asc' : 'desc' },
              )
            }
          >
            {label}
            {sort.key === key &&
              (sort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
          </button>
        ))}
      </div>

      <ResultCount shown={sorted.length} total={directory.people.length} noun="employee" />

      {dataQuery.isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <OfficeHubDataList
          rows={sorted.map((row) => ({ ...row, id: row.userId }))}
          columns={columns}
          maxHeightClassName="sm:max-h-[40rem]"
          rowClassName={(row) => (row.overdueTasks > 0 ? 'bg-rose-50/50' : undefined)}
          empty={
            <OfficeHubEmptyState
              icon={Users}
              title="Nobody in scope."
              description="Clear the department or team filter."
            />
          }
        />
      )}

      <CategoryBarChart
        rows={byDepartment}
        title="Open tasks by department"
        subtitle="Pending work only — completed and cancelled tasks are excluded."
        valueName="Tasks"
      />

      <p className="text-[11px] text-muted-foreground">
        Meeting counts cover this month onwards. Nothing on this page is a rating: there is no
        composite figure, and the table sorts alphabetically until you choose a column.
      </p>
    </div>
  );
}
