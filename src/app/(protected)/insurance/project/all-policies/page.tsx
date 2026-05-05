
'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Files,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { addDays, format, isPast, isWithinInterval } from 'date-fns';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import type { ProjectInsurancePolicy, ProjectPolicyRenewal } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { cls: string }> = {
  Active:       { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  Expired:      { cls: 'bg-red-100 text-red-700 border-red-200' },
  'Not Required': { cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  Close:        { cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

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
      const snap = await getDocs(query(collection(db, 'project_insurance_policies'), orderBy('insurance_start_date', 'desc')));
      const loaded = await Promise.all(snap.docs.map(async (d) => {
        const policy = { id: d.id, ...d.data() } as ProjectInsurancePolicy;
        const hSnap = await getDocs(collection(db, 'project_insurance_policies', d.id, 'history'));
        const history = hSnap.docs.map((hd) => ({ id: hd.id, ...hd.data() } as ProjectPolicyRenewal));
        history.sort((a, b) => b.renewalDate.toMillis() - a.renewalDate.toMillis());
        return { ...policy, history };
      }));
      setPolicies(loaded);
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
    statuses:   [...new Set(policies.map((p) => p.status))].sort(),
  }), [policies]);

  const filtered = useMemo(() => {
    const { search, assetName, insuranceCompany, policyCategory, status } = filters;
    return policies.filter((p) => {
      if (search && !p.policy_no.toLowerCase().includes(search.toLowerCase()) && !p.assetName.toLowerCase().includes(search.toLowerCase())) return false;
      if (assetName !== 'all' && p.assetName !== assetName) return false;
      if (insuranceCompany !== 'all' && p.insurance_company !== insuranceCompany) return false;
      if (policyCategory !== 'all' && p.policy_category !== policyCategory) return false;
      if (status !== 'all' && p.status !== status) return false;
      return true;
    });
  }, [policies, filters]);

  const setFilter = (k: keyof typeof filters, v: string) => setFilters((p) => ({ ...p, [k]: v }));
  const hasFilters = Object.entries(filters).some(([, v]) => v !== '' && v !== 'all');

  if (isAuthLoading || (isLoading && canViewPage)) {
    return <div className="space-y-4"><Skeleton className="h-28 w-full rounded-xl" /><Skeleton className="h-64 w-full rounded-xl" /></div>;
  }

  if (!canViewPage) {
    return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied</CardTitle><CardDescription>You do not have permission to view project insurance policies.</CardDescription></CardHeader></Card>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-teal-500 via-cyan-500 to-sky-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 ring-1 ring-teal-100">
              <Files className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <CardTitle className="tracking-tight">All Project Policies</CardTitle>
              <CardDescription>Consolidated view of {policies.length} project insurance policies</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchPolicies} className="gap-1.5 w-fit">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </CardHeader>
      </Card>

      {/* Filters */}
      <Card className="border-border/60">
        <CardContent className="p-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={filters.search} onChange={(e) => setFilter('search', e.target.value)} placeholder="Search policy no. or asset…" className="pl-8 h-9 text-sm" />
            {filters.search && <button onClick={() => setFilter('search', '')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="h-3.5 w-3.5" /></button>}
          </div>
          {([['assetName', 'All Assets', filterOptions.assetNames], ['insuranceCompany', 'All Companies', filterOptions.companies], ['policyCategory', 'All Categories', filterOptions.categories]] as const).map(([key, placeholder, opts]) => (
            <Select key={key} value={filters[key]} onValueChange={(v) => setFilter(key, v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={placeholder} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{placeholder}</SelectItem>
                {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          ))}
        </CardContent>
        {hasFilters && (
          <div className="px-3 pb-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{filtered.length} of {policies.length} shown</span>
            <button onClick={() => setFilters({ search: '', assetName: 'all', insuranceCompany: 'all', policyCategory: 'all', status: 'all' })} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ml-auto"><X className="h-3 w-3" /> Clear filters</button>
          </div>
        )}
      </Card>

      {/* Table */}
      <Card className="overflow-hidden border-border/60">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
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
                const statusCfg = STATUS_CFG[policy.status] ?? { cls: 'bg-slate-100 text-slate-600' };
                const expiryDate = policy.insured_until?.toDate?.();
                const isExpiredOrExpiring = expiryDate && (isPast(expiryDate) || isWithinInterval(expiryDate, { start: new Date(), end: addDays(new Date(), 30) }));
                return (
                  <Fragment key={policy.id}>
                    <TableRow
                      className={cn('cursor-pointer transition-colors', isExpiredOrExpiring ? 'hover:bg-red-50/30' : 'hover:bg-muted/20')}
                      onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-toggle]')) router.push(`/insurance/project/${policy.assetId}`); }}
                    >
                      <TableCell className="px-2" data-toggle>
                        <Button size="icon" variant="ghost" className="h-7 w-7" data-toggle onClick={(e) => { e.stopPropagation(); toggleRow(policy.id); }}>
                          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{policy.assetName}</TableCell>
                      <TableCell>{policy.policy_category}</TableCell>
                      <TableCell className="font-mono text-xs">{policy.policy_no}</TableCell>
                      <TableCell>{policy.insurance_company}</TableCell>
                      <TableCell>{fmtCur(policy.premium)}</TableCell>
                      <TableCell>{fmtCur(policy.sum_insured)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(policy.insurance_start_date)}</TableCell>
                      <TableCell className={cn('text-sm font-medium', isExpiredOrExpiring ? 'text-red-600' : '')}>{fmtDate(policy.insured_until)}</TableCell>
                      <TableCell><Badge variant="outline" className={cn('text-[10px]', statusCfg.cls)}>{policy.status}</Badge></TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={10} className="p-0">
                          <div className="p-4 border-t border-border/40">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Renewal History</p>
                            {policy.history.length === 0 ? (
                              <p className="text-sm text-muted-foreground text-center py-4">No renewal history for this policy.</p>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/50">
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
                                      <TableCell className="text-sm">{fmtDate(h.renewalDate)}</TableCell>
                                      <TableCell className="font-mono text-xs">{h.policyNo}</TableCell>
                                      <TableCell>{fmtCur(h.premium)}</TableCell>
                                      <TableCell>{fmtCur(h.sumInsured)}</TableCell>
                                      <TableCell className="text-sm">{fmtDate(h.startDate)} — {fmtDate(h.endDate)}</TableCell>
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
        </div>
      </Card>
    </div>
  );
}
