'use client';

/**
 * Month Closure's history: every close, reopen, bulk close, project exception cleared and
 * automatic-rule change, with who did it, when, and the note or reason they gave.
 *
 * The month cards show only each month's latest state, and closing a month again clears the
 * reopen reason from its card — so on its own the page had no record of what happened before.
 * Every one of those actions already writes an activity log (`userLogs`), so this reads them back
 * rather than keeping a second copy, and the history reaches back before this card existed.
 *
 * Queried by `action` alone — one single-field index, no composite one to deploy. The action
 * names are Site Account's own, so no module filter is needed.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { format } from 'date-fns';
import { History, Loader2, RefreshCw } from 'lucide-react';
import { db } from '@/lib/firebase';
import { logDate, logTime, toAuditLog, userLabel, type AuditLogEntry } from '@/components/shared/record-history';
import { periodLabel } from '@/lib/site-account-statement-period-range';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** The activity names Month Closure writes, and how each reads in the history. */
const ACTIONS: Record<string, { label: string; tone: string }> = {
  'Close SAS Month':            { label: 'Closed',              tone: 'bg-slate-100 text-slate-800' },
  'Close SAS Months (bulk)':    { label: 'Closed (bulk)',       tone: 'bg-slate-100 text-slate-800' },
  'Reopen SAS Month':           { label: 'Reopened',            tone: 'bg-amber-100 text-amber-900' },
  'Clear SAS Month Exception':  { label: 'Follows all projects', tone: 'bg-sky-100 text-sky-900' },
  'Change SAS Auto-Close Rule': { label: 'Auto-close rule',     tone: 'bg-indigo-100 text-indigo-900' },
};

/** Enough to cover years of closures; they are a few a month at most. */
const MAX_ROWS = 500;
const ALL_SCOPE = 'All projects';

function monthsOf(log: AuditLogEntry): string {
  const d = log.details ?? {};
  if (typeof d.period === 'string' && d.period) return periodLabel(d.period);
  if (typeof d.through === 'string' && d.through) {
    return `${d.count ?? ''} month${d.count === 1 ? '' : 's'} through ${periodLabel(d.through)}`.trim();
  }
  return '—';
}

/** The words the person gave — a reopen reason, a closing note — or what the rule became. */
function reasonOf(log: AuditLogEntry): { text: string; isRule: boolean } {
  const d = log.details ?? {};
  if (typeof d.reason === 'string' && d.reason) {
    return { text: d.reason + (typeof d.rule === 'string' ? ` (rule: ${d.rule})` : ''), isRule: false };
  }
  if (typeof d.note === 'string' && d.note) return { text: d.note, isRule: false };
  if (typeof d.rule === 'string' && d.rule) return { text: `Rule: ${d.rule}`, isRule: true };
  return { text: '', isRule: false };
}

export function MonthClosureHistory({
  scopeName,
  scopeProject,
  refreshKey,
}: {
  /** The scope in view: "All projects", or the project's name. */
  scopeName: string;
  scopeProject?: string;
  /** Bumped by the page after each action it takes, so the new entry appears. */
  refreshKey: number;
}) {
  const [rows, setRows] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getDocs(query(collection(db, 'userLogs'), where('action', 'in', Object.keys(ACTIONS)), limit(MAX_ROWS)))
      .then(snap => {
        if (cancelled) return;
        setRows(snap.docs.map(toAuditLog).sort((a, b) => logTime(b) - logTime(a)));
        setError(null);
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'The history could not be loaded.'); });
    return () => { cancelled = true; };
  }, [refreshKey, reloads]);

  /*
   * A project's history includes the all-projects actions, since those closed and reopened its
   * months too. The all-projects view shows everything, with a Scope column to tell them apart.
   */
  const shown = useMemo(() => {
    if (!rows) return [];
    if (!scopeProject) return rows;
    return rows.filter(r => r.details?.scope === scopeName || r.details?.scope === ALL_SCOPE || !r.details?.scope);
  }, [rows, scopeProject, scopeName]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-slate-500" />
            History
          </CardTitle>
          <CardDescription className="mt-1">
            {scopeProject
              ? `Every closure action affecting ${scopeName} — its own and the all-projects ones — with the reason given.`
              : 'Every closure action, for all projects and individual projects, with the reason given.'}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => { setRows(null); setReloads(n => n + 1); }}
          aria-label="Reload history"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <p className="px-6 pb-5 text-sm text-destructive">{error}</p>
        ) : rows === null ? (
          <div className="flex items-center gap-2 px-6 pb-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </div>
        ) : shown.length === 0 ? (
          <p className="px-6 pb-5 text-sm text-muted-foreground">Nothing has been closed or reopened yet.</p>
        ) : (
          <div className="min-w-0 overflow-x-auto border-t">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">When</TableHead>
                  <TableHead className="w-[140px]">Action</TableHead>
                  <TableHead>Month</TableHead>
                  {!scopeProject && <TableHead>Scope</TableHead>}
                  <TableHead>By</TableHead>
                  <TableHead className="w-[34%]">Reason / note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(log => {
                  const kind = ACTIONS[log.action] ?? { label: log.action, tone: 'bg-slate-100 text-slate-800' };
                  const when = logDate(log);
                  const reason = reasonOf(log);
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {when ? format(when, 'dd MMM yyyy, HH:mm') : '—'}
                      </TableCell>
                      <TableCell>
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', kind.tone)}>
                          {kind.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{monthsOf(log)}</TableCell>
                      {!scopeProject && (
                        <TableCell className="text-sm">{String(log.details?.scope ?? ALL_SCOPE)}</TableCell>
                      )}
                      <TableCell className="text-sm">{userLabel(log)}</TableCell>
                      <TableCell className={cn('whitespace-normal text-sm', reason.isRule && 'text-muted-foreground')}>
                        {reason.text || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
