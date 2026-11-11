'use client';

/**
 * Small parts the Master Drawing List screens share: the status badge, dates, the "Days" figure,
 * the revision track, the project picker and the loading / error / empty states. Colours come from
 * the app's status tones (`StatusBadge`), so a status reads the same here as in every module.
 */

import Link from 'next/link';
import { AlertTriangle, Check, FilePlus2, FileStack, FileUp, Inbox, Loader2, MessageSquare } from 'lucide-react';

import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/master-drawing-list/derive';
import { DAYS_HINT, daysFor } from '@/lib/master-drawing-list/register';
import { STATUS_LABEL, type MdlItem, type MdlStatus } from '@/lib/master-drawing-list/types';
import { cn } from '@/lib/utils';

import { useMdl, type MdlProjectView } from './mdl-client';

/** The order statuses are listed in: done, with the client, with SEL, not started, parked. */
export const STATUS_ORDER: MdlStatus[] = ['approved', 'under_review', 'comments_received', 'not_submitted', 'vendor_not_finalised', 'on_hold'];

export const STATUS_TONE: Record<MdlStatus, StatusTone> = {
  approved: 'success',
  under_review: 'info',
  comments_received: 'warning',
  not_submitted: 'neutral',
  vendor_not_finalised: 'danger',
  on_hold: 'neutral',
};

/** Who acts next, in words, for a status. */
export const STATUS_ACTION: Record<MdlStatus, string> = {
  approved: 'Closed',
  under_review: 'With client',
  comments_received: 'With SEL',
  not_submitted: 'With SEL',
  vendor_not_finalised: 'With procurement',
  on_hold: 'Parked',
};

export function MdlStatusBadge({ status, className }: { status: MdlStatus; className?: string }) {
  return (
    <StatusBadge tone={STATUS_TONE[status]} dot className={className}>
      {STATUS_LABEL[status]}
    </StatusBadge>
  );
}

/** DD.MM.YYYY, or a dash. */
export function DateText({ value, className }: { value: string | null | undefined; className?: string }) {
  return <span className={cn('tabular-nums', !value && 'text-muted-foreground', className)}>{value ? formatDate(value) : '—'}</span>;
}

/** The register's "Days": waiting with the client or SEL for an open item, to approval for an approved one. */
export function DaysText({ item, today, className }: { item: MdlItem; today: string; className?: string }) {
  const figure = daysFor(item, today);
  if (!figure) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span className={cn('inline-flex flex-col items-end leading-tight', className)} title={`Counted from ${formatDate(figure.since)}`}>
      <span className={cn('font-semibold tabular-nums', figure.kind === 'cycle' ? 'text-slate-700' : figure.days > 30 ? 'text-rose-700' : 'text-slate-800')}>{figure.days}</span>
      <span className="text-[11px] text-muted-foreground">{DAYS_HINT[figure.kind]}</span>
    </span>
  );
}

/**
 * One marker per revision submitted (R0, R1 …), a speech mark where the client commented on it, and
 * a tick once approved. Hover (or a screen reader) gives the dates.
 */
export function RevisionTrack({ item, className }: { item: Pick<MdlItem, 'revisions' | 'approved' | 'approvedOn'>; className?: string }) {
  const submitted = item.revisions.filter((revision) => revision.submittedOn || revision.commentedOn);
  if (!submitted.length && !item.approved) return <span className={cn('text-xs text-muted-foreground', className)}>Not submitted</span>;
  const lastIndex = submitted.length - 1;
  const description = [
    ...submitted.map(
      (revision) =>
        `R${revision.rev} submitted ${revision.submittedOn ? formatDate(revision.submittedOn) : '(date missing)'}` +
        (revision.commentedOn ? `, comments ${formatDate(revision.commentedOn)}` : ''),
    ),
    ...(item.approved ? [`approved ${item.approvedOn ? formatDate(item.approvedOn) : ''}`.trim()] : []),
  ].join('; ');
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-0.5', className)} title={description}>
      <span className="sr-only">{description}</span>
      {submitted.map((revision, index) => {
        const open = index === lastIndex && !revision.commentedOn && !item.approved;
        return (
          <span key={revision.rev} className="inline-flex items-center gap-0.5" aria-hidden="true">
            {index > 0 && <span className="h-px w-1.5 bg-slate-300" />}
            <span
              className={cn(
                'inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded-full border px-1 text-[10px] font-semibold tabular-nums',
                open ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-50 text-slate-600',
              )}
            >
              R{revision.rev}
            </span>
            {revision.commentedOn && (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                <MessageSquare className="h-3 w-3" />
              </span>
            )}
          </span>
        );
      })}
      {item.approved && (
        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
          {submitted.length > 0 && <span className="h-px w-1.5 bg-slate-300" />}
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
            <Check className="h-3 w-3" />
          </span>
        </span>
      )}
    </span>
  );
}

export function ProjectSelect({
  projects,
  value,
  onChange,
  allowAll = false,
  className,
  id,
}: {
  projects: MdlProjectView[];
  value: string | null;
  onChange: (code: string | null) => void;
  /** Offer "All projects" (value null). */
  allowAll?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <Select value={value ?? 'all'} onValueChange={(next) => onChange(next === 'all' ? null : next)}>
      <SelectTrigger id={id} className={cn('min-w-0 text-left', className)} aria-label="Project">
        <SelectValue placeholder="Choose a project" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {allowAll && <SelectItem value="all">All projects</SelectItem>}
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
