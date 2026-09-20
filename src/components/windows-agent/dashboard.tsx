'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, Clock, HardDrive, MonitorSmartphone, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  HrAccessDenied,
  HrBarList,
  HrEmptyState,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
} from '@/components/hr/hr-ui';
import { hasPermission } from '@/lib/access-control';
import {
  WINDOWS_AGENT_RESOURCES,
  WINDOWS_AGENT_ROUTES,
  buildApplicationBreakdown,
  formatSeconds,
  todayWorkDate,
  type AppCategory,
} from '@/lib/windows-agent';
import { fetchDailyActivity, fetchDevices } from '@/lib/windows-agent-service';
import { useWindowsAgent, useWindowsAgentQuery } from './hooks';
import { CategoryBadge, Duration, MeasurementNotice, categoryLabel } from './ui';

/**
 * §48's dashboard: today across the fleet, in one read.
 *
 * Built entirely from `windowsDailyActivity` and `windowsDevices` — two collections, both small,
 * neither of which needs the raw spans. §32 is explicit that a report must not recompute history
 * on every page load, and this is what that buys: a company-wide view of today costs one document
 * per person who has signed in, rather than one per foreground change.
 *
 * ── What is deliberately not here ──────────────────────────────────────────────────────────────
 *
 * No leaderboard, no "most productive department", no ranking of any kind. §19 asks for
 * measurements rather than performance judgements, and a dashboard is exactly where that rule
 * gets broken first — a sorted list of people by active hours is a ranking whether or not it is
 * labelled one. The application breakdown ranks *software*, which is a fact about the estate; the
 * people are counted, never ordered.
 */
