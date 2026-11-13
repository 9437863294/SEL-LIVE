"use client";

/**
 * Daily Progress reports.
 *
 * Five views over the same register, each scoped to Civil, Erection or both and read at whatever
 * period the picker is set to. Projections come from the planning engine (working calendar, spread,
 * shorter period owning overlapped days), so a monthly plan and a weekly question still line up.
 *
 * The plan-vs-actual view is unit-free: each bucket is a share of the period's plan, so lines in
 * Cum and Nos sit on one axis without their quantities ever being added together.
 *
 * Every table keeps its data inside itself, as the Projections views do: one line per row, fixed
 * columns with the long text cut short (full text on hover), a bounded height under a pinned
 * header, and a narrow screen scrolls the table sideways in its own box.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  CloudSun,
  CornerDownRight,
  Download,
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
  DPR_PERMISSION_RESOURCE,
  buildDprEquipmentSummary,
  buildDprHindrances,
  buildDprLostTime,
  buildDprManpowerSummary,
  buildDprPeriodReport,
  dprToCsv,
  type DprPeriodRow,
  type DprScope,
} from "@/lib/project-management-dpr";
import { buildDprShareTrend, dprShortDate } from "@/lib/project-management-dpr-plan";
import {
  arrangeByBreakdown,
  type DprBreakdownNode,
} from "@/lib/project-management-dpr-breakdown";
import { cn } from "@/lib/utils";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprHeader,
  DprLoadingState,
  DprPageShell,
  DprPeriodPicker,
  DprProjectNotFound,
  DprScopeTabs,
  defaultPeriodSelection,
  formatDisplayDate,
  formatPct,
  formatQty,
  formatQtyAt,
  resolvePeriodRange,
  resolveTrendGranularity,
  type DprPeriodSelection,
} from "@/components/project-management/dpr/dpr-shell";
import { InfoTip } from "@/components/shared/info-tip";
import { StatusBadge } from "@/components/shared/status-badge";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { chartChrome } from "@/components/ui/chart";
import { Label } from "@/components/ui/label";
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

/** The table furniture every view shares: bounded height, pinned header, fixed columns. */
const TABLE_PROPS = { stickyHeader: true, containerClassName: "max-h-[65vh]" } as const;

/** A single-line text cell: cut short with an ellipsis, the whole value on hover. */
const lineCell = "truncate text-sm";
const numberCell = "truncate text-right text-sm tabular-nums";

const scopeTone = (scope: DprScope) => (scope === "Civil" ? "info" : "progress");

/** A BOQ progress row: a leaf line (`row`), or a group (`row` null) with its rolled-up figures. */
interface ProgressRow {
  node: DprBreakdownNode | null;
  row: DprPeriodRow | null;
  rolled: Record<string, number>;
}

/** "7 Earthing system › 7.2 GI strip › Welding" — a breakdown row's tooltip. */
const describeNode = (node: DprBreakdownNode | null): string =>
  node
    ? [...node.ancestors.map((ancestor) => `${ancestor.slNo} ${ancestor.description}`.trim()), node.description].join(
        " › ",
      )
    : "";

/** A description indented by its depth in the work breakdown, on one line. */
function BreakdownDescription({ depth, text, strong = false }: { depth: number; text: string; strong?: boolean }) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-1", strong && "font-semibold")}
      style={depth > 0 ? { paddingLeft: depth * 16 } : undefined}
    >
      {depth > 0 ? (
        <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
      <span className="min-w-0 truncate">{text || "BOQ line"}</span>
    </div>
  );
}

