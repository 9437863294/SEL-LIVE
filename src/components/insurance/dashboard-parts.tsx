'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Bar, BarChart, CartesianGrid, LabelList, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { LucideIcon } from 'lucide-react';
import { chartChrome } from '@/components/ui/chart';
import { useTheme } from '@/components/theme/ThemeProvider';
import { compactInr, formatInr, type InsurerRow, type MonthBucket } from '@/lib/insurance';
import { cn } from '@/lib/utils';

/**
 * The insurance dashboard's chart vocabulary.
 *
 * Two series run through every chart: personal policies and project policies, always in the same
 * two hues — categorical slots 1–2 of the reference palette. Validated as a pair against this app's
 * card surfaces (light #ffffff, dark #1d1d20): every check passes in both modes, adjacent CVD ΔE
 * 24.7 light / 26.8 dark, both above 3:1 contrast. Recharts takes colours as SVG attributes, which
 * the dark-compat stylesheet cannot reach, so the dark steps are picked from the theme here.
 *
 * Colour follows the entity: "personal" is blue on the forecast and on the insurer bars alike, and
 * a user who can see only one register still sees that register in its own colour.
 */
const SERIES = {
  light: { personal: '#2a78d6', project: '#eb6834' },
  dark: { personal: '#3987e5', project: '#d95926' },
} as const;

export function useInsuranceSeries() {
  const { resolvedMode } = useTheme();
  return SERIES[resolvedMode === 'dark' ? 'dark' : 'light'];
}

export function SeriesLegend({ items }: { items: Array<{ label: string; color: string }> }) {
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

/** A headline number: label, value, one line of context. The whole tile links to where it comes from. */
export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  href,
  attention,
}: {
  label: string;
  value: string;
  sub: ReactNode;
  icon: LucideIcon;
  href?: string;
  /** Marks the tile as needing action — the icon carries it, never colour on the number. */
  attention?: 'warning' | 'critical';
}) {
  const body = (
    <div className="flex h-full min-w-0 flex-col gap-1 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <Icon
          aria-hidden
          className={cn(
            'h-4 w-4 shrink-0',
            attention === 'critical' ? 'text-red-600' : attention === 'warning' ? 'text-amber-600' : 'text-muted-foreground',
          )}
        />
      </div>
      <p className="truncate text-2xl font-semibold leading-tight text-foreground">{value}</p>
      <div className="text-xs leading-snug text-muted-foreground">{sub}</div>
    </div>
  );
  return href ? <Link href={href} className="min-w-0">{body}</Link> : body;
}

function TooltipBox({ title, rows }: { title: string; rows: Array<{ label: string; value: string; color?: string; strong?: boolean }> }) {
  return (
    <div style={chartChrome.tooltip.contentStyle} className="min-w-[180px] px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-semibold">{title}</p>
      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 opacity-80">
              {row.color && <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: row.color }} />}
              {row.label}
            </span>
            <span className={cn('tabular-nums', row.strong && 'font-semibold')}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ForecastPoint extends MonthBucket {
  tick: string;
  title: string;
}

/**
 * Premium outflow per month, personal and project stacked. The peak month carries its total on the
 * cap; every other figure is in the tooltip and in the forecast report's table.
 */
