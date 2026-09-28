'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASAttachment, type SASBudget, type SASCategory, type SASCategoryBudget, type SASExpense, type SASProject,
} from '@/lib/site-account-statement';
import { loadScopedLedger } from '@/lib/site-account-statement-queries';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  ChevronDown, ChevronRight, Download, ExternalLink, File,
  Info, Loader2, PieChart, Target,
} from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

const BAR_COLORS = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500',
  'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-sky-500',
  'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500',
];

const BORDER_COLORS = [
  'border-rose-500', 'border-orange-500', 'border-amber-500', 'border-lime-500',
  'border-emerald-500', 'border-teal-500', 'border-cyan-500', 'border-sky-500',
  'border-blue-500', 'border-indigo-500', 'border-violet-500', 'border-purple-500',
];

function monthOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    opts.push({ value: ym, label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) });
  }
  return opts;
}

function fmtDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── Expense detail sheet ──────────────────────────────────────────────────────
function ExpenseDetailDialog({ expense, open, onClose }: { expense: SASExpense | null; open: boolean; onClose: () => void }) {
  if (!expense) return null;

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: 'Project',       value: expense.projectName },
    { label: 'Category',      value: expense.expenseCategory },
    { label: 'Sub-Category',  value: expense.expenseSubCategory || <span className="text-muted-foreground italic">—</span> },
    { label: 'Date',          value: expense.expenseDate ? fmtDate(expense.expenseDate) : '—' },
    { label: 'Amount',        value: <span className="font-bold text-rose-700 text-base">{formatINR(expense.expenseAmount || 0)}</span> },
    { label: 'Payment Mode',  value: <Badge variant="outline" className="font-normal">{expense.paymentMode}</Badge> },
    { label: 'Vendor / Party', value: expense.vendorPartyName || <span className="text-muted-foreground italic">—</span> },
    { label: 'Bill No.',      value: expense.billNo || <span className="text-muted-foreground italic">—</span> },
    { label: 'Narration',     value: expense.narration || <span className="text-muted-foreground italic">—</span> },
    { label: 'Expensed By',   value: expense.expensedBy || '—' },
    { label: 'Remarks',       value: expense.remarks || <span className="text-muted-foreground italic">—</span> },
  ];

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Expense Details
            <Badge variant="outline" className="font-normal text-xs ml-1">{expense.expenseCategory}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-0.5">
          {fields.map(f => (
            <div key={f.label} className="flex gap-3 py-2 border-b last:border-0">
              <span className="w-28 shrink-0 text-xs font-medium text-muted-foreground pt-0.5">{f.label}</span>
              <span className="flex-1 text-sm text-slate-800 break-words">{f.value}</span>
            </div>
          ))}
        </div>

        {/* Attachments */}
        {expense.attachments && expense.attachments.length > 0 && (
          <div className="mt-2 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Attachments ({expense.attachments.length})</p>
            {expense.attachments.map((att: SASAttachment, i: number) => (
              <a
                key={i}
                href={att.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
              >
                <File className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate text-slate-700">{att.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">{fmtSize(att.size)}</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </a>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CategoryAnalysisPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canExport  = can('Export', `${MODULE}.Reports`);

  const [projects,        setProjects]        = useState<SASProject[]>([]);
  const [categories,      setCategories]      = useState<SASCategory[]>([]);
  const [expenses,        setExpenses]        = useState<SASExpense[]>([]);
  const [catBudgets,      setCatBudgets]      = useState<SASCategoryBudget[]>([]);
  const [monthlyBudgets,  setMonthlyBudgets]  = useState<SASBudget[]>([]);
  const [budgetLoadError, setBudgetLoadError] = useState(false);
  const [loading,         setLoading]         = useState(true);
  const [exporting,       setExporting]       = useState(false);

  // ── Filters ───────────────────────────────────────────────────────────────────
  const [filterProject,  setFilterProject]  = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterMonth,    setFilterMonth]    = useState('');
  const [filterMode,     setFilterMode]     = useState('');
  const [filterFrom,     setFilterFrom]     = useState('');
  const [filterTo,       setFilterTo]       = useState('');
  const [filterPerson,   setFilterPerson]   = useState('');

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [expandedCats,   setExpandedCats]   = useState<Set<string>>(new Set());
  const [selectedExpense, setSelectedExpense] = useState<SASExpense | null>(null);

  // Scope depends on the resolved user and their All-Projects permission, so a late-arriving
  // profile re-runs the load rather than leaving the page scoped to nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isAuthLoading) void loadAll(); }, [isAuthLoading, user?.id, canViewAll]);

  async function loadAll() {
    setLoading(true);
    setBudgetLoadError(false);
    try {
      // Load expenses, projects, categories first (critical path)
      const [pSnap, catSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
      ]);
      const allProjects = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject));
      setProjects(allProjects.filter(p => p.enabledForSiteAccount));
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)));
      // Scoped to the projects this user may see, on the server — this page used to pull the
      // organisation's entire expense collection and filter it in the browser.
      const ledger = await loadScopedLedger({ projects: allProjects, userId: user?.id, canViewAll });
      setExpenses(ledger.expenses);
    } finally {
      setLoading(false);
    }

    // Load budgets separately so a failure here doesn't break the main report
    try {
      const [cbSnap, mbSnap] = await Promise.all([
        getDocs(collection(db, SAS_COLLECTIONS.categoryBudgets)),
        getDocs(collection(db, SAS_COLLECTIONS.budgets)),
      ]);
      setCatBudgets(cbSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategoryBudget)));
      // Keep only monthly-type budgets (period = "YYYY-MM") for the grand-total reference
      setMonthlyBudgets(
        mbSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as SASBudget))
          .filter(b => b.budgetType === 'monthly')
      );
    } catch (err) {
      console.error('[CategoryReport] Failed to load category budgets:', err);
      setBudgetLoadError(true);
    }
  }

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );

  const userProjectIds = useMemo(
    () => canViewAll ? null : new Set(visibleProjects.map(p => p.id)),
    [visibleProjects, canViewAll]
  );

  const MONTH_OPTIONS = useMemo(() => monthOptions(), []);

  const activeFilterCount = [filterProject, filterCategory, filterMonth, filterMode, filterFrom, filterTo, filterPerson].filter(Boolean).length;

  function clearFilters() {
    setFilterProject(''); setFilterCategory(''); setFilterMonth('');
    setFilterMode(''); setFilterFrom(''); setFilterTo(''); setFilterPerson('');
  }

  // ── Filtered expenses ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => expenses.filter(e => {
    if (userProjectIds && !userProjectIds.has(e.projectId))                               return false;
    if (filterProject  && e.projectId !== filterProject)                                  return false;
    if (filterCategory && e.expenseCategory !== filterCategory)                           return false;
    if (filterMonth    && !e.expenseDate?.startsWith(filterMonth))                        return false;
    if (filterMode     && e.paymentMode !== filterMode)                                   return false;
    if (filterFrom     && e.expenseDate < filterFrom)                                     return false;
    if (filterTo       && e.expenseDate > filterTo)                                       return false;
    if (filterPerson   && !(e.expensedBy || '').toLowerCase().includes(filterPerson.toLowerCase())) return false;
    return true;
  }), [expenses, userProjectIds, filterProject, filterCategory, filterMonth, filterMode, filterFrom, filterTo, filterPerson]);

  const grandTotal = useMemo(() => filtered.reduce((s, e) => s + (e.expenseAmount || 0), 0), [filtered]);

  // ── Budget per category (respects active filters) ─────────────────────────────
  const categoryBudgetMap = useMemo(() => {
    const map = new Map<string, number>();
    catBudgets.forEach(b => {
      if (userProjectIds && !userProjectIds.has(b.projectId)) return;
      if (filterProject && b.projectId !== filterProject)     return;
      // Period matching
      if (filterMonth) {
        if (b.period !== filterMonth) return;
      } else {
        if (filterFrom && b.period < filterFrom.substring(0, 7)) return;
        if (filterTo   && b.period > filterTo.substring(0, 7))   return;
      }
      map.set(b.categoryName, (map.get(b.categoryName) ?? 0) + b.budgetAmount);
    });
    return map;
  }, [catBudgets, userProjectIds, filterProject, filterMonth, filterFrom, filterTo]);

  // ── Monthly budget grand total (respects same project / period filters) ─────────
  const grandMonthlyBudget = useMemo(() => {
    let total = 0;
    monthlyBudgets.forEach(b => {
      if (!b.period) return;
      if (userProjectIds && !userProjectIds.has(b.projectId)) return;
      if (filterProject && b.projectId !== filterProject)     return;
      if (filterMonth) {
        if (b.period !== filterMonth) return;
      } else {
        if (filterFrom && b.period < filterFrom.substring(0, 7)) return;
        if (filterTo   && b.period > filterTo.substring(0, 7))   return;
      }
      total += b.budgetAmount;
    });
    return total;
  }, [monthlyBudgets, userProjectIds, filterProject, filterMonth, filterFrom, filterTo]);

  // Show budget columns when either per-category budgets OR monthly budgets are available
  const hasBudgetData = categoryBudgetMap.size > 0 || grandMonthlyBudget > 0;

  // ── Category groups ───────────────────────────────────────────────────────────
  const categoryGroups = useMemo(() => {
    const expMap = new Map<string, SASExpense[]>();
    filtered.forEach(e => {
      const key = e.expenseCategory || 'Uncategorized';
      if (!expMap.has(key)) expMap.set(key, []);
      expMap.get(key)!.push(e);
    });

    // Also include categories that have a budget set but zero expenses in the current filter
    categoryBudgetMap.forEach((_, catName) => {
      if (!expMap.has(catName)) expMap.set(catName, []);
    });

    return Array.from(expMap.entries())
      .map(([name, exps]) => {
        const actual   = exps.reduce((s, e) => s + (e.expenseAmount || 0), 0);
        const budget   = categoryBudgetMap.get(name) ?? 0;
        const variance = budget > 0 ? budget - actual : null;
        const pctUsed  = budget > 0 ? (actual / budget) * 100 : null;
        return {
          name, actual, budget, variance, pctUsed,
          count: exps.length,
          sharePct: grandTotal > 0 ? (actual / grandTotal) * 100 : 0,
          entries: [...exps].sort((a, b) => (b.expenseDate || '').localeCompare(a.expenseDate || '')),
        };
      })
      .sort((a, b) => b.actual - a.actual);
  }, [filtered, grandTotal, categoryBudgetMap]);

  // Grand budget = monthly budget (from siteAccountBudgets) which should equal
  // the sum of category budgets; fall back to sum of category budgets if no monthly budget set.
  const catBudgetSum = useMemo(
    () => categoryGroups.reduce((s, g) => s + g.budget, 0),
    [categoryGroups]
  );
  const grandBudget = grandMonthlyBudget > 0 ? grandMonthlyBudget : catBudgetSum;

  // ── Expand / collapse ─────────────────────────────────────────────────────────
  function toggle(name: string) {
    setExpandedCats(prev => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }
  const expandAll   = () => setExpandedCats(new Set(categoryGroups.map(g => g.name)));
  const collapseAll = () => setExpandedCats(new Set());

  // Show project column only when viewing all projects and not filtered to one
  const showProjectCol = canViewAll && !filterProject;

  // colspan for expanded inner-table footer: all columns except Amount
  const detailCols = 5 + (showProjectCol ? 1 : 0);

  // ── Export ────────────────────────────────────────────────────────────────────
  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Category Analysis');
      ws.columns = [
        { header: 'Category',     key: 'cat',      width: 24 },
        { header: 'Budget (₹)',   key: 'budget',   width: 16 },
        { header: 'Actual (₹)',   key: 'actual',   width: 16 },
        { header: 'Variance (₹)', key: 'variance', width: 16 },
        { header: '% Used',       key: 'pctUsed',  width: 12 },
        { header: 'Sub-Category', key: 'sub',      width: 22 },
        { header: 'Date',         key: 'date',     width: 13 },
        { header: 'Project',      key: 'proj',     width: 26 },
        { header: 'Narration',    key: 'narr',     width: 28 },
        { header: 'Expensed By',  key: 'person',   width: 18 },
        { header: 'Mode',         key: 'mode',     width: 10 },
        { header: 'Entry Amount', key: 'amount',   width: 16 },
      ];
      ws.getRow(1).font = { bold: true };
      categoryGroups.forEach(grp => {
        const row = ws.addRow({
          cat:      grp.name,
          budget:   grp.budget || '—',
          actual:   grp.actual,
          variance: grp.variance !== null ? grp.variance : '—',
          pctUsed:  grp.pctUsed !== null ? `${grp.pctUsed.toFixed(1)}%` : '—',
          sub: '', date: '', proj: `${grp.count} entries`, narr: '', person: '', mode: '', amount: '',
        });
        row.font = { bold: true };
        grp.entries.forEach(e => {
          ws.addRow({ cat: '', budget: '', actual: '', variance: '', pctUsed: '', sub: e.expenseSubCategory || '', date: e.expenseDate, proj: e.projectName, narr: e.narration || '', person: e.expensedBy, mode: e.paymentMode, amount: e.expenseAmount });
        });
      });
      ws.addRow({ cat: 'GRAND TOTAL', budget: grandBudget || '—', actual: grandTotal }).font = { bold: true };
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'category-analysis.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <PageHeader
        title="Category-wise Expense Analysis"
        description="Click a category to expand entries · Click an entry for full details"
        actions={canExport ? (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export
          </Button>
        ) : undefined}
      />

      {/* Filters */}
      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <Select value={filterProject || '_all'} onValueChange={v => setFilterProject(v === '_all' ? '' : v)}>
          <SelectTrigger aria-label="Project"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Projects</SelectItem>
            {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterCategory || '_all'} onValueChange={v => setFilterCategory(v === '_all' ? '' : v)}>
          <SelectTrigger aria-label="Category"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterMonth || '_all'} onValueChange={v => setFilterMonth(v === '_all' ? '' : v)}>
          <SelectTrigger aria-label="Month"><SelectValue placeholder="All Months" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Months</SelectItem>
            {MONTH_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterMode || '_all'} onValueChange={v => setFilterMode(v === '_all' ? '' : v)}>
          <SelectTrigger aria-label="Payment mode"><SelectValue placeholder="All Modes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Modes</SelectItem>
            {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>

        <Input value={filterFrom} onChange={e => setFilterFrom(e.target.value)} type="date" aria-label="From date" />
        <Input value={filterTo}   onChange={e => setFilterTo(e.target.value)}   type="date" aria-label="To date" />
        <Input
          value={filterPerson} onChange={e => setFilterPerson(e.target.value)}
          placeholder="Expensed by..." aria-label="Expensed by"
        />
      </FilterBar>

      {/* Summary strip */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="rounded-lg border bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700">
            {categoryGroups.length} categor{categoryGroups.length !== 1 ? 'ies' : 'y'}
          </span>
          {hasBudgetData && (
            <span className="rounded-lg border bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5" /> Budget {formatINR(grandBudget)}
            </span>
          )}
          <span className="rounded-lg border bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700">
            Actual {formatINR(grandTotal)}
          </span>
          {hasBudgetData && (
            <span className={cn('rounded-lg border px-3 py-1.5 text-sm font-bold',
              grandBudget - grandTotal >= 0 ? 'bg-indigo-50 text-indigo-700' : 'bg-destructive/10 text-destructive')}>
              {grandBudget - grandTotal >= 0 ? 'Under' : 'Over'} {formatINR(Math.abs(grandBudget - grandTotal))}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{filtered.length} entries</span>
        </div>
        {categoryGroups.length > 0 && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={expandAll}>Expand all</Button>
            <span className="text-muted-foreground self-center">·</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={collapseAll}>Collapse all</Button>
          </div>
        )}
      </div>

      {/* Budget info banners */}
      {budgetLoadError && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <span>Could not load category budgets — check browser console for details. Expense data is unaffected.</span>
        </div>
      )}
      {!budgetLoadError && !hasBudgetData && catBudgets.length === 0 && monthlyBudgets.length === 0 && !loading && (
        <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
          <span>
            No category budgets found. Open the{' '}
            <a href="/site-account-statement/budget" className="font-semibold underline underline-offset-2 hover:text-blue-900">
              Site Fund Budget
            </a>{' '}
            page, expand a month row, and click the <strong>Categories</strong> button to set per-category budgets. Budget vs Actual will appear here once set.
          </span>
        </div>
      )}

      {/* Main table */}
      {categoryGroups.length === 0 ? (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <PieChart className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No expense data for the selected filters.</p>
            {activeFilterCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <TableCard
          title="Category breakdown"
          // Natural height: an expanded category nests its own table, whose header must not pin.
          scroll="natural"
        >
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Category</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Entries</TableHead>
                    {hasBudgetData && (
                      <TableHead className="text-right whitespace-nowrap">
                        <span className="flex items-center justify-end gap-1"><Target className="h-3.5 w-3.5 text-emerald-600" />Budget</span>
                      </TableHead>
                    )}
                    <TableHead className="text-right whitespace-nowrap">Actual</TableHead>
                    {hasBudgetData && (
                      <TableHead className="text-right whitespace-nowrap">Variance</TableHead>
                    )}
                    <TableHead className="min-w-[160px]">
                      {hasBudgetData ? '% Used / Share' : 'Share'}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryGroups.map((grp, idx) => {
                    const isOpen   = expandedCats.has(grp.name);
                    const barColor    = BAR_COLORS[idx % BAR_COLORS.length];
                    const borderColor = BORDER_COLORS[idx % BORDER_COLORS.length];
                    const isOver   = grp.pctUsed !== null && grp.pctUsed >= 100;
                    const isNear   = grp.pctUsed !== null && grp.pctUsed >= 80 && grp.pctUsed < 100;

                    return (
                      <Fragment key={grp.name}>

                        {/* ── Category summary row ── */}
                        <TableRow
                          className={cn('cursor-pointer select-none', isOpen && 'bg-slate-50/80')}
                          onClick={() => toggle(grp.name)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {isOpen
                                ? <ChevronDown  className="h-4 w-4 text-slate-500 shrink-0" />
                                : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                              <span className="text-[11px] text-muted-foreground w-4 shrink-0 tabular-nums">{idx + 1}</span>
                              <span className="font-medium">{grp.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{grp.count}</TableCell>
                          {hasBudgetData && (
                            <TableCell className="text-right whitespace-nowrap font-medium text-emerald-700 tabular-nums">
                              {grp.budget > 0 ? formatINR(grp.budget) : <span className="text-muted-foreground text-xs">—</span>}
                            </TableCell>
                          )}
                          <TableCell className="text-right whitespace-nowrap font-medium text-rose-700 tabular-nums">
                            {formatINR(grp.actual)}
                          </TableCell>
                          {hasBudgetData && (
                            <TableCell className={cn('text-right whitespace-nowrap font-medium tabular-nums',
                              grp.variance === null ? 'text-muted-foreground'
                                : grp.variance < 0 ? 'text-destructive'
                                : 'text-indigo-700')}>
                              {grp.variance !== null
                                ? (grp.variance < 0 ? '−' : '+') + formatINR(Math.abs(grp.variance))
                                : <span className="text-xs font-normal">—</span>}
                            </TableCell>
                          )}
                          <TableCell>
                            <div className="space-y-1">
                              {/* Budget usage bar (if budget set) */}
                              {grp.pctUsed !== null ? (
                                <div className="flex items-center gap-1.5">
                                  <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden min-w-[60px]">
                                    <div
                                      className={cn('h-full rounded-full transition-all',
                                        isOver ? 'bg-destructive' : isNear ? 'bg-amber-500' : 'bg-emerald-500')}
                                      style={{ width: `${Math.min(grp.pctUsed, 100)}%` }}
                                    />
                                  </div>
                                  <span className={cn('text-[10px] tabular-nums w-10 text-right',
                                    isOver ? 'text-destructive font-semibold' : isNear ? 'text-amber-600' : 'text-emerald-700')}>
                                    {grp.pctUsed.toFixed(0)}%
                                  </span>
                                </div>
                              ) : null}
                              {/* Share bar */}
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden min-w-[60px]">
                                  <div className={cn('h-full rounded-full', barColor)} style={{ width: `${grp.sharePct}%` }} />
                                </div>
                                <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                                  {grp.sharePct.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* ── Expanded: individual entries ── */}
                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={4 + (hasBudgetData ? 2 : 0)} className="p-0">
                              <div className={cn('border-l-4', borderColor)}>
                                <Table className="min-w-[600px]">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="whitespace-nowrap">Date</TableHead>
                                      {showProjectCol && (
                                        <TableHead>Project</TableHead>
                                      )}
                                      <TableHead className="whitespace-nowrap">Sub-Category</TableHead>
                                      <TableHead>Narration</TableHead>
                                      <TableHead className="whitespace-nowrap">Expensed By</TableHead>
                                      <TableHead className="whitespace-nowrap">Mode</TableHead>
                                      <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {grp.entries.map(e => (
                                      <TableRow
                                        key={e.id}
                                        className="cursor-pointer"
                                        onClick={ev => { ev.stopPropagation(); setSelectedExpense(e); }}
                                        title="Click to view full details"
                                      >
                                        <TableCell className="whitespace-nowrap tabular-nums">
                                          {e.expenseDate ? fmtDate(e.expenseDate) : '—'}
                                        </TableCell>
                                        {showProjectCol && (
                                          <TableCell className="max-w-[160px] truncate" title={e.projectName}>{e.projectName}</TableCell>
                                        )}
                                        <TableCell className="max-w-[140px] truncate">
                                          {e.expenseSubCategory || <span className="italic text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate" title={e.narration || ''}>
                                          {e.narration || <span className="italic text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">{e.expensedBy || '—'}</TableCell>
                                        <TableCell>
                                          <Badge variant="neutral">{e.paymentMode}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-medium text-rose-700 whitespace-nowrap tabular-nums">
                                          {formatINR(e.expenseAmount || 0)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                  <TableFooter>
                                    <TableRow>
                                      <TableCell colSpan={detailCols}>
                                        {grp.count} entr{grp.count !== 1 ? 'ies' : 'y'}
                                      </TableCell>
                                      <TableCell className="text-right whitespace-nowrap text-rose-700 tabular-nums">{formatINR(grp.actual)}</TableCell>
                                    </TableRow>
                                  </TableFooter>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>
                      Grand Total
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ({categoryGroups.length} categories, {filtered.length} entries)
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{filtered.length}</TableCell>
                    {hasBudgetData && (
                      <TableCell className="text-right whitespace-nowrap text-emerald-700 tabular-nums">{grandBudget > 0 ? formatINR(grandBudget) : '—'}</TableCell>
                    )}
                    <TableCell className="text-right whitespace-nowrap text-rose-700 tabular-nums">{formatINR(grandTotal)}</TableCell>
                    {hasBudgetData && (
                      <TableCell className={cn('text-right whitespace-nowrap tabular-nums',
                        grandBudget - grandTotal >= 0 ? 'text-indigo-700' : 'text-destructive')}>
                        {grandBudget > 0
                          ? (grandBudget - grandTotal >= 0 ? '+' : '−') + formatINR(Math.abs(grandBudget - grandTotal))
                          : '—'}
                      </TableCell>
                    )}
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
        </TableCard>
      )}

      {/* Expense detail dialog */}
      <ExpenseDetailDialog
        expense={selectedExpense}
        open={!!selectedExpense}
        onClose={() => setSelectedExpense(null)}
      />
    </div>
  );
}