export default function DprReportsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);

  const {
    projectName,
    isResolving,
    notFound,
    boqItems,
    breakdown,
    entries,
    targets,
    plan,
    settings,
    decimalsFor,
    isLoading,
  } = useDprData(mappingId, canView);

  const [view, setView] = useState<ViewId>("progress");
  const [scope, setScope] = useState<DprScope | "All">("All");
  const [period, setPeriod] = useState<DprPeriodSelection>(() => defaultPeriodSelection("Month"));

  const range = useMemo(() => resolvePeriodRange(period), [period]);
  const scopeFilter = scope === "All" ? undefined : scope;

  const report = useMemo(
    () => buildDprPeriodReport({ boqItems, entries, targets, range, scope: scopeFilter, plan }),
    [boqItems, entries, targets, range, scopeFilter, plan],
  );

  /**
   * The BOQ progress rows. With sub-items among them, they are shown under their groups in
   * breakdown order, each group's figures rolled up from its leaves in the group's own unit;
   * without, the report's own order (worst shortfall first) stands.
   */
  const progressRows = useMemo((): ProgressRow[] => {
    const nested = report.rows.some((row) => (breakdown.nodes.get(row.id)?.depth ?? 0) > 0);
    if (!nested) {
      return report.rows.map((row) => ({ node: breakdown.nodes.get(row.id) ?? null, row, rolled: {} }));
    }
    const tree = arrangeByBreakdown(breakdown, new Map(report.rows.map((row) => [row.id, row])), {
      plannedQty: (row) => row.plannedQty,
      actualQty: (row) => row.actualQty,
      cumulativeQty: (row) => row.cumulativeQty,
    });
    const placed = new Set(tree.map((entry) => entry.node.id));
    return [
      ...tree.map((entry) => ({ node: entry.node, row: entry.row, rolled: entry.rolled })),
      ...report.rows
        .filter((row) => !placed.has(row.id))
        .map((row) => ({ node: null, row, rolled: {} })),
    ];
  }, [report.rows, breakdown]);

  const granularity = resolveTrendGranularity(period, range);
  const trend = useMemo(
    () =>
      buildDprShareTrend({
        items: boqItems,
        entries,
        plan,
        range,
        periodType: granularity,
        scope: scopeFilter,
      }),
    [boqItems, entries, plan, range, granularity, scopeFilter],
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
    // Leaf lines only (groups are roll-ups of them), each with the lines above it as "Parent".
    const pathById = new Map(boqItems.map((item) => [item.id, item.path ?? ""]));
    const round2 = (value: number) => Math.round(value * 100) / 100;
    const csv = dprToCsv(
      [
        "ERP SL No",
        "BOQ SL No",
        "Parent",
        "Description",
        "Unit",
        "BOQ Qty",
        "Projected Qty",
        "Actual Qty",
        "Variance Qty",
        "Achievement %",
        "Cumulative Qty",
        "Progress %",
        "Balance Qty",
        "Days Worked",
        "Last Worked",
      ],
      report.rows.map((row) => [
        row.erpSlNo ?? "",
        row.boqSlNo,
        pathById.get(row.id) ?? "",
        row.description,
        row.unit,
        round2(row.boqQty),
        round2(row.plannedQty),
        round2(row.actualQty),
        round2(row.varianceQty),
        row.achievementPct === null ? "" : round2(row.achievementPct),
        round2(row.cumulativeQty),
        row.progressPct === null ? "" : round2(row.progressPct),
        round2(row.balanceQty),
        row.workedDays,
        row.lastWorkedDate,
      ]),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName || "project"}-dpr-${scope.toLowerCase()}-${range.startDate}-to-${range.endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

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
      <DprHeader
        active="reports"
        mappingId={mappingId}
        projectName={projectName}
        actions={
          <Button variant="outline" onClick={downloadCsv} disabled={report.rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <Card className="border-border/60">
        <CardContent className="space-y-3 p-4">
          <Tabs value={view} onValueChange={(next) => setView(next as ViewId)}>
            <TabsList className="h-auto flex-wrap">
              {VIEWS.map((candidate) => (
                <TabsTrigger key={candidate.id} value={candidate.id}>
                  <candidate.icon className="mr-1.5 h-4 w-4" />
                  {candidate.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {/* Scope and period on one line at their own height; it wraps only when narrow. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <div>
                <DprScopeTabs value={scope} onChange={setScope} includeAll />
              </div>
            </div>
            <DprPeriodPicker value={period} onChange={setPeriod} settings={settings} inline />
          </div>
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
              <Table {...TABLE_PROPS} className="min-w-[1272px] table-fixed">
                <colgroup>
                  <col className="w-[72px]" />
                  <col />
                  <col className="w-[68px]" />
                  <col className="w-[100px]" />
                  <col className="w-[96px]" />
                  <col className="w-[96px]" />
                  <col className="w-[100px]" />
                  <col className="w-[84px]" />
                  <col className="w-[100px]" />
                  <col className="w-[84px]" />
                  <col className="w-[100px]" />
                  <col className="w-[64px]" />
                  <col className="w-[96px]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead className="truncate">SL No</TableHead>
                    <TableHead className="truncate">BOQ line</TableHead>
                    <TableHead className="truncate">Unit</TableHead>
                    <TableHead className="truncate text-right">BOQ qty</TableHead>
                    <TableHead className="truncate text-right" title="Projected for the period">
                      Planned
                    </TableHead>
                    <TableHead className="truncate text-right">Actual</TableHead>
                    <TableHead className="truncate text-right" title="Actual less planned">
                      Variance
                    </TableHead>
                    <TableHead className="truncate text-right" title="Achievement: actual ÷ planned">
                      Ach.
                    </TableHead>
                    <TableHead className="truncate text-right" title="Cumulative actual up to the period end">
                      To date
                    </TableHead>
                    <TableHead className="truncate text-right" title="Cumulative as a share of the BOQ quantity">
                      % BOQ
                    </TableHead>
                    <TableHead className="truncate text-right" title="BOQ quantity less cumulative">
                      Balance
                    </TableHead>
                    <TableHead className="truncate text-right" title="Days the line was worked in the period">
                      Days
                    </TableHead>
                    <TableHead className="truncate" title="The last day the line was worked in the period">
                      Last day
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {progressRows.map(({ node, row, rolled }) => {
                    if (!row) {
                      // A group: its leaves' figures rolled up, in its own unit.
                      const unit = node?.unit ?? "";
                      const qty = (value: number) => formatQtyAt(value, decimalsFor(unit));
                      const planned = rolled.plannedQty ?? 0;
                      const actual = rolled.actualQty ?? 0;
                      const cumulative = rolled.cumulativeQty ?? 0;
                      const boqQty = node?.qty ?? 0;
                      const varianceQty = actual - planned;
                      const achievementPct = planned > 0 ? (actual / planned) * 100 : null;
                      const variance = `${varianceQty > 0 ? "+" : ""}${qty(varianceQty)}`;
                      return (
                        <TableRow key={node?.id} className="bg-muted/40">
                          <TableCell className="truncate text-sm font-semibold tabular-nums" title={node?.slNo}>
                            {node?.slNo || "—"}
                          </TableCell>
                          <TableCell className="text-sm" title={`${describeNode(node)} — rolled up from its sub-items`}>
                            <BreakdownDescription depth={node?.depth ?? 0} text={node?.description ?? ""} strong />
                          </TableCell>
                          <TableCell className={`${lineCell} font-medium`} title={unit}>
                            {unit || "—"}
                          </TableCell>
                          <TableCell className={`${numberCell} font-medium`}>{qty(boqQty)}</TableCell>
                          <TableCell className={`${numberCell} font-medium`}>{qty(planned)}</TableCell>
                          <TableCell className={`${numberCell} font-semibold`}>{qty(actual)}</TableCell>
                          <TableCell
                            className={`${numberCell} ${
                              varianceQty < 0 ? "text-destructive" : varianceQty > 0 ? "text-emerald-600" : ""
                            }`}
                            title={variance}
                          >
                            {variance}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">
                            {achievementPct === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <StatusBadge
                                status="Achievement"
                                tone={achievementPct >= 100 ? "success" : achievementPct >= 75 ? "warning" : "danger"}
                              >
                                {formatPct(achievementPct)}
                              </StatusBadge>
                            )}
                          </TableCell>
                          <TableCell className={`${numberCell} font-medium`}>{qty(cumulative)}</TableCell>
                          <TableCell className={numberCell}>
                            {formatPct(boqQty > 0 ? (cumulative / boqQty) * 100 : null)}
                          </TableCell>
                          <TableCell className={numberCell}>{qty(Math.max(boqQty - cumulative, 0))}</TableCell>
                          <TableCell className={`${numberCell} text-muted-foreground`}>—</TableCell>
                          <TableCell className={`${lineCell} text-muted-foreground`}>—</TableCell>
                        </TableRow>
                      );
                    }
                    const qty = (value: number) => formatQtyAt(value, decimalsFor(row.unit));
                    const variance = `${row.varianceQty > 0 ? "+" : ""}${qty(row.varianceQty)}`;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="truncate text-sm font-semibold tabular-nums" title={row.boqSlNo}>
                          {row.boqSlNo || "—"}
                        </TableCell>
                        <TableCell className="text-sm" title={node ? describeNode(node) : row.description}>
                          <BreakdownDescription depth={node?.depth ?? 0} text={row.description} />
                        </TableCell>
                        <TableCell className={lineCell} title={row.unit}>
                          {row.unit || "—"}
                        </TableCell>
                        <TableCell className={numberCell} title={qty(row.boqQty)}>
                          {qty(row.boqQty)}
                        </TableCell>
                        <TableCell className={numberCell} title={qty(row.plannedQty)}>
                          {qty(row.plannedQty)}
                        </TableCell>
                        <TableCell className={`${numberCell} font-medium`} title={qty(row.actualQty)}>
                          {qty(row.actualQty)}
                        </TableCell>
                        <TableCell
                          className={`${numberCell} ${
                            row.varianceQty < 0
                              ? "text-destructive"
                              : row.varianceQty > 0
                                ? "text-emerald-600"
                                : ""
                          }`}
                          title={variance}
                        >
                          {variance}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
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
                        <TableCell className={numberCell} title={qty(row.cumulativeQty)}>
                          {qty(row.cumulativeQty)}
                        </TableCell>
                        <TableCell className={numberCell}>{formatPct(row.progressPct)}</TableCell>
                        <TableCell className={numberCell} title={qty(row.balanceQty)}>
                          {qty(row.balanceQty)}
                        </TableCell>
                        <TableCell className={numberCell}>{row.workedDays || "—"}</TableCell>
                        <TableCell
                          className={`${lineCell} tabular-nums`}
                          title={row.lastWorkedDate ? formatDisplayDate(row.lastWorkedDate) : undefined}
                        >
                          {row.lastWorkedDate ? dprShortDate(row.lastWorkedDate) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : view === "trend" ? (
        <Card className="border-border/60">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <span>
                Each {granularity.toLowerCase()} as a share of the period plan,{" "}
                {trend.basis === "value"
                  ? "weighted by BOQ value"
                  : "averaged across each line’s own percentage"}
                .
              </span>
              <InfoTip label="About this chart">
                A bar is that {granularity.toLowerCase()}’s planned or actual quantity as a
                percentage of everything planned for the whole period, line by line, so lines in
                different units are never added together. When every planned line has a BOQ rate
                the lines are weighted by value; otherwise each line counts equally. The planned
                bars add up to 100% across the period.
              </InfoTip>
            </div>
            {trend.points.length === 0 ? (
              <PmEmptyState
                icon={LineChartIcon}
                title="Nothing planned in this period"
                description="The chart reads actuals against the period plan, so it needs a projection covering the period."
              />
            ) : (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      stroke={chartChrome.axis}
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                      minTickGap={16}
                    />
                    <YAxis
                      stroke={chartChrome.axis}
                      tick={{ fontSize: 11 }}
                      width={48}
                      tickFormatter={(value: number) => `${Math.round(value)}%`}
                    />
                    <Tooltip
                      cursor={chartChrome.cursor}
                      {...chartChrome.tooltip}
                      formatter={(value: number | string) => formatPct(Number(value))}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      name="Planned (% of period plan)"
                      dataKey="plannedPct"
                      fill="#6366f1"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      name="Actual (% of period plan)"
                      dataKey="actualPct"
                      fill="#10b981"
                      radius={[4, 4, 0, 0]}
                    />
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
              <Table {...TABLE_PROPS} className="min-w-[640px] table-fixed">
                <colgroup>
                  <col />
                  <col className="w-[128px]" />
                  <col className="w-[128px]" />
                  <col className="w-[128px]" />
                  <col className="w-[128px]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead className="truncate">Trade</TableHead>
                    <TableHead className="truncate text-right" title="Headcount summed over the days worked">
                      Man-days
                    </TableHead>
                    <TableHead className="truncate text-right" title="Days present">
                      Days
                    </TableHead>
                    <TableHead className="truncate text-right" title="Peak strength on any one day">
                      Peak
                    </TableHead>
                    <TableHead className="truncate text-right" title="Average headcount per day present">
                      Avg / day
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manpower.map((row) => (
                    <TableRow key={row.trade}>
                      <TableCell className={`${lineCell} font-medium`} title={row.trade}>
                        {row.trade}
                      </TableCell>
                      <TableCell className={numberCell}>{formatQty(row.manDays)}</TableCell>
                      <TableCell className={numberCell}>{row.daysPresent}</TableCell>
                      <TableCell className={numberCell}>{row.peakCount}</TableCell>
                      <TableCell className={numberCell}>
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
              <Table {...TABLE_PROPS} className="min-w-[640px] table-fixed">
                <colgroup>
                  <col />
                  <col className="w-[120px]" />
                  <col className="w-[128px]" />
                  <col className="w-[120px]" />
                  <col className="w-[128px]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead className="truncate">Equipment</TableHead>
                    <TableHead className="truncate text-right" title="Days deployed">
                      Days
                    </TableHead>
                    <TableHead className="truncate text-right" title="Running hours">
                      Running hrs
                    </TableHead>
                    <TableHead className="truncate text-right" title="Idle hours">
                      Idle hrs
                    </TableHead>
                    <TableHead className="truncate text-right" title="Running ÷ (running + idle)">
                      Utilisation
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className={`${lineCell} font-medium`} title={row.name}>
                        {row.name}
                      </TableCell>
                      <TableCell className={numberCell}>{row.deployedDays}</TableCell>
                      <TableCell className={numberCell}>{formatQty(row.runningHours)}</TableCell>
                      <TableCell className={numberCell}>{formatQty(row.idleHours)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
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
                <Table {...TABLE_PROPS} className="min-w-[640px] table-fixed">
                  <colgroup>
                    <col className="w-[120px]" />
                    <col className="w-[104px]" />
                    <col className="w-[88px]" />
                    <col className="w-[128px]" />
                    <col />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="truncate">Date</TableHead>
                      <TableHead className="truncate">Scope</TableHead>
                      <TableHead className="truncate text-right">Hours</TableHead>
                      <TableHead className="truncate">Weather</TableHead>
                      <TableHead className="truncate">Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lostTime.map((row) => (
                      <TableRow key={`${row.date}-${row.scope}`}>
                        <TableCell className={`${lineCell} tabular-nums`}>
                          {formatDisplayDate(row.date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <StatusBadge status={row.scope} tone={scopeTone(row.scope)} />
                        </TableCell>
                        <TableCell className={numberCell}>{formatQty(row.hours)}</TableCell>
                        <TableCell className={lineCell} title={row.weather || undefined}>
                          {row.weather || "—"}
                        </TableCell>
                        <TableCell className={lineCell} title={row.reason || undefined}>
                          {row.reason || "—"}
                        </TableCell>
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
                <Table {...TABLE_PROPS} className="min-w-[560px] table-fixed">
                  <colgroup>
                    <col className="w-[120px]" />
                    <col className="w-[104px]" />
                    <col />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="truncate">Date</TableHead>
                      <TableHead className="truncate">Scope</TableHead>
                      <TableHead className="truncate">Hindrance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hindrances.map((row) => (
                      <TableRow key={`${row.date}-${row.scope}`}>
                        <TableCell className={`${lineCell} tabular-nums`}>
                          {formatDisplayDate(row.date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <StatusBadge status={row.scope} tone={scopeTone(row.scope)} />
                        </TableCell>
                        {/* One line: line breaks in the text read as separators; all of it on hover. */}
                        <TableCell
                          className={`${lineCell} text-muted-foreground`}
                          title={row.hindrances}
                        >
                          {row.hindrances.replace(/\s*\n+\s*/g, " · ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </DprPageShell>
  );
}
