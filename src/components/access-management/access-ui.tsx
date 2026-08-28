'use client';

/**
 * Atoms specific to access management.
 *
 * Everything generic — page headers, KPI cards, the responsive register, the mobile dialog classes —
 * comes from `@/components/hr/hr-ui`, which is the app's shared kit despite the prefix. Only the
 * pieces that mean something about *access* live here: the source badge that answers "where did
 * this permission come from", the risk badges, and the two small readouts the preview screens rely
 * on.
 *
 * The three exceptions to "access-specific only" are `AccessPageShell`, `AccessBackLink` and
 * `AccessCard`. They are not about access at all — they are the module's chrome, and they live here
 * because the alternative was what this module actually had: three different page shells across four
 * entry points, two different back buttons, and one glass-card class string copy-pasted twenty-odd
 * times in three drifting variants. hr-ui is shared with every other module, so the canonical
 * *values* belong to whoever owns them; keeping the module's chrome here means it stays consistent
 * inside the module without reaching across into somebody else's kit.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  Check,
  FolderKanban,
  BadgeCheck,
  KeyRound,
  Layers,
  Minus,
  ShieldCheck,
  Sparkles,
  UserCog,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { SpotlightCard } from '@/components/effects/SpotlightCard';
import { CountUp } from '@/components/effects/CountUp';
import type { HrTone } from '@/components/hr/hr-ui';
import { cn } from '@/lib/utils';
import {
  formatGrantDate,
  splitPermissionKey,
  type AccessSourceKind,
  type PermissionSource,
  type PrivilegeFinding,
  type SodConflict,
} from '@/lib/access-control';

/* ------------------------------------------------------------------------------------------------
 * Module chrome — the page shell, the back button, the glass card
 * ---------------------------------------------------------------------------------------------- */

/**
 * The module's card surface.
 *
 * `bg-white/85` is the canonical opacity — it was the majority spelling of the three that had drifted
 * apart (85, 80, and one with no shadow at all), and on the aurora backdrop the difference between 80
 * and 85 is visible when two cards sit side by side.
 */
export const ACCESS_CARD_CLASS = 'border-white/60 bg-white/85 shadow-sm backdrop-blur-sm';

export const AccessCard = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Card>>(
  function AccessCard({ className, ...props }, ref) {
    return <Card ref={ref} className={cn(ACCESS_CARD_CLASS, className)} {...props} />;
  },
);

/**
 * The way back, everywhere in the module.
 *
 * Round, icon-only and floating over the backdrop — the idiom the two main routes already used. The
 * label is not rendered but is the accessible name, so an icon-only control still announces where it
 * goes.
 */
export function AccessBackLink({
  href,
  label = 'Back',
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <Button asChild variant="ghost" size="icon" className={cn('rounded-full bg-white/70 shadow-sm backdrop-blur', className)}>
      <Link href={href} aria-label={label}>
        <ArrowLeft className="h-5 w-5" />
      </Link>
    </Button>
  );
}

const SHELL_WIDTH = {
  /** Full-bleed — the default, because the two main routes are registers that want the width. */
  full: '',
  /** A form. Wider than a reading column, narrow enough that fields do not stretch absurdly. */
  form: 'mx-auto max-w-5xl',
  /** A wide table that still wants a ceiling on a large monitor. */
  wide: 'mx-auto max-w-7xl',
} as const;

/**
 * Backdrop, page padding, optional width ceiling and optional back link — once, for all four entry
 * points.
 *
 * The height is `100dvh-4rem` rather than `100vh`: the protected layout has a 4rem header, and `dvh`
 * is what stops a phone's collapsing address bar from leaving a strip of unpainted page below the
 * backdrop.
 *
 * `overflow-x-clip`, not `overflow-hidden`. `overflow: hidden` makes this div a scroll container, and
 * a scroll container that never scrolls silently kills `position: sticky` in everything below it —
 * the Assign Access selection bar and the Add User action bar are both sticky. `clip` does the same
 * job for stray horizontal overflow without establishing one. The aurora's own blobs do not need
 * clipping here: `AuroraBackdrop` clips itself.
 */
