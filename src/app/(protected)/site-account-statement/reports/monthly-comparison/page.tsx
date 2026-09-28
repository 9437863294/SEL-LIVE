'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, SAS_COLLECTIONS,
  type SASBudget, type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { loadScopedLedger } from '@/lib/site-account-statement-queries';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowLeftRight, ArrowUp, Download, Loader2, Target, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

function toYM(d: string) { return d?.slice(0, 7) ?? ''; }

function monthLabel(ym: string, short = false) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleString('en-IN', { month: short ? 'short' : 'long', year: 'numeric' });
}

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function pctChange(curr: number, prev: number) {
  if (prev === 0 && curr === 0) return null;
  if (prev === 0) return { pct: null as null, isNew: true as const };
  const pct = ((curr - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) return null;
  return { pct, isNew: false as const };
}

function fmtPct(curr: number, prev: number) {
  const r = pctChange(curr, prev);
  if (!r) return '—';
  if (r.isNew) return 'NEW';
  return `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(1)}%`;
}

function DeltaChip({ curr, prev, inverse = false }: { curr: number; prev: number; inverse?: boolean }) {
  const r = pctChange(curr, prev);
  if (!r) return <span className="text-[10px] text-muted-foreground">—</span>;
  if (r.isNew) return (
    <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-semibold', inverse ? 'text-rose-500' : 'text-emerald-600')}>
      <ArrowUp className="h-2.5 w-2.5" />NEW
    </span>
  );
  const up = r.pct > 0;
  const good = inverse ? !up : up;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-semibold', good ? 'text-emerald-600' : 'text-rose-500')}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(r.pct).toFixed(0)}%
    </span>
  );
}

// Mini bar showing budget utilisation
function UtilBar({ actual, budget }: { actual: number; budget: number }) {
  if (!budget) return null;
  const pct = Math.min((actual / budget) * 100, 100);
  const over = actual > budget;
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <div className="flex-1 bg-slate-100 rounded-full h-1 overflow-hidden min-w-[40px]">
        <div
          className={cn('h-full rounded-full', over ? 'bg-destructive' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('text-[9px] tabular-nums font-semibold w-7 text-right',
        over ? 'text-destructive' : pct >= 80 ? 'text-amber-600' : 'text-emerald-700')}>
        {((actual / budget) * 100).toFixed(0)}%
      </span>
    </div>
  );
}

