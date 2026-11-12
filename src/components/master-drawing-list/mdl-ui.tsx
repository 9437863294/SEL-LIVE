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
import { COURT_LABEL, ballInCourt, formatMdlDate, type Court, type DrawingRecord } from '@/lib/master-drawing-list/drawings';
import { COURT_FILTERS, type CourtFilter } from '@/lib/master-drawing-list/register';
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

const COURT_TONE: Record<Court, StatusTone> = { client: 'info', sel: 'warning', not_started: 'neutral', closed: 'success' };

/** Who has to act next on a drawing, and for how many days: "With client · 12 d". */
export function CourtBadge({ record, today, className }: { record: Pick<DrawingRecord, 'revisions' | 'status'>; today: string; className?: string }) {
  const state = ballInCourt(record, today);
  return (
    <StatusBadge tone={COURT_TONE[state.court]} dot className={className} title={state.since ? `Since ${formatMdlDate(state.since)}${state.round ? ` (${state.round})` : ''}` : undefined}>
      {COURT_LABEL[state.court]}
      {state.days !== null && (state.court === 'client' || state.court === 'sel') ? ` · ${state.days} d` : ''}
    </StatusBadge>
  );
}

const CHIP_DOT: Record<CourtFilter, string> = { client: 'bg-blue-500', sel: 'bg-amber-500', not_started: 'bg-slate-400', closed: 'bg-emerald-500', overdue: 'bg-rose-500' };
const CHIP_LABEL: Record<CourtFilter, string> = { ...COURT_LABEL, overdue: 'Overdue' };

/** The register's quick filters: all, or where the ball is, or overdue — each with its count. */
export function CourtChips({ counts, total, value, onChange, filters = COURT_FILTERS }: { counts: Record<CourtFilter, number>; total: number; value: CourtFilter | null; onChange: (value: CourtFilter | null) => void; filters?: readonly CourtFilter[] }) {
  const chip = (active: boolean) =>
    cn(
      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    );
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Quick filters">
      <button type="button" className={chip(value === null)} aria-pressed={value === null} onClick={() => onChange(null)}>
        All <span className="tabular-nums opacity-80">{total}</span>
      </button>
      {filters.map((filter) => (
        <button key={filter} type="button" className={chip(value === filter)} aria-pressed={value === filter} onClick={() => onChange(value === filter ? null : filter)}>
          <span className={cn('h-2 w-2 rounded-full', CHIP_DOT[filter])} aria-hidden="true" />
          {CHIP_LABEL[filter]} <span className="tabular-nums opacity-80">{counts[filter]}</span>
        </button>
      ))}
    </div>
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
