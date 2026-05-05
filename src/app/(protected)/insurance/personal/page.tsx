
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Edit,
  History,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { addDays, format, isPast, isWithinInterval, startOfDay } from 'date-fns';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import type { InsurancePolicy } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

type PolicyStatus = 'overdue' | 'due-soon' | 'active' | 'matured';

function getStatus(policy: InsurancePolicy): PolicyStatus {
  const today = startOfDay(new Date());
  const maturity = policy.date_of_maturity?.toDate?.();
  if (maturity && isPast(maturity)) return 'matured';
  const due = policy.due_date?.toDate?.();
  if (!due) return 'active';
  if (isPast(startOfDay(due))) return 'overdue';
  if (isWithinInterval(due, { start: today, end: addDays(today, 30) })) return 'due-soon';
  return 'active';
}

const STATUS_CONFIG: Record<PolicyStatus, { label: string; className: string; icon: React.ElementType }> = {
  overdue:  { label: 'Overdue',  className: 'bg-red-100 text-red-700 border-red-200',    icon: AlertTriangle },
  'due-soon': { label: 'Due Soon', className: 'bg-amber-100 text-amber-700 border-amber-200', icon: Clock },
  active:   { label: 'Active',   className: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  matured:  { label: 'Matured',  className: 'bg-slate-100 text-slate-600 border-slate-200',  icon: ShieldCheck },
};

const fmtDate = (ts: { toDate?: () => Date } | null | undefined) => {
  const d = ts?.toDate?.();
  return d ? format(d, 'dd MMM yyyy') : '—';
};

const fmtCur = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

// ─── page ─────────────────────────────────────────────────────────────────────

export default function PersonalInsurancePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();

  const canViewPage = can('View', 'Insurance.Personal Insurance');
  const canAdd      = can('Add',  'Insurance.Personal Insurance');
  const canEdit     = can('Edit', 'Insurance.Personal Insurance');

  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PolicyStatus | 'all'>('all');

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'insurance_policies'));
      setPolicies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy)));
    } catch (err) {
      console.error('Error fetching policies:', err);
      toast({ title: 'Error', description: 'Failed to fetch policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (canViewPage) fetchPolicies();
    else setIsLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canViewPage]);

  // ─── computed ─────────────────────────────────────────────────────────────

  const enriched = useMemo(
    () => policies.map((p) => ({ ...p, _status: getStatus(p) })),
    [policies]
  );

  const stats = useMemo(() => ({
    total:    enriched.length,
    overdue:  enriched.filter((p) => p._status === 'overdue').length,
    dueSoon:  enriched.filter((p) => p._status === 'due-soon').length,
    active:   enriched.filter((p) => p._status === 'active').length,
    matured:  enriched.filter((p) => p._status === 'matured').length,
  }), [enriched]);

  const filtered = useMemo(() => {
    let rows = enriched;
    if (statusFilter !== 'all') rows = rows.filter((p) => p._status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.insured_person.toLowerCase().includes(q) ||
          p.policy_no.toLowerCase().includes(q) ||
          p.insurance_company.toLowerCase().includes(q) ||
          (p.policy_name ?? '').toLowerCase().includes(q)
      );
    }
    return rows.sort((a, b) => {
      const da = a.due_date?.toDate?.()?.getTime() ?? Infinity;
      const db = b.due_date?.toDate?.()?.getTime() ?? Infinity;
      // Overdue first, then ascending by due date
      if (a._status === 'overdue' && b._status !== 'overdue') return -1;
      if (b._status === 'overdue' && a._status !== 'overdue') return 1;
      return da - db;
    });
  }, [enriched, statusFilter, search]);

  // ─── loading ──────────────────────────────────────────────────────────────

  if (authLoading || (isLoading && canViewPage)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied</CardTitle>
          <CardDescription>You do not have permission to view personal insurance policies.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 ring-1 ring-violet-100">
              <Shield className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <CardTitle className="tracking-tight">Personal Insurance</CardTitle>
              <CardDescription>All personal insurance policies across holders</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/insurance/personal/history">
              <Button variant="outline" size="sm" className="gap-1.5">
                <History className="h-3.5 w-3.5" /> History
              </Button>
            </Link>
            <Link href="/insurance/premium-due">
              <Button variant="outline" size="sm" className="gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" /> Premium Due
              </Button>
            </Link>
            {canAdd && (
              <Link href="/insurance/personal/new">
                <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
                  <Plus className="h-3.5 w-3.5" /> Add Policy
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>

        {/* Stats strip */}
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-5 border-t">
          {[
            { label: 'Total',     value: stats.total,    status: 'all'       as const, color: 'text-slate-700' },
            { label: 'Active',    value: stats.active,   status: 'active'    as const, color: 'text-emerald-600' },
            { label: 'Due Soon',  value: stats.dueSoon,  status: 'due-soon'  as const, color: 'text-amber-600' },
            { label: 'Overdue',   value: stats.overdue,  status: 'overdue'   as const, color: 'text-red-600' },
            { label: 'Matured',   value: stats.matured,  status: 'matured'   as const, color: 'text-slate-500' },
          ].map((s) => (
            <button
              key={s.label}
              onClick={() => setStatusFilter(statusFilter === s.status ? 'all' : s.status)}
              className={cn(
                'flex flex-col items-center justify-center rounded-lg py-2 px-1 transition-all text-center',
                statusFilter === s.status ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/50'
              )}
            >
              <span className={cn('text-xl font-bold leading-tight', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* ── Search + Filter bar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search holder, policy no, company…"
            className="pl-8 h-9 bg-background text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Active status filter chips */}
        {(['overdue', 'due-soon', 'active', 'matured'] as PolicyStatus[]).map((s) => {
          const cfg = STATUS_CONFIG[s];
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                statusFilter === s ? cfg.className : 'border-border/60 text-muted-foreground hover:bg-muted/50'
              )}
            >
              <cfg.icon className="h-3 w-3" />
              {cfg.label}
            </button>
          );
        })}

        {(search || statusFilter !== 'all') && (
          <button
            onClick={() => { setSearch(''); setStatusFilter('all'); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} / {enriched.length} policies
        </span>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}

      {/* Mobile cards */}
      <div className="space-y-2 sm:hidden">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Shield className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No policies match your filters.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((policy) => {
            const cfg = STATUS_CONFIG[policy._status];
            return (
              <Card
                key={policy.id}
                className="cursor-pointer overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-sm border-border/60"
                onClick={() => router.push(`/insurance/personal/${policy.id}`)}
              >
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{policy.insured_person}</p>
                      <p className="text-xs text-muted-foreground">{policy.policy_no}</p>
                    </div>
                    <Badge variant="outline" className={cn('text-[10px] shrink-0', cfg.className)}>
                      <cfg.icon className="h-2.5 w-2.5 mr-1" />{cfg.label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div><span className="text-muted-foreground">Company: </span>{policy.insurance_company}</div>
                    <div><span className="text-muted-foreground">Premium: </span>{fmtCur(policy.premium)}</div>
                    <div><span className="text-muted-foreground">Due: </span>{fmtDate(policy.due_date)}</div>
                    <div><span className="text-muted-foreground">Maturity: </span>{fmtDate(policy.date_of_maturity)}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Desktop table */}
      <Card className="hidden sm:block overflow-hidden border-border/60">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-8" />
                <TableHead>Policy Holder</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Policy Name</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Next Due</TableHead>
                <TableHead>Maturity</TableHead>
                <TableHead>Sum Insured</TableHead>
                {canEdit && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={11}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Shield className="h-8 w-8 opacity-30" />
                      <span className="text-sm">No policies match your filters.</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((policy) => {
                  const cfg = STATUS_CONFIG[policy._status];
                  const isUrgent = policy._status === 'overdue' || policy._status === 'due-soon';
                  return (
                    <TableRow
                      key={policy.id}
                      onClick={() => router.push(`/insurance/personal/${policy.id}`)}
                      className={cn(
                        'cursor-pointer transition-colors',
                        isUrgent ? 'hover:bg-red-50/50' : 'hover:bg-muted/30'
                      )}
                    >
                      <TableCell className="pr-0">
                        <div className={cn('h-2 w-2 rounded-full mx-auto', {
                          'bg-red-500':     policy._status === 'overdue',
                          'bg-amber-400':   policy._status === 'due-soon',
                          'bg-emerald-400': policy._status === 'active',
                          'bg-slate-300':   policy._status === 'matured',
                        })} />
                      </TableCell>
                      <TableCell className="font-medium">{policy.insured_person}</TableCell>
                      <TableCell className="font-mono text-xs">{policy.policy_no}</TableCell>
                      <TableCell>{policy.insurance_company}</TableCell>
                      <TableCell className="max-w-[160px] truncate">{policy.policy_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-medium">{policy.payment_type}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{fmtCur(policy.premium)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-[10px] gap-1', cfg.className)}>
                          <cfg.icon className="h-2.5 w-2.5" />
                          {fmtDate(policy.due_date)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{fmtDate(policy.date_of_maturity)}</TableCell>
                      <TableCell>{fmtCur(policy.sum_insured)}</TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <Link href={`/insurance/personal/edit/${policy.id}`} onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                              <Edit className="h-3 w-3" /> Edit
                            </Button>
                          </Link>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

    </div>
  );
}
