
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
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
                "group flex flex-col h-full overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_80px_-55px_rgba(2,6,23,0.55)]",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70" />
            <CardHeader className="flex-row items-center gap-4 space-y-0 p-5">
                <div className="rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm transition-colors group-hover:bg-white">
                  <item.icon className="h-6 w-6 text-slate-900/80" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base font-semibold text-slate-900">{item.text}</CardTitle>
                    <CardDescription className="mt-1 text-xs text-slate-600">{item.description}</CardDescription>
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
  const [workflowError, setWorkflowError] = useState<string | null>(null);

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
        setWorkflowError('Failed to load workflow configuration.');
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
        href: '/site-fund-requisition-2/reports',
        description: 'View reports for this module.',
        disabled: !can('View', 'Site Fund Requisition 2.Reports'),
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
    <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Site Fund Requisition 2
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            Module Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Jump into requests, reports, settings, or stage-wise tasks.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <div className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-slate-600 backdrop-blur">
            Live workflow stages
          </div>
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {dashboardItems.map((item) => (
          <DashboardCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
