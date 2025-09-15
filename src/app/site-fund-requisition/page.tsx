'use client';

import { SiteFundDashboard } from '@/components/site-fund-dashboard';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';


export default function SiteFundRequisitionPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
        if (!currentUser) {
            router.replace('/login');
        } else {
            setLoading(false);
        }
    });

    return () => {
        unsubscribeAuth();
    };
  }, [router]);
  
  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        <header className="sticky top-0 z-10 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
                <div className="flex items-center gap-4">
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-6 w-48" />
                </div>
                <div className="flex items-center gap-4">
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-8 w-8" />
                </div>
            </div>
        </header>
        <main className="container mx-auto p-4 sm:p-6 lg:p-8 flex-grow">
            <Skeleton className="h-full w-full" />
        </main>
      </div>
    );
  }

  return (
    <SiteFundDashboard />
  );
}
