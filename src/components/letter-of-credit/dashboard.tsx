'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  FilePlus2,
  FileWarning,
  Landmark,
  Link2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Undo2,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { ACTIVE_ASSIGNMENT_STATUSES, assignmentOutstanding, type FDAssignment } from '@/lib/fixed-deposit';
import { LC_COLLECTIONS, LC_PERMISSION_MODULE, daysUntil, formatLcCurrency, lcLabel, toLcDate, type LCHundi, type LCRequest, type LetterOfCredit } from '@/lib/letter-of-credit';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type GenericRow = Record<string, any> & { id: string };
type Filters = { bank: string; project: string; vendor: string; status: string; currency: string };
const EMPTY_FILTERS: Filters = { bank: 'ALL', project: 'ALL', vendor: 'ALL', status: 'ALL', currency: 'ALL' };
const OPEN_STATUSES = new Set(['APPROVED_FOR_OPENING', 'SUBMITTED_TO_BANK', 'BANK_QUERY', 'OPENED', 'ACTIVE', 'PARTIALLY_UTILIZED', 'FULLY_UTILIZED', 'AMENDMENT_PENDING', 'DOCUMENTS_AWAITED', 'HUNDI_AWAITED', 'HUNDI_RECEIVED', 'DISCREPANCY', 'ACCEPTED', 'PAYMENT_DUE', 'PARTIALLY_PAID', 'PAID', 'CLOSURE_PENDING', 'EXPIRED', 'ON_HOLD']);
const PIE_COLORS = ['#0891b2', '#2563eb', '#7c3aed', '#d97706', '#dc2626', '#059669', '#475569'];

function Metric({ label, value, secondary, icon: Icon, tone = 'cyan', alert = false }: { label: string; value: string; secondary?: string; icon: LucideIcon; tone?: 'cyan' | 'blue' | 'amber' | 'emerald' | 'violet' | 'rose'; alert?: boolean }) {
  const style = { cyan: 'from-cyan-500/15 to-sky-500/5 text-cyan-700', blue: 'from-blue-500/15 to-indigo-500/5 text-blue-700', amber: 'from-amber-500/15 to-orange-500/5 text-amber-700', emerald: 'from-emerald-500/15 to-teal-500/5 text-emerald-700', violet: 'from-violet-500/15 to-indigo-500/5 text-violet-700', rose: 'from-rose-500/15 to-red-500/5 text-rose-700' }[tone];
  return <Card className={cn('relative overflow-hidden border-white/80 bg-gradient-to-br shadow-sm', style)}><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 truncate text-xl font-bold tracking-tight text-slate-900">{value}</p>{secondary && <p className={cn('mt-1 text-xs text-slate-500', alert && 'font-medium text-rose-600')}>{secondary}</p>}</div><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm"><Icon className="h-4 w-4" /></div></div></CardContent></Card>;
}

