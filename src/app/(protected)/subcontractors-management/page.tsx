
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Home,
  FolderOpen,
  HardHat,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { collection, doc, getDoc, getDocs, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import AllSubcontractorsDashboard from '@/components/subcontractors-management/AllSubcontractorsDashboard';
import { projectSlugCanonical } from '@/lib/project-slug';

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


export default function SubcontractorsDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Subcontractors Management');

  /**
   * Arriving from Project Management with a project already chosen.
   *
   * The two modules address a project differently — Project Management by its
   * `projectManagementProjects` mapping id in `?project=`, this one by the global project's name
   * slug in the path — so a PM link landing here otherwise dropped the user on the all-projects
   * picker and asked them to choose a project they had already chosen. Resolving the mapping and
   * redirecting keeps the selection.
   */
  const pmMappingId = searchParams?.get('project') ?? '';
  useEffect(() => {
    if (!pmMappingId || isAuthLoading || !canViewModule) return;
    let cancelled = false;
    void (async () => {
      try {
        const mappingSnapshot = await getDoc(doc(db, 'projectManagementProjects', pmMappingId));
        if (cancelled || !mappingSnapshot.exists()) return;
        const mapping = mappingSnapshot.data() as {
          globalProjectId?: string;
          globalProjectName?: string;
        };
        let name = mapping.globalProjectName ?? '';
        if (!name && mapping.globalProjectId) {
          const projectSnapshot = await getDoc(doc(db, 'projects', mapping.globalProjectId));
          name = String(projectSnapshot.data()?.projectName ?? '');
        }
        const slug = projectSlugCanonical(name);
        if (!cancelled && slug) router.replace(`/subcontractors-management/${slug}`);
      } catch (error) {
        // Fall through to the picker — it is a working screen, just not the one intended.
        console.error('Could not resolve the Project Management project:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pmMappingId, isAuthLoading, canViewModule, router]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewModule) {
      setIsLoading(false);
      return;
    }

    const fetchProjects = async () => {
        setIsLoading(true);
        try {
            const q = query(collection(db, 'projects'));
            const querySnapshot = await getDocs(q);
            const projectsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
            setProjects(projectsData);
        } catch (error) {
            console.error("Error fetching projects:", error);
        }
        setIsLoading(false);
    };
    fetchProjects();
  }, [isAuthLoading, canViewModule]);

  const handleProjectChange = (slug: string) => {
    if (!slug) return;
    if (slug === 'all') {
      router.push('/subcontractors-management');
    } else {
      router.push(`/subcontractors-management/${slug}`);
    }
  };
  
  if (isAuthLoading || (isLoading && canViewModule)) {
    return <div className="p-8"><Skeleton className="h-96" /></div>;
  }

  if (!canViewModule) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access this module.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    /* The module root spans every project, so it uses Project Management's hub layout rather than
       PmShell — a project-scoped sidebar here would be describing a project that is not selected. */
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/" aria-label="Home">
              <Home className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-blue-600 shadow-sm">
            <HardHat className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Subcontractors</h1>
            <p className="text-sm text-muted-foreground">
              Work orders, billing and reports across every project.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select onValueChange={handleProjectChange} defaultValue="all">
            <SelectTrigger className="h-9 w-full sm:w-[260px]">
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
      </div>
      <AllSubcontractorsDashboard />
    </main>
  );
}
