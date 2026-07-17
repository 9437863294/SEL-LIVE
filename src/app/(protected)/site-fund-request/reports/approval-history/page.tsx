'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { ArrowLeft, Download, Loader2, ScrollText, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { Requisition, Project } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useSFRProjectAccess } from '@/hooks/useSFRProjectAccess';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

// ─── helpers ─────────────────────────────────────────────────────────────────

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);

function getFYFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-indexed
  if (m >= 4) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

function currentFY(): string {
  return getFYFromDate(new Date());
}

const MONTHS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
];

const APPROVE_KEYWORDS = ['approv', 'complet', 'verif', 'done', 'forward'];

function classifyAction(action: string): 'Approve' | 'Reject' | 'Other' {
  const a = action.toLowerCase();
  if (a.includes('reject')) return 'Reject';
  if (APPROVE_KEYWORDS.some(k => a.includes(k))) return 'Approve';
  return 'Other';
}

const ACTION_TYPE_OPTIONS = [
  { value: 'all', label: 'All Actions' },
  { value: 'Approve', label: 'Approve' },
  { value: 'Reject', label: 'Reject' },
  { value: 'Other', label: 'Other' },
] as const;

const ACTION_BADGE: Record<'Approve' | 'Reject' | 'Other', string> = {
  Approve: 'bg-green-100 text-green-700',
  Reject: 'bg-red-100 text-red-700',
  Other: 'bg-slate-100 text-slate-600',
};

// ─── types ────────────────────────────────────────────────────────────────────

