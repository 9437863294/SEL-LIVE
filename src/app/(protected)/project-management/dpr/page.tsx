"use client";

/**
 * Daily Progress — the register's dashboard.
 *
 * Opens on figures rather than link cards: how the chosen period is tracking against what was
 * projected for it, the planned-vs-actual curve, and the lines furthest behind. The period picker
 * is the whole point of the screen — projections are set at whatever granularity suits, and this
 * reads them back at whatever granularity is asked for.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  CalendarDays,
  ClipboardList,
  FileBarChart2,
  HardHat,
  LineChart as LineChartIcon,
  Plus,
  Target,
  TriangleAlert,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DPR_BASE_PATH,
  DPR_PERMISSION_RESOURCE,
  buildDprHeadline,
  buildDprPeriodReport,
  buildDprTrend,
  type DprScope,
} from "@/lib/project-management-dpr";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DPR_GRADIENT,
  DprAccessDenied,
  DprLoadingState,
  DprPageShell,
  DprPeriodPicker,
  DprProjectNotFound,
  DprScopeTabs,
  defaultPeriodSelection,
  formatPct,
  formatQty,
  resolvePeriodRange,
  resolveTrendGranularity,
  todayIso,
  type DprPeriodSelection,
} from "@/components/project-management/dpr/dpr-shell";
import StatCard from "@/components/project-management/stat-card";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { chartChrome } from "@/components/ui/chart";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { cn } from "@/lib/utils";

export default function DailyProgressDashboardPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);

  const { projectName, isResolving, notFound, boqItems, entries, targets, isLoading, loadError } =
    useDprData(mappingId, canView);

  // The Civil and Erection workspaces link in with their own scope, so arriving from one opens
  // already filtered to it rather than on a mixed view the user then has to narrow.
  const linkedScope = searchParams?.get("scope");
  const [scope, setScope] = useState<DprScope | "All">(
    linkedScope === "Civil" || linkedScope === "Erection" ? linkedScope : "All",
  );
  const [period, setPeriod] = useState<DprPeriodSelection>(() => defaultPeriodSelection("Week"));

  const range = useMemo(() => resolvePeriodRange(period), [period]);
  const scopeFilter = scope === "All" ? undefined : scope;

  const headline = useMemo(
    () => buildDprHeadline({ boqItems, entries, targets, range, scope: scopeFilter }),
    [boqItems, entries, targets, range, scopeFilter],
  );

  const report = useMemo(
    () => buildDprPeriodReport({ boqItems, entries, targets, range, scope: scopeFilter }),
    [boqItems, entries, targets, range, scopeFilter],
  );

  const trend = useMemo(
    () =>
      buildDprTrend({
        entries,
        targets,
        periodType: resolveTrendGranularity(period, range),
        range,
        scope: scopeFilter,
      }),
    [entries, targets, period, range, scopeFilter],
  );

  /** Today's filing status per scope — the question a site office opens this screen to answer. */
  const todayStatus = useMemo(() => {
    const today = todayIso();
    return (["Civil", "Erection"] as DprScope[]).map((candidate) => {
      const entry = entries.find((item) => item.date === today && item.scope === candidate);
      return { scope: candidate, status: entry?.status ?? null, id: entry?.id ?? "" };
    });
  }, [entries]);

  const behind = useMemo(
    () => report.rows.filter((row) => row.plannedQty > 0 && row.varianceQty < 0).slice(0, 6),
    [report.rows],
  );

  const withProject = (path: string) =>
    `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(mappingId)}`;

  if (isAuthLoading || isResolving) return <DprLoadingState blocks={2} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before opening Daily Progress."
        href="/project-management"
      />
    );
  }

  return (
    <DprPageShell>
      <PageHeader
        title="Daily Progress"
        description="Projected against actual work on this project's Civil and Erection BOQ lines."
        icon={Activity}
        breadcrumbs={[
          { label: "Project Management", href: "/project-management" },
          { label: projectName || "Project" },
        ]}
        backHref={withProject("/project-management")}
        backLabel="Project Management"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={withProject(`${DPR_BASE_PATH}/targets`)}>
                <Target className="mr-2 h-4 w-4" /> Projections
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={withProject(`${DPR_BASE_PATH}/reports`)}>
                <FileBarChart2 className="mr-2 h-4 w-4" /> Reports
              </Link>
            </Button>
            <Button asChild>
              <Link href={withProject(`${DPR_BASE_PATH}/entry`)}>
                <Plus className="mr-2 h-4 w-4" /> Record progress
              </Link>
            </Button>
          </>
        }
      />

      <Card className="border-border/60">
        <CardContent className="space-y-4 p-4">
          <DprScopeTabs value={scope} onChange={setScope} includeAll />
          <DprPeriodPicker value={period} onChange={setPeriod} />
        </CardContent>
      </Card>

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      ) : null}

      {/* Today's filing status, so a missing day is visible without opening the log. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {todayStatus.map((row) => (
          <Card key={row.scope} className="border-border/60">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white",
                    row.scope === "Civil" ? "from-sky-500 to-blue-600" : DPR_GRADIENT,
                  )}
                >
                  <HardHat className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{row.scope} — today</p>
                  <div className="mt-0.5">
                    {row.status ? (
                      <StatusBadge status={row.status} dot />
                    ) : (
                      <StatusBadge status="Pending" tone="warning" dot>
                        Not recorded
                      </StatusBadge>
                    )}
                  </div>
                </div>
              </div>
              <Button asChild size="sm" variant={row.status ? "outline" : "default"}>
                <Link
                  href={withProject(
                    `${DPR_BASE_PATH}/entry?scope=${row.scope}&date=${todayIso()}`,
                  )}
                >
                  {row.status ? "Open" : "Record"}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Projected this period"
          value={formatQty(headline.plannedQty)}
          icon={Target}
          tone="bg-sky-500/10 text-sky-600"
        />
        <StatCard
          label="Actual this period"
          value={formatQty(headline.actualQty)}
          icon={Activity}
          tone="bg-emerald-500/10 text-emerald-600"
        />
        <StatCard
          label="Achievement"
          value={formatPct(headline.achievementPct)}
          icon={LineChartIcon}
          tone="bg-violet-500/10 text-violet-600"
        />
        <StatCard
          label="Lines behind plan"
          value={headline.linesBehind}
          icon={TriangleAlert}
          tone="bg-rose-500/10 text-rose-600"
        />
        <StatCard
          label="Man-days"
          value={formatQty(headline.manDays)}
          icon={Users}
          tone="bg-amber-500/10 text-amber-600"
        />
        <StatCard
          label="Lost time (hrs)"
          value={formatQty(headline.lostTimeHours)}
          icon={TriangleAlert}
          tone="bg-orange-500/10 text-orange-600"
        />
        <StatCard
          label="Days reported"
          value={`${headline.daysReported} / ${headline.daysInPeriod}`}
          icon={CalendarDays}
          tone="bg-indigo-500/10 text-indigo-600"
        />
        <StatCard
          label="Lines worked"
          value={headline.linesWorked}
          icon={ClipboardList}
          tone="bg-teal-500/10 text-teal-600"
        />
      </div>

      <Card className="border-border/60">
        <CardContent className="space-y-3 p-4">
          <SectionHeader
            title="Projected against actual"
            description="Cumulative across the period. Quantities are summed across BOQ lines, so read the shape rather than the absolute figure where units differ."
            icon={LineChartIcon}
          />
          {isLoading ? (
            <div className="h-72 animate-pulse rounded-md bg-muted/50" />
          ) : trend.length === 0 ? (
            <PmEmptyState
              icon={LineChartIcon}
              title="Nothing to plot yet"
              description="Set a projection and record a day's progress to see the curve."
            />
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="dprPlanned" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="dprActual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    stroke={chartChrome.axis}
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis stroke={chartChrome.axis} tick={{ fontSize: 11 }} width={56} />
                  <Tooltip
                    cursor={chartChrome.cursor}
                    {...chartChrome.tooltip}
                    formatter={(value: number | string) => formatQty(Number(value))}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    name="Projected (cumulative)"
                    dataKey="cumulativePlannedQty"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#dprPlanned)"
                  />
                  <Area
                    type="monotone"
                    name="Actual (cumulative)"
                    dataKey="cumulativeActualQty"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#dprActual)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="space-y-3 p-4">
          <SectionHeader
            title="Furthest behind"
            description="BOQ lines that were projected for this period and fell short."
            icon={TriangleAlert}
            actions={
              <Button asChild size="sm" variant="outline">
                <Link href={withProject(`${DPR_BASE_PATH}/reports`)}>Full report</Link>
              </Button>
            }
          />
          {behind.length === 0 ? (
            <PmEmptyState
              icon={Target}
              title="Nothing behind plan"
              description="Every projected line met its target for this period, or nothing was projected."
            />
          ) : (
            <div className="space-y-2">
              {behind.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={row.description}>
                      {row.boqSlNo ? `${row.boqSlNo} · ` : ""}
                      {row.description || "BOQ line"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Projected {formatQty(row.plannedQty)} {row.unit} · done{" "}
                      {formatQty(row.actualQty)} {row.unit} · {formatPct(row.progressPct)} of BOQ
                    </p>
                  </div>
                  <StatusBadge status="Shortfall" tone="danger">
                    {formatQty(row.varianceQty)} {row.unit}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </DprPageShell>
  );
}
