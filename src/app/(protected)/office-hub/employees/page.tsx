'use client';

/**
 * The employee directory (§4).
 *
 * ── This is a read over existing master data, not a second directory ────────────────────────────
 *
 * §89 is explicit that an application added to an existing ERP must integrate with the master data
 * already there rather than duplicating it. So every row here comes from the app's own `users` and
 * `employees` collections, joined by `loadOfficeHubDirectory`, and Office Hub adds only the thing
 * it knows that they do not: how much meeting and task work each person is carrying.
 *
 * Nothing on this screen writes to an employee record. The one write in the module's employee
 * feature is the importer, which reconciles rather than inserts — see `office-hub-import.ts`.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Download, Search, Upload, UserRound, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  OFFICE_HUB_BASE_PATH,
  buildWorkload,
  normalizeSearchTerm,
  scoreMatch,
} from '@/lib/office-hub';
import { listActionItems, listMeetings, listTasks } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubKpiCard,
  OfficeHubPageHeader,
  PersonChip,
  ResultCount,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';
import { MultiSelect } from '@/components/office-hub/selectors';

export default function EmployeesPage() {
  const { viewer, capabilities, directory, today, periods, isLoading } = useOfficeHub();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);

  /**
   * The work behind the counts.
   *
   * Only fetched for a viewer who may see the wide picture; for everybody else the directory is a
   * directory, with no counts, which is the honest result rather than a column of zeroes.
   */
  const workQuery = useOfficeHubQuery(
    async () => {
      const [tasks, meetings, actionItems] = await Promise.all([
        listTasks('all', viewer, { limit: 500 }).catch(() => []),
        listMeetings('all', viewer, { fromDate: periods.monthStart, limit: 400 }).catch(() => []),
        listActionItems({ limit: 400 }).catch(() => []),
      ]);
      return { tasks, meetings, actionItems };
    },
    [viewer.userId, periods.monthStart],
    { enabled: capabilities.canViewWorkload && capabilities.canViewAllTasks },
  );

  const showCounts = Boolean(workQuery.data);

  const rows = useMemo(() => {
    const workload = showCounts
      ? buildWorkload({
          people: directory.people,
          tasks: workQuery.data!.tasks,
          meetings: workQuery.data!.meetings,
          actionItems: workQuery.data!.actionItems,
          today,
        })
      : [];
    const byUserId = new Map(workload.map((entry) => [entry.userId, entry]));

    const needle = normalizeSearchTerm(debouncedSearch);
    return directory.people
      .filter((person) => (departmentIds.length ? departmentIds.includes(person.departmentId ?? '') : true))
      .filter((person) => {
        if (needle.length < 2) return true;
        return (
          scoreMatch(needle, [
            { value: person.name, weight: 1 },
            { value: person.employeeId, weight: 1.1 },
            { value: person.designation, weight: 0.6 },
            { value: person.email, weight: 0.5 },
            { value: person.departmentName, weight: 0.4 },
          ]).score > 0
        );
      })
      .map((person) => ({
        id: person.userId,
        ...person,
        work: byUserId.get(person.userId) ?? null,
        teams: directory.teams.filter((team) => (team.memberUserIds ?? []).includes(person.userId)),
      }));
  }, [directory.people, directory.teams, departmentIds, debouncedSearch, showCounts, workQuery.data, today]);

  const exportRows = async () => {
    const { exportRowsToExcel } = await import('@/lib/report-excel');
    await exportRowsToExcel(
      'Employees',
      rows.map((row) => ({
        'Employee ID': row.employeeId ?? '',
        Name: row.name,
        Email: row.email ?? '',
        Designation: row.designation ?? '',
        Department: row.departmentName ?? '',
        Teams: row.teams.map((team) => team.name).join(', '),
        ...(showCounts
          ? {
              'Active tasks': row.work?.activeTasks ?? 0,
              'Overdue tasks': row.work?.overdueTasks ?? 0,
              'Completed tasks': row.work?.completedTasks ?? 0,
              Meetings: row.work?.meetings ?? 0,
              'Action items': row.work?.actionItems ?? 0,
            }
          : {}),
      })),
      { filename: `office-hub-employees-${today}.xlsx` },
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

  if (!capabilities.canViewEmployees) return <OfficeHubAccessDenied what="the employee directory" />;

  type Row = (typeof rows)[number];

  const columns: OfficeHubListColumn<Row>[] = [
    {
      header: 'Employee',
      mobile: 'title',
      cell: (row) => (
        <PersonChip
          name={row.name}
          subtitle={[row.designation, row.employeeId].filter(Boolean).join(' · ') || null}
          href={`${OFFICE_HUB_BASE_PATH}/employees/${row.userId}`}
        />
      ),
    },
    {
      header: 'Department',
      mobile: 'detail',
      className: 'w-40',
      cell: (row) => <span className="text-sm text-slate-700">{row.departmentName ?? '—'}</span>,
    },
    {
      header: 'Teams',
      mobile: 'detail',
      className: 'hidden lg:table-cell w-48',
      cell: (row) =>
        row.teams.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.teams.slice(0, 2).map((team) => (
              <Badge key={team.id} variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
                {team.name}
              </Badge>
            ))}
            {row.teams.length > 2 && (
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
                +{row.teams.length - 2}
              </Badge>
            )}
          </div>
        ),
    },
    {
      header: 'Email',
      mobile: 'detail',
      className: 'hidden xl:table-cell',
      cell: (row) => <span className="truncate text-xs text-muted-foreground">{row.email ?? '—'}</span>,
    },
  ];

  if (showCounts) {
    columns.push(
      {
        header: 'Active tasks',
        mobile: 'detail',
        align: 'right',
        className: 'w-24',
        cell: (row) => <span className="tabular-nums text-sm">{row.work?.activeTasks ?? 0}</span>,
      },
      {
        header: 'Overdue',
        mobile: 'detail',
        align: 'right',
        className: 'w-20',
        cell: (row) => (
          <span
            className={
              (row.work?.overdueTasks ?? 0) > 0 ? 'text-sm font-medium tabular-nums text-rose-700' : 'tabular-nums text-sm'
            }
          >
            {row.work?.overdueTasks ?? 0}
          </span>
        ),
      },
      {
        header: 'Meetings',
        mobile: 'footer',
        align: 'right',
        className: 'hidden md:table-cell w-24',
        cell: (row) => <span className="tabular-nums text-sm">{row.work?.meetings ?? 0}</span>,
      },
    );
  }

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Employees"
        description="Read from the company directory. Office Hub adds only what it knows: meeting and task load."
        actions={
          <div className="flex flex-wrap gap-2">
            {rows.length > 0 && (
              <Button variant="outline" onClick={() => void exportRows()} className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            {capabilities.canImportEmployees && (
              <Button variant="outline" asChild className="gap-2">
                <Link href={`${OFFICE_HUB_BASE_PATH}/import`}>
                  <Upload className="h-4 w-4" />
                  Import
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <OfficeHubKpiCard label="People with a login" value={directory.people.length} icon={UserRound} tone="cyan" />
        <OfficeHubKpiCard label="Departments" value={directory.departments.length} icon={Users} tone="indigo" />
        <OfficeHubKpiCard label="Teams" value={directory.teams.length} icon={Users} tone="violet" />
        <OfficeHubKpiCard
          label="Without a department"
          value={directory.people.filter((person) => !person.departmentId).length}
          icon={UserRound}
          tone="amber"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          <Label className="mb-1 block text-xs">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, employee ID, designation or email"
              className="bg-white pl-8"
              aria-label="Search employees"
            />
          </div>
        </div>
        <MultiSelect
          label="Department"
          placeholder="All departments"
          options={directory.departments.map((department) => ({ value: department.id, label: department.name }))}
          value={departmentIds}
          onChange={setDepartmentIds}
        />
      </div>

      <ResultCount shown={rows.length} total={directory.people.length} noun="employee" />

      <OfficeHubDataList
        rows={rows}
        columns={columns}
        cardHref={(row) => `${OFFICE_HUB_BASE_PATH}/employees/${row.userId}`}
        maxHeightClassName="sm:max-h-[42rem]"
        empty={
          <OfficeHubEmptyState
            icon={UserRound}
            title={search || departmentIds.length ? 'Nobody matches that.' : 'No employees with a login yet.'}
            description={
              search || departmentIds.length
                ? 'Try a different spelling, or clear the department filter.'
                : 'The directory lists people who have an account, because only they can be invited and respond.'
            }
          />
        }
      />

      {!showCounts && capabilities.canViewWorkload && (
        <p className="text-[11px] text-muted-foreground">
          Work counts are shown to users who can see all tasks. Open{' '}
          <Link href={`${OFFICE_HUB_BASE_PATH}/workload`} className="text-indigo-600 hover:underline">
            Workload
          </Link>{' '}
          for the breakdown you are entitled to.
        </p>
      )}
    </div>
  );
}
