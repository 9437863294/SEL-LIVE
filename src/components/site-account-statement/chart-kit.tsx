'use client';

/**
 * The pieces every Site Account Statement chart is built from: palette, formatting, sizing, and
 * the panel with its table-view twin.
 *
 * Shared so that the dashboard's report sections look and behave as one system — the same blue
 * means the same thing, the same ₹ format reads the same way, and every chart can be switched to
 * a table — rather than each section drifting into its own variant.
 *
 * Colours are the app's validated finance palette — the hexes the Bank Balance, Daily Requisition
 * and Bill Tracking dashboards use — checked with the dataviz validator against this app's own card
 * surfaces: white in light mode, hsl(240 5% 12%) in dark.
 */

import { useEffect, useRef, useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { useReducedMotion, useTheme } from '@/components/theme/ThemeProvider';
import { periodLabel } from '@/lib/site-account-statement-period-range';
import { cn } from '@/lib/utils';

// ── Palette ───────────────────────────────────────────────────────────────────

const PALETTE = {
  light: {
    received: '#2a78d6',
    spent: '#eb6834',
    single: '#2a78d6',
    // Same blue ramp, one step lighter: the track a meter fills along.
    track: '#cde2fb',
    /*
     * Five steps of the blue ramp (250, 350, 450, 550, 700) for magnitude on a grid — more reads
     * darker. Validated as an ordinal ramp: monotone, every adjacent gap >= 0.06 L so neighbouring
     * shades stay distinct, and the palest step clears 2:1 on the white card (2.11:1) so a small
     * amount is still visibly a shade. Six steps cannot pass both: from 250 down, the ramp runs out
     * of lightness before a sixth distinct shade.
     */
    sequential: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'],
    /*
     * De-emphasis grey, for context beside the one series that matters (a previous period, the
     * categories other than the chosen one). 2.39:1 on white: visible, and clearly behind the blue.
     */
    muted: '#a3a8b1',
  },
  dark: {
    received: '#3987e5',
    spent: '#d95926',
    single: '#3987e5',
    track: '#184f95',
    // Anchored the other way on a dark surface: the most is the step furthest from the surface.
    // Validated the same way against hsl(240 5% 12%): gaps >= 0.06 L, near end 2.07:1.
    sequential: ['#184f95', '#2a78d6', '#5598e7', '#86b6ef', '#cde2fb'],
    muted: '#5b606a', // 2.66:1 on the dark card
  },
} as const;

/** Reserved status colours — identical in both modes, never reused for a series. */
export const STATUS = { warning: '#fab219', critical: '#d03b3b' } as const;

export function usePalette() {
  const { resolvedMode } = useTheme();
  return PALETTE[resolvedMode === 'dark' ? 'dark' : 'light'];
}

/** Recharts animates every mark in and ignores the reduced-motion setting; this honours it. */
export function useAnimate(): boolean {
  return !useReducedMotion();
}

/**
 * Ink for text set inside a coloured fill — the one place text sits on a data colour — chosen by
 * the fill's luminance so it always clears contrast, whichever end of the ramp it lands on.
 */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return luminance > 0.36 ? '#0b0b0b' : '#ffffff';
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** `₹12.43 Cr`, `₹76.25 L`, `₹85,430` — the format every dashboard in the app uses. */
export function inrCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const trim = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

/**
 * A money-axis formatter in one unit for the whole axis, chosen from its largest value. Axis
 * ticks drop the ₹ — the axis is plainly money.
 *
 * Formatting each tick on its own picks a unit per tick, so a scale running to ₹3.4 L labelled its first tick
 * "85,000" and the next "1.7 L" — two units on one ruler. Every tick here uses the unit of the
 * largest: "0.85 L · 1.7 L · 2.55 L · 3.4 L".
 */
export function axisMoneyFor(max: number): (value: number) => string {
  const trim = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');
  const abs = Math.abs(max);
  if (abs >= 1e7) return (v: number) => (Number(v) === 0 ? '0' : `${trim(Number(v) / 1e7)} Cr`);
  if (abs >= 1e5) return (v: number) => (Number(v) === 0 ? '0' : `${trim(Number(v) / 1e5)} L`);
  return (v: number) => Math.round(Number(v)).toLocaleString('en-IN');
}
export const pct = (value: number) => `${Math.round(value)}%`;

/**
 * Month labels for an axis: "Jul", with the year only where it changes — the first month and each
 * January ("Nov 25 · Dec · Jan 26 · Feb"). Repeating the year on every tick made each label too
 * wide for twelve to fit, and the axis silently dropped some of them.
 */
export function axisMonthLabels(periods: string[]): string[] {
  return periods.map((period, i) => {
    const [month, year] = periodLabel(period).split(' ');
    const showYear = i === 0 || period.endsWith('-01');
    return showYear ? `${month} ${year.slice(2)}` : month;
  });
}

/** A clean axis ceiling for a percentage scale that always shows the 100% line, in steps of 25. */
export function percentAxis(values: number[]): { max: number; ticks: number[] } {
  const max = Math.ceil((Math.max(100, ...values) * 1.08) / 25) * 25;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += max > 200 ? 50 : 25) ticks.push(t);
  return { max, ticks };
}

