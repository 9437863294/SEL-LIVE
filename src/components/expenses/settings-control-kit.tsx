'use client';

/**
 * What the Expenses control pages (Field Control, Data Control) share: who may see and change
 * them, a draft that follows the live settings document until it is edited, a save that writes
 * only the page's own part of that document, and the slim cards and sticky save bar they are
 * laid out with.
 *
 * Both pages write the same document (`expensesSettings/module-config`). Each save is a
 * transaction that reads the document as it stands and merges in just its own part plus the
 * stamps, so saving Field Control never resets a data rule someone else changed a minute ago —
 * and the before/after written to the activity log is measured against what was really there,
 * not against what this browser happened to load.
 */

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { AlertTriangle, Info, Loader2, RotateCcw, Save, ShieldAlert, type LucideIcon } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useExpensesSettings } from '@/components/expenses/use-expenses-settings';
import {
  EXPENSES_SETTINGS_PATH,
  resolveExpensesSettings,
  type ExpenseSettingsIssue,
  type ExpenseSettingsPart,
  type ExpensesModuleSettings,
} from '@/lib/expenses-settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** A block label, the same one the New Request form uses. */
export const CONTROL_LABEL = 'block text-xs font-medium leading-4 text-slate-600';

/* ── access ──────────────────────────────────────────────────────────────── */

/**
 * View with View (or Edit) on the section, or View on Expenses › Settings. Edit with Edit on the
 * section — or, until roles are updated, with the rights that administered the combined page
 * these two replace (Manage Accounts / Edit Serial Nos on Settings). The sections are new, so no
 * existing role grants them; without the fallback both pages would ship read-only for everyone.
 */
export function useExpensesControlAccess(section: 'Field Control' | 'Data Control') {
  const { can, isLoading } = useAuthorization();
  const resource = `Expenses.${section}`;
  const canEdit =
    can('Edit', resource) || can('Manage Accounts', 'Expenses.Settings') || can('Edit Serial Nos', 'Expenses.Settings');
  const canView = canEdit || can('View', resource) || can('View', 'Expenses.Settings');
  return { canView, canEdit, isLoading };
}

/* ── draft ───────────────────────────────────────────────────────────────── */

/**
 * The page's part of the live settings, as an editable draft.
 *
 * Until the user changes something the draft *is* the live value, so another administrator's
 * save shows up here straight away. Once edited it is held until saved or discarded. After a
 * save the draft is kept on screen until the live document catches up with it, so the page
 * never flickers back to the old values while the write travels.
 */
export function useSettingsPartDraft<T>(pick: (settings: ExpensesModuleSettings) => T) {
  const { settings, isLoading } = useExpensesSettings();
  // `pick` is a module-level function in both pages, so keying on `settings` alone is right.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const remote = useMemo(() => pick(settings), [settings]);
  const remoteKey = useMemo(() => JSON.stringify(remote), [remote]);

  const [draft, setDraft] = useState<T | null>(null);
  /** The live value as it stood when a save finished; set only while waiting for the write to arrive. */
  const [awaitingFrom, setAwaitingFrom] = useState<string | null>(null);
  const awaitingSync = awaitingFrom !== null;

  const draftKey = draft === null ? remoteKey : JSON.stringify(draft);
  // Hand back to the live value once it matches the save — or once any newer snapshot arrives,
  // so a normalisation difference can never pin a stale draft on screen.
  if (awaitingSync && (draftKey === remoteKey || remoteKey !== awaitingFrom)) {
    // Render-phase adjustment (React's documented pattern for state derived from props).
    setAwaitingFrom(null);
    setDraft(null);
  }

  const value = draft ?? remote;
  const isDirty = !awaitingSync && draftKey !== remoteKey;

  return {
    settings,
    isLoading,
    value,
    isDirty,
    update: (change: (current: T) => T) => setDraft(current => change(current ?? remote)),
    replace: (next: T) => setDraft(next),
    discard: () => {
      setAwaitingFrom(null);
      setDraft(null);
    },
    /** Pass the saved value as the live document will resolve it. */
    markSaved: (saved: T) => {
      setDraft(saved);
      setAwaitingFrom(remoteKey);
    },
  };
}

