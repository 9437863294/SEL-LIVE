
'use client';

import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

interface BillingReconCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
  };
}

const slugify = (text: string) => {
    if (!text) return '';
    return text.toString().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
}


function BillingReconCard({ item }: BillingReconCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
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
    )

    if (item.href === '#') {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}


export default function ProjectDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const projectSlug = params.project as string;
  
  useEffect(() => {
    const fetchProjects = async () => {
        setIsLoading(true);
        try {
            const querySnapshot = await getDocs(collection(db, 'projects'));
            const projectsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
            setProjects(projectsData);
        } catch (error) {
            console.error("Error fetching projects: ", error);
        }
        setIsLoading(false);
    };
    fetchProjects();
  }, []);

  const handleProjectChange = (slug: string) => {
    router.push(`/billing-recon/${slug}`);
  };

  const currentProject = projects.find(p => slugify(p.projectName) === projectSlug);
  const projectName = currentProject?.projectName || projectSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  const billingItems = [
    { icon: ClipboardList, text: 'BOQ', href: `/billing-recon/${projectSlug}/boq`, description: 'Manage Bill of Quantities.' },
    { icon: Truck, text: 'MVAC', href: `/billing-recon/${projectSlug}/mvac`, description: 'Record supply and JMC details.' },
    { icon: HardHat, text: 'JMC', href: `/billing-recon/${projectSlug}/jmc`, description: 'Manage the civil workstream.' },
    { icon: Calculator, text: 'Billing', href: `/billing-recon/${projectSlug}/billing`, description: 'Generate and manage bills.' },
    { icon: FileEdit, text: 'Amendment Entry', href: '#', description: 'Manage amendments and revisions.' },
    { icon: BarChart3, text: 'Reports', href: '#', description: 'View and generate billing reports.' },
    { icon: FilePlus, text: 'Create ARD', href: '#', description: 'Create Abstract of Rate Document.' },
  ];

  if (isLoading) {
      return (
        <div className="w-full max-w-6xl mx-auto">
            <Skeleton className="h-10 w-1/2 mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
            </div>
        </div>
      )
  }

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/billing-recon">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">{projectName}</h1>
        </div>
        <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
             <Select value={projectSlug} onValueChange={handleProjectChange}>
                <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select Project" />
                </SelectTrigger>
                <SelectContent>
                    {projects.map(p => (
                        <SelectItem key={p.id} value={slugify(p.projectName)}>{p.projectName}</SelectItem>
                    ))}
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
