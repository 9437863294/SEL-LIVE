'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASExpense, type SASPayment, type SASProject } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowLeftRight, ArrowUp, Download, Loader2, Minus } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

function toYM(dateStr: string) {
  return dateStr?.slice(0, 7) ?? '';
}

function monthLabel(ym: string, short = false) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleString('en-IN', {
    month: short ? 'short' : 'long',
    year: 'numeric',
  });
}

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Centralised % change calculator — single source of truth used by both UI and Excel.
// Returns null  → no comparison to show (both zero, or identical)
// isNew = true  → prev was 0 but curr has a value (∞ increase — show "NEW")
// pct           → actual percentage change when prev > 0
function pctChange(curr: number, prev: number): { pct: number; isNew: false } | { pct: null; isNew: true } | null {
  if (prev === 0 && curr === 0) return null;
  if (prev === 0) return { pct: null, isNew: true };
  const pct = ((curr - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) return null; // treat as no change to avoid ±0% noise
  return { pct, isNew: false };
}

// Formatted string for Excel cells
function fmtPct(curr: number, prev: number): string {
  const r = pctChange(curr, prev);
  if (!r) return '—';
  if (r.isNew) return 'NEW';
  return `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(1)}%`;
}

function Delta({ curr, prev, type }: { curr: number; prev: number; type: 'rec' | 'exp' }) {
  const r = pctChange(curr, prev);
  if (!r) return null;

  // Appeared from zero — colour by type (new received = good, new expense = bad)
  if (r.isNew) {
    const good = type === 'rec';
    return (
      <span className={cn('flex items-center gap-0.5 text-[10px] font-semibold justify-end', good ? 'text-emerald-600' : 'text-rose-500')}>
        <ArrowUp className="h-2.5 w-2.5" />NEW
      </span>
    );
  }

  const up   = r.pct > 0;
  const good = type === 'rec' ? up : !up; // received↑ good, expense↑ bad
  return (
    <span className={cn('flex items-center gap-0.5 text-[10px] font-semibold justify-end', good ? 'text-emerald-600' : 'text-rose-600')}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(r.pct).toFixed(0)}%
    </span>
  );
}

