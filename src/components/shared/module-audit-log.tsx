'use client';

/**
 * One module's audit trail — who did what, when — for the module's own "Audit Log" page.
 *
 * The same `userLogs` rows the global viewer (Settings › Audit Logs) reads, narrowed to one module
 * so a module owner can review their own trail without the Settings permission. The query is
 * `module ==` (or `in`, when the module has historical alias spellings in MODULE_NAME_ALIASES) with
 * optional date bounds, ordered by timestamp — covered by the (module, timestamp desc) index the
 * global viewer already relies on. User, action, search and "changes only" narrow the loaded rows;
 * "Load more" pages further back.
 *
 * A plain table rather than DataList: rows expand in place, and DataList mounts every cell twice.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { format, formatDistanceToNow, isToday } from 'date-fns';
import {
  collection, getDocs, limit, orderBy, query, startAfter, Timestamp, where,
  type QueryConstraint, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  Activity, CalendarClock, ChevronDown, ChevronRight, Clock, Download, History, Loader2, RefreshCw, Users, X,
} from 'lucide-react';
import { FilterBar } from '@/components/shared/filter-bar';
import { TableCard } from '@/components/shared/table-card';
import { KpiCard } from '@/components/shared/kpi-card';
import {
  ActionPill,
  changesOf,
  formatAuditValue,
  humanizeField,
  logDate,
  toAuditLog,
  userLabel,
  type AuditLogEntry,
} from '@/components/shared/record-history';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { MODULE_NAME_ALIASES } from '@/lib/activity-modules';
import { cn } from '@/lib/utils';

export type { AuditLogEntry } from '@/components/shared/record-history';

const PAGE_SIZE = 100;
/** Firestore's `in` takes at most 30 values; a module has one or two spellings. */
const IN_LIMIT = 30;

const formatWhen = (log: AuditLogEntry): string => {
  const d = logDate(log);
  return d ? format(d, 'dd MMM yyyy, HH:mm:ss') : '—';
};

/** Details other than `changes` — the context a log was written with. */
const restOf = (log: AuditLogEntry): Array<[string, unknown]> =>
  Object.entries(log.details ?? {}).filter(([k, v]) => k !== 'changes' && v !== null && v !== undefined && v !== '');

/** Details keys that only repeat the Record column. */
const REDUNDANT_KEYS = new Set(['receptionNo', 'requestNo']);

/** The one-line "what changed" for the table. */
const summaryOf = (log: AuditLogEntry): string => {
  const changes = changesOf(log.details);
  if (changes.length === 1) {
    const [field, c] = changes[0];
    return `${humanizeField(field)}: ${formatAuditValue(c.from)} → ${formatAuditValue(c.to)}`;
  }
  if (changes.length > 1) {
    const names = changes.slice(0, 3).map(([f]) => humanizeField(f)).join(', ');
    return `${changes.length} fields changed: ${names}${changes.length > 3 ? '…' : ''}`;
  }
  const d = log.details ?? {};
  const parts: string[] = [];
  if ('from' in d || 'to' in d) parts.push(`${formatAuditValue(d.from)} → ${formatAuditValue(d.to)}`);
  restOf(log)
    .filter(([k, v]) => k !== 'from' && k !== 'to' && !REDUNDANT_KEYS.has(k) && typeof v !== 'object')
    .slice(0, parts.length ? 2 : 3)
    .forEach(([k, v]) => parts.push(`${humanizeField(k)}: ${formatAuditValue(v)}`));
  return parts.join(' · ') || '—';
};

