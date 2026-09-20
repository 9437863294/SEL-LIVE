'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, CalendarClock, Download, MonitorSmartphone, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { hasPermission } from '@/lib/access-control';
import {
  WINDOWS_AGENT_RESOURCES,
  WINDOWS_AGENT_ROUTES,
  attendanceStatusOf,
  buildApplicationBreakdown,
  formatSeconds,
  summariseByCategory,
  todayWorkDate,
  type AppCategory,
  type WindowsDailyActivity,
} from '@/lib/windows-agent';
import { canExportReports, canViewAttendance } from '@/lib/windows-agent-permissions';
import { fetchAppCatalog, fetchDailyActivity } from '@/lib/windows-agent-service';
import { useWindowsAgent, useWindowsAgentQuery } from './hooks';
import {
  ActivityBar,
  AttendanceStatusBadge,
  CategoryBadge,
  ClockTime,
  Duration,
  MeasurementNotice,
  PersonCell,
  categoryLabel,
} from './ui';

/**
 * §19–§21's reports, all built on `windowsDailyActivity`.
 *
 * ── One shared date range, and why it defaults to a week ───────────────────────────────────────
 *
 * Every report here takes a from/to range and defaults to the last seven days. A month would be
 * the obvious default for a report; seven days is chosen because the rollup is one document per
 * person per day, so a month across three hundred people is nine thousand reads on page load —
 * fine occasionally, wasteful as the thing that happens every time somebody clicks "Reports".
 *
 * ── Export is CSV, and it includes the filters ─────────────────────────────────────────────────
 *
 * §49 asks for the date range, who generated it and when to appear in an export. They are written
 * as comment lines above the header row, which Excel imports as text and a human reads without
 * being told to. A spreadsheet of hours with no record of what it covers is the kind of artefact
 * that gets emailed around and then argued about six weeks later.
 */

const DEFAULT_RANGE_DAYS = 7;

