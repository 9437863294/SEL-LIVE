
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  MoreHorizontal,
  RefreshCw,
  RotateCw,
  Search,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import { addDays, format, isPast, isWithinInterval } from 'date-fns';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import type { ProjectInsurancePolicy } from '@/lib/types';
import { ProjectRenewalDialog } from '@/components/ProjectRenewalDialog';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

type ProjStatus = 'expired' | 'expiring' | 'active';

function getProjStatus(insuredUntil: any): ProjStatus {
  if (!insuredUntil) return 'active';
  const d = insuredUntil.toDate?.() ?? new Date(insuredUntil);
  if (isPast(d)) return 'expired';
  if (isWithinInterval(d, { start: new Date(), end: addDays(new Date(), 30) })) return 'expiring';
  return 'active';
}

const STATUS_CFG: Record<ProjStatus, { label: string; badgeCls: string; rowCls: string; dot: string }> = {
  expired:  { label: 'Expired',      badgeCls: 'bg-red-100 text-red-700 border-red-200',    rowCls: 'hover:bg-red-50/30',    dot: 'bg-red-500' },
  expiring: { label: 'Expires Soon', badgeCls: 'bg-amber-100 text-amber-700 border-amber-200', rowCls: 'hover:bg-amber-50/30', dot: 'bg-amber-400' },
  active:   { label: 'Active',       badgeCls: 'bg-emerald-100 text-emerald-700 border-emerald-200', rowCls: 'hover:bg-muted/20',   dot: 'bg-emerald-400' },
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
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-orange-500 to-red-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 ring-1 ring-amber-100">
              <CalendarClock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <CardTitle className="tracking-tight">Project Premium Due</CardTitle>
              <CardDescription>Active project policies — expiry and renewal tracking</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchPolicies} className="gap-1.5 w-fit">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 border-t pt-4">
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

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, policy no., company…" className="pl-8 h-9 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} policies</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden border-border/60">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-6" />
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
                  <TableCell colSpan={9} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                      <span className="text-sm">No active policies with upcoming due dates.</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.map((policy) => {
                const cfg = STATUS_CFG[policy._status];
                const canAct = policy._status === 'expired' || policy._status === 'expiring';
                const expiryDate = policy.insured_until?.toDate?.() ?? null;
                const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / 86400000) : null;
                return (
                  <TableRow key={policy.id} onClick={() => router.push(`/insurance/project/${policy.assetId}`)} className={cn('cursor-pointer transition-colors', cfg.rowCls)}>
                    <TableCell className="pr-0"><div className={cn('h-2 w-2 rounded-full mx-auto', cfg.dot)} /></TableCell>
                    <TableCell className="font-medium">{policy.assetName}</TableCell>
                    <TableCell className="font-mono text-xs">{policy.policy_no}</TableCell>
                    <TableCell>{policy.policy_category}</TableCell>
                    <TableCell>{policy.insurance_company}</TableCell>
                    <TableCell className="font-semibold">{fmtCur(policy.premium)}</TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className={cn('text-sm font-medium', policy._status === 'expired' ? 'text-red-600' : policy._status === 'expiring' ? 'text-amber-600' : '')}>{fmtDate(policy.insured_until)}</p>
                        {daysLeft !== null && Math.abs(daysLeft) <= 30 && (
                          <p className="text-[11px] text-muted-foreground">{daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className={cn('text-[10px]', cfg.badgeCls)}>{cfg.label}</Badge></TableCell>
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
        </div>
      </Card>

      {renewPolicy && (
        <ProjectRenewalDialog isOpen={!!renewPolicy} onOpenChange={(open) => { if (!open) setRenewPolicy(null); }} policy={renewPolicy} onSuccess={() => { setRenewPolicy(null); fetchPolicies(); }} />
      )}
    </div>
  );
}
