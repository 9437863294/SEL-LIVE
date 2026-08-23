'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The header every screen in the module opens with.
 *
 * One component rather than a hand-rolled Card per page: eleven screens each inventing their own
 * title treatment is why a module stops feeling like one product. Title, one line of explanation,
 * optional back link, actions on the right — and nothing else competing for the top of the page.
 */
export function PageHeader({
  title,
  description,
  backHref,
  backLabel = 'Back',
  actions,
  meta,
  className,
}: {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  /** Short key/value pairs shown under the title — a reference number, a status, a date. */
  meta?: Array<{ label: string; value: ReactNode }>;
  className?: string;
}) {
  return (
    <header className={cn('border-b bg-background/60 px-1 pb-3', className)}>
      {backHref && (
        <Button asChild size="sm" variant="ghost" className="-ml-2 mb-0.5 h-7 gap-1 px-1.5 text-xs text-muted-foreground">
          <Link href={backHref}>
            <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
          </Link>
        </Button>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">{title}</h1>
          {description && <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground sm:text-sm">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {meta && meta.length > 0 && (
        <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          {meta.map((entry) => (
            <div key={entry.label} className="flex items-baseline gap-1.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {entry.label}
              </dt>
              <dd className="text-xs font-medium text-slate-800">{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

/**
 * A titled block inside a form or detail screen.
 *
 * Sections carry the hierarchy so the page reads as "these four things", not as four identical
 * cards of equal importance — which is what makes a long form feel like a wall.
 */
export function FormSection({
  title,
  description,
  children,
  aside,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border bg-background shadow-sm', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      <div className="px-3 py-3 sm:px-4">{children}</div>
    </section>
  );
}

/** A labelled form field with consistent label size, spacing and hint placement. */
export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-rose-600">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
