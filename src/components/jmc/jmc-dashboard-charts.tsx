"use client";

/**
 * The JMC dashboard's two charts.
 *
 * They are two charts over one x-axis rather than one chart with two y-axes: certificates raised is
 * a count and certified value is money, and putting them on one pair of axes would invite reading a
 * crossing point that means nothing. That is the same rule the Daily Progress charts follow.
 *
 * Colour is the validated categorical blue and teal used by the other dashboards here, re-stepped
 * for the dark surface. The `--chart-N` tokens are deliberately not used: they are defined for the
 * dark theme only and come out invisible against the light default.
 */

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
import {
  formatJmcAmount,
  type JmcMonthReading,
} from "@/lib/project-management-jmc-dashboard";

const SERIES = {
  light: { raised: "#2662d9", value: "#2eb88a" },
  dark: { raised: "#3b76e3", value: "#1fa87c" },
} as const;

const AXIS_TICK = { fontSize: 11, fill: chartChrome.axis };

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <p className="mb-2 text-sm font-extrabold">{title}</p>
        <div className="h-[200px] w-full">{children}</div>
      </CardContent>
    </Card>
  );
}

export function JmcDashboardCharts({ months }: { months: readonly JmcMonthReading[] }) {
  const { resolvedMode } = useTheme();
  const palette = SERIES[resolvedMode === "dark" ? "dark" : "light"];
  const data = months.map((month) => ({ ...month }));

  const anyRaised = data.some((month) => month.raised > 0);
  const anyValue = data.some((month) => month.certifiedValue > 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard title="Certificates raised">
        {anyRaised ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={chartChrome.grid} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} stroke={chartChrome.axis} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} stroke={chartChrome.axis} />
              <Tooltip
                cursor={chartChrome.cursor}
                {...chartChrome.tooltip}
                formatter={(value: number) => [String(value), "Raised"]}
              />
              <Bar dataKey="raised" fill={palette.raised} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart note="No certificates raised in the last six months." />
        )}
      </ChartCard>

      <ChartCard title="Certified value">
        {anyValue ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={chartChrome.grid} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} stroke={chartChrome.axis} />
              <YAxis
                tick={AXIS_TICK}
                stroke={chartChrome.axis}
                width={64}
                tickFormatter={(value: number) => formatJmcAmount(value)}
              />
              <Tooltip
                cursor={chartChrome.cursor}
                {...chartChrome.tooltip}
                formatter={(value: number) => [formatJmcAmount(value), "Certified"]}
              />
              <Line
                type="monotone"
                dataKey="certifiedValue"
                stroke={palette.value}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart note="Nothing certified in the last six months." />
        )}
      </ChartCard>
    </div>
  );
}

function EmptyChart({ note }: { note: string }) {
  return (
    <div className="grid h-full place-items-center text-center text-sm font-semibold text-muted-foreground">
      {note}
    </div>
  );
}
