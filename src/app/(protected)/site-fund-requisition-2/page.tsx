
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { ModuleTile, ModuleTileGrid, ModuleTileSkeletons, moduleTileGradient, type ModuleTileItem } from '@/components/shared/module-tile';
import { FileText, BarChart3, Settings, GitMerge } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { WorkflowStep } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

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
  
  const dashboardItems = useMemo((): ModuleTileItem[] => {
    const staticItems: ModuleTileItem[] = [
      {
        icon: FileText,
        title: 'Manage Requests',
        href: '/site-fund-requisition-2/requests',
        description: 'Manage all requests for this module.',
        gradient: 'from-indigo-500 to-blue-600',
        disabled: !can('View', 'Site Fund Requisition 2.Requests'),
      },
      {
        icon: BarChart3,
        title: 'Reports',
        href: '/site-fund-requisition-2/reports',
        description: 'View reports for this module.',
        gradient: 'from-teal-500 to-cyan-600',
        disabled: !can('View', 'Site Fund Requisition 2.Reports'),
      },
      {
        icon: Settings,
        title: 'Settings',
        href: '/site-fund-requisition-2/settings',
        description: 'Configure settings for this module.',
        gradient: 'from-slate-500 to-slate-700',
        disabled: !can('View', 'Site Fund Requisition 2.Settings'),
      },
    ];

    // Each stage takes the next colour round, so neighbouring stages stay tellable apart.
    const workflowItems = workflowSteps.map((step, index): ModuleTileItem => ({
      icon: GitMerge,
      title: step.name,
      href: `/site-fund-requisition-2/stage/${step.id}`,
      description: `Tasks for the ${step.name} stage.`,
      gradient: moduleTileGradient(index + 1),
      disabled: !can('View', 'Site Fund Requisition 2.Requests'),
    }));
    
    return [staticItems[0], ...workflowItems, ...staticItems.slice(1)];
  }, [workflowSteps, can]);

  if (isLoading || authIsLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <Skeleton className="h-8 w-64 mb-6" />
        <ModuleTileSkeletons count={4} />
      </div>
    );
  }

  return (
    <div className="w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
      <PageHeader
        eyebrow="Site Fund Requisition 2"
        title="Module Dashboard"
        description="Jump into requests, reports, settings, or stage-wise tasks."
        badge={
          <StatusBadge status="Live" dot className="hidden sm:inline-flex">
            Live workflow stages
          </StatusBadge>
        }
      />

      <ModuleTileGrid>
        {dashboardItems.map((item) => (
          <ModuleTile key={item.href} item={item} />
        ))}
      </ModuleTileGrid>
    </div>
  );
}
