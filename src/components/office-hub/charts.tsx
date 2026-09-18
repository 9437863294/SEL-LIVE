'use client';

/**
 * Office Hub's chart vocabulary.
 *
 * Every report in the module draws from this file so the twelve breakdowns on the reports page read
 * as one system rather than twelve independently-styled charts.
 *
 * ── The palettes, and why they are hard-coded here ──────────────────────────────────────────────
 *
 * The application defines `--chart-1` … `--chart-5` in `globals.css`, but **only inside the `.dark`
 * block** — in the light theme, which is the default, `hsl(var(--chart-1))` resolves to nothing and
 * the bars render invisible. Rather than depend on that (or "fix" a global token other modules may
 * be relying on), the hues below are the same shadcn values written explicitly, plus a dark set
 * re-stepped for a dark surface.
 *
 * Both sets were checked rather than eyeballed, against the light surface `#f9fafb` and the dark
 * surface `#09090b`:
 *
 *   • **Categorical, light** — lightness band, chroma floor, CVD separation and normal-vision floor
 *     all pass. Contrast warns on two slots (teal 2.41:1, amber 2.44:1), which obliges visible
 *     value labels; every chart below carries them, so the relief is real rather than promised.
 *   • **Categorical, dark** — the shadcn teal and amber sit above the dark lightness band, so both
 *     are re-stepped (`#1fa87c`, `#c96f18`). All six checks then pass. The worst adjacent tritan
 *     separation is ΔE 7.7, inside the 6–8 floor band, which is legal only with secondary
 *     encoding — again the direct labels.
 *   • **Ordinal** — one hue, monotone lightness, ≥0.06 step gaps, light end clear of the surface.
 *     Capped at **five** steps: a sixth cannot hold both the step gap and the light-end contrast
 *     inside one hue's usable range, so an ordinal scale needing six bands drops its off-scale
 *     band to neutral instead of stretching the ramp. `AGEING_LABELS` does exactly that with
 *     "No date".
 *
 * Two rules the charts here follow that are easy to get wrong:
 *
 *   • **Nominal categories get one colour, not a ramp.** A department breakdown coloured
 *     darker-where-bigger double-encodes bar length as hue and spends the only free channel on
 *     information the bar already shows. Only genuinely ordered scales — priority, age bands — use
 *     the ramp.
 *   • **No dual axes, ever.** Two measures of different scale are two charts.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CountRow } from '@/lib/office-hub';

/** Categorical identity hues, in fixed order. Never cycled, never reassigned by rank. */
export const OFFICE_HUB_CATEGORICAL = [
  '#2662d9', // blue
  '#2eb88a', // teal
  '#e88c30', // amber
  '#af57db', // violet
  '#e23670', // rose
] as const;

/** The dark-surface re-stepping of the same five hues. */
export const OFFICE_HUB_CATEGORICAL_DARK = [
  '#3b76e3',
  '#1fa87c',
  '#c96f18',
  '#af57db',
  '#e23670',
] as const;

/** Ordinal ramp, light → dark. Five steps; see the note above on why not six. */
export const OFFICE_HUB_ORDINAL = ['#9aa7fb', '#7b86f5', '#5b60e8', '#4438c9', '#2f2a8f'] as const;

/** Off-scale neutral, for an ordinal chart's "not applicable" band. */
export const OFFICE_HUB_OFF_SCALE = '#cbd5e1';

/** Ink for labels and axes — text tokens, never the series colour. */
const AXIS_INK = '#64748b';
const LABEL_INK = '#334155';
const GRID_INK = '#e2e8f0';

/** A recessive, consistent tooltip. Built here so all twelve charts share one. */
const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    fontSize: 12,
    padding: '6px 10px',
    boxShadow: '0 4px 12px -4px rgba(15,23,42,0.15)',
  },
  labelStyle: { color: LABEL_INK, fontWeight: 600, marginBottom: 2 },
  itemStyle: { color: LABEL_INK },
} as const;

export function ChartFrame({
  title,
  subtitle,
  children,
  className,
  /** Rendered under the chart — the table view §55 asks for as the non-visual path. */
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}) {
  return (
    <Card className={cn('border-white/60 bg-white/80', className)}>
      <CardContent className="p-4">
        <div className="mb-3 min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
        {footer}
      </CardContent>
    </Card>
  );
}

/**
 * A magnitude comparison over nominal categories.
 *
 * Horizontal, because category names here are department and person names and a vertical axis
 * would rotate them. One hue for every bar; the value is direct-labelled at the end of each bar,
 * which is both the emphasis the chart needs and the contrast relief the palette check requires.
 */
