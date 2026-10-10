'use client';

/**
 * Graphical Reports — the Site Account Statement dashboard's charts tab.
 *
 * Four charts and a tile row, all scoped by one filter row above them (project, months), so every
 * number on the tab describes the same slice and they always agree with each other. The figures
 * come from `site-account-statement-charts.ts`, which is unit-tested; this file only draws them.
 *
 * Colours are the app's validated finance palette — the same hexes the Bank Balance, Daily
 * Requisition and Bill Tracking dashboards use — checked with the dataviz validator against this
 * app's own card surfaces: white in light mode, hsl(240 5% 12%) in dark. Received/spent is slots 1
 * and 2 (worst colour-blind separation ΔE 24.7 light, 26.8 dark); the budget bars add the reserved
 * status colours, which always carry a text label as well, so state is never colour alone.
 */

import { useMemo, useState } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Building2, Wallet,
} from 'lucide-react';
import { chartChrome } from '@/components/ui/chart';
import {
  formatINR,
  type SASBudget, type SASBudgetAllocation, type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import {
  balanceSeries, budgetUse, headlineFigures, monthlyFlow, spendByCategory,
  type BudgetUseRow, type ChartScope,
} from '@/lib/site-account-statement-charts';
import {
  describeRange, periodLabel, periodsBetween, resolvePreset, selectablePeriods,
  type PeriodRange,
} from '@/lib/site-account-statement-period-range';
import { PeriodRangePicker } from '@/components/site-account-statement/period-range-picker';
import { CategoryProjectReport } from '@/components/site-account-statement/category-project-report';
import {
  ChartPanel, CategoryTick, EmptyChart, STATUS, TipLabel,
  axisMoneyFor, axisMonthLabels, categoryAxis, inkLegend, inrCompact, pct, percentAxis,
  useAnimate, useBoxWidth, usePalette,
} from '@/components/site-account-statement/chart-kit';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Palette, formatting, sizing and the chart panel are shared with the other report sections.

// ── Stat tiles ────────────────────────────────────────────────────────────────

function StatTile({ label, value, title, children }: { label: string; value: string; title?: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      {/* Proportional figures: a big standalone number set in tabular figures looks loose. */}
      <p className="mt-1 truncate text-2xl font-semibold text-slate-900" title={title}>{value}</p>
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

/**
 * Budget used as a meter: the fill carries severity, the track is a lighter step of the same blue,
 * so the whole bar reads as one instrument. The text beside it says the state too — the fill's
 * colour is never the only signal.
 */
function BudgetMeter({ used }: { used: number }) {
  const palette = usePalette();
  const state = used > 100 ? 'over' : used >= 80 ? 'near' : 'within';
  const fill = state === 'over' ? STATUS.critical : state === 'near' ? STATUS.warning : palette.single;
  return (
    <div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: palette.track }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used)}
        aria-label="Budget used"
      >
        <div className="h-full rounded-full" style={{ width: `${Math.min(used, 100)}%`, backgroundColor: fill }} />
      </div>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
        {state !== 'within' && <AlertTriangle className="h-3 w-3" style={{ color: fill }} />}
        {state === 'over' ? 'Over budget' : state === 'near' ? 'Near the limit (80%+)' : 'Within budget'}
      </p>
    </div>
  );
}

// ── The charts ────────────────────────────────────────────────────────────────

interface FlowRow { label: string; period: string; received: number; spent: number }

