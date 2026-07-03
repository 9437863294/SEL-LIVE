'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASExpense, type SASPayment, type SASProject } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { BarChart3, Download, Loader2, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

interface ProjectStat {
  id: string;
  name: string;
  totalReceived: number;
  totalExpenses: number;
  balance: number;
}

export default function ProjectSummaryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canView    = can('View',   `${MODULE}.Reports`) || can('View Module', MODULE);
  const canExport  = can('Export', `${MODULE}.Reports`);
  const canViewAll = can('View',   `${MODULE}.All Projects`);

  const [projects,  setProjects]  = useState<SASProject[]>([]);
  const [payments,  setPayments]  = useState<SASPayment[]>([]);
  const [expenses,  setExpenses]  = useState<SASExpense[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search,    setSearch]    = useState('');

  useEffect(() => {
    if (!isAuthLoading && canView) void loadAll();
  }, [isAuthLoading, canView]);

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p => p.assignedPersonId === user?.id),
    [projects, user?.id, canViewAll]
  );

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, paySnap, expSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo<ProjectStat[]>(() => {
    return visibleProjects.map(proj => {
      const received = payments.filter(p => p.projectId === proj.id).reduce((s, p) => s + (p.receivedAmount || 0), 0);
      const spent    = expenses.filter(e => e.projectId === proj.id).reduce((s, e) => s + (e.expenseAmount || 0), 0);
      return { id: proj.id, name: proj.projectName, totalReceived: received, totalExpenses: spent, balance: received - spent };
    });
  }, [visibleProjects, payments, expenses]);

  const filtered = useMemo(
    () => stats.filter(s => s.name.toLowerCase().includes(search.toLowerCase())),
    [stats, search]
  );

  const overallReceived  = useMemo(() => filtered.reduce((s, p) => s + p.totalReceived, 0), [filtered]);
  const overallExpenses  = useMemo(() => filtered.reduce((s, p) => s + p.totalExpenses, 0), [filtered]);
  const overallBalance   = overallReceived - overallExpenses;

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Project Summary');
      ws.columns = [
        { header: 'Project Name',         key: 'name',           width: 30 },
        { header: 'Total Received (₹)',   key: 'totalReceived',  width: 20 },
        { header: 'Total Expenses (₹)',   key: 'totalExpenses',  width: 20 },
        { header: 'Balance (₹)',          key: 'balance',        width: 16 },
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach(s => ws.addRow({ ...s }));
      ws.addRow({ name: 'OVERALL TOTAL', totalReceived: overallReceived, totalExpenses: overallExpenses, balance: overallBalance }).font = { bold: true };
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'project-summary.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Overall Project Summary</h1>
          <p className="text-sm text-muted-foreground">Total received, spent, and balance across all enabled projects</p>
        </div>
        {canExport && (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        )}
      </div>

      {/* Overall summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-slate-50 px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">Total Projects</p>
          <p className="text-2xl font-bold text-slate-700">{filtered.length}</p>
        </div>
        <div className="rounded-xl border bg-blue-50 px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">Total Received</p>
          <p className="text-lg font-bold text-blue-700">{formatINR(overallReceived)}</p>
        </div>
        <div className="rounded-xl border bg-rose-50 px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">Total Expenses</p>
          <p className="text-lg font-bold text-rose-700">{formatINR(overallExpenses)}</p>
        </div>
        <div className={cn('rounded-xl border px-4 py-3 text-center', overallBalance >= 0 ? 'bg-emerald-50' : 'bg-destructive/10')}>
          <p className="text-xs text-muted-foreground">Total Balance</p>
          <p className={cn('text-lg font-bold', overallBalance >= 0 ? 'text-emerald-700' : 'text-destructive')}>{formatINR(overallBalance)}</p>
        </div>
      </div>

      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..." className="max-w-xs" />

      {filtered.length === 0 ? (
        <Card className="bg-white/80"><CardContent className="flex flex-col items-center gap-3 py-12">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No projects configured. Add projects in Project Settings.</p>
        </CardContent></Card>
      ) : (
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium">#</th>
                    <th className="px-4 py-2.5 text-left font-medium">Project Name</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      <span className="flex items-center justify-end gap-1"><TrendingUp className="h-3.5 w-3.5 text-blue-500" />Total Received</span>
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      <span className="flex items-center justify-end gap-1"><TrendingDown className="h-3.5 w-3.5 text-rose-500" />Total Expenses</span>
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      <span className="flex items-center justify-end gap-1"><Wallet className="h-3.5 w-3.5 text-emerald-500" />Balance</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((stat, idx) => (
                    <tr key={stat.id} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-medium">{stat.name}</td>
                      <td className="px-4 py-2.5 text-right text-blue-600">{formatINR(stat.totalReceived)}</td>
                      <td className="px-4 py-2.5 text-right text-rose-600">{formatINR(stat.totalExpenses)}</td>
                      <td className={cn('px-4 py-2.5 text-right font-semibold', stat.balance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                        {formatINR(stat.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-bold">
                    <td colSpan={2} className="px-4 py-2.5">Overall Total ({filtered.length} projects)</td>
                    <td className="px-4 py-2.5 text-right text-blue-700">{formatINR(overallReceived)}</td>
                    <td className="px-4 py-2.5 text-right text-rose-700">{formatINR(overallExpenses)}</td>
                    <td className={cn('px-4 py-2.5 text-right', overallBalance >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                      {formatINR(overallBalance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
