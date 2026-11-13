"use client";

/**
 * The Daily Progress dashboard's charts.
 *
 * Colour, and why it is hard-coded: the planned/actual pair is the validated categorical blue and
 * teal (`src/components/office-hub/charts.tsx`), re-stepped for the dark surface — checked with the
 * dataviz palette validator in both modes. Light teal sits under 3:1 against the card and dark
 * teal/blue sit in the 6–8 tritan floor band, so neither colour works alone: the planned line is
 * dashed, every chart has a legend or a title naming its one series, and the board table below is
 * the table view of the same figures. Status colours (on plan / behind) are the reserved status
 * steps and always travel with a label. No chart has a second y-axis: headcount and lost hours are
 * two charts sharing one x-axis.
 *
 * Nothing here sums quantities across BOQ lines — every multi-line series is a share of each
 * line's own plan.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DprCurvePoint, DprLineStatus } from "@/lib/project-management-dpr-plan";
import type { DprDiaryDay, DprLineAchievementBar } from "@/lib/project-management-dpr-dashboard";
import { useTheme } from "@/components/theme/ThemeProvider";
import { SectionHeader } from "@/components/shared/page-header";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { Card, CardContent } from "@/components/ui/card";
import { chartChrome } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

/* ── Palette ────────────────────────────────────────────────────────────────────────────────── */

const SERIES = {
  light: { planned: "#2662d9", actual: "#2eb88a", headcount: "#2662d9", lost: "#e88c30" },
  dark: { planned: "#3b76e3", actual: "#1fa87c", headcount: "#3b76e3", lost: "#c96f18" },
} as const;

/** Reserved status steps — never a series colour, always beside a label. Mode-invariant. */
export const DPR_STATUS_COLOURS = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
} as const;

/** The neutral for "not expected" cells, per mode. */
const NEUTRAL = { light: "#cbd5e1", dark: "#3f3f46" } as const;

export function useDprChartPalette() {
  const { resolvedMode } = useTheme();
  const mode = resolvedMode === "dark" ? "dark" : "light";
  return { ...SERIES[mode], neutral: NEUTRAL[mode], mode };
}

const pctText = (value: number) => `${Math.round(value * 10) / 10}%`;
const AXIS_TICK = { fontSize: 11, fill: chartChrome.axis };

/** A domain to 100% at least, rounded up to the next quarter beyond it. */
const pctDomainMax = (values: number[]): number =>
  Math.max(100, Math.ceil(Math.max(0, ...values) / 25) * 25);

/* ── Frame ──────────────────────────────────────────────────────────────────────────────────── */

/** One dashboard panel: a titled card whose explanation sits behind an (i). */
export function DprDashboardCard({
  title,
  info,
  icon,
  actions,
  children,
  className,
}: {
  title: string;
  info?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0 border-border/60", className)}>
      <CardContent className="space-y-3 p-4">
        <SectionHeader
          title={title}
          description={info}
          descriptionAs="info"
          icon={icon}
          actions={actions}
        />
        {children}
      </CardContent>
    </Card>
  );
}

/* ── Cumulative S-curve ─────────────────────────────────────────────────────────────────────── */

