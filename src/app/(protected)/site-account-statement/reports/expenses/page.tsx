'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASCategory, type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { loadScopedLedger } from '@/lib/site-account-statement-queries';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useSortControl } from '@/components/site-account-statement/use-sort-control';
import { SortControl } from '@/components/site-account-statement/sort-control';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, ExternalLink, Loader2, Paperclip, Receipt } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

export default function ExpenseReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const sortControl = useSortControl('reportExpenses');
  const canViewAll = can('View',   `${MODULE}.All Projects`);
  const canView    = can('View',   `${MODULE}.Reports`);
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

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  // Scope depends on the resolved user and their All-Projects permission, so a late-arriving
  // profile re-runs the load rather than leaving the page scoped to nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, user?.id, canViewAll]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, catSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
      ]);
      const allProjects = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject));
      setProjects(allProjects.filter(p => p.enabledForSiteAccount));
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)));
      // Scoped to the projects this user may see, on the server — these pages used to pull the
      // organisation's entire expense and payment collections and filter them in the browser.
      const ledger = await loadScopedLedger({ projects: allProjects, userId: user?.id, canViewAll });
      setPayments(ledger.payments);
      setExpenses(ledger.expenses);
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

  // The whole scope is already in memory here, so ordering it is a plain wrap.
  const sorted = useMemo(() => sortControl.sortRows(filtered), [filtered, sortControl]);

  const total = useMemo(() => filtered.reduce((s, e) => s + (e.expenseAmount || 0), 0), [filtered]);

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; rows: SASExpense[]; total: number }>();
    sorted.forEach(e => {
      const key = e.projectId || e.projectName;
      if (!map.has(key)) map.set(key, { name: e.projectName, rows: [], total: 0 });
      const g = map.get(key)!;
      g.rows.push(e);
      g.total += e.expenseAmount || 0;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sorted]);

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
      <PageHeader
        title="Project-Wise Expense Report"
        description="All expenses incurred at project sites"
        actions={canExport ? (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        ) : undefined}
      />

      {/* Filters */}
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search...' }}
        activeCount={[filterProject, filterCategory, filterSubCategory, filterMode, filterFrom, filterTo].filter(Boolean).length}
        onClear={() => {
          setFilterProject(''); setFilterCategory(''); setFilterSubCategory(''); setFilterMode('');
          setFilterFrom(''); setFilterTo(''); setSearch('');
        }}
      >
          <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
            <SelectTrigger aria-label="Project"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Projects</SelectItem>
              {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCategory || '_all_'} onValueChange={v => { setFilterCategory(v === '_all_' ? '' : v); setFilterSubCategory(''); }}>
            <SelectTrigger aria-label="Category"><SelectValue placeholder="All Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Categories</SelectItem>
              {mainCategories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSubCategory || '_all_'} onValueChange={v => setFilterSubCategory(v === '_all_' ? '' : v)}>
            <SelectTrigger aria-label="Sub-category"><SelectValue placeholder="All Sub-Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Sub-Categories</SelectItem>
              {filterSubCategoryOptions.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterMode || '_all_'} onValueChange={v => setFilterMode(v === '_all_' ? '' : v)}>
            <SelectTrigger aria-label="Payment mode"><SelectValue placeholder="All Modes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Modes</SelectItem>
              {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} aria-label="From date" />
          <Input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   aria-label="To date" />
          <SortControl control={sortControl} />
      </FilterBar>

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
          <TableCard
            key={group.name}
            title={group.name}
            count={group.rows.length}
            noun="expense"
            actions={
                <div className="flex flex-wrap items-center gap-3 text-xs">
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
            }
          >
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Narration</TableHead>
                      <TableHead>Expensed By</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Bill No.</TableHead>
                      <TableHead className="text-center"><Paperclip className="h-3.5 w-3.5 inline" /></TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.rows.map(row => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Badge variant="outline" className="w-fit">{row.expenseCategory}</Badge>
                            {row.expenseSubCategory && (
                              <span className="text-xs text-purple-600">↳ {row.expenseSubCategory}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate">
                          {row.narration || '—'}
                        </TableCell>
                        <TableCell>{row.expensedBy}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.expenseDate}</TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums font-medium text-rose-700">{formatINR(row.expenseAmount)}</TableCell>
                        <TableCell><Badge variant="neutral">{row.paymentMode}</Badge></TableCell>
                        <TableCell className="max-w-[120px] truncate">{row.vendorPartyName || '—'}</TableCell>
                        <TableCell className="font-mono whitespace-nowrap">{row.billNo || '—'}</TableCell>
                        <TableCell className="text-center">
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
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">{row.remarks || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4}>Subtotal</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums text-rose-700">{formatINR(group.total)}</TableCell>
                      <TableCell colSpan={4} />
                    </TableRow>
                  </TableFooter>
                </Table>
          </TableCard>
        ))
      )}
    </div>
  );
}
