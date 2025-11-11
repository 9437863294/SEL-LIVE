
'use client';

import Link from 'next/link';
import {
  Users,
  FileText,
  Calculator,
  FolderOpen,
  BarChart3,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState, useEffect, useMemo, useCallback } from 'react';
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

interface SubcontractorCardProps {
    item: {
      icon: LucideIcon;
      text: string;
      href: string;
      description: string;
      disabled?: boolean;
    };
  }

function SubcontractorCard({ item }: SubcontractorCardProps) {
    const isDisabled = item.href === '#' || item.disabled;
    const cardContent = (
      <Card className={cn(
        'flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50',
        isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}>
        <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
          <div className="bg-primary/10 p-3 rounded-lg">
            <item.icon className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base font-bold">{item.text}</CardTitle>
            <CardDescription className="text-xs">{item.description}</CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  
    if (isDisabled) return <div className="h-full">{cardContent}</div>;
  
    return (
      <Link href={item.href} className="no-underline h-full">{cardContent}</Link>
    );
}

export default function SubcontractorsDashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const safeCan = useCallback(
    (action: string, resource: string) => {
      if (isAuthLoading) return false;
      return typeof can === 'function' ? can(action, resource) : false;
    },
    [can, isAuthLoading]
  );

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

  const dashboardItems = useMemo(
    () => [
      {
        icon: Users,
        text: 'Manage Subcontractors',
        href: `/subcontractors-management/all/manage`,
        description: 'View, add, or edit all subcontractors.',
        disabled: !safeCan('View', 'Subcontractors Management.Manage Subcontractors'),
      },
      {
        icon: FileText,
        text: 'Manage Work Order',
        href: `/subcontractors-management/all/work-order`,
        description: 'View and manage all work orders.',
        disabled: !safeCan('View', 'Subcontractors Management.Work Order'),
      },
      {
        icon: Calculator,
        text: 'Billing',
        href: `/subcontractors-management/all/billing`,
        description: 'Create and manage all bills.',
        disabled: !safeCan('View', 'Subcontractors Management.Billing'),
      },
       {
        icon: BarChart3,
        text: 'Reports',
        href: `/subcontractors-management/all/reports`,
        description: 'View consolidated reports.',
        disabled: !safeCan('View', 'Subcontractors Management.Reports'),
      },
    ],
    [safeCan]
  );

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
       <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {dashboardItems.map((item) => (
          <SubcontractorCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
