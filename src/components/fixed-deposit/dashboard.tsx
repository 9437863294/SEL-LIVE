'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  ArrowUpRight,
  BadgeIndianRupee,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  Download,
  Filter,
  Folder,
  Landmark,
  LayoutDashboard,
  Loader2,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  Shield,
  ShieldCheck,
  SquareCheck,
  Target,
  TriangleAlert,
  UserRound,
  Wallet,
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
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import styles from './dashboard.module.css';

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

// ─── Colour tones ────────────────────────────────────────────────────────────────────────────
// [light, deep] gradient pairs. The tint (10%) and border (25%) are 8-digit hex, never color-mix()
// — Chrome 109 on the office's Windows 7 PCs drops it (see dashboard.module.css).
const TONES = {
  violet: ['#c4b5fd', '#7c3aed'],
  blue: ['#93c5fd', '#2563eb'],
  cyan: ['#67e8f9', '#0891b2'],
  emerald: ['#6ee7b7', '#059669'],
  green: ['#86efac', '#16a34a'],
  amber: ['#fcd34d', '#d97706'],
  orange: ['#fdba74', '#ea580c'],
  rose: ['#fda4af', '#e11d48'],
  pink: ['#f9a8d4', '#db2777'],
  indigo: ['#a5b4fc', '#4f46e5'],
  purple: ['#d8b4fe', '#9333ea'],
  // The BG / LC tiles carry white text across the whole gradient, so they start deeper.
  bg: ['#8b5cf6', '#5b21b6'],
  lc: ['#0ea5e9', '#075985'],
} as const;
type Tone = keyof typeof TONES;

const toneStyle = (name: Tone): CSSProperties => {
  const [a, b] = TONES[name];
  return { '--a': a, '--b': b, '--t': `${b}1a`, '--tb': `${b}40` } as CSSProperties;
};

const FILTERS: Array<{ id: keyof Filters; label: string; icon: LucideIcon; tone: Tone }> = [
  { id: 'organization', label: 'Organization', icon: LayoutDashboard, tone: 'violet' },
  { id: 'bank', label: 'Bank', icon: Landmark, tone: 'blue' },
  { id: 'holder', label: 'FD Holder', icon: UserRound, tone: 'pink' },
  { id: 'financialYear', label: 'Financial Year', icon: CalendarDays, tone: 'cyan' },
  { id: 'status', label: 'Status', icon: CircleCheck, tone: 'emerald' },
  { id: 'project', label: 'Project', icon: Folder, tone: 'orange' },
  { id: 'linkage', label: 'Instrument Linkage', icon: ShieldCheck, tone: 'indigo' },
  { id: 'purpose', label: 'FD Purpose', icon: Target, tone: 'amber' },
];

const QUICK_LINKS: Array<{ href: string; label: string; icon: LucideIcon; tone: Tone }> = [
  { href: '/fixed-deposit/maturity-calendar', label: 'Maturity Calendar', icon: CalendarDays, tone: 'orange' },
  { href: '/fixed-deposit/assignments', label: 'BG / LC Assignments', icon: ShieldCheck, tone: 'indigo' },
  { href: '/fixed-deposit/approvals', label: 'Pending Approvals', icon: SquareCheck, tone: 'purple' },
  { href: '/fixed-deposit/import', label: 'Import & Reconcile', icon: Download, tone: 'green' },
];

const AGEING_TONES: Record<string, Tone> = {
  '0–7 days': 'rose',
  '8–30 days': 'amber',
  '31–90 days': 'orange',
  '91–180 days': 'cyan',
  'More than 180 days': 'blue',
  'Already matured': 'purple',
};

const sum = (values: number[]) => values.reduce((total, value) => total + Number(value || 0), 0);
const percent = (value: number) => `${value.toFixed(1)}%`;
const fdCount = (count: number) => `${count} FD${count === 1 ? '' : 's'}`;
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

// ─── Pieces ──────────────────────────────────────────────────────────────────────────────────

