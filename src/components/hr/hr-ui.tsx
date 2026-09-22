'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, Loader2, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { hrCurrency, hrStatusLabel, hrStatusTone, priorityTone, type RequirementPriority } from '@/lib/hr-requirement';

/**
 * Presentation primitives shared across the HR screens.
 *
 * These exist so the two dozen views in this module can't drift on the things a user reads as
 * meaning: a status badge's colour, how a rupee figure is formatted, what an empty register looks
 * like, how a fill bar renders. Anything with business logic belongs in hr-policy.ts, not here.
 */


/**
 * The tone palette, the KPI card and the page header now live in `@/components/shared/kpi-card`.
 *
 * They were never HR-specific — fifty files across HR, Employee and the home dashboard use them —
 * and keeping them here meant anything that wanted a KPI card also imported this file's dependency
 * on `@/lib/hr-requirement`, and through it the whole of `hr-policy.ts`. Re-exported under their
 * original names so every existing call site is untouched; new code should import from the shared
 * module directly.
 */
export { TONES as HR_TONES, KpiCard as HrKpiCard, PageHeader as HrPageHeader } from '@/components/shared/kpi-card';
export type { Tone as HrTone } from '@/components/shared/kpi-card';

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
 * The responsive register moved to `@/components/shared/data-list`.
 *
 * Same reasoning as the KPI card above: it has no HR-specific dependency, it is used well beyond
 * this module, and keeping it here forced every consumer to import `hr-policy.ts` with it.
 * Re-exported under the original names so no call site changed.
 */
export {
  CellLink as HrCellLink,
  DataList as HrDataList,
  useInsideLink as useHrInsideLink,
} from '@/components/shared/data-list';
export type { ListColumn as HrListColumn } from '@/components/shared/data-list';

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
