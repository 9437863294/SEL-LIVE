'use client';

import { useCallback, useId, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { AlertTriangle, Check, CheckCircle2, Eye, EyeOff, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { markReplaceOnPlainClick } from '@/hooks/use-back-navigation';
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
    <div className="space-y-2">
      <div className="min-w-0">
        {/* The company-default state sits beside the setting's name, not at the far edge of the card
            — on a wide screen that was a long way from the thing it describes. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p id={labelId} className="text-sm font-semibold">
            {label}
          </p>
          {companyDefault !== undefined && onReset && (
            inherited ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Company default</span>
            ) : (
              <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px] text-primary hover:text-primary" onClick={onReset} disabled={disabled}>
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Use company default
              </Button>
            )
          )}
        </div>
        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <RadioGroupPrimitive.Root
        value={value}
        onValueChange={(next) => onChange(next as T)}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        // Cards keep a natural width: as many columns of at least this size as fit, and spare room
        // left empty rather than spread across. Fixed column counts stretched three cards over a
        // whole wide screen, with each radio circle a long way from its label. `columns` is the
        // density of the option: 2 for wordy ones, 4 for short ones.
        className={cn(
          'grid gap-2',
          columns === 2 && 'grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))]',
          // Two across on a phone (10rem), so a short three-way choice is not three full-width rows.
          columns === 3 && 'grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] sm:grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))]',
          columns === 4 && 'grid-cols-[repeat(auto-fill,minmax(min(100%,9.5rem),1fr))]',
        )}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <RadioGroupPrimitive.Item
              key={option.value}
              value={option.value}
              // A 1px border, with a ring on the selected card rather than a thicker border, so
              // selecting never shifts the layout; tighter padding than the old 0.75rem + 2px border.
              className={cn(
                'relative flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
                selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/40 hover:bg-muted/40',
              )}
            >
              {option.preview && <span className="block" aria-hidden="true">{option.preview}</span>}
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">
                    {option.label}
                    {companyDefault === option.value && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(default)</span>}
                  </span>
                  {option.description && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{option.description}</span>}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                  )}
                >
                  {selected && <Check className="h-2.5 w-2.5" />}
                </span>
              </span>
            </RadioGroupPrimitive.Item>
          );
        })}
      </RadioGroupPrimitive.Root>
    </div>
  );
}

// The section card, columns and switch row are every Settings page's, not only Appearance's.
export { SettingsColumns, SettingsSection, SwitchRow } from '@/components/settings/settings-ui';

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
  /** Links are shown in groups (e.g. "Company"); a new group starts with a divider and its name. */
  group?: string;
}

/**
 * The Appearance sections, as links (each section is its own page).
 *
 * Switching sections replaces the page rather than adding one, like a tab strip: the header's back
 * arrow — and the browser's Back — then leave Appearance for wherever it was opened from, instead of
 * stepping back through every section visited on the way.
 */
export function AppearanceSectionNav({ links }: { links: SectionLink[] }) {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="Appearance sections" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex min-w-max items-center gap-1 rounded-xl bg-muted p-1">
        {links.map(({ href, label, icon: Icon, group }, index) => {
          const active = href === '/settings/appearance' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          const startsGroup = index > 0 && group !== links[index - 1].group && Boolean(group);
          return (
            <li key={href} className="flex items-center gap-1">
              {startsGroup && (
                <span className="flex items-center gap-1.5 pl-1 pr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span className="h-5 w-px bg-border" aria-hidden="true" />
                  {group}
                </span>
              )}
              <Link
                href={href}
                replace
                onClick={markReplaceOnPlainClick}
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

// ── Optional previews ────────────────────────────────────────────────────────────────────────────

const PREVIEW_EVENT = 'appearance-preview-change';
/** Used when storage is blocked, so the toggle still works for the visit. */
const previewMemory = new Map<string, boolean>();

function readPreview(key: string): boolean {
  if (previewMemory.has(key)) return previewMemory.get(key) === true;
  try {
    return window.localStorage.getItem(`appearance-preview:${key}`) === '1';
  } catch {
    return false;
  }
}

function subscribePreview(onChange: () => void) {
  window.addEventListener(PREVIEW_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(PREVIEW_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Whether a screen's large preview is showing. Previews are optional and start hidden — they take a
 * column of their own, and most visits are to change one setting, not to look. The choice is
 * remembered per screen on this device (a convenience only; it never reaches the server).
 */
export function usePreviewVisible(key: string): [boolean, (visible: boolean) => void] {
  const visible = useSyncExternalStore(subscribePreview, () => readPreview(key), () => false);
  const setVisible = useCallback(
    (next: boolean) => {
      previewMemory.set(key, next);
      try {
        window.localStorage.setItem(`appearance-preview:${key}`, next ? '1' : '0');
      } catch {
        // Remembered for this visit only.
      }
      window.dispatchEvent(new Event(PREVIEW_EVENT));
    },
    [key],
  );
  return [visible, setVisible];
}

export function PreviewToggle({ visible, onToggle, className }: { visible: boolean; onToggle: (visible: boolean) => void; className?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" className={cn('h-8 gap-1.5', className)} aria-pressed={visible} onClick={() => onToggle(!visible)}>
      {visible ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
      {visible ? 'Hide preview' : 'Show preview'}
    </Button>
  );
}

/** What stands in for a hidden preview: one slim line with the button to bring it back. */
export function PreviewCollapsed({ title = 'Preview', note, onShow }: { title?: string; note?: string; onShow: () => void }) {
  return (
    // On a phone the note drops to its own line under the title and button, instead of being squeezed
    // into a sliver between them.
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-dashed px-3 py-2 text-sm">
      <Eye className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium">{title}</span>
      {note ? (
        <span className="order-last w-full text-xs text-muted-foreground sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">{note}</span>
      ) : (
        <span className="flex-1" />
      )}
      <PreviewToggle visible={false} onToggle={onShow} className="ml-auto" />
    </div>
  );
}
