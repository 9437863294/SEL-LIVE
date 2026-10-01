'use client';

import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { chartChrome } from '@/components/ui/chart';
import { useTheme } from '@/components/theme/ThemeProvider';
import { compactInr, formatInr } from '@/lib/bank-balance-ledger';
import type { AgeingBucket, GroupFigure, MonthPoint, OpenStage, StageFigure } from '@/lib/daily-requisition-dashboard';
import { cn } from '@/lib/utils';

/**
 * Colours from the reference palette, chosen for the job each does:
 * - the three workflow stages are identities → categorical slots 1–3 (blue, orange, aqua), which
 *   validate all-pairs in both modes (worst CVD ΔE 9.2 light / 9.4 dark);
 * - received vs paid is two series → slots 1–2;
 * - ageing buckets are ordered → one blue ramp, validated `--ordinal` (light 250→650, dark 600→200,
 *   so the oldest bucket is the most emphatic on either surface).
 * Recharts takes colours as SVG attributes, which dark-compat.css cannot reach, so the dark steps
 * are picked here from the theme. Aqua sits under 3:1 on the light surface: every figure is also
 * given in text (stage tiles, tooltips, bar labels).
 */
const PALETTE = {
  light: {
    stage: { receiving: '#2a78d6', verification: '#eb6834', payment: '#1baf7a' },
    received: '#2a78d6',
    paid: '#eb6834',
    ageing: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  },
  dark: {
    stage: { receiving: '#3987e5', verification: '#d95926', payment: '#199e70' },
    received: '#3987e5',
    paid: '#d95926',
    ageing: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
  },
} as const;

