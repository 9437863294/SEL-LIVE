
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const slugify = (text: string) => {
    if (!text) return '';
    return text.toString().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
}

export default function StoreStockDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Store & Stock Management');
  const router = useRouter();

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewModule) {
      setIsLoading(false);
      return;
    }

    const fetchProjects = async () => {
        setIsLoading(true);
        try {
            const q = query(collection(db, 'projects'), where('stockManagementRequired', '==', true));
            const querySnapshot = await getDocs(q);
            const projectsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
            setProjects(projectsData);
        } catch (error) {
            console.error("Error fetching projects: ", error);
        }
        setIsLoading(false);
    };
    fetchProjects();
  }, [isAuthLoading, canViewModule]);

  const handleProjectChange = (slug: string) => {
    if (!slug) return;
    router.push(`/store-stock-management/${slug}`);
  };
  
  if (isAuthLoading || (isLoading && canViewModule)) {
      return (
        <div className="w-full p-6">
          <Skeleton className="h-8 w-64 mb-6" />
          <Card>
            <CardHeader>
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
            </CardHeader>
            <CardContent>
                <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      );
  }

  if (!canViewModule) {
      return (
        <div className="w-full p-6">
             <h1 className="text-3xl font-bold mb-6">Store & Stock Management</h1>
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
    <div className="flex justify-center items-center h-full p-6">
      <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
              <div className="mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4">
                <Folder className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Select a Project</CardTitle>
              <CardDescription>Choose a project to manage its store and stock.</CardDescription>
          </CardHeader>
          <CardContent>
              <Select onValueChange={handleProjectChange} disabled={isLoading || projects.length === 0}>
                  <SelectTrigger className="w-full h-12 text-base">
                      <SelectValue placeholder="Select a project..." />
                  </SelectTrigger>
                  <SelectContent>
                      {projects.map((p) => (
                          <SelectItem key={p.id} value={slugify(p.projectName)}>
                              {p.projectName}
                          </SelectItem>
                      ))}
                  </SelectContent>
              </Select>
          </CardContent>
      </Card>
    </div>
  );
}
