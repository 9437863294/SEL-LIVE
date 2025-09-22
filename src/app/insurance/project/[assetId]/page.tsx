
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import type { ProjectInsurancePolicy, InsuredAsset, Project } from '@/lib/types';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

  useEffect(() => {
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
        const policiesData = policiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectInsurancePolicy));
      
        setPolicies(policiesData);

      } catch (error) {
        console.error("Error fetching asset policies:", error);
        toast({ title: 'Error', description: 'Failed to fetch asset policies.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    
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
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full p-4">
            <Skeleton className="h-10 w-96 mb-6" />
            <Skeleton className="h-48 w-full" />
        </div>
    );
  }
  
  const assetName = asset?.type === 'Project' && project ? project.projectName : asset?.name;
  const assetSite = asset?.type === 'Project' && project ? project.location : asset?.location;

  return (
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
                <TableHead>Policy Category</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Insurance Company</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Sum Insured</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>Years</TableHead>
                <TableHead>Months</TableHead>
                <TableHead>Insured Until</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={10}><Skeleton className="h-8 w-full" /></TableCell>
                </TableRow>
              ) : policies.length > 0 ? (
                policies.map(policy => (
                  <TableRow key={policy.id}>
                      <TableCell>{policy.policy_category}</TableCell>
                      <TableCell>{policy.policy_no}</TableCell>
                      <TableCell>{policy.insurance_company}</TableCell>
                      <TableCell>{formatCurrency(policy.premium)}</TableCell>
                      <TableCell>{formatCurrency(policy.sum_insured)}</TableCell>
                      <TableCell>{formatDate(policy.insurance_start_date)}</TableCell>
                      <TableCell>{policy.tenure_years}</TableCell>
                      <TableCell>{policy.tenure_months}</TableCell>
                      <TableCell>{formatDate(policy.insured_until)}</TableCell>
                      <TableCell>{policy.status}</TableCell>
                  </TableRow>
                ))
              ) : (
                 <TableRow>
                    <TableCell colSpan={10} className="text-center h-24">
                        No insurance policies found for this asset.
                    </TableCell>
                 </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
