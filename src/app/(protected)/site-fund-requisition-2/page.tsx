
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { FileText, BarChart3, Settings, GitMerge } from 'lucide-react';
import Link from 'next/link';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { WorkflowStep } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';


interface DashboardCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

function DashboardCard({ item }: DashboardCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base font-bold">{item.text}</CardTitle>
                    <CardDescription className="text-xs">{item.description}</CardDescription>
                </div>
            </CardHeader>
        </Card>
    );

    if (item.href === '#' || item.disabled) {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}

export default function SiteFundRequisition2Page() {
  const { toast } = useToast();
  const { can, isLoading: authIsLoading } = useAuthorization();
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canViewModule = useMemo(() => can('View Module', 'Site Fund Requisition 2'), [can]);

  useEffect(() => {
    if (authIsLoading) return;
    if (!canViewModule) {
      setIsLoading(false);
      return;
    }

    const fetchWorkflow = async () => {
      setIsLoading(true);
      try {
        const workflowRef = doc(db, 'workflows', 'site-fund-requisition-2-workflow');
        const snap = await getDoc(workflowRef);
        if (snap.exists()) {
          const stepsData = (snap.data()?.steps as WorkflowStep[]) || [];
          const validSteps = stepsData.filter(s => s && s.id && s.name);
          setWorkflowSteps(validSteps);
        }
      } catch (error) {
        console.error("Failed to fetch workflow:", error);
        toast({ title: 'Error', description: 'Could not load workflow configuration.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    fetchWorkflow();
  }, [canViewModule, authIsLoading, toast]);
  
  const dashboardItems = useMemo(() => {
    const staticItems = [
      {
        icon: FileText,
        text: 'Manage Requests',
        href: '/site-fund-requisition-2/requests',
        description: 'Manage all requests for this module.',
        disabled: !can('View', 'Site Fund Requisition 2.Requests'),
      },
      {
        icon: BarChart3,
        text: 'Reports',
        href: '#',
        description: 'View reports for this module.',
        disabled: true, // Assuming no reports permission yet
      },
      {
        icon: Settings,
        text: 'Settings',
        href: '/site-fund-requisition-2/settings',
        description: 'Configure settings for this module.',
        disabled: !can('View', 'Site Fund Requisition 2.Settings'),
      },
    ];

    const workflowItems = workflowSteps.map(step => ({
      icon: GitMerge,
      text: step.name,
      href: `/site-fund-requisition-2/stage/${step.id}`,
      description: `Tasks for the ${step.name} stage.`,
      disabled: !can('View', 'Site Fund Requisition 2.Requests'),
    }));
    
    return [staticItems[0], ...workflowItems, ...staticItems.slice(1)];
  }, [workflowSteps, can]);

  if (isLoading || authIsLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <Skeleton className="h-8 w-64 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-bold mb-6">Site Fund Requisition 2</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {dashboardItems.map((item) => (
          <DashboardCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
