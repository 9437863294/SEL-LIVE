'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, SAS_COLLECTIONS,
  type SASBudget, type SASBudgetApproval, type SASCategoryBudget,
  type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download,
  ExternalLink, FileText, Layers, Loader2, Target, TrendingDown, TrendingUp,
  Wallet, XCircle,
} from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

// ── Period helpers ─────────────────────────────────────────────────────────────
function currentFYStart(): number {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

function fyLabel(y: number) { return `${y}-${String(y + 1).slice(-2)}`; }
function currentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getFYMonths(fyStartYear: number): string[] {
  const months: string[] = [];
  for (let m = 4; m <= 12; m++) months.push(`${fyStartYear}-${String(m).padStart(2, '0')}`);
  for (let m = 1; m <= 3; m++) months.push(`${fyStartYear + 1}-${String(m).padStart(2, '0')}`);
  return months;
}

function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function fmtDate(ts: any): string {
  if (!ts) return '—';
  if (typeof ts === 'string') return ts;
  if (ts?.toDate) return ts.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return '—';
}

// ── Types ──────────────────────────────────────────────────────────────────────
type ActiveTab = 'utilization' | 'over-budget' | 'category' | 'approval';

type UtilRow = {
  projectId: string;
  projectName: string;
  month: string;
  budget: number | null;
  spent: number;
  remaining: number | null;
  pctUsed: number | null;
  status: 'on-track' | 'warning' | 'over-budget' | 'no-budget';
  approval: SASBudgetApproval | null;
};

type CategoryRow = {
  projectId: string;
  projectName: string;
  month: string;
  category: string;
  budget: number | null;
  spent: number;
  variance: number | null;
  pctUsed: number | null;
};

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: UtilRow['status'] }) {
  if (status === 'over-budget')
    return <Badge variant="destructive" className="text-[11px] px-2 py-0.5">Over Budget</Badge>;
  if (status === 'warning')
    return <Badge className="text-[11px] px-2 py-0.5 bg-amber-500 hover:bg-amber-500">Warning</Badge>;
  if (status === 'on-track')
    return <Badge className="text-[11px] px-2 py-0.5 bg-emerald-600 hover:bg-emerald-600">On Track</Badge>;
  return <Badge variant="outline" className="text-[11px] px-2 py-0.5 text-muted-foreground">No Budget</Badge>;
}