export function AccessPageShell({
  children,
  backHref,
  backLabel,
  aside,
  width = 'full',
  className,
}: {
  children: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  /** Rendered on the same row as the back link — a badge, or a heading on the denied/loading states. */
  aside?: React.ReactNode;
  width?: keyof typeof SHELL_WIDTH;
  className?: string;
}) {
  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-x-clip px-4 py-3 sm:px-5">
      <AuroraBackdrop />
      <div className={cn('relative', SHELL_WIDTH[width], className)}>
        {(backHref || aside) && (
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {backHref && <AccessBackLink href={backHref} label={backLabel} />}
            {aside}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Dashboard KPI card
 *
 * The same numbers `HrKpiCard` renders, with the two touches that make a landing dashboard feel
 * alive rather than printed: the value rolls up instead of just appearing (`CountUp`), and the
 * card's border glows toward the cursor on hover (`SpotlightCard`, the "spotlight card" idiom). Kept
 * local to this module rather than folded into the shared `HrKpiCard` — every other KPI grid in the
 * app keeps its current, plainer look.
 * ---------------------------------------------------------------------------------------------- */

const KPI_TONES: Record<HrTone, { bg: string; text: string; ring: string; glow: string; bar: string }> = {
  slate: { bg: 'bg-slate-50', text: 'text-slate-600', ring: 'ring-slate-100', glow: 'rgba(100, 116, 139, 0.16)', bar: 'from-slate-300 to-slate-400' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100', glow: 'rgba(16, 185, 129, 0.18)', bar: 'from-emerald-300 to-emerald-500' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-100', glow: 'rgba(245, 158, 11, 0.18)', bar: 'from-amber-300 to-amber-500' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-600', ring: 'ring-rose-100', glow: 'rgba(244, 63, 94, 0.18)', bar: 'from-rose-300 to-rose-500' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-600', ring: 'ring-blue-100', glow: 'rgba(59, 130, 246, 0.18)', bar: 'from-blue-300 to-blue-500' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', ring: 'ring-indigo-100', glow: 'rgba(99, 102, 241, 0.18)', bar: 'from-indigo-300 to-indigo-500' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-600', ring: 'ring-orange-100', glow: 'rgba(249, 115, 22, 0.18)', bar: 'from-orange-300 to-orange-500' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600', ring: 'ring-violet-100', glow: 'rgba(139, 92, 246, 0.18)', bar: 'from-violet-300 to-violet-500' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600', ring: 'ring-teal-100', glow: 'rgba(20, 184, 166, 0.18)', bar: 'from-teal-300 to-teal-500' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-600', ring: 'ring-cyan-100', glow: 'rgba(6, 182, 212, 0.18)', bar: 'from-cyan-300 to-cyan-500' },
};

export function AccessKpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
  href,
  onClick,
  index = 0,
}: {
  label: string;
  value: number;
  hint?: string;
  icon?: React.ElementType;
  tone?: HrTone;
  href?: string;
  /** An in-page action — the Overview uses this to land on the tab that explains the number. */
  onClick?: () => void;
  /** Position in the grid — staggers the entrance so the row doesn't pop in all at once. */
  index?: number;
}) {
  const palette = KPI_TONES[tone] ?? KPI_TONES.slate;

  const body = (
    <SpotlightCard
      spotlightColor={palette.glow}
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'both' }}
      className={cn(
        'group h-full animate-am-card-in rounded-lg border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg',
        ACCESS_CARD_CLASS,
        (href || onClick) && 'cursor-pointer',
      )}
    >
      <div className={cn('h-0.5 w-full bg-gradient-to-r', palette.bar)} />
      <div className="flex items-start gap-3 p-4">
        {Icon && (
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-4 transition-transform duration-300 group-hover:scale-110',
              palette.bg,
              palette.ring,
            )}
          >
            <Icon className={cn('h-4 w-4', palette.text)} />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 truncate text-lg font-semibold leading-tight text-slate-800">
            <CountUp value={value} />
          </p>
          {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </div>
    </SpotlightCard>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {body}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block h-full w-full text-left">
        {body}
      </button>
    );
  }

  return body;
}

/* ------------------------------------------------------------------------------------------------
 * Source badges (§8)
 * ---------------------------------------------------------------------------------------------- */

