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
  Truck,
  Users,
} from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DPR_PERMISSION_RESOURCE,
  buildDprEquipmentSummary,
  buildDprHindrances,
  buildDprLostTime,
  buildDprPeriodReport,
  dprToCsv,
  type DprPeriodRow,
  type DprScope,
} from "@/lib/project-management-dpr";
import {
  buildDprShareTrend,
  dprCalendar,
  dprShortDate,
  isValidRange,
} from "@/lib/project-management-dpr-plan";
import {
  buildDprManpowerReport,
  dprProgressDates,
  dprTradeOrder,
} from "@/lib/project-management-dpr-reports";
import { DprReportsHero, type DprReportTab } from "@/components/project-management/dpr/reports-hero";
import { DprManpowerView } from "@/components/project-management/dpr/reports-manpower";
import { DprBoqProgressView } from "@/components/project-management/dpr/reports-boq-progress";
import { DprTrendView } from "@/components/project-management/dpr/reports-trend";
import { DprDelaysView, DprPlantView } from "@/components/project-management/dpr/reports-plant-delays";
import {
  arrangeByBreakdown,
  type DprBreakdownNode,
} from "@/lib/project-management-dpr-breakdown";
import { cn } from "@/lib/utils";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DPR_FIELD_ACCENTS,
  DPR_TABS,
  DprAccessDenied,
  DprFieldLabel,
  DprLoadingState,
  DprPageShell,
  DprPeriodPicker,
  DprProjectNotFound,
  DprScopeTabs,
  defaultPeriodSelection,
  formatDisplayDate,
  formatPct,
  formatQtyAt,
  formatRangeCompact,
  resolvePeriodRange,
  resolveTrendGranularity,
  todayIso,
  type DprPeriodSelection,
} from "@/components/project-management/dpr/dpr-shell";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ViewId = "progress" | "trend" | "manpower" | "equipment" | "delays";

/** The five reports, as tabs in the headline band, each with the mock-up's chip colours. */
const VIEWS: readonly DprReportTab<ViewId>[] = [
  { id: "progress", label: "BOQ progress", icon: Activity, colours: ["#6ee7b7", "#059669"] },
  { id: "trend", label: "Plan vs actual", icon: LineChartIcon, colours: ["#93c5fd", "#2563eb"] },
  { id: "manpower", label: "Manpower", icon: Users, colours: ["#c4b5fd", "#7c3aed"] },
  { id: "equipment", label: "Plant", icon: Truck, colours: ["#fcd34d", "#d97706"] },
  { id: "delays", label: "Delays", icon: CloudSun, colours: ["#fda4af", "#e11d48"] },
];

const REPORTS_TAB = DPR_TABS.find((tab) => tab.key === "reports")!;

const PERIOD_WORDS = {
  Day: { choice: "daily", noun: "day" },
  Week: { choice: "weekly", noun: "week" },
  Month: { choice: "monthly", noun: "month" },
  Custom: { choice: "custom range", noun: "period" },
} as const;

/** The table furniture every view shares: bounded height, pinned header, fixed columns. */
const TABLE_PROPS = { stickyHeader: true, containerClassName: "max-h-[65vh]" } as const;

