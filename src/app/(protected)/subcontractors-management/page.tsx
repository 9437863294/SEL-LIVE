
'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  FileText,
  Calculator,
  FolderOpen,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParams, useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import AllProjectsDashboard from '@/components/AllProjectsDashboard';

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
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const projectsSnap = await getDocs(query(collection(db, 'projects')));
        const projectsData = projectsSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as Project)
        );
        setProjects(projectsData);
      } catch (error) {
        console.error('Error fetching projects:', error);
      } finally {
        setIsLoadingProjects(false);
      }
    };
    fetchProjects();
  }, []);

  const handleProjectChange = (slug: string) => {
    if (!slug) return;
    if (slug === 'all') {
      router.push(`/subcontractors-management`);
    } else {
      router.push(`/subcontractors-management/${slug}`);
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/`}>
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="h-6 w-6" />
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
              {projects.map((p) => {
                const value = slugify((p as any).slug ?? p.projectName);
                return (
                  <SelectItem key={p.id} value={value}>
                    {p.projectName}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>
      <AllProjectsDashboard />
    </div>
  );
}
