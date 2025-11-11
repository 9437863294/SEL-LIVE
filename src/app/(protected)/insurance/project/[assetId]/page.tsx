'use client';

import { useState, useEffect, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, RotateCw, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import type { ProjectInsurancePolicy, InsuredAsset, Project, ProjectPolicyRenewal } from '@/lib/types';
import { format, isWithinInterval, addDays, isPast } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProjectRenewalDialog } from '@/components/ProjectRenewalDialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';


interface EnrichedPolicy extends ProjectInsurancePolicy {
  history: ProjectPolicyRenewal[];
}

export default function AssetPoliciesPage() {
  const { assetId } = useParams() as { assetId: string };
  const router = useRouter();
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [asset, setAsset] = useState<InsuredAsset | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [policies, setPolicies] = useState<EnrichedPolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPolicyForRenewal, setSelectedPolicyForRenewal] = useState<ProjectInsurancePolicy | null>(null);
  const [isRenewDialogOpen, setIsRenewDialogOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const canViewPage = can('View', 'Insurance.Project Insurance');
  const canAddPolicy = can('Add', 'Insurance.Project Insurance');
  const canRenewPolicy = can('Renew', 'Insurance.Project Insurance');

  const fetchAssetData = async () => {
    if (!assetId) return;
    setIsLoading(true);
    try {
      const assetDocRef = doc(db, 'insuredAssets', assetId);
      const assetDocSnap = await getDoc(assetDocRef);
      if (!assetDocSnap.exists()) {
        toast({ title: "Error", description: "Asset not found.", variant: "destructive" });
        router.push('/insurance/project');
        return;
      }
      const assetData = { id: assetDocSnap.id, ...assetDocSnap.data() } as InsuredAsset;
      setAsset(assetData);

      if (assetData.type === 'Project' && assetData.projectId) {
        const projectDocRef = doc(db, 'projects', assetData.projectId);
        const projectDocSnap = await getDoc(projectDocRef);
        if (projectDocSnap.exists()) {
          setProject(projectDocSnap.data() as Project);
        }
      }

      const policiesQuery = query(collection(db, 'project_insurance_policies'), where('assetId', '==', assetId));
      const policiesSnapshot = await getDocs(policiesQuery);

      const policiesDataPromises = policiesSnapshot.docs.map(async (pDoc) => {
        const policy = { id: pDoc.id, ...pDoc.data() } as ProjectInsurancePolicy;
        const historySnapshot = await getDocs(collection(db, 'project_insurance_policies', pDoc.id, 'history'));
        const history = historySnapshot.docs.map(hDoc => ({ id: hDoc.id, ...hDoc.data() } as ProjectPolicyRenewal));
        history.sort((a,b) => b.renewalDate.toMillis() - a.renewalDate.toMillis());
        return { ...policy, history };
      });
      
      const policiesData = await Promise.all(policiesDataPromises);
      setPolicies(policiesData);

    } catch (error) {
      console.error("Error fetching asset policies:", error);
      toast({ title: 'Error', description: 'Failed to fetch asset policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthLoading) {
      if (canViewPage) {
        fetchAssetData();
      } else {
        setIsLoading(false);
      }
    }
  }, [assetId, isAuthLoading, canViewPage, router, toast]);

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return format(d, 'dd-MMM-yy');
  };

  const formatCurrency = (amount: number) => {
    if (typeof amount !== 'number') return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  const handleRenewClick = (e: React.MouseEvent, policy: ProjectInsurancePolicy) => {
    e.stopPropagation();
    setSelectedPolicyForRenewal(policy);
    setIsRenewDialogOpen(true);
  };

  const toggleRowExpansion = (e: React.MouseEvent, policyId: string) => {
    e.stopPropagation();
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(policyId)) {
        newSet.delete(policyId);
      } else {
        newSet.add(policyId);
      }
      return newSet;
    });
  };

  const getStatus = (policy: ProjectInsurancePolicy) => {
    if (policy.status !== 'Active') {
      return { text: policy.status, variant: 'secondary' as const };
    }
    const expiryDate = policy.insured_until?.toDate();
    if (!expiryDate) return { text: 'Active', variant: 'default' as const };

    if (isPast(expiryDate)) return { text: 'Expired', variant: 'destructive' as const };
    if (isWithinInterval(expiryDate, { start: new Date(), end: addDays(new Date(), 30) })) {
      return { text: 'Expires Soon', variant: 'destructive' as const };
    }
    return { text: 'Active', variant: 'default' as const };
  };
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full p-4">
            <Skeleton className="h-10 w-96 mb-6" />
            <Skeleton className="h-48 w-full" />
        </div>
    );
  }
  
  const assetName = asset?.type === 'Project' && project ? project.projectName : asset?.name;

  return (
    <>
    <div className="w-full p-4">
      <div className="flex items-center justify-between mb-4 no-print">
        <div className="flex items-center gap-2">
           <Link href="/insurance/project">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
          <h1 className="text-lg font-semibold">Insurance Policies for: {assetName}</h1>
        </div>
        <div className="flex items-center gap-2">
            <Link href={`/insurance/project/new?assetId=${assetId}`}>
                <Button disabled={!canAddPolicy} size="sm"><Plus className="mr-2 h-4 w-4" /> Add New Policy</Button>
            </Link>
        </div>
      </div>
      
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Policy Category</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Sum Insured</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>Insured Until</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell>
                </TableRow>
              ) : policies.length > 0 ? (
                policies.map(policy => {
                  const status = getStatus(policy);
                  const isRenewable = policy.status === 'Active' && 
                                     policy.insured_until && 
                                     isWithinInterval(policy.insured_until.toDate(), { start: new Date(), end: addDays(new Date(), 30) });
                  const isExpanded = expandedRows.has(policy.id);

                  return (
                    <Fragment key={policy.id}>
                      <TableRow>
                          <TableCell className="px-2">
                              <Button size="icon" variant="ghost" onClick={(e) => toggleRowExpansion(e, policy.id)}>
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                          </TableCell>
                          <TableCell>{policy.policy_category}</TableCell>
                          <TableCell>{policy.policy_no}</TableCell>
                          <TableCell>{formatCurrency(policy.sum_insured)}</TableCell>
                          <TableCell>{formatDate(policy.insurance_start_date)}</TableCell>
                          <TableCell>{formatDate(policy.insured_until)}</TableCell>
                          <TableCell><Badge variant={status.variant}>{status.text}</Badge></TableCell>
                          <TableCell className="text-right">
                              {isRenewable && canRenewPolicy && (
                                  <Button size="sm" variant="outline" onClick={(e) => handleRenewClick(e, policy)}>
                                      <RotateCw className="mr-2 h-4 w-4" /> Renew
                                  </Button>
                              )}
                          </TableCell>
                      </TableRow>
                      {isExpanded && (
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                              <TableCell colSpan={8} className="p-0">
                                  <div className="p-4">
                                      <h4 className="font-semibold mb-2 ml-2">Renewal History</h4>
                                      {policy.history && policy.history.length > 0 ? (
                                          <Table>
                                              <TableHeader>
                                                  <TableRow>
                                                      <TableHead>Renewal Date</TableHead>
                                                      <TableHead>Old Policy No.</TableHead>
                                                      <TableHead>Old Premium</TableHead>
                                                      <TableHead>Old Sum Insured</TableHead>
                                                      <TableHead>Old Period</TableHead>
                                                  </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                  {policy.history.map(h => (
                                                      <TableRow key={h.id}>
                                                          <TableCell>{formatDate(h.renewalDate)}</TableCell>
                                                          <TableCell>{h.policyNo}</TableCell>
                                                          <TableCell>{formatCurrency(h.premium)}</TableCell>
                                                          <TableCell>{formatCurrency(h.sumInsured)}</TableCell>
                                                          <TableCell>{formatDate(h.startDate)} - {formatDate(h.endDate)}</TableCell>
                                                      </TableRow>
                                                  ))}
                                              </TableBody>
                                          </Table>
                                      ) : (
                                          <p className="text-sm text-muted-foreground p-4 text-center">No renewal history for this policy.</p>
                                      )}
                                  </div>
                              </TableCell>
                          </TableRow>
                      )}
                    </Fragment>
                  );
                })
              ) : (
                 <TableRow>
                    <TableCell colSpan={8} className="text-center h-24">
                        No insurance policies found for this asset.
                    </TableCell>
                 </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
    {selectedPolicyForRenewal && (
        <ProjectRenewalDialog 
            isOpen={isRenewDialogOpen}
            onOpenChange={setIsRenewDialogOpen}
            policy={selectedPolicyForRenewal}
            onSuccess={fetchAssetData}
        />
    )}
    </>
  );
}
