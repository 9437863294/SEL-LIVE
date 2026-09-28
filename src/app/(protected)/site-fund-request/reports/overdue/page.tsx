'use client';

import { useState, useEffect, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { AlertTriangle, Download, Loader2, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { db } from '@/lib/firebase';
import type { Requisition, Project, Department, User } from '@/lib/types';
import { withDesignations } from '@/lib/people-directory-client';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useSFRProjectAccess } from '@/hooks/useSFRProjectAccess';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';

// ─── helpers ─────────────────────────────────────────────────────────────────

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);

function daysOverdue(deadlineDate: Date, now: Date): number {
  return Math.ceil((now.getTime() - deadlineDate.getTime()) / 86_400_000);
}

/** Over a month late reads as danger; anything less is a warning. */
function overdueTone(days: number): StatusTone {
  return days > 30 ? 'danger' : 'warning';
}

// ─── component ───────────────────────────────────────────────────────────────

export default function OverdueRequestsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Site Fund Request.Reports');
  const accessData = useSFRProjectAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [requests, setRequests] = useState<Requisition[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [filterProject, setFilterProject] = useState('all');
  const [filterDept, setFilterDept] = useState('all');
  const [filterStage, setFilterStage] = useState('all');

  // ── fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAuthLoading || accessData.isLoading) return;
    if (!canView) { setIsLoading(false); return; }
    const load = async () => {
      setIsLoading(true);
      try {
        const [reqSnap, projSnap, deptSnap, userSnap] = await Promise.all([
          getDocs(collection(db, 'siteFundRequests')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
          getDocs(collection(db, 'users')),
        ]);
        const allDocs = reqSnap.docs.map(d => ({ id: d.id, ...d.data() } as Requisition));
        let filteredByAccess = allDocs;
        if (!accessData.canViewAll && accessData.accessibleProjectIds !== null) {
          filteredByAccess = allDocs.filter(r => accessData.accessibleProjectIds!.has(r.projectId));
        }
        setRequests(filteredByAccess);
        setProjects(projSnap.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
        setDepartments(deptSnap.docs.map(d => ({ id: d.id, ...d.data() } as Department)));
        setUsers(await withDesignations(userSnap.docs.map(d => ({ id: d.id, ...d.data() } as User))));
      } catch (err) {
        console.error('Failed to load overdue report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView, accessData.isLoading, accessData.canViewAll]);

  // ── derived ────────────────────────────────────────────────────────────────
  const now = useMemo(() => new Date(), []);

  const projectMap = useMemo(() => {
    const m: Record<string, string> = {};
    projects.forEach(p => { m[p.id] = p.projectName; });
    return m;
  }, [projects]);

  const deptMap = useMemo(() => {
    const m: Record<string, string> = {};
    departments.forEach(d => { m[d.id] = d.name; });
    return m;
  }, [departments]);

  const userMap = useMemo(() => {
    const m: Record<string, string> = {};
    users.forEach(u => { m[u.id] = u.name; });
    return m;
  }, [users]);

  // All overdue requests (before UI filters)
  const allOverdue = useMemo(() =>
    requests.filter(r =>
      r.status !== 'Completed' &&
      r.status !== 'Rejected' &&
      r.deadline !== null &&
      r.deadline != null &&
      r.deadline.toDate() < now
    ),
    [requests, now]);

  // Unique stages from overdue set
  const stageOptions = useMemo(() => {
    const set = new Set<string>();
    allOverdue.forEach(r => { if (r.stage) set.add(r.stage); });
    return Array.from(set).sort();
  }, [allOverdue]);

  // Filtered with UI controls
  const filtered = useMemo(() => allOverdue.filter(r => {
    if (filterProject !== 'all' && r.projectId !== filterProject) return false;
    if (filterDept !== 'all' && r.departmentId !== filterDept) return false;
    if (filterStage !== 'all' && r.stage !== filterStage) return false;
    return true;
  }), [allOverdue, filterProject, filterDept, filterStage]);

  const totalAmount = useMemo(() => filtered.reduce((s, r) => s + (r.amount || 0), 0), [filtered]);

  const avgDaysOverdue = useMemo(() => {
    if (filtered.length === 0) return 0;
    const total = filtered.reduce((s, r) => s + daysOverdue(r.deadline!.toDate(), now), 0);
    return Math.round(total / filtered.length);
  }, [filtered, now]);

  // ── export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Overdue Requests');
      ws.addRow([
        'Request ID', 'Date', 'Project', 'Department', 'Party Name',
        'Amount', 'Stage', 'Assigned To', 'Deadline', 'Days Overdue',
      ]);
      ws.getRow(1).font = { bold: true };
      filtered.forEach(r => {
        ws.addRow([
          r.requisitionId,
          r.date,
          projectMap[r.projectId] || r.projectId,
          deptMap[r.departmentId] || r.departmentId,
          r.partyName,
          r.amount,
          r.stage,
          (r.assignees || []).map(id => userMap[id] || id).join(', '),
          r.deadline ? r.deadline.toDate().toLocaleDateString('en-IN') : '',
          r.deadline ? daysOverdue(r.deadline.toDate(), now) : '',
        ]);
      });
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'overdue-requests.xlsx'; a.click();
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
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
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
          title="Overdue Requests"
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
        title="Overdue Requests"
        description="Active requests that have exceeded their deadline."
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

      {/* Filters — they drive the stats and the table */}
      <FilterBar
        activeCount={[filterProject, filterDept, filterStage].filter(v => v !== 'all').length}
        onClear={() => { setFilterProject('all'); setFilterDept('all'); setFilterStage('all'); }}
      >
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger aria-label="Project"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterDept} onValueChange={setFilterDept}>
          <SelectTrigger aria-label="Department"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStage} onValueChange={setFilterStage}>
          <SelectTrigger aria-label="Stage"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {stageOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBar>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Overdue', value: filtered.length.toString(), gradient: 'from-rose-400 to-red-400' },
          { label: 'Total Amount at Risk', value: formatCurrency(totalAmount), gradient: 'from-orange-400 to-amber-400' },
          { label: 'Avg Days Overdue', value: `${avgDaysOverdue} days`, gradient: 'from-red-400 to-rose-400' },
        ].map(card => (
          <Card key={card.label} className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_18px_60px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
            <div className={`h-1.5 w-full bg-gradient-to-r ${card.gradient} opacity-70`} />
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-xl font-bold text-slate-800">{card.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <TableCard
        title="Overdue Requests"
        description={<>{filtered.length} record{filtered.length !== 1 ? 's' : ''} found</>}
      >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <AlertTriangle className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No overdue requests for the selected filters.</p>
            </div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      'Request ID', 'Date', 'Project', 'Department', 'Party Name',
                      'Amount', 'Stage', 'Assigned To', 'Deadline', 'Days Overdue',
                    ].map(h => (
                      <TableHead key={h} className={h === 'Amount' ? 'text-right' : undefined}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => {
                    const deadlineDate = r.deadline!.toDate();
                    const days = daysOverdue(deadlineDate, now);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono font-medium whitespace-nowrap">
                          {r.requisitionId}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                        <TableCell>{projectMap[r.projectId] || r.projectId}</TableCell>
                        <TableCell>{deptMap[r.departmentId] || r.departmentId}</TableCell>
                        <TableCell>{r.partyName}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {formatCurrency(r.amount)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant="neutral">{r.stage}</Badge>
                        </TableCell>
                        <TableCell>
                          {(r.assignees || []).map(id => userMap[id] || id).join(', ') || '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {deadlineDate.toLocaleDateString('en-IN')}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <StatusBadge status="Overdue" tone={overdueTone(days)}>{days}d</StatusBadge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
          )}
      </TableCard>
    </div>
  );
}
