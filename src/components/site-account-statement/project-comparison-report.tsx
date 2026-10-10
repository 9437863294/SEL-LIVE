'use client';

/**
 * Project comparison — one category, every project side by side.
 *
 * The dashboard's third tab: pick a category, and see how much of it each project consumes, as a
 * line across the projects (the way the request sketched it) or as columns. Its own filter row
 * scopes everything on the tab; the figures come from `projectComparison` in
 * `site-account-statement-charts.ts`, which is unit-tested.
 *
 * Beyond the sketch:
 *   - the same figure for the previous period of equal length, as a grey context line, with the
 *     change per project — "consuming more" is as much about "more than before" as "more than others";
 *   - an average line, so a project reads as above or below the rest at a glance;
 *   - three measures (rupees, share of the project's own spending, per month) and two orders;
 *   - click a project to see where all of its money went, the chosen category highlighted;
 *   - a summary table and an Excel export of exactly what is on screen.
 *
 * On the line: projects have no order, so the slope between two neighbours is not a trend. The
 * line is offered because it was asked for and is easy to scan; columns are one click away and are
 * the more literal reading. Neither is smoothed — a curve would draw values between projects that
 * do not exist.
 */

import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  ArrowDownRight, ArrowUpRight, BarChart2, FileSpreadsheet, GitCompare, Loader2, Minus,
  MousePointerClick, Spline, Wallet,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { chartChrome } from '@/components/ui/chart';
import { formatINR, type SASExpense, type SASProject } from '@/lib/site-account-statement';
import {
  categoryOptions, previousScope, projectComparison, spendByCategory, subCategoryOptions,
  type ChartScope, type ComparisonMeasure, type ComparisonRow, type ComparisonSort,
} from '@/lib/site-account-statement-charts';
import {
  describeRange, periodsBetween, resolvePreset, selectablePeriods, type PeriodRange,
} from '@/lib/site-account-statement-period-range';
import { slugify } from '@/lib/print-table-report';
import { PeriodRangePicker } from '@/components/site-account-statement/period-range-picker';
import {
  CategoryTick, ChartPanel, DataTable, EmptyChart, TipLabel,
  axisMoneyFor, categoryAxis, inrCompact, pct, useAnimate, useBoxWidth, usePalette,
} from '@/components/site-account-statement/chart-kit';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const ALL = '__all__';

const MEASURES: { value: ComparisonMeasure; label: string; noun: string }[] = [
  { value: 'amount', label: 'Amount', noun: 'Spent' },
  { value: 'share', label: '% of project spend', noun: 'Share of its spend' },
  { value: 'monthly', label: 'Per month', noun: 'Average per month' },
];

function formatValue(measure: ComparisonMeasure, value: number): string {
  return measure === 'share' ? pct(value) : inrCompact(value);
}

