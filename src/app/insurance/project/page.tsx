
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { InsuredAsset, Project } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';

const slugify = (text: string) => {
    if (!text) return '';
    return text.toString().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
}

export default function ProjectInsurancePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  
  const [assets, setAssets] = useState<InsuredAsset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
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
      const [assetsSnap, projectsSnap] = await Promise.all([
        getDocs(collection(db, 'insuredAssets')),
        getDocs(collection(db, 'projects')),
      ]);
      setAssets(assetsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuredAsset)));
      setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    } catch (error) {
      console.error("Error fetching assets:", error);
      toast({ title: 'Error', description: 'Failed to fetch insurable assets.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  const handleRowClick = (asset: InsuredAsset) => {
    router.push(`/insurance/project/${asset.id}`);
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
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({length: 3}).map((_, i) => (
                      <TableRow key={i}>
                          <TableCell colSpan={4}><Skeleton className="h-8" /></TableCell>
                      </TableRow>
                  ))
                ) : assets.length > 0 ? (
                  assets.map(asset => (
                  <TableRow key={asset.id} onClick={() => handleRowClick(asset)} className="cursor-pointer">
                    <TableCell className="font-medium">{getAssetName(asset)}</TableCell>
                    <TableCell>{asset.type}</TableCell>
                    <TableCell>{getAssetLocation(asset)}</TableCell>
                    <TableCell>
                      <Badge variant={asset.status === 'Active' ? 'default' : 'secondary'}>{asset.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center h-24">No assets found.</TableCell>
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