/** Receipts and spending per month — two series, so a legend; one shared ₹ axis. */
function FlowChart({ rows }: { rows: FlowRow[] }) {
  const palette = usePalette();
  const animate = useAnimate();
  return (
    <div className="h-72" role="img" aria-label="Received and spent by month">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%" accessibilityLayer>
          <CartesianGrid stroke={chartChrome.grid} vertical={false} />
          <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} />
          <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={axisMoneyFor(Math.max(0, ...rows.map(r => Math.max(r.received, r.spent))))} width={56} />
          <Tooltip cursor={chartChrome.cursor} {...chartChrome.tooltip} formatter={(value: number, name: string) => [formatINR(Number(value)), name]} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={inkLegend} />
          <Bar dataKey="received" name="Received" fill={palette.received} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={animate} />
          <Bar dataKey="spent" name="Spent" fill={palette.spent} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={animate} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface BalanceRow { label: string; period: string; balance: number }

/**
 * Money in hand at each month end — one series, so no legend box; the title names it.
 *
 * Straight segments rather than a smoothed curve: a smoothed line draws balances between
 * month ends that never existed. Only the latest value is labelled; the axis and tooltip carry
 * the rest.
 */
function BalanceChart({ rows }: { rows: BalanceRow[] }) {
  const palette = usePalette();
  const last = rows.length - 1;
  const goesNegative = rows.some(r => r.balance < 0);
  return (
    <div className="h-72" role="img" aria-label="Balance in hand by month">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 20, right: 56, left: 0, bottom: 0 }} accessibilityLayer>
          <CartesianGrid stroke={chartChrome.grid} vertical={false} />
          <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} />
          <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={axisMoneyFor(Math.max(0, ...rows.map(r => Math.abs(r.balance))))} width={56} />
          <Tooltip
            cursor={{ stroke: chartChrome.axis, strokeWidth: 1 }}
            {...chartChrome.tooltip}
            formatter={(value: number) => [formatINR(Number(value)), 'Balance in hand']}
          />
          {/* Zero is drawn only when the balance crosses it — a line at the bottom edge otherwise is just noise. */}
          {goesNegative && <ReferenceLine y={0} stroke={chartChrome.axis} strokeWidth={1} />}
          <Area
            type="linear"
            dataKey="balance"
            name="Balance in hand"
            stroke={palette.single}
            strokeWidth={2}
            fill={palette.single}
            fillOpacity={0.1}
            dot={{ r: 4, fill: palette.single, stroke: chartChrome.surface, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: palette.single, stroke: chartChrome.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="balance"
              content={(props) => {
                const { x, y, value, index } = props as { x?: number; y?: number; value?: number; index?: number };
                if (index !== last || x === undefined || y === undefined || value === undefined) return null;
                return (
                  <text x={x + 8} y={y} dy={4} fontSize={11} fontWeight={600} fill="hsl(var(--foreground))">
                    {inrCompact(Number(value))}
                  </text>
                );
              }}
            />
          </Area>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface CategoryRow { name: string; value: number; share: number }

/** Spending by category — one measure across nominal categories, so one hue, ranked. */
function CategoryChart({ rows }: { rows: CategoryRow[] }) {
  const palette = usePalette();
  const animate = useAnimate();
  const [box, width] = useBoxWidth();
  const axis = categoryAxis(width);
  return (
    <div ref={box} style={{ height: Math.max(160, rows.length * 34 + 24) }} role="img" aria-label="Spending by category">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: axis.rightMargin, left: 0, bottom: 0 }} accessibilityLayer>
          <CartesianGrid stroke={chartChrome.grid} horizontal={false} />
          <XAxis type="number" stroke={chartChrome.axis} fontSize={11} tickLine={false} tickFormatter={axisMoneyFor(Math.max(0, ...rows.map(r => r.value)))} />
          <YAxis
            type="category" dataKey="name" stroke={chartChrome.axis} tickLine={false} width={axis.axisWidth}
            tick={(props: object) => <CategoryTick {...props} maxChars={axis.maxChars} />}
          />
          <Tooltip
            cursor={chartChrome.cursor}
            {...chartChrome.tooltip}
            formatter={(value: number, _name: string, item: { payload?: CategoryRow }) =>
              [`${formatINR(Number(value))} · ${pct((item.payload?.share ?? 0) * 100)} of spend`, 'Spent']}
          />
          <Bar dataKey="value" fill={palette.single} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={animate}>
            <LabelList
              dataKey="value"
              content={(props) => {
                const p = props as { x?: number; y?: number; width?: number; height?: number; value?: number };
                return <TipLabel {...p} text={inrCompact(Number(p.value ?? 0))} />;
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const MAX_BUDGET_ROWS = 15;

function budgetState(row: BudgetUseRow): 'within' | 'near' | 'over' {
  if (row.over) return 'over';
  return row.pct >= 80 ? 'near' : 'within';
}

/**
 * Budget used, as a percentage, against a hairline at 100%.
 *
 * Bars are coloured by state with the reserved status colours, and every bar is labelled with its
 * percentage and, past 80%, the state in words — so an over-budget site reads as over budget in
 * greyscale, in print, and to a reader who cannot tell red from blue.
 */
function BudgetChart({ rows, by }: { rows: BudgetUseRow[]; by: 'project' | 'month' }) {
  const palette = usePalette();
  const animate = useAnimate();
  const colour = (row: BudgetUseRow) => {
    const state = budgetState(row);
    return state === 'over' ? STATUS.critical : state === 'near' ? STATUS.warning : palette.single;
  };
  // Clean steps of 25 that always reach past 100%, so the budget line is on the scale and the
  // last tick is a round number rather than whatever the data's maximum happened to be.
  const axis = percentAxis(rows.map(r => r.pct));
  const label = (row: BudgetUseRow) => {
    const state = budgetState(row);
    return state === 'over' ? `${pct(row.pct)} · over` : state === 'near' ? `${pct(row.pct)} · near limit` : pct(row.pct);
  };
  const tooltip = (_value: number, _name: string, item: { payload?: BudgetUseRow }): [string, string] => {
    const row = item.payload;
    if (!row) return ['', ''];
    return [`${formatINR(row.spent)} of ${formatINR(row.budget)} (${pct(row.pct)})`, 'Spent of budget'];
  };

  // Months run left to right, as time does; projects are ranked top to bottom.
  if (by === 'month') {
    return (
      <div className="h-72" role="img" aria-label="Budget used by month">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
            <CartesianGrid stroke={chartChrome.grid} vertical={false} />
            <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} />
            <YAxis stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={pct} width={44} domain={[0, axis.max]} ticks={axis.ticks} />
            <Tooltip cursor={chartChrome.cursor} {...chartChrome.tooltip} formatter={tooltip} />
            <ReferenceLine y={100} stroke={chartChrome.axis} strokeWidth={1} label={{ value: 'Budget', position: 'insideTopRight', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={animate}>
              {rows.map(row => <Cell key={row.key} fill={colour(row)} />)}
              <LabelList dataKey="pct" position="top" formatter={(v: number) => pct(Number(v))} style={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return <ProjectBudgetChart rows={rows.slice(0, MAX_BUDGET_ROWS)} axis={axis} colour={colour} label={label} tooltip={tooltip} animate={animate} />;
}

/**
 * Budget used across projects, ranked. Its own component so it can measure itself: hooks cannot
 * follow the by-month branch's early return in `BudgetChart`.
 */
function ProjectBudgetChart({
  rows, axis, colour, label, tooltip, animate,
}: {
  rows: BudgetUseRow[];
  axis: { max: number; ticks: number[] };
  colour: (row: BudgetUseRow) => string;
  label: (row: BudgetUseRow) => string;
  tooltip: (value: number, name: string, item: { payload?: BudgetUseRow }) => [string, string];
  animate: boolean;
}) {
  const [box, width] = useBoxWidth();
  const names = categoryAxis(width);
  return (
    <div ref={box} style={{ height: Math.max(160, rows.length * 34 + 30) }} role="img" aria-label="Budget used by project">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 16, right: names.rightMargin, left: 0, bottom: 0 }} accessibilityLayer>
          <CartesianGrid stroke={chartChrome.grid} horizontal={false} />
          <XAxis type="number" stroke={chartChrome.axis} fontSize={11} tickLine={false} tickFormatter={pct} domain={[0, axis.max]} ticks={axis.ticks} />
          <YAxis
            type="category" dataKey="label" stroke={chartChrome.axis} tickLine={false} width={names.axisWidth}
            tick={(props: object) => <CategoryTick {...props} maxChars={names.maxChars} />}
          />
          <Tooltip cursor={chartChrome.cursor} {...chartChrome.tooltip} formatter={tooltip} />
          <ReferenceLine x={100} stroke={chartChrome.axis} strokeWidth={1} label={{ value: 'Budget', position: 'top', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <Bar dataKey="pct" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={animate}>
            {rows.map(row => <Cell key={row.key} fill={colour(row)} />)}
            <LabelList
              dataKey="pct"
              content={(props) => {
                const p = props as { x?: number; y?: number; width?: number; height?: number; index?: number };
                const row = p.index === undefined ? undefined : rows[p.index];
                return row ? <TipLabel {...p} text={label(row)} /> : null;
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The budget chart's key — three states, so a legend is owed; marks are squares, as the bars are. */
function BudgetLegend() {
  const palette = usePalette();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
      {[
        { colour: palette.single, label: 'Within budget' },
        { colour: STATUS.warning, label: 'Near the limit (80%+)' },
        { colour: STATUS.critical, label: 'Over budget' },
      ].map(item => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: item.colour }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ── The tab ───────────────────────────────────────────────────────────────────

export function GraphicalReports({
  projects,
  expenses,
  payments,
  budgets,
  allocations,
  truncated,
}: {
  /** Only the projects this user may see. */
  projects: SASProject[];
  expenses: SASExpense[];
  payments: SASPayment[];
  budgets: SASBudget[];
  allocations: SASBudgetAllocation[];
  /** The dashboard could not load every transaction, so totals are partial. */
  truncated: boolean;
}) {
  const [projectId, setProjectId] = useState<string>('all');
  // Twelve months by default: long enough for a trend to mean something.
  const [range, setRange] = useState<PeriodRange>(() => resolvePreset('last12')!);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.projectName.localeCompare(b.projectName)),
    [projects],
  );

  const periodOptions = useMemo(
    () => selectablePeriods([
      ...expenses.map(e => (e.expenseDate ?? '').slice(0, 7)),
      ...payments.map(p => (p.receiptDate ?? '').slice(0, 7)),
    ].filter(Boolean)),
    [expenses, payments],
  );

  const scope: ChartScope = useMemo(() => ({
    projectIds: projectId === 'all' ? projects.map(p => p.id) : [projectId],
    periods: periodsBetween(range.from, range.to),
  }), [projectId, projects, range]);

  /** The projects in the shape the chart functions take — one list, shared by every section. */
  const chartProjects = useMemo(() => projects.map(p => ({ id: p.id, name: p.projectName })), [projects]);

  const figures = useMemo(() => {
    const flow = monthlyFlow(scope, expenses, payments);
    const balance = balanceSeries(scope, expenses, payments);
    const categories = spendByCategory(scope, expenses, 8);
    const use = budgetUse({
      scope,
      projects: chartProjects,
      expenses, budgets, allocations,
      periodLabel,
    });
    const headline = headlineFigures(flow, balance, use);
    return { flow, balance, categories, use, headline };
  }, [scope, expenses, payments, budgets, allocations, chartProjects]);

  const labels = axisMonthLabels(scope.periods);
  const flowRows: FlowRow[] = figures.flow.map((p, i) => ({ ...p, label: labels[i] }));
  const balanceRows: BalanceRow[] = figures.balance.points.map((p, i) => ({ ...p, label: labels[i] }));
  const hasActivity = figures.flow.some(p => p.received !== 0 || p.spent !== 0);
  const { headline, use, categories } = figures;
  // Distinct categories, not bars: "Other (3)" is one bar standing for three.
  const categoryCount = categories.slices.length + Math.max(0, categories.otherNames.length - 1);
  const scopeName = projectId === 'all' ? 'all projects' : sortedProjects.find(p => p.id === projectId)?.projectName ?? 'this project';

  return (
    <div className="space-y-4">
      {/* ── One filter row, above everything it scopes ── */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0 text-slate-500" />
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-full lg:w-[240px]" aria-label="Project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects ({sortedProjects.length})</SelectItem>
              {sortedProjects.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.projectName}{p.projectCode ? ` (${p.projectCode})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <PeriodRangePicker range={range} onChange={setRange} options={periodOptions} className="min-w-0 flex-1" />
      </div>

      {truncated && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">
            There are more transactions than the dashboard loads at once, so these charts are based on
            the most recent records only. Use the reports for exact figures.
          </p>
        </div>
      )}

      {/* ── Headline figures, from the same results the charts use ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Received" value={inrCompact(headline.received)} title={formatINR(headline.received)} />
        <StatTile label="Spent" value={inrCompact(headline.spent)} title={formatINR(headline.spent)} />
        <StatTile label="Net for the period" value={inrCompact(headline.net)} title={formatINR(headline.net)}>
          {/* Direction in words and an arrow, not colour alone. */}
          <p className={cn('flex items-center gap-1 text-[11px] font-medium', headline.net >= 0 ? 'text-emerald-700' : 'text-red-700')}>
            {headline.net >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {headline.net >= 0 ? 'Received more than spent' : 'Spent more than received'}
          </p>
        </StatTile>
        <StatTile
          label="Budget used"
          value={headline.budgetUsedPct === null ? '—' : pct(headline.budgetUsedPct)}
          title={headline.budgetUsedPct === null ? undefined : `${formatINR(use.rows.reduce((s, r) => s + r.spent, 0))} of ${formatINR(headline.budget)}`}
        >
          {headline.budgetUsedPct === null
            ? <p className="text-[11px] text-slate-500">No budget set for this period</p>
            : <BudgetMeter used={headline.budgetUsedPct} />}
        </StatTile>
      </div>

      {!hasActivity ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-14 text-center">
          <Wallet className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">Nothing recorded for {scopeName} in {describeRange(range)}</p>
          <p className="text-xs text-muted-foreground">Pick a wider range or another project.</p>
        </div>
      ) : (
        // `grid-cols-1` is explicit: without a base column the panels stretch past a phone.
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartPanel
            title="Received vs spent"
            description={`Money received from Head Office and spent on site, by month · ${describeRange(range)}`}
            table={{
              head: ['Month', 'Received', 'Spent', 'Net'],
              numericFrom: 1,
              rows: figures.flow.map(p => [periodLabel(p.period), formatINR(p.received), formatINR(p.spent), formatINR(p.net)]),
            }}
          >
            <FlowChart rows={flowRows} />
          </ChartPanel>

          <ChartPanel
            title="Balance in hand"
            description="Everything received less everything spent, at each month end — including what was carried in from before the range."
            table={{
              head: ['Month end', 'Balance'],
              numericFrom: 1,
              rows: [
                ['Carried in', formatINR(figures.balance.opening)],
                ...figures.balance.points.map(p => [periodLabel(p.period), formatINR(p.balance)]),
              ],
            }}
            footer={<>Carried in at the start: <span className="font-medium text-slate-700">{formatINR(figures.balance.opening)}</span></>}
          >
            <BalanceChart rows={balanceRows} />
          </ChartPanel>

          <ChartPanel
            title="Spend by category"
            description={`Where the money went · ${inrCompact(categories.total)} across ${categoryCount} ${categoryCount === 1 ? 'category' : 'categories'}`}
            table={{
              head: ['Category', 'Spent', 'Share'],
              numericFrom: 1,
              rows: categories.slices.map(s => [s.name, formatINR(s.value), pct(s.share * 100)]),
            }}
            footer={categories.otherNames.length > 0
              ? <>Other: {categories.otherNames.join(', ')}</>
              : undefined}
          >
            {categories.slices.length === 0
              ? <EmptyChart>No spending in this period.</EmptyChart>
              : <CategoryChart rows={categories.slices} />}
          </ChartPanel>

          <ChartPanel
            title={use.by === 'month' ? 'Budget used by month' : 'Budget used by project'}
            description={use.by === 'month'
              ? 'Each month’s spending against its budget (monthly budget plus verified allocations).'
              : 'Spending against each project’s budget for these months, most used first.'}
            table={{
              head: [use.by === 'month' ? 'Month' : 'Project', 'Budget', 'Spent', 'Used'],
              numericFrom: 1,
              rows: use.rows.map(r => [r.label, formatINR(r.budget), formatINR(r.spent), pct(r.pct)]),
            }}
            footer={(use.unbudgeted.length > 0 || use.rows.length > MAX_BUDGET_ROWS) ? (
              <div className="space-y-0.5">
                {use.by === 'project' && use.rows.length > MAX_BUDGET_ROWS && (
                  <p>Showing the {MAX_BUDGET_ROWS} most used; all {use.rows.length} are in the table view.</p>
                )}
                {use.unbudgeted.length > 0 && (
                  <p>
                    No budget for this period:{' '}
                    {use.unbudgeted.slice(0, 6).join(', ')}
                    {use.unbudgeted.length > 6 ? ` and ${use.unbudgeted.length - 6} more` : ''}.
                    {use.by === 'project' && ' A total budget is not split across months; FY budgets apply to whole financial years.'}
                  </p>
                )}
              </div>
            ) : undefined}
          >
            {use.rows.length === 0 ? (
              <EmptyChart>
                {use.by === 'month'
                  ? 'No monthly budgets set for these months.'
                  : 'No project has a budget for these months.'}
              </EmptyChart>
            ) : (
              <>
                <BudgetChart rows={use.rows} by={use.by} />
                <BudgetLegend />
              </>
            )}
          </ChartPanel>
        </div>
      )}

      {/* ── Projects by category — same months and projects, its own category controls ── */}
      {hasActivity && (
        <CategoryProjectReport
          scope={scope}
          projects={chartProjects}
          expenses={expenses}
          onCompareAllProjects={() => setProjectId('all')}
        />
      )}
    </div>
  );
}