export default function WindowsAgentDashboard() {
  const { viewer, scope, loading } = useWindowsAgent();
  const today = todayWorkDate();

  const allowed = hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.dashboard, 'View');
  const canSeeDevices = hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.devices, 'View');

  const days = useWindowsAgentQuery(
    'Loading today’s activity',
    () => fetchDailyActivity({ scope, fromDate: today, toDate: today, max: 1000 }),
    [scope.kind, today],
    { enabled: allowed && !loading },
  );

  const devices = useWindowsAgentQuery('Loading devices', fetchDevices, [], {
    enabled: allowed && canSeeDevices && !loading,
  });

  const summary = useMemo(() => {
    const rows = days.data ?? [];
    const totals = rows.reduce(
      (acc, row) => ({
        session: acc.session + (row.sessionSeconds || 0),
        active: acc.active + (row.activeSeconds || 0),
        idle: acc.idle + (row.idleSeconds || 0) + (row.extendedIdleSeconds || 0),
        locked: acc.locked + (row.lockedSeconds || 0),
      }),
      { session: 0, active: 0, idle: 0, locked: 0 },
    );

    const applications = new Map<string, number>();
    const categories = new Map<AppCategory, number>();
    for (const row of rows) {
      for (const [processKey, seconds] of Object.entries(row.applicationSummary ?? {})) {
        applications.set(processKey, (applications.get(processKey) ?? 0) + Number(seconds || 0));
      }
      for (const [category, seconds] of Object.entries(row.categorySummary ?? {})) {
        categories.set(category as AppCategory, (categories.get(category as AppCategory) ?? 0) + Number(seconds || 0));
      }
    }

    const breakdown = buildApplicationBreakdown(
      [...applications.entries()].map(([processKey, seconds]) => ({
        processKey,
        applicationName: processKey,
        category: 'UNCLASSIFIED' as AppCategory,
        totalSeconds: seconds,
        activeSeconds: seconds,
      })),
      { topN: 6 },
    );

    return {
      people: rows.length,
      late: rows.filter((row) => row.lateLogin).length,
      unclean: rows.filter((row) => row.hasUncleanSession).length,
      totals,
      // Average over people who actually signed in, not over the whole company: dividing by
      // headcount would make a day with three people on leave look like a collapse in hours.
      averageActive: rows.length ? Math.round(totals.active / rows.length) : 0,
      breakdown,
      categories: [...categories.entries()].sort((left, right) => right[1] - left[1]),
    };
  }, [days.data]);

  const deviceHealth = useMemo(() => {
    const all = devices.data ?? [];
    return {
      total: all.length,
      pending: all.filter((device) => device.status === 'PENDING').length,
      blocked: all.filter((device) => device.status === 'BLOCKED').length,
      neverReported: all.filter((device) => !device.lastHeartbeatAt).length,
    };
  }, [devices.data]);

  if (loading) return <HrLoader label="Loading the Windows Agent dashboard" />;
  if (!allowed) return <HrAccessDenied what="the Windows Agent dashboard" />;

  const empty = !days.loading && summary.people === 0;

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Windows Agent"
        description={`Activity recorded today, ${new Date().toLocaleDateString('en-GB', { dateStyle: 'full' })}.`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={WINDOWS_AGENT_ROUTES.live}>Live users</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={WINDOWS_AGENT_ROUTES.attendance}>Attendance</Link>
            </Button>
          </>
        }
      />

      {empty ? (
        <HrEmptyState
          icon={MonitorSmartphone}
          title="No activity recorded today"
          description={
            deviceHealth.total === 0
              ? 'No computer has enrolled yet. Create an enrolment code on the Devices page, then run the installer on a pilot PC.'
              : 'Agents are enrolled but none has reported today. Check the Devices page for agent health.'
          }
          action={
            canSeeDevices ? (
              <Button asChild size="sm">
                <Link href={WINDOWS_AGENT_ROUTES.devices}>Open devices</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HrKpiCard
              label="Signed in today"
              value={summary.people}
              icon={Users}
              tone="blue"
              href={WINDOWS_AGENT_ROUTES.attendance}
            />
            <HrKpiCard
              label="Total active"
              value={formatSeconds(summary.totals.active)}
              icon={Activity}
              tone="emerald"
              hint={`${formatSeconds(summary.totals.session)} logged in`}
            />
            <HrKpiCard
              label="Average active"
              value={formatSeconds(summary.averageActive)}
              icon={Clock}
              tone="indigo"
              hint="per person who signed in"
            />
            <HrKpiCard
              label="Late starts"
              value={summary.late}
              icon={AlertTriangle}
              tone={summary.late ? 'amber' : 'slate'}
              hint="against the configured workday start"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Where the time went</CardTitle>
                <CardDescription>
                  Foreground time today, across everybody you can see. Idle time inside an
                  application is counted as idle, not as use.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {summary.breakdown.rows.length ? (
                  <HrBarList
                    rows={summary.breakdown.rows.map((row) => ({
                      label: row.applicationName,
                      value: row.activeSeconds,
                    }))}
                    valueLabel={(value) => formatSeconds(value)}
                    tone="indigo"
                  />
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No application time recorded yet today.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">How the day divided</CardTitle>
                <CardDescription>
                  The four buckets add up to the time people were signed in.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <SplitRow label="Active" seconds={summary.totals.active} total={summary.totals.session} tone="bg-emerald-500" />
                <SplitRow label="Idle" seconds={summary.totals.idle} total={summary.totals.session} tone="bg-amber-400" />
                <SplitRow label="Locked" seconds={summary.totals.locked} total={summary.totals.session} tone="bg-slate-300" />

                {summary.categories.length ? (
                  <div className="pt-2">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      By category
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {summary.categories.slice(0, 6).map(([category, seconds]) => (
                        <span key={category} className="flex items-center gap-1.5">
                          <CategoryBadge category={category} />
                          <span className="text-xs text-muted-foreground">{formatSeconds(seconds)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {canSeeDevices && deviceHealth.total > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="h-4 w-4" aria-hidden />
              Fleet
            </CardTitle>
            <CardDescription>
              {deviceHealth.total} enrolled {deviceHealth.total === 1 ? 'computer' : 'computers'}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <HrKpiCard
              label="Awaiting approval"
              value={deviceHealth.pending}
              tone={deviceHealth.pending ? 'amber' : 'slate'}
              href={WINDOWS_AGENT_ROUTES.devices}
            />
            <HrKpiCard
              label="Blocked"
              value={deviceHealth.blocked}
              tone={deviceHealth.blocked ? 'rose' : 'slate'}
              href={WINDOWS_AGENT_ROUTES.devices}
            />
            <HrKpiCard
              label="Never reported"
              value={deviceHealth.neverReported}
              tone={deviceHealth.neverReported ? 'amber' : 'slate'}
              hint="installed but never sent a heartbeat"
              href={WINDOWS_AGENT_ROUTES.devices}
            />
          </CardContent>
        </Card>
      ) : null}

      {summary.unclean > 0 ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <div className="text-sm">
              <p className="font-medium text-amber-900">
                {summary.unclean} {summary.unclean === 1 ? 'session' : 'sessions'} ended without a
                sign-out today.
              </p>
              <p className="mt-0.5 text-amber-800">
                Their end times are estimated from the last heartbeat, not observed. Usually a
                power cut or a forced restart — the attendance report marks them so the hours are
                not read as exact.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <MeasurementNotice />
    </div>
  );
}

function SplitRow({
  label,
  seconds,
  total,
  tone,
}: {
  label: string;
  seconds: number;
  total: number;
  tone: string;
}) {
  const percent = total > 0 ? Math.round((seconds / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          <Duration seconds={seconds} /> · {percent}%
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={tone} style={{ width: `${percent}%`, height: '100%' }} />
      </div>
    </div>
  );
}
