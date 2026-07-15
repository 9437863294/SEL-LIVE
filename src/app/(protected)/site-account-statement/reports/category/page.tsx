'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASCategory, type SASExpense, type SASProject } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
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

  const [projects,   setProjects]   = useState<SASProject[]>([]);
  const [categories, setCategories] = useState<SASCategory[]>([]);
  const [expenses,   setExpenses]   = useState<SASExpense[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [exporting,  setExporting]  = useState(false);

  const [filterProject, setFilterProject] = useState('');
  const [filterFrom,    setFilterFrom]    = useState('');
  const [filterTo,      setFilterTo]      = useState('');

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, catSnap, expSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount));
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)));
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

  const filtered = useMemo(() => expenses.filter(e => {
    if (userProjectIds && !userProjectIds.has(e.projectId)) return false;
    if (filterProject && e.projectId !== filterProject)     return false;
    if (filterFrom    && e.expenseDate < filterFrom)        return false;
    if (filterTo      && e.expenseDate > filterTo)          return false;
    return true;
  }), [expenses, userProjectIds, filterProject, filterFrom, filterTo]);

  const grandTotal = useMemo(() => filtered.reduce((s, e) => s + (e.expenseAmount || 0), 0), [filtered]);

  // Group by main category, then sub-category within
  const mainCategoryGroups = useMemo(() => {
    const map = new Map<string, { count: number; total: number; subs: Map<string, { count: number; total: number }> }>();
    filtered.forEach(e => {
      const main = e.expenseCategory || 'Uncategorized';
      if (!map.has(main)) map.set(main, { count: 0, total: 0, subs: new Map() });
      const m = map.get(main)!;
      m.count += 1;
      m.total += e.expenseAmount || 0;
      const sub = e.expenseSubCategory?.trim() || '(No Sub-Category)';
      const cur = m.subs.get(sub) ?? { count: 0, total: 0 };
      m.subs.set(sub, { count: cur.count + 1, total: cur.total + (e.expenseAmount || 0) });
    });
    return Array.from(map.entries())
      .map(([name, { count, total, subs }]) => ({
        name, count, total,
        pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
        avg: count > 0 ? total / count : 0,
        subGroups: Array.from(subs.entries())
          .map(([subName, sv]) => ({
            name: subName,
            count: sv.count,
            total: sv.total,
            pct: total > 0 ? (sv.total / total) * 100 : 0,
          }))
          .sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.total - a.total);
  }, [filtered, grandTotal]);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Category Analysis');
      ws.columns = [
        { header: 'Main Category',      key: 'mainCat',  width: 26 },
        { header: 'Sub-Category',       key: 'subCat',   width: 26 },
        { header: 'Transactions',       key: 'count',    width: 15 },
        { header: 'Total Amount (₹)',   key: 'total',    width: 18 },
        { header: '% of Main Cat',      key: 'pct',      width: 14 },
      ];
      ws.getRow(1).font = { bold: true };
      mainCategoryGroups.forEach(main => {
        // Summary row for main category
        const mainRow = ws.addRow({ mainCat: main.name, subCat: '', count: main.count, total: main.total, pct: `${main.pct.toFixed(1)}% of total` });
        mainRow.font = { bold: true };
        // Sub-category rows
        main.subGroups.forEach(sub => {
          ws.addRow({ mainCat: '', subCat: `  ↳ ${sub.name}`, count: sub.count, total: sub.total, pct: `${sub.pct.toFixed(1)}%` });
        });
      });
      ws.addRow({ mainCat: 'TOTAL', subCat: '', count: filtered.length, total: grandTotal, pct: '100%' }).font = { bold: true };
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

      {mainCategoryGroups.length === 0 ? (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <PieChart className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No expense data for the selected filters.</p>
          </CardContent>
        </Card>
      ) : (
        mainCategoryGroups.map((cat, idx) => (
          <Card key={cat.name} className="bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-5">{idx + 1}</span>
                  <span>{cat.name}</span>
                  <Badge variant="outline" className="text-xs">{cat.count} entries</Badge>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{cat.pct.toFixed(1)}% of total</span>
                  <span className="font-bold text-rose-700">{formatINR(cat.total)}</span>
                </div>
              </CardTitle>
              {/* Main category distribution bar */}
              <div className="mt-1.5 bg-rose-100 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-rose-500 rounded-full transition-all" style={{ width: `${cat.pct}%` }} />
              </div>
            </CardHeader>
            {cat.subGroups.length > 0 && !(cat.subGroups.length === 1 && cat.subGroups[0].name === '(No Sub-Category)') && (
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-2 text-left font-medium pl-8">Sub-Category</th>
                        <th className="px-4 py-2 text-right font-medium">Entries</th>
                        <th className="px-4 py-2 text-right font-medium">Amount</th>
                        <th className="px-4 py-2 text-left font-medium w-[160px]">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.subGroups.map(sub => (
                        <tr key={sub.name} className="border-b hover:bg-muted/20">
                          <td className="px-4 py-2 pl-8">
                            {sub.name === '(No Sub-Category)'
                              ? <span className="text-muted-foreground italic">{sub.name}</span>
                              : <span className="flex items-center gap-1.5"><span className="text-muted-foreground">↳</span>{sub.name}</span>
                            }
                          </td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{sub.count}</td>
                          <td className="px-4 py-2 text-right font-medium text-rose-700">{formatINR(sub.total)}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-rose-100 rounded-full h-1.5 overflow-hidden">
                                <div className="h-full bg-rose-400 rounded-full" style={{ width: `${sub.pct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground w-8 text-right">{sub.pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold">
                        <td className="px-4 py-2 pl-8">Total</td>
                        <td className="px-4 py-2 text-right">{cat.count}</td>
                        <td className="px-4 py-2 text-right text-rose-700">{formatINR(cat.total)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            )}
          </Card>
        ))
      )}

      {/* Grand total footer */}
      {mainCategoryGroups.length > 0 && (
        <div className="rounded-lg border bg-muted/40 px-4 py-2.5 text-sm font-bold flex justify-between">
          <span>Grand Total ({mainCategoryGroups.length} categories)</span>
          <span className="text-rose-700">{formatINR(grandTotal)}</span>
        </div>
      )}
    </div>
  );
}
