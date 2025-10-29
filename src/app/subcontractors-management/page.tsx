
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Folder,
  ShieldAlert,
  Home,
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

export default function SubcontractorsRedirectPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Subcontractors Management');

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }
    if (!canViewModule) {
      setIsLoading(false);
      return;
    }

    const findAndRedirect = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'projects'));
        
        if (querySnapshot.empty) {
          // Stay on this page to show a message if no projects are found
          setIsLoading(false);
          return;
        }

        const firstProject = querySnapshot.docs[0].data() as Project;
        const firstProjectSlug = slugify(firstProject.projectName);

        // Redirect to the JMC subcontractors page for that project
        router.replace(`/billing-recon/${firstProjectSlug}/jmc/subcontractors`);

      } catch (error) {
        console.error("Error fetching projects for redirect:", error);
        setIsLoading(false);
      }
    };

    findAndRedirect();
  }, [router, canViewModule, isAuthLoading]);

  if (isLoading || isAuthLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-48 w-full max-w-lg" />
        </div>
      </div>
    );
  }

  if (!canViewModule) {
      return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="icon" aria-label="Home">
              <Home className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Subcontractors Management</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access Subcontractors Management.
            </CardDescription>
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
      </div>
        <Card>
          <CardHeader>
            <CardTitle>No Projects Found</CardTitle>
            <CardDescription>
              There are no projects available. Please create a project in the settings to manage subcontractors.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/settings/project">
              <Button variant="outline">Go to Project Settings</Button>
            </Link>
          </CardContent>
        </Card>
    </div>
  );
}