const searchText = (log: AuditLogEntry): string =>
  [
    log.userName, log.userEmail, log.action, log.recordRef, log.recordId,
    ...changesOf(log.details).flatMap(([f, c]) => [f, formatAuditValue(c.from), formatAuditValue(c.to)]),
    ...restOf(log).map(([k, v]) => `${k} ${formatAuditValue(v)}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const loadErrorMessage = (err: unknown): string => {
  console.error('Failed to load the module audit log', err);
  const code = (err as { code?: string }).code;
  if (code === 'failed-precondition') {
    return 'This date filter needs a Firestore index that has not been deployed yet. Run: firebase deploy --only firestore:indexes';
  }
  if (code === 'permission-denied') return 'You do not have access to read the activity log.';
  return 'Could not load the audit log. Check your connection and try again.';
};

export interface ModuleAuditLogProps {
  /** Canonical module name (ACTIVITY_MODULES.*). Historical alias spellings are included. */
  module: string;
  /** Where a row's record opens, if anywhere. */
  recordHref?: (log: AuditLogEntry) => string | null | undefined;
  canExport: boolean;
}

export function ModuleAuditLog({ module, recordHref, canExport }: ModuleAuditLogProps) {
  const moduleNames = useMemo(
    () => [module, ...Object.entries(MODULE_NAME_ALIASES).filter(([, to]) => to === module).map(([from]) => from)].slice(0, IN_LIMIT),
    [module],
  );

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── server-side filters ──
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // ── client-side filters (loaded rows) ──
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState('All');
  const [actionFilter, setActionFilter] = useState('All');
  const [changesOnly, setChangesOnly] = useState(false);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const buildQuery = useCallback((cursor: QueryDocumentSnapshot | null) => {
    const constraints: QueryConstraint[] = [
      moduleNames.length > 1 ? where('module', 'in', moduleNames) : where('module', '==', moduleNames[0]),
    ];
    if (dateFrom) constraints.push(where('timestamp', '>=', Timestamp.fromDate(new Date(`${dateFrom}T00:00:00`))));
    if (dateTo) constraints.push(where('timestamp', '<=', Timestamp.fromDate(new Date(`${dateTo}T23:59:59.999`))));
    return query(
      collection(db, 'userLogs'),
      ...constraints,
      orderBy('timestamp', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(PAGE_SIZE),
    );
  }, [moduleNames, dateFrom, dateTo]);

  // Bumped on every fresh query, so a page that lands after the filters changed is dropped.
  const generation = useRef(0);

  const loadLogs = useCallback(async (cursor: QueryDocumentSnapshot | null = null) => {
    const fresh = !cursor;
    if (fresh) {
      generation.current += 1;
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    const gen = generation.current;
    setLoadError(null);
    try {
      const snap = await getDocs(buildQuery(cursor));
      if (gen !== generation.current) return;
      const rows = snap.docs.map(toAuditLog);
      if (fresh) {
        setLogs(rows);
        setExpandedIds(new Set());
      } else {
        setLogs((prev) => [...prev, ...rows]);
      }
      setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      if (gen === generation.current) setLoadError(loadErrorMessage(err));
    } finally {
      if (gen === generation.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [buildQuery]);

  // Re-query (and reset paging) whenever the date bounds change.
  useEffect(() => {
    setLastDoc(null);
    void loadLogs(null);
  }, [loadLogs]);

  // ── options from the loaded rows ──
  const userOptions = useMemo(() => {
    const byId = new Map<string, string>();
    logs.forEach((l) => {
      const id = l.userId || userLabel(l);
      if (!byId.has(id)) byId.set(id, l.userName && l.userEmail ? `${l.userName} (${l.userEmail})` : userLabel(l));
    });
    return [...byId.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [logs]);

  const actionOptions = useMemo(
    () => [...new Set(logs.map((l) => l.action).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [logs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (userFilter !== 'All' && (l.userId || userLabel(l)) !== userFilter) return false;
      if (actionFilter !== 'All' && l.action !== actionFilter) return false;
      if (changesOnly && changesOf(l.details).length === 0) return false;
      return !q || searchText(l).includes(q);
    });
  }, [logs, search, userFilter, actionFilter, changesOnly]);

  // ── KPIs (over the loaded rows) ──
  const kpis = useMemo(() => {
    const users = new Set(logs.map((l) => l.userId || userLabel(l)));
    const today = logs.filter((l) => {
      const d = logDate(l);
      return d ? isToday(d) : false;
    }).length;
    const latest = logs.length ? logDate(logs[0]) : null;
    return { users: users.size, today, latest };
  }, [logs]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── export ──
  const exportExcel = async () => {
    if (isExporting || !filtered.length) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Audit Log');
      ws.columns = [
        { header: 'When', key: 'when', width: 22 },
        { header: 'User', key: 'userName', width: 22 },
        { header: 'Email', key: 'userEmail', width: 30 },
        { header: 'Action', key: 'action', width: 32 },
        { header: 'Record', key: 'recordRef', width: 24 },
        { header: 'Record ID', key: 'recordId', width: 24 },
        { header: 'Summary', key: 'summary', width: 50 },
        { header: 'Changes', key: 'changes', width: 60 },
        { header: 'Details', key: 'details', width: 60 },
        { header: 'Session ID', key: 'sessionId', width: 36 },
        { header: 'User Agent', key: 'userAgent', width: 50 },
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach((l) => {
        ws.addRow({
          when: formatWhen(l),
          userName: l.userName ?? '',
          userEmail: l.userEmail ?? '',
          action: l.action ?? '',
          recordRef: l.recordRef ?? '',
          recordId: l.recordId ?? '',
          summary: summaryOf(l),
          changes: changesOf(l.details)
            .map(([f, c]) => `${humanizeField(f)}: ${formatAuditValue(c.from)} → ${formatAuditValue(c.to)}`)
            .join('\n'),
          details: restOf(l).map(([k, v]) => `${humanizeField(k)}: ${formatAuditValue(v)}`).join('\n'),
          sessionId: l.sessionId ?? '',
          userAgent: l.userAgent ?? '',
        });
      });
      ws.getColumn('changes').alignment = { wrapText: true, vertical: 'top' };
      ws.getColumn('details').alignment = { wrapText: true, vertical: 'top' };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${module.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-audit-log-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Audit log export failed', err);
    } finally {
      setIsExporting(false);
    }
  };

  const clearFilters = () => {
    setSearch(''); setDateFrom(''); setDateTo(''); setUserFilter('All'); setActionFilter('All'); setChangesOnly(false);
  };
  const activeFilterCount =
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (userFilter !== 'All' ? 1 : 0) + (actionFilter !== 'All' ? 1 : 0) + (changesOnly ? 1 : 0);
  const busy = isLoading || isLoadingMore;

  const renderExpanded = (log: AuditLogEntry) => {
    const changes = changesOf(log.details);
    const rest = restOf(log);
    return (
      <div className="grid grid-cols-1 gap-4 text-xs lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Before → after</p>
          {changes.length > 0 ? (
            <div className="overflow-x-auto rounded-md border bg-white">
              <table className="w-full text-left">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Field</th>
                    <th className="px-2 py-1.5 font-medium">Before</th>
                    <th className="px-2 py-1.5 font-medium">After</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map(([field, c]) => (
                    <tr key={field} className="border-t align-top">
                      <td className="whitespace-nowrap px-2 py-1.5 font-medium" title={field}>{humanizeField(field)}</td>
                      <td className="break-all px-2 py-1.5 text-red-700">{formatAuditValue(c.from)}</td>
                      <td className="break-all px-2 py-1.5 text-emerald-700">{formatAuditValue(c.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground">No field-level changes were recorded for this action.</p>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Details</p>
          {rest.length > 0 ? (
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border bg-white px-2.5 py-2">
              {rest.map(([k, v]) => (
                <Fragment key={k}>
                  <dt className="font-medium text-muted-foreground" title={k}>{humanizeField(k)}</dt>
                  <dd className="break-all text-slate-800">
                    {v !== null && typeof v === 'object' && !Array.isArray(v) && !('seconds' in (v as object))
                      ? <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{JSON.stringify(v, null, 2)}</pre>
                      : formatAuditValue(v)}
                  </dd>
                </Fragment>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground">No other details recorded.</p>
          )}
          <p className="break-all text-[10px] leading-relaxed text-muted-foreground">
            {log.recordId && <>Record ID {log.recordId} · </>}
            {log.sessionId && <>Session {log.sessionId} · </>}
            {log.ipAddress && <>IP {log.ipAddress} · </>}
            {log.source && log.source !== 'user' && <>Source {log.source} · </>}
            Log {log.id}
            {log.userAgent && <><br />{log.userAgent}</>}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Activity}
          tone="indigo"
          label="Events loaded"
          value={isLoading ? '…' : `${logs.length.toLocaleString('en-IN')}${hasMore ? '+' : ''}`}
          hint={dateFrom || dateTo ? 'In the date range' : 'Newest first'}
        />
        <KpiCard icon={Users} tone="violet" label="Distinct users" value={isLoading ? '…' : kpis.users} hint="Among loaded events" />
        <KpiCard icon={CalendarClock} tone="emerald" label="Today" value={isLoading ? '…' : kpis.today} hint="Events since midnight" />
        <KpiCard
          icon={Clock}
          tone="amber"
          label="Last activity"
          value={isLoading ? '…' : kpis.latest ? formatDistanceToNow(kpis.latest, { addSuffix: true }) : '—'}
          hint={kpis.latest ? format(kpis.latest, 'dd MMM yyyy, HH:mm') : undefined}
        />
      </div>

      {loadError && (
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="flex items-start gap-2 p-3">
            <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <p className="text-xs text-red-700">{loadError}</p>
          </CardContent>
        </Card>
      )}

      <TableCard
        icon={History}
        title="Activity"
        count={filtered.length}
        total={logs.length}
        noun="event"
        toolbar={
          <div className="space-y-2">
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: 'Search record, action, user, details…' }}
              activeCount={activeFilterCount}
              onClear={clearFilters}
              actions={
                <>
                  <Button variant="outline" size="sm" onClick={() => loadLogs(null)} disabled={busy} className="gap-1.5">
                    <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                    Refresh
                  </Button>
                  {canExport && (
                    <Button variant="outline" size="sm" onClick={exportExcel} disabled={isExporting || filtered.length === 0} className="gap-1.5">
                      {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      Export Excel
                    </Button>
                  )}
                </>
              }
            >
              <Input type="date" aria-label="From date" title="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <Input type="date" aria-label="To date" title="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger aria-label="User" className="sm:max-w-[16rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All users</SelectItem>
                  {userOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger aria-label="Action" className="sm:max-w-[16rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All actions</SelectItem>
                  {actionOptions.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={changesOnly ? 'changes' : 'all'} onValueChange={(v) => setChangesOnly(v === 'changes')}>
                <SelectTrigger aria-label="Changes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All events</SelectItem>
                  <SelectItem value="changes">Changes only</SelectItem>
                </SelectContent>
              </Select>
            </FilterBar>
            <p className="text-[11px] text-muted-foreground">
              Dates filter the whole history. User, action, changes and search narrow the events already loaded —
              use <strong>Load more</strong> to reach further back. Click a row for the full before → after.
            </p>
          </div>
        }
        footer={
          !isLoading ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{logs.length.toLocaleString('en-IN')} loaded{hasMore ? ', more available' : ', all loaded'}</span>
              {hasMore && (
                <Button variant="outline" size="sm" onClick={() => loadLogs(lastDoc)} disabled={busy || !lastDoc} className="gap-1.5">
                  {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isLoadingMore ? 'Loading…' : `Load ${PAGE_SIZE} more`}
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-slate-600">No activity found</p>
            <p className="text-xs text-muted-foreground">
              {activeFilterCount > 0 || search ? 'Try adjusting your filters, or load more to search further back.' : 'Actions in this module will appear here.'}
            </p>
          </div>
        ) : (
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 pr-0" aria-label="Expand" />
                <TableHead className="whitespace-nowrap">When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>What changed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((log) => {
                const expanded = expandedIds.has(log.id);
                const href = log.recordRef ? recordHref?.(log) : null;
                return (
                  <Fragment key={log.id}>
                    <TableRow
                      className={cn('cursor-pointer align-top', expanded && 'bg-slate-50')}
                      onClick={() => toggleExpanded(log.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleExpanded(log.id);
                        }
                      }}
                      tabIndex={0}
                      aria-expanded={expanded}
                    >
                      <TableCell className="w-8 pr-0">
                        {expanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">{formatWhen(log)}</TableCell>
                      <TableCell className="min-w-[160px]">
                        <div className="font-medium">{userLabel(log)}</div>
                        {log.userEmail && log.userName && (
                          <div className="max-w-[200px] truncate text-[11px] text-muted-foreground" title={log.userEmail}>{log.userEmail}</div>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[150px] max-w-[240px]">
                        <ActionPill action={log.action} />
                      </TableCell>
                      <TableCell className="min-w-[120px] max-w-[220px] text-xs">
                        {log.recordRef ? (
                          href ? (
                            <Link
                              href={href}
                              onClick={(e) => e.stopPropagation()}
                              className="break-words font-mono font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {log.recordRef}
                            </Link>
                          ) : (
                            <span className="break-words font-mono">{log.recordRef}</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[220px] max-w-[420px] text-xs">
                        <span className="line-clamp-2 break-words" title={summaryOf(log)}>{summaryOf(log)}</span>
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                        <TableCell colSpan={6} className="px-4 py-3">
                          {renderExpanded(log)}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}
