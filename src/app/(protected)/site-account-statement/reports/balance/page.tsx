'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatINR, SAS_COLLECTIONS, type SASExpense, type SASPayment, type SASProject } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, Download, Loader2, ShieldAlert, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';
const HEALTHY_THRESHOLD  = 50000;
const WARNING_THRESHOLD  = 0;

type BalanceStatus = 'healthy' | 'warning' | 'critical';

function getStatus(balance: number): BalanceStatus {
  if (balance >= HEALTHY_THRESHOLD) return 'healthy';
  if (balance >= WARNING_THRESHOLD)  return 'warning';
  return 'critical';
}

export default function BalanceStatusPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canView    = can('View', `${MODULE}.Reports`) || canViewAll;
  const canExport  = can('Export', `${MODULE}.Reports`);

  const [projects, setProjects] = useState<SASProject[]>([]);
  const [payments, setPayments] = useState<SASPayment[]>([]);
  const [expenses, setExpenses] = useState<SASExpense[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search,    setSearch]    = useState('');
  const [filterStatus, setFilterStatus] = useState<BalanceStatus | ''>('');

  useEffect(() => {
    if (!isAuthLoading && canView) void loadAll();
  }, [isAuthLoading, canView]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, paySnap, expSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
    } finally {
      setLoading(false);
    }
  }

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p => p.assignedPersonId === user?.id),
    [projects, user?.id, canViewAll]
  );

  const projectStats = useMemo(() => visibleProjects.map(proj => {
    const received = payments.filter(p => p.projectId === proj.id).reduce((s, p) => s + (p.receivedAmount || 0), 0);
    const spent    = expenses.filter(e => e.projectId === proj.id).reduce((s, e) => s + (e.expenseAmount || 0), 0);
    const balance  = received - spent;
    return {
      id: proj.id,
      name: proj.projectName,
      code: proj.projectCode || '',
      assignedPerson: proj.assignedPersonName || '—',
      received, spent, balance,
      status: getStatus(balance),
    };
  }), [visibleProjects, payments, expenses]);

  const filtered = useMemo(() => projectStats.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.assignedPerson.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    return true;
  }), [projectStats, search, filterStatus]);

  const counts = useMemo(() => ({
    healthy:  projectStats.filter(p => p.status === 'healthy').length,
    warning:  projectStats.filter(p => p.status === 'warning').length,
    critical: projectStats.filter(p => p.status === 'critical').length,
  }), [projectStats]);

  const totals = useMemo(() => ({
    received: filtered.reduce((s, p) => s + p.received, 0),
    spent:    filtered.reduce((s, p) => s + p.spent, 0),
    balance:  filtered.reduce((s, p) => s + p.balance, 0),
  }), [filtered]);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Balance Status');
      ws.columns = [
        { header: 'Project',         key: 'name',    width: 30 },
        { header: 'Code',            key: 'code',    width: 12 },
        { header: 'Assigned Person', key: 'person',  width: 22 },
        { header: 'Total Received',  key: 'received',width: 18 },
        { header: 'Total Expenses',  key: 'spent',   width: 18 },
        { header: 'Balance',         key: 'balance', width: 16 },
        { header: 'Status',          key: 'status',  width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach(p => ws.addRow({ name: p.name, code: p.code, person: p.assignedPerson, received: p.received, spent: p.spent, balance: p.balance, status: p.status.toUpperCase() }));
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'balance-status.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  const statusConfig = {
    healthy:  { label: 'Healthy',  icon: CheckCircle2,  color: 'text-emerald-600', bg: 'bg-emerald-50',  border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
    warning:  { label: 'Warning',  icon: AlertTriangle, color: 'text-amber-600',   bg: 'bg-amber-50',    border: 'border-amber-200',   badge: 'bg-amber-100 text-amber-700'    },
    critical: { label: 'Critical', icon: ShieldAlert,   color: 'text-destructive', bg: 'bg-red-50',      border: 'border-red-200',     badge: 'bg-red-100 text-red-700'        },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Project Balance Status</h1>
          <p className="text-sm text-muted-foreground">
            Health overview — Healthy ≥ ₹{(HEALTHY_THRESHOLD / 1000).toFixed(0)}k · Warning ≥ ₹0 · Critical &lt; ₹0
          </p>
        </div>
        {canExport && (
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </Button>
        )}
      </div>

      {/* Status summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        {(['healthy', 'warning', 'critical'] as BalanceStatus[]).map(s => {
          const cfg = statusConfig[s];
          const Icon = cfg.icon;
          const count = counts[s];
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(prev => prev === s ? '' : s)}
              className={cn(
                'rounded-xl border px-4 py-3 text-left transition-all',
                cfg.bg, cfg.border,
                filterStatus === s && 'ring-2 ring-offset-1',
                filterStatus === s ? `ring-${s === 'healthy' ? 'emerald' : s === 'warning' ? 'amber' : 'red'}-400` : ''
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn('h-4 w-4', cfg.color)} />
                <p className="text-xs font-medium text-muted-foreground">{cfg.label}</p>
              </div>
              <p className={cn('text-2xl font-bold mt-0.5', cfg.color)}>{count}</p>
              <p className="text-xs text-muted-foreground">project{count !== 1 ? 's' : ''}</p>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex gap-2 flex-wrap">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search project or person..." className="h-9 text-sm max-w-xs" />
        {filterStatus && (
          <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setFilterStatus('')}>
            Clear: {statusConfig[filterStatus].label}
          </Button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Wallet className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No projects match the selected filter.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium">#</th>
                    <th className="px-4 py-2.5 text-left font-medium">Project</th>
                    <th className="px-4 py-2.5 text-left font-medium">Assigned To</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      <span className="flex items-center justify-end gap-1"><TrendingUp className="h-3.5 w-3.5 text-blue-500" />Received</span>
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      <span className="flex items-center justify-end gap-1"><TrendingDown className="h-3.5 w-3.5 text-rose-500" />Expenses</span>
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      <span className="flex items-center justify-end gap-1"><Wallet className="h-3.5 w-3.5 text-emerald-500" />Balance</span>
                    </th>
                    <th className="px-4 py-2.5 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((proj, idx) => {
                    const cfg = statusConfig[proj.status];
                    return (
                      <tr key={proj.id} className={cn('border-b hover:bg-muted/20 transition-colors', proj.status === 'critical' && 'bg-red-50/30')}>
                        <td className="px-4 py-2.5 text-muted-foreground">{idx + 1}</td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{proj.name}</p>
                          {proj.code && <p className="text-xs text-muted-foreground">{proj.code}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{proj.assignedPerson}</td>
                        <td className="px-4 py-2.5 text-right text-blue-600">{formatINR(proj.received)}</td>
                        <td className="px-4 py-2.5 text-right text-rose-600">{formatINR(proj.spent)}</td>
                        <td className={cn('px-4 py-2.5 text-right font-semibold', proj.balance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                          {formatINR(proj.balance)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <Badge className={cn('text-xs', cfg.badge)}>{cfg.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-bold">
                    <td colSpan={3} className="px-4 py-2.5">Total ({filtered.length} projects)</td>
                    <td className="px-4 py-2.5 text-right text-blue-700">{formatINR(totals.received)}</td>
                    <td className="px-4 py-2.5 text-right text-rose-700">{formatINR(totals.spent)}</td>
                    <td className={cn('px-4 py-2.5 text-right', totals.balance >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                      {formatINR(totals.balance)}
                    </td>
                    <td />
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
