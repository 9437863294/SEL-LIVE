
'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  FilePlus,
  History,
  ShieldAlert,
  type LucideIcon,
  Settings,
  GitMerge,
  BarChart3,
  Users,
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
import { useMemo, useState, useEffect, useCallback } from 'react';
import type { WorkflowStep } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

/* ---------------- types ---------------- */
type MvacItem = {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
};

interface MvacCardProps {
  item: MvacItem;
}

/* ---------------- utils ---------------- */
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

/* ---------------- components ---------------- */
function MvacCard({ item }: MvacCardProps) {
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
    return <div className="h-full">{card}</div>;
  }

  return (
    <Link
      href={item.href}
      className="no-underline h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-xl"
    >
      {card}
    </Link>
  );
}

/* ---------------- page ---------------- */
export default function MvacPage() {
  const { toast } = useToast();
  const params = useParams<{ project: string }>();
  const projectSlug = params?.project ?? '';

  const { can, isLoading: authIsLoading } = useAuthorization();

  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(true);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  /* ---------- permission checks ---------- */
  const canViewModule = useMemo(() => {
    if (authIsLoading) return false;
    return can('View', 'Billing Recon.MVAC', projectSlug);
  }, [authIsLoading, can, projectSlug]);

  const canCreate = useMemo(() => {
    if (authIsLoading) return false;
    return can('Create MVAC Entry', 'Billing Recon.MVAC', projectSlug);
  }, [authIsLoading, can, projectSlug]);

  const canViewLog = useMemo(() => {
    if (authIsLoading) return false;
    return can('View Log', 'Billing Recon.MVAC', projectSlug);
  }, [authIsLoading, can, projectSlug]);
  
  const canManageSubcontractors = useMemo(() => {
    if (authIsLoading) return false;
    return can('Manage Subcontractors', 'Subcontractors Management');
  }, [authIsLoading, can]);

  const canViewReports = useMemo(() => {
    if (authIsLoading) return false;
    return can('View Reports', 'Billing Recon.MVAC', projectSlug);
  }, [authIsLoading, can, projectSlug]);

  const canViewSettings = useMemo(() => {
    if (authIsLoading) return false;
    return can('View Settings', 'Billing Recon.MVAC', projectSlug);
  }, [authIsLoading, can, projectSlug]);

  const canViewStages = useMemo(() => {
    if (authIsLoading) return false;
    return can('View', 'Billing Recon.MVAC', projectSlug);
  }, [authIsLoading, can, projectSlug]);

  /* ---------- fetch workflow ---------- */
  useEffect(() => {
    const fetchWorkflow = async () => {
      if (authIsLoading) return;
      setIsWorkflowLoading(true);
      setWorkflowError(null);

      try {
        const workflowRef = doc(db, 'workflows', 'mvac-workflow');
        const snap = await getDoc(workflowRef);

        const rawSteps = (snap.exists() ? (snap.data()?.steps as WorkflowStep[] | undefined) : []) ?? [];

        // Defensive: ensure valid array of steps with id + name
        const steps: WorkflowStep[] = (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((s) => s && (s as any).name)
          .map((s) => ({
            ...s,
            id: (s as any).id || slugify((s as any).name),
            name: (s as any).name,
          }));

        setWorkflowSteps(steps);
      } catch (error) {
        console.error('Failed to fetch workflow steps:', error);
        setWorkflowError('Failed to load workflow configuration.');
        toast({
          title: 'Could not load workflow',
          description: 'Please try again later.',
          variant: 'destructive',
        });
      } finally {
        setIsWorkflowLoading(false);
      }
    };

    fetchWorkflow();
  }, [authIsLoading, toast]);

  /* ---------- cards ---------- */
  const MvacItems: MvacItem[] = useMemo(() => {
    if (authIsLoading || isWorkflowLoading) return [];

    const staticItems: MvacItem[] = [
      {
        icon: FilePlus,
        text: 'Create MVAC',
        href: projectSlug ? `/billing-recon/${projectSlug}/mvac/entry` : '#',
        description: 'Create a Joint Measurement Certificate.',
        disabled: !canCreate || !projectSlug,
      },
      {
        icon: History,
        text: 'MVAC Log',
        href: projectSlug ? `/billing-recon/${projectSlug}/mvac/log` : '#',
        description: 'View and manage all existing MVAC entries.',
        disabled: !canViewLog || !projectSlug,
      },
      {
        icon: BarChart3,
        text: 'Reports',
        href: projectSlug ? `/billing-recon/${projectSlug}/mvac/reports` : '#',
        description: 'View MVAC-related reports.',
        disabled: !canViewReports || !projectSlug,
      },
      {
        icon: Settings,
        text: 'Settings',
        href: projectSlug ? `/billing-recon/${projectSlug}/mvac/settings` : '#',
        description: 'Configure MVAC module settings.',
        disabled: !canViewSettings || !projectSlug,
      },
    ];

    const workflowItems: MvacItem[] = (workflowSteps || []).map((step) => ({
      icon: GitMerge,
      text: step.name,
      href: projectSlug ? `/billing-recon/${projectSlug}/mvac/stage/${step.id}` : '#',
      description: `Tasks for the ${step.name} stage.`,
      disabled: !canViewStages || !projectSlug,
    }));

    return [...staticItems.slice(0, 1), ...workflowItems, ...staticItems.slice(1)];
  }, [
    projectSlug,
    authIsLoading,
    isWorkflowLoading,
    workflowSteps,
    canCreate,
    canManageSubcontractors,
    canViewLog,
    canViewSettings,
    canViewStages,
    canViewReports,
  ]);

  const isLoading = authIsLoading || isWorkflowLoading;

  /* ---------- rendering ---------- */
  if (isLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href={projectSlug ? `/billing-recon/${projectSlug}` : '#'}>
            <Button variant="ghost" size="icon" aria-label="Back">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">MVAC Management</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access MVAC management.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const showEmpty = !workflowError && MvacItems.length === 0;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href={projectSlug ? `/billing-recon/${projectSlug}` : '#'}>
          <Button variant="ghost" size="icon" aria-label="Back">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">MVAC Management</h1>
      </div>

      {workflowError ? (
        <Card>
          <CardHeader>
            <CardTitle>Workflow unavailable</CardTitle>
            <CardDescription>{workflowError}</CardDescription>
          </CardHeader>
        </Card>
      ) : showEmpty ? (
        <Card>
          <CardHeader>
            <CardTitle>No MVAC actions available</CardTitle>
            <CardDescription>
              You might not have permissions for any MVAC actions, or the workflow has no stages configured.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {MvacItems.map((item) => (
            <MvacCard key={`${item.text}-${item.href}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
