'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { collection, deleteDoc, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { ChevronDown, ChevronRight, Edit, ExternalLink, Loader2, MapPin, Plus, RotateCw, Trash2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { InsuredAsset, Project, ProjectInsurancePolicy, ProjectPolicyRenewal } from '@/lib/types';
import {
  formatDay,
  formatInr,
  isProjectRenewable,
  projectPolicyState,
  relativeDays,
  toDate,
  type ProjectPolicyState,
} from '@/lib/insurance';
import { PROJECT_POLICIES } from '@/lib/insurance-service';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { ProjectRenewalDialog } from '@/components/insurance/ProjectRenewalDialog';
import { AccessDenied, ProjectStateBadge } from '@/components/insurance/insurance-ui';
import { cn } from '@/lib/utils';

interface EnrichedPolicy extends ProjectInsurancePolicy {
  history: ProjectPolicyRenewal[];
  _state: ProjectPolicyState;
}

const ORDER: Record<ProjectPolicyState, number> = { expired: 0, expiring: 1, active: 2, 'not-required': 3, closed: 4 };

export default function AssetPoliciesPage() {
  const { assetId } = useParams() as { assetId: string };
  const router = useRouter();
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canViewPage = can('View', 'Insurance.Project Insurance');
  const canAddPolicy = can('Add', 'Insurance.Project Insurance');
  const canEditPolicy = can('Edit', 'Insurance.Project Insurance');
  const canDeletePolicy = can('Delete', 'Insurance.Project Insurance');
  const canRenewPolicy = can('Renew', 'Insurance.Project Insurance');

  const [asset, setAsset] = useState<InsuredAsset | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [policies, setPolicies] = useState<EnrichedPolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [renewing, setRenewing] = useState<ProjectInsurancePolicy | null>(null);
  const [deleting, setDeleting] = useState<EnrichedPolicy | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const fetchAssetData = useCallback(async () => {
    if (!assetId) return;
    setIsLoading(true);
    try {
      const assetSnap = await getDoc(doc(db, 'insuredAssets', assetId));
      if (!assetSnap.exists()) {
        toast({ title: 'Error', description: 'Asset not found.', variant: 'destructive' });
        router.push('/insurance/project');
        return;
      }
      const assetData = { id: assetSnap.id, ...assetSnap.data() } as InsuredAsset;
      setAsset(assetData);
      if (assetData.type === 'Project' && assetData.projectId) {
        const projectSnap = await getDoc(doc(db, 'projects', assetData.projectId));
        if (projectSnap.exists()) setProject(projectSnap.data() as Project);
      }

      const policiesSnap = await getDocs(query(collection(db, PROJECT_POLICIES), where('assetId', '==', assetId)));
      const now = new Date();
      const rows = await Promise.all(policiesSnap.docs.map(async (pDoc) => {
        const policy = { id: pDoc.id, ...pDoc.data() } as ProjectInsurancePolicy;
        const historySnap = await getDocs(collection(db, PROJECT_POLICIES, pDoc.id, 'history'));
        const history = historySnap.docs
          .map((h) => ({ id: h.id, ...h.data() } as ProjectPolicyRenewal))
          .sort((a, b) => (toDate(b.renewalDate)?.getTime() ?? 0) - (toDate(a.renewalDate)?.getTime() ?? 0));
        return { ...policy, history, _state: projectPolicyState(policy, now) };
      }));
      setPolicies(rows.sort((a, b) => ORDER[a._state] - ORDER[b._state]
        || (toDate(a.insured_until)?.getTime() ?? 0) - (toDate(b.insured_until)?.getTime() ?? 0)));
    } catch (error) {
      console.error('Error fetching asset policies:', error);
      toast({ title: 'Error', description: 'Failed to fetch asset policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [assetId, router, toast]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (canViewPage) fetchAssetData();
    else setIsLoading(false);
  }, [isAuthLoading, canViewPage, fetchAssetData]);

  const totals = useMemo(() => {
    const live = policies.filter((p) => p._state === 'active' || p._state === 'expiring');
    return {
      cover: live.reduce((s, p) => s + (p.sum_insured || 0), 0),
      premium: live.reduce((s, p) => s + (p.premium || 0), 0),
      live: live.length,
      attention: policies.filter((p) => isProjectRenewable(p._state)).length,
    };
  }, [policies]);

  const toggleRow = (id: string) => setExpandedRows((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      const historySnap = await getDocs(collection(db, PROJECT_POLICIES, deleting.id, 'history'));
      historySnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      await deleteDoc(doc(db, PROJECT_POLICIES, deleting.id));
      toast({ title: 'Policy deleted', description: `${deleting.policy_no} has been removed.` });
      setDeleting(null);
      fetchAssetData();
    } catch (error) {
      console.error('Error deleting project policy:', error);
      toast({ title: 'Error', description: 'Failed to delete the policy.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (!canViewPage) return <AccessDenied what="view project insurance" />;

  const assetName = asset?.type === 'Project' && project ? project.projectName : asset?.name;
  const location = asset?.type === 'Project' && project ? project.location : asset?.location;

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title={assetName || 'Asset'}
          description={location ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {location}</span> : undefined}
          backHref="/insurance/project"
          backLabel="Back to project insurance"
          meta={[{ label: 'Type', value: asset?.type ?? '—' }, { label: 'Policies', value: policies.length }]}
          actions={
            canAddPolicy && (
              <Link href={`/insurance/project/new?assetId=${assetId}`}>
                <Button size="sm" className="w-full gap-1.5"><Plus className="h-3.5 w-3.5" /> Add Policy</Button>
              </Link>
            )
          }
        />

        <Card className="overflow-hidden border-border/60">
          <CardContent className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
            {[
              { label: 'Live Policies', value: String(totals.live), color: 'text-emerald-600' },
              { label: 'Need Renewal', value: String(totals.attention), color: totals.attention ? 'text-red-600' : 'text-slate-500' },
              { label: 'Cover in Force', value: formatInr(totals.cover), color: 'text-slate-700' },
              { label: 'Current Premium', value: formatInr(totals.premium), color: 'text-slate-700' },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center rounded-lg py-1 text-center">
                <span className={cn('text-lg font-bold leading-tight', s.color)}>{s.value}</span>
                <span className="text-[11px] text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <TableCard title="Policies" count={policies.length} scroll="natural">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><span className="sr-only">Expand</span></TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Insurer</TableHead>
                <TableHead className="text-right">Premium</TableHead>
                <TableHead className="text-right">Sum Insured</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="h-24 text-center text-muted-foreground">No insurance policies for this asset yet.</TableCell></TableRow>
              ) : policies.map((policy) => {
                const isExpanded = expandedRows.has(policy.id);
                const end = toDate(policy.insured_until);
                return (
                  <Fragment key={policy.id}>
                    <TableRow className={cn(policy._state === 'expired' && 'bg-rose-50/40')}>
                      <TableCell>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={isExpanded ? 'Hide history' : 'Show history'} aria-expanded={isExpanded} onClick={() => toggleRow(policy.id)}>
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{policy.policy_category}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono">{policy.policy_no}</TableCell>
                      <TableCell>{policy.insurance_company}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(policy.premium)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(policy.sum_insured)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <p>{formatDay(policy.insurance_start_date)} – {formatDay(end)}</p>
                        {end && (policy._state === 'expiring' || policy._state === 'expired') && (
                          <p className="text-[11px] text-muted-foreground">{relativeDays(end)}</p>
                        )}
                      </TableCell>
                      <TableCell><ProjectStateBadge state={policy._state} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canRenewPolicy && isProjectRenewable(policy._state) && (
                            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setRenewing(policy)}>
                              <RotateCw className="h-3 w-3" /> Renew
                            </Button>
                          )}
                          {canEditPolicy && (
                            <Link href={`/insurance/project/edit/${policy.id}`}>
                              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${policy.policy_no}`}><Edit className="h-3.5 w-3.5" /></Button>
                            </Link>
                          )}
                          {canDeletePolicy && (
                            <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" aria-label={`Delete ${policy.policy_no}`} onClick={() => setDeleting(policy)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-muted/20 p-0">
                          <div className="space-y-3 p-4">
                            {(policy.broker_name || policy.remarks) && (
                              <p className="text-sm text-muted-foreground">
                                {policy.broker_name && <>Broker: <span className="text-foreground">{policy.broker_name}</span>. </>}
                                {policy.remarks}
                              </p>
                            )}
                            {(policy.attachments?.length ?? 0) > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {policy.attachments!.map((a, i) => (
                                  <a key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs hover:underline">
                                    {a.name} <ExternalLink className="h-3 w-3" />
                                  </a>
                                ))}
                              </div>
                            )}
                            <h4 className="text-sm font-semibold">Renewal History</h4>
                            {policy.history.length > 0 ? (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Renewed On</TableHead>
                                    <TableHead>By</TableHead>
                                    <TableHead>Previous Policy No.</TableHead>
                                    <TableHead>Insurer</TableHead>
                                    <TableHead className="text-right">Premium</TableHead>
                                    <TableHead className="text-right">Sum Insured</TableHead>
                                    <TableHead>Period</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {policy.history.map((h) => (
                                    <TableRow key={h.id}>
                                      <TableCell className="whitespace-nowrap">{formatDay(h.renewalDate)}</TableCell>
                                      <TableCell>{h.renewedByName || '—'}</TableCell>
                                      <TableCell className="whitespace-nowrap font-mono">{h.policyNo}</TableCell>
                                      <TableCell>{h.insuranceCompany || '—'}</TableCell>
                                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(h.premium)}</TableCell>
                                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatInr(h.sumInsured)}</TableCell>
                                      <TableCell className="whitespace-nowrap">{formatDay(h.startDate)} – {formatDay(h.endDate)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            ) : (
                              <p className="text-sm text-muted-foreground">No renewals recorded yet.</p>
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

      {renewing && (
        <ProjectRenewalDialog isOpen={!!renewing} onOpenChange={(o) => !o && setRenewing(null)} policy={renewing} onSuccess={fetchAssetData} />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !isDeleting && !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete policy {deleting?.policy_no}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the policy and its {deleting?.history.length ?? 0} renewal record(s). To keep the history, edit it and set the status to Closed or Not Required instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleDelete(); }} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
