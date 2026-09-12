

'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  FilePlus,
  History,
  ShieldAlert,
  FileClock,
  Settings,
  GitMerge,
  FileText,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { useMemo, useState, useEffect, useCallback } from 'react';
import type { WorkflowStep } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { PmContent, PmNavCard, PmNavCardGrid, PmTopbar } from '@/components/project-management/pm-shell';

export default function BillingDashboardPage() {
  const params = useParams();
  const projectSlug = params.project as string;
  const { can, isLoading } = useAuthorization();
  const { toast } = useToast();
  
  const isAllProjectsView = projectSlug === 'all';

  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(true);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  const safeCan = useCallback((action: string, resource: string, scope?: string) => {
    if (isLoading) return false;
    try {
      return can(action, resource, scope);
    } catch {
      return false;
    }
  }, [can, isLoading]);

  useEffect(() => {
    const fetchWorkflow = async () => {
      setIsWorkflowLoading(true);
      try {
        const workflowRef = doc(db, 'workflows', 'billing-workflow');
        const snap = await getDoc(workflowRef);
        if (snap.exists()) {
          const stepsData = (snap.data()?.steps as WorkflowStep[]) || [];
          const validSteps = stepsData.filter(s => s && s.id && s.name);
          setWorkflowSteps(validSteps);
        }
      } catch (error) {
        console.error("Failed to fetch workflow:", error);
        toast({ title: 'Error', description: 'Could not load workflow configuration.', variant: 'destructive'});
      } finally {
        setIsWorkflowLoading(false);
      }
    };
    fetchWorkflow();
  }, [toast]);
  
  const billingItems = useMemo(() => {
      const staticItems = [
        { icon: FilePlus, gradient: 'from-emerald-500 to-teal-600', text: 'Bill Entry', href: `/subcontractors-management/${projectSlug}/billing/create`, description: 'Generate a new bill from JMC items.', disabled: !safeCan('Create Bill', 'Subcontractors Management.Billing', projectSlug) || isAllProjectsView },
        { icon: FileText, gradient: 'from-amber-500 to-orange-600', text: 'Retention Bill', href: `/subcontractors-management/${projectSlug}/billing/retention-bill`, description: 'Create a bill to claim withheld retention amount.', disabled: !safeCan('Create Bill', 'Subcontractors Management.Billing', projectSlug) || isAllProjectsView },
        { icon: FileClock, gradient: 'from-violet-500 to-purple-600', text: 'Proforma/Advance Bill', href: `/subcontractors-management/${projectSlug}/billing/proforma`, description: 'Create proforma or advance bills.', disabled: !safeCan('Proforma/Advance Bill', 'Subcontractors Management.Billing', projectSlug) || isAllProjectsView },
        { icon: History, gradient: 'from-sky-500 to-blue-600', text: 'Billing Log', href: `/subcontractors-management/${projectSlug}/billing/log`, description: 'View and manage all past regular and proforma bills.', disabled: !safeCan('View Log', 'Subcontractors Management.Billing') },
        { icon: Settings, gradient: 'from-slate-500 to-slate-700', text: 'Settings', href: `/subcontractors-management/${projectSlug}/billing/settings`, description: 'Configure billing settings.', disabled: !safeCan('View Settings', 'Subcontractors Management.Billing') || isAllProjectsView },
      ];

      const workflowItems = workflowSteps.map(step => ({
          icon: GitMerge,
          gradient: 'from-rose-500 to-pink-600',
          text: step.name,
          href: `/subcontractors-management/${projectSlug}/billing/stage/${step.id}`,
          description: `Tasks for the ${step.name} stage.`,
          disabled: !safeCan('View', 'Subcontractors Management.Billing') || isAllProjectsView,
      }));

      return [...staticItems.slice(0, 3), ...workflowItems, ...staticItems.slice(3)];
  }, [projectSlug, safeCan, isAllProjectsView, workflowSteps]);
  
  const canViewModule = isAllProjectsView ? can('View', 'Subcontractors Management.Billing') : can('View', 'Subcontractors Management.Billing', projectSlug);


  if(isLoading || isWorkflowLoading) {
    return (
        <PmContent>
            <Skeleton className="h-9 w-64" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 rounded-xl" />
                ))}
            </div>
       </PmContent>
    )
  }

  if(!canViewModule) {
    return (
      <PmContent>
         <Card className="border-border/60">
            <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to access billing management.</CardDescription></CardHeader>
            <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </PmContent>
    );
  }

  return (
    <>
      <PmTopbar
        title="Billing"
        breadcrumbs={[
          { label: 'Subcontractors', href: `/subcontractors-management/${projectSlug}` },
        ]}
        backHref={`/subcontractors-management/${projectSlug}`}
        backLabel="Back to Subcontractors"
      />
      <PmContent>
        <PmNavCardGrid>
          {billingItems.map((item) => (
            <PmNavCard key={item.text} item={{ icon: item.icon, title: item.text, description: item.description, href: item.href, gradient: item.gradient, disabled: item.disabled }} />
          ))}
        </PmNavCardGrid>
      </PmContent>
    </>
  );
}