const SOURCE_STYLE: Record<AccessSourceKind, { className: string; icon: React.ElementType; short: string }> = {
  Existing: { className: 'border-slate-200 bg-slate-50 text-slate-700', icon: ShieldCheck, short: 'Existing' },
  'Base Role': { className: 'border-slate-200 bg-slate-50 text-slate-700', icon: ShieldCheck, short: 'Base' },
  'Additional Role': { className: 'border-indigo-200 bg-indigo-50 text-indigo-700', icon: Layers, short: 'Added' },
  'Direct Permission': { className: 'border-violet-200 bg-violet-50 text-violet-700', icon: KeyRound, short: 'Direct' },
  Department: { className: 'border-cyan-200 bg-cyan-50 text-cyan-700', icon: Building2, short: 'Dept' },
  Designation: { className: 'border-teal-200 bg-teal-50 text-teal-700', icon: BadgeCheck, short: 'Desig' },
  Project: { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: FolderKanban, short: 'Project' },
  Temporary: { className: 'border-amber-200 bg-amber-50 text-amber-800', icon: CalendarClock, short: 'Temp' },
  System: { className: 'border-slate-200 bg-white text-slate-600', icon: Sparkles, short: 'System' },
};

/**
 * One badge per reason a user holds a permission.
 *
 * The label carries the *specific* grant (the role name, the project name) rather than just the
 * kind, because "Additional Role" tells an administrator nothing they can act on and "Finance
 * Manager (Additional Role)" tells them exactly which grant to remove.
 */
