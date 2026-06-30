'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import {
  collection, getDocs, limit, orderBy,
  query, startAfter, QueryDocumentSnapshot, where,
} from 'firebase/firestore';
import {
  Activity, ArrowLeft, Download, Filter,
  Loader2, RefreshCw, Search, X,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ─── types ────────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  module: string;
  action: string;
  details: Record<string, any>;
  sessionId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: { seconds: number; nanoseconds: number } | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const formatTimestamp = (ts: AuditLog['timestamp']): string => {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const formatDetails = (details: Record<string, any>): string => {
  if (!details || Object.keys(details).length === 0) return '—';
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
};

const MODULE_COLORS: Record<string, string> = {
  'Vehicle Management':    'bg-cyan-50 text-cyan-700 border-cyan-200',
  'Daily Requisition':     'bg-violet-50 text-violet-700 border-violet-200',
  'Billing Recon':         'bg-blue-50 text-blue-700 border-blue-200',
  'Expenses':              'bg-amber-50 text-amber-700 border-amber-200',
  'Bank Balance':          'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Loan':                  'bg-teal-50 text-teal-700 border-teal-200',
  'Insurance':             'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Settings':              'bg-slate-100 text-slate-700 border-slate-200',
  'Daily Requisition Settings': 'bg-purple-50 text-purple-700 border-purple-200',
  'Site Fund Requisition': 'bg-orange-50 text-orange-700 border-orange-200',
  'Subcontractors':        'bg-rose-50 text-rose-700 border-rose-200',
  'Employee':              'bg-green-50 text-green-700 border-green-200',
  'Driver Management':     'bg-sky-50 text-sky-700 border-sky-200',
};

const moduleBadgeClass = (module: string) =>
  MODULE_COLORS[module] ?? 'bg-slate-50 text-slate-600 border-slate-200';

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Settings.User Management') || can('View', 'Settings.Role Management');

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // ── filters ──
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // ── unique modules from loaded logs ──
  const availableModules = useMemo(() => {
    const s = new Set(logs.map((l) => l.module).filter(Boolean));
    return ['All', ...Array.from(s).sort()];
  }, [logs]);

  // ── filtered rows ──
  const filtered = useMemo(() => {
    let rows = logs;
    if (moduleFilter !== 'All') rows = rows.filter((l) => l.module === moduleFilter);
    if (dateFrom) rows = rows.filter((l) => l.timestamp && new Date(l.timestamp.seconds * 1000) >= new Date(dateFrom));
    if (dateTo) rows = rows.filter((l) => l.timestamp && new Date(l.timestamp.seconds * 1000) <= new Date(dateTo + 'T23:59:59'));
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((l) =>
        (l.userName ?? '').toLowerCase().includes(q) ||
        (l.userEmail ?? '').toLowerCase().includes(q) ||
        (l.module ?? '').toLowerCase().includes(q) ||
        (l.action ?? '').toLowerCase().includes(q) ||
        (l.ipAddress ?? '').includes(q) ||
        formatDetails(l.details).toLowerCase().includes(q)
      );
    }
    return rows;
  }, [logs, moduleFilter, dateFrom, dateTo, search]);

  // ── load ──
  const loadLogs = async (isRefresh = true) => {
    if (isRefresh) setIsLoading(true);
    else setIsLoadingMore(true);
    try {
      const q = query(
        collection(db, 'userLogs'),
        orderBy('timestamp', 'desc'),
        ...(isRefresh ? [] : lastDoc ? [startAfter(lastDoc)] : []),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLog));
      if (isRefresh) {
        setLogs(rows);
      } else {
        setLogs((prev) => [...prev, ...rows]);
      }
      setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (canView) loadLogs();
    else setIsLoading(false);
  }, [canView]);

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
        { header: 'Module', key: 'module', width: 24 },
        { header: 'Action', key: 'action', width: 28 },
        { header: 'Details', key: 'details', width: 60 },
        { header: 'IP Address', key: 'ipAddress', width: 16 },
        { header: 'Session ID', key: 'sessionId', width: 36 },
      ];
      filtered.forEach((l) =>
        ws.addRow({
          timestamp: l.timestamp ? new Date(l.timestamp.seconds * 1000).toISOString() : '',
          userName: l.userName ?? '',
          userEmail: l.userEmail ?? '',
          module: l.module ?? '',
          action: l.action ?? '',
          details: formatDetails(l.details),
          ipAddress: l.ipAddress ?? '',
          sessionId: l.sessionId ?? '',
        })
      );
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

  if (!canView) {
    return (
      <div className="px-4 py-3 sm:px-5">
        <Card>
          <CardHeader>
            <CardTitle>Access Restricted</CardTitle>
            <CardDescription>You need User Management or Role Management permission to view audit logs.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const clearFilters = () => { setSearch(''); setModuleFilter('All'); setDateFrom(''); setDateTo(''); };
  const hasActiveFilters = search || moduleFilter !== 'All' || dateFrom || dateTo;

  return (
    <div className="space-y-4 px-4 py-3 sm:px-5">

      {/* Header */}
      <Card className="overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Link href="/settings">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-indigo-500" />
                <CardTitle className="text-lg tracking-tight">Audit Logs</CardTitle>
                {!isLoading && (
                  <Badge variant="outline" className="text-xs">
                    {filtered.length}{hasMore ? '+' : ''} records
                  </Badge>
                )}
              </div>
              <CardDescription>
                Track every action across all modules — who did what, when, and from where.
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => loadLogs(true)} disabled={isLoading} className="gap-1.5 bg-white">
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={isExporting || filtered.length === 0} className="gap-1.5 bg-white">
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export Excel
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Search + filters */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user, module, action, IP…"
              className="pl-8 bg-white/85 h-9 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}
            className={`gap-1.5 bg-white ${showFilters ? 'border-indigo-300 text-indigo-700' : ''}`}>
            <Filter className="h-3.5 w-3.5" />
            Filters {hasActiveFilters && <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">!</span>}
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </Button>
          )}
        </div>

        {showFilters && (
          <Card className="p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Module</Label>
                <Select value={moduleFilter} onValueChange={setModuleFilter}>
                  <SelectTrigger className="h-8 text-sm bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModules.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">From Date</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-sm bg-white" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To Date</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-sm bg-white" />
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Activity className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-slate-600">No audit logs found</p>
              <p className="text-xs text-muted-foreground">
                {hasActiveFilters ? 'Try adjusting your filters.' : 'Actions across all modules will appear here.'}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile log list */}
              <div className="space-y-2 sm:hidden p-3">
                {filtered.map(log => (
                  <div key={log.id} className="rounded-xl border bg-white/80 p-3 space-y-1.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-slate-800">{log.action}</span>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${moduleBadgeClass(log.module)}`}>{log.module || '—'}</Badge>
                    </div>
                    <p className="text-muted-foreground">{log.userName ?? log.userId?.slice(0, 8) ?? '—'} · {formatTimestamp(log.timestamp)}</p>
                    {log.ipAddress && <p className="font-mono text-muted-foreground">{log.ipAddress}</p>}
                    <p className="text-muted-foreground leading-relaxed">{formatDetails(log.details)}</p>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block overflow-auto h-[calc(100vh-340px)]">
                <table className="w-full caption-bottom text-sm">
                  <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-sm">
                    <TableRow>
                      <TableHead className="w-[160px]">Timestamp</TableHead>
                      <TableHead className="w-[160px]">User</TableHead>
                      <TableHead className="w-[140px]">Module</TableHead>
                      <TableHead className="w-[160px]">Action</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead className="w-[110px]">IP Address</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((log) => (
                      <TableRow key={log.id} className="hover:bg-muted/30 transition-colors align-top">
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap py-2.5">
                          {formatTimestamp(log.timestamp)}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="space-y-0.5">
                            <p className="text-xs font-medium text-slate-800 leading-tight">
                              {log.userName ?? log.userId?.slice(0, 8) ?? '—'}
                            </p>
                            {log.userEmail && (
                              <p className="text-[11px] text-muted-foreground truncate max-w-[140px]">{log.userEmail}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${moduleBadgeClass(log.module)}`}>
                            {log.module || '—'}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-xs font-medium text-slate-700">{log.action}</span>
                        </TableCell>
                        <TableCell className="py-2.5 max-w-[320px]">
                          <p className="text-[11px] text-muted-foreground leading-relaxed break-words">
                            {formatDetails(log.details)}
                          </p>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {log.ipAddress ?? '—'}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            </>
          )}

          {/* Load more */}
          {!isLoading && hasMore && (
            <div className="flex items-center justify-center border-t p-3">
              <Button variant="outline" size="sm" onClick={() => loadLogs(false)} disabled={isLoadingMore} className="gap-1.5">
                {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isLoadingMore ? 'Loading…' : `Load ${PAGE_SIZE} More`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
