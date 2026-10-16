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
 * Collapsed until asked for, and each row is one line until opened: the page is for closing
 * months, and the trail is there for when someone needs to look something up — hence the filters.
 *
 * Queried by `action` alone — one single-field index, no composite one to deploy. The action
 * names are Site Account's own, so no module filter is needed.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, History, Loader2, RefreshCw } from 'lucide-react';
import { db } from '@/lib/firebase';
import { logDate, logTime, toAuditLog, userLabel, type AuditLogEntry } from '@/components/shared/record-history';
import { FilterBar } from '@/components/shared/filter-bar';
import { periodLabel } from '@/lib/site-account-statement-period-range';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** The activity names Month Closure writes, and how each reads in the history. */
const ACTIONS: Record<string, { label: string; tone: string }> = {
  'Close SAS Month':            { label: 'Closed',               tone: 'bg-slate-100 text-slate-800' },
  'Close SAS Months (bulk)':    { label: 'Closed (bulk)',        tone: 'bg-slate-100 text-slate-800' },
  'Reopen SAS Month':           { label: 'Reopened',             tone: 'bg-amber-100 text-amber-900' },
  'Clear SAS Month Exception':  { label: 'Follows all projects', tone: 'bg-sky-100 text-sky-900' },
  'Change SAS Auto-Close Rule': { label: 'Auto-close rule',      tone: 'bg-indigo-100 text-indigo-900' },
};

/** Enough to cover years of closures; they are a few a month at most. */
const MAX_ROWS = 500;
const ALL_SCOPE = 'All projects';
/** The Selects' "no filter" value — Radix reserves the empty string. */
const ANY = '_any_';

/** The months an entry touched, as `YYYY-MM` keys — one, or a bulk close's list. */
function periodsOf(log: AuditLogEntry): string[] {
  const d = log.details ?? {};
  if (typeof d.period === 'string' && d.period) return [d.period];
  if (typeof d.periods === 'string' && d.periods) return d.periods.split(',').map((p: string) => p.trim()).filter(Boolean);
  if (typeof d.through === 'string' && d.through) return [d.through];
  return [];
}

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
  if (typeof d.reason === 'string' && d.reason) return { text: d.reason, isRule: false };
  if (typeof d.note === 'string' && d.note) return { text: d.note, isRule: false };
  if (typeof d.rule === 'string' && d.rule) return { text: `Rule: ${d.rule}`, isRule: true };
  return { text: '', isRule: false };
}

const scopeOf = (log: AuditLogEntry): string => String(log.details?.scope || ALL_SCOPE);

/** `YYYY-MM-DD` of an entry, in the viewer's own day, for the date filters. */
function dayOf(log: AuditLogEntry): string {
  const d = logDate(log);
  return d ? format(d, 'yyyy-MM-dd') : '';
}

/**
 * One filter Select. Its label lives in the no-filter choice ("All actions"), so the bar stays one
 * row high and lines up with the search box.
 */
