'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/*
 * The building blocks of the Policies page.
 *
 * One idea, applied everywhere: **what the setting is on the left, its control on the right.** The
 * page used to be a grid of checkboxes each trailing two or three lines of grey prose at the same
 * weight, so nothing scanned and the current state of a setting was a 14px tick among a dozen
 * others. A row with a bold label, one sentence of explanation and a switch in a fixed right-hand
 * column reads in a glance, and the column of switches *is* the summary of what is on.
 */

/** One card on the page, with its icon, a plain-English title and one sentence of purpose. */
export function PolicySection({
  id,
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  /** Buttons that act on the whole section — "Run now", "Reset to recommended". */
  actions?: ReactNode;
  children: ReactNode;
}) {
  // Prefixed, so the element id can never equal the tab's `#hash`. If it did, a refresh on
  // `…/policies#reminders` would let the browser scroll straight to this card — past the tab strip,
  // which is the one thing that has to be on screen when the page opens.
  const domId = `policy-section-${id}`;
  return (
    <section id={domId} aria-labelledby={`${domId}-title`} className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3 sm:px-5">
        {/* `flex-1 basis-64`: the title block takes the row and leaves the actions on the right, but
            wraps them underneath once it would be narrower than 16rem — on a phone, two buttons
            beside the description would squeeze it to a word per line. */}
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={`${domId}-title`} className="text-sm font-semibold leading-tight">
              {title}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-1.5">{actions}</div>}
      </header>
      <div className="divide-y">{children}</div>
    </section>
  );
}

/**
 * A single setting.
 *
 * `inline` keeps the control beside the label even on a phone — right for a switch, which is small
 * and whose meaning depends on sitting next to its label. Fields stack under the label below `sm`
 * instead, because an input squeezed beside a two-line label on a 360px screen is too narrow to type
 * into.
 */
export function PolicyRow({
  label,
  description,
  control,
  htmlFor,
  inline = false,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  /** The control's id, so clicking the label operates it. */
  htmlFor?: string;
  inline?: boolean;
  /** Settings that only mean something when this one is on — drawn indented beneath it. */
  children?: ReactNode;
}) {
  return (
    <div className="px-4 py-3.5 sm:px-5">
      <div
        className={cn(
          'flex gap-x-6 gap-y-2',
          inline ? 'items-start justify-between' : 'flex-col sm:flex-row sm:items-start sm:justify-between',
        )}
      >
        <div className="min-w-0 flex-1">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="cursor-pointer text-sm font-medium leading-snug">
              {label}
            </label>
          ) : (
            <div className="text-sm font-medium leading-snug">{label}</div>
          )}
          {description && <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children}
    </div>
  );
}

/** An on/off setting, with whatever depends on it nested underneath and dimmed while it is off. */
export function PolicySwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <PolicyRow
      inline
      htmlFor={id}
      label={label}
      description={description}
      control={<Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />}
    >
      {children && (
        <div
          className={cn(
            'mt-3 rounded-lg border bg-muted/30 px-3 py-2.5 transition-opacity',
            // Dimmed rather than hidden: an admin deciding whether to switch recall on wants to see
            // the window it would get, and a control that appears and disappears moves the page.
            !checked && 'opacity-50',
          )}
        >
          {children}
        </div>
      )}
    </PolicyRow>
  );
}

/** A number with its unit beside it, so "24" is never left to mean minutes or hours by guesswork. */
export function PolicyNumberInput({
  id,
  value,
  onChange,
  unit,
  min,
  max,
  step,
  disabled,
  className,
}: {
  id?: string;
  value: number;
  onChange: (value: string) => void;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-9 w-24 text-sm tabular-nums"
      />
      <span className="text-xs text-muted-foreground">{unit}</span>
    </div>
  );
}

/** A short note inside a section — an explanation, or a warning about a risky choice. */
export function PolicyNote({
  tone = 'info',
  icon: Icon,
  children,
  className,
}: {
  tone?: 'info' | 'warning';
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    // A `div`, not a flex `<p>`: the old note was a flex paragraph, so its inline `<code>` became a
    // separate flex item and rendered as a narrow third column beside the sentence it belonged to.
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed',
        tone === 'warning'
          ? 'border-amber-300 bg-amber-50 text-amber-900'
          : 'border-border bg-muted/40 text-muted-foreground',
        className,
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
