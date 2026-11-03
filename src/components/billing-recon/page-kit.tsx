'use client';

/**
 * The pieces every Billing Recon page is built from, so the module reads as one product — and
 * as a sibling of Bank Balance, whose look it follows (src/components/bank-balance/page-kit.tsx):
 *
 *  - `BrPage` — the page container plus `BillingReconBackground`, a tinted drifting-orb backdrop,
 *    one colour per page family (`BR_TONE`).
 *  - `BrHero` — the colour banner with glass panels (`HeroStat`) and banner actions, as on Bank
 *    Balance's Aurora dashboard, always in the default "lagoon" tint.
 *  - `AppTile`, `ActionCard`, `BrSection` — gradient icon tiles, the action / work-queue cards
 *    that replace the old grids of link cards, and section headings.
 *  - `BrNotice` — the attention strip (amber / sky / emerald).
 *  - `BrPageSkeleton`, `BrAccessDenied` — loading and no-permission states inside the shell.
 *
 * Colours for figures stay in KpiCard tones; chart series colours stay in dashboard/br-charts.tsx.
 */

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAccessDenied } from '@/components/shared/module-shell';
import { cn } from '@/lib/utils';
import styles from './br-hero.module.css';

export type BrTone = 'cyan' | 'teal' | 'emerald' | 'orange' | 'amber' | 'violet' | 'sky' | 'blue' | 'indigo' | 'rose' | 'slate';

/** The colour of each page family — the sidebar entry, the backdrop and the section tiles agree. */
export const BR_TONE = {
  dashboard: 'cyan',
  project: 'blue',
  boq: 'emerald',
  jmc: 'orange',
  mvac: 'amber',
  log: 'slate',
  reconciliation: 'violet',
  billing: 'sky',
  settings: 'slate',
} as const satisfies Record<string, BrTone>;

// Literal class strings (never built from the tone name) so Tailwind emits every one, with
// explicit dark variants so the backdrop doesn't stay pastel in dark mode.
const BACKDROP: Record<BrTone, { base: string; orbA: string; orbB: string; dot: string }> = {
  cyan: { base: 'from-cyan-50/70 via-background to-sky-50/50 dark:from-cyan-950/30 dark:via-background dark:to-sky-950/20', orbA: 'bg-cyan-300/15 dark:bg-cyan-500/10', orbB: 'bg-sky-300/12 dark:bg-sky-500/10', dot: 'rgba(6,182,212,0.12)' },
  teal: { base: 'from-teal-50/60 via-background to-emerald-50/40 dark:from-teal-950/30 dark:via-background dark:to-emerald-950/20', orbA: 'bg-teal-300/15 dark:bg-teal-500/10', orbB: 'bg-emerald-300/12 dark:bg-emerald-500/10', dot: 'rgba(20,184,166,0.12)' },
  emerald: { base: 'from-emerald-50/60 via-background to-teal-50/40 dark:from-emerald-950/30 dark:via-background dark:to-teal-950/20', orbA: 'bg-emerald-300/15 dark:bg-emerald-500/10', orbB: 'bg-teal-300/12 dark:bg-teal-500/10', dot: 'rgba(16,185,129,0.12)' },
  orange: { base: 'from-orange-50/60 via-background to-amber-50/40 dark:from-orange-950/30 dark:via-background dark:to-amber-950/20', orbA: 'bg-orange-300/15 dark:bg-orange-500/10', orbB: 'bg-amber-300/12 dark:bg-amber-500/10', dot: 'rgba(249,115,22,0.12)' },
  amber: { base: 'from-amber-50/60 via-background to-yellow-50/40 dark:from-amber-950/30 dark:via-background dark:to-yellow-950/20', orbA: 'bg-amber-300/15 dark:bg-amber-500/10', orbB: 'bg-yellow-300/12 dark:bg-yellow-500/10', dot: 'rgba(245,158,11,0.12)' },
  violet: { base: 'from-violet-50/70 via-background to-indigo-50/50 dark:from-violet-950/30 dark:via-background dark:to-indigo-950/20', orbA: 'bg-violet-300/15 dark:bg-violet-500/10', orbB: 'bg-indigo-300/12 dark:bg-indigo-500/10', dot: 'rgba(139,92,246,0.12)' },
  sky: { base: 'from-sky-50/60 via-background to-cyan-50/40 dark:from-sky-950/30 dark:via-background dark:to-cyan-950/20', orbA: 'bg-sky-300/15 dark:bg-sky-500/10', orbB: 'bg-cyan-300/12 dark:bg-cyan-500/10', dot: 'rgba(14,165,233,0.12)' },
  blue: { base: 'from-blue-50/60 via-background to-indigo-50/40 dark:from-blue-950/30 dark:via-background dark:to-indigo-950/20', orbA: 'bg-blue-300/15 dark:bg-blue-500/10', orbB: 'bg-indigo-300/12 dark:bg-indigo-500/10', dot: 'rgba(59,130,246,0.12)' },
  indigo: { base: 'from-indigo-50/60 via-background to-violet-50/40 dark:from-indigo-950/30 dark:via-background dark:to-violet-950/20', orbA: 'bg-indigo-300/15 dark:bg-indigo-500/10', orbB: 'bg-violet-300/12 dark:bg-violet-500/10', dot: 'rgba(99,102,241,0.12)' },
  rose: { base: 'from-rose-50/60 via-background to-pink-50/40 dark:from-rose-950/30 dark:via-background dark:to-pink-950/20', orbA: 'bg-rose-300/15 dark:bg-rose-500/10', orbB: 'bg-pink-300/12 dark:bg-pink-500/10', dot: 'rgba(244,63,94,0.12)' },
  slate: { base: 'from-slate-50/70 via-background to-cyan-50/30 dark:from-slate-900/40 dark:via-background dark:to-cyan-950/10', orbA: 'bg-slate-300/15 dark:bg-slate-500/10', orbB: 'bg-cyan-300/10 dark:bg-cyan-500/10', dot: 'rgba(100,116,139,0.12)' },
};

