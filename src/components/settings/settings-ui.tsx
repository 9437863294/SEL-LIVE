'use client';

/**
 * The parts every Settings page is built from, so the module reads as one design:
 *
 * - `SettingsPage`: the page column. It has no padding of its own: the Settings frame
 *   (`ModuleShell`) already pads every page, and a second layer of padding is what left the pages
 *   indented by different amounts.
 * - `SettingsSection`: a titled card for one group of settings, with an optional footer bar for
 *   that section's own Save.
 * - `SettingsColumns`: sections side by side on a wide screen.
 * - `SwitchRow`: an on/off setting with its label wired to the switch.
 * - `SettingsNotice`: a short banner (information, warning, problem, done).
 * - `SettingsAccessDenied` and `SettingsPageSkeleton`: the same "you may not open this" and
 *   loading states on every page.
 *
 * Colours are theme tokens and the user's accent, so light, dark and every Appearance choice apply.
 */

import { useId, type ComponentType, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, RotateCcw, XCircle, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PageAccessDenied } from '@/components/shared/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { cn } from '@/lib/utils';

/** A Settings page: its header and sections, 1rem apart. */
export function SettingsPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-w-0 space-y-4', className)}>{children}</div>;
}

export function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
  action,
  footer,
  flush = false,
  id,
  className,
  contentClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  action?: ReactNode;
  /** A bar under the content for this section's own buttons (Save, Cancel), on a hairline. */
  footer?: ReactNode;
  /** The content runs edge to edge (a list or a table) instead of sitting in the card's padding. */
  flush?: boolean;
  id?: string;
  className?: string;
  /** The content's layout, in place of the default 1.25rem between settings (e.g. a form grid). */
  contentClassName?: string;
}) {
  // Compact by design: a 1rem card padding and 1.25rem between settings. The 1.5rem padding and
  // 1.5rem gaps this had read as mostly empty space once a page used its full width.
  // No `overflow-hidden`: it would stop a sticky panel inside a section from sticking.
  return (
    <Card id={id} className={cn('min-w-0 [--card-pad:1rem]', flush && 'overflow-hidden', className)}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {/* `flex-1`, so a long description wraps beside the action instead of pushing it onto a
              line of its own. */}
          <div className="min-w-0 flex-1 basis-[14rem]">
            <div className="flex items-center gap-2">
              {Icon && (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </span>
              )}
              <CardTitle className="min-w-0 text-base">{title}</CardTitle>
            </div>
            {description && <CardDescription className="mt-1 text-xs">{description}</CardDescription>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      </CardHeader>
      {/* `contentClassName` replaces the 1.25rem rhythm rather than adding to it: `space-y` margins
          inside a grid would push every cell after the first out of line. */}
      <CardContent className={cn(flush && 'p-0', contentClassName ?? (flush ? undefined : 'space-y-5'))}>{children}</CardContent>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t bg-muted/30 px-4 py-3">{footer}</div>
      )}
    </Card>
  );
}

/**
 * Settings sections side by side on a wide screen, one column below `xl`. Columns flow like a
 * masonry wall (CSS columns), so a short section never leaves a gap under a tall neighbour the way a
 * grid row does; no section is ever split across the two.
 */
export function SettingsColumns({ children, single, className }: { children: ReactNode; /** One column whatever the width — e.g. beside an open preview. */ single?: boolean; className?: string }) {
  if (single) return <div className={cn('space-y-4', className)}>{children}</div>;
  // `max-xl:space-y-4`, not `space-y-4 xl:space-y-0`: space-y's own selector outranks `[&>*]:mb-4`, so
  // the reset zeroed every section's bottom margin but the first and the columns lost their gaps.
  return <div className={cn('max-xl:space-y-4 xl:columns-2 xl:gap-4 [&>*]:break-inside-avoid xl:[&>*]:mb-4', className)}>{children}</div>;
}

/** An on/off setting with its label wired to the switch. */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  inherited,
  onReset,
  resetLabel = 'Use company default',
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** With `onReset`: the value is the default, so there is nothing to reset. */
  inherited?: boolean;
  onReset?: () => void;
  resetLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const descriptionId = useId();
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
        {onReset && !inherited && (
          <button type="button" onClick={onReset} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline">
            <RotateCcw className="h-3 w-3" aria-hidden="true" /> {resetLabel}
          </button>
        )}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-describedby={description ? descriptionId : undefined} disabled={disabled} />
    </div>
  );
}

const NOTICE_TONES = {
  info: { box: 'border-border bg-muted/40 text-foreground', icon: Info, mark: 'text-muted-foreground' },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-800', icon: AlertTriangle, mark: 'text-amber-600' },
  danger: { box: 'border-rose-200 bg-rose-50 text-rose-700', icon: XCircle, mark: 'text-rose-600' },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CheckCircle2, mark: 'text-emerald-600' },
} as const;

/** A short banner: what the person should know before using the page or section. */
export function SettingsNotice({
  tone = 'info',
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: keyof typeof NOTICE_TONES;
  title?: ReactNode;
  children?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  const palette = NOTICE_TONES[tone];
  const Icon = icon ?? palette.icon;
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm', palette.box, className)}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', palette.mark)} aria-hidden="true" />
      <div className="min-w-0 flex-1 break-words">
        {title && <p className="font-medium leading-snug">{title}</p>}
        {children && <div className={cn('text-xs leading-relaxed sm:text-[13px]', title ? 'mt-0.5 opacity-90' : null)}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** The page's header (with Back) over the standard "you may not open this" card. */
export function SettingsAccessDenied({ title, icon, message }: { title: string; icon?: LucideIcon; message?: string }) {
  const back = useBackNavigation('/settings');
  return (
    <SettingsPage>
      <PageHeader title={title} icon={icon} backHref={back.href} backLabel={back.label} onBackClick={back.onClick} />
      <PageAccessDenied message={message} />
    </SettingsPage>
  );
}

/**
 * The page's place while its data loads, shaped like what is coming: one card (`single`), figures
 * over a register (`register`), or two cards side by side (`split`).
 */
export function SettingsPageSkeleton({ layout = 'single' }: { layout?: 'single' | 'register' | 'split' }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="flex items-start gap-3" aria-hidden="true">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 w-48 max-w-full rounded-md" />
          <Skeleton className="h-4 w-80 max-w-full rounded-md" />
        </div>
      </div>
      {layout === 'register' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-[76px] rounded-xl" />
          ))}
        </div>
      )}
      {layout === 'split' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden="true">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : (
        <Skeleton className={cn('w-full rounded-xl', layout === 'register' ? 'h-96' : 'h-72')} aria-hidden="true" />
      )}
    </div>
  );
}
