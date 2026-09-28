'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASExpense, type SASProject } from '@/lib/site-account-statement';
import { loadScopedLedger } from '@/lib/site-account-statement-queries';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronRight, Download, Loader2, Paperclip, Users } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

export default function PersonExpensePage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canView    = can('View', `${MODULE}.Reports`);
  const canExport  = can('Export', `${MODULE}.Reports`);

  const [projects, setProjects] = useState<SASProject[]>([]);
  const [expenses, setExpenses] = useState<SASExpense[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [exporting, setExporting] = useState(false);

  const [filterProject, setFilterProject] = useState('');
  const [filterFrom,    setFilterFrom]    = useState('');
  const [filterTo,      setFilterTo]      = useState('');
  const [search,        setSearch]        = useState('');
  const [expandedCats,  setExpandedCats]  = useState<Set<string>>(new Set());

  function toggleCat(key: string) {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  // Scope depends on the resolved user and their All-Projects permission, so a late-arriving
  // profile re-runs the load rather than leaving the page scoped to nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, user?.id, canViewAll]);

  async function loadAll() {
    setLoading(true);
    try {
      const pSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName')));
      const allProjects = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject));
      setProjects(allProjects.filter(p => p.enabledForSiteAccount));
      // Scoped to the projects this user may see, on the server — this page used to pull the
      // organisation's entire expense collection and filter it in the browser.
      const ledger = await loadScopedLedger({ projects: allProjects, userId: user?.id, canViewAll });
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
    categories: { name: string; count: number; total: number; rows: SASExpense[] }[];
    rows: SASExpense[];
  }

  const personGroups = useMemo(() => {
    const map = new Map<string, { count: number; total: number; catMap: Map<string, { count: number; total: number; rows: SASExpense[] }>; rows: SASExpense[] }>();
    filtered.forEach(e => {
      const person = (e.expensedBy || '').trim() || 'Unknown';
      if (!map.has(person)) map.set(person, { count: 0, total: 0, catMap: new Map(), rows: [] });
      const p = map.get(person)!;
      p.count += 1;
      p.total += e.expenseAmount || 0;
      p.rows.push(e);
      const cat = e.expenseCategory || 'Uncategorized';
      const cur = p.catMap.get(cat) ?? { count: 0, total: 0, rows: [] };
      cur.count += 1;
      cur.total += e.expenseAmount || 0;
      cur.rows.push(e);
      p.catMap.set(cat, cur);
    });
    return Array.from(map.entries())
      .map(([name, { count, total, catMap, rows }]): PersonRow => ({
        name, count, total,
        pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
        categories: Array.from(catMap.entries())
          .map(([catName, cv]) => ({ name: catName, count: cv.count, total: cv.total, rows: cv.rows.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate)) }))
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
      <PageHeader
        title="Person-wise Expense Report"
        description="Who spent what — grouped by person with category breakdown"
        actions={canExport ? (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        ) : undefined}
      />

      {/* Filters */}
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search person...' }}
        activeCount={[filterProject, filterFrom, filterTo].filter(Boolean).length}
        onClear={() => { setFilterProject(''); setFilterFrom(''); setFilterTo(''); setSearch(''); }}
      >
        <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
          <SelectTrigger aria-label="Project"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Projects</SelectItem>
            {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} aria-label="From date" />
        <Input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   aria-label="To date" />
      </FilterBar>

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
          <TableCard
            key={person.name}
            title={person.name}
            // Natural height: an expanded category nests its own table, whose header must not pin.
            scroll="natural"
            description={
              /* Distribution bar */
              <div className="mt-1.5 bg-rose-100 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-rose-500 rounded-full transition-all" style={{ width: `${person.pct}%` }} />
              </div>
            }
            actions={
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Badge variant="neutral">{person.count} entries</Badge>
                  <span className="text-muted-foreground">{person.pct.toFixed(1)}% of total</span>
                  <span className="font-bold tabular-nums text-rose-700">{formatINR(person.total)}</span>
                </div>
            }
          >
                <Table className="min-w-[450px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Entries</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-[140px]">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {person.categories.map(cat => {
                      const catKey = `${person.name}:${cat.name}`;
                      const isExpanded = expandedCats.has(catKey);
                      return (
                        <Fragment key={cat.name}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() => toggleCat(catKey)}
                          >
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                {isExpanded
                                  ? <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                <Badge variant="outline">{cat.name}</Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{cat.count}</TableCell>
                            <TableCell className="text-right whitespace-nowrap tabular-nums font-medium text-rose-700">{formatINR(cat.total)}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-rose-100 rounded-full h-1.5 overflow-hidden">
                                  <div className="h-full bg-rose-400 rounded-full" style={{ width: `${person.total > 0 ? (cat.total / person.total) * 100 : 0}%` }} />
                                </div>
                                <span className="text-xs text-muted-foreground w-8 text-right">
                                  {person.total > 0 ? ((cat.total / person.total) * 100).toFixed(0) : 0}%
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>

                          {isExpanded && (
                            <TableRow className="bg-slate-50/50">
                              <TableCell colSpan={4}>
                                <div className="rounded-lg border bg-white">
                                  <Table className="min-w-[760px]">
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="whitespace-nowrap">Date</TableHead>
                                        <TableHead>Project</TableHead>
                                        <TableHead>Sub-Category</TableHead>
                                        <TableHead>Narration</TableHead>
                                        <TableHead>Vendor / Party</TableHead>
                                        <TableHead>Bill No.</TableHead>
                                        <TableHead>Mode</TableHead>
                                        <TableHead>Remarks</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead className="text-center">Docs</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {cat.rows.map(e => (
                                        <TableRow key={e.id}>
                                          <TableCell className="whitespace-nowrap">{e.expenseDate}</TableCell>
                                          <TableCell className="max-w-[140px] truncate" title={e.projectName}>{e.projectName}</TableCell>
                                          <TableCell>{e.expenseSubCategory || '—'}</TableCell>
                                          <TableCell className="max-w-[160px] truncate" title={e.narration || ''}>{e.narration || '—'}</TableCell>
                                          <TableCell className="max-w-[130px] truncate" title={e.vendorPartyName || ''}>{e.vendorPartyName || '—'}</TableCell>
                                          <TableCell className="font-mono whitespace-nowrap">{e.billNo || '—'}</TableCell>
                                          <TableCell><Badge variant="neutral">{e.paymentMode}</Badge></TableCell>
                                          <TableCell className="max-w-[180px] truncate" title={e.remarks || ''}>{e.remarks || '—'}</TableCell>
                                          <TableCell className="text-right whitespace-nowrap tabular-nums font-medium text-rose-700">{formatINR(e.expenseAmount)}</TableCell>
                                          <TableCell className="text-center">
                                            {e.attachments && e.attachments.length > 0 ? (
                                              <div className="flex items-center justify-center gap-1">
                                                {e.attachments.map((att, i) => (
                                                  <a
                                                    key={i}
                                                    href={att.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title={att.name}
                                                    className="text-blue-600 hover:text-blue-800"
                                                    onClick={ev => ev.stopPropagation()}
                                                  >
                                                    <Paperclip className="h-3 w-3" />
                                                  </a>
                                                ))}
                                              </div>
                                            ) : <span className="text-muted-foreground">—</span>}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                    <TableFooter>
                                      <TableRow>
                                        <TableCell colSpan={8} className="text-right">Subtotal</TableCell>
                                        <TableCell className="text-right whitespace-nowrap tabular-nums text-rose-700">{formatINR(cat.total)}</TableCell>
                                        <TableCell />
                                      </TableRow>
                                    </TableFooter>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">{person.count}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums text-rose-700">{formatINR(person.total)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
          </TableCard>
        ))
      )}
    </div>
  );
}
