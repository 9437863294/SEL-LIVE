
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Files,
  HardHat,
  History,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  X,
} from 'lucide-react';
import { addDays, isWithinInterval } from 'date-fns';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import type { InsuredAsset, Project, ProjectInsurancePolicy } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────

interface EnrichedAsset extends InsuredAsset {
  displayName: string;
  displayLocation: string;
  policyCount: number;
  activePolicies: number;
  expiredPolicies: number;
  expiringPolicies: number;
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ProjectInsurancePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();

  const canViewPage = can('View', 'Insurance.Project Insurance');
  const canAdd      = can('Add',  'Insurance.Project Insurance');

  const [assets, setAssets]     = useState<InsuredAsset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [policies, setPolicies] = useState<ProjectInsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch]     = useState('');

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [assetsSnap, projectsSnap, policiesSnap] = await Promise.all([
        getDocs(collection(db, 'insuredAssets')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'project_insurance_policies')),
      ]);
      setAssets(assetsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InsuredAsset)));
      setProjects(projectsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Project)));
      setPolicies(policiesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectInsurancePolicy)));
    } catch (err) {
      console.error('Error fetching project insurance:', err);
      toast({ title: 'Error', description: 'Failed to fetch project insurance data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (canViewPage) fetchData();
    else setIsLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canViewPage]);

  // ─── computed ─────────────────────────────────────────────────────────────

  const enrichedAssets = useMemo((): EnrichedAsset[] => {
    const today = new Date();
    return assets.map((asset) => {
      const proj = asset.type === 'Project' && asset.projectId
        ? projects.find((p) => p.id === asset.projectId)
        : null;

      const assetPolicies = policies.filter((p) => p.assetId === asset.id);
      const active   = assetPolicies.filter((p) => p.status === 'Active');
      const expired  = assetPolicies.filter((p) => p.status === 'Expired');
      const expiring = active.filter((p) => {
        const d = p.insured_until?.toDate?.();
        return d && isWithinInterval(d, { start: today, end: addDays(today, 30) });
      });

      return {
        ...asset,
        displayName:     proj?.projectName || asset.name,
        displayLocation: proj?.location || asset.location || '',
        policyCount:     assetPolicies.length,
        activePolicies:  active.length,
        expiredPolicies: expired.length,
        expiringPolicies: expiring.length,
      };
    });
  }, [assets, projects, policies]);

  const filteredAssets = useMemo(() => {
    if (!search.trim()) return enrichedAssets;
    const q = search.toLowerCase();
    return enrichedAssets.filter(
      (a) =>
        a.displayName.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        (a.displayLocation ?? '').toLowerCase().includes(q)
    );
  }, [enrichedAssets, search]);

  const totals = useMemo(() => ({
    assets:   enrichedAssets.length,
    active:   enrichedAssets.reduce((s, a) => s + a.activePolicies, 0),
    expiring: enrichedAssets.reduce((s, a) => s + a.expiringPolicies, 0),
    expired:  enrichedAssets.reduce((s, a) => s + a.expiredPolicies, 0),
  }), [enrichedAssets]);

  // ─── loading ──────────────────────────────────────────────────────────────

  if (authLoading || (isLoading && canViewPage)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied</CardTitle>
          <CardDescription>You do not have permission to view project insurance.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
              <HardHat className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="tracking-tight">Project Insurance</CardTitle>
              <CardDescription>Insurance coverage across projects and properties</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/insurance/project/history">
              <Button variant="outline" size="sm" className="gap-1.5">
                <History className="h-3.5 w-3.5" /> History
              </Button>
            </Link>
            <Link href="/insurance/project/all-policies">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Files className="h-3.5 w-3.5" /> All Policies
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            {canAdd && (
              <Link href="/insurance/project/new">
                <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Plus className="h-3.5 w-3.5" /> Add Policy
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>

        {/* Stats strip */}
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4 border-t pt-4">
          {[
            { label: 'Total Assets',      value: totals.assets,   color: 'text-slate-700' },
            { label: 'Active Policies',   value: totals.active,   color: 'text-emerald-600' },
            { label: 'Expiring (30d)',    value: totals.expiring, color: 'text-amber-600' },
            { label: 'Expired',           value: totals.expired,  color: 'text-red-600' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center rounded-lg py-2">
              <span className={cn('text-2xl font-bold', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Search ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search asset, type, location…"
            className="pl-8 h-9 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{filteredAssets.length} assets</span>
      </div>

      {/* ── Asset Cards Grid ──────────────────────────────────────────────── */}
      {filteredAssets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <HardHat className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm font-medium text-slate-600">
              {search ? 'No assets match your search.' : 'No insured assets yet.'}
            </p>
            {!search && canAdd && (
              <Link href="/insurance/project/new">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add First Policy
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAssets.map((asset) => {
            const hasAlert = asset.expiringPolicies > 0 || asset.expiredPolicies > 0;
            return (
              <Card
                key={asset.id}
                className={cn(
                  'group cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-md border-border/60',
                  hasAlert && 'ring-1 ring-amber-300'
                )}
                onClick={() => router.push(`/insurance/project/${asset.id}`)}
              >
                {/* Accent bar */}
                <div className={cn(
                  'h-1 w-full bg-gradient-to-r',
                  asset.expiredPolicies > 0   ? 'from-red-400 to-rose-500' :
                  asset.expiringPolicies > 0  ? 'from-amber-400 to-orange-400' :
                  asset.activePolicies > 0    ? 'from-emerald-400 to-teal-500' :
                  'from-slate-300 to-slate-400'
                )} />

                <CardContent className="p-4 space-y-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                        asset.type === 'Project' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                      )}>
                        {asset.type === 'Project' ? <HardHat className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-tight truncate">{asset.displayName}</p>
                        <Badge variant="outline" className="text-[10px] mt-0.5">{asset.type}</Badge>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors mt-1" />
                  </div>

                  {/* Location */}
                  {asset.displayLocation && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{asset.displayLocation}</span>
                    </div>
                  )}

                  {/* Policy stats */}
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/40">
                    <div className="text-center">
                      <p className="text-lg font-bold text-slate-700">{asset.policyCount}</p>
                      <p className="text-[10px] text-muted-foreground">Total</p>
                    </div>
                    <div className="text-center">
                      <p className={cn('text-lg font-bold', asset.activePolicies > 0 ? 'text-emerald-600' : 'text-slate-400')}>
                        {asset.activePolicies}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Active</p>
                    </div>
                    <div className="text-center">
                      <p className={cn('text-lg font-bold', asset.expiredPolicies > 0 ? 'text-red-500' : 'text-slate-400')}>
                        {asset.expiredPolicies}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Expired</p>
                    </div>
                  </div>

                  {/* Alert badges */}
                  {(asset.expiringPolicies > 0 || asset.expiredPolicies > 0) && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {asset.expiringPolicies > 0 && (
                        <Badge className="gap-1 bg-amber-100 text-amber-700 border-amber-200 text-[10px]">
                          <CalendarClock className="h-2.5 w-2.5" />
                          {asset.expiringPolicies} expiring soon
                        </Badge>
                      )}
                      {asset.expiredPolicies > 0 && (
                        <Badge className="gap-1 bg-red-100 text-red-700 border-red-200 text-[10px]">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {asset.expiredPolicies} expired
                        </Badge>
                      )}
                    </div>
                  )}
                  {asset.policyCount === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-1">No policies yet</p>
                  )}
                  {asset.activePolicies > 0 && asset.expiringPolicies === 0 && asset.expiredPolicies === 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>All policies current</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Premium due quick link */}
      {totals.expiring > 0 && (
        <Link href="/insurance/project/premium-due">
          <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 cursor-pointer hover:bg-amber-50 transition-colors">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="text-sm font-medium text-amber-800">
                {totals.expiring} project {totals.expiring === 1 ? 'policy expires' : 'policies expire'} within 30 days
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-amber-600 font-medium">
              View Premium Due <ChevronRight className="h-3.5 w-3.5" />
            </div>
          </div>
        </Link>
      )}

    </div>
  );
}
