'use client';

/**
 * The Office Hub dashboard's building blocks (2026-11-06 redesign, from the user's mockup).
 *
 * Plain SVG and CSS rather than a chart library: every chart here is a handful of marks, and plain
 * SVG keeps them light, themable through CSS variables (`.oh-dash` in globals.css) and printable.
 * Every mark carries a `<title>`, so hovering shows its value, and every chart has its numbers in
 * text beside it — a tooltip never gates a figure.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CARD_TONES } from './meeting-form-parts';

type Tone = keyof typeof CARD_TONES | 'teal' | 'orange' | 'green';

const TONES: Record<Tone, readonly [string, string]> = {
  ...CARD_TONES,
  teal: ['#5eead4', '#0f766e'],
  orange: ['#fdba74', '#c2410c'],
  green: ['#86efac', '#15803d'],
};

export function toneColours(tone: Tone): readonly [string, string] {
  return TONES[tone];
}

/** A gradient app tile. */
export function AppTile({ icon: Icon, tone, size = 32 }: { icon: LucideIcon; tone: Tone; size?: number }) {
  const [from, to] = TONES[tone];
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center text-white"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: `linear-gradient(145deg, ${from}, ${to})`,
        boxShadow: `0 6px 14px -6px ${to}, inset 0 1px 0 rgb(255 255 255 / 0.27)`,
      }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

/** "MEETINGS ———" */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mx-0.5 mb-2 mt-5 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground after:h-px after:flex-1 after:bg-border">
      {children}
    </div>
  );
}

export function DashCard({
  id,
  icon,
  tone,
  title,
  description,
  aside,
  className,
  children,
}: {
  id?: string;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  description?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn('flex min-w-0 flex-col overflow-hidden rounded-[18px] border bg-card text-card-foreground', className)}>
      <header className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3">
        <AppTile icon={icon} tone={tone} size={28} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold leading-tight">{title}</h2>
          {description && <p className="text-[11.5px] text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="whitespace-nowrap text-xs font-bold text-primary hover:underline">
      {children}
    </Link>
  );
}

/** A small two-or-three way switch in a card header. */
export function MiniSegmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[9px] bg-muted p-[3px]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-2.5 py-0.5 text-[11.5px] font-bold transition-colors',
            option.value === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ── figures ─────────────────────────────────────────────────────────────────────────────────── */

