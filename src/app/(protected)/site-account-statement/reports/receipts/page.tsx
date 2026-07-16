'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASPayment, type SASProject } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Download, FileText, Filter, Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

export default function ReceiptReportPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View',   `${MODULE}.All Projects`);
  const canView    = can('View',   `${MODULE}.Reports`) || canViewAll;
  const canExport  = can('Export', `${MODULE}.Reports`);

  const [projects,   setProjects]   = useState<SASProject[]>([]);
  const [payments,   setPayments]   = useState<SASPayment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [exporting,  setExporting]  = useState(false);

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
      const [pSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments), orderBy('receiptDate', 'desc'))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
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

  const total = useMemo(() => filtered.reduce((s, p) => s + (p.receivedAmount || 0), 0), [filtered]);

  // Group by project
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; rows: SASPayment[]; total: number }>();
    filtered.forEach(p => {
      const key = p.projectId || p.projectName;
      if (!map.has(key)) map.set(key, { name: p.projectName, rows: [], total: 0 });
      const g = map.get(key)!;
      g.rows.push(p);
      g.total += p.receivedAmount || 0;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Project-Wise Receipt Report</h1>
          <p className="text-sm text-muted-foreground">Payments received from Head Office</p>
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
            {c > 0 && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">{c}</span>}
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
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="h-9 text-sm" />
      </div>

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
          <Card key={group.name} className="bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center justify-between">
                <span>{group.name}</span>
                <span className="text-blue-600">{formatINR(group.total)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[400px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b bg-slate-100">
                      <th className="px-4 py-2 text-left font-medium">Date</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                      <th className="px-4 py-2 text-left font-medium">Mode</th>
                      <th className="px-4 py-2 text-left font-medium">Ref. No.</th>
                      <th className="px-4 py-2 text-left font-medium">Received By</th>
                      <th className="px-4 py-2 text-left font-medium">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map(row => (
                      <tr key={row.id} className="border-b hover:bg-muted/20">
                        <td className="px-4 py-2">{row.receiptDate}</td>
                        <td className="px-4 py-2 text-right font-medium text-blue-700">{formatINR(row.receivedAmount)}</td>
                        <td className="px-4 py-2"><Badge variant="secondary">{row.paymentMode}</Badge></td>
                        <td className="px-4 py-2 text-muted-foreground">{row.referenceNo || '—'}</td>
                        <td className="px-4 py-2">{row.receivedBy || '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground max-w-[200px] truncate">{row.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold text-sm">
                      <td className="px-4 py-2">Subtotal</td>
                      <td className="px-4 py-2 text-right text-blue-700">{formatINR(group.total)}</td>
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
