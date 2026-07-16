'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASExpense, type SASProject } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Download, Filter, Loader2, Users } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

export default function PersonExpensePage() {
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
  const [search,        setSearch]        = useState('');
  const [showFilters,   setShowFilters]   = useState(false);

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, expSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses), orderBy('expenseDate', 'desc'))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount));
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
    if (filterProject && e.projectId !== filterProject) return false;
    if (filterFrom    && e.expenseDate < filterFrom)     return false;
    if (filterTo      && e.expenseDate > filterTo)       return false;
    return true;
  }), [expenses, userProjectIds, filterProject, filterFrom, filterTo]);

  const grandTotal = useMemo(() => filtered.reduce((s, e) => s + (e.expenseAmount || 0), 0), [filtered]);

  interface PersonRow {
    name: string;
    count: number;
    total: number;
    pct: number;
    categories: { name: string; count: number; total: number }[];
    rows: SASExpense[];
  }

  const personGroups = useMemo(() => {
    const map = new Map<string, { count: number; total: number; catMap: Map<string, { count: number; total: number }>; rows: SASExpense[] }>();
    filtered.forEach(e => {
      const person = (e.expensedBy || '').trim() || 'Unknown';
      if (!map.has(person)) map.set(person, { count: 0, total: 0, catMap: new Map(), rows: [] });
      const p = map.get(person)!;
      p.count += 1;
      p.total += e.expenseAmount || 0;
      p.rows.push(e);
      const cat = e.expenseCategory || 'Uncategorized';
      const cur = p.catMap.get(cat) ?? { count: 0, total: 0 };
      p.catMap.set(cat, { count: cur.count + 1, total: cur.total + (e.expenseAmount || 0) });
    });
    return Array.from(map.entries())
      .map(([name, { count, total, catMap, rows }]): PersonRow => ({
        name, count, total,
        pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
        categories: Array.from(catMap.entries())
          .map(([catName, cv]) => ({ name: catName, count: cv.count, total: cv.total }))
          .sort((a, b) => b.total - a.total),
        rows,
      }))
      .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.total - a.total);
  }, [filtered, grandTotal, search]);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Person-wise Expenses');
      ws.columns = [
        { header: 'Person',           key: 'person',   width: 22 },
        { header: 'Category',         key: 'category', width: 24 },
        { header: 'Date',             key: 'date',     width: 12 },
        { header: 'Project',          key: 'project',  width: 26 },
        { header: 'Amount (₹)',       key: 'amount',   width: 14 },
        { header: 'Payment Mode',     key: 'mode',     width: 14 },
        { header: 'Vendor',           key: 'vendor',   width: 20 },
        { header: 'Bill No.',         key: 'bill',     width: 14 },
        { header: 'Remarks',          key: 'remarks',  width: 30 },
      ];
      ws.getRow(1).font = { bold: true };
      personGroups.forEach(p => {
        p.rows.forEach(e => ws.addRow({
          person: p.name, category: e.expenseCategory, date: e.expenseDate,
          project: e.projectName, amount: e.expenseAmount, mode: e.paymentMode,
          vendor: e.vendorPartyName || '', bill: e.billNo || '', remarks: e.remarks || '',
        }));
      });
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'person-expense-report.xlsx'; a.click();
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
          <h1 className="text-lg font-bold text-slate-800">Person-wise Expense Report</h1>
          <p className="text-sm text-muted-foreground">Who spent what — grouped by person with category breakdown</p>
        </div>
        {canExport && (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        )}
      </div>

      {/* Mobile filter toggle */}
      {(() => { const c = [filterProject, search].filter(Boolean).length; return (
        <div className="flex sm:hidden">
          <Button variant="outline" size="sm" className="h-9 gap-2 flex-1 justify-center"
            onClick={() => setShowFilters(s => !s)}>
            <Filter className="h-3.5 w-3.5" />{showFilters ? 'Hide Filters' : 'Filters'}
            {c > 0 && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[9px] font-bold text-white">{c}</span>}
          </Button>
        </div>
      ); })()}
      {/* Filters */}
      <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', !showFilters && 'hidden sm:grid')}>
        <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Projects</SelectItem>
            {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-sm" />
        <Input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   className="h-9 text-sm" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search person..." className="h-9 text-sm" />
      </div>

      {/* Grand total */}
      <div className="rounded-lg border bg-rose-50 px-4 py-2.5 text-sm text-rose-700 font-medium">
        Total Expenses: <strong>{formatINR(grandTotal)}</strong> across <strong>{personGroups.length}</strong> persons — {filtered.length} records
      </div>

      {personGroups.length === 0 ? (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Users className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No records found.</p>
          </CardContent>
        </Card>
      ) : (
        personGroups.map(person => (
          <Card key={person.name} className="bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span>{person.name}</span>
                  <Badge variant="secondary" className="text-xs">{person.count} entries</Badge>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{person.pct.toFixed(1)}% of total</span>
                  <span className="font-bold text-rose-700">{formatINR(person.total)}</span>
                </div>
              </CardTitle>
              {/* Distribution bar */}
              <div className="mt-1.5 bg-rose-100 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-rose-500 rounded-full transition-all" style={{ width: `${person.pct}%` }} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[400px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b bg-slate-100">
                      <th className="px-4 py-2 text-left font-medium">Category</th>
                      <th className="px-4 py-2 text-right font-medium">Entries</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                      <th className="px-4 py-2 text-left font-medium w-[140px]">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {person.categories.map(cat => (
                      <tr key={cat.name} className="border-b hover:bg-muted/20">
                        <td className="px-4 py-2">
                          <Badge variant="outline" className="text-xs">{cat.name}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{cat.count}</td>
                        <td className="px-4 py-2 text-right font-medium text-rose-700">{formatINR(cat.total)}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-rose-100 rounded-full h-1.5 overflow-hidden">
                              <div className="h-full bg-rose-400 rounded-full" style={{ width: `${person.total > 0 ? (cat.total / person.total) * 100 : 0}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-8 text-right">
                              {person.total > 0 ? ((cat.total / person.total) * 100).toFixed(0) : 0}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right">{person.count}</td>
                      <td className="px-4 py-2 text-right text-rose-700">{formatINR(person.total)}</td>
                      <td />
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
