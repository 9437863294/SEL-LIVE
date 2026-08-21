'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, Loader2, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { travelCurrency, travelStatusLabel, travelStatusTone } from '@/lib/tour-travel';

/**
 * Presentation primitives shared across the Tour, Travel & Expense screens.
 *
 * These exist so the twenty-odd views in this module can't drift on the things a user reads as
 * meaning: a status badge's colour, how a rupee figure is formatted, what an empty register looks
 * like. Anything with business logic belongs in tour-travel-policy.ts, not here.
 */

/** The accent palette shared by KPI cards and tiles. */
export type TravelTone = 'slate' | 'emerald' | 'amber' | 'rose' | 'blue' | 'indigo' | 'orange' | 'violet' | 'teal';

/** Status badge. Always renders through `travelStatusLabel`, so no screen prints a raw token. */
export function TravelStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border font-medium', travelStatusTone(status), className)}>
      {travelStatusLabel(status)}
    </Badge>
  );
}

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

export function TravelPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    // Stacked on a phone with full-width actions, side by side from `sm` up. A wrapped row of
    // half-width buttons under a two-line heading is the worst of both on a narrow screen.
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>
      )}
    </div>
  );
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
 * Collapsible filter panel. Collapsed by default on mobile, because a register's filters otherwise
 * push the actual rows off the first screen on a phone — which is where most travel expense work
 * happens.
 */
export function TravelFilterCard({
  children,
  title = 'Filters',
  summary,
}: {
  children: React.ReactNode;
  title?: string;
  summary?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="mb-3 border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 px-4 py-3">
        <div className="min-w-0">
          <CardTitle className="text-sm">{title}</CardTitle>
          {summary && <CardDescription className="truncate text-xs">{summary}</CardDescription>}
        </div>
        <Button variant="ghost" size="sm" className="shrink-0 gap-1 lg:hidden" onClick={() => setOpen(value => !value)}>
          {open ? 'Hide' : 'Show'}
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </Button>
      </CardHeader>
      <CardContent className={cn('px-4 pb-4', !open && 'hidden lg:block')}>{children}</CardContent>
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
 * Responsive record list
 * ---------------------------------------------------------------------------------------------- */

/**
 * One column of a register, declared once and rendered twice — as a table cell on desktop and as
 * part of a card on mobile.
 *
 * `mobile` decides where the value lands on the card:
 *   'title'  → the card's headline (first one wins the emphasis)
 *   'aside'  → top-right, for a status badge
 *   'detail' → the label/value grid in the card body (the default)
 *   'footer' → a full-width row at the bottom, for actions
 *   'omit'   → desktop only
 */
export interface TravelListColumn<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  /** Extra classes for the desktop `<TableCell>`/`<TableHead>` — e.g. 'hidden md:table-cell'. */
  className?: string;
  mobile?: 'title' | 'aside' | 'detail' | 'footer' | 'omit';
}

/**
 * A register that reads well on a phone and on a desktop from a single column spec.
 *
 * Every list in this module used to be a horizontally scrolling table with half its columns hidden
 * below `sm`, which on a phone meant swiping sideways to find out what a claim was worth. This
 * renders the house pattern instead — a card list under `sm:hidden`, the table under
 * `hidden sm:block` — from one definition, so the two can't drift apart and adding a column doesn't
 * mean writing it twice.
 */
export function TravelDataList<T extends { id: string }>({
  rows,
  columns,
  rowClassName,
  empty,
  cardHref,
}: {
  rows: T[];
  columns: Array<TravelListColumn<T>>;
  rowClassName?: (row: T) => string | undefined;
  empty?: React.ReactNode;
  /** When given, the whole mobile card becomes a link to this route. */
  cardHref?: (row: T) => string;
}) {
  if (rows.length === 0) return <>{empty}</>;

  const titles = columns.filter(column => column.mobile === 'title');
  const asides = columns.filter(column => column.mobile === 'aside');
  const footers = columns.filter(column => column.mobile === 'footer');
  const details = columns.filter(column => !column.mobile || column.mobile === 'detail');

  return (
    <>
      {/* Mobile: one card per record. */}
      <div className="space-y-2.5 sm:hidden">
        {rows.map(row => {
          const href = cardHref?.(row);
          const body = (
            <>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  {titles.map((column, index) => (
                    <div key={column.header} className={index === 0 ? 'text-sm font-semibold text-slate-800' : 'text-xs text-muted-foreground'}>
                      {column.cell(row)}
                    </div>
                  ))}
                </div>
                {asides.length > 0 && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {asides.map(column => (
                      <div key={column.header}>{column.cell(row)}</div>
                    ))}
                  </div>
                )}
              </div>

              {details.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2">
                  {details.map(column => (
                    <div key={column.header} className={column.align === 'right' ? 'text-right' : undefined}>
                      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{column.header}</dt>
                      <dd className="truncate text-sm text-slate-800">{column.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {footers.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2 border-t border-slate-100 pt-2.5 [&_button]:min-h-11 [&_button]:flex-1">
                  {footers.map(column => (
                    <div key={column.header} className="flex flex-1 gap-2">{column.cell(row)}</div>
                  ))}
                </div>
              )}
            </>
          );

          const shell = cn(
            'rounded-xl border border-white/70 bg-white/85 p-3.5 shadow-sm transition-transform active:scale-[0.99]',
            rowClassName?.(row),
          );

          // A card wrapped in a link still has to let its footer buttons receive the tap, so the
          // link only covers the informational part when there are actions.
          return href && footers.length === 0 ? (
            <Link key={row.id} href={href} className={cn(shell, 'block')}>
              {body}
            </Link>
          ) : (
            <div key={row.id} className={shell}>
              {body}
            </div>
          );
        })}
      </div>

      {/* Desktop: the full table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-white/60 bg-white/80 backdrop-blur-sm sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map(column => (
                <TableHead key={column.header} className={cn(column.align === 'right' && 'text-right', column.className)}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow key={row.id} className={rowClassName?.(row)}>
                {columns.map(column => (
                  <TableCell key={column.header} className={cn('text-sm', column.align === 'right' && 'text-right', column.className)}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
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
