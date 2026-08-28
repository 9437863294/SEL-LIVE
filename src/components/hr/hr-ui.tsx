'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, Loader2, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { hrCurrency, hrStatusLabel, hrStatusTone, priorityTone, type RequirementPriority } from '@/lib/hr-requirement';

/**
 * Presentation primitives shared across the HR screens.
 *
 * These exist so the two dozen views in this module can't drift on the things a user reads as
 * meaning: a status badge's colour, how a rupee figure is formatted, what an empty register looks
 * like, how a fill bar renders. Anything with business logic belongs in hr-policy.ts, not here.
 */

export type HrTone = 'slate' | 'emerald' | 'amber' | 'rose' | 'blue' | 'indigo' | 'orange' | 'violet' | 'teal' | 'cyan';

const TONES: Record<HrTone, { bg: string; text: string; ring: string }> = {
  slate: { bg: 'bg-slate-50', text: 'text-slate-600', ring: 'ring-slate-100' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-100' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-600', ring: 'ring-rose-100' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-600', ring: 'ring-blue-100' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', ring: 'ring-indigo-100' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-600', ring: 'ring-orange-100' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600', ring: 'ring-violet-100' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600', ring: 'ring-teal-100' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-600', ring: 'ring-cyan-100' },
};

/** Status badge. Always renders through `hrStatusLabel`, so no screen prints a raw token. */
export function HrStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border font-medium', hrStatusTone(status), className)}>
      {hrStatusLabel(status)}
    </Badge>
  );
}

export function HrPriorityBadge({ priority, className }: { priority: RequirementPriority | string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border font-medium', priorityTone(priority), className)}>
      {priority}
    </Badge>
  );
}

export function HrKpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
  href,
}: {
  label: string;
  /** A node so a card can show a `<Money>` figure without the caller stringifying it. */
  value: React.ReactNode;
  hint?: string;
  icon?: React.ElementType;
  tone?: HrTone;
  href?: string;
}) {
  const palette = TONES[tone] || TONES.slate;

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
export function Money({ value, className, exact = false }: { value: number | undefined | null; className?: string; exact?: boolean }) {
  const formatted = exact
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0)
    : hrCurrency(value);
  return <span className={cn('tabular-nums', className)}>{formatted}</span>;
}

/**
 * A CTC figure that renders only for holders of the sensitive-data permission (control rule 63.12).
 *
 * Salary visibility follows permission, not role name, and the withheld case shows a dash rather
 * than an empty cell — an absent number and a number the reader may not see are different things,
 * and a blank invites someone to "fix" it.
 */
export function SensitiveMoney({
  value,
  canView,
  exact = false,
  className,
}: {
  value: number | undefined | null;
  canView: boolean;
  exact?: boolean;
  className?: string;
}) {
  if (!canView) {
    return (
      <span className={cn('text-muted-foreground', className)} title="You do not have permission to view salary figures">
        ₹ ••••
      </span>
    );
  }
  return <Money value={value} exact={exact} className={className} />;
}

export function HrPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    // Stacked on a phone with full-width actions, side by side from `sm` up.
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </div>
  );
}

export function HrLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  );
}

