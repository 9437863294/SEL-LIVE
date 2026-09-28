'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASBudget, type SASExpense, type SASPayment, type SASProject } from '@/lib/site-account-statement';
import { loadScopedLedger } from '@/lib/site-account-statement-queries';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useSortControl } from '@/components/site-account-statement/use-sort-control';
import { SortControl } from '@/components/site-account-statement/sort-control';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { BarChart3, Download, Loader2, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

interface ProjectStat {
  id: string;
  name: string;
  openingBalance: number;
  totalReceived: number;
  totalExpenses: number;
  closingBalance: number;
  balance: number;
  totalBudget: number;
  budgetUsedPct: number;
  budgetRemaining: number;
}

export default function ProjectSummaryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const sortControl = useSortControl('reportSummary');
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
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [selectedMonthNumber, setSelectedMonthNumber] = useState('');
  const [dateFrom,  setDateFrom]  = useState('');
  const [dateTo,    setDateTo]    = useState('');
  const [budgetFilter, setBudgetFilter] = useState<'all' | 'budgeted' | 'unbudgeted' | 'over'>('all');

  const applyMonthRange = (year: string, month: string) => {
    setSelectedYear(year);
    setSelectedMonthNumber(month);
    if (!year || !month) {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const ym = `${year}-${month}`;
    setDateFrom(`${ym}-01`);
    setDateTo(`${ym}-${String(lastDay).padStart(2, '0')}`);
  };

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  // Scope depends on the resolved user and their All-Projects permission, so a late-arriving
  // profile re-runs the load rather than leaving the page scoped to nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, user?.id, canViewAll]);

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, budSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(collection(db, SAS_COLLECTIONS.budgets)),
      ]);
      const allProjects = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject));
      setProjects(allProjects.filter(p => p.enabledForSiteAccount));
      // Scoped to the projects this user may see, on the server — these pages used to pull the
      // organisation's entire expense and payment collections and filter them in the browser.
      const ledger = await loadScopedLedger({ projects: allProjects, userId: user?.id, canViewAll });
      setPayments(ledger.payments);
      setExpenses(ledger.expenses);
      setBudgets(budSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)));
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo<ProjectStat[]>(() => {
    return visibleProjects.map(proj => {
      const projectPayments = payments.filter(p => p.projectId === proj.id);
      const projectExpenses = expenses.filter(e => e.projectId === proj.id);
      const openingReceipts = dateFrom
        ? projectPayments.filter(p => p.receiptDate < dateFrom).reduce((s, p) => s + (p.receivedAmount || 0), 0)
        : 0;
      const openingExpenses = dateFrom
        ? projectExpenses.filter(e => e.expenseDate < dateFrom).reduce((s, e) => s + (e.expenseAmount || 0), 0)
        : 0;
      const openingBalance = openingReceipts - openingExpenses;
      const received = projectPayments
        .filter(p => (!dateFrom || p.receiptDate >= dateFrom) && (!dateTo || p.receiptDate <= dateTo))
        .reduce((s, p) => s + (p.receivedAmount || 0), 0);
      const spent = projectExpenses
        .filter(e => (!dateFrom || e.expenseDate >= dateFrom) && (!dateTo || e.expenseDate <= dateTo))
        .reduce((s, e) => s + (e.expenseAmount || 0), 0);
      const budget      = budgets.find(b => b.projectId === proj.id && b.budgetType === 'total');
      const totalBudget = budget?.budgetAmount ?? 0;
      return {
        id: proj.id, name: proj.projectName,
        openingBalance,
        totalReceived: received,
        totalExpenses: spent,
        closingBalance: openingBalance + received - spent,
        balance: openingBalance + received - spent,
        totalBudget,
        budgetUsedPct:   totalBudget > 0 ? (spent / totalBudget) * 100 : 0,
        budgetRemaining: totalBudget > 0 ? totalBudget - spent : 0,
      };
    });
  }, [visibleProjects, payments, expenses, budgets, dateFrom, dateTo]);

  const filtered = useMemo(() => stats.filter(stat => {
    if (!stat.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (budgetFilter === 'budgeted' && stat.totalBudget <= 0) return false;
    if (budgetFilter === 'unbudgeted' && stat.totalBudget > 0) return false;
    if (budgetFilter === 'over' && !(stat.totalBudget > 0 && stat.totalExpenses > stat.totalBudget)) return false;
    return true;
  }), [stats, search, budgetFilter]);

  // The whole scope is already in memory here, so ordering it is a plain wrap.
  const sorted = useMemo(() => sortControl.sortRows(filtered), [filtered, sortControl]);

  const overallReceived   = useMemo(() => filtered.reduce((s, p) => s + p.totalReceived, 0),  [filtered]);
  const overallExpenses   = useMemo(() => filtered.reduce((s, p) => s + p.totalExpenses, 0),  [filtered]);
  const overallOpening    = useMemo(() => filtered.reduce((s, p) => s + p.openingBalance, 0), [filtered]);
  const overallClosing    = overallOpening + overallReceived - overallExpenses;
  const overallBalance    = overallClosing;
  const overallBudget     = useMemo(() => filtered.reduce((s, p) => s + p.totalBudget, 0),    [filtered]);
  const budgetedCount     = useMemo(() => filtered.filter(p => p.totalBudget > 0).length,      [filtered]);
  const overBudgetCount   = useMemo(() => filtered.filter(p => p.totalBudget > 0 && p.totalExpenses > p.totalBudget).length, [filtered]);
  const overallBudgetUsed = overallBudget > 0 ? (overallExpenses / overallBudget) * 100 : 0;
  const overallBudgetRemaining = overallBudget - overallExpenses;

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Project Summary');
      ws.columns = [
        { header: 'Project Name',           key: 'name',             width: 30 },
        { header: 'Opening Balance',         key: 'openingBalance',   width: 20 },
        { header: 'Total Received (₹)',     key: 'totalReceived',    width: 20 },
        { header: 'Total Expenses (₹)',     key: 'totalExpenses',    width: 20 },
        { header: 'Balance (₹)',            key: 'balance',          width: 16 },
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach(s => ws.addRow({
        name: s.name, openingBalance: s.openingBalance, totalReceived: s.totalReceived, totalExpenses: s.totalExpenses, balance: s.closingBalance,
      }));
      ws.addRow({
        name: 'OVERALL TOTAL', openingBalance: overallOpening, totalReceived: overallReceived, totalExpenses: overallExpenses, balance: overallClosing,
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
      <PageHeader
        title="Overall Project Summary"
        description="Budget, opening balance, receipts, expenses, closing balance, and utilization across all enabled projects"
        actions={canExport ? (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        ) : undefined}
      />

      {/* Overall summary cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border bg-emerald-50 px-4 py-3 text-center">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Total Budget</p>
          <p className="text-sm font-bold text-emerald-700">{overallBudget > 0 ? formatINR(overallBudget) : '—'}</p>
        </div>
        <div className="rounded-xl border bg-slate-50 px-4 py-3 text-center">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Opening Balance</p>
          <p className="text-sm font-bold text-slate-700">{formatINR(overallOpening)}</p>
        </div>
        <div className="rounded-xl border bg-blue-50 px-4 py-3 text-center">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Total Received</p>
          <p className="text-sm font-bold text-blue-700">{formatINR(overallReceived)}</p>
        </div>
        <div className="rounded-xl border bg-rose-50 px-4 py-3 text-center">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Total Expenses</p>
          <p className="text-sm font-bold text-rose-700">{formatINR(overallExpenses)}</p>
        </div>
      </div>

      {/* Budget summary */}
      {budgetedCount > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className={cn('rounded-xl border px-4 py-3 text-center', overallClosing >= 0 ? 'bg-indigo-50' : 'bg-destructive/10')}>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Closing Balance</p>
            <p className={cn('text-sm font-bold', overallClosing >= 0 ? 'text-indigo-700' : 'text-destructive')}>{formatINR(overallClosing)}</p>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground">Opening + received − expenses</p>
          </div>
          <div className={cn('rounded-xl border px-4 py-3 text-center', overallBudgetRemaining >= 0 ? 'bg-teal-50' : 'bg-red-50')}>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Budget Remaining</p>
            <p className={cn('text-sm font-bold', overallBudgetRemaining >= 0 ? 'text-teal-700' : 'text-destructive')}>{formatINR(overallBudgetRemaining)}</p>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground">Budget − expenses</p>
          </div>
          <div className={cn('rounded-xl border px-4 py-3 text-center', overallBudgetUsed >= 100 ? 'bg-red-50' : overallBudgetUsed >= 80 ? 'bg-amber-50' : 'bg-violet-50')}>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Budget Used</p>
            <p className={cn('text-sm font-bold', overallBudgetUsed >= 100 ? 'text-destructive' : overallBudgetUsed >= 80 ? 'text-amber-700' : 'text-violet-700')}>{overallBudgetUsed.toFixed(1)}%</p>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground">{formatINR(overallExpenses)} of {formatINR(overallBudget)}</p>
          </div>
        </div>
      )}

      <TableCard
        title="Project summary"
        count={filtered.length}
        noun="project"
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Search projects...' }}
            activeCount={[selectedMonthNumber, dateFrom, dateTo, budgetFilter !== 'all'].filter(Boolean).length}
            onClear={() => {
              setSearch('');
              setSelectedMonthNumber('');
              setSelectedYear(String(new Date().getFullYear()));
              setDateFrom('');
              setDateTo('');
              setBudgetFilter('all');
            }}
          >
            <div className="flex min-w-0 gap-1.5">
              <Select value={selectedMonthNumber || undefined} onValueChange={month => applyMonthRange(selectedYear, month)}>
                <SelectTrigger className="min-w-0 flex-1" aria-label="Month">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ['01', 'January'], ['02', 'February'], ['03', 'March'], ['04', 'April'],
                    ['05', 'May'], ['06', 'June'], ['07', 'July'], ['08', 'August'],
                    ['09', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
                  ].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={selectedYear} onValueChange={year => applyMonthRange(year, selectedMonthNumber)}>
                <SelectTrigger className="w-[88px] shrink-0" aria-label="Year">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, index) => String(new Date().getFullYear() - index)).map(year => (
                    <SelectItem key={year} value={year}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              type="date"
              aria-label="From date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={e => {
                setSelectedMonthNumber('');
                setDateFrom(e.target.value);
              }}
            />
            <Input
              type="date"
              aria-label="To date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={e => {
                setSelectedMonthNumber('');
                setDateTo(e.target.value);
              }}
            />
            <Select value={budgetFilter} onValueChange={value => setBudgetFilter(value as typeof budgetFilter)}>
              <SelectTrigger aria-label="Budget status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                <SelectItem value="budgeted">Budgeted</SelectItem>
                <SelectItem value="unbudgeted">No budget</SelectItem>
                <SelectItem value="over">Over budget</SelectItem>
              </SelectContent>
            </Select>
            <SortControl control={sortControl} className="shrink-0" />
          </FilterBar>
        }
      >
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No projects configured. Add projects in Project Settings.</p>
        </div>
      ) : (
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Project Name</TableHead>
                    <TableHead className="text-right">Opening Balance</TableHead>
                    <TableHead className="text-right">
                      <span className="flex items-center justify-end gap-1"><TrendingUp className="h-3.5 w-3.5 text-blue-500" />Total Received</span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="flex items-center justify-end gap-1"><TrendingDown className="h-3.5 w-3.5 text-rose-500" />Total Expenses</span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="flex items-center justify-end gap-1"><Wallet className="h-3.5 w-3.5 text-indigo-500" />Closing Balance</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((stat, idx) => (
                    <TableRow key={stat.id}>
                      <TableCell className="tabular-nums">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{stat.name}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{formatINR(stat.openingBalance)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums text-blue-600">{formatINR(stat.totalReceived)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums text-rose-600">{formatINR(stat.totalExpenses)}</TableCell>
                      <TableCell className={cn('text-right whitespace-nowrap tabular-nums font-medium', stat.balance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                        {formatINR(stat.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2}>Overall Total ({filtered.length} projects)</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{formatINR(overallOpening)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums text-blue-700">{formatINR(overallReceived)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums text-rose-700">{formatINR(overallExpenses)}</TableCell>
                    <TableCell className={cn('text-right whitespace-nowrap tabular-nums', overallBalance >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                      {formatINR(overallBalance)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
      )}
      </TableCard>
    </div>
  );
}
