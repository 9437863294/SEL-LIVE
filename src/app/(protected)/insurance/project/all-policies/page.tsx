
'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Files,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { format } from 'date-fns';
import { collection, getDocs } from 'firebase/firestore';
import { PROJECT_STATE_LABEL, projectPolicyState, toDate } from '@/lib/insurance';
import { ProjectStateBadge } from '@/components/insurance/insurance-ui';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import type { ProjectInsurancePolicy, ProjectPolicyRenewal } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtCur = (n: number) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
    : 'N/A';

const fmtDate = (v: any) => {
  if (!v) return '—';
  const d = v.toDate ? v.toDate() : new Date(v);
  return format(d, 'dd MMM yy');
};

interface EnrichedPolicy extends ProjectInsurancePolicy {
  history: ProjectPolicyRenewal[];
  _state: ReturnType<typeof projectPolicyState>;
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AllProjectPoliciesPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [policies, setPolicies] = useState<EnrichedPolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({ search: '', assetName: 'all', insuranceCompany: 'all', policyCategory: 'all', status: 'all' });

  const canViewPage = can('View', 'Insurance.Project Insurance');

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      // Sorted here, not by orderBy: Firestore drops documents that lack the ordered field.
      const snap = await getDocs(collection(db, 'project_insurance_policies'));
      const now = new Date();
      const loaded = await Promise.all(snap.docs.map(async (d) => {
        const policy = { id: d.id, ...d.data() } as ProjectInsurancePolicy;
        const hSnap = await getDocs(collection(db, 'project_insurance_policies', d.id, 'history'));
        const history = hSnap.docs.map((hd) => ({ id: hd.id, ...hd.data() } as ProjectPolicyRenewal));
        history.sort((a, b) => (toDate(b.renewalDate)?.getTime() ?? 0) - (toDate(a.renewalDate)?.getTime() ?? 0));
        return { ...policy, history, _state: projectPolicyState(policy, now) };
      }));
      setPolicies(loaded.sort((a, b) => (toDate(b.insurance_start_date)?.getTime() ?? 0) - (toDate(a.insurance_start_date)?.getTime() ?? 0)));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthLoading) { if (canViewPage) fetchPolicies(); else setIsLoading(false); }
  }, [isAuthLoading, canViewPage]); // eslint-disable-line

  const toggleRow = (id: string) =>
    setExpandedRows((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const filterOptions = useMemo(() => ({
    assetNames: [...new Set(policies.map((p) => p.assetName))].sort(),
    companies:  [...new Set(policies.map((p) => p.insurance_company))].sort(),
    categories: [...new Set(policies.map((p) => p.policy_category))].sort(),
    statuses:   [...new Set(policies.map((p) => PROJECT_STATE_LABEL[p._state]))].sort(),
  }), [policies]);

  const filtered = useMemo(() => {
    const { search, assetName, insuranceCompany, policyCategory, status } = filters;
    return policies.filter((p) => {
      if (search && !p.policy_no.toLowerCase().includes(search.toLowerCase()) && !p.assetName.toLowerCase().includes(search.toLowerCase())) return false;
      if (assetName !== 'all' && p.assetName !== assetName) return false;
      if (insuranceCompany !== 'all' && p.insurance_company !== insuranceCompany) return false;
      if (policyCategory !== 'all' && p.policy_category !== policyCategory) return false;
      if (status !== 'all' && PROJECT_STATE_LABEL[p._state] !== status) return false;
      return true;
    });
  }, [policies, filters]);

  const setFilter = (k: keyof typeof filters, v: string) => setFilters((p) => ({ ...p, [k]: v }));
  const activeFilterCount = Object.entries(filters).filter(([k, v]) => k !== 'search' && v !== 'all').length;

  if (isAuthLoading || (isLoading && canViewPage)) {
    return <div className="space-y-4"><Skeleton className="h-28 w-full rounded-xl" /><Skeleton className="h-64 w-full rounded-xl" /></div>;
  }

  if (!canViewPage) {
    return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied</CardTitle><CardDescription>You do not have permission to view project insurance policies.</CardDescription></CardHeader></Card>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        icon={Files}
        title="All Project Policies"
        description={`Consolidated view of ${policies.length} project insurance policies`}
        actions={
          <Button variant="outline" size="sm" onClick={fetchPolicies} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      {/* Table */}
      <TableCard
        title="Project policies"
        icon={Files}
        count={filtered.length}
        total={policies.length}
        toolbar={
          <FilterBar
            search={{ value: filters.search, onChange: (v) => setFilter('search', v), placeholder: 'Search policy no. or asset…' }}
            activeCount={activeFilterCount}
            onClear={() => setFilters({ search: '', assetName: 'all', insuranceCompany: 'all', policyCategory: 'all', status: 'all' })}
          >
            {([['assetName', 'All Assets', filterOptions.assetNames], ['insuranceCompany', 'All Companies', filterOptions.companies], ['policyCategory', 'All Categories', filterOptions.categories]] as const).map(([key, placeholder, opts]) => (
              <Select key={key} value={filters[key]} onValueChange={(v) => setFilter(key, v)}>
                <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{placeholder}</SelectItem>
                  {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            ))}
          </FilterBar>
        }
      >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Asset Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Sum Insured</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>Insured Until</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="h-32 text-center text-muted-foreground">No policies match your filters.</TableCell></TableRow>
              ) : filtered.map((policy) => {
                const expanded = expandedRows.has(policy.id);
                const isExpiredOrExpiring = policy._state === 'expired' || policy._state === 'expiring';
                return (
                  <Fragment key={policy.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-toggle]')) router.push(`/insurance/project/${policy.assetId}`); }}
                    >
                      <TableCell data-toggle>
                        <Button size="icon" variant="ghost" className="h-7 w-7" data-toggle onClick={(e) => { e.stopPropagation(); toggleRow(policy.id); }}>
                          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{policy.assetName}</TableCell>
                      <TableCell>{policy.policy_category}</TableCell>
                      <TableCell className="font-mono whitespace-nowrap">{policy.policy_no}</TableCell>
                      <TableCell>{policy.insurance_company}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{fmtCur(policy.premium)}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{fmtCur(policy.sum_insured)}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(policy.insurance_start_date)}</TableCell>
                      <TableCell className={cn('whitespace-nowrap', isExpiredOrExpiring && 'font-medium text-red-600')}>{fmtDate(policy.insured_until)}</TableCell>
                      <TableCell><ProjectStateBadge state={policy._state} /></TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow>
                        <TableCell colSpan={10} className="p-0">
                          <div className="p-4 border-t border-border/40">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Renewal History</p>
                            {policy.history.length === 0 ? (
                              <p className="text-sm text-muted-foreground text-center py-4">No renewal history for this policy.</p>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Renewal Date</TableHead>
                                    <TableHead>Policy No.</TableHead>
                                    <TableHead>Premium</TableHead>
                                    <TableHead>Sum Insured</TableHead>
                                    <TableHead>Period</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {policy.history.map((h) => (
                                    <TableRow key={h.id}>
                                      <TableCell className="whitespace-nowrap">{fmtDate(h.renewalDate)}</TableCell>
                                      <TableCell className="font-mono whitespace-nowrap">{h.policyNo}</TableCell>
                                      <TableCell className="whitespace-nowrap tabular-nums">{fmtCur(h.premium)}</TableCell>
                                      <TableCell className="whitespace-nowrap tabular-nums">{fmtCur(h.sumInsured)}</TableCell>
                                      <TableCell className="whitespace-nowrap">{fmtDate(h.startDate)} — {fmtDate(h.endDate)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
      </TableCard>
    </div>
  );
}