function FilterChip({ label, icon: Icon, tone, values, options, onChange }: {
  label: string;
  icon: LucideIcon;
  tone: Tone;
  values: string[];
  options: Option[];
  onChange: (values: string[]) => void;
}) {
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const count = values.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(styles.chip, count > 0 && styles.chipSet)}
          style={toneStyle(tone)}
          title={label}
          aria-label={count ? `${label}, ${count} selected` : label}
        >
          <span className={styles.chipIcon} aria-hidden><Icon strokeWidth={2.5} /></span>
          <span className={styles.chipText}>{label}</span>
          {count > 0 && <span className={styles.chipCount}>{count}</span>}
          <ChevronDown className={styles.chipCaret} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-semibold">{label}</p>
          {count > 0 && <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => onChange([])}>Clear</Button>}
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {options.length ? options.map((option) => (
            <label key={option.value} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted">
              <Checkbox checked={values.includes(option.value)} onCheckedChange={() => toggle(option.value)} />
              <span className="truncate">{option.label}</span>
            </label>
          )) : <p className="px-2 py-4 text-center text-xs text-muted-foreground">No options available</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CardHead({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children?: ReactNode }) {
  return (
    <header className={styles.cardHead}>
      <span className={styles.headIcon} aria-hidden><Icon /></span>
      <div className="min-w-0">
        <h2 className={styles.cardTitle}>{title}</h2>
        <span className={styles.cardSub}>{description}</span>
      </div>
      <span className={styles.spacer} />
      {children}
    </header>
  );
}

/** A tinted figure tile. `op` is the operator it shows when the FD-position equation folds. */
function Figure({ tone, label, value, note, op }: { tone: Tone; label: string; value: string; note?: string; op?: string }) {
  return (
    <div className={styles.cell} style={toneStyle(tone)}>
      {op && <span className={styles.opBadge} aria-hidden>{op}</span>}
      <span className={styles.cellLabel}><i aria-hidden />{label}</span>
      <b className={cn(styles.cellValue, styles.num)}>{value}</b>
      {note && <span className={styles.cellNote}>{note}</span>}
    </div>
  );
}

function Operator({ symbol }: { symbol: string }) {
  return <div className={styles.op} aria-hidden><span>{symbol}</span></div>;
}

function InstrumentTile({ tone, icon: Icon, label, value, linked, share }: { tone: Tone; icon: LucideIcon; label: string; value: number; linked: number; share: number }) {
  return (
    <div className={styles.instrument} style={toneStyle(tone)}>
      <span className={styles.instrumentIcon} aria-hidden><Icon /></span>
      <div className="min-w-0">
        <span className={styles.instrumentLabel}>{label}</span>
        <b className={cn(styles.instrumentValue, styles.num)}>{formatFdCurrency(value)}</b>
        <span className={styles.instrumentNote}>{linked} linked FD{linked === 1 ? '' : 's'}</span>
      </div>
      <span className={styles.spacer} />
      <span className={styles.instrumentPct} title="Share of eligible value">{percent(share)}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3.5" aria-busy>
      <Skeleton className="h-[104px] w-full rounded-[24px]" />
      <Skeleton className="h-14 w-full rounded-[18px]" />
      <div className="grid gap-3.5 lg:grid-cols-[1.75fr_1fr]">
        <Skeleton className="h-[420px] rounded-[22px]" />
        <Skeleton className="h-[300px] rounded-[22px]" />
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────────────────────

export default function FixedDepositDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const gaugeId = `fd-gauge-${useId().replace(/[^\w-]/g, '')}`;
  const [deposits, setDeposits] = useState<FixedDeposit[]>([]);
  const [assignments, setAssignments] = useState<FDAssignment[]>([]);
  const [closures, setClosures] = useState<FDClosure[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [asOn, setAsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  // The first load shows the skeleton; a refresh (see the Refresh button) keeps the figures on
  // screen and spins the button. Nothing is set before the first await, so the mount effect never
  // sets state synchronously.
  const organizationId = user?.organizationId;
  const role = user?.role;
  const load = useCallback(async () => {
    try {
      const scoped = (name: string) => role === 'Super Admin' || !organizationId ? collection(db, name) : query(collection(db, name), where('organizationId', '==', organizationId));
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
      setRefreshing(false);
      setLoaded(true);
    }
  }, [organizationId, role, toast]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from Firestore on open; state is only set after the await
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
  const shareOfEligible = (value: number) => (eligibleValue > 0 ? (value / eligibleValue) * 100 : 0);

  /** FDs carrying an active assignment, of one instrument type or either. */
  const linkedFdCount = (type?: 'BG' | 'LC') => new Set(metricAssignments
    .filter((a) => ACTIVE_ASSIGNMENT_STATUSES.includes(a.status) && (!type || a.instrumentType === type))
    .map((a) => a.fdId)).size;
  const utilisedFdCount = linkedFdCount();
  const bgLinkedFdCount = linkedFdCount('BG');
  const lcLinkedFdCount = linkedFdCount('LC');

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

  const attention: Array<{ title: string; amount: number; count: number; icon: LucideIcon; tone: Tone; href: string }> = [
    { title: 'Matured but not closed', amount: sum(maturedNotClosed.map((fd) => fd.principalAmount)), count: maturedNotClosed.length, icon: CalendarDays, tone: 'orange', href: '/fixed-deposit/closures' },
    { title: 'Closure pending', amount: sum(closurePending.map((fd) => fd.principalAmount)), count: closurePending.length, icon: Lock, tone: 'rose', href: '/fixed-deposit/closures' },
    { title: 'FD linked to expired BG', amount: sum(expiredBgAssignments.map(assignmentOutstanding)), count: expiredBgFdCount, icon: Shield, tone: 'indigo', href: '/fixed-deposit/releases' },
  ];
  const openAttention = attention.filter((item) => item.count > 0).length;

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
  const largestAgeingAmount = Math.max(0, ...ageing.map((row) => row.amount));

  const interestReceived = useMemo(() => {
    const closureInterest = new Map(closures.filter((item) => filteredIds.has(item.fdId)).map((item) => [item.fdId, Number(item.actualInterest || 0)]));
    return sum(filteredDeposits.map((fd) => Number(fd.interestReceived || closureInterest.get(fd.id) || 0)));
  }, [closures, filteredDeposits, filteredIds]);
  const expectedInterest = sum(filteredDeposits.map((fd) => Number(fd.expectedInterest || 0)));
  const pendingInterest = Math.max(0, expectedInterest - interestReceived);
  const realisedPct = expectedInterest > 0 ? Math.min(100, (interestReceived / expectedInterest) * 100) : 0;

  const updateFilter = (key: keyof Filters, values: string[]) => setFilters((current) => ({ ...current, [key]: values }));
  const activeFilterCount = Object.values(filters).filter((values) => values.length > 0).length;
  const hasFilters = activeFilterCount > 0;

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
          ['Active FD Principal', activeDeposits.length, activePrincipal], ['Total Utilised FD', utilisedFdCount, utilized],
          ['FD Utilised Against BG', bgLinkedFdCount, bgUtilized],
          ['FD Utilised Against LC', lcLinkedFdCount, lcUtilized],
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
    <Table><TableHeader><TableRow><TableHead>{firstHeader}</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">Principal</TableHead><TableHead className="text-right">Eligible</TableHead><TableHead className="text-right">BG / LC</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Available</TableHead></TableRow></TableHeader><TableBody>
      {rows.map((row) => <TableRow key={row.label}><TableCell className="font-medium">{row.label}</TableCell><TableCell className="text-right tabular-nums">{row.count}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{formatFdCurrency(row.principal)}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{formatFdCurrency(row.eligible)}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{formatFdCurrency(row.bg)} / {formatFdCurrency(row.lc)}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{formatFdCurrency(row.reserved)}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-700">{formatFdCurrency(row.available)}</TableCell></TableRow>)}
      {!rows.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No data for the selected filters.</TableCell></TableRow>}
    </TableBody></Table>
  );

  if (!loaded) return <DashboardSkeleton />;

  return (
    <>
      <div className={styles.backdrop} aria-hidden />
      <div className={styles.page}>
        {/* ── Banner ── */}
        <section className={styles.hero}>
          <div className={styles.heroRow}>
            <div>
              <p className={styles.eyebrow}>Treasury Control</p>
              <h1 className={styles.heroTitle}>Fixed Deposit Management</h1>
              <p className={styles.heroText}>Monitor principal, BG/LC utilisation, availability, maturity exposure, and interest realisation.</p>
            </div>
            <span className={styles.spacer} />
            <label className={styles.asOn}>
              <span className={styles.asOnLabel} aria-hidden>AS<br />ON</span>
              <input
                type="date"
                className={styles.asOnInput}
                value={asOn}
                aria-label="As-on date"
                // An emptied date box would make every figure "Invalid Date"; keep the last date.
                onChange={(event) => { if (event.target.value) setAsOn(event.target.value); }}
              />
            </label>
            <Link href="/fixed-deposit/register" className={styles.heroBtn}>View FD Register<ArrowUpRight aria-hidden /></Link>
            <Link href="/fixed-deposit/new" className={cn(styles.heroBtn, styles.heroBtnPrimary)}><Plus aria-hidden />Create New FD</Link>
          </div>
        </section>

        {/* ── Filters ── */}
        <section className={styles.filters} aria-label="Dashboard filters">
          <span className={styles.filterLabel}><Filter aria-hidden />FILTER</span>
          {FILTERS.map((filter) => (
            <FilterChip
              key={filter.id}
              label={filter.label}
              icon={filter.icon}
              tone={filter.tone}
              values={filters[filter.id]}
              options={optionSets[filter.id]}
              onChange={(values) => updateFilter(filter.id, values)}
            />
          ))}
          <span className={styles.spacer} />
          <button type="button" className={styles.reset} disabled={!hasFilters} onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset{hasFilters ? ` (${activeFilterCount})` : ''}
          </button>
          <button type="button" className={cn(styles.btn, refreshing && styles.spinning)} disabled={refreshing} onClick={() => { setRefreshing(true); void load(); }}>
            <RefreshCw aria-hidden />Refresh
          </button>
        </section>

        <div className={styles.row}>
          {/* ── FD position ── */}
          <section className={styles.card} style={toneStyle('violet')}>
            <CardHead icon={Wallet} title="FD position" description="Eligible value allocation across the active portfolio.">
              <span className={cn(styles.pill, styles.pillViolet)}>{percent(utilisationPct)} utilised</span>
            </CardHead>
            <div className={styles.position}>
              <div className={styles.gauge} role="img" aria-label={`${percent(utilisationPct)} of eligible value utilised`}>
                <svg viewBox="0 0 36 36" aria-hidden>
                  <defs>
                    <linearGradient id={gaugeId}><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#6d28d9" /></linearGradient>
                  </defs>
                  <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.2" className={styles.gaugeTrack} />
                  {utilisationPct > 0 && (
                    <circle
                      cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.2" strokeLinecap="round"
                      stroke={`url(#${gaugeId})`}
                      strokeDasharray={`${Math.min(100, utilisationPct)} 100`}
                      className={styles.gaugeArc}
                    />
                  )}
                </svg>
                <div className={styles.gaugeCenter}>
                  <div><b className={cn(styles.gaugeValue, styles.num)}>{percent(utilisationPct)}</b><small className={styles.gaugeLabel}>UTILISED</small></div>
                </div>
              </div>
              <div className={styles.kicker}>
                <span className={styles.kickerLabel}>Active FD principal</span>
                <div className={cn(styles.big, styles.num)}>{formatFdCurrency(activePrincipal)}</div>
                <div className={styles.sub}>
                  <span className={cn(styles.pill, styles.pillSlate)}>{activeDeposits.length} active FD{activeDeposits.length === 1 ? '' : 's'}</span>
                </div>
                <div className={styles.bar} aria-hidden>
                  <i style={{ width: `${Math.min(100, shareOfEligible(utilized))}%`, background: TONES.violet[1] }} />
                  <i style={{ width: `${Math.min(100, shareOfEligible(reserved))}%`, background: TONES.amber[1] }} />
                  <i style={{ width: `${Math.min(100, shareOfEligible(available))}%`, background: TONES.emerald[1] }} />
                </div>
                <div className={cn(styles.barCap, styles.num)}>
                  {eligibleValue > 0
                    ? ([['Utilised', utilized, 'violet'], ['Reserved', reserved, 'amber'], ['Available', available, 'emerald']] as const).map(([label, value, tone]) => (
                      <span key={label} className={styles.legend} style={toneStyle(tone)}><i aria-hidden />{label} {formatFdCurrency(value)} · {percent(shareOfEligible(value))}</span>
                    ))
                    : <span>Utilised {formatFdCurrency(0)} · {percent(0)} — no eligible value to allocate yet.</span>}
                </div>
              </div>
            </div>
            <div className={styles.equation}>
              <Figure tone="blue" label="Eligible value" value={formatFdCurrency(eligibleValue)} />
              <Operator symbol="−" />
              <Figure tone="violet" label="Total utilised" value={formatFdCurrency(utilized)} note={`${percent(utilisationPct)} of eligible value`} op="−" />
              <Operator symbol="−" />
              <Figure tone="amber" label="Reserved" value={formatFdCurrency(reserved)} note="Approved or blocked, not yet active" op="−" />
              <Operator symbol="=" />
              <Figure tone="emerald" label="Available balance" value={formatFdCurrency(available)} op="=" />
            </div>
            <div className={styles.instruments}>
              <InstrumentTile tone="bg" icon={ShieldCheck} label="Utilised against BG" value={bgUtilized} linked={bgLinkedFdCount} share={shareOfEligible(bgUtilized)} />
              <InstrumentTile tone="lc" icon={Landmark} label="Utilised against LC" value={lcUtilized} linked={lcLinkedFdCount} share={shareOfEligible(lcUtilized)} />
            </div>
          </section>

          {/* ── Needs attention ── */}
          <section className={styles.card} style={toneStyle('amber')}>
            <CardHead icon={TriangleAlert} title="Needs attention" description="Exceptions to clear.">
              <span className={cn(styles.pill, openAttention ? styles.pillRose : styles.pillGreen)}>{openAttention ? `${openAttention} to clear` : 'All clear'}</span>
            </CardHead>
            <div className={styles.stack}>
              {attention.map((item) => {
                const Icon = item.icon;
                const body = (
                  <>
                    <span className={styles.tile} aria-hidden><Icon /></span>
                    <div className="min-w-0">
                      <b className={styles.attTitle}>{item.title}</b>
                      <span className={cn(styles.attText, styles.num)}>{formatFdCurrency(item.amount)} · {fdCount(item.count)}</span>
                    </div>
                    <span className={styles.spacer} />
                    {item.count > 0
                      ? <span className={styles.flagChip}>Review<ArrowUpRight aria-hidden /></span>
                      : <span className={styles.okChip}><Check aria-hidden />Clear</span>}
                  </>
                );
                return item.count > 0
                  ? <Link key={item.title} href={item.href} className={styles.attItem} style={toneStyle(item.tone)}>{body}</Link>
                  : <div key={item.title} className={styles.attItem} style={toneStyle(item.tone)}>{body}</div>;
              })}
            </div>
            {!openAttention && <div className={styles.allClear}><CircleCheck aria-hidden />Nothing to clear as on this date.</div>}
          </section>
        </div>

        <div className={cn(styles.row, styles.rowStretch)}>
          {/* ── Maturity exposure ── */}
          <section className={styles.card} style={toneStyle('orange')}>
            <CardHead icon={CalendarClock} title="Maturity exposure" description="Active principal maturing from the as-on date.">
              <span className={cn(styles.pill, maturity7.count ? styles.pillRose : styles.pillSlate)}>
                {maturity7.count ? `${fdCount(maturity7.count)} this week` : `${fdCount(maturity30.count)} in 30 days`}
              </span>
            </CardHead>
            <div className={styles.tiles}>
              <Figure tone="rose" label="Within 7 days" value={formatFdCurrency(maturity7.amount)} note={fdCount(maturity7.count)} />
              <Figure tone="amber" label="Within 30 days" value={formatFdCurrency(maturity30.amount)} note={fdCount(maturity30.count)} />
              <Figure tone="orange" label="Within 90 days" value={formatFdCurrency(maturity90.amount)} note={fdCount(maturity90.count)} />
            </div>
            <div className={styles.ladder}>
              <span className={styles.kickerLabel}>Maturity ageing</span>
              {ageing.map((row) => (
                <div key={row.label} className={styles.rung} style={toneStyle(AGEING_TONES[row.label] ?? 'blue')}>
                  <span className={styles.rungLabel}>{row.label}</span>
                  <span className={styles.rungBar} aria-hidden>
                    <i style={{ width: `${largestAgeingAmount > 0 ? (row.amount / largestAgeingAmount) * 100 : 0}%` }} />
                  </span>
                  <span className={cn(styles.rungValue, styles.num)}>{formatFdCurrency(row.amount)} · {row.count}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── Interest realisation ── */}
          <section className={styles.card} style={toneStyle('emerald')}>
            <CardHead icon={BadgeIndianRupee} title="Interest realisation" description="Expected versus received.">
              <span className={cn(styles.pill, expectedInterest > 0 ? styles.pillGreen : styles.pillSlate)}>
                {expectedInterest > 0 ? `${percent(realisedPct)} realised` : 'None expected'}
              </span>
            </CardHead>
            <div className={styles.stack}>
              <Figure tone="blue" label="Expected interest" value={formatFdCurrency(expectedInterest)} />
              <Figure tone="emerald" label="Interest received" value={formatFdCurrency(interestReceived)} />
              <Figure tone="amber" label="Pending interest" value={formatFdCurrency(pendingInterest)} />
              <div className={styles.bar} aria-hidden style={{ marginTop: 4 }}>
                <i style={{ width: `${realisedPct}%`, background: TONES.emerald[1] }} />
              </div>
            </div>
          </section>
        </div>

        {/* ── Breakdown ── */}
        <section className={styles.card} style={toneStyle('blue')}>
          <CardHead icon={Building2} title="Portfolio breakdown" description="Active holdings and BG/LC allocation by bank, holder, purpose and maturity month.">
            <div className={styles.headActions}>
              <button type="button" className={styles.btn} disabled={exporting} onClick={() => void exportWorkbook(false)}>
                {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}Export dashboard
              </button>
              <button type="button" className={styles.btn} disabled={exporting} onClick={() => void exportWorkbook(true)}><Building2 aria-hidden />Bank-wise summary</button>
              <button type="button" className={styles.btn} onClick={() => window.print()}><Printer aria-hidden />Print</button>
            </div>
          </CardHead>
          <Tabs defaultValue="bank" className={styles.tabs}>
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="bank">Bank-wise</TabsTrigger>
              <TabsTrigger value="holder">Holder-wise</TabsTrigger>
              <TabsTrigger value="purpose">Purpose-wise</TabsTrigger>
              <TabsTrigger value="maturity">Maturity Month-wise</TabsTrigger>
            </TabsList>
            <TabsContent value="bank">
              <Table><TableHeader><TableRow><TableHead>Bank</TableHead><TableHead className="text-right">FDs</TableHead><TableHead className="text-right">Principal</TableHead><TableHead className="text-right">BG Utilised</TableHead><TableHead className="text-right">LC Utilised</TableHead><TableHead className="text-right">Available</TableHead><TableHead className="text-right">Maturing ≤30d</TableHead></TableRow></TableHeader><TableBody>
                {bankSummary.map((row) => <TableRow key={row.bank}><TableCell className="font-medium">{row.bank}</TableCell><TableCell className="text-right tabular-nums">{row.count}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{formatFdCurrency(row.principal)}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{formatFdCurrency(row.bg)}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{formatFdCurrency(row.lc)}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-700">{formatFdCurrency(row.available)}</TableCell><TableCell className="text-right tabular-nums">{row.maturing30}</TableCell></TableRow>)}
                {!bankSummary.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No active FDs found.</TableCell></TableRow>}
              </TableBody></Table>
            </TabsContent>
            <TabsContent value="holder">{summaryTable(holderSummary, 'FD Holder')}</TabsContent>
            <TabsContent value="purpose">{summaryTable(purposeSummary, 'FD Purpose')}</TabsContent>
            <TabsContent value="maturity">
              <Table><TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">FD Count</TableHead><TableHead className="text-right">Principal Amount</TableHead></TableRow></TableHeader><TableBody>
                {maturityMonths.map((row) => <TableRow key={row.month}><TableCell className="font-medium">{row.month}</TableCell><TableCell className="text-right tabular-nums">{row.count}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{formatFdCurrency(row.amount)}</TableCell></TableRow>)}
                {!maturityMonths.length && <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">No upcoming maturities.</TableCell></TableRow>}
              </TableBody></Table>
            </TabsContent>
          </Tabs>
        </section>

        {/* ── Quick links ── */}
        <nav className={styles.quick} aria-label="Fixed deposit shortcuts">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href} className={styles.quickLink} style={toneStyle(link.tone)}>
                <span className={styles.tile} aria-hidden><Icon /></span>{link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
