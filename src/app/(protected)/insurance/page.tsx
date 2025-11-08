
'use client';

import { useState } from 'react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ShieldAlert } from 'lucide-react';
import AllPoliciesTab from '@/components/AllPoliciesTab';

export default function InsuranceDashboardPage() {
  const { can, isLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Insurance');

  if (isLoading) {
    return (
        <div className="w-full">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-40" />)}
            </div>
        </div>
    )
  }

  if (!canViewModule) {
      return (
        <div className="w-full">
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to access the Insurance module.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
      )
  }
  
  return (
    <div className="flex flex-col w-full h-full">
      <AllPoliciesTab />
    </div>
  );
}
