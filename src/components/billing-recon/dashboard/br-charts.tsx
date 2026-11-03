'use client';

/**
 * Billing Recon dashboard charts.
 *
 * Series colours are categorical slots 1–3 of the reference palette (blue, orange, aqua), validated
 * as a set in both modes (worst adjacent CVD ΔE 9.2 light; all checks pass dark). Executed, Certified
 * and Billed always take blue, orange and aqua respectively, on every chart, so the colour means the
 * same thing everywhere. Recharts takes colours as SVG attributes, which the dark-compat stylesheet
 * cannot reach, so the dark steps are picked here from the theme.
 *
 * Aqua sits below 3:1 on the light surface, so every chart also carries its figures as text (the
 * tooltip, value labels, and the tables beside the charts) — never colour alone.
 */

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, GitMerge, TrendingUp, type LucideIcon } from 'lucide-react';
import { AppTile, type BrTone } from '../page-kit';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { chartChrome } from '@/components/ui/chart';
import { useTheme } from '@/components/theme/ThemeProvider';
import { cn } from '@/lib/utils';
import type { MonthPoint, StageCount } from '@/lib/billing-recon/dashboard';

const SERIES = {
  light: { executed: '#2a78d6', certified: '#eb6834', billed: '#1baf7a' },
  dark: { executed: '#3987e5', certified: '#d95926', billed: '#199e70' },
} as const;

export type SeriesColors = { executed: string; certified: string; billed: string };

