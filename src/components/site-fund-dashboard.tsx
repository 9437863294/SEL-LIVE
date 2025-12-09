
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Clock, Users } from 'lucide-react';
import AllRequisitionsTab from '@/components/AllRequisitionsTab';
import MyPendingTasksTab from '@/components/MyPendingTasksTab';

const stats = [
    { title: 'Pending Requisitions', value: '2', icon: Clock },
    { title: 'Total Completed', value: '1', icon: Users }
];

export function SiteFundDashboard() {
  return (
    <div className="flex flex-col w-full h-full">
      <Tabs defaultValue="all-requisitions" className="flex flex-col h-full">
        <div className="flex-shrink-0">
          <TabsList className="bg-transparent p-0 border-b rounded-none w-full justify-start">
            <TabsTrigger value="all-requisitions" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">All Requisitions</TabsTrigger>
            <TabsTrigger value="pending-tasks" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">Pending At Me</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">My History</TabsTrigger>
          </TabsList>
        </div>
        <div className="flex-grow pt-6 pr-4">
          <TabsContent value="all-requisitions" className="h-full">
            <AllRequisitionsTab />
          </TabsContent>
          <TabsContent value="pending-tasks" className="h-full">
            <MyPendingTasksTab />
          </TabsContent>
          <TabsContent value="history" className="h-full">
            <p className="text-muted-foreground">Your history will be shown here.</p>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
