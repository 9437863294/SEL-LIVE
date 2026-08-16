
'use client';

import {
  ClipboardList,
  FilePlus,
  History,
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
} from '@/components/ui/card';
import { useSearchParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useMemo, useState, useEffect, useCallback } from 'react';
import type { WorkflowStep } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useProjectManagementJmcContext } from '@/components/jmc/use-jmc-host-context';
import {
  JMC_GRADIENT,
  JMC_SETTINGS_GRADIENT,
  JmcAccessDenied,
  JmcCardGridLoadingState,
  JmcNavCard,
  JmcNavCardGrid,
  JmcPageHeader,
  JmcPageShell,
  JmcProjectNotFound,
} from '@/components/jmc/jmc-page-shell';
import { JmcNav } from '@/components/jmc/jmc-nav';

/* ---------------- types ---------------- */
type JmcItem = {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
  gradient?: string;
};

/* ---------------- page ---------------- */
export default function JmcPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get('project') ?? '';
  const { context, isResolving, notFound, projectName } = useProjectManagementJmcContext(mappingId);

  const { can, isLoading: authIsLoading } = useAuthorization();

  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(true);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  /* ---------- permission checks ---------- */
  const canViewModule = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('View', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context]);

  const canCreate = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('Create JMC Entry', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context]);

  const canViewLog = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('View Log', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context]);

  const canManageSubcontractors = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('Manage Subcontractors', 'Subcontractors Management');
    } catch {
      return false;
    }
  }, [authIsLoading, can]);

  const canViewReports = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('View Reports', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context]);

  const canViewSettings = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('View Settings', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context]);

  const canViewStages = useMemo(() => {
    if (authIsLoading) return false;
    // Broad view permission for stages
    try {
      return can('View', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context]);

  /* ---------- fetch workflow ---------- */
  useEffect(() => {
    const fetchWorkflow = async () => {
      if (authIsLoading) return;
      setIsWorkflowLoading(true);
      setWorkflowError(null);

      try {
        const workflowRef = doc(db, 'workflows', 'jmc-workflow');
        const snap = await getDoc(workflowRef);

        const rawSteps = (snap.exists() ? (snap.data()?.steps as WorkflowStep[] | undefined) : []) ?? [];

        // Defensive: ensure valid array of steps with id + name
        const steps: WorkflowStep[] = (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((s) => s && (s as any).name)
          .map((s, index) => ({
            ...s,
            id: String(s.id || index + 1), // Ensure every step has an ID
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
  const jmcItems: JmcItem[] = useMemo(() => {
    if (authIsLoading || isWorkflowLoading) return [];

    const staticItems: JmcItem[] = [
      {
        icon: FilePlus,
        text: 'Create JMC',
        href: context.jmcHref('entry'),
        description: 'Create a Joint Measurement Certificate.',
        disabled: !canCreate || !mappingId,
      },
      {
        icon: History,
        text: 'JMC Log',
        href: context.jmcHref('log'),
        description: 'View and manage all existing JMC entries.',
        disabled: !canViewLog || !mappingId,
      },
      {
        icon: BarChart3,
        text: 'Reports',
        href: context.jmcHref('reports'),
        description: 'View JMC-related reports.',
        disabled: !canViewReports || !mappingId,
      },
      {
        icon: Settings,
        text: 'Settings',
        href: context.jmcHref('settings'),
        description: 'Configure JMC module settings.',
        disabled: !canViewSettings || !mappingId,
        gradient: JMC_SETTINGS_GRADIENT,
      },
    ];

    const workflowItems: JmcItem[] = (workflowSteps || []).map((step) => ({
      icon: GitMerge,
      text: step.name,
      href: context.jmcHref(`stage/${step.id}`),
      description: `Tasks for the ${step.name} stage.`,
      disabled: !canViewStages || !mappingId,
    }));

    return [...staticItems.slice(0, 1), ...workflowItems, ...staticItems.slice(1)];
  }, [
    mappingId,
    context,
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

  const isLoading = authIsLoading || isWorkflowLoading || isResolving;

  /* ---------- rendering ---------- */
  if (isLoading) {
    return <JmcCardGridLoadingState tiles={6} />;
  }

  if (!canViewModule) {
    return <JmcAccessDenied description="You do not have permission to access JMC management." />;
  }

  if (notFound) {
    return (
      <JmcProjectNotFound description="This JMC workspace could not be matched to a Project Management project. Pick a project from the Civil workspace and open JMC from there." />
    );
  }

  const showEmpty = !workflowError && jmcItems.length === 0;

  return (
    <JmcPageShell>
      <JmcPageHeader
        title="JMC Management"
        subtitle={
          projectName
            ? `Joint Measurement Certificates for ${projectName} — raise entries, work each stage, and review the log.`
            : 'Joint Measurement Certificates — raise entries, work each stage, and review the log.'
        }
        icon={ClipboardList}
        backHref={context.parentHref}
        gradient={JMC_GRADIENT}
      />

      <JmcNav context={context} active="hub" />

      {workflowError ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Workflow unavailable</CardTitle>
            <CardDescription>{workflowError}</CardDescription>
          </CardHeader>
        </Card>
      ) : showEmpty ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>No JMC actions available</CardTitle>
            <CardDescription>
              You might not have permissions for any JMC actions, or the workflow has no stages configured.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <JmcNavCardGrid>
          {jmcItems.map((item) => (
            <JmcNavCard
              key={`${item.text}-${item.href}`}
              title={item.text}
              description={item.description}
              href={item.href}
              icon={item.icon}
              gradient={item.gradient}
              disabled={item.href === '#' || item.disabled}
            />
          ))}
        </JmcNavCardGrid>
      )}
    </JmcPageShell>
  );
}
