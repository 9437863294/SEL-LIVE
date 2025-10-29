
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ShieldAlert, Home } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

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

export default function BillingReconRedirectPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Billing Recon');

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
        const q = query(collection(db, 'projects'), where('billingRequired', '==', true));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
          // Stay on this page to show a message if no projects are found
          setIsLoading(false);
          return;
        }

        const firstProject = querySnapshot.docs[0].data() as Project;
        const firstProjectSlug = slugify(firstProject.projectName);

        // Perform the redirect
        router.replace(`/billing-recon/${firstProjectSlug}`);

      } catch (error) {
        console.error("Error fetching projects for redirect:", error);
        setIsLoading(false); // Stop loading to show an error or empty state
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
          <h1 className="text-2xl font-bold">Billing &amp; Reconciliation</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access the Billing &amp; Reconciliation module.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // This content is shown if the redirect hasn't happened yet, or if no projects are found.
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="icon" aria-label="Home">
              <Home className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Billing &amp; Reconciliation</h1>
        </div>
      </div>
        <Card>
          <CardHeader>
            <CardTitle>No Billable Projects Found</CardTitle>
            <CardDescription>
              There are no projects configured for billing. Please enable billing for a project in the settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/billing-recon/settings">
              <Button variant="outline">Go to Settings</Button>
            </Link>
          </CardContent>
        </Card>
    </div>
  );
}
