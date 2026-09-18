'use client';

/**
 * Management reports (§39).
 *
 * Four reports — meetings, tasks, action items, decisions — as tabs over one fetch, because they
 * share the same underlying records and separate routes would mean four reads of the same data.
 *
 * ── The chart forms, and why each is what it is ─────────────────────────────────────────────────
 *
 * Every chart here goes through `charts.tsx`, whose header explains the palette checks. The form
 * choices are:
 *
 *   • **Monthly trend** — a line, one series, no legend, only the endpoint labelled.
 *   • **By department / type / organizer / assignee** — horizontal bars in a *single* hue. These
 *     are nominal categories; colouring them darker-where-bigger would double-encode bar length as
 *     hue and spend the only free channel restating what the bar already says.
 *   • **By priority / by age** — the ordinal ramp, because those categories genuinely run low to
 *     high. "No date" is drawn off-scale in neutral rather than given a ramp step it would
 *     misrepresent.
 *   • **Status composition** — one stacked bar with a legend, because the question is what
 *     proportion of the work sits where.
 *   • **The headline counts are numbers, not charts.** A one-bar chart is how a number gets harder
 *     to read than it needs to be.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BarChart3, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  OFFICE_HUB_BASE_PATH,
  addDays,
  buildActionItemReport,
  buildDecisionReport,
  buildMeetingReport,
  buildTaskReport,
  reportRowsToSheet,
} from '@/lib/office-hub';
import {
  listActionItems,
  listDecisions,
  listMeetingParticipants,
  listMeetings,
  listTasks,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubLookups, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubPageHeader,
  OfficeHubSection,
} from '@/components/office-hub/ui';
import { DateRangePicker } from '@/components/office-hub/selectors';
import {
  CategoryBarChart,
  CompositionBar,
  HeroFigure,
  MonthlyTrendChart,
  OrdinalBarChart,
} from '@/components/office-hub/charts';

export default function ReportsPage() {
  const { viewer, capabilities, today, isLoading } = useOfficeHub();
  const { departmentNames } = useOfficeHubLookups();

  const [range, setRange] = useState<{ from: string | null; to: string | null }>({
    // Six months back is the window a management review actually reads; the picker widens it.
    from: addDays(today, -183),
    to: addDays(today, 60),
  });

  const dataQuery = useOfficeHubQuery(
    async () => {
      const meetings = await listMeetings('all', viewer, {
        fromDate: range.from ?? undefined,
        toDate: range.to ?? undefined,
        limit: 600,
      }).catch(() => []);

      const [tasks, actionItems, decisions] = await Promise.all([
        listTasks('all', viewer, { limit: 600 }).catch(() => []),
        listActionItems({ limit: 600 }).catch(() => []),
        listDecisions({ limit: 600 }).catch(() => []),
      ]);

      /**
       * Attendance needs the participant rows, and there is no cross-meeting participant query
       * that is both cheap and correct. So it is fetched for the most recent completed meetings
       * only, and the attendance figure is labelled as covering that sample rather than
       * everything — a headline number whose basis is not stated is worse than no number.
       */
      const completed = meetings
        .filter((meeting) => meeting.status === 'Completed')
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 40);
      const participantGroups = await Promise.all(
        completed.map((meeting) => listMeetingParticipants(meeting.id).catch(() => [])),
      );

      return {
        meetings,
        tasks,
        actionItems,
        decisions,
        participants: participantGroups.flat(),
        attendanceSample: completed.length,
      };
    },
    [viewer.userId, range.from, range.to],
    { enabled: capabilities.canViewReports },
  );

  const data = dataQuery.data;

  const meetingReport = useMemo(
    () => (data ? buildMeetingReport(data.meetings, data.participants, { departmentNames }) : null),
    [data, departmentNames],
  );
  const taskReport = useMemo(
    () => (data ? buildTaskReport(data.tasks, today, { departmentNames }) : null),
    [data, today, departmentNames],
  );
  const actionReport = useMemo(() => (data ? buildActionItemReport(data.actionItems, today) : null), [data, today]);
  const decisionReport = useMemo(
    () => (data ? buildDecisionReport(data.decisions, today, { departmentNames }) : null),
    [data, today, departmentNames],
  );

  const exportAll = async () => {
    if (!meetingReport || !taskReport || !actionReport || !decisionReport) return;
    const { exportWorkbook } = await import('@/lib/report-excel');

    const sheets = [
      { title: 'Meetings by month', rows: meetingReport.byMonth },
      { title: 'Meetings by department', rows: meetingReport.byDepartment },
      { title: 'Meetings by type', rows: meetingReport.byType },
      { title: 'Meetings by organizer', rows: meetingReport.byOrganizer },
      { title: 'Tasks by status', rows: taskReport.byStatus },
      { title: 'Tasks by priority', rows: taskReport.byPriority },
      { title: 'Tasks by assignee', rows: taskReport.byAssignee },
      { title: 'Tasks by department', rows: taskReport.byDepartment },
      { title: 'Action items by person', rows: actionReport.byResponsible },
      { title: 'Action item ageing', rows: actionReport.ageing },
      { title: 'Decisions by owner', rows: decisionReport.byOwner },
      { title: 'Decision ageing', rows: decisionReport.ageing },
    ].map(({ title, rows }) => {
      const sheet = reportRowsToSheet(title, rows);
      return {
        name: sheet.title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31),
        columns: [
          { header: 'Label', key: 'Label', width: 32 },
          { header: 'Count', key: 'Count', width: 12 },
          { header: 'Share %', key: 'Share %', width: 12 },
        ],
        rows: sheet.rows,
      };
    });

    await exportWorkbook(`office-hub-reports-${today}.xlsx`, sheets);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!capabilities.canViewReports) return <OfficeHubAccessDenied what="reports" />;

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Reports"
        description="Meetings, tasks, action items and decisions over a period you choose."
        actions={
          capabilities.canExportReports && data ? (
            <Button variant="outline" onClick={() => void exportAll()} className="gap-2">
              <Download className="h-4 w-4" />
              Export all sheets
            </Button>
          ) : undefined
        }
      />

      <div className="max-w-md">
        <Label className="mb-1 block text-xs">Period</Label>
        <DateRangePicker
          label="Meetings between"
          from={range.from}
          to={range.to}
          onChange={setRange}
        />
      </div>

      {dataQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : !meetingReport || !taskReport || !actionReport || !decisionReport ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          The reports could not be loaded. Check your connection and try again.
        </p>
      ) : (
        <Tabs defaultValue="meetings">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="meetings" className="text-xs">
              Meetings
            </TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs">
              Tasks
            </TabsTrigger>
            <TabsTrigger value="actions" className="text-xs">
              Action items
            </TabsTrigger>
            <TabsTrigger value="decisions" className="text-xs">
              Decisions
            </TabsTrigger>
          </TabsList>

          {/* ── meetings ─────────────────────────────────────────────────────────────────────── */}
          <TabsContent value="meetings" className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <HeroFigure label="Meetings" value={meetingReport.total} hint="in this period" />
              <HeroFigure label="Completed" value={meetingReport.completed} tone="emerald" />
              <HeroFigure label="Cancelled" value={meetingReport.cancelled} tone={meetingReport.cancelled ? 'rose' : 'slate'} />
              <HeroFigure label="Recurring" value={meetingReport.recurring} hint="series members" />
              <HeroFigure
                label="Minutes published"
                value={meetingReport.minutesPublished}
                hint={`of ${meetingReport.completed} completed`}
                tone={
                  meetingReport.completed > 0 && meetingReport.minutesPublished < meetingReport.completed
                    ? 'amber'
                    : 'emerald'
                }
              />
              <HeroFigure
                label="Time booked"
                value={`${Math.round(meetingReport.scheduledMinutes / 60)}h`}
                hint="excluding cancelled"
              />
            </div>

            <MonthlyTrendChart
              rows={meetingReport.byMonth}
              title="Meetings by month"
              subtitle="Every meeting in the period, cancelled ones included."
            />

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <CategoryBarChart
                rows={meetingReport.byDepartment}
                title="By department"
                subtitle="A meeting spanning two departments is counted under both."
                valueName="Meetings"
              />
              <CategoryBarChart rows={meetingReport.byType} title="By meeting type" valueName="Meetings" />
              <CategoryBarChart rows={meetingReport.byOrganizer} title="By organizer" valueName="Meetings" />
              <CompositionBar
                rows={meetingReport.byStatus}
                title="Status composition"
                subtitle="Where the period's meetings ended up."
                valueName="Meetings"
              />
            </div>

            <OfficeHubSection
              title="Attendance"
              description={`From the ${data?.attendanceSample ?? 0} most recently completed meetings in this period — not the whole set.`}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <HeroFigure label="Invited" value={meetingReport.attendance.invited} />
                <HeroFigure label="Present" value={meetingReport.attendance.present} tone="emerald" />
                <HeroFigure label="Late" value={meetingReport.attendance.late} tone="amber" />
                <HeroFigure label="Absent" value={meetingReport.attendance.absent} tone="rose" />
                <HeroFigure label="Excused" value={meetingReport.attendance.excused} />
                <HeroFigure
                  label="Attendance"
                  value={`${meetingReport.attendance.attendanceRate}%`}
                  hint="present or late, over invited"
                />
              </div>
              {meetingReport.attendance.unmarked > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {meetingReport.attendance.unmarked} invitations in that sample have no attendance
                  recorded, so the rate understates what actually happened.
                </p>
              )}
            </OfficeHubSection>
          </TabsContent>

          {/* ── tasks ────────────────────────────────────────────────────────────────────────── */}
          <TabsContent value="tasks" className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <HeroFigure label="Tasks" value={taskReport.total} />
              <HeroFigure label="Completed" value={taskReport.completed} tone="emerald" />
              <HeroFigure label="Pending" value={taskReport.pending} tone="amber" />
              <HeroFigure label="Overdue" value={taskReport.overdue} tone={taskReport.overdue ? 'rose' : 'slate'} />
              <HeroFigure
                label="Median to complete"
                value={taskReport.medianCompletionDays == null ? '—' : `${taskReport.medianCompletionDays}d`}
                hint="start to completion"
              />
              <HeroFigure
                label="Finished on time"
                value={taskReport.onTimeCompletionRate == null ? '—' : `${taskReport.onTimeCompletionRate}%`}
                hint="of those with a due date"
              />
            </div>

            <CompositionBar
              rows={taskReport.byStatus}
              title="Status composition"
              subtitle="Where every task in the register currently sits."
              valueName="Tasks"
            />

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <OrdinalBarChart
                rows={taskReport.byPriority}
                title="By priority"
                subtitle="An ordered scale, so it is shaded low to high."
                valueName="Tasks"
              />
              <CategoryBarChart
                rows={taskReport.byAssignee}
                title="By assignee"
                subtitle="A task on a team with no named person is counted under the team."
                valueName="Tasks"
              />
              <CategoryBarChart rows={taskReport.byDepartment} title="By department" valueName="Tasks" />
              <CategoryBarChart rows={taskReport.byTeam} title="By team" valueName="Tasks" emptyLabel="No tasks are assigned to a team." />
            </div>

            <MonthlyTrendChart
              rows={taskReport.byMonth}
              title="Tasks started by month"
              subtitle="By start date, so a task with no start date is not counted."
              valueName="Tasks"
            />

            <p className="text-[11px] text-muted-foreground">
              {taskReport.fromMeetings} of {taskReport.total} tasks came out of a meeting.{' '}
              <Link href={`${OFFICE_HUB_BASE_PATH}/action-items?`} className="text-indigo-600 hover:underline">
                Action items with no task
              </Link>{' '}
              shows the gap the other way round.
            </p>
          </TabsContent>

          {/* ── action items ─────────────────────────────────────────────────────────────────── */}
          <TabsContent value="actions" className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <HeroFigure label="Action items" value={actionReport.total} />
              <HeroFigure label="Open" value={actionReport.open + actionReport.inProgress} tone="amber" />
              <HeroFigure label="Completed" value={actionReport.completed} tone="emerald" />
              <HeroFigure label="Overdue" value={actionReport.overdue} tone={actionReport.overdue ? 'rose' : 'slate'} />
              <HeroFigure
                label="Untracked"
                value={actionReport.withoutTask}
                hint="open, with no task"
                tone={actionReport.withoutTask ? 'amber' : 'emerald'}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <OrdinalBarChart
                rows={actionReport.ageing}
                title="Open items by age"
                subtitle="From the meeting that raised them. Older is darker."
                offScaleLabels={['No date']}
                valueName="Items"
              />
              <CategoryBarChart rows={actionReport.byResponsible} title="By responsible person" valueName="Items" />
              <CategoryBarChart
                rows={actionReport.byMeeting}
                title="By meeting"
                subtitle="Which meetings generate the most follow-up."
                valueName="Items"
              />
            </div>

            {actionReport.withoutTask > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {actionReport.withoutTask} open action{actionReport.withoutTask === 1 ? '' : 's'}{' '}
                {actionReport.withoutTask === 1 ? 'has' : 'have'} no task, so nothing is reminding
                anybody about {actionReport.withoutTask === 1 ? 'it' : 'them'}.{' '}
                <Link href={`${OFFICE_HUB_BASE_PATH}/action-items`} className="font-medium underline">
                  Open the untracked list
                </Link>
                .
              </p>
            )}
          </TabsContent>

          {/* ── decisions ────────────────────────────────────────────────────────────────────── */}
          <TabsContent value="decisions" className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <HeroFigure label="Decisions" value={decisionReport.total} />
              <HeroFigure label="Open" value={decisionReport.open} tone="amber" />
              <HeroFigure label="In progress" value={decisionReport.inProgress} />
              <HeroFigure label="Completed" value={decisionReport.completed} tone="emerald" />
              <HeroFigure label="Overdue" value={decisionReport.overdue} tone={decisionReport.overdue ? 'rose' : 'slate'} />
            </div>

            <MonthlyTrendChart
              rows={decisionReport.byMonth}
              title="Decisions by month"
              valueName="Decisions"
            />

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <OrdinalBarChart
                rows={decisionReport.ageing}
                title="Open decisions by age"
                subtitle="Since the decision was taken. Older is darker."
                offScaleLabels={['No date']}
                valueName="Decisions"
              />
              <OrdinalBarChart rows={decisionReport.byPriority} title="By priority" valueName="Decisions" />
              <CategoryBarChart rows={decisionReport.byOwner} title="By owner" valueName="Decisions" />
              <CategoryBarChart rows={decisionReport.byDepartment} title="By department" valueName="Decisions" />
            </div>
          </TabsContent>
        </Tabs>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <BarChart3 className="mt-0.5 h-3 w-3 shrink-0" />
        Every chart has a &ldquo;view as a table&rdquo; toggle beneath it. Counts only — Office Hub
        does not score or rank people.
      </p>
    </div>
  );
}
