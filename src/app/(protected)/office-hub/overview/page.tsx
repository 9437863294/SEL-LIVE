'use client';

/**
 * The management overview (§73).
 *
 * A management-only page, and §73 is precise about what belongs on it: upcoming meetings, meetings
 * completed, open and overdue action items, open decisions, task workload, department-wise pending
 * tasks, upcoming deadlines. And precise about what does not — "do not generate employee
 * performance scores or rankings."
 *
 * So the page is operational facts in the units the people doing the work see them in. The one
 * editorial decision it makes is ordering: the deadline list is sorted soonest-first with overdue
 * at the top, because a management overview that opens on "here is everything" is one nobody reads
 * twice.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  FileText,
  Gavel,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  buildManagementOverview,
  formatIsoDate,
  type ManagementOverview,
} from '@/lib/office-hub';
import {
  listActionItems,
  listDecisions,
  listMeetings,
  listTasks,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubLookups, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubPageHeader,
  OfficeHubSection,
  PriorityBadge,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';
import { CategoryBarChart, HeroFigure } from '@/components/office-hub/charts';

export default function ManagementOverviewPage() {
  const { viewer, capabilities, today, periods, isLoading } = useOfficeHub();
  const { departmentNames } = useOfficeHubLookups();

  const dataQuery = useOfficeHubQuery(
    async () => {
      const [meetings, tasks, decisions, actionItems] = await Promise.all([
        listMeetings('all', viewer, { fromDate: periods.monthStart, limit: 500 }).catch(() => []),
        listTasks('all', viewer, { limit: 600 }).catch(() => []),
        listDecisions({ limit: 500 }).catch(() => []),
        listActionItems({ limit: 500 }).catch(() => []),
      ]);
      return { meetings, tasks, decisions, actionItems };
    },
    [viewer.userId, periods.monthStart],
    { enabled: capabilities.canViewManagementOverview },
  );

  const overview = useMemo<ManagementOverview | null>(() => {
    if (!dataQuery.data) return null;
    return buildManagementOverview({
      meetings: dataQuery.data.meetings,
      tasks: dataQuery.data.tasks,
      decisions: dataQuery.data.decisions,
      actionItems: dataQuery.data.actionItems,
      today,
      monthStart: periods.monthStart,
      monthEnd: periods.monthEnd,
      departmentNames,
    });
  }, [dataQuery.data, today, periods.monthStart, periods.monthEnd, departmentNames]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!capabilities.canViewManagementOverview) {
    return <OfficeHubAccessDenied what="the management overview" />;
  }

  type DeadlineRow = ManagementOverview['upcomingDeadlines'][number] & { id: string };

  const deadlineColumns: OfficeHubListColumn<DeadlineRow>[] = [
    {
      header: 'Due',
      mobile: 'aside',
      className: 'w-32',
      cell: (row) => (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-xs tabular-nums',
            row.overdue ? 'font-semibold text-rose-700' : 'text-slate-700',
          )}
        >
          {row.overdue && <AlertTriangle className="h-3.5 w-3.5" />}
          {formatIsoDate(row.dueDate)}
        </span>
      ),
    },
    {
      header: 'What',
      mobile: 'title',
      cell: (row) => (
        <div className="min-w-0">
          <Link
            href={
              row.kind === 'task'
                ? `${OFFICE_HUB_BASE_PATH}/tasks/${row.id}`
                : row.kind === 'decision'
                  ? `${OFFICE_HUB_BASE_PATH}/decisions/${row.id}`
                  : `${OFFICE_HUB_BASE_PATH}/action-items`
            }
            className="block truncate font-medium hover:underline"
          >
            {row.title}
          </Link>
          <p className="truncate text-xs capitalize text-muted-foreground">
            {row.kind.replace('-', ' ')}
          </p>
        </div>
      ),
    },
    {
      header: 'Owner',
      mobile: 'detail',
      className: 'w-44',
      cell: (row) => <span className="truncate text-sm text-slate-700">{row.owner}</span>,
    },
    {
      header: 'Priority',
      mobile: 'footer',
      className: 'w-24',
      cell: (row) => (row.priority ? <PriorityBadge priority={row.priority} /> : <span className="text-[11px] text-muted-foreground">—</span>),
    },
  ];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Management overview"
        description={`Operational position as at ${formatIsoDate(today, { withWeekday: true })}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/reports`}>Reports</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/workload`}>Workload</Link>
            </Button>
          </div>
        }
      />

      {dataQuery.isLoading || !overview ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <OfficeHubSection title="Meetings" description="This month, and what is still to come.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <HeroFigure label="Upcoming" value={overview.upcomingMeetings} hint="scheduled, not yet held" />
              <HeroFigure label="Completed this month" value={overview.meetingsCompletedThisMonth} tone="emerald" />
              <HeroFigure
                label="Cancelled this month"
                value={overview.meetingsCancelledThisMonth}
                tone={overview.meetingsCancelledThisMonth ? 'amber' : 'slate'}
              />
              <HeroFigure
                label="Minutes outstanding"
                value={overview.unpublishedMinutes}
                hint="completed, not published"
                tone={overview.unpublishedMinutes ? 'amber' : 'emerald'}
              />
            </div>
          </OfficeHubSection>

          <OfficeHubSection
            title="What was asked for, and whether it happened"
            description="Open and overdue across decisions, action items and tasks."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <HeroFigure label="Open decisions" value={overview.openDecisions} />
              <HeroFigure
                label="Overdue decisions"
                value={overview.overdueDecisions}
                tone={overview.overdueDecisions ? 'rose' : 'slate'}
              />
              <HeroFigure label="Open action items" value={overview.openActionItems} />
              <HeroFigure
                label="Overdue action items"
                value={overview.overdueActionItems}
                tone={overview.overdueActionItems ? 'rose' : 'slate'}
              />
              <HeroFigure label="Active tasks" value={overview.activeTasks} />
              <HeroFigure
                label="Overdue tasks"
                value={overview.overdueTasks}
                tone={overview.overdueTasks ? 'rose' : 'slate'}
              />
            </div>
          </OfficeHubSection>

          {(overview.overdueTasks > 0 || overview.overdueActionItems > 0 || overview.overdueDecisions > 0) && (
            <Card className="border-rose-200 bg-rose-50/70">
              <CardContent className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-rose-900">
                    {overview.overdueTasks + overview.overdueActionItems + overview.overdueDecisions} items are
                    past their date
                  </p>
                  <p className="text-xs text-rose-900/80">
                    {overview.overdueTasks} task{overview.overdueTasks === 1 ? '' : 's'} ·{' '}
                    {overview.overdueActionItems} action item{overview.overdueActionItems === 1 ? '' : 's'} ·{' '}
                    {overview.overdueDecisions} decision{overview.overdueDecisions === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`${OFFICE_HUB_BASE_PATH}/tasks?view=overdue`}>Tasks</Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`${OFFICE_HUB_BASE_PATH}/action-items`}>Action items</Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`${OFFICE_HUB_BASE_PATH}/decisions`}>Decisions</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <CategoryBarChart
            rows={overview.departmentPendingTasks}
            title="Pending tasks by department"
            subtitle="Open work only. Every bar is the same colour because departments have no order."
            valueName="Tasks"
            limit={10}
          />

          <OfficeHubSection
            title="Upcoming deadlines"
            description="The next fortnight across tasks, decisions and action items — overdue first."
          >
            <OfficeHubDataList
              rows={overview.upcomingDeadlines.map((row) => ({ ...row }))}
              columns={deadlineColumns}
              maxHeightClassName="sm:max-h-[32rem]"
              rowClassName={(row) => (row.overdue ? 'bg-rose-50/60' : undefined)}
              empty={
                <OfficeHubEmptyState
                  icon={CalendarCheck}
                  title="Nothing due in the next fortnight."
                  description="No task, decision or action item has a date inside the window."
                />
              }
            />
          </OfficeHubSection>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <QuickLink
              href={`${OFFICE_HUB_BASE_PATH}/meetings`}
              icon={CalendarDays}
              label="Meeting register"
              hint="Filter by department, type or organizer"
            />
            <QuickLink
              href={`${OFFICE_HUB_BASE_PATH}/decisions`}
              icon={Gavel}
              label="Decision register"
              hint="Every decision and its owner"
            />
            <QuickLink
              href={`${OFFICE_HUB_BASE_PATH}/action-items`}
              icon={CheckSquare}
              label="Action items"
              hint="Including the ones with no task"
            />
            <QuickLink
              href={`${OFFICE_HUB_BASE_PATH}/reports`}
              icon={FileText}
              label="Reports"
              hint="Trends, breakdowns and exports"
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Operational facts only. Office Hub does not compute performance scores or rank people —
            see the note on the Workload page.
          </p>
        </>
      )}
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  hint: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full border-white/60 bg-white/80 transition-shadow hover:shadow-md">
        <CardContent className="flex items-start gap-2.5 p-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <Icon className="h-4 w-4 text-slate-500" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">{label}</p>
            <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
