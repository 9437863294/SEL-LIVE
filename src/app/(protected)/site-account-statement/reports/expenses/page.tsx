'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASCategory, type SASExpense, type SASProject,
} from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Loader2, Receipt } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

export default function ExpenseReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canView    = can('View',   `${MODULE}.Reports`) || can('View Module', MODULE);
  const canExport  = can('Export', `${MODULE}.Reports`);
  const canViewAll = can('View',   `${MODULE}.All Projects`);

  const [projects,    setProjects]    = useState<SASProject[]>([]);
  const [categories,  setCategories]  = useState<SASCategory[]>([]);
  const [expenses,    setExpenses]    = useState<SASExpense[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [exporting,   setExporting]   = useState(false);

  const [filterProject,  setFilterProject]  = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterMode,     setFilterMode]     = useState('');
  const [filterFrom,     setFilterFrom]     = useState('');
  const [filterTo,       setFilterTo]       = useState('');
  const [search,         setSearch]         = useState('');

  useEffect(() => {
    if (!isAuthLoading && canView) void loadAll();
  }, [isAuthLoading, canView]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, catSnap, expSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses), orderBy('expenseDate', 'desc'))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount));
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
    } finally {
      setLoading(false);
    }
  }

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p => p.assignedPersonId === user?.id),
    [projects, user?.id, canViewAll]
  );

  const userProjectIds = useMemo(
    () => canViewAll ? null : new Set(visibleProjects.map(p => p.id)),
    [visibleProjects, canViewAll]
  );

  const filtered = useMemo(() => expenses.filter(e => {
    if (userProjectIds && !userProjectIds.has(e.projectId)) return false;
    if (filterProject  && e.projectId !== filterProject)       return false;
    if (filterCategory && e.expenseCategory !== filterCategory) return false;
    if (filterMode     && e.paymentMode !== filterMode)         return false;
    if (filterFrom     && e.expenseDate < filterFrom)           return false;
    if (filterTo       && e.expenseDate > filterTo)             return false;
    if (search && !(e.projectName || '').toLowerCase().includes(search.toLowerCase()) &&
        !(e.expensedBy || '').toLowerCase().includes(search.toLowerCase()) &&
        !(e.expenseCategory || '').toLowerCase().includes(search.toLowerCase()))  return false;
    return true;
  }), [expenses, userProjectIds, filterProject, filterCategory, filterMode, filterFrom, filterTo, search]);

  const total = useMemo(() => filtered.reduce((s, e) => s + (e.expenseAmount || 0), 0), [filtered]);

  // Group by project
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; rows: SASExpense[]; total: number }>();
    filtered.forEach(e => {
      const key = e.projectId || e.projectName;
      if (!map.has(key)) map.set(key, { name: e.projectName, rows: [], total: 0 });
      const g = map.get(key)!;
      g.rows.push(e);
      g.total += e.expenseAmount || 0;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Expense Report');
      ws.columns = [
        { header: 'Project',          key: 'projectName',     width: 28 },
        { header: 'Expense Category', key: 'expenseCategory', width: 22 },
        { header: 'Expensed By',      key: 'expensedBy',      width: 20 },
        { header: 'Expense Date',     key: 'expenseDate',     width: 14 },
        { header: 'Amount (₹)',       key: 'expenseAmount',   width: 14 },
        { header: 'Payment Mode',     key: 'paymentMode',     width: 14 },
        { header: 'Vendor / Party',   key: 'vendorPartyName', width: 22 },
        { header: 'Bill No.',         key: 'billNo',          width: 16 },
        { header: 'Remarks',          key: 'remarks',         width: 30 },
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach(e => ws.addRow({ ...e }));
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'expense-report.xlsx'; a.click();
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
          <h1 className="text-lg font-bold text-slate-800">Project-Wise Expense Report</h1>
          <p className="text-sm text-muted-foreground">All expenses incurred at project sites</p>
        </div>
        {canExport && (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Projects</SelectItem>
            {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCategory || '_all_'} onValueChange={v => setFilterCategory(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterMode || '_all_'} onValueChange={v => setFilterMode(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Modes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Modes</SelectItem>
            {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-sm" />
        <Input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   className="h-9 text-sm" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="h-9 text-sm" />
      </div>

      <div className="rounded-lg border bg-rose-50 px-4 py-2.5 text-sm text-rose-700 font-medium">
        Total Expenses: <strong>{formatINR(total)}</strong> — {filtered.length} records
      </div>

      {grouped.length === 0 ? (
        <Card className="bg-white/80"><CardContent className="flex flex-col items-center gap-3 py-12">
          <Receipt className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No records found.</p>
        </CardContent></Card>
      ) : (
        grouped.map(group => (
          <Card key={group.name} className="bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center justify-between">
                <span>{group.name}</span>
                <span className="text-rose-600">{formatINR(group.total)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-2 text-left font-medium">Category</th>
                      <th className="px-4 py-2 text-left font-medium">Expensed By</th>
                      <th className="px-4 py-2 text-left font-medium">Date</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                      <th className="px-4 py-2 text-left font-medium">Mode</th>
                      <th className="px-4 py-2 text-left font-medium">Vendor</th>
                      <th className="px-4 py-2 text-left font-medium">Bill No.</th>
                      <th className="px-4 py-2 text-left font-medium">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map(row => (
                      <tr key={row.id} className="border-b hover:bg-muted/20">
                        <td className="px-4 py-2"><Badge variant="outline" className="text-xs">{row.expenseCategory}</Badge></td>
                        <td className="px-4 py-2">{row.expensedBy}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{row.expenseDate}</td>
                        <td className="px-4 py-2 text-right font-medium text-rose-700">{formatINR(row.expenseAmount)}</td>
                        <td className="px-4 py-2"><Badge variant="secondary">{row.paymentMode}</Badge></td>
                        <td className="px-4 py-2 max-w-[120px] truncate">{row.vendorPartyName || '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground">{row.billNo || '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground max-w-[150px] truncate">{row.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td colSpan={3} className="px-4 py-2">Subtotal</td>
                      <td className="px-4 py-2 text-right text-rose-700">{formatINR(group.total)}</td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
