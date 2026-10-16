'use client';

/**
 * A settings page's history card — who changed what, when, and why — read back from the activity
 * log (`userLogs`) the page already writes. Month Closure and Date Control each describe their own
 * entries through a config; the loading, scoping, filters and expanding rows live here.
 *
 * Collapsed until asked for, and each row is one line until opened: the page is for changing the
 * setting, and the trail is there for when someone needs to look something up — hence the filters.
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
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type { AuditLogEntry } from '@/components/shared/record-history';

/** Enough to cover years of changes; settings change a few times a month at most. */
const MAX_ROWS = 500;
export const ALL_SCOPE = 'All projects';
/** The Selects' "no filter" value — Radix reserves the empty string. */
const ANY = '_any_';

/** Which scope an entry was for. Entries from before per-project settings carry none: all projects. */
export const scopeOf = (log: AuditLogEntry): string => String(log.details?.scope || ALL_SCOPE);

export interface HistoryContext {
  /** The entry before this one for the same scope — what this one changed from — if any. */
  previous: AuditLogEntry | null;
}

export interface SettingsHistoryConfig {
  /** The activity names the page writes, and how each reads. */
  actions: Record<string, { label: string; tone: string }>;
  /** Header of the "what" column — "Month", "Rule". */
  subjectHeader: string;
  subjectOf: (log: AuditLogEntry, ctx: HistoryContext) => string;
  /** The words the person gave; `muted` for a stand-in that is not a reason. */
  reasonOf: (log: AuditLogEntry) => { text: string; muted?: boolean };
  /** A page-specific filter — the months an entry touched, the forms it changed. */
  facet?: {
    label: string;
    anyLabel: string;
    valuesOf: (log: AuditLogEntry) => string[];
    labelOf?: (value: string) => string;
    /** Newest first, for months; alphabetical otherwise. */
    descending?: boolean;
  };
  /** For a setting that is not per-project: no Project column, filter or detail row. */
  hideScope?: boolean;
  /** Further rows for the opened entry, after the reason and project. */
  detailsOf?: (log: AuditLogEntry, ctx: HistoryContext) => Array<[string, string]>;
  /** What the page is a history of, for the empty state: "closed or reopened", "changed". */
  emptyVerb: string;
  searchPlaceholder: string;
}

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

