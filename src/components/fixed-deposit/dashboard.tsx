'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  FilePlus2,
  FileSpreadsheet,
  Landmark,
  Link2,
  Loader2,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  CLOSED_FD_STATUSES,
  FD_COLLECTIONS,
  FD_PURPOSES,
  FD_STATUSES,
  RESERVED_ASSIGNMENT_STATUSES,
  assignmentOutstanding,
  calculateEligibleValue,
  deriveOperationalStatus,
  fdStatusLabel,
  financialYearForDate,
  formatFdCurrency,
  isActiveFd,
  toDate,
  type FDAssignment,
  type FDClosure,
  type FixedDeposit,
} from '@/lib/fixed-deposit';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Option = { value: string; label: string };
type Filters = {
  organization: string[];
  bank: string[];
  holder: string[];
  financialYear: string[];
  status: string[];
  project: string[];
  linkage: string[];
  purpose: string[];
};

const EMPTY_FILTERS: Filters = {
  organization: [], bank: [], holder: [], financialYear: [], status: [], project: [], linkage: [], purpose: [],
};

const LINKAGE_OPTIONS: Option[] = [
  { value: 'UNLINKED', label: 'Unlinked' },
  { value: 'BG', label: 'Linked to BG' },
  { value: 'LC', label: 'Linked to LC' },
  { value: 'BOTH', label: 'Linked to BG and LC' },
  { value: 'RESERVED_BG', label: 'Reserved for BG' },
  { value: 'RESERVED_LC', label: 'Reserved for LC' },
];

const sum = (values: number[]) => values.reduce((total, value) => total + Number(value || 0), 0);
const isBeforeToday = (value: FixedDeposit['maturityDate'], asOn: Date) => {
  const date = toDate(value);
  if (!date) return false;
  date.setHours(0, 0, 0, 0);
  const compare = new Date(asOn);
  compare.setHours(0, 0, 0, 0);
  return date.getTime() < compare.getTime();
};
const daysFrom = (value: FixedDeposit['maturityDate'], asOn: Date) => {
  const target = toDate(value);
  if (!target) return null;
  target.setHours(0, 0, 0, 0);
  const compare = new Date(asOn);
  compare.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - compare.getTime()) / 86_400_000);
};

