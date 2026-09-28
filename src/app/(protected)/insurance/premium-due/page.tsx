
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Edit,
  RefreshCw,
  RotateCw,
  Shield,
} from 'lucide-react';
import {
  addDays,
  addMonths,
  addQuarters,
  addYears,
  format,
  getYear,
  isPast,
  isWithinInterval,
  startOfDay,
} from 'date-fns';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import type { InsurancePolicy } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RenewalDialog } from '@/components/insurance/RenewalDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

type PremiumStatus = 'overdue' | 'due-soon' | 'upcoming';

function getPremiumStatus(due: Date | null): PremiumStatus {
  if (!due) return 'upcoming';
  if (isPast(startOfDay(due))) return 'overdue';
  if (isWithinInterval(due, { start: new Date(), end: addDays(new Date(), 30) })) return 'due-soon';
  return 'upcoming';
}

const STATUS_LABEL: Record<PremiumStatus, string> = {
  overdue:    'Overdue',
  'due-soon': 'Due Soon',
  upcoming:   'Upcoming',
};

const fmtCur = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

// ─── premium schedule dialog (unchanged) ─────────────────────────────────────

function PremiumScheduleDialog({ policy, isOpen, onOpenChange }: { policy: InsurancePolicy | null; isOpen: boolean; onOpenChange: (v: boolean) => void }) {
  const schedule = useMemo(() => {
    if (!policy?.date_of_comm || !policy.tenure || !policy.payment_type || policy.payment_type === 'One-Time') return [];
    const start = policy.date_of_comm.toDate?.();
    if (!start) return [];
    const dates: Date[] = [];
    for (let i = 0; i < policy.tenure; i++) {
      switch (policy.payment_type) {
        case 'Yearly': dates.push(addYears(start, i)); break;
        case 'Quarterly':
          for (let j = 0; j < 4; j++) {
            const d = addQuarters(addYears(start, i), j);
            if (addYears(start, policy.tenure) > d) dates.push(d);
          }
          break;
        case 'Monthly':
          for (let j = 0; j < 12; j++) {
            const d = addMonths(addYears(start, i), j);
            if (addYears(start, policy.tenure) > d) dates.push(d);
          }
          break;
      }
    }
    return dates;
  }, [policy]);

  if (!policy) return null;
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Premium Schedule</DialogTitle>
          <DialogDescription>Policy No: {policy.policy_no}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-80">
          <Table>
            <TableHeader><TableRow><TableHead>Due Date</TableHead><TableHead className="text-right">Premium</TableHead></TableRow></TableHeader>
            <TableBody>
              {schedule.map((d, i) => (
                <TableRow key={i}><TableCell>{format(d, 'dd MMM, yyyy')}</TableCell><TableCell className="text-right">{fmtCur(policy.premium)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
        <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function PremiumDuePage() {
  const { toast } = useToast();
  const router = useRouter();

  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedPolicy, setSelectedPolicy] = useState<InsurancePolicy | null>(null);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isRenewOpen, setIsRenewOpen] = useState(false);

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'insurance_policies'), where('due_date', '!=', null), orderBy('due_date', 'asc'));
      const snap = await getDocs(q);
      setPolicies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy)));
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to fetch policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchPolicies(); }, []); // eslint-disable-line

  const yearOptions = useMemo(() => {
    const years = new Set(policies.map((p) => { const d = p.due_date?.toDate?.(); return d ? getYear(d) : 0; }).filter(Boolean));
    return Array.from(years).sort((a, b) => b - a).map(String);
  }, [policies]);

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: format(new Date(0, i), 'MMMM') }));

  const enriched = useMemo(() =>
    policies.map((p) => ({ ...p, _due: p.due_date?.toDate?.() ?? null, _status: getPremiumStatus(p.due_date?.toDate?.() ?? null) })),
  [policies]);

  const filtered = useMemo(() => {
    let rows = enriched;
    if (selectedYear !== 'all') rows = rows.filter((p) => p._due && getYear(p._due).toString() === selectedYear);
    if (selectedMonth !== 'all') rows = rows.filter((p) => p._due && p._due.getMonth().toString() === selectedMonth);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((p) => p.insured_person.toLowerCase().includes(q) || p.policy_no.toLowerCase().includes(q) || p.insurance_company.toLowerCase().includes(q));
    }
    return rows.sort((a, b) => {
      if (a._status === 'overdue' && b._status !== 'overdue') return -1;
      if (b._status === 'overdue' && a._status !== 'overdue') return 1;
      return (a._due?.getTime() ?? 0) - (b._due?.getTime() ?? 0);
    });
  }, [enriched, selectedYear, selectedMonth, search]);

  const stats = useMemo(() => ({
    overdue: enriched.filter((p) => p._status === 'overdue').length,
    dueSoon: enriched.filter((p) => p._status === 'due-soon').length,
    upcoming: enriched.filter((p) => p._status === 'upcoming').length,
    totalAmount: enriched.filter((p) => p._status === 'overdue' || p._status === 'due-soon').reduce((s, p) => s + (p.premium || 0), 0),
  }), [enriched]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <PageHeader
        icon={CalendarClock}
        title="Premium Due"
        description="Upcoming and overdue premium payment schedule"
        actions={
          <Button variant="outline" size="sm" onClick={fetchPolicies} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      {/* ── Stats strip ────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/60">
        <CardContent className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
          {[
            { label: 'Overdue',     value: stats.overdue,   color: 'text-red-600' },
            { label: 'Due in 30d',  value: stats.dueSoon,   color: 'text-amber-600' },
            { label: 'Upcoming',    value: stats.upcoming,  color: 'text-slate-600' },
            { label: 'Action Needed', value: fmtCur(stats.totalAmount), color: 'text-rose-600', isAmount: true },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center rounded-lg py-2">
              <span className={cn('font-bold leading-tight', s.isAmount ? 'text-base' : 'text-2xl', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Register ───────────────────────────────────────────────────────── */}
      <TableCard
        title="Premium schedule"
        icon={CalendarClock}
        count={filtered.length}
        total={enriched.length}
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Search holder, policy, company…' }}
            activeCount={(selectedYear !== 'all' ? 1 : 0) + (selectedMonth !== 'all' ? 1 : 0)}
            onClear={() => { setSearch(''); setSelectedYear('all'); setSelectedMonth('all'); }}
          >
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger><SelectValue placeholder="All Years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {yearOptions.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger><SelectValue placeholder="All Months" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
      {/* ── Mobile cards ───────────────────────────────────────────────────── */}
      <div className="space-y-2 p-3 sm:hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center"><CheckCircle2 className="h-10 w-10 text-emerald-400" /><p className="text-sm text-muted-foreground">No policies match your filters.</p></div>
        ) : filtered.map((policy) => {
          const daysLeft = policy._due ? Math.ceil((policy._due.getTime() - Date.now()) / 86400000) : null;
          return (
            <Card key={policy.id} className={cn('cursor-pointer overflow-hidden border-border/60', policy._status === 'overdue' && 'ring-1 ring-red-200')} onClick={() => router.push(`/insurance/personal/${policy.id}`)}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold text-sm">{policy.insured_person}</p><p className="text-xs text-muted-foreground font-mono">{policy.policy_no}</p></div>
                  <StatusBadge status={STATUS_LABEL[policy._status]} className="shrink-0" />
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div><span className="text-muted-foreground">Company: </span>{policy.insurance_company}</div>
                  <div><span className="text-muted-foreground">Premium: </span><span className="font-medium">{fmtCur(policy.premium)}</span></div>
                  <div className="col-span-2"><span className="text-muted-foreground">Due: </span><span className={cn('font-medium', policy._status === 'overdue' ? 'text-red-600' : policy._status === 'due-soon' ? 'text-amber-600' : '')}>{policy._due ? format(policy._due, 'dd MMM yyyy') : '—'}{daysLeft !== null && daysLeft <= 30 ? ` (${daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : daysLeft === 0 ? 'today' : `${daysLeft}d left`})` : ''}</span></div>
                </div>
                {(policy._status === 'overdue' || policy._status === 'due-soon') && (
                  <Button size="sm" className="w-full gap-1.5 h-8" onClick={(e) => { e.stopPropagation(); setSelectedPolicy(policy); setIsRenewOpen(true); }}>
                    <RotateCw className="h-3.5 w-3.5" /> Renew Premium
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Desktop table ──────────────────────────────────────────────────── */}
          <Table containerClassName="hidden sm:block">
            <TableHeader>
              <TableRow>
                <TableHead>Policy Holder</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Payment Type</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="h-32 text-center"><div className="flex flex-col items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-8 w-8 text-emerald-400" /><span className="text-sm">No policies match your filters.</span></div></TableCell></TableRow>
              ) : filtered.map((policy) => {
                const daysLeft = policy._due ? Math.ceil((policy._due.getTime() - Date.now()) / 86400000) : null;
                const canRenew = policy._status === 'overdue' || policy._status === 'due-soon';
                return (
                  <TableRow key={policy.id} onClick={() => router.push(`/insurance/personal/${policy.id}`)} className="cursor-pointer">
                    <TableCell className="font-medium">{policy.insured_person}</TableCell>
                    <TableCell className="font-mono whitespace-nowrap">{policy.policy_no}</TableCell>
                    <TableCell>{policy.insurance_company}</TableCell>
                    <TableCell><Badge variant="outline">{policy.payment_type}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{fmtCur(policy.premium)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="space-y-0.5">
                        <p className={cn('font-medium', policy._status === 'overdue' ? 'text-red-600' : policy._status === 'due-soon' ? 'text-amber-600' : '')}>{policy._due ? format(policy._due, 'dd MMM yyyy') : '—'}</p>
                        {daysLeft !== null && Math.abs(daysLeft) <= 60 && <p className="text-[11px] text-muted-foreground">{daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : daysLeft === 0 ? 'Today' : `${daysLeft}d left`}</p>}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={STATUS_LABEL[policy._status]} /></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant={canRenew ? 'default' : 'ghost'} disabled={!canRenew}
                        className={cn('h-7 gap-1 text-xs', canRenew && 'bg-amber-500 hover:bg-amber-600 text-white')}
                        onClick={(e) => { e.stopPropagation(); if (canRenew) { setSelectedPolicy(policy); setIsRenewOpen(true); } }}>
                        <RotateCw className="h-3 w-3" /> Renew
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
      </TableCard>

      <PremiumScheduleDialog policy={selectedPolicy} isOpen={isScheduleOpen} onOpenChange={setIsScheduleOpen} />
      {selectedPolicy && <RenewalDialog isOpen={isRenewOpen} onOpenChange={setIsRenewOpen} policy={selectedPolicy} onSuccess={fetchPolicies} />}
    </div>
  );
}
