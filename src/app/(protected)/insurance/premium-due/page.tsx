'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { CalendarClock, CheckCircle2, Download, RefreshCw, RotateCw } from 'lucide-react';
import { format, getYear } from 'date-fns';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { InsurancePolicy } from '@/lib/types';
import {
  dueState,
  formatDay,
  formatInr,
  graceDays,
  isPersonalInForce,
  personalPolicyState,
  policyFrequency,
  relativeDays,
  toDate,
  type DueState,
} from '@/lib/insurance';
import { PERSONAL_POLICIES } from '@/lib/insurance-service';
import { exportRowsToExcel } from '@/lib/report-excel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { RenewalDialog } from '@/components/insurance/RenewalDialog';
import { AccessDenied } from '@/components/insurance/insurance-ui';
import { cn } from '@/lib/utils';

const STATE_META: Record<DueState, { label: string; tone: StatusTone; text: string }> = {
  lapsed:     { label: 'Lapsed',   tone: 'danger',  text: 'text-red-600' },
  grace:      { label: 'In Grace', tone: 'warning', text: 'text-orange-600' },
  'due-soon': { label: 'Due Soon', tone: 'warning', text: 'text-amber-600' },
  upcoming:   { label: 'Upcoming', tone: 'info',    text: '' },
};
const ORDER: Record<DueState, number> = { lapsed: 0, grace: 1, 'due-soon': 2, upcoming: 3 };

type Row = InsurancePolicy & { _due: Date; _state: DueState; _grace: number };

