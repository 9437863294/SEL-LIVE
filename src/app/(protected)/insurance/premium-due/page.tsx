
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
  Search,
  Shield,
  X,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RenewalDialog } from '@/components/RenewalDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

type PremiumStatus = 'overdue' | 'due-soon' | 'upcoming';

function getPremiumStatus(due: Date | null): PremiumStatus {
  if (!due) return 'upcoming';
  if (isPast(startOfDay(due))) return 'overdue';
  if (isWithinInterval(due, { start: new Date(), end: addDays(new Date(), 30) })) return 'due-soon';
  return 'upcoming';
}

const STATUS_CFG: Record<PremiumStatus, { label: string; badgeCls: string; rowCls: string; dot: string }> = {
  overdue:    { label: 'Overdue',   badgeCls: 'bg-red-100 text-red-700 border-red-200',    rowCls: 'hover:bg-red-50/40',    dot: 'bg-red-500' },
  'due-soon': { label: 'Due Soon',  badgeCls: 'bg-amber-100 text-amber-700 border-amber-200', rowCls: 'hover:bg-amber-50/40', dot: 'bg-amber-400' },
  upcoming:   { label: 'Upcoming',  badgeCls: 'bg-slate-100 text-slate-600 border-slate-200', rowCls: 'hover:bg-slate-50/30', dot: 'bg-slate-300' },
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
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 ring-1 ring-amber-100">
              <CalendarClock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <CardTitle className="tracking-tight">Premium Due</CardTitle>
              <CardDescription>Upcoming and overdue premium payment schedule</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchPolicies} className="gap-1.5 w-fit">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </CardHeader>

        {/* Stats strip */}
        <CardContent className="grid grid-cols-2 gap-2 border-t sm:grid-cols-4 pt-4">
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

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search holder, policy, company…" className="pl-8 h-9 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="h-9 w-36 text-sm"><SelectValue placeholder="All Years" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {yearOptions.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="h-9 w-36 text-sm"><SelectValue placeholder="All Months" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Months</SelectItem>
            {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {(search || selectedYear !== 'all' || selectedMonth !== 'all') && (
          <button onClick={() => { setSearch(''); setSelectedYear('all'); setSelectedMonth('all'); }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} policies</span>
      </div>

      {/* ── Mobile cards ───────────────────────────────────────────────────── */}
      <div className="space-y-2 sm:hidden">
        {filtered.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center"><CheckCircle2 className="h-10 w-10 text-emerald-400" /><p className="text-sm text-muted-foreground">No policies match your filters.</p></CardContent></Card>
        ) : filtered.map((policy) => {
          const cfg = STATUS_CFG[policy._status];
          const daysLeft = policy._due ? Math.ceil((policy._due.getTime() - Date.now()) / 86400000) : null;
          return (
            <Card key={policy.id} className={cn('cursor-pointer overflow-hidden border-border/60', policy._status === 'overdue' && 'ring-1 ring-red-200')} onClick={() => router.push(`/insurance/personal/${policy.id}`)}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold text-sm">{policy.insured_person}</p><p className="text-xs text-muted-foreground font-mono">{policy.policy_no}</p></div>
                  <Badge variant="outline" className={cn('text-[10px] shrink-0', cfg.badgeCls)}>{cfg.label}</Badge>
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
      <Card className="hidden sm:block overflow-hidden border-border/60">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-6" />
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
                <TableRow><TableCell colSpan={9} className="h-32 text-center"><div className="flex flex-col items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-8 w-8 text-emerald-400" /><span className="text-sm">No policies match your filters.</span></div></TableCell></TableRow>
              ) : filtered.map((policy) => {
                const cfg = STATUS_CFG[policy._status];
                const daysLeft = policy._due ? Math.ceil((policy._due.getTime() - Date.now()) / 86400000) : null;
                const canRenew = policy._status === 'overdue' || policy._status === 'due-soon';
                return (
                  <TableRow key={policy.id} onClick={() => router.push(`/insurance/personal/${policy.id}`)} className={cn('cursor-pointer transition-colors', cfg.rowCls)}>
                    <TableCell className="pr-0"><div className={cn('h-2 w-2 rounded-full mx-auto', cfg.dot)} /></TableCell>
                    <TableCell className="font-medium">{policy.insured_person}</TableCell>
                    <TableCell className="font-mono text-xs">{policy.policy_no}</TableCell>
                    <TableCell>{policy.insurance_company}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{policy.payment_type}</Badge></TableCell>
                    <TableCell className="font-semibold">{fmtCur(policy.premium)}</TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className={cn('text-sm font-medium', policy._status === 'overdue' ? 'text-red-600' : policy._status === 'due-soon' ? 'text-amber-600' : '')}>{policy._due ? format(policy._due, 'dd MMM yyyy') : '—'}</p>
                        {daysLeft !== null && Math.abs(daysLeft) <= 60 && <p className="text-[11px] text-muted-foreground">{daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : daysLeft === 0 ? 'Today' : `${daysLeft}d left`}</p>}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className={cn('text-[10px] gap-1', cfg.badgeCls)}>{cfg.label}</Badge></TableCell>
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
        </div>
      </Card>

      <PremiumScheduleDialog policy={selectedPolicy} isOpen={isScheduleOpen} onOpenChange={setIsScheduleOpen} />
      {selectedPolicy && <RenewalDialog isOpen={isRenewOpen} onOpenChange={setIsRenewOpen} policy={selectedPolicy} onSuccess={fetchPolicies} />}
    </div>
  );
}
