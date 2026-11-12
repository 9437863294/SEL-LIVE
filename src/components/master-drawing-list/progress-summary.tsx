'use client';

/**
 * Progress in the register's order, Scope › Schedule › Group, for the Reports page:
 *   - `ScopeProgress`: a stacked bar per scope with one per schedule beneath it (a chart card's body);
 *   - `StatusSummary`: the status summary table — every scope, schedule and group, with the drawing
 *     list's total — that downloads as a workbook.
 * Figures count deliverables (each sub-drawing, else the item), as on the rest of the page.
 */

import { useState, type ReactNode } from 'react';
import { ChevronRight, Download, Folder, FolderTree, Layers, Sigma } from 'lucide-react';

import { TableCard } from '@/components/shared/table-card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Progress, ProgressRow } from '@/lib/master-drawing-list/analytics';
import { cn } from '@/lib/utils';

// The app's status tones as fills — approved emerald, with client blue, with SEL amber, not
// submitted slate; the verdicts add orange (resubmit) and red (rejected). Text stays in text ink.
export const MDL_COLOURS = {
  approved: '#10b981',
  withComments: '#f59e0b',
  resubmit: '#f97316',
  rejected: '#ef4444',
  review: '#3b82f6',
  client: '#3b82f6',
  sel: '#f59e0b',
  notStarted: '#94a3b8',
  submission: '#0ea5e9',
};

const C = MDL_COLOURS;

