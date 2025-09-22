
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import type { ProjectInsurancePolicy, InsuredAsset, Project } from '@/lib/types';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';

export default function AssetPoliciesPage() {
  const { assetId } = useParams() as { assetId: string };
  const router = useRouter();
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [asset, setAsset] = useState<InsuredAsset | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [policies, setPolicies] = useState<ProjectInsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canViewPage = can('View', 'Insurance.Project Insurance');
  const canAddPolicy = can('Add', 'Insurance.Project Insurance');

  const fetchAssetData = async () => {
    if (!assetId) return;
    setIsLoading(true);
    try {
      const assetDocRef = doc(db, 'insuredAssets', assetId);
      const assetDocSnap = await getDoc(assetDocRef);
      if (!assetDocSnap.exists()) {
        toast({ title: "Error", description: "Asset not found.", variant: "destructive" });
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
      const policiesData = policiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectInsurancePolicy));
      
      setPolicies(policiesData);

    } catch (error) {
      console.error("Error fetching asset policies:", error);
      toast({ title: 'Error', description: 'Failed to fetch asset policies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthLoading) return;
    if (canViewPage) {
      fetchAssetData();
    } else {
      setIsLoading(false);
    }
  }, [assetId, isAuthLoading, canViewPage]);

  const handleRowClick = (policyId: string) => {
    // This is where you'd navigate to a more detailed view of a single policy if you had one.
    // For now, this is just a placeholder.
    // router.push(`/insurance/project/policy/${policyId}`);
  };

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return format(d, 'dd-MMM-yy');
  };

  const formatCurrency = (amount: number) => {
    if (typeof amount !== 'number') return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full p-4">
            <Skeleton className="h-10 w-96 mb-6" />
            <Skeleton className="h-48 w-full" />
        </div>
    );
  }
  
  if (!canViewPage) {
      return (
          <div className="w-full p-4">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold">Asset Policies</h1>
                </div>
              </div>
              <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view project insurance policies.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
              </Card>
          </div>
      );
  }

  const assetName = asset?.type === 'Project' && project ? project.projectName : asset?.name;
  const assetSite = asset?.type === 'Project' && project ? project.location : asset?.location;

  return (
    <div className="w-full p-4 font-sans">
      <div className="flex items-center justify-between mb-4 no-print">
        <div className="flex items-center gap-2">
           <Link href="/insurance/project">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
          <h1 className="text-lg font-semibold">Insurance Policy Report</h1>
        </div>
        <div className="flex items-center gap-2">
            <Link href={`/insurance/project/new?assetId=${assetId}`}>
                <Button disabled={!canAddPolicy} size="sm"><Plus className="mr-2 h-4 w-4" /> Add New Policy</Button>
            </Link>
        </div>
      </div>
      
      <div className="border border-blue-800 p-4">
          <div className="text-center font-semibold mb-6">
              Project Name/Site : {assetName} {assetSite && ` / ${assetSite}`}
          </div>
          
          {/* Header Row */}
          <div className="grid grid-cols-10 gap-4 text-xs font-bold border-b pb-2">
            <div className="col-span-1">Policy Category</div>
            <div className="col-span-1">Policy No.</div>
            <div className="col-span-1">Insurance Company</div>
            <div className="text-right">Premium</div>
            <div className="text-right">Sum Insured</div>
            <div className="text-center">Start Date</div>
            <div className="text-center">Years</div>
            <div className="text-center">Months</div>
            <div className="text-center">Insured Until</div>
            <div className="col-span-1">Status</div>
          </div>

          {/* Data Rows */}
          {isLoading ? (
            <div className="mt-2">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : policies.length > 0 ? (
            policies.map(policy => (
              <div key={policy.id} className="grid grid-cols-10 gap-4 text-xs py-2 border-b">
                  <div className="col-span-1">{policy.policy_category}</div>
                  <div className="col-span-1">{policy.policy_no}</div>
                  <div className="col-span-1">{policy.insurance_company}</div>
                  <div className="text-right">{formatCurrency(policy.premium)}</div>
                  <div className="text-right">{formatCurrency(policy.sum_insured)}</div>
                  <div className="text-center">{formatDate(policy.insurance_start_date)}</div>
                  <div className="text-center">{policy.tenure_years}</div>
                  <div className="text-center">{policy.tenure_months}</div>
                  <div className="text-center">{formatDate(policy.insured_until)}</div>
                  <div className="col-span-1">{policy.status}</div>
              </div>
            ))
          ) : (
             <div className="text-center py-8 text-sm text-gray-500">
                No insurance policies found for this asset.
             </div>
          )}
      </div>
    </div>
  );
}
