
'use client';

import { Suspense } from 'react';
import { PrintAuthPageContent } from '@/components/auth/PrintAuthPageContent';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardContent } from '@/components/ui/card';

function PrintAuthPageLoading() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
            <Card className="max-w-sm w-full">
                <CardHeader>
                    <Skeleton className="h-6 w-3/4 mx-auto" />
                </CardHeader>
                <CardContent className="space-y-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </CardContent>
            </Card>
        </div>
    );
}


export default function PrintAuthPage() {
  return (
    <Suspense fallback={<PrintAuthPageLoading />}>
      <PrintAuthPageContent />
    </Suspense>
  );
}
