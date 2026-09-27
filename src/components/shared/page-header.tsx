'use client';

/**
 * The app's standard headers — one look for every module, on a phone and on a desktop.
 *
 * - `PageHeader`: the top of every page. Back, icon, title, a line of explanation, actions.
 * - `SectionHeader`: a titled block inside a page ("Line items", "Approval history").
 * - `ModuleMobileHeader`: the module's own card at the top of a phone screen, where the desktop
 *   has the sidebar's brand header.
 *
 * Module-specific header components (`ExpensesPageHeader`, `TravelPageHeader`, `PmTopbar`, …) are
 * thin wrappers over these, so a change here reaches every page. Colours are theme tokens and the
 * user's accent (`--sel-tab-gradient`), so light, dark and every Appearance choice come for free.
 *
 * Actions are rendered once: to the right of the title where there is room, wrapped onto their own
 * full-width row beneath it on a phone. Never twice — a dialog or menu inside an action must mount
 * exactly once.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface HeaderCrumb {
  label: string;
  href?: string;
}

export interface HeaderMeta {
  label: string;
  value: ReactNode;
}

function isMetaList(meta: PageHeaderProps['meta']): meta is HeaderMeta[] {
  return Array.isArray(meta) && meta.every((entry) => entry !== null && typeof entry === 'object' && 'label' in entry && 'value' in entry);
}

/** The app header's height, which a sticky page header sits beneath. */
const BELOW_APP_HEADER = 'top-[var(--app-header-offset,4rem)]';

function BackButton({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" size="icon" className="h-9 w-9 shrink-0 rounded-xl">
      <Link href={href} aria-label={label} title={label}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </Link>
    </Button>
  );
}

function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15 sm:h-10 sm:w-10',
        className,
      )}
      aria-hidden="true"
    >
      <Icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
    </span>
  );
}

function Crumbs({ items }: { items: HeaderCrumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {items.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
          {index > 0 && (
            <span aria-hidden="true" className="text-muted-foreground/50">
              /
            </span>
          )}
          {crumb.href ? (
            <Link href={crumb.href} className="truncate font-medium hover:text-foreground hover:underline">
              {crumb.label}
            </Link>
          ) : (
            <span className="truncate font-medium">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  /** One or two lines on what the page is for. Clamped to two lines on a phone. */
  description?: ReactNode;
  /** e.g. `hidden sm:block`, for a screen whose header competes with its own content on a phone. */
  descriptionClassName?: string;
  icon?: LucideIcon;
  /** A small line above the title: the module, or where the page sits. `breadcrumbs` wins. */
  eyebrow?: ReactNode;
  /** Ancestors, nearest last; a `href` makes one a link. Shown above the title from `sm` up. */
  breadcrumbs?: HeaderCrumb[];
  /** Adds a back button; leave it off a module's landing page. */
  backHref?: string;
  backLabel?: string;
  /** A status chip or count beside the title. */
  badge?: ReactNode;
  /** Short facts under the title — a reference number, a status, a date — or chips of your own. */
  meta?: HeaderMeta[] | ReactNode;
  actions?: ReactNode;
  /** Pinned under the app header on a bar of its own — for registers whose actions must stay in reach. */
  sticky?: boolean;
  className?: string;
}

/** The top of every page. See the file comment for the layout rules. */
export function PageHeader({
  title,
  description,
  descriptionClassName,
  icon,
  eyebrow,
  breadcrumbs,
  backHref,
  backLabel = 'Back',
  badge,
  meta,
  actions,
  sticky = false,
  className,
}: PageHeaderProps) {
  const lead = breadcrumbs?.length ? (
    <div className="hidden sm:block">
      <Crumbs items={breadcrumbs} />
    </div>
  ) : eyebrow ? (
    <p className="mb-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{eyebrow}</p>
  ) : null;

  return (
    <header
      className={cn(
        'page-header',
        sticky
          ? cn('sticky z-20 -mx-4 mb-4 border-b bg-background/90 px-4 py-2.5 backdrop-blur md:-mx-6 md:px-6', BELOW_APP_HEADER)
          : 'mb-4 sm:mb-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {/* `basis-[18rem]`: the title claims the first line, so on a phone the actions wrap beneath
            it instead of squeezing it to "Ind…". */}
        <div className="flex min-w-0 flex-1 basis-[18rem] items-start gap-3">
          {backHref && <BackButton href={backHref} label={backLabel} />}
          {icon && <IconTile icon={icon} />}
          <div className="min-w-0 flex-1">
            {lead}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1
                className={cn(
                  'min-w-0 break-words font-semibold leading-tight tracking-tight text-foreground',
                  sticky ? 'text-base sm:text-lg' : 'text-lg sm:text-xl',
                )}
              >
                {title}
              </h1>
              {badge}
            </div>
            {description && (
              <div
                className={cn(
                  'mt-1 line-clamp-2 max-w-3xl text-xs leading-relaxed text-muted-foreground sm:line-clamp-none sm:text-sm',
                  descriptionClassName,
                )}
              >
                {description}
              </div>
            )}
            {/* Facts belong to the title, so they sit under it — above the actions on a phone. */}
            {isMetaList(meta) ? (
              meta.length > 0 && (
                <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
                  {meta.map((entry) => (
                    <div key={entry.label} className="flex min-w-0 items-baseline gap-1.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{entry.label}</dt>
                      <dd className="truncate text-xs font-medium text-foreground">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              )
            ) : meta ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>
            ) : null}
          </div>
        </div>
        {/* How the children size is `.page-header-actions` in globals.css: on a phone labelled
            buttons share the row while square icon buttons keep their size; from `sm` they keep
            their width but may shrink, so one wrapping toolbar passed as a child wraps in place. */}
        {actions && (
          <div className="page-header-actions flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:max-w-full sm:justify-end">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** A count or status beside the title. */
  badge?: ReactNode;
  actions?: ReactNode;
  /** The heading level — `h2` for a section of the page, `h3` for one inside a section. */
  as?: 'h2' | 'h3';
  className?: string;
}

/** A titled block inside a page. Same type scale in every module. */
export function SectionHeader({ title, description, icon: Icon, badge, actions, as: Heading = 'h2', className }: SectionHeaderProps) {
  return (
    <div className={cn('section-header mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2', className)}>
      <div className="flex min-w-0 flex-1 basis-[14rem] items-start gap-2.5">
        {Icon && (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Heading className="min-w-0 break-words text-[15px] font-semibold leading-snug tracking-tight text-foreground sm:text-base">
              {title}
            </Heading>
            {badge}
          </div>
          {description && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-[13px]">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface ModuleMobileHeaderProps {
  icon: LucideIcon;
  /** The module's name. */
  title: ReactNode;
  /** Usually the current page, or the module's one-line purpose. */
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** The breakpoint where the module's desktop sidebar takes over and this card hides. */
  hideFrom?: 'md' | 'lg';
  className?: string;
}

/**
 * The module's card at the top of a phone screen: the module's icon in the user's accent, its
 * name, where you are in it, and at most a couple of compact actions. Navigation itself is the
 * bottom bar's job, so there is no menu button here.
 */
export function ModuleMobileHeader({ icon: Icon, title, subtitle, actions, hideFrom = 'lg', className }: ModuleMobileHeaderProps) {
  return (
    <div className={cn('module-mobile-header mb-3', hideFrom === 'md' ? 'md:hidden' : 'lg:hidden', className)}>
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/90 px-3 py-2.5 shadow-sm backdrop-blur">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[image:var(--sel-tab-gradient)] text-[color:var(--sel-tab-on)] shadow-sm"
          aria-hidden="true"
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-foreground">{title}</p>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}