export function DprSCurveChart({
  curve,
  todayLabel,
}: {
  curve: DprCurvePoint[];
  todayLabel: string | null;
}) {
  const palette = useDprChartPalette();
  const max = pctDomainMax(curve.flatMap((point) => [point.plannedPct, point.actualPct ?? 0]));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={curve} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            stroke={chartChrome.axis}
            tick={AXIS_TICK}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            stroke={chartChrome.axis}
            tick={AXIS_TICK}
            width={44}
            domain={[0, max]}
            tickFormatter={(value: number) => `${Math.round(value)}%`}
          />
          <Tooltip
            cursor={{ stroke: chartChrome.grid }}
            {...chartChrome.tooltip}
            formatter={(value: number | string) => pctText(Number(value))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {todayLabel ? (
            <ReferenceLine
              x={todayLabel}
              stroke={chartChrome.axis}
              strokeDasharray="4 4"
              label={{ value: "today", position: "insideTopRight", fill: chartChrome.axis, fontSize: 11 }}
            />
          ) : null}
          <Line
            type="linear"
            name="Planned"
            dataKey="plannedPct"
            stroke={palette.planned}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="stepAfter"
            name="Actual"
            dataKey="actualPct"
            stroke={palette.actual}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: chartChrome.surface, strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Per-bucket shares ──────────────────────────────────────────────────────────────────────── */

export interface DprShareBar {
  label: string;
  plannedPct: number;
  /** null for a bucket that has not started — nothing could have been done yet. */
  actualPct: number | null;
}

export function DprShareBarsChart({ data }: { data: DprShareBar[] }) {
  const palette = useDprChartPalette();
  const max = Math.max(
    10,
    Math.ceil(Math.max(0, ...data.flatMap((bar) => [bar.plannedPct, bar.actualPct ?? 0])) / 5) * 5,
  );
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            stroke={chartChrome.axis}
            tick={AXIS_TICK}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            stroke={chartChrome.axis}
            tick={AXIS_TICK}
            width={44}
            domain={[0, max]}
            tickFormatter={(value: number) => `${Math.round(value)}%`}
          />
          <Tooltip
            cursor={chartChrome.cursor}
            {...chartChrome.tooltip}
            formatter={(value: number | string) => pctText(Number(value))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            name="Planned"
            dataKey="plannedPct"
            fill={palette.planned}
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
            isAnimationActive={false}
          />
          <Bar
            name="Actual"
            dataKey="actualPct"
            fill={palette.actual}
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Achievement by line ────────────────────────────────────────────────────────────────────── */

const BAR_STATUS: Partial<Record<DprLineStatus, { colour: string; label: string }>> = {
  behind: { colour: DPR_STATUS_COLOURS.critical, label: "Behind" },
  "on-plan": { colour: DPR_STATUS_COLOURS.good, label: "On plan" },
};

function LineBarTooltip({
  active,
  payload,
  formatQty,
}: {
  active?: boolean;
  payload?: Array<{ payload: DprLineAchievementBar }>;
  formatQty: (value: number, unit: string) => string;
}) {
  const bar = active ? payload?.[0]?.payload : undefined;
  if (!bar) return null;
  const slNo = bar.boqSlNo;
  return (
    <div
      className="max-w-xs rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
    >
      <div>
        <span className="text-muted-foreground">SL No </span>
        <span className="font-semibold tabular-nums">{slNo || "—"}</span>
      </div>
      <div className="line-clamp-2">
        <span className="text-muted-foreground">Description </span>
        {bar.description || "—"}
      </div>
      <div className="mt-1 tabular-nums">
        {formatQty(bar.actual, bar.unit)} of {formatQty(bar.planToDate, bar.unit)} {bar.unit} due ·{" "}
        {pctText(bar.pct)}
      </div>
      <div className="font-medium">{BAR_STATUS[bar.status]?.label ?? ""}</div>
    </div>
  );
}

export function DprLineAchievementChart({
  bars,
  formatQty,
}: {
  bars: DprLineAchievementBar[];
  formatQty: (value: number, unit: string) => string;
}) {
  if (bars.length === 0) {
    return (
      <PmEmptyState
        title="No line is due yet in this period"
        description="Bars appear once a projection's days have started."
      />
    );
  }
  const max = pctDomainMax(bars.map((bar) => bar.pct));
  return (
    <div className="space-y-2">
      <div style={{ height: 32 + bars.length * 30 }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={bars}
            layout="vertical"
            margin={{ top: 4, right: 48, bottom: 4, left: 0 }}
            barCategoryGap={6}
          >
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, max]}
              stroke={chartChrome.axis}
              tick={AXIS_TICK}
              tickFormatter={(value: number) => `${Math.round(value)}%`}
            />
            <YAxis
              type="category"
              dataKey="label"
              stroke={chartChrome.axis}
              tick={AXIS_TICK}
              width={64}
              interval={0}
            />
            <Tooltip cursor={chartChrome.cursor} content={<LineBarTooltip formatQty={formatQty} />} />
            <ReferenceLine x={100} stroke={chartChrome.axis} strokeDasharray="4 4" />
            <Bar dataKey="pct" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
              {bars.map((bar) => (
                <Cell key={bar.id} fill={BAR_STATUS[bar.status]?.colour ?? DPR_STATUS_COLOURS.good} />
              ))}
              <LabelList
                dataKey="pct"
                position="right"
                formatter={(value: number) => pctText(value)}
                style={{ fontSize: 11, fill: chartChrome.axis }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {Object.values(BAR_STATUS).map((status) => (
          <span key={status!.label} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: status!.colour }}
              aria-hidden="true"
            />
            {status!.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 border-l border-dashed border-muted-foreground" aria-hidden="true" />
          100% of plan to date
        </span>
      </div>
    </div>
  );
}

/* ── Site diary ─────────────────────────────────────────────────────────────────────────────── */

function DiaryBars({
  data,
  dataKey,
  name,
  colour,
  height,
  unit,
}: {
  data: DprDiaryDay[];
  dataKey: "headcount" | "lostHours";
  name: string;
  colour: string;
  height: number;
  unit: string;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            stroke={chartChrome.axis}
            tick={AXIS_TICK}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis stroke={chartChrome.axis} tick={AXIS_TICK} width={44} allowDecimals={false} />
          <Tooltip
            cursor={chartChrome.cursor}
            {...chartChrome.tooltip}
            formatter={(value: number | string) => [`${Math.round(Number(value) * 10) / 10} ${unit}`, name]}
          />
          <Bar
            dataKey={dataKey}
            name={name}
            fill={colour}
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Headcount and lost time per day: two charts on one x-axis, never one chart with two scales. */
export function DprDiaryCharts({ days }: { days: DprDiaryDay[] }) {
  const palette = useDprChartPalette();
  if (!days.some((day) => day.reported)) {
    return (
      <PmEmptyState
        title="No sheet submitted in this period yet"
        description="Headcount and lost time come from the submitted daily sheets."
      />
    );
  }
  const anyLost = days.some((day) => day.lostHours > 0);
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Headcount on site</p>
        <DiaryBars
          data={days}
          dataKey="headcount"
          name="Headcount"
          colour={palette.headcount}
          height={170}
          unit="people"
        />
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Time lost (hours)</p>
        {anyLost ? (
          <DiaryBars
            data={days}
            dataKey="lostHours"
            name="Time lost"
            colour={palette.lost}
            height={120}
            unit="hrs"
          />
        ) : (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            No time lost on any submitted day.
          </p>
        )}
      </div>
    </div>
  );
}
