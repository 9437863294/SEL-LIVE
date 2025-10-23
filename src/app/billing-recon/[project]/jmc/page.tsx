
'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  FilePlus,
  ClipboardCheck,
  History,
  ShieldAlert,
  type LucideIcon,
  Settings,
  GitMerge,
  Loader2
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { useMemo, useState, useEffect } from 'react';
import type { WorkflowStep } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

type JmcItem = {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
};

interface JmcCardProps {
  item: JmcItem;
}

function JmcCard({ item }: JmcCardProps) {
  const isDisabled = item.href === '#' || item.disabled;

  const card = (
    <Card
      className={cn(
        'flex flex-col h-full transition-all duration-300 ease-in-out bg-background rounded-xl border-border/80',
        !isDisabled && 'hover:shadow-lg hover:border-primary/50',
        isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}
      aria-disabled={isDisabled || undefined}
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

  if (isDisabled) {
    return (
      <div className="h-full" title="You don't have permission for this" tabIndex={-1}>
        {card}
      </div>
    );
  }

  return (
    <Link href={item.href} className="no-underline h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-xl">
      {card}
    </Link>
  );
}

export default function JmcPage() {
  const params = useParams<{ project: string }>();
  const projectSlug = params.project;
  const { can, isLoading: authIsLoading } = useAuthorization();
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(true);

  useEffect(() => {
    const fetchWorkflow = async () => {
      setIsWorkflowLoading(true);
      try {
        const workflowRef = doc(db, 'workflows', 'jmc-workflow');
        const workflowSnap = await getDoc(workflowRef);
        if (workflowSnap.exists()) {
          setWorkflowSteps(workflowSnap.data().steps as WorkflowStep[]);
        }
      } catch (error) {
        console.error("Failed to fetch workflow steps:", error);
      }
      setIsWorkflowLoading(false);
    };

    if (!authIsLoading) {
      fetchWorkflow();
    }
  }, [authIsLoading]);

  const jmcItems: JmcItem[] = useMemo(() => {
    if (authIsLoading || isWorkflowLoading) return [];
    
    const staticItems = [
       {
        icon: FilePlus,
        text: 'Create JMC',
        href: `/billing-recon/${projectSlug}/jmc/entry`,
        description: 'Create a Joint Measurement Certificate.',
        disabled: !can('Create JMC Entry', 'Billing Recon.JMC'),
      },
      {
        icon: History,
        text: 'JMC Log',
        href: `/billing-recon/${projectSlug}/jmc/log`,
        description: 'View and manage all existing JMC entries.',
        disabled: !can('View Log', 'Billing Recon.JMC'),
      },
      {
        icon: Settings,
        text: 'Settings',
        href: `/billing-recon/${projectSlug}/jmc/settings`,
        description: 'Configure JMC module settings.',
        disabled: !can('View Settings', 'Billing Recon.JMC'),
      },
    ];

    const workflowItems = workflowSteps.map(step => ({
      icon: GitMerge,
      text: step.name,
      href: `/billing-recon/${projectSlug}/jmc/stage/${step.id}`,
      description: `Tasks for the ${step.name} stage.`,
      disabled: !can('View', 'Billing Recon.JMC'), // Simplified permission, could be more granular
    }));

    return [...workflowItems, ...staticItems];

  }, [projectSlug, authIsLoading, isWorkflowLoading, can, workflowSteps]);

  const canViewModule = can('View', 'Billing Recon.JMC');
  const isLoading = authIsLoading || isWorkflowLoading;

  if (isLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href={`/billing-recon/${projectSlug}`}>
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">JMC Management</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access JMC management.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href={`/billing-recon/${projectSlug}`}>
          <Button variant="ghost" size="icon" aria-label="Back">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">JMC Management</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {jmcItems.map((item) => (
          <JmcCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
