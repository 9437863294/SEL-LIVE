
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, ShieldAlert, Eye, CalendarClock, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { InsuredAsset, Project, ProjectInsurancePolicy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { addDays, isWithinInterval } from 'date-fns';

interface EnrichedAsset extends InsuredAsset {
  policyCount: number;
  activePolicies: number;
  expiringPolicies: number;
}

export default function ProjectInsurancePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  
  const [assets, setAssets] = useState<InsuredAsset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [policies, setPolicies] = useState<ProjectInsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canViewPage = can('View', 'Insurance.Project Insurance');
  const canAdd = can('Add', 'Insurance.Project Insurance');

  useEffect(() => {
    if (authLoading) return;
    if (canViewPage) {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [authLoading, canViewPage]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [assetsSnap, projectsSnap, policiesSnap] = await Promise.all([
        getDocs(collection(db, 'insuredAssets')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'project_insurance_policies')),
      ]);
      setAssets(assetsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuredAsset)));
      setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
      setPolicies(policiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectInsurancePolicy)));
    } catch (error) {
      console.error("Error fetching assets:", error);
      toast({ title: 'Error', description: 'Failed to fetch insurable assets.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const enrichedAssets = useMemo((): EnrichedAsset[] => {
    return assets.map(asset => {
      const assetPolicies = policies.filter(p => p.assetId === asset.id);
      const activePolicies = assetPolicies.filter(p => p.status === 'Active');
      
      const expiringPolicies = activePolicies.filter(p => {
        if (!p.insured_until) return false;
        const expiryDate = p.insured_until.toDate();
        return isWithinInterval(expiryDate, { start: new Date(), end: addDays(new Date(), 30) });
      }).length;
      
      return {
        ...asset,
        policyCount: assetPolicies.length,
        activePolicies: activePolicies.length,
        expiringPolicies,
      };
    });
  }, [assets, policies]);
  
  const handleRowClick = (assetId: string) => {
    router.push(`/insurance/project/${assetId}`);
  };

  const getAssetName = (asset: InsuredAsset) => {
    if (asset.type === 'Project' && asset.projectId) {
        return projects.find(p => p.id === asset.projectId)?.projectName || asset.name;
    }
    return asset.name;
  };

  const getAssetLocation = (asset: InsuredAsset) => {
    if (asset.type === 'Project' && asset.projectId) {
      return projects.find(p => p.id === asset.projectId)?.location || 'N/A';
    }
    return asset.location || 'N/A';
  };
  
  if (authLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full">
            <Skeleton className="h-10 w-96 mb-6" />
            <Skeleton className="h-[500px] w-full" />
        </div>
    );
  }

  if (!canViewPage) {
    return (
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold">Project Insurance</h1>
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

  return (
    <>
      <div className="w-full">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Project Insurance</h1>
            <p className="text-sm text-muted-foreground">Manage all project-specific insurance policies.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/insurance/project/new">
              <Button disabled={!canAdd}>
                <Plus className="mr-2 h-4 w-4" /> Add New Policy
              </Button>
            </Link>
          </div>
        </div>
        
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Total Policies</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Expiring Soon</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({length: 3}).map((_, i) => (
                      <TableRow key={i}>
                          <TableCell colSpan={6}><Skeleton className="h-8" /></TableCell>
                      </TableRow>
                  ))
                ) : enrichedAssets.length > 0 ? (
                  enrichedAssets.map(asset => (
                  <TableRow key={asset.id} onClick={() => handleRowClick(asset.id)} className="cursor-pointer">
                    <TableCell className="font-medium">{getAssetName(asset)}</TableCell>
                    <TableCell>{asset.type}</TableCell>
                    <TableCell>{asset.policyCount}</TableCell>
                    <TableCell>{asset.activePolicies}</TableCell>
                    <TableCell>
                        <Badge variant={asset.expiringPolicies > 0 ? 'destructive' : 'outline'}>
                            {asset.expiringPolicies}
                        </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={asset.status === 'Active' ? 'default' : 'secondary'}>{asset.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">No assets found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
