'use client';

/**
 * Headcount, movement and category reports — built from the same corrected roster Manage Employee
 * shows, so a number here can never disagree with that screen about who counts as working.
 *
 * Deliberately aggregate-only. No export, no drill-through beyond a category's own filtered link on
 * Manage Employee. If a report needs to name individuals, that is Manage Employee's job with a filter
 * applied, not a reason to duplicate its table here.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, MapPin, RefreshCw, TrendingUp, UserMinus, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import {
  HrAccessDenied,
  HrBarList,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
} from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { isWorkingState } from '@/lib/greythr';
import { fetchEmployeeRoster, type EmployeeRosterResponse, type RosterEmployeeRow } from '@/lib/greythr-sync-client';

/** Group and count, sorted largest first — every breakdown on this page is this one shape. */
function tally(rows: RosterEmployeeRow[], key: (row: RosterEmployeeRow) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/** The last 12 calendar months, oldest first, as `YYYY-MM` — the join/exit trend's x-axis. */
function last12Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let index = 11; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

const monthLabel = (key: string): string => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

export default function EmployeeReportsPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Settings.Employee Management');

  const [report, setReport] = useState<EmployeeRosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (isRefresh: boolean) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setReport(await fetchEmployeeRoster());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the roster.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const rows = report?.employees ?? [];
  const working = rows.filter((row) => isWorkingState(row.employmentState));
  const departed = rows.filter((row) => !isWorkingState(row.employmentState));

  const byDepartment = useMemo(() => tally(working, (row) => row.categories?.Department || row.department), [working]);
  const byDesignation = useMemo(() => tally(working, (row) => row.categories?.Designation || row.designation), [working]);
  const byLocation = useMemo(() => tally(working, (row) => row.categories?.Location || row.location), [working]);
  const byProject = useMemo(
    () => tally(working, (row) => row.categories?.['Project Name'] || row.projectName),
    [working],
  );
  const byState = useMemo(() => tally(rows, (row) => row.employmentState), [rows]);

  /** Joiners and exits, by month, over the last year — the one trend a static headcount cannot show. */
  const movement = useMemo(() => {
    const months = last12Months();
    const joins = new Map(months.map((month) => [month, 0]));
    const exits = new Map(months.map((month) => [month, 0]));
    for (const row of rows) {
      const joinMonth = row.dateOfJoin?.slice(0, 7);
      if (joinMonth && joins.has(joinMonth)) joins.set(joinMonth, (joins.get(joinMonth) ?? 0) + 1);
      const exitMonth = row.exitDate?.slice(0, 7);
      if (exitMonth && exits.has(exitMonth)) exits.set(exitMonth, (exits.get(exitMonth) ?? 0) + 1);
    }
    return months.map((month) => ({ month, joined: joins.get(month) ?? 0, left: exits.get(month) ?? 0 }));
  }, [rows]);

  const maxMovement = Math.max(...movement.map((entry) => Math.max(entry.joined, entry.left)), 1);

  if (authLoading || loading) return <HrLoader label="Building reports from the roster…" />;
  if (!canView) return <HrAccessDenied what="employee reports" />;

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/employee">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Employee Management
        </Link>
      </Button>

      <HrPageHeader
        title="Reports"
        description="Headcount, movement and category breakdowns — built from the corrected roster, not a separate count that can drift from it."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'mr-1.5 h-4 w-4 animate-spin' : 'mr-1.5 h-4 w-4'} />
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!report?.liveRoster && !error && (
        <p className="mb-4 text-xs text-amber-700">
          greytHR could not be reached live for this report — figures reflect the stored mirror only.
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HrKpiCard label="Total records" value={rows.length} icon={Users} tone="indigo" />
        <HrKpiCard label="Currently working" value={working.length} icon={UserPlus} tone="emerald" />
        <HrKpiCard label="Departed" value={departed.length} icon={UserMinus} tone="rose" />
        <HrKpiCard
          label="Departments"
          value={byDepartment.length}
          hint={`${byLocation.length} locations`}
          icon={Building2}
          tone="blue"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
          <CardHeader className="px-4 py-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
              Joiners and exits, last 12 months
            </CardTitle>
            <CardDescription className="text-xs">
              From `dateOfJoin` / the derived exit date on each record. A month with neither bar had no
              movement recorded.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex h-40 items-end gap-1.5">
              {movement.map((entry) => (
                <div key={entry.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-32 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-1/2 rounded-t bg-emerald-400"
                      style={{ height: `${(entry.joined / maxMovement) * 100}%` }}
                      title={`${entry.joined} joined`}
                    />
                    <div
                      className="w-1/2 rounded-t bg-rose-300"
                      style={{ height: `${(entry.left / maxMovement) * 100}%` }}
                      title={`${entry.left} left`}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{monthLabel(entry.month)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Joined</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-300" /> Left</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">By employment state</CardTitle>
            <CardDescription className="text-xs">Every record in the mirror, corrected against greytHR's live roster.</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <HrBarList rows={byState} tone="indigo" />
          </CardContent>
        </Card>

        <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
          <CardHeader className="px-4 py-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Building2 className="h-4 w-4 text-indigo-600" />
              By department
            </CardTitle>
            <CardDescription className="text-xs">Currently working employees only.</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <HrBarList rows={byDepartment.slice(0, 10)} tone="emerald" />
          </CardContent>
        </Card>

        <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">By designation</CardTitle>
            <CardDescription className="text-xs">Top 10, currently working.</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <HrBarList rows={byDesignation.slice(0, 10)} tone="amber" />
          </CardContent>
        </Card>

        <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
          <CardHeader className="px-4 py-3">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <MapPin className="h-4 w-4 text-indigo-600" />
              By location
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <HrBarList rows={byLocation.slice(0, 10)} tone="rose" />
          </CardContent>
        </Card>

        <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">By project</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <HrBarList rows={byProject.slice(0, 10)} tone="indigo" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
