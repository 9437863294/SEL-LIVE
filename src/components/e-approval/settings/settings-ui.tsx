'use client';

import { useState, type ReactNode } from 'react';
import { Loader2, Plus, Save, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Shared furniture for the settings sub-pages.
 *
 * These five pages previously invented their own layout each, and all five put the create/edit form
 * *inline at the top of the list*. That pattern is the thing this file exists to remove: clicking
 * "New" pushed the list you were reading off the screen, editing row nine scrolled you to row one,
 * and on a phone the form filled the viewport with no indication the list was still there.
 *
 * The replacement is the shape the rest of the app already uses — a clean list, and a dialog for the
 * form (a full-screen sheet on mobile, via the `hr-mobile-dialog` rules in `globals.css`). Each page
 * then reads as: what exists → what you can change → nothing else.
 */

/** Turns a ShadCN dialog into a full-screen sheet on a phone. Behaviour lives in `globals.css`. */
export const settingsDialogClass = {
  content: 'hr-mobile-dialog sm:max-w-lg',
  contentWide: 'hr-mobile-dialog sm:max-w-3xl',
  header: 'hr-dialog-header',
  body: 'hr-dialog-body space-y-3',
  footer: 'hr-dialog-footer',
} as const;

/**
 * The row above every settings list: what is in it, a search, and the one primary action.
 *
 * Search is offered from three rows up, not thirty: a department list is short until an organisation
 * has forty departments, and by then the person looking for one is scrolling.
 */
export function SettingsToolbar({
  count,
  noun,
  search,
  onSearch,
  action,
  children,
}: {
  count: number;
  /** Singular noun — "approval type", pluralised automatically. */
  noun: string;
  search?: string;
  onSearch?: (next: string) => void;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
        {count} {noun}
        {count === 1 ? '' : 's'}
      </Badge>

      {onSearch && count > 2 && (
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search ?? ''}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={`Search ${noun}s…`}
            className="h-8 pl-7 pr-7 text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {children}
      {action && <span className="ml-auto shrink-0">{action}</span>}
    </div>
  );
}

/**
 * One row of a settings list.
 *
 * A fixed shape — leading marker, title line, one subtitle line, badges, trailing actions — so five
 * pages cannot drift into five different row heights and five different places to look for the Edit
 * button. Actions sit at a 32px target rather than the 24px the old inline rows used.
 */
export function SettingsRow({
  marker,
  title,
  subtitle,
  badges,
  detail,
  actions,
  muted,
  className,
}: {
  marker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  /** An extra block below the subtitle — a chain preview, a member list. */
  detail?: ReactNode;
  actions?: ReactNode;
  /** Renders the row dimmed, for an inactive record. */
  muted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5 transition-colors hover:bg-muted/30 sm:flex-nowrap',
        muted && 'opacity-60',
        className,
      )}
    >
      {marker && <div className="mt-0.5 shrink-0">{marker}</div>}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-slate-900">{title}</span>
          {badges}
        </div>
        {subtitle && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{subtitle}</p>}
        {detail && <div className="mt-1.5">{detail}</div>}
      </div>

      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

/** A bordered, divided list — the container every settings row sits in. */
export function SettingsList({
  isLoading,
  isEmpty,
  empty,
  children,
}: {
  isLoading?: boolean;
  isEmpty?: boolean;
  empty?: ReactNode;
  children?: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (isEmpty) return <>{empty}</>;
  return <div className="divide-y overflow-hidden rounded-lg border bg-background">{children}</div>;
}

/** The consistent empty state: what would be here, and the one thing to do about it. */
export function SettingsEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
      {Icon && <Icon className="h-9 w-9 text-muted-foreground/35" />}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/**
 * The create/edit dialog every settings page uses.
 *
 * Save lives here, next to the fields it commits, rather than at the bottom of the page — so it is
 * never ambiguous *what* is being saved, which it was when an inline form and a list shared one
 * screen and one button.
 */
export function SettingsFormDialog({
  open,
  onOpenChange,
  title,
  description,
  wide,
  busy,
  canSave = true,
  saveLabel = 'Save',
  onSave,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  wide?: boolean;
  busy?: boolean;
  canSave?: boolean;
  saveLabel?: string;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className={wide ? settingsDialogClass.contentWide : settingsDialogClass.content}>
        <DialogHeader className={settingsDialogClass.header}>
          <DialogTitle className="text-base">{title}</DialogTitle>
          {description && <DialogDescription className="text-xs">{description}</DialogDescription>}
        </DialogHeader>

        <div className={settingsDialogClass.body}>{children}</div>

        <DialogFooter className={settingsDialogClass.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={busy || !canSave} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The standard "add one" button, so the primary action reads the same on all five pages. */
export function SettingsAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" className="h-8 gap-1.5" onClick={onClick}>
      <Plus className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}

/** Filters a list by a search term over the given fields. */
export function matchesSearch(term: string, ...fields: Array<string | undefined | null>): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return fields.filter(Boolean).join(' ').toLowerCase().includes(needle);
}

/** Small hook for the dialog-plus-draft pattern all four CRUD pages share. */
export function useSettingsDraft<T>() {
  const [draft, setDraft] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    draft,
    setDraft,
    busy,
    setBusy,
    open: draft !== null,
    close: () => setDraft(null),
    patch: (changes: Partial<T>) => setDraft((current) => (current ? { ...current, ...changes } : current)),
  };
}