export function SourceBadge({
  source,
  compact = false,
  className,
}: {
  source: PermissionSource;
  compact?: boolean;
  className?: string;
}) {
  const style = SOURCE_STYLE[source.kind] ?? SOURCE_STYLE.System;
  const Icon = style.icon;

  const detail = [
    source.kind,
    source.assignedByName ? `assigned by ${source.assignedByName}` : null,
    source.assignedAt ? formatGrantDate(source.assignedAt) : null,
    source.expiresAt ? `expires ${formatGrantDate(source.expiresAt)}` : null,
    source.reason ? `reason: ${source.reason}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn('gap-1 whitespace-nowrap text-[10px] font-medium', style.className, className)}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span className="max-w-[10rem] truncate">{compact ? style.short : source.label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Several sources, collapsed past `max` so a table row cannot grow without bound. */
export function SourceBadges({
  sources,
  max = 3,
  compact,
}: {
  sources: PermissionSource[];
  max?: number;
  compact?: boolean;
}) {
  if (!sources.length) {
    return <span className="text-xs text-muted-foreground">Not granted</span>;
  }
  const shown = sources.slice(0, max);
  const hidden = sources.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((source, index) => (
        <SourceBadge key={`${source.kind}-${source.refId ?? source.label}-${index}`} source={source} compact={compact} />
      ))}
      {hidden > 0 && (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          +{hidden} more
        </Badge>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Role badges (§40)
 * ---------------------------------------------------------------------------------------------- */

/**
 * A role, marked as base or additional.
 *
 * §40 asks for the distinction to be visible everywhere, and the reason is operational: an
 * administrator about to remove a role needs to know at a glance whether they are touching the
 * additive layer (this screen's job) or the user's original role (User Management's job).
 */
export function RoleBadge({
  name,
  kind = 'additional',
  onRemove,
  disabled,
  className,
}: {
  name: string;
  kind?: 'base' | 'additional' | 'temporary';
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const palette =
    kind === 'base'
      ? 'border-slate-300 bg-slate-100 text-slate-800'
      : kind === 'temporary'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-indigo-200 bg-indigo-50 text-indigo-700';

  return (
    <Badge variant="outline" className={cn('gap-1 text-xs font-medium', palette, className)}>
      {kind === 'base' && <ShieldCheck className="h-3 w-3" />}
      {kind === 'additional' && <Layers className="h-3 w-3" />}
      {kind === 'temporary' && <CalendarClock className="h-3 w-3" />}
      <span className="max-w-[12rem] truncate">{name}</span>
      {kind === 'base' && <span className="text-[9px] uppercase tracking-wide opacity-70">base</span>}
      {onRemove && !disabled && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/10"
        >
          <Minus className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}

/* ------------------------------------------------------------------------------------------------
 * The two numbers the preview screens exist to show (§15, §34, §47)
 * ---------------------------------------------------------------------------------------------- */

/**
 * The "0 existing permissions removed" readout.
 *
 * Rendered as its own component with its own emphasis because it is the promise the whole feature
 * makes. When it is zero it is reassuring and green; if it is ever non-zero it must be impossible
 * to miss, so it turns red and says so in words rather than just showing a number.
 */
export function RemovalReadout({ removed, className }: { removed: number; className?: string }) {
  const safe = removed === 0;
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm',
        safe
          ? 'border-emerald-200 bg-emerald-50/80 text-emerald-800'
          : 'border-destructive/40 bg-destructive/10 text-destructive',
        className,
      )}
    >
      {safe ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0">
        <p className="font-semibold">Existing permissions removed: {removed}</p>
        <p className="text-xs opacity-90">
          {safe
            ? 'No existing permissions will be removed. Everything these users can do today, they will still be able to do.'
            : 'This operation would reduce access. Use the explicit removal workflow instead.'}
        </p>
      </div>
    </div>
  );
}

/** A compact "17 new · 6 already assigned · 0 removed" line for table rows and card footers. */
export function DiffSummary({
  added,
  already,
  removed,
  className,
}: {
  added: number;
  already: number;
  removed: number;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5 text-xs', className)}>
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        +{added} new
      </Badge>
      {already > 0 && (
        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
          {already} already assigned
        </Badge>
      )}
      <Badge
        variant="outline"
        className={
          removed === 0
            ? 'border-slate-200 bg-white text-slate-500'
            : 'border-destructive/40 bg-destructive/10 text-destructive'
        }
      >
        {removed} removed
      </Badge>
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Risk (§46)
 * ---------------------------------------------------------------------------------------------- */

/** Privilege and segregation-of-duties findings, as warnings. Never as blockers — see §46. */
export function RiskBadges({
  privileges,
  conflicts,
  className,
}: {
  privileges: PrivilegeFinding[];
  conflicts: SodConflict[];
  className?: string;
}) {
  if (!privileges.length && !conflicts.length) return null;
  return (
    <TooltipProvider>
      <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
        {privileges.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                <UserCog className="h-3 w-3" />
                High privilege
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <ul className="list-disc pl-4">
                {privileges.map((finding) => (
                  <li key={finding.label}>{finding.label}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
        {conflicts.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-1 border-rose-200 bg-rose-50 text-[10px] text-rose-700">
                <AlertTriangle className="h-3 w-3" />
                {conflicts.length} SoD conflict{conflicts.length === 1 ? '' : 's'}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <ul className="list-disc pl-4">
                {conflicts.map((conflict) => (
                  <li key={conflict.id}>{conflict.label}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Permission pair rendering
 * ---------------------------------------------------------------------------------------------- */

/** `"Project Management.BOQ::Import"` → `Project Management › BOQ · Import`. */
export function PermissionPair({ pair, className }: { pair: string; className?: string }) {
  const { resource, action } = splitPermissionKey(pair);
  const segments = resource.split('.');
  return (
    <span className={cn('inline-flex min-w-0 items-baseline gap-1 text-xs', className)}>
      <span className="truncate text-slate-500">{segments.join(' › ')}</span>
      <span className="shrink-0 font-medium text-slate-800">· {action}</span>
    </span>
  );
}

/** A scrollable list of permission pairs, for the preview and audit detail views. */
export function PermissionPairList({
  pairs,
  emptyLabel = 'None',
  max = 400,
}: {
  pairs: string[];
  emptyLabel?: string;
  max?: number;
}) {
  if (!pairs.length) return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  const shown = pairs.slice(0, max);
  return (
    <div className="space-y-0.5">
      {shown.map((pair) => (
        <div key={pair} className="truncate">
          <PermissionPair pair={pair} />
        </div>
      ))}
      {pairs.length > shown.length && (
        <p className="pt-1 text-xs text-muted-foreground">+{pairs.length - shown.length} more</p>
      )}
    </div>
  );
}

/** Small labelled counter used across the preview and result panels. */
export function StatLine({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'indigo';
}) {
  const palette = {
    slate: 'text-slate-800',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    indigo: 'text-indigo-700',
  }[tone];
  return (
    <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold leading-tight', palette)}>{value}</p>
    </div>
  );
}
