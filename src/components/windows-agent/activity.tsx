'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  HrAccessDenied,
  HrBarList,
  HrDataList,
  HrEmptyState,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
  type HrListColumn,
} from '@/components/hr/hr-ui';
import { cn } from '@/lib/utils';
import {
  WINDOWS_AGENT_ROUTES,
  buildApplicationBreakdown,
  buildTimeline,
  formatSeconds,
  todayWorkDate,
  type ActivityClassification,
  type AppCategory,
  type TimelineEntry,
  type WindowsActivityEvent,
} from '@/lib/windows-agent';
import { canViewActivityOf, canViewOwnActivity } from '@/lib/windows-agent-permissions';
import { fetchDailyActivity, fetchDayActivity, fetchSessions } from '@/lib/windows-agent-service';
import { useWindowsAgent, useWindowsAgentQuery } from './hooks';
import {
  ActivityBar,
  CategoryBadge,
  ClockTime,
  Duration,
  MeasurementNotice,
  PersonCell,
  SessionStatusBadge,
} from './ui';

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * One person's day (§18) — also §37's self-view, which is the same screen pointed at yourself
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function EmployeeActivity({ userId, selfView = false }: { userId: string; selfView?: boolean }) {
  const { viewer, directoryById, loading } = useWindowsAgent();
  const [workDate, setWorkDate] = useState(() => todayWorkDate());

  const person = directoryById.get(userId);
  const allowed = selfView
    ? userId === viewer.userId && canViewOwnActivity(viewer)
    : canViewActivityOf(viewer, { userId, departmentId: person?.departmentId ?? null });

  const day = useWindowsAgentQuery(
    'Loading the day',
    async () => {
      const [days, sessions, events] = await Promise.all([
        fetchDailyActivity({ scope: { kind: 'SELF', userId }, fromDate: workDate, toDate: workDate, userId }),
        fetchSessions({ scope: { kind: 'SELF', userId }, fromDate: workDate, toDate: workDate, userId }),
        fetchDayActivity(userId, workDate),
      ]);
      return { rollup: days[0] ?? null, sessions, events };
    },
    [userId, workDate],
    { enabled: allowed && !loading },
  );

  const summary = useMemo(() => {
    const rollup = day.data?.rollup;
    const events = day.data?.events ?? [];

    const usage = new Map<string, { name: string; category: AppCategory; seconds: number; active: number }>();
    for (const event of events) {
      if (event.eventType !== 'APP_ACTIVE' || !event.processName) continue;
      const current = usage.get(event.processName) ?? {
        name: event.applicationName || event.processName,
        category: event.category,
        seconds: 0,
        active: 0,
      };
      current.seconds += event.durationSeconds;
      current.active += event.activeSeconds;
      usage.set(event.processName, current);
    }

    const breakdown = buildApplicationBreakdown(
      [...usage.entries()].map(([processKey, entry]) => ({
        processKey,
        applicationName: entry.name,
        category: entry.category,
        totalSeconds: entry.seconds,
        activeSeconds: entry.active,
      })),
      { topN: 8 },
    );

    return {
      rollup,
      breakdown,
      timeline: buildTimeline(events),
      hasData: events.length > 0 || Boolean(rollup),
    };
  }, [day.data]);

  if (loading) return <HrLoader label="Loading activity" />;
  if (!allowed) {
    return (
      <HrAccessDenied
        what={selfView ? 'your own activity (self-service is switched off for this installation)' : 'this person’s activity'}
      />
    );
  }

  const name = selfView ? 'Your day' : person?.name ?? 'Employee';
  const rollup = summary.rollup;

  return (
    <div className="space-y-5">
      <HrPageHeader
        title={name}
        description={
          selfView
            ? 'Everything the SEL LIVE agent recorded about your computer use.'
            : `${person?.departmentName ?? 'No department'} · recorded by the SEL LIVE agent`
        }
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="wa-day" className="sr-only">
              Date
            </Label>
            <Input
              id="wa-day"
              type="date"
              value={workDate}
              max={todayWorkDate()}
              onChange={(event) => setWorkDate(event.target.value)}
              className="w-auto"
            />
          </div>
        }
      />

      {day.loading ? (
        <HrLoader />
      ) : !summary.hasData ? (
        <HrEmptyState
          icon={CalendarDays}
          title="Nothing recorded for this day"
          description={
            workDate === todayWorkDate()
              ? 'No session has been opened yet today. If the agent should be running, check the Devices page.'
              : 'A non-working day, leave, or a day worked away from a company computer.'
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HrKpiCard
              label="First sign-in"
              value={rollup?.firstLoginAt ? <ClockTime value={rollup.firstLoginAt} /> : '—'}
              tone={rollup?.lateLogin ? 'amber' : 'slate'}
              hint={rollup?.lateLogin ? `${rollup.lateByMinutes} min after the expected start` : undefined}
            />
            <HrKpiCard
              label="Last sign-out"
              value={rollup?.lastLogoutAt ? <ClockTime value={rollup.lastLogoutAt} /> : 'Still signed in'}
              tone="slate"
              hint={rollup?.hasUncleanSession ? 'estimated — a session ended without a sign-out' : undefined}
            />
            <HrKpiCard
              label="Active"
              value={formatSeconds(rollup?.activeSeconds ?? 0)}
              tone="emerald"
              hint="time with keyboard or mouse input"
            />
            <HrKpiCard
              label="Logged in"
              value={formatSeconds(rollup?.sessionSeconds ?? 0)}
              tone="blue"
              hint={`${formatSeconds((rollup?.idleSeconds ?? 0) + (rollup?.extendedIdleSeconds ?? 0))} idle · ${formatSeconds(rollup?.lockedSeconds ?? 0)} locked`}
            />
          </div>

          {rollup ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">How the day divided</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <ActivityBar
                  activeSeconds={rollup.activeSeconds}
                  idleSeconds={rollup.idleSeconds}
                  extendedIdleSeconds={rollup.extendedIdleSeconds}
                  lockedSeconds={rollup.lockedSeconds}
                  className="h-3"
                />
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <Legend colour="bg-emerald-500" label="Active" seconds={rollup.activeSeconds} />
                  <Legend colour="bg-amber-400" label="Idle" seconds={rollup.idleSeconds} />
                  <Legend colour="bg-orange-400" label="Extended idle" seconds={rollup.extendedIdleSeconds} />
                  <Legend colour="bg-slate-300" label="Locked" seconds={rollup.lockedSeconds} />
                  {rollup.offlineSeconds > 0 ? (
                    <span className="text-violet-600">
                      {formatSeconds(rollup.offlineSeconds)} recorded while offline
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Applications</CardTitle>
                <CardDescription>
                  Foreground time only. An application open behind another window is not counted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <HrBarList
                  rows={summary.breakdown.rows.map((row) => ({
                    label: row.applicationName,
                    value: row.activeSeconds,
                    hint: `${row.percentOfActive}% of active time`,
                  }))}
                  valueLabel={(value) => formatSeconds(value)}
                  tone="indigo"
                  emptyLabel="No application time recorded."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sessions</CardTitle>
                <CardDescription>Each sign-in on each computer.</CardDescription>
              </CardHeader>
              <CardContent>
                <HrDataList
                  rows={day.data?.sessions ?? []}
                  dense
                  columns={[
                    { header: 'Computer', mobile: 'title', cell: (row) => row.deviceName },
                    { header: 'In', mobile: 'detail', cell: (row) => <ClockTime value={row.loginAt} /> },
                    {
                      header: 'Out',
                      mobile: 'detail',
                      cell: (row) =>
                        row.logoutAt ? (
                          <span className="flex items-center gap-1">
                            <ClockTime value={row.logoutAt} />
                            {row.logoutEstimated ? (
                              <Info className="h-3 w-3 text-amber-500" aria-label="Estimated" />
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">open</span>
                        ),
                    },
                    {
                      header: 'Active',
                      align: 'right',
                      mobile: 'detail',
                      cell: (row) => <Duration seconds={row.activeSeconds} />,
                    },
                    { header: '', align: 'right', mobile: 'aside', cell: (row) => <SessionStatusBadge status={row.status} /> },
                  ]}
                  empty={<p className="py-6 text-center text-sm text-muted-foreground">No sessions.</p>}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>
                Consecutive stretches in the same application are merged. Gaps are time the agent
                recorded nothing — the computer was off, or the agent was not running.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DayTimeline entries={summary.timeline} />
            </CardContent>
          </Card>
        </>
      )}

      <MeasurementNotice />
    </div>
  );
}

function Legend({ colour, label, seconds }: { colour: string; label: string; seconds: number }) {
  if (seconds <= 0) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('h-2 w-2 rounded-full', colour)} aria-hidden />
      {label} {formatSeconds(seconds)}
    </span>
  );
}

/**
 * §10's timeline.
 *
 * A proportional strip across the working day plus the list beneath it, because the two answer
 * different questions: the strip shows the *shape* of a day at a glance, and the list is what
 * somebody reads when they are checking a specific hour. Drawing only the strip would make a
 * five-minute entry unclickable; drawing only the list buries the shape in forty rows.
 *
 * The bounds come from the data rather than from a fixed 09:00–19:00 window, so a night shift or
 * an early start is not drawn off the end of the chart.
 */
function DayTimeline({ entries }: { entries: TimelineEntry[] }) {
  const bounds = useMemo(() => {
    if (!entries.length) return null;
    const start = new Date(entries[0].startedAt).getTime();
    const end = Math.max(...entries.map((entry) => new Date(entry.endedAt).getTime()));
    return { start, end, span: Math.max(1, end - start) };
  }, [entries]);

  if (!entries.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded.</p>;
  }

  const colourFor = (classification: ActivityClassification): string => {
    switch (classification) {
      case 'ACTIVE':
        return 'bg-emerald-500';
      case 'IDLE':
        return 'bg-amber-400';
      case 'EXTENDED_IDLE':
        return 'bg-orange-400';
      case 'LOCKED':
        return 'bg-slate-300';
      default:
        return 'bg-violet-400';
    }
  };

  return (
    <div className="space-y-4">
      {bounds ? (
        <div>
          <div className="flex h-6 w-full overflow-hidden rounded-md bg-muted">
            {entries.map((entry, index) => {
              const width =
                ((new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / bounds.span) * 100;
              if (width <= 0) return null;
              return (
                <div
                  key={`${entry.startedAt}-${index}`}
                  className={colourFor(entry.classification)}
                  style={{ width: `${width}%` }}
                  title={`${entry.label} — ${formatSeconds(entry.durationSeconds)}`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <ClockTime value={new Date(bounds.start)} />
            <ClockTime value={new Date(bounds.end)} />
          </div>
        </div>
      ) : null}

      <div className="max-h-96 space-y-px overflow-y-auto rounded-md border">
        {entries.map((entry, index) => (
          <div
            key={`${entry.startedAt}-${index}-row`}
            className="flex items-center gap-3 border-b px-3 py-1.5 text-sm last:border-b-0"
          >
            <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
              <ClockTime value={entry.startedAt} />
            </span>
            <span className={cn('h-2 w-2 shrink-0 rounded-full', colourFor(entry.classification))} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            <CategoryBadge category={entry.category} className="hidden sm:inline-flex" />
            <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
              {formatSeconds(entry.durationSeconds)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Directory of people with activity (§33's "Employee Activity")
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function EmployeeActivityDirectory() {
  const { viewer, scope, directoryById, loading } = useWindowsAgent();
  const [workDate, setWorkDate] = useState(() => todayWorkDate());
  const [search, setSearch] = useState('');

  const allowed = scope.kind !== 'NONE';

  const days = useWindowsAgentQuery(
    'Loading activity',
    () => fetchDailyActivity({ scope, fromDate: workDate, toDate: workDate, max: 1000 }),
    [scope.kind, workDate],
    { enabled: allowed && !loading },
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (days.data ?? [])
      .map((row) => ({
        ...row,
        displayName: row.userName || directoryById.get(row.userId)?.name || row.userId,
        department: row.departmentName ?? directoryById.get(row.userId)?.departmentName ?? null,
      }))
      .filter((row) =>
        !needle
          ? true
          : row.displayName.toLowerCase().includes(needle) ||
            (row.department ?? '').toLowerCase().includes(needle),
      )
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [days.data, directoryById, search]);

  if (loading) return <HrLoader label="Loading activity" />;
  if (!allowed) return <HrAccessDenied what="other people’s activity" />;

  type Row = (typeof rows)[number];

  const columns: HrListColumn<Row>[] = [
    {
      header: 'Employee',
      mobile: 'title',
      cell: (row) => (
        <PersonCell
          userId={row.userId}
          name={row.displayName}
          department={row.department}
          href={WINDOWS_AGENT_ROUTES.user(row.userId)}
        />
      ),
    },
    { header: 'First in', mobile: 'detail', cell: (row) => <ClockTime value={row.firstLoginAt} /> },
    { header: 'Last out', mobile: 'detail', cell: (row) => <ClockTime value={row.lastLogoutAt} /> },
    {
      header: 'Logged in',
      align: 'right',
      mobile: 'detail',
      cell: (row) => <Duration seconds={row.sessionSeconds} />,
    },
    {
      header: 'Active',
      align: 'right',
      mobile: 'detail',
      cell: (row) => <Duration seconds={row.activeSeconds} />,
    },
    {
      header: 'Split',
      className: 'hidden lg:table-cell w-40',
      mobile: 'footer',
      cell: (row) => (
        <ActivityBar
          activeSeconds={row.activeSeconds}
          idleSeconds={row.idleSeconds}
          extendedIdleSeconds={row.extendedIdleSeconds}
          lockedSeconds={row.lockedSeconds}
        />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Employee activity"
        description="One row per person per day. Open a row for the hour-by-hour timeline."
        actions={
          <Input
            type="date"
            value={workDate}
            max={todayWorkDate()}
            onChange={(event) => setWorkDate(event.target.value)}
            className="w-auto"
          />
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{rows.length} {rows.length === 1 ? 'person' : 'people'}</CardTitle>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by name or department"
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent>
          {days.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={rows}
              columns={columns}
              dense
              cardHref={(row) => WINDOWS_AGENT_ROUTES.user(row.userId)}
              empty={
                <HrEmptyState
                  title="Nothing recorded for this day"
                  description="Choose another date, or check that agents are reporting on the Devices page."
                />
              }
            />
          )}
        </CardContent>
      </Card>

      <MeasurementNotice />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Session register
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function SessionsRegister() {
  const { scope, loading } = useWindowsAgent();
  const [fromDate, setFromDate] = useState(() => todayWorkDate());
  const [toDate, setToDate] = useState(() => todayWorkDate());

  const allowed = scope.kind !== 'NONE';
  const sessions = useWindowsAgentQuery(
    'Loading sessions',
    () => fetchSessions({ scope, fromDate, toDate, max: 500 }),
    [scope.kind, fromDate, toDate],
    { enabled: allowed && !loading },
  );

  if (loading) return <HrLoader label="Loading sessions" />;
  if (!allowed) return <HrAccessDenied what="the session register" />;

  const rows = (sessions.data ?? []).slice().sort((left, right) => right.loginAt.localeCompare(left.loginAt));

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Sessions"
        description="Every sign-in and sign-out the agents recorded."
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="w-auto" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" value={toDate} min={fromDate} max={todayWorkDate()} onChange={(event) => setToDate(event.target.value)} className="w-auto" />
          </div>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {sessions.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={rows}
              dense
              columns={[
                {
                  header: 'Employee',
                  mobile: 'title',
                  cell: (row) => (
                    <PersonCell
                      userId={row.userId}
                      name={row.userName}
                      department={row.departmentName}
                      href={WINDOWS_AGENT_ROUTES.user(row.userId)}
                    />
                  ),
                },
                { header: 'Date', mobile: 'detail', cell: (row) => row.workDate },
                { header: 'Computer', mobile: 'detail', cell: (row) => row.deviceName },
                { header: 'In', mobile: 'detail', cell: (row) => <ClockTime value={row.loginAt} /> },
                {
                  header: 'Out',
                  mobile: 'detail',
                  cell: (row) =>
                    row.logoutAt ? <ClockTime value={row.logoutAt} /> : <span className="text-muted-foreground">open</span>,
                },
                { header: 'Active', align: 'right', mobile: 'detail', cell: (row) => <Duration seconds={row.activeSeconds} /> },
                { header: 'Status', align: 'right', mobile: 'aside', cell: (row) => <SessionStatusBadge status={row.status} /> },
              ]}
              empty={<HrEmptyState title="No sessions in this range" />}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
