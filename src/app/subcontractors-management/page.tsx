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

interface SubcontractorCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

const slugify = (text: string) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

function SubcontractorCard({ item }: SubcontractorCardProps) {
  const isDisabled = item.href === '#' || item.disabled;
  const cardContent = (
    <Card
      className={cn(
        'flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50',
        isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}
    >
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
    <Link href={item.href} className="no-underline h-full">
      {cardContent}
    </Link>
  );
}

export default function SubcontractorsDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const paramProjectSlug = (params?.project as string) || '';
  const { can } = useAuthorization();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  // Fetch projects
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

  // Navigate but stay on the same dashboard route (URL updates to include slug)
  const handleProjectChange = (slug: string) => {
    if (!slug) return;
    router.replace(`/subcontractors-management/${slug}`);
  };

  // Compute the currently selected slug (from URL param)
  const selectedSlug = paramProjectSlug || undefined;

  // Base path for card links (requires project to be selected)
  const basePath = selectedSlug
    ? `/subcontractors-management/${selectedSlug}`
    : undefined;

  // Cards (disabled until a project is selected)
  const subcontractorItems = useMemo(
    () => [
      {
        icon: Users,
        text: 'Manage Subcontractors',
        href: basePath ? `${basePath}/manage` : '#',
        description: 'View, add, or edit subcontractor details.',
        disabled: !selectedSlug || !can('View', 'Subcontractors Management'),
      },
      {
        icon: FileText,
        text: 'Manage Work Order',
        href: basePath ? `${basePath}/work-order` : '#',
        description: 'Create and manage work orders for subcontractors.',
        disabled:
          !selectedSlug || !can('Manage Work Order', 'Subcontractors Management'),
      },
      {
        icon: Calculator,
        text: 'Billing',
        href: basePath ? `${basePath}/billing` : '#',
        description: 'Create and manage subcontractor bills.',
        disabled:
          !selectedSlug || !can('View', 'Subcontractors Management.Billing'),
      },
    ],
    [basePath, can, selectedSlug]
  );

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
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
          <Select
            value={selectedSlug}
            onValueChange={handleProjectChange}
            disabled={isLoadingProjects || projects.length === 0}
          >
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Select Project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => {
                // If you already store a slug in Firestore, use that instead of slugify(p.projectName)
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
        {subcontractorItems.map((item) => (
          <SubcontractorCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
