'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import {
  collection, getDocs, limit, orderBy,
  query, startAfter, QueryDocumentSnapshot, Timestamp, where,
  type QueryConstraint,
} from 'firebase/firestore';
import {
  Activity, ChevronDown, ChevronRight, Columns3, Download,
  Loader2, RefreshCw, X,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { FilterBar } from '@/components/shared/filter-bar';
import { TableCard } from '@/components/shared/table-card';
import { db } from '@/lib/firebase';
import { ACTIVITY_MODULE_NAMES, canonicalModuleName } from '@/lib/activity-modules';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  module: string;
  action: string;
  details: Record<string, any>;
  recordId: string | null;
  recordRef: string | null;
  /** Set on server-written rows: 'server' | 'api' | 'cron' | 'webhook'. */
  source?: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: { seconds: number; nanoseconds: number } | null;
}

interface UserOption {
  id: string;
  label: string;
}

type SortKey = 'newest' | 'oldest' | 'user' | 'module' | 'action';

// ─── helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZES = [50, 100, 250, 500] as const;
/** "Load all" stops here so an unbounded query cannot exhaust the browser. */
const LOAD_ALL_CAP = 10_000;
const COLUMNS_STORAGE_KEY = 'audit-logs.hidden-columns';
const FIXED_HEADERS = new Set([
  '', 'Timestamp', 'User', 'Module', 'Action', 'Record', 'Changes', 'Source', 'IP Address', 'Device', 'Session',
]);

const SOURCE_OPTIONS = [
  { value: 'All', label: 'All sources' },
  { value: 'user', label: 'User (browser)' },
  { value: 'server', label: 'Server' },
  { value: 'api', label: 'API' },
  { value: 'cron', label: 'Cron' },
  { value: 'webhook', label: 'Webhook' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'user', label: 'User A–Z' },
  { value: 'module', label: 'Module A–Z' },
  { value: 'action', label: 'Action A–Z' },
];

const toDate = (ts: AuditLog['timestamp']): Date | null => (ts ? new Date(ts.seconds * 1000) : null);

const formatTimestamp = (ts: AuditLog['timestamp']): string => {
  const d = toDate(ts);
  return d ? format(d, 'dd MMM yyyy, HH:mm:ss') : '—';
};

const sourceOf = (l: AuditLog): string => l.source ?? 'user';

const displayValue = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** `key: value · key: value` — the searchable, exportable flat form. */
const formatDetails = (details: Record<string, any>): string => {
  if (!details || Object.keys(details).length === 0) return '—';
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
};

/** Update logs carry `details.changes` as `{ field: { from, to } }` (see diffFields). */
const changesOf = (details: Record<string, any>): Array<[string, { from: unknown; to: unknown }]> => {
  const changes = details?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return [];
  return Object.entries(changes).filter(
    ([, c]) => c && typeof c === 'object' && ('from' in (c as object) || 'to' in (c as object)),
  ) as Array<[string, { from: unknown; to: unknown }]>;
};

/** "Chrome · Windows" from a raw user-agent — enough to tell devices apart in a row. */
const shortDevice = (ua: string | null): string => {
  if (!ua) return '—';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
      : /OPR\/|Opera/.test(ua) ? 'Opera'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari'
              : /node|axios|curl|undici/i.test(ua) ? 'Server'
                : 'Other';
  const os =
    /Windows/.test(ua) ? 'Windows'
      : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
          : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
            : /Linux/.test(ua) ? 'Linux'
              : '';
  return os ? `${browser} · ${os}` : browser;
};

/** "previousAmount" / "previous_amount" → "Previous Amount". */
const humanize = (key: string): string =>
  key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const hasValue = (v: unknown) => v !== null && v !== undefined && v !== '';

interface DetailField {
  key: string;
  header: string;
  numeric: boolean;
}

/**
 * One column per key found in the rows' `details`, most common first, so
 * `category · amount · project` reads as a table rather than a run-on line.
 * `changes` is left out — it has its own column. Headers that would collide with
 * a fixed column get a suffix, since DataList keys cells by header.
 */