/** A single-line text cell: cut short with an ellipsis, the whole value on hover. */
const lineCell = "truncate text-sm";
const numberCell = "truncate text-right text-sm tabular-nums";

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

  /** Counted per date, so two scopes on one day are one day for a trade. */
  const manpower = useMemo(
    () =>
      buildDprManpowerReport(entries, {
        scope: scopeFilter,
        range,
        calendar: dprCalendar(settings),
        today: todayIso(),
      }),
    [entries, scopeFilter, range, settings],
  );
  /** Read over the whole register, so a trade keeps its colour whatever the period or scope. */
  const tradeOrder = useMemo(() => dprTradeOrder(entries, settings.trades), [entries, settings.trades]);

  const today = todayIso();
  /** The same range day by day, so the figures "up to today" are exact at any chart granularity. */
  const dailyTrend = useMemo(
    () =>
      buildDprShareTrend({ items: boqItems, entries, plan, range, periodType: "Day", scope: scopeFilter }),
    [boqItems, entries, plan, range, scopeFilter],
  );
  const calendarDays = useMemo(() => {
    if (!isValidRange(range)) return { working: 0, toDate: 0 };
    const working = dprCalendar(settings).workingDays(range.startDate, range.endDate);
    return { working: working.length, toDate: working.filter((date) => date <= today).length };
  }, [range, settings, today]);
  const progressDays = useMemo(
    () => dprProgressDates(entries, { scope: scopeFilter, range, today }).length,
    [entries, scopeFilter, range, today],
  );
  const pathById = useMemo(() => new Map(boqItems.map((item) => [item.id, item.path ?? ""])), [boqItems]);

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

  const round2 = (value: number) => Math.round(value * 100) / 100;

  /** The open report as CSV: the rows on screen, in the order they are shown. */
  const csvFor = (): { headers: string[]; rows: Array<Array<string | number>> } => {
    if (view === "trend") {
      return {
        headers: [`${granularity} starting`, "Label", "Planned % of period plan", "Actual % of period plan"],
        rows: trend.points.map((point) => [point.bucketStart, point.label, round2(point.plannedPct), round2(point.actualPct)]),
      };
    }
    if (view === "manpower") {
      return {
        headers: ["Trade", "Man-days", "Days", "Peak", "Avg per day", "Share %"],
        rows: [
          ...manpower.rows.map((row) => [
            row.trade,
            round2(row.manDays),
            row.days,
            round2(row.peak),
            round2(row.avgPerDay),
            round2(row.sharePct),
          ]),
          ...(manpower.rows.length > 0 ? [["Total", round2(manpower.totalManDays), "", "", "", 100]] : []),
        ],
      };
    }
    if (view === "equipment") {
      return {
        headers: ["Equipment", "Days", "Running hrs", "Idle hrs", "Utilisation %"],
        rows: equipment.map((row) => [
          row.name,
          row.deployedDays,
          round2(row.runningHours),
          round2(row.idleHours),
          row.utilisationPct === null ? "" : round2(row.utilisationPct),
        ]),
      };
    }
    if (view === "delays") {
      return {
        headers: ["Date", "Scope", "Kind", "Hours lost", "Weather", "Detail"],
        rows: [
          ...lostTime.map((row) => [row.date, row.scope, "Lost time", round2(row.hours), row.weather, row.reason]),
          ...hindrances.map((row) => [row.date, row.scope, "Hindrance", "", "", row.hindrances.replace(/\s*\n+\s*/g, " · ")]),
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      };
    }
    // BOQ progress: leaf lines only (groups are roll-ups of them), each with the lines above it as "Parent".
    return {
      headers: [
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
      rows: report.rows.map((row) => [
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
    };
  };
  const exportRows = csvFor();
  const viewSlug: Record<ViewId, string> = {
    progress: "boq-progress",
    trend: "plan-vs-actual",
    manpower: "manpower",
    equipment: "plant",
    delays: "delays",
  };

  const downloadCsv = () => {
    const csv = dprToCsv(exportRows.headers, exportRows.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName || "project"}-dpr-${viewSlug[view]}-${scope.toLowerCase()}-${range.startDate}-to-${range.endDate}.csv`;
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

  const scopeLabel = scope === "All" ? "All scopes" : scope;
  const periodLabel = isValidRange(range) ? formatRangeCompact(range.startDate, range.endDate) : "—";
  const periodWords = PERIOD_WORDS[period.choice];

  return (
    <DprPageShell>
      <DprReportsHero
        mappingId={mappingId}
        projectName={projectName}
        title={REPORTS_TAB.label}
        description={REPORTS_TAB.description}
        icon={REPORTS_TAB.icon}
        tabs={VIEWS}
        active={view}
        onTabChange={setView}
        actions={
          <Button
            onClick={downloadCsv}
            disabled={exportRows.rows.length === 0}
            className="rounded-xl bg-white font-extrabold text-violet-900 shadow-lg hover:bg-white/90"
          >
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <Card className="rounded-[20px] border-border/60 shadow-sm">
        <CardContent className="p-4">
          {/* Scope and period on one line at one height; it wraps only when narrow. */}
          <div className="flex flex-wrap items-end gap-3.5">
            <div className="space-y-1.5">
              <DprFieldLabel accent={DPR_FIELD_ACCENTS.scope}>Scope</DprFieldLabel>
              <DprScopeTabs value={scope} onChange={setScope} includeAll asField />
            </div>
            <DprPeriodPicker value={period} onChange={setPeriod} settings={settings} inline decorated stepper />
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
        <DprBoqProgressView
          rows={report.rows}
          pathOf={(id) => pathById.get(id) ?? ""}
          decimalsFor={decimalsFor}
          scopeLabel={scopeLabel}
          periodLabel={periodLabel}
          periodChoiceLabel={periodWords.choice}
          periodNoun={periodWords.noun}
          workingDays={calendarDays.working}
          workingDaysToDate={calendarDays.toDate}
          progressDays={progressDays}
          fullDetail={
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
          }
        />
      ) : view === "trend" ? (
        <DprTrendView
          points={trend.points}
          daily={dailyTrend.points}
          basis={trend.basis}
          granularity={granularity}
          range={range}
          today={today}
          periodNoun={periodWords.noun}
        />
      ) : view === "manpower" ? (
        <DprManpowerView
          report={manpower}
          tradeOrder={tradeOrder}
          mappingId={mappingId}
          scope={scope}
          scopeLabel={scopeLabel}
          periodLabel={periodLabel}
          periodChoiceLabel={periodWords.choice}
          periodNoun={periodWords.noun}
        />
      ) : view === "equipment" ? (
        <DprPlantView rows={equipment} subtitle="Machines deployed on the daily sheets, with utilisation" />
      ) : (
        <DprDelaysView lostTime={lostTime} hindrances={hindrances} periodNoun={periodWords.noun} />
      )}
    </DprPageShell>
  );
}
