"use client";

/**
 * Daily Progress reports.
 *
 * Five views over the same register, each scoped to Civil, Erection or both and read at whatever
 * period the picker is set to. Projections are pro-rated onto that window, so a monthly plan and a
 * weekly question still line up — the reports never assume the plan was set at the granularity
 * they are being read at.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  CloudSun,
  Download,
  FileBarChart2,
  LineChart as LineChartIcon,
  TriangleAlert,
  Truck,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
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
  buildDprEquipmentSummary,
  buildDprHindrances,
  buildDprLostTime,
  buildDprManpowerSummary,
  buildDprPeriodReport,
  buildDprTrend,
  dprPeriodReportCsv,
  type DprScope,
} from "@/lib/project-management-dpr";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprLoadingState,
  DprPageShell,
  DprPeriodPicker,
  DprProjectNotFound,
  DprScopeTabs,
  defaultPeriodSelection,
  formatDisplayDate,
  formatPct,
  formatQty,
  resolvePeriodRange,
  resolveTrendGranularity,
  type DprPeriodSelection,
} from "@/components/project-management/dpr/dpr-shell";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { chartChrome } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const VIEWS = [
  { id: "progress", label: "BOQ progress", icon: Activity },
  { id: "trend", label: "Plan vs actual", icon: LineChartIcon },
  { id: "manpower", label: "Manpower", icon: Users },
  { id: "equipment", label: "Plant", icon: Truck },
  { id: "delays", label: "Delays", icon: CloudSun },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

export default function DprReportsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);

  const { projectName, isResolving, notFound, boqItems, entries, targets, isLoading } = useDprData(
    mappingId,
    canView,
  );

  const [view, setView] = useState<ViewId>("progress");
  const [scope, setScope] = useState<DprScope | "All">("All");
  const [period, setPeriod] = useState<DprPeriodSelection>(() => defaultPeriodSelection("Month"));

  const range = useMemo(() => resolvePeriodRange(period), [period]);
  const scopeFilter = scope === "All" ? undefined : scope;

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

  const manpower = useMemo(
    () => buildDprManpowerSummary(entries, { scope: scopeFilter, range }),
    [entries, scopeFilter, range],
  );

  const equipment = useMemo(
    () => buildDprEquipmentSummary(entries, { scope: scopeFilter, range }),
    [entries, scopeFilter, range],
  );

  const lostTime = useMemo(
    () => buildDprLostTime(entries, { scope: scopeFilter, range }),
    [entries, scopeFilter, range],
  );

  const hindrances = useMemo(
    () => buildDprHindrances(entries, { scope: scopeFilter, range }),
    [entries, scopeFilter, range],
  );

  const downloadCsv = () => {
    const csv = dprPeriodReportCsv(report);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName || "project"}-dpr-${scope.toLowerCase()}-${range.startDate}-to-${range.endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const withProject = (path: string) =>
    `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(mappingId)}`;

  if (isAuthLoading || isResolving) return <DprLoadingState blocks={2} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before opening these reports."
        href="/project-management"
      />
    );
  }

  const totalLostTime = lostTime.reduce((sum, row) => sum + row.hours, 0);

  return (
    <DprPageShell>
      <PageHeader
        title="Daily Progress reports"
        description="Projected against actual, manpower, plant and delays — for the period and scope you choose."
        icon={FileBarChart2}
        breadcrumbs={[
          { label: "Project Management", href: "/project-management" },
          { label: "Daily Progress", href: withProject(DPR_BASE_PATH) },
          { label: projectName || "Project" },
        ]}
        backHref={withProject(DPR_BASE_PATH)}
        backLabel="Daily Progress"
        actions={
          <Button variant="outline" onClick={downloadCsv} disabled={report.rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <Card className="border-border/60">
        <CardContent className="space-y-4 p-4">
          <DprScopeTabs value={scope} onChange={setScope} includeAll />
          <DprPeriodPicker value={period} onChange={setPeriod} />
          <Tabs value={view} onValueChange={(next) => setView(next as ViewId)}>
            <TabsList className="flex-wrap">
              {VIEWS.map((candidate) => (
                <TabsTrigger key={candidate.id} value={candidate.id}>
                  <candidate.icon className="mr-1.5 h-4 w-4" />
                  {candidate.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card className="border-border/60">
          <CardContent className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded bg-muted/50" />
            ))}
          </CardContent>
        </Card>
      ) : view === "progress" ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            {report.rows.length === 0 ? (
              <PmEmptyState
                icon={Activity}
                title="Nothing recorded or projected for this period"
                description="Change the period or scope, or record a day's progress."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[240px]">BOQ line</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">BOQ qty</TableHead>
                    <TableHead className="text-right">Projected</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-right">Achieved</TableHead>
                    <TableHead className="text-right">Cumulative</TableHead>
                    <TableHead className="text-right">Progress</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="min-w-[240px]">
                        <div className="truncate text-sm font-medium" title={row.description}>
                          {row.boqSlNo ? `${row.boqSlNo} · ` : ""}
                          {row.description || "BOQ line"}
                        </div>
                        {row.lastWorkedDate ? (
                          <div className="text-xs text-muted-foreground">
                            Last worked {formatDisplayDate(row.lastWorkedDate)} · {row.workedDays}{" "}
                            day{row.workedDays === 1 ? "" : "s"}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{row.unit || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(row.boqQty)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(row.plannedQty)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatQty(row.actualQty)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            row.varianceQty < 0
                              ? "text-destructive"
                              : row.varianceQty > 0
                                ? "text-emerald-600"
                                : undefined
                          }
                        >
                          {row.varianceQty > 0 ? "+" : ""}
                          {formatQty(row.varianceQty)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.achievementPct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <StatusBadge
                            status="Achievement"
                            tone={
                              row.achievementPct >= 100
                                ? "success"
                                : row.achievementPct >= 75
                                  ? "warning"
                                  : "danger"
                            }
                          >
                            {formatPct(row.achievementPct)}
                          </StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(row.cumulativeQty)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPct(row.progressPct)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(row.balanceQty)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : view === "trend" ? (
        <Card className="border-border/60">
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">
              Read at {resolveTrendGranularity(period, range).toLowerCase()} granularity. Quantities
              are summed across BOQ lines, so where units differ read the shape, not the figure.
            </p>
            {trend.length === 0 ? (
              <PmEmptyState icon={LineChartIcon} title="Nothing to plot for this period" />
            ) : (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                    <Bar
                      name="Projected"
                      dataKey="plannedQty"
                      fill="#6366f1"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar name="Actual" dataKey="actualQty" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      ) : view === "manpower" ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            {manpower.length === 0 ? (
              <PmEmptyState
                icon={Users}
                title="No manpower recorded"
                description="Trades and headcount entered on the daily sheets roll up here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trade</TableHead>
                    <TableHead className="text-right">Man-days</TableHead>
                    <TableHead className="text-right">Days present</TableHead>
                    <TableHead className="text-right">Peak strength</TableHead>
                    <TableHead className="text-right">Average per day</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manpower.map((row) => (
                    <TableRow key={row.trade}>
                      <TableCell className="font-medium">{row.trade}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(row.manDays)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.daysPresent}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.peakCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.daysPresent > 0 ? formatQty(row.manDays / row.daysPresent) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : view === "equipment" ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            {equipment.length === 0 ? (
              <PmEmptyState
                icon={Truck}
                title="No plant recorded"
                description="Equipment deployed on the daily sheets rolls up here with its utilisation."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipment</TableHead>
                    <TableHead className="text-right">Days deployed</TableHead>
                    <TableHead className="text-right">Running hrs</TableHead>
                    <TableHead className="text-right">Idle hrs</TableHead>
                    <TableHead className="text-right">Utilisation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.deployedDays}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(row.runningHours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(row.idleHours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.utilisationPct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <StatusBadge
                            status="Utilisation"
                            tone={
                              row.utilisationPct >= 75
                                ? "success"
                                : row.utilisationPct >= 50
                                  ? "warning"
                                  : "danger"
                            }
                          >
                            {formatPct(row.utilisationPct)}
                          </StatusBadge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="border-border/60">
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 p-4">
                <p className="text-sm font-semibold">Lost time</p>
                <StatusBadge status="Total" tone={totalLostTime > 0 ? "warning" : "neutral"}>
                  {formatQty(totalLostTime)} hrs
                </StatusBadge>
              </div>
              {lostTime.length === 0 ? (
                <PmEmptyState icon={CloudSun} title="No time lost in this period" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead>Weather</TableHead>
                      <TableHead className="min-w-[200px]">Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lostTime.map((row) => (
                      <TableRow key={`${row.date}-${row.scope}`}>
                        <TableCell className="whitespace-nowrap">
                          {formatDisplayDate(row.date)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={row.scope}
                            tone={row.scope === "Civil" ? "info" : "progress"}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatQty(row.hours)}</TableCell>
                        <TableCell>{row.weather || "—"}</TableCell>
                        <TableCell className="min-w-[200px]">{row.reason || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 p-4">
                <p className="text-sm font-semibold">Hindrances</p>
                <StatusBadge status="Days" tone={hindrances.length > 0 ? "warning" : "neutral"}>
                  {hindrances.length} day{hindrances.length === 1 ? "" : "s"}
                </StatusBadge>
              </div>
              {hindrances.length === 0 ? (
                <PmEmptyState icon={TriangleAlert} title="No hindrances raised in this period" />
              ) : (
                <div className="divide-y divide-border/60">
                  {hindrances.map((row) => (
                    <div key={`${row.date}-${row.scope}`} className="space-y-1 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{formatDisplayDate(row.date)}</span>
                        <StatusBadge
                          status={row.scope}
                          tone={row.scope === "Civil" ? "info" : "progress"}
                        />
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {row.hindrances}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </DprPageShell>
  );
}
