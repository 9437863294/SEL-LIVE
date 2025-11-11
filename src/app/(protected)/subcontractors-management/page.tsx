
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  FileText,
  Calculator,
  FolderOpen,
  ShieldAlert,
  BarChart3,
  Home,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Project } from '@/lib/types';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AllSubcontractorsDashboard from '@/components/AllSubcontractorsDashboard';

const slugify = (text: string) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};


export default function SubcontractorsDashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Subcontractors Management');

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewModule) {
      setIsLoading(false);
      return;
    }

    const fetchProjects = async () => {
        setIsLoading(true);
        try {
            const q = query(collection(db, 'projects')); // No filter here, show all projects for selection
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
      router.push(`/subcontractors-management`);
    } else {
      router.push(`/subcontractors-management/${slug}`);
    }
  };
  
  if (isAuthLoading) {
    return <div className="p-8"><Skeleton className="h-96" /></div>;
  }

  if (!canViewModule) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="icon" aria-label="Home"><Home className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Subcontractors Management</h1>
        </div>
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
       <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="icon" aria-label="Home">
              <Home className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Subcontractors Management</h1>
        </div>
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-muted-foreground" />
          <Select onValueChange={handleProjectChange} defaultValue="all">
            <SelectTrigger className="w-[260px]">
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
    </div>
  );
}
