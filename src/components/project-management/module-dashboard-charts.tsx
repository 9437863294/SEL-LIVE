"use client";

/**
 * The two charts a module dashboard carries: how many records were raised each month, and how much
 * they came to.
 *
 * They are two charts over one x-axis rather than one chart with two y-axes: a count and a total
 * are different quantities, and putting them on one pair of axes would invite reading a crossing
 * point that means nothing. That is the same rule the Daily Progress charts follow.
 *
 * What each module supplies is the wording and the formatter — JMC plots certified value in
 * rupees, MVAC plots accepted quantity — so the two keep their own vocabulary without a second
 * copy of the chart setup.
 *
 * Colour is the validated categorical blue and teal used by the other dashboards here, re-stepped
 * for the dark surface. The `--chart-N` tokens are deliberately not used: they are defined for the
 * dark theme only and come out invisible against the light default.
 */

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { chartChrome } from "@/components/ui/chart";
import { useTheme } from "@/components/theme/ThemeProvider";

const SERIES = {
  light: { count: "#2662d9", value: "#2eb88a" },
  dark: { count: "#3b76e3", value: "#1fa87c" },
} as const;

const AXIS_TICK = { fontSize: 11, fill: chartChrome.axis };

/** One month of the series, in the shape both charts read. */
export interface ModuleTrendMonth {
  key: string;
  label: string;
  /** How many were raised. */
  count: number;
  /** What they came to — money, quantity, whatever the module measures. */
  value: number;
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <p className="mb-2 text-sm font-extrabold">{title}</p>
        <div className="h-[200px] w-full">{children}</div>
      </CardContent>
    </Card>
  );
}

function EmptyChart({ note }: { note: string }) {
  return (
    <div className="grid h-full place-items-center text-center text-sm font-semibold text-muted-foreground">
      {note}
    </div>
  );
}

export function ModuleTrendCharts({
  months,
  countTitle,
  countLabel,
  countEmpty,
  valueTitle,
  valueLabel,
  valueEmpty,
  formatValue,
}: {
  months: readonly ModuleTrendMonth[];
  countTitle: string;
  /** What the tooltip calls the bar. */
  countLabel: string;
  countEmpty: string;
  valueTitle: string;
  valueLabel: string;
  valueEmpty: string;
  formatValue: (value: number) => string;
}) {
  const { resolvedMode } = useTheme();
  const palette = SERIES[resolvedMode === "dark" ? "dark" : "light"];
  const data = months.map((month) => ({ ...month }));

  const anyCount = data.some((month) => month.count > 0);
  const anyValue = data.some((month) => month.value > 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard title={countTitle}>
        {anyCount ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={chartChrome.grid} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} stroke={chartChrome.axis} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} stroke={chartChrome.axis} />
              <Tooltip
                cursor={chartChrome.cursor}
                {...chartChrome.tooltip}
                formatter={(value: number) => [String(value), countLabel]}
              />
              <Bar dataKey="count" fill={palette.count} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart note={countEmpty} />
        )}
      </ChartCard>

      <ChartCard title={valueTitle}>
        {anyValue ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={chartChrome.grid} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} stroke={chartChrome.axis} />
              <YAxis
                tick={AXIS_TICK}
                stroke={chartChrome.axis}
                width={64}
                tickFormatter={formatValue}
              />
              <Tooltip
                cursor={chartChrome.cursor}
                {...chartChrome.tooltip}
                formatter={(value: number) => [formatValue(value), valueLabel]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={palette.value}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart note={valueEmpty} />
        )}
      </ChartCard>
    </div>
  );
}
