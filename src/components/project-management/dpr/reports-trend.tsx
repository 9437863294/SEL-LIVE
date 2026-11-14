"use client";

/**
 * Plan vs actual, from the user's mock-up (`sel-dpr-reports-colour`): four figures — planned for
 * the period, planned up to today, actual so far, the gap — then the bars bucket by bucket with the
 * elapsed part shaded and today marked, and one finding under them.
 *
 * Every figure is a share of the period's whole plan (value-weighted when every planned line has a
 * BOQ rate, else each line's own percentage averaged), so lines in Cum and Nos are never added.
 * The figures to date are read off a day-by-day trend of the same range, so a weekly or monthly
 * chart still gives an exact "up to today".
 *
 * Colours: planned indigo and actual green, checked with the dataviz validator in both modes
 * (light #4f46e5 / #059669, dark #6366f1 / #1fa87c); each bar fades from a lighter step at its top.
 */

import { useMemo } from "react";
import { CalendarDays, CheckCircle2, LineChart as LineChartIcon, Target, TrendingDown } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DprPeriodType } from "@/lib/project-management-dpr";
import { dprShortDate, type DprAchievementBasis, type DprShareBucket } from "@/lib/project-management-dpr-plan";
import { formatPct } from "@/components/project-management/dpr/dpr-shell";
import {
  DprFigureRow,
  DprFigureTile,
  DprReportCallout,
  DprReportCard,
  DprReportZero,
} from "@/components/project-management/dpr/reports-parts";
import { useTheme } from "@/components/theme/ThemeProvider";
import { InfoTip } from "@/components/shared/info-tip";
import { chartChrome } from "@/components/ui/chart";

const COLOURS = {
  light: { planned: ["#818cf8", "#4f46e5"], actual: ["#34d399", "#059669"], today: "#e11d48", elapsed: "#7c3aed" },
  dark: { planned: ["#818cf8", "#6366f1"], actual: ["#34d399", "#1fa87c"], today: "#fb7185", elapsed: "#a78bfa" },
} as const;

const pts = (value: number) => `${Math.round(Math.abs(value) * 10) / 10} pts`;
const BY = { Day: "day by day", Week: "week by week", Month: "month by month" } as const;

/** "on 12 Nov", "on 10 Nov, 12 Nov", or "over 6 days". */
const daysText = (dates: readonly string[]) =>
  dates.length === 0 ? "nothing recorded yet" : dates.length <= 3 ? `on ${dates.map(dprShortDate).join(", ")}` : `over ${dates.length} days`;

