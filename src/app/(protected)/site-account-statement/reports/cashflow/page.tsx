'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASExpense, type SASPayment, type SASProject } from '@/lib/site-account-statement';
import { loadScopedLedger } from '@/lib/site-account-statement-queries';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
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
  const canView    = can('View', `${MODULE}.Reports`);
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
  // Scope depends on the resolved user and their All-Projects permission, so a late-arriving
  // profile re-runs the load rather than leaving the page scoped to nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, user?.id, canViewAll]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
      ]);
      const allProjects = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject));
      setProjects(allProjects.filter(p => p.enabledForSiteAccount));
      // Scoped to the projects this user may see, on the server — these pages used to pull the
      // organisation's entire expense and payment collections and filter them in the browser.
      const ledger = await loadScopedLedger({ projects: allProjects, userId: user?.id, canViewAll });
      setPayments(ledger.payments);
      setExpenses(ledger.expenses);
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
      <PageHeader
        title="Month-wise Cash Flow"
        description={<>Monthly receipts, expenses and running balance for {filterYear}</>}
        actions={canExport ? (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        ) : undefined}
      />

      {/* Filters */}
      <FilterBar
        activeCount={(filterProject ? 1 : 0) + (filterYear !== String(currentYear) ? 1 : 0)}
        onClear={() => { setFilterProject(''); setFilterYear(String(currentYear)); }}
      >
        <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
          <SelectTrigger aria-label="Project"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Projects</SelectItem>
            {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterYear} onValueChange={setFilterYear}>
          <SelectTrigger aria-label="Year"><SelectValue /></SelectTrigger>
          <SelectContent>
            {availableYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBar>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
        <TableCard title={`Cash flow ${filterYear}`}>
              <Table className="min-w-[600px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Receipts (₹)</TableHead>
                    <TableHead className="text-right">Expenses (₹)</TableHead>
                    <TableHead className="text-right">Net (₹)</TableHead>
                    <TableHead className="text-right">Running Balance</TableHead>
                    <TableHead className="w-[130px]">Flow</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyData.map(m => (
                    <TableRow key={m.month} className={cn(m.receipts === 0 && m.expenses === 0 && 'opacity-40')}>
                      <TableCell className="font-medium">{m.label}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums text-blue-600">{m.receipts > 0 ? formatINR(m.receipts) : '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums text-rose-600">{m.expenses > 0 ? formatINR(m.expenses) : '—'}</TableCell>
                      <TableCell className={cn('text-right whitespace-nowrap tabular-nums font-medium',
                        m.net > 0 ? 'text-emerald-600' : m.net < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                        {m.net !== 0 ? formatINR(m.net) : '—'}
                      </TableCell>
                      <TableCell className={cn('text-right whitespace-nowrap tabular-nums font-medium', m.balance >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                        {formatINR(m.balance)}
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>Total ({filterYear})</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums text-blue-700">{formatINR(totals.receipts)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums text-rose-700">{formatINR(totals.expenses)}</TableCell>
                    <TableCell className={cn('text-right whitespace-nowrap tabular-nums', totals.net >= 0 ? 'text-emerald-700' : 'text-destructive')}>{formatINR(totals.net)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableFooter>
              </Table>
        </TableCard>
      )}
    </div>
  );
}
