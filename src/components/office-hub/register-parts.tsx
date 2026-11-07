'use client';

/**
 * Pieces shared by the decision, action item and team registers (2026-11-07, from the user's
 * mockup `sel-decisions-actions-teams-redesign.html`): the coloured band with figures that act as
 * filters, the tab strip with counts, the search box, the status chip, the round tick and the
 * empty panel. Each register keeps its own colour — violet, pink, teal — so they are told apart at
 * a glance.
 */

import type { ReactNode } from 'react';
import { Check, Search, type LucideIcon } from 'lucide-react';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { DecisionStatus } from '@/lib/office-hub';
import { Avatar } from './meeting-form-parts';

export type RegisterTone = 'violet' | 'rose' | 'teal';

const HERO_CLASS: Record<RegisterTone, string> = {
  violet: 'oh-hero--glow',
  rose: 'oh-hero--rose',
  teal: 'oh-hero--teal',
};

export interface HeroFigureSpec {
  key: string;
  label: string;
  value: number | null;
  icon: LucideIcon;
  /** The icon tile's gradient, light to dark. */
  tone: [string, string];
  on: boolean;
  alert?: boolean;
  hint?: string | null;
  onPick: () => void;
}

export function RegisterHero({
  tone,
  eyebrow,
  title,
  subtitle,
  actions,
  figures,
  loading,
}: {
  tone: RegisterTone;
  eyebrow: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  figures: HeroFigureSpec[];
  loading?: boolean;
}) {
  return (
    <section className={cn('oh-hero keep-light relative overflow-hidden rounded-[22px] px-4 pb-4 pt-4 text-white sm:px-6', HERO_CLASS[tone])}>
      <div aria-hidden className="wd-hero-dots pointer-events-none absolute inset-0" />
      <div className="relative flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/80">Office Hub · {eyebrow}</div>
          <h1 className="mt-0.5 text-[23px] font-extrabold tracking-tight">{title}</h1>
          <p className="text-[12.5px] text-white/90">{subtitle}</p>
        </div>
        {actions}
      </div>

      <div
        className={cn(
          'relative mt-3.5 grid grid-cols-2 gap-2.5',
          figures.length >= 5 ? 'sm:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-4',
        )}
      >
        {figures.map((figure) => {
          const Icon = figure.icon;
          return (
            <button
              key={figure.key}
              type="button"
              aria-pressed={figure.on}
              onClick={figure.onPick}
              className={cn(
                'flex min-w-0 items-center gap-2.5 rounded-[14px] border px-3 py-2 text-left transition-colors',
                figure.on ? 'border-white bg-white text-slate-900' : 'border-white/20 bg-white/10 text-white hover:bg-white/15',
              )}
            >
              <span
                aria-hidden
                className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] text-white"
                style={{ background: `linear-gradient(145deg, ${figure.tone[0]}, ${figure.tone[1]})` }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <small className={cn('block text-[11px] font-semibold leading-tight', figure.on ? 'text-slate-500' : 'text-white/80')}>{figure.label}</small>
                <b className={cn('block text-xl font-extrabold leading-tight tabular-nums', figure.alert && (figure.on ? 'text-rose-600' : 'text-rose-200'))}>
                  {loading || figure.value === null ? '–' : figure.value}
                </b>
                {figure.hint && (
                  <span className={cn('block text-[10.5px] font-semibold leading-tight', figure.on ? 'text-slate-500' : 'text-white/75')}>{figure.hint}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The white button on the band, and its quieter sibling. */
export function HeroButton({ children, onClick, primary, disabled }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 rounded-[10px] border px-3.5 py-2 text-[12.5px] font-bold disabled:opacity-50',
        primary ? 'border-white bg-white text-slate-900 hover:bg-white/90' : 'border-white/25 bg-white/10 text-white hover:bg-white/20',
      )}
    >
      {children}
    </button>
  );
}

const TAB_ACCENT: Record<RegisterTone, { on: string; count: string }> = {
  violet: { on: 'border-primary text-primary', count: 'bg-primary/15 text-primary' },
  rose: { on: 'border-pink-600 text-pink-700', count: 'bg-pink-100 text-pink-700' },
  teal: { on: 'border-cyan-700 text-cyan-800', count: 'bg-cyan-100 text-cyan-800' },
};

export function RegisterTabs<T extends string>({
  tabs,
  value,
  onChange,
  tone,
  label,
}: {
  tabs: readonly { value: T; label: string; count: number }[];
  value: T;
  onChange: (next: T) => void;
  tone: RegisterTone;
  label: string;
}) {
  return (
    <div className="flex gap-0.5 overflow-x-auto" role="tablist" aria-label={label}>
      {tabs.map((entry) => {
        const on = value === entry.value;
        return (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(entry.value)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-2 text-[13px] font-bold transition-colors',
              on ? TAB_ACCENT[tone].on : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {entry.label}
            <em className={cn('rounded-full px-1.5 text-[11px] not-italic tabular-nums', on ? TAB_ACCENT[tone].count : 'bg-muted text-muted-foreground')}>{entry.count}</em>
          </button>
        );
      })}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, label, className }: { value: string; onChange: (next: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <label className={cn('flex h-9 w-full items-center gap-2 rounded-[10px] border bg-card px-2.5 text-muted-foreground sm:w-64', className)}>
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

/** A multi-select in the filter row: half a row on a phone, a fixed width above. */
export function FilterBox({ children }: { children: ReactNode }) {
  return <div className="w-[calc(50%-4px)] sm:w-40">{children}</div>;
}

const STATUS_CHIP: Record<DecisionStatus, string> = {
  Open: 'bg-indigo-100 text-indigo-700',
  'In Progress': 'bg-blue-100 text-blue-700',
  Completed: 'bg-emerald-100 text-emerald-700',
  Cancelled: 'bg-muted text-muted-foreground',
};

/** Decisions and action items share their four statuses. */
export function WorkStatusChip({ status }: { status: DecisionStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', STATUS_CHIP[status])}>
      <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {status === 'In Progress' ? 'In progress' : status}
    </span>
  );
}

export function RoundTick({ done, disabled, onToggle, label, title }: { done: boolean; disabled: boolean; onToggle: () => void; label: string; title?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/40 bg-card text-transparent hover:border-emerald-600 hover:text-emerald-600',
      )}
    >
      <Check className="h-3 w-3" strokeWidth={3.2} />
    </button>
  );
}

/** A person with a line under their name: "Owner", "Finance team", "Team leader · Chief Manager". */
export function PersonLine({ seed, name, subtitle, you, size = 24 }: { seed: string; name: string; subtitle?: string | null; you?: boolean; size?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs font-semibold">
      <Avatar seed={seed} name={name} size={size} />
      <span className="min-w-0">
        <span className="block truncate">{you ? 'You' : name}</span>
        {subtitle && <small className="block truncate text-[11px] font-semibold text-muted-foreground">{subtitle}</small>}
      </span>
    </span>
  );
}

export function MiniProgress({ done, total, noun }: { done: number; total: number; noun: string }) {
  return (
    <span className="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
      <span className="h-[5px] w-[60px] overflow-hidden rounded-full bg-muted">
        <i className="block h-full bg-emerald-600" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </span>
      {done}/{total} {noun}
    </span>
  );
}

/** The big empty state: a gradient tile, a line, a sentence, a button; optionally a panel beside it. */
export function EmptyPanel({
  icon: Icon,
  tone,
  title,
  body,
  action,
  aside,
}: {
  icon: LucideIcon;
  tone: [string, string];
  title: string;
  body: string;
  action?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className={cn('grid grid-cols-1 items-center gap-5 px-5 py-8', aside && 'lg:grid-cols-2')}>
      <div className="text-center">
        <span
          aria-hidden
          className="mx-auto mb-3 grid h-[62px] w-[62px] place-items-center rounded-[20px] text-white shadow-lg"
          style={{ background: `linear-gradient(145deg, ${tone[0]}, ${tone[1]})` }}
        >
          <Icon className="h-7 w-7" />
        </span>
        <b className="block text-base">{title}</b>
        <p className="mx-auto mb-3.5 mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
        {action}
      </div>
      {aside}
    </div>
  );
}

/* ── the record / create windows ───────────────────────────────────────────────────────────── */

/** The coloured top of a window, holding its title. Leaves room on the right for the window buttons. */
export function WindowBand({ tone, icon: Icon, title, description }: { tone: RegisterTone; icon: LucideIcon; title: string; description: string }) {
  return (
    <div className={cn('oh-hero keep-light relative flex items-center gap-3 px-5 py-3.5 pr-24 text-white', HERO_CLASS[tone])}>
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-white/25">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <DialogTitle className="text-base font-bold text-white">{title}</DialogTitle>
        <DialogDescription className="max-w-2xl text-xs text-white/90">{description}</DialogDescription>
      </div>
    </div>
  );
}

export function WindowLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1.5 mt-4 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
      {children}
      {action && <span className="ml-auto normal-case tracking-normal">{action}</span>}
    </div>
  );
}

export function WindowField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <small className="mb-1 block text-[11.5px] font-bold text-muted-foreground">{label}</small>
      {children}
    </label>
  );
}

export function PreviewRow({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-t border-dashed py-1 text-xs text-muted-foreground">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/** "Before you record": what is filled in, ticked. */
export function ReadyList({ title, items }: { title: string; items: readonly [boolean, string][] }) {
  return (
    <div className="mt-3.5">
      <h6 className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">{title}</h6>
      {items.map(([ok, label]) => (
        <div key={label} className={cn('flex items-center gap-2 py-0.5 text-xs font-semibold', ok ? 'text-foreground' : 'text-muted-foreground')}>
          <span aria-hidden className={cn('grid h-4 w-4 place-items-center rounded-full border-2', ok ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/40')}>
            {ok && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
          </span>
          {label}
        </div>
      ))}
    </div>
  );
}

export function KeyHint({ action }: { action: string }) {
  return (
    <span className="hidden text-[11.5px] text-muted-foreground sm:inline">
      <kbd className="rounded border border-b-2 bg-card px-1 text-[10.5px] font-bold">Ctrl</kbd> + <kbd className="rounded border border-b-2 bg-card px-1 text-[10.5px] font-bold">Enter</kbd> to {action}
    </span>
  );
}

/** "December 2026" between groups, or a pinned group's coloured heading. */
export function GroupHeading({ children, count, tone }: { children: ReactNode; count?: number; tone?: 'late' }) {
  return (
    <div className={cn('px-[18px] pb-0.5 pt-3 text-[11px] font-extrabold uppercase tracking-[0.07em]', tone === 'late' ? 'text-rose-600' : 'text-muted-foreground')}>
      {children}
      {count !== undefined && <span className="ml-1.5 font-bold normal-case tracking-normal opacity-80">{count}</span>}
    </div>
  );
}
