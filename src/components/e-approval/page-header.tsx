'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The header every screen in the module opens with — the app's standard one (`shared/page-header`):
 * title, one line of explanation, optional back link and key facts, actions on the right.
 */
export { PageHeader } from '@/components/shared/page-header';

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
          <h2 className="text-[15px] font-semibold leading-snug tracking-tight text-foreground sm:text-base">{title}</h2>
          {description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:text-[13px]">{description}</p>}
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