/* ── save ────────────────────────────────────────────────────────────────── */

/**
 * Writes one part of the settings document and stamps it, returning the settings as they stood
 * just before the write (for the activity log's before/after).
 */
export async function saveExpensesSettingsPart(
  part: ExpenseSettingsPart,
  payload: Record<string, unknown>,
  user: { id: string; name?: string | null; email?: string | null },
): Promise<ExpensesModuleSettings> {
  const ref = doc(db, EXPENSES_SETTINGS_PATH.collection, EXPENSES_SETTINGS_PATH.doc);
  const updatedByName = user.name || user.email || user.id;
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const before = resolveExpensesSettings(snapshot.exists() ? snapshot.data() : undefined);
    transaction.set(
      ref,
      {
        ...payload,
        updatedAt: serverTimestamp(),
        updatedBy: user.id,
        updatedByName,
        stamps: { [part]: { updatedAt: serverTimestamp(), updatedBy: user.id, updatedByName } },
      },
      { merge: true },
    );
    return before;
  });
}

/* ── layout ──────────────────────────────────────────────────────────────── */

/** A card with the slim header the New Request page uses. */
export function ControlCard({
  icon: Icon,
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn('overflow-hidden border-slate-200/80 bg-white shadow-sm', className)}>
      <div className="flex flex-col gap-2 border-b bg-slate-50/70 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <CardContent className={cn('p-4', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** A labelled on/off rule: title and hint on the left, the switch on the right. */
export function RuleRow({ title, hint, control }: { title: string; hint: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{title}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function IssueList({ issues }: { issues: readonly ExpenseSettingsIssue[] }) {
  if (!issues.length) return null;
  const blocked = issues.some(issue => issue.severity === 'error');
  return (
    <div
      className={cn(
        'space-y-1 rounded-xl border p-3 text-xs',
        blocked
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
      )}
    >
      {issues.map((issue, index) => (
        <p key={index} className={cn('flex items-start gap-2', issue.severity === 'warning' && blocked && 'text-amber-700')}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {issue.message}
        </p>
      ))}
    </div>
  );
}

export function ReadOnlyNotice({ section }: { section: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      You can see this configuration but not change it. Edit on Expenses › {section} carries that right.
    </div>
  );
}

export function ControlAccessDenied() {
  return (
    <Card className="border-destructive/30">
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="h-7 w-7 text-destructive" />
        </div>
        <p className="font-semibold text-slate-800">Access Denied</p>
        <p className="text-sm text-muted-foreground">You do not have permission to view these settings.</p>
      </CardContent>
    </Card>
  );
}

/** "Last updated by X on date", or a fallback when the part has never been saved. */
export function stampLine(stamp: { at?: string; by?: string }, fallback: string): string {
  if (!stamp.at) return fallback;
  const when = new Date(stamp.at);
  if (Number.isNaN(when.getTime())) return fallback;
  const date = when.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = when.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return `Last updated by ${stamp.by || 'someone'} on ${date}, ${time}`;
}

/** Sticky footer with the dirty state, reset, discard and save. */
export function ControlSaveBar({
  isDirty,
  blocked,
  isSaving,
  canEdit,
  onSave,
  onDiscard,
  onReset,
}: {
  isDirty: boolean;
  blocked: boolean;
  isSaving: boolean;
  canEdit: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onReset: () => void;
}) {
  if (!canEdit) return null;
  return (
    <div className="sticky bottom-0 z-10 rounded-t-xl border border-b-0 bg-background/95 px-4 py-3 shadow-[0_-8px_24px_-20px_rgba(15,23,42,0.5)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn('h-2 w-2 shrink-0 rounded-full', isDirty ? (blocked ? 'bg-destructive' : 'bg-amber-500') : 'bg-emerald-500')}
          />
          {isDirty ? (blocked ? 'Fix the errors above before saving.' : 'Unsaved changes.') : 'All changes saved.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={isSaving} onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </Button>
          {isDirty ? (
            <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={onDiscard}>
              Discard
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href="/expenses/settings">Back to settings</Link>
            </Button>
          )}
          <Button type="button" size="sm" className="min-w-[110px] gap-2" disabled={!isDirty || blocked || isSaving} onClick={onSave}>
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
