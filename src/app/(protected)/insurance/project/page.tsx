'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import type { InsuredAsset, Project, ProjectInsurancePolicy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AccessDenied } from '@/components/insurance/insurance-ui';
import { ProjectRegister } from '@/components/insurance/project-register';

export default function ProjectInsurancePage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const canViewPage = can('View', 'Insurance.Project Insurance');
  const canAdd      = can('Add',  'Insurance.Project Insurance');

  const [assets, setAssets]     = useState<InsuredAsset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [policies, setPolicies] = useState<ProjectInsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Loading starts true and is cleared only once the read settles; a read overtaken by unmount is dropped.
  useEffect(() => {
    if (authLoading || !canViewPage) return;
    let cancelled = false;
    (async () => {
      try {
        const [assetsSnap, projectsSnap, policiesSnap] = await Promise.all([
          getDocs(collection(db, 'insuredAssets')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'project_insurance_policies')),
        ]);
        if (cancelled) return;
        setAssets(assetsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InsuredAsset)));
        setProjects(projectsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Project)));
        setPolicies(policiesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectInsurancePolicy)));
      } catch (err) {
        console.error('Error fetching project insurance:', err);
        if (!cancelled) toast({ title: 'Error', description: 'Failed to fetch project insurance data.', variant: 'destructive' });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, canViewPage, toast]);

  if (authLoading || (isLoading && canViewPage)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewPage) return <AccessDenied what="view project insurance" />;

  return <ProjectRegister assets={assets} projects={projects} policies={policies} canAdd={canAdd} />;
}