const detailFieldsOf = (rows: AuditLog[], reserved: Set<string>): DetailField[] => {
  const stats = new Map<string, { count: number; numeric: boolean }>();
  rows.forEach((l) => {
    Object.entries(l.details ?? {}).forEach(([k, v]) => {
      if (k === 'changes' || !hasValue(v)) return;
      const s = stats.get(k) ?? { count: 0, numeric: true };
      s.count += 1;
      if (typeof v !== 'number') s.numeric = false;
      stats.set(k, s);
    });
  });
  const used = new Set(reserved);
  return [...stats.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([key, s]) => {
      let header = humanize(key) || key;
      if (used.has(header)) header = `${header} (detail)`;
      while (used.has(header)) header = `${header}·`;
      used.add(header);
      return { key, header, numeric: s.numeric };
    });
};

const userLabel = (l: AuditLog): string => l.userName ?? l.userEmail ?? l.userId?.slice(0, 8) ?? '—';

const toRows = (docs: QueryDocumentSnapshot[]): AuditLog[] => docs.map((d) => {
  const data = d.data();
  // Old rows carry module names written before the registry existed; resolve
  // them so they group and colour with the current name.
  return { id: d.id, ...data, module: canonicalModuleName(data.module) } as AuditLog;
});

const loadErrorMessage = (err: unknown): string => {
  console.error('Failed to load audit logs', err);
  return (err as { code?: string }).code === 'failed-precondition'
    ? 'This filter combination needs a Firestore index that has not been deployed yet. Run: firebase deploy --only firestore:indexes'
    : 'Could not load audit logs. Check your connection and try again.';
};

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Settings.Audit Logs') || can('View', 'Settings.User Management') || can('View', 'Settings.Role Management');

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pageSize, setPageSize] = useState<number>(100);
  const cancelLoadAll = useRef(false);

  // ── server-side filters (whole collection) ──
  const [moduleFilter, setModuleFilter] = useState('All');
  const [userFilter, setUserFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // ── client-side filters (loaded rows) ──
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [recordFilter, setRecordFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [changesOnly, setChangesOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(['Session', 'Device']));

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (saved) setHiddenColumns(new Set(JSON.parse(saved) as string[]));
    } catch { /* a bad saved value just falls back to the default */ }
  }, []);

  const toggleColumn = (header: string, visible: boolean) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(header); else next.add(header);
      try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
  };

  // ── module options ──
  // Sourced from the registry rather than from the loaded rows. Deriving them from
  // `logs` meant a module could only be filtered for once one of its actions
  // happened to be on the current page, so the rarely-used modules a reviewer most
  // wants to audit were the ones missing from the dropdown.
  const availableModules = useMemo(
    () => ['All', ...[...ACTIVITY_MODULE_NAMES].sort()],
    [],
  );

  // ── user options ──
  // Every user in the directory, plus any actor seen in the loaded rows that is not
  // in it (system/cron writers, deleted users), so each one can be filtered for.
  const [directoryUsers, setDirectoryUsers] = useState<UserOption[]>([]);
  useEffect(() => {
    if (!canView) return;
    getDocs(collection(db, 'users'))
      .then((snap) => {
        setDirectoryUsers(snap.docs.map((d) => {
          const data = d.data();
          const name = data.name || data.displayName || '';
          const email = data.email || '';
          return { id: d.id, label: name && email ? `${name} (${email})` : name || email || d.id };
        }));
      })
      .catch((err) => console.warn('Audit logs: could not load the user directory', err));
  }, [canView]);

  const userOptions = useMemo(() => {
    const byId = new Map<string, string>();
    directoryUsers.forEach((u) => byId.set(u.id, u.label));
    logs.forEach((l) => {
      if (l.userId && !byId.has(l.userId)) {
        byId.set(l.userId, l.userName && l.userEmail ? `${l.userName} (${l.userEmail})` : userLabel(l));
      }
    });
    return [...byId.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [directoryUsers, logs]);

  const actionOptions = useMemo(
    () => [...new Set(logs.map((l) => l.action).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [logs],
  );

  // ── filtered + sorted rows ──
  // Module, user and date are applied by the Firestore query (see loadLogs), so they
  // hold across the whole collection. Everything else narrows the loaded rows —
  // Firestore has no substring operator, and every further equality filter would
  // need its own composite index per combination. "Load all" pulls the full result
  // of the server filters in so these cover it too.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rec = recordFilter.trim().toLowerCase();
    const ip = ipFilter.trim().toLowerCase();
    const rows = logs.filter((l) => {
      if (actionFilter !== 'All' && l.action !== actionFilter) return false;
      if (sourceFilter !== 'All' && sourceOf(l) !== sourceFilter) return false;
      if (rec && !(l.recordRef ?? '').toLowerCase().includes(rec) && !(l.recordId ?? '').toLowerCase().includes(rec)) return false;
      if (ip && !(l.ipAddress ?? '').toLowerCase().includes(ip)) return false;
      if (changesOnly && changesOf(l.details).length === 0) return false;
      if (!q) return true;
      return (
        (l.userName ?? '').toLowerCase().includes(q) ||
        (l.userEmail ?? '').toLowerCase().includes(q) ||
        (l.userId ?? '').toLowerCase().includes(q) ||
        (l.module ?? '').toLowerCase().includes(q) ||
        (l.action ?? '').toLowerCase().includes(q) ||
        (l.recordRef ?? '').toLowerCase().includes(q) ||
        (l.recordId ?? '').toLowerCase().includes(q) ||
        (l.ipAddress ?? '').toLowerCase().includes(q) ||
        (l.sessionId ?? '').toLowerCase().includes(q) ||
        (l.userAgent ?? '').toLowerCase().includes(q) ||
        formatDetails(l.details).toLowerCase().includes(q)
      );
    });
    const time = (l: AuditLog) => l.timestamp?.seconds ?? 0;
    const text = (a: string, b: string) => a.localeCompare(b);
    switch (sortKey) {
      case 'oldest': return [...rows].sort((a, b) => time(a) - time(b));
      case 'user': return [...rows].sort((a, b) => text(userLabel(a), userLabel(b)) || time(b) - time(a));
      case 'module': return [...rows].sort((a, b) => text(a.module ?? '', b.module ?? '') || time(b) - time(a));
      case 'action': return [...rows].sort((a, b) => text(a.action ?? '', b.action ?? '') || time(b) - time(a));
      default: return rows; // the query already returns newest first
    }
  }, [logs, search, actionFilter, sourceFilter, recordFilter, ipFilter, changesOnly, sortKey]);

  // Taken from the filtered rows, so narrowing to one module shows just that
  // module's fields instead of every key any module has ever written.
  const detailFields = useMemo(() => detailFieldsOf(filtered, FIXED_HEADERS), [filtered]);

  // ── load ──
  const [loadError, setLoadError] = useState<string | null>(null);

  const buildQuery = useCallback((cursor: QueryDocumentSnapshot | null, size: number) => {
    // Module, user and date bounds are pushed into the query so they filter the whole
    // collection. Each combination is covered by an index in firestore.indexes.json:
    // (timestamp), (module, timestamp), (userId, timestamp), (module, userId, timestamp).
    const constraints: QueryConstraint[] = [];
    if (moduleFilter !== 'All') constraints.push(where('module', '==', moduleFilter));
    if (userFilter !== 'All') constraints.push(where('userId', '==', userFilter));
    if (dateFrom) {
      constraints.push(where('timestamp', '>=', Timestamp.fromDate(new Date(`${dateFrom}T00:00:00`))));
    }
    if (dateTo) {
      constraints.push(where('timestamp', '<=', Timestamp.fromDate(new Date(`${dateTo}T23:59:59.999`))));
    }
    return query(
      collection(db, 'userLogs'),
      ...constraints,
      orderBy('timestamp', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(size),
    );
  }, [moduleFilter, userFilter, dateFrom, dateTo]);

  // Bumped on every fresh query, so a page that lands after the filters changed is
  // dropped instead of being appended to the new result set.
  const generation = useRef(0);

  const loadLogs = useCallback(async (isRefresh = true, cursor: QueryDocumentSnapshot | null = null) => {
    if (isRefresh) {
      generation.current += 1;
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    const gen = generation.current;
    setLoadError(null);
    try {
      const snap = await getDocs(buildQuery(cursor, pageSize));
      if (gen !== generation.current) return;
      const rows = toRows(snap.docs);
      if (isRefresh) {
        setLogs(rows);
        setExpandedIds(new Set());
      } else {
        setLogs((prev) => [...prev, ...rows]);
      }
      setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
      setHasMore(snap.docs.length === pageSize);
    } catch (err) {
      if (gen === generation.current) setLoadError(loadErrorMessage(err));
    } finally {
      if (gen === generation.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [buildQuery, pageSize]);

  /** Pages through everything the server filters match, up to LOAD_ALL_CAP rows. */
  const loadAll = async () => {
    if (isLoadingAll) return;
    cancelLoadAll.current = false;
    setIsLoadingAll(true);
    setLoadError(null);
    const gen = generation.current;
    let cursor = lastDoc;
    let count = logs.length;
    let more = hasMore;
    try {
      while (more && count < LOAD_ALL_CAP && !cancelLoadAll.current) {
        const snap = await getDocs(buildQuery(cursor, 500));
        if (gen !== generation.current) return;
        const rows = toRows(snap.docs);
        setLogs((prev) => [...prev, ...rows]);
        cursor = snap.docs[snap.docs.length - 1] ?? cursor;
        count += rows.length;
        more = snap.docs.length === 500;
      }
      setLastDoc(cursor);
      setHasMore(more);
    } catch (err) {
      if (gen === generation.current) setLoadError(loadErrorMessage(err));
    } finally {
      setIsLoadingAll(false);
    }
  };

  // Re-query whenever a server-side filter changes, resetting pagination — keeping
  // the old cursor would page into the previous filter's result set.
  useEffect(() => {
    if (canView) {
      cancelLoadAll.current = true;
      setLastDoc(null);
      void loadLogs(true, null);
    } else {
      setIsLoading(false);
    }
  }, [canView, loadLogs]);

  // ── export ──
  const exportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Audit Logs');
      ws.columns = [
        { header: 'Timestamp', key: 'timestamp', width: 22 },
        { header: 'User Name', key: 'userName', width: 22 },
        { header: 'User Email', key: 'userEmail', width: 30 },
        { header: 'User ID', key: 'userId', width: 30 },
        { header: 'Module', key: 'module', width: 24 },
        { header: 'Action', key: 'action', width: 28 },
        { header: 'Record Ref', key: 'recordRef', width: 22 },
        { header: 'Record ID', key: 'recordId', width: 24 },
        { header: 'Changes', key: 'changes', width: 50 },
        { header: 'Source', key: 'source', width: 10 },
        { header: 'IP Address', key: 'ipAddress', width: 16 },
        { header: 'Device', key: 'device', width: 18 },
        { header: 'User Agent', key: 'userAgent', width: 50 },
        { header: 'Session ID', key: 'sessionId', width: 36 },
        // One column per detail field, as on screen; keys are prefixed so a detail
        // named e.g. 'action' cannot overwrite the fixed column of that name.
        ...detailFields.map((f) => ({ header: f.header, key: `d:${f.key}`, width: f.numeric ? 14 : 24 })),
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach((l) =>
        ws.addRow({
          timestamp: formatTimestamp(l.timestamp),
          userName: l.userName ?? '',
          userEmail: l.userEmail ?? '',
          userId: l.userId ?? '',
          module: l.module ?? '',
          action: l.action ?? '',
          recordRef: l.recordRef ?? '',
          recordId: l.recordId ?? '',
          changes: changesOf(l.details).map(([f, c]) => `${f}: ${displayValue(c.from)} → ${displayValue(c.to)}`).join('\n'),
          // Blank for browser-written rows; 'cron'/'api' marks an automated action.
          source: sourceOf(l),
          ipAddress: l.ipAddress ?? '',
          device: shortDevice(l.userAgent),
          userAgent: l.userAgent ?? '',
          sessionId: l.sessionId ?? '',
          ...Object.fromEntries(detailFields.map((f) => {
            const v = l.details?.[f.key];
            return [`d:${f.key}`, !hasValue(v) ? '' : typeof v === 'number' ? v : displayValue(v)];
          })),
        })
      );
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  const toggleExpanded = (log: AuditLog) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(log.id)) next.delete(log.id); else next.add(log.id);
      return next;
    });
  };

  // ── columns ──
  const allColumns: Array<ListColumn<AuditLog>> = [
    {
      header: '',
      mobile: 'omit',
      className: 'w-8 pr-0',
      cell: (log) => expandedIds.has(log.id)
        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-label="Collapse" />
        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-label="Expand" />,
    },
    {
      header: 'Timestamp',
      className: 'whitespace-nowrap tabular-nums',
      cell: (log) => formatTimestamp(log.timestamp),
    },
    {
      header: 'User',
      className: 'min-w-[160px]',
      cell: (log) => (
        <div className="space-y-0.5">
          <div className="font-medium">{userLabel(log)}</div>
          {log.userEmail && log.userName && (
            <div className="max-w-[200px] truncate text-[11px] text-muted-foreground" title={log.userEmail}>{log.userEmail}</div>
          )}
        </div>
      ),
    },
    {
      header: 'Module',
      mobile: 'aside',
      className: 'whitespace-nowrap',
      cell: (log) => <Badge variant="neutral">{log.module || '—'}</Badge>,
    },
    {
      header: 'Action',
      mobile: 'title',
      className: 'min-w-[140px] font-medium',
      cell: (log) => log.action || '—',
    },
    {
      header: 'Record',
      className: 'min-w-[120px]',
      cell: (log) => (log.recordRef || log.recordId) ? (
        <div className="space-y-0.5">
          <div>{log.recordRef ?? '—'}</div>
          {log.recordId && log.recordId !== log.recordRef && (
            <div className="max-w-[160px] truncate font-mono text-[10px] text-muted-foreground" title={log.recordId}>{log.recordId}</div>
          )}
        </div>
      ) : '—',
    },
    {
      header: 'Changes',
      className: 'min-w-[180px] max-w-[320px]',
      cell: (log) => {
        const changes = changesOf(log.details);
        if (!changes.length) return '—';
        return (
          <div className="line-clamp-3 whitespace-normal break-words text-xs">
            {changes.map(([f, c], i) => (
              <Fragment key={f}>
                {i > 0 && <span className="text-muted-foreground"> · </span>}
                <span className="font-medium">{humanize(f)}</span>{' '}
                <span className="text-red-700">{displayValue(c.from)}</span>
                <span className="text-muted-foreground"> → </span>
                <span className="text-emerald-700">{displayValue(c.to)}</span>
              </Fragment>
            ))}
          </div>
        );
      },
    },
    ...detailFields.map((f): ListColumn<AuditLog> => ({
      header: f.header,
      align: f.numeric ? 'right' : 'left',
      className: cn('text-xs', f.numeric ? 'whitespace-nowrap tabular-nums' : 'min-w-[110px] max-w-[260px]'),
      cell: (log) => {
        const v = log.details?.[f.key];
        if (!hasValue(v)) return <span className="text-muted-foreground">—</span>;
        if (typeof v === 'number') return v.toLocaleString('en-IN');
        const text = displayValue(v);
        return <span className="line-clamp-2 whitespace-normal break-words" title={text}>{text}</span>;
      },
    })),
    {
      header: 'Source',
      className: 'whitespace-nowrap',
      cell: (log) => <Badge variant={sourceOf(log) === 'user' ? 'outline' : 'neutral'} className="capitalize">{sourceOf(log)}</Badge>,
    },
    {
      header: 'IP Address',
      className: 'whitespace-nowrap font-mono text-xs',
      cell: (log) => log.ipAddress ?? '—',
    },
    {
      header: 'Device',
      mobile: 'omit',
      className: 'whitespace-nowrap text-xs',
      cell: (log) => <span title={log.userAgent ?? undefined}>{shortDevice(log.userAgent)}</span>,
    },
    {
      header: 'Session',
      mobile: 'omit',
      className: 'font-mono text-[10px]',
      cell: (log) => log.sessionId
        ? <span className="block max-w-[120px] truncate" title={log.sessionId}>{log.sessionId}</span>
        : '—',
    },
  ];
  const toggleableHeaders = allColumns.map((c) => c.header).filter((h) => FIXED_HEADERS.has(h) && h && h !== 'Action');
  const columns = allColumns.filter((c) => !hiddenColumns.has(c.header));

  const renderExpanded = (log: AuditLog) => {
    const changes = changesOf(log.details);
    const rest = Object.entries(log.details ?? {}).filter(([k]) => !(k === 'changes' && changes.length));
    const meta: Array<[string, string]> = [
      ['Timestamp', formatTimestamp(log.timestamp)],
      ['User', log.userName ?? '—'],
      ['Email', log.userEmail ?? '—'],
      ['User ID', log.userId ?? '—'],
      ['Module', log.module ?? '—'],
      ['Action', log.action ?? '—'],
      ['Record Ref', log.recordRef ?? '—'],
      ['Record ID', log.recordId ?? '—'],
      ['Source', sourceOf(log)],
      ['IP Address', log.ipAddress ?? '—'],
      ['Session ID', log.sessionId ?? '—'],
      ['Log ID', log.id],
    ];
    return (
      <div className="grid grid-cols-1 gap-4 p-3 text-xs sm:p-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
            {meta.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="font-medium text-muted-foreground">{k}</dt>
                <dd className="break-all text-slate-800">{v}</dd>
              </Fragment>
            ))}
            <dt className="font-medium text-muted-foreground">User Agent</dt>
            <dd className="break-all text-slate-800">{log.userAgent ?? '—'}</dd>
          </dl>
        </div>
        <div className="min-w-0 space-y-3">
          {changes.length > 0 && (
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
                      <td className="px-2 py-1.5 font-medium">{field}</td>
                      <td className="break-all px-2 py-1.5 text-red-700">{displayValue(c.from)}</td>
                      <td className="break-all px-2 py-1.5 text-emerald-700">{displayValue(c.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rest.length > 0 ? (
            <div className="overflow-x-auto rounded-md border bg-white">
              <table className="w-full text-left">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Detail</th>
                    <th className="px-2 py-1.5 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map(([k, v]) => (
                    <tr key={k} className="border-t align-top">
                      <td className="whitespace-nowrap px-2 py-1.5 font-medium">{k}</td>
                      <td className="px-2 py-1.5">
                        {v !== null && typeof v === 'object'
                          ? <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{JSON.stringify(v, null, 2)}</pre>
                          : <span className="break-all">{displayValue(v)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : changes.length === 0 && (
            <p className="text-muted-foreground">No details recorded.</p>
          )}
        </div>
      </div>
    );
  };

  if (isAuthLoading) {
    return (
      <div className="space-y-4 px-4 py-3 sm:px-5">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="px-4 py-3 sm:px-5">
        <Card>
          <CardHeader>
            <CardTitle>Access Restricted</CardTitle>
            <CardDescription>
              You need the <strong>Audit Logs → View</strong> permission under Settings.
              Ask an administrator to grant it in Role Management, then sign out and back in.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const clearFilters = () => {
    setSearch(''); setModuleFilter('All'); setUserFilter('All'); setDateFrom(''); setDateTo('');
    setActionFilter('All'); setSourceFilter('All'); setRecordFilter(''); setIpFilter(''); setChangesOnly(false);
  };
  const activeFilterCount =
    (moduleFilter !== 'All' ? 1 : 0) + (userFilter !== 'All' ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) +
    (actionFilter !== 'All' ? 1 : 0) + (sourceFilter !== 'All' ? 1 : 0) + (recordFilter ? 1 : 0) + (ipFilter ? 1 : 0) +
    (changesOnly ? 1 : 0);
  const hasActiveFilters = Boolean(search) || activeFilterCount > 0;
  const busy = isLoading || isLoadingMore || isLoadingAll;

  return (
    <div className="space-y-4 px-4 py-3 sm:px-5">

      <PageHeader
        icon={Activity}
        title="Audit Logs"
        description="Track every action across all modules — who did what, when, and from where."
        backHref="/settings"
        backLabel="Back to settings"
        badge={
          !isLoading ? (
            <Badge variant="neutral">
              {filtered.length} of {logs.length}{hasMore ? '+' : ''} records
            </Badge>
          ) : undefined
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => loadLogs(true, null)} disabled={busy} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={isExporting || filtered.length === 0} className="gap-1.5">
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export Excel
            </Button>
          </>
        }
      />

      {loadError && (
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="flex items-start gap-2 p-3">
            <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <p className="text-xs text-red-700">{loadError}</p>
          </CardContent>
        </Card>
      )}

      <TableCard
        toolbar={
          <div className="space-y-2">
            <FilterBar
              search={{ value: search, onChange: setSearch, placeholder: 'Search user, action, record, details, IP…' }}
              activeCount={activeFilterCount}
              onClear={clearFilters}
              summary={`${filtered.length} shown`}
              actions={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Columns3 className="h-3.5 w-3.5" />
                      Columns
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto">
                    <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {toggleableHeaders.map((h) => (
                      <DropdownMenuCheckboxItem
                        key={h}
                        checked={!hiddenColumns.has(h)}
                        onCheckedChange={(v) => toggleColumn(h, Boolean(v))}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {h}
                      </DropdownMenuCheckboxItem>
                    ))}
                    {detailFields.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Detail fields</DropdownMenuLabel>
                        {detailFields.map((f) => (
                          <DropdownMenuCheckboxItem
                            key={f.header}
                            checked={!hiddenColumns.has(f.header)}
                            onCheckedChange={(v) => toggleColumn(f.header, Boolean(v))}
                            onSelect={(e) => e.preventDefault()}
                          >
                            {f.header}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            >
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger aria-label="Module">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableModules.map((m) => (
                    <SelectItem key={m} value={m}>{m === 'All' ? 'All modules' : m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Input type="date" aria-label="From date" title="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <Input type="date" aria-label="To date" title="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger aria-label="Action" className="sm:max-w-[14rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All actions</SelectItem>
                  {actionOptions.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger aria-label="Source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Record ref / ID" aria-label="Record" value={recordFilter} onChange={(e) => setRecordFilter(e.target.value)} />
              <Input placeholder="IP address" aria-label="IP address" value={ipFilter} onChange={(e) => setIpFilter(e.target.value)} />
              <Select value={changesOnly ? 'changes' : 'all'} onValueChange={(v) => setChangesOnly(v === 'changes')}>
                <SelectTrigger aria-label="Changes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All entries</SelectItem>
                  <SelectItem value="changes">With field changes</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger aria-label="Sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterBar>
            <p className="text-[11px] text-muted-foreground">
              Module, user and dates filter the full history on the server. Action, source, record, IP,
              changes and search narrow the rows already loaded — use <strong>Load all</strong> to apply
              them to everything the server filters match. Click a row for its full details.
            </p>
          </div>
        }
        footer={
          !isLoading ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span>Rows per load</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger aria-label="Rows per load" className="h-8 w-[5.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span>{logs.length} loaded{hasMore ? ', more available' : ', all loaded'}</span>
              </div>
              {hasMore && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => loadLogs(false, lastDoc)} disabled={busy} className="gap-1.5">
                    {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {isLoadingMore ? 'Loading…' : `Load ${pageSize} more`}
                  </Button>
                  {isLoadingAll ? (
                    <Button variant="outline" size="sm" onClick={() => { cancelLoadAll.current = true; }} className="gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Stop ({logs.length})
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={loadAll} disabled={busy || logs.length >= LOAD_ALL_CAP}>
                      Load all
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
          </div>
        ) : (
          <div className="p-3 sm:p-0">
            <DataList
              frameless
              dense
              rows={filtered}
              columns={columns}
              onRowClick={toggleExpanded}
              expandedIds={expandedIds}
              renderExpanded={renderExpanded}
              empty={
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <Activity className="h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-slate-600">No audit logs found</p>
                  <p className="text-xs text-muted-foreground">
                    {hasActiveFilters ? 'Try adjusting your filters, or Load all to search further back.' : 'Actions across all modules will appear here.'}
                  </p>
                </div>
              }
            />
          </div>
        )}
      </TableCard>
    </div>
  );
}
