
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  MoreHorizontal,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { projectPolicyState } from '@/lib/insurance';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import type { ProjectInsurancePolicy } from '@/lib/types';
import { ProjectRenewalDialog } from '@/components/insurance/ProjectRenewalDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { SearchInput } from '@/components/shared/filter-bar';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

type ProjStatus = 'expired' | 'expiring' | 'active';

// The shared rule: cover runs through its last day, so a policy is expired only from the day after.
function getProjStatus(insuredUntil: any): ProjStatus {
  const state = projectPolicyState({ status: 'Active', insured_until: insuredUntil });
  return state === 'expired' || state === 'expiring' ? state : 'active';
}

// The module's labels; "Expires Soon" is not in the shared vocabulary, so its tone is given.
const STATUS_BADGE: Record<ProjStatus, { label: string; tone?: StatusTone }> = {
  expired:  { label: 'Expired' },
  expiring: { label: 'Expires Soon', tone: 'warning' },
  active:   { label: 'Active' },
};

const fmtCur = (n: number) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
    : 'N/A';

const fmtDate = (v: any) => {
  if (!v) return '—';
  const d = v.toDate ? v.toDate() : new Date(v);
  return format(d, 'dd MMM yyyy');
};

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ProjectPremiumDuePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();

  const canViewPage      = can('View', 'Insurance.Project Insurance');
  const canRenewPolicy   = can('Renew', 'Insurance.Project Insurance');
  const canMarkNotReq    = can('Mark as Not Required', 'Insurance.Project Insurance');

  const [policies, setPolicies] = useState<ProjectInsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [renewPolicy, setRenewPolicy] = useState<ProjectInsurancePolicy | null>(null);

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'project_insurance_policies'));
      const active = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ProjectInsurancePolicy))
        .filter((p) => p.status === 'Active' && p.insured_until)
        .sort((a, b) => a.insured_until!.toDate().getTime() - b.insured_until!.toDate().getTime());
      setPolicies(active);
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading) { if (canViewPage) fetchPolicies(); else setIsLoading(false); }
  }, [authLoading, canViewPage]); // eslint-disable-line

  const handleMarkNotRequired = async (policyId: string) => {
    try {
      await updateDoc(doc(db, 'project_insurance_policies', policyId), { status: 'Not Required' });
      toast({ title: 'Updated', description: 'Policy marked as not required.' });
      fetchPolicies();
    } catch {
      toast({ title: 'Error', description: 'Failed to update policy.', variant: 'destructive' });
    }
  };

  const enriched = useMemo(() =>
    policies.map((p) => ({ ...p, _status: getProjStatus(p.insured_until) })),
  [policies]);

  const filtered = useMemo(() => {
    if (!search.trim()) return enriched;
    const q = search.toLowerCase();
    return enriched.filter(
      (p) => p.assetName.toLowerCase().includes(q) || p.policy_no.toLowerCase().includes(q) || p.insurance_company.toLowerCase().includes(q)
    );
  }, [enriched, search]);

  const stats = useMemo(() => ({
    expired:  enriched.filter((p) => p._status === 'expired').length,
    expiring: enriched.filter((p) => p._status === 'expiring').length,
    active:   enriched.filter((p) => p._status === 'active').length,
  }), [enriched]);

  if (authLoading || (isLoading && canViewPage)) {
    return <div className="space-y-4"><Skeleton className="h-28 w-full rounded-xl" /><Skeleton className="h-64 w-full rounded-xl" /></div>;
  }

  if (!canViewPage) {
    return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader></Card>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        icon={CalendarClock}
        title="Project Premium Due"
        description="Active project policies — expiry and renewal tracking"
        actions={
          <Button variant="outline" size="sm" onClick={fetchPolicies} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />
      <Card className="overflow-hidden border-border/60">
        <CardContent className="grid grid-cols-3 gap-2 p-4">
          {[
            { label: 'Expired',      value: stats.expired,  color: 'text-red-600' },
            { label: 'Expires Soon', value: stats.expiring, color: 'text-amber-600' },
            { label: 'Active',       value: stats.active,   color: 'text-emerald-600' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center rounded-lg py-2">
              <span className={cn('text-2xl font-bold', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Table */}
      <TableCard
        title="Active project policies"
        icon={CalendarClock}
        count={filtered.length}
        total={enriched.length}
        toolbar={<SearchInput value={search} onChange={setSearch} placeholder="Search asset, policy no., company…" className="sm:max-w-sm" />}
      >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset Name</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                      <span className="text-sm">No active policies with upcoming due dates.</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.map((policy) => {
                const badge = STATUS_BADGE[policy._status];
                const canAct = policy._status === 'expired' || policy._status === 'expiring';
                const expiryDate = policy.insured_until?.toDate?.() ?? null;
                const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / 86400000) : null;
                return (
                  <TableRow key={policy.id} onClick={() => router.push(`/insurance/project/${policy.assetId}`)} className="cursor-pointer">
                    <TableCell className="font-medium">{policy.assetName}</TableCell>
                    <TableCell className="font-mono whitespace-nowrap">{policy.policy_no}</TableCell>
                    <TableCell>{policy.policy_category}</TableCell>
                    <TableCell>{policy.insurance_company}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{fmtCur(policy.premium)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="space-y-0.5">
                        <p className={cn('font-medium', policy._status === 'expired' ? 'text-red-600' : policy._status === 'expiring' ? 'text-amber-600' : '')}>{fmtDate(policy.insured_until)}</p>
                        {daysLeft !== null && Math.abs(daysLeft) <= 30 && (
                          <p className="text-[11px] text-muted-foreground">{daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={badge.label} tone={badge.tone} /></TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <AlertDialog>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => { setRenewPolicy(policy); }} disabled={!canAct || !canRenewPolicy}>
                              <RotateCw className="mr-2 h-4 w-4 text-emerald-600" /> Renew
                            </DropdownMenuItem>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem className="text-destructive" disabled={!canAct || !canMarkNotReq}>
                                <XCircle className="mr-2 h-4 w-4" /> Not Required
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Mark as Not Required?</AlertDialogTitle>
                            <AlertDialogDescription>Policy <strong>{policy.policy_no}</strong> will be marked as not required and removed from this list.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleMarkNotRequired(policy.id)}>Confirm</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
      </TableCard>

      {renewPolicy && (
        <ProjectRenewalDialog isOpen={!!renewPolicy} onOpenChange={(open) => { if (!open) setRenewPolicy(null); }} policy={renewPolicy} onSuccess={() => { setRenewPolicy(null); fetchPolicies(); }} />
      )}
    </div>
  );
}
