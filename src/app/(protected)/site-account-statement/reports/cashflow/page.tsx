'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASExpense, type SASPayment, type SASProject } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Activity, Download, Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function CashFlowPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canView    = can('View', `${MODULE}.Reports`) || canViewAll;
  const canExport  = can('Export', `${MODULE}.Reports`);

  const [projects, setProjects] = useState<SASProject[]>([]);
  const [payments, setPayments] = useState<SASPayment[]>([]);
  const [expenses, setExpenses] = useState<SASExpense[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [exporting, setExporting] = useState(false);

  const currentYear = new Date().getFullYear();
  const [filterProject, setFilterProject] = useState('');
  const [filterYear,    setFilterYear]    = useState(String(currentYear));

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

  const userProjectIds = useMemo(
    () => canViewAll ? null : new Set(visibleProjects.map(p => p.id)),
    [visibleProjects, canViewAll]
  );

  const availableYears = useMemo(() => {
    const years = new Set([String(currentYear)]);
    payments.forEach(p => { if (p.receiptDate) years.add(p.receiptDate.slice(0, 4)); });
    expenses.forEach(e => { if (e.expenseDate)  years.add(e.expenseDate.slice(0, 4));  });
    return Array.from(years).sort().reverse();
  }, [payments, expenses, currentYear]);

  const monthlyData = useMemo(() => {
    const rows = MONTH_LABELS.map((label, month) => ({ month, label, receipts: 0, expenses: 0, net: 0, balance: 0 }));

    payments.forEach(p => {
      if (userProjectIds && !userProjectIds.has(p.projectId)) return;
      if (filterProject && p.projectId !== filterProject) return;
      if (!p.receiptDate?.startsWith(filterYear)) return;
      const m = parseInt(p.receiptDate.slice(5, 7), 10) - 1;
      if (m >= 0 && m < 12) rows[m].receipts += p.receivedAmount || 0;
    });

    expenses.forEach(e => {
      if (userProjectIds && !userProjectIds.has(e.projectId)) return;
      if (filterProject && e.projectId !== filterProject) return;
      if (!e.expenseDate?.startsWith(filterYear)) return;
      const m = parseInt(e.expenseDate.slice(5, 7), 10) - 1;
      if (m >= 0 && m < 12) rows[m].expenses += e.expenseAmount || 0;
    });

    let running = 0;
    rows.forEach(r => { r.net = r.receipts - r.expenses; running += r.net; r.balance = running; });
    return rows;
  }, [payments, expenses, userProjectIds, filterProject, filterYear]);

  const maxFlow = useMemo(
    () => Math.max(1, ...monthlyData.map(m => Math.max(m.receipts, m.expenses))),
    [monthlyData]
  );

  const totals = useMemo(() => ({
    receipts: monthlyData.reduce((s, m) => s + m.receipts, 0),
    expenses: monthlyData.reduce((s, m) => s + m.expenses, 0),
    net:      monthlyData.reduce((s, m) => s + m.net, 0),
  }), [monthlyData]);

  const hasData = monthlyData.some(m => m.receipts > 0 || m.expenses > 0);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Cash Flow');
      ws.columns = [
        { header: 'Month',         key: 'label',    width: 14 },
        { header: 'Receipts (₹)',  key: 'receipts', width: 18 },
        { header: 'Expenses (₹)', key: 'expenses', width: 18 },
        { header: 'Net (₹)',       key: 'net',      width: 14 },
        { header: 'Balance (₹)',   key: 'balance',  width: 16 },
      ];
      ws.getRow(1).font = { bold: true };
      monthlyData.forEach(m => ws.addRow({ label: m.label, receipts: m.receipts || '', expenses: m.expenses || '', net: m.net, balance: m.balance }));
      ws.addRow({ label: `Total (${filterYear})`, receipts: totals.receipts, expenses: totals.expenses, net: totals.net, balance: totals.net }).font = { bold: true };
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = `cash-flow-${filterYear}.xlsx`; a.click();
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
          <h1 className="text-lg font-bold text-slate-800">Month-wise Cash Flow</h1>
          <p className="text-sm text-muted-foreground">Monthly receipts, expenses and running balance for {filterYear}</p>
        </div>
        {canExport && (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm w-[200px]"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Projects</SelectItem>
            {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterYear} onValueChange={setFilterYear}>
          <SelectTrigger className="h-9 text-sm w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {availableYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-blue-50 px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">Total Receipts</p>
          <p className="text-lg font-bold text-blue-700">{formatINR(totals.receipts)}</p>
        </div>
        <div className="rounded-xl border bg-rose-50 px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">Total Expenses</p>
          <p className="text-lg font-bold text-rose-700">{formatINR(totals.expenses)}</p>
        </div>
        <div className={cn('rounded-xl border px-4 py-3 text-center', totals.net >= 0 ? 'bg-emerald-50' : 'bg-destructive/10')}>
          <p className="text-xs text-muted-foreground">Net Cash Flow</p>
          <p className={cn('text-lg font-bold', totals.net >= 0 ? 'text-emerald-700' : 'text-destructive')}>{formatINR(totals.net)}</p>
        </div>
      </div>

      {!hasData ? (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Activity className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No transactions found for {filterYear}.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium">Month</th>
                    <th className="px-4 py-2.5 text-right font-medium">Receipts (₹)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Expenses (₹)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Net (₹)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Running Balance</th>
                    <th className="px-4 py-2.5 text-left font-medium w-[130px]">Flow</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map(m => (
                    <tr key={m.month} className={cn('border-b hover:bg-muted/20 transition-colors', m.receipts === 0 && m.expenses === 0 && 'opacity-40')}>
                      <td className="px-4 py-2.5 font-medium">{m.label}</td>
                      <td className="px-4 py-2.5 text-right text-blue-600">{m.receipts > 0 ? formatINR(m.receipts) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-rose-600">{m.expenses > 0 ? formatINR(m.expenses) : '—'}</td>
                      <td className={cn('px-4 py-2.5 text-right font-semibold',
                        m.net > 0 ? 'text-emerald-600' : m.net < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                        {m.net !== 0 ? formatINR(m.net) : '—'}
                      </td>
                      <td className={cn('px-4 py-2.5 text-right font-semibold', m.balance >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                        {formatINR(m.balance)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-blue-500 w-2">R</span>
                            <div className="flex-1 bg-blue-100 rounded-full h-1.5 overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(m.receipts / maxFlow) * 100}%` }} />
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-rose-500 w-2">E</span>
                            <div className="flex-1 bg-rose-100 rounded-full h-1.5 overflow-hidden">
                              <div className="h-full bg-rose-500 rounded-full" style={{ width: `${(m.expenses / maxFlow) * 100}%` }} />
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-bold">
                    <td className="px-4 py-2.5">Total ({filterYear})</td>
                    <td className="px-4 py-2.5 text-right text-blue-700">{formatINR(totals.receipts)}</td>
                    <td className="px-4 py-2.5 text-right text-rose-700">{formatINR(totals.expenses)}</td>
                    <td className={cn('px-4 py-2.5 text-right', totals.net >= 0 ? 'text-emerald-700' : 'text-destructive')}>{formatINR(totals.net)}</td>
                    <td colSpan={2} />
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