export default function PremiumDuePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Insurance.Personal Insurance') || can('View', 'Insurance.Premium Due');
  const canRenew = can('Renew', 'Insurance.Personal Insurance');

  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [stateFilter, setStateFilter] = useState<DueState | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedPolicy, setSelectedPolicy] = useState<InsurancePolicy | null>(null);
  const [isRenewOpen, setIsRenewOpen] = useState(false);

  const fetchPolicies = useCallback(async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, PERSONAL_POLICIES));
      setPolicies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InsurancePolicy)));
    } catch (err) {
      console.error('Error fetching policies:', err);
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

  // Only premiums someone can still pay: policies in force, not matured, with a due date.
  const enriched = useMemo<Row[]>(() => {
    const now = new Date();
    return policies.flatMap((p) => {
      const due = toDate(p.due_date);
      if (!due || !isPersonalInForce(p) || personalPolicyState(p, now) === 'matured') return [];
      const grace = graceDays(policyFrequency(p), p.grace_period_days);
      return [{ ...p, _due: due, _grace: grace, _state: dueState(due, now, grace) }];
    });
  }, [policies]);

  const yearOptions = useMemo(
    () => Array.from(new Set(enriched.map((p) => getYear(p._due)))).sort((a, b) => b - a).map(String),
    [enriched],
  );
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: format(new Date(2000, i, 1), 'MMMM') }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched
      .filter((p) => stateFilter === 'all' || p._state === stateFilter)
      .filter((p) => selectedYear === 'all' || String(getYear(p._due)) === selectedYear)
      .filter((p) => selectedMonth === 'all' || String(p._due.getMonth()) === selectedMonth)
      .filter((p) => !q || [p.insured_person, p.policy_no, p.insurance_company].some((v) => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => ORDER[a._state] - ORDER[b._state] || a._due.getTime() - b._due.getTime());
  }, [enriched, stateFilter, selectedYear, selectedMonth, search]);

  const stats = useMemo(() => {
    const of = (s: DueState) => enriched.filter((p) => p._state === s);
    const sum = (rows: Row[]) => rows.reduce((t, p) => t + (p.premium || 0), 0);
    return {
      lapsed: of('lapsed').length,
      grace: of('grace').length,
      dueSoon: of('due-soon').length,
      upcoming: of('upcoming').length,
      actionAmount: sum([...of('lapsed'), ...of('grace'), ...of('due-soon')]),
    };
  }, [enriched]);

  const exportList = () =>
    exportRowsToExcel('Premium Due', filtered.map((p) => ({
      'Policy Holder': p.insured_person,
      'Policy No.': p.policy_no,
      Company: p.insurance_company,
      Frequency: p.payment_type,
      Premium: p.premium || 0,
      'Due Date': formatDay(p._due),
      'Grace Until': formatDay(new Date(p._due.getTime() + p._grace * 86_400_000)),
      Status: STATE_META[p._state].label,
      'Auto Debit': p.auto_debit ? 'Yes' : 'No',
    })));

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (!canView) return <AccessDenied what="view premiums due" />;

  const openRenew = (policy: InsurancePolicy) => { setSelectedPolicy(policy); setIsRenewOpen(true); };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={CalendarClock}
        title="Premium Due"
        description="Unpaid personal premiums — lapsed, in grace, and due in the next 30 days first"
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
        <CardContent className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-5">
          {([
            { label: 'Lapsed',    value: stats.lapsed,   key: 'lapsed',   color: 'text-red-600' },
            { label: 'In Grace',  value: stats.grace,    key: 'grace',    color: 'text-orange-600' },
            { label: 'Due in 30d', value: stats.dueSoon, key: 'due-soon', color: 'text-amber-600' },
            { label: 'Upcoming',  value: stats.upcoming, key: 'upcoming', color: 'text-slate-600' },
          ] as const).map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={stateFilter === s.key}
              onClick={() => setStateFilter(stateFilter === s.key ? 'all' : s.key)}
              className={cn('flex flex-col items-center rounded-lg py-2 transition-all', stateFilter === s.key ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/50')}
            >
              <span className={cn('text-2xl font-bold leading-tight', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </button>
          ))}
          <div className="col-span-2 flex flex-col items-center rounded-lg py-2 sm:col-span-1">
            <span className="text-base font-bold leading-tight text-rose-600">{formatInr(stats.actionAmount)}</span>
            <span className="text-[11px] text-muted-foreground">Needs action</span>
          </div>
        </CardContent>
      </Card>

      <TableCard
        title="Premium schedule"
        icon={CalendarClock}
        count={filtered.length}
        total={enriched.length}
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Search holder, policy, company…' }}
            activeCount={(selectedYear !== 'all' ? 1 : 0) + (selectedMonth !== 'all' ? 1 : 0) + (stateFilter !== 'all' ? 1 : 0)}
            onClear={() => { setSearch(''); setSelectedYear('all'); setSelectedMonth('all'); setStateFilter('all'); }}
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
          </FilterBar>
        }
      >
        {/* Mobile cards */}
        <div className="space-y-2 p-3 sm:hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center"><CheckCircle2 className="h-10 w-10 text-emerald-400" /><p className="text-sm text-muted-foreground">No premiums match your filters.</p></div>
          ) : filtered.map((policy) => {
            const meta = STATE_META[policy._state];
            return (
              <Card key={policy.id} className={cn('cursor-pointer overflow-hidden border-border/60', policy._state === 'lapsed' && 'ring-1 ring-red-200')} onClick={() => router.push(`/insurance/personal/${policy.id}`)}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{policy.insured_person}</p><p className="truncate font-mono text-xs text-muted-foreground">{policy.policy_no}</p></div>
                    <StatusBadge status={meta.label} tone={meta.tone} className="shrink-0" />
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div className="min-w-0 truncate"><span className="text-muted-foreground">Company: </span>{policy.insurance_company}</div>
                    <div><span className="text-muted-foreground">Premium: </span><span className="font-medium">{formatInr(policy.premium)}</span></div>
                    <div className="col-span-2"><span className="text-muted-foreground">Due: </span><span className={cn('font-medium', meta.text)}>{formatDay(policy._due)} ({relativeDays(policy._due)})</span></div>
                  </div>
                  {canRenew && (
                    <Button size="sm" className="h-8 w-full gap-1.5" onClick={(e) => { e.stopPropagation(); openRenew(policy); }}>
                      <RotateCw className="h-3.5 w-3.5" /> Record Payment
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
              <TableHead>Frequency</TableHead>
              <TableHead className="text-right">Premium</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Status</TableHead>
              {canRenew && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="h-32 text-center"><div className="flex flex-col items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-8 w-8 text-emerald-400" /><span className="text-sm">No premiums match your filters.</span></div></TableCell></TableRow>
            ) : filtered.map((policy) => {
              const meta = STATE_META[policy._state];
              const urgent = policy._state !== 'upcoming';
              return (
                <TableRow key={policy.id} onClick={() => router.push(`/insurance/personal/${policy.id}`)} className="cursor-pointer">
                  <TableCell className="font-medium">{policy.insured_person}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono">{policy.policy_no}</TableCell>
                  <TableCell>{policy.insurance_company}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{policy.payment_type}</Badge>
                    {policy.auto_debit && <span className="ml-1 text-[10px] text-muted-foreground">auto-debit</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(policy.premium)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="space-y-0.5">
                      <p className={cn('font-medium', meta.text)}>{formatDay(policy._due)}</p>
                      <p className="text-[11px] text-muted-foreground">{relativeDays(policy._due)}</p>
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge status={meta.label} tone={meta.tone} /></TableCell>
                  {canRenew && (
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={urgent ? 'default' : 'ghost'}
                        className={cn('h-7 gap-1 text-xs', urgent && 'bg-amber-500 text-white hover:bg-amber-600')}
                        onClick={(e) => { e.stopPropagation(); openRenew(policy); }}
                      >
                        <RotateCw className="h-3 w-3" /> {urgent ? 'Pay' : 'Pay early'}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableCard>

      {selectedPolicy && canRenew && (
        <RenewalDialog isOpen={isRenewOpen} onOpenChange={setIsRenewOpen} policy={selectedPolicy} onSuccess={fetchPolicies} />
      )}
    </div>
  );
}