export default function MonthlyComparisonPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canView    = can('View', `${MODULE}.Reports`) || canViewAll;
  const canExport  = can('Export', `${MODULE}.Reports`);

  const today  = new Date();
  const currYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  const [projects,   setProjects]   = useState<SASProject[]>([]);
  const [expenses,   setExpenses]   = useState<SASExpense[]>([]);
  const [payments,   setPayments]   = useState<SASPayment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [exporting,  setExporting]  = useState(false);
  // prevCount: how many previous months to include before current. 'all' = all time.
  const [prevCount,  setPrevCount]  = useState<number | 'all'>(1);

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  }, [isAuthLoading]);

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
  }

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );

  // Compute how many previous months exist in the data
  const maxPrevMonths = useMemo(() => {
    let earliest: string | null = null;
    expenses.forEach(e => { const ym = toYM(e.expenseDate); if (ym && (!earliest || ym < earliest)) earliest = ym; });
    payments.forEach(p => { const ym = toYM(p.receiptDate); if (ym && (!earliest || ym < earliest)) earliest = ym; });
    if (!earliest || earliest >= currYM) return 1;
    const [ey, em] = earliest.split('-').map(Number);
    const [cy, cm] = currYM.split('-').map(Number);
    return Math.max(1, (cy - ey) * 12 + (cm - em));
  }, [expenses, payments, currYM]);

  // Build the ordered list of months to display
  const months = useMemo((): string[] => {
    if (prevCount === 'all') {
      const set = new Set<string>();
      expenses.forEach(e => { const ym = toYM(e.expenseDate); if (ym) set.add(ym); });
      payments.forEach(p => { const ym = toYM(p.receiptDate); if (ym) set.add(ym); });
      set.add(currYM);
      return Array.from(set).sort();
    }
    return Array.from({ length: prevCount + 1 }, (_, i) => shiftMonth(currYM, i - prevCount));
  }, [prevCount, expenses, payments, currYM]);

  const rows = useMemo(() => {
    return visibleProjects
      .map(p => {
        const projExp = expenses.filter(e => e.projectId === p.id);
        const projPay = payments.filter(pay => pay.projectId === p.id);
        const monthData = months.map(ym => ({
          ym,
          rec: projPay.filter(pay => toYM(pay.receiptDate) === ym).reduce((s, pay) => s + (pay.receivedAmount || 0), 0),
          exp: projExp.filter(e => toYM(e.expenseDate) === ym).reduce((s, e) => s + (e.expenseAmount || 0), 0),
        }));
        return { project: p, monthData, hasData: monthData.some(m => m.rec > 0 || m.exp > 0) };
      })
      .filter(r => r.hasData);
  }, [visibleProjects, expenses, payments, months]);

  const colTotals = useMemo(() =>
    months.map(ym => ({
      ym,
      rec: rows.reduce((s, r) => s + (r.monthData.find(m => m.ym === ym)?.rec ?? 0), 0),
      exp: rows.reduce((s, r) => s + (r.monthData.find(m => m.ym === ym)?.exp ?? 0), 0),
    })),
    [months, rows]
  );

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Monthly Comparison');
      const cols: Partial<ExcelJS.Column>[] = [{ header: 'Project', key: 'project', width: 30 }];
      months.forEach((ym, i) => {
        cols.push({ header: `${monthLabel(ym)} Received (₹)`, key: `${ym}_rec`, width: 22 });
        cols.push({ header: `${monthLabel(ym)} Expenses (₹)`, key: `${ym}_exp`, width: 22 });
        if (i > 0) {
          cols.push({ header: `${monthLabel(ym)} Recv Δ%`, key: `${ym}_rec_pct`, width: 14 });
          cols.push({ header: `${monthLabel(ym)} Exp Δ%`,  key: `${ym}_exp_pct`, width: 14 });
        }
      });
      ws.columns = cols;
      ws.getRow(1).font = { bold: true };
      rows.forEach(r => {
        const row: Record<string, number | string> = { project: r.project.projectName };
        r.monthData.forEach((m, i) => {
          row[`${m.ym}_rec`] = m.rec;
          row[`${m.ym}_exp`] = m.exp;
          if (i > 0) {
            const prev = r.monthData[i - 1];
            row[`${m.ym}_rec_pct`] = fmtPct(m.rec, prev.rec);
            row[`${m.ym}_exp_pct`] = fmtPct(m.exp, prev.exp);
          }
        });
        ws.addRow(row);
      });
      const totRow: Record<string, number | string> = { project: `TOTAL (${rows.length} projects)` };
      colTotals.forEach((c, i) => {
        totRow[`${c.ym}_rec`] = c.rec;
        totRow[`${c.ym}_exp`] = c.exp;
        if (i > 0) {
          const prev = colTotals[i - 1];
          totRow[`${c.ym}_rec_pct`] = fmtPct(c.rec, prev.rec);
          totRow[`${c.ym}_exp_pct`] = fmtPct(c.exp, prev.exp);
        }
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

  const currIdx = colTotals.findIndex(c => c.ym === currYM);
  const currTotals = colTotals[currIdx];
  const prevTotals = currIdx > 0 ? colTotals[currIdx - 1] : undefined;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Month-over-Month Project Comparison</h1>
          <p className="text-sm text-muted-foreground">
            Receipts &amp; expenses per project — {months.length} month{months.length !== 1 ? 's' : ''} — Δ% shows change vs previous month
          </p>
        </div>
        {canExport && (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        )}
      </div>

      {/* Range dropdown */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-slate-600">Previous months:</span>
        <Select
          value={prevCount === 'all' ? 'all' : String(prevCount)}
          onValueChange={v => setPrevCount(v === 'all' ? 'all' : Number(v))}
        >
          <SelectTrigger className="h-9 w-56 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: maxPrevMonths }, (_, i) => i + 1).map(n => (
              <SelectItem key={n} value={String(n)}>
                {n === 1
                  ? `1 previous month  (${monthLabel(shiftMonth(currYM, -1), true)})`
                  : `${n} previous months  (${monthLabel(shiftMonth(currYM, -n), true)} → ${monthLabel(shiftMonth(currYM, -1), true)})`
                }
              </SelectItem>
            ))}
            <SelectItem value="all">All time ({maxPrevMonths + 1} months)</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          + {monthLabel(currYM, true)} (current)
        </span>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border bg-emerald-50 px-3 py-2.5">
          <p className="text-[11px] text-emerald-500 font-medium uppercase tracking-wide">This Month Received</p>
          <p className="text-base font-bold text-emerald-700">{formatINR(currTotals?.rec ?? 0)}</p>
          {prevTotals && <Delta curr={currTotals?.rec ?? 0} prev={prevTotals.rec} type="rec" />}
        </div>
        <div className="rounded-lg border bg-rose-50 px-3 py-2.5">
          <p className="text-[11px] text-rose-500 font-medium uppercase tracking-wide">This Month Expenses</p>
          <p className="text-base font-bold text-rose-700">{formatINR(currTotals?.exp ?? 0)}</p>
          {prevTotals && <Delta curr={currTotals?.exp ?? 0} prev={prevTotals.exp} type="exp" />}
        </div>
        <div className="rounded-lg border bg-blue-50 px-3 py-2.5">
          <p className="text-[11px] text-blue-500 font-medium uppercase tracking-wide">Prev Month Received</p>
          <p className="text-base font-bold text-blue-700">{formatINR(prevTotals?.rec ?? 0)}</p>
          <p className="text-[11px] text-blue-400">{prevTotals ? monthLabel(prevTotals.ym, true) : '—'}</p>
        </div>
        <div className="rounded-lg border bg-orange-50 px-3 py-2.5">
          <p className="text-[11px] text-orange-500 font-medium uppercase tracking-wide">Prev Month Expenses</p>
          <p className="text-base font-bold text-orange-700">{formatINR(prevTotals?.exp ?? 0)}</p>
          <p className="text-[11px] text-orange-400">{prevTotals ? monthLabel(prevTotals.ym, true) : '—'}</p>
        </div>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <ArrowLeftRight className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No activity found for the selected period.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[65vh]">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="sticky top-0 z-10">
                  {/* Row 1 — month group headers */}
                  <tr>
                    <th
                      rowSpan={2}
                      className="border-b-2 border-r border-slate-200 bg-slate-100 px-4 py-2.5 text-left font-semibold text-slate-700 min-w-[180px] align-bottom whitespace-nowrap"
                    >
                      Project
                    </th>
                    {months.map((ym, i) => (
                      <th
                        key={ym}
                        colSpan={i === 0 ? 2 : 3}
                        className={cn(
                          'border-b border-l px-3 py-2 text-center text-xs font-bold whitespace-nowrap',
                          ym === currYM
                            ? 'bg-slate-800 text-white border-l-slate-600'
                            : 'bg-slate-100 text-slate-600 border-l-slate-200'
                        )}
                      >
                        {monthLabel(ym, true)}
                        {ym === currYM && (
                          <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-normal">
                            current
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                  {/* Row 2 — Received / Expenses / Δ% sub-headers */}
                  <tr>
                    {months.map((ym, i) => (
                      <React.Fragment key={ym}>
                        <th className={cn(
                          'border-b-2 border-l border-slate-200 px-3 py-1.5 text-right text-[11px] font-semibold whitespace-nowrap',
                          ym === currYM ? 'bg-slate-700 text-blue-300 border-l-slate-600' : 'bg-blue-50 text-blue-600 border-l-blue-100'
                        )}>
                          Received
                        </th>
                        <th className={cn(
                          'border-b-2 border-slate-200 px-3 py-1.5 text-right text-[11px] font-semibold whitespace-nowrap',
                          ym === currYM ? 'bg-slate-700 text-rose-300' : 'bg-rose-50 text-rose-600'
                        )}>
                          Expenses
                        </th>
                        {i > 0 && (
                          <th className={cn(
                            'border-b-2 border-l border-slate-200 px-2 py-1.5 text-center text-[11px] font-semibold whitespace-nowrap w-[60px]',
                            ym === currYM ? 'bg-slate-600 text-slate-200 border-l-slate-500' : 'bg-slate-50 text-slate-400 border-l-slate-200'
                          )}>
                            Δ%
                          </th>
                        )}
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {rows.map((r, idx) => (
                    <tr
                      key={r.project.id}
                      className={idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/50 hover:bg-slate-100/50'}
                    >
                      <td className="border-b border-r border-slate-100 px-4 py-2.5 whitespace-nowrap">
                        <div className="font-medium text-slate-700">{r.project.projectName}</div>
                        {r.project.projectCode && (
                          <div className="text-[11px] text-muted-foreground">{r.project.projectCode}</div>
                        )}
                      </td>
                      {r.monthData.map((m, i) => {
                        const prev = i > 0 ? r.monthData[i - 1] : null;
                        return (
                          <React.Fragment key={m.ym}>
                            <td className={cn(
                              'border-b border-l border-slate-100 px-3 py-2 text-right',
                              m.ym === currYM ? 'bg-slate-50/70 border-l-slate-300' : 'border-l-blue-100/60'
                            )}>
                              {m.rec > 0
                                ? <span className="text-xs font-semibold text-blue-700">{formatINR(m.rec)}</span>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className={cn(
                              'border-b border-slate-100 px-3 py-2 text-right',
                              m.ym === currYM ? 'bg-slate-50/70' : ''
                            )}>
                              {m.exp > 0
                                ? <span className="text-xs font-semibold text-rose-700">{formatINR(m.exp)}</span>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            {i > 0 && prev && (
                              <td className={cn(
                                'border-b border-l border-slate-100 px-2 py-2 w-[60px]',
                                m.ym === currYM ? 'bg-slate-50/50 border-l-slate-300' : 'border-l-slate-200 bg-slate-50/30'
                              )}>
                                <div className="flex flex-col gap-0.5 items-end">
                                  <Delta curr={m.rec} prev={prev.rec} type="rec" />
                                  <Delta curr={m.exp} prev={prev.exp} type="exp" />
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
                  <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
                    <td className="border-r border-slate-200 px-4 py-2.5 text-slate-700 whitespace-nowrap">
                      Total ({rows.length} projects)
                    </td>
                    {colTotals.map((c, i) => {
                      const prev = i > 0 ? colTotals[i - 1] : null;
                      return (
                        <React.Fragment key={c.ym}>
                          <td className={cn(
                            'border-l px-3 py-2.5 text-right',
                            c.ym === currYM ? 'border-l-slate-400 text-blue-700' : 'border-l-blue-100 text-blue-700'
                          )}>
                            {formatINR(c.rec)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-rose-700">
                            {formatINR(c.exp)}
                          </td>
                          {i > 0 && prev && (
                            <td className={cn(
                              'border-l px-2 py-2.5',
                              c.ym === currYM ? 'border-l-slate-400 bg-slate-200/50' : 'border-l-slate-200'
                            )}>
                              <div className="flex flex-col gap-0.5 items-end">
                                <Delta curr={c.rec} prev={prev.rec} type="rec" />
                                <Delta curr={c.exp} prev={prev.exp} type="exp" />
                              </div>
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
