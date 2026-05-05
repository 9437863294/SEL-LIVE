
'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDays, format, getYear, isPast, isWithinInterval, startOfDay } from 'date-fns';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { AlertTriangle, CalendarCheck, CheckCircle2, Clock, RefreshCw, Search, Shield, TrendingDown, X } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import type { InsurancePolicy } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

type MaturityStatus = 'matured' | 'near' | 'upcoming';

function getMaturityStatus(d: Date | null): MaturityStatus {
  if (!d) return 'upcoming';
  if (isPast(startOfDay(d))) return 'matured';
  if (isWithinInterval(d, { start: new Date(), end: addDays(new Date(), 90) })) return 'near';
  return 'upcoming';
}

const STATUS_CFG: Record<MaturityStatus, { label: string; badgeCls: string; rowCls: string; dot: string }> = {
  matured:  { label: 'Matured',     badgeCls: 'bg-red-100 text-red-700 border-red-200',    rowCls: 'hover:bg-red-50/30',    dot: 'bg-red-500' },
  near:     { label: 'Mature Soon', badgeCls: 'bg-amber-100 text-amber-700 border-amber-200', rowCls: 'hover:bg-amber-50/30', dot: 'bg-amber-400' },
  upcoming: { label: 'Upcoming',    badgeCls: 'bg-slate-100 text-slate-600 border-slate-200', rowCls: 'hover:bg-slate-50/20', dot: 'bg-slate-300' },
};

const fmtCur = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

// ─── page ─────────────────────────────────────────────────────────────────────

