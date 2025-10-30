

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ClipboardList,
  Truck,
  Calculator,
  FileEdit,
  BarChart3,
  FilePlus,
  HardHat,
  FolderOpen,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParams, useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project as ProjectType } from '@/lib/types'; // If this exists in your codebase
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

/** If your local Project type doesn’t already include these fields,
 * uncomment this interface and remove the import above.
 */
// export interface Project {
//   id: string;
//   projectName: string;
//   billingRequired: boolean;
//   // add other fields you actually store on `projects` as needed
// }

type Project = ProjectType & {
  id: string;
  projectName: string;
  billingRequired?: boolean;
};

interface BillingReconCardProps {
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
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

function BillingReconCard({ item }: BillingReconCardProps) {
  const cardContent = (
    <Card
      className={cn(
        'flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50',
        item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
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

  if (item.href === '#' || item.disabled) {
    return <div className="h-full">{cardContent}</div>;
  }

  return (
    <Link href={item.href} className="no-underline h-full">
      {cardContent}
    </Link>
  );
}

export default function ProjectDashboardPage() {
  const { project: projectSlugParam } = useParams() as { project: string };
  const router = useRouter();

  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Memoized to avoid re-renders
  const safeCan = useCallback(
    (action: string, resource: string) => {
      if (isAuthLoading) return false;
      return typeof can === 'function' ? can(action, resource) : false;
    },
    [can, isAuthLoading]
  );

  useEffect(() => {
    if (isAuthLoading) return;

    let cancelled = false;
    const fetchProjects = async () => {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'projects'), where('billingRequired', '==', true));
        const querySnapshot = await getDocs(q);
        if (cancelled) return;
        const projectsData: Project[] = querySnapshot.docs.map((d) => {
          const data = d.data() as Omit<Project, 'id'>;
          return { id: d.id, ...data };
        });
        setProjects(projectsData);
      } catch (error) {
        console.error('Error fetching projects: ', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchProjects();
    return () => {
      cancelled = true;
    };
  }, [isAuthLoading]);

  const currentProject = useMemo(
    () => projects.find((p) => slugify(p.projectName) === projectSlugParam) ?? null,
    [projects, projectSlugParam]
  );

  const projectName = useMemo(() => {
    if (currentProject?.projectName) return currentProject.projectName;
    // Fallback: prettify the slug from URL
    return projectSlugParam.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }, [currentProject, projectSlugParam]);

  const selectedValue = useMemo(() => {
    const found = projects.find(p => slugify(p.projectName) === projectSlugParam);
    return found ? projectSlugParam : undefined;
  }, [projects, projectSlugParam]);

  const handleProjectChange = (slug: string) => {
    if (!slug || slug === projectSlugParam) return;
    router.push(`/billing-recon/${slug}`);
  };

  const billingItems = useMemo(
    () => [
      {
        icon: ClipboardList,
        text: 'BOQ',
        href: `/billing-recon/${projectSlugParam}/boq`,
        description: 'Manage Bill of Quantities.',
        disabled: !safeCan('View', 'Billing Recon.BOQ'),
      },
      {
        icon: Truck,
        text: 'MVAC',
        href: `/billing-recon/${projectSlugParam}/mvac`,
        description: 'Record supply and JMC details.',
        disabled: !safeCan('View', 'Billing Recon.MVAC'),
      },
      {
        icon: HardHat,
        text: 'JMC',
        href: `/billing-recon/${projectSlugParam}/jmc`,
        description: 'Manage the civil workstream.',
        disabled: !safeCan('View', 'Billing Recon.JMC'),
      },
      {
        icon: Calculator,
        text: 'Billing',
        href: `/billing-recon/${projectSlugParam}/billing`,
        description: 'Generate and manage bills.',
        disabled: !safeCan('View', 'Billing Recon.Billing'),
      },
      {
        icon: FileEdit,
        text: 'Amendment Entry',
        href: '#',
        description: 'Manage amendments and revisions.',
        disabled: true, // mark disabled until implemented/authorized
      },
      {
        icon: BarChart3,
        text: 'Reports',
        href: '#',
        description: 'View and generate billing reports.',
        disabled: true,
      },
      {
        icon: FilePlus,
        text: 'Create ARD',
        href: '#',
        description: 'Create Abstract of Rate Document.',
        disabled: true,
      },
    ],
    [projectSlugParam, safeCan]
  );

  if (isLoading || isAuthLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-1/2 mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (!safeCan('View Module', 'Billing Recon')) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/billing-recon">
              <Button variant="ghost" size="icon" aria-label="Back">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">{projectName}</h1>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this project dashboard.</CardDescription>
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
          <Link href="/billing-recon">
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">{projectName}</h1>
        </div>
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-muted-foreground" />
          <Select value={selectedValue} onValueChange={handleProjectChange}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select Project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => {
                const value = slugify(p.projectName);
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
        {billingItems.map((item) => (
          <BillingReconCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
