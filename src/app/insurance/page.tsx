

'use client';

import { useState } from 'react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ShieldAlert } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AllPoliciesTab from './all-policies/page';

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
      <Tabs defaultValue="all-policies" className="flex flex-col h-full">
        <div className="flex-shrink-0">
          <TabsList className="bg-transparent p-0 border-b rounded-none w-full justify-start">
            <TabsTrigger value="dashboard" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">Dashboard</TabsTrigger>
            <TabsTrigger value="all-policies" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">All Policies</TabsTrigger>
            <TabsTrigger value="pending-tasks" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">Pending At Me</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">My History</TabsTrigger>
          </TabsList>
        </div>
        <div className="flex-grow pt-6">
          <TabsContent value="dashboard">
            Dashboard content will go here.
          </TabsContent>
          <TabsContent value="all-policies">
            <AllPoliciesTab />
          </TabsContent>
          <TabsContent value="pending-tasks">
            Pending tasks will be shown here.
          </TabsContent>
           <TabsContent value="history">
            Your history will be shown here.
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