export function SettingsHistory({
  config,
  scopeName,
  scopeProject,
  refreshKey,
  defaultOpen = false,
}: {
  config: SettingsHistoryConfig;
  /** Open on arrival — for a History tab, where a collapsed card would be one click too many. */
  defaultOpen?: boolean;
  /** The scope in view: "All projects", or the project's name. */
  scopeName: string;
  scopeProject?: string;
  /** Bumped by the page after each change it saves, so the new entry appears. */
  refreshKey: number;
}) {
  const { actions, subjectHeader, subjectOf, reasonOf, facet, hideScope, detailsOf, emptyVerb, searchPlaceholder } = config;
  const showScope = !scopeProject && !hideScope;
  const actionNames = Object.keys(actions).join('|');

  const [rows, setRows] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [open, setOpen] = useState(defaultOpen);
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
    getDocs(query(collection(db, 'userLogs'), where('action', 'in', actionNames.split('|')), limit(MAX_ROWS)))
      .then(snap => {
        if (cancelled) return;
        setRows(snap.docs.map(toAuditLog).sort((a, b) => logTime(b) - logTime(a)));
        setError(null);
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'The history could not be loaded.'); });
    return () => { cancelled = true; };
  }, [actionNames, refreshKey, reloads]);

  /** For each entry, the one before it in the same scope — what it changed from. */
  const previousOf = useMemo(() => {
    const map = new Map<string, AuditLogEntry | null>();
    const newestFirst = rows ?? [];
    for (let i = 0; i < newestFirst.length; i++) {
      const scope = scopeOf(newestFirst[i]);
      map.set(newestFirst[i].id, newestFirst.slice(i + 1).find(r => scopeOf(r) === scope) ?? null);
    }
    return map;
  }, [rows]);
  const ctxOf = (log: AuditLogEntry): HistoryContext => ({ previous: previousOf.get(log.id) ?? null });

  /*
   * A project's history includes the all-projects entries, since those govern it too. The
   * all-projects view shows everything, with a Project column to tell them apart.
   */
  const inScope = useMemo(() => {
    if (!rows) return [];
    if (!scopeProject) return rows;
    return rows.filter(r => scopeOf(r) === scopeName || scopeOf(r) === ALL_SCOPE);
  }, [rows, scopeProject, scopeName]);

  // Filter choices come from the entries themselves, so no option ever finds nothing.
  const options = useMemo(() => {
    const actionSet = new Set<string>(); const months = new Set<string>();
    const projects = new Set<string>(); const people = new Set<string>();
    for (const r of inScope) {
      actionSet.add(r.action);
      facet?.valuesOf(r).forEach(v => months.add(v));
      projects.add(scopeOf(r));
      people.add(userLabel(r));
    }
    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return {
      actions: sorted(actionSet).map(a => ({ value: a, label: actions[a]?.label ?? a })),
      months: (facet?.descending ? [...months].sort().reverse() : sorted(months))
        .map(m => ({ value: m, label: facet?.labelOf ? facet.labelOf(m) : m })),
      projects: sorted(projects).map(p => ({ value: p, label: p })),
      people: sorted(people).map(p => ({ value: p, label: p })),
    };
  }, [inScope, facet, actions]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inScope.filter(r => {
      if (action !== ANY && r.action !== action) return false;
      if (facet && month !== ANY && !facet.valuesOf(r).includes(month)) return false;
      if (showScope && project !== ANY && scopeOf(r) !== project) return false;
      if (person !== ANY && userLabel(r) !== person) return false;
      const day = dayOf(r);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (needle) {
        const hay = [
          reasonOf(r).text, subjectOf(r, { previous: previousOf.get(r.id) ?? null }),
          scopeOf(r), userLabel(r), actions[r.action]?.label ?? r.action,
        ].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [inScope, search, action, month, project, person, from, to, showScope, facet, reasonOf, subjectOf, actions, previousOf]);

  const activeCount = [action, facet ? month : ANY, showScope ? project : ANY, person].filter(v => v !== ANY).length
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
  const columns = showScope ? 7 : 6;

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
              : inScope.length === 0 ? `Nothing has been ${emptyVerb} yet`
              : `${inScope.length} entr${inScope.length === 1 ? 'y' : 'ies'}${scopeProject ? ` affecting ${scopeName}` : ''}`
                + (latest ? ` · last: ${actions[latest.action]?.label ?? latest.action} ${subjectOf(latest, ctxOf(latest))}`
                  + `${logDate(latest) ? `, ${format(logDate(latest)!, 'dd MMM yyyy')}` : ''}` : '')}
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium text-emerald-700">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <CardContent className="space-y-3 border-t p-0 pt-3">
          <div className="px-4 sm:px-6">
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: searchPlaceholder }}
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
              {facet && (
                <FilterSelect label={facet.label} anyLabel={facet.anyLabel} value={month} onChange={setMonth} options={options.months} width="sm:w-[170px]" />
              )}
              {showScope && (
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
              {inScope.length === 0 ? `Nothing has been ${emptyVerb} yet.` : 'No entries match these filters.'}
            </p>
          ) : (
            <div className="min-w-0 overflow-x-auto border-t">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="w-[150px]">When</TableHead>
                    <TableHead className="w-[150px]">Action</TableHead>
                    <TableHead>{subjectHeader}</TableHead>
                    {showScope && <TableHead>Project</TableHead>}
                    <TableHead>By</TableHead>
                    <TableHead className="w-[28%]">Reason / note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map(log => {
                    const kind = actions[log.action] ?? { label: log.action, tone: 'bg-slate-100 text-slate-800' };
                    const when = logDate(log);
                    const reason = reasonOf(log);
                    const ctx = ctxOf(log);
                    const isOpen = expanded.has(log.id);
                    const extra = detailsOf?.(log, ctx) ?? [];
                    return (
                      <Fragment key={log.id}>
                        <TableRow className="cursor-pointer" onClick={() => toggleRow(log.id)} aria-expanded={isOpen}>
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
                          <TableCell className="whitespace-nowrap text-sm">{subjectOf(log, ctx)}</TableCell>
                          {showScope && <TableCell className="text-sm">{scopeOf(log)}</TableCell>}
                          <TableCell className="text-sm">{userLabel(log)}</TableCell>
                          <TableCell className={cn('max-w-0 truncate text-sm', reason.muted && 'text-muted-foreground')}>
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
                                {!hideScope && (
                                  <>
                                    <dt className="text-xs font-medium text-muted-foreground">Project</dt>
                                    <dd>{scopeOf(log)}</dd>
                                  </>
                                )}
                                {extra.map(([label, value]) => (
                                  <Fragment key={label}>
                                    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                                    <dd>{value}</dd>
                                  </Fragment>
                                ))}
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
