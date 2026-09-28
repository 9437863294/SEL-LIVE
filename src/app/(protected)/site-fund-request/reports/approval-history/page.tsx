'use client';

import { useState, useEffect, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Download, Loader2, ScrollText, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { db } from '@/lib/firebase';
import type { Requisition, Project } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useSFRProjectAccess } from '@/hooks/useSFRProjectAccess';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';

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

const ACTION_TONE: Record<'Approve' | 'Reject' | 'Other', StatusTone> = {
  Approve: 'success',
  Reject: 'danger',
  Other: 'neutral',
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
        <PageHeader
          backHref="/site-fund-request/reports"
          backLabel="Back to reports"
          eyebrow="Site Fund Request"
          title="Approval History"
        />
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
      <PageHeader
        backHref="/site-fund-request/reports"
        backLabel="Back to reports"
        eyebrow="Site Fund Request — Reports"
        title="Approval History"
        description="Complete log of all approval actions across fund requests."
        actions={
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
        }
      />

      {/* Table */}
      <TableCard
        title="Action Log"
        description="Sorted by most recent action first."
        count={filtered.length}
        toolbar={
          <FilterBar
            activeCount={[filterFY, filterMonth, filterProject, filterActionType].filter(v => v !== 'all').length}
            onClear={() => { setFilterFY('all'); setFilterMonth('all'); setFilterProject('all'); setFilterActionType('all'); }}
          >
            <Select value={filterFY} onValueChange={setFilterFY}>
              <SelectTrigger aria-label="Financial Year"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {fyOptions.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger aria-label="Month"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger aria-label="Project"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterActionType} onValueChange={setFilterActionType}>
              <SelectTrigger aria-label="Action Type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_TYPE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <ScrollText className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No action log entries match the selected filters.</p>
            </div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {['Request ID', 'Amount', 'Project', 'Step', 'Action', 'By', 'Comment', 'Date & Time'].map(h => (
                      <TableHead key={h} className={h === 'Amount' ? 'text-right' : undefined}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e, idx) => (
                    <TableRow key={`${e.reqId}-${e.timestamp.getTime()}-${idx}`}>
                      <TableCell className="font-mono font-medium whitespace-nowrap">
                        {e.requisitionId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {formatCurrency(e.amount)}
                      </TableCell>
                      <TableCell>{e.projectName}</TableCell>
                      <TableCell className="whitespace-nowrap">{e.stepName}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={e.action} tone={ACTION_TONE[e.actionType]}>
                          {e.action}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{e.userName}</TableCell>
                      <TableCell className="max-w-xs truncate">
                        {e.comment || <span className="text-muted-foreground italic">—</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {e.timestamp.toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit', hour12: true,
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          )}
      </TableCard>
    </div>
  );
}