export function useBrSeries(): SeriesColors {
  const { resolvedMode } = useTheme();
  return SERIES[resolvedMode === 'dark' ? 'dark' : 'light'];
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function formatInr(value: number): string {
  return inr.format(Number(value) || 0);
}

/** ₹1.2 Cr / ₹4.5 L / ₹12 K — Indian units, for axes and tiles. */
export function compactInr(input: number): string {
  const value = Number(input) || 0;
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  const trim = (n: number) => String(Number(n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)));
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)} K`;
  return `${sign}₹${Math.round(abs)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTHS[idx]} ${String(y).slice(2)}` : key;
}

export function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartPanel({
  title,
  description,
  icon,
  tone = 'cyan',
  legend,
  className,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  tone?: BrTone;
  legend?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('min-w-0 rounded-2xl shadow-sm', className)}>
      <CardHeader className="p-4 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <AppTile tone={tone} icon={icon} size={34} />}
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight">{title}</CardTitle>
              {description && <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>}
            </div>
          </div>
          {legend}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">{children}</CardContent>
    </Card>
  );
}

export function TooltipBox({ title, rows }:{ title: ReactNode; rows: Array<{ label: string; value: string; color?: string; strong?: boolean }> }) {
  return (
    <div style={chartChrome.tooltip.contentStyle} className="min-w-[180px] px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-semibold">{title}</p>
      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 opacity-80">
              {row.color && <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: row.color }} />}
              {row.label}
            </span>
            <span className={cn('tabular-nums', row.strong && 'font-semibold')}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyChart({ children, height }: { children: ReactNode; height: number }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground" style={{ height }}>
      <span className="max-w-xs px-4">{children}</span>
    </div>
  );
}

/** Executed, certified and billed value per month — three lines on one ₹ axis. */
export function ValueTrendChart({ points, title = 'Monthly value', description }: { points: MonthPoint[]; title?: string; description?: string }) {
  const series = useBrSeries();
  const hasData = points.some((p) => p.executed || p.certified || p.billed);
  const data = points.map((p) => ({ ...p, label: monthLabel(p.month) }));
  return (
    <ChartPanel
      title={title}
      description={description ?? 'By JMC / MVAC date and bill date, last 12 months.'}
      icon={TrendingUp}
      tone="blue"
      legend={
        <ChartLegend
          items={[
            { label: 'Executed', color: series.executed },
            { label: 'Certified', color: series.certified },
            { label: 'Billed', color: series.billed },
          ]}
        />
      }
    >
      {!hasData ? (
        <EmptyChart height={240}>Nothing measured or billed in the last 12 months.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} interval="preserveStartEnd" />
            <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} width={64} tickFormatter={(v) => compactInr(Number(v))} />
            <Tooltip
              cursor={{ stroke: chartChrome.axis, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!row) return null;
                return (
                  <TooltipBox
                    title={row.label}
                    rows={[
                      { label: 'Executed', value: formatInr(row.executed), color: series.executed },
                      { label: 'Certified', value: formatInr(row.certified), color: series.certified },
                      { label: 'Billed', value: formatInr(row.billed), color: series.billed },
                    ]}
                  />
                );
              }}
            />
            <Line type="monotone" dataKey="executed" stroke={series.executed} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: chartChrome.surface }} activeDot={{ r: 5, strokeWidth: 2, stroke: chartChrome.surface }} isAnimationActive={false} />
            <Line type="monotone" dataKey="certified" stroke={series.certified} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: chartChrome.surface }} activeDot={{ r: 5, strokeWidth: 2, stroke: chartChrome.surface }} isAnimationActive={false} />
            <Line type="monotone" dataKey="billed" stroke={series.billed} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: chartChrome.surface }} activeDot={{ r: 5, strokeWidth: 2, stroke: chartChrome.surface }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}

export interface ProjectValueRow {
  id: string;
  name: string;
  executed: number;
  certified: number;
  billed: number;
}

/** Per project: executed, certified and billed value side by side. */
export function ProjectValueChart({ rows }: { rows: ProjectValueRow[] }) {
  const series = useBrSeries();
  const data = rows.map((r) => ({ ...r, short: r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name }));
  const height = Math.max(180, data.length * 64 + 40);
  return (
    <ChartPanel
      title="Value by project"
      description="Executed, certified and billed — the gaps are what is waiting."
      icon={BarChart3}
      tone="cyan"
      legend={
        <ChartLegend
          items={[
            { label: 'Executed', color: series.executed },
            { label: 'Certified', color: series.certified },
            { label: 'Billed', color: series.billed },
          ]}
        />
      }
    >
      {data.length === 0 ? (
        <EmptyChart height={180}>No project has measured anything yet.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }} barCategoryGap={12} barGap={2}>
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" stroke={chartChrome.axis} fontSize={11} tickLine={false} tickFormatter={(v) => compactInr(Number(v))} />
            <YAxis type="category" dataKey="short" stroke={chartChrome.axis} fontSize={11} tickLine={false} width={120} />
            <Tooltip
              cursor={chartChrome.cursor}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!row) return null;
                return (
                  <TooltipBox
                    title={row.name}
                    rows={[
                      { label: 'Executed', value: formatInr(row.executed), color: series.executed },
                      { label: 'Certified', value: formatInr(row.certified), color: series.certified },
                      { label: 'Billed', value: formatInr(row.billed), color: series.billed },
                      { label: 'Certified, not billed', value: formatInr(Math.max(0, row.certified - row.billed)), strong: true },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="executed" fill={series.executed} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            <Bar dataKey="certified" fill={series.certified} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            <Bar dataKey="billed" fill={series.billed} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="billed" position="right" fontSize={10} fill={chartChrome.axis} formatter={(v: number) => compactInr(Number(v))} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}

/** Open JMC / MVAC entries per workflow stage, stacked by register. */
export function StagePipelineChart({ stages, title = 'Waiting at each stage' }: { stages: StageCount[]; title?: string }) {
  const series = useBrSeries();
  const data = stages.slice(0, 10).map((s) => ({
    ...s,
    total: s.jmc + s.mvac,
    label: `${s.jmc + s.mvac}${s.overdue ? ` · ${s.overdue} overdue` : ''}`,
    short: s.stage.length > 22 ? `${s.stage.slice(0, 21)}…` : s.stage,
  }));
  const height = Math.max(160, data.length * 36 + 40);
  return (
    <ChartPanel
      title={title}
      description="Open entries by the stage they wait at."
      icon={GitMerge}
      tone="orange"
      legend={
        <ChartLegend
          items={[
            { label: 'JMC', color: series.executed },
            { label: 'MVAC', color: series.certified },
          ]}
        />
      }
    >
      {data.length === 0 ? (
        <EmptyChart height={160}>No JMC or MVAC entry is waiting at any stage.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 96, bottom: 4, left: 4 }} barCategoryGap={8}>
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} stroke={chartChrome.axis} fontSize={11} tickLine={false} />
            <YAxis type="category" dataKey="short" stroke={chartChrome.axis} fontSize={11} tickLine={false} width={120} />
            <Tooltip
              cursor={chartChrome.cursor}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!row) return null;
                return (
                  <TooltipBox
                    title={row.stage}
                    rows={[
                      { label: 'JMC', value: String(row.jmc), color: series.executed },
                      { label: 'MVAC', value: String(row.mvac), color: series.certified },
                      { label: 'Overdue', value: String(row.overdue), strong: row.overdue > 0 },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="jmc" stackId="s" fill={series.executed} stroke={chartChrome.surface} strokeWidth={2} isAnimationActive={false} />
            <Bar dataKey="mvac" stackId="s" fill={series.certified} stroke={chartChrome.surface} strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="label" position="right" fontSize={11} fill={chartChrome.axis} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}

/** Executed → certified → billed as three proportional bars against a reference value. */
export function ValueFunnel({ executed, certified, billed, reference, referenceLabel }: { executed: number; certified: number; billed: number; reference?: number; referenceLabel?: string }) {
  const series = useBrSeries();
  const base = Math.max(reference ?? 0, executed, certified, billed, 1);
  const rows = [
    ...(reference ? [{ label: referenceLabel ?? 'BOQ value', value: reference, color: 'hsl(var(--muted-foreground))' }] : []),
    { label: 'Executed', value: executed, color: series.executed },
    { label: 'Certified', value: certified, color: series.certified },
    { label: 'Billed', value: billed, color: series.billed },
  ];
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-semibold tabular-nums text-foreground">{formatInr(row.value)}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (row.value / base) * 100)}%`, backgroundColor: row.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