export function CategoryBarChart({
  rows,
  title,
  subtitle,
  emptyLabel = 'Nothing to show for this period.',
  limit = 8,
  valueName = 'Count',
}: {
  rows: readonly CountRow[];
  title: string;
  subtitle?: string;
  emptyLabel?: string;
  limit?: number;
  valueName?: string;
}) {
  /**
   * Past the limit the tail folds into "Other".
   *
   * Never into more colours — a generated hue is indistinguishable from an existing one under CVD.
   * Here it would not even be more colours, just more rows than a reader can hold, which is the
   * same failure by a different route.
   */
  const shown = rows.slice(0, limit);
  const tail = rows.slice(limit);
  const data = tail.length
    ? [...shown, { label: `Other (${tail.length})`, count: tail.reduce((sum, row) => sum + row.count, 0) }]
    : shown;

  if (!rows.length) {
    return (
      <ChartFrame title={title} subtitle={subtitle}>
        <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame title={title} subtitle={subtitle} footer={<ChartTable rows={data} valueName={valueName} />}>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 32 + 24)}>
        <BarChart data={[...data]} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke={GRID_INK} />
          <XAxis type="number" tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={128}
            tick={{ fontSize: 11, fill: AXIS_INK }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip {...tooltipStyle} formatter={(value: number) => [value, valueName]} />
          {/* 24px cap, rounded data-end, square at the baseline. */}
          <Bar dataKey="count" fill={OFFICE_HUB_CATEGORICAL[0]} radius={[0, 4, 4, 0]} maxBarSize={24}>
            <LabelList dataKey="count" position="right" fontSize={11} fill={LABEL_INK} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * A single measure over months.
 *
 * One series, so no legend — the title names what is plotted. Only the final point is labelled;
 * a number on every month is the flood that stops direct labels working.
 */
export function MonthlyTrendChart({
  rows,
  title,
  subtitle,
  valueName = 'Meetings',
}: {
  rows: readonly CountRow[];
  title: string;
  subtitle?: string;
  valueName?: string;
}) {
  if (rows.length < 2) {
    return (
      <ChartFrame title={title} subtitle={subtitle}>
        <p className="py-10 text-center text-sm text-muted-foreground">
          Not enough history yet — a trend needs at least two months.
        </p>
      </ChartFrame>
    );
  }

  const data = rows.map((row) => ({ ...row, month: formatMonth(row.label) }));

  return (
    <ChartFrame title={title} subtitle={subtitle} footer={<ChartTable rows={rows} valueName={valueName} />}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 12, right: 24, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_INK} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
          <Tooltip {...tooltipStyle} formatter={(value: number) => [value, valueName]} />
          <Line
            type="monotone"
            dataKey="count"
            stroke={OFFICE_HUB_CATEGORICAL[0]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            // ≥8px marker, with a 2px surface ring so it stays legible where it crosses the line.
            dot={{ r: 4, fill: OFFICE_HUB_CATEGORICAL[0], stroke: '#ffffff', strokeWidth: 2 }}
            activeDot={{ r: 6, fill: OFFICE_HUB_CATEGORICAL[0], stroke: '#ffffff', strokeWidth: 2 }}
          >
            <LabelList
              dataKey="count"
              position="top"
              fontSize={11}
              fill={LABEL_INK}
              // The endpoint only.
              formatter={((value: number, _entry: unknown, index: number) =>
                index === data.length - 1 ? String(value) : '') as never}
            />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * An ordered scale — priority, or an age band.
 *
 * This is the one place a ramp is correct, because the categories genuinely run low to high. Rows
 * whose label is not on the scale (`offScaleLabels`) are drawn in the neutral instead of being
 * given a ramp step they would misrepresent.
 */
export function OrdinalBarChart({
  rows,
  title,
  subtitle,
  offScaleLabels = [],
  valueName = 'Count',
}: {
  rows: readonly CountRow[];
  title: string;
  subtitle?: string;
  offScaleLabels?: readonly string[];
  valueName?: string;
}) {
  if (!rows.some((row) => row.count > 0)) {
    return (
      <ChartFrame title={title} subtitle={subtitle}>
        <p className="py-10 text-center text-sm text-muted-foreground">Nothing to show for this period.</p>
      </ChartFrame>
    );
  }

  const onScale = rows.filter((row) => !offScaleLabels.includes(row.label));

  const colorFor = (label: string, index: number): string => {
    if (offScaleLabels.includes(label)) return OFFICE_HUB_OFF_SCALE;
    const position = onScale.findIndex((row) => row.label === label);
    const step = Math.min(
      OFFICE_HUB_ORDINAL.length - 1,
      Math.max(0, Math.round((position / Math.max(1, onScale.length - 1)) * (OFFICE_HUB_ORDINAL.length - 1))),
    );
    return OFFICE_HUB_ORDINAL[Number.isFinite(step) ? step : index % OFFICE_HUB_ORDINAL.length];
  };

  return (
    <ChartFrame title={title} subtitle={subtitle} footer={<ChartTable rows={rows} valueName={valueName} />}>
      <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 32 + 24)}>
        <BarChart data={[...rows]} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke={GRID_INK} />
          <XAxis type="number" tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={110}
            tick={{ fontSize: 11, fill: AXIS_INK }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip {...tooltipStyle} formatter={(value: number) => [value, valueName]} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {rows.map((row, index) => (
              <Cell key={row.label} fill={colorFor(row.label, index)} />
            ))}
            <LabelList dataKey="count" position="right" fontSize={11} fill={LABEL_INK} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Part-to-whole across a handful of states.
 *
 * A single horizontal stacked bar, because the question is "what proportion of the work is where",
 * and a 2px surface gap between segments does the separating. Two or more series, so a legend is
 * always present — identity is never colour alone.
 */
export function CompositionBar({
  rows,
  title,
  subtitle,
  valueName = 'Tasks',
}: {
  rows: readonly CountRow[];
  title: string;
  subtitle?: string;
  valueName?: string;
}) {
  const present = rows.filter((row) => row.count > 0);
  const total = present.reduce((sum, row) => sum + row.count, 0);

  if (!total) {
    return (
      <ChartFrame title={title} subtitle={subtitle}>
        <p className="py-10 text-center text-sm text-muted-foreground">Nothing to show for this period.</p>
      </ChartFrame>
    );
  }

  // One row, one key per state — Recharts stacks keys, so the data is a single object.
  const datum = present.reduce<Record<string, number | string>>((accumulator, row) => {
    accumulator[row.label] = row.count;
    return accumulator;
  }, { name: valueName });

  return (
    <ChartFrame title={title} subtitle={subtitle} footer={<ChartTable rows={present} valueName={valueName} showShare />}>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={[datum]} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barSize={24}>
          <XAxis type="number" hide domain={[0, total]} />
          <YAxis type="category" dataKey="name" hide />
          <Tooltip {...tooltipStyle} />
          <Legend
            verticalAlign="bottom"
            height={28}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: AXIS_INK }}
          />
          {present.map((row, index) => (
            <Bar
              key={row.label}
              dataKey={row.label}
              stackId="composition"
              fill={OFFICE_HUB_CATEGORICAL[index % OFFICE_HUB_CATEGORICAL.length]}
              // A 2px gap in the surface colour between touching segments, consistently.
              stroke="#ffffff"
              strokeWidth={2}
              radius={index === present.length - 1 ? [0, 4, 4, 0] : undefined}
            >
              {/* Labelled only where the segment is wide enough for the text to fit. */}
              <LabelList
                dataKey={row.label}
                position="center"
                fontSize={11}
                fill="#ffffff"
                formatter={((value: number) => (value / total > 0.08 ? String(value) : '')) as never}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * The table behind every chart.
 *
 * Collapsed by default so it does not compete with the chart, and present on every one — §55's
 * screen-reader path, and the relief the palette's contrast warning obliges.
 */
function ChartTable({
  rows,
  valueName,
  showShare,
}: {
  rows: readonly CountRow[];
  valueName: string;
  showShare?: boolean;
}) {
  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer list-none text-[11px] text-muted-foreground hover:text-slate-700">
        <span className="underline decoration-dotted">View as a table</span>
      </summary>
      <table className="mt-1.5 w-full border-collapse text-xs">
        <caption className="sr-only">{valueName} by category</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 font-medium">
              Category
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {valueName}
            </th>
            {showShare && (
              <th scope="col" className="py-1 text-right font-medium">
                Share
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-slate-100">
              <th scope="row" className="py-1 pr-2 text-left font-normal text-slate-700">
                {row.label}
              </th>
              <td className="py-1 text-right tabular-nums text-slate-800">{row.count}</td>
              {showShare && (
                <td className="py-1 text-right tabular-nums text-muted-foreground">
                  {total ? Math.round((row.count / total) * 100) : 0}%
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** `2026-09` → `Sep 26`, for an axis that has to fit twelve of them. */
function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  if (!year || !month) return monthKey;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(month) - 1] ?? month} ${year.slice(-2)}`;
}

/**
 * A single headline number.
 *
 * A one-bar bar chart is the commonest way to make a number harder to read than it needs to be, so
 * the reports use this where the data is one value.
 */
export function HeroFigure({
  label,
  value,
  hint,
  tone = 'slate',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'slate' | 'rose' | 'emerald' | 'amber';
}) {
  const ink = {
    slate: 'text-slate-800',
    rose: 'text-rose-700',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
  }[tone];

  return (
    <Card className="border-white/60 bg-white/80">
      <CardContent className="p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('mt-0.5 text-3xl font-semibold tabular-nums leading-none', ink)}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