interface FlatEntry {
  reqId: string;
  requisitionId: string;
  projectId: string;
  projectName: string;
  amount: number;
  action: string;
  actionType: 'Approve' | 'Reject' | 'Other';
  stepName: string;
  userName: string;
  comment: string;
  timestamp: Date;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function ApprovalHistoryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Site Fund Request.Reports');
  const accessData = useSFRProjectAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [requests, setRequests] = useState<Requisition[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [filterFY, setFilterFY] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [filterActionType, setFilterActionType] = useState('all');

  // ── fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAuthLoading || accessData.isLoading) return;
    if (!canView) { setIsLoading(false); return; }
    const load = async () => {
      setIsLoading(true);
      try {
        const [reqSnap, projSnap] = await Promise.all([
          getDocs(collection(db, 'siteFundRequests')),
          getDocs(collection(db, 'projects')),
        ]);
        const allDocs = reqSnap.docs.map(d => ({ id: d.id, ...d.data() } as Requisition));
        let filteredByAccess = allDocs;
        if (!accessData.canViewAll && accessData.accessibleProjectIds !== null) {
          filteredByAccess = allDocs.filter(r => accessData.accessibleProjectIds!.has(r.projectId));
        }
        setRequests(filteredByAccess);
        setProjects(projSnap.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
      } catch (err) {
        console.error('Failed to load approval history', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView, accessData.isLoading, accessData.canViewAll]);

  // ── derived ────────────────────────────────────────────────────────────────
  const projectMap = useMemo(() => {
    const m: Record<string, string> = {};
    projects.forEach(p => { m[p.id] = p.projectName; });
    return m;
  }, [projects]);

  // Flatten all history entries
  const allEntries = useMemo<FlatEntry[]>(() => {
    const entries: FlatEntry[] = [];
    for (const req of requests) {
      const history = req.history || [];
      for (const h of history) {
        entries.push({
          reqId: req.id,
          requisitionId: req.requisitionId,
          projectId: req.projectId,
          projectName: projectMap[req.projectId] || req.projectId,
          amount: req.amount || 0,
          action: h.action,
          actionType: classifyAction(h.action),
          stepName: h.stepName,
          userName: h.userName,
          comment: h.comment,
          timestamp: h.timestamp.toDate(),
        });
      }
    }
    // Sort descending by timestamp
    return entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [requests, projectMap]);

  const fyOptions = useMemo(() => {
    const fys = new Set<string>([currentFY()]);
    allEntries.forEach(e => fys.add(getFYFromDate(e.timestamp)));
    return Array.from(fys).sort((a, b) => b.localeCompare(a));
  }, [allEntries]);

  const filtered = useMemo<FlatEntry[]>(() => allEntries.filter(e => {
    if (filterFY !== 'all' && getFYFromDate(e.timestamp) !== filterFY) return false;
    if (filterMonth !== 'all' && String(e.timestamp.getMonth() + 1) !== filterMonth) return false;
    if (filterProject !== 'all' && e.projectId !== filterProject) return false;
    if (filterActionType !== 'all' && e.actionType !== filterActionType) return false;
    return true;
  }), [allEntries, filterFY, filterMonth, filterProject, filterActionType]);

  // ── export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Approval History');
      ws.addRow(['Request ID', 'Amount', 'Project', 'Step', 'Action', 'By', 'Comment', 'Date & Time']);
      ws.getRow(1).font = { bold: true };
      filtered.forEach(e => ws.addRow([
        e.requisitionId,
        e.amount,
        e.projectName,
        e.stepName,
        e.action,
        e.userName,
        e.comment,
        e.timestamp.toLocaleString('en-IN'),
      ]));
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'approval-history.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  // ── loading ────────────────────────────────────────────────────────────────
  if (isAuthLoading || accessData.isLoading || (isLoading && canView)) {
    return (
      <div className="w-full space-y-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  }

  // ── access denied ──────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="w-full space-y-4 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Link href="/site-fund-request/reports">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Site Fund Request</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Approval History</h1>
          </div>
        </div>
        <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
          <div className="h-1.5 w-full bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 opacity-70" />
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Access Denied
            </CardTitle>
            <CardDescription>You do not have permission to view this report.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-full space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/site-fund-request/reports">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Site Fund Request — Reports
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Approval History</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Complete log of all approval actions across fund requests.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || filtered.length === 0}
          className="bg-white/80 border-white/70"
        >
          {isExporting
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <Download className="mr-2 h-4 w-4" />}
          {isExporting ? 'Exporting…' : 'Export Excel'}
        </Button>
      </div>

      {/* Filters */}
      <Card className="overflow-hidden bg-white/70 border border-white/70 rounded-2xl shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-slate-400 via-gray-400 to-zinc-400 opacity-70" />
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Financial Year</p>
              <Select value={filterFY} onValueChange={setFilterFY}>
                <SelectTrigger className="bg-white/80 border-white/70"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {fyOptions.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Month</p>
              <Select value={filterMonth} onValueChange={setFilterMonth}>
                <SelectTrigger className="bg-white/80 border-white/70"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Project</p>
              <Select value={filterProject} onValueChange={setFilterProject}>
                <SelectTrigger className="bg-white/80 border-white/70"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Action Type</p>
              <Select value={filterActionType} onValueChange={setFilterActionType}>
                <SelectTrigger className="bg-white/80 border-white/70"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_TYPE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-slate-400 via-gray-400 to-zinc-400 opacity-70" />
        <CardHeader className="p-4 pb-2 flex-row items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">Action Log</CardTitle>
            <CardDescription>Sorted by most recent action first.</CardDescription>
          </div>
          <Badge variant="secondary" className="text-sm px-3 py-1">
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'} found
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <ScrollText className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-slate-500">No action log entries match the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-auto rounded-b-2xl border-t border-white/70 bg-white/80 max-h-[calc(100vh-400px)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 sticky top-0 z-10">
                    {['Request ID', 'Amount', 'Project', 'Step', 'Action', 'By', 'Comment', 'Date & Time'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e, idx) => (
                    <tr key={`${e.reqId}-${e.timestamp.getTime()}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800 whitespace-nowrap">
                        {e.requisitionId}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900 whitespace-nowrap">
                        {formatCurrency(e.amount)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{e.projectName}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{e.stepName}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${ACTION_BADGE[e.actionType]}`}>
                          {e.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{e.userName}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs truncate">
                        {e.comment || <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {e.timestamp.toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit', hour12: true,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
