
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
            <TabsTrigger value="dashboard" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">Dashboard</TabsTrigger>
            <TabsTrigger value="all-requisitions" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">All Requisitions</TabsTrigger>
            <TabsTrigger value="pending-tasks" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">Pending At Me</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none">My History</TabsTrigger>
          </TabsList>
        </div>
        <div className="flex-grow pt-6 pr-4">
          <TabsContent value="dashboard" className="h-full">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {stats.map((stat, index) => (
                <Card key={index}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                    <stat.icon className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stat.value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
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
