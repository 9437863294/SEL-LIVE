
'use client';

import { Suspense } from 'react';
import { LoginPageContent } from '@/components/auth/LoginPageContent';
import { Skeleton } from '@/components/ui/skeleton';

function LoginPageLoading() {
    return (
        <div className="relative flex min-h-screen items-center justify-center bg-cover bg-center p-4" style={{ backgroundImage: "url('https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2Frm378-062.jpg?alt=media&token=91cf2e4f-e362-4a09-a283-a6ae2d64b55f')"}}>
            <div className="absolute inset-0 bg-black/30" />
            <div className="relative grid grid-cols-1 md:grid-cols-2 max-w-4xl w-full rounded-2xl shadow-2xl overflow-hidden bg-background/90">
                <div className="hidden md:block p-12">
                    <Skeleton className="h-full w-full rounded-2xl" />
                </div>
                <div className="p-8 md:p-12 flex flex-col justify-center items-center">
                    <Skeleton className="h-20 w-4/5 mb-8" />
                    <Skeleton className="h-10 w-full mb-4" />
                    <Skeleton className="h-10 w-full mb-8" />
                    <Skeleton className="h-10 w-full" />
                </div>
            </div>
        </div>
    )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageLoading />}>
      <LoginPageContent />
    </Suspense>
  );
}