/** Approved, with the client, with SEL and not submitted as one bar. */
export function CourtBar({ progress, label, className }: { progress: Progress; label: string; className?: string }) {
  const parts = [
    [progress.approved, C.approved],
    [progress.client, C.client],
    [progress.sel, C.sel],
    [progress.notStarted, C.notStarted],
  ] as const;
  return (
    <div
      className={cn('flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-muted', className)}
      role="img"
      aria-label={`${label}: ${progress.approved} approved, ${progress.client} with client, ${progress.sel} with SEL, ${progress.notStarted} not submitted`}
    >
      {parts
        .filter(([count]) => count > 0)
        .map(([count, color]) => (
          <span key={color} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(count / Math.max(1, progress.drawings)) * 100}%`, backgroundColor: color }} />
        ))}
    </div>
  );
}

export function CourtLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(
        [
          ['Approved', C.approved],
          ['With client', C.client],
          ['With SEL', C.sel],
          ['Not submitted', C.notStarted],
        ] as const
      ).map(([name, color]) => (
        <span key={name} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" /> {name}
        </span>
      ))}
    </div>
  );
}

const approvedText = (progress: Progress) => `${progress.approved}/${progress.drawings} approved · ${progress.pct}%`;

/** A bar per scope, its schedules beneath, all on one scale so their lengths compare. */
export function ScopeProgress({ tree }: { tree: ProgressRow[] }) {
  const max = Math.max(1, ...tree.map((scope) => scope.progress.drawings));
  const width = (progress: Progress) => `${Math.max(12, (progress.drawings / max) * 100)}%`;
  return (
    <div className="space-y-4">
      <CourtLegend />
      {tree.map((scope) => (
        <div key={scope.key} className="space-y-2">
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 font-semibold">
                <FolderTree className="h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden="true" />
                <span className="truncate">{scope.name}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{approvedText(scope.progress)}</span>
            </div>
            <CourtBar progress={scope.progress} label={scope.name} className="h-3" />
          </div>
          {scope.children.map((schedule) => (
            <div key={schedule.key} className="pl-5">
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  <Folder className="h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" />
                  <span className="truncate">{schedule.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{approvedText(schedule.progress)}</span>
              </div>
              <div style={{ width: width(schedule.progress) }}>
                <CourtBar progress={schedule.progress} label={`${scope.name} › ${schedule.name}`} className="h-2" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const toggled = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

const NUMBER_COLUMNS = [
  ['Items', 'items'],
  ['Drawings', 'drawings'],
  ['Approved', 'approved'],
  ['With client', 'client'],
  ['With SEL', 'sel'],
  ['Not submitted', 'notStarted'],
  ['Overdue', 'overdue'],
] as const;

const LEVEL_ICON = {
  scope: <FolderTree className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />,
  schedule: <Folder className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />,
  group: <Layers className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />,
};

/**
 * The status summary: scopes open with their schedules; a schedule opens to its groups. "Show
 * groups" opens every one.
 */
export function StatusSummary({ tree, total, onDownload }: { tree: ProgressRow[]; total: Progress; onDownload?: () => void }) {
  const [closedScopes, setClosedScopes] = useState<Set<string>>(new Set());
  const [openSchedules, setOpenSchedules] = useState<Set<string>>(new Set());
  const scheduleKeys = tree.flatMap((scope) => scope.children.map((schedule) => schedule.key));
  const allOpen = closedScopes.size === 0 && scheduleKeys.every((key) => openSchedules.has(key));
  const isOpen = (row: ProgressRow) => (row.level === 'scope' ? !closedScopes.has(row.key) : openSchedules.has(row.key));
  const toggle = (row: ProgressRow) => (row.level === 'scope' ? setClosedScopes((current) => toggled(current, row.key)) : setOpenSchedules((current) => toggled(current, row.key)));
  const visible = (rows: ProgressRow[]): ProgressRow[] => rows.flatMap((row) => [row, ...(row.level !== 'group' && isOpen(row) ? visible(row.children) : [])]);
  const rows = visible(tree);

  /** The row's name; on a scope or schedule, a button that opens and closes what is under it. */
  const nameOf = (row: ProgressRow, className?: string): ReactNode => {
    const label = (
      <>
        {LEVEL_ICON[row.level]}
        {row.level !== 'group' && <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{row.level === 'scope' ? 'Scope' : 'Schedule'}</span>}
        <span className={cn('min-w-0 break-words', row.level === 'scope' && 'font-bold', row.level === 'schedule' && 'font-semibold', row.level === 'group' && !row.group && 'italic text-muted-foreground')}>{row.name}</span>
      </>
    );
    if (row.level === 'group') return <span className={cn('flex items-center gap-2', className)}>{label}</span>;
    return (
      <button type="button" className={cn('flex items-center gap-2 text-left', className)} aria-expanded={isOpen(row)} onClick={() => toggle(row)}>
        <ChevronRight aria-hidden className={cn('h-4 w-4 shrink-0 transition-transform', isOpen(row) && 'rotate-90')} />
        {label}
      </button>
    );
  };
  const indent = { scope: '', schedule: 'pl-8', group: 'pl-14' };
  const tone = { scope: 'bg-muted', schedule: 'bg-muted/40', group: '' };

  return (
    <TableCard
      title="Status summary"
      icon={Sigma}
      description="Every scope, schedule and group: drawings approved, with the client, with SEL, not submitted and overdue."
      scroll="natural"
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-2 text-xs sm:h-7"
            onClick={() => {
              if (allOpen) {
                setOpenSchedules(new Set());
              } else {
                setClosedScopes(new Set());
                setOpenSchedules(new Set(scheduleKeys));
              }
            }}
          >
            {allOpen ? 'Hide groups' : 'Show groups'}
          </Button>
          {onDownload && (
            <Button variant="outline" size="sm" className="h-9 sm:h-7" onClick={onDownload}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Download
            </Button>
          )}
        </>
      }
    >
      <Table containerClassName="hidden sm:block">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[16rem]">Scope › Schedule › Group</TableHead>
            {NUMBER_COLUMNS.map(([header]) => (
              <TableHead key={header} className="text-right">
                {header}
              </TableHead>
            ))}
            <TableHead className="min-w-[10rem]">Progress</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.level}-${row.key}`} className={tone[row.level]}>
              <TableCell className={indent[row.level]}>{nameOf(row)}</TableCell>
              {NUMBER_COLUMNS.map(([header, key]) => (
                <TableCell key={header} className={cn('text-right tabular-nums', row.level === 'scope' && 'font-semibold', key === 'overdue' && row.progress.overdue > 0 && 'font-medium text-red-600')}>
                  {row.progress[key]}
                </TableCell>
              ))}
              <TableCell>
                <div className="flex items-center gap-2">
                  <CourtBar progress={row.progress} label={row.name} className="w-24 shrink-0" />
                  <span className="text-xs tabular-nums text-muted-foreground">{row.progress.pct}%</span>
                </div>
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 font-semibold">
            <TableCell>Total</TableCell>
            {NUMBER_COLUMNS.map(([header, key]) => (
              <TableCell key={header} className={cn('text-right tabular-nums', key === 'overdue' && total.overdue > 0 && 'text-red-600')}>
                {total[key]}
              </TableCell>
            ))}
            <TableCell>
              <div className="flex items-center gap-2">
                <CourtBar progress={total} label="Total" className="w-24 shrink-0" />
                <span className="text-xs tabular-nums text-muted-foreground">{total.pct}%</span>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      {/* Phone: the same rows as bands, indented a step per level. */}
      <div className="divide-y sm:hidden">
        {[...rows, null].map((row) => {
          const progress = row ? row.progress : total;
          return (
            <div key={row ? `${row.level}-${row.key}` : 'total'} className={cn('space-y-1.5 py-3 pr-3', row ? tone[row.level] : 'border-t-2', row ? { scope: 'pl-3', schedule: 'pl-6', group: 'pl-9' }[row.level] : 'pl-3')}>
              {row ? nameOf(row, 'w-full') : <span className="font-semibold">Total</span>}
              <CourtBar progress={progress} label={row?.name ?? 'Total'} />
              <p className="text-xs tabular-nums text-muted-foreground">
                {approvedText(progress)} · {progress.client} with client · {progress.sel} with SEL · {progress.notStarted} not submitted
                {progress.overdue > 0 && <span className="font-medium text-red-600"> · {progress.overdue} overdue</span>}
              </p>
            </div>
          );
        })}
      </div>
    </TableCard>
  );
}
