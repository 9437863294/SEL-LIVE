'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASCategory, type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Download, ExternalLink, Filter, Loader2, Paperclip, Receipt } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

export default function ExpenseReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View',   `${MODULE}.All Projects`);
  const canView    = can('View',   `${MODULE}.Reports`) || canViewAll;
  const canExport  = can('Export', `${MODULE}.Reports`);

  const [projects,    setProjects]    = useState<SASProject[]>([]);
  const [categories,  setCategories]  = useState<SASCategory[]>([]);
  const [expenses,    setExpenses]    = useState<SASExpense[]>([]);
  const [payments,    setPayments]    = useState<SASPayment[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [exporting,   setExporting]   = useState(false);

  const [filterProject,     setFilterProject]     = useState('');
  const [filterCategory,    setFilterCategory]    = useState('');
  const [filterSubCategory, setFilterSubCategory] = useState('');
  const [filterMode,        setFilterMode]        = useState('');
  const [filterFrom,        setFilterFrom]        = useState('');
  const [filterTo,          setFilterTo]          = useState('');
  const [search,            setSearch]            = useState('');
  const [showFilters,       setShowFilters]       = useState(false);

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, catSnap, expSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses), orderBy('expenseDate', 'desc'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount));
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
    } finally {
      setLoading(false);
    }
  }

  const mainCategories = useMemo(() => categories.filter(c => !c.parentId), [categories]);
  const subCategories  = useMemo(() => categories.filter(c => !!c.parentId),  [categories]);

  const filterSubCategoryOptions = useMemo(
    () => filterCategory
      ? subCategories.filter(c => {
          const main = mainCategories.find(m => m.name === filterCategory);
          return main ? c.parentId === main.id : false;
        })
      : subCategories,
    [filterCategory, subCategories, mainCategories]
  );

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
    if (userProjectIds    && !userProjectIds.has(e.projectId))                          return false;
    if (filterProject     && e.projectId !== filterProject)                             return false;
    if (filterCategory    && e.expenseCategory !== filterCategory)                      return false;
    if (filterSubCategory && (e.expenseSubCategory || '') !== filterSubCategory)        return false;
    if (filterMode        && e.paymentMode !== filterMode)                              return false;
    if (filterFrom        && e.expenseDate < filterFrom)                                return false;
    if (filterTo          && e.expenseDate > filterTo)                                  return false;
    if (search && !(e.projectName        || '').toLowerCase().includes(search.toLowerCase()) &&
        !(e.expensedBy         || '').toLowerCase().includes(search.toLowerCase()) &&
        !(e.expenseCategory    || '').toLowerCase().includes(search.toLowerCase()) &&
        !(e.expenseSubCategory || '').toLowerCase().includes(search.toLowerCase()) &&
        !(e.narration          || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [expenses, userProjectIds, filterProject, filterCategory, filterSubCategory, filterMode, filterFrom, filterTo, search]);

  const total = useMemo(() => filtered.reduce((s, e) => s + (e.expenseAmount || 0), 0), [filtered]);

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

  // Per-project balance
  const perProjectBalance = useMemo(() => {
    const map = new Map<string, { received: number; spent: number; balance: number }>();
    payments.forEach(p => {
      if (userProjectIds && !userProjectIds.has(p.projectId)) return;
      const cur = map.get(p.projectId) ?? { received: 0, spent: 0, balance: 0 };
      cur.received += p.receivedAmount || 0;
      map.set(p.projectId, cur);
    });
    expenses.forEach(e => {
      if (userProjectIds && !userProjectIds.has(e.projectId)) return;
      const cur = map.get(e.projectId) ?? { received: 0, spent: 0, balance: 0 };
      cur.spent += e.expenseAmount || 0;
      map.set(e.projectId, cur);
    });
    map.forEach((v, k) => { v.balance = v.received - v.spent; map.set(k, v); });
    return map;
  }, [payments, expenses, userProjectIds]);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Expense Report');
      ws.columns = [
        { header: 'Project',          key: 'projectName',        width: 28 },
        { header: 'Main Category',    key: 'expenseCategory',    width: 22 },
        { header: 'Sub-Category',     key: 'expenseSubCategory', width: 22 },
        { header: 'Narration',        key: 'narration',          width: 30 },
        { header: 'Expensed By',      key: 'expensedBy',         width: 20 },
        { header: 'Expense Date',     key: 'expenseDate',        width: 14 },
        { header: 'Amount (₹)',       key: 'expenseAmount',      width: 14 },
        { header: 'Payment Mode',     key: 'paymentMode',        width: 14 },
        { header: 'Vendor / Party',   key: 'vendorPartyName',    width: 22 },
        { header: 'Bill No.',         key: 'billNo',             width: 16 },
        { header: 'Remarks',       key: 'remarks',      width: 30 },
        { header: 'Attachments',  key: 'attachCount',  width: 14 },
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach(e => ws.addRow({ ...e, expenseSubCategory: e.expenseSubCategory || '', narration: e.narration || '', attachCount: e.attachments?.length || 0 }));
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

      {/* Mobile filter toggle */}
      {(() => { const c = [filterProject, filterCategory, filterSubCategory, filterMode, search].filter(Boolean).length; return (
        <div className="flex sm:hidden">
          <Button variant="outline" size="sm" className="h-9 gap-2 flex-1 justify-center"
            onClick={() => setShowFilters(s => !s)}>
            <Filter className="h-3.5 w-3.5" />{showFilters ? 'Hide Filters' : 'Filters'}
            {c > 0 && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[9px] font-bold text-white">{c}</span>}
          </Button>
        </div>
      ); })()}
      {/* Filters (collapsible on mobile) */}
      <div className={cn('space-y-2', !showFilters && 'hidden sm:block')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Projects</SelectItem>
              {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCategory || '_all_'} onValueChange={v => { setFilterCategory(v === '_all_' ? '' : v); setFilterSubCategory(''); }}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Categories</SelectItem>
              {mainCategories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSubCategory || '_all_'} onValueChange={v => setFilterSubCategory(v === '_all_' ? '' : v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Sub-Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Sub-Categories</SelectItem>
              {filterSubCategoryOptions.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterMode || '_all_'} onValueChange={v => setFilterMode(v === '_all_' ? '' : v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Modes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Modes</SelectItem>
              {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-sm" />
          <Input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   className="h-9 text-sm" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="h-9 text-sm" />
        </div>
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
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-sm font-semibold text-slate-700">{group.name}</CardTitle>
                <div className="flex items-center gap-3 text-xs">
                  {(() => {
                    const b = perProjectBalance.get(group.rows[0]?.projectId || '');
                    return b ? (
                      <>
                        <span className="text-blue-600">Received: {formatINR(b.received)}</span>
                        <span className="text-rose-600">Expenses: {formatINR(group.total)}</span>
                        <span className={`font-bold ${b.balance >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                          Balance: {formatINR(b.balance)}
                        </span>
                      </>
                    ) : (
                      <span className="text-rose-600 font-semibold">{formatINR(group.total)}</span>
                    );
                  })()}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[400px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b bg-slate-100">
                      <th className="px-4 py-2 text-left font-medium">Category</th>
                      <th className="px-4 py-2 text-left font-medium">Narration</th>
                      <th className="px-4 py-2 text-left font-medium">Expensed By</th>
                      <th className="px-4 py-2 text-left font-medium">Date</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                      <th className="px-4 py-2 text-left font-medium">Mode</th>
                      <th className="px-4 py-2 text-left font-medium">Vendor</th>
                      <th className="px-4 py-2 text-left font-medium">Bill No.</th>
                      <th className="px-4 py-2 text-center font-medium"><Paperclip className="h-3.5 w-3.5 inline" /></th>
                      <th className="px-4 py-2 text-left font-medium">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map(row => (
                      <tr key={row.id} className="border-b hover:bg-muted/20">
                        <td className="px-4 py-2">
                          <div className="flex flex-col gap-0.5">
                            <Badge variant="outline" className="text-xs w-fit">{row.expenseCategory}</Badge>
                            {row.expenseSubCategory && (
                              <span className="text-xs text-purple-600">↳ {row.expenseSubCategory}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground max-w-[160px] truncate">
                          {row.narration || '—'}
                        </td>
                        <td className="px-4 py-2">{row.expensedBy}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{row.expenseDate}</td>
                        <td className="px-4 py-2 text-right font-medium text-rose-700">{formatINR(row.expenseAmount)}</td>
                        <td className="px-4 py-2"><Badge variant="secondary">{row.paymentMode}</Badge></td>
                        <td className="px-4 py-2 max-w-[120px] truncate">{row.vendorPartyName || '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground">{row.billNo || '—'}</td>
                        <td className="px-4 py-2 text-center">
                          {row.attachments && row.attachments.length > 0 ? (
                            <div className="flex flex-col gap-0.5 items-center">
                              {row.attachments.map((att, ai) => (
                                <a key={ai} href={att.url} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs">
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ))}
                              <span className="text-[10px] text-muted-foreground">{row.attachments.length}</span>
                            </div>
                          ) : (
                            <Paperclip className="h-3.5 w-3.5 text-muted-foreground/20 mx-auto" />
                          )}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground max-w-[150px] truncate">{row.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td colSpan={4} className="px-4 py-2">Subtotal</td>
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