export function DprTrendView({
  points,
  daily,
  basis,
  granularity,
  range,
  today,
  periodNoun,
}: {
  /** The chart's buckets, at the picker's granularity. */
  points: readonly DprShareBucket[];
  /** The same range, day by day — for the figures to date. */
  daily: readonly DprShareBucket[];
  basis: DprAchievementBasis;
  granularity: DprPeriodType;
  range: { startDate: string; endDate: string };
  today: string;
  periodNoun: string;
}) {
  const { resolvedMode } = useTheme();
  const colours = COLOURS[resolvedMode === "dark" ? "dark" : "light"];

  const figures = useMemo(() => {
    const cutoff = today < range.endDate ? today : range.endDate;
    const toDate = daily.filter((point) => point.bucketStart <= cutoff);
    const plannedTotal = daily.reduce((sum, point) => sum + point.plannedPct, 0);
    const plannedToDate = toDate.reduce((sum, point) => sum + point.plannedPct, 0);
    const actualToDate = toDate.reduce((sum, point) => sum + point.actualPct, 0);
    return {
      cutoff,
      started: today >= range.startDate,
      plannedTotal,
      plannedDays: daily.filter((point) => point.plannedPct > 0).length,
      plannedToDate,
      plannedDaysToDate: toDate.filter((point) => point.plannedPct > 0).length,
      actualToDate,
      actualDates: toDate.filter((point) => point.actualPct > 0).map((point) => point.bucketStart),
      gap: plannedToDate - actualToDate,
    };
  }, [daily, range.startDate, range.endDate, today]);

  /** The bucket today falls in, for the marker and the shaded elapsed stretch. */
  const todayBucket = useMemo(() => {
    if (today < range.startDate) return null;
    const inside = points.filter((point) => point.bucketStart <= today);
    return inside.length > 0 ? inside[inside.length - 1] : null;
  }, [points, range.startDate, today]);
  const ended = today > range.endDate;

  // No buckets, or buckets that are all zero: nothing is planned, so there is nothing to read
  // the actuals against — not "on plan".
  if (points.length === 0 || !(figures.plannedTotal > 0)) {
    return (
      <DprReportCard icon={LineChartIcon} colours={["#a5b4fc", "#4f46e5"]} title="Plan vs actual">
        <DprReportZero
          icon={LineChartIcon}
          colours={["#a5b4fc", "#4f46e5"]}
          glow={["rgba(165, 180, 252, 0.6)", "rgba(110, 231, 183, 0.45)"]}
          title="Nothing planned in this period"
          text="The chart reads actuals against the period plan, so it needs a projection covering the period."
        />
      </DprReportCard>
    );
  }

  const cutoffLabel = dprShortDate(figures.cutoff);
  const behind = figures.gap > 0.05;
  const basisText = basis === "value" ? "weighted by BOQ value" : "averaged across each line’s own percentage";

  return (
    <div className="space-y-4">
      <DprFigureRow>
        <DprFigureTile
          icon={LineChartIcon}
          colours={["#a5b4fc", "#4f46e5"]}
          label={`Planned for the ${periodNoun}`}
          value={formatPct(figures.plannedTotal)}
          detail={`spread over ${figures.plannedDays} working day${figures.plannedDays === 1 ? "" : "s"}`}
        />
        <DprFigureTile
          icon={CalendarDays}
          colours={["#93c5fd", "#2563eb"]}
          label={figures.started ? `Planned up to ${cutoffLabel}` : "Planned so far"}
          value={formatPct(figures.started ? figures.plannedToDate : 0)}
          detail={figures.started ? "of the period plan" : "this period has not started"}
        />
        <DprFigureTile
          icon={CheckCircle2}
          colours={["#6ee7b7", "#059669"]}
          label="Actual so far"
          value={formatPct(figures.actualToDate)}
          valueClassName="text-emerald-600"
          detail={daysText(figures.actualDates)}
        />
        <DprFigureTile
          icon={behind ? TrendingDown : Target}
          colours={["#fda4af", "#e11d48"]}
          label={behind ? `Gap to plan at ${cutoffLabel}` : `Against plan at ${cutoffLabel}`}
          alert={behind ? "danger" : undefined}
          value={behind ? pts(figures.gap) : figures.gap < -0.05 ? `+${pts(figures.gap)}` : "On plan"}
          valueClassName={behind ? undefined : "text-emerald-600"}
          detail={`${formatPct(figures.actualToDate)} done vs ${formatPct(figures.plannedToDate)} planned`}
        />
      </DprFigureRow>

      <DprReportCard
        icon={LineChartIcon}
        colours={["#a5b4fc", "#4f46e5"]}
        title={`Plan vs actual — ${BY[granularity as keyof typeof BY] ?? "by period"}`}
        subtitle={`Each ${granularity.toLowerCase()} as a share of the period plan, ${basisText}.`}
        aside={
          <span className="flex flex-wrap items-center gap-3.5 text-xs font-bold text-muted-foreground">
            <Swatch gradient={colours.planned} label="Planned" />
            <Swatch gradient={colours.actual} label="Actual" />
            {!ended && todayBucket ? (
              <span className="flex items-center gap-1.5">
                <i className="h-0.5 w-2.5" style={{ backgroundColor: colours.today }} aria-hidden="true" />
                Today
              </span>
            ) : null}
            <InfoTip label="About this chart">
              A bar is that {granularity.toLowerCase()}’s planned or actual quantity as a percentage of
              everything planned for the whole period, line by line, so lines in different units are
              never added together. When every planned line has a BOQ rate the lines are weighted by
              value; otherwise each line counts equally. The planned bars add up to 100% across the
              period.
            </InfoTip>
          </span>
        }
      >
        <div className="h-80 w-full px-2 pb-2 pt-3 sm:px-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points as DprShareBucket[]} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barGap={3}>
              <defs>
                <linearGradient id="dpr-trend-planned" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={colours.planned[0]} />
                  <stop offset="1" stopColor={colours.planned[1]} />
                </linearGradient>
                <linearGradient id="dpr-trend-actual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={colours.actual[0]} />
                  <stop offset="1" stopColor={colours.actual[1]} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
              {todayBucket ? (
                <ReferenceArea
                  x1={points[0].label}
                  x2={todayBucket.label}
                  fill={colours.elapsed}
                  fillOpacity={0.07}
                  ifOverflow="extendDomain"
                  label={{ value: "Elapsed", position: "insideTop", fill: colours.elapsed, fontSize: 11, fontWeight: 700 }}
                />
              ) : null}
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
                width={44}
                tickFormatter={(value: number) => `${Math.round(value)}%`}
              />
              <Tooltip
                cursor={chartChrome.cursor}
                {...chartChrome.tooltip}
                formatter={(value: number | string, name: string) => [`${formatPct(Number(value))} of period plan`, name]}
              />
              {todayBucket && !ended ? (
                <ReferenceLine
                  x={todayBucket.label}
                  stroke={colours.today}
                  strokeDasharray="4 3"
                  label={{ value: dprShortDate(today), position: "insideTopRight", fill: colours.today, fontSize: 11, fontWeight: 700 }}
                />
              ) : null}
              <Bar name="Planned" dataKey="plannedPct" fill="url(#dpr-trend-planned)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar name="Actual" dataKey="actualPct" fill="url(#dpr-trend-actual)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="px-4 pb-4 sm:px-5">
          <TrendFinding figures={figures} periodNoun={periodNoun} cutoffLabel={cutoffLabel} />
        </div>
      </DprReportCard>
    </div>
  );
}

function Swatch({ gradient, label }: { gradient: readonly [string, string]; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i
        className="h-2.5 w-2.5 rounded-[3px]"
        style={{ backgroundImage: `linear-gradient(${gradient[0]}, ${gradient[1]})` }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/** The one thing the bars say, in words. */
function TrendFinding({
  figures,
  periodNoun,
  cutoffLabel,
}: {
  figures: {
    started: boolean;
    plannedDaysToDate: number;
    actualDates: string[];
    gap: number;
    actualToDate: number;
    plannedToDate: number;
  };
  periodNoun: string;
  cutoffLabel: string;
}) {
  if (!figures.started || figures.plannedDaysToDate === 0) return null;
  const actualDays = figures.actualDates.length;
  if (actualDays === 0) {
    return (
      <DprReportCallout tone="warning" title={`No progress recorded against the plan up to ${cutoffLabel}`}>
        Work is planned on {figures.plannedDaysToDate} day{figures.plannedDaysToDate === 1 ? "" : "s"} so far this{" "}
        {periodNoun}, and no actual progress is recorded yet.
      </DprReportCallout>
    );
  }
  if (actualDays < figures.plannedDaysToDate) {
    return (
      <DprReportCallout
        tone="warning"
        title={
          actualDays === 1
            ? `Only one day of actual progress in the ${periodNoun}`
            : `Progress on ${actualDays} of ${figures.plannedDaysToDate} planned days so far`
        }
      >
        Work is planned on {figures.plannedDaysToDate} day{figures.plannedDaysToDate === 1 ? "" : "s"} up to{" "}
        {cutoffLabel}, but progress was recorded {daysText(figures.actualDates)}
        {figures.gap > 0.05 ? `, ${pts(figures.gap)} behind the plan.` : "."}
      </DprReportCallout>
    );
  }
  return figures.gap > 0.05 ? (
    <DprReportCallout tone="warning" title={`${pts(figures.gap)} behind the plan at ${cutoffLabel}`}>
      Progress is recorded on every planned day, but {formatPct(figures.actualToDate)} is done against{" "}
      {formatPct(figures.plannedToDate)} planned.
    </DprReportCallout>
  ) : (
    <DprReportCallout tone="success" title={`On plan at ${cutoffLabel}`}>
      {formatPct(figures.actualToDate)} done against {formatPct(figures.plannedToDate)} planned, with progress on
      every planned day.
    </DprReportCallout>
  );
}
