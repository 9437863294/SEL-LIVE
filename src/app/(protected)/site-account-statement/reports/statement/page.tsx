'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASExpense, type SASPayment, type SASProject } from '@/lib/site-account-statement';
import { loadScopedLedger } from '@/lib/site-account-statement-queries';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { BookOpen, Download, Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

interface TxLine {
  date: string;
  particulars: string;
  receipt: number;
  expense: number;
  balance: number;
}

export default function AccountStatementPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View',   `${MODULE}.All Projects`);
  const canView    = can('View',   `${MODULE}.Reports`);
  const canExport  = can('Export', `${MODULE}.Reports`);

  const searchParams = useSearchParams();
  const paramProjectId = searchParams?.get('projectId') ?? '';

  const [projects,   setProjects]   = useState<SASProject[]>([]);
  const [payments,   setPayments]   = useState<SASPayment[]>([]);
  const [expenses,   setExpenses]   = useState<SASExpense[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [exporting,  setExporting]  = useState(false);

  const [selectedProject, setSelectedProject] = useState(paramProjectId);
  const [filterFrom,      setFilterFrom]      = useState('');
  const [filterTo,        setFilterTo]        = useState('');

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

  const visibleProjectIds = useMemo(
    () => canViewAll ? null : new Set(visibleProjects.map(p => p.id)),
    [visibleProjects, canViewAll]
  );

  // Reset selectedProject if it falls outside the user's visible projects
  useEffect(() => {
    if (!visibleProjectIds || visibleProjects.length === 0) return;
    if (selectedProject && !visibleProjectIds.has(selectedProject)) {
      setSelectedProject('');
    }
  }, [visibleProjectIds, visibleProjects.length, selectedProject]);

  async function loadAll() {
    setLoading(true);
    try {
      const pSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName')));
      const allProjects = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject));
      // `status === 'Active'` matches every other page in the module — an inactive project used to
      // still show up in this report's dropdown.
      setProjects(allProjects.filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      // Scoped to the projects this user may see, on the server — these pages used to pull the
      // organisation's entire expense and payment collections and filter them in the browser.
      const ledger = await loadScopedLedger({ projects: allProjects, userId: user?.id, canViewAll });
      setPayments(ledger.payments);
      setExpenses(ledger.expenses);
    } finally {
      setLoading(false);
    }
  }

  /**
   * The balance carried into the filtered period — everything for this project dated before
   * `filterFrom`. Zero when no start date is set, since the statement then begins at inception.
   */
  const openingBalance = useMemo(() => {
    if (!selectedProject || !filterFrom) return 0;
    if (visibleProjectIds && !visibleProjectIds.has(selectedProject)) return 0;
    const received = payments
      .filter(p => p.projectId === selectedProject && p.receiptDate < filterFrom)
      .reduce((s, p) => s + (p.receivedAmount || 0), 0);
    const spent = expenses
      .filter(e => e.projectId === selectedProject && e.expenseDate < filterFrom)
      .reduce((s, e) => s + (e.expenseAmount || 0), 0);
    return received - spent;
  }, [selectedProject, filterFrom, payments, expenses, visibleProjectIds]);

  const statement = useMemo<TxLine[]>(() => {
    if (!selectedProject) return [];
    if (visibleProjectIds && !visibleProjectIds.has(selectedProject)) return [];

    type RawEntry = { date: string; particulars: string; receipt: number; expense: number };
    const entries: RawEntry[] = [];

    payments.forEach(p => {
      if (p.projectId !== selectedProject) return;
      if (filterFrom && p.receiptDate < filterFrom) return;
      if (filterTo   && p.receiptDate > filterTo)   return;
      entries.push({ date: p.receiptDate, particulars: `Amount received from HO${p.referenceNo ? ` (Ref: ${p.referenceNo})` : ''}`, receipt: p.receivedAmount || 0, expense: 0 });
    });

    expenses.forEach(e => {
      if (e.projectId !== selectedProject) return;
      if (filterFrom && e.expenseDate < filterFrom) return;
      if (filterTo   && e.expenseDate > filterTo)   return;
      const catLabel = e.expenseSubCategory
        ? `${e.expenseCategory} › ${e.expenseSubCategory}`
        : e.expenseCategory;
      const narrationPart = e.narration ? ` — ${e.narration}` : '';
      const personPart    = e.expensedBy && !e.narration ? ` — ${e.expensedBy}` : '';
      const billPart      = e.billNo ? ` (Bill: ${e.billNo})` : '';
      entries.push({ date: e.expenseDate, particulars: `${catLabel}${narrationPart || personPart}${billPart}`, receipt: 0, expense: e.expenseAmount || 0 });
    });

    // Receipts before expenses on the same date, so a day's funding is on hand before it is spent
    // and the running balance does not dip negative for purely presentational reasons.
    entries.sort((a, b) => a.date.localeCompare(b.date) || (b.receipt - b.expense === 0 ? 0 : (b.receipt ? 1 : -1)));

    /*
     * The running balance starts from the balance carried into the period, not from zero.
     *
     * With a date filter applied, starting at zero made the Balance column show the period's
     * cumulative *net movement* while labelling it the account balance — on a project that had
     * been running for a year, a statement filtered to one month reported a balance that had never
     * been true. This is the report that gets handed to auditors, so it now opens where the account
     * actually stood.
     */
    let balance = openingBalance;
    return entries.map(e => {
      balance += e.receipt - e.expense;
      return { ...e, balance };
    });
  }, [selectedProject, payments, expenses, filterFrom, filterTo, openingBalance, visibleProjectIds]);

  const totals = useMemo(() => ({
    receipt: statement.reduce((s, l) => s + l.receipt, 0),
    expense: statement.reduce((s, l) => s + l.expense, 0),
    balance: statement.length ? statement[statement.length - 1].balance : openingBalance,
  }), [statement, openingBalance]);

  const selectedProjectName = projects.find(p => p.id === selectedProject)?.projectName || '';

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Account Statement');
      ws.mergeCells('A1:E1');
      ws.getCell('A1').value = `Account Statement — ${selectedProjectName}`;
      ws.getCell('A1').font = { bold: true, size: 13 };
      if (filterFrom || filterTo) {
        ws.mergeCells('A2:E2');
        ws.getCell('A2').value = `Period: ${filterFrom || 'Beginning'} to ${filterTo || 'Date'}`;
      }
      const headerRow = ws.addRow(['Date', 'Particulars', 'Receipt (₹)', 'Expense (₹)', 'Balance (₹)']);
      headerRow.font = { bold: true };
      if (filterFrom) {
        ws.addRow([filterFrom, 'Opening balance brought forward', '', '', openingBalance]).font = { bold: true };
      }
      statement.forEach(l => ws.addRow([l.date, l.particulars, l.receipt || '', l.expense || '', l.balance]));
      ws.addRow(['', 'Total', totals.receipt, totals.expense, totals.balance]).font = { bold: true };
      ws.columns.forEach(col => { col.width = 22; });
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = `account-statement-${selectedProjectName}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-800">Project-Wise Account Statement</h1>
          <p className="text-sm text-muted-foreground">Running balance of receipts and expenses</p>
        </div>
        {canExport && selectedProject && (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        )}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Project <span className="text-destructive">*</span></Label>
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Select a project" /></SelectTrigger>
            <SelectContent>
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

      {!selectedProject ? (
        <Card className="bg-white/80"><CardContent className="flex flex-col items-center gap-3 py-12">
          <BookOpen className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Select a project to view its account statement.</p>
        </CardContent></Card>
      ) : statement.length === 0 ? (
        <Card className="bg-white/80"><CardContent className="flex flex-col items-center gap-3 py-12">
          <BookOpen className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No transactions found for the selected project / date range.</p>
        </CardContent></Card>
      ) : (
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold text-slate-700">{selectedProjectName}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto overflow-x-auto max-h-[60vh]">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-slate-100">
                    <th className="px-4 py-2.5 text-left font-medium w-[110px]">Date</th>
                    <th className="px-4 py-2.5 text-left font-medium">Particulars</th>
                    <th className="px-4 py-2.5 text-right font-medium">Receipt (₹)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Expense (₹)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Balance (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* An opening row makes the carried-forward balance explicit, rather than leaving
                      the first row's balance looking like it appeared from nowhere. */}
                  {filterFrom && (
                    <tr className="border-b bg-slate-50 font-medium">
                      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{filterFrom}</td>
                      <td className="px-4 py-2 text-slate-600 italic">Opening balance brought forward</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">—</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">—</td>
                      <td className={`px-4 py-2 text-right font-semibold ${openingBalance >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                        {formatINR(openingBalance)}
                      </td>
                    </tr>
                  )}
                  {statement.map((line, i) => (
                    <tr key={i} className="border-b hover:bg-muted/20">
                      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{line.date}</td>
                      <td className="px-4 py-2">{line.particulars}</td>
                      <td className="px-4 py-2 text-right text-blue-600">{line.receipt > 0 ? formatINR(line.receipt) : '—'}</td>
                      <td className="px-4 py-2 text-right text-rose-600">{line.expense > 0 ? formatINR(line.expense) : '—'}</td>
                      <td className={cn('px-4 py-2 text-right font-semibold', line.balance >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                        {formatINR(line.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-bold">
                    <td className="px-4 py-2.5" colSpan={2}>Total</td>
                    <td className="px-4 py-2.5 text-right text-blue-700">{formatINR(totals.receipt)}</td>
                    <td className="px-4 py-2.5 text-right text-rose-700">{formatINR(totals.expense)}</td>
                    <td className={cn('px-4 py-2.5 text-right', totals.balance >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                      {formatINR(totals.balance)}
                    </td>
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
