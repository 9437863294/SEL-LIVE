'use client';

import { Suspense } from 'react';
import DriverLoginPageContent from '@/components/auth/DriverLoginPageContent';
import { Skeleton } from '@/components/ui/skeleton';

function DriverLoginLoading() {
  return (
    <div className="min-h-screen p-4 bg-slate-950">
      <div className="mx-auto mt-20 max-w-md space-y-3">
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </div>
  );
}

export default function DriverLoginPage() {
  return (
    <Suspense fallback={<DriverLoginLoading />}>
      <DriverLoginPageContent />
    </Suspense>
  );
}