export default function MaturityDuePage() {
  const { toast } = useToast();
  const router = useRouter();

  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [search, setSearch] = useState('');

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'insurance_policies'), where('date_of_maturity', '!=', null), orderBy('date_of_maturity', 'asc'));
      const snap = await getDocs(q);
      setPolicies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy)));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchPolicies(); }, []); // eslint-disable-line

  const yearOptions = useMemo(() => {
    const years = new Set(policies.map((p) => { const d = p.date_of_maturity?.toDate?.(); return d ? getYear(d) : 0; }).filter(Boolean));
    return Array.from(years).sort((a, b) => b - a).map(String);
  }, [policies]);

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: format(new Date(0, i), 'MMMM') }));

  const enriched = useMemo(() =>
    policies.map((p) => ({ ...p, _mat: p.date_of_maturity?.toDate?.() ?? null, _status: getMaturityStatus(p.date_of_maturity?.toDate?.() ?? null) })),
  [policies]);

  const filtered = useMemo(() => {
    let rows = enriched;
    if (selectedYear !== 'all') rows = rows.filter((p) => p._mat && getYear(p._mat).toString() === selectedYear);
    if (selectedMonth !== 'all') rows = rows.filter((p) => p._mat && p._mat.getMonth().toString() === selectedMonth);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((p) => p.insured_person.toLowerCase().includes(q) || p.policy_no.toLowerCase().includes(q) || p.insurance_company.toLowerCase().includes(q));
    }
    return rows.sort((a, b) => {
      if (a._status === 'matured' && b._status !== 'matured') return -1;
      if (b._status === 'matured' && a._status !== 'matured') return 1;
      return (a._mat?.getTime() ?? 0) - (b._mat?.getTime() ?? 0);
    });
  }, [enriched, selectedYear, selectedMonth, search]);

  const stats = useMemo(() => ({
    matured:  enriched.filter((p) => p._status === 'matured').length,
    near:     enriched.filter((p) => p._status === 'near').length,
    upcoming: enriched.filter((p) => p._status === 'upcoming').length,
    totalSum: enriched.filter((p) => p._status === 'matured' || p._status === 'near').reduce((s, p) => s + (p.sum_insured || 0), 0),
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
        <div className="h-1 w-full bg-gradient-to-r from-rose-400 via-pink-500 to-fuchsia-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 ring-1 ring-rose-100">
              <CalendarCheck className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <CardTitle className="tracking-tight">Maturity Due</CardTitle>
              <CardDescription>Track policies approaching or past their maturity date</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchPolicies} className="gap-1.5 w-fit">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </CardHeader>

        {/* Stats strip */}
        <CardContent className="grid grid-cols-2 gap-2 border-t sm:grid-cols-4 pt-4">
          {[
            { label: 'Matured',       value: stats.matured,   color: 'text-red-600' },
            { label: 'Mature in 90d', value: stats.near,      color: 'text-amber-600' },
            { label: 'Upcoming',      value: stats.upcoming,  color: 'text-slate-600' },
            { label: 'Sum Insured',   value: fmtCur(stats.totalSum), color: 'text-rose-600', isAmount: true },
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
          const daysLeft = policy._mat ? Math.ceil((policy._mat.getTime() - Date.now()) / 86400000) : null;
          return (
            <Card key={policy.id} className={cn('cursor-pointer overflow-hidden border-border/60', policy._status === 'matured' && 'ring-1 ring-red-200')} onClick={() => router.push(`/insurance/personal/${policy.id}`)}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold text-sm">{policy.insured_person}</p><p className="text-xs text-muted-foreground font-mono">{policy.policy_no}</p></div>
                  <Badge variant="outline" className={cn('text-[10px] shrink-0', cfg.badgeCls)}>{cfg.label}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div><span className="text-muted-foreground">Company: </span>{policy.insurance_company}</div>
                  <div><span className="text-muted-foreground">Sum Insured: </span><span className="font-medium">{fmtCur(policy.sum_insured)}</span></div>
                  <div className="col-span-2"><span className="text-muted-foreground">Maturity: </span><span className={cn('font-medium', policy._status === 'matured' ? 'text-red-600' : policy._status === 'near' ? 'text-amber-600' : '')}>{policy._mat ? format(policy._mat, 'dd MMM yyyy') : '—'}{daysLeft !== null && Math.abs(daysLeft) <= 90 ? ` (${daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`})` : ''}</span></div>
                </div>
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
                <TableHead>Category</TableHead>
                <TableHead>Tenure (yrs)</TableHead>
                <TableHead>Sum Insured</TableHead>
                <TableHead>Maturity Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="h-32 text-center"><div className="flex flex-col items-center gap-2 text-muted-foreground"><CalendarCheck className="h-8 w-8 opacity-30" /><span className="text-sm">No policies match your filters.</span></div></TableCell></TableRow>
              ) : filtered.map((policy) => {
                const cfg = STATUS_CFG[policy._status];
                const daysLeft = policy._mat ? Math.ceil((policy._mat.getTime() - Date.now()) / 86400000) : null;
                return (
                  <TableRow key={policy.id} onClick={() => router.push(`/insurance/personal/${policy.id}`)} className={cn('cursor-pointer transition-colors', cfg.rowCls)}>
                    <TableCell className="pr-0"><div className={cn('h-2 w-2 rounded-full mx-auto', cfg.dot)} /></TableCell>
                    <TableCell className="font-medium">{policy.insured_person}</TableCell>
                    <TableCell className="font-mono text-xs">{policy.policy_no}</TableCell>
                    <TableCell>{policy.insurance_company}</TableCell>
                    <TableCell>{policy.policy_category || '—'}</TableCell>
                    <TableCell className="text-center">{policy.tenure ?? '—'}</TableCell>
                    <TableCell className="font-semibold">{fmtCur(policy.sum_insured)}</TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className={cn('text-sm font-medium', policy._status === 'matured' ? 'text-red-600' : policy._status === 'near' ? 'text-amber-600' : '')}>{policy._mat ? format(policy._mat, 'dd MMM yyyy') : '—'}</p>
                        {daysLeft !== null && Math.abs(daysLeft) <= 90 && <p className="text-[11px] text-muted-foreground">{daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}</p>}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className={cn('text-[10px]', cfg.badgeCls)}>{cfg.label}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

    </div>
  );
}
