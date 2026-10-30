'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { chartChrome } from '@/components/ui/chart';
import { useTheme } from '@/components/theme/ThemeProvider';
import { compactInr, formatInr } from '@/lib/bank-balance-ledger';
import type { MonthPoint, WaitBandKey } from '@/lib/daily-requisition-dashboard';
import { cn } from '@/lib/utils';

/**
 * Colours from the reference palette, chosen for the job each does:
 * - the three workflow stages are identities → categorical slots 1–3 (blue, orange, aqua), which
 *   validate all-pairs in both modes (worst CVD ΔE 9.2 light / 9.4 dark);
 * - received vs paid is two series → slots 1–2; the open amount they leave is a line in the text
 *   colour, so it reads as the total rather than a third series;
 * - how long work has waited is a traffic light that darkens with age: green, amber, red, and a deep
 *   red for the backlog (lightened in dark mode so it still stands off the surface).
 * Recharts takes colours as SVG attributes, which dark-compat.css cannot reach, so the dark steps
 * are picked here from the theme. Every figure is also given in text (labels, tooltips, tables).
 */
const PALETTE = {
  light: {
    stage: { receiving: '#2a78d6', verification: '#eb6834', payment: '#1baf7a' },
    received: '#2a78d6',
    paid: '#eb6834',
    backlog: '#111827',
    bands: { fresh: '#16a34a', late: '#f59e0b', old: '#ef4444', stale: '#7f1d1d' } satisfies Record<WaitBandKey, string>,
  },
  dark: {
    stage: { receiving: '#3987e5', verification: '#d95926', payment: '#199e70' },
    received: '#3987e5',
    paid: '#d95926',
    backlog: '#e5e7eb',
    bands: { fresh: '#22c55e', late: '#f59e0b', old: '#f87171', stale: '#dc2626' } satisfies Record<WaitBandKey, string>,
  },
} as const;

export function useDashboardPalette() {
  const { resolvedMode } = useTheme();
  return PALETTE[resolvedMode === 'dark' ? 'dark' : 'light'];
}

/** A panel's way in: the page or report its figures come from ("Ageing report →"). */
export interface PanelAction {
  href: string;
  label: string;
}

/**
 * A dashboard block as Bill Tracking draws them: a solid card, its title over a rule, and on the
 * right its tools (a tab switch), the legend and a link to where the figures come from. Theme
 * tokens, so it reads in dark mode.
 */
export function DashboardPanel({
  title,
  description,
  icon: Icon,
  legend,
  tools,
  action,
  className,
  contentClassName,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  legend?: ReactNode;
  /** Beside the title, before the link: a switch between views of the panel. */
  tools?: ReactNode;
  action?: PanelAction;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm', className)}>
      {/* The tools and the link stay on the title's line, top right, however narrow the panel; the
          legend sits at the end of the description's line and wraps under it when there is no room. */}
      <div className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
            {title}
          </h2>
          {tools || action ? (
            <div className="flex shrink-0 items-center gap-3">
              {tools}
              {action ? (
                <Link href={action.href} className="inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium text-emerald-700 hover:underline">
                  {action.label}
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
        {description || legend ? (
          <div className="mt-0.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            {description && <p className="min-w-0 text-xs text-muted-foreground">{description}</p>}
            {legend ? <div className="ml-auto">{legend}</div> : null}
          </div>
        ) : null}
      </div>
      <div className={cn('p-4', contentClassName)}>{children}</div>
    </section>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string; line?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn('inline-block rounded-sm', item.line ? 'h-0.5 w-3' : 'h-2.5 w-2.5')}
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
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

/* ── received vs paid, and the open amount it leaves ──────────────────────────────────────────── */

export interface FlowPoint extends MonthPoint {
  /** What was still owed at the month's end (today, for this month). */
  backlog: number;
}

/**
 * Net received (by reception date) and paid out each month as bars, with what was still owed at
 * each month's end as a line — one axis, so the bars and the line compare directly.
 */
export function FlowBacklogChart({ points, height = 260 }: { points: FlowPoint[]; height?: number }) {
  const palette = useDashboardPalette();
  const hasData = points.some((p) => p.received || p.paid || p.backlog);
  if (!hasData) return <EmptyChart height={height}>Nothing received, paid or owed in the last 12 months.</EmptyChart>;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={points} margin={{ top: 12, right: 8, bottom: 0, left: 4 }} barGap={2} barCategoryGap="24%">
        <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
        <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} width={64} tickFormatter={(v) => compactInr(Number(v))} />
        <Tooltip
          cursor={chartChrome.cursor}
          content={({ active, payload }) => {
            const point = active ? (payload?.[0]?.payload as FlowPoint | undefined) : undefined;
            if (!point) return null;
            return (
              <TooltipBox
                title={point.label}
                rows={[
                  { label: `Received (${point.receivedCount})`, value: formatInr(point.received), color: palette.received },
                  { label: 'Paid', value: formatInr(point.paid), color: palette.paid },
                  { label: 'Open at month end', value: formatInr(point.backlog), color: palette.backlog, strong: true },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="received" fill={palette.received} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
        <Bar dataKey="paid" fill={palette.paid} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
        <Line
          type="linear"
          dataKey="backlog"
          stroke={palette.backlog}
          strokeWidth={2}
          dot={{ r: 3, fill: chartChrome.surface, stroke: palette.backlog, strokeWidth: 1.5 }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