export function PremiumForecastChart({
  buckets,
  showPersonal,
  showProject,
}: {
  buckets: MonthBucket[];
  showPersonal: boolean;
  showProject: boolean;
}) {
  const series = useInsuranceSeries();
  const data: ForecastPoint[] = buckets.map((b, i) => ({
    ...b,
    tick: i === 0 || b.month.getMonth() === 0 ? format(b.month, "MMM ''yy") : format(b.month, 'MMM'),
    title: format(b.month, 'MMMM yyyy'),
  }));
  const peakIndex = data.reduce((best, d, i) => (d.total > (data[best]?.total ?? 0) ? i : best), 0);
  const hasData = data.some((d) => d.total > 0);

  if (!hasData) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">
        No premiums or renewals fall due in the next 12 months.
      </div>
    );
  }

  // The top segment of each stack owns the rounded end; when a month has no project renewal the
  // personal segment is the top one and rounds instead.
  const personalShape = (props: unknown) => {
    const p = props as { payload: ForecastPoint } & Record<string, unknown>;
    const onTop = !showProject || p.payload.project === 0;
    return <Rectangle {...(p as object)} radius={onTop ? [4, 4, 0, 0] : 0} />;
  };

  return (
    <ResponsiveContainer width="100%" height={260}>
      {/* accessibilityLayer: the chart takes focus and the arrow keys walk the months, showing the
          same tooltip as hover — so keyboard readers get every value too. */}
      <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%" accessibilityLayer>
        <CartesianGrid stroke={chartChrome.grid} vertical={false} />
        <XAxis dataKey="tick" stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={{ stroke: chartChrome.grid }} interval="preserveStartEnd" minTickGap={10} />
        <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => compactInr(Number(v))} />
        <Tooltip
          cursor={chartChrome.cursor}
          content={({ active, payload }) => {
            const point = active ? (payload?.[0]?.payload as ForecastPoint | undefined) : undefined;
            if (!point) return null;
            return (
              <TooltipBox
                title={point.title}
                rows={[
                  { label: 'Total', value: formatInr(point.total), strong: true },
                  ...(showPersonal ? [{ label: 'Personal premiums', value: formatInr(point.personal), color: series.personal }] : []),
                  ...(showProject ? [{ label: 'Project renewals', value: formatInr(point.project), color: series.project }] : []),
                  { label: 'Payments', value: String(point.count) },
                ]}
              />
            );
          }}
        />
        {showPersonal && (
          <Bar dataKey="personal" stackId="outflow" fill={series.personal} stroke={chartChrome.surface} strokeWidth={2} maxBarSize={24} shape={personalShape} isAnimationActive={false}>
            {!showProject && <LabelList dataKey="total" content={(p) => <PeakLabel {...p} peakIndex={peakIndex} />} />}
          </Bar>
        )}
        {showProject && (
          <Bar dataKey="project" stackId="outflow" fill={series.project} stroke={chartChrome.surface} strokeWidth={2} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="total" content={(p) => <PeakLabel {...p} peakIndex={peakIndex} />} />
          </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** The forecast as a table — the chart's twin, for anyone who would rather read the numbers. */
export function ForecastTable({ buckets, showPersonal, showProject }: { buckets: MonthBucket[]; showPersonal: boolean; showProject: boolean }) {
  const totals = buckets.reduce(
    (t, b) => ({ personal: t.personal + b.personal, project: t.project + b.project, total: t.total + b.total, count: t.count + b.count }),
    { personal: 0, project: 0, total: 0, count: 0 },
  );
  return (
    <div className="max-h-[260px] overflow-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <caption className="sr-only">Premium outflow by month</caption>
        <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground backdrop-blur-sm">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">Month</th>
            {showPersonal && <th scope="col" className="px-3 py-2 text-right font-medium">Personal</th>}
            {showProject && <th scope="col" className="px-3 py-2 text-right font-medium">Project</th>}
            <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {buckets.map((b) => (
            <tr key={b.key} className={cn(b.count === 0 && 'text-muted-foreground')}>
              <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-normal">{format(b.month, 'MMM yyyy')}</th>
              {showPersonal && <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{b.personal ? formatInr(b.personal) : '—'}</td>}
              {showProject && <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{b.project ? formatInr(b.project) : '—'}</td>}
              <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium tabular-nums">{b.total ? formatInr(b.total) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border/60 font-semibold">
          <tr>
            <th scope="row" className="px-3 py-2 text-left">Total</th>
            {showPersonal && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatInr(totals.personal)}</td>}
            {showProject && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatInr(totals.project)}</td>}
            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatInr(totals.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PeakLabel(props: { x?: unknown; y?: unknown; width?: unknown; value?: unknown; index?: number; peakIndex: number }) {
  if (props.index !== props.peakIndex) return null;
  const x = Number(props.x) + Number(props.width) / 2;
  const y = Number(props.y) - 6;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={11} fontWeight={600} fill="hsl(var(--foreground))">
      {compactInr(Number(props.value))}
    </text>
  );
}

/**
 * Yearly premium by insurer as a bar list: name and total in text, a thin stacked bar beneath
 * (personal then project, 2px surface gap between them). Every value is printed, so nothing hides
 * behind a hover.
 */
export function InsurerBreakdown({ rows, showPersonal, showProject }: { rows: InsurerRow[]; showPersonal: boolean; showProject: boolean }) {
  const series = useInsuranceSeries();
  const max = Math.max(1, ...rows.map((r) => r.total));
  const grand = rows.reduce((s, r) => s + r.total, 0);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No live policies to break down yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const personalPct = (r.personal / max) * 100;
        const projectPct = (r.project / max) * 100;
        const share = grand > 0 ? Math.round((r.total / grand) * 100) : 0;
        return (
          <li key={r.name} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-foreground" title={r.name}>{r.name}</span>
              <span className="shrink-0 tabular-nums text-foreground">
                {compactInr(r.total)} <span className="text-xs text-muted-foreground">· {share}%</span>
              </span>
            </div>
            <div
              className="mt-1.5 flex h-2 w-full gap-[2px]"
              role="img"
              aria-label={`${r.name}: ${formatInr(r.total)} a year across ${r.policies} ${r.policies === 1 ? 'policy' : 'policies'}${
                showPersonal && showProject ? ` — personal ${formatInr(r.personal)}, project ${formatInr(r.project)}` : ''
              }`}
              title={showPersonal && showProject ? `Personal ${formatInr(r.personal)} · Project ${formatInr(r.project)}` : formatInr(r.total)}
            >
              {r.personal > 0 && (
                <span className={cn('h-full rounded-l-sm', r.project === 0 && 'rounded-r')} style={{ width: `${personalPct}%`, backgroundColor: series.personal }} />
              )}
              {r.project > 0 && (
                <span className={cn('h-full rounded-r', r.personal === 0 && 'rounded-l-sm')} style={{ width: `${projectPct}%`, backgroundColor: series.project }} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Status colours, fixed and never themed — distinct from the two series hues so a status never
 * impersonates "personal" or "project". Each ships with an icon and a word, never colour alone.
 */
const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' } as const;

/**
 * A single ratio against the whole: share of live policies in good standing. The fill carries the
 * status (good from 90%, warning from 75%, critical below) and the track is the same hue, lighter,
 * so the state reads across the whole bar; the word beside the figure says it without colour.
 */
export function StandingMeter({ good, total, icon: Icon }: { good: number; total: number; icon: Record<'good' | 'warning' | 'critical', LucideIcon> }) {
  // With nothing to measure there is no standing to report — "100% healthy" of nothing would mislead.
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No policies are due to be in force yet.</p>;
  }
  const pct = Math.round((good / total) * 100);
  const level = pct >= 90 ? 'good' : pct >= 75 ? 'warning' : 'critical';
  const color = STATUS[level];
  const LevelIcon = Icon[level];
  const word = level === 'good' ? 'Healthy' : level === 'warning' ? 'Needs attention' : 'At risk';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-3xl font-semibold leading-none text-foreground">{pct}%</p>
        <p className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
          <LevelIcon aria-hidden className="h-3.5 w-3.5" style={{ color }} /> {word}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{good} of {total} in good standing</p>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: `${color}33` }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Policies in good standing"
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
