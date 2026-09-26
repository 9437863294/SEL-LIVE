'use client';

import { useId, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { AlertTriangle, Check, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { cn } from '@/lib/utils';

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
  /** A small visual sample drawn above the label. */
  preview?: ReactNode;
}

/**
 * One setting as a group of selectable cards — a real radio group, so arrow keys move between
 * options and screen readers announce "2 of 3, selected". The option the company uses by default
 * is labelled as such in text, and a user who has chosen differently sees that and can go back.
 */
export function ChoiceGroup<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  companyDefault,
  inherited,
  onReset,
  columns = 3,
  disabled,
}: {
  label: string;
  description?: string;
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
  companyDefault?: T;
  /** True while the user has not chosen and the company default applies. */
  inherited?: boolean;
  onReset?: () => void;
  columns?: 2 | 3 | 4;
  disabled?: boolean;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-semibold">
            {label}
          </p>
          {description && (
            <p id={descriptionId} className="text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {companyDefault !== undefined && onReset && (
          inherited ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Company default</span>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onReset} disabled={disabled}>
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Use company default
            </Button>
          )
        )}
      </div>
      <RadioGroupPrimitive.Root
        value={value}
        onValueChange={(next) => onChange(next as T)}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        className={cn(
          'grid gap-2.5',
          columns === 2 && 'grid-cols-1 sm:grid-cols-2',
          columns === 3 && 'grid-cols-1 sm:grid-cols-3',
          columns === 4 && 'grid-cols-2 lg:grid-cols-4',
        )}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <RadioGroupPrimitive.Item
              key={option.value}
              value={option.value}
              className={cn(
                'relative flex min-h-[3.25rem] flex-col gap-2 rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
                selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/40',
              )}
            >
              {option.preview && <span className="block" aria-hidden="true">{option.preview}</span>}
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">
                    {option.label}
                    {companyDefault === option.value && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(default)</span>}
                  </span>
                  {option.description && <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                  )}
                >
                  {selected && <Check className="h-3 w-3" />}
                </span>
              </span>
            </RadioGroupPrimitive.Item>
          );
        })}
      </RadioGroupPrimitive.Root>
    </div>
  );
}

/** An on/off setting with its label wired to the switch. */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  inherited,
  onReset,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  inherited?: boolean;
  onReset?: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  const descriptionId = useId();
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
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
            <RotateCcw className="h-3 w-3" aria-hidden="true" /> Use company default
          </button>
        )}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-describedby={description ? descriptionId : undefined} disabled={disabled} />
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
              <CardTitle className="text-base">{title}</CardTitle>
            </div>
            {description && <CardDescription className="mt-1">{description}</CardDescription>}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

/**
 * Where the last change stands: saving, saved, or not saved — in words and an icon, announced to
 * screen readers, with Retry when it failed. A failed change stays applied and stored on this
 * device, and is sent again on the next visit, so the message says exactly that.
 */
export function SaveStatus({ className }: { className?: string }) {
  const { saveStatus, saveError, retrySave, signedIn } = useAppearance();
  if (!signedIn) return null;
  return (
    <div role="status" aria-live="polite" className={cn('flex min-h-8 items-center gap-2 text-xs', className)}>
      {saveStatus === 'saving' && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Saving…
        </span>
      )}
      {saveStatus === 'saved' && (
        <span className="inline-flex items-center gap-1.5 font-medium text-success">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Saved to your profile
        </span>
      )}
      {saveStatus === 'error' && (
        <span className="inline-flex flex-wrap items-center gap-1.5 font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          Not saved yet — kept on this device.
          <span className="sr-only">{saveError}</span>
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={retrySave}>
            Retry
          </Button>
        </span>
      )}
    </div>
  );
}

export interface SectionLink {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** The Appearance sections, as links (each section is its own page). */
export function AppearanceSectionNav({ links }: { links: SectionLink[] }) {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="Appearance sections" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex min-w-max gap-1 rounded-xl bg-muted p-1">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === '/settings/appearance' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'bg-[image:var(--sel-tab-gradient)] text-[color:var(--sel-tab-on)] shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
