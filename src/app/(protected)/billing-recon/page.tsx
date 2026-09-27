
'use client';

import { useState, useEffect } from 'react';
import { FolderOpen, ShieldAlert } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { useRouter } from 'next/navigation';
import AllProjectsDashboard from '@/components/billing-recon/AllProjectsDashboard';

const slugify = (text: string) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};


export default function BillingReconDashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Billing Recon');

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewModule) {
      setIsLoading(false);
      return;
    }

    const fetchProjects = async () => {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'projects'), where('billingRequired', '==', true));
        const querySnapshot = await getDocs(q);
        setProjects(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
      } catch (error) {
        console.error("Error fetching projects:", error);
      }
      setIsLoading(false);
    };

    fetchProjects();
  }, [isAuthLoading, canViewModule]);

  const handleProjectChange = (slug: string) => {
    if (!slug || slug === 'all') return;
    router.push(`/billing-recon/${slug}`);
  };
  
  if (isAuthLoading) {
    return <div className="p-8"><Skeleton className="h-96" /></div>;
  }

  if (!canViewModule) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <PageHeader title="Billing & Reconciliation" backHref="/" backLabel="Home" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access this module.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <PageHeader
        title="Billing & Reconciliation"
        backHref="/"
        backLabel="Home"
        actions={
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
            <Select onValueChange={handleProjectChange} defaultValue="all">
              <SelectTrigger className="w-full sm:w-[260px]">
                <SelectValue placeholder="Select Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={slugify(p.projectName)}>
                    {p.projectName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />
      <AllProjectsDashboard />
    </div>
  );
}