export default function MonthlyComparisonPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canView    = can('View', `${MODULE}.Reports`);
  const canExport  = can('Export', `${MODULE}.Reports`);

  const today  = new Date();
  const currYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  const [projects,  setProjects]  = useState<SASProject[]>([]);
  const [expenses,  setExpenses]  = useState<SASExpense[]>([]);
  const [payments,  setPayments]  = useState<SASPayment[]>([]);
  const [budgets,   setBudgets]   = useState<SASBudget[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [exporting, setExporting] = useState(false);
  const [prevCount, setPrevCount] = useState(1);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      if (!isAuthLoading) setLoading(false);
      return;
    }

    let active = true;
    const startYM = shiftMonth(currYM, -prevCount);
    const nextMonthStart = `${shiftMonth(currYM, 1)}-01`;

    setLoading(true);

    void (async () => {
      try {
        // Projects first, so the ledger reads below can be bounded to the ones this user may see.
        // The date window was already server-side here; the project scope was not, so a user
        // assigned to one project still received every other project's rows for the window.
        const [pSnap, budSnap] = await Promise.all([
          getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
          getDocs(query(
            collection(db, SAS_COLLECTIONS.budgets),
            where('period', '>=', startYM),
            where('period', '<=', currYM)
          )),
        ]);
        if (!active) return;

        const allProjects = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject));
        setProjects(allProjects.filter(p => p.enabledForSiteAccount));
        setBudgets(
          budSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as SASBudget))
            .filter(b => b.budgetType === 'monthly')
        );

        const ledger = await loadScopedLedger({
          projects: allProjects,
          userId: user?.id,
          canViewAll,
          from: `${startYM}-01`,
          to: `${currYM}-31`,
        });
        if (!active) return;
        setExpenses(ledger.expenses);
        setPayments(ledger.payments);
      } catch (err) {
        console.error('[MonthlyComparison] Failed to load report:', err);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [canView, currYM, isAuthLoading, prevCount, user?.id, canViewAll]);

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );

  const months = useMemo((): string[] => {
    return Array.from({ length: prevCount + 1 }, (_, i) => shiftMonth(currYM, i - prevCount));
  }, [prevCount, currYM]);

  // Budget lookup: projectId × period → amount
  const budgetLookup = useMemo(() => {
    const map = new Map<string, number>();
    budgets.forEach(b => {
      if (!b.period) return;
      map.set(`${b.projectId}:${b.period}`, (map.get(`${b.projectId}:${b.period}`) ?? 0) + b.budgetAmount);
    });
    return map;
  }, [budgets]);

  const hasBudgets = budgets.length > 0;

  const transactionLookup = useMemo(() => {
    const expenseByProjectMonth = new Map<string, number>();
    const receivedByProjectMonth = new Map<string, number>();
    expenses.forEach(expense => {
      const ym = toYM(expense.expenseDate);
      if (!ym) return;
      const key = `${expense.projectId}:${ym}`;
      expenseByProjectMonth.set(key, (expenseByProjectMonth.get(key) ?? 0) + (expense.expenseAmount || 0));
    });
    payments.forEach(payment => {
      const ym = toYM(payment.receiptDate);
      if (!ym) return;
      const key = `${payment.projectId}:${ym}`;
      receivedByProjectMonth.set(key, (receivedByProjectMonth.get(key) ?? 0) + (payment.receivedAmount || 0));
    });
    return { expenseByProjectMonth, receivedByProjectMonth };
  }, [expenses, payments]);

  // Per-project row data
  const rows = useMemo(() => visibleProjects
    .map(p => {
      const monthData = months.map(ym => {
        const key = `${p.id}:${ym}`;
        return {
          ym,
          budget: budgetLookup.get(key) ?? 0,
          received: transactionLookup.receivedByProjectMonth.get(key) ?? 0,
          expenses: transactionLookup.expenseByProjectMonth.get(key) ?? 0,
        };
      });
      return {
        project: p,
        monthData,
        hasData: monthData.some(m => m.budget > 0 || m.received > 0 || m.expenses > 0),
      };
    })
    .filter(r => r.hasData),
  [visibleProjects, budgetLookup, months, transactionLookup]);

  // Grand totals per month column
  const colTotals = useMemo(() => months.map(ym => ({
    ym,
    budget:   rows.reduce((s, r) => s + (r.monthData.find(m => m.ym === ym)?.budget ?? 0), 0),
    received: rows.reduce((s, r) => s + (r.monthData.find(m => m.ym === ym)?.received ?? 0), 0),
    expenses: rows.reduce((s, r) => s + (r.monthData.find(m => m.ym === ym)?.expenses ?? 0), 0),
  })), [months, rows]);

  const currTotals = colTotals.find(c => c.ym === currYM);
  const prevYM     = shiftMonth(currYM, -1);
  const prevTotals = colTotals.find(c => c.ym === prevYM);

  // ── Export ────────────────────────────────────────────────────────────────────
  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Monthly Comparison');
      const cols: Partial<ExcelJS.Column>[] = [{ header: 'Project', key: 'proj', width: 30 }];
      months.forEach((ym, i) => {
        if (hasBudgets) cols.push({ header: `${monthLabel(ym)} Budget`, key: `${ym}_bud`, width: 18 });
        cols.push({ header: `${monthLabel(ym)} Received`, key: `${ym}_rec`, width: 18 });
        cols.push({ header: `${monthLabel(ym)} Expenses`, key: `${ym}_exp`, width: 18 });
        if (hasBudgets) cols.push({ header: `${monthLabel(ym)} Balance`, key: `${ym}_bal`, width: 18 });
        if (i > 0) cols.push({ header: `${monthLabel(ym)} Exp Δ%`, key: `${ym}_pct`, width: 12 });
      });
      ws.columns = cols;
      ws.getRow(1).font = { bold: true };
      rows.forEach(r => {
        const row: Record<string, number | string> = { proj: r.project.projectName };
        r.monthData.forEach((m, i) => {
          if (hasBudgets) row[`${m.ym}_bud`] = m.budget;
          row[`${m.ym}_rec`] = m.received;
          row[`${m.ym}_exp`] = m.expenses;
          if (hasBudgets) row[`${m.ym}_bal`] = m.budget - m.expenses;
          if (i > 0) row[`${m.ym}_pct`] = fmtPct(m.expenses, r.monthData[i - 1].expenses);
        });
        ws.addRow(row);
      });
      const totRow: Record<string, number | string> = { proj: `TOTAL (${rows.length} projects)` };
      colTotals.forEach((c, i) => {
        if (hasBudgets) totRow[`${c.ym}_bud`] = c.budget;
        totRow[`${c.ym}_rec`] = c.received;
        totRow[`${c.ym}_exp`] = c.expenses;
        if (hasBudgets) totRow[`${c.ym}_bal`] = c.budget - c.expenses;
        if (i > 0) totRow[`${c.ym}_pct`] = fmtPct(c.expenses, colTotals[i - 1].expenses);
      });
      ws.addRow(totRow).font = { bold: true };
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'monthly-comparison.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }
  if (!canView) {
    return <p className="text-sm text-muted-foreground">You do not have permission to view reports.</p>;
  }

  // How many sub-columns per month
  const perMonthCols = hasBudgets ? 4 : 2;

  return (
    <div className="space-y-4">

      {/* Header */}
      <PageHeader
        title="Month-over-Month Comparison"
        description="Budget · Received · Expenses per project — Δ% shows expense change vs previous month"
        actions={canExport ? (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        ) : undefined}
      />

      {/* Range picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-slate-600">Show previous:</span>
        <Select value={String(prevCount)} onValueChange={v => setPrevCount(Number(v))}>
          <SelectTrigger className="w-full sm:w-auto" aria-label="Previous months to show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 6, 12].map(n => (
              <SelectItem key={n} value={String(n)}>
                {n === 1
                  ? `1 previous month  (${monthLabel(shiftMonth(currYM, -1), true)})`
                  : `${n} months  (${monthLabel(shiftMonth(currYM, -n), true)} → ${monthLabel(shiftMonth(currYM, -1), true)})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">+ {monthLabel(currYM, true)} (current)</span>
      </div>

      {/* Summary strip — always shows prev vs current */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {/* Prev month */}
        {hasBudgets && (
          <div className="rounded-lg border bg-emerald-50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Target className="h-3 w-3 text-emerald-500" />
              <p className="text-[11px] text-emerald-600 font-medium uppercase tracking-wide">Prev Budget</p>
            </div>
            <p className="text-base font-bold text-emerald-700">{formatINR(prevTotals?.budget ?? 0)}</p>
            <p className="text-[10px] text-emerald-500 mt-0.5">{monthLabel(prevYM, true)}</p>
          </div>
        )}
        <div className="rounded-lg border bg-orange-50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <TrendingDown className="h-3 w-3 text-orange-500" />
            <p className="text-[11px] text-orange-600 font-medium uppercase tracking-wide">Prev Expenses</p>
          </div>
          <p className="text-base font-bold text-orange-700">{formatINR(prevTotals?.expenses ?? 0)}</p>
          {hasBudgets && prevTotals?.budget ? (
            <UtilBar actual={prevTotals.expenses} budget={prevTotals.budget} />
          ) : (
            <p className="text-[10px] text-orange-400 mt-0.5">{monthLabel(prevYM, true)}</p>
          )}
        </div>

        {/* Curr month */}
        {hasBudgets && (
          <div className="rounded-lg border bg-indigo-50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Target className="h-3 w-3 text-indigo-500" />
              <p className="text-[11px] text-indigo-600 font-medium uppercase tracking-wide">This Month Budget</p>
            </div>
            <p className="text-base font-bold text-indigo-700">{formatINR(currTotals?.budget ?? 0)}</p>
            <p className="text-[10px] text-indigo-400 mt-0.5">{monthLabel(currYM, true)}</p>
          </div>
        )}
        <div className="rounded-lg border bg-rose-50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <TrendingDown className="h-3 w-3 text-rose-500" />
            <p className="text-[11px] text-rose-600 font-medium uppercase tracking-wide">This Month Expenses</p>
          </div>
          <p className="text-base font-bold text-rose-700">{formatINR(currTotals?.expenses ?? 0)}</p>
          {hasBudgets && currTotals?.budget ? (
            <UtilBar actual={currTotals.expenses} budget={currTotals.budget} />
          ) : (
            <DeltaChip curr={currTotals?.expenses ?? 0} prev={prevTotals?.expenses ?? 0} inverse />
          )}
        </div>

        {/* Received cards */}
        <div className="rounded-lg border bg-blue-50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <TrendingUp className="h-3 w-3 text-blue-500" />
            <p className="text-[11px] text-blue-600 font-medium uppercase tracking-wide">Prev Received</p>
          </div>
          <p className="text-base font-bold text-blue-700">{formatINR(prevTotals?.received ?? 0)}</p>
          <p className="text-[10px] text-blue-400 mt-0.5">{monthLabel(prevYM, true)}</p>
        </div>
        <div className="rounded-lg border bg-teal-50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Wallet className="h-3 w-3 text-teal-500" />
            <p className="text-[11px] text-teal-600 font-medium uppercase tracking-wide">This Month Received</p>
          </div>
          <p className="text-base font-bold text-teal-700">{formatINR(currTotals?.received ?? 0)}</p>
          <DeltaChip curr={currTotals?.received ?? 0} prev={prevTotals?.received ?? 0} />
        </div>
      </div>

      {/* Main table */}
      {rows.length === 0 ? (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <ArrowLeftRight className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No data found for the selected period.</p>
          </CardContent>
        </Card>
      ) : (
        <TableCard
          title="Project comparison"
          count={rows.length}
          noun="project"
          // Natural height: the two-row month header cannot pin as one band.
          scroll="natural"
        >
              <Table className="min-w-[800px]">
                <TableHeader>
                  {/* Month group headers */}
                  <TableRow>
                    <TableHead rowSpan={2} className="border-r min-w-[180px] align-bottom whitespace-nowrap">
                      Project
                    </TableHead>
                    {months.map((ym, i) => {
                      const isCurr = ym === currYM;
                      const cols = perMonthCols + (i > 0 ? 1 : 0);
                      return (
                        <TableHead
                          key={ym}
                          colSpan={cols}
                          className={cn('border-l text-center whitespace-nowrap', isCurr && 'bg-slate-200/70')}
                        >
                          {monthLabel(ym, true)}
                          {isCurr && <Badge variant="info" className="ml-1.5">current</Badge>}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                  {/* Sub-column headers */}
                  <TableRow>
                    {months.map((ym, i) => {
                      const isCurr = ym === currYM;
                      const base = cn('text-right whitespace-nowrap', isCurr && 'bg-slate-200/70');
                      return (
                        <React.Fragment key={ym}>
                          {hasBudgets && (
                            <TableHead className={cn(base, 'border-l')}>
                              Budget
                            </TableHead>
                          )}
                          <TableHead className={cn(base, !hasBudgets && 'border-l')}>
                            Received
                          </TableHead>
                          <TableHead className={base}>
                            Expenses
                          </TableHead>
                          {hasBudgets && (
                            <TableHead className={base}>
                              Balance
                            </TableHead>
                          )}
                          {i > 0 && (
                            <TableHead className={cn(base, 'border-l text-center w-[56px]')}>
                              Δ%
                            </TableHead>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.project.id}>
                      <TableCell className="border-r whitespace-nowrap">
                        <div className="font-medium">{r.project.projectName}</div>
                        {r.project.projectCode && <div className="text-[10px] text-muted-foreground">{r.project.projectCode}</div>}
                      </TableCell>
                      {r.monthData.map((m, i) => {
                        const isCurr  = m.ym === currYM;
                        const prev    = i > 0 ? r.monthData[i - 1] : null;
                        const balance = m.budget - m.expenses;
                        const cell    = cn('text-right whitespace-nowrap tabular-nums', isCurr && 'bg-slate-50/60');

                        return (
                          <React.Fragment key={m.ym}>
                            {hasBudgets && (
                              <TableCell className={cn(cell, 'border-l')}>
                                {m.budget > 0
                                  ? <span className="font-medium text-emerald-700">{formatINR(m.budget)}</span>
                                  : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            )}
                            <TableCell className={cn(cell, !hasBudgets && 'border-l')}>
                              {m.received > 0
                                ? <span className="font-medium text-blue-700">{formatINR(m.received)}</span>
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className={cell}>
                              <div>
                                {m.expenses > 0
                                  ? <span className="font-medium text-rose-700">{formatINR(m.expenses)}</span>
                                  : <span className="text-muted-foreground">—</span>}
                                {hasBudgets && m.budget > 0 && m.expenses > 0 && (
                                  <UtilBar actual={m.expenses} budget={m.budget} />
                                )}
                              </div>
                            </TableCell>
                            {hasBudgets && (
                              <TableCell className={cell}>
                                {m.budget > 0
                                  ? <span className={cn('font-medium', balance >= 0 ? 'text-indigo-700' : 'text-destructive')}>
                                      {balance >= 0 ? '+' : ''}{formatINR(balance)}
                                    </span>
                                  : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            )}
                            {i > 0 && prev && (
                              <TableCell className={cn(cell, 'border-l text-center')}>
                                <div className="flex flex-col gap-0.5 items-center">
                                  <DeltaChip curr={m.expenses} prev={prev.expenses} inverse />
                                </div>
                              </TableCell>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>

                <TableFooter>
                  <TableRow>
                    <TableCell className="border-r whitespace-nowrap">
                      Total ({rows.length} project{rows.length !== 1 ? 's' : ''})
                    </TableCell>
                    {colTotals.map((c, i) => {
                      const isCurr  = c.ym === currYM;
                      const prev    = i > 0 ? colTotals[i - 1] : null;
                      const balance = c.budget - c.expenses;
                      const cell    = cn('text-right whitespace-nowrap tabular-nums', isCurr && 'bg-slate-200/40');

                      return (
                        <React.Fragment key={c.ym}>
                          {hasBudgets && (
                            <TableCell className={cn(cell, 'border-l text-emerald-700')}>
                              {c.budget > 0 ? formatINR(c.budget) : '—'}
                            </TableCell>
                          )}
                          <TableCell className={cn(cell, 'text-blue-700', !hasBudgets && 'border-l')}>
                            {formatINR(c.received)}
                          </TableCell>
                          <TableCell className={cn(cell, 'text-rose-700')}>
                            {formatINR(c.expenses)}
                          </TableCell>
                          {hasBudgets && (
                            <TableCell className={cn(cell, balance >= 0 ? 'text-indigo-700' : 'text-destructive')}>
                              {c.budget > 0 ? (balance >= 0 ? '+' : '') + formatINR(balance) : '—'}
                            </TableCell>
                          )}
                          {i > 0 && prev && (
                            <TableCell className={cn(cell, 'border-l text-center')}>
                              <DeltaChip curr={c.expenses} prev={prev.expenses} inverse />
                            </TableCell>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableRow>
                </TableFooter>
              </Table>
        </TableCard>
      )}
    </div>
  );
}
