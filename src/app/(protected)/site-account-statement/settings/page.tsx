'use client';

import dynamic from 'next/dynamic';
import { Loader2, Settings, ShieldAlert, Tags } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

const ProjectSetupTab = dynamic(() => import('./projects/page'), {
  loading: TabLoader,
  ssr: false,
});

const ExpenseCategoriesTab = dynamic(() => import('../expense-categories/page'), {
  loading: TabLoader,
  ssr: false,
});

const BudgetAlertsTab = dynamic(() => import('../budget-alerts/page'), {
  loading: TabLoader,
  ssr: false,
});

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="projects" className="space-y-4">
        <TabsList className="h-10 grid w-full grid-cols-3 sm:inline-flex sm:w-auto">
          <TabsTrigger value="projects" className="gap-1.5 text-xs sm:text-sm px-3">
            <Settings className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Project</span> Setup
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-1.5 text-xs sm:text-sm px-3">
            <Tags className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Expense</span> Categories
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5 text-xs sm:text-sm px-3">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            Budget Alerts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4">
          <ProjectSetupTab />
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <ExpenseCategoriesTab />
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <BudgetAlertsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
