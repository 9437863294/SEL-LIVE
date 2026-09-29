'use client';

import type { ReactNode } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CalendarClock, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { chartChrome } from '@/components/ui/chart';
import { useTheme } from '@/components/theme/ThemeProvider';
import { compactInr, formatInr } from '@/lib/bank-balance-ledger';
import { cn } from '@/lib/utils';

/**
 * Series colours: categorical slots 1–3 of the reference palette, validated as a set in both
 * modes (worst adjacent CVD ΔE 9.2 light / 9.4 dark). Recharts takes them as SVG attributes, which
 * the dark-compat stylesheet cannot reach, so the dark steps are chosen here from the theme.
 *
 * Aqua sits below 3:1 on the light surface; every chart therefore carries its figures in text too
 * (the tooltip, the per-bar percentage, the account cards below) rather than by colour alone.
 */
const SERIES = {
  light: { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a' },
  dark: { blue: '#3987e5', orange: '#d95926', aqua: '#199e70' },
} as const;

function useSeries() {
  const { resolvedMode } = useTheme();
  return SERIES[resolvedMode === 'dark' ? 'dark' : 'light'];
}

export { compactInr, formatInr } from '@/lib/bank-balance-ledger';

function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={
              item.dashed
                ? { background: `repeating-linear-gradient(90deg, ${item.color} 0 3px, transparent 3px 5px)`, height: 3 }
                : { backgroundColor: item.color }
            }
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartPanel({
  title,
  description,
  icon: Icon,
  legend,
  className,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  legend?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('min-w-0 border-white/60 bg-white/80 shadow-sm backdrop-blur-sm', className)}>
      <CardHeader className="space-y-1 p-4 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
              {title}
            </CardTitle>
            {description && <CardDescription className="text-xs">{description}</CardDescription>}
          </div>
          {legend}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">{children}</CardContent>
    </Card>
  );
}

