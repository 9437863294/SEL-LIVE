'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { ArrowLeft, Download, Loader2, ShieldAlert, Users } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { Requisition, Project } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useSFRProjectAccess } from '@/hooks/useSFRProjectAccess';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

// ─── helpers ─────────────────────────────────────────────────────────────────

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);

function getFY(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  if (m >= 4) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

function currentFY(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 4) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

const MONTHS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
];

const ALL_STATUSES: Requisition['status'][] = [
  'Pending', 'In Progress', 'Completed', 'Rejected', 'Needs Review',
];

// ─── types ────────────────────────────────────────────────────────────────────

interface PartyRow {
  partyName: string;
  totalRequests: number;
  totalAmount: number;
  pending: number;
  inProgress: number;
  completed: number;
  rejected: number;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function PartyWiseReportPage() {
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
  const [filterStatus, setFilterStatus] = useState('all');

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
        console.error('Failed to load party-wise report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView, accessData.isLoading, accessData.canViewAll]);

  // ── derived ────────────────────────────────────────────────────────────────
  const fyOptions = useMemo(() => {
    const fys = new Set<string>([currentFY()]);
    requests.forEach(r => { if (r.date) fys.add(getFY(r.date)); });
    return Array.from(fys).sort((a, b) => b.localeCompare(a));
  }, [requests]);

  const filtered = useMemo(() => requests.filter(r => {
    if (!r.date) return false;
    if (filterFY !== 'all' && getFY(r.date) !== filterFY) return false;
    if (filterMonth !== 'all' && r.date.split('-')[1] !== filterMonth.padStart(2, '0')) return false;
    if (filterProject !== 'all' && r.projectId !== filterProject) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    return true;
  }), [requests, filterFY, filterMonth, filterProject, filterStatus]);

  const partyRows = useMemo<PartyRow[]>(() => {
    const map = new Map<string, PartyRow>();
    for (const r of filtered) {
      const name = r.partyName || 'Unknown';
      if (!map.has(name)) {
        map.set(name, { partyName: name, totalRequests: 0, totalAmount: 0, pending: 0, inProgress: 0, completed: 0, rejected: 0 });
      }
      const row = map.get(name)!;
      row.totalRequests++;
      row.totalAmount += r.amount || 0;
      if (r.status === 'Pending' || r.status === 'Needs Review') row.pending++;
      else if (r.status === 'In Progress') row.inProgress++;
      else if (r.status === 'Completed') row.completed++;
      else if (r.status === 'Rejected') row.rejected++;
    }
    return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filtered]);

  const totals = useMemo<Omit<PartyRow, 'partyName'>>(() => ({
    totalRequests: partyRows.reduce((s, r) => s + r.totalRequests, 0),
    totalAmount: partyRows.reduce((s, r) => s + r.totalAmount, 0),
    pending: partyRows.reduce((s, r) => s + r.pending, 0),
    inProgress: partyRows.reduce((s, r) => s + r.inProgress, 0),
    completed: partyRows.reduce((s, r) => s + r.completed, 0),
    rejected: partyRows.reduce((s, r) => s + r.rejected, 0),
  }), [partyRows]);

  // ── export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Party-wise Report');
      ws.addRow(['Party Name', 'Total Requests', 'Total Amount', 'Pending', 'In Progress', 'Completed', 'Rejected']);
      ws.getRow(1).font = { bold: true };
      partyRows.forEach(r => ws.addRow([
        r.partyName, r.totalRequests, r.totalAmount, r.pending, r.inProgress, r.completed, r.rejected,
      ]));
      const totalRow = ws.addRow([
        'TOTAL', totals.totalRequests, totals.totalAmount, totals.pending, totals.inProgress, totals.completed, totals.rejected,
      ]);
      totalRow.font = { bold: true };
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'party-wise-report.xlsx'; a.click();
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Party-wise Report</h1>
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Party-wise Report</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Total amounts requested per party with status breakdown.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || partyRows.length === 0}
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
        <div className="h-1.5 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-400 opacity-70" />
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
              <p className="text-xs font-medium text-slate-600">Status</p>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="bg-white/80 border-white/70"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-400 opacity-70" />
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Party-wise Breakdown</CardTitle>
          <CardDescription>{partyRows.length} part{partyRows.length !== 1 ? 'ies' : 'y'} found</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {partyRows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <Users className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-slate-500">No records match the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-auto rounded-b-2xl border-t border-white/70 bg-white/80 max-h-[calc(100vh-400px)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 sticky top-0 z-10">
                    {['Party Name', 'Total Requests', 'Total Amount', 'Pending', 'In Progress', 'Completed', 'Rejected'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {partyRows.map((row, idx) => (
                    <tr key={row.partyName} className={`border-b border-slate-100 hover:bg-slate-50/70 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                      <td className="px-4 py-3 font-medium text-slate-800">{row.partyName}</td>
                      <td className="px-4 py-3 text-slate-700">{row.totalRequests}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{formatCurrency(row.totalAmount)}</td>
                      <td className="px-4 py-3">
                        {row.pending > 0 && (
                          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                            {row.pending}
                          </span>
                        )}
                        {row.pending === 0 && <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {row.inProgress > 0 && (
                          <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                            {row.inProgress}
                          </span>
                        )}
                        {row.inProgress === 0 && <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {row.completed > 0 && (
                          <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                            {row.completed}
                          </span>
                        )}
                        {row.completed === 0 && <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {row.rejected > 0 && (
                          <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                            {row.rejected}
                          </span>
                        )}
                        {row.rejected === 0 && <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
                    <td className="px-4 py-3 text-slate-800">Total ({partyRows.length} parties)</td>
                    <td className="px-4 py-3 text-slate-700">{totals.totalRequests}</td>
                    <td className="px-4 py-3 text-slate-900">{formatCurrency(totals.totalAmount)}</td>
                    <td className="px-4 py-3 text-amber-700">{totals.pending}</td>
                    <td className="px-4 py-3 text-blue-700">{totals.inProgress}</td>
                    <td className="px-4 py-3 text-green-700">{totals.completed}</td>
                    <td className="px-4 py-3 text-red-700">{totals.rejected}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