function defaultRange(): { from: string; to: string } {
  const to = todayWorkDate();
  const from = new Date(Date.now() - DEFAULT_RANGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

function useDateRange() {
  const initial = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  return { from, to, setFrom, setTo };
}

function RangePicker({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="w-auto" />
      <span className="text-sm text-muted-foreground">to</span>
      <Input
        type="date"
        value={to}
        min={from}
        max={todayWorkDate()}
        onChange={(event) => setTo(event.target.value)}
        className="w-auto"
      />
    </div>
  );
}

/**
 * Download rows as CSV, with a provenance preamble (§49).
 *
 * Values are quoted and internal quotes doubled — the RFC 4180 rule. Not a nicety: a department
 * called "Projects, Civil" would otherwise silently split into two columns and shift every
 * subsequent field in that row by one.
 */
function downloadCsv(
  filename: string,
  header: string[],
  rows: (string | number)[][],
  provenance: Record<string, string>,
): void {
  const escape = (value: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ...Object.entries(provenance).map(([key, value]) => `# ${key}: ${value}`),
    header.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ];

  // A BOM, because Excel on Windows reads a CSV without one as the local ANSI codepage and turns
  // every non-ASCII name into mojibake — which in this company's directory is a lot of names.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Reports hub (§33)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function ReportsHub() {
  const { viewer } = useWindowsAgent();
  if (!hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.reports, 'View')) {
    return <HrAccessDenied what="Windows Agent reports" />;
  }

  const cards = [
    {
      href: WINDOWS_AGENT_ROUTES.attendanceReport,
      icon: CalendarClock,
      title: 'Attendance',
      description: 'First login, last logout and hours, day by day, with a status per row.',
    },
    {
      href: WINDOWS_AGENT_ROUTES.applicationReport,
      icon: MonitorSmartphone,
      title: 'Application usage',
      description: 'Where the time went, by program and by category.',
    },
    {
      href: WINDOWS_AGENT_ROUTES.departmentReport,
      icon: Users,
      title: 'Departments',
      description: 'Hours and headcount per department. Measurements, not a league table.',
    },
  ];

  return (
    <div className="space-y-5">
      <HrPageHeader title="Reports" description="Everything the agents recorded, aggregated." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="block">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <card.icon className="h-4 w-4 text-primary" aria-hidden />
                  {card.title}
                </CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      <MeasurementNotice />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Attendance (§21)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function AttendanceReport() {
  const { viewer, scope, settings, directoryById, loading } = useWindowsAgent();
  const range = useDateRange();
  const [search, setSearch] = useState('');

  const allowed = canViewAttendance(viewer);
  const days = useWindowsAgentQuery(
    'Loading attendance',
    () => fetchDailyActivity({ scope, fromDate: range.from, toDate: range.to, max: 2000 }),
    [scope.kind, range.from, range.to],
    { enabled: allowed && !loading },
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (days.data ?? [])
      .map((row) => ({
        ...row,
        displayName: row.userName || directoryById.get(row.userId)?.name || row.userId,
        department: row.departmentName ?? directoryById.get(row.userId)?.departmentName ?? null,
        attendanceStatus: attendanceStatusOf(
          {
            sessionSeconds: row.sessionSeconds,
            offlineSeconds: row.offlineSeconds,
            lateLogin: row.lateLogin,
            hasUncleanSession: row.hasUncleanSession,
          },
          { minimumFullDaySeconds: settings.minimumFullDaySeconds },
        ),
      }))
      .filter((row) =>
        !needle
          ? true
          : row.displayName.toLowerCase().includes(needle) || (row.department ?? '').toLowerCase().includes(needle),
      )
      .sort((left, right) =>
        right.workDate.localeCompare(left.workDate) || left.displayName.localeCompare(right.displayName),
      );
  }, [days.data, directoryById, search, settings.minimumFullDaySeconds]);

  if (loading) return <HrLoader label="Loading attendance" />;
  if (!allowed) return <HrAccessDenied what="the attendance report" />;

  type Row = (typeof rows)[number];

  const columns: HrListColumn<Row>[] = [
    { header: 'Date', mobile: 'aside', cell: (row) => row.workDate },
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
    { header: 'First login', mobile: 'detail', cell: (row) => <ClockTime value={row.firstLoginAt} /> },
    {
      header: 'Last logout',
      mobile: 'detail',
      cell: (row) => (
        <span className="flex items-center gap-1">
          <ClockTime value={row.lastLogoutAt} />
          {row.hasUncleanSession ? (
            <span className="text-[10px] text-amber-600" title="Estimated from the last heartbeat">
              est.
            </span>
          ) : null}
        </span>
      ),
    },
    { header: 'Logged', align: 'right', mobile: 'detail', cell: (row) => <Duration seconds={row.sessionSeconds} /> },
    { header: 'Active', align: 'right', mobile: 'detail', cell: (row) => <Duration seconds={row.activeSeconds} /> },
    {
      header: 'Idle',
      align: 'right',
      className: 'hidden lg:table-cell',
      mobile: 'detail',
      cell: (row) => <Duration seconds={row.idleSeconds + row.extendedIdleSeconds} muted />,
    },
    {
      header: 'Locked',
      align: 'right',
      className: 'hidden lg:table-cell',
      mobile: 'detail',
      cell: (row) => <Duration seconds={row.lockedSeconds} muted />,
    },
    {
      header: 'Devices',
      className: 'hidden xl:table-cell',
      mobile: 'omit',
      cell: (row) => row.deviceIds?.length ?? 0,
    },
    { header: 'Status', align: 'right', mobile: 'footer', cell: (row) => <AttendanceStatusBadge status={row.attendanceStatus} /> },
  ];

  const exportCsv = () =>
    downloadCsv(
      `sel-live-attendance-${range.from}-to-${range.to}.csv`,
      ['Date', 'Employee', 'Department', 'First login', 'Last logout', 'Logged (s)', 'Active (s)', 'Idle (s)', 'Locked (s)', 'Offline (s)', 'Devices', 'Status'],
      rows.map((row) => [
        row.workDate,
        row.displayName,
        row.department ?? '',
        row.firstLoginAt ?? '',
        row.lastLogoutAt ?? '',
        row.sessionSeconds,
        row.activeSeconds,
        row.idleSeconds + row.extendedIdleSeconds,
        row.lockedSeconds,
        row.offlineSeconds,
        row.deviceIds?.length ?? 0,
        row.attendanceStatus,
      ]),
      {
        Report: 'Windows Agent attendance',
        Range: `${range.from} to ${range.to}`,
        'Generated by': viewer.userName,
        'Generated at': new Date().toISOString(),
        Filter: search || '(none)',
        Note: 'Durations are in seconds. "est." logouts are estimated from the last heartbeat, not observed.',
      },
    );

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Attendance"
        description="Built from what the agents recorded. Not a substitute for the HR attendance system."
        actions={
          <>
            <RangePicker {...range} />
            {canExportReports(viewer) ? (
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
                <Download className="mr-2 h-4 w-4" aria-hidden />
                Export
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{rows.length} {rows.length === 1 ? 'row' : 'rows'}</CardTitle>
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
              maxHeightClassName="sm:max-h-[40rem]"
              empty={<HrEmptyState title="Nothing recorded in this range" />}
            />
          )}
        </CardContent>
      </Card>

      <MeasurementNotice />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Application usage (§20)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function ApplicationsReport() {
  const { viewer, scope, loading } = useWindowsAgent();
  const range = useDateRange();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const allowed = hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.applications, 'View');

  const data = useWindowsAgentQuery(
    'Loading application usage',
    async () => {
      const [days, catalog] = await Promise.all([
        fetchDailyActivity({ scope, fromDate: range.from, toDate: range.to, max: 2000 }),
        fetchAppCatalog().catch(() => []),
      ]);
      return { days, catalog };
    },
    [scope.kind, range.from, range.to],
    { enabled: allowed && !loading },
  );

  const summary = useMemo(() => {
    const days = data.data?.days ?? [];
    const catalog = new Map((data.data?.catalog ?? []).map((entry) => [entry.id, entry]));

    const perApp = new Map<string, { seconds: number; users: Set<string> }>();
    for (const day of days) {
      for (const [processKey, seconds] of Object.entries(day.applicationSummary ?? {})) {
        const current = perApp.get(processKey) ?? { seconds: 0, users: new Set<string>() };
        current.seconds += Number(seconds || 0);
        current.users.add(day.userId);
        perApp.set(processKey, current);
      }
    }

    const rows = [...perApp.entries()]
      .map(([processKey, entry]) => {
        const catalogued = catalog.get(processKey);
        return {
          id: processKey,
          processKey,
          applicationName: catalogued?.displayName ?? processKey,
          category: (catalogued?.category ?? 'UNCLASSIFIED') as AppCategory,
          totalSeconds: entry.seconds,
          activeSeconds: entry.seconds,
          users: entry.users.size,
        };
      })
      .filter((row) => categoryFilter === 'all' || row.category === categoryFilter)
      .sort((left, right) => right.totalSeconds - left.totalSeconds);

    const total = rows.reduce((sum, row) => sum + row.totalSeconds, 0);
    const byCategory = summariseByCategory(
      rows.map((row) => ({ category: row.category, activeSeconds: row.activeSeconds })),
    );

    return {
      rows: rows.map((row) => ({
        ...row,
        percent: total > 0 ? Math.round((row.totalSeconds / total) * 1000) / 10 : 0,
        averagePerUser: row.users ? Math.round(row.totalSeconds / row.users) : 0,
      })),
      total,
      byCategory: Object.entries(byCategory).sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0)),
      breakdown: buildApplicationBreakdown(rows, { topN: 10 }),
    };
  }, [data.data, categoryFilter]);

  if (loading) return <HrLoader label="Loading application usage" />;
  if (!allowed) return <HrAccessDenied what="the application usage report" />;

  type Row = (typeof summary.rows)[number];

  const exportCsv = () =>
    downloadCsv(
      `sel-live-applications-${range.from}-to-${range.to}.csv`,
      ['Application', 'Process', 'Category', 'Users', 'Total (s)', 'Average per user (s)', '% of tracked time'],
      summary.rows.map((row) => [
        row.applicationName,
        row.processKey,
        categoryLabel(row.category),
        row.users,
        row.totalSeconds,
        row.averagePerUser,
        row.percent,
      ]),
      {
        Report: 'Windows Agent application usage',
        Range: `${range.from} to ${range.to}`,
        'Generated by': viewer.userName,
        'Generated at': new Date().toISOString(),
        Category: categoryFilter === 'all' ? 'All' : categoryFilter,
      },
    );

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Application usage"
        description="Foreground time by program. An application open behind another window is not counted."
        actions={
          <>
            <RangePicker {...range} />
            {canExportReports(viewer) ? (
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!summary.rows.length}>
                <Download className="mr-2 h-4 w-4" aria-hidden />
                Export
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Applications</CardTitle>
              <CardDescription>{formatSeconds(summary.total)} of tracked foreground time.</CardDescription>
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {(['ERP', 'OFFICE', 'COMMUNICATION', 'DEVELOPMENT', 'REFERENCE', 'WORK', 'SYSTEM', 'UNCLASSIFIED'] as AppCategory[]).map(
                  (category) => (
                    <SelectItem key={category} value={category}>
                      {categoryLabel(category)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {data.loading ? (
              <HrLoader />
            ) : (
              <HrDataList<Row>
                rows={summary.rows}
                dense
                maxHeightClassName="sm:max-h-[32rem]"
                columns={[
                  {
                    header: 'Application',
                    mobile: 'title',
                    cell: (row) => (
                      <span>
                        <span className="block font-medium">{row.applicationName}</span>
                        <span className="block font-mono text-[11px] text-muted-foreground">{row.processKey}</span>
                      </span>
                    ),
                  },
                  { header: 'Category', mobile: 'aside', cell: (row) => <CategoryBadge category={row.category} /> },
                  { header: 'Users', align: 'right', mobile: 'detail', cell: (row) => row.users },
                  { header: 'Total', align: 'right', mobile: 'detail', cell: (row) => <Duration seconds={row.totalSeconds} /> },
                  {
                    header: 'Average',
                    align: 'right',
                    className: 'hidden lg:table-cell',
                    mobile: 'detail',
                    cell: (row) => <Duration seconds={row.averagePerUser} />,
                  },
                  {
                    header: '% of time',
                    align: 'right',
                    mobile: 'footer',
                    cell: (row) => <span className="tabular-nums">{row.percent}%</span>,
                  },
                ]}
                empty={<HrEmptyState title="No application time in this range" />}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By category</CardTitle>
            <CardDescription>
              Categories are configurable on the Applications page. They describe software, not
              people.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HrBarList
              rows={summary.byCategory.map(([category, seconds]) => ({
                label: categoryLabel(category as AppCategory),
                value: seconds ?? 0,
              }))}
              valueLabel={(value) => formatSeconds(value)}
              tone="emerald"
              emptyLabel="Nothing recorded."
            />
          </CardContent>
        </Card>
      </div>

      <MeasurementNotice />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Departments (§19)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function DepartmentReport() {
  const { viewer, scope, directoryById, loading } = useWindowsAgent();
  const range = useDateRange();

  const allowed = hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.reports, 'View');
  const days = useWindowsAgentQuery(
    'Loading department activity',
    () => fetchDailyActivity({ scope, fromDate: range.from, toDate: range.to, max: 3000 }),
    [scope.kind, range.from, range.to],
    { enabled: allowed && !loading },
  );

  const rows = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        name: string;
        people: Set<string>;
        devices: Set<string>;
        days: number;
        session: number;
        active: number;
        idle: number;
        locked: number;
        late: number;
        firstLoginMinutes: number[];
      }
    >();

    for (const day of (days.data ?? []) as WindowsDailyActivity[]) {
      const departmentId = day.departmentId ?? directoryById.get(day.userId)?.departmentId ?? '__none__';
      const name =
        day.departmentName ?? directoryById.get(day.userId)?.departmentName ?? 'No department';

      const group = groups.get(departmentId) ?? {
        id: departmentId,
        name,
        people: new Set<string>(),
        devices: new Set<string>(),
        days: 0,
        session: 0,
        active: 0,
        idle: 0,
        locked: 0,
        late: 0,
        firstLoginMinutes: [],
      };

      group.people.add(day.userId);
      (day.deviceIds ?? []).forEach((deviceId) => group.devices.add(deviceId));
      group.days += 1;
      group.session += day.sessionSeconds || 0;
      group.active += day.activeSeconds || 0;
      group.idle += (day.idleSeconds || 0) + (day.extendedIdleSeconds || 0);
      group.locked += day.lockedSeconds || 0;
      if (day.lateLogin) group.late += 1;

      if (day.firstLoginAt) {
        const parsed = new Date(day.firstLoginAt);
        if (!Number.isNaN(parsed.getTime())) {
          // Read in the office timezone so a report is comparable across sites.
          const parts = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Kolkata',
          }).formatToParts(parsed);
          const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
          const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
          group.firstLoginMinutes.push(hour * 60 + minute);
        }
      }

      groups.set(departmentId, group);
    }

    return [...groups.values()]
      .map((group) => {
        const averageLoginMinutes = group.firstLoginMinutes.length
          ? Math.round(group.firstLoginMinutes.reduce((sum, value) => sum + value, 0) / group.firstLoginMinutes.length)
          : null;
        return {
          id: group.id,
          name: group.name,
          people: group.people.size,
          devices: group.devices.size,
          days: group.days,
          session: group.session,
          active: group.active,
          idle: group.idle,
          locked: group.locked,
          late: group.late,
          averageLogin:
            averageLoginMinutes === null
              ? '—'
              : `${String(Math.floor(averageLoginMinutes / 60)).padStart(2, '0')}:${String(averageLoginMinutes % 60).padStart(2, '0')}`,
          // Per person-day, so a department of forty is comparable with one of four. Sorting is
          // alphabetical regardless — see the note below on why there is no ranking here.
          activePerDay: group.days ? Math.round(group.active / group.days) : 0,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [days.data, directoryById]);

  if (loading) return <HrLoader label="Loading department activity" />;
  if (!allowed) return <HrAccessDenied what="the department report" />;

  type Row = (typeof rows)[number];

  const totals = rows.reduce(
    (acc, row) => ({
      people: acc.people + row.people,
      active: acc.active + row.active,
      session: acc.session + row.session,
    }),
    { people: 0, active: 0, session: 0 },
  );

  const exportCsv = () =>
    downloadCsv(
      `sel-live-departments-${range.from}-to-${range.to}.csv`,
      ['Department', 'People', 'Person-days', 'Devices', 'Average first login', 'Logged (s)', 'Active (s)', 'Idle (s)', 'Locked (s)', 'Active per person-day (s)', 'Late starts'],
      rows.map((row) => [
        row.name,
        row.people,
        row.days,
        row.devices,
        row.averageLogin,
        row.session,
        row.active,
        row.idle,
        row.locked,
        row.activePerDay,
        row.late,
      ]),
      {
        Report: 'Windows Agent department activity',
        Range: `${range.from} to ${range.to}`,
        'Generated by': viewer.userName,
        'Generated at': new Date().toISOString(),
        Note: 'Rows are alphabetical. These are measurements of computer use, not a ranking of departments.',
      },
    );

  const columns: HrListColumn<Row>[] = [
    { header: 'Department', mobile: 'title', cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: 'People', align: 'right', mobile: 'detail', cell: (row) => row.people },
    { header: 'Person-days', align: 'right', className: 'hidden lg:table-cell', mobile: 'detail', cell: (row) => row.days },
    { header: 'Devices', align: 'right', className: 'hidden lg:table-cell', mobile: 'detail', cell: (row) => row.devices },
    { header: 'Avg. first login', align: 'right', mobile: 'detail', cell: (row) => <span className="tabular-nums">{row.averageLogin}</span> },
    { header: 'Logged', align: 'right', mobile: 'detail', cell: (row) => <Duration seconds={row.session} /> },
    { header: 'Active', align: 'right', mobile: 'detail', cell: (row) => <Duration seconds={row.active} /> },
    {
      header: 'Per person-day',
      align: 'right',
      className: 'hidden xl:table-cell',
      mobile: 'detail',
      cell: (row) => <Duration seconds={row.activePerDay} />,
    },
    {
      header: 'Split',
      className: 'hidden lg:table-cell w-32',
      mobile: 'footer',
      cell: (row) => (
        <ActivityBar
          activeSeconds={row.active}
          idleSeconds={row.idle}
          extendedIdleSeconds={0}
          lockedSeconds={row.locked}
        />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Departments"
        description="Computer use by department over the selected range."
        actions={
          <>
            <RangePicker {...range} />
            {canExportReports(viewer) ? (
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
                <Download className="mr-2 h-4 w-4" aria-hidden />
                Export
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HrKpiCard label="Departments" value={rows.length} icon={BarChart3} tone="blue" />
        <HrKpiCard label="People" value={totals.people} icon={Users} tone="indigo" />
        <HrKpiCard label="Active" value={formatSeconds(totals.active)} tone="emerald" />
        <HrKpiCard label="Logged in" value={formatSeconds(totals.session)} tone="slate" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By department</CardTitle>
          <CardDescription>
            Listed alphabetically, deliberately. Sorting departments by hours turns a measurement
            into a league table, and computer time is not a measure of a department’s output —
            site teams and estimators spend their days very differently.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {days.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={rows}
              columns={columns}
              dense
              empty={<HrEmptyState title="Nothing recorded in this range" />}
            />
          )}
        </CardContent>
      </Card>

      <MeasurementNotice />
    </div>
  );
}
