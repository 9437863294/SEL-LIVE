'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, doc, getDocs, query, Timestamp, updateDoc, where } from 'firebase/firestore';
import { Check, Download, Eye, FilePlus2, Loader2, RefreshCw, RotateCcw, Search, ShieldAlert, X } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  FD_COLLECTIONS,
  RESERVED_ASSIGNMENT_STATUSES,
  assignmentOutstanding,
  calculateEligibleValue,
  deriveOperationalStatus,
  fdStatusLabel,
  formatFdCurrency,
  isActiveFd,
  toDate,
  type FDAssignment,
  type FixedDeposit,
} from '@/lib/fixed-deposit';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Mode = 'all' | 'available' | 'approvals';
type ComputedRow = FixedDeposit & { computedStatus: string; computedEligible: number; computedBg: number; computedLc: number; computedReserved: number; computedAvailable: number };

const statusTone = (status: string) => {
  if (['ACTIVE', 'APPROVED'].includes(status)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status.includes('PENDING') || status.includes('APPROACHING')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status.includes('CLOSED') || status === 'MATURED' || status === 'CANCELLED') return 'bg-slate-100 text-slate-600 border-slate-200';
  if (status.includes('UTILIZED')) return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-violet-50 text-violet-700 border-violet-200';
};

export default function FixedDepositRegister({ mode = 'all' }: { mode?: Mode }) {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const [deposits, setDeposits] = useState<FixedDeposit[]>([]);
  const [assignments, setAssignments] = useState<FDAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [queryText, setQueryText] = useState('');
  const [status, setStatus] = useState('ALL');
  const [selected, setSelected] = useState<ComputedRow | null>(null);

  const resource = mode === 'available' ? 'Available FDs' : mode === 'approvals' ? 'Approvals' : 'FD Register';
  const canView = can('View', `Fixed Deposit Management.${resource}`);
  const canAdd = can('Add', 'Fixed Deposit Management.FD Register');
  const canApprove = can('Approve', 'Fixed Deposit Management.Approvals');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scoped = (name: string) => user?.role === 'Super Admin' || !user?.organizationId ? collection(db, name) : query(collection(db, name), where('organizationId', '==', user.organizationId));
      const [fdSnap, assignmentSnap] = await Promise.all([getDocs(scoped(FD_COLLECTIONS.deposits)), getDocs(scoped(FD_COLLECTIONS.assignments))]);
      setDeposits(fdSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FixedDeposit)).filter((fd) => !fd.isDeleted));
      setAssignments(assignmentSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FDAssignment)));
    } catch (error) {
      console.error('Unable to load FD register', error); toast({ title: 'Unable to load FD register', variant: 'destructive' });
    } finally { setLoading(false); }
  }, [toast, user?.organizationId, user?.role]);

  useEffect(() => { if (!authLoading && canView) void load(); else if (!authLoading) setLoading(false); }, [authLoading, canView, load]);

  const rows = useMemo<ComputedRow[]>(() => deposits.map((fd) => {
    const linked = assignments.filter((item) => item.fdId === fd.id);
    const active = linked.filter((item) => ACTIVE_ASSIGNMENT_STATUSES.includes(item.status));
    const reservedRows = linked.filter((item) => RESERVED_ASSIGNMENT_STATUSES.includes(item.status));
    const bg = active.filter((item) => item.instrumentType === 'BG').reduce((total, item) => total + assignmentOutstanding(item), 0);
    const lc = active.filter((item) => item.instrumentType === 'LC').reduce((total, item) => total + assignmentOutstanding(item), 0);
    const reserved = reservedRows.reduce((total, item) => total + assignmentOutstanding(item), 0);
    const eligible = Number(fd.eligibleValue || calculateEligibleValue(fd.principalAmount, fd.eligibleMarginPercentage || 100));
    return { ...fd, computedStatus: deriveOperationalStatus({ ...fd, bgUtilizedAmount: bg, lcUtilizedAmount: lc, reservedAmount: reserved, totalUtilizedAmount: bg + lc, availableAmount: Math.max(0, eligible - bg - lc - reserved) }), computedEligible: eligible, computedBg: bg, computedLc: lc, computedReserved: reserved, computedAvailable: Math.max(0, eligible - bg - lc - reserved) };
  }), [assignments, deposits]);

  const visibleRows = useMemo(() => rows.filter((row) => {
    if (mode === 'available' && (!isActiveFd(row) || row.computedAvailable <= 0)) return false;
    if (mode === 'approvals' && row.approvalStatus !== 'PENDING') return false;
    if (status !== 'ALL' && row.computedStatus !== status) return false;
    const term = queryText.trim().toLowerCase();
    return !term || `${row.referenceNumber} ${row.fdNumber} ${row.bankName} ${row.branchName || ''} ${row.holderName} ${row.organizationName || ''} ${row.projectName || ''}`.toLowerCase().includes(term);
  }).sort((a, b) => (toDate(a.maturityDate)?.getTime() || 0) - (toDate(b.maturityDate)?.getTime() || 0)), [mode, queryText, rows, status]);

  const totals = useMemo(() => ({ principal: visibleRows.reduce((total, row) => total + row.principalAmount, 0), available: visibleRows.reduce((total, row) => total + row.computedAvailable, 0) }), [visibleRows]);

  const decide = async (row: ComputedRow, action: 'approve' | 'reject' | 'return') => {
    if (!user || !canApprove) return;
    setWorkingId(row.id);
    try {
      const now = Timestamp.now();
      await updateDoc(doc(db, FD_COLLECTIONS.deposits, row.id), action === 'approve' ? { status: 'ACTIVE', approvalStatus: 'APPROVED', approvedBy: user.id, approvedByName: user.name, approvedAt: now, updatedBy: user.id, updatedByName: user.name, updatedAt: now } : { status: 'DRAFT', approvalStatus: action === 'reject' ? 'REJECTED' : 'RETURNED', updatedBy: user.id, updatedByName: user.name, updatedAt: now });
      toast({ title: action === 'approve' ? 'FD approved and activated' : action === 'reject' ? 'FD rejected' : 'FD returned for correction', description: row.referenceNumber });
      await load();
    } catch (error) { console.error('FD approval action failed', error); toast({ title: 'Action failed', variant: 'destructive' }); } finally { setWorkingId(''); }
  };

  const exportRegister = async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('FD Register');
    sheet.columns = [{ header: 'Reference', key: 'reference', width: 24 }, { header: 'FD Number', key: 'number', width: 22 }, { header: 'Organization', key: 'organization', width: 24 }, { header: 'Bank', key: 'bank', width: 24 }, { header: 'Holder', key: 'holder', width: 24 }, { header: 'Type', key: 'type', width: 16 }, { header: 'Status', key: 'status', width: 20 }, { header: 'Principal', key: 'principal', width: 18 }, { header: 'Eligible', key: 'eligible', width: 18 }, { header: 'BG Utilised', key: 'bg', width: 18 }, { header: 'LC Utilised', key: 'lc', width: 18 }, { header: 'Reserved', key: 'reserved', width: 18 }, { header: 'Available', key: 'available', width: 18 }, { header: 'Maturity Date', key: 'maturity', width: 16 }];
    visibleRows.forEach((row) => sheet.addRow({ reference: row.referenceNumber, number: row.fdNumber, organization: row.organizationName, bank: row.bankName, holder: row.holderName, type: row.fdType, status: fdStatusLabel(row.computedStatus), principal: row.principalAmount, eligible: row.computedEligible, bg: row.computedBg, lc: row.computedLc, reserved: row.computedReserved, available: row.computedAvailable, maturity: toDate(row.maturityDate)?.toISOString().slice(0, 10) || '' }));
    sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }]; ['principal', 'eligible', 'bg', 'lc', 'reserved', 'available'].forEach((key) => { sheet.getColumn(key).numFmt = '₹#,##0.00'; });
    const buffer = await workbook.xlsx.writeBuffer(); const href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const anchor = document.createElement('a'); anchor.href = href; anchor.download = `fd-${mode}-${new Date().toISOString().slice(0, 10)}.xlsx`; anchor.click(); URL.revokeObjectURL(href);
  };

  const title = mode === 'available' ? 'Available FDs' : mode === 'approvals' ? 'Pending FD Approvals' : 'FD Register';
  const description = mode === 'available' ? 'Active FDs with positive balance available for new BG or LC assignments.' : mode === 'approvals' ? 'Fixed deposits awaiting review and activation.' : 'Complete fixed-deposit register with live utilisation and available values.';

  if (authLoading || loading) return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></div>;
  if (!canView) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this workspace.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;

  return <div className="space-y-4">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold tracking-tight">{title}</h1><p className="text-sm text-muted-foreground">{description}</p></div><div className="flex gap-2">{canAdd && <Button asChild><Link href="/fixed-deposit/new"><FilePlus2 className="mr-2 h-4 w-4" />Create New FD</Link></Button>}<Button variant="outline" onClick={() => void exportRegister()}><Download className="mr-2 h-4 w-4" />Export</Button><Button variant="outline" size="icon" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button></div></div>
    <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">FD Count</p><p className="mt-1 text-2xl font-bold">{visibleRows.length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Principal Amount</p><p className="mt-1 text-xl font-bold">{formatFdCurrency(totals.principal)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Available Balance</p><p className="mt-1 text-xl font-bold text-emerald-700">{formatFdCurrency(totals.available)}</p></CardContent></Card></div>
    <Card><CardContent className="flex flex-col gap-2 p-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Search reference, FD number, bank, holder, project…" className="pl-9" /></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All statuses</SelectItem>{Array.from(new Set(rows.map((row) => row.computedStatus))).sort().map((value) => <SelectItem key={value} value={value}>{fdStatusLabel(value)}</SelectItem>)}</SelectContent></Select></CardContent></Card>
    <Card className="overflow-hidden"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>FD</TableHead><TableHead>Bank / Holder</TableHead><TableHead className="text-right">Principal</TableHead><TableHead className="text-right">Eligible</TableHead><TableHead className="text-right">BG / LC Utilised</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Available</TableHead><TableHead>Maturity</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
      {visibleRows.map((row) => <TableRow key={row.id}><TableCell><p className="font-medium">{row.referenceNumber}</p><p className="text-xs text-muted-foreground">{row.fdNumber} · {row.fdType === 'SECURITY' ? 'Security FD' : 'Regular FD'}</p></TableCell><TableCell><p>{row.bankName}</p><p className="text-xs text-muted-foreground">{row.holderName}</p></TableCell><TableCell className="text-right font-medium">{formatFdCurrency(row.principalAmount, row.currency)}</TableCell><TableCell className="text-right">{formatFdCurrency(row.computedEligible, row.currency)}</TableCell><TableCell className="text-right"><p>{formatFdCurrency(row.computedBg, row.currency)}</p><p className="text-xs text-muted-foreground">LC {formatFdCurrency(row.computedLc, row.currency)}</p></TableCell><TableCell className="text-right">{formatFdCurrency(row.computedReserved, row.currency)}</TableCell><TableCell className="text-right font-semibold text-emerald-700">{formatFdCurrency(row.computedAvailable, row.currency)}</TableCell><TableCell><p>{toDate(row.maturityDate)?.toLocaleDateString('en-IN') || '-'}</p></TableCell><TableCell><Badge variant="outline" className={statusTone(row.computedStatus)}>{fdStatusLabel(row.computedStatus)}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => setSelected(row)} aria-label="View FD"><Eye className="h-4 w-4" /></Button>{mode === 'approvals' && canApprove && <><Button variant="ghost" size="icon" className="text-emerald-700" disabled={workingId === row.id} onClick={() => void decide(row, 'approve')} aria-label="Approve"><Check className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-amber-700" disabled={workingId === row.id} onClick={() => void decide(row, 'return')} aria-label="Return"><RotateCcw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-rose-700" disabled={workingId === row.id} onClick={() => void decide(row, 'reject')} aria-label="Reject"><X className="h-4 w-4" /></Button></>}</div></TableCell></TableRow>)}
      {!visibleRows.length && <TableRow><TableCell colSpan={10} className="h-32 text-center text-muted-foreground">No fixed deposits match this view.</TableCell></TableRow>}
    </TableBody></Table></div></CardContent></Card>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{selected?.referenceNumber}</DialogTitle><DialogDescription>FD {selected?.fdNumber} · {selected?.bankName}</DialogDescription></DialogHeader>{selected && <div className="grid gap-4 py-2 sm:grid-cols-2 lg:grid-cols-3">{[
      ['Organization', selected.organizationName || selected.organizationId], ['FD Holder', selected.holderName], ['FD Type', selected.fdType === 'SECURITY' ? 'Security FD' : 'Regular FD'], ['Branch', selected.branchName || '-'], ['Purpose', selected.purpose], ['Project', selected.projectName || 'Unassigned'], ['Principal', formatFdCurrency(selected.principalAmount, selected.currency)], ['Eligible Value', formatFdCurrency(selected.computedEligible, selected.currency)], ['BG Utilised', formatFdCurrency(selected.computedBg, selected.currency)], ['LC Utilised', formatFdCurrency(selected.computedLc, selected.currency)], ['Reserved', formatFdCurrency(selected.computedReserved, selected.currency)], ['Available', formatFdCurrency(selected.computedAvailable, selected.currency)], ['Interest Rate', `${selected.interestRate}%`], ['Maturity Amount', formatFdCurrency(selected.maturityAmount, selected.currency)], ['Maturity Date', toDate(selected.maturityDate)?.toLocaleDateString('en-IN') || '-'], ['Auto Renewal', selected.autoRenewal ? 'Yes' : 'No'], ['Approval Status', selected.approvalStatus], ['Remarks', selected.remarks || '-'],
    ].map(([label, value]) => <div key={label}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 text-sm font-medium">{value}</p></div>)}</div>}</DialogContent></Dialog>
  </div>;
}
