'use client';

/**
 * Charts for Billing Recon › Subcontractors.
 *
 * Two series at most: work order value takes categorical slot 1 (blue) and billed takes slot 3
 * (aqua) — billed is aqua on every Billing Recon chart. The pair is validated in both modes (light:
 * worst adjacent CVD ΔE 23.1; dark: 19.6). Aqua sits below 3:1 on the light surface, so the billed
 * bars carry their figure as a label and every value is also in the tables beside the charts.
 */

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, CalendarDays } from 'lucide-react';
import { chartChrome } from '@/components/ui/chart';
import { useTheme } from '@/components/theme/ThemeProvider';
import {
  ChartLegend,
  ChartPanel,
  EmptyChart,
  TooltipBox,
  compactInr,
  formatInr,
  monthLabel,
} from '@/components/billing-recon/dashboard/br-charts';
import type { MonthValue, SubcontractorRow } from '@/lib/subcontractors-dashboard';

const SERIES = {
  light: { ordered: '#2a78d6', billed: '#1baf7a' },
  dark: { ordered: '#3987e5', billed: '#199e70' },
} as const;

function useSeries() {
  const { resolvedMode } = useTheme();
  return SERIES[resolvedMode === 'dark' ? 'dark' : 'light'];
}

const MAX_ROWS = 10;

/** Per subcontractor: work order value and the work billed against it. */
export function SubcontractorValueChart({ rows }: { rows: SubcontractorRow[] }) {
  const series = useSeries();
  const shown = rows.filter((r) => r.workOrderValue > 0 || r.billedValue > 0).slice(0, MAX_ROWS);
  const data = shown.map((r) => ({ ...r, short: r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name }));
  const height = Math.max(180, data.length * 56 + 40);
  const more = rows.length - shown.length;
  return (
    <ChartPanel
      title="Billed against work orders"
      description={`Work billed (before GST) beside each subcontractor's work order value${more > 0 ? ` — the ${MAX_ROWS} largest` : ''}.`}
      icon={BarChart3}
      tone="cyan"
      legend={
        <ChartLegend
          items={[
            { label: 'Work order value', color: series.ordered },
            { label: 'Billed', color: series.billed },
          ]}
        />
      }
    >
      {data.length === 0 ? (
        <EmptyChart height={180}>No work order or bill on this project yet.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }} barCategoryGap={12} barGap={2}>
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" stroke={chartChrome.axis} fontSize={11} tickLine={false} tickFormatter={(v) => compactInr(Number(v))} />
            <YAxis type="category" dataKey="short" stroke={chartChrome.axis} fontSize={11} tickLine={false} width={124} />
            <Tooltip
              cursor={chartChrome.cursor}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!row) return null;
                return (
                  <TooltipBox
                    title={row.name}
                    rows={[
                      { label: 'Work order value', value: formatInr(row.workOrderValue), color: series.ordered },
                      { label: 'Billed', value: formatInr(row.billedValue), color: series.billed },
                      { label: 'Billed share', value: row.billedPercent === null ? '—' : `${row.billedPercent}%` },
                      { label: 'Left to bill', value: formatInr(row.balanceToBill), strong: true },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="workOrderValue" fill={series.ordered} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            <Bar dataKey="billedValue" fill={series.billed} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="billedValue" position="right" fontSize={10} fill={chartChrome.axis} formatter={(v: number) => compactInr(Number(v))} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}

/** Net payable billed to subcontractors per month (one series; advances shown in the tooltip). */
export function MonthlyBillingChart({ points }: { points: MonthValue[] }) {
  const series = useSeries();
  const hasData = points.some((p) => p.billed || p.advance);
  // Selective labels: the busiest month and the latest month with billing, not every bar.
  const peak = points.reduce((best, p, i) => (p.billed > (points[best]?.billed ?? 0) ? i : best), 0);
  const latest = points.map((p) => p.billed > 0).lastIndexOf(true);
  const data = points.map((p, i) => ({
    ...p,
    label: monthLabel(p.month),
    valueLabel: p.billed > 0 && (i === peak || i === latest) ? compactInr(p.billed) : '',
  }));
  return (
    <ChartPanel
      title="Billed each month"
      description="Net payable of subcontractor bills by bill date, last 12 months."
      icon={CalendarDays}
      tone="teal"
    >
      {!hasData ? (
        <EmptyChart height={240}>No subcontractor bill in the last 12 months.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 4 }} barCategoryGap="22%">
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} interval="preserveStartEnd" />
            <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} width={64} tickFormatter={(v) => compactInr(Number(v))} />
            <Tooltip
              cursor={chartChrome.cursor}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!row) return null;
                return (
                  <TooltipBox
                    title={row.label}
                    rows={[
                      { label: 'Billed (net payable)', value: formatInr(row.billed), color: series.billed, strong: true },
                      { label: 'Advances (proforma)', value: formatInr(row.advance) },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="billed" fill={series.billed} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="valueLabel" position="top" fontSize={10} fill={chartChrome.axis} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}