/** Gradient pairs for icon tiles (light top-left → deep bottom-right). */
export const TILE: Record<BrTone, { from: string; to: string }> = {
  cyan: { from: '#22d3ee', to: '#0891b2' },
  teal: { from: '#2dd4bf', to: '#0d9488' },
  emerald: { from: '#34d399', to: '#059669' },
  orange: { from: '#fb923c', to: '#ea580c' },
  amber: { from: '#fbbf24', to: '#d97706' },
  violet: { from: '#a78bfa', to: '#7c3aed' },
  sky: { from: '#38bdf8', to: '#0284c7' },
  blue: { from: '#60a5fa', to: '#2563eb' },
  indigo: { from: '#818cf8', to: '#4f46e5' },
  rose: { from: '#fb7185', to: '#e11d48' },
  slate: { from: '#94a3b8', to: '#475569' },
};

export function BillingReconBackground({ tone }: { tone: BrTone }) {
  const t = BACKDROP[tone];
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden print:hidden" aria-hidden>
      <div className={cn('absolute inset-0 bg-gradient-to-br', t.base)} />
      <div className={cn('animate-bb-orb-1 absolute left-[-5%] top-[-10%] h-[40vw] w-[40vw] rounded-full blur-3xl', t.orbA)} />
      <div className={cn('animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] h-[45vw] w-[45vw] rounded-full blur-3xl', t.orbB)} />
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `radial-gradient(circle, ${t.dot} 1px, transparent 1px)`, backgroundSize: '28px 28px' }} />
    </div>
  );
}

/** The container every Billing Recon page renders in (the module shell already pads it). */
export const BR_PAGE = 'relative w-full min-w-0 space-y-5';

export function BrPage({ tone, className, children }: { tone: BrTone; className?: string; children: ReactNode }) {
  return (
    <>
      <BillingReconBackground tone={tone} />
      <div className={cn(BR_PAGE, className)}>{children}</div>
    </>
  );
}

