'use client';

import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Info, Loader2, RotateCcw, Save, ShieldAlert, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import {
  dailyPageContainerClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';
import type { DRSectionMeta, DRSettingsIssue } from '@/lib/daily-requisition-settings';
import { cn } from '@/lib/utils';

/** Shared layout for the Field Control and Data Control pages. */
export const settingsPageClass = `${dailyPageContainerClass} mx-auto max-w-5xl pb-28`;

/** A card with a slim header: icon, title, one line of description, optional right-hand slot. */
export function SettingsSection({
  icon: Icon,
  title,
  description,
  aside,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(dailySurfaceCardClass, 'min-w-0', className)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200/70 px-4 py-2.5">
        <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description ? <p className="text-xs text-slate-500">{description}</p> : null}
        </div>
        {aside}
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** A labelled switch / control row inside a section. */
export function SettingRow({
  title,
  hint,
  control,
  htmlFor,
}: {
  title: string;
  hint?: ReactNode;
  control: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800">
          {title}
        </label>
        {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

const toDate = (value: unknown): Date | undefined => {
  const candidate = (value as { toDate?: () => Date } | null)?.toDate?.();
  if (candidate instanceof Date) return candidate;
  if (value instanceof Date) return value;
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
};

export function describeLastUpdate(meta: DRSectionMeta): string {
  const when = toDate(meta.updatedAt);
  if (!when && !meta.updatedByName) return 'Never saved — the shipped defaults are in use.';
  const who = meta.updatedByName || 'someone';
  return when ? `Last updated by ${who} on ${format(when, 'dd MMM yyyy, HH:mm')}` : `Last updated by ${who}`;
}

/** Errors and warnings from `validateDailyRequisitionSettings`, for the current section. */
export function IssueList({ issues }: { issues: readonly DRSettingsIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1.5">
      {issues.map((issue) => (
        <li
          key={`${issue.severity}:${issue.message}`}
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            issue.severity === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-amber-200 bg-amber-50 text-amber-900',
          )}
        >
          {issue.severity === 'error' ? (
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** The sticky footer: dirty state, who saved last, Reset to defaults, Discard and Save. */
export function SaveBar({
  dirty,
  saving,
  canEdit,
  blocked,
  lastUpdate,
  onSave,
  onDiscard,
  onResetDefaults,
}: {
  dirty: boolean;
  saving: boolean;
  canEdit: boolean;
  blocked: boolean;
  lastUpdate: string;
  onSave: () => void;
  onDiscard: () => void;
  onResetDefaults: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-3 mt-6 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur sm:-mx-4 sm:px-4 lg:mx-0 lg:rounded-xl lg:border lg:shadow-lg">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs">
          <p className={cn('font-medium', dirty ? 'text-amber-700' : 'text-slate-600')}>
            {!canEdit ? 'Read only — you can view these settings but not change them.' : dirty ? 'Unsaved changes' : 'All changes saved'}
          </p>
          <p className="truncate text-slate-500">{lastUpdate}</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onResetDefaults} disabled={saving}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset to defaults
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={onDiscard} disabled={!dirty || saving}>
              Discard
            </Button>
            <Button type="button" size="sm" className="h-9" onClick={onSave} disabled={!dirty || saving || blocked}>
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save changes
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className={settingsPageClass}>
      <Skeleton className="mb-6 h-10 w-full max-w-64" />
      <div className="space-y-4">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function SettingsAccessDenied({ title, description }: { title: string; description: string }) {
  return (
    <div className={settingsPageClass}>
      <PageHeader eyebrow="Daily Requisition" title={title} description={description} backHref="/daily-requisition/settings" />
      <Card className={dailySurfaceCardClass}>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to view this page.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center p-8">
          <ShieldAlert className="h-16 w-16 text-destructive" />
        </CardContent>
      </Card>
    </div>
  );
}

/** A quiet note inside a section. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-600">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
