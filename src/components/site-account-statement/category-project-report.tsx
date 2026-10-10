'use client';

/**
 * Projects by category — the Graphical Reports section that answers "which project is consuming
 * the most of this?".
 *
 * Its own controls sit in one row above its own two panels, not in the tab's filter row: choosing
 * a category here must not filter "Received vs spent", where receipts carry no category at all.
 * It still inherits the tab's months and projects, so its figures agree with everything above it.
 *
 * Two panels, two jobs:
 *   - a ranking for one category, by rupees or by share of each project's own spending;
 *   - a projects × categories grid, shaded by amount, for the whole picture at once. Clicking a
 *     column heading picks that category for the ranking.
 * The figures come from `site-account-statement-charts.ts`, which is unit-tested.
 */

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Layers, Users } from 'lucide-react';
import { chartChrome } from '@/components/ui/chart';
import { formatINR } from '@/lib/site-account-statement';
import { periodLabel } from '@/lib/site-account-statement-period-range';
import {
  categoryMatrix, categoryOptions, categoryTrend, projectConsumption, sequentialStep, subCategoryOptions,
  type ChartExpense, type ChartProject, type ChartScope, type ConsumptionMeasure, type ProjectConsumptionRow,
} from '@/lib/site-account-statement-charts';
import {
  CategoryTick, ChartPanel, EmptyChart, TipLabel,
  axisMoneyFor, axisMonthLabels, categoryAxis, inkOn, inrCompact, pct, useAnimate, useBoxWidth, usePalette,
} from '@/components/site-account-statement/chart-kit';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const ALL = '__all__';
const MAX_RANKED = 15;

// ── The ranking ───────────────────────────────────────────────────────────────