function FilterSelect({
  label, anyLabel, value, onChange, options, width = 'sm:w-[170px]',
}: {
  label: string;
  anyLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  width?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-9 w-full', width)} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** A date bound with its word beside it rather than above, for the same reason. */
function DateBound({ label, value, onChange, min, max }: {
  label: string; value: string; onChange: (v: string) => void; min?: string; max?: string;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <Input type="date" value={value} min={min} max={max} onChange={e => onChange(e.target.value)} className="h-9 w-full sm:w-[150px]" />
    </label>
  );
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
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const [search, setSearch] = useState('');
  const [action, setAction] = useState(ANY);
  const [month, setMonth] = useState(ANY);
  const [project, setProject] = useState(ANY);
  const [person, setPerson] = useState(ANY);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

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
   * months too. The all-projects view shows everything, with a Project column to tell them apart.
   */
  const inScope = useMemo(() => {
    if (!rows) return [];
    if (!scopeProject) return rows;
    return rows.filter(r => scopeOf(r) === scopeName || scopeOf(r) === ALL_SCOPE);
  }, [rows, scopeProject, scopeName]);

  // Filter choices come from the entries themselves, so no option ever finds nothing.
  const options = useMemo(() => {
    const actions = new Set<string>(); const months = new Set<string>();
    const projects = new Set<string>(); const people = new Set<string>();
    for (const r of inScope) {
      actions.add(r.action);
      periodsOf(r).forEach(p => months.add(p));
      projects.add(scopeOf(r));
      people.add(userLabel(r));
    }
    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return {
      actions: sorted(actions).map(a => ({ value: a, label: ACTIONS[a]?.label ?? a })),
      months: [...months].sort().reverse().map(m => ({ value: m, label: periodLabel(m) })),
      projects: sorted(projects).map(p => ({ value: p, label: p })),
      people: sorted(people).map(p => ({ value: p, label: p })),
    };
  }, [inScope]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inScope.filter(r => {
      if (action !== ANY && r.action !== action) return false;
      if (month !== ANY && !periodsOf(r).includes(month)) return false;
      if (!scopeProject && project !== ANY && scopeOf(r) !== project) return false;
      if (person !== ANY && userLabel(r) !== person) return false;
      const day = dayOf(r);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (needle) {
        const hay = [reasonOf(r).text, monthsOf(r), scopeOf(r), userLabel(r), ACTIONS[r.action]?.label ?? r.action]
          .join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [inScope, search, action, month, project, person, from, to, scopeProject]);

  const activeCount = [action, month, scopeProject ? ANY : project, person].filter(v => v !== ANY).length
    + (from ? 1 : 0) + (to ? 1 : 0);

  function clearFilters() {
    setSearch(''); setAction(ANY); setMonth(ANY); setProject(ANY); setPerson(ANY); setFrom(''); setTo('');
  }

  function toggleRow(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const latest = inScope[0];
  const columns = scopeProject ? 6 : 7;

  return (
    <Card>
      {/* The header is the toggle: collapsed, it says how much there is and what happened last. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-6 py-4 text-left hover:bg-muted/30"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />}
        <History className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-slate-900">History</span>
          <span className="block truncate text-xs text-muted-foreground">
            {error ? 'Could not be loaded'
              : rows === null ? 'Loading…'
              : inScope.length === 0 ? 'Nothing has been closed or reopened yet'
              : `${inScope.length} entr${inScope.length === 1 ? 'y' : 'ies'}${scopeProject ? ` affecting ${scopeName}` : ''}`
                + (latest ? ` · last: ${ACTIONS[latest.action]?.label ?? latest.action} ${monthsOf(latest)}`
                  + `${logDate(latest) ? `, ${format(logDate(latest)!, 'dd MMM yyyy')}` : ''}` : '')}
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium text-emerald-700">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <CardContent className="space-y-3 border-t p-0 pt-3">
          <div className="px-4 sm:px-6">
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: 'Search reason, month, project, person…' }}
              activeCount={activeCount}
              onClear={clearFilters}
              summary={rows ? `${shown.length} of ${inScope.length} shown` : undefined}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => { setRows(null); setReloads(n => n + 1); }}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </Button>
              }
            >
              <FilterSelect label="Action" anyLabel="All actions" value={action} onChange={setAction} options={options.actions} />
              <FilterSelect label="Month" anyLabel="All months" value={month} onChange={setMonth} options={options.months} width="sm:w-[150px]" />
              {!scopeProject && (
                <FilterSelect label="Project" anyLabel="All projects" value={project} onChange={setProject} options={options.projects} width="sm:w-[210px]" />
              )}
              <FilterSelect label="By" anyLabel="Anyone" value={person} onChange={setPerson} options={options.people} />
              <DateBound label="From" value={from} onChange={setFrom} max={to || undefined} />
              <DateBound label="To" value={to} onChange={setTo} min={from || undefined} />
            </FilterBar>
          </div>

          {error ? (
            <p className="px-6 pb-5 text-sm text-destructive">{error}</p>
          ) : rows === null ? (
            <div className="flex items-center gap-2 px-6 pb-5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
            </div>
          ) : shown.length === 0 ? (
            <p className="px-6 pb-5 text-sm text-muted-foreground">
              {inScope.length === 0 ? 'Nothing has been closed or reopened yet.' : 'No entries match these filters.'}
            </p>
          ) : (
            <div className="min-w-0 overflow-x-auto border-t">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="w-[150px]">When</TableHead>
                    <TableHead className="w-[150px]">Action</TableHead>
                    <TableHead>Month</TableHead>
                    {!scopeProject && <TableHead>Project</TableHead>}
                    <TableHead>By</TableHead>
                    <TableHead className="w-[30%]">Reason / note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map(log => {
                    const kind = ACTIONS[log.action] ?? { label: log.action, tone: 'bg-slate-100 text-slate-800' };
                    const when = logDate(log);
                    const reason = reasonOf(log);
                    const isOpen = expanded.has(log.id);
                    const d = log.details ?? {};
                    return (
                      <Fragment key={log.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleRow(log.id)}
                          aria-expanded={isOpen}
                        >
                          <TableCell className="pr-0">
                            {isOpen
                              ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                              : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                            {when ? format(when, 'dd MMM yyyy, HH:mm') : '—'}
                          </TableCell>
                          <TableCell>
                            <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', kind.tone)}>
                              {kind.label}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{monthsOf(log)}</TableCell>
                          {!scopeProject && <TableCell className="text-sm">{scopeOf(log)}</TableCell>}
                          <TableCell className="text-sm">{userLabel(log)}</TableCell>
                          <TableCell className={cn('max-w-0 truncate text-sm', reason.isRule && 'text-muted-foreground')}>
                            {reason.text || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell />
                            <TableCell colSpan={columns - 1} className="py-3">
                              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                                <dt className="text-xs font-medium text-muted-foreground">Reason / note</dt>
                                <dd className="whitespace-pre-wrap">{reason.text || '—'}</dd>
                                <dt className="text-xs font-medium text-muted-foreground">Project</dt>
                                <dd>{scopeOf(log)}</dd>
                                {periodsOf(log).length > 1 && (
                                  <>
                                    <dt className="text-xs font-medium text-muted-foreground">Months</dt>
                                    <dd>{periodsOf(log).map(periodLabel).join(', ')}</dd>
                                  </>
                                )}
                                {typeof d.relockOn === 'string' && d.relockOn && (
                                  <>
                                    <dt className="text-xs font-medium text-muted-foreground">Locks again on</dt>
                                    <dd>{d.relockOn === 'none' ? 'No limit — stays open until closed' : d.relockOn}</dd>
                                  </>
                                )}
                                {typeof d.rule === 'string' && d.rule && !reason.isRule && (
                                  <>
                                    <dt className="text-xs font-medium text-muted-foreground">Rule</dt>
                                    <dd>{d.rule}</dd>
                                  </>
                                )}
                                <dt className="text-xs font-medium text-muted-foreground">By</dt>
                                <dd>{userLabel(log)}{log.userEmail && log.userName ? ` · ${log.userEmail}` : ''}</dd>
                                <dt className="text-xs font-medium text-muted-foreground">Exact time</dt>
                                <dd className="tabular-nums">{when ? format(when, 'dd MMM yyyy, HH:mm:ss') : '—'}</dd>
                              </dl>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
