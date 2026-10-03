'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, SAS_COLLECTIONS,
  type SASBudget, type SASBudgetApproval, type SASCategoryBudget,
  type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { loadScopedLedger } from '@/lib/site-account-statement-queries';
import {
  currentPeriod,
  describeRange,
  periodsBetween,
  selectablePeriods,
  type PeriodRange,
} from '@/lib/site-account-statement-period-range';
import { PeriodRangePicker } from '@/components/site-account-statement/period-range-picker';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
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
import { AttachmentDownloadButton } from '@/components/site-account-statement/attachment-download-button';

const MODULE = 'Site Account Statement';

// ── Period helpers ─────────────────────────────────────────────────────────────



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

// ── Status labels (the badge itself is the shared StatusBadge) ──────────────────
const UTIL_STATUS_LABEL: Record<UtilRow['status'], string> = {
  'over-budget': 'Over Budget',
  warning:       'Warning',
  'on-track':    'On Track',
  'no-budget':   'No Budget',
};

/** Only the rows that need attention are tinted; the status column says the rest. */
function rowBg(status: UtilRow['status']) {
  if (status === 'over-budget') return 'bg-rose-50/60';
  if (status === 'warning')     return 'bg-amber-50/60';
  return undefined;
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
  /*
   * One month range replaces the old "pick an FY, then pick a month within it" pair.
   *
   * That pair could only ask for a single month or a whole financial year, and never for
   * anything crossing an FY boundary — so "April to September" or "the last six months" in
   * January were simply not expressible, and people exported twice and added the columns up by
   * hand. A range answers all three and collapses to the old behaviour when both ends match.
   */
  const [range, setRange] = useState<PeriodRange>(() => ({ from: currentPeriod(), to: currentPeriod() }));

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
  // Scope depends on the resolved user and their All-Projects permission, so a late-arriving
  // profile re-runs the load rather than leaving the page scoped to nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isAuthLoading) void loadAll(); }, [isAuthLoading, user?.id, canViewAll]);

  // The effect that used to keep the month select inside the chosen FY went with the two selects
  // it existed to reconcile. A range needs no such correction: it is already a pair of months.

  async function loadAll() {
    setLoading(true);
    setCatBudgetErr(false);
    try {
      const [pSnap, bSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(collection(db, SAS_COLLECTIONS.budgets)),
      ]);
      const allProjects = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject));
      setProjects(allProjects.filter(p => p.enabledForSiteAccount));
      setBudgets(bSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)));
      // Scoped to the projects this user may see, on the server — this page used to pull the
      // organisation's entire expense and payment collections and filter them in the browser.
      const ledger = await loadScopedLedger({ projects: allProjects, userId: user?.id, canViewAll });
      setExpenses(ledger.expenses);
      setPayments(ledger.payments);
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


  // ── Months the report covers ──────────────────────────────────────────────
  const activeMonths = useMemo(() => periodsBetween(range.from, range.to), [range.from, range.to]);

  /** Months offered in the range pickers — everything the data touches, plus the current FY. */
  const monthOptions = useMemo(() => {
    const seen: string[] = [];
    budgets.forEach(b => { if (b.budgetType === 'monthly' && b.period) seen.push(b.period); });
    expenses.forEach(e => { if (e.expenseDate) seen.push(e.expenseDate.slice(0, 7)); });
    return selectablePeriods(seen);
  }, [budgets, expenses]);

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
      await downloadWorkbook(wb, `budget-utilization-${range.from}_to_${range.to}.xlsx`);
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
      await downloadWorkbook(wb, `over-budget-alert-${range.from}_to_${range.to}.xlsx`);
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
      await downloadWorkbook(wb, `budget-vs-actual-category-${range.from}_to_${range.to}.xlsx`);
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
      await downloadWorkbook(wb, `approval-status-${range.from}_to_${range.to}.xlsx`);
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
    if (pct === null) return <span className="text-muted-foreground">—</span>;
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

  const rangeLabel = describeRange(range);

  return (
    <div className="space-y-4">

      {/* ── Page header ── */}
      <PageHeader
        icon={Target}
        title="Budget Reports"
        description={<>{rangeLabel} · Budget utilization, alerts, category breakdown, and approval tracking</>}
      />

      {/* ── Persistent filters ── */}
      <FilterBar
        activeCount={filterProjectId ? 1 : 0}
        onClear={() => setFilterProjectId('')}
        summary={<>{visibleProjects.length} project{visibleProjects.length !== 1 ? 's' : ''} visible · {rangeLabel}</>}
      >
        <Select value={filterProjectId || '_all'} onValueChange={v => setFilterProjectId(v === '_all' ? '' : v)}>
          <SelectTrigger aria-label="Project">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Projects</SelectItem>
            {visibleProjects.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <PeriodRangePicker
          range={range}
          options={monthOptions}
          onChange={next => { setRange(next); setExpandedRows(new Set()); }}
          compact
        />
      </FilterBar>

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
          <TabsTrigger value="utilization" className="text-xs px-2 py-1 data-[state=active]:font-semibold">
            Budget Utilization
          </TabsTrigger>
          <TabsTrigger value="over-budget" className="text-xs px-2 py-1 data-[state=active]:font-semibold">
            Over-Budget Alert
            {overBudgetRows.length > 0 && (
              <Badge variant="neutral" className="ml-1">
                {overBudgetRows.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="category" className="text-xs px-2 py-1 data-[state=active]:font-semibold">
            By Category
          </TabsTrigger>
          <TabsTrigger value="approval" className="text-xs px-2 py-1 data-[state=active]:font-semibold">
            Approval Status
          </TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════════════
            TAB 1 — Budget Utilization
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'utilization' && (
          <TableCard
            className="mt-3"
            title="Budget utilization"
            count={tab1Rows.length}
            noun="row"
            actions={canExport ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={exportTab1} disabled={exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Export Excel
              </Button>
            ) : undefined}
            toolbar={
              <FilterBar activeCount={filterStatus ? 1 : 0} onClear={() => setFilterStatus('')}>
                <Select value={filterStatus || '_all'} onValueChange={v => setFilterStatus(v === '_all' ? '' : v)}>
                  <SelectTrigger aria-label="Status">
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
              </FilterBar>
            }
          >
            {tab1Rows.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <TrendingUp className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No budget data found for the selected FY and filters.</p>
                </div>
            ) : (
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[200px]">Project</TableHead>
                          <TableHead>Month</TableHead>
                          <TableHead className="text-right">Budget (₹)</TableHead>
                          <TableHead className="text-right">Spent (₹)</TableHead>
                          <TableHead className="text-right">Remaining (₹)</TableHead>
                          <TableHead className="min-w-[130px]">% Used</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-center">Approval</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
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
                          const allocTone =
                            allocLabel === 'Over-allocated'  ? 'danger' as const :
                            allocLabel === 'Fully allocated' ? 'success' as const :
                                                               'warning' as const;

                          return (
                            <Fragment key={rowKey}>
                              {/* ── Main row ── */}
                              <TableRow
                                className={cn(rowBg(row.status), hasCats && 'cursor-pointer select-none')}
                                onClick={hasCats ? () => toggleRow(rowKey) : undefined}
                              >
                                <TableCell className="font-medium max-w-[200px]">
                                  <div className="flex items-center gap-1.5">
                                    {hasCats
                                      ? isExp
                                        ? <ChevronDown  className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                        : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                      : <span className="w-3.5 shrink-0" />}
                                    <span className="truncate" title={row.projectName}>{row.projectName}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="whitespace-nowrap">{monthLabel(row.month)}</TableCell>
                                <TableCell className="text-right font-medium text-emerald-700 tabular-nums whitespace-nowrap">
                                  {row.budget !== null ? (
                                    <div>
                                      {formatINR(row.budget)}
                                      {catBudgetSum > 0 && (
                                        <p className={cn('text-[10px] font-normal tabular-nums',
                                          catBudgetSum > row.budget ? 'text-destructive' :
                                          catBudgetSum === row.budget ? 'text-teal-600' : 'text-amber-600'
                                        )}>
                                          {formatINR(catBudgetSum)} allocated
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    catBudgetSum > 0
                                      ? <div>{formatINR(catBudgetSum)}<p className="text-[10px] font-normal text-muted-foreground">∑ categories</p></div>
                                      : <span className="text-muted-foreground font-normal">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-medium text-rose-700 tabular-nums whitespace-nowrap">
                                  {formatINR(row.spent)}
                                </TableCell>
                                <TableCell className={cn('text-right font-medium tabular-nums whitespace-nowrap',
                                  row.remaining === null ? 'text-muted-foreground' :
                                  row.remaining < 0 ? 'text-destructive' : 'text-indigo-700'
                                )}>
                                  {row.remaining !== null ? formatINR(row.remaining) : '—'}
                                </TableCell>
                                <TableCell>{pctBar(row.pctUsed, row.status)}</TableCell>
                                <TableCell><StatusBadge status={row.status}>{UTIL_STATUS_LABEL[row.status]}</StatusBadge></TableCell>
                                <TableCell className="text-center">
                                  {row.approval ? (
                                    <a
                                      href={row.approval.fileUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={row.approval.fileName}
                                      onClick={e => e.stopPropagation()}
                                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                                    >
                                      <FileText className="h-3.5 w-3.5 shrink-0" />
                                      <ExternalLink className="h-3 w-3 shrink-0" />
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              </TableRow>

                              {/* ── Category sub-rows (expanded) ── */}
                              {isExp && catData.map(c => (
                                <TableRow key={`${rowKey}:${c.cat}`} className="bg-slate-50/60">
                                  <TableCell className="pl-10">
                                    <div className="flex items-center gap-1.5">
                                      <Layers className="h-2.5 w-2.5 text-teal-500 shrink-0" />
                                      <span className="font-medium">{c.cat}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="italic">↳ category</TableCell>
                                  <TableCell className="text-right font-medium text-emerald-700 tabular-nums whitespace-nowrap">
                                    {c.budget !== null ? formatINR(c.budget) : <span className="text-muted-foreground font-normal">—</span>}
                                  </TableCell>
                                  <TableCell className="text-right font-medium text-rose-700 tabular-nums whitespace-nowrap">
                                    {c.spent > 0 ? formatINR(c.spent) : <span className="text-muted-foreground font-normal">—</span>}
                                  </TableCell>
                                  <TableCell className={cn('text-right font-medium tabular-nums whitespace-nowrap',
                                    c.remaining === null ? 'text-muted-foreground' :
                                    c.remaining < 0 ? 'text-destructive' : 'text-indigo-700'
                                  )}>
                                    {c.remaining !== null ? formatINR(c.remaining) : '—'}
                                  </TableCell>
                                  <TableCell>{pctBar(c.pct, c.status)}</TableCell>
                                  <TableCell><StatusBadge status={c.status}>{UTIL_STATUS_LABEL[c.status]}</StatusBadge></TableCell>
                                  <TableCell />
                                </TableRow>
                              ))}

                              {/* ── Category totals footer row ── */}
                              {isExp && catData.length > 0 && (
                                <TableRow className="bg-slate-50/60 font-medium">
                                  <TableCell className="pl-10">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span>∑ Total Allocated</span>
                                      {allocLabel && (
                                        <StatusBadge status={allocLabel} tone={allocTone} />
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="italic font-normal">{catData.length} categories</TableCell>
                                  <TableCell className="text-right text-emerald-700 tabular-nums whitespace-nowrap">
                                    {catBudgetSum > 0 ? formatINR(catBudgetSum) : <span className="text-muted-foreground font-normal">—</span>}
                                  </TableCell>
                                  <TableCell className="text-right text-rose-700 tabular-nums whitespace-nowrap">
                                    {catSpentSum > 0 ? formatINR(catSpentSum) : <span className="text-muted-foreground font-normal">—</span>}
                                  </TableCell>
                                  <TableCell className={cn('text-right tabular-nums whitespace-nowrap',
                                    catRemaining === null ? 'text-muted-foreground' :
                                    catRemaining < 0 ? 'text-destructive' : 'text-teal-700'
                                  )}>
                                    {catRemaining !== null ? formatINR(catRemaining) : '—'}
                                  </TableCell>
                                  <TableCell>{pctBar(catPctUsed, catTotalStatus)}</TableCell>
                                  <TableCell><StatusBadge status={catTotalStatus}>{UTIL_STATUS_LABEL[catTotalStatus]}</StatusBadge></TableCell>
                                  <TableCell />
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
            )}
          </TableCard>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 2 — Over-Budget Alert
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'over-budget' && (
          <TableCard
            className="mt-3"
            title="Over-budget months"
            description="Sorted by Overshoot % (highest first)"
            count={overBudgetRows.length}
            noun="month"
            actions={canExport ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={exportTab2} disabled={exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Export Excel
              </Button>
            ) : undefined}
          >
            {overBudgetRows.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500/70" />
                  <p className="text-sm text-muted-foreground">
                    No over-budget months found for {rangeLabel}.
                  </p>
                  <p className="text-xs text-muted-foreground">All projects are within budget.</p>
                </div>
            ) : (
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[200px]">Project</TableHead>
                          <TableHead>Month</TableHead>
                          <TableHead className="text-right">Budget (₹)</TableHead>
                          <TableHead className="text-right">Spent (₹)</TableHead>
                          <TableHead className="text-right">Overshoot (₹)</TableHead>
                          <TableHead className="text-right">Overshoot %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overBudgetRows.map(row => {
                          const overshoot    = row.spent - (row.budget ?? 0);
                          const overshootPct = row.pctUsed !== null ? row.pctUsed - 100 : 0;
                          return (
                            <TableRow key={`${row.projectId}-${row.month}`}>
                              <TableCell className="font-medium max-w-[200px] truncate" title={row.projectName}>
                                {row.projectName}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{monthLabel(row.month)}</TableCell>
                              <TableCell className="text-right text-emerald-700 tabular-nums whitespace-nowrap">
                                {row.budget !== null ? formatINR(row.budget) : '—'}
                              </TableCell>
                              <TableCell className="text-right font-medium text-rose-700 tabular-nums whitespace-nowrap">
                                {formatINR(row.spent)}
                              </TableCell>
                              <TableCell className="text-right font-medium text-destructive tabular-nums whitespace-nowrap">
                                +{formatINR(overshoot)}
                              </TableCell>
                              <TableCell className="text-right font-medium text-destructive tabular-nums whitespace-nowrap">
                                +{overshootPct.toFixed(1)}%
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
            )}
          </TableCard>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 3 — Budget vs Actual by Category
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'category' && (
          <TableCard
            className="mt-3"
            title="Budget vs actual by category"
            count={categoryRows.length}
            noun="row"
            actions={canExport ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={exportTab3} disabled={exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Export Excel
              </Button>
            ) : undefined}
            toolbar={
              <FilterBar
                activeCount={filterCategory ? 1 : 0}
                onClear={() => setFilterCategory('')}
                summary={catBudgetErr ? <Badge variant="warning">Category budgets could not be loaded</Badge> : undefined}
              >
                <Select value={filterCategory || '_all'} onValueChange={v => setFilterCategory(v === '_all' ? '' : v)}>
                  <SelectTrigger aria-label="Category">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All Categories</SelectItem>
                    {allCategories.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterBar>
            }
          >
            {categoryRows.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Target className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    No category budget or expense data found for {rangeLabel}.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Set category budgets from the Site Fund Budget page to see this report.
                  </p>
                </div>
            ) : (
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[180px]">Project</TableHead>
                          <TableHead>Month</TableHead>
                          <TableHead className="min-w-[160px]">Category</TableHead>
                          <TableHead className="text-right">Budget (₹)</TableHead>
                          <TableHead className="text-right">Spent (₹)</TableHead>
                          <TableHead className="text-right">Variance (₹)</TableHead>
                          <TableHead className="min-w-[110px]">% Used</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {categoryRows.map((row, idx) => {
                          const isOver = row.pctUsed !== null && row.pctUsed > 100;
                          const isNear = row.pctUsed !== null && row.pctUsed >= 80 && row.pctUsed <= 100;
                          return (
                            <TableRow
                              key={`${row.projectId}-${row.month}-${row.category}`}
                              className={cn(isOver ? 'bg-rose-50/60' : isNear ? 'bg-amber-50/60' : undefined)}
                            >
                              <TableCell className="max-w-[180px] truncate" title={row.projectName}>
                                {row.projectName}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{monthLabel(row.month)}</TableCell>
                              <TableCell className="font-medium">{row.category}</TableCell>
                              <TableCell className="text-right text-emerald-700 tabular-nums whitespace-nowrap">
                                {row.budget !== null ? formatINR(row.budget) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-right font-medium text-rose-700 tabular-nums whitespace-nowrap">
                                {formatINR(row.spent)}
                              </TableCell>
                              <TableCell className={cn('text-right font-medium tabular-nums whitespace-nowrap',
                                row.variance === null ? 'text-muted-foreground' :
                                row.variance < 0 ? 'text-destructive' : 'text-indigo-700'
                              )}>
                                {row.variance !== null
                                  ? (row.variance < 0 ? '−' : '+') + formatINR(Math.abs(row.variance))
                                  : '—'}
                              </TableCell>
                              <TableCell>
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
                                ) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
            )}
          </TableCard>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 4 — Approval Status
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'approval' && (
          <TableCard
            className="mt-3"
            title="Approval status"
            description={<>
              {approvalRows.filter(r => r.approval).length} uploaded ·{' '}
              {approvalRows.filter(r => !r.approval).length} pending
            </>}
            actions={canExport ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={exportTab4} disabled={exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Export Excel
              </Button>
            ) : undefined}
          >
            {approvalRows.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <FileText className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No budget data found for {rangeLabel}.</p>
                </div>
            ) : (
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[200px]">Project</TableHead>
                          <TableHead>Month</TableHead>
                          <TableHead className="text-right">Monthly Budget (₹)</TableHead>
                          <TableHead className="min-w-[180px]">Approval File</TableHead>
                          <TableHead>Uploaded By</TableHead>
                          <TableHead>Uploaded On</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {approvalRows.map(row => (
                          <TableRow key={`${row.projectId}-${row.month}`}>
                            <TableCell className="font-medium max-w-[200px] truncate" title={row.projectName}>
                              {row.projectName}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{monthLabel(row.month)}</TableCell>
                            <TableCell className="text-right text-emerald-700 tabular-nums whitespace-nowrap">
                              {row.monthBudget !== null ? formatINR(row.monthBudget) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              {row.approval ? (
                                <div className="inline-flex items-center gap-1">
                                  <a
                                    href={row.approval.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline underline-offset-2 max-w-[180px] truncate"
                                    title={row.approval.fileName}
                                  >
                                    <FileText className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">{row.approval.fileName}</span>
                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                  </a>
                                  <AttachmentDownloadButton url={row.approval.fileUrl} name={row.approval.fileName} className="h-6 w-6" iconClassName="h-3 w-3" />
                                </div>
                              ) : (
                                <span className="text-muted-foreground italic">No file uploaded</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {row.approval?.uploadedByName || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums">
                              {row.approval ? fmtDate(row.approval.uploadedAt) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              {row.approval ? (
                                <StatusBadge status="Uploaded" tone="success">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Uploaded
                                </StatusBadge>
                              ) : (
                                <StatusBadge status="Pending">
                                  <XCircle className="h-3 w-3" />
                                  Pending
                                </StatusBadge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
            )}
          </TableCard>
        )}
      </Tabs>
    </div>
  );
}