/** A seven-point trend line under a figure. Decorative support for the number, never the number. */
export function Sparkline({ values, colour }: { values: readonly number[]; colour: string }) {
  const width = 84;
  const height = 26;
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => `${((index / Math.max(1, values.length - 1)) * width).toFixed(1)},${(height - 3 - (value / max) * (height - 6)).toFixed(1)}`)
    .join(' ');
  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <polyline points={`0,${height} ${points} ${width},${height}`} style={{ fill: colour, opacity: 0.14 }} stroke="none" />
      <polyline points={points} fill="none" style={{ stroke: colour }} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function KpiTile({
  icon,
  tone,
  label,
  value,
  foot,
  spark,
  hot,
  href,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: ReactNode;
  foot: string;
  spark?: readonly number[];
  hot?: boolean;
  href?: string;
}) {
  const [, deep] = TONES[tone];
  const body = (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(160px 80px at 100% 0%, ${deep}22, transparent 70%)` }}
      />
      <span className="relative row-span-2">
        <AppTile icon={icon} tone={tone} size={34} />
      </span>
      <small className="relative self-end text-[11.5px] font-semibold text-muted-foreground">{label}</small>
      <b className={cn('relative text-2xl font-extrabold leading-tight tracking-tight', hot && 'text-amber-600')}>{value}</b>
      <span className="relative col-span-2 mt-1 flex items-end justify-between gap-2">
        <span className="min-w-0 text-[11px] font-semibold text-muted-foreground">{foot}</span>
        {spark && (
          // Phones get the figure and its note; the trend line would only squeeze the note.
          <span className="hidden sm:block">
            <Sparkline values={spark} colour={deep} />
          </span>
        )}
      </span>
    </>
  );
  const className = cn(
    'relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 overflow-hidden rounded-2xl border bg-card px-3.5 pb-2.5 pt-3 transition-all',
    hot && 'border-amber-400/70 bg-amber-500/10',
    href && 'hover:-translate-y-0.5 hover:shadow-lg',
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/* ── charts ──────────────────────────────────────────────────────────────────────────────────── */

export interface DonutPart {
  value: number;
  colour: string;
  label: string;
}

/** Part-to-whole at a glance, with the numbers in the legend beside it. Segments keep a 2px gap. */
export function Donut({ parts, centreLabel }: { parts: readonly DonutPart[]; centreLabel: string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const visible = parts.filter((part) => part.value > 0);
  const lengths = visible.map((part) => (part.value / Math.max(total, 1)) * circumference);
  const starts = lengths.map((_, index) => lengths.slice(0, index).reduce((sum, length) => sum + length, 0));
  return (
    <div className="relative h-[120px] w-[120px] shrink-0">
      <svg viewBox="0 0 120 120" width={120} height={120} role="img" aria-label={`${total} ${centreLabel}`}>
        <circle r={radius} cx={60} cy={60} fill="none" strokeWidth={14} style={{ stroke: 'hsl(var(--muted))' }} />
        {visible.map((part, index) => (
          <circle
            key={part.label}
            r={radius}
            cx={60}
            cy={60}
            fill="none"
            strokeWidth={14}
            strokeDasharray={`${Math.max(lengths[index] - (visible.length > 1 ? 2 : 0), 0)} ${circumference}`}
            strokeDashoffset={-starts[index]}
            transform="rotate(-90 60 60)"
            style={{ stroke: part.colour }}
          >
            <title>{`${part.label}: ${part.value}`}</title>
          </circle>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <b className="block text-2xl font-extrabold leading-none">{total}</b>
          <small className="text-[10.5px] font-bold text-muted-foreground">{centreLabel}</small>
        </div>
      </div>
    </div>
  );
}

export interface WeekBar {
  label: string;
  title: string;
  going: number;
  unsettled: number;
  emphasis?: boolean;
}

/**
 * Meetings per day, stacked: going (the accent) and not yet settled (amber), 2px apart, with the
 * day's total over each bar.
 */
export function WeekBars({ bars }: { bars: readonly WeekBar[] }) {
  const width = 380;
  const height = 156;
  const left = 22;
  const bottom = 22;
  const top = 16;
  const barWidth = 26;
  const max = Math.max(4, ...bars.map((bar) => bar.going + bar.unsettled));
  const step = Math.max(1, Math.ceil(max / 4));
  const plot = height - bottom - top;
  const slot = (width - left) / Math.max(1, bars.length);
  const y = (value: number) => height - bottom - (value / max) * plot;

  const grid = [];
  for (let value = 0; value <= max; value += step) {
    grid.push(
      <g key={value}>
        <line x1={left} x2={width} y1={y(value)} y2={y(value)} style={{ stroke: 'hsl(var(--border))' }} />
        <text x={0} y={y(value) + 3} style={{ fill: 'hsl(var(--muted-foreground))' }} fontSize={10} fontWeight={600}>
          {value}
        </text>
      </g>,
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mx-auto block w-full max-w-[460px]" role="img" aria-label="Meetings per day">
      {grid}
      {bars.map((bar, index) => {
        const x = left + index * slot + (slot - barWidth) / 2;
        const goingHeight = (bar.going / max) * plot;
        const unsettledHeight = (bar.unsettled / max) * plot;
        const base = height - bottom;
        const gap = bar.going && bar.unsettled ? 2 : 0;
        const total = bar.going + bar.unsettled;
        return (
          <g key={bar.label}>
            <title>{bar.title}</title>
            {/* A full-height, invisible hit area so hovering anywhere over the day shows its figures. */}
            <rect x={left + index * slot} y={top} width={slot} height={plot} fill="transparent" />
            {bar.going > 0 && (
              <rect
                x={x}
                y={base - goingHeight}
                width={barWidth}
                height={goingHeight}
                rx={4}
                style={{ fill: 'hsl(var(--primary))', opacity: bar.emphasis ? 1 : 0.6 }}
              />
            )}
            {bar.unsettled > 0 && (
              <rect
                x={x}
                y={base - goingHeight - gap - unsettledHeight}
                width={barWidth}
                height={unsettledHeight}
                rx={4}
                style={{ fill: 'var(--oh-amber)' }}
              />
            )}
            {total > 0 && (
              <text
                x={x + barWidth / 2}
                y={base - goingHeight - gap - unsettledHeight - 5}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={800}
                style={{ fill: 'hsl(var(--foreground))' }}
              >
                {total}
              </text>
            )}
            <text
              x={x + barWidth / 2}
              y={height - 6}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={bar.emphasis ? 800 : 600}
              style={{ fill: bar.emphasis ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
            >
              {bar.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Two lines on one axis: tasks created and completed per week. */
export function TrendLines({
  points,
  emptyNote,
}: {
  points: readonly { label: string; title: string; created: number; completed: number }[];
  emptyNote?: string;
}) {
  const width = 360;
  const height = 124;
  const max = Math.max(4, ...points.map((point) => Math.max(point.created, point.completed)));
  const x = (index: number) => 14 + (index * (width - 28)) / Math.max(1, points.length - 1);
  const y = (value: number) => height - 20 - (value / max) * (height - 34);
  const line = (key: 'created' | 'completed', colour: string) => (
    <>
      <polyline
        points={points.map((point, index) => `${x(index)},${y(point[key])}`).join(' ')}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: colour }}
      />
      {points.map((point, index) => (
        <circle key={index} cx={x(index)} cy={y(point[key])} r={3.5} strokeWidth={2} style={{ fill: 'hsl(var(--card))', stroke: colour }} />
      ))}
    </>
  );
  const empty = points.every((point) => !point.created && !point.completed);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mx-auto block w-full max-w-[480px]" role="img" aria-label="Tasks created and completed per week">
      {[0, 0.5, 1].map((fraction) => (
        <line key={fraction} x1={0} x2={width} y1={y(max * fraction)} y2={y(max * fraction)} style={{ stroke: 'hsl(var(--border))' }} />
      ))}
      <polygon
        points={`${x(0)},${y(0)} ${points.map((point, index) => `${x(index)},${y(point.completed)}`).join(' ')} ${x(points.length - 1)},${y(0)}`}
        style={{ fill: 'var(--oh-good)', opacity: 0.08 }}
      />
      {line('created', 'var(--oh-blue)')}
      {line('completed', 'var(--oh-good)')}
      {points.map((point, index) => (
        <g key={point.label}>
          <title>{point.title}</title>
          <rect x={x(index) - 12} y={0} width={24} height={height - 16} fill="transparent" />
          {(index % 2 === 1 || index === points.length - 1) && (
            <text x={x(index)} y={height - 4} textAnchor="middle" fontSize={10} fontWeight={600} style={{ fill: 'hsl(var(--muted-foreground))' }}>
              {point.label}
            </text>
          )}
        </g>
      ))}
      {empty && emptyNote && (
        <text x={width / 2} y={height / 2 - 10} textAnchor="middle" fontSize={11} fontWeight={600} style={{ fill: 'hsl(var(--muted-foreground))' }}>
          {emptyNote}
        </text>
      )}
    </svg>
  );
}

/** Ranked horizontal bars, one colour: the labels say what each row is. */
export function HBars({ rows, format }: { rows: readonly { label: string; value: number }[]; format: (value: number) => string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_4.5rem] items-center gap-2.5 text-xs" title={`${row.label}: ${format(row.value)}`}>
          <span className="truncate font-semibold text-muted-foreground">{row.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted">
            <i className="block h-full rounded-full bg-primary" style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <b className="whitespace-nowrap text-right">{format(row.value)}</b>
        </div>
      ))}
    </div>
  );
}

/** Three small figures in a row under a chart. */
export function StatTrio({ items }: { items: readonly { label: string; value: ReactNode; tone?: 'amber' }[] }) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[11px] bg-muted/60 px-2.5 py-1.5">
          <small className="block truncate text-[10.5px] font-bold text-muted-foreground">{item.label}</small>
          <b className={cn('block truncate text-[15px]', item.tone === 'amber' && 'text-amber-600')}>{item.value}</b>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: readonly { label: ReactNode; colour: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-muted-foreground">
      {items.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-1.5">
          <i aria-hidden className="inline-block h-[9px] w-[9px] rounded-[3px]" style={{ background: item.colour }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* ── today ───────────────────────────────────────────────────────────────────────────────────── */

export interface TimelineEvent {
  id: string;
  href: string;
  title: string;
  detail: string;
  start: number;
  end: number;
  colour: string;
}

/** The day as an hour grid, meetings placed on it, and a line at the current time. */
export function DayTimeline({
  events,
  from,
  to,
  now,
}: {
  events: readonly TimelineEvent[];
  from: number;
  to: number;
  now: number | null;
}) {
  const hourHeight = 30;
  const hours = Array.from({ length: Math.max(1, (to - from) / 60) }, (_, index) => from + index * 60);
  const top = (minute: number) => 6 + ((minute - from) / 60) * hourHeight;
  return (
    <div className="relative px-4 pb-3 pt-1.5">
      {hours.map((minute) => (
        <div key={minute} className="grid h-[30px] grid-cols-[42px_minmax(0,1fr)] items-start border-t pt-[3px]">
          <span className="text-[10.5px] font-bold text-muted-foreground">{String(Math.floor(minute / 60)).padStart(2, '0')}:00</span>
        </div>
      ))}
      {events.map((event) => (
        <Link
          key={event.id}
          href={event.href}
          className="absolute left-[66px] right-4 overflow-hidden rounded-lg border-l-[3px] bg-card px-2 py-0.5 text-[11px] font-bold leading-snug hover:brightness-95"
          style={{
            top: top(Math.max(from, event.start)),
            height: Math.max(26, ((Math.min(to, event.end) - Math.max(from, event.start)) / 60) * hourHeight - 2),
            borderLeftColor: event.colour,
          }}
        >
          {/* A tint layer rather than color-mix(), which the office's Chrome 109 PCs cannot paint. */}
          <span aria-hidden className="absolute inset-0" style={{ background: event.colour, opacity: 0.14 }} />
          <span className="relative block truncate">{event.title}</span>
          <small className="relative block truncate font-semibold opacity-75">{event.detail}</small>
        </Link>
      ))}
      {now != null && now >= from && now <= to && (
        <div aria-hidden className="absolute left-[58px] right-4 h-0.5 bg-rose-600" style={{ top: top(now) }}>
          <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-rose-600" />
        </div>
      )}
    </div>
  );
}

/* ── empty states ────────────────────────────────────────────────────────────────────────────── */

export function EmptyNote({
  icon: Icon,
  tone,
  title,
  text,
  action,
  className,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const [from, to] = TONES[tone];
  return (
    <div className={cn('my-auto px-4 py-6 text-center text-muted-foreground', className)}>
      <div
        aria-hidden
        className="mx-auto mb-2 grid h-[46px] w-[46px] place-items-center rounded-[15px] text-white"
        style={{ background: `linear-gradient(145deg, ${from}, ${to})`, boxShadow: `0 12px 22px -10px ${to}` }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <b className="block text-[13px] text-foreground">{title}</b>
      {text && <p className="mx-auto mb-2.5 mt-0.5 max-w-xs text-xs">{text}</p>}
      {action}
    </div>
  );
}

/** A small month/day tile for list rows. */
export function DateTile({ date, colour }: { date: string; colour: string }) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return (
    <div className="w-[42px] shrink-0 overflow-hidden rounded-[9px] border text-center">
      <small className="block text-[8.5px] font-extrabold tracking-wider text-white" style={{ background: colour }}>
        {months[Number(date.slice(5, 7)) - 1] ?? ''}
      </small>
      <b className="block text-[15px] leading-snug">{Number(date.slice(8, 10)) || '–'}</b>
    </div>
  );
}