function MultiFilter({ label, values, options, onChange }: {
  label: string;
  values: string[];
  options: Option[];
  onChange: (values: string[]) => void;
}) {
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('h-9 justify-between bg-white/90 text-xs font-normal', values.length && 'border-cyan-300 bg-cyan-50/70 text-cyan-900')}>
          <span className="max-w-32 truncate">{values.length ? `${label} (${values.length})` : label}</span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-semibold">{label}</p>
          {values.length > 0 && <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => onChange([])}>Clear</Button>}
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {options.length ? options.map((option) => (
            <button key={option.value} type="button" onClick={() => toggle(option.value)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100">
              <Checkbox checked={values.includes(option.value)} aria-label={`Filter by ${option.label}`} />
              <span className="truncate">{option.label}</span>
            </button>
          )) : <p className="px-2 py-4 text-center text-xs text-muted-foreground">No options available</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MetricCard({ label, value, secondary, icon: Icon, tone = 'cyan', alert = false }: {
  label: string; value: string; secondary?: string; icon: LucideIcon; tone?: 'cyan' | 'blue' | 'amber' | 'emerald' | 'violet' | 'rose'; alert?: boolean;
}) {
  const styles = {
    cyan: 'from-cyan-500/15 to-sky-500/5 text-cyan-700 ring-cyan-100',
    blue: 'from-blue-500/15 to-indigo-500/5 text-blue-700 ring-blue-100',
    amber: 'from-amber-500/15 to-orange-500/5 text-amber-700 ring-amber-100',
    emerald: 'from-emerald-500/15 to-teal-500/5 text-emerald-700 ring-emerald-100',
    violet: 'from-violet-500/15 to-indigo-500/5 text-violet-700 ring-violet-100',
    rose: 'from-rose-500/15 to-red-500/5 text-rose-700 ring-rose-100',
  }[tone];
  return (
    <Card className={cn('relative overflow-hidden border-white/80 bg-gradient-to-br shadow-sm', styles)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 truncate text-xl font-bold tracking-tight text-slate-900">{value}</p>
            {secondary && <p className={cn('mt-1 text-xs text-slate-500', alert && 'font-medium text-rose-600')}>{secondary}</p>}
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm ring-1 ring-inherit"><Icon className="h-4 w-4" /></div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FixedDepositDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [deposits, setDeposits] = useState<FixedDeposit[]>([]);
  const [assignments, setAssignments] = useState<FDAssignment[]>([]);
  const [closures, setClosures] = useState<FDClosure[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [asOn, setAsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scoped = (name: string) => user?.role === 'Super Admin' || !user?.organizationId ? collection(db, name) : query(collection(db, name), where('organizationId', '==', user.organizationId));
      const [fdSnap, assignmentSnap, closureSnap] = await Promise.all([
        getDocs(scoped(FD_COLLECTIONS.deposits)),
        getDocs(scoped(FD_COLLECTIONS.assignments)),
        getDocs(scoped(FD_COLLECTIONS.closures)),
      ]);
      setDeposits(fdSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FixedDeposit)));
      setAssignments(assignmentSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FDAssignment)));
      setClosures(closureSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FDClosure)));
    } catch (error) {
      console.error('Unable to load fixed deposit dashboard', error);
      toast({ title: 'Unable to load FD dashboard', description: 'Please check your connection and permissions, then try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, user?.organizationId, user?.role]);

  useEffect(() => { void load(); }, [load]);

  const liveDeposits = useMemo(() => deposits.filter((fd) => !fd.isDeleted), [deposits]);
  const allRelevantAssignments = useMemo(() => assignments.filter((item) =>
    [...ACTIVE_ASSIGNMENT_STATUSES, ...RESERVED_ASSIGNMENT_STATUSES].includes(item.status)), [assignments]);
  const assignmentsByFd = useMemo(() => {
    const map = new Map<string, FDAssignment[]>();
    allRelevantAssignments.forEach((item) => map.set(item.fdId, [...(map.get(item.fdId) || []), item]));
    return map;
  }, [allRelevantAssignments]);

  const optionSets = useMemo(() => {
    const unique = (items: Option[]) => Array.from(new Map(items.filter((item) => item.value).map((item) => [item.value, item])).values()).sort((a, b) => a.label.localeCompare(b.label));
    const projects = allRelevantAssignments.map((item) => ({ value: item.projectId || item.projectName || '', label: item.projectName || 'Unnamed project' }));
    liveDeposits.forEach((fd) => { if (fd.projectId || fd.projectName) projects.push({ value: fd.projectId || fd.projectName || '', label: fd.projectName || 'Unnamed project' }); });
    return {
      organization: unique([
        ...liveDeposits.map((fd) => ({ value: fd.organizationId, label: fd.organizationName || fd.organizationId })),
        ...(user?.organizationId ? [{ value: user.organizationId, label: user.organizationName || user.organizationId }] : []),
      ]),
      bank: unique(liveDeposits.map((fd) => ({ value: fd.bankId || fd.bankName, label: fd.bankName }))),
      holder: unique(liveDeposits.map((fd) => ({ value: fd.holderName, label: fd.holderName }))),
      financialYear: unique(liveDeposits.map((fd) => ({ value: financialYearForDate(fd.valueDate), label: financialYearForDate(fd.valueDate) }))),
      status: FD_STATUSES.map((status) => ({ value: status, label: fdStatusLabel(status) })),
      project: unique(projects),
      linkage: LINKAGE_OPTIONS,
      purpose: FD_PURPOSES.map(([value, label]) => ({ value, label })),
    };
  }, [allRelevantAssignments, liveDeposits, user]);

  const filteredDeposits = useMemo(() => liveDeposits.filter((fd) => {
    const fdAssignments = assignmentsByFd.get(fd.id) || [];
    const active = fdAssignments.filter((item) => ACTIVE_ASSIGNMENT_STATUSES.includes(item.status));
    const reserved = fdAssignments.filter((item) => RESERVED_ASSIGNMENT_STATUSES.includes(item.status));
    const hasBg = active.some((item) => item.instrumentType === 'BG');
    const hasLc = active.some((item) => item.instrumentType === 'LC');
    const linkageMatches = !filters.linkage.length || filters.linkage.some((value) => {
      if (value === 'UNLINKED') return !active.length && !reserved.length;
      if (value === 'BG') return hasBg;
      if (value === 'LC') return hasLc;
      if (value === 'BOTH') return hasBg && hasLc;
      if (value === 'RESERVED_BG') return reserved.some((item) => item.instrumentType === 'BG');
      return value === 'RESERVED_LC' && reserved.some((item) => item.instrumentType === 'LC');
    });
    const projectMatches = !filters.project.length || fdAssignments.some((item) => filters.project.includes(item.projectId || item.projectName || '')) || filters.project.includes(fd.projectId || fd.projectName || '');
    return (
      (!filters.organization.length || filters.organization.includes(fd.organizationId)) &&
      (!filters.bank.length || filters.bank.includes(fd.bankId || fd.bankName)) &&
      (!filters.holder.length || filters.holder.includes(fd.holderName)) &&
      (!filters.financialYear.length || filters.financialYear.includes(financialYearForDate(fd.valueDate))) &&
      (!filters.status.length || filters.status.includes(deriveOperationalStatus(fd))) &&
      (!filters.purpose.length || filters.purpose.includes(fd.purpose)) &&
      projectMatches && linkageMatches
    );
  }), [assignmentsByFd, filters, liveDeposits]);

  const filteredIds = useMemo(() => new Set(filteredDeposits.map((fd) => fd.id)), [filteredDeposits]);
  const metricAssignments = useMemo(() => allRelevantAssignments.filter((item) =>
    filteredIds.has(item.fdId) && (!filters.project.length || filters.project.includes(item.projectId || item.projectName || ''))), [allRelevantAssignments, filteredIds, filters.project]);
  const asOnDate = useMemo(() => new Date(`${asOn}T12:00:00`), [asOn]);
  const activeDeposits = useMemo(() => filteredDeposits.filter((fd) => isActiveFd(fd, asOnDate)), [asOnDate, filteredDeposits]);

  const valuesByFd = useMemo(() => {
    const map = new Map<string, { active: number; bg: number; lc: number; reserved: number }>();
    metricAssignments.forEach((item) => {
      const current = map.get(item.fdId) || { active: 0, bg: 0, lc: 0, reserved: 0 };
      const amount = assignmentOutstanding(item);
      if (ACTIVE_ASSIGNMENT_STATUSES.includes(item.status)) {
        current.active += amount;
        current[item.instrumentType === 'BG' ? 'bg' : 'lc'] += amount;
      } else if (RESERVED_ASSIGNMENT_STATUSES.includes(item.status)) current.reserved += amount;
      map.set(item.fdId, current);
    });
    return map;
  }, [metricAssignments]);

  const activePrincipal = sum(activeDeposits.map((fd) => fd.principalAmount));
  const eligibleValue = sum(activeDeposits.map((fd) => Number(fd.eligibleValue || calculateEligibleValue(fd.principalAmount, fd.eligibleMarginPercentage || 100))));
  const bgUtilized = sum(activeDeposits.map((fd) => valuesByFd.get(fd.id)?.bg || 0));
  const lcUtilized = sum(activeDeposits.map((fd) => valuesByFd.get(fd.id)?.lc || 0));
  const utilized = bgUtilized + lcUtilized;
  const reserved = sum(activeDeposits.map((fd) => valuesByFd.get(fd.id)?.reserved || 0));
  const available = Math.max(0, eligibleValue - utilized - reserved);
  const utilisationPct = eligibleValue > 0 ? (utilized / eligibleValue) * 100 : 0;

  const maturityMetric = (maximumDays: number) => {
    const rows = activeDeposits.filter((fd) => { const days = daysFrom(fd.maturityDate, asOnDate); return days !== null && days >= 0 && days <= maximumDays; });
    return { count: rows.length, amount: sum(rows.map((fd) => fd.principalAmount)) };
  };
  const maturity7 = maturityMetric(7);
  const maturity30 = maturityMetric(30);
  const maturity90 = maturityMetric(90);
  const maturedNotClosed = filteredDeposits.filter((fd) => isBeforeToday(fd.maturityDate, asOnDate) && !CLOSED_FD_STATUSES.includes(fd.status));
  const closurePending = filteredDeposits.filter((fd) => fd.status === 'CLOSURE_PENDING' || String(fd.closureStatus || '').toUpperCase().includes('PENDING'));
  const expiredBgAssignments = metricAssignments.filter((item) => { const expiry = item.obligationEndDate || item.expectedReleaseDate; return item.instrumentType === 'BG' && ACTIVE_ASSIGNMENT_STATUSES.includes(item.status) && expiry && (toDate(expiry)?.getTime() || Infinity) < asOnDate.getTime(); });
  const expiredBgFdCount = new Set(expiredBgAssignments.map((item) => item.fdId)).size;

  const bankSummary = useMemo(() => {
    const rows = new Map<string, { bank: string; count: number; principal: number; eligible: number; bg: number; lc: number; reserved: number; available: number; maturing30: number }>();
    activeDeposits.forEach((fd) => {
      const key = fd.bankId || fd.bankName;
      const current = rows.get(key) || { bank: fd.bankName || 'Unknown bank', count: 0, principal: 0, eligible: 0, bg: 0, lc: 0, reserved: 0, available: 0, maturing30: 0 };
      const eligible = Number(fd.eligibleValue || calculateEligibleValue(fd.principalAmount, fd.eligibleMarginPercentage || 100));
      const assigned = valuesByFd.get(fd.id) || { active: 0, bg: 0, lc: 0, reserved: 0 };
      current.count += 1; current.principal += fd.principalAmount; current.eligible += eligible; current.bg += assigned.bg; current.lc += assigned.lc; current.reserved += assigned.reserved; current.available += Math.max(0, eligible - assigned.active - assigned.reserved);
      const days = daysFrom(fd.maturityDate, asOnDate); if (days !== null && days >= 0 && days <= 30) current.maturing30 += 1;
      rows.set(key, current);
    });
    return Array.from(rows.values()).sort((a, b) => b.principal - a.principal);
  }, [activeDeposits, asOnDate, valuesByFd]);

  const maturityMonths = useMemo(() => {
    const rows = new Map<string, { month: string; count: number; amount: number }>();
    activeDeposits.forEach((fd) => {
      const date = toDate(fd.maturityDate); if (!date) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const current = rows.get(key) || { month: date.toLocaleString('en-IN', { month: 'short', year: 'numeric' }), count: 0, amount: 0 };
      current.count += 1; current.amount += fd.principalAmount; rows.set(key, current);
    });
    return Array.from(rows.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  }, [activeDeposits]);

  const groupedSummary = useCallback((key: 'holderName' | 'purpose') => {
    const rows = new Map<string, { label: string; count: number; principal: number; eligible: number; bg: number; lc: number; reserved: number; available: number }>();
    activeDeposits.forEach((fd) => {
      const label = key === 'purpose' ? (FD_PURPOSES.find(([value]) => value === fd.purpose)?.[1] || fd.purpose || 'Unspecified') : fd.holderName || 'Unspecified';
      const current = rows.get(label) || { label, count: 0, principal: 0, eligible: 0, bg: 0, lc: 0, reserved: 0, available: 0 };
      const eligible = Number(fd.eligibleValue || calculateEligibleValue(fd.principalAmount, fd.eligibleMarginPercentage || 100));
      const assigned = valuesByFd.get(fd.id) || { active: 0, bg: 0, lc: 0, reserved: 0 };
      current.count += 1; current.principal += fd.principalAmount; current.eligible += eligible; current.bg += assigned.bg; current.lc += assigned.lc; current.reserved += assigned.reserved; current.available += Math.max(0, eligible - assigned.active - assigned.reserved);
      rows.set(label, current);
    });
    return Array.from(rows.values()).sort((a, b) => b.principal - a.principal);
  }, [activeDeposits, valuesByFd]);
  const holderSummary = useMemo(() => groupedSummary('holderName'), [groupedSummary]);
  const purposeSummary = useMemo(() => groupedSummary('purpose'), [groupedSummary]);

  const ageing = useMemo(() => {
    const buckets = [
      { label: '0–7 days', test: (days: number) => days >= 0 && days <= 7 },
      { label: '8–30 days', test: (days: number) => days >= 8 && days <= 30 },
      { label: '31–90 days', test: (days: number) => days >= 31 && days <= 90 },
      { label: '91–180 days', test: (days: number) => days >= 91 && days <= 180 },
      { label: 'More than 180 days', test: (days: number) => days > 180 },
      { label: 'Already matured', test: (days: number) => days < 0 },
    ];
    return buckets.map((bucket) => {
      const rows = filteredDeposits.filter((fd) => { const days = daysFrom(fd.maturityDate, asOnDate); return days !== null && bucket.test(days) && (bucket.label === 'Already matured' ? !CLOSED_FD_STATUSES.includes(fd.status) : isActiveFd(fd, asOnDate)); });
      return { label: bucket.label, count: rows.length, amount: sum(rows.map((fd) => fd.principalAmount)) };
    });
  }, [asOnDate, filteredDeposits]);

  const interestReceived = useMemo(() => {
    const closureInterest = new Map(closures.filter((item) => filteredIds.has(item.fdId)).map((item) => [item.fdId, Number(item.actualInterest || 0)]));
    return sum(filteredDeposits.map((fd) => Number(fd.interestReceived || closureInterest.get(fd.id) || 0)));
  }, [closures, filteredDeposits, filteredIds]);
  const expectedInterest = sum(filteredDeposits.map((fd) => Number(fd.expectedInterest || 0)));

  const updateFilter = (key: keyof Filters, values: string[]) => setFilters((current) => ({ ...current, [key]: values }));
  const hasFilters = Object.values(filters).some((values) => values.length > 0);

  const triggerDownload = (blob: Blob, name: string) => {
    const href = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = href; anchor.download = name; anchor.click(); URL.revokeObjectURL(href);
  };

  const exportWorkbook = async (bankOnly = false) => {
    setExporting(true);
    try {
      const workbook = new ExcelJS.Workbook(); workbook.creator = user?.name || 'SEL Live'; workbook.created = new Date();
      const bankSheet = workbook.addWorksheet('Bank-wise Summary');
      bankSheet.columns = [
        { header: 'Bank', key: 'bank', width: 28 }, { header: 'FD Count', key: 'count', width: 12 }, { header: 'Active Principal', key: 'principal', width: 18 },
        { header: 'Eligible Value', key: 'eligible', width: 18 }, { header: 'BG Utilised', key: 'bg', width: 16 }, { header: 'LC Utilised', key: 'lc', width: 16 },
        { header: 'Reserved', key: 'reserved', width: 16 }, { header: 'Available', key: 'available', width: 16 }, { header: 'Maturing in 30 Days', key: 'maturing30', width: 20 },
      ];
      bankSummary.forEach((row) => bankSheet.addRow(row));
      bankSheet.getRow(1).font = { bold: true }; bankSheet.views = [{ state: 'frozen', ySplit: 1 }];
      ['principal', 'eligible', 'bg', 'lc', 'reserved', 'available'].forEach((key) => { const column = bankSheet.getColumn(key); column.numFmt = '₹#,##0.00'; });
      if (!bankOnly) {
        const kpi = workbook.addWorksheet('Dashboard KPIs');
        kpi.columns = [{ header: 'Metric', key: 'metric', width: 34 }, { header: 'Count', key: 'count', width: 14 }, { header: 'Amount', key: 'amount', width: 20 }];
        [
          ['Active FD Principal', activeDeposits.length, activePrincipal], ['Total Utilised FD', new Set(metricAssignments.filter((a) => ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)).map((a) => a.fdId)).size, utilized],
          ['FD Utilised Against BG', new Set(metricAssignments.filter((a) => a.instrumentType === 'BG' && ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)).map((a) => a.fdId)).size, bgUtilized],
          ['FD Utilised Against LC', new Set(metricAssignments.filter((a) => a.instrumentType === 'LC' && ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)).map((a) => a.fdId)).size, lcUtilized],
          ['Available FD Balance', activeDeposits.filter((fd) => (valuesByFd.get(fd.id)?.active || 0) < Number(fd.eligibleValue || fd.principalAmount)).length, available],
          ['Maturing Within 7 Days', maturity7.count, maturity7.amount], ['Maturing Within 30 Days', maturity30.count, maturity30.amount], ['Maturing Within 90 Days', maturity90.count, maturity90.amount],
          ['Matured but Not Closed', maturedNotClosed.length, sum(maturedNotClosed.map((fd) => fd.principalAmount))], ['Closure Pending', closurePending.length, sum(closurePending.map((fd) => fd.principalAmount))],
          ['FD Linked to Expired BG', expiredBgFdCount, sum(expiredBgAssignments.map(assignmentOutstanding))],
        ].forEach(([metric, count, amount]) => kpi.addRow({ metric, count, amount }));
        kpi.getRow(1).font = { bold: true }; kpi.getColumn('amount').numFmt = '₹#,##0.00';
        const register = workbook.addWorksheet('Filtered FD Register');
        register.columns = [{ header: 'Reference', key: 'referenceNumber', width: 24 }, { header: 'FD Number', key: 'fdNumber', width: 22 }, { header: 'Organization', key: 'organizationName', width: 24 }, { header: 'Bank', key: 'bankName', width: 24 }, { header: 'Holder', key: 'holderName', width: 24 }, { header: 'Status', key: 'status', width: 20 }, { header: 'Principal', key: 'principalAmount', width: 18 }, { header: 'Maturity Date', key: 'maturityDate', width: 16 }];
        filteredDeposits.forEach((fd) => register.addRow({ ...fd, status: fdStatusLabel(deriveOperationalStatus(fd)), maturityDate: toDate(fd.maturityDate)?.toISOString().slice(0, 10) || '' }));
        register.getRow(1).font = { bold: true }; register.getColumn('principalAmount').numFmt = '₹#,##0.00';
        const notes = workbook.addWorksheet('Export Context');
        notes.addRows([['As-on date', asOn], ['Generated at', new Date().toLocaleString('en-IN')], ['Generated by', user?.name || ''], ['Applied filters', hasFilters ? JSON.stringify(filters) : 'All']]);
      }
      const buffer = await workbook.xlsx.writeBuffer();
      triggerDownload(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${bankOnly ? 'bank-wise-fd-summary' : 'fd-dashboard'}-${asOn}.xlsx`);
      toast({ title: bankOnly ? 'Bank-wise summary downloaded' : 'Dashboard exported', description: 'The Excel workbook includes the current filters and as-on date.' });
    } catch (error) {
      console.error('FD export failed', error); toast({ title: 'Export failed', description: 'The workbook could not be generated.', variant: 'destructive' });
    } finally { setExporting(false); }
  };

  const summaryTable = (rows: ReturnType<typeof groupedSummary>, firstHeader: string) => (
    <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{firstHeader}</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">Principal</TableHead><TableHead className="text-right">Eligible</TableHead><TableHead className="text-right">BG / LC</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Available</TableHead></TableRow></TableHeader><TableBody>
      {rows.map((row) => <TableRow key={row.label}><TableCell className="font-medium">{row.label}</TableCell><TableCell className="text-right">{row.count}</TableCell><TableCell className="text-right">{formatFdCurrency(row.principal)}</TableCell><TableCell className="text-right">{formatFdCurrency(row.eligible)}</TableCell><TableCell className="text-right">{formatFdCurrency(row.bg)} / {formatFdCurrency(row.lc)}</TableCell><TableCell className="text-right">{formatFdCurrency(row.reserved)}</TableCell><TableCell className="text-right font-semibold text-emerald-700">{formatFdCurrency(row.available)}</TableCell></TableRow>)}
      {!rows.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No data for the selected filters.</TableCell></TableRow>}
    </TableBody></Table></div>
  );

  if (loading) return <div className="space-y-4"><Skeleton className="h-36 w-full rounded-2xl" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}</div></div>;

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-slate-950 via-cyan-950 to-blue-900 text-white shadow-xl">
        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
        <CardContent className="relative p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
            <div><div className="mb-2 flex items-center gap-2"><Badge className="border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/10">Treasury Control</Badge><span className="text-xs text-cyan-100/70">As on {new Date(`${asOn}T12:00:00`).toLocaleDateString('en-IN')}</span></div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Fixed Deposit Management</h1><p className="mt-1 max-w-2xl text-sm text-cyan-100/75">Monitor principal, BG/LC utilisation, availability, maturity exposure, and interest realisation.</p></div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"><Link href="/fixed-deposit/new"><FilePlus2 className="mr-2 h-4 w-4" />Create New FD</Link></Button>
              <Button asChild size="sm" variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"><Link href="/fixed-deposit/register">View FD Register<ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/80 bg-white/85 shadow-sm backdrop-blur">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><SearchCheck className="h-4 w-4 text-cyan-600" />Filters</div>
            {(Object.keys(EMPTY_FILTERS) as Array<keyof Filters>).map((key) => <MultiFilter key={key} label={({ organization: 'Organization', bank: 'Bank', holder: 'FD Holder', financialYear: 'Financial Year', status: 'Status', project: 'Project', linkage: 'Instrument Linkage', purpose: 'FD Purpose' } as Record<keyof Filters, string>)[key]} values={filters[key]} options={optionSets[key]} onChange={(values) => updateFilter(key, values)} />)}
            <div className="flex items-center gap-2 rounded-md border bg-white px-2"><span className="text-[11px] text-muted-foreground">As on</span><Input type="date" value={asOn} onChange={(event) => setAsOn(event.target.value)} className="h-8 w-32 border-0 p-0 text-xs shadow-none focus-visible:ring-0" /></div>
            {hasFilters && <Button variant="ghost" size="sm" className="h-9 text-xs text-rose-600" onClick={() => setFilters(EMPTY_FILTERS)}><X className="mr-1 h-3.5 w-3.5" />Reset</Button>}
            <Button variant="ghost" size="icon" className="ml-auto h-9 w-9" onClick={() => void load()} aria-label="Refresh dashboard"><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active FD Principal" value={formatFdCurrency(activePrincipal)} secondary={`${activeDeposits.length} active FD${activeDeposits.length === 1 ? '' : 's'}`} icon={Banknote} />
        <MetricCard label="Total Utilised FD" value={formatFdCurrency(utilized)} secondary={`${utilisationPct.toFixed(1)}% of eligible value`} icon={Link2} tone="blue" />
        <MetricCard label="FD Utilised Against BG" value={formatFdCurrency(bgUtilized)} secondary={`${new Set(metricAssignments.filter((a) => a.instrumentType === 'BG' && ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)).map((a) => a.fdId)).size} linked FDs`} icon={ShieldCheck} tone="violet" />
        <MetricCard label="FD Utilised Against LC" value={formatFdCurrency(lcUtilized)} secondary={`${new Set(metricAssignments.filter((a) => a.instrumentType === 'LC' && ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)).map((a) => a.fdId)).size} linked FDs`} icon={Landmark} tone="blue" />
        <MetricCard label="Available FD Balance" value={formatFdCurrency(available)} secondary={`${formatFdCurrency(eligibleValue)} eligible − utilised − reserved`} icon={WalletCards} tone="emerald" />
        <MetricCard label="Maturing Within 7 Days" value={formatFdCurrency(maturity7.amount)} secondary={`${maturity7.count} FD${maturity7.count === 1 ? '' : 's'}`} icon={Clock3} tone="rose" alert={maturity7.count > 0} />
        <MetricCard label="Maturing Within 30 Days" value={formatFdCurrency(maturity30.amount)} secondary={`${maturity30.count} FDs`} icon={CalendarClock} tone="amber" />
        <MetricCard label="Maturing Within 90 Days" value={formatFdCurrency(maturity90.amount)} secondary={`${maturity90.count} FDs`} icon={CalendarClock} tone="amber" />
        <MetricCard label="Matured but Not Closed" value={formatFdCurrency(sum(maturedNotClosed.map((fd) => fd.principalAmount)))} secondary={`${maturedNotClosed.length} FDs`} icon={AlertTriangle} tone="rose" alert={maturedNotClosed.length > 0} />
        <MetricCard label="Closure Pending" value={formatFdCurrency(sum(closurePending.map((fd) => fd.principalAmount)))} secondary={`${closurePending.length} FDs`} icon={Clock3} tone="amber" />
        <MetricCard label="FD Linked to Expired BG" value={formatFdCurrency(sum(expiredBgAssignments.map(assignmentOutstanding)))} secondary={`${expiredBgFdCount} FDs`} icon={AlertTriangle} tone="rose" alert={expiredBgFdCount > 0} />
        <MetricCard label="Reserved Assignments" value={formatFdCurrency(reserved)} secondary="Approved or blocked, not yet active" icon={CircleDollarSign} tone="violet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader className="flex flex-row items-start justify-between"><div><CardTitle className="text-lg">Available versus Utilised FD</CardTitle><CardDescription>Eligible value allocation across the active portfolio.</CardDescription></div><Badge variant="outline">{utilisationPct.toFixed(1)}% utilised</Badge></CardHeader><CardContent className="space-y-4">
          {[{ label: 'Utilised', value: utilized, color: 'bg-blue-500' }, { label: 'Reserved', value: reserved, color: 'bg-violet-500' }, { label: 'Available', value: available, color: 'bg-emerald-500' }].map((item) => { const pct = eligibleValue ? Math.min(100, (item.value / eligibleValue) * 100) : 0; return <div key={item.label}><div className="mb-1 flex justify-between text-sm"><span className="font-medium">{item.label}</span><span>{formatFdCurrency(item.value)} · {pct.toFixed(1)}%</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', item.color)} style={{ width: `${pct}%` }} /></div></div>; })}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-lg">Interest Realisation</CardTitle><CardDescription>Expected versus received.</CardDescription></CardHeader><CardContent><div className="space-y-4"><div><p className="text-xs text-muted-foreground">Expected Interest</p><p className="text-2xl font-bold">{formatFdCurrency(expectedInterest)}</p></div><div><p className="text-xs text-muted-foreground">Interest Received</p><p className="text-2xl font-bold text-emerald-700">{formatFdCurrency(interestReceived)}</p></div><div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-amber-700">Pending Interest</p><p className="font-semibold text-amber-900">{formatFdCurrency(Math.max(0, expectedInterest - interestReceived))}</p></div></div></CardContent></Card>
      </div>

      <Tabs defaultValue="bank" className="space-y-3">
        <TabsList className="h-auto flex-wrap justify-start bg-white/80 p-1"><TabsTrigger value="bank">Bank-wise</TabsTrigger><TabsTrigger value="holder">Holder-wise</TabsTrigger><TabsTrigger value="purpose">Purpose-wise</TabsTrigger><TabsTrigger value="maturity">Maturity Month-wise</TabsTrigger><TabsTrigger value="ageing">Maturity Ageing</TabsTrigger></TabsList>
        <TabsContent value="bank"><Card><CardHeader><CardTitle className="text-lg">Bank-wise FD Principal and Utilisation</CardTitle><CardDescription>Active holdings and BG/LC allocation by issuing bank.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Bank</TableHead><TableHead className="text-right">FDs</TableHead><TableHead className="text-right">Principal</TableHead><TableHead className="text-right">BG Utilised</TableHead><TableHead className="text-right">LC Utilised</TableHead><TableHead className="text-right">Available</TableHead><TableHead className="text-right">Maturing ≤30d</TableHead></TableRow></TableHeader><TableBody>{bankSummary.map((row) => <TableRow key={row.bank}><TableCell className="font-medium">{row.bank}</TableCell><TableCell className="text-right">{row.count}</TableCell><TableCell className="text-right">{formatFdCurrency(row.principal)}</TableCell><TableCell className="text-right">{formatFdCurrency(row.bg)}</TableCell><TableCell className="text-right">{formatFdCurrency(row.lc)}</TableCell><TableCell className="text-right font-semibold text-emerald-700">{formatFdCurrency(row.available)}</TableCell><TableCell className="text-right">{row.maturing30}</TableCell></TableRow>)}{!bankSummary.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No active FDs found.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent>
        <TabsContent value="holder"><Card><CardHeader><CardTitle className="text-lg">FD Holder-wise Summary</CardTitle></CardHeader><CardContent className="p-0">{summaryTable(holderSummary, 'FD Holder')}</CardContent></Card></TabsContent>
        <TabsContent value="purpose"><Card><CardHeader><CardTitle className="text-lg">FD Purpose-wise Summary</CardTitle></CardHeader><CardContent className="p-0">{summaryTable(purposeSummary, 'FD Purpose')}</CardContent></Card></TabsContent>
        <TabsContent value="maturity"><Card><CardHeader><CardTitle className="text-lg">FD Maturity Month-wise</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">FD Count</TableHead><TableHead className="text-right">Principal Amount</TableHead></TableRow></TableHeader><TableBody>{maturityMonths.map((row) => <TableRow key={row.month}><TableCell className="font-medium">{row.month}</TableCell><TableCell className="text-right">{row.count}</TableCell><TableCell className="text-right">{formatFdCurrency(row.amount)}</TableCell></TableRow>)}{!maturityMonths.length && <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">No upcoming maturities.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>
        <TabsContent value="ageing"><Card><CardHeader><CardTitle className="text-lg">FD Maturity Ageing</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Ageing Bucket</TableHead><TableHead className="text-right">FD Count</TableHead><TableHead className="text-right">Principal Amount</TableHead></TableRow></TableHeader><TableBody>{ageing.map((row) => <TableRow key={row.label}><TableCell className="font-medium">{row.label}</TableCell><TableCell className="text-right">{row.count}</TableCell><TableCell className="text-right">{formatFdCurrency(row.amount)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>
      </Tabs>

      <Card><CardHeader><CardTitle className="text-lg">Dashboard Actions</CardTitle><CardDescription>Work with the current FD portfolio.</CardDescription></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Button asChild variant="outline" className="justify-start"><Link href="/fixed-deposit/new"><FilePlus2 className="mr-2 h-4 w-4 text-cyan-600" />Create New FD</Link></Button>
        <Button asChild variant="outline" className="justify-start"><Link href="/fixed-deposit/register"><FileSpreadsheet className="mr-2 h-4 w-4 text-blue-600" />View FD Register</Link></Button>
        <Button asChild variant="outline" className="justify-start"><Link href="/fixed-deposit/maturity-calendar"><CalendarClock className="mr-2 h-4 w-4 text-amber-600" />View Maturity Calendar</Link></Button>
        <Button asChild variant="outline" className="justify-start"><Link href="/fixed-deposit/available"><Check className="mr-2 h-4 w-4 text-emerald-600" />View Available FDs</Link></Button>
        <Button asChild variant="outline" className="justify-start"><Link href="/fixed-deposit/approvals"><Clock3 className="mr-2 h-4 w-4 text-violet-600" />View Pending Approvals</Link></Button>
        <Button variant="outline" className="justify-start" disabled={exporting} onClick={() => void exportWorkbook(false)}>{exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4 text-cyan-600" />}Export Dashboard</Button>
        <Button variant="outline" className="justify-start" disabled={exporting} onClick={() => void exportWorkbook(true)}><Building2 className="mr-2 h-4 w-4 text-blue-600" />Download Bank-wise Summary</Button>
        <Button variant="outline" className="justify-start" onClick={() => window.print()}><Download className="mr-2 h-4 w-4 text-slate-600" />Print / Save PDF</Button>
      </CardContent></Card>
    </div>
  );
}
