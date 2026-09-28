'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASPayment, type SASProject } from '@/lib/site-account-statement';
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
import { Download, FileText, Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

export default function ReceiptReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const sortControl = useSortControl('reportReceipts');
  const canViewAll = can('View',   `${MODULE}.All Projects`);
  const canView    = can('View',   `${MODULE}.Reports`);
  const canExport  = can('Export', `${MODULE}.Reports`);

  const [projects,   setProjects]   = useState<SASProject[]>([]);
  const [payments,   setPayments]   = useState<SASPayment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [exporting,  setExporting]  = useState(false);

  const [filterProject, setFilterProject] = useState('');
  const [filterFrom,    setFilterFrom]    = useState('');
  const [filterTo,      setFilterTo]      = useState('');
  const [search,        setSearch]        = useState('');

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
      // organisation's entire payment collection and filter it in the browser.
      const ledger = await loadScopedLedger({ projects: allProjects, userId: user?.id, canViewAll });
      setPayments(ledger.payments);
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

  const filtered = useMemo(() => payments.filter(p => {
    if (userProjectIds && !userProjectIds.has(p.projectId)) return false;
    if (filterProject && p.projectId !== filterProject) return false;
    if (filterFrom    && p.receiptDate < filterFrom)    return false;
    if (filterTo      && p.receiptDate > filterTo)      return false;
    if (search && !(p.projectName || '').toLowerCase().includes(search.toLowerCase()) &&
        !(p.receivedBy || '').toLowerCase().includes(search.toLowerCase()) &&
        !(p.referenceNo || '').toLowerCase().includes(search.toLowerCase()))  return false;
    return true;
  }), [payments, userProjectIds, filterProject, filterFrom, filterTo, search]);

  // The whole scope is already in memory here, so ordering it is a plain wrap.
  const sorted = useMemo(() => sortControl.sortRows(filtered), [filtered, sortControl]);

  const total = useMemo(() => filtered.reduce((s, p) => s + (p.receivedAmount || 0), 0), [filtered]);

  // Group by project
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; rows: SASPayment[]; total: number }>();
    sorted.forEach(p => {
      const key = p.projectId || p.projectName;
      if (!map.has(key)) map.set(key, { name: p.projectName, rows: [], total: 0 });
      const g = map.get(key)!;
      g.rows.push(p);
      g.total += p.receivedAmount || 0;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sorted]);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Receipt Report');
      ws.columns = [
        { header: 'Project',        key: 'projectName',     width: 28 },
        { header: 'Receipt Date',   key: 'receiptDate',     width: 14 },
        { header: 'Amount (₹)',     key: 'receivedAmount',  width: 14 },
        { header: 'Payment Mode',   key: 'paymentMode',     width: 14 },
        { header: 'Reference No.',  key: 'referenceNo',     width: 20 },
        { header: 'Received By',    key: 'receivedBy',      width: 20 },
        { header: 'Remarks',        key: 'remarks',         width: 30 },
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach(p => ws.addRow({ ...p }));
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'receipt-report.xlsx'; a.click();
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
        title="Project-Wise Receipt Report"
        description="Payments received from Head Office"
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
        <SortControl control={sortControl} />
      </FilterBar>

      {/* Total */}
      <div className="rounded-lg border bg-blue-50 px-4 py-2.5 text-sm text-blue-700 font-medium">
        Total Receipt: <strong>{formatINR(total)}</strong> — {filtered.length} records
      </div>

      {/* Grouped tables */}
      {grouped.length === 0 ? (
        <Card className="bg-white/80"><CardContent className="flex flex-col items-center gap-3 py-12">
          <FileText className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No records found.</p>
        </CardContent></Card>
      ) : (
        grouped.map(group => (
          <TableCard
            key={group.name}
            title={group.name}
            count={group.rows.length}
            noun="receipt"
            actions={<span className="text-sm font-semibold tabular-nums text-blue-600">{formatINR(group.total)}</span>}
          >
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Ref. No.</TableHead>
                      <TableHead>Received By</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.rows.map(row => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">{row.receiptDate}</TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums font-medium text-blue-700">{formatINR(row.receivedAmount)}</TableCell>
                        <TableCell><Badge variant="neutral">{row.paymentMode}</Badge></TableCell>
                        <TableCell className="font-mono whitespace-nowrap">{row.referenceNo || '—'}</TableCell>
                        <TableCell>{row.receivedBy || '—'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{row.remarks || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell>Subtotal</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums text-blue-700">{formatINR(group.total)}</TableCell>
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