export function HrEmptyState({
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

export function HrAccessDenied({ what = 'this page' }: { what?: string }) {
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
 * Collapsible filter panel. Collapsed by default on mobile, because the requirement register's
 * eleven filters otherwise push the actual rows off the first screen on a phone.
 */
export function HrFilterCard({
  children,
  title = 'Filters',
  summary,
  actions,
}: {
  children: React.ReactNode;
  title?: string;
  summary?: string;
  actions?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="mb-3 border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 px-4 py-3">
        <div className="min-w-0">
          <CardTitle className="text-sm">{title}</CardTitle>
          {summary && <CardDescription className="truncate text-xs">{summary}</CardDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <Button variant="ghost" size="sm" className="shrink-0 gap-1 lg:hidden" onClick={() => setOpen(value => !value)}>
            {open ? 'Hide' : 'Show'}
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className={cn('px-4 pb-4', !open && 'hidden lg:block')}>{children}</CardContent>
    </Card>
  );
}

/**
 * A labelled read-only field for the detail screens. Used instead of ad-hoc divs so a requirement's
 * forty-odd attributes render at a consistent density and alignment.
 */
export function HrField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 break-words text-sm font-medium text-slate-800">{children || '—'}</div>
    </div>
  );
}

export function HrSection({
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
 * Fill and SLA indicators
 * ---------------------------------------------------------------------------------------------- */

/**
 * The `joined / required` bar every requirement view shows (spec sections 16, 37, 54).
 *
 * Renders joined and offer-accepted as two segments rather than one total, because a bar that
 * counts an accepted offer as filled tells a project manager they have people who are not there
 * yet — which is exactly the confusion the two balance figures in `summarizeRequirementFill` exist
 * to prevent.
 */
export function HrFillBar({
  required,
  joined,
  accepted = 0,
  compact = false,
}: {
  required: number;
  joined: number;
  accepted?: number;
  compact?: boolean;
}) {
  const total = Math.max(1, required);
  const joinedPercent = Math.min(100, (joined / total) * 100);
  const acceptedPercent = Math.min(100 - joinedPercent, (accepted / total) * 100);

  return (
    <div className={cn('min-w-0', compact ? 'w-24' : 'w-full')}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="bg-emerald-500 transition-all" style={{ width: `${joinedPercent}%` }} />
        <div className="bg-violet-400 transition-all" style={{ width: `${acceptedPercent}%` }} />
      </div>
      {!compact && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {joined} joined{accepted > 0 ? `, ${accepted} accepted` : ''} of {required}
        </p>
      )}
    </div>
  );
}

/** SLA badge, tinted by state (spec section 40). */
export function HrSlaBadge({
  state,
  consumedPercent,
  overdueDays,
}: {
  state: 'Not started' | 'On track' | 'Due soon' | 'Overdue' | string;
  consumedPercent?: number;
  overdueDays?: number;
}) {
  const tone =
    state === 'Overdue'
      ? 'bg-rose-100 text-rose-800 border-rose-200'
      : state === 'Due soon'
        ? 'bg-amber-100 text-amber-800 border-amber-200'
        : state === 'On track'
          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
          : 'bg-slate-100 text-slate-700 border-slate-200';

  const label =
    state === 'Overdue' && overdueDays
      ? `Overdue ${overdueDays}d`
      : state === 'Not started'
        ? 'SLA not started'
        : `${state}${consumedPercent !== undefined ? ` · ${Math.round(consumedPercent)}%` : ''}`;

  return <Badge variant="outline" className={cn('border font-medium', tone)}>{label}</Badge>;
}

/** A labelled progress meter, for document completion and manpower fulfilment. */
export function HrMeter({ label, percent, hint }: { label: string; percent: number; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="truncate text-xs font-medium text-slate-700">{label}</p>
        <p className="shrink-0 text-xs tabular-nums text-muted-foreground">{Math.round(percent)}%</p>
      </div>
      <Progress value={Math.max(0, Math.min(100, percent))} className="h-2" />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A loud callout for the things an approver must not be able to skim past (spec sections 9, 28). */
export function HrAlertNotice({
  tone = 'amber',
  title,
  children,
}: {
  tone?: 'amber' | 'rose' | 'blue' | 'emerald';
  title?: string;
  children: React.ReactNode;
}) {
  const palette = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];

  return (
    <div className={cn('rounded-lg border px-3 py-2 text-xs', palette)}>
      {title && <span className="font-semibold">{title}: </span>}
      {children}
    </div>
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
export interface HrListColumn<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  /** Extra classes for the desktop `<TableCell>`/`<TableHead>` — e.g. 'hidden md:table-cell'. */
  className?: string;
  mobile?: 'title' | 'aside' | 'detail' | 'footer' | 'omit';
}

/**
 * A register that reads well on a phone and on a desktop from a single column spec — a card list
 * under `sm:hidden`, the table under `hidden sm:block` — so the two can't drift apart and adding a
 * column doesn't mean writing it twice.
 */
export function HrDataList<T extends { id: string }>({
  rows,
  columns,
  rowClassName,
  empty,
  cardHref,
  tableClassName,
  fitContent,
  onRowClick,
}: {
  rows: T[];
  columns: Array<HrListColumn<T>>;
  rowClassName?: (row: T) => string | undefined;
  empty?: React.ReactNode;
  /** When given, the whole mobile card becomes a link to this route. */
  cardHref?: (row: T) => string;
  /**
   * Extra classes for the `<table>` itself. Defaults (`w-full`, auto layout) stretch every column to
   * fill the container, which is right for a register meant to use the whole width but wrong for a
   * handful of short columns on a wide screen — those end up padded with dead space between values
   * instead of sitting close to their labels. Pass `'w-auto'` to let the table size itself to its
   * content, optionally with `'table-fixed'` and per-column width classes for exact control.
   */
  tableClassName?: string;
  /**
   * Shrinks the bordered card itself to the table's actual width instead of the full row width.
   *
   * `tableClassName="w-auto"` alone only narrows the `<table>` element — the card *around* it still
   * stretches edge to edge, so a short table on a wide screen ends up sitting in the left corner of a
   * mostly-empty box, which reads as data spilling across the page rather than as one contained
   * table. This collapses the card to match.
   */
  fitContent?: boolean;
  /**
   * Makes each desktop row and each phone card (one without `cardHref` or footer actions) a tap
   * target — for pickers where the row *is* the control. Controls inside the row that must not
   * also fire it (a checkbox) should stop propagation themselves.
   */
  onRowClick?: (row: T) => void;
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
          if (href && footers.length === 0) {
            return (
              <Link key={row.id} href={href} className={cn(shell, 'block')}>
                {body}
              </Link>
            );
          }
          if (onRowClick && !href && footers.length === 0) {
            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => onRowClick(row)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowClick(row);
                  }
                }}
                className={cn(shell, 'cursor-pointer')}
              >
                {body}
              </div>
            );
          }
          return (
            <div key={row.id} className={shell}>
              {body}
            </div>
          );
        })}
      </div>

      {/* Desktop: the full table. */}
      <div
        className={cn(
          'hidden overflow-x-auto rounded-lg border border-white/60 bg-white/80 backdrop-blur-sm',
          fitContent ? 'sm:inline-block max-w-full' : 'sm:block',
        )}
      >
        <Table className={tableClassName}>
          {/*
            The header row used to render with the same near-white background as the body and a
            `text-muted-foreground` weight barely darker than the page behind it — on a
            backdrop-blur card it all but disappeared. A tinted band, bolder small-caps labels and a
            firmer bottom border give it the contrast a header needs to read as one at a glance.
          */}
          <TableHeader className="bg-slate-100/80">
            <TableRow className="hover:bg-transparent">
              {columns.map(column => (
                <TableHead
                  key={column.header}
                  className={cn(
                    'h-10 text-[11px] font-semibold uppercase tracking-wide text-slate-600',
                    column.align === 'right' && 'text-right',
                    column.className,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow
                key={row.id}
                className={cn(rowClassName?.(row), onRowClick && 'cursor-pointer')}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
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

/**
 * Class names that turn a ShadCN dialog into a full-screen sheet on a phone. The behaviour lives in
 * `globals.css` under `.hr-mobile-dialog`; these constants exist so every dialog in the module opts
 * in the same way and the body is the part that scrolls.
 */
export const hrDialog = {
  content: 'hr-mobile-dialog sm:max-w-lg',
  contentWide: 'hr-mobile-dialog sm:max-w-3xl',
  /**
   * A long form: wide, capped to the viewport, and scrolled in the body rather than the page.
   *
   * `hr-mobile-dialog` already does this on a phone, but only inside its media query — so on a
   * desktop a tall dialog simply overflowed the viewport with the footer buttons off-screen and no
   * scrollbar to reach them. `flex` plus a capped height makes the body the scrolling element at every
   * width, which is what `.hr-dialog-body` already assumes.
   *
   * Pair with `bodyScroll`; `body` alone will not scroll, because a `space-y` div with no height
   * constraint just grows.
   */
  contentTall: 'hr-mobile-dialog sm:max-w-5xl sm:max-h-[90dvh] sm:flex sm:flex-col',
  header: 'hr-dialog-header',
  /** Stacked fields. */
  body: 'hr-dialog-body space-y-3',
  /** Stacked fields in a `contentTall` dialog: the part that scrolls. */
  bodyScroll: 'hr-dialog-body space-y-3 sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:pr-1',
  /** Paired fields — one column on a phone, two from `sm` up. */
  bodyGrid: 'hr-dialog-body grid grid-cols-1 gap-3 sm:grid-cols-2',
  footer: 'hr-dialog-footer sm:shrink-0',
} as const;

/** A simple horizontal bar chart, for the dashboard's by-department / by-project breakdowns. */
export function HrBarList({
  rows,
  valueLabel,
  tone = 'indigo',
  emptyLabel = 'Nothing to show yet.',
}: {
  rows: Array<{ label: string; value: number; hint?: string; href?: string }>;
  valueLabel?: (value: number) => React.ReactNode;
  tone?: 'indigo' | 'emerald' | 'rose' | 'amber';
  emptyLabel?: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  const max = Math.max(...rows.map(row => row.value), 1);
  const barTone = { indigo: 'bg-indigo-500', emerald: 'bg-emerald-500', rose: 'bg-rose-500', amber: 'bg-amber-500' }[tone];

  return (
    <div className="space-y-2.5">
      {rows.map(row => {
        const content = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <p className="truncate text-xs font-medium text-slate-700">{row.label}</p>
              <p className="shrink-0 text-xs font-semibold tabular-nums text-slate-800">
                {valueLabel ? valueLabel(row.value) : row.value}
              </p>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={cn('h-full rounded-full transition-all', barTone)} style={{ width: `${(row.value / max) * 100}%` }} />
            </div>
            {row.hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{row.hint}</p>}
          </>
        );
        return row.href ? (
          <Link key={row.label} href={row.href} className="block rounded-md p-1 -m-1 transition-colors hover:bg-slate-50">
            {content}
          </Link>
        ) : (
          <div key={row.label}>{content}</div>
        );
      })}
    </div>
  );
}

/** The hiring funnel of spec section 53, rendered as a tapering stack. */
export function HrFunnel({
  stages,
}: {
  stages: Array<{ label: string; count: number; conversionFromPrevious: number }>;
}) {
  const top = Math.max(stages[0]?.count || 0, 1);
  return (
    <div className="space-y-1.5">
      {stages.map(stage => (
        <div key={stage.label} className="flex items-center gap-2">
          <p className="w-28 shrink-0 truncate text-[11px] text-muted-foreground sm:w-36">{stage.label}</p>
          <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100">
            <div
              className="flex h-full items-center justify-end rounded bg-gradient-to-r from-indigo-500 to-violet-500 px-1.5 transition-all"
              style={{ width: `${Math.max(2, (stage.count / top) * 100)}%` }}
            >
              <span className="text-[10px] font-semibold text-white">{stage.count}</span>
            </div>
          </div>
          <p className="w-11 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {stage.conversionFromPrevious}%
          </p>
        </div>
      ))}
    </div>
  );
}
