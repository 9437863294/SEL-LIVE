

'use client';

import Link from 'next/link';
import {
  Home,
  Folder,
  ShieldAlert,
  Settings,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import type { Project } from '@/lib/types';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

interface BillingReconCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
    isSettings?: boolean;
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
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1 flex justify-between items-center">
                    <div>
                        <CardTitle className="text-base font-bold">{item.text}</CardTitle>
                        <CardDescription className="text-xs">{item.description}</CardDescription>
                    </div>
                    {item.isSettings && <Settings className="w-5 h-5 text-muted-foreground" />}
                </div>
            </CardHeader>
        </Card>
    )

    if (item.href === '#' || item.disabled) {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}


export default function BillingReconPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Billing Recon');

  useEffect(() => {
    if(isAuthLoading) return;
    if(!canViewModule) {
        setIsLoading(false);
        return;
    }

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
  }, [isAuthLoading, canViewModule]);

  const projectItems = projects
    .filter(project => project.billingRequired === true)
    .map(project => ({
      icon: Folder,
      text: project.projectName,
      href: `/billing-recon/${slugify(project.projectName)}`,
      description: `Manage all ${project.projectName}-related billing tasks.`
  }));

  const settingsItem = {
    icon: Settings,
    text: 'Project Billing Settings',
    href: '/billing-recon/settings',
    description: 'Configure billing status for each project.',
    isSettings: true,
  };
  
  if (isAuthLoading || (isLoading && canViewModule)) {
      return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <Skeleton className="h-10 w-80 mb-6" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="h-28"><CardHeader><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2 mt-1" /></CardHeader></Card>
              ))}
          </div>
        </div>
      );
  }

  if (!canViewModule) {
      return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
             <div className="mb-6 flex items-center gap-2">
                <Link href="/"><Button variant="ghost" size="icon"><Home className="h-6 w-6" /></Button></Link>
                <h1 className="text-2xl font-bold">Billing &amp; Reconciliation</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to access the Billing & Reconciliation module.</CardDescription>
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
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/">
                <Button variant="ghost" size="icon">
                    <Home className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">Billing &amp; Reconciliation</h1>
        </div>
        <Link href="/billing-recon/settings">
            <Button variant="ghost" size="icon">
                <Settings className="h-6 w-6" />
            </Button>
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {projectItems.map((item) => (
            <BillingReconCard key={item.text} item={item} />
          ))}
          <BillingReconCard item={settingsItem} />
      </div>
    </div>
  );
}