export function useDashboardPalette() {
  const { resolvedMode } = useTheme();
  return PALETTE[resolvedMode === 'dark' ? 'dark' : 'light'];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

export function DashboardPanel({
  title,
  description,
  icon: Icon,
  legend,
  className,
  contentClassName,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  legend?: ReactNode;
  className?: string;
  contentClassName?: string;
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
      <CardContent className={cn('p-4 pt-2', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
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

/* ── pipeline ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * The open requisitions across the three queues: one bar split by stage (width = how many), and a
 * tile per stage with its count, what is still due and how long the oldest has waited.
 */
export function PipelinePanel({ stages, names }: { stages: StageFigure[]; names: Record<OpenStage, string> }) {
  const palette = useDashboardPalette();
  const total = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <DashboardPanel title="Workflow pipeline" description="Open requisitions in each stage queue right now, and what is still due on them.">
      {total === 0 ? (
        <EmptyChart height={96}>Nothing is waiting in any stage.</EmptyChart>
      ) : (
        <div
          className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100"
          role="img"
          aria-label={stages.map((s) => `${names[s.stage]}: ${s.count}`).join(', ')}
        >
          {stages
            .filter((s) => s.count > 0)
            .map((s) => (
              <span
                key={s.stage}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(s.count / total) * 100}%`, minWidth: 6, backgroundColor: palette.stage[s.stage] }}
                title={`${names[s.stage]} · ${plural(s.count, 'requisition')} · ${formatInr(s.balance)} due`}
              />
            ))}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stages.map((s, index) => (
          <div key={s.stage} className="min-w-0 rounded-lg border bg-white/70 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: palette.stage[s.stage] }} />
              <span className="truncate text-xs font-medium text-slate-600">
                <span className="text-slate-400">Stage {index + 1} · </span>
                {names[s.stage]}
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold tabular-nums text-slate-900">{s.count.toLocaleString('en-IN')}</span>
              <span className="truncate text-sm font-medium tabular-nums text-slate-700">{formatInr(s.balance)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {s.count === 0
                ? 'Queue is clear'
                : s.oldestDays === null
                  ? `${total ? Math.round((s.count / total) * 100) : 0}% of open`
                  : `${total ? Math.round((s.count / total) * 100) : 0}% of open · oldest ${plural(s.oldestDays, 'day')}`}
            </p>
          </div>
        ))}
      </div>
    </DashboardPanel>
  );
}

/* ── received vs paid ─────────────────────────────────────────────────────────────────────────── */

export function MonthlyFlowChart({
  points,
  paidAhead,
  className,
}: {
  points: MonthPoint[];
  paidAhead: { amount: number; count: number };
  className?: string;
}) {
  const palette = useDashboardPalette();
  const hasData = points.some((p) => p.received || p.paid);

  return (
    <DashboardPanel
      className={className}
      title="Received vs paid"
      description="Net amount received (by reception date) against money paid out, per month — last 12 months."
      legend={<Legend items={[{ label: 'Received', color: palette.received }, { label: 'Paid', color: palette.paid }]} />}
    >
      {!hasData ? (
        <EmptyChart height={260}>No requisitions received or paid in the last 12 months.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barGap={2} barCategoryGap="24%">
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
            <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} width={64} tickFormatter={(v) => compactInr(Number(v))} />
            <Tooltip
              cursor={chartChrome.cursor}
              content={({ active, payload }) => {
                const point = active ? (payload?.[0]?.payload as MonthPoint | undefined) : undefined;
                if (!point) return null;
                return (
                  <TooltipBox
                    title={point.label}
                    rows={[
                      { label: `Received (${point.receivedCount})`, value: formatInr(point.received), color: palette.received },
                      { label: 'Paid', value: formatInr(point.paid), color: palette.paid },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="received" fill={palette.received} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            <Bar dataKey="paid" fill={palette.paid} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
      {paidAhead.count > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <CalendarClock aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {formatInr(paidAhead.amount)} in post-dated payments ({plural(paidAhead.count, 'payment')}) not counted until their date.
          </span>
        </p>
      )}
    </DashboardPanel>
  );
}

/* ── ageing ───────────────────────────────────────────────────────────────────────────────────── */

export function AgeingChart({ buckets }: { buckets: AgeingBucket[] }) {
  const palette = useDashboardPalette();
  const hasData = buckets.some((b) => b.count > 0);
  const data = buckets.map((b) => ({ ...b, countLabel: b.count ? b.count.toLocaleString('en-IN') : '' }));

  return (
    <DashboardPanel title="Ageing of open requisitions" description="Days waited since the reception date, across all open stages.">
      {!hasData ? (
        <EmptyChart height={260}>No open requisitions.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 4 }} barCategoryGap="22%">
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} interval={0} />
            <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip
              cursor={chartChrome.cursor}
              content={({ active, payload }) => {
                const bucket = active ? (payload?.[0]?.payload as AgeingBucket | undefined) : undefined;
                if (!bucket) return null;
                return (
                  <TooltipBox
                    title={bucket.label}
                    rows={[
                      { label: 'Requisitions', value: bucket.count.toLocaleString('en-IN'), strong: true },
                      { label: 'Still due', value: formatInr(bucket.balance) },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
              {data.map((bucket, index) => (
                <Cell key={bucket.label} fill={palette.ageing[index] ?? palette.ageing[palette.ageing.length - 1]} />
              ))}
              <LabelList dataKey="countLabel" position="top" fontSize={11} fill={chartChrome.axis} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </DashboardPanel>
  );
}

/* ── still due by department ──────────────────────────────────────────────────────────────────── */

export function DepartmentDueChart({ groups, nameOf }: { groups: GroupFigure[]; nameOf: (key: string) => string }) {
  const palette = useDashboardPalette();
  const data = groups
    .filter((g) => g.balance > 0)
    .map((g) => ({ ...g, name: nameOf(g.key), amountLabel: compactInr(g.balance) }));
  const height = Math.max(180, data.length * 36 + 24);

  return (
    <DashboardPanel title="Still due by department" description="What open requisitions still owe, by the department that raised them.">
      {data.length === 0 ? (
        <EmptyChart height={180}>Nothing is due.</EmptyChart>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }} barCategoryGap={8}>
            <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" stroke={chartChrome.axis} fontSize={11} tickLine={false} tickFormatter={(v) => compactInr(Number(v))} />
            <YAxis type="category" dataKey="name" stroke={chartChrome.axis} fontSize={11} tickLine={false} width={110} />
            <Tooltip
              cursor={chartChrome.cursor}
              content={({ active, payload }) => {
                const group = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!group) return null;
                return (
                  <TooltipBox
                    title={group.name}
                    rows={[
                      { label: 'Still due', value: formatInr(group.balance), strong: true },
                      { label: 'Requisitions', value: group.count.toLocaleString('en-IN') },
                      ...(group.oldestDays !== null ? [{ label: 'Oldest', value: plural(group.oldestDays, 'day') }] : []),
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="balance" fill={palette.received} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
              <LabelList dataKey="amountLabel" position="right" fontSize={11} fill={chartChrome.axis} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </DashboardPanel>
  );
}
