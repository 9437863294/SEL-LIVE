'use client';

/**
 * The pieces of the Daily Requisition overview (`/daily-requisition`) that are drawn rather than
 * charted: the period switch, the figure groups, the stage cards with their wait profile, the wait
 * bars, sparklines and tags. Theme tokens throughout, so each reads in dark mode as well.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Check, ChevronRight } from 'lucide-react';
import { formatInr } from '@/lib/bank-balance-ledger';
import type { BandFigure, DashboardPeriod, OpenStage, StageProfile } from '@/lib/daily-requisition-dashboard';
import { cn } from '@/lib/utils';
import { useDashboardPalette } from './dashboard-charts';

/** ₹33.41 Cr · ₹1.69 L · ₹12,258 — Indian units to two places, whole rupees below a lakh. */
export function inrShort(value: number): string {
  const amount = Number(value) || 0;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export const days = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('en-IN')} ${n === 1 ? 'day' : 'days'}`);

/* ── small parts ──────────────────────────────────────────────────────────────────────────────── */

const TAG_TONES = {
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-800',
  green: 'bg-emerald-50 text-emerald-700',
  blue: 'bg-blue-50 text-blue-700',
  grey: 'bg-muted text-muted-foreground',
} as const;
export type TagTone = keyof typeof TAG_TONES;

export function Tag({ tone = 'grey', children, className }: { tone?: TagTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums', TAG_TONES[tone], className)}>
      {children}
    </span>
  );
}

/** "● Live · updated 11:06 am": the requisitions come from a live listener, not a one-off read. */
export function LiveStatus({ live, updatedAt }: { live: boolean; updatedAt: Date | null }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
      title={live ? 'Changes made by anyone show here as they happen.' : 'Not connected — the figures may be out of date.'}
    >
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-full', live ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(34,197,94,0.18)]' : 'bg-slate-400')}
      />
      {live ? 'Live' : 'Offline'}
      {updatedAt ? ` · updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
    </span>
  );
}