function rowBg(status: UtilRow['status']) {
  if (status === 'over-budget') return 'bg-red-50/60 hover:bg-red-50';
  if (status === 'warning')     return 'bg-amber-50/60 hover:bg-amber-50';
  if (status === 'on-track')    return 'bg-emerald-50/40 hover:bg-emerald-50/70';
  return 'bg-slate-50/40 hover:bg-muted/20';
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function BudgetReportsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canExport  = can('Export', `${MODULE}.Reports`);

  // ── Data state ─────────────────────────────────────────────────────────────
  const [projects,     setProjects]     = useState<SASProject[]>([]);
  const [budgets,      setBudgets]      = useState<SASBudget[]>([]);
  const [expenses,     setExpenses]     = useState<SASExpense[]>([]);
  const [payments,     setPayments]     = useState<SASPayment[]>([]);
  const [catBudgets,   setCatBudgets]   = useState<SASCategoryBudget[]>([]);
  const [approvals,    setApprovals]    = useState<SASBudgetApproval[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [catBudgetErr, setCatBudgetErr] = useState(false);
  const [exporting,    setExporting]    = useState(false);

  // ── Filters (persistent across tabs) ──────────────────────────────────────
  const [filterProjectId, setFilterProjectId] = useState('');
  const [filterFY,        setFilterFY]        = useState<string>(String(currentFYStart()));
  const [filterMonth,     setFilterMonth]     = useState<string>(currentMonthStr()); // '' = all months

  // ── Tab-specific filters ───────────────────────────────────────────────────
  const [filterStatus,   setFilterStatus]   = useState('');  // Tab 1
  const [filterCategory, setFilterCategory] = useState('');  // Tab 3

  // ── Active tab ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('utilization');

  // ── Expanded rows in Tab 1 (key = "projectId:YYYY-MM") ────────────────────
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  function toggleRow(key: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => { if (!isAuthLoading) void loadAll(); }, [isAuthLoading]);

  // When FY changes, set filterMonth to current month if it's in the new FY, else clear to show all
  useEffect(() => {
    const months = getFYMonths(parseInt(filterFY || String(currentFYStart())));
    const cur = currentMonthStr();
    setFilterMonth(months.includes(cur) ? cur : '');
    setExpandedRows(new Set());
  }, [filterFY]);

  async function loadAll() {
    setLoading(true);
    setCatBudgetErr(false);
    try {
      const [pSnap, bSnap, eSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(collection(db, SAS_COLLECTIONS.budgets)),
        getDocs(collection(db, SAS_COLLECTIONS.expenses)),
        getDocs(collection(db, SAS_COLLECTIONS.payments)),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount));
      setBudgets(bSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)));
      setExpenses(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
    } finally {
      setLoading(false);
    }

    // Category budgets and approvals may not exist yet — load separately
    try {
      const [cbSnap, appSnap] = await Promise.all([
        getDocs(collection(db, SAS_COLLECTIONS.categoryBudgets)),
        getDocs(collection(db, SAS_COLLECTIONS.budgetApprovals)),
      ]);
      setCatBudgets(cbSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategoryBudget)));
      setApprovals(appSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudgetApproval)));
    } catch {
      setCatBudgetErr(true);
    }
  }

  // ── Visible projects (RBAC / assignment filter) ────────────────────────────
  const visibleProjects = useMemo(
    () => canViewAll
      ? projects
      : projects.filter(p =>
          p.assignedPersonId === user?.id ||
          p.altUserId         === user?.id ||
          p.viewerId          === user?.id
        ),
    [projects, user?.id, canViewAll]
  );

  const visibleProjectIds = useMemo(() => new Set(visibleProjects.map(p => p.id)), [visibleProjects]);

  // ── FY options (from data + current FY) ───────────────────────────────────
  const availableFYs = useMemo(() => {
    const set = new Set<number>([currentFYStart()]);
    budgets.filter(b => b.budgetType === 'monthly' && b.period)
      .forEach(b => {
        const [y, mo] = b.period!.split('-').map(Number);
        set.add(mo >= 4 ? y : y - 1);
      });
    expenses.forEach(e => {
      if (e.expenseDate) {
        const [y, mo] = e.expenseDate.split('-').map(Number);
        set.add(mo >= 4 ? y : y - 1);
      }
    });
    return [...set].sort((a, b) => b - a);
  }, [budgets, expenses]);

  // ── FY months ─────────────────────────────────────────────────────────────
  const fyMonths = useMemo(
    () => getFYMonths(parseInt(filterFY || String(currentFYStart()))),
    [filterFY]
  );

  // ── Active months (respects month filter; '' = all FY months) ─────────────
  const activeMonths = useMemo(
    () => filterMonth ? fyMonths.filter(m => m === filterMonth) : fyMonths,
    [fyMonths, filterMonth]
  );

  // ── Build Budget Utilization rows ─────────────────────────────────────────
  const utilRows = useMemo((): UtilRow[] => {
    const rows: UtilRow[] = [];
    const projList = filterProjectId
      ? visibleProjects.filter(p => p.id === filterProjectId)
      : visibleProjects;

    for (const project of projList) {
      for (const month of activeMonths) {
        const mBudget = budgets.find(
          b => b.projectId === project.id && b.budgetType === 'monthly' && b.period === month
        );
        const spent = expenses
          .filter(e => e.projectId === project.id && e.expenseDate?.startsWith(month))
          .reduce((s, e) => s + (e.expenseAmount || 0), 0);

        // Skip months with no data
        if (!mBudget && spent === 0) continue;

        const budget    = mBudget?.budgetAmount ?? null;
        const remaining = budget !== null ? budget - spent : null;
        const pctUsed   = budget !== null && budget > 0 ? (spent / budget) * 100 : null;
        const approval  = approvals.find(a => a.projectId === project.id && a.period === month) ?? null;

        let status: UtilRow['status'] = 'no-budget';
        if (budget !== null) {
          if (spent > budget) status = 'over-budget';
          else if (pctUsed !== null && pctUsed >= 80) status = 'warning';
          else status = 'on-track';
        }

        rows.push({ projectId: project.id, projectName: project.projectName, month, budget, spent, remaining, pctUsed, status, approval });
      }
    }
    return rows;
  }, [visibleProjects, filterProjectId, activeMonths, budgets, expenses, approvals]);

  // ── Tab 1: apply status filter ─────────────────────────────────────────────
  const tab1Rows = useMemo(
    () => filterStatus ? utilRows.filter(r => r.status === filterStatus) : utilRows,
    [utilRows, filterStatus]
  );

  // ── Tab 2: over-budget rows ────────────────────────────────────────────────
  const overBudgetRows = useMemo(
    () => [...utilRows]
      .filter(r => r.budget !== null && r.spent > r.budget)
      .sort((a, b) => {
        const pA = a.pctUsed ?? 0;
        const pB = b.pctUsed ?? 0;
        return pB - pA;
      }),
    [utilRows]
  );

  // ── Tab 3: Category vs Actual rows ────────────────────────────────────────
  const categoryRows = useMemo((): CategoryRow[] => {
    const rows: CategoryRow[] = [];
    const projList = filterProjectId
      ? visibleProjects.filter(p => p.id === filterProjectId)
      : visibleProjects;

    for (const project of projList) {
      for (const month of activeMonths) {
        // Collect all category names that have either a budget or an expense
        const catNames = new Set<string>();
        catBudgets
          .filter(b => b.projectId === project.id && b.period === month)
          .forEach(b => catNames.add(b.categoryName));
        expenses
          .filter(e => e.projectId === project.id && e.expenseDate?.startsWith(month) && e.expenseCategory)
          .forEach(e => catNames.add(e.expenseCategory));

        for (const cat of catNames) {
          if (filterCategory && cat !== filterCategory) continue;
          const cb = catBudgets.find(
            b => b.projectId === project.id && b.period === month && b.categoryName === cat
          );
          const spent = expenses
            .filter(e => e.projectId === project.id && e.expenseDate?.startsWith(month) && e.expenseCategory === cat)
            .reduce((s, e) => s + (e.expenseAmount || 0), 0);
          if (!cb && spent === 0) continue;
          const budget   = cb?.budgetAmount ?? null;
          const variance = budget !== null ? budget - spent : null;
          const pctUsed  = budget !== null && budget > 0 ? (spent / budget) * 100 : null;
          rows.push({ projectId: project.id, projectName: project.projectName, month, category: cat, budget, spent, variance, pctUsed });
        }
      }
    }
    return rows.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.month.localeCompare(b.month) || a.category.localeCompare(b.category));
  }, [visibleProjects, filterProjectId, activeMonths, catBudgets, expenses, filterCategory]);

  // ── Tab 4: Approval Status rows ───────────────────────────────────────────
  const approvalRows = useMemo(() => {
    const rows: { projectId: string; projectName: string; month: string; monthBudget: number | null; approval: SASBudgetApproval | null }[] = [];
    const projList = filterProjectId
      ? visibleProjects.filter(p => p.id === filterProjectId)
      : visibleProjects;

    for (const project of projList) {
      for (const month of activeMonths) {
        const mBudget  = budgets.find(b => b.projectId === project.id && b.budgetType === 'monthly' && b.period === month);
        const approval = approvals.find(a => a.projectId === project.id && a.period === month) ?? null;
        const spent    = expenses
          .filter(e => e.projectId === project.id && e.expenseDate?.startsWith(month))
          .reduce((s, e) => s + (e.expenseAmount || 0), 0);
        // Only show rows that have a budget or approval or any spending
        if (!mBudget && !approval && spent === 0) continue;
        rows.push({ projectId: project.id, projectName: project.projectName, month, monthBudget: mBudget?.budgetAmount ?? null, approval });
      }
    }
    return rows;
  }, [visibleProjects, filterProjectId, activeMonths, budgets, expenses, approvals]);

  // ── Summary cards ─────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const totalBudget    = utilRows.reduce((s, r) => s + (r.budget ?? 0), 0);
    const totalSpent     = utilRows.reduce((s, r) => s + r.spent, 0);
    const totalRemaining = totalBudget - totalSpent;
    const overCount      = overBudgetRows.length;
    return { totalBudget, totalSpent, totalRemaining, overCount };
  }, [utilRows, overBudgetRows]);

  // ── All categories (for filter) ────────────────────────────────────────────
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    categoryRows.forEach(r => set.add(r.category));
    return [...set].sort();
  }, [categoryRows]);

  // ── Export helpers ─────────────────────────────────────────────────────────
  async function exportTab1() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Budget Utilization');
      ws.columns = [
        { header: 'Project',       key: 'project',   width: 32 },
        { header: 'Month',         key: 'month',     width: 14 },
        { header: 'Budget (₹)',    key: 'budget',    width: 16 },
        { header: 'Spent (₹)',     key: 'spent',     width: 16 },
        { header: 'Remaining (₹)', key: 'remaining', width: 16 },
        { header: '% Used',        key: 'pctUsed',   width: 10 },
        { header: 'Status',        key: 'status',    width: 14 },
        { header: 'Approval',      key: 'approval',  width: 10 },
      ];
      ws.getRow(1).font = { bold: true };
      tab1Rows.forEach(r => {
        ws.addRow({
          project:   r.projectName,
          month:     monthLabel(r.month),
          budget:    r.budget ?? '—',
          spent:     r.spent,
          remaining: r.remaining ?? '—',
          pctUsed:   r.pctUsed !== null ? `${r.pctUsed.toFixed(1)}%` : '—',
          status:    r.status === 'on-track' ? 'On Track' : r.status === 'warning' ? 'Warning' : r.status === 'over-budget' ? 'Over Budget' : 'No Budget',
          approval:  r.approval ? 'Yes' : 'No',
        });
      });
      await downloadWorkbook(wb, `budget-utilization-FY${filterFY}.xlsx`);
    } finally { setExporting(false); }
  }

  async function exportTab2() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Over-Budget Alert');
      ws.columns = [
        { header: 'Project',      key: 'project',   width: 32 },
        { header: 'Month',        key: 'month',     width: 14 },
        { header: 'Budget (₹)',   key: 'budget',    width: 16 },
        { header: 'Spent (₹)',    key: 'spent',     width: 16 },
        { header: 'Overshoot (₹)',key: 'overshoot', width: 16 },
        { header: 'Overshoot %',  key: 'pct',       width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      overBudgetRows.forEach(r => {
        ws.addRow({
          project:  r.projectName,
          month:    monthLabel(r.month),
          budget:   r.budget,
          spent:    r.spent,
          overshoot: r.spent - (r.budget ?? 0),
          pct:      r.pctUsed !== null ? `${r.pctUsed.toFixed(1)}%` : '—',
        });
      });
      await downloadWorkbook(wb, `over-budget-alert-FY${filterFY}.xlsx`);
    } finally { setExporting(false); }
  }

  async function exportTab3() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Budget vs Actual by Category');
      ws.columns = [
        { header: 'Project',      key: 'project',  width: 32 },
        { header: 'Month',        key: 'month',    width: 14 },
        { header: 'Category',     key: 'category', width: 22 },
        { header: 'Budget (₹)',   key: 'budget',   width: 16 },
        { header: 'Spent (₹)',    key: 'spent',    width: 16 },
        { header: 'Variance (₹)', key: 'variance', width: 16 },
        { header: '% Used',       key: 'pctUsed',  width: 10 },
      ];
      ws.getRow(1).font = { bold: true };
      categoryRows.forEach(r => {
        ws.addRow({
          project:  r.projectName,
          month:    monthLabel(r.month),
          category: r.category,
          budget:   r.budget ?? '—',
          spent:    r.spent,
          variance: r.variance ?? '—',
          pctUsed:  r.pctUsed !== null ? `${r.pctUsed.toFixed(1)}%` : '—',
        });
      });
      await downloadWorkbook(wb, `budget-vs-actual-category-FY${filterFY}.xlsx`);
    } finally { setExporting(false); }
  }

  async function exportTab4() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Approval Status');
      ws.columns = [
        { header: 'Project',          key: 'project',  width: 32 },
        { header: 'Month',            key: 'month',    width: 14 },
        { header: 'Monthly Budget',   key: 'budget',   width: 16 },
        { header: 'Approval File',    key: 'file',     width: 30 },
        { header: 'Uploaded By',      key: 'by',       width: 20 },
        { header: 'Uploaded On',      key: 'on',       width: 16 },
        { header: 'Status',           key: 'status',   width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      approvalRows.forEach(r => {
        ws.addRow({
          project: r.projectName,
          month:   monthLabel(r.month),
          budget:  r.monthBudget ?? '—',
          file:    r.approval?.fileName ?? '—',
          by:      r.approval?.uploadedByName ?? '—',
          on:      r.approval ? fmtDate(r.approval.uploadedAt) : '—',
          status:  r.approval ? 'Uploaded' : 'Pending',
        });
      });
      await downloadWorkbook(wb, `approval-status-FY${filterFY}.xlsx`);
    } finally { setExporting(false); }
  }

  async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf]));
    const a   = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  function pctBar(pct: number | null, status: UtilRow['status']) {
    if (pct === null) return <span className="text-xs text-muted-foreground">—</span>;
    const color = status === 'over-budget' ? 'bg-destructive' : status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
    return (
      <div className="flex items-center gap-2 min-w-[100px]">
        <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
          <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className={cn('text-[11px] tabular-nums w-9 text-right',
          status === 'over-budget' ? 'text-destructive font-semibold' :
          status === 'warning'     ? 'text-amber-600' : 'text-emerald-700'
        )}>
          {pct.toFixed(1)}%
        </span>
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isAuthLoading || loading) {
    return (
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
      </div>
    );
  }

  const fyInt = parseInt(filterFY || String(currentFYStart()));

  return (
    <div className="space-y-4">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
            <Target className="h-5 w-5 text-emerald-700 shrink-0" />
            Budget Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            FY {fyLabel(fyInt)}{filterMonth ? ` · ${monthLabel(filterMonth)}` : ''} · Budget utilization, alerts, category breakdown, and approval tracking
          </p>
        </div>
      </div>

      {/* ── Persistent filters ── */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={filterProjectId || '_all'} onValueChange={v => setFilterProjectId(v === '_all' ? '' : v)}>
          <SelectTrigger className="h-8 text-xs w-full sm:w-auto min-w-[140px]">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Projects</SelectItem>
            {visibleProjects.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterFY} onValueChange={v => setFilterFY(v)}>
          <SelectTrigger className="h-8 text-xs w-full sm:w-auto min-w-[100px]">
            <SelectValue placeholder="FY" />
          </SelectTrigger>
          <SelectContent>
            {availableFYs.map(fy => (
              <SelectItem key={fy} value={String(fy)}>FY {fyLabel(fy)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterMonth || '_all'} onValueChange={v => { setFilterMonth(v === '_all' ? '' : v); setExpandedRows(new Set()); }}>
          <SelectTrigger className="h-8 text-xs w-full sm:w-auto min-w-[130px]">
            <SelectValue placeholder="All Months" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Months</SelectItem>
            {fyMonths.map(m => (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}{m === currentMonthStr() ? ' (Current)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground ml-auto">
          {visibleProjects.length} project{visibleProjects.length !== 1 ? 's' : ''} visible
          {filterMonth && <> · {monthLabel(filterMonth)}</>}
        </span>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
          <Target className="h-4 w-4 shrink-0 text-emerald-700" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-emerald-700 uppercase tracking-wide">Total Budget</p>
            <p className="text-sm font-bold text-emerald-800 leading-tight truncate">{formatINR(summary.totalBudget)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5">
          <TrendingDown className="h-4 w-4 shrink-0 text-rose-600" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-rose-600 uppercase tracking-wide">Total Spent</p>
            <p className="text-sm font-bold text-rose-700 leading-tight truncate">{formatINR(summary.totalSpent)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
          <Wallet className="h-4 w-4 shrink-0 text-indigo-600" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-indigo-600 uppercase tracking-wide">Total Remaining</p>
            <p className={cn('text-sm font-bold leading-tight truncate', summary.totalRemaining >= 0 ? 'text-indigo-700' : 'text-destructive')}>
              {formatINR(summary.totalRemaining)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-red-600 uppercase tracking-wide">Over-Budget Count</p>
            <p className="text-sm font-bold text-red-700 leading-tight">{summary.overCount} month{summary.overCount !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as ActiveTab)}>
        <TabsList className="h-auto flex-wrap gap-1 bg-slate-100/80">
          <TabsTrigger value="utilization" className="text-xs px-2 py-1 data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:font-semibold">
            Budget Utilization
          </TabsTrigger>
          <TabsTrigger value="over-budget" className="text-xs px-2 py-1 data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:font-semibold">
            Over-Budget Alert
            {overBudgetRows.length > 0 && (
              <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white">
                {overBudgetRows.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="category" className="text-xs px-2 py-1 data-[state=active]:bg-white data-[state=active]:text-violet-700 data-[state=active]:font-semibold">
            By Category
          </TabsTrigger>
          <TabsTrigger value="approval" className="text-xs px-2 py-1 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:font-semibold">
            Approval Status
          </TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════════════
            TAB 1 — Budget Utilization
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'utilization' && (
          <div className="space-y-3 mt-3">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={filterStatus || '_all'} onValueChange={v => setFilterStatus(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs w-full sm:w-auto min-w-[140px]">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Statuses</SelectItem>
                  <SelectItem value="on-track">On Track (&lt;80%)</SelectItem>
                  <SelectItem value="warning">Warning (80–100%)</SelectItem>
                  <SelectItem value="over-budget">Over Budget</SelectItem>
                  <SelectItem value="no-budget">No Budget</SelectItem>
                </SelectContent>
              </Select>

              <span className="text-xs text-muted-foreground">{tab1Rows.length} row{tab1Rows.length !== 1 ? 's' : ''}</span>

              {canExport && (
                <Button variant="outline" size="sm" className="ml-auto gap-1.5 h-8" onClick={exportTab1} disabled={exporting}>
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Export Excel
                </Button>
              )}
            </div>

            {tab1Rows.length === 0 ? (
              <Card className="bg-white/80">
                <CardContent className="flex flex-col items-center gap-3 py-12">
                  <TrendingUp className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No budget data found for the selected FY and filters.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white/80 backdrop-blur-sm">
                <CardContent className="p-0">
                  <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                    <table className="w-full text-sm min-w-[700px]">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b bg-slate-100 shadow-sm">
                          <th className="px-4 py-2.5 text-left font-medium min-w-[200px]">Project</th>
                          <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Month</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-emerald-700">Budget (₹)</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-rose-600">Spent (₹)</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-indigo-600">Remaining (₹)</th>
                          <th className="px-4 py-2.5 text-left font-medium min-w-[130px]">% Used</th>
                          <th className="px-4 py-2.5 text-left font-medium">Status</th>
                          <th className="px-4 py-2.5 text-center font-medium whitespace-nowrap">Approval</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tab1Rows.map((row) => {
                          const rowKey = `${row.projectId}:${row.month}`;
                          const isExp  = expandedRows.has(rowKey);

                          // Build category breakdown for this project+month
                          const catNames = new Set<string>();
                          catBudgets
                            .filter(b => b.projectId === row.projectId && b.period === row.month)
                            .forEach(b => catNames.add(b.categoryName));
                          expenses
                            .filter(e => e.projectId === row.projectId && e.expenseDate?.startsWith(row.month) && e.expenseCategory)
                            .forEach(e => catNames.add(e.expenseCategory));
                          const catData = [...catNames].sort().map(cat => {
                            const cb = catBudgets.find(b => b.projectId === row.projectId && b.period === row.month && b.categoryName === cat);
                            const cSpent = expenses
                              .filter(e => e.projectId === row.projectId && e.expenseDate?.startsWith(row.month) && e.expenseCategory === cat)
                              .reduce((s, e) => s + (e.expenseAmount || 0), 0);
                            const cBudget    = cb?.budgetAmount ?? null;
                            const cRemaining = cBudget !== null ? cBudget - cSpent : null;
                            const cPct       = cBudget !== null && cBudget > 0 ? (cSpent / cBudget) * 100 : null;
                            let cStatus: UtilRow['status'] = 'no-budget';
                            if (cBudget !== null) {
                              if (cSpent > cBudget) cStatus = 'over-budget';
                              else if (cPct !== null && cPct >= 80) cStatus = 'warning';
                              else cStatus = 'on-track';
                            }
                            return { cat, budget: cBudget, spent: cSpent, remaining: cRemaining, pct: cPct, status: cStatus };
                          });
                          const hasCats = catData.length > 0;

                          // Category-level totals (always computed, shown in main row + totals footer)
                          const catBudgetSum   = catData.reduce((s, c) => s + (c.budget ?? 0), 0);
                          const catSpentSum    = catData.reduce((s, c) => s + c.spent, 0);
                          const catRemaining   = catBudgetSum > 0 ? catBudgetSum - catSpentSum : null;
                          const catPctUsed     = catBudgetSum > 0 ? (catSpentSum / catBudgetSum) * 100 : null;
                          const catTotalStatus: UtilRow['status'] =
                            catBudgetSum === 0 ? 'no-budget' :
                            catSpentSum > catBudgetSum ? 'over-budget' :
                            catPctUsed !== null && catPctUsed >= 80 ? 'warning' : 'on-track';

                          // Allocation vs monthly budget comparison
                          const allocLabel =
                            row.budget === null || catBudgetSum === 0 ? null :
                            catBudgetSum > row.budget  ? 'Over-allocated' :
                            catBudgetSum === row.budget ? 'Fully allocated' : 'Under-allocated';
                          const allocColor =
                            allocLabel === 'Over-allocated'  ? 'bg-red-100 text-red-700 hover:bg-red-100' :
                            allocLabel === 'Fully allocated' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' :
                                                               'bg-amber-100 text-amber-700 hover:bg-amber-100';

                          return (
                            <Fragment key={rowKey}>
                              {/* ── Main row ── */}
                              <tr
                                className={cn('border-b transition-colors', rowBg(row.status), hasCats && 'cursor-pointer select-none')}
                                onClick={hasCats ? () => toggleRow(rowKey) : undefined}
                              >
                                <td className="px-4 py-2.5 font-medium text-slate-800 max-w-[200px]">
                                  <div className="flex items-center gap-1.5">
                                    {hasCats
                                      ? isExp
                                        ? <ChevronDown  className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                        : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                      : <span className="w-3.5 shrink-0" />}
                                    <span className="truncate" title={row.projectName}>{row.projectName}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 text-xs">{monthLabel(row.month)}</td>
                                <td className="px-4 py-2.5 text-right font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                                  {row.budget !== null ? (
                                    <div>
                                      {formatINR(row.budget)}
                                      {catBudgetSum > 0 && (
                                        <p className={cn('text-[10px] font-normal tabular-nums',
                                          catBudgetSum > row.budget ? 'text-destructive' :
                                          catBudgetSum === row.budget ? 'text-teal-600' : 'text-amber-600'
                                        )}>
                                          {formatINR(catBudgetSum)} alloc'd
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    catBudgetSum > 0
                                      ? <div>{formatINR(catBudgetSum)}<p className="text-[10px] font-normal text-muted-foreground">∑ categories</p></div>
                                      : <span className="text-muted-foreground font-normal text-xs">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-right font-semibold text-rose-700 tabular-nums whitespace-nowrap">
                                  {formatINR(row.spent)}
                                </td>
                                <td className={cn('px-4 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap',
                                  row.remaining === null ? 'text-muted-foreground' :
                                  row.remaining < 0 ? 'text-destructive' : 'text-indigo-700'
                                )}>
                                  {row.remaining !== null ? formatINR(row.remaining) : '—'}
                                </td>
                                <td className="px-4 py-2.5">{pctBar(row.pctUsed, row.status)}</td>
                                <td className="px-4 py-2.5"><StatusBadge status={row.status} /></td>
                                <td className="px-4 py-2.5 text-center">
                                  {row.approval ? (
                                    <a
                                      href={row.approval.fileUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={row.approval.fileName}
                                      onClick={e => e.stopPropagation()}
                                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
                                    >
                                      <FileText className="h-3.5 w-3.5 shrink-0" />
                                      <ExternalLink className="h-3 w-3 shrink-0" />
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </td>
                              </tr>

                              {/* ── Category sub-rows (expanded) ── */}
                              {isExp && catData.map(c => (
                                <tr key={`${rowKey}:${c.cat}`} className="border-b bg-slate-50/70 hover:bg-slate-100/60 transition-colors">
                                  <td className="py-1.5 pl-10 pr-4">
                                    <div className="flex items-center gap-1.5">
                                      <Layers className="h-2.5 w-2.5 text-teal-500 shrink-0" />
                                      <span className="text-xs text-slate-600 font-medium">{c.cat}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-1.5 text-xs text-muted-foreground italic">↳ category</td>
                                  <td className="px-4 py-1.5 text-right text-xs font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                                    {c.budget !== null ? formatINR(c.budget) : <span className="text-muted-foreground font-normal">—</span>}
                                  </td>
                                  <td className="px-4 py-1.5 text-right text-xs font-semibold text-rose-700 tabular-nums whitespace-nowrap">
                                    {c.spent > 0 ? formatINR(c.spent) : <span className="text-muted-foreground font-normal">—</span>}
                                  </td>
                                  <td className={cn('px-4 py-1.5 text-right text-xs font-semibold tabular-nums whitespace-nowrap',
                                    c.remaining === null ? 'text-muted-foreground' :
                                    c.remaining < 0 ? 'text-destructive' : 'text-indigo-700'
                                  )}>
                                    {c.remaining !== null ? formatINR(c.remaining) : '—'}
                                  </td>
                                  <td className="px-4 py-1.5">{pctBar(c.pct, c.status)}</td>
                                  <td className="px-4 py-1.5"><StatusBadge status={c.status} /></td>
                                  <td />
                                </tr>
                              ))}

                              {/* ── Category totals footer row ── */}
                              {isExp && catData.length > 0 && (
                                <tr className="border-b bg-teal-50/60 border-t-2 border-t-teal-200">
                                  <td className="py-2 pl-10 pr-4">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs font-bold text-teal-800">∑ Total Allocated</span>
                                      {allocLabel && (
                                        <Badge className={cn('text-[10px] px-1.5 py-0 font-normal', allocColor)}>
                                          {allocLabel}
                                        </Badge>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 text-xs text-muted-foreground italic">{catData.length} categories</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                                    {catBudgetSum > 0 ? formatINR(catBudgetSum) : <span className="text-muted-foreground font-normal">—</span>}
                                  </td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-rose-700 tabular-nums whitespace-nowrap">
                                    {catSpentSum > 0 ? formatINR(catSpentSum) : <span className="text-muted-foreground font-normal">—</span>}
                                  </td>
                                  <td className={cn('px-4 py-2 text-right text-xs font-bold tabular-nums whitespace-nowrap',
                                    catRemaining === null ? 'text-muted-foreground' :
                                    catRemaining < 0 ? 'text-destructive' : 'text-teal-700'
                                  )}>
                                    {catRemaining !== null ? formatINR(catRemaining) : '—'}
                                  </td>
                                  <td className="px-4 py-2">{pctBar(catPctUsed, catTotalStatus)}</td>
                                  <td className="px-4 py-2"><StatusBadge status={catTotalStatus} /></td>
                                  <td />
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 2 — Over-Budget Alert
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'over-budget' && (
          <div className="space-y-3 mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {overBudgetRows.length} over-budget month{overBudgetRows.length !== 1 ? 's' : ''} · Sorted by Overshoot % (highest first)
              </span>
              {canExport && (
                <Button variant="outline" size="sm" className="ml-auto gap-1.5 h-8" onClick={exportTab2} disabled={exporting}>
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Export Excel
                </Button>
              )}
            </div>

            {overBudgetRows.length === 0 ? (
              <Card className="bg-white/80">
                <CardContent className="flex flex-col items-center gap-3 py-12">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500/70" />
                  <p className="text-sm text-muted-foreground">
                    No over-budget months found for FY {fyLabel(fyInt)}.
                  </p>
                  <p className="text-xs text-muted-foreground">All projects are within budget.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white/80 backdrop-blur-sm border-red-100">
                <CardContent className="p-0">
                  <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                    <table className="w-full text-sm min-w-[700px]">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b bg-red-50 shadow-sm">
                          <th className="px-4 py-2.5 text-left font-medium min-w-[200px]">Project</th>
                          <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Month</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-emerald-700">Budget (₹)</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-rose-600">Spent (₹)</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-destructive">Overshoot (₹)</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-destructive">Overshoot %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overBudgetRows.map(row => {
                          const overshoot    = row.spent - (row.budget ?? 0);
                          const overshootPct = row.pctUsed !== null ? row.pctUsed - 100 : 0;
                          return (
                            <tr key={`${row.projectId}-${row.month}`} className="border-b bg-red-50/50 hover:bg-red-50 transition-colors">
                              <td className="px-4 py-2.5 font-medium text-slate-800 max-w-[200px] truncate" title={row.projectName}>
                                {row.projectName}
                              </td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 text-xs">{monthLabel(row.month)}</td>
                              <td className="px-4 py-2.5 text-right text-emerald-700 tabular-nums whitespace-nowrap">
                                {row.budget !== null ? formatINR(row.budget) : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-right font-semibold text-rose-700 tabular-nums whitespace-nowrap">
                                {formatINR(row.spent)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-bold text-destructive tabular-nums whitespace-nowrap">
                                +{formatINR(overshoot)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-bold text-destructive tabular-nums whitespace-nowrap">
                                +{overshootPct.toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 3 — Budget vs Actual by Category
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'category' && (
          <div className="space-y-3 mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={filterCategory || '_all'} onValueChange={v => setFilterCategory(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs w-full sm:w-auto min-w-[140px]">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Categories</SelectItem>
                  {allCategories.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="text-xs text-muted-foreground">{categoryRows.length} row{categoryRows.length !== 1 ? 's' : ''}</span>

              {catBudgetErr && (
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                  Category budgets could not be loaded
                </span>
              )}

              {canExport && (
                <Button variant="outline" size="sm" className="ml-auto gap-1.5 h-8" onClick={exportTab3} disabled={exporting}>
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Export Excel
                </Button>
              )}
            </div>

            {categoryRows.length === 0 ? (
              <Card className="bg-white/80">
                <CardContent className="flex flex-col items-center gap-3 py-12">
                  <Target className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    No category budget or expense data found for FY {fyLabel(fyInt)}.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Set category budgets from the Site Fund Budget page to see this report.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white/80 backdrop-blur-sm">
                <CardContent className="p-0">
                  <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                    <table className="w-full text-sm min-w-[700px]">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b bg-slate-100 shadow-sm">
                          <th className="px-4 py-2.5 text-left font-medium min-w-[180px]">Project</th>
                          <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Month</th>
                          <th className="px-4 py-2.5 text-left font-medium min-w-[160px]">Category</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-emerald-700">Budget (₹)</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-rose-600">Spent (₹)</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-indigo-600">Variance (₹)</th>
                          <th className="px-4 py-2.5 text-left font-medium min-w-[110px]">% Used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categoryRows.map((row, idx) => {
                          const isOver = row.pctUsed !== null && row.pctUsed > 100;
                          const isNear = row.pctUsed !== null && row.pctUsed >= 80 && row.pctUsed <= 100;
                          return (
                            <tr
                              key={`${row.projectId}-${row.month}-${row.category}`}
                              className={cn('border-b transition-colors',
                                isOver ? 'bg-red-50/40 hover:bg-red-50/70' :
                                isNear ? 'bg-amber-50/40 hover:bg-amber-50/70' :
                                'bg-white hover:bg-muted/20'
                              )}
                            >
                              <td className="px-4 py-2.5 text-slate-700 max-w-[180px] truncate text-xs" title={row.projectName}>
                                {row.projectName}
                              </td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 text-xs">{monthLabel(row.month)}</td>
                              <td className="px-4 py-2.5 font-medium text-slate-800">{row.category}</td>
                              <td className="px-4 py-2.5 text-right text-emerald-700 tabular-nums whitespace-nowrap">
                                {row.budget !== null ? formatINR(row.budget) : <span className="text-muted-foreground text-xs">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right font-semibold text-rose-700 tabular-nums whitespace-nowrap">
                                {formatINR(row.spent)}
                              </td>
                              <td className={cn('px-4 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap',
                                row.variance === null ? 'text-muted-foreground' :
                                row.variance < 0 ? 'text-destructive' : 'text-indigo-700'
                              )}>
                                {row.variance !== null
                                  ? (row.variance < 0 ? '−' : '+') + formatINR(Math.abs(row.variance))
                                  : '—'}
                              </td>
                              <td className="px-4 py-2.5">
                                {row.pctUsed !== null ? (
                                  <div className="flex items-center gap-2 min-w-[100px]">
                                    <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className={cn('h-full rounded-full',
                                          isOver ? 'bg-destructive' : isNear ? 'bg-amber-500' : 'bg-emerald-500'
                                        )}
                                        style={{ width: `${Math.min(row.pctUsed, 100)}%` }}
                                      />
                                    </div>
                                    <span className={cn('text-[11px] tabular-nums w-9 text-right',
                                      isOver ? 'text-destructive font-semibold' :
                                      isNear ? 'text-amber-600' : 'text-emerald-700'
                                    )}>
                                      {row.pctUsed.toFixed(1)}%
                                    </span>
                                  </div>
                                ) : <span className="text-xs text-muted-foreground">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 4 — Approval Status
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'approval' && (
          <div className="space-y-3 mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {approvalRows.filter(r => r.approval).length} uploaded ·{' '}
                {approvalRows.filter(r => !r.approval).length} pending
              </span>
              {canExport && (
                <Button variant="outline" size="sm" className="ml-auto gap-1.5 h-8" onClick={exportTab4} disabled={exporting}>
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Export Excel
                </Button>
              )}
            </div>

            {approvalRows.length === 0 ? (
              <Card className="bg-white/80">
                <CardContent className="flex flex-col items-center gap-3 py-12">
                  <FileText className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No budget data found for FY {fyLabel(fyInt)}.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white/80 backdrop-blur-sm">
                <CardContent className="p-0">
                  <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                    <table className="w-full text-sm min-w-[700px]">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b bg-slate-100 shadow-sm">
                          <th className="px-4 py-2.5 text-left font-medium min-w-[200px]">Project</th>
                          <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Month</th>
                          <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap text-emerald-700">Monthly Budget (₹)</th>
                          <th className="px-4 py-2.5 text-left font-medium min-w-[180px]">Approval File</th>
                          <th className="px-4 py-2.5 text-left font-medium">Uploaded By</th>
                          <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Uploaded On</th>
                          <th className="px-4 py-2.5 text-center font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approvalRows.map(row => (
                          <tr
                            key={`${row.projectId}-${row.month}`}
                            className={cn('border-b transition-colors',
                              row.approval ? 'bg-emerald-50/30 hover:bg-emerald-50/60' : 'bg-amber-50/30 hover:bg-amber-50/60'
                            )}
                          >
                            <td className="px-4 py-2.5 font-medium text-slate-800 max-w-[200px] truncate" title={row.projectName}>
                              {row.projectName}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 text-xs">{monthLabel(row.month)}</td>
                            <td className="px-4 py-2.5 text-right text-emerald-700 tabular-nums whitespace-nowrap">
                              {row.monthBudget !== null ? formatINR(row.monthBudget) : <span className="text-muted-foreground text-xs">—</span>}
                            </td>
                            <td className="px-4 py-2.5">
                              {row.approval ? (
                                <a
                                  href={row.approval.fileUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline underline-offset-2 text-xs max-w-[180px] truncate"
                                  title={row.approval.fileName}
                                >
                                  <FileText className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{row.approval.fileName}</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </a>
                              ) : (
                                <span className="text-muted-foreground text-xs italic">No file uploaded</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                              {row.approval?.uploadedByName || <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                              {row.approval ? fmtDate(row.approval.uploadedAt) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {row.approval ? (
                                <Badge className="text-[11px] px-2 py-0.5 bg-emerald-600 hover:bg-emerald-600 gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Uploaded
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[11px] px-2 py-0.5 text-amber-700 border-amber-300 bg-amber-50 gap-1">
                                  <XCircle className="h-3 w-3" />
                                  Pending
                                </Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </Tabs>
    </div>
  );
}
