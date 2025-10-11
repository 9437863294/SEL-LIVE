

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Folder,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Project } from '@/lib/types';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

interface ProjectCardProps {
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

function ProjectCard({ item }: ProjectCardProps) {
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


export default function StoreStockDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Store & Stock Management');

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
    .filter(project => project.stockManagementRequired === true)
    .map(project => ({
      icon: Folder,
      text: project.projectName,
      href: `/store-stock-management/${slugify(project.projectName)}`,
      description: `Manage stock for ${project.projectName}.`
  }));
  
  if (isAuthLoading || (isLoading && canViewModule)) {
      return (
        <div className="w-full p-6">
          <Skeleton className="h-8 w-64 mb-6" />
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
        <div className="w-full p-6">
             <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to access the Store & Stock Management module.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
      );
  }


  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Select a Project</h1>
       <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {projectItems.map((item) => (
            <ProjectCard key={item.text} item={item} />
          ))}
      </div>
    </div>
  );
}