/** One measure across projects — nominal categories, so one hue, ranked. */
function ConsumptionChart({ rows, measure, subject }: { rows: ProjectConsumptionRow[]; measure: ConsumptionMeasure; subject: string }) {
  const palette = usePalette();
  const animate = useAnimate();
  const [box, width] = useBoxWidth();
  const axis = categoryAxis(width);
  const data = rows.map(r => ({ ...r, value: measure === 'share' ? r.shareOfProject * 100 : r.amount }));
  const tipText = (r: ProjectConsumptionRow) => (measure === 'share' ? pct(r.shareOfProject * 100) : inrCompact(r.amount));

  return (
    <div ref={box} style={{ height: Math.max(160, data.length * 34 + 24) }} role="img" aria-label={`Projects by ${subject}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: axis.rightMargin, left: 0, bottom: 0 }} accessibilityLayer>
          <CartesianGrid stroke={chartChrome.grid} horizontal={false} />
          <XAxis
            type="number" stroke={chartChrome.axis} fontSize={11} tickLine={false}
            tickFormatter={measure === 'share' ? pct : axisMoneyFor(Math.max(0, ...rows.map(r => r.amount)))}
            domain={measure === 'share' ? [0, (max: number) => Math.min(100, Math.ceil(max / 10) * 10 || 10)] : [0, 'auto']}
          />
          <YAxis
            type="category" dataKey="label" stroke={chartChrome.axis} tickLine={false} width={axis.axisWidth}
            tick={(props: object) => <CategoryTick {...props} maxChars={axis.maxChars} />}
          />
          <Tooltip
            cursor={chartChrome.cursor}
            {...chartChrome.tooltip}
            formatter={(_v: number, _n: string, item: { payload?: ProjectConsumptionRow }) => {
              const r = item.payload;
              if (!r) return ['', ''];
              return measure === 'share'
                ? [`${pct(r.shareOfProject * 100)} of its own ${inrCompact(r.projectTotal)} (${formatINR(r.amount)})`, subject]
                : [`${formatINR(r.amount)} · ${pct(r.shareOfCategory * 100)} of all ${subject}`, subject];
            }}
          />
          <Bar dataKey="value" fill={palette.single} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={animate}>
            <LabelList
              dataKey="value"
              content={(props) => {
                const p = props as { x?: number; y?: number; width?: number; height?: number; index?: number };
                const row = p.index === undefined ? undefined : rows[p.index];
                return row ? <TipLabel {...p} text={tipText(row)} /> : null;
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Month by month ────────────────────────────────────────────────────────────

/**
 * The chosen category's spending per month — one series, so no legend; the title names it.
 *
 * Only the highest month is labelled: it is the one a reader looks for, and a value on every
 * column would be noise the axis and tooltip already carry.
 */
function TrendChart({ points, subject }: { points: { period: string; spent: number }[]; subject: string }) {
  const palette = usePalette();
  const animate = useAnimate();
  const labels = axisMonthLabels(points.map(p => p.period));
  const data = points.map((p, i) => ({ ...p, label: labels[i] }));
  const peak = points.reduce((best, p, i) => (p.spent > (points[best]?.spent ?? -1) ? i : best), 0);

  return (
    <div className="h-64" role="img" aria-label={`${subject} by month`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
          <CartesianGrid stroke={chartChrome.grid} vertical={false} />
          <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} />
          <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={axisMoneyFor(Math.max(0, ...points.map(p => p.spent)))} width={56} />
          <Tooltip
            cursor={chartChrome.cursor}
            {...chartChrome.tooltip}
            labelFormatter={(_label, payload) => {
              const period = (payload?.[0]?.payload as { period?: string } | undefined)?.period;
              return period ? periodLabel(period) : '';
            }}
            formatter={(value: number) => [formatINR(Number(value)), subject]}
          />
          <Bar dataKey="spent" fill={palette.single} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={animate}>
            <LabelList
              dataKey="spent"
              content={(props) => {
                const p = props as { x?: number; y?: number; width?: number; index?: number; value?: number };
                if (p.index !== peak || !p.value || p.x === undefined || p.y === undefined) return null;
                return (
                  <text x={p.x + (p.width ?? 0) / 2} y={p.y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="hsl(var(--foreground))">
                    {inrCompact(p.value)}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── The grid ──────────────────────────────────────────────────────────────────

/**
 * Projects × categories as a shaded table.
 *
 * A heatmap is a grid of magnitudes, so one hue, light to dark, with zero left blank rather than
 * given the palest step. The figure is printed in every cell — set in ink chosen by the fill's own
 * luminance, the one place text sits on a data colour — so the shade is a guide, never the only
 * way to read a value. Column headings are buttons: clicking one ranks the projects by it.
 */
function CategoryGrid({
  matrix, selected, onSelect,
}: {
  matrix: ReturnType<typeof categoryMatrix>;
  selected: string | null;
  onSelect: (category: string) => void;
}) {
  const palette = usePalette();
  const ramp = palette.sequential;
  const otherColumn = matrix.otherNames.length ? matrix.columns.length - 1 : -1;

  return (
    <div className="space-y-2">
      {/* A native scroll container: the ScrollArea wrapper swallows scrollbars on wide tables. */}
      <div className="max-h-[520px] min-w-0 overflow-auto rounded-md border border-slate-100">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600">Project</th>
              {matrix.columns.map((column, i) => {
                const isOther = i === otherColumn;
                const active = !isOther && column === selected;
                return (
                  <th key={column} className="px-1 py-1.5 text-right font-medium">
                    {isOther ? (
                      <span className="inline-block px-2 py-1 text-slate-500" title={matrix.otherNames.join(', ')}>{column}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelect(column)}
                        aria-pressed={active}
                        title={`Rank projects by ${column}`}
                        className={cn(
                          'max-w-[9rem] truncate rounded px-2 py-1 text-right transition-colors',
                          active ? 'bg-foreground text-background' : 'text-slate-600 hover:bg-slate-200/70',
                        )}
                      >
                        {column}
                      </button>
                    )}
                  </th>
                );
              })}
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Total</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map(row => (
              <tr key={row.key}>
                <td className="sticky left-0 z-[1] max-w-[11rem] truncate border-t border-slate-100 bg-white px-3 py-1.5 font-medium text-slate-700" title={row.label}>
                  {row.label}
                </td>
                {row.cells.map((value, i) => {
                  const step = sequentialStep(value, matrix.max, ramp.length);
                  const fill = step >= 0 ? ramp[step] : undefined;
                  const active = i !== otherColumn && matrix.columns[i] === selected;
                  return (
                    <td
                      key={i}
                      className={cn(
                        'border-t border-slate-100 px-2 py-1.5 text-right tabular-nums',
                        // The selected column is outlined, so the grid and the ranking visibly pair up.
                        active && 'outline outline-2 -outline-offset-2 outline-foreground/40',
                      )}
                      style={fill ? { backgroundColor: fill, color: inkOn(fill) } : undefined}
                      title={`${row.label} · ${matrix.columns[i]}: ${formatINR(value)}${row.total ? ` (${pct((value / row.total) * 100)} of its spend)` : ''}`}
                    >
                      {value > 0 ? inrCompact(value) : <span className="text-slate-300">—</span>}
                    </td>
                  );
                })}
                <td className="border-t border-slate-100 px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">
                  {inrCompact(row.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The scale, so a shade can be read back as a rough amount. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span>Less</span>
        <span className="inline-flex overflow-hidden rounded-sm">
          {ramp.map(colour => <span key={colour} className="h-2.5 w-5" style={{ backgroundColor: colour }} />)}
        </span>
        {/* "Highest", not "darkest": in dark mode the scale runs the other way. */}
        <span>More · highest is {inrCompact(matrix.max)}</span>
        <span className="text-slate-400">· “—” is nothing spent</span>
      </div>
    </div>
  );
}

// ── The section ───────────────────────────────────────────────────────────────

export function CategoryProjectReport({
  scope,
  projects,
  expenses,
  onCompareAllProjects,
}: {
  /** The tab's scope — the same months and projects as every chart above. */
  scope: ChartScope;
  projects: ChartProject[];
  expenses: ChartExpense[];
  /** Switches the tab's project filter back to all projects. */
  onCompareAllProjects: () => void;
}) {
  const [chosenCategory, setChosenCategory] = useState<string>('');
  const [chosenSub, setChosenSub] = useState<string>(ALL);
  const [measure, setMeasure] = useState<ConsumptionMeasure>('amount');

  const options = useMemo(() => categoryOptions(scope, expenses), [scope, expenses]);
  /*
   * The chosen category, resolved against what this scope actually has. Starts on the largest —
   * that is the one most worth comparing — and falls back to it whenever the months or projects
   * change underneath a choice that no longer exists there.
   */
  const category: string | null = chosenCategory === ALL
    ? null
    : options.some(o => o.name === chosenCategory) ? chosenCategory : options[0]?.name ?? null;

  const subOptions = useMemo(
    () => (category ? subCategoryOptions(scope, expenses, category) : []),
    [scope, expenses, category],
  );
  // A sub-category picker with one choice is a label pretending to be a control.
  const showSub = subOptions.length > 1;
  const subCategory = showSub && subOptions.some(o => o.name === chosenSub) ? chosenSub : null;

  const ranking = useMemo(
    () => projectConsumption({ scope, projects, expenses, category, subCategory, measure }),
    [scope, projects, expenses, category, subCategory, measure],
  );
  const matrix = useMemo(() => categoryMatrix({ scope, projects, expenses }), [scope, projects, expenses]);
  const trend = useMemo(
    () => categoryTrend(scope, expenses, category, subCategory),
    [scope, expenses, category, subCategory],
  );

  const subject = category === null ? 'all spending' : subCategory ? `${category} · ${subCategory}` : category;
  const comparingOne = scope.projectIds !== null && scope.projectIds.length === 1;

  function pickCategory(name: string) {
    setChosenCategory(name);
    setChosenSub(ALL);
  }

  return (
    <section className="space-y-3" aria-labelledby="category-report-heading">
      <div>
        <h2 id="category-report-heading" className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <Layers className="h-4 w-4 text-slate-500" />
          Projects by category
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Pick a category to see which projects consume the most of it — in rupees, or as a share of each project’s own spending.
        </p>
      </div>

      {comparingOne ? (
        // Ranking one project against itself is a single bar; say so rather than draw it.
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white py-10 text-center">
          <Users className="h-7 w-7 text-slate-300" />
          <p className="text-sm text-slate-600">Comparing projects needs more than one project in view.</p>
          <Button variant="outline" size="sm" onClick={onCompareAllProjects}>Compare all projects</Button>
        </div>
      ) : options.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-10 text-center text-sm text-muted-foreground">
          No spending in this period to compare.
        </div>
      ) : (
        <>
          {/* ── This section's controls, in one row above the panels they drive ── */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:flex-wrap md:items-center">
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs font-medium text-slate-600 md:w-auto">Category</span>
              <Select value={category ?? ALL} onValueChange={pickCategory}>
                <SelectTrigger className="w-full md:w-[260px]" aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value={ALL}>All categories (total spending)</SelectItem>
                  {options.map(o => (
                    <SelectItem key={o.name} value={o.name}>
                      {o.name} · {inrCompact(o.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showSub && (
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs font-medium text-slate-600 md:w-auto">Sub-category</span>
                <Select value={subCategory ?? ALL} onValueChange={setChosenSub}>
                  <SelectTrigger className="w-full md:w-[220px]" aria-label="Sub-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value={ALL}>All of {category}</SelectItem>
                    {subOptions.map(o => (
                      <SelectItem key={o.name} value={o.name}>{o.name} · {inrCompact(o.value)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center gap-2 md:ml-auto">
              <span className="w-20 shrink-0 text-xs font-medium text-slate-600 md:w-auto">Rank by</span>
              <div className="inline-flex rounded-md border border-slate-200 p-0.5" role="radiogroup" aria-label="Rank by">
                {([
                  { value: 'amount', label: 'Amount' },
                  { value: 'share', label: '% of project spend' },
                ] as const).map(option => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={measure === option.value}
                    disabled={category === null && option.value === 'share'}
                    onClick={() => setMeasure(option.value)}
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                      measure === option.value ? 'bg-foreground text-background' : 'text-slate-600 hover:bg-slate-100',
                    )}
                    // Every project's share of "all spending" is 100% — ranking by it means nothing.
                    title={category === null && option.value === 'share' ? 'Pick a category to rank by share' : undefined}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <ChartPanel
              className="xl:col-span-2"
              title={category === null ? 'Projects by total spending' : `Who spends most on ${subject}`}
              description={measure === 'share' && category !== null
                ? `Share of each project’s own spending that went on ${subject}.`
                : `${inrCompact(ranking.total)} across ${ranking.rows.length} project${ranking.rows.length === 1 ? '' : 's'}.`}
              table={{
                head: ['Project', 'Spent on it', 'Of its spend', 'Of all of it'],
                numericFrom: 1,
                rows: ranking.rows.map(r => [r.label, formatINR(r.amount), pct(r.shareOfProject * 100), pct(r.shareOfCategory * 100)]),
              }}
              footer={ranking.rows.length > MAX_RANKED
                ? <>Showing the top {MAX_RANKED}; all {ranking.rows.length} are in the table view.</>
                : undefined}
            >
              {ranking.rows.length === 0
                ? <EmptyChart>No project spent on {subject} in this period.</EmptyChart>
                : (
                  <ConsumptionChart
                    // Remounted per measure, so the axis re-scales cleanly between ₹ and %.
                    key={measure}
                    rows={ranking.rows.slice(0, MAX_RANKED)}
                    measure={category === null ? 'amount' : measure}
                    subject={subject}
                  />
                )}
            </ChartPanel>

            <ChartPanel
              className="xl:col-span-3"
              title={`${category === null ? 'All spending' : subject} by month`}
              description="Whether consumption is rising or falling across the period — the same projects and months as the ranking."
              table={{
                head: ['Month', 'Spent'],
                numericFrom: 1,
                rows: trend.map(p => [periodLabel(p.period), formatINR(p.spent)]),
              }}
            >
              {trend.some(p => p.spent > 0)
                ? <TrendChart points={trend} subject={category === null ? 'All spending' : subject} />
                : <EmptyChart>No spending on {subject} in this period.</EmptyChart>}
            </ChartPanel>

            {/* The grid takes a full row: squeezed beside the ranking, most categories and the
                Total column sat behind a horizontal scroll. */}
            <ChartPanel
              className="xl:col-span-5"
              title="Projects × categories"
              description="Every project against the largest categories. Click a column to rank projects by it."
              table={{
                head: ['Project', ...matrix.columns, 'Total'],
                numericFrom: 1,
                rows: matrix.rows.map(r => [r.label, ...r.cells.map(v => formatINR(v)), formatINR(r.total)]),
              }}
              footer={matrix.otherNames.length > 0 ? <>Other: {matrix.otherNames.join(', ')}</> : undefined}
            >
              <CategoryGrid matrix={matrix} selected={category} onSelect={pickCategory} />
            </ChartPanel>
          </div>
        </>
      )}
    </section>
  );
}
