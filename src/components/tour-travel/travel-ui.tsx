'use client';

import Link from 'next/link';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { travelCurrency } from '@/lib/tour-travel';

/**
 * Presentation primitives shared across the Tour, Travel & Expense screens.
 *
 * These exist so the twenty-odd views in this module can't drift on the things a user reads as
 * meaning: how a rupee figure is formatted, what an empty register looks like. Anything with
 * business logic belongs in tour-travel-policy.ts, not here. Registers, filter bars and status
 * badges come from the app-wide kit (`DataList`, `TableCard`, `FilterBar`, `StatusBadge`), with
 * status labels from `travelStatusLabel`.
 */

/** The accent palette shared by KPI cards and tiles. */
export type TravelTone = 'slate' | 'emerald' | 'amber' | 'rose' | 'blue' | 'indigo' | 'orange' | 'violet' | 'teal';

export function TravelKpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
  href,
}: {
  label: string;
  /** Accepts a node so a card can show a `<Money>` figure without the caller stringifying it. */
  value: React.ReactNode;
  hint?: string;
  icon?: React.ElementType;
  tone?: TravelTone;
  href?: string;
}) {
  const tones: Record<TravelTone, { bg: string; text: string; ring: string }> = {
    slate: { bg: 'bg-slate-50', text: 'text-slate-600', ring: 'ring-slate-100' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-100' },
    rose: { bg: 'bg-rose-50', text: 'text-rose-600', ring: 'ring-rose-100' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', ring: 'ring-blue-100' },
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', ring: 'ring-indigo-100' },
    orange: { bg: 'bg-orange-50', text: 'text-orange-600', ring: 'ring-orange-100' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600', ring: 'ring-violet-100' },
    teal: { bg: 'bg-teal-50', text: 'text-teal-600', ring: 'ring-teal-100' },
  };
  const palette = tones[tone] || tones.slate;

  const body = (
    <Card className={cn('h-full border-white/60 bg-white/80 shadow-sm backdrop-blur-sm transition-shadow', href && 'hover:shadow-md')}>
      <CardContent className="flex items-start gap-3 p-4">
        {Icon && (
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-4', palette.bg, palette.ring)}>
            <Icon className={cn('h-4 w-4', palette.text)} />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 truncate text-lg font-semibold leading-tight text-slate-800">{value}</p>
          {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/** Money, right-aligned and tabular so columns of figures line up for scanning. */
export function Money({ value, className, exact = false }: { value: number; className?: string; exact?: boolean }) {
  const formatted = exact
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)
    : travelCurrency(value);
  return <span className={cn('tabular-nums', className)}>{formatted}</span>;
}

export function TravelLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2">
      <Loader2 className="h-6 w-6 animate-spin text-sky-600" />
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  );
}

export function TravelEmptyState({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
}) {
  return (
    <Card className="border-dashed border-slate-200 bg-white/60">
      <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
        {Icon && <Icon className="h-10 w-10 text-slate-300" />}
        <p className="font-medium text-slate-700">{title}</p>
        {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
      </CardContent>
    </Card>
  );
}

export function TravelAccessDenied({ what = 'this page' }: { what?: string }) {
  return (
    <Card className="border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
      <CardContent className="space-y-3 py-16 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
        <div>
          <p className="font-semibold text-slate-800">Access denied</p>
          <p className="mt-1 text-sm text-muted-foreground">You do not have permission to view {what}.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Contact your administrator to request access.</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * A labelled read-only field, for the detail screens. Used instead of ad-hoc divs so that a tour's
 * forty-odd attributes render at a consistent density and alignment.
 */
export function TravelField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 break-words text-sm font-medium text-slate-800">{children || '—'}</div>
    </div>
  );
}

/** Section wrapper for the detail and form screens. */
export function TravelSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('border-white/60 bg-white/80 shadow-sm backdrop-blur-sm', className)}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Mobile-aware dialog and inputs
 * ---------------------------------------------------------------------------------------------- */

/**
 * Class names that turn a ShadCN dialog into a full-screen sheet on a phone. The behaviour lives in
 * `globals.css` under `.tt-mobile-dialog`; these constants exist so every dialog in the module
 * opts in the same way and the body is the part that scrolls.
 */
export const travelDialog = {
  content: 'tt-mobile-dialog sm:max-w-lg',
  header: 'tt-dialog-header',
  /** Stacked fields. */
  body: 'tt-dialog-body space-y-3',
  /** Paired fields — one column on a phone, two from `sm` up. */
  bodyGrid: 'tt-dialog-body grid grid-cols-1 gap-3 sm:grid-cols-2',
  footer: 'tt-dialog-footer',
} as const;

/*
 * Amount and quantity fields across the module carry `inputMode="decimal"` alongside
 * `type="number"`, which is what gets a phone to show the numeric keypad with a decimal point.
 * The spinner arrows `type="number"` also brings — unusable at thumb size — are suppressed for the
 * whole module by `.tt-module-root input[type='number']` in globals.css.
 */

/**
 * A policy exception callout. Deliberately loud: an approver skimming a tour must not be able to
 * miss that something exceeds entitlement (spec section 10).
 */
export function PolicyExceptionNotice({
  claimed,
  entitled,
  label = 'entitlement',
}: {
  claimed: number;
  entitled: number;
  label?: string;
}) {
  const excess = Math.round((claimed - entitled) * 100) / 100;
  if (excess <= 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <span className="font-semibold">Exception: </span>
      <Money value={excess} /> above {label} (claimed <Money value={claimed} />, {label} <Money value={entitled} />).
    </div>
  );
}
