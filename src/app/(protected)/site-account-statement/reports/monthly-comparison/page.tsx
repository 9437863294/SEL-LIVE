'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, SAS_COLLECTIONS,
  type SASBudget, type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  const [prevCount, setPrevCount] = useState<number | 'all'>(1);

  useEffect(() => { if (!isAuthLoading) void loadAll(); }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, expSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
    } finally {
      setLoading(false);
    }
    // Load budgets separately — a failure here won't blank the whole report
    try {
      const budSnap = await getDocs(collection(db, SAS_COLLECTIONS.budgets));
      setBudgets(budSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)).filter(b => b.budgetType === 'monthly'));
    } catch (err) {
      console.error('[MonthlyComparison] Failed to load budgets:', err);
    }
  }

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );

  const maxPrevMonths = useMemo(() => {
    let earliest: string | null = null;
    expenses.forEach(e => { const ym = toYM(e.expenseDate); if (ym && (!earliest || ym < earliest)) earliest = ym; });
    payments.forEach(py => { const ym = toYM(py.receiptDate); if (ym && (!earliest || ym < earliest)) earliest = ym; });
    budgets.forEach(b => { if (b.period && (!earliest || b.period < earliest)) earliest = b.period; });
    if (!earliest) return 1;
    const [ey, em] = (earliest as string).split('-').map(Number);
    const [cy, cm] = currYM.split('-').map(Number);
    if (ey > cy || (ey === cy && em >= cm)) return 1;
    return Math.max(1, (cy - ey) * 12 + (cm - em));
  }, [expenses, payments, budgets, currYM]);

  const months = useMemo((): string[] => {
    if (prevCount === 'all') {
      const set = new Set<string>();
      expenses.forEach(e => { const ym = toYM(e.expenseDate); if (ym) set.add(ym); });
      payments.forEach(p => { const ym = toYM(p.receiptDate); if (ym) set.add(ym); });
      budgets.forEach(b => { if (b.period) set.add(b.period); });
      set.add(currYM);
      return Array.from(set).sort();
    }
    return Array.from({ length: prevCount + 1 }, (_, i) => shiftMonth(currYM, i - prevCount));
  }, [prevCount, expenses, payments, budgets, currYM]);

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

  // Per-project row data
  const rows = useMemo(() => visibleProjects
    .map(p => {
      const projExp = expenses.filter(e => e.projectId === p.id);
      const projPay = payments.filter(pay => pay.projectId === p.id);
      const monthData = months.map(ym => ({
        ym,
        budget:  budgetLookup.get(`${p.id}:${ym}`) ?? 0,
        received: projPay.filter(pay => toYM(pay.receiptDate) === ym).reduce((s, pay) => s + (pay.receivedAmount || 0), 0),
        expenses: projExp.filter(e => toYM(e.expenseDate) === ym).reduce((s, e) => s + (e.expenseAmount || 0), 0),
      }));
      return {
        project: p,
        monthData,
        hasData: monthData.some(m => m.budget > 0 || m.received > 0 || m.expenses > 0),
      };
    })
    .filter(r => r.hasData),
  [visibleProjects, expenses, payments, budgetLookup, months]);

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
  const perMonthCols = (hasBudgets ? 3 : 2) + 1; // budget? + received + expenses [+ balance] + Δ%

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-800">Month-over-Month Comparison</h1>
          <p className="text-sm text-muted-foreground">
            Budget · Received · Expenses per project — Δ% shows expense change vs previous month
          </p>
        </div>
        {canExport && (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        )}
      </div>

      {/* Range picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-slate-600">Show previous:</span>
        <Select value={prevCount === 'all' ? 'all' : String(prevCount)} onValueChange={v => setPrevCount(v === 'all' ? 'all' : Number(v))}>
          <SelectTrigger className="h-9 w-full sm:w-60 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: maxPrevMonths }, (_, i) => i + 1).map(n => (
              <SelectItem key={n} value={String(n)}>
                {n === 1
                  ? `1 previous month  (${monthLabel(shiftMonth(currYM, -1), true)})`
                  : `${n} months  (${monthLabel(shiftMonth(currYM, -n), true)} → ${monthLabel(shiftMonth(currYM, -1), true)})`}
              </SelectItem>
            ))}
            <SelectItem value="all">All time ({maxPrevMonths + 1} months)</SelectItem>
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
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[65vh]">
              <table className="w-full text-sm border-separate border-spacing-0 min-w-[800px]">
                <thead className="sticky top-0 z-10">
                  {/* Month group headers */}
                  <tr>
                    <th rowSpan={2} className="border-b-2 border-r border-slate-200 bg-slate-100 px-4 py-2.5 text-left font-semibold min-w-[180px] align-bottom whitespace-nowrap">
                      Project
                    </th>
                    {months.map((ym, i) => {
                      const isCurr = ym === currYM;
                      const cols = (hasBudgets ? 3 : 2) + (i > 0 ? 1 : 0); // budget+rec+exp [+balance] [+Δ%]
                      return (
                        <th
                          key={ym}
                          colSpan={cols}
                          className={cn(
                            'border-b border-l px-3 py-2 text-center text-xs font-bold whitespace-nowrap',
                            isCurr ? 'bg-slate-800 text-white border-l-slate-600' : 'bg-slate-100 text-slate-600 border-l-slate-200'
                          )}
                        >
                          {monthLabel(ym, true)}
                          {isCurr && <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-normal">current</span>}
                        </th>
                      );
                    })}
                  </tr>
                  {/* Sub-column headers */}
                  <tr>
                    {months.map((ym, i) => {
                      const isCurr = ym === currYM;
                      const base = 'border-b-2 border-slate-200 px-3 py-1.5 text-right text-[11px] font-semibold whitespace-nowrap';
                      return (
                        <React.Fragment key={ym}>
                          {hasBudgets && (
                            <th className={cn(base, 'border-l', isCurr ? 'bg-slate-700 text-emerald-300 border-l-slate-600' : 'bg-emerald-50 text-emerald-700 border-l-emerald-100')}>
                              Budget
                            </th>
                          )}
                          <th className={cn(base, hasBudgets ? '' : 'border-l', isCurr ? 'bg-slate-700 text-blue-300 border-l-slate-600' : 'bg-blue-50 text-blue-600 border-l-blue-100')}>
                            Received
                          </th>
                          <th className={cn(base, isCurr ? 'bg-slate-700 text-rose-300' : 'bg-rose-50 text-rose-600')}>
                            Expenses
                          </th>
                          {hasBudgets && (
                            <th className={cn(base, isCurr ? 'bg-slate-700 text-slate-300' : 'bg-slate-50 text-slate-500')}>
                              Balance
                            </th>
                          )}
                          {i > 0 && (
                            <th className={cn(base, 'border-l text-center w-[56px]', isCurr ? 'bg-slate-600 text-slate-300 border-l-slate-500' : 'bg-slate-50 text-slate-400 border-l-slate-200')}>
                              Δ%
                            </th>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.project.id} className={idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-100/60'}>
                      <td className="border-b border-r border-slate-100 px-4 py-2.5 whitespace-nowrap">
                        <div className="font-medium text-slate-700 text-[13px]">{r.project.projectName}</div>
                        {r.project.projectCode && <div className="text-[10px] text-muted-foreground">{r.project.projectCode}</div>}
                      </td>
                      {r.monthData.map((m, i) => {
                        const isCurr  = m.ym === currYM;
                        const prev    = i > 0 ? r.monthData[i - 1] : null;
                        const balance = m.budget - m.expenses;
                        const bgCurr  = isCurr ? 'bg-slate-50/60' : '';
                        const cell    = cn('border-b border-slate-100 px-3 py-2 text-right', bgCurr);

                        return (
                          <React.Fragment key={m.ym}>
                            {hasBudgets && (
                              <td className={cn(cell, 'border-l', isCurr ? 'border-l-slate-300' : 'border-l-emerald-100/60')}>
                                {m.budget > 0
                                  ? <span className="text-xs font-semibold text-emerald-700">{formatINR(m.budget)}</span>
                                  : <span className="text-xs text-muted-foreground">—</span>}
                              </td>
                            )}
                            <td className={cn(cell, !hasBudgets && 'border-l', !hasBudgets && (isCurr ? 'border-l-slate-300' : 'border-l-blue-100/60'))}>
                              {m.received > 0
                                ? <span className="text-xs font-semibold text-blue-700">{formatINR(m.received)}</span>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className={cell}>
                              <div>
                                {m.expenses > 0
                                  ? <span className="text-xs font-semibold text-rose-700">{formatINR(m.expenses)}</span>
                                  : <span className="text-xs text-muted-foreground">—</span>}
                                {hasBudgets && m.budget > 0 && m.expenses > 0 && (
                                  <UtilBar actual={m.expenses} budget={m.budget} />
                                )}
                              </div>
                            </td>
                            {hasBudgets && (
                              <td className={cell}>
                                {m.budget > 0
                                  ? <span className={cn('text-xs font-semibold', balance >= 0 ? 'text-indigo-700' : 'text-destructive')}>
                                      {balance >= 0 ? '+' : ''}{formatINR(balance)}
                                    </span>
                                  : <span className="text-xs text-muted-foreground">—</span>}
                              </td>
                            )}
                            {i > 0 && prev && (
                              <td className={cn(cell, 'border-l text-center', isCurr ? 'border-l-slate-300' : 'border-l-slate-200 bg-slate-50/30')}>
                                <div className="flex flex-col gap-0.5 items-center">
                                  <DeltaChip curr={m.expenses} prev={prev.expenses} inverse />
                                </div>
                              </td>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>

                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-[13px]">
                    <td className="border-r border-slate-200 px-4 py-2.5 text-slate-700 whitespace-nowrap">
                      Total ({rows.length} project{rows.length !== 1 ? 's' : ''})
                    </td>
                    {colTotals.map((c, i) => {
                      const isCurr  = c.ym === currYM;
                      const prev    = i > 0 ? colTotals[i - 1] : null;
                      const balance = c.budget - c.expenses;

                      return (
                        <React.Fragment key={c.ym}>
                          {hasBudgets && (
                            <td className={cn('border-l px-3 py-2.5 text-right text-emerald-700', isCurr ? 'border-l-slate-400' : 'border-l-emerald-200')}>
                              {c.budget > 0 ? formatINR(c.budget) : '—'}
                            </td>
                          )}
                          <td className={cn('px-3 py-2.5 text-right text-blue-700', !hasBudgets && 'border-l', !hasBudgets && (isCurr ? 'border-l-slate-400' : 'border-l-blue-200'))}>
                            {formatINR(c.received)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-rose-700">
                            {formatINR(c.expenses)}
                          </td>
                          {hasBudgets && (
                            <td className={cn('px-3 py-2.5 text-right', balance >= 0 ? 'text-indigo-700' : 'text-destructive')}>
                              {c.budget > 0 ? (balance >= 0 ? '+' : '') + formatINR(balance) : '—'}
                            </td>
                          )}
                          {i > 0 && prev && (
                            <td className={cn('border-l px-2 py-2.5 text-center', isCurr ? 'border-l-slate-400 bg-slate-200/40' : 'border-l-slate-300')}>
                              <DeltaChip curr={c.expenses} prev={prev.expenses} inverse />
                            </td>
                          )}
                        </React.Fragment>
                      );
                    })}
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
