'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { format, getYear } from 'date-fns';
import { BadgeCheck, CalendarCheck, CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { InsurancePolicy } from '@/lib/types';
import { daysUntil, formatDay, formatInr, MATURITY_SOON_DAYS, relativeDays, toDate } from '@/lib/insurance';
import { PERSONAL_POLICIES } from '@/lib/insurance-service';
import { exportRowsToExcel } from '@/lib/report-excel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { AccessDenied } from '@/components/insurance/insurance-ui';
import { SettlementDialog } from '@/components/insurance/SettlementDialog';
import { cn } from '@/lib/utils';

type MaturityStatus = 'matured' | 'near' | 'upcoming' | 'claimed';

function maturityStatus(p: InsurancePolicy, mat: Date, now: Date): MaturityStatus {
  if (p.status === 'Claimed') return 'claimed';
  const days = daysUntil(mat, now);
  if (days <= 0) return 'matured';
  if (days <= MATURITY_SOON_DAYS) return 'near';
  return 'upcoming';
}

// A matured, unclaimed policy is the one needing action here, so it reads as danger.
const STATUS_BADGE: Record<MaturityStatus, { label: string; tone: StatusTone }> = {
  matured:  { label: 'Matured — Unclaimed', tone: 'danger' },
  near:     { label: 'Mature Soon', tone: 'warning' },
  upcoming: { label: 'Upcoming', tone: 'info' },
  claimed:  { label: 'Claimed', tone: 'success' },
};
const ORDER: Record<MaturityStatus, number> = { matured: 0, near: 1, upcoming: 2, claimed: 3 };

type Row = InsurancePolicy & { _mat: Date; _status: MaturityStatus };

export default function MaturityDuePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Insurance.Personal Insurance') || can('View', 'Insurance.Maturity Due');
  const canClaim = can('Edit', 'Insurance.Personal Insurance');

  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [search, setSearch] = useState('');
  const [showClaimed, setShowClaimed] = useState(false);

  const [claimPolicy, setClaimPolicy] = useState<Row | null>(null);

  const fetchPolicies = useCallback(async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, PERSONAL_POLICIES));
      setPolicies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy)));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (authLoading) return;
    if (canView) fetchPolicies();
    else setIsLoading(false);
  }, [authLoading, canView, fetchPolicies]);

  // Surrendered and closed policies will never mature; claimed ones are kept for reference.
  const enriched = useMemo<Row[]>(() => {
    const now = new Date();
    return policies.flatMap((p) => {
      const mat = toDate(p.date_of_maturity);
      if (!mat || p.status === 'Surrendered' || p.status === 'Closed') return [];
      return [{ ...p, _mat: mat, _status: maturityStatus(p, mat, now) }];
    });
  }, [policies]);

  const yearOptions = useMemo(
    () => Array.from(new Set(enriched.map((p) => getYear(p._mat)))).sort((a, b) => b - a).map(String),
    [enriched],
  );
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: format(new Date(2000, i, 1), 'MMMM') }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched
      .filter((p) => showClaimed || p._status !== 'claimed')
      .filter((p) => selectedYear === 'all' || String(getYear(p._mat)) === selectedYear)
      .filter((p) => selectedMonth === 'all' || String(p._mat.getMonth()) === selectedMonth)
      .filter((p) => !q || [p.insured_person, p.policy_no, p.insurance_company].some((v) => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => ORDER[a._status] - ORDER[b._status] || a._mat.getTime() - b._mat.getTime());
  }, [enriched, showClaimed, selectedYear, selectedMonth, search]);

  const stats = useMemo(() => ({
    matured:  enriched.filter((p) => p._status === 'matured').length,
    near:     enriched.filter((p) => p._status === 'near').length,
    upcoming: enriched.filter((p) => p._status === 'upcoming').length,
    claimed:  enriched.filter((p) => p._status === 'claimed').length,
    totalSum: enriched.filter((p) => p._status === 'matured' || p._status === 'near').reduce((s, p) => s + (p.sum_insured || 0), 0),
  }), [enriched]);

  const openClaim = (p: Row) => setClaimPolicy(p);

  const exportList = () =>
    exportRowsToExcel('Maturity Due', filtered.map((p) => ({
      'Policy Holder': p.insured_person,
      'Policy No.': p.policy_no,
      Company: p.insurance_company,
      Category: p.policy_category || '',
      'Sum Assured': p.sum_insured || 0,
      'Maturity Date': formatDay(p._mat),
      Status: STATUS_BADGE[p._status].label,
      'Claim Received': p.closure_amount ?? '',
      Nominee: p.nominee_name || '',
    })));

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (!canView) return <AccessDenied what="view maturities" />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={CalendarCheck}
        title="Maturity Due"
        description="Policies approaching or past maturity — claim the maturity value and close them out"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportList} disabled={filtered.length === 0} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={fetchPolicies} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden border-border/60">
        <CardContent className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
          {[
            { label: 'Matured — Unclaimed', value: stats.matured,  color: 'text-red-600' },
            { label: `Mature in ${MATURITY_SOON_DAYS}d`, value: stats.near, color: 'text-amber-600' },
            { label: 'Upcoming',       value: stats.upcoming, color: 'text-slate-600' },
            { label: 'Claimed',        value: stats.claimed,  color: 'text-emerald-600' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center rounded-lg py-2 text-center">
              <span className={cn('text-2xl font-bold leading-tight', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
          <div className="col-span-2 flex flex-col items-center rounded-lg py-2 sm:col-span-1">
            <span className="text-base font-bold leading-tight text-rose-600">{formatInr(stats.totalSum)}</span>
            <span className="text-[11px] text-muted-foreground">Sum assured to claim</span>
          </div>
        </CardContent>
      </Card>

      <TableCard
        title="Policies by maturity"
        icon={CalendarCheck}
        count={filtered.length}
        total={enriched.length}
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Search holder, policy, company…' }}
            activeCount={(selectedYear !== 'all' ? 1 : 0) + (selectedMonth !== 'all' ? 1 : 0) + (showClaimed ? 1 : 0)}
            onClear={() => { setSearch(''); setSelectedYear('all'); setSelectedMonth('all'); setShowClaimed(false); }}
          >
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger aria-label="Year"><SelectValue placeholder="All Years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {yearOptions.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger aria-label="Month"><SelectValue placeholder="All Months" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={showClaimed ? 'all' : 'open'} onValueChange={(v) => setShowClaimed(v === 'all')}>
              <SelectTrigger aria-label="Claimed"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Unclaimed only</SelectItem>
                <SelectItem value="all">Include claimed</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        {/* Mobile cards */}
        <div className="space-y-2 p-3 sm:hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center"><CheckCircle2 className="h-10 w-10 text-emerald-400" /><p className="text-sm text-muted-foreground">No policies match your filters.</p></div>
          ) : filtered.map((policy) => {
            const badge = STATUS_BADGE[policy._status];
            return (
              <Card key={policy.id} className={cn('cursor-pointer overflow-hidden border-border/60', policy._status === 'matured' && 'ring-1 ring-red-200')} onClick={() => router.push(`/insurance/personal/${policy.id}`)}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{policy.insured_person}</p><p className="truncate font-mono text-xs text-muted-foreground">{policy.policy_no}</p></div>
                    <StatusBadge status={badge.label} tone={badge.tone} className="shrink-0" />
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div className="min-w-0 truncate"><span className="text-muted-foreground">Company: </span>{policy.insurance_company}</div>
                    <div><span className="text-muted-foreground">Sum: </span><span className="font-medium">{formatInr(policy.sum_insured)}</span></div>
                    <div className="col-span-2"><span className="text-muted-foreground">Maturity: </span><span className="font-medium">{formatDay(policy._mat)} ({relativeDays(policy._mat)})</span></div>
                  </div>
                  {canClaim && (policy._status === 'matured' || policy._status === 'near') && (
                    <Button size="sm" variant="outline" className="h-8 w-full gap-1.5" onClick={(e) => { e.stopPropagation(); openClaim(policy); }}>
                      <BadgeCheck className="h-3.5 w-3.5" /> Record Claim
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Desktop table */}
        <Table containerClassName="hidden sm:block">
          <TableHeader>
            <TableRow>
              <TableHead>Policy Holder</TableHead>
              <TableHead>Policy No.</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Nominee</TableHead>
              <TableHead className="text-right">Sum Assured</TableHead>
              <TableHead>Maturity Date</TableHead>
              <TableHead>Status</TableHead>
              {canClaim && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="h-32 text-center"><div className="flex flex-col items-center gap-2 text-muted-foreground"><CalendarCheck className="h-8 w-8 opacity-30" /><span className="text-sm">No policies match your filters.</span></div></TableCell></TableRow>
            ) : filtered.map((policy) => {
              const badge = STATUS_BADGE[policy._status];
              return (
                <TableRow key={policy.id} onClick={() => router.push(`/insurance/personal/${policy.id}`)} className="cursor-pointer">
                  <TableCell className="font-medium">{policy.insured_person}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono">{policy.policy_no}</TableCell>
                  <TableCell>{policy.insurance_company}</TableCell>
                  <TableCell>{policy.policy_category || '—'}</TableCell>
                  <TableCell>{policy.nominee_name || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {formatInr(policy.sum_insured)}
                    {policy._status === 'claimed' && policy.closure_amount != null && (
                      <p className="text-[11px] text-emerald-600">received {formatInr(policy.closure_amount)}</p>
                    )}
                    {policy._status === 'claimed' && policy.settlement?.status === 'Requested' && (
                      <p className="text-[11px] text-amber-600">payment awaited</p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="space-y-0.5">
                      <p className="font-medium">{formatDay(policy._mat)}</p>
                      {policy._status !== 'claimed' && <p className="text-[11px] text-muted-foreground">{relativeDays(policy._mat)}</p>}
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge status={badge.label} tone={badge.tone} /></TableCell>
                  {canClaim && (
                    <TableCell className="text-right">
                      {(policy._status === 'matured' || policy._status === 'near') && (
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); openClaim(policy); }}>
                          <BadgeCheck className="h-3 w-3" /> Record Claim
                        </Button>
                      )}
                      {policy._status === 'claimed' && policy.settlement?.status === 'Requested' && (
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); openClaim(policy); }}>
                          <BadgeCheck className="h-3 w-3" /> Payment Received
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableCard>

      {claimPolicy && (
        <SettlementDialog
          isOpen={!!claimPolicy}
          onOpenChange={(o) => !o && setClaimPolicy(null)}
          policy={claimPolicy}
          initialType="Maturity Claim"
          focusPayment
          onSuccess={fetchPolicies}
        />
      )}
    </div>
  );
}
