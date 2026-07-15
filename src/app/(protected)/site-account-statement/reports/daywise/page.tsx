'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, SAS_COLLECTIONS,
  type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CalendarDays, Download, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string): string {
  // iso = "YYYY-MM-DD"
  try {
    const [, m, d] = iso.split('-');
    return `${parseInt(d, 10)} ${MONTH_SHORT[parseInt(m, 10) - 1]}`;
  } catch { return iso; }
}
function formatDateFull(iso: string): string {
  try {
    const [y, m, d] = iso.split('-');
    return `${parseInt(d, 10)} ${MONTH_SHORT[parseInt(m, 10) - 1]} ${y}`;
  } catch { return iso; }
}

interface DayTx {
  kind: 'receipt' | 'expense';
  amount: number;
  label: string;        // main detail line
  sublabel?: string;    // secondary detail (mode, vendor, etc.)
  projectName?: string; // shown only when "all projects" selected
}

interface DayGroup {
  date: string;        // YYYY-MM-DD
  txs: DayTx[];
  totalReceipts: number;
  totalExpenses: number;
  net: number;
  closingBalance: number;
}

export default function DaywiseStatementPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View',   `${MODULE}.All Projects`);
  const canView    = can('View',   `${MODULE}.Reports`) || canViewAll;
  const canExport  = can('Export', `${MODULE}.Reports`);

  const [projects,  setProjects]  = useState<SASProject[]>([]);
  const [payments,  setPayments]  = useState<SASPayment[]>([]);
  const [expenses,  setExpenses]  = useState<SASExpense[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [exporting, setExporting] = useState(false);

  const [filterProject, setFilterProject] = useState('');
  const [filterFrom,    setFilterFrom]    = useState('');
  const [filterTo,      setFilterTo]      = useState('');

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  }, [isAuthLoading]);

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

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );

  const visibleProjectIds = useMemo(
    () => canViewAll ? null : new Set(visibleProjects.map(p => p.id)),
    [visibleProjects, canViewAll]
  );

  const dayGroups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, { txs: DayTx[]; rec: number; exp: number }>();

    const ensure = (date: string) => {
      if (!map.has(date)) map.set(date, { txs: [], rec: 0, exp: 0 });
      return map.get(date)!;
    };

    payments.forEach(p => {
      if (visibleProjectIds && !visibleProjectIds.has(p.projectId)) return;
      if (filterProject && p.projectId !== filterProject) return;
      if (!p.receiptDate) return;
      if (filterFrom && p.receiptDate < filterFrom) return;
      if (filterTo   && p.receiptDate > filterTo)   return;

      const g = ensure(p.receiptDate);
      const amount = p.receivedAmount || 0;
      g.rec += amount;

      const label = `Receipt from HO${p.referenceNo ? ` · Ref: ${p.referenceNo}` : ''}${p.receivedBy ? ` · By: ${p.receivedBy}` : ''}`;
      const sublabel = [p.paymentMode, p.remarks].filter(Boolean).join(' · ') || undefined;
      g.txs.push({
        kind: 'receipt',
        amount,
        label,
        sublabel,
        projectName: !filterProject ? p.projectName : undefined,
      });
    });

    expenses.forEach(e => {
      if (visibleProjectIds && !visibleProjectIds.has(e.projectId)) return;
      if (filterProject && e.projectId !== filterProject) return;
      if (!e.expenseDate) return;
      if (filterFrom && e.expenseDate < filterFrom) return;
      if (filterTo   && e.expenseDate > filterTo)   return;

      const g = ensure(e.expenseDate);
      const amount = e.expenseAmount || 0;
      g.exp += amount;

      const catLabel = e.expenseSubCategory
        ? `${e.expenseCategory} › ${e.expenseSubCategory}`
        : e.expenseCategory;
      const label = e.narration
        ? `${catLabel} — ${e.narration}`
        : `${catLabel}${e.expensedBy ? ` — ${e.expensedBy}` : ''}`;
      const sublabel = [
        e.paymentMode,
        e.vendorPartyName && `Vendor: ${e.vendorPartyName}`,
        e.billNo && `Bill: ${e.billNo}`,
        e.remarks,
      ].filter(Boolean).join(' · ') || undefined;

      g.txs.push({
        kind: 'expense',
        amount,
        label,
        sublabel,
        projectName: !filterProject ? e.projectName : undefined,
      });
    });

    // Sort dates ascending and compute running balance
    const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    let balance = 0;
    return sorted.map(([date, { txs, rec, exp }]) => {
      // Within a day, sort receipts first then expenses, each by amount desc
      txs.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'receipt' ? -1 : 1;
        return b.amount - a.amount;
      });
      const net = rec - exp;
      balance += net;
      return { date, txs, totalReceipts: rec, totalExpenses: exp, net, closingBalance: balance };
    });
  }, [payments, expenses, visibleProjectIds, filterProject, filterFrom, filterTo]);

  const grandTotals = useMemo(() => ({
    receipts: dayGroups.reduce((s, d) => s + d.totalReceipts, 0),
    expenses: dayGroups.reduce((s, d) => s + d.totalExpenses, 0),
    net:      dayGroups.reduce((s, d) => s + d.net, 0),
    txCount:  dayGroups.reduce((s, d) => s + d.txs.length, 0),
  }), [dayGroups]);

  const selectedProjectName = visibleProjects.find(p => p.id === filterProject)?.projectName || 'All Projects';

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Day-wise Statement');

      // Title
      ws.mergeCells('A1:G1');
      ws.getCell('A1').value = `Day-wise Statement — ${selectedProjectName}`;
      ws.getCell('A1').font = { bold: true, size: 13 };
      if (filterFrom || filterTo) {
        ws.mergeCells('A2:G2');
        ws.getCell('A2').value = `Period: ${filterFrom || 'Beginning'} to ${filterTo || 'Date'}`;
      }

      ws.addRow([]);
      const hRow = ws.addRow(['Date', 'Type', 'Particulars', 'Project', 'Receipt (₹)', 'Expense (₹)', 'Closing Balance (₹)']);
      hRow.font = { bold: true };

      dayGroups.forEach(day => {
        day.txs.forEach(tx => {
          ws.addRow([
            day.date,
            tx.kind === 'receipt' ? 'Receipt' : 'Expense',
            `${tx.label}${tx.sublabel ? `  [${tx.sublabel}]` : ''}`,
            tx.projectName || '',
            tx.kind === 'receipt' ? tx.amount : '',
            tx.kind === 'expense' ? tx.amount : '',
            '',
          ]);
        });
        // Day summary row
        const summRow = ws.addRow([
          `${day.date} (Day Total)`, '', '', '',
          day.totalReceipts || '',
          day.totalExpenses || '',
          day.closingBalance,
        ]);
        summRow.font = { bold: true };
        summRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
        ws.addRow([]);
      });

      // Grand total
      const gtRow = ws.addRow(['GRAND TOTAL', '', '', '', grandTotals.receipts, grandTotals.expenses, grandTotals.net]);
      gtRow.font = { bold: true, size: 12 };

      ws.columns = [
        { key: 'col1', width: 22 },
        { key: 'col2', width: 12 },
        { key: 'col3', width: 42 },
        { key: 'col4', width: 24 },
        { key: 'col5', width: 16 },
        { key: 'col6', width: 16 },
        { key: 'col7', width: 18 },
      ];

      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = `daywise-statement-${selectedProjectName}.xlsx`; a.click();
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
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Day-wise Statement</h1>
          <p className="text-sm text-muted-foreground">Every receipt and expense grouped by date with running balance</p>
        </div>
        {canExport && dayGroups.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        )}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Project</Label>
          <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Projects</SelectItem>
              {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">From Date</Label>
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To Date</Label>
          <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-9 text-sm" />
        </div>
      </div>

      {/* Grand summary tiles */}
      {dayGroups.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border bg-blue-50 px-4 py-3 text-center">
            <p className="text-xs text-muted-foreground">Total Receipts</p>
            <p className="text-lg font-bold text-blue-700">{formatINR(grandTotals.receipts)}</p>
          </div>
          <div className="rounded-xl border bg-rose-50 px-4 py-3 text-center">
            <p className="text-xs text-muted-foreground">Total Expenses</p>
            <p className="text-lg font-bold text-rose-700">{formatINR(grandTotals.expenses)}</p>
          </div>
          <div className={cn('rounded-xl border px-4 py-3 text-center', grandTotals.net >= 0 ? 'bg-emerald-50' : 'bg-destructive/10')}>
            <p className="text-xs text-muted-foreground">Net Balance</p>
            <p className={cn('text-lg font-bold', grandTotals.net >= 0 ? 'text-emerald-700' : 'text-destructive')}>
              {formatINR(grandTotals.net)}
            </p>
          </div>
        </div>
      )}

      {/* Day-wise list */}
      {dayGroups.length === 0 ? (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <CalendarDays className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No transactions found for the selected filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {dayGroups.map(day => (
            <Card key={day.date} className="bg-white/80 backdrop-blur-sm overflow-hidden">
              {/* Day header */}
              <div className="flex items-center justify-between gap-3 flex-wrap border-b bg-slate-50/80 px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border bg-white text-center shadow-sm">
                    <span className="text-[10px] font-medium text-muted-foreground leading-tight">
                      {day.date.slice(5, 7) && MONTH_SHORT[parseInt(day.date.slice(5, 7), 10) - 1]}
                    </span>
                    <span className="text-base font-bold leading-tight text-slate-800">
                      {parseInt(day.date.slice(8, 10), 10)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{formatDateFull(day.date)}</p>
                    <p className="text-xs text-muted-foreground">{day.txs.length} transaction{day.txs.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  {day.totalReceipts > 0 && (
                    <span className="flex items-center gap-1 text-blue-600 font-medium">
                      <TrendingUp className="h-3.5 w-3.5" />
                      {formatINR(day.totalReceipts)}
                    </span>
                  )}
                  {day.totalExpenses > 0 && (
                    <span className="flex items-center gap-1 text-rose-600 font-medium">
                      <TrendingDown className="h-3.5 w-3.5" />
                      {formatINR(day.totalExpenses)}
                    </span>
                  )}
                  <div className="h-4 w-px bg-border" />
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Closing Balance</p>
                    <p className={cn('text-sm font-bold', day.closingBalance >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                      {formatINR(day.closingBalance)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Individual transactions */}
              <CardContent className="p-0">
                {day.txs.map((tx, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-start gap-3 border-b last:border-b-0 px-4 py-2.5 transition-colors hover:bg-muted/20',
                      tx.kind === 'receipt' ? 'border-l-2 border-l-blue-300' : 'border-l-2 border-l-rose-300'
                    )}
                  >
                    {/* Kind indicator */}
                    <div className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                      tx.kind === 'receipt' ? 'bg-blue-100' : 'bg-rose-100'
                    )}>
                      {tx.kind === 'receipt'
                        ? <TrendingUp className="h-3.5 w-3.5 text-blue-600" />
                        : <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
                      }
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 leading-tight">{tx.label}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                        {tx.projectName && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{tx.projectName}</Badge>
                        )}
                        {tx.sublabel && (
                          <p className="text-xs text-muted-foreground">{tx.sublabel}</p>
                        )}
                      </div>
                    </div>

                    {/* Amount */}
                    <div className="text-right shrink-0">
                      <p className={cn(
                        'text-sm font-semibold',
                        tx.kind === 'receipt' ? 'text-blue-600' : 'text-rose-600'
                      )}>
                        {tx.kind === 'receipt' ? '+' : '−'}{formatINR(tx.amount)}
                      </p>
                    </div>
                  </div>
                ))}

                {/* Day net summary bar */}
                <div className="flex items-center justify-between gap-4 bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center gap-3">
                    {day.totalReceipts > 0 && <span className="text-blue-600">Receipts: {formatINR(day.totalReceipts)}</span>}
                    {day.totalExpenses > 0 && <span className="text-rose-600">Expenses: {formatINR(day.totalExpenses)}</span>}
                  </span>
                  <span className={cn('font-bold', day.net >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                    Day Net: {day.net >= 0 ? '+' : ''}{formatINR(day.net)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Grand total footer */}
          <div className="rounded-xl border bg-slate-100 px-5 py-3 flex items-center justify-between flex-wrap gap-3 text-sm font-bold">
            <span className="text-slate-700">
              Grand Total — {dayGroups.length} day{dayGroups.length !== 1 ? 's' : ''} · {grandTotals.txCount} transactions
            </span>
            <span className="flex items-center gap-4">
              <span className="text-blue-700">{formatINR(grandTotals.receipts)}</span>
              <span className="text-slate-400 font-normal">−</span>
              <span className="text-rose-700">{formatINR(grandTotals.expenses)}</span>
              <span className="text-slate-400 font-normal">=</span>
              <span className={grandTotals.net >= 0 ? 'text-emerald-700' : 'text-destructive'}>
                {formatINR(grandTotals.net)}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