function TooltipBox({ title, rows }: { title: ReactNode; rows: Array<{ label: string; value: string; color?: string; strong?: boolean }> }) {
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

const EmptyChart = ({ children, height }: { children: ReactNode; height: number }) => (
  <div className="flex items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground" style={{ height }}>
    <p className="max-w-xs px-4">{children}</p>
  </div>
);

export interface CcLimitRow {
  id: string;
  name: string;
  limit: number;
  utilised: number;
}

/** One bar per CC account: utilised plus what is left, so the whole bar is the sanctioned limit. */
export function LimitUtilisationChart({ rows }: { rows: CcLimitRow[] }) {
  const series = useSeries();
  const data = rows.map((row) => {
    const utilised = Math.max(0, row.utilised);
    return {
      ...row,
      utilised,
      available: Math.max(0, row.limit - utilised),
      pctLabel: row.limit > 0 ? `${((utilised / row.limit) * 100).toFixed(0)}%` : 'No limit',
    };
  });
  const height = Math.max(160, data.length * 44 + 40);

  return (
    <ChartPanel
      title="Limit vs Utilisation"
      description="Each Cash Credit account's limit (DP + TOD), split into used and available."
      legend={<Legend items={[{ label: 'Utilised', color: series.blue }, { label: 'Available', color: series.aqua }]} />}
    >
      {data.length === 0 ? (
        <EmptyChart height={160}>No active Cash Credit accounts.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} barCategoryGap={10}>
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" stroke={chartChrome.axis} fontSize={11} tickLine={false} tickFormatter={(v) => compactInr(Number(v))} />
            <YAxis type="category" dataKey="name" stroke={chartChrome.axis} fontSize={11} tickLine={false} width={84} />
            <Tooltip
              cursor={chartChrome.cursor}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!row) return null;
                const over = row.utilised > row.limit && row.limit > 0;
                return (
                  <TooltipBox
                    title={row.name}
                    rows={[
                      { label: 'Limit', value: formatInr(row.limit), strong: true },
                      { label: 'Utilised', value: formatInr(row.utilised), color: series.blue },
                      { label: over ? 'Over limit by' : 'Available', value: formatInr(over ? row.utilised - row.limit : row.available), color: over ? undefined : series.aqua },
                      { label: 'Utilisation', value: row.pctLabel },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="utilised" stackId="limit" fill={series.blue} stroke={chartChrome.surface} strokeWidth={2} isAnimationActive={false} />
            <Bar dataKey="available" stackId="limit" fill={series.aqua} stroke={chartChrome.surface} strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="pctLabel" position="right" fontSize={11} fill={chartChrome.axis} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}

export interface UtilisationTrendPoint {
  date: string;
  label: string;
  utilised: number;
  limit: number;
}

/** Total CC utilisation at each day's close against the limit in force that day. */
export function UtilisationTrendChart({ points }: { points: UtilisationTrendPoint[] }) {
  const series = useSeries();
  const hasData = points.some((point) => point.utilised !== 0 || point.limit !== 0);

  return (
    <ChartPanel
      title="Utilisation Trend"
      description="All Cash Credit accounts together, at each day's close — last 30 days."
      legend={<Legend items={[{ label: 'Utilised', color: series.blue }, { label: 'Total limit', color: series.orange, dashed: true }]} />}
    >
      {!hasData ? (
        <EmptyChart height={240}>No Cash Credit activity in the last 30 days.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="bb-util-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={series.blue} stopOpacity={0.22} />
                <stop offset="100%" stopColor={series.blue} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} width={64} tickFormatter={(v) => compactInr(Number(v))} />
            <Tooltip
              cursor={{ stroke: chartChrome.axis, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                const point = active ? (payload?.[0]?.payload as UtilisationTrendPoint | undefined) : undefined;
                if (!point) return null;
                return (
                  <TooltipBox
                    title={point.date}
                    rows={[
                      { label: 'Utilised', value: formatInr(point.utilised), color: series.blue, strong: true },
                      { label: 'Total limit', value: formatInr(point.limit), color: series.orange },
                      { label: 'Utilisation', value: point.limit > 0 ? `${((point.utilised / point.limit) * 100).toFixed(1)}%` : '—' },
                    ]}
                  />
                );
              }}
            />
            <Area type="monotone" dataKey="utilised" stroke={series.blue} strokeWidth={2} fill="url(#bb-util-fill)" dot={false} activeDot={{ r: 4, stroke: chartChrome.surface, strokeWidth: 2 }} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="limit" stroke={series.orange} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4, stroke: chartChrome.surface, strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}

export interface MonthlyFlowPoint {
  month: string;
  receipts: number;
  payments: number;
}

/** Receipts and payments dated after today: left out of the monthly bars and reported under them. */
export interface FlowDatedAhead {
  payments: number;
  paymentCount: number;
  receipts: number;
  receiptCount: number;
}

const entryCount = (n: number) => `${n} entr${n === 1 ? 'y' : 'ies'}`;

/**
 * Money in against money out per month, internal transfers excluded, counting only entries dated
 * up to today. A post-dated cheque's Debit sits on its instrument date, so it must not swell the
 * current month before then; `datedAhead` names what was left out.
 */
export function MonthlyFlowChart({ points, datedAhead }: { points: MonthlyFlowPoint[]; datedAhead?: FlowDatedAhead }) {
  const series = useSeries();
  const hasData = points.some((point) => point.receipts || point.payments);
  const aheadParts = [
    datedAhead?.paymentCount ? `${formatInr(datedAhead.payments)} in post-dated payments (${entryCount(datedAhead.paymentCount)})` : '',
    datedAhead?.receiptCount ? `${formatInr(datedAhead.receipts)} in future-dated receipts (${entryCount(datedAhead.receiptCount)})` : '',
  ].filter(Boolean);

  return (
    <ChartPanel
      title="Receipts vs Payments"
      description="Per month across all accounts, internal transfers excluded — last 6 months, up to today."
      legend={<Legend items={[{ label: 'Receipts', color: series.blue }, { label: 'Payments', color: series.orange }]} />}
    >
      {!hasData ? (
        <EmptyChart height={240}>No receipts or payments in the last 6 months.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" stroke={chartChrome.axis} fontSize={11} tickLine={false} />
            <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} width={64} tickFormatter={(v) => compactInr(Number(v))} />
            <Tooltip
              cursor={chartChrome.cursor}
              content={({ active, payload }) => {
                const point = active ? (payload?.[0]?.payload as MonthlyFlowPoint | undefined) : undefined;
                if (!point) return null;
                const net = point.receipts - point.payments;
                return (
                  <TooltipBox
                    title={point.month}
                    rows={[
                      { label: 'Receipts', value: formatInr(point.receipts), color: series.blue },
                      { label: 'Payments', value: formatInr(point.payments), color: series.orange },
                      { label: 'Net', value: `${net < 0 ? '−' : '+'}${formatInr(Math.abs(net))}`, strong: true },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="receipts" fill={series.blue} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="payments" fill={series.orange} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
      {aheadParts.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <CalendarClock aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{aheadParts.join(' and ')} not included until their date.</span>
        </p>
      )}
    </ChartPanel>
  );
}