/** A gradient icon tile. */
export function AppTile({ tone, icon: Icon, size = 40, className }: { tone: BrTone; icon: LucideIcon; size?: number; className?: string }) {
  const t = TILE[tone];
  return (
    <span aria-hidden className={cn(styles.appIcon, className)} style={{ '--a': t.from, '--b': t.to, width: size, height: size, borderRadius: size * 0.3 } as CSSProperties}>
      <Icon style={{ width: size * 0.48, height: size * 0.48 }} />
    </span>
  );
}

/* ── the banner ─────────────────────────────────────────────────────────────────────────────── */

export interface HeroAction {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
}

/**
 * The colour banner: an eyebrow line (with an optional live pill), the headline figure, a caption,
 * banner actions, and an optional glass side panel (`aside`).
 */
export function BrHero({
  eyebrow,
  live,
  value,
  caption,
  actions = [],
  aside,
  children,
  className,
}: {
  eyebrow: ReactNode;
  /** A short "as of" text for the live pill, e.g. "Updated 14:05". */
  live?: string;
  value: ReactNode;
  caption?: ReactNode;
  actions?: HeroAction[];
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(styles.hero, 'keep-light p-5 sm:p-7', className)}>
      <div className={cn('grid grid-cols-1 items-end gap-6', aside && 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]')}>
        <div className="min-w-0">
          <div className={cn(styles.muted, 'flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.08em]')}>
            {eyebrow}
            {live && (
              <span className={cn(styles.pill, 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-white')}>
                <span aria-hidden className={cn(styles.liveDot, 'h-1.5 w-1.5 rounded-full')} />
                {live}
              </span>
            )}
          </div>
          <div className="mb-1 mt-2 break-words text-3xl font-extrabold tabular-nums tracking-tight sm:text-[42px] sm:leading-[1.1]">{value}</div>
          {caption && <div className={cn(styles.muted, 'text-sm')}>{caption}</div>}
          {actions.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {actions.map((action) => (
                <Link key={action.label} href={action.href} className={cn(styles.action, action.primary && styles.actionPrimary)}>
                  <action.icon aria-hidden className="h-4 w-4" />
                  {action.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        {aside && <div className={cn(styles.glass, 'min-w-0 rounded-2xl p-4')}>{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** One figure inside the banner's glass panel. */
export function HeroStat({ label, value, hint, swatch, title }: { label: string; value: ReactNode; hint?: ReactNode; swatch?: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <p className={cn(styles.muted, 'flex items-start gap-1.5 text-[11.5px] font-semibold leading-tight')}>
        {swatch && <span aria-hidden className="mt-0.5 h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: swatch }} />}
        <span className="min-w-0">{label}</span>
      </p>
      <p className="text-lg font-extrabold tabular-nums">{value}</p>
      {hint && <p className={cn(styles.muted, 'text-[11px]')}>{hint}</p>}
    </div>
  );
}

/** The heading row inside a banner's glass panel. */
export function HeroPanelTitle({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs font-bold">
      <span className={styles.muted}>{left}</span>
      {right && <span className={cn(styles.muted, 'tabular-nums')}>{right}</span>}
    </div>
  );
}

/** A proportional bar inside the banner (segments in white-on-colour). */
export function HeroBar({ parts }: { parts: Array<{ value: number; color: string; label: string }> }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  return (
    <div className="my-3 flex h-3 overflow-hidden rounded-md bg-white/15" role="img" aria-label={parts.map((p) => p.label).join(', ')}>
      {total > 0 &&
        parts.map((p) => <div key={p.label} className="h-full" style={{ width: `${(Math.max(0, p.value) / total) * 100}%`, backgroundColor: p.color }} />)}
    </div>
  );
}

/* ── cards, sections, notices ───────────────────────────────────────────────────────────────── */

/**
 * An action or work-queue card: gradient tile, title, description, and an optional figure
 * (a count waiting there) or badge. Disabled cards stay visible with the reason, so a missing
 * permission reads as such rather than as a broken page.
 */
export function ActionCard({
  href,
  title,
  description,
  icon,
  tone,
  figure,
  figureLabel,
  badge,
  alert,
  disabled,
  disabledReason,
}: {
  href: string;
  title: string;
  description?: string;
  icon: LucideIcon;
  tone: BrTone;
  figure?: ReactNode;
  figureLabel?: string;
  badge?: ReactNode;
  /** A red count, e.g. overdue entries. */
  alert?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const t = TILE[tone];
  const body = (
    <div
      className={cn(
        'group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-4 shadow-sm transition sm:p-[18px]',
        disabled ? 'opacity-60' : 'hover:-translate-y-0.5 hover:shadow-md',
      )}
      title={disabled ? disabledReason : undefined}
    >
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-[0.18] blur-2xl" style={{ background: t.from }} />
      <div className="relative flex items-start gap-3.5">
        <AppTile tone={tone} icon={icon} size={44} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight text-foreground">{title}</p>
          {description && <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{description}</p>}
        </div>
        {!disabled && <ChevronRight aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
      </div>
      {(figure !== undefined || badge || alert || (disabled && disabledReason)) && (
        <div className="relative mt-auto flex flex-wrap items-end justify-between gap-2 border-t border-border/60 pt-3">
          {figure !== undefined ? (
            <span className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold tabular-nums text-foreground">{figure}</span>
              {figureLabel && <span className="text-xs text-muted-foreground">{figureLabel}</span>}
            </span>
          ) : (
            <span />
          )}
          <span className="flex flex-wrap items-center gap-1.5">
            {alert}
            {badge}
            {disabled && disabledReason && <span className="text-[11px] text-muted-foreground">{disabledReason}</span>}
          </span>
        </div>
      )}
    </div>
  );
  if (disabled || !href || href === '#') return <div className="h-full">{body}</div>;
  return (
    <Link href={href} className="block h-full no-underline">
      {body}
    </Link>
  );
}

/** A section heading with its tile, a line of description and optional actions on the right. */
export function BrSection({
  title,
  description,
  icon,
  tone,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  tone?: BrTone;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && tone && <AppTile tone={tone} icon={icon} size={30} />}
          <div className="min-w-0">
            <h2 className="text-base font-bold leading-tight text-foreground">{title}</h2>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

const NOTICE = {
  warning: {
    box: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100',
    tile: 'bg-amber-200 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  },
  info: {
    box: 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-100',
    tile: 'bg-sky-200 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  },
  success: {
    box: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-100',
    tile: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  },
  danger: {
    box: 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-100',
    tile: 'bg-rose-200 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
  },
} as const;

/** The attention strip: a tinted, rounded band with an icon tile, text and an optional action. */
export function BrNotice({
  tone = 'warning',
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof NOTICE;
  icon: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const n = NOTICE[tone];
  return (
    <div className={cn('flex flex-wrap items-start gap-3 rounded-2xl border px-4 py-3 sm:flex-nowrap', n.box, className)} role="status">
      <span aria-hidden className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', n.tile)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/* ── states ─────────────────────────────────────────────────────────────────────────────────── */

/** The loading state: header bar, a KPI row and content blocks, sized like the real page. */
export function BrPageSkeleton({ kpis = 4, blocks = 1, hero = false }: { kpis?: number; blocks?: number; hero?: boolean }) {
  return (
    <div className={BR_PAGE} aria-busy>
      <span className="sr-only">Loading…</span>
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-7 w-56 rounded-lg" />
        <Skeleton className="h-4 w-80 max-w-full rounded-md" />
      </div>
      {hero && <Skeleton className="h-44 w-full rounded-3xl" aria-hidden />}
      {kpis > 0 && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-hidden>
          {Array.from({ length: kpis }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}
      {Array.from({ length: blocks }).map((_, i) => (
        <Skeleton key={i} className="h-72 w-full rounded-2xl" aria-hidden />
      ))}
    </div>
  );
}

/** No permission for this page — inside the module frame, so the menu stays usable. */
export function BrAccessDenied({ message }: { message?: string }) {
  return <PageAccessDenied message={message} />;
}
