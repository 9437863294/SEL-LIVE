'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { CalendarClock, Download, Edit, History, Plus, Shield } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import type { InsurancePolicy } from '@/lib/types';
import {
  annualisedPremium,
  formatDay,
  formatInr,
  personalPolicyState,
  PERSONAL_STATE_LABEL,
  policyFrequency,
  relativeDays,
  toDate,
  type PersonalPolicyState,
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
import { AccessDenied, PersonalStateBadge } from '@/components/insurance/insurance-ui';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Filter buckets; the four retired lifecycles share one so the strip stays readable. */
type Bucket = 'all' | 'lapsed' | 'grace' | 'due-soon' | 'active' | 'matured' | 'inactive';

const bucketOf = (s: PersonalPolicyState): Exclude<Bucket, 'all'> =>
  s === 'paid-up' || s === 'surrendered' || s === 'claimed' || s === 'closed' ? 'inactive' : s;

/** Most urgent first; within a bucket, soonest due first. */
const URGENCY: Record<PersonalPolicyState, number> = {
  lapsed: 0, grace: 1, 'due-soon': 2, active: 3, matured: 4, 'paid-up': 5, claimed: 6, surrendered: 7, closed: 8,
};

type Row = InsurancePolicy & { _state: PersonalPolicyState; _due: Date | null };

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
  const [bucket, setBucket] = useState<Bucket>('all');
  const [company, setCompany] = useState('all');
  const [category, setCategory] = useState('all');

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
    if (canViewPage) fetchPolicies();
    else setIsLoading(false);
  }, [authLoading, canViewPage, fetchPolicies]);

  // ─── computed ─────────────────────────────────────────────────────────────

  const enriched = useMemo<Row[]>(() => {
    const now = new Date();
    return policies.map((p) => ({ ...p, _state: personalPolicyState(p, now), _due: toDate(p.due_date) }));
  }, [policies]);

  const companies = useMemo(() => Array.from(new Set(policies.map((p) => p.insurance_company).filter(Boolean))).sort(), [policies]);
  const categories = useMemo(() => Array.from(new Set(policies.map((p) => p.policy_category).filter(Boolean))).sort(), [policies]);

  const stats = useMemo(() => {
    const count = (b: Bucket) => enriched.filter((p) => bucketOf(p._state) === b).length;
    const inForce = enriched.filter((p) => ['active', 'due-soon', 'grace'].includes(p._state));
    return {
      total: enriched.length,
      active: count('active'),
      dueSoon: count('due-soon'),
      grace: count('grace'),
      lapsed: count('lapsed'),
      matured: count('matured'),
      inactive: count('inactive'),
      cover: inForce.reduce((s, p) => s + (p.sum_insured || 0), 0),
      yearly: inForce.reduce((s, p) => s + annualisedPremium(p.premium, policyFrequency(p)), 0),
    };
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched
      .filter((p) => bucket === 'all' || bucketOf(p._state) === bucket)
      .filter((p) => company === 'all' || p.insurance_company === company)
      .filter((p) => category === 'all' || p.policy_category === category)
      .filter((p) => !q || [p.insured_person, p.policy_no, p.insurance_company, p.policy_name, p.nominee_name, p.agent_name]
        .some((v) => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => URGENCY[a._state] - URGENCY[b._state] || (a._due?.getTime() ?? Infinity) - (b._due?.getTime() ?? Infinity));
  }, [enriched, bucket, company, category, search]);

  const exportRegister = () =>
    exportRowsToExcel('Personal Insurance Register', filtered.map((p) => ({
      'Policy Holder': p.insured_person,
      'Policy No.': p.policy_no,
      Company: p.insurance_company,
      Category: p.policy_category,
      Plan: p.policy_name,
      Status: PERSONAL_STATE_LABEL[p._state],
      Frequency: p.payment_type,
      Premium: p.premium || 0,
      'Yearly Outgo': annualisedPremium(p.premium, policyFrequency(p)),
      'Sum Assured': p.sum_insured || 0,
      'Next Due': p._due ? formatDay(p._due) : '',
      Commencement: toDate(p.date_of_comm) ? formatDay(p.date_of_comm) : '',
      Maturity: toDate(p.date_of_maturity) ? formatDay(p.date_of_maturity) : '',
      'Term (yrs)': p.tenure || '',
      'Auto Debit': p.auto_debit ? 'Yes' : 'No',
      Nominee: p.nominee_name || '',
      Advisor: p.agent_name || '',
    })));

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

  if (!canViewPage) return <AccessDenied what="view personal insurance policies" />;

  const activeFilters = (bucket !== 'all' ? 1 : 0) + (company !== 'all' ? 1 : 0) + (category !== 'all' ? 1 : 0);

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Shield}
        title="Personal Insurance"
        description={`${stats.total} policies · ${formatInr(stats.cover)} cover in force · ${formatInr(stats.yearly)} yearly premium`}
        actions={
          <>
            <Link href="/insurance/personal/history">
              <Button variant="outline" size="sm" className="w-full gap-1.5"><History className="h-3.5 w-3.5" /> History</Button>
            </Link>
            <Link href="/insurance/premium-due">
              <Button variant="outline" size="sm" className="w-full gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> Premium Due</Button>
            </Link>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportRegister} disabled={filtered.length === 0}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            {canAdd && (
              <Link href="/insurance/personal/new">
                <Button size="sm" className="w-full gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"><Plus className="h-3.5 w-3.5" /> Add Policy</Button>
              </Link>
            )}
          </>
        }
      />

      {/* ── Stats strip — each figure filters the register ─────────────────── */}
      <Card className="overflow-hidden border-border/60">
        <CardContent className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-7">
          {([
            { label: 'Total',    value: stats.total,    key: 'all',      color: 'text-slate-700' },
            { label: 'Active',   value: stats.active,   key: 'active',   color: 'text-emerald-600' },
            { label: 'Due Soon', value: stats.dueSoon,  key: 'due-soon', color: 'text-amber-600' },
            { label: 'In Grace', value: stats.grace,    key: 'grace',    color: 'text-orange-600' },
            { label: 'Lapsed',   value: stats.lapsed,   key: 'lapsed',   color: 'text-red-600' },
            { label: 'Matured',  value: stats.matured,  key: 'matured',  color: 'text-slate-500' },
            { label: 'Inactive', value: stats.inactive, key: 'inactive', color: 'text-slate-400' },
          ] as const).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setBucket(bucket === s.key ? 'all' : s.key)}
              aria-pressed={bucket === s.key}
              className={cn(
                'flex flex-col items-center justify-center rounded-lg px-1 py-2 text-center transition-all',
                bucket === s.key ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/50',
              )}
            >
              <span className={cn('text-xl font-bold leading-tight', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      <TableCard
        title="Policies"
        icon={Shield}
        count={filtered.length}
        total={enriched.length}
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Search holder, policy no, nominee, advisor…' }}
            activeCount={activeFilters}
            onClear={() => { setSearch(''); setBucket('all'); setCompany('all'); setCategory('all'); }}
          >
            <Select value={bucket} onValueChange={(v) => setBucket(v as Bucket)}>
              <SelectTrigger aria-label="Status"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="lapsed">Lapsed</SelectItem>
                <SelectItem value="grace">In Grace</SelectItem>
                <SelectItem value="due-soon">Due Soon</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="matured">Matured</SelectItem>
                <SelectItem value="inactive">Paid-Up / Surrendered / Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={company} onValueChange={setCompany}>
              <SelectTrigger aria-label="Company"><SelectValue placeholder="All Companies" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Category"><SelectValue placeholder="All Categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        {/* Mobile cards */}
        <div className="space-y-2 p-3 sm:hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Shield className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No policies match your filters.</p>
            </div>
          ) : (
            filtered.map((policy) => (
              <Card
                key={policy.id}
                className="cursor-pointer overflow-hidden border-border/60 transition-all hover:-translate-y-0.5 hover:shadow-sm"
                onClick={() => router.push(`/insurance/personal/${policy.id}`)}
              >
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{policy.insured_person}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{policy.policy_no}</p>
                    </div>
                    <PersonalStateBadge state={policy._state} className="shrink-0" />
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div className="min-w-0 truncate"><span className="text-muted-foreground">Company: </span>{policy.insurance_company}</div>
                    <div><span className="text-muted-foreground">Premium: </span>{formatInr(policy.premium)}</div>
                    <div><span className="text-muted-foreground">Due: </span>{formatDay(policy._due)}</div>
                    <div><span className="text-muted-foreground">Maturity: </span>{formatDay(policy.date_of_maturity)}</div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Desktop table */}
        <Table containerClassName="hidden sm:block">
          <TableHeader>
            <TableRow>
              <TableHead>Policy Holder</TableHead>
              <TableHead>Policy No.</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Frequency</TableHead>
              <TableHead className="text-right">Premium</TableHead>
              <TableHead>Next Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Maturity</TableHead>
              <TableHead className="text-right">Sum Assured</TableHead>
              {canEdit && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Shield className="h-8 w-8 opacity-30" />
                    <span className="text-sm">No policies match your filters.</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((policy) => (
                <TableRow key={policy.id} onClick={() => router.push(`/insurance/personal/${policy.id}`)} className="cursor-pointer">
                  <TableCell className="font-medium">{policy.insured_person}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono">{policy.policy_no}</TableCell>
                  <TableCell>{policy.insurance_company}</TableCell>
                  <TableCell className="max-w-[160px] truncate" title={policy.policy_name}>{policy.policy_name}</TableCell>
                  <TableCell><Badge variant="outline">{policy.payment_type}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(policy.premium)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {policy._due ? (
                      <div className="space-y-0.5">
                        <p>{formatDay(policy._due)}</p>
                        {['due-soon', 'grace', 'lapsed'].includes(policy._state) && (
                          <p className="text-[11px] text-muted-foreground">{relativeDays(policy._due)}</p>
                        )}
                      </div>
                    ) : '—'}
                  </TableCell>
                  <TableCell><PersonalStateBadge state={policy._state} /></TableCell>
                  <TableCell className="whitespace-nowrap">{formatDay(policy.date_of_maturity)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(policy.sum_insured)}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Link href={`/insurance/personal/edit/${policy.id}`} onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"><Edit className="h-3 w-3" /> Edit</Button>
                      </Link>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
