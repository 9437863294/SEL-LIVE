'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASExpense, type SASProject } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Loader2, PieChart } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

export default function CategoryAnalysisPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canView    = can('View', `${MODULE}.Reports`) || canViewAll;
  const canExport  = can('Export', `${MODULE}.Reports`);

  const [projects, setProjects] = useState<SASProject[]>([]);
  const [expenses, setExpenses] = useState<SASExpense[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [exporting, setExporting] = useState(false);

  const [filterProject, setFilterProject] = useState('');
  const [filterFrom,    setFilterFrom]    = useState('');
  const [filterTo,      setFilterTo]      = useState('');

  useEffect(() => {
    if (!isAuthLoading && canView) void loadAll();
  }, [isAuthLoading, canView]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, expSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount));
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
    if (filterProject && e.projectId !== filterProject) return false;
    if (filterFrom    && e.expenseDate < filterFrom)     return false;
    if (filterTo      && e.expenseDate > filterTo)       return false;
    return true;
  }), [expenses, userProjectIds, filterProject, filterFrom, filterTo]);

  const grandTotal = useMemo(() => filtered.reduce((s, e) => s + (e.expenseAmount || 0), 0), [filtered]);

  const categoryStats = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    filtered.forEach(e => {
      const cat = e.expenseCategory || 'Uncategorized';
      const cur = map.get(cat) ?? { count: 0, total: 0 };
      map.set(cat, { count: cur.count + 1, total: cur.total + (e.expenseAmount || 0) });
    });
    return Array.from(map.entries())
      .map(([name, { count, total }]) => ({
        name, count, total,
        pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
        avg: count > 0 ? total / count : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [filtered, grandTotal]);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Category Analysis');
      ws.columns = [
        { header: 'Category',          key: 'name',  width: 28 },
        { header: 'Transactions',       key: 'count', width: 15 },
        { header: 'Total Amount (₹)',   key: 'total', width: 18 },
        { header: '% of Total',         key: 'pct',   width: 14 },
        { header: 'Avg per Entry (₹)',  key: 'avg',   width: 18 },
      ];
      ws.getRow(1).font = { bold: true };
      categoryStats.forEach(c =>
        ws.addRow({ name: c.name, count: c.count, total: c.total, pct: `${c.pct.toFixed(1)}%`, avg: Math.round(c.avg) })
      );
      ws.addRow({ name: 'TOTAL', count: filtered.length, total: grandTotal, pct: '100%', avg: '' }).font = { bold: true };
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'category-analysis.xlsx'; a.click();
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
          <h1 className="text-lg font-bold text-slate-800">Category-wise Expense Analysis</h1>
          <p className="text-sm text-muted-foreground">Which expense categories are consuming the most budget</p>
        </div>
        {canExport && (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Projects</SelectItem>
            {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-sm" placeholder="From" />
        <Input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   className="h-9 text-sm" placeholder="To" />
        <div className="rounded-lg border bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 flex items-center gap-1">
          Total: <span className="font-bold">{formatINR(grandTotal)}</span>
        </div>
      </div>

      {categoryStats.length === 0 ? (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <PieChart className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No expense data for the selected filters.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium w-8">#</th>
                    <th className="px-4 py-2.5 text-left font-medium">Category</th>
                    <th className="px-4 py-2.5 text-right font-medium">Transactions</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total Amount</th>
                    <th className="px-4 py-2.5 text-right font-medium">% of Total</th>
                    <th className="px-4 py-2.5 text-right font-medium">Avg per Entry</th>
                    <th className="px-4 py-2.5 text-left font-medium w-[160px]">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryStats.map((cat, idx) => (
                    <tr key={cat.name} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-medium">{cat.name}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{cat.count}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-rose-700">{formatINR(cat.total)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{cat.pct.toFixed(1)}%</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{formatINR(Math.round(cat.avg))}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-rose-100 rounded-full h-2 overflow-hidden">
                            <div className="h-full bg-rose-500 rounded-full transition-all" style={{ width: `${cat.pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground w-8 text-right">{cat.pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-bold">
                    <td colSpan={2} className="px-4 py-2.5">Total ({categoryStats.length} categories)</td>
                    <td className="px-4 py-2.5 text-right">{filtered.length}</td>
                    <td className="px-4 py-2.5 text-right text-rose-700">{formatINR(grandTotal)}</td>
                    <td className="px-4 py-2.5 text-right">100%</td>
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