/** A segmented control — the same look as the Chart/Table switch, so the tab reads as one set. */
function Segmented<T extends string>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }>; disabled?: boolean; title?: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs font-medium text-slate-600 md:w-auto">{label}</span>
      <div className="inline-flex flex-wrap rounded-md border border-slate-200 p-0.5" role="radiogroup" aria-label={label}>
        {options.map(option => {
          const Icon = option.icon;
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={option.disabled}
              title={option.title}
              onClick={() => onChange(option.value)}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                active ? 'bg-foreground text-background' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── The main chart ────────────────────────────────────────────────────────────

/**
 * The chart's key, in HTML below the plot rather than inside it.
 *
 * Outside the chart's sideways scroll, so on a phone it stays in view while the projects scroll;
 * and it names the average, whose value labelled inside the plot sat on whichever line crossed
 * the right edge. Keys mirror their marks: a line for a line, a square for a column.
 */
function ComparisonLegend({ items }: { items: { label: string; color: string; shape: 'line' | 'square' }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
      {items.map(item => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          {item.shape === 'line'
            ? <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: item.color }} />
            : <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: item.color }} />}
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * A project name under its point, on one line and truncated; tilted when there are many, so
 * neighbours do not collide.
 */
function ProjectTick({ x, y, payload, tilt, maxChars }: { x?: number; y?: number; payload?: { value?: string }; tilt: boolean; maxChars: number }) {
  const value = String(payload?.value ?? '');
  const text = value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text
        dy={tilt ? 6 : 14}
        textAnchor={tilt ? 'end' : 'middle'}
        transform={tilt ? 'rotate(-35)' : undefined}
        fontSize={11}
        fill="hsl(var(--muted-foreground))"
      >
        <title>{value}</title>
        {text}
      </text>
    </g>
  );
}

function ComparisonChart({
  rows, measure, style, showPrevious, average, selected, onSelect, subject,
}: {
  rows: ComparisonRow[];
  measure: ComparisonMeasure;
  style: 'line' | 'columns';
  showPrevious: boolean;
  average: number;
  selected: string | null;
  onSelect: (projectId: string) => void;
  subject: string;
}) {
  const palette = usePalette();
  const animate = useAnimate();
  const [box, boxWidth] = useBoxWidth();
  // Wide enough for every project to have room; scrolls sideways past that rather than crushing.
  const minWidth = Math.max(rows.length * 56, 320);
  /*
   * Names tilt only when they would not fit level — judged on the room each project actually has,
   * not on how many projects there are. Nine projects on a wide screen have plenty of room; nine
   * on a phone do not.
   */
  const perProject = (Math.max(boxWidth, minWidth) - 72) / Math.max(rows.length, 1);
  const tilt = perProject < 96;
  const max = Math.max(0, ...rows.map(r => Math.max(r.value, showPrevious ? r.previousValue : 0)));
  const tickY = measure === 'share' ? pct : axisMoneyFor(max);
  const peak = rows.reduce((best, r, i) => (r.value > (rows[best]?.value ?? -1) ? i : best), 0);
  const selectedLabel = rows.find(r => r.key === selected)?.label;

  const handleClick = (state: unknown) => {
    const row = (state as { activePayload?: { payload?: ComparisonRow }[] } | null)?.activePayload?.[0]?.payload;
    if (row) onSelect(row.key);
  };

  const tooltip = (
    <Tooltip
      key="tooltip"
      cursor={style === 'line' ? { stroke: chartChrome.axis, strokeWidth: 1 } : chartChrome.cursor}
      {...chartChrome.tooltip}
      formatter={(value: number, name: string) => [formatValue(measure, Number(value)), name]}
    />
  );
  /*
   * The parts both chart styles share, as an array of keyed elements — not a fragment. Recharts 2
   * finds its axes, grid and reference lines among a chart's direct children only; inside a
   * fragment it never sees them, and the chart draws a bare line with no axes at all.
   */
  const common = [
    <CartesianGrid key="grid" stroke={chartChrome.grid} vertical={false} />,
    <XAxis
      key="x"
      dataKey="label" stroke={chartChrome.axis} tickLine={false} interval={0}
      height={tilt ? 70 : 32}
      // On a line the first and last points sit on the plot's edges, so their names were cut in
      // half; padding the ends gives them room. Columns sit in bands and need none.
      padding={style === 'line' ? { left: 40, right: 40 } : undefined}
      tick={(props: object) => <ProjectTick {...props} tilt={tilt} maxChars={tilt ? 16 : 14} />}
    />,
    <YAxis key="y" stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={tickY} width={56} />,
    tooltip,
    // The average as a solid hairline — a reference, not a gridline, and never dashed.
    rows.length > 1 && (
      <ReferenceLine key="average" y={average} stroke={chartChrome.axis} strokeWidth={1} />
    ),
    selectedLabel && <ReferenceLine key="selected" x={selectedLabel} stroke={chartChrome.axis} strokeWidth={1} />,
  ];

  /*
   * Only the highest project carries its value; the axis, the tooltip and the table carry the rest.
   * On the line, it goes below the point when the previous period sits above it — otherwise the
   * label lands on the grey marker.
   */
  const peakLabel = (props: unknown) => {
    const p = props as { x?: number; y?: number; width?: number; index?: number; value?: number };
    if (p.index !== peak || !p.value || p.x === undefined || p.y === undefined) return null;
    const row = rows[peak];
    const below = style === 'line' && showPrevious && row && row.previousValue > row.value;
    return (
      <text x={p.x + (p.width ?? 0) / 2} y={below ? p.y + 22 : p.y - 10} textAnchor="middle" fontSize={11} fontWeight={600} fill="hsl(var(--foreground))">
        {formatValue(measure, p.value)}
      </text>
    );
  };

  const shape = style === 'line' ? 'line' as const : 'square' as const;
  const legend = [
    ...(showPrevious ? [{ label: 'Previous period', color: palette.muted, shape }] : []),
    { label: showPrevious ? 'This period' : subject, color: palette.single, shape },
    ...(rows.length > 1 ? [{ label: `Average ${formatValue(measure, average)}`, color: 'hsl(var(--muted-foreground))', shape: 'line' as const }] : []),
  ];

  return (
    <div>
    {/* A native scroll container: many projects scroll sideways instead of being crushed together. */}
    <div ref={box} className="min-w-0 overflow-x-auto">
      <div style={{ minWidth, height: tilt ? 320 : 280 }} role="img" aria-label={`${subject} by project`}>
        <ResponsiveContainer width="100%" height="100%">
          {style === 'line' ? (
            <ComposedChart data={rows} margin={{ top: 24, right: 16, left: 0, bottom: 0 }} onClick={handleClick} style={{ cursor: 'pointer' }} accessibilityLayer>
              {common}
              {showPrevious && (
                <Line
                  type="linear" dataKey="previousValue" name="Previous period"
                  stroke={palette.muted} strokeWidth={2}
                  dot={{ r: 4, fill: palette.muted, stroke: chartChrome.surface, strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: palette.muted, stroke: chartChrome.surface, strokeWidth: 2 }}
                  isAnimationActive={animate}
                />
              )}
              <Line
                type="linear" dataKey="value" name={showPrevious ? 'This period' : subject}
                stroke={palette.single} strokeWidth={2}
                dot={{ r: 4, fill: palette.single, stroke: chartChrome.surface, strokeWidth: 2 }}
                activeDot={{ r: 6, fill: palette.single, stroke: chartChrome.surface, strokeWidth: 2 }}
                isAnimationActive={animate}
              >
                <LabelList dataKey="value" content={peakLabel} />
              </Line>
            </ComposedChart>
          ) : (
            <BarChart data={rows} margin={{ top: 24, right: 16, left: 0, bottom: 0 }} barGap={2} onClick={handleClick} style={{ cursor: 'pointer' }} accessibilityLayer>
              {common}
              {showPrevious && (
                <Bar dataKey="previousValue" name="Previous period" fill={palette.muted} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={animate} />
              )}
              {/* One colour for the series — the selection is marked by the hairline, not by
                  fading the others, which read as a second series the legend did not name. */}
              <Bar dataKey="value" name={showPrevious ? 'This period' : subject} fill={palette.single} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={animate}>
                <LabelList dataKey="value" content={peakLabel} />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
    <ComparisonLegend items={legend} />
    </div>
  );
}

// ── One project, opened up ────────────────────────────────────────────────────

/**
 * Where one project's money went, with the chosen category in blue and the rest in grey.
 *
 * Emphasis rather than a rainbow: the question was about one category, so that bar is the point
 * and the others are the context that says how big it is.
 */
function ProjectBreakdown({ rows, highlight }: { rows: { name: string; value: number; share: number }[]; highlight: string | null }) {
  const palette = usePalette();
  const animate = useAnimate();
  const [box, width] = useBoxWidth();
  const axis = categoryAxis(width);
  const max = Math.max(0, ...rows.map(r => r.value));
  return (
    <div ref={box} style={{ height: Math.max(160, rows.length * 32 + 24) }} role="img" aria-label="Spending by category for the selected project">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: axis.rightMargin, left: 0, bottom: 0 }} accessibilityLayer>
          <CartesianGrid stroke={chartChrome.grid} horizontal={false} />
          <XAxis type="number" stroke={chartChrome.axis} fontSize={11} tickLine={false} tickFormatter={axisMoneyFor(max)} />
          <YAxis
            type="category" dataKey="name" stroke={chartChrome.axis} tickLine={false} width={axis.axisWidth}
            tick={(props: object) => <CategoryTick {...props} maxChars={axis.maxChars} />}
          />
          <Tooltip
            cursor={chartChrome.cursor}
            {...chartChrome.tooltip}
            formatter={(value: number, _n: string, item: { payload?: { share?: number } }) =>
              [`${formatINR(Number(value))} · ${pct((item.payload?.share ?? 0) * 100)} of its spend`, 'Spent']}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={animate}>
            {rows.map(row => (
              <Cell key={row.name} fill={highlight === null || row.name === highlight ? palette.single : palette.muted} />
            ))}
            <LabelList
              dataKey="value"
              content={(props) => {
                const p = props as { x?: number; y?: number; width?: number; height?: number; index?: number };
                const row = p.index === undefined ? undefined : rows[p.index];
                return row ? <TipLabel {...p} text={`${inrCompact(row.value)} · ${pct(row.share * 100)}`} /> : null;
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Stat tiles ────────────────────────────────────────────────────────────────

function Tile({ label, value, title, children }: { label: string; value: string; title?: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold text-slate-900" title={title}>{value}</p>
      {children && <div className="mt-1.5 min-w-0 text-[11px] text-slate-500">{children}</div>}
    </div>
  );
}

/** "+18% vs previous period", with an arrow and words — the colour is never the only cue. */
function ChangeNote({ change, changePct, measure }: { change: number; changePct: number | null; measure: ComparisonMeasure }) {
  if (changePct === null) return <span>No spending in the previous period to compare</span>;
  const flat = Math.abs(changePct) < 0.005;
  const up = change > 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium', flat ? 'text-slate-500' : up ? 'text-amber-700' : 'text-emerald-700')}>
      <Icon className="h-3 w-3 shrink-0" />
      {flat ? 'Same as' : `${up ? 'Up' : 'Down'} ${pct(Math.abs(changePct) * 100)} (${up ? '+' : '−'}${formatValue(measure, Math.abs(change))}) vs`} previous period
    </span>
  );
}

// ── The tab ───────────────────────────────────────────────────────────────────

export function ProjectComparisonReport({
  projects,
  expenses,
  truncated,
}: {
  /** Only the projects this user may see. */
  projects: SASProject[];
  expenses: SASExpense[];
  truncated: boolean;
}) {
  const { toast } = useToast();
  const [range, setRange] = useState<PeriodRange>(() => resolvePreset('last12')!);
  const [chosenCategory, setChosenCategory] = useState<string>(ALL);
  const [chosenSub, setChosenSub] = useState<string>(ALL);
  const [measure, setMeasure] = useState<ComparisonMeasure>('amount');
  const [sort, setSort] = useState<ComparisonSort>('project');
  const [style, setStyle] = useState<'line' | 'columns'>('line');
  const [showPrevious, setShowPrevious] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const chartProjects = useMemo(() => projects.map(p => ({ id: p.id, name: p.projectName })), [projects]);
  const codeOf = useMemo(() => new Map(projects.map(p => [p.id, p.projectCode ?? ''])), [projects]);

  const periodOptions = useMemo(
    () => selectablePeriods(expenses.map(e => (e.expenseDate ?? '').slice(0, 7)).filter(Boolean)),
    [expenses],
  );

  const scope: ChartScope = useMemo(() => ({
    projectIds: projects.map(p => p.id),
    periods: periodsBetween(range.from, range.to),
  }), [projects, range]);
  const before = useMemo(() => previousScope(scope), [scope]);

  // As the sketch: "ALL" first, then each category, largest first, with what it totals.
  const options = useMemo(() => categoryOptions(scope, expenses), [scope, expenses]);
  const category = chosenCategory !== ALL && options.some(o => o.name === chosenCategory) ? chosenCategory : null;
  const subOptions = useMemo(() => (category ? subCategoryOptions(scope, expenses, category) : []), [scope, expenses, category]);
  const showSub = subOptions.length > 1;
  const subCategory = showSub && subOptions.some(o => o.name === chosenSub) ? chosenSub : null;
  // "% of project spend" of all spending is 100% for every project — meaningless, so it falls back.
  const effectiveMeasure: ComparisonMeasure = category === null && measure === 'share' ? 'amount' : measure;

  const comparison = useMemo(
    () => projectComparison({ scope, projects: chartProjects, expenses, category, subCategory, measure: effectiveMeasure, sort }),
    [scope, chartProjects, expenses, category, subCategory, effectiveMeasure, sort],
  );

  const subject = category === null ? 'All spending' : subCategory ? `${category} · ${subCategory}` : category;
  const noun = MEASURES.find(m => m.value === effectiveMeasure)!.noun;
  // The project opened below the chart: the one clicked, or the highest until something is.
  const focusKey = selected && comparison.rows.some(r => r.key === selected) ? selected : comparison.highest?.key ?? null;
  const focus = comparison.rows.find(r => r.key === focusKey) ?? null;
  const breakdown = useMemo(
    () => (focusKey ? spendByCategory({ projectIds: [focusKey], periods: scope.periods }, expenses, 10).slices : []),
    [focusKey, scope.periods, expenses],
  );
  const totalChangePct = comparison.previousTotal > 0 ? (comparison.total - comparison.previousTotal) / comparison.previousTotal : null;

  function pickCategory(name: string) {
    setChosenCategory(name);
    setChosenSub(ALL);
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Project comparison');
      // Widths only — a `header` here would overwrite the title rows written below.
      ws.columns = [{ width: 32 }, { width: 12 }, { width: 18 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 12 }];
      ws.addRow([`Project comparison — ${subject}`]).font = { bold: true, size: 14 };
      ws.addRow(['Period', describeRange(range)]);
      ws.addRow(['Previous period', `${before.periods[0] ?? ''} to ${before.periods[before.periods.length - 1] ?? ''}`]);
      ws.addRow(['Generated', new Date().toLocaleString('en-IN')]);
      ws.addRow([]);
      const head = ws.addRow(['Project', 'Code', `${subject} (₹)`, '% of its spend', 'Per month (₹)', 'Previous period (₹)', 'Change (₹)', 'Change %']);
      head.font = { bold: true };
      head.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } }; });
      ws.views = [{ state: 'frozen', ySplit: head.number }];
      for (const r of comparison.rows) {
        const row = ws.addRow([
          r.label, codeOf.get(r.key) ?? '', r.amount, r.shareOfProject * 100, r.monthly,
          r.previousAmount, r.amount - r.previousAmount,
          r.previousAmount > 0 ? ((r.amount - r.previousAmount) / r.previousAmount) * 100 : null,
        ]);
        // Numbers with formats, not text — so the sheet can be summed, sorted and pivoted.
        [3, 5, 6, 7].forEach(c => { row.getCell(c).numFmt = '#,##0'; });
        [4, 8].forEach(c => { row.getCell(c).numFmt = '0.0"%"'; });
      }
      const totals = ws.addRow([
        `Total — ${comparison.rows.length} projects`, '', comparison.total, null, null,
        comparison.previousTotal, comparison.total - comparison.previousTotal,
        totalChangePct === null ? null : totalChangePct * 100,
      ]);
      totals.font = { bold: true };
      [3, 6, 7].forEach(c => { totals.getCell(c).numFmt = '#,##0'; });
      totals.getCell(8).numFmt = '0.0"%"';
      const buffer = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-comparison-${slugify(subject)}-${slugify(describeRange(range))}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: 'Export failed', description: e.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }

  /*
   * "Of its spend" only means something once a category is chosen — of all spending, every
   * project's share is 100%, which is a column of the same number. It is left out until then.
   */
  const withShare = category !== null;
  const tableHead = ['Project', 'Spent', ...(withShare ? ['Of its spend'] : []), 'Per month', 'Previous', 'Change'];
  // The change compares rupees with rupees, whatever the chart shows.
  const changeText = (r: ComparisonRow) => {
    if (r.previousAmount === 0) return r.amount > 0 ? 'New' : '—';
    const p = (r.amount - r.previousAmount) / r.previousAmount;
    return `${p >= 0 ? '+' : '−'}${pct(Math.abs(p) * 100)}`;
  };
  const tableRows = comparison.rows.map(r => [
    r.label,
    formatINR(r.amount),
    ...(withShare ? [pct(r.shareOfProject * 100)] : []),
    inrCompact(r.monthly),
    formatINR(r.previousAmount),
    changeText(r),
  ]);

  return (
    <div className="space-y-4">
      {/* ── One filter card, above everything on the tab ── */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-700 md:w-auto">Category</span>
            <Select value={category ?? ALL} onValueChange={pickCategory}>
              <SelectTrigger className="w-full lg:w-[260px]" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={ALL}>All categories</SelectItem>
                {options.map(o => (
                  <SelectItem key={o.name} value={o.name}>{o.name} · {inrCompact(o.value)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showSub && (
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-xs font-medium text-slate-600 md:w-auto">Sub-category</span>
              <Select value={subCategory ?? ALL} onValueChange={setChosenSub}>
                <SelectTrigger className="w-full lg:w-[220px]" aria-label="Sub-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value={ALL}>All of {category}</SelectItem>
                  {subOptions.map(o => <SelectItem key={o.name} value={o.name}>{o.name} · {inrCompact(o.value)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <PeriodRangePicker range={range} onChange={setRange} options={periodOptions} className="min-w-0 flex-1" compact />
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6">
          <Segmented
            label="Show"
            value={effectiveMeasure}
            onChange={setMeasure}
            options={MEASURES.map(m => ({
              value: m.value,
              label: m.label,
              disabled: category === null && m.value === 'share',
              title: category === null && m.value === 'share' ? 'Pick a category to compare shares' : undefined,
            }))}
          />
          <Segmented
            label="Order"
            value={sort}
            onChange={setSort}
            options={[{ value: 'project', label: 'Project order' }, { value: 'highest', label: 'Highest first' }]}
          />
          <Segmented
            label="Chart"
            value={style}
            onChange={setStyle}
            options={[{ value: 'line', label: 'Line', icon: Spline }, { value: 'columns', label: 'Columns', icon: BarChart2 }]}
          />
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
            <Switch checked={showPrevious} onCheckedChange={setShowPrevious} aria-label="Compare with the previous period" />
            <GitCompare className="h-3.5 w-3.5" />
            Compare with previous period
          </label>
        </div>
      </div>

      {truncated && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          There are more transactions than the dashboard loads at once, so this comparison is based on the most recent records only.
        </p>
      )}

      {comparison.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-14 text-center">
          <Wallet className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No spending recorded in {describeRange(range)}</p>
          <p className="text-xs text-muted-foreground">Pick a wider range.</p>
        </div>
      ) : (
        <>
          {/* ── Headline figures ── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={`${subject} — total`} value={inrCompact(comparison.total)} title={formatINR(comparison.total)}>
              <ChangeNote change={comparison.total - comparison.previousTotal} changePct={totalChangePct} measure="amount" />
            </Tile>
            <Tile label={effectiveMeasure === 'amount' ? 'Average per project' : `Average per project · ${noun.toLowerCase()}`} value={formatValue(effectiveMeasure, comparison.average)}>
              Across {comparison.rows.length} project{comparison.rows.length === 1 ? '' : 's'}
            </Tile>
            <Tile label="Highest" value={comparison.highest ? formatValue(effectiveMeasure, comparison.highest.value) : '—'}>
              <span className="block truncate" title={comparison.highest?.label}>{comparison.highest?.label}</span>
            </Tile>
            <Tile label="Lowest" value={comparison.lowest ? formatValue(effectiveMeasure, comparison.lowest.value) : '—'}>
              <span className="block truncate" title={comparison.lowest?.label}>{comparison.lowest?.label}</span>
            </Tile>
          </div>

          {/* ── The sketch: the category across every project ── */}
          <ChartPanel
            title={`${subject} by project`}
            description={`${noun}, ${describeRange(range)}${showPrevious ? ' — grey is the previous period of the same length' : ''}. Click a project to open it below.`}
            table={{
              head: tableHead,
              numericFrom: 1,
              rows: tableRows,
            }}
            footer={comparison.inactive.length > 0
              ? <>No spending at all in either period: {comparison.inactive.slice(0, 8).join(', ')}{comparison.inactive.length > 8 ? ` and ${comparison.inactive.length - 8} more` : ''}.</>
              : undefined}
          >
            <ComparisonChart
              // Remounted when the measure changes, so the axis re-scales cleanly between ₹ and %.
              key={effectiveMeasure}
              rows={comparison.rows}
              measure={effectiveMeasure}
              style={style}
              showPrevious={showPrevious}
              average={comparison.average}
              selected={focusKey}
              onSelect={setSelected}
              subject={subject}
            />
          </ChartPanel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            {/* ── One project, opened up ── */}
            <ChartPanel
              className="xl:col-span-2"
              title={focus ? `Where ${focus.label}'s money went` : 'Project breakdown'}
              description={focus
                ? `${inrCompact(focus.projectTotal)} in ${describeRange(range)}${category ? ` · ${category} in blue` : ''}.`
                : undefined}
              table={{
                head: ['Category', 'Spent', 'Of its spend'],
                numericFrom: 1,
                rows: breakdown.map(s => [s.name, formatINR(s.value), pct(s.share * 100)]),
              }}
              footer={<span className="inline-flex items-center gap-1"><MousePointerClick className="h-3 w-3" /> Click any project in the chart above to open it here.</span>}
            >
              {breakdown.length === 0
                ? <EmptyChart>{focus ? `${focus.label} spent nothing in this period.` : 'Pick a project in the chart.'}</EmptyChart>
                : <ProjectBreakdown rows={breakdown} highlight={category} />}
            </ChartPanel>

            {/* ── The summary, as a table to read and to export ── */}
            <ChartPanel
              className="xl:col-span-3"
              title="Summary"
              description={`${subject}, every project, in the order of the chart.`}
              table={{
                head: tableHead,
                numericFrom: 1,
                rows: tableRows,
              }}
              actions={(
                <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => void exportExcel()} disabled={exporting}>
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                  Excel
                </Button>
              )}
            >
              {/* The summary is a table either way; the switch is kept for consistency with the other panels. */}
              <DataTable table={{
                head: tableHead,
                numericFrom: 1,
                rows: tableRows,
              }} />
            </ChartPanel>
          </div>
        </>
      )}
    </div>
  );
}
