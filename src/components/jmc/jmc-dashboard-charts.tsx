"use client";

/**
 * The JMC dashboard's two charts: certificates raised, and certified value.
 *
 * The chart setup itself is shared (`module-dashboard-charts.tsx`) — MVAC's dashboard plots the
 * same two shapes with quantity in place of money — so this file is only JMC's vocabulary and the
 * mapping from its month reading onto the shared series.
 */

import {
  ModuleTrendCharts,
  type ModuleTrendMonth,
} from "@/components/project-management/module-dashboard-charts";
import {
  formatJmcAmount,
  type JmcMonthReading,
} from "@/lib/project-management-jmc-dashboard";

export function JmcDashboardCharts({ months }: { months: readonly JmcMonthReading[] }) {
  const series: ModuleTrendMonth[] = months.map((month) => ({
    key: month.key,
    label: month.label,
    count: month.raised,
    value: month.certifiedValue,
  }));

  return (
    <ModuleTrendCharts
      months={series}
      countTitle="Certificates raised"
      countLabel="Raised"
      countEmpty="No certificates raised in the last six months."
      valueTitle="Certified value"
      valueLabel="Certified"
      valueEmpty="Nothing certified in the last six months."
      formatValue={formatJmcAmount}
    />
  );
}