export default function LetterOfCreditDashboard() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const [requests, setRequests] = useState<LCRequest[]>([]);
  const [credits, setCredits] = useState<LetterOfCredit[]>([]);
  const [limits, setLimits] = useState<GenericRow[]>([]);
  const [hundis, setHundis] = useState<LCHundi[]>([]);
  const [assignments, setAssignments] = useState<FDAssignment[]>([]);
  const [recoveries, setRecoveries] = useState<GenericRow[]>([]);
  const [discrepancies, setDiscrepancies] = useState<GenericRow[]>([]);
  const [closures, setClosures] = useState<GenericRow[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const canView = can('View', `${LC_PERMISSION_MODULE}.Dashboard`) || can('View Module', LC_PERMISSION_MODULE);
  const canExport = can('Export', `${LC_PERMISSION_MODULE}.Dashboard`);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scoped = (name: string) => user?.role === 'Super Admin' || !user?.organizationId ? collection(db, name) : query(collection(db, name), where('organizationId', '==', user.organizationId));
      const [requestSnapshot, creditSnapshot, limitSnapshot, hundiSnapshot, assignmentSnapshot, recoverySnapshot, discrepancySnapshot, closureSnapshot] = await Promise.all([
        getDocs(scoped(LC_COLLECTIONS.requests)), getDocs(scoped(LC_COLLECTIONS.credits)), getDocs(scoped(LC_COLLECTIONS.bankLimits)), getDocs(scoped(LC_COLLECTIONS.hundis)), getDocs(scoped('fdAssignments')), getDocs(scoped(LC_COLLECTIONS.recoveries)), getDocs(scoped(LC_COLLECTIONS.discrepancies)), getDocs(scoped(LC_COLLECTIONS.closures)),
      ]);
      setRequests(requestSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as LCRequest)).filter((item) => !item.isDeleted));
      setCredits(creditSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as LetterOfCredit)).filter((item) => !item.isDeleted));
      setLimits(limitSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setHundis(hundiSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as LCHundi)));
      setAssignments(assignmentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as FDAssignment)).filter((item) => item.instrumentType === 'LC'));
      setRecoveries(recoverySnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setDiscrepancies(discrepancySnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setClosures(closureSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    } catch (error) { console.error('Unable to load LC dashboard', error); toast({ title: 'Unable to load LC dashboard', description: 'Please check your connection and permissions.', variant: 'destructive' }); } finally { setLoading(false); }
  }, [toast, user?.organizationId, user?.role]);

  useEffect(() => { if (!authLoading && canView) void load(); else if (!authLoading) setLoading(false); }, [authLoading, canView, load]);

  const filteredCredits = useMemo(() => credits.filter((lc) => (filters.bank === 'ALL' || lc.bankId === filters.bank) && (filters.project === 'ALL' || lc.projectId === filters.project) && (filters.vendor === 'ALL' || lc.vendorId === filters.vendor) && (filters.status === 'ALL' || lc.status === filters.status) && (filters.currency === 'ALL' || lc.currency === filters.currency)), [credits, filters]);
  const creditIds = useMemo(() => new Set(filteredCredits.map((item) => item.id)), [filteredCredits]);
  const filteredRequests = useMemo(() => requests.filter((item) => (filters.bank === 'ALL' || item.preferredBankId === filters.bank) && (filters.project === 'ALL' || item.projectId === filters.project) && (filters.vendor === 'ALL' || item.vendorId === filters.vendor) && (filters.currency === 'ALL' || item.currency === filters.currency)), [filters, requests]);
  const active = useMemo(() => filteredCredits.filter((item) => OPEN_STATUSES.has(item.status)), [filteredCredits]);
  const asOn = new Date();
  const monthKey = asOn.toISOString().slice(0, 7);

  const metrics = useMemo(() => {
    const relevantLimits = limits.filter((item) => filters.bank === 'ALL' || item.bankId === filters.bank);
    const sanction = relevantLimits.reduce((sum, item) => sum + Number(item.sanctionedAmount || 0) + Number(item.temporaryLimit || 0), 0);
    const activeExposure = active.reduce((sum, item) => sum + Number(item.openedAmount || 0), 0);
    const pendingOpening = filteredRequests.filter((item) => item.status === 'APPROVED').reduce((sum, item) => sum + item.requestedAmount, 0);
    const utilized = activeExposure + pendingOpening;
    const openedMonth = filteredCredits.filter((item) => (toLcDate(item.openingDate)?.toISOString().slice(0, 7) || '') === monthKey);
    const due = (maxDays: number, exact = false) => active.filter((item) => { const days = daysUntil(item.actualDueDate || item.expectedDueDate); return days !== null && (exact ? days === maxDays : days >= 0 && days <= maxDays) && item.outstandingAmount > 0; });
    const dueAmount = (rows: LetterOfCredit[]) => rows.reduce((sum, item) => sum + item.outstandingAmount, 0);
    const overdue = active.filter((item) => { const days = daysUntil(item.actualDueDate || item.expectedDueDate); return days !== null && days < 0 && item.outstandingAmount > 0; });
    const fdMargin = assignments.filter((item) => ACTIVE_ASSIGNMENT_STATUSES.includes(item.status) && (!creditIds.size || creditIds.has(item.instrumentId))).reduce((sum, item) => sum + assignmentOutstanding(item), 0);
    const openDiscrepancies = discrepancies.filter((item) => (!creditIds.size || creditIds.has(String(item.lcId))) && !['RESOLVED', 'REJECTED'].includes(String(item.status || '').toUpperCase()));
    const recoveryPending = recoveries.filter((item) => !creditIds.size || creditIds.has(String(item.lcId))).reduce((sum, item) => sum + Number(item.balanceRecoverable || Math.max(0, Number(item.recoverableAmount || 0) - Number(item.receivedAmount || 0))), 0) || active.reduce((sum, item) => sum + Number(item.balanceRecoverable || 0), 0);
    const vendorPending = active.reduce((sum, item) => sum + Math.max(0, Number(item.totalAcceptedAmount || 0) - Number(item.totalPaidAmount || 0)), 0);
    const closurePending = filteredCredits.filter((item) => item.status === 'CLOSURE_PENDING' || (item.status === 'PAID' && !item.bankClosureConfirmed));
    return { sanction, utilized, available: Math.max(0, sanction - utilized), activeExposure, pendingOpening, openedMonthCount: openedMonth.length, openedMonthAmount: openedMonth.reduce((sum, item) => sum + item.openedAmount, 0), dueToday: due(0, true), due7: due(7), due15: due(15), due30: due(30), overdue, fdMargin, cashMargin: active.reduce((sum, item) => sum + Number(item.cashMarginAmount || 0), 0), hundiAwaited: active.filter((item) => ['HUNDI_AWAITED', 'DOCUMENTS_AWAITED'].includes(item.status)), openDiscrepancies, vendorPending, recoveryPending, commissionDifference: filteredCredits.reduce((sum, item) => sum + Number(item.commissionDifference || 0), 0), closurePending, dueAmount };
  }, [active, assignments, creditIds, discrepancies, filteredCredits, filteredRequests, filters.bank, limits, monthKey, recoveries]);

  const bankChart = useMemo(() => Array.from(new Set([...limits.map((item) => item.bankId), ...filteredCredits.map((item) => item.bankId)])).map((bankId) => { const limit = limits.filter((item) => item.bankId === bankId); const lcs = filteredCredits.filter((item) => item.bankId === bankId && OPEN_STATUSES.has(item.status)); return { name: limit[0]?.bankName || lcs[0]?.bankName || 'Unassigned', limit: limit.reduce((sum, item) => sum + Number(item.sanctionedAmount || 0) + Number(item.temporaryLimit || 0), 0), utilised: lcs.reduce((sum, item) => sum + item.openedAmount, 0) }; }).filter((item) => item.limit || item.utilised).sort((a, b) => b.utilised - a.utilised), [filteredCredits, limits]);
  const projectChart = useMemo(() => Array.from(new Set(filteredCredits.map((item) => item.projectId))).map((projectId) => { const rows = filteredCredits.filter((item) => item.projectId === projectId); return { name: rows[0]?.projectName || 'Unassigned', exposure: rows.reduce((sum, item) => sum + item.openedAmount, 0), outstanding: rows.reduce((sum, item) => sum + item.outstandingAmount, 0) }; }).sort((a, b) => b.exposure - a.exposure).slice(0, 10), [filteredCredits]);
  const statusChart = useMemo(() => Array.from(new Set(filteredCredits.map((item) => item.status))).map((status) => ({ name: lcLabel(status), value: filteredCredits.filter((item) => item.status === status).length })).filter((item) => item.value), [filteredCredits]);
  const upcoming = useMemo(() => active.filter((item) => item.outstandingAmount > 0 && daysUntil(item.actualDueDate || item.expectedDueDate) !== null).sort((a, b) => Number(daysUntil(a.actualDueDate || a.expectedDueDate)) - Number(daysUntil(b.actualDueDate || b.expectedDueDate))).slice(0, 10), [active]);

  const exportDashboard = async () => {
    setExporting(true);
    try {
      const workbook = new ExcelJS.Workbook(); const summary = workbook.addWorksheet('Dashboard Summary');
      summary.columns = [{ header: 'Metric', key: 'metric', width: 34 }, { header: 'Count', key: 'count', width: 14 }, { header: 'Amount', key: 'amount', width: 20 }];
      [['Total LC sanction limit', '', metrics.sanction], ['Total LC utilised', '', metrics.utilized], ['Available LC limit', '', metrics.available], ['Active LC amount', active.length, metrics.activeExposure], ['Opened during month', metrics.openedMonthCount, metrics.openedMonthAmount], ['Due today', metrics.dueToday.length, metrics.dueAmount(metrics.dueToday)], ['Due within 7 days', metrics.due7.length, metrics.dueAmount(metrics.due7)], ['Due within 15 days', metrics.due15.length, metrics.dueAmount(metrics.due15)], ['Due within 30 days', metrics.due30.length, metrics.dueAmount(metrics.due30)], ['Overdue', metrics.overdue.length, metrics.dueAmount(metrics.overdue)], ['FD margin utilised', '', metrics.fdMargin], ['Cash margin blocked', '', metrics.cashMargin], ['Vendor settlement pending', '', metrics.vendorPending], ['Client recovery pending', '', metrics.recoveryPending]].forEach(([metric, count, amount]) => summary.addRow({ metric, count, amount }));
      const due = workbook.addWorksheet('Upcoming Payments'); due.columns = [{ header: 'LC', key: 'lc', width: 24 }, { header: 'Bank', key: 'bank', width: 22 }, { header: 'Vendor', key: 'vendor', width: 26 }, { header: 'Project', key: 'project', width: 26 }, { header: 'Due Date', key: 'due', width: 15 }, { header: 'Days', key: 'days', width: 12 }, { header: 'Outstanding', key: 'amount', width: 20 }, { header: 'Status', key: 'status', width: 22 }]; upcoming.forEach((item) => due.addRow({ lc: item.bankLcNumber, bank: item.bankName, vendor: item.vendorName, project: item.projectName, due: toLcDate(item.actualDueDate || item.expectedDueDate)?.toISOString().slice(0, 10) || '', days: daysUntil(item.actualDueDate || item.expectedDueDate), amount: item.outstandingAmount, status: lcLabel(item.status) }));
      [summary, due].forEach((sheet) => { sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }]; });
      const buffer = await workbook.xlsx.writeBuffer(); const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `lc-dashboard-${new Date().toISOString().slice(0, 10)}.xlsx`; anchor.click(); URL.revokeObjectURL(url);
    } catch { toast({ title: 'Dashboard export failed', variant: 'destructive' }); } finally { setExporting(false); }
  };

  if (authLoading || loading) return <div className="space-y-4"><Skeleton className="h-28 w-full rounded-xl" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}</div></div>;
  if (!canView) return <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view the LC dashboard.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card>;

  const option = (key: 'bankId' | 'projectId' | 'vendorId' | 'status' | 'currency', labelKey: 'bankName' | 'projectName' | 'vendorName' | 'status' | 'currency') => Array.from(new Map(credits.filter((item) => item[key]).map((item) => [String(item[key]), String(item[labelKey])])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  return <div className="space-y-5">
    <Card className="overflow-hidden border-0 bg-gradient-to-r from-slate-950 via-cyan-950 to-blue-950 text-white shadow-lg"><CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2"><Landmark className="h-6 w-6 text-cyan-300" /><h1 className="text-2xl font-bold">Letter of Credit Management</h1></div><p className="mt-1 text-sm text-cyan-100">Live exposure, limits, bills, payment obligations, collateral, settlement, and recovery.</p></div><div className="flex flex-wrap gap-2"><Button asChild variant="secondary"><Link href="/letter-of-credit/new"><FilePlus2 className="mr-2 h-4 w-4" />Create LC Request</Link></Button><Button asChild variant="secondary"><Link href="/letter-of-credit/due-calendar"><CalendarClock className="mr-2 h-4 w-4" />Payment Calendar</Link></Button>{canExport && <Button variant="secondary" onClick={() => void exportDashboard()} disabled={exporting}>{exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Export</Button>}<Button variant="secondary" size="icon" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button></div></CardContent></Card>
    <Card><CardContent className="flex flex-wrap gap-2 p-3">{([['bank', 'Bank', option('bankId', 'bankName')], ['project', 'Project', option('projectId', 'projectName')], ['vendor', 'Vendor', option('vendorId', 'vendorName')], ['status', 'Status', option('status', 'status')], ['currency', 'Currency', option('currency', 'currency')]] as const).map(([key, label, options]) => <Select key={key} value={filters[key]} onValueChange={(value) => setFilters((current) => ({ ...current, [key]: value }))}><SelectTrigger className="w-44"><SelectValue placeholder={label} /></SelectTrigger><SelectContent><SelectItem value="ALL">All {label.toLowerCase()}s</SelectItem>{options.map(([value, text]) => <SelectItem value={value} key={value}>{key === 'status' ? lcLabel(text) : text}</SelectItem>)}</SelectContent></Select>)}<Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Reset</Button></CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Total LC Sanction Limit" value={formatLcCurrency(metrics.sanction)} icon={Landmark} tone="blue" /><Metric label="Total LC Utilised" value={formatLcCurrency(metrics.utilized)} secondary={`${formatLcCurrency(metrics.pendingOpening)} approved, pending opening`} icon={WalletCards} tone="violet" /><Metric label="Available LC Limit" value={formatLcCurrency(metrics.available)} icon={CircleDollarSign} tone="emerald" /><Metric label="Active LC Amount" value={formatLcCurrency(metrics.activeExposure)} secondary={`${active.length} active LCs`} icon={Banknote} tone="cyan" /><Metric label="Opened During Month" value={formatLcCurrency(metrics.openedMonthAmount)} secondary={`${metrics.openedMonthCount} LC(s)`} icon={TrendingUp} tone="blue" /><Metric label="Payment Due Today" value={formatLcCurrency(metrics.dueAmount(metrics.dueToday))} secondary={`${metrics.dueToday.length} obligation(s)`} icon={CalendarClock} tone={metrics.dueToday.length ? 'rose' : 'emerald'} alert={Boolean(metrics.dueToday.length)} /><Metric label="Due Within 7 Days" value={formatLcCurrency(metrics.dueAmount(metrics.due7))} secondary={`${metrics.due7.length} obligation(s)`} icon={CalendarClock} tone="rose" /><Metric label="Due Within 15 Days" value={formatLcCurrency(metrics.dueAmount(metrics.due15))} secondary={`${metrics.due15.length} obligation(s)`} icon={CalendarClock} tone="amber" /><Metric label="Due Within 30 Days" value={formatLcCurrency(metrics.dueAmount(metrics.due30))} secondary={`${metrics.due30.length} obligation(s)`} icon={CalendarClock} tone="amber" /><Metric label="Overdue LC Amount" value={formatLcCurrency(metrics.dueAmount(metrics.overdue))} secondary={`${metrics.overdue.length} overdue`} icon={AlertTriangle} tone="rose" alert /><Metric label="Hundi Awaited" value={formatLcCurrency(metrics.hundiAwaited.reduce((sum, item) => sum + item.unutilizedAmount, 0))} secondary={`${metrics.hundiAwaited.length} LC(s)`} icon={FileWarning} tone="amber" /><Metric label="Discrepant Documents" value={formatLcCurrency(metrics.openDiscrepancies.reduce((sum, item) => sum + Number(item.amount || item.claimedAmount || 0), 0))} secondary={`${metrics.openDiscrepancies.length} open`} icon={AlertTriangle} tone="rose" /><Metric label="FD Margin Utilised" value={formatLcCurrency(metrics.fdMargin)} icon={Link2} tone="violet" /><Metric label="Cash Margin Blocked" value={formatLcCurrency(metrics.cashMargin)} icon={Banknote} tone="blue" /><Metric label="Vendor Settlement Pending" value={formatLcCurrency(metrics.vendorPending)} icon={WalletCards} tone="amber" /><Metric label="Client Recovery Pending" value={formatLcCurrency(metrics.recoveryPending)} icon={Undo2} tone="rose" /><Metric label="Commission Difference" value={formatLcCurrency(metrics.commissionDifference)} icon={CircleDollarSign} tone={Math.abs(metrics.commissionDifference) > 0 ? 'amber' : 'emerald'} /><Metric label="LC Closure Pending" value={formatLcCurrency(metrics.closurePending.reduce((sum, item) => sum + item.openedAmount, 0))} secondary={`${metrics.closurePending.length} LC(s)`} icon={ClipboardCheck} tone="violet" /></div>
    <div className="grid gap-4 xl:grid-cols-2"><ChartCard title="Bank-wise LC Limit & Utilisation" description="Sanctioned and temporary limit versus active exposure"><ResponsiveContainer width="100%" height={300}><BarChart data={bankChart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} tickFormatter={(value) => `${Math.round(Number(value) / 100000)}L`} /><Tooltip formatter={(value) => formatLcCurrency(Number(value))} /><Legend /><Bar dataKey="limit" fill="#2563eb" name="Limit" radius={[4, 4, 0, 0]} /><Bar dataKey="utilised" fill="#0891b2" name="Utilised" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard><ChartCard title="Project-wise LC Exposure" description="Opened amount and current payment outstanding"><ResponsiveContainer width="100%" height={300}><BarChart data={projectChart} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" fontSize={11} tickFormatter={(value) => `${Math.round(Number(value) / 100000)}L`} /><YAxis type="category" dataKey="name" width={90} fontSize={10} /><Tooltip formatter={(value) => formatLcCurrency(Number(value))} /><Legend /><Bar dataKey="exposure" fill="#7c3aed" name="Exposure" /><Bar dataKey="outstanding" fill="#dc2626" name="Outstanding" /></BarChart></ResponsiveContainer></ChartCard></div>
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]"><ChartCard title="LC Status Distribution" description="Current issued-LC operational status"><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={statusChart} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>{statusChart.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></ChartCard><Card><CardHeader><CardTitle className="text-lg">Upcoming Payment Obligations</CardTitle><CardDescription>Nearest accepted LC liabilities, including overdue items.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>LC / Vendor</TableHead><TableHead>Bank / Project</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{upcoming.map((item) => { const days = daysUntil(item.actualDueDate || item.expectedDueDate); return <TableRow key={item.id}><TableCell><Link href={`/letter-of-credit/${item.id}`} className="font-medium text-cyan-700 hover:underline">{item.bankLcNumber}</Link><p className="text-xs text-muted-foreground">{item.vendorName}</p></TableCell><TableCell>{item.bankName}<p className="text-xs text-muted-foreground">{item.projectName}</p></TableCell><TableCell>{toLcDate(item.actualDueDate || item.expectedDueDate)?.toLocaleDateString('en-IN') || '-'}<p className={cn('text-xs', Number(days) < 0 ? 'text-rose-600' : 'text-muted-foreground')}>{days === null ? '' : days < 0 ? `${Math.abs(days)} days overdue` : `${days} days`}</p></TableCell><TableCell className="text-right font-semibold">{formatLcCurrency(item.outstandingAmount, item.currency)}</TableCell><TableCell><Badge variant={Number(days) < 0 ? 'destructive' : 'outline'}>{Number(days) < 0 ? 'Overdue' : lcLabel(item.paymentStatus)}</Badge></TableCell></TableRow>; })}{!upcoming.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">No dated payment obligations.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></div>
  </div>;
}

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <Card><CardHeader><CardTitle className="text-lg">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>; }
