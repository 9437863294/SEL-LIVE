'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASBudget, type SASExpense, type SASPayment, type SASProject } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { BarChart3, Download, Loader2, Target, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

interface ProjectStat {
  id: string;
  name: string;
  totalReceived: number;
  totalExpenses: number;
  balance: number;
  totalBudget: number;
  budgetUsedPct: number;
  budgetRemaining: number;
}

export default function ProjectSummaryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View',   `${MODULE}.All Projects`);
  const canView    = can('View',   `${MODULE}.Reports`);
  const canExport  = can('Export', `${MODULE}.Reports`);

  const [projects,  setProjects]  = useState<SASProject[]>([]);
  const [payments,  setPayments]  = useState<SASPayment[]>([]);
  const [expenses,  setExpenses]  = useState<SASExpense[]>([]);
  const [budgets,   setBudgets]   = useState<SASBudget[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search,    setSearch]    = useState('');

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  }, [isAuthLoading]);

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, paySnap, expSnap, budSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses))),
        getDocs(collection(db, SAS_COLLECTIONS.budgets)),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setBudgets(budSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)));
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo<ProjectStat[]>(() => {
    return visibleProjects.map(proj => {
      const received    = payments.filter(p => p.projectId === proj.id).reduce((s, p) => s + (p.receivedAmount || 0), 0);
      const spent       = expenses.filter(e => e.projectId === proj.id).reduce((s, e) => s + (e.expenseAmount || 0), 0);
      const budget      = budgets.find(b => b.projectId === proj.id && b.budgetType === 'total');
      const totalBudget = budget?.budgetAmount ?? 0;
      return {
        id: proj.id, name: proj.projectName,
        totalReceived: received, totalExpenses: spent, balance: received - spent,
        totalBudget,
        budgetUsedPct:   totalBudget > 0 ? (spent / totalBudget) * 100 : 0,
        budgetRemaining: totalBudget > 0 ? totalBudget - spent : 0,
      };
    });
  }, [visibleProjects, payments, expenses, budgets]);

  const filtered = useMemo(
    () => stats.filter(s => s.name.toLowerCase().includes(search.toLowerCase())),
    [stats, search]
  );

  const overallReceived   = useMemo(() => filtered.reduce((s, p) => s + p.totalReceived, 0),  [filtered]);
  const overallExpenses   = useMemo(() => filtered.reduce((s, p) => s + p.totalExpenses, 0),  [filtered]);
  const overallBalance    = overallReceived - overallExpenses;
  const overallBudget     = useMemo(() => filtered.reduce((s, p) => s + p.totalBudget, 0),    [filtered]);
  const budgetedCount     = useMemo(() => filtered.filter(p => p.totalBudget > 0).length,      [filtered]);
  const overBudgetCount   = useMemo(() => filtered.filter(p => p.totalBudget > 0 && p.totalExpenses > p.totalBudget).length, [filtered]);
  const overallBudgetUsed = overallBudget > 0 ? (overallExpenses / overallBudget) * 100 : 0;

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Project Summary');
      ws.columns = [
        { header: 'Project Name',           key: 'name',             width: 30 },
        { header: 'Total Received (₹)',     key: 'totalReceived',    width: 20 },
        { header: 'Total Expenses (₹)',     key: 'totalExpenses',    width: 20 },
        { header: 'Balance (₹)',            key: 'balance',          width: 16 },
        { header: 'Total Budget (₹)',       key: 'totalBudget',      width: 18 },
        { header: 'Budget Used (%)',         key: 'budgetUsedPct',    width: 16 },
        { header: 'Budget Remaining (₹)',   key: 'budgetRemaining',  width: 20 },
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach(s => ws.addRow({
        name: s.name, totalReceived: s.totalReceived, totalExpenses: s.totalExpenses, balance: s.balance,
        totalBudget: s.totalBudget || '—',
        budgetUsedPct: s.totalBudget > 0 ? `${s.budgetUsedPct.toFixed(1)}%` : '—',
        budgetRemaining: s.totalBudget > 0 ? s.budgetRemaining : '—',
      }));
      ws.addRow({
        name: 'OVERALL TOTAL', totalReceived: overallReceived, totalExpenses: overallExpenses, balance: overallBalance,
        totalBudget: overallBudget || '—',
        budgetUsedPct: overallBudget > 0 ? `${overallBudgetUsed.toFixed(1)}%` : '—',
        budgetRemaining: overallBudget > 0 ? overallBudget - overallExpenses : '—',
      }).font = { bold: true };
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
          <h1 className="text-base sm:text-lg font-bold text-slate-800">Overall Project Summary</h1>
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border bg-slate-50 px-4 py-3 text-center">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Total Projects</p>
          <p className="text-sm font-bold text-slate-700">{filtered.length}</p>
        </div>
        <div className="rounded-xl border bg-blue-50 px-4 py-3 text-center">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Total Received</p>
          <p className="text-sm font-bold text-blue-700">{formatINR(overallReceived)}</p>
        </div>
        <div className="rounded-xl border bg-rose-50 px-4 py-3 text-center">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Total Expenses</p>
          <p className="text-sm font-bold text-rose-700">{formatINR(overallExpenses)}</p>
        </div>
        <div className={cn('rounded-xl border px-4 py-3 text-center', overallBalance >= 0 ? 'bg-emerald-50' : 'bg-destructive/10')}>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Total Balance</p>
          <p className={cn('text-sm font-bold', overallBalance >= 0 ? 'text-emerald-700' : 'text-destructive')}>{formatINR(overallBalance)}</p>
        </div>
      </div>

      {/* Budget summary */}
      {budgetedCount > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border bg-emerald-50 px-4 py-3 text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground">Total Budget</p>
            <p className="text-sm font-bold text-emerald-700">{formatINR(overallBudget)}</p>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground">{budgetedCount} project{budgetedCount !== 1 ? 's' : ''} budgeted</p>
          </div>
          <div className="rounded-xl border bg-indigo-50 px-4 py-3 text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground">Budget Used</p>
            <p className="text-sm font-bold text-indigo-700">{overallBudgetUsed.toFixed(1)}%</p>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground">{formatINR(overallExpenses)} of {formatINR(overallBudget)}</p>
          </div>
          <div className={cn('rounded-xl border px-4 py-3 text-center', overBudgetCount > 0 ? 'bg-red-50' : 'bg-slate-50')}>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Over Budget</p>
            <p className={cn('text-sm font-bold', overBudgetCount > 0 ? 'text-destructive' : 'text-slate-500')}>{overBudgetCount}</p>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground">project{overBudgetCount !== 1 ? 's' : ''}</p>
          </div>
        </div>
      )}

      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..." className="w-full sm:max-w-xs" />

      {filtered.length === 0 ? (
        <Card className="bg-white/80"><CardContent className="flex flex-col items-center gap-3 py-12">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No projects configured. Add projects in Project Settings.</p>
        </CardContent></Card>
      ) : (
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <div className="overflow-auto overflow-x-auto max-h-[60vh]">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-slate-100">
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
                    <th className="px-4 py-2.5 text-right font-medium">
                      <span className="flex items-center justify-end gap-1"><Target className="h-3.5 w-3.5 text-emerald-600" />Budget</span>
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Used %</th>
                    <th className="px-4 py-2.5 text-right font-medium">Remaining</th>
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
                      <td className="px-4 py-2.5 text-right text-emerald-700">
                        {stat.totalBudget > 0 ? formatINR(stat.totalBudget) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className={cn('px-4 py-2.5 text-right font-medium', stat.totalBudget > 0 && stat.budgetUsedPct >= 100 ? 'text-destructive' : stat.totalBudget > 0 && stat.budgetUsedPct >= 80 ? 'text-amber-600' : 'text-slate-500')}>
                        {stat.totalBudget > 0 ? `${stat.budgetUsedPct.toFixed(1)}%` : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className={cn('px-4 py-2.5 text-right', stat.totalBudget > 0 && stat.budgetRemaining < 0 ? 'text-destructive' : 'text-slate-600')}>
                        {stat.totalBudget > 0 ? formatINR(stat.budgetRemaining) : <span className="text-muted-foreground text-xs">—</span>}
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
                    <td className="px-4 py-2.5 text-right text-emerald-700">{overallBudget > 0 ? formatINR(overallBudget) : '—'}</td>
                    <td className="px-4 py-2.5 text-right">{overallBudget > 0 ? `${overallBudgetUsed.toFixed(1)}%` : '—'}</td>
                    <td className="px-4 py-2.5 text-right">{overallBudget > 0 ? formatINR(overallBudget - overallExpenses) : '—'}</td>
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
