'use client';

/**
 * Settings › Workflow, on a level that follows the reporting line: whose claims it sends where.
 *
 * Each employee's line is the one Employee › Reporting draws (their manager in greytHR, matched to
 * that manager's login), unless Access Management names another reporting manager. The level's
 * exceptions come first; anyone the line cannot place — a manager who has left, has no login, a
 * login linked to no employee — goes to the level's fallback people, or to nobody when they are
 * the only one of those. Those are listed first, each with a way to set an approver for them.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ExternalLink, Search, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { stageAssignees } from '@/lib/employee-trips/workflow';
import { REPORTING_GAP_LABELS, type ReportingLineEntry, type ReportingSource, type WorkflowStage } from '@/lib/employee-trips/types';
import { SegmentTabs } from './trip-ui';

type Outcome = 'line' | 'exception' | 'fallback' | 'nobody';

const SOURCE_LABELS: Record<ReportingSource, string> = {
  greythr: 'Manager in greytHR',
  access: 'Reporting manager in Access Management',
};

const OUTCOME_TONE: Record<Outcome, string> = {
  line: 'text-slate-700',
  exception: 'text-sky-700',
  fallback: 'text-amber-800',
  nobody: 'text-rose-700',
};

/** Shown at first; the rest one tap away (an organisation can have hundreds of logins). */
const FIRST_ROWS = 40;

export function ReportingLinePanel({
  stage,
  line,
  users,
  canEdit,
  onSetApprover,
}: {
  stage: WorkflowStage;
  line: ReportingLineEntry[];
  users: { id: string; name: string }[];
  canEdit: boolean;
  /** Adds an exception for this employee to the level (its people are then chosen below). */
  onSetApprover: (userId: string) => void;
}) {
  const [show, setShow] = useState<'attention' | 'everyone'>('attention');
  const [search, setSearch] = useState('');
  const [all, setAll] = useState(false);

  const rows = useMemo(() => {
    const nameOf = new Map(users.map((user) => [user.id, user.name]));
    return line
      .map((entry) => {
        const approvers = stageAssignees(stage, { employeeId: entry.userId, projectId: null, departmentId: null, reportingAuthorityIds: entry.ids });
        const exception = stage.routes.some((route) => route.key === entry.userId && route.userIds.some((id) => id !== entry.userId));
        const outcome: Outcome = !approvers.length ? 'nobody' : exception ? 'exception' : entry.ids.some((id) => approvers.includes(id)) ? 'line' : 'fallback';
        const gap = entry.gap ? REPORTING_GAP_LABELS[entry.gap] : 'No reporting authority on record';
        const reason =
          outcome === 'line'
            ? entry.source
              ? SOURCE_LABELS[entry.source]
              : ''
            : outcome === 'exception'
              ? 'Exception set on this level'
              : outcome === 'fallback'
                ? `${gap} — goes to the fallback people`
                : `${gap}, and the fallback people are only them`;
        return {
          userId: entry.userId,
          name: nameOf.get(entry.userId) ?? 'Unknown user',
          approverNames: approvers.map((id) => nameOf.get(id) ?? 'Unknown user'),
          outcome,
          reason,
          attention: outcome === 'fallback' || outcome === 'nobody',
          hasRoute: stage.routes.some((route) => route.key === entry.userId),
        };
      })
      .sort((a, b) => Number(b.outcome === 'nobody') - Number(a.outcome === 'nobody') || Number(b.attention) - Number(a.attention) || a.name.localeCompare(b.name));
  }, [line, stage, users]);

  const counts = useMemo(() => {
    const tally: Record<Outcome, number> = { line: 0, exception: 0, fallback: 0, nobody: 0 };
    for (const row of rows) tally[row.outcome] += 1;
    return tally;
  }, [rows]);
  const attention = counts.fallback + counts.nobody;

  const needle = search.trim().toLowerCase();
  const shown = rows.filter((row) => (show === 'everyone' || row.attention) && (!needle || `${row.name} ${row.approverNames.join(' ')}`.toLowerCase().includes(needle)));
  const visible = all ? shown : shown.slice(0, FIRST_ROWS);

  const summary = [
    `${counts.line} to their manager`,
    counts.exception ? `${counts.exception} by exception` : null,
    counts.fallback ? `${counts.fallback} to the fallback people` : null,
    counts.nobody ? `${counts.nobody} to nobody` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-xs font-medium text-slate-700">Whose claims go where</p>
          <p className="text-[11px] text-muted-foreground">
            Each employee&apos;s manager as Employee › Reporting shows it (greytHR), unless Access Management names another. Change who reports to whom in greytHR; it arrives with the next sync.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/employee/reporting">
            Employee › Reporting
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </div>

      <p className="text-xs text-slate-600">
        <span className="font-medium text-slate-800">{line.length}</span> {line.length === 1 ? 'person' : 'people'}: {summary.join(' · ')}.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SegmentTabs
          label="Whose claims to list"
          value={show}
          onChange={(next) => {
            setShow(next);
            setAll(false);
          }}
          options={[
            { value: 'attention', label: 'Needs attention', count: attention },
            { value: 'everyone', label: 'Everyone', count: rows.length },
          ]}
          className="sm:w-auto"
        />
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an employee or approver" className="h-9 bg-white pl-8 text-xs" aria-label="Find an employee or approver" />
        </div>
      </div>

      {visible.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {visible.map((row) => (
            <li key={row.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2">
              <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-slate-800">{row.name}</span>
              <span className="min-w-0 flex-[2] basis-56">
                <span className={cn('block truncate text-xs font-medium', OUTCOME_TONE[row.outcome])}>
                  → {row.approverNames.length ? row.approverNames.join(', ') : 'Nobody'}
                </span>
                <span className="block text-[11px] text-muted-foreground">{row.reason}</span>
              </span>
              {canEdit && row.attention && !row.hasRoute && (
                <Button type="button" variant="outline" size="sm" className="h-8 w-full sm:w-auto" onClick={() => onSetApprover(row.userId)}>
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Set approver
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-muted-foreground">
          {needle ? 'Nobody matches.' : show === 'attention' ? 'Every claim reaches a manager or an exception.' : 'No active logins.'}
        </p>
      )}
      {!all && shown.length > visible.length && (
        <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setAll(true)}>
          Show all {shown.length}
        </Button>
      )}
    </div>
  );
}
