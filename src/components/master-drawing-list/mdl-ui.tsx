'use client';

/**
 * Small parts the Master Drawing List screens share: status badges in Project Management's tones,
 * the stat card, the project picker and the loading / error / empty states.
 */

import Link from 'next/link';
import { AlertTriangle, FilePlus2, FileStack, FileUp, Inbox, Loader2, type LucideIcon } from 'lucide-react';

import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { useMdl, type MdlProjectView } from './mdl-client';

/**
 * The status words that mean more (or otherwise) than the app-wide vocabulary reads them as — the
 * same choices Project Management makes for its register. Everything else takes its tone from the
 * word itself.
 */
const TONE: Readonly<Record<string, StatusTone>> = {
  'With Client': 'info',
  'Approved with Comments': 'warning',
  'Resubmission Required': 'warning',
};

export function MdlStatus({ status, children, className, title }: { status?: string | null; children?: React.ReactNode; className?: string; title?: string }) {
  return (
    <StatusBadge status={status ?? undefined} tone={status ? TONE[status] : 'neutral'} className={className} title={title}>
      {children}
    </StatusBadge>
  );
}

/** A figure with its icon chip, two to a row on a phone (Project Management's stat card). */
export function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: LucideIcon; tone: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10', tone)}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0">
          <p className="break-words text-lg font-bold leading-tight sm:text-2xl">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProjectSelect({
  projects,
  value,
  onChange,
  className,
  id,
}: {
  projects: MdlProjectView[];
  value: string | null;
  onChange: (code: string) => void;
  className?: string;
  id?: string;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className={cn('min-w-0 text-left', className)} aria-label="Drawing list">
        <SelectValue placeholder="Choose a drawing list" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {projects.map((project) => (
          <SelectItem key={project.code} value={project.code}>
            <span className="truncate">{project.short}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ── states ──────────────────────────────────────────────────────────────── */

export function MdlLoading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground', className)} role="status">
      <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
      {label}
    </div>
  );
}

export function MdlError({ message, onRetry }: { message: string | null | undefined; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function MdlEmpty({ title, description, icon: Icon = Inbox, action }: { title: string; description?: string; icon?: React.ElementType; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <Icon className="h-9 w-9 text-muted-foreground/60" aria-hidden="true" />
      <p className="font-medium text-slate-700">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * No drawing list yet: the two ways to start one, offered to whoever may use them — import the
 * consolidated workbook, or create a list for an ERP project in Settings and add items by hand.
 */
export function NoDrawingList() {
  const { can } = useMdl();
  const canImport = can('Import', 'View');
  const canCreate = can('Settings', 'Manage');
  return (
    <MdlEmpty
      icon={FileStack}
      title="No drawing list is open to you yet"
      description={
        canImport || canCreate
          ? 'Import the consolidated workbook, or create a drawing list for an ERP project in Settings and add its items one by one.'
          : 'A drawing list appears here once it is imported or created and its ERP project is granted to you (or you hold All Projects). Ask your administrator.'
      }
      action={
        canImport || canCreate ? (
          <div className="flex flex-wrap justify-center gap-2">
            {canImport && (
              <Button asChild>
                <Link href="/master-drawing-list/import">
                  <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />
                  Import workbook
                </Link>
              </Button>
            )}
            {canCreate && (
              <Button asChild variant="outline">
                <Link href="/master-drawing-list/settings">
                  <FilePlus2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  New drawing list
                </Link>
              </Button>
            )}
          </div>
        ) : undefined
      }
    />
  );
}