/** Legend entries in ink: the swatch beside the text carries identity, the text never wears it. */
export const inkLegend = (value: string) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{value}</span>;

// ── Horizontal bar sizing ─────────────────────────────────────────────────────

/**
 * The width a chart actually has, so a horizontal bar chart can size its name column to fit.
 *
 * A fixed 168px column left a phone with a sliver of plot: bars a few pixels long and their value
 * labels breaking across lines. Measured, the column shrinks with the card and the bars keep room.
 */
export function useBoxWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function categoryAxis(width: number): { axisWidth: number; maxChars: number; rightMargin: number } {
  const narrow = width > 0 && width < 480;
  return narrow
    ? { axisWidth: 96, maxChars: 13, rightMargin: 76 }
    : { axisWidth: 168, maxChars: 26, rightMargin: 104 };
}

/**
 * A category name on one line, truncated to fit, with the full name on hover.
 *
 * Drawn by hand because Recharts' own tick wraps at spaces whenever it judges a name too wide,
 * which stacked "Vehicle / Transportation" into two rows and misaligned it with its bar.
 */
export function CategoryTick({ x, y, payload, maxChars }: { x?: number; y?: number; payload?: { value?: string }; maxChars: number }) {
  const value = String(payload?.value ?? '');
  const text = value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
  return (
    <text x={(x ?? 0) - 4} y={y} dy={4} textAnchor="end" fontSize={11} fill="hsl(var(--muted-foreground))">
      <title>{value}</title>
      {text}
    </text>
  );
}

/** A value at a bar's tip, on one line — Recharts' own label wraps it, splitting "₹8.85 L" in two. */
export function TipLabel({ x, y, width, height, text }: { x?: number; y?: number; width?: number; height?: number; text: string }) {
  if (x === undefined || y === undefined) return null;
  return (
    <text x={x + (width ?? 0) + 6} y={y + (height ?? 0) / 2} dy={4} fontSize={11} fill="hsl(var(--muted-foreground))">
      {text}
    </text>
  );
}

// ── Panel with a table-view twin ──────────────────────────────────────────────

export interface TableView {
  head: string[];
  rows: string[][];
  /** Columns from this index on are figures, right-aligned. */
  numericFrom?: number;
}

/**
 * A chart card whose content can be switched to a plain table of the same figures.
 *
 * The table is the chart's equal, not a fallback: it is how a value is read without a pointer,
 * by a screen reader, or when two bars are too close to compare by eye.
 */
export function ChartPanel({
  title, description, table, footer, actions, className, children,
}: {
  title: string;
  description?: string;
  table: TableView;
  footer?: React.ReactNode;
  /** Extra header controls, beside the Chart/Table switch. */
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cn('flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <div className="flex rounded-md border border-slate-200 p-0.5" role="group" aria-label={`${title} view`}>
            {([
              { value: false, label: 'Chart', icon: BarChart3 },
              { value: true, label: 'Table', icon: Table2 },
            ] as const).map(option => {
              const Icon = option.icon;
              const active = asTable === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAsTable(option.value)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                    // Theme tokens, so the active segment inverts in dark mode instead of becoming
                    // dark-on-dark through the compatibility layer.
                    active ? 'bg-foreground text-background' : 'text-slate-600 hover:bg-slate-100',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>
      <div className="flex-1 p-4">
        {asTable ? <DataTable table={table} /> : children}
      </div>
      {footer && <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-500">{footer}</div>}
    </section>
  );
}

export function DataTable({ table }: { table: TableView }) {
  return (
    <div className="max-h-80 overflow-auto rounded-md border border-slate-100">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-50 text-slate-600">
          <tr>
            {table.head.map((h, i) => (
              <th key={`${h}-${i}`} className={cn('px-3 py-2 font-medium', i >= (table.numericFrom ?? 99) ? 'text-right' : 'text-left')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={cn('px-3 py-1.5 text-slate-700', i >= (table.numericFrom ?? 99) && 'text-right tabular-nums')}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyChart({ children }: { children: React.ReactNode }) {
  return <p className="flex h-full min-h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">{children}</p>;
}