/** The period choices the overview offers, as one segmented switch. */
export const PERIOD_SEGMENTS: ReadonlyArray<{ value: DashboardPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'this-week', label: 'Week' },
  { value: 'this-month', label: 'Month' },
  { value: 'this-quarter', label: 'Quarter' },
  { value: 'this-fy', label: 'FY' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

export function PeriodSegments({ value, onChange }: { value: DashboardPeriod; onChange: (value: DashboardPeriod) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Period"
      className="flex h-9 w-full items-center gap-0.5 overflow-x-auto rounded-md border border-input bg-white p-0.5 shadow-sm sm:w-auto"
    >
      {PERIOD_SEGMENTS.map((segment) => {
        const on = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(segment.value)}
            className={cn(
              'h-full shrink-0 rounded px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
              on && 'bg-foreground text-background hover:text-background',
            )}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}

/** A switch between views of one panel (Amount / Count, Project / Dept / Vendor). */
export function MiniTabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex items-center gap-0.5 rounded-md bg-muted/70 p-0.5">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
              on && 'bg-card text-foreground shadow-sm',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A week-by-week line, scaled to its own range. Weeks with nothing to show leave a gap. */
export function Sparkline({ values, className }: { values: Array<number | null>; className?: string }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return <span className={cn('block h-8 w-28', className)} aria-hidden="true" />;
  const max = Math.max(...known);
  const min = Math.min(...known);
  const width = 112;
  const height = 32;
  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => height - 3 - ((value - min) / (max - min || 1)) * (height - 6);
  const points = values
    .map((value, index) => (value === null ? null : `${x(index).toFixed(1)},${y(value).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-8 w-28 shrink-0 overflow-visible', className)} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {last !== null ? <circle cx={x(values.length - 1)} cy={y(last)} r="2.5" fill="currentColor" /> : null}
    </svg>
  );
}

/* ── the headline figures ─────────────────────────────────────────────────────────────────────── */

/** A titled group of figures side by side ("Right now", "This month"), stacked on a phone. */
export function KpiGroup({ title, note, children, className }: { title: ReactNode; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm', className)}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <h2 className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {note ? <span className="truncate text-[11px] text-muted-foreground">{note}</span> : null}
      </div>
      <div className="grid divide-y sm:auto-cols-fr sm:grid-flow-col sm:divide-x sm:divide-y-0">{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  tag,
  value,
  valueTitle,
  valueClassName,
  sub,
  href,
}: {
  label: string;
  tag?: ReactNode;
  value: ReactNode;
  /** The exact figure, on hover, when `value` is rounded. */
  valueTitle?: string;
  valueClassName?: string;
  sub?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        {tag}
      </div>
      <div className={cn('mt-1 truncate text-2xl font-bold leading-tight tracking-tight tabular-nums text-foreground', valueClassName)} title={valueTitle}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </>
  );
  return href ? (
    <Link href={href} className="group min-w-0 px-4 py-3 transition-colors hover:bg-muted/40">
      {body}
    </Link>
  ) : (
    <div className="min-w-0 px-4 py-3">{body}</div>
  );
}

/* ── how long work has waited ─────────────────────────────────────────────────────────────────── */

/** One thin bar split by wait band, each by how many requisitions are in it. */
export function BandBar({ bands, className }: { bands: BandFigure[]; className?: string }) {
  const palette = useDashboardPalette();
  const total = bands.reduce((sum, band) => sum + band.count, 0);
  return (
    <div
      className={cn('flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted', className)}
      role="img"
      aria-label={total ? bands.map((band) => `${band.label}: ${band.count}`).join(', ') : 'Nothing waiting'}
    >
      {total
        ? bands
            .filter((band) => band.count > 0)
            .map((band) => (
              <span
                key={band.key}
                className="h-full"
                style={{ width: `${(band.count / total) * 100}%`, minWidth: 3, backgroundColor: palette.bands[band.key] }}
                title={`${band.label}: ${band.count.toLocaleString('en-IN')}`}
              />
            ))
        : null}
    </div>
  );
}

export function BandLegend({ bands }: { bands: ReadonlyArray<{ key: BandFigure['key']; label: string }> }) {
  const palette = useDashboardPalette();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {bands.map((band) => (
        <span key={band.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: palette.bands[band.key] }} />
          {band.label}
        </span>
      ))}
    </div>
  );
}

/** Each wait band as a bar, by amount still due or by how many. */
export function WaitBars({ bands, by }: { bands: BandFigure[]; by: 'amount' | 'count' }) {
  const palette = useDashboardPalette();
  const measure = (band: BandFigure) => (by === 'amount' ? band.balance : band.count);
  const max = Math.max(0, ...bands.map(measure));
  return (
    <div className="space-y-2">
      {bands.map((band) => {
        const share = max > 0 ? (measure(band) / max) * 100 : 0;
        return (
          <div key={band.key} className="grid grid-cols-[4.25rem_minmax(0,1fr)_6.5rem] items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">{band.label}</span>
            <div className="h-6 overflow-hidden rounded bg-muted">
              <div
                className="flex h-full items-center rounded pl-2 text-xs font-semibold text-white"
                style={{ width: `${measure(band) > 0 ? Math.max(share, 1.5) : 0}%`, backgroundColor: palette.bands[band.key] }}
              >
                {share > 22 ? (by === 'amount' ? inrShort(band.balance) : band.count.toLocaleString('en-IN')) : null}
              </div>
            </div>
            <span className="text-right leading-tight">
              <span className="block text-sm font-semibold tabular-nums text-foreground" title={by === 'amount' ? formatInr(band.balance) : undefined}>
                {by === 'amount' ? inrShort(band.balance) : band.count.toLocaleString('en-IN')}
              </span>
              <span className="block text-[11px] tabular-nums text-muted-foreground">
                {by === 'amount' ? `${band.count.toLocaleString('en-IN')} ${band.count === 1 ? 'req' : 'reqs'}` : inrShort(band.balance)}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── the workflow, stage by stage ─────────────────────────────────────────────────────────────── */

const ageTone = (n: number | null, overdueDays: number, backlogDays: number) =>
  n === null ? undefined : n > backlogDays ? 'text-red-700' : n > overdueDays ? 'text-amber-700' : undefined;

/**
 * The three queues and what has been paid, in workflow order with arrows between. A stage card
 * picks that stage for the "Needs action" list (pressed again, it lets go).
 */
export function StageFlow({
  stages,
  selected,
  onSelect,
  paid,
  overdueDays,
  backlogDays,
}: {
  stages: Array<{ key: OpenStage; name: string; profile: StageProfile }>;
  selected: OpenStage | null;
  onSelect: (stage: OpenStage | null) => void;
  paid: { label: string; count: number; amount: number; avgCycleDays: number | null; lastPaidDays: number | null };
  overdueDays: number;
  backlogDays: number;
}) {
  const totalOpen = stages.reduce((sum, stage) => sum + stage.profile.count, 0);
  const arrow = (
    <span className="hidden items-center justify-center text-muted-foreground/60 lg:flex" aria-hidden="true">
      <ChevronRight className="h-5 w-5" />
    </span>
  );

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)_1.25rem_minmax(0,1fr)_1.25rem_minmax(0,1fr)]">
      {stages.map(({ key, name, profile }, index) => {
        const on = selected === key;
        const hot = profile.bands.some((band) => band.key === 'stale' && band.count > 0);
        const share = totalOpen ? Math.round((profile.count / totalOpen) * 100) : 0;
        return (
          <div key={key} className="contents">
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(on ? null : key)}
              title={on ? 'Show every stage in Needs action' : `Show only ${name} in Needs action`}
              className={cn(
                'min-w-0 rounded-lg border bg-card p-3 text-left transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                hot && 'border-red-200 bg-[linear-gradient(hsl(var(--card)),color-mix(in_srgb,#ef4444_6%,hsl(var(--card))))]',
                on && 'border-emerald-500 ring-2 ring-emerald-500/30',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {index + 1} · {name}
                </span>
                <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{share}% of open</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="text-2xl font-bold leading-none tracking-tight tabular-nums text-foreground">{profile.count.toLocaleString('en-IN')}</span>
                <span className="truncate text-sm font-semibold tabular-nums text-muted-foreground" title={formatInr(profile.balance)}>
                  {inrShort(profile.balance)}
                </span>
              </div>
              <BandBar bands={profile.bands} className="mt-2.5" />
              <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted-foreground">Median wait</dt>
                <dd className="text-right font-medium tabular-nums text-foreground">{days(profile.medianDays)}</dd>
                <dt className="text-muted-foreground">Oldest</dt>
                <dd className={cn('text-right font-medium tabular-nums text-foreground', ageTone(profile.oldestDays, overdueDays, backlogDays))}>
                  {days(profile.oldestDays)}
                </dd>
                <dt className="text-muted-foreground">Over {overdueDays} days</dt>
                <dd className={cn('text-right font-medium tabular-nums text-foreground', profile.overdue > 0 && 'text-red-700')}>
                  {profile.overdue.toLocaleString('en-IN')}
                </dd>
              </dl>
            </button>
            {arrow}
          </div>
        );
      })}
      <div className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-800">
            <Check className="h-4 w-4" aria-hidden="true" /> Paid
          </span>
          <span className="shrink-0 truncate text-[11px] font-medium text-emerald-700/80">{paid.label}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-2xl font-bold leading-none tracking-tight tabular-nums text-foreground">{paid.count.toLocaleString('en-IN')}</span>
          <span className="truncate text-sm font-semibold tabular-nums text-muted-foreground" title={formatInr(paid.amount)}>
            {inrShort(paid.amount)}
          </span>
        </div>
        {/* Level with the stage cards' figures, which sit under their wait bar. */}
        <dl className="mt-[1.625rem] grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">Avg. cycle time</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">{days(paid.avgCycleDays)}</dd>
          <dt className="text-muted-foreground">Last payment</dt>
          <dd className={cn('text-right font-medium tabular-nums text-foreground', (paid.lastPaidDays ?? 0) > 30 && 'text-amber-700')}>
            {paid.lastPaidDays === null ? '—' : paid.lastPaidDays === 0 ? 'Today' : `${days(paid.lastPaidDays)} ago`}
          </dd>
        </dl>
      </div>
    </div>
  );
}
